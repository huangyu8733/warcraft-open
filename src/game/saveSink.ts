import { SAVE_EXT } from "./saveFile";

// Where SAVE-GAME files go (game/saveFile.ts) — the same two doors the replays have, and for the
// same reason (game/replaySink.ts): the desktop shell's `saves/` in its data folder, the repo's
// `.saves/` under `pnpm dev`, and nothing at all in a plain browser build. The one writer is
// electron/saveStore.mjs, which the dev server also mounts.

export interface SaveFileInfo {
  name: string;
  size: number;
  /** Last written, ms since the epoch. */
  mtime: number;
}

export interface SaveSink {
  /** Write one save under the player's name; resolves the name it was kept as, or null. */
  write(name: string, bytes: Uint8Array): Promise<string | null>;
  /** Every save in the folder, newest first. */
  list(): Promise<SaveFileInfo[]>;
  /** One save's bytes, or null. */
  read(name: string): Promise<Uint8Array | null>;
  /** Delete one; true when it is gone. */
  remove(name: string): Promise<boolean>;
}

interface NativeSaves {
  write(name: string, bytes: Uint8Array): Promise<string | null>;
  list(): Promise<SaveFileInfo[]>;
  read(name: string): Promise<Uint8Array | null>;
  remove(name: string): Promise<boolean>;
}

/** The sink this build has: the desktop shell's, the dev server's, or none. */
export function saveSink(): SaveSink | null {
  const native = (window as unknown as { ow3native?: { saves?: NativeSaves } }).ow3native?.saves;
  if (native) {
    return {
      write: (name, bytes) => native.write(name, bytes),
      list: () => native.list(),
      read: async (name) => {
        const b = await native.read(name);
        return b ? new Uint8Array(b) : null;
      },
      remove: (name) => native.remove(name),
    };
  }
  if (import.meta.env.DEV) {
    return {
      write: async (name, bytes) => {
        const r = await fetch(`/saves/write?name=${encodeURIComponent(name + (name.toLowerCase().endsWith(SAVE_EXT) ? "" : SAVE_EXT))}`, {
          method: "POST",
          body: bytes as BodyInit,
        });
        return r.ok ? ((await r.json()) as { name: string | null }).name : null;
      },
      list: async () => {
        const r = await fetch("/saves/list");
        return r.ok ? ((await r.json()) as SaveFileInfo[]) : [];
      },
      read: async (name) => {
        const r = await fetch(`/saves/file?name=${encodeURIComponent(name)}`);
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      },
      remove: async (name) => {
        const r = await fetch(`/saves/delete?name=${encodeURIComponent(name)}`, { method: "POST" });
        return r.ok && ((await r.json()) as { ok: boolean }).ok;
      },
    };
  }
  return null;
}
