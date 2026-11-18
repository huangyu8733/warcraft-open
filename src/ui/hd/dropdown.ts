import { playFdfClick } from "../fdf/render";
import { el } from "./screen";
import { themeFace } from "./theme";

/**
 * 3.0's pulldown (`WebUI\GlueManager.js`, `.Dropdown`): a plate that opens a list of
 * `war3_dropdown_*` tiles BELOW itself. A native `<select>` cannot wear that list — its menu is
 * the browser's — so this is our own control: the head is a button, the list an absolutely
 * positioned panel in a portal, and the tiles are the install's top / middle / bottom sprites.
 *
 * The portal lives outside the screen's scroll box (the options frame scrolls), which is why the
 * list is not clipped by it. One list is open at a time; a click elsewhere, Escape, a resize or
 * a scroll closes it.
 */

export interface DropdownChoice {
  value: string;
  label: string;
}

export interface DropdownControl {
  element: HTMLElement;
  value(): string;
  setValue(value: string): void;
  /** Replace the menu's items and (optionally) its pick — the LAN Server menu follows the
   *  lobby, which can gain or lose hosts while the screen is open. */
  setChoices(choices: readonly DropdownChoice[], value?: string): void;
  setDisabled(disabled: boolean): void;
  close(): void;
}

let portal: HTMLElement | null = null;
let currentOpen: DropdownControl | null = null;

/** The list's host: the screen's zoom layer when there is one, so the list renders at the same
 *  scale as the row it belongs to (3.0's options sheet is authored at 1080 lines and zoomed).
 *  The portal carries the same `.hd-official` / theme classes the screen has, so the tiles'
 *  rules and the FK sprites apply. */
function portalFor(head: HTMLElement): HTMLElement {
  // The options sheet has a named zoom layer; the LAN bands put the scale on their own root.
  // Finding the nearest scaled ancestor keeps the list at the row's scale in both.
  let scaled: HTMLElement | null = null;
  for (let node = head.parentElement; node && node !== document.body; node = node.parentElement) {
    if ((Number.parseFloat(getComputedStyle(node).zoom) || 1) !== 1) {
      scaled = node;
      break;
    }
  }
  const host = head.closest<HTMLElement>(".Options-Zoom-Container") ?? scaled ?? document.body;
  if (!portal?.isConnected) portal = el("div", "hd-official hd-dropdown-portal");
  if (portal.parentElement !== host) host.appendChild(portal);
  const face = themeFace();
  portal.classList.toggle("tft", face === "tft");
  portal.classList.toggle("fk", face === "fk");
  return portal;
}

export function dropdown(
  choices: readonly DropdownChoice[],
  initial: string,
  onChange: (value: string) => void,
): DropdownControl {
  const root = el("div", "hd-dropdown");
  const head = el("button", "hd-dropdown-head");
  head.type = "button";
  head.setAttribute("aria-haspopup", "listbox");
  head.setAttribute("aria-expanded", "false");
  const label = el("span", "hd-dropdown-label", "");
  head.appendChild(label);

  const list = el("div", "hd-dropdown-list");
  list.setAttribute("role", "listbox");

  let menuChoices = [...choices];
  let current = initial;
  let disabled = false;
  let items: HTMLElement[] = [];

  function build(): void {
    list.textContent = "";
    items = menuChoices.map((choice) => {
      const item = el("button", "hd-dropdown-item", choice.label);
      item.type = "button";
      item.setAttribute("role", "option");
      item.dataset.value = choice.value;
      item.onclick = (): void => {
        playFdfClick();
        current = choice.value;
        paint();
        close();
        onChange(choice.value);
      };
      list.appendChild(item);
      return item;
    });
  }

  function paint(): void {
    const chosen = menuChoices.find((c) => c.value === current) ?? menuChoices[0];
    label.textContent = chosen?.label ?? "";
    for (const item of items) {
      const on = item.dataset.value === current;
      item.classList.toggle("is-selected", on);
      item.setAttribute("aria-selected", on ? "true" : "false");
    }
  }

  function place(): void {
    // Under the head whenever the list fits there (3.0's own direction), above it when the window
    // foot is too close, and only then capped with a scroll.
    const host = list.parentElement;
    if (!host) return;
    const rect = head.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    // The list lives inside the zoom layer, so every number below is in that layer's layout
    // pixels. The portal itself has `zoom: 1` — its ANCESTOR is the scaled one — so walk up to
    // find the real factor (reading it off the portal made the viewport math 1/0.711 too wide
    // and clamped the menu away from its button).
    let zoom = 1;
    for (let node: HTMLElement | null = host; node && node !== document.body; node = node.parentElement) {
      const z = Number.parseFloat(getComputedStyle(node).zoom) || 1;
      if (z !== 1) {
        zoom = z;
        break;
      }
    }
    // Chrome reports `getBoundingClientRect` either pre- or post-zoom depending on the version;
    // comparing the head's rect against its untransformed width tells which, so the two spaces
    // are normalised before anything is measured.
    const factor = Math.abs(rect.width - head.offsetWidth) > 0.5 ? zoom : 1;
    const left = (rect.left - hostRect.left) / factor;
    const top = (rect.top - hostRect.top) / factor;
    const bottom = top + head.offsetHeight;
    const viewW = window.innerWidth / zoom;
    const viewH = window.innerHeight / zoom;
    list.style.maxHeight = "none";
    // A menu is as wide as its longest row, not as the whole options row: a three-word choice
    // under a full-width button would otherwise open a blank 900px slab. It never grows past
    // the button (long labels ellipsise) and never shrinks below the 240px minimum.
    list.style.minWidth = "0";
    list.style.width = "max-content";
    const natural = list.offsetWidth;
    list.style.width = "";
    list.style.minWidth = "";
    const width = Math.min(head.offsetWidth, Math.max(240, natural));
    list.style.width = `${width}px`;
    const height = list.offsetHeight;
    const below = bottom + 2;
    const belowRoom = viewH - below - 8;
    const aboveRoom = top - 10;
    let y = below;
    if (height > belowRoom) {
      if (height <= aboveRoom) {
        y = top - 2 - height;
      } else {
        list.style.maxHeight = `${Math.round(Math.max(60, belowRoom))}px`;
      }
    }
    list.style.maxWidth = `${Math.max(120, viewW - 16)}px`;
    const total = Math.max(width, list.offsetWidth);
    list.style.left = `${Math.round(Math.max(8, Math.min(left, viewW - total - 8)))}px`;
    list.style.top = `${Math.round(Math.max(8, y))}px`;
  }

  function close(): void {
    if (!list.classList.contains("is-open")) return;
    list.classList.remove("is-open");
    head.setAttribute("aria-expanded", "false");
    root.classList.remove("is-open");
    window.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close);
    window.removeEventListener("scroll", onScroll, true);
    if (currentOpen === control) currentOpen = null;
  }

  function onOutside(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (target && (head.contains(target) || list.contains(target))) return;
    close();
  }

  /** A scroll ANYWHERE ELSE (the Options frame behind the list, the page) has moved the row the
   *  list is anchored to, so the list closes. A scroll of the list ITSELF is the player reading
   *  the twelve languages — it must not close the very thing being scrolled. */
  function onScroll(event: Event): void {
    const target = event.target;
    if (target instanceof Node && list.contains(target)) return;
    close();
  }

  /** The wheel belongs to the list while it is open. Native scrolling already moves it; this
   *  stops a wheel at either end from chaining to the options frame (which would scroll, fire
   *  `onScroll` and close the list under the pointer). */
  function onWheel(event: WheelEvent): void {
    event.stopPropagation();
    const atTop = list.scrollTop <= 0 && event.deltaY < 0;
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 1 && event.deltaY > 0;
    if (atTop || atBottom) event.preventDefault();
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
    head.focus();
  }

  function openList(): void {
    if (disabled || list.classList.contains("is-open")) return;
    currentOpen?.close();
    portalFor(head).replaceChildren(list);
    list.classList.add("is-open");
    head.setAttribute("aria-expanded", "true");
    root.classList.add("is-open");
    place();
    window.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", onScroll, true);
    currentOpen = control;
  }

  head.onclick = (): void => {
    if (disabled) return;
    if (list.classList.contains("is-open")) close();
    else openList();
  };

  const control: DropdownControl = {
    element: root,
    value: () => current,
    setValue: (value) => {
      current = value;
      paint();
    },
    setChoices: (next, value) => {
      close();
      menuChoices = [...next];
      if (value !== undefined) current = value;
      build();
      paint();
    },
    setDisabled: (next) => {
      disabled = next;
      root.classList.toggle("is-disabled", next);
      head.disabled = next;
      if (next) close();
    },
    close,
  };

  list.addEventListener("wheel", onWheel, { passive: false });
  root.appendChild(head);
  build();
  paint();
  return control;
}
