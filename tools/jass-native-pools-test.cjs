// yk 地图集缺失 native 的 P0/P1 行为测试：物品池 / 单位池 / AbilityId / 联盟变更事件。
// 全部走无头解释器，不读地图文件，只用本机安装的 common.j + Blizzard.j。
//
//   npx tsc -p tools/tsconfig.jass.json && node tools/jass-native-pools-test.cjs

const { readFileSync, existsSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const REPO = resolve(__dirname, '..');
const BUILD = join(REPO, '.jass-build', 'src');
if (!existsSync(join(BUILD, 'jass', 'headless.js'))) {
  console.error('Build first:  npx tsc -p tools/tsconfig.jass.json');
  process.exit(2);
}
writeFileSync(join(REPO, '.jass-build', 'package.json'), '{"type":"commonjs"}');
const { buildInterpreter } = require(join(BUILD, 'jass', 'headless.js'));
const { COMPAT_PRELUDE } = require(join(BUILD, 'compat', 'prelude.js'));
const { rawcodeToInt } = require(join(BUILD, 'jass', 'lexer.js'));

const SCRIPTS = join(REPO, 'Warcraft III', 'ExtractedData', 'merged', 'Scripts');
if (!existsSync(join(SCRIPTS, 'common.j'))) {
  console.error("Run `pnpm data:extract` first — this test reads the install's own common.j.");
  process.exit(2);
}
const decode = (b) => new TextDecoder('windows-1252').decode(b);
const common = decode(readFileSync(join(SCRIPTS, 'common.j')));
const blizzard = decode(readFileSync(join(SCRIPTS, 'Blizzard.j')));

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${JSON.stringify(got)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
};

const SRC = `
globals
    integer fired = 0
endglobals
function ItemRoll takes nothing returns integer
    local itempool p = CreateItemPool()
    call ItemPoolAddItemType(p, 'ratc', 1)
    call ItemPoolAddItemType(p, 'ratf', 1)
    call ItemPoolRemoveItemType(p, 'ratf')
    return GetItemTypeId(PlaceRandomItem(p, 0.0, 0.0))
endfunction
function ItemRollAfterDestroy takes nothing returns boolean
    local itempool p = CreateItemPool()
    call ItemPoolAddItemType(p, 'ratc', 1)
    call DestroyItemPool(p)
    return PlaceRandomItem(p, 0.0, 0.0) == null
endfunction
function UnitRoll takes nothing returns integer
    local unitpool p = CreateUnitPool()
    call UnitPoolAddUnitType(p, 'hfoo', 1)
    call UnitPoolAddUnitType(p, 'hrif', 1)
    call UnitPoolRemoveUnitType(p, 'hrif')
    return GetUnitTypeId(PlaceRandomUnit(p, Player(0), 0.0, 0.0, 0.0))
endfunction
function UnitRollAfterDestroy takes nothing returns boolean
    local unitpool p = CreateUnitPool()
    call UnitPoolAddUnitType(p, 'hfoo', 1)
    call DestroyUnitPool(p)
    return PlaceRandomUnit(p, Player(0), 0.0, 0.0, 0.0) == null
endfunction
function AbilityIdWorks takes nothing returns boolean
    return AbilityId("AHbz") == 'AHbz'
endfunction
function NoEventTarget takes nothing returns boolean
    return GetEventTargetUnit() == null
endfunction
function OnAlliance takes nothing returns nothing
    set fired = fired + 1
endfunction
function WatchAlliance takes nothing returns nothing
    local trigger t = CreateTrigger()
    call TriggerRegisterPlayerAllianceChange(t, Player(0), ALLIANCE_SHARED_VISION)
    call TriggerAddAction(t, function OnAlliance)
endfunction
function ChangeAlliance takes boolean v returns nothing
    call SetPlayerAlliance(Player(0), Player(1), ALLIANCE_SHARED_VISION, v)
endfunction
function Fired takes nothing returns integer
    return fired
endfunction
`;

const alliances = new Map();
const hooks = {
  createUnit: (player, typeId) => (typeId === 'hfoo' || typeId === 'hrif' ? 1 : -1),
  getPlayerAlliance: (a, b, s) => alliances.get(`${a}:${b}:${s}`) ?? false,
  setPlayerAlliance: (a, b, s, v) => alliances.set(`${a}:${b}:${s}`, v),
};
const interp = buildInterpreter([common, COMPAT_PRELUDE, blizzard, SRC], { hooks, seed: 123 });
const call = (fn, args = []) => interp.callFunction(fn, args);

check('item pool: removed type can never be drawn', call('ItemRoll', []).n, rawcodeToInt('ratc'));
check('item pool: DestroyItemPool empties it', call('ItemRollAfterDestroy', []).b, true);
check('unit pool: removed type can never be drawn', call('UnitRoll', []).n, rawcodeToInt('hfoo'));
check('unit pool: DestroyUnitPool empties it', call('UnitRollAfterDestroy', []).b, true);
check('AbilityId matches the rawcode literal', call('AbilityIdWorks', []).b, true);
check('GetEventTargetUnit is null outside an event', call('NoEventTarget', []).b, true);

// 联盟变更事件：只在值真正改变时触发一次。
call('WatchAlliance', []);
call('ChangeAlliance', [{ k: 'bool', b: true }]);
check('alliance change fires once', call('Fired', []).n, 1);
call('ChangeAlliance', [{ k: 'bool', b: true }]);
check('…not again for the same value', call('Fired', []).n, 1);
call('ChangeAlliance', [{ k: 'bool', b: false }]);
check('…and again when it flips back', call('Fired', []).n, 2);

// 确定性：同 seed 的两次独立运行，抽取序列一致。
const rollSeq = () => {
  const i = buildInterpreter([common, COMPAT_PRELUDE, blizzard, SRC], { hooks, seed: 7 });
  return [i.callFunction('ItemRoll', []).n, i.callFunction('UnitRoll', []).n];
};
check('same seed, same pool draws', rollSeq(), rollSeq());

if (failures) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log('\nall pool native checks passed');
