// DzUI natives — the 25-frame custom-UI API that the YDWE/DzAPI era maps speak
// (【小偷-科技也疯狂TD】 draws its whole menu with it). It predates Reforged's
// `BlzFrame*` API and differs from it in one way that matters here: a frame is a plain
// INTEGER, not a `framehandle`, and the script converts one to the other with its own
// identity helpers (`DzF2I(i)` in the map is `returns integer` and returns `i`).
//
// So this is a MAPPING onto the frame layer the engine already has (compat/frames.ts),
// not a second frame implementation: every Dz id IS the handle id of a `FrameObj`, and
// `DzGetGameUI()` is 0 — the game-UI root, which is exactly what `parent: 0` and an
// absolute point already mean to ui/scriptFrameTree.ts. That makes a Dz anchor relative
// to the GameUI resolve as the frame tree's own 0.8 × 0.6 box, which is the space the
// map's offsets are authored in.
//
// The one virtual origin is `DzFrameGetTopMessage()`: the engine's top-centre message
// row, which the map anchors the hero health bar under. It has no drawn frame of its
// own, so it answers a negative sentinel and `DzFrameSetPoint` places anchors to it
// against an approximation of that row's rect (see TOP_MESSAGE).
//
// Events: `DzFrameSetScript` names a bare FUNCTION (no trigger), so its listeners live
// in `rt.frameScripts` and `Interpreter.fireFrameEvent` runs them beside the
// `BlzTriggerRegisterFrameEvent` triggers. The Dz event ids are 1/2/3 for click /
// mouse-enter / mouse-leave, which is the same ordering our `frameeventtype` enum uses
// (compat/prelude.ts), so they pass straight through.

import { blankFrame, frameModel, type FrameObj } from "./frames";
import type { JassUnit, NativeCtx, Runtime } from "../jass/runtime";
import { asInt, asNum, asStr, jInt, jStr, JNULL, truthy, type JassValue } from "../jass/values";

type NativeFn = (ctx: NativeCtx, args: JassValue[]) => JassValue;
const def = (rt: Runtime, name: string, fn: NativeFn): void => void rt.natives.set(name, fn);

/** `DzFrameGetTopMessage()` — the engine's top-centre message row. Not drawn and not a
 *  handle: a sentinel `DzFrameSetPoint` recognises as an anchor rect. */
const TOP_MESSAGE = -1;

/** The Windows virtual-key code `DzTriggerRegisterKeyEvent` speaks, from a DOM event.
 *  `keyCode` is deprecated but IS that vocabulary (letters are their ASCII capitals, F1..F12
 *  are 112..123) and every browser still fills it; the fallbacks cover one that reports 0. */
export function dzKeyCode(e: KeyboardEvent): number {
  if (e.keyCode) return e.keyCode;
  if (e.key.length === 1) return e.key.toUpperCase().charCodeAt(0);
  const named: Record<string, number> = {
    Escape: 27, Enter: 13, Space: 32, Tab: 9, Shift: 16, Control: 17, Alt: 18,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
  };
  if (named[e.key]) return named[e.key];
  const fn = /^F([1-9]|1[0-2])$/.exec(e.key);
  return fn ? 111 + Number(fn[1]) : 0;
}

/** The two virtual rects a Dz point can anchor to, as `[left, bottom, right, top]` in the
 *  unscaled units an absolute point uses (the 0.8 × 0.6 box).
 *
 *  GAME_UI is exact — it IS that box. TOP_MESSAGE is an approximation: the message row sits
 *  at the top of the screen, centred, and the map hangs the hero's health bar just under its
 *  BOTTOM edge. The width only matters to anchors on its left/right points, of which the map
 *  uses none. */
const GAME_UI = { l: 0, b: 0, r: 0.8, t: 0.6 };
const TOP_MESSAGE_RECT = { l: 0.2, b: 0.552, r: 0.6, t: 0.6 };

/** A FRAMEPOINT index (0..8, common.j's order) on one of those rects. */
function rectPoint(rect: { l: number; b: number; r: number; t: number }, point: number): [number, number] {
  const cx = (rect.l + rect.r) / 2;
  const cy = (rect.b + rect.t) / 2;
  switch (point) {
    case 0: return [rect.l, rect.t];
    case 1: return [cx, rect.t];
    case 2: return [rect.r, rect.t];
    case 3: return [rect.l, cy];
    case 4: return [cx, cy];
    case 5: return [rect.r, cy];
    case 6: return [rect.l, rect.b];
    case 7: return [cx, rect.b];
    default: return [rect.r, rect.b];
  }
}

export function registerDzNatives(rt: Runtime): void {
  const m = (c: NativeCtx) => frameModel(c.rt);
  // A Dz id is the FrameObj's handle id, and the map hands it back as an INTEGER.
  const frame = (c: NativeCtx, v: JassValue): FrameObj | undefined => {
    if (v.k !== "int") return undefined;
    const got = c.rt.handles.get(v.n) as FrameObj | undefined;
    return got && m(c).frames.get(v.n) === got ? got : undefined;
  };
  const bump = (c: NativeCtx): void => void m(c).revision++;
  const set = (name: string, apply: (f: FrameObj, a: JassValue[], c: NativeCtx) => void): void => {
    def(rt, name, (c, a) => {
      const f = frame(c, a[0]);
      if (f) {
        apply(f, a, c);
        bump(c);
      }
      return JNULL;
    });
  };

  // --- the roots ---------------------------------------------------------------------
  def(rt, "DzGetGameUI", () => jInt(0));
  def(rt, "DzFrameGetTopMessage", () => jInt(TOP_MESSAGE));

  // --- creating ----------------------------------------------------------------------
  // DzCreateFrameByTagName(frameType, name, parent, template, id). `id` is the create
  // context (the same one the Blz API takes); `template` is an FDF template name to
  // inherit — the map passes the literal "template", which resolves to nothing and leaves
  // a plain typed frame, exactly as the native would.
  def(rt, "DzCreateFrameByTagName", (c, a) => {
    const type = asStr(a[0] ?? JNULL).toUpperCase() || "FRAME";
    const parent = asInt(a[2] ?? JNULL);
    const f = blankFrame(asStr(a[1] ?? JNULL), asInt(a[4] ?? JNULL), false, parent > 0 ? parent : 0, type);
    f.inherits = asStr(a[3] ?? JNULL);
    f.handleId = c.rt.handles.alloc(f);
    m(c).frames.set(f.handleId, f);
    bump(c);
    return jInt(f.handleId);
  });

  // --- placing and sizing -------------------------------------------------------------
  const anchor = (f: FrameObj, p: FrameObj["points"][number]): void => {
    f.points = f.points.filter((q) => q.point !== p.point);
    f.points.push(p);
  };
  def(rt, "DzFrameSetPoint", (c, a) => {
    const f = frame(c, a[0]);
    if (!f) return JNULL;
    const point = asInt(a[1] ?? JNULL);
    const relative = a[2]?.k === "int" ? a[2].n : a[2]?.k === "handle" ? a[2].h : 0;
    const relativePoint = asInt(a[3] ?? JNULL);
    const x = asNum(a[4] ?? JNULL);
    const y = asNum(a[5] ?? JNULL);
    // The game UI and its top message are not drawn frames, so a point relative to one is
    // converted to an ABSOLUTE point — the same anchor, measured from the box's corner.
    if (relative === 0 || relative === TOP_MESSAGE) {
      const [ax, ay] = rectPoint(relative === 0 ? GAME_UI : TOP_MESSAGE_RECT, relativePoint);
      anchor(f, { point, relative: 0, relativePoint: -1, x: ax + x, y: ay + y });
    } else {
      anchor(f, { point, relative, relativePoint, x, y });
    }
    bump(c);
    return JNULL;
  });
  set("DzFrameSetSize", (f, a) => {
    f.width = asNum(a[1] ?? JNULL);
    f.height = asNum(a[2] ?? JNULL);
    f.sized = true;
  });

  // --- looking like something ---------------------------------------------------------
  set("DzFrameShow", (f, a) => { f.visible = truthy(a[1] ?? JNULL); });
  set("DzFrameSetAlpha", (f, a) => { f.alpha = Math.max(0, Math.min(255, asInt(a[1] ?? JNULL))); });
  set("DzFrameSetTexture", (f, a) => { f.texture = asStr(a[1] ?? JNULL); f.textureSet = true; });
  set("DzFrameSetPriority", (f, a) => { f.priority = asInt(a[1] ?? JNULL); });
  // `DzFrameSetFont` names a .ttf the map imported. The drawing's type is CSS, so only the
  // SIZE is taken (scriptFrameTree.ts applies it as the frame's FrameFont).
  set("DzFrameSetFont", (f, a) => { f.fontHeight = asNum(a[2] ?? JNULL); });

  // `DzFrameSetModel` / `DzFrameSetAnimate(Offset)` configure a 3D SPRITE (the hero health
  // bar is `UI_shengmingzhi.mdl`). Sprites are not drawn — an MDX cannot be a DOM frame —
  // but their TEXT children still are, so the number over the bar comes up in place.
  set("DzFrameSetModel", () => {});
  set("DzFrameSetAnimate", () => {});
  set("DzFrameSetAnimateOffset", () => {});

  // --- text ---------------------------------------------------------------------------
  def(rt, "DzFrameSetText", (c, a) => {
    const f = frame(c, a[0]);
    if (f) {
      const first = !f.textSet;
      f.text = c.rt.resolveTrigStr(asStr(a[1] ?? JNULL));
      f.textSet = true;
      const model = m(c);
      if (first) model.revision++; // a frame with no text of its own may not be in the tree
      model.textRevision++;
      model.textChanged.add(f.handleId);
    }
    return JNULL;
  });
  def(rt, "DzFrameGetText", (c, a) => jStr(frame(c, a[0])?.text ?? ""));

  // --- UI events ----------------------------------------------------------------------
  // DzFrameSetScript(frame, eventId, xfunc, sync). `xfunc` is a function NAME (the map's
  // own action functions); the sync flag belongs to a multiplayer session, which this
  // engine answers locally.
  def(rt, "DzFrameSetScript", (c, a) => {
    const f = frame(c, a[0]);
    const fn = a[2]?.k === "code" ? a[2].fn : asStr(a[2] ?? JNULL);
    if (!f || !fn) return JNULL;
    const eventIndex = asInt(a[1] ?? JNULL);
    const model = m(c);
    let events = model.events.get(f.handleId);
    if (!events) model.events.set(f.handleId, (events = new Set()));
    events.add(eventIndex);
    let byEvent = c.rt.frameScripts.get(f.handleId);
    if (!byEvent) c.rt.frameScripts.set(f.handleId, (byEvent = new Map()));
    const list = byEvent.get(eventIndex);
    if (list) list.push(fn);
    else byEvent.set(eventIndex, [fn]);
    bump(c); // the drawing listens on a different frame now
    return JNULL;
  });
  def(rt, "DzGetTriggerUIEventFrame", (c) => {
    const v = c.rt.eventResponse("TriggerFrame");
    return jInt(v.k === "handle" ? v.h : 0);
  });
  def(rt, "DzGetTriggerUIEventPlayer", (c) => c.rt.eventResponse("TriggerPlayer"));

  // --- keyboard -----------------------------------------------------------------------
  // DzTriggerRegisterKeyEvent(trigger, key, status, sync, xfunc). `key` is a Windows
  // virtual-key code (the map registers E/R/A/S/D/J and F1/F4 by their ASCII caps) and
  // `status` is 1 for a press, 0 for a release. The canvas's key handlers raise them for
  // the local player (render/mapViewer.ts).
  def(rt, "DzTriggerRegisterKeyEvent", (c, a) => {
    const t = c.rt.data<{ handleId: number }>(a[0] ?? JNULL);
    if (!t) return JNULL;
    c.rt.triggerRegs.push({
      kind: "dzKey", trigId: t.handleId,
      params: [jInt(asInt(a[1] ?? JNULL)), jInt(asInt(a[2] ?? JNULL))],
    });
    return JNULL;
  });
  def(rt, "DzGetTriggerKeyPlayer", (c) => c.rt.eventResponse("TriggerPlayer"));

  // --- sync ---------------------------------------------------------------------------
  // In a LAN these cross to the other clients; this engine is one machine, so DzSyncData
  // echoes locally — the map's handler runs on the player who sent it, which is what the
  // UI needs to answer its own button. `server` only says who relays.
  def(rt, "DzTriggerRegisterSyncData", (c, a) => {
    const t = c.rt.data<{ handleId: number }>(a[0] ?? JNULL);
    if (!t) return JNULL;
    c.rt.triggerRegs.push({ kind: "dzSync", trigId: t.handleId, params: [a[1] ?? JNULL] });
    return JNULL;
  });
  def(rt, "DzSyncData", (c, a) => {
    const prefix = asStr(a[0] ?? JNULL);
    const data = asStr(a[1] ?? JNULL);
    c.fireEvent?.(
      "dzSync",
      new Map<string, JassValue>([
        ["TriggerPlayer", c.rt.playerHandle(c.rt.localViewer)],
        ["TriggerSyncData", jStr(data)],
      ]),
      (params) => params[0]?.k === "string" && params[0].s === prefix,
    );
    return JNULL;
  });
  def(rt, "DzGetTriggerSyncData", (c) => c.rt.eventResponse("TriggerSyncData"));
  def(rt, "DzGetTriggerSyncPlayer", (c) => c.rt.eventResponse("TriggerPlayer"));

  // --- unit models --------------------------------------------------------------------
  // DzSetUnitModel(unit, path) — wear a model the map imported (the costume heroes). The
  // scene owns models, so this crosses the bridge like setUnitSkin does.
  def(rt, "DzSetUnitModel", (c, a) => {
    const u = c.rt.data<JassUnit>(a[0] ?? JNULL);
    const path = asStr(a[1] ?? JNULL);
    if (u && u.simId >= 0 && path) c.rt.hooks?.setUnitModel?.(u.simId, path);
    return JNULL;
  });
}
