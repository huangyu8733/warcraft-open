# 手势界面：经典版 / 重制版一致性核查

## 问题

用户要求核对「经典版（sd）和重制版（hd）的手势界面是否完全一样，是不是同一套功能」，若不一致则修到一致。
原话：“经典版和重制版的手势界面要一致，都是同一套功能”“你检查经典版手势界面有没有和重制版一样”。

## 现状与证据（已读代码）

1. **手势层没有版本分支。** `src/ui/gesture/` 内唯一与版本有关的是
   `device.ts` 的 `consoleTop`（`hdArt() === "de" ? 0.1383 : 0.1317`），它只影响
   “可操作区域的下边界”，不增删任何控件；`console.ts` 的 `hudMode` 判定也不看 flavor：
   ```ts
   const hudMode = gestureEnabled() && document.body.classList.contains("in-game") && !!host;
   setGestureUiActive(hudMode);
   ```
2. **对局内只有一套 HUD 实现。** `src/ui/hud.ts` 同时为两个版本构建
   `.hud-minimap` / `.hud-portrait` / `.hud-inventory`；手势 HUD 通过
   `adoptAll()`（`src/ui/gesture/hud.ts` 182-188）把这三种节点**借**进 `#gesture-hud`，
   两个版本借的是同一批类名。
3. **两版本共用同一条 FDF 控制台外框。** `src/ui/consoleUi.ts` 的 `overlayClass` 固定为
   `fdf-ingame fdf-topbar`，`body.gesture-ui` 只按这个类名隐藏（`src/style.css` 6814-6825），
   与 flavor 无关。
4. **已有断言命令流一致。** `tools/gesture-flavor-test.cjs` 结构性检查
   “手势目录只有 device.ts 读 flavor”，行为性检查同一串手势在 sd / hd×hdArt 下产生同一串宿主调用。
   但它**不覆盖渲染面**（借用的经典节点是否存在、经典 chrome 是否让位、控件是否都在屏上）。

结论：代码路径上两版本已经共用一套手势实现；仍需要用真实对局在 sd / hd 下各跑一遍，
确认**渲染结果**也一致，并把「同一套」写成可回归的约束。

## 目标

- 在本地分别以 `flavor=sd` 与 `flavor=hd` 开一局并开启手势（`?gesture=1&play=1`），
  逐项核对下表控件都在、都在同一位置、行为一致。
- 若发现差异：在**共享代码**里修（不加版本分支、不复制第二套 HUD）。
- 把这条约束补进 `docs/gesture-control.md`，并在 `tools/gesture-flavor-test.cjs`
  增加一条覆盖渲染面的检查。

## 核对清单（两版本都必须有）

| # | 控件 | 期望 |
|---|------|------|
| 1 | 左上小地图 | 借用的 `.hud-minimap`，168×156，可点可拖 |
| 2 | 编队条（小地图下方） | 有组才出现，点头像召回并拉镜头，右上垃圾桶清队 |
| 3 | 顶部资源条 金币/木材/人口 | 三个 chip 常驻 |
| 4 | 手势开关（金币左侧） | 鼠标箭头图标，点击切回鼠标操作 |
| 5 | 选择面板（左下） | 头像 + 名称 + 血/蓝条 + 队列数量角标 + × |
| 6 | 货舱行（选择面板内） | 金矿/飞艇里有人时出现，点击卸货 |
| 7 | 物品栏（选择面板内） | 英雄/带背包单位才出现，六格可点 |
| 8 | 右下命令环 | 12 槽，图标 + 快捷键角标，禁用变暗 |
| 9 | 攻击大圆钮 | 位于环中心偏左，点击攻击移动 |
| 10 | 建造 / 学技能 | 工人给建造、英雄给未学技能；先补进命令环空槽，摆不下的留在左侧半弧；学过的技能留在环里且带「+」 |
| 11 | 缩放列（左上，小地图下方） | 放大镜 +/− 两钮 |
| 12 | 八方向移动盘（物品栏上方） | 按住持续平移 |
| 13 | 旋转钮（移动盘上方） | 左/右旋转，松手回正，上限 90° |
| 14 | 菜单钮（右上） | 打开 F10 菜单 |
| 15 | 经典 HUD 让位 | `.fdf-screen.fdf-topbar`、`.hud-console`、`.hud-console-background`、`.hud-minimap-btn`、`.hud-idle-worker`、`.hud-autocam`、`.hud-msgcol`、`.hud-chatcol` 全部不可见 |

## 计划改动

1. **不改代码先测**：本地 dev server（`http://localhost:5173/`）分别打开
   `?flavor=sd&gesture=1&play=1` 与 `?flavor=hd&gesture=1&play=1`，开一局后按上表逐项截图核对；
   同时读取两张截图里各控件的 `getBoundingClientRect`（同一视口尺寸下应逐项相同，
   文本/图标内容允许因美术不同而不同）。
2. **有差异才改**，原则：
   - 缺控件 → 补在 `src/ui/gesture/hud.ts` 的共享 `mount()`，不写版本分支；
   - 经典 chrome 残留 → 把选择器补进 `src/style.css` 6814-6825 的 `body.gesture-ui` 隐藏清单；
   - 借用节点在某一版本不存在 → 让 `adoptAll()` 的 `borrow()` 在节点缺失时保持槽位为空并记录，
     由 `syncGestureHud()` 用同尺寸占位（不引入版本判断）。
3. **回归约束**：
   - `tools/gesture-flavor-test.cjs` 增加一项静态检查：`src/style.css` 的
     `body.gesture-ui` 隐藏清单必须包含上表第 15 行的八个选择器；
   - `docs/gesture-control.md` 增加「版本一致性」小节：两版本共用 `src/ui/gesture/*` 与
     `src/ui/hud.ts`，禁止在 `src/ui/gesture/` 内新增 flavor 分支（`gesture:test` 会拦住）。

## 验收标准

- 同一视口（如 1194×834）下，sd 与 hd 的 `#gesture-hud` 子节点集合一致，
  上表 1-15 项在两版本都成立；控件矩形误差 ≤ 2px（允许美术不同）。
- `npm run gesture:test`、`npx tsc --noEmit`、`npm run cycles` 通过。
- 若改动了游戏代码：重新 `npm run build:web` 并部署，线上 `/play/` 入口 hash 更新，
  浏览器控制台无新增错误。

## 不在本次范围

- 两版本各自的美术差异（HD 图标 / 头像用 `.dds`，SD 用 `.blp`）。
- DE（决定版）专属控制台顶边常量带来的 4px 级可操作区差异。
