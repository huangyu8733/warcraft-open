# P4 — 任务清单

> 审批依据：[spec.md](file:///Users/huangyu/魔兽/开源魔兽争霸/specs/p4-map-flavor/spec.md)
> 顺序执行；每项完成后立即标 ✅。

## T1 — P4-1 归类函数

- [ ] `src/compat/mapFormat.ts`：加 `MapFlavor`、`mapFlavor(profile)`（`w3iVersion >= 31 || editorBuild >= 132` → `"hd"`，否则 `"sd"`），补注释说明保守方向。
- 验证：`npm run typecheck`。

## T2 — P4-2 `MapInfo.flavor` + 列表灰显

- [ ] `src/world/mapInfo.ts`：`MapInfo.flavor` 必填；`parseMapInfo` 两处赋值 `mapFlavor(format)`。
- [ ] `src/i18n/mapLanguage.ts`：`localizedMapInfo` 保留 `flavor`（展开则不改）。
- [ ] `src/ui/mapBrowser.ts`：`readFolder` 用 `t("map.refuse.flavor", { map, client })` 与 `unsupportedReason` 合并进 `e.unsupported`；更新 `MapEntry.unsupported` 注释。
- 验证：`npm run typecheck`。

## T3 — P4-4 文案

- [ ] `src/i18n/index.ts`：EN / ZH 各加 `map.refuse.flavor`、`map.refuse.baseId`、`map.refuse.assets`。
- 验证：`npm run typecheck`（`MessageKey` 会强制 ZH 补齐）。

## T4 — P4-3 装载期三项检查

- [ ] `src/render/mapViewer.ts`：导出 `MapRefusal` 与 `mapLoadRefusal(bytes, vfs, registry)`（flavor → base-id → 资产；仅 HD 做后两项；同步）。
- [ ] `MapViewerScene.loadMap`：建 archive 后立即检查，拒绝时 `console.error` + `throw`，发生在清场之前。
- [ ] `src/main.ts`：`startGame` 顶部读 `mapBytes`、`mapLoadRefusal` 检查，拒绝时 `console.error` + `throw`（在 `glue.leave()` 之前）；删掉第 1087 行重复读取；`install` 只声明一次。
- 验证：`npm run typecheck`、`npm run cycles`。

## T5 — 测试

- [ ] `tools/tsconfig.sim.json` files 加 `"../src/compat/mapFormat.ts"`。
- [ ] 新增 `tools/map-flavor-test.cjs`（7 条断言，见 spec §4.7）。
- [ ] `package.json` 的 `sim:test` 末尾追加该测试。
- 验证：`npx tsc -p tools/tsconfig.sim.json && node tools/map-flavor-test.cjs`。

## T6 — 回归与真机验收

- [ ] `npm run typecheck`
- [ ] `npm run cycles`
- [ ] `npm run app:test`
- [ ] `node tools/hd-probe.mjs`
- [ ] 浏览器 HD：SD 图直链被拒（`[map] refused`，不黑屏），Terenas Stand 仍正常。
- [ ] 浏览器 SD：现有 SD 列表不变；HD 图灰显并给出原因。
- [ ] 清理 dev server / 临时文件。

## T7 — 文档

- [ ] `SD-HD开发进度.md`：P4 四项 ✅、进度表 ✅、P4 实测记录、§3 当前进度改为 P4 完成并指向 P5。
- [ ] 不更新服务器、不生成更新包。
