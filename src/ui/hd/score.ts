import type { ScoreRow } from "../../game/scoreTable";
import { PLAYER_COLORS } from "../hud";
import type { PlayableRace } from "../../data/races";
import { isRoc } from "../../data/edition";
import { blpToCanvas, tgaToCanvas } from "../../render/blputil";
import { showSaveReplayPanel } from "../saveReplayDialog";
import { TABS, mountScoreScreen, type ScoreScreen, type ScoreScreenOptions } from "../scoreScreen";
import { t, type MessageKey } from "../../i18n";
import { webUiAssets } from "./assets";
import { loadOfficialStyle } from "./official";
import { openSystemMenu } from "./systemMenu";
import { el } from "./screen";
import { applyHdTheme } from "./theme";
import { backButton, cornerDecorations, primaryButton } from "./officialMenu";

const TAB_CAPTIONS = ["hd.overview", "hd.units", "hd.heroes", "hd.resources"] as const;

/** Each column's GlobalStrings key, as the message key its header prints. */
const COLUMN_LABELS: Record<string, MessageKey> = {
  OVERVIEW_COLUMN0: "hd.col.unitScore", OVERVIEW_COLUMN1: "hd.col.heroScore", OVERVIEW_COLUMN2: "hd.col.resourceScore", OVERVIEW_COLUMN3: "hd.col.totalScore",
  UNIT_COLUMN0: "hd.col.produced", UNIT_COLUMN1: "hd.col.killed", UNIT_COLUMN2: "hd.col.buildingsProduced", UNIT_COLUMN3: "hd.col.razed", UNIT_COLUMN4: "hd.col.largestArmy",
  HEROES_COLUMN0: "hd.heroes", HEROES_COLUMN1: "hd.col.killed", HEROES_COLUMN2: "hd.col.items", HEROES_COLUMN3: "hd.col.mercenaries", HEROES_COLUMN4: "hd.col.experience",
  RESOURCES_COLUMN0: "hd.col.goldMined", RESOURCES_COLUMN1: "hd.col.lumberHarvested", RESOURCES_COLUMN2: "hd.col.sentReceived", RESOURCES_COLUMN3: "hd.col.techPercent", RESOURCES_COLUMN4: "hd.col.upkeepLost",
};

const RACE_ICONS: PlayableRace[] = ["human", "orc", "undead", "nightelf"];

/**
 * 3.0's MATCH RESULTS screen: the window's own carved frame, the wood header with the gold title
 * and the metal tab strip, then the parchment page with the game's own table — the banner rows
 * tinted with each player's colour, the team tint block, the race crest, and the winning race's
 * portrait behind it.
 *
 * The statistics, the tab order, the sort and the save-replay flow are ui/scoreScreen.ts's; this
 * file only draws them. The FDF mount's own overlay is hidden, so the art keeps the picture and
 * this table is what the player reads and clicks.
 */
export async function mountHdScoreScreen(opts: ScoreScreenOptions): Promise<ScoreScreen> {
  const assets = webUiAssets(opts.vfs);
  await loadOfficialStyle(assets);
  const classic = await mountScoreScreen(opts);
  opts.container.querySelector(".fdf-score")?.classList.add("hd-score-legacy");

  // The table's crests come from the versus menu; resolve their archive paths once.
  const crests = new Map<PlayableRace, string>();
  await Promise.all(RACE_ICONS.map(async (race) => {
    const url = await assets.url(`WebUI\\Icons\\Versus\\${race}-icon-resting.png`);
    if (url) crests.set(race, url);
  }));

  const root = el("div", "hd-official ScoreScreen");
  // The results screen is mounted into the running match's container, not through `HdScreen`,
  // so nothing has stamped the interface theme on it: without this the buttons keep the base
  // blue plates on the FK back, whose own buttons are cut from the green ones.
  applyHdTheme(root);
  root.appendChild(cornerDecorations(assets, !isRoc()));

  const container = el("div", "ScoreScreen-Container Animate-In");
  container.appendChild(el("div", "ScoreScreen-Background-Texture"));

  // --- the metal header: title on the left, the tabs across the rest of the strip ---------
  const header = el("div", "ScoreScreen-Header");
  const headerMenu = el("div", "ScoreScreen-Header-Menu");
  const headerContent = el("div", "ScoreScreen-Header-Menu-Content");
  const decorations = el("div", "ScoreScreen-Header-Menu-Decorations-Wrapper");
  decorations.append(
    el("div", "Header-Metal-Decoration-Left"),
    el("div", "Header-Metal-Decoration-Right"),
  );
  const headerTitle = el("div", "ScoreScreen-Header-Menu-Title", t("hd.matchResults"));
  const tabBar = el("div", "ScoreScreen-TabBar");
  const tabs = el("div", "ScoreScreen-TabOptionHolder");
  const tabButtons: HTMLElement[] = [];
  for (let i = 0; i < TABS.length; i++) {
    const slot = el("div", "withSound");
    const cap = el("div", "Primary-Tab-Button-Left-Container");
    const tabButton = primaryButton(t(TAB_CAPTIONS[i]), () => {
      infoOpen = false;
      tab = i;
      sortBy = 0;
      sortDesc = true;
      paint();
    });
    cap.appendChild(tabButton);
    slot.appendChild(cap);
    tabButtons.push(tabButton);
    tabs.appendChild(slot);
  }
  // The strip's last slot is the match-info page, in the same plate as the data tabs; 3.0's
  // round "i" is its face.
  const infoSlot = el("div", "withSound");
  const infoCap = el("div", "Primary-Tab-Button-Left-Container");
  const infoButton = primaryButton("", () => {
    infoOpen = true;
    paint();
  });
  infoButton.setAttribute("aria-label", t("hd.matchInfo"));
  infoButton.querySelector(".Primary-Button-Content")?.appendChild(el("div", "GameLobby-ReportIcon"));
  infoCap.appendChild(infoButton);
  infoSlot.appendChild(infoCap);
  tabs.appendChild(infoSlot);
  tabBar.appendChild(tabs);
  headerContent.append(decorations, headerTitle, tabBar);
  headerMenu.appendChild(headerContent);
  header.appendChild(headerMenu);

  // --- the parchment page and its race portrait -------------------------------------------
  const wrapper = el("div", "ScoreScreen-Wrapper");
  const background = el("div", "ScoreScreen-Background");
  const page = el("div", "ScoreScreen-Background-Page");
  const local = opts.table.rows.find((row) => row.player === opts.localPlayer);
  const art = el("div", `ScoreScreen-Race-Art ${portraitRace(local)}`);
  page.appendChild(art);
  background.appendChild(page);

  const tableBox = el("div", "ScoreScreen-Table-Container");
  const thWrapper = el("div", "Table-Th-Wrapper");
  const th = el("div", "Table-Th");
  thWrapper.appendChild(th);
  const table = el("div", "ScoreScreen-Table");
  tableBox.append(thWrapper, table);

  // The "i" page: the map that was played, how long it ran, and the recording's two actions —
  // 3.0's match-info page, drawn over the same parchment.
  const infoPage = el("div", "ScoreScreen-MatchInfo");
  const mapFrame = el("div", "ScoreScreen-MatchInfo-Map");
  const mapImage = el("div", "ScoreScreen-MatchInfo-MapImage");
  // A square minimap reads here where the loading screen's wide preview art would letterbox.
  const mapPixels = opts.map?.minimap
    ? blpToCanvas(opts.map.minimap)
    : opts.map?.previewImage ? tgaToCanvas(opts.map.previewImage) : null;
  if (mapPixels) mapImage.style.backgroundImage = `url("${mapPixels.toDataURL()}")`;
  mapFrame.appendChild(mapImage);
  const infoDetails = el("div", "ScoreScreen-MatchInfo-Details");
  infoDetails.append(
    el("div", "ScoreScreen-MatchInfo-Name", opts.map?.name ?? ""),
    el("div", "ScoreScreen-MatchInfo-Duration", `${t("hd.duration")} ${clock(opts.table.elapsed)}`),
  );
  const infoButtons = el("div", "ScoreScreen-MatchInfo-Buttons");
  if (opts.onWatchReplay) infoButtons.appendChild(primaryButton(t("hd.watchReplay"), opts.onWatchReplay));
  infoDetails.appendChild(infoButtons);
  infoPage.append(mapFrame, infoDetails);

  wrapper.append(background, tableBox, infoPage);

  let replaySaved = false;
  const saveHolder = el("div", "Official-ScoreSave");
  const downloadReplay = (): void => {
    if (!opts.replay || replaySaved) return;
    void showSaveReplayPanel({
      ...opts.replay,
      container: opts.container,
      vfs: opts.vfs,
      onSaved: (): void => {
        replaySaved = true;
        const label = saveHolder.querySelector(".Primary-Button-Content");
        if (label) label.textContent = t("hd.replaySaved");
      },
    });
  };
  if (opts.replay) {
    infoButtons.appendChild(primaryButton(t("hd.downloadReplay"), downloadReplay));
    saveHolder.appendChild(primaryButton(t("hd.saveReplay"), downloadReplay));
    container.appendChild(saveHolder);
  }
  container.append(header, wrapper);
  root.appendChild(container);

  const back = backButton(root, t("hd.back"), opts.onOk, {
    onSystemMenu: () =>
      openSystemMenu({ element: root }, opts.vfs, { onQuit: opts.onOk }),
    systemMenuLabel: t("hd.menu"),
  });
  opts.container.appendChild(root);

  let tab = 0;
  let sortBy = 0;
  let sortDesc = true;
  let infoOpen = false;

  const rescale = (): void => {
    const z = Math.max(0.25, window.innerHeight / 1080);
    // `zoom` shrinks the rendered size of a 100%-wide box, so the layer is authored in the
    // screen's own pixel units and scaled back up to fill the window.
    container.style.zoom = String(z);
    container.style.width = `${window.innerWidth / z}px`;
    container.style.height = `${window.innerHeight / z}px`;
    back.style.zoom = String(z);
  };
  rescale();
  window.addEventListener("resize", rescale);

  const rowsFor = (): ScoreRow[] => {
    const columns = TABS[tab];
    const column = columns[Math.min(sortBy, columns.length - 1)];
    const key = column?.sort;
    const rows = [...opts.table.rows];
    if (!key) return rows;
    rows.sort((a, b) => (sortDesc ? key(b) - key(a) : key(a) - key(b)) || a.team - b.team || a.player - b.player);
    return rows;
  };

  function paint(): void {
    tabButtons.forEach((b, i) => b.classList.toggle("ScoreScreen-TabOption-Selected", !infoOpen && i === tab));
    infoButton.classList.toggle("ScoreScreen-TabOption-Selected", infoOpen);
    tableBox.classList.toggle("is-hidden", infoOpen);
    infoPage.classList.toggle("is-open", infoOpen);
    saveHolder.style.display = infoOpen ? "none" : "";
    if (infoOpen) return;
    const columns = TABS[tab];
    const length = String(columns.length);

    th.textContent = "";
    const teamHead = el("div", "Table-Col Table-Col-0");
    teamHead.append(el("div", "ScoreScreen-Team-Icon"), el("span", "", t("hd.team")));
    th.appendChild(teamHead);

    const nameHead = el("div", `Table-Col Table-Col-1 Length-${length}`);
    nameHead.append(el("div", "ScoreScreen-ListHeader-Divider"), el("span", "", t("hd.playerName")));
    th.appendChild(nameHead);

    columns.forEach((column, i) => {
      const head = el("div", `Table-Col Table-Col-${i + 2} Length-${length}${i === sortBy ? " isSorted" : ""}`);
      head.setAttribute("role", "button");
      head.tabIndex = 0;
      head.append(
        el("div", "Table-Col-Hover"),
        el("div", "ScoreScreen-ListHeader-Divider"),
        el("span", "", COLUMN_LABELS[column.key] ? t(COLUMN_LABELS[column.key]) : column.key),
      );
      const sort = (): void => {
        if (sortBy === i) sortDesc = !sortDesc;
        else {
          sortBy = i;
          sortDesc = true;
        }
        paint();
      };
      head.onclick = sort;
      head.onkeydown = (e: KeyboardEvent): void => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          sort();
        }
      };
      th.appendChild(head);
    });

    table.textContent = "";
    for (const row of rowsFor()) {
      const color = PLAYER_COLORS[row.color % PLAYER_COLORS.length];
      const line = el("div", "Table-Tr");

      const bannerBG = el("div", "BannerBG");
      bannerBG.style.backgroundImage = `linear-gradient(${shade(color)}, ${color})`;
      line.appendChild(bannerBG);
      line.appendChild(el("div", `Banner ${row.won ? "Gold" : "Silver"}`));

      const teamCell = el("div", "Table-Col Table-Col-0");
      const crest = el("div", "ScoreScreen-RaceIcon");
      const crestUrl = crests.get(row.race);
      if (crestUrl) {
        crest.style.backgroundImage = `url("${crestUrl}")`;
        crest.style.backgroundSize = "cover";
        crest.style.backgroundPosition = "50%";
      }
      const teamColor = el("div", "TeamColor");
      const tint = el("div", "TeamColor-Tint-Background");
      tint.append(
        el("div", `TeamColor-Tint Team-${(row.color % 4) + 1}`),
        el("div", "TeamColor-Text", String(row.team + 1)),
      );
      teamColor.appendChild(tint);
      teamCell.append(crest, teamColor);
      line.appendChild(teamCell);

      line.appendChild(el("div", `Table-Col Table-Col-1 Length-${length}`, row.name));

      columns.forEach((column, i) => {
        const cell = el("div", `Table-Col Table-Col-${i + 2} Length-${length}`);
        cell.appendChild(el("span", "", column.heroes
          ? row.heroes.map((hero) => String(hero.level)).join(" · ")
          : column.value(row)));
        line.appendChild(cell);
      });

      if (row.won) line.appendChild(el("div", "winner"));
      table.appendChild(line);
    }
  }

  paint();
  window.addEventListener("keydown", onKey);
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      opts.onOk();
    }
  }

  const disposeClassic = classic.dispose.bind(classic);
  return {
    dispose(): void {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", rescale);
      root.remove();
      disposeClassic();
    },
  };
}

/** The race portrait the reference puts in the parchment's lower-right corner. A random race
 *  has no portrait of its own, so the human plate stands in. */
function portraitRace(row: ScoreRow | undefined): string {
  const race = row?.race;
  if (race === "orc" || race === "undead") return race;
  if (race === "nightelf") return "night_elf";
  return "human";
}

/** The match length the same way the FDF screen prints it: always h:mm:ss. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const two = (v: number): string => String(v).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
}

/** The banner's top tone: the player's colour taken down toward black. */
function shade(hex: string): string {
  const parts = [1, 3, 5].map((at) => Math.round(parseInt(hex.slice(at, at + 2), 16) * 0.45));
  return `rgb(${parts.join(",")})`;
}
