# tasks.md — 4.5 第 4 步逐屏回归 + `perf:report`

- [x] T1 写 `/tmp/screens.js` 探针（menu/map 两模式、截图、上下文与 console 采集）。
- [x] T2 跑 `hd2-menu` / `hd1-menu` / `sd-menu`，产出 `/tmp/screens/*.png` 并记录上下文与错误。
- [x] T3 跑 `hd2-map` / `hd1-map` / `sd-map`，截载入屏、对局、肖像（含特写）。
- [x] T4 逐屏检视截图，记录每屏结论（通过 / 差异 / 证据）。
- [x] T5 启动 5210 的 `dev-log`，跑 A（默认实例化）90 s 会话。
- [x] T6 跑 B（`instanceDoodads=false`）90 s 会话。
- [x] T7 `pnpm perf:report` 出两份摘要，整理帧时间/相位/draw/长任务 A/B。
- [x] T8 更新 `性能优化.md`：§四 4.5、§六 第三批、§9.4，新增 §十三。
- [x] T9 复核文档口径（未覆盖项只保留真实未覆盖），汇报结果；不提交 git。
