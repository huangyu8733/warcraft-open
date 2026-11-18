// PopcornFX particle overlay — Reforged's `CORN` emitters (see render/popcornMdx.ts).
//
// A Reforged model carries a list of `CORN` nodes, each naming a compiled PopcornFX bake
// (`SharedFX\Wisp\WispWork.pkfx`, shipped as `.pkb`). mdx-m3-viewer parses the node list but has
// no runtime, so every effect the model was shipped with — the Wisp's body, a potion's heal
// burst, a spell's cast ring, a trail ribbon — simply never appeared. This overlay runs those
// bakes with the ported VM (render/pkb/*) and draws their billboard sprites and ribbons into the
// translucent pass.
//
// Simulation is in metres (Reforged art is 50 units to the metre): the emitter node's world
// matrix goes in with its translation divided by 50, and `collectSprites` converts the simulated
// positions and sizes back to Warcraft units. Drawing must therefore NOT apply that matrix to a
// particle's position again — it is already in world units; only the card axes are rotated by the
// node. GL discipline follows WeatherOverlay: snapshot and restore.

import {
    PkEffectDef,
    PkEffectInstance,
    PkEnvironment,
    PkRenderBatch,
    PkRibbonBatch,
    PopcornBillboardMode,
    PopcornBlend,
    collectRibbons,
    collectSprites,
    createRenderBatches,
    createRibbonBatches,
    parsePkb,
    spriteCellUv,
    spriteQuad,
} from "./pkb";
import type { PkRibbonPoint, PkSprite } from "./pkb";
import { matTransformNormal } from "./pkb/math";
import { pipelineState } from "./glPipelineState";

type GL = WebGLRenderingContext;

/** Warcraft III units per metre in Reforged art. */
const UNITS_PER_METRE = 50;

const VERT_SRC = `
attribute vec3 aPos;
attribute vec2 aUv;
attribute vec4 aColor;
uniform mat4 uViewProj;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vUv = aUv;
  vColor = aColor;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D uTex;
uniform float uRepeatU;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  // Ribbons scroll along U (a trail's texture slides down its length) and the bake's U is
  // unbounded. Folding it here gives repeating behaviour without changing the shared texture's
  // CLAMP_TO_EDGE wrap, which the billboard atlases depend on.
  vec2 uv = uRepeatU > 0.5 ? vec2(fract(vUv.x), vUv.y) : vUv;
  vec4 c = texture2D(uTex, uv) * vColor;
  if (c.a < 0.004) discard;
  gl_FragColor = c;
}`;

/** Reads a bake (`.pkb`) by install path. Async: on a Reforged mount the art is lazy, so the
 *  synchronous `rawBytes` cannot see a bake until something has fetched it. */
export type PkbReader = (path: string) => Promise<Uint8Array>;
/** Decodes a texture by install path. Async for the same reason as {@link PkbReader}: the
 *  Reforged art tree is lazy, and a bake's textures live under it. */
export type PkbTextureLoader = (path: string) => Promise<HTMLCanvasElement | null>;

/** Finds the install path of a bake a model names at a path the store does not use, or null.
 *  See {@link pkbBakeResolver}. */
export type PkbBakeResolver = (path: string) => string | null;

/**
 * A resolver over the install's `.pkb` list for the bakes a model NAMES WRONG.
 *
 * Reforged's data has the same kind of rot the texture paths do (see `relocatedHdTexture` in
 * vfs/tileset.ts): the model carries the artist's working path and the store files the bake
 * somewhere else, or with a different basename.
 *
 *   Unit      Buildings\Orc\Beastiary\\B_Work.pkb          (a doubled separator)
 *   Unit      Buildings\NightElf\Shipyard\Default_UnitWorking.pkb
 *             → SharedFX\Default_UnitWorking\Default_UnitWorking.pkb
 *   Unit      SharedFX\Building_Smoke_Large\SmokeWhiteLarge.pkb
 *             → SharedFX\Building_Smoke_Large\Building_SmokeWhite_Large.pkb
 *   Doodad    Doodads\Weather\SnowfallHeavy.pkb             → …\Snowfall.pkb (only bake shipped)
 *   Ability   Abilities\Weapons\SorceressMissile\OrangeBolt.pkb → …\Weapons\SorceressMissile\… (moved)
 *   Model     SharedFX\Ship_Wake_Small\  (a trailing separator, no file name at all)
 *   Model     CloudOfFog1.pkb                               → CloudOfFog.pkb
 *
 * So the lookup is: exact basename, then basename without its frame digits, then containment of
 * the alphanumeric stem in either direction (shortest extra wins). A wrong-but-related bake
 * beats a missing one here — every unresolved path is an effect the player never sees.
 */
export function pkbBakeResolver(paths: readonly string[]): PkbBakeResolver {
    const byStem = new Map<string, string[]>();
    for (const path of paths) {
        if (!/\.pkb$/i.test(path)) continue;
        const stem = bakeStem(path);
        if (!stem) continue;
        const list = byStem.get(stem);
        if (list) list.push(path);
        else byStem.set(stem, [path]);
    }
    const stems = [...byStem.keys()];
    const memo = new Map<string, string | null>();
    return (path: string): string | null => {
        const hit = memo.get(path);
        if (hit !== undefined) return hit;
        const normalized = path.replace(/\//g, "\\").replace(/^\\+/, "");
        const stem = bakeStem(normalized);
        let found: string | null = null;
        if (stem) {
            found = byStem.get(stem)?.[0] ?? byStem.get(stem.replace(/\d+$/, ""))?.[0] ?? null;
            if (!found && stem.length >= 5) {
                // The stored bake carries extra words (`SmokeWhiteLarge` is shipped as
                // `Building_SmokeWhite_Large`) — take the shortest such candidate.
                let shortest = Infinity;
                for (const candidate of stems) {
                    if (candidate.length <= stem.length || !candidate.includes(stem)) continue;
                    if (candidate.length < shortest) {
                        shortest = candidate.length;
                        found = byStem.get(candidate)![0];
                    }
                }
                // …or the model carries extra words (`SweepingStrikeSwing` is `SweepingStrike`).
                // Require the shared part to be most of the name, or `LichDeath` would match
                // `Lich` and play the wrong effect.
                if (!found) {
                    let longest = 0;
                    for (const candidate of stems) {
                        if (candidate.length < 5 || candidate.length >= stem.length) continue;
                        if (!stem.includes(candidate) || candidate.length < stem.length * 0.6) continue;
                        if (candidate.length > longest) {
                            longest = candidate.length;
                            found = byStem.get(candidate)![0];
                        }
                    }
                }
            }
        }
        memo.set(path, found);
        return found;
    };
}

/** `SharedFX\Ship_Wake_Small\` and `…\CloudOfFog1.pkb` both reduce to an alphanumeric stem. */
function bakeStem(path: string): string {
    let name = path.replace(/\//g, "\\").replace(/\\+$/, "");
    name = name.slice(name.lastIndexOf("\\") + 1);
    return name.replace(/\.(pkb|pkfx|mdl|mdx)$/i, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** One running effect on one model instance node. */
interface Track {
    def: PkEffectDef;
    /** Null until the guide first lets the node run — see {@link cornGuide}. */
    effect: PkEffectInstance | null;
    batches: PkRenderBatch[];
    /** Ribbon renderers of the same bake; their points are chained, not drawn as cards. */
    ribbons: PkRibbonBatch[];
    guide: CornGuide;
    /** Viewer-node index this effect hangs from (−1 = the model root). */
    anchor: number;
    /** Whether the guide was satisfied last frame (an ungated node is always satisfied). */
    wasRunning: boolean;
    lastSequence: number;
    lastFrame: number;
    seed: number;
}

interface Batch {
    pos: Float32Array;
    uv: Float32Array;
    color: Float32Array;
    cap: number;
    count: number;
    posBuf: WebGLBuffer;
    uvBuf: WebGLBuffer;
    colorBuf: WebGLBuffer;
    glCap: number;
    texture: string;
    blend: PopcornBlend;
    /** Ribbons fold U in the fragment shader; atlased cards must not. */
    repeatU: boolean;
}

interface TrackState {
    texture: WebGLTexture | null;
    canvas: HTMLCanvasElement | null;
}

/** The minimum an MDX instance must expose for the overlay to hang its effects on it. */
interface SceneInstance {
    model: {
        popcornEmitters?: { objectId: number; path: string; guide?: string; parentNode?: number }[];
        sequences?: { name: string; interval: number[]; nonLooping?: boolean }[];
    };
    worldMatrix: Float32Array | number[];
    nodes?: { worldMatrix: number[] }[];
    /** The PLAYING sequence (index into `model.sequences`) and its frame — what the CORN
     *  guides are matched against. Absent on non-animated scene objects. */
    sequence?: number;
    frame?: number;
}

/** A scene, as much of it as particle placement needs. */
export interface PkbScene {
    instances: SceneInstance[];
}

export class PkbOverlay {
    private gl: GL;
    private read: PkbReader;
    private loadTexture: PkbTextureLoader;
    private program: WebGLProgram;
    private aPos: number;
    private aUv: number;
    private aColor: number;
    private uViewProj: WebGLUniformLocation;
    private uTex: WebGLUniformLocation;
    private uRepeatU: WebGLUniformLocation;
    private maxAttribs: number;

    private defs = new Map<string, PkEffectDef | null>();
    private loading = new Set<string>();
    private textures = new Map<string, TrackState>();
    /** Instance -> emitter node object id -> running effect. */
    private tracks = new Map<SceneInstance, Map<number, Track>>();
    private batches = new Map<string, Batch>();
    private warned = new Set<string>();
    private live = 0;
    /** Set when a model names a bake the store files elsewhere (see {@link pkbBakeResolver}). */
    private resolveBake: PkbBakeResolver | null;

    constructor(gl: GL, read: PkbReader, loadTexture: PkbTextureLoader, resolveBake?: PkbBakeResolver) {
        this.gl = gl;
        this.read = read;
        this.loadTexture = loadTexture;
        this.resolveBake = resolveBake ?? null;
        this.maxAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
        this.program = compileProgram(gl, VERT_SRC, FRAG_SRC);
        this.aPos = gl.getAttribLocation(this.program, "aPos");
        this.aUv = gl.getAttribLocation(this.program, "aUv");
        this.aColor = gl.getAttribLocation(this.program, "aColor");
        this.uViewProj = gl.getUniformLocation(this.program, "uViewProj")!;
        this.uTex = gl.getUniformLocation(this.program, "uTex")!;
        this.uRepeatU = gl.getUniformLocation(this.program, "uRepeatU")!;
    }

    /** Live particle count, for the perf log. */
    get particleCount(): number {
        return this.live;
    }

    /** Advance every effect attached to a visible instance, and drop the ones that went away. */
    update(dt: number, scene: PkbScene, cameraPosition: ArrayLike<number>): void {
        const seen = new Set<SceneInstance>();
        for (const instance of scene.instances) {
            const emitters = instance.model?.popcornEmitters;
            if (!emitters || emitters.length === 0) continue;
            seen.add(instance);
            let byNode = this.tracks.get(instance);
            if (byNode === undefined) {
                byNode = new Map();
                this.tracks.set(instance, byNode);
            }
            for (const emitter of emitters) {
                if (byNode.has(emitter.objectId)) continue;
                const track = this.createTrack(emitter);
                if (track) byNode.set(emitter.objectId, track);
            }
        }
        for (const instance of [...this.tracks.keys()]) {
            if (seen.has(instance)) continue;
            this.tracks.delete(instance);
        }

        this.live = 0;
        for (const [instance, byNode] of this.tracks) {
            const sequence = instance.sequence ?? -1;
            const frame = instance.frame ?? 0;
            for (const track of byNode.values()) {
                // The CORN node's guide decides whether it runs at all in the playing sequence
                // (`Always=Off,Attack=On`), and a sequence that (re)starts while gated replays
                // the effect from the top — that is what makes a cast burst fire on every cast
                // instead of only the first.
                const running = cornGuideRuns(track.guide, instance);
                const sequenceChanged = track.lastSequence !== sequence;
                const wrapped = frame < track.lastFrame;
                // A one-shot clip (Attack, Spell) at its start is a new swing/cast and replays the
                // burst; a LOOPING clip (Walk) wrapping is not — resetting a walk's dust every
                // cycle would flicker.
                const oneShot = instance.model.sequences?.[sequence]?.nonLooping ?? true;
                const replay = sequenceChanged || (wrapped && oneShot);
                track.lastSequence = sequence;
                track.lastFrame = frame;
                if (track.effect === null) {
                    if (running) track.effect = this.spawnEffect(track);
                } else if (track.guide.triggered && running && (!track.wasRunning || replay)) {
                    track.effect = this.spawnEffect(track);
                }
                track.wasRunning = running;
                if (track.effect === null) continue;
                track.effect.env.running = running;
                const world = nodeWorldMatrix(instance, track.anchor);
                // The effect simulates in world METRES; the node matrix is in world units, so
                // only its translation is converted. `collectSprites` then turns the resulting
                // particle positions and sizes back into world units for drawing.
                track.effect.env.localToWorld = worldInMetres(world);
                track.effect.env.cameraPosition = {
                    x: cameraPosition[0],
                    y: cameraPosition[1],
                    z: cameraPosition[2],
                };
                track.effect.update(dt);
                for (const state of track.effect.slots) if (state) this.live += state.count;
            }
        }
    }

    /** A fresh instance of a track's bake, sharing its environment (camera, node transform,
     *  running flag) but not its age or particles. */
    private spawnEffect(track: Track): PkEffectInstance {
        const effect = track.effect;
        const env = effect ? effect.env : new PkEnvironment();
        // A reseeded, non-zero step keeps two consecutive casts from looking identical.
        track.seed = (Math.imul(track.seed, 1664525) + 1013904223) >>> 0;
        return new PkEffectInstance(track.def, env, track.seed);
    }

    /** Draw every effect's billboards. Call inside the translucent pass. */
    render(
        viewProj: Float32Array | Iterable<number>,
        camRight: ArrayLike<number>,
        camUp: ArrayLike<number>,
    ): void {
        if (this.tracks.size === 0) return;
        for (const b of this.batches.values()) b.count = 0;

        const right = { x: camRight[0], y: camRight[1], z: camRight[2] };
        const up = { x: camUp[0], y: camUp[1], z: camUp[2] };
        const look = {
            x: up.y * right.z - up.z * right.y,
            y: up.z * right.x - up.x * right.z,
            z: up.x * right.y - up.y * right.x,
        };

        let any = false;
        for (const [instance, byNode] of this.tracks) {
            for (const track of byNode.values()) {
                if (track.effect === null) continue;
                const world = nodeWorldMatrix(instance, track.anchor) as number[];
                // Sprites are rebuilt every frame; the arrays are append-only.
                for (const batch of track.batches) batch.sprites.length = 0;
                for (const batch of track.ribbons) batch.ribbons.length = 0;
                collectSprites(track.effect, track.batches, UNITS_PER_METRE);
                collectRibbons(track.effect, track.ribbons, UNITS_PER_METRE);
                for (const batch of track.batches) {
                    if (batch.sprites.length === 0) continue;
                    const out = this.batchFor(batch.renderer.texture, batch.renderer.blend);
                    if (!out) continue;
                    for (const sprite of batch.sprites) {
                        this.emitSprite(out, sprite, batch.renderer.billboard, batch.renderer.atlasColumns,
                            batch.renderer.atlasRows, world, right, up, look);
                    }
                    any = true;
                }
                for (const batch of track.ribbons) {
                    if (batch.ribbons.length === 0) continue;
                    const out = this.batchFor(batch.renderer.texture, batch.renderer.blend, true);
                    if (!out) continue;
                    for (const ribbon of batch.ribbons) this.emitRibbon(out, ribbon, right, look);
                    any = true;
                }
            }
        }
        if (!any) return;

        const gl = this.gl;
        const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
        const prevArrayBuf = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
        const prevBlend = gl.isEnabled(gl.BLEND);
        const prevDepthTest = gl.isEnabled(gl.DEPTH_TEST);
        const prevCull = gl.isEnabled(gl.CULL_FACE);
        const pipeline = pipelineState(gl);
        const prevPipeline = pipeline.save();
        const prevActiveTex = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
        gl.activeTexture(gl.TEXTURE0);
        const prevTex0 = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
        const prevAttribEnabled: boolean[] = [];
        for (let i = 0; i < this.maxAttribs; i++) {
            prevAttribEnabled[i] = gl.getVertexAttrib(i, gl.VERTEX_ATTRIB_ARRAY_ENABLED) as boolean;
        }

        gl.useProgram(this.program);
        gl.enable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.disable(gl.CULL_FACE);
        for (let i = 0; i < this.maxAttribs; i++) {
            if (i !== this.aPos && i !== this.aUv && i !== this.aColor) gl.disableVertexAttribArray(i);
        }
        gl.uniformMatrix4fv(this.uViewProj, false, viewProj as Float32Array);
        gl.uniform1i(this.uTex, 0);
        gl.enableVertexAttribArray(this.aPos);
        gl.enableVertexAttribArray(this.aUv);
        gl.enableVertexAttribArray(this.aColor);

        for (const batch of this.batches.values()) {
            if (batch.count === 0) continue;
            const tex = this.resolveTexture(batch.texture);
            if (!tex) continue;
            applyBlend(gl, batch.blend);
            gl.uniform1f(this.uRepeatU, batch.repeatU ? 1 : 0);
            this.uploadBatch(batch);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.bindBuffer(gl.ARRAY_BUFFER, batch.posBuf);
            gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, batch.uvBuf);
            gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, batch.colorBuf);
            gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, batch.count);
        }

        gl.bindTexture(gl.TEXTURE_2D, prevTex0);
        gl.activeTexture(prevActiveTex);
        gl.useProgram(prevProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, prevArrayBuf);
        setEnabled(gl, gl.BLEND, prevBlend);
        setEnabled(gl, gl.DEPTH_TEST, prevDepthTest);
        setEnabled(gl, gl.CULL_FACE, prevCull);
        pipeline.restore(prevPipeline);
        for (let i = 0; i < this.maxAttribs; i++) {
            if (prevAttribEnabled[i]) gl.enableVertexAttribArray(i);
            else gl.disableVertexAttribArray(i);
        }
    }

    private createTrack(
        emitter: { objectId: number; path: string; guide?: string; parentNode?: number },
    ): Track | null {
        const path = pkbPath(emitter.path);
        const def = this.effectDef(path);
        if (!def || def.slots.length === 0) return null;
        // A stable-ish seed per emitter keeps two wisps from shimmering in lock-step.
        const seed = (path.length * 2654435761 + emitter.objectId * 40503) >>> 0;
        return {
            def,
            // Built on the first frame the guide allows it to run, so an attack or cast burst
            // starts at birth rather than at whatever age the idle model had reached.
            effect: null,
            batches: createRenderBatches(def),
            ribbons: createRibbonBatches(def),
            guide: cornGuide(emitter.guide),
            anchor: emitter.parentNode ?? -1,
            wasRunning: false,
            lastSequence: -2,
            lastFrame: 0,
            seed,
        };
    }

    private effectDef(path: string): PkEffectDef | null {
        const cached = this.defs.get(path);
        if (cached !== undefined) return cached;
        if (this.loading.has(path)) return null;
        this.loading.add(path);
        this.read(path).catch((err) => {
            const alt = this.resolveBake?.(path);
            if (!alt || alt === path) throw err;
            return this.read(alt);
        }).then(
            (bytes) => {
                try {
                    this.defs.set(path, parsePkb(bytes));
                } catch (e) {
                    this.warnOnce(path, `[pkb] ${path}: ${e instanceof Error ? e.message : String(e)}`);
                    this.defs.set(path, null);
                }
            },
            () => {
                this.warnOnce(path, `[pkb] ${path} is not in the install`);
                this.defs.set(path, null);
            },
        );
        return null;
    }

    private warnOnce(key: string, message: string): void {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        console.warn(message);
    }

    /** One quad for a sprite, already placed by the emitter node's world matrix. */
    private emitSprite(
        batch: Batch,
        sprite: PkSprite,
        mode: PopcornBillboardMode,
        columns: number,
        rows: number,
        world: number[],
        right: { x: number; y: number; z: number },
        up: { x: number; y: number; z: number },
        look: { x: number; y: number; z: number },
    ): void {
        const { r, u } = spriteQuad(sprite, mode, right, up, look);
        // The particle positions are already world units (see `collectSprites`); only the card
        // axes still need the node's rotation.
        const c = sprite.position;
        const rw = matTransformNormal(world, r);
        const uw = matTransformNormal(world, u);
        // Cheap bounds check against the canvas; effects on off-screen units cost nothing.
        if (!Number.isFinite(c.x) || !Number.isFinite(rw.x) || !Number.isFinite(uw.x)) return;

        const { u0, v0, u1, v1 } = spriteCellUv(sprite.frame, columns, rows);
        const col = sprite.color;
        this.ensureCapacity(batch, batch.count + 6);
        const corners = [
            { p: { x: c.x - rw.x - uw.x, y: c.y - rw.y - uw.y, z: c.z - rw.z - uw.z }, u: u0, v: v1 },
            { p: { x: c.x + rw.x - uw.x, y: c.y + rw.y - uw.y, z: c.z + rw.z - uw.z }, u: u1, v: v1 },
            { p: { x: c.x + rw.x + uw.x, y: c.y + rw.y + uw.y, z: c.z + rw.z + uw.z }, u: u1, v: v0 },
            { p: { x: c.x - rw.x + uw.x, y: c.y - rw.y + uw.y, z: c.z - rw.z + uw.z }, u: u0, v: v0 },
        ];
        for (const i of [0, 1, 2, 0, 2, 3]) {
            const corner = corners[i];
            const o3 = batch.count * 3;
            const o2 = batch.count * 2;
            const o4 = batch.count * 4;
            batch.pos[o3] = corner.p.x;
            batch.pos[o3 + 1] = corner.p.y;
            batch.pos[o3 + 2] = corner.p.z;
            batch.uv[o2] = corner.u;
            batch.uv[o2 + 1] = corner.v;
            batch.color[o4] = col.x;
            batch.color[o4 + 1] = col.y;
            batch.color[o4 + 2] = col.z;
            batch.color[o4 + 3] = col.w;
            batch.count++;
        }
    }

    /**
     * One ribbon: a triangle strip between consecutive cross-sections. Each cross-section is
     * `centre ± side × halfWidth`, with `side` perpendicular to the trail and to the view — the
     * camera-facing ribbon every Warcraft III trail is (WorldEdit's ribbons do the same).
     * `TextureU` runs ALONG the ribbon and the V coordinate across it, which is how the
     * CustomTextureU ribbon materials are authored.
     */
    private emitRibbon(
        batch: Batch,
        ribbon: PkRibbonPoint[],
        right: { x: number; y: number; z: number },
        look: { x: number; y: number; z: number },
    ): void {
        for (let i = 0; i + 1 < ribbon.length; i++) {
            const a = ribbon[i], b = ribbon[i + 1];
            // A smoothed tangent so a two-point chain and a long trail both stay untwisted.
            const prev = i > 0 ? ribbon[i - 1].position : a.position;
            const next = i + 2 < ribbon.length ? ribbon[i + 2].position : b.position;
            const tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
            let sx = ty * look.z - tz * look.y;
            let sy = tz * look.x - tx * look.z;
            let sz = tx * look.y - ty * look.x;
            const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
            if (len > 1e-6 && Number.isFinite(len)) {
                sx /= len; sy /= len; sz /= len;
            } else {
                sx = right.x; sy = right.y; sz = right.z;
            }
            const ax = a.position.x, ay = a.position.y, az = a.position.z;
            const bx = b.position.x, by = b.position.y, bz = b.position.z;
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)
                || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)) continue;
            this.ensureCapacity(batch, batch.count + 6);
            // a-, a+, b+, b- — two triangles, per-vertex U along the ribbon and colour from the
            // particle the cross-section belongs to.
            const corners = [
                { x: ax - sx * a.halfWidth, y: ay - sy * a.halfWidth, z: az - sz * a.halfWidth, u: a.u, v: 0, c: a.color },
                { x: ax + sx * a.halfWidth, y: ay + sy * a.halfWidth, z: az + sz * a.halfWidth, u: a.u, v: 1, c: a.color },
                { x: bx + sx * b.halfWidth, y: by + sy * b.halfWidth, z: bz + sz * b.halfWidth, u: b.u, v: 1, c: b.color },
                { x: bx - sx * b.halfWidth, y: by - sy * b.halfWidth, z: bz - sz * b.halfWidth, u: b.u, v: 0, c: b.color },
            ];
            for (const k of [0, 1, 2, 0, 2, 3]) {
                const corner = corners[k];
                const o3 = batch.count * 3;
                const o2 = batch.count * 2;
                const o4 = batch.count * 4;
                batch.pos[o3] = corner.x;
                batch.pos[o3 + 1] = corner.y;
                batch.pos[o3 + 2] = corner.z;
                batch.uv[o2] = corner.u;
                batch.uv[o2 + 1] = corner.v;
                batch.color[o4] = corner.c.x;
                batch.color[o4 + 1] = corner.c.y;
                batch.color[o4 + 2] = corner.c.z;
                batch.color[o4 + 3] = corner.c.w;
                batch.count++;
            }
        }
    }

    private batchFor(texture: string, blend: PopcornBlend, repeatU = false): Batch | null {
        if (texture.length === 0) return null;
        const key = `${texture}|${blend}|${repeatU ? 1 : 0}`;
        let b = this.batches.get(key);
        if (!b) {
            const gl = this.gl;
            const cap = 1024 * 6;
            b = {
                pos: new Float32Array(cap * 3),
                uv: new Float32Array(cap * 2),
                color: new Float32Array(cap * 4),
                cap,
                count: 0,
                posBuf: gl.createBuffer()!,
                uvBuf: gl.createBuffer()!,
                colorBuf: gl.createBuffer()!,
                glCap: 0,
                texture,
                blend,
                repeatU,
            };
            this.batches.set(key, b);
        }
        return b;
    }

    private ensureCapacity(batch: Batch, verts: number): void {
        if (verts <= batch.cap) return;
        let cap = batch.cap;
        while (cap < verts) cap *= 2;
        const pos = new Float32Array(cap * 3);
        const uv = new Float32Array(cap * 2);
        const color = new Float32Array(cap * 4);
        pos.set(batch.pos.subarray(0, batch.count * 3));
        uv.set(batch.uv.subarray(0, batch.count * 2));
        color.set(batch.color.subarray(0, batch.count * 4));
        batch.pos = pos;
        batch.uv = uv;
        batch.color = color;
        batch.cap = cap;
    }

    private uploadBatch(batch: Batch): void {
        const gl = this.gl;
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.posBuf);
        if (batch.count > batch.glCap) gl.bufferData(gl.ARRAY_BUFFER, batch.cap * 3 * 4, gl.DYNAMIC_DRAW);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.pos.subarray(0, batch.count * 3));
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.uvBuf);
        if (batch.count > batch.glCap) gl.bufferData(gl.ARRAY_BUFFER, batch.cap * 2 * 4, gl.DYNAMIC_DRAW);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.uv.subarray(0, batch.count * 2));
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.colorBuf);
        if (batch.count > batch.glCap) gl.bufferData(gl.ARRAY_BUFFER, batch.cap * 4 * 4, gl.DYNAMIC_DRAW);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, batch.color.subarray(0, batch.count * 4));
        if (batch.count > batch.glCap) batch.glCap = batch.cap;
    }

    private resolveTexture(path: string): WebGLTexture | null {
        let state = this.textures.get(path);
        if (!state) {
            state = { canvas: null, texture: null };
            this.textures.set(path, state);
            const target = state;
            this.loadTexture(pkbTexturePath(path)).then(
                (canvas) => {
                    target.canvas = canvas;
                    if (!canvas) this.warnOnce(path, `[pkb] texture ${path} is missing`);
                },
                () => {
                    this.warnOnce(path, `[pkb] texture ${path} is missing`);
                },
            );
            return null;
        }
        if (!state.canvas) return null;
        if (state.texture) return state.texture;
        const gl = this.gl;
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, state.canvas);
        // A particle is a screen-space sprite: no mipmaps, or a 3-pixel spark averages away.
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        state.texture = tex;
        return tex;
    }

    dispose(): void {
        const gl = this.gl;
        for (const b of this.batches.values()) {
            gl.deleteBuffer(b.posBuf);
            gl.deleteBuffer(b.uvBuf);
            gl.deleteBuffer(b.colorBuf);
        }
        this.batches.clear();
        for (const t of this.textures.values()) if (t.texture) gl.deleteTexture(t.texture);
        this.textures.clear();
        this.tracks.clear();
        this.defs.clear();
        gl.deleteProgram(this.program);
    }
}

/** `SharedFX/Wisp/WispWork.pkfx` -> `SharedFX\Wisp\WispWork.pkb`. */
function pkbPath(path: string): string {
    let p = path.replace(/\//g, "\\");
    const hd = p.toLowerCase().indexOf("_hd.w3mod\\");
    if (hd >= 0) p = p.slice(hd + "_hd.w3mod\\".length);
    else {
        const mod = /^[^\\]+\.w3mod\\/i.exec(p);
        if (mod) p = p.slice(mod[0].length);
    }
    return p.replace(/\.pkfx$/i, ".pkb");
}

/** A bake's texture path is install-absolute; strip the HD module prefix. */
function pkbTexturePath(path: string): string {
    let p = path.replace(/\//g, "\\");
    const hd = p.toLowerCase().indexOf("_hd.w3mod\\");
    if (hd >= 0) return p.slice(hd + "_hd.w3mod\\".length);
    const mod = /^[^\\]+\.w3mod\\/i.exec(p);
    if (mod) p = p.slice(mod[0].length);
    return p;
}

function nodeWorldMatrix(instance: SceneInstance, objectId: number): Float32Array | number[] {
    const node = instance.nodes?.[objectId];
    return node?.worldMatrix ?? instance.worldMatrix;
}

/** Reinterprets a world-unit node matrix as the effect's metre space: rotation and scale are
 *  unchanged, only the translation is divided. See {@link PkbOverlay.update}. */
function worldInMetres(m: Float32Array | number[]): number[] {
    const out = Array.from(m);
    out[12] /= UNITS_PER_METRE;
    out[13] /= UNITS_PER_METRE;
    out[14] /= UNITS_PER_METRE;
    return out;
}

/** A CORN node's animation-visibility guide, in the shape the game matches it by. */
interface CornGuide {
    /** Some sequence turns the node off, or turns it on only for named sequences. */
    selective: boolean;
    /** `Always=On` — run whenever no listed sequence says otherwise. */
    always: boolean;
    /** Sequence-name token sets that turn the node on (`Attack`, `Walk 1`, `Lightning`). */
    on: string[][];
    /** Sequence-name token sets that turn it off (`Death`, `Dissipate`, `Portrait`). */
    off: string[][];
    /** True when at least one sequence turns it ON — those are the bursts to replay. */
    triggered: boolean;
}

/**
 * Parse a CORN guide: `Always=Off,Attack=On`; `Always=On,Death=Off,Dissipate=Off,Portrait=Off`;
 * `Always=off, Stand Work=on`; the malformed `Alternate+Off` / `Channel-Off` spellings the store's
 * own models carry; and `Dissipate=FStart/On-FEnd/Off`, which means the whole clip.
 *
 * A key is matched as ANIMATION TAGS, not as an exact sequence name: `Lightning` runs during
 * `Spell Chain Lightning Light 1`, and `Attack` during `Attack 1` — the same token matching the
 * game itself uses (HeroFarSeer's guides name neither sequence in full).
 */
function cornGuide(text: string | undefined): CornGuide {
    const guide: CornGuide = { selective: false, always: true, on: [], off: [], triggered: false };
    if (!text) return guide;
    for (const raw of text.split(",")) {
        const part = raw.trim();
        if (!part) continue;
        // `=`/`:` separate a key from its value; `+`/`-` are how `Alternate+Off`/`Channel-Off`
        // spell the same thing (accepting them costs nothing and the models really do this).
        const match = /^(.+?)\s*(?:=|:|\+|-)\s*(.*)$/i.exec(part);
        if (!match) continue;
        const key = match[1].toLowerCase().split(/\s+/).filter(Boolean);
        const value = match[2].trim().toLowerCase();
        if (key.length === 0) continue;
        // `on` / `FStart/On-FEnd/Off` both start the node for the sequence; `off` stops it.
        const isOn = value === "on" || value.startsWith("on/") || value.includes("/on");
        const isOff = value === "off" || value.startsWith("off/") || value.endsWith("/off");
        if (!isOn && !isOff) continue;
        if (key.length === 1 && key[0] === "always") {
            guide.always = isOn;
            if (isOff) guide.selective = true;
            continue;
        }
        if (isOn) {
            guide.on.push(key);
            guide.triggered = true;
        } else {
            guide.off.push(key);
        }
        guide.selective = true;
    }
    return guide;
}

/** Does `guide` let its node run while `instance` plays its current sequence? */
function cornGuideRuns(guide: CornGuide, instance: SceneInstance): boolean {
    if (!guide.selective) return true;
    const index = instance.sequence ?? -1;
    const sequence = index >= 0 ? instance.model.sequences?.[index] : undefined;
    // A node on a static effect model has no sequence to gate on: the guide's off-list cannot
    // match anything, and `Always=on` is the usual answer.
    if (!sequence) return true;
    const tags = sequence.name.toLowerCase().split(/\s+/).filter(Boolean);
    const names = (key: string[]): boolean => key.every((tag) => tags.includes(tag));
    for (const key of guide.off) if (names(key)) return false;
    for (const key of guide.on) if (names(key)) return true;
    return guide.always;
}

function applyBlend(gl: GL, blend: PopcornBlend): void {
    switch (blend) {
        case PopcornBlend.Additive:
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
            break;
        case PopcornBlend.AdditiveNoAlpha:
            gl.blendFunc(gl.ONE, gl.ONE);
            break;
        case PopcornBlend.Premultiplied:
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            break;
        default:
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            break;
    }
}

function setEnabled(gl: GL, cap: number, on: boolean): void {
    if (on) gl.enable(cap);
    else gl.disable(cap);
}

function compileShader(gl: GL, type: number, src: string): WebGLShader {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`PKB shader compile failed: ${log}`);
    }
    return sh;
}

function compileProgram(gl: GL, vs: string, fs: string): WebGLProgram {
    const p = gl.createProgram()!;
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`PKB program link failed: ${gl.getProgramInfoLog(p)}`);
    }
    return p;
}
