import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const definition = readJson("work/alone-against-fear/reviewed-definition.json") as FearDefinition;
const reviewed = readJson("work/alone-against-fear/reviewed-story.json");
const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: reviewed.nodes.map((node: { id: string }) => ({ id: node.id })), fear: structuredClone(definition) };
story.fear.rules.startingEquipmentTables = undefined;

function roller(...faces: number[]): FearDice {
  let index = 0;
  return () => faces[index++] ?? 1;
}
function start() {
  const initial = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1", weaponIds: ["unarmed"], weaponId: "unarmed", ammo: {} }, roller(1));
  return advanceFear(story, initial, { type: "choose", choice: "s1:b1" }, roller());
}
function sourceTable(state: FearState, tableId: string, dice: FearDice) {
  story.fear.eventPrograms["42"] = [{ op: "roll-table", tableId }];
  state.pendingEvent = { eventId: "42", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  return advanceFear(story, state, { type: "resolve-event", target: "42" }, dice);
}
function choose(state: FearState, choice: string, dice: FearDice = roller()) {
  const action = availableFearActions(story, state).find(({ action }) => action.type === "choose" && action.choice === choice);
  assert.ok(action, `public action for ${choice} is available; pending=${state.pending?.kind}`);
  return advanceFear(story, state, action!.action, dice);
}

test("D66 Salt row grants six weightless doses and Food row exposes an exact one-for-one conversion", () => {
  let state = sourceTable(start(), "random-objects", roller(1, 6)); // 16 Salt
  assert.equal(state.inventory.salt, 6);
  assert.equal(story.fear.items?.salt?.weightless, true);
  state = sourceTable(start(), "random-objects", roller(3, 3, 4)); // 33 Food, D6=4
  assert.equal(state.food, 1, "new Food remains pending until the optional conversion is decided");
  assert.equal(state.pending?.kind, "food-to-salt");
  state = choose(state, "2");
  assert.equal(state.inventory.salt, 2);
  assert.equal(state.food, 3);
  assert.equal(state.pending, undefined);
});

test("Worship grants an optional weightless symbol per actual visit and suppresses duplicate table hooks for one visit", () => {
  let state = sourceTable(start(), "worship", roller(3));
  assert.equal(state.currentBoxId, "s1:b1");
  assert.equal(state.pending?.kind, "choose-reward");
  state = choose(state, "silver-crucifix");
  assert.equal(state.inventory["silver-crucifix"], 1);
  assert.equal(story.fear.items?.["holy-symbol"]?.weightless, true);
  assert.equal(state.pending?.kind, "worship-symbol-visit");
  state = choose(state, "take");
  assert.equal(state.inventory["holy-symbol"], 1);

  // Resolving another Worship result inside the same entered-box visit must not queue another pickup.
  state = sourceTable(state, "worship", roller(3));
  assert.equal(state.pending?.kind, "choose-reward");
  state = choose(state, "silver-crucifix");
  assert.equal(state.pending, undefined, JSON.stringify({ queued: state.pendingWorshipSymbols, visitCount: state.visitCount, markers: Object.keys(state.missionProgress).filter(k => k.includes("worship-symbol")), pendingEvent: state.pendingEvent }));
  assert.equal(state.inventory["holy-symbol"], 1);

  const moveOut = availableFearActions(story, state).find(({ action }) => action.type === "move" && action.target === "s1:b2");
  assert.ok(moveOut);
  state = advanceFear(story, state, moveOut!.action, roller(6, 6, 6));
  if (state.pending?.kind === "fear-hangman-loot") state = choose(state, "useful-stuff", roller(6));
  const moveBack = availableFearActions(story, state).find(({ action }) => action.type === "move" && action.target === "s1:b1");
  assert.ok(moveBack, JSON.stringify({ currentBoxId: state.currentBoxId, pending: state.pending, actions: availableFearActions(story, state).map(action => action.label) }));
  state = advanceFear(story, state, moveBack!.action, roller(6, 6, 6));
  if (state.pendingEvent) {
    story.fear.eventPrograms[state.pendingEvent.eventId] = [];
    state = advanceFear(story, state, { type: "resolve-event", target: state.pendingEvent.eventId }, roller());
  }
  assert.equal(state.pending?.kind, "worship-symbol-visit", JSON.stringify({ pending: state.pending, queued: state.pendingWorshipSymbols, pendingEvent: state.pendingEvent, combat: state.combat, currentBox: state.currentBoxId, box: state.mapSheets.flatMap(s => s.boxes).find(b => b.id === "s1:b1"), visitCount: state.visitCount }));
  state = choose(state, "leave");
  assert.equal(state.inventory["holy-symbol"], 1);
});

test("Random Objects 45 accepts book-table 2; 61 persists 2/12 rerolls and grants one book without a wrapper item", () => {
  let state = sourceTable(start(), "random-objects", roller(4, 5, 1, 1)); // 45 then Random Books 2
  assert.equal(state.pending?.kind, undefined);
  assert.equal(state.inventory.necronomicon, 1);
  assert.equal(state.bookSources?.necronomicon, "random-book");
  assert.equal(state.inventory["random-book"], undefined);

  state = sourceTable(start(), "random-objects", roller(6, 1, 1, 1)); // 61 then Computer Print-out book result 2
  assert.equal(state.pending?.kind, "random-book-reroll");
  assert.deepEqual(state.pending?.options, ["continue"]);
  assert.match(String(state.pending?.data?.prompt), /掷出2/);
  assert.equal(state.inventory["computer-printout"], undefined);
  state = choose(state, "continue", roller(6, 6)); // next 2D6 result 12, still reroll
  assert.equal(state.pending?.kind, "random-book-reroll");
  assert.match(String(state.pending?.data?.prompt), /掷出12/);
  state = choose(state, "continue", roller(3, 4)); // 7: Exorcism Ritual book
  assert.equal(state.pending?.kind, undefined);
  assert.equal(state.inventory["exorcism-ritual-book"], 1);
  assert.equal(state.bookSources?.["exorcism-ritual-book"], "computer-printout");
  assert.equal(state.inventory["computer-printout"], undefined);
});
