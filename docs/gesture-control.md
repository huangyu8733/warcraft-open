# 触摸手势控制台

设计依据：[`手机平板手势控制台方案.md`](../手机平板手势控制台方案.md)。本文只记录**已落地**的
行为、接线与验证方法；方案里尚未实现的部分集中在文末「尚未落地」。

触及手势子系统前先读本文，尤其是三条硬规则与「不要绕过命令门」一节。

## 1. 它是什么

触屏没有右键、没有 hover、没有修饰键、没有滚轮。手势层把手指的序列翻译成**既有的鼠标 /
键盘动作**，再叠一层可选的屏上控件（编队条、12 槽轮盘、命令卡镜像、轨迹、教学浮层）。

三条硬规则（与 `SD-HD双版本方案.md` 同源）：

1. **一进程一 flavor**：手势是纯本地输入，不进 `Command`、不进房间协议、不进 sim 哈希。
   `device.ts` 只在启动 / resize 时读一次 `flavor()` / `hdArt()`，不订阅变化。
2. **所有门自动继承**：动作全部落到 `runCommand` / `selectAt` / `selectBox` / `orderClickAt` /
   `moveAt` / `midPan` / `setZoomStop` 这些鼠标已在用的函数上，因此 fog、mana、冷却、人口、
   暂停、模态、观战、LAN 权威判定、回放录制全部照旧生效。**绝不**直调 `Authority.execute`，
   也不直接改 `rts.orderMode`。
3. **SD/HD 共用一套手势核心**：识别与动作层 0 处 flavor 分支。唯一按美术变化的是底部
   控制台贴图上沿（`device.consoleTop`：SD 与 HD 的 `hd`/`sd` 美术为 0.1317，`de` 为
   0.1383，均除以 `UI_HEIGHT 0.6` 换成 stage 比例）。

## 2. 文件

| 层 | 文件 | 职责 |
| --- | --- | --- |
| L0 | [`src/ui/gesture/device.ts`](../src/ui/gesture/device.ts) | 能力快照（设备分级 / 安全区 / 平台 / 画质建议）、`gestureEnabled()` 唯一判定点 |
| L1 | [`geometry.ts`](../src/ui/gesture/geometry.ts) | `getBoundingClientRect()` 热区缓存、`areaAt()`、client→canvas CSS 像素、系统手势禁区 |
| L1 | [`intents.ts`](../src/ui/gesture/intents.ts) | `GestureKind` / `GestureIntent` / 阈值默认值 |
| L1 | [`recognizer.ts`](../src/ui/gesture/recognizer.ts) | 多指 Pointer Events 状态机（纯逻辑，不依赖 DOM，可在 Node 里喂合成序列） |
| L1 | [`index.ts`](../src/ui/gesture/index.ts) | 装配：注册监听、仲裁 `gestureClaims()`、坐标换算、调试浮层 |
| L2 | [`host.ts`](../src/ui/gesture/host.ts) | `GestureMatchHost` 窄接口 + `setGestureHost()` |
| L2 | [`actions.ts`](../src/ui/gesture/actions.ts) | `performGesture()`：intent → host 动作，`withInputOverride("gesture")` |
| L3 | [`console.ts`](../src/ui/gesture/console.ts) | 编队条、12 槽轮盘、命令卡镜像、教学浮层 |
| L3 | [`toggle.ts`](../src/ui/gesture/toggle.ts) | 对局右上角的总开关（热起停，不重载页面） |
| L3 | [`hud.ts`](../src/ui/gesture/hud.ts) | 手势模式下的移动端 HUD：借经典小地图、资源条、选择血条、攻击大圆钮 + 12 槽命令环 |
| L3 | [`trail.ts`](../src/ui/gesture/trail.ts) | 轨迹 / 双指连线 canvas（仅活跃指针时 rAF） |
| L3 | [`feedback.ts`](../src/ui/gesture/feedback.ts) | 触觉反馈（Android 桥 → `navigator.vibrate`） |
| L4 | [`profile.ts`](../src/ui/gesture/profile.ts) | `applyGestureOptions()` + 读取器（Options 改完下一事件生效） |

装配点：

- [`src/main.ts`](../src/main.ts)：`applyGestureOptions(bootOptions)`、`startGesture()`，
  并把多指 `touchmove` 的 `preventDefault` 改成 `!gestureClaims()` 才拦截。
- [`src/render/mapViewer.ts`](../src/render/mapViewer.ts)：`installGesture()` 注入宿主，
  match 销毁时 `setGestureHost(null)`。
- [`src/ui/inputSource.ts`](../src/ui/inputSource.ts)：`CommandSource` / `SelectionSource` 加
  `"gesture"`，override 来源扩为 `"voice" | "gesture"`。

## 3. 手势映射（默认 profile）

| 手势 | 区域 | 落到哪 | 说明 |
| --- | --- | --- | --- |
| 轻点 | 世界 | `selectAt`；瞄准 / 放置中 → `orderAt` | 与左键第一次点击同义 |
| 轻点 | HUD / 命令卡 / 小地图 | 由它们自己的 `pointerdown` 处理 | 动作层直接返回，不设 override，避免把紧接着的原生点击记成手势 |
| 长按（静止） | 世界 | `smartAt` → `moveAt` | 触屏的「右键」；派生 attack / follow / harvest / garrison 全在 `moveAt` 里 |
| 长按 | HUD | `hoverAt` | 触屏没有 `:hover`，长按读 tooltip |
| 长按后拖动 | 世界 | `selectBox` | 超过 `tapSlopPx` 立即取消长按计时 |
| 双击 | 世界 | `selectAt(..., { sameType: true })` | 同类全选 |
| 快速滑动 | 空白世界 | `panBy` | 与框选按「时长 + 位移」区分 |
| 边缘按住 | 世界边缘带 | `panBy` | 220ms 后按 720px/s 朝屏幕内侧持续平移；离开带 / 抬手即停 |
| 双指捏合 | 任意 | `zoomBy(steps)` | 每 0.15 距离比 = 1 档，夹到 7 档 `ZOOM_STEPS` |
| 双指平移 | 任意 | `panBy` | 质心位移，走与中键拖拽相同的 `midPan` |
| 双指轻点 | 任意 | `cancel()` | 取消建造放置 / 解除 armed（Escape 同义） |
| 三指轻点 | 平板 + 开关 | `toggleMenu()` | 默认关，避免与系统多指手势冲突 |
| 四指轻点 | 平板 + 开关 | `toggleChat()` | 默认关 |
| 轮盘 | 常驻控件 | `press(card[slot].id)` | 12 槽 = `row * 4 + col`；灰掉 / 被动 / 空槽不按 |
| 编队图标（手势 HUD） | 右下大圆钮左侧半圆 | `groups()` / `group()` / `clearGroup()` | 图标常驻：点=选中该队，选中组正下方出现 ×；末尾加号一键把当前选择编成新队；图标是首单位原图 |
| 命令卡镜像 | 平板常驻 | `press(id)` | 数据来自 `host.card()`，与 HUD 同一份，不自己解析资源 |
| 过场中轻点 / 双指轻点 | 任意 | `skipCinematic()` | 过场里 `canAct()` 必假，这是唯一先于它的例外 |

### 3.1 阈值

默认值在 `intents.ts`，其中两项由 Options 覆盖：

| 常量 | 手机 | 平板 | 可改 |
| --- | --- | --- | --- |
| `tapSlopPx` | 12 | 16 | 是（8–24） |
| `longPressMs` | 420 | 420 | 是（300–800，step 25） |
| `doubleTapMs` / `doubleTapDistPx` | 300 / 24 | 同 | 否 |
| `swipeMinDistPx` / `swipeMaxMs` | 60 / 400 | 同 | 否 |
| `pinchStepRatio` | 0.15 | 同 | 否 |
| `edgeHoldMs` / 边缘带 | 220ms / 48px | 同 | 否（带从系统禁区边界再向内量） |
| 系统手势禁区 | 24px | 28px | 否（再叠加 `safeInsets`） |

### 3.2 仲裁与坐标

- 只收 `pointerType === "touch"`（`index.ts` 放行 `pen`）。鼠标 / 触控板不经识别器。
- `gestureClaims()`（`recognizer.claims()`）：开关打开、活跃指针 ≥ 2、质心在手势层热区。
  只有它为真时 `main.ts` 才不拦截多指 `touchmove`；单指从不抢浏览器。关闭手势时**一个
  监听都不注册**，行为与无手势版本一致。
- 热区：`geometry.ts` 一律用 `getBoundingClientRect()`，只在 resize / orientation /
  `ow3android:config` / 宿主可见性变化时重算；世界交互传 canvas CSS 像素（`rts.ts` 自己
  处理 dpr），HUD / 卡 / 小地图保持 client 像素。
- 失焦、`visibilitychange`、`pointercancel` 整组清空，不产生任何 intent。
- 鼠标的边缘滚屏在触摸 / 触控笔指针上关闭（`mapViewer` 的 `trackCursor`）：手指靠近画面
  边缘只走 `edgeHold`，既不会与它叠加成双倍平移，也不会在抬手后继续滚屏；真鼠标下一次
  移动即恢复该行为。

## 4. 门控（唯一入口）

`performGesture()` 先看 `host.isCinematic()`（只放行跳过过场），再问一次 `host.canAct()`。
`canAct()` 在 `installGesture()` 里定义为：

```
hud.acceptsInput() && !hardPaused && userControl && !anyModalOpen() && !isTyping(document.activeElement)
```

为假时**零调用**。常驻控件同样由 `syncGestureConsole()` 按 `body.in-game && !anyModalOpen()
&& host.canAct()` 决定显隐，并在隐藏时收起轮盘。所有手势层 z-index ≤ 6，容器
`pointer-events: none`、子控件 `auto`，模态 / 加载屏永远盖得住。

回放 / APM 输入轨：动作包在 `withInputOverride("gesture", ...)` 里，合成点击不会被
`inputSource.ts` 误判成 `"gamepad"`。

## 5. Options

选项真源在 [`src/data/options.ts`](../src/data/options.ts) 的 `OPTION_DEFS`（`panel: "input"`），
键：`gestureEnabled`、`gestureLayout`、`gestureHandedness`、`gestureLongPressMs`、
`gestureTapSlopPx`、`gesturePinchZoom`、`gestureLongPressIsRightClick`、`gestureHaptics`、
`gestureTrail`、`gestureCardMirror`、`gestureShowHints`、`gestureMultiFinger`。

- **HD**：Options → Input → **触摸手势控制台**，UI 在 `ui/hd/options.ts`。
- **SD**：经典选项屏只有 gameplay / video / sound 三页，没有 Input 页（`confineMouse` 等
  既有 input 选项同样不在那里）。SD 侧不新增 FDF 帧，只由 `fdfOptions.ts` / `escOptions.ts`
  在提交时调用同一个 `applyGestureOptions()`，保证一次会话里改过的值不会变旧。
- **总开关热生效规则**：对局内开关（右上角）关掉 / 打开都立即生效 —— `index.ts` 的
  `setGestureEnabled()` 会挂上或摘掉整层（识别器、轨迹、控制台、Android 返回键接管）；
  `hd/options.ts` 的 `commitSave()` 仍保留一次重载提示，只是现在重载已非必需。
- **默认与可切换性**：手机 / 平板默认手势，桌面（含触屏笔记本）默认鼠标。默认值在
  `data/options.ts` 的 `deviceGestureDefault()` 里按设备定；任何平台都能在 Options 或右上角
  切到手势、再切回鼠标。显式选择由 `saveOptions()` 写进独立的 `warcraft-open.gesture-mode`
  （`storedGestureMode()`），刷新后保持——旧存档里那个默认写下的 `true` 不会被误当成选择。
- **对局内开关**：屏幕右上角（安全区内，44px 命中区）的「手势：开 / 关」按钮，
  由 [`ui/gesture/toggle.ts`](../src/ui/gesture/toggle.ts) 挂载、只在对局里显示。
  打开后**经典 HUD 让位**，换成 [`ui/gesture/hud.ts`](../src/ui/gesture/hud.ts) 的移动端布局：
  左上小地图（复用经典 HUD 的节点，退出时原样放回）、顶部资源、左下单位头像 + 选择血条、
  头像上方六格物品栏（同样复用经典节点，拖动 / 使用行为不变）、
  右下攻击大圆钮 + 12 槽命令环、右上「菜单」。被隐藏的只有控制台 FDF 屏
  （`fdf-topbar`）、`.hud-console` 与消息列；F10 对话框 / 记分板 / 多面板 / 过场面板不受影响。
  关掉开关即恢复经典 HUD。`?gesture=1` 调试页里同样可以关掉。
- 首启画质建议：`adoptTouchVideoDefaults()` 只在 `localStorage` 里没有任何选项存档时写入
  （手机 576p、平板 720p；HD 手机 450p / 30fps；Low Performance Mode 默认关闭），
  绝不覆盖玩家选择。

## 6. Android 壳（P0 的资产来源）

页面仍是同一份构建产物；APK 里**不含任何暴雪资产**。

[`android/.../MainActivity.java`](../android/app/src/main/java/me/hhkj/warcraft/MainActivity.java)：

1. **目录授权**：`ACTION_OPEN_DOCUMENT_TREE` + `takePersistableUriPermission`，按 flavor
   分别记在 `SharedPreferences("ow3android")` 的 `install:sd` / `install:hd`。HD 不回退到 SD。
2. **虚拟安装**：`WebViewClient.shouldInterceptRequest` 只答本页 origin 上的
   `/ow3-install/<flavor>/manifest.json` 与 `/ow3-install/<flavor>/file?path=…`，后者支持
   `Range`（CASC 的 `data.NNN` 按切片读）与 `HEAD`。manifest 形状与
   `src/assets/remoteInstall.ts` 的 `InstallManifest` 一致（archives / maps / languageFiles /
   campaigns / casc / customKeys）。
3. **注入页桥**：`WebViewCompat.addDocumentStartJavaScript` 在首个模块前把 `ow3-install://…`
   的 `fetch` 改写到同源路由，并提供 `window.ow3native`（`installPath` / `pickInstall` /
   `forgetInstall` / `flavor`），所以 `src/assets/nativeInstall.ts` **没有 Android 分支**。
   不支持 document-start 的旧 WebView 回退到 `onPageStarted`。
4. **原生能力**（`ow3android`）：`vibrate`、`keepScreenOn`、`setOrientation`、
   `showKeyboard` / `hideKeyboard`、`safeInsets`（物理像素，页面按 `devicePixelRatio`
   换成 CSS 像素再与热区比较）、`setBackHandled`。
5. **返回键**：有对局时页面调 `setBackHandled(true)` 声明接管，壳把返回键派发成
   `ow3android:back`；页面收到后派发一次真实 Escape，交给既有键盘语义（取消 armed /
   收起聊天行 / F10 面板），不再 `goBack()`。没有对局时交还页面历史。
6. **方向与配置**：Manifest 锁 `sensorLandscape`；`configChanges` 保留，旋转时
   `onConfigurationChanged` 派发 `ow3android:config` 让手势层重算热区；`adjustResize`、
   `resizeableActivity`、触摸 feature 均 `required=false`。

构建：`pnpm dist:android`（需要本机 JDK + Android SDK，仓库内不提交 `local.properties`）。
真机验收：进一张 SD 图并点选单位、横屏常亮、返回键语义、振动可用。

## 7. 测试

```bash
pnpm gesture:test    # tsc -p tools/tsconfig.gesture.json + 三个断言脚本
pnpm typecheck
pnpm test            # 统一入口，已包含 gesture:test（tools/test.mjs）
```

- [`tools/gesture-intent-test.cjs`](../tools/gesture-intent-test.cjs)：合成 Pointer 序列 →
  断言 tap / longpress / dragbox / swipe / pinch / 2-3-4 指 / 门控 / 仲裁。
- [`tools/gesture-action-test.cjs`](../tools/gesture-action-test.cjs)：stub 宿主 →
  断言每个 intent 调用的函数与参数，`canAct() === false` 时零调用，归因为 `"gesture"`。
- [`tools/gesture-flavor-test.cjs`](../tools/gesture-flavor-test.cjs)：同一手势序列在
  `sd` / `hd(× sd|hd|de)` 下产生同一 `Command` 流；并断言只有 `device.ts` 读 flavor。

调试：

- `?gesture=1` 强制打开并挂 `#gesture-debug` 回执（`?gesture=0` 强制关闭）。
- 浏览器可用 CDP `Emulation.setTouchEmulationEnabled` + `Input.dispatchTouchEvent` 注入多指；
  Android 已开 `WebView.setWebContentsDebuggingEnabled(true)`，连 devtools 即可。
- 验收矩阵见方案 §14.2；真机项目（安全区、多指冲突、性能）只能人工过。

## 8. 尚未落地

以下是方案里列出、当前代码**没有**实现的项，别在文档或注释里假装它们存在：

- `holdMove`（虚拟摇杆）：识别器不产出，动作层默认分支直接返回 false。相机平移由双指
  平移、单指快速滑动与边缘按住（`edgeHold`）提供。
- 手势重映射编辑器（`warcraft-open.gestures` + `editor.ts`）：未实现，映射是固定默认表；
  Options 只改阈值与开关。
- 竖屏布局：Manifest 锁横屏，竖屏是方案 P5 的可选项。
- Android 上的存档 / 回放 / 自定义快捷键写入桥：只有读取与目录授权，`saveCustomKeys`、
  `saves`、`replays` 等仍未接，相关按钮在 Android 上不可用。
- HD 手机只做「首启画质降档」这一道 gate，没有单独的 HD 离线资源包。

## 9. 版本一致性（经典版 / 重制版）

两版本的手势界面是**同一套实现**，不是两份界面：

- `src/ui/gesture/*` 里没有任何 flavor 分支；唯一与版本有关的数是 `device.ts` 的
  `consoleTop`（决定可操作区域的下边界，DE 比 SD/HD 高约 0.7% 舞台高度），它不增删控件。
- 对局内只有一套 HUD（`src/ui/hud.ts`）。手势 HUD 把经典 HUD 的 `.hud-minimap` /
  `.hud-portrait` / `.hud-inventory` **借**进 `#gesture-hud`（`adoptMinimap` /
  `releaseMinimap` 等），两版本借的是同一批节点。
- `body.gesture-ui` 的让位清单（`src/style.css` 6814-6835）只按 `fdf-topbar` / `hud-*`
  这类**结构类名**选，不看 flavor；`#gesture-hud` 的显示也只有一条
  `body.gesture-ui #gesture-hud { display: block; }`。
- 实测（2026-11-19，Edge 1194×834，`?dev=1&gesture=1`，选中一个农民）：
  sd 与 hd 的 `#gesture-hud` 子节点、23 个槽位（20 个可见）、8 向移动盘、2 个旋转钮、
  3 个缩放钮、3 个资源 chip、编队条与选择面板的 `getBoundingClientRect` **逐项完全相同**
  （x/y/w/h 一致），经典 `.fdf-screen.fdf-topbar` / `.hud-console` 等在两个版本都是
  `display: none`。差异只在美术：HD 的图标、头像、小地图纹理来自 `.dds`，SD 来自 `.blp`。

回归：`pnpm gesture:test` 的 `tools/gesture-flavor-test.cjs` 除了断言命令流一致，还断言
上面那份让位清单存在、包含八个经典控制台选择器、且不带 flavor 条件；不要在
`src/ui/gesture/` 里新增 `isHd()` / `flavor()` 分支，否则脚本会直接失败。

本地复现：SD 需要 1.30.4 系的安装目录，HD 需要 3.x 的安装目录（启动器的版本闸门各自不同），
例如 `http://localhost:5173/?dev=1&flavor=sd&gesture=1&map=EchoIsles` 与
`http://localhost:5174/?dev=1&flavor=hd&gesture=1&map=BootyBay`。
