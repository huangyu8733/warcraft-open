# 手势控制台 Tasks

## 已完成

- [x] L0 `device.ts`：能力快照、`gestureEnabled()`（`?gesture` 调试门 + 触摸判定）、
      首启画质建议（手机 576p / 平板 720p / HD 手机 450p + Low Performance Mode）。
- [x] L1 `geometry.ts`：`getBoundingClientRect()` 热区缓存、`areaAt()`、canvas CSS 像素换算、
      安全区与系统手势禁区。
- [x] L1 `intents.ts` + `recognizer.ts`：tap / longpress / doubletap / dragbox / swipe /
      pinch / twoFingerPan / twoFingerTap / threeFingerTap / fourFingerTap，`claims()` 仲裁，
      `pointercancel` 全清。
- [x] `edgeHold`：安全区边缘带按住 220ms 后按 720px/s 持续平移，走 `panBy` → `midPan`；
      抬手 / 离开带 / 转多指即停，且不再产出轻点 / 长按。
- [x] `main.ts`：多指 `touchmove` 改为 `!gestureClaims()` 才拦截；`startGesture()`；
      手势开启时跳过 Pointer Lock。
- [x] `inputSource.ts`：`CommandSource` / `SelectionSource` 加 `"gesture"`，override 扩为
      `"voice" | "gesture"`。
- [x] L2 `host.ts` / `actions.ts`：窄宿主接口、`performGesture()`、过场跳过、`canAct()` 零调用、
      轮盘槽位判定。
- [x] `mapViewer.ts`：`installGesture()`、`setGestureHost(null)`、`zoomBy()` 包装。
- [x] L3 `console.ts`：编队条、12 槽轮盘、命令卡镜像（MutationObserver + key diff）、
      教学浮层；`trail.ts` 事件驱动单帧绘制；`feedback.ts` 触觉。
- [x] L4 `profile.ts` + `OPTION_DEFS` 12 个键；HD Input 页 `GESTURE_CONTROL` 段；
      SD 两个选项屏提交时同步 `applyGestureOptions()`。
- [x] i18n：EN 与 ZH 全键（`opt.GESTURE_*` / `gesture.*`）。
- [x] CSS：`#gesture-viewport`（z-index 4，`pointer-events:none`）、`#gesture-stage`
      （z-index 5，容器 none / 子控件 auto）、安全区变量、固定 ≥44px 触摸目标。
      控件尺寸与输入方式无关（不依赖 hover，也不随 `pointer:coarse` 变），所以没有
      按媒体查询分档；`pointer:coarse` 只由 `device.ts` 读一次做设备分级。
- [x] Android：SAF 目录授权、虚拟安装 manifest + ranged file、`ow3native` document-start 注入、
      `ow3android` 原生桥、返回键 → 页面 Escape、锁横屏、旋转事件、UA 标记。
- [x] 测试：`tools/gesture-{intent,action,flavor}-test.cjs` 与 `pnpm gesture:test`；
      已作为一步接入 `pnpm test`（`tools/test.mjs`），不再需要单独记得跑。
- [x] §12 门控补齐（L3 控制台自己的指针状态机）：编队条长按计时器派发前重问
      `canAct()`；页面失焦 / `visibilitychange` / 宿主卸下时清空长按计时器、双指追加、
      镜像按下与打开的轮盘，不再留下悬挂动作。
- [x] 文档：`docs/gesture-control.md`、本 spec 目录。

## 待办

- [ ] **真机 P0 出口**：Android 安装 APK → 授权 SD 目录 → 进一张 SD 图并点选单位；
      验证横屏常亮、返回键、振动。
- [ ] 真机 / 桌面触屏 P2 出口：纯手势打完一局 SD melee，并与鼠标操作对比 Command 流。
- [ ] P6 回归：`pnpm build` / `pnpm app:test` 已全绿（2026-11-19，含两处过期测试断言、
      `.sim-build` CJS 标记修复，以及 Node 25 下 `electron-server-test` 退出时
      `process.exit` 触发的 libuv 断言改为 `process.exitCode`）；`pnpm perf:report` 待
      `pnpm dev` 实跑一局后对比开 / 关（p50/p95/worst ±5%）。
- [ ] HD 平板实测：主菜单 / Options / 输入框触摸可用，无白屏；HD 手机确认首启降档提示可接受。
- [ ] （可选）手势重映射编辑器 + `warcraft-open.gestures`。
- [ ] （可选）`holdMove` 虚拟摇杆。
- [ ] （可选）竖屏独立布局（方案 P5）。
