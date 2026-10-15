import assert from "node:assert/strict";
import test from "node:test";
import type { CheckResult, Character } from "../packages/contracts/index.js";
import {
  allocateFrostPartyDamage,
  applyFrostEnemyAction,
  applyFrostPartyAction,
  applyFrostPartyDamageAllocation,
  currentFrostEnemyTarget,
  projectFrostPartyCombat,
  startFrostPartyCombat,
  type FrostCombatant,
  type FrostPartyCombatSpec,
} from "../packages/engine/frost-combat.js";

function character(name: string, hp: number): Character {
  return { name, occupation: "调查员", hp, maxHp: hp, sanity: 60, luck: 50, skills: { fightingBrawl: 50, dodge: 40, firearmsRifleShotgun: 45 }, attributes: { dex: 50 } };
}
function check(success: boolean, skill = "fightingBrawl"): CheckResult {
  return { label: "测试检定", skill, target: 50, roll: success ? 20 : 90, candidates: [success ? 20 : 90], success, grade: success ? "regular" : "failure" };
}
function party(): FrostCombatant[] {
  return [
    { id: "$player", character: character("Nadelmann", 10), kind: "investigator", status: "present", unconscious: false },
    { id: "charlie", character: character("Charlie", 2), kind: "companion", status: "present", unconscious: false },
    { id: "norman", character: character("Norman", 2), kind: "companion", status: "present", unconscious: false },
  ];
}
function spec(overrides: Partial<FrostPartyCombatSpec> = {}): FrostPartyCombatSpec {
  return {
    sourceSection: "271",
    partyTurnOrder: ["$player", "charlie", "norman"],
    enemyTurnOrder: ["wolf"],
    enemies: [{ id: "wolf", name: "狼", hp: 5, maxHp: 5, skills: { fightingBrawl: 30 }, targetOrder: ["charlie", "$player", "norman"] }],
    protectedStudents: ["norman"],
    reviveCompanionsIfInvestigatorSurvives: true,
    ...overrides,
  };
}

test("Frost combat projects source-ordered party actions and records the actual performer", () => {
  const rules = spec();
  const started = startFrostPartyCombat(rules, party());
  assert.equal(projectFrostPartyCombat(rules, started).currentActorId, "$player");
  const after = applyFrostPartyAction(rules, started, { actorId: "$player", action: "attack", targetId: "wolf", check: check(true), damage: 2 });
  assert.equal(after.enemies[0].hp, 3);
  assert.deepEqual(after.events[0].check?.performer, { id: "$player", name: "Nadelmann" });
  assert.equal(projectFrostPartyCombat(rules, after).currentActorId, "charlie");
  assert.equal(JSON.parse(JSON.stringify(after)).events[0].check.grade, "regular");
});

test("incoming damage starts evenly, and Nadelmann can protect students without reducing non-students below the floor", () => {
  const members = party();
  const shares = allocateFrostPartyDamage(8, members, 1, ["norman"]);
  assert.deepEqual(shares, { "$player": 4, charlie: 3, norman: 1 });
  assert.throws(() => allocateFrostPartyDamage(8, members, 3, ["norman"]), /伤害下限/);
  assert.throws(() => allocateFrostPartyDamage(8, members, 1), /伤害下限/);
});

test("unconscious companions revive after a win without invented HP; source-fatal deaths stay dead", () => {
  const rules = spec({ fatalCompanions: ["charlie"] });
  let state = startFrostPartyCombat(rules, party());
  state = applyFrostPartyAction(rules, state, { actorId: "$player", action: "attack", targetId: "wolf", check: check(true), damage: 4 });
  state = applyFrostPartyAction(rules, state, { actorId: "charlie", action: "attack", targetId: "wolf", check: check(false), damage: 0 });
  state = applyFrostPartyAction(rules, state, { actorId: "norman", action: "attack", targetId: "wolf", check: check(false), damage: 0 });
  assert.equal(state.phase, "enemy");

  state = applyFrostEnemyAction(rules, state, { enemyId: "wolf", targetId: "charlie", check: check(true, "fightingBrawl"), damage: 12 });
  const projected = projectFrostPartyCombat(rules, state);
  assert.deepEqual(projected.damageInput, { total: 12, recipients: ["$player", "charlie", "norman"], minimumPerMember: 4, minimumByMember: { "$player": 4, charlie: 4, norman: 0 }, defaultShares: { "$player": 4, charlie: 4, norman: 4 }, playerExtraMax: 4 });
  state = applyFrostPartyDamageAllocation(rules, state, 1);
  assert.equal(state.party.find((actor) => actor.id === "$player")?.character.hp, 5);
  assert.equal(state.party.find((actor) => actor.id === "charlie")?.character.hp, 0);
  assert.equal(state.party.find((actor) => actor.id === "charlie")?.status, "dead");
  assert.equal(state.party.find((actor) => actor.id === "charlie")?.unconscious, false);
  assert.equal(state.party.find((actor) => actor.id === "norman")?.character.hp, 0);

  state = applyFrostPartyAction(rules, state, { actorId: "$player", action: "attack", targetId: "wolf", check: check(true), damage: 1 });
  assert.equal(state.outcome, "victory");
  assert.equal(state.party.find((actor) => actor.id === "charlie")?.status, "dead");
  assert.equal(state.party.find((actor) => actor.id === "charlie")?.unconscious, false);
  const norman = state.party.find((actor) => actor.id === "norman")!;
  assert.equal(norman.character.hp, 0);
  assert.equal(norman.status, "present");
  assert.equal(norman.unconscious, false);
});

test("party-turn order cannot be skipped and source-forbidden flight is rejected", () => {
  const rules = spec({ allowFlee: false });
  const state = startFrostPartyCombat(rules, party());
  assert.throws(() => applyFrostPartyAction(rules, state, { actorId: "charlie", action: "attack", targetId: "wolf", check: check(true), damage: 1 }), /现在不能行动/);
  assert.throws(() => applyFrostPartyAction(rules, state, { actorId: "$player", action: "flee" }), /来源未允许/);
});

test("source hit-count victory ends a variable group fight before all enemies are defeated", () => {
  const rules = spec({
    partyTurnOrder: ["$player", "$player"],
    enemyTurnOrder: ["hunter-1", "hunter-2", "hunter-3"],
    enemies: [
      { id: "hunter-1", name: "猎人1", hp: 1, maxHp: 1, skills: { firearmsRifleShotgun: 20 }, targetOrder: ["$player"] },
      { id: "hunter-2", name: "猎人2", hp: 1, maxHp: 1, skills: { firearmsRifleShotgun: 20 }, targetOrder: ["$player"] },
      { id: "hunter-3", name: "猎人3", hp: 1, maxHp: 1, skills: { firearmsRifleShotgun: 20 }, targetOrder: ["$player"] },
    ],
    victoryHitThreshold: 2,
  });
  let state = startFrostPartyCombat(rules, party());
  state = applyFrostPartyAction(rules, state, { actorId: "$player", action: "attack", targetId: "hunter-1", check: check(true), damage: 1 });
  assert.equal(state.outcome, undefined, "one hit is below the printed threshold");
  state = applyFrostPartyAction(rules, state, { actorId: "$player", action: "attack", targetId: "hunter-2", check: check(true), damage: 1 });
  assert.equal(state.outcome, "victory", "the combat ends once the source number of distinct hunters has been hit");
  assert.equal(state.enemies.filter((enemy) => enemy.hp <= 0).length, 2);
  assert.ok(state.enemies.some((enemy) => enemy.hp > 0), "the remaining hunters flee without being defeated");
});

test("enemy-first source encounters resolve the enemy round before opening party actions", () => {
  const rules = spec({ initiative: "enemy-first" });
  const initial = startFrostPartyCombat(rules, party());
  assert.equal(initial.phase, "enemy");
  assert.equal(projectFrostPartyCombat(rules, initial).currentEnemyId, "wolf");
  const after = applyFrostEnemyAction(rules, initial, { enemyId: "wolf", targetId: "charlie", check: check(false), damage: 5 });
  assert.equal(after.phase, "party");
  assert.equal(projectFrostPartyCombat(rules, after).currentActorId, "$player");
  assert.equal(after.round, 1);
  let state = after;
  for (const actorId of ["$player", "charlie", "norman"]) {
    state = applyFrostPartyAction(rules, state, { actorId, action: "attack", targetId: "wolf", check: check(false), damage: 0 });
  }
  assert.equal(state.phase, "enemy");
  assert.equal(state.round, 2);
  state = applyFrostEnemyAction(rules, state, { enemyId: "wolf", targetId: "charlie", check: check(false), damage: 5 });
  assert.equal(state.phase, "party");
  assert.equal(state.round, 2);
  for (const actorId of ["$player", "charlie", "norman"]) {
    state = applyFrostPartyAction(rules, state, { actorId, action: "attack", targetId: "wolf", check: check(false), damage: 0 });
  }
  assert.equal(state.phase, "enemy");
  assert.equal(state.round, 3);
});

test("recruited-state gates skip inactive companions and project the current source target", () => {
  const rules = spec({ partyTurnOrder: ["charlie", "$player", "norman"] });
  const members = party();
  members[1].active = false;
  let state = startFrostPartyCombat(rules, members);
  assert.equal(projectFrostPartyCombat(rules, state).currentActorId, "$player");
  state = applyFrostPartyAction(rules, state, { actorId: "$player", action: "attack", targetId: "wolf", check: check(false), damage: 0 });
  assert.equal(projectFrostPartyCombat(rules, state).currentActorId, "norman");
  for (const actorId of ["norman"]) {
    state = applyFrostPartyAction(rules, state, { actorId, action: "attack", targetId: "wolf", check: check(false), damage: 0 });
  }
  assert.equal(state.phase, "enemy");
  assert.equal(currentFrostEnemyTarget(rules, state)?.id, "$player");
  assert.equal(projectFrostPartyCombat(rules, state).currentEnemyTargetId, "$player");
});

test("repeated party actor IDs each receive one action in their recorded sequence position", () => {
  const rules = spec({ partyTurnOrder: ["$player", "charlie", "charlie", "norman"] });
  let state = startFrostPartyCombat(rules, party());
  const seen: string[] = [];
  for (const actorId of rules.partyTurnOrder) {
    assert.equal(projectFrostPartyCombat(rules, state).currentActorId, actorId);
    seen.push(actorId);
    state = applyFrostPartyAction(rules, state, { actorId, action: "attack", targetId: "wolf", check: check(false), damage: 0 });
  }
  assert.deepEqual(state.events.map((event) => event.actorId), seen);
  assert.equal(state.phase, "enemy");
});

test("enemy order skips dead enemies and does not repeat the next active enemy", () => {
  const rules = spec({
    initiative: "enemy-first",
    enemyTurnOrder: ["dead-wolf", "wolf", "wolf-two"],
    enemies: [
      { id: "dead-wolf", name: "倒下的狼", hp: 0, maxHp: 5, skills: { fightingBrawl: 30 } },
      { id: "wolf", name: "狼甲", hp: 5, maxHp: 5, skills: { fightingBrawl: 30 }, targetOrder: ["charlie", "$player"] },
      { id: "wolf-two", name: "狼乙", hp: 5, maxHp: 5, skills: { fightingBrawl: 30 }, targetOrder: ["charlie", "$player"] },
    ],
  });
  let state = startFrostPartyCombat(rules, party());
  assert.equal(projectFrostPartyCombat(rules, state).currentEnemyId, "wolf");
  state = applyFrostEnemyAction(rules, state, { enemyId: "wolf", targetId: "charlie", check: check(false), damage: 1 });
  assert.equal(projectFrostPartyCombat(rules, state).currentEnemyId, "wolf-two");
  state = applyFrostEnemyAction(rules, state, { enemyId: "wolf-two", targetId: "charlie", check: check(false), damage: 1 });
  assert.equal(state.phase, "party");
  assert.deepEqual(state.events.map((event) => event.actorId), ["wolf", "wolf-two"]);
});

test("target-only enemy damage does not spill to the rest of the party", () => {
  const rules = spec({ enemies: [{ id: "wolf", name: "狼", hp: 5, maxHp: 5, skills: { fightingBrawl: 30 }, targetOrder: ["charlie", "$player"], damageMode: "target" }] });
  let state = startFrostPartyCombat(rules, party());
  for (const actorId of ["$player", "charlie", "norman"]) {
    state = applyFrostPartyAction(rules, state, { actorId, action: "attack", targetId: "wolf", check: check(false), damage: 0 });
  }
  state = applyFrostEnemyAction(rules, state, { enemyId: "wolf", targetId: "charlie", check: check(true), damage: 2 });
  assert.deepEqual(projectFrostPartyCombat(rules, state).damageInput?.recipients, ["charlie"]);
  state = applyFrostPartyDamageAllocation(rules, state);
  assert.equal(state.party.find((actor) => actor.id === "charlie")?.character.hp, 0);
  assert.equal(state.party.find((actor) => actor.id === "$player")?.character.hp, 10);
  assert.equal(state.party.find((actor) => actor.id === "norman")?.character.hp, 2);
});

test("source-defined flee threshold ends the encounter immediately", () => {
  const rules = spec({ enemies: [{ id: "wolf", name: "狼", hp: 5, maxHp: 5, stopAtHp: 2, skills: { fightingBrawl: 30 } }] });
  const state = startFrostPartyCombat(rules, party());
  const after = applyFrostPartyAction(rules, state, { actorId: "$player", action: "attack", targetId: "wolf", check: check(true), damage: 3 });
  assert.equal(after.enemies[0].hp, 2);
  assert.equal(after.outcome, "victory");
  assert.equal(after.phase, "finished");
});
