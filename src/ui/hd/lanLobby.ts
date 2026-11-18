import type { DataSource } from "../../vfs/types";
import { RACES, raceLabel } from "../../data/races";
import type { MapInfo } from "../../world/mapInfo";
import { startsExplored } from "../../world/mapKind";
import { sanitizeChat } from "../../game/chat";
import { matchLinkFrom, type MatchLinkSetup } from "../../game/matchLink";
import { relayAuthority, type LanLobby } from "../../net/lobby";
import { officialServerName } from "../../net/officialServer";
import type { PeerInfo, StartMatch } from "../../net/protocol";
import { isDefaultAdvanced, type AdvancedOptions } from "../../net/advancedOptions";
import {
  applyRequest, buildStart, canStart, colorsFreeFor, editSlot, isSeated, markDownloads, newSetup, rosterDiff,
  seatPeers, type LobbyChat, type LobbyCount, type LobbyRequest, type LobbySetup, type SlotKind,
} from "../../net/lobbySetup";
import { PLAYER_COLORS } from "../hud";
import type { FdfScreen } from "../fdf/render";
import type { MeleeConfig } from "../lobby";
import { HANDICAPS, SLOT_OPTIONS, forceGroups, slotOption, slotOptionValue, slotOptionsFor, teamOptions, labelOf } from "../playerSlots";
import { copyText, observerSeats, toConfig } from "../fdfLan";
import { t } from "../../i18n";
import { HdScreen, el } from "./screen";
import { webUiAssets } from "./assets";
import { loadOfficialStyle } from "./official";
import { cornerDecorations, primaryButton } from "./officialMenu";
import { settingsRow } from "./lan";
import { isRoc } from "../../data/edition";
import { imageToDataUrl } from "../../render/blputil";

export interface LanLobbyHandlers {
  onCancel: () => void;
  onStart: (mapPath: string, info: MapInfo, config: MeleeConfig, link: MatchLinkSetup) => void;
  onCountdownTick?: () => void;
}

const COUNTDOWN_SECONDS = 5;
const CANCEL_DEADLINE_SECONDS = 2;
const OBSERVERS_TEAM = "observers";
const COPIED_MS = 1500;

/**
 * The Reforged LAN game lobby (3.0's `GameLobby`): the player rows and the chat on the left, the
 * map and the room's details on the right, Start Game / Cancel underneath.
 *
 * The rules are ui/fdfLanLobby.ts's, unchanged: the host owns the seating and broadcasts it,
 * a client renders the last broadcast and asks for changes, the countdown is the host's clock
 * (five lines, one a second, Cancel live until the "2"), and the wire changes hands in `enter`
 * before the match starts. Only the shell is 3.0's.
 */
export async function mountHdLanLobbyScreen(
  container: HTMLElement,
  vfs: DataSource,
  _maps: Map<string, File>,
  lobby: LanLobby,
  map: { path: string; info: MapInfo },
  h: LanLobbyHandlers,
  hostAdvanced?: AdvancedOptions,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-lan-lobby");
  screen.element.classList.add("hd-official");
  if (!isRoc()) screen.element.classList.add("tft");

  const isHost = (): boolean => lobby.isHost;

  // --- the shell ----------------------------------------------------------------------
  const root = el("div", "GameLobbyMain");
  const band = el("div", "GameLobby-ContentContainer");
  const panel = el("div", "GameLobby-MainPanel");

  const left = el("div", "GameLobby-LeftPanel");
  const playersBox = el("div", "GameLobby-PlayersFrame");
  const playersScroll = el("div", "GameLobby-PlayersFrame-Scroll");
  playersBox.appendChild(playersScroll);

  const chatFrame = el("div", "GameLobby-ChatFrame");
  const chatLog = el("div", "ChatFrame-ChatContainer");
  const chatArea = el("div", "chatArea");
  chatLog.appendChild(chatArea);
  const chatInputRow = el("div", "ChatFrame-Input-Wrapper");
  const chatInput = el("input", "Official-Field ChatFrame-Input") as HTMLInputElement;
  chatInput.maxLength = 200;
  chatInputRow.append(chatInput, primaryButton(t("hd.send"), () => submit()));
  chatFrame.append(chatLog, chatInputRow);
  left.append(playersBox, chatFrame);

  const right = el("div", "GameLobby-RightPanel");
  const mapFrame = el("div", "GameLobby-MapFrame");
  const mapImage = el("div", "GameLobby-MapImage");
  mapFrame.appendChild(mapImage);
  const gameName = el("div", "GameLobby-GameName", "");
  const mapName = el("div", "GameLobby-MapName", "");
  const mapAuthor = el("div", "GameLobby-MapAuthor", "");
  const mapDescription = el("div", "GameLobby-MapDescription", "");
  const advancedBox = el("div", "GameLobby-Advanced", "");
  const addressRow = el("button", "GameLobby-Address");
  addressRow.type = "button";
  const buttons = el("div", "GameLobby-Btns");
  const startButton = primaryButton(t("hd.startGame"), () => startMatch(), "", true);
  const cancelButton = primaryButton(t("hd.cancel"), () => cancel());
  buttons.append(startButton, cancelButton);
  right.append(mapFrame, gameName, mapName, mapAuthor, mapDescription, advancedBox, addressRow, buttons);

  const base = el("div", "BaseFrame Official-BaseFrame");
  const themed = isRoc() ? "" : " tft";
  base.append(
    el("div", `left-chain${themed}`),
    el("div", `right-chain${themed}`),
    el("div", `frame${themed}`),
    el("div", "background-texture"),
  );

  panel.append(left, right, base);
  band.append(panel);
  root.append(el("div", "Official-Background"), band);
  screen.content.appendChild(root);
  screen.element.appendChild(cornerDecorations(assets, !isRoc()));

  const rescale = (): void => {
    root.style.zoom = String(Math.max(0.5, window.innerHeight / 1080));
  };
  rescale();
  window.addEventListener("resize", rescale);

  // --- the lobby's state ---------------------------------------------------------------
  let setup: LobbySetup | null = null;
  const chat: string[] = [];
  let alive = true;
  let copiedUntil = 0;
  let wasInRoom = false;
  let countdown: number | null = null;
  let countdownAt = 0;
  let showing: number | null = null;

  const append = (line: string): void => {
    chat.push(line);
    const lineEl = el("p", "", line);
    chatArea.appendChild(lineEl);
    chatLog.scrollTop = chatLog.scrollHeight;
  };

  const system = (key: string, who: string): void => {
    append((key === "NETMESSAGE_PLAYERJOINED" ? t("hd.joinedGame") : t("hd.leftGame")).replace("{name}", who));
  };

  const hostPeer = (): number | undefined => lobby.snapshot.peers.find((p) => p.host)?.id;

  const nameOf = (peer: number): string =>
    setup?.slots.find((s) => s.peer === peer)?.name
    ?? setup?.observers.find((o) => o.peer === peer)?.name
    ?? lobby.snapshot.peers.find((p) => p.id === peer)?.name
    ?? t("lan.playerDefault");

  const say = (from: number, text: string): void => {
    const clean = sanitizeChat(text);
    if (clean) append(`${nameOf(from)}: ${clean}`);
  };

  function submit(): void {
    const text = sanitizeChat(chatInput.value);
    chatInput.value = "";
    const me = lobby.snapshot.you?.id;
    if (!text || me === undefined) return;
    lobby.send({ k: "lobbychat", text } satisfies LobbyChat);
    say(me, text);
  }
  chatInput.onkeydown = (e): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  };

  // --- the host's side -----------------------------------------------------------------
  const broadcast = (): void => {
    if (isHost() && setup) lobby.send(setup);
  };

  const reseat = (peers: readonly PeerInfo[]): void => {
    if (!isHost()) return;
    setup ??= newSetup(map.path, map.info.name, lobby.snapshot.room?.name ?? map.info.name, map.info, hostAdvanced);
    const before = setup.slots.length + setup.observers.length;
    const { setup: seated, joined, left } = seatPeers(setup, peers);
    setup = markDownloads(seated, lobby.snapshot.downloads);
    for (const p of joined) if (!p.host) system("NETMESSAGE_PLAYERJOINED", p.name);
    for (const name of left) system("NETMESSAGE_PLAYERLEFT", name);
    if (setup.slots.length + setup.observers.length !== before) regroup();
    broadcast();
  };

  const onRequest = (from: number, req: LobbyRequest): void => {
    if (!isHost() || !setup) return;
    if (req.abort) {
      if (countdown !== null && cancelLive()) abortCountdown();
      return;
    }
    const next = applyRequest(setup, from, req);
    if (!next) return;
    setup = next;
    broadcast();
    render();
  };

  // --- starting ------------------------------------------------------------------------
  const enter = (msg: StartMatch): void => {
    const me = lobby.snapshot.you?.id;
    const host = hostPeer() ?? 1;
    alive = false;
    stopCountdown();
    lobby.handOff();
    lobby.onChange = () => {};
    lobby.onStart = () => {};
    lobby.onPeerData = () => {};
    const link = matchLinkFrom(lobby, isHost(), msg.slots, me, host, observerSeats(msg));
    if (!isHost()) lobby.rememberMatch(msg, host);
    h.onStart(map.path, map.info, toConfig(msg, me, startsExplored(map.info.classification.flags)), link);
  };

  const launch = (): void => {
    if (!isHost() || !setup) return;
    const msg = buildStart(setup);
    lobby.startMatch(msg);
    enter(msg);
  };

  const stopCountdown = (): void => {
    if (countdown === null) return;
    clearInterval(countdown);
    countdown = null;
  };

  const abortCountdown = (): void => {
    stopCountdown();
    showing = null;
    if (setup?.counting) {
      setup = { ...setup, counting: false };
      broadcast();
    }
    render();
  };

  const cancelLive = (): boolean =>
    !setup?.counting || showing === null || showing > CANCEL_DEADLINE_SECONDS;

  const countdownLine = (n: number): void => {
    append(t("hd.startingIn").replace("{n}", String(n)));
    h.onCountdownTick?.();
  };

  const tick = (): void => {
    if (!isHost() || !setup || !canStart(setup, lobby.snapshot.peers)) {
      abortCountdown();
      return;
    }
    if (countdownAt <= 0) {
      stopCountdown();
      launch();
      return;
    }
    lobby.send({ k: "lobbycount", n: countdownAt } satisfies LobbyCount);
    countdownLine(countdownAt);
    showing = countdownAt;
    countdownAt -= 1;
    syncButtons();
  };

  function cancel(): void {
    if (setup?.counting) {
      if (isHost()) abortCountdown();
      else lobby.send({ k: "lobbyreq", abort: true } satisfies LobbyRequest);
      return;
    }
    alive = false;
    stopCountdown();
    lobby.leave();
    h.onCancel();
  }

  function startMatch(): void {
    if (!isHost() || !setup || countdown !== null) return;
    countdownAt = COUNTDOWN_SECONDS;
    showing = null;
    setup = { ...setup, counting: true };
    broadcast();
    countdown = window.setInterval(tick, 1000);
    tick();
    render();
  }

  // --- lobby traffic --------------------------------------------------------------------
  lobby.onPeerData = (from, data) => {
    if (!alive) return;
    const msg = data as { k?: string } | null;
    if (!msg) return;
    if (msg.k === "lobby") {
      if (isHost()) return;
      const prev = setup;
      setup = msg as LobbySetup;
      const { joined, left } = rosterDiff(prev, setup);
      for (const name of joined) system("NETMESSAGE_PLAYERJOINED", name);
      for (const name of left) system("NETMESSAGE_PLAYERLEFT", name);
      if (!setup.counting) showing = null;
      render();
      return;
    }
    if (msg.k === "lobbyreq") return onRequest(from, msg as LobbyRequest);
    if (msg.k === "lobbychat") return say(from, (msg as LobbyChat).text);
    if (msg.k === "lobbycount" && from === hostPeer()) {
      showing = (msg as LobbyCount).n;
      countdownLine(showing);
      syncButtons();
    }
  };

  lobby.onChange = (st) => {
    if (!alive) return;
    const inRoom = st.phase === "hosting" || st.phase === "joined";
    if (!inRoom) {
      if (wasInRoom) {
        alive = false;
        h.onCancel();
      }
      return;
    }
    wasInRoom = true;
    reseat(st.peers);
    render();
  };

  lobby.onStart = (msg) => { if (alive) enter(msg); };

  // --- the rows ---------------------------------------------------------------------------
  const grouped = (): Array<{ name: string; rows: Array<{ index: number; bench: boolean }> }> => {
    const bench = setup?.observers.length ?? 0;
    const slots = setup?.slots.length ?? map.info.slots.length;
    const groups = forceGroups(map.info, (setup?.slots ?? map.info.slots).map((s) => s.id))
      .map((g) => ({ name: g.name, rows: g.rows.map((index) => ({ index, bench: false })) }));
    if (bench) {
      groups.push({
        name: t("hd.observers"),
        rows: Array.from({ length: bench }, (_, j) => ({ index: slots + j, bench: true })),
      });
    }
    return groups;
  };

  function render(): void {
    if (!alive) return;
    gameName.textContent = setup?.gameName ?? lobby.snapshot.room?.name ?? "";
    mapName.textContent = map.info.name;
    mapAuthor.textContent = [map.info.recommendedPlayers, map.info.tileset].filter(Boolean).join(" · ");
    mapDescription.textContent = map.info.description || "";
    mapImage.style.backgroundImage = map.info.minimap ? `url("${imageToDataUrl(map.info.minimap)}")` : "";

    paintAdvanced();
    paintAddress();
    paintPlayers();
    syncButtons();
  }

  function paintPlayers(): void {
    playersScroll.textContent = "";
    if (!setup) {
      playersScroll.appendChild(el("p", "Official-Empty", t("hd.waitingForPlayers")));
      return;
    }
    const locked = !!setup.counting;
    const me = lobby.snapshot.you?.id;
    const fixed = !!map.info.fixedPlayerSettings;
    const computerPlus = !!setup.advanced.computerPlus;
    const teams = [
      ...teamOptions(setup.slots.length),
      ...(setup.observers.length ? [{ value: OBSERVERS_TEAM, label: t("hd.observer") }] : []),
    ];

    for (const group of grouped()) {
      if (group.name) playersScroll.appendChild(el("div", "GameLobby-ForceLabel", group.name));
      for (const row of group.rows) {
        if (row.bench) paintBenchRow(row.index - setup.slots.length, locked, me, teams);
        else paintSlotRow(row.index, locked, me, fixed, computerPlus, teams);
      }
    }
  }

  function paintSlotRow(
    i: number,
    locked: boolean,
    me: number | undefined,
    fixed: boolean,
    computerPlus: boolean,
    teams: Array<{ value: string; label: string }>,
  ): void {
    const slot = setup?.slots[i];
    if (!slot) return;
    const mine = slot.kind === "player" && slot.peer === me;
    const ours = mine || (isHost() && slot.kind !== "player");
    const seated = isSeated(slot);
    const row = el("div", `GameLobby-PlayerRow${mine ? " isYou" : ""}`);

    const swatch = el("button", "GameLobby-PlayerColor");
    swatch.type = "button";
    swatch.style.backgroundColor = PLAYER_COLORS[slot.color % PLAYER_COLORS.length];
    const colors = setup ? colorsFreeFor(setup, i) : [slot.color];
    const colorSelect = el("select", "GameLobby-ColorSelect") as HTMLSelectElement;
    for (const c of colors) {
      const option = el("option", "", `Player ${c + 1}`);
      option.value = String(c);
      colorSelect.appendChild(option);
    }
    colorSelect.value = String(slot.color);
    colorSelect.disabled = locked || !seated || !ours;
    colorSelect.onchange = (): void => {
      change(i, { color: Number(colorSelect.value) });
    };
    const colorCell = el("div", "GameLobby-ColorCell");
    colorCell.append(swatch, colorSelect);

    const nameCell = el("div", "GameLobby-PlayerName");
    if (slot.kind === "player") {
      nameCell.textContent = `${slot.name ?? t("lan.playerDefault")}${slot.download !== undefined ? ` — ${slot.download}%` : ""}`;
    } else {
      const select = el("select", "GameLobby-RowField") as HTMLSelectElement;
      const options = slot.locked
        ? [{ value: "computer", label: labelOf("computer") }]
        : slotOptionsFor(computerPlus);
      for (const o of options) {
        const option = el("option", "", o.label);
        option.value = o.value;
        select.appendChild(option);
      }
      select.value = slot.kind === "computer" ? slotOptionValue("computer", slot.ai, computerPlus) : slot.kind;
      select.disabled = locked || !isHost() || slot.locked;
      select.onchange = (): void => hostSetKind(i, select.value);
      nameCell.appendChild(select);
    }

    const race = el("select", "GameLobby-RowField") as HTMLSelectElement;
    for (const r of RACES) {
      const option = el("option", "", raceLabel(r));
      option.value = r;
      race.appendChild(option);
    }
    race.value = slot.race;
    race.disabled = locked || !seated || !ours;
    race.onchange = (): void => { change(i, { race: race.value }); };

    const team = el("select", "GameLobby-RowField") as HTMLSelectElement;
    for (const option of teams) {
      const o = el("option", "", option.label);
      o.value = option.value;
      team.appendChild(o);
    }
    team.value = String(slot.team);
    team.disabled = locked || !seated || !ours || (fixed && !mine);
    team.onchange = (): void => {
      if (team.value === OBSERVERS_TEAM) change(i, { observe: true });
      else change(i, { team: parseInt(team.value, 10) });
    };

    const handicap = el("select", "GameLobby-RowField") as HTMLSelectElement;
    for (const p of HANDICAPS) {
      const option = el("option", "", `${p}%`);
      option.value = String(p);
      handicap.appendChild(option);
    }
    handicap.value = String(slot.handicap);
    handicap.disabled = locked || !seated || !ours || (fixed && !mine);
    handicap.onchange = (): void => { change(i, { handicap: parseInt(handicap.value, 10) }); };

    row.append(colorCell, nameCell, race, team, handicap);
    playersScroll.appendChild(row);
  }

  function paintBenchRow(
    j: number,
    locked: boolean,
    me: number | undefined,
    teams: Array<{ value: string; label: string }>,
  ): void {
    const seat = setup?.observers[j];
    if (!seat) return;
    const mine = seat.kind === "player" && seat.peer === me;
    const row = el("div", `GameLobby-PlayerRow isObserver${mine ? " isYou" : ""}`);

    const swatch = el("div", "GameLobby-PlayerColor isEmpty");
    const nameCell = el("div", "GameLobby-PlayerName");
    if (seat.kind === "player") {
      nameCell.textContent = `${seat.name ?? t("lan.playerDefault")}${seat.download !== undefined ? ` — ${seat.download}%` : ""}`;
    } else {
      const select = el("select", "GameLobby-RowField") as HTMLSelectElement;
      for (const o of SLOT_OPTIONS.filter((x) => x.controller === "open" || x.controller === "closed")) {
        const option = el("option", "", o.label);
        option.value = o.value;
        select.appendChild(option);
      }
      select.value = seat.kind;
      select.disabled = locked || !isHost();
      select.onchange = (): void => hostSetBenchKind(j, select.value);
      nameCell.appendChild(select);
    }

    const team = el("select", "GameLobby-RowField") as HTMLSelectElement;
    for (const option of teams) {
      const o = el("option", "", option.label);
      o.value = option.value;
      team.appendChild(o);
    }
    team.value = OBSERVERS_TEAM;
    team.disabled = locked || !mine;
    team.onchange = (): void => {
      if (team.value !== OBSERVERS_TEAM) benchChange(j, parseInt(team.value, 10));
    };

    row.append(swatch, nameCell, team);
    playersScroll.appendChild(row);
  }

  function paintAdvanced(): void {
    advancedBox.textContent = "";
    if (!setup) return;
    const a = setup.advanced;
    if (isDefaultAdvanced(a)) {
      advancedBox.style.display = "none";
      return;
    }
    advancedBox.style.display = "";
    advancedBox.appendChild(el("div", "GameLobby-AdvancedTitle", t("hd.advancedOptions")));
    const yesNo = (on: boolean): string => t(on ? "hd.on" : "hd.off");
    const rows: Array<[string, string]> = [
      [t("hd.lockTeams"), yesNo(a.lockTeams)],
      [t("hd.teamsTogether"), yesNo(a.teamsTogether)],
      [t("hd.sharedControl"), yesNo(a.sharedControl)],
      [t("hd.randomRaces"), yesNo(a.randomRaces)],
      [t("hd.randomHero"), yesNo(a.randomHero)],
      [t("hd.observers"), pretty(a.observers)],
      [t("hd.visibility"), pretty(a.visibility)],
      [t("hd.computerPlus"), yesNo(a.computerPlus)],
      [t("hd.allTalk"), yesNo(a.allTalk)],
    ];
    for (const [label, value] of rows) advancedBox.appendChild(settingsRow(label, value));
  }

  function paintAddress(): void {
    const here = lobby.primary;
    addressRow.onclick = null;
    addressRow.style.cursor = "";
    if (here?.kind === "official") {
      addressRow.textContent = `${t("lan.hostedOn")} ${officialServerName(relayAuthority(here.url))}`;
      return;
    }
    const addresses = here && here.kind !== "own" ? [relayAuthority(here.url)] : lobby.snapshot.host?.addresses ?? [];
    const first = addresses[0];
    if (!first) {
      addressRow.textContent = "";
      return;
    }
    const url = addresses[0];
    addressRow.textContent = copiedUntil > Date.now()
      ? t("lan.copied")
      : `${t("lan.othersJoin")} ${url}`;
    addressRow.onclick = (): void => {
      void copyText(url);
      copiedUntil = Date.now() + COPIED_MS;
      render();
      setTimeout(() => { if (alive) render(); }, COPIED_MS);
    };
    addressRow.style.cursor = "pointer";
  }

  function syncButtons(): void {
    const canPress = isHost() && !!setup && countdown === null && canStart(setup, lobby.snapshot.peers);
    startButton.classList.toggle("isDisabled", !canPress);
    startButton.setAttribute("aria-disabled", String(!canPress));
    const live = cancelLive();
    cancelButton.classList.toggle("isDisabled", !live);
    cancelButton.setAttribute("aria-disabled", String(!live));
  }

  // --- the seating's rules ----------------------------------------------------------------
  function change(index: number, patch: Omit<LobbyRequest, "k">): boolean {
    const slot = setup?.slots[index];
    if (!setup || !slot) return false;
    const me = lobby.snapshot.you?.id;
    const mine = slot.kind === "player" && slot.peer === me;
    if (!mine && !(isHost() && slot.kind !== "player")) return false;
    if (!isHost()) {
      lobby.send({ k: "lobbyreq", ...patch } satisfies LobbyRequest);
      return true;
    }
    const next = mine && me !== undefined
      ? applyRequest(setup, me, { k: "lobbyreq", ...patch })
      : editSlot(setup, index, patch);
    if (!next) {
      render();
      return false;
    }
    setup = next;
    broadcast();
    render();
    return true;
  }

  function benchChange(j: number, team: number): void {
    const seat = setup?.observers[j];
    const me = lobby.snapshot.you?.id;
    if (!setup || !seat || seat.kind !== "player" || seat.peer !== me || me === undefined) return;
    if (!isHost()) {
      lobby.send({ k: "lobbyreq", team } satisfies LobbyRequest);
      return;
    }
    const next = applyRequest(setup, me, { k: "lobbyreq", team });
    if (!next) return;
    setup = next;
    broadcast();
    render();
  }

  function hostSetKind(index: number, value: string): void {
    const slot = setup?.slots[index];
    if (!isHost() || !setup || !slot || slot.kind === "player" || slot.locked) return;
    const opt = slotOption(value);
    const kind = (opt?.controller ?? value) as Exclude<SlotKind, "player">;
    setup = { ...setup, slots: setup.slots.map((s, i) => (i === index ? { ...s, kind, ai: opt?.ai } : s)) };
    broadcast();
    render();
  }

  function hostSetBenchKind(j: number, value: string): void {
    const seat = setup?.observers[j];
    if (!isHost() || !setup || !seat || seat.kind === "player") return;
    if (value !== "open" && value !== "closed") return;
    setup = { ...setup, observers: setup.observers.map((o, k) => (k === j ? { kind: value } : o)) };
    broadcast();
    render();
  }

  /** Force headings come off the map's forces; a map without them is one unnamed group. */
  function regroup(): void {
    // The grouped() helper reads the map's forces directly, so a reseat needs no rebuild here.
    render();
  }

  // --- first paint -------------------------------------------------------------------------
  wasInRoom = lobby.snapshot.phase === "hosting" || lobby.snapshot.phase === "joined";
  reseat(lobby.snapshot.peers);
  render();
  if (!isHost() && lobby.snapshot.room) lobby.mapWire().arrived(lobby.snapshot.room.mapPath);

  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    alive = false;
    stopCountdown();
    window.removeEventListener("resize", rescale);
    dispose();
  };
  return screen.attach(container);
}

/** A GlobalStrings key as words, for the options the FDF library would have captioned. */
function pretty(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
