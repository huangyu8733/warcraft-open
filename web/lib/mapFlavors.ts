// 地图的支持版本（数据线）——与游戏自身的 `data/flavor.ts` 同义：
// sd = 经典版（1.30.4 游戏文件），hd = 重制版（3.0.1 游戏文件）。
// 一张地图可以同时支持两者（老地图几乎都是），也可以只支持其中一个（用了重制版专属
// 原生 / 高模资源的地图，或依赖 1.30.4 行为的地图）。存成按固定顺序用逗号连接的字符串，
// 空值按「两个都支持」处理，和数据库默认值保持一致。

export const MAP_FLAVORS = ["sd", "hd"] as const;

export type MapFlavor = (typeof MAP_FLAVORS)[number];

export const ADMIN_FLAVOR_LABELS: Record<MapFlavor, string> = {
  sd: "经典版",
  hd: "重制版",
};

export function isMapFlavor(value: unknown): value is MapFlavor {
  return value === "sd" || value === "hd";
}

/** 归一化一次存储值：忽略未知项、去重、按 sd→hd 的固定顺序；空字符串表示「两个都支持」。 */
export function parseFlavors(value: unknown): MapFlavor[] {
  if (typeof value !== "string") return [...MAP_FLAVORS];
  const raw = value.toLowerCase().split(",").map((item) => item.trim());
  const picked = MAP_FLAVORS.filter((flavor) => raw.includes(flavor));
  return picked.length ? picked : [...MAP_FLAVORS];
}

/** 表单 / SQL 用的存储形式："sd"、"hd"、"sd,hd"。 */
export function flavorsText(flavors: readonly MapFlavor[]): string {
  return MAP_FLAVORS.filter((flavor) => flavors.includes(flavor)).join(",");
}

export function supportsFlavor(value: unknown, flavor: MapFlavor): boolean {
  return parseFlavors(value).includes(flavor);
}
