// Small vector/quaternion/matrix helpers for the PopcornFX runtime.
//
// Matrices are row-major (m[row * 4 + col]) and transform row vectors, matching the convention of
// the C# port this is derived from: `p * (A * B)` applies A first, and translation lives in
// m[3], m[7], m[11].

export interface Vec3 {
    x: number;
    y: number;
    z: number;
}

export interface Quat {
    x: number;
    y: number;
    z: number;
    w: number;
}

export type Mat4 = number[];

export function vec3(x = 0, y = 0, z = 0): Vec3 {
    return { x, y, z };
}

export function vAdd(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function vSub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function vScale(a: Vec3, s: number): Vec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function vDot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vCross(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

export function vLengthSq(a: Vec3): number {
    return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function vLength(a: Vec3): number {
    return Math.sqrt(vLengthSq(a));
}

export function vNormalize(a: Vec3, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 {
    const lenSq = vLengthSq(a);
    if (lenSq <= 1e-12) return { ...fallback };
    const inv = 1 / Math.sqrt(lenSq);
    return { x: a.x * inv, y: a.y * inv, z: a.z * inv };
}

export function vDistanceSq(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

export function vDistance(a: Vec3, b: Vec3): number {
    return Math.sqrt(vDistanceSq(a, b));
}

export function qIdentity(): Quat {
    return { x: 0, y: 0, z: 0, w: 1 };
}

export function qLengthSq(q: Quat): number {
    return q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w;
}

export function qNormalize(q: Quat): Quat {
    const lenSq = qLengthSq(q);
    if (lenSq <= 1e-12) return qIdentity();
    const inv = 1 / Math.sqrt(lenSq);
    return { x: q.x * inv, y: q.y * inv, z: q.z * inv, w: q.w * inv };
}

/** Hamilton product: the rotation `b` followed by `a`. */
export function qMultiply(a: Quat, b: Quat): Quat {
    return {
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
}

export function qFromAxisAngle(axis: Vec3, radians: number): Quat {
    const lenSq = vLengthSq(axis);
    if (lenSq <= 1e-12) return qIdentity();
    const inv = 1 / Math.sqrt(lenSq);
    const s = Math.sin(radians * 0.5);
    return {
        x: axis.x * inv * s,
        y: axis.y * inv * s,
        z: axis.z * inv * s,
        w: Math.cos(radians * 0.5),
    };
}

export function qFromYawPitchRoll(yaw: number, pitch: number, roll: number): Quat {
    const qy = qFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
    const qx = qFromAxisAngle({ x: 1, y: 0, z: 0 }, pitch);
    const qz = qFromAxisAngle({ x: 0, y: 0, z: 1 }, roll);
    return qMultiply(qMultiply(qy, qx), qz);
}

/** Rotates `v` by `q` (v' = q v q*). */
export function qRotate(v: Vec3, q: Quat): Vec3 {
    const x2 = q.x + q.x, y2 = q.y + q.y, z2 = q.z + q.z;
    const xx = q.x * x2, xy = q.x * y2, xz = q.x * z2;
    const yy = q.y * y2, yz = q.y * z2, zz = q.z * z2;
    const wx = q.w * x2, wy = q.w * y2, wz = q.w * z2;
    return {
        x: v.x * (1 - (yy + zz)) + v.y * (xy - wz) + v.z * (xz + wy),
        y: v.x * (xy + wz) + v.y * (1 - (xx + zz)) + v.z * (yz - wx),
        z: v.x * (xz - wy) + v.y * (yz + wx) + v.z * (1 - (xx + yy)),
    };
}

export function matIdentity(): Mat4 {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function matFromTranslation(x: number, y: number, z: number): Mat4 {
    return [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
}

export function matFromScale(s: number): Mat4 {
    return [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];
}

export function matFromQuat(q: Quat): Mat4 {
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const xx = x * x, yy = y * y, zz = z * z;
    const xy = x * y, xz = x * z, yz = y * z;
    const wx = w * x, wy = w * y, wz = w * z;
    return [
        1 - 2 * (yy + zz), 2 * (xy + wz), 2 * (xz - wy), 0,
        2 * (xy - wz), 1 - 2 * (xx + zz), 2 * (yz + wx), 0,
        2 * (xz + wy), 2 * (yz - wx), 1 - 2 * (xx + yy), 0,
        0, 0, 0, 1,
    ];
}

export function matMul(a: Mat4, b: Mat4): Mat4 {
    const out = new Array<number>(16);
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            out[r * 4 + c] =
                a[r * 4] * b[c] +
                a[r * 4 + 1] * b[4 + c] +
                a[r * 4 + 2] * b[8 + c] +
                a[r * 4 + 3] * b[12 + c];
        }
    }
    return out;
}

export function matTransformPoint(m: Mat4, v: Vec3): Vec3 {
    const x = v.x * m[0] + v.y * m[4] + v.z * m[8] + m[12];
    const y = v.x * m[1] + v.y * m[5] + v.z * m[9] + m[13];
    const z = v.x * m[2] + v.y * m[6] + v.z * m[10] + m[14];
    const w = v.x * m[3] + v.y * m[7] + v.z * m[11] + m[15];
    if (w !== 0 && w !== 1) return { x: x / w, y: y / w, z: z / w };
    return { x, y, z };
}

export function matTransformNormal(m: Mat4, v: Vec3): Vec3 {
    return {
        x: v.x * m[0] + v.y * m[4] + v.z * m[8],
        y: v.x * m[1] + v.y * m[5] + v.z * m[9],
        z: v.x * m[2] + v.y * m[6] + v.z * m[10],
    };
}

/** Gauss-Jordan inverse; null when the matrix is singular. */
export function matInvert(m: Mat4): Mat4 | null {
    const a: number[][] = [];
    for (let r = 0; r < 4; r++) {
        a.push([m[r * 4], m[r * 4 + 1], m[r * 4 + 2], m[r * 4 + 3], r === 0 ? 1 : 0, r === 1 ? 1 : 0, r === 2 ? 1 : 0, r === 3 ? 1 : 0]);
    }
    for (let col = 0; col < 4; col++) {
        let pivot = col;
        for (let r = col + 1; r < 4; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
        if (Math.abs(a[pivot][col]) < 1e-12) return null;
        if (pivot !== col) { const t = a[pivot]; a[pivot] = a[col]; a[col] = t; }
        const inv = 1 / a[col][col];
        for (let c = 0; c < 8; c++) a[col][c] *= inv;
        for (let r = 0; r < 4; r++) {
            if (r === col) continue;
            const f = a[r][col];
            if (f === 0) continue;
            for (let c = 0; c < 8; c++) a[r][c] -= f * a[col][c];
        }
    }
    const out = new Array<number>(16);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[r * 4 + c] = a[r][4 + c];
    return out;
}

export function matTranslation(m: Mat4): Vec3 {
    return { x: m[3], y: m[7], z: m[11] };
}

/** Deterministic per-lane RNG (mulberry32). */
export class PkRandom {
    private state: number;

    constructor(seed: number) {
        this.state = (seed >>> 0) || 0x9e3779b9;
    }

    next(): number {
        let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}
