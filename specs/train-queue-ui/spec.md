# 训练 / 建造队列 UI 改造（进度 · 右上角取消 · 数量角标）

状态：待审批
日期：2026-11-19
范围：`src/ui/hud.ts`、`src/style.css`（不涉及模拟层；命令仍为现有的 `cancelqueue:<index>`）

## 1. 背景与现状

选中正在训练/建造的建筑时，底部信息面板的队列由 `buildInfoPanel` 创建：

- `src/ui/hud.ts:3413-3469`
  - `this.progressWrap`（`.hud-progress-wrap`）
    - `statusLine`（`.hud-status-line`）
      - `iconCol`（`.hud-status-icons`）→ `statusIcon`（当前训练/建造项）+ `builderBtn`（苦工）
      - `statusLabel`（"Training (12s)"）
    - `track`（`.hud-progress`）→ `progressFill`（`.hud-progress-fill`）
    - `queueRow`（`.hud-queue`）→ 6 个 `.hud-queue-slot`（队列第 2…7 位）
- 更新逻辑 `src/ui/hud.ts:4274-4345`
  - `frac = constructing ? sel.buildProgress : sel.trainProgress`，写入 `progressFill.style.width`
  - 头部图标背景 = `sel.queue[0]?.icon ?? sel.icon`
  - 点击头部图标 → `cancelqueue:0`（仅 `queueCancellable`，见 4242-4244）
  - 点击第 i 个槽 → `cancelqueue:${i + 1}`（仅 `filled` 且 `queueCancellable`）
- 皮肤样式 `src/style.css:2981-3250`
  - SD/HD 皮肤下 `--hud-queue-border`（`BuildQueueBackdrop`，见 `src/ui/hud.ts:881`）铺满整个队列条；
    `body.hud-widget-skinned` 用 256×128 纹理百分比把 7 个图标框钉在纹理孔位上
    （`.hud-status-icon` 在 `left:5.36% / top:17.64% / 16.41%×32.81%`，六个槽在 4.69%…82.81%）。
- 已确认代码中**没有任何**绘制红色 ⊘（`BTNCancel`）的 DOM/CSS：`grep cancel|slash|⊘` 在 `src/style.css`
  只命中 "click-to-cancel affordance" 注释。截图里的红色 ⊘ 属于 `BuildQueueBackdrop` 美术
  （HD 版纹理自带），因此只能遮罩，不能删节点。

## 2. 目标 / 非目标

目标（用户原话：**要给一个进度，取消按钮放在图标的右上角，如果创建多个图标中间加上数字**）：

- R1 队列头部图标自带进度：`trainProgress` / `buildProgress` 以图标内径向扫描呈现（0→1 顺时针揭示）。
- R2 取消 affordance 改为每个可取消图标**右上角的小圆形 ×**（头部 + 每个已排队的图标），点击仍是
  `cancelqueue:<index>`；点击图标本体仍保持原行为（兼容现有习惯与快捷键）。
- R3 队列中**连续相同的图标**折叠为一个图标，图标正中显示数量（≥2 时才显示）。
- R4 不可取消（盟友建筑 `queueOwned === false`、建造中、槽位为空）时不显示 ×；建造中保持现有行为
  （建造取消走命令卡 `cancel`，不改）。
- R5 SD / HD 皮肤、`?dev` 与正式入口、鼠标与触摸、tooltip 均无回归；现有底部进度条与 "Training (Ns)"
  文本保留（纹理孔位依赖它，且秒数是补充信息）。

非目标：

- 不改模拟层（`cancelqueue` 语义、退款、索引）。
- 不改手势 HUD（`src/ui/gesture/hud.ts` 的 12 槽命令环）。
- 不重做整个 HD 控制台队列美术（只压掉美术自带的 ⊘）。

## 3. 交互规格

### 3.1 分组与索引

```ts
type QueueGroup = {
  icon: string;              // BLP 路径（与 sel.queue[i].icon 相同）
  kind: string;              // "unit" | "research" | "revive" | "upgrade"
  headIndex: number;         // 组内第一个条目在 sel.queue 中的下标
  lastIndex: number;         // 组内最后一个条目下标（取消这个）
  count: number;             // 1..7
  name: string;              // 组内第一个条目的 name（tooltip）
};
```

- 只折叠 **相邻且 `icon` 与 `kind` 都相同** 的条目；中间夹别的单位不合并。
- 组数超过 6 时，只渲染前 6 组（与现在 6 个槽一致），其余不显示（不改变队列本身）。
- 点击组图标 / 组的 × → `cancelqueue:${group.lastIndex + 1}`（从队尾删除一个，连点逐个退）。
- 头部 `cancelqueue:0` 不变。

### 3.2 进度

- 头部（正在训练/建造）：
  - 新增 `--q-progress`（0…1）写到 `statusIcon.style`；
  - CSS 用 `conic-gradient(from -90deg, transparent 0 calc(var(--q-progress) * 1turn),
    rgba(4,6,10,.62) calc(var(--q-progress) * 1turn) 1turn)` 的遮罩表示"未完成部分"，
    与游戏内冷却扫描同向（顺时针）。
- 排队项没有可测进度，不做假进度（只显示图标 + 数量）。

### 3.3 取消按钮

- 头部：`.hud-q-cancel`（`<button type="button">`，`aria-label = t("hud.cancel")`），
  仅 `training && cancellable` 时可见。
- 槽位：每个槽一个 `.hud-q-cancel`，仅该槽对应的组可取消（`queueCancellable`）时可见；
  点击 `event.stopPropagation()` 后 `runCommand(cancelqueue:n)`。
- 视觉：18px 圆，深红渐变（`#8f1d1d→#5a0f0f`），白色 `×`，外描边 `rgba(0,0,0,.65)`；
  位置 `top:-6px; right:-6px`，压在图标框上，`z-index:2`。
- tooltip：按钮与图标本体都保持 `setGameTip(..., t("hud.cancel"))`（现有 `queueTipped` 逻辑复用）。

### 3.4 数量角标

- `.hud-q-count`：绝对定位居中，`font: 700 var(--q-count-size)/1`，白色 + 黑色 `text-shadow`，
  外圈半透明黑底圆（`background: rgba(0,0,0,.45)`），`pointer-events:none`。
- `count >= 2` 才显示；`count === 1` 清空文本并隐藏。

### 3.5 遮掉 HD 美术自带的红色 ⊘

- 判定：⊘ 位于大图标框**左侧装饰带**（`statusIcon` DOM 覆盖不到的 0%…4.3% 区域；
  大框的金边从纹理 x = 11/256 ≈ 4.3% 开始，见 `style.css:3052-3053`）。
- 方案：新增常驻元素 `.hud-q-mask` 追加到 `progressWrap`，仅在皮肤模式且队列可见时显示：
  `position:absolute; left:0; top:0; width:4.3%; height:100%;`
  背景取控制台面板同色：`background: radial-gradient(120% 100% at 0% 50%, #0b0906 60%, rgba(11,9,6,.85))`，
  `pointer-events:none; z-index:1`。宽度停在金边起始处，保证不裁掉框本身。
- 建造中（`.constructing`，队列纹理已关闭）不显示该遮罩。
- 验收时若截图显示 ⊘ 其实压在图标内部（DOM 之上不可能，但要确认坐标），则改为扩大遮罩宽度到
  该像素边界（以截图量取的百分比为准），实现位置不变。

## 4. 实现设计

### 4.1 `src/ui/hud.ts` — `buildInfoPanel`（3413-3469）

- `statusIcon` 内追加（常驻，不重建）：

```ts
this.statusSweep = document.createElement("span");
this.statusSweep.className = "hud-q-sweep";
this.statusCount = document.createElement("span");
this.statusCount.className = "hud-q-count";
this.statusCancel = document.createElement("button");
this.statusCancel.type = "button";
this.statusCancel.className = "hud-q-cancel";
this.statusCancel.textContent = "×";
this.statusCancel.hidden = true;
this.statusCancel.onclick = (e) => {
  e.stopPropagation();
  if (this.queueCancellable) this.driver.runCommand("cancelqueue:0");
};
this.statusIcon.append(this.statusSweep, this.statusCount, this.statusCancel);
```

- 每个 `.hud-queue-slot` 内追加同样三件套（`sweep` 仅头部用，槽位只建 `count` 与 `cancel`）：

```ts
const count = document.createElement("span");
count.className = "hud-q-count";
const cancel = document.createElement("button");
cancel.type = "button";
cancel.className = "hud-q-cancel";
cancel.textContent = "×";
cancel.hidden = true;
cancel.onclick = (e) => {
  e.stopPropagation();
  const idx = Number(slot.dataset.queueIndex);
  if (this.queueCancellable && Number.isFinite(idx) && idx > 0) this.driver.runCommand(`cancelqueue:${idx}`);
};
slot.append(count, cancel);
```

- 槽位点击处理保持不变（`cancelqueue:${i + 1}` 改为读取 `slot.dataset.queueIndex`，见 4.3）。
- 新字段：`private statusSweep!: HTMLSpanElement; private statusCount!: HTMLSpanElement;
  private statusCancel!: HTMLButtonElement;`（与 `queueSlots` 等放在一起，见 1490 附近）。

### 4.2 分组函数（`hud.ts` 文件内私有）

```ts
function groupQueue(queue: SelectionInfo["queue"]): QueueGroup[] {
  const out: QueueGroup[] = [];
  queue.forEach((q, i) => {
    const last = out[out.length - 1];
    if (last && last.icon === q.icon && last.kind === q.kind) {
      last.count += 1;
      last.lastIndex = i;
    } else {
      out.push({ icon: q.icon, kind: q.kind, headIndex: i, lastIndex: i, count: 1, name: q.name });
    }
  });
  return out;
}
```

### 4.3 更新逻辑（`hud.ts:4274-4345`）

- `frac` 计算后追加：

```ts
const p = Math.max(0, Math.min(1, frac));
this.progressFill.style.width = `${p * 100}%`;
this.statusIcon.style.setProperty("--q-progress", String(p));
```

- 头部数量：建造中恒无（`this.statusCount.hidden = true`，文本清空）；训练中头部是第 0 条，
  其数量由它所在组的 `count` 决定——组从 `sel.queue.slice(0)` 开始分组，头部用 `groups[0]`。

```ts
const groups = groupQueue(sel.queue);
const headGroup = groups[0];
this.statusCount.textContent = !constructing && headGroup && headGroup.count > 1 ? String(headGroup.count) : "";
this.statusCount.hidden = !this.statusCount.textContent;
this.statusCancel.hidden = !cancellable;
```

- 槽位渲染：`const rest = groups.slice(1);` 后按组写入（替换现 4320-4345 的逐项渲染）：

```ts
this.queueSlots.forEach((slot, i) => {
  const g = rest[i];
  const slotIndex = g ? g.lastIndex + 1 : 0;
  slot.dataset.queueIndex = String(slotIndex);
  slot.hidden = false;
  if (!g?.icon) { /* 清空：背景、filled、count、cancel */ }
  else {
    slot.style.backgroundImage = `url(${this.driver.blpUrl(g.icon)})`;
    slot.classList.add("filled");
    const countEl = slot.querySelector<HTMLElement>(".hud-q-count")!;
    countEl.textContent = g.count > 1 ? String(g.count) : "";
    countEl.hidden = !countEl.textContent;
    const cancelEl = slot.querySelector<HTMLButtonElement>(".hud-q-cancel")!;
    cancelEl.hidden = !cancellable;
    setGameTip(slot, cancellable ? t("hud.cancel") : null);
  }
});
```

- 头部 `statusIcon.classList.toggle("clickable", cancellable)` 不变；`statusCancel.hidden = !cancellable`。
- 现有 `queueTipped` 缓存需在 `cancellable` 变化时同步 × 按钮的 `aria-label`/tooltip；× 按钮复用
  `setGameTip(this.statusCancel, cancellable ? t("hud.cancel") : null)`。

### 4.4 `src/style.css`

在 3246 之后（队列皮肤段末尾）新增：

```css
.hud-q-sweep {
  position: absolute; inset: 0; pointer-events: none; z-index: 1;
  border-radius: inherit;
  background: conic-gradient(from -90deg,
    transparent 0 calc(var(--q-progress, 0) * 1turn),
    rgba(4, 6, 10, .62) calc(var(--q-progress, 0) * 1turn) 1turn);
}
.hud-q-cancel {
  position: absolute; top: -6px; right: -6px; z-index: 2;
  width: 18px; height: 18px; padding: 0; border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, .65);
  background: linear-gradient(180deg, #a52626, #6a1212 60%, #450909);
  color: #ffe9e9; font: 700 13px/15px var(--game-font);
  display: grid; place-items: center; cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, .6);
}
.hud-q-cancel:hover, .hud-q-cancel.pad-hover { filter: brightness(1.2); }
.hud-q-cancel[hidden] { display: none; }
.hud-q-count {
  position: absolute; inset: 0; z-index: 2; pointer-events: none;
  display: grid; place-items: center; isolation: isolate;
  font: 700 15px/1 var(--game-font); color: #fff;
  text-shadow: 0 0 3px #000, 0 1px 2px #000, 0 0 6px rgba(0,0,0,.9);
}
.hud-q-count::before {
  content: ""; position: absolute; z-index: -1; width: 68%; aspect-ratio: 1; border-radius: 50%;
  background: rgba(0, 0, 0, .42);
}
.hud-q-mask { display: none; }
body.hud-widget-skinned .hud-q-mask {
  display: block; position: absolute; left: 0; top: 0; width: 4.3%; height: 100%;
  z-index: 1; pointer-events: none;
  background: radial-gradient(120% 100% at 0% 50%, #0b0906 60%, rgba(11, 9, 6, .85));
}
body.hud-widget-skinned .hud-progress-wrap.constructing .hud-q-mask { display: none; }
```

注意：`.hud-status-icon` 在皮肤模式下 `border-radius: 0`，扫描层用 `border-radius: inherit`（0）会成方块；
在 `body.hud-widget-skinned .hud-status-icon` 上补 `border-radius: 50%` 会改变现有观感，因此**只在
`.hud-q-sweep` 上给 `border-radius: 2px`**（贴合方形图标框；HD 圆形时随图标框裁切）。

### 4.5 无障碍 / i18n

- × 按钮：`type="button"`、`aria-label = t("hud.cancel")`；不加 tabindex 变更（HUD 本身非文档流焦点）。
- 数字：`aria-hidden="true"`（纯视觉重复信息）。
- 不新增 i18n key（复用 `hud.cancel`）。

## 5. 验证

1. `./node_modules/.bin/tsc --noEmit -p tsconfig.json`
2. `npm run cycles`
3. `npm run sim:test`、`npm run jass:test`（确认未触碰模拟/脚本层）
4. 手动：`?dev&map=EchoIsles.w3x&edition=tft&flavor=sd` 与 `flavor=hd`
   - 造 3 个步兵 → 一个槽显示图标 + "3"；点 × 一次剩 "2"，再点剩 1 后数字消失。
   - 头部图标有顺时针扫描进度；"Training (Ns)" 与底部细条同步。
   - 盟友建筑：出现图标与数字，**不出现** ×。
   - 建造中：无 ×、无数字、无队列遮罩；苦工按钮正常。
   - HD 截图确认红色 ⊘ 已被 `.hud-q-mask` 压掉且遮罩边界不可见（若可见，按 3.5 调整宽度）。
5. 回归：手势 HUD（`body.gesture-ui`）不受影响。

## 6. 待审批决策

- D1 数字语义：**折叠连续相同图标**（推荐，一个图标 + 数字）而非每个重复图标各显示数字。
- D2 × 点击取消组内**最后一个**（结果与逐个取消一致，连点逐个退）。
- D3 保留底部细进度条（纹理孔位与秒数信息），图标内另加扫描。

审批通过后按 `tasks.md` 执行。
