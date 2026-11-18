import type { WireSnapshot } from "./snapshotWire";
import type { MeleeConfig } from "../ui/lobby";
import type { Difficulty } from "../data/campaignProgress";

/**
 * The SAVE-GAME file (`.o3s`) — this engine's own, not Blizzard's `.w3z`.
 *
 * A save is three layers, and only the first one existed before this file:
 *
 *   · the WORLD, which is already a solved problem: `snapshotFor` builds it and
 *     `snapshotWire.encodeSnapshot` packs the hot arrays into one base64 blob
 *     (game/snapshot.ts, game/snapshotWire.ts). So a save is not a new serializer —
 *     it is a snapshot plus the two things a snapshot has no reason to carry.
 *   · the SCRIPT: the map's JASS globals and its live timers (`Runtime.globals`,
 *     `Runtime.timers`). Handles need care — see `saveState.ts` for what crosses and
 *     what is deliberately left behind.
 *   · the SEAT: which map, which campaign chapter, which player, which difficulty,
 *     and where the camera was.
 *
 * The envelope is JSON because the payload already is (`WorldSnapshot` is plain data by
 * decision, docs/multiplayer.md), and a save is read once per load rather than 20 times a
 * second like the wire is.
 */

export const SAVE_EXT = ".o3s";
/** Bumped when the envelope changes shape. A save from another format is refused rather
 *  than half-read: the world codec has its own version byte for the same reason. */
export const SAVE_FORMAT = 1;

export interface SaveMapRef {
  /** The map's path as THIS install spells it — what `startGame` needs to find it again. */
  path: string;
  /** What the save screen shows. */
  name: string;
}

/** The campaign chapter a save was taken in, so loading it re-enters the same chapter. */
export interface SaveCampaignRef {
  key: string;
  chapter: number;
}

export interface SaveCamera {
  x: number;
  y: number;
  distance: number;
  angle: number;
  rotation: number;
}

/**
 * One JASS value as a save carries it — the same union `values.ts` uses, minus handles.
 *
 * A handle is a NUMBER (`Runtime.handles`) and means nothing in a fresh runtime: the units, the
 * triggers and the timers a load creates are new objects with new ids, so writing the old id
 * would rebind the variable to whatever happens to hold it next run. Rather than guess a match,
 * a global holding a handle is skipped and counted (`SaveScript.skipped`), and the save screen
 * says the save is partial. Scalars — which is what a map's `udg_` counters and flags are —
 * cross intact.
 */
export type SavedValue =
  | { k: "int"; n: number }
  | { k: "real"; n: number }
  | { k: "bool"; b: boolean }
  | { k: "string"; s: string }
  | { k: "code"; fn: string }
  | { k: "null" };

/** One array index that has been written. Arrays are sparse (8k slots, a handful used), so
 *  the written entries are the whole of the array's state. */
export type SavedArray = Array<[number, SavedValue]>;

export interface SavedTimer {
  handler: string | null;
  timeout: number;
  periodic: boolean;
  remaining: number;
  elapsed: number;
  running: boolean;
}

export interface SaveScript {
  globals: Array<[string, SavedValue]>;
  arrays: Array<[string, SavedArray]>;
  timers: SavedTimer[];
  /** `Runtime.gameTime`, which is the script's clock and not the sim's. */
  time: number;
  /** Globals skipped because they held a handle `saveState` could not name. Reported so the
   *  save screen can say the save is partial rather than quietly lose state. */
  skipped: number;
}

export interface SaveGame {
  format: number;
  savedAt: string;
  /** The build that wrote it — shown in the list and checked on load. */
  engine: string;
  map: SaveMapRef;
  campaign: SaveCampaignRef | null;
  /**
   * The match's own configuration (`MeleeConfig` is plain data): seats, controllers, fog
   * mode, seed, forces and the local player's slot. A load feeds it back to `startGame`
   * unchanged, which is what makes the save a MATCH rather than only a world — the seed alone
   * is what keeps the sim's dice on the same sequence after a load.
   */
  config: MeleeConfig;
  localPlayer: number;
  /** The chapter screen's rung, for the campaign it belongs to. */
  difficulty: Difficulty;
  /** Seconds of match time. */
  gameTime: number;
  world: WireSnapshot;
  script: SaveScript | null;
  camera: SaveCamera | null;
}

/** What the save LIST can say about a file without decoding its world. */
export interface SaveHeader {
  name: string;
  savedAt: string;
  map: SaveMapRef;
  campaign: SaveCampaignRef | null;
  gameTime: number;
  engine: string;
  partial: boolean;
}

/** A file name the player typed, as a save file name: no path, no reserved characters. */
export function saveFileName(name: string): string {
  const base = String(name ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim();
  if (!base || base.startsWith(".")) return "";
  // A typed extension is kept as typed only when it is OURS; `.w3z` and friends become part
  // of the name rather than a claim about the file.
  const withExt = base.toLowerCase().endsWith(SAVE_EXT) ? base : base + SAVE_EXT;
  return withExt.slice(0, 120);
}

/** `Foo.o3s` → `Foo`, for the list and the name box. */
export function saveDisplayName(file: string): string {
  return file.replace(new RegExp(`${SAVE_EXT.replace(".", "\\.")}$`, "i"), "");
}

export function encodeSave(game: SaveGame): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(game));
}

export function decodeSave(bytes: Uint8Array): SaveGame {
  const text = new TextDecoder().decode(bytes);
  const game = JSON.parse(text) as SaveGame;
  if (!game || typeof game !== "object" || game.format !== SAVE_FORMAT) {
    throw new Error(`save: unsupported format ${String((game as { format?: unknown })?.format)}`);
  }
  if (!game.world || !game.map || typeof game.map.path !== "string" || !game.config) {
    throw new Error("save: the world, the map reference or the match configuration is missing");
  }
  return game;
}

/** The list row's reading of a file, or null when it is not a save this build can open. */
export function readSaveHeader(bytes: Uint8Array, file: string): SaveHeader | null {
  let game: SaveGame;
  try {
    game = decodeSave(bytes);
  } catch {
    return null;
  }
  return {
    name: saveDisplayName(file),
    savedAt: game.savedAt,
    map: game.map,
    campaign: game.campaign,
    gameTime: game.gameTime,
    engine: game.engine,
    partial: (game.script?.skipped ?? 0) > 0,
  };
}
