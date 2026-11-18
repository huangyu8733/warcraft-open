import { vec3, quat } from 'gl-matrix';
import unique from '../../../common/arrayunique';
import War3Map from '../../../parsers/w3x/map';
import War3MapW3i from '../../../parsers/w3x/w3i/file';
import War3MapW3e from '../../../parsers/w3x/w3e/file';
import Corner from '../../../parsers/w3x/w3e/corner';
import War3MapW3u from '../../../parsers/w3x/w3u/file';
import War3MapW3d from '../../../parsers/w3x/w3d/file';
import ModificationTable from '../../../parsers/w3x/w3u/modificationtable';
import MdlxModel from '../../../parsers/mdlx/model';
import { MappedData, MappedDataRow } from '../../../utils/mappeddata';
import Scene from '../../scene';
import Grid from '../../grid';
import { PathSolver } from '../../handlerresource';
import Texture from '../../texture';
import MdxModel from '../mdx/model';
import MdxModelInstance from '../mdx/modelinstance';
import getCliffVariation from './variations';
import TerrainModel from './terrainmodel';
import Unit from './unit';
import Doodad from './doodad';
import War3MapViewer from './viewer';
import War3MapDoo from '../../../parsers/w3x/doo/file';
import War3MapUnitsDoo from '../../../parsers/w3x/unitsdoo/file';
import { Resource } from '../../resource';

const normalHeap1 = vec3.create();
const normalHeap2 = vec3.create();

/**
 * OpenWar3: look a MappedData row up ignoring case, the way the engine's own string-hashed
 * tables do. The index is built once per table and cached on it, so a map whose palette is
 * spelled correctly never pays for it.
 */
function rowIgnoringCase(data: MappedData, key: string): MappedDataRow | undefined {
  if (typeof key !== 'string') {
    return undefined;
  }

  let index = data.__openwar3LowerIndex;

  if (!index) {
    index = new Map();

    for (const name of Object.keys(data.map)) {
      const lower = name.toLowerCase();

      if (!index.has(lower)) {
        index.set(lower, data.map[name]);
      }
    }

    data.__openwar3LowerIndex = index;
  }

  return index.get(key.toLowerCase());
}

/**
 * OpenWar3: resolve one entry of a map's ground-tile palette to its Terrain.slk row.
 * Never returns undefined for a map whose tileset letter is real -- see the call site.
 */
function terrainRow(viewer: War3MapViewer, tileID: string, tileset: string): MappedDataRow {
  const data = viewer.terrainData;
  const row = data.getRow(tileID) || rowIgnoringCase(data, tileID);

  if (row) {
    return row;
  }

  console.warn(`Unknown ground tile "${tileID}" -- falling back to the tileset's dirt.`);

  return <MappedDataRow>(data.getRow(`${tileset}drt`) || data.getRow('Ldrt'));
}

export default class War3MapViewerMap {
  viewer: War3MapViewer;
  map: War3Map;
  pathSolver: PathSolver;
  buildVersion = 0;
  solverParams: { tileset: string, reforged?: boolean, hd?: boolean } = { tileset: 'a' };
  worldScene: Scene;
  waterIndex = 0;
  waterRate = 0;
  waterCells = 1;
  waterLit = true;
  waterHeightOffset = 0;
  waterTextures: Texture[] = [];
  maxDeepColor = new Float32Array(4);
  minDeepColor = new Float32Array(4);
  maxShallowColor = new Float32Array(4);
  minShallowColor = new Float32Array(4);
  anyReady = false;
  terrainReady = false;
  cliffsReady = false;
  doodads: Doodad[] = [];
  terrainDoodads: { instance: MdxModelInstance, row: MappedDataRow }[] = [];
  doodadsReady = false;
  units: Unit[] = [];
  unitsReady = false;
  tilesetTextures: Texture[] = [];
  cliffTextures: Texture[] = [];
  cliffModels: TerrainModel[] = [];
  corners: Corner[][] = [];
  centerOffset = new Float32Array(2);
  mapSize = new Int32Array(2);
  tilesets: MappedDataRow[] = [];
  blightTextureIndex = -1;
  // OpenWar3 (blight): the terrain's per-tile texture/variation bytes, kept after
  // load so the ground can be re-textured at runtime. `romp` marks tiles a cliff-ramp
  // model covers -- those render no ground at all and must stay zeroed.
  cornerTextures: Uint8Array | null = null;
  cornerVariations: Uint8Array | null = null;
  rompFlags: Uint8Array | null = null;
  blightDirty: Set<number> | null = null;
  cliffTilesets: MappedDataRow[] = [];
  columns = 0;
  rows = 0;
  vertexBuffer: WebGLBuffer | null = null;
  faceBuffer: WebGLBuffer | null = null;
  instanceBuffer: WebGLBuffer | null = null;
  textureBuffer: WebGLBuffer | null = null;
  variationBuffer: WebGLBuffer | null = null;
  waterBuffer: WebGLBuffer | null = null;
  // OpenWar3 (terrain camera culling): (first instance, count) pairs naming the cell rows
  // the camera can see, refilled every frame by src/render/terrainCull.ts. Null means
  // "nobody is culling" and every pass below draws the whole map, exactly as it always did.
  ow3Runs: number[] | null = null;
  heightMap: WebGLTexture | null = null;
  waterHeightMap: WebGLTexture | null = null;
  cliffHeightMap: WebGLTexture | null = null;
  // OpenWar3: installed by src/render/fogOverlay.ts / the shadow layer through mapViewer.
  fogTexture: WebGLTexture | null = null;
  fogParams = new Float32Array(4);
  shdTexture: WebGLTexture | null = null;
  shdParams = new Float32Array(4);
  shdStrength = 1;

  constructor(viewer: War3MapViewer, buffer: ArrayBuffer | Uint8Array) {
    this.viewer = viewer;
    this.worldScene = viewer.addScene();

    // OpenWar3: the map handler asks `solverParams.reforged` for every texture it names
    // (terrain, cliffs, water, and the doodads' own `texFile` overrides) and for the
    // `.dds`/`.blp` spelling. It used to keep the flag false forever, which was harmless on
    // an SD install but wrong on HD: the tree override then asked for
    // `LordaeronSummerTree.blp`, the HD resolver answered the only unsuffixed `.dds` in the
    // install — the CLASSIC 256x256 atlas — and a Reforged tree (whose UVs are authored for
    // the 1024x512 `_Diffuse` page) sampled the stump-top with its growth rings instead of
    // the canopy. The flag is the asset FLAVOUR: it is exactly what the viewer was built
    // with, and an SD mount still gets `.blp` and no Reforged tables (viewer.ts gates those
    // on the same flag).
    this.solverParams.reforged = viewer.isReforged;

    this.map = new War3Map();

    // Readonly mode to optimize memory usage.
    this.map.load(buffer, true);

    this.loadMapInformation();

    this.pathSolver = (src, params): unknown => {
      // The type won't be a string for loads from memory, where the final source is the input source.
      // The primitive constructor is one example of this.
      if (typeof src === 'string') {
        // MPQ paths have backwards slashes...always? Don't know.
        const path = src.replace(/\//g, '\\');

        // If the file is in the map, return it.
        const file = this.map.get(path);

        if (file) {
          return file.arrayBuffer();
        }

        // Try to get the file from the server.
        return viewer.wc3PathSolver(src, params);
      }

      return src;
    };

    this.loadTerrainCliffsAndWater();

    // Global tables like WC3. It's bad.
    const modifications = this.map.readModifications();
    this.applyModificationFile(viewer.doodadsData, viewer.doodadMetaData, modifications.w3d);
    this.applyModificationFile(viewer.doodadsData, viewer.destructableMetaData, modifications.w3b);
    this.applyModificationFile(viewer.unitsData, viewer.unitMetaData, modifications.w3u);
    this.applyModificationFile(viewer.unitsData, viewer.unitMetaData, modifications.w3t);
    // OpenWar3: each file's SKIN twin, on the rows the main file just built (see
    // War3Map.readModifications). Same writer: a skin row is the same object, so a custom
    // id already has its row and only the art/word fields are overwritten.
    this.applyModificationFile(viewer.doodadsData, viewer.doodadMetaData, modifications['w3dSkin']);
    this.applyModificationFile(viewer.doodadsData, viewer.destructableMetaData, modifications['w3bSkin']);
    this.applyModificationFile(viewer.unitsData, viewer.unitMetaData, modifications['w3uSkin']);
    this.applyModificationFile(viewer.unitsData, viewer.unitMetaData, modifications['w3tSkin']);

    this.loadDoodadsAndDestructibles();
    this.loadUnitsAndItems();
  }

  die(): void {
    this.worldScene.detach();
  }

  load(src: unknown): Promise<Resource | undefined> {
    return this.viewer.load(src, this.pathSolver, this.solverParams);
  }

  loadMapInformation(): void {
    const mpqFile = this.map.get('war3map.w3i');

    if (!mpqFile) {
      console.warn('Attempted to load war3map.w3i but it is not there. Using default tileset A.');
      return;
    }

    const parser = new War3MapW3i();

    try {
      parser.load(mpqFile.bytes());
    } catch (e) {
      console.warn('Failed to correctly parse the map information file');
    }

    this.solverParams.tileset = parser.tileset.toLowerCase();

    this.buildVersion = parser.getBuildVersion();

    // OpenWar3 fix (docs/map-compatibility.md): `reforged` is an ASSET FLAVOUR and
    // `buildVersion` is a FILE LAYOUT, and they are not the same question. Every map saved
    // by a 1.32+ editor reports build 132+, so keying the flag on the build version put an
    // SD install into a mode it cannot serve. It is the MOUNT's flavour (`viewer.isReforged`,
    // set in the constructor above), while `buildVersion` goes on gating the doodad skin id
    // in war3map.doo, which is a question about the FILE and is answered correctly above.
  }

  async loadTerrainCliffsAndWater(): Promise<void> {
    const mpqFile = this.map.get('war3map.w3e');

    if (!mpqFile) {
      console.warn('Attempted to load war3map.w3e, but it is not there.');
      return;
    }

    const parser = new War3MapW3e();

    try {
      parser.load(mpqFile.bytes());
    } catch (e) {
      console.warn(`Failed to load war3map.w3e: ${e}`);
      return;
    }

    const viewer = this.viewer;
    const centerOffset = parser.centerOffset;
    const mapSize = parser.mapSize;

    this.corners = parser.corners;
    this.centerOffset.set(centerOffset);
    this.mapSize.set(mapSize);

    // Override the grid based on the map.
    this.worldScene.grid = new Grid(centerOffset[0], centerOffset[1], mapSize[0] * 128 - 128, mapSize[1] * 128 - 128, 16 * 128, 16 * 128);

    const texturesExt = this.solverParams.reforged ? '.dds' : '.blp';
    // OpenWar3 fix: the rest of this function is keyed on the tileset LETTER -- the
    // blight texture's name and the `<letter>Sha` row that carries every water colour.
    // A map naming a letter the game has no tileset for would take `.number()` on an
    // undefined row and abort the whole (unawaited) terrain load, leaving the map
    // black. Fall back to 'A', the same default the viewer already uses for a map with
    // no war3map.w3i at all. Water.slk has a row for each of the eighteen real ones.
    let tileset = parser.tileset;

    if (!viewer.waterData.getRow(`${tileset}Sha`)) {
      console.warn(`Unknown tileset "${tileset}" -- falling back to tileset A.`);
      tileset = 'A';
    }

    const tilesetTextures = [];
    const cliffTextures = [];
    const waterTextures = [];

    for (const groundTileset of parser.groundTilesets) {
      // OpenWar3 fix: a map's tile palette can spell a Terrain.slk row in a
      // different CASE. The cliff tiles are the one family in that table with a
      // lowercase leading letter ("cAc2", "cCc1", ...), and the RoC editor wrote
      // them capitalized -- three of Blizzard's own maps ((6)SwampOfSorrows,
      // (8)Plaguelands, (3)Nighthaven, all Felwood) carry "CAc2". The unguarded
      // row.string() below then threw on undefined, and because loadTerrainCliffs-
      // AndWater() is never awaited that rejection just left terrainReady false:
      // the whole map rendered BLACK. WC3's own table lookups are case-insensitive,
      // so resolve it the same way, and fall back to the map tileset's dirt if the
      // id is unknown even then -- one wrong tile must not cost the map.
      const row = terrainRow(viewer, groundTileset, tileset);

      this.tilesets.push(row);
      
      tilesetTextures.push(this.load(`${row.string('dir')}\\${row.string('file')}${texturesExt}`));
    }

    const blights: Record<string, string> = {
      A: 'Ashen',
      B: 'Barrens',
      C: 'Felwood',
      D: 'Cave',
      F: 'Lordf',
      G: 'Dungeon',
      I: 'Ice',
      J: 'DRuins',
      K: 'Citadel',
      L: 'Lords',
      N: 'North',
      O: 'Outland',
      Q: 'VillageFall',
      V: 'Village',
      W: 'Lordw',
      X: 'Village',
      Y: 'Village',
      Z: 'Ruins',
    };

    // OpenWar3 fix: the blight texture is appended to the LOCAL list being built here;
    // `this.tilesetTextures` is still the previous map's (or the constructor's empty
    // array), so upstream's index pointed at ground tileset 0 and blight drew as dirt.
    this.blightTextureIndex = tilesetTextures.length;

    tilesetTextures.push(this.load(`TerrainArt\\Blight\\${blights[tileset]}_Blight${texturesExt}`));

    for (const cliffTileset of parser.cliffTilesets) {
      // OpenWar3 fix: some maps reference a cliff type not in CliffTypes.slk
      // (e.g. "CLno" on HillsOfGlory). The unguarded row.string() below then
      // threw and the whole terrain failed to load. Fall back to CLdi so
      // terrain still renders.
      const row = <MappedDataRow>(
        viewer.cliffTypesData.getRow(cliffTileset)
        || rowIgnoringCase(viewer.cliffTypesData, cliffTileset)
        || viewer.cliffTypesData.getRow('CLdi')
      );

      this.cliffTilesets.push(row);
      cliffTextures.push(this.load(`${row.string('texDir')}\\${row.string('texFile')}${texturesExt}`));
    }

    const waterRow = <MappedDataRow>viewer.waterData.getRow(`${tileset}Sha`);

    this.waterHeightOffset = waterRow.number('height');
    // OpenWar3: Water.slk's texRate is frames per SECOND (45 frames at 15 is the real client's
    // 3 s roll, measured off 1.30.4), and the stock divide-by-60 ran it 2.4x fast on a 144 Hz
    // screen. It is advanced by advanceWater(dt) now, from real elapsed time.
    this.waterRate = waterRow.number('texRate');
    // OpenWar3: 'cells' is how many terrain cells one water frame covers (2 on every stock
    // row), and 'lighting' 0 is the three rows that take no day/night light (the dungeon's).
    // Stock read neither, so the frame repeated every cell -- a grid laid over the whole sea.
    this.waterCells = waterRow.number('cells') || 1;
    this.waterLit = waterRow.number('lighting') !== 0;
    this.waterTextures.length = 0;
    this.maxDeepColor.set([waterRow.number('Dmax_R'), waterRow.number('Dmax_G'), waterRow.number('Dmax_B'), waterRow.number('Dmax_A')]);
    this.minDeepColor.set([waterRow.number('Dmin_R'), waterRow.number('Dmin_G'), waterRow.number('Dmin_B'), waterRow.number('Dmin_A')]);
    this.maxShallowColor.set([waterRow.number('Smax_R'), waterRow.number('Smax_G'), waterRow.number('Smax_B'), waterRow.number('Smax_A')]);
    this.minShallowColor.set([waterRow.number('Smin_R'), waterRow.number('Smin_G'), waterRow.number('Smin_B'), waterRow.number('Smin_A')]);

    for (let i = 0, l = waterRow.number('numTex'); i < l; i++) {
      waterTextures.push(this.load(`${waterRow.string('texFile')}${i < 10 ? '0' : ''}${i}${texturesExt}`));
    }

    this.tilesetTextures = <Texture[]>await Promise.all(tilesetTextures);
    this.cliffTextures = <Texture[]>await Promise.all(cliffTextures);
    this.waterTextures = <Texture[]>await Promise.all(waterTextures);

    const corners = parser.corners;
    const [columns, rows] = this.mapSize;
    const instanceCount = (columns - 1) * (rows - 1);
    const cliffHeights = new Float32Array(columns * rows);
    const cornerHeights = new Float32Array(columns * rows);
    const waterHeights = new Float32Array(columns * rows);
    const cornerTextures = new Uint8Array(instanceCount * 4);
    const cornerVariations = new Uint8Array(instanceCount * 4);
    const waterFlags = new Uint8Array(instanceCount);
    let instance = 0;
    const cliffs: {[key: string]: { locations: number[], textures: number[] }} = {};

    this.columns = columns - 1;
    this.rows = rows - 1;

    // OpenWar3: cliff ramps (HiveWE reference + verified against 1.27a MPQ
    // contents). WC3 connects cliff layers with dedicated 2-tile ramp models
    // from CliffTypes.slk's rampModelDir (CliffTrans/CityCliffTrans) when the
    // w3e corners carry the ramp flag. Naming follows cliffFileName's corner
    // order (BL, TL, TR, BR) over the 2-tile span; ramp-flagged corners use
    // L (low) / H (high) for 1-layer ramps and X (low) / H for 2-layer ramps.
    // Models anchor at their bottom-right corner: vertical ramps extend north
    // (place like a cliff at the south tile), horizontal ramps extend west
    // (place at the EAST tile's right edge). Tiles covered by a ramp mesh
    // ("romp") render neither cliff nor ground; ramp-entrance tiles render
    // ground only, with base-level corners raised half a layer to meet the
    // ramp. The host provides viewer.terrainModelExists to check which ramp
    // pieces exist (only certain letter combos ship in the MPQs).
    const romp = new Uint8Array(instanceCount);
    // OpenWar3: the tiles a CLIFF DOODAD stands on (ow3PlaceCliffDoodads) — a cave is the
    // cliff there, so the tile's own cliff model is not drawn under it.
    const cliffDoodadTiles = await this.ow3PlaceCliffDoodads(corners, columns, rows, centerOffset);
    const modelExists = viewer.terrainModelExists;

    if (modelExists) {
      const rampChar = (corner: Corner, base: number, rise: number): string => corner.ramp
        ? (corner.layerHeight === base ? (rise === 2 ? 'X' : 'L') : 'H')
        : String.fromCharCode(65 + corner.layerHeight - base);

      const addRamp = (anchorX: number, y: number, name: string, base: number, cliffTexture: number): boolean => {
        const dir = <string>this.cliffTilesets[cliffTexture].string('rampModelDir');
        const path = `Doodads\\Terrain\\${dir}\\${dir}${name}0.mdx`;

        if (!modelExists(path)) {
          return false;
        }

        if (!cliffs[path]) {
          cliffs[path] = { locations: [], textures: [] };
        }

        cliffs[path].locations.push(anchorX * 128 + centerOffset[0], y * 128 + centerOffset[1], (base - 2) * 128);
        cliffs[path].textures.push(cliffTexture);

        return true;
      };

      for (let y = 0; y < rows - 1; y++) {
        for (let x = 0; x < columns - 1; x++) {
          const bl = corners[y][x];
          const br = corners[y][x + 1];
          const tl = corners[y + 1][x];
          const tr = corners[y + 1][x + 1];
          let cliffTexture = bl.cliffTexture;

          if (cliffTexture === 15) {
            cliffTexture = 1;
          }

          // Vertical ramp spanning this tile and the one above.
          if (y < rows - 2) {
            const ttl = corners[y + 2][x];
            const ttr = corners[y + 2][x + 1];
            const leftMin = Math.min(bl.layerHeight, ttl.layerHeight);
            const rightMin = Math.min(br.layerHeight, ttr.layerHeight);

            if (tl.layerHeight === leftMin && tr.layerHeight === rightMin &&
              !bl.ramp === !tl.ramp && !bl.ramp === !ttl.ramp &&
              !br.ramp === !tr.ramp && !br.ramp === !ttr.ramp &&
              !bl.ramp !== !br.ramp) {
              const base = Math.min(leftMin, rightMin);
              const rise = bl.ramp
                ? Math.abs(ttl.layerHeight - bl.layerHeight)
                : Math.abs(ttr.layerHeight - br.layerHeight);

              if (rise === 1 || rise === 2) {
                const name = rampChar(bl, base, rise) + rampChar(ttl, base, rise) + rampChar(ttr, base, rise) + rampChar(br, base, rise);

                if (addRamp(x + 1, y, name, base, cliffTexture)) {
                  romp[y * this.columns + x] = 1;
                  romp[(y + 1) * this.columns + x] = 1;

                  continue;
                }
              }
            }
          }

          // Horizontal ramp spanning this tile and the one to the right.
          if (x < columns - 2) {
            const brr = corners[y][x + 2];
            const trr = corners[y + 1][x + 2];
            const bottomMin = Math.min(bl.layerHeight, brr.layerHeight);
            const topMin = Math.min(tl.layerHeight, trr.layerHeight);

            if (br.layerHeight === bottomMin && tr.layerHeight === topMin &&
              !bl.ramp === !br.ramp && !bl.ramp === !brr.ramp &&
              !tl.ramp === !tr.ramp && !tl.ramp === !trr.ramp &&
              !bl.ramp !== !tl.ramp) {
              const base = Math.min(bottomMin, topMin);
              const rise = bl.ramp
                ? Math.abs(brr.layerHeight - bl.layerHeight)
                : Math.abs(trr.layerHeight - tl.layerHeight);

              if (rise === 1 || rise === 2) {
                const name = rampChar(bl, base, rise) + rampChar(tl, base, rise) + rampChar(trr, base, rise) + rampChar(brr, base, rise);

                if (addRamp(x + 2, y, name, base, cliffTexture)) {
                  romp[y * this.columns + x] = 1;
                  romp[y * this.columns + x + 1] = 1;

                  continue;
                }
              }
            }
          }
        }
      }
    }

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < columns; x++) {
        const bottomLeft = corners[y][x];
        const index = y * columns + x;

        cliffHeights[index] = bottomLeft.groundHeight;
        cornerHeights[index] = bottomLeft.groundHeight + bottomLeft.layerHeight - 2;
        waterHeights[index] = bottomLeft.waterHeight;

        if (y < rows - 1 && x < columns - 1) {
          // Water can be used with cliffs and normal corners, so store water state regardless.
          waterFlags[instance] = this.isWater(x, y);

          // OpenWar3: tiles covered by a ramp mesh render neither cliff
          // nor ground; ramp-entrance tiles render ground, not a cliff.
          if (romp[instance]) {
            // Covered by a ramp model.
          } else if (cliffDoodadTiles[instance] && this.isCliff(x, y) && !this.isRampEntrance(x, y)) {
            // OpenWar3: covered by a cliff doodad (a cave), which is this tile's cliff.
          } else if (this.isCliff(x, y) && !this.isRampEntrance(x, y)) {
            const bottomLeftLayer = bottomLeft.layerHeight;
            const bottomRightLayer = corners[y][x + 1].layerHeight;
            const topLeftLayer = corners[y + 1][x].layerHeight;
            const topRightLayer = corners[y + 1][x + 1].layerHeight;
            const base = Math.min(bottomLeftLayer, bottomRightLayer, topLeftLayer, topRightLayer);
            const fileName = this.cliffFileName(bottomLeftLayer, bottomRightLayer, topLeftLayer, topRightLayer, base);

            if (fileName !== 'AAAA') {
              let cliffTexture = bottomLeft.cliffTexture;

              /// ?
              if (cliffTexture === 15) {
                cliffTexture = 1;
              }

              const cliffRow = this.cliffTilesets[cliffTexture];
              const dir = <string>cliffRow.string('cliffModelDir');
              const path = `Doodads\\Terrain\\${dir}\\${dir}${fileName}${getCliffVariation(dir, fileName, bottomLeft.cliffVariation)}.mdx`;

              if (!cliffs[path]) {
                cliffs[path] = { locations: [], textures: []};
              }

              cliffs[path].locations.push((x + 1) * 128 + centerOffset[0], y * 128 + centerOffset[1], (base - 2) * 128);
              cliffs[path].textures.push(cliffTexture);
            }
          } else {
            // OpenWar3 (blight): shared with flushBlight, which re-runs exactly
            // this for a tile whose corners have just been blighted or scrubbed.
            this.writeTileTextures(x, y, instance, cornerTextures, cornerVariations);
          }

          instance += 1;
        }
      }
    }

    // OpenWar3: raise ramp-entrance corners at the base layer by half a layer
    // so the sloped ground meets the ramp model (HiveWE update_ground_heights).
    // Assignment (not +=) keeps corners shared by multiple ramp tiles correct.
    for (let y = 0; y < rows - 1; y++) {
      for (let x = 0; x < columns - 1; x++) {
        if (this.isRampEntrance(x, y)) {
          const base = Math.min(corners[y][x].layerHeight, corners[y][x + 1].layerHeight, corners[y + 1][x].layerHeight, corners[y + 1][x + 1].layerHeight);

          for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) {
            const corner = corners[cy][cx];

            if (corner.layerHeight === base) {
              cornerHeights[cy * columns + cx] = corner.groundHeight + corner.layerHeight - 2 + 0.5;
            }
          }
        }
      }
    }

    const gl = this.viewer.gl;
    const webgl = this.viewer.webgl;

    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    this.faceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.faceBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 1, 3, 2]), gl.STATIC_DRAW);

    // OpenWar3: WebGL 2 has no float ALPHA / LUMINANCE_ALPHA internal formats. The shaders
    // read `.a` for the height (and the ground shader `.r` for the un-cliffed one), so on a
    // WebGL 2 context the same values go into an RGBA32F texture with the channels replicated
    // exactly as those old formats sampled: ALPHA → (0,0,0,a), LUMINANCE_ALPHA → (l,l,l,a).
    // Same texels, same arithmetic, no shader changes; classic WebGL 1 keeps the stock upload.
    const gl2 = webgl.isWebGL2 ? <WebGL2RenderingContext><unknown>gl : null;

    this.cliffHeightMap = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.cliffHeightMap);
    webgl.setTextureMode(gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.NEAREST, gl.NEAREST);

    if (gl2) {
      const texels = new Float32Array(columns * rows * 4);

      for (let i = 0, l = columns * rows; i < l; i++) {
        texels[i * 4 + 3] = cliffHeights[i];
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl2.RGBA32F, columns, rows, 0, gl.RGBA, gl.FLOAT, texels);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, columns, rows, 0, gl.ALPHA, gl.FLOAT, cliffHeights);
    }

    // OpenWar3: the ground's height map carries TWO heights per corner. Alpha is where the
    // corner IS (ground + cliff layer + the ramp's half layer) and positions the mesh, as
    // stock. Luminance is the raw ground height alone, and is what the ground LIGHTS by:
    // a slope taken across the cliff layers tilts every tile beside a cliff or a ramp as
    // though it were a 27-degree hill, and under Lordaeron's low south-west sun that drew a
    // dark band along every cliff edge and an outline round every ramp. Both references
    // that light terrain take the normal from the raw ground height and position from the
    // final one (HiveWE terrain.vert `ground_heights` vs `cliff_levels`; Warsmash
    // TerrainShaders.Terrain `height_texture` vs `height_cliff_texture`). One texture
    // rather than a second sampler because the ground pass already holds units 0-15.
    const groundAndCornerHeights = new Float32Array(columns * rows * 2);

    for (let i = 0, l = columns * rows; i < l; i++) {
      groundAndCornerHeights[i * 2] = cliffHeights[i];
      groundAndCornerHeights[i * 2 + 1] = cornerHeights[i];
    }

    this.heightMap = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.heightMap);
    webgl.setTextureMode(gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.NEAREST, gl.NEAREST);

    if (gl2) {
      const texels = new Float32Array(columns * rows * 4);

      for (let i = 0, l = columns * rows; i < l; i++) {
        const ground = groundAndCornerHeights[i * 2];

        texels[i * 4] = ground;
        texels[i * 4 + 1] = ground;
        texels[i * 4 + 2] = ground;
        texels[i * 4 + 3] = groundAndCornerHeights[i * 2 + 1];
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl2.RGBA32F, columns, rows, 0, gl.RGBA, gl.FLOAT, texels);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE_ALPHA, columns, rows, 0, gl.LUMINANCE_ALPHA, gl.FLOAT, groundAndCornerHeights);
    }

    this.waterHeightMap = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.waterHeightMap);
    webgl.setTextureMode(gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE, gl.NEAREST, gl.NEAREST);

    if (gl2) {
      const texels = new Float32Array(columns * rows * 4);

      for (let i = 0, l = columns * rows; i < l; i++) {
        texels[i * 4 + 3] = waterHeights[i];
      }

      gl.texImage2D(gl.TEXTURE_2D, 0, gl2.RGBA32F, columns, rows, 0, gl.RGBA, gl.FLOAT, texels);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, columns, rows, 0, gl.ALPHA, gl.FLOAT, waterHeights);
    }

    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(instanceCount).map((currentValue, index) => index), gl.STATIC_DRAW);

    this.textureBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cornerTextures, gl.DYNAMIC_DRAW);

    this.variationBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.variationBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cornerVariations, gl.DYNAMIC_DRAW);

    // OpenWar3 (blight): hold on to the CPU-side copies and the ramp mask so
    // setBlight/flushBlight can re-derive a tile's four texture slots and patch just
    // those bytes back into the buffers. DYNAMIC_DRAW above says so to the driver.
    this.cornerTextures = cornerTextures;
    this.cornerVariations = cornerVariations;
    this.rompFlags = romp;
    this.blightDirty = new Set();

    this.waterBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, waterFlags, gl.STATIC_DRAW);

    this.terrainReady = true;
    this.anyReady = true;

    const cliffShader = viewer.cliffShader;

    const cliffPromises = Object.entries(cliffs).map(async (cliff) => {
      const path = cliff[0];
      const { locations, textures } = cliff[1];
      const resource = await viewer.loadBaseFile(path, 'arrayBuffer');

      if (resource) {
        return new TerrainModel(this, <ArrayBuffer>resource.data, locations, textures, cliffShader);
      }

      return;
    }).filter(x => x);

    // Sometimes TS isn't the brightest.
    const cliffPromisesForReal = <Promise<TerrainModel>[]>cliffPromises;

    this.cliffModels = await Promise.all(cliffPromisesForReal);
    this.cliffsReady = true;
  }

  /**
   * OpenWar3: CLIFF DOODADS — the .doo's "terrain doodads", Doodads.slk category C: the caves
   * (LCc0/LCc2, YCc*, YCr*), the collapsed and slid cliff walls (YCd*, YCp*, YCs*, YCg*…) and
   * the ruined floors (YCx*). Stock placed every one of them as an ordinary prop at the corner
   * one tile in from its record and at z = 0, which on the credits maps put the cave a box of
   * cliff texture under the trolls' campfire, hundreds of units below the cliff it is cut into.
   *
   * The record is a TILE, not a point (`location` is two uint32s), and it is the footprint's
   * BOTTOM-LEFT tile: the footprint is the model's own extent turned by the row's `fixedRot`
   * (every category-C row is 270), so a 3x3 cave is centred 1.5 tiles in and a 2x2 floor 1.
   * Read off the terrain under every stock use of one, not assumed: the RoC and TFT credits'
   * LCc2 at (25,37) sits exactly on the 3x3 where layer 5 drops to 3, the cave's high side
   * where the model's is; Ruins of Stratholme's 2x2 and 4x4 YCx floors fill exactly the
   * sunken road they were laid in; TerenasStand_LV's 1x2 YCp1 collapse sits on the one row of
   * cliff tiles. A centre one tile in (stock) straddles all three by half a tile.
   *
   * Like a cliff, the model stands on the footprint's LOWEST layer and is bent by the ground
   * under each vertex (the cliff shader's `groundAt`, the raw ground height without layers) —
   * the mesh is authored flat and its rim has to meet terrain that is not. A plain model
   * instance cannot sample the height map, so the bend is baked into a copy of the vertices
   * here, once: a cliff doodad never moves. Its replaceable texture 11 is the CLIFF it was cut
   * into (the tile's own cliff type, as for a cliff tile), not ReplaceableTextures\Cliff\Cliff0.
   *
   * Returns the tiles the doodads cover, so the cliff tiles under a cave draw no cliff model.
   */
  async ow3PlaceCliffDoodads(corners: Corner[][], columns: number, rows: number, centerOffset: Float32Array): Promise<Uint8Array> {
    const tiles = new Uint8Array((columns - 1) * (rows - 1));
    const mpqFile = this.map.get('war3map.doo');

    if (!mpqFile) {
      return tiles;
    }

    const parser = new War3MapDoo();

    try {
      parser.load(mpqFile.bytes(), this.buildVersion);
    } catch (e) {
      return tiles;
    }

    // The raw ground height in units of 128, bilinear between corners — cliffs.vert groundAt.
    const groundAt = (wx: number, wy: number): number => {
      const cx = Math.min(Math.max((wx - centerOffset[0]) / 128, 0), columns - 1);
      const cy = Math.min(Math.max((wy - centerOffset[1]) / 128, 0), rows - 1);
      const x0 = Math.min(Math.floor(cx), columns - 2);
      const y0 = Math.min(Math.floor(cy), rows - 2);
      const tx = cx - x0;
      const ty = cy - y0;
      const h = (x: number, y: number): number => corners[y][x].groundHeight;

      return (h(x0, y0) * (1 - tx) + h(x0 + 1, y0) * tx) * (1 - ty) + (h(x0, y0 + 1) * (1 - tx) + h(x0 + 1, y0 + 1) * tx) * ty;
    };

    const placed = parser.terrainDoodads.map(async (doodad) => {
      try {
        const row = this.viewer.doodadsData.getRow(doodad.id);

        if (!row) {
          return;
        }

        let file = row.string('file');

        if (!file) {
          return;
        }

        if (file.endsWith('.mdl')) {
          file = file.slice(0, -4);
        }

        const path = `${file}.mdx`;
        const local = this.map.get(path);
        const buffer = local ? local.arrayBuffer() : (<ArrayBuffer | undefined>(await this.viewer.loadBaseFile(path, 'arrayBuffer'))?.data);

        if (!buffer) {
          return;
        }

        const model = new MdlxModel();

        model.load(buffer);

        const fixedRot = row.number('fixedRot');
        const angle = (fixedRot >= 0 ? fixedRot : 0) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // The footprint, in tiles, from the TURNED extent.
        const min = model.extent.min;
        const max = model.extent.max;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (const [x, y] of [[min[0], min[1]], [max[0], min[1]], [min[0], max[1]], [max[0], max[1]]]) {
          const rx = x * cos - y * sin;
          const ry = x * sin + y * cos;

          minX = Math.min(minX, rx);
          maxX = Math.max(maxX, rx);
          minY = Math.min(minY, ry);
          maxY = Math.max(maxY, ry);
        }

        const w = Math.max(1, Math.round((maxX - minX) / 128));
        const h = Math.max(1, Math.round((maxY - minY) / 128));
        const tileX = doodad.location[0];
        const tileY = doodad.location[1];
        const centerX = (tileX + w / 2) * 128 + centerOffset[0];
        const centerY = (tileY + h / 2) * 128 + centerOffset[1];
        let base = Infinity;
        let cliffTexture = -1;

        for (let y = tileY; y < tileY + h && y < rows - 1; y++) {
          for (let x = tileX; x < tileX + w && x < columns - 1; x++) {
            tiles[y * (columns - 1) + x] = 1;

            if (cliffTexture === -1 && this.isCliff(x, y)) {
              cliffTexture = corners[y][x].cliffTexture;
            }
          }
        }

        for (let y = tileY; y <= tileY + h && y < rows; y++) {
          for (let x = tileX; x <= tileX + w && x < columns; x++) {
            base = Math.min(base, corners[y][x].layerHeight);
          }
        }

        if (base === Infinity) {
          return;
        }

        if (cliffTexture === -1) {
          cliffTexture = corners[tileY][tileX].cliffTexture;
        }

        if (cliffTexture === 15) {
          cliffTexture = 1;
        }

        // Bend a COPY of the mesh onto the ground (the parsed arrays may view the file).
        const lo = [Infinity, Infinity, Infinity];
        const hi = [-Infinity, -Infinity, -Infinity];

        for (const geoset of model.geosets) {
          const vertices = new Float32Array(geoset.vertices);

          for (let i = 0; i < vertices.length; i += 3) {
            const x = vertices[i];
            const y = vertices[i + 1];

            vertices[i + 2] += ((base - 2) + groundAt(centerX + x * cos - y * sin, centerY + x * sin + y * cos)) * 128;

            for (let k = 0; k < 3; k++) {
              lo[k] = Math.min(lo[k], vertices[i + k]);
              hi[k] = Math.max(hi[k], vertices[i + k]);
            }
          }

          geoset.vertices = vertices;
        }

        // The bounds the viewer culls by have to move with the mesh.
        const radius = Math.hypot(Math.max(-lo[0], hi[0]), Math.max(-lo[1], hi[1]), Math.max(-lo[2], hi[2]));

        for (const extent of [model.extent, ...model.sequences.map((s) => s.extent), ...model.geosets.map((g) => g.extent)]) {
          extent.min.set(lo);
          extent.max.set(hi);
          extent.boundsRadius = radius;
        }

        // Only the FOOTPRINT is waited on (the cliff pass needs it); the instance arrives
        // when its model does, exactly as every other doodad's.
        this.load(model).then((resource) => {
          if (!resource) {
            return;
          }

          const instance = (<MdxModel>resource).addInstance();

          instance.move([centerX, centerY, 0]);
          instance.rotateLocal(quat.setAxisAngle(quat.create(), [0, 0, 1], angle));

          const index = (<MdxModel>resource).textures.findIndex((texture) => texture.replaceableId === 11);

          if (index !== -1 && this.cliffTextures[cliffTexture]) {
            instance.setTexture(index, this.cliffTextures[cliffTexture]);
          }

          instance.setScene(this.worldScene);

          this.terrainDoodads.push({ instance, row });
        });
      } catch (e) {
        console.warn(`Failed to load cliff/terrain doodad ID ${doodad.id}: ${e}`);
      }
    });

    await Promise.all(placed);

    return tiles;
  }

  loadDoodadsAndDestructibles(): void {
    const mpqFile = this.map.get('war3map.doo');

    if (!mpqFile) {
      console.warn('Attempted to load war3map.doo but it is not there');
      return;
    }

    const parser = new War3MapDoo();

    try {
      parser.load(mpqFile.bytes(), this.buildVersion);
    } catch (e) {
      console.warn(`Failed to load war3map.doo: ${e}`);
      return;
    }

    // Doodads and destructibles.
    // OpenWar3: one line per unknown TYPE, not per placed instance. A map that paints a
    // ground decal from a type its install cannot describe has hundreds of identical
    // records, and the stock per-record log buried everything else.
    const unknownDoodads = new Set<string>();

    for (const doodad of parser.doodads) {
      try {
        const row = this.viewer.doodadsData.getRow(doodad.id);

        if (row) {
          let file = row.string('file');

          if (file) {
            const numVar = row.number('numVar');

            if (file.endsWith('.mdl')) {
              file = file.slice(0, -4);
            }

            let fileVar = file;

            file += '.mdx';

            if (numVar > 1) {
              fileVar += Math.min(doodad.variation, numVar - 1);
            }

            fileVar += '.mdx';

            // First see if the model is local.
            // Doodads refering to local models may have invalid variations, so if the variation doesn't exist, try without a variation.
            const mpqFile = this.map.get(fileVar) || this.map.get(file);
            let promise;

            if (mpqFile) {
              promise = this.load(mpqFile.name);
            } else {
              // OpenWar3: and so may doodads refering to the GAME's models. A map that re-points a
              // type with variations at one model of its own choosing (DotA's `AOob` Glowing Obelisk at
              // `Obelisk2.mdl`, its `D009` at `FaerieFireTarget.mdl`, both still `numVar` 3-4) asks for
              // `Obelisk20.mdx`, which nothing ships; the game draws `Obelisk2.mdx`, every variation alike.
              // Custom maps do this all the time, so the unnumbered path is the fallback here too.
              promise = this.load(fileVar).then((model) => (model || fileVar === file ? model : this.load(file)));
            }

            promise.then((model) => {
              if (model) {
                const instance = new Doodad(this, <MdxModel>model, row, doodad);

                this.doodads.push(instance);

                // OpenWar3: destructibles override their model's
                // replaceable texture per row (texID/texFile) — this is
                // how one LordaeronTree model shows summer, fall, snow
                // or winter canopies depending on the placed tree.
                const texId = row.number('texID');
                const texFile = row.string('texFile');

                if (texId && texFile && texFile !== '_') {
                  // OpenWar3 (HD art): an HD model's replaceable slots carry NO path — its UVs
                  // are authored for the Reforged `_Diffuse`/`_Normal`/`_ORM` triple, and the
                  // three replaceable slots are those three maps in that order. Loading the
                  // unsuffixed `.dds` instead hands a Reforged tree the CLASSIC 256x256 atlas
                  // (canopy + bark + a stump-top with growth rings on one page), so its canopy
                  // samples the ring pattern. Fill every matching slot, each with its own map.
                  const base = texFile.replace(/\.(blp|tga|dds)$/i, '');
                  const slots: number[] = [];

                  (<MdxModel>model).textures.forEach((texture, index) => {
                    if (texture.replaceableId === texId) {
                      slots.push(index);
                    }
                  });

                  for (let order = 0; order < slots.length; order++) {
                    const candidates = this.solverParams.reforged
                      ? (order === 0 ? [`${base}_Diffuse.dds`, `${base}.dds`] : order === 1 ? [`${base}_Normal.dds`] : order === 2 ? [`${base}_ORM.dds`] : [`${base}.dds`])
                      : [`${base}.blp`];

                    const tryNext = (candidate: number): void => {
                      if (candidate >= candidates.length) {
                        return;
                      }

                      this.load(candidates[candidate]).then((texture) => {
                        if (texture) {
                          instance.instance.setTexture(slots[order], <Texture>texture);
                        } else {
                          tryNext(candidate + 1);
                        }
                      });
                    };

                    tryNext(0);
                  }
                }
              }
            });
          } else if (!unknownDoodads.has(doodad.id)) {
            unknownDoodads.add(doodad.id);

            console.log('Unknown doodad ID', doodad.id, doodad);
          }
        }
      } catch (e) {
        console.warn(`Failed to load doodad/destructible ID ${doodad.id}: ${e}`);
      }
    }

    // OpenWar3: the .doo's cliff/terrain doodads (caves) are placed with the terrain, by
    // ow3PlaceCliffDoodads — they are part of the cliff mesh, not props standing on it.
    this.doodadsReady = true;
    this.anyReady = true;
  }

  loadUnitsAndItems(): void {
    const mpqFile = this.map.get('war3mapUnits.doo');

    if (!mpqFile) {
      console.warn('Attempted to load war3mapUnits.doo but it is not there');
      return;
    }

    const parser = new War3MapUnitsDoo();

    try {
      parser.load(mpqFile.bytes(), this.buildVersion);
    } catch (e) {
      console.warn(`Failed to load war3mapUnits.doo: ${e}`);
      return;
    }

    // Collect the units and items data.
    for (const unit of parser.units) {
      try {
        let row: MappedDataRow | undefined;
        let path;

        // Hardcoded?
        if (unit.id === 'sloc') {
          path = 'Objects\\StartLocation\\StartLocation.mdx';
        } else {
          row = this.viewer.unitsData.getRow(unit.id);

          if (row) {
            path = row.string('file');

            if (path) {
              if (path.endsWith('.mdl')) {
                path = path.slice(0, -4);
              }

              path += '.mdx';
            }
          }
        }

        if (path) {
          this.load(path)
            .then((model) => {
              if (model) {
                this.units.push(new Unit(this, <MdxModel>model, row, unit));
              }
            });
        } else {
          console.log('Unknown unit ID', unit.id, unit);
        }
      } catch (e) {
        console.warn(`Failed to load unit/item ID ${unit.id}: ${e}`);
      }
    }

    this.unitsReady = true;
    this.anyReady = true;
  }

  /**
   * Update the map.
   */
  update(): void {
    if (this.anyReady) {
      for (const doodad of this.doodads) {
        doodad.update();
      }

      for (const unit of this.units) {
        unit.update();
      }
    }
  }

  /**
   * OpenWar3: roll the water texture on by real elapsed time, in seconds.
   */
  advanceWater(dt: number): void {
    if (this.anyReady && this.waterTextures.length) {
      this.waterIndex = (this.waterIndex + dt * this.waterRate) % this.waterTextures.length;
    }
  }

  /**
   * Render the map.
   */
  render(): void {
    if (this.anyReady) {
      const worldScene = this.worldScene;

      worldScene.startFrame();
      this.renderGround();
      this.renderCliffs();
      worldScene.renderOpaque();
      this.renderWater();
      worldScene.renderTranslucent();
    }
  }

  /**
   * OpenWar3: issue one instanced terrain pass over the cells `ow3Runs` names.
   *
   * The per-cell attribute buffers are ROW-MAJOR, so a row of cells is a contiguous slice of
   * every one of them and the whole of the culling is an OFFSET into the attribute pointers --
   * which is what `rebind(first)` re-points, per run, for whichever attributes this pass uses.
   * With no runs set, this is the original single call over `rows * columns`.
   */
  ow3DrawCells(rebind: (first: number) => void): void {
    const gl = this.viewer.gl;
    const instancedArrays = <ANGLE_instanced_arrays>this.viewer.webgl.extensions['ANGLE_instanced_arrays'];
    const runs = this.ow3Runs;

    if (!runs || !runs.length) {
      instancedArrays.drawElementsInstancedANGLE(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, this.rows * this.columns);

      return;
    }

    for (let i = 0; i < runs.length; i += 2) {
      const count = runs[i + 1];

      if (count <= 0) {
        continue;
      }

      rebind(runs[i]);
      instancedArrays.drawElementsInstancedANGLE(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, count);
    }
  }

  renderGround(): void {
    if (this.terrainReady) {
      const gl = this.viewer.gl;
      const webgl = this.viewer.webgl;
      const instancedArrays = <ANGLE_instanced_arrays>webgl.extensions['ANGLE_instanced_arrays'];
      const shader = this.viewer.groundShader;
      const uniforms = shader.uniforms;
      const attribs = shader.attribs;
      const tilesetTextures = this.tilesetTextures;
      const instanceAttrib = attribs['a_InstanceID'];
      const positionAttrib = attribs['a_position'];
      const texturesAttrib = attribs['a_textures'];
      const variationsAttrib = attribs['a_variations'];
      const tilesetCount = tilesetTextures.length; // This includes the blight texture.

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      webgl.useShader(shader);

      gl.uniformMatrix4fv(uniforms['u_VP'], false, this.worldScene.camera.viewProjectionMatrix);
      this.setDayNightUniforms(uniforms); // OpenWar3: day/night shading
      this.setDistFogUniforms(uniforms); // OpenWar3: atmospheric distance fog
      gl.uniform2fv(uniforms['u_offset'], this.centerOffset);
      gl.uniform2f(uniforms['u_size'], this.columns, this.rows);
      gl.uniform1i(uniforms['u_heightMap'], 15);

      gl.activeTexture(gl.TEXTURE15);
      gl.bindTexture(gl.TEXTURE_2D, this.heightMap);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.vertexAttribPointer(instanceAttrib, 1, gl.FLOAT, false, 0, 0);
      instancedArrays.vertexAttribDivisorANGLE(instanceAttrib, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.textureBuffer);
      gl.vertexAttribPointer(texturesAttrib, 4, gl.UNSIGNED_BYTE, false, 0, 0);
      instancedArrays.vertexAttribDivisorANGLE(texturesAttrib, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.variationBuffer);
      gl.vertexAttribPointer(variationsAttrib, 4, gl.UNSIGNED_BYTE, false, 0, 0);
      instancedArrays.vertexAttribDivisorANGLE(variationsAttrib, 1);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.faceBuffer);

      gl.uniform1f(uniforms['u_baseTileset'], 0);

      for (let i = 0, l = Math.min(tilesetCount, 15); i < l; i++) {
        const isExtended = tilesetTextures[i].width > tilesetTextures[i].height ? 1 : 0;

        gl.uniform1f(uniforms[`u_extended[${i}]`], isExtended);
        gl.uniform1i(uniforms[`u_tilesets[${i}]`], i);

        webgl.bindTexture(tilesetTextures[i], i);
      }

      // OpenWar3: the three per-instance attributes are all 4 bytes per cell -- one float
      // of instance id, four texture bytes, four variation bytes -- so one offset serves
      // all three (see ow3DrawCells).
      const rebindGround = (first: number): void => {
        const at = first * 4;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.vertexAttribPointer(instanceAttrib, 1, gl.FLOAT, false, 0, at);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.textureBuffer);
        gl.vertexAttribPointer(texturesAttrib, 4, gl.UNSIGNED_BYTE, false, 0, at);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.variationBuffer);
        gl.vertexAttribPointer(variationsAttrib, 4, gl.UNSIGNED_BYTE, false, 0, at);
      };

      this.ow3DrawCells(rebindGround);

      if (tilesetCount > 15) {
        gl.uniform1f(uniforms['u_baseTileset'], 15);

        for (let i = 0, l = tilesetCount - 15; i < l; i++) {
          const isExtended = tilesetTextures[i + 15].width > tilesetTextures[i + 15].height ? 1 : 0;

          gl.uniform1f(uniforms[`u_extended[${i}]`], isExtended);

          webgl.bindTexture(tilesetTextures[i + 15], i);
        }

        this.ow3DrawCells(rebindGround);
      }

      instancedArrays.vertexAttribDivisorANGLE(texturesAttrib, 0);
      instancedArrays.vertexAttribDivisorANGLE(variationsAttrib, 0);
      instancedArrays.vertexAttribDivisorANGLE(instanceAttrib, 0);
    }
  }

  renderWater(): void {
    if (this.terrainReady) {
      const gl = this.viewer.gl;
      const webgl = this.viewer.webgl;
      const instancedArrays = <ANGLE_instanced_arrays>webgl.extensions['ANGLE_instanced_arrays'];
      const shader = this.viewer.waterShader;
      const uniforms = shader.uniforms;
      const attribs = shader.attribs;
      const instanceAttrib = attribs['a_InstanceID'];
      const positionAttrib = attribs['a_position'];
      const isWaterAttrib = attribs['a_isWater'];

      gl.depthMask(false);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      webgl.useShader(shader);

      gl.uniformMatrix4fv(uniforms['u_VP'], false, this.worldScene.camera.viewProjectionMatrix);
      this.setDayNightUniforms(uniforms); // OpenWar3: day/night shading
      if (!this.waterLit) gl.uniform1f(uniforms['u_dncEnabled'], 0); // Water.slk lighting = 0
      gl.uniform1f(uniforms['u_cells'], this.waterCells);
      this.setDistFogUniforms(uniforms); // OpenWar3: atmospheric distance fog
      gl.uniform2fv(uniforms['u_offset'], this.centerOffset);
      gl.uniform2f(uniforms['u_size'], this.columns, this.rows);
      gl.uniform1i(uniforms['u_heightMap'], 0);
      gl.uniform1i(uniforms['u_waterHeightMap'], 1);
      gl.uniform1i(uniforms['u_waterTexture'], 2);
      // OpenWar3: fog of war — the sea sits ABOVE the ground veil wherever it is deeper
      // than the shore, so the veil passes under it and the water stayed lit through
      // unexplored black. Dim it in the shader, as the cliffs do.
      this.setFogOfWarUniforms(uniforms, 3);
      gl.uniform1f(uniforms['u_offsetHeight'], this.waterHeightOffset);
      gl.uniform4fv(uniforms['u_maxDeepColor'], this.maxDeepColor);
      gl.uniform4fv(uniforms['u_minDeepColor'], this.minDeepColor);
      gl.uniform4fv(uniforms['u_maxShallowColor'], this.maxShallowColor);
      gl.uniform4fv(uniforms['u_minShallowColor'], this.minShallowColor);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heightMap);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.waterHeightMap);

      webgl.bindTexture(this.waterTextures[this.waterIndex | 0], 2);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.vertexAttribPointer(positionAttrib, 2, gl.FLOAT, false, 8, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.vertexAttribPointer(instanceAttrib, 1, gl.FLOAT, false, 4, 0);
      instancedArrays.vertexAttribDivisorANGLE(instanceAttrib, 1);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuffer);
      gl.vertexAttribPointer(isWaterAttrib, 1, gl.UNSIGNED_BYTE, false, 1, 0);
      instancedArrays.vertexAttribDivisorANGLE(isWaterAttrib, 1);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.faceBuffer);

      // OpenWar3: same cell grid, same runs -- but water's two per-instance attributes are
      // a 4-byte instance id and a SINGLE water flag byte, so the two offsets differ.
      this.ow3DrawCells((first) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        gl.vertexAttribPointer(instanceAttrib, 1, gl.FLOAT, false, 4, first * 4);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.waterBuffer);
        gl.vertexAttribPointer(isWaterAttrib, 1, gl.UNSIGNED_BYTE, false, 1, first);
      });

      instancedArrays.vertexAttribDivisorANGLE(isWaterAttrib, 0);
      instancedArrays.vertexAttribDivisorANGLE(instanceAttrib, 0);
    }
  }

  renderCliffs(): void {
    if (this.cliffsReady) {
      const gl = this.viewer.gl;
      const webgl = this.viewer.webgl;
      const instancedArrays = <ANGLE_instanced_arrays>webgl.extensions['ANGLE_instanced_arrays'];
      const vertexArrayObject = <OES_vertex_array_object>webgl.extensions['OES_vertex_array_object'];
      const shader = this.viewer.cliffShader;
      const attribs = shader.attribs;
      const uniforms = shader.uniforms;

      gl.disable(gl.BLEND);

      shader.use();

      gl.uniformMatrix4fv(uniforms['u_VP'], false, this.worldScene.camera.viewProjectionMatrix);
      this.setDayNightUniforms(uniforms); // OpenWar3: day/night shading
      this.setDistFogUniforms(uniforms); // OpenWar3: atmospheric distance fog
      gl.uniform1i(uniforms['u_heightMap'], 0);
      gl.uniform2f(uniforms['u_pixel'], 1 / (this.columns + 1), 1 / (this.rows + 1));
      gl.uniform2fv(uniforms['u_centerOffset'], this.centerOffset);
      gl.uniform1i(uniforms['u_texture1'], 1);
      gl.uniform1i(uniforms['u_texture2'], 2);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.cliffHeightMap);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.cliffTextures[0].webglResource);

      if (this.cliffTextures.length > 1) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, this.cliffTextures[1].webglResource);
      }

      // OpenWar3: fog of war — dim cliff faces by the fog mask (set by FogOverlay
      // via mapViewer); the ground veil cannot cover their overhang.
      this.setFogOfWarUniforms(uniforms, 3);

      // OpenWar3: …and by the map's baked shadow layer, which cannot lie on a cliff
      // either (see cliffs.frag). Installed by mapViewer as `shdTexture`/`shdParams`/
      // `shdStrength`; off until it exists, or on a map with no war3map.shd.
      if (this.shdTexture) {
        gl.uniform1f(uniforms['u_shdEnabled'], 1);
        gl.uniform4fv(uniforms['u_shdParams'], this.shdParams);
        gl.uniform1f(uniforms['u_shdStrength'], this.shdStrength);
        gl.uniform1i(uniforms['u_shdTexture'], 4);
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, this.shdTexture);
      } else {
        gl.uniform1f(uniforms['u_shdEnabled'], 0);
      }

      // Set instanced attributes.
      if (!vertexArrayObject) {
        instancedArrays.vertexAttribDivisorANGLE(attribs['a_instancePosition'], 1);
        instancedArrays.vertexAttribDivisorANGLE(attribs['a_instanceTexture'], 1);
      }

      // Render the cliffs.
      for (const cliff of this.cliffModels) {
        cliff.render(shader);
      }

      // Clear instanced attributes.
      if (!vertexArrayObject) {
        instancedArrays.vertexAttribDivisorANGLE(attribs['a_instancePosition'], 0);
        instancedArrays.vertexAttribDivisorANGLE(attribs['a_instanceTexture'], 0);
      }
    }
  }

  cliffFileName(bottomLeftLayer: number, bottomRightLayer: number, topLeftLayer: number, topRightLayer: number, base: number): string {
    return String.fromCharCode(65 + bottomLeftLayer - base) +
      String.fromCharCode(65 + topLeftLayer - base) +
      String.fromCharCode(65 + topRightLayer - base) +
      String.fromCharCode(65 + bottomRightLayer - base);
  }

  getVariation(groundTexture: number, variation: number): number {
    const texture = this.tilesetTextures[groundTexture];

    // Extended?
    if (texture.width > texture.height) {
      if (variation < 16) {
        return 16 + variation;
      } else if (variation === 16) {
        return 15;
      } else {
        return 0;
      }
    } else {
      if (variation === 0) {
        return 0;
      } else {
        return 15;
      }
    }
  }

  /**
   * OpenWar3: feed the ground/cliff/water shaders the scene's day/night light,
   * sampled from the tileset's Environment\DNC\*Terrain.mdx (src/render/dayNight.ts).
   * All three passes take the TERRAIN light; models take the unit one (mdx/batchgroup).
   */
  setDayNightUniforms(uniforms: Record<string, WebGLUniformLocation | null>): void {
    const gl = this.viewer.gl;
    const scene = this.worldScene;
    const dnc = scene.dncTerrain;

    if (scene.dncEnabled && dnc) {
      gl.uniform1f(uniforms['u_dncEnabled'], 1);
      gl.uniform3fv(uniforms['u_dncAmbient'], dnc.ambient);
      gl.uniform3fv(uniforms['u_dncDiffuse'], dnc.diffuse);
      gl.uniform3fv(uniforms['u_dncLightDir'], dnc.direction);
    } else {
      gl.uniform1f(uniforms['u_dncEnabled'], 0);
    }
  }

  /**
   * OpenWar3: feed the terrain shaders the scene's linear distance fog (the WC3
   * environment haze; src/render/fog.ts → worldScene.distFog, from the map's w3i).
   */
  setDistFogUniforms(uniforms: Record<string, WebGLUniformLocation | null>): void {
    const gl = this.viewer.gl;
    const scene = this.worldScene;
    const fog = scene.distFog;

    if (fog && fog.enabled) {
      gl.uniform1f(uniforms['u_distFogEnabled'], 1);
      gl.uniform1f(uniforms['u_distFogStart'], fog.start);
      gl.uniform1f(uniforms['u_distFogEnd'], fog.end);
      gl.uniform3fv(uniforms['u_distFogColor'], fog.color);
      gl.uniform3fv(uniforms['u_distFogEye'], scene.camera.location);
      gl.uniform3fv(uniforms['u_distFogDir'], scene.camera.directionZ);
    } else {
      gl.uniform1f(uniforms['u_distFogEnabled'], 0);
    }
  }

  /**
   * OpenWar3: feed a terrain shader the FOG OF WAR mask (src/render/fogOverlay.ts, installed
   * on the map by mapViewer as `fogTexture`/`fogParams`).
   *
   * Two of the three terrain passes need it, and for the same reason: the fog veil is a mesh
   * laid on the GROUND, so anything the ground is not covers itself. A cliff face overhangs
   * it; the water sheet sits above it wherever the sea is deeper than the shore. Both dim in
   * their own shader instead. `textureUnit` differs per pass only because each pass has its
   * own textures bound below it. Stays off — stock behaviour — until a fog texture exists.
   */
  setFogOfWarUniforms(uniforms: Record<string, WebGLUniformLocation | null>, textureUnit: number): void {
    const gl = this.viewer.gl;

    if (this.fogTexture) {
      gl.uniform1f(uniforms['u_fogEnabled'], 1);
      gl.uniform4fv(uniforms['u_fogParams'], this.fogParams);
      gl.uniform1i(uniforms['u_fogTexture'], textureUnit);
      gl.activeTexture(gl.TEXTURE0 + textureUnit);
      gl.bindTexture(gl.TEXTURE_2D, this.fogTexture);
    } else {
      gl.uniform1f(uniforms['u_fogEnabled'], 0);
    }
  }

  /**
   * OpenWar3: is the tile at the given column and row a ramp entrance?
   * All four corners carry the w3e ramp flag and the layers differ
   * non-diagonally (HiveWE is_corner_ramp_entrance). Such tiles render
   * sloped ground instead of a cliff mesh.
   */
  isRampEntrance(column: number, row: number): boolean {
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) {
      return false;
    }

    const corners = this.corners;
    const bl = corners[row][column];
    const br = corners[row][column + 1];
    const tl = corners[row + 1][column];
    const tr = corners[row + 1][column + 1];

    return !!(bl.ramp && br.ramp && tl.ramp && tr.ramp)
      && !(bl.layerHeight === tr.layerHeight && tl.layerHeight === br.layerHeight);
  }

  /**
   * Is the corner at the given column and row a cliff?
   */
  isCliff(column: number, row: number): boolean {
    if (column < 1 || column > this.columns - 1 || row < 1 || row > this.rows - 1) {
      return false;
    }

    const corners = this.corners;
    const bottomLeft = corners[row][column].layerHeight;
    const bottomRight = corners[row][column + 1].layerHeight;
    const topLeft = corners[row + 1][column].layerHeight;
    const topRight = corners[row + 1][column + 1].layerHeight;

    return bottomLeft !== bottomRight || bottomLeft !== topLeft || bottomLeft !== topRight;
  }

  /**
   * Is the tile at the given column and row water?
   */
  isWater(column: number, row: number): number {
    const corners = this.corners;

    return corners[row][column].water || corners[row][column + 1].water || corners[row + 1][column].water || corners[row + 1][column + 1].water;
  }

  /**
   * Given a cliff index, get its ground texture index.
   * This is an index into the tilset textures.
   */
  cliffGroundIndex(whichCliff: number): number {
    const whichTileset = this.cliffTilesets[whichCliff].string('groundTile');
    const tilesets = this.tilesets;

    for (let i = 0, l = tilesets.length; i < l; i++) {
      if (tilesets[i].string('tileID') === whichTileset) {
        return i;
      }
    }

    return 0;
  }

  /**
   * OpenWar3 (blight): write the four texture/variation slots of one ground tile.
   *
   * Lifted verbatim out of the terrain-load loop so that runtime blight can re-run it.
   * WC3's ground shader draws a tile as up to four stacked layers: slot 0 is the base
   * texture (lowest tileset index wins) with a VARIATION byte, slots 1-3 are the other
   * distinct corner textures with a 4-bit corner mask telling the shader which corners to
   * blend them into. `blightTextureIndex` is just another tileset index, so a blighted
   * corner needs no special case anywhere -- it re-sorts into the stack like any tile.
   */
  writeTileTextures(x: number, y: number, instance: number, cornerTextures: Uint8Array, cornerVariations: Uint8Array): void {
    const bottomLeft = this.corners[y][x];
    const bottomLeftTexture = this.cornerTexture(x, y);
    const bottomRightTexture = this.cornerTexture(x + 1, y);
    const topLeftTexture = this.cornerTexture(x, y + 1);
    const topRightTexture = this.cornerTexture(x + 1, y + 1);
    const textures = unique([bottomLeftTexture, bottomRightTexture, topLeftTexture, topRightTexture]).sort();
    let texture = textures[0];

    cornerTextures[instance * 4] = texture + 1;
    cornerVariations[instance * 4] = this.getVariation(texture, bottomLeft.groundVariation);
    cornerTextures[instance * 4 + 1] = 0;
    cornerTextures[instance * 4 + 2] = 0;
    cornerTextures[instance * 4 + 3] = 0;
    cornerVariations[instance * 4 + 1] = 0;
    cornerVariations[instance * 4 + 2] = 0;
    cornerVariations[instance * 4 + 3] = 0;

    textures.shift();

    for (let i = 0, l = textures.length; i < l; i++) {
      let bitset = 0;

      texture = textures[i];

      if (bottomRightTexture === texture) {
        bitset |= 0b0001;
      }

      if (bottomLeftTexture === texture) {
        bitset |= 0b0010;
      }

      if (topRightTexture === texture) {
        bitset |= 0b0100;
      }

      if (topLeftTexture === texture) {
        bitset |= 0b1000;
      }

      cornerTextures[instance * 4 + 1 + i] = texture + 1;
      cornerVariations[instance * 4 + 1 + i] = bitset;
    }
  }

  /**
   * OpenWar3 (blight): set one terrain CORNER blighted or clean.
   *
   * Marks the (up to) four tiles that corner belongs to for re-texturing; call flushBlight
   * once per frame to push them to the GPU. Returns true if the corner actually changed.
   */
  setBlight(column: number, row: number, on: boolean): boolean {
    const corners = this.corners;
    const rowArr = corners[row];

    if (!rowArr) {
      return false;
    }

    const corner = rowArr[column];

    if (!corner || !!corner.blight === !!on) {
      return false;
    }

    corner.blight = on ? 1 : 0;

    // cornerTexture() also reads a corner's NEIGHBOURS (a cliff within one tile wins over
    // the ground), so the dirty span is the 2x2 block of tiles that touch this corner.
    for (let y = row - 1; y <= row; y++) {
      for (let x = column - 1; x <= column; x++) {
        if (x >= 0 && y >= 0 && x < this.columns && y < this.rows) {
          (<Set<number>>this.blightDirty).add(y * this.columns + x);
        }
      }
    }

    return true;
  }

  /** OpenWar3 (blight): push every tile marked by setBlight to the GPU. */
  flushBlight(): void {
    if (!this.terrainReady || !this.blightDirty || this.blightDirty.size === 0) {
      return;
    }

    const gl = this.viewer.gl;
    const cornerTextures = <Uint8Array>this.cornerTextures;
    const cornerVariations = <Uint8Array>this.cornerVariations;
    const romp = this.rompFlags;

    for (const instance of this.blightDirty) {
      const x = instance % this.columns;
      const y = (instance / this.columns) | 0;

      // A tile under a cliff or a ramp model draws no ground; leave its slots zeroed,
      // exactly as the load pass left them.
      if (romp && romp[instance]) {
        continue;
      }

      if (this.isCliff(x, y) && !this.isRampEntrance(x, y)) {
        continue;
      }

      this.writeTileTextures(x, y, instance, cornerTextures, cornerVariations);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.textureBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, instance * 4, cornerTextures.subarray(instance * 4, instance * 4 + 4));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.variationBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, instance * 4, cornerVariations.subarray(instance * 4, instance * 4 + 4));
    }

    this.blightDirty.clear();
  }

  /**
   * Get the ground texture of a corner, whether it's normal ground, a cliff, or a blighted corner.
   */
  cornerTexture(column: number, row: number): number {
    const corners = this.corners;
    const columns = this.columns;
    const rows = this.rows;

    for (let y = -1; y < 1; y++) {
      for (let x = -1; x < 1; x++) {
        if (column + x > 0 && column + x < columns - 1 && row + y > 0 && row + y < rows - 1) {
          if (this.isCliff(column + x, row + y)) {
            let texture = corners[row + y][column + x].cliffTexture;

            if (texture === 15) {
              texture = 1;
            }

            return this.cliffGroundIndex(texture);
          }
        }
      }
    }

    const corner = corners[row][column];

    // Is this corner blighted?
    if (corner.blight) {
      return this.blightTextureIndex;
    }

    return corner.groundTexture;
  }

  applyModificationFile(dataMap: MappedData, metadataMap: MappedData, modificationFile: War3MapW3u | War3MapW3d | undefined): void {
    if (modificationFile) {
      // Modifications to built-in objects
      this.applyModificationTable(dataMap, metadataMap, modificationFile.originalTable);

      // Declarations of user-defined objects
      this.applyModificationTable(dataMap, metadataMap, modificationFile.customTable);
    }
  }

  applyModificationTable(dataMap: MappedData, metadataMap: MappedData, modificationTable: ModificationTable): void {
    for (const modificationObject of modificationTable.objects) {
      let row: MappedDataRow | undefined;

      // OpenWar3 fix: an ORIGINAL-table object (a map retuning a BUILT-IN type) carries
      // four ZERO BYTES where a custom object carries its new rawcode, and the parser
      // reads that as the 4-char string "\0\0\0\0" -- not "". So `newId !== ''` was true
      // for every one of them, and every override a map makes to a stock unit/item/
      // doodad/destructable was filed on a junk row keyed "\0\0\0\0" instead of on the
      // type it names. Extreme Candy War 2004 is a map made almost entirely of such
      // overrides: its heroes are stock hero ids wearing other models, and every one of
      // them rendered as the stock hero.
      const newId = modificationObject.newId;
      const hasNewId = newId !== '' && newId !== '\0\0\0\0';

      if (hasNewId) {
        row = dataMap.getRow(newId);

        if (!row) {
          const base = dataMap.getRow(modificationObject.oldId);

          if (!base) {
            console.warn('Unknown base object', modificationObject.oldId);
            continue;
          }

          row = new MappedDataRow();
          row.map = Object.assign({}, base.map);
          dataMap.setRow(newId, row);
        }
      } else {
        row = dataMap.getRow(modificationObject.oldId);
      }

      // A row for a type this table does not carry (a .w3u entry for an item id, say --
      // units and items share one modification file) is simply not ours to write.
      if (!row) {
        continue;
      }

      for (const modification of modificationObject.modifications) {
        const metadata = metadataMap.getRow(modification.id);

        if (metadata) {
          row.set(<string>metadata.string('field'), modification.value);
        } else {
          console.warn('Unknown modification ID', modification);
        }
      }
    }
  }

  groundNormal(out: vec3, x: number, y: number): vec3 {
    const centerOffset = this.centerOffset;
    const mapSize = this.mapSize;

    x = (x - centerOffset[0]) / 128;
    y = (y - centerOffset[1]) / 128;

    const cellX = x | 0;
    const cellY = y | 0;

    // See if this coordinate is in the map
    if (cellX >= 0 && cellX < mapSize[0] - 1 && cellY >= 0 && cellY < mapSize[1] - 1) {
      // See http://gamedev.stackexchange.com/a/24574
      const corners = this.corners;
      const bottomLeft = corners[cellY][cellX].groundHeight;
      const bottomRight = corners[cellY][cellX + 1].groundHeight;
      const topLeft = corners[cellY + 1][cellX].groundHeight;
      const topRight = corners[cellY + 1][cellX + 1].groundHeight;
      const sqX = x - cellX;
      const sqY = y - cellY;

      if (sqX + sqY < 1) {
        vec3.set(normalHeap1, 1, 0, bottomRight - bottomLeft);
        vec3.set(normalHeap2, 0, 1, topLeft - bottomLeft);
      } else {
        vec3.set(normalHeap1, -1, 0, topRight - topLeft);
        vec3.set(normalHeap2, 0, 1, topRight - bottomRight);
      }

      vec3.normalize(out, vec3.cross(out, normalHeap1, normalHeap2));
    } else {
      vec3.set(out, 0, 0, 1);
    }

    return out;
  }
}

/*
  heightAt(location) {
    let heightMap = this.heightMap,
      offset = this.offset,
      x = (location[0] / 128) + offset[0],
      y = (location[1] / 128) + offset[1];

    let minY = Math.floor(y),
      maxY = Math.ceil(y),
      minX = Math.floor(x),
      maxX = Math.ceil(x);

    // See if this coordinate is in the map
    if (maxY > 0 && minY < heightMap.length - 1 && maxX > 0 && minX < heightMap[0].length - 1) {
      // See http://gamedev.stackexchange.com/a/24574
      let triZ0 = heightMap[minY][minX],
        triZ1 = heightMap[minY][maxX],
        triZ2 = heightMap[maxY][minX],
        triZ3 = heightMap[maxY][maxX],
        sqX = x - minX,
        sqZ = y - minY,
        height;

      if ((sqX + sqZ) < 1) {
        height = triZ0 + (triZ1 - triZ0) * sqX + (triZ2 - triZ0) * sqZ;
      } else {
        height = triZ3 + (triZ1 - triZ3) * (1 - sqZ) + (triZ2 - triZ3) * (1 - sqX);
      }

      return height * 128;
    }

    return 0;
  }
  */
