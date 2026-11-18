// The one place a logical asset path becomes bytes for the match's viewer — the "path solver"
// mdx-m3-viewer calls for every model and texture the scene loads (MapViewerScene.create).
//
// Three layers, first hit wins:
//
//   1. the running MAP's archive. A map's imported art (`war3mapImported\Santa.mdx` and the
//      textures it names) is inside the .w3x and nowhere else, and the search order puts the
//      map first — the viewer's own map handler does exactly that for the units the map PLACES
//      (`pathSolver` in handlers/w3x/map.js). Without this layer a pre-placed custom hero looked
//      right while every unit a trigger created or a shop sold came out with no model, no body
//      and so no command card at all (Test of Balance's drafted heroes). The audio half is
//      SoundBoard.mountMap.
//   2. the map's TILESET archive (issue #152). Cliff faces, water frames and ubersplats are one
//      path per set and one SET PER TILESET, told apart by the archive they sit in — see
//      vfs/tileset.ts. The viewer hands the tileset letter down with every load the map handler
//      makes, its own models and their textures included.
//   3. the install.
//
// Every path resolves to a STABLE, cached blob-url string — never a Promise<bytes>. This is the
// load-time win behind issue #14: the viewer only DEDUPES a resource when the solver hands it a
// string it can key its promiseMap/resourceMap on. A Promise (what `vfs.read()` returns) sends
// the load down the viewer's __DIRECT_LOAD path, which mints a unique id and parses a *fresh*
// resource EVERY call — so a map with hundreds of trees all referencing one LordaeronTree.mdx
// re-read and re-parsed that model once per tree, the dominant cost of map init. One blob url
// per path (tracked in `created` for revocation) means each shared model/texture is fetched
// once and parsed exactly once.

import type { DataSource } from "../vfs/types";
import { hdTexturePaths, tilesetOverlay } from "../vfs/tileset";
import { artCategoryEnabled, type ArtCategory } from "../data/artCategories";

/** Which Graphics-tab art category a path belongs to. The installed folder layout is what the
 *  game itself uses to separate them, so this is a reading of the path, not a guess at the art:
 *  commands/icons live under UI, spells and spawn models under Abilities/Objects/Splats, the
 *  world under Environment/Doodads/Terrain, and a unit path names Heroes or Buildings when it
 *  is one. Everything else is a unit. */
function artCategoryOf(path: string): ArtCategory {
  const p = path.toLowerCase();
  if (/\\ui\\|^ui\\|commandbuttons|pasbuttons/.test(p)) return "icons";
  if (/^abilities\\|\\abilities\\|^objects\\spawnmodels\\|^splats\\|\\splats\\|\\missile/.test(p)) return "vfx";
  if (/^environment\\|^doodads\\|^terrain\\|\\environment\\|\\doodads\\|\\terrain\\|\\cliff\\|\\water\\|\\tileset/.test(p)) return "environment";
  if (/\\heroes\\|\\hero\\|\\units\\nightelf\\hero/.test(p)) return "heroes";
  if (/\\buildings\\|\\building\\|\\units\\[^\\]+\\[^\\]*(hall|barracks|tower|mill|altar|lodge|temple|sanctum)/.test(p)) return "buildings";
  return "units";
}

/** May this path use the Reforged line? "Old Environment" is an ENABLE-OLD row: when it is on,
 *  the environment category is served from SD whatever `artEnvironment` says. */
function hdAllowedFor(path: string): boolean {
  const cat = artCategoryOf(path);
  if (cat === "environment" && artCategoryEnabled("envold")) return false;
  return artCategoryEnabled(cat);
}

/** The viewer calls the solver as (src, solverParams) — params carry the map's tileset letter
 *  once war3map.w3i is parsed. */
export type Solver = (src: unknown, params?: { tileset?: string }) => unknown;

/** What one path resolved to. `null` = absent; a string = a blob URL to fetch; a Promise is
 *  the async (HD, lazy art) case, and the viewer keys its dedupe map on the URL it resolves
 *  to, exactly as it does for a string (viewer.js `load`). */
type Resolved = string | Promise<string | null> | null;

/**
 * The 1.30/1.31 store files every spawn model in a folder of its OWN —
 * `Objects\Spawnmodels\Other\NPCBlood\NPCbloodVillagerWoman\NPCbloodVillagerWoman.mdx` — while
 * `Splats\SpawnData.slk` still names the 1.26 FLAT path for the same art
 * (`…\NPCBlood\NpcBloodVillagerWoman.mdl`). The flat path is therefore a moved model, not a
 * missing one, and these are the two places it can be instead.
 */
function movedSpawnModel(path: string): string[] {
  const m = /^objects\\spawnmodels\\(.*\\)([^\\]+?)(?:\.mdl|\.mdx)$/i.exec(path);
  if (!m) return [];
  const dir = `${m[1]}${m[2]}\\${m[2]}`;
  return [`${dir}.mdx`, `${dir}.mdl`];
}

/**
 * Three 3.0 ability rows name a model the store files somewhere else. Unlike `Splats\SpawnData`
 * (1.26 spelling of art 1.30 moved), these are mistakes in the Reforged data itself: the paths
 * are absent from BOTH the DE and HD modules as well as `War3.mpq`, and each basename exists
 * exactly once elsewhere — the Chen Stormstout missile under `Units\Creeps\`, the Stampede
 * death under its own prefixed name, Relentless Cleave under `Undead\` rather than `Human\`.
 */
function movedAbilityModel(path: string): string[] {
  const cut = path.lastIndexOf("\\");
  const dir = path.slice(0, cut + 1);
  const file = path.slice(cut + 1);
  if (/^ChenStormstoutFire_Missile\.mdx$/i.test(file)) return [`Units\\Creeps\\ChenStormstoutFire\\${file}`];
  if (/^MissileDeath\.mdx$/i.test(file) && /\\Stampede$/i.test(path.slice(0, cut))) return [`${dir}StampedeMissileDeath.mdx`];
  if (/^RelentlessCleaveTarget\.mdx$/i.test(file) && /\\Human\\RelentlessCleave$/i.test(path.slice(0, cut))) {
    return [path.replace(/\\Human\\/i, "\\Undead\\")];
  }
  return [];
}

/** The extra spellings the draw-time solver tries when an art row names a path that was moved
 *  to another folder (see `movedSpawnModel` / `movedAbilityModel`). Asked by the loading
 *  screen's "is this in the install" check so a path the solver can resolve is not warned
 *  about as missing — `Stampede\MissileDeath.mdx` is the one the prologue hit. */
export function movedModelCandidates(path: string): string[] {
  const logical = path.replace(/\//g, "\\");
  return [...movedSpawnModel(logical), ...movedAbilityModel(logical)];
}

/** The running map's archive, as the solver sees it. `epoch` moves on every mount, so a second
 *  map's `war3mapImported\x.mdx` is never handed the first map's bytes. */
export interface MapFileLayer {
  archive: DataSource | null;
  epoch: number;
}

/**
 * Does this MDX carry a GEOS chunk (i.e. anything to draw)? A 3.0 art module replaces a number
 * of SD missile/spell models with particle-only stubs — `BloodElfMissile.mdx` is 5904 B with
 * 2 geosets in `War3.mpq` but a 1956 B shell with none in `War3DE.mpq`/`War3HD.mpq` — and this
 * engine renders geosets, so such a model is invisible. Scanned chunk-by-chunk instead of
 * parsed: the solver runs before the viewer ever touches the file.
 *
 * True for anything that is not a well-formed MDLX (nothing to second-guess) and for a chunk
 * table that runs off the end: the fallback is a repair, not a policy.
 */
function mdxHasGeosets(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes[0] !== 0x4d || bytes[1] !== 0x44 || bytes[2] !== 0x4c || bytes[3] !== 0x58) return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 4;
  while (at + 8 <= bytes.length) {
    if (bytes[at] === 0x47 && bytes[at + 1] === 0x45 && bytes[at + 2] === 0x4f && bytes[at + 3] === 0x53) return true;
    const size = view.getUint32(at + 4, true);
    const next = at + 8 + size;
    if (next <= at || next > bytes.length) return true;
    at = next;
  }
  return false;
}

/**
 * The 3.0 unit Wisp's in-game model names `NightElf_Wisp_Ingame_Diffuse`, which the store ships as
 * the same fully transparent placeholder the entangled goldmine uses for the wisp hidden inside it
 * (every alpha texel is 0), so the unit draws as an invisible shell — its real Reforged look comes
 * from the PKB particle system (`SharedFX\Wisp\Wisp.pkb`), which this engine does not render yet.
 * The one opaque surface next to it is the portrait's `NightElf_Wisp_Diffuse` (the ghostly night
 * elf), so the shell borrows it: a small blue-white orb instead of nothing, and the swap goes away
 * once particles are drawn.
 */
function wispDiffuse(path: string): string {
  return /(^|\\)units\\nightelf\\wisp\\nightelf_wisp_ingame_diffuse\.(tif|tga|dds)$/i.test(path)
    ? path.replace(/_Ingame_Diffuse\./i, "_Diffuse.")
    : path;
}

/**
 * @param baseUrls the base SLKs, already minted before the viewer existed (and dropped from the
 *   map once the viewer has them).
 * @param created every blob URL minted, in order — the scene revokes them.
 * @param hd a Reforged mount (P3): textures live under `.dds` whatever the caller named, and
 *   the art is NOT preloaded, so a miss is `read()` asynchronously instead of answered now.
 */
export function createAssetSolver(vfs: DataSource, mapFiles: MapFileLayer, baseUrls: Map<string, string>, created: string[], hd = false): Solver {
  const blobUrls = new Map<string, Resolved>();
  // Two overlays, because a category can be switched back to SD while the rest stays HD.
  const overlayHd = tilesetOverlay(vfs, hd);
  const overlaySd = tilesetOverlay(vfs, false);
  // The tileset is a MAP-wide property, but only the map handler's own loads are handed it in
  // `params`; a MODEL's texture loads come back with no params at all. Remember the last letter
  // seen, so a cliff doodad's `ReplaceableTextures\Cliff\Cliff0` still finds the tileset's own
  // DE copy (`V_Cliff0.dds`) instead of falling through to an unresolved path (P3).
  let tileset: string | undefined;
  const mint = (key: string, bytes: () => Uint8Array | null, read: () => Promise<Uint8Array>): Resolved => {
    let url = blobUrls.get(key);
    if (url !== undefined) return url;
    const sync = bytes(); // MPQ decode is synchronous (mpq.ts); CASC preloads its tables too
    if (sync) {
      url = URL.createObjectURL(new Blob([sync as BlobPart]));
      blobUrls.set(key, url);
      created.push(url);
      return url;
    }
    // HD art: the bytes are still on disk (the caller already checked the path exists). Hand
    // back a Promise — the viewer awaits it and then keys its own fetch/dedupe caches on the
    // blob URL, so a shared model is still fetched once.
    url = read().then((data) => {
      const minted = URL.createObjectURL(new Blob([data as BlobPart]));
      blobUrls.set(key, minted);
      created.push(minted);
      return minted;
    }).catch(() => {
      blobUrls.set(key, null);
      return null;
    });
    blobUrls.set(key, url);
    return url;
  };
  /** One source + logical path, trying the HD extension spellings (P3-2). */
  const resolve = (source: DataSource, path: string, scope: string, hdOn = hd): Resolved => {
    for (const candidate of hdTexturePaths(path, hdOn)) {
      if (!source.exists(candidate)) continue;
      // 3.0's HD/DE art modules shadow some SD models with GEOS-less shells, and this engine
      // draws geosets only — so a model with no GEOS falls back to the base archive's copy
      // (`CascDataSource.baseBytes`, vfs/types.ts). SD and MPQ mounts have no `baseBytes` and
      // keep their old behaviour byte for byte.
      const base = hdOn && source.baseBytes && /\.mdx$/i.test(candidate) ? (p: string) => source.baseBytes!(p) : null;
      const drawable = (bytes: Uint8Array): boolean => !base || mdxHasGeosets(bytes);
      const url = mint(
        `${scope}:${candidate.toLowerCase()}`,
        () => {
          const bytes = source.rawBytes(candidate);
          // Not drawable ⇒ answer nothing here so `read()` below can try the base copy.
          return bytes && drawable(bytes) ? bytes : null;
        },
        async () => {
          const bytes = await source.read(candidate);
          if (drawable(bytes)) return bytes;
          const fallback = await base!(candidate).catch(() => null);
          return fallback ?? bytes; // a dead end still hands back the shell it found
        },
      );
      if (url) return url;
    }
    return null;
  };
  return (src, params) => {
    if (typeof src !== "string") return src; // in-memory loads pass through
    const logical = src.replace(/\//g, "\\");
    // The invisible line-of-sight blocker: 3.0 still names a model the Reforged install does
    // not ship, and the unit is invisible by design. Answering "nothing" keeps the viewer from
    // fetching the bare path and logging "Source has no matching handler" once per blocker.
    if (/[\\/]LOSBlocker[\\/]IntentionallyLeftBlank\.md[xl]$/i.test(logical)) return undefined;
    const map = mapFiles.archive;
    if (map) {
      const url = resolve(map, logical, `map${mapFiles.epoch}`);
      if (url) return url;
    }
    // Graphics tab: a category switched back to Classic is served from the SD spelling even
    // when the install is a Reforged one (the mount still holds the SD archives).
    const useHd = hd && hdAllowedFor(logical);
    const overlay = useHd ? overlayHd : overlaySd;
    const { key, source, path } = overlay(wispDiffuse(logical), params?.tileset ?? tileset);
    if (params?.tileset) tileset = params.tileset;
    const cached = useHd ? baseUrls.get(key) : undefined;
    if (cached) return cached; // preloaded base SLKs
    const url = resolve(source, path, "install", useHd);
    if (url) return url; // string ⇒ the viewer caches+dedupes by this url
    // A flat spawn-model path is 1.26 naming for art 1.30 moved into a folder of its own.
    for (const alt of movedSpawnModel(path)) {
      const moved = resolve(source, alt, "install", useHd);
      if (moved) return moved;
    }
    // …and three Reforged ability rows simply name the wrong folder (see movedAbilityModel).
    for (const alt of movedAbilityModel(path)) {
      const moved = resolve(source, alt, "install", useHd);
      if (moved) return moved;
    }
    // …and a few of those models were dropped outright (there is no
    // NightElfBloodHeroMoonPriestess anywhere in the 1.30 or 1.31 store). Handing the path back
    // makes the viewer fetch it as a URL, get the page itself, and log "Source has no matching
    // handler" on EVERY death; answering with nothing skips the effect in silence.
    if (movedSpawnModel(path).length) return undefined;
    return src;
  };
}
