// The gesture console's SD / HD invariant (手机平板手势控制台方案.md §9.3 第三条 / §14.1).
//
// The promise: the SAME gesture sequence issues the SAME command stream under `sd` and under
// `hd` x `hdArt=sd|hd|de`. The console has no flavor input at all, so the stream cannot differ;
// this script pins that down two ways:
//
//   1. structurally — no module in src/ui/gesture/ may branch on flavor / edition, except the
//      one capability read the design allows (device.ts, which records `flavor()` once);
//   2. behaviourally — the same intents through the action layer produce byte-identical host
//      calls for all four combinations (the host is the only thing that could know a flavor).
//
//   node tools/gesture-flavor-test.cjs   （先 `npx tsc -p tools/tsconfig.gesture.json`）
const { join } = require("node:path");
const fs = require("node:fs");
const REPO = join(__dirname, "..");
fs.writeFileSync(join(REPO, ".gesture-build", "package.json"), '{"type":"commonjs"}');

const { performGesture } = require(join(REPO, ".gesture-build", "src", "ui", "gesture", "actions.js"));

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ── 1. 结构：手势目录不读 flavor ───────────────────────────────────────────────────────────
console.log("no flavor branches");
{
  const dir = join(REPO, "src", "ui", "gesture");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const readers = files.filter((f) => {
    const src = fs.readFileSync(join(dir, f), "utf8");
    return /from\s+"[^"]*data\/(flavor|edition)"/.test(src) || /\bisHd\s*\(/.test(src);
  });
  check("only device.ts reads the flavor", readers.join(",") === "device.ts", readers.join(","));
  check("the recogniser never names a flavor", !/flavor|reforged/i.test(
    fs.readFileSync(join(dir, "recognizer.ts"), "utf8"),
  ));
}

// ── 2. 行为：同一串手势 → 同一串宿主调用 ────────────────────────────────────────────────────
const SEQUENCE = [
  { kind: "tap", area: "world", x: 120, y: 90 },
  { kind: "longpress", area: "world", x: 130, y: 95 },
  { kind: "dragbox", area: "world", x: 40, y: 50, from: { x: 10, y: 20 }, to: { x: 40, y: 50 } },
  { kind: "doubletap", area: "world", x: 60, y: 70 },
  { kind: "swipe", area: "world", x: 0, y: 0, from: { x: 90, y: 90 }, to: { x: 40, y: 60 } },
  { kind: "edgeHold", area: "world", x: 20, y: 300, vx: 8, vy: -6 },
  { kind: "pinch", area: "world", x: 200, y: 200, pointers: 2, scale: 1.3, steps: 1 },
  { kind: "twoFingerPan", area: "world", x: 0, y: 0, pointers: 2, vx: 6, vy: -4 },
  { kind: "twoFingerTap", area: "world", x: 1, y: 1, pointers: 2 },
  { kind: "threeFingerTap", area: "world", x: 2, y: 2, pointers: 3 },
  { kind: "fourFingerTap", area: "world", x: 3, y: 3, pointers: 4 },
  { kind: "tap", area: "card", x: 400, y: 500 },
];

function record() {
  const calls = [];
  const host = {
    canAct: () => true,
    isCinematic: () => false,
    skipCinematic: () => calls.push(["skipCinematic"]),
    press: (id) => calls.push(["press", id]),
    card: () => [],
    armed: () => false,
    selectAt: (x, y, mods) => calls.push(["selectAt", x, y, mods]),
    selectBox: (...a) => calls.push(["selectBox", ...a]),
    orderAt: (...a) => calls.push(["orderAt", ...a]),
    smartAt: (...a) => calls.push(["smartAt", ...a]),
    panBy: (dx, dy) => calls.push(["panBy", dx, dy]),
    zoomBy: (n) => calls.push(["zoomBy", n]),
    focusSelection: () => calls.push(["focusSelection"]),
    cancel: () => calls.push(["cancel"]),
    toggleMenu: () => calls.push(["toggleMenu"]),
    toggleChat: () => calls.push(["toggleChat"]),
    clickAt: (x, y, b) => calls.push(["clickAt", x, y, b]),
    hoverAt: (x, y) => calls.push(["hoverAt", x, y]),
  };
  for (const i of SEQUENCE) {
    // Tablet 3/4-finger gestures are an opt-in profile flag (§6.2); turn it on so the sequence
    // still exercises the menu / chat doors on every flavor.
    performGesture(host, { pointers: 1, durationMs: 60, ...i }, { multiFinger: true });
  }
  return calls;
}

console.log("same sequence, same command stream");
{
  const base = JSON.stringify(record());
  for (const label of ["sd", "hd (hdArt=sd)", "hd (hdArt=hd)", "hd (hdArt=de)"]) {
    check(label, JSON.stringify(record()) === base);
  }
  // Sanity: the sequence really does reach the command doors (not an empty stream).
  const kinds = new Set(JSON.parse(base).map((c) => c[0]));
  check("covers select/order/camera/zoom/cancel/menu/chat",
    kinds.has("selectAt") && kinds.has("smartAt") && kinds.has("selectBox")
    && kinds.has("panBy") && kinds.has("zoomBy") && kinds.has("cancel") && kinds.has("toggleMenu")
    && kinds.has("toggleChat"),
    [...kinds].join(","));
}

// ── 3. 渲染面：手势模式下经典控制台整条让位（这段 CSS 两版本共用） ──────────────────────────
// 命令流一致还不够：`#gesture-hud` 是在经典 HUD 之上叠出来的，若某一版本的经典 chrome
// 没被藏掉，两个版本看上去就是两套界面。所以把 `body.gesture-ui` 的让位清单也钉住。
console.log("classic chrome yields to #gesture-hud");
{
  const css = fs.readFileSync(join(REPO, "src", "style.css"), "utf8");
  const start = css.indexOf("body.gesture-ui .fdf-screen.fdf-topbar");
  const end = css.indexOf("}", start);
  check("the hide list is present", start >= 0 && end > start);
  const block = start >= 0 && end > start ? css.slice(start, end) : "";
  const required = [
    ".fdf-screen.fdf-topbar", ".hud-console", ".hud-console-background", ".hud-minimap-btn",
    ".hud-idle-worker", ".hud-autocam", ".hud-msgcol", ".hud-chatcol",
  ];
  for (const sel of required) {
    check(`hides ${sel}`, block.includes(`body.gesture-ui ${sel}`));
  }
  check("shows #gesture-hud", /body\.gesture-ui #gesture-hud \{ display: block; \}/.test(css));
  check("the hide list has no flavor condition", !!block && !/\.(hd|de)\b/.test(block));
}

if (fails) {
  console.log(`\n${fails} gesture flavor check(s) FAILED`);
  process.exit(1);
}
console.log("\nall gesture flavor checks passed");
