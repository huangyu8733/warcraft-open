import type { Options } from "./options";

// Reforged's per-category art switches (Graphics tab): Environment, Units, Heroes, Buildings,
// Icons, VFX, and "Old Environment". They decide which asset line a category is served from,
// so a player can keep Reforged units while returning the terrain or icons to Classic.
//
// This module is only the state. The resolver (render/assetSolver.ts) asks
// `artCategoryEnabled` before it chooses the HD line for a request.

export type ArtCategory = "environment" | "units" | "heroes" | "buildings" | "icons" | "vfx" | "envold";

const enabled: Record<ArtCategory, boolean> = {
  environment: true,
  units: true,
  heroes: true,
  buildings: true,
  icons: true,
  vfx: true,
  envold: false,
};

const KEYS: Record<ArtCategory, string> = {
  environment: "artEnvironment",
  units: "artUnits",
  heroes: "artHeroes",
  buildings: "artBuildings",
  icons: "artIcons",
  vfx: "artVfx",
  envold: "artOldEnvironment",
};

export function applyArtCategories(opts: Options): void {
  for (const cat of Object.keys(enabled) as ArtCategory[]) {
    const key = KEYS[cat];
    // `envold` is an ENABLE-OLD row, so its default is the inverse of the other six.
    enabled[cat] = cat === "envold" ? opts[key] === true : opts[key] !== false;
  }
}

export function artCategoryEnabled(cat: ArtCategory): boolean {
  return enabled[cat];
}
