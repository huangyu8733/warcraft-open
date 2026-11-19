import { Maximize, Minimize, createElement as lucideIcon } from "lucide";
import { isDesktopApp } from "../assets/nativeInstall";
import { t } from "../i18n";

// Alt+Enter toggles fullscreen.
//
// In the desktop app the SHELL answers it (electron/main.mjs, `before-input-event`) and cancels
// the keystroke before the page is sent it, so nothing here ever runs there. In a browser the
// page has to answer it itself — `requestFullscreen` needs a user activation, and this keydown
// is one.
//
// Either way the Enter half must reach NOTHING. A focused glue button fires on Enter
// (ui/fdf/render.ts `wireButton`) and in a match Enter opens the chat box, so the chord is
// taken on `window` in the CAPTURE phase — the first listener on the page, registered at module
// load before any screen exists — and stopped there, key-up included.

/** Whether the page itself can take the screen. False in the desktop app (the shell owns the
 *  chord and the window) and on an iPhone (Safari has no element fullscreen at all), which is
 *  also where the in-game button hides itself. */
export function fullscreenSupported(): boolean {
  return !isDesktopApp() && typeof document.documentElement.requestFullscreen === "function";
}

/** Whether the page is fullscreen right now — what the button's icon follows. */
export function fullscreenActive(): boolean {
  return !!document.fullscreenElement;
}

/** Enter or leave fullscreen, whichever the screen is not. The same path the button and
 *  Alt+Enter take; a no-op where `fullscreenSupported()` is false. */
export function toggleFullscreen(): void {
  if (!fullscreenSupported()) return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}

/** The button `createFullscreenToggle` hands back: the element plus the way to take its
 *  `fullscreenchange` listener off when the screen it belonged to goes away. */
export interface FullscreenToggle {
  element: HTMLButtonElement;
  dispose(): void;
}

/**
 * A browser-only fullscreen switch (enter / leave) for the screens that have no console to put
 * one on: the launcher's top bar, every FDF menu, the loading screen and the score board.
 *
 * Same gate as the in-game button — `fullscreenSupported()`: the desktop app's shell owns its
 * own window (no button, no page-level fullscreen), and iPhone Safari has no element fullscreen
 * at all. Returns null in both cases, so callers just skip the append.
 *
 * `className` is the caller's: the launcher's top bar wears the gold rim of its "?" button,
 * while a menu / loading screen floats its copy in the top-right corner (see style.css).
 */
export function createFullscreenToggle(className: string): FullscreenToggle | null {
  if (!fullscreenSupported()) return null;
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;

  const paint = (): void => {
    const on = fullscreenActive();
    const label = t(on ? "hud.exitFullscreen" : "hud.fullscreen");
    element.title = label;
    element.setAttribute("aria-label", label);
    element.setAttribute("aria-pressed", on ? "true" : "false");
    element.replaceChildren(lucideIcon(on ? Minimize : Maximize, { "stroke-width": 2.2, "aria-hidden": "true" }));
  };
  const onClick = (e: MouseEvent): void => {
    e.preventDefault();
    toggleFullscreen();
  };
  element.addEventListener("click", onClick);
  document.addEventListener("fullscreenchange", paint);
  paint();

  return {
    element,
    dispose: () => {
      document.removeEventListener("fullscreenchange", paint);
      element.removeEventListener("click", onClick);
      element.remove();
    },
  };
}

/** The Enter of an Alt+Enter is down: its key-up belongs to this chord even if Alt was let go
 *  first, and is swallowed with it. */
let enterTaken = false;

window.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || !e.altKey) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  enterTaken = true;
  if (e.repeat || isDesktopApp()) return;
  toggleFullscreen();
}, true);

const swallowEnter = (e: KeyboardEvent): void => {
  if (e.key !== "Enter" || !enterTaken) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === "keyup") enterTaken = false;
};
window.addEventListener("keypress", swallowEnter, true);
window.addEventListener("keyup", swallowEnter, true);
