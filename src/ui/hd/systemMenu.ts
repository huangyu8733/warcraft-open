import type { DataSource } from "../../vfs/types";
import type { HdScreen } from "./screen";
import { el } from "./screen";
import { playFdfClick } from "../fdf/render";
import { openSaveGamePanel } from "./saveGame";
import { applyHdTheme } from "./theme";
import { isDesktopApp } from "../../assets/nativeInstall";
import { t } from "../../i18n";

/**
 * 3.0's system menu — what the hamburger in the bottom-left dual frame opens
 * (`PersistentBackButton-System-Menu-Button`).
 *
 * The reference draws it as ONE carved plate over the live backdrop (the scene keeps running;
 * nothing is blacked out): the screen's own actions at the top — OPTIONS, EXIT GAME, RETURN TO
 * GAME — followed by the single-player shortcuts and the saved-game list, which 3.0 keeps in
 * this menu rather than in the corner frame.
 *
 * Reforged ships this menu in its localised string tables rather than its glue sheet, so the
 * words are ours and the geometry is the sheet's own `Official-BaseFrame` (wood, metal border,
 * hanging chains) sized to the reference's plate.
 */
export interface SinglePlayerShortcuts {
  /** Jump straight into campaign selection. */
  onCampaign?: () => void;
  onCustomCampaign?: () => void;
  onCustomGame?: () => void;
}

export interface SystemMenuHandlers {
  /** The Options screen, on screens that can reach it (main menu, single player). */
  onOptions?: () => void;
  /** Play the credits, on screens that can reach them. */
  onCredits?: () => void;
  /** Leave the front end the way the main menu's Exit does; falls back to a reload. */
  onQuit?: () => void;
  /** The right-hand plate; the saved-game row is always on it. */
  singlePlayer?: SinglePlayerShortcuts;
}

/** Mount the system menu over the target's element; Escape or a click outside closes it. */
export function openSystemMenu(
  target: Pick<HdScreen, "element">,
  vfs: DataSource,
  h: SystemMenuHandlers,
): void {
  // One at a time — the button that opens it is under the overlay, but the keyboard can still
  // reach it, and every listener below must be paired with the one overlay that owns it.
  target.element.querySelector(".hd-system-menu")?.remove();

  const overlay = el("div", "hd-system-menu");
  const scrim = el("div", "hd-system-menu-scrim");
  const row = el("div", "hd-system-menu-row");

  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", rescale);
    overlay.remove();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  /** A left-plate row: gold when it has somewhere to go, grey when it does not. */
  const item = (label: string, run: (() => void) | null, extra = ""): HTMLElement => {
    const b = el("button", `hd-system-menu-item${run ? "" : " isDisabled"}${extra ? ` ${extra}` : ""}`);
    b.type = "button";
    b.textContent = label;
    if (!run) {
      b.disabled = true;
      return b;
    }
    b.onclick = (): void => {
      playFdfClick();
      close();
      run();
    };
    return b;
  };

  // --- one plate: this screen's actions, then the single-player shortcuts ---------------
  const actions = plate("hd-system-menu-actions");
  actions.body.appendChild(el("div", "hd-system-menu-title", t("hd.menu")));
  const list = el("div", "hd-system-menu-list");
  list.append(
    item(t("menu.options"), h.onOptions ?? null),
    item(t("hd.exitGame"), h.onQuit ?? exitGame, "is-exit"),
    item(t("hd.returnToGame"), close),
  );
  const sp = h.singlePlayer ?? {};
  if (sp.onCampaign) list.appendChild(item(t("hd.campaign"), sp.onCampaign));
  if (sp.onCustomCampaign) list.appendChild(item(t("hd.customCampaign"), sp.onCustomCampaign));
  if (sp.onCustomGame) list.appendChild(item(t("hd.customGame"), sp.onCustomGame));
  list.appendChild(item(t("hd.loadSavedGame"), () => openSaveGamePanel(vfs)));
  actions.body.appendChild(list);

  row.appendChild(actions.panel);
  overlay.append(scrim, row);
  // Only a click on the scrim itself closes: a click on the row (or a panel) must reach the
  // menu's own controls. Testing the target also keeps the overlay safe if it is ever mounted
  // on an element that already contains the button that opened it.
  scrim.addEventListener("click", (e) => {
    if (e.target === scrim) close();
  });
  target.element.appendChild(overlay);

  // The plates are authored for a 1080-line window, like every other 3.0 screen; only the row
  // is zoomed so the scrim still covers the whole window at any size.
  const rescale = (): void => {
    row.style.zoom = Math.max(0.25, window.innerHeight / 1080).toFixed(3);
  };
  rescale();
  window.addEventListener("resize", rescale);
  document.addEventListener("keydown", onKey, true);

  // Keyboard users land on the first row that answers.
  list.querySelector<HTMLElement>(".hd-system-menu-item:not(.isDisabled)")?.focus();
}

/** One carved plate: the screen's own frame art with a content column over it. */
function plate(className: string): { panel: HTMLElement; body: HTMLElement } {
  const panel = el("section", `hd-system-menu-panel ${className}`);
  const frame = el("div", "BaseFrame Official-BaseFrame");
  frame.append(
    el("div", "left-chain"),
    el("div", "right-chain"),
    el("div", "frame"),
    el("div", "background-texture"),
  );
  const body = el("div", "hd-system-menu-body");
  panel.append(frame, body);
  // The plates are built on demand, after the screen has already taken its theme.
  applyHdTheme(panel);
  return { panel, body };
}

/** Quit the front end the way the main menu's Exit does. */
function exitGame(): void {
  if (isDesktopApp()) {
    location.reload();
    return;
  }
  location.replace(`${location.origin}${location.pathname}`);
}
