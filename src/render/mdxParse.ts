// OpenWar3 (P2-3): parse MDX models in a Worker.
//
// `viewer.load()` fetches a model's bytes and, stock, parses them synchronously in the same
// turn — `MdlxParser.load()` reads every chunk and allocates the whole object graph. For a
// Reforged model that is tens of milliseconds of main-thread work exactly when the model first
// appears (a bought hero, a spell's effect, the first wave of a new unit), on top of the DDS
// upload that follows it.
//
// The world viewer gets this hook (`ow3ParseMdx`, see viewer.ts): bytes that start with MDLX
// go to `mdxParseWorker.ts`, and the already-parsed tree comes back structured-cloned. The
// clone has no prototypes, which does not matter — the model builder only reads fields — so
// `Object.assign` onto a fresh parser instance restores the one `instanceof` the handler makes
// and everything downstream behaves as if the parse happened here.
//
// A/B and measurement: `window.__OW3_MDX__.parseWorker = false` turns the worker off for the
// next model (the main thread parses it, as before), and `window.__OW3_MDX__.stats` counts
// what has gone through. HD only — SD never installs the hook, so classic parsing and its
// timing are untouched.

import MdlxParser from "mdx-m3-viewer/dist/cjs/parsers/mdlx/model";
import type { MdxParseResponse } from "./mdxParseWorker";

export interface MdxParseStats {
  /** Every fetched resource the viewer handed to the hook (MDX or not). */
  calls: number;
  /** Models parsed in the worker. */
  parsed: number;
  /** Files the parser threw on (returned anyway — the stock path does the same). */
  errors: number;
  /** Loads that stayed on the main thread (worker unavailable, disabled, or not an MDX). */
  fallbacks: number;
  /** `MdlxParser.load()` time the main thread did not spend, summed. */
  parseMs: number;
  lastParseMs: number;
}

export interface MdxParseBridge {
  /** `false` = parse on the main thread, as before the worker existed. */
  parseWorker?: boolean;
  stats: MdxParseStats;
}

declare global {
  var __OW3_MDX__: MdxParseBridge | undefined;
}

interface MdxParseViewer {
  ow3ParseMdx?: (bytes: Uint8Array) => Promise<unknown | null>;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (response: MdxParseResponse | null) => void>();

function stats(): MdxParseStats | undefined {
  return globalThis.__OW3_MDX__?.stats;
}

function failAll(): void {
  const waiting = [...pending.values()];
  pending.clear();
  for (const resolve of waiting) resolve(null);
}

/** The worker, created on first use. `null` when the environment cannot make one. */
function ensureWorker(): Worker | null {
  if (worker) return worker;

  try {
    worker = new Worker(new URL("./mdxParseWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }

  worker.onmessage = (event: MessageEvent<MdxParseResponse>) => {
    const resolve = pending.get(event.data.id);

    if (resolve) {
      pending.delete(event.data.id);
      resolve(event.data);
    }
  };

  // A dead worker means the next model goes back to the main thread; the in-flight ones get
  // `null` and fall back too.
  worker.onerror = () => {
    worker?.terminate();
    worker = null;
    failAll();
  };

  return worker;
}

/** Is this the MDX magic? MDL is text and stays on the main thread (HD art is all MDX). */
function isMdx(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x4d && bytes[1] === 0x44 && bytes[2] === 0x4c && bytes[3] === 0x58;
}

/**
 * Parse one MDX off-thread, or answer `null` to keep the stock main-thread parse.
 *
 * The bytes are copied before they are transferred: on any failure (worker gone, clone error)
 * the caller still holds intact bytes and parses them itself.
 */
export async function parseMdxOffThread(bytes: Uint8Array): Promise<unknown | null> {
  const s = stats();

  if (s) s.calls++;

  if (!isMdx(bytes)) return null;

  const bridge = globalThis.__OW3_MDX__;

  if (bridge?.parseWorker === false || ensureWorker() === null) {
    if (s) s.fallbacks++;
    return null;
  }

  const id = nextId++;
  const copy = bytes.slice().buffer;

  const response = await new Promise<MdxParseResponse | null>((resolve) => {
    pending.set(id, resolve);

    try {
      worker!.postMessage({ id, bytes: copy }, [copy]);
    } catch {
      pending.delete(id);
      resolve(null);
    }
  });

  if (!response) {
    if (s) s.fallbacks++;
    return null;
  }

  if (s) {
    s.parsed++;
    if (response.error !== undefined) s.errors++;
    if (response.parseMs !== undefined) {
      s.parseMs += response.parseMs;
      s.lastParseMs = response.parseMs;
    }
  }

  // Structured clone dropped the prototypes; the model builder only reads fields, so putting
  // the root's prototype back is all the handler needs (`instanceof MdlxParser`).
  const parser = new MdlxParser();
  Object.assign(parser, response.parser);

  return parser;
}

/** Let this viewer parse MDX models in a Worker. Called for the HD world viewer only. */
export function installMdxParseWorker(viewer: MdxParseViewer): void {
  globalThis.__OW3_MDX__ ??= {
    parseWorker: true,
    stats: { calls: 0, parsed: 0, errors: 0, fallbacks: 0, parseMs: 0, lastParseMs: 0 },
  };

  viewer.ow3ParseMdx = parseMdxOffThread;
}
