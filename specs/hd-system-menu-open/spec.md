# HD 系统菜单（☰）打不开 — 规格

## 问题

重制版（HD）界面左下角「退出 / 返回」右侧的 ☰（`PersistentBackButton-System-Menu-Button`）在多个页面点击无反应，不弹出系统菜单（Options / Exit Game / Return to Game / 存档）。

用户实测截图为主菜单（左侧按钮文案为「退出」），并明确说"有好几个页面"。

## 现状（代码审计结论）

`backButton(mount, label, onClick, opts)` 在 `opts.onSystemMenu` 存在时用 `primaryButton()` 生成可点击的 ☰；没有传入时渲染一个 `aria-hidden="true"` 的 inert `div`（有意设计，避免"假按钮"）。因此"点击没反应"的直接可能是：该页从未接线。

已接线（`onSystemMenu` 传入 `openSystemMenu`）：

| 文件 | 位置 |
| --- | --- |
| `src/ui/hd/mainMenu.ts` | 142-155（含 Options / Credits / Quit / 单人快捷项） |
| `src/ui/hd/singlePlayer.ts` | 56-62 |
| `src/ui/hd/campaign.ts` | 138-140 |
| `src/ui/hd/customCampaign.ts` | 47-49 |
| `src/ui/hd/customLobby.ts` | 108-110 |
| `src/ui/hd/replay.ts` | 73-75 |
| `src/ui/hd/skirmish.ts` | 193-195 |

未接线（☰ 是 inert div，点击必然无反应）：

| 文件 | 位置 | 说明 |
| --- | --- | --- |
| `src/ui/hd/lan.ts` | `lanShell` 157 行 `backButton(root, t("hd.back"), opts.onBack)` | `lanShell` 已有 `screen: HdScreen`，但没有 vfs；`mountHdLanScreen`（253 行起）同时持有 `screen` 与 `vfs` |
| `src/ui/hd/playerProfile.ts` | 86 行 `backButton(shell.root, ...)` | 函数内已有 `screen` 与 `vfs` |
| `src/ui/hd/saveGame.ts` | 90 行 `backButton(shell.root, ...)` | 函数内已有 `screen` 与 `vfs` |
| `src/ui/hd/score.ts` | 168 行 `backButton(root, t("hd.back"), opts.onOk)` | 没有 `HdScreen`；`root` 是 `div.hd-official.ScoreScreen`，`opts.vfs` 可用 |

`openSystemMenu(screen: HdScreen, vfs, handlers)` 只用到 `screen.element`（查询已有 `.hd-system-menu` 并挂载新 overlay），因此可放宽为结构化参数 `Pick<HdScreen, "element">`，让计分板（无 HdScreen）也能复用。

主菜单 / 已接线页面的链路经静态检查是完整的（`primaryButton` 始终绑定 click；overlay 挂到 `screen.element`，`z-index: 20`；CSS 用 `.hd-official` 后代选择器命中）。若实测主菜单仍打不开，需要先用探针定位点击是否到达按钮、overlay 是否进入 DOM（见 tasks.md Task 1 的分支）。

## 需求

- R1：所有带 `PersistentBackButton` 双按钮框的 HD 页面，☰ 点击后必须弹出系统菜单；不得再出现 inert 的假按钮。
- R2：系统菜单关闭语义不变：Esc 关闭、点击菜单外遮罩关闭、选中项后关闭并执行。
- R3：单片菜单的内容保持现有设计（Options / Exit Game / Return to Game / 单人快捷项 / 载入存档）；没有 handler 的项保持灰色禁用。
- R4：不引入 import cycle（`pnpm build` 会跑 `tools/import-cycle-test.mjs`）；`officialMenu` 不得反向 import `systemMenu`。
- R5：类型检查与现有测试通过；不改变其他按钮行为。

## 设计决策

- D1：保留"可选 `onSystemMenu`"的 API，不把 `systemMenu` import 进 `officialMenu`（会形成 `officialMenu → systemMenu → saveGame → officialMenu` 环，违反 R4）。改为逐页显式接线，并给 `backButton` 的 `systemMenuLabel` 默认值（`t("hd.menu")`），避免每处重复。
- D2：`openSystemMenu` 首参改为 `target: Pick<HdScreen, "element">`；现有调用点（传 `HdScreen`）不受影响，`score.ts` 传 `{ element: root }`。
- D3：`lanShell` 新增可选 `onSystemMenu?: () => void`，透传给 `backButton`；`mountHdLanScreen` 传 `() => openSystemMenu(screen, vfs, {})`。LAN 创建页（同一 `lanShell`）自动获得同一行为。
- D4：`playerProfile.ts` / `saveGame.ts` 各自在 `backButton` 调用处补 `onSystemMenu: () => openSystemMenu(screen, vfs, {})`。
- D5：`score.ts` 补 `onSystemMenu: () => openSystemMenu({ element: root }, opts.vfs, { onQuit: opts.onOk })`——计分板的「退出游戏」等同 OK 回主菜单，「返回游戏」关闭菜单。
- D6：遮罩关闭条件收紧为 `e.target === scrim`（防止将来把 overlay 挂到按钮祖先上时，同一次点击冒泡到遮罩造成"开即关"）；菜单面板内部点击不做关闭。
- D7：主菜单等已接线页面的问题，先按 Task 1 探针定位，按下表处置：
  - 探针结果 A：`document.elementFromPoint()` 命中的不是 ☰ 按钮 → 修改 `official.css` 中遮挡元素的 `pointer-events`/`z-index`，保证 `.PersistentBackButton` 在最上层（z-index 提到 2，或给遮挡层 `pointer-events: none`）。
  - 探针结果 B：点击后 `.hd-system-menu` 不在 DOM 且控制台有异常 → 修复 `openSystemMenu` 内抛出的那一行（按异常栈定位）。
  - 探针结果 C：`.hd-system-menu` 在 DOM 但不可见 → 检查 overlay 的计算样式（`display/position/z-index/zoom/尺寸`），按计算值修 `official.css`，不改整体布局。
  - 探针结果 D：主菜单一切正常 → 说明用户看到的就是未接线页面的 inert ☰，只做 D2-D5 即可。

## 验收

1. `npm run typecheck` 通过；`node tools/import-cycle-test.mjs` 无环。
2. 开发服务器 `?dev&flavor=hd` 下，主菜单、单机、战役、自定义战役、局域网（含创建页）、玩家档案、载入存档、回放、计分板：点击 ☰ 都出现 `.hd-system-menu`，Esc 与点击遮罩外都能关闭，菜单项可点击。
3. 未提供 handler 的菜单项为灰色禁用（`isDisabled`），不抛异常。
4. 现有按钮（退出 / 返回 / 各 plate 按钮）行为不变。
5. 若要 App 侧生效：`npm run build:web` 后把 `dist` 部署到 `https://warcraft.hhkj.me/play/`（App 加载远程页面）。部署属于生产变更，单独确认后执行。
