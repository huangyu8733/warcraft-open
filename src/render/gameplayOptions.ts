import type { Options } from "../data/options";

// The Reforged Gameplay rows, as module state the HUD, overlays, camera and chat read.
//
// Same contract as render/scrollOptions.ts and render/videoQuality.ts: `applyGameplayOptions`
// is called at boot with the committed options and again by the Options screen on every
// change, and the readers below answer a single question each. This is where the meaning of
// the three Reforged values that are not a plain on/off lives (the HUD scale, the two camera
// distances) so no consumer has to re-invent it.

export type ChatScope = "all" | "allies" | "observers" | "private";

let heroFrames = true;
let heroLevel = true;
let formation = true;
let cooldownNumbers = true;
let goldMineCounter = true;
let timeElapsed = false;
let peonDoubleTap = true;
let gameInfo = true;
let profanity = false;
let hudScalePct = 100;
let fpsShown = false;
let pingShown = true;
let apmShown = false;
const chats: Record<ChatScope, boolean> = { all: true, allies: true, observers: true, private: true };

/** The HUD scale's ladder: 50 % … 150 %, with 100 the size the interface has always had. */
function scaleFactor(notch: number): number {
  return Math.max(0.5, Math.min(1.5, notch / 100));
}

export function applyGameplayOptions(opts: Options): void {
  heroFrames = opts.heroFrames !== false;
  heroLevel = opts.heroLevel !== false;
  formation = opts.formationMovement !== false;
  cooldownNumbers = opts.cooldownNumbers !== false;
  goldMineCounter = opts.goldMineCounter !== false;
  timeElapsed = opts.showTimeElapsed === true;
  peonDoubleTap = opts.peonDoubleTapFocus !== false;
  gameInfo = opts.gameInfoMessages !== false;
  profanity = opts.profanityFilter === true;
  hudScalePct = typeof opts.hudScale === "number" ? opts.hudScale : 100;
  fpsShown = opts.displayFps === true;
  pingShown = opts.displayPing !== false;
  apmShown = opts.displayApm === true;
  chats.all = opts.globalChat !== false;
  chats.allies = opts.teamChat !== false;
  chats.observers = opts.observerChat !== false;
  chats.private = opts.opponentChat !== false;
}

/** Heroes wear the gold level frame. OFF gives them the ordinary bar. */
export function heroStatusFrames(): boolean {
  return heroFrames;
}

/** The level number in that frame. Only meaningful while `heroStatusFrames()`. */
export function showHeroLevel(): boolean {
  return heroLevel;
}

/** Are group orders laid out as a formation? */
export function formationMovement(): boolean {
  return formation;
}

/** May the command card print the seconds left inside a cooldown sweep? */
export function showCooldownNumbers(): boolean {
  return cooldownNumbers;
}

/** The `3/5` over a worked gold mine. */
export function showGoldMineCounter(): boolean {
  return goldMineCounter;
}

/** The match clock in the top bar. */
export function showTimeElapsed(): boolean {
  return timeElapsed;
}

/** Double-clicking a worker selects every worker of that type. */
export function peonDoubleTapFocus(): boolean {
  return peonDoubleTap;
}

/** System / "game info" lines in the message area. */
export function gameInfoMessagesEnabled(): boolean {
  return gameInfo;
}

/** Chat body filter. */
export function profanityFilterEnabled(): boolean {
  return profanity;
}

/** The `zoom` factor `.hud` wears. */
export function hudScale(): number {
  return scaleFactor(hudScalePct);
}

export function displayFps(): boolean {
  return fpsShown;
}

export function displayPing(): boolean {
  return pingShown;
}

export function displayApm(): boolean {
  return apmShown;
}

/** Whether a chat scope may be sent/received at all. */
export function chatScopeEnabled(scope: ChatScope): boolean {
  return chats[scope];
}
