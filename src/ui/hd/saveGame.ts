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
  deleteSaveGame,
  listSaveGames,
  loadSaveGame,
  saveSupported,
  writeSaveGame,
  type SaveListEntry,
} from "../../game/saveManager";

/**
 * Open the save panel over the screen that is already up. The panel is its own `HdScreen` on
 * `body`, because the glue screens are live and must still be there when it closes.
 */
export function openSaveGamePanel(vfs: DataSource, onClosed?: () => void): void {
  let panel: FdfScreen | null = null;
  void mountHdSaveGame(vfs, {
    onClose: () => {
      panel?.dispose();
      onClosed?.();
    },
  }).then((mounted) => {
    panel = mounted;
  });
}

export interface HdSaveHandlers {
  /** Leave the panel. */
  onClose: () => void;
}

/**
 * The save screen (3.0's `LoadSavedGame` sheet, engine-owned).
 *
 * It is the same band as Replay and Custom Campaign — the 958px list, the Quick Filter field,
 * the FILE NAME / DATE header and the 480x936 ImgDetails column — because that is what 3.0 uses
 * for every full-screen list. The left list is the folder, newest first; the right column is the
 * selected save's details with Continue under it; the row under the list is the name box and
 * Save, shown only where the engine can actually capture a match.
 */
export async function mountHdSaveGame(
  vfs: DataSource,
  h: HdSaveHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-save-game");
  void backdrop(screen, assets, ART.home, themeVideo());

  const supported = saveSupported();

  let sortKey: "name" | "date" = "date";
  let sortAsc = false;
  let query = "";

  const shell = officialFileScreen(screen, "LoadSavedGame", {
    tft: !isRoc(),
    assets,
    title: t("hd.loadSavedGame"),
    subtitle: supported ? undefined : t("hd.saveUnsupported"),
    filterPlaceholder: t("hd.filterSaves"),
    onFilter: (text) => {
      query = text.trim().toLowerCase();
      paint();
    },
    columns: columns(),
  });
  backButton(shell.root, t("hd.back"), h.onClose);

  let entries: SaveListEntry[] = [];
  let selected: string | null = null;

  // The name box + Save, under the list in the band's own bottom padding.
  let nameBox: HTMLInputElement | null = null;
  if (supported) {
    const row = el("div", "hd-save-row");
    nameBox = el("input", "hd-save-name") as HTMLInputElement;
    nameBox.type = "text";
    nameBox.placeholder = t("hd.saveName");
    nameBox.maxLength = 60;
    row.append(nameBox, framedButton(t("hd.save"), () => void runSave()));
    shell.listFrame.appendChild(row);
  }

  await refresh();
  screen.attach(document.body);

  return screen;

  // --- work ------------------------------------------------------------------------------

  function columns(): OfficialFileColumn[] {
    return [
      {
        label: t("hd.fileName"),
        sort: sortKey === "name" ? (sortAsc ? "asc" : "desc") : undefined,
        onClick: () => setSort("name"),
      },
      {
        label: t("hd.date"),
        sort: sortKey === "date" ? (sortAsc ? "asc" : "desc") : undefined,
        onClick: () => setSort("date"),
      },
    ];
  }

  function setSort(key: "name" | "date"): void {
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = false;
    }
    shell.setColumns(columns());
    paint();
  }

  async function refresh(): Promise<void> {
    entries = await listSaveGames();
    if (selected && !entries.some((e) => e.file === selected)) selected = null;
    // A fresh list marks its newest save, so Continue is one press away from opening the panel.
    if (!selected && entries.length) selected = sorted()[0].file;
    paint();
  }

  function sorted(): SaveListEntry[] {
    const visible = entries.filter((entry) => !query || entry.header.name.toLowerCase().includes(query));
    return [...visible].sort((a, b) => {
      const order =
        sortKey === "name"
          ? a.header.name.localeCompare(b.header.name)
          : Date.parse(a.header.savedAt) - Date.parse(b.header.savedAt);
      return sortAsc ? order : -order;
    });
  }

  function paint(): void {
    shell.list.textContent = "";
    for (const entry of sorted()) {
      const row = officialListRow(
        "LoadSavedGame",
        [entry.header.name, when(entry.header.savedAt)],
        () => {
          selected = entry.file;
          paint();
        },
        {
          selected: entry.file === selected,
          onDelete: () => void runDelete(entry.file),
        },
      );
      shell.list.appendChild(row);
    }
    shell.setOverflow(shell.list.scrollHeight > shell.list.clientHeight);
    paintAside();
  }

  function paintAside(): void {
    shell.aside.textContent = "";
    const entry = entries.find((e) => e.file === selected) ?? null;
    if (!entry) return;

    shell.aside.appendChild(
      imgDetailsHeader({
        title: entry.header.name,
        version: entry.header.engine,
      }),
    );
    // The sheet's four-row grid keeps its geometry even when a save has no minimap to show.
    shell.aside.appendChild(imgDetailsMap().node);

    const options = imgDetailsOptions();
    const body = options.querySelector(".ImgDetails-Options") as HTMLElement;
    body.append(
      imgDetailsRow(t("hd.saveMap"), entry.header.map.name),
      imgDetailsRow(t("hd.saveDate"), when(entry.header.savedAt)),
      imgDetailsRow(t("hd.build"), entry.header.engine),
      imgDetailsRow(t("hd.time"), clock(entry.header.gameTime)),
    );
    if (entry.header.campaign) {
      body.appendChild(
        imgDetailsRow(
          t("hd.campaign"),
          `${entry.header.campaign.key} ${entry.header.campaign.chapter + 1}`,
        ),
      );
    }
    if (entry.header.partial) {
      body.appendChild(el("div", "ImgDetails-OptionsSection", t("hd.savePartial")));
    }
    shell.aside.appendChild(options);

    const action = imgDetailsButton();
    const play = action.querySelector(".ImgDetails-PlayGameBtn") as HTMLElement;
    const button = framedButton(t("hd.continue"), () => void runLoad());
    button.querySelector(".Primary-Button")?.classList.add("Primary-Button-Blue");
    play.appendChild(button);
    shell.aside.append(action, ...imgDetailsDividers());

    if (nameBox && !nameBox.value) nameBox.value = entry.header.name;
  }

  async function runSave(): Promise<void> {
    if (!nameBox) return;
    const name = nameBox.value.trim();
    if (!name) {
      nameBox.focus();
      return;
    }
    const kept = await writeSaveGame(name);
    if (!kept) return;
    selected = kept;
    await refresh();
  }

  async function runLoad(): Promise<void> {
    if (!selected) return;
    const file = selected;
    // Leave the glue first: the load mounts a match, and a panel on top of the loading screen
    // would still be there when the HUD comes up.
    h.onClose();
    await loadSaveGame(file);
  }

  async function runDelete(file: string): Promise<void> {
    await deleteSaveGame(file);
    if (selected === file) {
      selected = null;
      if (nameBox) nameBox.value = "";
    }
    await refresh();
  }
}

/** `2026-11-15 12:31` in the player's own locale — a list column, not a timestamp. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Seconds of match time as `12:34`, the way the save's own screen reads a clock. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
