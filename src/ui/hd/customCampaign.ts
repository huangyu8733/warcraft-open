import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { ART, webUiAssets } from "./assets";
import { HdScreen, el } from "./screen";
import { loadOfficialStyle } from "./official";
import {
  backdrop,
  backButton,
  framedButton,
  imgDetailsButton,
  imgDetailsDividers,
  imgDetailsHeader,
  imgDetailsOptions,
  imgDetailsRow,
  officialFileScreen,
  officialListRow,
} from "./officialMenu";
import { openSystemMenu } from "./systemMenu";
import { themeVideo } from "./theme";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";
import type { Campaign, CustomCampaignSource } from "../../data/campaigns";

export interface HdCustomCampaignHandlers {
  onCancel: () => void;
  /** Open the picked campaign on its chapter list (main.ts `customCampaignScreen`). */
  onPlay: (campaign: Campaign) => void;
  /** The `.w3n`s in the install's `Maps\Campaign\` folder (data/campaigns.ts). */
  sources: CustomCampaignSource[];
  /** The campaign to have picked already — Back walked here from its chapters. */
  initial?: string | null;
}

/**
 * The Reforged Custom Campaign screen (3.0).
 *
 * The band is the official one: the wood title row with the Quick Filter field and its refresh
 * button, the CAMPAIGN column, and the 480x936 details frame on the right.
 *
 * WHAT IS LISTED is the player's own shelf — every `.w3n` in the install's `Maps\Campaign\`
 * folder (data/campaigns.ts `customCampaignSources`), the game's campaign-map folder, apart from
 * the melee maps. A campaign archive is opened only when its row is picked: the whole `.w3n` has
 * to be read for its chapter table, and a big campaign is hundreds of megabytes the list alone
 * must not spend. Until then the row wears the file's own name.
 */
export async function mountHdCustomCampaign(
  container: HTMLElement,
  vfs: DataSource,
  h: HdCustomCampaignHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-custom-campaign");
  void backdrop(screen, assets, ART.home, themeVideo());

  let picked = h.initial ? h.sources.find((source) => source.key === h.initial) ?? null : null;
  let loaded: Campaign | null = null;
  let failed = false;
  let query = "";
  /** Which pick the pending open belongs to — an answer for an older row is dropped. */
  let opening = 0;
  let mounted = true;

  const shell = officialFileScreen(screen, "CustomCampaigns", {
    tft: !isRoc(),
    assets,
    title: t("hd.customCampaign"),
    subtitle: t("hd.customCampaignsFolder"),
    filterPlaceholder: t("hd.quickFilter"),
    refreshLabel: t("hd.refresh"),
    onRefresh: () => paint(),
    onFilter: (text) => {
      query = text.trim().toLowerCase();
      paint();
    },
    columns: [{ label: t("hd.campaign") }],
  });

  backButton(shell.root, t("hd.back"), h.onCancel, {
    onSystemMenu: () => openSystemMenu(screen, vfs, {}),
    systemMenuLabel: t("hd.menu"),
  });

  paint();
  if (picked) void open(picked);
  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    mounted = false;
    dispose();
  };
  return screen.attach(container);

  function paint(): void {
    paintList();
    paintInfo();
  }

  function paintList(): void {
    shell.list.textContent = "";
    const shown = h.sources.filter((source) => !query || source.name.toLowerCase().includes(query));
    for (const source of shown) {
      shell.list.appendChild(
        officialListRow("CustomCampaigns", [source.name], () => select(source), { selected: source === picked }),
      );
    }
    shell.setOverflow(shell.list.scrollHeight > shell.list.clientHeight);
  }

  function paintInfo(): void {
    shell.aside.textContent = "";
    if (!picked) {
      shell.aside.appendChild(imgDetailsHeader({ title: t("hd.customCampaign") }));
      const empty = imgDetailsOptions();
      empty.querySelector(".ImgDetails-Options")?.appendChild(
        el("div", "ImgDetails-OptionsSection", t("hd.customCampaignsFolder")),
      );
      shell.aside.append(empty, ...imgDetailsDividers());
      return;
    }

    shell.aside.appendChild(imgDetailsHeader({ title: loaded?.name ?? picked.name, author: loaded?.header }));
    const options = imgDetailsOptions();
    const body = options.querySelector(".ImgDetails-Options") as HTMLElement;
    if (loaded) {
      body.appendChild(imgDetailsRow(t("hd.chapters"), String(loaded.missions.length)));
      if (loaded.description) body.appendChild(el("div", "ImgDetails-OptionsSection", loaded.description));
    } else {
      body.appendChild(
        el("div", "ImgDetails-OptionsSection", failed ? t("hd.campaignUnreadable") : t("hd.loading")),
      );
    }
    shell.aside.appendChild(options);

    const action = imgDetailsButton();
    const play = action.querySelector(".ImgDetails-PlayGameBtn") as HTMLElement;
    const button = framedButton(t("hd.playCampaign"), () => { if (loaded) h.onPlay(loaded); }, !loaded);
    button.querySelector(".Primary-Button")?.classList.add("Primary-Button-Blue");
    play.appendChild(button);
    shell.aside.append(action, ...imgDetailsDividers());
  }

  function select(source: CustomCampaignSource): void {
    if (source === picked) return;
    picked = source;
    loaded = null;
    failed = false;
    paint();
    void open(source);
  }

  /** Read the picked archive into a Campaign — the one expensive step, and only on a pick. */
  async function open(source: CustomCampaignSource): Promise<void> {
    const seq = ++opening;
    const campaign = await source.load();
    if (!mounted || seq !== opening || source !== picked) return;
    loaded = campaign;
    failed = !campaign;
    paint();
  }
}
