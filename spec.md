# 修复 HD（重制版）三个显示问题 — 规格说明

## 背景

用户报告 HD 模式下三个问题（截图 2026-11-18 00.40.30 / 00.40.56 / 00.42.12）：

1. 树木异常：树冠显示为棕色木纹 / 年轮，而不是绿色树叶。
2. 选中议政厅（Keep）时，信息面板左侧拱形肖像区几乎全黑，建筑 3D 肖像不可见。
3. 建筑训练队列只显示编号 2…6 五个槽，7 号槽（第六个槽元素）被右侧面板边缘裁掉。

验证方式：一律使用 IDE 内置浏览器（browser_use 子代理）加载 HD 地图（BootyBay）观察；Node 只用于离线解析资源。

---

## 已确认的事实（本轮离线分析）

### 问题 1：树木

- HD 树模型 `Doodads\Terrain\LordaeronTree\LordaeronTree0.mdx`（v1800）的 TEXS 前三项均为
  `replaceableId = 31` 且 **路径为空**（HD 由 doodad 行在运行时提供）。
- `Units\destructableSkin.txt` 的 `[LTlt]` 行为：
  - `texID=31`
  - `texFile=ReplaceableTextures\LordaeronTree\LordaeronSummerTree`
  - `file=Doodads\Terrain\LordaeronTree\LordaeronTree`，`numVar=10`
- 当前覆盖逻辑 [map.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/w3x/map.ts#L937-L951)
  只取 **第一个** `replaceableId === texId` 的纹理，并加载
  `ReplaceableTextures\LordaeronTree\LordaeronSummerTree.dds`。
- 该 `.dds` 已提取并转 PNG 验证：它是 **256×256 的经典/SD 图集**，同一张图里混有绿色树冠、
  树干、以及顶部的“树桩年轮”图块。HD 模型 UV 是按 2048² 的
  `LordaeronSummerTree_Diffuse.dds` 编写的，因此树冠采样到了图集里的年轮区域 → 截图中的棕色木纹。
- HD 正确贴图是 `_Diffuse.dds` / `_Normal.dds` / `_ORM.dds` 三张（安装目录已确认存在）。
  三个 replaceable-31 槽正好按 diffuse / normal / ORM 排列。

### 问题 2：建筑肖像

- `TownHall_Portrait.mdx`（v1800）用当前 vendor 解析器 **解析失败**：
  `Unknown animation tag "¡ ?" at offset 5087592`，`lights = 0`，`cameras = 0`。
- 其余已提取的 HD 模型（Peasant、Gyrocopter、GoldMine、PoisonArrow、树）均解析成功；
  GoldMine 也有 2 个灯光，说明不是所有 v1800 灯光布局都不同。
- 失败原因：该模型 LITE 段内每条灯光记录在 12 字节通用头（name 80 + id/parent/flags）之后
  **直接开始动画标签**（`KGRT`），没有 44 字节静态灯光块，也没有 28 字节 Reforged 尾部；
  而 [light.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/parsers/mdlx/light.ts#L27-L62)
  无条件先读 44 字节静态块再跳 28 字节，导致偏移 72 字节，把动画数据当标签读。
- `ModelViewerScene.load()` 中 `viewer.load()` 解析失败 → Promise reject →
  [mapViewer.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/render/mapViewer.ts#L13575-L13594) 的 `.catch(() => {})`
  静默吞掉 → 肖像画布保持黑色。与截图（黑拱 + 一个白色鼠标点）一致。
- 该模型自身带 1 个 `Portrait_Camera`，解析成功后 `applyCamera()` 会使用它，不需要改相机逻辑。

### 问题 3：训练队列 7 号槽

- [hud.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hud.ts#L3437-L3450) 创建 6 个槽，对应队列位置 2…7。
- [style.css](file:///Users/huangyu/魔兽/开源魔兽争霸/src/style.css#L3244-L3272) 的 6 个槽分别位于
  left 4.69% / 20.31% / 35.94% / 51.56% / 67.19% / 82.81%，宽 12.11%，最后一个右边缘 94.92%，
  数值本身与 256×128 队列边框贴图一致。
- 但 `.hud-progress-wrap` 在 skinned 模式下是 `left:0; right:0; height:87%`，背景按
  `100% 100%` 强制拉伸。截图显示队列图被右侧面板边框压在下面、只露出 7 号槽的左竖框，
  说明 wrap 的实际宽度大于可见的槽位区域（面板区域比贴图 2:1 的自然比例更宽）。
- 结论：把整张 2:1 的队列贴图横向拉伸到任意宽度的面板，是 7 号槽被裁掉的直接原因；
  需要让队列部件保持自身 2:1 比例并靠左放置。

---

## 变更方案

### A. 树木贴图（vendor/mdx-m3-viewer/src/viewer/handlers/w3x/map.ts）

在 `loadDoodadsAndDestructibles()` 的 per-row 贴图覆盖处（约 937-951 行）：

1. 收集 **所有** `texture.replaceableId === texId` 的纹理下标（按出现顺序），而不是 `findIndex` 的第一个。
2. 按出现顺序解析 HD 路径：
   - 第 1 个：`${base}_Diffuse.dds`，不存在则回退 `${base}.dds`
   - 第 2 个：`${base}_Normal.dds`
   - 第 3 个：`${base}_ORM.dds`
   - 第 4 个及以后：`${base}.dds`
   其中 `base` 为去掉 `.blp/.tga/.dds` 后缀的 `texFile`。
   SD（非 reforged）保持 `${base}.blp` 不变。
3. 逐个 `this.load(path)`；加载到就 `instance.instance.setTexture(index, texture)`，加载不到就跳过该槽
   （保留模型自身贴图，不再用 SD 图集污染 HD 模型）。
4. 回退到 `${base}.dds` 仅用于第一个槽，避免 HD 模型用不到 `_Diffuse` 时行为退化。

### B. 灯光解析（vendor/mdx-m3-viewer/src/parsers/mdlx/light.ts）

在 `readMdx` 读完 name/id/parent/flags 后：

1. 新增“下一个 4 字节是否为合法动画标签”的探测（`KGRT/KLAS/KLAE/KLAI/KLAC/KLBI/KLBC/KLAV`）。
   实现方式：记录 `stream.index`，读一个 uint32 还原成 4 字符 ASCII，再恢复 `stream.index`。
2. `version >= 1600` 且探测命中动画标签时：该记录是“纯动画灯光”，**不读** 44 字节静态块和
   28 字节尾部，直接进入 `readAnimations`；静态字段保持类默认值。
3. 其他情况（含 v1800 的 GoldMine 这类带静态块的记录，以及所有旧版本）保持现有逻辑：
   读 44 字节静态块 + 28 字节尾部（仅在剩余长度足够时）。
4. 重新执行 vendor `tsc` 构建 `dist/cjs`，并同步到 `node_modules/.pnpm/mdx-m3-viewer@file+vendor+mdx-m3-viewer/node_modules/mdx-m3-viewer/dist/cjs`，
   重启 Vite（当前后台任务 zrzpyqtehi）。

### C. 队列 7 号槽（src/style.css）

把 skinned 模式的 `.hud-progress-wrap` 从“横向拉伸填满”改为“保持贴图 2:1、靠左锚定”：

```css
body.hud-widget-skinned .hud-progress-wrap {
  position: absolute;
  left: 0;
  right: auto;          /* 不再横向拉伸 */
  bottom: 0;
  height: 87%;
  width: auto;
  max-width: 100%;
  aspect-ratio: 2 / 1;  /* 256×128 队列边框的自然比例 */
  display: block;
  margin: 0;
  background: var(--hud-queue-border) 0 0 / 100% 100% no-repeat;
}
```

六个槽仍按现有百分比定位，全部落在 94.92% 以内；宽度由高度和 2:1 比例推出，
不再被面板右缘裁掉。若实测面板本身窄于 2:1，`max-width:100%` 会兜底（此时仅轻微压缩）。

---

## 验证步骤（全部用内置浏览器）

1. `tsc`/vendor 构建通过，Vite 已重启。
2. 打开 dev server（5173），HD 模式加载 BootyBay：
   - 树木：树冠为绿色针叶，无棕色年轮图块。
   - 选中议政厅：左侧拱形区出现建筑 3D 肖像，可见完整建筑。
   - 训练队列：2…7 六个槽全部可见，7 号槽完整显示。
   - 控制台 error 数 = 0。
3. 回归：随机选中农民 / 英雄 / 金矿，肖像正常；SD 模式树木无变化。
