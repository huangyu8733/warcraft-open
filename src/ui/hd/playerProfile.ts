import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { ART, webUiAssets } from "./assets";
import { HdScreen, el } from "./screen";
import { confirmDialog } from "./dialog";
import { loadOfficialStyle } from "./official";
import {
  backdrop,
  backButton,
  framedButton,
  imgDetailsButton,
  imgDetailsDividers,
  imgDetailsHeader,
  imgDetailsMap,
  imgDetailsOptions,
  imgDetailsRow,
  officialFileScreen,
  officialListRow,
  type OfficialFileColumn,
} from "./officialMenu";
import { themeVideo } from "./theme";
import { isRoc } from "../../data/edition";
import { t } from "../../i18n";
import {
  activeProfile,
  deleteProfile,
  loadProfiles,
  selectProfile,
  type Profile,
} from "../../data/profiles";

/**
 * The player-profile page — the Single Player screen's "Profile" row.
 *
 * A profile is the namespace a campaign's progress and saved games live under
 * (data/profiles.ts), so this is the engine's save-file page: the same 3.0 band as the
 * Load Saved Game list (the 958px list, the Quick Filter field, the 480x936 ImgDetails
 * column), with one row per profile instead of one per save file. It reuses the
 * `LoadSavedGame` sheet classes because 3.0 has no local-profile screen of its own; the
 * geometry is exactly that band, so its CSS already carries the numbers.
 */
export function openProfileScreen(vfs: DataSource, onClosed?: () => void): void {
  let panel: FdfScreen | null = null;
  void mountHdProfiles(vfs, {
    onClose: () => {
      panel?.dispose();
      onClosed?.();
    },
  }).then((mounted) => {
    panel = mounted;
  });
}

export interface HdProfileHandlers {
  /** Leave the page, back to the single-player menu. */
  onClose: () => void;
}

export async function mountHdProfiles(
  vfs: DataSource,
  h: HdProfileHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);
  // The crest is the one portrait 3.0's own profile screen paints in its preview slot.
  const crest = await assets.url("WebUI\\Profile\\PlayerProfile_ColoredCrest_Random.png");

  const screen = new HdScreen("hd-player-profile");
  void backdrop(screen, assets, ART.home, themeVideo());

  let sortAsc = true;
  let query = "";
  let selected: string | null = null;

  const shell = officialFileScreen(screen, "LoadSavedGame", {
    tft: !isRoc(),
    assets,
    title: t("hd.profile"),
    filterPlaceholder: t("hd.filterProfiles"),
    onFilter: (text) => {
      query = text.trim().toLowerCase();
      paint();
    },
    columns: columns(),
  });
  backButton(shell.root, t("hd.back"), h.onClose);

  refresh();
  screen.attach(document.body);

  return screen;

  // --- work ------------------------------------------------------------------------------

  function columns(): OfficialFileColumn[] {
    return [
      {
        label: t("hd.profile"),
        sort: sortAsc ? "asc" : "desc",
        onClick: () => {
          sortAsc = !sortAsc;
          shell.setColumns(columns());
          paint();
        },
      },
      { label: t("hd.created") },
    ];
  }

  function refresh(): void {
    const profiles = loadProfiles();
    if (selected && !profiles.some((p) => p.name === selected)) selected = null;
    if (!selected) selected = activeProfile() ?? profiles[0]?.name ?? null;
    paint();
  }

  function visible(): Profile[] {
    const profiles = loadProfiles().filter(
      (p) => !query || p.name.toLowerCase().includes(query),
    );
    profiles.sort((a, b) => (sortAsc ? 1 : -1) * a.name.localeCompare(b.name));
    return profiles;
  }

  function paint(): void {
    const profiles = visible();
    shell.list.textContent = "";
    if (profiles.length === 0) {
      shell.list.appendChild(el("div", "hd-profile-empty", t("hd.noProfiles")));
    }
    for (const profile of profiles) {
      shell.list.appendChild(
        officialListRow(
          "LoadSavedGame",
          [profile.name, when(profile.created)],
          () => {
            selected = profile.name;
            paint();
          },
          {
            selected: profile.name === selected,
            onDelete: () => openDelete(profile.name),
          },
        ),
      );
    }
    shell.setOverflow(shell.list.scrollHeight > shell.list.clientHeight);
    paintAside();
  }

  function paintAside(): void {
    shell.aside.textContent = "";
    const profile = loadProfiles().find((p) => p.name === selected);
    if (!profile) return;

    shell.aside.appendChild(
      imgDetailsHeader({
        title: profile.name,
        version: profile.name === activeProfile() ? t("hd.inUse") : undefined,
      }),
    );

    const preview = imgDetailsMap();
    if (crest) preview.image.style.backgroundImage = `url("${crest}")`;
    shell.aside.appendChild(preview.node);

    const options = imgDetailsOptions();
    const body = options.querySelector(".ImgDetails-Options") as HTMLElement;
    body.append(
      imgDetailsRow(t("hd.profile"), profile.name),
      imgDetailsRow(t("hd.created"), when(profile.created)),
      imgDetailsRow(
        t("hd.status"),
        profile.name === activeProfile() ? t("hd.inUse") : t("hd.available"),
      ),
    );
    shell.aside.appendChild(options);

    const action = imgDetailsButton();
    const play = action.querySelector(".ImgDetails-PlayGameBtn") as HTMLElement;
    const button = framedButton(t("hd.useProfile"), () => {
      selectProfile(profile.name);
      paint();
    });
    button.querySelector(".Primary-Button")?.classList.add("Primary-Button-Blue");
    play.appendChild(button);
    shell.aside.append(action, ...imgDetailsDividers());
  }

  /** Delete asks on the same 3.0 confirm plate as Options' save/reset prompts. */
  function openDelete(name: string): void {
    confirmDialog(screen.element, {
      title: t("hd.delete"),
      text: t("hd.deleteProfileConfirm", { name }),
      cancelLabel: t("hd.cancel"),
      confirmLabel: t("hd.delete"),
      onConfirm: () => {
        deleteProfile(name);
        refresh();
      },
    });
  }
}

/** `2026-11-15 12:31` in the player's own locale — a list column, not a timestamp. */
function when(ms: number): string {
  const d = new Date(ms);
  if (!ms || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
