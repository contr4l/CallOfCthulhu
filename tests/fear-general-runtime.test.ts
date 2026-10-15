import assert from "node:assert/strict";
import test from "node:test";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const definition: FearDefinition = {
  format: "aaf-fear-definition@1", source: { pdfSha256: "a".repeat(64), pages: 106 },
  map: { boxesPerSheet: 30, rows: 6, columns: 5, adjacency: "orthogonal", topologyBasis: "web-adaptation", start: { sheet: 1, box: 1 }, safehouseLimit: 3, safehouseLifetime: "nearest-first" },
  rules: { foodEveryBoxes: 5, townExplorationTable: "town", randomEncounterTable: "encounter", usefulItemTable: "useful", randomItemTable: "randomItems", maxScars: 3, maxTraumas: 3, searchOncePerBox: true, exploredAreaEncounter: { numerator: 1, denominator: 6 }, sixExplodes: true, naturalOneFails: true, naturalSixSucceeds: true },
  sceneRefs: { entry: "entry", exploration: "explore", missions: "missions", tables: { randomEncounter: "encounter" }, events: {}, specialEvents: {}, endings: { win: "win" } },
  eventPrograms: {},
  skills: {
    stealth: { label: "潜行", xp: 4, modifiers: { stealth: [1, 2] } },
    dodge: { label: "闪避", xp: 4, modifiers: { defense: [1, 2] } },
    agile: { label: "敏捷", xp: 8, modifiers: { defense: [1, 2] } },
    medic: { label: "医护员", xp: 3, modifiers: {} },
    faith: { label: "信仰", xp: 2, modifiers: { "faith-exorcism": [0, 1] } },
    will: { label: "意志", xp: 6, modifiers: { exorcism: [1, 2] } },
    exorcism: { label: "驱魔", xp: 4, kind: "arcane", modifiers: { exorcism: [1, 2] } },
  },
  weapons: { unarmed: { label: "徒手", damage: 1 }, knife: { label: "小刀", damage: 1, modifier: -1 } },
  enemies: {
    zombie: { label: "僵尸", level: 3, life: 1, damage: 1, surprise: 0, scene: "explore" },
    vampire: { label: "吸血鬼", level: 4, life: 6, damage: 1, surprise: 0, tags: ["vampire"], scene: "explore" },
  },
  items: { "first-aid-kit": { label: "急救包" }, garlic: { label: "大蒜" } },
  tables: {
    town: { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] },
    encounter: { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] },
    useful: { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] },
    randomItems: { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] },
  },
  missions: { one: { label: "任务一", goal: "test", reward: { xp: 1 } }, two: { label: "任务二", goal: "test", reward: { xp: 1 } } },
  gates: { required: 7, level: 6, scene: "win" },
};
const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: ["entry", "explore", "missions", "encounter", "win"].map(id => ({ id })), fear: definition };
function roller(...faces: number[]): FearDice { let index = 0; return () => faces[index++] ?? 1; }
function activeState(): FearState {
  const initial = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, startBox: 1, weaponIds: ["knife"], weaponId: "knife" }, roller(1));
  const current = advanceFear(story, initial, { type: "choose", choice: "s1:b1" }, roller(1));
  current.missionId = "one";
  current.missionRules = undefined;
  current.pendingEvent = undefined;
  current.deferredTables = [];
  current.deferredOperations = [];
  return current;
}
function combat(enemyId: string, level: number, life = 4, damage = 1): NonNullable<FearState["combat"]> {
  return { enemyId, count: 1, defeatedCount: 0, enemyLevel: level, enemyLife: life, enemyLives: [life], enemyDamage: damage,
    damageResource: "hp", round: 1, playerFirst: true, surprise: false, weaponId: "knife", attackDisabled: false };
}
function resolveScene(story: FearStory, current: FearState): FearState {
  for (let attempt = 0; attempt < 3; attempt++) {
    const action = availableFearActions(story, current).find(({ action }) => action.type === "resolve-event")?.action;
    if (!action) break;
    current = advanceFear(story, current, action, roller(6, 1, 6, 1));
  }
  return current;
}

test("public occupied-box revisit may evade for this entry but keeps the same encounter for a later failed attempt", () => {
  const localStory = structuredClone(story);
  localStory.fear.enemies.zombie.level = 4;
  let current = activeState();
  current.combat = combat("zombie", 4, 3, 1);
  current = advanceFear(localStory, current, { type: "escape" }, roller(6, 1));
  assert.equal(current.pending, undefined, JSON.stringify({ pending: current.pending, log: current.log.slice(-6) }));
  const original = structuredClone(current.mapSheets[0].boxes[0].occupiedEncounter);
  assert.ok(original);

  current = advanceFear(localStory, current, { type: "move", target: "s1:b2" }, roller(6));
  current = advanceFear(localStory, current, { type: "move", target: "s1:b1" }, roller(6, 1));
  assert.equal(current.combat, undefined, "successful Stealth avoids only the current entry");
  assert.equal(current.currentBoxId, "s1:b1");
  assert.deepEqual(current.mapSheets[0].boxes[0].occupiedEncounter?.enemyLives, original.enemyLives);
  assert.deepEqual(current.mapSheets[0].boxes[0].occupiedBy, ["zombie"]);
  assert.deepEqual(current.mapSheets[0].boxes.slice(0, 2).map(({ id, row, column }) => ({ id, row, column })), [{ id: "s1:b1", row: 1, column: 1 }, { id: "s1:b2", row: 1, column: 2 }]);

  current = resolveScene(localStory, current);
  assert.equal(current.pending, undefined, JSON.stringify({ pending: current.pending, pendingEvent: current.pendingEvent, log: current.log.slice(-8) }));
  current = advanceFear(localStory, current, { type: "move", target: "s1:b2" }, roller(6));
  current = resolveScene(localStory, current);
  current = advanceFear(localStory, current, { type: "move", target: "s1:b1" }, roller(1, 1));
  assert.equal(current.combat?.enemyId, "zombie");
  assert.deepEqual(current.combat?.enemyLives, original.enemyLives, "failed Stealth resumes without healing or replacing the old opponent");
});

test("public First Aid heals old Life loss, spends selected charges, and is once per encounter", () => {
  const current = activeState();
  current.hp = 3;
  current.lifeLostThisEncounter = true;
  current.inventory["first-aid-kit"] = 1;
  current.inventory["first-aid-charges"] = 5;
  current.skills.medic = 1;
  const action = availableFearActions(story, current).find(({ action }) => action.type === "use-item" && action.target === "first-aid" && action.amount === 3)?.action;
  assert.ok(action);
  const healed = advanceFear(story, current, action, roller(1));
  assert.equal(healed.hp, 6, "the 3-point ceiling applies to the amount healed, including prior damage");
  assert.equal(healed.inventory["first-aid-charges"], 2);
  assert.equal(healed.firstAidUsedThisEncounter, true);
  assert.equal(availableFearActions(story, healed).some(({ action }) => action.target === "first-aid"), false);
});

test("public First Aid becomes available again after the next encounter resets its one-use marker", () => {
  const localStory = structuredClone(story);
  localStory.fear.tables.encounter.entries[0].operations = [{ op: "start-combat", enemyId: "zombie", count: 1 }];
  const current = activeState();
  current.hp = 7; current.lifeLostThisEncounter = true;
  current.firstAidUsedThisEncounter = true;
  current.inventory["first-aid-kit"] = 1; current.inventory["first-aid-charges"] = 2;
  let next = advanceFear(localStory, current, { type: "search" }, roller(1, 1));
  assert.equal(next.combat?.enemyId, "zombie");
  assert.equal(next.firstAidUsedThisEncounter, false);
  assert.equal(next.lifeLostThisEncounter, false);
  next.hp = 7;
  next.lifeLostThisEncounter = true;
  const attack = availableFearActions(localStory, next).find(({ action }) => action.type === "attack")?.action;
  assert.ok(attack);
  next = advanceFear(localStory, next, attack, roller(6, 1));
  assert.equal(next.combat, undefined);
  const heal = availableFearActions(localStory, next).find(({ action }) => action.target === "first-aid" && action.amount === 1)?.action;
  assert.ok(heal);
  next = advanceFear(localStory, next, heal, roller(1));
  assert.equal(next.hp, 8);
  assert.equal(next.firstAidUsedThisEncounter, true);
});

test("public Garlic failure consumes one head and cannot be retried in the same vampire encounter", () => {
  const localStory = structuredClone(story);
  localStory.fear.enemies["runtime-vampire"] = { label: "测试吸血鬼", level: 4, life: 6, damage: 1, tags: ["vampire"] };
  const current = activeState();
  current.inventory.garlic = 2;
  current.skills.faith = 2; current.skills.will = 2; current.arcaneSkills.exorcism = 2;
  current.combat = combat("runtime-vampire", 4, 6, 1);
  const action = availableFearActions(localStory, current).find(({ action }) => action.type === "exorcise" && action.target === "garlic")?.action;
  assert.ok(action);
  const failed = advanceFear(localStory, current, action, roller(3));
  assert.equal(failed.combat?.enemyId, "runtime-vampire", "garlic tests only the raw D6 against vampire Level; other skills do not raise it");
  assert.equal(failed.inventory.garlic, 1);
  assert.equal(availableFearActions(localStory, failed).some(({ action }) => action.type === "exorcise" && action.target === "garlic"), false);
});

test("public surprise status permanently bars Garlic during that encounter", () => {
  const current = activeState();
  current.inventory.garlic = 1;
  current.combat = { ...combat("vampire", 4, 6, 1), surprise: true, playerFirst: false };
  const defend = availableFearActions(story, current).find(({ action }) => action.type === "defend")?.action;
  assert.ok(defend);
  const after = advanceFear(story, current, defend, roller(6));
  assert.equal(after.combat?.playerFirst, true);
  assert.equal(availableFearActions(story, after).some(({ action }) => action.type === "exorcise" && action.target === "garlic"), false);
});

test("public expert Faith adds +1 to Holy Symbol as the source-defined Exorcism-style attempt", () => {
  const current = activeState();
  current.inventory["holy-symbol"] = 1;
  current.skills.faith = 2;
  current.combat = combat("vampire", 5, 6, 1);
  const action = availableFearActions(story, current).find(({ action }) => action.type === "exorcise" && action.target === "holy-symbol")?.action;
  assert.ok(action);
  const after = advanceFear(story, current, action, roller(4));
  assert.equal(after.combat, undefined, "4 + Faith Expert 1 reaches the vampire's Level 5");
});

test("public next-mission transition restores current Life and Sanity while retaining acquired scars", () => {
  const current = activeState();
  current.hp = 2; current.maxHp = 8; current.sanity = 3; current.maxSanity = 8;
  current.scars = ["facial-scar"];
  current.missionFinished = true;
  current.previousMissionId = "not-a-mission-id";
  const action = availableFearActions(story, current).find(({ action }) => action.type === "start-mission")?.action;
  assert.ok(action);
  const next = advanceFear(story, current, action, roller(1));
  assert.equal(next.hp, 8);
  assert.equal(next.sanity, 8);
  assert.deepEqual(next.scars, ["facial-scar"]);
  assert.ok(next.pending?.kind === "starting-area");
});

test("public Defense offers Dodge and Agile as separate choices; only a natural-1 Dodge penalizes the next Attack", () => {
  const localStory = structuredClone(story);
  localStory.fear.skills.dodge = { label: "闪避", xp: 4, modifiers: { defense: [1, 2] } };
  localStory.fear.skills.agile = { label: "敏捷", xp: 8, modifiers: { defense: [1, 2] } };
  localStory.fear.enemies["runtime-attacker"] = { label: "测试攻击者", level: 3, life: 10, damage: 0 };
  const dodger = activeState();
  dodger.skills.dodge = 1; dodger.skills.agile = 1;
  dodger.combat = { ...combat("runtime-attacker", 3, 10, 1), playerFirst: false };
  const defenses = availableFearActions(localStory, dodger).filter(({ action }) => action.type === "defend");
  const dodge = defenses.find(({ action }) => action.skill === "dodge")?.action;
  const agile = defenses.find(({ action }) => action.skill === "agile")?.action;
  assert.ok(dodge); assert.ok(agile);

  let after = advanceFear(localStory, dodger, dodge, roller(1, 6));
  assert.equal(after.combat?.dodgePenaltyPending, true);
  const attack = availableFearActions(localStory, after).find(({ action }) => action.type === "attack")?.action;
  assert.ok(attack, JSON.stringify({ pending: after.pending, pendingEvent: after.pendingEvent, combat: after.combat, actions: availableFearActions(localStory, after).map(({ action }) => action) }));
  after = advanceFear(localStory, after, attack, roller(4));
  assert.deepEqual(after.combat?.enemyLives, [10], "the -1 turns a knife result at the L3 boundary into a miss");
  assert.equal(after.combat?.dodgePenaltyPending, false);

  const agileDefender = activeState();
  agileDefender.skills.dodge = 1; agileDefender.skills.agile = 1;
  agileDefender.combat = { ...combat("runtime-attacker", 3, 10, 1), playerFirst: false };
  const agileAction = availableFearActions(localStory, agileDefender).find(({ action }) => action.type === "defend" && action.skill === "agile")?.action;
  assert.ok(agileAction);
  const agileResult = advanceFear(localStory, agileDefender, agileAction, roller(1, 6));
  assert.notEqual(agileResult.combat?.dodgePenaltyPending, true, "Agile's natural 1 does not invoke the Dodge consequence");
});
