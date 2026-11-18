// A REPLAY'S LINE (P5-3): an SD replay belongs to an SD client, an HD replay to the same
// Reforged build it was played on. Anything else is refused, with the same rule at every door
// (ui/fdfViewReplay.ts, main.ts, the replay window).
//
// Run: pnpm sim:test  (compiles src/game/replay.ts into .sim-build first)

const { join } = require("node:path");
const fs = require("node:fs");
const REPO = join(__dirname, "..");
fs.writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');
const B = (...p) => require(join(REPO, ".sim-build", "src", ...p));
const { REPLAY_FORMAT, encodeReplay, decodeReplay, replayLine, replayMismatch, replayRefusalText } = B("game", "replay.js");

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`);
  if (!cond) failed++;
};

const HEADER = {
  format: REPLAY_FORMAT, version: "test", recordedAt: "2026-01-01T00:00:00.000Z",
  map: { path: "test.w3x", name: "Test", hash: "0", size: 0 },
  config: { seed: 7 }, seats: [], localPlayer: 0, observer: false, edition: "tft", patch: "test",
  flavor: "hd", gameVersion: "3.0.1",
};
const replay = (header) => ({ header, events: [], checks: [], inputs: [], states: [], ending: null });

(async () => {
  console.log("the two fields survive a file");
  {
    const back = await decodeReplay(await encodeReplay(replay(HEADER)));
    ok("flavor round-trips", back.header.flavor === "hd");
    ok("gameVersion round-trips", back.header.gameVersion === "3.0.1");
  }

  console.log("an old replay is SD, and an SD replay never asks about builds");
  {
    const old = { ...HEADER };
    delete old.flavor;
    delete old.gameVersion;
    ok("no field → sd", replayLine(old) === "sd");
    ok("sd replay on sd → playable", replayMismatch(old, "sd", "1.30.4") === null);
    ok("sd replay on hd → flavor", replayMismatch(old, "hd", "3.0.1") === "flavor");
  }

  console.log("HD is one build");
  {
    ok("same build → playable", replayMismatch(HEADER, "hd", "3.0.1") === null);
    ok("other build → version", replayMismatch(HEADER, "hd", "3.0.2") === "version");
    ok("other line → flavor", replayMismatch(HEADER, "sd", "3.0.1") === "flavor");
  }

  console.log("the doors with no menu get a sentence");
  {
    ok("no refusal → null", replayRefusalText(HEADER, "hd", "3.0.1") === null);
    ok("cross line says so", /other version line/.test(replayRefusalText(HEADER, "sd", "3.0.1")));
    ok("cross build names both", replayRefusalText(HEADER, "hd", "3.0.2") === "This replay was recorded on Reforged 3.0.1; this client is 3.0.2.");
  }

  if (failed) {
    console.error(`${failed} failed`);
    process.exit(1);
  }
  console.log("replay flavor: ok");
})();
