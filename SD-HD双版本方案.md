# SD / HD 双版本共存方案

> 目标：同一个启动器、同一套代码。启动时由用户选择 SD 或 HD；一次运行只挂载一种安装、只进一个联机池、只列一种地图。SD 与 HD 在**数据、资产、联机、地图**四个层面完全隔离，不共享任何可变状态。

## 0. 已确认的口径

| 决策 | 结论 | 直接后果 |
|---|---|---|
| HD 数据线 | **直接使用 Reforged 数据** | HD 不是“SD 数据 + HD 美术”，而是一条独立的完整数据线；Reforged 安装的 SLK / 对象数据就是 HD 池的权威数据 |
| RoC / TFT | **固定 TFT** | HD 下 edition 按钮灰掉；`versionIndex()` 恒为 1；不读 `Melee_V0` / `Custom_V0` |
| SD 图在 HD 池 | **彻底禁止** | 这是正确性要求，不是策略：SD 图的对象数据与基础 id 是按 1.30.4 写的，与 Reforged 数据不是同一套 |

三条硬规则不变：

1. 一次进程 = 一个 flavor。
2. 一个 flavor = 一个安装源；两个源永不合并进同一个 `DataSource`。
3. flavor 只由启动器决定，**不能**从地图的 `buildVersion` 推断（[map-compatibility.md:157](file:///Users/huangyu/魔兽/开源魔兽争霸/docs/map-compatibility.md#L157)）。

## 1. 状态模型

新增 `src/data/flavor.ts`，仿照 [edition.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/data/edition.ts)：

```ts
export type GameFlavor = "sd" | "hd";
export function flavor(): GameFlavor;
export function setFlavor(v: GameFlavor): void;
export function onFlavorChange(fn: (v: GameFlavor) => void): () => void;
```

- 持久化键：`warcraft-open.flavor`，默认 `"sd"`。
- 文案键：`flavor.sd` / `flavor.hd`，进 `src/i18n/index.ts`。
- **flavor 必须在任何数据模块被首次读取之前确定。** `data/edition.ts`、`data/units.ts`、`vfs/edition.ts` 等都有模块级状态与缓存，因此运行中切换不能只重建场景，必须**整页 / 整个 renderer 重载**。启动器切换 flavor 时走重启，而不是热切。

## 2. 启动器与版本闸

### 2.1 Electron

- 安装选择器按 flavor 分别记忆：`{ sd: folder, hd: folder }`。
- 主界面提供 SD / HD 切换；切换后重启 renderer。
- [version.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/vfs/version.ts) 的 `checkVersion` 增加 flavor 参数：
  - **SD**：只接受 1.x，`REQUIRED_VERSION = 1.30.4`，与今天一致。
  - **HD**：只接受**指定的一条 Reforged 版本线**，用一个精确版本常量 `HD_REQUIRED_VERSION`（具体值在 P2 实测后钉死）。因为 Reforged 各补丁之间有平衡改动，HD 池必须精确同版本，不能像 SD 那样只比 major。
- 版本不匹配时直接拒绝启动，并给出“这是 HD 安装，请以 HD 启动”或“HD 需要 2.x.y”的明确文案。

### 2.2 Web

- `?flavor=hd` 覆盖，默认读 localStorage，再默认 `sd`。
- 没有可用的 HD 安装时，HD 入口灰显并给出原因。

## 3. HD 数据层（本方案的核心变化）

### 3.1 两条管线必须分开

SD 今天的管线（[loader.ts:71-100](file:///Users/huangyu/魔兽/开源魔兽争霸/src/vfs/loader.ts#L71-L100)）：

```
CASC/MPQ → Downgrade(仅1.31) → Patch(1.29+) → Edition(roc/tft) → DerivedArt → LooseFiles
```

HD 的管线：

```
ReforgedCasc → LooseFiles(可选)
```

**HD 必须绕开 SD 的三层叠加**，且不是“读不到就自然回退”，而是构造上就不挂：

| 层 | HD 是否挂 | 原因 |
|---|---|---|
| `DowngradeDataSource` | 否 | 那是把 1.31.1 的数据改回 1.30.4；HD 要的就是 Reforged 原样数据 |
| `PatchDataSource` | 否 | 那套补丁是**针对 1.30.4 表**写的；Reforged 安装已含自己的平衡，再叠一次是双重修改 |
| `EditionDataSource` | 否 | HD 固定 TFT、只读 live 表；`dataSetFolder()` 不应再去探 `Melee_V0` / `Custom_V0` |
| `DerivedArtDataSource` | 默认否 | 它按 SD 的图标表推导缺失图标；HD 图标直接取 Reforged 安装。需要补图标时另写 HD 规则，不能复用 SD 的推导表 |

实现上加一个 flavor 守卫：HD 下 `dataSetFolder()` 返回 `null`，并在 `loadProfile` 里按 flavor 选择是否包这些层。SD 分支的代码路径不动。

### 3.2 数据读取器要能吃 Reforged 的表

`src/data/units.ts`、`techtree.ts`、`gameplayConstants.ts` 等按列名读取 SLK，缺失列有默认值，理论上容忍新增列，但 Reforged 表的**行内容与新增列**必须实测。P2 的验收就是：

- 只读挂载 Reforged 安装；
- 用 `pnpm map:compat` 同源的探针读 `Units\UnitData.slk`、`UnitBalance.slk`、`UnitUI.slk`、`unitSkin.txt`、`itemSkin.txt`；
- 用一张 Reforged 自带 melee 图跑 headless 启动，核对一个单位（如 Footman）的血量 / 护甲 / 成本 / 模型路径与游戏内一致。

**P2 不通过就不进入资产阶段**——数据线是本方案的地基。

### 3.3 单位、模型、皮肤

- **模型路径不能再复用 SD 的 `_V0/_V1` 逻辑**：[unitModelPath](file:///Users/huangyu/魔兽/开源魔兽争霸/src/data/units.ts#L1030) 是 1.30.4 的 edition 双胞胎规则，HD 没有这个语义。HD 需要自己的解析器：`UnitUI.slk` 的 `file` 字段 + `unitSkin.txt` 的 skin 映射 → HD 模型路径。SD 的 `unitModelPath` 保持不变。
- **皮肤成为真实功能**：`BlzCreateUnitWithSkin` / `BlzSetUnitSkin` 今天读 skinId 后丢弃（[world.ts:76-80](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/world.ts#L76-L80)）。HD 下把 skinId 存到单位上，渲染时通过 `unitSkin.txt` 选 HD 模型 / 贴图集。skinId 只进渲染侧，不进权威模拟状态与录像哈希。
- `*Skin.txt` 由我们的数据层与 viewer 共用一次解析结果，避免两边各读一遍。
- 队伍色已统一 28（[handler.js:156-161](file:///Users/huangyu/魔兽/开源魔兽争霸/node_modules/mdx-m3-viewer/dist/cjs/viewer/handlers/mdx/handler.js#L156-L161) 的补丁），HD 不需要再切队伍色表。

### 3.4 版本必须精确匹配

HD 池内所有客户端必须同一 `HD_REQUIRED_VERSION`。做两件事：

- 本机版本闸（§2.1）先拒绝不匹配的安装；
- `RoomInfo` / `create` 带 `gameVersion`，`join` 时精确比对，不匹配给出“双方 HD 版本不同（2.0.2 vs 2.0.4）”的文案。这是 SD 不需要、HD 必须有的字段。

## 4. 挂载与资产

- [loadProfile](file:///Users/huangyu/魔兽/开源魔兽争霸/src/vfs/loader.ts#L40) 只接受**一个** `PickedInstall` 和一个 flavor。
- 两个源绝不合并：不构造 `[hd, sd]` 的 [LayeredDataSource](file:///Users/huangyu/魔兽/开源魔兽争霸/src/vfs/layered.ts#L7)。该类是“第一个命中”，没有 flavor 维度，合并即互相覆盖。
- SD 路径保持现状（CASC / MPQ），零改动。
- HD 资产走新的 Reforged 读取器：二进制 `vfs-root` + 现代布局；桌面用 CascLib/WASM + Worker + 自定义协议，Web 用离线重打包 + Range（[重制版.md](file:///Users/huangyu/魔兽/开源魔兽争霸/重制版.md) 第七节）。
- [createAssetSolver](file:///Users/huangyu/魔兽/开源魔兽争霸/src/render/assetSolver.ts#L61) 的 blob 缓存键加 flavor 前缀（UI 场景与地图场景可能共用 source，零成本保险）。
- **HD 池内仍需逐资源 `.dds` / `.blp` 回退**：自定义图会带 SD 模型，HD 安装也可能只给 `.dds`。保留“先试 HD 再退 SD、并缓存未命中”的 per-request 逻辑，不用全局开关（[handler.js:162](file:///Users/huangyu/魔兽/开源魔兽争霸/node_modules/mdx-m3-viewer/dist/cjs/viewer/handlers/mdx/handler.js#L162) 是全局的）。
- `isReforged` 只在 HD 下传 `true`。构造 viewer 前先确认四张 `*Skin.txt` 存在：缺一张 viewer 会抛 `Failed to load the base Reforged files`（[viewer.js:88-92](file:///Users/huangyu/魔兽/开源魔兽争霸/node_modules/mdx-m3-viewer/dist/cjs/viewer/handlers/w3x/viewer.js#L88-L92)），表现为黑屏，必须在门外拦住。
- 6 个纯模型场景（菜单、载入、头像等）目前只注册 blp handler（[modelViewer.ts:128-129](file:///Users/huangyu/魔兽/开源魔兽争霸/src/render/modelViewer.ts#L128-L129)）；HD 下要补 dds handler，地图场景本来就有。

## 5. 联机隔离

复用 `edition` 已经走通的四处：

1. **协议**：[protocol.ts:45-59](file:///Users/huangyu/魔兽/开源魔兽争霸/src/net/protocol.ts#L45-L59) 的 `RoomInfo` 与 `create` 各加 `flavor?: "sd" | "hd"` 和 `gameVersion?: string`。
2. **服务端**：[rooms.mjs:45](file:///Users/huangyu/魔兽/开源魔兽争霸/server/rooms.mjs#L45) 的 `roomInfo()` 回带这两个字段；[:221](file:///Users/huangyu/魔兽/开源魔兽争霸/server/rooms.mjs#L221) 的 `create` 归一化（flavor 只允许 `"sd" | "hd"`）。
3. **客户端列表**：[fdfLan.ts:266](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdfLan.ts#L266) 的 edition 过滤旁加 flavor 过滤。
4. **加入二次校验**：`join` 前比对 flavor 与 `gameVersion`。flavor 不一致直接拒绝；HD 下版本不一致也拒绝。旧 relay 没有这些字段时按 `"sd"` 读，**绝不能**“都能进”。

不加 `PROTOCOL_VERSION`：新增字段都是可选的，加版本号会把所有旧 relay / 客户端一刀切掉。

同池数据一致性：HD 池靠精确版本 + 同一 Reforged 数据线保证；跨池不存在一致性问题，因为根本不同局。

## 6. 地图隔离

### 6.1 物理隔离

每个 flavor 用自己的安装目录，地图天然分属各自的 `Maps\` 与 `Maps\Download\`。下载的地图落在当前 flavor 的安装里；房间 flavor 已保证两端一致，因此不需要往地图文件里写标记。

### 6.2 逻辑分类

在 [mapFormat.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/compat/mapFormat.ts#L18) 旁新增：

```
mapFlavor(profile): "sd" | "hd"
  hd  ⇔ editorBuild > 131 或 w3iVersion >= 31
        或 objectVersion >= 3 或 terrainVersion >= 12
  否则 sd
```

- **列表期**用这条保守规则（宁可把 Reforged 编辑器保存的图标成 HD）。
- **加载期**做三项实测，任何一项失败都拒绝开局并说明原因，不静默降级：
  1. 地图引用的模型 / 贴图在 HD 源里能全部解析；
  2. 地图引用 / 修改的**基础 id 在 Reforged 数据里存在**（复用 `pnpm map:compat` 已在做的 base-id 检查）；
  3. `mapFlavor` 必须是 `hd`。

第 2 项正是“彻底禁止 SD 图”的技术依据：SD 图的基础 id 与属性是按 1.30.4 的 SLK 写的，放进 Reforged 数据里不是同一局游戏。

### 6.3 列表、加入、传输、回放

- `MapInfo` 增加 `flavor`，由 `readMapFormat` 的 profile 推出。
- [mapBrowser.ts:481](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/mapBrowser.ts#L481) 的 `unsupportedReason` 旁增加 flavor 不匹配的原因；本档只激活同 flavor 的行，另一档灰显并 hover 给原因。
- `StartMatch.mapPath` 不变；加入方在**自己**的源里按同路径找图。找不到就是“你的 HD 安装里没有这张图”，不允许跨 flavor 拿另一份。
- 地图传输（`mapTransfer`）只在同 flavor 房间内发生，天然不会把 HD 图发给 SD 端。
- 录像头加 flavor 与 `gameVersion`（[replay.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/game/replay.ts) 的 `flavour`），跨 flavor 或跨版本直接拒绝，参照 [fdfViewReplay.ts:207](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdfViewReplay.ts#L207) 的 edition 做法。

## 7. edition 固定为 TFT

- SD 保持现状（roc / tft 可切）。
- HD 下：
  - `setEdition("tft")` 在挂载前强制设置，主菜单 edition 按钮灰掉并说明“HD 只提供冰封王座”。
  - [dataSetFolder()](file:///Users/huangyu/魔兽/开源魔兽争霸/src/data/edition.ts#L109) 在 HD 下直接返回 `null`（live 表），不探 `Melee_V0` / `Custom_V0`。
  - `versionIndex()` 恒为 1；但 HD 的模型解析不走 `_V1` 双胞胎（见 §3.3）。
  - `skinVersionSuffix()` 恒为 `_V1`，war3skins 键保持 TFT。

## 8. 分阶段

| 阶段 | 内容 | 落点 | 出口 |
|---|---|---|---|
| **P0** | flavor 状态 + 启动器选择 + 持久化（HD 入口先灰） | `data/flavor.ts`, electron, `version.ts` | SD 行为零变化 |
| **P1** | 协议 / 服务端 / 列表加 flavor 与 `gameVersion` 字段及过滤（此时只可能产生 SD 房间） | `protocol.ts`, `rooms.mjs`, `fdfLan.ts` | 跨 flavor 房间不可见、不可加入 |
| **P2** | **HD 数据线 spike（go / no-go）**：只读挂载 Reforged，跑通一张 melee 图的 headless 启动，核对单位属性；确认不挂 Patch / Downgrade / Edition | 新读取器（只读）, `loader.ts`, `data/*` 探针 | 数据线成立；钉死 `HD_REQUIRED_VERSION` |
| **P3** | HD 资产读取器 + 挂载 + 单英雄 / 单皮肤渲染 | vfs 新读取器, `loader.ts`, `assetSolver` | 一张 HD 图能渲染 |
| **P4** | HD 地图分类 + base-id / 资产校验 + 列表灰显 | `mapFormat.ts`, `mapBrowser.ts`, `mapViewer.ts` | 错 flavor 的图被拒绝且原因清楚 |
| **P5** | 开启 HD 房间 + 地图传输 + 录像 + 皮肤渲染 | lobby, `mapTransfer`, replay, render | HD 池可完整联机 |
| **P6** | 回归与验收 | 测试 | 见 §9 |

P2 是唯一的 go / no-go 关口：数据线不成立，后面的资产与联机都不做。

## 9. 验收

- SD 全回归：`pnpm map:compat:test`、`pnpm app:test`、现有地图可玩。
- HD 数据：同一张 Reforged melee 图，两个客户端同版本，单位属性 / 成本 / 模型路径一致。
- 跨 flavor：列表不可见；直接 `join` 被拒；不能发图；不能回放。
- HD 版本不一致：加入被拒，文案写明双方版本。
- 切换 flavor：整页重启后无旧源残留；看不到、也进不去另一档的房间。
- 错 flavor 地图：灰显 + 原因；加载期缺资源或缺 base id 被拒绝，不黑屏、不静默降级。

## 10. 主要风险

1. **Reforged 数据层兼容性（最高）**：现有 `data/*` 读取器能否原样吃 Reforged 的 SLK / 对象数据，P2 必须先验证。若不兼容，HD 数据层要单独适配，工作量显著上升。这是本方案唯一可能改变整体排期的风险。
2. **SD 叠加层泄漏**：Patch / Downgrade / Edition 任何一层误挂进 HD，都会造成“看起来能跑、数值不对”的隐性错误。用构造上的 flavor 守卫 + 一个断言（HD 下 `dataSetFolder() === null`）锁死。
3. **HD 版本漂移**：Reforged 补丁间有平衡改动，只比 major 不够；必须精确版本 + 房间字段。
4. **地图归类与 base-id 检查成本**：列表期只做格式归类，base-id 与资产检查放在加载期，避免列表卡死。
5. **不能热切**：数据模块有模块级缓存，flavor 切换必须整页重载。
6. **合规**：HD 资产不进仓库 / 公共 CDN；桌面从用户自己的安装读，Web 由用户本地生成资源包。
