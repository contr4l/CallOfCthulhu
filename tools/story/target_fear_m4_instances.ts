/** Public-action M4 route testing whether identical firearm instances are preserved. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { advance, initialState, project } from "../../packages/engine/index.js";
import type { SceneView } from "../../packages/contracts/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";

type Draw = { min: number; max: number; value: number };
type Step = { node: string; action: string; label: string; draws: Draw[]; resultNode: string };
const packagePath = resolve(process.env.FEAR_M4_INSTANCE_PACKAGE ?? "stories/alone-against-fear/1.0.2/story.json");
const manifestBytes = readFileSync(packagePath);
const story = loadFragmentStory(packagePath, input => runtimeGraphSchema.parse(input), validateStory);
validateStory(story);
const sourcePdf = story.fear!.source.pdfSha256;
const runtimeSha256 = runtimeFingerprint();
const caseId = process.env.FEAR_M4_INSTANCE_CASE === "one-qualified" ? "one-qualified" : "two-qualified";
const startingAmmoFaces = caseId === "two-qualified" ? [6, 6] : [1, 1];
const armoryAmmoFace = caseId === "two-qualified" ? 6 : 1;
const foundGunAmmoFaces = caseId === "two-qualified" ? [3, 3] : [2, 2];
const expectedAmmo = startingAmmoFaces.reduce((sum, value) => sum + value, 0) + armoryAmmoFace + foundGunAmmoFaces.reduce((sum, value) => sum + value, 0);
const expectedQualifiedFirearms = caseId === "two-qualified" ? 2 : 1;
const sourceFiles = [
  "section-mission-table-continued.json", "section-store-table.json", "section-keep-track-of-ammo.json", "section-town-exploration-table.json",
];
const sourceFragmentSha256 = Object.fromEntries(sourceFiles.map(file => [file, createHash("sha256").update(readFileSync(resolve("scripts/alone-against-fear/fragments", file))).digest("hex")]));
let planned: number[] = [];
let draws: Draw[] = [];
const dice = (min: number, max: number) => {
  const value = planned.shift() ?? min;
  assert.ok(Number.isInteger(value) && value >= min && value < max, `planned die ${value} outside ${min}..${max - 1}`);
  draws.push({ min, max, value });
  return value;
};
planned = [4, 1]; // Actual opening mission-table D6 selects mission 4.
let state = initialState(story, createCharacter("M4重复枪实例路线", story.presets[0], 0), dice);
const initialDraws = draws.slice();
assert.equal(state.fear?.missionId, "4");
const steps: Step[] = [];
const view = () => project(story, state, "fear-m4-duplicate-instance", steps.length) as SceneView;
function act(matches: RegExp, faces: number[] = []) {
  const scene = view();
  const action = scene.actions.find(candidate => matches.test(candidate.label));
  assert.ok(action, `no public action matching ${matches}; node=${state.nodeId}; pending=${scene.fear?.pending?.kind}; actions=${scene.actions.map(candidate => candidate.label).join(" | ")}`);
  planned = faces.slice();
  draws = [];
  const next = advance(story, state, action.id, dice);
  steps.push({ node: state.nodeId, action: action.id, label: action.label, draws: draws.slice(), resultNode: next.state.nodeId });
  state = next.state;
  return view();
}
function move(box: number, faces: number[] = []) { return act(new RegExp(`前往.*第${box}格`), faces); }

act(/^生命\+3/);
act(/^斗士 \+ 坚韧$/);
// Source random-weapon table D6=5 grants a pistol; its ammo is rolled by setup.
act(/^第1张地图·第1格/, [5, ...startingAmmoFaces, 2, 6, 6, 1]);
assert.equal(state.fear?.weaponIds.filter(id => id === "pistol").length, 1);
const initialPistolAmmo = state.fear?.ammo.pistol ?? 0;
assert.equal(initialPistolAmmo, startingAmmoFaces.reduce((sum, value) => sum + value, 0));

// Reach an adjacent Store through the actual Town Exploration table's 8 result,
// then choose the printed Store branch and the printed Armory result.
move(2, [1, 5, 2]); // Town roll 6 -> Street.
move(3, [2, 6]); // Town roll 8 -> choose Store or Street.
assert.equal(view().fear?.pending?.kind, "table-choice");
// Store D6=3 is Armory; encounter D6=6 avoids the 4-in-6 encounter.
const storeScene = act(/^商店表$/, [3, 6]);
assert.equal(storeScene.fear?.pending?.kind, "source-choice");
const armoryWeapons = Object.keys(story.fear!.weapons).filter(id => !new Set(["unarmed", "antique-flail", "scythe-shovel", "chainsaw"]).has(id));
const pistolSearchIndex = armoryWeapons.indexOf("pistol");
assert.ok(pistolSearchIndex >= 0);
// The Armory's per-weapon D6 succeeds specifically for pistol; all other chances fail.
// The first face adds the Armory's separate D6 pistol ammunition. A successful
// second-pistol roll is followed by its source 2D6 ammo, then other search rolls.
const armoryFaces = armoryWeapons.flatMap(id => id === "pistol" ? [1, ...foundGunAmmoFaces] : [5]); // 5 fails without exploding the source D6.
const afterArmory = act(/^手枪$/, [armoryAmmoFace, ...armoryFaces]);
const afterArmoryWeaponIds = [...(state.fear?.weaponIds ?? [])];
const afterArmoryPistolAmmo = state.fear?.ammo.pistol ?? 0;
assert.equal(afterArmoryWeaponIds.filter(id => id === "pistol").length, 2);
assert.equal(afterArmoryPistolAmmo, expectedAmmo); // Starting pool + Armory D6 + found pistol 2D6.
assert.equal(afterArmory.fear?.pending, undefined);

move(2, [6]);
move(1, [6]);
assert.ok(view().actions.some(action => action.label === "完成当前任务"));
const beforeDelivery = {
  weaponIds: [...(state.fear?.weaponIds ?? [])], ammo: { ...(state.fear?.ammo ?? {}) },
  pistolInstances: state.fear?.weaponIds.filter(id => id === "pistol").length ?? 0,
  qualifiedFirearmKindsAndCopies: ["pistol", "rifle", "shotgun"].reduce((sum, id) => {
    const copies = state.fear?.weaponIds.filter(value => value === id).length ?? 0;
    return sum + Math.min(copies, Math.floor(Math.max(0, state.fear?.ammo[id] ?? 0) / 6));
  }, 0),
};
act(/^完成当前任务$/);
const report = {
  format: "fear-m4-public-firearm-instance-witness@1", caseId,
  conclusion: "source permits up to five firearm rewards and this legal Armory route finds a second pistol; identical pistols share ammunition under the source rule, while each copy still needs six rounds to qualify. Paired routes verify 24 shared rounds award 2 XP and 7 rounds award 1 XP.",
  storyId: story.id, storyVersion: story.version, sourcePdfSha256: sourcePdf,
  sourceFragmentSha256,
  manifestPath: "work/alone-against-fear/mission-route-package/story.json",
  manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), runtimeSha256,
  sourceBasis: [
    { fragment: "section-mission-table-continued:p1", locator: "PDF p.41; mission 4", rule: "deliver firearms (pistols, rifles, shotguns); gain 1 XP per firearm with at least 6 ammo, maximum 5 XP" },
    { fragment: "section-store-table:p3", locator: "PDF p.51; Store table, result 3", rule: "Armory has a 1-in-6 find chance rolled once per weapon; an ammo-using found weapon also grants 2D6 ammo" },
    { fragment: "section-keep-track-of-ammo:p1,p7", locator: "PDF p.31", rule: "track ammunition with each ranged weapon; ammo can be shared only by exactly identical weapons; use a separate counter for each weapon" },
    { fragment: "section-town-exploration-table:p1", locator: "PDF p.42; Town Exploration table", rule: "result 8 permits Store or Street" },
  ],
  routeMethod: "Initial mission selection, character setup, movement, town/store selections, Armory result, weapon-ammo selection, per-weapon search, return and completion all use legal actions from project() and advance(); no state or inventory injection.",
  initialDraws, routeSteps: steps,
  duplicateAttempt: {
    actionStep: steps.findIndex(step => step.label === "手枪") + 1,
    targetWeaponId: "pistol", sourceSearchIndex: pistolSearchIndex, sourceWeaponSearchOrder: armoryWeapons,
    successfulArmoryChance: steps.find(step => step.label === "手枪")?.draws[pistolSearchIndex + 1],
    foundPistolAmmo2D6: steps.find(step => step.label === "手枪")?.draws.slice(pistolSearchIndex + 2, pistolSearchIndex + 4).map(draw => draw.value),
    pistolAmmoBefore: initialPistolAmmo, pistolAmmoAfter: afterArmoryPistolAmmo,
    weaponIdsBefore: ["knife", "pistol"], weaponIdsAfter: afterArmoryWeaponIds,
  },
  beforeDelivery,
  completion: { missionFinished: state.fear?.missionFinished ?? false, xp: state.fear?.xp ?? 0, completedMissions: state.fear?.completedMissions ?? [] },
  thresholdCheck: { expectedQualifiedFirearms, actualQualifiedFirearms: beforeDelivery.qualifiedFirearmKindsAndCopies,
    formula: "sum_by_type min(physicalCopies[type], floor(sharedAmmo[type] / 6))" },
};
assert.equal(report.completion.missionFinished, true);
assert.equal(report.beforeDelivery.qualifiedFirearmKindsAndCopies, expectedQualifiedFirearms);
assert.equal(report.completion.xp, expectedQualifiedFirearms);
const output = resolve(caseId === "two-qualified"
  ? "work/alone-against-fear/m4-firearm-instance-witness.json"
  : "work/alone-against-fear/m4-firearm-instance-threshold-witness.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, steps: steps.length, initialPistolAmmo, afterArmoryPistolAmmo, duplicateAttempt: report.duplicateAttempt, beforeDelivery, completion: report.completion }, null, 2));
