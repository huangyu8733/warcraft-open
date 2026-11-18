// 手势层的类型约定。方案见《手机平板手势控制台方案.md》§5.4 / §7.1。
//
// 这一层只说「玩家用手指做了什么」，不说「游戏该做什么」：识别器只产出 GestureIntent，
// 语义动作层（P2 的 host.ts / actions.ts）再把它落到 RtsController 的既有函数上。
// SD 与 HD 共用同一份，0 处 flavor 分支（§9.3）。

/** 识别得出的手势种类。`radial` / `holdMove` 留给控制台 UI 层（P3）。 */
export type GestureKind =
  | "tap"
  | "longpress"
  | "doubletap"
  | "dragbox"
  | "swipe"
  | "pinch"
  | "twoFingerPan"
  | "twoFingerTap"
  | "threeFingerTap"
  | "fourFingerTap"
  | "edgeHold"
  | "radial"
  | "holdMove";

/** 手势发生在哪块区域。判定顺序与热区来源见 geometry.ts。 */
export type GestureArea = "world" | "minimap" | "card" | "hud" | "console";

/** 一个点。世界区域里是 canvas CSS 像素，HUD 区域里是 client 像素（§5.3）。 */
export interface GesturePoint {
  x: number;
  y: number;
}

export interface GestureIntent {
  kind: GestureKind;
  /** 手势落点（单点）或质心（多指）。 */
  x: number;
  y: number;
  from?: GesturePoint;
  to?: GesturePoint;
  /**
   * 滑动 / 平移的速度或位移。`swipe` 里是 px/ms；`twoFingerPan` 里是本次事件的质心位移
   * （px），因为动作层要把它直接交给 `gesturePan()`。
   */
  vx?: number;
  vy?: number;
  /** `pinch` 的累计距离比（1 = 未缩放）。 */
  scale?: number;
  /** `pinch` 本次事件新增的档数（+1 放大 / −1 缩小），已按 PINCH_STEP_RATIO 取整。 */
  steps?: number;
  /** 径向轮盘的 0..11 槽位（P3）。 */
  slot?: number;
  /** 参与本次手势的指针数。 */
  pointers: number;
  durationMs: number;
  area: GestureArea;
}

/** 识别阈值。全部可由 profile 覆盖（§5.2）；这里给默认值。 */
export interface GestureThresholds {
  /** 单指移动超过它就不再算轻点。手指会抖，所以大于鼠标的 DRAG_SLOP。 */
  tapSlopPx: number;
  /** 按住不动多久算长按（→ 右键智能命令 / tooltip）。 */
  longPressMs: number;
  /** 两次轻点的最大间隔与最大位置差（同类全选 / 相机跟随）。 */
  doubleTapMs: number;
  doubleTapDistPx: number;
  /** 快速滑动的判据：位移下限 + 时长上限。 */
  swipeMinDistPx: number;
  swipeMaxMs: number;
  /** 双指距离比每变化这么多 = 缩放 1 档（对应 7 档 ZOOM_STEPS）。 */
  pinchStepRatio: number;
  /** 屏幕最外这一圈是系统手势禁区，不注册热区（§6.2）。 */
  systemEdgePx: number;
  /** 系统手势禁区之外的额外留白。 */
  safeMarginPx: number;
  /**
   * 安全区内边缘按住多久开始持续平移（§6.1 的 `edgeHold`）。太短会把屏幕边缘的慢速
   * 轻点吃掉，太长又不如直接拖；220ms 落在长按（420ms）之前，给相机留出滑动时间。
   */
  edgeHoldMs: number;
}

export const DEFAULT_THRESHOLDS: GestureThresholds = {
  tapSlopPx: 12,
  longPressMs: 420,
  doubleTapMs: 300,
  doubleTapDistPx: 24,
  swipeMinDistPx: 60,
  swipeMaxMs: 400,
  pinchStepRatio: 0.15,
  systemEdgePx: 24,
  safeMarginPx: 0,
  edgeHoldMs: 220,
};

/** 玩家可在 Options 里改的两个阈值（§10.1 的滑动条）。 */
export type GestureThresholdOverrides = Partial<Pick<GestureThresholds, "tapSlopPx" | "longPressMs">>;

/** 平板的容差比手机宽一点：手指更大、握持更远（§5.2）。玩家设置永远优先于设备默认。 */
export function thresholdsFor(
  deviceClass: "phone" | "tablet" | "desktop-touch",
  overrides?: GestureThresholdOverrides,
): GestureThresholds {
  const base = deviceClass === "phone"
    ? DEFAULT_THRESHOLDS
    : { ...DEFAULT_THRESHOLDS, tapSlopPx: 16, systemEdgePx: 28 };
  return overrides ? { ...base, ...overrides } : base;
}

/**
 * 把玩家设置里的两个滑动条换成识别器覆盖项。**只有真的动过滑条的才算覆盖**：
 * `OPTION_DEFS` 的出厂值就是手机的 12 / 420，若把它们原样当作覆盖项，平板自己的
 * 16px 容差就永远轮不到（§5.2「玩家设置永远优先于设备默认」里的「玩家设置」指
 * 玩家改过的值，不是出厂默认）。
 */
export function thresholdOverridesFor(
  profile: Pick<GestureThresholds, "tapSlopPx" | "longPressMs">,
): GestureThresholdOverrides {
  const overrides: GestureThresholdOverrides = {};
  if (profile.tapSlopPx !== DEFAULT_THRESHOLDS.tapSlopPx) overrides.tapSlopPx = profile.tapSlopPx;
  if (profile.longPressMs !== DEFAULT_THRESHOLDS.longPressMs) overrides.longPressMs = profile.longPressMs;
  return overrides;
}
