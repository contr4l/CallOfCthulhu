import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeDodgePenalty,
  dodgePenaltyAfterDefense,
  firstAidHealLimit,
  occupiedBoxOnFlee,
  resolveFirstAid,
  resolveGarlicAvoidance,
  resolveOccupiedBoxRevisit,
  restoreBetweenMissions,
} from "../packages/engine/fear-general-rules.js";

test("first aid is only available after Life loss and is bounded by kit, medic level, missing Life, and charges", () => {
  const base = { hasKit: true, charges: 6, lifeLostThisEncounter: 2, currentLife: 5, maxLife: 8, medicLevel: 0 as const };
  assert.equal(firstAidHealLimit({ ...base, lifeLostThisEncounter: 0 }), 0);
  assert.equal(firstAidHealLimit({ ...base, hasKit: false }), 0);
  assert.equal(firstAidHealLimit(base), 1);
  assert.equal(firstAidHealLimit({ ...base, medicLevel: 1, charges: 2, lifeLostThisEncounter: 1 }), 2);
  assert.equal(firstAidHealLimit({ ...base, medicLevel: 1, charges: 2, lifeLostThisEncounter: 0 }), 0);
  assert.equal(firstAidHealLimit({ ...base, medicLevel: 2, currentLife: 7 }), 1);
  assert.deepEqual(resolveFirstAid({ ...base, medicLevel: 2 }, 2), { heal: 2, chargesSpent: 2 });
  assert.throws(() => resolveFirstAid(base, 2), /source limit/);
});

test("garlic is unavailable when surprised and each legal attempt consumes one head regardless of result", () => {
  assert.deepEqual(resolveGarlicAvoidance({ heads: 2, surprised: true, firstFace: 6, rollTotal: 6, vampireLevel: 5 }), { avoided: false, headsSpent: 0 });
  assert.deepEqual(resolveGarlicAvoidance({ heads: 0, surprised: false, firstFace: 6, rollTotal: 6, vampireLevel: 5 }), { avoided: false, headsSpent: 0 });
  assert.deepEqual(resolveGarlicAvoidance({ heads: 2, surprised: false, firstFace: 2, rollTotal: 4, vampireLevel: 5 }), { avoided: false, headsSpent: 1 });
  assert.deepEqual(resolveGarlicAvoidance({ heads: 2, surprised: false, firstFace: 2, rollTotal: 5, vampireLevel: 5 }), { avoided: true, headsSpent: 1 });
  // First face 6 auto-succeeds against any level; a first face 1 always fails despite an exploded total.
  assert.deepEqual(resolveGarlicAvoidance({ heads: 1, surprised: false, firstFace: 6, rollTotal: 6, vampireLevel: 12 }), { avoided: true, headsSpent: 1 });
  assert.deepEqual(resolveGarlicAvoidance({ heads: 1, surprised: false, firstFace: 1, rollTotal: 20, vampireLevel: 5 }), { avoided: false, headsSpent: 1 });
});

test("fled encounter remains in its box and a failed revisit resumes the exact snapshot", () => {
  const snapshot = { enemyId: "vampire", enemyLives: [3, 5], count: 2, defeatedCount: 1, round: 4 };
  const occupied = occupiedBoxOnFlee("vampire", snapshot);
  snapshot.enemyLives[0] = 99;
  assert.deepEqual(resolveOccupiedBoxRevisit(occupied, undefined), { kind: "stealth-check", encounter: { enemyId: "vampire", snapshot: { enemyId: "vampire", enemyLives: [3, 5], count: 2, defeatedCount: 1, round: 4 } } });
  assert.deepEqual(resolveOccupiedBoxRevisit(occupied, true), { kind: "avoid-this-entry", encounter: occupied });
  assert.deepEqual(resolveOccupiedBoxRevisit(occupied, false), { kind: "resume-encounter", encounter: occupied });
  assert.deepEqual(resolveOccupiedBoxRevisit(undefined, false), { kind: "empty" });
});

test("between-mission recovery restores current Life and Sanity to existing maxima only", () => {
  const state = { hp: 2, maxHp: 7, sanity: 1, maxSanity: 6, scars: ["scar"] };
  assert.deepEqual(restoreBetweenMissions(state), { ...state, hp: 7, sanity: 6 });
  assert.deepEqual(state, { hp: 2, maxHp: 7, sanity: 1, maxSanity: 6, scars: ["scar"] });
});

test("Dodge natural 1 installs a one-shot -1 attack penalty; Agile and other defense sources do not", () => {
  assert.equal(dodgePenaltyAfterDefense({ defenseRoll: 1, dodgeLevel: 1, defenseSource: "dodge" }), -1);
  assert.equal(dodgePenaltyAfterDefense({ defenseRoll: 1, dodgeLevel: 2, defenseSource: "dodge" }), -1);
  assert.equal(dodgePenaltyAfterDefense({ defenseRoll: 1, dodgeLevel: 1, defenseSource: "agile" }), 0);
  assert.equal(dodgePenaltyAfterDefense({ defenseRoll: 2, dodgeLevel: 2, defenseSource: "dodge" }), 0);
  assert.deepEqual(consumeDodgePenalty(-1), { penalty: -1 });
  assert.deepEqual(consumeDodgePenalty(undefined), { penalty: 0 });
});
