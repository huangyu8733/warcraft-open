import { flavor } from "../data/flavor";
import { readSaveHeader, saveLine, type SaveHeader } from "./save/saveFile";
import { saveSink } from "./save/saveSink";

/**
 * The save screens' view of the running match. `main.ts` installs it once, lazily: a menu has
 * no world to write, and the match's own bookkeeping lives there — this module must not import
 * it (main.ts imports the menus).
 */
export interface SaveHost {
  /** Is there a match on screen that can be written right now (not a replay, not mid-load)? */
  canSave(): boolean;
  /** The name the Save screen offers — the map's and the moment. */
  suggestion(): string;
  /** Write the match as this name; resolves to the file it landed as, null when it could not. */
  save(name: string): Promise<string | null>;
  /** Load a saved game by its file name. */
  load(file: string): Promise<void>;
}

let host: SaveHost | null = null;

/** `main.ts` hands over its match here (once, at startup). */
export function setSaveHost(next: SaveHost | null): void {
  host = next;
}

/** Is there a saves folder at all (desktop, or the dev server)? */
export function saveSupported(): boolean {
  return saveSink() !== null;
}

/** Is the match on screen one that can be written right now? */
export function canSaveNow(): boolean {
  return saveSupported() && host !== null && host.canSave();
}

/** The name the Save panel offers, or "" when there is no world to name. */
export function suggestedSaveName(): string {
  return host?.suggestion() ?? "";
}

/**
 * One save in the list, as the panels draw it: the file, and the header fields they show — the
 * name, when it was written, the map, the engine, the game clock, and the chapter it belongs to.
 */
export interface SaveListEntry {
  file: string;
  header: {
    name: string;
    savedAt: string;
    map: { path: string; name: string };
    engine: string;
    gameTime: number;
    campaign: { key: string; chapter: number } | null;
    partial: boolean;
  };
}

function toEntry(file: string, h: SaveHeader): SaveListEntry {
  return {
    file,
    header: {
      name: h.name,
      savedAt: h.savedAt,
      map: { path: h.map.path, name: h.map.name },
      engine: h.version || h.gameVersion,
      gameTime: h.gameTime,
      campaign: h.campaign ? { key: h.campaign.key, chapter: h.campaign.index } : null,
      partial: false,
    },
  };
}

/**
 * Every save this line can load, oldest first — the order the Load screen lists them in. The
 * folder is shared with the other data line (and with every profile), so a save that belongs
 * to the other line is left on disk but out of THIS list: its state was written against a
 * different install and cannot be loaded here (`saveLine`). A file that will not decode is
 * skipped rather than failing the whole list.
 */
export async function listSaveGames(): Promise<SaveListEntry[]> {
  const sink = saveSink();
  if (!sink) return [];
  const out: SaveListEntry[] = [];
  for (const info of await sink.list()) {
    const bytes = await sink.read(info.name);
    if (!bytes) continue;
    try {
      const header = await readSaveHeader(bytes);
      if (saveLine(header) !== flavor()) continue;
      out.push(toEntry(info.name, header));
    } catch {
      // Not a save this build reads — leave it alone, and out of the list.
    }
  }
  return out;
}

/** Write the match as `name`. Resolves to the file's name, or null with a note in the console. */
export async function writeSaveGame(name: string): Promise<string | null> {
  if (!host || !saveSupported()) return null;
  try {
    return await host.save(name);
  } catch (err) {
    console.warn("[save] could not write", name, err);
    return null;
  }
}

/** Load a save. Resolves false (with a note) when the folder or the map refused. */
export async function loadSaveGame(file: string): Promise<boolean> {
  if (!host) return false;
  try {
    await host.load(file);
    return true;
  } catch (err) {
    console.warn("[save] could not load", file, err);
    return false;
  }
}

/** Remove a save from the folder. */
export async function deleteSaveGame(file: string): Promise<boolean> {
  const sink = saveSink();
  if (!sink) return false;
  try {
    return await sink.remove(file);
  } catch {
    return false;
  }
}
