// 触觉反馈（方案 §8 / §10.1 `gestureHaptics`）。
//
// 只有离散、已判定的手势才震一下：长按（智能命令）、双击、双指轻点（取消）、
// 三指轻点（菜单）。捏合 / 平移是连续手势，逐帧震会像故障，所以不接。
//
// 平台顺序：Android 壳的 `ow3android.vibrate(ms)` → 浏览器 `navigator.vibrate`。
// 都没有时静默失败；桌面触屏没有震动硬件，本来就不该有声音之外的期待。

export type HapticKind = "longpress" | "doubletap" | "cancel" | "menu";

const DURATION_MS: Record<HapticKind, number> = {
  longpress: 12,
  doubletap: 8,
  cancel: 16,
  menu: 24,
};

let enabled: () => boolean = () => false;

/** `profile.haptics` 每次现取，Options 里改完下一次手势就生效。 */
export function startGestureFeedback(isEnabled: () => boolean): void {
  enabled = isEnabled;
}

export function gestureHaptic(kind: HapticKind): void {
  if (!enabled()) return;
  const ms = DURATION_MS[kind];

  const bridge = (window as unknown as { ow3android?: { vibrate?: (ms: number) => void } }).ow3android;
  if (bridge?.vibrate) {
    try {
      bridge.vibrate(ms);
      return;
    } catch {
      /* the shell refused; fall through to the browser */
    }
  }

  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no vibration on this device */
  }
}
