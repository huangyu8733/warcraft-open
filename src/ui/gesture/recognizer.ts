// 多指 Pointer Events 状态机 → GestureIntent（方案 §5）。
//
// 这里是纯逻辑：不认识 window、不读 DOM、不挂监听，只吃「指针采样」吐「意图」，所以
// tools/gesture-intent-test.cjs 能在 headless Node 里直接喂合成序列（§14.1）。
// 事件绑定、坐标缓存、宿主调用都在 index.ts / geometry.ts / host.ts。
//
// 三条实现原则：
//  · 零常态帧开销（§13）：没有计时器、没有 rAF，全部在事件里算完；
//  · 单指不抢浏览器（§5.1 / P5）：只有 2 指以上才 claims()，单指轻点照旧走既有 pointer 路径；
//  · 一旦判定就锁定（§5.2 HYSTERESIS）：双指序列里 pinch / pan 先判出哪个就只发哪个，
//    不让「捏合到一半变成平移」抖动。

import {
  DEFAULT_THRESHOLDS,
  type GestureArea,
  type GestureIntent,
  type GesturePoint,
  type GestureThresholds,
} from "./intents";

/** 识别器要吃的最小事件面：PointerEvent 的子集，测试里用普通对象即可。 */
export interface PointerSample {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  /** 与 `now()` 同一个时钟的毫秒时间戳。 */
  timeStamp: number;
}

export interface RecognizerOptions {
  /** 时钟。默认 `performance.now()`；headless 测试注入假时钟。 */
  now?: () => number;
  thresholds?: () => GestureThresholds;
  /** 坐标落在哪个区域。默认 "world"（geometry.ts 提供真实实现）。 */
  areaAt?: (clientX: number, clientY: number) => GestureArea;
  /** 是否落在手势层热区（排除系统手势禁区）。默认 true。 */
  isHotZone?: (clientX: number, clientY: number) => boolean;
  /**
   * 安全区内的边缘带（§5.2 / §6.1）：在带内返回朝屏幕内侧的单位方向，否则 null。
   * 缺省为 null，即识别层不产出 `edgeHold`（headless 测试按需注入）。
   */
  edgePan?: (clientX: number, clientY: number) => { dx: number; dy: number } | null;
  /** 手势总开关。默认开。 */
  enabled?: () => boolean;
  /** 识别出意图时调用。 */
  emit?: (intent: GestureIntent) => void;
  /**
   * 单指在世界里拖出一块时，每次 pointermove 回调一次：调用方据此实时画选框、
   * 给框住的单位打预览圈，抬手前就能看清会选中谁（触摸没有鼠标的 hover 反馈）。
   */
  dragboxPreview?: (from: GesturePoint, to: GesturePoint) => void;
  /** 这一次拖框结束 / 作废（抬手、取消、变成多指）：把选框与预览收掉。 */
  dragboxPreviewEnd?: () => void;
  /** 默认只收 `touch`；笔也当触摸时需要事件绑定端自行放行。 */
  includePen?: boolean;
}

interface Track {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  startAt: number;
  area: GestureArea;
  /** 离起点的最远距离。 */
  maxDist: number;
  /** 参与过多指序列：抬起时不再产出单指意图。 */
  multi: boolean;
  /** 已经由 `edgeHold` 接管：抬起时不再产出轻点 / 长按（它是一次相机按压）。 */
  edge: boolean;
}

interface MultiState {
  startDist: number;
  startCx: number;
  startCy: number;
  lastCx: number;
  lastCy: number;
  startAt: number;
  maxPointers: number;
  /** 已锁定 pinch / pan；null = 还没判定（此时抬起可能是双指轻点）。 */
  mode: "pinch" | "pan" | null;
  /** 已经发出的累计缩放档数。 */
  pinchSteps: number;
}

const distance = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

export class GestureRecognizer {
  private readonly now: () => number;
  private readonly thresholds: () => GestureThresholds;
  private readonly areaAt: (clientX: number, clientY: number) => GestureArea;
  private readonly isHotZone: (clientX: number, clientY: number) => boolean;
  private readonly edgePan: (clientX: number, clientY: number) => { dx: number; dy: number } | null;
  private readonly enabled: () => boolean;
  private readonly includePen: boolean;
  private readonly emit: (intent: GestureIntent) => void;
  private readonly dragboxPreview?: (from: GesturePoint, to: GesturePoint) => void;
  private readonly dragboxPreviewEnd?: () => void;
  /** 已经画过预览，抬手时才知道要不要收。 */
  private previewing = false;

  private readonly active = new Map<number, Track>();
  private multi: MultiState | null = null;
  /** 上一次轻点，用于双击判定。 */
  private lastTap: { x: number; y: number; area: GestureArea; at: number } | null = null;

  constructor(options: RecognizerOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.thresholds = options.thresholds ?? (() => DEFAULT_THRESHOLDS);
    this.areaAt = options.areaAt ?? (() => "world");
    this.isHotZone = options.isHotZone ?? (() => true);
    this.edgePan = options.edgePan ?? (() => null);
    this.enabled = options.enabled ?? (() => true);
    this.includePen = options.includePen ?? false;
    this.emit = options.emit ?? (() => {});
    this.dragboxPreview = options.dragboxPreview;
    this.dragboxPreviewEnd = options.dragboxPreviewEnd;
  }

  /** 收掉实时选框（没画过就不必惊动调用方）。 */
  private endPreview(): void {
    if (!this.previewing) return;
    this.previewing = false;
    this.dragboxPreviewEnd?.();
  }

  /** 活跃触摸指针数（供仲裁器判断是否接管浏览器手势）。 */
  get pointerCount(): number {
    return this.active.size;
  }

  /** 当前是否该由手势层接管：开关打开、≥2 指、且质心在手势层热区。 */
  claims(): boolean {
    if (!this.enabled() || this.active.size < 2) return false;
    const cluster = this.cluster();
    return cluster != null && this.isHotZone(cluster.cx, cluster.cy);
  }

  /**
   * 这一根单指是否可能变成边缘持续平移（§6.1）：只看「一根、在世界、没拖动、在边缘带」，
   * **不看到没到时间**。调用方（index.ts）用它在按下时起一个只在按住期间存在的帧循环；
   * 真正的判定仍由 `edgePanAt()` 在到达 `edgeHoldMs` 后做。
   */
  edgeCandidate(): boolean {
    const track = this.soleEdgeTrack();
    if (!track) return false;
    return track.maxDist <= this.thresholds().tapSlopPx
      && this.edgePan(track.x, track.y) != null;
  }

  /**
   * 边缘持续平移的当前位移方向（单位向量 + 落点）。按住超过 `edgeHoldMs` 才返回；
   * 一旦返回就把这一串标成「已被边缘按压接管」，抬起时不会再变成轻点 / 长按。
   * 坐标是 client 像素，与识别器其余输出一致。
   */
  edgePanAt(now: number): { dx: number; dy: number; x: number; y: number } | null {
    const track = this.soleEdgeTrack();
    if (!track) return null;
    const t = this.thresholds();
    if (track.maxDist > t.tapSlopPx) return null;
    if (now - track.startAt < t.edgeHoldMs) return null;
    const dir = this.edgePan(track.x, track.y);
    if (!dir) return null;
    if (!track.edge) {
      track.edge = true;
      this.lastTap = null; // a camera press does not chain into a double tap
    }
    return { dx: dir.dx, dy: dir.dy, x: track.x, y: track.y };
  }

  /** 唯一的活跃指针，且没有多指序列、起点在世界里；其余情况都不是边缘按压。 */
  private soleEdgeTrack(): Track | null {
    if (!this.enabled() || this.multi || this.active.size !== 1) return null;
    const track = this.active.values().next().value as Track | undefined;
    return track && track.area === "world" ? track : null;
  }

  pointerDown(p: PointerSample): boolean {
    if (!this.enabled() || !this.wanted(p)) return false;
    if (this.active.has(p.pointerId)) return true;

    const area = this.areaAt(p.clientX, p.clientY);
    const at = this.timeAt(p);
    this.active.set(p.pointerId, {
      id: p.pointerId,
      startX: p.clientX,
      startY: p.clientY,
      x: p.clientX,
      y: p.clientY,
      startAt: at,
      area,
      maxDist: 0,
      multi: false,
      edge: false,
    });

    if (this.active.size >= 2) {
      this.endPreview(); // 第二根手指进来：这一串不再可能是单指框选
      this.beginOrExtendMulti(at);
    }
    return true;
  }

  pointerMove(p: PointerSample): boolean {
    const track = this.active.get(p.pointerId);
    if (!track) return false;
    track.x = p.clientX;
    track.y = p.clientY;
    track.maxDist = Math.max(track.maxDist, distance(track.x, track.y, track.startX, track.startY));

    // 单指在世界里拖过轻点容差：立刻进入「画框」——选框与预览圈跟着手指走，
    // 抬手才真正选中（与鼠标拖框的反馈一致）。边缘按压在容差内，不会走到这里。
    if (this.active.size === 1 && !this.multi && !track.multi && track.area === "world"
      && !track.edge && track.maxDist > this.thresholds().tapSlopPx) {
      this.previewing = true;
      this.dragboxPreview?.(
        { x: track.startX, y: track.startY },
        { x: track.x, y: track.y },
      );
    }

    if (this.active.size < 2 || !this.multi) return true;
    const cluster = this.cluster();
    if (!cluster) return true;

    const m = this.multi;
    const t = this.thresholds();
    const at = this.timeAt(p);

    // 判定一次，之后锁定（HYSTERESIS）。判据是「两指间距变了多少」对「质心走了多远」：
    // 捏合时质心几乎不动，平移时两指几乎同向走，用一个手指单独移动起头的序列不会被误判成缩放。
    if (!m.mode) {
      const spread = Math.abs(cluster.dist - m.startDist);
      const travel = distance(cluster.cx, cluster.cy, m.startCx, m.startCy);
      const pinchFloor = m.startDist * t.pinchStepRatio;
      if (spread >= pinchFloor && spread > travel * 1.5) m.mode = "pinch";
      else if (travel > t.tapSlopPx) m.mode = "pan";
    }

    if (m.mode === "pinch") {
      const ratio = m.startDist > 0 ? cluster.dist / m.startDist : 1;
      const raw = (ratio - 1) / t.pinchStepRatio;
      // 越过 1 档才算一次；往回退同样按档计（负方向）。
      const steps = raw >= 0 ? Math.floor(raw) : Math.ceil(raw);
      if (steps !== m.pinchSteps) {
        const delta = steps - m.pinchSteps;
        m.pinchSteps = steps;
        this.emit({
          kind: "pinch",
          x: cluster.cx,
          y: cluster.cy,
          scale: ratio,
          steps: delta,
          pointers: this.active.size,
          durationMs: Math.max(0, at - m.startAt),
          area: this.areaAt(cluster.cx, cluster.cy),
        });
      }
    } else if (m.mode === "pan") {
      const dx = cluster.cx - m.lastCx;
      const dy = cluster.cy - m.lastCy;
      if (Math.hypot(dx, dy) >= 0.5) {
        this.emit({
          kind: "twoFingerPan",
          x: cluster.cx,
          y: cluster.cy,
          vx: dx,
          vy: dy,
          pointers: this.active.size,
          durationMs: Math.max(0, at - m.startAt),
          area: this.areaAt(cluster.cx, cluster.cy),
        });
      }
    }

    m.lastCx = cluster.cx;
    m.lastCy = cluster.cy;
    return true;
  }

  pointerUp(p: PointerSample): boolean {
    const track = this.active.get(p.pointerId);
    if (!track) return false;
    track.x = p.clientX;
    track.y = p.clientY;
    track.maxDist = Math.max(track.maxDist, distance(track.x, track.y, track.startX, track.startY));
    this.active.delete(p.pointerId);
    // 选框的归属跟着这一段拖拽一起结束：先收预览，再（可能）提交 dragbox。
    this.endPreview();

    // 还有手指在屏幕上：序列没结束。多指少了一根，质心基线跟着挪，免得被当成平移。
    if (this.active.size >= 1) {
      if (this.multi) {
        const cluster = this.cluster();
        if (cluster) {
          this.multi.lastCx = cluster.cx;
          this.multi.lastCy = cluster.cy;
        }
      }
      return true;
    }

    const at = this.timeAt(p);
    const multi = this.multi;
    this.multi = null;

    if (multi) {
      if (multi.maxPointers === 2 && !multi.mode) {
        // 双指轻点 = 取消 armed / Escape。
        this.emit({
          kind: "twoFingerTap",
          x: track.x,
          y: track.y,
          pointers: 2,
          durationMs: Math.max(0, at - multi.startAt),
          area: this.areaAt(track.x, track.y),
        });
      } else if (multi.maxPointers === 3 && !multi.mode) {
        // 三指轻点 = F10 菜单（仅平板；手机不注册由 profile 决定，识别层照发）。
        this.emit({
          kind: "threeFingerTap",
          x: track.x,
          y: track.y,
          pointers: 3,
          durationMs: Math.max(0, at - multi.startAt),
          area: this.areaAt(track.x, track.y),
        });
      } else if (multi.maxPointers === 4 && !multi.mode) {
        // 四指轻点 = 聊天 / 编队面板（仅平板，可选；同由 profile 决定是否生效）。
        this.emit({
          kind: "fourFingerTap",
          x: track.x,
          y: track.y,
          pointers: 4,
          durationMs: Math.max(0, at - multi.startAt),
          area: this.areaAt(track.x, track.y),
        });
      }
      return true;
    }

    if (track.multi) return true; // 参与过多指但先抬起了：不产出单指意图

    const t = this.thresholds();
    const durationMs = Math.max(0, at - track.startAt);
    const dist = track.maxDist;
    const from: GesturePoint = { x: track.startX, y: track.startY };
    const to: GesturePoint = { x: track.x, y: track.y };

    // 边缘按压被相机接管后不再产出轻点 / 长按：抬手只结束平移，不顺手选中或下智能命令。
    // 时间已到但帧循环还没赶上（后台节流）时也在这里补判，免得一次边缘按压漏成轻点。
    if (track.edge
      || (dist <= t.tapSlopPx && durationMs >= t.edgeHoldMs && this.edgePan(track.x, track.y) != null)) {
      this.lastTap = null;
      return true;
    }

    if (dist > t.tapSlopPx) {
      // 单指拖动一律是框选。这里曾经把「快而短的划动」判成 swipe 平移镜头，手机上画框
      // 常常被抢成平移，框选变得不可用（用户反馈）。镜头仍有双指平移 / 边缘按住 /
      // 方向盘，单指留给「画一块，把这一块里能指挥的单位都选中」。
      this.emit({ kind: "dragbox", x: to.x, y: to.y, from, to, pointers: 1, durationMs, area: track.area });
      this.lastTap = null;
      return true;
    }

    if (durationMs >= t.longPressMs) {
      this.emit({ kind: "longpress", x: track.x, y: track.y, pointers: 1, durationMs, area: track.area });
      this.lastTap = null;
      return true;
    }

    // 轻点：先发 tap（与桌面「第一次点击就选中」一致），再按需补一个 doubletap。
    this.emit({ kind: "tap", x: track.x, y: track.y, pointers: 1, durationMs, area: track.area });
    const previous = this.lastTap;
    if (
      previous &&
      previous.area === track.area &&
      at - previous.at <= t.doubleTapMs &&
      distance(previous.x, previous.y, track.x, track.y) <= t.doubleTapDistPx
    ) {
      this.lastTap = null;
      this.emit({ kind: "doubletap", x: track.x, y: track.y, pointers: 1, durationMs, area: track.area });
    } else {
      this.lastTap = { x: track.x, y: track.y, area: track.area, at };
    }
    return true;
  }

  /**
   * 系统打断（`pointercancel`）：整组清空，不产出任何意图（§12）。
   *
   * 浏览器收回一根手指（边缘返回、下拉、切应用）时，这一串手势已经不是玩家在做的那个了；
   * 只删掉被收回的那一根，剩下的手指抬起时仍会被读成双指 / 三指轻点 —— 于是「系统抢走
   * 一根」会变成一次取消瞄准甚至一次 F10。所以整组连同双击链一起作废。
   */
  pointerCancel(pointerId: number): boolean {
    if (!this.active.has(pointerId)) return false;
    this.reset();
    return true;
  }

  /** 清空全部活跃指针与序列状态。 */
  reset(): void {
    this.endPreview();
    this.active.clear();
    this.multi = null;
    this.lastTap = null;
  }

  private wanted(p: PointerSample): boolean {
    return p.pointerType === "touch" || (this.includePen && p.pointerType === "pen");
  }

  private timeAt(p: PointerSample): number {
    // 合成事件常常没有可信的 timeStamp（0），以注入时钟为准。
    return p.timeStamp > 0 ? p.timeStamp : this.now();
  }

  private beginOrExtendMulti(at: number): void {
    const cluster = this.cluster();
    if (!cluster) return;
    for (const track of this.active.values()) track.multi = true;
    if (!this.multi) {
      this.multi = {
        startDist: cluster.dist,
        startCx: cluster.cx,
        startCy: cluster.cy,
        lastCx: cluster.cx,
        lastCy: cluster.cy,
        startAt: at,
        maxPointers: this.active.size,
        mode: null,
        pinchSteps: 0,
      };
      return;
    }
    // 第三根手指落下：质心与跨度都会跳一下，重设基线而不是当成缩放 / 平移。
    this.multi.maxPointers = Math.max(this.multi.maxPointers, this.active.size);
    this.multi.startDist = cluster.dist;
    this.multi.startCx = cluster.cx;
    this.multi.startCy = cluster.cy;
    this.multi.lastCx = cluster.cx;
    this.multi.lastCy = cluster.cy;
    this.multi.pinchSteps = 0;
    this.multi.mode = null;
  }

  /** 活跃指针的质心与平均半径。 */
  private cluster(): { cx: number; cy: number; dist: number } | null {
    if (this.active.size === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const track of this.active.values()) {
      sx += track.x;
      sy += track.y;
    }
    const cx = sx / this.active.size;
    const cy = sy / this.active.size;
    let total = 0;
    for (const track of this.active.values()) total += distance(track.x, track.y, cx, cy);
    return { cx, cy, dist: total / this.active.size };
  }
}
