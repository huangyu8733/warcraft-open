# 任务清单：脚本创建单位攻击距离误判

- [x] T1 采集证据：在 `attackRefusal` 返回 `Notinrange` 前输出 `u/t` 的 typeId、坐标、半径、武器槽与 range、`cliffApart`；对照 `scriptSpawns` 与 `simView` 坐标差，锁定根因分支（2.3 / 2.4 / cliffApart）。——静态证据已足够：`SimWorld.add` 末尾调用 `settle()` 会把落在阻挡格的单位挪到最近空格（[world.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/sim/world.ts#L10505)），而 `scriptSpawns` 推的是请求坐标（2.3）；`inWeaponRange` 只用 `t.radius` 而 `assignAttackSlot` 用 footprint 半宽（2.4）。
- [x] T2 F1：`RtsController.createScriptUnit` 在 `addSimUnit` 后回读 sim 的 `su.x/su.y`，`scriptSpawns` 与后续守卫点统一使用最终坐标。
- [x] T3 F2：`SimWorld` 新增 `hullRadius`（建筑取 footprint 半宽，单位取 collision），`inWeaponRange` 改用它计算双方半径。
- [x] T4 F3（条件）：判定为**不需要**——两条可复现路径（坐标错位、目标半径口径）已覆盖症状，新测试在无地形采样（`cliffApart` 恒假）下复现并通过；不引入 `cliffApart` 改动。
- [x] T5 新建 `tools/script-unit-range-test.cjs`，覆盖：相邻目标不被拒绝、贴着建筑外沿的目标按 footprint 判定、阻挡格脚本单位模型与 sim 同点。
- [x] T6 回归：`npm run typecheck`、`npm run sim:test`、`npm run loopback:test`、native-coverage 0 missing。——全部通过（typecheck 0 错误；完整 sim:test `all checks passed`；loopback `all checks passed`；jass:coverage 0 missing）。
- [ ] T7 用用户实际地图人工验证“站旁边不攻击 + 超出攻击距离”消失。
- [ ] T8 验证通过后，恢复被中断的 2.0.0 Windows / Linux 打包与 OSS 上传、`latest.json` 更新。——当前 `release/` 里的 2.0.0 macOS/Windows 安装包是本次修复**之前**构建的，需要重打；Linux 2.0.0 尚未生成。
