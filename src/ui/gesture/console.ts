// L3 控制台常驻控件（方案 §8.1 / §6.3 形态 A/B）。P3 的第一批：
//   · 编队条：轻点召回、双击召回并拉镜头、长按设编队、双指追加（Ctrl+N / Shift+N / N 的触摸版）；
//   · 瞄准指示：armed 施法 / 建造放置时提示「选择目标 · 双指轻点取消」。
//
// 这一层只是输入的可视化外壳（§0.1）：数据与动作全在 `GestureMatchHost` 后面，
// 控制器不缓存选中 / 命令卡 / armed，也不碰 `RtsController.execute`。
//
// 零常态帧开销（§13）：没有 rAF、没有 interval、没有每帧 layout read。控件只在
// 「有对局 / 开关打开 / 无模态」变化时由事件同步一次；编队条的矩形由 geometry.ts
// 在 refresh 时量一次并缓存。

import { hudScale } from "../../render/gameplayOptions";
import { t } from "../../i18n";
import { withInputOverride } from "../inputSource";
import { anyModalOpen } from "../modal";
import { cardButtonForSlot, performGesture } from "./actions";
import { gestureEnabled, touchDevice } from "./device";
import { gestureHaptic } from "./feedback";
import { gestureGeometry } from "./geometry";
import { currentGestureHost, onGestureHostChange } from "./host";
import { setGestureUiActive, syncGestureHud } from "./hud";
import { gestureProfile } from "./profile";
import type { GestureIntent } from "./intents";

/** WC3 的编队键：1–9、0。 */
const GROUP_KEYS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
/** 与 `main.ts` / `hud.ts` 的双击窗口一致。 */
const DOUBLE_TAP_MS = 300;
/** 径向轮盘：12 槽，每槽 30°；中心死区与半径见方案 §5.2。 */
const RADIAL_SLOTS = 12;
const RADIAL_DEADZONE_PX = 24;
const RADIAL_RADIUS_PHONE = 96;
const RADIAL_RADIUS_TABLET = 140;
const RADIAL_MARGIN_PX = 8;
/** 命令卡镜像也是 4×3 = 12 槽，与 `row * 4 + col` 同形（§8.8）。 */
const CARD_SLOTS = 12;
/** `gestureShowHints` 的「已经看过」标记：一架设备只教一次，关掉开关也不会再弹。 */
const HINTS_KEY = "warcraft-open.gesture-hints";

interface Press {
  key: string;
  button: HTMLButtonElement;
  x: number;
  y: number;
  timer: number;
  /** 这一指已经完成（长按 / 追加 / 滑动取消），抬起时不再召回。 */
  consumed: boolean;
}

let stage: HTMLDivElement | null = null;
let squad: HTMLDivElement | null = null;
let target: HTMLDivElement | null = null;
let wheel: HTMLButtonElement | null = null;
let radial: HTMLDivElement | null = null;
let radialRing: HTMLDivElement | null = null;
let radialSlots: HTMLDivElement[] = [];
/** 命令卡镜像（`gestureCardMirror`）：纯显示 + 可点，数据来自 host.card()。 */
let mirror: HTMLDivElement | null = null;
let mirrorSlots: HTMLButtonElement[] = [];
/** 首次进入的教学浮层（`gestureShowHints`）；看过一次后不再出现。 */
let hints: HTMLDivElement | null = null;
/** 本次会话里已经关掉过：localStorage 不可用时也不会在同一局里反复弹出。 */
let hintsDismissed = false;
let mirrorPress: { pointerId: number; slot: number; button: HTMLButtonElement } | null = null;
/** 镜像上次画出的内容；卡没变化时不碰 DOM。 */
let mirrorKey = "";
/** 命令卡变化时才回调（HUD 每帧只在自己重画时改属性），不是每帧观察。 */
let cardObserver: MutationObserver | null = null;
let observedCard: Element | null = null;
/** 宿主换人（新对局 / 对局结束）的订阅；卸下这一层时要退订，否则重开后会收到两份回调。 */
let offHostChange: (() => void) | null = null;

/** 轮盘一次开合的临时状态；只在按住期间存在，抬手即清。 */
let wheelPointer = -1;
let wheelCenter = { x: 0, y: 0 };
let wheelRadius = RADIAL_RADIUS_PHONE;
let wheelSelected = -1;
let wheelStartAt = 0;

const presses = new Map<number, Press>();
let lastTap = { key: "", at: 0 };
/** 上一次同步的可见 / 布局状态，用来判断要不要让缓存的矩形失效。 */
let shown = false;
let layoutKey = "";
/** 上一次同步看到的 HUD 缩放。读的是模块值（不是 DOM），所以不算 layout read。 */
let hudScaleSeen = -1;

/**
 * 挂一次，活到整页结束：`#gesture-stage` 与 `#ui` 同寿，跨对局不重建。
 * 关闭手势或没有触摸时**一个节点都不建**（P5）。
 */
export function mountGestureConsole(): void {
  if (stage || typeof document === "undefined" || !gestureEnabled()) return;
  const ui = document.getElementById("ui");
  if (!ui) return;

  const root = document.createElement("div");
  root.id = "gesture-stage";
  // The bottom console art's top edge, as a share of the stage (§8.3): the squad bar parks
  // above it so the HUD's minimap / command card are never covered. One flavour-dependent
  // number, read once — SD and HD (except `de`) differ by ~1%.
  root.style.setProperty("--gesture-console-top", `${(touchDevice().consoleTop * 100).toFixed(2)}%`);

  const bar = document.createElement("div");
  bar.className = "gesture-squad";
  for (const key of GROUP_KEYS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gesture-group";
    b.dataset.group = key;
    b.textContent = key;
    b.tabIndex = -1; // 触摸控制台，不是键盘路径
    bar.appendChild(b);
  }

  // 12 槽径向轮盘：按住圆钮 → 向外划选槽 → 抬手按该槽的命令卡按钮（§6.1）。
  // 形态 A（极简）不常驻控件，由 CSS 按 `data-layout` 隐藏。
  const dial = document.createElement("button");
  dial.type = "button";
  dial.className = "gesture-wheel";
  dial.textContent = "◎";
  dial.tabIndex = -1;
  dial.setAttribute("aria-label", t("gesture.WHEEL"));
  dial.title = t("gesture.WHEEL");

  const pill = document.createElement("div");
  pill.className = "gesture-target";
  pill.textContent = `${t("gesture.TARGET")} · ${t("gesture.TARGET_HINT")}`;

  // 命令卡镜像：与 HUD 同一份卡（`host.card()`），只是把 12 个槽画在拇指够得到的地方。
  // 只有按钮接输入，容器仍是 `pointer-events:none`（R4）。
  const cards = document.createElement("div");
  cards.className = "gesture-card";
  cards.hidden = true;
  cards.setAttribute("aria-label", t("gesture.CARD"));
  mirrorSlots = [];
  for (let i = 0; i < CARD_SLOTS; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gesture-card__slot";
    b.dataset.slot = String(i);
    b.tabIndex = -1;
    cards.appendChild(b);
    mirrorSlots.push(b);
  }
  cards.addEventListener("pointerdown", onCardDown, { passive: false });
  cards.addEventListener("pointerup", onCardUp, { passive: true });
  cards.addEventListener("pointercancel", onCardCancel, { passive: true });

  // 教学浮层（`gestureShowHints`）：只在对局里、第一次进入时出现，任意一点或按钮关掉并
  // 记在本机。它不是游戏输入，`index.ts` 对 `#gesture-stage` 的指针本就不进识别器。
  const guide = document.createElement("div");
  guide.className = "gesture-hints";
  guide.hidden = true;
  const panel = document.createElement("div");
  panel.className = "gesture-hints__panel";
  const title = document.createElement("div");
  title.className = "gesture-hints__title";
  title.textContent = t("gesture.HINT_TITLE");
  const list = document.createElement("ul");
  list.className = "gesture-hints__list";
  for (const key of [
    "gesture.HINT_TAP", "gesture.HINT_LONG", "gesture.HINT_DRAG",
    "gesture.HINT_TWO", "gesture.HINT_GROUPS", "gesture.HINT_ITEM",
  ] as const) {
    const item = document.createElement("li");
    item.textContent = t(key);
    list.appendChild(item);
  }
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "gesture-hints__ok";
  ok.tabIndex = -1; // 触摸控制台，不是键盘路径
  ok.textContent = t("gesture.HINT_DISMISS");
  panel.append(title, list, ok);
  guide.appendChild(panel);
  guide.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dismissHints();
  });

  root.append(bar, dial, pill, cards, guide);
  ui.appendChild(root);
  stage = root;
  squad = bar;
  wheel = dial;
  target = pill;
  mirror = cards;
  hints = guide;

  bar.addEventListener("pointerdown", onDown, { passive: false });
  bar.addEventListener("pointermove", onMove, { passive: true });
  bar.addEventListener("pointerup", onUp, { passive: true });
  bar.addEventListener("pointercancel", onCancel, { passive: true });

  dial.addEventListener("pointerdown", onWheelDown, { passive: false });
  dial.addEventListener("pointermove", onWheelMove, { passive: true });
  dial.addEventListener("pointerup", onWheelUp, { passive: true });
  dial.addEventListener("pointercancel", onWheelCancel, { passive: true });

  mountRadial();
  // 宿主换人（新对局 / 对局结束）：可见性跟着变；没有宿主了就把这一层的指针状态一并丢掉，
  // 不让上一局按住中的编队键在新宿主上落地（§12）。
  offHostChange?.();
  offHostChange = onGestureHostChange(onHostChanged);
  syncGestureConsole();

  // §12「页面失焦 / visibilitychange → 清空所有活跃 Track」：识别器在 index.ts 里已经清过，
  // 但编队条 / 镜像 / 轮盘是这一层自己的指针状态机，必须一起清 —— 否则按住编队键切后台，
  // 420ms 后回来会收到一次没人按过的 `assignGroup`。
  window.addEventListener("blur", resetConsoleInput);
  document.addEventListener("visibilitychange", onHiddenReset);
}

/**
 * 卸下常驻控件（对局内手动关闭手势）：摘掉 `#gesture-stage` 与 `#gesture-radial`，退掉
 * 宿主订阅与窗口监听，丢掉全部指针状态。再打开时 `mountGestureConsole()` 重新挂一份。
 */
export function unmountGestureConsole(): void {
  if (!stage || typeof document === "undefined") return;
  watchCard(false);
  offHostChange?.();
  offHostChange = null;
  window.removeEventListener("blur", resetConsoleInput);
  document.removeEventListener("visibilitychange", onHiddenReset);
  resetConsoleInput();
  stage.remove();
  radial?.remove();
  stage = null;
  squad = null;
  target = null;
  wheel = null;
  radial = null;
  radialRing = null;
  radialSlots = [];
  mirror = null;
  mirrorSlots = [];
  hints = null;
  layoutKey = "";
  mirrorKey = "";
  shown = false;
  hudScaleSeen = -1;
  cardObserver?.disconnect();
  cardObserver = null;
  observedCard = null;
}

function onHostChanged(): void {
  syncGestureConsole();
  if (!currentGestureHost()) resetConsoleInput();
}

function onHiddenReset(): void {
  if (document.hidden) resetConsoleInput();
}

/**
 * 丢掉这一层所有进行中的指针状态：长按计时器、双指追加、镜像按下、打开的轮盘。
 * 失焦 / 切后台 / 指针被系统收回时调用；不派发任何动作（§12）。
 */
function resetConsoleInput(): void {
  for (const p of presses.values()) {
    window.clearTimeout(p.timer);
    clearHot(p);
  }
  presses.clear();
  mirrorPress?.button.classList.remove("down");
  mirrorPress = null;
  lastTap = { key: "", at: 0 };
  closeRadial();
}

/**
 * 同步常驻控件的可见性、形态与瞄准指示。事件驱动，调用方是：
 * 宿主装上 / 卸下、每一次触摸按下、每次识别出的意图、resize / 方向变化。
 */
export function syncGestureConsole(): void {
  // 手势模式 = 用移动端 HUD 替代经典 HUD（ui/gesture/hud.ts）：开关开着、在对局里、有宿主。
  // 放在最前面，因为手势关掉时这一层没有 `#gesture-stage`，但替代布局必须能退回去。
  const host = currentGestureHost();
  const hudMode = gestureEnabled() && document.body.classList.contains("in-game") && !!host;
  setGestureUiActive(hudMode);
  if (hudMode) syncGestureHud();

  if (!stage || !squad || !target) return;
  const body = document.body;
  const visible = gestureEnabled()
    && body.classList.contains("in-game")
    && !anyModalOpen();
  const active = visible && !!host?.canAct();

  stage.classList.toggle("gesture-on", active);

  const p = gestureProfile();
  const nextLayout = `${p.layout}/${p.handedness}`;
  const layoutChanged = nextLayout !== layoutKey;
  if (layoutChanged) {
    layoutKey = nextLayout;
    stage.dataset.layout = p.layout;
    stage.dataset.hand = p.handedness;
    // 编队条在「极简」形态下不常驻（§6.3 A：纯手势 + 轨迹）。
    squad.hidden = p.layout === "minimal";
  }

  target.classList.toggle("on", active && !!host?.armed());

  // 首次进入的手势教学：开关开着、对局里、且这一台设备还没看过。看过后写标记，之后不再弹。
  if (hints) hints.hidden = !(active && p.showHints && !hintsDismissed && !hintsSeen());

  // 命令卡镜像：只在「有对局 + 开关开 + 无模态 + 玩家设置打开」时存在。观察 HUD 的命令卡
  // DOM（HUD 只在卡真的变化时才改属性），所以键盘 / 手柄改了卡，镜像也会跟上，且仍然零
  // 常态帧开销（没有 rAF、没有每帧 layout read，§13）。
  const mirrorOn = active && p.cardMirror;
  if (mirror) {
    mirror.hidden = !mirrorOn;
    if (mirrorOn) {
      watchCard(true);
      renderMirror();
    } else {
      watchCard(false);
      mirrorKey = "";
      mirrorPress = null;
    }
  }

  // 模态 / 过场 / 暂停把整层关掉，或切到极简形态时，按住中的轮盘立刻收起，
  // 不让它悬在一个已经不接受输入的对局上（§12）。
  if (!active || p.layout === "minimal") closeRadial();

  // HUD Scale 可以在对局里改（HD Options → Gameplay 的滑条）：整块 `.hud` 被
  // `--hud-scale` 缩放后，命令卡 / 小地图 / 编队条的屏幕矩形都会变，缓存的矩形必须作废
  // （§12「HUD Scale 改变」/ §14.3 第 7 项）。这里只读模块值，不读 layout。
  const scale = hudScale();
  const scaleChanged = scale !== hudScaleSeen;
  hudScaleSeen = scale;

  // 可见性或布局一变，编队条的屏幕矩形就变了（P7）：下一次 areaAt 重量一次。
  if (active !== shown || layoutChanged || scaleChanged) {
    shown = active;
    gestureGeometry.invalidate();
  }
}

/** 这一台设备是否已经看过教学浮层。localStorage 不可用时按「没看过」处理，浮层只多弹一次。 */
function hintsSeen(): boolean {
  try {
    return localStorage.getItem(HINTS_KEY) === "1";
  } catch {
    return false;
  }
}

/** 关掉教学浮层并记住，之后任何一局都不再出现（`gestureShowHints` 仍然可以关掉整项）。 */
function dismissHints(): void {
  hintsDismissed = true;
  try {
    localStorage.setItem(HINTS_KEY, "1");
  } catch {
    /* private mode / no storage: the overlay simply comes back next launch */
  }
  if (hints) hints.hidden = true;
}

function groupButton(e: Event): HTMLButtonElement | null {
  const el = e.target;
  return el instanceof Element ? el.closest<HTMLButtonElement>(".gesture-group") : null;
}

function clearHot(p: Press): void {
  p.button.classList.remove("gesture-hot");
}

function onDown(e: PointerEvent): void {
  if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
  const button = groupButton(e);
  const host = currentGestureHost();
  if (!button || !host?.canAct() || !stage?.classList.contains("gesture-on")) return;

  const key = button.dataset.group ?? "";
  // 同一颗按钮上的第二根手指 = 追加（Shift+N）。第一根手指随之作废，不召回。
  for (const p of presses.values()) {
    if (p.key !== key || p.consumed) continue;
    p.consumed = true;
    window.clearTimeout(p.timer);
    clearHot(p);
    presses.set(e.pointerId, { key, button, x: e.clientX, y: e.clientY, timer: 0, consumed: true });
    gestureHaptic("longpress");
    withInputOverride("gesture", () => host.group("append", Number(key)));
    return;
  }

  e.preventDefault();
  e.stopPropagation();
  try {
    button.setPointerCapture(e.pointerId);
  } catch {
    /* 指针已被系统收回（边缘手势）：后面的 pointerup 仍会到达这里 */
  }
  button.classList.add("gesture-hot");
  const timer = window.setTimeout(() => {
    const p = presses.get(e.pointerId);
    if (!p || p.consumed) return;
    // 计时器是异步的：模态 / 暂停 / 过场 / 失焦可能在这 420ms 里发生。按下的那一刻问过
    // `canAct()` 不够，派发前必须再问一次（§12 / P6 的唯一门）。
    const live = currentGestureHost();
    if (!live?.canAct() || !stage?.classList.contains("gesture-on")) {
      p.consumed = true;
      clearHot(p);
      return;
    }
    p.consumed = true;
    clearHot(p);
    gestureHaptic("longpress");
    withInputOverride("gesture", () => live.group("assign", Number(key)));
  }, gestureProfile().longPressMs);
  presses.set(e.pointerId, { key, button, x: e.clientX, y: e.clientY, timer, consumed: false });
}

function onMove(e: PointerEvent): void {
  const p = presses.get(e.pointerId);
  if (!p || p.consumed) return;
  if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= gestureProfile().tapSlopPx) return;
  // 手指滑走了：既不是轻点也不是静止长按。
  p.consumed = true;
  window.clearTimeout(p.timer);
  clearHot(p);
}

function onUp(e: PointerEvent): void {
  const p = presses.get(e.pointerId);
  if (!p) return;
  presses.delete(e.pointerId);
  window.clearTimeout(p.timer);
  clearHot(p);
  if (p.consumed) return;

  const host = currentGestureHost();
  if (!host?.canAct()) return;
  const key = p.key;
  const n = Number(key);
  const at = performance.now();
  const again = lastTap.key === key && at - lastTap.at <= DOUBLE_TAP_MS;
  lastTap = { key, at };
  // 双击 = N N（召回并拉镜头），单点 = N（只召回），与键盘逐字一致。
  withInputOverride("gesture", () => host.group("recall", n, again));
}

function onCancel(e: PointerEvent): void {
  const p = presses.get(e.pointerId);
  if (!p) return;
  presses.delete(e.pointerId);
  window.clearTimeout(p.timer);
  clearHot(p);
}

// ── 命令卡镜像（§6.3 / `gestureCardMirror`）──────────────────────────────────
// 与 HUD 同一份卡：数据来自 `host.card()`，动作仍走 `performGesture()` 的 radial 分支
// （同一处门控、同一处 "gesture" 归因），镜像自己不发明命令（§7.4）。
// 槽位顺序与轮盘、键盘 Grid 都是 `row * 4 + col`。

/** 只在镜像是「开」的时候观察 HUD 的命令卡；关掉就断开，加一次 `renderMirror`。 */
function watchCard(on: boolean): void {
  if (typeof MutationObserver === "undefined") return;
  if (!on) {
    cardObserver?.disconnect();
    observedCard = null;
    return;
  }
  const el = document.querySelector(".hud-command");
  if (!el) return;
  if (el === observedCard && cardObserver) return;
  if (!cardObserver) cardObserver = new MutationObserver(() => renderMirror());
  cardObserver.disconnect();
  cardObserver.observe(el, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "disabled"],
  });
  observedCard = el;
  mirrorKey = ""; // 新的命令卡元素：下一帧无条件重画一次
}

/** 卡的比较键：与 hud.ts 的 `cmdKey` 同思路 —— 变了才碰 DOM。 */
function renderMirror(): void {
  if (!mirror || mirror.hidden) return;
  const card = currentGestureHost()?.card() ?? [];
  // The icon is a data URL (kilobytes each), so its LENGTH is the key and the string is written
  // only when the key changes — the same trade the HUD's own `cmdKey` makes (§13).
  const key = card.map((c) =>
    `${c.id}:${c.disabled ? 1 : 0}:${c.passive ? 1 : 0}:${c.active ? 1 : 0}:${c.name ?? ""}:${c.icon?.length ?? 0}`,
  ).join("|");
  if (key === mirrorKey) return;
  mirrorKey = key;

  for (let i = 0; i < CARD_SLOTS; i++) {
    const btn = mirrorSlots[i];
    if (!btn) continue;
    const c = cardButtonForSlot(card, i);
    btn.classList.remove("off", "hot");
    if (mirrorPress?.button !== btn) btn.classList.remove("down");
    if (!c) {
      btn.textContent = "";
      btn.style.backgroundImage = "";
      btn.removeAttribute("aria-label");
      continue;
    }
    // 灰掉 / 被动与 HUD 同一判定：看得见，按不动（动作层还会再拒一次）。
    btn.classList.toggle("off", c.disabled || !!c.passive);
    btn.classList.toggle("hot", !!c.active);
    btn.setAttribute("aria-label", c.name ?? c.id);
    if (c.icon) {
      btn.textContent = "";
      btn.style.backgroundImage = `url(${c.icon})`;
    } else {
      // 没有图标时 HUD 自己显示名字前四个字符，镜像照抄。
      btn.style.backgroundImage = "";
      btn.textContent = (c.name ?? c.id).slice(0, 4);
    }
  }
}

function cardSlotOf(e: Event): number | null {
  const el = e.target instanceof Element ? e.target.closest<HTMLButtonElement>(".gesture-card__slot") : null;
  if (!el) return null;
  const n = Number(el.dataset.slot);
  return Number.isInteger(n) && n >= 0 && n < CARD_SLOTS ? n : null;
}

function onCardDown(e: PointerEvent): void {
  if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
  const slot = cardSlotOf(e);
  const host = currentGestureHost();
  if (slot === null || !host?.canAct() || !stage?.classList.contains("gesture-on")) return;
  e.preventDefault();
  e.stopPropagation();
  const button = mirrorSlots[slot];
  if (!button) return;
  try {
    button.setPointerCapture(e.pointerId);
  } catch {
    /* 系统已经接管这一指；pointerup 仍可能到达 */
  }
  button.classList.add("down");
  mirrorPress = { pointerId: e.pointerId, slot, button };
}

function onCardUp(e: PointerEvent): void {
  const press = mirrorPress;
  if (!press || e.pointerId !== press.pointerId) return;
  mirrorPress = null;
  press.button.classList.remove("down");
  // 手指滑出按钮 = 取消，与 HUD 按钮的「按下与抬起必须落在同一颗」一致。触摸有隐式指针
  // 捕获，`e.target` 永远是按下的那颗，所以用屏幕上的真实落点判一次。
  const hit = typeof document.elementFromPoint === "function"
    ? document.elementFromPoint(e.clientX, e.clientY)
    : null;
  const slotEl = hit instanceof Element ? hit.closest<HTMLElement>(".gesture-card__slot") : null;
  if (slotEl?.dataset.slot !== String(press.slot)) return;
  const host = currentGestureHost();
  if (!host) return;
  performGesture(host, {
    kind: "radial",
    x: e.clientX,
    y: e.clientY,
    slot: press.slot,
    pointers: 1,
    durationMs: 0,
    area: "console",
  });
  syncGestureConsole(); // 卡可能已经变了（施法 → 目标模式 / 新单位面板）
}

function onCardCancel(e: PointerEvent): void {
  const press = mirrorPress;
  if (!press || e.pointerId !== press.pointerId) return;
  mirrorPress = null;
  press.button.classList.remove("down");
}

// ── 12 槽径向轮盘（§6.1 / §8.1）──────────────────────────────────────────────
// 视觉层在 <body> 上（与 #loading-layer 同级），z-index 6：全视口对齐手指坐标，
// 但永远低于对话框与加载屏。它不接输入 —— 指针由圆钮 capture，轮盘只是画面，
// 所以不存在「全屏 auto 层吃掉 HUD 点击」的问题（R4）。

function mountRadial(): void {
  if (radial || typeof document === "undefined") return;
  const root = document.createElement("div");
  root.id = "gesture-radial";
  root.setAttribute("aria-hidden", "true");

  radialRing = document.createElement("div");
  radialRing.className = "gesture-radial__ring";
  root.appendChild(radialRing);

  radialSlots = [];
  for (let i = 0; i < RADIAL_SLOTS; i++) {
    const cell = document.createElement("div");
    cell.className = "gesture-radial__slot";
    cell.dataset.slot = String(i);
    root.appendChild(cell);
    radialSlots.push(cell);
  }
  document.body.appendChild(root);
  radial = root;
}

/**
 * 在 (x, y) 打开轮盘：中心夹进视口，半径按设备分级（手机 96 / 平板 140）。
 * 槽位 0 在正上方，顺时针每 30° 一槽，与命令卡 `row * 4 + col` 同序。
 */
function openRadial(x: number, y: number): void {
  if (!radial || !radialRing) return;
  wheelRadius = touchDevice().deviceClass === "tablet" ? RADIAL_RADIUS_TABLET : RADIAL_RADIUS_PHONE;
  const minX = wheelRadius + RADIAL_MARGIN_PX;
  const minY = wheelRadius + RADIAL_MARGIN_PX;
  const maxX = Math.max(minX, window.innerWidth - wheelRadius - RADIAL_MARGIN_PX);
  // The wheel and its ring must clear the bottom console art (§8.3), not merely the window:
  // a finger low on the frame would otherwise open 12 slots on top of the command card.
  const ring = RADIAL_MARGIN_PX + 22;
  const bandTop = gestureGeometry.consoleBandTop();
  const limit = bandTop === null
    ? window.innerHeight - wheelRadius - RADIAL_MARGIN_PX
    : bandTop - wheelRadius - ring;
  const maxY = Math.max(minY, Math.min(window.innerHeight - wheelRadius - RADIAL_MARGIN_PX, limit));
  wheelCenter = {
    x: Math.min(Math.max(x, minX), maxX),
    y: Math.min(Math.max(y, minY), maxY),
  };

  radialRing.style.left = `${wheelCenter.x}px`;
  radialRing.style.top = `${wheelCenter.y}px`;
  radialRing.style.width = `${wheelRadius * 2 + 44}px`;
  radialRing.style.height = `${wheelRadius * 2 + 44}px`;

  const card = currentGestureHost()?.card() ?? [];
  for (let i = 0; i < RADIAL_SLOTS; i++) {
    const cell = radialSlots[i];
    if (!cell) continue;
    const angle = (-90 + i * (360 / RADIAL_SLOTS)) * (Math.PI / 180);
    cell.style.left = `${wheelCenter.x + Math.cos(angle) * wheelRadius}px`;
    cell.style.top = `${wheelCenter.y + Math.sin(angle) * wheelRadius}px`;
    const button = cardButtonForSlot(card, i);
    cell.textContent = button ? (button.hotkey ? button.hotkey.toUpperCase() : String(i + 1)) : "";
    // 灰掉 / 被动 / 空槽画成暗色，但仍可指向：抬手时 action 层再拒一次（与 HUD 同判定）。
    cell.classList.toggle("off", !button || button.disabled || !!button.passive);
    cell.classList.remove("hot");
  }
  radial.classList.add("on");
  wheelSelected = -1;
}

/** 手指相对轮盘中心落在哪一槽；死区内返回 −1。 */
function radialSlotAt(clientX: number, clientY: number): number {
  const dx = clientX - wheelCenter.x;
  const dy = clientY - wheelCenter.y;
  if (Math.hypot(dx, dy) < RADIAL_DEADZONE_PX) return -1;
  const deg = Math.atan2(dy, dx) * (180 / Math.PI);
  const index = Math.round((deg + 90) / (360 / RADIAL_SLOTS));
  return ((index % RADIAL_SLOTS) + RADIAL_SLOTS) % RADIAL_SLOTS;
}

function highlightRadial(slot: number): void {
  for (let i = 0; i < radialSlots.length; i++) radialSlots[i].classList.toggle("hot", i === slot);
}

function closeRadial(): void {
  radial?.classList.remove("on");
  for (const cell of radialSlots) cell.classList.remove("hot");
  wheel?.classList.remove("gesture-hot");
  wheelPointer = -1;
  wheelSelected = -1;
}

function onWheelDown(e: PointerEvent): void {
  if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
  const host = currentGestureHost();
  if (!wheel || !host?.canAct() || !stage?.classList.contains("gesture-on")) return;
  e.preventDefault();
  e.stopPropagation();
  try {
    wheel.setPointerCapture(e.pointerId);
  } catch {
    /* the system already claimed the pointer; pointerup may still arrive */
  }
  wheelPointer = e.pointerId;
  wheelStartAt = performance.now();
  wheel.classList.add("gesture-hot");
  const rect = wheel.getBoundingClientRect();
  openRadial(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function onWheelMove(e: PointerEvent): void {
  if (e.pointerId !== wheelPointer || !radial?.classList.contains("on")) return;
  const slot = radialSlotAt(e.clientX, e.clientY);
  if (slot === wheelSelected) return;
  wheelSelected = slot;
  highlightRadial(slot);
}

function onWheelUp(e: PointerEvent): void {
  if (e.pointerId !== wheelPointer) return;
  const slot = radialSlotAt(e.clientX, e.clientY);
  const x = wheelCenter.x;
  const y = wheelCenter.y;
  const durationMs = Math.max(0, performance.now() - wheelStartAt);
  const host = currentGestureHost();
  closeRadial();
  if (slot < 0 || !host) return;
  // 走统一的动作层：一处门控、一处 "gesture" 归因（§7.3），控制台不直呼 runCommand。
  const intent: GestureIntent = {
    kind: "radial",
    x,
    y,
    slot,
    pointers: 1,
    durationMs,
    area: "console",
  };
  performGesture(host, intent);
  syncGestureConsole();
}

function onWheelCancel(e: PointerEvent): void {
  if (e.pointerId === wheelPointer) closeRadial();
}
