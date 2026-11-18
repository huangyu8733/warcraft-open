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
  /** 正在生效（自动施法 / 开关类）：镜像画成高亮，和 HUD 的 `armed` 一致。 */
  active?: boolean;
}

/** 手势 HUD（ui/gesture/hud.ts）要读的最小读数：资源、人口与当前选择。 */
export interface GestureStatus {
  gold: number;
  lumber: number;
  foodUsed: number;
  foodMax: number;
  selection: {
    name: string;
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
  } | null;
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
  /** 缩放档：+1 拉近一档，−1 拉远一档（7 档，夹到两端）。 */
  zoomBy(steps: number): void;
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
  /** 聊天行开关。 */
  toggleChat(): void;

  /** HUD / 命令卡 / 小地图上的触摸：合成一次真实点击（VirtualCursor）。 */
  clickAt(clientX: number, clientY: number, button?: 0 | 2): void;
  /** HUD 上的长按：悬停读数（tooltip）。 */
  hoverAt(clientX: number, clientY: number): void;
  /** 手势 HUD 的读数（资源 / 人口 / 当前选择）；没有 HUD 的宿主可以不实现。 */
  status?(): GestureStatus | null;
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
