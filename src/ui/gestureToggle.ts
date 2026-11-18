import { loadOptions, saveOptions } from "../data/options";
import { t } from "../i18n";

/**
 * The launcher's touch-console switch (top bar, beside the language picker).
 *
 * The recogniser registers its listeners ONCE at boot and registers none at all when the switch
 * is off (方案 P5), so the switch writes `gestureEnabled` to `warcraft-open.options` and reloads.
 * That is the point on a phone / tablet browser: the in-game Options rows are only reachable
 * after a match is already running. On a desktop browser, enable device touch emulation in
 * DevTools first — a mouse is still a mouse, and the recogniser only speaks touch / pen.
 */
export function createGestureToggle(): HTMLElement {
  const opts = loadOptions();
  const on = opts.gestureEnabled !== false;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gesture-toggle";
  button.dataset.on = String(on);
  button.setAttribute("aria-pressed", String(on));
  button.title = t("home.gestureToggleHint");
  button.setAttribute("aria-label", t("home.gestureToggleLabel"));
  button.textContent = t(on ? "home.gestureToggleOn" : "home.gestureToggleOff");

  button.onclick = () => {
    opts.gestureEnabled = !on;
    saveOptions(opts);
    // Boot-time registration: the only way to change what was wired is a fresh page.
    location.reload();
  };
  return button;
}
