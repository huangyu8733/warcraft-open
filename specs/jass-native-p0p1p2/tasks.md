# 任务清单 — 补齐 yk 缺失 JASS native（P0/P1/P2）

状态：已批准，实施中（spec 见 [spec.md](file:///Users/huangyu/魔兽/开源魔兽争霸/specs/jass-native-p0p1p2/spec.md)）

- [x] T1 P0 物品池：items.ts 增加 `DestroyItemPool`、`ItemPoolRemoveItemType`
- [x] T2 P0 单位池：world.ts 增加 `CreateUnitPool`、`UnitPoolAddUnitType`、`UnitPoolRemoveUnitType`、`DestroyUnitPool`、`PlaceRandomUnit`（复用 createUnit，走 rt.random）
- [x] T3 P0 `GetEventTargetUnit`：events.ts 响应回退链（EventTargetUnit → OrderTargetUnit → SpellTargetUnit）
- [x] T4 P1 网易三件套：RequestExtraBooleanData / IntegerData / StringData 安全默认值
- [x] T5 P1 `TriggerRegisterPlayerAllianceChange`：events.ts 注册 + vision.ts SetPlayerAlliance 变更后真触发（仅旧新值都存在且不同）
- [x] T6 P1 `AbilityId`：index.ts 用 rawcodeToInt 实现
- [x] T7 P2 单位占位：SetUnitPropWindow / GetUnitPropWindow / GetUnitDefaultPropWindow / SetUnitAnimationWithRarity / SetUnitLookAt / ResetUnitLookAt / UnitIgnoreAlarm / UnitSuspendDecay / SetUnitBlendTime / GetRevivingUnit
- [x] T8 P2 场景占位：RegionClearCell；SetDoodadAnimationRect / SetWaterDeforms / SetUbersplatRender / SetImageAboveWater；AddUnitToAllStock / RemoveItemFromAllStock；GetPlayerScore / SetPlayerOnScoreScreen；PreloadGenEnd；GetOrderTargetDestructable / GetTriggeringRegion；Cheat
- [x] T9 新增 tools/jass-native-pools-test.cjs（物品池/单位池/AbilityId/联盟事件），并跑既有回归测试
- [x] T10 `npx tsc --noEmit` + `native-coverage` 缺失清零（36 张可读图：802 used / 0 missing）
- [x] T11 `npm run --silent build:web`，部署 dist 到 120.26.173.20 /var/www/warcraft，校验线上 200 与入口 hash

## 风险控制

- 仅新增 `def(...)`；不删改既有注册。
- SetPlayerAlliance 仅在 `getPlayerAlliance` 与 `setPlayerAlliance` 均可用且值变化时 `fireEvent`，不影响矩阵写入。
- 所有随机使用 `rt.random()`。
