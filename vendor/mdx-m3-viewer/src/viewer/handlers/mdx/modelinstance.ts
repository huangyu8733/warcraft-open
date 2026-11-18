import { vec3, quat, mat4 } from 'gl-matrix';
import ModelInstance from '../../modelinstance';
import { Node } from '../../node';
import { createSkeletalNodes, SkeletalNode } from '../../skeletalnode';
import DataTexture from '../../gl/datatexture';
import Texture from '../../texture';
import MdxNode from './node';
import AttachmentInstance from './attachmentinstance';
import ParticleEmitter from './particleemitter';
import ParticleEmitter2 from './particleemitter2';
import RibbonEmitter from './ribbonemitter';
import EventObjectEmitter from './eventobjectemitter';
import EventObjectEmitterObject from './eventobjectemitterobject';
import EventObjectSpnEmitter from './eventobjectspnemitter';
import EventObjectSplEmitter from './eventobjectsplemitter';
import EventObjectUbrEmitter from './eventobjectubremitter';
import EventObjectSndEmitter from './eventobjectsndemitter';
import MdxModel from './model';
import GenericObject from './genericobject';
import { EMITTER_PARTICLE2_TEXTURE_OFFSET, EMITTER_EVENT_TEXTURE_OFFSET } from './geometryemitterfuncs';
import Bounds from '../../bounds';

const visibilityHeap = new Float32Array(1);
/** OpenWar3: scratch for an event object's on/off value (ow3TickHidden). */
const ow3EventHeap = new Uint32Array(1);
const translationHeap = vec3.create();
const rotationHeap = quat.create();
const scaleHeap = vec3.create();
const colorHeap = new Float32Array(3);
const alphaHeap = new Float32Array(1);
const textureIdHeap = new Uint32Array(1);

type SkeletalNodeObject = AttachmentInstance | ParticleEmitter | ParticleEmitter2 | RibbonEmitter | EventObjectEmitter;

/**
 * OpenWar3: does an event object of this type put anything into the world when it fires? A
 * spawned model, a splat and an ubersplat do; a sound only where the viewer and the scene have
 * audio (EventObjectSnd.bind), which the game's world viewer does not — its sounds are played
 * off the same event data by src/audio. So an off-camera SND key needs no pose.
 */
function ow3EventProduces(type: string, instance: MdxModelInstance): boolean {
  if (type === 'SPN' || type === 'SPL' || type === 'UBR') {
    return true;
  }

  const scene = instance.scene;

  return type === 'SND' && instance.model.viewer.audioEnabled === true && scene !== null && scene.audioEnabled === true;
}

declare global {
  var __OW3_VIDEO__: {
    particleScale?: number;
    textureMipDrop?: number;
    sharedPoses?: boolean;
    poseBucket?: number;
    noOwnClockShare?: boolean;
    noBillboardShare?: boolean;
    hdLite?: boolean;
    /** OpenWar3 (P2-2): set false to draw static doodads the old way, one draw per instance. */
    instanceDoodads?: boolean;
  } | undefined;
}

/** A shared pose: every node's local TRS for one (model, sequence, bucket) — see ow3PoseFor. */
export interface Ow3Pose {
  trs: Float32Array;
  dirty: Uint8Array;
  frame: number;
  filled: boolean;
  bones: Float32Array | null;
  rot: Float32Array | null;
  scl: Float32Array | null;
  texture: DataTexture | null;
  skeleton: boolean;
}

/** The nodes a model has to redo for itself while its skeleton is shared — see ow3Billboards. */
export interface Ow3BillboardPlan {
  subtree: number[];
  parents: number[];
  inSubtree: Uint8Array;
}

// OpenWar3: scratch quat for the animation cross-fade slerp (see updateNodes).
const blendRotationHeap = quat.create();
// OpenWar3: what the cross-fade reads when there is no snapshot (blending is off then).
const EMPTY_SNAPSHOT = new Float32Array(1);
// OpenWar3: default animation cross-fade duration in ms. Real WC3's per-unit
// "Animation blend time" (UnitUI.slk `blend`) is 0.15s for the overwhelming
// majority of units; the app overrides this per instance via setBlendTime().
// Applies to any instance that never gets an override (effects, portraits, …).
const DEFAULT_BLEND_TIME = 150;
// ---------------------------------------------------------------------------------------
// OpenWar3 (issue #161): THE SHARED POSE CACHE — Low Performance Mode's animation path.
//
// Profiled on Echo Isles with 257 units at 6x CPU throttle, the frame's largest phase by far
// is `anim` (45 ms of 93), and inside it the MDX node walk is ~41% of all CPU:
// recalculateTransformation, updateNodes, and the gl-matrix calls they make. The DRAWING —
// `render` plus every GL call — is ~7%. So the expensive part of animating a model here is
// not the pixels and not the skinning (that is already on the GPU, via the bone texture):
// it is SAMPLING every node's animation tracks and composing its matrices, in JavaScript,
// for every instance, every frame.
//
// And most of that answer is the same answer. Probed in a real match, 317 visible instances
// were holding only 60 distinct (model, sequence, ~33 ms frame) poses — 34 Footmen in one
// bucket — because an RTS draws crowds of one unit doing one thing. This is the fog cache's
// lesson (src/sim/vision.ts SightStamps) in a second place: the pose is a fact about the
// MODEL and the CLOCK, not about the instance wearing it, so it is sampled once and replayed.
//
// WHAT IS SHARED IS THE LOCAL POSE, not the bone matrices. A bone matrix is WORLD space here
// (`worldMatrix = parent.worldMatrix * localMatrix`, and the root's parent is the instance),
// so two units standing in different places can never share one — the shareable part is the
// per-node local translation/rotation/scale the tracks are sampled INTO. Every instance still
// composes its own world matrices, which is also why billboarding, per-instance scale, the
// camera and everything downstream (emitters, attachments, click collision) are untouched:
// they all read the world matrices, and those are still each instance's own.
//
// THE COST IS QUANTIZED ANIMATION TIME. A shared pose is sampled at the BUCKET's time rather
// than at each instance's own frame, so clips step at 30 Hz. That is the trade this mode is
// for, and it is smaller than it sounds — MDX tracks are authored at about that rate — but it
// is why this is off unless Low Performance Mode is on.
//
// Entries OUTLIVE THE FRAME on purpose: a walk cycle loops, so after one lap every bucket of
// it is already sampled and a crowd of Footmen samples nothing at all.
const OW3_POSE_BUCKET = 1000 / 30; // ms of animation time per shared pose
/** How coarse the buckets are, in ms of animation time. The default is the rate an MDX's tracks
 *  are about authored at, which is why 30 Hz stepping is hard to see; `__OW3_VIDEO__.poseBucket`
 *  makes it a knob so a coarser one can be MEASURED (fewer buckets = fewer samples AND more
 *  instances per bucket) rather than guessed at. */
function ow3Bucket(): number {
  const v = globalThis.__OW3_VIDEO__;
  const ms = v === undefined ? 0 : v.poseBucket;
  return typeof ms === 'number' && ms > 0 ? ms : OW3_POSE_BUCKET;
}
const OW3_POSE_CAP = 3000; // entries, across all models, before the cache is dropped whole
let ow3PoseCount = 0;
/** Every model holding a pose cache, so the cap can empty all of them. */
const ow3PoseModels = new Set<MdxModel>();
/** Is Low Performance Mode asking for shared poses — and is this model drawn by a viewer that
 *  wants them? The first half is read off the same global the texture and particle settings
 *  travel on (src/render/videoQuality.ts `VideoBridge`). The second is the VIEWER's own opt-in
 *  (`viewer.ow3SharePoses`, set by the match's world viewer and by nothing else), because the
 *  global reaches every viewer on the page and only one of them has a crowd to share with. The
 *  main menu's backdrop, a portrait or the HUD's clock gains nothing from a pose cache and pays
 *  its whole cost: 30 Hz stepping on a model drawn at the monitor's rate, which on the menu read
 *  exactly like vsync being off (issue #161 review). */
function ow3SharePoses(model: MdxModel): boolean {
  const v = globalThis.__OW3_VIDEO__;
  return v !== undefined && v.sharedPoses === true && model.viewer !== undefined && model.viewer.ow3SharePoses === true;
}
/**
 * Does this node keep its OWN CLOCK — a translation, rotation or scale track driven by a GLOBAL
 * SEQUENCE, which is sampled against the instance's `counter` (total elapsed ms) rather than the
 * sequence frame? Two instances alive for different lengths of time genuinely hold different
 * values there, and no key on (sequence, frame) can say so.
 */
function ow3OwnClock(object: GenericObject): boolean {
  for (const name of ['KGTR', 'KGRT', 'KGSC']) {
    const animation = object.animations.get(name);

    if (animation && animation.globalSequence) {
      return true;
    }
  }

  return false;
}
function ow3DontInherit(object: GenericObject): boolean {
  return !!(object.dontInheritTranslation || object.dontInheritRotation || object.dontInheritScaling);
}
/**
 * May this model's pose be shared at all?
 *
 * A node with its OWN CLOCK (`ow3OwnClock`) holds a value no shared pose can hold for everybody.
 * It used to shut the whole model out, and that was expensive out of all proportion: the
 * Knight's 214 nodes walked per instance, every frame, for three leaf attachment points
 * (`Origin Ref`, `OverHead Ref`, `Chest Ref`) with a global-sequence scale track — 80% of every
 * skeleton node composed in a 287-unit scene. Those nodes are now REDONE PER INSTANCE, exactly as
 * billboarded ones are (`ow3Billboards` puts them and everything under them in the plan, and
 * `ow3FixBillboards` samples them on the instance's own clock) — but that only happens on the
 * SHARED-SKELETON path. A model that cannot share its skeleton (`dontInherit*`) replays the pose's
 * locals as they are, so for one of those an own-clock node still says no.
 */
function ow3Shareable(model: MdxModel): boolean {
  if (model.ow3OwnClock === undefined) {
    let ownClock = false;
    let dontInherit = false;

    for (const object of model.sortedGenericObjects) {
      ownClock = ownClock || ow3OwnClock(object);
      dontInherit = dontInherit || ow3DontInherit(object);
    }

    model.ow3OwnClock = ownClock;
    model.ow3DontInherit = dontInherit;
  }

  if (!model.ow3OwnClock) {
    return true;
  }

  // `__OW3_VIDEO__.noOwnClockShare` shuts the own-clock models out again, as they were, so what
  // redoing those nodes per instance is WORTH can be measured in a real match (the
  // `noBillboardShare` idea). Read live, not cached.
  const v = globalThis.__OW3_VIDEO__;

  return !model.ow3DontInherit && !(v !== undefined && v.noOwnClockShare);
}
/**
 * May this model's composed SKELETON be shared, not just the pose it is composed from?
 *
 * Two node kinds say no, and both are nodes whose matrix is not a function of the clip alone:
 *
 *   · **dontInheritTranslation / Rotation / Scaling** nodes reach past their parent to the
 *     INSTANCE's world scale and the parent's inverse world values, which in instance space are
 *     not what they are in the world. Six models of the sixty-nine sampled have them.
 *
 * BILLBOARDED nodes are the other kind that is not a function of the clip — they face the CAMERA
 * through the instance's own inverse world rotation — but they are far too common to step around
 * (a Footman has six, a grunt two, a Demon Hunter fifty-five: 21 of 69 unit models), and shutting
 * them out left the bread-and-butter soldiers on the slow path. They are REDONE PER INSTANCE
 * instead — see `ow3FixBillboards` — which costs the handful of nodes in those subtrees and a
 * bone texture of this instance's own, and still skips the whole sampling-and-composing walk.
 */
// OpenWar3 (P2-2): stable numeric ids for texture OBJECTS, so a bucket key can say "every
// instance here resolves this slot to the very same texture" without a hash of pixels.
const ow3TextureIds = new WeakMap<Texture, number>();
let ow3TextureIdNext = 1;

function ow3TextureId(texture: Texture): number {
  let id = ow3TextureIds.get(texture);

  if (id === undefined) {
    id = ow3TextureIdNext++;
    ow3TextureIds.set(texture, id);
  }

  return id;
}

/**
 * OpenWar3 (P2-2): does this sequence leave every node where the file put it?
 *
 * Trees, rocks and most decoration have a Stand sequence with no translation/rotation/scale
 * tracks at all, so all instances of the model hold the same pose and only their world matrix
 * differs. Cached per model: the answer is a property of the MDX data.
 */
function ow3StaticSequence(model: MdxModel, sequence: number): boolean {
  let cache = model.ow3StaticSequences;

  if (cache === undefined) {
    cache = model.ow3StaticSequences = new Map();
  }

  let isStatic = cache.get(sequence);

  if (isStatic === undefined) {
    isStatic = true;

    for (const object of model.sortedGenericObjects) {
      const variants = object.variants;

      if (variants['translation'][sequence] || variants['rotation'][sequence] || variants['scale'][sequence]) {
        isStatic = false;
        break;
      }
    }

    cache.set(sequence, isStatic);
  }

  return isStatic;
}

/**
 * OpenWar3 (P2-2): may this instance join a shared-skeleton doodad bucket?
 *
 * What has to differ between instances — a parent, a fade, a billboarded or dontInherit node,
 * an animated layer/geoset — says no here and keeps the ordinary per-instance path. An animated
 * Stand clip is FINE: its pose is shared per time bucket (ow3DoodadPoseFor), which is the same
 * ~33 ms stepping Low Performance Mode already uses. WebGL 2 is required for the instanced draw.
 */
function ow3StaticDoodadShare(instance: MdxModelInstance, sequence: number): boolean {
  const model = <MdxModel>instance.model;
  const v = globalThis.__OW3_VIDEO__;

  if (instance.ow3StaticDoodad !== true) {
    return false;
  }

  if (v !== undefined && v.instanceDoodads === false) {
    return false;
  }

  if (instance.parent !== null) {
    return false;
  }

  if (!model.viewer.webgl.isWebGL2 || !model.hd || model.bones.length === 0) {
    return false;
  }

  if (model.hasLayerAnims || model.hasGeosetAnims) {
    return false;
  }

  if (!ow3SkeletonShareable(model) || ow3Billboards(model) !== null) {
    return false;
  }

  return true;
}

function ow3SkeletonShareable(model: MdxModel): boolean {
  // `__OW3_VIDEO__.noBillboardShare` shuts the billboarded models out again, so what handling
  // them per instance is WORTH can be measured in a real match rather than argued — the same
  // reason `TerrainCull.enabled` and `SightStamps.enabled` exist. Read live, not cached.
  if (globalThis.__OW3_VIDEO__ && globalThis.__OW3_VIDEO__.noBillboardShare && ow3Billboards(model)) {
    return false;
  }

  if (model.ow3SkeletonShareable === undefined) {
    let ok = ow3Shareable(model);

    for (const object of model.sortedGenericObjects) {
      if (ow3DontInherit(object)) {
        ok = false;
      }
    }

    model.ow3SkeletonShareable = ok;
  }

  return model.ow3SkeletonShareable;
}
/**
 * Which nodes a model has to redo for itself: every BILLBOARDED node, every node with its OWN
 * CLOCK (`ow3OwnClock` — a global-sequence track), AND everything hanging under either, because
 * a child's matrix is composed off its parent's.
 *
 * All three lists are in NODE order (`instance.nodes`, which is what the skeleton is laid out
 * in); `subtree` is additionally ordered parents-first, so composing down it never reads a matrix
 * that has not been written yet. `parents` are the nodes just ABOVE the subtree roots: they are
 * not redone, but they have to hold TRUE world values for the moment the roots are composed, and
 * are put back afterwards.
 */
function ow3Billboards(model: MdxModel): Ow3BillboardPlan | null {
  if (model.ow3Billboards === undefined) {
    const generic = model.genericObjects;
    const count = generic.length;
    const inSubtree = new Uint8Array(count);
    const subtree: number[] = [];
    const parents: number[] = [];

    // Hierarchy order, so a node is decided after its parent is.
    for (const index of model.hierarchy) {
      const object = generic[index];
      const parentId = object.parentId;
      const inherited = parentId >= 0 && inSubtree[parentId] === 1;

      if (object.anyBillboarding || ow3OwnClock(object) || inherited) {
        inSubtree[index] = 1;
        subtree.push(index);

        if (!inherited && parentId >= 0 && parents.indexOf(parentId) < 0) {
          parents.push(parentId);
        }
      }
    }

    model.ow3Billboards = subtree.length > 0 ? { subtree, parents, inSubtree } : null;
  }

  return model.ow3Billboards;
}
/** The nodes of this instance carrying an emitter, an event object or an attachment — the only
 *  ones that still need TRUE world matrices while the skeleton is shared, because what they do
 *  happens in the world (a particle is spawned there, a sound is played there, an attached model
 *  is parented there). Everything else in the model exists only to be drawn. */
function ow3ObjectNodes(instance: MdxModelInstance): number[] {
  let list = instance.ow3ObjectNodes;

  if (list === undefined) {
    list = instance.ow3ObjectNodes = [];
  }

  // Rebuilt every frame rather than cached: OpenWar3 PARENTS a buff or spell model onto a
  // unit's bone at runtime (render/mapViewer.ts `inst.setParent(node)`), so a node grows
  // children long after the instance was built, and a cached list would leave that model
  // hanging at the world origin. Two property reads a node, against the matrix work it saves.
  //
  // The indices are NODE order — `instance.nodes`, which is what `worldMatrices` and so the
  // cached skeleton are laid out in — and NOT the hierarchy order `sortedNodes` walks in
  // (`sortedNodes[i] = nodes[hierarchy[i]]`). Mixing the two hands a node somebody else's
  // matrix on every model whose file does not happen to list its objects parents-first.
  list.length = 0;

  const nodes = instance.nodes;

  for (let i = 0, l = nodes.length; i < l; i++) {
    const node = nodes[i];

    if (node.object || node.children.length > 0) {
      list.push(i);
    }
  }

  return list;
}
/**
 * The shared pose for (model, sequence, bucket), minted empty on the first ask.
 *
 * `trs` is ten floats a node — translation, rotation, scale — in the model's own sorted node
 * order; `dirty` is whether that node's tracks said anything for this sequence, which is the
 * half of `wasDirty` that belongs to the POSE (the rest — a dirty parent, billboarding — is
 * the instance's own and is ORed in by the caller).
 */
function ow3PoseFor(model: MdxModel, sequence: number, frame: number, staticPose = false): Ow3Pose {
  let cache = model.ow3PoseCache;

  if (cache === undefined) {
    cache = model.ow3PoseCache = new Map();
    ow3PoseModels.add(model);
  }

  const span = ow3Bucket();
  // OpenWar3 (P2-2): a static doodad's pose never changes, so it is keyed by the sequence alone
  // — otherwise every 33 ms bucket would mint another identical pose AND another bone texture.
  const bucket = staticPose ? 0 : Math.round(frame / span);
  const key = sequence * 1000000 + bucket;
  let pose = cache.get(key);

  if (pose === undefined) {
    if (ow3PoseCount >= OW3_POSE_CAP) {
      ow3ClearPoses(model);
      cache = <Map<number, Ow3Pose>>model.ow3PoseCache;
    }

    const nodes = model.sortedGenericObjects.length;

    // `bones`/`rot`/`scl` are the COMPOSED skeleton in instance space — the second half of
    // this cache (issue #161). `bones` is what the bone texture is filled from and what the
    // shader multiplies the instance's own matrix into; `rot` and `scl` are only read for the
    // handful of nodes carrying an emitter or an attachment, which need true world values.
    pose = {
      trs: new Float32Array(nodes * 10), dirty: new Uint8Array(nodes),
      frame: bucket * span, filled: false,
      bones: null, rot: null, scl: null, texture: null, skeleton: false,
    };

    cache.set(key, pose);
    ow3PoseCount++;
  }

  return pose;
}
/**
 * OpenWar3 (P2-2): the pose for an animated static doodad, refreshed IN PLACE as the time
 * bucket rolls over.
 *
 * `ow3PoseFor` keys a pose by (sequence, bucket), which is right for units in Low Performance
 * Mode but wrong for thousands of doodads: a 30 Hz clip would mint a new pose and a new bone
 * texture every bucket, and the global cap would eventually drop them all. Doodads of one model
 * are created together and their Stand clips advance in lockstep, so ONE pose per sequence is
 * enough: when the bucket changes the existing pose is marked unfilled and the next instance
 * re-samples it into the same bones/texture. Instances in another bucket simply compose for
 * themselves that frame (and are grouped apart by `ow3InstKey`).
 */
function ow3DoodadPoseFor(model: MdxModel, sequence: number, frame: number, staticPose: boolean): Ow3Pose {
  if (staticPose) {
    // The clip has no tracks at all: one pose for the whole match.
    return ow3PoseFor(model, sequence, frame, true);
  }

  const span = ow3Bucket();
  const bucket = Math.round(frame / span);
  let live = model.ow3DoodadPoses;

  if (live === undefined) {
    live = model.ow3DoodadPoses = new Map();
  }

  let entry = live.get(sequence);

  if (entry === undefined) {
    const nodes = model.sortedGenericObjects.length;
    const pose: Ow3Pose = {
      trs: new Float32Array(nodes * 10), dirty: new Uint8Array(nodes),
      frame: bucket * span, filled: false,
      bones: null, rot: null, scl: null, texture: null, skeleton: false,
    };

    entry = { pose, bucket };
    live.set(sequence, entry);
  } else if (bucket > entry.bucket) {
    // Never roll BACKWARDS: an instance a few milliseconds behind the rest sharing the newer
    // pose costs one bucket of animation, while rolling back would make the whole model
    // re-compose every frame as the two groups fight over which bucket is current.
    entry.bucket = bucket;
    entry.pose.frame = bucket * span;
    entry.pose.filled = false;
    entry.pose.skeleton = false;
  }

  return entry.pose;
}

/** Drop every cached pose. Called when the cache has grown past its cap — the models whose
 *  poses are being asked for right now re-fill within a lap of their clips. */
function ow3ClearPoses(current: MdxModel): void {
  for (const model of ow3PoseModels) {
    model.ow3PoseCache = new Map();
  }

  ow3PoseModels.clear();
  ow3PoseCount = 0;

  if (current) {
    current.ow3PoseCache = new Map();
    ow3PoseModels.add(current);
  }
}
/** OpenWar3 (issue #161): stand-in for a node's child list while the pose is in instance space. */
const EMPTY_CHILDREN: Node[] = [];
const ow3Mat = mat4.create();
/**
 * Keep the skeleton this instance just composed, as the bucket's.
 *
 * `worldMatrices` is instance-local here (skeletalnode.ts hangs the root off an identity), so
 * what is copied out is a pose and not a position — which is exactly what makes it shareable.
 * The bone texture is filled once, here, instead of once per instance per frame.
 */
function ow3CaptureSkeleton(instance: MdxModelInstance, pose: Ow3Pose): void {
  const model = <MdxModel>instance.model;
  const nodes = model.sortedGenericObjects.length;

  if (pose.bones === null) {
    pose.bones = new Float32Array(nodes * 16);
    pose.rot = new Float32Array(nodes * 4);
    pose.scl = new Float32Array(nodes * 3);
  }

  pose.bones.set(<Float32Array>instance.worldMatrices);

  const rot = <Float32Array>pose.rot;
  const scl = <Float32Array>pose.scl;
  const instNodes = instance.nodes; // node order, like `worldMatrices` — see ow3ObjectNodes

  for (let i = 0; i < nodes; i++) {
    const node = instNodes[i];
    const r = i * 4;
    const c = i * 3;

    rot[r] = node.worldRotation[0];
    rot[r + 1] = node.worldRotation[1];
    rot[r + 2] = node.worldRotation[2];
    rot[r + 3] = node.worldRotation[3];
    scl[c] = node.worldScale[0];
    scl[c + 1] = node.worldScale[1];
    scl[c + 2] = node.worldScale[2];
  }

  // A model with billboarded subtrees sends a texture of each instance's own (ow3FixBillboards),
  // so the bucket's would be filled for nobody — one upload per bucket that nothing ever binds.
  if (ow3Billboards(model) === null) {
    if (pose.texture === null && instance.boneTexture) {
      pose.texture = new DataTexture(model.viewer.gl, 4, model.bones.length * 4, 1);
    }

    if (pose.texture) {
      pose.texture.bindAndUpdate(pose.bones);
    }
  }

  pose.skeleton = true;
}
/**
 * Give the nodes that act on the WORLD their true matrices back.
 *
 * A shared skeleton is a pose, and a pose has no position — but a particle is spawned somewhere,
 * a footstep is heard somewhere and an attached model hangs somewhere, so those nodes (and only
 * those) get `instance.worldMatrix * local` composed into them. A Footman has two or three of
 * them against sixteen bones, which is why this is still most of the saving.
 */
function ow3ComposeObjectNodes(instance: MdxModelInstance, pose: Ow3Pose, dt: number, sequence: number, frame: number, counter: number, plan: Ow3BillboardPlan | null): void {
  const indices = ow3ObjectNodes(instance);

  if (indices.length === 0) {
    return;
  }

  const nodes = instance.nodes;
  const genericObjects = (<MdxModel>instance.model).genericObjects; // node order, beside `nodes`
  // With billboarded subtrees redone, this instance's own array is the truth and the bucket's
  // is not — and those nodes' rotation and scale are already TRUE world, so they are left as
  // `recalculateTransformation` wrote them rather than re-derived from the shared pose.
  const inSubtree = plan === null || plan === undefined ? null : plan.inSubtree;
  const bones = <Float32Array>(inSubtree === null ? pose.bones : instance.ow3LocalBones);
  const rot = <Float32Array>pose.rot;
  const scl = <Float32Array>pose.scl;
  const iw = instance.worldMatrix;
  const ir = instance.worldRotation;
  const is = instance.worldScale;
  const written = ow3WorldWritten(instance);

  for (let k = 0; k < indices.length; k++) {
    const i = indices[k];

    written[i] = 1; // this node's matrix is about to stop being a pose — see `cleanObjects`
    const node = nodes[i];
    const local = bones.subarray(i * 16, i * 16 + 16);

    mat4.multiply(ow3Scratch, iw, local);
    (<Float32Array>node.worldMatrix).set(ow3Scratch); // via scratch: `local` may BE this node's own slice

    const r = i * 4;

    ow3Quat[0] = <number>rot[r];
    ow3Quat[1] = <number>rot[r + 1];
    ow3Quat[2] = <number>rot[r + 2];
    ow3Quat[3] = <number>rot[r + 3];
    const c = i * 3;

    if (inSubtree === null || inSubtree[i] === 0) {
      quat.mul(node.worldRotation, ir, ow3Quat);
      node.worldScale[0] = is[0] * <number>scl[c];
      node.worldScale[1] = is[1] * <number>scl[c + 1];
      node.worldScale[2] = is[2] * <number>scl[c + 2];
    }

    const m = node.worldMatrix;
    const pivot = node.pivot;
    const x = pivot[0];
    const y = pivot[1];
    const z = pivot[2];

    node.worldLocation[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    node.worldLocation[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    node.worldLocation[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    node.inverseWorldLocation[0] = -node.worldLocation[0];
    node.inverseWorldLocation[1] = -node.worldLocation[1];
    node.inverseWorldLocation[2] = -node.worldLocation[2];
    node.inverseWorldRotation[0] = -node.worldRotation[0];
    node.inverseWorldRotation[1] = -node.worldRotation[1];
    node.inverseWorldRotation[2] = -node.worldRotation[2];
    node.inverseWorldRotation[3] = node.worldRotation[3];
    node.inverseWorldScale[0] = 1 / node.worldScale[0];
    node.inverseWorldScale[1] = 1 / node.worldScale[1];
    node.inverseWorldScale[2] = 1 / node.worldScale[2];

    if (node.object) {
      genericObjects[i].getVisibility(visibilityHeap, sequence, frame, counter);

      if (visibilityHeap[0] > 0) {
        (<SkeletalNodeObject>node.object).update(dt);
      }
    }

    for (const child of node.children) {
      child.recalculateTransformation();
      child.update(dt);
    }
  }
}
const ow3Quat = quat.create();
const ow3Inverse = mat4.create();
const ow3Scratch = mat4.create();
/**
 * Redo this body's billboarded subtrees, which no crowd can share.
 *
 * A billboarded node faces the CAMERA, and it gets there through its parent's inverse world
 * rotation — so at one frame of one clip, two instances facing different ways hold genuinely
 * different matrices, and a shared skeleton has the wrong one in it (tried, and photographed: a
 * white halo around every Footman's shield, the quads turning with the body instead of facing the
 * camera). What is still shared is everything else — the sampling and the composing of every
 * other bone, which is nearly all of both.
 *
 * So this instance takes the bucket's skeleton as its own, then composes the billboarded subtrees
 * for itself in TRUE WORLD space (the space the billboard maths is defined in) and converts just
 * those back into instance space, where the rest of the skeleton already is and where
 * `u_instance` expects to find it. It pays for a bone texture of its own; a Footman redoes six
 * nodes of fifty-seven and samples none.
 */
function ow3FixBillboards(instance: MdxModelInstance, pose: Ow3Pose, plan: Ow3BillboardPlan, sequence: number, frame: number, counter: number): void {
  const nodes = instance.nodes;
  const genericObjects = (<MdxModel>instance.model).genericObjects; // node order, beside `nodes`
  const bones = <Float32Array>pose.bones;
  const iw = instance.worldMatrix;
  const ir = instance.worldRotation;
  const is = instance.worldScale;

  // A second array of this instance's own, because the two things cannot share one: the TEXTURE
  // wants the skeleton in instance space, while `node.worldMatrix` — which is a window onto
  // `worldMatrices` — is where an emitter reads its position in the WORLD. Composing the object
  // nodes into the same memory the texture is sent from would draw the model inside out.
  let local = instance.ow3LocalBones;

  if (!local || local.length !== bones.length) {
    local = instance.ow3LocalBones = new Float32Array(bones.length);
  }

  local.set(bones);

  // The nodes just above the subtrees have to read as world for the moment their children are
  // composed off them.
  //
  // Every node this writes a WORLD matrix into is marked in `ow3WorldWritten`, the same as an
  // object node, and for the same reason: `node.worldMatrix` is a window onto this instance's
  // `worldMatrices`, and when this instance next COMPOSES a bucket its walk only recomputes the
  // nodes that are dirty. A static node above a subtree (the Town Hall's `Upgrade0 Townhall`,
  // the Priest's `Staff-hide`) is not, so without the mark its world matrix was captured into
  // the shared skeleton and every instance wearing it drew that part of itself thousands of
  // units off — found by comparing the two paths' matrices, as the object-node case was.
  const written = ow3WorldWritten(instance);

  for (let k = 0; k < plan.parents.length; k++) {
    written[plan.parents[k]] = 1;
    ow3WorldFromPose(nodes[plan.parents[k]], plan.parents[k], pose, iw, ir, is);
  }

  // The subtree nodes' LOCAL values are this instance's to sample, at the bucket's frame and on
  // this instance's own clock: an instance wearing somebody else's skeleton walked no nodes this
  // frame, so without this they would still hold whatever it last sampled for itself — and an
  // own-clock node's value was never the bucket's to begin with. Every channel, as a forced
  // pass samples them, since which ones the clip animates is exactly what may not be assumed.
  for (let k = 0; k < plan.subtree.length; k++) {
    const i = plan.subtree[k];
    const node = nodes[i];
    const object = genericObjects[i];

    object.getTranslation(node.localLocation, sequence, frame, counter);
    object.getRotation(node.localRotation, sequence, frame, counter);
    object.getScale(node.localScale, sequence, frame, counter);
  }

  // …then the subtrees, by the engine's own routine, in world space.
  instance.ow3LocalPose = false;

  for (let k = 0; k < plan.subtree.length; k++) {
    written[plan.subtree[k]] = 1;
    nodes[plan.subtree[k]].recalculateTransformation(instance);
  }

  instance.ow3LocalPose = true;

  // …and back into instance space, which is where the rest of this instance's skeleton is and
  // where `u_instance` expects to find all of it.
  mat4.invert(ow3Inverse, iw);

  for (let k = 0; k < plan.subtree.length; k++) {
    const i = plan.subtree[k];

    mat4.multiply(ow3Scratch, ow3Inverse, nodes[i].worldMatrix);
    local.set(ow3Scratch, i * 16);
  }

  // The borrowed parents go back to the rotation and scale they hold for everybody else; their
  // matrices are the pose's again on the next frame's copy, and nothing reads them before it.
  for (let k = 0; k < plan.parents.length; k++) {
    ow3PoseRotScale(nodes[plan.parents[k]], plan.parents[k], pose);
  }
}
/** Write TRUE world values onto a node from the shared pose — the product `u_instance` forms. */
function ow3WorldFromPose(node: SkeletalNode, i: number, pose: Ow3Pose, iw: mat4, ir: quat, is: vec3): void {
  const rot = <Float32Array>pose.rot;
  const scl = <Float32Array>pose.scl;

  mat4.multiply(node.worldMatrix, iw, <Float32Array>(<Float32Array>pose.bones).subarray(i * 16, i * 16 + 16));

  const r = i * 4;

  ow3Quat[0] = <number>rot[r];
  ow3Quat[1] = <number>rot[r + 1];
  ow3Quat[2] = <number>rot[r + 2];
  ow3Quat[3] = <number>rot[r + 3];
  quat.mul(node.worldRotation, ir, ow3Quat);

  const c = i * 3;

  node.worldScale[0] = is[0] * <number>scl[c];
  node.worldScale[1] = is[1] * <number>scl[c + 1];
  node.worldScale[2] = is[2] * <number>scl[c + 2];

  const m = node.worldMatrix;
  const pivot = node.pivot;
  const x = pivot[0];
  const y = pivot[1];
  const z = pivot[2];

  node.worldLocation[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  node.worldLocation[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  node.worldLocation[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  node.inverseWorldLocation[0] = -node.worldLocation[0];
  node.inverseWorldLocation[1] = -node.worldLocation[1];
  node.inverseWorldLocation[2] = -node.worldLocation[2];
  node.inverseWorldRotation[0] = -node.worldRotation[0];
  node.inverseWorldRotation[1] = -node.worldRotation[1];
  node.inverseWorldRotation[2] = -node.worldRotation[2];
  node.inverseWorldRotation[3] = node.worldRotation[3];
  node.inverseWorldScale[0] = 1 / node.worldScale[0];
  node.inverseWorldScale[1] = 1 / node.worldScale[1];
  node.inverseWorldScale[2] = 1 / node.worldScale[2];
}
/** Which of this instance's nodes have ever had a WORLD matrix composed into them — the set the
 *  composer of a bucket has to redo before its matrices become everybody's. Grown once. */
function ow3WorldWritten(instance: MdxModelInstance): Uint8Array {
  let flags = instance.ow3WorldWritten;

  if (flags === undefined || flags.length < instance.nodes.length) {
    flags = instance.ow3WorldWritten = new Uint8Array(instance.nodes.length);
  }

  return flags;
}
/** Put a node's rotation and scale back to the bucket's (instance-space) pose. */
function ow3PoseRotScale(node: SkeletalNode, i: number, pose: Ow3Pose): void {
  const rot = <Float32Array>pose.rot;
  const scl = <Float32Array>pose.scl;
  const r = i * 4;

  node.worldRotation[0] = <number>rot[r];
  node.worldRotation[1] = <number>rot[r + 1];
  node.worldRotation[2] = <number>rot[r + 2];
  node.worldRotation[3] = <number>rot[r + 3];

  const c = i * 3;

  node.worldScale[0] = <number>scl[c];
  node.worldScale[1] = <number>scl[c + 1];
  node.worldScale[2] = <number>scl[c + 2];
}

/**
 * An MDX model instance.
 */
export default class MdxModelInstance extends ModelInstance {
  attachments: AttachmentInstance[] = [];
  particleEmitters: ParticleEmitter[] = [];
  particleEmitters2: ParticleEmitter2[] = [];
  ribbonEmitters: RibbonEmitter[] = [];
  eventObjectEmitters: (EventObjectSpnEmitter | EventObjectSplEmitter | EventObjectUbrEmitter | EventObjectSndEmitter)[] = [];
  nodes: SkeletalNode[] = [];
  sortedNodes: SkeletalNode[] = [];
  frame = 0;
  // Global sequences
  counter = 0;
  sequence = -1;
  sequenceLoopMode = 0;
  sequenceEnded = false;
  teamColor = 0;
  vertexColor = new Float32Array([1, 1, 1, 1]);
  // Particles do not spawn when the sequence is -1, or when the sequence finished and it's not repeating
  allowParticleSpawn = false;
  // If forced is true, everything will update regardless of variancy.
  // Any later non-forced update can then use variancy to skip updating things.
  // It is set to true every time the sequence is set with setSequence().
  forced = true;
  // OpenWar3 (issue #161): `forced` means two different things, and the shared pose cache
  // has to tell them apart. A SEQUENCE CHANGE has to rewrite every node's local pose,
  // including the nodes the new clip says nothing about (they must fall back to its
  // defaults rather than keep the last clip's). A MOVE — `recalculateTransformation` on the
  // instance, which the sim does to every walking unit every frame — forces `updateNodes`
  // for a reason that has nothing to do with the tracks: the node WORLD matrices hang off
  // the instance's, so they all have to be recomposed, while the local pose is untouched.
  // Only the first kind may not share. This flag is the first kind.
  ow3PoseReset = true;
  // OpenWar3: animation cross-fade state. On setSequence() we snapshot the
  // current per-node local TRS into blendSnapshot, then over blendTime ms
  // blend from that snapshot toward the new sequence's pose (WC3 plays
  // sequences as hard cuts otherwise). blendRemaining counts down; 0 = idle.
  blendTime = DEFAULT_BLEND_TIME; // duration (ms), overridable per instance
  blendRemaining = 0; // ms left in the active cross-fade (0 = not blending)
  blendSnapshot: Float32Array | null = null; // Float32Array(nodeCount*10): [loc3, rot4, scale3] per node
  // OpenWar3: there is now a drawn pose to cross-fade FROM (set at the end of updateNodes).
  ow3Posed = false;
  // OpenWar3: the viewer frame this instance was last UPDATED on, which is to say drawn on —
  // the viewer only animates what is inside the camera frustum. -2, so the first update is
  // never mistaken for "seen on the last frame" (see ow3OnScreen).
  ow3SeenFrame = -2;
  // OpenWar3: the event emitters an off-camera frame has to ask (ow3TickHidden), and how
  // many emitters the list was made from.
  ow3Producers: EventObjectEmitter[] | null = null;
  ow3ProducersOf = -1;
  geosetColors: Float32Array[] = [];
  layerAlphas: number[] = [];
  layerTextures: number[] = [];
  uvAnims: Float32Array[] = [];
  worldMatrices: Float32Array | null = null;
  boneTexture: DataTexture | null = null;

  // OpenWar3 (issue #161), Low Performance Mode: an instance may share one skeleton texture
  // with a whole bucket of its own kind. In that mode the composed matrices are the
  // INSTANCE's space (a shared pose can carry no position), `u_instance` puts them in the
  // world, and `ow3SharedTexture` replaces the instance's own bone texture in batchgroup.ts.
  ow3SharedTexture: DataTexture | null = null;
  ow3SharedBones: Float32Array | null = null;
  ow3LocalBones?: Float32Array;
  ow3WorldWritten?: Uint8Array;
  ow3ObjectNodes?: number[];
  // OpenWar3 (issue #161): the shared pose this instance WORE on its last update, or null.
  ow3WornPose: Ow3Pose | null = null;
  ow3LocalPose = false;
  // OpenWar3 (P2-2): set by the w3x handlers for a placed doodad — the only instances that may
  // be drawn in an instanced bucket across the scene (see ow3InstancedStatic below).
  ow3StaticDoodad = false;
  // OpenWar3: has anything moved since the bone texture was last uploaded? `updateNodes`
  // already decides this per node -- `wasDirty` is what tells it whether to recompute a
  // node's world matrix at all -- so the answer costs nothing to collect, and the world
  // matrices CANNOT have changed unless at least one node was dirty, because
  // `recalculateTransformation` is the only thing that writes them. See updateBoneTexture.
  ow3BonesDirty = true;
  ow3BonesUploaded = false;

  constructor(model: MdxModel) {
    super(model);

    for (let i = 0, l = model.geosets.length; i < l; i++) {
      this.geosetColors[i] = new Float32Array(4);
    }

    for (let i = 0, l = model.layers.length; i < l; i++) {
      this.layerAlphas[i] = 0;
      this.layerTextures[i] = 0;
      this.uvAnims[i] = new Float32Array(5);
    }

    // Create the needed amount of shared nodes.
    const sharedNodeData = createSkeletalNodes(model.genericObjects.length, MdxNode);
    const nodes = sharedNodeData.nodes;
    let nodeIndex = 0;

    this.nodes.push(...nodes);

    // A shared typed array for all world matrices of the internal nodes.
    this.worldMatrices = sharedNodeData.worldMatrices;

    // And now initialize all of the nodes and objects
    for (const bone of model.bones) {
      this.initNode(nodes, nodes[nodeIndex++], bone);
    }

    for (const light of model.lights) {
      this.initNode(nodes, nodes[nodeIndex++], light);
    }

    for (const helper of model.helpers) {
      this.initNode(nodes, nodes[nodeIndex++], helper);
    }

    for (const attachment of model.attachments) {
      let attachmentInstance;

      // Attachments may have game models attached to them, such as Undead and Nightelf building animations.
      if (attachment.internalModel) {
        attachmentInstance = new AttachmentInstance(this, attachment);

        this.attachments.push(attachmentInstance);
      }

      this.initNode(nodes, nodes[nodeIndex++], attachment, attachmentInstance);
    }

    for (const emitterObject of model.particleEmitters) {
      const emitter = new ParticleEmitter(this, emitterObject);

      this.particleEmitters.push(emitter);

      this.initNode(nodes, nodes[nodeIndex++], emitterObject, emitter);
    }

    for (const emitterObject of model.particleEmitters2) {
      const emitter = new ParticleEmitter2(this, emitterObject);

      this.particleEmitters2.push(emitter);

      this.initNode(nodes, nodes[nodeIndex++], emitterObject, emitter);
    }

    for (const emitterObject of model.ribbonEmitters) {
      const emitter = new RibbonEmitter(this, emitterObject);

      this.ribbonEmitters.push(emitter);

      this.initNode(nodes, nodes[nodeIndex++], emitterObject, emitter);
    }

    for (const emitterObject of model.eventObjects) {
      const type = emitterObject.type;
      let emitter;

      if (type === 'SPN') {
        emitter = new EventObjectSpnEmitter(this, emitterObject);
      } else if (type === 'SPL') {
        emitter = new EventObjectSplEmitter(this, emitterObject);
      } else if (type === 'UBR') {
        emitter = new EventObjectUbrEmitter(this, emitterObject);
      } else {
        emitter = new EventObjectSndEmitter(this, emitterObject);
      }

      this.eventObjectEmitters.push(emitter);

      this.initNode(nodes, nodes[nodeIndex++], emitterObject, emitter);
    }

    for (const collisionShape of model.collisionShapes) {
      this.initNode(nodes, nodes[nodeIndex++], collisionShape);
    }

    // Save a sorted array of all of the nodes, such that every child node comes after its parent.
    // This allows for flat iteration when updating.
    const hierarchy = model.hierarchy;

    for (let i = 0, l = nodes.length; i < l; i++) {
      this.sortedNodes[i] = nodes[hierarchy[i]];
    }

    if (model.bones.length) {
      this.boneTexture = new DataTexture(model.viewer.gl, 4, model.bones.length * 4, 1);
    }
  }


  /**
   * Override the texture at the given index.
   * 
   * If a texture isn't given, removes the override if there was one.
   */
  setTexture(index: number, texture?: Texture): void {
    this.overrideTexture(index, texture);
  }

  /**
   * Override the texture of the particle emitter the given index.
   * 
   * If a texture isn't given, removes the override if there was one.
   */
  setParticle2Texture(index: number, texture?: Texture): void {
    this.overrideTexture(EMITTER_PARTICLE2_TEXTURE_OFFSET + index, texture);
  }

  /**
   * Override the texture of the event emitter the given index.
   * 
   * If a texture isn't given, removes the override if there was one.
   */
  setEventTexture(index: number, texture?: Texture): void {
    this.overrideTexture(EMITTER_EVENT_TEXTURE_OFFSET + index, texture);
  }

  /**
   * Clear all of the emitted objects that belong to this instance.
   */
  override clearEmittedObjects(): void {
    for (const emitter of this.particleEmitters) {
      emitter.clear();
    }

    for (const emitter of this.particleEmitters2) {
      emitter.clear();
    }

    for (const emitter of this.ribbonEmitters) {
      emitter.clear();
    }

    for (const emitter of this.eventObjectEmitters) {
      emitter.clear();
    }
  }

  /**
   * Initialize a skeletal node.
   */
  initNode(nodes: SkeletalNode[], node: SkeletalNode, genericObject: GenericObject, object?: SkeletalNodeObject): void {
    vec3.copy(node.pivot, genericObject.pivot);

    if (genericObject.parentId === -1) {
      node.parent = this;
    } else {
      node.parent = nodes[genericObject.parentId];
    }

    node.dontInheritTranslation = genericObject.dontInheritTranslation;
    node.dontInheritRotation = genericObject.dontInheritRotation;
    node.dontInheritScaling = genericObject.dontInheritScaling;
    
    if (genericObject.billboarded) {
      node.billboarded = true;
    } else if (genericObject.billboardedX) {
      node.billboardedX = true;
    } else if (genericObject.billboardedY) {
      node.billboardedY = true;
    } else if (genericObject.billboardedZ) {
      node.billboardedZ = true;
    }

    if (object) {
      node.object = object;
    }
  }

  /**
   * Overriden to hide also attachment models.
   */
  override hide(): void {
    super.hide();

    this.resetAttachments();
  }

  /**
   * Updates all of this instance internal nodes and objects.
   * Nodes that are determined to not be visible will not be updated, nor will any of their children down the hierarchy.
   */
  updateNodes(dt: number, forcedArg: boolean): void {
    let forced = forcedArg; // OpenWar3 (issue #161): a change of pose SPACE forces a full pass
    const sequence = this.sequence;
    const frame = this.frame;
    const counter = this.counter;
    const sortedNodes = this.sortedNodes;
    const model = <MdxModel>this.model;
    const sortedGenericObjects = model.sortedGenericObjects;

    // OpenWar3: advance the animation cross-fade. blendT goes 0 -> 1 across
    // blendTime ms; each node's freshly-sampled pose is blended back toward
    // the snapshot captured at setSequence() by (1 - blendT). While blending
    // every node must be re-evaluated each frame (like a forced update), so
    // variancy-skipping is disabled — otherwise a node whose new sequence
    // has no track for a channel would never re-blend off the snapshot.
    const snapshot = this.blendSnapshot;
    const snap = snapshot || EMPTY_SNAPSHOT;
    let blending = false;
    let blendInv = 0; // weight on the snapshot pose = 1 - blendT

    if (this.blendRemaining > 0 && snapshot !== null && sequence !== -1) {
      this.blendRemaining -= dt * 1000;

      if (this.blendRemaining <= 0) {
        this.blendRemaining = 0; // fade complete this frame
      } else {
        blending = true;
        blendInv = this.blendTime > 0 ? this.blendRemaining / this.blendTime : 0;
      }
    }

    // OpenWar3 (issue #161): the shared pose for this (model, sequence, bucket), or null when
    // this instance has to sample for itself. A blending instance never shares — the fade is
    // per instance, mixing in a snapshot only it has — and neither does a forced update,
    // which is the one pass that must write every node whatever the tracks say.
    let pose: Ow3Pose | null = null;
    // OpenWar3 (P2-2): a static doodad shares its pose REGARDLESS of the animation quality —
    // its Stand clip has no tracks, so there is nothing to quantize — and that pose is keyed
    // by the sequence alone (see ow3PoseFor's `staticPose`).
    const staticShare = ow3StaticDoodadShare(this, sequence);

    if (!this.ow3PoseReset && !blending && (sequence !== -1 || staticShare) && (staticShare || ow3SharePoses(model)) && ow3Shareable(model)) {
      pose = staticShare
        ? ow3DoodadPoseFor(model, sequence, frame, ow3StaticSequence(model, sequence))
        : ow3PoseFor(model, sequence, frame);
    }

    // OpenWar3 (issue #161): …and whether the COMPOSED skeleton is shared too, which is the
    // half that takes the per-instance node walk away entirely. It means this instance's node
    // matrices are in ITS OWN space (see skeletalnode.ts), so the switch is a change of
    // meaning and every node has to be recomposed on the frame it flips.
    const wantLocal = pose !== null && ow3SkeletonShareable(model);

    if (wantLocal !== (this.ow3LocalPose === true)) {
      this.ow3LocalPose = wantLocal;
      this.forced = forced = true;
      this.ow3PoseReset = true;
      this.ow3BonesUploaded = false;
      pose = wantLocal ? ow3PoseFor(model, sequence, frame) : null;
    }

    const skeleton = wantLocal && pose !== null && !this.ow3PoseReset ? pose : null;
    const replaySkeleton = skeleton !== null && skeleton.skeleton;

    // The instance that COMPOSES a bucket has one trap to clear first. A node whose clip says
    // nothing is not rewritten, so it still holds whatever was last written there — and for a
    // node carrying an emitter or an event object that is the WORLD matrix
    // `ow3ComposeObjectNodes` left at the end of the previous frame. Captured, that entry is
    // a body's POSITION baked into a shared pose, and every instance wearing it draws that
    // part of itself where the composer stood. (Caught by comparing the two paths' matrices:
    // a Footman's node 49, a root-parented event object, was out by 19,192 units.)
    //
    // So the composer redoes exactly those nodes — `cleanObjects` below — rather than the
    // whole skeleton. Forcing the whole pass fixed it too and cost a full 57-node walk with
    // every channel sampled for every bucket that opens, which measured as a third of the
    // saving handed back.
    //
    // The set is every node this instance has EVER had composed into (`ow3WorldWritten`), not
    // the ones carrying something right now, and the difference is a real bug that shows up
    // once in a while: OpenWar3 parents a buff model onto a bone and takes it away again, and
    // between the two the node keeps the world matrix the compose left in it while no longer
    // looking like a node anybody writes. Marked on the write, it is always cleaned.
    const cleanObjects = skeleton !== null && !replaySkeleton;
    const written = cleanObjects ? ow3WorldWritten(this) : null;

    // `written` is in NODE order and this walk is in HIERARCHY order (`sortedNodes[i] =
    // nodes[hierarchy[i]]`) — the trap `ow3ObjectNodes` names. Read as `written[i]` it asked
    // about somebody else's node; object nodes survived it only because the clause after it
    // looks at the node itself, and a static node above a billboarded or own-clock subtree
    // (which is no object) came through with a world matrix in it about one bucket in three.
    const hierarchy = model.hierarchy;

    // What the tracks are sampled AT: the bucket's time while sharing (so every instance in
    // the bucket gets one pose), the instance's own frame otherwise.
    const poseFrame = pose === null ? frame : pose.frame;
    const fillPose = pose !== null && !pose.filled;
    const replayPose = pose !== null && pose.filled;

    // Update the nodes
    let anyDirty = forced; // OpenWar3: see updateBoneTexture

    // OpenWar3 (issue #161): ZERO laps when this instance is wearing a skeleton somebody else
    // composed — the whole point of the cache. What it still owes the world (emitters,
    // sounds, attached models) is paid by `ow3ComposeObjectNodes` below.
    for (let i = 0, l = replaySkeleton ? 0 : sortedNodes.length; i < l; i++) {
      const genericObject = sortedGenericObjects[i];
      const node = sortedNodes[i];
      const parent = <MdxNode | SkeletalNode>node.parent;
      let wasDirty = forced || parent.wasDirty || genericObject.anyBillboarding
        || (written !== null && (written[hierarchy[i]] === 1 || node.object !== null && node.object !== undefined || node.children.length > 0));
      const variants = genericObject.variants;

      // OpenWar3 (issue #161): a pose somebody already sampled is COPIED rather than
      // sampled again — ten floats a node against a keyframe search and a slerp per
      // channel. `dirty` is the tracks' half of `wasDirty`; the parent's and the
      // billboard's halves are this instance's own and are already in it above.
      if (replayPose && pose !== null) {
        if (pose.dirty[i]) {
          wasDirty = true;

          const s = i * 10;
          const trs = pose.trs;
          const t = node.localLocation;
          const r = node.localRotation;
          const sc = node.localScale;

          t[0] = trs[s];
          t[1] = trs[s + 1];
          t[2] = trs[s + 2];
          r[0] = trs[s + 3];
          r[1] = trs[s + 4];
          r[2] = trs[s + 5];
          r[3] = trs[s + 6];
          sc[0] = trs[s + 7];
          sc[1] = trs[s + 8];
          sc[2] = trs[s + 9];
        }
      }

      // Local node transformation.
      // Use variants to skip animation data when possible (never while
      // blending — every node has to re-blend each frame).
      else if (forced || blending || variants['generic'][sequence]) {
        wasDirty = true;

        const s = i * 10; // this node's slot in the flat snapshot buffer

        // Translation
        if (forced || blending || variants['translation'][sequence]) {
          const t = node.localLocation;

          genericObject.getTranslation(t, sequence, poseFrame, counter);

          if (blending) {
            t[0] += (snap[s] - t[0]) * blendInv;
            t[1] += (snap[s + 1] - t[1]) * blendInv;
            t[2] += (snap[s + 2] - t[2]) * blendInv;
          }
        }

        // Rotation
        if (forced || blending || variants['rotation'][sequence]) {
          const r = node.localRotation;

          genericObject.getRotation(r, sequence, poseFrame, counter);

          if (blending) {
            blendRotationHeap[0] = snap[s + 3];
            blendRotationHeap[1] = snap[s + 4];
            blendRotationHeap[2] = snap[s + 5];
            blendRotationHeap[3] = snap[s + 6];

            // slerp target -> snapshot by blendInv (so blendInv=0 keeps target).
            quat.slerp(r, r, blendRotationHeap, blendInv);
          }
        }

        // Scale
        if (forced || blending || variants['scale'][sequence]) {
          const sc = node.localScale;

          genericObject.getScale(sc, sequence, poseFrame, counter);

          if (blending) {
            sc[0] += (snap[s + 7] - sc[0]) * blendInv;
            sc[1] += (snap[s + 8] - sc[1]) * blendInv;
            sc[2] += (snap[s + 9] - sc[2]) * blendInv;
          }
        }

        // OpenWar3 (issue #161): this instance is the one sampling this bucket, so what
        // it sampled becomes the bucket's pose for everybody else in it.
        if (fillPose && pose !== null) {
          const trs = pose.trs;
          const t = node.localLocation;
          const r = node.localRotation;
          const sc = node.localScale;

          trs[s] = t[0];
          trs[s + 1] = t[1];
          trs[s + 2] = t[2];
          trs[s + 3] = r[0];
          trs[s + 4] = r[1];
          trs[s + 5] = r[2];
          trs[s + 6] = r[3];
          trs[s + 7] = sc[0];
          trs[s + 8] = sc[1];
          trs[s + 9] = sc[2];
          pose.dirty[i] = 1;
        }
      }

      node.wasDirty = wasDirty;

      // If this is a forced update, or this node's local data was updated, or the parent node was updated, do a full world update.
      if (wasDirty) {
        anyDirty = true; // OpenWar3
        node.recalculateTransformation(this);
      }

      // If there is an instance object associated with this node (emitter/attachment), and it is visible, update it.
      // OpenWar3 (issue #161): …unless the pose is being composed in INSTANCE space, where
      // this node's matrix is not yet the world's. `ow3ComposeObjectNodes` does it below,
      // once the instance's own matrix has been multiplied back in.
      if (node.object && !this.ow3LocalPose) {
        genericObject.getVisibility(visibilityHeap, sequence, poseFrame, counter);

        // If the attachment/emitter is visible, update it.
        if (visibilityHeap[0] > 0) {
          (<SkeletalNodeObject>node.object).update(dt);
        }
      }

      // Recalculate and update child nodes.
      // Note that this only affects normal nodes such as instances, and not skeletal nodes.
      // OpenWar3 (issue #161): deferred with the objects above while in instance space.
      for (const child of this.ow3LocalPose ? EMPTY_CHILDREN : node.children) {
        if (wasDirty) {
          child.recalculateTransformation();
        }

        child.update(dt);
      }
    }

    if (fillPose && pose !== null) {
      pose.filled = true; // OpenWar3 (issue #161): every node of this bucket is now sampled
    }

    // OpenWar3 (issue #161): the composed half of the cache. This instance either just
    // composed the bucket's skeleton — in its own space, so it is everybody's — or it wore
    // one, in which case it did no node work at all this frame.
    let plan: Ow3BillboardPlan | null = null;

    if (skeleton !== null) {
      if (!replaySkeleton) {
        ow3CaptureSkeleton(this, skeleton);
      }

      plan = ow3Billboards(model);

      if (plan === null) {
        // Nothing in this model faces the camera: the bucket's texture IS this instance's,
        // and it sends nothing of its own.
        this.ow3SharedTexture = skeleton.texture;
        this.ow3SharedBones = skeleton.bones;
      } else {
        // Billboarded subtrees are this body's own, so it wears the bucket's pose in an
        // array of its own and sends that — still without sampling or composing the rest.
        ow3FixBillboards(this, skeleton, plan, sequence, poseFrame, counter);
        this.ow3SharedTexture = null;
        this.ow3SharedBones = this.ow3LocalBones || null;
        anyDirty = true; // the billboards move with the camera, so this goes up every frame
      }

      ow3ComposeObjectNodes(this, skeleton, dt, sequence, poseFrame, counter, plan);
    } else if (this.ow3SharedBones) {
      this.ow3SharedTexture = null;
      this.ow3SharedBones = null;
    }

    this.ow3PoseReset = false; // OpenWar3 (issue #161): the new clip's locals are written
    this.ow3Posed = true; // OpenWar3: there is now a drawn pose to cross-fade from
    this.ow3WornPose = replaySkeleton ? skeleton : null; // OpenWar3: see captureBlendSnapshot
    this.ow3BonesDirty = anyDirty; // OpenWar3
  }

  /**
   * If a model has no sequences or is running no sequence, it will only update once since it will never be forced to update.
   * This is generally the desired behavior, except when it is moved by the client.
   * Therefore, if an instance is transformed, always do a forced update.
   */
  override recalculateTransformation(): void {
    super.recalculateTransformation();

    this.forced = true;
  }

  /**
   * Update the batch data.
   */
  updateBatches(forced: boolean): void {
    const sequence = this.sequence;
    const frame = this.frame;
    const counter = this.counter;
    const model = <MdxModel>this.model;
    const geosets = model.geosets;
    const layers = model.layers;
    const geosetColors = this.geosetColors;
    const layerAlphas = this.layerAlphas;
    const layerTextures = this.layerTextures;
    const uvAnims = this.uvAnims;

    // Geosets
    for (let i = 0, l = geosets.length; i < l; i++) {
      const geoset = geosets[i];
      const geosetAnimation = geoset.geosetAnimation;
      const geosetColor = geosetColors[i];

      if (geosetAnimation) {
        // Color
        if (forced || geosetAnimation.variants['color'][sequence]) {
          geosetAnimation.getColor(colorHeap, sequence, frame, counter);

          geosetColor[0] = colorHeap[0];
          geosetColor[1] = colorHeap[1];
          geosetColor[2] = colorHeap[2];
        }

        // Alpha
        if (forced || geosetAnimation.variants['alpha'][sequence]) {
          geosetAnimation.getAlpha(alphaHeap, sequence, frame, counter);

          geosetColor[3] = alphaHeap[0];
        }
      } else if (forced) {
        geosetColor[0] = 1;
        geosetColor[1] = 1;
        geosetColor[2] = 1;
        geosetColor[3] = 1;
      }
    }

    // Layers
    for (let i = 0, l = layers.length; i < l; i++) {
      const layer = layers[i];
      const textureAnimation = layer.textureAnimation;
      const uvAnim = uvAnims[i];

      // Alpha
      if (forced || layer.variants['alpha'][sequence]) {
        layer.getAlpha(alphaHeap, sequence, frame, counter);

        layerAlphas[i] = alphaHeap[0];
      }

      // Sprite animation
      if (forced || layer.variants['textureId'][sequence]) {
        layer.getTextureId(textureIdHeap, sequence, frame, counter);

        layerTextures[i] = textureIdHeap[0];
      }

      if (textureAnimation) {
        // UV translation animation
        if (forced || textureAnimation.variants['translation'][sequence]) {
          textureAnimation.getTranslation(<Float32Array>translationHeap, sequence, frame, counter);

          uvAnim[0] = translationHeap[0];
          uvAnim[1] = translationHeap[1];
        }

        // UV rotation animation
        if (forced || textureAnimation.variants['rotation'][sequence]) {
          textureAnimation.getRotation(<Float32Array>rotationHeap, sequence, frame, counter);

          uvAnim[2] = rotationHeap[2];
          uvAnim[3] = rotationHeap[3];
        }

        // UV scale animation
        if (forced || textureAnimation.variants['scale'][sequence]) {
          textureAnimation.getScale(<Float32Array>scaleHeap, sequence, frame, counter);

          uvAnim[4] = scaleHeap[0];
        }
      } else if (forced) {
        uvAnim[0] = 0;
        uvAnim[1] = 0;
        uvAnim[2] = 0;
        uvAnim[3] = 1;
        uvAnim[4] = 1;
      }
    }
  }

  /**
   * Hand this instance's bone matrices to the GPU -- but only when they have actually changed.
   *
   * This is one `bindTexture` plus one `texSubImage2D` per instance per frame, and the cost is
   * almost entirely the CALL rather than the bytes: measured at ~2 microseconds an instance
   * whether it carries three bones or two hundred. Half of them were paying it to upload a pose
   * identical to last frame's. Probed in a real match with 249 visible instances: 127 unchanged
   * against 122 changed, and the split was exactly by model -- every unit animating, every tree
   * standing still. A doodad's Stand sequence has no tracks, so `updateNodes` marks not one of
   * its nodes dirty and `recalculateTransformation`, the only thing that writes `worldMatrices`,
   * never runs. Uploading it again cannot say anything new.
   *
   * `ow3BonesUploaded` is separate from the dirty flag so the FIRST upload always happens, even
   * for an instance whose very first update somehow finds nothing dirty.
   */
  updateBoneTexture(): void {
    // OpenWar3 (issue #161): an instance wearing the bucket's skeleton has nothing of its own
    // to send — the texture was filled once, by whoever composed it (`ow3CaptureSkeleton`).
    if (this.ow3SharedTexture) {
      return;
    }

    if (this.boneTexture && (this.ow3BonesDirty || !this.ow3BonesUploaded)) {
      // …or from `ow3LocalBones` when this instance wears a shared pose with billboarded
      // subtrees of its own in it (ow3FixBillboards).
      this.boneTexture.bindAndUpdate(<Float32Array>(this.ow3LocalBones && this.ow3LocalPose ? this.ow3LocalBones : this.worldMatrices));
      this.ow3BonesUploaded = true;
      this.ow3BonesDirty = false;
    }
  }

  // OpenWar3 (issue #66): a faded instance (vertex-colour alpha < 1 — Wind Walk,
  // Banish, SetUnitVertexColor) has no opaque geometry left. Its "opaque" groups
  // move to the translucent pass so they blend over a finished depth buffer instead
  // of over whatever the opaque pass happened to have drawn so far.
  isFaded(): boolean {
    return this.vertexColor[3] < 1;
  }

  /**
   * OpenWar3 (P2-2): may `Scene.renderOpaque` put this instance in an instanced doodad bucket?
   *
   * True only once the instance is actually wearing a shared, INSTANCE-space skeleton (that is
   * what makes a single bone texture and a per-instance world matrix sufficient), and only when
   * nothing about it varies between instances. Debug render modes are excluded because they use
   * their own programs, which know nothing about the per-vertex matrix.
   */
  override ow3InstancedStatic(): boolean {
    if (this.ow3StaticDoodad !== true) {
      return false;
    }

    if (this.parent !== null || this.scene === null) {
      return false;
    }

    if (this.model.viewer.debugRenderMode !== 0 || this.isFaded()) {
      return false;
    }

    if (this.ow3LocalPose !== true || this.ow3SharedTexture === null) {
      return false;
    }

    return ow3StaticDoodadShare(this, this.sequence);
  }

  /**
   * OpenWar3 (P2-2): what makes two instances of the same model draw-identical, apart from
   * their world matrix — the textures their overrides resolve to, and their team colour.
   *
   * `Scene.renderOpaque` buckets on this so `BatchGroup.renderInstanced` can bind the six maps
   * once. Instance ids come from a WeakMap, so two instances handed the SAME texture object (the
   * way the map handler gives a whole row of trees one skin) share a key.
   */
  override ow3InstKey(): string {
    const overrides = this.textureOverrides;
    let key = '';

    if (overrides.size) {
      const parts: string[] = [];

      overrides.forEach((texture, index) => {
        parts.push(index + ':' + (texture ? ow3TextureId(texture) : 0));
      });

      parts.sort();
      key = parts.join(',');
    }

    // The sequence is part of the key because the shared bone texture is minted per
    // (model, sequence): two Stand variants hold different poses, and a bucket may only bind
    // one. The TIME bucket is deliberately NOT part of it — `ow3DoodadPoseFor` refreshes one
    // live texture per (model, sequence) in place, so every instance of that pair already wears
    // the same texture; splitting by frame bucket would only shred the draw back into pieces.
    return key + '|' + this.teamColor + '|' + this.sequence;
  }

  override renderOpaque(): void {
    const model = <MdxModel>this.model;

    if (this.isFaded()) {
      return;
    }

    for (const group of model.opaqueGroups) {
      group.render(this);
    }
  }

  override renderTranslucent(): void {
    const model = <MdxModel>this.model;

    if (this.isFaded()) {
      for (const group of model.opaqueGroups) {
        group.render(this);
      }
    }

    for (const group of model.translucentGroups) {
      group.render(this);
    }
  }

  /**
   * OpenWar3: one frame of an instance the camera cannot see (Scene.update's second pass, and
   * the base ModelInstance.update for one in a visible cell but outside the frustum).
   *
   * Its clock runs exactly as a drawn instance's does, so a clip begun off screen is as far
   * along when the camera arrives as it would have been if somebody had watched — a unit that
   * died off camera is lying down, not starting to fall — and `sequenceEnded` comes on time.
   * Its animation EVENTS keep time too: each event emitter is asked what `updateEmission`
   * would ask, and when one that PRODUCES something (a spawned model, a splat, an ubersplat;
   * a sound only where the viewer has audio, which the game's does not) reaches its key, the
   * instance is posed for that one frame — the event lands where its node IS, which only a
   * pose knows — and the ordinary pass fires it. Any other frame poses nothing: the event
   * bookkeeping is just carried forward, so nothing is left over to fire on first sight.
   * A cross-fade has nobody to show it to (see ow3SeenFrame) and is dropped.
   */
  override ow3TickHidden(dt: number): void {
    this.blendRemaining = 0;

    this.ow3AdvanceClock(dt);

    const sequence = this.sequence;

    if (sequence === -1 || !this.allowParticleSpawn) {
      return;
    }

    // Only the emitters that can put something into the world are asked at all — a unit's
    // FOOTPRINT events (FPT) and, without viewer audio, its SOUND events produce nothing,
    // and every walking unit off screen would otherwise pay for them every frame. Listed
    // once per instance, after its model has loaded (the emitters are made then).
    const emitters = this.eventObjectEmitters;
    let producers = this.ow3Producers;

    if (producers === null || this.ow3ProducersOf !== emitters.length) {
      producers = this.ow3Producers = emitters.filter((e) => ow3EventProduces((<EventObjectEmitterObject>e.emitterObject).type, this));
      this.ow3ProducersOf = emitters.length;
    }

    if (producers.length === 0) {
      return;
    }

    const frame = this.frame;
    const counter = this.counter;
    let landing = false;

    for (const emitter of producers) {
      const object = <EventObjectEmitterObject>emitter.emitterObject;

      if (!object.ok) {
        continue;
      }

      object.getVisibility(visibilityHeap, sequence, frame, counter);

      if (visibilityHeap[0] <= 0) {
        continue; // updateNodes would not have asked this one either
      }

      object.getValue(ow3EventHeap, this);

      const value = ow3EventHeap[0];

      if (value === 1 && value !== emitter.lastValue) {
        landing = true;

        break;
      }

      emitter.lastValue = value; // carried forward, so nothing is left to fire on first sight
    }

    if (landing) {
      // A forced pass: the locals are as old as the last time anybody looked. It runs every
      // visible node object's update, and so fires the event — and carries every other
      // emitter's bookkeeping forward — through the very code a drawn frame uses.
      this.forced = true;

      this.ow3Pose(dt);
    }
  }

  /**
   * OpenWar3: was this instance drawn on the viewer's latest frame (or the one before, for a
   * call that lands between the sim and the draw)? See ow3SeenFrame.
   */
  ow3OnScreen(): boolean {
    const viewer = this.model.viewer;

    return viewer !== undefined && this.ow3SeenFrame >= viewer.frame - 1;
  }

  override updateAnimations(dt: number): void {
    const model = <MdxModel>this.model;
    const viewer = model.viewer;

    // OpenWar3: a cross-fade still running when the camera last left this instance ran its
    // course while it was off screen (see ow3SeenFrame). Its clock is the world's, not the
    // camera's — finishing it now would play the remainder late, in front of the player.
    if (viewer !== undefined) {
      if (this.blendRemaining > 0 && this.ow3SeenFrame < viewer.frame - 1) {
        this.blendRemaining = 0;
      }

      this.ow3SeenFrame = viewer.frame;
    }

    this.ow3AdvanceClock(dt);
    this.ow3Pose(dt);
  }

  /**
   * OpenWar3: the half of `updateAnimations` that is TIME — the frame, the global-sequence
   * counter, the end of a clip — split from the half that is the PICTURE (`ow3Pose`), so an
   * instance the camera cannot see keeps time without paying for a pose (`ow3TickHidden`).
   */
  ow3AdvanceClock(dt: number): void {
    const model = <MdxModel>this.model;
    const sequenceId = this.sequence;

    if (sequenceId !== -1) {
      const sequence = model.sequences[sequenceId];
      const interval = sequence.interval;
      const frameTime = dt * 1000;

      this.frame += frameTime;
      this.counter += frameTime;
      this.allowParticleSpawn = true;

      if (this.frame >= interval[1]) {
        if (this.sequenceLoopMode === 2 || (this.sequenceLoopMode === 0 && sequence.nonLooping === 0)) {
          this.frame = interval[0];

          this.resetEventEmitters();
        } else {
          this.frame = interval[1];
          this.counter -= frameTime;
          this.allowParticleSpawn = false;
        }

        this.sequenceEnded = true;
      } else {
        this.sequenceEnded = false;
      }
    }
  }

  /** OpenWar3: the half of `updateAnimations` that is the PICTURE (see ow3AdvanceClock). */
  ow3Pose(dt: number): void {
    const sequenceId = this.sequence;
    const forced = this.forced;

    if (sequenceId !== -1 || forced) {
      // Update the nodes
      this.updateNodes(dt, forced);

      // Update the bone texture.
      this.updateBoneTexture();

      // Update the batches
      this.updateBatches(forced);
    }

    this.forced = false;

    // OpenWar3 (P2-2): a doodad whose clip is absent (sequence -1) is otherwise updated only
    // once, and that first forced pass runs while `ow3PoseReset` is still set — so it would
    // never reach a shared skeleton. Keep it forced until one exists (at most a few passes).
    if (this.ow3StaticDoodad && (this.ow3LocalPose !== true || this.ow3SharedTexture === null) && ow3StaticDoodadShare(this, sequenceId)) {
      this.forced = true;
    }
  }

  /**
   * Set the team color of this instance.
   */
  setTeamColor(id: number): this {
    this.teamColor = id;

    // OpenWar3: a model in an attachment is part of this body and wears its colour. The wisps
    // of EntangledGoldMine.mdx are SharedModels\EntangleWisp.mdx, drawn in team GLOW, and they
    // stayed slot 0 (red) for every owner and through every Ally Color Mode.
    for (const attachment of this.attachments) {
      attachment.internalInstance.setTeamColor(id);
    }

    return this;
  }

  /**
   * Set the vertex color of this instance.
   */
  setVertexColor(color: Float32Array | number[]): this {
    this.vertexColor.set(color);

    return this;
  }

  /**
   * Set the sequence of this instance.
   */
  setSequence(id: number): this {
    const model = <MdxModel>this.model;
    const sequences = model.sequences;
    const previous = this.sequence; // captured before the switch, for cross-fade

    this.sequence = id;

    if (id < 0 || id > sequences.length - 1) {
      this.sequence = -1;
      this.frame = 0;
      this.allowParticleSpawn = false;
    } else {
      this.frame = sequences[id].interval[0];
    }

    // OpenWar3: start an animation cross-fade from the pose we're leaving into
    // the new sequence. Only blend on a real change between two live sequences
    // (skip the initial -1 -> first-clip set, and same-clip restarts such as a
    // per-swing attack re-trigger, which must hard-cut to stay in phase). A skeleton that
    // was never posed has no pose to leave — its locals are the bind pose (see ow3Posed) —
    // so the new clip hard-cuts in, exactly as the first clip of a fresh instance does.
    // …and a pose nobody is looking at needs no fade OUT of it either (see ow3SeenFrame): a
    // clip changed off camera is simply in place by the time the camera arrives.
    if (this.blendTime > 0 && this.ow3Posed && this.ow3OnScreen() && previous !== -1 && this.sequence !== -1 && previous !== this.sequence) {
      this.captureBlendSnapshot();
      this.blendRemaining = this.blendTime;
    } else {
      this.blendRemaining = 0;
    }

    this.resetEventEmitters();
    this.resetAttachments();

    this.forced = true;
    this.ow3PoseReset = true; // OpenWar3 (issue #161): a new clip rewrites every local

    return this;
  }

  /**
   * OpenWar3: set this instance's animation cross-fade duration, in seconds.
   * Fed from each unit's UnitUI.slk `blend` value (0.15s for most WC3 units).
   * 0 disables blending (hard cuts, the stock mdx-m3-viewer behavior).
   */
  setBlendTime(seconds: number): this {
    this.blendTime = Math.max(0, seconds * 1000);

    if (this.blendTime === 0) {
      this.blendRemaining = 0;
    }

    return this;
  }

  /**
   * OpenWar3: snapshot every node's current local TRS into the flat blend
   * buffer, laid out as [loc.x,loc.y,loc.z, rot.x,rot.y,rot.z,rot.w, sc.x,sc.y,sc.z]
   * per node in sortedNodes order (matching updateNodes' iteration).
   */
  captureBlendSnapshot(): void {
    const sortedNodes = this.sortedNodes;
    const l = sortedNodes.length;
    let snapshot = this.blendSnapshot;

    if (snapshot === null || snapshot.length < l * 10) {
      snapshot = this.blendSnapshot = new Float32Array(l * 10);
    }

    for (let i = 0; i < l; i++) {
      const node = sortedNodes[i];
      const loc = node.localLocation;
      const rot = node.localRotation;
      const sc = node.localScale;
      const s = i * 10;

      snapshot[s] = loc[0];
      snapshot[s + 1] = loc[1];
      snapshot[s + 2] = loc[2];
      snapshot[s + 3] = rot[0];
      snapshot[s + 4] = rot[1];
      snapshot[s + 5] = rot[2];
      snapshot[s + 6] = rot[3];
      snapshot[s + 7] = sc[0];
      snapshot[s + 8] = sc[1];
      snapshot[s + 9] = sc[2];
    }

    // OpenWar3 (issue #161): an instance wearing a shared skeleton walked no nodes, so for
    // every node its clip animates the locals above are stale — the frame the clip STARTED
    // on, when the last forced pass wrote them. What it was drawn in is the bucket's pose,
    // whose `trs` holds exactly the animated nodes (`dirty`), in this same layout and order.
    const worn = this.ow3WornPose;

    if (worn !== null && worn.filled) {
      const trs = worn.trs;
      const dirty = worn.dirty;

      for (let i = 0; i < l; i++) {
        if (dirty[i]) {
          const s = i * 10;

          for (let k = 0; k < 10; k++) {
            snapshot[s + k] = trs[s + k];
          }
        }
      }
    }
  }

  override getBounds(): Bounds {
    const model = <MdxModel>this.model;

    if (this.sequence === -1) {
      return model.bounds;
    }

    const bounds = model.sequences[this.sequence].bounds;

    if (bounds.r === 0) {
      return model.bounds;
    }

    return bounds;
  }

  /**
   * Set the sequence loop mode.
   * 0 to never loop, 1 to loop based on the model, and 2 to always loop.
   */
  setSequenceLoopMode(mode: number): this {
    this.sequenceLoopMode = mode;

    return this;
  }

  /**
   * Get an attachment node.
   */
  getAttachment(id: number): SkeletalNode | undefined {
    const model = <MdxModel>this.model;
    const attachment = model.attachments[id];

    if (attachment) {
      return this.nodes[attachment.index];
    }

    return;
  }

  resetEventEmitters(): void {
    for (const emitter of this.eventObjectEmitters) {
      emitter.lastValue = 0;
    }
  }

  resetAttachments(): void {
    for (const attachment of this.attachments) {
      attachment.internalInstance.hide();
    }
  }
}
