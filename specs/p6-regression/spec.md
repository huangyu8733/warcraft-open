# P6 — 回归与验收（Spec）

> 依据：[SD-HD开发进度.md](file:///Users/huangyu/魔兽/开源魔兽争霸/SD-HD开发进度.md) §2 P6、[SD-HD双版本方案.md](file:///Users/huangyu/魔兽/开源魔兽争霸/SD-HD双版本方案.md) §8
> 前置：P5 已完成并验收（HD 联机 go）。
> 发布约束不变：**P0–P6 全部完成并通过验收前，不更新服务器、不生成更新包。**

## 1. 目标与出口

**目标**：证明 SD 行为零变化、HD 端到端可用、两条线彼此封闭，并且启动器的 flavor 切换不留下旧源。P6 不新增功能；只有在回归中发现问题时才做最小修复。

**出口**：
1. **SD 全回归**：自动套件全绿，经典图真机可玩到 00:30，控制台无新增错误。
2. **HD 同局**：两个同 build（3.0.1.24371）的 HD 客户端通过真实 relay 进入同一局；两边看到的单位属性 / 成本 / 模型路径一致，控制台 error 0。
3. **跨 flavor 四件事**：房间列表互不可见、join 被拒、地图不跨线传输、录像不跨线回放。
4. **切换 flavor**：从 SD 切到 HD（及反向）后整页 / renderer 重启，不残留旧线的挂载模块、安装目录、版本判断与地图列表。
5. **HD 主菜单**：有 3D 背景与 TFT logo、无白屏、edition 按钮不可见。
6. **P4 列表灰显**：真实 HD 安装里放一张 SD 图，列表行灰显且悬停给出跨线原因。
7. P0–P6 全部 ✅；服务器与更新包仍未动。

**不做**：新玩法、新协议字段、服务器发布、更新包生成、性能优化。

## 2. 验收矩阵

| # | 项 | 手段 | 通过标准 |
|---|---|---|---|
| A1 | 类型 / 导入环 | `npm run typecheck`、`npm run cycles` | 0 错 |
| A2 | Electron / relay 侧 | `npm run app:test` | 全绿 |
| A3 | SD 地图回归 | `npm run map:compat:test` | 全绿 |
| A4 | flavor 单元 | `map-flavor`、`map-transfer-flavor`、`replay-flavor`、`skin-id` | 全绿 |
| A5 | HD 数据 / 资产探针 | `node tools/hd-probe.mjs` | 版本 3.0.1、Footman 数值与模型路径命中、贴图/菜单/悬崖零缺失 |
| A6 | flavor 切换持久化 | 新增 `tools/flavor-switch-test.cjs` | query 优先、storage 记住、setFlavor 只写自己那一行 |
| B1 | SD 真机 | 默认 SD 安装，`?dev&map=...` | 进图、时间推进、error 0 |
| B2 | SD 双客户端 | `?dev&flavor=sd&map=...&lan=host|join&direct=0` | 同局、时间推进、error 0 |
| C1 | HD 双客户端 | `?dev&flavor=hd&map=...&lan=host|join&direct=0`，同一 seed | 同局、时间推进、error 0 |
| C2 | HD 数据一致 | 两侧同一 build / 安装；`hd-probe` 双跑对比 | 单位属性、成本、模型路径逐项一致 |
| D1 | 列表不可见 | SD 客户端看 HD 房（及反向） | 列表不出现对方的房 |
| D2 | join 被拒 | 真实 relay + `flavor-relay-test` | 跨线 join 报 “different version line”，不落座 |
| D3 | 不发图 | `map-transfer-flavor-test` + 主机日志 | 跨线 `MapGet` 被拒，分片不跨线 |
| D4 | 不回放 | `replay-flavor-test` + 列表目视 | 跨线 / 跨 build 录像被拒，旧 SD 录像可放 |
| E1 | 切 flavor 重启 | Electron 启动器 SD↔HD 各切一次 | 挂载模块、安装目录、版本闸、地图列表全部随线变化；无旧线资产 |
| F1 | HD 主菜单 | `?dev&flavor=hd` | 背景 + logo、无白屏、edition 按钮不可见、error 0 |
| F2 | P4 灰显 | HD 安装的 `Maps\` 放一张 SD 图，HD 地图列表 | 行灰显，悬停说明 “SD 图 / HD 客户端” |

## 3. 设计决策

### D1. P6 以验收为主，生产代码默认不动

P0–P5 已经把功能做齐。P6 的交付是“跑全量 + 真机证明 + 记录”，只有回归暴露问题时才改生产代码；每处修改都要在进度文档里说明原因与影响面。

### D2. 双客户端用 dev LAN harness，而不是手点大厅

[devBoot.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/dev/devBoot.ts#L394-L403) 的 `?lan=host|join&direct=0` 走真实 `LanLobby` / relay / `MatchLink`，正是 `fdfLanLobby` 的生产接线；它自动按 join 顺序落座并用电脑补满，避免“只有一个人所以 Start 灰显”的假阻塞。两端必须：

- 同一 `flavor=hd`、同一 build（`gameVersion()` 相同）；
- 同一张 HD 图、同一 `seed`；
- 关掉 DirectLinks（`direct=0`），只走 relay，排除 WebRTC 环境差异。

SD 回归用同一条路跑一次 `flavor=sd`，确认这条共享 harness 没有因为 HD 改动而偏线。

### D3. “两客户端数据一致”用同一安装的两次独立读取证明

LAN 中每个客户端各自从自己的安装读表；同 build 同安装时一致性的前提是**读取确定**。验收分两层：

1. `hd-probe` 双跑（两个独立进程）对比 Footman 等基准单位的 `hp / armor / gold / lumber / food / model / scale`，要求逐字节一致；
2. 真机同局里核对两边 HUD 的单位血量 / 成本与模型外观一致。

不新增“跨客户端比对协议”——数据一致不是协议问题，加协议只会扩大 P6 改动面。

### D4. 切换 flavor 的自动防线：只测“选择被正确记住并优先”

真正的“无旧源残留”依赖整页 / renderer 重载，无法在单进程内证明。可自动化的部分是选择规则：

- `?flavor=hd|sd` 覆盖本次启动；
- 无 query 时读 `warcraft-open.flavor`；
- `setFlavor` 只写该键并通知订阅者，不触碰其他来源。

新增 `tools/flavor-switch-test.cjs`（独立进程，避免模块缓存串味），覆盖这三条。挂载层 / 安装目录 / 版本闸的“重启后无残留”留给 E1 真机目视。

### D5. 跨 flavor 四件事复用既有测试，不重复造轮子

- 列表过滤在 [fdfLan.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdfLan.ts#L263-L269)，由真机 D1 目视；
- join 拒绝由 [flavor-relay-test.mjs](file:///Users/huangyu/魔兽/开源魔兽争霸/tools/flavor-relay-test.mjs) 覆盖；
- 地图传输由 [map-transfer-flavor-test.cjs](file:///Users/huangyu/魔兽/开源魔兽争霸/tools/map-transfer-flavor-test.cjs) 覆盖；
- 录像由 [replay-flavor-test.cjs](file:///Users/huangyu/魔兽/开源魔兽争霸/tools/replay-flavor-test.cjs) 覆盖。

P6 只把它们纳入同一份验收记录，并补真机目视。

## 4. 变更清单

### 4.1 新增 `tools/flavor-switch-test.cjs`

用 `.sim-build/src/data/flavor.js`（`tools/tsconfig.sim.json` 已编译）：

- 假 `location.search = "?flavor=hd"` + 空 storage → `flavor() === "hd"`；
- 假 storage 已有 `warcraft-open.flavor=hd`、无 query → 仍是 `"hd"`；
- `?flavor=sd` 覆盖 storage 的 `"hd"` → `"sd"`，且**不写** storage（本次启动的临时选择）；
- `setFlavor("hd")` → `flavor()` 变 `"hd"`、storage 写入 `"hd"`、监听器收到一次；
- 每个场景前清 `require.cache` 并重置 globals。

### 4.2 `package.json`

`app:test` 在跑 `flavor-switch-test.cjs` 前先执行 `tsc -p tools/tsconfig.sim.json`（该测试读 `.sim-build/src/data/flavor.js`），因此单独跑 `npm run app:test` 也不依赖上一次的编译产物。

### 4.3 文档

更新 [SD-HD开发进度.md](file:///Users/huangyu/魔兽/开源魔兽争霸/SD-HD开发进度.md)：P6 标 ✅，写第 4 节的命令与真机结果；§3 当前进度改为“P0–P6 完成”；§5 风险表把 skinId 真机核对结果落定。

## 5. 真机步骤

环境：

- HD：`/Users/huangyu/rrrr/Warcraft III`（3.0.1.24371）
- SD：仓库默认 `Warcraft III/`（1.31.1 数据线；经典图）
- dev：`WARCRAFT_OPEN_INSTALL="<install>" npm run dev -- --port 5199`

步骤：

1. **B1**：`?dev&map=EchoIsles`（默认 SD 安装）→ 进图至 00:30，console error 0。
2. **B2**：两个标签页 `?dev&flavor=sd&map=EchoIsles&lan=host&direct=0&seed=7` / `...lan=join&direct=0&seed=7` → 同局。
3. **C1/C2**：HD dev 服务下，两个标签页 `?dev&flavor=hd&map=<HD 图>&lan=host&direct=0&seed=7` / `...lan=join&direct=0&seed=7` → 同局；`hd-probe` 双跑对比基准单位；两边 HUD 数值 / 模型一致。
4. **D1**：SD 标签页打开局域网列表，HD 房不出现；反向再确认一次。
5. **D2**：用 relay 日志或 `flavor-relay-test` 确认跨线 join 被拒；客户端显示错误而非进房。
6. **D3/D4**：跑传输与录像测试；HD 录像在 SD 客户端列表被拒；SD 旧录像照常可放。
7. **E1**：Electron `npm run app:dev`，启动器切 SD → HD → SD，各重启一次；确认安装目录键、挂载模块（HD 有 `_DE`、SD 无）、版本闸与地图列表都随线变化，HD 菜单不出现 SD 资产。
8. **F1**：`?dev&flavor=hd` → 主菜单背景 + logo，无白屏，edition 按钮不可见，console error 0。
9. **F2**：把一张 SD 图放进 HD 安装的 `Maps\`（临时），HD 地图列表出现灰行，悬停显示跨线原因；验完移除。

## 6. 风险

| 风险 | 处理 |
|---|---|
| dev LAN harness 两端启动时间差 | host 等待 joiner 180 s；先起 host 再起 join |
| HD 图在两端路径不同 | 两端用同一镜像 / 同一安装；`direct=0` 下地图仍可按路径从主机传输 |
| 浏览器双标签争 GPU | 一次只验证一局；失败时改用 Electron 两个窗口 |
| 灰显复验污染安装 | 只临时放图，验收后删除并确认列表恢复 |
| 自动测试环境语言差异 | `lobby-test` 既有 i18n 差异与 P6 无关，单独记录 |

## 7. 批准

请确认后按 [tasks.md](file:///Users/huangyu/魔兽/开源魔兽争霸/specs/p6-regression/tasks.md) 执行：
自动回归 → 切 flavor 单测 → SD 真机 → HD 双客户端 → 跨线四件事 → 切换重启 → 菜单 / 灰显 → 文档收尾。
