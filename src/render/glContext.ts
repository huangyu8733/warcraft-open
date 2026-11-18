// Which WebGL version this page asks for.
//
// The Reforged client (flavour `hd`, `hdArt=sd` included — that is an art swap, not a
// renderer one) draws on **WebGL 2**; the classic client stays on **WebGL 1**, untouched.
// The context version is decided by the FLAVOUR rather than by what a model or texture
// happens to be: one `viewer.gl` is shared by the world view and every overlay on the same
// canvas, so the shaders must all belong to the same version.
//
// The vendor cannot import this module, so the decision travels on one global, the way
// `__OW3_VIDEO__` already does for texture and particle settings. `viewer/gl/gl.ts` reads
// `__OW3_GL2__` when it creates a context, and clears it if WebGL 2 cannot be created there
// — a driver without it must fall back to WebGL 1, not show a black canvas.
//
// `?gl=1` forces WebGL 1 on any flavour. It is the A/B door for calling the WebGL 2 work
// into question without a new build.

import { isHd } from "../data/flavor";

/** True once `installGlVersion` has decided the page wants a WebGL 2 context. */
export function wantsWebGL2(): boolean {
  return (globalThis as { __OW3_GL2__?: boolean }).__OW3_GL2__ === true;
}

/**
 * Decide the page's context version. Call once at boot, before the first `WebGL` (any menu,
 * loading screen or match creates one).
 */
export function installGlVersion(): void {
  let forcedGl1 = false;

  try {
    forcedGl1 = new URLSearchParams(location.search).get("gl") === "1";
  } catch {
    /* no location (headless test): the flavour alone decides */
  }

  (globalThis as { __OW3_GL2__?: boolean }).__OW3_GL2__ = isHd() && !forcedGl1;
}

/**
 * Is this context a WebGL 2 one? (The vendor's own flag lives on its `WebGL` object; src
 * overlays hold a bare context and ask here.)
 */
export function isWebGL2(gl: WebGLRenderingContext): boolean {
  return typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
}
