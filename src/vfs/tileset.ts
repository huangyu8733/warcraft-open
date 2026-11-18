import { MpqDataSource } from "./mpq";
import type { DataSource } from "./types";

/**
 * The tileset overlay — the per-tileset archive a map's art is layered with (issue #152).
 *
 * Warcraft III ships a set of cliff faces, water frames and building ubersplats PER TILESET,
 * and every one of those sets is filed under the SAME logical path: the Sunken Ruins cliff and
 * the Lordaeron Summer cliff are both `ReplaceableTextures\Cliff\Cliff0.blp`, and
 * `TerrainArt\CliffTypes.slk` has only the one `texDir`/`texFile` to name them with. What tells
 * them apart is the ARCHIVE they sit in: war3.mpq carries a nested MoPaQ per tileset letter and
 * the engine mounts the one the loaded map names on top of everything else — which is why a
 * tileset is a map-level property rather than a per-tile one.
 *
 * 1.30.4 kept that split in the CASC root exactly as it kept the MPQ names (src/vfs/casc.ts).
 * The entries read
 *
 *     War3.mpq:Z.mpq:ReplaceableTextures\Cliff\Cliff0.blp
 *
 * so in the mounted store a tileset's own copy is reachable at `Z.mpq:<path>` while the
 * unprefixed path is the default. Seventeen letters carry cliffs and water; `L` carries
 * neither, because the unprefixed default IS Lordaeron Summer's — which is why Echo Isles
 * always looked right and Circumvention (tileset `Z`, Sunken Ruins) drew Lordaeron dirt cliffs
 * in a jungle.
 *
 * What each tileset archive holds, verified against the retail 1.30.4 store: the two cliff
 * textures, the 45 water frames, the nine ubersplats every race's town centre stamps, and the
 * two or three creep skins the game re-tints per tileset (the bear, the war eagle, the
 * quillbeast). So this is not a cliff rule with a cliff-shaped exception list — it is one
 * overlay, and anything the tileset has its own copy of comes from it.
 *
 * The RoC-era naming is still in the install and is NOT the same art: `Deprecated.mpq` (the
 * archive whose whole job is paths old custom maps hard-reference) keeps twelve of the
 * eighteen tilesets' cliffs as `ReplaceableTextures\Cliff\<letter>_Cliff0.blp`, a few kilobytes
 * apart from the live copy each time and absent for every tileset The Frozen Throne added
 * (I, J, K, O, Z). It stays here as the last rung, for an install old enough to have only that.
 */

/** Where a path's bytes come from once the map's tileset has had its say. */
export interface TilesetFile {
  /** A stable, unique cache key — the overlay's own path when the tileset has its own copy. */
  key: string;
  /** The source holding it… */
  source: DataSource;
  /** …and the path within that source. */
  path: string;
}

/** The extensions a Reforged store renames art to. A model says `.tif` (DE/HD) or keeps the
 *  SD-era `.blp` (glue models, effect textures); the store ships `.dds` for both. `.png` is in
 *  the list because HeroAnya's emissive map still names one while the store holds `.dds`. */
const TEXTURE_EXT = /^(.*)\.(tif|blp|dds|png)$/i;
/** …and the model half of the same rename: 3.0's data still names effect models with the
 *  SD-era `.mdl` (`Abilities\Spells\Items\AIhe\AIheTarget.mdl`, the town portal's caster and
 *  target, every ability's `Targetart`), while the store ships `.mdx` only. Unmatched, the
 *  solver hands the viewer a path nothing can load and the effect never appears. */
const MODEL_EXT = /^(.*)\.(mdl|mdx)$/i;

/**
 * Some Reforged models name their art with the artist's own disk path — the Goldmine's
 * emissive map literally reads
 * `C:/Users/ksizemore/Box/Classic Games/Warcraft3/assets/Art/HD//Buildings/Other/Goldmine/Neutral_GoldMine_Emissive.tif`.
 * Everything after the last `/HD/` (or `/SD/`) is the path the store actually uses; for any
 * other absolute path, the basename is the only part that can be meant.
 */
export function storedTexturePath(path: string): string {
  // A PopcornFX `.pkb` names its textures with the art MODULE prefix the bake was authored
  // against — `_HD.w3mod/Textures/FX/Shockwave/ShockwaveSoft01_BW.tif` — while the store keeps
  // the same file without that prefix and as `.dds`. Strip it before the extension rewrite
  // (`hdTexturePaths`) runs.
  const modulePrefix = /^_[a-z]{2}\.w3mod[\\/]+/i;
  if (modulePrefix.test(path)) return path.replace(modulePrefix, "").replace(/\//g, "\\");
  // An ABSOLUTE path is the artist's own disk path: everything after the art variant segment
  // (`/HD/`, `/SD/`, `/DE/`) is what the store uses. DE also appears in model paths (P6:
  // `…/art/de/buildings/undead/crypt/cryptbirth.mdx`, `h:/bz/de//buildings/undead/ubirth/ubirth.mdx`),
  // so the variant list has three entries — but only for absolute paths, where `de` is an art
  // root and not a directory a custom map might legitimately own.
  const absolute = /^[a-z]:[\\/]/i.test(path) || path.startsWith("/");
  const afterVariant = (absolute
    ? /^[\s\S]*[\\/](?:hd|sd|de)[\\/]+([\s\S]*)$/i
    : /^[\s\S]*[\\/](?:hd|sd)[\\/]+([\s\S]*)$/i).exec(path);
  if (afterVariant) return afterVariant[1].replace(/\//g, "\\");
  if (absolute) {
    return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
  }
  return path;
}

/**
 * Two critter models still name SD-era texture paths that the Reforged store files elsewhere.
 *
 * `Sheep.mdx` / `Sheep_portrait.mdx` ask for `Units\Critters\Sheep\Sheep_Corpse_*.tif`, but the
 * DE and HD stores keep those maps at `Textures\Sheep_Corpse_*.dds`. `FlyingSheep.mdx` asks for
 * `Units\Critters\FlyingSheep\Unit_FlyingSheep_main_*.tif`: HD has that name in the same folder,
 * while DE's copy is the parallel `Sheep_*.dds` beside it. Without these two moves the viewer
 * logs "Source has no matching handler" for six textures (P6, Booty Bay).
 */
function relocatedHdTexture(stored: string): string[] {
  // Models usually spell their texture paths with forward slashes, and `storedTexturePath`
  // leaves a relative path exactly as written — so the split has to accept both separators,
  // or the basename checks below never see a basename.
  const cut = Math.max(stored.lastIndexOf("\\"), stored.lastIndexOf("/"));
  const file = cut >= 0 ? stored.slice(cut + 1) : stored;
  const m = TEXTURE_EXT.exec(file);
  if (!m) return [];
  const base = m[1];
  const dir = cut >= 0 ? stored.slice(0, cut + 1) : "";
  const out: string[] = [];
  // Corpses and gore: the models name them beside the body, the Reforged stores keep them in
  // the shared `Textures\` folder (`MakruraPooldweller_Corpse_*`, `Undead_CryptFiend_Corpse_*`,
  // `Gore_*` — nine DE models, all six basenames).
  if (/^(?:MakruraPooldweller_Corpse_|Undead_CryptFiend_Corpse_|Gore_)/i.test(base)) out.push(`Textures\\${base}.dds`);
  // `TornadoElemental(_Portrait)` still asks for `TornadoBound_Diffuse`, a name no module ships:
  // the bound body's maps sit beside it as `TornadoMain_*` (the art rename never reached the
  // model). Its other slots keep the SD names normal/ORM/Black32, so this is the only gap.
  const bound = /^TornadoBound_(Diffuse|Normal|ORM|Emissive)$/i.exec(base);
  if (bound) out.push(`${dir}TornadoMain_${bound[1]}.dds`);
  if (/^Sheep_Corpse_/i.test(base)) out.push(`Textures\\${base}.dds`);
  if (/^Unit_FlyingSheep_main_/i.test(base)) {
    out.push(`Units\\Critters\\FlyingSheep\\${base}.dds`);
    out.push(`Units\\Critters\\FlyingSheep\\${base.replace(/^Unit_FlyingSheep_main_/i, "Sheep_")}.dds`);
  }
  return out;
}

/**
 * The paths one texture may actually be stored under, in the order to try.
 *
 * SD is always `[path]` — an SD install has no `.dds` at all, so nothing may change there.
 * On HD the same asset is `.dds` whatever the caller named, and `.blp` is the last resort
 * (a few base-module effect textures were never converted). This is the whole of P3-2.
 */
export function hdTexturePaths(path: string, hd: boolean): string[] {
  if (!hd) return [path];
  const stored = storedTexturePath(path);
  const model = MODEL_EXT.exec(stored);
  if (model) {
    const base = model[1];
    const out = model[2].toLowerCase() === "mdx" ? [stored, `${base}.mdl`] : [`${base}.mdx`, stored];
    // Campaign maps add per-stage building models by appending a digit to the stock name
    // (`buildings\orc\Beastiary\Beastiary2.mdx`, PigFarm0/1/2, WarMill0/1, …). The Reforged
    // install ships only the unsuffixed model, so each of those loads failed and the building
    // never drew. The base building is the same art at an earlier stage — fall back to it.
    if (/\d$/.test(base)) out.push(`${base.replace(/\d+$/, "")}.mdx`);
    return out;
  }
  const m = TEXTURE_EXT.exec(stored);
  if (!m) return [stored];
  const base = m[1];
  const ext = m[2].toLowerCase();
  // A texture the Reforged artists re-authored ships ONLY as the `_Diffuse` variant while the
  // data still names the bare basename: every DE ground texture is
  // `TerrainArt\LordaeronCapital\Lordc_SlabBricks_Diffuse.dds`, but `Terrain.slk` asks for
  // `Lordc_SlabBricks.dds` (and `CliffTypes.slk` asks for `Misc\Alpha_Cliff0.dds`). Before the
  // fallback, those paths missed in the DE module and the map drew the base module's SD BLP
  // (wrong colours) or nothing at all (black/checkerboard ground). Try the diffuse spelling
  // before the SD-era one — a basename that already names a map is left alone.
  const diffuse = /_(diffuse|normal|orm|emissive)$/i.test(base) ? [] : [`${base}_Diffuse.dds`];
  // The cliff MODELS (replaceable id 11) still name `ReplaceableTextures\Cliff\Cliff0.blp`,
  // but DE ships those two only as `Cliff0Legacy_Diffuse.dds` / `Cliff0Legacy_Normal.dds`.
  // Without this the model load failed and the map never left the loading screen. The map
  // handler replaces the texture with the tileset's own cliff art afterwards, so this copy is
  // only what lets the model resolve at all.
  const legacyCliff = /^ReplaceableTextures[\\/]Cliff[\\/]Cliff[01]$/i.test(stored)
    ? [`${base}Legacy_Diffuse.dds`, `${base}Legacy.dds`]
    : [];
  if (ext === "dds") return [stored, ...diffuse, ...legacyCliff, `${base}.blp`, ...relocatedHdTexture(stored)];
  return [`${base}.dds`, ...diffuse, ...legacyCliff, stored, ...relocatedHdTexture(stored)];
}

/**
 * A resolver over one mounted install. Cheap to call: every answer is memoized per
 * (tileset, path), because the caller is an asset path solver on the hot load path.
 */
export function tilesetOverlay(vfs: DataSource, hd = false): (path: string, tileset?: string) => TilesetFile {
  const memo = new Map<string, TilesetFile>();
  /** A nested `<letter>.mpq`, opened once, for an install that keeps them as real files. */
  const nested = new Map<string, DataSource | null>();

  const archive = (letter: string): DataSource | null => {
    let source = nested.get(letter);
    if (source === undefined) {
      const name = `${letter}.mpq`;
      const bytes = vfs.exists(name) ? vfs.rawBytes(name) : null;
      source = bytes ? new MpqDataSource(name, bytes) : null;
      nested.set(letter, source);
    }
    return source;
  };

  return (path, tileset) => {
    const letter = tileset?.[0]?.toUpperCase() ?? "";
    if (letter < "A" || letter > "Z") return { key: path, source: vfs, path };
    const memoKey = `${letter}|${hd ? "hd|" : ""}${path.toLowerCase()}`;
    let hit = memo.get(memoKey);
    if (hit) return hit;

    const candidates = hdTexturePaths(path, hd);
    for (const candidate of candidates) {
      const prefixed = `${letter}.mpq:${candidate}`;
      if (vfs.exists(prefixed)) {
        // 1.30.4 / 3.0: the tileset archives are flattened into the store under their own names.
        hit = { key: prefixed, source: vfs, path: prefixed };
        memo.set(memoKey, hit);
        return hit;
      }
    }
    const own = archive(letter);
    if (own) {
      for (const candidate of candidates) {
        if (own.exists(candidate)) {
          // MPQ-era: the tileset archive is a real nested MoPaQ inside the mounted one.
          hit = { key: `${letter}.mpq:${candidate}`, source: own, path: candidate };
          memo.set(memoKey, hit);
          return hit;
        }
      }
    }
    // RoC-era naming: `<letter>_` beside the default — and in Reforged's DE art this is the
    // LIVE spelling (`ReplaceableTextures\Cliff\V_Cliff0.dds`), with the unprefixed name gone
    // entirely. So try the HD extension spellings here too, not just the name as given.
    if (/\\cliff\\[^\\]+$/i.test(path)) {
      for (const candidate of candidates) {
        const deprecated = candidate.replace(/([^\\]+)$/, `${letter}_$1`);
        if (vfs.exists(deprecated)) {
          hit = { key: deprecated, source: vfs, path: deprecated };
          memo.set(memoKey, hit);
          return hit;
        }
      }
    }
    hit = { key: path, source: vfs, path };
    memo.set(memoKey, hit);
    return hit;
  };
}
