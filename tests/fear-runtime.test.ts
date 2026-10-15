import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearDice, FearState, FearStory, FearTableEntry } from "../packages/contracts/fear.js";
import { validateFearReferences } from "../apps/api/src/fear-schema.js";
import { advanceFear, availableFearActions, initialFear, projectFear } from "../packages/engine/fear.js";
import { canUseWitchKnots } from "../packages/engine/fear-dice-window.js";

const definition: FearDefinition = {
  format: "aaf-fear-definition@1", source: { pdfSha256: "a".repeat(64), pages: 106 },
  map: { boxesPerSheet: 30, rows: 6, columns: 5, adjacency: "orthogonal", topologyBasis: "web-adaptation", start: { sheet: 1, box: 1 }, safehouseLimit: 3, safehouseLifetime: "nearest-first" },
  rules: { foodEveryBoxes: 5, townExplorationTable: "town", randomEncounterTable: "encounter", usefulItemTable: "useful", randomItemTable: "randomItems", maxScars: 3, maxTraumas: 3, searchOncePerBox: true, exploredAreaEncounter: { numerator: 1, denominator: 6 }, sixExplodes: true, naturalOneFails: true, naturalSixSucceeds: true },
  sceneRefs: { entry: "entry", exploration: "explore", missions: "missions", tables: { randomEncounter: "random" }, events: { "1": "event-1" }, specialEvents: { "1": "event-1" }, endings: { win: "win" } },
  eventPrograms: {},
  skills: { "danger-sense": { label: "危险感知", xp: 4, modifiers: {} }, investigator: { label: "调查员", xp: 6, modifiers: {} }, slippery: { label: "滑溜", xp: 3, modifiers: {} }, willpower: { label: "意志", xp: 6, modifiers: {} }, gate: { label: "门", xp: 0, kind: "arcane", modifiers: { magic: [1, 2] } } },
  weapons: { unarmed: { label: "徒手", damage: 1 }, knife: { label: "小刀", damage: 1, modifier: 1 } },
  enemies: {
    zombie: { label: "僵尸", level: 3, life: 1, damage: 1, surprise: 0, scene: "event-1" },
    "coven-witch": { label: "集会女巫", level: 4, life: 4, damage: 1, tags: ["human", "witch"] },
  },
  items: { bandage: { label: "bandage" } },
  tables: { town: { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] }, encounter: { die: "D6", entries: [{ roll: 1, result: "zombie", tags: ["enemy"] }] }, useful: { die: "D6", entries: [{ roll: [1, 6], result: "bandage", operations: [{ op: "item", itemId: "bandage", amount: 1 }] }] }, randomItems: { die: "D6", entries: [{ roll: [1, 6], result: "food", operations: [{ op: "resource", key: "food", amount: 1 }] }] }, safehouse: { die: "D6", entries: [{ roll: [1, 6], result: "safehouse", operations: [{ op: "mark-safehouse", threshold: "before-create-3" }] }] }, gate: { die: "D6", entries: [{ roll: [1, 6], result: "gate", operations: [{ op: "mark-gate" }] }] } },
  missions: { one: { label: "任务一", goal: "test", reward: { xp: 3 } } }, gates: { required: 7, level: 6, scene: "win" },
};
const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: ["entry", "explore", "missions", "random", "event-1", "win"].map(id => ({ id })), fear: definition };
function roller(...faces: number[]): FearDice { let index = 0; return () => faces[index++] ?? 1; }
function state(dice: FearDice = roller(1)) {
  const initial = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, weaponIds: ["knife"], weaponId: "knife" }, dice);
  return advanceFear(story, initial, { type: "choose", choice: "s1:b1" }, roller());
}
function resolvePendingAcquisition(story: FearStory, current: FearState, dice: FearDice = roller()) {
  let next = current;
  while (next.pending?.kind === "food-to-salt" || next.pending?.kind === "worship-symbol-visit") {
    const choice = next.pending.kind === "food-to-salt" ? "0" : "leave";
    const selected = availableFearActions(story, next).find(value => value.action.type === "choose" && value.action.choice === choice)?.action;
    assert.ok(selected, `public acquisition choice ${choice} is available`);
    next = advanceFear(story, next, selected, dice);
  }
  return next;
}
function combatState(dice: FearDice = roller(1)) {
  const encounterStory: FearStory = structuredClone(story);
  encounterStory.fear.tables.town.entries[0].operations = [{ op: "start-combat", enemyId: "zombie", count: 1 }];
  return { story: encounterStory, state: advanceFear(encounterStory, state(), { type: "move", target: "s1:b2" }, dice) };
}

test("Fear initialization validates source scene references and never uses CoC character checks", () => {
  const s = state(); assert.equal(s.status, "active"); assert.equal(s.food, 1); assert.equal(s.mapSheets[0].boxes.length, 30);
  assert.equal(projectFear(story, s).currentBox.id, "s1:b1");
  assert.throws(() => initialFear({ ...story, nodes: [] }, {}, roller(1)), /absent from Story.nodes/);
});

test("ordinary source D6 checks do not explode on six and still preserve natural-one failure", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.eventPrograms["1"] = [{ op: "roll-check", context: "will-save", level: 7,
    success: [{ op: "flag", key: "passed", value: true }], failure: [{ op: "flag", key: "passed", value: false }] }];
  let current = state();
  current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller(6, 1));
  assert.equal(current.missionProgress["flag:passed"], true);
  assert.ok(current.log.some(line => line.includes("will-save #") && line.endsWith(": 6")));
  current = state();
  current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller(1));
  assert.equal(current.missionProgress["flag:passed"], false);
  assert.ok(current.log.some(line => line.includes("1 => 1 (failure)")));
});

test("Fear source skill contexts canonicalize aliases and add compatible Will plus Occultist bonuses", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills.will = { label: "意志", xp: 6, modifiers: { "will-save": [1, 2], "magic-save": [1, 2] } };
  testStory.fear.skills.stealth = { label: "潜行", xp: 4, modifiers: { "stealth-save": [1, 2] } };
  testStory.fear.skills.occultist = { label: "神秘学者", xp: 4, modifiers: { "magic-save": [1, 2] } };
  const check = (context: string, level: number, skills: Record<string, 0 | 1 | 2>, face: number) => {
    testStory.fear.eventPrograms["1"] = [{ op: "roll-check", context, level,
      success: [{ op: "flag", key: "modifier-proof", value: true }],
      failure: [{ op: "flag", key: "modifier-proof", value: false }] }];
    const current = state(); current.skills = skills;
    current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
    return advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller(face));
  };
  assert.equal(check("willpower", 3, { will: 1 }, 2).missionProgress["flag:modifier-proof"], true,
    "the legacy Will-power operation context maps to Will's source Will Save modifier");
  assert.equal(check("stealth", 5, { stealth: 1 }, 4).missionProgress["flag:modifier-proof"], true,
    "the legacy Stealth operation context maps to the source Stealth Save modifier");
  assert.equal(check("magic-save", 5, { will: 1, occultist: 1 }, 3).missionProgress["flag:modifier-proof"], true,
    "Will and Occultist bonuses both apply to a Magic Save");
});

test("source D6 chance rolls use exactly one face and preserve the actual numerator/denominator odds", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.eventPrograms["1"] = [{ op: "probability", numerator: 3, denominator: 6,
    success: [{ op: "flag", key: "chance", value: true }], failure: [{ op: "flag", key: "chance", value: false }] }];
  const current = state(); current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  const success = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller(3));
  assert.equal(success.missionProgress["flag:chance"], true);
  const chanceSix = state(); chanceSix.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: chanceSix.visitCount };
  let draws = 0;
  const failure = advanceFear(testStory, chanceSix, { type: "resolve-event", target: "1" }, () => { draws++; return 6; });
  assert.equal(failure.missionProgress["flag:chance"], false);
  assert.equal(draws, 1);
  assert.ok(failure.log.some(line => line.includes("3/6 chance #") && line.endsWith(": 6")));
});

test("Attack dice still explode on natural six while ordinary checks consume a single die", () => {
  const source = JSON.parse(readFileSync("scripts/alone-against-fear/fragments/section-rolling-sixes-explosions.json", "utf8"));
  assert.match(source.paragraphs.find((p: { id: string }) => p.id === "section-rolling-sixes-explosions:p1").text, /natural 6 on an\s+Attack die/);
  const encounter = combatState();
  let draws = 0;
  const attacked = advanceFear(encounter.story, encounter.state, { type: "attack", weapon: "knife" }, () => { draws++; return draws === 1 ? 6 : 2; });
  assert.equal(draws, 2, "one extra D6 is consumed only because the Attack die showed six");
  assert.ok(attacked.log.some(line => line.includes("攻击1: 6+2 = 8")));
});

test("First Aid is a real post-encounter action and spends exactly its selected charges", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills.medic = { label: "医护员", xp: 3, modifiers: {} };
  const current = state(); current.hp = 3; current.lifeLostThisEncounter = true;
  current.inventory["first-aid-kit"] = 1; current.inventory["first-aid-charges"] = 5;
  current.skills.medic = 1;
  const action = availableFearActions(testStory, current).find(({ action }) => action.target === "first-aid" && action.amount === 3)?.action;
  assert.ok(action);
  const healed = advanceFear(testStory, current, action, roller());
  assert.equal(healed.hp, 6); assert.equal(healed.inventory["first-aid-charges"], 2);
  assert.equal(healed.lifeLostThisEncounter, false); assert.equal(healed.firstAidUsedThisEncounter, true);
});

test("defense menu lets a trained character choose Dodge or Agile and carries Dodge's natural-one penalty into one attack", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills.dodge = { label: "闪避", xp: 4, modifiers: { defense: [1, 2] } };
  testStory.fear.skills.agile = { label: "敏捷", xp: 8, modifiers: { defense: [1, 2] } };
  const current = state(); current.skills = { dodge: 1, agile: 1 };
  current.combat = { enemyId: "zombie", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 1, enemyLives: [1], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const options = availableFearActions(testStory, current).filter(option => option.action.type === "defend");
  assert.deepEqual(options.map(option => option.action.skill), ["dodge", "agile"]);
  let defended = advanceFear(testStory, current, { type: "defend", skill: "dodge" }, roller(1, 2));
  assert.equal(defended.combat?.dodgePenaltyPending, true);
  if (defended.pending) defended = advanceFear(testStory, defended, { type: "choose", choice: "take-loss" }, roller(1));
  defended.combat!.playerFirst = true;
  const attacked = advanceFear(testStory, defended, { type: "attack" }, roller(2));
  assert.equal(attacked.combat?.dodgePenaltyPending, false);
  assert.ok(attacked.log.some(line => line.includes("攻击造成")));
});

test("Rifle burst is a visible optional two-attack choice that pays exactly three bullets", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.weapons.rifle = { label: "步枪", damage: 2, modifier: 2, ammoType: "bullets", ammoPerAttack: 1, attacks: 1, tags: ["two-handed", "ranged"] };
  testStory.fear.enemies.zombie.life = 4;
  const current = state(); current.weaponIds.push("rifle"); current.weaponId = "rifle"; current.ammo.rifle = 3;
  current.combat = { enemyId: "zombie", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "rifle", surprise: false, attackDisabled: false };
  const action = availableFearActions(testStory, current).find(option => option.action.type === "attack" && option.action.shots === 2)?.action;
  assert.ok(action);
  const next = advanceFear(testStory, current, action!, roller(2, 2));
  assert.equal(next.ammo.rifle, 0);
  assert.equal(next.combat, undefined);
  assert.equal(next.combatResult?.outcome, "defeated");
  assert.equal(next.log.filter(line => line.startsWith("攻击" ) && line.includes("= ")).length, 2);
});

test("escaping preserves an occupied encounter; a failed Stealth revisit resumes it", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.zombie.level = 4;
  testStory.fear.tables.town.entries.forEach(entry => { entry.operations = []; });
  const current = state(); current.combat = { enemyId: "zombie", count: 1, defeatedCount: 0, enemyLevel: 4,
    enemyLife: 1, enemyLives: [1], enemyDamage: 1, damageResource: "hp", round: 1, playerFirst: true,
    surprise: false, weaponId: "knife", attackDisabled: false };
  let next = advanceFear(testStory, current, { type: "escape" }, roller(6, 1));
  assert.equal(next.combat, undefined); assert.equal(next.mapSheets[0].boxes[0].occupiedBy?.[0], "zombie");
  assert.ok(next.mapSheets[0].boxes[0].occupiedEncounter);
  next = advanceFear(testStory, next, { type: "move", target: "s1:b2" }, roller(1));
  next = advanceFear(testStory, next, { type: "move", target: "s1:b1" }, roller(1, 1));
  assert.equal(next.combat?.enemyId, "zombie");
  assert.deepEqual(next.combat?.enemyLives, [1]);
  next = advanceFear(testStory, next, { type: "attack" }, roller(6, 1));
  assert.equal(next.combatResult?.outcome, "defeated");
  assert.equal(next.mapSheets[0].boxes[0].occupiedEncounter, undefined, "defeating the resumed source enemy frees the original area");
  next = advanceFear(testStory, next, { type: "move", target: "s1:b2" }, roller(2, 1));
  next = advanceFear(testStory, next, { type: "move", target: "s1:b1" }, roller(2));
  assert.equal(next.combat, undefined, "a later return does not revive a defeated occupant");
});

test("holy water is a consumed automatic 2-damage attack only against demons or non-zombie undead", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items, "holy-water": { label: "圣水" } };
  testStory.fear.enemies.demon = { label: "恶魔", level: 4, life: 3, damage: 1, tags: ["demon"] };
  testStory.fear.enemies.vampire = { label: "吸血鬼", level: 4, life: 3, damage: 1, holyWaterDamage: 3, tags: ["undead"] };
  testStory.fear.enemies["demon-cat"] = { label: "恶魔猫", level: 4, life: 4, damage: 0, tags: ["susceptible-exorcism"] };
  testStory.fear.enemies.zombie = { ...testStory.fear.enemies.zombie, tags: ["undead", "zombie"] };
  const current = state(); current.inventory["holy-water"] = 1;
  current.combat = { enemyId: "demon", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const actions = availableFearActions(testStory, current);
  assert.ok(actions.some(({ action }) => action.type === "use-item" && action.target === "holy-water" && action.choice === "demon"));
  const injured = advanceFear(testStory, current, { type: "use-item", target: "holy-water", choice: "demon" }, roller());
  assert.equal(injured.combat?.enemyLife, 1);
  assert.equal(injured.inventory["holy-water"], undefined);
  current.combat!.enemyId = "zombie"; current.combat!.enemyLives = [1]; current.combat!.enemyLife = 1; current.combat!.count = 1;
  assert.ok(!availableFearActions(testStory, current).some(({ action }) => action.type === "use-item" && action.target === "holy-water"));
  assert.throws(() => advanceFear(testStory, current, { type: "use-item", target: "holy-water", choice: "zombie" }, roller()), /unavailable in the current phase/);
  current.combat!.enemyId = "demon-cat"; current.combat!.enemyLives = [4]; current.combat!.enemyLife = 4;
  assert.ok(!availableFearActions(testStory, current).some(({ action }) => action.type === "use-item" && action.target === "holy-water"));
  current.combat!.enemyId = "vampire"; current.combat!.enemyLives = [3]; current.combat!.enemyLife = 3;
  const undead = advanceFear(testStory, current, { type: "use-item", target: "holy-water", choice: "vampire" }, roller());
  assert.equal(undead.combat, undefined);
  assert.equal(undead.combatResult?.outcome, "defeated");
});

test("an ordinary vampire returns on a 2-in-6 movement check until the killing vial destroys its body", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.vampire = { label: "吸血鬼", level: 1, life: 1, damage: 1, tags: ["undead", "vampire"] };
  let current = state();
  current.combat = { enemyId: "vampire", count: 1, defeatedCount: 0, enemyLevel: 1, enemyLife: 1, enemyLives: [1], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  current = advanceFear(testStory, current, { type: "attack" }, roller(6, 2));
  assert.equal(current.missionProgress["vampire-return:vampire"], true);
  current = advanceFear(testStory, current, { type: "move", target: "s1:b2" }, roller(1));
  assert.equal(current.combat?.enemyId, "vampire");
  assert.equal(current.nodeId, "entry");
  current.combat!.enemyLives = [2]; current.combat!.enemyLife = 2; current.combat!.count = 1;
  current.inventory["holy-water"] = 1;
  testStory.fear.items = { ...testStory.fear.items, "holy-water": { label: "圣水" } };
  current.combat!.playerFirst = true;
  current = advanceFear(testStory, current, { type: "use-item", target: "holy-water", choice: "vampire" }, roller());
  assert.equal(current.missionProgress["vampire-return:vampire"], undefined);
  assert.ok(current.defeated.includes("vampire"));
});

test("a slain vampire can be permanently staked only with a carried stake and hammer", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.vampire = { label: "吸血鬼", level: 1, life: 1, damage: 1, tags: ["undead", "vampire"] };
  const current = state(); current.inventory.stakes = 1; current.weaponIds.push("hammer");
  current.combat = { enemyId: "vampire", count: 1, defeatedCount: 0, enemyLevel: 1, enemyLife: 1, enemyLives: [1], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  let slain = advanceFear(testStory, current, { type: "attack" }, roller(6, 1));
  assert.equal(slain.missionProgress["vampire-return:vampire"], true);
  assert.equal(slain.pending?.kind, "vampire-body");
  assert.ok(availableFearActions(testStory, slain).some(({ action, label }) => action.choice === "stake-body" && label.includes("木桩")));
  slain = advanceFear(testStory, slain, { type: "choose", choice: "stake-body" }, roller());
  assert.equal(slain.inventory.stakes, undefined);
  assert.equal(slain.missionProgress["vampire-return:vampire"], undefined);
  assert.equal(slain.combat, undefined);
});

test("strict Fear references recurse through grouped encounters and validate derived D3+1 faces", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.pack = { label: "狼群", level: 3, life: 1, damage: 1 };
  testStory.fear.eventPrograms.pack = [{ op: "start-combat-groups", groups: [{ enemyId: "pack", count: "D3+1" }], escapeAfter: { enemyId: "pack", defeated: 1 } },
    { op: "group-combat-outcome", primaryEnemyId: "pack", foodEnemyId: "pack", foodEach: "D6" }];
  testStory.fear.tables.pack = { die: "D3+1", entries: [
    { roll: 2, result: "two" }, { roll: 3, result: "three" }, { roll: 4, result: "four" },
  ] };
  testStory.fear.tables.encounter.entries = Array.from({ length: 6 }, (_, index) => ({ roll: index + 1, result: "zombie" }));
  assert.doesNotThrow(() => validateFearReferences(testStory as never));
  const bad = structuredClone(testStory); bad.fear.eventPrograms.pack[0] = { op: "start-combat-groups", groups: [{ enemyId: "missing", count: 1 }] };
  assert.throws(() => validateFearReferences(bad as never), /未知enemies missing/);
  const badItem = structuredClone(testStory); badItem.fear.eventPrograms.pack = [{ op: "item", itemId: "missing-item", amount: 1 }];
  assert.throws(() => validateFearReferences(badItem as never), /未定义物品或武器 missing-item/);
});

test("Mission 5 strict references require its source-grounded Coven witch profile", () => {
  const coven: FearStory = structuredClone(story);
  coven.fear.missions["5"] = { label: "摧毁女巫集会", goal: "击败五名女巫", kind: "witches" };
  coven.fear.tables.encounter.entries = Array.from({ length: 6 }, (_, index) => ({ roll: index + 1, result: "zombie" }));
  assert.doesNotThrow(() => validateFearReferences(coven as never));
  delete coven.fear.enemies["coven-witch"];
  assert.throws(() => validateFearReferences(coven as never), /任务引用未知enemies coven-witch/);
  coven.fear.enemies["coven-witch"] = { label: "女巫", level: 3, life: 4, damage: 1, tags: ["human", "witch"] };
  assert.throws(() => validateFearReferences(coven as never), /必须符合来源 L4 human/);
});

test("Medical Supplies mission has a localized, source-pinned medicine-dose item", () => {
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  assert.equal(canonical.items?.["medicine-dose"]?.label, "所需药剂（1剂）");
  const sourcePath = "scripts/alone-against-fear/fragments/section-mission-table.json";
  const source = JSON.parse(readFileSync(sourcePath, "utf8")) as { paragraphs: { id: string; text: string }[] };
  const paragraph = source.paragraphs.find(item => item.id === "section-mission-table:p1");
  assert.ok(paragraph?.text.includes("3 doses") && paragraph.text.includes("required medicines"));
  assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), "146b968450135d543ceb4808a7f7183a4212668812e17df01b56aa42ab898b34");
  const medical: FearStory = structuredClone(story);
  medical.fear.missions.medical = { label: "医疗物资", goal: "带回药品", kind: "medical-supplies" };
  medical.fear.items = { ...medical.fear.items, ...canonical.items };
  medical.fear.tables.encounter.entries = Array.from({ length: 6 }, (_, index) => ({ roll: index + 1, result: "zombie" }));
  assert.doesNotThrow(() => validateFearReferences(medical as never));
  delete medical.fear.items["medicine-dose"];
  assert.throws(() => validateFearReferences(medical as never), /medicine-dose.*section-mission-table:p1/);
});

test("counted source checks roll exactly the printed number of separate D6 checks", () => {
  const counted: FearStory = structuredClone(story);
  counted.fear.eventPrograms["1"] = [{ op: "roll-check-count", context: "defense", level: 3, count: "D6", failure: [{ op: "resource", key: "hp", amount: -1 }] }];
  let s = state(); s.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(counted, s, { type: "resolve-event", target: "1" }, roller(2, 1, 1));
  assert.equal(s.hp, 6); assert.equal(s.status, "active");
});

test("Bright Apparition offers a component-backed L3 exorcism and the printed XP-or-clue reward", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.apparition = { label: "显灵", level: 3, life: 1, damage: 0 };
  testStory.fear.items = { ...testStory.fear.items, "holy-water": { label: "圣水" } };
  testStory.fear.tables.ghosts = { die: "D6", entries: [{ roll: 1, result: "apparition", operations: [
    { op: "bright-apparition", exorcismSkillId: "exorcism" },
  ] }] };
  testStory.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "ghosts" }];
  let current = state(roller(1));
  current.arcaneSkills = { exorcism: 1 };
  current.inventory["holy-water"] = 1;
  current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller(1, 6));
  assert.deepEqual(current.pending?.options, ["leave", "exorcise:holy-water"]);
  current = advanceFear(testStory, current, { type: "choose", choice: "exorcise:holy-water" }, roller(6));
  assert.equal(current.pending?.kind, "apparition-reward");
  current = advanceFear(testStory, current, { type: "choose", choice: "clue" }, roller());
  assert.equal(current.clues, 1);
  assert.equal(current.xp, 0);
  assert.equal(current.inventory["holy-water"], 1);
});

test("Bright Apparition's failed L3 light save blinds only the next encounter's Attack, Defense, and Magic rolls", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-ghosts-table.json";
  const source = JSON.parse(readFileSync(sourcePath, "utf8")) as { paragraphs: { id: string; text: string }[] };
  const row = source.paragraphs.find(paragraph => paragraph.id === "section-ghosts-table:p1");
  assert.ok(row?.text.includes("Save vs. L3 light") && row.text.includes("Will rolls and saves are unaffected"));
  assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), "11141dab5ab5735eca580cc363e9caed555c8d646dd5cf5764841f84944b7c07");
  const testStory: FearStory = structuredClone(story);
  testStory.fear.eventPrograms["1"] = [{ op: "bright-apparition", exorcismSkillId: "exorcism" }];
  let current = state(); current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller(1));
  assert.equal(current.missionProgress["modifier:left:light-blind"], 1);
  current = advanceFear(testStory, current, { type: "choose", choice: "leave" }, roller());

  testStory.fear.enemies.hard = { label: "高等级目标", level: 4, life: 1, damage: 1 };
  testStory.fear.weapons.knife.modifier = 0;
  current.combat = { enemyId: "hard", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 1, enemyLives: [1], enemyDamage: 0,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  current = advanceFear(testStory, current, { type: "attack" }, roller(3));
  assert.equal(current.combat?.enemyLife, 1, "D6=3 would hit L4 without the source's -1 blindness penalty");

  current.combat = { enemyId: "hard", count: 1, defeatedCount: 0, enemyLevel: 1, enemyLife: 1, enemyLives: [1], enemyDamage: 0,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  current = advanceFear(testStory, current, { type: "attack" }, roller(6, 1));
  assert.equal(current.combat, undefined);
  assert.equal(current.missionProgress["modifier:left:light-blind"], 0, "the blindness modifier expires after the next encounter ends");

  const blindedDefense = state(); blindedDefense.missionProgress["modifier:left:light-blind"] = 1;
  blindedDefense.combat = { enemyId: "hard", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 1, enemyLives: [1], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const failedDefense = advanceFear(testStory, blindedDefense, { type: "defend" }, roller(4));
  assert.equal(failedDefense.pending?.kind, "injury-prevention", `the L4 Defense of 4 becomes 3 under the source penalty; hp=${failedDefense.hp}; log=${failedDefense.log.slice(-5).join(" | ")}`);

  const magicStory: FearStory = structuredClone(testStory);
  magicStory.fear.eventPrograms["1"] = [
    { op: "roll-check", context: "magic", level: 4, success: [{ op: "resource", key: "clues", amount: 1 }] },
    { op: "roll-check", context: "will-save", level: 4, success: [{ op: "resource", key: "clues", amount: 1 }] },
  ];
  const blindedMagic = state(); blindedMagic.missionProgress["modifier:left:light-blind"] = 1;
  blindedMagic.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: blindedMagic.visitCount };
  const checks = advanceFear(magicStory, blindedMagic, { type: "resolve-event", target: "1" }, roller(4, 4));
  assert.equal(checks.clues, 1, "the Magic roll fails at 3, but the unaffected L4 Will roll succeeds at 4");
});

test("an exorcism action can end an otherwise unkillable Tickling Ghost encounter", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills.exorcism = { label: "驱魔", xp: 2, kind: "arcane", modifiers: { exorcism: [0, 1] } };
  testStory.fear.items = { ...testStory.fear.items, "holy-water": { label: "圣水" } };
  testStory.fear.enemies.tickler = { label: "搔痒鬼", level: 4, life: 1, damage: 0, specialRule: "tickling-ghost" };
  const current = state(); current.arcaneSkills.exorcism = 1; current.inventory["holy-water"] = 1;
  current.combat = { enemyId: "tickler", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 1, enemyLives: [1], enemyDamage: 0,
    damageResource: "hp", round: 1, playerFirst: true, surprise: false, weaponId: current.weaponId, attackDisabled: false, specialRule: "tickling-ghost" };
  assert.ok(availableFearActions(testStory, current).some(({ action }) => action.type === "exorcise" && action.target === "holy-water"));
  const resolved = advanceFear(testStory, current, { type: "exorcise", target: "holy-water" }, roller(6));
  assert.equal(resolved.combat, undefined);
  assert.equal(resolved.combatResult?.outcome, "fled");
  assert.equal(resolved.xp, 1);
  assert.equal(resolved.inventory["holy-water"], 1);
});

test("Tickling Ghost menus suppress non-magic attacks and weapon switches", () => {
  const ghostStory: FearStory = structuredClone(story);
  ghostStory.fear.weapons["magic-sword"] = { label: "魔法剑", damage: 2, tags: ["magic"] };
  const s = state();
  s.combat = { enemyId: "tickling-ghost", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 1, enemyLives: [1], enemyDamage: 0,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", specialRule: "tickling-ghost", surprise: false, attackDisabled: false };
  const noMagic = availableFearActions(ghostStory, s);
  assert.ok(!noMagic.some(({ action }) => action.type === "attack" || action.type === "switch-weapon"));
  assert.ok(noMagic.some(({ action }) => action.type === "escape"));
  s.weaponIds.push("magic-sword");
  s.weaponId = "magic-sword"; s.combat.weaponId = "magic-sword";
  const withMagic = availableFearActions(ghostStory, s);
  assert.ok(withMagic.some(({ action }) => action.type === "attack"));
  assert.ok(withMagic.some(({ action }) => action.type === "switch-weapon" && action.weapon === "magic-sword"));
  assert.ok(!withMagic.some(({ action }) => action.type === "switch-weapon" && action.weapon === "knife"));
});

test("crippled arm forbids ordinary two-handed weapons but allows rifle and shotgun at -1 Attack", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.weapons.rifle = { label: "步枪", damage: 2, modifier: 2, tags: ["two-handed", "ranged", "club-mode"], ammoType: "bullets", ammoPerAttack: 1 };
  testStory.fear.weapons.shotgun = { label: "霰弹枪", damage: 2, modifier: 2, tags: ["ranged"], ammoType: "shells", ammoPerAttack: 1 };
  testStory.fear.weapons.axe = { label: "斧", damage: 2, tags: ["two-handed"] };
  testStory.fear.enemies.training = { label: "训练目标", level: 7, life: 5, damage: 1 };
  testStory.fear.injuries = { "crippled-arm": { label: "手臂残废", flags: ["no-two-handed-weapons", "rifle-shotgun-attack-minus-1"] } };
  const current = state();
  current.weaponIds.push("rifle", "shotgun", "axe");
  current.scars.push("crippled-arm");
  current.combat = { enemyId: "training", count: 1, defeatedCount: 0, enemyLevel: 7, enemyLife: 5, enemyLives: [5], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false };
  const actions = availableFearActions(testStory, current);
  assert.ok(actions.some(({ action }) => action.type === "switch-weapon" && action.weapon === "rifle"));
  assert.ok(actions.some(({ action }) => action.type === "switch-weapon" && action.weapon === "shotgun"));
  assert.ok(!actions.some(({ action }) => action.type === "switch-weapon" && action.weapon === "axe"));

  current.weaponId = "rifle"; current.combat.weaponId = "rifle"; current.ammo.rifle = 1;
  const crippledShot = advanceFear(testStory, current, { type: "attack" }, roller(5));
  assert.equal(crippledShot.combat?.enemyLife, 5, "5 + rifle +2 - crippled-arm 1 = 6, below L7");

  const uninjured = state();
  uninjured.weaponIds.push("rifle"); uninjured.weaponId = "rifle"; uninjured.ammo.rifle = 1;
  uninjured.combat = { ...current.combat!, enemyLives: [5], enemyLife: 5, count: 1, weaponId: "rifle", enemyId: "training", enemyLevel: 7, playerFirst: true };
  const normalShot = advanceFear(testStory, uninjured, { type: "attack" }, roller(5));
  assert.equal(normalShot.combat?.enemyLife, 3, "without the injury penalty the same attack reaches L7 and rifle damage is 2");
});

test("Ghost Librarian multi-component exorcism uses its printed L6 and awards no XP", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills.exorcism = { label: "驱魔", xp: 2, kind: "arcane", modifiers: { exorcism: [0, 1] } };
  testStory.fear.skills.willpower.modifiers = { exorcism: [1, 2] };
  testStory.fear.items = { ...testStory.fear.items, incense: { label: "熏香" }, "essential-oils": { label: "精油" } };
  testStory.fear.tables.town.entries[0].operations = [{ op: "ghost-librarian", exorcismSkillId: "exorcism", bookItemIds: ["book"] }];
  let current = state(); current.arcaneSkills.exorcism = 1; current.inventory.incense = 1; current.inventory["essential-oils"] = 1;
  current = advanceFear(testStory, current, { type: "move", target: "s1:b2" }, roller(2));
  assert.deepEqual(current.pending?.options, ["ask", "exorcise"]);
  current = advanceFear(testStory, current, { type: "choose", choice: "exorcise" }, roller(6));
  assert.equal(current.pending?.kind, "librarian-component");
  current = advanceFear(testStory, current, { type: "choose", choice: "item:incense" }, roller(6));
  assert.equal(current.missionProgress["flag:librarian-ghost-exorcised"], true);
  assert.equal(current.inventory.incense, 1);
  assert.equal(current.inventory["essential-oils"], 1);
  assert.equal(current.xp, 0, "the source says the librarian is expelled, with no XP award");
});

test("ordinary ghost Life is capped at one damage per non-magic attack and ghosts reject holy water", () => {
  const ghostStory: FearStory = structuredClone(story);
  ghostStory.fear.weapons.sledgehammer = { label: "大锤", damage: 2 };
  ghostStory.fear.items = { ...ghostStory.fear.items, "holy-water": { label: "圣水" } };
  ghostStory.fear.enemies.coldSpirit = { label: "冷气之灵", level: 4, life: 4, damage: 1, tags: ["ghost", "undead"] };
  let s = state(); s.weaponIds.push("sledgehammer"); s.weaponId = "sledgehammer"; s.inventory["holy-water"] = 1;
  s.combat = { enemyId: "coldSpirit", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "sledgehammer", attackDisabled: false, surprise: false };
  assert.ok(!availableFearActions(ghostStory, s).some(({ action }) => action.type === "use-item" && action.target === "holy-water"));
  s = advanceFear(ghostStory, s, { type: "attack" }, roller(6, 2));
  assert.equal(s.combat?.enemyLife, 3);
});

test("Whispering Presence applies its L5 Will gate and optional L5 Charisma clue, or moves to a visited box on failure", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-ghosts-table.json";
  const source = JSON.parse(readFileSync(sourcePath, "utf8")) as { paragraphs: { id: string; text: string }[] };
  const row = source.paragraphs.find(paragraph => paragraph.id === "section-ghosts-table:p3");
  assert.ok(row?.text.includes("Pass a L5 Will roll") && row.text.includes("L5 Charisma roll"));
  assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), "11141dab5ab5735eca580cc363e9caed555c8d646dd5cf5764841f84944b7c07");
  const testStory: FearStory = structuredClone(story);
  testStory.fear.eventPrograms["1"] = [{ op: "whispering-presence", randomEncounterTable: "encounter" }];
  testStory.fear.skills.will = { label: "意志", xp: 4, modifiers: { "will-save": [1, 2] } };
  testStory.fear.skills.charisma = { label: "魅力", xp: 4, modifiers: { charisma: [1, 2] } };
  testStory.fear.tables.encounter.entries = Array.from({ length: 6 }, (_, index) => ({ roll: index + 1, result: "zombie", operations: [{ op: "start-combat", enemyId: "zombie", count: 1 }] }));

  let current = state(); current.skills.will = 2; current.skills.charisma = 2;
  current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller(3));
  assert.equal(current.pending?.kind, "whispering-question", "a successful Will roll unlocks the optional question action");
  assert.equal(current.clues, 0);
  current = advanceFear(testStory, current, { type: "choose", choice: "ask" }, roller(3));
  assert.equal(current.clues, 1, "a successful L5 Charisma roll grants exactly one Clue");

  let misled = state(); misled.mapSheets[0].boxes[1].visited = true;
  misled.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: misled.visitCount };
  misled = advanceFear(testStory, misled, { type: "resolve-event", target: "1" }, roller(1));
  assert.equal(misled.pending?.kind, "whispering-move");
  assert.ok(projectFear(testStory, misled).pending?.labels["s1:b2"]?.includes("第2格"));
  misled = advanceFear(testStory, misled, { type: "choose", choice: "s1:b2" }, roller(1, 1));
  assert.equal(misled.combat?.enemyId, "zombie", "the visited destination's Whispering Presence 2-in-6 encounter is actually rolled");

  testStory.fear.tables.town.entries = Array.from({ length: 6 }, (_, index) => ({ roll: index + 1, result: "box-content", operations: [{ op: "choose-effect", prompt: "resolve box content", choices: { continue: [] } }] }));
  const unvisited = state(); unvisited.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: unvisited.visitCount };
  let afterMove = advanceFear(testStory, unvisited, { type: "resolve-event", target: "1" }, roller(1, 1, 1));
  assert.equal(afterMove.pending?.kind, "source-choice", "without visited boxes, the random neighbor is resolved before the extra encounter check");
  assert.equal(afterMove.combat, undefined);
  afterMove = advanceFear(testStory, afterMove, { type: "choose", choice: "continue" }, roller(1, 1));
  assert.equal(afterMove.combat?.enemyId, "zombie", "the deferred 2-in-6 check runs only after the newly entered box content resolves");
});

test("Demon Cat gets its source 4-in-6 flee roll after taking at least two Life damage", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-possessed-table.json";
  const source = JSON.parse(readFileSync(sourcePath, "utf8")) as { paragraphs: { id: string; text: string }[] };
  const row = source.paragraphs.find(paragraph => paragraph.id === "section-possessed-table:p3");
  const rowText = row?.text.replace(/\s+/g, " ") ?? "";
  assert.ok(rowText.includes("Once the cat has taken 2 or 3 points of damage") && rowText.includes("4 in 6 chance"));
  assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");
  const reviewed = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  assert.deepEqual(reviewed.enemies["demon-cat"].fleeChance, [4, 6]);
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["demon-cat"] = reviewed.enemies["demon-cat"];
  testStory.fear.weapons.heavy = { label: "重武器", damage: 3 };
  const makeCombat = () => {
    const current = state(); current.weaponIds.push("heavy"); current.weaponId = "heavy";
    current.combat = { enemyId: "demon-cat", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 4, enemyLives: [4], enemyDamage: 0,
      damageResource: "hp", playerFirst: true, round: 1, weaponId: "heavy", surprise: false, attackDisabled: false, specialRule: "demon-cat" };
    return current;
  };
  const fled = advanceFear(testStory, makeCombat(), { type: "attack" }, roller(4, 4));
  assert.equal(fled.combat, undefined, "3 damage crosses the printed 2-or-3 damage trigger and D6=4 succeeds on 4-in-6");
  assert.equal(fled.combatResult?.outcome, "fled");
  const stayed = advanceFear(testStory, makeCombat(), { type: "attack" }, roller(4, 5));
  assert.equal(stayed.combat?.enemyLife, 1);
  assert.equal(stayed.combat?.fleeCheckResolved, true);
});

test("skill upgrades appear only when the character can pay their listed XP cost", () => {
  const skillStory: FearStory = structuredClone(story);
  skillStory.fear.skills.agile = { label: "敏捷", xp: 8, modifiers: {} };
  const s = state(); s.skills.agile = 1; s.xp = 0;
  assert.ok(!availableFearActions(skillStory, s).some(({ action }) => action.type === "learn-skill" && action.skill === "agile"));
  s.xp = skillStory.fear.skills.agile.xp;
  assert.ok(availableFearActions(skillStory, s).some(({ action }) => action.type === "learn-skill" && action.skill === "agile"));
});

test("Mirina cannot be attacked; failed Will sets influence and resisted Mirina allows campaign-removing exorcism", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills.exorcism = { label: "驱魔", xp: 2, kind: "arcane", modifiers: { exorcism: [0, 1] } };
  testStory.fear.items = { ...testStory.fear.items, "holy-water": { label: "圣水" } };
  testStory.fear.tables.mirina = { die: "D6", entries: [{ roll: 3, result: "Mirina", operations: [{ op: "mirina-encounter", exorcismSkillId: "exorcism" }] }] };
  testStory.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "mirina" }];
  let failed = state(); failed.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: failed.visitCount };
  failed = advanceFear(testStory, failed, { type: "resolve-event", target: "1" }, roller(3, 1));
  assert.equal(failed.missionProgress["flag:rag-doll-influence"], true);
  assert.equal(failed.combat, undefined);

  let resisted = state(); resisted.arcaneSkills.exorcism = 1; resisted.inventory["holy-water"] = 1;
  resisted.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: resisted.visitCount };
  resisted = advanceFear(testStory, resisted, { type: "resolve-event", target: "1" }, roller(3, 6));
  assert.deepEqual(resisted.pending?.options, ["leave", "exorcise:holy-water"]);
  resisted = advanceFear(testStory, resisted, { type: "choose", choice: "exorcise:holy-water" }, roller(6));
  assert.equal(resisted.missionProgress["flag:mirina-exorcised"], true);
  assert.equal(resisted.missionProgress["mirina-box-id"], undefined);
  assert.equal(resisted.xp, 0, "the source removes Mirina without awarding XP");
});

test("Mirina's failed influence forces the next combat-stat human to be killed before escape", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.human = { label: "人类敌人", level: 2, life: 1, damage: 1, tags: ["human"] };
  testStory.fear.eventPrograms["1"] = [{ op: "start-combat", enemyId: "human", count: 1 }];
  let current = state(); current.missionProgress["flag:rag-doll-influence"] = true;
  current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller());
  assert.equal(current.combat?.mirinaCompelled, true);
  assert.equal(availableFearActions(testStory, current).some(({ action }) => action.type === "escape"), false);
  assert.throws(() => advanceFear(testStory, current, { type: "escape" }, roller(6)), /unavailable/);
  current = advanceFear(testStory, current, { type: "attack" }, roller(6, 1));
  assert.equal(current.combat, undefined);
  assert.equal(current.missionProgress["flag:rag-doll-influence"], undefined);
});

test("Mirina's influence automatically kills the source's noncombat old man or chained girl and costs one Sanity", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.eventPrograms["1"] = [{ op: "mirina-human-contact", contact: "old-man" }];
  const current = state(); current.missionProgress["flag:rag-doll-influence"] = true;
  current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  const resolved = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller());
  assert.equal(resolved.sanity, current.sanity - 1);
  assert.equal(resolved.missionProgress["flag:rag-doll-influence"], undefined);
  assert.ok(resolved.log.some(entry => entry.includes("老人")));
  testStory.fear.eventPrograms["1"] = [{ op: "mirina-human-contact", contact: "chained-girl" }];
  const second = state(); second.missionProgress["flag:rag-doll-influence"] = true;
  second.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: second.visitCount };
  assert.equal(advanceFear(testStory, second, { type: "resolve-event", target: "1" }, roller()).sanity, second.sanity - 1);
});

test("the Doppelganger's Life equals current maximum Life and its profile carries no equipment", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.doppelganger = { label: "分身", level: 3, life: 1, lifeMode: "player-max", damage: 1 };
  testStory.fear.eventPrograms["1"] = [{ op: "start-combat", enemyId: "doppelganger", count: 1 }];
  const current = state(); current.maxHp = 11; current.hp = 7;
  current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  const resolved = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller());
  assert.equal(resolved.combat?.enemyLife, 11);
  assert.deepEqual(resolved.weaponIds, current.weaponIds);
});

test("the source-defined cursed blade cannot be discarded or stored", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.weapons["cursed-blade"] = { label: "诅咒之刃", damage: 1, modifier: 1, tags: ["cursed"] };
  const current = state(); current.weaponIds.push("cursed-blade"); current.mapSheets[0].boxes[0].safehouse = true;
  const choices = availableFearActions(testStory, current).map(({ action }) => JSON.stringify(action));
  assert.equal(choices.includes(JSON.stringify({ type: "discard-item", target: "weapon:cursed-blade", amount: 1 })), false);
  assert.equal(choices.includes(JSON.stringify({ type: "store-item", target: "weapon:cursed-blade", amount: 1 })), false);
  assert.throws(() => advanceFear(testStory, current, { type: "discard-item", target: "weapon:cursed-blade", amount: 1 }, roller()), /unavailable/);
  assert.throws(() => advanceFear(testStory, current, { type: "store-item", target: "weapon:cursed-blade", amount: 1 }, roller()), /unavailable/);
});

test("Pied Piper's disappearance resolves the printed 2-in-6 D3 bone-powder loot, while escape does not", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items, "bone-powder": { label: "骨粉" } };
  testStory.fear.enemies.piper = { label: "魔笛手", level: 3, life: 1, damage: 0, lifeMode: "infinite", specialRule: "pied-piper" };
  testStory.fear.tables.piper = { die: "D6", entries: [{ roll: 5, result: "piper", operations: [
    { op: "start-combat", enemyId: "piper", count: 1 },
    { op: "combat-outcome", enemyId: "piper", defeated: [], fled: [{ op: "probability", numerator: 2, denominator: 6, success: [{ op: "item", itemId: "bone-powder", amount: "D3" }] }], escaped: [] },
  ] }] };
  testStory.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "piper" }];
  let current = state(); current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(testStory, current, { type: "resolve-event", target: "1" }, roller(5));
  const attackFaces = [6, 6, 1, 1, 1, 6]; let attackIndex = 0;
  current = advanceFear(testStory, current, { type: "attack" }, () => attackFaces[attackIndex++] ?? 1);
  assert.equal(current.combatResult?.outcome, "fled", JSON.stringify({ combat: current.combat, pending: current.pending, inventory: current.inventory, log: current.log.slice(-15) }));
  assert.equal(current.inventory["bone-powder"], 3);
});

test("Pied Piper's failed L4 Magic save consumes a dance turn and prompts the 2-in-6 loss choice", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.piper = { label: "魔笛手", level: 3, life: 1, damage: 0, lifeMode: "infinite", specialRule: "pied-piper" };
  const current = state(); current.combat = { enemyId: "piper", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 1, enemyLives: [1], enemyDamage: 0,
    damageResource: "hp", round: 1, playerFirst: true, surprise: false, weaponId: current.weaponId, attackDisabled: false, specialRule: "pied-piper" };
  const danced = advanceFear(testStory, current, { type: "attack" }, roller(1, 2));
  assert.equal(danced.combat?.round, 2);
  assert.equal(danced.combat?.playerFirst, true);
  assert.equal(danced.pending?.kind, "pied-piper-loss");
  const afterLoss = advanceFear(testStory, danced, { type: "choose", choice: "life" }, roller());
  assert.equal(afterLoss.hp, current.hp - 1);
  assert.equal(afterLoss.combat?.round, 2);
});

test("a Pied Piper theft of the equipped weapon keeps combat weapon state synchronized", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.piper = { label: "魔笛手", level: 3, life: 1, damage: 0, lifeMode: "infinite", specialRule: "pied-piper" };
  const current = state(); current.weaponId = "knife"; current.weaponIds = ["knife"];
  current.combat = { enemyId: "piper", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 1, enemyLives: [1], enemyDamage: 0,
    damageResource: "hp", round: 1, playerFirst: true, surprise: false, weaponId: "knife", attackDisabled: false, specialRule: "pied-piper" };
  const danced = advanceFear(testStory, current, { type: "attack" }, roller(1, 1));
  assert.equal(danced.pending?.kind, "pied-piper-loss");
  const afterLoss = advanceFear(testStory, danced, { type: "choose", choice: "weapon:knife" }, roller());
  assert.equal(afterLoss.weaponId, "unarmed");
  assert.equal(afterLoss.combat?.weaponId, "unarmed");
  assert.doesNotThrow(() => advanceFear(testStory, afterLoss, { type: "attack" }, roller(6, 1)));
});

test("D3+1 group counts use one D3 roll plus the printed modifier", () => {
  const countStory: FearStory = structuredClone(story);
  countStory.fear.enemies.pack = { label: "狼群成员", level: 3, life: 1, damage: 1 };
  countStory.fear.tables.town.entries[0].operations = [{ op: "start-combat-groups", groups: [{ enemyId: "pack", count: "D3+1" }] }];
  const s = advanceFear(countStory, state(), { type: "move", target: "s1:b2" }, roller(1, 1));
  assert.equal(s.combat?.groups?.[0].enemyLives.length, 2);
});

test("source-pinned random-events table keeps its D6 branches and resolves the accepted kid roll", () => {
  const eventStory: FearStory = structuredClone(story);
  eventStory.nodes.push(...["event-26", "event-37", "event-31", "event-34"].map(id => ({ id })));
  eventStory.fear.sceneRefs.events = { "1": "event-1", "26": "event-26", "37": "event-37", "31": "event-31", "34": "event-34" };
  eventStory.fear.tables["random-event-kid"] = { die: "D6", entries: [
    { roll: [1, 3], result: "event-26", scene: "event-26" },
    { roll: [4, 6], result: "event-37", scene: "event-37" },
  ] };
  eventStory.fear.tables["random-events"] = { die: "D6", entries: [{
    roll: 1, result: "kid-wants-to-follow", operations: [{ op: "choose-effect", prompt: "kid", choices: {
      refuse: [], accept: [{ op: "roll-table", tableId: "random-event-kid" }],
    } }],
  }] };
  eventStory.fear.tables.town.entries[0].operations = [{ op: "roll-table", tableId: "random-events" }];
  let s = advanceFear(eventStory, state(), { type: "move", target: "s1:b2" }, roller(1, 1));
  assert.equal(s.pending?.kind, "source-choice");
  s = advanceFear(eventStory, s, { type: "choose", choice: "accept" }, roller(1));
  assert.equal(s.nodeId, "event-26");

  const review = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition-review.json", "utf8"));
  for (const [table, fragment] of [["random-events", "section-random-events-table"], ["special-events", "section-special-events-table"]]) {
    const pin = review.tableSourcePins[table];
    const file = `scripts/alone-against-fear/fragments/${fragment}.json`;
    const bytes = readFileSync(file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), pin.sha256);
    const translatedBytes = readFileSync(`scripts/${pin.translation}`);
    assert.equal(createHash("sha256").update(translatedBytes).digest("hex"), pin.translationSha256);
    const translated = JSON.parse(translatedBytes.toString("utf8"));
    assert.equal(translated.sourceFragmentSha256, pin.sha256);
    assert.equal(pin.sourcePages.length, 1);
    assert.equal(pin.paragraphIds.length, JSON.parse(bytes.toString("utf8")).paragraphs.length);
  }
});

test("special events reroll globally used results and fall back to House once exhausted", () => {
  const eventStory: FearStory = structuredClone(story);
  eventStory.nodes.push({ id: "event-31" }, { id: "event-34" });
  eventStory.fear.sceneRefs.events = { "1": "event-1", "31": "event-31", "34": "event-34" };
  eventStory.fear.tables["special-events"] = { die: "D6", rerollDefeated: true, entries: [
    { roll: 1, result: "special-event-1", tags: ["unique-event"] },
    { roll: 2, result: "special-event-2", tags: ["unique-event"] },
  ], exhausted: { roll: 0, result: "house", operations: [{ op: "roll-table", tableId: "house" }] } };
  eventStory.fear.tables.town.entries[0].operations = [{ op: "roll-table", tableId: "special-events" }];
  let s = state(); s.uniqueEventsPlayed = ["special-event-1"];
  s = advanceFear(eventStory, s, { type: "move", target: "s1:b2" }, roller(1, 1, 2));
  assert.ok(s.uniqueEventsPlayed.includes("special-event-2"));
  assert.ok(s.log.some(line => line.includes("特殊事件表 2")));
});

test("dangerous-place loot is fixed before an L4 climb and a failed attempt permits another roll", () => {
  const eventStory: FearStory = structuredClone(story);
  eventStory.fear.tables["random-events"] = { die: "D6", entries: [{ roll: 3, result: "dangerous-place-object", operations: [
    { op: "climb-for-loot", tableIds: ["random-objects"], level: 4, skillId: "agile" },
  ] }] };
  eventStory.fear.tables["random-objects"] = { die: "D66", entries: [
    { roll: 11, result: "rope", operations: [{ op: "item", itemId: "rope", amount: 1 }] },
  ] };
  eventStory.fear.tables.town.entries[0].operations = [{ op: "roll-table", tableId: "random-events" }];
  let s = advanceFear(eventStory, state(), { type: "move", target: "s1:b2" }, roller(1, 3));
  s = advanceFear(eventStory, s, { type: "choose", choice: "random-objects" }, roller(1, 1));
  assert.deepEqual(s.pending?.options, ["climb"]);
  const held = s.pending?.data?.entry as { result: string };
  assert.equal(held.result, "rope");
  s = advanceFear(eventStory, s, { type: "choose", choice: "climb" }, roller(1));
  assert.equal(s.hp, 7); assert.equal(s.pending?.kind, "climb-reward");
  assert.equal((s.pending?.data?.entry as { result: string }).result, "rope");
  s = advanceFear(eventStory, s, { type: "choose", choice: "climb" }, roller(6));
  assert.equal(s.inventory.rope, 1); assert.equal(s.pending, undefined);
});

test("event 31’s repeated Strength check costs Life until it succeeds", () => {
  const eventStory: FearStory = structuredClone(story);
  eventStory.nodes.push({ id: "event-33" });
  eventStory.fear.sceneRefs.events = { "1": "event-1", "33": "event-33" };
  eventStory.fear.items = { rope: { label: "绳子" }, "occult-guide": { label: "神秘学指南" }, candles: { label: "蜡烛" } };
  eventStory.fear.tables.grabbed = { die: "D6", entries: [
    { roll: 1, result: "strangle", operations: [{ op: "repeat-check", context: "strength", level: 4, requiredSkill: "strong", failure: [{ op: "resource", key: "hp", amount: -1 }] }] },
    { roll: 2, result: "steal", operations: [{ op: "discard-choice", excludedItemIds: [], excludedTags: [], excludedWeaponIds: [] }] },
    { roll: 3, result: "claw", operations: [{ op: "roll-check", context: "defense", level: 5, success: [], failure: [{ op: "resource", key: "hp", amount: -1 }] }] },
    { roll: 4, result: "wave", operations: [] }, { roll: 5, result: "miss", operations: [] },
    { roll: 6, result: "hand", operations: [{ op: "require-item", itemId: "occult-guide", success: [{ op: "require-item", itemId: "candles", success: [{ op: "route", scene: "event-33" }] }] }] },
  ] };
  eventStory.fear.tables.town.entries[0].operations = [{ op: "roll-table", tableId: "grabbed" }];
  let s = advanceFear(eventStory, state(), { type: "move", target: "s1:b2" }, roller(1, 1));
  assert.equal(s.pending?.kind, "repeat-check");
  s = advanceFear(eventStory, s, { type: "choose", choice: "attempt" }, roller(1));
  assert.equal(s.hp, 7); assert.equal(s.pending?.kind, "repeat-check");
  s = advanceFear(eventStory, s, { type: "choose", choice: "attempt" }, roller(6));
  assert.equal(s.pending, undefined);
});

test("event 31 source outcomes remove a carried object, check defense, and gate the Hand of Glory route", () => {
  const eventStory: FearStory = structuredClone(story);
  eventStory.nodes.push({ id: "event-33" }); eventStory.fear.sceneRefs.events = { "1": "event-1", "33": "event-33" };
  eventStory.fear.items = { rope: { label: "绳子" }, "occult-guide": { label: "神秘学指南" }, candles: { label: "蜡烛" } };
  eventStory.fear.tables.grabbed = { die: "D6", entries: [
    { roll: 2, result: "steal", operations: [{ op: "discard-choice", excludedItemIds: [], excludedTags: [], excludedWeaponIds: [] }] },
    { roll: 3, result: "claw", operations: [{ op: "roll-check", context: "defense", level: 5, success: [], failure: [{ op: "resource", key: "hp", amount: -1 }] }] },
    { roll: 6, result: "hand", operations: [{ op: "require-item", itemId: "occult-guide", success: [{ op: "require-item", itemId: "candles", success: [{ op: "route", scene: "event-33" }] }] }] },
  ] };
  eventStory.fear.tables.town.entries[0].operations = [{ op: "roll-table", tableId: "grabbed" }];
  let stolen = state(); stolen.inventory.rope = 1;
  stolen = advanceFear(eventStory, stolen, { type: "move", target: "s1:b2" }, roller(1, 2));
  assert.equal(stolen.pending?.options[0], "item:rope");
  stolen = advanceFear(eventStory, stolen, { type: "choose", choice: "item:rope" }, roller());
  assert.equal(stolen.inventory.rope, undefined);

  let clawed = advanceFear(eventStory, state(), { type: "move", target: "s1:b2" }, roller(1, 3, 1));
  assert.equal(clawed.hp, 7);

  let hand = state(); hand.inventory["occult-guide"] = 1; hand.inventory.candles = 1;
  hand = advanceFear(eventStory, hand, { type: "move", target: "s1:b2" }, roller(1, 6));
  assert.equal(hand.nodeId, "event-33");
  let noItems = advanceFear(eventStory, state(), { type: "move", target: "s1:b2" }, roller(1, 6));
  assert.notEqual(noItems.nodeId, "event-33");
});

test("mixed enemy groups defend individually and enforce the source escape threshold", () => {
  const groupStory: FearStory = structuredClone(story);
  groupStory.fear.enemies.leader = { label: "头目", level: 5, life: 1, damage: 2 };
  groupStory.fear.enemies.pig = { label: "猪", level: 3, life: 1, damage: 1 };
  groupStory.fear.tables.town.entries[0].operations = [{ op: "start-combat-groups", groups: [
    { enemyId: "leader", count: 1 }, { enemyId: "pig", count: 3 },
  ], escapeAfter: { enemyId: "pig", defeated: 3 } }];
  let s = advanceFear(groupStory, state(), { type: "move", target: "s1:b2" }, roller(1));
  assert.equal(availableFearActions(groupStory, s).some(({ action }) => action.type === "escape"), false);
  const attackPig = () => advanceFear(groupStory, s, { type: "attack", target: "pig" }, roller(4));
  const defendAll = (faces: number[]) => advanceFear(groupStory, s, { type: "defend" }, roller(...faces));
  s = attackPig(); assert.equal(s.combat?.groups?.[1].defeatedCount, 1);
  s = defendAll([6, 6, 6]);
  s = attackPig(); assert.equal(s.combat?.groups?.[1].defeatedCount, 2);
  s = defendAll([6, 6]);
  s = attackPig(); assert.equal(s.combat?.groups?.[1].defeatedCount, 3);
  assert.equal(availableFearActions(groupStory, s).some(({ action }) => action.type === "escape"), false);
  s = defendAll([6]);
  assert.equal(availableFearActions(groupStory, s).some(({ action }) => action.type === "escape"), true);
  s = advanceFear(groupStory, s, { type: "escape" }, roller(6));
  assert.equal(s.combat, undefined); assert.equal(s.combatResult?.outcome, "escaped");
});

test("Vivina's source 1-in-6 arrival joins her encounter and exposes both targets", () => {
  const vivinaStory: FearStory = structuredClone(story);
  vivinaStory.fear.enemies["living-dolls-1"] = { label: "薇薇娜", level: 3, life: 3, damage: 1, familyRule: "vivina" };
  vivinaStory.fear.enemies.intruder = { label: "闯入者", level: 2, life: 2, damage: 1 };
  vivinaStory.fear.tables["random-encounter"] = { die: "D66", entries: [{ roll: 11, result: "intruder", operations: [{ op: "start-combat", enemyId: "intruder", count: 1 }] }] };
  let current = state();
  current.combat = { enemyId: "living-dolls-1", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    round: 1, playerFirst: false, surprise: false, weaponId: current.weaponId, attackDisabled: false, familyRule: "vivina", familyState: {} };
  current = advanceFear(vivinaStory, current, { type: "defend" }, roller(1, 1, 1, 6, 6, 6, 6, 6));
  assert.deepEqual(current.combat?.groups?.map(group => group.enemyId), ["living-dolls-1", "intruder"], JSON.stringify({ combat: current.combat, pending: current.pending, log: current.log.slice(-12) }));
  assert.equal(current.combat?.familyState?.intruderPresent, true);
  const actions = availableFearActions(vivinaStory, current);
  assert.ok(actions.some(value => value.action.type === "choose" && value.action.choice === "family:target-vivina"), JSON.stringify({ combat: current.combat, pending: current.pending, log: current.log }));
  assert.ok(actions.some(value => value.action.type === "choose" && value.action.choice === "family:target-intruder:intruder"));
  assert.ok(actions.some(value => value.action.type === "attack" && value.action.target === "living-dolls-1"));
  assert.ok(actions.some(value => value.action.type === "attack" && value.action.target === "intruder"));
  current = advanceFear(vivinaStory, current, { type: "choose", choice: "family:target-intruder:intruder" }, roller());
  assert.equal(current.combat?.familyState?.attackTarget, "intruder");
  current = advanceFear(vivinaStory, current, { type: "attack", target: "intruder" }, roller(6, 1));
  assert.deepEqual(current.combat?.groups?.map(group => [group.enemyId, group.enemyLives.length]), [["living-dolls-1", 1], ["intruder", 0]]);
  assert.equal(current.combat?.familyRule, "vivina", "the main encounter remains active after the intruder is defeated");
});

test("event 5 source rules gate its food sacrifice, multi-group escape and optional butcher yield", () => {
  const eventStory: FearStory = structuredClone(story);
  eventStory.nodes.push({ id: "event-5" }, { id: "event-6" });
  eventStory.fear.sceneRefs.events["5"] = "event-5"; eventStory.fear.sceneRefs.events["6"] = "event-6";
  eventStory.fear.enemies.pighead = { label: "Pighead", level: 5, life: 3, damage: 2, tags: ["unique"] };
  eventStory.fear.enemies.pig = { label: "Pig", level: 3, life: 2, damage: 1 };
  eventStory.fear.eventPrograms["5"] = [{ op: "event-branch", eventId: "5", ifPlayed: [], ifNew: [{ op: "choose-effect", prompt: "避战或战斗", choices: {
    food: [{ op: "require-resource", key: "food", amount: 3 }, { op: "resource", key: "food", amount: -3 }],
    bone: [{ op: "require-item", itemId: "bone-powder", success: [{ op: "item", itemId: "bone-powder", amount: -1 }] }],
    fight: [{ op: "start-combat-groups", groups: [{ enemyId: "pighead", count: 1 }, { enemyId: "pig", count: 6 }], escapeAfter: { enemyId: "pig", defeated: 3 } },
      { op: "group-combat-outcome", primaryEnemyId: "pighead", foodEnemyId: "pig", foodEach: "D6", allDefeated: [{ op: "route", scene: "event-6" }] }],
  } }] }];
  let s = state(); s.food = 3; s.pendingEvent = { eventId: "5", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(eventStory, s, { type: "resolve-event", target: "5" }, roller());
  assert.deepEqual(s.pending?.options, ["food", "fight"]);
  s = advanceFear(eventStory, s, { type: "choose", choice: "fight" }, roller());
  assert.equal(s.combat?.groups?.[0].enemyLives.length, 1); assert.equal(s.combat?.groups?.[1].enemyLives.length, 6);
  assert.ok(!availableFearActions(eventStory, s).some(({ action }) => action.type === "escape"));
  s.combat!.groups![1].defeatedCount = 3; s.combat!.groups![1].enemyLives.splice(0, 3);
  s = advanceFear(eventStory, s, { type: "escape" }, roller(6));
  assert.equal(s.combat, undefined); assert.equal(s.combatResult?.groupDefeated?.pig, 3);
  assert.equal(s.food, 3); // Butchering is optional; no food is granted before the choice.
  assert.deepEqual(s.pending?.options, ["0", "1", "2", "3"]);
  assert.equal(projectFear(eventStory, s).pending?.labels["3"], "屠宰3只Pig");
  s = advanceFear(eventStory, s, { type: "choose", choice: "3" }, roller(1));
  s = resolvePendingAcquisition(eventStory, s);
  assert.equal(s.food, 6); // three chosen pigs each yield one D6 Food; the roller defaults to 1
  assert.equal(s.nodeId, "entry"); // Escaping does not satisfy the printed Pighead-and-all-pigs victory route.
});

test("available actions are phase-specific and map projection hides per-box future scenes", () => {
  const pending = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8 }, roller(1));
  const startMenu = availableFearActions(story, pending);
  assert.equal(startMenu.length, 30); assert.ok(startMenu.every(item => item.action.type === "choose" && item.label && item.hint));
  assert.match(startMenu[11].label, /第1张地图·第12格/);
  const projection = projectFear(story, pending);
  assert.equal(projection.xp, 0);
  assert.equal(projection.currentWeapon.label, "小刀");
  assert.equal(projection.currentMission.id, "one");
  assert.deepEqual(projection.scars, []); assert.deepEqual(projection.traumas, []);
  assert.equal(projection.pending?.kind, "starting-area");
  assert.equal(projection.pending?.labels["s1:b12"], "第1张地图·第12格（第3行第2列）");
  assert.ok(!("data" in (projection.pending ?? {})));
  assert.equal(projection.mapSheets[0].boxes.length, 30);
  assert.ok(projection.mapSheets[0].boxes.every(box => !("scene" in box)));
  const play = state();
  const menu = availableFearActions(story, play);
  assert.ok(menu.some(item => item.action.type === "move" && item.action.target === "s1:b2"));
  assert.ok(menu.some(item => item.action.type === "search"));
  assert.ok(menu.every(item => item.label.length > 0));
});

test("invalid phase actions and invalid D6 faces fail before saving gameplay progress", () => {
  const s = state(); let rolls = 0;
  assert.throws(() => advanceFear(story, s, { type: "attack" }, () => { rolls++; return 1; }), /unavailable outside/);
  assert.equal(rolls, 0); assert.equal(s.visitCount, 1);
  assert.throws(() => initialFear(story, {}, () => 7), /invalid face/);
});

test("map uses configured adjacent boxes, then links a new 30-box sheet after full exploration", () => {
  let s = state();
  assert.throws(() => advanceFear(story, s, { type: "move", target: "s2:b1" }, roller()), /Unknown Fear map box/);
  assert.throws(() => advanceFear(story, s, { type: "move", target: "s1:b7" }, roller()), /adjacent box/);
  const path = [1, 2, 3, 4, 5, 10, 9, 8, 7, 6, 11, 12, 13, 14, 15, 20, 19, 18, 17, 16, 21, 22, 23, 24, 25, 30, 29, 28, 27, 26];
  for (const box of path.slice(1)) s = advanceFear(story, s, { type: "move", target: `s1:b${box}` }, roller(2));
  const grown = advanceFear(story, s, { type: "move" }, roller(2));
  assert.equal(grown.mapSheets.length, 2); assert.equal(grown.mapSheets[1].boxes.length, 30); assert.equal(grown.currentBoxId, "s2:b1");
});

test("search succeeds on six, consumes the one search per area, and does not explode table dice", () => {
  let s = state(); s = advanceFear(story, s, { type: "search" }, roller(6));
  assert.equal(s.pending?.kind, "search-success");
  s = advanceFear(story, s, { type: "choose", choice: "clue" }, roller());
  assert.throws(() => advanceFear(story, s, { type: "search" }, roller(3)), /no remaining search attempts/);
});

test("books, rope, and ritual components are not exposed as generic consumable actions", () => {
  const current = state();
  current.inventory["random-book"] = 1; current.inventory.rope = 1; current.inventory.incense = 1;
  assert.ok(!availableFearActions(story, current).some(({ action }) => action.type === "use-item"));
  assert.throws(() => advanceFear(story, current, { type: "use-item", target: "random-book" }, roller()), /unavailable in the current phase or state/);
  assert.equal(current.inventory["random-book"], 1); assert.equal(current.inventory.rope, 1); assert.equal(current.inventory.incense, 1);
});

test("Arcane book study spends XP, records D3 elapsed time, preserves the book, and never moves the map", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills = sourceDefinition.skills;
  testStory.fear.items = sourceDefinition.items;
  testStory.fear.arcaneLearning = sourceDefinition.arcaneLearning;
  let current = state(); current.xp = 3; current.inventory["they-are-among-us"] = 1;
  const before = { box: current.currentBoxId, visits: current.visitCount, food: current.food, visited: current.mapSheets[0].boxes.filter(box => box.visited).map(box => box.id) };
  const options = availableFearActions(testStory, current);
  assert.ok(options.some(({ action }) => action.type === "learn-arcane" && action.skill === "alien-fighter" && action.target === "they-are-among-us"));
  current = advanceFear(testStory, current, { type: "learn-arcane", skill: "alien-fighter", target: "they-are-among-us" }, roller(4));
  assert.equal(current.xp, 0); assert.equal(current.arcaneSkills["alien-fighter"], 1);
  assert.equal(current.elapsedTimeBoxes, 2); assert.equal(current.inventory["they-are-among-us"], 1);
  assert.deepEqual({ box: current.currentBoxId, visits: current.visitCount, food: current.food, visited: current.mapSheets[0].boxes.filter(box => box.visited).map(box => box.id) }, before);
  current.xp = 3;
  current = advanceFear(testStory, current, { type: "learn-arcane", skill: "alien-fighter", target: "they-are-among-us" }, roller(1));
  assert.equal(current.arcaneSkills["alien-fighter"], 2, "only source-listed Expert Arcane skills may be learned twice");
  assert.equal(current.elapsedTimeBoxes, 2, "learning a second level from the already-read book adds no reading time");
});

test("a book carried when the game starts counts as already read and does not incur study time", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills = sourceDefinition.skills; testStory.fear.items = sourceDefinition.items; testStory.fear.arcaneLearning = sourceDefinition.arcaneLearning;
  let current = initialFear(testStory, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, xp: 3, inventory: { "they-are-among-us": 1 } }, roller(1));
  current = advanceFear(testStory, current, { type: "choose", choice: "s1:b1" }, roller());
  assert.ok(current.readBooks.includes("they-are-among-us"));
  assert.ok(availableFearActions(testStory, current).some(({ action, hint }) => action.type === "learn-arcane" && action.target === "they-are-among-us" && !hint?.includes("D3")));
  const learned = advanceFear(testStory, current, { type: "learn-arcane", skill: "alien-fighter", target: "they-are-among-us" }, roller());
  assert.equal(learned.elapsedTimeBoxes, 0); assert.equal(learned.inventory["they-are-among-us"], 1);
});

test("a source random-book result carried into play applies the book's immediate reading effect", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills = sourceDefinition.skills; testStory.fear.items = sourceDefinition.items; testStory.fear.arcaneLearning = sourceDefinition.arcaneLearning;
  let current = initialFear(testStory, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, inventory: { necronomicon: 1 } }, roller(1));
  current = advanceFear(testStory, current, { type: "choose", choice: "s1:b1" }, roller());
  assert.ok(current.readBooks.includes("necronomicon"));
  assert.equal(current.sanity, 7, "Necronomicon's source reading cost is applied at game start");
  current = initialFear(testStory, { hp: 8, maxHp: 8, sanity: 6, maxSanity: 8, inventory: { "holy-book": 1 } }, roller(1));
  current = advanceFear(testStory, current, { type: "choose", choice: "s1:b1" }, roller());
  assert.equal(current.pending?.kind, "holy-book-reading");
  assert.ok(current.pending?.options.includes("recover-sanity"));
});

test("Macrocosmos and Healing rituals enforce components, sacrifices, time, luck, and once-per-mission use", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills = sourceDefinition.skills; testStory.fear.items = sourceDefinition.items; testStory.fear.arcaneLearning = sourceDefinition.arcaneLearning;
  let energy = state(); energy.arcaneSkills["energy-of-the-macrocosmos"] = 1; energy.inventory.incense = 1; energy.inventory.candle = 1;
  const energyAction = availableFearActions(testStory, energy).find(({ action }) => action.type === "cast-arcane" && action.skill === "energy-of-the-macrocosmos" && action.target === "candle");
  assert.ok(energyAction);
  energy = advanceFear(testStory, energy, energyAction.action, roller(5));
  assert.equal(energy.luck, 5); assert.equal(energy.elapsedTimeBoxes, 2); assert.equal(energy.inventory.candle, undefined); assert.equal(energy.inventory.incense, 1);
  assert.ok(!availableFearActions(testStory, energy).some(({ action }) => action.type === "cast-arcane" && action.skill === "energy-of-the-macrocosmos"));

  let healing = state(); healing.hp = 3; healing.arcaneSkills.healing = 1; healing.inventory["holy-book"] = 1; healing.inventory.candles = 1;
  const healAction = availableFearActions(testStory, healing).find(({ action }) => action.type === "cast-arcane" && action.skill === "healing");
  assert.ok(healAction);
  healing = advanceFear(testStory, healing, healAction.action, roller());
  assert.equal(healing.hp, 7); assert.equal(healing.food, 0); assert.equal(healing.inventory.candles, undefined); assert.equal(healing.inventory["holy-book"], 1);
  assert.ok(!availableFearActions(testStory, healing).some(({ action }) => action.type === "cast-arcane" && action.skill === "healing"));
});

test("Absent Mindedness makes a natural-one ritual component unavailable and stores it at a player-selected Safe House", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const sourceText = JSON.parse(readFileSync(`${process.cwd()}/scripts/alone-against-fear/fragments/section-insanity-table.json`, "utf8"))
    .paragraphs.find((paragraph: { id: string }) => paragraph.id === "section-insanity-table:p2")?.text as string;
  assert.match(sourceText, /Every time you need a material\s+component for a ritual/);
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills = sourceDefinition.skills; testStory.fear.items = sourceDefinition.items; testStory.fear.arcaneLearning = sourceDefinition.arcaneLearning;

  let current = state(); current.traumas = ["absent-mindedness"]; current.arcaneSkills["energy-of-the-macrocosmos"] = 1; current.inventory.incense = 1; current.inventory.candle = 1;
  const action = availableFearActions(testStory, current).find(({ action }) => action.type === "cast-arcane" && action.skill === "energy-of-the-macrocosmos")!.action;
  current = advanceFear(testStory, current, action, roller(1));
  assert.equal(current.inventory.incense, undefined);
  assert.equal(current.elapsedTimeBoxes, 0);
  assert.equal(current.pending, undefined);

  current = state(); current.traumas = ["absent-mindedness"]; current.arcaneSkills["energy-of-the-macrocosmos"] = 1; current.inventory.incense = 1; current.inventory.candle = 1;
  const safe = current.mapSheets[0].boxes[0]; safe.safehouse = true; current.safehouseIds = [safe.id];
  const safeAction = availableFearActions(testStory, current).find(({ action }) => action.type === "cast-arcane" && action.skill === "energy-of-the-macrocosmos")!.action;
  current = advanceFear(testStory, current, safeAction, roller(1));
  assert.equal(current.inventory.incense, undefined);
  assert.equal(current.mapSheets[0].boxes[0].storedItems?.["item:incense"], 1);
  assert.equal(current.elapsedTimeBoxes, 0);

  current = state(); current.traumas = ["absent-mindedness"]; current.arcaneSkills["energy-of-the-macrocosmos"] = 1; current.inventory.incense = 1; current.inventory.candle = 1;
  const [safeA, safeB] = current.mapSheets[0].boxes;
  safeA.safehouse = true; safeB.safehouse = true; current.safehouseIds = [safeA.id, safeB.id];
  const multiAction = availableFearActions(testStory, current).find(({ action }) => action.type === "cast-arcane" && action.skill === "energy-of-the-macrocosmos")!.action;
  current = advanceFear(testStory, current, multiAction, roller(1));
  assert.equal(current.pending?.kind, "absent-mindedness-storage");
  current = advanceFear(testStory, current, { type: "choose", choice: safeB.id }, roller());
  assert.equal(current.mapSheets[0].boxes[1].storedItems?.["item:incense"], 1);
  assert.equal(current.elapsedTimeBoxes, 0);
});

test("Absent Mindedness can fall back to another source-listed Curse component", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const sourceText = JSON.parse(readFileSync(`${process.cwd()}/scripts/alone-against-fear/fragments/section-arcane-skills.json`, "utf8"))
    .paragraphs.find((paragraph: { id: string }) => paragraph.id === "section-arcane-skills:p1")?.text as string;
  assert.match(sourceText, /Components: lighter or box of\s+matches/);
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills = sourceDefinition.skills; testStory.fear.items = sourceDefinition.items; testStory.fear.enemies = sourceDefinition.enemies;
  testStory.fear.arcaneLearning = sourceDefinition.arcaneLearning;
  let current = state(); current.traumas = ["absent-mindedness"]; current.arcaneSkills.curse = 1;
  current.inventory.lighter = 1; current.inventory.matches = 1; current.inventory["bone-powder"] = 1; current.inventory.candle = 1;
  const curseAction = availableFearActions(testStory, current).find(({ action }) => action.type === "cast-arcane" && action.skill === "curse" && action.target === "category:zombie")!.action;
  current = advanceFear(testStory, current, curseAction, roller(1, 6));
  assert.equal(current.inventory.lighter, undefined);
  assert.equal(current.inventory.matches, 1);
  assert.ok(current.preparedCurse);
});

test("Foretell privately stores a Town result, lets the player accept or discard it, and consumes no second roll on entry", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items,
    "black-mirror": { label: "黑镜" }, candle: { label: "蜡烛" } };
  testStory.fear.skills.foretell = { label: "预言", xp: 2, kind: "arcane", modifiers: {} };
  testStory.fear.tables.town = { die: "D6", entries: [
    { roll: 1, result: "secret-one", operations: [{ op: "resource", key: "clues", amount: 1 }] },
    { roll: [2, 6], result: "secret-two", operations: [{ op: "resource", key: "clues", amount: 2 }] },
  ] };
  let current = state(); current.arcaneSkills.foretell = 1;
  current.inventory["black-mirror"] = 1; current.inventory.candle = 1;
  const action = availableFearActions(testStory, current).find(({ action }) => action.type === "cast-arcane" && action.skill === "foretell");
  assert.ok(action);
  current = advanceFear(testStory, current, action.action, roller(1));
  assert.equal(current.inventory.candle, undefined); assert.equal(current.inventory["black-mirror"], 1);
  assert.equal(current.missionProgress["arcane:foretell:used"], true);
  assert.equal(current.pending?.kind, "foretell-result");
  const publicView = projectFear(testStory, current);
  assert.ok(publicView.pending?.prompt?.includes("secret one"), JSON.stringify(publicView.pending));
  assert.ok(!JSON.stringify(publicView.pending).includes("resource"));
  assert.deepEqual(publicView.pending?.labels, {
    "use-result": "接受预言结果，进入该区域", "discard-result": "改变主意，放弃该结果",
  });
  current = advanceFear(testStory, current, { type: "choose", choice: "use-result" }, roller());
  assert.deepEqual(current.foretoldTownEntry, { roll: 1, entry: testStory.fear.tables.town.entries[0] });
  current = advanceFear(testStory, current, { type: "move", target: "s1:b2" }, roller());
  assert.equal(current.clues, 1); assert.equal(current.foretoldTownEntry, undefined);
  assert.ok(!availableFearActions(testStory, current).some(({ action }) => action.type === "cast-arcane" && action.skill === "foretell"));

  let discarded = state(); discarded.arcaneSkills.foretell = 1;
  discarded.inventory["black-mirror"] = 1; discarded.inventory.candle = 1;
  discarded = advanceFear(testStory, discarded,
    { type: "cast-arcane", skill: "foretell", target: "candle" }, roller(2));
  discarded = advanceFear(testStory, discarded, { type: "choose", choice: "discard-result" }, roller());
  assert.equal(discarded.foretoldTownEntry, undefined);
  discarded = advanceFear(testStory, discarded, { type: "move", target: "s1:b2" }, roller(3));
  assert.equal(discarded.clues, 2);
});

test("Pentagram spends seven candles, grants mission-long +1 Demon defense, and may be broken", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items, "art-materials": { label: "美术材料" }, "ritual-dagger": { label: "仪式匕首" } };
  testStory.fear.enemies.demon = { label: "恶魔", level: 4, life: 2, damage: 1, tags: ["demon"] };
  testStory.fear.skills.pentagram = { label: "五芒星", xp: 4, kind: "arcane", modifiers: {} };
  const current = state(); current.arcaneSkills.pentagram = 1; current.inventory["art-materials"] = 1;
  current.inventory["ritual-dagger"] = 1; current.inventory.candles = 7;
  const action = availableFearActions(testStory, current).find(({ action }) => action.type === "cast-arcane" && action.skill === "pentagram" && action.target === "cast");
  assert.ok(action);
  let cast = advanceFear(testStory, current, action.action, roller());
  assert.equal(cast.inventory.candles, undefined); assert.equal(cast.missionProgress["flag:pentagram"], true);
  cast.combat = { enemyId: "demon", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 2, enemyLives: [2], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  // A natural 3 misses the L4 Defense without the Pentagram, but succeeds with its +1.
  cast = advanceFear(testStory, cast, { type: "defend" }, roller(3));
  assert.equal(cast.hp, 8);
  cast.combat = undefined;
  const breakAction = availableFearActions(testStory, cast).find(({ action }) => action.type === "cast-arcane" && action.skill === "pentagram" && action.target === "break");
  assert.ok(breakAction);
  cast = advanceFear(testStory, cast, breakAction.action, roller());
  assert.equal(cast.missionProgress["flag:pentagram"], undefined);
});

test("Curse preparation consumes its printed candle and bone powder, then lowers only its chosen encounter level", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items, lighter: { label: "打火机" }, matches: { label: "火柴" },
    "bone-powder": { label: "骨粉" }, candle: { label: "蜡烛" } };
  testStory.fear.skills.curse = { label: "诅咒", xp: 2, kind: "arcane", modifiers: {} };
  testStory.fear.enemies.zombie = { label: "僵尸", level: 3, life: 2, damage: 1, tags: ["zombie", "undead"] };
  testStory.fear.enemies.named = { label: "波点裙狂人", level: 5, life: 4, damage: 1 };
  let current = state(); current.arcaneSkills.curse = 1; current.inventory.matches = 1;
  current.inventory["bone-powder"] = 1; current.inventory.candle = 1;
  const categoryCurse = availableFearActions(testStory, current).find(({ action }) => action.type === "cast-arcane" && action.skill === "curse" && action.target === "category:zombie");
  assert.ok(categoryCurse);
  current = advanceFear(testStory, current, categoryCurse.action, roller());
  assert.equal(current.inventory.matches, 1); assert.equal(current.inventory["bone-powder"], undefined); assert.equal(current.inventory.candle, undefined);
  assert.deepEqual(current.preparedCurse, { target: "category:zombie", reduction: 1 });
  current.combat = { enemyId: "named", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  assert.ok(!availableFearActions(testStory, current).some(({ action }) => action.type === "fire-curse"));
  current.combat = { enemyId: "zombie", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 2, enemyLives: [2], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const fire = availableFearActions(testStory, current).find(({ action }) => action.type === "fire-curse" && action.target === "zombie");
  assert.ok(fire);
  current = advanceFear(testStory, current, fire.action, roller());
  assert.equal(current.combat?.enemyLevel, 2); assert.equal(current.combat?.playerFirst, true); assert.equal(current.preparedCurse, undefined);

  let specific = state(); specific.arcaneSkills.curse = 1; specific.inventory.lighter = 1; specific.inventory["bone-powder"] = 1; specific.inventory.candles = 1;
  const action = availableFearActions(testStory, specific).find(({ action }) => action.type === "cast-arcane" && action.skill === "curse" && action.target === "specific:named");
  assert.ok(action);
  specific = advanceFear(testStory, specific, action.action, roller());
  specific.combat = { enemyId: "named", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const fireSpecific = availableFearActions(testStory, specific).find(({ action }) => action.type === "fire-curse");
  assert.ok(fireSpecific);
  specific = advanceFear(testStory, specific, fireSpecific.action, roller());
  assert.equal(specific.combat?.enemyLevel, 3);
});

test("Ghost Blade damage is target-specific; the Amulet boosts magic saves; a Blessed Candle has its printed uses", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items, amulet: { label: "护身符", weightless: true }, "blessed-candle": { label: "受祝福的蜡烛", weightless: true } };
  testStory.fear.weapons["ghost-blade"] = { label: "幽灵之刃", damage: 2, modifier: 1, tags: ["magic", "melee", "damage-1-vs-other-targets"] };
  testStory.fear.enemies.ghost = { label: "鬼魂", level: 4, life: 5, damage: 1, tags: ["ghost"] };
  testStory.fear.enemies.material = { label: "普通生物", level: 3, life: 5, damage: 1 };
  let ghost = state(); ghost.weaponIds = ["ghost-blade"]; ghost.weaponId = "ghost-blade";
  ghost.combat = { enemyId: "ghost", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 5, enemyLives: [5], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "ghost-blade", surprise: false, attackDisabled: false };
  ghost = advanceFear(testStory, ghost, { type: "attack" }, roller(3));
  assert.equal(ghost.combat?.enemyLife, 3);
  let ordinary = state(); ordinary.weaponIds = ["ghost-blade"]; ordinary.weaponId = "ghost-blade";
  ordinary.combat = { enemyId: "material", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 5, enemyLives: [5], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "ghost-blade", surprise: false, attackDisabled: false };
  ordinary = advanceFear(testStory, ordinary, { type: "attack" }, roller(2));
  assert.equal(ordinary.combat?.enemyLife, 4);

  testStory.fear.enemies.magic = { label: "魔法生物", level: 3, life: 3, damage: 1, defenseContext: "magic-save" };
  let protectedState = state(); protectedState.inventory.amulet = 1;
  protectedState.combat = { enemyId: "magic", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  protectedState = advanceFear(testStory, protectedState, { type: "defend" }, roller(2));
  assert.equal(protectedState.hp, 8);

  let candle = state(); candle.inventory["blessed-candle"] = 1; candle.sanity = 6;
  const recover = availableFearActions(testStory, candle).find(({ action }) => action.type === "use-item" && action.target === "blessed-candle" && action.choice === "sanity");
  assert.ok(recover);
  candle = advanceFear(testStory, candle, recover.action, roller());
  assert.equal(candle.sanity, 7); assert.equal(candle.inventory["blessed-candle"], undefined);
});

test("Hell Chain makes an L5 Will save per use, causes automatic damage, and rusts after six hits", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items, "hell-chain": { label: "地狱锁链" } };
  testStory.fear.enemies.training = { label: "训练靶", level: 2, life: 10, damage: 1 };
  let current = state(); current.inventory["hell-chain"] = 1; current.combat = {
    enemyId: "training", count: 1, defeatedCount: 0, enemyLevel: 2, enemyLife: 10, enemyLives: [10], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false,
  };
  for (let hit = 0; hit < 6; hit++) {
    const action = availableFearActions(testStory, current).find(({ action }) => action.type === "use-item" && action.target === "hell-chain");
    assert.ok(action, `chain use ${hit + 1}`);
    current = advanceFear(testStory, current, action.action, roller(1));
    assert.equal(current.combat?.enemyLife, 9 - hit);
    current.combat!.playerFirst = true;
  }
  assert.equal(current.hellChainHits, 6); assert.equal(current.inventory["hell-chain"], undefined); assert.equal(current.sanity, 2);
});

test("Holy Bullets are selectable pistol ammunition, deal 2 damage to a Demon, and apply the printed flee roll", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items, "holy-bullets": { label: "圣弹" } };
  testStory.fear.weapons.pistol = { label: "手枪", damage: 1, modifier: 1, tags: ["ranged"], ammoType: "bullets", ammoPerAttack: 1 };
  testStory.fear.enemies.demon = { label: "恶魔", level: 3, life: 3, damage: 1, tags: ["demon"] };
  let current = state(); current.weaponIds = ["pistol"]; current.weaponId = "pistol"; current.inventory["holy-bullets"] = 1;
  current.ammo.pistol = 0;
  current.combat = { enemyId: "demon", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "pistol", surprise: false, attackDisabled: false };
  const actions = availableFearActions(testStory, current).filter(({ action }) => action.type === "attack");
  assert.ok(!actions.some(({ action }) => action.holyBulletIndex === undefined));
  const shot = actions.find(({ action }) => action.holyBulletIndex === 1);
  assert.ok(shot);
  current = advanceFear(testStory, current, shot.action, roller(2, 4));
  assert.equal(current.inventory["holy-bullets"], undefined);
  assert.equal(current.combat, undefined); assert.equal(current.combatResult?.outcome, "fled");
});

test("one Luck point prevents exactly one pending Life damage", () => {
  const { story: combatStory, state: current } = combatState(roller(1));
  current.luck = 1; current.combat!.playerFirst = false;
  let damaged = advanceFear(combatStory, current, { type: "defend" }, roller(1, 2));
  assert.ok(damaged.pending?.options.includes("spend-luck"));
  damaged = advanceFear(combatStory, damaged, { type: "choose", choice: "spend-luck" }, roller());
  assert.equal(damaged.hp, 8); assert.equal(damaged.luck, 0); assert.equal(damaged.pending, undefined);
});

test("Macrocosmos Luck can be spent on exactly one eligible Attack or Defense roll", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.training = { label: "训练靶", level: 3, life: 2, damage: 1 };
  let current = state(); current.weaponId = "unarmed"; current.weaponIds = ["unarmed"]; current.luck = 1;
  current.combat = { enemyId: "training", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 2, enemyLives: [2], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "unarmed", surprise: false, attackDisabled: false };
  const attack = availableFearActions(testStory, current).find(({ action }) => action.type === "attack" && action.luckRollIndex === 1);
  assert.ok(attack);
  current = advanceFear(testStory, current, attack.action, roller(2));
  assert.equal(current.luck, 0); assert.equal(current.combat?.enemyLife, 1);

  current = state(); current.luck = 1;
  current.combat = { enemyId: "training", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 2, enemyLives: [2], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const defend = availableFearActions(testStory, current).find(({ action }) => action.type === "defend" && action.luckTarget === "training:0");
  assert.ok(defend);
  current = advanceFear(testStory, current, defend.action, roller(3));
  assert.equal(current.luck, 0); assert.equal(current.hp, 8);
  current.luck = 0; current.combat!.playerFirst = false;
  assert.ok(!availableFearActions(testStory, current).some(({ action }) => action.type === "defend" && action.luckTarget));
});

test("Arcane book requirements, occultist prerequisites, SAN costs, and Hell Gate clue learning are enforced", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills = sourceDefinition.skills; testStory.fear.items = sourceDefinition.items; testStory.fear.arcaneLearning = sourceDefinition.arcaneLearning;
  const current = state(); current.xp = 3; current.inventory.necronomicon = 1;
  assert.ok(!availableFearActions(testStory, current).some(({ action }) => action.type === "learn-arcane" && action.skill === "energy-of-the-macrocosmos"), "Energy requires basic Occultist");
  current.skills.occultist = 1;
  assert.ok(availableFearActions(testStory, current).some(({ action }) => action.type === "learn-arcane" && action.skill === "energy-of-the-macrocosmos"));
  current.arcaneSkills.gate = 0; current.inventory["diabolical-deal"] = 1; current.xp = 2; current.clues = 5;
  current.missionProgress.gateHere = true;
  const gateActions = availableFearActions(testStory, current).filter(({ action }) => action.type === "learn-arcane" && action.skill === "gate");
  assert.ok(gateActions.some(({ action }) => action.target === "hell-gate"));
  assert.ok(gateActions.some(({ action }) => action.target === "diabolical-deal"));
  const learned = advanceFear(testStory, current, { type: "learn-arcane", skill: "gate", target: "hell-gate" }, roller());
  assert.equal(learned.clues, 0); assert.equal(learned.arcaneSkills.gate, 1); assert.equal(learned.elapsedTimeBoxes, 0);
});

test("user-authorized one-HP adaptations produce one real persisted failed-defense loss", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const adaptedIds = ["demonic-horrors-2", "possessed-2", "possessed-3", "possessed-5", "possessed-6"];
  for (const enemyId of adaptedIds) {
    const testStory: FearStory = structuredClone(story);
    const enemy = sourceDefinition.enemies[enemyId];
    testStory.fear.enemies[enemyId] = enemy;
    let current = state();
    current.combat = { enemyId, count: 1, defeatedCount: 0, enemyLevel: enemy.level, enemyLife: enemy.life, enemyLives: [enemy.life], enemyDamage: enemy.damage,
      damageResource: "hp", playerFirst: false, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false };
    current = advanceFear(testStory, current, { type: "defend" }, roller(1, 2));
    assert.equal(current.pending?.kind, "injury-prevention", `${enemyId} produces actual damage`);
    assert.equal(current.pending?.data?.amount, 1, `${enemyId} one-HP adapted loss`);
    const resumed = JSON.parse(JSON.stringify(current)) as FearState;
    const applied = advanceFear(testStory, resumed, { type: "choose", choice: "take-loss" }, roller());
    assert.equal(applied.hp, 7, `${enemyId} one persisted HP loss`);
    assert.equal(applied.combat?.enemyDamage, 1);
  }
});

test("source-defined choices apply only their selected typed effects", () => {
  const choiceStory: FearStory = structuredClone(story);
  choiceStory.fear.tables.town.entries[0].operations = [{ op: "choose-effect", prompt: "恢复并决定是否设安全屋", choices: {
    "life-only": [{ op: "resource", key: "hp", amount: 1 }],
    "safehouse": [{ op: "mark-safehouse", threshold: "before-create-3", restoreLife: 4, restoreSanity: 2 }],
  } }];
  let s = state(); s.hp = 5; s.sanity = 3;
  s = advanceFear(choiceStory, s, { type: "move", target: "s1:b2" }, roller(2));
  assert.equal(s.pending?.kind, "source-choice");
  assert.throws(() => advanceFear(choiceStory, s, { type: "choose", choice: "bad" }, roller()), /Invalid choice/);
  s = advanceFear(choiceStory, s, { type: "choose", choice: "safehouse" }, roller());
  assert.equal(s.hp, 8); assert.equal(s.sanity, 5); assert.equal(s.mapSheets[0].boxes[1].safehouse, true);
});

test("carried items share the source-defined capacity with Food and offer a discard choice", () => {
  const carryStory: FearStory = structuredClone(story);
  carryStory.fear.items = { heavy: { label: "重物" }, bandage: { label: "绷带" } };
  const s = state(); s.inventory.heavy = 9;
  s.pending = { kind: "item-choice", options: ["bandage"] };
  assert.equal(projectFear(carryStory, s).itemCapacity, 10);
  assert.equal(projectFear(carryStory, s).foodCapacity, 10);
  const extraFood = state(); extraFood.inventory.heavy = 8; extraFood.food = 11;
  assert.equal(projectFear(carryStory, extraFood).foodCapacity, 11);
  let next = advanceFear(carryStory, s, { type: "choose", choice: "bandage" }, roller());
  assert.equal(next.pending?.kind, "carry-capacity");
  const actions = availableFearActions(carryStory, next);
  assert.ok(actions.some(action => action.action.choice === "discard-new"));
  assert.ok(actions.some(action => action.action.choice === "discard-item:heavy" && action.label.includes("重物")));
  next = advanceFear(carryStory, next, { type: "choose", choice: "discard-item:heavy" }, roller());
  assert.equal(next.inventory.heavy, 8); assert.equal(next.inventory.bandage, 1); assert.equal(next.pending, undefined);
});

test("Safe House storage persists, theft is checked on return, and retrieval waits for encounter resolution", () => {
  const storageStory: FearStory = structuredClone(story);
  storageStory.fear.items = { bandage: { label: "绷带" } };
  let s = state(); const homeId = s.mapSheets[0].boxes[0].id;
  s.mapSheets[0].boxes[0].safehouse = true; s.safehouseIds.push(homeId); s.inventory.bandage = 2;
  s = advanceFear(storageStory, s, { type: "store-item", target: "item:bandage", amount: 2 }, roller());
  assert.equal(s.inventory.bandage, undefined); assert.equal(s.mapSheets[0].boxes[0].storedItems?.["item:bandage"], 2);
  s.mapSheets[0].boxes[0].safehouse = false; s.mapSheets[0].boxes[0].retiredSafehouse = true; s.mapSheets[0].boxes[0].storageTheftResolved = false;
  s.mapSheets[0].boxes[1].visited = true;
  s = advanceFear(storageStory, s, { type: "move", target: "s1:b2" }, roller(6, 6));
  s = advanceFear(storageStory, s, { type: "move", target: "s1:b1" }, roller(4, 6));
  assert.equal(s.mapSheets[0].boxes[0].storedItems?.["item:bandage"], 2); assert.equal(s.mapSheets[0].boxes[0].storageTheftResolved, true);
  assert.ok(availableFearActions(storageStory, s).some(action => action.action.type === "retrieve-item" && action.action.target === "item:bandage"));
  s = advanceFear(storageStory, s, { type: "retrieve-item", target: "item:bandage", amount: 1 }, roller());
  assert.equal(s.inventory.bandage, 1); assert.equal(s.mapSheets[0].boxes[0].storedItems?.["item:bandage"], 1);

  let stolen = state(); stolen.mapSheets[0].boxes[0].safehouse = true; stolen.safehouseIds.push("s1:b1"); stolen.inventory.bandage = 1;
  stolen = advanceFear(storageStory, stolen, { type: "store-item", target: "item:bandage", amount: 1 }, roller());
  stolen.mapSheets[0].boxes[0].safehouse = false; stolen.mapSheets[0].boxes[0].retiredSafehouse = true; stolen.mapSheets[0].boxes[0].storageTheftResolved = false;
  stolen.mapSheets[0].boxes[1].visited = true;
  stolen = advanceFear(storageStory, stolen, { type: "move", target: "s1:b2" }, roller(6, 6));
  stolen = advanceFear(storageStory, stolen, { type: "move", target: "s1:b1" }, roller(2, 6));
  assert.deepEqual(stolen.mapSheets[0].boxes[0].storedItems, {});
});

test("street Safe House gives its creation heal but does not inherit the recurring house heal", () => {
  const streetStory: FearStory = structuredClone(story);
  streetStory.fear.tables.town.entries[0].operations = [{ op: "mark-safehouse", threshold: "after-create-3", restoreLife: 1, restoreSanity: 1, visitHealLife: 0, visitHealSanity: 0 }];
  let s = initialFear(streetStory, { hp: 4, maxHp: 8, sanity: 4, maxSanity: 8 }, roller(1));
  s = advanceFear(streetStory, s, { type: "choose", choice: "s1:b1" }, roller());
  s = advanceFear(streetStory, s, { type: "move", target: "s1:b2" }, roller(6, 1));
  assert.equal(s.hp, 5); assert.equal(s.sanity, 5); assert.equal(s.mapSheets[0].boxes[1].safehouseHealLife, 0);
  s.hp = 1; s.sanity = 1;
  s = advanceFear(streetStory, s, { type: "move", target: "s1:b1" }, roller(6));
  s = advanceFear(streetStory, s, { type: "move", target: "s1:b2" }, roller());
  assert.equal(s.hp, 1); assert.equal(s.sanity, 1);
});

test("losing a backpack drops packed objects but leaves hand-held weapons", () => {
  const bagStory: FearStory = structuredClone(story);
  bagStory.fear.weapons.axe = { label: "斧", damage: 2 };
  bagStory.fear.tables.town.entries[0].operations = [{ op: "item", itemId: "backpack", amount: -1 }];
  let s = state(); s.inventory.backpack = 1; s.inventory.bandage = 2; s.weaponIds.push("axe");
  s = advanceFear(bagStory, s, { type: "move", target: "s1:b2" }, roller(6, 1));
  assert.deepEqual(s.inventory, {}); assert.deepEqual(s.weaponIds, ["knife", "axe"]);
});

test("event programs execute once per entry and retain the pre-entry replay snapshot", () => {
  const eventStory: FearStory = structuredClone(story);
  eventStory.fear.eventPrograms = { "1": [{ op: "event-branch", eventId: "1", ifNew: [{ op: "resource", key: "sanity", amount: -1 }], ifPlayed: [{ op: "resource", key: "clues", amount: 1 }] }] };
  let s = state(); s.nodeId = "event-1"; s.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  const action = availableFearActions(eventStory, s).find(item => item.action.type === "resolve-event");
  assert.ok(action);
  let next = advanceFear(eventStory, s, action.action, roller());
  assert.equal(next.sanity, 7, JSON.stringify({ log: next.log, pending: next.pending, resolved: next.resolvedEvents, status: next.status })); assert.ok(next.resolvedEvents.includes("1")); assert.equal(next.pendingEvent, undefined);
  s = { ...next, nodeId: "event-1", pendingEvent: { eventId: "1", alreadyPlayed: true, started: false, visitCount: next.visitCount } };
  next = advanceFear(eventStory, s, { type: "resolve-event", target: "1" }, roller());
  assert.equal(next.clues, 1); assert.equal(next.sanity, 7);
});

test("event-end applies the Seven Sacrifices sanity loss only after the event program completes", () => {
  const curseStory: FearStory = structuredClone(story);
  curseStory.fear.eventPrograms = { "21": [
    { op: "flag", key: "seven-sacrifices-curse", value: true },
    { op: "event-end" },
  ] };
  curseStory.fear.sceneRefs.events["21"] = "event-1";
  let s = state(); s.nodeId = "event-1";
  s.pendingEvent = { eventId: "21", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(curseStory, s, { type: "resolve-event", target: "21" }, roller());
  assert.equal(s.sanity, 7);
  assert.equal(s.pendingEvent, undefined);
  assert.equal(s.missionProgress["flag:seven-sacrifices-curse"], true);
  curseStory.fear.sceneRefs.events["22"] = "event-1";
  curseStory.fear.eventPrograms["22"] = [{ op: "if-flag", key: "seven-sacrifices-curse", value: true, success: [
    { op: "flag", key: "seven-sacrifices-curse", value: false }, { op: "restore-resource", key: "sanity", amount: 3 },
  ] }];
  s.nodeId = "event-1"; s.pendingEvent = { eventId: "22", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(curseStory, s, { type: "resolve-event", target: "22" }, roller());
  assert.equal(s.sanity, 8); assert.equal(s.missionProgress["flag:seven-sacrifices-curse"], false);
});

test("event 12 lets a failed stealth check succeed by paying all carried Food after a valid Charisma roll", () => {
  const sewerStory: FearStory = structuredClone(story);
  sewerStory.fear.sceneRefs.events["12"] = "event-1";
  sewerStory.fear.eventPrograms["12"] = [{ op: "roll-check", context: "stealth-save", level: 5, success: [{ op: "resource", key: "food", amount: "D6" }], failure: [
    { op: "if-resource", key: "food", comparison: "gte", value: 1, success: [{ op: "choose-effect", prompt: "应对", choices: {
      fight: [], bribe: [{ op: "if-resource", key: "food", comparison: "gte", value: 6, success: [
        { op: "roll-check", context: "charisma-save", level: 5, bonus: 1, success: [{ op: "spend-all-resource", key: "food" }], failure: [] },
      ], failure: [{ op: "roll-check", context: "charisma-save", level: 5, success: [{ op: "spend-all-resource", key: "food" }], failure: [] }] },
      ],
    } }], failure: [] },
  ] }];
  let s = state(); s.nodeId = "event-1"; s.pendingEvent = { eventId: "12", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(sewerStory, s, { type: "resolve-event", target: "12" }, roller(1));
  assert.equal(s.pending?.kind, "source-choice"); assert.ok(s.food >= 1);
  s = advanceFear(sewerStory, s, { type: "choose", choice: "bribe" }, roller(6));
  assert.equal(s.pending, undefined); assert.equal(s.food, 0);
});

test("event 11 models sewer shelter donation, L4 Charisma, recurring entry cost and rat poison", () => {
  const sewerStory: FearStory = structuredClone(story);
  sewerStory.nodes.push({ id: "event-11" });
  sewerStory.fear.sceneRefs.events["11"] = "event-11";
  sewerStory.fear.eventPrograms["11"] = [{ op: "sewer-shelter", enemyId: "sewer-rat-horde" }];
  sewerStory.fear.skills.charisma = { label: "魅力", xp: 3, modifiers: { charisma: [1, 2] } };
  sewerStory.fear.enemies["sewer-rat-horde"] = { label: "下水道鼠群", level: 2, life: 5, damage: 1, tags: ["animal"] };
  sewerStory.fear.items = { "rat-poison": { label: "鼠药" } };

  let safe = state(); safe.nodeId = "event-11"; safe.food = 2; safe.skills.charisma = 1;
  safe.pendingEvent = { eventId: "11", alreadyPlayed: false, started: false, visitCount: safe.visitCount };
  safe = advanceFear(sewerStory, safe, { type: "resolve-event", target: "11" }, roller());
  assert.equal(safe.pending?.kind, "sewer-donation");
  assert.ok(availableFearActions(sewerStory, safe).some(action => action.label === "交出2点食物"));
  safe = advanceFear(sewerStory, safe, { type: "choose", choice: "donate-food" }, roller(3));
  assert.equal(safe.food, 0); assert.equal(safe.mapSheets[0].boxes[0].safehouse, true);
  assert.equal(safe.mapSheets[0].boxes[0].entryFoodCost, 1);
  safe.food = 2; safe.mapSheets[0].boxes[1].visited = true;
  safe = advanceFear(sewerStory, safe, { type: "move", target: "s1:b2" }, roller(6));
  safe = advanceFear(sewerStory, safe, { type: "move", target: "s1:b1" }, roller());
  assert.equal(safe.food, 1); assert.equal(safe.mapSheets[0].boxes[0].safehouse, true);

  let fight = state(); fight.nodeId = "event-11"; fight.food = 3; fight.inventory["rat-poison"] = 1;
  fight.pendingEvent = { eventId: "11", alreadyPlayed: false, started: false, visitCount: fight.visitCount };
  fight = advanceFear(sewerStory, fight, { type: "resolve-event", target: "11" }, roller());
  fight = advanceFear(sewerStory, fight, { type: "choose", choice: "donate-food" }, roller(1, 1));
  assert.equal(fight.combat?.enemyId, "sewer-rat-horde");
  assert.equal(fight.combat?.enemyLife, 5);
  assert.ok(availableFearActions(sewerStory, fight).some(action => action.action.type === "use-item"));
  fight = advanceFear(sewerStory, fight, { type: "use-item", target: "rat-poison" }, roller());
  assert.equal(fight.food, 0); assert.equal(fight.inventory["rat-poison"], undefined);
  assert.equal(fight.combat?.enemyLife, 3);
});

test("source choices hide item-gated actions until their required item is carried", () => {
  const choiceStory: FearStory = structuredClone(story);
  choiceStory.nodes.push({ id: "event-17" }, { id: "event-21" });
  choiceStory.fear.sceneRefs.events["17"] = "event-17";
  choiceStory.fear.eventPrograms["17"] = [{ op: "choose-effect", prompt: "Rosen house", choices: {
    "dig-with-shovel": [{ op: "require-item", itemId: "shovel", success: [{ op: "route", scene: "event-21" }] }],
    "return-to-town": [],
  } }];
  let s = state(); s.nodeId = "event-17";
  s.pendingEvent = { eventId: "17", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(choiceStory, s, { type: "resolve-event", target: "17" }, roller());
  assert.deepEqual(s.pending?.options, ["return-to-town"]);
  let withShovel = state(); withShovel.nodeId = "event-17"; withShovel.inventory.shovel = 1;
  withShovel.pendingEvent = { eventId: "17", alreadyPlayed: false, started: false, visitCount: withShovel.visitCount };
  withShovel = advanceFear(choiceStory, withShovel, { type: "resolve-event", target: "17" }, roller());
  assert.ok(withShovel.pending?.options.includes("dig-with-shovel"));
});

test("speeding-train failure discards one carried item but excludes cursed gear and the Clown mask", () => {
  const trainStory: FearStory = structuredClone(story);
  trainStory.nodes.push({ id: "event-14" }); trainStory.fear.sceneRefs.events["14"] = "event-14";
  trainStory.fear.items = {
    book: { label: "书" }, "walrus-clown-mask": { label: "沃尔勒斯小丑面具", tags: ["clown-mask"] },
    "cursed-charm": { label: "诅咒护符", tags: ["cursed"] },
  };
  trainStory.fear.weapons["cursed-blade"] = { label: "诅咒刀", damage: 2, tags: ["cursed"] };
  trainStory.fear.eventPrograms["14"] = [{ op: "roll-check", context: "agility-save", level: 5, requiredSkill: "agile", success: [], failure: [
    { op: "resource", key: "hp", amount: -1 },
    { op: "discard-choice", excludedItemIds: ["walrus-clown-mask"], excludedTags: ["cursed", "clown-mask"], excludedWeaponIds: ["cursed-blade"] },
  ] }];
  let s = state(); s.nodeId = "event-14"; s.inventory.book = 1; s.inventory["walrus-clown-mask"] = 1; s.inventory["cursed-charm"] = 1;
  s.weaponIds.push("cursed-blade");
  s.pendingEvent = { eventId: "14", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(trainStory, s, { type: "resolve-event", target: "14" }, roller(1));
  assert.equal(s.hp, 7); assert.equal(s.pending?.kind, "discard-source-item");
  assert.deepEqual(s.pending?.options, ["item:book", "weapon:knife"]);
  assert.ok(availableFearActions(trainStory, s).every(action => !action.label.includes("诅咒") && !action.label.includes("小丑面具")));
  s = advanceFear(trainStory, s, { type: "choose", choice: "item:book" }, roller());
  assert.equal(s.inventory.book, undefined); assert.equal(s.inventory["walrus-clown-mask"], 1); assert.equal(s.weaponIds.includes("cursed-blade"), true);
});

test("Fluid result 1 installs a movement poison save and a successful save clears it", () => {
  const fluidStory: FearStory = structuredClone(story);
  fluidStory.nodes.push({ id: "event-4" }); fluidStory.fear.sceneRefs.events["4"] = "event-4";
  fluidStory.fear.eventPrograms["4"] = [{ op: "roll-table", tableId: "fluid" }];
  fluidStory.fear.tables.fluid = { die: "D6", entries: [{ roll: 1, result: "allergic-reaction", operations: [
    { op: "resource", key: "hp", amount: -1 },
    { op: "roll-check", context: "poison-save", level: 3, requiredSkill: "resilient", success: [], failure: [{ op: "ongoing-check", id: "fluid-allergy", trigger: "move", context: "poison-save", level: 3, requiredSkill: "resilient", failure: [{ op: "resource", key: "hp", amount: -1 }] }] },
  ] }] };
  let s = state(); s.nodeId = "event-4"; s.pendingEvent = { eventId: "4", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(fluidStory, s, { type: "resolve-event", target: "4" }, roller(1, 1));
  assert.equal(s.hp, 7); assert.equal(s.ongoingChecks.length, 1);
  s = advanceFear(fluidStory, s, { type: "move", target: "s1:b2" }, roller(6, 1));
  assert.equal(s.hp, 7); assert.equal(s.ongoingChecks.length, 0);
});

test("ordinary D6 level checks add the raw face before the skill modifier", () => {
  const checkStory: FearStory = structuredClone(story);
  checkStory.fear.tables.town.entries[0].operations = [{ op: "roll-check", context: "agility", level: 4, success: [{ op: "resource", key: "clues", amount: 1 }], failure: [] }];
  let s = advanceFear(checkStory, state(), { type: "move", target: "s1:b2" }, roller(2, 3));
  assert.equal(s.clues, 0);
  s = advanceFear(checkStory, state(), { type: "move", target: "s1:b2" }, roller(2, 4));
  assert.equal(s.clues, 1);
});

test("table effects after an encounter resume only when combat ends", () => {
  const deferredStory: FearStory = structuredClone(story);
  deferredStory.fear.tables.town.entries[0].operations = [
    { op: "start-combat", enemyId: "zombie", count: 1 },
    { op: "resource", key: "clues", amount: 1 },
  ];
  let s = advanceFear(deferredStory, state(), { type: "move", target: "s1:b2" }, roller(2));
  assert.ok(s.combat); assert.equal(s.clues, 0); assert.equal(s.deferredOperations?.length, 1);
  s = advanceFear(deferredStory, s, { type: "attack" }, roller(6, 1));
  assert.equal(s.combat, undefined); assert.equal(s.clues, 1); assert.equal(s.deferredOperations?.length, 0);
});

test("reviewed event 1 preserves its paragraph SHA and typed chained creature chances plus gate choice", () => {
  const program = JSON.parse(readFileSync("work/alone-against-fear/event-programs-reviewed.json", "utf8"));
  const sourcePath = `scripts/${program.events[0].source.fragment}`;
  const translationPath = `scripts/${program.events[0].source.translation}`;
  assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), program.events[0].source.sha256);
  assert.equal(createHash("sha256").update(readFileSync(translationPath)).digest("hex"), program.events[0].source.translationSha256);
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const translation = JSON.parse(readFileSync(translationPath, "utf8"));
  assert.deepEqual(program.events[0].source.sourceParagraphIds, source.paragraphs.map((p: { id: string }) => p.id));
  assert.deepEqual(program.events[0].source.translationParagraphIds, translation.paragraphs.map((p: { id: string }) => p.id));

  const eventStory: FearStory = structuredClone(story);
  eventStory.fear.tables.town.entries[0].operations = program.events[0].operations;
  let s = state(); s.arcaneSkills.gate = 1; s.sanity = 4;
  s = advanceFear(eventStory, s, { type: "move", target: "s1:b2" }, roller(2, 2, 6));
  assert.equal(s.pending?.kind, "hell-gate");
  assert.deepEqual(s.pending?.options, ["close", "ignore"]);
  s = advanceFear(eventStory, s, { type: "choose", choice: "close" }, roller(5));
  assert.equal(s.gatesClosed, 1); assert.equal(s.skipEncounters, 3); assert.equal(s.sanity, 6);
  eventStory.fear.tables.town.entries[0].operations = [{ op: "start-combat", enemyId: "zombie", count: 1 }];
  s = advanceFear(eventStory, s, { type: "move", target: "s1:b3" }, roller(2));
  assert.equal(s.combat, undefined); assert.equal(s.skipEncounters, 2);

  const cursedStory: FearStory = structuredClone(story); cursedStory.fear.tables.town.entries[0].operations = program.events[0].operations;
  let cursed = state(); cursed.arcaneSkills.gate = 1;
  cursed = advanceFear(cursedStory, cursed, { type: "move", target: "s1:b2" }, roller(2, 2, 6));
  cursed = advanceFear(cursedStory, cursed, { type: "choose", choice: "close" }, roller(4));
  assert.equal(cursed.gatesClosed, 0); assert.equal(cursed.encounterCurse, 1);
});

test("character creation resolves the three source starting-equipment rolls before play continues", () => {
  const startingStory: FearStory = structuredClone(story);
  startingStory.fear.weapons["baseball-bat"] = { label: "棒球棒", damage: 2 };
  startingStory.fear.weapons.hammer = { label: "锤子", damage: 2 };
  startingStory.fear.weapons.flashlight = { label: "手电筒", damage: 1, modifier: 2, tags: ["ranged", "shadow-only"] };
  startingStory.fear.rules.startingEquipmentTables = { randomWeapon: "startWeapon", randomObject: "startObject", usefulItem: "startUseful" };
  startingStory.fear.tables.startWeapon = { die: "D6", entries: [{ roll: [1, 6], result: "choose-starting-weapon", operations: [{ op: "choose-effect", prompt: "选择初始武器", choices: { "baseball-bat": [{ op: "weapon", weaponId: "baseball-bat" }], hammer: [{ op: "weapon", weaponId: "hammer" }] } }] }] };
  startingStory.fear.tables.startObject = { die: "D6", entries: [{ roll: [1, 6], result: "object", operations: [{ op: "item", itemId: "rope", amount: 1 }] }] };
  startingStory.fear.tables.startUseful = { die: "D6", entries: [{ roll: [1, 6], result: "useful", operations: [{ op: "item", itemId: "flashlight", amount: 1 }] }] };
  let s = initialFear(startingStory, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8 }, roller(1));
  s = advanceFear(startingStory, s, { type: "choose", choice: "s1:b1" }, roller(1));
  assert.equal(s.pending?.kind, "source-choice");
  assert.deepEqual(projectFear(startingStory, s).pending?.labels, { "baseball-bat": "棒球棒", hammer: "锤子" });
  assert.ok(availableFearActions(startingStory, s).some(action => action.label === "棒球棒"));
  assert.ok(availableFearActions(startingStory, s).some(action => action.label === "锤子"));
  s = advanceFear(startingStory, s, { type: "choose", choice: "baseball-bat" }, roller(1, 1));
  assert.deepEqual(s.weaponIds, ["knife", "baseball-bat", "flashlight"]);
  assert.equal(s.inventory.rope, 1);
  assert.equal(s.pending, undefined);
});

test("new-character allocation and two starting skills are real pending player choices", () => {
  let s = initialFear(story, {}, roller(1));
  assert.equal(s.pending?.kind, "creation-stats");
  s = advanceFear(story, s, { type: "choose", choice: "life:2,sanity:1" }, roller());
  assert.equal(s.hp, 10); assert.equal(s.sanity, 9); assert.equal(s.pending?.kind, "creation-skills");
  assert.ok(s.pending!.options.every(option => !option.includes("gate")));
  s = advanceFear(story, s, { type: "choose", choice: "danger-sense|investigator" }, roller());
  assert.equal(s.skills["danger-sense"], 1); assert.equal(s.skills.investigator, 1); assert.equal(s.pending?.kind, "starting-area");
});

test("the full three creation points can buy one extra Skill or one source table roll, but not a partial exchange", () => {
  const setupStory: FearStory = structuredClone(story);
  setupStory.fear.rules.startingEquipmentTables = { randomWeapon: "encounter", randomObject: "randomItems", usefulItem: "useful" };
  let s = initialFear(setupStory, {}, roller(1));
  assert.deepEqual(projectFear(setupStory, s).pending?.labels["extra:skill"], "用全部3点额外选择一项技能");
  assert.deepEqual(projectFear(setupStory, s).pending?.labels["extra:random-weapon"], "用全部3点额外掷一次随机武器表");
  s = advanceFear(setupStory, s, { type: "choose", choice: "extra:skill" }, roller());
  s = advanceFear(setupStory, s, { type: "choose", choice: "danger-sense|investigator" }, roller());
  assert.equal(s.pending?.kind, "creation-bonus-skill");
  assert.ok(!s.pending!.options.includes("danger-sense") && !s.pending!.options.includes("investigator"));
  s = advanceFear(setupStory, s, { type: "choose", choice: "slippery" }, roller());
  assert.equal(s.skills.slippery, 1);
  assert.equal(Object.values(s.skills).filter(level => level > 0).length, 3);
  assert.equal(s.pending?.kind, "starting-area");
  assert.throws(() => advanceFear(story, initialFear(story, {}, roller(1)), { type: "choose", choice: "life:1,sanity:1" }, roller()), /Invalid choice/);

  const equipmentStory: FearStory = structuredClone(story);
  equipmentStory.fear.rules.startingEquipmentTables = { randomWeapon: "encounter", randomObject: "randomItems", usefulItem: "useful" };
  let equipment = initialFear(equipmentStory, {}, roller(1));
  equipment = advanceFear(equipmentStory, equipment, { type: "choose", choice: "extra:random-object" }, roller());
  assert.equal(equipment.deferredOperations?.[0]?.op, "roll-table");
  assert.equal((equipment.deferredOperations?.[0] as { tableId?: string }).tableId, "randomItems");
});

test("Tough and Strong Grip on Reality apply their permanent maximum and current stat bonuses", () => {
  const skillStory: FearStory = structuredClone(story);
  skillStory.fear.skills.tough = { label: "坚韧", xp: 8, modifiers: {}, maxHpChange: [2, 3] };
  skillStory.fear.skills["strong-grip-on-reality"] = { label: "现实锚定", xp: 6, modifiers: {}, maxSanityChange: [1, 2] };
  let s = initialFear(skillStory, {}, roller(1));
  s = advanceFear(skillStory, s, { type: "choose", choice: "life:0,sanity:3" }, roller());
  s = advanceFear(skillStory, s, { type: "choose", choice: "strong-grip-on-reality|tough" }, roller());
  s = advanceFear(skillStory, s, { type: "choose", choice: "s1:b1" }, roller());
  assert.equal(s.maxHp, 10); assert.equal(s.hp, 10); assert.equal(s.maxSanity, 12); assert.equal(s.sanity, 12);
  s.xp = 8;
  s = advanceFear(skillStory, s, { type: "learn-skill", skill: "tough" }, roller());
  assert.equal(s.maxHp, 11); assert.equal(s.hp, 11);
});

test("Fear injury modifiers and eating-disorder trauma affect later play", () => {
  const injuryStory: FearStory = structuredClone(story);
  injuryStory.fear.injuries = { "impaired-arm": { label: "手臂受损", modifiers: { "attack-melee": -1 } } };
  injuryStory.fear.traumas = { "eating-disorder": { label: "进食障碍", foodEveryBoxes: 3 } };
  injuryStory.fear.enemies.training = { label: "训练靶", level: 3, life: 4, damage: 1 };
  injuryStory.fear.tables.injury = { die: "D6", entries: [{ roll: 2, result: "impaired-arm" }, { roll: [1, 1], result: "other" }, { roll: [3, 6], result: "other" }] };
  injuryStory.fear.tables.town.entries[0].operations = [{ op: "injury-check", kind: "life", amount: 1, tableId: "injury" }];
  let s = advanceFear(injuryStory, state(), { type: "move", target: "s1:b2" }, roller(2));
  s = advanceFear(injuryStory, s, { type: "choose", choice: "prevent-with-scar" }, roller(2));
  assert.deepEqual(s.scars, ["impaired-arm"]);
  injuryStory.fear.tables.town.entries[0].operations = [{ op: "start-combat", enemyId: "training", count: 1 }];
  s = advanceFear(injuryStory, s, { type: "move", target: "s1:b3" }, roller(2));
  s = advanceFear(injuryStory, s, { type: "attack" }, roller(2));
  assert.deepEqual(s.combat?.enemyLives, [4], "injury modifier makes a 2 face +1 weapon modifier fail the L3 threshold");

  injuryStory.fear.tables.town.entries[0].operations = [];
  let hungry = initialFear(injuryStory, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 10, traumas: ["eating-disorder"] }, roller(1));
  hungry = advanceFear(injuryStory, hungry, { type: "choose", choice: "s1:b1" }, roller());
  hungry = advanceFear(injuryStory, hungry, { type: "move", target: "s1:b2" }, roller(2));
  hungry = advanceFear(injuryStory, hungry, { type: "move", target: "s1:b3" }, roller(2));
  hungry = advanceFear(injuryStory, hungry, { type: "move", target: "s1:b4" }, roller(2));
  assert.equal(hungry.food, 9, "eating-disorder consumes food every three box crossings");
});

test("search roll of one resolves the normalized random encounter table", () => {
  const s = advanceFear(story, state(), { type: "search" }, roller(1, 1));
  assert.ok(s.log.some(line => line === "encounter 1: 僵尸"));
});

test("Farm table #2 performs one modified L6 Search and grants only its printed chosen reward", () => {
  const farmSource = readFileSync("scripts/alone-against-fear/fragments/section-farm-table.json");
  const farmTranslation = readFileSync("scripts/alone-against-fear/translations/zh-CN/section-farm-table.json", "utf8");
  assert.equal(createHash("sha256").update(farmSource).digest("hex"), "5956dd1aac6bcc6b511bb6753adaa426995828018576e78557402049e40846e6");
  assert.equal(JSON.parse(farmTranslation).sourceFragmentSha256, "5956dd1aac6bcc6b511bb6753adaa426995828018576e78557402049e40846e6");
  assert.equal(createHash("sha256").update(farmTranslation).digest("hex"), "5bec3ce3a25166f9af498bb918ed80fbf55fa2ac8524a98108cbf4bc85de5176");
  const p2 = JSON.parse(farmSource.toString("utf8")).paragraphs.find((p: { id: string }) => p.id === "section-farm-table:p2");
  assert.match(p2.text, /d6 Food OR you may perform a Search roll/);
  assert.match(p2.text, /d6 doses of salt, 1 holy book, d3 shotgun shells, 1 Clue/);
  const farmStory: FearStory = structuredClone(story);
  farmStory.fear.items = { ...farmStory.fear.items, salt: { label: "盐" }, "holy-book": { label: "圣书", tags: ["book"] } };
  farmStory.fear.weapons = { ...farmStory.fear.weapons,
    pitchfork: { label: "干草叉", damage: 1 }, axe: { label: "斧头", damage: 2 }, shotgun: { label: "霰弹枪", damage: 2, ammoType: "shells" } };
  farmStory.fear.tables.encounter.entries[0].operations = [{ op: "start-combat", enemyId: "zombie", count: 1 }];
  farmStory.fear.tables.town.entries[0].operations = [{ op: "farm-food-or-search", food: "D6", choices: ["food", "search"] }];
  let current = advanceFear(farmStory, state(), { type: "move", target: "s1:b2" }, roller(2, 2));
  assert.equal(current.pending?.kind, "farm-choice");
  assert.deepEqual(availableFearActions(farmStory, current).filter(action => action.action.type === "choose").map(action => action.label), ["取得D6食物", "搜索"]);
  current = advanceFear(farmStory, current, { type: "choose", choice: "search" }, roller(6));
  assert.equal(current.pending?.kind, "farm-search-loot");
  assert.deepEqual(projectFear(farmStory, current).pending?.labels, {
    pitchfork: "干草叉", axe: "斧头", salt: "盐（D6份）", "holy-book": "圣书", "shotgun-shells": "霰弹（D3发）", clue: "1点线索",
  });
  current = advanceFear(farmStory, current, { type: "choose", choice: "salt" }, roller(3));
  assert.equal(current.inventory.salt, 3);
  assert.equal(current.pending, undefined);
  assert.equal(current.mapSheets[0].boxes.find(box => box.id === "s1:b2")?.searchesMade, 1);
  assert.equal(availableFearActions(farmStory, current).some(action => action.action.type === "search"), false, "the Farm Search consumes this area's one source Search mark");
  assert.throws(() => advanceFear(farmStory, current, { type: "choose", choice: "search" }, roller(6)), /unavailable in the current phase/);

  const outcomes: Array<[string, (s: FearState) => void]> = [
    ["pitchfork", s => assert.ok(s.weaponIds.includes("pitchfork"))],
    ["axe", s => assert.ok(s.weaponIds.includes("axe"))],
    ["holy-book", s => assert.equal(s.inventory["holy-book"], 1)],
    ["shotgun-shells", s => assert.equal(s.ammo.shotgun, 2)],
    ["clue", s => assert.equal(s.clues, 1)],
  ];
  for (const [choice, verify] of outcomes) {
    let s = advanceFear(farmStory, state(), { type: "move", target: "s1:b2" }, roller(2, 2));
    s = advanceFear(farmStory, s, { type: "choose", choice: "search" }, roller(6));
    s = advanceFear(farmStory, s, { type: "choose", choice }, roller(choice === "shotgun-shells" ? 3 : 2));
    verify(s);
  }

  let failed = advanceFear(farmStory, state(), { type: "move", target: "s1:b2" }, roller(2, 2));
  failed = advanceFear(farmStory, failed, { type: "choose", choice: "search" }, roller(1, 1));
  assert.equal(failed.combat?.enemyId, "zombie", "natural 1 invokes the source Random Encounter table");
  assert.equal(failed.inventory.salt, undefined);
  assert.ok(failed.log.some(line => line.includes("农场搜索 L6：1（自然1失败）")));
  assert.equal(failed.mapSheets[0].boxes.find(box => box.id === "s1:b2")?.searchesMade, 1, "the encounter does not reset the S mark or enable a retry");
});

test("a source creature row stored as enemyId/count values actually starts its printed combat", () => {
  const creatureStory: FearStory = structuredClone(story);
  creatureStory.fear.enemies["undead-1"] = { label: "僵尸群", level: 2, life: 1, damage: 1, tags: ["zombie"] };
  creatureStory.fear.tables.undead = { die: "D6", entries: [{ roll: 1, result: "undead-1", values: { enemyId: "undead-1", count: "2D6" } }] };
  creatureStory.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "undead" }];
  let s = state(); s.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  s = advanceFear(creatureStory, s, { type: "resolve-event", target: "1" }, roller(1, 2, 6));
  assert.equal(s.combat?.enemyId, "undead-1");
  assert.equal(s.combat?.count, 8, "2D6 encounter size must consume both printed D6 dice after table D6");
  assert.deepEqual(s.combat?.enemyLives, [1, 1, 1, 1, 1, 1, 1, 1]);
});

test("Experience p11 awards one XP per won encounter, none for escape, and does not double an explicit encounter reward", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-experience.json", "utf8");
  const translation = readFileSync("scripts/alone-against-fear/translations/zh-CN/section-experience.json", "utf8");
  assert.equal(createHash("sha256").update(source).digest("hex"), "4a9ec3dca0d03b113067e6578a0a76aede4370035d2f8feb26ef3ef676bb1897");
  assert.equal(JSON.parse(translation).sourceFragmentSha256, "4a9ec3dca0d03b113067e6578a0a76aede4370035d2f8feb26ef3ef676bb1897");
  assert.match(JSON.parse(source).paragraphs[1].text, /receive 1 XP\s+every time you win a combat\s+encounter/);
  const enemyStory: FearStory = structuredClone(story);
  enemyStory.fear.enemies.zombie = { label: "僵尸", level: 2, life: 1, damage: 1, tags: ["zombie"] };
  const makeCombat = () => {
    const s = state();
    s.combat = { enemyId: "zombie", count: 2, defeatedCount: 0, enemyLevel: 2, enemyLife: 1, enemyLives: [1, 1], enemyDamage: 1,
      damageResource: "hp", playerFirst: true, round: 1, weaponId: s.weaponId, surprise: false, attackDisabled: false };
    return s;
  };
  let won = advanceFear(enemyStory, makeCombat(), { type: "attack" }, roller(2));
  assert.equal(won.xp, 0, "one enemy remains, so the encounter is not yet won");
  won = advanceFear(enemyStory, won, { type: "defend" }, roller(6));
  won = advanceFear(enemyStory, won, { type: "attack" }, roller(2));
  assert.equal(won.combat, undefined);
  assert.equal(won.xp, 1, "two defeated enemies in one encounter award one XP");

  const fleeing = makeCombat();
  fleeing.combat!.enemyLevel = 7;
  const ran = advanceFear(enemyStory, fleeing, { type: "escape" }, roller(2));
  assert.equal(ran.xp, 0);
  assert.ok(ran.combat, "failed Escape leaves the encounter active and grants no XP");

  enemyStory.fear.eventPrograms["1"] = [
    { op: "start-combat", enemyId: "zombie", count: 1 },
    { op: "combat-outcome", enemyId: "zombie", defeated: [{ op: "resource", key: "xp", amount: 1 }] },
  ];
  const explicit = state(); explicit.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: explicit.visitCount };
  let wonExplicit = advanceFear(enemyStory, explicit, { type: "resolve-event", target: "1" }, roller());
  wonExplicit = advanceFear(enemyStory, wonExplicit, { type: "attack" }, roller(2));
  assert.equal(wonExplicit.xp, 1, "an explicit source encounter XP operation replaces the default award, rather than doubling it");
});

test("a generic Witch-tagged table creature does not count as one of the five source-defined Coven witches", () => {
  const covenStory: FearStory = structuredClone(story);
  covenStory.fear.missions["5"] = { label: "女巫契约", goal: "击败五名女巫", kind: "witches" };
  covenStory.fear.enemies.witch = { label: "女巫", level: 1, life: 1, damage: 1, tags: ["witch"] };
  let current = initialFear(covenStory, { missionId: "5", hp: 8, sanity: 8, weaponIds: ["knife"], weaponId: "knife" }, roller(1));
  current = advanceFear(covenStory, current, { type: "choose", choice: current.pending!.options[0] }, roller());
  for (let witch = 0; witch < 5; witch++) {
    current.combat = { enemyId: "witch", count: 1, defeatedCount: 0, enemyLevel: 1, enemyLife: 1, enemyLives: [1], enemyDamage: 1,
      round: 1, playerFirst: true, surprise: false, weaponId: "knife", attackDisabled: false };
    current = advanceFear(covenStory, current, { type: "attack" }, roller(2));
  }
  assert.equal(current.missionProgress.witchesResolved, undefined);
  assert.equal(current.missionProgress.witchXp, undefined);
  assert.equal(current.missionRules?.witches.defeated, 0);
  const source = JSON.parse(readFileSync(`${process.cwd()}/scripts/alone-against-fear/fragments/section-mission-table-continued.json`, "utf8"));
  const paragraph = source.paragraphs.find((item: { text: string }) => /You gain 1 XP every time you defeat a witch and 2 XP/.test(item.text));
  assert.ok(paragraph, "mission source pins the per-witch and last-witch XP rule");
});

test("campaign mission substate is initialized from real actions and seven Gates persist across sessions", () => {
  const campaignStory: FearStory = structuredClone(story);
  campaignStory.fear.missions = {
    "1": { label: "医疗物资", goal: "找回药品", kind: "medical-supplies" },
    "2": { label: "猎杀目标", goal: "击败杀手", kind: "hunt-target", target: "slasher" },
    "3": { label: "食物", goal: "运回食物", kind: "bring-food", target: 20 },
    "4": { label: "武器", goal: "运回武器", kind: "bring-weapons" },
    "5": { label: "女巫契约", goal: "击败五名女巫", kind: "witches" },
    "6": { label: "地狱之门", goal: "关闭一扇门", kind: "hell-gates" },
  };
  campaignStory.fear.enemies.slasher = { label: "杀手", level: 2, life: 2, damage: 1, tags: ["killer"] };
  campaignStory.fear.tables.town.entries = [{ roll: [1, 6], result: "gate", operations: [{ op: "mark-gate" }] }];
  let current = initialFear(campaignStory, { missionId: "6", hp: 8, sanity: 8, skills: {}, arcaneSkills: { gate: 1 }, weaponIds: ["knife"], weaponId: "knife" }, roller(1));
  current = advanceFear(campaignStory, current, { type: "choose", choice: "s1:b1" }, roller(1));
  assert.equal(current.missionRules?.missionId, "6");
  assert.equal(current.missionRules?.campaign.gatesClosed, 0);
  const closeOneGate = (stateNow: FearState) => {
    if (stateNow.missionProgress.gateHere !== true) {
      const visited = new Set(stateNow.mapSheets.flatMap(sheet => sheet.boxes.filter(box => box.visited).map(box => box.id)));
      const next = availableFearActions(campaignStory, stateNow).find(({ action }) => action.type === "move" && action.target && !visited.has(action.target));
      assert.ok(next, "a source-adjacent unvisited map box is available");
      stateNow = advanceFear(campaignStory, stateNow, next.action, roller(1));
    }
    return advanceFear(campaignStory, stateNow, { type: "close-gate" }, roller(6));
  };
  current = closeOneGate(current);
  assert.equal(current.missionFinished, true, "mission six completes as soon as one gate is closed");
  assert.equal(current.missionRules?.campaign.gatesClosed, 1);
  current = advanceFear(campaignStory, current, { type: "start-mission" }, roller(1));
  current = advanceFear(campaignStory, current, { type: "choose", choice: "s1:b1" }, roller(1));
  assert.equal(current.missionId, "1");
  assert.equal(current.missionRules?.campaign.gatesClosed, 1, "closed gates persist when another mission starts");
  for (let gate = 1; gate < 7; gate++) current = closeOneGate(current);
  assert.equal(current.gatesClosed, 7);
  assert.equal(current.missionRules?.campaign.gatesClosed, 7);
  assert.equal(current.status, "won", "campaign ends at seven gates regardless of the active side mission");
});

test("medical mission runtime finds source D6 doses on House rolls and completes only after returning", () => {
  const medicalStory: FearStory = structuredClone(story);
  medicalStory.fear.missions = { "1": { label: "医疗物资", goal: "带回三剂药品", kind: "medical-supplies" } };
  medicalStory.fear.items = { ...medicalStory.fear.items, "medicine-dose": { label: "药品剂量" } };
  medicalStory.fear.tables.town.entries = [{ roll: [1, 6], result: "house", operations: [{ op: "roll-table", tableId: "house" }] }];
  medicalStory.fear.tables.house = { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] };
  let current = initialFear(medicalStory, { missionId: "1", hp: 8, sanity: 8, skills: {}, weaponIds: ["knife"], weaponId: "knife" }, roller(6));
  current = advanceFear(medicalStory, current, { type: "choose", choice: "s1:b1" }, roller());
  for (let visit = 0; visit < 3; visit++) {
    const visited = new Set(current.mapSheets.flatMap(sheet => sheet.boxes.filter(box => box.visited).map(box => box.id)));
    const next = availableFearActions(medicalStory, current).find(({ action }) => action.type === "move" && action.target && !visited.has(action.target));
    assert.ok(next);
    current = advanceFear(medicalStory, current, next.action, roller(1, 1, 1)); // town, House, mission-dose rolls
  }
  assert.equal(current.missionRules?.medical.dosesFound, 3);
  assert.equal(current.inventory["medicine-dose"], 3);
  for (const target of [...(current.missionRules?.visitedBoxIds ?? [])].slice(0, -1).reverse()) {
    const home = availableFearActions(medicalStory, current).find(({ action }) => action.type === "move" && action.target === target);
    assert.ok(home);
    current = advanceFear(medicalStory, current, home.action, roller(6));
  }
  assert.ok(availableFearActions(medicalStory, current).some(({ action }) => action.type === "end-mission"));
  current = advanceFear(medicalStory, current, { type: "end-mission" }, roller());
  assert.equal(current.missionFinished, true);
  assert.equal(current.xp, 3);
  assert.equal(current.missionRules?.finished, true);
});

test("Food mission rolls a separate cargo die on Street visits and carries cargo back", () => {
  const foodStory: FearStory = structuredClone(story);
  foodStory.fear.missions = { "3": { label: "食物", goal: "运回任务食物", kind: "bring-food" } };
  foodStory.fear.tables.town.entries = [{ roll: [1, 6], result: "street", operations: [{ op: "roll-table", tableId: "street" }] }];
  foodStory.fear.tables.street = { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] };
  let current = initialFear(foodStory, { missionId: "3", hp: 8, sanity: 8, food: 1, inventory: { backpack: 1 }, skills: {}, weaponIds: ["knife"], weaponId: "knife" }, roller(1, 1, 1));
  const target = current.missionFoodTarget;
  current = advanceFear(foodStory, current, { type: "choose", choice: "s1:b1" }, roller());
  while (current.missionFood < target) {
    const visited = new Set(current.mapSheets.flatMap(sheet => sheet.boxes.filter(box => box.visited).map(box => box.id)));
    const next = availableFearActions(foodStory, current).find(({ action }) => action.type === "move" && action.target && !visited.has(action.target));
    assert.ok(next);
    current = advanceFear(foodStory, current, next.action, roller(1, 1, 1, 6)); // Town, Street, 3/6 success, 6 Food
  }
  assert.equal(current.missionRules?.food.cargo, current.missionFood);
  assert.ok(current.missionFood >= target);
  for (const target of [...(current.missionRules?.visitedBoxIds ?? [])].slice(0, -1).reverse()) {
    const home = availableFearActions(foodStory, current).find(({ action }) => action.type === "move" && action.target === target);
    assert.ok(home);
    current = advanceFear(foodStory, current, home.action, roller(6));
  }
  assert.ok(availableFearActions(foodStory, current).some(({ action }) => action.type === "end-mission"));
  current = advanceFear(foodStory, current, { type: "end-mission" }, roller());
  assert.equal(current.pending?.kind, "mission-reward");
  current = advanceFear(foodStory, current, { type: "choose", choice: "xp" }, roller());
  assert.equal(current.missionFinished, true);
  assert.equal(current.xp, 3);
  assert.equal(current.missionRules?.finished, true);
});

test("hunt mission spends the target-level Clues, forces combat on the next entered box, then rewards on return", () => {
  const huntStory: FearStory = structuredClone(story);
  huntStory.fear.missions = { "2": { label: "猎手与猎物", goal: "击败指定杀手并返回", kind: "hunt-target", target: "target-slasher" } };
  huntStory.fear.enemies["target-slasher"] = { label: "目标杀手", level: 1, life: 1, damage: 1, tags: ["killer"] };
  let current = initialFear(huntStory, { missionId: "2", hp: 8, sanity: 8, clues: 1, skills: {}, weaponIds: ["knife"], weaponId: "knife" }, roller(6));
  current = advanceFear(huntStory, current, { type: "choose", choice: "s1:b1" }, roller());
  assert.ok(availableFearActions(huntStory, current).some(({ action }) => action.type === "locate-hunt-target"));
  current = advanceFear(huntStory, current, { type: "locate-hunt-target" }, roller());
  assert.equal(current.clues, 0);
  assert.equal(current.missionRules?.hunt.targetOnNextBox, true);
  const nextBox = availableFearActions(huntStory, current).find(({ action }) => action.type === "move");
  assert.ok(nextBox);
  current = advanceFear(huntStory, current, nextBox.action, roller(6));
  assert.equal(current.combat?.enemyId, "target-slasher", "the next entered area starts the target fight instead of ordinary box content");
  current = advanceFear(huntStory, current, { type: "attack" }, roller(2));
  assert.equal(current.missionRules?.hunt.targetDefeated, true);
  assert.equal(current.missionProgress.targetDefeated, true);
  current = advanceFear(huntStory, current, { type: "move", target: "s1:b1" }, roller(6));
  assert.ok(availableFearActions(huntStory, current).some(({ action }) => action.type === "end-mission"));
  current = advanceFear(huntStory, current, { type: "end-mission" }, roller());
  assert.equal(current.pending?.kind, "mission-reward");
  current = advanceFear(huntStory, current, { type: "choose", choice: "xp" }, roller());
  assert.equal(current.xp, 6, "one XP for defeating the target encounter plus five mission XP");
  assert.equal(current.missionRules?.finished, true);
  const source = JSON.parse(readFileSync(`${process.cwd()}/scripts/alone-against-fear/fragments/section-mission-table.json`, "utf8"));
  assert.ok(source.paragraphs.find((paragraph: { id: string }) => paragraph.id === "section-mission-table:p2"));
});

test("Mission 4 exposes a source-valid adjacent Town adjustment and resolves its military destination", () => {
  const armoryStory: FearStory = structuredClone(story);
  armoryStory.fear.missions["4"] = { label: "武器", goal: "带回枪械", kind: "bring-weapons" };
  armoryStory.fear.tables.town = { die: "2D6", entries: [
    { roll: 2, result: "random-event" }, { roll: 3, result: "choose-military-or-clinic", operations: [{ op: "choose-table", tableIds: ["military", "clinic"] }] },
    { roll: 4, result: "choose-farm-or-cemetery" },
  ] };
  let current = initialFear(armoryStory, { missionId: "4", hp: 8, sanity: 8, weaponIds: ["knife"], weaponId: "knife" }, roller(1));
  current = advanceFear(armoryStory, current, { type: "choose", choice: "s1:b1" }, roller());
  current = advanceFear(armoryStory, current, { type: "move", target: "s1:b2" }, roller(1, 1));
  assert.equal(current.pending?.kind, "mission-town-adjustment");
  assert.deepEqual(current.pending?.options, ["1"]);
  current = advanceFear(armoryStory, current, { type: "choose", choice: "1" }, roller());
  assert.equal(current.pending?.kind, "table-choice");
  assert.ok(current.pending?.options.includes("military"));
});

test("Mission 4 returns each eligible firearm with six rounds for one XP, capped at five, without invented recovery", () => {
  const weaponStory: FearStory = structuredClone(story);
  weaponStory.fear.missions["4"] = { label: "武器", goal: "带回枪械", kind: "bring-weapons" };
  weaponStory.fear.weapons.pistol = { label: "手枪", damage: 1, ammoType: "pistol", tags: ["mission-gun"] };
  weaponStory.fear.weapons.shotgun = { label: "霰弹枪", damage: 1, ammoType: "shotgun", tags: ["mission-gun"] };
  weaponStory.fear.weapons.rifle = { label: "步枪", damage: 1, ammoType: "rifle", tags: ["mission-gun"] };
  let current = initialFear(weaponStory, { missionId: "4", hp: 5, maxHp: 8, sanity: 4, maxSanity: 8,
    weaponIds: ["knife", "pistol", "shotgun", "rifle"], weaponId: "knife", ammo: { pistol: 6, shotgun: 6, rifle: 6 } }, roller(1));
  current = advanceFear(weaponStory, current, { type: "choose", choice: "s1:b1" }, roller());
  assert.ok(availableFearActions(weaponStory, current).some(({ action }) => action.type === "end-mission"));
  current = advanceFear(weaponStory, current, { type: "end-mission" }, roller());
  assert.equal(current.xp, 3);
  assert.equal(current.missionRules?.finished, true);
  assert.equal(current.hp, 5);
  assert.equal(current.sanity, 4);
});

test("Mission 4 counts firearm instances against exact-type shared ammo without multiplying one pool", () => {
  const sourcePath = `${process.cwd()}/scripts/alone-against-fear/fragments/section-mission-table-continued.json`;
  const ammoPath = `${process.cwd()}/scripts/alone-against-fear/fragments/section-keep-track-of-ammo.json`;
  const sourceBytes = readFileSync(sourcePath);
  const ammoBytes = readFileSync(ammoPath);
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), "2183b92d0b4b3fa48f42caaf9c26535e69b0d7f50cb500adf04a2b4e7124d497");
  assert.equal(createHash("sha256").update(ammoBytes).digest("hex"), "8d766c6de02a4d1d4232c5655995dd021e076572c6d686f63080d8c24ea3bcc4");
  const missionSource = JSON.parse(sourceBytes.toString()) as { paragraphs: Array<{ id: string; text: string; sourceLocation: string }> };
  const ammoSource = JSON.parse(ammoBytes.toString()) as { paragraphs: Array<{ id: string; text: string; sourceLocation: string }> };
  const missionClause = missionSource.paragraphs.find(row => row.id === "section-mission-table-continued:p1")!;
  const ammoClause = ammoSource.paragraphs.find(row => row.id === "section-keep-track-of-ammo:p1")!;
  assert.match(missionClause.text, /1 XP per every firearm with at least 6 ammo/);
  assert.match(missionClause.text, /maximum gain of 5 XP/);
  assert.match(ammoClause.text.replace(/\s+/g, " "), /unless the weapons are exactly the same/);
  assert.ok(missionClause.sourceLocation.includes("[41,") && ammoClause.sourceLocation.includes("[31,"));

  const missionStory: FearStory = structuredClone(story);
  missionStory.fear.missions = { "4": { label: "武器", goal: "带回枪械", kind: "bring-weapons" } };
  missionStory.fear.weapons.pistol = { label: "手枪", damage: 1, ammoType: "pistol" };
  const finish = (ammo: number) => {
    let current = initialFear(missionStory, { missionId: "4", hp: 8, sanity: 8,
      weaponIds: ["knife", "pistol", "pistol"], weaponId: "knife", ammo: { pistol: ammo } }, roller(1));
    current = advanceFear(missionStory, current, { type: "choose", choice: "s1:b1" }, roller());
    assert.deepEqual(projectFear(missionStory, current).weapons.find(weapon => weapon.id === "pistol"),
      { id: "pistol", label: "手枪", count: 2, ammo });
    current = advanceFear(missionStory, current, { type: "end-mission" }, roller());
    return current.xp;
  };
  assert.equal(finish(8), 1, "two identical firearms sharing eight rounds qualify only one six-round delivery");
  assert.equal(finish(12), 2, "two physical firearms with twelve shared same-type rounds qualify twice");
});

test("Coven mission finds five distinct witches through source clue choices, applies per-turn Will, and resolves three-roll best reward", () => {
  const covenStory: FearStory = structuredClone(story);
  covenStory.fear.missions["5"] = { label: "摧毁女巫集会", goal: "击败五名女巫", kind: "witches" };
  covenStory.fear.enemies["coven-witch"] = { label: "集会女巫", level: 4, life: 4, damage: 1, tags: ["human", "witch"] };
  covenStory.fear.weapons.tester = { label: "测试武器", damage: 4 };
  covenStory.fear.items = { ...covenStory.fear.items, bandage: { label: "绷带" }, salt: { label: "盐" }, rope: { label: "绳子" } };
  covenStory.fear.tables.useful.entries = [
    { roll: 1, result: "bandage", operations: [{ op: "item", itemId: "bandage", amount: 1 }] },
    { roll: 2, result: "salt", operations: [{ op: "item", itemId: "salt", amount: 1 }] },
    { roll: 3, result: "rope", operations: [{ op: "item", itemId: "rope", amount: 1 }] },
    { roll: [4, 6], result: "bandage", operations: [{ op: "item", itemId: "bandage", amount: 1 }] },
  ];
  let current = initialFear(covenStory, { missionId: "5", hp: 8, sanity: 8, clues: 15, weaponIds: ["tester"], weaponId: "tester" }, roller(1));
  current = advanceFear(covenStory, current, { type: "choose", choice: current.pending!.options[0] }, roller());
  for (const [index, boxId] of ["s1:b2", "s1:b3", "s1:b4", "s1:b5", "s1:b10"].entries()) {
    current = advanceFear(covenStory, current, { type: "move", target: boxId }, roller(6));
    assert.equal(current.pending?.kind, "mission-witch-find");
    current = advanceFear(covenStory, current, { type: "choose", choice: "spend:3" }, roller());
    assert.equal(current.combat?.enemyId, "coven-witch", JSON.stringify({ pending: current.pending, clues: current.clues, progress: current.missionProgress }));
    current = advanceFear(covenStory, current, { type: "attack" }, roller(6, 6, 1, 2, 3));
    assert.equal(current.missionRules?.witches.defeated, index + 1);
  }
  assert.equal(current.xp, 7);
  assert.equal(current.pending?.kind, "mission-witch-final-item");
  assert.deepEqual(current.pending?.options, ["1", "2", "3"]);
  current = advanceFear(covenStory, current, { type: "choose", choice: "2" }, roller());
  assert.equal(current.missionFinished, true);
  assert.equal(current.missionRules?.finished, true);
  assert.equal(current.inventory.rope, 1, JSON.stringify({ inventory: current.inventory, pending: current.pending, xp: current.xp }));
  const source = JSON.parse(readFileSync("scripts/alone-against-fear/fragments/section-mission-table-continued.json", "utf8"));
  assert.match(source.paragraphs.find((p: { id: string }) => p.id === "section-mission-table-continued:p2").text, /Each turn you are in combat with a\s+witch/);
});

test("Coven mission permits source-listed nonlethal hand-to-hand capture and awards its restricted next-witch Clue", () => {
  const covenStory: FearStory = structuredClone(story);
  covenStory.fear.missions["5"] = { label: "摧毁女巫集会", goal: "击败五名女巫", kind: "witches" };
  covenStory.fear.enemies["coven-witch"] = { label: "集会女巫", level: 4, life: 4, damage: 1, tags: ["human", "witch"] };
  covenStory.fear.weapons.unarmed = { label: "徒手攻击", damage: 4, modifier: -2, tags: ["unarmed"] };
  let current = initialFear(covenStory, { missionId: "5", hp: 8, sanity: 8, weaponIds: ["unarmed"], weaponId: "unarmed" }, roller(1));
  current = advanceFear(covenStory, current, { type: "choose", choice: "s1:b1" }, roller());
  current.combat = { enemyId: "coven-witch", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    round: 1, playerFirst: true, surprise: false, weaponId: "unarmed", attackDisabled: false };
  current.missionProgress["witch-active-box"] = "s1:b2";
  const capture = availableFearActions(covenStory, current).find(({ action }) => action.type === "attack" && action.nonlethal);
  assert.ok(capture, JSON.stringify({ missionId: current.missionRules?.missionId, weaponId: current.weaponId, actions: availableFearActions(covenStory, current).map(value => value.action) }));
  current = advanceFear(covenStory, current, capture.action, roller(6, 6));
  assert.equal(current.combat, undefined);
  assert.equal(current.combatResult?.outcome, "captured");
  assert.equal(current.missionRules?.witches.defeated, 1);
  assert.equal(current.missionRules?.witches.restrictedClues, 1);
  assert.equal(current.clues, 0, "the clue is not added to ordinary Clues");
  assert.equal(current.xp, 1);
  const source = JSON.parse(readFileSync("scripts/alone-against-fear/fragments/section-mission-table-continued.json", "utf8"));
  assert.match(source.paragraphs.find((p: { id: string }) => p.id === "section-mission-table-continued:p2").text, /hand-to-hand combat at\s+-2 inflicting non-lethal damage/);
});

test("Book of Hypnos captures the Coven witch alive and advances Mission 5 without a kill", () => {
  const covenStory: FearStory = structuredClone(story);
  covenStory.fear.missions["5"] = { label: "摧毁女巫集会", goal: "击败五名女巫", kind: "witches" };
  covenStory.fear.enemies["coven-witch"] = { label: "集会女巫", level: 4, life: 4, damage: 1, tags: ["human", "witch"] };
  covenStory.fear.items!["book-of-hypnos"] = { label: "《许普诺斯之书》", tags: ["book"] };
  let current = initialFear(covenStory, { missionId: "5", hp: 8, sanity: 8, xp: 1, inventory: { "book-of-hypnos": 1 } }, roller(1));
  current = advanceFear(covenStory, current, { type: "choose", choice: "s1:b1" }, roller());
  current.combat = { enemyId: "coven-witch", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    round: 1, playerFirst: true, surprise: false, weaponId: current.weaponId, attackDisabled: false };
  current.missionProgress["witch-active-box"] = "s1:b2";
  const cast = availableFearActions(covenStory, current).find(({ action }) => action.type === "use-item" && action.target === "hypnos-spell");
  assert.ok(cast);
  current = advanceFear(covenStory, current, cast.action, roller(6, 6));
  assert.equal(current.combat, undefined);
  assert.equal(current.combatResult?.outcome, "captured");
  assert.equal(current.missionRules?.witches.defeated, 1);
  assert.equal(current.missionRules?.witches.restrictedClues, 1);
  assert.equal(current.xp, 1, "the book costs 1 XP and the resolved Witch encounter awards its source XP");
  assert.equal(current.hypnosUsed, true);
});

test("Hand of Glory use avoids one mortal encounter, checks Will on use, and captures Mission 5 witches", () => {
  const covenStory: FearStory = structuredClone(story);
  covenStory.fear.missions["5"] = { label: "摧毁女巫集会", goal: "击败五名女巫", kind: "witches" };
  covenStory.fear.enemies["coven-witch"] = { label: "集会女巫", level: 4, life: 4, damage: 1, tags: ["human", "witch"] };
  let current = initialFear(covenStory, { missionId: "5", hp: 8, sanity: 2 }, roller(1));
  current = advanceFear(covenStory, current, { type: "choose", choice: current.pending!.options[0] }, roller());
  covenStory.fear.eventPrograms["33"] = [{ op: "item", itemId: "hand-of-glory", amount: 1 }];
  current.pendingEvent = { eventId: "33", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(covenStory, current, { type: "resolve-event", target: "33" }, roller());
  assert.equal(current.inventory["hand-of-glory"], 1);
  assert.equal(current.sanity, 2, "constructing the Hand does not trigger the per-use Will save");
  current.combat = { enemyId: "coven-witch", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    round: 1, playerFirst: true, surprise: false, weaponId: current.weaponId, attackDisabled: false };
  current.pendingEvent = undefined;
  current.missionProgress["witch-active-box"] = "s1:b2";
  const use = availableFearActions(covenStory, current).find(({ action }) => action.type === "use-item" && action.target === "hand-of-glory");
  assert.ok(use);
  current = advanceFear(covenStory, current, use.action, roller(1));
  assert.equal(current.combat, undefined);
  assert.equal(current.combatResult?.outcome, "captured");
  assert.equal(current.sanity, 0, "the combat-turn Will save and the per-use Will save are distinct printed triggers");
  assert.equal(current.status, "insane");
  assert.equal(current.missionRules?.witches.defeated, 1);
  assert.equal(current.missionRules?.witches.restrictedClues, 1);
  assert.equal(current.inventory["hand-of-glory"], undefined, "the assembled Hand and its candle are consumed");
  const source = readFileSync("scripts/alone-against-fear/fragments/033.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "b504b798a78401512ebd0e5f518bae964494f7e3b5e1192aa4bee4c912c2ab25");
  assert.match(JSON.parse(source.toString()).paragraphs[1].text, /After one\s+use, the hand will wither and the\s+candle will be used up/);
});

test("Coven final five visited boxes always reveal witches and Danger Sense reduces the surprise chance", () => {
  const covenStory: FearStory = structuredClone(story);
  covenStory.fear.missions["5"] = { label: "摧毁女巫集会", goal: "击败五名女巫", kind: "witches" };
  covenStory.fear.enemies["coven-witch"] = { label: "集会女巫", level: 4, life: 4, damage: 1, tags: ["human", "witch"] };
  covenStory.fear.weapons.tester = { label: "测试武器", damage: 4 };
  covenStory.fear.items = { ...covenStory.fear.items, bandage: { label: "绷带" }, salt: { label: "盐" }, rope: { label: "绳子" } };
  covenStory.fear.tables.useful.entries = [
    { roll: 1, result: "bandage", operations: [{ op: "item", itemId: "bandage", amount: 1 }] },
    { roll: 2, result: "salt", operations: [{ op: "item", itemId: "salt", amount: 1 }] },
    { roll: 3, result: "rope", operations: [{ op: "item", itemId: "rope", amount: 1 }] },
    { roll: [4, 6], result: "bandage", operations: [{ op: "item", itemId: "bandage", amount: 1 }] },
  ];
  let current = initialFear(covenStory, { missionId: "5", hp: 8, sanity: 8, food: 10, clues: 0,
    skills: { "danger-sense": 2 }, weaponIds: ["tester"], weaponId: "tester" }, roller(1));
  current = advanceFear(covenStory, current, { type: "choose", choice: "s1:b1" }, roller());
  const path = [1, 2, 3, 4, 5, 10, 9, 8, 7, 6, 11, 12, 13, 14, 15, 20, 19, 18, 17, 16, 21, 22, 23, 24, 25, 30, 29, 28, 27, 26];
  for (const box of path.slice(1)) {
    current = advanceFear(covenStory, current, { type: "move", target: `s1:b${box}` }, roller(1));
    if (current.pending?.kind === "mission-witch-find") {
      current = advanceFear(covenStory, current, { type: "choose", choice: "spend:0" }, roller(4));
      assert.equal(current.combat?.enemyId, "coven-witch");
      assert.equal(current.combat?.surprise, false, "4 exceeds the source 5/6 chance reduced by Danger Sense expert to 3/6");
      current = advanceFear(covenStory, current, { type: "attack" }, roller(6, 6));
    }
  }
  assert.equal(current.missionRules?.visitedBoxIds.length, 30);
  assert.equal(current.missionRules?.witches.defeated, 5);
  assert.equal(current.xp, 7);
  assert.equal(current.pending?.kind, "mission-witch-final-item");
});

test("Train Steward causes ghost fright-death only when this encounter removes the final Sanity point", () => {
  const trainStory: FearStory = structuredClone(story);
  trainStory.fear.tables.town.entries[0].operations = [{ op: "roll-table", tableId: "railways" }];
  trainStory.fear.tables.railways = { die: "D6", entries: [{ roll: 1, result: "train-steward", operations: [
    { op: "if-item-any", itemIds: ["train-ticket"], success: [], failure: [{ op: "roll-check", context: "fear-save", level: 4, success: [], failure: [{ op: "resource", key: "sanity", amount: -1 }] }] },
  ] }] };
  const run = (ticket: boolean) => {
    let current = initialFear(trainStory, { hp: 8, sanity: 1, maxSanity: 1, weaponIds: ["knife"], weaponId: "knife", inventory: ticket ? { "train-ticket": 1 } : {} }, roller(1));
    current = advanceFear(trainStory, current, { type: "choose", choice: "s1:b1" }, roller());
    return advanceFear(trainStory, current, { type: "move", target: "s1:b2" }, roller(1, 1, 1));
  };
  assert.equal(run(false).status, "dead", "the source's final Sanity loss here is fatal fright");
  assert.equal(run(true).status, "active", "a valid ticket avoids the encounter's Sanity loss");
});

test("Book of Hypnos p75 spends XP once, retries failed Magic, and leaves a successful living target asleep and alive", () => {
  const source = JSON.parse(readFileSync("scripts/alone-against-fear/fragments/section-random-magic-item-table.json", "utf8"));
  const translated = JSON.parse(readFileSync("scripts/alone-against-fear/translations/zh-CN/section-random-magic-item-table.json", "utf8"));
  assert.equal(createHash("sha256").update(readFileSync("scripts/alone-against-fear/fragments/section-random-magic-item-table.json")).digest("hex"), "3842fac8b62e1992192cc04c05d637bbc603a4a821cf4368e0a9000485e263fa");
  assert.equal(translated.sourceFragmentSha256, "3842fac8b62e1992192cc04c05d637bbc603a4a821cf4368e0a9000485e263fa");
  assert.match(source.paragraphs[3].text, /spend 1 XP/); assert.match(source.paragraphs[3].text, /single, living target/);
  assert.match(source.paragraphs[3].text, /fall asleep/); assert.match(source.paragraphs[3].text, /as many times/);
  assert.match(source.paragraphs[3].text, /Once\s+you succeed/);
  assert.match(translated.paragraphs.find((p: { id: string }) => p.id.endsWith(":p3")).text, /花费1点经验[\s\S]*活体目标[\s\S]*陷入沉睡[\s\S]*反复尝试直到成功/);
  const hypnosStory: FearStory = structuredClone(story);
  hypnosStory.fear.enemies.human = { label: "活人", level: 3, life: 2, damage: 1, tags: ["human"] };
  hypnosStory.fear.items!["book-of-hypnos"] = { label: "《许普诺斯之书》", tags: ["book"] };
  const s = state(); s.xp = 1; s.inventory["book-of-hypnos"] = 1;
  s.combat = { enemyId: "human", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 2, enemyLives: [2], enemyDamage: 1, round: 1, playerFirst: true, surprise: false, weaponId: "knife", attackDisabled: false };
  const cast = () => availableFearActions(hypnosStory, s).find(a => a.action.type === "use-item" && a.action.target === "hypnos-spell" && a.action.choice === "human");
  assert.ok(cast(), "an available book and XP expose the legal spell action");
  let current = advanceFear(hypnosStory, s, cast()!.action, roller(1));
  assert.equal(current.xp, 0); assert.equal(current.hypnosLearned, true); assert.equal(current.hypnosUsed, undefined);
  current = advanceFear(hypnosStory, current, { type: "defend" }, roller(6));
  assert.ok(availableFearActions(hypnosStory, current).some(a => a.action.type === "use-item" && a.action.target === "hypnos-spell"), "failure can be retried without another XP payment");
  const retry = availableFearActions(hypnosStory, current).find(a => a.action.target === "hypnos-spell")!;
  current = advanceFear(hypnosStory, current, retry.action, roller(6));
  assert.equal(current.hypnosUsed, true); assert.equal(current.combat?.enemyLives[0], 2); assert.equal(current.combat?.sleepingCount, 1);
  const draws: number[] = [];
  current = advanceFear(hypnosStory, current, { type: "defend" }, (min, max) => { draws.push(min); return 1; });
  assert.deepEqual(draws, [], "a sleeping creature does not make a defense roll");
  assert.equal(current.combat?.enemyLives[0], 2, "sleep is not defeat or escape");
  assert.equal(availableFearActions(hypnosStory, current).some(a => a.action.target === "hypnos-spell"), false, "one successful use ends further attempts this game");
  hypnosStory.fear.enemies.ghost = { label: "鬼魂", level: 3, life: 1, damage: 1, tags: ["ghost"] };
  const forbidden = state(); forbidden.xp = 1; forbidden.inventory["book-of-hypnos"] = 1;
  forbidden.combat = { enemyId: "ghost", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 1, enemyLives: [1], enemyDamage: 1, round: 1, playerFirst: true, surprise: false, weaponId: "knife", attackDisabled: false };
  assert.equal(availableFearActions(hypnosStory, forbidden).some(a => a.action.target === "hypnos-spell"), false, "a ghost is not a living target");
  hypnosStory.fear.enemies["living-dolls-1"] = { label: "活动娃娃", level: 3, life: 1, damage: 1, tags: [] };
  forbidden.combat.enemyId = "living-dolls-1"; forbidden.combat.enemyLives = [1];
  assert.equal(availableFearActions(hypnosStory, forbidden).some(a => a.action.target === "hypnos-spell"), false, "animated-doll table entries are excluded even where their rows have no tags");
});

test("random-book duplicates offer the adjacent unowned books named by source p72", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-random-book-table.json";
  const translationPath = "scripts/alone-against-fear/translations/zh-CN/section-random-book-table.json";
  const source = JSON.parse(readFileSync(sourcePath, "utf8")); const translated = JSON.parse(readFileSync(translationPath, "utf8"));
  const sourceBytes = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), "6c52f9a8e96be3f9f9f32ace7a25d79594e6677d28c93913962b8e49299654ab");
  assert.equal(translated.sourceFragmentSha256, "6c52f9a8e96be3f9f9f32ace7a25d79594e6677d28c93913962b8e49299654ab");
  assert.match(source.paragraphs[7].text, /Each book may be found only once per game[\s\S]*select the next or previous book/);
  const duplicateStory: FearStory = structuredClone(story);
  duplicateStory.fear.tables["random-books"] = { die: "2D6", entries: Array.from({ length: 11 }, (_, i) => {
    const entry: FearTableEntry = { roll: i + 2, result: `book-${i + 2}`, operations: [{ op: "item", itemId: `book-${i + 2}`, amount: 1 }] };
    duplicateStory.fear.items![`book-${i + 2}`] = { label: `书籍${i + 2}`, tags: ["book"] }; return entry;
  }) };
  duplicateStory.fear.items!["book-7"]!.label = "驱魔仪式";
  duplicateStory.fear.items!["book-9"]!.label = "神秘学指南";
  duplicateStory.fear.items!["book-8"]!.label = "连环杀手案卷";
  duplicateStory.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "random-books" }];
  let current = state(); current.inventory["book-8"] = 1; current.booksFound = ["book-8"];
  current.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(duplicateStory, current, { type: "resolve-event", target: "1" }, roller(2, 6));
  assert.equal(current.pending?.kind, "random-book-duplicate");
  assert.deepEqual(current.pending?.options, ["book-7", "book-9"]);
  const actions = availableFearActions(duplicateStory, current);
  assert.deepEqual(actions.map(a => a.label), ["驱魔仪式", "神秘学指南"]);
  current = advanceFear(duplicateStory, current, { type: "choose", choice: "book-9" }, roller());
  assert.equal(current.inventory["book-9"], 1); assert.ok(current.booksFound?.includes("book-9"));
  assert.equal(current.inventory["book-8"], 1);
});

test("source p72 books stay carried and apply their reviewed reading effects", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-random-book-table.json";
  const translationPath = "scripts/alone-against-fear/translations/zh-CN/section-random-book-table.json";
  const source = JSON.parse(readFileSync(sourcePath, "utf8"));
  const translation = JSON.parse(readFileSync(translationPath, "utf8"));
  assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), "6c52f9a8e96be3f9f9f32ace7a25d79594e6677d28c93913962b8e49299654ab");
  assert.equal(translation.sourceFragmentSha256, "6c52f9a8e96be3f9f9f32ace7a25d79594e6677d28c93913962b8e49299654ab");
  assert.match(translation.paragraphs[1].text, /损失1点理智/);
  assert.match(translation.paragraphs[2].text, /防御检定\+1/);
  assert.match(translation.paragraphs[4].text, /禁止逃跑/);
  assert.match(translation.paragraphs[6].text, /攻击永久\+1/);
  assert.match(translation.paragraphs[7].text, /自动造成2点伤害/);

  const bookStory: FearStory = structuredClone(story);
  bookStory.fear.items = {
    "necronomicon": { label: "《死灵之书》", tags: ["book"] },
    "holy-book": { label: "圣书", tags: ["book"] },
    "serial-killers-casebook": { label: "《连环杀手案例簿》", tags: ["book"] },
    "de-masticatione": { label: "《墓中死者的咀嚼》", tags: ["book"] },
    "blob-experiment": { label: "《黏液实验》", tags: ["book"] },
  };
  bookStory.fear.skills["demon-slayer"] = { label: "恶魔猎手", kind: "arcane", xp: 2, modifiers: {} };
  bookStory.fear.skills.gate = { label: "地狱之门", kind: "arcane", xp: 2, modifiers: {} };
  bookStory.fear.enemies.slasher = { label: "杀手", level: 3, life: 2, damage: 1, tags: ["slasher", "no-escape"] };
  let current = state(); current.inventory.necronomicon = 1;
  assert.ok(availableFearActions(bookStory, current).some(({ action }) => action.type === "use-item" && action.target === "read-book" && action.choice === "necronomicon"));
  current = advanceFear(bookStory, current, { type: "use-item", target: "read-book", choice: "necronomicon" }, roller());
  assert.equal(current.sanity, 7); assert.equal(current.inventory.necronomicon, 1); assert.ok(current.readBooks.includes("necronomicon"));

  current.inventory["holy-book"] = 1; current.sanity = 5; current.xp = 2;
  current = advanceFear(bookStory, current, { type: "use-item", target: "read-book", choice: "holy-book" }, roller());
  assert.equal(current.pending?.kind, "holy-book-reading");
  assert.deepEqual(current.pending?.options, ["recover-sanity", "learn:demon-slayer", "learn:gate"]);
  current = advanceFear(bookStory, current, { type: "choose", choice: "learn:gate" }, roller());
  assert.equal(current.arcaneSkills.gate, 1); assert.equal(current.xp, 0); assert.equal(current.inventory["holy-book"], 1);

  current.inventory["serial-killers-casebook"] = 1;
  current = advanceFear(bookStory, current, { type: "use-item", target: "read-book", choice: "serial-killers-casebook" }, roller());
  current.combat = { enemyId: "slasher", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 2, enemyLives: [2], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  assert.ok(availableFearActions(bookStory, current).some(({ action }) => action.type === "escape"));
  current = advanceFear(bookStory, current, { type: "escape" }, roller(6));
  assert.equal(current.combat, undefined); assert.equal(current.combatResult?.outcome, "escaped");

  current.inventory["de-masticatione"] = 1; current.sanity = 8;
  current = advanceFear(bookStory, current, { type: "use-item", target: "read-book", choice: "de-masticatione" }, roller(1));
  assert.equal(current.sanity, 7); assert.ok(current.readBooks.includes("de-masticatione"));
  bookStory.fear.enemies.zombie = { ...bookStory.fear.enemies.zombie, tags: ["undead"] };
  current.combat = { enemyId: "zombie", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const struck = advanceFear(bookStory, current, { type: "attack" }, roller(2));
  assert.equal(struck.combat?.enemyLife, 2, "the book's permanent +1 attack lets the source L3 attack hit");

  current = state(); current.inventory["blob-experiment"] = 1; current.food = 1;
  current = advanceFear(bookStory, current, { type: "use-item", target: "read-book", choice: "blob-experiment" }, roller());
  bookStory.fear.enemies["lab-horrors-1"] = { label: "黏液怪", level: 4, life: 2, damage: 1 };
  current.combat = { enemyId: "lab-horrors-1", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 2, enemyLives: [2], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  assert.ok(availableFearActions(bookStory, current).some(({ action }) => action.type === "use-item" && action.target === "blob-salt"));
  current = advanceFear(bookStory, current, { type: "use-item", target: "blob-salt", choice: "lab-horrors-1" }, roller());
  assert.equal(current.combat, undefined); assert.equal(current.food, 1); assert.equal(current.combatResult?.outcome, "defeated");
});

test("Zombie Hunter and Arcane creature modifiers only apply to matching revealed enemies", () => {
  const combatBook: FearStory = structuredClone(story);
  combatBook.fear.skills["zombie-hunter"] = { label: "僵尸猎人", xp: 2, modifiers: { "attack-zombie": [1, 2] } };
  combatBook.fear.enemies.zombie = { ...combatBook.fear.enemies.zombie, level: 5, tags: ["undead", "zombie"] };
  combatBook.fear.tables.town.entries[0].operations = [{ op: "start-combat", enemyId: "zombie", count: 1 }];
  let s = advanceFear(combatBook, state(), { type: "move", target: "s1:b2" }, roller(2));
  s.skills["zombie-hunter"] = 1;
  s = advanceFear(combatBook, s, { type: "attack" }, roller(3));
  assert.equal(s.combat, undefined);
  assert.ok(s.log.some(line => line.includes("攻击造成1点伤害")));
  let unrelated = advanceFear(combatBook, state(), { type: "move", target: "s1:b2" }, roller(2));
  unrelated.skills["vampire-hunter"] = 1;
  unrelated = advanceFear(combatBook, unrelated, { type: "attack" }, roller(3));
  assert.equal(unrelated.combat?.count, 1);
});

test("source tables configured to reroll defeated unique targets do so before resolving", () => {
  const rerollStory: FearStory = structuredClone(story);
  rerollStory.fear.tables.target = { die: "D6", rerollDefeated: true, exhausted: { roll: 6, result: "no-encounter" }, entries: [
    { roll: 1, result: "already-defeated" }, { roll: [2, 6], result: "new-target" },
  ] };
  rerollStory.fear.tables.town.entries[0].operations = [{ op: "roll-table", tableId: "target" }];
  const s = state(); s.defeated.push("already-defeated");
  const result = advanceFear(rerollStory, s, { type: "move", target: "s1:b2" }, roller(1, 1, 2));
  assert.ok(result.log.some(line => line === "target 2: new target"));
});

test("Giant Rat Thing natural-one defense invokes the L5 infection save and loses one Life per crossed box", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/enemy-source-inventory.json`, "utf8")) as any;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["giant-rat-thing"] = sourceDefinition.enemies["giant-rat-thing"];
  testStory.fear.skills.resilient = sourceDefinition.skills.resilient;
  const sourceRecord = inventory.enemies.find((entry: any) => entry.enemyId === "giant-rat-thing");
  assert.ok(sourceRecord.sourceContexts.some((context: any) => context.sourceParagraphs.some((p: any) => p.paragraphId === "section-sewers-table:p2" && p.original.includes("If you roll a\n1 on a Defense roll"))));
  const current = state(); current.hp = 8; current.combat = { enemyId: "giant-rat-thing", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  current.skills.resilient = 1;
  let bitten = advanceFear(testStory, current, { type: "defend" }, roller(1, 1, 2));
  assert.equal(bitten.pending?.kind, "injury-prevention");
  bitten = advanceFear(testStory, bitten, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(bitten.hp, 7, "the natural-one attack still inflicts its normal 1 damage");
  assert.deepEqual(bitten.infections, [{ id: "giant-rat-thing:1", enemyId: "giant-rat-thing", boxesRemaining: 0, failureDamage: 1, untilSafeHouse: true }]);
  assert.ok(bitten.log.some(line => line.includes("L5感染豁免: 1 => 1 (失败)")));
  bitten = advanceFear(testStory, bitten, { type: "escape" }, roller(6));
  const moved = advanceFear(testStory, bitten, { type: "move", target: "s1:b2" }, roller(2));
  assert.equal(moved.hp, 6);
  assert.equal(moved.infections?.length, 1);
  moved.mapSheets[0].boxes[2].safehouse = true;
  const safe = advanceFear(testStory, moved, { type: "move", target: "s1:b3" }, roller(2));
  assert.equal(safe.hp, 8, "reaching the Safe House ends the infection before further crossing damage");
  assert.deepEqual(safe.infections, []);

  const resilient = state(); resilient.skills.resilient = 1;
  resilient.combat = { enemyId: "giant-rat-thing", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  let saved = advanceFear(testStory, resilient, { type: "defend" }, roller(1, 4, 2));
  assert.deepEqual(saved.infections, [], "basic Resilient +1 makes a natural 4 pass the L5 Infection save");
});

test("Puppet Theatre blocks grenades and consumes a Molotov while inflicting its printed 1 Life cost", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/enemy-source-inventory.json`, "utf8")) as any;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["haunted-puppets"] = sourceDefinition.enemies["haunted-puppets"];
  const sourceRecord = inventory.enemies.find((entry: any) => entry.enemyId === "haunted-puppets");
  const sourceText = sourceRecord.sourceContexts.flatMap((context: any) => context.sourceParagraphs).find((p: any) => p.paragraphId === "section-haunted-house-table:p5")?.original ?? "";
  assert.ok(sourceText.replace(/\s+/g, " ").includes("you may NOT use a grenade here") && sourceText.includes("If you use a Molotov cocktail here, you will lose 1 Life"));
  const grenade = state(); grenade.weaponIds.push("grenade"); grenade.weaponId = "grenade";
  grenade.missionProgress["flag:puppet-theatre"] = true;
  grenade.combat = { enemyId: "haunted-puppets", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "grenade", surprise: false, attackDisabled: false };
  assert.ok(!availableFearActions(testStory, grenade).some(({ action }) => action.type === "attack"));
  assert.ok(!availableFearActions(testStory, grenade).some(({ action }) => action.type === "switch-weapon" && action.weapon === "grenade"));
  assert.throws(() => advanceFear(testStory, grenade, { type: "attack" }, roller(6)), /unavailable in the current phase/);

  const current = state(); current.inventory["molotov-cocktail"] = 1; current.inventory.lighter = 1;
  current.missionProgress["flag:puppet-theatre"] = true;
  current.combat = { enemyId: "haunted-puppets", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const action = availableFearActions(testStory, current).find(({ action }) => action.target === "molotov-cocktail" && action.choice === "puppet-theatre");
  assert.ok(action);
  const thrown = advanceFear(testStory, current, action.action, roller(4));
  assert.equal(thrown.hp, 7);
  assert.equal(thrown.inventory["molotov-cocktail"], undefined);
  assert.equal(thrown.combat?.enemyLife, 3, "the source's L4 puppet takes the Molotov weapon's ordinary 1 damage on a hit");
  assert.equal(thrown.combat?.playerFirst, false);
});

test("Molotov source action requires ignition, destroys one Zombie without a roll, and uses +2 fire attack otherwise", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const usefulStuff = JSON.parse(readFileSync(`${process.cwd()}/scripts/alone-against-fear/fragments/section-useful-stuff-table.json`, "utf8")) as { paragraphs: Array<{ id: string; text: string }> };
  const molotovSource = usefulStuff.paragraphs.find(paragraph => paragraph.id === "section-useful-stuff-table:p15")?.text ?? "";
  assert.match(molotovSource, /automatically destroy 1 zombie/i);
  assert.match(molotovSource, /Attack roll at \+2/i);
  assert.match(molotovSource, /lighter or a box of matches/i);
  assert.match(molotovSource, /fire damage/i);
  const testStory: FearStory = structuredClone(story);
  testStory.fear.weapons["molotov-cocktail"] = sourceDefinition.weapons["molotov-cocktail"];
  testStory.fear.enemies["undead-1"] = sourceDefinition.enemies["undead-1"];
  testStory.fear.enemies["unique-vampires-1"] = sourceDefinition.enemies["unique-vampires-1"];

  const unlit = state(); unlit.inventory["molotov-cocktail"] = 1;
  unlit.combat = { enemyId: "undead-1", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 1, enemyLives: [1], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  assert.equal(availableFearActions(testStory, unlit).some(({ action }) => action.target === "molotov-cocktail"), false);
  assert.throws(() => advanceFear(testStory, unlit, { type: "use-item", target: "molotov-cocktail", choice: "undead-1" }, roller(6)), /unavailable in the current phase/);

  const zombie = state(); zombie.inventory["molotov-cocktail"] = 1; zombie.inventory.matches = 1;
  zombie.combat = { enemyId: "undead-1", count: 2, defeatedCount: 0, enemyLevel: 3, enemyLife: 1, enemyLives: [1, 1], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const zombieAction = availableFearActions(testStory, zombie).find(({ action }) => action.target === "molotov-cocktail");
  assert.ok(zombieAction);
  let diceCalls = 0;
  const destroyed = advanceFear(testStory, zombie, zombieAction.action, () => { diceCalls++; return 1; });
  assert.equal(destroyed.combat?.count, 1);
  assert.equal(destroyed.combat?.defeatedCount, 1);
  assert.equal(destroyed.inventory["molotov-cocktail"], undefined);
  assert.equal(diceCalls, 0, "automatic Zombie destruction uses no attack roll");

  const vampire = state(); vampire.inventory["molotov-cocktail"] = 1; vampire.inventory.lighter = 1;
  vampire.combat = { enemyId: "unique-vampires-1", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 1, enemyLives: [1], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const attackAction = availableFearActions(testStory, vampire).find(({ action }) => action.target === "molotov-cocktail");
  assert.ok(attackAction);
  const burned = advanceFear(testStory, vampire, attackAction.action, roller(4));
  assert.equal(burned.combat, undefined);
  assert.ok(burned.destroyedVampires?.includes("unique-vampires-1"), "fire damage permanently destroys a defeated vampire");
  assert.equal(burned.inventory["molotov-cocktail"], undefined);
  assert.match(burned.log.join("\n"), /燃烧瓶火焰攻击：6 对抗L5/);
});

test("Witch Librarian uses a first L5 Magic spell, then a knife; Escape repeats the spell", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/enemy-source-inventory.json`, "utf8")) as any;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["witch-librarian"] = sourceDefinition.enemies["witch-librarian"];
  const sourceRecord = inventory.enemies.find((entry: any) => entry.enemyId === "witch-librarian");
  assert.ok(sourceRecord.sourceContexts.some((context: any) => context.sourceParagraphs.some((p: any) => p.paragraphId === "section-school-table:p6" && p.original.includes("Her first attack is a spell"))));
  const current = state(); current.sanity = 7;
  current.combat = { enemyId: "witch-librarian", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 5, enemyLives: [5], enemyDamage: 1,
    damageResource: "hp", playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false,
    specialRule: "witch-librarian", firstAttackSpellPending: true };
  const spell = advanceFear(testStory, current, { type: "defend" }, roller(1));
  assert.equal(spell.sanity, 5, "failed first spell save loses exactly two Sanity");
  assert.equal(spell.hp, 8);
  assert.equal(spell.combat?.firstAttackSpellPending, false);

  const fleeing = state(); fleeing.sanity = 7;
  fleeing.combat = { enemyId: "witch-librarian", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 5, enemyLives: [5], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false, specialRule: "witch-librarian" };
  const escaped = advanceFear(testStory, fleeing, { type: "escape" }, roller(1, 6));
  assert.equal(escaped.sanity, 5, "Escape triggers the repeated L5 Magic spell before its escape roll");
  assert.equal(escaped.combat, undefined);
  assert.equal(escaped.combatResult?.outcome, "escaped");
});

test("source-bound Demonic Clown ignores each non-magic hit independently, but not magic hits", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["demonic-clown"] = sourceDefinition.enemies["demonic-clown"];
  testStory.fear.weapons["magic-knife"] = { label: "魔法刀", damage: 1, modifier: 1, tags: ["magic", "melee"] };
  assert.deepEqual(testStory.fear.enemies["demonic-clown"].hitIgnoreChance, [2, 6]);
  const current = state();
  current.combat = { enemyId: "demonic-clown", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const ordinary = advanceFear(testStory, current, { type: "attack", weapon: "knife" }, roller(6, 4, 1, 3));
  assert.equal(ordinary.combat?.enemyLife, 3, "the first of two hits is ignored on 1 and the second lands on 3");
  assert.equal(ordinary.log.filter(line => line.includes("次命中忽略检定")).length, 2);

  current.combat!.enemyLife = 4; current.combat!.enemyLives = [4]; current.combat!.weaponId = "magic-knife";
  current.weaponIds.push("magic-knife"); current.weaponId = "magic-knife";
  const magic = advanceFear(testStory, current, { type: "attack", weapon: "magic-knife" }, roller(6, 4));
  assert.equal(magic.combat?.enemyLife, 2, "magic weapons skip the per-hit ignore rolls");
  assert.ok(!magic.log.some(line => line.includes("次命中忽略检定")));
});

test("source-bound werewolf profiles grant silver weapons +2 attack", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/enemy-source-inventory.json`, "utf8")) as any;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.weapons["silver-knife"] = { label: "银刀", damage: 1, modifier: 0, tags: ["melee", "silver"] };
  testStory.fear.enemies.werewolf = sourceDefinition.enemies.werewolf;
  testStory.fear.enemies["werewolf-pack-member"] = sourceDefinition.enemies["werewolf-pack-member"];
  assert.deepEqual(testStory.fear.enemies.werewolf.attackModifiers, [{ weaponTag: "silver", amount: 2 }]);
  assert.equal(testStory.fear.enemies["werewolf-pack-member"].attackModifiers, undefined,
    "the source's silver bonus is attached to the solo Werewolf row, not pack members");
  const sourceRecords = inventory.enemies.filter((entry: any) => ["werewolf", "werewolf-pack-member"].includes(entry.enemyId));
  assert.ok(sourceRecords.some((entry: any) => entry.sourceContexts.some((context: any) => context.context.tableId === "woods-park" && context.sourceParagraphs.some((p: any) => p.original.includes("Silver\nweapons hit the were at +2")))));
  const current = state(); current.weaponIds.push("silver-knife"); current.weaponId = "silver-knife";
  current.combat = { enemyId: "werewolf", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 8, enemyLives: [8], enemyDamage: 2,
    playerFirst: true, round: 1, weaponId: "silver-knife", surprise: false, attackDisabled: false };
  const hit = advanceFear(testStory, current, { type: "attack", weapon: "silver-knife" }, roller(2));
  assert.equal(hit.combat?.enemyLife, 7, "the silver +2 raises the L4 total to four and lands one hit");
});

test("source-bound Beasts rows apply crocodile surprise/armor and zombie-dog escape modifiers", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  for (const id of ["beasts-1", "beasts-2", "beasts-3"]) testStory.fear.enemies[id] = sourceDefinition.enemies[id];
  testStory.fear.eventPrograms["1"] = [{ op: "start-combat", enemyId: "beasts-1", count: 1 }];
  let croc = state(); croc.mapSheets[0].boxes[0].locationType = "sewers";
  croc.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: croc.visitCount };
  croc = advanceFear(testStory, croc, { type: "resolve-event", target: "1" }, roller(3));
  assert.equal(croc.combat?.surprise, true, "sewer encounter uses its source 3-in-6 surprise chance");
  croc.combat!.playerFirst = true;
  croc = advanceFear(testStory, croc, { type: "attack" }, roller(6, 1, 1));
  assert.equal(croc.combat?.enemyLife, 6, "the crocodile's 2-in-6 hard-skin roll can bounce a successful hit");
  assert.ok(croc.log.some(line => line.includes("坚硬皮肤弹开检定: 1/6")));

  let dog = state();
  dog.combat = { enemyId: "beasts-2", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 2,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  dog.inventory["dog-food"] = 1;
  const baitEscape = availableFearActions(testStory, dog).find(({ action }) => action.type === "escape" && action.choice === "dog-food");
  assert.ok(baitEscape, "source permits spending dog food as bait against Zombie Dog");
  dog = advanceFear(testStory, dog, baitEscape.action, roller(2));
  assert.equal(dog.inventory["dog-food"], undefined);
  assert.ok(dog.log.some(line => line.includes("逃跑检定: 2")), "Zombie Dog -1 and bait +1 cancel");

  const rabid = testStory.fear.enemies["beasts-3"];
  assert.equal(rabid.surprise, 2); assert.deepEqual(rabid.escapeBait, { itemIds: ["dog-food", "dog-toy"], food: 2, bonus: 2 });
  assert.deepEqual(rabid.infectionChance, [1, 6]);
  let bitten = state(); bitten.combat = { enemyId: "beasts-3", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  bitten = advanceFear(testStory, bitten, { type: "defend" }, roller(2, 1));
  assert.deepEqual(bitten.infections, [{ id: "beasts-3:1", enemyId: "beasts-3", boxesRemaining: 3, failureDamage: 2 }]);
  assert.ok(bitten.log.some(line => line.includes("咬伤感染检定: 1/6")));
  bitten = advanceFear(testStory, bitten, { type: "choose", choice: "take-loss" }, roller());
  bitten.combat = undefined;
  bitten.inventory["first-aid-kit"] = 1; bitten.inventory["first-aid-charges"] = 2;
  const treat = availableFearActions(testStory, bitten).find(({ action }) => action.target === "treat-infection");
  assert.ok(treat);
  bitten = advanceFear(testStory, bitten, treat.action, roller());
  assert.equal(bitten.infections?.length, 0); assert.equal(bitten.inventory["first-aid-charges"], 1);

  let overdue = state(); overdue.infections = [{ id: "beasts-3:1", enemyId: "beasts-3", boxesRemaining: 1 }];
  overdue = advanceFear(testStory, overdue, { type: "move", target: "s1:b2" }, roller(2));
  assert.equal(overdue.hp, 6, "infection left untreated through the third box costs 2 additional Life");
  assert.equal(overdue.infections?.length, 0);
});

test("Upyr p70 spoils only carried Food, checks disease only when the D6 exceeds it, and disease stops at a Safe House", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["unique-vampires-1"] = sourceDefinition.enemies["unique-vampires-1"];
  testStory.fear.tables.town.entries[0].operations = [
    { op: "upyr-encounter" }, { op: "start-combat", enemyId: "unique-vampires-1", count: 1 },
  ];
  let current = state(); current.food = 2;
  current = advanceFear(testStory, current, { type: "move", target: "s1:b2" }, roller(1, 3, 2));
  assert.equal(current.food, 0, "D6=3 spoils the two carried Food points");
  assert.ok(current.ongoingChecks.some(effect => effect.id === "upyr-disease"));
  assert.ok(current.log.some(line => line.includes("乌皮尔疾病L5防御: 2 => 2 (失败)")));
  current.combat!.enemyLives = [1]; current.combat!.enemyLife = 1; current.combat!.count = 1;
  current = advanceFear(testStory, current, { type: "attack" }, roller(6, 1));
  assert.equal(current.combat, undefined);
  current = resolvePendingAcquisition(testStory, current);
  current.mapSheets[0].boxes.find(box => box.id === "s1:b3")!.safehouse = true;
  current = advanceFear(testStory, current, { type: "move", target: "s1:b3" }, roller());
  assert.ok(!current.ongoingChecks.some(effect => effect.id === "upyr-disease"));
  assert.ok(current.log.some(line => line.includes("抵达安全屋：乌皮尔带来的疾病停止")));

  testStory.fear.skills = sourceDefinition.skills;
  testStory.fear.items = sourceDefinition.items;
  let faith = state(); faith.skills.faith = 1; faith.inventory["holy-symbol"] = 1;
  faith.combat = { enemyId: "unique-vampires-1", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 8, enemyLives: [8], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const turn = availableFearActions(testStory, faith).find(({ action }) => action.type === "exorcise" && action.target === "holy-symbol");
  assert.ok(turn, "the source Faith skill can turn vampires with a carried holy symbol");
  faith = advanceFear(testStory, faith, turn.action, roller(6, 1));
  assert.equal(faith.combat, undefined); assert.equal(faith.combatResult?.outcome, "fled");
  assert.equal(faith.inventory["holy-symbol"], 1, "the holy symbol is not consumed");
});

test("source-bound Beasts 4–6 and Undead 1–6 run their reviewed special rules", () => {
  const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  for (const id of [...Array.from({ length: 6 }, (_, i) => `beasts-${i + 1}`), ...Array.from({ length: 6 }, (_, i) => `undead-${i + 1}`)])
    testStory.fear.enemies[id] = sourceDefinition.enemies[id];
  testStory.fear.items = { ...sourceDefinition.items };
  testStory.fear.weapons = { ...sourceDefinition.weapons };
  testStory.fear.tables.beasts = structuredClone(sourceDefinition.tables.beasts);
  testStory.fear.tables.undead = structuredClone(sourceDefinition.tables.undead);

  let bats = state(); bats.inventory["first-aid-kit"] = 1; bats.inventory["first-aid-charges"] = 1;
  bats.combat = { enemyId: "beasts-4", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 1, enemyLives: [1], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false, damageTakenThisEncounter: true };
  assert.ok(!availableFearActions(testStory, bats).some(({ action }) => action.type === "escape"), "flying bats prohibit escape");
  assert.throws(() => advanceFear(testStory, bats, { type: "escape" }, roller(6)), /unavailable in the current phase/);
  bats = advanceFear(testStory, bats, { type: "attack" }, roller(6, 2, 1));
  assert.equal(bats.combat, undefined);
  assert.deepEqual(bats.infections, [{ id: "beasts-4:1", enemyId: "beasts-4", boxesRemaining: 3, failureDamage: 1 }]);

  for (const [id, expected] of [["beasts-5", 1], ["beasts-6", -1]] as const) {
    const enemy = testStory.fear.enemies[id];
    if (id === "beasts-5") assert.deepEqual(enemy.attackModifiers, [
      { weaponTag: "bonus-vs-zombies-and-flaming-skeletons", amount: 1 }, { weaponTag: "projectile", amount: -1 },
    ]);
    else { assert.equal(enemy.escapeModifier, -1); assert.deepEqual(enemy.surpriseByLocation, { park: 1, "woods-park": 1, forest: 1 }); assert.equal(expected, -1); }
  }
  let bone = state(); bone.weaponIds.push("baseball-bat"); bone.weaponId = "baseball-bat";
  bone.combat = { enemyId: "beasts-5", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 5, enemyLives: [5], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "baseball-bat", surprise: false, attackDisabled: false };
  bone = advanceFear(testStory, bone, { type: "attack" }, roller(3));
  assert.equal(bone.combat?.enemyLife, 4, "baseball bat receives the source +1 attack modifier");
  bone = advanceFear(testStory, bone, { type: "defend" }, roller(6));
  bone.weaponIds.push("pistol"); bone.weaponId = "pistol"; bone.combat!.weaponId = "pistol"; bone.ammo.pistol = 1;
  bone = advanceFear(testStory, bone, { type: "attack" }, roller(3));
  assert.equal(bone.combat?.enemyLife, 4, "projectile penalty cancels the pistol's printed +1 modifier");

  assert.equal(testStory.fear.enemies["undead-2"].surprise, 2);
  assert.equal(testStory.fear.enemies["undead-3"].damage, 2, "Flaming Skeletons deal the printed 2 damage despite the later Molotov immunity text");
  assert.equal(testStory.fear.enemies["undead-3"].unarmedHitDamage, 1);
  assert.deepEqual(testStory.fear.enemies["undead-4"].fearSave, { level: 3, context: "fear-save", sanityLoss: 1 });
  assert.deepEqual(testStory.fear.enemies["undead-5"].fearSave, { level: 4, context: "fear-save", sanityLoss: 1 });
  assert.equal(testStory.fear.enemies["undead-6"].holyWaterDamage, 8);
  assert.deepEqual(testStory.fear.tables.undead.entries.find(entry => entry.roll === 6)?.rerollLocations, ["worship"]);
  const bonePowder = testStory.fear.tables.beasts.entries.find(entry => entry.roll === 5)!;
  assert.ok(bonePowder.operations?.some(operation => operation.op === "combat-outcome"));
  const howler = testStory.fear.tables.undead.entries.find(entry => entry.roll === 4)!;
  assert.ok(howler.operations?.some(operation => operation.op === "combat-outcome"));
  let slow = state(); slow.xp = 4;
  slow.combat = { enemyId: "undead-1", count: 4, defeatedCount: 0, enemyLevel: 2, enemyLife: 1, enemyLives: [1, 1, 1, 1], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const area = slow.currentBoxId; let calls = 0;
  slow = advanceFear(testStory, slow, { type: "escape" }, () => { calls++; return 1; });
  assert.equal(calls, 0, "Slow zombies allow automatic escape without a roll");
  assert.equal(slow.currentBoxId, area, "escaping leaves the investigator in the current area");
  assert.equal(slow.xp, 4, "escape awards no victory XP");
  assert.equal(slow.combatResult?.outcome, "escaped");
});

test("Summon Servitor resolves its two source D6 checks, time/sacrifice, attack, and split Defense in Fear runtime", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills["summon-servitor"] = { label: "召唤使魔", xp: 2, kind: "arcane", modifiers: {} };
  testStory.fear.items = { bell: { label: "铃铛" }, candles: { label: "蜡烛" } };
  testStory.fear.weapons["kitchen-knife"] = { label: "厨房刀／仪式匕首", damage: 1, modifier: -1, tags: ["breaks-on-attack-1"] };
  testStory.fear.arcaneLearning = { "summon-servitor": { sources: [{ itemId: "necronomicon" }], timeBoxes: "D3", expert: false } };
  testStory.fear.enemies["servitor-test-target"] = { label: "测试目标", level: 2, life: 3, damage: 1, tags: [] };
  let s = state(); s.arcaneSkills["summon-servitor"] = 1; s.skills.occultist = 1; s.skills.will = 1;
  s.inventory.bell = 1; s.weaponIds.push("kitchen-knife"); s.inventory.candles = 5;
  const summon = availableFearActions(testStory, s).find(({ action }) => action.type === "summon-servitor" && action.amount === 2 && action.choice === "candles:0");
  assert.ok(summon);
  s = advanceFear(testStory, s, summon.action, roller(2, 2));
  assert.deepEqual(s.servitor, { level: 2, life: 2, maxLife: 2, attackBonus: 1, defenseBonus: 1 });
  assert.equal(s.elapsedTimeBoxes, 1); assert.equal(s.inventory.candles, undefined);

  s.combat = { enemyId: "servitor-test-target", count: 1, defeatedCount: 0, enemyLevel: 2, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    playerFirst: true, round: 1, weaponId: s.weaponId, surprise: false, attackDisabled: false };
  const servitorAttack = availableFearActions(testStory, s).find(({ action }) => action.type === "servitor-attack");
  assert.ok(servitorAttack);
  s = advanceFear(testStory, s, servitorAttack.action, roller(2));
  assert.equal(s.combat?.enemyLife, 2, "a servitor's L2 Attack roll deals one damage, independent of the investigator's weapon");

  s.combat = { enemyId: "servitor-test-target", count: 2, defeatedCount: 0, enemyLevel: 2, enemyLife: 3, enemyLives: [3, 3], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: s.weaponId, surprise: false, attackDisabled: false };
  s = advanceFear(testStory, s, { type: "defend" }, roller(1, 6, 6));
  assert.equal(s.servitor?.life, 1, "the first of two attackers is assigned to the Servitor and its failed Defense removes its Life");
  assert.equal(s.hp, 8, "the second assigned Defense succeeds for the investigator");
});

test("Summon Servitor failure costs Sanity once; failed control creates an undefendable-to-escape combat", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills["summon-servitor"] = { label: "召唤使魔", xp: 2, kind: "arcane", modifiers: {} };
  testStory.fear.weapons["kitchen-knife"] = { label: "厨房刀／仪式匕首", damage: 1, modifier: -1 };
  let s = state(); s.arcaneSkills["summon-servitor"] = 1; s.inventory.bell = 1; s.weaponIds.push("kitchen-knife");
  s.inventory.candles = 5;
  s = advanceFear(testStory, s, { type: "summon-servitor", amount: 2, choice: "candles:0" }, roller(1));
  assert.equal(s.sanity, 7); assert.equal(s.elapsedTimeBoxes, 1); assert.equal(s.servitor, undefined);
  assert.ok(availableFearActions(testStory, s).some(({ action }) => action.type === "summon-servitor"), "failed Magic may be attempted again after paying the sacrifice");

  s.inventory.candles = 5; s.skills.will = 0;
  s = advanceFear(testStory, s, { type: "summon-servitor", amount: 2, choice: "candles:0" }, roller(6, 1));
  assert.equal(s.combat?.hostileServitor, true);
  assert.ok(!availableFearActions(testStory, s).some(({ action }) => action.type === "escape"), "source forbids Escape against the hostile servitor");
});

test("Blessed Candle may replace ritual candles, with the player choosing the exact amount spent", () => {
  const source = JSON.parse(readFileSync("scripts/alone-against-fear/fragments/section-random-magic-item-table.json", "utf8")) as { paragraphs: { id: string; text: string }[] };
  const bound = source.paragraphs.find(paragraph => paragraph.id === "section-random-magic-item-table:p5");
  assert.ok(bound?.text.replace(/\s+/g, " ").includes("any ritual requiring candles"));
  assert.equal(createHash("sha256").update(readFileSync("scripts/alone-against-fear/fragments/section-random-magic-item-table.json")).digest("hex"), "3842fac8b62e1992192cc04c05d637bbc603a4a821cf4368e0a9000485e263fa");
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills["summon-servitor"] = { label: "召唤使魔", xp: 2, kind: "arcane", modifiers: {} };
  testStory.fear.weapons["kitchen-knife"] = { label: "厨房刀／仪式匕首", damage: 1, modifier: -1 };
  let s = state(); s.arcaneSkills["summon-servitor"] = 1; s.inventory.bell = 1;
  s.weaponIds.push("kitchen-knife"); s.inventory.candles = 4; s.inventory["blessed-candle"] = 2;
  const choices = availableFearActions(testStory, s).filter(({ action }) => action.type === "summon-servitor" && action.amount === 2 && action.choice?.startsWith("candles:"));
  assert.deepEqual(choices.map(({ action }) => action.choice), ["candles:1", "candles:2"]);
  s = advanceFear(testStory, s, choices[0].action, roller(6, 6, 6, 6, 6));
  assert.equal(s.inventory.candles, undefined);
  assert.equal(s.inventory["blessed-candle"], 1, "the chosen ratio consumes only one of two Blessed Candles");
  assert.equal(s.elapsedTimeBoxes, 1);
  assert.equal(s.servitor?.level, 2);
});

test("Absent Mindedness checks only the Summon components actually selected; the Ritual Dagger weapon adds no tool roll", () => {
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills["summon-servitor"] = { label: "召唤使魔", xp: 2, kind: "arcane", modifiers: {} };
  testStory.fear.weapons["kitchen-knife"] = { label: "厨房刀／仪式匕首", damage: 1, modifier: -1 };
  const s = state(); s.arcaneSkills["summon-servitor"] = 1; s.traumas = ["absent-mindedness"];
  s.inventory.bell = 1; s.weaponIds.push("kitchen-knife"); s.inventory.candles = 4; s.inventory["blessed-candle"] = 1;
  let rolls = 0;
  const dice = () => [6, 6, 1, 6][rolls++] ?? 1;
  const next = advanceFear(testStory, s, { type: "summon-servitor", amount: 2, choice: "candles:1" }, dice);
  assert.equal(rolls, 3, "one ordinary D6 is rolled for each selected component; no extra roll for the Ritual Dagger or an unselected component");
  assert.equal(next.inventory.bell, 1);
  assert.equal(next.inventory.candles, 4, "the failed Blessed Candle component check does not spend the selected ordinary candles");
  assert.equal(next.inventory["blessed-candle"], undefined, "the unavailable selected component is removed");
  assert.equal(next.elapsedTimeBoxes, 0);
  assert.equal(next.servitor, undefined);
});

test("Demon Slayer applies only to source-tagged Demonic Horrors saves/Defense and failed Exorcism removes the next defense roll", () => {
  const reviewed = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
  for (let row = 1; row <= 6; row++) assert.ok(reviewed.enemies[`demonic-horrors-${row}`]?.tags?.includes("demonic-horrors-table"), `source row ${row} is in the table`);
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills["demon-slayer"] = { label: "恶魔杀手", xp: 2, kind: "arcane", modifiers: { "defense-demon": [1, 2], "demon-save": [1, 2] } };
  testStory.fear.enemies.demon = { label: "恶魔", level: 3, life: 4, damage: 2, tags: ["demon", "susceptible-exorcism"] };
  testStory.fear.enemies["demonic-horrors-1"] = reviewed.enemies["demonic-horrors-1"];
  const slayer = state(); slayer.arcaneSkills["demon-slayer"] = 1;
  slayer.combat = { enemyId: "demonic-horrors-1", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const saved = advanceFear(testStory, slayer, { type: "defend" }, roller(2));
  assert.equal(saved.pending?.kind, undefined, "Demon Slayer's source +1 makes this L3 Defense succeed on a 2");
  assert.equal(saved.hp, 8);
  const plain = state();
  plain.combat = { ...slayer.combat!, enemyId: "zombie", enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1 };
  testStory.fear.enemies.zombie = { label: "僵尸", level: 3, life: 3, damage: 1, tags: ["undead", "zombie"] };
  const noBonus = advanceFear(testStory, plain, { type: "defend" }, roller(2));
  assert.equal(noBonus.pending?.kind, "injury-prevention", "the same result fails against a non-Demonic-Horrors creature");

  const exorcist = state(); exorcist.arcaneSkills.exorcism = 1; exorcist.inventory["holy-water"] = 1;
  exorcist.combat = { enemyId: "demon", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 4, enemyLives: [4], enemyDamage: 2,
    playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  let diceCalls = 0; const sourceRoll: FearDice = () => { diceCalls++; return 1; };
  const failed = advanceFear(testStory, exorcist, { type: "exorcise", target: "holy-water" }, sourceRoll);
  assert.equal(failed.combat?.cannotDefendNextAttack, true);
  const defense = availableFearActions(testStory, failed).find(({ action }) => action.type === "defend");
  assert.equal(defense?.label, "承受无法防御的恶魔攻击");
  const unavoidable = advanceFear(testStory, failed, defense!.action, sourceRoll);
  assert.equal(diceCalls, 1, "the source says the next attack cannot be defended, so no Defense D6 is rolled");
  assert.equal(unavoidable.pending?.kind, "injury-prevention");
  assert.equal(unavoidable.pending?.data?.amount, 2);
  assert.equal(unavoidable.combat?.cannotDefendNextAttack, false);
});

test("search loot rolls four candidates and applies only the chosen result", () => {
  let s = advanceFear(story, state(), { type: "search" }, roller(6));
  s = advanceFear(story, s, { type: "choose", choice: "useful-item" }, roller(1, 2, 3, 4));
  assert.equal(s.pending?.kind, "loot-result-choice");
  const projected = projectFear(story, s).pending;
  assert.ok(projected); assert.ok(!("data" in projected));
  assert.deepEqual(Object.keys(projected.labels), ["1", "2", "3", "4"]);
  assert.equal(projected.labels["1"], "bandage");
  assert.ok(availableFearActions(story, s).some(choice => choice.label === "bandage"));
  s = advanceFear(story, s, { type: "choose", choice: "2" }, roller());
  assert.equal(s.inventory.bandage, 1);
  assert.equal(s.pending, undefined);
});

test("preventable life loss offers one permanent source-table injury instead", () => {
  const injuryStory: FearStory = structuredClone(story);
  injuryStory.fear.tables.injury = { die: "D6", entries: [{ roll: [1, 6], result: "scar-leg" }] };
  injuryStory.fear.tables.town.entries[0].operations = [{ op: "injury-check", kind: "life", amount: 1, tableId: "injury" }];
  let s = state(); s.hp = 5;
  s = advanceFear(injuryStory, s, { type: "move", target: "s1:b2" }, roller(1));
  assert.equal(s.pending?.kind, "injury-prevention");
  s = advanceFear(injuryStory, s, { type: "choose", choice: "prevent-with-scar" }, roller(1));
  assert.equal(s.hp, 5); assert.deepEqual(s.scars, ["scar-leg"]);
});

test("repeated injury results stay a forced reroll instead of throwing or substituting another result", () => {
  const injuryStory: FearStory = structuredClone(story);
  injuryStory.fear.tables.injury = { die: "D6", entries: Array.from({ length: 6 }, (_, index) => ({ roll: index + 1, result: `scar-${index + 1}` })) };
  injuryStory.fear.tables.town.entries[0].operations = [{ op: "injury-check", kind: "life", amount: 1, tableId: "injury" }];
  let s = state(); s.hp = 5; s.scars = ["scar-1", "scar-2"];
  s = advanceFear(injuryStory, s, { type: "move", target: "s1:b2" }, roller(1));
  assert.equal(s.pending?.kind, "injury-prevention");
  s = advanceFear(injuryStory, s, { type: "choose", choice: "prevent-with-scar" }, roller(...Array(13).fill(1)));
  assert.equal(s.pending?.kind, "injury-repeat-roll");
  assert.deepEqual(s.scars, ["scar-1", "scar-2"]);
  s = advanceFear(injuryStory, s, { type: "choose", choice: "reroll" }, roller(1));
  assert.equal(s.pending?.kind, "injury-repeat-roll");
  s = advanceFear(injuryStory, s, { type: "choose", choice: "reroll" }, roller(6));
  assert.equal(s.pending, undefined);
  assert.deepEqual(s.scars, ["scar-1", "scar-2", "scar-6"]);
  assert.equal(s.hp, 5);
});

test("combat uses exploding six, natural one failure and offers the double-one defense choice", () => {
  let encounter = combatState(); let s = encounter.state;
  assert.throws(() => advanceFear(encounter.story, s, { type: "move", target: "s1:b3" }, roller()), /Resolve the current encounter/);
  s = advanceFear(encounter.story, s, { type: "attack", weapon: "knife" }, roller(6, 1));
  assert.equal(s.combat, undefined); assert.deepEqual(s.defeated, []);
  encounter = combatState(); s = advanceFear(encounter.story, encounter.state, { type: "attack", weapon: "knife" }, roller(1));
  assert.equal(s.combat?.playerFirst, false);
  s = advanceFear(encounter.story, s, { type: "defend" }, roller(1, 1));
  assert.equal(s.pending?.kind, "injury-prevention");
  s = advanceFear(encounter.story, s, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(s.pending?.kind, "double-one");
  s = advanceFear(encounter.story, s, { type: "choose", choice: "destroy-weapon" }, roller());
  assert.equal(s.weaponId, "unarmed");
});

test("destroying the equipped weapon on a double-one removes it and synchronizes active combat", () => {
  const encounter = combatState(); let s = advanceFear(encounter.story, encounter.state, { type: "attack" }, roller(1));
  s = advanceFear(encounter.story, s, { type: "defend" }, roller(1, 1));
  s = advanceFear(encounter.story, s, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(s.pending?.kind, "double-one");
  s = advanceFear(encounter.story, s, { type: "choose", choice: "destroy-weapon" }, roller());
  assert.ok(!s.weaponIds.includes("knife"));
  assert.equal(s.weaponId, "unarmed"); assert.equal(s.combat?.weaponId, "unarmed");
  assert.doesNotThrow(() => advanceFear(encounter.story, s, { type: "attack" }, roller(6, 1)));
});

test("safehouse limit keeps the three most recently designated, and seven gates win", () => {
  const safeStory: FearStory = structuredClone(story);
  safeStory.fear.tables.town.entries[0].operations = [{ op: "mark-safehouse", threshold: "before-create-3" }];
  let s = state();
  for (let box = 2; box <= 5; box++) s = advanceFear(safeStory, s, { type: "move", target: `s1:b${box}` }, roller(2));
  assert.equal(s.safehouseIds.length, 3); assert.equal(s.mapSheets[0].boxes[3].safehouse, false);
  assert.throws(() => advanceFear(safeStory, s, { type: "close-gate" }, roller(6)), /no revealed hell gate/);
  s.arcaneSkills.gate = 1;
  for (let i = 0; i < 7; i++) {
    s.missionProgress.gateHere = true;
    s = advanceFear(safeStory, s, { type: "close-gate" }, roller(6));
  }
  assert.equal(s.status, "won"); assert.equal(s.gatesClosed, 7);
});

test("source-bound Witch's Knots grants one persistent D6+1 cord", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/036.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "5efe94a7b190717473b5298e3ed824dd7bba92374b7e01cfac7ca4b9fb40927b");
  const testStory: FearStory = structuredClone(story);
  testStory.fear.items = { ...testStory.fear.items, "witch-knots-cord": { label: "女巫打结绳索", weightless: true } };
  testStory.fear.eventPrograms["36"] = [{ op: "item", itemId: "witch-knots-cord", amount: 1 }];
  let current = state();
  current.pendingEvent = { eventId: "36", alreadyPlayed: false, started: false, visitCount: current.visitCount };
  current = advanceFear(testStory, current, { type: "resolve-event", target: "36" }, roller(4));
  assert.deepEqual(current.witchKnots, { total: 5, used: 0 });
  assert.equal(current.inventory["witch-knots-cord"], 1);
  assert.equal(canUseWitchKnots(current), true);
  assert.equal(current.missionProgress.witchKnots, undefined);
  assert.throws(() => advanceFear(testStory, current, { type: "resolve-event", target: "36" }, roller(6)), /unavailable in the current phase/);
});

test("Unique Zombie 1 applies the mandatory Injury-table consequence on a natural-one Defense", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-zombies-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "915ca91220ad8f14c746be2606e45ed1df574417fd5a1d929b1fe4f37feb4932");
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.tiger = { label: "僵尸虎", level: 5, life: 6, damage: 2, specialRule: "zombie-tiger" };
  testStory.fear.tables.injury = { die: "D6", entries: [{ roll: 1, result: "facial-scar" }, { roll: 2, result: "arm" }, { roll: 3, result: "eye" }, { roll: 4, result: "limp" }, { roll: 5, result: "brain" }, { roll: 6, result: "crippled-arm" }] };
  testStory.fear.injuries = Object.fromEntries(testStory.fear.tables.injury.entries.map(entry => [entry.result, { label: entry.result, modifiers: {} }]));
  const current = state();
  current.combat = { enemyId: "tiger", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 6, enemyLives: [6], enemyDamage: 2,
    damageResource: "hp", playerFirst: false, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false, specialRule: "zombie-tiger" };
  const injured = advanceFear(testStory, current, { type: "defend" }, roller(1, 4, 2));
  assert.deepEqual(injured.scars, ["limp"]);
  assert.equal(injured.hp, current.hp);
  current.scars = ["a", "b", "c"];
  current.combat = { ...current.combat!, enemyLives: [6], enemyLife: 6, playerFirst: false, round: 1 };
  const battered = advanceFear(testStory, current, { type: "defend" }, roller(1, 2));
  assert.equal(battered.hp, current.hp - 3);
  assert.equal(battered.scars.length, 3);
});

test("Unique Zombies 5 blocks Escape after a natural-one Defense while three Brain Eaters remain", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-zombies-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "915ca91220ad8f14c746be2606e45ed1df574417fd5a1d929b1fe4f37feb4932");
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.brainEaters = { label: "食脑者", level: 5, life: 1, damage: 1, specialRule: "brain-eaters" };
  let current = state();
  current.combat = { enemyId: "brainEaters", count: 3, defeatedCount: 0, enemyLevel: 5, enemyLife: 1, enemyLives: [1, 1, 1], enemyDamage: 1,
    damageResource: "hp", playerFirst: false, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false, specialRule: "brain-eaters" };
  current = advanceFear(testStory, current, { type: "defend" }, roller(1, 2, 6, 1, 6, 1));
  assert.equal(current.combat?.escapeBlockedUntilReduce, true);
  while (current.pending) {
    const choice = current.pending.kind === "double-one" ? "take-damage" : "take-loss";
    current = advanceFear(testStory, current, { type: "choose", choice }, roller(2));
  }
  assert.ok(!availableFearActions(testStory, current).some(({ action }) => action.type === "escape"));
  assert.throws(() => advanceFear(testStory, current, { type: "escape" }, roller(6)), /unavailable in the current phase/);
  current = advanceFear(testStory, current, { type: "attack" }, roller(5));
  assert.equal(current.combat?.enemyLives.length, 2);
  current = advanceFear(testStory, current, { type: "defend" }, roller(6, 2));
  while (current.pending) {
    const choice = current.pending.kind === "double-one" ? "take-damage" : "take-loss";
    current = advanceFear(testStory, current, { type: "choose", choice }, roller(2));
  }
  assert.ok(availableFearActions(testStory, current).some(({ action }) => action.type === "escape"));
});

test("Unique Zombies 2 rolls 2-in-6 each enemy turn and lets the player choose one item or two Food", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-zombies-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "915ca91220ad8f14c746be2606e45ed1df574417fd5a1d929b1fe4f37feb4932");
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.squirrels = { label: "僵尸松鼠群", level: 4, life: 8, damage: 1, specialRule: "zombie-squirrels" };
  testStory.fear.items = { ...testStory.fear.items, rope: { label: "绳子" } };
  let current = state(); current.food = 3; current.inventory.rope = 1;
  current.combat = { enemyId: "squirrels", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 8, enemyLives: [8], enemyDamage: 1,
    damageResource: "hp", playerFirst: false, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false, specialRule: "zombie-squirrels" };
  current = advanceFear(testStory, current, { type: "defend" }, roller(6, 1, 2));
  assert.equal(current.pending?.kind, "horde-loss");
  assert.ok(availableFearActions(testStory, current).some(({ action, label }) => action.type === "choose" && action.choice === "food" && label.includes("2点食物")));
  current = advanceFear(testStory, current, { type: "choose", choice: "food" }, roller());
  assert.equal(current.food, 1); assert.equal(current.inventory.rope, 1);
  current = advanceFear(testStory, current, { type: "attack" }, roller(5));
  current = advanceFear(testStory, current, { type: "defend" }, roller(6, 3));
  assert.equal(current.pending, undefined);
});

test("Unique Zombies 3–4 require the printed L3 Will roll before an attack each turn", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-zombies-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "915ca91220ad8f14c746be2606e45ed1df574417fd5a1d929b1fe4f37feb4932");
  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills.will = { label: "意志", xp: 6, modifiers: { "will-save": [1, 2] } };
  for (const [enemyId, specialRule, level, life] of [["pet", "zombie-pet", 3, 3], ["friend", "zombie-friend", 5, 4]] as const) {
    testStory.fear.enemies[enemyId] = { label: enemyId === "pet" ? "僵尸宠物" : "僵尸朋友", level, life, damage: 1, specialRule,
      ...(enemyId === "friend" ? { tags: ["zombie-slow"] } : {}) };
    let current = state(); current.combat = { enemyId, count: 1, defeatedCount: 0, enemyLevel: level, enemyLife: life, enemyLives: [life], enemyDamage: 1,
      damageResource: "hp", playerFirst: true, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false, specialRule };
    current = advanceFear(testStory, current, { type: "attack" }, roller(2));
    assert.equal(current.combat?.playerFirst, false);
    assert.equal(current.combat?.enemyLives[0], life);
    current = advanceFear(testStory, current, { type: "defend" }, roller(6));
    current.skills.will = 2;
    current = advanceFear(testStory, current, { type: "attack" }, roller(2, 4));
    assert.ok((current.combat?.enemyLives[0] ?? 0) < life);
  }
});

test("source skill contexts add Will, Stealth, and Occultist bonuses on ordinary rolls", () => {
  const uniqueZombiePath = "scripts/alone-against-fear/fragments/section-unique-zombies-table.json";
  const stealthPath = "scripts/alone-against-fear/fragments/section-stealth-rolls.json";
  const maskPath = "scripts/alone-against-fear/fragments/015.json";
  const mirrorPath = "scripts/alone-against-fear/fragments/028.json";
  assert.equal(createHash("sha256").update(readFileSync(uniqueZombiePath)).digest("hex"), "915ca91220ad8f14c746be2606e45ed1df574417fd5a1d929b1fe4f37feb4932");
  assert.equal(createHash("sha256").update(readFileSync(stealthPath)).digest("hex"), "1c81c6188895c1c22ae7c82a1b3c70ed5d999ee2425c14b7467257e9b814bd5c");
  assert.equal(createHash("sha256").update(readFileSync(maskPath)).digest("hex"), "92eeeb0db75a9275bd54b40c172f9ed0d45b59d8e95aeaafa0620f5b383e35d9");
  assert.equal(createHash("sha256").update(readFileSync(mirrorPath)).digest("hex"), "25d87f42ca1f1dbece0e26d5c78ddbd347c7e729e041549b8c758621dd24f517");
  const zombieSource = JSON.parse(readFileSync(uniqueZombiePath, "utf8")) as { paragraphs: { id: string; text: string; sourceLocation: string }[] };
  const stealthSource = JSON.parse(readFileSync("scripts/alone-against-fear/fragments/012.json", "utf8")) as { paragraphs: { id: string; text: string; sourceLocation: string }[] };
  const maskSource = JSON.parse(readFileSync(maskPath, "utf8")) as { paragraphs: { id: string; text: string; sourceLocation: string }[] };
  const mirrorSource = JSON.parse(readFileSync(mirrorPath, "utf8")) as { paragraphs: { id: string; text: string; sourceLocation: string }[] };
  const petParagraph = zombieSource.paragraphs.find(paragraph => paragraph.id === "section-unique-zombies-table:p3");
  const sewerParagraph = stealthSource.paragraphs.find(paragraph => paragraph.id === "12:p1");
  const maskParagraph = maskSource.paragraphs.find(paragraph => paragraph.id === "15:p1");
  const mirrorParagraph = mirrorSource.paragraphs.find(paragraph => paragraph.id === "28:p1");
  assert.ok(petParagraph?.text.includes("L3 Will roll") && petParagraph.sourceLocation.includes("[71,"));
  assert.ok(sewerParagraph?.text.includes("L5 Stealth roll") && sewerParagraph.sourceLocation.includes("[82,"));
  assert.ok(maskParagraph?.text.includes("Save vs. L5 Magic") && maskParagraph.sourceLocation.includes("[83,"));
  assert.ok(mirrorParagraph?.text.replace(/\s+/g, " ").includes("L6 Magic roll") && mirrorParagraph.text.includes("Occultist Skill") && mirrorParagraph.sourceLocation.includes("[87,"));

  const testStory: FearStory = structuredClone(story);
  testStory.fear.skills.will = { label: "意志", xp: 6, modifiers: { "will-save": [1, 2], "magic-save": [1, 2] } };
  testStory.fear.skills.stealth = { label: "潜行", xp: 4, modifiers: { "stealth-save": [1, 2] } };
  testStory.fear.skills.occultist = { label: "神秘学者", xp: 4, kind: "arcane", modifiers: { "magic-save": [1, 2] } };

  // The source's L3 Will check succeeds on an ordinary 2 only when Will 1 adds its +1.
  testStory.fear.enemies.pet = { label: "僵尸宠物", level: 3, life: 3, damage: 1, specialRule: "zombie-pet" };
  let pet = state(); pet.skills.will = 1;
  pet.combat = { enemyId: "pet", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: pet.weaponId, surprise: false, attackDisabled: false, specialRule: "zombie-pet" };
  pet = advanceFear(testStory, pet, { type: "attack" }, roller(2, 4));
  assert.equal(pet.combat?.enemyLives[0], 2, "Will +1 makes raw 2 reach the printed L3 threshold, so the attack proceeds");

  // Event 12's printed L5 Stealth roll must turn raw 4 into 5 with Stealth 1.
  testStory.fear.eventPrograms["12"] = [{ op: "roll-check", context: "stealth-save", level: 5,
    success: [{ op: "resource", key: "food", amount: 2 }], failure: [{ op: "flag", key: "stealth-failed", value: true }] }];
  testStory.fear.sceneRefs.events["12"] = "event-1";
  let stealth = state(); stealth.skills.stealth = 1;
  stealth.pendingEvent = { eventId: "12", alreadyPlayed: false, started: false, visitCount: stealth.visitCount };
  stealth = advanceFear(testStory, stealth, { type: "resolve-event", target: "12" }, roller(4));
  stealth = resolvePendingAcquisition(testStory, stealth);
  assert.equal(stealth.food, 3, "Stealth +1 makes raw 4 reach the sewer event's L5 threshold and grants the source Food reward");
  assert.equal(stealth.missionProgress["flag:stealth-failed"], undefined);

  // Event 15 is a Magic save: Will +1 and Occultist +1 both apply, so raw 3 reaches L5.
  testStory.fear.eventPrograms["15"] = [{ op: "roll-check", context: "magic-save", level: 5,
    requiredSkill: "will",
    success: [{ op: "resource", key: "sanity", amount: -1 }], failure: [{ op: "flag", key: "magic-save-failed", value: true }] }];
  testStory.fear.sceneRefs.events["15"] = "event-1";
  let mask = state(); mask.skills.will = 1; mask.skills.occultist = 1;
  mask.pendingEvent = { eventId: "15", alreadyPlayed: false, started: false, visitCount: mask.visitCount };
  mask = advanceFear(testStory, mask, { type: "resolve-event", target: "15" }, roller(3));
  assert.equal(mask.sanity, 7, "Will and Occultist contribute separately; raw 3 + 1 + 1 succeeds at L5");
  assert.equal(mask.missionProgress["flag:magic-save-failed"], undefined);

  // A casting Magic roll uses Occultist only; Will is only a save-vs-Magic bonus.
  testStory.fear.eventPrograms["28"] = [{ op: "roll-check", context: "magic-save", level: 6, requiredSkill: "occultist",
    success: [{ op: "flag", key: "casting-succeeded", value: true }], failure: [{ op: "flag", key: "casting-succeeded", value: false }] }];
  testStory.fear.sceneRefs.events["28"] = "event-1";
  let ritual = state(); ritual.skills.will = 1; ritual.skills.occultist = 1;
  ritual.pendingEvent = { eventId: "28", alreadyPlayed: false, started: false, visitCount: ritual.visitCount };
  ritual = advanceFear(testStory, ritual, { type: "resolve-event", target: "28" }, roller(4));
  assert.equal(ritual.missionProgress["flag:casting-succeeded"], false,
    "the source L6 Magic roll gets Occultist +1 only: raw 4 remains below target; Will does not add to a casting roll");
});

test("source-bound Zombie Abominion pursues for three boxes and stops after three successful escapes", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-zombies-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "915ca91220ad8f14c746be2606e45ed1df574417fd5a1d929b1fe4f37feb4932");
  const sourceDefinition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync("work/alone-against-fear/enemy-source-inventory.json", "utf8")) as any;
  const record = inventory.enemies.find((entry: any) => entry.enemyId === "unique-zombies-6");
  assert.ok(record.sourceParagraphs.some((p: any) => p.paragraphId === "section-unique-zombies-table:p6" && p.original.includes("Roll a 2 in 6 chance") && p.original.includes("three times in a row")));
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["unique-zombies-6"] = sourceDefinition.enemies["unique-zombies-6"];
  testStory.fear.tables["unique-zombies"] = structuredClone(sourceDefinition.tables["unique-zombies"]);
  let current = state();
  current.combat = { enemyId: "unique-zombies-6", count: 1, defeatedCount: 0, enemyLevel: 7, enemyLife: 12, enemyLives: [12], enemyDamage: 2,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false };
  current = advanceFear(testStory, current, { type: "escape" }, roller());
  assert.deepEqual(current.abominationPursuit, { active: true, boxesRemaining: 3, escapesInRow: 1, ended: false });
  current = advanceFear(testStory, current, { type: "move", target: "s1:b2" }, roller(1, 2));
  assert.equal(current.combat?.enemyId, "unique-zombies-6");
  assert.deepEqual(current.combat?.enemyLives, [12], "the returning Abominion starts with all wounds healed");
  current = advanceFear(testStory, current, { type: "escape" }, roller());
  assert.deepEqual(current.abominationPursuit, { active: true, boxesRemaining: 3, escapesInRow: 2, ended: false });
  current = advanceFear(testStory, current, { type: "move", target: "s1:b3" }, roller(1, 2));
  assert.equal(current.combat?.enemyId, "unique-zombies-6");
  current = advanceFear(testStory, current, { type: "escape" }, roller());
  assert.deepEqual(current.abominationPursuit, { active: false, boxesRemaining: 0, escapesInRow: 3, ended: true });
  const logLength = current.log.length;
  const stopped = advanceFear(testStory, current, { type: "move", target: "s1:b4" }, roller(1, 2));
  assert.equal(stopped.combat, undefined, "a third successful escape permanently ends pursuit for this game");
  assert.ok(!stopped.log.slice(logLength).some(line => line.includes("追踪检定")));

  const deferredStory: FearStory = structuredClone(testStory);
  deferredStory.fear.tables.town.entries[0].operations = [{ op: "start-combat", enemyId: "zombie", count: 1 }];
  let deferred = state(); deferred.abominationPursuit = { active: true, boxesRemaining: 3, escapesInRow: 1, ended: false };
  deferred = advanceFear(deferredStory, deferred, { type: "move", target: "s1:b2" }, roller(1, 2));
  assert.equal(deferred.combat?.enemyId, "zombie", "the box's own encounter is resolved first");
  assert.deepEqual(deferred.deferredOperations, [{ op: "start-combat", enemyId: "unique-zombies-6", count: 1 }]);
  deferred = advanceFear(deferredStory, deferred, { type: "attack" }, roller(6, 1));
  assert.equal(deferred.combat?.enemyId, "unique-zombies-6", "the Abominion joins only after the box encounter is defeated");
  assert.deepEqual(deferred.combat?.enemyLives, [12]);
});

test("Unique Vampire 4 applies its holy-water profile and keeps the Charisma penalty until fully healed", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-vampires-table.json");
  const sha = createHash("sha256").update(source).digest("hex");
  assert.equal(sha, "f7c5b569f99f56bc7310e8d14b4cd069ccfeb1481264c7eb5b7a9bdf91679d6d");
  const sourceDefinition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync("work/alone-against-fear/enemy-source-inventory.json", "utf8")) as any;
  const record = inventory.enemies.find((entry: any) => entry.enemyId === "unique-vampires-4");
  assert.ok(record.sourceParagraphs.some((p: any) => p.paragraphId === "section-unique-vampires-table:p4" && p.original.replace(/\s+/g, " ").includes("-1 on Charisma rolls") && p.original.replace(/\s+/g, " ").includes("takes 3 damage")));
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["unique-vampires-4"] = sourceDefinition.enemies["unique-vampires-4"];
  testStory.fear.items = { ...sourceDefinition.items, "holy-water": { label: "圣水" } };
  let current = state(); current.hp = 8;
  current.combat = { enemyId: "unique-vampires-4", count: 1, defeatedCount: 0, enemyLevel: 6, enemyLife: 5, enemyLives: [5], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false };
  current = advanceFear(testStory, current, { type: "defend" }, roller(1, 2));
  assert.equal(current.pending?.kind, "injury-prevention");
  current = advanceFear(testStory, current, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(current.hp, 7, "the natural-one attack still inflicts the vampire's usual damage");
  assert.equal(current.vehnCharismaPenalty, true);
  current.combat = undefined;
  testStory.fear.tables.town.entries[0].operations = [{ op: "roll-check", context: "charisma", level: 3 }];
  current = advanceFear(testStory, current, { type: "move", target: "s1:b2" }, roller(1, 3));
  assert.ok(current.log.some(line => line.includes("charisma L3: 3 => 2")), "Charisma is reduced by one while Life is below maximum");
  current.mapSheets[0].boxes[2].safehouse = true;
  current = advanceFear(testStory, current, { type: "move", target: "s1:b3" }, roller(1));
  assert.equal(current.hp, current.maxHp, "safehouse entry heals to full");
  current.combat = undefined;
  current = advanceFear(testStory, current, { type: "move", target: "s1:b4" }, roller(1, 3));
  assert.ok(current.log.some(line => line.includes("charisma L3: 3 => 3")), "the wound penalty ends when all Life damage is healed");
});

test("Unique Vampire 2 rolls its 3-in-6 wolf form once per encounter", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-vampires-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "f7c5b569f99f56bc7310e8d14b4cd069ccfeb1481264c7eb5b7a9bdf91679d6d");
  const sourceDefinition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync("work/alone-against-fear/enemy-source-inventory.json", "utf8")) as any;
  const record = inventory.enemies.find((entry: any) => entry.enemyId === "unique-vampires-2");
  assert.ok(record.sourceParagraphs.some((p: any) => p.paragraphId === "section-unique-vampires-table:p2" && p.original.replace(/\s+/g, " ").includes("3 in 6 chance") && p.original.replace(/\s+/g, " ").includes("damage is 2") && p.original.includes("-1 on any Escape roll")));
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["unique-vampires-2"] = sourceDefinition.enemies["unique-vampires-2"];
  testStory.fear.tables.town.entries[0].operations = [{ op: "start-combat", enemyId: "unique-vampires-2", count: 1 }];
  let wolf = state();
  wolf = advanceFear(testStory, wolf, { type: "move", target: "s1:b2" }, roller(1, 3));
  assert.equal(wolf.combat?.wolfForm, true);
  assert.equal(wolf.combat?.enemyDamage, 2);
  assert.equal(wolf.combat?.escapeModifier, -1);
  let human = state();
  human = advanceFear(testStory, human, { type: "move", target: "s1:b2" }, roller(1, 4));
  assert.equal(human.combat?.wolfForm, false);
  assert.equal(human.combat?.enemyDamage, 1);
  assert.equal(human.combat?.escapeModifier, 0);
});

test("Unique Vampire 3 makes its 4-in-6 knee-blood attack, adds Defense +2, and inflicts the Limping injury until full healing", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-vampires-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "f7c5b569f99f56bc7310e8d14b4cd069ccfeb1481264c7eb5b7a9bdf91679d6d");
  const sourceDefinition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync("work/alone-against-fear/enemy-source-inventory.json", "utf8")) as any;
  const record = inventory.enemies.find((entry: any) => entry.enemyId === "unique-vampires-3");
  assert.ok(record.sourceParagraphs.some((p: any) => p.paragraphId === "section-unique-vampires-table:p3" && p.original.replace(/\s+/g, " ").includes("4 in 6 chance") && p.original.replace(/\s+/g, " ").includes("defend at +2") && p.original.replace(/\s+/g, " ").includes("Limping injury")));
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["unique-vampires-3"] = sourceDefinition.enemies["unique-vampires-3"];
  let succeeds = state();
  succeeds.combat = { enemyId: "unique-vampires-3", count: 1, defeatedCount: 0, enemyLevel: 6, enemyLife: 6, enemyLives: [6], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: succeeds.weaponId, surprise: false, attackDisabled: false };
  succeeds = advanceFear(testStory, succeeds, { type: "defend" }, roller(4, 4, 2));
  assert.equal(succeeds.hp, 8, "the +2 Defense bonus turns a 4 into a successful L6 defense");
  assert.equal(succeeds.limpingUntilFullHeal, undefined);

  let hit = state();
  hit.combat = { enemyId: "unique-vampires-3", count: 1, defeatedCount: 0, enemyLevel: 6, enemyLife: 6, enemyLives: [6], enemyDamage: 1,
    playerFirst: false, round: 1, weaponId: hit.weaponId, surprise: false, attackDisabled: false };
  hit = advanceFear(testStory, hit, { type: "defend" }, roller(4, 1, 2));
  assert.equal(hit.limpingUntilFullHeal, true);
  hit = advanceFear(testStory, hit, { type: "choose", choice: "take-loss" }, roller());
  hit.combat!.playerFirst = true;
  hit = advanceFear(testStory, hit, { type: "attack" }, roller(5));
  assert.equal(hit.combat?.enemyLife, 6, "the active Limpy injury applies the source -1 attack modifier");
});

test("Unique Vampire 6 grapples on its 4-in-6 surprise and requires the printed L6 Strength escape from the hold", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-vampires-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "f7c5b569f99f56bc7310e8d14b4cd069ccfeb1481264c7eb5b7a9bdf91679d6d");
  const sourceDefinition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const inventory = JSON.parse(readFileSync("work/alone-against-fear/enemy-source-inventory.json", "utf8")) as any;
  const record = inventory.enemies.find((entry: any) => entry.enemyId === "unique-vampires-6");
  const sourceText = record.sourceParagraphs.find((p: any) => p.paragraphId === "section-unique-vampires-table:p6")?.original.replace(/\s+/g, " ") ?? "";
  assert.ok(sourceText.includes("4 in 6 chance of surprise") && sourceText.includes("L6 Strength roll") && sourceText.includes("automatic damage every turn"));
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["unique-vampires-6"] = sourceDefinition.enemies["unique-vampires-6"];
  testStory.fear.skills.strong = sourceDefinition.skills.strong;
  testStory.fear.tables.town.entries[0].operations = [{ op: "start-combat", enemyId: "unique-vampires-6", count: 1 }];
  let current = state();
  current = advanceFear(testStory, current, { type: "move", target: "s1:b2" }, roller(1, 4));
  assert.equal(current.combat?.surprise, true);
  assert.equal(current.combat?.grappled, true);
  assert.equal(current.combat?.playerFirst, false);
  assert.ok(!availableFearActions(testStory, current).some(({ action }) => action.type === "attack"));
  assert.ok(availableFearActions(testStory, current).some(({ action }) => action.type === "defend"));
  current = advanceFear(testStory, current, { type: "defend" }, roller());
  current = advanceFear(testStory, current, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(current.hp, 6, "the surprise hold causes its automatic 2 Life loss");
  current.skills.strong = 1;
  current = advanceFear(testStory, current, { type: "break-grapple" }, roller(5));
  assert.equal(current.combat?.grappled, false, "Strong +1 makes a natural 5 meet L6");
  assert.ok(availableFearActions(testStory, current).some(({ action }) => action.type === "attack"));
});

test("Vetala heals once per damaging hit and yields two source-defined random-item rolls when defeated", () => {
  const source = readFileSync("scripts/alone-against-fear/fragments/section-unique-vampires-table.json");
  assert.equal(createHash("sha256").update(source).digest("hex"), "f7c5b569f99f56bc7310e8d14b4cd069ccfeb1481264c7eb5b7a9bdf91679d6d");
  const bound = JSON.parse(source.toString()) as { paragraphs: { id: string; text: string }[] };
  const paragraph = bound.paragraphs.find(value => value.id === "section-unique-vampires-table:p5");
  assert.ok(paragraph?.text.replace(/\s+/g, " ").includes("recovers 1 Life every time she damages you"));
  assert.ok(paragraph?.text.replace(/\s+/g, " ").includes("Loot: 2 random items"));
  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies.vetala = { label: "Vetala", level: 4, life: 6, damage: 1, tags: ["undead", "vampire"], specialRule: "vampire-vetala" };
  testStory.fear.rules.randomItemTable = "randomItems";
  testStory.fear.items = { ...testStory.fear.items, rope: { label: "绳索", weightless: true } };
  testStory.fear.tables.randomItems = { die: "D6", entries: [{ roll: [1, 6], result: "rope", operations: [{ op: "item", itemId: "rope", amount: 1 }] }] };
  const current = state();
  current.combat = { enemyId: "vetala", count: 1, defeatedCount: 0, enemyLevel: 4, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    damageResource: "hp", playerFirst: false, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false, specialRule: "vampire-vetala" };
  let resolved = advanceFear(testStory, current, { type: "defend" }, roller(2, 2));
  assert.equal(resolved.combat?.enemyLife, 5, "a failed Defense heals exactly one Life, not the damage amount");
  if (resolved.pending) resolved = advanceFear(testStory, resolved, { type: "choose", choice: "take-loss" }, roller());
  resolved.combat = { ...resolved.combat!, enemyLife: 1, enemyLives: [1], playerFirst: true };
  resolved = advanceFear(testStory, resolved, { type: "attack" }, roller(6, 1, 1, 1));
  assert.equal(resolved.inventory.rope, 2, "defeating the Vetala resolves exactly two random-item draws");
  assert.equal(resolved.combat, undefined);
});

test("Vetala's source offer charges the selected payment and either grants Foretell or starts her combat", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-unique-vampires-table.json";
  const sourceBytes = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), "f7c5b569f99f56bc7310e8d14b4cd069ccfeb1481264c7eb5b7a9bdf91679d6d");
  const source = JSON.parse(sourceBytes.toString()) as { paragraphs: { id: string; text: string }[] };
  const paragraph = source.paragraphs.find(row => row.id === "section-unique-vampires-table:p5");
  assert.ok(paragraph?.text.includes("offer 6 Food") && paragraph.text.includes("2 Life points")
    && paragraph.text.includes("pass a L5") && paragraph.text.includes("one use of the Foretell"));
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const vetalaEntry = canonical.tables["unique-vampires"].entries.find(entry => entry.result === "unique-vampires-5")!;
  assert.deepEqual(vetalaEntry.operations?.map(op => op.op), ["vetala-encounter", "start-combat"]);

  const testStory: FearStory = structuredClone(story);
  testStory.fear.enemies["unique-vampires-5"] = canonical.enemies["unique-vampires-5"];
  testStory.fear.skills.charisma = canonical.skills.charisma;
  testStory.fear.items = { ...canonical.items };
  testStory.fear.rules.townExplorationTable = "town";
  testStory.fear.tables["unique-vampires"] = { die: "D6", entries: [structuredClone(vetalaEntry)] };
  testStory.fear.tables.town = { die: "2D6", entries: Array.from({ length: 11 }, (_, index) => ({ roll: index + 2, result: "street" })) };
  testStory.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "unique-vampires" }];

  let offered = state(); offered.food = 10; offered.skills.charisma = 1; offered.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: offered.visitCount };
  offered = advanceFear(testStory, offered, { type: "resolve-event", target: "1" }, roller(5));
  assert.equal(offered.pending?.kind, "vetala-offer");
  assert.equal(offered.combat, undefined, "Vetala's offered decision must precede combat");
  assert.ok(availableFearActions(testStory, offered).some(action => action.action.choice === "offer-food" && action.label.includes("6点食物")));
  offered = advanceFear(testStory, offered, { type: "choose", choice: "offer-food" }, roller(4, 2, 3));
  assert.equal(offered.food, 4, "the 6 Food payment is spent before the Charisma and Foretell rolls");
  assert.equal(offered.combat, undefined, "a successful offer avoids combat");
  assert.equal(offered.pending?.kind, "foretell-result");
  assert.match(String(offered.pending?.data?.prompt), /2D6得到5/);
  offered = advanceFear(testStory, offered, { type: "choose", choice: "use-result" }, roller());
  assert.equal(offered.foretoldTownEntry?.roll, 5);

  let failed = state(); failed.food = 10; failed.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: failed.visitCount };
  failed = advanceFear(testStory, failed, { type: "resolve-event", target: "1" }, roller(5));
  failed = advanceFear(testStory, failed, { type: "choose", choice: "offer-food" }, roller(2));
  assert.equal(failed.food, 4, "a failed offer is still paid");
  assert.equal(failed.combat?.enemyId, "unique-vampires-5", "a failed L5 Charisma check starts the source fight");

  let fought = state(); fought.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: fought.visitCount };
  fought = advanceFear(testStory, fought, { type: "resolve-event", target: "1" }, roller(5));
  fought = advanceFear(testStory, fought, { type: "choose", choice: "fight" }, roller());
  assert.equal(fought.combat?.enemyId, "unique-vampires-5", "declining the offer starts the fight without a Charisma roll");
});

test("Demonic Horrors source profiles execute their turn-bound effects instead of remaining catalog-only", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-demonic-horrors-table.json";
  const bytes = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "b8efccace0ba210f737cef830df09f225bec7e4ddbb4d0625df3b26d9e9eb939");
  const source = JSON.parse(bytes.toString()) as { paragraphs: { id: string; text: string }[] };
  for (const [id, phrase] of [["p1", "cursed (-1 on"], ["p3", "knocked down"], ["p4", "only by attacks that roll 6"], ["p5", "L6 Fear"], ["p6", "Even if you Escape"]])
    assert.ok(source.paragraphs.find(row => row.id === `section-demonic-horrors-table:${id}`)?.text.includes(phrase), `${id} source phrase`);
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  assert.equal(canonical.enemies["demonic-horrors-1"].specialRule, "demon-child");
  assert.equal(canonical.enemies["demonic-horrors-3"].specialRule, "demonic-goat");
  assert.equal(canonical.enemies["demonic-horrors-4"].specialRule, "night-shadow");
  assert.equal(canonical.enemies["demonic-horrors-5"].fearSave?.level, 6);
  assert.equal(canonical.enemies["demonic-horrors-5"].noEscape, true);
  assert.ok(canonical.enemies["demonic-horrors-6"].escapeBait?.bonus === 1);

  const testStory: FearStory = structuredClone(story);
  for (const id of ["demonic-horrors-1", "demonic-horrors-3", "demonic-horrors-4", "demonic-horrors-5", "demonic-horrors-6"])
    testStory.fear.enemies[id] = canonical.enemies[id];
  let child = state(); child.weaponIds.push("unarmed"); child.weaponId = "unarmed";
  child.combat = { enemyId: "demonic-horrors-1", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "unarmed", surprise: false, attackDisabled: false, specialRule: "demon-child" };
  child = advanceFear(testStory, child, { type: "attack" }, roller(1));
  assert.equal(child.missionProgress["flag:cursed"], true);
  assert.equal(child.combat?.playerFirst, false, "failed per-turn save consumes the player turn and leaves the child to attack");
  assert.ok(child.log.some(line => line.includes("所有检定-1")));

  let cursedAttack = state(); cursedAttack.weaponIds.push("unarmed"); cursedAttack.weaponId = "knife";
  cursedAttack.missionProgress["flag:cursed"] = true;
  cursedAttack.combat = { enemyId: "demonic-horrors-1", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3, enemyLives: [3], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 2, weaponId: "knife", surprise: false, attackDisabled: false, specialRule: "demon-child" };
  cursedAttack = advanceFear(testStory, cursedAttack, { type: "attack" }, roller(6, 2));
  assert.equal(cursedAttack.combat?.enemyLives[0], 3, "the active curse applies -1 to the investigator's Attack roll");

  let cured = state(); cured.sanity = 3; cured.missionProgress["flag:cursed"] = true; cured.inventory["blessed-candle"] = 1;
  cured = advanceFear(testStory, cured, { type: "use-item", target: "blessed-candle", choice: "sanity" }, roller());
  assert.equal(cured.missionProgress["flag:cursed"], undefined, "an action that increases Sanity removes the curse");

  let goat = state(); goat.combat = { enemyId: "demonic-horrors-3", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 4, enemyLives: [4], enemyDamage: 1,
    damageResource: "hp", playerFirst: false, round: 1, weaponId: goat.weaponId, surprise: false, attackDisabled: false, specialRule: "demonic-goat" };
  goat = advanceFear(testStory, goat, { type: "defend" }, roller(1, 2, 2));
  assert.equal(goat.combat?.knockedDown, true, "a hit knocks the investigator down");
  if (goat.pending?.kind === "injury-prevention") goat = advanceFear(testStory, goat, { type: "choose", choice: "take-loss" }, roller());
  assert.ok(availableFearActions(testStory, goat).some(({ action }) => action.type === "stand-up"));
  assert.ok(availableFearActions(testStory, goat).some(({ action }) => action.type === "stay-down"));
  goat = advanceFear(testStory, goat, { type: "stay-down" }, roller());
  goat = advanceFear(testStory, goat, { type: "defend" }, roller(2));
  assert.equal(goat.combat?.knockedDown, false, "choosing defense applies the knocked-down penalty once");
  assert.ok(goat.log.some(line => line.includes("目标L3")));

  let shadow = state(); shadow.weaponIds.push("unarmed"); shadow.weaponId = "unarmed";
  shadow.combat = { enemyId: "demonic-horrors-4", count: 1, defeatedCount: 0, enemyLevel: 2, enemyLife: 2, enemyLives: [2], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "unarmed", surprise: false, attackDisabled: false, specialRule: "night-shadow" };
  shadow = advanceFear(testStory, shadow, { type: "attack" }, roller(3));
  assert.equal(shadow.combat?.enemyLives[0], 2, "an ordinary non-6 attack cannot damage the Night Shadow");
  shadow.combat!.playerFirst = false;
  shadow = advanceFear(testStory, shadow, { type: "defend" }, roller(1, 4, 2));
  assert.equal(shadow.pending?.kind, "injury-prevention");
  assert.equal(shadow.pending?.data?.injuryKind, "sanity", "the chill-touch D6 routes a hit of 4-6 to Sanity");
});

test("Succubus/Inkubus L5 seduction resists into combat or permanently reduces Life", () => {
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const sourceBytes = readFileSync("scripts/alone-against-fear/fragments/section-demonic-horrors-table.json");
  const source = JSON.parse(sourceBytes.toString()) as { paragraphs: { id: string; text: string }[] };
  assert.match(source.paragraphs.find(row => row.id === "section-demonic-horrors-table:p2")!.text, /lose permanently 1 Life/);
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), "b8efccace0ba210f737cef830df09f225bec7e4ddbb4d0625df3b26d9e9eb939");
  const testStory: FearStory = structuredClone(story);
  testStory.nodes.push(...Array.from({ length: 106 }, (_, index) => ({ id: String(index + 1) })));
  testStory.fear.enemies = { ...testStory.fear.enemies, ...canonical.enemies };
  testStory.fear.tables = { ...testStory.fear.tables, ...canonical.tables,
    town: { die: "D6", entries: [{ roll: [1, 6], result: "demons", operations: [{ op: "roll-table", tableId: "demonic-horrors" }] }] },
    "demonic-horrors": { die: "D6", entries: [canonical.tables["demonic-horrors"].entries[1]] } };
  const resisted = advanceFear(testStory, state(), { type: "move", target: "s1:b2" }, roller(1, 2, 6));
  assert.equal(resisted.combat?.enemyId, "demonic-horrors-2");
  assert.equal(resisted.maxHp, 8);
  const seduced = advanceFear(testStory, state(), { type: "move", target: "s1:b2" }, roller(1, 2, 1));
  assert.equal(seduced.combat, undefined);
  assert.equal(seduced.maxHp, 7);
  assert.equal(seduced.hp, 7);
});

test("Unique Vampire 1–3 resolve the printed random-item or rope loot only after defeat", () => {
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const sourceBytes = readFileSync("scripts/alone-against-fear/fragments/section-unique-vampires-table.json");
  const source = JSON.parse(sourceBytes.toString()) as { paragraphs: { id: string; text: string }[] };
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), "f7c5b569f99f56bc7310e8d14b4cd069ccfeb1481264c7eb5b7a9bdf91679d6d");
  assert.match(source.paragraphs.find(row => row.id === "section-unique-vampires-table:p1")!.text, /Loot: 1 random item/);
  assert.match(source.paragraphs.find(row => row.id === "section-unique-vampires-table:p2")!.text, /Loot: 1 random item/);
  assert.match(source.paragraphs.find(row => row.id === "section-unique-vampires-table:p3")!.text, /Loot: 1 rope/);
  const testStory: FearStory = structuredClone(story);
  testStory.nodes.push(...Array.from({ length: 106 }, (_, index) => ({ id: String(index + 1) })));
  testStory.fear.enemies = { ...testStory.fear.enemies, ...canonical.enemies };
  testStory.fear.items = { ...testStory.fear.items, ...canonical.items, rope: { label: "绳索" } };
  testStory.fear.rules.randomItemTable = "loot-test";
  testStory.fear.tables["loot-test"] = { die: "D6", entries: [{ roll: [1, 6], result: "rope", operations: [{ op: "item", itemId: "rope", amount: 1 }] }] };
  for (const id of ["unique-vampires-1", "unique-vampires-2", "unique-vampires-3"]) {
    const spec = canonical.enemies[id];
    let current = state();
    current.combat = { enemyId: id, count: 1, defeatedCount: 0, enemyLevel: spec.level, enemyLife: 1, enemyLives: [1], enemyDamage: spec.damage,
      playerFirst: true, round: 1, weaponId: current.weaponId, surprise: false, attackDisabled: false, specialRule: spec.specialRule };
    current = advanceFear(testStory, current, { type: "attack" }, roller(6, 1, 1));
    assert.equal(current.combat, undefined, `${id} is defeated`);
    assert.equal(current.inventory.rope, 1, `${id} resolves the source loot after combat`);
  }
});

test("the once-per-game Midnight Man and a staked vampire are rerolled from the Unique Vampires table", () => {
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const bytes = readFileSync("scripts/alone-against-fear/fragments/section-unique-vampires-table.json");
  const source = JSON.parse(bytes.toString()) as { paragraphs: { id: string; text: string }[] };
  assert.match(source.paragraphs.find(row => row.id === "section-unique-vampires-table:p6")!.text, /only once per game/);
  assert.match(source.paragraphs.find(row => row.id === "section-unique-vampires-table:p6")!.text, /Reroll if you encounter again\s+a vampire that you destroyed/);
  const testStory: FearStory = structuredClone(story);
  testStory.nodes.push(...Array.from({ length: 106 }, (_, index) => ({ id: String(index + 1) })));
  testStory.fear.enemies = { ...testStory.fear.enemies, ...canonical.enemies };
  testStory.fear.items = { ...testStory.fear.items, ...canonical.items };
  testStory.fear.tables = { ...testStory.fear.tables, ...canonical.tables,
    town: { die: "D6", entries: [{ roll: [1, 6], result: "vampires", operations: [{ op: "roll-table", tableId: "unique-vampires" }] }] } };

  let current = advanceFear(testStory, state(), { type: "move", target: "s1:b2" }, roller(1, 6, 6));
  assert.equal(current.combat?.enemyId, "unique-vampires-6");
  assert.ok(current.vampiresEncounteredOnce?.includes("unique-vampires-6"));
  current = advanceFear(testStory, current, { type: "escape" }, roller(6));
  current = advanceFear(testStory, current, { type: "move", target: "s1:b3" }, roller(1, 6, 1, 1));
  assert.equal(current.combat?.enemyId, "unique-vampires-1", "a repeat Midnight Man table result rerolls before encounter setup");

  const destroyedStory: FearStory = structuredClone(testStory);
  destroyedStory.fear.tables["unique-vampires"] = { die: "D6", entries: [
    { roll: 1, result: "unique-vampires-2", values: { enemyId: "unique-vampires-2", count: 1 }, operations: [{ op: "start-combat", enemyId: "unique-vampires-2", count: 1 }] },
    { roll: 6, result: "unique-vampires-1", values: { enemyId: "unique-vampires-1", count: 1 }, operations: [{ op: "start-combat", enemyId: "unique-vampires-1", count: 1 }] },
  ] };
  let staked = state(); staked.destroyedVampires = ["unique-vampires-2"];
  staked = advanceFear(destroyedStory, staked, { type: "move", target: "s1:b2" }, roller(1, 1, 6));
  assert.equal(staked.combat?.enemyId, "unique-vampires-1", "a vampire whose body was staked is never repeated from this table");
});

test("Possessed table aliases preserve source rules, adapted damage and post-encounter event hooks", () => {
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const sourceBytes = readFileSync("scripts/alone-against-fear/fragments/section-possessed-table.json");
  const source = JSON.parse(sourceBytes.toString()) as { paragraphs: { id: string; text: string }[] };
  assert.ok(source.paragraphs.find(row => row.id === "section-possessed-table:p2")?.text.includes("when you first meet a doll in the campaign"));
  assert.ok(source.paragraphs.find(row => row.id === "section-possessed-table:p5")?.text.includes("play unique event #3"));
  for (const id of ["possessed-doll", "possessed-objects", "demon-dog", "possessed-people"]) {
    assert.equal(canonical.enemies[id].damage, 1, `${id} applies the approved one-HP web adaptation`);
    assert.equal(canonical.enemies[id].damageBasis, "user-authorized-web-adaptation");
  }
  assert.equal(canonical.enemies["possessed-objects"].surprise, 2);
  assert.equal(canonical.tables.possessed.entries.find(entry => entry.roll === 6)?.operations?.at(-1)?.op, "combat-outcome");
  const poss = canonical.tables.possessed.entries.find(entry => entry.roll === 2)!;
  assert.ok(poss.operations?.some(op => op.op === "if-flag" && op.key === "possessed-doll-fear-tested"));
});

test("Possessed cultists can be avoided only by the printed L5 Charisma check and a valid source offering", () => {
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const sourceBytes = readFileSync("scripts/alone-against-fear/fragments/section-possessed-table.json");
  const source = JSON.parse(sourceBytes.toString()) as { paragraphs: { id: string; text: string }[] };
  const paragraph = source.paragraphs.find(row => row.id === "section-possessed-table:p1")!;
  assert.match(paragraph.text, /succeeding in an L5 Charisma roll/);
  assert.match(paragraph.text, /1 Food\s+point each/);
  assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");

  const testStory: FearStory = structuredClone(story);
  testStory.nodes.push(...Array.from({ length: 106 }, (_, index) => ({ id: String(index + 1) })));
  testStory.fear.enemies = { ...testStory.fear.enemies, ...canonical.enemies };
  testStory.fear.items = { ...testStory.fear.items, ...canonical.items };
  testStory.fear.weapons = { ...testStory.fear.weapons, ...canonical.weapons };
  testStory.fear.tables = { ...testStory.fear.tables, ...canonical.tables,
    town: { die: "D6", entries: [{ roll: [1, 6], result: "possessed" , operations: [{ op: "roll-table", tableId: "possessed" }] }] },
    possessed: { die: "D6", entries: [canonical.tables.possessed.entries[0]] } };

  const available = state();
  available.inventory["holy-book"] = 1;
  const encounter = advanceFear(testStory, available, { type: "move", target: "s1:b2" }, roller(1, 1, 1, 2));
  assert.equal(encounter.combat, undefined);
  assert.equal(encounter.pending?.kind, "fear-cultists-negotiation");
  assert.match(availableFearActions(testStory, encounter)[0].label, /拒绝交涉/);
  const negotiated = advanceFear(testStory, encounter, { type: "choose", choice: "negotiate" }, roller(6));
  assert.equal(negotiated.pending?.kind, "fear-cultists-offer");
  assert.ok(availableFearActions(testStory, negotiated).some(({ label }) => label.includes("圣书")));
  const avoided = advanceFear(testStory, negotiated, { type: "choose", choice: "book:holy-book" }, roller());
  assert.equal(avoided.combat, undefined);
  assert.equal(avoided.inventory["holy-book"], undefined);

  const failed = advanceFear(testStory, encounter, { type: "choose", choice: "negotiate" }, roller(1));
  assert.equal(failed.combat?.enemyId, "possessed-1", "a failed L5 Charisma check starts the same already-rolled D6+1 cultist group");
  assert.equal(failed.combat?.count, 2, "the encounter count uses the one already-rolled D6 plus one");
});

test("source demonic-horrors table starts the exact creature and Hell Hound baying resolves after defeat or escape", () => {
  const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
  const testStory: FearStory = structuredClone(story);
  testStory.nodes.push(...Array.from({ length: 106 }, (_, index) => ({ id: String(index + 1) })));
  testStory.fear.enemies = { ...testStory.fear.enemies, ...canonical.enemies };
  testStory.fear.tables = { ...testStory.fear.tables, ...canonical.tables };
  testStory.fear.tables.town = { die: "D6", entries: [{ roll: [1, 6], result: "horror", operations: [{ op: "roll-table", tableId: "demonic-horrors" }] }] };
  let started = advanceFear(testStory, state(), { type: "move", target: "s1:b2" }, roller(1, 5, 2));
  // The failed L6 startup Fear save queues the Mental-Scar substitution before combat begins; accept the loss.
  assert.equal(started.pending?.kind, "injury-prevention");
  started = advanceFear(testStory, started, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(started.combat?.enemyId, "demonic-horrors-5");
  assert.equal(started.sanity, 7, "the table's Horned Demon applies its L6 startup Fear save before combat");
  assert.ok(availableFearActions(testStory, started).every(({ action }) => action.type !== "escape"));

  testStory.fear.weapons.grenade = canonical.weapons.grenade;
  let hound = state();
  hound.weaponIds.push("grenade"); hound.weaponId = "grenade";
  hound = advanceFear(testStory, hound, { type: "move", target: "s1:b2" }, roller(1, 6));
  assert.equal(hound.combat?.enemyId, "demonic-horrors-6");
  hound = advanceFear(testStory, hound, { type: "attack" }, roller(4, 1));
  assert.equal(hound.combat, undefined, "one source grenade hit defeats the remaining three Life in the test encounter");
  assert.equal(hound.pending?.kind, "source-choice", "a 1-in-6 baying roll is resolved after combat and offers the three source tables");
  assert.deepEqual(hound.pending?.options, ["demonic-horrors", "possessed", "undead"]);

  let escaped = state(); escaped.weaponIds.push("grenade"); escaped.weaponId = "grenade"; escaped.inventory["dog-food"] = 1;
  escaped = advanceFear(testStory, escaped, { type: "move", target: "s1:b2" }, roller(1, 6));
  // The carried dog-food queues the pre-combat item choice; decline it so the encounter starts, then use the bait in combat.
  escaped = advanceFear(testStory, escaped, { type: "choose", choice: "continue" }, roller(6));
  escaped = advanceFear(testStory, escaped, { type: "escape", choice: "dog-food" }, roller(6, 1));
  assert.equal(escaped.combat, undefined);
  assert.equal(escaped.pending?.kind, "source-choice", "the attraction check still runs when the investigator escapes");
  assert.equal(escaped.inventory["dog-food"], undefined, "the source escape bait is consumed");
});

