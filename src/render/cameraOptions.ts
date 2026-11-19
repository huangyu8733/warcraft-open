import type { Options } from "../data/options";

// The Gameplay tab's camera rows — "Enable Improved Zoom", "Default Camera Distance" and
// "Maximum Camera Distance" — as the numbers render/mapViewer.ts builds its zoom ladder from.
//
// The base ladder is the one the match has always used (1250 … 3600, opening at 3600; see
// mapViewer.ts ZOOM_MIN_DISTANCE / ZOOM_MAX_DISTANCE). Improved Zoom is the row that lets the
// player go FURTHER OUT and a little closer in: its rungs widen both ends, and the two sliders
// place the opening and far stops inside the widened range. With the switch OFF the base ladder
// stands and the sliders are inert, so nobody's camera changes by opening this screen.

const BASE_MIN = 1250;
const BASE_MAX = 3600;
const BASE_OPENING = 3600;
const ENHANCED_MIN = 900;
const ENHANCED_MAX = 6000;
const ENHANCED_OPENING_MIN = 1650;

let enhanced = false;
let openingNotch = 50;
let maxNotch = 50;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * Math.max(0, Math.min(1, t));

export function applyCameraOptions(opts: Options): void {
  enhanced = opts.enhancedZoom === true;
  openingNotch = typeof opts.defaultZoom === "number" ? opts.defaultZoom : 50;
  maxNotch = typeof opts.maxZoom === "number" ? opts.maxZoom : 50;
}

/** Is Improved Zoom on? */
export function enhancedZoom(): boolean {
  return enhanced;
}

/** The nearest stop the wheel can reach. */
export function minCameraDistance(): number {
  return enhanced ? ENHANCED_MIN : BASE_MIN;
}

/** The far stop the wheel can reach. */
export function maxCameraDistance(): number {
  const base = enhanced ? lerp(BASE_MAX, ENHANCED_MAX, maxNotch / 100) : BASE_MAX;
  return Math.max(minCameraDistance(), Math.max(base, defaultCameraDistance()));
}

/** The distance a match opens on.
 *
 *  `bj_CAMERA_DEFAULT_DISTANCE` is a DISTANCE, but what a player reads is pixels-per-unit:
 *  the lens is vertical (docs/camera.md), so the same world height is painted into whatever
 *  height the screen has. A 393px-tall landscape phone therefore draws every unit at ~⅓ the
 *  size a 1080p desktop does at the same distance — which is what "镜头太远、人物太小" is.
 *  Shortening the opening distance by `stageH / 900` compensates: a phone opens at ~0.44×
 *  (3600 → 1580, close to the original client's 1650), a tablet at ~0.85×, and anything 900px
 *  or taller keeps the value the options screen set. Only the OPENING moves — the wheel and
 *  pinch can still dolly all the way out to the far stop. */
export function defaultCameraDistance(): number {
  const base = enhanced ? lerp(ENHANCED_OPENING_MIN, BASE_MAX, openingNotch / 100) : BASE_OPENING;
  return Math.max(minCameraDistance(), Math.min(maxCameraDistanceUnchecked(), base * screenDistanceFactor()));
}

/** 屏幕越矮，同一段世界占的像素越少——开场视距按 stage 高度等比缩短（下限 0.32，
 *  避免极窄窗口把镜头怼到单位脸上）。桌面 900px 以上为 1，行为不变。 */
function screenDistanceFactor(): number {
  if (typeof window === "undefined") return 1;
  const stageH = Math.min(window.innerHeight, window.innerWidth * 0.75);
  return Math.max(0.32, Math.min(1, stageH / 900));
}

/** `maxCameraDistance` before the opening is folded in — kept private so the two getters cannot
 *  recurse into one another. */
function maxCameraDistanceUnchecked(): number {
  return enhanced ? lerp(BASE_MAX, ENHANCED_MAX, maxNotch / 100) : BASE_MAX;
}
