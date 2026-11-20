// L2 宿主接口（方案 §7.1，仿 ui/gamepad.ts 的 `GamepadMatchHost`）。
//
// 窄接口：手势层只会通过这些门说话，而每一扇门都是鼠标 / 键盘已经在用的那一个
// （`runCommand` / `selectAt` / `selectBox` / `orderClickAt` / `moveAt` / 相机 `midPan`）。
// 所以手指给出的动作继承既有全部门控与回放录制，手势层自己**不发明任何 Command**（§7.4）。
//
// 坐标约定（§5.3）：`world` 区域的 x/y 是地图 canvas 的 CSS 像素（index.ts 已换算），
// `hud` / `card` / `minimap` / `console` 区域是 client 像素。

/** 手势层需要读到的最小命令卡形状（ui/hud.ts 的 CommandButton 结构上满足它）。 */
export interface GestureCardButton {
  id: string;
  disabled: boolean;
  /** 被动技能：显示但不吃按键（与 hud.ts 的 `passive` 同一判定）。 */
  passive?: boolean;
  /** 轮盘槽位 = `row * 4 + col`（与 data/hotkeys.ts 的 Grid 12 槽同形）。 */
  col?: number;
  row?: number;
  /** 槽位角标；没有时轮盘显示槽位序号。 */
  hotkey?: string;
  /** 图标（HUD 已解析好的 data URL）。镜像只读它，不自己解析资源（§9.2）。 */
  icon?: string | null;
  /** 按钮标题；图标缺失时镜像用它的前四个字符兜底。 */
  name?: string;
  /** 按钮的说明正文（WC3 富文本原样）。「说明」面板优先用它，图鉴里没有时兜底。 */
  desc?: string;
  /** 价钱与魔法消耗。「说明」面板把它们单独列一行——命令卡上的数字是画成图标的，
   *  正文里没有。只读，缺省按 0。 */
  gold?: number;
  lumber?: number;
  food?: number;
  mana?: number;
  /** 技能冷却剩余秒数（0/缺省 = 就绪）。与经典命令卡读同一份 `CommandButton`。 */
  cooldownLeft?: number;
  /** 冷却剩余比例 0..1：手势 HUD 用它画径向暗扇形。 */
  cooldownFrac?: number;
  /** 法力不够这一级（与经典命令卡同一个 `noMana`，按这一级技能的法力消耗算）。
   *  手势 HUD 把整格转成灰阶——手机上比经典卡那层深蓝洗更直白；按下去仍然有效，
   *  会照常听到「法力不足」。 */
  noMana?: boolean;
  /** 正在生效（自动施法 / 开关类）：镜像画成高亮，和 HUD 的 `armed` 一致。 */
  active?: boolean;
  /** 点下去只是翻到下一张卡（建造页 / 英雄技能页 / 法术书页），不是立刻下令。
   *  手势 HUD 把它们从 12 槽命令环里拿出来，排到攻击钮右侧的独立半弧上。 */
  submenu?: boolean;
  /** 英雄还能把这个技能升一级时给出的 ability id：图标角上画「+」，点它直接
   *  `learn:<id>`，不必先进技能页。 */
  learnId?: string;
  /** 能设自动施法的技能才有这一条：`autocast:<code>`，与经典命令卡上「右键」跑的是同一条
   *  命令。手势 HUD 在图标右上角画一颗小闪电，点它翻开关，不占环上的施法格。 */
  altId?: string;
  /** 自动施法正开着（经典卡上的闪光同一份状态）。只有带 `altId` 的按钮会读它。 */
  modal?: boolean;
}

/** 手势 HUD（ui/gesture/hud.ts）要读的最小读数：资源、人口与当前选择。 */
export interface GestureStatus {
  gold: number;
  lumber: number;
  foodUsed: number;
  foodMax: number;
  selection: {
    /** 选中的单位 / 建筑 sim id：手势 HUD 卸客（金矿里的精灵、飞艇里的乘客）要带上它。 */
    id?: number;
    name: string;
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
    /** 舱内乘客：金矿里的工人、飞艇 / 地洞里的单位。点一下就把那一个放到载具脚下，
     *  手机上没有经典控制台的货舱面板，这是「进去以后怎么出来」的唯一出口。 */
    cargo?: Array<{ simId: number; icon: string; name: string }>;
    cargoSlots?: number;
    /** 建筑队列：正在训练 / 研究 / 升级的那一条。手势面板用它画进度条和队列图标。 */
    underConstruction?: boolean;
    buildProgress?: number;
    trainProgress?: number;
    queueLength?: number;
    queueOwned?: boolean;
    /** 生产队列，队首在前：一排可点的图标，点哪一个就取消哪一个。 */
    queue?: Array<{ icon: string; name: string }>;
    /** 这个选择有没有物品栏（英雄 / 带背包的单位）。没有——比如农民、步兵——手势 HUD
     *  连那六格都不画，跟经典控制台用 ConsoleInventoryCover 盖住是同一个意思。 */
    hasInventory?: boolean;
    /** 物品栏里每件东西的名字与说明（已解析好图标的 data URL）。手势 HUD 的「说明」
     *  面板用它介绍右下角的物品，不另开一条读取通道。 */
    items?: Array<{ name: string; desc: string; icon: string }>;
    /** 选中的是地上的物品：面板改画名称 + 说明，不画血蓝条。 */
    isItem?: boolean;
    /** 物品说明正文（WC3 富文本），`isItem` 时才有意义。 */
    description?: string;
    /** 地上物品的 sim id（`pickUpItem` 拿它下令）；物品选择的 `id` 是负数占位，不能用。 */
    itemId?: number;
    /** 附近能来拾取的己方单位，由近到远：一排可点的头像，点谁就谁去捡。 */
    pickers?: Array<{ simId: number; name: string; icon: string }>;
  } | null;
}

/** 手势帮助面板的一条图鉴条目：单位 / 建筑 / 技能 / 物品共用同一副形状。 */
export interface HelpEntry {
  id: string;
  name: string;
  /** 已解析成可加载 URL 的图标；拿不到时是空串（HUD 用名称首字兜底）。 */
  icon: string;
  /** 说明正文，WC3 富文本原样交给 HUD 去标记。 */
  text: string;
}

/** 本图能出现的图鉴，对应面板的四个目录页。 */
export interface HelpCatalog {
  units: HelpEntry[];
  buildings: HelpEntry[];
  abilities: HelpEntry[];
  items: HelpEntry[];
}

export interface GestureMatchHost {
  /** 与鼠标同一条门控：HUD 接受输入、未硬暂停、玩家在操作、无模态、未在输入框。 */
  canAct(): boolean;
  /** 过场中（`ShowInterface(false)`）：只放行「跳过过场」。 */
  isCinematic(): boolean;
  /**
   * 跳过过场，与 ESC / 语音的同一条路：地图自己的 `EVENT_PLAYER_END_CINEMATIC` 要有人听，
   * 否则不盖黑场；触发器还没 Enable 时排队（`cinematicSkipPending`）。返回是否接下了。
   */
  skipCinematic(): boolean;

  /** 命令卡按钮按下（`runCommand`）。 */
  press(id: string): void;
  /** 实时命令卡（P3 轮盘读它；与 hud.ts 同一份数据）。 */
  card(): readonly GestureCardButton[];
  /** 资源条上的图标（金币 / 木材 / 人口），安装目录里的 ToolTip 贴图；缺资源时返回 null，
   *  手势 HUD 就退回原来的色点。 */
  resourceIcon?(kind: "gold" | "lumber" | "supply"): string | null;
  /**
   * 工人的建造列表（建造页的卡面内容），**不必先进入建造页**：手势 HUD 把它直接排在
   * 攻击钮左侧的外圈半弧上，省掉「先点建造、再点建筑」的那一下。非工人 / 不可操作时为空。
   */
  buildCard?(): readonly GestureCardButton[];
  /** 学技能页里**还没学**的技能（英雄）：和建造共用攻击钮左侧那条半弧，英雄于是只有
   *  一个面板——环里是能按的技能（可升级的那几格角上带「+」），半弧上是还没学的。 */
  learnCard?(): readonly GestureCardButton[];
  /** 是否正在瞄准：armed 施法 / 建造放置。下一次轻点必须落地，而不是重新选中。 */
  armed(): boolean;

  selectAt(x: number, y: number, mods?: { additive?: boolean; sameType?: boolean }): void;
  selectBox(x0: number, y0: number, x1: number, y1: number, additive: boolean): void;
  /** 落地一次左键：建造放置 / armed 施法；否则什么都不做。 */
  orderAt(x: number, y: number, queued: boolean): void;
  /** 落地一次右键：取消放置或瞄准；否则智能命令（`moveAt`）。 */
  smartAt(x: number, y: number, queued: boolean): void;

  /** 相机平移，单位是屏幕 CSS 像素（与中键拖拽同一套换算）。 */
  panBy(dx: number, dy: number): void;
  /**
   * 按住即持续的视角键（`up/down/left/right` 平移，`rotateLeft/rotateRight` 旋转）。
   * 直接驱动相机已有的「按住方向键 / Insert·Delete」状态，逐帧速度、边缘限制、解除
   * Ctrl+C 锁定都沿用原有逻辑，手势层不新增任何一个帧循环。
   */
  viewKey?(key: "up" | "down" | "left" | "right" | "rotateLeft" | "rotateRight", on: boolean): void;
  /**
   * 当前选择能不能吃移动命令：己方、活着、走得动的单位（建筑 / 金矿 / 敌人 / 物品
   * 都不算）。手势 HUD 的八方向盘据此分流：能移动 → 方向盘下令，否则 → 平移镜头。
   */
  selectionMovable?(): boolean;
  /**
   * 把当前选择朝屏幕方向走一步。`dx`/`dy` 是屏幕单位向量（x 向右、y 向下），
   * 与右键 `moveAt` 同一条命令通道（不是新的 Command）。
   */
  moveSelectionDir?(dx: number, dy: number): void;
  /**
   * 框选进行中（触摸没有鼠标的 hover 反馈）：画出选框，并给框里的单位打预览圈，
   * 松手前就能看清这一块里会被选中谁。坐标是 canvas CSS 像素。
   */
  boxPreview?(x0: number, y0: number, x1: number, y1: number): void;
  /** 这一次框选结束 / 作废：收掉选框与预览圈。 */
  boxPreviewEnd?(): void;
  /** 清空选择（手机没有 ESC、也不方便点空地）：走 `rts.clearSelection`，与脚本
   *  `ClearSelection` / 语音同一条路。 */
  clearSelection?(): void;
  /** 把舱内一名乘客放到载具 / 金矿脚下（经典控制台点货舱格子的同一条通道）。 */
  unloadCargo?(hostId: number, passengerId: number): boolean;
  /** 让指定单位去拾取一件地上的物品——手势 HUD 左下面板里的头像，与右键点物品是同一条
   *  `getitem` 命令。返回是否接下了。 */
  pickUpItem?(unitId: number, itemId: number): boolean;
  /** 缩放档：+1 拉近一档，−1 拉远一档（7 档，夹到两端）。 */
  zoomBy(steps: number): void;
  /** 斜视 / 俯视切换：只改镜头俯仰，不动缩放、朝向和位置。 */
  toggleView?(): void;
  /** 镜头跟随（与 Ctrl+C 同一个开关）：开 → 锁住当前选中的己方单位，再点一下松开。
   *  返回这次点击之后「是否亮着」。 */
  toggleCameraLock?(): boolean;
  /** 跟随是否还亮着：玩家自己拖动镜头、目标阵亡都会自动松开，HUD 靠这个每帧回读。 */
  cameraLocked?(): boolean;
  /**
   * 编队条：轻点召回、长按设编队、双指追加（§6.1）。`jump` 只在双击召回时给，
   * 与键盘 `N` / `NN` 同一条 `recallGroup` + `jumpToSelection` 通道。
   */
  group(op: "assign" | "append" | "recall", n: number, jump?: boolean): void;

  /** 现有编队（键 0-9 中非空的）：人数与首单位的命令卡图标（缺图时为空串）。 */
  groups?(): { key: number; count: number; icon: string }[];

  /** 清空某一队（与语音「取消第 N 队」同一条 `rts.clearGroup`）。 */
  clearGroup?(n: number): void;

  /** 相机跳到当前选择（F1 / 双击编队）。 */
  focusSelection(): void;

  /** 双指轻点：取消放置 / 解除瞄准（Escape 的同义）。 */
  cancel(): void;
  /** 三指轻点：F10 菜单。 */
  toggleMenu(): void;
  /** 任务说明（F9 的任务日志）。手势模式藏起了整条经典控制台，那颗 Quests 钮也跟着没了，
   *  自定义地图与战役的目标 / 提示就没有别的入口——所以单独开一扇门，走的是和 F9 同一条
   *  `togglePanel("quests")`。 */
  toggleQuests?(): void;
  /** 这张图有没有（启用的）任务：没有就置灰那颗钮，与经典控制台 Quests 钮为同一事实
   *  （Blizzard.j 的 melee 初始化不建任务，F9 在 melee 图上也打不开）。 */
  questsAvailable?(): boolean;
  /** 聊天行开关。 */
  toggleChat(): void;

  /** HUD / 命令卡 / 小地图上的触摸：合成一次真实点击（VirtualCursor）。 */
  clickAt(clientX: number, clientY: number, button?: 0 | 2): void;
  /** HUD 上的长按：悬停读数（tooltip）。 */
  hoverAt(clientX: number, clientY: number): void;
  /** 手势 HUD 的读数（资源 / 人口 / 当前选择）；没有 HUD 的宿主可以不实现。 */
  status?(): GestureStatus | null;
  /** 本图能出现的单位 / 建筑 / 技能 / 物品（帮助面板的图鉴页）。 */
  helpCatalog?(): HelpCatalog;
}

let host: GestureMatchHost | null = null;
const listeners = new Set<() => void>();

/**
 * 宿主装上 / 卸下时通知 L3（控制台只在有对局时才该出现）。与 `setGestureHost` 同一次
 * 调用、同一时刻，不引入任何轮询。
 */
export function onGestureHostChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 装上（或传 null 卸下）这一局的宿主。与 `setGamepadHost` 同一生命周期。 */
export function setGestureHost(h: GestureMatchHost | null): void {
  if (host === h) return;
  host = h;
  for (const fn of listeners) fn();
}

/** 当前宿主；没有对局时为 null（识别器照常跑，只是没有动作可派发）。 */
export function currentGestureHost(): GestureMatchHost | null {
  return host;
}
