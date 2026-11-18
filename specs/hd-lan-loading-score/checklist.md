# 验收清单：3.0 化局域网三屏 + 载入 / 结算

验证环境：`npm run dev`（5173）、`?dev&flavor=hd&hdArt=de`。

- [x] HD 局域网**浏览屏**为 3.0 DOM/CSS：`.LANGames` 内容带（936px）、标题木纹带、Social/Create 页签、房间列表列（名称/人数/主机）、右栏地图预览与 Join 按钮；console 无 error
- [x] HD **建房屏**为 3.0 DOM/CSS：地图文件夹/文件浏览、选中后右栏预览与描述、游戏名输入、Advanced Options 七项开关、OBSERVER/VISIBILITY/服务器/游戏速度四个下拉、Create/Back；选图后 Create 可点
- [x] HD **大厅屏** `.GameLobbyMain` 渲染完整：左侧玩家行（颜色块/名字/种族/队伍）、聊天框、右侧地图预览与「开始游戏」「取消」；进入大厅后 console 无 error
- [x] 初始 disabled 的按钮在启用后可点击：`officialMenu.primaryButton` 始终绑定监听、按运行时 `isDisabled`/`aria-disabled` 判定（Join / Create / Start Game 均受此影响）
- [x] HD **载入屏** `.LoadingScreen` 出现：地图名、载入进度、top/bottom 装饰、side roster；背景沿用 `LoadingScene` 画布
- [x] HD **结算屏** `.ScoreScreen` 完整可见（标题、四页签、表头、用时、保存录像/确定），无裁切；真实鼠标点击「确定」可回到主菜单
- [x] HD 结算屏的玩家数据行与经典屏一致：同一张测试地图下，SD 经典结算屏同样为 0 行（控制台 `Failed to correctly parse the map information file`），说明空表来自地图信息而非界面代码
- [x] 非 HD flavor 不回归：SD 下局域网/载入/结算仍走原 FDF 实现（`isHd()` 分支之外无改动；SD 结算屏实测正常）
- [x] 资产全部来自安装包 `WebUI\`（经 `webUiAssets` 转 blob，缺失由 `official.ts` 回退透明图），无手造美术
- [x] `npm run typecheck` 通过
- [x] `npm run cycles` 通过（import cycles: none，391 文件）
