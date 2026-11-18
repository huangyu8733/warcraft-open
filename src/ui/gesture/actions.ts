// L2 动作分发（方案 §7.3，仿 game/voiceActions.ts 的 `run(i)`）。
//
// 一个 `GestureIntent` → 一次既有的游戏动作。这里只做映射与门控，不碰 `SimWorld`、
// 不直调 `Authority.execute`、不为手势新增任何 `Command`（§7.4）。
//
// 坐标：调用方（index.ts）已把 `world` 区域换成地图 canvas 的 CSS 像素；其余区域保持
// client 像素。本模块不读 DOM，所以 gesture-action-test.cjs 能在 headless 里直接断言。

import { withInputOverride } from "../inputSource";
import type { GestureIntent } from "./intents";
import type { GestureCardButton, GestureMatchHost } from "./host";

/**
 * 轮盘槽位 → 命令卡按钮（§6.1 / §8.8）。槽位是 `row * 4 + col`，与键盘 Grid 同形；
 * 卡上没有坐标信息时退回数组下标。找不到（空槽 / 越界）返回 null。
 */
export function cardButtonForSlot(
  card: readonly GestureCardButton[],
  slot: number | undefined,
): GestureCardButton | null {
  if (slot === undefined || !Number.isInteger(slot) || slot < 0 || slot > 11) return null;
  const placed = card.some((b) => b.col !== undefined && b.row !== undefined);
  if (!placed) return card[slot] ?? null;
  return card.find((b) => b.col !== undefined && b.row !== undefined && b.row * 4 + b.col === slot) ?? null;
}

/** 玩家设置里会影响动作映射的两项（profile.ts 提供，默认都开）。 */
export interface GestureActionOptions {
  /** 世界里的静止长按是否发智能命令；false 时只保留 HUD 的 tooltip 语义。 */
  longPressIsRightClick?: boolean;
  /** 双指捏合是否缩放。 */
  pinchZoom?: boolean;
  /**
   * 平板三/四指手势是否生效（§6.2：默认关，只在平板上由 profile 打开）。
   * 手机永远为 false，避免与系统的三指缩放 / 四指切应用冲突。
   */
  multiFinger?: boolean;
}

/**
 * 执行一个手势。返回是否真的派发了动作（门控拒绝 / 未知手势 / 设置关闭 → false）。
 *
 * `canAct()` 是所有手势的唯一门（§12 / P6）：模态、聊天输入、暂停、观战全在宿主的
 * 实现里判，这里只问一次。门控为假时**零调用**，这是 gesture-action-test 的硬断言。
 *
 * 过场是唯一一条先于 `canAct()` 的例外（§12）：过场里 HUD 被收走（`canAct()` 必假），
 * 但「点一下跳过」必须是可用的 —— 所以先看 `isCinematic()`，只放行跳过，其余一概不派发。
 */
export function performGesture(
  host: GestureMatchHost,
  i: GestureIntent,
  options: GestureActionOptions = {},
): boolean {
  // 过场里只放行「跳过过场」：一次轻点（或双指轻点，等同取消/继续）落 ESC 的同一条路。
  if (host.isCinematic()) {
    if (i.kind !== "tap" && i.kind !== "twoFingerTap") return false;
    return host.skipCinematic();
  }
  if (!host.canAct()) return false;
  // HUD / 命令卡 / 小地图的轻点仍由它们自己的 pointerdown 处理（`onPress`）；这里连
  // 归因 override 都不该设，否则紧接着的一次原生按钮点击会被记成「手势」。
  if ((i.kind === "tap" || i.kind === "doubletap") && i.area !== "world") return false;

  let acted = true;
  // 回放 / APM 输入轨归因：合成出来的点击与按键是「手势」的，不是「手柄」的
  // （inputSource.ts 的 override 是最后写入者胜，与 Voice / Gamepad 同一套）。
  withInputOverride("gesture", () => {
    switch (i.kind) {
      case "tap":
        // world only (the early return above took every other area).
        // armed 施法 / 建造放置时，这一点必须落地；否则就是一次普通选中。
        if (host.armed()) host.orderAt(i.x, i.y, false);
        else host.selectAt(i.x, i.y, {});
        break;

      case "doubletap":
        // 与桌面第二次点击的 `sameType` 语义一致（UI 侧双击）。
        host.selectAt(i.x, i.y, { sameType: true });
        break;

      case "longpress":
        // 触屏没有右键：世界里的静止长按就是智能命令；HUD 上没有 hover，长按读 tooltip。
        // 玩家把「长按 = 智能命令」关掉时，世界里就不该再冒出一个右键。
        if (i.area === "world") {
          if (options.longPressIsRightClick === false) acted = false;
          else host.smartAt(i.x, i.y, false);
        } else {
          host.hoverAt(i.x, i.y);
        }
        break;

      case "dragbox": {
        const from = i.from;
        const to = i.to;
        // 框选只属于世界（§6.1）。从小地图 / HUD 起手的拖动是那些控件自己的，而且它们的
        // 坐标是 client 像素（index.ts 只换算 `area === "world"`），当成 canvas 像素传给
        // selectBox 会在一个完全不相干的位置框选。
        if (i.area !== "world" || !from || !to) acted = false;
        else host.selectBox(from.x, from.y, to.x, to.y, false);
        break;
      }

      case "swipe":
        // 空白世界的快速滑动 = 一次相机平移，位移取起止点差（px）。
        if (i.from && i.to) host.panBy(i.to.x - i.from.x, i.to.y - i.from.y);
        else acted = false;
        break;

      case "twoFingerPan":
        // 识别器给的是本次事件的质心位移（px）。
        host.panBy(i.vx ?? 0, i.vy ?? 0);
        break;

      case "edgeHold":
        // 安全区内边缘按住：index.ts 的帧循环按「方向 × 速度 × dt」发来的位移（px），
        // 与双指平移 / 中键拖拽同一条 `panBy` → `midPan` 通道（§6.1）。
        host.panBy(i.vx ?? 0, i.vy ?? 0);
        break;

      case "pinch":
        if (options.pinchZoom === false) acted = false;
        else host.zoomBy(i.steps ?? 0);
        break;

      case "twoFingerTap":
        host.cancel();
        break;

      case "threeFingerTap":
        // 平板专属（§6.2）：开关关着、或设备是手机时，识别器照发但这里不派发。
        if (options.multiFinger !== true) acted = false;
        else host.toggleMenu();
        break;

      case "fourFingerTap":
        // 平板专属可选手势：聊天 / 编队面板（`toggleChat`，等同回车）。
        if (options.multiFinger !== true) acted = false;
        else host.toggleChat();
        break;

      case "radial": {
        // 12 槽轮盘：极坐标选槽 → 该槽上的命令卡按钮（§6.1）。与 HUD 按钮同一判定：
        // 灰掉（disabled）与被动（passive）都不吃按键，空槽不发明命令。
        const button = cardButtonForSlot(host.card(), i.slot);
        if (!button || button.disabled || button.passive) acted = false;
        else host.press(button.id);
        break;
      }

      default:
        // `holdMove` 属于 P3 可选的虚拟摇杆，识别器暂不产出。
        acted = false;
        break;
    }
  });
  return acted;
}
