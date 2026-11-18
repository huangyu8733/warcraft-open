// "Mute when the window loses focus" — the Sound tab's PREF_SOUND_WINDOW_FOCUS.
//
// This module owns only the focus question; what muting means to the mix belongs to
// `applyAudioOptions` (src/data/options.ts), which registers its re-apply here once. `blur` and
// `focus` cover an embedded/desktop window; `visibilitychange` covers a background tab, where
// the browser may never deliver a blur.

let installed = false;
let focused = true;

export function installFocusMute(rerun: () => void): void {
  if (installed || typeof document === "undefined" || typeof window === "undefined") return;
  installed = true;
  focused = document.visibilityState !== "hidden";
  const update = (next: boolean): void => {
    if (focused === next) return;
    focused = next;
    rerun();
  };
  window.addEventListener("blur", () => update(false));
  window.addEventListener("focus", () => update(true));
  document.addEventListener("visibilitychange", () => update(document.visibilityState !== "hidden"));
}

/** Is the game window focused right now? */
export function windowFocused(): boolean {
  return focused;
}
