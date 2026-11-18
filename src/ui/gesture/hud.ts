// 手势模式的 HUD（方案 §8 的手机形态）。开启手势后**经典 HUD 让位**：FDF 控制台外框、
// 4×3 命令卡、头像面板与顶部菜单都藏起来（style.css 的 `body.gesture-ui` 规则），
// 换成这里的一套移动端布局：
//
//   · 左上：小地图（把经典 HUD 的那一个节点搬过来，行为 / 小地图点击 / 相机框都不变）；
//   · 顶部：金币 / 木材 / 人口；
//   · 左下：当前选择的名称与生命 / 魔法条（编队条在它上方，见 console.ts）；
//   · 右下：大圆按钮（攻击 / 移动）+ 12 槽命令环（与命令卡同一份 `host.card()`）；
//   · 右上：「菜单」圆钮（F10 的同一条路）。
//
// 这一层只是外观与读数：所有动作仍然走 `GestureMatchHost`（`press` / `performGesture`），
// 不新增 Command，也不碰 `RtsController.execute`（§7.4）。
//
// 性能（§13）：没有 rAF；只在激活期间开一个 500ms 的低频读数定时器（资源 / 选择 / 冷却），
// 关掉手势或离开对局立刻停表。

import { t } from "../../i18n";
import { cardButtonForSlot, performGesture } from "./actions";
import { gestureEnabled, touchDevice } from "./device";
import { currentGestureHost, type GestureMatchHost } from "./host";

const CARD_SLOTS = 12;
/** 读数节拍：资源与选择变化很慢，500ms 足够；不是渲染循环。 */
const POLL_MS = 500;

let root: HTMLDivElement | null = null;
let slotHost: HTMLDivElement | null = null;
let minimapSlot: HTMLDivElement | null = null;
let portraitSlot: HTMLDivElement | null = null;
let inventorySlot: HTMLDivElement | null = null;
let goldEl: HTMLElement | null = null;
let lumberEl: HTMLElement | null = null;
let foodEl: HTMLElement | null = null;
let selPanel: HTMLElement | null = null;
let selName: HTMLElement | null = null;
let hpFill: HTMLElement | null = null;
let mpFill: HTMLElement | null = null;
let attackBtn: HTMLButtonElement | null = null;
let timer = 0;
let slots: HTMLButtonElement[] = [];
let ringRadius = 0;

// 编队图标：放在大圆钮**左侧**、与命令环同心的半圆上（§8 移动端布局）。
// 图标常驻可见，不做「点进去再展开」的两段式；加号钮点一下就直接把当前选择编成新队。
const FLAG_COLORS = [
  "#e0b64a", "#d97b4f", "#c35a5a", "#b45fb0", "#7a6bd6",
  "#5a8ed9", "#4fb3a5", "#6fbf5a", "#a8b04d", "#b08a4d",
];
interface GroupItem {
  wrap: HTMLDivElement;
  btn: HTMLButtonElement;
  clear: HTMLButtonElement;
}
const groupItems = new Map<number, GroupItem>();
let plusItem: { wrap: HTMLDivElement; btn: HTMLButtonElement } | null = null;
/** 最近一次召回的队，用它决定哪一组下面出现「取消编组」。 */
let currentKey: number | null = null;

/**
 * 经典 HUD 里被「借」过来的节点：小地图、头像、物品栏。记下原父节点、原位置与内联样式，
 * 关掉手势时原样放回去 —— 不复制、不重建，所以点击 / 相机框 / 物品拖动行为一个都不变。
 */
interface Borrowed {
  el: HTMLElement;
  parent: Node;
  next: Node | null;
  style: string;
}

const borrowed = new Map<string, Borrowed>();

function borrow(key: string, selector: string, into: HTMLElement | null): void {
  if (borrowed.has(key) || !into) return;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el || !el.parentNode) return;
  borrowed.set(key, {
    el,
    parent: el.parentNode,
    next: el.nextSibling,
    style: el.getAttribute("style") ?? "",
  });
  into.appendChild(el);
}

function release(key: string): void {
  const b = borrowed.get(key);
  if (!b) return;
  b.el.setAttribute("style", b.style);
  b.parent.insertBefore(b.el, b.next);
  borrowed.delete(key);
}

/** 手势 UI 是否正在替代经典 HUD。 */
export function gestureUiActive(): boolean {
  return root !== null && document.body.classList.contains("gesture-ui");
}

/**
 * 进入 / 退出「手势 HUD 替代经典 HUD」。`on` 由 console.ts 按「开关 + 对局 + 有宿主」给出；
 * 这里再确认一次 `gestureEnabled()`，避免关闭后还留着替代布局。
 */
export function setGestureUiActive(on: boolean): void {
  if (typeof document === "undefined") return;
  const want = on && gestureEnabled();
  if (want === gestureUiActive()) {
    if (want) syncGestureHud();
    return;
  }
  if (want) {
    if (!mount()) return;
    document.body.classList.add("gesture-ui");
    adoptAll();
    syncGestureHud();
    startPolling();
  } else {
    stopPolling();
    releaseAll();
    unmount();
    document.body.classList.remove("gesture-ui");
  }
}

function adoptAll(): void {
  borrow("minimap", ".hud .hud-minimap", minimapSlot);
  borrow("portrait", ".hud .hud-portrait", portraitSlot);
  borrow("inventory", ".hud .hud-inventory", inventorySlot);
}

function releaseAll(): void {
  release("inventory");
  release("portrait");
  release("minimap");
}

function mount(): boolean {
  if (root) return true;
  const ui = document.getElementById("ui");
  if (!ui) return false;

  const el = document.createElement("div");
  el.id = "gesture-hud";

  minimapSlot = document.createElement("div");
  minimapSlot.className = "ghud-minimap";

  // 小地图不再放编队条：组图标改到右下大圆钮左侧的半圆上（见 syncGroups / layoutGroupArc）。

  inventorySlot = document.createElement("div");
  inventorySlot.className = "ghud-inventory";

  const top = document.createElement("div");
  top.className = "ghud-top";
  goldEl = chip("gold");
  lumberEl = chip("lumber");
  foodEl = chip("food");
  top.append(goldEl, lumberEl, foodEl);

  selPanel = document.createElement("div");
  selPanel.className = "ghud-sel";
  selPanel.hidden = true;
  portraitSlot = document.createElement("div");
  portraitSlot.className = "ghud-portrait";
  const body = document.createElement("div");
  body.className = "ghud-sel__body";
  selName = document.createElement("div");
  selName.className = "ghud-sel__name";
  const hp = bar("hp");
  const mp = bar("mp");
  hpFill = hp.fill;
  mpFill = mp.fill;
  body.append(selName, hp.el, mp.el);
  selPanel.append(portraitSlot, body);

  slotHost = document.createElement("div");
  slotHost.className = "ghud-actions";
  attackBtn = document.createElement("button");
  attackBtn.type = "button";
  attackBtn.className = "ghud-attack";
  attackBtn.setAttribute("aria-label", t("gesture.ATTACK"));
  attackBtn.textContent = t("gesture.ATTACK");
  attackBtn.addEventListener("click", (e) => {
    e.preventDefault();
    pressPrimary();
  });
  slotHost.appendChild(attackBtn);

  slots = [];
  for (let i = 0; i < CARD_SLOTS; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghud-slot";
    b.dataset.slot = String(i);
    b.tabIndex = -1;
    b.hidden = true;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      pressSlot(i);
    });
    slotHost.appendChild(b);
    slots.push(b);
  }
  plusItem = createPlusItem();
  slotHost.appendChild(plusItem.wrap);
  layoutRing();

  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "ghud-menu";
  menu.setAttribute("aria-label", t("gesture.MENU"));
  menu.textContent = t("gesture.MENU");
  menu.addEventListener("click", (e) => {
    e.preventDefault();
    currentGestureHost()?.toggleMenu();
  });

  el.append(minimapSlot, top, inventorySlot, selPanel, slotHost, menu);
  ui.appendChild(el);
  root = el;
  return true;
}

function unmount(): void {
  root?.remove();
  root = null;
  slotHost = null;
  minimapSlot = null;
  portraitSlot = null;
  inventorySlot = null;
  groupItems.clear();
  plusItem = null;
  currentKey = null;
  goldEl = null;
  lumberEl = null;
  foodEl = null;
  selPanel = null;
  selName = null;
  hpFill = null;
  mpFill = null;
  attackBtn = null;
  slots = [];
  ringRadius = 0;
}

function chip(kind: "gold" | "lumber" | "food"): HTMLElement {
  const el = document.createElement("span");
  el.className = `ghud-res ghud-res--${kind}`;
  el.dataset.kind = kind;
  return el;
}

function bar(kind: "hp" | "mp"): { el: HTMLElement; fill: HTMLElement } {
  const el = document.createElement("div");
  el.className = `ghud-bar ghud-bar--${kind}`;
  const fill = document.createElement("i");
  el.appendChild(fill);
  return { el, fill };
}

function groupBarButton(className: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.title = label;
  b.setAttribute("aria-label", label);
  return b;
}

function createPlusItem(): { wrap: HTMLDivElement; btn: HTMLButtonElement } {
  const wrap = document.createElement("div");
  wrap.className = "ghud-gitem";
  const btn = groupBarButton("ghud-gplus", t("gesture.NEW_GROUP"));
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    formGroup();
  });
  wrap.appendChild(btn);
  return { wrap, btn };
}

/** 加号：一步把当前选择编成新队（不再「点进去再展开空位」）。 */
function formGroup(): void {
  const host = currentGestureHost();
  if (!host?.groups) return;
  const taken = new Set(host.groups().map((g) => g.key));
  let key = 0;
  while (key < 10 && taken.has(key)) key++;
  if (key >= 10) return;
  host.group("assign", key);
  currentKey = key;
  syncGestureHud();
}

/**
 * 编队图标（大圆钮左侧的半圆）：
 *   图标常驻可见，一眼看到每一队；点是直接选中该队；
 *   选中的那一组**正下方**浮出红色 ×，点它清空该队；
 *   末尾的加号点一次就把当前选择编成新队 —— 没有「点进去再展开」的中间态。
 * 图标是首单位的命令卡原图（缺图时退回彩色队旗），人数是角标。
 */
function syncGroups(host: GestureMatchHost): void {
  if (!slotHost) return;
  const groups = host.groups?.() ?? [];

  for (const [key, item] of [...groupItems]) {
    if (groups.some((g) => g.key === key)) continue;
    item.wrap.remove();
    groupItems.delete(key);
  }
  if (currentKey !== null && !groups.some((g) => g.key === currentKey)) currentKey = null;

  for (const g of groups) {
    let item = groupItems.get(g.key);
    if (!item) {
      const wrap = document.createElement("div");
      wrap.className = "ghud-gitem";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghud-gflag";
      const flag = document.createElement("span");
      flag.className = "ghud-flag";
      const badge = document.createElement("b");
      badge.className = "ghud-gflag__n";
      btn.append(flag, badge);
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        tapGroup(g.key);
      });
      // 「取消编组」是这一组自己的第二个按钮，就在它的正下方。
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "ghud-gclear";
      clear.title = t("gesture.UNGROUP");
      clear.setAttribute("aria-label", t("gesture.UNGROUP"));
      clear.textContent = "\u00d7";
      clear.hidden = true;
      clear.addEventListener("click", (e) => {
        e.preventDefault();
        currentGestureHost()?.clearGroup?.(g.key);
        currentKey = null;
        syncGestureHud();
      });
      wrap.append(btn, clear);
      slotHost.insertBefore(wrap, plusItem?.wrap ?? null);
      item = { wrap, btn, clear };
      groupItems.set(g.key, item);
    }
    item.btn.style.setProperty("--flag", FLAG_COLORS[g.key % FLAG_COLORS.length]);
    item.btn.style.setProperty("--icon", g.icon ? `url("${g.icon}")` : "none");
    item.btn.classList.toggle("has-icon", !!g.icon);
    const badge = item.btn.lastElementChild;
    if (badge) badge.textContent = String(g.count);
    const active = currentKey === g.key;
    item.btn.classList.toggle("active", active);
    item.clear.hidden = !active;
  }

  layoutGroupArc();
}

/** 把已有组图标 + 加号沿大圆钮左半圆均布；容器随之长大，不压右侧命令环。 */
function layoutGroupArc(): void {
  if (!slotHost) return;
  const wraps = [...groupItems.entries()].sort((a, b) => a[0] - b[0]).map(([, it]) => it.wrap);
  if (plusItem) wraps.push(plusItem.wrap);
  const n = wraps.length;
  // 组图标比命令环外一圈（+48），两者不重叠；组多了按弧长加半径，最多加到 +70。
  const base = Math.max(ringRadius, 86);
  const radius = Math.min(base + 70, Math.max(base + 48, Math.ceil((46 * n) / Math.PI)));
  slotHost.style.setProperty("--ghud-outer", `${(radius + 24) * 2}px`);
  const start = 138;
  const end = 222;
  for (let i = 0; i < n; i++) {
    const deg = n === 1 ? 180 : start + ((end - start) * i) / (n - 1);
    const a = (deg * Math.PI) / 180;
    wraps[i].style.left = `calc(50% + ${(Math.cos(a) * radius).toFixed(1)}px)`;
    wraps[i].style.top = `calc(50% + ${(Math.sin(a) * radius).toFixed(1)}px)`;
  }
}

function tapGroup(key: number): void {
  const host = currentGestureHost();
  if (!host) return;
  host.group("recall", key);
  currentKey = key;
  syncGestureHud();
}

/** 12 槽沿圆环均布，0 在正上方，顺时针与命令卡 `row * 4 + col` 同序。 */
function layoutRing(): void {
  if (!slotHost) return;
  const radius = touchDevice().deviceClass === "tablet" ? 118 : 86;
  if (radius === ringRadius) return;
  ringRadius = radius;
  slotHost.style.setProperty("--ghud-radius", `${radius}px`);
  const step = 360 / CARD_SLOTS;
  for (let i = 0; i < slots.length; i++) {
    const angle = (-90 + i * step) * (Math.PI / 180);
    slots[i].style.left = `calc(50% + ${(Math.cos(angle) * radius).toFixed(1)}px)`;
    slots[i].style.top = `calc(50% + ${(Math.sin(angle) * radius).toFixed(1)}px)`;
  }
}

/** 刷新读数与命令环。由定时器、宿主换人、每次手势动作之后调用。 */
export function syncGestureHud(): void {
  const host = currentGestureHost();
  if (!root || !host) return;
  // HUD 比手势层晚建好时（同一帧里 match 刚起），下一次读数再试一次借经典节点。
  if (borrowed.size < 3) adoptAll();
  layoutRing();

  const status = host.status?.() ?? null;
  if (goldEl) goldEl.textContent = status ? String(status.gold) : "—";
  if (lumberEl) lumberEl.textContent = status ? String(status.lumber) : "—";
  if (foodEl) foodEl.textContent = status ? `${status.foodUsed}/${status.foodMax}` : "—";

  const sel = status?.selection ?? null;
  if (selPanel) selPanel.hidden = !sel;
  if (sel && selName) {
    selName.textContent = sel.name;
    paintBar(hpFill, sel.hp, sel.maxHp);
    paintBar(mpFill, sel.mana, sel.maxMana);
  }

  const card = host.card();
  syncGroups(host);
  for (let i = 0; i < slots.length; i++) {
    const button = cardButtonForSlot(card, i);
    const el = slots[i];
    if (!button) {
      el.hidden = true;
      continue;
    }
    el.hidden = false;
    el.classList.toggle("off", button.disabled || !!button.passive);
    el.style.backgroundImage = button.icon ? `url("${button.icon}")` : "";
    el.textContent = button.icon ? "" : (button.hotkey ?? button.name ?? "").slice(0, 2).toUpperCase();
  }

  const attack = card.find((c) => c.id === "attack") ?? card.find((c) => c.id === "move");
  if (attackBtn) {
    attackBtn.style.backgroundImage = attack?.icon ? `url("${attack.icon}")` : "";
    attackBtn.textContent = attack?.icon ? "" : t("gesture.ATTACK");
    attackBtn.classList.toggle("off", !attack || attack.disabled);
  }
  root.classList.toggle("armed", host.armed());
}

function paintBar(fill: HTMLElement | null, value: number, max: number): void {
  if (!fill) return;
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  fill.style.width = `${pct.toFixed(1)}%`;
}

/** 大圆按钮：攻击优先，没有攻击时退到移动；两者都走 `press`（与命令卡同一条门）。 */
function pressPrimary(): void {
  const host = currentGestureHost();
  if (!host?.canAct()) return;
  const card = host.card();
  const attack = card.find((c) => c.id === "attack" && !c.disabled);
  if (attack) {
    host.press(attack.id);
    return;
  }
  const move = card.find((c) => c.id === "move" && !c.disabled);
  if (move) host.press(move.id);
}

/** 命令环槽位：与径向轮盘同一条 `radial` 意图，门控与归因由 actions 统一处理。 */
function pressSlot(index: number): void {
  const host = currentGestureHost();
  if (!host?.canAct()) return;
  const el = slots[index];
  const button = cardButtonForSlot(host.card(), index);
  if (!button || button.disabled || button.passive) return;
  const rect = el?.getBoundingClientRect();
  performGesture(host, {
    kind: "radial",
    x: rect ? rect.left + rect.width / 2 : 0,
    y: rect ? rect.top + rect.height / 2 : 0,
    slot: index,
    pointers: 1,
    durationMs: 0,
    area: "console",
  });
  syncGestureHud();
}

function startPolling(): void {
  stopPolling();
  timer = window.setInterval(syncGestureHud, POLL_MS);
}

function stopPolling(): void {
  if (timer) window.clearInterval(timer);
  timer = 0;
}
