import type { DataSource } from "../vfs/types";
import { loadDifficulty, saveDifficulty, type Difficulty } from "../data/campaignProgress";
import type { Campaign, CustomCampaignSource } from "../data/campaigns";
import type { FdfFrame } from "./fdf/parser";
import type { FdfLibrary } from "./fdf/library";
import { mountFdfScreen, type FdfScreen } from "./fdf/render";
import { DIFFICULTIES } from "./fdfCampaign";
import { adopt, arg, findFrame, nudgeX, num, setProp, size, str } from "./mapBrowser";
import { widescreen } from "./widescreen";
import { t } from "../i18n";

// The Custom Campaign screen, built from the game's own UI\FrameDef\Glue\CustomCampaignMenu.fdf:
// the list of installed custom campaigns down the left with the difficulty box under it, the
// chosen campaign's details top-right, and Play Campaign / Back at the bottom.
//
// WHICH CHROME IT WEARS — the same question, and the same answer, as ui/fdfViewReplay.ts: no
// panel model carries a "CustomCampaign" triple, and this file's geometry is the file-list
// shape (a 0.37-wide `FileListFrame` under a title at 0.02625/-0.039, a 0.271875×0.223125
// info pane at TOP→TOPRIGHT -0.180625/-0.0375, OK/Cancel at BOTTOMRIGHT -0.014375/0.124375),
// which is "BattlenetCustomCreate": one tall left-hand frame, no lower-left strip. Its list is
// shorter than the replay screen's (0.3 against 0.325) because the difficulty box sits under
// it — inside the same frame.
//
// THE PANE IS THIS FILE'S OWN, not MapInfoPane.fdf. CustomCampaignMenu.fdf declares
// `CampaignInfoPane`'s contents inline (name + author badge, the minimap under its cover art,
// author / difficulty / number of missions, then the blurb) and anchors all but the first of
// them to each other, exactly as MapInfoPane.fdf does — so the one unanchored frame is placed
// here, the way ui/mapBrowser.ts `layoutInfoPane` places that pane's.
//
// WHAT IS LISTED is the player's own shelf — every `.w3n` in the install's `Maps\Campaign\`
// folder (data/campaigns.ts `customCampaignSources`), the folder the game keeps its campaign maps
// in, so a campaign is never mixed into the melee maps. A campaign archive is opened only when
// its row is picked: the whole `.w3n` has to be read for its chapter table, and a big campaign
// is hundreds of megabytes the list alone must not spend. Until then the row wears the file's
// own name.

const LIST_FDF = "UI\\FrameDef\\Glue\\ListBoxWar3.fdf";

/** How far left the info pane's contents move to sit inside the 3D chrome that frames them —
 *  the same widescreen correction every glue screen's right-hand column needs
 *  (ui/mapBrowser.ts `nudgeX`). */
const PANE_NUDGE = 0.052;

/** CustomCampaignMenu.fdf's own CampaignInfoPane box, and where the name row sits in it. The
 *  minimap is anchored 0.0325 below the pane's top by the file itself; the name row goes in
 *  the gap above it, on the same inset MapInfoPane.fdf's name row uses. */
const NAME_ROW_INSET = 0.03;
const NAME_ROW_TOP = 0.004;
const NAME_W = 0.14;
const NAME_H = 0.019;

export interface CustomCampaignHandlers {
  onCancel: () => void;
  /** Open the picked campaign on its chapter list (main.ts `customCampaignScreen`). */
  onPlay: (campaign: Campaign) => void;
  /** The `.w3n`s in the install's `Maps\Campaign\` folder (data/campaigns.ts). */
  sources: CustomCampaignSource[];
  /** The campaign to have picked already — Back walked here from its chapters. */
  initial?: string | null;
}

export function mountCustomCampaignScreen(
  container: HTMLElement,
  vfs: DataSource,
  h: CustomCampaignHandlers,
): Promise<FdfScreen> {
  // The difficulty is the same setting the Campaign screen keeps — one difficulty for the
  // player, not one per screen (data/campaignProgress.ts).
  let difficulty = loadDifficulty();
  let lib: FdfLibrary | null = null;
  let picked = h.initial ? h.sources.find((source) => source.key === h.initial) ?? null : null;
  let loaded: Campaign | null = null;
  let failed = false;
  /** Which pick the pending open belongs to — an answer for an older row is dropped. */
  let opening = 0;

  return mountFdfScreen({
    container,
    vfs,
    fdfPath: "UI\\FrameDef\\Glue\\CustomCampaignMenu.fdf",
    rootFrame: "CustomCampaignMenu",
    includeFdf: [LIST_FDF],
    buildRoot: (l) => { lib = l; return buildCustomCampaignRoot(l); },
    buttonWidthScale: 1.35,
    // The screen's panels, one per piece of chrome that carries them: the list and the
    // difficulty box on the left, the details column on the right, the two buttons below it.
    panels: ["GameSettingsPanel", "CampaignInfoPane", "OKBackdrop", "CancelBackdrop"],
    // The list and the details are what the screen is FOR rather than furniture it arrives
    // with, so they fade up a beat after the chrome has landed (ui/fdf/anim.ts).
    latePanels: ["GameSettingsPanel", "CampaignInfoPane"],
    handlers: {
      CancelButton: h.onCancel,
      OKButton: () => { if (loaded) h.onPlay(loaded); },
    },
    onBuild: (s) => {
      fill(s);
      if (picked) void open(s, picked);
    },
  });

  function fill(s: FdfScreen): void {
    const list = s.list("ListBoxWar3");
    if (list) {
      list.setItems(h.sources.map((source) => ({ value: source.key, label: source.name })));
      if (picked) list.select(picked.key);
      list.onChange = (value) => {
        const source = h.sources.find((candidate) => candidate.key === value) ?? null;
        if (source) void open(s, source);
      };
      list.onActivate = (value) => {
        if (loaded && loaded.key === value) h.onPlay(loaded);
      };
    }

    const select = s.popup("DifficultySelect");
    if (select) {
      select.setOptions(DIFFICULTIES.map((d) => ({ value: d.value, label: lib?.string(d.key) ?? d.key })));
      select.value = difficulty;
      select.onChange = (v) => { difficulty = v as Difficulty; saveDifficulty(difficulty); };
    }

    paintDetails(s);
  }

  /** Pick a campaign; the archive is read here, once, and the details fill in when it lands. */
  async function open(s: FdfScreen, source: CustomCampaignSource): Promise<void> {
    picked = source;
    loaded = null;
    failed = false;
    const seq = ++opening;
    paintDetails(s);
    const campaign = await source.load();
    if (seq !== opening) return;
    loaded = campaign;
    failed = !campaign;
    paintDetails(s);
  }

  function paintDetails(s: FdfScreen): void {
    s.setText("CampaignNameValue", loaded?.name ?? picked?.name ?? "");
    s.setText("AuthorValue", loaded?.header ?? "");
    s.setText("DifficultyValue", lib?.string(DIFFICULTIES.find((d) => d.value === difficulty)?.key ?? "") ?? "");
    s.setText("NumMissionsValue", loaded ? String(loaded.missions.length) : "");
    s.setText(
      "MapDescValue",
      failed ? t("hd.campaignUnreadable") : loaded ? loaded.description ?? "" : picked ? t("hd.loading") : "",
    );
    // The badge that describes a campaign is a FRAME rather than text, so it is hidden rather
    // than emptied (as clearMapInfo does) when there is no author to wear.
    const badge = s.frame("AuthIcon");
    if (badge) badge.style.display = loaded?.header ? "" : "none";
    s.setEnabled("OKButton", !!loaded);
  }
}

/** CustomCampaignMenu + the list box dropped into its empty container, and the one frame of
 *  its info pane the file leaves for the engine to place. */
function buildCustomCampaignRoot(lib: FdfLibrary): FdfFrame {
  const root = lib.resolveRoot("CustomCampaignMenu");
  if (!root) throw new Error("CustomCampaignMenu.fdf: no CustomCampaignMenu frame");

  const listBox = lib.resolveRoot("ListBoxWar3");
  if (listBox) {
    setProp(listBox, "SetAllPoints", []); // fill the container the FDF already sized
    adopt(root, "FileListFrame", [listBox]);
  }

  // The name row. Everything else in the pane is chained — the author badge to the name, the
  // minimap to the pane, the stat rows to the minimap's cover — but the name itself carries
  // no SetPoint and no size, so it would inherit the pane's box and print down the middle of
  // the minimap. Place it, and give it the line it draws.
  const name = findFrame(root, "CampaignNameValue");
  setProp(name, "SetPoint", [arg("TOPLEFT"), str("CampaignInfoPane"), arg("TOPLEFT"), num(NAME_ROW_INSET), num(-NAME_ROW_TOP)]);
  size(name, NAME_W, NAME_H);

  // …and the whole right-hand column moves left to sit inside the 3D chrome that frames it.
  nudgeX(findFrame(root, "CampaignInfoPane"), -widescreen(PANE_NUDGE));
  return root;
}
