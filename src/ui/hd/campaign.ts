import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { webUiAssets } from "./assets";
import { HdScreen, el } from "./screen";
import { loadOfficialStyle } from "./official";
import { backButton, cornerDecorations, framedButton, primaryButton } from "./officialMenu";
import { openSystemMenu } from "./systemMenu";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";
import type { Campaign } from "../../data/campaigns";
import { completed, openCampaigns, openRows, type Difficulty } from "../../data/campaignProgress";

export interface HdCampaignState {
  campaign: Campaign;
  /** False on the campaign list, true on that campaign's chapter list. */
  chapters: boolean;
  difficulty: Difficulty;
}

export interface HdCampaignHandlers {
  onSelectCampaign: (campaign: Campaign) => void;
  onPlayMission: (campaign: Campaign, index: number) => void;
  onBack: () => void;
  onDifficulty: (difficulty: Difficulty) => void;
  /** Why this chapter cannot run on the mounted install, or null when it can — the very door
   *  the mission start asks (main.ts `chapterRefusal`, `render/mapViewer mapLoadRefusal`).
   *  Asked BEFORE the row can be pressed, so a chapter 3.0's data cannot serve (its w3u edits a
   *  unit Reforged dropped, e.g. `harw`) is greyed with that reason instead of throwing the
   *  refusal dialog over the list. */
  chapterRefusal?: (campaign: Campaign, index: number) => Promise<string | null>;
}

/**
 * The `campaignBgClassName` 3.0 gives a campaign column, which is what selects its spine art
 * (`Campaigns-ListItem.<class> .Campaign-Background` in the sheet).
 *
 * `CampaignInfoReforged.txt` lists the sections by exactly these names — the merged Reforged
 * order (Tutorial, Human, Undead, Orc, NightElf, NightElfEx, HumanEx, UndeadEx, OrcEx) — so the
 * class is the section name. Reign of Chaos's own index spells them `RoC.Human`… and wears the
 * same original spines (its `Human` is Lordaeron's, exactly like the merged list's). A DLC
 * section (`HumanRe`/`UndeadRe`) reuses its race's expansion spine.
 */
function bgClass(key: string): string {
  const dot = key.indexOf(".");
  const name = (dot >= 0 ? key.slice(dot + 1) : key).toLowerCase();
  const classes: Record<string, string> = {
    tutorial: "Tutorial",
    human: "Human",
    undead: "Undead",
    orc: "Orc",
    nightelf: "NightElf",
    nightelfex: "NightElfEx",
    humanex: "HumanEx",
    undeadex: "UndeadEx",
    orcex: "OrcEx",
  };
  if (classes[name]) return classes[name];
  if (/undead|scourge|forsaken/i.test(name)) return "UndeadEx";
  if (/nightelf|sentinels/i.test(name)) return "NightElfEx";
  if (/^orc/i.test(name)) return "OrcEx";
  return "HumanEx";
}

/**
 * The Reforged campaign screens (3.0), built from the same sheet as the main menu.
 *
 * Two of 3.0's screens live here because the engine treats them as one flow:
 *
 *  · `Campaigns` — the campaign list down the right third of the window over the moving war
 *    table, each row the campaign's keyart with a gold header, its name and a chevron button.
 *  · `CampaignMissions` — the chosen campaign: its crest, header and name on the left, with the
 *    difficulty row under them, and the chapters inside an 800x980 metal plate on the right.
 *
 * The data and rules are the FDF screen's own (`openCampaigns` / `openRows`), except that the
 * strip lists every campaign as 3.0 does: a locked one still selects, only its Play is disabled
 * (`isAvailable` in the reference). Chapters stay gated, and encrypted DLC chapters are drawn
 * disabled with the reason.
 */
export async function mountHdCampaign(
  container: HTMLElement,
  vfs: DataSource,
  campaigns: Campaign[],
  state: HdCampaignState,
  h: HdCampaignHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-campaign");
  screen.element.classList.add("hd-official");
  const tft = !isRoc();
  if (tft) screen.element.classList.add("tft");

  // 3.0 draws EVERY campaign as a column and disables Play on the ones this profile has not
  // unlocked (`isDisabled: !isAvailable` in the reference); only the button is greyed out, the
  // column itself still selects and scrolls into view.
  const available = new Set(openCampaigns(campaigns).map(({ campaign }) => campaign.key));
  // 3.0's `campaignVersion`: Reforged's own screens (and the `ReforgedBanner`) for the
  // expansion's data line, the classic banner when the Reign of Chaos index is the one open.
  const VERSION = tft ? "Reforged" : "Classic";
  const BANNER = tft ? "ReforgedBanner" : "ClassicBanner";

  /**
   * 3.0's `GetScale()`: the strip is laid out in percentages and needs no zoom, but three things
   * inside it are authored in 1080-line pixels and are zoomed by the reference itself — the typed
   * block in each column (`Campaign-Details-Wrapper`), the two navigation arrows, and the strip's
   * inset (`Campaigns-List` carries `margin: 0 GetScale()*SIDE_BORDER_SIZE`).
   *
   * The views call the helper themselves (a repaint re-zooms the nodes it just built), so the root
   * is held rather than captured: it does not exist until the view below returns.
   */
  const uiScale = (): number => Math.max(0.25, window.innerHeight / 1080);
  /** `SIDE_BORDER_SIZE` in the reference's glue module. */
  const SIDE_BORDER = 33;
  let mounted: HTMLElement | null = null;
  const applyZoom = (): void => {
    if (!mounted) return;
    const zoom = uiScale();
    const host = mounted;
    for (const w of host.querySelectorAll<HTMLElement>(".Campaign-Details-Wrapper")) {
      w.style.zoom = zoom.toFixed(3);
    }
    for (const n of host.querySelectorAll<HTMLElement>(".Campaigns-Nav-Buttons")) {
      n.style.zoom = zoom.toFixed(3);
    }
    const list = host.querySelector<HTMLElement>(".Campaigns-List");
    if (list) list.style.margin = `0px ${(zoom * SIDE_BORDER).toFixed(1)}px`;
    // The corner Back button is a sibling of the strip and carries the same zoom (`style.zoom`
    // on `PersistentBackButton` in the reference).
    const back = host.querySelector<HTMLElement>(".PersistentBackButton");
    if (back) back.style.zoom = zoom.toFixed(3);
  };

  const root = state.chapters ? chapterView() : campaignView();
  mounted = root;
  screen.content.appendChild(root);
  screen.element.appendChild(cornerDecorations(assets, tft));
  backButton(root, t("hd.back"), h.onBack, {
    onSystemMenu: () => openSystemMenu(screen, vfs, {}),
    systemMenuLabel: t("hd.menu"),
  });

  applyZoom();
  window.addEventListener("resize", applyZoom);

  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    window.removeEventListener("resize", applyZoom);
    dispose();
  };

  return screen.attach(container);

  // --- the campaign list -------------------------------------------------------------
  //
  // 3.0's `Campaigns` screen: ONE horizontal strip of columns over `CampaignSelect_BG.jpg`.
  // Every campaign is a 13.32% column wearing its spine art and its name; the SELECTED one grows
  // to 33.3% and swaps the spine for the full keyart, with the REFORGED banner, the header, the
  // name and a Play button. The arrows at either edge walk the selection.

  function campaignView(): HTMLElement {
    const screenRoot = el("div", "Campaigns");
    const wrapper = el("div", "Campaigns-Wrapper");
    const container = el("div", "Campaigns-Container Animate-In");
    const list = el("div", "Campaigns-List");

    // The arrows are the reference's `Campaigns-Nav-Buttons`: siblings of the strip (not a bar
    // around it, despite the older `NavigationBarContainer` rule), pinned to either edge.
    const prev = el("div", "Campaigns-Nav-Buttons Campaigns-Nav-Buttons--Prev");
    const next = el("div", "Campaigns-Nav-Buttons Campaigns-Nav-Buttons--Next");
    for (const [arrow, step] of [[prev, -1], [next, 1]] as const) {
      arrow.setAttribute("role", "button");
      arrow.tabIndex = 0;
      const walk = (): void => select(selected + step);
      arrow.onclick = walk;
      arrow.onkeydown = (ev): void => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          walk();
        }
      };
    }

    container.appendChild(list);
    wrapper.appendChild(container);
    screenRoot.append(wrapper, prev, next);

    // The reference scrolls the strip sideways on the wheel (`handleOnWheel`), since nine
    // columns are wider than the window and the overflow is the strip's own scroll box.
    list.onwheel = (ev): void => {
      ev.preventDefault();
      list.scrollLeft -= ev.deltaY;
    };

    // The reference opens on column 0 (`selectedCampaign: 0`).
    let selected = 0;

    paint();
    return screenRoot;

    function select(index: number): void {
      if (index < 0 || index >= campaigns.length || index === selected) return;
      selected = index;
      paint();
      list.querySelector<HTMLElement>(`#Campaigns-ListItem-${index}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    function paint(): void {
      list.textContent = "";
      campaigns.forEach((campaign, index) => {
        list.appendChild(index === selected ? selectedItem(campaign, index) : columnItem(campaign, index));
      });
      prev.classList.toggle("Campaigns-Nav-Buttons--isDisabled", selected === 0);
      next.classList.toggle("Campaigns-Nav-Buttons--isDisabled", selected >= campaigns.length - 1);
      applyZoom();
    }

    /** One campaign's spine: its art and its name, and a click to expand it. */
    function columnItem(c: Campaign, index: number): HTMLElement {
      const item = el("div", `Campaigns-ListItem ${bgClass(c.key)}`);
      item.id = `Campaigns-ListItem-${index}`;
      item.appendChild(el("div", `Campaign-Background ${VERSION}`));

      const wrapper = el("div", `Campaign-Details-Wrapper ${VERSION}`);
      const details = el("div", "Campaign-Details");
      const name = el("div", "Campaigns-ListItem-Name");
      // The reference breaks the name over the `|` of its `*_LIST` string, a span a line.
      for (const line of c.name.split("|")) {
        const span = el("span");
        span.appendChild(el("span", "", line));
        name.append(span, "\n");
      }
      details.appendChild(name);
      wrapper.appendChild(details);
      item.appendChild(wrapper);

      item.setAttribute("role", "button");
      item.tabIndex = 0;
      item.onclick = (): void => select(index);
      item.onkeydown = (ev): void => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          select(index);
        }
      };
      return item;
    }

    /** The expanded campaign: keyart, version banner, header, name and Play. */
    function selectedItem(c: Campaign, index: number): HTMLElement {
      const playable = available.has(c.key);
      const item = el("div", `Campaigns-ListItem ${bgClass(c.key)} Selected`);
      item.id = `Campaigns-ListItem-${index}`;
      item.title = c.encrypted
        ? t("campaign.encrypted")
        : t("hd.completed", { done: completed(c), total: c.missions.length });
      item.appendChild(el("div", `Campaign-Background ${VERSION}`));

      const wrapper = el("div", `Campaign-Details-Wrapper ${VERSION}`);
      // The reference puts the banner straight into the wrapper (it is the row's first child,
      // the typed block the second), so it sits in the left padding of the expanded column.
      wrapper.appendChild(
        el("div", `Campaigns-ListItem-VersionBanner ${BANNER}`, t(tft ? "hd.reforged" : "hd.classic")),
      );

      const details = el("div", "Campaign-Details");
      details.appendChild(el("div", "Campaigns-ListItem-Header", c.header));
      details.appendChild(el("div", "Campaigns-ListItem-Name Selected", c.name));
      details.appendChild(framedButton(t("hd.startGame"), () => play(c), !playable || c.encrypted));
      wrapper.appendChild(details);
      item.appendChild(wrapper);
      return item;
    }

    function play(c: Campaign): void {
      if (c.encrypted || !available.has(c.key) || screen.element.classList.contains("hd-disabled")) return;
      h.onSelectCampaign(c);
    }
  }

  // --- one campaign's chapters -------------------------------------------------------

  function chapterView(): HTMLElement {
    const c = state.campaign;
    const screenRoot = el("div", "CampaignMissions");
    const container = el("div", "CampaignMissions-Container");
    container.appendChild(el("div", "CampaignMissions-SideFade"));

    const wrapper = el("div", "CampaignMissions-Wrapper");

    // The campaign column: the Reforged banner, header, name, difficulty.
    const campaignBox = el("div", "CampaignMissions-Campaign");
    campaignBox.appendChild(
      el("div", "CampaignMissions-Campaign-VersionBanner ReforgedBanner", "Reforged"),
    );
    const campaignDetails = el("div", "CampaignMissions-Campaign-Details");
    const description = el("div", "CampaignMissions-Campaign-Description");
    description.appendChild(el("div", "CampaignMissions-Campaign-Header", c.header));
    description.appendChild(el("div", "CampaignMissions-Campaign-Name", c.name));
    campaignDetails.appendChild(description);

    const actions = el("div", "CampaignMissions-Campaign-Actions");
    const difficultyButtons = new Map<Difficulty, HTMLElement>();
    const labels: Array<[Difficulty, string]> = [["normal", t("hd.normal")], ["hard", t("hd.hard")]];
    for (const [value, label] of labels) {
      const b = primaryButton(label, () => {
        state.difficulty = value;
        for (const [v, node] of difficultyButtons) node.classList.toggle("isSelected", v === value);
        h.onDifficulty(value);
      });
      if (value === state.difficulty) b.classList.add("isSelected");
      difficultyButtons.set(value, b);
      actions.appendChild(b);
    }
    campaignDetails.appendChild(actions);
    campaignBox.appendChild(campaignDetails);
    wrapper.appendChild(campaignBox);

    // The chapter plate.
    const plate = el("div", "CampaignMissions-Missions");
    const base = el("div", "BaseFrame");
    const themed = tft ? " tft" : "";
    base.append(
      el("div", `left-chain${themed}`),
      el("div", `right-chain${themed}`),
      el("div", `frame${themed}`),
      el("div", `background-texture${themed}`),
    );
    plate.appendChild(base);

    const header = el("div", "CampaignMissions-Header");
    header.appendChild(el("div", "CampaignMissions-Title", t("hd.chapters")));
    plate.appendChild(header);

    const body = el("div", "CampaignMissions-Body");
    const done = completed(c);
    for (const { entry, mission } of openRows(c)) {
      const row = el(
        "div",
        `CampaignMission${entry.encrypted ? " isDisabled" : ""}${!entry.playable ? " isDisabled" : ""}`,
      );
      /** Set once the data check below says why this chapter cannot run under this install. */
      let blocked: string | null = null;
      row.setAttribute("role", "button");
      row.tabIndex = entry.playable && !entry.encrypted ? 0 : -1;
      if (entry.encrypted) row.title = t("campaign.encrypted");

      const section = el("div", "CampaignMission-Section");
      if (mission < 0) {
        section.appendChild(el("div", "CampaignMission-Cinematic"));
      } else {
        // 3.0 marks a chapter with the difficulty it was beaten on; the engine records whether
        // it was beaten, so a cleared chapter wears the normal banner and the rest are unplayed.
        const badge = el("div", "CampaignMission-Difficulty");
        if (mission < done) badge.classList.add("CampaignMission-Difficulty-2");
        section.appendChild(badge);
      }
      const details = el("div", "CampaignMission-Details");
      details.appendChild(el("div", "CampaignMission-Header", entry.header));
      details.appendChild(el("div", "CampaignMission-Title", entry.name));
      section.appendChild(details);
      row.appendChild(section);

      const open = (): void => {
        if (blocked || !entry.playable || entry.encrypted) return;
        h.onPlayMission(c, mission);
      };
      row.onclick = open;
      row.onkeydown = (ev): void => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          open();
        }
      };
      body.appendChild(row);

      // The data check is asynchronous (it reads the chapter's own map), so the row is drawn
      // enabled and is greyed the moment the answer arrives. A refusal keeps the chapter listed
      // and unpressable, with the reason on hover — the same treatment encrypted DLC gets.
      if (mission >= 0 && h.chapterRefusal) {
        void h.chapterRefusal(c, mission).then((reason) => {
          if (!reason || !row.isConnected) return;
          blocked = reason;
          row.classList.add("isDisabled");
          row.tabIndex = -1;
          row.title = reason;
        });
      }
    }
    plate.appendChild(body);
    wrapper.appendChild(plate);

    container.appendChild(wrapper);
    screenRoot.appendChild(container);
    return screenRoot;
  }
}
