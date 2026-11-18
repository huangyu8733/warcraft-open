import type { DataSource } from "../../vfs/types";

/**
 * The 3.0 glue interface's own art (issue #…): Reforged does not dress its menus with
 * `UI\FrameDef\*.fdf` at all — the whole front end is a web app under `WebUI\`, and those
 * files are what it draws itself with. The FDF screens therefore keep wearing the classic
 * chain panels, and the HD screens wear these.
 *
 * Every lookup goes through the mounted install, and every image reaches the DOM as a blob
 * URL built from its bytes (the archives hold no HTTP-addressable originals). The paths are
 * indexed once per install and matched case-insensitively, because the `WebUI` listfile is
 * as inconsistent about case as the rest of WC3's.
 */

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  webm: "video/webm",
  mp4: "video/mp4",
};

/** One resolved `WebUI\…` path → its blob URL, or null when the install doesn't ship it. */
export interface WebUiAssets {
  /** The install's own spelling of this path, if it has the file. */
  resolve(path: string): string | null;
  /** A blob URL for the image, cached for the page's lifetime. */
  url(path: string): Promise<string | null>;
  /** Resolve several at once (they are read in parallel). */
  preload(paths: readonly string[]): Promise<void>;
}

const CACHE = new WeakMap<DataSource, WebUiAssets>();

/** The `WebUI\` art of one install. Built on first use, then reused by every HD screen — the
 *  index is over ~7,400 paths and the blob URLs stay valid for the page's life. */
export function webUiAssets(vfs: DataSource): WebUiAssets {
  const hit = CACHE.get(vfs);
  if (hit) return hit;
  const made = new WebUiIndex(vfs);
  CACHE.set(vfs, made);
  return made;
}

class WebUiIndex implements WebUiAssets {
  private readonly paths = new Map<string, string>();
  private readonly urls = new Map<string, Promise<string | null>>();

  constructor(private readonly vfs: DataSource) {
    for (const path of vfs.list()) {
      const key = normalize(path);
      if (key.startsWith("webui\\")) this.paths.set(key, path);
    }
  }

  resolve(path: string): string | null {
    return this.paths.get(normalize(path)) ?? null;
  }

  url(path: string): Promise<string | null> {
    const key = normalize(path);
    const hit = this.urls.get(key);
    if (hit) return hit;
    const real = this.paths.get(key);
    if (!real) {
      this.urls.set(key, Promise.resolve(null));
      return Promise.resolve(null);
    }
    const pending = this.vfs
      .read(real)
      .then((bytes) => {
        const ext = /\.([a-z0-9]+)$/i.exec(real)?.[1].toLowerCase() ?? "";
        const type = MIME[ext] ?? "application/octet-stream";
        return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
      })
      .catch((err) => {
        console.warn(`[Warcraft Open] HD art missing: ${real}`, err);
        return null;
      });
    this.urls.set(key, pending);
    return pending;
  }

  async preload(paths: readonly string[]): Promise<void> {
    await Promise.all(paths.map((p) => this.url(p)));
  }
}

function normalize(path: string): string {
  return path.replace(/\//g, "\\").replace(/^\\+/, "").toLowerCase();
}

// --- the paths the HD screens draw with ---------------------------------------------
//
// Named here rather than in each screen so a path is spelled once: the 3.0 install's WebUI
// list has no stable API, and a typo is a silently blank panel.

export const ART = {
  home: "WebUI\\Common\\HomeScreen.jpg",
  /** The 3.0 main menu's moving backdrop. Reforged is The Frozen Throne's line (Icecrown);
   *  the Reign of Chaos menu is the Orc banner in the rain. */
  mainMenuVideo: "WebUI\\Webms\\mainmenu_tft.webm",
  mainMenuVideoRoc: "WebUI\\Webms\\mainmenu_1.webm",
  /** The two classic backs the theme reuses (the SD movies 3.0 ships beside the HD ones), and
   *  the Forsaken one. `ui/hd/theme.ts` orders all five the way the logo click cycles them. */
  mainMenuVideoSd: "WebUI\\Webms\\mainmenu_sd.webm",
  mainMenuVideoTftSd: "WebUI\\Webms\\mainmenu_tft_sd.webm",
  mainMenuVideoFk: "WebUI\\Webms\\mainmenu_fk.webm",
  /** The three-second wipe 3.0 plays while a logo click changes the interface theme
   *  (`MAIN_MENU_TRANSITIONS` in `WebUI\GlueManager.js`), one per new face. */
  themeTransitionRoc: "WebUI\\Webms\\transition_to_roc.webm",
  themeTransitionTft: "WebUI\\Webms\\transition_to_tft.webm",
  themeTransitionRocSd: "WebUI\\Webms\\transition_to_roc_sd.webm",
  themeTransitionTftSd: "WebUI\\Webms\\transition_to_tft_sd.webm",
  themeTransitionFk: "WebUI\\Webms\\transition_to_fk.webm",
  /** The campaign screen's moving backdrop: the war table the campaign cards sit on. */
  campaignVideo: "WebUI\\Webms\\campaign_expansions.webm",
  campaignTable: "WebUI\\Backgrounds\\CampaignSelect_BG.jpg",
  expansionTft: "WebUI\\Expansions\\Backgrounds\\the_frozen_throne.png",
  expansionRoc: "WebUI\\Expansions\\Backgrounds\\reign_of_chaos.png",
  logoZh: "WebUI\\Common\\reforged-logo-zhCN.png",
  logoEn: "WebUI\\Common\\reforged-logo.png",
  metalFrame: "WebUI\\BaseFrames\\war3_metal_frame.png",
  metalFrameTft: "WebUI\\BaseFrames\\tft_war3_metal_frame_4k.png",
  stoneBg: "WebUI\\BaseFrames\\war3_stone_bg_landscape_4k.png",
  divider: "WebUI\\Common\\header-decoration-gold.png",
  dividerWide: "WebUI\\Common\\war3_divider_horiztonal_4k.png",
  siderail: "WebUI\\BaseFrames\\siderail.png",
  campaignFrame: "WebUI\\Campaign\\CampaignSelect\\wc3_campaignselect_frame.png",
  campaignPanel: "WebUI\\Campaign\\CampaignSelect\\wc3_campaignselect_panel_right.png",
  campaignBottom: "WebUI\\Campaign\\CampaignSelect\\wc3_campaignselect_panel_bottom.png",
  doorLeft: "WebUI\\Campaign\\CampaignSelect\\wc3_campaignselect_door_left.png",
  doorRight: "WebUI\\Campaign\\CampaignSelect\\wc3_campaignselect_door_right.png",
  cog: "WebUI\\Campaign\\CampaignSelect\\wc3_campaignselect_cog.png",
  checkmark: "WebUI\\Campaign\\campaign-mission-checkmark.png",
  nonPlayable: "WebUI\\Campaign\\non-playable_icon.png",
  arrowResting: "WebUI\\Icons\\chevron-right-icon-resting.png",
  arrowHover: "WebUI\\Icons\\chevron-right-icon-hover.png",
  arrowDisabled: "WebUI\\Icons\\chevron-right-icon-disabled.png",
  checkResting: "WebUI\\Icons\\checkmark-icon-resting.png",
  lockResting: "WebUI\\Icons\\lock-icon-resting.png",
  playResting: "WebUI\\Icons\\play-icon-resting.png",
} as const;

/** The campaign keyart the 3.0 selection screen uses for a campaign, by its index section.
 *
 * The four base campaigns exist in BOTH editions under the same section names, so the art is
 * picked by edition as well: HD is The Frozen Throne's line (Alliance / Scourge / Sentinels /
 * the Rexxar bonus campaign), SD keeps this project's Reign of Chaos data path.
 */
export function campaignKeyart(section: string, roc: boolean): string | null {
  const key = section.replace(/^roc\./i, "").toLowerCase();
  const art = (name: string): string => `WebUI\\Campaign\\CampaignSelect\\Backgrounds\\${name}`;
  if (roc) {
    switch (key) {
      case "tutorial": return art("roc_prologue.png");
      case "human": return art("roc_human.png");
      case "undead": return art("roc_undead.png");
      case "orc": return art("roc_orc.png");
      case "nightelf": return art("roc_nightelf.png");
      default: return null;
    }
  }
  switch (key) {
    // 3.0's own section names (`CampaignInfoReforged.txt`) are the campaign's role, not the
    // race: the Blood Elf line is [Human], Maiev's is [NightElf] (or [Sentinel] in some
    // builds), the bonus campaign is [Orc]. All aliases are accepted.
    case "prologue":
    case "tutorial": return art("wc3_campaign_keyart_prologue.png");
    case "human":
    case "humanex":
    case "alliance": return art("wc3_campaign_keyart_alliance.png");
    case "undead":
    case "undeadex":
    case "scourge": return art("wc3_campaign_keyart_scourge.png");
    case "nightelf":
    case "nightelfex":
    case "sentinel": return art("wc3_campaign_keyart_sentinel.png");
    case "orc":
    case "orcex":
    case "bonus":
    case "rexxar": return art("wc3_campaign_keyart_rexxar.png");
    // 3.0's DLC campaigns (`CampaignInfoDLC01.txt`, the Forsaken): the install keeps the
    // closed-doors plate for them — the screen the game shows for a DLC you do not own. Its
    // chapters are the encrypted `.w3xd` maps this engine lists but cannot read.
    case "humanre":
    case "undeadre": return "WebUI\\Expansions\\Backgrounds\\dlc01.png";
    default: return null;
  }
}
