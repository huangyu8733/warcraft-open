# OpenWar3 本地内置的 mdx-m3-viewer

本目录已整体放进项目，`package.json` 以 `file:vendor/mdx-m3-viewer` 引用，
以后 `pnpm install` 只会读这里，**不会再去 npm 拉取，也不会被覆盖**。

## 目录现状（重要）

- `src/`、`types/`、`tsconfig.json`、`webpack.config.js`
  —— 上游 **mdx-m3-viewer master 5.13.0**（commit `2ff0bc0`）的完整源码，供查阅与后续迁移。
- `dist/cjs/`
  —— 当前**实际运行**的构建产物，来自 5.12.0 + OpenWar3 的 dist 补丁 + 本地渲染修复。
- 两者目前**不同步**：OpenWar3 的约 2,800 行改动只存在于 `dist/cjs`，上游 5.13.0 的
  `src/` 没有这些改动（hdSlots、共享姿态缓存、MPQ 扩展、w3x 定制、着色器 uniform 等）。
  因此**不要直接 `tsc` 重建 dist**，否则会用上游原版覆盖掉现有功能。

## dist 内含的本地修改

- `viewer/handlers/mdx/shaders/hd.frag.js`
  - ORM R（AO）通道为 0 时按 1 处理，修复 Reforged 单位全黑。
- `viewer/handlers/mdx/batchgroup.js`
  - 队伍色 swatch 缺失（doodad `teamColor === -1`）时不再崩溃。
  - normal/ORM 槽位与 diffuse 指向同一资源时按“无 normal / 无 ORM”处理，
    修复树木被队伍色染红。
  - 材质没有任何贴图时跳过。

## 后续若要“只改 src 并重建”

需要先把 `dist` 里的 OpenWar3 改动逐文件迁移到 `src`（MPQ、w3x、MDX v1100、
共享姿态缓存、D3D 着色器等），再用 `tsc` 重建。详细差异清单见对话记录中的核对报告。
在那之前，行为修改请继续改 `dist/cjs`。
