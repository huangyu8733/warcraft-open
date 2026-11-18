# 任务清单：3.0 化局域网三屏 + 载入 / 结算

- [x] T1 CSS：`.LANGames` 段（容器/左栏网格/标题/Tab/列表/IntegratedImgDetails 右栏/基底）
- [x] T2 `src/ui/hd/lan.ts`：LAN 浏览屏（列表 + 地图预览 + 玩家名 + Servers List + Join），`main.ts lanScreen` HD 分支
- [x] T3 CSS：`.GameLobbyMain` 段（左栏玩家/聊天、右栏地图/摘要/按钮、PlayerRow、ChatFrame）
- [x] T4 `src/ui/hd/lanCreate.ts`：建房屏（地图文件夹浏览器 + 预览 + Advanced Options + Server/Game Speed + Create），`main.ts lanCreateScreen` HD 分支
- [x] T5 `src/ui/hd/lanLobby.ts`：大厅（玩家行/观察席/聊天/倒计时/开始），`main.ts lanLobbyScreen` HD 分支
- [x] T6 CSS `.LoadingScreen` 段 + `src/ui/hd/loading.ts`（实现 `LoadingScreen` 接口，背景沿用 LoadingScene），`main.ts showLoadingScreen` HD 分支
- [x] T7 CSS `.ScoreScreen` 段 + `src/ui/hd/score.ts`（四页签表 + OK），`main.ts showScoreScreen` HD 分支
- [x] T8 验证：`npm run typecheck`、`npm run cycles`、浏览器逐屏回归（LAN 列表→建房→大厅→载入→结算），console 无 error，SD 不回归
- [x] T9 修复 `officialMenu.primaryButton`：初始 disabled 的按钮原先不绑定监视器，导致 Join/Create/Start 启用后仍无响应；改为始终绑定、按运行时状态判定
- [x] T10 修复 HD 结算屏布局：`z-index: 9` + `pointer-events: auto`（挂载层本身为 `pointer-events: none`）、宽度/高度随窗口自适应、`border-image-width` 由 300px 收窄到 100px（原值把表格挤出边框内孔）

## 完成标准

- 五个界面在 `flavor=hd` 下均为 3.0 DOM/CSS 外观，数据与行为与 FDF 版一致。
- 非 HD flavor 完全走原 FDF 实现。
- typecheck、cycles 通过；浏览器验证逐屏通过并记录截图目录 `.screenshots/`。

## 验证备注

- 唯一可用的 HD 测试图 `Maps\official\HDTest.w3x` 的 w3i 解析失败（`Failed to correctly parse the map information file`），因此结算屏没有玩家数据行；SD 经典结算屏在同图同流程下同样为 0 行，故判定为地图信息缺失而非界面缺陷。
