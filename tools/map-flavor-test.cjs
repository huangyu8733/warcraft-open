// MAP FLAVOR (P4-1) — which game line a map belongs to, checked without an install.
//
// The rule is deliberately narrow (src/compat/mapFormat.ts `mapFlavor`): only a w3i version of
// 31+ or an editor build of 132+ says Reforged. Everything else — object data v3, terrain v12,
// a Lua script — also shipped on the classic line, so it must not move a map to HD. The
// direction of the doubt is what P4's exit depends on: an uncertain map is SD, and is then
// refused (with a reason) by an HD client rather than loaded against classic art.
//
// Run: pnpm sim:test

const { join } = require("node:path");
const fs = require("node:fs");
const REPO = join(__dirname, "..");
fs.writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');
const { mapFlavor, UNKNOWN_FORMAT } = require(join(REPO, ".sim-build", "src", "compat", "mapFormat.js"));

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`);
  if (!cond) failed++;
};

/** A profile with the two fields the rule reads; everything else is the unknown default. */
const at = (w3iVersion, editorBuild) => ({ ...UNKNOWN_FORMAT, w3iVersion, editorBuild });

console.log("a map with no information is not HD");
ok("UNKNOWN_FORMAT → sd", mapFlavor(UNKNOWN_FORMAT) === "sd");

console.log("the 2003–1.31 editors are the classic line");
ok("w3i 25 / build 0 (2003) → sd", mapFlavor(at(25, 0)) === "sd");
ok("w3i 25 / build 130 (1.30.4) → sd", mapFlavor(at(25, 130)) === "sd");
ok("w3i 28 / build 131 (1.31) → sd", mapFlavor(at(28, 131)) === "sd");

console.log("Reforged is the only thing that says HD");
ok("w3i 31 / build 132 (1.32) → hd", mapFlavor(at(31, 132)) === "hd");
ok("w3i 32 → hd", mapFlavor(at(32, 0)) === "hd");
ok("w3i 33 → hd", mapFlavor(at(33, 0)) === "hd");
ok("build 132 alone → hd", mapFlavor(at(25, 132)) === "hd");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("map flavor: ok");
