# 对局内全屏开关 + 手机全屏下无法输入文字

## 问题

1. 进入地图后，界面左上角没有全屏开关；手机上没有 Esc / Alt+Enter，进了全屏就出不来。
2. 手机上进入全屏后再去建档案（或任何需要打字的输入框），软键盘弹出即消失，一个字也输不进去。

用户原话：“进入地图左上角加入全屏按钮（打开/关闭），手机上进入全屏后无法输入文字信息，建档案都建不了”。

## 现状与证据

### 全屏只有 Alt+Enter，且只进不出

- [fullscreen.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fullscreen.ts#L19-L27)：`window` 捕获段监听 Alt+Enter，直接 `requestFullscreen` / `exitFullscreen`，没有导出任何函数。
- [home.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/home.ts#L725-L753) `enterPlayFullscreen()`：进入游戏时请求全屏，注释明确“nothing on this path ever EXITS fullscreen（leaving is Esc's, or Alt+Enter's）”。手机没有这两个键，所以进图即被困全屏。
- 桌面壳（Electron）由 `electron/main.mjs` 的 `before-input-event` 处理 Alt+Enter，页面内不参与；页面里再放一个 HTML 全屏按钮反而与壳的窗口全屏不是同一件事，故桌面壳内不显示按钮。

### 左上角没有空位可以“塞第五个按钮”

- [consoleUi.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/consoleUi.ts#L427-L477) 的 `build()` / `onBuild`：FDF 顶栏在每次 resize 时整屏重建。
- [consoleUi.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/consoleUi.ts#L484-L547) `rootFrame()`：`UpperButtonBarFrame` 从 0.002 起、宽 0.34，4 个按钮各 0.085 正好填满；0.343–0.459 是给 TimeIndicator 模型（时钟）留的洞，被 `mountClock()` 占用。
- 结论：不改 FDF 宽度，改为往顶栏 overlay 里挂一个我们自己的 DOM 按钮，位置按 `UpperButtonBarFrame` 的实际矩形算。

### 手机全屏下无法输入：软键盘弹出触发 resize，FDF 整屏重建

- [render.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdf/render.ts#L403-L404)：`const onResize = (): void => build();` —— 任何 window resize 都无条件重建。
- `build()` 第一件事是 `overlay.textContent = ""`（[render.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdf/render.ts#L266)），然后按 FDF 重新生成所有 DOM。
- FDF 的输入框是真实 `<input>`（[widgets.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdf/widgets.ts#L140-L165) `buildEditBox`）。
- Android Chrome 弹出软键盘会改变布局视口并触发 `resize` → 正在聚焦的 `<input>` 被销毁 → 键盘收起 → 再点再重建。表现就是“建档案都建不了”。
- 键盘事件本身不是原因：`onKey` 对 `INPUT/TEXTAREA/contentEditable` 已直接 return（[render.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdf/render.ts#L423-L425)）。

## 目标

- 对局内左上角有全屏开关：点一下进入全屏，再点一下退出；图标 / 文案随全屏状态切换。
- 手机手势 HUD 与桌面经典 HUD 都提供该按钮（桌面壳内除外，由壳负责）。
- 修复 FDF 屏幕在输入框聚焦期间被 resize 重建、导致手机软键盘下无法输入的问题。
- 其余布局、热键、HUD 行为不变。

## 方案

### 1. `src/ui/fullscreen.ts`：导出三个小函数

```ts
export function fullscreenSupported(): boolean {
  return !isDesktopApp() && typeof document.documentElement.requestFullscreen === "function";
}
export function fullscreenActive(): boolean {
  return !!document.fullscreenElement;
}
export function toggleFullscreen(): void {
  if (!fullscreenSupported()) return;
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
}
```

- Alt+Enter 的现有处理改为调用 `toggleFullscreen()`（保留 `e.repeat` 与 `isDesktopApp()` 的提前返回），行为不变。
- `fullscreenSupported()` 为 false（iPhone Safari 没有元素全屏、桌面壳）时按钮隐藏。

### 2. `src/i18n/index.ts`：两条文案

在 `EN`（`gesture.*` 段附近，约 L1143）与 `ZH`（约 L2275）各加：

- `hud.fullscreen`: `Fullscreen` / `全屏`
- `hud.exitFullscreen`: `Exit fullscreen` / `退出全屏`

`MessageKey` 由 `keyof typeof EN` 推导，`ZH` 是 `Record<MessageKey, string>`，漏写会编译报错。

### 3. 手机手势 HUD：`src/ui/gesture/hud.ts`

- 新模块变量 `let fsBtn: HTMLButtonElement | null = null;`
- 在 `mount()` 里（`zoomBar` 构建之后，约 L464）：
  - `fsBtn = groupBarButton("ghud-zoom__btn", t("hud.fullscreen"))`；
  - 图标 `lucideIcon(Maximize, { "stroke-width": 2.2, "aria-hidden": "true" })`（lucide 已安装，`Maximize` / `Minimize` 均存在）；
  - `click` → `e.preventDefault(); toggleFullscreen();`
  - `zoomBar.prepend(fsBtn)` —— 位于左上角工具列最上端（小地图右侧，`left: safe-left + 184px`）。
  - `fsBtn.hidden = !fullscreenSupported();`
- 新增 `function syncFullscreenButton(): void`：按 `fullscreenActive()` 换 `Maximize` / `Minimize` 图标、`title` 与 `aria-label`（`hud.exitFullscreen` / `hud.fullscreen`）。
- 在 `mount()` 成功时 `document.addEventListener("fullscreenchange", syncFullscreenButton)` 并调用一次同步；`unmount()`（约 L604-662）里 `removeEventListener` 并把 `fsBtn = null`。
- 不新增 CSS：按钮完全复用 `.ghud-zoom__btn`（含手机竖屏 `@media` 的 0.5 缩放）。

### 4. 桌面经典 HUD：`src/ui/consoleUi.ts`

- 新私有字段 `private fsBtn: HTMLButtonElement | null = null;`
- `onBuild(built)` 末尾调用 `this.mountFullscreenButton(built)`：
  - 懒创建一次 `<button class="hud-fullscreen">`，`pointerEvents = "auto"`，点击调 `toggleFullscreen()`；
  - 每次 build 重新 `append` 到 `built.element`（overlay 每次重建会把子节点清空）；
  - 位置按 `built.frame("UpperButtonBarFrame")` 的 `getBoundingClientRect()` 与 overlay 矩形计算：
    - 顶栏左端距 overlay 左边缘 ≥ 40px（16:10 / 16:9 桌面）：放在顶栏左侧同一水平带，`left = barLeft - 38`，垂直居中于顶栏；
    - 否则（4:3 等，顶栏贴左边缘）：**不显示**该按钮（`hidden`），桌面 4:3 仍可用 Alt+Enter；
  - `fullscreenSupported()` 为 false 时隐藏；
  - 图标按 `fullscreenActive()` 同步（`Maximize` / `Minimize`），`title` / `aria-label` 走同一对 i18n key。
- 构造函数里注册一次 `fullscreenchange` 监听（`sync` 当前按钮），`dispose()`（约 L418-425）里移除监听、`fsBtn?.remove()`、`fsBtn = null`。
- 该按钮挂在 `.fdf-screen.fdf-topbar` overlay 内，所以手势模式下它随顶栏一起被 [style.css](file:///Users/huangyu/魔兽/开源魔兽争霸/src/style.css#L6832-L6841) 的规则隐藏，不需要额外判断。

### 5. `src/style.css`：桌面按钮样式

新增 `.hud-fullscreen`（放在 `.hud-iconbtn` 附近，L1341 之后）：

- 32×32、`position: absolute`、`z-index: 6`、`pointer-events: auto`；
- 深色金边木板（与 `.ghud-zoom__btn` 同一套观感）：`border: 1px solid rgba(243,220,154,.45)`、`border-radius: 4px`、`background: rgba(18,14,8,.72)`、`box-shadow: 0 2px 8px rgba(0,0,0,.55)`、`color: #efe4c8`；
- `svg { width: 18px; height: 18px; }`，`:hover` 提亮、`:active` 轻微缩小，`touch-action: manipulation`。

注意顶栏 overlay 是 `z-index: 1`（[style.css](file:///Users/huangyu/魔兽/开源魔兽争霸/src/style.css#L5031-L5038)），HUD 的 `z-index: 4` 元素（如英雄栏）在它之上；按钮放在顶栏左侧空白带（x ≈ 控制台左缘 − 38px），与英雄栏（`left: 3 * UI_HEIGHT/1080`，紧贴最左）不重叠。

### 6. `src/ui/fdf/render.ts`：输入框聚焦期间不重建

在 `onResize` 定义处（L403）改为：

```ts
const inputFocused = (): boolean => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && overlay.contains(a) &&
    (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
};
let relayoutPending = false;
const onResize = (): void => {
  if (inputFocused()) { relayoutPending = true; return; }
  build();
};
// 焦点真正离开输入框（软键盘收起、点了别处）后再补一次布局。
const onFocusOut = (): void => {
  if (!relayoutPending) return;
  window.setTimeout(() => {
    if (!overlay.isConnected || inputFocused()) return; // 只是换了另一个输入框，继续等
    relayoutPending = false;
    build();
  }, 0);
};
window.addEventListener("resize", onResize);
overlay.addEventListener("focusout", onFocusOut);
```

- `dispose()` 里补 `overlay.removeEventListener("focusout", onFocusOut)`。
- 只拦 resize 引起的重建；`relayout()`、字体就绪重建等显式路径不变。
- 输入框获得焦点后屏幕可能被软键盘遮住一部分，但输入不再被打断；键盘收起后自动补一次正确布局。

## 验收标准

1. 桌面浏览器（16:9）进入地图：顶栏左端外侧出现全屏按钮；点击进入全屏、图标变“退出”，再点退出。按钮不压 Quests/Menu/Allies/Chat 与时钟。
2. 手机（Android Chrome）进入地图：左上角小地图右侧工具列最上方出现全屏按钮；点击进入/退出全屏，图标与无障碍文案同步切换。
3. iPhone Safari / 桌面 Electron 内不显示该按钮（无元素全屏能力 / 由壳负责）。
4. 手机全屏状态下打开单机模式「新建档案」：软键盘弹出后输入框仍在、能连续输入，键盘不再被弹掉；收起键盘后界面布局恢复正常。
5. 既有的 F10 菜单、记分板、聊天框等 FDF 屏幕在窗口缩放时仍会重建（只有输入框聚焦期间延后）。
6. `npx tsc --noEmit`、`npm run --silent gesture:test`、`npm run --silent cycles` 通过。
7. `npm run --silent build:web` 成功；部署后 `https://warcraft.hhkj.me/play/` 入口 200，bundle hash 更新。

## 不在本次范围

- 退出对局后自动退出全屏（`enterPlayFullscreen()` 的“只进不出”策略保持）。
- 主菜单 / 单机菜单里新增全屏按钮。
- 改动 FDF 顶栏 4 个按钮的宽度或时钟洞。
- 输入框在软键盘弹出时的自动滚动 / 抬升（只保证不重建、不丢焦点）。

## 风险

- 桌面按钮依赖 `UpperButtonBarFrame` 的 rect；FDF 换肤（HD/SD）只改贴图不改布局，矩形不变。若取不到该 frame，按“无空位”处理并隐藏按钮。
- `fullscreenchange` 在部分浏览器不触发 resize：两个 HUD 都显式监听该事件重绘图标，不依赖 resize。
- 输入框保护只在 `resize` 路径生效；若某屏幕在输入中自己调用 `relayout()` 仍会重建（当前没有任何屏幕这样做）。
