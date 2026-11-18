# 第四批 P2-2：静态 doodad 实例化 — 规格说明

## 目标

`性能优化.md` §三 P2-2：把树/岩石/装饰物等**静态 doodad** 的绘制从「每个实例、每种材质一次 draw」改为「同模型 + 同贴图 + 同姿态一次 instanced draw」，目标是把一局几千次 draw 降到几十次。

门控：**只有 HD（重制版）+ WebGL2 + 非 debug 渲染模式**走新路径；SD（经典版）与原 HD 路径逐字节不变，可用 `__OW3_VIDEO__.instanceDoodads = false` 运行时关闭。

---

## 事实与约束（已读代码确认）

- doodad 由 [doodad.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/w3x/doodad.ts) / [terraindoodad.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/w3x/terraindoodad.ts) 创建，加入 `map.worldScene`；其 `MdxModelInstance` 的几何体位置来自**骨骼纹理**（模型骨骼矩阵已经是世界空间），不是 `u_instance`。
- [batchgroup.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/mdx/batchgroup.ts) 的 `render()` 每个 batch 设置材质/6 张贴图后 `geoset.bindHd(...)` + `geoset.render()`（`drawElements`）。
- HD 顶点着色器 [hd.vert.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/mdx/shaders/hd.vert.ts) 已经有 `u_instance`，但仅在 `instance.ow3LocalPose === true`（共享骨架/低配）时才是世界矩阵。
- [modelinstance.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/mdx/modelinstance.ts) 已有共享姿态/骨架缓存：`ow3PoseFor`、`ow3CaptureSkeleton`、`ow3LocalPose`、`ow3SharedTexture`；共享时骨骼矩阵是**实例空间**，靠 `u_instance` 放回世界。
- `WebGL.isWebGL2` 为真时，`ANGLE_instanced_arrays` 由 [gl.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/gl/gl.ts#L124-L135) 以核心 `drawElementsInstanced` / `vertexAttribDivisor` 合成，`handler.load()` 已经强制 `ensureExtension('ANGLE_instanced_arrays')`。
- 实例化后每个实例只差一个世界矩阵，因此需要：**共享的实例空间骨骼纹理** + **逐实例 mat4 顶点属性**。

---

## 设计

### 1. 让静态 doodad 走「实例空间骨架」

新增判定（`modelinstance.ts`）：

- `ow3SequenceAnimates(model, sequence)`：遍历 `model.sortedGenericObjects`，任一对象的
  `variants.translation/rotation/scale[sequence]` 为真即“有动画”。结果按模型缓存到
  `MdxModel.ow3StaticSequences?: Map<number, boolean>`（无动画为 `true`，即 static）。
- 静态可实例化条件（全部满足）：
  - `instance.ow3StaticDoodad === true`（由 w3x `Doodad` / `TerrainDoodad` 构造器设置）
  - `viewer.isReforged === true`、`viewer.webgl.isWebGL2 === true`、
    `viewer.debugRenderMode === DebugRenderMode.None`、
    `__OW3_VIDEO__?.instanceDoodads !== false`
  - `instance.parent == null`、`!instance.isFaded()`
  - `model.hd === true`、`model.bones.length > 0`
  - `model.hasLayerAnims === false`、`model.hasGeosetAnims === false`
  - `ow3SkeletonShareable(model) === true`、`ow3Billboards(model) === null`（无 billboard、无 global-sequence 自走时钟、无 dontInherit）
  - `sequence === -1 || ow3SequenceAnimates(model, sequence) === true`
- 在 `updateNodes()` 里，把原来
  `pose = ow3SharePoses(model) ? ow3PoseFor(...) : null`
  改为：
  ```
  const share = ow3SharePoses(model) || ow3StaticDoodadShare(this, sequence);
  pose = (!ow3PoseReset && !blending && sequence !== -1 && share && ow3Shareable(model))
    ? (ow3StaticDoodadShare(this, sequence) ? ow3StaticPoseFor(model, sequence) : ow3PoseFor(model, sequence, frame))
    : null;
  ```
  `ow3StaticPoseFor` 与 `ow3PoseFor` 相同，但 key 固定为 `sequence * 1000000`、`pose.frame = 0`，
  保证每个 (模型, 序列) 只有一张共享骨骼纹理，不会每 33 ms 生成一张。
  `wantLocal = pose !== null && ow3SkeletonShareable(model)` 不变；切换时的强制重组逻辑已有。
- 填姿态：首个实例首次更新时 `forced === true`，会把所有节点采样进 `pose.trs` 并
  `ow3CaptureSkeleton` 生成 `pose.texture`（实例空间）。其余实例 `replaySkeleton` 直接复用。

### 2. 分组键

`MdxModelInstance.ow3InstKey(): string`（仅对通过第 1 节判定的实例调用）：

- 纹理覆盖：`textureOverrides` 的每个 `[index, texture]`，用 `WeakMap<Texture, number>` 铸稳定数字 id，
  组成 `index:id` 排序后的串（同一行的 doodad 共享同一批 `Texture` 对象，因此键相同）。
- `teamColor`
- 不包含 `layerAlphas` / `geosetColors`（已由 `hasLayerAnims` / `hasGeosetAnims === false` 保证静态）。

供 `Scene.renderOpaque()` 使用；`MdxModelInstance.ow3InstancedStatic(): boolean` 汇总第 1 节全部条件。

### 3. 着色器：`OW3_INSTANCED`

[hd.vert.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/mdx/shaders/hd.vert.ts)：

```glsl
#ifdef OW3_INSTANCED
attribute vec4 a_instance0;
attribute vec4 a_instance1;
attribute vec4 a_instance2;
attribute vec4 a_instance3;
#else
uniform mat4 u_instance;
#endif

void main() {
  ...
#ifdef OW3_INSTANCED
  mat4 u_instance = mat4(a_instance0, a_instance1, a_instance2, a_instance3);
#endif
  position = (u_instance * vec4(position, 1.0)).xyz;
  mat3 ow3Instance = mat3(u_instance);
  ...
}
```

只改顶点着色器；`hd.frag.ts` 不变。GLSL 1.00 源仍只有一份，HD 运行时既有转译按 `attribute → in` 机械转换。

### 4. 程序：在 `handler.load()` 里预编译

`MdxHandlerObject` 新增 6 个（仅当 `viewer.isReforged && webgl.isWebGL2` 时创建，否则为 `null`）：

- `hdInstancedShader` / `hdInstancedExtendedShader` / `hdInstancedSkinShader`
- `hdLiteInstancedShader` / `hdLiteInstancedExtendedShader` / `hdLiteInstancedSkinShader`

前缀分别为 `#define OW3_INSTANCED\n`，lite 为 `#define OW3_LITE\n#define OW3_INSTANCED\n`。
`getBatchShader(viewer, skinningType, isHd, instanced = false)`：`instanced` 且对应程序存在时优先返回；
debug 模式永远走旧程序。

### 5. 绘制

`Geoset.renderInstanced(count)`：用 `webgl.extensions['ANGLE_instanced_arrays'].drawElementsInstancedANGLE(...)`。

`BatchGroup.renderInstanced(instances)`（仅 HD）：

1. 取出 `shader = getBatchShader(..., true)`；把 `render()` 中「场景级 uniform」块原样抽出为
   `bindSceneUniforms(shader, scene)`，两条路径共用，SD 行为不变。
2. 绑定 `instances[0].ow3SharedTexture` 到 unit 15，设置 `u_hasBones/u_boneMap/u_vectorSize/u_rowSize`
   （所有实例同模型同序列，纹理相同）。
3. 绑定 `model.arrayBuffer` / `model.elementBuffer`。
4. 准备逐实例矩阵：`Float32Array(n * 16)` 依次拷贝 `instance.worldMatrix`；写入组内复用的
   `ow3MatrixBuffer`（`gl.bufferData`，`DYNAMIC_DRAW`）；把 `a_instance0..3` 指向该 buffer，
   stride 64、offset 0/16/32/48，`vertexAttribDivisorANGLE(loc, 1)`。
5. 按 `this.objects` 逐 batch：材质/贴图/`u_hasNormals`/`u_hasOrm`/team swatch 全部取 `instances[0]`
   （键已保证一致）；`geoset.bindHd(...)`；`geoset.renderInstanced(n)`。
6. 循环结束：四个 `a_instance*` 设 divisor 0 并 `disableVertexAttribArray`，避免污染后续普通 draw。

`Scene.renderOpaque()`：HD + WebGL2 + 开关打开时

1. 扫描 `this.instances`，`ow3InstancedStatic()` 为真者按 `model → ow3InstKey() → 实例[]` 分桶，其余保持原顺序；
2. 对每个桶：按 `model.opaqueGroups` 顺序，`group.isHd` 的调 `renderInstanced(bucket)`，
   `!group.isHd` 的逐实例 `group.render(instance)`（这些 batch 仍走原路径）；
3. 未入桶的实例照旧 `instance.renderOpaque()`；
4. 开关关闭或非 WebGL2 时执行原来的单循环。

半透明组（`model.translucentGroups`）不在本批范围，仍由 `renderTranslucent` 逐实例绘制
（`ow3LocalPose` 时 `u_instance` 已能正确处理）。

### 6. 标记 doodad

[w3x/doodad.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/w3x/doodad.ts) 与
[terraindoodad.ts](file:///Users/huangyu/魔兽/开源魔兽争霸/vendor/mdx-m3-viewer/src/viewer/handlers/w3x/terraindoodad.ts)
构造器里设置 `instance.ow3StaticDoodad = true`（新增可选字段，默认 `false`）。

---

## 非目标

- 不实例化单位、可移动/可摧毁且会换姿态的实例、带 billboard 或 dontInherit 的模型。
- 不实例化半透明/粒子组。
- 不改 SD 着色器、SD 分组、SD 绘制路径。

## 验收

1. vendor `tsc` 通过；主工程 `tsc --noEmit` 通过。
2. WebGL2 离屏探针：新 instanced 程序可编译链接；用同一模型两个不同平移的实例 draw，
   读回像素确认两块几何都出现在各自位置（不是叠加在原点）。
3. 内置浏览器 SD 对局（EchoIsles）无回归：单位/doodad 正常、控制台 0 error、无 WebGL 警告。
4. HD（若本机 3.x 资源可启动）：树/岩石正常绘制；`__OW3_VIDEO__.instanceDoodads = false`
   可回退且画面一致。
5. draw 计数（可用 Spector 或自计）在 HD 静态场景中显著下降。

## 风险与回退

- 属性 divisor 泄漏 → 绘制后强制复位。
- 姿态共享的实例空间换算 → 复用已验证的 issue #161 路径；只对 `ow3SkeletonShareable && 无 billboard` 的模型启用。
- 纹理覆盖不一致 → 分组键包含覆盖纹理身份；不一致自然分到不同桶。
- 任何异常：`__OW3_VIDEO__.instanceDoodads = false` 或非 WebGL2 立即回到原路径。
