# HD 三个列表界面与官方 3.0 WebUI 对齐

## 1. 背景与目标

用户指令：详细查看 `/Users/huangyu/rrrr/Warcraft III` 里的 WebUI 界面样式与资料，把重制版（HD）的 UI 做得和 WebUI 一样。

本轮对象是三张官方 3.0 截图对应的 HD 界面：

| 界面 | 入口 | 现有文件 |
| --- | --- | --- |
| `CUSTOM CAMPAIGN` | 单人游戏 → 自定义战役 | [customCampaign.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/customCampaign.ts) |
| `REPLAYS` | 单人游戏 → 观看录像 | [replay.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/replay.ts) |
| `LOAD SAVED GAME` | 单人游戏 → 读取存档 | [saveGame.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/saveGame.ts) |

参考图：

- `/Users/huangyu/Desktop/ui/微信图片_20261115174642_62_1.png`（CUSTOM CAMPAIGN）
- `/Users/huangyu/Desktop/ui/微信图片_20261115174731_66_1.jpg`（REPLAYS，列头 `MAP / FILE NAME / DATE↓`）
- `/Users/huangyu/Desktop/ui/微信图片_20261115174705_64_1.jpg`（LOAD SAVED GAME，列头 `FILE NAME / DATE`）

目标：三个界面在结构、尺寸、层级、字体、边框、纹理、搜索框、列头、行、右侧详情框、左下 `BACK`+`☰` 上与官方 3.0 逐像素对齐；只改 HD，不动经典（SD）。

## 2. 已核实的官方事实（本轮新提取）

官方 WebUI 不是散文件，而是 CASC 中的编译产物；本机可见入口：

- `/Users/huangyu/rrrr/Warcraft III/_retail_/webui/gluemanager.js`（与 `/tmp/webui-study/glueManager.js` 同一份）
- 已按 webpack CSS chunk 拆出：
  - `/tmp/webui-study/chunk_1888278.css`：`Replay` + `ImgDetails` + 列表项通用样式
  - `/tmp/webui-study/chunk_2908516.css`：`CustomCampaigns` + `LoadSavedGame` + `CustomGames`
  - `/tmp/webui-study/chunks/`：其余 137 个 CSS chunk（`Simple-Header`、`SearchInput`、`TextField`、`Primary-Button` 等）
  - `/tmp/webui-study/imgdetails.css`、`/tmp/webui-study/listitems.txt`：上面两块的可用子集

### 2.1 三屏共用的官方 DOM（React 输出）

```html
<div class="{Kind}" style="zoom: GetScale()">
  <div class="{Kind}-ContentContainer Animate-In">
    <div class="{Kind}-MainPanel">
      <div class="{Kind}-LeftPanel-Grid">
        <div class="{Kind}-Background"></div>
        <BaseFrame/>
        <Simple-Header class="{Kind}-UpperLeftSection"
                       title subtitle
                       filter placeholder
                       refreshHandler? />
        <div class="Horizontal-Divider"></div>
        <div class="{Kind}-LowerLeftSection">
          <div class="{Kind}-ListFrame">
            <div class="{Kind}-Listing">
              <TracklessDotScrollbar preClassName="{Kind}-Content">
                <div class="{HeaderClass}">…列头 + Sort-Icon + Divider…</div>
                <div class="{Kind}-List">…行…</div>
              </TracklessDotScrollbar>
              <div class="Scrollbar-Background-Frame"/> <!-- 仅溢出时 -->
            </div>
          </div>
        </div>
      </div>
      <ImgDetails …/>  <!-- 480x936 右侧框 -->
    </div>
  </div>
  <PersistentBackButton/> <!-- BACK + ☰ -->
</div>
```

- `Kind` = `Replay` | `CustomCampaigns` | `LoadSavedGame`
- `HeaderClass` = `Replay-ListHeader` | `CustomCampaigns-ListHeader` | `SavedItemOlds-ListHeader`
- 行类名 = `Replay-EntryRow` | `CustomCampaigns-EntryRow` | `SavedItemOlds-EntryRow`
- 左侧列表滚动容器 = `Replay-List` | `CustomCampaigns-List` | `LoadSavedGame-List`

### 2.2 共用尺寸（官方原值）

```
{Kind}-ContentContainer: height 958px; margin-top 38px; width calc(100% - 66px); max-width 1920px
{Kind}-MainPanel:        padding 36px 0; grid-template-columns calc(100% - 496px) 480px; gap 16px
{Kind}-LeftPanel-Grid:   grid-template-rows 90px calc(100% - 134px); gap 12px
{Kind}-UpperLeftSection: width calc(100% - 64px); margin-left 32px; margin-top 32px;
                         background header-woodtexture.png 100% 210px no-repeat
Simple-Header-Title:     36px; line-height .9; letter-spacing .04em; uppercase; #ffd428; MasterFontBold
Simple-Header-TitleSubText: 12px; small-caps; #ccc9b8; letter-spacing .8px
SearchSection:           height 52px; margin-top 12px; max-width 400px; margin-left auto;
                         justify-content flex-end; padding-right 12px
SearchField:             height 54px; margin-top 12px; width 100%
RefreshSection:          width 85px; 按钮框 72x50；按钮 60x38；图标 36x36
Horizontal-Divider:      width calc(100% - 64px); height 328px; top 35px; 居中;
                         repeat-x 50% 50%；左右端头 136x328，left/right -32px
{Kind}-LowerLeftSection: padding 12px 16px 0
{Kind}-ListFrame:        padding 10px 10px 56px
{Kind}-List:             padding 0 12px; height Replay 658 / Load 660 / Campaign 662; overflow-y auto
列头:                    height 60px; margin 10px 10px 0; padding 3px 6px; font-size 18px; #ccc9b8
                         border-image war3_header_sorting_4k.png 60 340 fill repeat
行:                      min-height 60px; padding 2px 0; 奇数行 hsla(0,0%,100%,.1)，偶数 .05
                         hover rgba(3,45,125,.8) + 2px #00349a 边框
选中:                    color #ffd428; list-item-focus-border.png; background rgba(10,5,0,.8)
```

列宽：

- Replay：`Col0 40% / Col1 32% / Col2 28%`，文本 `.Replay-Col-Text`（ellipsis、line-height 40px、padding-right 15px）
- CustomCampaigns：`Col0 100%`，文本 `.CustomCampaigns-Col-Text`（ellipsis、line-height 40px、padding 0 16px）
- SavedItemOlds：`Col0 70%`（padding-left 18px）/ 其余；行高 60px，文本 ellipsis 由 `.SavedItemOlds-MaxPlayerSize` 控制

### 2.3 左框 BaseFrame 的官方组成

```
<div class="BaseFrame">
  <div class="left-chain[-underglow]"></div>
  <div class="right-chain[-underglow]"></div>
  <div class="frame"></div>
  <div class="frame-underglow"></div>
  <div class="background-texture"></div>
  <div class="section"></div>（可选）
</div>
```

- 左列表框：`border-image-width: 88px 178px; border-image-slice: 239 378 fill`（Replay 不覆盖，用 300px 全宽）
- 右侧 ImgDetails 框：`border-image-width: 90px 162px; border-image-slice: 200 350 fill`
- `frame` 支持 `.tft` / `.fk` 贴图；链子 `:after` 也按 `.tft` / `.fk` 切换
- `.background-texture` 在列表屏为空资源（官方 `url(BaseFrames/)`），实际透出全屏 3.0 背景

### 2.4 右侧 ImgDetails（官方原值）

```
ImgDetails-GameDetailsWrapper: 480x936; position relative
ImgDetails-Background:         #000; inset 24px; opacity .8
ImgDetails-GameDetailsFrame:   grid rows 80px 400px 220px 186px; 100%x100%; #e6e6e6
Details-Header-Background:     top 30px; height 80px; header-woodtexture 100% 140px
MapPreviewHeader:              height 50px; padding 0 20px; space-evenly
MapName:                       21px; #ffd428; letter-spacing .08em; text-shadow 0 2px 1px #000
MapContainer:                  330x330 Minimap-Frame；内图 230x230
Options-Wrapper:               height 230px; padding 0 30px; margin-top -24px
Options:                       padding 10px 30px 0 24px; overflow-y auto
ButtonContainer:               height 156px; wood 纹理; 居中
PlayGameBtn .Primary-Button:   204x66; 内容 26px
ImgDetailsLowerDivider:        top 620px
```

未选中任何条目时：官方只渲染 `.ImgDetails-GameDetailsFrame`（空），框内为纯暗色金属面板——三张参考图右侧正是这个状态。

### 2.5 搜索框（官方 TextField/SearchInput）

```
SearchInput-Wrapper:  position relative; 100%x100%
SearchInput-Overlay:  border-image war3_text_normal_4k.png 40 350 60 250 fill repeat /
                      border-image-width 20px 175px 30px 125px
Overlay:before:       30x30 放大镜；left 15px; top calc(50% - 20px)
SearchInput:          透明; 21px; #d8d8d8; padding 5px 10px 5px 40px;
                      absolute; top 0; left 8px; width calc(100% - 16px); height calc(100% - 10px)
hover / isFocused 换 hover/focused 贴图；图标换 hover/pressed
```

### 2.6 按钮与主题

- 官方基础 `.Primary-Button` 是蓝色贴图（`wc3_btn_blue_*`），FK 主题下 `.Primary-Button.fk` 自动换绿色 FK 贴图；小号 `☰` 是 `Primary-Button-Small`，基础即绿色。
- 主题由 `applyHdTheme()` 打 `tft`/`fk` 类；三个界面不得绕过主题写死颜色。参考图是基础/TFT 蓝色按钮，浏览器当前 FK 主题下应为绿色——这是官方行为，不算偏差。

## 3. 现状差距（需修复）

1. 三屏共用 [officialListScreen()](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/officialMenu.ts#L251-L326)，但 DOM 是自造的 `Official-*` 结构：
   - 没有 `Simple-Header` 搜索框 / 刷新按钮；
   - 没有 `Horizontal-Divider`；
   - 左侧 grid 行高写成 `122px / 1fr`，官方是 `90px / calc(100% - 134px)`；
   - 左侧 frame 没有官方 `88px 178px / 239 378 fill`；
   - 右侧没有任何 BaseFrame，只是裸 `aside`，与截图的金属框完全不符；
   - 列表列宽用 `flex:1 / 108px / 196px`，官方是 `40% / 32% / 28%`（Save 为 `70%`）；
   - 列表头/行使用 `Official-*` 类，与官方类名和视觉不一致。
2. 三个界面各自塞了官方没有的空态文案（`Official-Empty`）、难度按钮、名称输入行位置等，导致空列表时与参考图不一致。
3. 三屏没有 3.0 背景（只有主菜单/单人菜单挂 `backdrop`），列表内部无法透出截图中的暗色 3.0 背景画面。
4. `official.css` 内旧 `Official-*` 列表样式与官方真值重叠但数值不同，必须替换，避免规则互相覆盖。

## 4. 方案

### 4.1 样式：替换 `official.css` 的列表屏段落

在 [official.css](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/official.css) 中删除现有 “list screens” 段（约 1405–2122 行：`.Replay/.CustomGames/.CustomCampaigns` + `.Official-*`），替换为从官方 chunk 逐条抄写、统一加 `.hd-official` 前缀的段落，包含：

1. `Replay` / `CustomCampaigns` / `LoadSavedGame` 三套屏幕布局（主面板、左 grid、Background、BaseFrame、Upper/Lower、ListFrame/Listing/Content/List、BottomFade、Scrollbar-Background-Frame、Horizontal-Divider）。
2. 通用 `Simple-Header` + `Simple-Header-Listing-SearchSection` + `SearchInput*` + `TextField*` + `Sort-Icon`。
3. 三种列头与行的完整规则（`Replay-*` / `CustomCampaigns-*` / `SavedItemOlds-*`）。
4. 右侧 `ImgDetails-*` 全套规则。
5. `BaseFrame` 的通用子元素规则（`frame`、`frame-underglow`、`background-texture`、`left-chain`、`right-chain`、`section`，含 `.tft` / `.fk`）。
6. `Horizontal-Divider` / `ImgDetailsLowerDivider`。
7. `Trackless-Dot-Scrollbar` 的 WebKit 伪元素规则。
8. `.fk` 列表行 hover 的绿色变体（与官方一致：`#00371ccc` / `#005b2c`）。

所有 `url()` 保持 WebUI 相对路径，由 `loadOfficialStyle()` 统一重写为 CASC blob URL。

保留 `customGame.css` 的 Custom Games 专属样式与 `officialListScreen` 之外的现有实现不动。

### 4.2 结构：重写 `officialListScreen()`

在 [officialMenu.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/officialMenu.ts) 中把 `officialListScreen` 改为只服务三屏的官方骨架，签名：

```ts
export type HdFileScreenKind = "Replay" | "CustomCampaigns" | "LoadSavedGame";

export function officialFileScreen(
  screen: HdScreen,
  kind: HdFileScreenKind,
  opts: {
    tft: boolean;
    assets: WebUiAssets;
    title: string;
    subtitle?: string;
    filterPlaceholder?: string;
    onFilter?: (text: string) => void;
    onRefresh?: () => void;
    columns: Array<{ label: string; sort?: "asc" | "desc"; onClick?: () => void }>;
    headerClass: string;
  },
): OfficialFileScreen;
```

返回：`{ root, list, aside, filter, columns, back }`，其中：

- `list` 是 `{Kind}-List` 滚动容器；
- `aside` 是 `.ImgDetails-GameDetailsFrame`（已含 480x936 外框、`.ImgDetails-Background`、BaseFrame），由调用方填充 header/map/options/button；
- `filter` 暴露输入元素，`onFilter` 每次输入触发；
- `back` 是 `PersistentBackButton` 的挂载点（仍在 root 上）。

构建顺序严格照 2.1；`cornerDecorations(assets, tft)` 仍由 helper 追加。

新增小工具：

- `baseFrame(tft)`：输出官方 BaseFrame 子元素树（frame/frame-underglow/background-texture/left-chain/right-chain）；
- `horizontalDivider(tft)`；
- `imgDetailsFrame()`：右侧 480x936 外壳；
- `imgDetailsHeader({title, author, version, maxPlayers})`；
- `imgDetailsOptions(rows)` / `imgDetailsButton(button)`；
- `officialListRow(kind, cols, onClick, { selected, icon })`：按 kind 输出 `Replay-EntryRow` / `CustomCampaigns-EntryRow` / `SavedItemOlds-EntryRow`，并给文本套上 `{Prefix}-Col-Text`（Saved 用 `SavedItemOlds-MaxPlayerSize`）。

删除不再使用的 `Official-*` 结构；`backButton()`、`primaryButton()`、`secondaryButton()`、`cornerDecorations()` 保留。

### 4.3 三个界面

#### customCampaign.ts

- 改用 `officialFileScreen(screen, "CustomCampaigns", …)`；
- 标题 `t("hd.customCampaign")`（大写由 CSS 负责）；副标题显示官方同义的“自定义战役读取位置”说明（新增 i18n）；
- 搜索框 placeholder = `t("hd.quickFilter")`，刷新按钮保留（暂无数据源，点击后重绘空列表）；
- 列头只有 `CAMPAIGN`（`t("hd.campaign")`，新增 i18n）；
- 列表为空时**不渲染**空态段落，右侧保持空 `ImgDetails` 框（与参考图一致）；
- 难度选择与 Play 逻辑保留在代码中，但只在选中战役时渲染到右侧 ButtonContainer；无战役时不显示；
- 仍挂 `backdrop(screen, assets, ART.home, themeVideo())`，让暗色 3.0 背景透出；
- `backButton` 保留 `onSystemMenu`。

#### replay.ts

- 改用 `officialFileScreen(screen, "Replay", …)`，列头 `MAP / FILE NAME / DATE`，默认 DATE 倒序并显示官方 `Sort-Icon Sort-down`；
- 搜索按地图名/文件名过滤；排序支持 DATE 与 FILE NAME（点击列头切换）；
- 行使用官方 `Replay-EntryRow`：`Col0` 文件名（或文件夹名），`Col1` 地图名，`Col2` 日期；文件夹/返回上级使用官方 `Replay-FolderIcon` / `Replay-BackDirectoryIcon`（若官方类缺失则用现有 `Icons/` 图标配 `Official-RowIcon` 命名空间，但不新增 `Official-*` 布局类）；
- 右侧：未选中 → 空框；选中 → `ImgDetails-Details-Header-Background`（地图名、版本、作者）、`MapContainer`（地图小地图）、`Options`（时间、版本、玩家席位）、`ButtonContainer`（`View Replay` 蓝色官方按钮 + `Delete` 行内垃圾桶）；
- 删除操作改为行 hover 显示的官方 `EntryRow-DeleteBtn`（`Icons/delete-icon-*`）；删除确认弹窗沿用现有 `modal()`；
- 读取失败/不可读时在 `Options` 内显示一行说明（不破坏空框布局）。

#### saveGame.ts

- 改用 `officialFileScreen(screen, "LoadSavedGame", …)`，列头 `FILE NAME / DATE`，默认 DATE 倒序；
- 搜索 placeholder = `t("hd.filterSaves")`；
- 行使用 `SavedItemOlds-EntryRow`，`Col0 70%` 文件名、其余日期；选中官方高亮；
- 右侧：未选中 → 空框；选中 → 名称、地图、时间、版本、游戏时长、战役章节，底部 `Continue`（即读取）官方蓝色按钮；`Delete` 用行 hover 垃圾桶；
- 可保存时（`saveSupported()`），在 `ListFrame` 底部（列表与 56px 留白之间）追加官方风格的名称输入行 + `Save` 按钮；仅读取场景不渲染，保证与截图一致；
- 保留 `openSaveGamePanel()` 与现有读档/存档流程。

### 4.4 背景

三屏在构建根节点前调用：

```ts
void backdrop(screen, assets, ART.home, themeVideo());
```

`backdrop()` 已把 still 插到 `screen.element` 首位、视频在其后；`HdScreen.content` 位于其上，因此列表内部透过 `{Kind}-Background`（黑 80%）呈现与参考图一致的暗化 3.0 背景。

### 4.5 i18n

在 [i18n/index.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/i18n/index.ts) 同时补 EN/ZH：

| key | EN | ZH |
| --- | --- | --- |
| `hd.quickFilter` | `Quick Filter` | `快速筛选` |
| `hd.filterSaves` | `Filter Saves` | `筛选存档` |
| `hd.campaign` | `Campaign` | `战役` |
| `hd.fileName` | `File Name` | `文件名` |
| `hd.map` | `Map` | `地图` |
| `hd.continue` | `Continue` | `继续` |
| `hd.customCampaignsFolder` | `Your custom campaigns are read from the installed game folder.` | `自定义战役将从游戏安装目录读取。` |
| `hd.sortAsc` / `hd.sortDesc` | `Sort ascending` / `Sort descending` | `升序` / `降序` |

`s hd.date`、`hd.name`、`hd.saveName` 等已有键复用。

## 5. 非目标

- 不实现 `.w3n` 自定义战役解析（仍为空列表，与参考图一致）。
- 不改经典（SD）界面、不改 FDF、不改游戏内 HUD。
- 不引入 React 或官方运行时，只用官方 CSS 与手写 DOM。
- 不重新设计 Custom Games（`skirmish.ts` / `customGame.css`）与 LAN 界面。
- 不改变存档/录像的数据格式与读写逻辑。

## 6. 验收标准

1. 1280x720 与 1920x1080、主题 1（TFT）与主题 4（FK）下分别打开三屏截图：
   - 左右面板宽度比 = `(W-496):480`，高度 958/936，间距 16，顶部 38；
   - 左框有 `88/178` 金属框 + 木纹标题带 + 水平分隔饰条；
   - 标题金色大写、字号 36；搜索框带放大镜、54 高、边框贴图正确；
   - 列头/列宽/排序箭头与官方一致；
   - 右侧 480x936 金属框；空选中时纯暗面板；
   - 左下 BACK + ☰ 位置与贴图正确；
   - 列表内部可见暗化 3.0 背景。
2. 搜索可过滤；列头排序可用；行 hover/选中视觉正确；View Replay / Continue / Delete / Save 功能不回归。
3. 控制台无资源 404（缺失资源应为透明占位）、无重复 `<style id="hd-official-style">`。
4. `pnpm exec tsc --noEmit` 通过。
5. 经典界面与 HD 主菜单/单人菜单/自定义游戏界面无回归。

## 7. 待批准

批准后按 [tasks.md](file:///Users/huangyu/魔兽/开源魔兽争霸/specs/hd-webui-list-screens/tasks.md) 顺序执行。
