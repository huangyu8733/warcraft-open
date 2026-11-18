// The language of the mounted GAME DATA — 3.0's `_Locales/<xxXX>.w3mod` overlay.
//
// This is not the engine's own UI language (`i18n/index.ts`): the front end can be translated
// into two languages, while the strings, voices and localized art the match uses come out of
// the installed content. 3.0 files those under `_Locales/<xxXX>.w3mod` and ONE install can
// carry several modules, so there is no per-language install folder to pick: `casc.ts` reads
// the module matching the app's language (Chinese by default) and this value mirrors it.
// Changing it means mounting again, which is why the language switch reloads the page.

let current = "";

/** Remember which locale the CASC mount resolved (called once, by `CascDataSource.open`). */
export function setGameLocale(locale: string): void {
  current = locale;
}

/** The mounted game data's locale, e.g. `"zhCN"`; empty when the source has no locales (MPQ). */
export function gameLocale(): string {
  return current;
}
