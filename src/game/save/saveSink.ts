// Where SAVED GAMES go (issue #159, docs/save-games.md) — the one browser-only piece, kept apart
// from the format as replaySink.ts is from the replay file. Two doors, one store
// (electron/saveStore.mjs): the desktop shell's `saves/<line>/` in the data folder, beside
// `replays/`, and under `pnpm dev` the repo's own `.saves/<line>/`. A plain web build has no
// disk, and keeps its saves in the page's own IndexedDB instead (`browserSaves`) — a save is
// something the player made and expects to find again, so a build with no folder still has to
// have somewhere.
//
// `<line>` is the data line (data/flavor.ts): the two run different installs, and a state
// captured against one line's unit, ability and item data is not a state the other can restore,
// so their saves never share a folder. The pre-split folders (`.saves/`, `saves/`, IndexedDB's
// old `saves` store) are still READ: the page tells each old save's line from its own header
// (`saveLine`), and the load list only shows the current line's.

import { flavor } from "../../data/flavor";

export interface SaveFileInfo {
  name: string;
  size: number;
  /** Last written, ms since the epoch. */
  mtime: number;
}

export interface SaveSink {
  /** Write a saved game; resolves to the name it was written as, or null. */
  write(name: string, bytes: Uint8Array): Promise<string | null>;
  /** Every saved game, newest first. */
  list(): Promise<SaveFileInfo[]>;
  read(name: string): Promise<Uint8Array | null>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<boolean>;
}

/** The extension of a saved game. Ours: WC3's is `.w3z`, which is a different format. */
export const SAVE_EXT = ".o3s";

/** A name as the store will write it: no folders, no characters a file system minds, our
 *  extension. The shell and the dev server reduce it the same way (electron/saveStore.mjs). */
export function saveFileName(name: string): string {
  let base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  base = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim();
  if (!base.toLowerCase().endsWith(SAVE_EXT)) base += SAVE_EXT;
  return base.slice(0, 120);
}

interface NativeSaves {
  write(name: string, bytes: Uint8Array): Promise<string | null>;
  list(): Promise<SaveFileInfo[]>;
  read(name: string): Promise<Uint8Array | null>;
  exists(name: string): Promise<boolean>;
  remove(name: string): Promise<boolean>;
}

let cached: SaveSink | null | undefined;

/** The sink this build has: the desktop shell's, the dev server's, or the page's own. */
export function saveSink(): SaveSink {
  if (cached) return cached;
  const native = (window as unknown as { ow3native?: { saves?: NativeSaves } }).ow3native?.saves;
  if (native) {
    return (cached = {
      write: (name, bytes) => native.write(name, bytes),
      list: () => native.list(),
      read: async (name) => {
        const b = await native.read(name);
        return b ? new Uint8Array(b) : null;
      },
      exists: (name) => native.exists(name),
      remove: (name) => native.remove(name),
    });
  }
  if (import.meta.env.DEV) {
    // The dev server keeps `.saves/<line>/`; its pre-split `.saves/` is still read for this line.
    const q = (name: string): string => `name=${encodeURIComponent(name)}`;
    const base = `/saves/${flavor()}`;
    return (cached = {
      write: async (name, bytes) => {
        const r = await fetch(`${base}/write?${q(name)}`, { method: "POST", body: bytes as BodyInit });
        return r.ok ? ((await r.json()) as { name: string | null }).name : null;
      },
      list: async () => {
        const r = await fetch(`${base}/list`);
        return r.ok ? ((await r.json()) as SaveFileInfo[]) : [];
      },
      read: async (name) => {
        const r = await fetch(`${base}/file?${q(name)}`);
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      },
      exists: async (name) => {
        const r = await fetch(`${base}/exists?${q(name)}`);
        return r.ok && ((await r.json()) as { ok: boolean }).ok;
      },
      remove: async (name) => {
        const r = await fetch(`${base}/delete?${q(name)}`, { method: "POST" });
        return r.ok && ((await r.json()) as { ok: boolean }).ok;
      },
    });
  }
  return (cached = browserSaves());
}

/** A web build's saves: IndexedDB, one object store per data line ("sd", "hd"), plus the
 *  pre-split "saves" store — still read for the files the old build wrote, never written now. */
function browserSaves(): SaveSink {
  const DB = "openwar3-saves";
  const LEGACY = "saves";
  const line = flavor() === "hd" ? "hd" : "sd";
  type Row = { bytes: Uint8Array; mtime: number };
  const open = (): Promise<IDBDatabase> =>
    new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const store of [LEGACY, "sd", "hd"]) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async <T>(store: string, mode: IDBTransactionMode, body: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = body(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  };
  const rowOf = async (store: string, name: string): Promise<Row | undefined> =>
    (await run(store, "readonly", (s) => s.get(saveFileName(name)))) as Row | undefined;
  const all = async (store: string): Promise<SaveFileInfo[]> => {
    const keys = (await run(store, "readonly", (s) => s.getAllKeys())) as string[];
    const rows = (await run(store, "readonly", (s) => s.getAll())) as Row[];
    return keys.map((name, i) => ({ name, size: rows[i].bytes.length, mtime: rows[i].mtime }));
  };
  return {
    write: async (name, bytes) => {
      const file = saveFileName(name);
      await run(line, "readwrite", (s) => s.put({ bytes, mtime: Date.now() } satisfies Row, file));
      return file;
    },
    list: async () => {
      const byName = new Map<string, SaveFileInfo>();
      for (const info of await all(line)) byName.set(info.name, info);
      for (const info of await all(LEGACY)) if (!byName.has(info.name)) byName.set(info.name, info);
      return [...byName.values()].sort((a, b) => b.mtime - a.mtime);
    },
    read: async (name) => (await rowOf(line, name))?.bytes ?? (await rowOf(LEGACY, name))?.bytes ?? null,
    exists: async (name) => (await rowOf(line, name)) !== undefined || (await rowOf(LEGACY, name)) !== undefined,
    remove: async (name) => {
      await run(line, "readwrite", (s) => s.delete(saveFileName(name)));
      await run(LEGACY, "readwrite", (s) => s.delete(saveFileName(name)));
      return true;
    },
  };
}
