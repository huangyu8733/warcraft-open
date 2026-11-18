// A map from MDX replaceable-id to the art its path stands for. Typed with a number index
// signature so callers that look it up with a parsed `replaceableId` (a number) are not an
// implicit-any index.
const replaceableIds: Record<number, string> = {
  1: 'TeamColor/TeamColor00',
  2: 'TeamGlow/TeamGlow00',
  11: 'Cliff/Cliff0',
  21: '', // Used by all cursor models (HumanCursor, OrcCursor, UndeadCursor, NightElfCursor)
  31: 'LordaeronTree/LordaeronSummerTree',
  32: 'AshenvaleTree/AshenTree',
  33: 'BarrensTree/BarrensTree',
  34: 'NorthrendTree/NorthTree',
  35: 'Mushroom/MushroomTree',
  36: 'RuinsTree/RuinsTree',
  37: 'OutlandMushroomTree/MushroomTree',
};

export default replaceableIds;
