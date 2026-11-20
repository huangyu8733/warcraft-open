# Tasks — HD 系统菜单（☰）打不开

> 规格：[spec.md](./spec.md)。按顺序执行；Task 1 决定 Task 2 是否收窄。

## [x] Task 1 — 复现与探针（定位主菜单是否存在独立缺陷）

> 实测（3.0.1.24371 安装 + headless Edge CDP）：主菜单 ☰ 命中 `System-Menu-Icon`，点击后 `.hd-system-menu` 出现，面板 `offsetHeight=760`，菜单项齐全 → **分支 D**，主菜单本身无缺陷；用户看到的是未接线页面的 inert ☰。
>
> 另注：刚切到局域网页的 0–4 秒内，☰ 上方会掠过转场 canvas；转场结束后真实鼠标点击正常（v2 探针 `hitIsButton=true`）。这是转场期的既有行为，不改代码。

1. 启动开发服务器（本地有 2.0G 的 `Warcraft III zhCN` CASC 安装）：

   ```bash
   cd /Users/huangyu/魔兽/开源魔兽争霸
   WARCRAFT_OPEN_INSTALL="Warcraft III zhCN" pnpm dev --port 5173
   ```

2. 浏览器打开 `http://localhost:5173/?dev&flavor=hd`，等主菜单出现。

3. 控制台执行探针（点击 ☰ 前后各一次）：

   ```js
   const b = document.querySelector('.hd-main .PersistentBackButton-System-Menu-Button');
   b.getBoundingClientRect();
   const r = b.getBoundingClientRect();
   document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === b; // false 表示被遮挡
   b.click();
   document.querySelectorAll('.hd-system-menu').length; // 期望 1
   ```

4. 记录分支（A/B/C/D，定义见 spec.md D7）并据此执行 Task 2 或跳过。

**完成标准**：给出 A/B/C/D 中哪一条，并附探针返回值。

## [x] Task 2 — 主菜单缺陷修复（仅当 Task 1 为 A/B/C）

> 探针为 D，无需改动。

- A（被遮挡）：在 `src/ui/hd/official.css` 中修遮挡源；必要时把 `.hd-official .PersistentBackButton` 的 `z-index: 1` 改为 `2`（第 368-375 行）。
- B（抛异常）：按控制台异常栈修 `src/ui/hd/systemMenu.ts` 对应行。
- C（DOM 在但不可见）：读取 overlay 的 `getComputedStyle`，修 `official.css` 第 3113-3151 行的 `position/inset/z-index/width/height`，或 `systemMenu.ts` 第 105-107 行的 `row.style.zoom` 计算（`Math.max(0.25, window.innerHeight / 1080)`）。

**完成标准**：主菜单点击 ☰ 后 `.hd-system-menu` 存在且面板 `offsetHeight > 0`。

## [x] Task 3 — `openSystemMenu` 放宽目标类型并收紧遮罩关闭

文件：`src/ui/hd/systemMenu.ts`

- 第 42 行签名：`export function openSystemMenu(screen: HdScreen, ...)` → `export function openSystemMenu(target: Pick<HdScreen, "element">, ...)`；函数体两处 `screen.element` 改为 `target.element`（第 45、106 行）。
- 第 101 行 `scrim.onclick = close;` → `scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });`
- 第 112 行 focus 逻辑不变。

**完成标准**：`npm run typecheck` 通过；现有 7 个调用点无需改动。

## [x] Task 4 — 补全四个未接线页面

1. `src/ui/hd/lan.ts`
   - `lanShell` 的 opts 类型（第 68-89 行）新增 `onSystemMenu?: () => void;`
   - 第 157 行改为：
     ```ts
     backButton(root, t("hd.back"), opts.onBack, {
       onSystemMenu: opts.onSystemMenu,
       systemMenuLabel: t("hd.menu"),
     });
     ```
   - `mountHdLanScreen` 第 274-284 行的 `lanShell(screen, {...})` 增加：
     ```ts
     onSystemMenu: () => openSystemMenu(screen, vfs, {}),
     ```
   - 顶部补 `import { openSystemMenu } from "./systemMenu";`

2. `src/ui/hd/playerProfile.ts` 第 86 行：
   ```ts
   backButton(shell.root, t("hd.back"), h.onClose, {
     onSystemMenu: () => openSystemMenu(screen, vfs, {}),
     systemMenuLabel: t("hd.menu"),
   });
   ```
   顶部补 import。

3. `src/ui/hd/saveGame.ts` 第 90 行：同上（`screen`、`vfs` 已在作用域；`h.onClose`）。

4. `src/ui/hd/score.ts` 第 168 行：
   ```ts
   const back = backButton(root, t("hd.back"), opts.onOk, {
     onSystemMenu: () => openSystemMenu({ element: root }, opts.vfs, { onQuit: opts.onOk }),
     systemMenuLabel: t("hd.menu"),
   });
   ```
   顶部补 import。

**完成标准**：四个页面的 ☰ 不再是 `aria-hidden` 的 div；点击后出现菜单。

## [x] Task 5 — 校验

> `npm run typecheck` 通过；`node tools/import-cycle-test.mjs` → `import cycles: none (467 files)`。
> headless Edge CDP 真实鼠标事件实测：主菜单、局域网、单人游戏、玩家档案、载入存档 —— ☰ 均弹出一片菜单（面板 760px，菜单项可点，关闭后 `.hd-system-menu` 归零），无异常。
> 计分板需打完一局才能进入，未做运行时手测；与其余页面共用同一 `openSystemMenu`，类型检查通过。

```bash
npm run typecheck
node tools/import-cycle-test.mjs
```

开发服务器上逐页手测（主菜单、单机、战役、自定义战役、局域网、创建游戏、玩家档案、载入存档、回放、计分板）：

- 点击 ☰ → 菜单出现；
- Esc 关闭；点击菜单外关闭；点击「返回游戏」关闭；
- 无 handler 的项为灰色；
- 原「退出 / 返回」仍正常。

**完成标准**：以上全部通过，控制台无异常。

## [x] Task 6 — 发布（需用户确认，生产变更）

> 已发布：`npm run build:web` → `index-Z8Q5MVza.js`；服务器 `/var/www/warcraft/play` 已替换（旧目录备份为 `play.bak-20261120081631`）。线上 bundle 含 17 处 `onSystemMenu`（发布前 10 处），新接线页面已生效。

- `npm run build:web`
- 打包 `dist` 并替换服务器 `/var/www/warcraft/play`（沿用既有流程）：
  ```bash
  tar czf - -C dist . | ssh -i ~/.ssh/id_jrbzw_deploy -o IdentitiesOnly=yes root@120.26.173.20 \
    'rm -rf /var/www/warcraft/play.new && mkdir -p /var/www/warcraft/play.new && tar xzf - -C /var/www/warcraft/play.new'
  ```
  随后在服务器上把 `play` 换成 `play.new`（保留旧的备份目录）。
- 线上抽查：`curl -s https://warcraft.hhkj.me/play/ | grep -o 'assets/index-[^"]*\.js'`，下载后确认包含 `hd-system-menu`。

**完成标准**：线上 bundle 含新代码，App（加载远程 `/play/`）重启后 ☰ 可用。
