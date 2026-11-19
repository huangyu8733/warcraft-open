// 手势模式的 HUD（方案 §8 的手机形态）。开启手势后**经典 HUD 让位**：FDF 控制台外框、
// 4×3 命令卡、头像面板与顶部菜单都藏起来（style.css 的 `body.gesture-ui` 规则），
// 换成这里的一套移动端布局：
//
//   · 左上：小地图（把经典 HUD 的那一个节点搬过来，行为 / 小地图点击 / 相机框都不变）；
//           编队条就在小地图正下方（横向排列，见 syncGroups）；
//   · 顶部：金币 / 木材 / 人口；
//   · 左下：当前选择的名称与生命 / 魔法条；
//   · 右下：大圆按钮（攻击 / 移动）+ 12 槽命令环（与命令卡同一份 `host.card()`）；
//   · 右上：「菜单」圆钮（F10 的同一条路）。
//
// 这一层只是外观与读数：所有动作仍然走 `GestureMatchHost`（`press` / `performGesture`），
// 不新增 Command，也不碰 `RtsController.execute`（§7.4）。
//
// 性能（§13）：没有 rAF；只在激活期间开一个 500ms 的低频读数定时器（资源 / 选择 / 冷却），
// 关掉手势或离开对局立刻停表。

import { CircleDot, CircleHelp, Coins, Crosshair, Eye, Flag, Hammer, ListOrdered, Maximize, Menu, Minimize, Move, Package, Plus, RotateCcw, RotateCw, Swords, Trash2, Users, X, Zap, ZoomIn, ZoomOut, createElement as lucideIcon } from "lucide";
import { t, type MessageKey } from "../../i18n";
import { showCooldownNumbers } from "../../render/gameplayOptions";
import { fullscreenActive, fullscreenSupported, toggleFullscreen } from "../fullscreen";
import { wc3StripMarkup } from "../wc3Text";
import { cardButtonForSlot, performGesture } from "./actions";
import { gestureEnabled, touchDevice } from "./device";
import { currentGestureHost, type GestureCardButton, type GestureMatchHost, type HelpCatalog, type HelpEntry } from "./host";

const CARD_SLOTS = 12;
/** 选择面板里一排最多画 6 个队列图标（34px × 6 + 4px 间距正好是面板正文的宽度），
 *  再多的折成最后一格角上的 +N——手势面板只给队列一行，不换行、不挤掉血条。 */
const QUEUE_SLOTS = 6;
/** 读数节拍：资源与选择变化很慢，500ms 足够；不是渲染循环。 */
const POLL_MS = 500;

let root: HTMLDivElement | null = null;
let slotHost: HTMLDivElement | null = null;
let minimapSlot: HTMLDivElement | null = null;
let groupBar: HTMLDivElement | null = null;
let portraitSlot: HTMLDivElement | null = null;
let inventorySlot: HTMLDivElement | null = null;
let goldEl: HTMLElement | null = null;
/** 顶部资源条（`.ghud-top`）：手势总开关借住在这里，排在金币前面。 */
let topBar: HTMLDivElement | null = null;
/** 左上角那列里的「取消选择」：没有选中任何单位时整颗钮都不画。 */
let clearSelBtn: HTMLButtonElement | null = null;
/** 左下旋转列最下面的「镜头跟随」：亮着表示镜头锁在某个单位上（与 Ctrl+C 同一个开关）。 */
let followBtn: HTMLButtonElement | null = null;
/** 跟随默认关着：手势选中单位只做选择，不抢镜头。玩家按跟随钮打开后就一直开着，
 *  换目标自动跟上（Ctrl+C 同一把骑乘锁）；自己拖镜头松开的锁不会被同一次选择重新
 *  接回去，只有换了目标才会再跟上。 */
let autoFollow = false;
/** 上一次参与自动跟随的选择 id——用来分辨「换了目标」与「同一个目标被松开」。 */
let autoFollowSel: number | null = null;
let lumberEl: HTMLElement | null = null;
let foodEl: HTMLElement | null = null;
let selPanel: HTMLElement | null = null;
let selName: HTMLElement | null = null;
let hpFill: HTMLElement | null = null;
let mpFill: HTMLElement | null = null;
/** 魔法条本身（不只是里面那段填充）：没有魔法值的单位（建筑、步兵、金矿）整条不画，
 *  否则血条下面永远挂着一根空的深色条，看着像少了点什么。 */
let mpRow: HTMLElement | null = null;
/** 选中单位正在干的活（训练 / 研究 / 主城升级）的进度条，画在血蓝条下面。 */
let selProgress: HTMLElement | null = null;
let selProgressFill: HTMLElement | null = null;
/** 头像下方的生产队列（训练 / 研究）：一排图标，点哪一个就取消哪一个。 */
let queueRow: HTMLDivElement | null = null;
let queueSig = "";
/** 舱内乘客（金矿里的精灵、飞艇 / 地洞里的单位）：一排小头像，点一个就把那一个
 *  放到载具脚下——手机没有经典控制台的货舱面板，这是「进去以后怎么出来」的出口。 */
let cargoRow: HTMLDivElement | null = null;
let cargoSig = "";
/** 地上物品：名称下面是说明正文，再下面是「附近谁能来捡」的一排头像——点谁就谁去捡。 */
let selDesc: HTMLDivElement | null = null;
let pickRow: HTMLDivElement | null = null;
let pickSig = "";
/** 血条那一行：选中物品时整行收起来（物品没有生命值，空血条只会让人以为它快死了）。 */
let hpRow: HTMLElement | null = null;
/** 视角键：八方向连按中的一部分，以及左右旋转（按住生效，松开回正）。 */
type ViewKey = "up" | "down" | "left" | "right" | "rotateLeft" | "rotateRight";
/** 左下角八方向移动盘的角度 → 需要同时按住的键（斜向是两个键一起按）。 */
const PAD_SECTORS: Array<[number, ViewKey[]]> = [
  [0, ["up"]],
  [45, ["up", "right"]],
  [90, ["right"]],
  [135, ["right", "down"]],
  [180, ["down"]],
  [225, ["down", "left"]],
  [270, ["left"]],
  [315, ["left", "up"]],
];

let attackBtn: HTMLButtonElement | null = null;
/** 左上角工具列最上面的全屏开关（小地图右侧）。桌面壳 / iPhone 上不显示（没有可用的全屏）。 */
let fsBtn: HTMLButtonElement | null = null;
/** 左下角（物品栏上方）视角控制的箭头节点：按住时点亮当前方向。 */
let padArrows: HTMLElement[] = [];
/** 松开所有按住的视角键：卸载手势 HUD 时兜底，别把相机留在「一直按住」。 */
let releaseView: (() => void) | null = null;
let timer = 0;
let slots: HTMLButtonElement[] = [];
let slotTexts: HTMLElement[] = [];
let slotLearns: HTMLElement[] = [];
/** 右上角的「自动施法」小闪电（下标 = 环槽位）。只给能设自动的技能画，点它翻开关。 */
let slotAutos: HTMLElement[] = [];
/** 环槽位上的冷却读数（下标 = 环槽位）：径向暗扇形 + 剩余整秒。 */
let slotCds: HTMLElement[] = [];
let ringRadius = 0;
/** 右下动作簇的「说明」钮，以及它打开的物品 / 技能说明面板。 */
let clusterInfoBtn: HTMLButtonElement | null = null;
let clusterHelpEl: HTMLDivElement | null = null;
let clusterHelpList: HTMLDivElement | null = null;
let clusterHelpOpen = false;

// 帮助面板（#ghud-help）：全屏遮罩 + 五个标签页。当前页与搜索词留在模块里，
// 重开面板回到上次看的位置；面板本身随手势 HUD 一起装卸。
type HelpTab = "controls" | "units" | "buildings" | "items" | "abilities";

const HELP_TABS: Array<[HelpTab, MessageKey]> = [
  ["controls", "help.TABS_CONTROLS"],
  ["units", "help.TABS_UNITS"],
  ["buildings", "help.TABS_BUILDINGS"],
  ["items", "help.TABS_ITEMS"],
  ["abilities", "help.TABS_ABILITIES"],
];

/** 操作页：每个手势控件一条（图标、名称、说明），全部走 i18n。 */
const HELP_CONTROLS: Array<[typeof CircleHelp, MessageKey, MessageKey]> = [
  [Swords, "help.CTRL_ATTACK", "help.CTRL_ATTACK_TEXT"],
  [CircleDot, "help.CTRL_RING", "help.CTRL_RING_TEXT"],
  [Hammer, "help.CTRL_BUILD", "help.CTRL_BUILD_TEXT"],
  [Move, "help.CTRL_PAD", "help.CTRL_PAD_TEXT"],
  [RotateCcw, "help.CTRL_ROTATE", "help.CTRL_ROTATE_TEXT"],
  [Eye, "help.CTRL_TILT", "help.CTRL_TILT_TEXT"],
  [Crosshair, "help.CTRL_FOLLOW", "help.CTRL_FOLLOW_TEXT"],
  [ZoomOut, "help.CTRL_ZOOM", "help.CTRL_ZOOM_TEXT"],
  [Flag, "help.CTRL_GROUPS", "help.CTRL_GROUPS_TEXT"],
  [Plus, "help.CTRL_LEARN", "help.CTRL_LEARN_TEXT"],
  [Zap, "help.CTRL_AUTOCAST", "help.CTRL_AUTOCAST_TEXT"],
  [ListOrdered, "help.CTRL_QUEUE", "help.CTRL_QUEUE_TEXT"],
  [Users, "help.CTRL_CARGO", "help.CTRL_CARGO_TEXT"],
  [Package, "help.CTRL_INVENTORY", "help.CTRL_INVENTORY_TEXT"],
  [X, "help.CTRL_CLEAR", "help.CTRL_CLEAR_TEXT"],
  [Coins, "help.CTRL_RESOURCES", "help.CTRL_RESOURCES_TEXT"],
  [Menu, "help.CTRL_MENU", "help.CTRL_MENU_TEXT"],
  [CircleHelp, "help.CTRL_HELP", "help.CTRL_HELP_TEXT"],
];


let helpEl: HTMLDivElement | null = null;
let helpPanel: HTMLDivElement | null = null;
/** 面板打开期间挂在 window 捕获段的按键闸：游戏的热键在 window 上更早一步收走按键，
 *  光在面板上监听 Escape 收不到。收起时摘掉。 */
let helpKeys: ((e: KeyboardEvent) => void) | null = null;
let helpBtn: HTMLButtonElement | null = null;
let helpSearch: HTMLInputElement | null = null;
let helpBody: HTMLDivElement | null = null;
let helpDetail: HTMLDivElement | null = null;
let helpDetailName: HTMLElement | null = null;
let helpDetailText: HTMLElement | null = null;
let helpTabs: HTMLButtonElement[] = [];
let helpCatalogData: HelpCatalog | null = null;
let helpTab: HelpTab = "controls";
let helpSelected = "";
const helpQueries: Record<HelpTab, string> = {
  controls: "", units: "", buildings: "", items: "", abilities: "",
};

// 「进入下一页」的按钮（建造 / 英雄技能 / 法术书）不占 12 槽命令环：它们单独排到
// 攻击钮**右侧**的外圈半弧上。命令环保持不动，直接下达的命令仍按卡面槽位落座。
let enterHost: HTMLDivElement | null = null;
const enterItems = new Map<string, HTMLButtonElement>();

// 建造不点进去：工人被选中时，建造页里的建筑直接排到攻击钮**左侧**的外圈半弧上。
// 命令环仍留在内圈，右边照旧是直接下令；建筑多了就往弧的两端铺，图标按弧长收一点。
let buildHost: HTMLDivElement | null = null;
/** 上一次把「建造/学技能」子页退回 root 的时间（ms），防止每帧重复发 cancel。 */
let subpageCancelAt = 0;
let buildEls: HTMLButtonElement[] = [];
let buildTexts: HTMLElement[] = [];
/** 学技能格的右上角「+」：点它才学 / 升这一门（与命令环上的 + 同一套）。 */
let buildPlus: HTMLElement[] = [];
let buildCards: readonly GestureCardButton[] = [];
/** 半弧上的「固定座位」：和 `buildEls` 同下标，值是当前占座的按钮 id（空位是 null）。
 *  学掉一门技能后它从列表里消失，座位留成空位而不是让后面的图标往前挤——点「+」
 *  升级 / 学技能时，剩下的图标保持原位不动。换人（新旧列表没有任何交集）才整排重排。 */
let arcIds: (string | null)[] = [];
/** 命令环空槽里落座的「建造 / 学技能」卡（下标 = 环槽位，null 表示这个槽仍是空的）。
 *  环上摆得下的就不再排到外圈半弧；摆不下的那几张才留在半弧（`seatSideArc`）。 */
let seated: (GestureCardButton | null)[] = new Array(CARD_SLOTS).fill(null);

// 编队条：小地图**正下方**的一排图标，横向排列、自动换行（§8 移动端布局）。
// 图标常驻可见，不做「点进去再展开」的两段式；加号钮点一下就直接把当前选择编成新队。
// 每组显示组内首单位的头像（缺图退回彩色队旗）+ 人数角标；点一下选中该队。
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

function borrow(key: string, selector: string, into: HTMLElement | null, before: Node | null = null): void {
  if (borrowed.has(key) || !into) return;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el || !el.parentNode) return;
  borrowed.set(key, {
    el,
    parent: el.parentNode,
    next: el.nextSibling,
    style: el.getAttribute("style") ?? "",
  });
  into.insertBefore(el, before);
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
  // 手势总开关搬到顶部资源条里、金币的左边：图标是鼠标箭头（点它就是切回鼠标操作）。
  borrow("power", "#gesture-power", topBar, goldEl);
}

function releaseAll(): void {
  release("power");
  release("inventory");
  release("portrait");
  release("minimap");
}

function mount(): boolean {
  if (root) return true;
  // 每一局（每次启用）都回到「默认不跟随」：上一局打开的跟随不带到下一局。
  autoFollow = false;
  autoFollowSel = null;
  const ui = document.getElementById("ui");
  if (!ui) return false;

  const el = document.createElement("div");
  el.id = "gesture-hud";

  minimapSlot = document.createElement("div");
  minimapSlot.className = "ghud-minimap";

  // 编队条紧跟在小地图下方：横向一排，不遮地图、也不挤右下命令环。
  groupBar = document.createElement("div");
  groupBar.className = "ghud-groups";

  inventorySlot = document.createElement("div");
  inventorySlot.className = "ghud-inventory";

  const top = document.createElement("div");
  top.className = "ghud-top";
  topBar = top;
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
  hpRow = hp.el;
  mpRow = mp.el;
  body.append(selName, hp.el, mp.el);
  selProgress = document.createElement("div");
  selProgress.className = "ghud-sel__prog";
  selProgress.hidden = true;
  selProgressFill = document.createElement("i");
  selProgress.appendChild(selProgressFill);
  body.append(selProgress);
  // 生产队列：建筑正在训练 / 研究的项目按顺序排成一排图标。点哪一个就撤哪一个，
  // 不用为了取消一个排队的单位再点进经典命令卡。
  queueRow = document.createElement("div");
  queueRow.className = "ghud-queue";
  queueRow.hidden = true;
  body.append(queueRow);
  cargoRow = document.createElement("div");
  cargoRow.className = "ghud-cargo";
  cargoRow.hidden = true;
  body.append(cargoRow);
  // 地上物品：说明正文 + 「附近谁能来捡」的头像。手机没有右键，点物品只会选中它，
  // 这一排头像就是把它交给指定单位的入口（宿主走和右键同一条 `getitem`）。
  selDesc = document.createElement("div");
  selDesc.className = "ghud-sel__desc";
  selDesc.hidden = true;
  body.append(selDesc);
  pickRow = document.createElement("div");
  pickRow.className = "ghud-pick";
  pickRow.hidden = true;
  body.append(pickRow);
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
  slotTexts = [];
  slotLearns = [];
  slotAutos = [];
  slotCds = [];
  for (let i = 0; i < CARD_SLOTS; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghud-slot";
    b.dataset.slot = String(i);
    b.tabIndex = -1;
    b.hidden = true;
    // 图标缺失时的短标签，以及右上角的「+」（技能可升级）。两者都常驻，
    // 每次读数只改内容，避免 `textContent` 把角标一起擦掉。
    const label = document.createElement("i");
    label.className = "ghud-slot__text";
    const plus = document.createElement("b");
    plus.className = "ghud-learn";
    plus.textContent = "+";
    plus.hidden = true;
    // 「+」自己就是那个按钮：点加号升级技能，点技能图标仍然是施放（见 pressSlot）。
    plus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const g = currentGestureHost();
      if (!g?.canAct()) return;
      const target = cardButtonForSlot(g.card(), i);
      const seat = seated[i];
      if (target?.learnId) g.press(`learn:${target.learnId}`);
      else if (seat && !seat.disabled && seat.id.startsWith("learn:")) g.press(seat!.id);
      syncGestureHud();
    });
    // 自动施法开关：能设自动的技能在右上角带一颗小闪电（与「+」同角，见 CSS 的让位）。
    // 点它只翻开关（卡面上的 `altId`，和经典命令卡右键是同一条命令），不会施法；
    // 亮着表示自动正开着（`modal`）。做成 <b> 而不是 <button>：槽位本身就是按钮，
    // 嵌套按钮不是合法结构。
    const auto = document.createElement("b");
    auto.className = "ghud-auto";
    auto.hidden = true;
    auto.setAttribute("role", "button");
    auto.setAttribute("aria-label", t("gesture.AUTOCAST"));
    auto.title = t("gesture.AUTOCAST");
    auto.appendChild(lucideIcon(Zap, { "stroke-width": 2.4, "aria-hidden": "true" }));
    auto.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const g = currentGestureHost();
      if (!g?.canAct()) return;
      const target = cardButtonForSlot(g.card(), i) ?? seated[i] ?? null;
      if (!target?.altId || target.disabled) return;
      g.press(target.altId);
      syncGestureHud();
    });
    // 冷却读数：技能转圈时盖一层径向暗扇形，中间显示剩余整秒（与经典命令卡同一读数）。
    // 单独一个节点，只改背景与文字，不碰图标、加号和闪电。
    const cd = document.createElement("b");
    cd.className = "ghud-slot__cd";
    cd.hidden = true;
    b.append(label, plus, auto, cd);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      pressSlot(i);
    });
    slotHost.appendChild(b);
    slots.push(b);
    slotTexts.push(label);
    slotLearns.push(plus);
    slotAutos.push(auto);
    slotCds.push(cd);
  }
  enterHost = document.createElement("div");
  enterHost.className = "ghud-enter";
  slotHost.appendChild(enterHost);
  buildHost = document.createElement("div");
  buildHost.className = "ghud-build";
  buildHost.hidden = true;
  slotHost.appendChild(buildHost);
  plusItem = createPlusItem();
  groupBar.appendChild(plusItem.wrap);
  layoutRing();
  const clusterHelp = buildClusterTools();

  const menu = document.createElement("button");
  menu.type = "button";
  menu.className = "ghud-menu";
  menu.setAttribute("aria-label", t("gesture.MENU"));
  menu.textContent = t("gesture.MENU");
  menu.addEventListener("click", (e) => {
    e.preventDefault();
    currentGestureHost()?.toggleMenu();
  });

  // 手机没有滚轮、也没有 ESC，也点不到「空地」：左上角、小地图右侧一列工具钮——
  // 缩小 / 放大 / 取消选择，最下面是菜单。缩放和滚轮、双指捏合是同一条 zoomBy：
  // `−1` 拉远（人物更小）、`+1` 拉近（人物更大），所以置顶的是缩小、下面才是放大。
  const zoomBar = document.createElement("div");
  zoomBar.className = "ghud-zoom";
  const zoomOut = groupBarButton("ghud-zoom__btn", t("gesture.ZOOM_OUT"));
  zoomOut.appendChild(lucideIcon(ZoomOut, { "stroke-width": 2.2, "aria-hidden": "true" }));
  zoomOut.addEventListener("click", (e) => {
    e.preventDefault();
    currentGestureHost()?.zoomBy(-1);
  });
  const zoomIn = groupBarButton("ghud-zoom__btn", t("gesture.ZOOM_IN"));
  zoomIn.appendChild(lucideIcon(ZoomIn, { "stroke-width": 2.2, "aria-hidden": "true" }));
  zoomIn.addEventListener("click", (e) => {
    e.preventDefault();
    currentGestureHost()?.zoomBy(1);
  });
  const clearSel = groupBarButton("ghud-zoom__btn", t("gesture.CLEAR_SELECTION"));
  clearSel.hidden = true;
  clearSelBtn = clearSel;
  clearSel.appendChild(lucideIcon(X, { "stroke-width": 2.6, "aria-hidden": "true" }));
  clearSel.addEventListener("click", (e) => {
    e.preventDefault();
    currentGestureHost()?.clearSelection?.();
    syncGestureHud();
  });
  helpBtn = groupBarButton("ghud-zoom__btn", t("gesture.HELP"));
  helpBtn.setAttribute("aria-pressed", "false");
  helpBtn.appendChild(lucideIcon(CircleHelp, { "stroke-width": 2.2, "aria-hidden": "true" }));
  helpBtn.addEventListener("click", (e) => {
    e.preventDefault();
    toggleHelp();
  });
  // 帮助钮排在顶部资源条最前面：正好在「鼠标箭头」（切回鼠标操作的开关）左边，
  // 不跟左下的缩放/取消选择抢那一列。
  topBar?.prepend(helpBtn);
  zoomBar.append(zoomOut, zoomIn, clearSel);
  // 全屏开关：手机没有 Esc / Alt+Enter，进图时 home.ts 的全屏请求把人锁在全屏里，
  // 这一颗就是出口（也是入口）。放在左上角工具列最上面，小地图右侧。
  fsBtn = groupBarButton("ghud-zoom__btn", t("hud.fullscreen"));
  fsBtn.hidden = !fullscreenSupported();
  fsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    toggleFullscreen();
  });
  syncFullscreenButton();
  zoomBar.prepend(fsBtn);

  // 左下角、物品栏上方：八方向移动盘 + 左右旋转。
  // 两个都是「按住即持续」：直接写相机已有的方向键 / Insert·Delete 状态，逐帧速度、
  // 地图边缘限制、Ctrl+C 的镜头解锁全部沿用原生逻辑，手势层不多开一个帧循环。
  const held = new Set<ViewKey>();
  /** 盘上亮着的箭头：镜头模式下跟着 `held` 走，指挥单位模式下跟着手指方向走。 */
  const lit = new Set<ViewKey>();
  const paintPad = (): void => {
    for (const a of padArrows) {
      const dirs = (a.dataset.dirs ?? "").split(" ").filter(Boolean) as ViewKey[];
      a.classList.toggle("on", dirs.length > 0 && dirs.every((d) => lit.has(d)));
    }
  };
  const setKey = (key: ViewKey, on: boolean): void => {
    if (on === held.has(key)) return;
    if (on) held.add(key);
    else held.delete(key);
    if (key !== "rotateLeft" && key !== "rotateRight") {
      if (on) lit.add(key);
      else lit.delete(key);
    }
    currentGestureHost()?.viewKey?.(key, on);
    paintPad();
  };
  releaseView = () => { stopPadRepeat(); for (const k of [...held]) setKey(k, false); };

  const view = document.createElement("div");
  view.className = "ghud-view";
  const pad = document.createElement("div");
  pad.className = "ghud-pad";
  pad.setAttribute("role", "group");
  pad.setAttribute("aria-label", t("gesture.MOVE_VIEW"));
  padArrows = [];
  for (const [angle, keys] of PAD_SECTORS) {
    const a = document.createElement("i");
    a.className = "ghud-pad__arrow";
    a.style.setProperty("--a", `${angle}deg`);
    a.dataset.dirs = keys.join(" ");
    pad.appendChild(a);
    padArrows.push(a);
  }
  // 指头落在盘上就以「相对圆心」的方向为准：正八向 + 圆心死区；按住拖动可以换方向。
  let padPointer: number | null = null;
  const padKeysAt = (e: PointerEvent): ViewKey[] => {
    const r = pad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width * 0.16) return [];
    // 以「正上方 = 0°、顺时针」为序，45° 一档，正好对上 PAD_SECTORS 的下标。
    const fromUp = (Math.atan2(dx, -dy) * 180) / Math.PI;
    const idx = ((Math.round(fromUp / 45) % 8) + 8) % 8;
    return PAD_SECTORS[idx][1];
  };
  // 选中能走的单位时，盘是「指挥他们走」：按住的每一拍朝手指方向补一次移动命令，
  // 换方向立刻下令。松手 / 死区 / 选中的东西不能走，就回到原来的镜头平移。
  const PAD_ORDER_MS = 450;
  let padDirX = 0;
  let padDirY = 0;
  let padRepeat = 0;
  const stopPadRepeat = (): void => {
    if (!padRepeat) return;
    window.clearInterval(padRepeat);
    padRepeat = 0;
  };
  const startPadRepeat = (): void => {
    if (padRepeat) return;
    padRepeat = window.setInterval(() => {
      if (padPointer === null || (!padDirX && !padDirY)) { stopPadRepeat(); return; }
      currentGestureHost()?.moveSelectionDir?.(padDirX, padDirY);
    }, PAD_ORDER_MS);
  };
  /** 盘当前走的是「指挥单位」还是「镜头」。 */
  const padDirect = (e: PointerEvent): boolean => {
    const h = currentGestureHost();
    if (!h?.selectionMovable?.() || !h.moveSelectionDir) return false;
    const keys = padKeysAt(e);
    lit.clear();
    for (const k of keys) lit.add(k);
    paintPad();
    let dx = 0;
    let dy = 0;
    for (const k of keys) {
      if (k === "up") dy -= 1;
      else if (k === "down") dy += 1;
      else if (k === "left") dx -= 1;
      else if (k === "right") dx += 1;
    }
    const changed = dx !== padDirX || dy !== padDirY;
    padDirX = dx;
    padDirY = dy;
    if (dx || dy) {
      if (changed) h.moveSelectionDir(dx, dy); // 换方向立刻下令；同一方向交给按住重复
      startPadRepeat();
    } else {
      stopPadRepeat(); // 圆心死区：别让上一条命令继续补发
    }
    return true;
  };
  const padTo = (e: PointerEvent): void => {
    // 选中的是能走的单位：方向盘就是命令（不再写相机键，否则镜头会跟着一起动）。
    if (padDirect(e)) {
      for (const k of [...held]) setKey(k, false);
      return;
    }
    stopPadRepeat();
    const next = new Set(padKeysAt(e));
    for (const k of [...held]) if (!next.has(k) && k !== "rotateLeft" && k !== "rotateRight") setKey(k, false);
    for (const k of next) setKey(k, true);
  };
  pad.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    padPointer = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    pad.setAttribute("aria-label", t(currentGestureHost()?.selectionMovable?.() ? "gesture.MOVE_UNITS" : "gesture.MOVE_VIEW"));
    padTo(e);
  });
  pad.addEventListener("pointermove", (e) => {
    if (e.pointerId === padPointer) padTo(e);
  });
  const endPad = (e: PointerEvent): void => {
    if (e.pointerId !== padPointer) return;
    padPointer = null;
    stopPadRepeat();
    padDirX = 0;
    padDirY = 0;
    for (const k of ["up", "down", "left", "right"] as ViewKey[]) setKey(k, false);
    lit.clear();
    paintPad();
  };
  pad.addEventListener("pointerup", endPad);
  pad.addEventListener("pointercancel", endPad);

  const rot = document.createElement("div");
  rot.className = "ghud-rot";
  const rotations: Array<[ViewKey, typeof RotateCcw, string]> = [
    ["rotateLeft", RotateCcw, t("gesture.ROTATE_LEFT")],
    ["rotateRight", RotateCw, t("gesture.ROTATE_RIGHT")],
  ];
  for (const [key, glyph, label] of rotations) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghud-rot__btn";
    b.setAttribute("aria-label", label);
    b.appendChild(lucideIcon(glyph, { "stroke-width": 2.2, "aria-hidden": "true" }));
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      setKey(key, true);
    });
    const off = (e: Event): void => {
      e.preventDefault();
      setKey(key, false);
    };
    b.addEventListener("pointerup", off);
    b.addEventListener("pointercancel", off);
    b.addEventListener("pointerleave", off);
    rot.appendChild(b);
  }
  // 旋转钮下面：斜视 / 俯视切换。点一下把镜头抬高到接近正俯视，再点一下回默认斜视；
  // 只走 host.toggleView（相机自己的俯仰），不动朝向、缩放和焦点位置。
  const tilt = document.createElement("button");
  tilt.type = "button";
  tilt.className = "ghud-rot__btn";
  tilt.setAttribute("aria-label", t("gesture.TOGGLE_VIEW"));
  tilt.setAttribute("aria-pressed", "false");
  tilt.appendChild(lucideIcon(Eye, { "stroke-width": 2.2, "aria-hidden": "true" }));
  tilt.addEventListener("click", (e) => {
    e.preventDefault();
    currentGestureHost()?.toggleView?.();
    const on = tilt.getAttribute("aria-pressed") !== "true";
    tilt.setAttribute("aria-pressed", String(on));
    tilt.classList.toggle("on", on);
  });
  rot.appendChild(tilt);
  // 再下面：镜头跟随。与 Ctrl+C 同一个开关——锁住当前选中的己方单位，玩家自己拖镜头、
  // 目标阵亡时相机会自动松开，按钮的亮灭由每帧 syncGestureHud 回读。
  followBtn = document.createElement("button");
  followBtn.type = "button";
  followBtn.className = "ghud-rot__btn";
  followBtn.setAttribute("aria-label", t("gesture.FOLLOW_CAMERA"));
  followBtn.setAttribute("aria-pressed", "false");
  followBtn.appendChild(lucideIcon(Crosshair, { "stroke-width": 2.2, "aria-hidden": "true" }));
  followBtn.addEventListener("click", (e) => {
    e.preventDefault();
    const h = currentGestureHost();
    if (!h?.canAct()) return;
    // 手动按跟随钮 = 同时设定「以后还要不要自动跟」：关掉后换目标也不再自动接上。
    autoFollow = !!h.toggleCameraLock?.();
    autoFollowSel = h.status?.()?.selection?.id ?? null;
    syncGestureHud();
  });
  rot.appendChild(followBtn);
  view.append(pad, rot);

  const help = buildHelpPanel();
  helpEl = help;
  el.append(minimapSlot, groupBar, top, inventorySlot, selPanel, slotHost, zoomBar, menu, view, help, clusterHelp);
  ui.appendChild(el);
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  root = el;
  return true;
}

function unmount(): void {
  document.removeEventListener("fullscreenchange", syncFullscreenButton);
  fsBtn = null;
  releaseView?.();
  releaseView = null;
  padArrows = [];
  root?.remove();
  root = null;
  slotHost = null;
  minimapSlot = null;
  groupBar = null;
  portraitSlot = null;
  inventorySlot = null;
  groupItems.clear();
  plusItem = null;
  currentKey = null;
  clearSelBtn = null;
  followBtn = null;
  goldEl = null;
  lumberEl = null;
  foodEl = null;
  selPanel = null;
  selName = null;
  hpFill = null;
  mpFill = null;
  selProgress = null;
  selProgressFill = null;
  queueRow = null;
  queueSig = "";
  cargoRow = null;
  cargoSig = "";
  selDesc = null;
  pickRow = null;
  pickSig = "";
  hpRow = null;
  attackBtn = null;
  slots = [];
  slotTexts = [];
  slotLearns = [];
  slotAutos = [];
  slotCds = [];
  clusterInfoBtn = null;
  clusterHelpEl = null;
  clusterHelpList = null;
  clusterHelpOpen = false;
  enterHost = null;
  enterItems.clear();
  buildHost = null;
  buildEls = [];
  buildTexts = [];
  buildPlus = [];
  buildCards = [];
  arcIds = [];
  ringRadius = 0;
  if (helpKeys) {
    window.removeEventListener("keydown", helpKeys, true);
    helpKeys = null;
  }
  helpEl = null;
  helpPanel = null;
  helpBtn = null;
  helpSearch = null;
  helpBody = null;
  helpDetail = null;
  helpDetailName = null;
  helpDetailText = null;
  helpTabs = [];
  helpCatalogData = null;
  helpSelected = "";
}

function chip(kind: "gold" | "lumber" | "food"): HTMLElement {
  const el = document.createElement("span");
  el.className = `ghud-res ghud-res--${kind}`;
  el.dataset.kind = kind;
  return el;
}

/** 资源小块的头像：有安装资源就画 ToolTip 的金币 / 木材 / 人口图标，缺资源才退回色点。
 *  10 Hz 轮询，所以只在图换了的时候碰样式。 */
function paintResIcon(el: HTMLElement | null, url: string | null): void {
  if (!el) return;
  const key = url ?? "";
  if (el.dataset.icon === key) return;
  el.dataset.icon = key;
  el.classList.toggle("has-icon", !!url);
  if (url) el.style.setProperty("--ghud-res-icon", `url("${url}")`);
  else el.style.removeProperty("--ghud-res-icon");
}

function bar(kind: "hp" | "mp"): { el: HTMLElement; fill: HTMLElement } {
  const el = document.createElement("div");
  el.className = `ghud-bar ghud-bar--${kind}`;
  const fill = document.createElement("i");
  el.appendChild(fill);
  return { el, fill };
}

/** 右下动作簇的「说明」钮：挂在簇上方，点开当前单位的物品 / 技能说明。 */
function buildClusterTools(): HTMLDivElement {
  if (slotHost) {
    const utils = document.createElement("div");
    utils.className = "ghud-utils";
    const info = groupBarButton("ghud-utils__btn ghud-utils__info", t("help.CLUSTER_TITLE"));
    info.setAttribute("aria-pressed", "false");
    info.appendChild(lucideIcon(CircleHelp, { "stroke-width": 2.2, "aria-hidden": "true" }));
    info.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setClusterHelpOpen(!clusterHelpOpen);
    });
    clusterInfoBtn = info;
    utils.append(info);
    slotHost.appendChild(utils);
  }
  clusterHelpEl = buildClusterHelpPanel();
  return clusterHelpEl;
}

function setClusterHelpOpen(on: boolean): void {
  clusterHelpOpen = on;
  if (on) renderClusterHelp();
  if (clusterHelpEl) clusterHelpEl.hidden = !on;
  clusterInfoBtn?.classList.toggle("on", on);
  clusterInfoBtn?.setAttribute("aria-pressed", String(on));
}

/** 面板里的一行：名字 + 正文 + 图标，外加一行价钱 / 魔法值。内容来自命令卡与物品栏。 */
interface ClusterEntry {
  name: string;
  text: string;
  icon: string;
  /** 金币 / 木材 / 人口 / 魔法，只列非零项；物品栏里的东西没有。 */
  meta?: string;
}

/** 命令卡上一个按钮属于说明面板的哪一节。基本公共命令（移动 / 攻击 / 停止 / 巡逻 /
 *  取消 / 集结点 / 建造入口 / 上载具）不返回任何节，它们没什么可介绍的。 */
type ClusterSection = "skills" | "buildings" | "units" | "upgrades" | "items";

function clusterSectionOf(id: string, passive: boolean): ClusterSection | null {
  // 被动技能在卡上叫 `noop`（按下去没动作），但它仍然是技能，正文照样值得读。
  if (passive) return "skills";
  if (id.startsWith("ability:") || id.startsWith("neutral:") || id.startsWith("autocast:")
    || id.startsWith("learn:")) return "skills";
  if (id.startsWith("build:")) return "buildings";
  if (id.startsWith("train:") || id.startsWith("revive:")) return "units";
  if (id.startsWith("research:") || id.startsWith("upgrade:")) return "upgrades";
  if (id.startsWith("buy:")) return "items";
  return null;
}

/** 一行数值：金币 / 木材 / 人口 / 魔法，只列非零项。命令卡把这些画成图标，正文里读不到，
 *  所以说明面板自己拼出来。 */
function clusterCostText(b: GestureCardButton): string {
  const parts: string[] = [];
  if ((b.gold ?? 0) > 0) parts.push(t("help.COST_GOLD", { n: b.gold ?? 0 }));
  if ((b.lumber ?? 0) > 0) parts.push(t("help.COST_LUMBER", { n: b.lumber ?? 0 }));
  if ((b.food ?? 0) > 0) parts.push(t("help.COST_FOOD", { n: b.food ?? 0 }));
  if ((b.mana ?? 0) > 0) parts.push(t("help.COST_MANA", { n: b.mana ?? 0 }));
  return parts.join(" · ");
}

/** 说明面板按当前选择现算：右半边命令卡与手势半弧上的技能、建筑、单位、升级，
 *  加上物品栏与商店在售的物品。移动 / 攻击 / 停止这些公共命令先被 `clusterSectionOf`
 *  挡掉——玩家要读的是「这件东西是干什么的」。 */
function renderClusterHelp(): void {
  const host = currentGestureHost();
  const list = clusterHelpList;
  if (!host || !list) return;
  list.replaceChildren();

  const catalog = host.helpCatalog?.();
  const abilityText = new Map((catalog?.abilities ?? []).map((e) => [e.id, e.text]));

  const groups: Record<Exclude<ClusterSection, "items">, ClusterEntry[]> = {
    skills: [], buildings: [], units: [], upgrades: [],
  };
  const items: ClusterEntry[] = [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  // 建造页与英雄学习页的按钮可能还没进页面（手势 HUD 把它们排在半弧上），一并读。
  const buttons = [
    ...host.card(),
    ...(host.buildCard?.() ?? []),
    ...(host.learnCard?.() ?? []),
  ];
  for (const b of buttons) {
    // 被动技能在卡上都叫 `noop`，不能按 id 去重，否则只剩第一个。
    if (b.id !== "noop") {
      if (seenIds.has(b.id)) continue;
      seenIds.add(b.id);
    }
    const section = clusterSectionOf(b.id, b.passive === true);
    if (!section) continue;
    const code = b.id.slice(b.id.indexOf(":") + 1);
    const name = b.name || code;
    if (seenNames.has(name)) continue;
    seenNames.add(name);
    const entry: ClusterEntry = {
      name,
      icon: b.icon ?? "",
      // 按钮自己的说明优先：它带着地图写进正文的「Requires: …」条件行；图鉴只在正文为空时兜底。
      text: b.desc || (section === "skills" ? abilityText.get(code) : "") || "",
      meta: clusterCostText(b),
    };
    if (section === "items") items.push(entry);
    else groups[section].push(entry);
  }

  // 物品栏里的东西不经过命令卡，直接从当前选择读。
  for (const s of host.status?.()?.selection?.items ?? []) {
    if (seenNames.has(s.name)) continue;
    seenNames.add(s.name);
    items.push({ name: s.name, icon: s.icon, text: s.desc });
  }

  appendClusterSection(list, t("help.CLUSTER_SKILLS"), groups.skills);
  appendClusterSection(list, t("help.CLUSTER_BUILDINGS"), groups.buildings);
  appendClusterSection(list, t("help.CLUSTER_UNITS"), groups.units);
  appendClusterSection(list, t("help.CLUSTER_UPGRADES"), groups.upgrades);
  appendClusterSection(list, t("help.CLUSTER_ITEMS"), items);
  if (!groups.skills.length && !groups.buildings.length && !groups.units.length
    && !groups.upgrades.length && !items.length) {
    const empty = document.createElement("div");
    empty.className = "ghud-cluster-help__empty";
    empty.textContent = t("help.CLUSTER_EMPTY");
    list.appendChild(empty);
  }
}

function appendClusterSection(list: HTMLElement, title: string, entries: ClusterEntry[]): void {
  if (!entries.length) return;
  const head = document.createElement("div");
  head.className = "ghud-cluster-help__section";
  head.textContent = title;
  list.appendChild(head);
  for (const e of entries) {
    const row = document.createElement("div");
    row.className = "ghud-cluster-help__row";
    const icon = document.createElement("span");
    icon.className = "ghud-help__ctrl-icon";
    if (e.icon) {
      icon.style.backgroundImage = `url("${e.icon}")`;
      icon.style.backgroundSize = "cover";
    } else {
      icon.textContent = e.name.slice(0, 2).toUpperCase();
    }
    const name = document.createElement("div");
    name.className = "ghud-help__ctrl-name";
    name.textContent = e.name;
    const meta = document.createElement("div");
    meta.className = "ghud-help__ctrl-meta";
    meta.textContent = e.meta ?? "";
    meta.hidden = !e.meta;
    const text = document.createElement("div");
    text.className = "ghud-help__ctrl-text";
    const body = wc3StripMarkup(e.text).trim();
    text.textContent = body || t("help.NO_DETAIL");
    row.append(icon, name, meta, text);
    list.appendChild(row);
  }
}

/** 说明面板：标题 + 关闭，内容由 renderClusterHelp 在打开时现填。 */
function buildClusterHelpPanel(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "ghud-cluster-help";
  wrap.hidden = true;
  const head = document.createElement("div");
  head.className = "ghud-cluster-help__head";
  const title = document.createElement("div");
  title.className = "ghud-cluster-help__title";
  title.textContent = t("help.CLUSTER_TITLE");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ghud-help__close";
  close.setAttribute("aria-label", t("help.CLOSE"));
  close.textContent = "×";
  close.addEventListener("click", (e) => {
    e.preventDefault();
    setClusterHelpOpen(false);
  });
  head.append(title, close);
  const list = document.createElement("div");
  list.className = "ghud-cluster-help__list";
  clusterHelpList = list;
  wrap.append(head, list);
  return wrap;
}

/** 帮助面板：头部（标题 + ×）、五页标签、搜索框、可滚动内容、底部详情栏。 */
function buildHelpPanel(): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.id = "ghud-help";
  wrap.hidden = true;

  const panel = document.createElement("div");
  panel.className = "ghud-help__panel";
  panel.tabIndex = -1;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", t("help.TITLE"));
  helpPanel = panel;

  const head = document.createElement("div");
  head.className = "ghud-help__head";
  const title = document.createElement("b");
  title.className = "ghud-help__title";
  title.textContent = t("help.TITLE");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "ghud-help__close";
  close.textContent = "\u00d7";
  close.setAttribute("aria-label", t("help.CLOSE"));
  close.addEventListener("click", (e) => {
    e.preventDefault();
    closeHelp();
  });
  head.append(title, close);

  const tabRow = document.createElement("div");
  tabRow.className = "ghud-help__tabs";
  helpTabs = [];
  for (const [tab, key] of HELP_TABS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghud-help__tab";
    b.dataset.tab = tab;
    b.textContent = t(key);
    b.addEventListener("click", (e) => {
      e.preventDefault();
      if (helpTab === tab) return;
      helpTab = tab;
      helpSelected = "";
      renderHelp();
    });
    tabRow.appendChild(b);
    helpTabs.push(b);
  }

  helpSearch = document.createElement("input");
  helpSearch.type = "search";
  helpSearch.className = "ghud-help__search";
  helpSearch.placeholder = t("help.SEARCH");
  helpSearch.setAttribute("aria-label", t("help.SEARCH"));
  helpSearch.addEventListener("input", () => {
    helpQueries[helpTab] = helpSearch!.value;
    hideHelpDetail();
    renderHelpList();
  });

  helpBody = document.createElement("div");
  helpBody.className = "ghud-help__body";

  helpDetail = document.createElement("div");
  helpDetail.className = "ghud-help__detail";
  helpDetail.hidden = true;
  helpDetailName = document.createElement("b");
  helpDetailName.className = "ghud-help__detail-name";
  helpDetailText = document.createElement("p");
  helpDetailText.className = "ghud-help__detail-text";
  helpDetail.append(helpDetailName, helpDetailText);

  panel.append(head, tabRow, helpSearch, helpBody, helpDetail);
  wrap.appendChild(panel);
  // 点遮罩空白关闭；点面板时事件冒到 wrap，target 是面板内部节点，不误关。
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) closeHelp();
  });
  // 点空白处会把焦点从面板上拿走，之后按键就绕过了上面的监听；落指时先收回来。
  wrap.addEventListener("pointerdown", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, button")) return;
    helpPanel?.focus({ preventScroll: true });
  });
  return wrap;
}

function toggleHelp(): void {
  if (!helpEl) return;
  if (!helpEl.hidden) {
    closeHelp();
    return;
  }
  helpEl.hidden = false;
  helpBtn?.classList.add("on");
  helpBtn?.setAttribute("aria-pressed", "true");
  // 每次打开都重读图鉴：本局刷出来的单位和商店库存是会变的。
  helpCatalogData = currentGestureHost()?.helpCatalog?.() ?? null;
  helpSelected = "";
  renderHelp();
  // 焦点放进面板，方向键 / Tab 在面板里走。
  helpPanel?.focus({ preventScroll: true });
  // 打开期间按键不再给游戏：方向键会转镜头、字母键会施法。Escape 关面板。
  helpKeys = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeHelp();
      return;
    }
    e.stopPropagation();
  };
  window.addEventListener("keydown", helpKeys, true);
}

function closeHelp(): void {
  if (!helpEl || helpEl.hidden) return;
  helpEl.hidden = true;
  helpBtn?.classList.remove("on");
  helpBtn?.setAttribute("aria-pressed", "false");
  if (helpKeys) {
    window.removeEventListener("keydown", helpKeys, true);
    helpKeys = null;
  }
}

function renderHelp(): void {
  for (const b of helpTabs) b.classList.toggle("on", b.dataset.tab === helpTab);
  if (helpSearch) {
    const catalogTab = helpTab !== "controls";
    helpSearch.hidden = !catalogTab;
    if (catalogTab) helpSearch.value = helpQueries[helpTab];
  }
  hideHelpDetail();
  renderHelpList();
}

function renderHelpList(): void {
  if (!helpBody) return;
  helpBody.replaceChildren();
  if (helpTab === "controls") {
    const list = document.createElement("div");
    list.className = "ghud-help__ctrls";
    for (const [glyph, nameKey, textKey] of HELP_CONTROLS) {
      const row = document.createElement("div");
      row.className = "ghud-help__ctrl";
      const mark = document.createElement("span");
      mark.className = "ghud-help__ctrl-icon";
      mark.appendChild(lucideIcon(glyph, { "stroke-width": 2, "aria-hidden": "true" }));
      const name = document.createElement("b");
      name.className = "ghud-help__ctrl-name";
      name.textContent = t(nameKey);
      const text = document.createElement("span");
      text.className = "ghud-help__ctrl-text";
      text.textContent = t(textKey);
      row.append(mark, name, text);
      list.appendChild(row);
    }
    helpBody.appendChild(list);
    return;
  }

  const query = helpQueries[helpTab].trim().toLowerCase();
  const entries = helpEntries().filter((entry) => !query
    || entry.name.toLowerCase().includes(query)
    || entry.id.toLowerCase().includes(query));
  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ghud-help__empty";
    empty.textContent = t("help.EMPTY");
    helpBody.appendChild(empty);
    return;
  }
  const grid = document.createElement("div");
  grid.className = "ghud-help__grid";
  for (const entry of entries) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "ghud-help__card";
    card.dataset.id = entry.id;
    card.title = entry.name;
    card.classList.toggle("on", entry.id === helpSelected);
    const icon = document.createElement("span");
    icon.className = "ghud-help__icon";
    if (entry.icon) icon.style.backgroundImage = `url("${entry.icon}")`;
    else icon.textContent = entry.name.slice(0, 2).toUpperCase();
    const name = document.createElement("span");
    name.className = "ghud-help__name";
    name.textContent = entry.name;
    card.append(icon, name);
    card.addEventListener("click", (e) => {
      e.preventDefault();
      showHelpDetail(entry);
    });
    grid.appendChild(card);
  }
  helpBody.appendChild(grid);
}

function helpEntries(): HelpEntry[] {
  const cat = helpCatalogData;
  if (!cat) return [];
  if (helpTab === "units") return cat.units;
  if (helpTab === "buildings") return cat.buildings;
  if (helpTab === "items") return cat.items;
  if (helpTab === "abilities") return cat.abilities;
  return [];
}

function showHelpDetail(entry: HelpEntry): void {
  if (!helpDetail || !helpDetailName || !helpDetailText) return;
  helpSelected = entry.id;
  helpDetailName.textContent = entry.name;
  // 说明书里的 |cff… / |r / |n 在这里剥成纯文本：这里是正文段落，不需要颜色。
  helpDetailText.textContent = entry.text.trim()
    ? wc3StripMarkup(entry.text).trim()
    : t("help.NO_DETAIL");
  helpDetail.hidden = false;
  for (const card of helpBody?.querySelectorAll<HTMLElement>(".ghud-help__card") ?? []) {
    card.classList.toggle("on", card.dataset.id === entry.id);
  }
}

function hideHelpDetail(): void {
  helpSelected = "";
  if (helpDetail) helpDetail.hidden = true;
}

function groupBarButton(className: string, label: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.title = label;
  b.setAttribute("aria-label", label);
  return b;
}

/** 全屏状态变了：换图标与无障碍文案（进入 ↔ 退出）。 */
function syncFullscreenButton(): void {
  if (!fsBtn) return;
  const on = fullscreenActive();
  const label = t(on ? "hud.exitFullscreen" : "hud.fullscreen");
  fsBtn.title = label;
  fsBtn.setAttribute("aria-label", label);
  fsBtn.replaceChildren(lucideIcon(on ? Minimize : Maximize, { "stroke-width": 2.2, "aria-hidden": "true" }));
}

function createPlusItem(): { wrap: HTMLDivElement; btn: HTMLButtonElement } {
  const wrap = document.createElement("div");
  wrap.className = "ghud-gitem";
  const btn = groupBarButton("ghud-gplus", t("gesture.NEW_GROUP"));
  btn.appendChild(lucideIcon(Plus, { "stroke-width": 2.5, "aria-hidden": "true" }));
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
 * 编队条（小地图正下方的一排）：
 *   图标常驻可见，一眼看到每一队；点是直接选中该队；
 *   选中的那一组右上角浮出红色垃圾桶，点它清空该队；
 *   末尾的加号点一次就把当前选择编成新队 —— 没有「点进去再展开」的中间态。
 * 图标是首单位的命令卡原图（缺图时退回彩色队旗），人数是角标。
 */
function syncGroups(host: GestureMatchHost): void {
  if (!groupBar) return;
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
      clear.appendChild(lucideIcon(Trash2, { "stroke-width": 2.5, "aria-hidden": "true" }));
      clear.hidden = true;
      clear.addEventListener("click", (e) => {
        e.preventDefault();
        currentGestureHost()?.clearGroup?.(g.key);
        currentKey = null;
        syncGestureHud();
      });
      wrap.append(btn, clear);
      groupBar.insertBefore(wrap, plusItem?.wrap ?? null);
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
}

function tapGroup(key: number): void {
  const host = currentGestureHost();
  if (!host) return;
  // 点到编队就**同时把镜头带过去**（经典界面的「双击编队」效果）。手机上没法双击，
  // 所以单击即居中：`jump=true` 会在选中后调用 jumpToSelection。
  host.group("recall", key, true);
  currentKey = key;
  syncGestureHud();
}

/** 右侧半弧上的一个「进入下一页」按钮：换卡时复用，id 消失时由 syncGestureHud 摘掉。 */
function syncEnterItem(button: GestureCardButton): void {
  if (!enterHost) return;
  let el = enterItems.get(button.id);
  if (!el) {
    el = document.createElement("button");
    el.type = "button";
    el.className = "ghud-eslot";
    el.dataset.cmd = button.id;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      pressEnter(button.id);
    });
    enterHost.appendChild(el);
    enterItems.set(button.id, el);
  }
  el.title = button.name ?? "";
  el.setAttribute("aria-label", button.name ?? "");
  el.style.backgroundImage = button.icon ? `url("${button.icon}")` : "";
  el.classList.toggle("off", !!button.disabled);
}

/** 右侧半弧：进入型按钮沿 −72°…72° 均布，半径在命令环外一圈。 */
function layoutEnterArc(): void {
  if (!enterHost) return;
  const list = [...enterItems.values()];
  enterHost.hidden = list.length === 0;
  if (!list.length) return;
  const radius = ringRadius + 44;
  const start = -72;
  const end = 72;
  for (let i = 0; i < list.length; i++) {
    const deg = list.length === 1 ? 0 : start + ((end - start) * i) / (list.length - 1);
    const a = (deg * Math.PI) / 180;
    list[i].style.left = `calc(50% + ${(Math.cos(a) * radius).toFixed(1)}px)`;
    list[i].style.top = `calc(50% + ${(Math.sin(a) * radius).toFixed(1)}px)`;
  }
}

/** 点进入型按钮和点命令卡是同一条路（`runCommand`），只是不经过径向意图。 */
function pressEnter(id: string): void {
  const host = currentGestureHost();
  if (!host?.canAct()) return;
  host.press(id);
  syncGestureHud();
}

/** 左侧外圈半弧：工人的建筑列表（来自建造页，不要那个「点进去」的入口）。
 *  正在建造页上时（键盘 B 打开），环里已经摆着这些按钮，半弧收起来，免得看两遍。 */
function syncBuildArc(list: readonly GestureCardButton[]): void {
  if (!buildHost) return;
  buildCards = list;
  buildHost.hidden = list.length === 0;
  if (list.length > 0) {
    const ids = new Set(list.map((c) => c.id));
    // 座位上还剩旧图标 → 沿用这些座位（学掉的那格留空）；一个都不剩 → 换人了，整排重排。
    const kept = arcIds.some((id) => id !== null && ids.has(id));
    if (!kept) arcIds = [];
    const seated = new Set(arcIds);
    for (const card of list) if (!seated.has(card.id)) arcIds.push(card.id);
    arcIds = arcIds.map((id) => (id === null || ids.has(id) ? id : null));
    while (arcIds.length > 0 && arcIds[arcIds.length - 1] === null) arcIds.pop();
  }
  while (buildEls.length < arcIds.length) {
    const slot = buildEls.length;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghud-slot ghud-bslot";
    b.tabIndex = -1;
    b.addEventListener("click", (e) => {
      e.preventDefault();
      pressBuild(slot);
    });
    const label = document.createElement("i");
    label.className = "ghud-slot__text";
    const plus = document.createElement("b");
    plus.className = "ghud-learn";
    plus.textContent = "+";
    plus.hidden = true;
    plus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pressBuild(slot);
    });
    b.append(label, plus);
    buildHost.appendChild(b);
    buildEls.push(b);
    buildTexts.push(label);
    buildPlus.push(plus);
  }
  const byId = new Map(list.map((c) => [c.id, c]));
  arcIds.forEach((id, i) => {
    const el = buildEls[i];
    const text = buildTexts[i];
    const plus = buildPlus[i];
    const card = id ? byId.get(id) : undefined;
    if (!card) {
      el.hidden = true;
      el.style.backgroundImage = "";
      text.textContent = "";
      plus.hidden = true;
      return;
    }
    el.hidden = false;
    el.classList.toggle("off", card.disabled || !!card.passive);
    el.style.backgroundImage = card.icon ? `url("${card.icon}")` : "";
    text.textContent = card.icon ? "" : (card.hotkey ?? card.name ?? "").slice(0, 2).toUpperCase();
    // 学技能格：「+」是学这一门的入口；建筑格不画（建造直接点图标）。
    plus.hidden = !(card.id.startsWith("learn:") && !card.disabled);
  });
  for (let i = arcIds.length; i < buildEls.length; i++) buildEls[i].hidden = true;
  if (arcIds.length > 0) layoutBuildArc(arcIds.length);
}

/** 左半圆（148°…278°，屏幕坐标：左下 → 左 → 左上 → 顶）：**只有一圈**，不叠两道。
 *  起点不压到 96°：攻击钮圆心往下只剩约 126px，96° 那一端会被屏幕底边裁掉；终点越过
 *  正上方 8°，把弧拉长到 130°，11 个建筑也能保持 42px 左右（内环 38px）。
 *  横屏手机高度只有 393px，顶端那几格会顶进资源条，所以半径按「顶边不越过资源条底边」
 *  再收一次；竖屏手机/平板算出来比 200 大，半径保持 200。 */
function layoutBuildArc(count: number): void {
  if (!buildHost || count === 0) return;
  const start = 148;
  const end = 278;
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  const sizeAt = (r: number): number => {
    const chord = count > 1 ? 2 * r * Math.sin((step * Math.PI) / 360) : 54;
    return Math.min(54, Math.max(34, Math.round(chord - 3)));
  };
  // 面板锚在右下：圆心到窗口底边的距离 = 10px 边距 + 136px 方框半高 + 底部安全区。
  // 资源条占顶部安全区 + 8px 起、34px 高，再留 4px——顶端图标的**上边缘**不能越过它。
  const insets = touchDevice().safeInsets;
  const centerY = window.innerHeight - insets.bottom - 10 - 136;
  const ceiling = insets.top + 8 + 34 + 4;
  const maxRadius = (r: number): number => (centerY - ceiling - sizeAt(r) / 2) / 0.99;
  const outer = Math.max(ringRadius + 74, 200);
  const radius = Math.max(ringRadius + 40, Math.min(outer, maxRadius(Math.min(outer, maxRadius(outer)))));
  const size = sizeAt(radius);
  for (let i = 0; i < count; i++) {
    const a = ((start + step * i) * Math.PI) / 180;
    const el = buildEls[i];
    el.style.left = `calc(50% + ${(Math.cos(a) * radius).toFixed(1)}px)`;
    el.style.top = `calc(50% + ${(Math.sin(a) * radius).toFixed(1)}px)`;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
  }
}

function pressBuild(index: number): void {
  const host = currentGestureHost();
  const id = arcIds[index];
  const card = id ? buildCards.find((c) => c.id === id) : undefined;
  if (!host?.canAct() || !card || card.disabled || card.passive) return;
  host.press(card.id);
  syncGestureHud();
}

/** 把「建造 / 学技能」卡排进命令环的空槽，返回仍然摆不下的那几张。
 *  座位先按上一次的复位（学掉一门之后，剩下的图标不挪窝——与半弧的固定座位同一条规矩），
 *  再往剩下的空槽里补；「进入下一页」类按钮永远不占槽，所以它们的格子也算空槽。 */
function seatSideArc(
  card: readonly GestureCardButton[], sideArc: readonly GestureCardButton[],
): GestureCardButton[] {
  const next: (GestureCardButton | null)[] = new Array(CARD_SLOTS).fill(null);
  const free: number[] = [];
  for (let i = 0; i < CARD_SLOTS; i++) {
    const b = cardButtonForSlot(card, i);
    if (!b || b.submenu) free.push(i);
  }
  const freeSet = new Set(free);
  const placed = new Set<string>();
  for (const c of sideArc) {
    const was = seated.findIndex((s) => s?.id === c.id);
    if (was >= 0 && freeSet.has(was) && !next[was]) {
      next[was] = c;
      freeSet.delete(was);
      placed.add(c.id);
    }
  }
  const overflow: GestureCardButton[] = [];
  for (const c of sideArc) {
    if (placed.has(c.id)) continue;
    const at = free.find((i) => freeSet.has(i) && !next[i]);
    if (at === undefined) {
      overflow.push(c);
      continue;
    }
    next[at] = c;
    freeSet.delete(at);
  }
  seated = next;
  return overflow;
}

/** 12 槽沿圆环均布，0 在正上方，顺时针与命令卡 `row * 4 + col` 同序。 */
function layoutRing(): void {
  if (!slotHost) return;
  const radius = touchDevice().deviceClass === "tablet" ? 106 : 92;
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
  paintResIcon(goldEl, host.resourceIcon?.("gold") ?? null);
  paintResIcon(lumberEl, host.resourceIcon?.("lumber") ?? null);
  paintResIcon(foodEl, host.resourceIcon?.("supply") ?? null);

  const sel = status?.selection ?? null;
  const isItem = sel?.isItem === true;
  if (selPanel) selPanel.hidden = !sel;
  // 没有选中任何单位时，左上角的「取消选择」没有意义，整颗钮不画。
  if (clearSelBtn) clearSelBtn.hidden = !sel;
  // 自动跟随开着时：换了选择就把相机接到新目标上（先松开旧目标，再锁新的）。同一次选择
  // 被玩家拖动镜头松开之后，这里不会立刻接回去——只有再选了别的单位才重新跟。
  // 物品选择的 id 是负数占位（-2000-itemId），不是一个能跟随的单位，不能拿来锁镜头。
  const selId = sel && !isItem ? sel.id ?? null : null;
  if (selId !== autoFollowSel && (selId === null || host.canAct())) {
    autoFollowSel = selId;
    if (autoFollow) {
      if (host.cameraLocked?.()) host.toggleCameraLock?.();
      if (selId !== null) host.toggleCameraLock?.();
    }
  }
  // 跟随是「相机状态」而不是「这一次点击的状态」：玩家拖动镜头、目标阵亡都会把它关掉，
  // 所以每帧问一次宿主，按钮跟着亮灭。
  if (followBtn) {
    const locked = host.cameraLocked?.() ?? false;
    followBtn.setAttribute("aria-pressed", String(locked));
    followBtn.classList.toggle("on", locked);
  }
  // 没有选择就没有命令可下：整块命令簇（攻击钮 + 命令环 + 左右半弧）一起收起来。
  // 选中地上物品时同理——物品身上没有可施放的命令，环里只会有空位。
  // 物品栏另有一条规矩——选中了但单位根本不能带物品（农民、步兵），那六格也不画，
  // 与经典控制台用 ConsoleInventoryCover 盖掉是同一个判断。
  if (slotHost) slotHost.hidden = !sel || isItem;
  if (inventorySlot) inventorySlot.hidden = !sel || sel.hasInventory === false;
  if (sel && selName) {
    selName.textContent = sel.name;
    paintBar(hpFill, sel.hp, sel.maxHp);
    paintBar(mpFill, sel.mana, sel.maxMana);
    // 物品没有生命值 / 魔法值：两条都收起来，位置让给说明正文。
    if (hpRow) hpRow.hidden = isItem;
    // 没有魔法值就没有第二条：经典面板对这类单位也只画血条。
    if (mpRow) mpRow.hidden = isItem || !((sel.maxMana ?? 0) > 0);
  }
  // 正在干的活（训练 / 研究 / 主城升级）也有一条进度：建筑的队列就是它的「建造进度」，
  // 没有这一条时，升级主城只能看到血条，完全不知道还要多久。
  const busy = !!sel && (!!sel.underConstruction || (sel.queueLength ?? 0) > 0);
  if (selProgress) selProgress.hidden = !busy;
  if (busy && selProgressFill) {
    const frac = sel!.underConstruction ? sel!.buildProgress ?? 0 : sel!.trainProgress ?? 0;
    selProgressFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }
  // 舱内乘客：金矿里的精灵、飞艇 / 地洞里的单位。经典控制台用货舱面板放人出来，
  // 手势 HUD 没有那一块，所以在这里补一排小头像——点一个就把它放到载具脚下。
  const cargo = sel?.cargo ?? [];
  if (cargoRow) {
    cargoRow.hidden = cargo.length === 0;
    const sig = sel ? `${sel.id ?? 0}:${cargo.map((c) => c.simId).join(",")}` : "";
    if (sig !== cargoSig) {
      cargoSig = sig;
      cargoRow.replaceChildren();
      const hostId = sel?.id ?? 0;
      for (const c of cargo) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghud-cargo__slot";
        if (c.icon) b.style.backgroundImage = `url("${c.icon}")`;
        else b.textContent = c.name.slice(0, 2).toUpperCase();
        b.title = c.name;
        b.setAttribute("aria-label", c.name);
        b.addEventListener("click", (e) => {
          e.preventDefault();
          const h = currentGestureHost();
          if (!h?.canAct()) return;
          h.unloadCargo?.(hostId, c.simId);
          syncGestureHud();
        });
        cargoRow!.appendChild(b);
      }
    }
  }
  // 地上物品：名称下面先给说明正文，再给一排「附近谁能来捡」的头像。点一个头像就让
  // 那一个单位去捡（宿主的 `pickUpItem` 与右键点物品是同一条命令）。
  const itemDesc = isItem ? (sel!.description ?? "") : "";
  if (selDesc) {
    selDesc.hidden = !itemDesc;
    if (itemDesc) selDesc.textContent = wc3StripMarkup(itemDesc).trim();
  }
  const pickers = isItem ? sel!.pickers ?? [] : [];
  const pickItem = isItem ? sel!.itemId ?? 0 : 0;
  if (pickRow) {
    pickRow.hidden = pickers.length === 0;
    // 物品 id 也进签名：换了一件物品，哪怕来捡的人是同一批，闭包里抓的 itemId 也要换。
    const sig = `${pickItem}:${pickers.map((p) => p.simId).join(",")}`;
    if (sig !== pickSig) {
      pickSig = sig;
      pickRow.replaceChildren();
      for (const p of pickers) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghud-pick__face";
        if (p.icon) b.style.backgroundImage = `url("${p.icon}")`;
        else b.textContent = p.name.slice(0, 2).toUpperCase();
        b.title = p.name;
        b.setAttribute("aria-label", p.name);
        b.addEventListener("click", (e) => {
          e.preventDefault();
          const h = currentGestureHost();
          if (!h?.canAct()) return;
          h.pickUpItem?.(p.simId, pickItem);
          syncGestureHud();
        });
        pickRow.appendChild(b);
      }
    }
  }
  // 生产队列：一排可点的图标（训练单位 / 研究），顺序与经典命令卡上的队列一致。
  // 点哪一个就取消哪一个——`cancelqueue:<下标>` 与命令卡走同一条命令。
  const queue = sel?.queue ?? [];
  if (queueRow) {
    queueRow.hidden = queue.length === 0;
    const sig = sel ? `${sel.id}:${sel.queueOwned ? 1 : 0}:${queue.map((q) => q.name).join("\u0001")}` : "";
    if (sig !== queueSig) {
      queueSig = sig;
      queueRow.replaceChildren();
      const owned = !!sel?.queueOwned;
      const shown = queue.slice(0, QUEUE_SLOTS);
      const more = queue.length - shown.length;
      shown.forEach((q, idx) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghud-queue__slot";
        if (q.icon) b.style.backgroundImage = `url("${q.icon}")`;
        else b.textContent = q.name.slice(0, 2).toUpperCase();
        b.title = owned ? `${t("hud.cancel")}: ${q.name}` : q.name;
        b.setAttribute("aria-label", b.title);
        if (!owned) {
          b.disabled = true;
        } else {
          b.addEventListener("click", (e) => {
            e.preventDefault();
            const h = currentGestureHost();
            if (!h?.canAct()) return;
            h.press(`cancelqueue:${idx}`);
            syncGestureHud();
          });
        }
        if (more > 0 && idx === shown.length - 1) {
          const badge = document.createElement("b");
          badge.className = "ghud-queue__more";
          badge.textContent = `+${more}`;
          b.appendChild(badge);
        }
        queueRow!.appendChild(b);
      });
    }
  }

  const card = host.card();
  // 左侧半弧装的是这个单位的「另一页」：工人是建造列表，英雄是还没学的技能。页面仍停在
  // root 时也要拿到——这就是「不点进去」的那一步。已经站在那一页上时（键盘 B / 技能页），
  // 环里摆着同一批按钮，半弧收起来，免得看两遍。
  const builds = (host.buildCard?.() ?? []).filter((b) => b.id !== "cancel");
  const learns = host.learnCard?.() ?? [];
  const onBuildPage = card.some((b) => b.id.startsWith("build:"));
  const onLearnPage = card.some((b) => b.id.startsWith("learn:"));
  // 手势 HUD 只有一张卡：建造 / 学技能都排在左半弧上，卡片本身没有「进入下一页」的入口。
  // 页面若被键盘 B、上一版残留的状态或别的入口打开，这里直接退回 root——否则同一批
  // 建筑/技能会在环里再画一遍，手机上就成了「两个面板」。
  if ((onBuildPage || onLearnPage) && (builds.length > 0 || learns.length > 0)) {
    const now = performance.now();
    if (now - subpageCancelAt > 500) {
      subpageCancelAt = now;
      host.press("cancel");
    }
  }
  const sideArc = builds.length ? (onBuildPage ? [] : builds) : onLearnPage ? [] : learns;
  // 命令环上的空槽先给这批卡落座：环里摆得下的就不再画到外圈半弧上，
  // 摆不下的（槽位不够）才留在半弧——见 `seatSideArc`。
  const overflow = seatSideArc(card, sideArc);
  syncBuildArc(overflow);
  syncGroups(host);
  for (let i = 0; i < slots.length; i++) {
    const button = cardButtonForSlot(card, i);
    const el = slots[i];
    const learn = slotLearns[i];
    const auto = slotAutos[i];
    // 进入型按钮（建造 / 英雄技能 / 法术书）不在命令环里落座：挪到右侧外圈半弧。
    if (!button || button.submenu) {
      if (button?.submenu && !(sideArc.length > 0 && (button.id === "build" || button.id === "learnpage"))) syncEnterItem(button);
      const seat = seated[i];
      if (!seat) {
        el.hidden = true;
        el.classList.remove("can-learn", "has-auto", "auto-on");
        if (learn) learn.hidden = true;
        if (auto) auto.hidden = true;
        paintSlotCooldown(i, 0);
        continue;
      }
      // 空槽里的建造 / 学技能卡：与环上其他格子同一副壳，点了直接下令 / 学技能。
      el.hidden = false;
      el.classList.toggle("off", seat.disabled || !!seat.passive);
      el.style.backgroundImage = seat.icon ? `url("${seat.icon}")` : "";
      const label = slotTexts[i];
      if (label) label.textContent = seat.icon ? "" : (seat.hotkey ?? seat.name ?? "").slice(0, 2).toUpperCase();
      const canLearn = seat.id.startsWith("learn:") && !seat.disabled;
      if (learn) learn.hidden = !canLearn;
      el.classList.toggle("can-learn", canLearn);
      el.classList.remove("has-auto", "auto-on");
      if (auto) auto.hidden = true;
      // 建造 / 学技能卡没有冷却；清掉上一张卡留下的读数。
      paintSlotCooldown(i, 0);
      continue;
    }
    el.hidden = false;
    el.classList.toggle("off", button.disabled || !!button.passive);
    el.style.backgroundImage = button.icon ? `url("${button.icon}")` : "";
    const label = slotTexts[i];
    if (label) label.textContent = button.icon ? "" : (button.hotkey ?? button.name ?? "").slice(0, 2).toUpperCase();
    // 「+」只表示「这一级可以升」：root 卡上英雄技能还有技能点、等级也够（learnId）。
    // 学新技能是左半弧上的事，那些格子不再画加号——点了就是学，不用二次确认。
    const canLearn = !!button.learnId;
    if (learn) learn.hidden = !canLearn;
    el.classList.toggle("can-learn", canLearn);
    // 自动施法：只有卡面带 `altId`（能设自动）且此刻能用的技能才有这颗闪电；`modal` 是
    // 经典卡上同一个「自动正开着」的状态，所以开关的亮灭每帧跟着真实设置走。
    // 没研究出来的技能（Inner Fire 没有大师训练）在经典卡上本来就是灰的，给它一颗点了
    // 也不会亮的闪电只会让人以为坏了，所以一并收掉。
    const hasAuto = !!button.altId && !button.disabled;
    const autoOn = hasAuto && !!button.modal;
    el.classList.toggle("has-auto", hasAuto);
    // 自动开着时整颗技能图标外圈转两道金光（style.css 的 `.ghud-slot.auto-on::before`）。
    el.classList.toggle("auto-on", autoOn);
    if (auto) {
      auto.hidden = !hasAuto;
      auto.classList.toggle("on", autoOn);
    }
    paintSlotCooldown(i, button.cooldownLeft ?? 0, button.cooldownFrac ?? 0);
  }
  // 换选择 / 离开子页后，把已经不在卡面上的进入型按钮摘掉。
  const wanted = new Set(
    card
      .filter((c) => c.submenu && !(sideArc.length > 0 && (c.id === "build" || c.id === "learnpage")))
      .map((c) => c.id),
  );
  for (const [id, el] of [...enterItems]) {
    if (wanted.has(id)) continue;
    el.remove();
    enterItems.delete(id);
  }
  layoutEnterArc();

  const attack = card.find((c) => c.id === "attack") ?? card.find((c) => c.id === "move");
  if (attackBtn) {
    attackBtn.style.backgroundImage = attack?.icon ? `url("${attack.icon}")` : "";
    attackBtn.textContent = attack?.icon ? "" : t("gesture.ATTACK");
    attackBtn.classList.toggle("off", !attack || attack.disabled);
  }
  root.classList.toggle("armed", host.armed());
}

/** 环槽位冷却：`left` 秒时画顺时针的暗扇形与剩余整秒（WC3 向上取整，最后一下读 1）。
 *  读数节拍是 500ms，正好跟得上整秒变化；就绪时把遮罩清掉。 */
function paintSlotCooldown(index: number, left: number, frac = 0): void {
  const cd = slotCds[index];
  if (!cd) return;
  if (!(left > 0)) {
    if (!cd.hidden) {
      cd.hidden = true;
      cd.textContent = "";
    }
    return;
  }
  cd.hidden = false;
  const elapsed = Math.max(0, Math.min(1, 1 - frac)) * 360;
  cd.style.background = `conic-gradient(transparent 0deg ${elapsed}deg, rgba(0,0,0,0.62) ${elapsed}deg 360deg)`;
  const text = showCooldownNumbers() ? String(Math.ceil(left)) : "";
  if (cd.textContent !== text) cd.textContent = text;
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
  // 空槽里落座的建造 / 学技能卡：直接按那张卡下令（与点外圈半弧同一条 `press`）。
  if (!button || button.submenu) {
    const seat = seated[index];
    if (!seat || seat.disabled || seat.passive) return;
    host.press(seat.id);
    syncGestureHud();
    return;
  }
  if (button.disabled || button.passive) return;
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
