// Typed definitions of the executable content of a PopcornFX bake: curves and shapes, samplers,
// renderers, layers and the layer graph.

import { PkRandom, Quat, Vec3, vAdd, qFromYawPitchRoll, qRotate } from './math';
import { PkScript, PkValue } from './script';

export enum PopcornBillboardMode {
    ScreenAligned = 0,
    ViewposAligned = 1,
    AxisAligned = 2,
    AxisAlignedSpheroid = 3,
    AxisAlignedCapsule = 4,
    PlaneAligned = 5,
}

export enum PopcornBlend {
    Additive = 0,
    AdditiveNoAlpha = 1,
    AlphaBlend = 2,
    Premultiplied = 3,
}

export enum PkRendererKind {
    Billboard,
    Ribbon,
    Distortion,
    Light,
    Other,
}

export enum PkSamplerKind {
    Unknown,
    Curve,
    Shape,
    EventStream,
    Turbulence,
    Spectrum,
}

/** A curve sampler: knots in 0..1, `dimension` values per knot, cubic Hermite with in/out tangents. */
export class PkCurve {
    dimension: number;
    times: number[];
    values: number[];
    /** `knots * 2 * dimension`: per knot, the in tangent then the out tangent; empty for linear. */
    tangents: number[];

    constructor(dimension: number, times: number[], values: number[], tangents: number[]) {
        this.dimension = dimension;
        this.times = times;
        this.values = values;
        this.tangents = tangents;
    }

    sample(t: number): PkValue {
        const r = new PkValue();
        const n = this.times.length;
        if (n === 0) return r;
        let x = t;
        if (!Number.isFinite(x)) x = 0;
        if (n === 1 || x <= this.times[0]) { this.knot(0, r); return r; }
        if (x >= this.times[n - 1]) { this.knot(n - 1, r); return r; }
        let k = 0;
        while (k + 2 < n && this.times[k + 1] <= x) k++;
        const span = this.times[k + 1] - this.times[k];
        const u = span > 1e-9 ? (x - this.times[k]) / span : 0;
        const u2 = u * u, u3 = u2 * u;
        const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u;
        const h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
        const hermite = this.tangents.length >= n * 2 * this.dimension;
        for (let d = 0; d < this.dimension && d < 4; d++) {
            const p0 = this.values[k * this.dimension + d];
            const p1 = this.values[(k + 1) * this.dimension + d];
            if (!hermite) { r.setLane(d, p0 + (p1 - p0) * u); continue; }
            const m0 = this.tangents[k * 2 * this.dimension + this.dimension + d];
            const m1 = this.tangents[(k + 1) * 2 * this.dimension + d];
            r.setLane(d, h00 * p0 + h10 * m0 * span + h01 * p1 + h11 * m1 * span);
        }
        return r;
    }

    private knot(k: number, r: PkValue): void {
        for (let d = 0; d < this.dimension && d < 4; d++) r.setLane(d, this.values[k * this.dimension + d]);
    }
}

/** A shape sampler. Types are PopcornFX 2's: 0 box, 1 sphere, 2 ellipsoid, 3 cylinder, 4 capsule, 5 cone, 6 mesh. */
export class PkShape {
    type: number;
    radius: number;
    innerRadius: number;
    height: number;
    /** Field 13. Stored in PopcornFX's Y-up shape frame; applied here with Y and Z swapped. */
    offset: Vec3;
    /** Field 14: Euler angles in degrees. */
    eulerDegrees: Vec3;

    constructor(type = 0, radius = 1, innerRadius = 0, height = 1, offset: Vec3 = { x: 0, y: 0, z: 0 }, eulerDegrees: Vec3 = { x: 0, y: 0, z: 0 }) {
        this.type = type;
        this.radius = radius;
        this.innerRadius = innerRadius;
        this.height = height;
        this.offset = offset;
        this.eulerDegrees = eulerDegrees;
    }

    /** A point in the shape's volume, in the effect's Z-up frame. */
    samplePosition(rng: PkRandom): Vec3 {
        const u = (): number => rng.next();
        let p: Vec3;
        switch (this.type) {
            case 1:
            case 2: {
                const dir = randomUnit(rng);
                const r = radial(u(), this.innerRadius, this.radius, 3);
                p = { x: dir.x * r, y: dir.y * r, z: dir.z * r };
                break;
            }
            case 3: {
                const a = u() * Math.PI * 2;
                const r = radial(u(), this.innerRadius, this.radius, 2);
                p = { x: Math.cos(a) * r, y: (u() - 0.5) * this.height, z: Math.sin(a) * r };
                break;
            }
            case 4: {
                const a = u() * Math.PI * 2;
                const r = radial(u(), this.innerRadius, this.radius, 2);
                p = { x: Math.cos(a) * r, y: (u() - 0.5) * (this.height + 2 * this.radius), z: Math.sin(a) * r };
                break;
            }
            case 5: {
                const h = u();
                const a = u() * Math.PI * 2;
                const r = radial(u(), 0, this.radius * h, 2);
                p = { x: Math.cos(a) * r, y: h * this.height, z: Math.sin(a) * r };
                break;
            }
            case 0:
                p = {
                    x: (u() - 0.5) * this.radius,
                    y: (u() - 0.5) * this.height,
                    z: (u() - 0.5) * this.radius,
                };
                break;
            default:
                p = { x: 0, y: 0, z: 0 };
                break;
        }
        const e = this.eulerDegrees;
        if (e.x !== 0 || e.y !== 0 || e.z !== 0) {
            const q: Quat = qFromYawPitchRoll(degToRad(e.y), degToRad(e.x), degToRad(e.z));
            p = qRotate(p, q);
        }
        p = vAdd(p, this.offset);
        return { x: p.x, y: p.z, z: p.y };
    }
}

function degToRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
}

function radial(u: number, inner: number, outer: number, dims: number): number {
    const clampedInner = Math.min(Math.max(inner, 0), Math.max(outer, 0));
    if (outer <= 0) return 0;
    const a = Math.pow(clampedInner / outer, dims);
    const f = a + (1 - a) * u;
    return outer * (dims === 3 ? Math.cbrt(f) : Math.sqrt(f));
}

export function randomUnit(rng: PkRandom): Vec3 {
    const z = rng.next() * 2 - 1;
    const a = rng.next() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    return { x: s * Math.cos(a), y: s * Math.sin(a), z };
}

export class PkSampler {
    name: string;
    kind: PkSamplerKind;
    curve: PkCurve | null = null;
    shape: PkShape | null = null;
    /** Event times of an EventStream sampler, in seconds of effect age. */
    eventTimes: number[] = [];
    /** Turbulence: noise wavelength in metres (record field 11; 1 by default). */
    wavelength = 1;
    /** Turbulence: displacement amplitude (field 12; 1 by default). */
    strength = 1;

    constructor(name: string, kind: PkSamplerKind) {
        this.name = name;
        this.kind = kind;
    }
}

/** A particle field bound to each renderer input. */
export class PkRendererDef {
    kind: PkRendererKind;
    material: string;
    texture: string;
    billboard: PopcornBillboardMode;
    blend: PopcornBlend;
    atlasColumns: number;
    atlasRows: number;
    size2D: boolean;
    flipUVs: boolean;
    /** Renderer record field 4: lower values draw first. */
    drawOrder: number;
    /**
     * Particle field index bound to each renderer input: Position, Size, Size2, Axis, NormalAxis,
     * Rotation, Color, TextureID, Enabled, SelfID, ParentID and named inputs.
     */
    readonly inputs = new Map<string, number>();

    constructor(init: {
        kind: PkRendererKind;
        material: string;
        texture: string;
        billboard: PopcornBillboardMode;
        blend: PopcornBlend;
        atlasColumns: number;
        atlasRows: number;
        size2D: boolean;
        flipUVs: boolean;
        drawOrder: number;
    }) {
        this.kind = init.kind;
        this.material = init.material;
        this.texture = init.texture;
        this.billboard = init.billboard;
        this.blend = init.blend;
        this.atlasColumns = init.atlasColumns;
        this.atlasRows = init.atlasRows;
        this.size2D = init.size2D;
        this.flipUVs = init.flipUVs;
        this.drawOrder = init.drawOrder;
    }

    input(name: string): number {
        const i = this.inputs.get(name);
        return i === undefined ? -1 : i;
    }
}

export class PkFieldDef {
    name: string;
    /** The operand kind the field holds (the bake stores kind - 1). */
    kind: number;

    constructor(name: string, kind: number) {
        this.name = name;
        this.kind = kind;
    }
}

export class PkLayerDef {
    record: number;
    name = '';
    readonly fields: PkFieldDef[] = [];
    readonly fieldIndex = new Map<string, number>();
    spawn: PkScript | null = null;
    evolveOnSpawn: PkScript | null = null;
    evolve: PkScript | null = null;
    readonly samplers: PkSampler[] = [];
    readonly renderers: PkRendererDef[] = [];
    /**
     * For each event this layer fires, the payload names in the order its scripts append them
     * (`appendPayload` index -> name).
     */
    readonly outputPayloads = new Map<string, string[]>();
    /**
     * The payloads this layer's scripts read, in `extractPayloadElement` index order. A child
     * reads by name, not by the order its parent appended them.
     */
    inputPayloads: string[] = [];
    /** Names of the spatial layers `__spatialLayer_N` refers to, in N order. */
    spatialLayers: string[] = [];

    constructor(record: number) {
        this.record = record;
    }

    field(name: string): number {
        const i = this.fieldIndex.get(name);
        return i === undefined ? -1 : i;
    }

    sampler(name: string): PkSampler | null {
        return this.samplers.find(s => s.name === name) ?? null;
    }
}

export class PkLayerSlot {
    layer: number;
    inputEvents: number[];
    outputEvents: number[];

    constructor(layer: number, inputEvents: number[], outputEvents: number[]) {
        this.layer = layer;
        this.inputEvents = inputEvents;
        this.outputEvents = outputEvents;
    }
}

export class PkEventSlot {
    name: string;
    targetSlots: number[];

    constructor(name = '', targetSlots: number[] = []) {
        this.name = name;
        this.targetSlots = targetSlots;
    }
}

/**
 * The executable content of a PopcornFX bake: its layers with their compiled scripts, samplers and
 * renderers, and the graph that says which layer's events spawn which.
 */
export class PkEffectDef {
    readonly layers: PkLayerDef[] = [];
    readonly slots: PkLayerSlot[] = [];
    readonly events: PkEventSlot[] = [];
    readonly warnings: string[] = [];
}
