import { SOUND_GROUP, type SoundBoard } from "../audio/sounds";
import { installFocusMute, windowFocused } from "../audio/focusMute";

// The game options (issue #81) — the settings the Options screen exposes, persisted to
// localStorage. The screen itself is built from the real UI\FrameDef\Glue\OptionsMenu.fdf
// (src/ui/fdfOptions.ts); THIS module is the model behind it: the list of options, their
// defaults, load/save, and the applier that pushes the audio ones onto the live SoundBoard.
//
// One table, `OPTION_DEFS`, is the single source of truth: each entry pairs an option KEY
// with the FDF FRAME that drives it and the kind of control it is, so the screen can bind
// every widget generically instead of naming each one twice. Defaults match Warcraft III's.
//
// Not every option the FDF carries maps to something this engine does — the resolution list is
// meaningless to a client that renders into a fixed 16:9 buffer (ui/stage.ts), and two of the
// video rows describe features we do not have. Those are kept as remembered UI state rather than
// faked behaviour, and are marked `applied:false` with the reason next to them. The rest have a
// live backend: the Sound panel through `applyAudioOptions` here, the Video panel through
// `applyVideoOptions` in render/videoQuality.ts, which is also where each video setting's
// meaning (and which of its numbers are the game's) is written down, and the Gameplay panel's
// two health-bar rows through `applyHealthBarOptions` in render/worldOverlays.ts — the module
// that draws the bars they describe — its "Hotkeys:" row through `applyHotkeyOptions` in
// data/hotkeys.ts, which is where the three keyboard schemes are written down, and its two
// scroll sliders through `applyScrollOptions` in render/scrollOptions.ts.
//
// The table serves BOTH options screens: the glue one the main menu opens and the in-game one
// behind F10 → Options (ui/escOptions.ts), which is the same settings out of the game's own
// `UI\FrameDef\UI\EscMenuOptionsPanel.fdf`. A row whose two files name it differently carries
// an `escFrame`; a row only one of the two panels has simply never binds on the other.

/** The kind of control an option is bound to, which decides how its value is read/written. */
export type OptionKind = "bool" | "range" | "choice" | "text";

export interface OptionDef {
  key: string;
  /** The FDF frame name the control lives under (CheckBox / Slider / PopupMenu / EditBox). */
  frame: string;
  /** The KEY of the row's caption in `UI\FrameDef\GlobalStrings.fdf` (or our override's table).
   *  The FDF screens read it off the Text frame beside the control; the HD options screen has no
   *  FDF tree, so it resolves this through the install's own string table. A row without one is
   *  not drawn by the HD screen either — it is a row the classic panel has never carried. */
  cap?: string;
  /** The same control's frame name on the IN-GAME panel, when `UI\FrameDef\UI\EscMenuOptionsPanel.fdf`
   *  spells it differently from the glue screen's `UI\FrameDef\Glue\OptionsMenu.fdf` (ui/escOptions.ts).
   *  Most rows need none — the two files name the same row the same way, which is how the two
   *  screens end up being one table. A row the in-game panel does not carry at all needs none
   *  either: its frame is simply not in that tree and binding it is a no-op. */
  escFrame?: string;
  kind: OptionKind;
  /** The Options panel it sits on — used to bind and to switch tabs. */
  panel: "gameplay" | "video" | "sound" | "input" | "graphics";
  /** Default value: boolean for bool, 0–100 (or `min`–`max`) for range, a choice value for choice,
   *  string for text. */
  def: boolean | number | string;
  /** `range` options: the slider's own bounds and step. Absent = 0–100 in steps of 1, which is
   *  what every row the 2003 panel carries uses. */
  min?: number;
  max?: number;
  step?: number;
  /** `choice` options: the value/label pairs. Labels are GlobalStrings keys resolved by the
   *  screen (`LOW_MODELS`, `HIGH_PARTICLES`, `OFF`/`ON`, …). Empty for the dropdowns WC3 fills at
   *  runtime (resolution) — those stay empty and disabled, having nothing to
   *  offer us. */
  choices?: Array<{ value: string; label: string }>;
  /** False when the option is remembered but nothing in the engine reads it yet. Documented so
   *  a future feature knows the value is already there, and so the screen can dim it if wanted. */
  applied?: boolean;
}

// The three-rung dropdowns each have their OWN label keys — the FDF spells the MenuItems out
// per row (`LOW_MODELS`/`MEDIUM_MODELS`/`HIGH_MODELS`, `LOW_ANIM`…, and so on) and GlobalStrings
// gives every one of them the same three words. There is no generic `LOW`/`MEDIUM`/`HIGH` in
// GlobalStrings at all, so a shared table left every video dropdown showing its raw key.
const quality = (suffix: string) => [
  { value: "low", label: `LOW_${suffix}` },
  { value: "medium", label: `MEDIUM_${suffix}` },
  { value: "high", label: `HIGH_${suffix}` },
];
const ON_OFF = [
  { value: "off", label: "OFF" },
  { value: "on", label: "ON" },
];

/**
 * What the Resolution dropdown offers — the size of the buffer the game is DRAWN into.
 *
 * This is the one list WC3 built at runtime rather than writing into the FDF (the `MENU` frame
 * under `ResolutionMenu` is empty in the file), because it enumerated the display modes the
 * hardware would give it. A browser has no display modes: the page renders into a canvas and CSS
 * scales it into the window. So the analogue is the ladder of buffer sizes, and the frame it is
 * scaled into is unchanged — which is why every rung here is named EXACTLY 16:9. The stage is
 * at most 16:9 (ui/stage.ts: a wider one quietly hands the player more map than the real game
 * gives), and a narrower one — a 4:3 or 16:10 screen — draws the rung's HEIGHT at its own
 * aspect (render/videoQuality.ts `renderSize`), so a rung names what a 16:9 screen draws and
 * how many lines every other one does. A 4:3 rung off the 2003 list would name a width that
 * only some screens draw.
 *
 * Ascending, as the game's own list was. Labels are plain text rather than GlobalStrings keys —
 * there are none for these, for the same reason the list was built at runtime.
 */
/**
 * What the "Healthbars:" pulldown offers (issue #141) — how the bar floating over every unit
 * is COLOURED. Not a WC3 row: the 2003 options screen has no such setting, so the frame comes
 * from `src/overrides/ui/OptionsMenu.fdf` and the labels from our GlobalStrings layer.
 *
 *  · `default` — WC3's own bar: one green slab that turns yellow past 60% lost and red past
 *    70%, the same for your units, an ally's and an enemy's.
 *  · `team` — the bar is the OWNER's colour and does not shift as it drains, so which player
 *    a body belongs to is readable at a glance from the bar alone (Reforged's "Team Colored
 *    Health Bars"). The colour follows the Ally Color Mode, because it is the same question
 *    the body itself is painted by — see render/worldOverlays.ts.
 */
const HEALTH_BAR_STYLES = [
  { value: "default", label: "DEFAULT_HEALTHBARS" },
  { value: "team", label: "TEAM_COLORED_HEALTHBARS" },
];

/**
 * What the "Hotkeys:" pulldown offers (issue #142) — which KEY presses a command button.
 * Another row of ours on a frame of ours, directly under the health-bar pair it closes the
 * panel with. What each mode means is in data/hotkeys.ts, which is what reads this value.
 */
const HOTKEY_MODES = [
  { value: "legacy", label: "HOTKEYS_LEGACY" },
  { value: "grid", label: "HOTKEYS_GRID" },
  { value: "custom", label: "HOTKEYS_CUSTOM" },
];

const RESOLUTIONS = [
  { value: "800x450", label: "800 x 450" },
  { value: "1024x576", label: "1024 x 576" },
  { value: "1280x720", label: "1280 x 720" },
  { value: "1600x900", label: "1600 x 900" },
  { value: "1920x1080", label: "1920 x 1080" },
  { value: "2560x1440", label: "2560 x 1440" },
];

// The Reforged-only rows below carry the WebUI's own GlobalStrings keys
// (`_retail_/webui/gluemanager.js`), so the HD sheet resolves the same words Blizzard's own
// 3.0 screen does. A classic install has none of them; the HD screen falls back to
// src/i18n's `opt.*` table in that case (ui/hd/options.ts `strOpt`).
const WINDOW_MODES = [
  { value: "windowed", label: "WINDOW_MODE_WINDOWED" },
  { value: "borderless", label: "WINDOW_MODE_WINDOWED_FULLSCREEN" },
  { value: "fullscreen", label: "WINDOW_MODE_FULLSCREEN" },
];
const FOLIAGE_QUALITY = [
  { value: "off", label: "OFF" },
  { value: "low", label: "LOW" },
  { value: "medium", label: "MEDIUM" },
  { value: "high", label: "HIGH" },
];
const CONFINEMENT = [
  { value: "off", label: "OFF" },
  { value: "on", label: "ON" },
  { value: "auto", label: "OPTION_SETTING_AUTO" },
];
const GAME_SPEEDS = [
  { value: "slow", label: "SLOW" },
  { value: "normal", label: "NORMAL" },
  { value: "fast", label: "FAST" },
];
const MUSIC_OVERRIDES = [
  { value: "default", label: "OPTION_MUSIC_OVERRIDE_DEFAULT" },
  { value: "classic", label: "OPTION_MUSIC_OVERRIDE_CLASSIC" },
];
const ART_CATEGORIES = [
  { key: "artEnvironment", frame: "AddonEnvironmentCheckBox", cap: "PREF_REFORGED_ADDONS_ENVIRONMENT" },
  { key: "artUnits", frame: "AddonUnitsCheckBox", cap: "PREF_REFORGED_ADDONS_UNITS" },
  { key: "artHeroes", frame: "AddonHeroesCheckBox", cap: "PREF_REFORGED_ADDONS_HEROES" },
  { key: "artBuildings", frame: "AddonBuildingsCheckBox", cap: "PREF_REFORGED_ADDONS_BUILDINGS" },
  { key: "artIcons", frame: "AddonIconsCheckBox", cap: "PREF_REFORGED_ADDONS_ICONS" },
  { key: "artVfx", frame: "AddonVfxCheckBox", cap: "PREF_REFORGED_ADDONS_VFX" },
  { key: "artOldEnvironment", frame: "AddonEnvOldCheckBox", cap: "PREF_REFORGED_ADDONS_ENVOLD" },
] as const;

// Ordered by panel, then by the FDF's own top-to-bottom order.
export const OPTION_DEFS: readonly OptionDef[] = [
  // --- Gameplay ---
  // The two scroll sliders and the switch between them, live through `applyScrollOptions`
  // (render/scrollOptions.ts) — which is also where the only invented number on this panel is
  // written down and justified: what a notch MEANS is engine-internal and in no game file, so
  // the middle of either slider is the speed Warcraft Open has always panned at.
  { key: "mouseScrollSpeed", frame: "MouseScrollSlider", cap: "COLON_MOUSE_SCROLL", kind: "range", panel: "gameplay", def: 50 },
  { key: "mouseScrollDisable", frame: "MouseScrollDisableCheckBox", escFrame: "MouseScrollDisable", cap: "GAMEPLAY_MOUSE_SCROLL_DISABLE", kind: "bool", panel: "gameplay", def: false },
  { key: "keyScrollSpeed", frame: "KeyScrollSlider", cap: "COLON_KEYBOARD_SCROLL", kind: "range", panel: "gameplay", def: 50 },
  // Four rows the game had here are GONE (issue #142), and the panel is shorter for it. Three
  // of them — Enhanced Tooltips, the Subgroup order modifier key and Enable formation movement
  // toggle — are simply how Warcraft Open behaves: all three are what a player wants on, none of
  // them was ever a question this engine asked (they were remembered and unread, `applied:
  // false`), and a setting whose only honest value is ON is not a setting. The fourth, "Custom
  // Keyboard Shortcuts", is not retired so much as PROMOTED: a checkbox that turns
  // CustomKeys.txt on is one of three answers to "which keys?", which is the `hotkeys` row at
  // the bottom of this panel.
  //
  // Issue #142 also REORDERS what is left: the two rows that are about the match itself sit
  // above the three that are about the screen, so the health bars and the keyboard read as one
  // block at the bottom.
  // Live since issue #158: every match's replay is also kept under its own name in the replay
  // folder's `Autosaved\` — the game's own AUTOSAVE_REPLAY_INFO, "This option will automatically
  // save replays to the replay/autosaved folder." (`autosaveReplay()`, MapViewerScene.closeReplay).
  { key: "autosaveReplay", frame: "AutosaveReplayCheckBox", cap: "AUTOSAVE_REPLAY", kind: "bool", panel: "gameplay", def: true },
  // "Share Replays" (issue #158) — OURS, on the same row (src/overrides/ui/OptionsMenu.fdf). The
  // player's consent to two things: their finished replays going to Warcraft Open's own collection
  // (game/replayUpload.ts), and their own camera, selections and cursor being recorded into the
  // replays of the matches they play (game/inputTrack.ts). ON unless turned off — the developer's
  // call, so that the matches people actually play can be studied — and read through
  // `shareReplays()`.
  { key: "shareReplays", frame: "ShareReplaysCheckBox", cap: "SHARE_REPLAYS", kind: "bool", panel: "gameplay", def: true },
  // Issue #124. The first gameplay option with a live backend: it is the DEFAULT value of the
  // Custom Game screen's "Computer+ (Improved AI)" switch (ui/fdfSkirmish.ts), so ticking it
  // here decides which AI a match starts with. Its frame is not the game's — no 2003 UI file
  // has a row for a second melee AI — it comes from `src/overrides/ui/OptionsMenu.fdf`, which
  // is also where the Game Port and Chat Support rows that used to sit under this one go.
  //
  // ON by default: Computer+ is the AI we want a new player to meet (and the only one that plays
  // Extreme Candy War at all — src/ai/plus/candy/). See `loadOptions` for the stored `false` an
  // older store carries without anybody having chosen it.
  { key: "computerPlusDefault", frame: "ComputerPlusDefaultCheckBox", cap: "COMPUTER_PLUS_DEFAULT", kind: "bool", panel: "gameplay", def: true },
  // Issue #141. ON by default, and live: `applyHealthBarOptions` (render/worldOverlays.ts)
  // is what reads it. The game's own HEALTH_BARS_INFO says what it means and what ALT does to
  // it — "This option will always show unit and building health bars. While this option is
  // enabled, holding down the ALT key will temporarily hide these health bars."
  { key: "healthBars", frame: "HealthBarsCheckBox", cap: "HEALTH_BARS", kind: "bool", panel: "gameplay", def: true },
  // …and what those bars are COLOURED like (see HEALTH_BAR_STYLES). A row of ours, on a frame
  // of ours, directly under the checkbox it qualifies.
  { key: "healthBarStyle", frame: "HealthBarStyleMenu", escFrame: "EscHealthBarStyleMenu", cap: "COLON_HEALTHBARS", kind: "choice", panel: "gameplay", def: "default", choices: HEALTH_BAR_STYLES },
  // …and which KEY presses a command button (issue #142). Live, through `applyHotkeyOptions`
  // in data/hotkeys.ts, which is where the three rungs are written down.
  { key: "hotkeys", frame: "HotkeysMenu", escFrame: "EscHotkeysMenu", cap: "COLON_HOTKEYS", kind: "choice", panel: "gameplay", def: "legacy", choices: HOTKEY_MODES },
  // …and whether that key is PRINTED on the button, in the corner box the game already stamps a
  // quantity into (`.hud-count-badge`). Not a WC3 row — the 2003 card shows its key only inside
  // the tooltip — so it is ours, on a frame of ours, under the row whose answer it prints. ON by
  // default, and live through the same `applyHotkeyOptions`.
  { key: "showHotkeys", frame: "ShowHotkeysCheckBox", cap: "SHOW_HOTKEYS_ON_BUTTONS", kind: "bool", panel: "gameplay", def: true },
  // "UI Theme:" — which war3skins section the interface's chrome is decorated from. Not a WC3
  // row (the game ties the skin to your race, with no control anywhere), so the frame comes from
  // `src/overrides/ui/OptionsMenu.fdf` and the labels from our GlobalStrings layer.
  //
  // `auto` is WC3's own rule and the default: follow the local player's race. A chosen section
  // overrides that for the in-game interface — the console strip, the HUD's skinned widgets, the
  // Esc menu, quest log, chat, allies, leaderboard and dialogs (src/data/uiTheme.ts, which also
  // says why the music playlists stay the race's). The picker's entries come from the INSTALL's
  // `[Main] Skins` line at bind time, so a classic install simply offers the four races; the
  // static list below is only the fallback shape of the option.
  { key: "uiTheme", frame: "UiThemeMenu", cap: "COLON_UI_THEME", kind: "choice", panel: "gameplay", def: "auto", choices: [
    { value: "auto", label: "UI_THEME_AUTO" },
    { value: "Human", label: "UI_THEME_HUMAN" },
    { value: "Orc", label: "UI_THEME_ORC" },
    { value: "NightElf", label: "UI_THEME_NIGHTELF" },
    { value: "Undead", label: "UI_THEME_UNDEAD" },
    { value: "Forsaken", label: "UI_THEME_FORSAKEN" },
  ] },
  // "Voice Control": push-to-talk commands on the "." key (src/voice/). Not a WC3 row — nothing
  // in the 2003 game listens — so frame, label and behaviour are all ours. OFF by default: it
  // opens the microphone, and it needs a speech model the player has to fetch first (until it is
  // here the row is a download button instead — ui/voiceOptions.ts). Live through
  // `applyVoiceOptions`.
  { key: "voiceControl", frame: "VoiceControlCheckBox", cap: "VOICE_CONTROL", kind: "bool", panel: "gameplay", def: false },

  // --- The Reforged Gameplay rows -------------------------------------------------------
  // These exist on Blizzard's 3.0 Gameplay tab and had no row here. Where this engine has the
  // thing they describe, the consumer is named; where it does not, `applied:false` keeps the
  // row visible and GRAY instead of pretending (`ui/hd/options.ts`).
  //
  // Hero bars: the gold level frame and its printed level are two separate switches in 3.0
  // (`worldOverlays.ts` reads both per frame).
  { key: "heroFrames", frame: "HeroFramesCheckBox", cap: "HERO_STATUS_BAR", kind: "bool", panel: "gameplay", def: true },
  { key: "heroLevel", frame: "HeroLevelCheckBox", cap: "SHOW_HERO_LEVEL", kind: "bool", panel: "gameplay", def: true },
  // Group orders: ON keeps the concentric-ring move (game/formations.ts); OFF sends every unit
  // to the clicked point (game/rts.ts).
  { key: "formationMovement", frame: "FormationMovementCheckBox", cap: "ENABLE_FORMATION_MOVEMENT", kind: "bool", panel: "gameplay", def: true },
  // The seconds printed inside a command-card cooldown sweep (ui/hud.ts).
  { key: "cooldownNumbers", frame: "CooldownNumbersCheckBox", cap: "SHOW_COOLDOWN_TIMER", kind: "bool", panel: "gameplay", def: true },
  // The `3/5` floated over a worked gold mine (render/worldOverlays.ts syncCrewLabels).
  { key: "goldMineCounter", frame: "GoldMineCounterCheckBox", cap: "OPTIONS_GOLDMINE_UNIT_COUNTER", kind: "bool", panel: "gameplay", def: true },
  // The interface's own scale (`.hud` in style.css). 100 = today's size.
  { key: "hudScale", frame: "HudScaleSlider", cap: "HUD_SCALE", kind: "range", panel: "gameplay", def: 100, min: 50, max: 150, step: 5 },
  // The match clock under the medallion. ON is the behaviour the HUD already had.
  { key: "showTimeElapsed", frame: "TimeElapsedCheckBox", cap: "HUD_TIME_ELAPSED", kind: "bool", panel: "gameplay", def: true },
  // The performance strip (ui/metrics.ts). FPS defaults OFF; ping is shown wherever the strip
  // is, and APM is the reaction of a player who asked for it.
  { key: "displayFps", frame: "DisplayFpsCheckBox", cap: "OPTIONS_GP_FPS", kind: "bool", panel: "gameplay", def: false },
  { key: "displayPing", frame: "DisplayPingCheckBox", cap: "OPTIONS_GP_PING", kind: "bool", panel: "gameplay", def: true },
  { key: "displayApm", frame: "DisplayApmCheckBox", cap: "OPTIONS_GP_APM", kind: "bool", panel: "gameplay", def: false },
  { key: "gameSpeed", frame: "GameSpeedMenu", cap: "GAME_SPEED", kind: "choice", panel: "gameplay", def: "normal", choices: GAME_SPEEDS },
  // Chat and system lines. The four scopes are enforced where a line is SENT/RECEIVED
  // (game/chat.ts), so turning one off silences that channel in both directions.
  { key: "opponentChat", frame: "OpponentChatCheckBox", cap: "OPPONENT_CHAT_ENABLED", kind: "bool", panel: "gameplay", def: true },
  { key: "teamChat", frame: "TeamChatCheckBox", cap: "TEAM_CHAT_ENABLED", kind: "bool", panel: "gameplay", def: true },
  { key: "observerChat", frame: "ObserverChatCheckBox", cap: "OBSERVER_CHAT_ENABLED", kind: "bool", panel: "gameplay", def: true },
  { key: "globalChat", frame: "GlobalChatCheckBox", cap: "GLOBAL_CHAT_ENABLED", kind: "bool", panel: "gameplay", def: true },
  { key: "gameInfoMessages", frame: "GameInfoMessagesCheckBox", cap: "OPTION_GAME_INFO_MESSAGES", kind: "bool", panel: "gameplay", def: true },
  // "Young players" content filter is not implemented; the profanity filter below is.
  { key: "teenFilter", frame: "TeenFilterCheckBox", cap: "OPTION_TEEN", kind: "bool", panel: "gameplay", def: false, applied: false },
  { key: "profanityFilter", frame: "ProfanityFilterCheckBox", cap: "OPTION_PROFANITY", kind: "bool", panel: "gameplay", def: false },
  // Double-clicking one of your workers selects every worker of that type (mapViewer.ts).
  { key: "peonDoubleTapFocus", frame: "PeonDoubleTapFocusCheckBox", cap: "OPTION_PEON_DOUBLETAP_FOCUS", kind: "bool", panel: "gameplay", def: true },
  // Rows 3.0 carries but this renderer/HUD has no counterpart for. Kept visible, grayed.
  { key: "enhancedTooltips", frame: "EnhancedTooltipsCheckBox", cap: "ENHANCED_TOOLTIPS", kind: "bool", panel: "gameplay", def: true, applied: false },
  { key: "subgroupOrder", frame: "SubgroupOrderCheckBox", cap: "SUBGROUP_MODIFIER", kind: "bool", panel: "gameplay", def: true, applied: false },
  { key: "denyIcon", frame: "DenyIconCheckBox", cap: "SHOW_DENY_ICON", kind: "bool", panel: "gameplay", def: true, applied: false },
  { key: "hudSidePanels", frame: "HudSidePanelsCheckBox", cap: "HUD_SIDEPANELS", kind: "bool", panel: "gameplay", def: false, applied: false },
  { key: "cinePortraits", frame: "CinePortraitsCheckBox", cap: "OPTIONS_SHOW_CINE_PORTRAITS", kind: "bool", panel: "gameplay", def: true, applied: false },
  { key: "sdCampaignScreens", frame: "SdCampaignScreensCheckBox", cap: "OPTIONS_SD_CAMPAIGN_SCREENS", kind: "bool", panel: "gameplay", def: false, applied: false },
  { key: "advancedObserverUI", frame: "AdvancedObserverCheckBox", cap: "OBSERVER_OPTION_BTN", kind: "bool", panel: "gameplay", def: false, applied: false },
  { key: "useSkins", frame: "UseSkinsCheckBox", cap: "OPTION_USE_SKINS", kind: "bool", panel: "gameplay", def: true, applied: false },
  { key: "classicCursor", frame: "ClassicCursorCheckBox", cap: "OPTION_CLASSIC_CURSOR", kind: "bool", panel: "gameplay", def: false, applied: false },
  { key: "oldTerrain", frame: "OldTerrainCheckBox", cap: "OPTIONS_OLD_TERRAIN", kind: "bool", panel: "gameplay", def: false, applied: false },
  // Camera. The numbers are camera distances in world units, the same ladder mapViewer.ts uses;
  // `enhancedZoom` widens its bounds, and the two sliders move the opening and far stops.
  { key: "enhancedZoom", frame: "EnhancedZoomCheckBox", cap: "ENABLE_IMPROVED_ZOOM", kind: "bool", panel: "gameplay", def: false },
  { key: "defaultZoom", frame: "DefaultZoomSlider", cap: "DEFAULT_CAMERA_DISTANCE", kind: "range", panel: "gameplay", def: 50, min: 0, max: 100, step: 1 },
  { key: "maxZoom", frame: "MaxZoomSlider", cap: "MAX_CAMERA_DISTANCE", kind: "range", panel: "gameplay", def: 50, min: 0, max: 100, step: 1 },

  // --- Video (applied through render/videoQuality.ts, which documents what each rung does) ---
  { key: "gamma", frame: "GammaSlider", cap: "COLON_GAMMA", kind: "range", panel: "video", def: 50 },
  // The buffer the world is drawn into (see RESOLUTIONS). 1920x1080 is the default and is what
  // Warcraft Open has always rendered at, so a player who never opens this screen sees no change.
  { key: "resolution", frame: "ResolutionMenu", cap: "COLON_RESOLUTION", kind: "choice", panel: "video", def: "1920x1080", choices: RESOLUTIONS },
  // "Low Performance Mode" (issue #161) — one switch that puts every rung BELOW it at its
  // cheapest, for a machine that cannot afford them. Not a WC3 row: the 2003 panel is nine
  // independent settings and has nothing that says "all of it, as cheap as it goes", so the frame
  // comes from `src/overrides/ui/OptionsMenu.fdf` (and its in-game twin from
  // `EscMenuOptionsPanel.fdf`) and the label from our GlobalStrings layer.
  //
  // It sits directly under "Resolution:" because Resolution is exactly what it does NOT touch:
  // the pixels are the player's to choose (issue #161 asks for that in as many words), and so is
  // the Gamma slider above it. What it forces, and what forcing means, is `LOW_PERF_FORCED` in
  // render/videoQuality.ts — the values under it are left ALONE in the store, so unticking gives
  // the player their own seven choices back. Off by default: nobody's current look changes.
  { key: "lowPerf", frame: "LowPerfCheckBox", cap: "LOW_PERFORMANCE_MODE", kind: "bool", panel: "video", def: false },
  // No LOD models to swap to: an MDX carries one mesh, and WC3's lower rungs picked a simpler
  // one. Faking it by thinning the map's doodads would change what the map LOOKS like rather
  // than how much it costs to draw, which is not what the row says.
  { key: "modelDetail", frame: "ModelDetailMenu", cap: "COLON_MODEL_DETAIL", kind: "choice", panel: "video", def: "high", choices: quality("MODELS"), applied: false },
  { key: "animQuality", frame: "AnimQualityMenu", cap: "COLON_ANIM_QUALITY", kind: "choice", panel: "video", def: "high", choices: quality("ANIM") },
  { key: "textureQuality", frame: "TextureQualityMenu", cap: "COLON_TEXTURE_QUALITY", kind: "choice", panel: "video", def: "high", choices: quality("TEXTURES") },
  { key: "particles", frame: "ParticlesMenu", escFrame: "EscOptionsParticlesMenu", cap: "COLON_PARTICLES", kind: "choice", panel: "video", def: "high", choices: quality("PARTICLES") },
  { key: "lights", frame: "LightsMenu", escFrame: "EscOptionsLightsMenu", cap: "COLON_LIGHTS", kind: "choice", panel: "video", def: "high", choices: quality("LIGHTS") },
  // "Unit Shadows:" (COLON_SHADOWS) — the model shadow decals, not the baked terrain layer.
  { key: "shadows", frame: "ShadowsMenu", escFrame: "EscOptionsShadowsMenu", cap: "COLON_SHADOWS", kind: "choice", panel: "video", def: "on", choices: ON_OFF },
  // Occlusion is the x-ray silhouette a unit shows through a cliff or a tree — the thing
  // `EnableOcclusion` turns off for a cinematic (jass/natives/cinematic.ts). We don't draw it,
  // so there is nothing here to switch.
  { key: "occlusion", frame: "OcclusionMenu", escFrame: "EscOptionsOcclusionMenu", cap: "COLON_OCCLUSION", kind: "choice", panel: "video", def: "on", choices: ON_OFF, applied: false },
  // …and no Spell Detail row: the shipped 1.30.4 OptionsMenu.fdf has the whole `SpellFilterMenu`
  // block commented out, so the panel it is bound to has never had one.
  // "Vertical Sync" — not a WC3 row (1.30.4's panel has no frame-rate or vsync control), so it is
  // ours, on a frame of ours at the bottom of the panel. It means something only in the DESKTOP
  // app, where it is a Chromium launch switch the shell keeps in its own settings file
  // (electron/main.mjs); ui/fdfOptions.ts reads the shell's saved choice over this one, hands a
  // change to it on OK and offers to relaunch the game to apply it, and greys the box out in a
  // browser tab, whose vsync is the browser's.
  // ON by default: tear-free is what a new player should meet, and vsync off is an opt-in.
  { key: "vsync", frame: "VsyncCheckBox", cap: "VSYNC", kind: "bool", panel: "video", def: true },
  // "4:3 Menus" — the glue screens in a 4:3 box with black bars at the sides, the way 1.30.4
  // draws them on a wide screen. Ours (no 1.30.4 row does this), on a frame of ours sharing the
  // Vertical Sync row. OFF by default, so nobody's menus change shape under them; live through
  // `applyVideoOptions` → `setFixedMenuAspect` (ui/widescreen.ts), which re-lays the screen the
  // player is looking at, so ticking it previews itself like Gamma does.
  { key: "menus43", frame: "Menus43CheckBox", cap: "MENUS_4_3", kind: "bool", panel: "video", def: false },

  // --- The Reforged Video rows -----------------------------------------------------------
  // Window shape: a browser page cannot choose a display, but it CAN be fullscreen, so the two
  // fullscreen rungs are the one honest reading of this row (`ui/displayMode.ts`).
  { key: "windowMode", frame: "WindowModeMenu", cap: "WINDOW_MODE", kind: "choice", panel: "video", def: "windowed", choices: WINDOW_MODES },
  // Frame-rate caps (render/frameLimit.ts). A browser tab is already vsynced, so these can only
  // LOWER the rate; the numbers are the WebUI's own ladders.
  { key: "maxForegroundFps", frame: "MaxForegroundFpsSlider", cap: "MAX_FOREGROUND_FPS", kind: "range", panel: "video", def: 300, min: 30, max: 300, step: 10 },
  { key: "maxBackgroundFps", frame: "MaxBackgroundFpsSlider", cap: "MAX_BACKGROUND_FPS", kind: "range", panel: "video", def: 30, min: 15, max: 60, step: 5 },
  // Anti-aliasing is fixed when the WebGL context is created, so the row is read at boot and a
  // change is offered as a reload (same shape as the art cards).
  { key: "antialiasing", frame: "AntialiasingCheckBox", cap: "PREF_VIDEO_ANTIALIASING", kind: "bool", panel: "video", def: true },
  // Rows with no pass behind them in this renderer. Visible and gray.
  { key: "spellDetail", frame: "SpellDetailMenu", cap: "PREF_VIDEO_SPELLS", kind: "choice", panel: "video", def: "high", choices: quality("SPELLS"), applied: false },
  { key: "foliage", frame: "FoliageMenu", cap: "PREF_VIDEO_FOLIAGE", kind: "choice", panel: "video", def: "high", choices: FOLIAGE_QUALITY, applied: false },
  { key: "ssao", frame: "SsaoCheckBox", cap: "PREF_VIDEO_ASSAO", kind: "bool", panel: "video", def: false, applied: false },
  { key: "bloom", frame: "BloomCheckBox", cap: "PREF_VIDEO_BLOOM", kind: "bool", panel: "video", def: false, applied: false },
  { key: "portraitBloom", frame: "PortraitBloomCheckBox", cap: "PREF_VIDEO_PORTRAIT_BLOOM", kind: "bool", panel: "video", def: false, applied: false },

  // --- Sound (all live-applied through applyAudioOptions) ---
  { key: "soundEnabled", frame: "SoundCheckBox", cap: "SOUND_EFFECTS", kind: "bool", panel: "sound", def: true },
  { key: "soundVolume", frame: "SoundVolumeSlider", cap: "COLON_SOUND_EFFECTS_VOLUME", kind: "range", panel: "sound", def: 100 },
  { key: "musicEnabled", frame: "MusicCheckBox", cap: "MUSIC", kind: "bool", panel: "sound", def: true },
  { key: "musicVolume", frame: "MusicVolumeSlider", cap: "COLON_MUSIC_VOLUME", kind: "range", panel: "sound", def: 70 },
  { key: "ambientSounds", frame: "AmbientCheckBox", cap: "AMBIENT_SOUNDS", kind: "bool", panel: "sound", def: true },
  { key: "movementSounds", frame: "MovementCheckBox", cap: "MOVEMENT_SOUNDS", kind: "bool", panel: "sound", def: true },
  { key: "unitSounds", frame: "UnitCheckBox", cap: "UNIT_SOUNDS", kind: "bool", panel: "sound", def: true },
  { key: "subtitles", frame: "SubtitlesCheckBox", cap: "SUBTITLES", kind: "bool", panel: "sound", def: true, applied: false },
  { key: "environmentalEffects", frame: "EnviroCheckBox", cap: "ENVIRONMENTAL_EFFECTS", kind: "bool", panel: "sound", def: true, applied: false },
  { key: "positionalAudio", frame: "PositionalCheckBox", cap: "POSITIONAL_AUDIO", kind: "bool", panel: "sound", def: true, applied: false },
  // Mute every bus while the window is not focused (audio/focusMute.ts, driven by applyAudioOptions).
  { key: "muteFocusLoss", frame: "MuteFocusLossCheckBox", cap: "PREF_SOUND_WINDOW_FOCUS", kind: "bool", panel: "sound", def: false },
  // Two rows with no second library behind them in this build.
  { key: "musicOverride", frame: "MusicOverrideMenu", cap: "MUSIC", kind: "choice", panel: "sound", def: "default", choices: MUSIC_OVERRIDES, applied: false },
  { key: "classicSound", frame: "ClassicSoundCheckBox", cap: "OPTION_CLASSIC_SOUND", kind: "bool", panel: "sound", def: false, applied: false },

  // --- Input (HD-only rows; the classic in-game panel binds the first two by escFrame) ---
  { key: "confineMouse", frame: "ConfineMouseMenu", cap: "PREF_INPUT_CONFINE_MOUSE_CURSOR", kind: "choice", panel: "input", def: "auto", choices: CONFINEMENT },
  { key: "reduceMouseLag", frame: "ReduceMouseLagCheckBox", cap: "PREF_INPUT_REDUCE_MOUSE_LAG", kind: "bool", panel: "input", def: false },

  // --- The touch gesture console (手机平板手势控制台方案.md §10.1) ---
  // Ours entirely — no 2003 or 3.0 file has a row for a touch console — so the frames come from
  // `src/overrides/ui/*.fdf` and the labels from our `opt.*` table. They live on the Input panel
  // beside Voice Control and Gamepad: all four are ways of driving the game besides the mouse.
  //
  // `gestureEnabled` is the master switch (device.ts also requires a touchscreen, so a desktop
  // mouse never picks it up); off means not one listener is registered (P5). Everything below it
  // is read live by `src/ui/gesture/profile.ts`: thresholds feed the recogniser, the two semantic
  // switches feed the action layer, and the look-and-feel rows feed the console UI.
  { key: "gestureEnabled", frame: "GestureEnabledCheckBox", cap: "GESTURE_ENABLE", kind: "bool", panel: "input", def: true },
  { key: "gestureLayout", frame: "GestureLayoutMenu", cap: "GESTURE_LAYOUT", kind: "choice", panel: "input", def: "light", choices: [
    { value: "minimal", label: "GESTURE_LAYOUT_MINIMAL" },
    { value: "light", label: "GESTURE_LAYOUT_LIGHT" },
    { value: "full", label: "GESTURE_LAYOUT_FULL" },
  ] },
  { key: "gestureHandedness", frame: "GestureHandednessMenu", cap: "GESTURE_HANDEDNESS", kind: "choice", panel: "input", def: "right", choices: [
    { value: "right", label: "GESTURE_RIGHT_HANDED" },
    { value: "left", label: "GESTURE_LEFT_HANDED" },
  ] },
  { key: "gestureLongPressMs", frame: "GestureLongPressSlider", cap: "GESTURE_LONG_PRESS", kind: "range", panel: "input", def: 420, min: 300, max: 800, step: 25 },
  { key: "gestureTapSlopPx", frame: "GestureTapSlopSlider", cap: "GESTURE_TAP_SLOP", kind: "range", panel: "input", def: 12, min: 8, max: 24, step: 1 },
  { key: "gesturePinchZoom", frame: "GesturePinchZoomCheckBox", cap: "GESTURE_PINCH_ZOOM", kind: "bool", panel: "input", def: true },
  { key: "gestureLongPressIsRightClick", frame: "GestureLongPressRightClickCheckBox", cap: "GESTURE_LONG_PRESS_RIGHT_CLICK", kind: "bool", panel: "input", def: true },
  { key: "gestureHaptics", frame: "GestureHapticsCheckBox", cap: "GESTURE_HAPTICS", kind: "bool", panel: "input", def: true },
  { key: "gestureTrail", frame: "GestureTrailCheckBox", cap: "GESTURE_TRAIL", kind: "bool", panel: "input", def: true },
  { key: "gestureCardMirror", frame: "GestureCardMirrorCheckBox", cap: "GESTURE_CARD_MIRROR", kind: "bool", panel: "input", def: false },
  { key: "gestureShowHints", frame: "GestureHintsCheckBox", cap: "GESTURE_HINTS", kind: "bool", panel: "input", def: true },
  // Tablet-only 3/4-finger gestures. OFF by default (§6.2): on iPadOS these collide with
  // three-finger editing / four-finger app switching, and a phone never enables them.
  { key: "gestureMultiFinger", frame: "GestureMultiFingerCheckBox", cap: "GESTURE_MULTI_FINGER", kind: "bool", panel: "input", def: false },

  // --- Graphics: Reforged's per-category art switches (data/artCategories.ts) ---
  ...ART_CATEGORIES.map((c): OptionDef => ({
    key: c.key,
    frame: c.frame,
    cap: c.cap,
    kind: "bool",
    panel: "graphics",
    def: c.key !== "artOldEnvironment",
  })),
  // The UI language. Values are the i18n module's locale ids; the labels are the language names
  // the switcher itself prints (not translated — a language is named in its own tongue).
  // The picker itself is drawn from src/i18n's LOCALES (all twelve Reforged languages); these
  // entries keep the model's own value list in step for anything that reads a definition.
  { key: "language", frame: "LanguageMenu", cap: "LANGUAGE", kind: "choice", panel: "graphics", def: "zhCN", choices: [
    { value: "enUS", label: "English" },
    { value: "deDE", label: "Deutsch" },
    { value: "esES", label: "Español (España)" },
    { value: "esMX", label: "Español (Latinoamérica)" },
    { value: "frFR", label: "Français" },
    { value: "itIT", label: "Italiano" },
    { value: "koKR", label: "한국어" },
    { value: "plPL", label: "Polski" },
    { value: "ptBR", label: "Português (Brasil)" },
    { value: "ruRU", label: "Русский" },
    { value: "zhCN", label: "中文（简体）" },
    { value: "zhTW", label: "中文（繁體）" },
  ] },
];

export type OptionValue = boolean | number | string;
export type Options = Record<string, OptionValue>;

/** Every option at its default — the base a stored set is merged over, so a value added to the
 *  table later still has a sane default for a player whose localStorage predates it. */
export function defaultOptions(): Options {
  const o: Options = {};
  for (const d of OPTION_DEFS) o[d.key] = d.def;
  return o;
}

const STORAGE_KEY = "warcraft-open.options";

/** Has this machine ever committed options? False on a first boot — which is the one moment a
 *  suggestion may be written without overwriting a player's own choice (ui/gesture/device.ts
 *  uses it for the touch quality defaults in 手机平板手势控制台方案.md §4.3). */
export function hasStoredOptions(): boolean {
  const ls = typeof localStorage !== "undefined" ? localStorage : null;
  if (!ls) return false;
  try {
    const raw = ls.getItem(STORAGE_KEY);
    return raw !== null && raw !== "";
  } catch {
    return false;
  }
}

/** The committed options, from localStorage merged over the defaults. Reads are best-effort:
 *  a disabled/quota-full/corrupt store just yields the defaults. */
export function loadOptions(): Options {
  const base = defaultOptions();
  const ls = typeof localStorage !== "undefined" ? localStorage : null;
  // Every way out of this function goes through `lowPerfFlag` — the launch flag has to reach a
  // player whose store is EMPTY or unreadable just as much as one whose store is fine, and those
  // are the two early returns below. (Missed once: a fresh profile has no stored options, so
  // `?lowperf` did nothing at all on the machine most likely to pass it.)
  if (!ls) return lowPerfFlag(base);
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return lowPerfFlag(base);
    const saved = JSON.parse(raw) as Partial<Options>;
    // A store written before issue #141 carries a `healthBars` NOBODY CHOSE. The checkbox was
    // remembered but unapplied (`applied: false`) and defaulted to the game's own `false`, so
    // pressing OK on this screen once was enough to write a `false` into the store — while the
    // bars went on being drawn regardless, because nothing read it. Honouring that value now
    // would turn the bars off for exactly the players who never touched the row. Such a store
    // is precisely the one with no `healthBarStyle` in it (the sibling row that arrived with
    // the backend), so there the stale value is dropped and the new default stands.
    if (saved.healthBarStyle === undefined) delete saved.healthBars;
    // The same trap, one row down. "Use Computer+ as default AI" opened UNTICKED until it became
    // the default, and the OK button writes every row — so a stored `false` is what every store
    // from before then says whether or not its player ever looked at the row. Such a store is the
    // one without `computerPlusOn` (the marker this row's new default arrived with, written by
    // `saveOptions`), so there the stale value is dropped and the new default stands. A stored
    // `true` was a choice either way and is kept.
    if (saved.computerPlusOn === undefined && saved.computerPlusDefault === false) delete saved.computerPlusDefault;
    for (const d of OPTION_DEFS) {
      const v = saved[d.key];
      // Only accept a stored value of the shape this option expects — a hand-edited or
      // stale store can't push a string into a boolean and corrupt the screen.
      if (v !== undefined && typeof v === typeof d.def) base[d.key] = v;
    }
  } catch {
    /* unreadable store — the defaults stand */
  }
  return lowPerfFlag(base);
}

/**
 * The `?lowperf` LAUNCH FLAG (issue #161), which asks for the mode "selectable in options and via
 * launch flag".
 *
 * Applied here rather than at boot so that every reader agrees: the applier main.ts calls before
 * the first texture is uploaded, the glue Options screen, and the F10 panel all go through
 * `loadOptions`. The box then shows TICKED, which is true, and pressing OK persists it like any
 * other choice.
 *
 * Not DEV-gated, unlike `?dev` — this one is for the machine that needs it. `location` is guarded
 * because this module is required from Node by `tools/sim-options-test.cjs`.
 */
function lowPerfFlag(o: Options): Options {
  try {
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("lowperf")) o.lowPerf = true;
  } catch {
    /* no URL to read — the stored value stands */
  }
  return o;
}

/** Commit the options to localStorage (the OK button). Best-effort: a full/disabled store
 *  simply doesn't persist, and the in-memory values still take effect for the session. */
export function saveOptions(opts: Options): void {
  const ls = typeof localStorage !== "undefined" ? localStorage : null;
  if (!ls) return;
  try {
    // `computerPlusOn` marks a store written since Computer+ became the default — see `loadOptions`.
    ls.setItem(STORAGE_KEY, JSON.stringify({ ...opts, computerPlusOn: true }));
  } catch {
    /* quota exceeded / storage disabled — settings are best-effort */
  }
}

const num = (v: OptionValue, fallback: number): number => (typeof v === "number" ? v : fallback);
const bool = (v: OptionValue): boolean => v === true;

/**
 * Push the Sound-panel options onto a live SoundBoard. This is the one panel with a real
 * backend, so it is the one that actually does something the moment you touch it.
 *
 * Music and SFX are kept independent, the way the two sliders imply: the music track has its
 * own gain (`setMusicVolume`), and the effect groups are scaled by `VolumeGroupSetVolume` —
 * so the "Sound Effects Volume" slider never touches the music, and vice-versa. Each SFX group's
 * final scale is the PRODUCT of the master sound switch, the effects slider, and any per-category
 * checkbox that also governs it (Unit Sounds → UNITSOUNDS, Ambient Sounds → AMBIENTSOUNDS):
 *
 *     UNITSOUNDS = soundOn · soundVol · unitSounds     (a unit's voice / death cry)
 *     COMBAT / SPELLS / UI = soundOn · soundVol         (clangs, spells, the menu click itself)
 *     AMBIENT = soundOn · soundVol · ambientSounds      (dawn cries, the menu wind bed)
 *     UNITMOVEMENT = soundOn · soundVol · movementSounds (footsteps; see ModelSounds.footsteps)
 *     MUSIC (via setMusicVolume) = musicOn · musicVol
 *
 * Turning "Sound" off zeroes every effect group (including the UI click — WC3 does the same).
 */
/** Should a new Custom Game open with Computer+ switched on? Options → Gameplay → "Use
 *  Computer+ as default AI", read straight from the committed store because the Custom Game
 *  screen is mounted long after the Options screen has been closed. */
export function computerPlusDefault(): boolean {
  return loadOptions().computerPlusDefault === true;
}

let lastAudio: { sounds: SoundBoard; opts: Options } | null = null;

export function applyAudioOptions(sounds: SoundBoard, opts: Options): void {
  lastAudio = { sounds, opts };
  // "Mute when window loses focus" needs the same mix re-applied when focus comes back. The
  // listener is installed once and replays the last pair.
  if (opts.muteFocusLoss === true) {
    installFocusMute(() => {
      if (lastAudio) applyAudioOptions(lastAudio.sounds, lastAudio.opts);
    });
  }
  const muted = opts.muteFocusLoss === true && !windowFocused();
  const soundOn = !muted && bool(opts.soundEnabled);
  const sfx = soundOn ? num(opts.soundVolume, 100) / 100 : 0;
  const musicScale = !muted && bool(opts.musicEnabled) ? num(opts.musicVolume, 70) / 100 : 0;

  sounds.setVolumeGroup(SOUND_GROUP.UNITSOUNDS, sfx * (bool(opts.unitSounds) ? 1 : 0));
  sounds.setVolumeGroup(SOUND_GROUP.COMBAT, sfx);
  sounds.setVolumeGroup(SOUND_GROUP.SPELLS, sfx);
  sounds.setVolumeGroup(SOUND_GROUP.UI, sfx);
  sounds.setVolumeGroup(SOUND_GROUP.AMBIENT, sfx * (bool(opts.ambientSounds) ? 1 : 0));
  sounds.setVolumeGroup(SOUND_GROUP.UNITMOVEMENT, sfx * (bool(opts.movementSounds) ? 1 : 0));
  sounds.setMusicVolume(Math.round(musicScale * 127));
}

/** Options → Gameplay → "Automatically Save Replays" (issue #158): keep every match's replay,
 *  not just the last one. */
export function autosaveReplay(): boolean {
  return loadOptions().autosaveReplay !== false;
}

/**
 * The player's options, as a REPLAY WINDOW is handed them (issue #158, src/replayBoot.ts,
 * electron/replayPreload.cjs): another version's page, in a throwaway session, told how THIS
 * player has the game set — the video rungs, the volumes, the hotkey scheme — by the storage keys
 * it would have read them from itself. A key that version does not know it ignores; one it has
 * that we do not, it defaults. Voice Control is handed over OFF: a replay bundle is built without
 * the recogniser (tools/replay-bundle.mjs), and a watcher has nothing to say to it.
 */
export function replayWindowOptions(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    out[STORAGE_KEY] = JSON.stringify({ ...loadOptions(), voiceControl: false });
    const edition = localStorage.getItem("warcraft-open.edition");
    if (edition) out["warcraft-open.edition"] = edition;
    // 回放窗口也要留在同一条资产 / 数据线上；跨 flavor 的录像本来就会被拒绝（SD-HD双版本方案.md §7.3）。
    const gameFlavor = localStorage.getItem("warcraft-open.flavor");
    if (gameFlavor) out["warcraft-open.flavor"] = gameFlavor;
  } catch {
    /* no storage: the window runs on that version's defaults */
  }
  return out;
}

/**
 * Options → Gameplay → "Share Replays" (issue #158): the player's consent to their replays being
 * sent to Warcraft Open's own collection (game/replayUpload.ts) and to their own input track being
 * recorded into them (game/inputTrack.ts). OURS — the game has no such switch — and ON unless
 * the player has turned it off.
 */
export function shareReplays(): boolean {
  return loadOptions().shareReplays !== false;
}
