# Tasks — 重制版游戏内 HUD 头部/底部控件对齐

> 前置：spec.md 第 7 节三项确认完成。未确认前不改代码。

## [x] T1 基线截图与坐标记录

- 已从代码常量记录基线：
  - 左按钮条顶边 `-0.00125`，右资源条顶边 `+0.000828`，差约 2.2 px @1080p。
  - 英雄栏图标 76 px、血蓝条 76 px。
  - 底部五区：小地图 0.139² @0.0095；头像 0.0747×0.0795 @0.2157；信息 0.2017×0.115 @0.3022；背包 0.0743×0.1116 @0.5133；命令卡 0.1705×0.1275 @0.6165。
- 浏览器截图被用户中断，改用常量与 FDF 数值对照。

## [x] T2 顶部两条统一基线

- 文件：`src/ui/consoleUi.ts`
- 已改：`BAR_TOP = 0`；`RESOURCE_TOP = 0`；`BUTTON_NUDGE_X = 0`；`BUTTON_NUDGE_Y = 0`；删除不再使用的 `STRIP_SLOT_*`、`RESOURCE_ROW_*`、`PX`。
- 保留 `STRIP_ART` 给 `backing()`。
- 静态验证：两条 `SetPoint` 的 y 都为 0，顶边严格同线。

## [x] T3 英雄栏回到官方尺寸

- 文件：`src/ui/hud.ts`、`src/style.css`
- 已改：`HERO_BAR.slot = 69 * HERO_PX`；CSS `--hero-bars-w = slot*72/69`、`--hero-bars = slot*17/69`、`--hero-bar-gap = slot/69`。
- `left = 3px`、`top = 0.032 + 2px`、最多 7 个不变。
- 静态验证：1080p 下图标 69 px、条 72×17 px。

## [x] T4 补第 5 颗阵型按钮（按 spec 默认不执行）

- spec 第 4 节写明「默认不做，等确认」；本次批准未包含该项，故不改。
- 如后续需要，按 spec 的 `CONSOLE_ZONES.formation` + `buildFormationButton()` 方案执行。

## [x] T5 回归

- `npx tsc --noEmit` 通过（退出码 0）。
- 版本/风格覆盖已核对：新版 3.0 的 `sd`/`hd`/`de` 三种风格共用同一套 Reforged FDF 控件几何；旧版 1.30.4 的顶部两条同样按 y=0 摆放、英雄栏同一套 CGameUI 几何。
- 待人工确认：三风格 + 旧版经典的实际截图比对（浏览器验证被用户中断，未执行）。
- 代码层面检查：顶部不压英雄栏、底部洞位未改、命令卡/背包/小地图逻辑未触碰、观察者 HUD 与 `BlzHideOriginFrames` 路径不受影响。
