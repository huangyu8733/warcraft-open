import type { WebUiAssets } from "./assets";
import type { HdScreen } from "./screen";
import { backgroundVideo, el } from "./screen";
import { playFdfClick } from "../fdf/render";
import { gameVersion } from "../../data/gameVersion";
import { t } from "../../i18n";
import { themeFace } from "./theme";

/**
 * The pieces every 3.0 glue screen is built from.
 *
 * Reforged's front end repeats one composition: a 695x994 plate pinned to the right edge of the
 * window, wearing two chains, the metal border-image and the wood texture, with a column of
 * framed buttons on it and Exit/Back in the bottom-left corner (`WebUI\GlueManager.js`, and the
 * geometry in `official.css`). The main menu, the single-player menu and the custom-campaign
 * screen are all that same plate with different contents, so the skeleton lives here and each
 * screen only supplies its buttons.
 */

export interface OfficialMenu {
  /** Put under the screen's content; everything else hangs off it. */
  holder: HTMLElement;
  /** The padded column inside the plate, for extra rows below the navigation. */
  wrap: HTMLElement;
  /** The button column. Add buttons with `framedButton`. */
  nav: HTMLElement;
  /** Redo the 1080-line zoom (call on resize; the helper does it once itself). */
  rescale: () => void;
  /** Remove the resize listener. */
  dispose: () => void;
}

export function officialMenu(
  screen: HdScreen,
  opts: { menuClass?: string; navClass?: string; tft: boolean; assets: WebUiAssets },
): OfficialMenu {
  const holder = el("div", "MainMenuHolder");

  const version = gameVersion();
  if (version) holder.appendChild(el("div", "MainMenuScreen-Version", version));

  const scaleHost = el("div", "MainMenuScreen");
  const menu = el("div", `MainMenu${opts.menuClass ? ` ${opts.menuClass}` : ""} Animate-In`);
  const wrap = el("div", "MainMenu-Wrapper");
  wrap.append(el("div", "Bottom-Decoration-Right"), el("div", "Bottom-Decoration-Left"));

  const nav = el("div", `MainMenuScreen-NavigationHolder${opts.navClass ? ` ${opts.navClass}` : ""}`);
  wrap.appendChild(nav);

  const base = el("div", "BaseFrame FrameBG");
  const themed = opts.tft ? " tft" : "";
  base.append(
    el("div", `left-chain${themed}`),
    el("div", `right-chain${themed}`),
    el("div", `frame${themed}`),
    el("div", `background-texture${themed}`),
  );
  wrap.appendChild(base);

  menu.appendChild(wrap);
  scaleHost.appendChild(menu);
  holder.appendChild(scaleHost);
  screen.content.appendChild(holder);
  screen.element.appendChild(cornerDecorations(opts.assets, opts.tft));

  // 3.0's GetScale(): the plate is authored at 1080 lines and zooms with the window. The Exit
  // button is a sibling of the plate, so it carries the same zoom (looked up rather than held,
  // because the screen adds it after this runs).
  const rescale = (): void => {
    const zoom = Math.max(0.25, window.innerHeight / 1080).toFixed(3);
    scaleHost.style.setProperty("zoom", zoom);
    holder.querySelector<HTMLElement>(".PersistentBackButton")?.style.setProperty("zoom", zoom);
  };
  rescale();
  window.addEventListener("resize", rescale);

  return {
    holder,
    wrap,
    nav,
    rescale,
    dispose: () => window.removeEventListener("resize", rescale),
  };
}

/**
 * The plate's Exit/Back control: 3.0's `PersistentBackButton`, which is one dual-button frame
 * holding the framed Back button, a divider and the system-menu (hamburger) button.
 *
 * `opts.onSystemMenu` is what the hamburger opens — the 3.0 system menu (ui/hd/systemMenu.ts),
 * where the saved-game list now lives. A screen that passes none leaves the button drawn but
 * inert (out of the tab order, announced as decoration), so it never lies about being a control.
 */
export function backButton(
  mount: HTMLElement,
  label: string,
  onClick: () => void,
  opts: { onSystemMenu?: () => void; systemMenuLabel?: string } = {},
): HTMLElement {
  const back = el("div", "PersistentBackButton");
  const dual = el("div", "Dual-Button-Frame-Wrapper");

  const menu = opts.onSystemMenu
    ? primaryButton("", opts.onSystemMenu, "Primary-Button-Small PersistentBackButton-System-Menu-Button")
    : el("div", "Primary-Button Primary-Button-Small PersistentBackButton-System-Menu-Button");
  if (opts.onSystemMenu) {
    menu.setAttribute("aria-label", opts.systemMenuLabel ?? t("hd.menu"));
    // The icon is the button's whole face; the empty caption primaryButton() built is not.
    menu.querySelector(".Primary-Button-Content")?.remove();
  } else {
    menu.setAttribute("aria-hidden", "true");
  }
  menu.appendChild(el("div", "System-Menu-Icon"));

  dual.append(
    primaryButton(label, onClick, "PersistentBackButton-Back-Button"),
    el("div", "Divider"),
    menu,
  );
  back.appendChild(dual);
  mount.appendChild(back);
  return back;
}

/**
 * 3.0's persistent window dressing: the `Persistent-CornerDecorations` layer, which frames the
 * WHOLE window rather than the plate — a siderail down each edge and the animated machinery in
 * the two bottom corners (the same `corner-machinery-animated.webm` in both, the left one
 * mirrored by the sheet). Every glue screen mounts it; the reference keeps it beside the route
 * so it does not cut between screens, and this client rebuilds it per screen because screens are
 * mounted one at a time.
 *
 * `official.css` sizes it in `vh` (33px/260px of a 1080-line window), so it needs no rescale.
 */
export function cornerDecorations(assets: WebUiAssets, tft: boolean): HTMLElement {
  const layer = el("div", "Persistent-CornerDecorations");
  layer.setAttribute("aria-hidden", "true");
  const themed = tft ? " tft" : "";
  const left = el("div", "Persistent-Left-Corner");
  const right = el("div", "Persistent-Right-Corner");
  layer.append(
    el("div", `Persistent-Left-Frame${themed}`),
    el("div", `Persistent-Right-Frame${themed}`),
    left,
    right,
  );
  void assets.url("WebUI\\Webms\\corner-machinery-animated.webm").then((url) => {
    if (!url) return;
    for (const corner of [left, right]) {
      const video = document.createElement("video");
      video.src = url;
      video.autoplay = true;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      corner.appendChild(video);
    }
  });
  return layer;
}

/** One button in the navigation column: `.Primary-Button-Frame-With-Cap > Frame > Button`. */
export function framedButton(label: string, onClick: () => void, disabled = false): HTMLElement {
  return framed(primaryButton(label, onClick, "", disabled));
}

/** Hang an existing `.Primary-Button` in the sheet's metal frame (the LAN screens build their
 *  own button so they can enable/disable it after the fact). */
export function framed(button: HTMLElement): HTMLElement {
  const cap = el("div", "Primary-Button-Frame-With-Cap");
  const frame = el("div", "Primary-Button-Frame");
  // 3.0 hangs the frame's end caps off the frame element itself (`.Primary-Button-Frame.fk`).
  const face = themeFace();
  if (face) frame.classList.add(face);
  frame.appendChild(button);
  cap.appendChild(frame);
  return cap;
}

/** A `.Framed-Secondary-Button`: the wide framed button screens put under their details pane. */
export function secondaryButton(label: string, onClick: () => void, disabled = false): HTMLElement {
  const frame = el("div", "Framed-Secondary-Button");
  const alt = el("div", "Primary-Button-Frame-Alternate-B");
  alt.appendChild(primaryButton(label, onClick, "", disabled));
  frame.appendChild(alt);
  return frame;
}

/** The bare `.Primary-Button` the sheet styles; `extra` is for folklore classes. */
export function primaryButton(
  label: string,
  onClick: () => void,
  extra = "",
  disabled = false,
): HTMLElement {
  const b = el("div", `Primary-Button${disabled ? " isDisabled" : ""}${extra ? ` ${extra}` : ""}`);
  b.setAttribute("role", "button");
  b.tabIndex = 0;
  b.appendChild(el("div", "Primary-Button-Content", label));
  if (disabled) b.setAttribute("aria-disabled", "true");
  // The listener is ALWAYS attached, even for a button that opens disabled: screens that come
  // alive later (LAN's Join/Create, the lobby's Start) light theirs up by swapping `isDisabled`
  // and `aria-disabled` on this same node, and a button built without a listener could never
  // answer again. The state is read at press time instead.
  const fire = (): void => {
    if (b.classList.contains("isDisabled") || b.getAttribute("aria-disabled") === "true") return;
    playFdfClick();
    onClick();
  };
  b.addEventListener("click", fire);
  b.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fire();
    }
  });
  return b;
}

/**
 * The menu's moving backdrop: the install's still paints at once, its WebM fades in over it.
 * Both layers go under the screen's contents, so the plate is never delayed by a video decode.
 */
export async function backdrop(
  screen: HdScreen,
  assets: WebUiAssets,
  stillPath: string,
  videoPath: string | null,
): Promise<void> {
  const still = el("div", "hd-main-still");
  const stillUrl = await assets.url(stillPath);
  if (stillUrl) still.style.backgroundImage = `url("${stillUrl}")`;
  screen.element.insertBefore(still, screen.element.firstChild);
  if (!videoPath) return;
  void backgroundVideo(assets, videoPath, "hd-movie").then((film) => {
    if (film && screen.element.isConnected) screen.element.insertBefore(film, still.nextSibling);
  });
}

export type HdFileScreenKind = "Replay" | "CustomCampaigns" | "LoadSavedGame";

export interface OfficialFileColumn {
  label: string;
  /** Show the sheet's sort arrow and which way it points. */
  sort?: "asc" | "desc";
  /** Clicking the header re-sorts; the screen calls `setColumns` afterwards. */
  onClick?: () => void;
}

export interface OfficialFileScreen {
  root: HTMLElement;
  /** The scrolling row container (`{Kind}-List`). */
  list: HTMLElement;
  /** The 480x936 `.ImgDetails-GameDetailsFrame` the caller fills on a selection. */
  aside: HTMLElement;
  /** The left list frame, for controls the sheet puts under the rows. */
  listFrame: HTMLElement;
  /** The search box, so a screen can reset it. */
  filter: HTMLInputElement;
  /** Repaint the header, e.g. after the sort column changed. */
  setColumns: (columns: OfficialFileColumn[]) => void;
  /** Show the scrollbar's background frame once the rows overflow. */
  setOverflow: (on: boolean) => void;
}

const FILE_SCREEN: Record<
  HdFileScreenKind,
  { header: string; listHeader: string; col: string; listFrame: string; listing: string; content: string; list: string }
> = {
  Replay: {
    header: "Replay-UpperLeftSection",
    listHeader: "Replay-ListHeader",
    col: "Replay-Col",
    listFrame: "Replay-ListFrame",
    listing: "Replay-Listing",
    content: "Replay-Content",
    list: "Replay-List",
  },
  CustomCampaigns: {
    header: "CustomCampaigns-UpperLeftSection",
    listHeader: "CustomCampaigns-ListHeader",
    col: "CustomCampaigns-Col",
    listFrame: "CustomCampaign-ListFrame",
    listing: "CustomCampaigns-Listing",
    content: "CustomCampaigns-Content",
    list: "CustomCampaigns-List",
  },
  LoadSavedGame: {
    header: "LoadSavedGame-UpperLeftSection",
    listHeader: "SavedItemOlds-ListHeader",
    col: "SavedItemOlds-Col",
    listFrame: "LoadSavedGame-ListFrame",
    listing: "LoadSavedGame-Listing",
    content: "LoadSavedGame-Content",
    list: "LoadSavedGame-List",
  },
};

/** `.BaseFrame`: the two chains, the metal frame and the (empty) background texture of 3.0. */
export function baseFrame(): HTMLElement {
  const themed = themeFace();
  const suffix = themed ? ` ${themed}` : "";
  const base = el("div", "BaseFrame");
  base.append(
    el("div", `left-chain${suffix}`),
    el("div", `right-chain${suffix}`),
    el("div", `frame${suffix}`),
    el("div", `background-texture${suffix}`),
  );
  return base;
}

/** The carved divider under the title band (`Horizontal-Divider`). */
export function horizontalDivider(): HTMLElement {
  return el("div", `Horizontal-Divider${themeFace() === "tft" ? " tft" : ""}`);
}

/**
 * The 3.0 file-list screen (`Replay`, `CustomCampaigns`, `LoadSavedGame`): the 958px band with
 * the wood title row, the Simple-Header search field, the sorting list header and the 480x936
 * ImgDetails column. The DOM and the class names are the bundle's own; `official.css` carries
 * the sheet's numbers. The band is authored for 1080 lines, so the root is zoomed by
 * `innerHeight / 1080` the way 3.0's `GetScale()` does.
 */
export function officialFileScreen(
  screen: HdScreen,
  kind: HdFileScreenKind,
  opts: {
    tft: boolean;
    assets: WebUiAssets;
    title: string;
    subtitle?: string;
    filterPlaceholder?: string;
    onFilter?: (text: string) => void;
    refreshLabel?: string;
    onRefresh?: () => void;
    columns: OfficialFileColumn[];
  },
): OfficialFileScreen {
  const meta = FILE_SCREEN[kind];
  const face = themeFace() || (opts.tft ? "tft" : "");
  screen.element.classList.add("hd-official");
  if (face) screen.element.classList.add(face);

  const root = el("div", kind);
  if (face) root.classList.add(face);
  const container = el("div", `${kind}-ContentContainer Animate-In`);
  const panel = el("div", `${kind}-MainPanel`);
  const grid = el("div", `${kind}-LeftPanel-Grid`);

  // --- the title band + search -----------------------------------------------------------
  const upper = el("div", `Simple-Header ${meta.header}`);
  const title = el("div", "Simple-Header-Title");
  title.appendChild(el("div", "Simple-Header-TitleText", opts.title));
  if (opts.subtitle) title.appendChild(el("div", "Simple-Header-TitleSubText", opts.subtitle));
  upper.appendChild(title);

  const search = el("div", "Simple-Header-Listing-SearchSection");
  const field = el("div", "Simple-Header-Listing-SearchField");
  const wrapper = el("div", "SearchInput-Wrapper");
  const overlay = el("div", "SearchInput-Overlay");
  const filter = document.createElement("input");
  filter.className = "SearchInput";
  filter.type = "text";
  filter.placeholder = opts.filterPlaceholder ?? "";
  filter.spellcheck = false;
  filter.addEventListener("input", () => opts.onFilter?.(filter.value));
  filter.addEventListener("focus", () => wrapper.classList.add("isFocused"));
  filter.addEventListener("blur", () => wrapper.classList.remove("isFocused"));
  wrapper.append(overlay, filter);
  field.appendChild(wrapper);
  search.appendChild(field);

  if (opts.onRefresh) {
    const section = el("div", "Simple-Header-Listing-RefreshSection");
    const frame = el("div", "Simple-Header-Listing-RefreshButton-Frame");
    const button = primaryButton("", opts.onRefresh, "Simple-Header-Listing-RefreshButton");
    button.querySelector(".Primary-Button-Content")?.remove();
    button.setAttribute("aria-label", opts.refreshLabel ?? "Refresh");
    button.appendChild(el("div", "Simple-Header-Listing-RefreshIcon"));
    frame.appendChild(button);
    section.appendChild(frame);
    search.appendChild(section);
  }
  upper.appendChild(search);

  // --- the list ---------------------------------------------------------------------------
  const lower = el("div", `${kind}-LowerLeftSection`);
  const listFrame = el("div", meta.listFrame);
  const listing = el("div", meta.listing);
  const content = el("div", `${meta.content} Trackless-Dot-Scrollbar`);
  const listHeader = el("div", meta.listHeader);
  const list = el("div", meta.list);
  content.append(listHeader, list);
  const scrollFrame = el("div", "Scrollbar-Background-Frame");
  scrollFrame.hidden = true;
  listing.append(content, scrollFrame);
  listFrame.appendChild(listing);
  lower.appendChild(listFrame);

  grid.append(el("div", `${kind}-Background`), baseFrame(), upper, horizontalDivider(), lower);

  // --- the right column -------------------------------------------------------------------
  const asideWrap = el("div", "ImgDetails-GameDetailsWrapper");
  asideWrap.append(el("div", "ImgDetails-Background"), baseFrame());
  const aside = el("div", "ImgDetails-GameDetailsFrame");
  asideWrap.appendChild(aside);

  panel.append(grid, asideWrap);
  container.appendChild(panel);
  root.appendChild(container);
  screen.content.appendChild(root);
  screen.element.appendChild(cornerDecorations(opts.assets, opts.tft));

  const setColumns = (columns: OfficialFileColumn[]): void => {
    listHeader.textContent = "";
    columns.forEach((column, i) => {
      const cell = el("div", `${meta.col}${i}`);
      cell.appendChild(document.createTextNode(column.label));
      cell.appendChild(
        el(
          "div",
          `Sort-Icon${column.sort ? ` Sort Sort-${column.sort === "asc" ? "up" : "down"}` : ""}`,
        ),
      );
      // The sheet puts a vertical rule inside every column after the first.
      if (kind !== "CustomCampaigns" && i > 0) {
        cell.appendChild(el("div", `${meta.listHeader}-Divider`));
      }
      if (column.onClick) {
        cell.style.cursor = "pointer";
        cell.onclick = column.onClick;
      }
      listHeader.appendChild(cell);
    });
  };
  setColumns(opts.columns);

  const rescale = (): void => {
    root.style.zoom = String(Math.max(0.25, window.innerHeight / 1080));
  };
  rescale();
  window.addEventListener("resize", rescale);
  const dispose = screen.dispose.bind(screen);
  screen.dispose = (): void => {
    window.removeEventListener("resize", rescale);
    dispose();
  };

  return {
    root,
    list,
    listFrame,
    aside,
    filter,
    setColumns,
    setOverflow: (on: boolean): void => {
      scrollFrame.hidden = !on;
    },
  };
}

/**
 * One official row: `Replay-EntryRow`, `SavedItemOlds-EntryRow` or `CustomCampaigns-EntryRow`,
 * with the sheet's column wrappers and its hover delete button.
 */
export function officialListRow(
  kind: HdFileScreenKind,
  cols: string[],
  onClick: () => void,
  opts: {
    selected?: boolean;
    icon?: "folder" | "up" | "replay";
    maxPlayers?: string;
    onDelete?: () => void;
  } = {},
): HTMLElement {
  if (kind === "CustomCampaigns") {
    const row = el(
      "div",
      `CustomCampaigns-EntryRow${opts.selected ? " CustomCampaigns-EntryRowSelected" : ""}`,
    );
    const cell = el("div", "CustomCampaigns-Col0");
    cell.appendChild(el("div", "CustomCampaigns-Col-Text", cols[0] ?? ""));
    row.appendChild(cell);
    wireRow(row, onClick);
    return row;
  }

  if (kind === "LoadSavedGame") {
    const row = el(
      "div",
      `SavedItemOlds-EntryRow${opts.selected ? " SavedItemOlds-EntryRowSelected" : ""}`,
    );
    cols.forEach((text, i) => {
      const cell = el("div", `SavedItemOlds-Col${i}`);
      cell.appendChild(el("div", "SavedItemOlds-Col-Text", text));
      row.appendChild(cell);
    });
    if (opts.onDelete) row.appendChild(deleteButton("SavedItemOlds", opts.onDelete));
    wireRow(row, onClick);
    return row;
  }

  const row = el(
    "div",
    `Replay-EntryRow${opts.selected ? " Replay-EntryRowSelected" : ""}`,
  );
  cols.forEach((text, i) => {
    const cell = el("div", `Replay-Col${i}`);
    if (i === 0) {
      if (opts.icon === "folder") {
        cell.appendChild(el("div", "Replay-FolderIcon"));
      } else if (opts.icon === "up") {
        cell.appendChild(el("div", "Replay-BackDirectoryIcon"));
      } else if (opts.icon === "replay") {
        const swords = el("div", "Replay-SwordsIcon");
        if (opts.maxPlayers) swords.appendChild(el("div", "Replay-MaxPlayerSize", opts.maxPlayers));
        cell.appendChild(swords);
      }
    }
    cell.appendChild(el("div", "Replay-Col-Text", text));
    row.appendChild(cell);
  });
  if (opts.onDelete) row.appendChild(deleteButton("Replay", opts.onDelete));
  wireRow(row, onClick);
  return row;
}

function wireRow(row: HTMLElement, onClick: () => void): void {
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  row.onclick = onClick;
  row.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  });
}

function deleteButton(prefix: "Replay" | "SavedItemOlds", onDelete: () => void): HTMLElement {
  const wrap = el("div", `${prefix}-EntryRow-DeleteBtn`);
  const button = el("div", "Primary-Button Primary-Button-Small-Red");
  button.setAttribute("role", "button");
  button.appendChild(el("div", "DeleteBtn-Icon"));
  button.onclick = (e) => {
    e.stopPropagation();
    onDelete();
  };
  wrap.appendChild(button);
  return wrap;
}

/** The right column's wood header: the seat badge, the name and the author. */
export function imgDetailsHeader(opts: {
  title: string;
  version?: string;
  author?: string;
  maxPlayers?: string;
}): HTMLElement {
  const bg = el("div", "ImgDetails-Details-Header-Background");
  const header = el("div", "ImgDetails-MapPreviewHeader");
  const swords = el("div", "ImgDetails-SwordsIcon");
  if (opts.maxPlayers) swords.appendChild(el("div", "ImgDetails-MaxPlayerSize", opts.maxPlayers));
  const name = el("div", "ImgDetails-NameAndAuthor");
  name.appendChild(el("div", "ImgDetails-MapName", opts.title));
  if (opts.version) name.appendChild(el("div", "ImgDetails-MapVersion", opts.version));
  if (opts.author) name.appendChild(el("div", "ImgDetails-MapAuthor", opts.author));
  header.append(swords, name, el("div", "ImgDetails-SwordsIcon-OtherSide"));
  bg.appendChild(header);
  return bg;
}

/** The 230x230 map preview; `image` is the layer to paint a minimap on. */
export function imgDetailsMap(): { node: HTMLElement; image: HTMLElement } {
  const container = el("div", "ImgDetails-MapContainer");
  const frame = el("div", "MapDisplay-Frame");
  const image = el("div", "MapDisplay-MapImage");
  frame.appendChild(image);
  container.appendChild(frame);
  return { node: container, image };
}

/** The scrollable detail slot (`ImgDetails-Options`) between the map and the action button. */
export function imgDetailsOptions(): HTMLElement {
  const wrapper = el("div", "ImgDetails-Options-Wrapper");
  const options = el("div", "ImgDetails-Options");
  wrapper.appendChild(options);
  return wrapper;
}

/** The action slot: the sheet's `ImgDetails-ButtonContainer` with its corner decorations. */
export function imgDetailsButton(): HTMLElement {
  const container = el("div", "ImgDetails-ButtonContainer");
  container.append(el("div", "Bottom-Decoration-Left"), el("div", "Bottom-Decoration-Right"));
  const play = el("div", "ImgDetails-PlayGameBtn");
  container.appendChild(play);
  return container;
}

/** The tail every filled ImgDetails carries: the divider pair under the action button. */
export function imgDetailsDividers(): HTMLElement[] {
  return [horizontalDivider(), el("div", "ImgDetailsLowerDivider")];
}

/** One `ImgDetails-GameSettings` line: gold uppercase label, cream value. */
export function imgDetailsRow(label: string, value: string): HTMLElement {
  const section = el("div", "ImgDetails-OptionsSection");
  const row = el("div", "ImgDetails-GameSettings");
  row.append(
    el("div", "ImgDetails-GameSettingsLabel", label),
    el("div", "ImgDetails-GameSettingsValue", value),
  );
  section.appendChild(row);
  return section;
}

/** One row in a list screen: `Official-EntryRow`, optionally selected, with its columns. */
export function listRow(
  cols: Array<string | HTMLElement>,
  onClick: () => void,
  opts: { icon?: string; selected?: boolean } = {},
): HTMLElement {
  const row = el(
    "button",
    `Official-EntryRow${opts.selected ? " Official-EntryRowSelected" : ""}`,
  );
  row.type = "button";
  cols.forEach((col, i) => {
    const cell = el("div", `Official-Col Official-Col${i}`);
    if (i === 0 && opts.icon) cell.appendChild(el("span", `Official-RowIcon ${opts.icon}`));
    if (typeof col === "string") cell.appendChild(document.createTextNode(col));
    else cell.appendChild(col);
    row.appendChild(cell);
  });
  row.onclick = onClick;
  return row;
}
