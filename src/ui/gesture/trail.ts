// 手势轨迹 / 多点引导线（方案 §8.1 / §13）。
//
// 一整块 `#gesture-viewport` 挂在 `#ui` 之外（与 `#loading-layer` 同级），因此
// `body.in-game` 给 `#ui` 加的 transform 不会把全视口图层重框进 16:9 游戏帧。
// z-index 4、`pointer-events:none`，永远低于对话框与加载屏（§8.1）。
//
// 性能边界（§13）：没有活跃指针时**没有定时器、没有 rAF、不读 layout**。
// 每次 pointer 事件最多合并成一帧重绘；抬手即清空并停表。画布尺寸只在
// 挂载与 resize 时更新，不在绘制里读 `getBoundingClientRect`。

const MAX_POINTS = 48;
const MIN_STEP_PX = 1.5;
const DOT_RADIUS = 5;

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  points: Point[];
}

const strokes = new Map<number, Stroke>();

let enabled: () => boolean = () => false;
let container: HTMLDivElement | null = null;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let frame = 0;
let dpr = 1;

/** `profile.trail` 每次现取：Options 里关掉后，下一次事件就停笔。 */
export function startGestureTrail(isEnabled: () => boolean): void {
  enabled = isEnabled;
}

/**
 * 关掉整条轨迹层（对局内手动关闭手势时）：停笔、清屏、把 canvas 一起摘掉。
 * 再打开时由下一次 `beginStroke` 重新挂载，不留任何常驻节点。
 */
export function stopGestureTrail(): void {
  enabled = () => false;
  clearStrokes();
  container?.remove();
  container = null;
  canvas = null;
  ctx = null;
}

/** 手指按下：开始一条轨迹。关闭轨迹时什么也不做。 */
export function beginStroke(pointerId: number, clientX: number, clientY: number): void {
  if (!enabled()) return;
  if (!mount()) return;
  strokes.set(pointerId, { points: [{ x: clientX, y: clientY }] });
  schedule();
}

/** 手指移动：追加上一点，最多保留 MAX_POINTS 个。 */
export function moveStroke(pointerId: number, clientX: number, clientY: number): void {
  const stroke = strokes.get(pointerId);
  if (!stroke) return;
  if (!enabled()) {
    clearStrokes();
    return;
  }
  const last = stroke.points[stroke.points.length - 1];
  if (last && Math.hypot(clientX - last.x, clientY - last.y) < MIN_STEP_PX) return;
  stroke.points.push({ x: clientX, y: clientY });
  if (stroke.points.length > MAX_POINTS) stroke.points.shift();
  schedule();
}

/** 手指抬起：删掉这条轨迹；最后一根离开时立即清屏并停表。 */
export function endStroke(pointerId: number): void {
  strokes.delete(pointerId);
  if (strokes.size === 0) clearStrokes();
  else schedule();
}

/** 失焦 / 切后台 / pointercancel：整组清空，不留半截轨迹（§12）。 */
export function clearStrokes(): void {
  strokes.clear();
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/** resize / 方向变化后重算画布像素尺寸（一次 layout read，不在事件里）。 */
export function resizeTrail(): void {
  if (!canvas || !ctx) return;
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
  canvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (strokes.size > 0) schedule();
}

function mount(): boolean {
  if (canvas) return true;
  container = document.createElement("div");
  container.id = "gesture-viewport";
  canvas = document.createElement("canvas");
  container.appendChild(canvas);
  document.body.appendChild(container);
  ctx = canvas.getContext("2d");
  if (!ctx) {
    container.remove();
    container = null;
    canvas = null;
    return false;
  }
  resizeTrail();
  return true;
}

/** 事件驱动的单帧重绘：同一次 pointermove 风暴只画一次。 */
function schedule(): void {
  if (frame || !ctx) return;
  frame = requestAnimationFrame(paint);
}

function paint(): void {
  frame = 0;
  const c = ctx;
  if (!c || !canvas) return;
  c.clearRect(0, 0, canvas.width, canvas.height);
  if (strokes.size === 0) return;

  c.save();
  c.lineCap = "round";
  c.lineJoin = "round";

  for (const stroke of strokes.values()) {
    const points = stroke.points;
    if (points.length > 1) {
      c.beginPath();
      c.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) c.lineTo(points[i].x, points[i].y);
      c.lineWidth = 3;
      c.strokeStyle = "rgba(252, 211, 18, 0.85)";
      c.stroke();
    }
    const head = points[points.length - 1];
    c.beginPath();
    c.arc(head.x, head.y, DOT_RADIUS, 0, Math.PI * 2);
    c.fillStyle = "rgba(252, 211, 18, 0.95)";
    c.fill();
  }

  // 双指捏合 / 平移：把两根手指连起来，玩家一眼看出「这是组合手势」。
  if (strokes.size === 2) {
    const [a, b] = [...strokes.values()].map((s) => s.points[s.points.length - 1]);
    c.beginPath();
    c.setLineDash([6, 6]);
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.lineWidth = 2;
    c.strokeStyle = "rgba(252, 211, 18, 0.45)";
    c.stroke();
  }

  c.restore();
}
