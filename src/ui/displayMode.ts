// "Window Mode" — the one rung of the Video panel's monitor block a page can honour.
//
// A browser cannot enumerate displays or pick an adapter, but it can be fullscreen. So
// `windowed` leaves the page as it is and the two fullscreen rungs (Windowed Fullscreen and
// Fullscreen) both ask for the Fullscreen API — the browser draws the same thing either way.
// The request needs a user gesture; an Options change is one, and a refusal is silent.

export type WindowMode = "windowed" | "borderless" | "fullscreen";

export function applyWindowMode(mode: WindowMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  try {
    if (mode === "windowed") {
      if (document.fullscreenElement) void document.exitFullscreen();
      return;
    }
    if (!document.fullscreenElement) {
      const p: unknown = root.requestFullscreen();
      if (p && typeof (p as Promise<void>).catch === "function") (p as Promise<void>).catch(() => undefined);
    }
  } catch {
    /* no Fullscreen API, or refused — the page stays windowed */
  }
}
