import type { DataSource } from "./types";
import { normalizeMpqPath } from "./types";

/**
 * The player's own loose files, laid OVER the mounted store.
 *
 * A 1.30+ store has no `Maps\Campaign\*.w3m` blob: every campaign chapter was flattened into
 * the content store as ~20 separate entries (vfs/casc.ts), so `Maps\…` had nothing to read and
 * the folder's own `Maps\` tree — unlike an MPQ install's — was never reachable through the VFS
 * at all. A chapter a player puts in the folder therefore lost to the store's copy, sight
 * unseen: the Chinese folder's campaign maps sat right beside an English store's chapters and
 * every subtitle stayed English.
 *
 * One rule, the same one the map list already follows: a loose file of the same name wins, as
 * the player's own folder always does in Warcraft III.
 */
export class LooseFilesDataSource implements DataSource {
  readonly label = "install folder";
  /** Keys are always the normalized, lower-cased form — install folders differ in case. */
  private readonly files = new Map<string, File>();

  constructor(
    private readonly inner: DataSource,
    files: Iterable<[string, File]>,
  ) {
    for (const [path, file] of files) this.files.set(key(path), file);
  }

  exists(path: string): boolean {
    return this.files.has(key(path)) || this.inner.exists(path);
  }

  async read(path: string): Promise<Uint8Array> {
    const file = this.files.get(key(path));
    return file ? new Uint8Array(await file.arrayBuffer()) : this.inner.read(path);
  }

  /** A loose file is a device handle, so there is no synchronous read for it: the store's
   *  answer, when it has one. Nothing downstream reads a map this way —
   *  `readMapBytes` (vfs/mapArchive.ts) goes through exists + read, which see the file. */
  rawBytes(path: string): Uint8Array | null {
    return this.inner.rawBytes(path);
  }

  list(): string[] {
    return [...new Set([...this.inner.list(), ...this.files.keys()])];
  }

  /** The file's own name as the folder spells it (see `DataSource.displayName`): the stored
   *  `File` carries it, where the key this source lists is lower-cased. */
  displayName(path: string): string | undefined {
    return this.files.get(key(path))?.name;
  }

  /**
   * The store's exploded archives, NOT ours: a player's loose copy of a chapter is a whole
   * `.w3x` file, which `exists`/`read` already answer. Without this pass-through a 1.30+ store
   * could not hand a campaign chapter over at all — `readMapBytes` (vfs/mapArchive.ts) asks
   * the mounted source for one, and this wrapper is what the game actually holds.
   */
  openArchive(path: string): DataSource | null {
    return this.inner.openArchive?.(path) ?? null;
  }

  /** Same reason, for the renderer's art fallback: this wrapper must not hide the store's
   *  base-module copies (see DataSource.baseBytes). */
  baseBytes(path: string): Promise<Uint8Array | null> {
    return this.inner.baseBytes?.(path) ?? Promise.resolve(null);
  }
}

const key = (path: string): string => normalizeMpqPath(path).toLowerCase();
