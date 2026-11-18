# P5 — 任务清单

> Spec：[spec.md](file:///Users/huangyu/魔兽/开源魔兽争霸/specs/p5-hd-online/spec.md)
> 约束：P0–P6 全部完成前不更新服务器、不生成更新包。

## P5-1 房间验收（无生产代码改动）

- [x] 核对 `tools/flavor-relay-test.mjs`：HD `create` 回带 flavor/gameVersion、HD `join` 同版本通过、异 build 拒绝、跨线拒绝（已全部覆盖，未改生产代码）。
- [x] 缺断言则补齐；只改测试，不改 `lobby.ts` / `rooms.mjs`（无缺项）。
- [x] 真机：HD 建房界面与 HD 地图列表（`?dev&flavor=hd&lan=host`，error 0）；双客户端同局留 P6 回归。

## P5-2 地图传输带 flavor

- [x] `src/net/mapTransfer.ts`：`MapGet.flavor` / `MapPart.flavor`；`answerMapGet(..., hostFlavor)` 跨线拒绝；`fetchMap(..., expectFlavor)` 异线分片 reject。
- [x] `src/net/lobby.ts`：`mapWire().ask` 带 `flavor()`；`serveMap` 传 `flavor()`。
- [x] `src/ui/mapDownload.ts`：`fetchMap` 传 `flavor()`。
- [x] 新增 `tools/map-transfer-flavor-test.cjs`，加入 `sim:test`。

## P5-3 录像 flavor + gameVersion

- [x] `src/game/replay.ts`：`ReplayHeader.flavor?` / `gameVersion?`；`replayLine` / `replayMismatch` / `replayRefusalText`。
- [x] `src/render/mapViewer.ts`：录制头写 flavor 与 gameVersion。
- [x] `src/ui/fdfViewReplay.ts`：`blocked()` 用 `replayMismatch` + 两个 i18n 键。
- [x] `src/main.ts` / `src/dev/devBoot.ts` / `src/replayBoot.ts`：直链兜底拒绝。
- [x] `src/i18n/index.ts`：`replay.otherFlavor` / `replay.hdVersion`（EN/ZH）。
- [x] 新增 `tools/replay-flavor-test.cjs`，加入 `sim:test`。

## P5-4 skinId 到渲染

- [x] `src/sim/world.ts`：`SimUnit.skinId`（不入哈希）、`setUnitSkin`、`drainSkinChanges`。
- [x] `src/jass/natives/world.ts` + hooks：`BlzCreateUnitWithSkin` 第 6 参、新注册 `BlzSetUnitSkin`。
- [x] `src/data/units.ts`：导出 `unitIdFromRaw`。
- [x] `src/render/mapViewer.ts`：绘制体 `hexForm > skin 变体 > 本体`；首次生成与每帧 drain 接入。
- [x] 新增 `tools/skin-id-test.cjs`，加入 `sim:test`。

## 验收

- [x] `npm run typecheck`
- [x] `npm run cycles`
- [x] `npm run app:test`
- [x] `npx tsc -p tools/tsconfig.sim.json`
- [x] `node tools/hd-probe.mjs`
- [ ] 真机四项：HD 联机、SD 回归、跨线不可见/不可加入/不可发图、录像跨线与跨 build 拒绝（HD 主菜单/建房已真机 error 0；其余按 spec §5 留 P6 双客户端回归）
- [x] 更新 `SD-HD开发进度.md`：P5 标 ✅ 并写实测记录；§3 当前进度与下一步改为 P6
