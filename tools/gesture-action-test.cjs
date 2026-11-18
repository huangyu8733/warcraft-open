// Headless check of the gesture ACTION layer — GestureIntent in, GestureMatchHost calls out
// (src/ui/gesture/actions.ts). 方案 §14.1 的 tools/gesture-action-test.cjs。
//
// 断言两件事：
//   1. 每种手势只落到它该落的那一扇既有门上（不多调、不发明命令）；
//   2. 门控为假时**零调用**，且派发出去的点击/按键在回放输入轨里归因为 "gesture"。
//
//   node tools/gesture-action-test.cjs   （先 `npx tsc -p tools/tsconfig.gesture.json`）
const { join } = require("node:path");
const fs = require("node:fs");
const REPO = join(__dirname, "..");
fs.writeFileSync(join(REPO, ".gesture-build", "package.json"), '{"type":"commonjs"}');

const { performGesture } = require(join(REPO, ".gesture-build", "src", "ui", "gesture", "actions.js"));
const { commandSource, selectionSource } = require(join(REPO, ".gesture-build", "src", "ui", "inputSource.js"));

let fails = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else { fails++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** A recording host; `over` overrides individual methods (gates, armed, attribution probes). */
function rig(over = {}) {
  const calls = [];
  const host = {
    canAct: () => true,
    isCinematic: () => false,
    skipCinematic: () => (calls.push(["skipCinematic"]), true),
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
    ...over,
  };
  return { host, calls };
}

const intent = (kind, area = "world", extra = {}) => ({
  kind, x: 10, y: 20, pointers: 1, durationMs: 60, area, ...extra,
});
const one = (calls) => (calls.length === 1 ? calls[0] : null);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── 单指 ────────────────────────────────────────────────────────────────────────────────
console.log("single finger");
{
  const { host, calls } = rig();
  performGesture(host, intent("tap"));
  check("tap world unarmed = selectAt", eq(one(calls), ["selectAt", 10, 20, {}]), JSON.stringify(calls));
}
{
  const { host, calls } = rig({ armed: () => true });
  performGesture(host, intent("tap"));
  check("tap world armed = orderAt", eq(one(calls), ["orderAt", 10, 20, false]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  const ok = performGesture(host, intent("tap", "hud"));
  check("tap hud stays the HUD's own pointerdown", calls.length === 0 && ok === false, JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  const ok = performGesture(host, intent("doubletap", "card"));
  check("doubletap card stays the HUD's own", calls.length === 0 && ok === false, JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("longpress"));
  check("longpress world = smartAt", eq(one(calls), ["smartAt", 10, 20, false]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("longpress", "card"));
  check("longpress hud = hoverAt", eq(one(calls), ["hoverAt", 10, 20]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("dragbox", "world", { from: { x: 1, y: 2 }, to: { x: 30, y: 40 } }));
  check("dragbox = selectBox", eq(one(calls), ["selectBox", 1, 2, 30, 40, false]), JSON.stringify(calls));
}
{
  // A drag that began on the minimap / HUD belongs to that control; its coordinates are client
  // pixels, so handing them to selectBox would box-select somewhere unrelated in the world.
  const { host, calls } = rig();
  const ok = performGesture(host, intent("dragbox", "minimap", { from: { x: 1, y: 2 }, to: { x: 30, y: 40 } }));
  check("dragbox outside the world stays with that control", ok === false && calls.length === 0, JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("doubletap"));
  check("doubletap world = sameType select", eq(one(calls), ["selectAt", 10, 20, { sameType: true }]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("swipe", "world", { from: { x: 100, y: 100 }, to: { x: 60, y: 80 } }));
  check("swipe = camera pan", eq(one(calls), ["panBy", -40, -20]), JSON.stringify(calls));
}
{
  // 边缘持续平移：index.ts 的帧循环发来的位移，与双指平移同一条 panBy 通道。
  const { host, calls } = rig();
  performGesture(host, intent("edgeHold", "world", { vx: 12, vy: -4 }));
  check("edge hold = camera pan", eq(one(calls), ["panBy", 12, -4]), JSON.stringify(calls));
}

// ── 多指 ────────────────────────────────────────────────────────────────────────────────
console.log("multi-finger");
{
  const { host, calls } = rig();
  performGesture(host, intent("pinch", "world", { pointers: 2, scale: 1.3, steps: 2 }));
  check("pinch = zoomBy steps", eq(one(calls), ["zoomBy", 2]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("twoFingerPan", "world", { pointers: 2, vx: 7, vy: -3 }));
  check("two-finger pan = panBy deltas", eq(one(calls), ["panBy", 7, -3]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("twoFingerTap", "world", { pointers: 2 }));
  check("two-finger tap = cancel", eq(one(calls), ["cancel"]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("threeFingerTap", "world", { pointers: 3 }), { multiFinger: true });
  check("three-finger tap = F10 menu", eq(one(calls), ["toggleMenu"]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  performGesture(host, intent("fourFingerTap", "world", { pointers: 4 }), { multiFinger: true });
  check("four-finger tap = chat", eq(one(calls), ["toggleChat"]), JSON.stringify(calls));
}
{
  // Tablet-only and off by default (§6.2): a phone, or the switch off, must not reach either door.
  const { host, calls } = rig();
  const menu = performGesture(host, intent("threeFingerTap", "world", { pointers: 3 }));
  const chat = performGesture(host, intent("fourFingerTap", "world", { pointers: 4 }));
  check("multi-finger off = no menu/chat", menu === false && chat === false && calls.length === 0, JSON.stringify(calls));
}

// ── 过场（§12：canAct 必假，唯一放行「跳过」）─────────────────────────────────────────
console.log("cinematic");
{
  // The HUD is taken away for the length of a cinematic, so canAct() is false; a tap must
  // still reach the skip, or a phone could never leave a cutscene.
  const { host, calls } = rig({ isCinematic: () => true, canAct: () => false });
  const ok = performGesture(host, intent("tap"));
  check("tap during cinematic skips", eq(one(calls), ["skipCinematic"]) && ok === true, JSON.stringify(calls));
}
{
  const { host, calls } = rig({ isCinematic: () => true, canAct: () => false });
  const ok = performGesture(host, intent("twoFingerTap", "world", { pointers: 2 }));
  check("two-finger tap during cinematic skips", eq(one(calls), ["skipCinematic"]) && ok === true, JSON.stringify(calls));
}
{
  // Everything else — orders, camera, the wheel — stays dead while a cinematic is playing.
  const { host, calls } = rig({ isCinematic: () => true, canAct: () => false });
  const pinch = performGesture(host, intent("pinch", "world", { pointers: 2, steps: 1 }));
  const box = performGesture(host, intent("dragbox", "world", { from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }));
  const menu = performGesture(host, intent("threeFingerTap", "world", { pointers: 3 }));
  check("cinematic refuses everything but skip",
    calls.length === 0 && pinch === false && box === false && menu === false, JSON.stringify(calls));
}

// ── 门控 / 归因 / 未实现的手势 ──────────────────────────────────────────────────────────
console.log("gates");
{
  const { host, calls } = rig({ canAct: () => false });
  const tap = performGesture(host, intent("tap"));
  const pinch = performGesture(host, intent("pinch", "world", { pointers: 2, steps: 1 }));
  check("canAct false = zero calls", calls.length === 0 && tap === false && pinch === false, JSON.stringify(calls));
}
{
  // The selection a gesture synthesises must be recorded as the gesture's, not the gamepad's.
  let cmd = null;
  let sel = null;
  const { host } = rig({
    selectAt: () => { cmd = commandSource(); sel = selectionSource(); },
    smartAt: () => { cmd = commandSource(); },
  });
  performGesture(host, intent("tap"));
  check("tap attributed to gesture", cmd === "gesture" && sel === "gesture", `${cmd}/${sel}`);
  performGesture(host, intent("longpress"));
  check("smart order attributed to gesture", cmd === "gesture", String(cmd));
}
{
  // The wheel's slots are the card's own `row * 4 + col`, not the array index.
  const card = [
    { id: "move", disabled: false, row: 0, col: 1, hotkey: "M" },
    { id: "stop", disabled: false, row: 0, col: 2, hotkey: "S" },
    { id: "attack", disabled: true, row: 0, col: 3, hotkey: "A" },
    { id: "hold", disabled: false, passive: true, row: 1, col: 0, hotkey: "H" },
  ];
  const { host, calls } = rig({ card: () => card });
  performGesture(host, intent("radial", "console", { slot: 1 }));
  check("radial slot presses that card button", eq(one(calls), ["press", "move"]), JSON.stringify(calls));
}
{
  const { host, calls } = rig({ card: () => [{ id: "attack", disabled: true, row: 0, col: 3 }] });
  const ok = performGesture(host, intent("radial", "console", { slot: 3 }));
  check("radial refuses a disabled slot", ok === false && calls.length === 0, JSON.stringify(calls));
}
{
  const { host, calls } = rig({ card: () => [{ id: "hold", disabled: false, passive: true, row: 1, col: 0 }] });
  const ok = performGesture(host, intent("radial", "console", { slot: 4 }));
  check("radial refuses a passive slot", ok === false && calls.length === 0, JSON.stringify(calls));
}
{
  const { host, calls } = rig({ card: () => [{ id: "move", disabled: false, row: 0, col: 1 }] });
  const ok = performGesture(host, intent("radial", "console", { slot: 7 }));
  check("radial empty slot does nothing", ok === false && calls.length === 0, JSON.stringify(calls));
}
{
  // Cards without coordinates (a host that only knows the array) still fall back to the index.
  const { host, calls } = rig({ card: () => [{ id: "move", disabled: false }] });
  performGesture(host, intent("radial", "console", { slot: 0 }));
  check("radial falls back to array order", eq(one(calls), ["press", "move"]), JSON.stringify(calls));
}
{
  const { host, calls } = rig();
  const ok = performGesture(host, intent("holdMove", "world"));
  check("unimplemented gesture does nothing", ok === false && calls.length === 0, JSON.stringify(calls));
}
{
  // Options → "Long Press = Smart Order" off: a world long press must not fabricate a right click.
  const { host, calls } = rig();
  const ok = performGesture(host, intent("longpress"), { longPressIsRightClick: false });
  check("long press disabled = no smart order", ok === false && calls.length === 0, JSON.stringify(calls));
}
{
  // Options → "Pinch to Zoom" off: the two-finger gesture is recognised but the camera is left alone.
  const { host, calls } = rig();
  const ok = performGesture(host, intent("pinch", "world", { pointers: 2, steps: 1 }), { pinchZoom: false });
  check("pinch disabled = no zoom", ok === false && calls.length === 0, JSON.stringify(calls));
}
{
  // The HUD's long-press tooltip is not the smart order and stays on with the switch off.
  const { host, calls } = rig();
  performGesture(host, intent("longpress", "card"), { longPressIsRightClick: false });
  check("long press tooltip unaffected", eq(one(calls), ["hoverAt", 10, 20]), JSON.stringify(calls));
}

if (fails) {
  console.log(`\n${fails} gesture action check(s) FAILED`);
  process.exit(1);
}
console.log("\nall gesture action checks passed");
