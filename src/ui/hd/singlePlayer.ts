import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { ART, webUiAssets } from "./assets";
import { HdScreen } from "./screen";
import { loadOfficialStyle } from "./official";
import { backdrop, backButton, framedButton, officialMenu } from "./officialMenu";
import { openSystemMenu } from "./systemMenu";
import { openProfileScreen } from "./playerProfile";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";

export interface HdSinglePlayerHandlers {
  onCampaign: () => void;
  onCustomCampaign: () => void;
  onViewReplay: () => void;
  onCustomGame: () => void;
  onCancel: () => void;
  /** The system menu's OPTIONS / CREDITS (the ☰ frame button). */
  onOptions: () => void;
  onCredits: () => void;
}

/**
 * The Reforged single-player menu: the same 3.0 plate as the main menu, without the logo and
 * with the three ways a solo game starts (campaign, custom campaign, custom game), plus the
 * player-profile entry under them. The saved games are behind the ☰ system menu, as in 3.0.
 *
 * A profile is the namespace the campaign's progress and its game caches live under
 * (data/profiles.ts). It is engine chrome rather than a 3.0 control, so it is one more framed
 * row in the plate's own column rather than a widget floating over the artwork.
 */
export async function mountHdSinglePlayer(
  container: HTMLElement,
  vfs: DataSource,
  h: HdSinglePlayerHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-single");
  screen.element.classList.add("hd-official");
  const tft = !isRoc();
  if (tft) screen.element.classList.add("tft");

  void backdrop(screen, assets, ART.home, isRoc() ? ART.mainMenuVideoRoc : ART.mainMenuVideo);

  const menu = officialMenu(screen, { menuClass: "SinglePlayerMenu", navClass: "MainMenuScreen-SinglePlayerMenu", tft, assets });
  menu.nav.append(
    framedButton(t("hd.campaign"), h.onCampaign),
    framedButton(t("hd.customCampaign"), h.onCustomCampaign),
    framedButton(t("hd.customGame"), h.onCustomGame),
    framedButton(t("hd.profile"), () => openProfileScreen(vfs)),
  );
  // The ☰ opens the system menu, where the saved-game list lives now (3.0 keeps no Save button
  // in the corner frame). Its single-player plate mirrors these same three entries.
  backButton(menu.holder, t("hd.back"), h.onCancel, {
    onSystemMenu: () =>
      openSystemMenu(screen, vfs, {
        onOptions: h.onOptions,
        onCredits: h.onCredits,
        singlePlayer: {
          onCampaign: h.onCampaign,
          onCustomCampaign: h.onCustomCampaign,
          onCustomGame: h.onCustomGame,
        },
      }),
    systemMenuLabel: t("hd.menu"),
  });
  menu.rescale();

  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    menu.dispose();
    dispose();
  };

  return screen.attach(container);
}
