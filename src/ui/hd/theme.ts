// The 3.0 glue's INTERFACE THEME — the five faces the front end can wear.
//
// Reforged does not dress its menus in FDF, and the button that switches their look is the
// main menu's logo: clicking it advances `mainMenuTheme` by one and saves the choice as the
// gameplay background movie preference (`PREF_GAMEPLAY_BACKGROUND_MOVIE`,
// `WebUI\GlueManager.js`). The five backs are, in cycling order:
//
//     MAIN_MENU_BACKGROUNDS = ["ROC_MainMenu", "TFT_MainMenu",
//                              "ROC_MainMenu_SD", "TFT_MainMenu_SD", "FK_MainMenu"]
//
// The theme picks TWO things at once, which is why it is not just a video choice:
//
//   * the backdrop movie (`Webms\mainmenu*.webm`), and
//   * which art the frame is cut from — `themedClassName()` returns `tft` for themes 1/3 and
//     `fk` for theme 4, nothing for 0/2. So the plate's border-image, wood texture, chain
//     clasps, siderail and logo all swap with it.
//
// We keep the pick in localStorage: one process, one theme, exactly like 3.0's saved option.
// A fresh install starts on The Frozen Throne's back for HD and Reign of Chaos' for the RoC
// data line, which is what these menus showed before the theme existed.

import { isRoc } from "../../data/edition";
import { ART } from "./assets";

export type HdTheme = 0 | 1 | 2 | 3 | 4;

const STORAGE_KEY = "warcraft-open.hdTheme";

/** 3.0's five backs, in the order the logo click cycles them. */
const THEMES: ReadonlyArray<{ video: string; face: "" | "tft" | "fk" }> = [
  { video: ART.mainMenuVideoRoc, face: "" }, //    0  ROC_MainMenu
  { video: ART.mainMenuVideo, face: "tft" }, //    1  TFT_MainMenu
  { video: ART.mainMenuVideoSd, face: "" }, //     2  ROC_MainMenu_SD
  { video: ART.mainMenuVideoTftSd, face: "tft" }, // 3  TFT_MainMenu_SD
  { video: ART.mainMenuVideoFk, face: "fk" }, //   4  FK_MainMenu
];

function defaultTheme(): HdTheme {
  return isRoc() ? 0 : 1;
}

function stored(): HdTheme {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw === null ? NaN : Number(raw);
    return n >= 0 && n <= 4 ? (n as HdTheme) : defaultTheme();
  } catch {
    return defaultTheme();
  }
}

let current: HdTheme = stored();

/** The theme in force. */
export function hdTheme(): HdTheme {
  return current;
}

/** The theme's art face: `""` (base), `"tft"` or `"fk"` — 3.0's `themedClassName`. */
export function themeFace(theme: HdTheme = current): "" | "tft" | "fk" {
  return THEMES[theme].face;
}

/** The theme's main-menu backdrop movie. */
export function themeVideo(theme: HdTheme = current): string {
  return THEMES[theme].video;
}

/** The wipe 3.0 plays while the new theme fades in (`MAIN_MENU_TRANSITIONS`, keyed by theme). */
export function themeTransition(theme: HdTheme = current): string {
  switch (theme) {
    case 0: return ART.themeTransitionRoc;
    case 1: return ART.themeTransitionTft;
    case 2: return ART.themeTransitionRocSd;
    case 3: return ART.themeTransitionTftSd;
    case 4: return ART.themeTransitionFk;
  }
}

/** Switch and remember. */
export function setHdTheme(theme: HdTheme): void {
  current = theme;
  try {
    localStorage.setItem(STORAGE_KEY, String(theme));
  } catch {
    /* not remembered — still this session's pick */
  }
}

/** The logo click: advance one face and return the new theme. */
export function cycleHdTheme(): HdTheme {
  setHdTheme(((current + 1) % THEMES.length) as HdTheme);
  return current;
}

/** What a logo click would land on — for warming that face's transition film before it is
 *  needed, since the archives hold the wipes as full-size WebM files. */
export function nextHdTheme(): HdTheme {
  return ((current + 1) % THEMES.length) as HdTheme;
}

/**
 * Stamp the theme's face onto a mounted screen.
 *
 * The face lives on the same elements the sheet already themes: the plate's `frame`,
 * `background-texture`, chains and the logo carry `tft` on the TFT backs and `fk` on the
 * Forsaken one, and the screen element itself carries it for its `.hd-official.tft …` rules.
 * Screens are built with the edition's default face, so this only has to correct the elements
 * once the theme differs — and it runs again after a logo click.
 */
export function applyHdTheme(root: HTMLElement): void {
  const face = themeFace();
  const tft = face === "tft";
  const fk = face === "fk";
  const parts = [
    ".frame",
    ".background-texture",
    ".left-chain",
    ".right-chain",
    ".War3Logo",
    ".War3Logo-zhCN",
    ".War3Logo-zhTW",
    ".Persistent-Left-Frame",
    ".Persistent-Right-Frame",
  ].join(",");
  for (const node of root.querySelectorAll<HTMLElement>(parts)) {
    node.classList.toggle("tft", tft);
    node.classList.toggle("fk", fk);
  }
  root.classList.toggle("tft", tft);
  root.classList.toggle("fk", fk);
}
