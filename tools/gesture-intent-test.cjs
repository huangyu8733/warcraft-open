// Headless check of the gesture RECOGNISER — synthetic pointer sequences in, GestureIntent out
// (src/ui/gesture/recognizer.ts). 方案 §14.1 的 tools/gesture-intent-test.cjs。
//
// 只喂普通对象（不构造 PointerEvent），时钟也由这里给，所以识别器不依赖 window / DOM：
//   node tools/gesture-intent-test.cjs   （先 `npx tsc -p tools/tsconfig.gesture.json`）
//
// 断言的是「识别对了没有」，不是「游戏做了什么」——后者归 P2 的 gesture-action-test.cjs。
const { join } = require("node:path");
const fs = require("node:fs");
const REPO = join(__dirname, "..");
fs.writeFileSync(join(REPO, ".gesture-build", "package.json"), '{"type":"commonjs"}');
const { GestureRecognizer } = require(join(REPO, ".gesture-build", "src", "ui", "gesture", "recognizer.js"));
const {
  DEFAULT_THRESHOLDS,
  thresholdOverridesFor,
  thresholdsFor,
} = require(join(REPO, ".gesture-build", "src", "ui", "gesture", "intents.js"));

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** 一台假时钟 + 一个收集器；返回 { rec, out, at }。 */
function rig(options = {}) {
  let now = 0;
  const out = [];
  const rec = new GestureRecognizer({
    now: () => now,
    emit: (intent) => out.push(intent),
    ...options,
  });
  return { rec, out, at: (t) => { now = t; } };
}

const touch = (id, x, y, timeStamp, pointerType = "touch") => ({ pointerId: id, pointerType, clientX: x, clientY: y, timeStamp });
const kinds = (out) => out.map((i) => i.kind);

// ── 单指 ────────────────────────────────────────────────────────────────────────────────
console.log("single pointer");
{
  const { rec, out, at } = rig();
  at(0); rec.pointerDown(touch(1, 100, 100, 0));
  at(80); rec.pointerUp(touch(1, 101, 100, 80));
  check("tap", kinds(out).join(",") === "tap", JSON.stringify(kinds(out)));
  check("tap area/pointers", out[0]?.area === "world" && out[0]?.pointers === 1, JSON.stringify(out[0]));
}
{
  const { rec, out, at } = rig();
  at(0); rec.pointerDown(touch(1, 10, 10, 0));
  at(500); rec.pointerUp(touch(1, 11, 11, 500));
  check("longpress", kinds(out).join(",") === "longpress", JSON.stringify(kinds(out)));
}
{
  const { rec, out, at } = rig();
  at(0); rec.pointerDown(touch(1, 100, 100, 0));
  at(300); rec.pointerMove(touch(1, 100, 200, 300));
  at(600); rec.pointerUp(touch(1, 100, 200, 600));
  check("slow drag = dragbox", kinds(out).join(",") === "dragbox", JSON.stringify(kinds(out)));
  check("dragbox from/to", out[0]?.from?.y === 100 && out[0]?.to?.y === 200, JSON.stringify(out[0]));
}
{
  const { rec, out, at } = rig();
  at(0); rec.pointerDown(touch(1, 100, 100, 0));
  at(100); rec.pointerMove(touch(1, 100, 180, 100));
  at(150); rec.pointerUp(touch(1, 100, 180, 150));
  check("quick flick = swipe", kinds(out).join(",") === "swipe", JSON.stringify(kinds(out)));
  check("swipe velocity is px/ms", out[0]?.vx === 0 && out[0]?.vy > 0.4, JSON.stringify(out[0]));
}
{
  const { rec, out, at } = rig({ areaAt: (x) => (x > 500 ? "card" : "world") });
  at(0); rec.pointerDown(touch(1, 600, 600, 0));
  at(60); rec.pointerUp(touch(1, 600, 600, 60));
  check("area comes from areaAt", out[0]?.kind === "tap" && out[0]?.area === "card", JSON.stringify(out[0]));
}
{
  const { rec, out, at } = rig();
  at(0); rec.pointerDown(touch(1, 100, 100, 0));
  at(50); rec.pointerUp(touch(1, 100, 100, 50));
  at(200); rec.pointerDown(touch(1, 105, 100, 200));
  at(250); rec.pointerUp(touch(1, 105, 100, 250));
  check("double tap follows the two taps", kinds(out).join(",") === "tap,tap,doubletap", JSON.stringify(kinds(out)));
}
{
  const { rec, out, at } = rig();
  at(0); rec.pointerDown(touch(1, 100, 100, 0));
  at(50); rec.pointerUp(touch(1, 100, 100, 50));
  at(400); rec.pointerDown(touch(1, 100, 100, 400));
  at(450); rec.pointerUp(touch(1, 100, 100, 450));
  check("slow second tap is not a double tap", kinds(out).join(",") === "tap,tap", JSON.stringify(kinds(out)));
}

// ── 边缘按住（edgeHold）──────────────────────────────────────────────────────────────────
console.log("edge hold");
{
  const { rec, out, at } = rig({ edgePan: (x) => (x < 60 ? { dx: 1, dy: 0 } : null) });
  at(0); rec.pointerDown(touch(1, 40, 300, 0));
  check("edge candidate while held at the edge", rec.edgeCandidate() === true);
  at(120); check("edge hold waits for the dwell", rec.edgePanAt(120) === null);
  at(240);
  const pan = rec.edgePanAt(240);
  check("edge hold pans inward after the dwell", pan?.dx === 1 && pan?.dy === 0, JSON.stringify(pan));
  at(300); rec.pointerUp(touch(1, 40, 300, 300));
  check("edge hold swallows the tap", out.length === 0 && rec.pointerCount === 0, JSON.stringify(kinds(out)));
}
{
  // 帧循环被后台节流、没来得及标记：抬手时也必须补判，不能漏成轻点。
  const { rec, out, at } = rig({ edgePan: (x) => (x < 60 ? { dx: 0, dy: 1 } : null) });
  at(0); rec.pointerDown(touch(1, 40, 300, 0));
  at(240); rec.pointerUp(touch(1, 40, 300, 240));
  check("edge hold suppresses the tap without a frame", out.length === 0, JSON.stringify(kinds(out)));
}
{
  // 从边缘拖走是正常滑动 / 框选，不是边缘按压。
  const { rec, out, at } = rig({ edgePan: (x) => (x < 60 ? { dx: 1, dy: 0 } : null) });
  at(0); rec.pointerDown(touch(1, 40, 300, 0));
  at(100); rec.pointerMove(touch(1, 200, 300, 100));
  check("dragging off the edge is not an edge hold", rec.edgeCandidate() === false);
  at(120); rec.pointerUp(touch(1, 200, 300, 120));
  check("a drag off the edge stays a swipe", kinds(out).join(",") === "swipe", JSON.stringify(kinds(out)));
}
{
  // 边缘带之外的慢按仍是普通轻点。
  const { rec, out, at } = rig({ edgePan: (x) => (x < 60 ? { dx: 1, dy: 0 } : null) });
  at(0); rec.pointerDown(touch(1, 100, 300, 0));
  at(240); rec.pointerUp(touch(1, 100, 300, 240));
  check("a slow tap away from the edge is still a tap", kinds(out).join(",") === "tap", JSON.stringify(kinds(out)));
}
{
  // 起手在 HUD / 命令卡里：不做边缘按压（相机属于世界）。
  const { rec, at } = rig({ areaAt: () => "hud", edgePan: () => ({ dx: 1, dy: 0 }) });
  at(0); rec.pointerDown(touch(1, 40, 300, 0));
  check("edge hold is world only", rec.edgeCandidate() === false);
}
{
  // 多指序列不是边缘按压。
  const { rec, at } = rig({ edgePan: () => ({ dx: 1, dy: 0 }) });
  at(0); rec.pointerDown(touch(1, 40, 300, 0)); rec.pointerDown(touch(2, 60, 300, 0));
  check("two pointers are never an edge hold", rec.edgeCandidate() === false);
}

// ── 双指 ────────────────────────────────────────────────────────────────────────────────
console.log("two pointers");
{
  const { rec, out, at } = rig();
  at(0);
  rec.pointerDown(touch(1, 100, 100, 0));
  rec.pointerDown(touch(2, 200, 100, 0));
  at(100); rec.pointerMove(touch(1, 92, 100, 100));
  at(140); rec.pointerMove(touch(2, 208, 100, 140));
  check("pinch", kinds(out).join(",") === "pinch", JSON.stringify(kinds(out)));
  check("pinch one step", out[0]?.steps === 1 && Math.abs((out[0]?.scale ?? 0) - 1.16) < 0.001, JSON.stringify(out[0]));
}
{
  const { rec, out, at } = rig();
  at(0);
  rec.pointerDown(touch(1, 100, 100, 0));
  rec.pointerDown(touch(2, 200, 100, 0));
  at(100); rec.pointerMove(touch(1, 140, 100, 100));
  at(140); rec.pointerMove(touch(2, 240, 100, 140));
  check("two-finger pan", kinds(out).every((k) => k === "twoFingerPan") && out.length === 2, JSON.stringify(kinds(out)));
  const dx = out.reduce((n, i) => n + (i.vx ?? 0), 0);
  check("pan delta sums to the centroid travel", Math.abs(dx - 40) < 0.001, String(dx));
}
{
  const { rec, out, at } = rig();
  at(0);
  rec.pointerDown(touch(1, 100, 100, 0));
  rec.pointerDown(touch(2, 200, 100, 0));
  at(80); rec.pointerUp(touch(1, 100, 100, 80));
  at(120); rec.pointerUp(touch(2, 200, 100, 120));
  check("two-finger tap", kinds(out).join(",") === "twoFingerTap", JSON.stringify(kinds(out)));
}
{
  // HYSTERESIS：先捏合，之后整组平移，不该再冒出 twoFingerPan。
  const { rec, out, at } = rig();
  at(0);
  rec.pointerDown(touch(1, 100, 100, 0));
  rec.pointerDown(touch(2, 200, 100, 0));
  at(100); rec.pointerMove(touch(1, 92, 100, 100));
  at(140); rec.pointerMove(touch(2, 208, 100, 140));
  at(200); rec.pointerMove(touch(1, 132, 100, 200));
  at(240); rec.pointerMove(touch(2, 248, 100, 240));
  check("pinch is locked for the sequence", kinds(out).every((k) => k === "pinch"), JSON.stringify(kinds(out)));
}

// ── 三/四指 ──────────────────────────────────────────────────────────────────────────────
console.log("three pointers");
{
  const { rec, out, at } = rig();
  at(0);
  rec.pointerDown(touch(1, 100, 100, 0));
  rec.pointerDown(touch(2, 200, 100, 0));
  rec.pointerDown(touch(3, 150, 200, 0));
  at(40); rec.pointerUp(touch(1, 100, 100, 40));
  at(60); rec.pointerUp(touch(2, 200, 100, 60));
  at(80); rec.pointerUp(touch(3, 150, 200, 80));
  check("three-finger tap", kinds(out).join(",") === "threeFingerTap", JSON.stringify(kinds(out)));
}
console.log("four pointers");
{
  const { rec, out, at } = rig();
  at(0);
  rec.pointerDown(touch(1, 100, 100, 0));
  rec.pointerDown(touch(2, 200, 100, 0));
  rec.pointerDown(touch(3, 150, 200, 0));
  rec.pointerDown(touch(4, 150, 50, 0));
  at(40); rec.pointerUp(touch(1, 100, 100, 40));
  at(60); rec.pointerUp(touch(2, 200, 100, 60));
  at(80); rec.pointerUp(touch(3, 150, 200, 80));
  at(100); rec.pointerUp(touch(4, 150, 50, 100));
  check("four-finger tap", kinds(out).join(",") === "fourFingerTap", JSON.stringify(kinds(out)));
}

// ── 门控与打断 ───────────────────────────────────────────────────────────────────────────
console.log("gates");
{
  const { rec, out, at } = rig();
  at(0);
  const handled = rec.pointerDown(touch(1, 100, 100, 0, "mouse"));
  at(50); rec.pointerUp(touch(1, 100, 100, 50, "mouse"));
  check("mouse is not a gesture", handled === false && out.length === 0, JSON.stringify(kinds(out)));
}
{
  const { rec, out, at } = rig({ enabled: () => false });
  at(0);
  const handled = rec.pointerDown(touch(1, 100, 100, 0));
  at(80); rec.pointerUp(touch(1, 100, 100, 80));
  check("disabled recogniser ignores everything", handled === false && out.length === 0, JSON.stringify(kinds(out)));
}
{
  const { rec, out, at } = rig();
  at(0);
  rec.pointerDown(touch(1, 100, 100, 0));
  rec.pointerDown(touch(2, 200, 100, 0));
  rec.pointerCancel(1);
  rec.pointerCancel(2);
  check("pointercancel produces nothing", out.length === 0, JSON.stringify(kinds(out)));
}
{
  // 系统只收回一根也不能把剩下的手指读成轻点（§12：整组作废）。
  const { rec, out, at } = rig();
  at(0);
  rec.pointerDown(touch(1, 100, 100, 0));
  rec.pointerDown(touch(2, 200, 100, 0));
  at(20); rec.pointerCancel(1);
  at(40); rec.pointerUp(touch(2, 200, 100, 40));
  check("one cancelled pointer clears the whole sequence",
    out.length === 0 && rec.pointerCount === 0 && rec.claims() === false,
    JSON.stringify(kinds(out)));
}
{
  const { rec, at } = rig();
  at(0); rec.pointerDown(touch(1, 100, 100, 0));
  check("one pointer does not claim", rec.claims() === false, String(rec.pointerCount));
  rec.pointerDown(touch(2, 200, 100, 0));
  check("two pointers claim", rec.claims() === true, String(rec.pointerCount));
  rec.reset();
  check("reset clears the sequence", rec.pointerCount === 0 && rec.claims() === false, String(rec.pointerCount));
}
{
  // 热区之外（系统手势禁区）不接管。
  const { rec, at } = rig({ isHotZone: (x) => x > 50 });
  at(0);
  rec.pointerDown(touch(1, 10, 100, 0));
  rec.pointerDown(touch(2, 20, 100, 0));
  check("outside the hot zone does not claim", rec.claims() === false, String(rec.pointerCount));
}

// ── 设备阈值（§5.2：平板 16px 容差，玩家改过滑条才覆盖）────────────────────────────────
console.log("thresholds");
{
  check("phone keeps the shipped tap slop",
    thresholdsFor("phone").tapSlopPx === DEFAULT_THRESHOLDS.tapSlopPx,
    String(thresholdsFor("phone").tapSlopPx));
  check("tablet widens the tap slop",
    thresholdsFor("tablet").tapSlopPx === 16,
    String(thresholdsFor("tablet").tapSlopPx));
  const untouched = thresholdOverridesFor({
    tapSlopPx: DEFAULT_THRESHOLDS.tapSlopPx,
    longPressMs: DEFAULT_THRESHOLDS.longPressMs,
  });
  check("shipped slider defaults are not overrides",
    untouched.tapSlopPx === undefined && untouched.longPressMs === undefined,
    JSON.stringify(untouched));
  check("an untouched tablet keeps 16px after the profile is applied",
    thresholdsFor("tablet", untouched).tapSlopPx === 16,
    String(thresholdsFor("tablet", untouched).tapSlopPx));
  const moved = thresholdOverridesFor({ tapSlopPx: 20, longPressMs: 600 });
  const tablet = thresholdsFor("tablet", moved);
  check("a moved slider wins on every device",
    tablet.tapSlopPx === 20 && tablet.longPressMs === 600,
    JSON.stringify(moved));
}

console.log("");
if (fails) {
  console.log(`${fails} failed`);
  process.exit(1);
}
console.log("all gesture intent checks passed");
