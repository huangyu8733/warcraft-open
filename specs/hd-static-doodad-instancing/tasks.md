# tasks.md — P2-2 静态 doodad 实例化

- [x] T1 `vendor/.../mdx/shaders/hd.vert.ts`：新增 `OW3_INSTANCED` 变体，用
      `a_instance0..3` 组成 `mat4 u_instance` 替代 uniform。
- [x] T2 `vendor/.../mdx/handler.ts`：新增 6 个 instanced 程序（3 蒙皮 × lite），
      仅在 HD + WebGL2 创建；`getBatchShader(..., instanced)` 支持选择。
- [x] T3 `vendor/.../mdx/geoset.ts`：新增 `renderInstanced(count)`。
- [x] T4 `vendor/.../mdx/batchgroup.ts`：
      - 抽出 `bindSceneUniforms(shader, scene)` 给 `render()` / `renderInstanced()` 共用；
      - 新增 `renderInstanced(instances)`：共享骨骼纹理、逐实例 mat4 属性、逐 batch 材质后
        instanced draw、结束后复位 divisor 并禁用属性。
- [x] T5 `vendor/.../mdx/modelinstance.ts`：
      - `ow3StaticSequence` + 模型缓存；
      - `ow3StaticDoodadShare` / `ow3PoseFor(..., staticPose)`（固定 key/frame）；
      - `updateNodes` 接入静态共享；
      - `ow3InstancedStatic()` 与 `ow3InstKey()`（覆盖纹理身份 id + teamColor + sequence）。
- [x] T6 `vendor/.../mdx/model.ts`：新增 `ow3StaticSequences` 缓存字段。
- [x] T7 `vendor/.../viewer/scene.ts`：`renderOpaque()` 增加 HD/WebGL2 分桶实例化路径，
      不再单独绘制已入桶实例；其余实例原路径。
- [x] T8 `vendor/.../w3x/doodad.ts`、`terraindoodad.ts`：标记 `ow3StaticDoodad = true`。
- [x] T9 基础 `viewer/modelinstance.ts`：声明可选 `ow3InstancedStatic?()` / `ow3InstKey?()`。
- [x] T10 构建：vendor `tsc` → 同步 `node_modules/.pnpm/mdx-m3-viewer@file+vendor+mdx-m3-viewer/dist/cjs`
      → `rm -rf node_modules/.vite` → 重启 dev server；主工程 `tsc --noEmit`。
- [x] T11 WebGL2 离屏探针验证新程序链接 + 两实例矩阵位置（left=144 right=144 center=0，glError=0）。
- [x] T12 内置浏览器回归：
      - SD EchoIsles：地形/树木/建筑/单位/HUD 正常，无新增错误；
      - HD BootyBay（3.0.1，`?dev&map=BootyBay&flavor=hd&fog=explored`）：约 60 秒进对局，
        地形/HD 树木/单位/HUD 正常，控制台无 error。
- [x] T13 在 `性能优化.md` 增补 §十一（改动 / 取舍 / 验证 / 回退开关）。
- [x] T14 扩展为动画 doodad：`ow3DoodadPoseFor` 每个 `(模型, 序列)` 一个活动姿态，
      动画时间跨 33 ms 桶时原地刷新（`frame` 前进、`filled`/`skeleton` 复位），
      `ow3StaticDoodadShare` 不再要求 Stand 序列静止；分组键仍不含时间桶。

## draw 计数实测（HD BootyBay，Electron + WebGL2，1440×900）

| 指标 | off | on | 变化 |
|---|---|---|---|
| 总 draw / 帧（中位数） | **733**（p10 = p90 = 733） | **291** / **300** | **≈ −59–60%** |
| 均值 | 733 | 303 / 307 | −433 ~ −442 |
| instanced draw / 帧 | ≈146（粒子） | ≈204（粒子 ≈146 + doodad ≈58） | — |

- 命中：272 个 doodad 实例中，10 种 HD doodad 的 Stand 序列虽含非常量 TRS 轨，仍通过分桶共享姿态入桶。
- 视觉：`/tmp/hdshot.png`（2560×1536）树木/岩石/地形/建筑/单位/HUD 正常，无错位或缺失。
