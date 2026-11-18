// L1 装配入口（方案 §7.2 / §11.1）。main.ts 只调 startGesture()，其余都在这里。
//
// P1 的出口是「tap / longpress / dragbox / pinch 能识别，并在 `?gesture=1` 的浮层上打印」；
// P2 起识别结果同时交给 GestureMatchHost：识别器吐 client 像素，这里换算成宿主坐标系
// （世界 → canvas CSS 像素，其余保持 client 像素，§5.3），再交给 actions.performGesture()。

import { loadOptions, saveOptions } from "../../data/options";
import { performGesture } from "./actions";
import { mountGestureConsole, syncGestureConsole, unmountGestureConsole } from "./console";
import {
  gestureDebugEnabled, gestureEnabled, refreshTouchDevice, setGestureRuntimeEnabled, touchDevice,
} from "./device";
import { gestureHaptic, startGestureFeedback } from "./feedback";
import { gestureGeometry } from "./geometry";
import { currentGestureHost, onGestureHostChange } from "./host";
import { setGestureUiActive } from "./hud";
import { thresholdOverridesFor, thresholdsFor, type GestureIntent } from "./intents";
import { applyGestureOptions, gestureProfile } from "./profile";
import { GestureRecognizer, type PointerSample } from "./recognizer";
import { mountGestureToggle, syncGestureToggle } from "./toggle";
import {
  beginStroke, clearStrokes, endStroke, moveStroke, resizeTrail, startGestureTrail, stopGestureTrail,
} from "./trail";

export { gestureEnabled, gestureDebugEnabled, touchDevice } from "./device";
export { adoptTouchVideoDefaults, touchVideoDefaults } from "./device";
export { gestureGeometry } from "./geometry";
export { GestureRecognizer } from "./recognizer";
export { setGestureHost, currentGestureHost } from "./host";
export { applyGestureOptions, gestureProfile, DEFAULT_GESTURE_PROFILE } from "./profile";
export type { GestureMatchHost, GestureCardButton } from "./host";
export type { GestureIntent, GestureKind, GestureArea } from "./intents";
export type { GestureProfile, GestureLayout, GestureHandedness } from "./profile";

let recognizer: GestureRecognizer | null = null;
/** 启动入口只跑一次（挂开关按钮）；引擎本身可以随开关反复起停。 */
let booted = false;
/** 识别器与常驻控件当前是否挂着。 */
let engineOn = false;
let debugEl: HTMLElement | null = null;

/**
 * 已注册的监听清单。关掉手势时要一条不剩地摘掉（P5）——否则重新打开会挂出第二份，
 * 一记轻点被识别两次。
 */
interface Bound {
  target: EventTarget;
  type: string;
  fn: EventListener;
  options?: AddEventListenerOptions | boolean;
}

let bound: Bound[] = [];

function listen(
  target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions | boolean,
): void {
  target.addEventListener(type, fn, options);
  bound.push({ target, type, fn, options });
}

function unlistenAll(): void {
  for (const b of bound) b.target.removeEventListener(b.type, b.fn, b.options);
  bound = [];
}

/**
 * 边缘持续平移的速度与帧循环（§6.1 `edgeHold`）。循环只在「一根手指按在边缘带里」时存在，
 * 抬手即停；常态一个定时器都不留（§13）。`midPan` 吃的是屏幕像素，所以速度用 px/s。
 */
const EDGE_PAN_PX_PER_S = 720;
let edgeFrame = 0;
let edgeLast = 0;

/** 当前识别器（调试 / 后续宿主取用）。 */
export function currentRecognizer(): GestureRecognizer | null {
  return recognizer;
}

/**
 * 浏览器 / 系统多指手势的仲裁点：只有「开关打开 + ≥2 指 + 落在热区」才由手势层接管，
 * 其余一律维持今天行为（main.ts 里 `!gestureClaims()` 才 preventDefault）。
 */
export function gestureClaims(): boolean {
  return recognizer?.claims() ?? false;
}

/**
 * 启动入口。`main.ts` 启动时调一次：先挂右上角的开关（关着手势时它是唯一的入口），
 * 再按当前开关决定是否挂识别器。
 *
 * 关闭手势时**一个监听都不挂**（P5），所以鼠标 / 没有触摸的机器上行为与今天完全一致。
 */
export function startGesture(): void {
  if (booted || typeof window === "undefined") return;
  booted = true;
  mountGestureToggle(setGestureEnabled);
  if (gestureEnabled()) startGestureEngine();
  else syncGestureToggle();
}

/**
 * 对局内的热开关（`ui/gesture/toggle.ts` 的按钮与 Options 的行最终都落到这里）：
 * 写回 `warcraft-open.options`、刷新 profile 快照，然后挂上 / 摘掉整层。
 * 打开后控制台立即可见（`syncGestureConsole` 只在「有对局 + HUD 可操作」时显示）。
 */
export function setGestureEnabled(on: boolean): void {
  const opts = loadOptions();
  opts.gestureEnabled = on;
  saveOptions(opts);
  applyGestureOptions(opts);
  setGestureRuntimeEnabled(on);
  if (on) startGestureEngine();
  else stopGesture();
  syncGestureToggle();
}

/** 挂上识别器、轨迹、反馈与常驻控件（幂等）。 */
function startGestureEngine(): void {
  if (engineOn || typeof window === "undefined" || !gestureEnabled()) return;
  engineOn = true;

  refreshTouchDevice();
  gestureGeometry.refresh(true);
  // 视觉 / 触觉反馈也只读 profile，Options 改完即生效（§10.1）；总开关关掉时立刻静默，
  // 与识别器同一条闸（关闭是热生效的，见 hd/options.ts 的 commitSave）。
  // 轨迹只画在对局里：菜单 / 载入屏的触摸是 FDF / WebUI 自己的按钮，不该被一条黄线跟着。
  startGestureTrail(() =>
    gestureEnabled() && gestureProfile().trail && document.body.classList.contains("in-game"));
  startGestureFeedback(() =>
    gestureEnabled() && gestureProfile().haptics && document.body.classList.contains("in-game"));

  const debug = gestureDebugEnabled();
  if (debug) mountDebugOverlay();

  // L3 的常驻控件与识别器同时就位；没有对局时由 sync 自己保持隐藏（§8.1）。
  mountGestureConsole();
  // Android 壳的系统返回键：有对局时交给页面当 Escape（见 bindAndroidBack）。
  bindAndroidBack();

  recognizer = new GestureRecognizer({
    // 读取器每次现取，所以 Options 里改长按 / 容差后下一次事件就生效，不用重挂监听。
    thresholds: () => {
      const p = gestureProfile();
      // 出厂默认（12 / 420）不写成覆盖项，否则平板应有的 16px 容差会被它顶掉（§5.2）。
      return thresholdsFor(touchDevice().deviceClass, thresholdOverridesFor(p));
    },
    areaAt: (x, y) => gestureGeometry.areaAt(x, y),
    isHotZone: (x, y) => gestureGeometry.isHotZone(x, y),
    edgePan: (x, y) => gestureGeometry.edgePan(x, y),
    enabled: gestureEnabled,
    emit: (intent) => {
      if (debug) debugIntent(intent);
      hapticFor(intent.kind);
      const h = currentGestureHost();
      if (!h) return; // 菜单 / 尚无对局：识别照跑，只是没有动作可派发
      const mapped = toHostSpace(intent);
      const p = gestureProfile();
      if (mapped) {
        performGesture(h, mapped, {
          longPressIsRightClick: p.longPressIsRightClick,
          pinchZoom: p.pinchZoom,
          // 三/四指只在平板上生效，且要玩家显式打开（§6.2 默认关）。
          multiFinger: p.multiFinger && touchDevice().deviceClass === "tablet",
        });
      }
      // 动作可能改变了 armed / 菜单 / 聊天行，常驻控件的可见性与瞄准指示随之刷新。
      syncGestureConsole();
    },
  });

  listen(window, "pointerdown", (e) => {
    const ev = e as PointerEvent;
    syncGestureConsole();
    // 控制台自己的编队条与右上角开关：由它们自己的状态机处理，识别器与轨迹都不看这一串指针
    // （否则「双指追加」会被识别成双指轻点 → 取消瞄准；点开关会被当成世界轻点）。
    if (ev.target instanceof Element && ev.target.closest("#gesture-stage, #gesture-power, #gesture-hud")) return;
    if (ev.pointerType !== "touch" && ev.pointerType !== "pen") return;
    recognizer?.pointerDown(sampleOf(ev));
    beginStroke(ev.pointerId, ev.clientX, ev.clientY);
    syncEdgePan();
  }, { capture: true, passive: true });
  listen(window, "pointermove", (e) => {
    if (!recognizer) return;
    const ev = e as PointerEvent;
    recognizer.pointerMove(sampleOf(ev));
    moveStroke(ev.pointerId, ev.clientX, ev.clientY);
    syncEdgePan();
  }, { capture: true, passive: true });
  listen(window, "pointerup", (e) => {
    if (!recognizer) return;
    const ev = e as PointerEvent;
    recognizer.pointerUp(sampleOf(ev));
    endStroke(ev.pointerId);
    stopEdgePan();
  }, { capture: true, passive: true });
  listen(window, "pointercancel", (e) => {
    if (!recognizer) return;
    const ev = e as PointerEvent;
    // 收回一根手指就作废整串（§12），所以轨迹也是整组清空，而不是只擦掉这一条。
    if (recognizer.pointerCancel(ev.pointerId)) clearStrokes();
    stopEdgePan();
  }, { capture: true, passive: true });

  // 失焦 / 切后台：清空活跃指针，回来时不会「卡住一个框选」（§12）。
  const resetAll = (): void => {
    recognizer?.reset();
    clearStrokes();
    stopEdgePan();
  };
  listen(window, "blur", resetAll);
  listen(document, "visibilitychange", () => {
    if (document.hidden) resetAll();
  });

  // 热区缓存失效：窗口尺寸、方向、可视视口、以及 Android 壳在旋转后发来的事件（P7）。
  const reflow = (): void => {
    refreshTouchDevice();
    gestureGeometry.invalidate();
    gestureGeometry.refresh(true);
    resizeTrail();
    syncGestureConsole();
  };
  listen(window, "resize", reflow);
  listen(window, "orientationchange", reflow);
  listen(window, "ow3android:config", reflow);
  if (window.visualViewport) listen(window.visualViewport, "resize", reflow);
}

/**
 * 摘掉整层：识别器、轨迹、常驻控件、Android 返回键接管与全部监听。
 * 页面回到「鼠标 / 键盘」的原始行为，和从未开过手势一致（P5）。
 */
export function stopGesture(): void {
  if (!engineOn) return;
  engineOn = false;
  unlistenAll();
  offBackHostChange?.();
  offBackHostChange = null;
  androidShell()?.setBackHandled?.(false);
  recognizer?.reset();
  recognizer = null;
  stopEdgePan();
  clearStrokes();
  stopGestureTrail();
  startGestureFeedback(() => false);
  unmountGestureConsole();
  // 替代布局（ui/gesture/hud.ts）退场，并把借走的小地图还给经典 HUD。
  setGestureUiActive(false);
  debugEl?.remove();
  debugEl = null;
}

/**
 * 起 / 续边缘持续平移（§6.1）。只在「一根手指按在世界边缘带里」时起一个 rAF 循环；
 * 循环自己判断 dwell 是否已到（`edgePanAt`），到点后每帧把方向 × 速度 × dt 交给
 * `performGesture`，于是它和双指平移走同一条 `panBy` → `midPan` 通道，门控与归因也同一套。
 * 手指离开边缘带、抬起、或变成多指时，下一帧自行退出（`edgeCandidate()` 为假）。
 */
function syncEdgePan(): void {
  if (edgeFrame) return;
  if (!recognizer?.edgeCandidate() || !currentGestureHost()) return;
  edgeLast = performance.now();
  edgeFrame = requestAnimationFrame(pumpEdgePan);
}

function pumpEdgePan(now: number): void {
  edgeFrame = 0;
  const host = currentGestureHost();
  // 手指已离开边缘带 / 抬起 / 变成多指：循环结束，等下一次 pointer 事件再起。
  if (!host || !recognizer?.edgeCandidate()) return;

  // 先算 dt 再问方向：dwell 期间也在排帧，不能让第一次平移把 220ms 攒成一个跳变。
  const dt = Math.min(0.1, Math.max(0, (now - edgeLast) / 1000));
  edgeLast = now;
  const pan = recognizer.edgePanAt(performance.now());
  if (pan) {
    const mapped = toHostSpace({
      kind: "edgeHold",
      x: pan.x,
      y: pan.y,
      vx: pan.dx * EDGE_PAN_PX_PER_S * dt,
      vy: pan.dy * EDGE_PAN_PX_PER_S * dt,
      pointers: 1,
      durationMs: 0,
      area: "world",
    });
    if (mapped) performGesture(host, mapped);
    syncGestureConsole();
  }
  // dwell 还没到也要继续排帧，否则「按下后不动」永远等不到第一次平移。
  if (recognizer.edgeCandidate()) edgeFrame = requestAnimationFrame(pumpEdgePan);
}

function stopEdgePan(): void {
  if (edgeFrame) cancelAnimationFrame(edgeFrame);
  edgeFrame = 0;
}

/**
 * Android 壳的系统返回键（MainActivity `onBackPressed`）：有对局时由页面接管，派发一次真实的
 * Escape，交给既有键盘语义（取消 armed / 收起聊天行 / F10 面板），而不是 `web.goBack()`。
 * 没有对局时不声明接管，壳照旧走页面历史。壳不存在时整段不挂监听。
 */
function bindAndroidBack(): void {
  const shell = androidShell();
  if (!shell?.setBackHandled) return;
  offBackHostChange?.();
  offBackHostChange = onGestureHostChange(syncAndroidBack);
  syncAndroidBack();
  listen(window, "ow3android:back", () => {
    if (!currentGestureHost()) return;
    const target = document.activeElement ?? document.body;
    const init = { key: "Escape", code: "Escape", bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  });
}

/** `bindAndroidBack` 的宿主订阅；`stopGesture` 要退掉它，否则关掉手势后返回键仍被页面接管。 */
let offBackHostChange: (() => void) | null = null;

interface AndroidShell {
  setBackHandled?: (handled: boolean) => void;
}

function androidShell(): AndroidShell | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ow3android?: AndroidShell }).ow3android ?? null;
}

/** 对局建立 / 销毁时告诉壳「返回键现在归页面」。 */
function syncAndroidBack(): void {
  androidShell()?.setBackHandled?.(currentGestureHost() !== null);
}

/**
 * 识别器的 client 像素 → 宿主坐标（§5.3）：世界区域换成地图 canvas 的 CSS 像素，
 * 其余区域原样保留（HUD / 命令卡 / 小地图 / 控制台本来就吃 client 像素）。
 * canvas 还没量到（无对局 / 无 `#map`）时丢弃这个世界手势——没有画布就没有世界可点。
 */
function toHostSpace(intent: GestureIntent): GestureIntent | null {
  if (intent.area !== "world") return intent;
  const at = gestureGeometry.canvasPoint(intent.x, intent.y);
  if (!at) return null;
  const mapped: GestureIntent = { ...intent, x: at.x, y: at.y };
  if (intent.from) {
    const from = gestureGeometry.canvasPoint(intent.from.x, intent.from.y);
    if (!from) return null;
    mapped.from = from;
  }
  if (intent.to) {
    const to = gestureGeometry.canvasPoint(intent.to.x, intent.to.y);
    if (!to) return null;
    mapped.to = to;
  }
  return mapped;
}

/** 只有「判定完成」的离散手势震一下；连续手势（捏合 / 平移）不震（见 feedback.ts）。 */
function hapticFor(kind: GestureIntent["kind"]): void {
  if (kind === "longpress") gestureHaptic("longpress");
  else if (kind === "doubletap") gestureHaptic("doubletap");
  else if (kind === "twoFingerTap") gestureHaptic("cancel");
  else if (kind === "threeFingerTap") gestureHaptic("menu");
  else if (kind === "fourFingerTap") gestureHaptic("menu");
}

function sampleOf(e: PointerEvent): PointerSample {
  return {
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    clientX: e.clientX,
    clientY: e.clientY,
    timeStamp: e.timeStamp,
  };
}

// ── 调试回执（?gesture=1）：P1 的验收就是看它有没有把意图打出来 ─────────────────────

const DEBUG_LINES = 6;

function mountDebugOverlay(): void {
  const el = document.createElement("div");
  el.id = "gesture-debug";
  document.body.appendChild(el);
  debugEl = el;
}

function debugIntent(intent: GestureIntent): void {
  const el = debugEl;
  if (!el) return;
  const extras: string[] = [];
  if (intent.scale !== undefined) extras.push(`scale=${intent.scale.toFixed(2)}`);
  if (intent.steps !== undefined) extras.push(`steps=${intent.steps}`);
  if (intent.pointers > 1) extras.push(`pointers=${intent.pointers}`);
  const line = `${intent.kind} ${intent.area} (${Math.round(intent.x)},${Math.round(intent.y)}) `
    + `${Math.round(intent.durationMs)}ms${extras.length ? ` ${extras.join(" ")}` : ""}`;
  const rows = (el.dataset.lines ? el.dataset.lines.split("\n") : []).concat(line).slice(-DEBUG_LINES);
  el.dataset.lines = rows.join("\n");
  el.textContent = rows.join("\n");
}
