# P4 — 地图分类与拒绝（Spec）

> 依据：[SD-HD开发进度.md](file:///Users/huangyu/魔兽/开源魔兽争霸/SD-HD开发进度.md) §2 P4、[SD-HD双版本方案.md](file:///Users/huangyu/魔兽/开源魔兽争霸/SD-HD双版本方案.md)
> 前置：P3 已完成并验收（HD 地图可渲染、主菜单无白屏）。
> 发布约束不变：**P0–P6 全部完成并通过验收前，不更新服务器、不生成更新包。**

## 1. 目标与出口

**目标**：在「地图进入列表」和「地图进入装载」两个门口，明确区分 SD / HD，并拒绝错线的地图。

**出口**：SD 图放进 HD 池会被明确拒绝；不会黑屏、不会静默用 SD 资产顶替。
**反向同样成立**：HD 图进 SD 池同样拒绝（同一条规则的镜像，不需要额外设计）。

**不做**（P5/P6 范围）：HD 房间创建与加入、地图传输、录像 flavor、skinId 真正渲染、服务器更新、更新包生成。

## 2. 现状（已核实）

- [mapFormat.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/compat/mapFormat.ts) 已有 `MapFormatProfile`（`w3iVersion` / `editorBuild` / `terrainVersion` / `objectVersion` / `scriptLanguage` / `partialW3i` / `laterFormat` / `blzIndexBase`）、`readMapFormat(mpq)`、`unsupportedReason(profile)`。**没有 flavor 概念。**
- [mapInfo.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/world/mapInfo.ts) `parseMapInfo(bytes, fallbackName)` 在打开地图时读一次 `readMapFormat` 并存进 `MapInfo.format`（第 201、213、306 行）。`MapInfo` 目前没有 flavor 字段。
- [mapBrowser.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/mapBrowser.ts) `MapEntry.unsupported?: string`（第 923 行）+ `toListItem` 的 `disabled: !!r.unsupported` / `title: r.unsupported`（第 1002–1008 行）已经是「灰显 + 悬停原因」机制；`readFolder` 第 481 行只写 `unsupportedReason(info.format)`。
- `DataSource.exists(path): boolean` **同步**（[types.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/vfs/types.ts#L9)），HD 懒加载不影响存在性判断；`rawBytes` 同步。
- `UnitDef.model` 是已解析的 `.mdx` 路径（[units.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/data/units.ts#L145)）；`loadUnitRegistry(vfs)` 同步（mapBrowser 第 142 行已在用）。
- `war3map.w3u` 行由 `War3MapW3u` 解析，`customTable.objects` 有 `newId`/`oldId`，`originalTable.objects` 有 `oldId`（[objectData.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/data/objectData.ts#L704-L730)）。
- `parseMapUnits(bytes, buildVersion)`（[mapUnits.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/world/mapUnits.ts#L69)）给出 `typeId`，`sloc` 是出生点标记。
- 地形贴图解析：`tilesetOverlay(vfs, hd)(path, tileset)`（[tileset.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/vfs/tileset.ts#L91)），返回 `{ source, path }`；`TerrainData.groundTilesets: string[]`。
- [mapViewer.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/render/mapViewer.ts#L2243) `MapViewerScene.loadMap(bytes)` 是同步装载入口：第 2245 行建 `MpqDataSource`，第 2280 行 `viewer.loadMap(bytes)`；`this.registry` / `this.vfs` 在这里可用。`readMapFormat`、`UNKNOWN_FORMAT` 已在文件中导入。
- [main.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/main.ts#L1003) `startGame(...)` 是所有开局入口（Custom Game / LAN / 战役 / 重开 / 回放）；第 1087 行才读 `mapBytes`，第 1070 行 `glue.leave()` 已经离开菜单。main.ts 第 90 行已 `import { initI18n, t } from "./i18n"`。
- [i18n/index.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/i18n/index.ts) 有 `MessageKey = keyof typeof EN` 与 `ZH: Record<MessageKey, string>`，已有 `flavor.sd` / `flavor.hd` / `lan.otherFlavor` 等键。
- 测试：`tools/tsconfig.sim.json` 把选定 TS 编译到 `.sim-build/`，测试用 `.cjs` 从 `.sim-build` require；`app:test` 不编译，`sim:test` 先 `tsc -p tools/tsconfig.sim.json` 再跑一串 `.cjs`。

## 3. 设计决策

### D1. flavor 归类只有一条规则，且保守

`MapFormatProfile` 里唯一没有歧义的 Reforged 标记是 **w3i ≥ 31**（1.32 起）与 **编辑器 build ≥ 132**。其余（w3i 25/28、object v3、terrain v12、Lua）在 SD 侧都真实存在，不能作为 HD 证据。

```
mapFlavor(profile) = (profile.w3iVersion >= 31 || profile.editorBuild >= 132) ? "hd" : "sd"
```

- 无 w3i（`w3iVersion === 0`）→ `"sd"`；这种文件本来就由 `unsupportedReason` 拒绝，不进 flavor 讨论。
- 规则**只往 HD 判**：任何不确定都落到 SD。误判代价是「在 HD 池被拒」，不是「静默混用资产」——符合出口要求。

### D2. 拒绝对话放在两个门口，共用一条 i18n 文案

- **列表**（主要玩家路径）：`MapEntry.unsupported` 同时承载 `unsupportedReason` 与 flavor 不符；行灰显、悬停给原因。自定义游戏、LAN 建房都复用同一个 `MapBrowser`，因此一处覆盖。
- **装载**（兜底 + 开发者直链）：`startGame` 在 `glue.leave()` **之前**做一次拒绝检查（菜单保持原样，不黑屏）；`MapViewerScene.loadMap` 顶部再断言一次（阻止 `?dev` / dev hook 绕过）。
- 文案只加一个键，复用 `flavor.sd` / `flavor.hd` 作为参数：

```
map.refuse.flavor  EN: "This map is for {map}. This client is on {client}. SD and HD maps cannot be mixed."
                   ZH: "这张地图属于 {map}，当前客户端是 {client}。SD 与 HD 地图不能混用。"
map.refuse.baseId  EN: "This map needs a unit type the Reforged data does not have: {id}."
                   ZH: "这张地图需要重制版数据里不存在的单位类型：{id}。"
map.refuse.assets  EN: "This map needs art the Reforged install does not have: {path}."
                   ZH: "这张地图需要当前重制版安装里不存在的美术资源：{path}。"
```

### D3. 三项检查的顺序与范围

只在 **HD 客户端**做后两项；SD 客户端只做 flavor 检查（SD 回归行为除「拒绝 HD 图」外零变化）。

1. **同 flavor**：`mapFlavor(format) !== flavor()` → 拒绝。两端都做。
2. **base-id 存在于 Reforged 数据**：仅 HD。
   - 读 `war3map.w3u`：每个 `customTable.objects` 的 `oldId` 必须能在注册表找到（`registry.get` / `registry.base`）；`originalTable.objects` 的 `oldId` 同理。
   - 读 `war3mapUnits.doo`（`buildVersion` 取 w3i）：每个 `typeId`（跳过 `sloc`）必须满足「在 w3u 的 `newId` 集合里」或「`registry.get(typeId)` 非空」。
   - 第一个缺失项即拒绝，`detail` 记 `id`。
3. **资产可解析**：仅 HD。
   - 每个已解析单位（自定义 id → 其 `oldId`，否则自身）的 `UnitDef.model` 非空时，`vfs.exists(model)` 必须为真。
   - 地形：`war3map.w3e` 必须存在；`groundTilesets` 每项经 `tilesetOverlay(vfs, true)(path, terrain.tileset)` 解析后 `source.exists(path)` 必须为真。
   - 第一个缺失项即拒绝，`detail` 记路径。

> 说明：`exists` 只回答「挂载后的 VFS 里有没有」。HD 下 `_DE`/`_HD` 与基础 `War3.mod` 同时在挂载栈里，因此它挡的是「会黑屏/空模型」这一类；「基础层里还留着 SD 模型」的静默替身问题由 D1 + D3-1 挡住（SD 图根本进不到 HD 装载），不会用 `exists` 反推美术层归属。

### D4. 拒绝时不做任何状态变更

- `mapLoadRefusal` 是纯函数式检查：只读 bytes / vfs / registry，不碰 `MapViewerScene` 字段。
- `loadMap` 在**清空上一张图的场景之前**检查（放在第 2245 行建 archive 之后、第 2247 行 `prev` 清理之前），拒绝时 `console.error` 后 `throw`，不影响 SD 正常路径。
- `startGame` 的检查在 `setMapDataSet` / 语言包 / `glue.leave()` 之前；拒绝时 `console.error` + `throw`，玩家仍停留在原菜单。

## 4. 变更清单（精确到函数）

### 4.1 `src/compat/mapFormat.ts`

新增：

```ts
export type MapFlavor = "sd" | "hd";

/** 这张图属于哪条线。保守：只有 w3i ≥ 31（1.32/Reforged）或编辑器 build ≥ 132 才判 HD。 */
export function mapFlavor(profile: MapFormatProfile): MapFlavor {
  return profile.w3iVersion >= 31 || profile.editorBuild >= 132 ? "hd" : "sd";
}
```

（放在 `unsupportedReason` 之前；补注释说明 D1 的判定依据与「只往 HD 判」的保守方向。）

### 4.2 `src/world/mapInfo.ts`

- `import { mapFlavor, readMapFormat, UNKNOWN_FORMAT, type MapFormatProfile, type MapFlavor } from "../compat/mapFormat";`
- `MapInfo` 增加必填字段：

```ts
/** 这张图的资产/数据线（compat/mapFormat.ts `mapFlavor`）。列表与装载口据此拒绝错线。 */
flavor: MapFlavor;
```

- `parseMapInfo` 的 `empty` 与最终 return 都写 `flavor: mapFlavor(format)`；无 w3i 的早退分支用 `UNKNOWN_FORMAT` → `"sd"`。
- `localizedMapInfo`（i18n/mapLanguage.ts）若逐字段构造，补 `flavor: info.flavor`；若用展开则无需改（`typecheck` 会指出）。

### 4.3 `src/ui/mapBrowser.ts`

- `import { flavor } from "../data/flavor";`、`import { t } from "../i18n";`
- `readFolder` 第 481 行改为：

```ts
const mismatch = info.flavor === flavor()
  ? undefined
  : t("map.refuse.flavor", {
      map: t(info.flavor === "hd" ? "flavor.hd" : "flavor.sd"),
      client: t(flavor() === "hd" ? "flavor.hd" : "flavor.sd"),
    });
e.unsupported = unsupportedReason(info.format) ?? mismatch ?? undefined;
```

- `MapEntry.unsupported` 的注释补一句「也承载错 flavor」。不改 `toListItem` / 灰显机制。

### 4.4 `src/render/mapViewer.ts`

新增模块级（放在 `export class MapViewerScene` 之前）：

```ts
export interface MapRefusal { message: string; detail: string }

/** 装载前的三项检查（P4-3）。null = 可以装载。 */
export function mapLoadRefusal(bytes: Uint8Array, vfs: DataSource, registry: UnitRegistry): MapRefusal | null
```

实现要点（全部同步）：

1. `const archive = new MpqDataSource("map", bytes); const format = readMapFormat(archive);`
2. `if (format.w3iVersion === 0) return null;`（无 w3i 由 `unsupportedReason` 负责）
3. flavor：`const own = mapFlavor(format); if (own !== flavor()) return { message: t("map.refuse.flavor", {...}), detail: \`w3i v${format.w3iVersion}, editor build ${format.editorBuild} is ${own}; client is ${flavor()}\` };`
4. `if (flavor() === "sd") return null;`
5. base-id：读 w3u（`War3MapW3u`，路径与 objectData.ts 一致）→ 每个 `oldId` 必须 `registry.base(oldId) ?? registry.get(oldId)`，否则拒绝并报 `map.refuse.baseId`；读 w3i 的 `getBuildVersion()` + `parseMapUnits(archive.rawBytes("war3mapUnits.doo"), buildVersion)`，**放置**单位里注册表没有的类型只记一条 `console.warn`（Reforged 店内图仍放置它删掉的 `ngns` 等，和 SD 一样跳过；拒绝会误伤 273 张店内图）。
6. 资产：对每个**注册表能解析**的放置单位（自定义 id 取其 base）取 `def.model`，`def.model && !vfs.exists(def.model)` → `map.refuse.assets`；再要求地图里有 `war3map.w3e` 与 `war3map.wpm`。地形贴图在 w3e 里是 4 字符瓦片集代码、渲染期才经 `Terrain.slk` 解析，属安装级问题（P3 已验证），不在这里逐张检查。
7. 全部通过返回 `null`。每次只记第一条失败。

在 `MapViewerScene.loadMap(bytes)` 开头、`const archive = new MpqDataSource("map", bytes);` 之后（第 2245 行后）：

```ts
const refusal = mapLoadRefusal(bytes, this.vfs, this.registry);
if (refusal) {
  console.error(`[map] refused: ${refusal.detail}`);
  throw new Error(refusal.message);
}
```

（保留原有 `const archive`，gate 内部另建一个只读的 `MpqDataSource`；不为了让两者共用而改动 loadMap 的既有顺序。）

### 4.5 `src/main.ts`

- 在 `startGame` 顶部（`meleeConfig = config;` 之后）读一次 bytes，并做 gate：

```ts
const mapBytes = map instanceof Uint8Array ? map : new Uint8Array(await map.arrayBuffer());
const install = resolver.installSource;
if (install) {
  const refusal = mapLoadRefusal(mapBytes, install, loadUnitRegistry(install));
  if (refusal) {
    console.error(`[map] refused to load "${info.name}": ${refusal.detail}`);
    throw new Error(refusal.message);
  }
}
```

- 删除第 1087 行重复的 `const mapBytes = ...`（改为使用上面的常量），其余不变。
- 新增 import：`mapLoadRefusal`（from `./render/mapViewer`）、`loadUnitRegistry`（from `./data/units`，若未导入）。
- 拒绝时用已有的 `showGlueDialog`（`ui/glueDialog.ts`）在当前界面上弹一个 OK 消息框，文案就是 `refusal.message`；本方案不新增任何弹窗组件。
- 变量名 `install` 与第 1028 行现有的 `const install = resolver.installSource;` 冲突：把顶部那次改名为 `gateInstall`，或把第 1028 行的复用为顶部常量（二选一，实施时以「只读一次」为准，spec 推荐后者：顶部声明 `const install = resolver.installSource;` 并删除第 1028 行重复声明）。

### 4.4b `src/data/units.ts`（P4 检查暴露的 P3-5 修复）

- HD 下 `UnitUI.file` 与 `unitSkin.txt` 的裸 `file=` 都可能缺失，部分行只有 `file:hd`/`file:sd`/`file:de`（`nftb`、`nogl` 等）。回退顺序改为 `file:<hdArt>` → `file:hd` → `file`，并**不**回退 `file:sd`（那会静默拿经典模型顶替）。SD 分支保持只读裸 `file=`。
- 结果：HD 注册表从 646 个单位回到 928 个，店内图的中立生物才能通过 P4-3 的资产检查并正常上场。

### 4.6 `src/i18n/index.ts`

EN 与 ZH 各加 3 个键（放在 `lan.hdVersion` 之后，注释标明是地图装载口的拒绝文案）：

```
map.refuse.flavor
map.refuse.baseId
map.refuse.assets
```

### 4.7 测试与脚本

- `tools/tsconfig.sim.json` 的 `files` 增加 `"../src/compat/mapFormat.ts"`。
- 新增 `tools/map-flavor-test.cjs`：从 `.sim-build/src/compat/mapFormat.js` require `mapFlavor` / `UNKNOWN_FORMAT`，断言：
  - `UNKNOWN_FORMAT` → `sd`
  - w3i 25 / build 0（2003 图）→ `sd`
  - w3i 25 / build 130（1.30.4）→ `sd`
  - w3i 28 / build 131（1.31）→ `sd`
  - w3i 31 / build 132（1.32）→ `hd`
  - w3i 33 / build 0 → `hd`
  - 标题行：`mapFlavor: ok`
- `package.json` 的 `sim:test` 末尾追加 `&& node tools/map-flavor-test.cjs`。

### 4.8 文档

`SD-HD开发进度.md`：P4 表 4 项改 ✅；§1 进度表 P4 → ✅；§3 当前进度改为「P4 完成」并记录验收结果（见 §6）；补 P4 实测记录小节（规则、两处门口、真机结果），格式照 P3。

## 5. 风险与已定取舍

| 风险 | 取舍 |
|---|---|
| Reforged 编辑器若导出 v25「经典格式」图，会被判 SD 并在 HD 池被拒 | 这正是 D1 的保守方向：拒绝可解释，静默混用不可接受；真遇到再补规则并加测试 |
| HD 图若放置了 Reforged 已删除的旧单位（如 Booty Bay 的 `ngns`） | 只 `console.warn` 并跳过，和 SD 一样；不拒绝整张图，否则 273 张店内图会被一张图的船坞拖下水 |
| `loadUnitRegistry` 在 `startGame` 与 `MapViewerScene.create` 各解析一次 | 量级与现有加载相比可忽略；先保证正确性，不做跨模块缓存 |
| 列表的悬停文案在读取时定型 | 与现有 `unsupportedReason` 行为一致；语言切换本来就整页重载 |
| SD 玩家把 HD 图放进 `Maps\` | 新增拒绝（灰显 + 原因），这是 P4 的镜像要求，不算 SD 回归 |

## 6. 验收步骤

1. `npm run typecheck`
2. `npm run cycles`
3. `npm run app:test`
4. `npx tsc -p tools/tsconfig.sim.json && node tools/map-flavor-test.cjs`
5. `node tools/hd-probe.mjs`（确认 P2/P3 数据线与资产探针仍全绿）
6. 浏览器 HD：`?dev&flavor=hd&map=<一张 SD 图的路径>` → 控制台出现 `[map] refused`，不黑屏、不进入地图；随后 `?dev&flavor=hd&map=TerenasStand` 仍正常渲染并推进游戏时间（P3 回归）。
7. 浏览器 SD：`?dev&flavor=sd` 的自定义游戏列表里，已有 SD 图行为不变；若把一张 Reforged 图放进 SD 的 `Maps\`，该行灰显且悬停显示 `map.refuse.flavor`。
8. 检查控制台无新增 error/warning（正常路径）。
9. 更新 `SD-HD开发进度.md`，P4 标 ✅，写明上述结果。

**通过标准**：§1 出口全部满足；第 1–5 条命令全绿；第 6–7 条目视通过。

## 7. 需要你确认

- 是否同意 D1 的保守规则（`w3i ≥ 31 || editorBuild ≥ 132` → HD，其余一律 SD）。
- 是否同意拒绝方式：列表灰显 + 控制台日志 + 抛错停在原菜单，并在有界面时复用已有的 `showGlueDialog` 弹一个 OK 框（不新增弹窗组件）。
- 同意后按 `tasks.md` 顺序实施，完成后跑 §6 全部验收，再更新进度文档。
