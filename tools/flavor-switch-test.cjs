// The renderer half of the launcher's SD / HD switch (P0-6, P6-2).
//
// What can be wrong silently is the CHOICE: a `?flavor=` link not overriding a remembered line,
// a stored value read as HD when it says something else, or `setFlavor` writing a key the next
// launch will not read. The real "no old assets after a switch" is a whole page / renderer reload
// and is verified on the machine (specs/p6-regression); this file pins the rules that reload
// comes back to.
//
// Its own process, and a fresh module per scenario: `data/flavor.ts` reads `location` and
// `localStorage` at module init and keeps `current` in module scope.
//
// Run: node tools/flavor-switch-test.cjs (needs `tsc -p tools/tsconfig.sim.json` first).

const { join } = require("node:path");
const { writeFileSync } = require("node:fs");

const REPO = process.cwd();
// The throwaway build is CommonJS while the repo is `"type": "module"` (as every other
// .sim-build test does), so `require()` may load its .js files.
writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');
const MOD = join(REPO, ".sim-build", "src", "data", "flavor.js");

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`);
  if (!cond) failed++;
};

function load({ query = "", stored = null } = {}) {
  delete require.cache[require.resolve(MOD)];
  const store = new Map();
  if (stored !== null) store.set("warcraft-open.flavor", stored);
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  globalThis.location = { search: query };
  return { mod: require(MOD), store };
}

console.log("the direct link wins for this launch");
{
  const { mod, store } = load({ query: "?flavor=hd", stored: null });
  ok("?flavor=hd boots HD", mod.flavor() === "hd" && mod.isHd());
  ok("…and does not rewrite the remembered line", !store.has("warcraft-open.flavor"));
}

console.log("the remembered line is used when no link asks");
{
  const hd = load({ stored: "hd" });
  ok("stored hd boots HD", hd.mod.flavor() === "hd");

  const sd = load({ stored: "sd" });
  ok("stored sd boots SD", sd.mod.flavor() === "sd" && !sd.mod.isHd());

  const junk = load({ stored: "2.0.4" });
  ok("anything else is SD", junk.mod.flavor() === "sd");
}

console.log("a link overrides a remembered line without forgetting it");
{
  const { mod, store } = load({ query: "?flavor=sd", stored: "hd" });
  ok("?flavor=sd boots SD", mod.flavor() === "sd");
  ok("the remembered HD line stays for the next launch", store.get("warcraft-open.flavor") === "hd");
}

console.log("setFlavor writes the key the next launch reads");
{
  const { mod, store } = load({ stored: "sd" });
  let heard = 0;
  const off = mod.onFlavorChange(() => heard++);
  mod.setFlavor("hd");
  ok("the live line changes", mod.flavor() === "hd" && mod.isHd());
  ok("…and is persisted", store.get("warcraft-open.flavor") === "hd");
  ok("…and subscribers hear it once", heard === 1);

  mod.setFlavor("hd");
  ok("setting the same line is a no-op", heard === 1);

  off();
  mod.setFlavor("sd");
  ok("an unsubscribed listener is not called", heard === 1);
  ok("…but the line still changes", mod.flavor() === "sd" && store.get("warcraft-open.flavor") === "sd");
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("flavor switch: ok");
