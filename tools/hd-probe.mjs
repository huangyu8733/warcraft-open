// P2 / P3 probe: mount a real Reforged store through the ENGINE'S OWN door and answer the
// questions P3 turns on:
//
//   * does `CascDataSource.open(..., { graphics: "de", lazyArt: true })` mount the base, the
//     DE art module and the zhCN locale in the right order?
//   * can the data layer read the Chinese strings and the HD `unitSkin.txt` columns?
//   * does the Footman resolve to the DE model, and do that model's `.tif`/`.blp` textures
//     resolve to the `.dds` the store actually ships?
//
// Usage: node tools/hd-probe.mjs ["/path/to/Warcraft III"] [map.w3x] ["?flavor=hd&hdArt=de"]

import { open, readFile, readdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { createServer } from "vite";

const require = createRequire(import.meta.url);

// data/customKeys.ts reads the player's saved overrides; the probe wants the STOCK tables.
if (!globalThis.localStorage) {
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
}

const ROOT = process.argv[2] ?? "/Users/huangyu/rrrr/Warcraft III";
// The flavor door (`data/flavor.ts`) is read at module init: ask for HD/DE before anything
// that depends on it is loaded. The third argument lets a run ask for the HD art set instead.
globalThis.location = { search: process.argv[4] ?? "?flavor=hd&hdArt=de" };

const server = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  server: { middlewareMode: true },
});
const casc = await server.ssrLoadModule("/src/vfs/casc.ts");
const { decodeBlte } = await server.ssrLoadModule("/src/vfs/blte.ts");

try {
  // --- build config -------------------------------------------------------
  const info = casc.parseBuildInfo(await readFile(join(ROOT, ".build.info"), "utf8"));
  const buildKey = (info.get("Build Key") ?? "").toLowerCase();
  const configText = await readFile(
    join(ROOT, "Data/config", buildKey.slice(0, 2), buildKey.slice(2, 4), buildKey),
    "utf8",
  );
  const build = casc.parseConfig(configText);
  console.log(`install : ${ROOT}`);
  console.log(`version : ${info.get("Version")}  (${build.get("build-name") ?? "?"})`);
  console.log(`root    : ${build.get("root")}`);
  console.log(`vfs-root: ${build.get("vfs-root")}`);
  console.log(`flavor  : ${globalThis.location.search}`);

  // --- local index --------------------------------------------------------
  const dataDir = join(ROOT, "Data/data");
  const idx = new Map();
  for (const name of await readdir(dataDir)) {
    if (/^[0-9a-f]{10}\.idx$/i.test(name)) idx.set(name, new Uint8Array(await readFile(join(dataDir, name))));
  }
  const index = casc.parseIndex(idx);
  console.log(`\nindex   : ${idx.size} buckets, ${index.size} live locations`);

  const handles = new Map();
  const readLocation = async (loc, label) => {
    if (!loc) throw new Error(`${label}: not in the local index`);
    const archive = join(dataDir, `data.${String(loc.archive).padStart(3, "0")}`);
    let h = handles.get(loc.archive);
    if (!h) {
      h = await open(archive, "r");
      handles.set(loc.archive, h);
    }
    const buf = Buffer.alloc(loc.size);
    const { bytesRead } = await h.read(buf, 0, loc.size, loc.offset);
    if (bytesRead !== loc.size) throw new Error(`${label}: short read ${bytesRead}/${loc.size}`);
    // 30-byte record header, then the BLTE payload (casc.ts RECORD_HEADER).
    return decodeBlte(new Uint8Array(buf.buffer, buf.byteOffset + 30, loc.size - 30));
  };

  // --- encoding (EKey → CKey lookup) --------------------------------------
  const encodingEKey = (build.get("encoding") ?? "").split(" ")[1];
  const encoding = casc.parseEncoding(
    await readLocation(index.get(encodingEKey.slice(0, 18)), "encoding"),
  );
  console.log(`encoding: ${encoding.size} CKeys`);

  // --- classic root -------------------------------------------------------
  const rootCKey = (build.get("root") ?? "").split(" ")[0];
  const rootEKey = encoding.get(rootCKey);
  const rootBytes = await readLocation(index.get(rootEKey.slice(0, 18)), "root");
  const rootText = new TextDecoder("latin1").decode(rootBytes);
  const lines = rootText.split(/\r?\n/).filter(Boolean);
  console.log(`\nroot    : ${rootBytes.length} bytes, ${lines.length} entries`);

  // --- P3: mount the store the way the loader does -------------------------
  const art = new URLSearchParams(globalThis.location.search).get("hdArt") === "hd" ? "hd" : "de";
  const data = new Map();
  const readers = [];
  for (const name of await readdir(dataDir)) {
    const m = /^data\.(\d+)$/.exec(name);
    if (!m) continue;
    const h = await open(join(dataDir, name), "r");
    const { size } = await h.stat();
    readers.push(h);
    data.set(Number(m[1]), {
      size,
      slice: async (start, end) => {
        const buf = Buffer.alloc(end - start);
        const { bytesRead } = await h.read(buf, 0, end - start, start);
        return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
      },
    });
  }
  const vfs = await casc.CascDataSource.open(
    { buildInfo: await readFile(join(ROOT, ".build.info"), "utf8"), config: new Map([[buildKey, configText]]), idx, data },
    (message) => {
      // The preload ticks once per file; its one useful line is the final one.
      if (!message.startsWith("Loading game data")) console.log(`  ${message}`);
    },
    { graphics: art, lazyArt: true },
  );
  console.log(`\nmounted : ${vfs.mounted.join(" → ")}`);
  console.log(`paths   : ${vfs.list().length} (art still on disk: read() serves it)`);

  // sanity: every preloaded entry must be a whole BLTE payload (a few records have no
  // 30-byte header at all — casc.ts detects that by the magic)
  let bad = 0;
  for (const [key, entry] of vfs.entries) {
    if (!entry.raw) continue;
    const size = entry.location.size;
    const whole = entry.raw.length === size || entry.raw.length === size - 30;
    const magic = Buffer.from(entry.raw.subarray(0, 4)).toString("latin1");
    if (!whole || magic !== "BLTE") {
      if (bad++ < 6) console.log(`  BAD RAW ${key} raw=${entry.raw.length} record=${size} magic=${JSON.stringify(magic)}`);
    }
  }
  console.log(`raw     : ${bad ? `${bad} BAD entries` : "all preloaded payloads intact"}`);

  // --- P3-5: strings + unit registry --------------------------------------
  const strings = new TextDecoder().decode(await vfs.read("Units\\HumanUnitStrings.txt"));
  console.log(`strings : ${/[一-鿿]/.test(strings) ? "zhCN text present" : "NO zhCN text"}`);
  console.log(`skin    : ${vfs.exists("Units\\unitSkin.txt") ? "unitSkin.txt" : "MISSING unitSkin.txt"}`);

  const units = await server.ssrLoadModule("/src/data/units.ts");
  const registry = units.loadUnitRegistry(vfs);
  const foot = registry.get("hfoo");
  console.log(`units   : ${registry.all().length} defs`);
  if (foot) {
    console.log(
      `Footman : ${foot.name}  hp=${foot.hitPoints} armor=${foot.armor} gold=${foot.goldCost} lumber=${foot.lumberCost} food=${foot.foodUsed}`,
    );
    console.log(`model   : ${foot.model}  (scale ${foot.modelScale}, walk ${foot.animWalkSpeed})`);
    console.log(`in store: ${vfs.exists(foot.model) ? "yes" : "NO"}  ${(await vfs.read(foot.model)).length} bytes`);
  } else {
    console.log("Footman : hfoo not in the registry");
  }

  // --- P3-2: the model's own texture names resolve to stored `.dds` --------
  const MdlxModel = require("mdx-m3-viewer/dist/cjs/parsers/mdlx/model").default;
  const { hdTexturePaths } = await server.ssrLoadModule("/src/vfs/tileset.ts");
  if (foot) {
    const parser = new MdlxModel();
    parser.load(await vfs.read(foot.model));
    const textures = parser.textures.map((t) => t.path).filter(Boolean);
    console.log(`\nFootman textures (${textures.length}):`);
    let missing = 0;
    for (const texture of textures) {
      const paths = hdTexturePaths(texture.replace(/\//g, "\\"), true);
      const hit = paths.find((p) => vfs.exists(p));
      if (!hit) missing++;
      console.log(`  ${hit ? "ok  " : "MISS"} ${texture}${hit && hit !== texture ? ` → ${hit}` : ""}`);
    }
    const first = textures.map((t) => hdTexturePaths(t.replace(/\//g, "\\"), true).find((p) => vfs.exists(p))).find((p) => p && /\.dds$/i.test(p));
    if (first) {
      const bytes = await vfs.read(first);
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      console.log(
        `dds     : ${first}  magic=${JSON.stringify(Buffer.from(bytes.subarray(0, 4)).toString("latin1"))} ${dv.getUint32(16, true)}×${dv.getUint32(12, true)} ${bytes.length} bytes`,
      );
    }
    console.log(missing ? `MISSING textures: ${missing}` : "textures: all resolved");
  }

  for (const p of ["ReplaceableTextures\\TeamColor\\TeamColor00.dds", "Textures\\Black32.blp", "Textures\\Black32.dds"]) {
    console.log(`asset   : ${vfs.exists(p) ? "yes" : "no "}  ${p}`);
  }

  // The one texture the running HD match could not fetch (browser console, P3 exit run):
  // the Goldmine's emissive map. Its TEXS entry is what the solver is handed, so print it —
  // and resolve it exactly as `createAssetSolver` does, which is the assertion that counts.
  // Reforged's art was authored on a Windows box and this field kept the authoring path
  // (`C:/…/assets/Art/HD//Buildings/…`), so `storedTexturePath` has to strip it.
  for (const id of ["ngol", "ngme"]) {
    const unit = registry.get(id);
    if (!unit) continue;
    const model = new MdlxModel();
    model.load(await vfs.read(unit.model));
    console.log(`\n${id} model ${unit.model}`);
    for (const t of model.textures) {
      const stored = hdTexturePaths((t.path ?? "").replace(/\//g, "\\"), true);
      const hit = stored.find((p) => vfs.exists(p));
      console.log(`  tex ${JSON.stringify(t.path)}${hit ? ` → ${hit}` : " · MISS"}`);
    }
  }

  // --- P3: the CLIFF DOODADS resolve in the art layer ----------------------
  // `Doodads.slk` category "C" is the caves and collapsed walls the terrain pass draws, and
  // their model is named by the HD/DE `doodadSkins.txt` (the .slk row's own `file` is empty in
  // 3.0). This is the class that failed on Terenas Stand (YCr2) before the viewer's
  // `loadBaseFile` learned to await a lazy-art Promise — see the patch's w3x/viewer.js hunk.
  const { MappedData } = require("mdx-m3-viewer/dist/cjs/utils/mappeddata.js");
  const doodAds = new MappedData(new TextDecoder().decode(await vfs.read("Doodads\\Doodads.slk")));
  const doodadSkins = vfs.exists("Doodads\\doodadSkins.txt")
    ? new MappedData(new TextDecoder().decode(await vfs.read("Doodads\\doodadSkins.txt")))
    : null;
  const cliffs = Object.keys(doodAds.map).filter((id) => doodAds.getRow(id).string("category") === "C");
  let cliffMissing = 0;
  for (const id of cliffs) {
    let file = doodadSkins?.getRow(id)?.string("file") ?? doodAds.getRow(id).string("file");
    if (!file) continue;
    if (file.endsWith(".mdl")) file = file.slice(0, -4);
    const path = `${file.replace(/\//g, "\\")}.mdx`;
    if (!vfs.exists(path)) {
      if (++cliffMissing <= 8) console.log(`  MISS ${id} → ${path}`);
    }
  }
  console.log(`\ncliff doodads: ${cliffs.length} · ${cliffMissing ? `${cliffMissing} MISSING` : "all resolve"}`);

  // --- P3-6: the main menu's own models parse, and their textures resolve ---
  const MENU = [
    "UI\\Glues\\MainMenu\\MainMenu3D_Exp\\MainMenu3D_Exp.mdx",
    "UI\\Glues\\SpriteLayers\\Expansion\\TopRightPanel-Expansion.mdx",
    "UI\\Glues\\SpriteLayers\\Expansion\\TopLeftPanel-Expansion.mdx",
    "UI\\Glues\\MainMenu\\WarCraftIIILogo_exp\\WarCraftIIILogo_exp.mdx",
  ];
  console.log("\nmenu:");
  for (const path of MENU) {
    if (!vfs.exists(path)) {
      console.log(`  MISSING ${path}`);
      continue;
    }
    const model = new MdlxModel();
    model.load(await vfs.read(path));
    const textures = model.textures.map((t) => t.path.replace(/\//g, "\\")).filter(Boolean);
    const unresolved = textures.filter((t) => !hdTexturePaths(t, true).some((p) => vfs.exists(p)));
    console.log(
      `  ok ${path.split("\\").pop()} · v${model.version} · geo ${model.geosets.length} · tex ${textures.length} · lights ${model.lights.length} · cameras ${model.cameras.length} · missing ${unresolved.length}`,
    );
    if (unresolved.length) console.log(`     ${unresolved.slice(0, 8).join(", ")}`);
  }

  // --- P2-1 / P2-2 diagnostics: what the root actually says ----------------
  const archives = new Map();
  for (const line of lines) {
    const name = line.slice(0, line.indexOf("|"));
    const archive = name.includes(":") ? name.slice(0, name.indexOf(":")) : "(installer)";
    archives.set(archive, (archives.get(archive) ?? 0) + 1);
  }
  console.log("\narchives:");
  for (const [name, count] of [...archives].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
    console.log(`  ${String(count).padStart(5)}  ${name}`);
  }

  // Which SUBMODULE (the `a.w3mod:b.w3mod:path` chain) each path lives in. Reforged moved the
  // balance sets and the locales into their own submodules.
  const namespaces = new Map();
  for (const line of lines) {
    const name = line.slice(0, line.indexOf("|"));
    const parts = name.split(":");
    const ns = parts.length > 1 ? parts.slice(0, -1).join(":") : "(root)";
    namespaces.set(ns, (namespaces.get(ns) ?? 0) + 1);
  }
  console.log("namespaces:");
  for (const [name, count] of [...namespaces].sort((a, b) => b[1] - a[1]).slice(0, 24)) {
    console.log(`  ${String(count).padStart(6)}  ${name}`);
  }

  // --- P2-3: boot a real melee map headlessly against the Reforged tables ----
  // The map is only TERRAIN + slots + placed doodads; every unit, cost and model comes
  // from the mount above. (The Reforged install ships no Maps\ folder — its melee maps
  // arrive from Battle.net — so the fixture is a stock TFT melee map.)
  const MAP = process.argv[3] ??
    "/Users/huangyu/魔兽/开源魔兽争霸/Warcraft III enUS/Maps/official/FrozenThrone/(2)TerenasStand.w3x";
  console.log(`\nmelee map: ${MAP}`);
  let mapBytes = null;
  try {
    mapBytes = new Uint8Array(await readFile(MAP));
  } catch {
    console.log("  skipped: map not found (pass one as the 2nd argument)");
  }
  if (mapBytes && foot) {
    // The map readers import mdx-m3-viewer's CJS parsers with `import X from …`; Vite's SSR
    // interop hands that back as a namespace object, so take them from the COMPILED sim build
    // (the same modules `pnpm sim:test` runs) rather than through `ssrLoadModule`.
    writeFileSync(join(process.cwd(), ".sim-build", "package.json"), '{"type":"commonjs"}');
    const SIM = (p) => require(join(process.cwd(), ".sim-build", "src", p));
    const { MpqDataSource } = SIM("vfs/mpq.js");
    const { readW3i } = SIM("compat/w3i.js");
    const { parseW3E } = SIM("world/terrain.js");
    const { parseWpm, PathingGrid } = SIM("sim/pathing.js");
    const { STARTING_UNITS, raceFromW3i } = SIM("data/races.js");
    const { loadTechRegistry } = SIM("data/techtree.js");

    const name = MAP.split("/").pop();
    const map = new MpqDataSource(name, mapBytes);
    const { info: w3i, partial } = readW3i(map.rawBytes("war3map.w3i"));
    const terrain = parseW3E(map.rawBytes("war3map.w3e"));
    const grid = new PathingGrid(parseWpm(map.rawBytes("war3map.wpm")), terrain.centerOffset);
    console.log(
      `  w3i     : build ${w3i.getBuildVersion()} · tileset ${w3i.tileset} · ${w3i.players.length} slots${partial ? " (partial)" : ""}`,
    );
    console.log(
      `  terrain : ${terrain.width}×${terrain.height} · pathing ${grid.width}×${grid.height}`,
    );
    const used = w3i.players.filter((p) => p.type !== 0 && (p.startLocation[0] || p.startLocation[1]));
    for (const p of used) {
      const race = raceFromW3i(p.race);
      const [cx, cy] = grid.worldToCell(p.startLocation[0], p.startLocation[1]);
      console.log(
        `  slot ${p.id} : ${race} at (${p.startLocation[0].toFixed(0)}, ${p.startLocation[1].toFixed(0)}) · cell ${cx},${cy} walkable=${grid.walkable(cx, cy)}`,
      );
    }
    // Every race the map seats must have its whole melee roster in this install.
    const races = [...new Set(used.map((p) => raceFromW3i(p.race)))].filter((r) => r !== "random");
    const tech = loadTechRegistry(vfs);
    for (const race of races) {
      const roster = STARTING_UNITS[race];
      const missing = roster.flatMap(({ id }) => (registry.get(id) ? [] : [id]));
      console.log(
        `  ${race.padEnd(8)}: ${roster.map((r) => `${r.id}×${r.count}`).join(" + ")}${missing.length ? ` · MISSING ${missing.join(",")}` : " · ok"}`,
      );
      const hall = roster[0]?.id;
      if (hall) console.log(`  tech    : ${hall} trains ${JSON.stringify(tech.trains(hall))}`);
    }
    console.log(`  tech    : hbar trains ${JSON.stringify(tech.trains("hbar"))}`);
  }

  for (const h of handles.values()) await h.close();
  for (const h of readers) await h.close();
} finally {
  await server.close();
}
