// The PopcornFX 2 compiled-script record and its bytecode decoder.
//
// Every `CCompilerBlobCache` record in a bake holds one compiled script. Field 2 is a word array
// that is really bytes: a u32[9] header, a constant table of 32-byte (8 SIMD lane) entries, then
// the code. The instruction set is twelve opcodes with no jumps; branches compile to select.
// See mdxres/research/popcornfx-vm.md for how the encoding was established.

import type { Vec3 } from './math';
import type { PkBakeFile } from './container';

const scratchF = new Float32Array(1);
const scratchI = new Int32Array(scratchF.buffer);

function floatToBits(v: number): number {
    scratchF[0] = v;
    return scratchI[0];
}

function bitsToFloat(bits: number): number {
    scratchI[0] = bits;
    return scratchF[0];
}

/**
 * One VM value: four 32-bit lanes read as floats or integers by the operand's kind. Booleans are
 * all-ones masks. Lanes are stored as raw 32-bit words so both views are exact.
 */
export class PkValue {
    private b0: number;
    private b1: number;
    private b2: number;
    private b3: number;

    constructor(x = 0, y = 0, z = 0, w = 0) {
        this.b0 = floatToBits(x);
        this.b1 = floatToBits(y);
        this.b2 = floatToBits(z);
        this.b3 = floatToBits(w);
    }

    copyFrom(v: PkValue): void {
        this.b0 = v.b0;
        this.b1 = v.b1;
        this.b2 = v.b2;
        this.b3 = v.b3;
    }

    clone(): PkValue {
        const v = new PkValue();
        v.copyFrom(this);
        return v;
    }

    get x(): number { return bitsToFloat(this.b0); }
    set x(v: number) { this.b0 = floatToBits(v); }
    get y(): number { return bitsToFloat(this.b1); }
    set y(v: number) { this.b1 = floatToBits(v); }
    get z(): number { return bitsToFloat(this.b2); }
    set z(v: number) { this.b2 = floatToBits(v); }
    get w(): number { return bitsToFloat(this.b3); }
    set w(v: number) { this.b3 = floatToBits(v); }

    lane(l: number): number {
        switch (l) {
            case 0: return bitsToFloat(this.b0);
            case 1: return bitsToFloat(this.b1);
            case 2: return bitsToFloat(this.b2);
            default: return bitsToFloat(this.b3);
        }
    }

    setLane(l: number, v: number): void {
        const bits = floatToBits(v);
        switch (l) {
            case 0: this.b0 = bits; break;
            case 1: this.b1 = bits; break;
            case 2: this.b2 = bits; break;
            default: this.b3 = bits; break;
        }
    }

    get xyz(): Vec3 {
        return { x: this.x, y: this.y, z: this.z };
    }

    get xyzw(): Vec3 & { w: number } {
        return { x: this.x, y: this.y, z: this.z, w: this.w };
    }

    int(l: number): number {
        switch (l) {
            case 0: return this.b0;
            case 1: return this.b1;
            case 2: return this.b2;
            default: return this.b3;
        }
    }

    setInt(l: number, v: number): void {
        const bits = v | 0;
        switch (l) {
            case 0: this.b0 = bits; break;
            case 1: this.b1 = bits; break;
            case 2: this.b2 = bits; break;
            default: this.b3 = bits; break;
        }
    }
}

/** Where an operand lives. Measured over 54,716 scripts. */
export enum PkSpace {
    Const = 0x00,
    Reg1 = 0x01,
    Reg2 = 0x02,
    Reg3 = 0x03,
    Zero = 0x10,
    None = 0xff,
}

/** Value kinds carried by every operand. Bool masks, ints and floats of 1-4 lanes. */
export const PkKind = {
    Ptr: 0x00,
    Bool: 0x02,
    Bool2: 0x03,
    Bool3: 0x04,
    Bool4: 0x05,
    Int: 0x1a,
    Int2: 0x1b,
    Int3: 0x1c,
    Int4: 0x1d,
    Float: 0x20,
    Float2: 0x21,
    Float3: 0x22,
    Float4: 0x23,
    Float3Normalized: 0x24,
    Quaternion: 0x25,
};

export function isIntKind(k: number): boolean {
    return k >= PkKind.Int && k <= PkKind.Int4;
}

export function isBoolKind(k: number): boolean {
    return k >= PkKind.Bool && k <= PkKind.Bool4;
}

export function kindLanes(k: number): number {
    if (k >= PkKind.Bool && k <= PkKind.Bool4) return k - PkKind.Bool + 1;
    if (k >= PkKind.Int && k <= PkKind.Int4) return k - PkKind.Int + 1;
    if (k >= PkKind.Float && k <= PkKind.Float4) return k - PkKind.Float + 1;
    if (k === PkKind.Float3Normalized || k === PkKind.Quaternion) return 4;
    return 1;
}

export interface PkOperand {
    index: number;
    space: PkSpace;
    kind: number;
}

export function kindLanesOf(o: PkOperand): number {
    return kindLanes(o.kind);
}

export function isNoneOperand(o: PkOperand): boolean {
    return o.space === PkSpace.None;
}

export const NONE_OPERAND: PkOperand = { index: 0, space: PkSpace.None, kind: PkKind.Ptr };

export enum PkOp {
    Load = 0x43,
    Store = 0x44,
    CastA = 0x4a,
    CastB = 0x4b,
    Vector = 0x4c,
    Swizzle = 0x4d,
    Binary = 0x4e,
    Unary = 0x4f,
    Binary2 = 0x50,
    Ternary = 0x51,
    Select = 0x52,
    Call = 0x53,
}

export interface PkInstruction {
    op: PkOp;
    sub: number;
    dst: PkOperand;
    a: PkOperand;
    b: PkOperand;
    c: PkOperand;
    /** Load/Store external slot; Call function index. */
    slot: number;
    /** Call: external slot of the object (0xffff = free function). */
    thisSlot: number;
    argStart: number;
    argCount: number;
    swizzle: number;
    components: PkOperand[] | null;
}

/** A compiled PopcornFX script (one `CCompilerBlobCache`) decoded into instructions. */
export class PkScript {
    /** Field 1 of the blob: null = spawn, 3 = evolve on the frame of spawn, 4 = evolve. */
    kind: number | null;
    consts: PkValue[];
    code: PkInstruction[];
    args: PkOperand[];
    argFlags: number[];
    externalNames: string[];
    externalTypes: string[];
    functionNames: string[];
    reg1Count: number;
    reg2Count: number;
    reg3Count: number;

    private constructor(init: {
        kind: number | null;
        consts: PkValue[];
        code: PkInstruction[];
        args: PkOperand[];
        argFlags: number[];
        externalNames: string[];
        externalTypes: string[];
        functionNames: string[];
        reg1Count: number;
        reg2Count: number;
        reg3Count: number;
    }) {
        this.kind = init.kind;
        this.consts = init.consts;
        this.code = init.code;
        this.args = init.args;
        this.argFlags = init.argFlags;
        this.externalNames = init.externalNames;
        this.externalTypes = init.externalTypes;
        this.functionNames = init.functionNames;
        this.reg1Count = init.reg1Count;
        this.reg2Count = init.reg2Count;
        this.reg3Count = init.reg3Count;
    }

    static decode(b: PkBakeFile, blobRecord: number): PkScript {
        const words = b.arrayBytes(blobRecord, 2);
        if (words.length < 36) throw new Error(`blob #${blobRecord} is too short`);
        const view = new DataView(words.buffer, words.byteOffset, words.byteLength);
        const constLen = view.getInt32(8, true);
        const codeLen = view.getInt32(12, true);
        if (constLen < 0 || codeLen < 0 || 36 + constLen + codeLen > words.length) {
            throw new Error(`blob #${blobRecord} sections overrun`);
        }

        const consts: PkValue[] = [];
        const constCount = Math.floor(constLen / 32);
        for (let i = 0; i < constCount; i++) {
            const at = 36 + i * 32;
            consts.push(new PkValue(
                view.getFloat32(at, true),
                view.getFloat32(at + 4, true),
                view.getFloat32(at + 8, true),
                view.getFloat32(at + 12, true),
            ));
        }

        const externalNames: string[] = [];
        const externalTypes: string[] = [];
        for (const e of b.refs(blobRecord, 3)) {
            externalNames.push(e < 0 ? '' : b.string(e, 0));
            externalTypes.push(e < 0 ? '' : b.string(e, 1));
        }
        const functionNames = b.refs(blobRecord, 4).map(f => (f < 0 ? '' : b.string(f, 0)));

        const instrs: PkInstruction[] = [];
        const args: PkOperand[] = [];
        const argFlags: number[] = [];
        let max1 = 0, max2 = 0, max3 = 0;

        const operand = (at: number): PkOperand => {
            const o: PkOperand = {
                index: view.getUint16(at, true),
                space: words[at + 2] as PkSpace,
                kind: words[at + 3],
            };
            switch (o.space) {
                case PkSpace.Reg1: if (o.index + 1 > max1) max1 = o.index + 1; break;
                case PkSpace.Reg2: if (o.index + 1 > max2) max2 = o.index + 1; break;
                case PkSpace.Reg3: if (o.index + 1 > max3) max3 = o.index + 1; break;
            }
            return o;
        };

        const codeStart = 36 + constLen;
        const codeEnd = codeStart + codeLen;
        let p = codeStart;
        while (p < codeEnd) {
            const op = words[p] as PkOp;
            const ins: PkInstruction = {
                op, sub: 0,
                dst: NONE_OPERAND, a: NONE_OPERAND, b: NONE_OPERAND, c: NONE_OPERAND,
                slot: 0, thisSlot: 0xffff, argStart: 0, argCount: 0,
                swizzle: 0, components: null,
            };
            let len: number;
            switch (op) {
                case PkOp.Load:
                case PkOp.Store:
                    ins.dst = operand(p + 1);
                    ins.slot = view.getUint16(p + 5, true);
                    len = 7;
                    break;
                case PkOp.CastA:
                case PkOp.CastB:
                    ins.dst = operand(p + 1);
                    ins.a = operand(p + 5);
                    len = 9;
                    break;
                case PkOp.Vector: {
                    const n = words[p + 1] + 1;
                    ins.dst = operand(p + 2);
                    ins.components = [];
                    for (let k = 0; k < n; k++) ins.components.push(operand(p + 6 + 4 * k));
                    len = 2 + 4 * (n + 1);
                    break;
                }
                case PkOp.Swizzle:
                    ins.swizzle = words[p + 1] | (words[p + 2] << 8) | (words[p + 3] << 16);
                    ins.dst = operand(p + 4);
                    ins.a = operand(p + 8);
                    len = 12;
                    break;
                case PkOp.Binary:
                case PkOp.Binary2:
                    ins.sub = words[p + 1];
                    ins.dst = operand(p + 2);
                    ins.a = operand(p + 6);
                    ins.b = operand(p + 10);
                    len = 14;
                    break;
                case PkOp.Unary:
                    ins.sub = words[p + 1];
                    ins.dst = operand(p + 2);
                    ins.a = operand(p + 6);
                    len = 10;
                    break;
                case PkOp.Ternary:
                    ins.sub = words[p + 1];
                    ins.dst = operand(p + 2);
                    ins.a = operand(p + 6);
                    ins.b = operand(p + 10);
                    ins.c = operand(p + 14);
                    len = 18;
                    break;
                case PkOp.Select:
                    ins.dst = operand(p + 1);
                    ins.a = operand(p + 5);
                    ins.b = operand(p + 9);
                    ins.c = operand(p + 13);
                    len = 17;
                    break;
                case PkOp.Call: {
                    ins.sub = words[p + 1];
                    ins.thisSlot = view.getUint16(p + 2, true);
                    ins.slot = view.getUint16(p + 4, true);
                    ins.argCount = words[p + 6];
                    ins.dst = operand(p + 7);
                    ins.argStart = args.length;
                    for (let k = 0; k < ins.argCount; k++) {
                        argFlags.push(words[p + 11 + 5 * k]);
                        args.push(operand(p + 12 + 5 * k));
                    }
                    len = 11 + 5 * ins.argCount;
                    break;
                }
                default:
                    throw new Error(`blob #${blobRecord}: unknown opcode 0x${(op as number).toString(16).toUpperCase()} at ${p - codeStart}`);
            }
            if (p + len > codeEnd) throw new Error(`blob #${blobRecord}: instruction at ${p - codeStart} overruns the code`);
            instrs.push(ins);
            p += len;
        }

        return new PkScript({
            kind: b.has(blobRecord, 1) ? b.i32(blobRecord, 1) : null,
            consts, code: instrs, args, argFlags,
            externalNames, externalTypes, functionNames,
            reg1Count: max1, reg2Count: max2, reg3Count: max3,
        });
    }

    /**
     * Decodes a swizzle's packed lane codes: lane 0 takes 3 bits at bit 8, lane 1 at bit 11,
     * lane 2 takes 2 bits at bit 14 with a constant flag at bit 20, lane 3 at bit 21. Codes 0-3
     * select a source lane, 4 is 0.0, 5 is 1.0.
     */
    static laneCode(packed: number, lane: number): number {
        switch (lane) {
            case 0: return (packed >> 8) & 7;
            case 1: return (packed >> 11) & 7;
            case 2: return ((packed >> 20) & 1) !== 0 ? 4 + ((packed >> 14) & 3) : (packed >> 14) & 3;
            default: return (packed >> 21) & 7;
        }
    }
}
