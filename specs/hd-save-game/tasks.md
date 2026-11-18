# 任务清单（对局存档系统 + HD 存档按钮）

## P1 实体层
- [ ] T1 `src/game/saveFile.ts`：`.o3s` 信封读写 + 版本校验 + `SaveHeader`
- [ ] T2 `src/game/saveState.ts`：`captureWorld(scene)` / `applyWorld(scene, payload)`（基于 `snapshotFor` / `applyWorldSnapshot`）
- [ ] T3 `src/game/saveSink.ts` + `electron/saveStore.mjs` + `main.mjs`/`preload.cjs` IPC + dev server `/saves/*`
- [ ] T4 `mapViewer.ts` 暴露 `captureSave()` / `restoreSave()`，并处理 `pendingSave`
- [ ] T5 `main.ts` `startSaveGame()` + `lastMatch` 透传
- [ ] T6 `escMenu.ts` 保存/载入解禁（先接世界快照）

## P2 脚本层
- [ ] T7 `Runtime` 的 globals/arrays 编解码（句柄按 sim id / 注册序号重绑）
- [ ] T8 `triggerRegs` 启用位与已执行标记的保存/恢复
- [ ] T9 `timers` 剩余时间与回调重建、`gameTime` 恢复

## P3 界面
- [ ] T10 `officialMenu.ts` `backButton(..., onSave?)` + `official.css` 三按钮框样式
- [ ] T11 `src/ui/hd/saveGame.ts` 存档面板（列表/保存/载入/删除/取消）
- [ ] T12 五个 HD 屏接入 `onSave`；i18n 中英词条

## P4 补齐
- [ ] T13 挂起线程栈（`TriggerSleepAction`）序列化
- [ ] T14 声音/漂浮文字/运行中对话框/quest/leaderboard 内容
- [ ] T15 相机与迷雾状态

## 验收
- [ ] `npx tsc --noEmit`、`npm run cycles` 通过
- [ ] 无头：保存→重载→快照字段一致
- [ ] 浏览器：章节内存档→读档，HUD 与单位状态一致
- [ ] HD 各屏底栏为 `[返回][存档]|☰`，720p/4K 不裁切
