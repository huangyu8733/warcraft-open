import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { playFdfClick } from "../fdf/render";
import { webUiAssets } from "./assets";
import { loadOfficialStyle } from "./official";
import { HdScreen, el } from "./screen";
import { confirmDialog } from "./dialog";
import { cornerDecorations } from "./officialMenu";
import { applyHdTheme, hdTheme, setHdTheme, type HdTheme } from "./theme";
import { dropdown, type DropdownControl } from "./dropdown";
import { applyGameLocale } from "./locale";
import { isRoc } from "../../data/edition";
import { forgetUrlSwitch, hdArt, setHdArt, type HdArt } from "../../data/flavor";
import { t } from "../../i18n";
import { FdfLibrary } from "../fdf/library";
import { OW3_STRINGS } from "../../overrides";
import {
  OPTION_DEFS, defaultOptions, loadOptions, saveOptions, applyAudioOptions, type Options, type OptionDef,
} from "../../data/options";
import { applyVideoOptions, LOW_PERF_FORCED } from "../../render/videoQuality";
import { applyHealthBarOptions } from "../../render/worldOverlays";
import { applyHotkeyOptions } from "../../data/hotkeys";
import { applyScrollOptions } from "../../render/scrollOptions";
import { uiThemeChoices } from "../../data/uiTheme";
import { applyVoiceOptions } from "../../voice/control";
import { gamepadButtonPressed, watchGamepadButton } from "../gamepad";
import { nativeVsync, relaunchNative, setNativeVsync } from "../../assets/nativeInstall";
import { applyGameplayOptions } from "../../render/gameplayOptions";
import { applyCameraOptions } from "../../render/cameraOptions";
import { applyInputOptions } from "../../render/inputOptions";
import { applyFrameLimits } from "../../render/frameLimit";
import { applyArtCategories } from "../../data/artCategories";
import { currentLocale, LOCALES, setLocale, type Locale } from "../../i18n";
import { gameLocale } from "../../vfs/gameLocale";
import type { SoundBoard } from "../../audio/sounds";

export interface HdOptionsHandlers {
  /** The live SoundBoard, so the Sound panel is audible as it is dragged. */
  sounds?: SoundBoard | null;
  /** Leave the screen — both OK and Cancel. */
  onClose: () => void;
}

type PanelName = "video" | "sound" | "gameplay" | "input" | "graphics";

/** 3.0's tab row, in its order. The Hotkeys tab moved into the match (F10 → Options →
 *  Hotkeys), where the keys are actually used. */
const TABS: readonly PanelName[] = ["video", "sound", "gameplay", "input", "graphics"];

/** One heading-and-rows block on a tab. `keys` name `OPTION_DEFS` entries; `custom` adds the two
 *  rows this client has and the install's table does not (the glue theme and the art cards). */
interface OptionsSection {
  title?: string;
  keys?: readonly string[];
  custom?: "theme" | "art" | "language" | "graphicsRest" | "gamepad";
}

/** The measured 3.0 layout: a tab is a row of columns, a column stacks sections. */
const LAYOUT: Record<PanelName, readonly (readonly OptionsSection[])[]> = {
  video: [
    [{
      title: "MONITOR_SETTINGS",
      keys: ["windowMode", "gamma", "resolution", "vsync", "menus43", "lowPerf", "maxForegroundFps", "maxBackgroundFps"],
    }],
    [{
      title: "GRAPHICAL_QUALITY",
      keys: [
        "textureQuality", "particles", "spellDetail", "foliage", "shadows",
        "antialiasing", "ssao", "bloom", "portraitBloom",
        "modelDetail", "animQuality", "lights", "occlusion",
      ],
    }],
  ],
  sound: [
    [{
      title: "VOLUME",
      keys: ["musicEnabled", "musicVolume", "soundEnabled", "soundVolume", "musicOverride", "classicSound"],
    }],
    [
      {
        title: "SOUNDS",
        keys: ["ambientSounds", "movementSounds", "unitSounds", "environmentalEffects", "positionalAudio", "muteFocusLoss"],
      },
      // Language is a DISPLAY setting, so it lives on the Graphics tab only. It used to be
      // repeated here as well, which meant two dropdowns editing one stored value.
      { title: "SUBTITLES", keys: ["subtitles"] },
    ],
  ],
  gameplay: [
    [{
      title: "USER_INTERFACE",
      keys: [
        "healthBars", "healthBarStyle", "heroFrames", "heroLevel", "showHotkeys",
        "hudScale", "hudSidePanels", "showTimeElapsed",
        "displayFps", "displayPing", "displayApm",
        "enhancedTooltips", "subgroupOrder", "denyIcon", "cinePortraits", "sdCampaignScreens",
        "uiTheme",
      ],
      custom: "theme",
    }],
    [
      { title: "CAMERA_SETTINGS", keys: ["enhancedZoom", "defaultZoom", "maxZoom"] },
      {
        title: "GAME_BEHAVIOR",
        keys: [
          "formationMovement", "peonDoubleTapFocus", "teenFilter", "profanityFilter",
          "advancedObserverUI", "useSkins", "classicCursor", "oldTerrain", "gameSpeed",
          "computerPlusDefault",
        ],
      },
    ],
    [
      { title: "KEY_REPLAY", keys: ["autosaveReplay", "shareReplays"] },
      {
        title: "COMMUNICATION_HEADER",
        keys: ["opponentChat", "teamChat", "observerChat", "globalChat", "gameInfoMessages"],
      },
    ],
  ],
  input: [
    [{ title: "SCROLLING", keys: ["mouseScrollDisable", "mouseScrollSpeed", "keyScrollSpeed"] }],
    [
      { title: "CONTROLS", keys: ["confineMouse", "reduceMouseLag"] },
      // Voice Control and the gamepad row sit together here, as they do on the classic Input
      // panel: both are ways of driving the game besides the mouse and keyboard.
      { title: "VOICE_CONTROL", keys: ["voiceControl"] },
      { title: "GAMEPAD", custom: "gamepad" },
    ],
  ],
  graphics: [
    [
      // The three style cards are one full-width row of their own; the category list and the
      // language picker share the row underneath it.
      { custom: "art" },
      { custom: "graphicsRest" },
    ],
  ],
};

/** Values that read as a ladder, so the row wears 3.0's slider-and-ticks control instead of a
 *  dropdown: the quality rungs (Low/Medium/High) and the On/Off toggles the design also draws
 *  as a two-stop rail. Module scope: the row builder runs while the panels are filled, before
 *  any per-mount `const` below it would have initialised. */
const ORDINAL_VALUES = new Set(["off", "on", "low", "medium", "high", "ultra"]);

/**
 * The Reforged Options screen (3.0).
 *
 * The categories are the 3.0 glue's own (Gameplay / Video / Sound), the rows are this engine's
 * `OPTION_DEFS` table, and the captions are resolved from the INSTALL's `GlobalStrings.fdf` —
 * the same words the FDF panel wears, in the player's own language. The 3.0 web front end keeps
 * its settings in a full-screen sheet; that is the shape drawn here.
 *
 * OK and Cancel mean what they mean on the FDF screen: this edits a WORKING copy, applies each
 * panel's backend live (so a volume drag is heard and a gamma drag is seen), OK commits it and
 * Cancel restores the committed values.
 */
export async function mountHdOptions(
  container: HTMLElement,
  vfs: DataSource,
  h: HdOptionsHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  const screen = new HdScreen("hd-options");

  // The install's own words for every row and pulldown entry. Only the strings are wanted here,
  // but the library loads GlobalStrings first whatever file it is asked for.
  const lib = new FdfLibrary(vfs);
  await lib.load("UI\\FrameDef\\Glue\\OptionsMenu.fdf");
  lib.loadOverride(OW3_STRINGS.id, OW3_STRINGS.source);
  // The install's strings carry FDF colour markup (`KEY_GRAPHICS` is "画面|Cffffffff|R"); this
  // sheet paints its own colours, so the markup is styling to drop, not glyphs to show.
  const str = (key: string): string =>
    lib.string(key).replace(/\|[cC][0-9a-fA-F]{8}/g, "").replace(/\|[rR]/g, "");
  /** A Reforged-only key is absent from a classic install's table; the library hands the key
   *  back untouched. Fall back to our own bilingual `opt.*` table in exactly that case. */
  const strOpt = (key: string): string => {
    const own = `opt.${key}`;
    const translated = t(own as Parameters<typeof t>[0]);
    // `t` answers undefined for a key with no entry (plain labels such as "1920 x 1080" are
    // passed through here too), so presence is a type check, not a string comparison.
    const hasOwn = typeof translated === "string" && translated.length > 0;
    // The install's table is only in the MOUNTED data language, which an install may not carry
    // for the language the player picked (a zhCN install has no German module). Prefer our own
    // translation unless the two are the same language — otherwise a zhTW UI over a zhCN
    // install would show Simplified captions, and a German UI over zhCN would show Chinese.
    const useInstall = currentLocale() === gameLocale();
    if (hasOwn && !useInstall) return translated;
    const s = str(key);
    if (s !== key) return s;
    return hasOwn ? translated : key;
  };

  const committed = loadOptions();
  // The language row shows the language the page is actually drawn in, not the table default.
  committed.language = currentLocale();
  const shellVsync = await nativeVsync();
  if (shellVsync !== null) committed.vsync = shellVsync;
  const working: Options = { ...committed };
  let active: PanelName = "video";

  const applyAudio = (opts: Options): void => {
    if (h.sounds) applyAudioOptions(h.sounds, opts);
  };
  const applyVideo = (opts: Options): void => applyVideoOptions(opts);
  const applyGameplay = (opts: Options): void => {
    applyHealthBarOptions(opts);
    applyHotkeyOptions(opts);
    applyScrollOptions(opts);
    applyVoiceOptions(opts);
    applyGameplayOptions(opts);
    applyCameraOptions(opts);
  };
  const applyInput = (opts: Options): void => applyInputOptions(opts);
  const applyAll = (opts: Options): void => {
    applyAudio(opts);
    applyVideo(opts);
    applyGameplay(opts);
    applyInput(opts);
    applyFrameLimits(opts);
    applyArtCategories(opts);
  };

  // 3.0's sheet: the whole settings screen is one carved plate, with its tabs in the header,
  // the scrollable configuration under it, and Back / Save in a footer frame.
  await loadOfficialStyle(assets);
  applyGameLocale();
  screen.element.classList.add("hd-official");
  const tft = !isRoc();
  if (tft) screen.element.classList.add("tft");

  const root = el("div", "Options");
  const zoom = el("div", "Options-Zoom-Container");
  const plate = el("div", "Options-Container Animate-In");
  plate.appendChild(el("div", "Options-Background"));

  const base = el("div", "BaseFrame");
  const themed = tft ? " tft" : "";
  base.append(
    el("div", `left-chain${themed}`),
    el("div", `right-chain${themed}`),
    el("div", `frame${themed}`),
  );
  plate.appendChild(base);

  const headerBg = el("div", "Options-Header-HolderBackground");
  const bgLeft = el("div", "Options-Header-Holder-Left");
  bgLeft.appendChild(el("div", "Lionhead-Back"));
  const bgRight = el("div", "Options-Header-Holder-Right");
  bgRight.appendChild(el("div", "Lionhead-Back"));
  headerBg.append(bgLeft, el("div", "Options-MenuItem-WrapperSpacing"), bgRight);
  plate.appendChild(headerBg);

  const content = el("div", "Options-Content");
  const menu = el("div", "Options-Menu");
  const header = el("div", "Options-Header-Holder");
  header.appendChild(el("div", "Options-Header-Holder-Left"));

  // --- the category tabs --------------------------------------------------------------
  const tabButtons = new Map<PanelName, HTMLElement>();
  const labels: Record<PanelName, string> = {
    video: "KEY_VIDEO",
    sound: "KEY_SOUND",
    gameplay: "KEY_GAMEPLAY",
    input: "KEY_INPUT",
    graphics: "KEY_GRAPHICS",
  };
  const tabWrap = el("div", "Options-MenuItem-Wrapper");
  for (const name of TABS) {
    const holder = el("div", "Primary-Tab-Button-Top-Container");
    const b = el("div", "Primary-Button Options-MenuItem");
    b.setAttribute("role", "tab");
    b.tabIndex = 0;
    b.appendChild(el("div", "Primary-Button-Content", strOpt(labels[name])));
    b.onclick = (): void => show(name);
    b.onkeydown = (ev): void => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        show(name);
      }
    };
    holder.appendChild(b);
    tabWrap.appendChild(holder);
    tabButtons.set(name, b);
  }
  header.appendChild(tabWrap);
  header.appendChild(el("div", "Options-Header-Holder-Right"));
  menu.appendChild(header);

  // --- the settings sheet ------------------------------------------------------------
  const frame = el("div", "Options-Frame");
  const config = el("div", "Options-ConfigurationHolder");
  frame.appendChild(config);
  menu.appendChild(frame);
  content.appendChild(menu);
  plate.appendChild(content);

  const dropdowns = new Map<string, DropdownControl>();
  /** One repaint per row, so Reset can put every control back to the default without rebuilding
   *  the screen (the row closures own the control they draw). */
  const refreshers = new Map<string, () => void>();
  const panels = new Map<PanelName, HTMLElement>();
  /** Subscriptions the sheet owns (the gamepad watch); released with the screen. */
  const cleanups: Array<() => void> = [];

  for (const name of TABS) {
    const panel = el("div", "hd-options-rows");
    const columns = el("div", "hd-opt-columns");
    for (const column of LAYOUT[name]) {
      const col = el("div", "hd-opt-col");
      for (const section of column) {
        if (section.title) {
          col.appendChild(el("h3", "hd-opt-section-title", strOpt(section.title)));
        }
        for (const key of section.keys ?? []) {
          const d = OPTION_DEFS.find((x) => x.key === key);
          if (d) col.appendChild(row(d));
        }
        if (section.custom === "theme") col.appendChild(themeRow());
        if (section.custom === "art") col.appendChild(artCards());
        if (section.custom === "language") col.appendChild(languageRow());
        if (section.custom === "graphicsRest") col.appendChild(graphicsRest());
        if (section.custom === "gamepad") col.appendChild(gamepadRow());
      }
      columns.appendChild(col);
    }
    panel.appendChild(columns);
    panel.hidden = name !== active;
    config.appendChild(panel);
    panels.set(name, panel);
  }

  // --- Back / Save / Reset ------------------------------------------------------------
  const footHolder = el("div", "Options-Main-Footer-Holder");
  const foot = el("div", "Options-Main-Footer");
  // The screen edits a working copy; Back leaves silently only when nothing differs.
  const isDirty = (): boolean => {
    const keys = new Set([...Object.keys(committed), ...Object.keys(working)]);
    for (const key of keys) if (working[key] !== committed[key]) return true;
    return false;
  };
  const leave = (): void => {
    Object.assign(working, committed);
    applyAll(committed);
    h.onClose();
  };
  // The footer labels come from OUR catalogue, not the install's GlobalStrings: an install only
  // carries one locale module, so `KEY_BACK`/`KEY_SAVE` have no zhTW or ruRU entry and would be
  // printed as raw keys when the player picks a language the install does not ship.
  const back = footButton(t("hd.back"), () => {
    if (isDirty()) askDiscard(leave);
    else leave();
  }, true);
  /** Save the working copy and apply it, asking for a reload only for the two settings that
   *  need one. Reached from the Save button's confirmation, never directly. */
  function commitSave(): void {
    saveOptions(working);
    if (working.language !== committed.language) setLocale(working.language as Locale);
    if (working.antialiasing !== committed.antialiasing || working.language !== committed.language) {
      askReload();
      return;
    }
    if (shellVsync !== null && working.vsync !== committed.vsync) {
      void commitVsync(working.vsync === true);
    } else {
      h.onClose();
    }
  }

  const save = footButton(t("hd.saveAction"), () => {
    confirmDialog(screen.element, {
      title: t("hd.saveConfirmTitle"),
      text: t("hd.saveConfirmText"),
      cancelLabel: t("hd.cancel"),
      confirmLabel: t("hd.saveAction"),
      onConfirm: commitSave,
    });
  });
  const reset = footButton(t("hd.reset"), () => {
    confirmDialog(screen.element, {
      title: t("hd.resetConfirmTitle"),
      text: t("hd.resetConfirmText"),
      cancelLabel: t("hd.cancel"),
      confirmLabel: t("hd.reset"),
      onConfirm: resetDefaults,
    });
  });
  foot.append(back, save, reset);
  footHolder.appendChild(foot);
  plate.appendChild(footHolder);

  zoom.appendChild(plate);
  root.appendChild(zoom);
  screen.content.appendChild(root);
  screen.element.appendChild(cornerDecorations(assets, tft));

  // 3.0's GetScale(): the sheet is authored at 1080 lines.
  const rescale = (): void => {
    zoom.style.setProperty("zoom", Math.max(0.5, window.innerHeight / 1080).toFixed(3));
  };
  rescale();
  window.addEventListener("resize", rescale);

  show(active);
  syncVideoRows();

  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    window.removeEventListener("resize", rescale);
    for (const cleanup of cleanups) cleanup();
    dispose();
  };

  return screen.attach(container);

  // --- one footer control ------------------------------------------------------------

  /** A footer button: `.Options-MenuItem-Footer > .Primary-Button`; Back carries the Esc cap. */
  function footButton(label: string, onClick: () => void, withEsc = false): HTMLElement {
    const holder = el("div", "Options-MenuItem-Footer");
    const b = el("div", "Primary-Button");
    b.setAttribute("role", "button");
    b.tabIndex = 0;
    if (withEsc) {
      const content = el("div", "Primary-Button-Content BackButton-ContentHolder");
      content.append(el("div", "EscapeIcon"), el("div", "BackText", label));
      b.appendChild(content);
    } else {
      b.appendChild(el("div", "Primary-Button-Content", label));
    }
    const fire = (): void => {
      playFdfClick();
      onClick();
    };
    b.addEventListener("click", fire);
    b.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        fire();
      }
    });
    holder.appendChild(b);
    return holder;
  }

  // --- one row -----------------------------------------------------------------------

  function ordinalChoices(
    choices: readonly { value: string; label: string }[],
  ): readonly { value: string; label: string }[] | null {
    if (choices.length < 2) return null;
    return choices.every((c) => ORDINAL_VALUES.has(c.value)) ? choices : null;
  }

  function row(d: OptionDef): HTMLElement {
    const locked = d.applied === false;
    const line = el("div", `hd-opt-row hd-opt-${d.kind}${locked ? " hd-opt-disabled" : ""}`);
    const label = el("span", "hd-opt-label", strOpt(d.cap!));
    if (locked) label.title = t("hd.notApplied");
    line.appendChild(label);
    const control = el("div", "hd-opt-control");
    line.appendChild(control);

    if (d.kind === "bool") {
      const toggle = el("button", "hd-check");
      toggle.type = "button";
      toggle.setAttribute("role", "switch");
      const paint = (on: boolean): void => {
        toggle.classList.toggle("on", on);
        toggle.setAttribute("aria-checked", on ? "true" : "false");
      };
      const vsyncLocked = d.key === "vsync" && shellVsync === null;
      paint(vsyncLocked ? true : working[d.key] === true);
      refreshers.set(d.key, () => paint(vsyncLocked ? true : working[d.key] === true));
      if (vsyncLocked || locked) {
        toggle.disabled = true;
        if (vsyncLocked) toggle.title = t("hd.vsyncBrowser");
        else toggle.title = t("hd.notApplied");
      } else {
        toggle.onclick = (): void => {
          const on = !(working[d.key] === true);
          working[d.key] = on;
          paint(on);
          commit(d);
        };
      }
      control.appendChild(toggle);
    } else if (d.kind === "range") {
      const wrap = el("div", "hd-slider");
      const input = el("input", "hd-range") as HTMLInputElement;
      input.type = "range";
      input.min = String(d.min ?? 0);
      input.max = String(d.max ?? 100);
      input.step = String(d.step ?? 1);
      input.value = String(typeof working[d.key] === "number" ? working[d.key] : d.def);
      const value = el("span", "hd-slider-value", input.value);
      if (locked) {
        input.disabled = true;
        input.title = t("hd.notApplied");
      }
      input.oninput = (): void => {
        value.textContent = input.value;
        working[d.key] = Number(input.value);
        commit(d);
      };
      refreshers.set(d.key, () => {
        input.value = String(working[d.key]);
        value.textContent = input.value;
      });
      wrap.append(input, value);
      control.appendChild(wrap);
    } else {
      const choices = d.key === "uiTheme" ? uiThemeChoices(vfs) : d.choices ?? [];
      const ladder = d.key === "uiTheme" ? null : ordinalChoices(choices);
      if (ladder) {
        // 3.0's quality control: the rail, then the rung captions under it. The picked rung is
        // read off the thumb, so there is no second value label at the end.
        const wrap = el("div", "hd-slider hd-ladder");
        const ticks = el("div", "hd-ladder-ticks");
        for (const choice of ladder) ticks.appendChild(el("span", "", strOpt(choice.label)));
        const index = (v: unknown): number => Math.max(0, ladder.findIndex((c) => c.value === v));
        const input = el("input", "hd-range") as HTMLInputElement;
        input.type = "range";
        input.min = "0";
        input.max = String(ladder.length - 1);
        input.step = "1";
        const paint = (): void => {
          const i = index(working[d.key]);
          input.value = String(i);
          input.setAttribute("aria-valuetext", strOpt(ladder[i].label));
        };
        paint();
        if (locked) {
          input.disabled = true;
          input.title = t("hd.notApplied");
        }
        input.oninput = (): void => {
          const choice = ladder[Number(input.value)];
          input.setAttribute("aria-valuetext", strOpt(choice.label));
          working[d.key] = choice.value;
          commit(d);
        };
        refreshers.set(d.key, paint);
        const rail = el("div", "hd-slider-line");
        rail.append(input);
        wrap.append(rail, ticks);
        control.appendChild(wrap);
        return line;
      }
      const control2 = dropdown(
        choices.map((c) => ({ value: c.value, label: strOpt(c.label) })),
        String(working[d.key]),
        (value) => {
          working[d.key] = value;
          commit(d);
        },
      );
      if (locked) {
        control2.setDisabled(true);
        control2.element.title = t("hd.notApplied");
      }
      refreshers.set(d.key, () => control2.setValue(String(working[d.key])));
      dropdowns.set(d.key, control2);
      control.appendChild(control2.element);
    }
    return line;
  }

  // --- interface theme (Gameplay) ------------------------------------------------------

  /** The five backs the main menu's logo cycles (ui/hd/theme.ts). The labels are the ones
   *  `GlobalStrings.fdf` gives 3.0's own dropdown (`OPTIONS_THEME_*`), so the two clients name
   *  the same five faces the same way. A pick is instant — every screen wears the theme by
   *  class — and the choice is remembered for the next launch. */
  function themeRow(): HTMLElement {
    const line = el("div", "hd-opt-row");
    line.appendChild(el("span", "hd-opt-label", t("hd.theme")));
    const control = el("div", "hd-opt-control");
    const picker = dropdown(
      [
        { value: "0", label: t("hd.themeRoc") },
        { value: "1", label: t("hd.themeTft") },
        { value: "2", label: t("hd.themeRocSd") },
        { value: "3", label: t("hd.themeTftSd") },
        { value: "4", label: t("hd.themeFk") },
      ],
      String(hdTheme()),
      (value) => {
        setHdTheme(Number(value) as HdTheme);
        applyHdTheme(screen.element);
      },
    );
    control.appendChild(picker.element);
    line.appendChild(control);
    return line;
  }

  // --- the Graphics tab's lower half ---------------------------------------------------

  /** Everything under the full-width style row: the per-category switches on the left, the
   *  language picker on the right. A nested column block, not another top-level column, so the
   *  cards above can span the whole sheet. */
  function graphicsRest(): HTMLElement {
    const columns = el("div", "hd-opt-columns hd-graphics-rest");
    const quality = el("div", "hd-opt-col hd-opt-quality");
    quality.appendChild(el("h3", "hd-opt-section-title", strOpt("GRAPHICAL_QUALITY")));
    for (const key of ["artEnvironment", "artUnits", "artHeroes", "artBuildings", "artIcons", "artVfx", "artOldEnvironment"]) {
      const d = OPTION_DEFS.find((x) => x.key === key);
      if (d) quality.appendChild(row(d));
    }
    const language = el("div", "hd-opt-col hd-opt-language");
    language.appendChild(el("h3", "hd-opt-section-title", strOpt("LANGUAGE")));
    language.appendChild(languageRow());
    columns.append(quality, language);
    return columns;
  }

  // --- language (Sound / Graphics) ----------------------------------------------------

  /** The UI language. Switching is a reload by design (src/i18n/index.ts), so the choice is
   *  written immediately and the sheet offers the restart on Save like the art cards do. */
  function languageRow(): HTMLElement {
    const line = el("div", "hd-opt-row");
    line.appendChild(el("span", "hd-opt-label", t("opt.LANGUAGE")));
    const control = el("div", "hd-opt-control");
    const picker = dropdown(
      LOCALES.map((l) => ({ value: l.id, label: l.label })),
      String(working.language),
      (value) => {
        // Only the working copy moves here: Cancel must leave the language alone, so the
        // persisted choice (and the reload) happen on Save.
        working.language = value;
      },
    );
    control.appendChild(picker.element);
    line.appendChild(control);
    return line;
  }

  // --- gamepad (Input) ---------------------------------------------------------------

  /** The classic panel's "Detect Gamepad" / "Unpair Gamepad" row. The engine already drives the
   *  menus and the match with a pad (ui/gamepad.ts); this is the one control that lets a player
   *  pair one from the Reforged options. */
  function gamepadRow(): HTMLElement {
    const line = el("div", "hd-opt-action");
    const button = el("button", "hd-gamepad-button");
    button.type = "button";
    const paint = ({ paired, seconds }: { paired: boolean; seconds: number }): void => {
      const detect = t("hd.detectGamepad");
      button.textContent = paired
        ? t("hd.unpairGamepad")
        : seconds > 0 ? `${detect} (${seconds}s)` : detect;
      button.disabled = seconds > 0;
    };
    cleanups.push(watchGamepadButton(paint));
    button.onclick = (): void => gamepadButtonPressed();
    line.appendChild(button);
    return line;
  }

  // --- model art (Video) -------------------------------------------------------------

  /**
   * 3.0's Graphics-tab card row (`GraphicsMode-Item` in `WebUI\GlueManager.js`): the three art
   * sets as full picture cards, each with the gold checkbox and its name underneath. The
   * pictures are the install's own `Options/GraphicsMode_*.png` renders, so the cards show
   * exactly what the player will get. Picking one has to ask first: the store is mounted from
   * it, so it only takes effect after a reload — and that reload would otherwise throw away the
   * working copy, so OK commits the screen as well.
   */
  function artCards(): HTMLElement {
    const holder = el("div", "hd-art-modes");
    holder.setAttribute("role", "radiogroup");
    holder.setAttribute("aria-label", t("hd.artStyle"));
    const current = hdArt();
    for (const [value, label] of [
      ["sd", t("hd.artSd")],
      ["hd", t("hd.artHd")],
      ["de", t("hd.artDe")],
    ] as const) {
      const card = el("button", `hd-art-mode ${value}${value === current ? " isSelected" : ""}`);
      card.type = "button";
      card.setAttribute("role", "radio");
      card.setAttribute("aria-checked", value === current ? "true" : "false");
      card.title = t("hd.artReload");
      const frame = el("span", "hd-art-mode-frame");
      const footer = el("span", "hd-art-mode-footer");
      footer.append(
        el("span", "hd-art-mode-check"),
        el("span", "hd-art-mode-label", label),
      );
      frame.append(el("span", "hd-art-mode-image"), footer);
      card.appendChild(frame);
      card.onclick = (): void => {
        if (value !== hdArt()) askArtReload(value);
      };
      holder.appendChild(card);
    }
    return holder;
  }

  /** Back with unsaved edits asks first: leaving throws the working copy away, so that has to
   *  be a deliberate second press rather than the default outcome of the Back button. */
  function askDiscard(discard: () => void): void {
    confirmDialog(screen.element, {
      title: t("hd.unsavedTitle"),
      text: t("hd.unsavedText"),
      cancelLabel: t("hd.unsavedKeep"),
      confirmLabel: t("hd.unsavedDiscard"),
      onConfirm: discard,
    });
  }

  /** Switching the art line is a reload, so it asks on the same plate as leaving unsaved work. */
  function askArtReload(next: HdArt): void {
    confirmDialog(screen.element, {
      title: t("hd.artStyle"),
      text: t("hd.artReload"),
      cancelLabel: t("hd.cancel"),
      confirmLabel: t("hd.ok"),
      onConfirm: () => {
        saveOptions(working);
        forgetUrlSwitch("hdArt");
        setHdArt(next);
        location.reload();
      },
    });
  }

  /** A saved change that only takes effect on a fresh load (anti-aliasing's WebGL context, the
   *  UI language's string layer). The choice is already saved when this opens; the prompt wears
   *  the same 3.0 confirm plate as the other two. */
  function askReload(): void {
    confirmDialog(screen.element, {
      title: t("hd.reloadTitle"),
      text: t("hd.reloadText"),
      cancelLabel: t("hd.cancel"),
      confirmLabel: t("hd.reloadNow"),
      onCancel: h.onClose,
      onConfirm: () => {
        // `?lang=` outranks the stored choice (src/i18n/index.ts), so carry the pick into the URL
        // exactly as the corner switch does; every other parameter survives.
        const url = new URL(location.href);
        url.searchParams.set("lang", String(working.language));
        window.location.replace(url.toString());
      },
    });
  }

  function commit(d: OptionDef): void {
    if (d.panel === "sound") applyAudio(working);
    if (d.panel === "video") {
      applyVideo(working);
      applyFrameLimits(working);
    }
    if (d.panel === "gameplay") applyGameplay(working);
    if (d.panel === "input") applyInput(working);
    if (d.panel === "graphics") applyArtCategories(working);
    if (d.key === "lowPerf") syncVideoRows();
  }

  /** While "Low Performance Mode" is on, the rungs under it are dead and read the forced value —
   *  the same contract the FDF panel keeps (`syncVideoRows` in ui/fdfOptions.ts). */
  function syncVideoRows(): void {
    const on = working.lowPerf === true;
    for (const d of OPTION_DEFS) {
      const forced = LOW_PERF_FORCED[d.key];
      if (forced === undefined) continue;
      const picker = dropdowns.get(d.key);
      if (!picker) continue;
      picker.setDisabled(on);
      picker.setValue(on ? forced : String(working[d.key]));
    }
  }

  /** "Reset to default": every option back to its table default, applied live and painted, but
   *  not written until Save — the same working-copy rule the rest of the screen follows. */
  function resetDefaults(): void {
    Object.assign(working, defaultOptions());
    applyAll(working);
    for (const refresh of refreshers.values()) refresh();
    syncVideoRows();
  }

  function show(name: PanelName): void {
    active = name;
    for (const [key, panel] of panels) panel.hidden = key !== name;
    for (const [key, button] of tabButtons) {
      button.classList.toggle("Options-MenuItem-Selected", key === name);
    }
  }

  /**
   * Hand a changed "Vertical Sync" to the shell and offer to apply it now, in the 3.0 plate.
   * The choice is saved before asking, so both answers leave it saved for the next launch.
   */
  async function commitVsync(on: boolean): Promise<void> {
    await setNativeVsync(on);
    confirmDialog(screen.element, {
      title: strOpt("VSYNC"),
      text: t("hd.reloadText"),
      cancelLabel: t("hd.cancel"),
      confirmLabel: t("hd.ok"),
      onCancel: h.onClose,
      onConfirm: relaunchNative,
    });
  }
}
