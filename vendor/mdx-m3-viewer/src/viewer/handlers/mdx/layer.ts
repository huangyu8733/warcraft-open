import MdlxLayer, { FilterMode, Flags } from '../../../parsers/mdlx/layer';
import MdxModel from './model';
import AnimatedObject from './animatedobject';
import TextureAnimation from './textureanimation';
import { layerFilterMode } from './filtermode';
import Shader from '../../gl/shader';

/**
 * An MDX layer.
 */
export default class Layer extends AnimatedObject {
  index: number;
  priorityPlane: number;
  filterMode: FilterMode;
  textureId = 0;
  coordId: number;
  alpha: number;
  unshaded: number;
  sphereEnvironmentMap: number;
  twoSided: number;
  unfogged: number;
  noDepthTest: number;
  noDepthSet: number;
  depthMaskValue: boolean;
  blendSrc = 0;
  blendDst = 0;
  blended = false;
  textureAnimation: TextureAnimation | null = null;
  /** OpenWar3: v1100 HD layer data, copied from the parser (see model.ts). */
  shaderTypeId = 0;
  textureSlots: [number, number][] = [];

  constructor(model: MdxModel, layer: MdlxLayer, layerId: number, priorityPlane: number) {
    super(model, layer);

    let filterMode = layer.filterMode;
    const textureAnimationId = layer.textureAnimationId;
    const gl = model.viewer.gl;

    this.index = layerId;
    this.priorityPlane = priorityPlane;

    if (filterMode > FilterMode.Modulate2x) {
      filterMode = FilterMode.Blend;
    }

    this.filterMode = filterMode;

    if (layer.textureId !== -1) {
      this.textureId = layer.textureId;
    }

    this.coordId = layer.coordId;
    this.alpha = layer.alpha;

    const flags = layer.flags;

    this.unshaded = flags & Flags.Unshaded;
    this.sphereEnvironmentMap = flags & Flags.SphereEnvMap;
    this.twoSided = flags & Flags.TwoSided;
    this.unfogged = flags & Flags.Unfogged;
    this.noDepthTest = flags & Flags.NoDepthTest;
    this.noDepthSet = flags & Flags.NoDepthSet;

    this.depthMaskValue = (filterMode === FilterMode.None || filterMode === FilterMode.Transparent);

    if (filterMode > FilterMode.Transparent) {
      this.blended = true;
      [this.blendSrc, this.blendDst] = layerFilterMode(filterMode, gl);
    }

    if (textureAnimationId !== -1) {
      const textureAnimation = model.textureAnimations[textureAnimationId];

      if (textureAnimation) {
        this.textureAnimation = textureAnimation;
      }
    }

    this.addVariants('KMTA', 'alpha');
    this.addVariants('KMTF', 'textureId');

    this.shaderTypeId = layer.shaderTypeId ?? 0;
    this.textureSlots = layer.textureSlots ?? [];
  }

  /**
   * OpenWar3: `instanceAlpha` is the whole-instance transparency (issue #66), 1 =
   * opaque. A Layer is shared by every instance of the model, so a faded unit can't
   * be expressed by mutating this.blended — the blend state has to be decided here,
   * per instance, per draw.
   */
  bind(shader: Shader, instanceAlpha = 1): void {
    const gl = this.model.viewer.gl;

    // Layers WC3 authored as opaque (filterMode None) or 1-bit alpha-tested
    // (Transparent) are drawn with blending off and depth writes on. When the
    // instance is faded they must blend instead, and stop writing depth — a
    // ghosted unit that still filled the depth buffer would occlude whatever is
    // drawn behind it afterwards, including its own further-back geosets.
    const faded = instanceAlpha < 1 && !this.blended;
    // OpenWar3: bind the layer's Unshaded flag, which the stock code left commented
    // out. It didn't matter while sd.frag's "lighting" was a near-flat 0.7..1.0
    // lambert, but the day/night cycle now really darkens models — and WC3 marks a
    // unit's TEAM COLOUR layer (replaceable 1), its team glow (replaceable 2) and
    // its effect glows as Unshaded so they stay lit at midnight. Warsmash's mdx
    // shader does the same (`if (!u_unshaded) { ...lightSystem... }`).
    gl.uniform1f(shader.uniforms['u_unshaded'], this.unshaded ? 1 : 0);
    gl.uniform1f(shader.uniforms['u_unfogged'], this.unfogged ? 1 : 0);
    gl.uniform1f(shader.uniforms['u_filterMode'], this.filterMode);

    if (this.blended) {
      gl.enable(gl.BLEND);
      gl.blendFunc(this.blendSrc, this.blendDst);
    } else if (faded) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }

    if (this.twoSided) {
      gl.disable(gl.CULL_FACE);
    } else {
      gl.enable(gl.CULL_FACE);
    }

    if (this.noDepthTest) {
      gl.disable(gl.DEPTH_TEST);
    } else {
      gl.enable(gl.DEPTH_TEST);
    }

    if (this.noDepthSet || faded) {
      gl.depthMask(false);
    } else {
      gl.depthMask(this.depthMaskValue);
    }
  }

  getAlpha(out: Float32Array, sequence: number, frame: number, counter: number): number {
    return this.getScalarValue(out, 'KMTA', sequence, frame, counter, this.alpha);
  }

  getTextureId(out: Uint32Array, sequence: number, frame: number, counter: number): number {
    return this.getScalarValue(out, 'KMTF', sequence, frame, counter, this.textureId);
  }
}
