// L4 配置层（方案 §10）：手势的持久化设置，全部来自 `warcraft-open.options` 的同一张表。
//
// 与 `render/gameplayOptions.ts` / `render/scrollOptions.ts` 同一形态：模块级快照 +
// `applyGestureOptions(opts)` + 读取器。识别器与动作层只读这里的快照，所以 Options 里
// 改一项立刻生效，不需要重挂监听；关闭总开关时下一次事件就停（§10.1 / P5）。
//
// 独立键 `warcraft-open.gestures`（可重映射表）属于 P3 的 editor，本模块不碰它。

import type { Options } from "../../data/options";

export type GestureLayout = "minimal" | "light" | "full";
export type GestureHandedness = "right" | "left";

export interface GestureProfile {
  /** 总开关；关闭时识别器一个监听都不注册。默认值按设备定（手机 / 平板开，桌面关），
   *  但任何平台都能在 Options / 右上角切换，切换后由 options 的 gesture-mode 记住。 */
  enabled: boolean;
  /** 控制台形态 A/B/C（§6.3）。P3 的 console.ts 读它。 */
  layout: GestureLayout;
  /** 左右手布局；编队条与轮盘镜像。 */
  handedness: GestureHandedness;
  /** 长按判定毫秒数（滑动条 300–800）。 */
  longPressMs: number;
  /** 轻点容差像素（滑动条 8–24）。 */
  tapSlopPx: number;
  /** 双指捏合是否缩放。 */
  pinchZoom: boolean;
  /** 世界里的静止长按是否发智能命令（右键）；false 时只留 tooltip 语义。 */
  longPressIsRightClick: boolean;
  /** 振动反馈（Android 桥 / navigator.vibrate）。 */
  haptics: boolean;
  /** 手势轨迹可视化。 */
  trail: boolean;
  /** 平板常驻命令卡镜像。 */
  cardMirror: boolean;
  /** 首次进入的手势教学浮层。 */
  showHints: boolean;
  /** 平板三/四指手势（§6.2：默认关，避免与系统多指手势冲突）。 */
  multiFinger: boolean;
}

export const DEFAULT_GESTURE_PROFILE: GestureProfile = {
  enabled: true,
  layout: "light",
  handedness: "right",
  longPressMs: 420,
  tapSlopPx: 12,
  pinchZoom: true,
  longPressIsRightClick: true,
  haptics: true,
  trail: true,
  cardMirror: false,
  showHints: true,
  multiFinger: false,
};

let current: GestureProfile = DEFAULT_GESTURE_PROFILE;

/** 当前生效的手势设置。默认值直到 `applyGestureOptions` 第一次被调用。 */
export function gestureProfile(): GestureProfile {
  return current;
}

const numberIn = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const boolOr = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const layoutOf = (v: unknown): GestureLayout =>
  v === "minimal" || v === "light" || v === "full" ? v : DEFAULT_GESTURE_PROFILE.layout;

const handednessOf = (v: unknown): GestureHandedness =>
  v === "left" || v === "right" ? v : DEFAULT_GESTURE_PROFILE.handedness;

/** 从已提交 / 工作副本的选项里取出这一份快照；越界与脏值回落到默认。 */
export function applyGestureOptions(opts: Options): GestureProfile {
  current = {
    enabled: boolOr(opts.gestureEnabled, DEFAULT_GESTURE_PROFILE.enabled),
    layout: layoutOf(opts.gestureLayout),
    handedness: handednessOf(opts.gestureHandedness),
    longPressMs: numberIn(opts.gestureLongPressMs, DEFAULT_GESTURE_PROFILE.longPressMs, 300, 800),
    tapSlopPx: numberIn(opts.gestureTapSlopPx, DEFAULT_GESTURE_PROFILE.tapSlopPx, 8, 24),
    pinchZoom: boolOr(opts.gesturePinchZoom, DEFAULT_GESTURE_PROFILE.pinchZoom),
    longPressIsRightClick: boolOr(opts.gestureLongPressIsRightClick, DEFAULT_GESTURE_PROFILE.longPressIsRightClick),
    haptics: boolOr(opts.gestureHaptics, DEFAULT_GESTURE_PROFILE.haptics),
    trail: boolOr(opts.gestureTrail, DEFAULT_GESTURE_PROFILE.trail),
    cardMirror: boolOr(opts.gestureCardMirror, DEFAULT_GESTURE_PROFILE.cardMirror),
    showHints: boolOr(opts.gestureShowHints, DEFAULT_GESTURE_PROFILE.showHints),
    multiFinger: boolOr(opts.gestureMultiFinger, DEFAULT_GESTURE_PROFILE.multiFinger),
  };
  return current;
}
