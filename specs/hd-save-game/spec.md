# 对局存档系统 + HD「存档」按钮

## 1. 背景

用户要求：HD 粘合界面左下角 `PersistentBackButton`（「返回」+ 汉堡）右边增加「存档」按钮，点击打开存档列表（读档）。经确认，最终目标为**完整对局存档系统**（运行中随时保存、随时读回）。

现状事实（已核实）：

- 引擎没有存档系统。[escMenu.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/escMenu.ts) 的 Save / Load / Restart 均为禁用态，注明 "We have no save system"。
- 本机 `~/Documents/Warcraft III` 与安装目录下**没有任何 `.w3z` 存档文件**。
- 但引擎已有一套完整的**世界快照**能力，可直接作为存档的实体层：
  - [snapshot.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/game/snapshot.ts#L860) `snapshotFor(world, viewer): WorldSnapshot` —— 单位/建筑/物品/尸体/弹道/矿/金钱木材/科技/阵亡英雄/时间。
  - [snapshotApply.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/game/snapshotApply.ts#L285) `applyWorldSnapshot(world, snap, create)` —— 反向写入。
  - [snapshotWire.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/game/snapshotWire.ts) —— 热数据二进制编解码，体积远小于 JSON。
- 脚本层状态在 [runtime.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/runtime.ts#L1570) 的 `Runtime`：`globals` / `globalArrays` / `handles` / `triggerRegs` / `timers` / `gameTime`。

## 2. 目标

1. 所有 HD 粘合界面底栏：`[返回] [存档] | [☰]`，点「存档」打开 HD 存档面板（列表 + 保存 + 载入）。
2. 游戏内按 Esc 的保存/载入解除禁用并真正工作（这是存档系统的主入口）。
3. 存档可跨启动保存到磁盘：桌面端写入 shell 数据目录 `saves/`；`pnpm dev` 写入仓库 `.saves/`；纯浏览器构建不写盘（面板提示不可用）。

## 3. 非目标（第一版明确不做）

- 不兼容暴雪原生 `.w3z`。存档是本引擎自有格式 `.o3s`，只保证本引擎读写。
- 不恢复 JASS 虚拟机中**被 `TriggerSleepAction` 挂起的线程栈**（第一版）。后果：读档后正在等待的过场/计时器会从头开始。第二版补。
- 不恢复声音句柄、漂浮文字、运行时对话框（第一版只恢复数据型对象：quest / leaderboard / multiboard 的内容在第二版补）。

## 4. 存档格式（`.o3s`，JSON 包一层）

```jsonc
{
  "format": 1,
  "savedAt": "2026-11-15T04:31:52.000Z",
  "engine": "<gameVersion()>",
  "map": { "path": "Maps\\...w3x", "name": "<显示名>" },
  "campaign": { "key": "HumanRe", "chapter": 2 },   // 非战役存档为 null
  "localPlayer": 0,
  "difficulty": 1,
  "gameTime": 1234.5,
  "world": { /* WireSnapshot（snapshotWire 的 encodeSnapshot 产物） */ },
  "script": {
    "globals": [[name, encodedValue], ...],
    "arrays":  [[name, [encodedValue|null, ...]], ...],
    "triggers":[[triggerId, { enabled, evaluated }], ...],
    "timers":  [[timerId, { remaining, periodic, handler }], ...]
  },
  "camera": { "x": 0, "y": 0, "distance": 1650, "angle": 0, "rotation": 0 }
}
```

句柄值的编码：`{ "$h": "<handleId>" }`，附带 `kind` 与稳定键（单位用 sim id、触发器用注册序号）。读档时按 sim id / 注册序号**重新绑定**，不依赖旧的 handle id。

## 5. 代码改动

| 文件 | 改动 |
| --- | --- |
| `src/game/saveFile.ts`（新建） | `.o3s` 读写、版本校验、`SaveHeader`（列表要显示的名称/时间/地图/章节） |
| `src/game/saveState.ts`（新建） | 从 `MapViewerScene` 取 `rts.simWorld` + `rts.runtime`，产出/应用存档负载；句柄编解码 |
| `src/game/saveSink.ts`（新建） | 仿 [replaySink.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/game/replaySink.ts)：桌面 `ow3native.saves`、dev `/saves/*`、浏览器返回 null |
| `electron/saveStore.mjs`（新建） | 仿 `electron/replayStore.mjs`，落在 `DATA_DIR/saves` |
| `electron/main.mjs` / `preload.cjs` | 新增 `ow3:save-*` 五个 IPC 与 `ow3native.saves` |
| `tools/vite-plugin-*.ts` | dev server 的 `/saves/list|write|read|delete` 端点（仿 `/replays/*`） |
| `src/render/mapViewer.ts` | 暴露 `captureSave()` / `restoreSave(payload)`；`MapViewerScene` 持有 `pendingSave`，在 `main()` 结束后第一个 tick 应用 |
| `src/main.ts` | `startSaveGame(save)`：按存档的地图/战役来源进入，透传 `pendingSave`；`lastMatch` 记录存档来源 |
| `src/ui/escMenu.ts` | 保存/载入按钮解禁，接 `saveSink` 与 HD 存档面板 |
| `src/ui/hd/saveGame.ts`（新建） | HD 存档面板：官方列表样式，列 `名称/地图/日期`，底部 `保存/载入/删除/取消` |
| `src/ui/hd/officialMenu.ts` | `backButton(mount, label, onClick, onSave?)`；新增 `saveButton()` 与分隔条 |
| `src/ui/hd/official.css` | `.Dual-Button-Frame-Wrapper` 第 3 个按钮的宽度/分隔条规则（现为 160 + 34 + 64） |
| `src/ui/hd/{mainMenu,singlePlayer,campaign,replay,customCampaign}.ts` | 传入 `onSave` → 打开存档面板 |
| `src/i18n/index.ts` | `hd.save` `hd.saves` `hd.noSaves` `hd.saveGame` `hd.loadGame` `hd.saveUnsupported` 等（en + zh） |

## 6. 分阶段

- **P1 实体层（世界快照）**：`saveFile.ts` + `saveState.ts`（只做 world 部分）+ `saveSink.ts` + Electron/dev 存储 + Esc 菜单保存可用 + 读档应用世界快照。
- **P2 脚本层**：`globals` / `globalArrays` / `triggerRegs` / `timers` / `gameTime` 的保存与重绑。
- **P3 界面**：HD 存档面板 + 所有 HD 屏的「存档」按钮 + 底栏样式。
- **P4 补齐**：挂起线程栈、声音、运行时对话框、quest/leaderboard 内容、相机/迷雾。

每一阶段独立可验证、可回滚。

## 7. 验证

- `npx tsc --noEmit`、`npm run cycles`。
- 无头：战役 `HumanRE01` 跑到 60 秒 → 保存 → 重新 `startSaveGame` → 对比单位数量/位置/金钱/英雄等级与 `snapshotFor` 输出一致。
- 浏览器：`?dev&chapter=HumanRE01&flavor=hd&hdArt=de&lang=zhCN` 进入章节 → Esc 保存 → 返回菜单 → 读档 → HUD 数值与保存时一致。
- 界面：HD 各屏底栏为 `[返回][存档]|☰`，1280×720 与 4K 下不被裁切。

## 8. 风险

- `applyWorldSnapshot` 目前面向**客户端**（不跑 sim），在读档场景作为权威端应用，`orderQueue`/路径/`base*` 基线不恢复 —— P1 结束时必须真机确认单位会继续行动。
- 地图脚本 `main()` 必须只跑一次；重进地图再应用快照，初始化触发器会重放（开场电影）。P2 用 `triggerRegs.enabled/evaluated` 抑制已执行的一次性触发器。
