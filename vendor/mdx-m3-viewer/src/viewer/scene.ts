import { vec3, vec4 } from 'gl-matrix';
import ModelViewer from './viewer';
import Camera from './camera';
import Grid from './grid';
import Cell from './cell';
import ModelInstance from './modelinstance';
import EmittedObjectUpdater from './emittedobjectupdater';

/**
 * OpenWar3 (P2-2): do two instances resolve every layer to the same alpha? A static doodad
 * normally has no KMTA tracks at all, so this is a handful of number comparisons; the check
 * exists so an animated alpha can never be baked into a shared instanced draw.
 */
function ow3SameLayerAlphas(a: ModelInstance, b: ModelInstance): boolean {
  const alphasA = (<{ layerAlphas?: number[] }><unknown>a).layerAlphas;
  const alphasB = (<{ layerAlphas?: number[] }><unknown>b).layerAlphas;

  if (alphasA === undefined || alphasB === undefined || alphasA.length !== alphasB.length) {
    return false;
  }

  for (let i = 0, l = alphasA.length; i < l; i++) {
    if (alphasA[i] !== alphasB[i]) {
      return false;
    }
  }

  return true;
}

/** OpenWar3: one evaluation of a DNC (day/night cycle) light, the terms of WC3's
 *  fixed-function lighting. `null` on scenes with no cycle. */
export interface SceneDayNightLight {
  /** ambientColor · ambientIntensity, per channel. */
  ambient: Float32Array;
  /** color · intensity, per channel — modulated by max(dot(N, direction), 0). */
  diffuse: Float32Array;
  /** Unit vector pointing TOWARD the sun, world space (Z up). */
  direction: Float32Array;
}

/** OpenWar3: linear distance fog read by the SD model shaders (see src/render/fog.ts). */
export interface SceneDistFog {
  enabled: boolean;
  start: number;
  end: number;
  color: Float32Array;
  honourFlags?: boolean;
}

/** OpenWar3: the map's unplayable area, painted over the objects standing in it
 *  (see src/render/fogOverlay.ts). */
export interface SceneBoundaryMask {
  texture: WebGLTexture | null;
  /** world XY → mask UV */
  params: Float32Array;
  lit: Float32Array;
  fogged: Float32Array;
}

/** OpenWar3: WC3's fixed-function lighting state (see sd.vert / src/render/menuScene.ts). */
export interface SceneFixedFunctionLights {
  emissive: Float32Array;
  positions: Float32Array;
  colors: Float32Array;
  /** (a0, a1, a2, range) */
  atten: Float32Array;
  lodBias: number;
}

/** OpenWar3: scratch list of the cells a frame's camera cannot see (Scene.update). */
const ow3HiddenCells: Cell[] = [];

/**
 * A scene.
 *
 * Every scene has its own list of model instances, and its own camera and viewport.
 *
 * In addition, every scene may have its own AudioContext if enableAudio() is called.
 * If audio is enabled, the AudioContext's listener's location will be updated automatically.
 * Note that due to browser policies, this may be done only after user interaction with the web page.
 */
export default class Scene {
  viewer: ModelViewer;
  camera = new Camera();
  grid = new Grid(-100000, -100000, 200000, 200000, 200000, 200000);
  visibleCells = 0;
  visibleInstances = 0;
  updatedParticles = 0;
  audioEnabled = false;
  audioContext: AudioContext | null = null;
  instances: ModelInstance[] = [];
  emittedObjectUpdater = new EmittedObjectUpdater();
  /**
   * Similar to WebGL's own `alpha` parameter.
   * 
   * If false, the scene will be cleared before rendering, meaning that scenes behind it won't be visible through it.
   * 
   * If true, alpha works as usual.
   */
  alpha = false;
  /**
   * The scene's background color.
   * 
   * Only used if `alpha` is false.
   */
  color = vec3.create();
  /**
   * The area on the canvas in which this scene is rendered.
   * 
   * Defaults to the entire canvas.
   * 
   * The vector defines [x, y, width, height], sizes are in pixels, and everything is related to the bottom left corner of the canvas.
   */
  viewport = vec4.create();
  /**
   * The position of the light that is used when rendering.
   * 
   * Affects HD MDX and M3 models.
   */
  lightPosition = vec3.fromValues(0, 0, 10000);

  // OpenWar3: the tileset's day/night-cycle light, sampled per frame from the
  // Environment\DNC\* models (src/render/dayNight.ts). Terrain and units carry
  // the same colours but different ambient intensities, so each is set on its
  // own draw: ground/cliffs take dncTerrain, MDX instances take dncUnit.
  // Both are `null` until a host installs them, and every shader falls back to
  // its stock unlit path when dncEnabled is 0 — so other scenes (the portrait
  // bust, the HUD clock) are untouched.
  dncEnabled = 0;
  dncTerrain: SceneDayNightLight | null = null;
  dncUnit: SceneDayNightLight | null = null;

  /** OpenWar3: the map's w3i environment haze (src/render/fog.ts). Undefined = no fog. */
  distFog?: SceneDistFog;

  /** OpenWar3: the map's unplayable area (src/render/fogOverlay.ts). Undefined off the map. */
  boundaryMask?: SceneBoundaryMask;

  /** OpenWar3: WC3's fixed-function lighting (a glue scene's own LITE lights). Null = off. */
  ffp?: SceneFixedFunctionLights | null = null;

  constructor(viewer: ModelViewer) {
    this.viewer = viewer;

    const canvas = viewer.canvas;
    const width = canvas.width;
    const height = canvas.height;

    // Use the whole canvas by default.
    this.viewport[2] = width;
    this.viewport[3] = height;

    // And standard perspective projection.
    this.camera.perspective(Math.PI / 4, width / height, 8, 10000);
  }

  /**
   * Creates an AudioContext if one wasn't created already, and resumes it if needed.
   * 
   * The returned promise will resolve to whether it is actually running or not.
   * 
   * It may stay in suspended state indefinitly until the user interacts with the page, due to browser policies.
   */
  async enableAudio(): Promise<boolean> {
    if (typeof AudioContext === 'function') {
      if (!this.audioContext) {
        this.audioContext = new AudioContext();
      }

      if (this.audioContext.state !== 'suspended') {
        await this.audioContext.resume();
      }

      this.audioEnabled = this.audioContext.state === 'running';

      return this.audioEnabled;
    }

    return false;
  }

  /**
   * Suspend the audio context.
   */
  disableAudio(): void {
    if (this.audioContext) {
      this.audioContext.suspend();
    }

    this.audioEnabled = false;
  }

  /**
   * Sets the scene of the given instance.
   * 
   * Equivalent to instance.setScene(scene).
   */
  addInstance(instance: ModelInstance): boolean {
    if (instance.scene !== this) {
      if (instance.scene) {
        instance.scene.removeInstance(instance);
      }

      instance.scene = this;

      this.grid.moved(instance);

      return true;
    }

    return false;
  }

  /**
   * Remove the given instance from this scene.
   * 
   * Equivalent to ModelInstance.detach().
   */
  removeInstance(instance: ModelInstance): boolean {
    if (instance.scene === this) {
      this.grid.remove(instance);

      instance.scene = null;

      return true;
    }

    return false;
  }

  /**
   * Clear this scene.
   */
  clear(): void {
    // First remove references to this scene stored in the instances.
    for (const cell of this.grid.cells) {
      for (const instance of cell.instances) {
        instance.scene = null;
      }
    }

    // Then remove references to the instances.
    this.grid.clear();
  }

  /**
   * Detach this scene from the viewer.
   * 
   * Equivalent to viewer.removeScene(scene).
   */
  detach(): boolean {
    if (this.viewer) {
      return this.viewer.removeScene(this);
    }

    return false;
  }

  /**
   * Update this scene.
   */
  update(dt: number): void {
    const camera = this.camera;

    // Update the audio context's position if it exists.
    if (this.audioContext) {
      const listener = this.audioContext.listener;
      const position = camera.location;
      const forward = camera.directionY;
      const up = camera.directionZ;

      listener.positionX.value = -position[0];
      listener.positionY.value = -position[1];
      listener.positionZ.value = -position[2];

      listener.forwardX.value = forward[0];
      listener.forwardY.value = forward[1];
      listener.forwardZ.value = forward[2];

      listener.upX.value = up[0];
      listener.upY.value = up[1];
      listener.upZ.value = up[2];
    }

    const frame = this.viewer.frame;
    const instances = this.instances;

    this.visibleCells = 0;
    this.visibleInstances = 0;

    // OpenWar3: the cells the camera cannot see, kept for the second pass below.
    const ow3Hidden = ow3HiddenCells;

    ow3Hidden.length = 0;

    // Update and collect all of the visible instances.
    for (const cell of this.grid.cells) {
      if (!cell.isVisible(camera)) {
        ow3Hidden.push(cell);
      } else {
        this.visibleCells += 1;

        for (const instance of cell.instances) {
          // If an instance is rendered, wasn't updated on this frame, and has no parent, update it.
          // If the instance is visible, it will be updated, all of its children will be updated, and it will be added to the render list.
          // Note that the update frame is needed because instances can exist in any number of cells at the same time.
          if (instance.rendered && instance.updateFrame < frame && !instance.parent) {
            instance.updateFrame = frame;
            instance.update(dt);
          }
        }
      }
    }

    // OpenWar3: …and everything the camera cannot see still KEEPS TIME. Stock, an instance
    // outside the frustum was simply not updated: its clip stood still, `sequenceEnded`
    // never came, and an animation EVENT (a spawned model, a splat, an ubersplat) keyed
    // inside a clip that ran off screen fired the first time the player looked — a death
    // splat laid late, in front of them. WC3 runs the world whether or not you watch it.
    // `ow3TickHidden` advances the clock and the events and poses nothing unless an event
    // has to land somewhere (handlers/mdx/modelinstance.ts). A SECOND pass, so an instance
    // that straddles a visible cell and a hidden one is drawn, never merely ticked: the
    // first pass stamped `updateFrame` on everything it reached.
    for (const cell of ow3Hidden) {
      for (const instance of cell.instances) {
        if (instance.rendered && instance.updateFrame < frame && !instance.parent) {
          instance.updateFrame = frame;

          if (instance.ow3TickHidden) {
            instance.ow3TickHidden(dt * instance.timeScale);
          }
        }
      }
    }

    ow3Hidden.length = 0;

    // Sort the visible instances based on depth.
    instances.length = this.visibleInstances;
    instances.sort((a, b) => a.depth - b.depth);

    this.emittedObjectUpdater.update(dt);
    this.updatedParticles = this.emittedObjectUpdater.alive;
  }

  renderInstance(instance: ModelInstance): void {
    this.instances[this.visibleInstances++] = instance;
  }

  /**
   * Use the scene's viewport.
   * 
   * Should be called before `renderOpaque()` and `renderTranslucent()`.
   * 
   * Called automatically by `render()`.
   */
  startFrame(): void {
    const gl = this.viewer.gl;
    const viewport = this.viewport;

    // Set the viewport.
    gl.viewport(viewport[0], viewport[1], viewport[2], viewport[3]);

    // Allow to render only in the viewport.
    gl.scissor(viewport[0], viewport[1], viewport[2], viewport[3]);

    // If this scene doesn't want alpha, clear it.
    if (!this.alpha) {
      const color = this.color;

      gl.depthMask(true);
      gl.clearColor(color[0], color[1], color[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
  }

  /**
   * Render opaque things in this scene.
   * 
   * They are rendered front to back.
   */
  renderOpaque(): void {
    const instances = this.instances;

    // OpenWar3 (P2-2): static doodads are drawn once per (model, textures, team colour) instead
    // of once per instance. Only a WebGL 2 context carries the per-vertex matrix attribute; and
    // anything that does not qualify — units, animated props, faded instances, layers with
    // animation — takes the original per-instance path unchanged.
    if (this.viewer.webgl.isWebGL2) {
      let buckets: Map<ModelInstance['model'], Map<string, ModelInstance[]>> | null = null;

      for (let i = 0, l = instances.length; i < l; i++) {
        const instance = instances[i];
        const instancedStatic = instance.ow3InstancedStatic;

        if (instancedStatic && instancedStatic.call(instance)) {
          if (buckets === null) {
            buckets = new Map();
          }

          const model = instance.model;
          let byKey = buckets.get(model);

          if (byKey === undefined) {
            byKey = new Map();
            buckets.set(model, byKey);
          }

          const key = instance.ow3InstKey ? instance.ow3InstKey() : '';
          let bucket = byKey.get(key);

          if (bucket === undefined) {
            bucket = [];
            byKey.set(key, bucket);
          } else if (!ow3SameLayerAlphas(bucket[0], instance)) {
            // A layer alpha track (KMTA) makes two otherwise identical doodads draw
            // differently, and the instanced pass writes the alpha once. Keep those apart.
            instance.renderOpaque();
            continue;
          }

          bucket.push(instance);
        } else {
          instance.renderOpaque();
        }
      }

      if (buckets !== null) {
        buckets.forEach((byKey) => {
          byKey.forEach((bucket) => {
            // The MDX model's render groups; typed loosely so this file need not import the
            // handler (and the import cycle that would come with it).
            const model = <any>bucket[0].model;

            for (const group of <any[]>model.opaqueGroups) {
              if (group.isHd) {
                group.renderInstanced(bucket);
              } else {
                for (let i = 0, l = bucket.length; i < l; i++) {
                  group.render(bucket[i]);
                }
              }
            }
          });
        });
      }

      return;
    }

    for (let i = 0, l = instances.length; i < l; i++) {
      instances[i].renderOpaque();
    }
  }

  /**
   * Renders translucent things in this scene.
   * 
   * They are rendered back to front.
   */
  renderTranslucent(): void {
    const instances = this.instances;

    for (let i = instances.length - 1; i >= 0; i--) {
      instances[i].renderTranslucent();
    }
  }

  /**
   * Render this scene.
   */
  render(): void {
    this.startFrame();
    this.renderOpaque();
    this.renderTranslucent();
  }

  /**
   * Clear all of the emitted objects in this scene.
   */
  clearEmittedObjects(): void {
    for (const object of this.emittedObjectUpdater.objects) {
      object.health = 0;
    }
  }
}
