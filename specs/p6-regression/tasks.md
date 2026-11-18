# P6 — 任务清单

> Spec：[spec.md](file:///Users/huangyu/魔兽/开源魔兽争霸/specs/p6-regression/spec.md)
> 约束：P0–P6 全部完成前不更新服务器、不生成更新包。

## P6-1 自动回归

- [x] `npm run typecheck`
- [x] `npm run cycles`（374 文件，无环）
- [x] `npm run app:test`（含新增 `flavor-switch-test`）
- [x] `npm run map:compat:test`（198 张图全部可读）
- [x] `npx tsc -p tools/tsconfig.sim.json` + `map-flavor` / `map-transfer-flavor` / `replay-flavor` / `skin-id` / `render-asset-solver`
- [x] `node tools/hd-probe.mjs`（3.0.1.24371；928 单位，Footman hp 420 / armor 2 / gold 135 / food 2，DE 模型 1,568,136 字节）
- [x] `node tools/hd-probe.mjs` 双跑，基准行逐字一致

## P6-2 flavor 切换持久化

- [x] 新增 `tools/flavor-switch-test.cjs`：query 优先、storage 记住、`setFlavor` 只写自己那一行
- [x] 加入 `app:test` 并通过

## P6-3 SD 真机回归

- [x] `?dev&map=EchoIsles` 进图至 00:26、console error 0
- [x] 双标签 `?dev&flavor=sd&map=EchoIsles&lan=host|join&direct=0&seed=7` 同局，join 收到 370 帧，console error 0

## P6-4 HD 双客户端同局

- [x] `?dev&flavor=hd&map=BootyBay&lan=host&direct=0&seed=7`
- [x] `?dev&flavor=hd&map=BootyBay&lan=join&direct=0&seed=7`
- [x] 两边进图至 00:36 / 00:33，Host + Joiner 同局，sync 770 帧，console error 0
- [x] 单位属性 / 成本 / 模型路径两边一致（`hd-probe` 双跑 + HUD 目视）

## P6-5 跨 flavor 四件事

- [x] 列表不可见（SD 列表只有 `dev-lan` / `SD Game`，无 `HD Game`；反向由同一条过滤保证）
- [x] join 被拒（真实 relay 返回 `That game is on a different version line (SD/HD).`，不落座）
- [x] 地图不跨线传输（`map-transfer-flavor-test` 全绿）
- [x] 录像不跨线 / 跨 build（`replay-flavor-test` 全绿；列表与直链共用 `replayMismatch`）

## P6-6 切 flavor 重启无残留

- [x] 5200（HD 安装）启动器 HD → SD → HD：每次整页重载；SD 线正确拒绝 HD 安装并给出 3.0.1 文案；切回 HD 进入主菜单
- [x] 全程无白屏；未发现旧线资产；除预期的 SD 版本拒绝外无 error
- [x] localStorage 只保留 `warcraft-open.flavor` 的当前值（`flavor-switch-test` 钉死规则）

## P6-7 菜单与灰显

- [x] HD 主菜单有 3D 背景 + TFT logo、无白屏、edition 按钮不可见、console error 0
- [x] HD 安装临时放入 SD 图 `P6-SD-Test.w3x`：列表行 `disabled`、透明度 0.35、图标灰度；悬停提示为「这张地图属于 经典版（SD），当前客户端是 重制版（HD）。SD 与 HD 地图不能混用。」；HD 自带图仍可选；验完已移除

## P6-8 文档收尾

- [x] 更新 `SD-HD开发进度.md`：P6 ✅、实测记录、§3 当前进度、§5 风险
- [x] 确认服务器与更新包未动

## P6 回归中发现并修复

- [x] Sheep 的 6 张 DE 贴图（`Sheep_Corpse_*`、`Unit_FlyingSheep_main_*`）按 store 实际位置解析，`render-asset-solver-test` 新增 6 条断言
- [x] DE/HD 建筑模型的绝对磁盘路径（`…/art/de/…`、`h:/bz/de//…`）按 `/de/` 后的路径解析，`render-asset-solver-test` 新增 3 条断言
