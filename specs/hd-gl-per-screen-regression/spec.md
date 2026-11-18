# Spec — 4.5 第 4 步逐屏回归 + `perf:report` 实测

## 0. 目标

补完 `性能优化.md` 第四节 4.5 的第 4 步：在真实客户端里逐屏对比 **HD WebGL2 / HD WebGL1(`?gl=1`) / SD WebGL1** 的画面，
并用 `pnpm dev:log` + `pnpm perf:report` 记录一局真实 HD 对局，量化第三批（WebGL2 迁移）与
第四批（静态 doodad 实例化）之后的帧时间与相位分布。

本 spec 是**验证任务**：默认不改产品代码。只有探针发现可复现的画面/控制台回归时，才停下来另开修复 spec。

## 1. 验收矩阵

| 屏幕 | HD WebGL2 | HD WebGL1 (`&gl=1`) | SD WebGL1 | 判定方式 |
|---|---|---|---|---|
| 主菜单（含主题背景静帧） | 必拍 | 必拍 | 必拍 | 结构/文字/布局一致；控制台无 WebGL 错误 |
| 单机菜单 | 必拍 | 必拍 | —（SD 走经典 UI） | 同上 |
| 载入屏 | 必拍 | 必拍 | 必拍 | 同上 |
| 对局内（地形/树/单位/HUD） | 复核 | 复核 | 复核 | 已有 §10.6/§11.4 结论，只补截图与错误检查 |
| 肖像（选中单位或建筑） | 必拍 | 必拍 | 必拍 | 模型/贴图/队色/动画正常，无黑块或缺失 |
| 存档列表（☰ → LOAD SAVED GAME） | 必拍 | 必拍 | — | 背景与列表布局一致 |
| 录像列表（主菜单 REPLAYS） | 必拍 | 必拍 | — | 同上 |

> 菜单/存档/录像主体是 DOM + 安装内图片/视频，和 GL 版本无关；拍它们是为了证明**同一进程里
> 切到 WebGL2 后这些屏没有被上下文选择/全局标志破坏**。因此以人工检视 + 控制台错误为准，
> 不做像素等值断言（背景是 WebM，帧时序不同，像素差没有意义）。

## 2. 探针

- 脚本：`/tmp/screens.js`（Electron，1440×900，`show: true`，`disable-http-cache`，
  `backgroundThrottling: false`），仅在 `/tmp`，不进仓库。
- 参数：`PROBE_URL`、`PROBE_TAG`、`PROBE_MODE=menu|map`。
- 输出：`/tmp/screens/<tag>-<screen>.png`；stdout 输出一份 JSON：
  - `__OW3_GL2__`、首个 canvas 的实际上下文版本（`webgl2` / `webgl1` / `null`）
  - `errors`（console level ≥ 2 的前 20 条）
  - 当前屏的选择器快照（`.MainMenuScreen` / `.LoadingScreen` / `.hud` / `.hud-portrait` 的 class 列表）
- 流程：
  1. `menu`：等 `.MainMenuScreen` → 截 `menu` → 点导航第 1 项（单机）→ 截 `single` → 返回；
     点导航第 3 项（Replays）→ 截 `replays` → 返回；点 ☰ → 点列表最后一项（LOAD SAVED GAME）→ 截 `saved`。
  2. `map`：轮询 `.LoadingScreen`，出现即截 `loading`；循环点击 (6,6)+Space 直到 `.hud` 且无
     `.LoadingScreen`；等 3 s 截 `match`；在屏幕中心附近尝试点选单位/建筑，直到
     `.hud-portrait` 不含 `empty` 且其 canvas 宽高 > 0，截 `portrait`（整页）与
     `.hud-portrait` 区域特写。
- 每个 URL 单独启动一次 Electron（不复用窗口），避免缓存与状态串扰。

## 3. 运行矩阵与 URL

| 标签 | 模式 | URL |
|---|---|---|
| `hd2-menu` | menu | `http://localhost:5200/?dev&flavor=hd` |
| `hd1-menu` | menu | `http://localhost:5200/?dev&flavor=hd&gl=1` |
| `sd-menu` | menu | `http://localhost:5200/?dev&flavor=sd` |
| `hd2-map` | map | `http://localhost:5200/?dev&map=BootyBay&flavor=hd&fog=explored` |
| `hd1-map` | map | `http://localhost:5200/?dev&map=BootyBay&flavor=hd&gl=1&fog=explored` |
| `sd-map` | map | `http://localhost:5200/?dev&map=EchoIsles&flavor=sd` |

前置：5200 的 dev server 已由 `WARCRAFT_OPEN_INSTALL="/Users/huangyu/rrrr/Warcraft III"` 启动并保持运行，
不得停止/重启它；探针只用新窗口访问。

## 4. `perf:report`

1. 启动带记录的 dev server（新端口，避免干扰 5200）：
   `WARCRAFT_OPEN_INSTALL="/Users/huangyu/rrrr/Warcraft III" node tools/dev-log.mjs --port 5210 --strictPort`
2. 两个会话，均为 `?dev&map=BootyBay&flavor=hd&fog=explored`，1440×900，进对局后跑 90 s：
   - **A：默认**（`instanceDoodads` 开）；
   - **B：关闭实例化**：页面载入后、进对局前注入 `window.__OW3_VIDEO__ = { instanceDoodads: false }`
     （`modelinstance.ts` 每帧读取该字段，关闭后立即走逐实例绘制）。
3. 每个会话结束由探针 `app.quit()` 触发 `pagehide` 的 `sendBeacon` 落盘；必要时用
   `pnpm perf:report -- .logs/<session>.ndjson` 手动出报告。
4. 记录：帧均值 / p50 / p95 / worst、`render` / `anim` / `overlay` / `(unaccounted)` 的 ms/帧、
   draw 相关 census、长任务；A/B 给差值与百分比。
5. 明确写清：本次 A/B 是**运行时开关**的前后对比，不是历史构建对比；「优化前」的绝对数值
   取自 §2.3 的旧会话只作量级参考，不与本次混算。

## 5. 文档落点（唯一会改的仓库文件：`性能优化.md`）

- §四 4.5：第 4 步补一句「已完成（见 §十三）」；第 6 步指向本次 perf 数据。
- §六 第三批：把「菜单/载入/肖像逐屏对比仍待补」改为已完成，并引用 §十三。
- §9.4「未覆盖」：删除已补的逐屏项，只保留真实未覆盖项（如 UBO / texStorage / MRT 转译）。
- 新增 **§十三 逐屏回归与 `perf:report` 实测**：
  - 13.1 环境与矩阵（上表 URL、窗口、上下文实测值）；
  - 13.2 逐屏结论（每屏一行：通过/差异/证据截图路径）；
  - 13.3 perf 会话表（A/B 帧时间与相位、draw 计数、长任务）；
  - 13.4 未覆盖与后续（不在本批承诺内的项）。
- 截图存放在 `/tmp/screens/`，文档只引用路径，不复制进仓库。

## 6. 通过标准

- 6 个 URL 全部成功进入目标屏；`__OW3_GL2__` 与上下文版本符合：HD2 → `webgl2`、HD1 → `webgl1`、SD → `webgl1`。
- 所有屏幕控制台无着色器/GL/纹理错误（允许既有的「地图库不可用」dev 噪声）。
- 菜单/单机/存档/录像：布局、文字、背景存在且一致，无黑屏、无错位。
- 载入屏：背景、进度条、玩家列表正常。
- 对局与肖像：HD2 与 HD1 之间无可见回归；SD 与 §10.6 的结论一致。
- `perf:report` 产出完整相位表；A/B 给出帧时间与 `render` 相位的差值和百分比；数据写入 §十三。
- 不改 git 历史（不 commit / 不 push）。

## 7. 非目标

- 不新增产品功能，不改渲染路径；发现缺陷另开 spec。
- 不评估 medium/low 动画档观感、不重测 `bust programs`。
- 不追求像素级等值（动画与视频时序不可对齐），以人工检视 + 结构性检查为准。
