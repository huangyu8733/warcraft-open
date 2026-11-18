# P5 — 开启 HD 联机（Spec）

> 依据：[SD-HD开发进度.md](file:///Users/huangyu/魔兽/开源魔兽争霸/SD-HD开发进度.md) §2 P5、[SD-HD双版本方案.md](file:///Users/huangyu/魔兽/开源魔兽争霸/SD-HD双版本方案.md) §3.3 / §7.3
> 前置：P4 已完成并验收（地图分类与装载拒绝）。
> 发布约束不变：**P0–P6 全部完成并通过验收前，不更新服务器、不生成更新包。**

## 1. 目标与出口

**目标**：HD 池可完整联机——房间能建能进、地图传输不跨线、录像不跨线、skinId 真正到达模型。

**出口**：
1. 两个同版本 HD 客户端能建房 / 列表可见 / 加入 / 开局；SD 房间与 HD 房间互不可见、互不可加入。
2. 地图传输在协议层就带 flavor：HD 房不会把 HD 图发给 SD 端，SD 端收到也拒收。
3. 录像头带 flavor + `gameVersion`；跨线回放（列表、`?replay=` 直链、录像窗口）被明确拒绝。
4. `BlzCreateUnitWithSkin` / `BlzSetUnitSkin` 的 skinId 不再丢弃：HD 下渲染侧按 skin 变体取模型，SD 行为不变。

**不做**（P6 范围）：双客户端真机回归、服务器更新、更新包生成、SD 列表灰显的目视复验。

## 2. 现状（已核实）

- **房间**：P1 已完成。`LanLobby.host` 发 `flavor()` + `gameVersion()`（[lobby.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/net/lobby.ts#L437-L444)）；`join`/`reclaimSeat` 双校验 flavor 与 HD build（[lobby.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/net/lobby.ts#L484-L500)）；relay 的 `create` 归一化与 `join` 拒绝（[rooms.mjs](file:///Users/huangyu/魔兽/开源魔兽争霸/server/rooms.mjs#L213-L262)）；列表按 flavor 过滤（[fdfLan.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdfLan.ts#L263-L269)）。**P5-1 无生产代码要改，只做验收与补测。**
- **地图传输**：`MapGet` 只有 `path`/`chunk`，`answerMapGet` 只校验路径（[mapTransfer.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/net/mapTransfer.ts#L19-L35)、[98](file:///Users/huangyu/魔兽/开源魔兽争霸/src/net/mapTransfer.ts#L98-L112)）。跨线目前只靠“入房前已拒绝”间接成立，协议本身不设防。
- **录像**：`ReplayHeader` 有 `install` / `edition` / `patch`，**没有 flavor 与 gameVersion**（[replay.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/game/replay.ts#L62-L104)）；录制头在 [mapViewer.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/render/mapViewer.ts#L3370-L3406)；列表拒绝只比 edition（[fdfViewReplay.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdfViewReplay.ts#L195-L209)）；直链入口是 [main.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/main.ts#L969-L973)、[devBoot.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/dev/devBoot.ts#L289-L362)、[replayBoot.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/replayBoot.ts#L69-L71)。
- **skinId**：`BlzCreateUnitWithSkin` 直接丢掉第 6 参（[natives/world.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/jass/natives/world.ts#L76-L80)）；`BlzSetUnitSkin` 在 prelude 里声明但**没有注册**（[prelude.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/compat/prelude.ts#L283)）；`SimUnit` 无 skin 字段；渲染侧的绘制体在 `remodelUnit` 里只由 `hexForm` 决定（[mapViewer.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/render/mapViewer.ts#L6063-L6112)）；`UnitRegistry.get/base` 可取任意单位 def（含地图 w3u 覆盖层）。
- `data/units.ts` 在 HD 下已从 `unitSkin.txt` 解析变体模型（P3-5/P4 修复），所以“skin 变体 = 一个单位 def”可以直接复用。

## 3. 设计决策

### D1. P5-1 不新增开关，只验收

HD 房间的唯一闸是 `HD_REQUIRED_VERSION` 与 build 比较，二者 P2/P1 已就位。P5-1 的交付是：
- 确认 HD 下 `Create Game` 能选图、建房、列表可见、同版本可加入；
- `tools/flavor-relay-test.mjs` 补 HD 快乐路径与 build 不符的拒绝（若已覆盖则核对断言）。

不引入“HD 联机开关”：多一个开关就多一条 P6 要回归的分支。

### D2. 地图传输在协议层带 flavor，纯函数注入

`mapTransfer.ts` 保持无全局依赖（headless 可测），flavor 由调用方传入 / 随消息携带：

- `MapGet` 增加 `flavor?: "sd" | "hd"`：加入者的线。
- `MapPart` 增加 `flavor?: "sd" | "hd"`：主机的线。
- `answerMapGet(file, roomPath, msg, hostFlavor)`：`msg.flavor` 存在且与 `hostFlavor` 不同 → 拒绝，`error` 为 `"The host's game is on a different version line."`；每一片都回带 `flavor: hostFlavor`。
- `fetchMap(wire, path, onProgress, signal, expectFlavor)`：收到 `part.flavor` 且与 `expectFlavor` 不同 → 以同一句话 reject，下载对话框按既有错误路径收尾。

调用点：`lobby.mapWire()` 的 `ask` 带上 `flavor()`；`lobby.serveMap` 传 `flavor()`；[mapDownload.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/mapDownload.ts#L100) 的 `fetchMap` 传 `flavor()`。

旧 relay / 旧客户端缺字段时按 `"sd"` 读（与该文件既有兼容原则一致）。

### D3. 录像头加两个可选字段，跨线拒绝收敛到一个纯函数

`ReplayHeader` 增加：

```ts
/** 录制时的资产 / 数据线。缺失 = SD：它被录下来时只有这一条线。 */
flavor?: "sd" | "hd";
/** HD 的精确构建（Reforged 补丁带平衡改动）；SD 为 undefined。 */
gameVersion?: string;
```

`replay.ts` 新增两个纯函数（无 DOM、无 i18n，可 headless 测）：

```ts
export function replayLine(header: ReplayHeader): "sd" | "hd";
/** "flavor" = 跨线；"version" = 同线但 HD build 不同；null = 可放。 */
export function replayMismatch(header: ReplayHeader, line: "sd" | "hd", version: string | null): "flavor" | "version" | null;
```

- 录制：`mapViewer` 的 header 写 `flavor: flavor()`、`gameVersion: gameVersion() ?? undefined`。
- 列表：`fdfViewReplay.blocked()` 用 `replayMismatch`，文案走 i18n `replay.otherFlavor` / `replay.hdVersion`。
- 直链兜底：`main.watchReplayFile`、`devBoot`、`replayBoot` 在 `decodeReplay` 之后同查，拒绝时 `console.error` + throw 一句英文（这三处没有菜单，不新增弹窗）。
- 旧录像（无字段）= SD，行为不变。

### D4. skinId 只进渲染侧：存到 SimUnit，按“skin 变体单位”解析模型

- `SimUnit.skinId: number`（0 = 默认外形），**不加入状态哈希字段联合**（`hexForm` 所在的那一组），不进录像、不进快照：LAN 两端执行同一份脚本，各自在本地得到同一个值；它只改画面。
- natives：`BlzCreateUnitWithSkin` 把第 6 参交给创建后的 `hooks.setUnitSkin(simId, skinId)`；新增 `BlzSetUnitSkin` 注册（同一个 hook）。Runtime hooks 加 `setUnitSkin?(simId, skinId)`，`SimWorld` 实现为“写字段 + 入渲染请求队列”。
- 渲染：`skinId` 非 0 且 `isHd()` 时，把 32 位 rawcode 还原成 4 字符单位 id（`0x68666f6f → "hfoo"`），经 `registry.get(id)` 取变体 def；有 `model` 才用，否则回退本体。绘制体选择统一成 `hexForm > skin 变体 > 本体`，复用既有 `rts.retype(simId, def, skin)`——统计/寻路/点击体仍是本体，只有模型换。
- `SimWorld` 增加渲染请求队列 `drainSkinChanges(): number[]`（与 `drainSummonRequests` / `drainEntangleRequests` 同形）；`MapViewerScene` 的每帧宿主循环 drain 后调 `remodelUnit`。首次生成模型时也从同一个 helper 取绘制 def，避免“先建本体再换一次”。
- SD 下 `isHd()` 为假，skinId 只存不用，SD 画面零变化。

## 4. 变更清单

### 4.1 `src/net/mapTransfer.ts`

- `MapGet` / `MapPart` 各加 `flavor?: "sd" | "hd"`（含注释：旧端缺字段按 SD）。
- `answerMapGet(file, roomPath, msg, hostFlavor: "sd" | "hd")`：
  - 路径校验之后、读文件之前：`if (msg.flavor && msg.flavor !== hostFlavor) return refuse("The host's game is on a different version line.");`
  - 所有 `MapPart` 回包带 `flavor: hostFlavor`（refuse 与非 refuse 都是）。
- `fetchMap(wire, path, onProgress, signal, expectFlavor: "sd" | "hd")`：
  - `part.flavor && part.flavor !== expectFlavor` → `finish(new Error("The host's game is on a different version line."))`。

### 4.2 `src/net/lobby.ts`

- `mapWire().ask`：`this.send({ ...msg, flavor: flavor() }, host)`。
- `serveMap`：`answerMapGet(..., flavor())`。

### 4.3 `src/ui/mapDownload.ts`

- `fetchMap(..., flavor())`（新增 `import { flavor } from "../data/flavor";`）。

### 4.4 `src/game/replay.ts`

- `ReplayHeader` 加 `flavor?` / `gameVersion?`（注释见 D3）。
- 新增 `replayLine` / `replayMismatch`（D3 的签名与语义）。

### 4.5 `src/render/mapViewer.ts`

- header 写 `flavor: flavor()`、`gameVersion: gameVersion() ?? undefined`（新增 `flavor` 到 `../data/flavor` 的 import，`gameVersion` 从 `../data/gameVersion`）。
- `remodelUnit`：绘制 def 由 `hexForm > skin 变体 > 本体` 决定；`renderedModelPath` 的既有防抖保留。
- 每帧宿主循环 drain `world.drainSkinChanges()`，逐 id `void this.remodelUnit(id, su.typeId)`。
- 单位首次生成（`spawnUnitNow` 与快照生成两条路径）使用同一个绘制 def helper。

### 4.6 `src/ui/fdfViewReplay.ts`

- `blocked()` 在 edition 检查后：
  - `replayMismatch(header, flavor(), gameVersion()) === "flavor"` → `t("replay.otherFlavor", { map: t(replayLine(header) === "hd" ? "flavor.hd" : "flavor.sd"), client: t(flavor() === "hd" ? "flavor.hd" : "flavor.sd") })`。
  - `=== "version"` → `t("replay.hdVersion", { required: header.gameVersion ?? "?", local: gameVersion() ?? "?" })`。
- 新增 import：`flavor`、`gameVersion`、`replayMismatch`、`replayLine`。

### 4.7 `src/main.ts`、`src/dev/devBoot.ts`、`src/replayBoot.ts`

- `decodeReplay` / `readReplayHeader` 之后同查 `replayMismatch`；命中则 `console.error("[replay] refused: …")` + `throw new Error("This replay was recorded on the other version line (SD/HD).")`（version 命中时用 build 文案）。不新增 UI。

### 4.8 `src/sim/world.ts`

- `SimUnit.skinId: number`（初值 0；字段注释说明“只进渲染，不入哈希/录像/快照”）。
- `skinChanges: number[]` + `drainSkinChanges()`；`setUnitSkin(simId, skinId)` 写字段并入队（值未变不入队）。
- **不加进**状态哈希的字段联合（与 `hexForm` 同一张清单）。

### 4.9 `src/jass/natives/world.ts` + hooks 类型

- `createUnit` 支持可选 skinId：创建拿到 `simId` 后调 `rt.hooks?.setUnitSkin?.(simId, skinId)`。
- `BlzCreateUnitWithSkin` 传 `asInt(a[5])`。
- 注册 `BlzSetUnitSkin`（`asInt(a[1])`）。
- Runtime hooks 接口（`src/game/jassHooks.ts` 或 `src/jass/runtime.ts` 中 `setUnitAcquireRange` 的定义处）加 `setUnitSkin`；`SimWorld` 侧绑定。

### 4.10 `src/data/units.ts`

- 导出 `unitIdFromRaw(raw: number): string`（32 位大端四字符，非可打印字符返回 `""`）。
- HD 下渲染侧用 `registry.get(unitIdFromRaw(skinId))` 取变体；无 def / 无 `model` 回退本体。

### 4.11 `src/i18n/index.ts`

EN / ZH 各加两键（放在 `map.refuse.*` 之后）：

```
replay.otherFlavor  EN: "This replay was recorded on {map}. This client is on {client}. SD and HD replays cannot be mixed."
                    ZH: "这段录像属于 {map}，当前客户端是 {client}。SD 与 HD 录像不能混用。"
replay.hdVersion    EN: "This replay needs Reforged {required}; this client is on {local}."
                    ZH: "这段录像需要重制版 {required}；当前客户端是 {local}。"
```

### 4.12 测试

- 新增 `tools/map-transfer-flavor-test.cjs`：`answerMapGet` 跨线拒绝、同线回带 flavor、`fetchMap` 收到异线分片即 reject（用最小 `MapWire` 假件与内存 `File` 假件）。
- 新增 `tools/replay-flavor-test.cjs`：`encodeReplay` → `decodeReplay` 往返保住 `flavor`/`gameVersion`；`replayMismatch` 的 `sd↔hd`、HD 同线不同 build、SD 旧头（无字段）四组断言。
- 新增 `tools/skin-id-test.cjs`：`unitIdFromRaw` 的 `hfoo`/0/不可打印三组。
- `package.json` 的 `app:test` 追加这三个 `.cjs`（三者不依赖 DOM，不需要新 tsconfig 条目：`replay.ts`、`mapTransfer.ts`、`units.ts` 已由 `tools/tsconfig.sim.json` 的依赖图编译）。
- 核对并补齐 `tools/flavor-relay-test.mjs` 的 HD 建房 / 加入 / build 拒绝断言。

## 5. 验收

```bash
npm run typecheck
npm run cycles
npm run app:test
npx tsc -p tools/tsconfig.sim.json
node tools/hd-probe.mjs
```

真机（本机 HD 3.0.1.24371 + SD 1.30.4）：

1. HD：建房 → 列表可见 → 第二客户端加入 → 开局一张 HD 图到 00:30，控制台无异常。
2. SD：同流程回归一张经典图，无新增日志。
3. 跨线：SD 客户端看不到 HD 房；伪造 join 被 relay 拒；HD 端不会把图发给 SD（传输层拒绝日志可见）。
4. 录像：HD 局录一段 → 同版本可放；SD 客户端列表显示跨线拒绝；HD 录像改 build 后拒绝；SD 旧录像照常可放。

## 6. 风险

- **skinId 语义**：Reforged 的 skinId 取“变体单位 id”这一解释；若真机脚本用的是另一套编号，回退路径只是“不换模型”，不黑屏、不影响模拟。验收时用一张调用 `BlzSetUnitSkin` 的图核对模型是否切换，必要时把映射收窄到实际列（只改 `data/units.ts` 一处）。
- **地图传输体积**：HD 图可能更大，`MAX_MAP_BYTES` 仍是 128 MB；分片 48 KiB 不变，只增加 flavor 字段，不改变吞吐。
- **旧录像/旧 relay**：全部按缺省 SD 读，SD 回归零变化。

## 7. 批准

请确认本 Spec 后开始实施；实施顺序按 [tasks.md](file:///Users/huangyu/魔兽/开源魔兽争霸/specs/p5-hd-online/tasks.md)：
P5-1 验收 → P5-2 传输 → P5-3 录像 → P5-4 skinId → 全量验收 → 更新进度文档。
