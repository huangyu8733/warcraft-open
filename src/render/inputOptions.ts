import type { Options } from "../data/options";

// The Input tab's two control rows, as state ui/mouseCapture.ts reads.
//
//   · "Confine Mouse Cursor" — the WebUI's Off / On / Auto. This engine's pointer lock is the
//     only way a page can hold the OS pointer, so `on` and `auto` both mean "take it while a
//     match is being played" (the existing behaviour); `off` leaves the pointer free, for a
//     player on a multi-monitor desk who would rather it not be parked.
//   · "Reduce Mouse Lag" — asks Pointer Lock for `unadjustedMovement`, i.e. the raw device
//     deltas without the OS acceleration curve. It can be refused; mouseCapture falls back.

export type MouseConfinement = "off" | "on" | "auto";

let confinement: MouseConfinement = "auto";
let reduceLag = false;

export function applyInputOptions(opts: Options): void {
  const v = opts.confineMouse;
  confinement = v === "off" || v === "on" ? v : "auto";
  reduceLag = opts.reduceMouseLag === true;
}

export function mouseConfinement(): MouseConfinement {
  return confinement;
}

/** May the page take the pointer at all? */
export function confineMouseEnabled(): boolean {
  return confinement !== "off";
}

export function reduceMouseLag(): boolean {
  return reduceLag;
}
