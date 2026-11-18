// Reforged HD water is drawn from a 50-frame texture SEQUENCE, and the material stores only the
// sequence's first frame in its texture slots. The real frame comes from the LAYS layer's own
// texture track (KMTF): `War3_WaterFallBig_Diff_0000`, `…_0001`, … up to `_0049`, with the
// game's water shader stepping the sequence by time.
//
// mdx-m3-viewer's HD path resolves every texture slot STATICALLY (`slot.textureId`), so:
//   - the waterfall's spray / fall / fade / mist layers all used their slot-0 texture,
//   - City_Fountain's water geosets used the fountain's stone diffuse,
//   - and nothing moved.
//
// This wrapper feeds the renderer the layer's animated texture id for the DIFFUSE slot (and the
// slot the model filled by copying it), then steps water sequences at 30 fps. Materials are
// restored after each draw, because one MdxModel is shared by every instance on the map.

import BatchGroupCtor from "mdx-m3-viewer/dist/cjs/viewer/handlers/mdx/batchgroup";

interface HdSlot {
  textureId: number;
  index: number;
}

interface HdMaterial {
  hdSlots?: HdSlot[];
}

interface WaterModel {
  batches: { material: HdMaterial | null }[];
  /** Set by PopcornMdxModel: the logical path of every MDX texture, by index. */
  texturePaths?: string[];
}

interface WaterInstance {
  layerTextures: number[];
}

interface BatchGroupLike {
  objects: number[];
  model: WaterModel;
  render(instance: WaterInstance): void;
}

/** Frame sets are cached per model, keyed by the path with the frame number blanked out. */
const sequences = new WeakMap<WaterModel, Map<string, number[]>>();

/** Models already known to carry (or not carry) a stepped sequence. Every batch group of every
 *  instance used to re-run the regexes over its texture list on every frame just to find out it
 *  was a tree; this answers that once per model. */
const hasSequence = new WeakSet<WaterModel>();
const noSequence = new WeakSet<WaterModel>();

const FRAME = /^(.*)_(\d{4})\.(tif|dds|blp)$/i;
/** Only the water texture families are stepped by hand; everything else keeps its authored id. */
const WATER = /water|fountain|spray|mist/i;
const WATER_FPS = 30;

/** Does this model have at least one animated HD texture? Cached; texturePaths is fixed when
 *  the model is parsed. A model with no list at all (classic art, synthetic) is never stepped. */
function modelHasSequence(model: WaterModel): boolean {
  if (hasSequence.has(model)) return true;
  if (noSequence.has(model)) return false;
  let found = false;
  for (const path of model.texturePaths ?? []) {
    const match = FRAME.exec(path);
    if (match && WATER.test(path)) { found = true; break; }
  }
  (found ? hasSequence : noSequence).add(model);
  return found;
}

function waterSequence(model: WaterModel, id: number): number[] | null {
  const paths = model.texturePaths;
  const path = paths?.[id];
  if (!path) return null;
  const match = FRAME.exec(path);
  if (!match || !WATER.test(path)) return null;

  let byPrefix = sequences.get(model);
  if (!byPrefix) {
    byPrefix = new Map();
    sequences.set(model, byPrefix);
    const collected = new Map<string, { frame: number; id: number }[]>();
    paths.forEach((candidate, index) => {
      const m = FRAME.exec(candidate);
      if (!m || !WATER.test(candidate)) return;
      const list = collected.get(m[1]) ?? [];
      list.push({ frame: Number(m[2]), id: index });
      collected.set(m[1], list);
    });
    for (const [prefix, list] of collected) {
      list.sort((a, b) => a.frame - b.frame);
      byPrefix.set(prefix, list.map((entry) => entry.id));
    }
  }
  return byPrefix.get(match[1]) ?? null;
}

function waterFrame(model: WaterModel, id: number, seconds: number): number {
  const frames = waterSequence(model, id);
  if (!frames || frames.length < 2) return id;
  return frames[Math.floor(seconds * WATER_FPS) % frames.length];
}

let installed = false;

/**
 * Teach the shared HD batch renderer to honour per-frame (water) textures. Idempotent; call
 * once before the first map scene is rendered.
 */
export function installHdLayerTextures(): void {
  if (installed) return;
  installed = true;

  const proto = BatchGroupCtor.prototype as unknown as BatchGroupLike;
  const render = proto.render;

  proto.render = function (instance: WaterInstance) {
    // The overwhelmingly common case (units, trees, buildings): no stepped texture at all.
    // Answer it once per model instead of walking every batch of every instance per frame.
    if (!modelHasSequence(this.model)) {
      render.call(this, instance);
      return;
    }
    const seconds = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const patched: [HdSlot, number][] = [];
    for (const index of this.objects) {
      const material = this.model.batches[index]?.material;
      const slot = material?.hdSlots?.[0];
      if (!material || !slot) continue;
      // The layer's own texture track is the source of truth; the slot is only its first frame.
      const tracked = instance.layerTextures[slot.index];
      if (tracked === undefined) continue;
      const original = slot.textureId;
      const frame = waterFrame(this.model, tracked, seconds);
      for (const candidate of material.hdSlots!) {
        // The model fills missing slots by copying slot 0, so those copies move together.
        if (candidate === slot || candidate.textureId === original) {
          patched.push([candidate, candidate.textureId]);
          candidate.textureId = frame;
        }
      }
    }
    try {
      render.call(this, instance);
    } finally {
      for (const [slot, textureId] of patched) slot.textureId = textureId;
    }
  };
}
