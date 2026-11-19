import type { Campaign, CampaignEntry } from "./campaigns";
import { flavor } from "./flavor";
import { profileKey } from "./profiles";

// Campaign progress (issue #101) — which campaigns are open and how far into each one the
// player has got. In Warcraft III this lives in the PROFILE (SinglePlayerMenu.fdf's profile
// half: "Each profile will hold information for your campaign progress as well as a personal
// saved games list" — GlobalStrings PROFILE_MESSAGE), and since issue #80 it does here too:
// both keys below are read and written through `profileKey`, so they land under the profile in
// play and deleting that profile takes them with it (data/profiles.ts). The store is the one
// the Options screen uses — localStorage, one JSON blob (data/options.ts).
//
// The rules below are the game's own, and both come out of the campaign index itself:
//   • a campaign with `DefaultOpen=1` is "initially open and selectable by a new user"; TFT
//     opens Terror of the Tides and the Bonus campaign, and holds Curse of the Blood Elves
//     and Legacy of the Damned back;
//   • a locked campaign opens when the one before it IN LIST ORDER is finished — the order
//     the index calls "significant", i.e. the order the screen lists them in.
// Within a campaign, chapter N+1 opens when chapter N is completed; cinematics never gate
// anything (you may watch the opening one, or not, and chapter one is open either way).
//
// This client does NOT enforce either rule: every campaign in the library and every chapter
// in it is playable from the first visit, so a player can jump straight to any mission without
// replaying the ones before it (see `isCampaignOpen` / `openRows` below). `completed()` still
// tracks how far a profile has got — the screens show it, and finishing a mission still
// advances the count — but it no longer hides or disables anything.

// The BASE keys. Never read one directly — `lineKey` adds the install line and `profileKey`
// suffixes the profile in play (both are listed in profiles.ts's PROFILE_OWNED so a deleted
// profile takes them with it).
const STORAGE_KEY = "warcraft-open.campaigns";
const DIFFICULTY_KEY = "warcraft-open.campaignDifficulty";

/**
 * A campaign-owned key namespaced by the LINE it belongs to (`sd` = the classic install,
 * `hd` = Reforged). The two lines list different campaigns and chapters from different
 * installs, so one line's progress must never open the other's chapters — they are separate
 * games that happen to share a browser profile.
 */
const lineKey = (base: string): string => `${base}.${flavor()}`;

/** The value stored under `base` for the profile in play, adopting the pre-line key (written
 *  before the lines were split) the first time the new one is asked for. */
function readLine(base: string): string | null {
  try {
    const key = profileKey(lineKey(base));
    const raw = localStorage.getItem(key);
    if (raw !== null) return raw;
    const legacy = localStorage.getItem(profileKey(base));
    if (legacy === null) return null;
    localStorage.setItem(key, legacy);
    return legacy;
  } catch {
    return null;
  }
}

/**
 * common.j's `gamedifficulty` rungs, by name — MAP_DIFFICULTY_EASY / NORMAL / HARD.
 *
 * All three are real: a chapter runs at any of them and `GetGameDifficulty` answers with any
 * of them. Only two are ever OFFERED — see `DIFFICULTIES` in ui/fdfCampaign.ts. Easy is
 * reached exclusively by losing and taking the defeat dialog's Reduce Difficulty
 * (`CustomDefeatReduceDifficultyBJ`), which is why the name stays here while the campaign
 * screens no longer list it.
 */
export type Difficulty = "easy" | "normal" | "hard";

/** What may be REMEMBERED as the player's choice: the rungs the screens offer. A profile that
 *  stored "easy" before the menu was corrected — or by hand — reads back as Normal, the
 *  game's own default, rather than as a row that is no longer on the menu. */
const OFFERED: Difficulty[] = ["normal", "hard"];

/** The difficulty the player last chose — remembered between visits, as the reference
 *  remembers it per profile. WC3's own default is Normal. */
export function loadDifficulty(): Difficulty {
  try {
    const raw = readLine(DIFFICULTY_KEY) as Difficulty | null;
    return raw && OFFERED.includes(raw) ? raw : "normal";
  } catch {
    return "normal";
  }
}

export function saveDifficulty(d: Difficulty): void {
  try {
    localStorage.setItem(profileKey(lineKey(DIFFICULTY_KEY)), d);
  } catch { /* storage unavailable */ }
}

/** campaign key → how many of its ROWS (campaignRows order) the player has completed. */
type Progress = Record<string, number>;

export function loadProgress(): Progress {
  try {
    const raw = readLine(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Progress = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && v >= 0) out[k] = Math.floor(v);
    }
    return out;
  } catch {
    return {}; // private mode, corrupt JSON — a fresh profile is the right answer either way
  }
}

function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(profileKey(lineKey(STORAGE_KEY)), JSON.stringify(p));
  } catch { /* storage unavailable — progress is lost, the menus still work */ }
}

/** Is `campaign` selectable? Always — this client does not gate campaigns on progress. */
export function isCampaignOpen(campaigns: Campaign[], index: number, _p = loadProgress()): boolean {
  return campaigns[index] !== undefined;
}

/** How many of a campaign's MISSIONS are done (cinematic rows don't count as progress). */
export function completed(c: Campaign, p = loadProgress()): number {
  return Math.min(p[c.key] ?? 0, c.missions.length);
}

/** Is mission `index` (an index into `campaign.missions`) playable? Always — the chapter list
 *  offers every mission from the first visit, in order or not. */
export function isMissionOpen(_c: Campaign, _index: number, _p = loadProgress()): boolean {
  return true;
}

/**
 * The campaigns this profile may SEE, in list order, each with its index into `campaigns`.
 * Every campaign in the library is listed (nothing is held back, see the rules at the top).
 */
export function openCampaigns(campaigns: Campaign[], p = loadProgress()): Array<{ campaign: Campaign; index: number }> {
  return campaigns
    .map((campaign, index) => ({ campaign, index }))
    .filter(({ index }) => isCampaignOpen(campaigns, index, p));
}

/** One row of a chapter list: the entry, and — for a chapter — which of `campaign.missions`
 *  it is. A cinematic is not a chapter and carries `-1`. */
export interface CampaignRow {
  entry: CampaignEntry;
  /** Index into `campaign.missions`, or -1 for one of the campaign's three cinematics. */
  mission: number;
}

/**
 * The rows of `c`'s chapter list, top to bottom — `campaignRows` order. Nothing is held back:
 * the Intro and Open cinematics, every chapter, and the End cinematic are all listed from the
 * first visit, so the player can pick any mission in any order. Encrypted DLC chapters stay in
 * the list too; the screen disables those itself (the archive is not in this install).
 */
export function openRows(c: Campaign, _p = loadProgress()): CampaignRow[] {
  const out: CampaignRow[] = [];
  for (const cinematic of [c.intro, c.open]) if (cinematic) out.push({ entry: cinematic, mission: -1 });
  c.missions.forEach((entry, mission) => out.push({ entry, mission }));
  if (c.end) out.push({ entry: c.end, mission: -1 });
  return out;
}

/** Record a mission as finished — everything up to and including `index` is now done. */
export function markMissionComplete(campaignKey: string, index: number): void {
  const p = loadProgress();
  p[campaignKey] = Math.max(p[campaignKey] ?? 0, index + 1);
  saveProgress(p);
}

/** Wipe all progress (the console hook behind a "new profile"). */
export function resetProgress(): void {
  saveProgress({});
}
