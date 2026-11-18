// The front end's UI language — the locale the glue is DRAWN in.
//
// 3.0 dresses its glue with the locale the player picked: the main menu's logo has a Simplified
// and a Traditional Chinese plate (`WebUI\Common\reforged-logo-zhCN.png` and `-zhTW.png`, plus
// their TFT variants), and a handful of CSS rules space buttons for CJK and the longer Latin
// translations (`.zhCN .Primary-Button …`, `.ruRU …`). The reference client gets that class from
// its native host. The mounted DATA locale (vfs/gameLocale.ts) may differ — an install usually
// carries one `_Locales` module, while the picker offers twelve — so the class and the logo
// follow the UI language, not the data language, or a German UI over a Chinese install would
// wear the Chinese wordmark.

import { currentLocale } from "../../i18n";

/** The locale modules a 3.0 store can carry (the ones the sheet has rules for). */
const LOCALE_CLASSES = [
  "enUS", "deDE", "esES", "esMX", "frFR", "itIT",
  "koKR", "plPL", "ptBR", "ruRU", "zhCN", "zhTW",
] as const;

/**
 * Put the mounted locale on `<html>` (`class="zhCN"`), which is the ancestor the sheet's
 * locale rules expect. Idempotent: the class list is rewritten from the current locale, so a
 * later mount cannot leave two languages behind. Returns the locale it stamped (or "").
 */
export function applyGameLocale(): string {
  const locale = currentLocale();
  const root = document.documentElement;
  for (const l of LOCALE_CLASSES) root.classList.toggle(l, l === locale);
  return locale;
}

/**
 * The logo plate's locale class. 3.0's sheet declares `.War3Logo-zhCN` / `.War3Logo-zhTW`
 * beside `.War3Logo`, so the element keeps BOTH classes — the base one supplies the 360x191
 * box, the locale one supplies the picture (and the theme's `tft`/`fk` class is added on top by
 * `applyHdTheme`).
 */
export function logoLocaleClass(): string {
  const locale = logoLocaleTag();
  return locale ? `War3Logo-${locale}` : "War3Logo";
}

/** The locale tag the install may carry a localized plate for, or "" for the base (English)
 *  wordmark. The sheet names the files `reforged-logo-<tag>.png`, so the tag is also what the
 *  caller needs to test whether that face's localized art is actually shipped. */
export function logoLocaleTag(): "zhCN" | "zhTW" | "" {
  const locale = currentLocale();
  if (locale === "zhCN") return "zhCN";
  if (locale === "zhTW") return "zhTW";
  return "";
}
