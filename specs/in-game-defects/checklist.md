# 验收清单：第二批（血法师美术 / 物品与攻击特效 / 掉落物渲染）

- [x] `itemRestore()` 在每个真正恢复了 hp/mana 的受术者身上各推一次该行的 `targetArt`，不发声音、不改数值规则。
- [x] 恢复类物品的模型在 DE 档可见（`AImaTarget` / `AIheTarget` 走 base 回退后 geosets>0）。
- [x] 传送符：`activeTeleports → collectTeleportFx` 链路不变，`MassTeleportTo/Caster/Target` 在 DE 档通过 base 回退拿到 SD 模型（geosets 4/8/8）。
- [x] 弹道：`CascDataSource.baseBytes()` 返回 `BloodElfMissile.mdx` 的 SD 副本（5904B / 2 geosets）；`assetSolver` 仅在 `hd && 无 GEOS` 时回退，blob URL 仍按原路径去重。
- [x] SD（`hd=false`）与 MPQ 档行为逐字节不变（无 `baseBytes` 时不启用回退）。
- [x] 物品地面模型从 `Units\itemSkin.txt` 读取；`scale` 缺失回落 1（绝不 0）；模型在档位内不存在时仍回落宝箱。
- [x] 血法师发黑按「DE 美术本色」结案：贴图无 MISS、队伍色层正常、独立查看器同模型正常。
- [x] `npx tsc --noEmit` 通过；`tools/render-asset-solver-test.cjs` 全绿。
- [x] 全部临时探针脚本、`/tmp` 产物与 `src/main.ts` 的 `?model=` 调试入口已删除。
- [x] 重制版全量审计：DE/HD 单位·物品·技能模型逐一解析 geosets 与贴图，0 geosets 时核对 base 兜底；声音按表行 + 文件存在性核对。
- [x] 贴图 MISS 全部清零：DE 档 659 个模型、5872 张贴图 0 缺失（跨模块补 Phoenix 8 张、`TornadoBound_*` 迁移、分隔符缺陷修复后尸体/Gore/Sheep 规则真正生效）。
- [x] 跨美术模块补缺只在当前档缺路径时生效，不覆盖已存在的资产；HD/DE 双向互备。
- [x] 3 条错误技能模型路径 + `PowerupSound` 路径已兜底，且仅在原路径缺失时生效。
- [x] 113 个无可画模型的技能、47 个 DE 独占空壳、72 个单位语音缺失、`AnimLookups.slk` 缺失均记录在案，不伪造美术/声音。
