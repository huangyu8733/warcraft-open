// PopcornFX `.pkb` runtime: container parsing, bytecode decoding, simulation and sprite extraction.
// Framework-agnostic: no DOM, no WebGL, no game imports. Simulation is in metres; sprite collection
// converts to Warcraft III units.

export {
    PkBakeFile,
    parsePkb,
    readPkbContainer,
} from './container';

export {
    PkCurve,
    PkEffectDef,
    PkEventSlot,
    PkFieldDef,
    PkLayerDef,
    PkLayerSlot,
    PkRendererDef,
    PkRendererKind,
    PkSampler,
    PkSamplerKind,
    PkShape,
    PopcornBillboardMode,
    PopcornBlend,
    randomUnit,
} from './defs';

export {
    PkKind,
    PkOp,
    PkScript,
    PkSpace,
    PkValue,
    isBoolKind,
    isIntKind,
    isNoneOperand,
    kindLanes,
} from './script';
export type { PkInstruction, PkOperand } from './script';

export {
    PkEffectInstance,
    PkEnvironment,
    PkLayerState,
} from './runtime';

export {
    PkRenderBatch,
    PkRibbonBatch,
    collectRibbons,
    collectSprites,
    createRenderBatches,
    createRibbonBatches,
    spriteCellUv,
    spriteQuad,
} from './sprite';
export type { PkRibbonPoint, PkSprite } from './sprite';

export type { Mat4, Quat, Vec3 } from './math';
export { PkRandom } from './math';
