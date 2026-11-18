// OpenWar3 (P2-3): the MDX half of "get parsing off the main thread".
//
// The match's viewer installs `mdxParse.ts`'s hook, which hands every fetched MDX's bytes to
// this worker. Parsing a Reforged model is tens of milliseconds of BinaryStream reads and
// thousands of small allocations, and it happens on first appearance — the same hitch as the
// texture upload, only before it. Here the whole `MdlxParser.load()` runs on a worker thread
// and the result is structured-cloned back.
//
// The clone loses each node's PROTOTYPE, which is fine: the viewer-side model builder only
// READS fields (sequences, geosets, tracks, …); it never calls a parser method. The client
// (`mdxParse.ts`) re-attaches the `MdlxParser` prototype to the root before handing it to the
// MDX handler, which is the one place that does an `instanceof` check.
//
// The typed arrays are TRANSFERRED back (structured clone otherwise copies every vertex
// buffer), which is also why the client sends a COPY of the file: if anything here fails the
// main thread still has the original bytes and falls back to parsing them itself.

import MdlxParser from "mdx-m3-viewer/dist/cjs/parsers/mdlx/model";

export interface MdxParseRequest {
  id: number;
  bytes: ArrayBuffer;
}

export interface MdxParseResponse {
  id: number;
  /** The parsed tree, or undefined when the file could not be parsed at all. */
  parser?: unknown;
  /** `MdlxParser.load()` threw (the stock path catches this too and still tries to build). */
  error?: string;
  /** Wall time of `parser.load()` — the main-thread work this request avoided. */
  parseMs?: number;
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<MdxParseRequest>) => void) | null;
  postMessage(message: MdxParseResponse, transfer?: Transferable[]): void;
};

/** Every ArrayBuffer behind a typed array in the tree, once each, for the transfer list. */
function buffersIn(root: unknown): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const seen = new Set<unknown>();

  const walk = (node: unknown): void => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    if (node instanceof ArrayBuffer) {
      buffers.add(node);
      return;
    }

    if (ArrayBuffer.isView(node)) {
      buffers.add(node.buffer as ArrayBuffer);
      return;
    }

    for (const key of Object.keys(node)) {
      walk((node as Record<string, unknown>)[key]);
    }
  };

  walk(root);

  return [...buffers];
}

scope.onmessage = (event) => {
  const { id, bytes } = event.data;
  const parser = new MdlxParser();
  let error: string | undefined;
  const started = performance.now();

  // The stock model constructor lets a broken file through with whatever was parsed before the
  // throw; keep that behaviour so a damaged model renders exactly as it does today.
  try {
    parser.load(bytes);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  scope.postMessage({ id, parser, error, parseMs: performance.now() - started }, buffersIn(parser));
};
