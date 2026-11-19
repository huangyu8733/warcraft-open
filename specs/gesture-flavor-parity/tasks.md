# Tasks：经典版 / 重制版手势界面一致性

- [x] T1 本地 sd 实测：`http://localhost:5173/?dev=1&flavor=sd&gesture=1&map=EchoIsles`
      （Edge headless，CDP，1194×834），框选一个农民后记录 `#gesture-hud` 子节点、控件矩形与
      经典 chrome 可见性 → `/tmp/gesture-sd.json`、`/tmp/gesture-sd.png`。
- [x] T2 本地 hd 实测：`http://localhost:5174/?dev=1&flavor=hd&gesture=1&map=BootyBay`
      （5174 是指向 3.0.1 安装的 dev server；HD 需要 3.x，SD 需要 1.30.4 系），同一视口重复记录
      → `/tmp/gesture-hd.json`、`/tmp/gesture-hd.png`。
- [x] T3 对比 T1 / T2：子节点顺序、23 槽（20 可见）、8 向移动盘、2 旋转钮、3 缩放钮、
      3 资源 chip、编队条、选择面板的 x/y/w/h **逐项完全相同**，经典控制台在两个版本都
      `display: none`。无差异，无需 T4。
- [x] T4 无差异，跳过（没有任何版本分支需要新增或删除）。
- [x] T5 `tools/gesture-flavor-test.cjs` 增加「classic chrome yields to #gesture-hud」：
      让位清单存在、包含八个经典选择器、`#gesture-hud` 显示规则存在、清单不带 flavor 条件。
- [x] T6 `docs/gesture-control.md` 新增「9. 版本一致性（经典版 / 重制版）」：共用实现、
      实测数据、回归方式与本地复现命令。
- [x] T7 校验：`npx tsc --noEmit` 通过；`npm run gesture:test` 全绿（新增 12 项检查）；
      `npm run cycles` → `import cycles: none (466 files)`。
- [x] T8 未改动游戏代码（只加了测试与文档），不构建、不部署。
