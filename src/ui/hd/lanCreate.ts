import { computerPlusDefault } from "../../data/options";
import { GAME_SPEED_MAX, GAME_SPEED_MIN, toGameSpeed } from "../../data/gameSpeed";
import { ownHostLabel, relayAuthority, type HostTarget, type LanLobby } from "../../net/lobby";
import { officialServerName } from "../../net/officialServer";
import {
  DEFAULT_ADVANCED, OBSERVER_ITEMS, VISIBILITY_ITEMS,
  type AdvancedOptions, type ObserverSetting, type Visibility,
} from "../../net/advancedOptions";
import type { DataSource } from "../../vfs/types";
import type { MapInfo } from "../../world/mapInfo";
import type { FdfScreen } from "../fdf/render";
import { readMapInfo } from "../mapBrowser";
import { savedPlayerName } from "../fdfLan";
import type { LanCreateHandlers } from "../fdfLanCreate";
import { HdScreen, el } from "./screen";
import { webUiAssets } from "./assets";
import { browseFolder, parentFolder } from "./browse";
import { loadOfficialStyle } from "./official";
import { openSystemMenu } from "./systemMenu";
import { framed, imgDetailsRow, listRow, primaryButton } from "./officialMenu";
import { lanShell, speedText } from "./lan";
import { dropdown } from "./dropdown";
import { touchDevice } from "../gesture/device";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";
import { imageToDataUrl } from "../../render/blputil";

/** Where the host last announced a game (a `HostTarget.url`, "" for this computer). */
const HOST_SERVER_KEY = "warcraft-open.hostServer";

const MAP_EXT = /\.(w3m|w3x)$/i;

interface Picked {
  path: string;
  file: File;
  info: MapInfo;
}

/**
 * The Reforged "Create Game" screen: the same `LANGames` band as the browser, with the map
 * folder down the left and the picked map, the game's name and its Advanced Options on the
 * right. Create Game announces the room and the host lands in the lobby.
 *
 * The options are the FDF screen's own (ui/fdfLanCreate.ts): the seven switches, the Observers
 * and Visibility menus, the Server menu that says where the room goes up, and the four-step
 * Game Speed, opening on Fast. What the host sets here is fixed for the room's life.
 */
export async function mountHdLanCreateScreen(
  container: HTMLElement,
  vfs: DataSource,
  maps: Map<string, File>,
  lobby: LanLobby,
  h: LanCreateHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-lan-create");
  screen.element.classList.add("hd-official");
  if (!isRoc()) screen.element.classList.add("tft");

  const shell = lanShell(screen, {
    title: t("lan.createGame"),
    subtitle: t("lan.gamesInfo"),
    assets,
    selected: "create",
    onBack: () => h.onCancel(),
    onTab: (tab) => { if (tab === "games") h.onCancel(); },
    columns: [t("hd.name"), "", ""],
    bottomRow: false,
    onSystemMenu: () => openSystemMenu(screen, vfs, {}),
  });
  const { list, aside, listHeader } = shell;
  // The create screen's rows are files and folders — one column, wrapped names — not the
  // browser's three-column table (official.css keys both rules off this class). The header
  // wears it too, so its two empty column titles collapse with the cells.
  list.classList.add("Official-FileList");
  listHeader.classList.add("Official-FileList");

  // --- the map list -----------------------------------------------------------------
  const entries = [...maps.keys()]
    .filter((p) => MAP_EXT.test(p))
    .map((path) => ({ rel: mapRel(path), item: path }));
  let folder = "";
  let picked: Picked | null = null;
  let reading = 0;
  // Two pages: pick the map, then set the game's name and rules without squeezing them into
  // the detail column. The map list and the settings sheet share the band's row area.
  let step: "map" | "settings" = "map";

  // --- the options ------------------------------------------------------------------
  const advanced: AdvancedOptions = { ...DEFAULT_ADVANCED, computerPlus: computerPlusDefault() };
  let gameName = t("hd.localGameName", { name: savedPlayerName() });
  let server: string | null = null;
  try { server = localStorage.getItem(HOST_SERVER_KEY); } catch { /* no storage: no memory */ }

  const gameNameField = el("input", "Official-Field LANGames-GameNameField") as HTMLInputElement;
  gameNameField.value = gameName;
  gameNameField.maxLength = 40;
  gameNameField.oninput = (): void => { gameName = gameNameField.value; };

  // The four menus wear the front end's dropdown control (3.0's popup plate), not a native
  // `<select>` whose list would be the browser's.
  const speedPicker = dropdown([], String(advanced.gameSpeed), (v) => {
    advanced.gameSpeed = toGameSpeed(v);
  });
  const observersPicker = dropdown([], advanced.observers, (v) => {
    advanced.observers = v as ObserverSetting;
  });
  const visibilityPicker = dropdown([], advanced.visibility, (v) => {
    advanced.visibility = v as Visibility;
  });
  const serverPicker = dropdown([], "", (v) => {
    server = v;
    try { localStorage.setItem(HOST_SERVER_KEY, v); } catch { /* no storage: no memory */ }
  });

  const toggles: Array<[keyof AdvancedOptions & ("lockTeams" | "teamsTogether" | "sharedControl" | "randomRaces" | "randomHero" | "computerPlus" | "allTalk"), string]> = [
    ["lockTeams", t("hd.lockTeams")],
    ["teamsTogether", t("hd.teamsTogether")],
    ["sharedControl", t("hd.sharedControl")],
    ["randomRaces", t("hd.randomRaces")],
    ["randomHero", t("hd.randomHero")],
    ["computerPlus", t("hd.computerPlus")],
    ["allTalk", t("hd.allTalk")],
  ];

  // The plate's wood action band carries the step's own buttons: Next on the map page, then
  // Previous + Create on the settings page. The corner Back is the shell's own.
  const nextButton = primaryButton(t("hd.next"), () => openSettings(), "", true);
  nextButton.classList.add("Primary-Button-Blue");
  const nextFrame = framed(nextButton);

  const prevButton = primaryButton(t("hd.previous"), () => openMapStep());
  const prevFrame = framed(prevButton);

  const createButton = primaryButton(t("lan.createGame"), () => create(), "", true);
  createButton.classList.add("Primary-Button-Blue");
  const createFrame = framed(createButton);

  aside.action.append(prevFrame, createFrame, nextFrame);

  paintList();
  paintInfo();
  paintActions();

  return screen.attach(container);

  // --- folder browser ---------------------------------------------------------------
  function paintFiles(): void {
    list.textContent = "";
    const { folders, files } = browseFolder(entries, folder, "\\");
    if (folder) {
      list.appendChild(
        listRow(["..", "", ""], () => {
          folder = parentFolder(folder, "\\");
          paintFiles();
        }, { icon: "up" }),
      );
    }
    for (const name of folders) {
      list.appendChild(
        listRow([nameCell(name), "", ""], () => {
          folder = folder ? `${folder}\\${name}` : name;
          paintFiles();
        }, { icon: "folder" }),
      );
    }
    files.sort((a, b) => baseName(a).localeCompare(baseName(b)));
    for (const path of files) {
      const row = listRow([nameCell(baseName(path)), "", ""], () => void choose(path), {
        icon: "map",
        selected: picked?.path === path,
      });
      row.dataset.mapPath = path;
      list.appendChild(row);
    }
    if (!list.childElementCount) list.appendChild(el("p", "Official-Empty", t("hd.noMaps")));
  }

  /** Re-mark the rows in place, so picking one does not scroll the folder back to its top. */
  function markSelected(): void {
    for (const row of list.querySelectorAll<HTMLElement>(".Official-EntryRow")) {
      row.classList.toggle("Official-EntryRowSelected", row.dataset.mapPath === picked?.path);
    }
  }

  async function choose(path: string): Promise<void> {
    const file = maps.get(path);
    if (!file) return;
    const stamp = ++reading;
    const info = await readMapInfo(maps, path, vfs).catch((err: unknown) => {
      console.warn(`[Warcraft Open] HD map unreadable: ${path}`, err);
      return null;
    });
    if (!info || stamp !== reading) return;
    picked = { path, file, info };
    markSelected();
    paintInfo();
    paintBottom();
  }

  // --- the two pages ----------------------------------------------------------------
  function paintList(): void {
    if (step === "map") paintFiles();
    else paintSettings();
  }

  function openSettings(): void {
    if (!picked) return;
    step = "settings";
    listHeader.style.display = "none";
    paintList();
    paintActions();
    paintInfo();
    list.scrollTop = 0;
  }

  function openMapStep(): void {
    step = "map";
    listHeader.style.display = "";
    paintList();
    paintActions();
    paintInfo();
    list.scrollTop = 0;
  }

  /**
   * The settings page: the game's name, the seven rule switches and the four menus as a
   * two-column sheet in the list's width, where each control has room to state its own value.
   */
  function paintSettings(): void {
    list.textContent = "";
    const page = el("div", "LAN-SettingsPage");
    page.append(
      el("div", "LANGames-AdvancedTitle", t("hd.gameOptions")),
      el("p", "LAN-SettingsHint", t("hd.settingsHint")),
    );

    const nameRow = el("div", "Official-SettingsRow LANGames-NameRow LAN-SettingsName");
    nameRow.append(el("div", "Official-SettingsLabel", t("hd.gameName")), gameNameField);
    page.appendChild(nameRow);

    // Two grids, so the odd number of switches cannot shift the menu pairs: the switches
    // read left-to-right, and the four menus always pair 观察者/视野 and 服务器/游戏速度.
    const switches = el("div", "LAN-SettingsGrid");
    for (const [key, label] of toggles) {
      const row = el("button", `LANGames-Toggle${advanced[key] ? " isOn" : ""}`);
      row.type = "button";
      row.setAttribute("role", "switch");
      row.setAttribute("aria-checked", advanced[key] ? "true" : "false");
      const check = el("span", `hd-check${advanced[key] ? " on" : ""}`);
      row.append(el("span", "LANGames-ToggleLabel", label), check);
      row.onclick = (): void => {
        advanced[key] = !advanced[key];
        row.classList.toggle("isOn", advanced[key]);
        row.setAttribute("aria-checked", advanced[key] ? "true" : "false");
        check.classList.toggle("on", advanced[key]);
      };
      switches.appendChild(row);
    }
    page.appendChild(switches);

    const menus = el("div", "LAN-SettingsGrid LAN-SettingsMenus");
    menus.append(
      advancedField(t("hd.observers"), observersPicker.element),
      advancedField(t("hd.visibility"), visibilityPicker.element),
      advancedField(t("hd.server"), serverPicker.element),
      advancedField(t("hd.gameSpeed"), speedPicker.element),
    );
    page.appendChild(menus);

    list.appendChild(page);
    fillOptions();
  }

  // --- the right column -------------------------------------------------------------
  function paintInfo(): void {
    aside.details.textContent = "";
    aside.previewImage.style.backgroundImage = "";
    aside.mapName.textContent = "";
    aside.maxPlayers.textContent = "";
    aside.mapAuthor.textContent = "";
    if (!picked) {
      aside.details.appendChild(el("p", "Official-Empty", t("hd.pickMap")));
      return;
    }
    const info = picked.info;
    if (info.minimap) aside.previewImage.style.backgroundImage = `url("${imageToDataUrl(info.minimap)}")`;
    aside.mapName.textContent = info.name;
    aside.maxPlayers.textContent = String(info.maxPlayers);
    aside.mapAuthor.textContent = [info.recommendedPlayers, info.tileset].filter(Boolean).join(" · ");

    aside.details.append(
      el("p", "Official-OptionsDescription", info.description || t("hd.noDescription")),
      imgDetailsRow(t("hd.playersCount"), info.recommendedPlayers || String(info.maxPlayers)),
      imgDetailsRow(t("hd.mapSize"), String(info.maxPlayers)),
      imgDetailsRow(t("hd.tileset"), info.tileset || "—"),
    );
  }

  function fillOptions(): void {
    observersPicker.setChoices(
      OBSERVER_ITEMS.map((v) => ({ value: v, label: pretty(v) })),
      advanced.observers,
    );
    visibilityPicker.setChoices(
      VISIBILITY_ITEMS.map((v) => ({ value: v, label: pretty(v) })),
      advanced.visibility,
    );
    speedPicker.setChoices(
      Array.from({ length: GAME_SPEED_MAX - GAME_SPEED_MIN + 1 }, (_, i) => {
        const speed = toGameSpeed(GAME_SPEED_MIN + i);
        return { value: String(speed), label: speedText(speed) };
      }),
      String(advanced.gameSpeed),
    );
    fillServers();
  }

  function fillServers(): void {
    const targets = lobby.hostTargets;
    const where = target();
    serverPicker.setChoices(
      targets.map((x) => ({ value: x.url, label: targetLabel(x) })),
      where?.url ?? "",
    );
    serverPicker.setDisabled(targets.length < 2);
    paintBottom();
  }

  function target(): HostTarget | null {
    const targets = lobby.hostTargets;
    const chosen = targets.find((x) => x.url === server);
    if (chosen) return chosen;
    // In the Android shell the page comes off the internet, so "this computer" is the cloud
    // relay; the phone's own embedded relay is handed to us as a discovered (`found`) server
    // (MainActivity's bridge → src/net/discovery.ts) and that is where a LAN game belongs.
    if (touchDevice().platform === "android-webview") {
      const lan = targets.find((x) => x.kind === "found");
      if (lan) return lan;
    }
    return lobby.officialUrls.map((url) => targets.find((x) => x.url === url)).find((x) => !!x)
      ?? targets[0]
      ?? null;
  }

  function targetLabel(x: HostTarget | null): string {
    if (!x) return "—";
    if (x.kind === "own") {
      // The hosted copy serves Warcraft Open's own relay, so a game created "here" is created
      // on Warcraft Open — not on this player's machine.
      const official = lobby.servedOfficialUrl;
      return official
        ? officialServerName(relayAuthority(official))
        : ownHostLabel(t("hd.thisComputer"), lobby.snapshot.host);
    }
    if (x.kind === "official") return officialServerName(relayAuthority(x.url));
    return relayAuthority(x.url);
  }

  function paintActions(): void {
    nextFrame.style.display = step === "map" ? "" : "none";
    prevFrame.style.display = step === "settings" ? "" : "none";
    createFrame.style.display = step === "settings" ? "" : "none";
    paintBottom();
  }

  function paintBottom(): void {
    const canNext = !!picked;
    nextButton.classList.toggle("isDisabled", !canNext);
    nextButton.setAttribute("aria-disabled", String(!canNext));
    const ready = !!picked && !!target();
    createButton.classList.toggle("isDisabled", !ready);
    createButton.setAttribute("aria-disabled", String(!ready));
  }

  function create(): void {
    const where = target();
    if (!picked || !where) return;
    h.onCreate(picked.path, picked.info, gameName, { ...advanced }, where.url);
  }

  // The Server menu follows the lobby: a server answering (or dropping) changes what can be
  // offered with nobody having clicked anything.
  let alive = true;
  lobby.onChange = () => { if (alive) fillServers(); };
  const disposeScreen = screen.dispose.bind(screen);
  screen.dispose = (): void => { alive = false; disposeScreen(); };
}

function advancedField(label: string, field: HTMLElement): HTMLElement {
  const row = el("div", "LANGames-AdvancedRow");
  row.append(el("span", "LANGames-AdvancedLabel", label), field);
  return row;
}

function baseName(path: string): string {
  const file = path.split("\\").pop() ?? path;
  return file.replace(MAP_EXT, "");
}

/** A folder or map's name in the create screen's one-column list: two lines, then an ellipsis. */
function nameCell(name: string): HTMLElement {
  return el("span", "Official-FileName", name);
}

/** The browsed path: an install map path without the `Maps\` root the list starts from. */
function mapRel(path: string): string {
  return path.replace(/^Maps\\/i, "");
}

/** The menu values are GlobalStrings keys; the HD screen has no FDF library, so it prints them
 *  from its own translations (the same wordings the FDF screens resolve). */
const ADVANCED_LABEL_KEYS: Record<string, Parameters<typeof t>[0]> = {
  FULL_OBSERVERS: "hd.fullObservers",
  OBSERVERS_ON_DEFEAT: "hd.observersOnDefeat",
  REFEREES: "hd.referees",
  NO_OBSERVERS: "hd.noObservers",
  DEFAULT: "hd.default",
  HIDE_TERRAIN: "hd.hideTerrain",
  MAP_EXPLORED: "hd.mapExplored",
  ALWAYS_VISIBLE: "hd.alwaysVisible",
};

function pretty(key: string): string {
  const mapped = ADVANCED_LABEL_KEYS[key];
  if (mapped) return t(mapped);
  return key
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
