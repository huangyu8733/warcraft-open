import { parseWts } from "../jass/wts";
import { MpqDataSource } from "../vfs/mpq";
import type { DataSource } from "../vfs/types";

// A `.w3n` campaign archive, read as one object rather than as loose files.
//
// 3.0 ships its DLC campaigns INSIDE CASC encrypted (`.w3xd` — data/campaigns.ts), so the
// install alone can list a chapter but never open it. The campaign is also distributed as a
// `.w3n`: a plain MPQ whose root holds `war3campaign.w3f` (the chapter table), the campaign's
// custom objects (`war3campaign.w3u/.w3a/…`, shared by every chapter), its imported art under
// `war3campImported\`, and each chapter as a nested `.w3x`. A player who has one can play the
// campaign, and this is the reader that says what is inside it.
//
// The `.w3f` layout, as measured on 3.0's two DLC archives: a `u32` format version, a `u32`
// editor version, the campaign's own name/author/description/difficulty strings, a fixed run of
// flags and art paths (its menu background and minimap), and then the chapter table —
// `u32 count` followed by `count` records of `u32 open` + three NUL-terminated strings (name,
// description, map file). WHERE that table starts is not fixed (the header's art fields are
// variable-length), so the parse finds it: the offset whose count and records all stand up,
// every record's map being a real entry in the archive.

/** One chapter of a campaign archive: the words the chapter list shows and the map it plays. */
export interface CampaignChapter {
  /** The chapter's title, `TRIGSTR_nnn` already resolved through `war3campaign.wts`. */
  name: string;
  /** Its blurb, likewise resolved. Empty when the chapter has none. */
  description: string;
  /** The map INSIDE the archive — `HumanRE01.w3x`. */
  file: string;
}

/** A readable `.w3n`: the archive itself, its chapter table, and lookup by chapter name. */
export interface CampaignArchive {
  /** The install path the archive was read from, for diagnostics. */
  readonly label: string;
  /** The whole archive — chapter maps, imported art, the campaign's own data files. */
  readonly vfs: DataSource;
  readonly chapters: CampaignChapter[];
  /** The archive entry a chapter file refers to, or null. Compared on the bare file name so
   *  the campaign index's `Campaign\…\HumanRE01.w3xd` and a script's `HumanRE02.w3x` both
   *  answer — only the extension and the folder differ. */
  find(file: string): string | null;
  /** A chapter's bytes, by the entry name `find` returned. */
  read(file: string): Promise<Uint8Array>;
}

/** The bare name of a path, lowercased, without its extension — what chapters are matched on. */
function stem(file: string): string {
  const base = file.split(/[\\/]/).pop() ?? file;
  return base.replace(/\.[^.]*$/, "").toLowerCase();
}

/**
 * Open a `.w3n`. Returns null when the bytes are not a campaign archive (no `war3campaign.w3f`,
 * or no chapter the archive actually holds).
 */
export function openCampaignArchive(bytes: Uint8Array, label: string): CampaignArchive | null {
  const vfs = new MpqDataSource(label, bytes);
  const w3f = vfs.rawBytes("war3campaign.w3f");
  if (!w3f) return null;
  const resolveText = campaignStrings(vfs);
  const chapters = parseChapters(w3f, vfs, resolveText);
  if (!chapters.length) return null;
  // Every map in the archive, not just the chapters: a chapter's script names the places
  // INSIDE it (`SetNextLevelBJ("UndeadRE02_01.w3x")`), which the chapter table never lists.
  const byName = new Map<string, string>();
  for (const entry of vfs.list()) if (/\.w3[mx]$/i.test(entry)) byName.set(stem(entry), entry);
  for (const chapter of chapters) byName.set(stem(chapter.file), chapter.file);
  return {
    label,
    vfs,
    chapters,
    find: (file) => byName.get(stem(file)) ?? null,
    read: (file) => vfs.read(file),
  };
}

/** `war3campaign.wts` → a TRIGSTR resolver (identity when the archive has none). */
function campaignStrings(vfs: DataSource): (value: string) => string {
  const bytes = vfs.rawBytes("war3campaign.wts");
  if (!bytes) return (value) => value;
  // Written as UTF-8 by the 3.0 editor — the same as a map's own war3map.wts.
  const strings = parseWts(new TextDecoder("utf-8").decode(bytes));
  return (value) => {
    const m = /^TRIGSTR_(\d+)$/i.exec(value);
    return m ? strings.get(Number(m[1])) ?? value : value;
  };
}

/** A NUL-terminated window-1252 string. Null when the bytes run out or hold control characters
 *  — which is what makes the scan below reject a wrong offset rather than read garbage. */
function readString(bytes: Uint8Array, at: number): { text: string; next: number } | null {
  let text = "";
  for (let p = at; p < bytes.length; p++) {
    const byte = bytes[p];
    if (byte === 0) return { text, next: p + 1 };
    if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) return null;
    text += String.fromCharCode(byte);
  }
  return null;
}

/**
 * Find and read the chapter table.
 *
 * The scan is over offsets rather than straight past the header because the header is not a
 * fixed size: it carries the campaign's own strings and, on 3.0, a variable-length run of art
 * paths before the count. A candidate stands only when the count is sane AND every record parses
 * AND every record's map is an entry the archive holds — three independent checks, so a stray
 * `1` in the header cannot be mistaken for a one-chapter campaign.
 */
function parseChapters(
  bytes: Uint8Array,
  vfs: DataSource,
  resolveText: (value: string) => string,
): CampaignChapter[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 8; at + 4 <= bytes.length; at++) {
    const count = view.getUint32(at, true);
    if (count < 1 || count > 128) continue;
    let p = at + 4;
    const chapters: CampaignChapter[] = [];
    let ok = true;
    for (let i = 0; i < count; i++) {
      if (p + 4 > bytes.length) { ok = false; break; }
      const open = view.getUint32(p, true);
      p += 4;
      if (open > 1) { ok = false; break; }
      const name = readString(bytes, p);
      const description = name && readString(bytes, name.next);
      const file = description && readString(bytes, description.next);
      if (!name || !description || !file || !/\.w3[mx]$/i.test(file.text) || !vfs.exists(file.text)) {
        ok = false;
        break;
      }
      p = file.next;
      chapters.push({
        name: resolveText(name.text),
        description: resolveText(description.text),
        file: file.text,
      });
    }
    if (ok && chapters.length) return chapters;
  }
  return [];
}
