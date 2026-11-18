# tasks.md — HD 三问题修复

- [x] T1 树木：`vendor/mdx-m3-viewer/src/viewer/handlers/w3x/map.ts` 的 doodad/destructible 贴图覆盖改为
  - 收集全部 `replaceableId === texId` 的槽位；
  - HD 按槽序使用 `_Diffuse.dds` / `_Normal.dds` / `_ORM.dds`（首个槽回退 `.dds`），SD 保持 `.blp`；
  - 逐槽独立加载，找不到就跳过。
- [x] T2 灯光：`vendor/mdx-m3-viewer/src/parsers/mdlx/light.ts` 用记录自带的 genericSize 判断灯光布局：
  - `genericSize === 96`：通用头 → 44 字节静态块 → 28 字节尾部 → 动画；
  - `genericSize > 96`（议政厅等肖像模型）：通用头 → 动画（genericSize-96）→ 静态块 → 尾部。
- [x] T3 队列：`src/style.css` 的 `body.hud-widget-skinned .hud-progress-wrap` 改为
  `left:0; right:auto; width:auto; max-width:100%; aspect-ratio:2/1;`，保持贴图 2:1、靠左。
- [x] T4 构建：vendor `tsc` 重建 `dist/cjs`，同步 `node_modules/.pnpm/mdx-m3-viewer@file+vendor+mdx-m3-viewer`，
  重启后台 Vite（任务 isbnkbrizf），并清空 `node_modules/.vite` 预打包缓存。
- [x] T5 内置浏览器验证（HD BootyBay）：树冠绿色、议政厅肖像可见、队列 2…7 全显示、console 0 error。
  - 队列实测：`.hud-progress-wrap` x=516 w=236.77 right=752.8；六槽 x 依次 527/564/601/638/675/712，
    7 号槽 right=741，完整落在 752.8 之内。
- [x] T6 回归：Peasant / 英雄 / GoldMine 等模型解析正常（含 5 个灯光的 TownHall_Portrait）；
  SD 分支仍只加载 `.blp`，逻辑不变。
