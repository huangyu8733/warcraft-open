import MdxModel from './model';
import Layer from './layer';
import { FilterMode } from '../../../parsers/mdlx/layer';

/** One texture slot of an HD material (see `Material.hdSlots`). */
export interface HdSlot {
  textureId: number;
  index: number;
  filterMode: FilterMode;
  coordId: number;
  /** OpenWar3: true when model.ts filled the slot with a stand-in — not authored data. */
  synthetic?: boolean;
}

/**
 * An MDX material.
 */
export default class Material {
  model: MdxModel;
  shader: string;
  layers: Layer[];
  /** OpenWar3: v1800/DE HD materials are ONE layer with six texture slots; model.ts presents
   *  that shape here so the renderer's six-layer destructuring works for both layouts. */
  hdSlots?: HdSlot[];
  /** OpenWar3: whether this material is the HD (SLK shader) one. */
  hd = false;

  constructor(model: MdxModel, shader: string, layers: Layer[]) {
    this.model = model;
    this.shader = shader;
    this.layers = layers;
  }
}
