import { currentLocale, t } from "../i18n";
import { flavor } from "../data/flavor";
import { themeFace } from "./hd/theme";

/**
 * The install's own wordmark. Reforged's comes from the local CASC by
 * `tools/extract-boot-logo.mjs`, the classic one by `tools/extract-boot-classic.mjs` — both into
 * git-ignored folders, because the project ships no Blizzard art. Only the Chinese Reforged
 * plate and the three English faces exist in that store, so Chinese always wears the base plate
 * while English follows the theme; the classic screen always wears the TFT wordmark, the client
 * 1.30.4 actually is.
 *
 * Hang it off the build's base: the website serves this page under `/play/`, and a bare `/boot/`
 * would ask the SITE for the picture instead of the game.
 */
function logoSrc(classic: boolean): string {
  const base = import.meta.env.BASE_URL;
  if (classic) return `${base}boot/classic/War3xLogo.png`;
  if (currentLocale() === "zhCN") return `${base}boot/webui/reforged-logo-zhCN.png`;
  const face = themeFace();
  const prefix = face === "fk" ? "fk_" : face === "tft" ? "tft_" : "";
  return `${base}boot/webui/${prefix}reforged-logo.png`;
}

/**
 * The progress screen a LAUNCH puts up.
 *
 * Mounting an install is a fetch and a parse that can run to a minute on a 3.0 store, and every
 * screen before the main menu — the launcher's hero, a freshly opened game window — is the wrong
 * thing to look at while it happens. This covers the wait in the game's own loading language:
 * Reforged's frozen battlefield, a forged rail, and a gold bar fed by `progress()`.
 *
 * It is ONE screen across two callers, which is why it lives here rather than in either:
 *
 *   * the launcher (`ui/home.ts`) mounts it on a Launch press, in the window or tab that is
 *     actually becoming the game; and
 *   * the `?dev` boot (`dev/devBoot.ts`) mounts it while a scripted boot fetches the install,
 *     where before it there would be a black canvas for the whole fetch.
 *
 * Whoever mounts it, the dismissal belongs to the main menu: `main.ts` closes it once the menu
 * is standing (`showMenu`), so the bar does not disappear into a black frame between the mount
 * finishing and the menu being built.
 */
export interface BootSplash {
  /** `fraction` is 0..1 and only ever moves forward; `message` replaces the caption. */
  progress(fraction: number, message?: string): void;
  dismiss(): void;
}

/** The screen currently up, if any — one at a time, whoever asked for it. */
let current: BootSplash | null = null;

export function mountBootSplash(): BootSplash {
  current?.dismiss();

  // Two faces for the two data lines: the classic client waits on its own parchment loading
  // screen, wordmark and loading rail, the Reforged one on its frozen battlefield and forged
  // plate. `flavor()` already knows which client this is — it reads `?flavor=` at module load,
  // before either the launcher or the `?dev` boot mounts this screen.
  const classic = flavor() === "sd";

  const root = document.createElement("div");
  root.className = classic ? "ow-boot ow-boot--sd" : "ow-boot";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");

  const card = document.createElement("div");
  card.className = "ow-boot-card";
  const logo = document.createElement("img");
  logo.className = "ow-boot-logo";
  logo.alt = "";
  logo.src = logoSrc(classic);
  // A fresh clone has no extracted art (it is never committed); the drawn wordmark keeps the
  // splash readable there.
  const title = document.createElement("h1");
  title.className = "ow-boot-title";
  title.textContent = t("app.title");
  title.hidden = true;
  logo.addEventListener("error", () => {
    logo.remove();
    title.hidden = false;
  });
  const message = document.createElement("p");
  message.className = "ow-boot-message";
  message.textContent = t("gate.loading");
  const bar = document.createElement("div");
  bar.className = "ow-boot-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  const track = document.createElement("div");
  track.className = "ow-boot-track";
  const fill = document.createElement("span");
  fill.className = "ow-boot-fill";
  track.appendChild(fill);
  bar.appendChild(track);
  // The bar wears its own word — `LOADING…` in Loading.fdf — so the phase line lives inside
  // the rail rather than above it; the classic face sets it above, as its loading screen does.
  bar.appendChild(message);
  card.append(logo, title, bar);
  root.append(card);
  document.body.appendChild(root);

  let value = 0;
  let closed = false;

  const progress = (fraction: number, text?: string): void => {
    if (closed) return;
    const next = Math.max(value, Math.min(1, Number.isFinite(fraction) ? fraction : value));
    value = next;
    fill.style.width = `${Math.max(1.5, next * 100).toFixed(1)}%`;
    bar.setAttribute("aria-valuenow", String(Math.round(next * 100)));
    if (text) message.textContent = text;
  };

  const api: BootSplash = {
    progress,
    dismiss: () => {
      if (closed) return;
      closed = true;
      if (current === api) current = null;
      root.classList.add("is-gone");
      window.setTimeout(() => root.remove(), 520);
    },
  };

  progress(0.02, t("boot.checking"));
  current = api;
  return api;
}

/** The screen that is up, for a caller that wants to feed it without holding the handle. */
export function progressBootSplash(fraction: number, message?: string): void {
  current?.progress(fraction, message);
}

/** Take it down. Safe when nothing is up — every path that might have mounted one calls it. */
export function dismissBootSplash(): void {
  const up = current;
  current = null;
  up?.dismiss();
}
