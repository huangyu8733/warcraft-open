import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { ART, webUiAssets } from "./assets";
import { HdScreen } from "./screen";
import { loadOfficialStyle } from "./official";
import { backdrop, backButton, officialFileScreen } from "./officialMenu";
import { openSystemMenu } from "./systemMenu";
import { themeVideo } from "./theme";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";

export interface HdCustomCampaignHandlers {
  onCancel: () => void;
}

/**
 * The Reforged Custom Campaign screen (3.0).
 *
 * A stock install has no `.w3n` campaigns and this engine does not open the format yet, so the
 * list is empty exactly as the official screen's is. What is drawn is the official band: the
 * wood title row with the Quick Filter field and its refresh button, the CAMPAIGN column, and
 * the empty 480x936 details frame on the right.
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

  const shell = officialFileScreen(screen, "CustomCampaigns", {
    tft: !isRoc(),
    assets,
    title: t("hd.customCampaign"),
    subtitle: t("hd.customCampaignsFolder"),
    filterPlaceholder: t("hd.quickFilter"),
    refreshLabel: t("hd.refresh"),
    onRefresh: () => paint(),
    onFilter: () => paint(),
    columns: [{ label: t("hd.campaign") }],
  });

  backButton(shell.root, t("hd.back"), h.onCancel, {
    onSystemMenu: () => openSystemMenu(screen, vfs, {}),
    systemMenuLabel: t("hd.menu"),
  });

  paint();
  return screen.attach(container);

  /** A stock install has no campaigns to list; the empty band is the whole screen. */
  function paint(): void {
    shell.list.textContent = "";
    shell.setOverflow(false);
  }
}
