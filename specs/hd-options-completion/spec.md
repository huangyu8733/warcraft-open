# HD 选项补全 Spec

## 1. 目标

把官方 Reforged WebUI（`_retail_/webui/gluemanager.js`）选项页中存在、而我们 HD 选项页缺失的设置补齐。原则：

- 只改 HD 线（`src/ui/hd/options.ts`、`src/data/options.ts` 及 HD 专用消费者），不动经典 SD FDF 选项页。
- 能真实影响渲染、HUD、音频、输入、聊天的，必须接上真实消费者。
- 浏览器确实无法实现的，保留可见行、置灰并给出说明（`applied:false` + 提示），**不伪造行为**。
- 所有新增文案支持中/英；优先使用安装包 `GlobalStrings.fdf` 的官方键，缺失时回退到 `src/i18n/index.ts`。
- 明确跳过：显示器/适配器选择、音频输出设备、Mac 三项键盘设置。

## 2. 官方键与处置总表

键名沿用 `OPTION_DEFS.key`。`cap` 为官方本地化键。`applied:false` 的行在 HD 页灰显并显示 `hd.notApplied` 提示。

### 2.1 视频（tab: video）

| key | cap | 类型/默认 | 真实消费者 | 状态 |
|---|---|---|---|---|
| `windowMode` | `WINDOW_MODE` | choice: `windowed`/`borderless`/`fullscreen`，默认 `windowed` | 新增 `src/ui/displayMode.ts`，`applyVideoOptions` 调用；`fullscreen`/`borderless` 走 Fullscreen API，`windowed` 退出 | 生效 |
| `maxForegroundFps` | `MAX_FOREGROUND_FPS` | range 30–300，step 10，默认 300 | 新增 `src/render/frameLimit.ts`，运行时 rAF 节流；浏览器标签页本身有 vsync 时只降不升 | 生效 |
| `maxBackgroundFps` | `MAX_BACKGROUND_FPS` | range 15–60，step 5，默认 30 | 同上，`document.hidden` 时切换上限 | 生效 |
| `spellDetail` | `PREF_VIDEO_SPELLS` | choice `low`/`medium`/`high`，默认 `high` | 需要 vendored viewer 增加法术粒子倍率桥接；本次先接 `VideoBridge.spellParticleScale`，补丁未落地前 `applied:false` | 灰显 |
| `foliage` | `PREF_VIDEO_FOLIAGE` | choice `off`/`low`/`medium`/`high`，默认 `high` | 无独立植被层；树木/灌木与地形装饰同属 doodad，无法诚实分档 | 灰显 |
| `antialiasing` | `PREF_VIDEO_ANTIALIASING` | bool，默认 true | WebGL context 创建时读取；改动后需重载地图/页面，保存时提示重载（复用 `askArtReload` 形态） | 生效（重载） |
| `ssao` | `PREF_VIDEO_ASSAO` | bool，默认 false | 无 AO pass | 灰显 |
| `bloom` | `PREF_VIDEO_BLOOM` | bool，默认 false | 无 bloom pass | 灰显 |
| `portraitBloom` | `PREF_VIDEO_PORTRAIT_BLOOM` | bool，默认 false | 无 portrait bloom pass | 灰显 |

已有行保留：`gamma`、`resolution`、`vsync`、`menus43`、`lowPerf`、`modelDetail`、`animQuality`、`textureQuality`、`particles`、`lights`、`shadows`、`occlusion`。
显示器选择（官方 `MONITOR` / `PREF_VIDEO_ADAPTER`）不加入：浏览器没有显示器枚举权。

### 2.2 声音（tab: sound）

| key | cap | 类型/默认 | 消费者 | 状态 |
|---|---|---|---|---|
| `musicEnabled` | `MUSIC` | 已有模型，补 UI 行 | `applyAudioOptions` | 生效 |
| `soundEnabled` | `SOUND_EFFECTS` | 已有模型，补 UI 行 | `applyAudioOptions` | 生效 |
| `muteFocusLoss` | `PREF_SOUND_WINDOW_FOCUS` | bool，默认 false | 新增 `src/audio/focusMute.ts`，监听 `visibilitychange`/`blur`/`focus`，对 SoundBoard 总线置零/恢复 | 生效 |
| `musicOverride` | `MUSIC` | choice，默认 `default` | 无音乐包覆盖机制 | 灰显 |
| `classicSound` | `OPTION_CLASSIC_SOUND` | bool，默认 false | 无第二套音效库 | 灰显 |

输出设备（官方 `OPTIONS_SOUND_DEVICE` / `PREF_SOUND_OUTPUTDEVICE`）不加入。

### 2.3 游戏（tab: gameplay）

| key | cap | 类型/默认 | 消费者 | 状态 |
|---|---|---|---|---|
| `heroFrames` | `HERO_STATUS_BAR` | bool，默认 true | `worldOverlays.ts`：关闭后英雄使用普通血条（无金框/等级格） | 生效 |
| `heroLevel` | `SHOW_HERO_LEVEL` | bool，默认 true | `worldOverlays.ts`：只隐藏等级数字 | 生效 |
| `formationMovement` | `ENABLE_FORMATION_MOVEMENT` | bool，默认 true | `rts.ts` 两处 `groupTargets`：关闭时全员点同一个落点 | 生效 |
| `cooldownNumbers` | `SHOW_COOLDOWN_TIMER` | bool，默认 true | `hud.ts` 命令卡/物品栏冷却数字显隐（扫描条仍保留） | 生效 |
| `goldMineCounter` | `OPTIONS_GOLDMINE_UNIT_COUNTER` | bool，默认 true | `worldOverlays.syncCrewLabels`：关闭时隐藏矿工计数 | 生效 |
| `hudScale` | `HUD_SCALE` | range 50–150，step 5，默认 100 | `hud.ts` 把 `--hud-scale` 写到 `.hud`（`zoom`，底部居中）；世界层血条不缩放 | 生效 |
| `showTimeElapsed` | `HUD_TIME_ELAPSED` | bool，默认 false | `hud.ts` 顶部资源条增加已用时长 `MM:SS` | 生效 |
| `displayFps` | `OPTIONS_GP_FPS` | bool，默认 false | `ui/metrics.ts`：开启时自动显示性能条并只显示 FPS | 生效 |
| `displayPing` | `OPTIONS_GP_PING` | bool，默认 true | 同上，性能条显示 ping | 生效 |
| `displayApm` | `OPTIONS_GP_APM` | bool，默认 false | `MetricsOverlay.frame` 增加 apm 参数；单机隐藏 | 生效 |
| `gameSpeed` | `GAME_SPEED` | choice `slow`/`normal`/`fast`，默认 `normal` | `data/gameSpeed.ts` 已有；作为新比赛默认 | 生效 |
| `profanityFilter` | `OPTION_PROFANITY` | bool，默认 false | 新增 `game/chatFilter.ts`，对聊天正文做轻度星号过滤 | 生效 |
| `peonDoubleTapFocus` | `OPTION_PEON_DOUBLETAP_FOCUS` | bool，默认 true | `mapViewer.ts` 双击选同类：关闭时不扩展选择 | 生效 |
| `opponentChat` | `OPPONENT_CHAT_ENABLED` | bool，默认 true | `game/chat.ts`/HUD：按 scope 过滤接收与发送 | 生效 |
| `teamChat` | `TEAM_CHAT_ENABLED` | bool，默认 true | 同上 | 生效 |
| `observerChat` | `OBSERVER_CHAT_ENABLED` | bool，默认 true | 同上 | 生效 |
| `globalChat` | `GLOBAL_CHAT_ENABLED` | bool，默认 true | 同上 | 生效 |
| `gameInfoMessages` | `OPTION_GAME_INFO_MESSAGES` | bool，默认 true | HUD 系统消息区过滤 | 生效 |
| `enhancedTooltips` | `ENHANCED_TOOLTIPS` | bool，默认 true | 悬停提示扩展行；现有提示无独立扩展开关，需在生成处加 gate | 待实现，暂灰显 |
| `subgroupOrder` | `SUBGROUP_MODIFIER` | bool，默认 true | 子组顺序修饰键；现有热键路径未暴露 | 灰显 |
| `denyIcon` | `SHOW_DENY_ICON` | bool，默认 true | 禁止目标图标绘制未实现 | 灰显 |
| `hudSidePanels` | `HUD_SIDEPANELS` | bool，默认 false | 无侧面板布局 | 灰显 |
| `cinePortraits` | `OPTIONS_SHOW_CINE_PORTRAITS` | bool，默认 true | 过场强制头像；未接 | 灰显 |
| `sdCampaignScreens` | `OPTIONS_SD_CAMPAIGN_SCREENS` | bool，默认 false | HD 线无 SD 战役界面 | 灰显 |
| `teenFilter` | `OPTION_TEEN` | bool，默认 false | 青少年内容过滤未实现 | 灰显 |
| `advancedObserverUI` | `OBSERVER_OPTION_BTN` | bool，默认 false | 高级观察者 UI 未实现 | 灰显 |
| `useSkins` | `OPTION_USE_SKINS` | bool，默认 true | 皮肤选择已有 `uiTheme`/`hdArt`；此开关无独立消费者 | 灰显 |
| `classicCursor` | `OPTION_CLASSIC_CURSOR` | bool，默认 false | 经典指针美术未实现 | 灰显 |
| `oldTerrain` | `OPTIONS_OLD_TERRAIN` | bool，默认 false | 旧地形渲染未实现 | 灰显 |

### 2.4 输入（tab: input）

| key | cap | 类型/默认 | 消费者 | 状态 |
|---|---|---|---|---|
| `confineMouse` | `PREF_INPUT_CONFINE_MOUSE_CURSOR` | choice `off`/`on`/`auto`，默认 `auto` | `ui/mouseCapture.ts`：`off` 不接管指针；`on`/`auto` 维持现行为 | 生效 |
| `reduceMouseLag` | `PREF_INPUT_REDUCE_MOUSE_LAG` | bool，默认 false | `requestPointerLock({ unadjustedMovement: true })`，失败静默回退 | 生效 |

Mac 三项（`PREF_INPUT_MAC_*`）不加入。自定义键位已有 `hotkeys` 行。

### 2.5 画面（tab: graphics）

| key | cap | 默认 | 消费者 | 状态 |
|---|---|---|---|---|
| `artEnvironment` | `PREF_REFORGED_ADDONS_ENVIRONMENT` | true | `data/artCategories.ts` + `render/assetSolver.ts`：关闭时该类资产回退 SD 线 | 生效 |
| `artUnits` | `PREF_REFORGED_ADDONS_UNITS` | true | 同上 | 生效 |
| `artHeroes` | `PREF_REFORGED_ADDONS_HEROES` | true | 同上 | 生效 |
| `artBuildings` | `PREF_REFORGED_ADDONS_BUILDINGS` | true | 同上 | 生效 |
| `artIcons` | `PREF_REFORGED_ADDONS_ICONS` | true | 同上 | 生效 |
| `artVfx` | `PREF_REFORGED_ADDONS_VFX` | true | 同上 | 生效 |
| `artOldEnvironment` | `PREF_REFORGED_ADDONS_ENVOLD` | false | 同上 | 生效 |
| `language` | `LANGUAGE` | choice：Reforged 全部 12 种语言（`enUS`/`deDE`/`esES`/`esMX`/`frFR`/`itIT`/`koKR`/`plPL`/`ptBR`/`ruRU`/`zhCN`/`zhTW`），由 `LOCALES` 生成 | `src/i18n` 的语言选择；保存后 reload。自有文案仅英/简中，其余语言回退英文；游戏数据与安装包 FDF 使用所选语言 | 生效 |

## 3. 代码改动点（精确）

### 3.1 `src/data/options.ts`
- `OptionDef` 增加可选 `min?: number; max?: number; step?: number;`（range 行使用）。
- `OptionDef.panel` 扩展为 `"gameplay" | "video" | "sound" | "input" | "graphics"`。
- 新增 `OPTION_DEFS` 条目，键名/默认/选择项见 §2。
- 新增 `applyInputOptions` 调用点不放在模型层；由 `ui/hd/options.ts` 的 `applyAll` 分发。
- 保持 `loadOptions` 的按类型合并逻辑，新增 bool/range/choice 均自动持久化。
- `replayWindowOptions` 无需特殊处理，新键随存储整体传递。

### 3.2 新模块
- `src/render/gameplayOptions.ts`
  - `applyGameplayOptions(opts: Options): void`
  - 导出读取器：`heroStatusFrames()`, `showHeroLevel()`, `showCooldownNumbers()`, `showGoldMineCounter()`, `formationMovement()`, `peonDoubleTapFocus()`, `showTimeElapsed()`, `profanityFilterEnabled()`, `chatScopeEnabled(scope)`, `gameInfoMessagesEnabled()`, `hudScale()`。
- `src/render/cameraOptions.ts`
  - `applyCameraOptions(opts)`, `enhancedZoom()`, `defaultCameraDistance()`, `maxCameraDistance()`。
  - 默认值与 `mapViewer.ts` 当前 `MELEE_START` / `ZOOM_MAX` 一致；增强缩放开启时放宽上下限。
- `src/render/inputOptions.ts`
  - `applyInputOptions(opts)`, `mouseConfinement(): "off"|"on"|"auto"`, `reduceMouseLag(): boolean`。
- `src/render/frameLimit.ts`
  - `applyFrameLimits(opts)`, `foregroundFps()`, `backgroundFps()`。
  - 通过包装 `requestAnimationFrame` 实现运行时上限；与现有 boot 期 `frameCap.ts` 共存：boot 补丁先装，本模块只在其上再限流。
- `src/audio/focusMute.ts`
  - `installFocusMute()`, `applyFocusMute(opts)`；监听 `visibilitychange`/`blur`/`focus`，把主增益置零/恢复。
- `src/ui/displayMode.ts`
  - `applyWindowMode(mode)`：`fullscreen`/`borderless` 请求 Fullscreen API，`windowed` 退出；失败静默。
- `src/data/artCategories.ts`
  - `applyArtCategories(opts)`, `artCategoryEnabled(cat: "environment"|"units"|"heroes"|"buildings"|"icons"|"vfx"|"envold")`。
- `src/game/chatFilter.ts`
  - `filterProfanity(text: string): string`，短词表 + 整词匹配，避免误伤 URL/命令。

### 3.3 `src/ui/hd/options.ts`
- `LAYOUT` 重排为官方三列结构：
  - video: 左列 `MONITOR_SETTINGS`（windowMode/gamma/resolution/vsync/menus43/lowPerf），右列 `GRAPHICAL_QUALITY`（texture/particles/spellDetail/foliage/shadows/antialias/ssao/bloom/portraitBloom/modelDetail/animQuality/lights/occlusion）。
  - sound: 左列音量与开关、音乐覆盖/经典音效；中列环境/移动/单位/环境效果/定位音频/失焦静音；右列字幕与语言。
  - gameplay: 左列 UI（heroFrames/heroLevel/healthBars/healthBarStyle/tooltips/subgroup/formation/cooldown/deny/goldMine/hudScale/sidePanels/showHotkeys/time/fps/ping/apm/cine/sdCampaign）；中列镜头（enhancedZoom/defaultZoom/maxZoom）与行为（teen/profanity/observer/skins/cursor/peon/oldTerrain）；右列录像与通信（autosave/share/四类聊天/gameInfo）。
  - input: 左列滚动，右列控制。
  - graphics: 三张美术卡 + 7 个分类开关 + 语言。
- `row(d)` 支持 `min/max/step`；对 `applied:false` 的行加 `hd-opt-disabled` 并将控件 `disabled`，标题/说明使用 `t("hd.notApplied")`。
- 文案解析新增 `strOpt(key)`：先 `str(key)`；当库返回原键（安装包无此字符串）时回退 `t("opt." + key)`。
- `applyAll`/`commit` 分发新增 `applyInputOptions`、`applyCameraOptions`、`applyFrameLimits`、`applyArtCategories`。
- 保存时若 `windowMode`、`antialiasing` 或 `language` 变化，弹出重载提示（复用 `askArtReload` 的弹窗结构），确认后 `location.reload()`。

### 3.4 `src/ui/hud.ts`
- `updateCooldownOverlays`（约 L4092）与物品栏冷却（约 L3689）：`showCooldownNumbers()` 为 false 时只隐藏 `cmdCdText`/`invCdText` 文本，保留扇形。
- 新增 elapsed 元素挂在顶部资源条容器内；`showTimeElapsed()` 控制显隐，文本来自现有比赛时钟秒数。
- `hudScale()` 写入 `document.documentElement.style.setProperty("--hud-scale", v/100)`；`style.css` 中 `.hud { zoom: var(--hud-scale, 1); }` 并以底部中心为 transform-origin（`zoom` 不影响命中测试）。

### 3.5 `src/render/worldOverlays.ts`
- `syncBars`：`heroStatusFrames()` 为 false 时不加 `is-hero`，隐藏等级格与金框；`showHeroLevel()` 为 false 时只隐藏等级数字。
- `syncCrewLabels`：`showGoldMineCounter()` 为 false 时把池中标签全部隐藏并返回。

### 3.6 `src/render/mapViewer.ts`
- 相机常量：`ZOOM_MIN`/`ZOOM_MAX`/`MELEE_START` 改为通过 `cameraOptions` 读取；`zoomStopDistance`/`zoomStopOf` 使用当前上下限。
- 双击选同类（约 L1470、L19957）：`peonDoubleTapFocus()` 为 false 时不扩展。
- `allow antialias`：WebGL context 创建参数读取 `videoSettings().antialias`。
- 过场头像强制路径（`consoleTransmission` 附近）按 `cinePortraits` gate（本次先灰显，若实现则改为生效）。

### 3.7 `src/game/rts.ts`
- 两处 `groupTargets`（L11103、L11129）按 `formationMovement()` 选择：开=现有环形阵型；关=全员使用点击点。

### 3.8 聊天
- `src/game/chat.ts`：`chatRecipients` 按 `chatScopeEnabled` 过滤 scope；`formatChatLine` 前应用 `filterProfanity`。
- HUD 系统消息（`WorldFrameMessage`）按 `gameInfoMessagesEnabled()` 过滤。

### 3.9 `src/ui/metrics.ts` 与其调用点
- `frame(dtMs, units, ping, apm?)`。
- 可见性由 `displayFps || displayPing || displayApm` 决定；三项各自控制对应文本。
- 单机时 apm 显示 `-`。

### 3.10 `src/ui/mouseCapture.ts`
- `canCapture` 先看 `mouseConfinement()`：`off` 直接 false。
- `requestPointerLock` 按 `reduceMouseLag()` 传 `{ unadjustedMovement: true }`，失败回退普通调用。

### 3.11 `src/i18n/index.ts`
新增 `opt.*` 键（EN/ZH 各一份），至少覆盖 §2 全部新增 `cap` 与选择项：
`opt.WINDOW_MODE`, `opt.WINDOW_MODE_WINDOWED`, `opt.WINDOW_MODE_WINDOWED_FULLSCREEN`, `opt.WINDOW_MODE_FULLSCREEN`, `opt.MAX_FOREGROUND_FPS`, `opt.MAX_BACKGROUND_FPS`, `opt.PREF_VIDEO_SPELLS`, `opt.PREF_VIDEO_FOLIAGE`, `opt.PREF_VIDEO_ANTIALIASING`, `opt.PREF_VIDEO_ASSAO`, `opt.PREF_VIDEO_BLOOM`, `opt.PREF_VIDEO_PORTRAIT_BLOOM`, `opt.MUSIC`, `opt.SOUND_EFFECTS`, `opt.PREF_SOUND_WINDOW_FOCUS`, `opt.OPTION_CLASSIC_SOUND`, `opt.HERO_STATUS_BAR`, `opt.SHOW_HERO_LEVEL`, `opt.ENABLE_FORMATION_MOVEMENT`, `opt.SHOW_COOLDOWN_TIMER`, `opt.OPTIONS_GOLDMINE_UNIT_COUNTER`, `opt.HUD_SCALE`, `opt.HUD_TIME_ELAPSED`, `opt.OPTIONS_GP_FPS`, `opt.OPTIONS_GP_PING`, `opt.OPTIONS_GP_APM`, `opt.GAME_SPEED`, `opt.OPTION_PROFANITY`, `opt.OPTION_PEON_DOUBLETAP_FOCUS`, `opt.OPPONENT_CHAT_ENABLED`, `opt.TEAM_CHAT_ENABLED`, `opt.OBSERVER_CHAT_ENABLED`, `opt.GLOBAL_CHAT_ENABLED`, `opt.OPTION_GAME_INFO_MESSAGES`, `opt.ENHANCED_TOOLTIPS`, `opt.SUBGROUP_MODIFIER`, `opt.SHOW_DENY_ICON`, `opt.HUD_SIDEPANELS`, `opt.OPTIONS_SHOW_CINE_PORTRAITS`, `opt.OPTIONS_SD_CAMPAIGN_SCREENS`, `opt.OPTION_TEEN`, `opt.OBSERVER_OPTION_BTN`, `opt.OPTION_USE_SKINS`, `opt.OPTION_CLASSIC_CURSOR`, `opt.OPTIONS_OLD_TERRAIN`, `opt.PREF_INPUT_CONFINE_MOUSE_CURSOR`, `opt.PREF_INPUT_REDUCE_MOUSE_LAG`, `opt.PREF_REFORGED_ADDONS_*`, `opt.LANGUAGE`。
另加 `hd.notApplied`（“当前版本暂不支持”/“Not available in this build”）。

## 4. 明确跳过项

| 官方项 | 原因 |
|---|---|
| `MONITOR` / `PREF_VIDEO_ADAPTER` | 浏览器无法枚举/切换显示器 |
| `OPTIONS_SOUND_DEVICE` / `PREF_SOUND_OUTPUTDEVICE` | 浏览器无法选择音频输出设备 |
| `PREF_INPUT_MAC_DISABLE_OS_SHORTCUTS` / `MAC_USE_STD_FUNC_KEYS` / `MAC_USE_CMD_AS_CTRL` | macOS 原生键盘行为，Web 页无对应 API |
| 经典热键标签页 | 已按用户要求移除，快捷键编辑器在游戏内 选项→游戏 |

## 5. 验证

1. `./node_modules/.bin/tsc --noEmit` 零错误。
2. `http://localhost:5173/?dev&flavor=hd`：
   - 五个标签页均可打开，布局不溢出；窄窗口（≤1280×720）与 1080p 均正常。
   - 每个新增行可见：生效行可操作；灰显行置灰并有提示。
   - 中/英切换下标题与选项文案均正确，无裸键名（如 `PREF_VIDEO_SPELLS`）。
3. 游戏内 `?dev&flavor=hd&map=(2)BootyBay`：
   - 冷却数字开关、金矿计数、英雄等级/状态条、阵型开关、HUD 缩放、已用时间、FPS/Ping/APM、双击选同类、四类聊天过滤逐项验证。
   - 鼠标限制/降低延迟在进入比赛后验证。
4. 刷新后设置仍保留；Reset 恢复默认；Cancel 回滚；OK 持久化。
5. 经典 SD 选项页 `?dev`（不进 HD 参数）不受影响。

## 6. 审批

本 Spec 需用户批准后再进入实现。批准后按 `tasks.md` 分阶段执行，每阶段跑 tsc 并做浏览器验证。
