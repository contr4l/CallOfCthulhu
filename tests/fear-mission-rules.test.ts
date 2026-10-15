import assert from "node:assert/strict";
import test from "node:test";
import {
  createFearMissionState,
  missionVictoryReady,
  selectFearMission,
  transitionFearMission,
  type FearMissionEvent,
  type FearMissionState,
} from "../packages/engine/fear-missions.js";

const make = (missionId: FearMissionState["missionId"], overrides: Partial<Parameters<typeof createFearMissionState>[0]> = {}) => createFearMissionState({
  missionId, startingBoxId: "start", ...(missionId === "3" ? { foodTargetRoll: [1, 1] as [number, number] } : {}),
  ...(missionId === "2" ? { huntTarget: { id: "slasher-a", level: 3 } } : {}),
  ...(missionId === "6" ? { gateFallbackRoll: 4 } : {}), ...overrides,
});
const step = (state: FearMissionState, event: FearMissionEvent) => transitionFearMission(state, event);

test("mission selection rerolls only the immediately previous mission until a different result", () => {
  assert.deepEqual(selectFearMission([2, 2, 5], "2"), { missionId: "5", rollsUsed: 3, rerollsRequired: false });
  assert.deepEqual(selectFearMission([3, 3], "3"), { rollsUsed: 2, rerollsRequired: true });
});

test("mission 1 finds medicine on the source-specific House/Lab and Clinic probabilities", () => {
  let state = make("1");
  state = step(state, { type: "medical-find-check", trigger: "house-or-lab-roll", face: 2 }).state;
  assert.equal(state.medical.dosesFound, 0);
  state = step(state, { type: "medical-find-check", trigger: "clinic-visit", face: 3 }).state;
  assert.equal(state.medical.dosesFound, 1);
  state = step(state, { type: "medical-find-check", trigger: "house-or-lab-roll", face: 1 }).state;
  assert.equal(state.medical.dosesFound, 2);
});

test("mission 1 fallback grants all three doses only after all 30 boxes and zero discoveries", () => {
  let state = make("1");
  const fallback = step(state, { type: "medical-all-boxes-visited", lastBoxId: "box-30", totalBoxes: 30 });
  state = fallback.state;
  assert.equal(state.medical.dosesFound, 3);
  assert.deepEqual(fallback.effects, [{ type: "discover-item", itemId: "medicine-dose", amount: 3 }]);
  assert.equal(step(state, { type: "medical-all-boxes-visited", lastBoxId: "box-30", totalBoxes: 30 }).effects.length, 0);
  const partial = step(make("1"), { type: "medical-find-check", trigger: "clinic-visit", face: 1 }).state;
  assert.equal(step(partial, { type: "medical-all-boxes-visited", lastBoxId: "box-30", totalBoxes: 30 }).state.medical.dosesFound, 1);
});

test("mission 1 rewards exactly once after returning to the start with three mission doses", () => {
  let state = make("1");
  state.medical.dosesFound = 3;
  const completed = step(state, { type: "mission-return", boxId: "start", safeHouse: false });
  assert.equal(completed.state.finished, true);
  assert.ok(completed.effects.some(effect => effect.type === "resource" && effect.key === "xp" && effect.amount === 3));
  assert.equal(step(completed.state, { type: "mission-return", boxId: "start", safeHouse: false }).handled, false);
});

test("mission 2 pays target-level clues, places target in next box, and matches random slasher on 4 of 6", () => {
  let state = make("2");
  const locate = step(state, { type: "hunt-locate", availableClues: 3 }); state = locate.state;
  assert.deepEqual(locate.effects, [{ type: "resource", key: "clues", amount: -3 }]);
  const encounter = step(state, { type: "hunt-next-box-entered", boxId: "next" });
  assert.deepEqual(encounter.effects, [{ type: "encounter-target", targetId: "slasher-a", surprise: false }]);
  assert.equal(step(state, { type: "random-slasher", face: 4, encounteredSlasherId: "other" }).effects[0]?.type, "encounter-target");
  assert.deepEqual(step(state, { type: "random-slasher", face: 5, encounteredSlasherId: "other" }).effects, [{ type: "encounter-target", targetId: "other", surprise: false }]);
});

test("mission 2 requires target defeat and valid return before explicit reward choice", () => {
  let state = make("2");
  assert.equal(step(state, { type: "mission-return", boxId: "safe", safeHouse: true }).handled, false);
  state = step(state, { type: "hunt-target-defeated", enemyId: "slasher-a" }).state;
  const home = step(state, { type: "mission-return", boxId: "safe", safeHouse: true }); state = home.state;
  assert.deepEqual(home.effects, [{ type: "reward-choice", choices: ["5-xp", "useful-stuff-2"] }]);
  const reward = step(state, { type: "mission-reward-choice", choice: "5-xp" });
  assert.equal(reward.state.finished, true);
  assert.ok(reward.effects.some(effect => effect.type === "resource" && effect.amount === 5));
});

test("mission 3 rolls 2D6+12, keeps cargo separate, and delivers for player-selected reward/backpack", () => {
  let state = make("3", { foodTargetRoll: [4, 5] });
  assert.equal(state.food.target, 21);
  state = step(state, { type: "food-location-visit", location: "street", face: 3, foodDie: 6 }).state;
  assert.equal(state.food.cargo, 6);
  assert.equal(step(state, { type: "food-location-visit", location: "farm", face: 4 }).state.food.cargo, 6);
  state.food.cargo = 21;
  const delivery = step(state, { type: "mission-return", boxId: "start", safeHouse: false });
  state = delivery.state;
  assert.ok(delivery.effects.some(effect => effect.type === "resource" && effect.key === "missionFood" && effect.amount === -21));
  const rewarded = step(state, { type: "mission-reward-choice", choice: "useful-stuff-3", keepBackpack: true });
  assert.equal(rewarded.state.finished, true);
  assert.equal(rewarded.state.food.backpackAccepted, true);
  assert.ok(rewarded.effects.some(effect => effect.type === "roll" && effect.count === 3 && !effect.chooseBest));
});

test("mission 4 adjustment only permits a changed result reaching Military or Store and caps XP at five", () => {
  const state = make("4");
  assert.equal(step(state, { type: "town-roll-adjustment", rawResult: 3, adjustment: 1, adjustedDestination: "street" }).handled, false);
  const adjusted = step(state, { type: "town-roll-adjustment", rawResult: 3, adjustment: -1, adjustedDestination: "store" });
  assert.deepEqual(adjusted.effects, [{ type: "town-roll", rawResult: 3, adjustedResult: 2 }]);
  const completed = step(state, { type: "weapons-return", boxId: "start", qualifyingFirearms: 7 });
  assert.equal(completed.state.finished, true);
  assert.ok(completed.effects.some(effect => effect.type === "resource" && effect.key === "xp" && effect.amount === 5));
});

test("mission 5 insufficient clues preserve ordinary box resolution", () => {
  const state = make("5");
  const transition = step(state, { type: "witch-find", boxId: "b2", availableClues: 1, investigator: false, investigatorExpert: false, clueSpend: 0, finalFiveLocation: false, dangerSenseLevel: 0 });
  assert.deepEqual(transition.effects, [{ type: "normal-box-content" }]);
});

test("mission 5 pays skill-adjusted clue costs and models restricted capture clue for only next witch", () => {
  let state = make("5");
  state = step(state, { type: "witch-defeated", witchId: "witch-1", capturedAlive: true }).state;
  assert.equal(state.witches.restrictedClues, 1);
  const duplicate = step(state, { type: "witch-defeated", witchId: "witch-1", capturedAlive: true });
  assert.equal(duplicate.handled, false);
  assert.equal(duplicate.state.witches.restrictedClues, 1);
  assert.equal(duplicate.effects.some(effect => effect.type === "resource" && effect.key === "clues"), false, "capture clue is never ordinary Clues");
  assert.equal(step(state, { type: "witch-capture", witchId: "witch-1" }).handled, false, "a captured witch cannot award the restricted clue twice");
  const found = step(state, { type: "witch-find", boxId: "b2", availableClues: 0, investigator: true, investigatorExpert: true, clueSpend: 0, finalFiveLocation: false, dangerSenseLevel: 0 });
  assert.equal(found.state.witches.restrictedClues, 0);
  assert.ok(found.effects.some(effect => effect.type === "restricted-witch-clue" && effect.amount === -1));
  assert.ok(found.effects.some(effect => effect.type === "encounter-target" && effect.enemy?.level === 4 && effect.enemy.life === 4));
  assert.ok(step(state, { type: "witch-find", boxId: "b2", availableClues: 0, investigator: true, investigatorExpert: false, clueSpend: 0, finalFiveLocation: false, dangerSenseLevel: 0 }).effects.some(effect => effect.type === "normal-box-content"));
});

test("mission 5 final-five surprise uses clue and supplied Danger Sense reductions without guessing its value", () => {
  const state = make("5");
  const resolved = step(state, { type: "witch-find", boxId: "b26", availableClues: 2, investigator: false, investigatorExpert: false, clueSpend: 2, finalFiveLocation: true, surpriseFace: 2, dangerSenseLevel: 0 });
  assert.equal(resolved.state.witches.lastSurpriseProbabilitySixths, 3);
  assert.ok(resolved.effects.some(effect => effect.type === "encounter-target" && effect.surprise));
  const basic = step(state, { type: "witch-find", boxId: "b26", availableClues: 0, investigator: false, investigatorExpert: false, clueSpend: 0, finalFiveLocation: true, surpriseFace: 5, dangerSenseLevel: 1 });
  assert.equal(basic.state.witches.lastSurpriseProbabilitySixths, 4);
  const expert = step(state, { type: "witch-find", boxId: "b26", availableClues: 0, investigator: false, investigatorExpert: false, clueSpend: 0, finalFiveLocation: true, surpriseFace: 4, dangerSenseLevel: 2 });
  assert.equal(expert.state.witches.lastSurpriseProbabilitySixths, 3);
  const zeroChance = step(state, { type: "witch-find", boxId: "b26", availableClues: 5, investigator: false, investigatorExpert: false, clueSpend: 5, finalFiveLocation: true, surpriseFace: 1, dangerSenseLevel: 0 });
  assert.equal(zeroChance.state.witches.lastSurpriseProbabilitySixths, 0);
  assert.equal(zeroChance.effects.some(effect => effect.type === "encounter-target" && effect.surprise), false);
});

test("mission 5 resolves one Will save each combat turn and source-specific fifth reward", () => {
  let state = make("5");
  const failedSave = step(state, { type: "witch-combat-turn", willSaveSucceeded: false });
  assert.ok(failedSave.effects.some(effect => effect.type === "will-save" && effect.level === 5));
  assert.ok(failedSave.effects.some(effect => effect.type === "resource" && effect.key === "sanity" && effect.amount === -1));
  for (let n = 1; n <= 5; n++) state = step(state, { type: "witch-defeated", witchId: `witch-${n}` }).state;
  assert.equal(state.witches.xp, 7);
  const duplicate = step(state, { type: "witch-defeated", witchId: "witch-5" });
  assert.equal(duplicate.handled, false);
  assert.equal(duplicate.state.witches.xp, 7);
  assert.equal(state.witches.pendingFinalItem, true);
  const item = step(state, { type: "witch-final-item", threeRollResults: ["a", "b", "c"], bestResult: "b" });
  assert.deepEqual(item.effects, [
    { type: "grant-item", itemId: "b" },
    { type: "mission-completed", missionId: "5" },
  ]);
  assert.equal(item.state.witches.finalItemResolved, true);
  assert.equal(item.state.finished, true, "mission ends on the fifth witch and final item; source does not require a return trip");
  assert.equal(step(item.state, { type: "witch-defeated", witchId: "six" }).handled, false);
});

test("mission 5 ends after the fifth defeat and final item without a return requirement", () => {
  let state = make("5");
  state.witches.defeated = 5; state.witches.pendingFinalItem = true;
  const afterFinalWitch = step(state, { type: "witch-final-item", threeRollResults: ["a", "b", "c"], bestResult: "b" });
  assert.equal(afterFinalWitch.state.finished, true);
});

test("mission 6 discovers first fallback after 12+D6, second at box 30, and preserves ambiguity after random discovery", () => {
  let state = make("6", { gateFallbackRoll: 3 });
  assert.equal(state.gates.fallbackThreshold, 15);
  assert.equal(step(state, { type: "hell-gate-box-check", visitedBoxCount: 14 }).effects.length, 0);
  const first = step(state, { type: "hell-gate-box-check", visitedBoxCount: 15 });
  state = first.state;
  assert.ok(first.effects.some(effect => effect.type === "discover-hell-gate" && effect.reason === "after-threshold"));
  const second = step(state, { type: "hell-gate-box-check", visitedBoxCount: 30 });
  assert.ok(second.effects.some(effect => effect.type === "discover-hell-gate" && effect.reason === "box-30"));

  let random = step(make("6", { gateFallbackRoll: 6 }), { type: "random-gate-found" }).state;
  const noThresholdGate = step(random, { type: "hell-gate-box-check", visitedBoxCount: 18 });
  assert.equal(noThresholdGate.state.gates.firstFallbackFound, false, "random discovery suppresses both automatic finds");
  const noExtra = step(random, { type: "hell-gate-box-check", visitedBoxCount: 30 });
  assert.equal(noExtra.state.gates.box30Found, false, "both automatic gates are conditioned on no random gate found");
});

test("seven gates win across missions; gate closure is an overlay while a side mission remains active", () => {
  let state = make("3", { gatesClosed: 6 });
  const finalGate = step(state, { type: "hell-gate-closed" }); state = finalGate.state;
  assert.equal(missionVictoryReady(state), true);
  assert.equal(state.campaign.won, true);
  assert.ok(finalGate.effects.some(effect => effect.type === "campaign-won"));
});

test("mission 6 completes on one newly closed gate without adding an invented return requirement", () => {
  const state = make("6", { gatesClosed: 2, gateFallbackRoll: 1 });
  const closed = step(state, { type: "hell-gate-closed" });
  assert.equal(closed.state.finished, true);
  assert.equal(closed.state.campaign.gatesClosed, 3);
});
