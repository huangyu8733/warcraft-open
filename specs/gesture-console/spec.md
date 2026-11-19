# 手势控制台 Spec

来源：[`手机平板手势控制台方案.md`](../手机平板手势控制台方案.md)。实现说明见
[`docs/gesture-control.md`](../docs/gesture-control.md)。

## 1. 目标

让手机 / 平板能在 SD 与 HD 两条线上完成一局 melee：选单位、框选、右键智能命令、施法
（无目标 / 点目标 / 单位目标）、编队、小地图、建造、物品、F10 菜单、聊天输入。

实现方式是把手势做成项目里第三个「外部输入 Host」：识别器产出 `GestureIntent`，
`GestureMatchHost` 把它落到 `runCommand` / `selectAt` / `selectBox` / `orderClickAt` /
`moveAt` / `midPan` / `setZoomStop` 这些鼠标已在用的动作上，再叠一层只读 `HudDriver`
的屏上控件。

## 2. 非目标（硬约束）

- 不新增 `Command` 种类，不碰 `game/commands.ts` / `authority.ts` / `rts.ts` 核心逻辑。
- 不直调 `Authority.execute`，不直接改 `rts.orderMode` / `SimWorld` / 选择集。
- 不改联机协议、录像头、flavor 数据线（`vfs/loader.ts`、`data/edition.ts`、`data/units.ts`）。
- 不为手势写第二套 HUD；SD FDF 菜单与 HD WebUI 菜单只经 `VirtualCursor` 合成真实事件。
- 鼠标路径零回归：关闭手势时不注册任何监听。

## 3. 架构

```
device → geometry / intents / recognizer → host / actions → 既有命令门
                                        ↘ console / trail / feedback（只读 HudDriver）
profile ← OPTION_DEFS（warcraft-open.options）
```

模块与接线点见 `docs/gesture-control.md` §2。装配入口是 `startGesture()`（`main.ts`），
宿主由 `MapViewerScene.installGesture()` 注入并在 match 销毁时置空。

## 4. 映射与阈值

以 `docs/gesture-control.md` §3 为准。要点：

- 单指轻点 = 选中 / 落地；长按世界 = 智能命令（`moveAt`）；长按后拖动 = 框选；
  双击 = 同类全选；快速滑动 = 相机平移。
- 双指：捏合缩放（0.15 距离比 = 1 档）、平移、轻点取消。
- 三 / 四指：仅平板且玩家显式打开，默认关。
- 轮盘 12 槽 = `row * 4 + col`，与 `data/hotkeys.ts` 的 Grid 同形；灰掉 / 被动 / 空槽不按。
- 编队条：轻点召回、双击召回并拉镜头、长按设编队、同键第二指追加。
- 所有动作在 `withInputOverride("gesture")` 内执行，回放输入轨归因正确。

## 5. 阶段与状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | Android 资产来源：SAF 目录 + `shouldInterceptRequest` 虚拟安装、页桥、最小原生桥、锁横屏、viewport | 代码完成，**待真机验收** |
| P1 | 设备层 + 识别器 + `main.ts` 仲裁 + `inputSource` 加 `"gesture"` + CSS 安全区 + `?gesture=1` | 完成，`gesture-intent-test` 通过 |
| P2 | 语义动作层 + `installGesture` + `zoomBy` + SD 全流程 | 完成，`gesture-action-test` / `gesture-flavor-test` 通过 |
| P3 | 控制台 UI + Options（HD Input 页）+ i18n（EN/ZH）+ profile 持久化 + 三种形态 | 完成；重映射编辑器未做 |
| P4 | HD 适配：底部禁区 `consoleTop`、图标 / 字体走既有通道、HD Options 段、`hdArt` 三风格、HD 手机画质 gate | 完成，flavor 测试覆盖三种美术 |
| P5 | 平板增强：三 / 四指、命令卡镜像、左右手、触觉、44px 目标、教学浮层 | 完成；竖屏按方案为可选项，未做 |
| P6 | 文档、索引、回归 | 文档与 spec 本轮补齐；真机回归与性能对比待跑 |

## 6. 未实现（不得声称存在）

`holdMove` 虚拟摇杆、手势重映射编辑器与 `warcraft-open.gestures` 存储、竖屏布局、
Android 侧的存档 / 回放 / 自定义快捷键写入桥。

## 7. 验收

按方案 §14.3 的 12 项执行，逐项状态见 `checklist.md`。自动化部分：

```bash
pnpm typecheck
pnpm gesture:test
```

## 8. 退出对局 / 退出程序时收起手势面板（2026-11-19）

### 缺陷

F10 菜单的「退出游戏」`onEndGame` → `leave(true)`、「退出程序」`onExitProgram` →
`leave(false)`，最终都经 `main.ts` 的 `exitToMenu()` → `endMatch()`。`endMatch()` 里
`MapViewerScene.dispose()` 会调用 `setGestureHost(null)`，理论上经
`onGestureHostChange` → `syncGestureConsole()` 把 `hudMode` 算成 false 并卸载
`#gesture-hud`、隐藏 `#gesture-stage`。但实测退出后手势面板仍在，说明这条时序不可靠
（`in-game` class 仍挂着、或退出程序旁路没有经过一次宿主变更）。

### 方案（decision-complete）

1. `src/ui/gesture/index.ts` 新增并导出：

   ```ts
   /** 一局结束 / 回主菜单 / 退出程序：立刻收起替代 HUD 与常驻控件。 */
   export function endGestureMatch(): void {
     // 先让常驻控件按当前状态同步一次（宿主已卸下时会自动隐藏）。
     syncGestureConsole();
     // 最后强制卸载：即使 body 上 in-game 还在、或某条旁路没触发宿主变更，也一定收掉。
     setGestureUiActive(false);
   }
   ```

   `setGestureUiActive(false)` 已在 `hud.ts` 中实现为
   `stopPolling(); releaseAll(); unmount(); document.body.classList.remove("gesture-ui")`，
   会移除 `#gesture-hud`（含说明浮层）与 `gesture-ui` class。

2. `src/main.ts`：
   - 第 68 行 import 改为包含 `endGestureMatch`。
   - `endMatch()` 中 `mapScene = null;` 之后调用 `endGestureMatch();`。
     `endMatch()` 同时服务「退出游戏」「退出程序」「回主菜单」与关卡切换
     （`changeLevel`）；新一局装上宿主后 `syncGestureConsole()` 会按需重新挂载 HUD，
     因此这里强制卸载不会影响下一局。

3. 不改 `MapViewerScene.dispose()` 的既有 `setGestureHost(null)`；它保留为第一道清理。

### 范围外

右上角 `#gesture-toggle`（手势总开关）是菜单里的入口，退出对局后保留，不清理。

### 验收

```bash
npx tsc --noEmit
npx tsc -p tsconfig.node.json
node tools/gesture-action-test.cjs
node tools/gesture-flavor-test.cjs
node tools/gesture-intent-test.cjs
npm run --silent build:web
```

手动：对局中打开手势 → Esc →「退出游戏」→ 主菜单下 `#gesture-hud` 不存在、
`#gesture-stage` 隐藏、`body` 无 `gesture-ui`；再进一局 HUD 正常出现。
部署后用入口 hash 与线上文件比对。
