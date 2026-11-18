# 3.0 化：局域网三屏 + 载入 / 结算界面

## 1. 目标与边界

把仍在用经典 FDF 的五个粘合界面改成 HD（`flavor=hd`）下的 3.0 WebUI 外观：

1. 局域网游戏列表（`UI\FrameDef\Glue\LocalMultiplayerJoin.fdf`）
2. 局域网建房（`LocalMultiplayerCreate.fdf`）
3. 局域网大厅（`GameChatroom.fdf`）
4. 载入屏（`Loading.fdf`）
5. 结算屏（`ScoreScreen.fdf`）

约束：

- SD（默认 flavor）保持现有 FDF 外观与行为，一行不动。
- 只在 `isHd()` 为真时走新的 DOM/CSS 实现；游戏逻辑、网络协议、数据源不变。
- 美术一律取自安装包 `WebUI\`（经 [assets.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/assets.ts) 转 blob），缺失文件由 [official.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/official.ts) 回退 1×1 透明图，不手造资产。
- CSS 全部限定在 `.hd-official` 作用域，追加到 [official.css](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/official.css)。

验证入口：`http://localhost:5173/?dev&flavor=hd&hdArt=de`（dev server 已在后台运行，不重启）。

## 2. 现状（已确认）

### 接线点（src/main.ts）

- `lanScreen(vfs)` L549：`mountLanScreen(ui, vfs, editionMaps(), lobby, connected, {onCancel,onCreateGame,onJoined,onMapDownloaded})`
- `lanCreateScreen(vfs)` L569：`mountLanCreateScreen(ui, vfs, editionMaps(), lobby, {onCreate(path,info,gameName,advanced,server),onCancel})`
- `lanLobbyScreen(vfs,map,advanced?)` L600：`mountLanLobbyScreen(ui, vfs, editionMaps(), lobby, map, {onCancel,onStart,onCountdownTick}, advanced)`
- `showLoadingScreen(info, config, map)` 约 L1411 → `mountLoadingScreen(...)`，随后 `gate.onReady`、`sounds.setLoadingGate`、`mapScene.setLoadingScreen`。
- 结算屏由 [mapViewer.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/render/mapViewer.ts) L12295 起的胜负对话后调用 `ui/scoreScreen.ts`。

### 现有实现与可复用逻辑

- [fdfLan.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdfLan.ts)：`LanHandlers`、`savedPlayerName`、`copyText`、`observerSeats`、`toConfig`；房间过滤（edition/flavor）、地图预览读取、缺图下载、Servers List 对话框、可达性提示。
- [fdfLanCreate.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdfLanCreate.ts)：`LanCreateHandlers`、`MapBrowser`（ui/mapBrowser.ts）、`DEFAULT_ADVANCED`、`OBSERVER_ITEMS/VISIBILITY_ITEMS`、`HostTarget` 选择、`HOST_SERVER_KEY`。
- [fdfLanLobby.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/fdfLanLobby.ts)：`LanLobbyHandlers`、seatPeers / applyRequest / editSlot / buildStart / canStart / colorsFreeFor / rosterDiff / newSetup / markDownloads / isDefaultAdvanced、聊天 `sanitizeChat`、倒计时 5 秒与 2 秒取消死线、`lobby.handOff()`、`matchLinkFrom`。
- 载入屏接口 [loadingScreen.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/loadingScreen.ts)：`LoadingScreen { setProgress, finish, waitForKey, setPeerReady, setMapPreview?, dispose }`；背景由 `render/loadingScene.ts` 的 `LoadingScene` 绘制。
- 结算屏 [scoreScreen.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/scoreScreen.ts)：数据来自 `game/scoreTable.ts` 的 `ScoreTable/ScoreRow`，四个页签列定义 `TABS`、排序、英雄图标、`scoreScreenMusic`。

### 官方几何/类名（从 `/tmp/webui/official.css`、`glueManager.js` 抄得）

**LAN（`.LANGames`）**

- `.LANGames-ContentContainer`：`height:936px; margin-top:50px; width:90%; max-width:1920px; display:flex`。
- `.LANGames-MainPanel`：`display:grid; padding:36px; grid-template-columns:calc(100% - 452px) 420px; grid-gap:32px; background:url(BaseFrames/war3_stone_bg_landscape_4k.png)`。
- `.LANGames-LeftPanel-Grid`：`grid-template-rows:90px 90px calc(100% - 244px); grid-gap:12px`。
- `.LANGames-UpperLeftSection`：header-woodtexture，`padding-left:12px; padding-top:2px`；`.LANGames-BackButtonContainer` 60px 宽；`.LANGames-TitleText` 32px / #ffd428 / uppercase / MasterFontBold。
- `.LANGames-TitleFrame`：header-woodtexture 横带；`.LANGames-ButtonSection` 65% 宽、`margin-left:32px`；`.Tab-Button` 200×58 `Social/social_tab_inactive.png`，选中 `social_tab_active.png`。
- `.LANGames-LowerLeftSection { padding:24px 16px 0 }`。
- 右栏 `.IntegratedImgDetails-RightPanel-Grid`：`grid-template-rows:80px calc(100% - 112px); grid-gap:32px`；`.IntegratedImgDetails-TitleFrame` 木纹标题带（剑图标 42×42、地图名 21px #ffd428、作者）；`.MapDisplay-Frame` 420×420 + `wc3_btn_frame_4k`；`.IntegratedImgDetails-ScrollbarContainer` 描述区；`.IntegratedImgDetails-PlayGameBtn` 310×94 `button_frame_4k`（左右 cap 31×46）。
- 基底：`.LANGames .BaseFrame`（链条 chain_tile_4k、chain_clasp_4k(_alt)、war3_metal_frame_4k、war3_metal_frame_lighting_4k、test_texture-wood / tft_ 变体）。
- 列表行用官方 `GamesListing-GameEntryRow` 语义；本项目复用已验证的 `.Official-EntryRow/Col0/1/2`。

**大厅（`.GameLobbyMain`）**

- `.GameLobby-ContentContainer`：`flex-direction:row; margin-top:60px; width:1480px; height:920px`；BaseFrame 920×1480，链条位置 `margin-left:1271px`。
- `.GameLobbyMain .Left-Panel`：`width:calc(100% - 540px)`；`.Left-Panel-TopSection` 玩家区（`height:calc(65% - 20px); padding:50px; padding-top:60px`）；`.Left-Panel-BottomSection` 聊天区（`height:35%; padding:0 30px`，`.ChatFrame-ChatContainer{height:240px}`）。
- `.GameLobbyMain .Right-Panel`：480px 宽、stone 背景；地图预览 + 详情 + 开始/取消。
- `.GameLobby-PlayerRow`：`display:grid; grid-template-columns:112px 1fr 160px 108px; height:40px; font-size:19px; color:#e6e6e6`；`.GameLobby-PlayerName` 金色/自身 `#ccc8b8`。
- 聊天：`.ChatFrame-Input` 67px 高、`war3_text_frame.png`；`.ChatFrame-ChatContainer`；`.chatArea p`。
- 小控件：`.GameLobby-Player-Team` 用 `war3_btn_small_blue_normal_4k.png`（disabled → `war3_btn_small_non-interactable_4k.png`）。

**载入（`.LoadingScreen`，121 条规则）**

- 关键类：`LoadingScreen-Background`、`Map-Details`、`Map-Name`、`MapTitle`、`Map-Description`、`Map-CustomTitle`、`CenterLoadingColumn`、`Top-Ornament`、`Bottom-Ornament`、`DecorationLeft/Right`、`TeamName`、`Race-Crest`、`MapAuthor`。
- 背景仍由 `LoadingScene` canvas 画（地图载入图 + 进度条模型），DOM 只叠加 3.0 标题/描述/玩家/进度文案。

**结算（`.ScoreScreen`，61 条规则）**

- 关键类：`ScoreScreen-Container/Wrapper/Background/Table-Container/TabOptionHolder/TabOption-Selected/BottomBarContainer/BottomButtons-Wrapper/HeroHolder/Race-Art/Back-Button/Header-Menu`。

## 3. 方案

### 3.1 局域网浏览屏（新 `src/ui/hd/lan.ts`）

接口：

```ts
export async function mountHdLanScreen(
  container: HTMLElement, vfs: DataSource, maps: Map<string, File>,
  lobby: LanLobby, connected: Promise<void>, h: LanHandlers,
  opts?: { initialTab?: "games" | "create" },
): Promise<FdfScreen>
```

- 外壳 `.LANGames`（zoom = innerHeight/1080，resize 重算，包装 `screen.dispose`）。
- 顶部两枚 `.Tab-Button`：`Games`（当前）/ `Create`；点 Create 调 `h.onCreateGame()`（沿用 main.ts 的屏幕跳转）；不实现 Load。
- 第二行右侧：玩家名输入（`.LANGames-MatchNameSection` 内），`Servers List` 按钮（复用 `showJoinAddressDialog`），状态行（`lan.gamesTitle` / `lan.willDownload` / `lan.noGames` / `lan.selectGame` / 错误红字 / `reachabilityLine` 警告）。
- 列表：房间行 = 名称 + `(n/max)`（金色，观察者加 `GAMELIST_OBSERVERS`），过滤规则照 `render()`：edition+flavor 相同。单击选中并 `showMapOf` 读地图摘要与标记；双击/`Join Game` 调用 join（缺图先 `requestMapWriteAccess`）。
- 右栏（IntegratedImgDetails）：地图缩略图（`imageToDataUrl(info.minimap)`）、地图名、作者/规模、描述、房间主机、速度、槽位；底部 `Join Game` 主按钮（未选中/缺图中禁用）。
- 保留原逻辑：`lobby.onChange`、`joined` 后 `h.onJoined`、缺图 `showMapDownload` → `h.onMapDownloaded`、`connected.catch` 显示错误并禁用按钮、`alive` 生命周期。
- 返回 `screen.attach(container)`。

### 3.2 建房屏（新 `src/ui/hd/lanCreate.ts`）

接口与 `LanCreateHandlers` 完全一致：

```ts
export async function mountHdLanCreateScreen(
  container, vfs, maps, lobby, h: LanCreateHandlers,
): Promise<FdfScreen>
```

- 同一 `.LANGames` 外壳，`Create` 页签选中，左栏 = 地图文件夹浏览器（照 [skirmish.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/hd/skirmish.ts) 的 `folderOf/paintFiles/choose`，含 `..` 上行与文件夹图标）。
- 右栏：地图预览 + 名称/作者/人数/尺寸/瓦片 + 描述；其下 Advanced Options 区：
  - 7 个开关行（Lock Teams、Teams Together、Shared Control、Random Races、Random Hero、Computer+、All Talk）：DOM 按钮切换 `advanced[key]`；
  - Observers / Visibility 两个 `select`（`OBSERVER_ITEMS`/`VISIBILITY_ITEMS`，标签走 `lib.string` 或 `t()`）；
  - Server `select`：`lobby.hostTargets`，默认 `localStorage["warcraft-open.hostServer"]` → 官方服 → 首个可用；
  - Game Speed `select`（`GAME_SPEED_MIN..MAX`，`gameSpeedLabel`），默认 Fast。
- 底部 `Create Game` 主按钮：`h.onCreate(picked.path, picked.info, gameName, {...advanced}, where.url)`；`gameName` 默认 `Local Game (<savedPlayerName()>)`。
- `lobby.onChange` 时刷新 Server 菜单与按钮可用性；`alive` 守卫；`dispose` 恢复。

### 3.3 大厅（新 `src/ui/hd/lanLobby.ts`）

```ts
export async function mountHdLanLobbyScreen(
  container, vfs, maps, lobby, map: { path; info }, h: LanLobbyHandlers, hostAdvanced?: AdvancedOptions,
): Promise<FdfScreen>
```

- 领域逻辑逐段搬 `fdfLanLobby.ts`：`isHost`/`setup`/`regroup`/`reseat`/`onRequest`/`enter`/`launch`/`countdown`/`tick`/`cancel`/`startMatch`/`lobby.onPeerData`/`lobby.onChange`/`lobby.onStart`/`submit`/`say`/`system`/`nameOf`，不改规则与消息。
- 渲染：`.GameLobbyMain` + `.Left-Panel`（玩家行 + 聊天）+ `.Right-Panel`（地图 + 高级选项摘要 + 开始地址 + 按钮）。
- 玩家行（grid `36px minmax(0,1fr) 140px 130px 100px`）：
  - 颜色色块（`PLAYER_COLORS`；点击/下拉换色，颜色唯一性用 `colorsFreeFor` 校验）；
  - 名称：真人行显示名字 + 下载百分比；空位/电脑为 `select`（`slotOptionsFor(computerPlus)`，锁定行禁用）；
  - 种族 `select`（`RACES`）、队伍 `select`（`teamOptions` + `OBSERVERS_TEAM`）、难度/手速 `select`（`HANDICAPS`）；
  - 观察席行：名字 + 队伍 select（Observer 之外即回座）。
  - 倒计时期间全部禁用（`setup.counting`）。
- 聊天：日志数组 + `.chatArea`，Enter 提交（`lobbychat`），系统行用 `NETMESSAGE_PLAYERJOINED/LEFT`、`TIMER_COUNTDOWN`（`lib` 不可用时用英文回退）。
- 右栏：小地图 + 地图名/作者/人数/描述；高级选项摘要（`isDefaultAdvanced` 为真时隐藏，照原逻辑）；Join Address 行（点击复制，官方服显示 `lan.hostedOn`，`copiedUntil` 1.5s）；底部 `Start Game`（host 且 `canStart` 且无倒计时）与 `Cancel`（`cancelLive()`）。
- `mapWire().arrived()` 照旧；`readMapPreviewFor` 后重绘。

### 3.4 载入屏（新 `src/ui/hd/loading.ts`）

```ts
export async function mountHdLoadingScreen(opts: {
  container; vfs; canvas; info: MapInfo; config: MeleeConfig;
  title?: string; subtitle?: string;
}): Promise<LoadingScreen>
```

- 背景：保留 `createLoadingScene(...)`/`LoadingScene` 的 canvas 渲染与进度条逻辑（搬 `loadingScreen.ts` 中现有实现），DOM 覆盖层换成 3.0：
  - 左下/中央：`LoadingScreen-Background` 底板 + `Top-Ornament`/`Bottom-Ornament` + `CenterLoadingColumn`；
  - 地图名（`Map-Name`/`MapTitle`）、作者（`MapAuthor`）、描述（`Map-Description`，做行数截断或滚动）；
  - 玩家/队伍列（`TeamName` + `Race-Crest`，用 `playerLabels`/`config.slots`）；
  - 进度文案沿用 `LOADING`/`LOADING_WAITING_FOR_PLAYERS`/`LOADING_PRESS_A_KEY` 的 i18n 键；`setPeerReady` 点亮对应行。
- 实现 `LoadingScreen` 全接口；`dispose` 移除 DOM 与 canvas；`waitForKey` 维持原 Promise 语义。
- main.ts `showLoadingScreen`：`isHd()` 时调用 HD 版，否则 FDF 版；两者返回同一 `LoadingScreen`。

### 3.5 结算屏（新 `src/ui/hd/score.ts`）

```ts
export async function mountHdScoreScreen(opts: 与 mountScoreScreen 相同的数据/回调): Promise<...>
```

- 用 `.ScoreScreen-*` 类复刻：`Container` 背景、`Header-Menu`（四个 `TabOption`，选中 `TabOption-Selected`）、`Table-Container`（表头 + 每行：玩家色/种族图标/名字/各列数字）、`HeroHolder`（英雄图标）、`BottomBarContainer`（`Elapsed Time` + OK）。
- 复用 [scoreScreen.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/src/ui/scoreScreen.ts) 已导出的列定义/排序/分数计算/音乐（`scoreScreenMusic`）；不重写统计。
- 排序、切页、OK 返回的 Promise 契约与原实现一致；mapViewer 调用点按 `isHd()` 分支。

### 3.6 CSS（追加到 official.css）

- 段 1 `.LANGames`：见 3.1 几何 + `.Official-EntryRow` 复用 + `.IntegratedImgDetails-*` 右栏 + 链条/金属框基底 + `.Tab-Button`。
- 段 2 `.GameLobbyMain`：见 3.2 几何 + `.GameLobby-PlayerRow` + `.ChatFrame-*` + `.Official-Field` 小控件 + 右栏。
- 段 3 `.LoadingScreen`：`Container/Background/CenterLoadingColumn/Top-Ornament/Bottom-Ornament/Map-Details/Map-Name/MapAuthor/Map-Description/TeamName/Race-Crest`。
- 段 4 `.ScoreScreen`：`Container/Wrapper/Table-Container/TabOptionHolder/TabOption-Selected/BottomBarContainer/BottomButtons-Wrapper/HeroHolder/Race-Art/Header-Menu`。
- 所有 `url()` 保持 `WebUI\` 相对路径（official.ts 负责 blob 化）。

## 4. 文件清单

新增：

- `src/ui/hd/lan.ts`
- `src/ui/hd/lanCreate.ts`
- `src/ui/hd/lanLobby.ts`
- `src/ui/hd/loading.ts`
- `src/ui/hd/score.ts`

修改：

- `src/ui/hd/official.css`（四段新增）
- `src/main.ts`（`lanScreen` / `lanCreateScreen` / `lanLobbyScreen` / `showLoadingScreen` 的 `isHd()` 分支）
- `src/render/mapViewer.ts`（结算屏 `isHd()` 分支）
- `src/i18n/*`（仅在缺少文案时新增 key，优先复用 `lan.*`、`hd.*`）

不改：

- `src/ui/fdfLan.ts`、`fdfLanCreate.ts`、`fdfLanLobby.ts`、`loadingScreen.ts`、`scoreScreen.ts`（SD 路径）
- 网络/存档/协议代码

## 5. 验证

1. `npm run typecheck`
2. `npm run cycles`
3. 浏览器逐屏（`?dev&flavor=hd&hdArt=de`）：
   - 主菜单 → 多人游戏 → LAN 列表：空列表文案、选中房间出地图预览、Join 可用性、Create 跳转、Servers List 弹窗；
   - 建房：文件夹浏览、选图、开关与 select、Create 进入大厅；
   - 大厅：玩家行/空位/观察席、聊天、Start 倒计时 5→1、Cancel、开始后进入载入；
   - 载入屏：地图名/描述/玩家/进度/等待状态；
   - 结算屏：四页签切换、排序、OK 返回；
   - 全程 console 无 error；`flavor` 非 hd 时仍走 FDF 且外观不变。

## 6. 风险

- 官方右栏/大厅类名较多，若个别 WebUI 美术缺失会显示空白底板（official.ts 回退），需在验证时确认关键底图存在。
- 结算屏的 FDF 版含模型（ScoreScreenScene）；HD 版若改用 DOM 行，需要保持与原 `mountScoreScreen` 相同的异步/回调契约，避免 mapViewer 卡死。
- 大厅逻辑与渲染强耦合，搬迁时必须保留 `handOff` 时序（先解除钩子再 `matchLinkFrom`）。
