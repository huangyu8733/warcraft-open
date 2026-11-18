# HD 选项补全 Tasks

> 依赖 `specs/hd-options-completion/spec.md`。每阶段结束运行 `./node_modules/.bin/tsc --noEmit`，通过后再进入下一阶段。

## 阶段 0：模型与文案地基

- [x] 0.1 `src/data/options.ts`：`OptionDef` 增加 `min/max/step`，`panel` 扩展 `input`/`graphics`。
- [x] 0.2 按 Spec §2 新增全部 `OPTION_DEFS` 条目（含默认值、choices、`applied:false`）。
- [x] 0.3 `src/i18n/index.ts` 增加 `opt.*` 全部键（EN/ZH）与 `hd.notApplied`。
- [x] 0.4 新增 `src/render/inputOptions.ts`、`src/render/gameplayOptions.ts`、`src/render/cameraOptions.ts`、`src/render/frameLimit.ts`、`src/audio/focusMute.ts`、`src/ui/displayMode.ts`、`src/data/artCategories.ts`、`src/game/chatFilter.ts` 的骨架与读取器。

## 阶段 1：HD 选项页布局与控件

- [x] 1.1 `src/ui/hd/options.ts`：重排 `LAYOUT` 为 Spec §3.3 的五页结构。
- [x] 1.2 `row()` 支持 `min/max/step`；灰显 `applied:false` 行并加提示。
- [x] 1.3 `strOpt()` 回退；确保任何新增标签不显示裸键名。
- [x] 1.4 语言行（`language`）与保存后 reload 流程。
- [x] 1.5 `applyAll`/`commit` 接入新 applier。

## 阶段 2：视频与窗口

- [x] 2.1 `applyVideoOptions` 接入 `applyWindowMode`、`applyFrameLimits`。
- [x] 2.2 `frameLimit.ts` 实现前后台 FPS 上限（与 boot `frameCap.ts` 共存）。
- [x] 2.3 `mapViewer.ts` WebGL context 读取 `antialias`；变更时重载提示。
- [x] 2.4 法术/植被/SSAO/Bloom/头像泛光保持灰显（不伪造）。

## 阶段 3：声音

- [x] 3.1 Sound 页补 `musicEnabled`/`soundEnabled` 行。
- [x] 3.2 `focusMute.ts` 接入 `applyAudioOptions` 外层；失焦静音/恢复。
- [x] 3.3 Music Override、Classic Sound 灰显。

## 阶段 4：HUD 与游戏行为

- [x] 4.1 `hud.ts`：冷却数字开关、已用时间、HUD 缩放。
- [x] 4.2 `worldOverlays.ts`：英雄状态条/等级、金矿计数。
- [x] 4.3 `rts.ts`：阵型移动开关。
- [x] 4.4 `mapViewer.ts`：双击选同类开关。
- [x] 4.5 `metrics.ts` 与调用点：FPS/Ping/APM 显隐。
- [x] 4.6 `style.css`：`.hud` 的 `--hud-scale`、elapsed 样式、灰显行样式。

## 阶段 5：镜头与输入

- [x] 5.1 `cameraOptions.ts` + `mapViewer.ts`：增强缩放、默认/最大镜头距离。
- [x] 5.2 `mouseCapture.ts`：`confineMouse` 三态与 `reduceMouseLag`。
- [x] 5.3 验证 Esc 释放、点击重取、输入框/菜单不接管。

## 阶段 6：通信与过滤

- [x] 6.1 `game/chat.ts`：四类聊天 scope 过滤。
- [x] 6.2 HUD 系统消息：`gameInfoMessages` 过滤。
- [x] 6.3 `chatFilter.ts`：脏话过滤接入聊天文本。
- [x] 6.4 青少年/高级观察者/过场头像等无实现项灰显。

## 阶段 7：画面分类与语言

- [x] 7.1 `artCategories.ts` + `assetSolver.ts`：7 类美术开关回退 SD。
- [x] 7.2 Graphics 页加入分类开关与语言行（语言列表为 Reforged 全部 12 种）。
- [x] 7.3 语言切换 reload 后中/英文案正确。

## 阶段 8：回归验证

- [x] 8.1 `./node_modules/.bin/tsc --noEmit`。
- [x] 8.2 HD 选项页五页截图：1920×1080 与 1280×720；中/英各一次。
- [x] 8.3 游戏内逐项验证（Spec §5.3）。
- [x] 8.4 刷新持久化、Reset、Cancel、OK。
- [x] 8.5 经典 SD 选项页无回归。
- [x] 8.6 明确记录仍然灰显的官方项与原因。

## 阶段 9：收尾

- [x] 9.1 汇总实现结果与跳过清单给用户。
- [x] 9.2 清理临时截图/脚本（如有）。
