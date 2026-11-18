// Headless check of the match viewer's path solver (src/render/assetSolver.ts): the running
// MAP's archive is asked first, then the install, and a path always resolves to the same blob
// URL while one map is mounted.
//
// The bug it pins: the scene's solver read only the install, so every unit a trigger created
// (or a shop sold) whose model the map imports — Test of Balance's drafted heroes,
// `war3mapImported\Santa.mdx` — had no model, so no body, so no command card at all, while the
// same model on a PRE-PLACED unit was fine (the viewer's own map handler asks the map first).
//
// Run: pnpm sim:test
const { join } = require("node:path");
const { resolveObjectURL } = require("node:buffer");
const REPO = join(__dirname, "..");
require("node:fs").writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');
const { createAssetSolver } = require(join(REPO, ".sim-build", "src", "render", "assetSolver.js"));

let failed = 0;
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${what}`);
  if (!ok) console.log(`        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`);
}

/** A DataSource over a { path: text } table — MPQ lookups are case-insensitive. */
function source(label, files) {
  const lower = new Map(Object.entries(files).map(([k, v]) => [k.toLowerCase(), new TextEncoder().encode(v)]));
  return {
    label,
    exists: (p) => lower.has(p.toLowerCase()),
    rawBytes: (p) => lower.get(p.toLowerCase()) ?? null,
    read: async (p) => lower.get(p.toLowerCase()),
    list: () => [...lower.keys()],
  };
}
const text = async (url) => (typeof url === "string" && url.startsWith("blob:") ? await resolveObjectURL(url).text() : url);

(async () => {
  const install = source("install", {
    "Units\\Human\\Footman\\Footman.mdx": "install footman",
    "Units\\Human\\Peasant\\Peasant.mdx": "install peasant",
  });
  const mapA = source("A", {
    "war3mapImported\\Santa.mdx": "map A santa",
    "Units\\Human\\Peasant\\Peasant.mdx": "map A peasant",
  });
  const mapB = source("B", { "war3mapImported\\Santa.mdx": "map B santa" });
  const created = [];
  const layer = { archive: null, epoch: 0 };
  const solve = createAssetSolver(install, layer, new Map(), created);

  console.log("no map mounted (the menu)");
  check("an install path resolves to the install's bytes", await text(solve("Units\\Human\\Footman\\Footman.mdx")), "install footman");
  check("a map-only path is handed back unresolved", solve("war3mapImported\\Santa.mdx"), "war3mapImported\\Santa.mdx");

  console.log("\na map mounted");
  layer.archive = mapA;
  layer.epoch++;
  check("the map's imported model resolves — the drafted hero gets a body", await text(solve("war3mapImported\\Santa.mdx")), "map A santa");
  check("…under either slash", await text(solve("war3mapImported/Santa.mdx")), "map A santa");
  check("a stock path the map REPLACES is the map's file", await text(solve("Units\\Human\\Peasant\\Peasant.mdx")), "map A peasant");
  check("a stock path the map does not have is still the install's", await text(solve("Units\\Human\\Footman\\Footman.mdx")), "install footman");
  check("one path is one URL (the viewer dedupes by it)", solve("war3mapImported\\Santa.mdx") === solve("WAR3MAPIMPORTED\\santa.mdx"), true);
  check("a path in neither is handed back unresolved", solve("war3mapImported\\Nope.blp"), "war3mapImported\\Nope.blp");

  console.log("\nthe next map");
  layer.archive = mapB;
  layer.epoch++;
  check("the same name in the next map is the NEXT map's file", await text(solve("war3mapImported\\Santa.mdx")), "map B santa");
  check("…and the first map's replacement is gone", await text(solve("Units\\Human\\Peasant\\Peasant.mdx")), "install peasant");

  console.log("\nback to the menu");
  layer.archive = null;
  check("nothing of the map is left", solve("war3mapImported\\Santa.mdx"), "war3mapImported\\Santa.mdx");
  check("every URL minted is on the revocation list", new Set(created).size, created.length);

  // P6: the DE/HD Sheep models still name SD-era texture paths. The store files the corpse maps
  // under Textures\, and the flying-sheep maps under FlyingSheep\ (DE calls them Sheep_*).
  console.log("\nHD critter textures the store files elsewhere");
  const corpse = "Units\\Critters\\Sheep\\Sheep_Corpse_Diffuse.tif";
  const flying = "Units\\Critters\\Sheep\\Unit_FlyingSheep_main_Diffuse.tif";
  const installHd = source("hd", {
    "Textures\\Sheep_Corpse_Diffuse.dds": "corpse",
    "Units\\Critters\\FlyingSheep\\Unit_FlyingSheep_main_Diffuse.dds": "flying hd",
    "Units\\Critters\\FlyingSheep\\Sheep_Diffuse.dds": "flying de",
  });
  const solveHd = createAssetSolver(installHd, { archive: null, epoch: 0 }, new Map(), [], true);
  check("a sheep corpse map resolves from Textures\\", await text(solveHd(corpse)), "corpse");
  check("a flying-sheep map prefers the HD name", await text(solveHd(flying)), "flying hd");
  const installDe = source("de", {
    "Textures\\Sheep_Corpse_Diffuse.dds": "corpse",
    "Units\\Critters\\FlyingSheep\\Sheep_Diffuse.dds": "flying de",
  });
  const solveDe = createAssetSolver(installDe, { archive: null, epoch: 0 }, new Map(), [], true);
  check("…and falls back to DE's Sheep_*.dds", await text(solveDe(flying)), "flying de");

  // P6: Reforged building models kept the artist's absolute disk path. Everything after the
  // `/de/` art root is the store's path (`Buildings\Undead\Crypt\CryptBirth.mdx` and friends).
  console.log("\nHD models with the artist's absolute path");
  const installAbs = source("abs", {
    "Buildings\\Undead\\Crypt\\CryptBirth.mdx": "crypt birth",
    "Buildings\\Undead\\UBirth\\UBirth.mdx": "ubirth",
    "Buildings\\Undead\\AltarOfDarkness\\AltarOfDarknessDeath.mdx": "altar death",
  });
  const solveAbs = createAssetSolver(installAbs, { archive: null, epoch: 0 }, new Map(), [], true);
  check("an absolute /art/de/ model resolves from its art root",
    await text(solveAbs("c:/users/dok/perforce/art/de/buildings/undead/crypt/cryptbirth.mdx")), "crypt birth");
  check("an absolute double-slash /de// model too",
    await text(solveAbs("h:/bz/de//buildings/undead/ubirth/ubirth.mdx")), "ubirth");
  check("…and so does an altar death model",
    await text(solveAbs("c:/users/dok/perforce/art/de/Buildings/Undead/AltarOfDarkness/AltarOfDarknessDeath.mdx")), "altar death");

  // 3.0's ability data still names effect models with the SD-era `.mdl`, while the store ships
  // `.mdx` only — the town portal's caster/target, Immolation's target, every `Targetart`.
  console.log("\nHD effect models the data still names as .mdl");
  const installFx = source("fx", { "Abilities\\Spells\\Items\\AIhe\\AIheTarget.mdx": "heal target" });
  const solveFx = createAssetSolver(installFx, { archive: null, epoch: 0 }, new Map(), [], true);
  check("a .mdl effect path resolves to the store's .mdx",
    await text(solveFx("Abilities\\Spells\\Items\\AIhe\\AIheTarget.mdl")), "heal target");

  if (failed) {
    console.log(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall asset-solver checks passed");
})();
