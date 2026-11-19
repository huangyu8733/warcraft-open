import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { webUiAssets } from "./assets";
import { HdScreen, el } from "./screen";
import { loadOfficialStyle } from "./official";
import { backButton } from "./officialMenu";
import { openSystemMenu } from "./systemMenu";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";
import { profilePlayerName } from "../../data/profiles";
import { RACES, raceLabel, type Race } from "../../data/races";
import type { MapInfo } from "../../world/mapInfo";
import { imageToDataUrl } from "../../render/blputil";
import { PLAYER_COLORS } from "../hud";
import { HANDICAPS, labelOf, slotOption, slotOptionValue, slotOptionsFor } from "../playerSlots";
import type { MeleeConfig } from "../lobby";
import {
  actionButton, baseFrame, observerLabel, officialDropdown, seatsToConfig, settingsRow,
  speedLabel, visibilityLabel,
  type HdCreateState, type HdSeat,
} from "./skirmish";

export interface HdCustomLobbyHandlers {
  onStart: (file: File, info: MapInfo, config: MeleeConfig, path: string) => void;
  onCancel: () => void;
}

const MAX_TEAM_CHOICES = 8;

/**
 * 3.0's SINGLE-PLAYER CUSTOM LOBBY (`GameLobby`): the map's seats under TEAM 1 / TEAM 2 on the
 * left, the map, the create page's choices and START GAME on the right.
 *
 * The create page hands this screen its picked map, its seats and its options; the rows edit
 * the seats in place and START GAME turns them into the match config.
 */
export async function mountHdCustomLobby(
  container: HTMLElement,
  vfs: DataSource,
  state: HdCreateState,
  h: HdCustomLobbyHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-custom-lobby");
  screen.element.classList.add("hd-official");
  const tft = !isRoc();
  if (tft) screen.element.classList.add("tft");

  const root = el("div", "CustomGames Official-CreateScreen");
  const content = el("div", "CustomGames-ContentContainer Official-ContentContainer");
  const panel = el("div", "CustomGames-MainPanel");
  const grid = el("div", "CustomGames-LeftPanel-Grid Official-CreateGrid");

  const upper = el("div", "CustomGames-UpperLeftSection Official-UpperLeftSection Official-MatchHeader");
  const header = el("div", "Simple-Header");
  const title = el("div", "Simple-Header-Title");
  title.appendChild(el("div", "Simple-Header-TitleText", t("hd.singlePlayerLobby")));
  title.appendChild(el("div", "Simple-Header-TitleSubText", state.info.name));
  header.appendChild(title);
  upper.appendChild(header);

  const body = el("div", "Official-LobbyBody");
  const teams = el("div", "Official-LobbyTeams");
  body.appendChild(teams);

  grid.append(el("div", "CustomGames-Background Official-Background"), baseFrame(tft), upper, body);

  // --- the right column -----------------------------------------------------------------
  const aside = el("div", "CustomGames-RightColumn Official-RightColumn Official-MatchSide");
  const sideInner = el("div", "Official-SideInner");

  const headerRow = el("div", "Official-PreviewHeader");
  const swords = el("div", "Official-SwordsIcon");
  swords.appendChild(el("div", "Official-MaxPlayerSize", String(state.info.maxPlayers)));
  const mapName = el("div", "Official-MapName", state.info.name);
  headerRow.append(swords, mapName);

  const mapAuthor = el("div", "Official-MapAuthor", authorLine(state.info));

  const previewFrame = el("div", "Official-PreviewFrame Official-PreviewFrame-Lobby");
  const previewImage = el("div", "Official-PreviewImage");
  if (state.info.minimap) previewImage.style.backgroundImage = `url("${imageToDataUrl(state.info.minimap)}")`;
  previewFrame.appendChild(previewImage);

  const summary = el("div", "Official-Options Official-LobbySummary");
  const options = state.options;
  summary.append(
    settingsRow(t("hd.gameSpeed"), speedLabel(options.gameSpeed)),
    settingsRow(t("hd.observers"), observerLabel(options.advanced.observers)),
    settingsRow(t("hd.visibility"), visibilityLabel(options.advanced.visibility)),
    el("p", "Official-OptionsDescription", state.info.description || t("hd.noDescription")),
  );

  const action = el("div", "Official-ActionButton");
  const startButton = actionButton(t("hd.startGame"), () => start());
  action.appendChild(startButton);

  sideInner.append(headerRow, mapAuthor, previewFrame, summary, action);
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

  paintTeams();
  return screen.attach(container);

  function paintTeams(): void {
    teams.textContent = "";
    const left = el("div", "Official-TeamColumn");
    const right = el("div", "Official-TeamColumn");

    const order = [...new Set(state.seats.map((s) => s.team))].sort((a, b) => a - b);
    // A one-team map has nothing for the second column: keeping it would leave half the page
    // empty and squeeze every row's name into a couple of characters. The one section spans
    // the page instead (`:only-child` in customGame.css).
    teams.append(left);
    if (order.length > 1) teams.appendChild(right);
    order.forEach((team, at) => {
      const column = at % 2 === 0 ? left : right;
      column.appendChild(teamSection(team));
    });
    if (!order.length) {
      teams.appendChild(el("p", "Official-Empty", t("hd.pickMap")));
    }
  }

  function teamSection(team: number): HTMLElement {
    const section = el("div", "Official-TeamSection");
    section.appendChild(el("div", "Official-TeamName", `${t("hd.team")} ${team + 1}`));
    const rows = state.seats
      .filter((s) => s.team === team)
      .sort((a, b) => a.id - b.id);
    for (const seat of rows) section.appendChild(lobbyRow(seat));
    return section;
  }

  function lobbyRow(seat: HdSeat): HTMLElement {
    const row = el("div", "Official-LobbyRow");
    const multi = el("div", "GameLobbyDropdown-MultiHolder");
    multi.append(teamControl(seat), el("div", "GameLobby-PlayerRow-Divider"), colorPlate(seat));
    row.append(
      multi,
      nameControl(seat),
      raceControl(seat),
      handicapControl(seat),
    );
    return row;
  }

  function teamControl(seat: HdSeat): HTMLElement {
    const highest = Math.max(0, ...state.seats.map((s) => s.team));
    const count = Math.min(MAX_TEAM_CHOICES, Math.max(2, highest + 1));
    const choices = Array.from({ length: count }, (_, i) => ({ value: String(i), label: String(i + 1) }));
    return officialDropdown("GameLobby-Player-Team", choices, String(seat.team), (value) => {
      seat.team = Number(value);
      paintTeams();
    });
  }

  function colorPlate(seat: HdSeat): HTMLElement {
    const box = el("div", "GameLobbyDropdown GameLobby-Player-Color");
    const plate = el("div", "GameLobbyDropdown-Selected-Item");
    const swatch = el("div", "GameLobby-ColorDropdownItem");
    swatch.style.background = PLAYER_COLORS[seat.color % PLAYER_COLORS.length];
    plate.appendChild(swatch);
    box.appendChild(plate);
    return box;
  }

  function nameControl(seat: HdSeat): HTMLElement {
    const mine = seat.controller === "user";
    const root = el("div", "GameLobbyDropdown");
    if (mine) {
      const menu = el("div", "GameLobby-PlayerMenu");
      menu.appendChild(el("div", "GameLobby-PlayerName", profilePlayerName()));
      root.appendChild(menu);
      return root;
    }
    const plus = options.advanced.computerPlus;
    const choices = seat.locked
      ? [{ value: slotOptionValue("computer", seat.ai, plus), label: labelOf(slotOptionValue("computer", seat.ai, plus)) }]
      : slotOptionsFor(plus);
    const menu = el("div", "GameLobby-PlayerMenu-Interactable");
    const label = el("div", "GameLobby-PlayerName", seatName(seat));
    menu.appendChild(label);
    const menuList = el("div", "GameLobbyDropdown-Options");
    for (const choice of choices) {
      const item = el("div", "", choice.label);
      item.dataset.value = choice.value;
      item.onclick = (): void => {
        const picked = slotOption(choice.value);
        seat.controller = picked?.controller ?? (choice.value as HdSeat["controller"]);
        seat.ai = picked?.ai ?? seat.ai;
        root.classList.remove("isOpen");
        paintTeams();
      };
      menuList.appendChild(item);
    }
    menu.onclick = (): void => {
      if (seat.locked) return;
      root.classList.toggle("isOpen");
    };
    root.append(menu, menuList);
    return root;
  }

  function raceControl(seat: HdSeat): HTMLElement {
    const seated = seat.controller === "user" || seat.controller === "computer";
    const choices = RACES.map((r) => ({ value: r, label: raceLabel(r) }));
    const control = officialDropdown("GameLobby-PlayerRace", choices, seat.race, (value) => {
      seat.race = value as Race;
      paintTeams();
    });
    if (!seated) control.classList.add("isDisabled");
    return control;
  }

  function handicapControl(seat: HdSeat): HTMLElement {
    const seated = seat.controller === "user" || seat.controller === "computer";
    const theChoices = HANDICAPS.map((h) => ({ value: String(h), label: `${h}%` }));
    const control = officialDropdown("GameLobby-PlayerHandicap", theChoices, String(seat.handicap), (value) => {
      seat.handicap = Number(value);
      paintTeams();
    });
    if (!seated) control.classList.add("isDisabled");
    return control;
  }

  function seatName(seat: HdSeat): string {
    if (seat.controller === "computer") {
      return labelOf(slotOptionValue("computer", seat.ai, options.advanced.computerPlus));
    }
    if (seat.controller === "closed") return t("slot.closed");
    return t("slot.open");
  }

  function start(): void {
    h.onStart(state.file, state.info, seatsToConfig(state.seats, state.info, state.options), state.path);
  }
}

function authorLine(info: MapInfo): string {
  return [info.recommendedPlayers, info.tileset].filter(Boolean).join(" · ");
}
