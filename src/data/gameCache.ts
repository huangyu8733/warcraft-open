import { flavor } from "./flavor";
import { profileKey } from "./profiles";

// GAME CACHES — what a campaign carries from one chapter to the next.
//
// `Scripts\common.j` says where one lives, in the comment over the native that makes it:
//
//     // Creates a new or reads in an existing game cache file stored
//     // in the current campaign profile dir
//     native  InitGameCache    takes string campaignFile returns gamecache
//
// So a cache is (a) a FILE, named by the script, and (b) **per profile** — which is exactly
// what `PROFILE_MESSAGE` promises the player on the Single Player screen ("Each profile will
// hold information for your campaign progress…"). Both halves land here: the store is
// localStorage under `profileKey`, and `warcraft-open.gamecache` is in profiles.ts's `PROFILE_OWNED`
// so deleting a profile takes every cache with it.
//
// **All of a profile's cache files live in ONE storage key**, keyed by file name inside it,
// rather than one key per file. That is not tidiness: `deleteProfile` and `adoptOrphaned` sweep
// `PROFILE_OWNED` by exact key, and a scheme that hung `<base>.<profile>.<file>` off the base
// would need a prefix sweep in which `warcraft-open.gamecache.campaigns.w3v` (no profile) and
// `warcraft-open.gamecache.Bob.campaigns.w3v` are indistinguishable without knowing every profile
// name. One blob per profile keeps profiles.ts's rule exactly as it is.
//
// The file NAME separates the two EDITIONS (the game's own `Campaigns.w3v` for Reign of Chaos,
// `Campaigns.w3x` for The Frozen Throne), but it does NOT separate the two DATA LINES: both
// sd and hd run Frozen Throne campaigns and both ask for `Campaigns.w3x`. A profile is shared
// between the lines (it is the player, not the install), so the store is split by `flavor()`
// as well — a hero carried through the classic chapters must not arrive in a Reforged one,
// where the unit and item data behind it is a different build's.
//
// This module is deliberately dumb — it knows nothing about units or heroes, only about reading
// and writing a blob of JSON under a name. What is IN a cache is
// `src/jass/natives/gamecache.ts`'s business, and what a stored UNIT is made of is the sim's
// (`SimWorld.storeUnitState`).

/** The one key a profile's caches live under. Listed in profiles.ts `PROFILE_OWNED`. */
export const GAME_CACHE_KEY = "warcraft-open.gamecache";

/** One cache file, as it sits in storage: missionKey → key → the typed slots under it.
 *  Kept as plain JSON so a cache written by one build is readable by the next. */
export type CacheFileData = Record<string, Record<string, unknown>>;

/** Every cache file this profile has, by the name the script called it (lower-cased, because
 *  a script types the name by hand and the reference's store is a file system). */
type CacheFiles = Record<string, CacheFileData>;

/** A profile's cache files, one bucket per data line. */
interface CacheStore {
  sd: CacheFiles;
  hd: CacheFiles;
}

function side(value: unknown): CacheFiles {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: CacheFiles = {};
  for (const [file, data] of Object.entries(value as Record<string, unknown>)) {
    if (data && typeof data === "object" && !Array.isArray(data)) out[file] = data as CacheFileData;
  }
  return out;
}

function readStore(): CacheStore {
  try {
    const raw = localStorage.getItem(profileKey(GAME_CACHE_KEY));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { sd: {}, hd: {} };
    // Before the two data lines shared a profile this blob was ONE flat file map. Those caches
    // were written on the classic line (Reforged came later), so they stay there and hd starts
    // empty — carrying them into hd is the exact mix-up this split exists to stop.
    if (!("sd" in parsed) && !("hd" in parsed)) return { sd: side(parsed), hd: {} };
    const store = parsed as Record<string, unknown>;
    return { sd: side(store.sd), hd: side(store.hd) };
  } catch {
    return { sd: {}, hd: {} }; // private mode, corrupt JSON — see readGameCache
  }
}

/**
 * Read a cache file back, or an empty one if it has never been written.
 *
 * Best-effort, like every other read in `data/`: a disabled or corrupt store should cost the
 * player the hero they carried, not the chapter. A campaign map that finds nothing simply takes
 * its own "if the hero data wasn't found, create a default hero" branch, which every chapter in
 * the game has.
 */
export function readGameCache(file: string): CacheFileData {
  const data = readStore()[flavor()][file.toLowerCase()];
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: CacheFileData = {};
  for (const [mission, keys] of Object.entries(data)) {
    if (keys && typeof keys === "object" && !Array.isArray(keys)) out[mission] = { ...keys };
  }
  return out;
}

/** `SaveGameCache` — "Saves the game cache, using the same filename from which it was created"
 *  (UI\TriggerStrings.txt). Answers whether it landed, which is what the native returns. */
export function writeGameCache(file: string, data: CacheFileData): boolean {
  try {
    const store = readStore();
    store[flavor()][file.toLowerCase()] = data;
    localStorage.setItem(profileKey(GAME_CACHE_KEY), JSON.stringify(store));
    return true;
  } catch {
    return false; // private mode, or the quota is full — the chapter still plays
  }
}
