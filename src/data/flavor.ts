// 当前客户端所在的资产 / 数据线：SD（1.30.4 经典）或 HD（Reforged）。
//
// 一次进程只有一个 flavor，而且必须在任何数据模块第一次读表之前确定：
// `data/edition.ts`、`data/units.ts`、`vfs/edition.ts` 都在模块级缓存解析结果，
// 所以运行中切换不能只重建场景，必须整页 / 整个 renderer 重载（SD-HD双版本方案.md §1）。
//
// 这个模块刻意不依赖 anything：`vfs/version.ts` 会 import 它，反向依赖会成环。

export type GameFlavor = "sd" | "hd";

const STORAGE_KEY = "warcraft-open.flavor";

function stored(): GameFlavor {
  try {
    return localStorage.getItem(STORAGE_KEY) === "hd" ? "hd" : "sd";
  } catch {
    return "sd"; // 没有 storage（headless 测试、受限浏览器）：默认经典版
  }
}

let current: GameFlavor = initial();

function initial(): GameFlavor {
  // `?flavor=hd` is the test / direct-link door, and the same one the dev boot reads. It wins
  // over storage for this launch only; the launcher's switch persists through setFlavor.
  try {
    const asked = new URLSearchParams(location.search).get("flavor");
    if (asked === "sd" || asked === "hd") return asked;
  } catch {
    /* no location (headless test): fall through to storage */
  }
  return stored();
}
const listeners = new Set<(f: GameFlavor) => void>();

/** 当前 flavor。 */
export function flavor(): GameFlavor {
  return current;
}

export function isHd(): boolean {
  return current === "hd";
}

/** 切换并记住。真正的切换必须由调用方负责整页重载——这里只改状态。 */
export function setFlavor(next: GameFlavor): void {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* 没记住也算本次切换成功 */
  }
  for (const fn of listeners) fn(next);
}

/** 订阅 flavor 变化。返回取消订阅函数。 */
export function onFlavorChange(fn: (f: GameFlavor) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Which art set the HD client draws (P3).
 *
 * 3.0 ships THREE, selectable in its own Graphics tab as CLASSIC / REFORGED / DEFINITIVE
 * EDITION, and they all answer to the same logical paths:
 *
 *   War3.w3mod                  classic art, in the base module (no art module mounted)
 *   War3.w3mod:_HD.w3mod:<p>    original Reforged art
 *   War3.w3mod:_DE.w3mod:<p>    Definitive Edition art (our default)
 *
 * `"sd"` picks the classic SET — the 3.0 DATA with 1.30-era models. It is not the same thing
 * as `flavor = "sd"`, which reads the 1.30.4 install and draws the classic FDF front end; this
 * one keeps the Reforged front end and only swaps what the units are made of.
 *
 * Like `flavor`, this is decided once per process: the mount itself is built from it
 * (`vfs/casc.ts`), so flipping it mid-session would need a whole page reload anyway.
 * Options → Video → 美术风格 is the switch (ui/hd/options.ts).
 */
export type HdArt = "sd" | "hd" | "de";

const ART_KEY = "warcraft-open.hdArt";

function asArt(value: string | null | undefined): HdArt | null {
  return value === "sd" || value === "hd" || value === "de" ? value : null;
}

function storedArt(): HdArt {
  try {
    return asArt(localStorage.getItem(ART_KEY)) ?? "de";
  } catch {
    return "de";
  }
}

let art: HdArt = initialArt();

function initialArt(): HdArt {
  // `?hdArt=sd|hd|de` is the direct-link / test door, as `?flavor=` is for the flavor itself.
  try {
    const asked = asArt(new URLSearchParams(location.search).get("hdArt"));
    if (asked) return asked;
  } catch {
    /* no location (headless test): fall through to storage */
  }
  return storedArt();
}

/** The HD art set in use. Meaningless on SD, where the store has neither module. */
export function hdArt(): HdArt {
  return art;
}

/** Switch and remember. The caller owns the reload, exactly as `setFlavor`. */
export function setHdArt(next: HdArt): void {
  if (next === art) return;
  art = next;
  try {
    localStorage.setItem(ART_KEY, next);
  } catch {
    /* not remembered — still this session's pick */
  }
}

/**
 * Drop a `?flavor=` / `?hdArt=` direct-link door from the URL before reloading.
 *
 * Both initialisers let the query string win over storage on EVERY load, which is what makes
 * a shared/test link decisive. It also means a switch made in the UI would be undone by the
 * very reload it triggers: the page came from `?hdArt=sd`, the pick writes `de` to storage,
 * the reload re-reads `sd` from the URL. Removing the parameter lets the stored pick take over.
 */
export function forgetUrlSwitch(...names: string[]): void {
  try {
    const url = new URL(location.href);
    let changed = false;
    for (const name of names) {
      if (url.searchParams.has(name)) {
        url.searchParams.delete(name);
        changed = true;
      }
    }
    if (changed) history.replaceState(null, "", url);
  } catch {
    /* no location (headless test): nothing to forget */
  }
}
