import { decodeBlte, decodeBlteAsync, isBlte } from "./blte";
import { type DataSource, type LoadProgress, normalizeMpqPath } from "./types";
import { setGameLocale } from "./gameLocale";
import { currentLocale } from "../i18n";

/**
 * CASC — the storage a Warcraft III 1.30+ install uses in place of MPQ archives (issue #102).
 *
 * The MPQ-era install we started on is four MoPaQ files; 1.30.4's `Data/` folder is Blizzard's
 * NGDP content store, and NOTHING in it is addressed by name. Four indirections stand between
 * a path and its bytes, and all four have to be walked before the first file can be read:
 *
 *   `.build.info`   a `|`-separated table beside the exe. Its Build Key names…
 *   build config    …a `key = value` text file under `Data/config/<xx>/<yy>/<hash>`, which
 *                   names the `root` and the `encoding` file by content key.
 *   encoding        CKey (what a file's contents hash to) → EKey (what its STORED form hashes
 *                   to). Content addressing is the whole point: two files with identical bytes
 *                   are one entry, which is why the eleven locales cost far less than 11×.
 *   `.idx`          EKey (first 9 bytes) → (data file, offset, length). Sixteen buckets, and
 *                   each bucket is versioned — `0000000009.idx` and `000000000a.idx` are the
 *                   same bucket and only the higher one is live.
 *
 * The bytes at that offset are a 30-byte record header followed by a BLTE payload (blte.ts).
 *
 * Warcraft III's ROOT is a plain-text listing, one line per file:
 *
 *     War3.mpq:Units/UnitData.slk|bd17648d524aaab3d54f4d3affe58613|
 *     enUS-War3Local.mpq:UI/CampaignStrings_exp.txt|ebbf1847…|enUS
 *
 * — which is to say 1.30 kept the MPQ layering in NAME even after dropping the format. The
 * archives it names are `Deprecated.mpq` (art old custom maps still reference), `War3.mpq`
 * (everything shared) and one `<locale>-War3Local.mpq`, and they layer in that order, exactly
 * as war3.mpq < war3x.mpq < war3xlocal.mpq did (profiles.ts). Verified against the retail
 * 1.30.4 build: the three sets are disjoint but for two files, so the order barely bites —
 * but it is the order the paths themselves imply, so it is the one we mount.
 *
 * A campaign map is the one thing that does NOT survive the move: `Maps/.../OrcX01.w3x` is
 * not a blob in CASC, it is ~22 root entries of the form `…OrcX01.w3x:war3map.j`. The map got
 * flattened into the store along with everything else. `openArchive()` puts it back together
 * as a DataSource, which is all any caller ever wanted from those bytes anyway.
 */

/** A file read in ranges rather than whole: a picked `File`, or the dev server's HTTP reader.
 *  `data.000` is a gigabyte — reading it whole to reach a 4 KB .slk is not an option. */
export interface ByteReader {
  readonly size: number;
  slice(start: number, end: number): Promise<Uint8Array>;
}

/** A `File` (or any Blob) as a ByteReader. */
export function fileReader(file: Blob): ByteReader {
  return {
    size: file.size,
    slice: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
  };
}

/** The pieces of a CASC storage a mount needs, as gathered by the install picker. */
export interface CascFiles {
  /** Text of `.build.info`. */
  buildInfo: string;
  /** `Data/config/**` — hash → file text. Only a handful of these are ever read. */
  config: Map<string, string>;
  /** `Data/data/*.idx` — file name → bytes (32 × 64 KB). */
  idx: Map<string, Uint8Array>;
  /** `Data/data/data.NNN` — NNN → reader. */
  data: Map<number, ByteReader>;
}

/** True when a picked folder is a 1.30+ CASC install rather than an MPQ-era one. */
export function isCascInstall(files: CascFiles | null): files is CascFiles {
  return !!files && files.buildInfo.length > 0 && files.data.size > 0 && files.idx.size > 0;
}

// ---------------------------------------------------------------------------
// The four indirections
// ---------------------------------------------------------------------------

/** One `.build.info` row, by column name. The file is a header row of `Name!TYPE:size`
 *  followed by one row per installed branch; the active branch is the one we want. */
export function parseBuildInfo(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error(".build.info: no branch rows");
  const columns = lines[0].split("|").map((c) => c.split("!")[0].trim());
  const rows = lines.slice(1).map((l) => {
    const cells = l.split("|");
    return new Map(columns.map((c, i) => [c, cells[i] ?? ""]));
  });
  return rows.find((r) => r.get("Active") === "1") ?? rows[0];
}

/**
 * The version string of the ACTIVE branch — "1.30.4.11274" on the install Warcraft Open targets.
 *
 * `.build.info` is the only file in a CASC store that says which build it is, and it says it in
 * plain text before anything is mounted, which is what makes it usable as a gate (src/vfs/version.ts).
 * Null when the file is absent or carries no such column.
 */
export function buildInfoVersion(text: string): string | null {
  try {
    return parseBuildInfo(text).get("Version") || null;
  } catch {
    return null; // not a `.build.info` at all
  }
}

/** A build/CDN config: `key = value`, `#` comments. Values with two hashes are `CKey EKey`. */
export function parseConfig(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq > 0) out.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return out;
}

/** Where one stored file sits: which `data.NNN`, at what offset, how many bytes. */
interface Location {
  archive: number;
  offset: number;
  /** Includes the 30-byte record header that precedes the BLTE payload. */
  size: number;
}

/** The 30-byte record header in front of every BLTE payload inside a `data.NNN`. */
const RECORD_HEADER = 30;

/**
 * The local index: EKey → Location. Sixteen buckets, each shipped as `<bucket><version>.idx`,
 * and only the highest version of a bucket is live — mounting a stale one resolves keys to
 * offsets that were reused by a later patch, which reads as corrupt data rather than as a
 * missing file.
 */
export function parseIndex(idx: Map<string, Uint8Array>): Map<string, Location> {
  const live = new Map<number, { version: number; bytes: Uint8Array }>();
  for (const [name, bytes] of idx) {
    const m = /^([0-9a-f]{2})([0-9a-f]{8})\.idx$/i.exec(name);
    if (!m) continue;
    const bucket = parseInt(m[1], 16);
    const version = parseInt(m[2], 16);
    const prev = live.get(bucket);
    if (!prev || version > prev.version) live.set(bucket, { version, bytes });
  }

  const out = new Map<string, Location>();
  for (const { bytes } of live.values()) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerSize = view.getUint32(0, true);
    // header: version(2) bucket(1) extra(1) spanSize(1) spanOffset(1) key(1) segmentBits(1)
    const spanSizeBytes = bytes[8 + 4];
    const spanOffsetBytes = bytes[8 + 5];
    const keyBytes = bytes[8 + 6];
    const segmentBits = bytes[8 + 7];
    // The entry block is aligned to 16 from the start of the file, not merely padded to the
    // header's own size — 8 + 16 lands on 24 and the entries actually begin at 32.
    let p = (8 + headerSize + 15) & ~15;
    const entriesSize = view.getUint32(p, true);
    p += 8; // size + hash
    const entryLength = keyBytes + spanOffsetBytes + spanSizeBytes;
    const segment = 2 ** segmentBits;
    for (const end = p + entriesSize; p + entryLength <= end; p += entryLength) {
      // The span offset is BIG-endian and 40 bits wide: the top bits pick the data file, the
      // low `segmentBits` are the offset inside it.
      let span = 0;
      for (let i = 0; i < spanOffsetBytes; i++) span = span * 256 + bytes[p + keyBytes + i];
      const size = view.getUint32(p + keyBytes + spanOffsetBytes, true);
      if (size === 0) continue; // a freed entry
      out.set(hex(bytes, p, keyBytes), {
        archive: Math.floor(span / segment),
        offset: span % segment,
        size,
      });
    }
  }
  return out;
}

/** CKey → the EKey its bytes are stored under. (The e-key half of the file is not read: we
 *  never need to go the other way.) */
export function parseEncoding(bytes: Uint8Array): Map<string, string> {
  if (bytes[0] !== 0x45 || bytes[1] !== 0x4e) throw new Error("encoding: bad magic (want 'EN')");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const cKeySize = bytes[3];
  const eKeySize = bytes[4];
  const pageKB = view.getUint16(5); // c-key page size, in KB
  const pageCount = view.getUint32(9);
  const especSize = view.getUint32(18);
  // 22 = the header, then the ESpec string block, then a page index we don't need (each page
  // is self-describing), then the pages themselves.
  const pages = 22 + especSize + pageCount * (cKeySize + 16);
  const pageSize = pageKB * 1024;

  const out = new Map<string, string>();
  for (let i = 0; i < pageCount; i++) {
    const start = pages + i * pageSize;
    for (let p = start; p + 6 + cKeySize <= start + pageSize; ) {
      const keyCount = bytes[p]; // 0 = the page's entries are done (pages are zero-padded)
      if (keyCount === 0) break;
      out.set(hex(bytes, p + 6, cKeySize), hex(bytes, p + 6 + cKeySize, eKeySize));
      p += 6 + cKeySize + keyCount * eKeySize;
    }
  }
  return out;
}

function hex(bytes: Uint8Array, at: number, length: number): string {
  let s = "";
  for (let i = at; i < at + length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/** A file's own EKey is 16 bytes; the index is keyed by the first 9. */
const INDEX_KEY_HEX = 18;

// ---------------------------------------------------------------------------
// The root listing
// ---------------------------------------------------------------------------

/** Mount order, LOWEST priority first — the CASC spelling of profiles.ts's archive list.
 *  `%s` stands in for the install's locale. */
const ARCHIVE_ORDER = ["Deprecated.mpq", "War3.mpq", "%s-War3Local.mpq"] as const;

/** Which art set a store is mounted for. `sd` is 1.30.4 and every MPQ-era folder; `hd`/`de`
 *  are Reforged 3.0's two parallel art sub-modules (see `data/flavor.ts` `hdArt`). */
export type CascGraphics = "sd" | "hd" | "de";

/** The archive names the two Reforged art sub-modules become (see `legacyRootName`). */
const ART_ARCHIVE: Record<"hd" | "de", string> = { hd: "War3HD.mpq", de: "War3DE.mpq" };
const ART_LOCAL_ARCHIVE: Record<"hd" | "de", string> = {
  hd: "%s-War3HDLocal.mpq",
  de: "%s-War3DELocal.mpq",
};

/** The locale archives a Warcraft III install can carry; a given install ships exactly one. */
const LOCALES = ["enUS", "deDE", "esES", "frFR", "itIT", "koKR", "plPL", "ruRU", "zhCN", "zhTW"];

/** Files big enough — and rare enough per session — that they are read on demand instead of
 *  being held in memory. Audio and video are 1.3 GB of a 1.6 GB install and every one of them
 *  is fetched through the ASYNC `read()` (audio/sounds.ts decodes into an AudioBuffer), so
 *  nothing sync ever asks for them. A whole MAP is the same (1.31 stores its campaign chapters
 *  as blobs, a few MB each, read once through `readMapBytes`); 1.30.4 has none — its maps are
 *  exploded and their entries end in `war3map.j` and the like. Everything else preloads; see
 *  `CascDataSource.preload`. */
const STREAMED = /\.(wav|mp3|avi|flac|ogg|w3m|w3x)$/i;

/** The Reforged art left on disk even when a mount preloads everything else (P3). 17.4 GB of
 *  DDS/MDX is what makes a Reforged install un-preloadable; the solver reads each one through
 *  the async path the first time a scene asks for it (render/assetSolver.ts). `.blp` and the
 *  fonts stay IN — 3 MB of SD art the base module still names, and 69 MB of type. */
const LAZY_ART = /\.(dds|mdx|mdl|png|jpg|jpeg|tga|webm|w3xd|pkb|bls)$/i;

/** Art the DOM reads SYNCHRONOUSLY (`rawBytes`) or before the first frame, even on a lazy mount.
 *  The FDF console, the map browser, cursors and the command-card icons all decode through
 *  `rawBytes`, which cannot wait for `read()`; the building-foundation splats are built into
 *  canvases at map load. Keeping only those trees costs ~230 MiB compressed on 3.0 (UI 95, the
 *  command-card/team-colour/shadow icons 103, splats ~30) instead of holding 1.4 GB of scenery
 *  and unit DDS that the asset solver reads asynchronously the first time a scene asks.
 *
 *  `PathTextures` is here for GAMEPLAY, not for the DOM: every doodad's and building's blocking
 *  footprint is decoded from its `.tga` (sim/destructibles.ts), and the map's pathing grid is
 *  stamped synchronously before the first sim tick. On a lazy mount `rawBytes` answered null for
 *  those 209 files, so no tree, rock or map building got a footprint and units walked through
 *  them — a Reforged-only divergence (SD mounts are never lazy). They are a few hundred KB. */
const EAGER_ART = /^(?:ui|pathtextures|environment\\dnc|replaceabletextures\\(?:commandbuttons|commandbuttonsdisabled|passivebuttons|teamcolor|shadows|splats|selection))\\/i;

/** A model, as opposed to the other lazy art: the only file `rawBytes` is asked for a second
 *  time after `read()` has fetched it — by the sound board, for the SND events inside it. */
const MODEL_FILE = /\.(mdx|mdl)$/i;
/** ~a melee match's whole unit, building and effect set. FIFO, like the decoded table. */
const MODEL_BYTES_BUDGET = 64 * 1024 * 1024;

/** One root line: `<archive>:<path>|<ckey>|<locale>`, or an unprefixed installer file. */
interface RootEntry {
  /** The logical path in MPQ form (`Units\UnitData.slk`), original case. */
  path: string;
  ckey: string;
}

/** 1.31's sub-mods that were nested MPQs inside `War3.mpq` in 1.30 (`War3.mpq:Z.mpq:…`), by the
 *  name 1.30 gave them. The tilesets are `_Tilesets/<letter>.w3mod` → `<letter>.mpq`. */
const W3MOD_NESTED: Record<string, string> = {
  "_low.w3mod": "War3_low.mpq",
  "_med.w3mod": "War3_med.mpq",
  "_teen.w3mod": "T.mpq",
};

/** The archive the store's own melee maps are filed under when they are blobs (1.31): not
 *  mounted — they are the install's `Maps\` folder (`CascDataSource.storeMaps`). */
const STORE_MAPS = "Maps";

/**
 * A 1.31 root name in the 1.30.4 spelling, or null for one 1.30.4 has no place for.
 *
 * 1.31.0 replaced the archive NAMES with one `War3.w3mod` tree of sub-mods (docs/casc.md,
 * "1.31.1"), and that is the build the Internet Archive keeps — the mirror "Download game
 * files" falls back on (src/assets/downloadInstall.ts). The content is the same shape, so the
 * whole move is a renaming, measured off both builds' roots:
 *
 *   War3.w3mod:<p>                                      → War3.mpq:<p>
 *   War3.w3mod:_Locales/enUS.w3mod:<p>                  → enUS-War3Local.mpq:<p>
 *   War3.w3mod:_Deprecated.w3mod:<p>                    → Deprecated.mpq:<p>
 *   War3.w3mod:_Balance/Melee_V0.w3mod:<p>              → War3.mpq:Melee_V0/<p>   (and the locale's)
 *   War3.w3mod:_Tilesets/Z.w3mod:<p>                    → War3.mpq:Z.mpq:<p>      (and _Low/_Med/_Teen)
 *   War3.w3mod:Campaign/FrozenThrone/OrcX01.w3x         → War3.mpq:Maps/FrozenThrone/Campaign/OrcX01.w3x
 *   War3.w3mod:Maps/(2)BootyBay.w3m                     → the install's Maps\ folder
 *
 * The two map rows are the only ones that are not pure renames: 1.31 keeps a map as ONE blob
 * where 1.30.4 exploded it (`…OrcX01.w3x:war3map.j`), which `readMapBytes` already takes. A
 * chapter is filed under BOTH spellings (joined by CAMPAIGN_ALIAS), because 1.31's own
 * `UI\CampaignStrings_exp.txt` names the new one and that file is wording we leave alone.
 * Every other name passes through unchanged, so a 1.30.4 root is untouched.
 *
 * 3.0 (Reforged) keeps the 1.31 tree and adds two PARALLEL ART SUB-MODULES at the same paths
 * the base module names:
 *
 *   War3.w3mod:_HD.w3mod:<p>                            → War3HD.mpq:<p>
 *   War3.w3mod:_DE.w3mod:<p>                            → War3DE.mpq:<p>
 *   War3.w3mod:_DE.w3mod:_Locales/zhCN.w3mod:<p>        → zhCN-War3DELocal.mpq:<p>
 *   War3.w3mod:_DE.w3mod:_Tilesets/Z.w3mod:<p>          → War3DE.mpq:Z.mpq:<p>
 *
 * The base module still carries the SD art, so mounting ONE art module on top is what makes
 * an HD match draw HD. `graphics` says which one — the other module, and both on an SD
 * install, is null (never mounted). The tileset stays a `Z.mpq:`-prefixed path inside
 * whichever module it came from, so the art module's tileset wins over the base's copy by
 * mount order and `vfs/tileset.ts` goes on looking it up under one name.
 */
/** Separates a campaign chapter's 1.30.4 path from its 1.31 one in what `legacyRootName`
 *  returns — `|` is the root's own field separator, so no path can contain it. */
const CAMPAIGN_ALIAS = "|War3.mpq:";

export function legacyRootName(name: string, graphics: CascGraphics = "sd"): string | null {
  if (!/^war3\.w3mod:/i.test(name)) return name;
  const parts = name.split(":").slice(1);
  let archive = "War3.mpq";

  // Reforged's parallel art module. `sd` never mounts one, and an HD client mounts only the
  // set it was asked for — the other stays invisible even though the root lists it.
  const art = /^_(hd|de)\.w3mod$/i.exec(parts[0] ?? "");
  let layer: "hd" | "de" | null = null;
  if (art) {
    if (graphics === "sd") return null;
    layer = art[1].toLowerCase() as "hd" | "de";
    if (layer !== graphics) return null;
    archive = ART_ARCHIVE[layer];
    parts.shift();
  }

  const locale = /^_locales\/(\w{4})\.w3mod$/i.exec(parts[0] ?? "");
  if (locale && parts.length > 1) {
    const loc = `${locale[1].slice(0, 2)}${locale[1].slice(2).toUpperCase()}`;
    archive = layer
      ? ART_LOCAL_ARCHIVE[layer].replace("%s", loc)
      : `${loc}-War3Local.mpq`;
    parts.shift();
  }
  if (parts.length > 1) {
    const sub = parts[0].toLowerCase();
    const balance = /^_balance\/(custom_v0|custom_v1|melee_v0|melee_v1)\.w3mod$/.exec(sub);
    const tileset = /^_tilesets\/(\w)\.w3mod$/.exec(sub);
    if (sub === "_deprecated.w3mod" && archive === "War3.mpq") {
      archive = "Deprecated.mpq";
      parts.shift();
    } else if (balance) {
      const set = parts[0].slice("_Balance/".length, -".w3mod".length);
      parts.splice(0, 2, `${set}/${parts[1]}`);
    } else if (tileset) {
      parts[0] = `${tileset[1].toUpperCase()}.mpq`;
    } else if (W3MOD_NESTED[sub]) {
      // The art modules carry a `_Teen` twin (`_HD.w3mod:_Teen.w3mod:…`): the censored
      // alternate art. It is not a resolution variant of what we draw, so it stays out.
      if (layer && sub === "_teen.w3mod") return null;
      parts[0] = W3MOD_NESTED[sub];
    } else if (sub.startsWith("_")) {
      return null; // a sub-mod 1.30.4 never had
    }
  }
  if (archive === "War3.mpq" && parts.length === 1) {
    const campaign = /^campaign\/(frozenthrone\/)?(.*)$/i.exec(parts[0]);
    if (campaign) return `War3.mpq:Maps/${campaign[1] ? "FrozenThrone/" : ""}Campaign/${campaign[2]}${CAMPAIGN_ALIAS}${parts[0]}`;
    if (/^maps\//i.test(parts[0])) return `${STORE_MAPS}:${parts[0]}`;
  }
  return [archive, ...parts].join(":");
}

export function parseRoot(text: string, graphics: CascGraphics = "sd"): Map<string, RootEntry[]> {
  const byArchive = new Map<string, RootEntry[]>();
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const bar = line.indexOf("|");
    if (bar < 0) continue;
    const renamed = legacyRootName(line.slice(0, bar), graphics);
    if (renamed === null) continue;
    const [name, alias] = renamed.split(CAMPAIGN_ALIAS);
    const colon = name.indexOf(":");
    if (colon < 0) continue; // an installer file (the exes, the .app bundles) — not game data
    const archive = name.slice(0, colon);
    const ckey = line.slice(bar + 1, line.indexOf("|", bar + 1));
    let list = byArchive.get(archive);
    if (!list) byArchive.set(archive, (list = []));
    // The rest of the name keeps its inner `:` separators: a campaign map's contents are
    // `Maps/…/OrcX01.w3x:war3map.j`, and openArchive() finds them by that prefix.
    list.push({ path: name.slice(colon + 1).replace(/\//g, "\\"), ckey });
    if (alias) list.push({ path: alias.replace(/\//g, "\\"), ckey });
  }
  return byArchive;
}

// ---------------------------------------------------------------------------
// The DataSource
// ---------------------------------------------------------------------------

/** How many decoded bytes to keep around. A decoded install is ~585 MB, which is more than
 *  the compressed 291 MB we already hold, so decoded files are a CACHE and not the store. */
const DECODED_BUDGET = 96 * 1024 * 1024;

/** Reads are coalesced into runs: entries this close together are fetched in one slice, since
 *  one 8 MB read beats two hundred 40 KB reads by far more than the skipped bytes cost. */
const COALESCE_GAP = 256 * 1024;

interface Entry {
  ckey: string;
  location: Location;
  /** Preloaded BLTE payload (record header already stripped), or null while streamed. */
  raw: Uint8Array | null;
}

/** How a Reforged store is mounted (P3). A 1.30.4 / MPQ-era install passes nothing. */
export interface CascOpenOptions {
  /** Which art module to layer over the base: `de`/`hd` mount `_DE`/`_HD`; `sd` mounts neither. */
  graphics?: CascGraphics;
  /** Leave the heavyweight art (models, DDS, video, fonts' companions) on disk and read it
   *  through the ASYNC `read()` — a Reforged install holds ~17 GB of it (see `LAZY_ART`). */
  lazyArt?: boolean;
}

export class CascDataSource implements DataSource {
  readonly label: string;
  /** Lower-cased logical path → entry. Built lowest-archive-first so a later layer wins. */
  private entries = new Map<string, Entry>();
  /** Path as the root spells it, for `list()`. */
  private names: string[] = [];
  /** What the base archives (`Deprecated` / `War3` / locale) had for a path an art module
   *  (`War3HD` / `War3DE`) overrode. Kept because 3.0's modules replace some SD missile and
   *  spell models with particle-only shells that this engine cannot draw — see `baseBytes`. */
  private baseEntries = new Map<string, Entry>();
  private decoded = new Map<string, Uint8Array>();
  private decodedBytes = 0;
  /** Lazy art (P3) that has been read ONCE, kept so a SYNCHRONOUS reader can still find it.
   *
   *  An HD mount leaves every `.mdx` on disk (LAZY_ART) and answers `rawBytes` with null until
   *  `read()` has fetched it — but `rawBytes` is exactly how `resolveModelSounds` parses a
   *  unit's model mid-combat, to find the SND events its attack and its building hammer are
   *  written in. On 3.0 every one of those sounds was therefore silent: the Peasant's
   *  `SNDXAREP` never resolved, the rifle's `SNDXKRIF` never resolved. The bytes are already in
   *  hand by then — the scene read the same file to draw the unit — so keep the models a match
   *  has loaded. Bounded, FIFO, models only (textures are never read synchronously). */
  private modelBytes = new Map<string, Uint8Array>();
  private modelBytesTotal = 0;

  private constructor(
    label: string,
    private data: Map<number, ByteReader>,
  ) {
    this.label = label;
  }

  /** The archives that resolved, lowest priority first — what the gate reports as "mounted". */
  mounted: string[] = [];
  /** The `<locale>-War3Local.mpq` this store carries (vfs/gameLocale.ts mirrors it for the UI). */
  locale = "";
  /** What each of those archives contributes, in the same order. The merged view above keeps
   *  only the winner of each path, so this is the only record of who owns and who overrides —
   *  which is what the extractor's override report is (tools/extract-data.mjs). */
  private contents: Array<{ archive: string; paths: string[] }> = [];

  archiveContents(): Array<{ archive: string; paths: string[] }> {
    return this.contents;
  }

  static async open(
    files: CascFiles,
    onProgress?: LoadProgress,
    opts: CascOpenOptions = {},
  ): Promise<CascDataSource> {
    const graphics = opts.graphics ?? "sd";
    const info = parseBuildInfo(files.buildInfo);
    const buildKey = info.get("Build Key");
    if (!buildKey) throw new Error(".build.info: no Build Key");
    const configText = files.config.get(buildKey.toLowerCase());
    if (!configText) throw new Error(`build config ${buildKey} is missing from Data/config`);
    const build = parseConfig(configText);

    const index = parseIndex(files.idx);
    if (index.size === 0) throw new Error("Data/data holds no usable .idx entries");

    const source = new CascDataSource(
      `casc[${info.get("Version") ?? "unknown"}]`,
      files.data,
    );

    // Bootstrap: encoding is named by EKey directly, so it can be read before we have the
    // CKey→EKey table that everything else needs.
    onProgress?.("Reading the content index…");
    const encodingEKey = (build.get("encoding") ?? "").split(" ")[1];
    if (!encodingEKey) throw new Error("build config names no encoding file");
    const encoding = parseEncoding(
      await source.readLocation(index.get(encodingEKey.slice(0, INDEX_KEY_HEX)), "encoding"),
    );

    const rootCKey = (build.get("root") ?? "").split(" ")[0];
    const rootEKey = encoding.get(rootCKey);
    if (!rootEKey) throw new Error("the encoding table has no entry for the root file");
    const rootText = new TextDecoder("latin1").decode(
      await source.readLocation(index.get(rootEKey.slice(0, INDEX_KEY_HEX)), "root"),
    );

    const byArchive = parseRoot(rootText, graphics);
    if (graphics !== "sd") {
      // Index the OTHER Reforged module's own archives too, so `mount` can use it as a gap
      // filler (see there). parseRoot filters by graphics, which is why it is asked a second
      // time — but only the art-module archives are merged, never a second copy of the base.
      const sibling: "hd" | "de" = graphics === "de" ? "hd" : "de";
      const localTail = ART_LOCAL_ARCHIVE[sibling].replace("%s", "");
      for (const [name, list] of parseRoot(rootText, sibling)) {
        if (name !== ART_ARCHIVE[sibling] && !name.endsWith(localTail)) continue;
        const have = byArchive.get(name);
        if (have) have.push(...list);
        else byArchive.set(name, list);
      }
    }
    const locale = pickLocale(info, byArchive, encoding, index);
    // The front end dresses itself in this locale's art (the logo's zhCN/zhTW plate, the
    // spacing rules) and its in-game strings come from the same module, so remember it once.
    setGameLocale(locale);
    source.locale = locale;
    source.mount(byArchive, encoding, index, locale, graphics);
    await source.preload(onProgress, opts.lazyArt === true);
    return source;
  }

  /** Fold the root's archives into one path→entry map, in mount order. */
  private mount(
    byArchive: Map<string, RootEntry[]>,
    encoding: Map<string, string>,
    index: Map<string, Location>,
    locale: string,
    graphics: CascGraphics,
  ): void {
    const order: string[] = ARCHIVE_ORDER.map((template) => template.replace("%s", locale));
    const baseCount = order.length;
    // The art module sits ON TOP of the base and its locale: same paths, HD art. `sd` has no
    // module to mount, which is why a 1.30.4 install's order is byte-for-byte what it was.
    let fillFrom = order.length;
    if (graphics === "hd" || graphics === "de") {
      order.push(ART_ARCHIVE[graphics], ART_LOCAL_ARCHIVE[graphics].replace("%s", locale));
      // The OTHER Reforged module is still Reforged art, and a few assets live in only one of
      // the two: DE's Phoenix body maps (`Human_Phoenix_Main_*` / `Human_Phoenix_Egg_*`) are in
      // War3HD.mpq, while HD has no model at all for DE-only campaign units. Mount it LAST, as a
      // gap-filler — it may only supply paths the chosen module does not hold, so it can never
      // repaint an asset the current one ships.
      fillFrom = order.length;
      const sibling: "hd" | "de" = graphics === "de" ? "hd" : "de";
      order.push(ART_ARCHIVE[sibling], ART_LOCAL_ARCHIVE[sibling].replace("%s", locale));
    }
    for (let i = 0; i < order.length; i++) {
      const archive = order[i];
      const list = byArchive.get(archive);
      if (!list) continue;
      const fillOnly = i >= fillFrom;
      const paths: string[] = [];
      for (const { path, ckey } of list) {
        const ekey = encoding.get(ckey);
        const location = ekey && index.get(ekey.slice(0, INDEX_KEY_HEX));
        // A root entry with no local index entry is content this install did not download
        // (another platform's, or an optional locale). It is not an error; it is absent.
        if (!location) continue;
        const key = path.toLowerCase();
        if (fillOnly && this.entries.has(key)) continue;
        if (!this.entries.has(key)) this.names.push(path);
        else if (i >= baseCount && !this.baseEntries.has(key)) {
          // The art module is shadowing a base file. Remember the base entry: DE/HD overwrite
          // some SD missile/teleport models with particle-only shells (`BloodElfMissile.mdx`
          // is 5904 B with 2 geosets in War3.mpq and a 1956 B, GEOS-less stub in War3DE.mpq),
          // and the renderer asks back for the base bytes when a model has no geosets.
          this.baseEntries.set(key, this.entries.get(key)!);
        }
        this.entries.set(key, { ckey, location, raw: null });
        paths.push(path);
      }
      if (paths.length > 0) {
        this.mounted.push(archive);
        this.contents.push({ archive, paths });
      }
    }
    if (this.entries.size === 0) {
      throw new Error("no Warcraft III archives in this CASC storage — is Data/ complete?");
    }
    for (const { path, ckey } of byArchive.get(STORE_MAPS) ?? []) {
      const ekey = encoding.get(ckey);
      const location = ekey && index.get(ekey.slice(0, INDEX_KEY_HEX));
      if (location) this.maps.set(`${STORE_MAPS}\\${path.replace(/^maps\\/i, "")}`, location);
    }
  }

  /** The melee and scenario maps the store itself holds as blobs (1.31 — a 1.30.4 store has
   *  none, its installer copies them out to a loose `Maps\` folder), keyed as the install's own
   *  `Maps\` files are ("Maps\FrozenThrone\(2)EchoIsles.w3x"). */
  private maps = new Map<string, Location>();

  /**
   * Those maps as the install's `Maps\` folder: `File`s to their callers, read off the store
   * only when one is opened — the same honest stub `lazyMapFile` is for the desktop app, since
   * reading two hundred maps to LIST them is the thing being avoided.
   */
  storeMaps(): Map<string, File> {
    const out = new Map<string, File>();
    for (const [key, location] of this.maps) {
      let bytes: Promise<ArrayBuffer> | null = null;
      const load = (): Promise<ArrayBuffer> =>
        (bytes ??= this.readLocation(location, key).then((b) => b.slice().buffer as ArrayBuffer));
      const stub = {
        name: key.split("\\").pop() ?? key,
        size: 0,
        type: "",
        lastModified: 0,
        webkitRelativePath: key,
        arrayBuffer: load,
        bytes: async () => new Uint8Array(await load()),
        text: async () => new TextDecoder().decode(await load()),
        slice: (start?: number, end?: number) => new Blob([]).slice(start, end),
        stream: () => new Blob([]).stream(),
      };
      out.set(key, stub as unknown as File);
    }
    return out;
  }

  /**
   * Pull every non-streamed file into memory, compressed, in one sequential sweep.
   *
   * The VFS contract has a SYNCHRONOUS `rawBytes()` (vfs/types.ts) and half the engine reads
   * through it — the SLK tables, the fonts, the cursors, and `resolveModelSounds` parsing an
   * .mdx mid-combat. A Blob can only be read asynchronously, so the bytes have to be here
   * before the first caller asks. Compressed, that is ~291 MB for a 1.30.4 install, which is
   * less than the ~1 GB the four MPQs already cost us; the 1.3 GB of audio and video is what
   * we leave on disk, because every one of those goes through the async path.
   */
  private async preload(onProgress?: LoadProgress, lazyArt = false): Promise<void> {
    // Unique by location: the eleven locales share most of their content, and even inside one
    // locale `Units\MiscData.txt` and `Melee_V0\Units\MiscData.txt` are one stored file.
    const wanted = new Map<string, Location>();
    for (const [key, entry] of this.entries) {
      if (STREAMED.test(key)) continue;
      // …and, on a Reforged mount, the art: `read()` fetches it on demand, one file at a time,
      // and the solver caches the blob URL it minted so a shared model is fetched once.
      if (lazyArt && LAZY_ART.test(key) && !EAGER_ART.test(key)) continue;
      wanted.set(`${entry.location.archive}:${entry.location.offset}`, entry.location);
    }

    const byArchive = new Map<number, Location[]>();
    let total = 0;
    for (const location of wanted.values()) {
      let list = byArchive.get(location.archive);
      if (!list) byArchive.set(location.archive, (list = []));
      list.push(location);
      total += location.size;
    }

    const store = new Uint8Array(total);
    const at = new Map<string, Uint8Array>();
    let written = 0;
    let done = 0;

    for (const [archive, list] of byArchive) {
      const reader = this.data.get(archive);
      if (!reader) continue;
      list.sort((a, b) => a.offset - b.offset);
      for (let i = 0; i < list.length; ) {
        // Grow a run while the next entry is close enough that reading the gap is cheaper
        // than issuing a second read.
        let end = list[i].offset + list[i].size;
        let j = i + 1;
        while (j < list.length && list[j].offset - end <= COALESCE_GAP) {
          end = Math.max(end, list[j].offset + list[j].size);
          j++;
        }
        const runStart = list[i].offset;
        const run = await reader.slice(runStart, Math.min(end, reader.size));
        for (let k = i; k < j; k++) {
          const record = run.subarray(list[k].offset - runStart, list[k].offset - runStart + list[k].size);
          // Most records carry a 30-byte header before the BLTE stream; a few 3.0 assets
          // (`.mrf` cinematic models, some locale strings) are stored with the BLTE at the
          // record's first byte. The magic says which — see `readLocation`.
          const payload = record.subarray(isBlte(record) ? 0 : RECORD_HEADER);
          store.set(payload, written);
          at.set(`${archive}:${list[k].offset}`, store.subarray(written, written + payload.length));
          written += payload.length;
        }
        done += j - i;
        i = j;
        onProgress?.(`Loading game data… ${Math.round((done / wanted.size) * 100)}%`, done / wanted.size);
      }
    }

    for (const entry of this.entries.values()) {
      entry.raw = at.get(`${entry.location.archive}:${entry.location.offset}`) ?? null;
    }
  }

  /** Read one stored file's BLTE payload straight off the data file (no cache). */
  private async readLocation(location: Location | undefined, label: string): Promise<Uint8Array> {
    if (!location) throw new Error(`${this.label}: ${label} is not in the local index`);
    const reader = this.data.get(location.archive);
    if (!reader) throw new Error(`${this.label}: ${label} wants data.${location.archive}`);
    const raw = await reader.slice(location.offset, location.offset + location.size);
    // A record normally starts with a 30-byte header, then `BLTE`; a handful of 3.0 assets put
    // the `BLTE` stream at the record's first byte. The magic tells the two apart.
    // The async decoder inflates off the main thread — see `decodeBlteAsync`. This is the path
    // every Reforged model and texture takes, and the inflate is the largest block of main-thread
    // work between two frames once the scene starts streaming art in.
    return decodeBlteAsync(raw.subarray(isBlte(raw) ? 0 : RECORD_HEADER), label);
  }

  private remember(key: string, bytes: Uint8Array): Uint8Array {
    if (this.decodedBytes + bytes.length > DECODED_BUDGET) {
      // Plain FIFO. The access pattern is "read a table once, then never again", so a real
      // LRU would buy nothing over dropping whatever came first.
      for (const [k, v] of this.decoded) {
        this.decoded.delete(k);
        this.decodedBytes -= v.length;
        if (this.decodedBytes + bytes.length <= DECODED_BUDGET) break;
      }
    }
    this.decoded.set(key, bytes);
    this.decodedBytes += bytes.length;
    return bytes;
  }

  /** Keep a model the async path fetched, for the synchronous reader that wants it later.
   *  FIFO under MODEL_BYTES_BUDGET: a match loads each unit's model once, so the working set
   *  is stable and eviction only reaches models that are not in play. */
  private rememberModel(key: string, bytes: Uint8Array): void {
    if (this.modelBytes.has(key)) return;
    if (this.modelBytesTotal + bytes.length > MODEL_BYTES_BUDGET) {
      for (const [k, v] of this.modelBytes) {
        this.modelBytes.delete(k);
        this.modelBytesTotal -= v.length;
        if (this.modelBytesTotal + bytes.length <= MODEL_BYTES_BUDGET) break;
      }
    }
    this.modelBytes.set(key, bytes);
    this.modelBytesTotal += bytes.length;
  }

  exists(path: string): boolean {
    return this.entries.has(normalizeMpqPath(path).toLowerCase());
  }

  rawBytes(path: string): Uint8Array | null {
    const key = normalizeMpqPath(path).toLowerCase();
    const cached = this.decoded.get(key) ?? this.modelBytes.get(key);
    if (cached) return cached;
    const entry = this.entries.get(key);
    // `raw` is null for the streamed files (audio, video). Those are read through `read()`,
    // and nothing in the engine reaches for one synchronously.
    if (!entry?.raw) return null;
    return this.remember(key, decodeBlte(entry.raw, path));
  }

  async read(path: string): Promise<Uint8Array> {
    const key = normalizeMpqPath(path).toLowerCase();
    const cached = this.decoded.get(key);
    if (cached) return cached;
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`${this.label}: file not found: ${path}`);
    if (entry.raw) return this.remember(key, await decodeBlteAsync(entry.raw, path));
    // Streamed: a ranged read, and deliberately NOT cached — these are the megabyte files,
    // and their callers (audio/sounds.ts) keep their own decoded copies.
    const bytes = await this.readLocation(entry.location, path);
    // …except a MODEL: the synchronous reader (resolveModelSounds) needs it back (see modelBytes).
    if (MODEL_FILE.test(key)) this.rememberModel(key, bytes);
    return bytes;
  }

  /**
   * The base archive's bytes for a path the mounted art module overrode, or null. A read of its
   * own: the renderer only asks when the module's copy turned out to be a drawable nothing
   * (zero geosets), so it is a handful of files per match and needs no cache of its own.
   * Deliberately does NOT touch `decoded`/`modelBytes` — the caller keeps the bytes it mints.
   */
  async baseBytes(path: string): Promise<Uint8Array | null> {
    const entry = this.baseEntries.get(normalizeMpqPath(path).toLowerCase());
    if (!entry) return null;
    if (entry.raw) return decodeBlteAsync(entry.raw, path);
    return this.readLocation(entry.location, path);
  }

  list(): string[] {
    return this.names;
  }

  /**
   * A map that CASC stores exploded rather than as a `.w3x` blob — every campaign chapter.
   * Returns a DataSource over the entries filed under `<path>:`, or null if this install has
   * no such map. (An MPQ source has no exploded maps at all, so it does not implement this.)
   */
  openArchive(path: string): DataSource | null {
    const prefix = `${normalizeMpqPath(path).toLowerCase()}:`;
    const inner = new Map<string, string>();
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) inner.set(key.slice(prefix.length), key);
    }
    if (inner.size === 0) return null;
    return new CascSubArchive(path.split("\\").pop() ?? path, this, inner);
  }
}

/** One exploded map, presented as if it were the archive it used to be. Its own paths are
 *  relative (`war3map.j`); it forwards to the store under the full `<map>:<inner>` key. */
class CascSubArchive implements DataSource {
  constructor(
    readonly label: string,
    private store: CascDataSource,
    /** relative lower-cased name → the store's key. */
    private inner: Map<string, string>,
  ) {}

  private key(path: string): string | undefined {
    return this.inner.get(normalizeMpqPath(path).toLowerCase());
  }

  exists(path: string): boolean {
    return this.key(path) !== undefined;
  }

  rawBytes(path: string): Uint8Array | null {
    const key = this.key(path);
    return key ? this.store.rawBytes(key) : null;
  }

  async read(path: string): Promise<Uint8Array> {
    const key = this.key(path);
    if (!key) throw new Error(`${this.label}: file not found: ${path}`);
    return this.store.read(key);
  }

  list(): string[] {
    return [...this.inner.keys()];
  }
}

/**
 * Which `<locale>-War3Local.mpq` (1.31) / `_Locales/<locale>.w3mod` (3.0) this mount reads.
 *
 * A Reforged store can carry SEVERAL locale modules — one install, every language, picked in
 * the game's own options — so unlike a classic per-language install there is no "Chinese
 * folder" or "English folder" to choose between. The engine's UI language (default zhCN, see
 * i18n/index.ts) is the player's signal, so a module for it wins when the store has one; then
 * the build's own Tags claim; then the module with the most files (an install may only have
 * downloaded part of a locale); and zhCN last, because Reforged defaults to Chinese.
 */
function pickLocale(
  info: Map<string, string>,
  byArchive: Map<string, RootEntry[]>,
  encoding: Map<string, string>,
  index: Map<string, Location>,
): string {
  const present = (locale: string): number => {
    const list = byArchive.get(`${locale}-War3Local.mpq`);
    if (!list) return 0;
    let n = 0;
    for (const { ckey } of list) {
      const ekey = encoding.get(ckey);
      if (ekey && index.has(ekey.slice(0, INDEX_KEY_HEX))) n++;
    }
    return n;
  };
  const preferred = currentLocale();
  if (present(preferred) > 0) return preferred;
  const tagged = LOCALES.find((l) => (info.get("Tags") ?? "").includes(l));
  if (tagged && present(tagged) > 0) return tagged;
  let best = "zhCN";
  let bestCount = present(best);
  for (const locale of LOCALES) {
    const n = present(locale);
    if (n > bestCount) {
      best = locale;
      bestCount = n;
    }
  }
  return best;
}
