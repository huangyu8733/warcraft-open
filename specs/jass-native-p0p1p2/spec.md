# 补齐 yk 地图集缺失 JASS native（P0/P1/P2）

## 目标

对 37 张 yk 地图静态分析查出的 36 个未实现 native，按影响面分 P0/P1/P2 补齐真实实现或安全占位。**只新增注册，不修改任何已工作 native 的既有语义**；不改变模拟、渲染和已部署功能（经典 1.30 门槛、HD 3.0 门槛、手势地面物品面板、物品模型对账）。

约束：
- 未实现 native 的既有回退（`missing()`/`callFunction` 返回类型默认值 + warnOnce）必须保留。
- 随机抽取一律走 `rt.random()`，保证重放/联机确定性。
- 中文注释，解释"为什么"。
- 不改 `nativeReturns` 声明；common.j 已有返回类型。

## P0（影响玩法）

### 1. 单位池 — [src/jass/natives/world.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/world.ts)

在 `registerWorldNatives` 内新增区段（复用模块内 `createUnit` / `mintUnitHandle`）：

```ts
interface JassUnitPool { handleId: number; entries: Array<{ typeId: string; weight: number }> }
```

- `CreateUnitPool()` → 新建池句柄（`handles.alloc`，类型 `unitpool`）。
- `UnitPoolAddUnitType(pool, unitId, weight)` → 追加 `{ typeId: intToRawcode(unitId), weight: max(0, weight) }`。
- `UnitPoolRemoveUnitType(pool, unitId)` → 删除该 rawcode 的所有条目。
- `DestroyUnitPool(pool)` → 清空条目并 `handles.free`。
- `PlaceRandomUnit(pool, player, x, y, facing)` → 权重总和 <= 0 或空池返回 null；否则 `rt.random()` 按权重抽一条，调用 `createUnit(c, player, rawcodeToInt(typeId), x, y, facing)` 并返回 `unit` 句柄。`spawnSuppressed` 行为沿用 `createUnit`。

### 2. 物品池补全 — [src/jass/natives/items.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/items.ts)

在现有 item pool 区段追加：

- `DestroyItemPool(pool)` → 清空 `entries` 并 `handles.free`。
- `ItemPoolRemoveItemType(pool, itemId)` → 删除 `intToRawcode(itemId)` 的所有条目。

不改 `CreateItemPool` / `ItemPoolAddItemType` / `PlaceRandomItem`。

### 3. `GetEventTargetUnit` — [src/jass/natives/events.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/events.ts)

在事件响应区段实现"当前事件目标单位"：

```ts
def(rt, "GetEventTargetUnit", (c) => {
  for (const key of ["EventTargetUnit", "OrderTargetUnit", "SpellTargetUnit"]) {
    const v = resp(c, key);
    if (v.k === "handle") return v;
  }
  return JNULL;
});
```

仅在响应尚未设置时回退到命令/法术目标；不新增响应键，不改事件泵。

## P1（影响开局/系统封装）

### 4. 网易 DzAPI 三件套 — [src/jass/natives/events.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/events.ts)

安全占位（签名与 common.j 一致，返回类型默认值）：

- `RequestExtraBooleanData(...)` → `false`
- `RequestExtraIntegerData(...)` → `0`
- `RequestExtraStringData(...)` → `""`

理由：它们背后是网易平台存档/商城封装；无平台时原版也返回空。禁止伪造数据。

### 5. `TriggerRegisterPlayerAllianceChange` — events.ts + vision.ts

- [events.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/events.ts)：注册
  `{ kind: "playerAlliance", trigId, params: [player, allianceType] }`，返回 event 句柄（与其它注册一致，用 `jHandle(0, "event")`）。
- [vision.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/vision.ts) 的 `SetPlayerAlliance`：
  - 先通过 `hooks.getPlayerAlliance?.()` 读旧值；
  - 调 `hooks.setPlayerAlliance?.()`；
  - 仅当旧值和新值**都存在且不同**时：
    ```ts
    c.fireEvent?.("playerAlliance",
      new Map([["TriggerPlayer", c.rt.playerHandle(sourceIndex)]]),
      (p) => c.rt.data<JassPlayer>(p[0])?.index === sourceIndex);
    ```
  - `getPlayerAlliance` 不可用时不触发（避免无限/误触发）。
- 语义：监视 `whichPlayer` 与任意玩家的该 alliance 位变化；`GetTriggerPlayer()` 为该玩家。只新增分支，不改变矩阵写入。

### 6. `AbilityId` — [src/jass/natives/index.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/index.ts)

在 `registerUtilNatives` 增加：`def(rt, "AbilityId", (_c, a) => jInt(rawcodeToInt(asStr(a[0]))))`；需要从 `../lexer` 引入 `rawcodeToInt`（若未引入）。字符串不足 4 字符按 `rawcodeToInt` 现有规则处理，不做特判。

## P2（渲染提示 / 无状态查询：安全占位或复用现有钩子）

### 7. 单位 — world.ts

- `SetUnitPropWindow(u, v)`：记录到 `WeakMap<JassUnit, number>`。
- `GetUnitPropWindow(u)`：返回记录值；无记录返回默认 `Math.PI`（UnitData `propWin` 的常见 180°）。
- `GetUnitDefaultPropWindow(u)`：恒返回 `Math.PI`（数据层未解析 `propWin`，不虚构逐单位值）。
- `SetUnitAnimationWithRarity(u, name, rarity)`：复用 `anim(c, a[0], name)`，忽略 rarity。
- `SetUnitLookAt` / `ResetUnitLookAt` / `UnitIgnoreAlarm` / `UnitSuspendDecay` / `SetUnitBlendTime`：无操作（`JNULL`）。
- `GetRevivingUnit`：`resp(c, "RevivingUnit")`（未设置时为 null）。

### 8. 区域/装饰 — region.ts / imagery.ts

- `RegionClearCell(region, x, y)`：无操作（不影响 `IsPointInRegion` 等既有查询）。
- `SetDoodadAnimationRect(rect, doodadId, animName, animMode, includeVariations)`：无操作（纯视觉）。
- `SetWaterDeforms(bool)`：无操作。
- `SetUbersplatRender(splat, bool)`：无操作（与 `SetUbersplatRenderAlways` 区分，不混用）。
- `SetImageAboveWater(image, flag, useWaterAlpha)`：无操作（图像已由 CreateImage 的 type/位置决定）。

### 9. 商店/计分/杂项

- [stock.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/stock.ts)：
  - `AddUnitToAllStock(unitId, currentStock, stockMax)` → 无操作。
  - `RemoveItemFromAllStock(itemId)` → 无操作。
  - （全部商店无逐店钩子；不伪造单店库存。）
- 玩家计分（放 `melee.ts` 或 `config.ts` 中现有玩家 native 区段）：
  - `GetPlayerScore(player, scoreType)` → `0`
  - `SetPlayerOnScoreScreen(player, flag)` → 无操作
- `PreloadGenEnd(filename)` → 无操作（仅预载提示）。
- `GetOrderTargetDestructable()` → `resp(c, "OrderTargetDestructable")`（未设置时为 null）。
- `GetTriggeringRegion()` → `resp(c, "TriggeringRegion")`（未设置时为 null）。
- `Cheat(cheatStr)` → 无操作（单机秘籍字符串；不接玩家作弊面板，避免改变已工作的 `RtsController.cheat`）。

## 不做

- 真三国无双AI重制版对象数据损坏、反弹流TD 缺 war3map.j 的格式修复。
- 任何对 `nativeReturns`、事件泵响应键、模拟规则、渲染路径的改动（第 5 条的 `SetPlayerAlliance` 仅增加"变更后通知"，不改变写入结果）。

## 验证

1. `npx tsc --noEmit` 通过。
2. `node tools/native-coverage.mjs --maps "/Users/huangyu/Downloads/yk.zip/yk" --calls`：缺失列表不再包含上述 36 个 native（格式损坏地图除外）。
3. 新增 `tools/jass-native-pools-test.cjs`（仿 `jass-script-natives-test.cjs` 的无头运行时）：
   - 物品池：加 3 个类型、删除 1 个、抽取只落在剩余类型；`DestroyItemPool` 后抽取为 null。
   - 单位池：`PlaceRandomUnit` 抽取后 `GetUnitTypeId` 命中池中类型；`UnitPoolRemoveUnitType` 生效；同 seed 两次抽取结果一致。
   - `AbilityId("AHbz")` 等于 `'AHbz'` 字面量整数。
4. 回归：`node tools/jass-item-event-sync-test.cjs`、`node tools/jass-unit-defaults-test.cjs`、`node tools/jass-triggering-trigger-test.cjs`、`node tools/jass-unit-stats-test.cjs` 全绿。
5. 构建部署：`npm run --silent build:web`，dist 发布到 120.26.173.20 `/var/www/warcraft`（play.new → 切换 → `chown -R 501:games play`），线上入口 curl 200。

## 验收

- 36 个 native 全部已注册；P0/P1 行为有测试覆盖；既有测试全绿；线上可进图且已正常功能无回归。
- 需用户批准本 spec 后才开始改代码。
