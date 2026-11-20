import type { DataSource } from "../vfs/types";
import { openCampaignArchive, type CampaignArchive } from "./campaignArchive";
import { parseWar3Skins, skinValue, WAR3SKINS } from "./war3skins";
import { isRoc, skinVersionSuffix } from "./edition";
import { isHd } from "./flavor";
import { decodeGameText } from "./text";
import { parseFdf } from "../ui/fdf/parser";

// The campaign index (issue #101) — what the Campaign screen is a view of.
//
// Warcraft III keeps the whole thing in ONE data file, and the file documents itself in its
// own header comment (UI\CampaignStrings_exp.txt, quoted here where it decides something):
//
//   • `[Index] CampaignList` names the campaign SECTIONS, "The order of these values is
//     significant, as that is the order in which they will appear on the campaign selection
//     screen." TFT's list carries empty entries between them — the Reign of Chaos campaigns'
//     slots — and those are skipped.
//   • each `[Section]` is one campaign: a `Header`/`Name` pair (the two lines a campaign row
//     shows: "Sentinels Campaign" / "Terror of the Tides"), the 3D `Background` model, its fog,
//     the racial `Cursor`, the `AmbientSound`, up to three cinematics, and `MissionN`.
//   • `MissionN="Header","Mission Name","Map Filename"` — "You can have up to 128 missions in a
//     given campaign, but putting more than 15 will make a scrollbar appear to see the rest."
//     (TFT's longest is Legacy of the Damned at 14, so nothing here ever scrolls.)
//   • `DefaultOpen=1` marks a campaign "initially open and selectable by a new user"; the rest
//     unlock as the player finishes the one before (see campaignProgress.ts).
//
// `Background` is a war3skins.txt KEY, not a path, and the file says so: "The value specified
// must be an entry in the war3skins.txt file. Realize that this value is processed using the
// expansion naming convention (i.e. V0, V1, etc)" — so `NightElfBackdrop` + `_V1` resolves to
// UI\Glues\SinglePlayer\NightElf_Exp\NightElf_Exp.mdl, the TFT backdrop, while `_V0` would give
// the RoC one. That is the same `_V1` suffix the music playlists use (data/war3skins.ts).
//
// WHICH file is itself a versioned war3skins key: `[Default] CampaignFile_V1=UI\CampaignStrings_exp.txt`
// and `CampaignFile_V0=UI\CampaignStrings.txt` (docs/editions.md). On 1.30.4 the Reign of Chaos
// file is the SAME format — a CampaignList of five sections (Tutorial, Human, Undead, Orc,
// NightElf), `MissionN` rows naming `Maps\Campaign\*.w3m` — so one parser reads both.
//
// Four of RoC's section names are also TFT's (`Human` is The Scourge of Lordaeron in one file and
// Curse of the Blood Elves in the other), so a Reign of Chaos campaign's KEY carries a `RoC.`
// prefix: the key is what progress is saved under (campaignProgress.ts), and finishing one
// edition's Human campaign must not open the other's.

/** The expansion campaign index — `CampaignFile_V1`, and the fallback when war3skins is absent. */
export const CAMPAIGN_INDEX = "UI\\CampaignStrings_exp.txt";
/** Reign of Chaos's — `CampaignFile_V0`. */
export const ROC_CAMPAIGN_INDEX = "UI\\CampaignStrings.txt";
/**
 * 3.0's campaign indexes, one per art line. They replace the two above (which 3.0 no longer
 * ships) and differ in the maps they name: Reforged's are the HD `.w3x` chapters under
 * `Campaign/Reforged/`, Classic's the SD `.w3m` copies under `Campaign/Classic/`. The format is
 * otherwise the one documented above — same `CampaignList`, same `MissionN` rows — except that
 * `Header`/`Name` are GlobalStrings KEYS ("CAMP_CHAPTER_1") rather than the words themselves.
 */
export const REFORGED_CAMPAIGN_INDEX = "UI\\CampaignInfoReforged.txt";
export const CLASSIC_CAMPAIGN_INDEX = "UI\\CampaignInfoClassic.txt";
/**
 * 3.0's DLC campaigns, one index per DLC: `CampaignInfoDLC01.txt` is Forsaken Kingdom's
 * (`[HumanRE]` / `[UndeadRE]`, `Expansion="DLC01"`). The install carries no list of them, so
 * the mounted archives are asked for the pattern; the file name's number orders them after
 * the base campaign list, which is where the reference client puts the DLC.
 */
const DLC_CAMPAIGN_INDEX = /^UI\\CampaignInfoDLC\d+\.txt$/i;
/**
 * A DLC chapter map's extension. `.w3xd` is 3.0's DLC container, and it is NOT a map archive:
 * the file has no signature and Blizzard ships it encrypted so the campaign cannot be pulled
 * out of CASC and played for free. The engine can list it but cannot read it, so entries that
 * name one are marked `encrypted` rather than `playable` (see `parseEntry`).
 */
const ENCRYPTED_MAP = /\.w3xd$/i;

/** The game's own string table — `CampaignInfo*.txt` names its rows through it. */
const GLOBAL_STRINGS = "UI\\FrameDef\\GlobalStrings.fdf";

/**
 * The map the main menu's **Credits** button plays.
 *
 * WC3's credits are not a screen — they are a MAP, played exactly as a chapter is, and
 * `Game.dll` names all four of them in one run (docs/reverse-engineering/game-dll-thread.md):
 *
 *     maps\campaign\War3XBonusCredits.w3x        maps\campaign\BonusCredits.w3m
 *     maps\campaign\War3XRegularCreditsIce.w3x   maps\campaign\WarcraftIIICredits.w3m
 *
 * A REGULAR and a BONUS one per edition. The button plays the regular one; the bonus pair is
 * what the Bonus campaign closes ON, which is a campaign ending rather than a menu button.
 *
 * The dll spells all four under `maps\campaign\`, but the install puts the expansion's two
 * under `Maps\FrozenThrone\Campaign\` with the rest of the TFT campaign — so those are the
 * paths here, the install's own spelling rather than the string in the binary.
 *
 * 3.0 MOVED them: every campaign map now lives under `Maps\Campaign\Classic\<edition>\`, and
 * the old `Maps\FrozenThrone\Campaign\` / `Maps\Campaign\*.w3m` paths are gone (verified
 * against the 3.0.1 install: all four `vfs.exists` false). The maps themselves are the same
 * files, re-saved by the 3.0 editor — w3i v39 / editor build 7003 — which is also what keeps
 * them on the HD side of the flavour check (`compat/mapFormat.ts`), so the Reforged client can
 * still play them. The DLC-era credits roll (`WebUI\Credits\*.jpg`, `ETC_Credits.avi`) is a
 * 3.0 client feature this engine does not have; the map is what the button has always played.
 */
export function creditsMap(): string {
  if (isHd()) {
    return isRoc()
      ? "Maps\\Campaign\\Classic\\ROC\\WarCraftIIICredits.w3m"
      : "Maps\\Campaign\\Classic\\TFT\\War3XRegularCreditsIce.w3x";
  }
  return isRoc()
    ? "Maps\\Campaign\\WarCraftIIICredits.w3m"
    : "Maps\\FrozenThrone\\Campaign\\War3XRegularCreditsIce.w3x";
}

/** The racial cursor a campaign screen wears. From the file's own header comment:
 *  "Human = 0, Orc = 1, Undead = 2, Night Elf = 3." — and 3.0's DLC index adds 4 for the
 *  Forsaken (`[UndeadRE] Cursor=4`, and the install ships UI\Cursor\ForsakenCursor). */
export const CURSOR_RACES = ["Human", "Orc", "Undead", "NightElf", "Forsaken"] as const;
export type CursorRace = (typeof CURSOR_RACES)[number];

/** One entry of a campaign's mission list, or one of its three cinematics — both are the
 *  same shape in the file: `Header`, `Name`, `File`. */
export interface CampaignEntry {
  /** The small line above the name: "Chapter One", "Interlude", "Cinematic". */
  header: string;
  /** The entry's own title: "Rise of the Naga". */
  name: string;
  /**
   * What it plays, and it is not always a map:
   *   • a mission names a map inside the archives (`Maps\FrozenThrone\Campaign\*.w3x`);
   *   • a cinematic names a MOVIE (`IntroX` → Movies\IntroX.mpq — which, despite the
   *     extension, is a plain RIFF AVI, not an archive);
   *   • and Legacy of the Damned's finale, "A Long Time Coming", names a MODEL:
   *     `Doodads\Cinematic\ArthasIllidanFight\ArthasIllidanFight.mdl`, played in-engine.
   * Verified against the archives: every other MissionN file in the index resolves to a real
   * map, and that one resolves to a real .mdl.
   */
  file: string;
  /** From a `MissionN` key — a chapter of the campaign, rather than one of its three
   *  campaign-level cinematics. It is what the chapter's progress is counted by. */
  mission: boolean;
  /** The file is a MAP this engine can start. False for the movies and for the model finale. */
  playable: boolean;
  /** The file is a 3.0 DLC `.w3xd` — an encrypted container no reader here can open. It is
   *  listed so the campaign is visible, but it is never offered as playable. */
  encrypted: boolean;
}

export interface Campaign {
  /** The section name, and our stable id for it: "NightElf", "Human", "Undead", "Orc". */
  key: string;
  /** "Sentinels Campaign" — the small line over the campaign's name. */
  header: string;
  /** "Terror of the Tides". */
  name: string;
  /** Selectable from a fresh profile (`DefaultOpen=1`); the others unlock in list order. */
  defaultOpen: boolean;
  /** The war3skins key for the 3D backdrop, already resolved (`_V0`/`_V1`, by edition) to a model path. */
  background: string | null;
  /** The screen's distance fog, straight out of the campaign's `BackgroundFog*` keys. */
  fog: { style: number; r: number; g: number; b: number; a: number; density: number; start: number; end: number };
  /** Which race's cursor the screen wears. */
  cursor: CursorRace;
  /** An AmbienceSounds.slk row key — the loop under the campaign screen. */
  ambientSound: string | null;
  /** The campaign's chapters, in file order. */
  missions: CampaignEntry[];
  /** Every chapter is an encrypted 3.0 DLC map (`CampaignEntry.encrypted`). Such a campaign is
   *  listed as a catalogue entry: it is never gated behind the campaign before it, and its
   *  chapters are all shown (disabled) rather than hidden behind progress that cannot happen. */
  encrypted: boolean;
  /** Intro / Open / End cinematics, in the order the screen lists them (open first, at the
   *  top of the list, and end last — they bracket the missions). Empty keys are dropped. */
  intro: CampaignEntry | null;
  open: CampaignEntry | null;
  end: CampaignEntry | null;
  /** The downloadable `.w3n` this campaign's chapters were unlocked from, when the install has
   *  one (see `attachCampaigns`). Its bytes are where a chapter map is read from — the index's
   *  own `.w3xd` is encrypted and unreadable — and where the campaign's shared object data and
   *  imported art live. */
  archive?: CampaignArchive;
  /** A player-made campaign opened from a `.w3n` in the install's `Maps\Campaign\` folder
   *  (`customCampaignSources`), rather than a section of the game's own index. It is not part of
   *  the Campaign screen's shelf — the Custom Campaign screen is where it is listed. */
  custom?: boolean;
  /** A custom campaign's blurb, from its `.w3f`; the Custom Campaign screen shows it. */
  description?: string;
}

/** Read and parse the current edition's campaign index out of the mounted install. Returns []
 *  when the file isn't there. */
export async function loadCampaigns(vfs: DataSource): Promise<Campaign[]> {
  const skins = vfs.exists(WAR3SKINS)
    ? parseWar3Skins(new TextDecoder("latin1").decode(await vfs.read(WAR3SKINS)))
    : new Map<string, Map<string, string>>();
  // The war3skins key first (1.30 and older), then the edition's unversioned index, then 3.0's
  // per-art index. 3.0's war3skins has no `CampaignFile` entry at all, and neither
  // `CampaignStrings*` file survives there, so the last candidate is what actually answers.
  const file = [
    skinValue(skins, "Default", "CampaignFile" + skinVersionSuffix()),
    isRoc() ? ROC_CAMPAIGN_INDEX : CAMPAIGN_INDEX,
    isHd() ? REFORGED_CAMPAIGN_INDEX : CLASSIC_CAMPAIGN_INDEX,
  ].find((candidate): candidate is string => !!candidate && vfs.exists(candidate));
  // 3.0's DLC campaigns are SEPARATE index files (CampaignInfoDLC01.txt, and one per DLC
  // after it). They are appended to the base list in DLC-number order, which is where the
  // reference client shows them — after the four base campaigns.
  const dlc = vfs
    .list()
    .filter((path) => DLC_CAMPAIGN_INDEX.test(path))
    .sort((a, b) => dlcNumber(a) - dlcNumber(b));
  const files = file ? [file, ...dlc] : dlc;
  if (!files.length) return [];
  // war3skins spells the backdrop `.mdl` (the World Editor's own spelling); the archives ship
  // the compiled `.mdx`. Same swap as everywhere else a data file names a model
  // (render/dayNight.ts, mapViewer.ts) — without it the campaign screen has no background.
  // The unversioned lookup is what 3.0 answers: its war3skins dropped the `_V0`/`_V1` twins
  // along with the second edition, so `HumanBackdrop` is the only spelling there is.
  const resolveBackground = (key: string): string | null =>
    (skinValue(skins, "Default", key + skinVersionSuffix()) ?? skinValue(skins, "Default", key))
      ?.replace(/\.mdl$/i, ".mdx") ?? null;
  const resolveText = await loadCampaignStrings(vfs);
  const out: Campaign[] = [];
  for (const path of files) {
    const src = decodeGameText(await vfs.read(path));
    // The `RoC.` key prefix belongs to Reign of Chaos's OWN index, never to a DLC one.
    out.push(...parseCampaigns(src, resolveBackground, path === file && isRoc() ? "RoC." : "", resolveText));
  }
  await attachCampaigns(vfs, out);
  return out;
}

/**
 * Unlock the DLC campaigns whose chapters the install ALSO holds as a `.w3n`.
 *
 * 3.0's DLC index names encrypted `.w3xd` containers (see ENCRYPTED_MAP), so on the install
 * alone those campaigns are catalogue entries that can never be played. The same campaigns are
 * distributed as `.w3n` files — a whole campaign in one archive, chapter maps and all — and the
 * `Maps\Download\` folder is where a player's own copies live. When one is there, every chapter
 * the index names it by is unlocked: the index keeps the campaign's place in the list and the
 * chapter titles the client shows, while the archive supplies the map bytes.
 */
const DOWNLOADED_CAMPAIGN = /^Maps\\Download\\[^\\]+\.w3n$/i;

async function attachCampaigns(vfs: DataSource, campaigns: Campaign[]): Promise<void> {
  const paths = vfs.list().filter((path) => DOWNLOADED_CAMPAIGN.test(path));
  if (!paths.length) return;
  for (const path of paths) {
    let archive: CampaignArchive | null = null;
    try {
      archive = openCampaignArchive(await vfs.read(path), path);
    } catch (err) {
      console.warn(`[campaign] ${path} could not be read:`, err);
    }
    if (!archive) {
      console.warn(`[campaign] ${path} is not a readable .w3n campaign archive — ignored`);
      continue;
    }
    for (const c of campaigns) {
      let unlocked = 0;
      for (const mission of c.missions) {
        if (!mission.encrypted || !archive.find(mission.file)) continue;
        mission.encrypted = false;
        mission.playable = true;
        unlocked++;
      }
      if (!unlocked) continue;
      c.archive = archive;
      // Only once EVERY chapter is read: a campaign still holding one encrypted chapter is a
      // catalogue entry, not a playable one.
      if (!c.missions.some((mission) => mission.encrypted)) c.encrypted = false;
      // A DLC is not gated behind the campaigns before it — it is its own shelf, and the
      // player who downloaded it has bought it.
      c.defaultOpen = true;
      console.info(`[campaign] ${path} unlocked ${unlocked} chapter(s) of ${c.key}`);
    }
  }
}

/** Where player-made campaigns live: `Maps\Campaign\` — the folder the game already keeps its
 *  campaign maps in, so a custom campaign sits with them rather than among the melee maps. The
 *  `.w3n` itself never reaches a map list (`isCampaignArchive`), and `Maps\Download` stays what
 *  it was: the place a downloadable DLC campaign unlocks its chapters from (`attachCampaigns`). */
const CUSTOM_CAMPAIGN = /^Maps\\Campaign\\(?:[^\\]+\\)*[^\\]+\.w3n$/i;

/** One `.w3n` on the Custom Campaign shelf, before and after its archive has been opened. The
 *  file name is what the list shows until then: opening a campaign archive means reading the
 *  whole `.w3n` (a big campaign is hundreds of megabytes), so it waits for a pick. */
export interface CustomCampaignSource {
  /** Install path — `Maps\Campaign\Arthas Rise of the Lich King(EN).w3n`. */
  path: string;
  /** The Campaign's stable key, so a screen can remember which row was picked. */
  key: string;
  /** The file's own name, without the extension. */
  name: string;
  /** Open the archive and make it a Campaign (cached: the second pick is free). Null when the
   *  file is not a readable `.w3n`. */
  load(): Promise<Campaign | null>;
}

/** Open archives, by lowercased path — the Custom Campaign screen is remounted every time Back
 *  walks into it, and re-reading a 1 GB `.w3n` for the same pick is not a thing to do twice. */
const customCampaignCache = new Map<string, Campaign>();

/** Every `.w3n` in the install's `Maps\Campaign\` folder, in file order. */
export function customCampaignSources(vfs: DataSource): CustomCampaignSource[] {
  return vfs
    .list()
    .filter((path) => CUSTOM_CAMPAIGN.test(path))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => {
      let opening: Promise<Campaign | null> | null = null;
      return {
        path,
        key: customCampaignKey(path),
        // `vfs.list()` is lower-cased (the loose layer's keys), so the folder's own spelling is
        // asked for separately: the shelf prints "Arthas Rise of the Lich King(EN)", not the key.
        name: fileStem(vfs.displayName?.(path) ?? path),
        load: (): Promise<Campaign | null> => {
          const cached = customCampaignCache.get(path.toLowerCase());
          if (cached) return Promise.resolve(cached);
          opening ??= openCustomCampaign(vfs, path).then((c) => {
            if (c) customCampaignCache.set(path.toLowerCase(), c);
            return c;
          });
          return opening;
        },
      };
    });
}

function customCampaignKey(path: string): string {
  return `custom:${path.toLowerCase()}`;
}

function fileStem(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.[^.]*$/, "");
}

async function openCustomCampaign(vfs: DataSource, path: string): Promise<Campaign | null> {
  try {
    const archive = openCampaignArchive(await vfs.read(path), path);
    return archive ? campaignFromArchive(archive, path) : null;
  } catch (err) {
    console.warn(`[campaign] ${path} could not be read:`, err);
    return null;
  }
}

/** A `.w3n` as a Campaign: its chapters become missions, and every chapter starts UNENCRYPTED —
 *  the archive is the map, which is the whole difference from a 3.0 DLC catalogue entry. */
export function campaignFromArchive(archive: CampaignArchive, path: string): Campaign {
  const missions: CampaignEntry[] = archive.chapters.map((chapter, i) => ({
    header: `${i + 1}.`,
    name: chapter.name,
    file: chapter.file,
    mission: true,
    playable: true,
    encrypted: false,
  }));
  return {
    key: customCampaignKey(path),
    header: archive.author,
    name: archive.name || fileStem(path),
    defaultOpen: true,
    // No campaign-screen backdrop: a custom campaign's own `war3campBackdrop` art is addressed
    // from INSIDE the archive and the 3D menu cannot mount a model out of it. The chapter list
    // is what this shelf opens onto, and it wears the screen's ordinary backdrop.
    background: null,
    fog: { style: 0, r: 0, g: 0, b: 0, a: 0, density: 0, start: 0, end: 0 },
    cursor: "Human",
    ambientSound: null,
    missions,
    encrypted: false,
    intro: null,
    open: null,
    end: null,
    archive,
    custom: true,
    description: archive.description,
  };
}

/** The number in `CampaignInfoDLC01.txt`, for ordering the DLC list. */
function dlcNumber(path: string): number {
  const m = /dlc(\d+)\.txt$/i.exec(path);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

/** `UI\CampaignInfo*.txt` (3.0) names its rows with GlobalStrings keys; the older indexes write
 *  the words out. Filling the table covers both — a literal name is not a key, so it passes
 *  through untouched. Empty without an install (or on an install whose GlobalStrings we cannot
 *  read), which simply leaves those keys showing. */
async function loadCampaignStrings(vfs: DataSource): Promise<(key: string) => string> {
  if (!vfs.exists(GLOBAL_STRINGS)) return (key) => key;
  const strings = parseFdf(decodeGameText(await vfs.read(GLOBAL_STRINGS))).strings;
  return (key) => strings.get(key) ?? key;
}

/** The parse itself, split out so it can be run headlessly over the raw file. */
export function parseCampaigns(
  src: string,
  resolveBackground: (key: string) => string | null,
  /** Prepended to every campaign's key — `RoC.` for Reign of Chaos's file (see the header). */
  keyPrefix = "",
  /** Turns a Header/Name into words — 3.0 stores GlobalStrings keys there (see above). */
  resolveText: (key: string) => string = (key) => key,
): Campaign[] {
  const sections = parseSections(src);
  // Section names are matched CASE-INSENSITIVELY: 3.0's DLC index spells its `CampaignList`
  // entries `HumanRe`/`UndeadRe` while the sections above them are `[HumanRE]`/`[UndeadRE]`.
  const byName = new Map([...sections].map(([name, body]) => [name.toLowerCase(), body]));
  const list = splitValues(sections.get("Index")?.get("CampaignList") ?? "")
    .map(unquote)
    .filter((s) => s.length > 0); // TFT leaves the RoC campaigns' slots empty

  const out: Campaign[] = [];
  for (const key of list) {
    const s = sections.get(key) ?? byName.get(key.toLowerCase());
    if (!s) continue;
    const bg = unquote(s.get("Background") ?? "");
    const missions = parseMissions(s, resolveText);
    out.push({
      key: keyPrefix + key,
      header: resolveText(unquote(s.get("Header") ?? key)),
      name: resolveText(unquote(s.get("Name") ?? "")),
      defaultOpen: (s.get("DefaultOpen") ?? "0").trim() === "1",
      background: bg ? resolveBackground(bg) : null,
      fog: parseFog(s),
      cursor: CURSOR_RACES[clampCursor(s.get("Cursor"))],
      ambientSound: unquote(s.get("AmbientSound") ?? "") || null,
      missions,
      // 3.0's DLC campaigns: every chapter is an encrypted `.w3xd`, so nothing in this
      // campaign can be finished — which is why the menus must neither gate it behind the
      // campaign before it nor hide its chapters behind progress that can never happen.
      encrypted: missions.length > 0 && missions.every((m) => m.encrypted),
      intro: parseEntry(s.get("IntroCinematic"), resolveText),
      open: parseEntry(s.get("OpenCinematic"), resolveText),
      end: parseEntry(s.get("EndCinematic"), resolveText),
    });
  }
  return out;
}

/**
 * The rows the chapter screen shows for a campaign, top to bottom.
 *
 * The campaign's own cinematics bracket its missions: the Open cinematic plays before
 * chapter one (Terror of the Tides opens on "The Awakening") and the End one after the
 * last (Legacy of the Damned closes on "The Ascension"). An Intro cinematic — none of the
 * TFT four has one — sits above the Open.
 */
export function campaignRows(c: Campaign): CampaignEntry[] {
  return [c.intro, c.open, ...c.missions, c.end].filter((e): e is CampaignEntry => e !== null);
}

// --- the file format ---------------------------------------------------------------

/** `[Section]` blocks of `Key=Value`, `//` comments — the same shape as war3skins.txt. */
function parseSections(src: string): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>();
  let section = new Map<string, string>();
  // 1.31.1 ships the index with a UTF-8 BOM. `trim()` does not remove U+FEFF, and with it in
  // front `[Index]` never matches — the whole campaign list came out empty. Both spellings are
  // handled: the decoded BOM, and the three latin1 characters it becomes when a caller reads
  // the file byte-per-char (`tools/campaign-index-test.cjs` does).
  const text = src.replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, "");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      section = new Map();
      out.set(head[1].trim(), section);
      continue;
    }
    const eq = line.indexOf("=");
    if (eq > 0) section.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return out;
}

/** `Mission0`, `Mission1`, … in order, stopping at the first gap (the file numbers them
 *  contiguously; a gap means the campaign ended, not that we should keep scanning to 128). */
function parseMissions(s: Map<string, string>, resolveText: (key: string) => string): CampaignEntry[] {
  const out: CampaignEntry[] = [];
  for (let i = 0; ; i++) {
    const entry = parseEntry(s.get(`Mission${i}`), resolveText);
    if (!entry) break;
    out.push({ ...entry, mission: true });
  }
  return out;
}

/** `"Header","Name","File"` — plus, on one Bonus-campaign row, a fourth field
 *  (`Mission1=…,"…OrcX02.w3x",1`, the chapter that continues across OrcX02_02…_10). It
 *  selects nothing we present, so it is read and dropped rather than guessed at. */
function parseEntry(value: string | undefined, resolveText: (key: string) => string): CampaignEntry | null {
  if (!value) return null;
  const parts = splitValues(value).map(unquote);
  if (parts.length < 3 || !parts[2]) return null;
  const file = parts[2];
  const encrypted = ENCRYPTED_MAP.test(file);
  return {
    header: resolveText(parts[0]),
    name: resolveText(parts[1]),
    file,
    mission: false,
    playable: !encrypted && /\.w3[mx]$/i.test(file),
    encrypted,
  };
}

function parseFog(s: Map<string, string>): Campaign["fog"] {
  // BackgroundFogColor=A,R,G,B in 0..255 (Undead's 255,178,178,204 is the pale blue haze
  // over Northrend; Alliance's 255,127,51,51 the red one over Outland).
  const [a, r, g, b] = splitValues(s.get("BackgroundFogColor") ?? "255,255,255,255").map((v) => Number(v) || 0);
  return {
    style: Number(s.get("BackgroundFogStyle") ?? 0) || 0,
    a: a / 255, r: r / 255, g: g / 255, b: b / 255,
    density: Number(s.get("BackgroundFogDensity") ?? 0) || 0,
    start: Number(s.get("BackgroundFogStart") ?? 0) || 0,
    end: Number(s.get("BackgroundFogEnd") ?? 0) || 0,
  };
}

function clampCursor(v: string | undefined): number {
  const n = Number(v ?? 0);
  return Number.isInteger(n) && n >= 0 && n < CURSOR_RACES.length ? n : 0;
}

/** Split a comma-separated value, ignoring commas INSIDE quotes — "Chapter Seven, Part One"
 *  is one field, and splitting it naively would shift every field after it by one. */
function splitValues(value: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of value) {
    if (ch === '"') { quoted = !quoted; cur += ch; continue; }
    if (ch === "," && !quoted) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function unquote(s: string): string {
  const t = s.trim();
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1) : t;
}
