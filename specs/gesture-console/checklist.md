# 手势控制台验收清单

对应方案 §14.3。状态分三档：**代码满足**（实现与自动化断言已覆盖）、**待验证**（需要真机 /
浏览器手测或性能报告）、**未做**。

| # | 项 | 状态 | 依据 / 备注 |
| --- | --- | --- | --- |
| 1 | 鼠标路径零回归：关掉手势后行为与今天一致 | 代码满足；`pnpm build` / `pnpm app:test` 已全绿（2026-11-19） | `startGesture()` 在关闭时一个监听都不注册；`installMouseCapture()` 仅在无手势时安装 |
| 2 | SD / HD 各能纯手势打完一局 melee | 待验证 | 动作层与控件已具备；需真机跑选单位 / 施法 / 编队 / 建造 / 物品 / 菜单 / 聊天 |
| 3 | 同一手势序列在 4 种 flavor/美术下产生相同 Command 流 | 代码满足 | `tools/gesture-flavor-test.cjs`：sd / hd×sd,hd,de 全通过 |
| 4 | 跨 flavor 房间隔离；`RoomInfo` / 录像头字节不变 | 代码满足 | 未触碰 `game/commands.ts`、`net/protocol.ts`、`replay.ts`、`data/flavor.ts` |
| 5 | 回放输入轨标注 `"gesture"`，旧回放可播 | 代码满足，待录制验证 | `CommandSource` / `SelectionSource` 已加；动作包在 `withInputOverride("gesture")` |
| 6 | 所有 gate 生效：模态 / 聊天 / 过场 / 暂停 / 观战 / 失焦 / `pointercancel` | 代码满足，待手测 | `canAct()` 组合 HUD 门控与 `anyModalOpen` / `isTyping`；失焦与 `visibilitychange` 清空；`pointercancel` 收回一根即作废整串 |
| 7 | 手势层不遮挡 FDF 顶栏 / 命令卡 / 对话框 / 加载屏；`hudScale ≠ 1` 命中一致 | 代码满足，待视觉验证 | z-index ≤ 6；容器 `pointer-events:none`；热区用 `getBoundingClientRect()` 缓存，`syncGestureConsole` 比对 `hudScale()` 模块值后失效重算（对局中改滑条也生效） |
| 8 | 系统手势不误触：三边安全区无热区；双指捏合不缩放页面 | 代码满足，待逐机型 | `isHotZone()` 叠加 `safeInsets` 与 24/28px；WebView 关闭内置缩放；iOS `gesture*` 继续拦截 |
| 9 | Android 真机从资产目录进游戏；横屏常亮、返回键、振动 | **待验证（P0 出口）** | SAF + 虚拟安装 + 页桥已实现；返回键有对局时派发 Escape；触觉走 `ow3android.vibrate` |
| 10 | 手势开关前后 `perf:report` p50/p95/worst 无回归、无每帧 layout read | 待跑（本机无 `.logs/`，需 `pnpm dev` 实跑一局） | 识别全在事件里；轨迹仅活跃指针时 rAF；热区仅在 resize / 方向 / 可见性变化时重算 |
| 11 | Options 可改、持久化，语言 / flavor 重载后生效 | 代码满足，待手测 | HD Input 页有 `GESTURE_CONTROL`；SD 屏无 Input 页，提交时同步同一快照；总开关打开需重载 |
| 12 | i18n EN/ZH 全键，`tsc --noEmit` 无漏译 | 代码满足 | `pnpm typecheck` 通过；`ZH` 为 `Record<MessageKey,string>` 编译期兜底 |

## 自动化命令

```bash
pnpm typecheck
pnpm gesture:test   # 已接入 pnpm test（tools/test.mjs 的 gesture:test 步骤）
pnpm test
```

## 真机手测建议顺序

1. Android：安装 → 授权 SD 目录 → 进图 → 单指选中 / 长按智能命令 / 双指缩放平移 / 双指取消
   → 编队条 → 轮盘 → 返回键 → 振动。
2. 平板：打开 `gestureCardMirror` 与 `gestureMultiFinger`，验证镜像点击、三 / 四指、
   左右手布局、教学浮层只弹一次。
3. HD：同一序列在 `?flavor=hd&hdArt=sd|hd|de` 下各跑一次，观察底部禁区与图标主题。
