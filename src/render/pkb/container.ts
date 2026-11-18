// Reads a PopcornFX 2 `.pkb` bake: the 28-byte header, the class table, the records and the string
// table, with typed field access.
//
// Container layout:
//   0x00 u32 magic 0xCA000B11        0x04 u32 version (2.5.x)
//   0x08 u32                         0x0C u32 recordCount
//   0x10 u32 classCount              0x14 u32 stringTableOffset
//   0x18 u32 0
//   0x1C classCount * { u32 classNameStringIndex, u32 instanceCount }
//   .... recordCount records: { u32 size; u8 0x20; u32 class; u16 fieldCount; (u16 field, value)* }
//   strT u32 stringCount, then stringCount * { variable-length length, bytes }
//
// Field value types are not stored; the per-class schema below is the encoding of every field the
// runtime reads, measured over all 2.8 million records of Warcraft III's 2,165 bakes. Fields
// outside the schema are skipped by inferring the encoding under which the rest of the record still
// parses. Object references are 1-based (0 = null).

import {
    PkCurve, PkEffectDef, PkEventSlot, PkFieldDef, PkLayerDef, PkLayerSlot,
    PkRendererDef, PkRendererKind, PkSampler, PkSamplerKind, PkShape,
    PopcornBillboardMode, PopcornBlend,
} from './defs';
import { PkScript } from './script';

const MAGIC = 0xca000b11;

enum Enc { U8, U16, U32, U64, V3, V4, A1, A2, A4, A8, A12, A16 }

interface Field {
    encoding: Enc;
    start: number;
    end: number;
}

interface BakeRecord {
    className: number;
    fieldCount: number;
    body: Uint8Array;
    fields: Map<number, Field> | null;
}

const SCHEMA: Record<string, Record<number, Enc>> = {
    CParticleEffect: { 1: Enc.U32, 3: Enc.U32 },
    CLayerGraphCompileCache: { 1: Enc.A4, 2: Enc.A4, 3: Enc.A4, 5: Enc.A12 },
    CLayerGraphCompileCache_EntrySlot: { 0: Enc.U32, 1: Enc.U32 },
    CLayerGraphCompileCache_EventSlot: { 0: Enc.U32, 1: Enc.U32, 2: Enc.A4 },
    CLayerGraphCompileCache_LayerSlot: { 0: Enc.U32, 1: Enc.A4, 2: Enc.A4 },
    CLayerCompileCache: {
        0: Enc.A16, 1: Enc.A16, 2: Enc.A4, 3: Enc.A4, 5: Enc.A4, 6: Enc.A4, 7: Enc.A4, 8: Enc.A4,
        9: Enc.U32, 10: Enc.A4, 12: Enc.U32, 13: Enc.U32, 14: Enc.U8, 15: Enc.U8,
        20: Enc.U32, 22: Enc.U32, 23: Enc.U32,
    },
    CLayerCompileCacheField: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32, 3: Enc.U32, 4: Enc.U32, 5: Enc.U32 },
    CLayerCompileCacheSampler: { 0: Enc.U32, 1: Enc.U32, 3: Enc.U32, 4: Enc.U32 },
    CParticleNodeSamplerData_Curve: {
        0: Enc.A8, 1: Enc.A8, 7: Enc.U64, 9: Enc.U32, 10: Enc.U32, 11: Enc.V4, 14: Enc.U32, 15: Enc.U8,
        16: Enc.A4, 17: Enc.A4, 18: Enc.A4,
    },
    CParticleNodeSamplerData_Shape: {
        0: Enc.A8, 1: Enc.A8, 3: Enc.U32, 7: Enc.U64, 9: Enc.U32, 10: Enc.U8, 11: Enc.U8, 12: Enc.U32,
        13: Enc.V3, 14: Enc.V3, 15: Enc.U32, 16: Enc.V3, 17: Enc.U32, 18: Enc.U32, 20: Enc.U32,
        21: Enc.U8, 22: Enc.V3, 23: Enc.U32, 24: Enc.V3, 25: Enc.U32,
    },
    CParticleNodeSamplerData_EventStream: { 10: Enc.A4 },
    CLayerCompileCacheEvent: { 0: Enc.U32, 1: Enc.U32, 2: Enc.A4, 3: Enc.U32 },
    CLayerCompileCacheEventPayload: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32, 3: Enc.U32, 4: Enc.U32, 5: Enc.U32 },
    CCompilerBlobCache: { 1: Enc.U32, 2: Enc.A4, 3: Enc.A4, 4: Enc.A4, 5: Enc.U32 },
    CCompilerBlobCacheExternal: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32, 3: Enc.U32, 4: Enc.U32, 5: Enc.U32, 6: Enc.U32, 7: Enc.U32 },
    CCompilerBlobCacheEntryPoint: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32 },
    CCompilerBlobCacheFunctionDef: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32, 3: Enc.A4 },
    CCompilerBlobCacheFunctionArg: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32 },
    CLayerCompileCacheRenderer: { 0: Enc.U32, 1: Enc.A4, 2: Enc.A4, 3: Enc.U32, 4: Enc.U32 },
    CLayerCompileCacheRendererParticleInput: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32, 3: Enc.U32 },
    CLayerCompileCacheRendererProperty: { 0: Enc.U32, 1: Enc.U32, 2: Enc.V4, 3: Enc.U32 },
    CLayerCompileCacheSpatialLayer: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32, 3: Enc.U32, 4: Enc.A4 },
    CLayerCompileCacheSpatialLayerPayload: { 0: Enc.U32, 1: Enc.U32, 2: Enc.U32 },
};

/** Encodings tried, in order, for a field the schema does not name. */
const FALLBACK: Enc[] = [Enc.U32, Enc.A4, Enc.V3, Enc.V4, Enc.U8, Enc.U16, Enc.U64, Enc.A1, Enc.A2, Enc.A8, Enc.A12, Enc.A16];

function readU16(d: Uint8Array, p: number): number {
    return d[p] | (d[p + 1] << 8);
}

function readU32(d: Uint8Array, p: number): number {
    return (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24)) >>> 0;
}

function readI32(d: Uint8Array, p: number): number {
    return d[p] | (d[p + 1] << 8) | (d[p + 2] << 16) | (d[p + 3] << 24);
}

function readF32(d: Uint8Array, p: number): number {
    const view = new DataView(d.buffer, d.byteOffset + p, 4);
    return view.getFloat32(0, true);
}

/** Random access to the records of a PopcornFX 2 bake, with typed field reads. */
export class PkBakeFile {
    readonly strings: string[] = [];
    readonly version: number;
    private readonly records: BakeRecord[] = [];
    private readonly classNameIndex: number[] = [];

    private constructor(version: number) {
        this.version = version;
    }

    get count(): number {
        return this.records.length;
    }

    static looksLikeBake(data: Uint8Array): boolean {
        return data.length > 0x20 && readU32(data, 0) === MAGIC;
    }

    static load(data: Uint8Array): PkBakeFile {
        if (!PkBakeFile.looksLikeBake(data)) throw new Error('Not a PopcornFX bake (missing the 0xCA000B11 magic).');
        const recordCount = readI32(data, 0x0c);
        const classCount = readI32(data, 0x10);
        const strTab = readI32(data, 0x14);
        if (strTab <= 0x1c || strTab >= data.length) throw new Error('Bake string table offset is out of range.');
        if (recordCount < 0 || classCount < 0) throw new Error('Bake header declares a negative count.');

        const bake = new PkBakeFile(readU32(data, 4));

        let p = strTab;
        if (p + 4 > data.length) throw new Error('Bake string table overruns the file.');
        const stringCount = readI32(data, p);
        p += 4;
        for (let i = 0; i < stringCount && p < data.length; i++) {
            let len = data[p++];
            if ((len & 0x80) !== 0) {
                if (p >= data.length) break;
                len = ((len & 0x7f) << 8) | data[p++];
            }
            if (p + len > data.length) break;
            let s = '';
            for (let k = 0; k < len; k++) s += String.fromCharCode(data[p + k]);
            bake.strings.push(s);
            p += len;
        }

        for (let i = 0; i < classCount; i++) {
            const at = 0x1c + 8 * i;
            if (at + 8 > strTab) break;
            bake.classNameIndex.push(readI32(data, at));
        }

        p = 0x1c + 8 * classCount;
        while (p + 4 <= strTab && bake.records.length < recordCount) {
            const size = readI32(data, p);
            if (size < 7 || p + 4 + size > strTab) throw new Error(`Bake record at ${p} overruns the object stream.`);
            if (data[p + 4] !== 0x20) throw new Error(`Bake record at ${p} lacks the 0x20 marker.`);
            bake.records.push({
                className: readU32(data, p + 5),
                fieldCount: readU16(data, p + 9),
                body: data.slice(p + 11, p + 4 + size),
                fields: null,
            });
            p += 4 + size;
        }
        if (bake.records.length !== recordCount) {
            throw new Error(`Bake declares ${recordCount} records but ${bake.records.length} parse.`);
        }
        return bake;
    }

    classOf(rec: number): string {
        if (rec < 0 || rec >= this.records.length) return '';
        const cls = this.records[rec].className;
        return cls < this.classNameIndex.length ? this.str(this.classNameIndex[cls]) : '';
    }

    str(index: number): string {
        return index >= 0 && index < this.strings.length ? this.strings[index] : '';
    }

    *ofClass(name: string): Generator<number> {
        for (let i = 0; i < this.records.length; i++) if (this.classOf(i) === name) yield i;
    }

    has(rec: number, field: number): boolean {
        return this.tryField(rec, field) !== null;
    }

    u32(rec: number, field: number, fallback = 0): number {
        const f = this.tryField(rec, field);
        if (!f || f.end - f.start < 4) return fallback;
        return readU32(this.records[rec].body, f.start);
    }

    i32(rec: number, field: number, fallback = 0): number {
        const f = this.tryField(rec, field);
        if (!f || f.end - f.start < 4) return fallback;
        return readI32(this.records[rec].body, f.start);
    }

    f32(rec: number, field: number, fallback = 0): number {
        const f = this.tryField(rec, field);
        if (!f || f.end - f.start < 4) return fallback;
        return readF32(this.records[rec].body, f.start);
    }

    u8(rec: number, field: number, fallback = 0): number {
        const f = this.tryField(rec, field);
        return f && f.end > f.start ? this.records[rec].body[f.start] : fallback;
    }

    /** A field holding a string-table index, as the string; '' when absent. */
    string(rec: number, field: number): string {
        return this.tryField(rec, field) ? this.str(this.i32(rec, field)) : '';
    }

    v3(rec: number, field: number, fallback = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
        const f = this.tryField(rec, field);
        if (!f || f.end - f.start < 12) return fallback;
        const body = this.records[rec].body;
        return { x: readF32(body, f.start), y: readF32(body, f.start + 4), z: readF32(body, f.start + 8) };
    }

    /** The raw bytes of a fixed-size field (a 16-byte property value, say). */
    raw(rec: number, field: number): Uint8Array {
        const f = this.tryField(rec, field);
        return f ? this.records[rec].body.slice(f.start, f.end) : new Uint8Array(0);
    }

    /** An array field's element bytes (without the count prefix); empty when absent. */
    arrayBytes(rec: number, field: number): Uint8Array {
        const f = this.tryField(rec, field);
        if (!f || f.end - f.start < 4) return new Uint8Array(0);
        return this.records[rec].body.slice(f.start + 4, f.end);
    }

    u32s(rec: number, field: number): number[] {
        const raw = this.arrayBytes(rec, field);
        const out: number[] = [];
        for (let i = 0; i + 4 <= raw.length; i += 4) out.push(readU32(raw, i));
        return out;
    }

    f32s(rec: number, field: number): number[] {
        const raw = this.arrayBytes(rec, field);
        const out: number[] = [];
        for (let i = 0; i + 4 <= raw.length; i += 4) out.push(readF32(raw, i));
        return out;
    }

    /** An array of 1-based record references, as 0-based indices; a null reference becomes -1. */
    refs(rec: number, field: number): number[] {
        return this.u32s(rec, field).map(u => (u === 0 || u > 0x7fffffff ? -1 : u - 1));
    }

    /** A single 1-based record reference, 0-based; -1 when absent or null. */
    ref(rec: number, field: number): number {
        const u = this.u32(rec, field);
        return u === 0 || u > this.records.length ? -1 : u - 1;
    }

    private tryField(rec: number, field: number): Field | null {
        if (rec < 0 || rec >= this.records.length) return null;
        const r = this.records[rec];
        if (r.fields === null) r.fields = walkFields(this.classOf(rec), r) ?? new Map();
        const f = r.fields.get(field);
        return f === undefined ? null : f;
    }
}

export function readPkbContainer(data: Uint8Array): PkBakeFile {
    return PkBakeFile.load(data);
}

function walkFields(className: string, r: BakeRecord): Map<number, Field> | null {
    const schema = SCHEMA[className];
    const body = r.body;
    const acc = new Map<number, Field>();
    let budget = 200_000;

    const step = (k: number, p: number, last: number): boolean => {
        if (--budget < 0) return false;
        if (k === r.fieldCount) return p === body.length;
        if (p + 2 > body.length) return false;
        const fi = readU16(body, p);
        if (fi <= last) return false;
        const q = p + 2;
        const known = schema !== undefined ? schema[fi] : undefined;
        const encodings = known !== undefined ? [known] : FALLBACK;
        for (const enc of encodings) {
            const e = fieldEnd(body, q, enc);
            if (e < 0) continue;
            const isLast = k === r.fieldCount - 1;
            if (!isLast && !(e + 2 <= body.length && readU16(body, e) > fi)) continue;
            acc.set(fi, { encoding: enc, start: q, end: e });
            if (step(k + 1, e, fi)) return true;
            acc.delete(fi);
        }
        return false;
    };
    return step(0, 0, -1) ? acc : null;
}

function fieldEnd(body: Uint8Array, p: number, enc: Enc): number {
    let fixed = 0;
    switch (enc) {
        case Enc.U8: fixed = 1; break;
        case Enc.U16: fixed = 2; break;
        case Enc.U32: fixed = 4; break;
        case Enc.U64: fixed = 8; break;
        case Enc.V3: fixed = 12; break;
        case Enc.V4: fixed = 16; break;
        default: fixed = 0; break;
    }
    if (fixed > 0) return p + fixed <= body.length ? p + fixed : -1;
    if (p + 4 > body.length) return -1;
    const n = readI32(body, p);
    if (n < 0 || n > 1_000_000) return -1;
    const elem = enc === Enc.A1 ? 1 : enc === Enc.A2 ? 2 : enc === Enc.A4 ? 4 : enc === Enc.A8 ? 8 : enc === Enc.A12 ? 12 : 16;
    const end = p + 4 + n * elem;
    return end <= body.length ? end : -1;
}

// ---------------------------------------------------------------------------- effect definition

/** Parses a bake into its executable effect definition. */
export function parsePkb(data: Uint8Array): PkEffectDef {
    const b = PkBakeFile.load(data);
    const def = new PkEffectDef();
    const layerByRecord = new Map<number, number>();

    for (const lr of b.ofClass('CLayerCompileCache')) {
        const layer = new PkLayerDef(lr);
        try {
            readLayer(b, lr, layer);
        } catch (e) {
            def.warnings.push(`layer #${lr}: ${e instanceof Error ? e.message : String(e)}`);
        }
        layerByRecord.set(lr, def.layers.length);
        def.layers.push(layer);
    }

    let graph = -1;
    for (const g of b.ofClass('CLayerGraphCompileCache')) { graph = g; break; }
    if (graph < 0) {
        def.warnings.push('no layer graph');
        return def;
    }

    for (const sr of b.refs(graph, 2)) {
        if (sr < 0) continue;
        const lr = b.ref(sr, 0);
        const layerIndex = layerByRecord.get(lr);
        def.slots.push(new PkLayerSlot(
            layerIndex === undefined ? -1 : layerIndex,
            b.u32s(sr, 1),
            b.u32s(sr, 2),
        ));
    }
    for (const er of b.refs(graph, 3)) {
        if (er < 0) { def.events.push(new PkEventSlot()); continue; }
        def.events.push(new PkEventSlot(b.has(er, 0) ? b.string(er, 0) : '', b.u32s(er, 2)));
    }

    // Layer names: the graph node prefix of its renderer fields (n20_8__Size -> n20_8).
    for (const layer of def.layers) {
        let node: string | null = null;
        for (const f of layer.fields) {
            const cut = f.name.indexOf('__');
            if (cut >= 0 && f.name.startsWith('n')) { node = f.name.slice(0, cut); break; }
        }
        layer.name = node ?? (layer.renderers.length === 0 ? `spawner${layer.record}` : `layer${layer.record}`);
    }
    return def;
}

function readLayer(b: PkBakeFile, lr: number, layer: PkLayerDef): void {
    for (const fr of b.refs(lr, 2)) {
        if (fr < 0) continue;
        const name = b.string(fr, 0);
        if (!layer.fieldIndex.has(name)) layer.fieldIndex.set(name, layer.fields.length);
        layer.fields.push(new PkFieldDef(name, b.u32(fr, 1) + 1));
    }

    for (const sr of b.refs(lr, 7)) {
        if (sr < 0) continue;
        const name = b.string(sr, 0);
        layer.samplers.push(readSampler(b, name, b.ref(sr, 1)));
    }

    for (const br of b.refs(lr, 10)) {
        if (br < 0 || b.classOf(br) !== 'CCompilerBlobCache') continue;
        const script = PkScript.decode(b, br);
        switch (script.kind) {
            case null: layer.spawn ??= script; break;
            case 3: layer.evolveOnSpawn ??= script; break;
            case 4: layer.evolve ??= script; break;
        }
    }

    for (const rr of b.refs(lr, 8)) {
        if (rr < 0) continue;
        layer.renderers.push(readRenderer(b, rr, layer));
    }

    // Events this layer fires (field 5) name their payloads in append order; field 12 points at
    // an unnamed event whose payload list is the layout this layer reads its inputs from.
    for (const er of b.refs(lr, 5)) {
        if (er < 0 || !b.has(er, 0)) continue;
        layer.outputPayloads.set(b.string(er, 0), payloadNames(b, er));
    }
    const input = b.ref(lr, 12);
    if (input >= 0 && b.classOf(input) === 'CLayerCompileCacheEvent') layer.inputPayloads = payloadNames(b, input);
    layer.spatialLayers = b.refs(lr, 6).filter(r => r >= 0).map(r => b.string(r, 0));
}

function payloadNames(b: PkBakeFile, eventRecord: number): string[] {
    return b.refs(eventRecord, 2).map(p => (p < 0 ? '' : b.string(p, 0)));
}

function readSampler(b: PkBakeFile, name: string, dataRecord: number): PkSampler {
    const cls = dataRecord >= 0 ? b.classOf(dataRecord) : '';
    switch (cls) {
        case 'CParticleNodeSamplerData_Curve': {
            const dimension = b.has(dataRecord, 9) ? b.i32(dataRecord, 9) : 1;
            let times = b.f32s(dataRecord, 16);
            let values = b.f32s(dataRecord, 17);
            const tangents = b.f32s(dataRecord, 18);
            if (dimension < 1 || dimension > 4 || values.length < times.length * dimension) {
                times = [];
                values = [];
            }
            const sampler = new PkSampler(name, PkSamplerKind.Curve);
            sampler.curve = new PkCurve(Math.min(Math.max(dimension, 1), 4), times, values, tangents);
            return sampler;
        }
        case 'CParticleNodeSamplerData_Shape': {
            const sampler = new PkSampler(name, PkSamplerKind.Shape);
            sampler.shape = new PkShape(
                b.i32(dataRecord, 15, 0),
                b.f32(dataRecord, 17, 1),
                b.f32(dataRecord, 18, 0),
                b.f32(dataRecord, 20, 1),
                b.v3(dataRecord, 13),
                b.v3(dataRecord, 14),
            );
            return sampler;
        }
        case 'CParticleNodeSamplerData_EventStream': {
            const sampler = new PkSampler(name, PkSamplerKind.EventStream);
            sampler.eventTimes = b.f32s(dataRecord, 10);
            return sampler;
        }
        case 'CParticleNodeSamplerData_Turbulence': {
            // Only the fields a bake overrides are written; neither ever holds exactly 1, the mark
            // of a default, so an absent field falls back to 1.
            const sampler = new PkSampler(name, PkSamplerKind.Turbulence);
            sampler.wavelength = b.f32(dataRecord, 11, 1);
            sampler.strength = b.f32(dataRecord, 12, 1);
            return sampler;
        }
        default:
            return new PkSampler(
                name,
                cls.includes('Turbulence') ? PkSamplerKind.Turbulence
                    : cls.includes('Spectrum') ? PkSamplerKind.Spectrum
                        : PkSamplerKind.Unknown,
            );
    }
}

function readRenderer(b: PkBakeFile, rr: number, layer: PkLayerDef): PkRendererDef {
    const material = b.string(rr, 3);
    let texture = '';
    let mode = PopcornBillboardMode.ScreenAligned;
    let blend = PopcornBlend.Additive;
    let ax = 1, ay = 1;
    let size2d = false, flip = false;
    for (const pr of b.refs(rr, 2)) {
        if (pr < 0) continue;
        const name = b.string(pr, 0);
        const raw = b.raw(pr, 2);
        const v0 = raw.length >= 4 ? readI32(raw, 0) : 0;
        const v1 = raw.length >= 8 ? readI32(raw, 4) : 0;
        switch (name) {
            case 'Diffuse.DiffuseMap':
            case 'Distortion.DistortionMap':
                if (texture.length === 0 && b.has(pr, 3)) texture = b.string(pr, 3);
                break;
            case 'BillboardingMode': mode = Math.min(Math.max(v0, 0), 5) as PopcornBillboardMode; break;
            case 'Transparent.Type': blend = Math.min(Math.max(v0, 0), 3) as PopcornBlend; break;
            case 'Atlas.SubDiv': ax = Math.max(1, v0); ay = Math.max(1, v1); break;
            case 'EnableSize2D': size2d = raw.length > 0; break;
            case 'FlipUVs': flip = raw.length > 0; break;
        }
    }

    const lower = material.toLowerCase();
    const def = new PkRendererDef({
        kind: lower.includes('ribbon') ? PkRendererKind.Ribbon
            : lower.includes('distortion') ? PkRendererKind.Distortion
                : lower.includes('light') ? PkRendererKind.Light
                    : lower.includes('billboard') ? PkRendererKind.Billboard
                        : PkRendererKind.Other,
        material, texture, billboard: mode, blend,
        atlasColumns: ax, atlasRows: ay, size2D: size2d, flipUVs: flip,
        drawOrder: b.i32(rr, 4, 0),
    });

    // Inputs: field 0 is a built-in input id (0 Position, 1 Size, 2 Enabled, 3/6 Rotation,
    // 4 Axis, 5 NormalAxis, 7 Size2) or, from 100 up, a named input whose name is field 2.
    for (const ir of b.refs(rr, 1)) {
        if (ir < 0) continue;
        const id = b.i32(ir, 0, 0);
        const field = b.i32(ir, 1, 0);
        let key: string;
        switch (id) {
            case 0: key = 'Position'; break;
            case 1: key = 'Size'; break;
            case 2: key = 'Enabled'; break;
            case 3:
            case 6: key = 'Rotation'; break;
            case 4: key = 'Axis'; break;
            case 5: key = 'NormalAxis'; break;
            case 7: key = 'Size2'; break;
            case 9: key = 'SelfID'; break;
            case 10: key = 'ParentID'; break;
            default: key = b.has(ir, 2) ? b.string(ir, 2) : `input${id}`; break;
        }
        if (field >= 0 && field < layer.fields.length) def.inputs.set(key, field);
    }
    return def;
}
