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

/** The distance a match opens on. */
export function defaultCameraDistance(): number {
  if (!enhanced) return BASE_OPENING;
  const d = lerp(ENHANCED_OPENING_MIN, BASE_MAX, openingNotch / 100);
  return Math.max(minCameraDistance(), Math.min(maxCameraDistanceUnchecked(), d));
}

/** `maxCameraDistance` before the opening is folded in — kept private so the two getters cannot
 *  recurse into one another. */
function maxCameraDistanceUnchecked(): number {
  return enhanced ? lerp(BASE_MAX, ENHANCED_MAX, maxNotch / 100) : BASE_MAX;
}
