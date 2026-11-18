// The one clock every menu animation runs on, and the one thing that keeps it turning when the
// browser stops handing out frames.
//
// A tab nobody is LOOKING at is not a tab that stands still. It stops serving
// requestAnimationFrame, and it goes right on firing setTimeout (throttled to about 1 Hz). A
// glue transition was made of both: the panel chrome's Birth is a model clip advanced per rAF
// frame, the hand-off from that Birth to its looping Stand was a `setTimeout(birthLength)`, the
// whooshes keyed into the clip were more of the same, and the DOM the panel carries fades on a
// third rAF loop. Hide the tab mid-transition and that did not pause — it TORE. The timers ran
// the sequence to its end while the frames meant to be drawing it never came, so coming back
// you got the contents at full opacity printed over chrome that had stopped halfway and would
// stay there: the panel never landed, and nothing was ever going to move it again.
//
// So: ONE clock, and everything a transition is made of reads it — model clips, DOM fades, the
// beats between them, the clips' own sounds. Nothing can advance without the rest.
//
// And the clock keeps its own time whether or not anyone is watching. While the tab is visible
// it steps on rAF. While it is hidden it steps on a DEDICATED WORKER's timer, which the browser
// does not throttle the way it throttles a hidden page's own (the same trick, for the same
// reason, as the LAN match's background pump in render/mapViewer.ts). A transition that starts
// and is then hidden therefore runs to its end at ordinary speed and is simply DONE when the
// player looks again — rather than stalling half-played and taking whatever was waiting on it
// (a menu leaving so a match can load) down with it.
//
// The step is clamped either way. Building a glue screen blocks the main thread — the campaign
// screen parses CampaignMenu.fdf and decodes its textures — and the first step after that stall
// otherwise carries the whole stall: fed in straight, a 3.3 s hitch advanced NightElf_Exp's
// 3.3 s "Birth" in ONE step and the arrival was over before a frame of it had been drawn. A
// dropped frame is time the player did not see; it is not time a clip should skip.

/** The largest step the clock will take at once. Two dropped frames' worth — enough that
 *  ordinary jitter passes through untouched, small enough that a stall cannot swallow a clip. */
export const MAX_STEP_MS = 33;

/** How often the hidden-tab pump steps the clock. Under MAX_STEP_MS, so an unwatched
 *  transition runs at its real speed rather than being clamped down to a fraction of it. */
const PUMP_MS = 16;

/** How long a scheduled rAF may go unserved before the pump takes over.
 *
 *  `document.hidden` is not the only way a tab stops being drawn: an OCCLUDED window (another
 *  window over it, a minimised shell, an automated capture) keeps `visibilityState === "visible"`
 *  and still gets no rAF callbacks at all — measured at zero frames in five seconds in the
 *  desktop capture browser. From in here that is indistinguishable from the compositor taking a
 *  while, so we wait a quarter of a second before deciding, which no healthy frame interval
 *  reaches. Without this the panel fades never ran and a glue screen stayed at opacity 0: the
 *  3D scene behind it drew, the menu on top never appeared. */
const STARVE_MS = 250;

type FrameFn = (dt: number, now: number) => void;

interface Timer {
  /** Clock reading this timer is due at. */
  at: number;
  fn: () => void;
}

/** The clock itself: milliseconds of animation time since the module loaded. */
let clock = 0;
/** `performance.now()` at the previous step; 0 when nothing is driving the clock. */
let last = 0;
let raf = 0;
let pump: Worker | null = null;
/** `performance.now()` when `step` last ran — the watchdog's only evidence that frames ARE
 *  being served. 0 until the first step. */
let lastStepAt = 0;
/** The starvation watchdog (see STARVE_MS); null while there is nothing to watch. */
let starve: ReturnType<typeof setInterval> | null = null;
/** Each subscriber, against whether it is worth keeping the clock turning for while the tab is
 *  hidden (see `onAnimFrame`). */
const subs = new Map<FrameFn, boolean>();
const timers = new Set<Timer>();

/** The clock's current reading. Only ever compare it against other readings of it — it is not
 *  wall time and, across a stall, deliberately runs behind it. */
export function animNow(): number {
  return clock;
}

/**
 * Run `cb` on every step of the clock, with that step and the new reading. Returns the
 * unsubscribe. Nothing drives the clock while nothing is subscribed or pending.
 *
 * A hidden tab still steps (see the header) but paints nothing, so a callback that RENDERS
 * should check `document.hidden` and do only its update half.
 *
 * `whileHidden: false` says this subscriber is not on its own a reason to keep an unwatched tab
 * ticking: it still runs on every step there is, but if the only thing left running is an idle
 * screen's looping Stand clips, the clock stops until the tab is looked at again. What must
 * finish — a transition's fade, the timers hand-holding a clip into its next one — keeps the
 * default and holds the clock open until it is done.
 */
export function onAnimFrame(cb: FrameFn, opts?: { whileHidden?: boolean }): () => void {
  subs.set(cb, opts?.whileHidden ?? true);
  drive();
  return () => {
    subs.delete(cb);
  };
}

/** A pending `animTimeout`. */
export interface AnimTimer {
  cancel(): void;
}

/**
 * `setTimeout` on the animation clock: `fn` fires on the first step at least `ms` of animation
 * time after this call — which is the same `ms` the clip it is timing will have had.
 */
export function animTimeout(fn: () => void, ms: number): AnimTimer {
  const timer: Timer = { at: clock + Math.max(0, ms), fn };
  timers.add(timer);
  drive();
  return { cancel: () => timers.delete(timer) };
}

/** `animTimeout` as a promise — the beat between two halves of a transition. */
export function animWait(ms: number): Promise<void> {
  return new Promise((resolve) => animTimeout(resolve, ms));
}

/** Advance the clock to `now` and pay out everything that reading has come due for. */
function step(now: number): void {
  const dt = last ? Math.min(now - last, MAX_STEP_MS) : 0;
  last = now;
  clock += dt;

  // Timers first, then the frame callbacks: a timer's job is to put a clip on a model
  // (Birth → Stand), and the callback that advances and draws that model should see the clip
  // this step is meant to be showing rather than the previous one.
  //
  // Both iterate a copy — a timer commonly schedules the next timer, and a frame callback can
  // unsubscribe itself on its last step.
  for (const timer of [...timers]) {
    if (clock < timer.at) continue;
    timers.delete(timer);
    timer.fn();
  }
  for (const cb of [...subs.keys()]) cb(dt, clock);

  lastStepAt = performance.now();
  drive();
}

/** Point the right driver at the clock for how things now stand — rAF while the tab is
 *  visible, the worker pump while it is hidden with work that must finish, and neither while
 *  there is nothing to run (or nothing worth running unwatched). */
function drive(): void {
  const anything = subs.size > 0 || timers.size > 0;
  const hidden = typeof document !== "undefined" && document.hidden;
  const unwatchedWork = timers.size > 0 || [...subs.values()].some(Boolean);
  const wantPump = hidden && unwatchedWork;
  const wantRaf = !hidden && anything;

  // The pump is OURS to stop only when the tab is hidden: while visible it may be the
  // starvation fallback (see STARVE_MS), and a real frame — not this function — retires it.
  if (!wantPump && hidden && pump) stopPump();
  if (!wantRaf && raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  if (!wantRaf && !wantPump) {
    stopPump();
    unwatch();
    last = 0; // a later restart must not be charged for the gap nothing was running across
    return;
  }
  if (wantRaf && !raf) raf = requestAnimationFrame(frame);
  if (wantPump) startPump();
  watch();
}

/** The worker pump: a page's own timers are clamped to ~1 Hz when it is hidden (worse under
 *  intensive throttling), a dedicated worker's are not, so the ticking lives there and the
 *  handler runs on the main thread like any other message. */
function startPump(): void {
  if (pump) return;
  const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${PUMP_MS});`], { type: "text/javascript" }));
  pump = new Worker(url);
  URL.revokeObjectURL(url); // the worker holds its own reference; the URL has done its job
  pump.onmessage = () => step(performance.now());
}

function stopPump(): void {
  pump?.terminate();
  pump = null;
}

/**
 * Watch for a rAF that is never served. Armed whenever the clock has work, so the first step
 * starts the countdown; a visible tab whose compositor has stopped delivering frames then
 * falls back to the pump instead of freezing every fade at its first keyframe.
 */
function watch(): void {
  if (starve || typeof setInterval === "undefined") return;
  lastStepAt = performance.now();
  starve = setInterval(() => {
    if (!subs.size && !timers.size) {
      unwatch();
      return;
    }
    if (pump) return; // already stepping, whoever started it
    if (typeof document !== "undefined" && document.hidden) return; // drive() owns that case
    if (performance.now() - lastStepAt < STARVE_MS) return;
    last = 0; // the pump starts from now: do not charge it for the stall it is ending
    startPump();
  }, STARVE_MS);
}

function unwatch(): void {
  if (starve) clearInterval(starve);
  starve = null;
}

function frame(t: number): void {
  raf = 0;
  // A real frame means the compositor is serving us again: retire the starvation pump.
  stopPump();
  step(t);
}

// Changing drivers is not a step: whichever one is taking over starts from now, so the swap
// itself costs the clock nothing.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    last = 0;
    drive();
  });
}
