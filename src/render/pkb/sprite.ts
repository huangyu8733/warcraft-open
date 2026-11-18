// Sprite extraction: turns a running effect's particle pools into drawable cards in Warcraft III
// units. The simulation itself works in metres, so this is the only place where a length is
// multiplied by unitsPerMetre (50 for Reforged HD art).

import { PkEffectDef, PkRendererDef, PkRendererKind, PopcornBlend, PopcornBillboardMode } from './defs';
import { Vec3, vCross, vDistance, vDot, vLengthSq, vNormalize, vScale, vSub } from './math';
import { PkEffectInstance } from './runtime';

/** One drawable particle, in model units, ready for a renderer to turn into a quad. */
export interface PkSprite {
    position: Vec3;
    /** Half extents across and along the card (PopcornFX sizes are radii). */
    halfSize: { x: number; y: number };
    /** Axis-aligned modes: the full axis vector. Plane-aligned: the in-plane up vector. */
    axis: Vec3;
    /** Plane-aligned: the card's normal. */
    normal: Vec3;
    /** Screen-plane rotation, radians. */
    rotation: number;
    color: { x: number; y: number; z: number; w: number };
    frame: number;
}

/** What one renderer of one layer draws this frame. */
export class PkRenderBatch {
    readonly renderer: PkRendererDef;
    readonly layerName: string;
    readonly sprites: PkSprite[] = [];

    constructor(renderer: PkRendererDef, layerName: string) {
        this.renderer = renderer;
        this.layerName = layerName;
    }
}

/** One batch per renderer of every layer, in layer order. */
export function createRenderBatches(def: PkEffectDef): PkRenderBatch[] {
    const batches: PkRenderBatch[] = [];
    for (const layer of def.layers) {
        for (const renderer of layer.renderers) batches.push(new PkRenderBatch(renderer, layer.name));
    }
    return batches;
}

/**
 * Appends one running instance's sprites to the batch of each Billboard and Distortion renderer in
 * `batches` (a renderer with no batch is skipped), positions, sizes and axes scaled from the
 * simulation's metres by `unitsPerMetre`.
 */
export function collectSprites(instance: PkEffectInstance, batches: PkRenderBatch[], unitsPerMetre: number): void {
    const m = unitsPerMetre;
    for (const st of instance.slots) {
        if (st === null || st.count === 0) continue;
        for (const renderer of st.def.renderers) {
            if (renderer.kind !== PkRendererKind.Billboard && renderer.kind !== PkRendererKind.Distortion) continue;
            const batch = batches.find(b => b.renderer === renderer);
            if (batch === undefined) continue;
            const fPos = renderer.input('Position'), fSize = renderer.input('Size');
            const fSize2 = renderer.input('Size2'), fAxis = renderer.input('Axis');
            const fNormal = renderer.input('NormalAxis'), fRot = renderer.input('Rotation');
            const fCol = renderer.input('Color'), fEnabled = renderer.input('Enabled');
            const fTex = renderer.input('TextureID');
            for (let p = 0; p < st.count; p++) {
                if (fEnabled >= 0 && st.fieldValue(fEnabled, p).int(0) === 0) continue;
                let col = fCol >= 0 ? st.fieldValue(fCol, p).xyzw : { x: 1, y: 1, z: 1, w: 1 };
                if (renderer.kind === PkRendererKind.Distortion) col = { x: 1, y: 1, z: 1, w: 0.15 };
                if (col.w <= 0.002 && renderer.blend !== PopcornBlend.AdditiveNoAlpha) continue;
                let half: { x: number; y: number };
                if (renderer.size2D && fSize2 >= 0) {
                    const s2 = st.fieldValue(fSize2, p);
                    half = { x: s2.x, y: s2.y };
                } else {
                    const s = fSize >= 0 ? st.fieldValue(fSize, p).x : 1;
                    half = { x: s, y: s };
                }
                if (!(half.x > 0) && !(half.y > 0)) continue;
                const pos = fPos >= 0 ? st.fieldValue(fPos, p).xyz : { x: 0, y: 0, z: 0 };
                const axis = fAxis >= 0 ? st.fieldValue(fAxis, p).xyz : { x: 0, y: 0, z: 1 };
                batch.sprites.push({
                    position: vScale(pos, m),
                    halfSize: { x: half.x * m, y: half.y * m },
                    axis: vScale(axis, m),
                    normal: fNormal >= 0 ? st.fieldValue(fNormal, p).xyz : { x: 0, y: 0, z: 1 },
                    rotation: fRot >= 0 ? (st.fieldValue(fRot, p).x * Math.PI) / 180 : 0,
                    color: col,
                    frame: fTex >= 0 ? Math.trunc(Math.max(0, st.fieldValue(fTex, p).x)) : 0,
                });
            }
        }
    }
}

/** One vertex-row of a ribbon: a particle's centre, half width and along-length UV. */
export interface PkRibbonPoint {
    position: Vec3;
    /** Half width across the ribbon, renderer units. */
    halfWidth: number;
    /** Along-length texture coordinate (PopcornFX's `TextureU`). */
    u: number;
    color: { x: number; y: number; z: number; w: number };
}

/** What one ribbon renderer of one layer draws this frame: one point list per trail. */
export class PkRibbonBatch {
    readonly renderer: PkRendererDef;
    readonly layerName: string;
    readonly ribbons: PkRibbonPoint[][] = [];

    constructor(renderer: PkRendererDef, layerName: string) {
        this.renderer = renderer;
        this.layerName = layerName;
    }
}

/** One batch per ribbon renderer of every layer, in layer order. */
export function createRibbonBatches(def: PkEffectDef): PkRibbonBatch[] {
    const batches: PkRibbonBatch[] = [];
    for (const layer of def.layers) {
        for (const renderer of layer.renderers) {
            if (renderer.kind === PkRendererKind.Ribbon) batches.push(new PkRibbonBatch(renderer, layer.name));
        }
    }
    return batches;
}

/**
 * Appends one running instance's ribbons to the batch of each Ribbon renderer in `batches`.
 *
 * A ribbon renderer's particles are CROSS-SECTIONS of a trail. PopcornFX chains them with the
 * two engine-owned attributes `SelfID`/`ParentID`: every point a trail's emitter particle spawns
 * carries that particle's id as its `ParentID`, so all points sharing a `ParentID` form ONE
 * ribbon, ordered by their own `SelfID`. (The bake's scripts never write either attribute; the
 * runtime fills them in `PkEffectInstance.assignIds`.) A layer that binds neither falls back to
 * a single chain in pool order, which is the behaviour a whole-layer trail wants.
 *
 * Positions and widths leave here in renderer units (metres × `unitsPerMetre`), like
 * {@link collectSprites}.
 */
export function collectRibbons(instance: PkEffectInstance, batches: PkRibbonBatch[], unitsPerMetre: number): void {
    const m = unitsPerMetre;
    for (const st of instance.slots) {
        if (st === null || st.count === 0) continue;
        for (const renderer of st.def.renderers) {
            if (renderer.kind !== PkRendererKind.Ribbon) continue;
            const batch = batches.find(b => b.renderer === renderer);
            if (batch === undefined) continue;
            const fPos = renderer.input('Position'), fSize = renderer.input('Size');
            const fSize2 = renderer.input('Size2'), fCol = renderer.input('Color');
            const fEnabled = renderer.input('Enabled'), fTexU = renderer.input('TextureU');
            const fSelf = renderer.input('SelfID'), fParent = renderer.input('ParentID');
            const linked = fSelf >= 0 && fParent >= 0;

            const groups = new Map<number, { id: number; particle: number }[]>();
            for (let p = 0; p < st.count; p++) {
                if (fEnabled >= 0 && st.fieldValue(fEnabled, p).int(0) === 0) continue;
                const col = fCol >= 0 ? st.fieldValue(fCol, p).xyzw : { x: 1, y: 1, z: 1, w: 1 };
                if (col.w <= 0.002 && renderer.blend !== PopcornBlend.AdditiveNoAlpha) continue;
                let half: number;
                if (renderer.size2D && fSize2 >= 0) {
                    const s2 = st.fieldValue(fSize2, p);
                    half = (s2.x + s2.y) * 0.5;
                } else {
                    half = fSize >= 0 ? st.fieldValue(fSize, p).x : 1;
                }
                if (!(half > 0)) continue;
                const key = linked ? st.fieldValue(fParent, p).int(0) : 0;
                const id = linked ? st.fieldValue(fSelf, p).int(0) : p;
                let group = groups.get(key);
                if (group === undefined) groups.set(key, group = []);
                group.push({ id, particle: p });
            }

            for (const group of groups.values()) {
                if (group.length < 2) continue;
                group.sort((a, b) => a.id - b.id);
                const ribbon: PkRibbonPoint[] = [];
                let u = 0;
                let last: Vec3 | null = null;
                let lastHalf = 0;
                for (const { particle } of group) {
                    const pos = vScale(
                        fPos >= 0 ? st.fieldValue(fPos, particle).xyz : { x: 0, y: 0, z: 0 }, m);
                    const half = (renderer.size2D && fSize2 >= 0
                        ? (st.fieldValue(fSize2, particle).x + st.fieldValue(fSize2, particle).y) * 0.5
                        : fSize >= 0 ? st.fieldValue(fSize, particle).x : 1) * m;
                    if (fTexU >= 0) {
                        u = st.fieldValue(fTexU, particle).x;
                    } else if (last !== null) {
                        // No authored U: advance one texture repeat per ribbon diameter so the
                        // detail stays put as the trail grows instead of sliding along it.
                        u += vDistance(last, pos) / Math.max(1e-3, half + lastHalf);
                    }
                    ribbon.push({
                        position: pos,
                        halfWidth: half,
                        u,
                        color: fCol >= 0 ? st.fieldValue(fCol, particle).xyzw : { x: 1, y: 1, z: 1, w: 1 },
                    });
                    last = pos;
                    lastHalf = half;
                }
                batch.ribbons.push(ribbon);
            }
        }
    }
}

/**
 * The card's half-extent vectors: its corners are `centre +/- r +/- u`, and the texture cell maps
 * (u0,v1) to `centre - r - u`, (u1,v1) to `+r - u`, (u1,v0) to `+r + u` and (u0,v0) to `-r + u`.
 *
 * @param right Camera right, unit.
 * @param up Camera up, unit.
 * @param look Camera look, `Cross(up, right)`.
 */
export function spriteQuad(
    s: PkSprite, mode: PopcornBillboardMode, right: Vec3, up: Vec3, look: Vec3,
): { r: Vec3; u: Vec3 } {
    switch (mode) {
        case PopcornBillboardMode.AxisAligned:
        case PopcornBillboardMode.AxisAlignedSpheroid:
        case PopcornBillboardMode.AxisAlignedCapsule: {
            // A card along its axis, turned about it to face the camera; the spheroid and capsule
            // modes round the ends off with the radius.
            const axis = s.axis;
            const len = Math.sqrt(vLengthSq(axis));
            const dir = len > 1e-5 ? vScale(axis, 1 / len) : { x: 0, y: 0, z: 1 };
            let side = vCross(dir, look);
            side = vLengthSq(side) > 1e-8 ? vNormalize(side) : right;
            const r = vScale(side, s.halfSize.x);
            const u = vScale(dir, len * 0.5 + (mode === PopcornBillboardMode.AxisAligned ? 0 : s.halfSize.x));
            return { r, u };
        }
        case PopcornBillboardMode.PlaneAligned: {
            // A card lying in the plane of its normal, its up along the axis projected into it.
            const n = vLengthSq(s.normal) > 1e-8 ? vNormalize(s.normal) : { x: 0, y: 0, z: 1 };
            let a = vSub(s.axis, vScale(n, vDot(s.axis, n)));
            if (vLengthSq(a) < 1e-8) {
                a = Math.abs(n.z) < 0.9 ? vCross(n, { x: 0, y: 0, z: 1 }) : vCross(n, { x: 1, y: 0, z: 0 });
            }
            a = vNormalize(a);
            const side = vNormalize(vCross(a, n));
            const cos = Math.cos(s.rotation), sin = Math.sin(s.rotation);
            const r = vScale({ x: side.x * cos + a.x * sin, y: side.y * cos + a.y * sin, z: side.z * cos + a.z * sin }, s.halfSize.x);
            const u = vScale({ x: a.x * cos - side.x * sin, y: a.y * cos - side.y * sin, z: a.z * cos - side.z * sin }, s.halfSize.y);
            return { r, u };
        }
        default: {
            // Screen- or viewpos-aligned: in the camera plane, turned by the sprite's rotation.
            const cos = Math.cos(s.rotation), sin = Math.sin(s.rotation);
            const r = vScale({
                x: right.x * cos + up.x * sin,
                y: right.y * cos + up.y * sin,
                z: right.z * cos + up.z * sin,
            }, s.halfSize.x);
            const u = vScale({
                x: up.x * cos - right.x * sin,
                y: up.y * cos - right.y * sin,
                z: up.z * cos - right.z * sin,
            }, s.halfSize.y);
            return { r, u };
        }
    }
}

/** The sheet cell a frame index picks, row-major from the top left: (u0, v0, u1, v1). */
export function spriteCellUv(frame: number, columns: number, rows: number): { u0: number; v0: number; u1: number; v1: number } {
    const cols = Math.max(1, columns), rowCount = Math.max(1, rows);
    const cells = cols * rowCount;
    let f = frame % cells;
    if (f < 0) f += cells;
    const u0 = (f % cols) / cols;
    const v0 = Math.floor(f / cols) / rowCount;
    return { u0, v0, u1: u0 + 1 / cols, v1: v0 + 1 / rowCount };
}
