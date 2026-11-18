// The UI THEME — which war3skins.txt section the interface's chrome is decorated from.
//
// The game's own table names the sections it offers, in `[Main]`:
//
//     [Main]
//     Skins=Orc,Human,NightElf,Undead,Forsaken
//
// That line is the list the 3.0 client fills its theme picker from (the picker's labels are the
// `OPTIONS_THEME_*` strings in GlobalStrings.fdf), and each entry is exactly the section name
// that `FdfLibrary.decorate` and `MapViewer.skinPath` look a texture key up in. `[Forsaken]`
// ships its own console tiles in `UI\Console\Forsaken\`, so the five are five real looks rather
// than five names for one.
//
// By DEFAULT the interface follows the local player's race — that is WC3's own rule, an Orc
// player's console and dialogs are Orc-bordered — so `auto` is the option's default and is what
// every screen did before this setting existed. A chosen theme overrides it for the CONSOLE-side
// art: the console strip, the HUD's skinned widgets, and every in-game FDF panel (Esc menu,
// quest log, chat, allies, leaderboard, dialogs). The MUSIC playlists stay the local player's
// race (src/audio/sounds.ts `musicSkin`): a theme is what the interface looks like, not what
// the game sounds like.

import { loadOptions } from "./options";
import { parseWar3Skins, WAR3SKINS } from "./war3skins";
import type { DataSource } from "../vfs/types";

/** The `uiTheme` value that means "the local player's race", i.e. the game's own rule. */
export const UI_THEME_AUTO = "auto";

/** Section name → the GlobalStrings key that names it in the picker. A section the table lists
 *  but this map does not know is offered under its own name, which is what the engine's table
 *  effectively did for a skin it was handed (a custom/map skin). */
const THEME_LABEL: Readonly<Record<string, string>> = {
  Human: "UI_THEME_HUMAN",
  Orc: "UI_THEME_ORC",
  NightElf: "UI_THEME_NIGHTELF",
  Undead: "UI_THEME_UNDEAD",
  Forsaken: "UI_THEME_FORSAKEN",
};

/** The section the interface should be decorated from, given the local player's race section. */
export function uiThemeSkin(raceSection: string): string {
  const chosen = loadOptions().uiTheme;
  if (typeof chosen !== "string" || !chosen || chosen === UI_THEME_AUTO) return raceSection;
  return chosen;
}

/**
 * The picker's entries: "Follow your race" first, then the sections the install's own
 * `[Main] Skins` line lists, in its order.
 *
 * The list is read from the mounted install rather than hard-coded because the sections are the
 * INSTALL's: 1.30.4's war3skins has no `[Forsaken]` and no `[Main] Skins` line at all, and an
 * entry that resolves no art is worse than no entry. Without that line (the classic table), the
 * four race sections are offered, which is what the file itself has.
 */
export function uiThemeChoices(vfs: DataSource): Array<{ value: string; label: string }> {
  const bytes = vfs.rawBytes(WAR3SKINS);
  const skins = bytes ? parseWar3Skins(new TextDecoder("latin1").decode(bytes)) : new Map<string, Map<string, string>>();
  const listed = skins.get("Main")?.get("Skins");
  const sections = (listed ? listed.split(",") : ["Human", "Orc", "NightElf", "Undead"])
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    { value: UI_THEME_AUTO, label: "UI_THEME_AUTO" },
    ...sections.map((section) => ({ value: section, label: THEME_LABEL[section] ?? section })),
  ];
}
