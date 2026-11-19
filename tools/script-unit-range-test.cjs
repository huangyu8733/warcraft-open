// Two range bugs that read as "the unit is standing right there and refuses to attack".
//
// 1. A building TARGET was measured by its collision circle instead of the footprint it
//    occupies. `inWeaponRange` subtracted `t.radius` (a Town Hall's is a few units) from the
//    centre distance, so a melee unit hugging the visible wall was "Target is outside range".
//    `assignAttackSlot` already sizes a melee ring off the footprint — the range test has to
//    answer the same question with the same hull.
//
// 2. A script-created unit's BODY was placed at the requested point while `SimWorld.add`
//    settled its sim unit onto a clear spot. The model then stands where the trigger asked
//    (beside the enemy) and the sim body is a cell or two away — same "out of range" read.
//    The spawn record has to carry the settled position.
//
// Run: pnpm sim:test  (compiles the sim to CommonJS first — see tools/tsconfig.sim.json)

const { join } = require("node:path");
const REPO = join(__dirname, "..");
require("node:fs").writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');
const { SimWorld } = require(join(REPO, ".sim-build", "src", "sim", "world.js"));
const { PathingGrid } = require(join(REPO, ".sim-build", "src", "sim", "pathing.js"));

let failed = 0;
const check = (what, ok, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
};

const CELL = 32;
const W = 96, H = 96;
const grid = () => new PathingGrid({ width: W, height: H, flags: new Uint8Array(W * H) }, [0, 0]);

const WEAPON = () => ({
  enabled: true, targets: ["ground", "air", "structure"], ranged: false,
  damage: 12, baseDamage: 12, dice: 1, baseDice: 1, sides: 6,
  cooldown: 1.2, baseCooldown: 1.2, range: 90, baseRange: 90, rangeBuffer: 250,
  damagePoint: 0.4, baseDamagePoint: 0.4, backswing: 0.3, baseBackswing: 0.3,
  spillDist: 0, spillRadius: 0, baseSpillDist: 0, baseSpillRadius: 0, damageLoss: 0,
  acquire: 500, attackType: "normal", missileArt: "", missileSpeed: 0,
  launchX: 0, launchY: 0, launchZ: 0, impactZ: 0,
});

function unit(id, typeId, x, y, over = {}) {
  const weapons = over.weapons ?? [WEAPON()];
  return {
    id, owner: 0, team: 0, typeId, x, y, facing: 0,
    hp: 100000, maxHp: 100000, mana: 0, maxMana: 0, manaRegen: 0, hpRegen: 0,
    speed: 270, turnRate: 6, radius: 16, scale: 1,
    armor: 0, armorType: "medium", defUp: 0,
    sightDay: 3000, sightNight: 3000,
    flying: false, mechanical: false, invulnerable: false, race: "human",
    isBuilding: false, foodCost: 2, goldCost: 0, lumberCost: 0,
    upgrades: [], moveType: "foot", collisionSize: 16,
    canFlee: true, targetedAs: "ground", deathTime: 2, name: typeId,
    worker: null, depotGold: false, depotLumber: false,
    castPoint: 0, castBackswing: 0,
    ...over, weapons, oldWeapons: weapons,
  };
}

const buildingState = () => ({
  constructionLeft: 0, buildTimeTotal: 1, builderIds: [], goldCost: 0, lumberCost: 0,
  queue: [], rallyX: 0, rallyY: 0, rallyKind: "point", rallyTargetId: 0, producesUnits: false,
});

/** A 5x5 fully blocked stamp: `footprintRadius` answers 80 (its half-extent). */
const stamp5 = () => ({ w: 5, h: 5, blocked: new Array(25).fill(true), buildBlocked: new Array(25).fill(true) });

// Cell-centre coordinates, so `settle()`'s snap cannot move either body.
const AX = 304, AY = 496; // cell (9,15)
const TX = 464, TY = 496; // cell (14,15) — 160 units away

// ── 1. A building target is measured by its footprint ──────────────────────────────────
console.log("a melee unit hugging a building's wall is in range");
{
  const w = new SimWorld(grid(), 1);
  // Immobile attacker: `speed 0` is what makes `canPursue` false and lets the refusal speak.
  w.add(unit(1, "hfoo", AX, AY, { speed: 0 }));
  w.add(
    unit(2, "htow", TX, TY, { speed: 0, isBuilding: true, targetedAs: "structure", radius: 16 }),
    buildingState(),
  );
  w.setPathStamp(2, stamp5(), TX, TY);
  const refusal = w.attackRefusal(1, 2, true);
  // Centre gap 160; minus both hulls (16 + 80) = 64, inside the 90 melee band. Before the
  // fix the target's 16-unit collision circle was used instead: 160 - 32 = 128 > 90.
  check("no 'outside range' for a target at the wall", refusal === null, String(refusal));
}

// ── 2. …and the fix is not a blanket range increase ────────────────────────────────────
// The same geometry against a small-bodied target is genuinely out of reach and must still be
// refused, so the footprint rule cannot be masking a loosened range check.
console.log("the same distance to a small body is still out of range");
{
  const w = new SimWorld(grid(), 1);
  w.add(unit(1, "hfoo", AX, AY, { speed: 0 }));
  w.add(unit(2, "hfoo", TX, TY));
  const refusal = w.attackRefusal(1, 2, true);
  check("still refused (160 - 32 = 128 > 90)", refusal === "Notinrange", String(refusal));
}

// ── 3. add() settles a body off blocked ground; the spawn record must read it back ─────
// `RtsController.createScriptUnit` now pushes `su.x / su.y` into `scriptSpawns`. That is only
// meaningful because the sim position is the authoritative one — pin the displacement here.
console.log("a unit added on blocked ground is settled onto a free cell");
{
  const g = grid();
  g.block(9, 15); // the cell the trigger asks for
  const w = new SimWorld(g, 1);
  const su = w.add(unit(1, "hfoo", AX, AY));
  check("the sim body is not left on the blocked point", su.x !== AX || su.y !== AY, `at ${su.x},${su.y}`);
  const cx = Math.floor(su.x / CELL), cy = Math.floor(su.y / CELL);
  check("it stands on a walkable cell", g.walkable(cx, cy) === true, `cell ${cx},${cy}`);
}

if (failed) {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
console.log("\nscript-unit-range: all checks passed");
