import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { webUiAssets } from "./assets";
import { browseFolder, parentFolder } from "./browse";
import { HdScreen, el } from "./screen";
import { loadOfficialStyle } from "./official";
import { listRow, primaryButton, backButton } from "./officialMenu";
import { openSystemMenu } from "./systemMenu";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";
import { MELEE_NORMAL } from "../../ai/ids";
import { computerPlusDefault } from "../../data/options";
import { profilePlayerName } from "../../data/profiles";
import type { Race } from "../../data/races";
import type { MapInfo } from "../../world/mapInfo";
import { startsExplored } from "../../world/mapKind";
import { readMapInfo } from "../mapBrowser";
import { mapSizeLabel } from "../../data/gameplayConstants";
import {
  meleeSeat, type Controller, type FogMode, type MeleeConfig, type SlotConfig,
} from "../lobby";
import { visibilityFog } from "../../net/advancedOptions";
import {
  DEFAULT_ADVANCED, OBSERVER_ITEMS, VISIBILITY_ITEMS,
  type AdvancedOptions, type ObserverSetting, type Visibility,
} from "../../net/advancedOptions";
import {
  DEFAULT_GAME_SPEED, GameSpeed, gameSpeedLabel,
} from "../../data/gameSpeed";
import { imageToDataUrl } from "../../render/blputil";

/** One seat as the CREATE GAME page hands it to the lobby, and the lobby hands it to the match. */
export interface HdSeat {
  id: number;
  controller: Controller;
  ai: number;
  race: Race;
  team: number;
  handicap: number;
  color: number;
  /** The map declared this a computer player; the row is not ours to re-seat. */
  locked: boolean;
}

/** What the create page chooses for the match: the speed slider and Advanced Options. */
export interface HdMatchOptions {
  gameSpeed: GameSpeed;
  advanced: AdvancedOptions;
}

/** Everything the lobby needs: the picked map, its seats and the create page's choices. */
export interface HdCreateState {
  path: string;
  file: File;
  info: MapInfo;
  seats: HdSeat[];
  options: HdMatchOptions;
}

export interface HdSkirmishHandlers {
  onCreate: (state: HdCreateState) => void;
  onCancel: () => void;
}

interface Picked {
  path: string;
  file: File;
  info: MapInfo;
}

const MAP_EXT = /\.(w3m|w3x)$/i;

/** The three rungs the 3.0 create page's slider shows. The engine has a fourth (Fastest);
 *  a client that arrives with it lands on Fast, the rung the sheet draws at the right end. */
const SPEED_RUNGS = [GameSpeed.Slow, GameSpeed.Medium, GameSpeed.Fast];

/**
 * 3.0's CREATE GAME page (`SPCreateGame` + `CustomGamesCreate`): the map folders down the
 * middle, Game Speed, Advanced Options, Observers and Visibility down the left, and the picked
 * map's preview and CREATE button in the right-hand plate.
 *
 * `initial` is the state the lobby hands back when its Back is pressed, so a player who changes
 * their mind finds the folder, the map and the options where they left them.
 */
export async function mountHdSkirmish(
  container: HTMLElement,
  vfs: DataSource,
  maps: Map<string, File>,
  h: HdSkirmishHandlers,
  initial?: HdCreateState | null,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-skirmish");
  screen.element.classList.add("hd-official");
  const tft = !isRoc();
  if (tft) screen.element.classList.add("tft");

  const root = el("div", "CustomGames Official-CreateScreen");
  const content = el("div", "CustomGames-ContentContainer Official-ContentContainer");
  const panel = el("div", "CustomGames-MainPanel");
  const grid = el("div", "CustomGames-LeftPanel-Grid Official-CreateGrid");
  grid.append(
    el("div", "CustomGames-Background Official-Background"),
    baseFrame(tft),
  );

  // --- the title band and its Quick Filter --------------------------------------------
  const upper = el("div", "CustomGames-UpperLeftSection Official-UpperLeftSection Official-MatchHeader");
  const header = el("div", "Simple-Header");
  const title = el("div", "Simple-Header-Title");
  title.appendChild(el("div", "Simple-Header-TitleText", t("hd.createGame")));
  const subtitle = el("div", "Simple-Header-TitleSubText", t("hd.customGame"));
  title.appendChild(subtitle);
  header.appendChild(title);

  const searchSection = el("div", "Simple-Header-Listing-SearchSection");
  const searchField = el("div", "Simple-Header-Listing-SearchField");
  const searchWrap = el("div", "SearchInput-Wrapper");
  const search = el("input", "SearchInput") as HTMLInputElement;
  search.type = "text";
  search.placeholder = t("hd.quickFilter");
  search.spellcheck = false;
  searchWrap.append(search, el("div", "SearchInput-Overlay"));
  searchField.appendChild(searchWrap);
  searchSection.appendChild(searchField);
  header.appendChild(searchSection);
  upper.appendChild(header);

  // --- the options column --------------------------------------------------------------
  const body = el("div", "Official-CreateBody");
  const optionsColumn = el("div", "Official-CreateOptions");
  body.append(optionsColumn, el("div", "Vertical-Divider"));

  const options: HdMatchOptions = initial?.options ?? {
    gameSpeed: DEFAULT_GAME_SPEED,
    advanced: { ...DEFAULT_ADVANCED, computerPlus: computerPlusDefault() },
  };

  optionsColumn.append(
    optionBlock(
      t("hd.gameSpeed"),
      speedControl(options),
    ),
    optionBlock(
      t("hd.advancedOptions"),
      advancedList(options),
    ),
    optionRow([
      [t("hd.observers"), observerControl(options)],
      [t("hd.visibility"), visibilityControl(options)],
    ]),
  );

  // --- the map list ---------------------------------------------------------------------
  const listPane = el("div", "Official-CreateListPane");
  const list = el("div", "Official-List");
  // One column of file names, not the lobby's three-column table: takes out the two empty
  // cells the row builder always emits and lets long names wrap (official.css).
  list.classList.add("Official-FileList");
  const listFade = el("div", "Official-List-BottomFade");
  listPane.append(list, listFade);
  body.appendChild(listPane);

  grid.append(upper, body);

  // --- the right column -----------------------------------------------------------------
  const aside = el("div", "CustomGames-RightColumn Official-RightColumn Official-MatchSide");
  const sideInner = el("div", "Official-SideInner");
  const previewFrame = el("div", "Official-PreviewFrame");
  const previewImage = el("div", "Official-PreviewImage");
  previewFrame.appendChild(previewImage);

  const headerRow = el("div", "Official-PreviewHeader");
  const swords = el("div", "Official-SwordsIcon");
  const maxPlayers = el("div", "Official-MaxPlayerSize", "");
  swords.appendChild(maxPlayers);
  const mapName = el("div", "Official-MapName", "");
  headerRow.append(swords, mapName);

  const mapAuthor = el("div", "Official-MapAuthor", "");
  const details = el("div", "Official-Options");
  const action = el("div", "Official-ActionButton");
  sideInner.append(headerRow, mapAuthor, previewFrame, details, action);
  aside.append(el("div", "Official-Background"), baseFrame(tft), sideInner);

  panel.append(grid, aside);
  content.appendChild(panel);
  root.append(content);
  screen.content.appendChild(root);

  const back = backButton(screen.element, t("hd.back"), h.onCancel, {
    onSystemMenu: () => openSystemMenu(screen, vfs, {}),
    systemMenuLabel: t("hd.menu"),
  });

  const rescale = (): void => {
    const zoom = String(Math.max(0.25, window.innerHeight / 1080));
    root.style.zoom = zoom;
    back.style.zoom = zoom;
  };
  rescale();
  window.addEventListener("resize", rescale);

  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    window.removeEventListener("resize", rescale);
    dispose();
  };

  // --- state and painting ---------------------------------------------------------------
  const entries = [...maps.keys()]
    .filter((p) => MAP_EXT.test(p))
    .map((path) => ({ rel: mapRel(path), item: path }));

  let folder = initial ? mapFolder(initial.path) : "";
  let picked: Picked | null = initial
    ? { path: initial.path, file: initial.file, info: initial.info }
    : null;
  let reading = 0;

  const createButton = actionButton(t("hd.create"), () => create(), true);
  action.appendChild(createButton);

  if (picked) {
    subtitle.textContent = picked.info.name;
    paintInfo();
    markSelected();
  } else {
    paintInfo();
  }
  paintFiles();
  paintCreate();

  search.oninput = (): void => paintFiles();

  return screen.attach(container);

  // --- the folder browser ---------------------------------------------------------------
  /** A folder or map's name in this list: two lines, then an ellipsis. */
  function nameCell(name: string): HTMLElement {
    return el("span", "Official-FileName", name);
  }

  function paintFiles(): void {
    list.textContent = "";
    const { folders, files } = browseFolder(entries, folder, "\\");
    const needle = search.value.trim().toLowerCase();
    if (folder) {
      list.appendChild(
        listRow(["..", "", ""], () => {
          folder = parentFolder(folder, "\\");
          paintFiles();
        }, { icon: "up" }),
      );
    }
    for (const name of folders) {
      if (needle && !name.toLowerCase().includes(needle)) continue;
      list.appendChild(
        listRow([nameCell(name), "", ""], () => {
          folder = folder ? `${folder}\\${name}` : name;
          paintFiles();
        }, { icon: "folder" }),
      );
    }
    files.sort((a, b) => baseName(a).localeCompare(baseName(b)));
    for (const path of files) {
      if (needle && !baseName(path).toLowerCase().includes(needle)) continue;
      const row = listRow([nameCell(baseName(path)), "", ""], () => {
        void choose(path);
      }, { icon: "map", selected: picked?.path === path });
      row.dataset.mapPath = path;
      list.appendChild(row);
    }
    if (!list.childElementCount) list.appendChild(el("p", "Official-Empty", t("hd.noMaps")));
  }

  /** Re-mark rows in place: a pick must not rebuild the list, or a long folder jumps back to
   *  its first row under the pointer that just chose one near the bottom. */
  function markSelected(): void {
    for (const row of list.querySelectorAll<HTMLElement>(".Official-EntryRow")) {
      row.classList.toggle("Official-EntryRowSelected", row.dataset.mapPath === picked?.path);
    }
  }

  async function choose(path: string): Promise<void> {
    const file = maps.get(path);
    if (!file) return;
    const stamp = ++reading;
    let info: MapInfo | null = null;
    try {
      info = await readMapInfo(maps, path, vfs);
    } catch (err) {
      console.warn(`[Warcraft Open] HD map unreadable: ${path}`, err);
    }
    if (!info || stamp !== reading) return;
    picked = { path, file, info };
    subtitle.textContent = info.name;
    markSelected();
    paintInfo();
    paintCreate();
  }

  function paintInfo(): void {
    details.textContent = "";
    previewImage.style.backgroundImage = "";
    mapName.textContent = "";
    maxPlayers.textContent = "";
    mapAuthor.textContent = "";
    if (!picked) {
      subtitle.textContent = t("hd.customGame");
      details.appendChild(el("p", "Official-Empty", t("hd.pickMap")));
      return;
    }
    const info = picked.info;
    const picture = info.minimap ? imageToDataUrl(info.minimap) : null;
    if (picture) previewImage.style.backgroundImage = `url("${picture}")`;
    mapName.textContent = info.name;
    maxPlayers.textContent = String(info.maxPlayers);
    mapAuthor.textContent = [info.recommendedPlayers, info.tileset].filter(Boolean).join(" · ");

    details.append(
      settingsRow(t("hd.suggestedPlayers"), info.recommendedPlayers || String(info.maxPlayers)),
      settingsRow(t("hd.mapSize"), sizeWords(info.maxPlayers)),
      el("p", "Official-OptionsDescription", info.description || t("hd.noDescription")),
    );
  }

  function paintCreate(): void {
    setActionEnabled(createButton, !!picked);
  }

  function create(): void {
    if (!picked) return;
    const seats = initial?.path === picked.path ? initial.seats : seatMap(picked.info);
    h.onCreate({
      path: picked.path,
      file: picked.file,
      info: picked.info,
      seats,
      options: { ...options, advanced: { ...options.advanced } },
    });
  }
}

/** The seats a map opens with: on a melee map the first slot is you and the rest are computers
 *  on Random; on a custom map the spare seats stay Open and keep the map's own races and teams,
 *  and a slot the map declared a computer is never re-seatable. */
export function seatMap(info: MapInfo): HdSeat[] {
  const localIndex = Math.max(0, info.slots.findIndex((s) => s.controller === "user"));
  const spare: Controller = info.isMelee ? "computer" : "open";
  return info.slots.map((s, i) => {
    const melee = meleeSeat(i, info.slots.length);
    return {
      id: s.id,
      controller: s.controller === "computer" ? "computer" : i === localIndex ? "user" : spare,
      ai: MELEE_NORMAL,
      race: info.isMelee ? melee.race : s.defaultRace,
      team: info.isMelee ? melee.team : s.team,
      handicap: 100,
      color: s.id,
      locked: s.controller === "computer",
    };
  });
}

/** The match config the lobby's START GAME hands to the engine. */
export function seatsToConfig(
  seats: readonly HdSeat[],
  info: MapInfo,
  options: HdMatchOptions,
): MeleeConfig {
  const playing: SlotConfig[] = seats
    .filter((s) => s.controller === "user" || s.controller === "computer")
    .map((s) => {
      const mapSlot = info.slots.find((m) => m.id === s.id);
      return {
        id: s.id,
        controller: s.controller,
        race: s.race,
        team: s.team,
        color: s.color,
        startX: mapSlot?.startX ?? 0,
        startY: mapSlot?.startY ?? 0,
        name: mapSlot?.name,
        ...(s.controller === "computer"
          ? { aiDifficulty: s.ai, aiPlus: options.advanced.computerPlus }
          : {}),
        ...(s.controller === "user" ? { playerName: profilePlayerName() } : {}),
      };
    });
  for (const p of info.neutralPlayers) {
    playing.push({
      id: p.id, controller: p.controller, race: p.defaultRace, team: p.team,
      startX: p.startX, startY: p.startY, name: p.name,
    });
  }
  const fog: FogMode = visibilityFog(options.advanced.visibility, startsExplored(info.classification.flags));
  return {
    slots: playing,
    fog,
    forces: info.forces.map((f) => ({ allied: f.allied, sharedVision: f.sharedVision })),
    seed: 1 + Math.floor(Math.random() * 2147483645),
    lockTeams: options.advanced.lockTeams,
    sharedControl: options.advanced.sharedControl,
    allTalk: options.advanced.allTalk,
    gameSpeed: options.gameSpeed,
  };
}

/** A 3.0 `.Primary-Button` in the blue plate, inside the framed secondary button the right
 *  column uses for CREATE / START GAME. */
export function actionButton(label: string, onClick: () => void, disabled = false): HTMLElement {
  const frame = el("div", "Framed-Secondary-Button");
  const alt = el("div", "Primary-Button-Frame-Alternate-B");
  alt.appendChild(primaryButton(label, onClick, "Primary-Button-Blue", disabled));
  frame.appendChild(alt);
  return frame;
}

/** Enable/disable the `.Primary-Button` inside a framed action button. The frame itself is
 *  only a plate; the state and the handler live on the button it wraps. */
export function setActionEnabled(frame: HTMLElement, enabled: boolean): void {
  const button = frame.querySelector<HTMLElement>(".Primary-Button");
  if (!button) return;
  button.classList.toggle("isDisabled", !enabled);
  button.setAttribute("aria-disabled", String(!enabled));
}

/** A dropdown built from the lobby sheet's own `.GameLobbyDropdown` markup. */
export function officialDropdown(
  className: string,
  choices: readonly { value: string; label: string }[],
  initial: string,
  onChange: (value: string) => void,
  head?: HTMLElement,
): HTMLElement {
  const root = el("div", `GameLobbyDropdown ${className}`.trim());
  const plate = el("div", "GameLobbyDropdown-Selected-Item");
  const label = head ?? el("span", "", "");
  plate.appendChild(label);
  const menu = el("div", "GameLobbyDropdown-Options");

  let current = initial;

  const items = choices.map((choice) => {
    const item = el("div", "", choice.label);
    item.dataset.value = choice.value;
    item.onclick = (): void => {
      if (root.classList.contains("isDisabled")) return;
      current = choice.value;
      if (!head) label.textContent = choice.label;
      root.classList.remove("isOpen");
      onChange(choice.value);
    };
    menu.appendChild(item);
    return item;
  });

  const paint = (): void => {
    if (!head) {
      label.textContent = choices.find((c) => c.value === current)?.label ?? "";
    }
    for (const item of items) {
      item.classList.toggle("isSelected", item.dataset.value === current);
    }
  };

  plate.onclick = (): void => {
    if (root.classList.contains("isDisabled")) return;
    root.classList.toggle("isOpen");
  };

  // A click elsewhere puts the list away, as 3.0's own dropdowns do. The listener also drops
  // itself once the screen that owns the control is gone.
  const closeOutside = (event: PointerEvent): void => {
    if (!root.isConnected) {
      document.removeEventListener("pointerdown", closeOutside, true);
      return;
    }
    const target = event.target as Node | null;
    if (!target || root.contains(target)) return;
    root.classList.remove("isOpen");
  };
  document.addEventListener("pointerdown", closeOutside, true);

  root.append(plate, menu);
  paint();
  return root;
}

/** One heading + control in the create page's left column. */
function optionBlock(label: string, control: HTMLElement): HTMLElement {
  const block = el("div", "Official-OptionBlock");
  block.append(el("div", "Official-OptionLabel", label), control);
  return block;
}

/** Two headed controls side by side (OBSERVERS / VISIBILITY). */
function optionRow(pairs: Array<[string, HTMLElement]>): HTMLElement {
  const row = el("div", "Official-OptionRow");
  for (const [label, control] of pairs) {
    const column = el("div", "Official-OptionColumn");
    column.append(el("div", "Official-OptionLabel", label), control);
    row.appendChild(column);
  }
  return row;
}

/** The three-rung game-speed slider. */
function speedControl(options: HdMatchOptions): HTMLElement {
  const holder = el("div", "Official-SliderHolder");
  const slider = el("input", "Official-Slider") as HTMLInputElement;
  slider.type = "range";
  slider.min = "0";
  slider.max = String(SPEED_RUNGS.length - 1);
  slider.step = "1";
  slider.value = String(Math.max(0, SPEED_RUNGS.indexOf(options.gameSpeed)));
  slider.oninput = (): void => {
    options.gameSpeed = SPEED_RUNGS[Number(slider.value)] ?? DEFAULT_GAME_SPEED;
  };
  const labels = el("div", "Official-SliderLabels");
  labels.append(
    el("span", "", t("hd.slow")),
    el("span", "", t("hd.normal")),
    el("span", "", t("hd.fast")),
  );
  holder.append(slider, labels);
  return holder;
}

/** The five Advanced Options checkboxes of the 3.0 create page. */
function advancedList(options: HdMatchOptions): HTMLElement {
  const list = el("div", "Official-AdvancedList");
  const rows: Array<[keyof AdvancedOptions & ("lockTeams" | "teamsTogether" | "sharedControl" | "randomRaces" | "randomHero"), string]> = [
    ["lockTeams", t("hd.lockTeams")],
    ["teamsTogether", t("hd.teamsTogether")],
    ["sharedControl", t("hd.sharedControl")],
    ["randomRaces", t("hd.randomRaces")],
    ["randomHero", t("hd.randomHero")],
  ];
  for (const [key, label] of rows) {
    const container = el("div", "Checkbox-Container");
    const checkbox = el("div", "Checkbox");
    checkbox.setAttribute("role", "checkbox");
    checkbox.tabIndex = 0;
    const box = el("div", options.advanced[key] ? "Checkbox-Button-Checked" : "Checkbox-Button-Unchecked");
    checkbox.append(box, el("div", "Checkbox-Label", label));
    const toggle = (): void => {
      options.advanced[key] = !options.advanced[key];
      box.className = options.advanced[key] ? "Checkbox-Button-Checked" : "Checkbox-Button-Unchecked";
      checkbox.setAttribute("aria-checked", String(options.advanced[key]));
    };
    checkbox.onclick = toggle;
    checkbox.onkeydown = (event): void => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    };
    checkbox.setAttribute("aria-checked", String(options.advanced[key]));
    container.appendChild(checkbox);
    list.appendChild(container);
  }
  return list;
}

const OBSERVER_LABELS = {
  FULL_OBSERVERS: "hd.fullObservers",
  OBSERVERS_ON_DEFEAT: "hd.observersOnDefeat",
  REFEREES: "hd.referees",
  NO_OBSERVERS: "hd.noObservers",
} as const satisfies Record<ObserverSetting, string>;

const VISIBILITY_LABELS = {
  DEFAULT: "hd.default",
  HIDE_TERRAIN: "hd.hideTerrain",
  MAP_EXPLORED: "hd.mapExplored",
  ALWAYS_VISIBLE: "hd.alwaysVisible",
} as const satisfies Record<Visibility, string>;

/** The lobby summary's word for an Observers choice. */
export function observerLabel(value: ObserverSetting): string {
  return t(OBSERVER_LABELS[value]);
}

/** The lobby summary's word for a Visibility choice. */
export function visibilityLabel(value: Visibility): string {
  return t(VISIBILITY_LABELS[value]);
}

function observerControl(options: HdMatchOptions): HTMLElement {
  const choices = OBSERVER_ITEMS.map((value) => ({ value, label: observerLabel(value) }));
  return officialDropdown("Official-Select", choices, options.advanced.observers, (value) => {
    options.advanced.observers = value as ObserverSetting;
  });
}

function visibilityControl(options: HdMatchOptions): HTMLElement {
  const choices = VISIBILITY_ITEMS.map((value) => ({ value, label: visibilityLabel(value) }));
  return officialDropdown("Official-Select", choices, options.advanced.visibility, (value) => {
    options.advanced.visibility = value as Visibility;
  });
}

/** The metal frame with its two chains, as every 3.0 list screen wears it. */
export function baseFrame(tft: boolean): HTMLElement {
  const base = el("div", "BaseFrame Official-BaseFrame Official-MatchFrame");
  const themed = tft ? " tft" : "";
  base.append(
    el("div", `left-chain${themed}`),
    el("div", `right-chain${themed}`),
    el("div", `frame${themed}`),
    el("div", `background-texture${themed}`),
  );
  return base;
}

export function settingsRow(label: string, value: string): HTMLElement {
  const row = el("div", "Official-SettingsRow");
  row.append(
    el("div", "Official-SettingsLabel", label),
    el("div", "Official-SettingsValue", value),
  );
  return row;
}

function baseName(path: string): string {
  const file = path.split("\\").pop() ?? path;
  return file.replace(MAP_EXT, "");
}

/** The browsed path: an install map path without the `Maps\` root the screen starts from. */
function mapRel(path: string): string {
  return path.replace(/^Maps\\/i, "");
}

/** The folder a map lives in, for a create page opened back from the lobby. */
function mapFolder(path: string): string {
  const rel = mapRel(path);
  const cut = rel.lastIndexOf("\\");
  return cut < 0 ? "" : rel.slice(0, cut);
}

/** The game's buckets by player count (`UI\MiscData.txt [BattleNetCustomFilter]`). */
function sizeWords(players: number): string {
  const bucket = mapSizeLabel(players);
  if (bucket === "Small") return t("mapinfo.size.small");
  if (bucket === "Medium") return t("mapinfo.size.medium");
  return t("mapinfo.size.large");
}

/** The label a game-speed rung wears in the lobby summary. */
export function speedLabel(speed: GameSpeed): string {
  return gameSpeedLabel(speed, null);
}
