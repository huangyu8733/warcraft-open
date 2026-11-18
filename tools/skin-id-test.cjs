// A SKIN ID (P5-4): `BlzCreateUnitWithSkin` / `BlzSetUnitSkin` name the skin with a rawcode —
// `0x68666f6f` is `hfoo`. That is what the renderer looks up in the registry (a skin variant is
// an ordinary unit type in the map's or the install's data); 0 or anything that is not four
// printable characters means "no skin", not "look up nonsense".
//
// Run: pnpm sim:test  (compiles src/data/units.ts into .sim-build first)

const { join } = require("node:path");
const fs = require("node:fs");
const REPO = join(__dirname, "..");
fs.writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');
const { unitIdFromRaw } = require(join(REPO, ".sim-build", "src", "data", "units.js"));

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`);
  if (!cond) failed++;
};

ok("0x68666f6f → hfoo", unitIdFromRaw(0x68666f6f) === "hfoo");
ok("0x48666f6f → Hfoo", unitIdFromRaw(0x48666f6f) === "Hfoo");
ok("0 → no skin", unitIdFromRaw(0) === "");
ok("a code with a control byte → no skin", unitIdFromRaw(0x00010203) === "");
ok("a code with a high byte → no skin", unitIdFromRaw(0xffffffff) === "");

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("skin id: ok");
