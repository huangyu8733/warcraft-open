# 脚本创建单位“明明很近却超出攻击距离”修复

## 1. 现象（已与用户确认）

- 出问题的单位：**地图脚本生成**的单位（`CreateUnit` / `CreateNUnitsAtLoc` 等触发器创建），不是兵营训练出来的兵，也不限于玩家建造的建筑。
- 表现：单位站在目标旁边却不攻击；界面/提示为“超出攻击距离”。
- 模式：暂不确定单机/联机是否都复现。

## 2. 现有实现（已核对代码）

### 2.1 攻击范围的唯一判定

- `SimWorld.inWeaponRange`（[world.ts](../../src/sim/world.ts#L11951-L11955)）：
  `hypot(t.x-u.x, t.y-u.y) - u.radius - t.radius <= w.range`（hull-to-hull）。
- 可追击判定 `SimWorld.canPursue`（[world.ts](../../src/sim/world.ts#L11945-L11947)）：`baseSpeed > 0` 且未扎根。

### 2.2 “超出攻击距离”提示的产生位置

只有两处会把攻击命令拒掉并给出 `Notinrange`：

- `SimWorld.issueAttack`（[world.ts](../../src/sim/world.ts#L11816)）：
  `ordered && !canPursue(u) && !inWeaponRange(u,t)` 才拒绝。
- `SimWorld.attackRefusal`（[world.ts](../../src/sim/world.ts#L11903-L11925)）：
  `!u.weapon || canPursue(u)` 直接放行；否则 `inWeaponRange` 为假则返回 `Notinrange`。
- 玩家点击路径从 [rts.ts](../../src/game/rts.ts#L8405-L8410) 调用 `attackRefusal`。

结论：**“超出攻击距离”只可能来自 `inWeaponRange` 对“很近”的两个实体判定为假**。要出现这个矛盾，只能是下面三者之一与渲染不一致：坐标、碰撞半径、`cliffApart`。

### 2.3 脚本创建单位的产生路径

- `RtsController.createScriptUnit`（[rts.ts](../../src/game/rts.ts#L3113-L3171)）：
  1. 建筑按 footprint 对齐；
  2. `spawnSpot`（[rts.ts](../../src/game/rts.ts#L3187-L3200)）把落在阻挡格上的地面单位挪到最近可站立格；
  3. `addSimUnit` 写入 sim，半径取 `def.collision || 16`（[rts.ts](../../src/game/rts.ts#L4862)）；
  4. `scriptSpawns.push({ typeId, x, y, ... })`（[rts.ts](../../src/game/rts.ts#L3169)）——**推的是第 2 步之后的坐标，不是 `SimWorld.add` 最终落位后的 `su.x/su.y`**。
- 渲染侧按 `scriptSpawns` 的坐标生成模型；`GetUnitX/Y` 读的是 sim 活体坐标（[world.ts](../../src/sim/world.ts#L21377-L21382)）。

即：**模型位置与 sim 位置可能不是同一个点**。这正是“看起来贴着目标、判定却够不着”的最直接来源；同时地图脚本若用 `GetUnitX/Y` 自行算距离并打印提示，也会得到同样的错误读数。

### 2.4 目标半径的第二个不一致

`assignAttackSlot` 对“建筑目标”使用 footprint 半宽作为有效半径（[world.ts](../../src/sim/world.ts#L11993-L11994)），
但 `inWeaponRange` / `attackRefusal` / `issueAttack` 只用 `t.radius`（建筑通常 `collision` 很小甚至 0→16）。
→ 攻击“贴着建筑外沿”的目标时，判定距离比实际多出最多半个 footprint（48–96），近战/短射程单位会被误判为超出射程。

## 3. 根因判定（必须先做，用证据锁定是哪一条）

新增临时诊断（`dbg`/`perfLog` 既有通道，不进入正式逻辑）：当 `attackRefusal` 将要返回 `Notinrange` 时记录
`u.typeId, t.typeId, u.x/y, t.x/y, u.radius, t.radius, w.slot, w.range, cliffApart`。

同时对照 `simView.units.get(id)` 与 `scriptSpawns` 的坐标差（渲染侧/回放侧均可读）。

判定标准：
- 坐标差 > 1 格 → 2.3；
- 坐标一致但 `dist - u.radius - t.radius` 在把 `t` 换成 footprint 半径后落回射程内 → 2.4；
- 以上都不成立且 `cliffApart` 为真 → `cliffApart` 误判（单独修，另立任务）。

## 4. 目标与非目标

目标：
1. 脚本创建单位的模型位置与 sim 位置始终一致。
2. 攻击“很近”的目标不再被误报 `Notinrange`；贴边目标按 WC3 的 hull/footprint 语义判定。
3. 不改变已有正常行为：可移动单位、塔、建筑、联机、回放与既有测试全部保持通过。

非目标：
- 不调整 `ATTACK_LEASH`、追击/包围算法、平衡数值。
- 不改地图脚本或地图数据。
- 不顺手做 2.0.0 打包/OSS 上传（另行继续）。

## 5. 修复设计（决定）

### F1. 脚本生成的模型落位改用 sim 的最终坐标

文件：[src/game/rts.ts](../../src/game/rts.ts)
函数：`createScriptUnit`
改动：
- `addSimUnit(...)` 之后从 `this.sim.units.get(simId)` 读回 `su.x / su.y`；
- `scriptSpawns.push` / `createScriptMine` 之外的返回值与 `su.guardX/guardY` 使用该最终坐标；
- 保持 `addSimUnit` 与 sim 记录不变。

理由：模型与 sim 必须同点；这是“看起来贴着、判定够不着”的唯一几何来源之一，且无行为副作用。

### F2. 范围判定统一“有效半径”

文件：[src/sim/world.ts](../../src/sim/world.ts)
新增私有方法：
```ts
/** hull 半径：建筑以 footprint 半宽为准，单位用自身 collision。 */
private hullRadius(u: SimUnit): number
```
改动点：
- `inWeaponRange` 使用 `this.hullRadius(u)` 与 `this.hullRadius(t)`；
- `attackRefusal` 走同一 `inWeaponRange`（无需另改）；
- `issueAttack` 的 `Notinrange` 门槛同样经 `inWeaponRange` 生效。

语义与现有 `assignAttackSlot`（[world.ts](../../src/sim/world.ts#L11993-L11994)）保持一致，不引入新常数。

### F3. `cliffApart` 误判（仅当 3 判定为它时执行）

文件：[src/sim/world.ts](../../src/sim/world.ts)
函数：`cliffApart`
改动：只修“脚本创建/建造完成后地形被抹平”的采样时机，保持其余判定不变；若诊断表明与之无关，本任务不做。

## 6. 验证

新增/扩展测试（Node，无需启动前端）：
- `tools/script-unit-range-test.cjs`（新建）：
  1. 用注册表真实数据构造一个“不可移动的脚本单位 + 相邻地面目标”，断言 `attackRefusal` 为 `null`；
  2. 构造“贴着建筑 footprint 外沿”的目标，断言判定与 footprint 半径口径一致；
  3. 在阻挡格上 `createScriptUnit`，断言模型坐标（`scriptSpawns`）等于 sim 坐标。
- 回归：`npm run typecheck`、`npm run sim:test`、`npm run loopback:test`、native-coverage 复查 0 missing。

人工验证：用用户实际地图，脚本生成的单位点在相邻敌人上应立即攻击，不再出现“超出攻击距离”。

## 7. 风险与回滚

- 风险：`hullRadius` 改变塔对“贴楼目标”的判定距离（更接近 WC3），影响面限定在攻击范围判定。
- 回滚：三处改动均可独立回退；不涉及存档/回放格式。

## 8. 待用户补充（不阻塞 F1/F2 实施，但决定 F3 与最终确认）

- 地图名与出问题的单位名（便于用真实数据跑断言）。
- 提示“超出攻击距离”是游戏内红字/语音，还是地图自己弹出的文本。
