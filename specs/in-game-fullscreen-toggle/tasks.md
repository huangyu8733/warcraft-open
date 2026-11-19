# 任务清单：对局内全屏开关 + 手机全屏下无法输入文字

1. [x] `src/ui/fullscreen.ts`
   - 导出 `fullscreenSupported()` / `fullscreenActive()` / `toggleFullscreen()`。
   - Alt+Enter 分支改为复用 `toggleFullscreen()`，保留 `repeat` / 桌面壳提前返回。

2. [x] `src/i18n/index.ts`
   - EN 与 ZH 各加 `hud.fullscreen`、`hud.exitFullscreen`（ZH 为 `Record<MessageKey, string>`，漏写即编译错误）。

3. [x] `src/ui/gesture/hud.ts`（手机手势 HUD）
   - 增加 `fsBtn` 模块变量与 `syncFullscreenButton()`。
   - `mount()` 内创建按钮并 `zoomBar.prepend(...)`，`hidden = !fullscreenSupported()`。
   - `document.addEventListener("fullscreenchange", syncFullscreenButton)`；`unmount()` 里移除并清空引用。

4. [x] `src/style.css`
   - 新增 `.hud-fullscreen`（32×32、金边深色板、`pointer-events: auto`、`z-index: 6`、`svg` 18px）。
   - 复用现有 `body.gesture-ui .fdf-screen.fdf-topbar { display: none }` 隐藏桌面按钮，不额外加规则。

5. [x] `src/ui/consoleUi.ts`（桌面经典 HUD）
   - 私有 `fsBtn`；`onBuild` 末尾 `mountFullscreenButton(built)`。
   - 依据 `UpperButtonBarFrame` 与 overlay 的 `getBoundingClientRect()` 定位：左侧空位 ≥ 40px 才显示，否则隐藏。
   - `fullscreenchange` 监听 + `dispose()` 清理。

6. [x] `src/ui/fdf/render.ts`（手机输入修复）
   - `onResize` 在 overlay 内有输入框聚焦时置 `relayoutPending` 并跳过 `build()`。
   - `overlay` 的 `focusout` 在“焦点确实离开输入框”后补一次 `build()`。
   - `dispose()` 移除 `focusout` 监听。

7. [x] 验证
   - `npx tsc --noEmit`（通过）
   - `npm run --silent gesture:test`（全部通过）
   - `npm run --silent cycles`（无循环）
   - `npm run --silent build:web`（`dist/assets/index-CejQspl3.js`）
   - 桌面浏览器：进图 → 左上角全屏按钮进出全屏；按钮不压顶栏 4 个按钮与时钟。
   - 手机：进图 → 全屏按钮进出全屏；全屏下「新建档案」软键盘可连续输入，键盘不再被弹掉。

8. [x] 部署（沿用既有流程）
   - `tar czf - --exclude '.DS_Store' . | ssh -i ~/.ssh/id_jrbzw_deploy root@120.26.173.20 'tar xzf - -C /var/www/warcraft/play.new'`
   - 远端 `mv play play.bak-20261119-165856; mv play.new play; chown -R 501:games play`
   - `https://warcraft.hhkj.me/play/` 返回 200，入口已是 `assets/index-CejQspl3.js`（bundle / css 均 200，且都含 `hud-fullscreen`）。
