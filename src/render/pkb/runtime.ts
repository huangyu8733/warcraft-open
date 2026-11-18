// The PopcornFX runtime: a small virtual machine that executes a bake's compiled per-particle
// scripts over each layer's particle pools and routes their events through the layer graph.
//
// Everything here works in metres. Warcraft III's HD art sits at 50 units per metre; only sprite
// collection converts. Built-in functions are reimplemented from their names and how the scripts
// use them (see mdxres/research/popcornfx-vm.md). Scene queries answer "nothing there", which is
// what an effect previewed on its own would see.

import { PkEffectDef, PkLayerDef, PkSampler } from './defs';
import {
    Mat4, PkRandom, Quat, Vec3, qFromAxisAngle, qIdentity, qLengthSq, qMultiply,
    qNormalize, qRotate, vCross, vDistance, vDistanceSq, vLength, vLengthSq, vScale,
    matFromQuat, matFromTranslation, matInvert, matMul, matTransformNormal, matTransformPoint,
    matTranslation,
} from './math';
import {
    PkInstruction, PkOp, PkScript, PkSpace, PkValue, isBoolKind, isIntKind, isNoneOperand, kindLanes,
} from './script';

const ZERO = new PkValue();
const MAX_PARTICLES_PER_SLOT = 4096;

/** What an effect instance knows about the world around it. Distances are metres. */
export class PkEnvironment {
    /** Effect local space (metres) to simulation world space (metres). */
    localToWorld: Mat4;
    cameraPosition: Vec3 = { x: 0, y: -20, z: 10 };
    /** True while the host wants the effect to keep emitting (the CORN node is gated on). */
    running = true;
    emissionRateMultiplier = 1;
    colorMultiplier = { x: 1, y: 1, z: 1, w: 1 };
    /** `__a_Game.TeamColor`: the player's colour for team-coloured effects, white otherwise. */
    teamColor = { x: 1, y: 1, z: 1, w: 1 };
    time = 0;

    constructor(localToWorld?: Mat4) {
        this.localToWorld = localToWorld ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    }
}

/** The particles of one layer slot, stored field by field. */
export class PkLayerState {
    readonly def: PkLayerDef;
    readonly slotIndex: number;
    fields: PkValue[][] = [];
    newborn: boolean[] = [];
    killed: boolean[] = [];
    /** A serial per particle, stable across compaction. */
    ids: number[] = [];
    private nextId = 0;
    count = 0;
    readonly lifeRatioField: number;
    readonly invLifeField: number;
    /**
     * Set once any of this layer's scripts reads `__a_Game.TeamColor` - the effect is asking the
     * game for the player's colour.
     */
    readsTeamColor = false;

    constructor(def: PkLayerDef, slotIndex: number) {
        this.def = def;
        this.slotIndex = slotIndex;
        this.lifeRatioField = def.field('self.lifeRatio');
        this.invLifeField = def.field('self.invLife');
    }

    get capacity(): number {
        return this.newborn.length;
    }

    allocate(): number {
        if (this.count === this.capacity) {
            const cap = Math.max(16, this.capacity * 2);
            const fields: PkValue[][] = [];
            for (let i = 0; i < this.def.fields.length; i++) {
                const row = new Array<PkValue>(cap);
                for (let p = 0; p < this.count; p++) row[p] = this.fields[i]?.[p] ?? new PkValue();
                fields.push(row);
            }
            this.fields = fields;
            const nb = new Array<boolean>(cap).fill(false);
            const kl = new Array<boolean>(cap).fill(false);
            const ids = new Array<number>(cap).fill(0);
            for (let p = 0; p < this.count; p++) {
                nb[p] = this.newborn[p];
                kl[p] = this.killed[p];
                ids[p] = this.ids[p];
            }
            this.newborn = nb;
            this.killed = kl;
            this.ids = ids;
        }
        const p = this.count++;
        for (const row of this.fields) row[p] = new PkValue();
        this.ids[p] = this.nextId++;
        this.newborn[p] = true;
        this.killed[p] = false;
        return p;
    }

    /** Removes killed particles, keeping the survivors' order. */
    compact(): void {
        let w = 0;
        for (let r = 0; r < this.count; r++) {
            if (this.killed[r]) continue;
            if (w !== r) {
                for (const row of this.fields) row[w] = row[r];
                this.newborn[w] = this.newborn[r];
                this.ids[w] = this.ids[r];
            }
            this.killed[w] = false;
            w++;
        }
        this.count = w;
    }

    clear(): void {
        this.count = 0;
    }

    fieldValue(index: number, particle: number): PkValue {
        const row = this.fields[index];
        const v = row === undefined ? undefined : row[particle];
        return v ?? ZERO;
    }
}

enum Bind {
    Zero,
    Field,
    SceneDt,
    SceneTime,
    Pointer,
    Sampler,
    Event,
    Spatial,
    AttrEmission,
    AttrColor,
    AttrTeamColor,
    AttrOne,
}

enum Fn {
    Unknown,
    Rand,
    VRand,
    SamplePosition,
    SampleNormal,
    SampleCurve,
    SampleTurbulence,
    XformL2WF,
    XformL2WD,
    XformW2LF,
    XformW2LD,
    XformW2W,
    Rgb2Hsv,
    Hsv2Rgb,
    RadiansRotate,
    Rotate,
    AxisSide,
    AxisUp,
    AxisForward,
    OrientationMult,
    EffectPosition,
    EffectAxisUp,
    EffectAxisSide,
    EffectAxisForward,
    EffectAge,
    EffectIsRunning,
    SceneOrientation,
    ViewPosition,
    ViewDistance,
    SceneIntersect,
    Kill,
    Generate,
    EventStreamGenerate,
    EventStreamDuration,
    Trigger,
    InitPayload,
    AppendPayload,
    BuildPayloadElement,
    Kick,
    ExtractF,
    ExtractI,
    ExtractO,
    False,
    Zero,
    SpatialAllocate,
    SpatialAppend,
    SpatialInsert,
    SpatialClosest,
}

interface ExternalBinding {
    kind: Bind;
    index: number;
}

interface ScriptPlan {
    externals: ExternalBinding[];
    calls: Fn[];
    reg1: PkValue[];
    reg2: PkValue[];
    reg3: PkValue[];
}

interface SpatialEntry {
    key: Vec3;
    values: (PkValue | null)[];
}

interface SpatialTable {
    current: SpatialEntry[];
    previous: SpatialEntry[];
}

interface PayloadElement {
    from: PkValue;
    to: PkValue;
    flags: number;
    baseIndex: number;
}

class PendingSpawn {
    eventSlot = -1;
    count: number;
    firstIndex = 0;
    /**
     * `SelfID` of the particle that fired the event, 0 for the effect's root spawn. The
     * spawned children copy it into their `ParentID`, which is what the ribbon renderer
     * groups a trail by — see {@link PkEffectInstance.spawnInto}.
     */
    parentKey = 0;
    /** The firing layer's payload names for this event, in append order. */
    names: string[];
    /** Payload name -> index into the instance's element list. */
    readonly elements = new Map<string, number>();

    constructor(count = 0, names: string[] = []) {
        this.count = count;
        this.names = names;
    }
}

const ZERO_BINDING: ExternalBinding = { kind: Bind.Zero, index: 0 };

/**
 * One running PopcornFX effect: executes the bake's compiled spawn and evolve scripts over each
 * layer's particles and routes their events through the layer graph.
 */
export class PkEffectInstance {
    static readonly maxParticlesPerSlot = MAX_PARTICLES_PER_SLOT;

    private readonly def: PkEffectDef;
    private readonly rng: PkRandom;
    private readonly layerSlots: (PkLayerState | null)[];
    private readonly plans = new Map<PkScript, ScriptPlan>();
    private readonly pending: PendingSpawn[] = [];
    private readonly elements: PayloadElement[] = [];
    private readonly spatial = new Map<string, SpatialTable>();
    private readonly spatialNames: string[] = [];
    private readonly spatialPending: (PkValue | null)[][] = [];
    private age = 0;
    private started = false;

    readonly env: PkEnvironment;
    readonly unsupported = new Set<string>();

    constructor(def: PkEffectDef, env: PkEnvironment, seed: number) {
        this.def = def;
        this.env = env;
        this.rng = new PkRandom(seed);
        this.layerSlots = new Array<PkLayerState | null>(def.slots.length).fill(null);
        for (let s = 0; s < def.slots.length; s++) {
            const layerIndex = def.slots[s].layer;
            if (layerIndex < 0 || layerIndex >= def.layers.length) continue;
            this.layerSlots[s] = new PkLayerState(def.layers[layerIndex], s);
        }
    }

    get slots(): readonly (PkLayerState | null)[] {
        return this.layerSlots;
    }

    get effectAge(): number {
        return this.age;
    }

    /** True until every particle of every layer has died (and the effect has started). */
    get isAlive(): boolean {
        if (!this.started) return true;
        for (const s of this.layerSlots) if (s !== null && s.count > 0) return true;
        return this.pending.length > 0;
    }

    update(dt: number): void {
        if (!this.started) {
            this.started = true;
            const root = this.layerSlots[0];
            if (this.layerSlots.length > 0 && root) this.spawnInto(0, new PendingSpawn(1));
        }
        if (!(dt > 0)) return;
        this.age += dt;
        this.env.time += dt;

        for (const table of this.spatial.values()) {
            const t = table.previous;
            table.previous = table.current;
            table.current = t;
            table.current.length = 0;
        }
        this.spatialPending.length = 0;

        for (let s = 0; s < this.layerSlots.length; s++) {
            const st = this.layerSlots[s];
            if (st === null || st.count === 0) continue;
            const script = st.def.evolve;
            // A layer with neither an evolve script nor a renderer only relays events from its
            // spawn script; once that has run there is nothing left for its particles to do.
            if (script === null && st.def.renderers.length === 0) {
                for (let p = 0; p < st.count; p++) if (!st.newborn[p]) st.killed[p] = true;
                st.compact();
                continue;
            }
            for (let p = 0; p < st.count; p++) {
                if (st.newborn[p]) continue;
                if (st.lifeRatioField >= 0 && st.invLifeField >= 0) {
                    const lr = st.fieldValue(st.lifeRatioField, p);
                    const inv = st.fieldValue(st.invLifeField, p).x;
                    // PopcornFX defines lifeRatio as 0 at birth and 1 at death, and clamps it
                    // there. The clamp matters: bakes use a particle with `invLife = Infinity`
                    // as a one-frame trigger and pass its lifeRatio along a payload, so without
                    // it the value is Infinity and everything downstream (a ribbon's position
                    // interpolation, a curve lookup) comes out NaN/Infinity.
                    if (inv !== 0) lr.setLane(0, Math.min(1, lr.x + dt * inv));
                }
                if (script !== null) this.run(script, st, p, dt, null, 0, 0);
                if (st.lifeRatioField >= 0 && !(st.fieldValue(st.lifeRatioField, p).x < 1)) st.killed[p] = true;
            }
            st.compact();
            this.flushPending();
        }
        this.flushPending();
        for (const st of this.layerSlots) if (st !== null) for (let p = 0; p < st.count; p++) st.newborn[p] = false;
    }

    // ------------------------------------------------------------------------ spawning

    private flushPending(): void {
        // Spawn scripts do not kick events, so one pass drains what the evolve pass queued.
        while (this.pending.length > 0) {
            const batch = this.pending.slice();
            this.pending.length = 0;
            for (const p of batch) {
                if (p.eventSlot < 0 || p.eventSlot >= this.def.events.length) continue;
                for (const target of this.def.events[p.eventSlot].targetSlots) this.spawnInto(target, p);
            }
        }
        this.elements.length = 0;
    }

    private spawnInto(slot: number, batch: PendingSpawn): void {
        if (slot < 0 || slot >= this.layerSlots.length) return;
        const st = this.layerSlots[slot];
        if (st === null) return;
        const count = Math.min(batch.count, MAX_PARTICLES_PER_SLOT - st.count);
        for (let k = 0; k < count; k++) {
            const p = st.allocate();
            this.assignIds(st, p, batch.parentKey);
            if (st.def.spawn !== null) this.run(st.def.spawn, st, p, 0, batch, k, count);
            if (st.def.evolveOnSpawn !== null) this.run(st.def.evolveOnSpawn, st, p, 0, batch, k, count);
        }
    }

    /**
     * Fills the engine-owned `self.SelfID` / `self.ParentID` attributes.
     *
     * PopcornFX hands every particle a unique id and the id of the particle whose event spawned
     * it; a bake's scripts never assign either, but a ribbon renderer reads them to chain its
     * points (all points of one trail share the `ParentID` of the trail's emitter particle).
     * Without them every ribbon layer collapses to a pile of unlinked points, which is why
     * Reforged trails were missing. The slot number is packed into the high bits so ids stay
     * unique across layers of the same effect.
     */
    private assignIds(st: PkLayerState, particle: number, parentKey: number): void {
        let self = st.def.field('SelfID');
        if (self < 0) self = st.def.field('self.SelfID');
        if (self >= 0) st.fieldValue(self, particle).setInt(0, this.particleKey(st, particle));
        let parent = st.def.field('ParentID');
        if (parent < 0) parent = st.def.field('self.ParentID');
        if (parent >= 0) st.fieldValue(parent, particle).setInt(0, parentKey);
    }

    private particleKey(st: PkLayerState, particle: number): number {
        return (st.slotIndex + 1) * 0x1000000 + ((st.ids[particle] + 1) & 0xffffff);
    }

    // ------------------------------------------------------------------------ script plans

    private planFor(s: PkScript, st: PkLayerState): ScriptPlan {
        const cached = this.plans.get(s);
        if (cached !== undefined) return cached;
        const layer = st.def;
        const slot = this.def.slots[st.slotIndex];
        const externals: ExternalBinding[] = [];
        for (let i = 0; i < s.externalNames.length; i++) {
            const n = s.externalNames[i];
            const t = s.externalTypes[i];
            const field = layer.field(n);
            if (field >= 0) { externals.push({ kind: Bind.Field, index: field }); continue; }
            if (n === 'scene.dt') { externals.push({ kind: Bind.SceneDt, index: 0 }); continue; }
            if (n === 'scene.time') { externals.push({ kind: Bind.SceneTime, index: 0 }); continue; }
            if (t.startsWith('pCtx') || t === 'RandCtx' || t === 'SceneCtx') {
                externals.push({ kind: Bind.Pointer, index: 0 });
                continue;
            }
            if (t.startsWith('sampler')) {
                const si = layer.samplers.findIndex(x => x.name === n);
                externals.push(si >= 0 ? { kind: Bind.Sampler, index: si } : ZERO_BINDING);
                continue;
            }
            if (t === 'SpatialLayerType' && n.startsWith('__spatialLayer_')) {
                const sl = Number.parseInt(n.slice('__spatialLayer_'.length), 10);
                if (Number.isInteger(sl) && sl >= 0 && sl < layer.spatialLayers.length) {
                    const tableName = layer.spatialLayers[sl];
                    if (!this.spatial.has(tableName)) this.spatial.set(tableName, { current: [], previous: [] });
                    let idx = this.spatialNames.indexOf(tableName);
                    if (idx < 0) {
                        this.spatialNames.push(tableName);
                        idx = this.spatialNames.length - 1;
                    }
                    externals.push({ kind: Bind.Spatial, index: idx });
                    continue;
                }
            }
            if (t === 'particleEvent') {
                let ev = -1;
                for (const e of slot?.outputEvents ?? []) {
                    if (e >= 0 && e < this.def.events.length && this.def.events[e].name === n) { ev = e; break; }
                }
                externals.push({ kind: Bind.Event, index: ev });
                continue;
            }
            if (n.startsWith('__a_')) {
                if (n === '__a_Game.EmissionRateMultiplier') externals.push({ kind: Bind.AttrEmission, index: 0 });
                else if (n === '__a_Game.ColorMultiplier') externals.push({ kind: Bind.AttrColor, index: 0 });
                else if (n === '__a_Game.TeamColor') externals.push({ kind: Bind.AttrTeamColor, index: 0 });
                else if (n.includes('Position') || n.includes('Center')) externals.push(ZERO_BINDING);
                else externals.push({ kind: Bind.AttrOne, index: 0 });
                continue;
            }
            externals.push(ZERO_BINDING);
            this.unsupported.add(`external '${n}' (${t})`);
        }

        const calls: Fn[] = new Array<Fn>(s.code.length).fill(Fn.Unknown);
        for (let i = 0; i < s.code.length; i++) {
            const ins = s.code[i];
            if (ins.op !== PkOp.Call) continue;
            const name = ins.slot < s.functionNames.length ? s.functionNames[ins.slot] : '';
            const objType = ins.thisSlot !== 0xffff && ins.thisSlot < s.externalTypes.length ? s.externalTypes[ins.thisSlot] : '';
            let fn: Fn;
            switch (name) {
                case 'rand': fn = Fn.Rand; break;
                case 'vrand': fn = Fn.VRand; break;
                case 'samplePosition': fn = Fn.SamplePosition; break;
                case 'sampleNormal': fn = Fn.SampleNormal; break;
                case 'sample':
                    fn = objType.startsWith('samplerCurve') ? Fn.SampleCurve
                        : objType.startsWith('samplerTurbulence') ? Fn.SampleTurbulence
                            : Fn.Zero;
                    break;
                case 'xform_l2w_f_masked': fn = Fn.XformL2WF; break;
                case 'xform_l2w_d_masked': fn = Fn.XformL2WD; break;
                case 'xform_w2l_f_masked': fn = Fn.XformW2LF; break;
                case 'xform_w2l_d_masked': fn = Fn.XformW2LD; break;
                case 'xform_w2w_f_masked':
                case 'xform_w2w_d_masked': fn = Fn.XformW2W; break;
                case 'rgb2hsv': fn = Fn.Rgb2Hsv; break;
                case 'hsv2rgb': fn = Fn.Hsv2Rgb; break;
                case 'radians.rotate': fn = Fn.RadiansRotate; break;
                case 'rotate': fn = Fn.Rotate; break;
                case 'orientation_axisSide': fn = Fn.AxisSide; break;
                case 'orientation_axisUp': fn = Fn.AxisUp; break;
                case 'orientation_axisForward': fn = Fn.AxisForward; break;
                case 'orientation_mult': fn = Fn.OrientationMult; break;
                case 'effect.position': fn = Fn.EffectPosition; break;
                case 'effect.axisUp': fn = Fn.EffectAxisUp; break;
                case 'effect.axisSide': fn = Fn.EffectAxisSide; break;
                case 'effect.axisForward': fn = Fn.EffectAxisForward; break;
                case 'effect.age': fn = Fn.EffectAge; break;
                case 'effect.isRunning': fn = Fn.EffectIsRunning; break;
                case 'scene.orientation_f_norm': fn = Fn.SceneOrientation; break;
                case 'view.position': fn = Fn.ViewPosition; break;
                case 'view.distance': fn = Fn.ViewDistance; break;
                case 'scene.intersect': fn = Fn.SceneIntersect; break;
                case 'self.kill': fn = Fn.Kill; break;
                case 'generate':
                    fn = objType === 'samplerEventStreamC' ? Fn.EventStreamGenerate : Fn.Generate;
                    break;
                case 'duration': fn = Fn.EventStreamDuration; break;
                case 'trigger': fn = Fn.Trigger; break;
                case 'initPayload': fn = objType === 'particleEvent' ? Fn.InitPayload : Fn.Zero; break;
                case 'appendPayload':
                    fn = objType === 'particleEvent' ? Fn.AppendPayload
                        : objType === 'SpatialLayerType' ? Fn.SpatialAppend
                            : Fn.Zero;
                    break;
                case 'kick': fn = objType === 'particleEvent' ? Fn.Kick : Fn.Zero; break;
                case 'buildPayloadElement': fn = Fn.BuildPayloadElement; break;
                case 'extractPayloadElementF1':
                case 'extractPayloadElementF2':
                case 'extractPayloadElementF3':
                case 'extractPayloadElementF4': fn = Fn.ExtractF; break;
                case 'extractPayloadElementI1': fn = Fn.ExtractI; break;
                case 'extractPayloadElementO': fn = Fn.ExtractO; break;
                case 'allocatePayload': fn = objType === 'SpatialLayerType' ? Fn.SpatialAllocate : Fn.Zero; break;
                case 'insert': fn = objType === 'SpatialLayerType' ? Fn.SpatialInsert : Fn.Zero; break;
                case 'closestF3': fn = objType === 'SpatialLayerType' ? Fn.SpatialClosest : Fn.Zero; break;
                case '_pksi_War3.HasTeleported_SI':
                case 'contains': fn = Fn.False; break;
                default: fn = Fn.Zero; break;
            }
            calls[i] = fn;
            if (fn === Fn.Zero) {
                this.unsupported.add(`function '${objType.length > 0 ? `${objType}.` : ''}${name}'`);
            }
        }

        const makeRegs = (n: number): PkValue[] => {
            const out: PkValue[] = new Array<PkValue>(n);
            for (let i = 0; i < n; i++) out[i] = new PkValue();
            return out;
        };
        const plan: ScriptPlan = {
            externals, calls,
            reg1: makeRegs(s.reg1Count), reg2: makeRegs(s.reg2Count), reg3: makeRegs(s.reg3Count),
        };
        this.plans.set(s, plan);
        return plan;
    }

    // ------------------------------------------------------------------------ interpreter

    private run(s: PkScript, st: PkLayerState, particle: number, dt: number, spawn: PendingSpawn | null, spawnIndex: number, spawnCount: number): void {
        const plan = this.planFor(s, st);
        for (let pc = 0; pc < s.code.length; pc++) {
            const ins = s.code[pc];
            switch (ins.op) {
                case PkOp.Load: {
                    const bind = this.externalAt(plan, ins.slot);
                    if (bind.kind === Bind.AttrTeamColor) st.readsTeamColor = true;
                    let v: PkValue;
                    switch (bind.kind) {
                        case Bind.Field: v = st.fieldValue(bind.index, particle); break;
                        case Bind.SceneDt: v = new PkValue(dt); break;
                        case Bind.SceneTime: v = new PkValue(this.env.time); break;
                        case Bind.AttrEmission: v = new PkValue(this.env.emissionRateMultiplier); break;
                        case Bind.AttrColor:
                            v = new PkValue(this.env.colorMultiplier.x, this.env.colorMultiplier.y, this.env.colorMultiplier.z, this.env.colorMultiplier.w);
                            break;
                        case Bind.AttrTeamColor:
                            v = new PkValue(this.env.teamColor.x, this.env.teamColor.y, this.env.teamColor.z, this.env.teamColor.w);
                            break;
                        case Bind.AttrOne: v = new PkValue(1, 1, 1, 1); break;
                        default: v = ZERO; break;
                    }
                    this.set(plan, ins.dst, v);
                    break;
                }
                case PkOp.Store: {
                    const bind = this.externalAt(plan, ins.slot);
                    if (bind.kind === Bind.Field) {
                        const row = st.fields[bind.index];
                        if (row !== undefined) {
                            const target = row[particle];
                            if (target !== undefined) target.copyFrom(this.get(s, plan, ins.dst));
                        }
                    }
                    break;
                }
                case PkOp.Binary:
                    this.set(plan, ins.dst, binary(ins.sub, this.get(s, plan, ins.a), ins.a.kind, this.get(s, plan, ins.b), ins.dst));
                    break;
                case PkOp.Unary:
                    this.set(plan, ins.dst, unary(ins.sub, this.get(s, plan, ins.a), ins.a, ins.dst));
                    break;
                case PkOp.Binary2:
                    this.set(plan, ins.dst, binary2(ins.sub, this.get(s, plan, ins.a), this.get(s, plan, ins.b), ins.a, ins.dst));
                    break;
                case PkOp.Ternary: {
                    const a = this.get(s, plan, ins.a);
                    const b = this.get(s, plan, ins.b);
                    const t = this.get(s, plan, ins.c);
                    const r = new PkValue();
                    const n = kindLanes(ins.dst.kind);
                    for (let l = 0; l < n; l++) {
                        const tl = kindLanes(ins.c.kind) === 1 ? t.x : t.lane(l);
                        r.setLane(l, a.lane(l) + (b.lane(l) - a.lane(l)) * tl);
                    }
                    this.set(plan, ins.dst, r);
                    break;
                }
                case PkOp.Select: {
                    const a = this.get(s, plan, ins.a);
                    const b = this.get(s, plan, ins.b);
                    const c = this.get(s, plan, ins.c);
                    const r = new PkValue();
                    for (let l = 0; l < 4; l++) {
                        const cond = (kindLanes(ins.c.kind) === 1 ? c.int(0) : c.int(l)) !== 0;
                        r.setInt(l, cond ? b.int(l) : a.int(l));
                    }
                    this.set(plan, ins.dst, r);
                    break;
                }
                case PkOp.Swizzle: {
                    const a = this.get(s, plan, ins.a);
                    const scalarSource = kindLanes(ins.a.kind) === 1;
                    const ints = isIntKind(ins.dst.kind) || isBoolKind(ins.dst.kind);
                    const r = new PkValue();
                    const n = kindLanes(ins.dst.kind);
                    for (let l = 0; l < n; l++) {
                        const code = PkScript.laneCode(ins.swizzle, l);
                        if (code <= 3) r.setInt(l, a.int(scalarSource ? 0 : code));
                        else if (ints) r.setInt(l, code === 5 ? 1 : 0);
                        else r.setLane(l, code === 5 ? 1 : 0);
                    }
                    this.set(plan, ins.dst, r);
                    break;
                }
                case PkOp.Vector: {
                    const r = new PkValue();
                    let lane = 0;
                    for (const c of ins.components ?? []) {
                        const v = this.get(s, plan, c);
                        const lanes = kindLanes(c.kind);
                        for (let l = 0; l < lanes && lane < 4; l++) r.setInt(lane++, v.int(l));
                    }
                    this.set(plan, ins.dst, r);
                    break;
                }
                case PkOp.CastA:
                    this.set(plan, ins.dst, this.get(s, plan, ins.a));
                    break;
                case PkOp.CastB:
                    this.set(plan, ins.dst, cast(this.get(s, plan, ins.a), ins.a.kind, ins.dst.kind));
                    break;
                case PkOp.Call:
                    this.call(s, plan, plan.calls[pc], ins, st, particle, spawn, spawnIndex, spawnCount);
                    break;
            }
        }
    }

    private externalAt(plan: ScriptPlan, slot: number): ExternalBinding {
        return slot < plan.externals.length ? plan.externals[slot] : ZERO_BINDING;
    }

    private get(s: PkScript, plan: ScriptPlan, o: { index: number; space: PkSpace }): PkValue {
        switch (o.space) {
            case PkSpace.Const: return o.index < s.consts.length ? s.consts[o.index] : ZERO;
            case PkSpace.Reg1: return plan.reg1[o.index] ?? ZERO;
            case PkSpace.Reg2: return plan.reg2[o.index] ?? ZERO;
            case PkSpace.Reg3: return plan.reg3[o.index] ?? ZERO;
            default: return ZERO;
        }
    }

    private set(plan: ScriptPlan, o: { index: number; space: PkSpace }, v: PkValue): void {
        let target: PkValue | undefined;
        switch (o.space) {
            case PkSpace.Reg1: target = plan.reg1[o.index]; break;
            case PkSpace.Reg2: target = plan.reg2[o.index]; break;
            case PkSpace.Reg3: target = plan.reg3[o.index]; break;
            default: return;
        }
        if (target !== undefined) target.copyFrom(v);
    }

    // ------------------------------------------------------------------------ built-in functions

    private call(
        s: PkScript, plan: ScriptPlan, fn: Fn, ins: PkInstruction, st: PkLayerState,
        particle: number, spawn: PendingSpawn | null, spawnIndex: number, spawnCount: number,
    ): void {
        const arg = (k: number): PkValue => (k < ins.argCount ? this.get(s, plan, s.args[ins.argStart + k]) : ZERO);
        const obj = (): PkSampler | null => {
            const bind = this.externalAt(plan, ins.thisSlot);
            if (bind.kind === Bind.Sampler && bind.index < st.def.samplers.length) return st.def.samplers[bind.index];
            return null;
        };
        const eventOf = (): number => {
            const bind = this.externalAt(plan, ins.thisSlot);
            return bind.kind === Bind.Event ? bind.index : -1;
        };
        const spatialOf = (): SpatialTable | null => {
            const bind = this.externalAt(plan, ins.thisSlot);
            if (bind.kind !== Bind.Spatial || bind.index >= this.spatialNames.length) return null;
            return this.spatial.get(this.spatialNames[bind.index]) ?? null;
        };

        const r = new PkValue();
        const world = this.spawnFrame(spawn, spawnIndex, spawnCount) ?? this.env.localToWorld;
        switch (fn) {
            case Fn.Rand: {
                const lo = arg(0), hi = arg(1);
                const n = Math.max(1, kindLanes(ins.dst.kind));
                if (isIntKind(ins.dst.kind)) {
                    for (let l = 0; l < n; l++) r.setInt(l, lo.int(l) + Math.trunc((hi.int(l) - lo.int(l)) * this.rng.next()));
                } else {
                    for (let l = 0; l < n; l++) r.setLane(l, lo.lane(l) + (hi.lane(l) - lo.lane(l)) * this.rng.next());
                }
                break;
            }
            case Fn.VRand: {
                let u = randomDirection(this.rng);
                if (ins.argCount >= 3) {
                    const a = arg(0).x, b = arg(1).x;
                    const scale = a + (b - a) * Math.cbrt(this.rng.next());
                    u = vScale(u, scale);
                }
                r.x = u.x; r.y = u.y; r.z = u.z;
                break;
            }
            case Fn.SamplePosition: {
                const shape = obj()?.shape ?? null;
                if (shape !== null) {
                    const p = shape.samplePosition(this.rng);
                    r.x = p.x; r.y = p.y; r.z = p.z;
                }
                break;
            }
            case Fn.SampleNormal: {
                const shape = obj()?.shape ?? null;
                const p = shape !== null ? shape.samplePosition(this.rng) : { x: 0, y: 0, z: 1 };
                const n = vLengthSq(p) > 1e-12 ? vScale(p, 1 / vLength(p)) : { x: 0, y: 0, z: 1 };
                r.x = n.x; r.y = n.y; r.z = n.z;
                break;
            }
            case Fn.SampleCurve: {
                const curve = obj()?.curve ?? null;
                if (curve !== null) r.copyFrom(curve.sample(arg(0).x));
                break;
            }
            case Fn.SampleTurbulence: {
                const smp = obj();
                const wavelength = smp !== null && smp.wavelength > 1e-4 ? smp.wavelength : 1;
                const strength = smp !== null ? smp.strength : 1;
                const p = vScale(arg(0).xyz, 1 / wavelength);
                const t = this.env.time;
                r.x = strength * Math.sin(p.y * 1.7 + t * 0.9) * Math.cos(p.z * 1.3);
                r.y = strength * Math.sin(p.z * 1.9 + t * 0.7) * Math.cos(p.x * 1.1);
                r.z = strength * Math.sin(p.x * 1.5 + t * 0.8) * Math.cos(p.y * 1.6);
                break;
            }
            case Fn.XformL2WF: r.copyFrom(fromVec(matTransformPoint(world, arg(0).xyz))); break;
            case Fn.XformL2WD: r.copyFrom(fromVec(matTransformNormal(world, arg(0).xyz))); break;
            case Fn.XformW2LF: {
                const inv = matInvert(world);
                r.copyFrom(fromVec(inv !== null ? matTransformPoint(inv, arg(0).xyz) : arg(0).xyz));
                break;
            }
            case Fn.XformW2LD: {
                const inv = matInvert(world);
                r.copyFrom(fromVec(inv !== null ? matTransformNormal(inv, arg(0).xyz) : arg(0).xyz));
                break;
            }
            case Fn.XformW2W: r.copyFrom(arg(0)); break;
            case Fn.Rgb2Hsv: r.copyFrom(rgb2Hsv(arg(0))); break;
            case Fn.Hsv2Rgb: r.copyFrom(hsv2Rgb(arg(0))); break;
            case Fn.RadiansRotate: {
                const axis = arg(1).xyz;
                if (vLengthSq(axis) > 1e-12) {
                    const q = qFromAxisAngle(axis, arg(2).x);
                    r.copyFrom(fromVec(qRotate(arg(0).xyz, q)));
                } else {
                    r.copyFrom(arg(0));
                }
                break;
            }
            case Fn.Rotate: {
                const q = arg(1);
                r.copyFrom(fromVec(qRotate(arg(0).xyz, { x: q.x, y: q.y, z: q.z, w: q.w })));
                break;
            }
            case Fn.AxisSide:
            case Fn.AxisUp:
            case Fn.AxisForward: {
                const q = arg(0);
                const axis: Vec3 = fn === Fn.AxisSide ? { x: 1, y: 0, z: 0 }
                    : fn === Fn.AxisForward ? { x: 0, y: 1, z: 0 } : { x: 0, y: 0, z: 1 };
                const quat: Quat = { x: q.x, y: q.y, z: q.z, w: q.w };
                r.copyFrom(fromVec(qLengthSq(quat) > 1e-12 ? qRotate(axis, qNormalize(quat)) : axis));
                break;
            }
            case Fn.OrientationMult: {
                const a = arg(0), b = arg(1);
                const q = qMultiply({ x: a.x, y: a.y, z: a.z, w: a.w }, { x: b.x, y: b.y, z: b.z, w: b.w });
                r.x = q.x; r.y = q.y; r.z = q.z; r.w = q.w;
                break;
            }
            case Fn.EffectPosition: r.copyFrom(fromVec(matTranslation(world))); break;
            case Fn.EffectAxisUp: r.copyFrom(fromVec(safeNormal(matTransformNormal(world, { x: 0, y: 0, z: 1 })))); break;
            case Fn.EffectAxisSide: r.copyFrom(fromVec(safeNormal(matTransformNormal(world, { x: 1, y: 0, z: 0 })))); break;
            case Fn.EffectAxisForward: r.copyFrom(fromVec(safeNormal(matTransformNormal(world, { x: 0, y: 1, z: 0 })))); break;
            case Fn.EffectAge: r.x = this.age; break;
            case Fn.EffectIsRunning: r.setInt(0, this.env.running ? -1 : 0); break;
            case Fn.SceneOrientation:
                if (kindLanes(ins.dst.kind) >= 4) { r.x = 0; r.y = 0; r.z = 0; r.w = 1; }
                else { r.x = 0; r.y = 0; r.z = 1; }
                break;
            case Fn.ViewPosition: r.copyFrom(fromVec(this.env.cameraPosition)); break;
            case Fn.ViewDistance: r.x = vDistance(this.env.cameraPosition, arg(0).xyz); break;
            case Fn.SceneIntersect: break;
            case Fn.Kill:
                if (arg(0).int(0) !== 0) st.killed[particle] = true;
                return;
            case Fn.Generate: {
                // generate(state, amount, step, ...): one particle per `step` of accumulated
                // amount. The state keeps the fraction of a step left over, seeded at 0.99999 so
                // the first particle comes on the first frame.
                const state = arg(0);
                let step = arg(2).x;
                if (!(step > 1e-6)) step = 1;
                let acc = state.x + arg(1).x / step;
                if (!Number.isFinite(acc)) acc = 0;
                const count = Math.floor(Math.max(acc, 0));
                r.x = acc - count;
                r.y = state.y + count;
                r.z = count;
                break;
            }
            case Fn.EventStreamGenerate: {
                const state = arg(0);
                const age = arg(2).x;
                const times = obj()?.eventTimes ?? [];
                const done = Math.trunc(Math.max(0, state.x));
                let fire = 0;
                while (done + fire < times.length && times[done + fire] <= age + 1e-6) fire++;
                r.x = done + fire;
                r.y = 0;
                r.z = fire;
                break;
            }
            case Fn.EventStreamDuration: {
                const times = obj()?.eventTimes ?? [];
                r.x = times.length === 0 ? 0 : Math.max(...times);
                break;
            }
            case Fn.Trigger:
                r.x = 0;
                r.y = 0;
                r.z = arg(0).int(0) !== 0 ? Math.max(1, arg(1).x) : 0;
                break;
            case Fn.InitPayload: {
                const gen = arg(1);
                const count = Math.trunc(Math.max(0, Math.min(gen.z, MAX_PARTICLES_PER_SLOT)));
                const ev = eventOf();
                const evName = ev >= 0 && ev < this.def.events.length ? this.def.events[ev].name : '';
                const pending = new PendingSpawn(count, st.def.outputPayloads.get(evName) ?? []);
                pending.eventSlot = ev;
                pending.firstIndex = Math.trunc(Math.max(0, gen.y - gen.z));
                pending.parentKey = this.particleKey(st, particle);
                this.pending.push(pending);
                r.setInt(0, this.pending.length);
                break;
            }
            case Fn.BuildPayloadElement: {
                const gen = arg(0);
                this.elements.push({
                    from: arg(1).clone(),
                    to: arg(2).clone(),
                    flags: arg(3).int(0),
                    baseIndex: Math.trunc(Math.max(0, gen.y - gen.z)),
                });
                r.setInt(0, this.elements.length);
                break;
            }
            case Fn.AppendPayload: {
                const h = arg(0).int(0) - 1;
                const idx = arg(1).int(0);
                const el = arg(2).int(0) - 1;
                if (h >= 0 && h < this.pending.length) {
                    const p = this.pending[h];
                    const name = idx >= 0 && idx < p.names.length ? p.names[idx] : `#${idx}`;
                    p.elements.set(name, el);
                }
                r.copyFrom(arg(0));
                break;
            }
            case Fn.Kick: {
                const h = arg(0).int(0) - 1;
                if (h >= 0 && h < this.pending.length && this.pending[h].count <= 0) this.pending[h].eventSlot = -1;
                return;
            }
            case Fn.ExtractF:
            case Fn.ExtractI:
            case Fn.ExtractO: {
                const idx = arg(0).int(0);
                const name = idx >= 0 && idx < st.def.inputPayloads.length ? st.def.inputPayloads[idx] : `#${idx}`;
                const el = spawn !== null ? spawn.elements.get(name) : undefined;
                if (el !== undefined && el >= 0 && el < this.elements.length) {
                    const e = this.elements[el];
                    if (fn === Fn.ExtractI) {
                        r.setInt(0, e.baseIndex + spawnIndex);
                    } else {
                        const t = spawnCount > 1 ? (spawnIndex + 1) / spawnCount : 1;
                        for (let l = 0; l < 4; l++) r.setLane(l, e.from.lane(l) + (e.to.lane(l) - e.from.lane(l)) * t);
                    }
                } else if (fn === Fn.ExtractO) {
                    r.x = 0; r.y = 0; r.z = 0; r.w = 1;
                }
                break;
            }
            case Fn.False: r.setInt(0, 0); break;
            case Fn.SpatialAllocate:
                this.spatialPending.push([null, null, null, null]);
                r.setInt(0, this.spatialPending.length);
                break;
            case Fn.SpatialAppend: {
                // appendPayload(handle, value, index)
                const h = arg(0).int(0) - 1;
                const idx = arg(2).int(0);
                if (h >= 0 && h < this.spatialPending.length && idx >= 0 && idx < 4) {
                    this.spatialPending[h][idx] = arg(1).clone();
                }
                r.copyFrom(arg(0));
                break;
            }
            case Fn.SpatialInsert: {
                const h = arg(0).int(0) - 1;
                const table = spatialOf();
                if (h >= 0 && h < this.spatialPending.length && table !== null) {
                    table.current.push({ key: arg(1).xyz, values: this.spatialPending[h] });
                }
                return;
            }
            case Fn.SpatialClosest: {
                // closestF3(key, radius, payloadIndex, ...): the value published under the nearest key.
                const key = arg(0).xyz;
                const idx = Math.min(Math.max(arg(2).int(0), 0), 3);
                const table = spatialOf();
                if (table !== null) {
                    let best = Number.POSITIVE_INFINITY;
                    for (const list of [table.current, table.previous]) {
                        for (const entry of list) {
                            const d = vDistanceSq(entry.key, key);
                            if (d < best) {
                                best = d;
                                const value = entry.values[idx];
                                if (value !== null && value !== undefined) r.copyFrom(value);
                                else r.copyFrom(ZERO);
                            }
                        }
                        if (best < Number.POSITIVE_INFINITY) break;
                    }
                }
                break;
            }
            default: break;
        }
        if (!isNoneOperand(ins.dst)) this.set(plan, ins.dst, r);
    }

    /**
     * While a spawn script runs for an event that carries a `Position` payload (and optionally an
     * `Orientation`), local space is the parent particle's frame.
     */
    private spawnFrame(spawn: PendingSpawn | null, spawnIndex: number, spawnCount: number): Mat4 | null {
        if (spawn === null) return null;
        const pe = spawn.elements.get('Position');
        if (pe === undefined || pe < 0 || pe >= this.elements.length) return null;
        const t = spawnCount > 1 ? (spawnIndex + 1) / spawnCount : 1;
        const e = this.elements[pe];
        const pos = {
            x: e.from.x + (e.to.x - e.from.x) * t,
            y: e.from.y + (e.to.y - e.from.y) * t,
            z: e.from.z + (e.to.z - e.from.z) * t,
        };
        let rot: Quat = qIdentity();
        const oe = spawn.elements.get('Orientation');
        if (oe !== undefined && oe >= 0 && oe < this.elements.length) {
            const o = this.elements[oe].to;
            const q: Quat = { x: o.x, y: o.y, z: o.z, w: o.w };
            if (qLengthSq(q) > 1e-8) rot = qNormalize(q);
        }
        return matMul(matFromQuat(rot), matFromTranslation(pos.x, pos.y, pos.z));
    }
}

// ---------------------------------------------------------------------------- value operations

function fromVec(v: Vec3): PkValue {
    return new PkValue(v.x, v.y, v.z);
}

function safeNormal(v: Vec3): Vec3 {
    return vLengthSq(v) > 1e-12 ? vScale(v, 1 / vLength(v)) : { x: 0, y: 0, z: 1 };
}

function randomDirection(rng: PkRandom): Vec3 {
    const z = rng.next() * 2 - 1;
    const a = rng.next() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    return { x: s * Math.cos(a), y: s * Math.sin(a), z };
}

function binary(sub: number, a: PkValue, aKind: number, b: PkValue, dst: { kind: number }): PkValue {
    const r = new PkValue();
    const n = Math.max(kindLanes(dst.kind), kindLanes(aKind));
    const ints = isIntKind(aKind) || isBoolKind(aKind);
    for (let l = 0; l < n && l < 4; l++) {
        if (ints) {
            const x = a.int(l), y = b.int(l);
            let v: number;
            switch (sub) {
                case 0x00: v = x + y; break;
                case 0x01: v = x - y; break;
                case 0x02: v = x * y; break;
                case 0x03: v = y !== 0 ? Math.trunc(x / y) : 0; break;
                case 0x04: v = y !== 0 ? x % y : 0; break;
                case 0x05: v = -x; break;
                case 0x08: v = x & y; break;
                case 0x09: v = x | y; break;
                case 0x0b: v = ~x; break;
                case 0x0c: v = x < y ? -1 : 0; break;
                case 0x0d: v = x <= y ? -1 : 0; break;
                case 0x0e: v = x > y ? -1 : 0; break;
                case 0x0f: v = x >= y ? -1 : 0; break;
                case 0x10: v = x === y ? -1 : 0; break;
                case 0x11: v = x !== y ? -1 : 0; break;
                default: v = 0; break;
            }
            r.setInt(l, v);
        } else {
            const x = a.lane(l), y = b.lane(l);
            switch (sub) {
                case 0x00: r.setLane(l, x + y); break;
                case 0x01: r.setLane(l, x - y); break;
                case 0x02: r.setLane(l, x * y); break;
                case 0x03: r.setLane(l, x / y); break;
                case 0x04: r.setLane(l, y !== 0 ? x % y : 0); break;
                case 0x05: r.setLane(l, -x); break;
                case 0x0c: r.setInt(l, x < y ? -1 : 0); break;
                case 0x0d: r.setInt(l, x <= y ? -1 : 0); break;
                case 0x0e: r.setInt(l, x > y ? -1 : 0); break;
                case 0x0f: r.setInt(l, x >= y ? -1 : 0); break;
                case 0x10: r.setInt(l, x === y ? -1 : 0); break;
                case 0x11: r.setInt(l, x !== y ? -1 : 0); break;
                default: r.setLane(l, 0); break;
            }
        }
    }
    return r;
}

function unary(sub: number, a: PkValue, src: { kind: number }, dst: { kind: number }): PkValue {
    const r = new PkValue();
    switch (sub) {
        case 0x07: // angle -> (sin, cos)
            r.x = Math.sin(a.x);
            r.y = Math.cos(a.x);
            return r;
        case 0x24: { // float3 normalize
            const v = a.xyz;
            const len = vLength(v);
            if (len > 1e-12) r.copyFrom(fromVec(vScale(v, 1 / len)));
            return r;
        }
        case 0x31: { // any lane set
            let any = false;
            for (let l = 0; l < kindLanes(src.kind); l++) any = any || a.int(l) !== 0;
            r.setInt(0, any ? -1 : 0);
            return r;
        }
        case 0x33: // lane is non-zero
            for (let l = 0; l < kindLanes(dst.kind); l++) {
                r.setInt(l, a.lane(l) !== 0 && Number.isFinite(a.lane(l)) ? -1 : 0);
            }
            return r;
    }
    const n = Math.max(kindLanes(dst.kind), kindLanes(src.kind));
    for (let l = 0; l < n && l < 4; l++) {
        const x = a.lane(l);
        let v: number;
        switch (sub) {
            case 0x00: v = Math.sqrt(Math.max(x, 0)); break;
            case 0x01: v = x > 0 ? 1 / Math.sqrt(x) : 0; break;
            case 0x0d:
            case 0x2c: v = Math.exp(x); break;
            case 0x11: v = 1 / x; break;
            case 0x12: v = Math.abs(x); break;
            case 0x13: v = x > 0 ? 1 : x < 0 ? -1 : 0; break;
            // Both feed curve samples with an ever-growing age, which only makes sense as a wrap.
            case 0x16:
            case 0x17: v = x - Math.floor(x); break;
            case 0x18: v = Math.min(Math.max(x, 0), 1); break;
            default: v = x; break;
        }
        r.setLane(l, v);
    }
    return r;
}

function binary2(sub: number, a: PkValue, b: PkValue, aOp: { kind: number }, dst: { kind: number }): PkValue {
    switch (sub) {
        case 0x1d: {
            let d = 0;
            for (let l = 0; l < kindLanes(aOp.kind); l++) d += a.lane(l) * b.lane(l);
            return new PkValue(d);
        }
        case 0x1e:
            return fromVec(vCross(a.xyz, b.xyz));
        default: break;
    }
    const r = new PkValue();
    const ints = isIntKind(aOp.kind);
    const n = kindLanes(dst.kind);
    for (let l = 0; l < n; l++) {
        if (ints) {
            const x = a.int(l), y = b.int(l);
            r.setInt(l, sub === 0x1b ? Math.min(x, y) : sub === 0x1c ? Math.max(x, y) : x);
        } else {
            const x = a.lane(l), y = b.lane(l);
            switch (sub) {
                case 0x19: r.setLane(l, Math.pow(Math.max(x, 0), y)); break;
                case 0x1b: r.setLane(l, Math.min(x, y)); break;
                case 0x1c: r.setLane(l, Math.max(x, y)); break;
                default: r.setLane(l, x); break;
            }
        }
    }
    return r;
}

function cast(a: PkValue, from: number, to: number): PkValue {
    const r = new PkValue();
    const n = kindLanes(to);
    for (let l = 0; l < n; l++) {
        if (isBoolKind(from)) {
            const v = (kindLanes(from) === 1 ? a.int(0) : a.int(l)) !== 0;
            if (isIntKind(to)) r.setInt(l, v ? 1 : 0);
            else if (isBoolKind(to)) r.setInt(l, v ? -1 : 0);
            else r.setLane(l, v ? 1 : 0);
        } else if (isIntKind(from)) {
            const v = a.int(l);
            if (isIntKind(to)) r.setInt(l, v);
            else if (isBoolKind(to)) r.setInt(l, v !== 0 ? -1 : 0);
            else r.setLane(l, v);
        } else {
            const v = a.lane(l);
            if (isIntKind(to)) r.setInt(l, Math.trunc(v));
            else if (isBoolKind(to)) r.setInt(l, v !== 0 ? -1 : 0);
            else r.setLane(l, v);
        }
    }
    return r;
}

function rgb2Hsv(c: PkValue): PkValue {
    const r = c.x, g = c.y, b = c.z;
    const max = Math.max(r, Math.max(g, b));
    const min = Math.min(r, Math.min(g, b));
    const d = max - min;
    let h = 0;
    if (d > 1e-9) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
        if (h < 0) h += 1;
    }
    const s = max > 1e-9 ? d / max : 0;
    return new PkValue(h, s, max, c.w);
}

function hsv2Rgb(c: PkValue): PkValue {
    const h = c.x - Math.floor(c.x);
    const s = Math.min(Math.max(c.y, 0), 1);
    const v = c.z;
    const f = h * 6;
    const k = Math.floor(f);
    const fr = f - k;
    const p = v * (1 - s);
    const q = v * (1 - s * fr);
    const t = v * (1 - s * (1 - fr));
    let r: number, g: number, b: number;
    switch (((Math.trunc(k) % 6) + 6) % 6) {
        case 0: r = v; g = t; b = p; break;
        case 1: r = q; g = v; b = p; break;
        case 2: r = p; g = v; b = t; break;
        case 3: r = p; g = q; b = v; break;
        case 4: r = t; g = p; b = v; break;
        default: r = v; g = p; b = q; break;
    }
    return new PkValue(r, g, b, c.w);
}
