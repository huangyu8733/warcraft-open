// L0 平台 / 设备层（方案 §4.1）。启动时与 resize / orientation 各算一次能力快照，
// 识别与动作层只读它，不每帧探测。
//
// 这里也是「手势开不开」的唯一判定点：`?gesture=0|1` 调试门 → 设备能力。
// P3 的 Options 开关接进来时，只改 gestureEnabled() 一处。

import { isDesktopApp } from "../../assets/nativeInstall";
import { flavor, hdArt, type GameFlavor } from "../../data/flavor";
import { hasStoredOptions, saveOptions, type Options } from "../../data/options";
import { gestureProfile } from "./profile";

export type DeviceClass = "phone" | "tablet" | "desktop-touch";
export type Platform = "electron" | "browser" | "android-webview";

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface TouchDevice {
  /** 有触摸能力（不一定被用户打开；总开关见 gestureEnabled）。 */
  enabled: boolean;
  /** `(pointer: coarse)`：手指而不是鼠标指针。 */
  coarse: boolean;
  maxTouchPoints: number;
  deviceClass: DeviceClass;
  landscape: boolean;
  safeInsets: SafeInsets;
  dpr: number;
  platform: Platform;
  /** 启动时读一次，不订阅 onFlavorChange（§9.3 第一条）。 */
  flavor: GameFlavor;
  /**
   * 底部 console 贴图的上沿，占 stage 高度的比例（§8.3 / §9.2 唯一按美术变化的数值）。
   * 手势控件与径向轮盘都不该压到这条线以下；SD 与 HD（除 `de`）共用 0.1317。
   */
  consoleTop: number;
}

/**
 * `ui/consoleUi.ts` 的 `CONSOLE_ART_TOP` 是在 0.6 高的 UI 空间里量的（`UI_HEIGHT`），
 * 而手势层用 stage 高度做单位，所以这里换成比例。两份数字同源，别各自记一份。
 */
const CONSOLE_ART_TOP_SD = 0.1317 / 0.6;
const CONSOLE_ART_TOP_DE = 0.1383 / 0.6;

const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

interface AndroidBridge {
  safeInsets?: () => string;
}

function androidBridge(): AndroidBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { ow3android?: AndroidBridge }).ow3android ?? null;
}

function readSafeInsets(dpr: number): SafeInsets {
  try {
    const raw = androidBridge()?.safeInsets?.();
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SafeInsets>;
      // `WindowInsets` is in PHYSICAL pixels; every hot-zone comparison below is in CSS pixels
      // (`window.innerWidth`, `getBoundingClientRect`). One CSS pixel is `devicePixelRatio`
      // physical pixels, so a 24dp strip on a 3x phone would otherwise eat 72px of the edge.
      const scale = dpr > 0 ? dpr : 1;
      return {
        top: (Number(parsed.top) || 0) / scale,
        right: (Number(parsed.right) || 0) / scale,
        bottom: (Number(parsed.bottom) || 0) / scale,
        left: (Number(parsed.left) || 0) / scale,
      };
    }
  } catch {
    /* fall through to the CSS environment */
  }
  // Browsers (iOS Safari, Android Chrome) publish the same numbers as `env(safe-area-inset-*)`;
  // style.css mirrors them into custom properties so they can be read once, here.
  if (typeof document === "undefined") return NO_INSETS;
  const style = getComputedStyle(document.documentElement);
  const px = (name: string): number => parseFloat(style.getPropertyValue(name)) || 0;
  return {
    top: px("--safe-top"),
    right: px("--safe-right"),
    bottom: px("--safe-bottom"),
    left: px("--safe-left"),
  };
}

function readPlatform(): Platform {
  if (androidBridge()) return "android-webview";
  return isDesktopApp() ? "electron" : "browser";
}

function classify(shortSideCss: number, coarse: boolean, maxTouchPoints: number): DeviceClass {
  if (!coarse || maxTouchPoints <= 0) return "desktop-touch";
  return shortSideCss >= 600 ? "tablet" : "phone";
}

function read(): TouchDevice {
  const nav = typeof navigator === "undefined" ? null : navigator;
  const maxTouchPoints = nav?.maxTouchPoints ?? 0;
  let coarse = false;
  try {
    coarse = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
  } catch {
    /* no matchMedia (headless): leave false */
  }
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const width = typeof window === "undefined" ? 0 : window.innerWidth;
  const height = typeof window === "undefined" ? 0 : window.innerHeight;
  const shortSideCss = Math.min(width, height);
  const platform = readPlatform();
  return {
    // A WebView always has touch, even where matchMedia is unreliable (an Android TV remote
    // reports no coarse pointer but the console is still the right interface).
    enabled: maxTouchPoints > 0 && (coarse || platform === "android-webview"),
    coarse,
    maxTouchPoints,
    deviceClass: classify(shortSideCss, coarse, maxTouchPoints),
    landscape: width >= height,
    safeInsets: readSafeInsets(dpr),
    dpr,
    platform,
    flavor: flavor(),
    // The one flavour-dependent number in the whole gesture layer (§9.2): the bottom console
    // band's top edge. Everything above it is level ground for the console's controls.
    consoleTop: hdArt() === "de" ? CONSOLE_ART_TOP_DE : CONSOLE_ART_TOP_SD,
  };
}

let snapshot: TouchDevice | null = null;

/** 当前能力快照。首次调用时读取，之后由 refreshTouchDevice() 更新。 */
export function touchDevice(): TouchDevice {
  if (!snapshot) snapshot = read();
  return snapshot;
}

/** 重新计算（resize / 方向 / 安全区变化之后调用）。 */
export function refreshTouchDevice(): TouchDevice {
  snapshot = read();
  return snapshot;
}

/** `?gesture=0|1` 的调试门；返回 null 表示没指定。 */
function queryGate(): boolean | null {
  try {
    const value = new URLSearchParams(location.search).get("gesture");
    if (value === "0") return false;
    if (value === "1") return true;
  } catch {
    /* no location (headless test) */
  }
  return null;
}

/**
 * 对局内手动开关（HUD 右上角「手势」按钮，ui/gesture/toggle.ts）。
 * `null` = 没有手动意图，回到「`?gesture` 调试门 → 存档选项 + 设备触摸」的判定；
 * 有值时优先，所以按钮在 `?gesture=1` 的调试页里也能关掉。
 */
let runtimeSwitch: boolean | null = null;

/** 写入手动开关（`null` 恢复自动判定）。只改内存，持久化由 index.ts 的 setGestureEnabled 负责。 */
export function setGestureRuntimeEnabled(on: boolean | null): void {
  runtimeSwitch = on;
}

/**
 * 手势总开关。关闭时识别器一个监听都不注册，鼠标 / 浏览器行为与今天逐字节一致（P5）。
 * 手动开关最优先；其次是 `?gesture`（调试用）；否则要求「用户开着」且「设备真的有触摸」——
 * 桌面 / 纯鼠标机器不会因为选项默认值而挂上任何监听。
 */
export function gestureEnabled(): boolean {
  if (runtimeSwitch !== null) return runtimeSwitch;
  const gate = queryGate();
  if (gate !== null) return gate;
  return gestureProfile().enabled && touchDevice().enabled;
}

/** 调试可视化：只有显式 `?gesture=1` 才画出识别回执。 */
export function gestureDebugEnabled(): boolean {
  return queryGate() === true;
}

/**
 * 触屏首启的画质建议（方案 §4.3 / §13）：手机 576p、平板 720p，都开 Low Performance Mode；
 * HD 手机再降一档（450p / 30fps）——Reforged 的 `.dds` 与 `*Skin.txt` 在 WebView 上没有离线包，
 * 这就是 P4 的「HD 手机性能 gate」：取最低档而不是硬编码改玩家存档。
 *
 * 只给「第一组值」：玩家在 Options 里改过一次后，这里永远不再写入。
 */
export function touchVideoDefaults(device: TouchDevice = touchDevice()): Partial<Options> {
  if (!device.enabled || device.deviceClass === "desktop-touch") return {};
  const phone = device.deviceClass === "phone";
  const hdPhone = phone && device.flavor === "hd";
  return {
    resolution: hdPhone ? "800x450" : phone ? "1024x576" : "1280x720",
    lowPerf: true,
    maxForegroundFps: hdPhone ? 30 : phone ? 40 : 60,
  };
}

/**
 * 把上面的建议写进首启的选项表。**只在存档不存在时**生效（§4.3 的「不要覆盖玩家已有存档」），
 * 并要求手势总开关是开的——关掉触摸控制台的人不该被顺手改了画质。
 * 返回是否写入，供测试与调试判断。
 */
export function adoptTouchVideoDefaults(opts: Options): boolean {
  if (!gestureEnabled() || hasStoredOptions()) return false;
  const suggestions = touchVideoDefaults();
  if (!Object.keys(suggestions).length) return false;
  Object.assign(opts, suggestions);
  saveOptions(opts);
  return true;
}
