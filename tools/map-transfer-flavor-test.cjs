// MAP TRANSFER ACROSS THE LINE (P5-2): a map carries its line, and neither end will hand a map
// to, or accept one from, the other line. A room on the other line is already unfindable
// (src/net/lobby.ts), so this is the second lock — the one that holds when a relay or a client
// is old, forged, or just confused.
//
// Run: pnpm sim:test  (compiles src/net/mapTransfer.ts into .sim-build first)

const { join } = require("node:path");
const fs = require("node:fs");
const REPO = join(__dirname, "..");
fs.writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');
const { answerMapGet, fetchMap, MAP_CHUNK } = require(join(REPO, ".sim-build", "src", "net", "mapTransfer.js"));

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${detail ? `   ${detail}` : ""}`);
  if (!cond) failed++;
};

const PATH = "Maps\\Custom\\(3)Test.w3x";
const bytes = new Uint8Array([1, 2, 3, 4, 5, 250, 251, 252]);
/** What the host holds: only `arrayBuffer()` is read (mapTransfer.bytesOf). */
const file = { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };

(async () => {
  console.log("a host answers on its own line, and stamps every piece");
  {
    const part = await answerMapGet(file, PATH, { k: "mapget", path: PATH, chunk: 0, flavor: "sd" }, "sd");
    ok("same line: served", !part.error && part.size === bytes.length);
    ok("…stamped with the host's line", part.flavor === "sd");
    ok("…bytes intact", Buffer.from(part.data, "base64").equals(Buffer.from(bytes)));

    const old = await answerMapGet(file, PATH, { k: "mapget", path: PATH, chunk: 0 }, "sd");
    ok("an older client with no flavor is read as SD", !old.error && old.flavor === "sd");
  }

  console.log("\na host on the other line refuses, and says why");
  {
    const part = await answerMapGet(file, PATH, { k: "mapget", path: PATH, chunk: 0, flavor: "hd" }, "sd");
    ok("SD host / HD ask: refused", part.error === "The host's game is on a different version line.", part.error);
    ok("…as an SD answer, so the joiner can report it", part.flavor === "sd" && part.size === 0);

    const hd = await answerMapGet(file, PATH, { k: "mapget", path: PATH, chunk: 0, flavor: "sd" }, "hd");
    ok("HD host / SD ask: refused", hd.error === "The host's game is on a different version line.");
  }

  console.log("\na joiner stops at the first piece from the other line");
  {
    const fd = await answerMapGet(file, PATH, { k: "mapget", path: PATH, chunk: 0, flavor: "hd" }, "hd");
    let listener = null;
    const wire = {
      ask(msg) { setTimeout(() => listener({ ...fd, chunk: msg.chunk }), 0); },
      listen(fn) { listener = fn; },
      arrived() {},
    };
    const err = await fetchMap(wire, PATH, () => {}, new AbortController().signal, "sd").catch((e) => e.message);
    ok("an HD piece on an SD client rejects the download", err === "The host's game is on a different version line.", err);
  }

  console.log("\nthe same line still downloads");
  {
    const whole = new Uint8Array(MAP_CHUNK + 17);
    for (let i = 0; i < whole.length; i++) whole[i] = (i * 7) & 0xff;
    const src = { arrayBuffer: async () => whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.byteLength) };
    let listener = null;
    const wire = {
      ask(msg) {
        void answerMapGet(src, PATH, msg, "hd").then((part) => setTimeout(() => listener(part), 0));
      },
      listen(fn) { listener = fn; },
      arrived() {},
    };
    const got = await fetchMap(wire, PATH, () => {}, new AbortController().signal, "hd");
    ok("HD → HD: every byte", got.length === whole.length && got.every((b, i) => b === whole[i]));
  }

  if (failed) {
    console.error(`${failed} failed`);
    process.exit(1);
  }
  console.log("map transfer flavor: ok");
})();
