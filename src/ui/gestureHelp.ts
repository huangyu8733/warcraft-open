import { createGlueButton } from "@warcraft-open/ui/dom";
import { t } from "../i18n";

/**
 * The browser launcher's "how to turn off swipe gestures" help (top bar, beside the language
 * picker).
 *
 * A two-finger swipe or a mouse side button is the browser's back / forward, and a box-select
 * drag in game triggers it: the page leaves and the match is lost. The switch lives in the
 * browser, not the page — no script can turn it off, and no script can READ it either
 * (chrome://flags and about:config are not exposed to pages), so "is it already off?" has no
 * answer. The help is therefore a set of steps shown once on the first browser visit (with
 * "don't show again"), and any time from the "?" — closed by its ×, its button, Escape or a
 * click on the backdrop.
 *
 * Only the browser build draws this: the desktop app has no browser to swipe in.
 */
/** Set once the player has answered the automatic prompt, so it is asked once, not every visit. */
const DISMISS_KEY = "warcraft-open.gestureHelp";

function promptDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false; // no storage: the prompt simply shows each visit
  }
}

function rememberDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* no storage — nothing to remember */
  }
}

export function createGestureHelp(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "gesture-help";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gesture-help__button";
  button.textContent = "?";
  button.title = t("home.gestureHelpLabel");
  button.setAttribute("aria-label", t("home.gestureHelpLabel"));
  button.setAttribute("aria-haspopup", "dialog");
  wrap.append(button);

  let open: HTMLElement | null = null;

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  const close = (): void => {
    if (!open) return;
    open.remove();
    open = null;
    window.removeEventListener("keydown", onKey);
    if (button.isConnected) button.focus();
  };

  const dismissForever = (): void => {
    rememberDismissed();
    close();
  };

  const show = (): void => {
    if (open) return;
    open = buildPanel(close, dismissForever);
    // Outside the launcher's top bar: that bar is backdrop-filtered, which would make it the
    // containing block of a fixed child and shrink the backdrop to the bar.
    document.body.append(open);
    window.addEventListener("keydown", onKey);
    open.querySelector<HTMLElement>(".gesture-help__close")?.focus();
  };

  button.onclick = show;
  // No page can read chrome://flags or about:config, so "has the player turned it off?" is not
  // answerable — the prompt is the honest fallback: show the steps once, remember the answer.
  if (!promptDismissed()) requestAnimationFrame(show);
  return wrap;
}

/** One step list, text through `t` and nothing else. */
function stepList(steps: readonly string[]): HTMLElement {
  const list = document.createElement("ol");
  list.className = "gesture-help__steps";
  for (const step of steps) {
    const item = document.createElement("li");
    item.textContent = step;
    list.append(item);
  }
  return list;
}

function heading(text: string): HTMLElement {
  const h3 = document.createElement("h3");
  h3.className = "gesture-help__heading";
  h3.textContent = text;
  return h3;
}

function buildPanel(onClose: () => void, onDismiss: () => void): HTMLElement {
  const backdrop = document.createElement("div");
  backdrop.className = "gesture-help__backdrop";
  backdrop.addEventListener("click", onClose);

  const panel = document.createElement("div");
  panel.className = "gesture-help__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "gesture-help-title");
  panel.addEventListener("click", (event) => event.stopPropagation());

  const head = document.createElement("div");
  head.className = "gesture-help__head";
  const title = document.createElement("h2");
  title.className = "gesture-help__title";
  title.id = "gesture-help-title";
  title.textContent = t("home.gestureTitle");
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "gesture-help__close";
  dismiss.textContent = "×";
  dismiss.setAttribute("aria-label", t("home.gestureDismiss"));
  dismiss.onclick = onClose;
  head.append(title, dismiss);

  const intro = document.createElement("p");
  intro.textContent = t("home.gestureIntro");

  const note = document.createElement("p");
  note.className = "gesture-help__note";
  note.textContent = t("home.gestureEdgeNote");

  const foot = document.createElement("div");
  foot.className = "gesture-help__foot";
  const never = document.createElement("button");
  never.type = "button";
  never.className = "gesture-help__never";
  never.textContent = t("home.gestureDontShow");
  never.onclick = onDismiss;
  const done = createGlueButton({ label: t("home.gestureClose"), bordered: true, onClick: onClose });
  foot.append(never, done.root);

  panel.append(
    head,
    intro,
    heading(t("home.gestureChrome")),
    stepList([t("home.gestureChrome1"), t("home.gestureChrome2"), t("home.gestureChrome3")]),
    note,
    heading(t("home.gestureFirefox")),
    stepList([t("home.gestureFirefox1"), t("home.gestureFirefox2")]),
    foot,
  );
  backdrop.append(panel);
  return backdrop;
}
