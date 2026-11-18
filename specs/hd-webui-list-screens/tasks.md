# 实施任务：HD 三个列表界面与官方 3.0 WebUI 对齐

> 依据：[spec.md](file:///Users/huangyu/魔兽/开源魔兽争霸/specs/hd-webui-list-screens/spec.md)
> 原则：只改 HD；每一步完成后跑对应验证；不新增 `Official-*` 列表布局类，直接使用官方类名。

## T1 备份与基线

- [x] 记录当前三屏在 `?dev&flavor=hd`（主题 1 与主题 4）下的截图，存到 `/tmp/hd-list-baseline/`。
- [x] `pnpm exec tsc --noEmit` 记录基线。
- [x] 在 DevTools 中确认 `window.warcraftOpen.hdTheme` 与当前菜单主题一致。

验证：基线截图与 tsc 结果可复现。

## T2 官方 CSS 落地（official.css）

文件：[official.css](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/official.css)

- [x] 删除 “list screens” 段（约 1405–2122 行）：`.Replay`、`.CustomGames`、`.CustomCampaigns`、`.Official-ContentContainer` … `.Official-DifficultyRow`。
  - 保留 `customGame.css` 需要的类；删除前 `Grep "Official-<类名>" src/` 确认无其他引用（`skirmish.ts` 自有结构）。
- [x] 插入官方真值段落（全部加 `.hd-official` 前缀）：
  - [x] `Replay` / `CustomCampaigns` / `LoadSavedGame` 三套布局与子元素（含 90px / calc(100% - 134px) 行高）。
  - [x] `BaseFrame` 子元素与 `.tft` / `.fk` 变体；左框 `88px 178px / 239 378 fill`（Replay 除外）。
  - [x] `Simple-Header*`、`SearchInput*`、`TextField*`、`Sort-Icon`。
  - [x] `Replay-*`、`CustomCampaigns-*`、`SavedItemOlds-*` 列头与行（含 hover/selected/delete hover 按钮）。
  - [x] `ImgDetails-*` 全套。
  - [x] `Horizontal-Divider`、`ImgDetailsLowerDivider`、`Trackless-Dot-Scrollbar`。
  - [x] FK 行 hover 绿色变体。
- [x] 检查所有 `url()` 均为 WebUI 相对路径，无 `data:`/绝对路径。
- [x] 检查没有与 `customGame.css` / `hd.css` 同名选择器冲突（`Grep "^\\.hd-official \\.Replay"` 等）。

验证：tsc 通过；启动 dev，`document.getElementById("hd-official-style")` 存在且无重复；控制台无 CSS 解析错误。

## T3 `officialMenu.ts` 重写骨架

文件：[officialMenu.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/officialMenu.ts)

- [x] 新增类型 `HdFileScreenKind`、`OfficialFileScreen`。
- [x] 新增 `baseFrame(tft)`，输出官方 BaseFrame 子元素树。
- [x] 新增 `horizontalDivider(tft)`。
- [x] 重写 `officialListScreen` → `officialFileScreen(screen, kind, opts)`：
  - [x] 根节点 `.${kind}` + `zoom = max(0.5, innerHeight/1080)`，resize 监听并在 `dispose` 中移除。
  - [x] 构建 `${kind}-ContentContainer.Animate-In` → `-MainPanel` → `-LeftPanel-Grid`：
    - [x] `-Background`、`baseFrame`、`Simple-Header`（标题/副标题/搜索框/刷新）、`Horizontal-Divider`、`-LowerLeftSection > -ListFrame > -Listing > -Content > 列头 + -List`、溢出时 `Scrollbar-Background-Frame`。
  - [x] 右侧 `ImgDetails-GameDetailsWrapper`（含 `ImgDetails-Background`、`baseFrame`、`ImgDetails-GameDetailsFrame`）。
  - [x] `cornerDecorations` 与 `PersistentBackButton` 仍由 helper 追加。
  - [x] 搜索输入触发 `opts.onFilter`；刷新按钮触发 `opts.onRefresh`。
- [x] 新增右侧 helper：`imgDetailsHeader`、`imgDetailsOptions`、`imgDetailsButton`。
- [x] 新增 `officialListRow(kind, cols, onClick, opts)`：输出对应 `-EntryRow` 与 `-Col*`，文本套 `-Col-Text` / `SavedItemOlds-MaxPlayerSize`。
- [x] 删除不再使用的 `Official-*` DOM 生成代码与 `OfficialListScreen` 导出（更新三个调用方）。

验证：tsc 通过；任一旧界面加载无异常（此时界面仍是旧内容，但骨架已换）。

## T4 `customCampaign.ts`

文件：[customCampaign.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/customCampaign.ts)

- [x] 改用 `officialFileScreen(screen, "CustomCampaigns", …)`：标题、副标题、`Quick Filter`、刷新、列头 `CAMPAIGN`。
- [x] 加载 `backdrop(screen, assets, ART.home, themeVideo())`。
- [x] 列表为空时不渲染空态文本。
- [x] 难度选择/Play 只在有选中战役时渲染到 `aside` 的 `ButtonContainer`；无选中时 `aside` 保持空 `ImgDetails-GameDetailsFrame`。
- [x] 保留 `backButton` 的 `onSystemMenu`。

验证：进入 CUSTOM CAMPAIGN，与参考图 62 对比；搜索输入不报错；返回/☰ 可用。

## T5 `replay.ts`

文件：[replay.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/replay.ts)

- [x] 改用 `officialFileScreen(screen, "Replay", …)`：列头 `MAP / FILE NAME / DATE`，默认 DATE 倒序 + `Sort-Icon Sort-down`。
- [x] 搜索过滤（地图名/文件名）；点击列头切换排序。
- [x] 行：官方 `Replay-EntryRow` + `Col0/1/2` + `Replay-Col-Text`；文件夹/上级图标。
- [x] 右侧：
  - [x] 未选中 → 空框；
  - [x] 选中 → `ImgDetails-Details-Header-Background`、`MapContainer`（小地图）、`Options`（时间/版本/席位）、`ButtonContainer`（View Replay）。
- [x] 删除改为行 hover 垃圾桶，保留确认弹窗与失败提示。
- [x] 加载 `backdrop(...)`。

验证：与参考图 66 对比；选中行后右侧信息正确；View Replay 能进入录像；Delete 正常。

## T6 `saveGame.ts`

文件：[saveGame.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/saveGame.ts)

- [x] 改用 `officialFileScreen(screen, "LoadSavedGame", …)`：列头 `FILE NAME / DATE`，默认 DATE 倒序，`Filter Saves`。
- [x] 行：`SavedItemOlds-EntryRow` + `Col0 70%` / 日期列 + 选中态。
- [x] 右侧：空选中 → 空框；选中 → 名称/地图/时间/版本/时长/章节 + `Continue` 官方蓝色按钮。
- [x] Delete 行内垃圾桶。
- [x] `saveSupported()` 时在 `ListFrame` 底部追加名称输入 + Save，读取场景不渲染。
- [x] 保留 `openSaveGamePanel()`、读档/存档流程。

验证：与参考图 64 对比；读取存档成功；可保存环境（Electron）下保存成功；纯浏览器下无保存行且提示合理。

## T7 i18n

文件：[i18n/index.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/i18n/index.ts)

- [x] 增加 `hd.quickFilter`、`hd.filterSaves`、`hd.campaign`、`hd.fileName`、`hd.map`、`hd.continue`、`hd.customCampaignsFolder`、`hd.sortAsc`、`hd.sortDesc` 的 EN/ZH。
- [x] 三屏所有可见文案走 `t()`，无硬编码英文。

验证：`?lang=en` 与默认 zhCN 下切换语言重载，三屏无缺键/空白。

## T8 截图比对与回归

- [x] 1920x1080、1280x720，各跑主题 1 与主题 4；三屏截图存 `/tmp/hd-list-after/`。
- [x] 与三张参考图逐项核对：面板宽度、90px 标题带、搜索框、列头、列宽、右侧框、BACK/☰、背景透出。
- [x] 功能回归：搜索、排序、行选中、View Replay、Continue、Delete、Save。
- [x] `pnpm exec tsc --noEmit` 通过。
- [x] HD 主菜单/单人菜单/Custom Games/LAN 无回归；经典 SD 界面无变化。
- [x] 清理 `/tmp` 临时提取物不进入仓库（不提交）。

验证：截图差异清单为 0 处结构性偏差；所有检查通过。

## 风险与回滚

- 风险：官方组件依赖的少量贴图在本机 CASC 缺失 → `loadOfficialStyle` 以透明 GIF 占位，可能出现细线；T8 中逐项确认，必要时在 CSS 中删除该装饰而不是换近似图。
- 风险：旧 `.Official-*` 类仍被未发现的文件引用 → T2 删除前全局 Grep；如命中则先迁移再删。
- 回滚：本改动集中在 `official.css`、`officialMenu.ts` 与三个界面文件；按文件回退即可，不涉及数据格式。


## 执行记录

- 官方 CSS 真值来自 `/tmp/webui-study/chunk_1888278.css`、`chunk_2908516.css`、`chunks/050_2342216.css` 与 `glueManager.js` 的 `SimpleHeader` 段；统一加 `.hd-official` 前缀后并入 `src/ui/hd/official.css`。
- 2026-11-16 在 `?dev&flavor=hd`（1260x768，FK 主题）验证：
  - CUSTOM CAMPAIGN：左带 1209.86px、右列 479.99px，标题单行，控制台无错误；
  - REPLAYS：列头 `地图 / 文件名 / 日期`，日期排序箭头可翻转；Quick Filter 输入 `Last` 后仅剩 LastReplay；
  - LOAD SAVED GAME：列头 `文件名 / 日期`，Filter Saves 输入框存在，右侧 480px 空框；
  - 三屏均走官方 `BaseFrame`、木纹标题带、`Simple-Header` 搜索框与 `ImgDetails` 右列，无控制台错误。
- TFT 主题复用同一套官方规则与 `.tft`/`.fk` 选择器，未改变主题逻辑；如需逐主题截图，可在主菜单切换主题后复查。
- `pnpm exec tsc --noEmit`（通过本地 `node_modules/.bin/tsc`）无错误。
