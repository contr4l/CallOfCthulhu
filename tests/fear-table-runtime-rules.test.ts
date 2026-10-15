import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear, projectFear } from "../packages/engine/fear.js";

const baseStory = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-story.json`, "utf8"));
const sourceDefinition = JSON.parse(readFileSync(`${process.cwd()}/work/alone-against-fear/reviewed-definition.json`, "utf8")) as FearDefinition;
const source = (fragment: string, id: string) => {
  const doc = JSON.parse(readFileSync(`${process.cwd()}/scripts/alone-against-fear/fragments/${fragment}.json`, "utf8"));
  return doc.paragraphs.find((p: { id: string }) => p.id === id)?.text as string;
};
function roller(...values: number[]) { let i = 0; return () => values[i++] ?? 1; }
function resolveAcquisition(story: FearStory, current: ReturnType<typeof initialFear>) {
  let state = current;
  while (state.pending?.kind === "food-to-salt" || state.pending?.kind === "worship-symbol-visit") {
    const choice = state.pending.kind === "food-to-salt" ? "0" : "leave";
    const selected = availableFearActions(story, state).find(value => value.action.type === "choose" && value.action.choice === choice)?.action;
    assert.ok(selected, `public acquisition choice ${choice} is available`);
    state = advanceFear(story, state, selected, roller());
  }
  return state;
}

test("all injury and trauma player-state labels are Chinese while stable rule ids remain intact", () => {
  const expectedInjuries = ["面部疤痕", "手臂受损", "眼部受损", "跛行", "脑部受损", "手臂残废"];
  const expectedTraumas = ["偏执", "饮食失调", "心不在焉", "恐惧症", "过度自信", "易受惊"];
  const injuries = sourceDefinition.injuries ?? {}, traumas = sourceDefinition.traumas ?? {};
  assert.deepEqual(Object.values(injuries).map(value => value.label), expectedInjuries);
  assert.deepEqual(Object.values(traumas).map(value => value.label), expectedTraumas);
  assert.deepEqual(Object.keys(injuries), ["facial-scar", "impaired-arm", "eye-damage", "limping", "brain-damage", "crippled-arm"]);
  assert.deepEqual(Object.keys(traumas), ["paranoia", "eating-disorder", "absent-mindedness", "phobic", "overconfidence", "shaky"]);
  const story = { ...baseStory, fear: sourceDefinition } as FearStory;
  const state = initialFear(story, {
    hp: 8, maxHp: 8, sanity: 8, maxSanity: 8,
    scars: Object.keys(injuries), traumas: Object.keys(traumas),
  }, roller(1));
  const projected = projectFear(story, state);
  assert.deepEqual(projected.scars.map(value => value.label), expectedInjuries);
  assert.deepEqual(projected.traumas.map(value => value.label), expectedTraumas);
});

function testStory(tableId: string, result: string, enemyId: string) {
  const fear = structuredClone(sourceDefinition);
  fear.rules.townExplorationTable = tableId;
  delete fear.rules.startingEquipmentTables;
  if (!(tableId === "children-stuff" && result === "knotted-cord"))
    fear.tables[tableId] = { die: "D6", entries: [{ roll: 1, result, values: { enemyId, count: 1 }, operations: [] }] };
  fear.enemies[enemyId] ??= { label: enemyId, level: 3, life: 4, damage: 1 };
  return { ...baseStory, fear } as FearStory;
}

test("paranoia refuses the printed helpful-person food and healing", () => {
  assert.match(source("section-insanity-table", "section-insanity-table:p1"), /may not accept\s+thei?r Food or healing/i);
  const story = testStory("cemetery", "helpful-person", "zombie");
  const sourceRow = sourceDefinition.tables.cemetery.entries.find((entry) => entry.result === "helpful-person")!;
  story.fear.tables.cemetery.entries[0].operations = structuredClone(sourceRow.operations);
  const start = initialFear(story, { hp: 4, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1", traumas: ["paranoia"] }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 6));
  assert.equal(state.hp, 4);
  assert.equal(state.food, 1);
  assert.ok(state.log.some((line) => line.includes("拒绝接受好心人的食物或治疗")));
});

test("paranoia refuses healing and Food but still accepts a separate helpful item", () => {
  const story = testStory("clinic", "helpful-paramedic", "zombie");
  const sourceRow = sourceDefinition.tables.clinic.entries.find((entry) => entry.result === "helpful-paramedic")!;
  story.fear.tables.clinic.entries[0].operations = structuredClone(sourceRow.operations);
  const start = initialFear(story, { hp: 4, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1", traumas: ["paranoia"] }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 6));
  assert.equal(state.hp, 4);
  assert.equal(state.food, 1);
  assert.equal(state.inventory["first-aid-kit"], 1);
});

test("sewer table entry reaches a real fire-avoidance choice; choosing fire suppresses combat", () => {
  assert.match(source("section-sewers-table", "section-sewers-table:p2"), /It fears fire/);
  const story = testStory("sewers", "giant-rat-thing", "giant-rat-thing");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  state.inventory.torch = 1;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 6));
  assert.equal(state.pending?.kind, "fear-sewer-rat");
  assert.ok(availableFearActions(story, state).some(({ action }) => action.type === "choose" && action.choice === "fire:torch"));
  state = advanceFear(story, state, { type: "choose", choice: "fire:torch" }, roller());
  assert.equal(state.combat, undefined);
  assert.equal(state.inventory.torch, 1);
});

test("sewer rat poison spends one dose and one Food, then enters combat already damaged", () => {
  const story = testStory("sewers", "giant-rat-thing", "giant-rat-thing");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  state.inventory["rat-poison"] = 1; state.food = 2;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 6));
  state = advanceFear(story, state, { type: "choose", choice: "poison" }, roller(1));
  assert.equal(state.food, 1);
  assert.equal(state.inventory["rat-poison"], undefined);
  assert.equal(state.combat?.enemyLife, 2);
});

test("without fire or paid poison, sewer rats require combat and reject an unavailable avoidance choice", () => {
  const story = testStory("sewers", "giant-rat-thing", "giant-rat-thing");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 6));
  assert.deepEqual(state.pending?.options, ["fight"]);
  assert.throws(() => advanceFear(story, state, { type: "choose", choice: "fire:torch" }, roller()), /Invalid choice/);
  state = advanceFear(story, state, { type: "choose", choice: "fight" }, roller());
  assert.equal(state.combat?.enemyId, "giant-rat-thing");
});

test("bookstore rolls its 3/6 encounter after failed book-finding rolls as well", () => {
  assert.match(source("section-store-table", "section-store-table:p4"), /If you roll to find\s+any books, you must also roll a 3 in 6 chance/);
  const story = testStory("store", "bookstore", "possessed-1");
  story.fear.tables.store.entries[0].operations = structuredClone(sourceDefinition.tables.store.entries.find((entry) => entry.result === "bookstore")!.operations);
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 6, 6, 6, 1));
  assert.ok(state.log.some((line) => line.includes("书店搜书后遭遇检定3/6")), state.log.join("\n"));
  assert.ok(state.combat || state.pending || state.log.some((line) => line.includes("Possessed")), state.log.join("\n"));
  assert.equal(state.inventory["occult-guide"] ?? 0, 0);
  assert.equal(state.inventory["holy-book"] ?? 0, 0);
});

test("school library stores the D3 candidate book identities and grants them only when no librarian appears", () => {
  assert.match(source("section-school-table", "section-school-table:p6"), /You find d3 random books/);
  const story = testStory("school", "library", "witch-librarian");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 1, 6, 6, 6));
  assert.equal(state.pending?.kind, undefined);
  assert.equal(Object.values(state.inventory).reduce((sum, count) => sum + count, 0) > 0, true);
  assert.ok(state.log.some((line) => line.includes("女巫图书管理员遭遇检定3/6")));
});

test("school library encounter requires L4 Charisma and charges one source price per selected candidate book", () => {
  const story = testStory("school", "library", "witch-librarian");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 2, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 1, 1, 1, 4));
  assert.equal(state.pending?.kind, "fear-librarian-trade", state.log.join("\n"));
  assert.ok(state.pending?.options.includes("food:0"));
  state = advanceFear(story, state, { type: "choose", choice: "food:0" }, roller(1));
  assert.equal(state.food, 0);
  assert.equal(state.inventory.necronomicon, 1);
});

test("school librarian L4 Charisma failure starts combat without granting candidate books", () => {
  const story = testStory("school", "library", "witch-librarian");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 0, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 1, 1, 1));
  assert.equal(state.combat?.enemyId, "witch-librarian");
  assert.equal(state.inventory.necronomicon ?? 0, 0);
});

test("defeating the school librarian grants the saved candidate book through ordinary inventory rules", () => {
  const story = testStory("school", "library", "witch-librarian");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 0, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 1, 1, 1));
  assert.equal(state.combat?.enemyId, "witch-librarian");
  assert.ok(state.missionProgress["fear-table:school:library-books-on-defeat"]);
  state.combat!.enemyLife = 1; state.combat!.enemyLives = [1];
  const attack = availableFearActions(story, state).find(({ action }) => action.type === "attack")!.action;
  state = advanceFear(story, state, attack, roller(6, 6, 6));
  assert.equal(state.combat, undefined);
  assert.equal(state.combatResult?.outcome, "defeated");
  assert.equal(state.inventory.necronomicon, 1);
  assert.equal(state.missionProgress["fear-table:school:library-books-on-defeat"], undefined);
});

test("escaping the school librarian does not grant or retain candidate books", () => {
  const story = testStory("school", "library", "witch-librarian");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 0, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 1, 1, 1));
  const escape = availableFearActions(story, state).find(({ action }) => action.type === "escape")!.action;
  state = advanceFear(story, state, escape, roller(6, 6));
  assert.equal(state.combat, undefined, state.log.join("\n"));
  assert.equal(state.combatResult?.outcome, "escaped");
  assert.equal(state.inventory.necronomicon ?? 0, 0);
  assert.equal(state.missionProgress["fear-table:school:library-books-on-defeat"], undefined);
});

test("school librarian victory persists candidate book grants through the carry-capacity discard choice", () => {
  const story = testStory("school", "library", "witch-librarian");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 0, missionId: "1", inventory: { nails: 10 } }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 1, 1, 1));
  state.combat!.enemyLife = 1; state.combat!.enemyLives = [1];
  const attack = availableFearActions(story, state).find(({ action }) => action.type === "attack")!.action;
  state = advanceFear(story, state, attack, roller(6, 6, 6));
  assert.equal(state.pending?.kind, "carry-capacity");
  assert.equal(state.pending?.data?.itemId, "necronomicon");
  state = advanceFear(story, state, { type: "choose", choice: "discard-item:nails" }, roller(1));
  assert.equal(state.pending?.kind, "carry-capacity");
  state = advanceFear(story, state, { type: "choose", choice: "discard-item:nails" }, roller(1));
  assert.equal(state.pending, undefined);
  assert.equal(state.inventory.necronomicon, 1);
  assert.equal(state.missionProgress["fear-table:school:library-book-queue"], undefined);
});

test("haunted library rolls candidate identities before the choice and grants the selected book before leaving encounter", () => {
  assert.match(source("section-haunted-house-table", "section-haunted-house-table:p3"), /Roll twice on the\s+Random Book table[\s\S]*?You may take one or both/i);
  const story = testStory("haunted-house", "occult-library", "dummy");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 1, 1, 1, 1, 1, 1, 2));
  assert.equal(state.pending?.kind, "fear-occult-library");
  assert.deepEqual(state.pending?.options, ["book:0", "book:1", "both"]);
  const candidates = state.pending?.data?.candidates as Array<{ result: string }>;
  assert.deepEqual(candidates.map((book) => book.result), ["necronomicon", "holy-book"]);
  state = advanceFear(story, state, { type: "choose", choice: "book:1" }, roller(6, 6, 6, 6));
  assert.equal(state.inventory["holy-book"], 1);
  assert.equal(state.inventory.necronomicon ?? 0, 0);
});

test("art school offers its source Search roll for one Clue only when the sketchbook was not found", () => {
  const story = testStory("school", "art-school", "possessed-1");
  story.fear.tables.school.entries[0].operations = structuredClone(sourceDefinition.tables.school.entries.find((entry) => entry.result === "art-school")!.operations);
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(1, 6, 6, 1, 3));
  assert.ok(availableFearActions(story, state).some(({ action }) => action.type === "search"));
  const search = availableFearActions(story, state).find(({ action }) => action.type === "search")!.action;
  state = advanceFear(story, state, search, roller(6));
  assert.equal(state.clues, 1);
  assert.ok(state.log.some((line) => line.includes("画室搜索成功")));
});

test("children's cord starts source event 36 only when an occult guide is carried", () => {
  assert.match(source("section-children-s-stuff-table", "section-children-s-stuff-table:p3"), /as soon as you find an occult guide/);
  const story = testStory("children-stuff", "knotted-cord", "dummy");
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1", inventory: { "occult-guide": 1 } }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const next = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, next, roller(4, 1, 6));
  assert.equal(state.inventory.cord, 1);
  assert.equal(state.pendingEvent?.eventId, "36");
});

function startHouseZombieCombat(rewardRoll: number, diceToKill: number[] = [6, 1], prepare?: (state: ReturnType<typeof initialFear>) => void, postRolls: number[] = [], resolveVictory = true) {
  const story = testStory("house", "zombie-horde-2d6-l2", "zombie");
  story.fear.missions = {};
  delete story.fear.eventPrograms["1"]; // unrelated map-scene event is outside this table-mechanics fixture
  const sourceEntry = sourceDefinition.tables.house.entries.find((entry) => entry.result === "zombie-horde-2d6-l2")!;
  story.fear.tables.house.entries[0].operations = structuredClone(sourceEntry.operations);
  story.fear.tables.house.entries[0].scene = undefined; // isolate this table mechanic from the source entry's unrelated event scene
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const move = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, move, roller(1));
  // This fixture targets the Rewards table itself, not the unrelated event-1
  // scene attached to the generated map box.
  state.pendingEvent = undefined;
  assert.equal(state.pending?.kind, "source-choice");
  state = advanceFear(story, state, { type: "choose", choice: "fight" }, roller(1, 1));
  assert.equal(state.combat?.enemyId, "zombie");
  prepare?.(state);
  if (!resolveVictory) return { story, state };
  const attack = availableFearActions(story, state).find(({ action }) => action.type === "attack")!.action;
  state = advanceFear(story, state, attack, roller(...diceToKill, rewardRoll, ...postRolls));
  // Completion of this isolated Rewards-table fixture should expose the table's
  // pending choices instead of the generated map box's unrelated event scene.
  state.pendingEvent = undefined;
  return { story, state };
}

test("source Rewards table is in the candidate, house horde victory rolls it once, and ignore/escape never rewards", () => {
  assert.match(source("section-house-table", "section-house-table:p2"), /If you defeat them, roll on the\s+rewards table/i);
  const rewardTexts = ["section-rewards-table:p1", "section-rewards-table:p2", "section-rewards-table:p3", "section-rewards-table:p4"]
    .map((id) => source("section-rewards-table", id)).join("\n");
  assert.match(rewardTexts, /Recover 1 Life and 1 Sanity\. Gain 1 XP/);
  assert.match(rewardTexts, /Gain d6 Food, recover 1 Sanity and 1\s+Life/);
  assert.equal(sourceDefinition.tables.rewards.entries.length, 6);
  assert.equal(sourceDefinition.sceneRefs.tables.rewards, "table-rewards");
  assert.ok(baseStory.nodes.some((node: { id: string; sourceId?: string }) => node.id === "table-rewards" && node.sourceId === "section-rewards-table"));

  const defeated = startHouseZombieCombat(2);
  assert.equal(defeated.state.combat, undefined, defeated.state.log.join("\n"));
  assert.equal(defeated.state.pending?.kind, "fear-rewards-choice");
  assert.equal(defeated.state.pending?.data?.row, 2);
  assert.deepEqual(defeated.state.deferredTables, []);
  const chooseXp = advanceFear(defeated.story, defeated.state, { type: "choose", choice: "xp" }, roller());
  assert.equal(chooseXp.xp, 3, "one combat XP plus the chosen 2 reward XP");
  assert.equal(chooseXp.pending, undefined);
  assert.equal(chooseXp.nodeId, defeated.story.fear.sceneRefs.exploration);

  const ignoredStory = testStory("house", "zombie-horde-2d6-l2", "zombie");
  const sourceEntry = sourceDefinition.tables.house.entries.find((entry) => entry.result === "zombie-horde-2d6-l2")!;
  ignoredStory.fear.tables.house.entries[0].operations = structuredClone(sourceEntry.operations);
  let ignored = initialFear(ignoredStory, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1" }, roller(1));
  ignored = advanceFear(ignoredStory, ignored, { type: "choose", choice: "s1:b1" }, roller());
  ignored.pendingEvent = undefined; ignored.nodeId = ignoredStory.fear.sceneRefs.exploration;
  const ignoreMove = availableFearActions(ignoredStory, ignored).find(({ action }) => action.type === "move")!.action;
  ignored = advanceFear(ignoredStory, ignored, ignoreMove, roller(1));
  ignored = advanceFear(ignoredStory, ignored, { type: "choose", choice: "ignore" }, roller());
  assert.equal(ignored.combat, undefined);
  assert.equal(ignored.pending, undefined);
  assert.equal(ignored.xp, 0);

  const escaping = startHouseZombieCombat(1, [1], undefined, [], false);
  assert.equal(escaping.state.combat?.enemyLives.length, 2);
  const escape = availableFearActions(escaping.story, escaping.state).find(({ action }) => action.type === "escape")!.action;
  const escaped = advanceFear(escaping.story, escaping.state, escape, roller(6));
  assert.equal(escaped.combat, undefined);
  assert.equal(escaped.pending, undefined);
  assert.equal(escaped.missionProgress["fear:house-rewards:pending"], undefined);
  assert.equal(escaped.deferredTables.length, 0);
  assert.equal(escaped.xp, 0);
});

test("Rewards table applies all six printed branches, including carry-cap and item-table choices", () => {
  // Rows 1–3 and 6 use the same actual house-victory path as the rule table.
  const row1 = startHouseZombieCombat(1);
  assert.equal(row1.state.xp, 2);
  assert.equal(row1.state.hp, 8);
  assert.equal(row1.state.sanity, 8);

  const row2 = startHouseZombieCombat(2, [6, 1], (state) => { state.hp = 6; });
  const row2Life = advanceFear(row2.story, row2.state, { type: "choose", choice: "life" }, roller());
  assert.equal(row2Life.hp, 8);
  assert.equal(row2Life.xp, 1);

  const row3 = startHouseZombieCombat(3, [6, 1], (state) => { state.hp = 6; state.sanity = 6; });
  const row3Life = advanceFear(row3.story, row3.state, { type: "choose", choice: "life-sanity" }, roller());
  assert.equal(row3Life.hp, 8); assert.equal(row3Life.sanity, 7);

  const row4 = startHouseZombieCombat(4);
  row4.story.fear.tables["random-objects"] = { die: "D6", entries: [{ roll: 1, result: "reward-random-item", operations: [{ op: "item", itemId: "holy-water", amount: 1 }] }] };
  row4.story.fear.tables["useful-stuff"] = { die: "D6", entries: [{ roll: 1, result: "reward-useful-item", operations: [{ op: "item", itemId: "incense", amount: 1 }] }] };
  assert.equal(row4.state.food, 1, "the printed two Food points await the source salt-conversion choice");
  const row4ItemsBeforeSalt = advanceFear(row4.story, row4.state, { type: "choose", choice: "items-random-useful" }, roller(1, 1));
  const row4Items = resolveAcquisition(row4.story, row4ItemsBeforeSalt);
  assert.equal(row4Items.food, 3, JSON.stringify({ pending: row4Items.pending, pendingEvent: row4Items.pendingEvent, pendingSaltConversion: row4Items.pendingSaltConversion, log: row4Items.log.slice(-8) }));
  assert.equal(row4Items.inventory["holy-water"], 1); assert.equal(row4Items.inventory.incense, 1);
  assert.equal(row4Items.pending, undefined);

  const row5 = startHouseZombieCombat(5, [6, 1], (state) => { state.food = 19; state.hp = 8; state.sanity = 8; });
  assert.equal(row5.state.pending?.kind, "fear-rewards-choice");
  assert.equal(row5.state.pending?.data?.row, 5);
  const row5Xp = advanceFear(row5.story, row5.state, { type: "choose", choice: "xp" }, roller());
  assert.equal(row5Xp.xp, 3);
  const row5Standard = startHouseZombieCombat(5, [6, 1], (state) => { state.hp = 7; state.sanity = 7; state.food = 1; }, [2]);
  row5Standard.state = resolveAcquisition(row5Standard.story, row5Standard.state);
  assert.equal(row5Standard.state.pending, undefined);
  assert.equal(row5Standard.state.hp, 8); assert.equal(row5Standard.state.sanity, 8); assert.equal(row5Standard.state.food, 3);

  const row6 = startHouseZombieCombat(6, [6, 1], (state) => { state.hp = 3; state.sanity = 2; });
  const row6Restore = advanceFear(row6.story, row6.state, { type: "choose", choice: "restore" }, roller());
  assert.equal(row6Restore.hp, row6Restore.maxHp); assert.equal(row6Restore.sanity, row6Restore.maxSanity);
});

test("mission 3 Food cargo shares item capacity with personal Food and requires an explicit discard or decline", () => {
  const story = testStory("street", "quiet", "zombie");
  const start = initialFear(story, {
    hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 10, missionId: "3",
    weaponIds: ["knife"], weaponId: "knife", inventory: { "first-aid-kit": 1 },
  }, roller(1));
  let state = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  state.missionFood = 8;
  state.missionRules!.food.cargo = 8;
  assert.equal(projectFear(story, state).foodCapacity, 18, "10 Food base plus 8 free item slots; knife and kit each occupy one slot");
  state.inventory.backpack = 1;
  assert.equal(projectFear(story, state).foodCapacity, 28, "backpack adds five base Food and five item slots");
  delete state.inventory.backpack;
  assert.equal(projectFear(story, state).foodCapacity, 18, "removing backpack recalculates capacity without merging cargo counters");
  const beforePickup = structuredClone(state);
  const move = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, move, roller(1, 1, 3, 1));
  if (state.combat) {
    const attack = availableFearActions(story, state).find(({ action }) => action.type === "attack")!.action;
    state = advanceFear(story, state, attack, roller(6, 1));
  }
  assert.equal(state.pending?.kind, "carry-capacity");
  assert.equal(state.missionFood, 8, "overflow must not be silently accepted");
  assert.equal(state.pending?.data?.remaining, 3);
  assert.ok(state.pending?.options.includes("discard-new-mission-food"));
  assert.ok(state.pending?.options.includes("discard-item:first-aid-kit"));
  state = advanceFear(story, state, { type: "choose", choice: "discard-new-mission-food" }, roller());
  assert.equal(state.missionFood, 8);
  assert.equal(state.missionRules?.food.cargo, 8);
  assert.equal(state.food, 10);

  state = beforePickup;
  const retry = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, retry, roller(1, 1, 3, 1));
  if (state.combat) {
    const attack = availableFearActions(story, state).find(({ action }) => action.type === "attack")!.action;
    state = advanceFear(story, state, attack, roller(6, 1));
  }
  assert.equal(state.pending?.kind, "carry-capacity");
  state = advanceFear(story, state, { type: "choose", choice: "discard-item:first-aid-kit" }, roller());
  assert.equal(state.inventory["first-aid-kit"], undefined);
  assert.equal(state.missionFood, 9, "discarding one item frees exactly one cargo slot");
  assert.equal(state.pending?.data?.remaining, 2);
  state = advanceFear(story, state, { type: "choose", choice: "discard-weapon:knife" }, roller());
  assert.equal(state.missionFood, 10);
  assert.equal(state.pending?.data?.remaining, 1);
  state = advanceFear(story, state, { type: "choose", choice: "discard-new-mission-food" }, roller());
  assert.equal(state.missionRules?.food.cargo, 10);
  assert.equal(state.food, 10, "ordinary and mission Food retain separate counts");
  assert.equal(projectFear(story, state).missionFood, 10);

});

test("M3 cargo occupies an item slot when a further source item is found", () => {
  const story = testStory("house", "quiet", "zombie");
  story.fear.tables.house.entries[0].operations = [{ op: "item", itemId: "first-aid-kit", amount: 1 }];
  let state = initialFear(story, {
    hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 10, missionId: "3",
    weaponIds: ["knife"], weaponId: "knife",
  }, roller(1));
  state.missionFood = 9;
  state = advanceFear(story, state, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  const move = availableFearActions(story, state).find(({ action }) => action.type === "move")!.action;
  state = advanceFear(story, state, move, roller(1, 1));
  assert.equal(state.pending?.kind, "carry-capacity");
  assert.equal(state.pending?.data?.itemId, "first-aid-kit");
  assert.ok(state.pending?.options.includes("discard-new"));
  state = advanceFear(story, state, { type: "choose", choice: "discard-new" }, roller());
  assert.equal(state.inventory["first-aid-kit"], undefined);
  assert.equal(state.food, 10);
  assert.equal(state.missionFood, 9);
});

function enterFearTableResult(tableId: string, result: string) {
  const story = testStory(tableId, result, "zombie");
  let state = advanceFear(story, initialFear(story, {
    hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1",
  }, roller(1)), { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.nodeId = story.fear.sceneRefs.exploration;
  state = advanceFear(story, state, { type: "move", target: "s1:b2" }, roller(1, 1, 1, 1, 1, 1, 1, 1, 1, 1));
  return { story, state };
}

test("hardware-store items wait for a public pickup action and trigger the saved encounter only after pickup", () => {
  const { story, state: entered } = enterFearTableResult("store", "hardware-store");
  story.fear.tables["store-hardware-encounter"] = { die: "D6", entries: [{ roll: 1, result: "quiet", operations: [] }] };
  let state = entered;
  assert.equal(state.pending?.kind, "fear-hardware-store-pickup");
  assert.equal(state.inventory.hammer ?? 0, 0);
  assert.equal(state.log.some(line => line.includes("触发已掷出的随机遭遇")), false);
  state = advanceFear(story, state, { type: "choose", choice: "take:0" }, roller(1));
  assert.ok(state.weaponIds.includes("hammer"));
  assert.ok(state.log.some(line => line.includes("拿取五金店物品時触发已掷出的随机遭遇")));
  assert.equal(state.pending?.kind, "fear-hardware-store-pickup", "remaining found items persist until the player leaves");
  state = advanceFear(story, state, { type: "choose", choice: "leave" }, roller());
  assert.equal(state.pending, undefined);
  assert.ok(state.weaponIds.includes("hammer"));
});

test("clinic's source victory action grants a kit and the actual D6 painkiller table result", () => {
  const { story, state: entered } = enterFearTableResult("clinic", "zombie-horde-3d6-l3");
  assert.equal(entered.pending?.kind, "fear-table-horde");
  let state = advanceFear(story, entered, { type: "choose", choice: "fight" }, roller(1, 1, 1));
  assert.equal(state.combat?.enemyId, "zombie");
  assert.equal(state.combat?.count, 3, "the typed count is the source's 3D6 zombies");
  state.combat!.enemyLives = [1]; state.combat!.enemyLife = 1; state.combat!.count = 1;
  state.weaponIds = ["knife"]; state.weaponId = "knife"; state.combat!.weaponId = "knife";
  state.combat!.playerFirst = true;
  const attack = availableFearActions(story, state).find(({ action }) => action.type === "attack")!.action;
  state = advanceFear(story, state, attack, roller(6, 1));
  assert.equal(state.pending?.kind, "fear-table-horde-reward");
  state = advanceFear(story, state, { type: "choose", choice: "claim" }, roller(4));
  assert.equal(state.inventory["first-aid-kit"], 1);
  assert.equal(state.inventory.painkillers, 4, "the reward uses the saved Useful Stuff D6 outcome table");
});

test("wearing the source clown mask grants CLOWNFACE and its charisma penalty, while the escape route ignores only specified penalties", () => {
  const { story, state: entered } = enterFearTableResult("children-stuff", "clown-mask");
  assert.equal(entered.pending?.kind, "fear-clown-mask");
  let state = advanceFear(story, entered, { type: "choose", choice: "wear" }, roller());
  assert.equal(state.missionProgress["flag:clownface-worn"], true);
  state.scars = ["facial-scar"];
  story.fear.rules.townExplorationTable = "railways";
  const rail = story.fear.tables.railways.entries.find(candidate => candidate.result === "demonic-clown")!;
  story.fear.tables.railways = { die: "D6", entries: [{ ...rail, roll: 1 }] };
  state = advanceFear(story, state, { type: "move", target: "s1:b3" }, roller(1));
  assert.equal(state.pending?.kind, "fear-clown-escape");
  state = advanceFear(story, state, { type: "choose", choice: "charisma" }, roller(3));
  assert.ok(state.log.some(line => line.includes("CLOWNFACE恶魔小丑L4魅力检定：3 + 0 = 3")), state.log.join("\n"));
  assert.equal(state.combat?.enemyId, "demonic-clown");
});

test("worship and farm siege rewards are offered only after victory and follow each printed choice", () => {
  for (const [tableId, result, reward, expected] of [
    ["worship", "zombie-siege-2d6-l3", "sanity", "sanity"],
    ["farm", "zombie-siege-2d6-l3", "D6-shotgun-shells", "ammo"],
  ] as const) {
    const { story, state: entered } = enterFearTableResult(tableId, result);
    if (entered.pending?.options.includes("ignore")) {
      const ignored = advanceFear(story, entered, { type: "choose", choice: "ignore" }, roller());
      assert.equal(ignored.combat, undefined);
    }

    let state = advanceFear(story, entered, { type: "choose", choice: "fight" }, roller(1, 1, 1));
    state.combat!.enemyLives = [1]; state.combat!.enemyLife = 1; state.combat!.count = 1;
    state.weaponIds = ["knife"]; state.weaponId = "knife"; state.combat!.weaponId = "knife"; state.combat!.playerFirst = true;
    state = advanceFear(story, state, availableFearActions(story, state).find(({ action }) => action.type === "attack")!.action, roller(6, 1));
    assert.equal(state.pending?.kind, "fear-table-horde-reward");
    if (reward === "sanity") {
      state.sanity = 5;
      state = advanceFear(story, state, { type: "choose", choice: reward }, roller());
      assert.equal(state.sanity, 6);
      assert.equal(state.pending?.kind, "worship-symbol-visit", "the Worship visit choice waits until the siege reward resolves");
      const leaveVisit = availableFearActions(story, state).find(({ action }) => action.type === "choose" && action.choice === "leave")?.action;
      assert.ok(leaveVisit, "the source gives a public take-or-leave choice after resolving the encounter");
      state = advanceFear(story, state, leaveVisit, roller());
    } else {
      state = advanceFear(story, state, { type: "choose", choice: reward }, roller(4));
      assert.equal(state.ammo.shotgun, 4);
    }
    assert.equal(state.pending, undefined);
    assert.equal(expected, reward === "sanity" ? "sanity" : "ammo");
  }
});
