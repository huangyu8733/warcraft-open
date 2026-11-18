# 重制版游戏内 HUD 头部/底部控件对齐（官方 3.0 参考）

状态：**已执行**（决定 1、2 已落地；决定 3 保持现状；决定 4 按默认不执行）

## 1. 目标

以 `/Users/huangyu/rrrr/Warcraft III` 安装内的官方 3.0 UI 定义为准，校正游戏内 HUD 顶部（Quests/Menu/Allies/Chat、金木人口、英雄栏、昼夜钟）与底部（小地图、头像、信息面板、背包、命令卡）控件的位置与尺寸。

### 1.1 版本与风格矩阵

安装里有两套客户端，HUD 必须分开看：

| 版本 | 代码开关 | HUD 前端 | 本次影响 |
| --- | --- | --- | --- |
| 新版重制版 3.0 | `flavor = "hd"` | Reforged FDF（`ConsoleUI.fdf` + 顶部两条） | 顶部基线、英雄栏直接生效 |
| ├ 经典风格 CLASSIC | `hdArt = "sd"` | 同一套 Reforged FDF，只换经典美术模块 | 同上，控件几何不变 |
| ├ 重制版 REFORGED | `hdArt = "hd"` | 同一套 Reforged FDF，换 HD 美术模块 | 同上 |
| └ 决定版 DEFINITIVE | `hdArt = "de"` | 同一套 Reforged FDF，换 DE 美术模块（默认） | 同上；只有 `CONSOLE_ART_TOP` 走 0.1383 |
| 旧版经典版 1.30.4 | `flavor = "sd"` | 经典 FDF 前端 | 顶部两条同样按 y=0 摆放；英雄栏同一套 CGameUI 几何 |

已核对：`zip-ui-20`（2.0/HD）与 `zip-ui-30`（3.0/DE）的 `consoleui.fdf`、`commandbar.fdf`、`minimapframe.fdf`、`upperbuttonbar.fdf` 完全一致；`resourcebar.fdf` 只有换行差异，`inventorybar.fdf` / `simpleinfopanel.fdf` 只是 3.0 新增装备/观察者面板，**不改 HUD 控件几何**。因此三种美术风格共用同一套控件坐标，底部洞位只随美术贴图变化。

### 1.2 官方如何挂载三种风格

- **不是三套独立安装，而是同一个 3.0.1 客户端 + 一个 CASC**；风格 = 挂载哪个美术子模块。
- 客户端二进制（`_retail_/x86_64/Warcraft III.exe`）里可读到 `War3.w3mod`、`_HD.w3mod`、`_DE.w3mod`、`_Deprecated.w3mod`、`_Teen.w3mod`，以及 `%s/%s_V%d.w3mod` 这种版本化命名。
- 挂载链：
  - 经典版：只挂 `War3.w3mod`，SD 美术就在基础模块里。
  - 重制版：`War3.w3mod` + `_HD.w3mod`。
  - 决定版：`War3.w3mod` + `_DE.w3mod`。
  - 每个美术模块还带自己的 `_Locales/<loc>.w3mod` 与 `_Tilesets/<Z>.w3mod`；未选中的另一个美术模块完全不挂载。`_Teen.w3mod` 是审查版分支，不参与正常风格。
- **共享**：游戏数据、FDF 布局、菜单 webui、HUD 控件几何。
- **按风格替换**：单位/建筑模型与贴图、控制台贴图、地形/植被/荒芜/环境、着色器；3.0 额外带装备/观察者面板。
- 本项目对应实现：`src/vfs/casc.ts` 的 `legacyRootName()` 按 `graphics` 过滤 `_HD`/`_DE`，`src/data/flavor.ts` 的 `hdArt()` 决定挂哪一个；切换风格要整页重载。
- 旧版经典版 1.30.4 是另一棵 `War3.mpq` 树，没有 `_HD`/`_DE`，HUD 走经典 FDF。

> QMC 解包里还有 `ui-blz` / `ui-que` 两套布局变体：`ui-que` 是经典 4×3、0.1 小地图；`ui-blz` 是 0.1355 小地图、6×2 命令卡。当前项目的 `CONSOLE_ZONES`（0.139 小地图、4×3 命令卡）跟的是 HD/DE 控制台美术洞位，不应盲换成任一 QMC 变体。



## 2. 官方参考（已核对）

来源：`QMC-3.7-Win-x64/unpacked/packages/zip-ui-30/framedef/ui/`
（`framedef/ui` 与 `ui-que` 完全一致；`ui-blz` 只改命令卡排布，见下）

### 2.1 顶部

| 控件 | 官方定义 |
| --- | --- |
| 顶部装饰条 `ConsoleTopBar` | 高 0.032；05/06 两翼各 0.256 宽；01 宽 0.256；02 两段 0.087/0.053；03 宽 0.256；04 宽 0.032 |
| `UpperButtonBarFrame` | 0.34 × 0.022；四个按钮各 0.085 × 0.022；第一个 `SetPoint TOPLEFT, 0.002, 0`，其余 `LEFT = 前一按钮 RIGHT`；MasterFont 0.01；白字、禁用 0.4 灰、高亮金色 1.0/0.83/0.07 |
| `ResourceBarFrame` | 0.33828125 × 0.0218；图标 0.01640625；文字 MasterFont 0.01、右对齐、TextLength 8 |
| 金币 | 图标 TOPLEFT 0；文字 TOPRIGHT −0.267，宽 0.054875 |
| 木材 | 图标 TOPLEFT 0.0859375；文字 TOPRIGHT −0.18，宽 0.0559375 |
| 人口 | 图标 TOPLEFT 0.17265625；文字 TOPRIGHT −0.0924，宽 0.05681875 |
| 维护费 | 文字 TOPRIGHT −0.0055，宽 0.07，居中 |
| 英雄栏 | **无 FDF**，CGameUI 代码构建：按钮 69×68 px、血/蓝条 72×17 px、左边缘 3 px、最多 7 个（1080p 基准） |

### 2.2 底部

`ConsoleBottomBar`：0.8 × 0.13，贴 ConsoleUI 底边；美术高 0.176（05/06 翼 0.176）。

| 控件 | 官方定义（ConsoleBottomBar 坐标，y 自底向上） |
| --- | --- |
| `MiniMapFrame` | 0.1 × 0.1；TOPLEFT = 条 BOTTOMLEFT + (0.09, 0.105) → x 0.09…0.19，y 0.005…0.105 |
| 小地图按钮 | 每颗 0.015；x 0.069；y 0.1065 / 0.09 / 0.075 / 0.06 / 0.038，共 **5 颗**（信号、地形、盟友色、野怪、阵型） |
| `CommandBarFrame` | 0.1745 × 0.129；**4 列 × 3 行**，按钮 0.027；x −0.025 / 0.005 / 0.036 / 0.07；y −0.039 / −0.069 / −0.099 |
| `SimpleInventoryBar` | 6 格 × 0.027，2 列 × 3 行；x 相对 TOPRIGHT 0.0195 / 0.0505；y −0.02 / −0.05 / −0.08 |
| `InventoryText` | 0.07125 × 0.01125，MasterFont 0.010，金色 0.99/0.827/0.070，居中 |
| `SimpleInventoryCover` | 纹理 0.127 × 0.12；BOTTOMRIGHT = 条 BOTTOMLEFT + 0.6 |
| 信息面板 | `SimpleInfoPanel*` 全部 `SetAllPoints`，位置由 CGameUI 给；标题 TOP −0.015，字体 0.01；英雄等级条高 0.012，紧贴标题下 −0.0013 |
| `ConsoleUIBackdrop` | 贴底、0.13 高的平铺 Black32，位于美术之后 |

> 关键结论：FDF 只定义**尺寸与控件间相对关系**，顶部两条、底部各面板的**绝对位置由 CGameUI 决定**。因此不能把 FDF 里的 0.1 小地图、0.027 按钮直接当成 HD 美术上的洞位。

## 3. 当前实现（已核对）

- 顶部：`src/ui/consoleUi.ts` 直接挂 `UpperButtonBar.fdf` + `ResourceBar.fdf`，尺寸/字体/图标间距已经等于官方；位置统一为 `BAR_TOP = 0`、`RESOURCE_TOP = 0`、`BUTTON_NUDGE_X/Y = 0`，两条顶边共享同一基线。
  - `STRIP_ART = 0.032 × 49/64 = 0.0245`，现在只用于 `backing()` 的黑色背板高度，不再参与控件定位。
- 英雄栏：`src/ui/hud.ts` `HERO_BAR`，`left = 3px`、`top = 0.032 + 2px`、`slot = 69px`、最多 7；CSS 血/蓝条 72 × 17 px、间距 1 px（按 69 px 基准等比缩放）。
- 底部：`src/ui/hud.ts` `CONSOLE_ZONES` 直接从 `<Race>UITile0*.blp` 解码测量（1 texel = 0.0005 世界），与 HD 美术洞位一致：
  - 小地图 0.139² @ (0.0095, 0.007)
  - 头像 0.0747 × 0.0795 @ (0.2157, 0.0320)
  - 信息 0.2017 × 0.115 @ (0.3022, 0)
  - 背包 0.0743 × 0.1116 @ (0.5133, 0.0033)
  - 命令卡 0.1705 × 0.1275 @ (0.6165, 0.0060)
  - 小地图按钮 4 颗（信号/地形/盟友色/野怪），第 5 颗阵型按钮未建。
- 控制台整体按 4:3 居中（`CONSOLE_OVERRIDES.holdAspect = true`），与 3.0 美术一致。

## 4. 差异与决定

### 决定 1（改）：顶部两条对齐同一基线

官方两条高度几乎相同（0.022 / 0.0218），CGameUI 不给 y 偏移；当前为了把资源数字塞进装饰条凹槽，把两条错开了约 2 px。改为两条顶边都取 `0`，让 FDF 自己决定行位置，消除左右不等高。

- 文件：`src/ui/consoleUi.ts`
- 改动：
  - `BAR_TOP` → `0`
  - `RESOURCE_TOP` → `0`
  - `BUTTON_NUDGE_X` / `BUTTON_NUDGE_Y` → `0`（官方无此微调）
- 保留：`STRIP_ART`、`STRIP_SLOT_*` 仍用于 `backing()` 的黑色背板高度。

### 决定 2（改，可按确认否决）：英雄栏回到官方 69/72

- 文件：`src/ui/hud.ts`、`src/style.css`
- 改动：
  - `HERO_BAR.slot = 69 * HERO_PX`
  - `--hero-bars-w: calc(var(--hero-slot) * 72 / 69)`
  - `--hero-bars: calc(var(--hero-slot) * 17 / 69)`
  - `--hero-bar-gap: calc(var(--hero-slot) * 1 / 69)`
  - `left = 3px`、`top = 0.032 + 2px` 不变，最多 7 个不变。
- 否决理由（如需保留现状）：代码注释记录 76 px 是之前明确要求放大的结果。

### 决定 3（不改）：底部洞位保持美术测量值

FDF 的小地图 0.1、按钮 0.027 是经典逻辑尺寸；HD 美术洞位是 0.139 / 0.0395。把控件改到 FDF 数值会直接脱离美术凹槽，因此 `CONSOLE_ZONES` 全部保持现状。

### 决定 4（可选，待确认）：补第 5 颗小地图按钮（阵型）

官方 `minimapframe.fdf` 与 `war3skins.txt` 都有第 5 颗阵型按钮，当前只有 4 颗。若要补：

- `CONSOLE_ZONES.formation` = 圆洞实测矩形（约 x 0.1555、y 0.032、0.021 × 0.0185，落地前按 `<Race>UITile01` 行 411…448 复核）
- `src/ui/hud.ts` 增加 `buildFormationButton()`，复用 `buildCreepButton()` 的 skin/disabled/tooltip 模式，按下切换 `formationMovement` 选项
- `style.css` 复用 `.hud-minimap-btn`

本项是功能补齐，不是纯视觉，默认**不做**，等确认。

## 5. 不在本次范围

- `SimpleEquipmentInventoryPanel` / `SimpleTalentsPanel`（仅自定义地图/战役系统使用）
- 底部面板的 DOM 外观重绘（扁平黑底 vs 官方石框），如需要另开一项
- 4:3 居中策略、观察者 HUD、控制台显示/隐藏逻辑

## 6. 验证

1. `npx tsc --noEmit` 通过。
2. dev server 进入一场近战，分别在 `hdArt=sd` / `hdArt=hd` / `hdArt=de` 三种风格下 1920×1080 截图：
   - 左右两条顶边像素 y 差 ≤ 1 px；
   - 英雄栏图标 69 px、条 72 px（按 1080p 基准），7 个槽不与控制台重叠；
   - 底部五个区域仍与各风格美术洞位对齐（小地图/头像/信息/背包/命令卡边缘不压石框）。
3. 如有 1.30.4 旧版经典安装，用 `?flavor=sd` 再截一张，确认顶部两条与英雄栏同样对齐。
4. 1280×720、2560×1440 各截一张，确认按 0.6 世界高度等比缩放。
5. 若做决定 4：第 5 颗按钮可按 F/War3 快捷键触发，禁用态与其它四颗一致。

## 7. 审批

执行记录（2026-11-16）：

- 决定 1：已在 [consoleUi.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/consoleUi.ts#L107-L119) 落地，`BAR_TOP`、`RESOURCE_TOP`、`BUTTON_NUDGE_X/Y` 全部为 0。
- 决定 2：已在 [hud.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hud.ts#L823-L829) 与 [style.css](file:///Users/huangyu/魔兽/开源魔兽争霸/src/style.css#L1980-L1988) 落地，`slot = 69px`，血/蓝条 72 × 17 + 1 px 间距。
- 决定 3：底部 `CONSOLE_ZONES` 未改。
- 决定 4：按默认未补阵型按钮。
- 验证：`npx tsc --noEmit` 通过；浏览器 `?dev&chapter=NightElfX01&flavor=hd` 已进入 HUD，`hud-console`/`hud-minimap`/`hud-command` 等节点均可见。

