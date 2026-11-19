// 「请横屏」提示（手机 / 平板竖屏时覆盖菜单）。
//
// 菜单和 FDF 全屏界面是按横屏的 0.8×0.6 世界写的：ui/fdf/layout.ts 的 fitBox 按高度
// 缩放，世界宽度 = 视口宽高比 × 0.6。竖屏手机的宽高比只有 0.46，世界宽度只剩 0.28，
// 两栏布局会挤在一起，右栏直接被推出屏幕。与其为每张 FDF 屏幕再写一套竖屏布局，不如
// 让这些界面只在横屏出现——这也正是 RTS 的用法。
//
// 对局中不提示：手势 HUD 本来就是为竖屏/平板设计的（ui/gesture），地图也能正常显示。
// 这条规则完全由 CSS 表达（body:not(.in-game) + orientation: portrait + pointer: coarse），
// 所以旋转、进出对局都不需要 JS 再算一遍，display 由浏览器自己跟着变。
import { t } from "../i18n";

export function mountRotateHint(): void {
  const el = document.createElement("div");
  el.className = "rotate-hint";
  el.setAttribute("role", "status");
  el.innerHTML = `
    <div class="rotate-hint__phone" aria-hidden="true"></div>
    <div class="rotate-hint__title"></div>
    <p class="rotate-hint__desc"></p>`;
  el.querySelector(".rotate-hint__title")!.textContent = t("rotate.title");
  el.querySelector(".rotate-hint__desc")!.textContent = t("rotate.desc");
  document.body.appendChild(el);
}
