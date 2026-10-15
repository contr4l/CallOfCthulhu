/** Platform transaction tests; not complete imported-book route witnesses. */
import assert from "node:assert/strict";
import test from "node:test";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import type { FearDiceWindow } from "../packages/contracts/fear-dice-window.js";
import { advanceFear, initialFear } from "../packages/engine/fear.js";
import { evaluateFearDiceWindow, drawFearWindowDie, acceptFearWindowDie, rerollFearWindowDie } from "../packages/engine/fear-dice-window.js";
const definition: FearDefinition = {
  format: "aaf-fear-definition@1", source: { pdfSha256: "a".repeat(64), pages: 106 },
  map: { boxesPerSheet: 30, rows: 6, columns: 5, adjacency: "orthogonal", topologyBasis: "web-adaptation", start: { sheet: 1, box: 1 }, safehouseLimit: 3, safehouseLifetime: "nearest-first" },
  rules: { foodEveryBoxes: 5, townExplorationTable: "town", randomEncounterTable: "encounter", usefulItemTable: "useful", randomItemTable: "randomItems", maxScars: 3, maxTraumas: 3, searchOncePerBox: true, exploredAreaEncounter: { numerator: 1, denominator: 6 }, sixExplodes: true, naturalOneFails: true, naturalSixSucceeds: true },
  sceneRefs: { entry: "entry", exploration: "explore", missions: "missions", tables: { randomEncounter: "random" }, events: { "1": "event-1" }, specialEvents: { "1": "event-1" }, endings: { win: "win" } },
  eventPrograms: {},
  skills: { "danger-sense": { label: "危险感知", xp: 4, modifiers: {} }, investigator: { label: "调查员", xp: 6, modifiers: {} }, slippery: { label: "滑溜", xp: 3, modifiers: {} }, willpower: { label: "意志", xp: 6, modifiers: {} }, gate: { label: "门", xp: 0, kind: "arcane", modifiers: { magic: [1, 2] } } },
  weapons: { unarmed: { label: "徒手", damage: 1 }, knife: { label: "小刀", damage: 1, modifier: 1 } },
  enemies: { zombie: { label: "僵尸", level: 3, life: 1, damage: 1, surprise: 0, scene: "event-1" } },
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

function transaction(before: FearState, action: FearDiceWindow["action"]): FearDiceWindow {
  return { before: structuredClone(before), action, label: "当前行动", draws: [], risks: [], waiting: { key: "", min: 1, max: 7 }, visibleKeys: [] };
}
function evaluate(book: FearStory, window: FearDiceWindow) {
  const result = evaluateFearDiceWindow(book, window);
  if (!result.completed) window.waiting = result.waiting!;
  window.visibleKeys = result.visibleKeys;
  return result;
}
function eventFixture() {
  const book = structuredClone(story), before = state();
  before.inventory["witch-knots-cord"] = 1; before.witchKnots = { total: 7, used: 0 };
  before.pendingEvent = { eventId: "two-dice", alreadyPlayed: false, started: false, visitCount: before.visitCount };
  book.fear.eventPrograms["two-dice"] = [{ op: "resource", key: "food", amount: "2D6" }];
  return { book, before, window: transaction(before, { type: "resolve-event", target: "two-dice" }) };
}
test("multi-die action pauses before consequences and commits each face once", () => {
  const { book, before, window } = eventFixture(), original = structuredClone(before);
  let result = evaluate(book, window);
  assert.equal(result.completed, false); assert.equal(result.state.food, before.food);
  drawFearWindowDie(window, roller(2)); result = evaluate(book, window);
  assert.equal(result.state.food, before.food); assert.equal(window.visibleKeys.length, 1);
  acceptFearWindowDie(window); result = evaluate(book, window);
  assert.equal(result.completed, false); assert.equal(window.visibleKeys.length, 1);
  drawFearWindowDie(window, roller(3)); evaluate(book, window);
  assert.equal(window.visibleKeys.length, 2);
  rerollFearWindowDie(window, 0, roller(5, 1)); result = evaluate(book, window);
  assert.equal(result.state.witchKnots?.used, 1); assert.equal(result.state.sanity, before.sanity);
  assert.equal(result.state.food, before.food);
  acceptFearWindowDie(window); result = evaluate(book, window);
  assert.equal(result.completed, false); // second physical die was not yet accepted
  assert.equal(window.draws[1].value, 3);
  acceptFearWindowDie(window); result = evaluate(book, window);
  assert.equal(result.completed, true);
  assert.deepEqual(before, original);
  assert.deepEqual(evaluate(book, window).state, result.state);
  // The source food-to-salt conversion choice holds the granted food until resolved; keep it as food.
  const settled = advanceFear(book, result.state, { type: "choose", choice: "0" }, roller());
  assert.equal(settled.food, before.food + 8);
});
test("every knot including the final knot pays cumulative SAN risk, persisted mid-roll", () => {
  const { book, before, window } = eventFixture();
  before.witchKnots = { total: 3, used: 1 }; window.before = structuredClone(before);
  evaluate(book, window); drawFearWindowDie(window, roller(2)); evaluate(book, window);
  rerollFearWindowDie(window, 0, roller(3, 1)); let result = evaluate(book, window);
  assert.equal(result.state.sanity, before.sanity); assert.equal(result.state.witchKnots?.used, 2);
  const restored = JSON.parse(JSON.stringify(window)) as FearDiceWindow;
  assert.deepEqual(JSON.parse(JSON.stringify(evaluate(book, restored).state)), JSON.parse(JSON.stringify(result.state)));
  rerollFearWindowDie(restored, 0, roller(4, 2)); result = evaluate(book, restored);
  assert.equal(result.state.sanity, before.sanity); assert.equal(result.state.witchKnots?.used, 3);
  acceptFearWindowDie(restored); result = evaluate(book, restored);
  assert.equal(result.state.sanity, before.sanity - 2);
  assert.throws(() => rerollFearWindowDie(restored, 0, roller(6, 6)), /没有可用/);
  assert.throws(() => rerollFearWindowDie(restored, 4, roller(6, 6)), /已经公开/);
});
test("a lethal knot risk ends the run without executing the rejected die", () => {
  const { book, before, window } = eventFixture();
  before.sanity = 1; before.witchKnots = { total: 3, used: 1 }; window.before = structuredClone(before);
  evaluate(book, window); drawFearWindowDie(window, roller(2)); evaluate(book, window);
  rerollFearWindowDie(window, 0, roller(6, 1)); evaluate(book, window);
  acceptFearWindowDie(window); const result = evaluate(book, window);
  assert.equal(result.completed, true); assert.equal(result.state.status, "insane");
  assert.equal(result.state.sanity, 0); assert.equal(result.state.food, before.food);
});
test("rerolling an exploding six removes its extra die without reusing it as a later check", () => {
  const book = structuredClone(story), before = state();
  before.inventory["witch-knots-cord"] = 1; before.witchKnots = { total: 7, used: 0 };
  before.combat = { enemyId: "zombie", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 10, enemyLives: [10], enemyDamage: 1,
    damageResource: "hp", playerFirst: true, round: 1, weaponId: "knife", surprise: false, attackDisabled: false };
  const window = transaction(before, { type: "attack" });
  evaluate(book, window); drawFearWindowDie(window, roller(6)); evaluate(book, window);
  acceptFearWindowDie(window); evaluate(book, window);
  drawFearWindowDie(window, roller(4)); evaluate(book, window);
  rerollFearWindowDie(window, 0, roller(2, 6)); evaluate(book, window);
  acceptFearWindowDie(window); const result = evaluate(book, window);
  assert.equal(result.completed, true); assert.equal(result.state.combat?.enemyLife, 9);
  assert.equal(window.draws[1].accepted, false);
  assert.equal(result.state.witchKnots?.used, 1);
});

test("the printed one-die permission includes SAN risk dice without erasing knot costs", () => {
  const { book, before, window } = eventFixture();
  before.sanity = 1; before.witchKnots = { total: 4, used: 1 }; window.before = structuredClone(before);
  evaluate(book, window); drawFearWindowDie(window, roller(2)); evaluate(book, window);
  rerollFearWindowDie(window, 0, roller(3, 1)); let result = evaluate(book, window);
  assert.equal(result.state.status, "active"); assert.equal(result.state.sanity, 1);
  const riskIndex = window.visibleKeys.indexOf("risk:0"); assert.ok(riskIndex >= 0);
  rerollFearWindowDie(window, riskIndex, roller(6, 6)); evaluate(book, window);
  acceptFearWindowDie(window); result = evaluate(book, window);
  assert.equal(result.state.sanity, 1); assert.equal(result.state.witchKnots?.used, 3);
  assert.equal(window.risks.length, 2); assert.equal(window.risks[0].face, 6);
});
