import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import type { WebUiAssets } from "./assets";
import { ART, webUiAssets } from "./assets";
import { HdScreen, el } from "./screen";
import { loadOfficialStyle } from "./official";
import { backdrop, backButton, framedButton, officialMenu } from "./officialMenu";
import { openSystemMenu } from "./systemMenu";
import { applyHdTheme, cycleHdTheme, nextHdTheme, themeFace, themeTransition, themeVideo } from "./theme";
import { applyGameLocale, logoLocaleTag } from "./locale";
import { playFdfClick } from "../fdf/render";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";

export interface HdMainMenuHandlers {
  onSinglePlayer: () => void;
  onLan: () => void;
  /** Watch a saved replay (3.0 puts this on the front menu as its own entry). */
  onReplays: () => void;
  onOptions: () => void;
  onCredits: () => void;
  onQuit: () => void;
  /** The system menu's single-player plate: straight into each way a solo game starts. */
  onCampaign: () => void;
  onCustomCampaign: () => void;
  onCustomGame: () => void;
}

/**
 * The Reforged main menu (3.0), assembled the way `WebUI\index.html` assembles it.
 *
 * 3.0 does not draw its glue with FDF: the whole front end is a web app, and its main menu is a
 * 695x994 carved plate pinned to the right edge of the window, wearing two hanging chains, the
 * metal border-image, the wood texture inside it, and a column of framed buttons. `official.css`
 * carries that sheet's own geometry, so this file's job is only the DOM order the sheet expects
 * (`MainMenuHolder` → `MainMenuScreen` → `MainMenu` → `MainMenu-Wrapper` → logo / decorations /
 * navigation / `BaseFrame` / copyright) and wiring the buttons to this engine.
 *
 * The menu is zoomed by `innerHeight / 1080`, which is what 3.0's `GetScale()` does: the plate is
 * authored for a 1080-line screen and scales with the window rather than reflowing.
 */
export async function mountHdMainMenu(
  container: HTMLElement,
  vfs: DataSource,
  h: HdMainMenuHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  // The sheet's border-images/textures are blob URLs, so it cannot go in until they are read.
  await loadOfficialStyle(assets);
  // The mounted store's language, for the logo plate and the sheet's locale spacing rules.
  applyGameLocale();

  const screen = new HdScreen("hd-main");
  screen.element.classList.add("hd-official");
  const tft = !isRoc();
  if (tft) screen.element.classList.add("tft");

  void backdrop(screen, assets, ART.home, themeVideo());

  const menu = officialMenu(screen, { tft, assets });

  /** Advance the interface theme in place: the plate wears a class, the backdrop is one video,
   *  and 3.0's three-second wipe covers the swap (its logo click is locked for the same time). */
  let switching = false;
  const changeTheme = async (): Promise<void> => {
    if (switching) return;
    switching = true;
    playFdfClick();
    cycleHdTheme();
    logo.className = logoPlateClass(assets);
    applyHdTheme(screen.element);
    // The wipe starts as soon as its own bytes arrive — it is the cover for the swap, so the
    // new backdrop is fetched in parallel rather than holding the transition back. Both are
    // large films, and the first click pays for reading them out of the archive.
    const filmUrl = assets.url(themeVideo());
    const wipeUrl = await assets.url(themeTransition());
    if (wipeUrl && screen.element.isConnected) {
      const wipe = document.createElement("video");
      wipe.className = "hd-theme-transition";
      wipe.src = wipeUrl;
      wipe.muted = true;
      wipe.autoplay = true;
      wipe.playsInline = true;
      wipe.setAttribute("aria-hidden", "true");
      const done = (): void => wipe.remove();
      wipe.addEventListener("ended", done);
      screen.element.appendChild(wipe);
      void wipe.play().catch(done);
      // 3.0's wipe is three seconds; if a clip is longer (or `ended` never fires) the plate
      // must not stay covered, so the fallback outlives it by a wide margin.
      window.setTimeout(done, 6000);
    }
    const url = await filmUrl;
    const film = screen.element.querySelector<HTMLVideoElement>("video.hd-movie");
    if (url && film) {
      film.src = url;
      void film.play().catch(() => {});
    }
    // 3.0's LOGO_TRANSITION_TIMER: the next click is ignored until the wipe has finished.
    window.setTimeout(() => { switching = false; }, 3200);
    // Warm the NEXT face's wipe now, so that click's cover is already a blob URL.
    void assets.url(themeTransition(nextHdTheme()));
  };

  // The install's logo plate. It follows the GAME's language, not the engine's, so a `hdArt=de`
  // install shows the English "Reforged" logo whatever our menus speak; a zhCN/zhTW store uses
  // the localized plate the install ships (and the sheet's locale class). It is also the theme
  // switch: 3.0 advances the interface theme when the logo is clicked (GlueManager's
  // `mainMenuTheme`), swapping both the backdrop movie and the face the plate is cut from.
  const logo = el("div", logoPlateClass(assets));
  logo.setAttribute("role", "button");
  logo.setAttribute("aria-label", t("hd.changeTheme"));
  logo.tabIndex = 0;
  logo.addEventListener("click", () => void changeTheme());
  logo.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      void changeTheme();
    }
  });
  menu.wrap.insertBefore(logo, menu.nav);
  // Warm the first click's wipe in the background: the files are full WebM films, and the
  // click must start its cover at once rather than after reading it out of the archive. It is
  // delayed so the menu's own backdrop is read first.
  window.setTimeout(() => void assets.url(themeTransition(nextHdTheme())), 1500);

  menu.nav.append(
    framedButton(t("menu.singlePlayer"), h.onSinglePlayer),
    framedButton(t("hd.lan"), h.onLan),
    framedButton(t("hd.replays"), h.onReplays),
    framedButton(t("menu.options"), h.onOptions),
  );

  menu.wrap.appendChild(
    el(
      "div",
      "MainMenuScreen-Copyright",
      `© 2002–${new Date().getFullYear()} Blizzard Entertainment, Inc.`,
    ),
  );

  backButton(menu.holder, t("menu.quit"), h.onQuit, {
    onSystemMenu: () =>
      openSystemMenu(screen, vfs, {
        onOptions: h.onOptions,
        onCredits: h.onCredits,
        onQuit: h.onQuit,
        singlePlayer: {
          onCampaign: h.onCampaign,
          onCustomCampaign: h.onCustomCampaign,
          onCustomGame: h.onCustomGame,
        },
      }),
    systemMenuLabel: t("hd.menu"),
  });
  menu.rescale();

  // Reforged keeps its own chrome clean: language lives in Options → Language and the install
  // folder is chosen by the load gate, so the two engine corner links the FDF menu carries are
  // not drawn here.
  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    menu.dispose();
    dispose();
  };

  return screen.attach(container);
}

/**
 * The wordmark classes for the face the theme is on.
 *
 * 3.0's sheet asks for a localized plate on the TFT face (`tft_reforged-logo-zhCN.png`), but
 * its own store ships only the English TFT wordmark — the copied sheet's `url()` to that
 * missing file becomes a blank box, which is why the TFT and Classic TFT faces lost the logo.
 * When the localized file for the current face is absent, the element keeps only `War3Logo`
 * so the face's base wordmark (`tft_…` / `fk_…` / plain) shows instead. `applyHdTheme` adds
 * the face class afterwards.
 */
function logoPlateClass(assets: WebUiAssets): string {
  const tag = logoLocaleTag();
  if (!tag) return "War3Logo";
  const face = themeFace();
  const prefix = face === "tft" ? "tft_" : face === "fk" ? "fk_" : "";
  return assets.resolve(`WebUI\\Common\\${prefix}reforged-logo-${tag}.png`)
    ? `War3Logo War3Logo-${tag}`
    : "War3Logo";
}
