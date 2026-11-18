import type { DataSource } from "../../vfs/types";
import type { FdfScreen } from "../fdf/render";
import { ART, webUiAssets } from "./assets";
import { browseFolder, parentFolder } from "./browse";
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
import { openSystemMenu } from "./systemMenu";
import { themeVideo } from "./theme";
import { t } from "../../i18n";
import { isRoc } from "../../data/edition";
import { readReplayHeader, REPLAY_EXT, type ReplayHeader } from "../../game/replay";
import type { ReplayFileInfo, ReplaySink } from "../../game/replaySink";
import { readMapInfo } from "../mapBrowser";
import { imageToDataUrl } from "../../render/blputil";

export interface HdReplayHandlers {
  onCancel: () => void;
  onView: (name: string) => void;
}

/**
 * The Reforged View Replay screen (3.0): the replay folder down the left, the picked match on
 * the right, View Replay on the foot.
 *
 * The band, the carved frame, the title row, the Quick Filter field and the sorting list header
 * are the official sheet's (`official.css`), so what is left here is the contents: the shell's
 * replay store (game/replaySink.ts) browsed the way the classic screen browses it — `LastReplay`
 * and the saved replays at the top, `Autosaved` as a folder row to walk into — and the picked
 * replay read for its map, its seats and the build that recorded it.
 */
export async function mountHdViewReplay(
  container: HTMLElement,
  vfs: DataSource,
  maps: Map<string, File>,
  sink: ReplaySink | null,
  h: HdReplayHandlers,
): Promise<FdfScreen> {
  const assets = webUiAssets(vfs);
  await loadOfficialStyle(assets);

  const screen = new HdScreen("hd-replay");
  void backdrop(screen, assets, ART.home, themeVideo());

  let sortKey: "title" | "filename" | "date" = "date";
  let sortAsc = false;
  let query = "";

  const shell = officialFileScreen(screen, "Replay", {
    tft: !isRoc(),
    assets,
    title: t("hd.replays"),
    filterPlaceholder: t("hd.quickFilter"),
    onFilter: (text) => {
      query = text.trim();
      paintFiles();
    },
    columns: columns(),
  });
  backButton(shell.root, t("hd.back"), h.onCancel, {
    onSystemMenu: () => openSystemMenu(screen, vfs, {}),
    systemMenuLabel: t("hd.menu"),
  });

  let files: ReplayFileInfo[] = [];
  let folder = "";
  let picked: string | null = null;
  let header: ReplayHeader | null = null;
  const headers = new Map<string, ReplayHeader | null>();
  const previews = new Map<string, string | null>();
  let reading = 0;
  let previewStamp = 0;
  let mounted = true;

  void sink?.list().then((all) => {
    if (!mounted) return;
    files = all.filter((f) => f.name.toLowerCase().endsWith(REPLAY_EXT));
    paintFiles();
  });

  paintFiles();
  paintInfo();

  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    mounted = false;
    dispose();
  };
  return screen.attach(container);

  /** The sheet's three columns, with the arrow on whichever one is sorting. */
  function columns(): OfficialFileColumn[] {
    return [
      {
        label: t("hd.map"),
        sort: sortKey === "title" ? (sortAsc ? "asc" : "desc") : undefined,
        onClick: () => setSort("title"),
      },
      {
        label: t("hd.fileName"),
        sort: sortKey === "filename" ? (sortAsc ? "asc" : "desc") : undefined,
        onClick: () => setSort("filename"),
      },
      {
        label: t("hd.date"),
        sort: sortKey === "date" ? (sortAsc ? "asc" : "desc") : undefined,
        onClick: () => setSort("date"),
      },
    ];
  }

  function setSort(key: "title" | "filename" | "date"): void {
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = false;
    }
    shell.setColumns(columns());
    paintFiles();
  }

  function paintFiles(): void {
    shell.list.textContent = "";
    const entries = files.map((file) => ({ rel: file.name, item: file }));
    const { folders, files: here } = browseFolder(entries, folder, "/");
    if (folder) {
      shell.list.appendChild(
        officialListRow("Replay", ["..", "", ""], () => {
          folder = parentFolder(folder, "/");
          paintFiles();
        }, { icon: "up" }),
      );
    }
    for (const name of folders) {
      if (query && !name.toLowerCase().includes(query)) continue;
      shell.list.appendChild(
        officialListRow("Replay", [name, "", ""], () => {
          folder = folder ? `${folder}/${name}` : name;
          paintFiles();
        }, { icon: "folder" }),
      );
    }
    const visible = here.filter((file) => matches(file)).sort(compare);
    for (const file of visible) {
      const info = headers.get(file.name);
      const row = officialListRow(
        "Replay",
        [info?.map.name ?? "", leafName(file.name), new Date(file.mtime).toLocaleDateString()],
        () => void choose(file.name),
        {
          icon: "replay",
          maxPlayers: info ? String(info.seats.length) : undefined,
          selected: picked === file.name,
          onDelete: () => askDelete(file.name),
        },
      );
      row.dataset.replayName = file.name;
      shell.list.appendChild(row);
    }
    shell.setOverflow(shell.list.scrollHeight > shell.list.clientHeight);
  }

  function matches(file: ReplayFileInfo): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    if (leafName(file.name).toLowerCase().includes(q)) return true;
    const info = headers.get(file.name);
    return !!info && info.map.name.toLowerCase().includes(q);
  }

  function compare(a: ReplayFileInfo, b: ReplayFileInfo): number {
    let order = 0;
    if (sortKey === "filename") order = leafName(a.name).localeCompare(leafName(b.name));
    else if (sortKey === "title") {
      order = (headers.get(a.name)?.map.name ?? "").localeCompare(headers.get(b.name)?.map.name ?? "");
    } else order = a.mtime - b.mtime;
    return sortAsc ? order : -order;
  }

  /** Re-mark the rows in place, so picking a replay does not scroll the folder to its top. */
  function markSelected(): void {
    for (const row of shell.list.querySelectorAll<HTMLElement>(".Replay-EntryRow")) {
      row.classList.toggle("Replay-EntryRowSelected", row.dataset.replayName === picked);
    }
  }

  async function choose(name: string): Promise<void> {
    picked = name;
    header = null;
    markSelected();
    paintInfo();
    const stamp = ++reading;
    let read = headers.get(name);
    if (read === undefined) {
      const bytes = await sink?.read(name);
      read = bytes ? (await readReplayHeader(bytes)).header : null;
      headers.set(name, read);
    }
    if (!mounted || stamp !== reading || picked !== name) return;
    header = read;
    paintInfo();
    paintFiles();
  }

  function paintInfo(): void {
    shell.aside.textContent = "";
    previewStamp++;
    if (!picked) return;
    const info = header;
    if (!info) {
      shell.aside.appendChild(imgDetailsHeader({ title: leafName(picked) }));
      const empty = imgDetailsOptions();
      empty.querySelector(".ImgDetails-Options")?.appendChild(
        el("div", "ImgDetails-OptionsSection", t("hd.unreadableReplay")),
      );
      shell.aside.append(empty, ...imgDetailsDividers());
      return;
    }

    const title = imgDetailsHeader({
      title: info.map.name,
      version: info.gameVersion ?? info.version,
      maxPlayers: String(info.seats.length),
    });
    shell.aside.appendChild(title);

    const preview = imgDetailsMap();
    shell.aside.appendChild(preview.node);

    const options = imgDetailsOptions();
    const body = options.querySelector(".ImgDetails-Options") as HTMLElement;
    body.append(
      imgDetailsRow(t("hd.recorded"), new Date(info.recordedAt).toLocaleString()),
      imgDetailsRow(t("hd.build"), info.gameVersion ?? info.version),
      imgDetailsRow(t("hd.playersCount"), String(info.seats.length)),
    );
    for (const seat of info.seats) {
      body.appendChild(
        imgDetailsRow(
          seat.name || String(seat.player),
          seat.kind === "computer" ? `${seat.race} · ${t("hd.computer")}` : seat.race,
        ),
      );
    }
    shell.aside.appendChild(options);

    const action = imgDetailsButton();
    const play = action.querySelector(".ImgDetails-PlayGameBtn") as HTMLElement;
    const button = framedButton(t("hd.viewReplay"), () => picked && h.onView(picked));
    button.querySelector(".Primary-Button")?.classList.add("Primary-Button-Blue");
    play.appendChild(button);
    shell.aside.append(action, ...imgDetailsDividers());

    void paintPreview(info, preview.image, title.querySelector(".ImgDetails-MapAuthor") as HTMLElement | null);
  }

  /** The minimap of the map the recording names, out of the installed map set. */
  async function paintPreview(
    info: ReplayHeader,
    image: HTMLElement,
    author: HTMLElement | null,
  ): Promise<void> {
    const stamp = ++previewStamp;
    const path = installedPathFor(info.map.path);
    if (!path) return;
    const known = previews.get(path);
    if (known !== undefined) {
      image.style.backgroundImage = known ? `url("${known}")` : "";
      return;
    }
    let url: string | null = null;
    try {
      const map = await readMapInfo(maps, path, vfs);
      url = map?.minimap ? imageToDataUrl(map.minimap) : null;
      if (map && url && author) {
        author.textContent = [map.recommendedPlayers, map.tileset].filter(Boolean).join(" · ");
      }
    } catch (err) {
      console.warn(`[Warcraft Open] HD replay map unreadable: ${path}`, err);
    }
    previews.set(path, url);
    if (!mounted || stamp !== previewStamp) return;
    image.style.backgroundImage = url ? `url("${url}")` : "";
  }

  /** The trash can (the classic screen's has one — ui/fdfViewReplay.ts `askDelete`): a replay
   *  is a file in this machine's folder, so the question comes before the remove. */
  function askDelete(name: string): void {
    if (!sink) return;
    modal(t("hd.deleteReplay"), t("hd.deleteReplayConfirm", { name: leafName(name) }), [
      [t("hd.cancel"), null],
      [t("hd.delete"), () => void deleteReplay(name)],
    ]);
  }

  async function deleteReplay(name: string): Promise<void> {
    const gone = await sink?.remove(name).catch(() => false);
    if (!mounted) return;
    if (!gone) {
      modal(t("hd.deleteReplay"), t("hd.deleteReplayFailed", { name: leafName(name) }), [[t("hd.ok"), null]]);
      return;
    }
    files = files.filter((f) => f.name !== name);
    headers.delete(name);
    if (picked === name) {
      picked = null;
      header = null;
      reading++; // a header still being read belongs to the file that is gone
    }
    paintFiles();
    paintInfo();
  }

  /** A question (or a notice) over the screen — the scrim/panel the Video options use. */
  function modal(
    title: string,
    text: string,
    buttons: Array<[string, (() => void) | null]>,
  ): void {
    screen.setInteractive(false);
    const scrim = el("div", "hd-modal-scrim");
    const box = el("div", "hd-panel hd-modal");
    box.appendChild(el("h2", "", title));
    box.appendChild(el("p", "hd-modal-text", text));
    const row = el("div", "hd-modal-actions");
    for (const [label, run] of buttons) {
      const button = el("button", run ? "primary" : "", label);
      button.type = "button";
      button.onclick = (): void => {
        scrim.remove();
        screen.setInteractive(true);
        run?.();
      };
      row.appendChild(button);
    }
    box.appendChild(row);
    scrim.appendChild(box);
    screen.element.appendChild(scrim);
    screen.setInteractive(true);
  }

  /** The replay's own path uses the recorder's casing and slashes; find ours. */
  function installedPathFor(recorded: string): string | null {
    if (maps.has(recorded)) return recorded;
    const want = recorded.toLowerCase().replace(/\//g, "\\");
    const leaf = want.slice(want.lastIndexOf("\\") + 1);
    for (const path of maps.keys()) {
      if (path.toLowerCase().replace(/\//g, "\\") === want) return path;
    }
    for (const path of maps.keys()) {
      if (path.toLowerCase().endsWith(`\\${leaf}`)) return path;
    }
    return null;
  }
}

function leafName(name: string): string {
  return (name.slice(name.lastIndexOf("/") + 1) || name).replace(new RegExp(`${REPLAY_EXT}$`, "i"), "");
}
