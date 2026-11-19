// 对局内右上角的手势总开关（方案 §8.1 的常驻控件）。
//
// 与启动器顶栏那颗（ui/gestureToggle.ts）不同，这一颗**不重载页面**：手势引擎可以热起停，
// 打开即挂识别器 + 控制台，关掉即摘掉全部监听与 DOM（P5）。关着手势时它是唯一的入口，
// 因为 Options 要先进对局才够得着；所以 `startGesture()` 无论开关状态都会先把它挂上。
//
// 位置在 `#ui` 内、安全区以内（§6.2）：和 `#gesture-stage` 一样跟随 stage 盒与 `--hud-scale`；
// 只有对局里才显示（CSS 的 `body:not(.in-game)` 规则）。44px 命中区是触摸的下限。

import { Hand, MousePointer2, createElement as lucideIcon } from "lucide";
import { t } from "../../i18n";
import { gestureEnabled } from "./device";

let button: HTMLButtonElement | null = null;

/** 挂一次，活到整页结束。`onToggle(true|false)` 由 `index.ts` 的 setGestureEnabled 落地。 */
export function mountGestureToggle(onToggle: (on: boolean) => void): void {
  if (button || typeof document === "undefined") return;
  const ui = document.getElementById("ui");
  if (!ui) return;

  const el = document.createElement("button");
  el.type = "button";
  el.id = "gesture-power";
  el.className = "gesture-power";
  el.setAttribute("aria-label", t("home.gestureToggleLabel"));
  el.title = t("gesture.POWER_HINT");
  el.addEventListener("click", (e) => {
    e.preventDefault();
    onToggle(!gestureEnabled());
  });
  ui.appendChild(el);
  button = el;
  syncGestureToggle();
}

/** 开关状态变化后同步高亮与图标；`index.ts` 在每次起停之后各调一次。
 *  图标画的是「点它会切到的输入方式」：手势开着 → 鼠标箭头（点了切回鼠标操作），
 *  手势关着 → 手（点了切到触摸手势）。 */
export function syncGestureToggle(): void {
  if (!button) return;
  const on = gestureEnabled();
  button.dataset.on = String(on);
  button.setAttribute("aria-pressed", String(on));
  button.replaceChildren(
    lucideIcon(on ? MousePointer2 : Hand, { "stroke-width": 2, "aria-hidden": "true" }),
  );
}
