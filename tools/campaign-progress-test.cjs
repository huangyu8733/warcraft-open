// Headless check of WHAT THE CAMPAIGN SCREEN MAY SHOW (src/data/campaignProgress.ts).
//
// This client unlocks the whole library: every campaign and every chapter is on the screen from
// the first visit, so a player can jump straight to any mission instead of clearing the ones
// before it. The two lists the screens are built from (`openCampaigns` / `openRows`) are pinned
// here because a screenshot only shows the rows that were built, not the ones that were
// withheld — and because "listed" and "beaten" must not drift back together: `completed()` still
// tracks progress for the badges, but it must never hide or reorder a row.
//
// The fixtures are the real campaign indexes' own shape (UI\CampaignStrings.txt and
// UI\CampaignStrings_exp.txt).
//
// Run: pnpm sim:test
const { join } = require("node:path");
const REPO = join(__dirname, "..");
require("node:fs").writeFileSync(join(REPO, ".sim-build", "package.json"), '{"type":"commonjs"}');

let failed = 0;
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}`);
  if (!ok) console.log(`        want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const C = require(join(REPO, ".sim-build", "src", "data", "campaignProgress.js"));

const entry = (header, name, file, mission) => ({
  header, name, file, mission, playable: /\.w3[mx]$/i.test(file),
});
const chapters = (n) => Array.from({ length: n }, (_, i) => entry(`Chapter ${i + 1}`, `Map ${i + 1}`, `M${i + 1}.w3x`, true));
const campaign = (key, defaultOpen, missions, extra = {}) => ({
  key, header: key, name: key, defaultOpen, missions,
  intro: null, open: null, end: null, ...extra,
});

// TFT's CampaignList order, and its two DefaultOpen=1 sections.
const tft = [
  campaign("NightElf", true, chapters(8), { open: entry("Cinematic", "The Awakening", "IntroX", false) }),
  campaign("Human", false, chapters(8)),
  campaign("Undead", false, chapters(14), { end: entry("Cinematic", "The Ascension", "OutroX", false) }),
  campaign("Orc", true, chapters(6)),
];
const names = (list) => list.map((x) => x.campaign.key);
const rows = (c) => C.openRows(c).map((r) => `${r.entry.name}#${r.mission}`);

console.log("every campaign is listed, whatever the profile has played");
{
  store.clear();
  check("TFT: all four, in CampaignList order", names(C.openCampaigns(tft)),
    ["NightElf", "Human", "Undead", "Orc"]);
  const roc = [
    campaign("RoC.Tutorial", true, chapters(4)),
    campaign("RoC.Human", true, chapters(9)),
    campaign("RoC.Undead", false, chapters(8)),
    campaign("RoC.Orc", false, chapters(8)),
    campaign("RoC.NightElf", false, chapters(7)),
  ];
  check("RoC: all five", names(C.openCampaigns(roc)),
    ["RoC.Tutorial", "RoC.Human", "RoC.Undead", "RoC.Orc", "RoC.NightElf"]);
  C.markMissionComplete("RoC.Human", 8);
  check("and progress does not change the list", names(C.openCampaigns(roc)),
    ["RoC.Tutorial", "RoC.Human", "RoC.Undead", "RoC.Orc", "RoC.NightElf"]);
}

console.log("\na chapter list lists every chapter from the first visit");
{
  store.clear();
  const sentinels = tft[0];
  check("the opening cinematic and all eight maps", rows(sentinels), [
    "The Awakening#-1",
    "Map 1#0", "Map 2#1", "Map 3#2", "Map 4#3",
    "Map 5#4", "Map 6#5", "Map 7#6", "Map 8#7",
  ]);
  const before = rows(sentinels);
  C.markMissionComplete("NightElf", 3);
  check("finishing one changes no row", rows(sentinels), before);
  check("but the count still advances", C.completed(sentinels), 4);
}

console.log("\nthe closing cinematic is on the list from the start too");
{
  store.clear();
  const scourge = tft[2];
  check("fourteen maps and the finale", rows(scourge).length, 14 + 1);
  check("with the finale last", rows(scourge).slice(-1), ["The Ascension#-1"]);
  check("and nothing beaten yet", C.completed(scourge), 0);
}

console.log(failed === 0 ? "\nall good" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
