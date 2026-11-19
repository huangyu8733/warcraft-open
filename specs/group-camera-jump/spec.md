# 手势 HUD：点击编队图标镜头居中

## 问题

手势 HUD（触摸控制台）里，点击小地图下方编队条中的某一队，单位被选中了，但镜头没有移动
到该编队的位置；必须双击（或改用键盘 `N N`）才会跳。

用户原话：“点击分组按钮为什么没有移动镜头到分组的位置”。

## 现状与证据

1. 源码已经改成单击即居中：
   - `src/ui/gesture/hud.ts`（`tapGroup`，约 488-496）：
     `host.group("recall", key, true)` —— 第三个参数 `jump = true`。
   - `src/render/mapViewer.ts`（手势宿主 `installGesture` 的 `group`，约 11863-11868）：
     `else if (this.rts?.recallGroup(key) && jump) this.jumpToSelection();`
   - `jumpToSelection()`（约 11921-11927）：`selectionAnchor()` → 写 `this.target[0/1]`。
2. 本地 dev server 已经在提供这份代码（`http://localhost:5173|5174/src/ui/gesture/hud.ts`
   里是 `group("recall", key, true)`）。
3. **线上仍是旧包**：`https://warcraft.hhkj.me/play/assets/index-BTpKQ682.js`
   （构建于 2026-11-19 09:19，部署于 09:20）压缩后的对应函数为
   `function HZe(i){const e=bn();e&&(e.group("recall",i),eu=i,pr())}` —— **没有第三个参数**。
   而 `hud.ts` 的修改时间是 09:21:54，晚于这次构建。
   截图里左上角是普通 `+` / `−` 缩放钮（放大镜图标是之后才改的），也与旧包一致。

结论：**代码本身没问题，用户看到的是 09:20 部署的旧构建**，那一版单击编队只召回不跳镜头。

## 目标

- 手势模式下，单击编队图标 → 选中该队并把镜头中心移到该队主单位（一次点击，不需要双击）。
- 线上 `warcraft.hhkj.me/play/` 提供包含该行为的最新构建。
- 键盘 `N` / `N N`、经典 HUD 双击编队的行为不变。

## 计划改动

1. `src/render/mapViewer.ts`（手势宿主 `group` 的 `recall` 分支，约 11863-11868）
   - 召回成功且 `jump` 时，先清掉可能仍在生效的相机跟随/锁定，再 `jumpToSelection()`：
     `cameraLock = false; groupFollow = false; releaseCameraRide();`
   - 理由：与已有的 `focusSelection`（11889-11894）、手柄 `jumpToSelection`（11747-11752）
     保持同一语义，避免上一帧的跟随把刚写入的 `target` 拉回去。
   - 不新增命令、不改动 `RtsController`。
2. 重新构建：`npm run build:web`（base `/play/`）。
3. 部署到 `120.26.173.20`：
   - `tar` 上传到 `/var/www/warcraft/play.new`；
   - 备份现有 `play`（`/root/backup-warcraft-play-<ts>.tar.gz`）；
   - 原子切换 `play → play.old-<ts>`、`play.new → play`；
   - `chown -R 501:games`、`chmod -R a+rX`。
4. 线上验证：
   - `curl https://warcraft.hhkj.me/play/` 的入口 hash 已更新；
   - 新 bundle 中编队快照包含带 `jump` 的调用；
   - 浏览器打开页面无控制台错误。

## 验收标准

- 手势 UI 下，点一次编队图标，镜头立即移到该队主单位；再点其他队同样生效。
- 清除相机跟随（长按头像跟随、Ctrl+C 锁定、个人编队键按住）不影响本次跳转结果。
- `tsc --noEmit`、`npm run gesture:test`、`npm run cycles` 全部通过。
- 线上页面加载的是新 bundle（资产文件名/hash 变化）。

## 不在本次范围

- 编队条布局、缩放倍率、手机专属版面等已完成的样式工作。
- 服务器根路径 `/` 的重定向（仍待用户单独决定）。
- 小地图地形上下黑边问题（待确认）。
