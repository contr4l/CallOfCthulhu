import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear, projectFear } from "../packages/engine/fear.js";

const definition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
const sourceStory = JSON.parse(readFileSync("work/alone-against-fear/reviewed-story.json", "utf8")) as { nodes: { id: string }[] };
const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: sourceStory.nodes, fear: structuredClone(definition) };
function roller(...faces: number[]): FearDice { let index = 0; return () => faces[index++] ?? 1; }
function activeState(): FearState {
  const initial = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, startBox: 1, weaponIds: ["knife"], weaponId: "knife" }, roller(1));
  const current = advanceFear(story, initial, { type: "choose", choice: "s1:b1" }, roller(1));
  current.pendingEvent = undefined;
  return current;
}
function combat(enemyId: string, level: number, lives: number[], weaponId = "raygun"): FearState["combat"] {
  return { enemyId, count: lives.length, defeatedCount: 0, enemyLevel: level, enemyLife: lives[0] ?? 0,
    enemyLives: [...lives], enemyDamage: 0, damageResource: "hp", round: 1, playerFirst: true,
    surprise: false, weaponId, attackDisabled: false };
}

test("public attack applies raygun's shadow damage against a non-alien enemy and preserves it in the saved state", () => {
  const localStory = structuredClone(story);
  localStory.fear.enemies["runtime-shadow"] = { label: "测试影怪", level: 2, life: 8, damage: 0, tags: ["shadow"] };
  const current = activeState();
  current.weaponIds = ["raygun", "knife"];
  current.weaponId = "raygun";
  current.rayguns = { owned: 1, broken: 0 };
  current.combat = combat("runtime-shadow", 2, [8]);

  const attack = availableFearActions(localStory, current).find(({ action }) => action.type === "attack")?.action;
  assert.ok(attack);
  const after = advanceFear(localStory, current, attack, roller(2));
  assert.deepEqual(after.combat?.enemyLives, [6]);
  assert.equal(projectFear(localStory, after).combat?.enemyLives[0], 6);
  const restored = JSON.parse(JSON.stringify(after)) as FearState;
  assert.deepEqual(restored.rayguns, { owned: 1, broken: 0 });
  const defend = availableFearActions(localStory, restored).find(({ action }) => action.type === "defend")?.action;
  assert.ok(defend);
  const nextRound = advanceFear(localStory, restored, defend, roller(6));
  assert.equal(availableFearActions(localStory, nextRound).some(({ action }) => action.type === "attack"), true);
});

test("public attack on an unrelated enemy breaks one raygun at natural 1; a spare remains usable and a second break disables it", () => {
  const localStory = structuredClone(story);
  localStory.fear.enemies["runtime-target"] = { label: "测试敌人", level: 5, life: 8, damage: 0 };
  const current = activeState();
  current.weaponIds = ["raygun", "knife"];
  current.weaponId = "raygun";
  current.rayguns = { owned: 2, broken: 0 };
  current.combat = combat("runtime-target", 5, [8]);

  const attack = availableFearActions(localStory, current).find(({ action }) => action.type === "attack")?.action;
  assert.ok(attack);
  let after = advanceFear(localStory, current, attack, roller(1));
  assert.deepEqual(after.rayguns, { owned: 2, broken: 1 });
  after = JSON.parse(JSON.stringify(after)) as FearState;
  const defend = availableFearActions(localStory, after).find(({ action }) => action.type === "defend")?.action;
  assert.ok(defend);
  after = advanceFear(localStory, after, defend, roller(6));
  const nextAttack = availableFearActions(localStory, after).find(({ action }) => action.type === "attack")?.action;
  assert.ok(nextAttack, "one undamaged instance remains usable after a save/restore round trip");
  after = advanceFear(localStory, after, nextAttack, roller(1));
  assert.deepEqual(after.rayguns, { owned: 2, broken: 2 });
  const nextDefend = availableFearActions(localStory, after).find(({ action }) => action.type === "defend")?.action;
  assert.ok(nextDefend);
  after = advanceFear(localStory, after, nextDefend, roller(6));
  assert.equal(availableFearActions(localStory, after).some(({ action }) => action.type === "attack"), false);
  assert.ok(availableFearActions(localStory, after).some(({ action }) => action.type === "switch-weapon" && action.weapon === "knife"));
});

test("public gray-alien victory keeps a raygun pickup pending at full capacity, then grants exactly the picked-up gun after a discard", () => {
  const current = activeState();
  current.weaponIds = ["knife"];
  current.weaponId = "knife";
  current.inventory = { candles: 9 };
  current.combat = combat("aliens-1", 4, [1], "knife");
  const attack = availableFearActions(story, current).find(({ action }) => action.type === "attack")?.action;
  assert.ok(attack);
  let after = advanceFear(story, current, attack, roller(6, 1));
  assert.equal(after.pending?.kind, "carry-capacity");
  assert.deepEqual(after.rayguns, { owned: 0, broken: 0 }, "the unaccepted drop is not silently added to inventory");
  assert.ok(after.pending?.options.includes("discard-item:candles"));

  after = advanceFear(story, after, { type: "choose", choice: "discard-item:candles" }, roller(1));
  assert.deepEqual(after.rayguns, { owned: 1, broken: 0 });
  assert.equal(after.inventory.candles, 8);
  assert.ok(after.weaponIds.includes("raygun"));
  assert.equal(after.rayguns?.owned! - after.rayguns?.broken!, 1, "the picked-up raygun is usable once the unrelated source choice is resolved");
  assert.equal(projectFear(story, after).itemCapacity, 10);
  assert.equal(projectFear(story, after).foodCapacity, 10);
});

test("public victory grants one raygun per defeated gray alien rather than squaring the loot count", () => {
  const localStory = structuredClone(story);
  localStory.fear.enemies["aliens-1"].level = 1;
  const current = activeState();
  current.weaponIds = ["knife"];
  current.weaponId = "knife";
  current.combat = combat("aliens-1", 1, [1, 1], "knife");
  const attack = availableFearActions(localStory, current).find(({ action }) => action.type === "attack")?.action;
  assert.ok(attack);
  const after = advanceFear(localStory, current, attack, roller(6, 1));
  assert.equal(after.combat, undefined);
  assert.deepEqual(after.rayguns, { owned: 2, broken: 0 });
  assert.equal(projectFear(localStory, after).itemCapacity, 10);
});

