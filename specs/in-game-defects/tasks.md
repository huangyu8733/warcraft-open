# 任务清单：对局内 4 项缺陷

依赖顺序：先做已定根的 #3，再取证 #1/#2/#4，最后统一回归。

## T1 选择圈恢复（缺陷 3）

- [x] `src/render/uberSplatOverlay.ts`：`render()` 中 mask 记录不再因 `resolveTexture` 为 null 而 `continue`；mask 分支跳过纹理绑定。
- [x] `src/render/mapViewer.ts`：`splatLoader` 在 tileset 归档解析失败后回落 `vfsImage(this.vfs, p)`（HD 感知）。
- [x] 验证：选中农民、步兵、城镇大厅均出现队伍色圈；hover/建造预览圈恢复。

## T2 金矿取证（缺陷 1）

- [x] 取证：`ngol` 行在 3.0 的 `unitSkin.txt` 里只有 `modelScale:sd|hd|de`，没有裸 `modelScale`；Unit 构造读裸列得到 0 → `uniformScale(0)`，widget 存在但不可见。
- [x] 落修（`mapViewer.seedUnitModels`）：按图形风味补裸 `modelScale`，并补齐缺失的 `red/green/blue`（缺失即 0，会把单位刷成黑色）。
- [x] 删除临时日志/探针脚本。
- [x] 验证：EchoIsles 开局金矿模型可见（采金标识 1/5 + 血条同位置），选中信息面板正常。

## T3 加载文字（缺陷 2）

- [x] 取证：3.0 走 `hd/loading.ts`；`.hd-official.LoadingScreen` 的 `z-index: 6` 低于 `#loading` 画布（8），整层 DOM 文字（进度条标题、地图名、玩家名单）被不透明画布盖住。
- [x] 修复：`.hd-official.LoadingScreen` 提到 `z-index: 9`，与 FDF 加载层一致。
- [x] 验证：加载界面进度条上方显示「载入中」，地图名「埃克岛」与名单可见。

## T4 音效（缺陷 4）

- [x] 取证：本安装 `UnitUI.slk` 无 `unitSound` 列（移到 `unitSkin.txt`）；`UnitAckSounds` 的 FileNames 是裸名（无 `DirectoryBase`），且语音被放在模型美术目录（`Units\Human\Peasant\PeasantWhat1.ogg`），不是 `Sound\...\*.wav`。
- [x] 修复：`data/units.ts` 的 `soundSet` 回落 `unitSkin`；`audio/sounds.ts` 增加全档案基名索引解析裸名、`decode` 对 `.wav` 回落 `.flac/.ogg`、`wavIndex` 收 `.flac/.ogg`。
- [x] 验证：`PeasantWhat1/Yes1/Ready1` → `Units\Human\Peasant\*.ogg`（OggS，18–28KB）；`PlaceBuildingDefault` → `BuildingPlacement.flac`（85KB）；`sim-work-sound-test` 全绿。

## T5 回归

- [x] `npx tsc --noEmit` 通过。
- [x] `node tools/sim-work-sound-test.cjs` 仍全绿。
- [x] 浏览器：`?dev&map=EchoIsles&flavor=hd&race=human` 走一遍开局、加载屏、选中；无控制台报错。

## T6 加载界面版式（跟进反馈）

- [x] 取证：地图信息仍按原居中布局压在美术上，并与右下的玩家名单在同一水平带里重叠；小地图 128px 顶到顶部哥特装饰。
- [x] 修复（`src/ui/hd/official.css`）：`LoadingScreen-Map-Details` 改左侧列（`left:4.5% / top:26%`、左对齐、`max-width:min(420px,36%)`）；`LoadingScreen-Roster` 固定右列（`right:4.5% / top:26%`、`width:min(330px,30%)`）；小地图 160px、14px 画框。
- [x] 验证：浏览器截图确认左列地图名/描述、右列玩家名单互不重叠，小地图不再顶到装饰。

## T7 农民建造锤音（跟进反馈）

- [x] 取证：`tickWorkBlow` 探针输出 `period 0`。根因不在模型/表链（3.0 `Peasant.mdx` 确有 `SNDXAREP` = 191567/192467/193367，`AnimLookups AREP → Repair` 也成立），而在 HD 挂载把 `.mdx` 列为 `LAZY_ART`：`CascDataSource.read()` 走异步取字节且**不缓存**，`rawBytes()` 对未预载模型永远返回 null，`resolveModelSounds` 因此拿不到事件（所有模型内嵌音效——锤音、枪声、导弹、出生音——在本安装上一起哑掉）。
- [x] 修复：`src/vfs/casc.ts` 为模型（`.mdx/.mdl`）保留 `read()` 已取到的字节（`modelBytes`，64 MiB FIFO），`rawBytes()` 命中它；`src/audio/sounds.ts` 的 `resolveModelSounds` 不再把「暂时没有字节」缓存成空结果。
- [x] 验证：node 以 `lazyArt:true` 复核真实 3.0 安装：`rawBytes` 读前为 null、`read()` 后 140367 字节，`AREP → [191567,192467,193367]`，`eventCycle` 得 `period 0.6 / phase 0.234`；`tsc --noEmit` 与 `sim-work-sound-test` 全绿。
- [x] 删除临时探针（`[sfx-probe]` 与 `.tmp-*.cjs`）。

## T8 地图全量资源预载（跟进反馈）

- [x] `mapViewer.preloadForStart`：以场上单位为种子、沿 `builds/trains/upgradesTo` 求闭包（上限 400 型），预载全部单位/建筑/召唤物模型与每个技能（含英雄技能、buff、missile、target/caster/area/fx art）的模型；模型 parse 结果交给 `SoundBoard.registerModel` 供 SND 事件链复用。
- [x] `SoundBoard.warmUnits`：解析每种单位的语音（What/Yes/YesAttack/Pissed/Warcry/Ready/Death）、武器/伐木音 × 全部材质、模型内嵌 SND 事件，逐条校验存在并在**加载屏内**抓完全部字节（不再有 3 s 截止、不再后台补），字节预算见 T10（128 MiB）。
- [x] 取证（3.0.1 真实安装，浏览器）：档案共 53952 条，音频只有 `.ogg` 6955 + `.flac` 629（无 `.wav`），且 `PeasantDeath1`→`PeasantDeath.ogg`、`BloodElfDragonHawkWhat1`→`DragonHawkWhat1.ogg` 两种改名。
- [x] 修复（`src/audio/sounds.ts`）：`soundFileFor` 三种音频扩展名互查；`resolveSoundName` 对裸名追加「去尾部序号」与「CamelCase 后缀」两种归档基名匹配（死亡哭喊、龙鹰语音因此找回）。
- [x] 验证：`[Warcraft Open] preloaded 194 model(s) for 86 unit type(s) and 783 sound clip(s) (308 held) in 18141ms (drain 249 / models 13451 / textures 1378 / sounds 3064).`，`not in this install` 由 182 → **0**，控制台无 error；`tsc --noEmit` 通过。

## T9 预载必须在加载屏内完成（跟进反馈）

- [x] 去掉「加载屏结束后后台补声音」：`warmUnits` 不再带截止时间，全部字节在屏内抓完，进度条最后一档按已抓条数推进。
- [x] 收起「首帧后才出现」的模型：闭包补上法术 `unitid` 召唤单位与变形形态（水元素、幽灵狼、哨塔、熊/枭兽形态等），这些没有建筑会 `trains`，原先只会在首次施法时才加载。
- [x] 加载屏落下前加最后一道 `promiseMap` 闸门，排空声音阶段新产生的模型/纹理读取。
- [x] 核实「晚出现的建筑」：`hpea.builds` 含 `hhou`，农场模型 `buildings\human\Farm\Farm.mdx` 在预载闭包内；对局中再调用 `viewer.load` 是缓存命中，不会重新解析。

## T10 经典版 / 重制版隔离检查（跟进反馈）

- [x] flavor 单一来源（`src/data/flavor.ts`）：一次进程只有一个版本，切换只能整页重载；所有数据模块的解析结果按版本缓存，杜绝运行中混用。
- [x] 数据层隔离：SD 只从 1.30.4 安装读，HD 只从 3.0 安装读；`vfs/loader` 的版本闸门会拒绝错配安装（实测 `flavor=sd` 打开 3.0.1 文件夹直接报错、不进入对局）。
- [x] 美术层隔离：HD 才挂 `_HD/_DE` 图形模块并开 `lazyArt`；SD 走降级/补丁覆盖，闭包里的 HD 皮肤（`u.skinId`）也按 `isHd()` 跳过，避免经典版预热只在重制版存在的模型。
- [x] UI 隔离：`hd.css` 与 `official.css` 的所有选择器都限定在 `.hd-*` / `.hd-official` 下（逐条核查无裸 `html/body/*` 选择器）；`official.css` 只由 `src/ui/hd/*` 注入；HD 屏幕挂在 `body` 并随 `dispose` 移除，经典 UI 仍在 `#ui`；加载屏共用的 `body.loading-screen` 由各自 `dispose` 移除。
- [x] 声效预算 64 → 128 MiB：经典版 973 条 WAV 约 80 MB，旧上限会丢掉 154 条导致首次播放再读；现两版都能全量持有。
- [x] 验证（浏览器）：SD `[flavor-diag] sd hdStyle=false hdScreens=0 ui=true`，`preloaded 207 model(s) … 973 sound clip(s) (973 held) in 2696ms`；HD `hdStyle=true`，`preloaded 206 model(s) … 818 sound clip(s) (818 held) in 19140ms`；两版均无 `not in this install`、无 console error。

## T11 HD 美术风格切换开关（跟进反馈）

- [x] `src/ui/hd/options.ts`：Video 页顶部新增「美术风格」行（`hdArt` 的 `de/hd` 两档），此前该开关只有 URL / localStorage 两条门、设置里没有入口。
- [x] 切换即 `setHdArt()` + 确认框（说明需重载）→ 确定后 `saveOptions()` 提交当前工作副本并 `location.reload()`；取消把下拉框恢复为当前档。
- [x] i18n（`src/i18n/index.ts`）：`hd.artStyle / hd.artDe / hd.artHd / hd.artReload`，中英双语。
- [x] 验证：`npx tsc --noEmit` 通过；浏览器（5173，`?dev&flavor=hd`）Options → 图像：美术风格行与「决定版/重制版」下拉可见，切换弹出确定/取消确认框，控制台无 error。

## T12 重制版切换界面时闪经典版（跟进反馈）

- [x] 取证：两套 UI 的 DOM/CSS 确实独立（HD 挂 `body` 的 `.hd-screen`，SD 在 `#ui`），但共用 `ui/glue.ts` 的过渡器；HD 屏是全窗口不透明图，`goTo` 却在 120 ms 空档前就 `dispose` 了旧屏，露出的正是其下仍在运行的经典 3D 主菜单场景（`show("none")` 之前 `#menubg` 画布一直可见），所以点按钮会闪一下经典版。
- [x] 修复（`ui/glue.ts`）：`noChrome` 屏改为「旧屏保持站立，等新屏同一帧覆盖后再 `releaseHeld()`」；经典屏仍按原逻辑立即 `dispose`。
- [x] 同一根因的出发路径：`leave()`（开始对局）同样把 HD 屏改为暂存，加载屏显示后再由 `main.ts showLoadingScreen` 释放，避免加载图出现前闪经典菜单。
- [x] 验证：`npx tsc --noEmit` 通过；浏览器（5173，`?dev&flavor=hd`）主菜单→选项→返回→单人游戏，每次落屏后 `.hd-screen` 恰好 1 个，控制台无 error。

## T13 重制版录像删除（跟进反馈）

- [x] 现状：经典版早就有删除（`ui/fdfViewReplay.ts` 高亮行上的垃圾桶 + `DELETE_REPLAY_MESSAGE` 询问）；HD 的 `ui/hd/replay.ts` 只有「查看录像」，没有删除入口。
- [x] `src/ui/hd/replay.ts`：动作行加「删除」按钮（选中即可用，不要求录像可解析），弹确认框后 `sink.remove()`，成功则从列表移除、清空选中与头部缓存；失败弹提示。
- [x] i18n：`hd.deleteReplay / hd.deleteReplayConfirm / hd.deleteReplayFailed`（中英）。
- [x] `src/ui/hd/official.css`：动作行两个按钮之间 10px 间距。
- [x] 验证：`npx tsc --noEmit` 通过；浏览器（5173，`?dev&flavor=hd`）选中 `.replays/zz-delete-test.o3r` → 删除 → 确认，行消失且文件从磁盘移除；`/replays/delete` 端点实测只删一个文件。

## T14 3.0 的第三套美术：CLASSIC（跟进反馈）

- [x] 结论：3.0 客户端 Graphics 里的 CLASSIC / REFORGED / DEFINITIVE 对应 store 的 基础模块 / `_HD.w3mod` / `_DE.w3mod` 三套，`CascGraphics` 早已是 `"sd" | "hd" | "de"`，只是 UI 只暴露了两档。
- [x] `src/data/flavor.ts`：`HdArt` 扩为 `"sd" | "hd" | "de"`，`?hdArt=sd` / localStorage 可存；注释写明 `"sd"` 是「3.0 数据 + 经典美术、前端仍是重制版」，与 `flavor=sd`（1.30.4 数据 + 经典 FDF 前端）不同。
- [x] `src/data/units.ts`：`art === "sd"` 时模型/图标走 `file:sd` → `file`（不回落 `file:hd`，否则会静默换成 HD 模型）；`modelScale:sd` 由原有 `${art}` 链覆盖。
- [x] `src/ui/hd/options.ts` + i18n：Video → 美术风格改为三档「经典 / 重制版 / 决定版」（`hd.artSd`）。
- [x] `src/ui/consoleUi.ts`：经典美术沿用 SD 瓦片测得的 0.1317 上沿（`de` 仍 0.1383）。
- [x] 验证：`npx tsc --noEmit` 通过；浏览器（5173，`?dev&flavor=hd&hdArt=sd`）主菜单 WebUI 美术完整（base 模块自带 WebUI，无 “HD art missing”）、Video 下拉显示「经典」；`&map=EchoIsles&race=human` 开局 206 个模型、农民/步兵/城镇大厅为经典低多边形，无致命错误；仅有 2 个 DE 专属挂件（SpikedShellTargetChestLeft/Right）与 5 个音效在 base 里不存在。

## T15 切档后 HUD 风格不变（跟进反馈）

- [x] 取证：HUD 贴图确实随档位换（同一逻辑路径由不同模块覆盖）：`UI\Console\Human\HumanUITile01.dds` 经典 349,680 B / DE 1,398,256 B；`Peasant.mdx` 141,031 / 1,640,270 B。3.0 store 只有 **一套** `ConsoleUI.fdf`、`ResourceBar.fdf`、`UpperButtonBar.fdf`、`war3skins.txt`（全在 `War3.mpq`，HD/DE 模块均不提供），所以三档只换贴图/模型，控制台版式（7 切片 + 05/06 翼、0.8 盒）不变。
- [x] 根因：`flavor.ts` 的 `?flavor= / ?hdArt=` 直链参数每次加载都压过 localStorage；从带 `hdArt=sd` 的地址进来后，在 Video 里改成重制版/决定版会写 storage 再 `location.reload()`，重载又被 URL 改回 `sd`——表现为「切了档但 HUD/模型还是经典」。
- [x] 修复（`src/data/flavor.ts` `forgetUrlSwitch()`）：切档提交时先从地址栏删掉对应参数再重载；`ui/hd/options.ts`（`hdArt`）与 `ui/gate.ts`（`flavor`）都接上。
- [x] 验证：`npx tsc --noEmit` 通过；浏览器（5173）从 `?dev&flavor=hd&hdArt=sd` 进 Options → 图像 → 决定版 → 确定，重载后 URL 为 `?dev=&flavor=hd`、下拉显示决定版、`localStorage.warcraft-open.hdArt="de"`，无 error。

## T16 建造进度条两端金色收口（跟进反馈）

- [x] 取证（用户截图，DPR 1）：进度条 259×28，与「面板 407.1×248 + `left 30.4% / right 6% / height 13%`」算出的 258.9×28.05 完全一致；右端 x=424…439 十六列像素完全相同、上下框线在此平切，左端 x=181…188 有斜角收口 —— 即**右端缺收口**，左右不对称。
- [x] 贴图核查：3.0 的 base（128×16 `human-buildprogressbar-border.dds`）、`_HD` / `_DE`（256×32，左帽列 0…7、右帽列 245…255）、1.30.4 与 1.31.1 的 `human-buildprogressbar-border.blp` **两端都是对称斜角**；本地用同一张运行时贴图、同一尺寸克隆渲染，两端收口正常 —— 缺陷只在用户会话的贴图/铺放路径上出现，无法本地重放。故修法不依赖贴图两端。
- [x] 修复（`src/style.css`）：`.hud-progress-wrap::before` / `::after` 分别画出左右收口，两者都取贴图**左**端斜角、右端 `scaleX(-1)` 镜像，盒宽 1.99%（= 条的 8/256，条占 wrap 的 63.6%）、`background-size: 3200% 100%` 让斜角按条的原始比例落位；`.hud-progress` 加 `z-index: 1`、两个收口 `2` / `3`，保证压在填充之上，建造到 100% 时收口仍完整。
- [x] 验证：`npx tsc --noEmit` 通过；克隆探针（真实样式表 + 真实贴图，面板 407.1×248）两端斜角对称、与框线无缝隙，与修复前仅 52 像素差异（左端无重影）；把贴图右端 10 列 alpha 清 0 后重渲染，右端收口仍在（证明已不依赖贴图右端）。

---

# 第二批：血法师美术 / 物品与攻击特效 / 掉落物渲染

依赖顺序：T17 一次性取证 → T18（可独立先落）→ T19/T20/T21/T22 按取证分支落修 → T23 回归。

## T17 取证（一次性脚本）

- [x] 新建 `.tmp-defects-probe*.mjs`，复用 `tools/hd-probe.mjs` 的 CASC 挂载段（`graphics:"de"`、`lazyArt:true`）。
- [x] 打印 `AIma/AIhe/AIha/AImr/AIra/AItp/AHmt` 的 `{targetArt,casterArt,specialArt,areaArt,effectArt}` 与每个路径的 `vfs.exists`：3.0(de) 下全部非空、模型都在。
- [x] 结论：**不是字段为空，也不是空值覆盖**。`AIha→AIheTarget`、`AImr→AImaTarget`，`AItp` 四件齐备。
- [x] 打印 `Hblm` 的 `model/modelScale/weapons[]`：`weaponType=missile`、`missileArt=Abilities\Weapons\BloodElfMissile\BloodElfMissile.mdx`、speed=900；模拟层放行正常。
- [x] 弹道模型逐档解析：`sd` 5904B / 2 geosets；`hd`、`de` 均 1956B / **0 geosets**（只有 VERS/MODL/SEQS/PIVT/CORN/EVTS/BPOS）。同类空壳：`Banditmissile`、`BansheeMissile`、`BloodElfSpellThiefMISSILE`。
- [x] 传送/物品特效模型同样逐档解析：`MassTeleportTo` de 1604B/0 geosets（sd 11403B/4）、`MassTeleportCaster` 1456B/0（sd 10167B/8）、`MassTeleportTarget` 1456B/0（sd 10011B/8）、`AImaTarget` 1456B/0（sd 5549B/1）、`AIheTarget` 1636B/0（sd 5553B/1）。
- [x] 物品美术：3.0 `ItemData.slk` 35 列，**无 `file`/`scale`**；`Units\itemSkin.txt` 存在，649 节与物品一一对应，键只有 `skinType/skinnableID/armor/file/scale/selSize/colorR|G|B`（**没有** `file:sd|hd|de`、没有 `modelScale:*`），`scale` 全为 1。
- [x] 血法师贴图：DE 下 10 张全部可 `read()`（diffuse 2048² DXT1 2.8MB，normal/ORM/emissive 各 5.6MB），无 MISS、无 DX10 特殊格式。
- [x] 记录结论到本文件，删脚本。

## T18 瞬间恢复物品播 Targetart（D2，确定缺陷）

- [x] `src/sim/world.ts` `itemRestore()`：对每个真正恢复过 hp/mana 的受术者 `spellEffects.push({ art: ad.targetArt, ... targetId: t.id })`。
- [x] 覆盖 `AIma/AIhe/AIha/AImr/AIra` 五条 case（都在 L27097-27101，无需改 case）。
- [x] 验证：`npx tsc --noEmit` 通过；模型可见性由 T20 的 base 回退补齐（`AImaTarget/AIheTarget` 在 DE 也是 0 geosets 空壳）。

## T19 传送符特效（D3，实际走「空壳模型」分支）

- [x] 分支 A/B/C 排除：字段非空、模型存在、`activeTeleports()` 与 `collectTeleportFx()` 每帧调用链正常（`useItem→itemTownPortal→beginTeleport` 可达）。
- [x] 真因与 D4 同一个：DE 的 `MassTeleportTo/Caster/Target` 是 0 geosets 空壳，渲染器只画 geoset。
- [x] 由 T20 的 base 回退修复，无需改 `collectTeleportFx`。
- [x] 验证：DE 档 `baseBytes` 对三件分别返回 11403/10167/10011B、geosets 4/8/8。

## T20 血法师攻击弹道（D4，实际走「空壳模型」分支）

- [x] 分支 A/B/C 排除：路径存在、`projectiles` 非空、渲染每帧消费。
- [x] 真因：HD/DE 美术模块用粒子空壳覆盖了 base 模块的 SD 模型。
- [x] `src/vfs/casc.ts`：`mount()` 记录被美术模块覆盖的 base 条目（`baseEntries`），新增 `baseBytes(path)`；`vfs/types.ts` 加可选 `baseBytes?()`。
- [x] `src/render/assetSolver.ts`：新增轻量 `mdxHasGeosets()`（扫 MDLX chunk 的 GEOS，越界/非 MDLX 视为可画）；模型路径在 `hd && baseBytes` 且无 GEOS 时回退 base 字节；blob URL 仍按原路径去重，SD/MPQ 档行为不变。
- [x] 验证：DE 档 `baseBytes(BloodElfMissile.mdx)` = 5904B / 2 geosets；桩 `createAssetSolver` 端到端 mint 一次、blob 5904B、二次调用命同一 URL。

## T21 地面掉落物渲染（D5，实际走「itemSkin.txt」分支）

- [x] `src/data/items.ts`：加载 `Units\itemSkin.txt`，裸 `file`/`scale` 优先、空则取 itemSkin（保留 `file:${art}` 链以兼容按档表）；`scale` 缺失恒回落 1。
- [x] 加 `vfs.exists` 保护：HD/SD 模块没有 DE 的分类模型（ItemRing/ItemWeapon…）时仍回落宝箱，避免物品直接不可见。
- [x] 验证（DE）：装备类物品模型种类由 1 种 → 63 种（`rmef→ItemRing\ItemRing1.mdx`、`ecgr→ItemRing2`、`eptk→ItemWeapon3`、`rre1→runicobject` 等，全部 exists、scale=1、geosets>0）；`pman/ratf/ankh/gcel/tret` 在 3.0 itemSkin 里本来就指定宝箱，故仍为宝箱。

## T22 血法师发黑（D1，实际为分支 C：美术本色）

- [x] 分支 A 排除：DE 下血法师 10 张贴图全部命中，无 MISS、无解码不支持格式。
- [x] 分支 B 排除：材质里队伍色层已由查看器 `setTeamColor` 填上（截图立领即队伍蓝）。
- [x] 结论：DE 血法师本来就是黑长袍 + 队伍色立领；独立查看器加载同一 `HeroBloodElf.mdx` 颜色正常，地图内只是光照更暗、血条正好遮住胸口金绣。不改代码。

## T23 回归

- [x] `npx tsc --noEmit` 通过。
- [x] 删除全部 `.tmp-defects-probe*.mjs`、`/tmp` 产物与 `src/main.ts` 的 `?model=` TEMP-DEBUG。
- [x] 浏览器实测受本机安装的文件夹授权限制（自动化子代理无法完成目录选择），改以 node 端到端复核：base 回退拿到 SD 模型、itemSkin 解析出 63 种模型、`createAssetSolver` mint 去重正常；`tools/render-asset-solver-test.cjs` 全绿。

## 第三批：重制版美术资源全量审计（模型 / 技能 / 特效 / 贴图 / 声音）

- [x] 审计 DE/HD 两档：单位 590 个唯一模型、物品 60 个、技能美术 375 个；逐模型解析 geosets/materials/textures，贴图走 `hdTexturePaths` 全候选，0 geosets 时查 `baseBytes`。
- [x] 结果：DE 单位仅 7 个 0 geosets（2 个被 base 兜底；`uplg`/`uabc` 为真实缺口，`Empty`/`nzin` 是占位物）；DE 技能美术 276/375 为 0 geosets，base 兜底救回 163，剩余 113 无兜底（其中 47 个是 DE 独占英雄技能、base 无文件；其余是真粒子/丝带模型）。
- [x] 声音：`weaponSound`/`lumberSound` 0 缺口；72 个单位语音文件在本安装缺失（多为战役单位）；`AnimLookups.slk` 在本安装完全不存在（`AnimSounds.slk` 的 `AnimationEventCode` 列也全空），模型内嵌 SND 事件无法解析 —— 属安装数据缺失，需内置码表才能补，暂不伪造。
- [x] 贴图：`TEXTURE_EXT` 纳入 `.png`（HeroAnya 的 Emissive 存 `.dds`）；修掉 `relocatedHdTexture()` 的分隔符缺陷（模型用 `/` 拼路径时 `lastIndexOf("\\")` 取不到 basename，尸体/Gore/Sheep/Tornado 的迁移规则从未生效）；尸体与 Gore 走 `Textures\`，`TornadoBound_*` → 同目录 `TornadoMain_*`。
- [x] 跨美术模块补缺：DE 档缺少的 8 张 Phoenix 贴图实际在 `War3HD.mpq`。`CascDataSource` 现在把另一个 Reforged 模块作为**最后一级、只补缺**挂载（DE↔HD 互备），不会覆盖当前档已有的任何路径；顺带补齐 HD 档缺失的 DE 独占单位模型。
- [x] 验证：DE 档 659 个单位/物品模型、5872 张贴图，MISS = 0（原 19 处，含 Sheep 6 处此前被误判为已修）。
- [x] 三条 3.0 技能美术路径写错：Chen Stormstout 导弹在 `Units\Creeps\`、Stampede 死亡模型名为 `StampedeMissileDeath`、Relentless Cleave 在 `Undead\`；`assetSolver.movedAbilityModel()` 兜底。
- [x] `PowerupSound` 的 `Abilities/Spells/Items/AIamTomes.flac` 少一个分隔符，实际为 `...\AIam\Tomes.ogg`；`sounds.ts` 增加 `SOUND_FILE_FIXES`。
- [x] 剩余不可修（安装本身缺文件，记录不伪造）：`uplg`（PlagueCloud）/`uabc`（AbominationCIN）模型、72 个单位语音、`AnimLookups.slk` 缺失导致的模型内嵌 SND 事件无声、113 个无可画模型的技能（DE 独占 47 个 + 经典粒子 66 个，需要粒子渲染）。
- [x] `npx tsc --noEmit` 通过；临时审计脚本已删除。
