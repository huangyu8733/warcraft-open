import type { Options } from "../data/options";

// The Video tab's two frame-rate rows: "Max Foreground FPS" and "Max Background FPS".
//
// The desktop shell may already cap requestAnimationFrame at boot (render/frameCap.ts); this is
// the RUNTIME cap the player owns, and it layers on top. A browser tab is vsynced, so a cap
// can only ever LOWER the delivered rate — asking for 300 on a 60 Hz panel changes nothing,
// which is exactly what the row means there.
//
// The patch is installed lazily, on the first `applyFrameLimits` call (boot and every Options
// change), so a headless import (the options test compiles this module) never touches `window`.

let installed = false;
let foregroundFps = 300;
let backgroundFps = 30;
let lastRun = 0;
let nextId = 1;
let rafHandle = 0;
let timer = 0;
const queue = new Map<number, FrameRequestCallback>();
let realRaf: ((cb: FrameRequestCallback) => number) | null = null;
let realCancel: ((id: number) => void) | null = null;

function interval(): number {
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  return 1000 / Math.max(1, hidden ? backgroundFps : foregroundFps);
}

function pump(ts: number): void {
  rafHandle = 0;
  const now = performance.now();
  const wait = lastRun + interval() - now;
  if (wait > 1) {
    timer = window.setTimeout(() => {
      timer = 0;
      rafHandle = realRaf!(pump);
    }, wait);
    return;
  }
  lastRun = now;
  const batch = [...queue];
  queue.clear();
  for (const [, cb] of batch) {
    try {
      cb(ts);
    } catch (err) {
      setTimeout(() => {
        throw err;
      });
    }
  }
  if (queue.size) schedule();
}

function schedule(): void {
  if (rafHandle || timer || !realRaf) return;
  const wait = lastRun + interval() - performance.now();
  if (wait > 1) {
    timer = window.setTimeout(() => {
      timer = 0;
      rafHandle = realRaf!(pump);
    }, wait);
  } else {
    rafHandle = realRaf(pump);
  }
}

function install(): void {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;
  realRaf = window.requestAnimationFrame.bind(window);
  realCancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.set(id, cb);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    if (queue.delete(id)) {
      if (!queue.size) {
        if (rafHandle) realCancel!(rafHandle);
        if (timer) clearTimeout(timer);
        rafHandle = timer = 0;
      }
      return;
    }
    realCancel?.(id);
  };
  document.addEventListener("visibilitychange", () => {
    if (!queue.size) return;
    if (timer) clearTimeout(timer);
    timer = 0;
    if (!rafHandle) rafHandle = realRaf!(pump);
  });
}

export function applyFrameLimits(opts: Options): void {
  foregroundFps = typeof opts.maxForegroundFps === "number" ? opts.maxForegroundFps : 300;
  backgroundFps = typeof opts.maxBackgroundFps === "number" ? opts.maxBackgroundFps : 30;
  install();
}

export function foregroundFpsLimit(): number {
  return foregroundFps;
}

export function backgroundFpsLimit(): number {
  return backgroundFps;
}
