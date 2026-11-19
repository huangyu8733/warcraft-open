import type { FdfScreen } from "../fdf/render";
import type { PanelDirection } from "../fdf/anim";
import type { WebUiAssets } from "./assets";
import { animWait } from "../../render/animClock";
import { playFdfClick } from "../fdf/render";
import { applyHdTheme } from "./theme";
import { createFullscreenToggle, type FullscreenToggle } from "../fullscreen";
import "./hd.css";

/**
 * The HD glue screens (issue #…). Reforged's menus are not FDF at all: 3.0 ships a web front
 * end under `WebUI\` and draws its whole interface itself. These screens are the same idea on
 * top of this engine — plain DOM dressed with the install's own WebUI art.
 *
 * `GlueManager` only asks a screen for five things (`element`, `dispose`, `animatePanels`,
 * `setInteractive`, `setAllDisabled`); `HdScreen` answers those for real and stubs the rest of
 * the FDF contract, so the manager's transition schedule needs no special case.
 */
export class HdScreen implements FdfScreen {
  readonly element: HTMLElement;
  /** Everything that fades between screens; the background art stays put underneath it. */
  readonly content: HTMLElement;
  /** 浏览器里的全屏开关（经典界面也各挂一颗）；桌面应用没有。 */
  private fullscreen: FullscreenToggle | null = null;

  constructor(className: string) {
    this.element = document.createElement("div");
    this.element.className = `hd-screen ${className}`;
    this.content = document.createElement("div");
    this.content.className = "hd-content";
    this.element.appendChild(this.content);
  }

  /** The screen is mounted by the manager, not by this class — showing it is the caller's job.
   *
   * It goes on `body`, not into the `#ui` container the classic screens use: out of a match
   * `#ui` is boxed to a 4:3 stage on narrow windows (style.css), and a 3.0 screen is authored
   * for the whole window. The parameter is kept so both front ends mount the same way.
   */
  attach(_container: HTMLElement): this {
    // Every HD screen is built in the edition's default face; the interface theme corrects it
    // here, once, so a screen added later does not have to know the theme exists.
    applyHdTheme(this.element);
    document.body.appendChild(this.element);
    // 前端菜单和经典界面一样没有控制台可以放全屏按钮，就挂在窗口右上角；进对局后由 HUD
    // 自己那颗接手（桌面应用 / iPhone Safari 由工厂返回 null，这里什么也不加）。
    if (!document.body.classList.contains("in-game")) {
      this.fullscreen = createFullscreenToggle("screen-fullscreen");
      if (this.fullscreen) document.body.appendChild(this.fullscreen.element);
    }
    return this;
  }

  relayout(): void {
    // CSS lays these screens out; there is nothing measured to redo on resize.
  }

  dispose(): void {
    this.fullscreen?.dispose();
    this.fullscreen = null;
    this.element.remove();
  }

  frame(): HTMLElement | null { return null; }
  setText(): void { /* FDF-only */ }
  setEnabled(): void { /* FDF-only */ }
  editBox(): null { return null; }
  popup(): null { return null; }
  list(): null { return null; }
  checkBox(): null { return null; }
  textArea(): null { return null; }
  slider(): null { return null; }

  /**
   * Fade the screen's contents across the beat `GlueManager` asks for. Reforged's own
   * transitions are brisk; the FDF chrome clips that time the classic screens run for up to
   * 0.7 s, and waiting that long on a screen with no chrome reads as a stall, so the fade is
   * capped well inside the window the manager gave us.
   */
  animatePanels(dir: PanelDirection, durationMs: number): Promise<void> {
    const ms = Math.max(80, Math.min(durationMs || 220, 240));
    const el = this.content;
    if (dir === "in") {
      // Start transparent in THIS task and paint once, so the contents fade up over the
      // background instead of appearing at full strength for a frame.
      el.style.transitionDuration = "0ms";
      el.style.opacity = "0";
      void el.offsetWidth; // commit the transparent start
      el.style.transitionDuration = `${ms}ms`;
      el.style.opacity = "1";
    } else {
      el.style.transitionDuration = `${ms}ms`;
      el.style.opacity = "0";
    }
    return animWait(ms);
  }

  setInteractive(on: boolean): void {
    this.element.inert = !on;
    this.element.classList.toggle("hd-inert", !on);
  }

  setAllDisabled(on: boolean): void {
    this.element.classList.toggle("hd-disabled", on);
  }
}

/** An element with a class (and optional text), because every screen builds a small tree. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A screen-wide panel: the 3.0 metal frame stretched over a dark fill. */
export function panel(className: string): HTMLElement {
  return el("div", `hd-panel ${className}`);
}

/**
 * The install's own WebM as a screen's moving backdrop.
 *
 * Reforged's glue is not still pictures: the main menu is Icecrown in motion and the campaign
 * table has drifting candle-light, both shipped as WebM under `WebUI\Webms\`. The bytes come out
 * of the mounted install into a blob URL, so nothing is redistributed. Muted and inlined so the
 * browser's autoplay policy lets it start; a failure is silent and the caller's still image
 * stays visible underneath.
 */
export async function backgroundVideo(
  assets: WebUiAssets,
  path: string,
  className = "hd-video",
): Promise<HTMLVideoElement | null> {
  const url = await assets.url(path);
  if (!url) return null;
  const video = el("video", className) as HTMLVideoElement;
  video.src = url;
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  void video.play().catch(() => {});
  return video;
}

export interface HdButtonOptions {
  /** The caption under the art (or the button's only text). */
  label?: string;
  /** A small line above the caption — the campaign rows' "Chapter One". */
  overline?: string;
  /** Art for a leading icon, as a blob URL. */
  icon?: string | null;
  /** Named instead of a listener, so the caller can rewire state without rebuilding the DOM. */
  onClick?: () => void;
  title?: string;
  /** A disabled button keeps its place and its art but answers nothing. */
  disabled?: boolean;
  className?: string;
}

/** One 3.0 button: a dark metal plate, gold when hot, with a chevron or an icon on the left. */
export function button(opts: HdButtonOptions): HTMLButtonElement {
  const b = el("button", `hd-btn ${opts.className ?? ""}`.trim());
  b.type = "button";
  if (opts.title) b.title = opts.title;
  if (opts.icon) {
    const img = el("img", "hd-btn-icon");
    img.src = opts.icon;
    img.alt = "";
    b.appendChild(img);
  }
  if (opts.overline !== undefined) b.appendChild(el("span", "hd-btn-overline", opts.overline));
  if (opts.label !== undefined) b.appendChild(el("span", "hd-btn-label", opts.label));
  if (opts.disabled) b.disabled = true;
  b.onclick = (): void => {
    if (b.disabled) return;
    playFdfClick();
    opts.onClick?.();
  };
  return b;
}

/** Point a button at a new handler/state without rebuilding it. */
export function rewire(b: HTMLButtonElement, onClick: () => void, disabled = false): void {
  b.disabled = disabled;
  b.onclick = (): void => {
    if (b.disabled) return;
    playFdfClick();
    onClick();
  };
}
