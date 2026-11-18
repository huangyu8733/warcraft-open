import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { webUiAssets, type WebUiAssets } from "./assets";
import { HdScreen, el } from "./screen";
import { loadOfficialStyle } from "./official";
import {
  backButton,
  baseFrame,
  cornerDecorations,
  framed,
  imgDetailsButton,
  imgDetailsDividers,
  imgDetailsMap,
  imgDetailsOptions,
  imgDetailsRow,
  listRow,
  primaryButton,
} from "./officialMenu";
import { t } from "../../i18n";
import { edition, isRoc } from "../../data/edition";
import { flavor } from "../../data/flavor";
import { DEFAULT_GAME_SPEED, GameSpeed, toGameSpeed } from "../../data/gameSpeed";
import { reachabilityLine, type LanLobby, type LobbyState } from "../../net/lobby";
import { showJoinAddressDialog, type JoinAddressDialog } from "../joinAddressDialog";
import { showMapDownload } from "../mapDownload";
import { localMapPath, requestMapWriteAccess } from "../../assets/downloadedMaps";
import { baseName, readMapInfo } from "../mapBrowser";
import type { MapInfo } from "../../world/mapInfo";
import { savedPlayerName, type LanHandlers } from "../fdfLan";
import { imageToDataUrl } from "../../render/blputil";

/** The right-hand plate both LAN screens carry: the picked map's picture and details. */
export interface LanAside {
  root: HTMLElement;
  previewImage: HTMLElement;
  mapName: HTMLElement;
  maxPlayers: HTMLElement;
  mapAuthor: HTMLElement;
  /** The scrolling detail column (description, settings, options). */
  details: HTMLElement;
  /** The framed action button row under the details. */
  action: HTMLElement;
}

export interface LanShell {
  root: HTMLElement;
  grid: HTMLElement;
  /** The column header strip above the rows (hidden on the create screen's settings page). */
  listHeader: HTMLElement;
  /** The scrolling row container (the browser's games, the create screen's maps). */
  list: HTMLElement;
  /** The status line under the list. */
  status: HTMLElement;
  aside: LanAside;
  /** The framed button row under the list, when the screen asked for one. */
  bottom: HTMLElement | null;
  tabs: { games: HTMLButtonElement; create: HTMLButtonElement };
  /** The player's name box, on the screens that carry one. */
  nameField: HTMLInputElement | null;
  serversButton: HTMLElement | null;
}

/**
 * The 3.0 LAN shell (`LANGames`): title band, category tabs, the list column and the map plate.
 * The browser and the create screen are the same band with different contents, exactly as they
 * are in the official sheet, so the band is built once here.
 */
export function lanShell(
  screen: HdScreen,
  opts: {
    title: string;
    subtitle: string;
    /** The install's WebUI art, for the window's corner decorations. */
    assets: WebUiAssets;
    selected: "games" | "create";
    onBack: () => void;
    onTab: (tab: "games" | "create") => void;
    onServers?: () => void;
    columns: [string, string, string];
    /** Add the framed button row under the list (the create screen's Create/Cancel). */
    bottomRow?: boolean;
    /** The player's name box in the tab strip, and the Servers List beside it. */
    nameField?: boolean;
  },
): LanShell {
  const root = el("div", "LANGames");
  const band = el("div", "LANGames-ContentContainer");
  const panel = el("div", "LANGames-MainPanel");
  const grid = el("div", `LANGames-LeftPanel-Grid${opts.bottomRow ? " with-bottom" : ""}`);

  const upper = el("div", "LANGames-UpperLeftSection Official-UpperLeftSection");
  const header = el("div", "Simple-Header");
  const title = el("div", "Simple-Header-Title");
  title.append(
    el("div", "Simple-Header-TitleText", opts.title),
    el("div", "Simple-Header-TitleSubText", opts.subtitle),
  );
  header.appendChild(title);
  upper.appendChild(header);

  const strip = el("div", "LANGames-TitleFrame");
  const tabs = el("div", "LANGames-ButtonSection");
  const gamesTab = el("button", `Tab-Button${opts.selected === "games" ? " Tab-Button-Selected" : ""}`, t("hd.games"));
  const createTab = el("button", `Tab-Button${opts.selected === "create" ? " Tab-Button-Selected" : ""}`, t("hd.create"));
  gamesTab.type = "button";
  createTab.type = "button";
  gamesTab.onclick = (): void => opts.onTab("games");
  createTab.onclick = (): void => opts.onTab("create");
  tabs.append(gamesTab, createTab);
  strip.appendChild(tabs);

  let nameField: HTMLInputElement | null = null;
  let serversButton: HTMLElement | null = null;
  if (opts.nameField) {
    const nameSection = el("div", "LANGames-MatchNameSection");
    nameField = el("input", "Official-Field LANGames-NameField") as HTMLInputElement;
    nameField.value = savedPlayerName();
    nameField.maxLength = 24;
    nameField.onchange = (): void =>
      localStorage.setItem("warcraft-open.playerName", nameField?.value.trim() || savedPlayerName());
    serversButton = primaryButton(t("lan.serversList"), () => opts.onServers?.());
    nameSection.append(el("span", "LANGames-FieldLabel", t("hd.playerName")), nameField, serversButton);
    strip.appendChild(nameSection);
  }

  const lower = el("div", "LANGames-LowerLeftSection");
  const listFrame = el("div", "Official-ListFrame");
  const listHeader = el("div", "Official-ListHeader");
  opts.columns.forEach((label, i) => {
    listHeader.appendChild(el("div", `Official-Col Official-Col${i}`, label));
  });
  const list = el("div", "Official-List");
  listFrame.append(listHeader, list, el("div", "Official-List-BottomFade"));
  const status = el("div", "LANGames-Status");
  lower.append(listFrame, status);

  const base = el("div", "BaseFrame Official-BaseFrame");
  const themed = isRoc() ? "" : " tft";
  base.append(
    el("div", `left-chain${themed}`),
    el("div", `right-chain${themed}`),
    el("div", `frame${themed}`),
    el("div", "background-texture"),
  );
  grid.append(upper, strip, lower, base);

  const bottom = opts.bottomRow ? el("div", "LANGames-BottomRow Official-BottomRow") : null;
  if (bottom) grid.appendChild(bottom);

  const aside = buildAside();
  panel.append(grid, aside.root);
  band.append(panel);
  root.append(el("div", "Official-Background"), band);
  screen.content.appendChild(root);
  // The back control is the sheet's corner frame, outside the plate, on every file screen.
  backButton(root, t("hd.back"), opts.onBack);
  screen.element.appendChild(cornerDecorations(opts.assets, !isRoc()));

  // 3.0 authors the band at 1080 lines and zooms with the window (`GetScale`).
  const rescale = (): void => {
    root.style.zoom = String(Math.max(0.5, window.innerHeight / 1080));
  };
  rescale();
  window.addEventListener("resize", rescale);
  const disposeScreen = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    window.removeEventListener("resize", rescale);
    disposeScreen();
  };

  return {
    root,
    grid,
    listHeader,
    list,
    status,
    aside,
    bottom,
    tabs: { games: gamesTab, create: createTab },
    nameField,
    serversButton,
  };
}

/**
 * The right-hand plate, built from the same ImgDetails pieces the saved-games and replay
 * screens wear: the black plate + metal BaseFrame, the map header, the 330px preview, the
 * scrolling options column and the wood action band. Only the nodes the LAN screens repaint
 * are returned, so both LAN screens keep their existing update code.
 */
function buildAside(): LanAside {
  const root = el("div", "ImgDetails-GameDetailsWrapper");
  root.append(el("div", "ImgDetails-Background"), baseFrame());

  const frame = el("div", "ImgDetails-GameDetailsFrame");

  const headerBg = el("div", "ImgDetails-Details-Header-Background");
  const header = el("div", "ImgDetails-MapPreviewHeader");
  const swords = el("div", "ImgDetails-SwordsIcon");
  const maxPlayers = el("div", "ImgDetails-MaxPlayerSize", "");
  swords.appendChild(maxPlayers);
  const name = el("div", "ImgDetails-NameAndAuthor");
  const mapName = el("div", "ImgDetails-MapName", "");
  const mapAuthor = el("div", "ImgDetails-MapAuthor", "");
  name.append(mapName, mapAuthor);
  header.append(swords, name, el("div", "ImgDetails-SwordsIcon-OtherSide"));
  headerBg.appendChild(header);

  const preview = imgDetailsMap();
  const options = imgDetailsOptions();
  const details = options.querySelector(".ImgDetails-Options") as HTMLElement;
  const actionContainer = imgDetailsButton();
  const action = actionContainer.querySelector(".ImgDetails-PlayGameBtn") as HTMLElement;

  frame.append(headerBg, preview.node, options, actionContainer, ...imgDetailsDividers());
  root.appendChild(frame);
  return { root, previewImage: preview.image, mapName, maxPlayers, mapAuthor, details, action };
}

export function settingsRow(label: string, value: string): HTMLElement {
  const row = el("div", "Official-SettingsRow");
  row.append(
    el("div", "Official-SettingsLabel", label),
    el("div", "Official-SettingsValue", value),
  );
  return row;
}

/** The four Game Speed rungs in the interface's own language. `gameSpeedLabel` needs an FDF
 *  library for its GlobalStrings; the HD menus have ours, so they pass this instead. */
export function speedText(speed: GameSpeed): string {
  const name = {
    [GameSpeed.Slow]: t("hd.slow"),
    [GameSpeed.Medium]: t("hd.medium"),
    [GameSpeed.Fast]: t("hd.fast"),
    [GameSpeed.Fastest]: t("hd.fastest"),
  }[speed];
  return speed === DEFAULT_GAME_SPEED ? `${name} (${t("hd.default")})` : name;
}

/**
 * The Reforged LAN browser (3.0's `LANGames`): the game list under the category strip and the
 * highlighted game's map in the right-hand plate.
 *
 * Same lobby, same handlers and the same rules as ui/fdfLan.ts — only the shell is 3.0's. Games
 * on this client's edition and data line are the only rows, a game's map is read out of this
 * install, and a map this install lacks is fetched from the host before the lobby opens.
 */
export async function mountHdLanScreen(
  container: HTMLElement,
  vfs: DataSource,
  maps: Map<string, File>,
  lobby: LanLobby,
  connected: Promise<void>,
  h: LanHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-lan");
  screen.element.classList.add("hd-official");
  if (!isRoc()) screen.element.classList.add("tft");

  let created = false;
  const goCreate = (): void => {
    if (created) return;
    created = true;
    h.onCreateGame();
  };
  const shell = lanShell(screen, {
    title: t("hd.lan"),
    subtitle: t("lan.gamesInfo"),
    assets,
    selected: "games",
    onBack: () => h.onCancel(),
    onTab: (tab) => { if (tab === "create") goCreate(); },
    onServers: () => void openServers(),
    columns: [t("hd.gameName"), t("hd.playersCount"), t("hd.host")],
    nameField: true,
  });
  const { list, status, aside } = shell;

  const joinButton = primaryButton(t("lan.joinGame"), () => join(), "", true);
  joinButton.classList.add("Primary-Button-Blue");
  aside.action.appendChild(framed(joinButton));

  let alive = true;
  let picked: string | null = null;
  let shown: MapInfo | null = null;
  let missing: string | null = null;
  let connectError: string | null = null;
  let serversDialog: JoinAddressDialog | null = null;

  const name = (): string => shell.nameField?.value.trim() || savedPlayerName();

  async function openServers(): Promise<void> {
    serversDialog = await showJoinAddressDialog({
      container,
      vfs,
      lobby,
      onChange: () => { if (alive) paint(lobby.snapshot); },
      onClosed: () => { serversDialog = null; },
    });
  }

  async function showMapOf(room: { mapPath: string; mapName: string } | null): Promise<void> {
    shown = null;
    missing = null;
    const path = room?.mapPath ? localMapPath(maps, room.mapPath) : null;
    const info = path ? await readMapInfo(maps, path, vfs).catch(() => null) : null;
    if (!alive) return;
    if (info) shown = info;
    else if (room?.mapPath) missing = room.mapName || baseName(room.mapPath);
    paint(lobby.snapshot);
  }

  function join(): void {
    if (!picked || connectError || lobby.snapshot.phase !== "browsing") return;
    localStorage.setItem("warcraft-open.playerName", name());
    if (missing) void requestMapWriteAccess();
    lobby.join(picked, name());
  }

  async function download(room: { mapPath: string; mapName: string; hostName: string }): Promise<void> {
    const got = await showMapDownload({
      container,
      vfs,
      lobby,
      mapPath: room.mapPath,
      mapName: room.mapName || baseName(room.mapPath),
      hostName: room.hostName,
      string: () => null,
    }).catch((err: unknown) => {
      console.warn("[Warcraft Open] HD map download dialog failed:", err);
      lobby.leave();
      return null;
    });
    if (got) maps.set(got.key, got.file);
    const info = got ? await readMapInfo(maps, got.key, vfs).catch(() => null) : null;
    if (got && info) {
      h.onMapDownloaded(got.key, got.file);
      h.onJoined(got.key, info);
      return;
    }
    if (got) {
      maps.delete(got.key);
      lobby.leave();
    }
    alive = true;
    lobby.onChange = onLobby;
    void showMapOf(lobby.snapshot.rooms.find((r) => r.key === picked) ?? null);
  }

  const onLobby = (state: LobbyState): void => {
    if (!alive) return;
    serversDialog?.refresh();
    if (state.phase === "joined" && state.room) {
      const room = state.room;
      alive = false;
      const path = localMapPath(maps, room.mapPath);
      if (path) {
        void readMapInfo(maps, path, vfs).then((info) => { if (info) h.onJoined(path, info); });
        return;
      }
      void download(room);
      return;
    }
    paint(state);
  };
  lobby.onChange = onLobby;

  connected.catch((err: Error) => {
    connectError = err.message;
    paint(lobby.snapshot);
  });

  function paint(state: LobbyState): void {
    if (!alive) return;
    const rooms = state.rooms.filter(
      (r) => (r.edition ?? "tft") === edition() && (r.flavor ?? "sd") === flavor(),
    );
    if (picked && !rooms.some((r) => r.key === picked)) {
      picked = null;
      shown = null;
      missing = null;
    }

    list.textContent = "";
    for (const room of rooms) {
      list.appendChild(
        listRow(
          [
            `${room.name}${room.observers ? ` (${t("hd.observers")})` : ""}`,
            `${room.players}/${room.maxPlayers}`,
            room.hostName,
          ],
          () => {
            picked = room.key;
            void showMapOf(room);
          },
          { icon: "map", selected: picked === room.key },
        ),
      );
    }
    if (!rooms.length) list.appendChild(el("p", "Official-Empty", t("lan.noGames")));

    const room = picked ? rooms.find((r) => r.key === picked) ?? null : null;
    status.textContent = state.error
      ? state.error
      : connectError
        ? connectError
        : missing
          ? t("lan.willDownload", { map: missing })
          : rooms.length
            ? t("lan.selectGame")
            : t("lan.noGames");
    status.style.color = state.error || connectError ? "#ff8080" : "";
    const reach = reachabilityLine(state.host);
    if (reach?.warn) status.textContent = `${status.textContent ?? ""} ${reach.text}`.trim();

    if (shown) {
      aside.previewImage.style.backgroundImage = shown.minimap ? `url("${imageToDataUrl(shown.minimap)}")` : "";
      aside.mapName.textContent = shown.name;
      aside.maxPlayers.textContent = String(shown.maxPlayers);
      aside.mapAuthor.textContent = [shown.recommendedPlayers, shown.tileset].filter(Boolean).join(" · ");
      aside.details.textContent = "";
      aside.details.append(
        el("p", "Official-OptionsDescription", shown.description || t("hd.noDescription")),
        imgDetailsRow(t("hd.host"), room?.hostName ?? "—"),
        imgDetailsRow(t("hd.gameSpeed"), room ? speedText(toGameSpeed(room.speed)) : "—"),
        imgDetailsRow(t("hd.playersCount"), shown.recommendedPlayers || String(shown.maxPlayers)),
      );
    } else {
      aside.previewImage.style.backgroundImage = "";
      aside.mapName.textContent = "";
      aside.maxPlayers.textContent = "";
      aside.mapAuthor.textContent = "";
      aside.details.textContent = "";
      aside.details.appendChild(el("p", "Official-Empty", t("hd.pickGame")));
    }

    const canJoin = state.phase === "browsing" && !!picked && !connectError;
    joinButton.classList.toggle("isDisabled", !canJoin);
    joinButton.setAttribute("aria-disabled", String(!canJoin));
    if (shell.nameField) shell.nameField.disabled = state.phase !== "browsing";
    shell.tabs.create.disabled = state.phase !== "browsing";
  }

  paint(lobby.snapshot);
  return screen.attach(container);
}
