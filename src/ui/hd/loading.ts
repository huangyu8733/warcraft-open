import { blpToCanvas, tgaToCanvas } from "../../render/blputil";
import { raceLabel, type Race } from "../../data/races";
import { mapDisplayText } from "../../i18n/mapLanguage";
import { t } from "../../i18n";
import type { MeleeConfig, SlotConfig } from "../lobby";
import { drawPreviewMarkers, loadMinimapIcons } from "../mapBrowser";
import type { MapPreview } from "../../world/mapPreview";
import type { LoadingScreen, LoadingScreenOptions } from "../loadingScreen";
import { webUiAssets } from "./assets";
import { loadOfficialStyle } from "./official";
import { el } from "./screen";
import { PLAYER_COLORS } from "../hud";

/** No pointer while a map loads — style.css `body.loading-screen`. */
const LOADING_CURSOR_CLASS = "loading-screen";

/** How far the author line sits above the window's bottom edge, in 1080-line units. */
const BAR_BOTTOM = 58;

/**
 * 3.0's loading screen: the sheet's parchment-and-dragon backdrop (`LoadingScreen-Background`),
 * the map's minimap in its metal frame between the two team columns, and the game's own loading
 * bar with its blue fill under the caption.
 *
 * The behaviour is ui/loadingScreen.ts's, line for line: the caption changes once OUR load is
 * done, `setPeerReady` lights the machine that reported in, `waitForKey` swallows the key that
 * dismisses the screen, and the marker pass stamps the map's own start locations onto the
 * minimap.
 */
export async function mountHdLoadingScreen(opts: LoadingScreenOptions): Promise<LoadingScreen> {
  const { vfs, info, config } = opts;
  // The 3.0 sheet's art is the install's, never the map's: reading it through the match's
  // layered archive walks that archive's list and re-reads every plate on every match — the
  // expensive end of which (a big, heavily packed custom map) is where this screen used to
  // come up late or not at all.
  const assets = webUiAssets(opts.install ?? vfs);
  await loadOfficialStyle(assets);

  const slots = seatedSlots(config);
  const melee = info.isMelee || (info.loading.screen < 0 && !info.loading.model);

  // Which seats wear the 3.0 "in" mark: ours, the computers', and every human that has no relay
  // peer behind it. The rest light as their `ready` arrives (game/loadGate.ts).
  const ready = new Set<number>();
  const local = localSlot(config)?.id;
  slots.forEach((slot, i) => {
    const remote = slot.peer !== undefined && slot.id !== local;
    if (!remote || slot.controller === "computer") ready.add(i);
  });

  const icons = info.isMelee ? loadMinimapIcons(vfs) : null;
  let preview: MapPreview | null = null;
  let loaded = false;
  let awaitingKey = false;
  let stopWaiting: (() => void) | null = null;
  let progress = 0;

  const poster = info.previewImage ? tgaToCanvas(info.previewImage) : null;
  const minimap = poster ?? (info.minimap ? blpToCanvas(info.minimap) : null);
  const minimapUrl = minimap?.toDataURL() ?? null;

  const root = el("div", "hd-official LoadingScreen");

  // --- the parchment backdrop, with the bar and its caption on it -------------------------
  const background = el("div", "LoadingScreen-Background isDefaultBg");
  const barColumn = el("div", "LoadingScreen-CenterLoadingColumn");
  const bar = el("div", "LoadingScreen-LoadingBar");
  const caption = el("div", "LoadingScreen-LoadingBarText", t("hd.loading").toUpperCase());
  const fillContainer = el("div", "LoadingScreen-LoadingFill-Container");
  const fill = el("div", "LoadingScreen-LoadingBarFill");
  const endcap = el("div", "LoadingScreen-Fill-Endcap");
  fillContainer.append(fill, endcap);
  bar.append(caption, fillContainer);

  const author = el("div", "LoadingScreen-MapAuthorHolder");
  author.append(
    `${t("hd.mapCreatedBy")} `,
    el("span", "LoadingScreen-MapAuthor", info.isMelee ? "Blizzard Entertainment" : (info.recommendedPlayers || info.name)),
  );
  barColumn.append(bar, author);
  background.append(barColumn, el("div", "LoadingScreen-Bottom-Ornament"));

  // --- the teams and the map in the middle ------------------------------------------------
  const gameInfo = el("div", "LoadingScreen-GameInfo");
  const left = el("div", "LoadingScreen-TeamContainer-Wrapper-Left");
  const right = el("div", "LoadingScreen-TeamContainer-Wrapper-Right");

  const mapInfo = el("div", "LoadingScreen-MapInfo");
  const mapTitle = el("div", "LoadingScreen-MapTitle", mapDisplayText(config.mapName ?? info.name));
  const mapHolder = el("div", "LoadingScreen-MapImageHolder");
  const mapImage = el("div", "LoadingScreen-MapImage");
  if (minimapUrl) mapImage.style.backgroundImage = `url("${minimapUrl}")`;
  mapHolder.appendChild(mapImage);
  mapInfo.append(mapTitle, mapHolder);

  // The card keeps the SLOT it was built for: the columns are grouped by team, so the cards are
  // not in `slots` order, and pairing card i with seat i showed the wrong colours — and put the
  // "in" mark on the wrong machine — once a lobby had more than one team's worth of players.
  const cards: { card: HTMLElement; slot: SlotConfig; at: number }[] = [];
  const seated = slots.map((slot, at) => ({ slot, at }));
  const order = [...new Set(slots.map((s) => s.team))].sort((a, b) => a - b);
  // 3.0 puts the first half of the teams on the left and the rest on the right.
  const half = Math.floor(order.length / 2);
  order.forEach((team, at) => {
    const column = at < half ? left : right;
    const container = el("div", "LoadingScreen-TeamContainer");
    container.appendChild(el("div", "LoadingScreen-TeamName", `${t("hd.team")} ${team + 1}`));
    seated.filter(({ slot }) => slot.team === team)
      .sort((a, b) => a.slot.id - b.slot.id)
      .forEach(({ slot, at: seat }) => {
        const card = playerCard(slot);
        cards.push({ card, slot, at: seat });
        container.appendChild(card);
      });
    column.appendChild(container);
  });

  gameInfo.append(left, mapInfo, right);
  root.append(background, gameInfo);
  opts.container.appendChild(root);

  // The sheet authors the loading screen for 1080 lines; scale its type and cards with the
  // window the same way the rest of the 3.0 front end does. The bar is pinned by its own bottom
  // because the sheet's 82px flex margin does not survive `zoom` — the column ends up floating
  // well above the ornament it is meant to rest on.
  const rescale = (): void => {
    const z = Math.max(0.5, window.innerHeight / 1080);
    gameInfo.style.zoom = String(z);
    barColumn.style.zoom = String(z);
    barColumn.style.bottom = `${Math.round(BAR_BOTTOM * z)}px`;
  };
  rescale();
  window.addEventListener("resize", rescale);

  const setFill = (value: number): void => {
    progress = Math.min(1, Math.max(0, value));
    fill.style.width = `${Math.round(progress * 1075)}px`;
  };
  setFill(0);

  const refreshCaption = (): void => {
    if (awaitingKey) return;
    if (loaded && ready.size < slots.length) caption.textContent = t("hd.waitingForPlayers").toUpperCase();
    else if (!loaded) caption.textContent = t("hd.loading").toUpperCase();
  };

  const paintReady = (): void => {
    cards.forEach(({ card, slot, at }) => {
      const overlay = card.querySelector<HTMLElement>(".PlayerLoadingWidget-IsReady, .PlayerLoadingWidget-IsNotReady");
      if (!overlay) return;
      overlay.className = ready.has(at) ? "PlayerLoadingWidget-IsReady" : "PlayerLoadingWidget-IsNotReady";
      const color = PLAYER_COLORS[(slot.color ?? slot.id ?? 0) % PLAYER_COLORS.length] ?? PLAYER_COLORS[0];
      // The sheet's ready tint: black, then the player's own colour at 80%.
      overlay.style.backgroundImage = ready.has(at)
        ? `linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(30,30,30,1) 35%, rgba(${rgbOf(color)},0.8))`
        : "";
    });
  };

  const stampMinimap = (): void => {
    if (!melee || !minimap || !preview || !icons || poster) return;
    drawPreviewMarkers(minimap, info, preview, icons);
    mapImage.style.backgroundImage = `url("${minimap.toDataURL()}")`;
  };

  document.body.classList.add(LOADING_CURSOR_CLASS);
  paintReady();
  refreshCaption();

  return {
    setProgress: (p) => setFill(p),
    finish(): void {
      loaded = true;
      setFill(1);
      refreshCaption();
    },
    waitForKey(): Promise<void> {
      awaitingKey = true;
      caption.textContent = t("hd.pressAnyKey").toUpperCase();
      return new Promise<void>((resolve) => {
        const go = (e: Event): void => {
          e.preventDefault();
          e.stopPropagation();
          stopWaiting?.();
          resolve();
        };
        window.addEventListener("keydown", go, true);
        window.addEventListener("mousedown", go, true);
        stopWaiting = () => {
          window.removeEventListener("keydown", go, true);
          window.removeEventListener("mousedown", go, true);
          stopWaiting = null;
          awaitingKey = false;
        };
      });
    },
    setPeerReady(peer): void {
      slots.forEach((slot, i) => { if (slot.peer === peer) ready.add(i); });
      paintReady();
      refreshCaption();
    },
    setMinimapPreview(next): void {
      preview = next;
      stampMinimap();
    },
    dispose(): void {
      document.body.classList.remove(LOADING_CURSOR_CLASS);
      window.removeEventListener("resize", rescale);
      stopWaiting?.();
      root.remove();
    },
  };

  function playerCard(slot: SlotConfig): HTMLElement {
    const race: Race = slot.random ? "random" : slot.race;
    const card = el("div", "PlayerLoadingWidget");

    const holder = el("div", "PlayerLoadingWidget-AvatarHolder");
    // No profile avatars here, so the plate keeps the sheet's default portrait.
    holder.append(el("div", "PlayerLoadingWidget-Portrait"), el("div", "Player-Icon-Frame"));

    const playerInfo = el("div", "PlayerLoadingWidget-PlayerInfo");
    const detailsWrap = el("div", "Player-Details-Wrapper");
    const details = el("div", "PlayerLoadingWidget-Details");
    const name = el("div", "PlayerLoadingWidget-PlayerName", slot.playerName || slot.name || playerDefault(slot));
    name.style.color = PLAYER_COLORS[(slot.color ?? slot.id) % PLAYER_COLORS.length];
    details.appendChild(name);

    const raceBox = el("div", "PlayerLoadingWidget-Race");
    raceBox.append(
      el("div", "PlayerLoadingWidget-Race-Name", raceLabel(race).toUpperCase()),
      el("div", `PlayerLoadingWidget-Race-Icon ${race}`),
    );
    detailsWrap.append(details, raceBox);
    playerInfo.appendChild(detailsWrap);
    card.append(holder, playerInfo, el("div", "PlayerLoadingWidget-IsNotReady"));
    return card;
  }
}

function playerDefault(slot: SlotConfig): string {
  return slot.controller === "computer" ? t("hd.computer") : t("lan.playerDefault");
}

/** `#rrggbb` as the `r,g,b` triple the sheet's rgba() gradients take. */
function rgbOf(hex: string): string {
  return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(",");
}

function seatedSlots(config: MeleeConfig): SlotConfig[] {
  return config.slots.filter((s) => s.controller === "user" || s.controller === "computer");
}

function localSlot(config: MeleeConfig): SlotConfig | undefined {
  return config.localPlayer !== undefined
    ? config.slots.find((s) => s.id === config.localPlayer)
    : config.slots.find((s) => s.controller === "user");
}
