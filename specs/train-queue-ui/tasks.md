# 训练 / 建造队列 UI — 任务清单

> 全部改动集中在 `src/ui/hud.ts` 与 `src/style.css`；不改模拟层、不改手势 HUD。

- [x] T1 数据层：在 `src/ui/hud.ts` 增加 `QueueGroup` 类型与 `groupQueue()`
      （相邻且 `icon`+`kind` 相同才合并，记录 `headIndex/lastIndex/count/name`）。
- [x] T2 DOM：`buildInfoPanel`
      - `statusIcon` 内常驻追加 `.hud-q-sweep`、`.hud-q-count`、`.hud-q-cancel`（`stopPropagation`）。
      - 每个 `.hud-queue-slot` 常驻追加 `.hud-q-num`、`.hud-q-count`、`.hud-q-cancel`；槽位点击读 `slot.dataset.queueIndex`。
      - 新字段 `statusSweep/statusCount/statusCancel`，队列末尾追加 `.hud-q-mask`。
- [x] T3 渲染：更新逻辑
      - `--q-progress` 写入 `statusIcon`；头部数量取 `groups[0].count`。
      - 槽位按 `groupQueue(sel.queue).slice(1)` 渲染：图标、`filled`、数字、×、tooltip（`t("hud.cancel")`）。
      - `constructing` 下：无 ×、无数字、无遮罩；`queueCancellable === false` 下：无 ×。
      - 清空残留：背景、`filled`、`dataset.queueIndex`、数字文本、`hidden`、占位数字全部复位。
      - `refreshQueueTooltip` 通过 `slot.dataset.queueIndex` 把槽位位置映射回真实队列下标。
- [x] T4 样式：`src/style.css` 队列皮肤段末尾新增
      `.hud-q-sweep`（`conic-gradient` + `--q-progress`）、`.hud-q-cancel`（右上角 18px 圆）、
      `.hud-q-count`（居中数字 + 半透明底）、`body.hud-widget-skinned .hud-q-mask`（4.3% 左遮罩）。
- [x] T5 压掉 HD 自带 ⊘：遮罩宽度按 `style.css` 记录的纹理几何取 11/256 = 4.3%
      （大框金边起点），只覆盖框左侧装饰带，绝不动金框；若实机 HD 截图显示 ⊘ 跨到金框上，
      需按截图像素把宽度微调到 glyph 右边界（待实机截图确认）。
- [x] T6 a11y/i18n：× 按钮 `aria-label = t("hud.cancel")`；数字 `aria-hidden="true"`；未新增 i18n key。
- [x] T7 验证：
      - `./node_modules/.bin/tsc --noEmit -p tsconfig.json` ✅
      - `npm run cycles` ✅（466 files, none）
      - `npm run sim:test` ✅、`npm run jass:test` ✅
      - 手动 SD/HD 实机检查（训练 3 个同一单位、混合队列、盟友队列、建造中、手势 HUD）留给用户确认。
- [x] T8 汇报改动；未提交，等待用户确认后再提交。
