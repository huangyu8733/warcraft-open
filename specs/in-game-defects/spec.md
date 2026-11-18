# 对局内 4 项缺陷修复规格

日期：2026-11-15　　范围：HD(3.0) 对局渲染与音频，不改 UI 主题/控制台既有实现。

用户报告：

1. **金矿没有显示**：地图上 `ngol` 无模型，但信息面板能显示「金矿 / 金币:13040」；地面 NGOL 贴花存在。
2. **进度条没有文字**：加载界面蓝色进度条上没有文字。
3. **选择人物没有标识，选择其他的也没有标识**：选中单位/建筑无选择圈。
4. **建造建筑都没有声音，农民也没有声音**：建造与农民语音/作业音效缺失。

---

## 缺陷 3：选择圈（已定位，可直接修）

### 证据

- 选择圈由 `src/render/uberSplatOverlay.ts` 的 `mask` 模式**程序化绘制**（着色器按 SDF 画环，纹理像素被忽略，只作为「这条记录可画」的开关）。
- `render()` 中：

  ```ts
  const tex = this.resolveTexture(e.texture);
  if (!tex) continue;          // ← 纹理解析不到就整条跳过
  ...
  gl.bindTexture(...); // mask 分支并不采样 uTex
  ```

- `src/render/mapViewer.ts` 约 2570 行创建 `ringSplats` 时，loader 直接 `art.source.rawBytes(art.path)`，**没有走 HD 的 `.blp → .dds` 候选**；同文件其它贴图都通过 `imageCandidates()/vfsImage()`（`src/render/blputil.ts`，HD 会追加 `.dds` 及重定位路径）。
- 结果：HD 安装里 `UI\Feedback\SelectionCircle\SelectionCircleUnit.blp` 不存在 → `resolveTexture` 返回 null → 所有选择圈被 `continue` 跳过。建筑圈同理。
- `imageToCanvas()` 本身支持 DDS（含 magic `DDS ` 与 BC1/BC2/BC3 解码），所以缺的只是**候选路径**。

### 修复

1. `src/render/uberSplatOverlay.ts`
   - mask 记录不要求纹理解码成功：

     ```ts
     const tex = this.resolveTexture(e.texture);
     if (!tex && !e.mask) continue;
     if (tex) { this.texture.constructor ... bindTexture / uniform 更新 }
     ```

   - mask 分支不绑定 `uTex`（保留现有 uniform 初值即可）。
2. `src/render/mapViewer.ts` 的 `splatLoader`
   - 先按 tileset 归档解析（保持现有行为），失败后回落到 `vfsImage(this.vfs, p)`（HD 感知）。

### 验收

- 选中农民/步兵/城镇大厅：脚下出现对应队伍色选择圈，随镜头与缩放正确贴合地面。
- 不同地表（草地/泥土/水边）都能看到圈。
- 悬停（hover）圈与建造预览圈同样恢复。
- `npx tsc --noEmit` 通过。

---

## 缺陷 1：金矿不渲染（需一次运行时取证后落修）

### 已排除

- `ngol` 的数据行完整：`tools/hd-probe.mjs` 可解析 `buildings\other\GoldMine\GoldMine.mdx`，其 HD 贴图（Diffuse/Normal/ORM/Emissive）均能映射到 `.dds`。
- `Units/UnitUI.slk` 的 `ngol` 行有 `file` 列（`buildings\other\GoldMine\GoldMine`），用 `MappedData` 复现 `mdx-m3-viewer` 的合并结果，`getRow('ngol').string('file')` 非空 —— **「unitsData 缺 file」不成立**，viewer 会去加载该模型。
- `hideStartLocations()`（`src/render/mapViewer.ts:5991`）只隐藏 `!u.row`（`sloc`），金矿有 row，不会被它隐藏。
- 矿被隐藏只有一种业务路径：`claimMineWidget()`（被缠绕/闹鬼金矿建筑占用）；开局无该建筑。

### 待取证（第一步，只加临时日志，不进最终提交）

在 `src/render/mapViewer.ts` 地图就绪处（`loadMap` 之后、相机就位前）打印 `ngol` 的 widget 状态：

```ts
const w = (this.viewer as any).map.units.find((u: any) => u.unit.id === "ngol");
console.log("[mine]", w && {
  hasWidget: true,
  scene: !!w.instance?.scene,
  seq: w.instance?.sequence?.name,
  scale: w.instance?.localScale,
  visible: w.instance?.rendered,
  loc: w.unit.location,
});
```

同时观察控制台是否出现 `Unknown unit ID ngol`（若出现，则回到 file 分支）。

### 三个分支与对应改法

| 取证结果 | 根因 | 改法 |
| --- | --- | --- |
| `w` 为 `undefined` / 控制台 `Unknown unit ID` | viewer 未生成 widget | `loadMap` 前用 registry 补 `unitsData` 行的 `file`（`row.set('file', def.model.replace(/\.(mdx|mdl)$/i,''))`，见 `repairCustomRowIds` 的写法） |
| `hasWidget`、`scene` 为 false | widget 未入场景 | 在 map 单位接管处（`stampMapUnits`）补 `instance.setScene(map.worldScene)` 并登记到雾效循环 |
| `hasWidget`、`scene` 真、`visible` 假 | 被雾效/可见性同步隐藏 | 修正 `fogWidgets` 的成员判定：`world.mines` 中的矿不算「非本方单位」，按中立静态物处理 |
| 全部正常 | 材质/序列问题 | 打印 `instance.sequence.name` 与材质层 alpha；必要时对矿强制 `Stand` 序列、跳过 `teamColor` 替换 |

### 验收

- EchoIsles 开局即可看到金矿模型与 NGOL 地面贴花叠在一起；选中矿时模型、选择圈、信息面板同时正常。
- 矿被采空后播放死亡并消失，贴花一并移除。
- 其他预放置单位（野怪/商店/雇佣兵）渲染不受影响。

---

## 缺陷 2：加载进度条无文字

### 现状

- 3.0 加载屏：`src/ui/hd/loading.ts` 构造 `.LoadingScreen-BarText`（文字取自 `t("hd.loading")`），CSS 在 `src/ui/hd/official.css`（`bottom: 6.5%`，位于 `.LoadingScreen-CenterLoadingColumn` 内，`z-index: 4`）。
- 1.30 加载屏：`src/ui/loadingScreen.ts` 把 `LoadingBarText` 锚到 `0.057 - BAR_TEXT_NUDGE`。
- 两者目前都看不到文字，说明不是单纯「文本为空」。

### 待取证

加载时执行：

```js
document.querySelector(".hd-official.LoadingScreen")        // 用的是哪套
document.querySelector(".LoadingScreen-BarText")?.textContent
document.querySelector(".LoadingScreen-BarText")?.getBoundingClientRect()
getComputedStyle(document.querySelector(".LoadingScreen-BarText")).color
```

### 分支与改法

| 结果 | 改法 |
| --- | --- |
| HD 屏存在，rect 在视口外 / 与蓝条重叠且被遮挡 | 把 `.LoadingScreen-BarText` 移到蓝条正上方（`bottom` 上调，padding + text-shadow），保证不与 `bottom_center_goth_piece.png` 的暗部重合 |
| HD 屏存在，文字空 | 补 `hd.loading` 翻译键或改用 `t("loading")` 兜底 |
| 使用 FDF 加载屏 | 修 `buildLoadingRoot` 的 `SetPoint`（去掉被推离画面的 nudge）并确认 `textOverrides` 命中 `LoadingBarText` |

### 验收

- 进入对局/切换地图时，蓝条上方稳定显示「载入中 / LOADING」，切语言仍正确。
- 不同窗口尺寸（含 1280×720 与全屏）都不被裁切。

---

## 缺陷 4：建造与农民无音效

### 已具备

- `SoundBoard`（`src/audio/sounds.ts`）有 ACK/AnimSounds 表解析、`playVoice(label, category)`、`playUi`、`repairBlowTimes`。
- `tools/sim-work-sound-test.cjs` 全绿：AREP → `Repair` 标签 → 三连锤 WAV，说明**表与解析逻辑本身正确**。
- 建造作业锤由 `tickWorkBlow` 按模型 SND 事件触发；`setLoop()` 已实现但**全仓无调用点**。

### 待取证

对局中执行：

```js
// 1) 音频上下文是否 running
// 2) 表是否加载（ack / anim）
// 3) 解析是否拿到 clip
```

若都正常，直接试听 `sounds.play("Peasant", "What")`。判别：

| 结果 | 根因 | 改法 |
| --- | --- | --- |
| 表为空 / clip 解析 null | 运行时 VFS 读不到表或 WAV（HD 懒加载通道） | 音频表与 WAV 走与模型相同的 solver/预加载通道；`loadTable` 失败时打日志而不是静默 |
| 表正常、clip 正常但无声 | 音频通道 UNITS/UI 组静音（`options.ts` 的 `unitSounds`/`sfx` 组增益） | 修正组增益默认值与 `applyAudioOptions` 调用时机 |
| 农民语音始终为空 | `def.soundSet` 为空 | 在 `data/units.ts` 的 `unitSound` 缺失时用 `unitid` 兜底（Peasant 等） |
| 只有建造无声 | 建造循环从未调用 `setLoop` | 在建造成员处 set/stop 循环音（建造开始 → 循环；完成/取消/死亡 → stop） |

### 验收

- 选中农民触发 `Yes/What` 语音；移动/建造/采集命令有确认音。
- 放置建筑有放置音；施工期间有作业锤音；完成时停止。
- 关闭「单位音效」选项能静音，再打开恢复。
- 无声卡/未解锁时控制台给出一次明确提示，不刷屏。

---

## 非目标

- 不改 HUD/控制台皮肤、主题切换、左侧贴边等已完成项。
- 不引入新的外部依赖；沿用现有 VFS/音频设施。

---

# 第二批：血法师美术 / 物品与攻击特效 / 掉落物渲染

日期：2026-11-15 20:00　对局内反馈（HD 3.0，`hdArt=de`）。范围：`src/sim/world.ts` 的物品施放、`src/data/abilities.ts` 与 `src/data/items.ts` 的 3.0 美术解析、`src/render/mapViewer.ts` 的弹道与地面物品。**不改**已完成的 T1–T16。

用户报告与判定（读代码/数据能定的直接定，不能定的先取证）：

| 编号 | 用户原话 | 判定 |
| --- | --- | --- |
| D1 | 这个血法师一身黑，正常吗？ | 待取证（可能是 DE 美术本色，也可能是贴图未解析） |
| D2 | 买物品吃魔法恢复没有特效 | **缺陷（已定位）** |
| D3 | 使用传送符也没有特效 | 待取证（链路存在，疑美术字段为空或模型缺失） |
| D4 | 血法师攻击没有特效的吗？ | 待取证（SD 数据有 `BloodElfMissile.mdx`，疑 DE 缺模型或渲染未消费） |
| D5 | 打野怪掉落的物品渲染有问题 | 待取证（疑 3.0 把 `ItemData.file` 拆成按档列） |

## 实测结论（T17，已按此落修）

| 编号 | 实测 | 落修 |
| --- | --- | --- |
| D1 | DE 下血法师 10 张贴图全部命中、无 MISS/无特殊 DXGI；独立查看器同模型颜色正常，黑袍是美术本色（立领为队伍蓝） | 不改代码（本表 R5 第三档） |
| D2 | `itemRestore()` 从不发 `spellEffects`；`AIma/AIhe` 的 `targetArt` 非空 | R1：逐受术者发 `targetArt` |
| D3 | `AItp` 四个美术字段非空、模型存在；真因是 DE 的 `MassTeleportTo/Caster/Target` 为 0 geosets 空壳 | R2 第四档 → 由 D4 的 base 回退修复 |
| D4 | `BloodElfMissile.mdx`：sd 5904B/2 geosets，hd/de 1956B/0 geosets（只有 VERS/MODL/SEQS/PIVT/CORN/EVTS/BPOS）；同类空壳还有 Bandit/Banshee/SpellThief 弹道 | 新分支：美术模块覆盖 base 时，0 geosets 模型回退 `War3.mpq` 副本（`CascDataSource.baseBytes` + `assetSolver.mdxHasGeosets`） |
| D5 | 3.0 `ItemData.slk` 无 `file`/`scale` 列；`Units\itemSkin.txt` 有裸 `file`/`scale`（无按档键） | R4 新分支：读 `itemSkin.txt`，裸列优先，`scale` 缺失回落 1；模型不存在仍回落宝箱 |

## 已核实（不含推测）

### D2 — 魔法药水/治疗药水完全没有特效（确定根因）

- `useItem` 的 instant 恢复族在 `src/sim/world.ts:27097-27101` 全部进 `itemRestore()`。
- `itemRestore()`（`src/sim/world.ts:27613-27624`）只改 `t.hp` / `t.mana` 并返回是否真的恢复，**一次 `spellEffects.push` 都没有**。
- 数据侧这些行是有美术的（1.30.4 表，`Warcraft III zhCN/ExtractedData/merged/Units/ItemAbilityFunc.txt`）：

  ```ini
  [AIma]  Targetart=Abilities\Spells\Items\AIma\AImaTarget.mdl   Targetattach=origin
  [AIhe]  Targetart=Abilities\Spells\Items\AIhe\AIheTarget.mdl   Targetattach=origin
  ```

  即「数据给了模型，模拟层从来没播」。`AIha`（治疗卷轴）、`AImr`（法力卷轴）、`AIra`（恢复卷轴）同理。
- 对照：持续恢复族 `AIrg`（`src/sim/world.ts:27123-27180`）通过 `buffFx` 有可见效果，所以用户只注意到「瞬间恢复的药水/卷轴什么都没有」。

### D3 — 传送符：效果链路完整，但不是「没有」就是「字段为空」

- 按下：`itemTownPortal`（`src/sim/world.ts:27682-27688`）→ `beginTeleport`（L27717）→ 5 秒 `Cast1` 频道。
- 频道期间：`activeTeleports()`（L27923-27937）取 `abilities.get(portalAbil).areaArt`，**`art` 为空直接 `continue`**；渲染侧 `collectTeleportFx()`（`src/render/mapViewer.ts:8263-8273`）用 `trackBuffFx(..., ground=true)` 维持 `MassTeleportTo.mdx`。
- 抵达：`resolveTeleport()`（L27888-27896）按 `casterArt`/`specialArt` 播 `MassTeleportCaster.mdx` / `MassTeleportTarget.mdx`。
- 数据侧三件模型都在（`ItemAbilityFunc.txt`）：

  ```ini
  [AItp] Casterart=…\MassTeleport\MassTeleportCaster.mdl
         Targetart=…\MassTeleport\MassTeleportTarget.mdl
         Specialart=…\MassTeleport\MassTeleportTarget.mdl
         Areaeffectart=…\MassTeleport\MassTeleportTo.mdl
  ```

- 唯一会「全程一个模型都不出」的情形：**这四个字段在 3.0 解析成空串**。`src/data/abilities.ts:1417-1423` 的注释说明 3.0 把美术从 AbilityFunc 搬进 `Units\abilitySkin.txt` 并直接 `func.load(skin)` 合并——皮肤行若把某字段写成空值，就会把 AbilityFunc 的原值**覆盖成空**（`MappedData` 按 key 覆盖），且没有任何兜底。

### D4 — 血法师远程攻击：数据侧有弹道，疑 DE 模型或渲染消费

- SD 表实测（用 `.sim-build` 的 `loadUnitRegistry` 读 1.30.4 数据）：

  ```text
  == Hblm 血魔法师 model= units\human\HeroBloodElf\HeroBloodElf.mdx
  slot0 enabled weaponType=missile  missileArt=Abilities\Weapons\BloodElfMissile\BloodElfMissile.mdx  speed=900 range=600
  summary missileArt=Abilities\Weapons\BloodElfMissile\BloodElfMissile.mdx
  ```

  所以 `slotMissileArt()`（`src/data/units.ts:936-938`，`isRangedWeapon` 为真才返回 art）对血法师是生效的，模拟层也应该在 `spawnProjectile` 里带上 `missileArt`。
- 剩下两处可疑：①3.0 的 DE 美术层里 `Abilities\Weapons\BloodElfMissile\BloodElfMissile.mdx` 不存在（`viewer.load` 返回 null，弹道静默不画）；②`src/render/mapViewer.ts:10359-10395` 的 `updateProjectiles()` 对弹药模型的加载/回收有提前 return。

### D5 — 地面掉落物：模型列可能被 3.0 拆档

- `src/data/items.ts:218` 读的是裸列 `file`，`:265-269` 的 `itemModel()` 在空值时回落**宝箱** `treasurechest.mdx`；`:219` 的 `scale` 读裸列 `scale`。
- 1.30.4 的 `ItemData.slk` 确有裸 `file`（已核）；3.0 的 Unit/Ability 表都把美术拆成 `file:sd|hd|de` / 皮肤文件（见 T2、T14、`abilities.ts:1417` 注释），**ItemData 很可能同样处理**。若如此，所有掉落物都会静默回落成同一个宝箱模型——正是「渲染有问题」。
- 渲染侧 `spawnItemModel()`（`src/render/mapViewer.ts:7273-7320`）本身没有明显错误：用 `def.model`、`def.scale`、`groundHeightAt`、Birth→Stand 交接。

### D1 — 血法师发黑

- 运行期英雄不走 `seedUnitModels()`（`src/render/mapViewer.ts:6110-6134`，它只补 `viewer.unitsData` 里**地图预放置**单位的 `file/modelScale/red|green|blue`），所以 T2 的黑模型修法**覆盖不到英雄**。
- 排版上能看到的两种成因，只能靠取证区分：
  - 模型贴图在 DE 层解析不到（`hdTexturePaths` 的候选不全 / DDS 格式不支持），未贴图材质按黑色画——能解释「只有立领/披风有颜色」；
  - 材质 `replaceableId 1`（队伍色）没有被 `setTeamColor` 填上，整块黑袍按 0 画成黑。

## 前置取证（一次性脚本，完成后删除）

新建 `.tmp-defects-probe.mjs`，直接复用 `tools/hd-probe.mjs` 的挂载段（L12-137：CASC `graphics:"de", lazyArt:true` + `vfs`），追加：

1. **能力美术**：`loadAbilityRegistry(vfs)`，对 `AIma / AIhe / AIha / AImr / AIra / AItp / AHmt` 打印 `{code,targetArt,casterArt,specialArt,areaArt,effectArt,isItem}`，并对每个非空路径打印 `vfs.exists`。
2. **咒语皮肤是否覆盖物品行**：直接 `vfs.read("Units\\abilitySkin.txt")`，打印其中是否存在 `[AItp]` / `[AIma]` 小节及其 `Targetart/Casterart/Specialart/Areaeffectart` 行（判断是否「空值覆盖」）。
3. **血法师**：`loadUnitRegistry(vfs).get("Hblm")` 打印 `model / modelScale / weapons[].{weaponType,missileArt,missileSpeed}`；`vfs.exists(model)`、`vfs.exists(missileArt)`；用 `MdlxModel` 解析 `model`，对每个 texture 打印 `hdTexturePaths` 的命中路径与 DDS 头（fourCC / DX10 `dxgiFormat`）。
4. **物品模型**：`loadItemRegistry(vfs)` 打印 `pman / ratf / ankh / tret / gcel` 的 `{model,scale}` 及 `vfs.exists(model)`；并打印 3.0 `Units\ItemData.slk` 的列名集合（是否存在 `file` 与 `file:sd|hd|de`），以及 `vfs.exists("Units\\itemSkin.txt")`。

**脚本与日志在取证后删除**（与 T2–T16 的惯例一致），不留在提交里。

## 修复项

### R1（D2，确定）：瞬间恢复类物品播 `Targetart`

`src/sim/world.ts` 的 `itemRestore()`，在**每个真正被恢复了数值的受术者**身上发一次该行自己的 `Targetart`（不是发在施法者脚下，也不是只发一次）：

```ts
for (const t of this.itemAreaTargets(u, ad)) {
  let restored = false;
  if (hp > 0 && t.hp < t.maxHp) { t.hp = Math.min(t.maxHp, t.hp + hp); did = true; restored = true; }
  if (mana > 0 && t.mana < t.maxMana) { t.mana = Math.min(t.maxMana, t.mana + mana); did = true; restored = true; }
  if (restored && ad.targetArt) {
    this.spellEffects.push({ art: ad.targetArt, x: t.x, y: t.y, targetId: t.id, z: 0 });
  }
}
```

- 单目标药水 = 喝药的人身上一团 `AImaTarget/AIheTarget`；范围卷轴 = 每个被治疗/回蓝的单位各一团（与 T13 里 `AItp` 每个旅行者各一团同一思路）。
- `targetId` 让渲染层把模型跟住单位（`spawnEffect` 已支持 follow）。
- 不新增音效：这些行没有 `Effectsound`，与其余物品特效一致（`emitEffectAt(..., sound=false)` 语义相同）。

### R2（D3，按取证结果二选一）

| 取证结果 | 根因 | 改法 |
| --- | --- | --- |
| `AItp` 的 `areaArt/casterArt/specialArt` 为空 | `abilitySkin.txt` 的空值覆盖了 AbilityFunc 原值 | `src/data/abilities.ts`：`abilitySkin.txt` 载入**独立的** `MappedData`（不再 `func.load` 合并），新增局部 helper `skinOr(field)`：皮肤值非空取皮肤，否则回落 `func`（`ItemAbilityFunc.txt` 原值）。只覆盖 `missileArt / targetArts / targetArt / casterArt / specialArt / effectArt / areaArt / animNames` 八个字段的读取点（L1508-1541），其余字段不动 |
| 字段非空、`MassTeleport*.mdx` 在 DE 层 `exists=false` | 3.0 把这些效果模型换名/移位 | `src/vfs/tileset.ts` 增加**模型**候选解析（现有 `hdTexturePaths` 只管贴图）：`Buildings|Abilities|Units` 下的 `X.mdx` 追加 `X_DE.mdx` / `_HD` 候选；`mapViewer` 的模型加载点走同一 helper |
| 字段非空、模型存在、仍无任何模型 | 渲染未消费 | 核 `collectTeleportFx` 的 `trackBuffFx(..., ground=true)` 在 `active` 集合里的键是否被同一帧清掉；核 `activeTeleports()` 的 `art` 是否被 `SpellFieldView` 之外的路径读到 |

三档都不成立时，如实告知：频道期间的效果是 `MassTeleportTo.mdx` 的 Birth→Stand→Death，需站定看完 5 秒才会看到抵达爆点。

### R3（D4，按取证结果）

| 取证结果 | 改法 |
| --- | --- |
| `vfs.exists(missileArt) === false`（DE 层没有 `BloodElfMissile.mdx`） | 同 R2 的模型候选 helper：`mapViewer` 加载弹药模型时走候选链；命中即恢复弹道 |
| 模型存在，`updateProjectiles()` 里 `simView.projectiles` 为空 | 核 `src/sim/world.ts` 的 `spawnProjectile` 是否因 `slotMissileArt()` 之外的另一道 `weaponType` 判断丢掉了 art；按 `launchesMissile` 放行 |
| 模型存在、弹道数组非空 | `mapViewer.ts:10359-10395`：核提前 return（模型未 ready 的同一帧是否被丢弃而不是保留 pending），改为与 `spawnEffect` 相同的「按 path 缓存 + 加载中挂起」 |

### R4（D5，按取证结果）

| 取证结果 | 改法 |
| --- | --- |
| 3.0 `ItemData.slk` 有 `file:sd|hd|de`、无裸 `file` | `src/data/items.ts`：按当前美术档取列（照 `units.ts` 的 `${art}` 链：`file:de → file:hd → file`，`art==="sd"` 时 `file:sd → file`），`scale` 同理加 `scale:*` 链；空值仍回落宝箱 |
| 有裸 `file`、模型 `exists=false` | 模型候选 helper（同 R2） |
| 模型与路径都正常 | 核 `def.scale` 是否被 3.0 拆档成 0（会缩成不可见）与贴地 z；必要时 `spawnItemModel` 读不到缩放时用 1 |

### R5（D1，按取证结果）

| 取证结果 | 结论/改法 |
| --- | --- |
| 有贴图 `MISS` | 补 `vfs/tileset.ts` 的候选（重定位前缀 / `.dds` 变体）；若 DDS 的 `dxgiFormat` 是解码器不支持的类型（BC5/BC7/DX10），在 `render/blputil.ts` / 贴图上传处补齐解码或降级为 RGBA |
| 贴图全 ok、材质含 `replaceableId 1` 且队伍色材质不存在 | 与 T2 同一修法，但落在**运行期模型**：`mapViewer` 创建单位实例处补 `setTeamColor`/缺省队伍色材质 |
| 贴图全 ok、材质无队伍色、渲染管线正常 | **不是缺陷**：DE 血法师本来就是黑袍 + 立领（与信息面板头像一致），如实告知用户 |

## 验收

- 喝魔法药水/治疗药水：英雄身上出现对应一团模型；卷轴对每个受益单位各一团；数值仍按原规则恢复，满蓝/满血时仍不消耗次数。
- 传送符：按下后英雄与目标大厅各出现 `MassTeleportTo` 持续 5 秒，抵达时出发地/落点各有一团爆点。
- 血法师攻击：对空/对地都能看到 `BloodElfMissile` 从法杖飞向目标，命中消失。
- 野怪掉落：掉落物显示自己的地面模型（不是统一宝箱），尺寸/贴地正确，拾取后消失。
- 血法师外观：按 R5 结论给出明确答复（修复后可见，或说明为 DE 美术本色）。
- `npx tsc --noEmit` 通过；临时取证脚本与日志已删除。

## 非目标

- 不重做 T1–T16 已完成项（选择圈/金矿缩放/加载屏/音效/预载/美术档开关/进度条收口）。
- 不为「让画面好看」新增美术资源或动画；只接通数据里已有的模型。
- 不改多人同步协议；`spellEffects` 仍走既有 drain 通道。
