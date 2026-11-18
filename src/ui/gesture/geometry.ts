// L1 坐标层（方案 §5.3 / P7）：热区矩形只在这里量，也只在这里缓存。
//
// 规矩：
//  · 一律 `getBoundingClientRect()`，不手算 `#ui` 的 transform 与 `--hud-scale`；
//  · 不每帧读 layout —— 只在 refresh / invalidate 之后重算一次；
//  · 世界交互要的是 canvas CSS 像素，不是 client 像素，也不是 dpr 回乘（rts.ts 自己处理）。

import { touchDevice } from "./device";
import type { GestureArea } from "./intents";

export interface GestureBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * 边缘持续平移的带宽（§5.2 `EDGE_BAND_PX`）：从系统手势禁区边界再往内 48px。
 * 手机禁区 24px，所以实际范围是离物理屏幕边 24–72px；平板禁区 28px 时是 28–76px。
 */
const EDGE_BAND_PX = 48;

export interface GestureGeometrySnapshot {
  world: GestureBox | null;
  minimap: GestureBox | null;
  card: GestureBox | null;
  /**
   * 每一块真正会接触摸的 HUD / 游戏内 FDF 表面。**不能量 `.hud` 根节点**：它是
   * `position:fixed; inset:0` 的满屏容器（style.css `.hud`），拿它做命中会让所有世界触摸
   * 都被判成 `hud`，选中 / 框选 / 长按一个都到不了 `GestureMatchHost`。所以只收
   * `pointer-events:auto` 的 `.hud-zone`、底栏、英雄栏、输入栏，以及 FDF 里自己打开
   * 指针事件的按钮（`fdf-screen` 本身也是满屏且 `pointer-events:none`）。
   */
  hud: readonly GestureBox[];
  /** 控制台自己接收触摸的那几块（编队条），不是满屏容器 —— 容器 `pointer-events:none`。 */
  console: GestureBox | null;
}

function box(el: Element | null): GestureBox | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function contains(box: GestureBox | null, x: number, y: number): boolean {
  return !!box && x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
}

function containsAny(boxes: readonly GestureBox[], x: number, y: number): boolean {
  for (const b of boxes) if (contains(b, x, y)) return true;
  return false;
}

/** 会自己接指针的 HUD / 游戏内 FDF 表面（§5.3「用实际矩形做点包含判定」）。 */
const HUD_SURFACES = [
  ".hud-zone",
  ".hud-console",
  ".hud-herobar",
  ".hud-autocam",
  ".hud-chatbar",
  // FDF 屏幕的根是满屏且 `pointer-events:none`，只有这些控件把指针事件打开；
  // 不在这个列表里的像素会穿透到地图，正是我们想当成世界的那些。
  ".fdf-screen.fdf-ingame .fdf-button",
  ".fdf-screen.fdf-ingame .fdf-checkbox",
  ".fdf-screen.fdf-ingame .fdf-slider",
  ".fdf-screen.fdf-ingame .fdf-popup",
  ".fdf-screen.fdf-ingame .fdf-list",
  ".fdf-screen.fdf-ingame .console-resource-hover",
].join(", ");

function boxes(selector: string): GestureBox[] {
  const out: GestureBox[] = [];
  for (const el of document.querySelectorAll(selector)) {
    const b = box(el);
    if (b) out.push(b);
  }
  return out;
}

export class GestureGeometry {
  private snapshot: GestureGeometrySnapshot = {
    world: null,
    minimap: null,
    card: null,
    hud: [],
    console: null,
  };
  private measured = false;

  /** 量一次。同一批事件里重复调用只量一次。 */
  refresh(force = false): GestureGeometrySnapshot {
    if (this.measured && !force) return this.snapshot;
    if (typeof document === "undefined") return this.snapshot;
    this.snapshot = {
      world: box(document.querySelector("#map")),
      minimap: box(document.querySelector(".hud-minimap")),
      card: box(document.querySelector(".hud-command")),
      hud: boxes(HUD_SURFACES),
      // The squad bar only: `#gesture-stage` spans the whole frame but takes no input itself,
      // so measuring the container would turn every world touch into a "console" one.
      console: box(document.querySelector("#gesture-stage .gesture-squad")),
    };
    this.measured = true;
    return this.snapshot;
  }

  /** 下一次 areaAt 强制重量（resize / orientation / hudScale / flavor 变化时调用）。 */
  invalidate(): void {
    this.measured = false;
  }

  /**
   * 命中顺序：控制台 → 命令卡 → 小地图 → HUD → 世界。控制台的编队条压在 HUD 之上，
   * 必须先问它；HUD 与地图在 stage 里重叠摆放，所以 HUD 也要先于世界。
   */
  areaAt(clientX: number, clientY: number): GestureArea {
    const s = this.refresh();
    if (contains(s.console, clientX, clientY)) return "console";
    if (contains(s.card, clientX, clientY)) return "card";
    if (contains(s.minimap, clientX, clientY)) return "minimap";
    if (containsAny(s.hud, clientX, clientY)) return "hud";
    return "world";
  }

  /** client 像素 → 地图 canvas 的 CSS 像素。没有地图时 null。 */
  canvasPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const world = this.refresh().world;
    if (!world) return null;
    return { x: clientX - world.left, y: clientY - world.top };
  }

  /**
   * 底部 console 贴图上沿的 client y（§8.3）。手势控件、径向轮盘都以它为下限，
   * 不许压到 HUD 底栏上。没有地图时 null。比例来自 device（唯一按美术变化的值）。
   */
  consoleBandTop(): number | null {
    const world = this.refresh().world;
    if (!world) return null;
    return world.top + world.height * (1 - touchDevice().consoleTop);
  }

  /** 手势层热区的四条内边界（client 像素），已叠加系统禁区与安全区。 */
  private edges(): { left: number; right: number; top: number; bottom: number } {
    const device = touchDevice();
    const insets = device.safeInsets;
    const edge = device.deviceClass === "phone" ? 24 : 28;
    return {
      left: Math.max(edge, insets.left + edge),
      right: Math.max(edge, insets.right + edge),
      top: Math.max(edge, insets.top + edge),
      bottom: Math.max(edge, insets.bottom + edge),
    };
  }

  /**
   * 手势层热区：系统手势禁区（最外一圈 + 刘海 / Home 条安全区）之外才算。
   * 顶部下拉、底部上滑、侧边返回都从这里避让（§6.2）。
   */
  isHotZone(clientX: number, clientY: number): boolean {
    if (typeof window === "undefined") return true;
    const e = this.edges();
    return (
      clientX >= e.left &&
      clientX <= window.innerWidth - e.right &&
      clientY >= e.top &&
      clientY <= window.innerHeight - e.bottom
    );
  }

  /**
   * 安全区内的边缘带（§6.1 / §5.2）：返回朝屏幕内侧的单位方向，不在带内返回 null。
   * 方向直接就是 `midPan` 要的位移方向 —— 按住左边缘 = 相机向左走（`mx` 为正），
   * 与中键把地图往反方向推是同一套换算。四角取对角线的归一化方向。
   */
  edgePan(clientX: number, clientY: number): { dx: number; dy: number } | null {
    if (typeof window === "undefined") return null;
    if (!this.isHotZone(clientX, clientY)) return null;
    const e = this.edges();
    let dx = 0;
    let dy = 0;
    if (clientX - e.left <= EDGE_BAND_PX) dx = 1;
    else if (window.innerWidth - e.right - clientX <= EDGE_BAND_PX) dx = -1;
    if (clientY - e.top <= EDGE_BAND_PX) dy = 1;
    else if (window.innerHeight - e.bottom - clientY <= EDGE_BAND_PX) dy = -1;
    if (!dx && !dy) return null;
    const length = Math.hypot(dx, dy);
    return { dx: dx / length, dy: dy / length };
  }
}

export const gestureGeometry = new GestureGeometry();
