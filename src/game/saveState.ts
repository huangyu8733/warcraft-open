import type { JassValue } from "../jass/values";
import type { Runtime } from "../jass/runtime";
import type { SnapshotViewer, SnapshotWorld, WorldSnapshot } from "./snapshot";
import { snapshotFor } from "./snapshot";
import type { SavedArray, SavedTimer, SavedValue, SaveScript } from "./saveFile";

/**
 * What a SAVE GAME keeps of the live game, and what it deliberately leaves behind.
 *
 * Three layers, in order of how much of the game they are:
 *
 *   1. **The world** — every unit, mine, item, stash, research and the clock. This is not new
 *      code: `snapshotFor` already builds exactly this shape for a client every 20th of a
 *      second, so a save is that snapshot taken for the SAVE's own player.
 *   2. **The script** — the map's JASS globals, its arrays and its live timers. Scalars cross;
 *      handles do not (see `SavedValue`), because a handle is a runtime-local number.
 *   3. **Nothing else.** Sounds, floating text, open dialogs and — for now — the suspended
 *      thread stack are not state a save can name, and pretending otherwise would load a game
 *      that is subtly not the one that was saved. They are listed in specs/hd-save-game/spec.md.
 */

/**
 * Eyes that see EVERYTHING. A save is not a recipient: the fog test in `snapshotFor` exists to
 * stop a client learning what it should not, and a save that applied it would write down only
 * what the camera happened to be looking at — every unit outside it would simply not exist on
 * load. `seesFor` is true for every player (so units inside a burrow travel too, which is a
 * `seesFor` gate rather than a fog one) and the three fog answers are false.
 */
const ALL_SEEING: SnapshotViewer = {
  seesFor: () => true,
  fogHides: () => false,
  fogBlocksClick: () => false,
  invisHides: () => false,
  fogBlocksAt: () => false,
  team: -1,
};

/** The world half of a save: one all-seeing snapshot, taken for `recipient` so that its stash,
 *  research and fallen-hero roster — which the payload carries for the recipient alone — are
 *  the save's own player's. */
export function captureWorld(world: SnapshotWorld, recipient: number, time: number): WorldSnapshot {
  return snapshotFor(world, ALL_SEEING, recipient, time);
}

// --- the script half ------------------------------------------------------------------

/** A value a save may carry: everything but a handle. */
function encodeValue(v: JassValue): SavedValue | null {
  switch (v.k) {
    case "int":
    case "real":
    case "bool":
    case "string":
    case "code":
      return v;
    case "null":
      return { k: "null" };
    default:
      return null; // a handle — a runtime-local number, see SavedValue
  }
}

function decodeValue(v: SavedValue): JassValue {
  return v.k === "null" ? { k: "null" } : (v as JassValue);
}

/**
 * The script's state, as far as a fresh run of the same map can be given it back.
 *
 * `skipped` counts the globals that held a handle. It is not an error — a map keeps unit
 * groups and timers in globals all the time — but it is the difference between "this save has
 * everything" and "this save has no unit left in `udg_heroes`", so the save list shows a mark
 * and the load screen says it.
 */
export function captureScript(rt: Runtime): SaveScript {
  const globals: Array<[string, SavedValue]> = [];
  let skipped = 0;
  for (const [name, value] of rt.globals) {
    const enc = encodeValue(value);
    if (enc) globals.push([name, enc]);
    else skipped++;
  }

  const arrays: Array<[string, SavedArray]> = [];
  for (const [name, arr] of rt.globalArrays) {
    const entries: SavedArray = [];
    for (const [index, value] of arr.entries()) {
      const enc = encodeValue(value);
      if (enc) entries.push([index, enc]);
      else skipped++;
    }
    if (entries.length) arrays.push([name, entries]);
  }

  const timers: SavedTimer[] = rt.timers
    .filter((t) => t.running)
    .map((t) => ({
      handler: t.handlerFn,
      timeout: t.timeout,
      periodic: t.periodic,
      remaining: Math.max(0, t.remaining),
      elapsed: t.elapsedTotal,
      running: t.running,
    }));

  return { globals, arrays, timers, time: rt.gameTime, skipped };
}

/**
 * Put the script back. Written values overwrite whatever initialization left in the same
 * global — which is the point: `InitGlobals` sets `udg_counter = 0`, and the save's 47 is the
 * truth. A global the save does not mention is left as initialization made it.
 *
 * Timers are matched to the ones initialization created, in order, by their handler: the
 * timer HANDLES are new, so a save cannot point at them, but a map's timers are created once
 * in `main()` and the Nth timer running `PeriodicFn` this run is the Nth one that ran it last
 * run. A saved timer with no counterpart is dropped rather than resurrected from nothing — it
 * belonged to a trigger this run has not reached yet.
 */
export function restoreScript(rt: Runtime, script: SaveScript): void {
  for (const [name, value] of script.globals) rt.globals.set(name, decodeValue(value));
  for (const [name, entries] of script.arrays) {
    const arr = rt.globalArrays.get(name);
    if (!arr) continue; // an array initialization did not make — nothing to write into
    for (const [index, value] of entries) arr.set(index, decodeValue(value));
  }

  const byHandler = new Map<string, number>();
  for (const saved of script.timers) {
    const key = saved.handler ?? "?";
    const live = rt.timers.filter((t) => (t.handlerFn ?? "?") === key);
    const seen = byHandler.get(key) ?? 0;
    byHandler.set(key, seen + 1);
    const timer = live[seen];
    if (!timer) continue;
    timer.timeout = saved.timeout;
    timer.periodic = saved.periodic;
    timer.remaining = saved.remaining;
    timer.elapsedTotal = saved.elapsed;
    timer.running = saved.running;
  }

  rt.gameTime = script.time;
}
