
import Parser from '../../../parsers/mdlx/model';
import Sequence from './sequence';
import { HandlerResourceData } from '../../handlerresource';
import Model from '../../model';
import Texture from '../../texture';
import mdxHandler from './handler';
import TextureAnimation from './textureanimation';
import Layer from './layer';
import Material, { HdSlot } from './material';
import GeosetAnimation from './geosetanimation';
import replaceableIds from './replaceableids';
import Bone from './bone';
import Light from './light';
import Helper from './helper';
import Attachment from './attachment';
import ParticleEmitterObject from './particleemitterobject';
import ParticleEmitter2Object from './particleemitter2object';
import RibbonEmitterObject from './ribbonemitterobject';
import Camera from './camera';
import EventObjectEmitterObject from './eventobjectemitterobject';
import CollisionShape from './collisionshape';
import setupGeosets from './setupgeosets';
import setupGroups from './setupgroups';
import BatchGroup from './batchgroup';
import EmitterGroup from './emittergroup';
import GenericObject from './genericobject';
import { Batch } from './batch';
import Geoset from './geoset';
import MdxModelInstance from './modelinstance';
import type { Ow3Pose, Ow3BillboardPlan } from './modelinstance';
import MdxTexture from './texture';

/**
 * An MDX model.
 */
export default class MdxModel extends Model {
  reforged = false;
  hd = false;
  solverParams: { reforged?: boolean, hd?: boolean } = {};
  name = '';
  sequences: Sequence[] = [];
  globalSequences: number[] = [];
  materials: Material[] = [];
  layers: Layer[] = [];
  textures: MdxTexture[] = [];
  textureAnimations: TextureAnimation[] = [];
  geosets: Geoset[] = [];
  geosetAnimations: GeosetAnimation[] = [];
  bones: Bone[] = [];
  lights: Light[] = [];
  helpers: Helper[] = [];
  attachments: Attachment[] = [];
  pivotPoints: Float32Array[] = [];
  particleEmitters: ParticleEmitterObject[] = [];
  particleEmitters2: ParticleEmitter2Object[] = [];
  ribbonEmitters: RibbonEmitterObject[] = [];
  cameras: Camera[] = [];
  eventObjects: EventObjectEmitterObject[] = [];
  collisionShapes: CollisionShape[] = [];
  hasLayerAnims = false;
  hasGeosetAnims = false;
  batches: Batch[] = [];
  genericObjects: GenericObject[] = [];
  sortedGenericObjects: GenericObject[] = [];
  hierarchy: number[] = [];
  opaqueGroups: BatchGroup[] = [];
  translucentGroups: (BatchGroup | EmitterGroup)[] = [];
  arrayBuffer: WebGLBuffer | null = null;
  elementBuffer: WebGLBuffer | null = null;
  skinDataType = 0;
  bytesPerSkinElement = 1;

  // OpenWar3 (issue #161), Low Performance Mode: the shared pose cache and the facts about
  // this model that decide whether its pose, or its whole skeleton, may be shared. All filled
  // lazily by modelinstance.ts — see the long note at the top of that file.
  ow3PoseCache?: Map<number, Ow3Pose>;
  ow3OwnClock?: boolean;
  ow3DontInherit?: boolean;
  ow3SkeletonShareable?: boolean;
  ow3Billboards?: Ow3BillboardPlan | null;
  /** OpenWar3 (P2-2): per sequence, whether no node has a translation/rotation/scale track. */
  ow3StaticSequences?: Map<number, boolean>;
  /**
   * OpenWar3 (P2-2): one refreshable pose per sequence for animated static doodads. Unlike
   * `ow3PoseCache` these are NOT keyed by time bucket — the pose is updated in place when the
   * bucket rolls over, so a 30 Hz clip does not mint (and leak) a bone texture per bucket.
   */
  ow3DoodadPoses?: Map<number, { pose: import('./modelinstance').Ow3Pose; bucket: number }>;

  constructor(bufferOrParser: ArrayBuffer | string | Parser, resourceData: HandlerResourceData) {
    super(resourceData);

    let parser;

    if (bufferOrParser instanceof Parser) {
      parser = bufferOrParser;
    } else {
      parser = new Parser();

      try {
        parser.load(bufferOrParser);
      } catch (e) {
        // If we get here, the parser failed to load.
        // It still may have loaded enough data to support rendering though!
        // I have encountered a model that is missing data, but still works in-game.
        // So just let the code continue.
        // If the handler manages to load the model, nothing happened.
        // If critical data is missing, it will fail and throw its own exception.
      }
    }

    const viewer = this.viewer;
    const pathSolver = this.pathSolver;
    const solverParams = this.solverParams;
    const reforged = parser.version > 800;
    // OpenWar3: the VERSION is a file layout, not an asset flavour. We draw SD out of an SD
    // install, which has no .dds at all, so a v1000/v1100 model imported into a custom map
    // wants the same ReplaceableTextures\*.blp as any other (see solverParams below, and
    // docs/map-compatibility.md on the map handler's twin of this).
    const texturesExt = '.blp';
    let hasTeamColors = false;

    this.reforged = reforged;
    this.name = parser.name;

    // Initialize the bounds.
    const extent = parser.extent;
    this.bounds.fromExtents(extent.min, extent.max);

    // Sequences
    for (const sequence of parser.sequences) {
      this.sequences.push(new Sequence(sequence));
    }

    // Global sequences
    for (const globalSequence of parser.globalSequences) {
      this.globalSequences.push(globalSequence);
    }

    // Texture animations
    for (const textureAnimation of parser.textureAnimations) {
      this.textureAnimations.push(new TextureAnimation(this, textureAnimation));
    }

    // Materials
    let layerId = 0;
    for (const material of parser.materials) {
      const layers = [];

      for (const layer of material.layers) {
        const vLayer = new Layer(this, layer, layerId++, material.priorityPlane);

        layers.push(vLayer);

        this.layers.push(vLayer);
      }

      const vMaterial = new Material(this, material.shader, layers);

      // OpenWar3: a DE/v1800 (1.33+) HD material is ONE LAYS layer carrying six texture
      // SLOTS — 0 diffuse, 1 normal, 2 ORM, 3 emissive, 4 team colour, 5 environment map —
      // where a v1000 HD material carried the same six as six separate LAYS. The renderer
      // (batchgroup.ts) only knows the six-layer shape, so present it that here.
      //
      // ONLY a material whose layer says `shaderTypeId > 0` is that HD one. The same files
      // also carry plain per-layer textures this way — the gore/billboard planes of a unit
      // (shaderTypeId 0, one slot) and every glue screen's quads (the menu's whole
      // background, shaderTypeId 0) — and those are drawn exactly as they always were.
      const hdMaterial = material.shader === 'Shader_HD_DefaultUnit' || material.layers.some((layer) => layer.shaderTypeId > 0);

      if (material.layers.some((layer) => layer.shaderTypeId > 0)) {
        const slots: (HdSlot | undefined)[] = [];

        for (const layer of layers) {
          for (const [textureId, slot] of layer.textureSlots) {
            if (slot < 6 && !slots[slot]) {
              slots[slot] = { textureId, index: layer.index, filterMode: layer.filterMode, coordId: layer.coordId };
            }
          }
        }

        const first = <HdSlot>slots.find(Boolean);
        const black = parser.textures.findIndex((texture) => /black32/i.test(texture.path));
        const team = parser.textures.findIndex((texture) => texture.replaceableId === 1);
        const env = parser.textures.findIndex((texture) => /environmentmap/i.test(texture.path));
        // A slot the model left out still has to hand the HD shader a real sampler: use
        // what the model itself ships (black for emissive, its team colour, its env map)
        // rather than an undefined, which the renderer would read a field of.
        const fill = (slot: number): number => (slot === 3 && black >= 0 ? black : slot === 4 && team >= 0 ? team : slot === 5 && env >= 0 ? env : first.textureId);

        for (let i = 0; i < 6; i++) {
          if (!slots[i]) {
            // Mark the slot: it points at a stand-in texture, so the HD shader must
            // not treat it as authored data (a diffuse map read as a normal/ORM
            // map lights and occludes the model wrongly).
            slots[i] = { ...first, textureId: fill(i), synthetic: true };
          }
        }

        vMaterial.hdSlots = <HdSlot[]>slots;
      }

      vMaterial.hd = hdMaterial;
      this.materials.push(vMaterial);

      if (hdMaterial) {
        this.hd = true;
      }
    }

    // OpenWar3: never flag the SHARED params. For a unit the map places, `solverParams` is
    // the map handler's own object, so one v1100 model (Test of Balance's pillar) switched
    // every later texture swap on the map — every placed tree's canopy — to .dds.
    if (this.hd) {
      solverParams.hd = true;

      // mdxHandler.loadEnv(viewer);
    }

    // Textures.
    const textures = parser.textures;
    for (let i = 0, l = textures.length; i < l; i++) {
      const texture = textures[i];
      let path = texture.path;
      const replaceableId = texture.replaceableId;
      const wrapMode = texture.wrapMode;

      if (path === '' && replaceableId !== 0) {
        path = `ReplaceableTextures\\${replaceableIds[replaceableId]}${texturesExt}`;

        if (replaceableId === 1 || replaceableId === 2) {
          hasTeamColors = true;
        }
      }

      const mdxTexture = new MdxTexture(replaceableId, wrapMode);

      // OpenWar3: Reforged's water planes tile their texture past [0,1] — the waterfall's
      // sheets run from v = -1 to 1 — but the MDX leaves the wrap mode at clamp, so every
      // sample outside the unit square smears the edge texel into a flat band. Reforged's
      // water shader samples with repeat; so does this. HD only: a classic waterfall and
      // the SD water frames keep the wrap mode the model authored (this.hd is the
      // material test above, so an SD model — on either install — is byte-for-byte
      // unchanged).
      if (this.hd && /[\\/]water[\\/]/i.test(path)) {
        mdxTexture.wrapS = 0x2901; // REPEAT
        mdxTexture.wrapT = 0x2901;
      }

      viewer.load(path, pathSolver, solverParams)
        .then((texture) => {
          if (texture) {
            mdxTexture.texture = <Texture>texture;
          }
        });

      this.textures[i] = mdxTexture;
    }

    // Geoset animations
    for (const geosetAnimation of parser.geosetAnimations) {
      this.geosetAnimations.push(new GeosetAnimation(this, geosetAnimation));
    }

    this.pivotPoints = parser.pivotPoints;

    // Tracks the IDs of all generic objects.
    let objectId = 0;

    // Bones
    for (const bone of parser.bones) {
      this.bones.push(new Bone(this, bone, objectId++));
    }

    // Lights
    for (const light of parser.lights) {
      this.lights.push(new Light(this, light, objectId++));
    }

    // Helpers
    for (const helper of parser.helpers) {
      this.helpers.push(new Helper(this, helper, objectId++));
    }

    // Attachments
    for (const attachment of parser.attachments) {
      this.attachments.push(new Attachment(this, attachment, objectId++));
    }

    // Particle emitters
    for (const particleEmitter of parser.particleEmitters) {
      this.particleEmitters.push(new ParticleEmitterObject(this, particleEmitter, objectId++));
    }

    // Particle emitters 2
    for (const particleEmitter2 of parser.particleEmitters2) {
      const emitter = new ParticleEmitter2Object(this, particleEmitter2, objectId++);

      this.particleEmitters2.push(emitter);

      if (emitter.teamColored) {
        hasTeamColors = true;
      }
    }

    // Ribbon emitters
    for (const ribbonEmitter of parser.ribbonEmitters) {
      this.ribbonEmitters.push(new RibbonEmitterObject(this, ribbonEmitter, objectId++));
    }

    // Cameras
    for (const camera of parser.cameras) {
      this.cameras.push(new Camera(this, camera));
    }

    // Event objects
    for (const eventObject of parser.eventObjects) {
      this.eventObjects.push(new EventObjectEmitterObject(this, eventObject, objectId++));
    }

    // Collision shapes
    for (const collisionShape of parser.collisionShapes) {
      this.collisionShapes.push(new CollisionShape(this, collisionShape, objectId++));
    }

    // One array for all generic objects.
    this.genericObjects.push(...this.bones, ...this.lights, ...this.helpers, ...this.attachments, ...this.particleEmitters, ...this.particleEmitters2, ...this.ribbonEmitters, ...this.eventObjects, ...this.collisionShapes);

    // Geosets
    setupGeosets(this, parser.geosets);

    // Render groups.
    setupGroups(this);

    // Creates the sorted indices array of the generic objects.
    this.setupHierarchy(-1);

    // Keep a sorted array.
    for (let i = 0, l = this.genericObjects.length; i < l; i++) {
      this.sortedGenericObjects[i] = this.genericObjects[this.hierarchy[i]];
    }

    // Lazy loading team colors.
    if (hasTeamColors) {
      mdxHandler.loadTeamTextures(viewer);
    }
  }

  addInstance(): MdxModelInstance {
    return new MdxModelInstance(this);
  }

  setupHierarchy(parent: number): void {
    for (let i = 0, l = this.genericObjects.length; i < l; i++) {
      const object = this.genericObjects[i];

      if (object.parentId === parent) {
        this.hierarchy.push(i);

        this.setupHierarchy(object.objectId);
      }
    }
  }
}
