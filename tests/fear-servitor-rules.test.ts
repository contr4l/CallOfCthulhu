import test from "node:test";
import assert from "node:assert/strict";
import { canLearnServitor, canStartServitor, startServitorRitual, servitorRitualCheck, resolveServitorMagic, resolveServitorControl, damageServitor, dismissServitor, servitorAttackRecipients, type ServitorState } from "../packages/engine/fear-servitor.js";
const state = (): ServitorState => ({ life: 8, sanity: 8, candles: 6, elapsedTime: 2 });
const ritual = (s = state()) => ({ state: s, learned: true, hasBell: true, hasRitualDagger: true, pentagramActive: false, sacrifice: "candles" as const, level: 4 as const });
test("servitor learning requires two XP and the source book/Occultist combination", () => {
  const base = { xp: 2, occultist: 0 as const, readNecronomicon: false, readOccultGuide: false, readDiabolicalDeal: false };
  assert.equal(canLearnServitor(base), false);
  assert.equal(canLearnServitor({ ...base, readNecronomicon: true }), true);
  assert.equal(canLearnServitor({ ...base, readOccultGuide: true, occultist: 1 }), false);
  assert.equal(canLearnServitor({ ...base, readOccultGuide: true, occultist: 2 }), true);
  assert.equal(canLearnServitor({ ...base, readDiabolicalDeal: true, occultist: 1 }), true);
  assert.equal(canLearnServitor({ ...base, xp: 1, readNecronomicon: true }), false);
});
test("each attempt pays its sacrifice and one time box; failure costs Sanity and can retry", () => {
  const original = state(), first = startServitorRitual(ritual(original));
  assert.deepEqual(original, state());
  assert.equal(first.candles, 1); assert.equal(first.elapsedTime, 3);
  assert.deepEqual(servitorRitualCheck(first, 2), { kind: "magic", level: 4, bonus: 2 });
  const failed = resolveServitorMagic(first, false);
  assert.equal(failed.sanity, 7); assert.equal(failed.ritual, undefined);
  assert.equal(canStartServitor(ritual(failed)), false);
  const again = startServitorRitual({ ...ritual(failed), sacrifice: "life", level: 6 });
  assert.equal(again.life, 6); assert.equal(again.elapsedTime, 4);
  const controlled = resolveServitorControl(resolveServitorMagic(again, true), true).state;
  assert.deepEqual(controlled.servitor, { level: 6, life: 6, maxLife: 6, attackBonus: 3, defenseBonus: 3 });
});
test("components and Pentagram block summoning, and only one living servitor is allowed", () => {
  for (const patch of [{ learned: false }, { hasBell: false }, { hasRitualDagger: false }, { pentagramActive: true }]) assert.equal(canStartServitor({ ...ritual(), ...patch }), false);
  const controlled = resolveServitorControl(resolveServitorMagic(startServitorRitual(ritual()), true), true).state;
  assert.equal(canStartServitor({ ...ritual(controlled), sacrifice: "life" }), false);
  assert.equal(canStartServitor({ ...ritual(dismissServitor(controlled)), sacrifice: "life" }), true);
});
test("failed control produces the printed hostile profile with no escape, without inventing a loss", () => {
  const pending = resolveServitorMagic(startServitorRitual(ritual()), true);
  assert.deepEqual(servitorRitualCheck(pending, 1), { kind: "will", level: 4, bonus: 1 });
  const failed = resolveServitorControl(pending, false);
  assert.deepEqual(failed.hostile, { level: 4, life: 4, damage: 1, cannotEscape: true });
  assert.equal(failed.state.sanity, 8); assert.equal(failed.state.servitor, undefined);
  assert.throws(() => resolveServitorControl(failed.state, true));
});
test("servitor absorbs single-enemy attacks and multiple enemies split evenly; zero Life disappears", () => {
  assert.deepEqual(servitorAttackRecipients(1, true), ["servitor"]);
  for (let n = 2; n <= 10; n++) {
    const targets = servitorAttackRecipients(n, true), count = targets.filter(x => x === "servitor").length;
    assert.ok(Math.abs(count - (n - count)) <= 1);
  }
  assert.deepEqual(servitorAttackRecipients(2, false), ["player", "player"]);
  const controlled = resolveServitorControl(resolveServitorMagic(startServitorRitual(ritual()), true), true).state;
  assert.equal(damageServitor(controlled, 3).servitor!.life, 1);
  assert.equal(damageServitor(controlled, 4).servitor, undefined);
  assert.equal(damageServitor(controlled, 10).life, controlled.life);
});
test("a lethal Life sacrifice cannot produce an extra check or revive the player", () => {
  const next = startServitorRitual({ ...ritual({ ...state(), life: 2 }), sacrifice: "life" });
  assert.equal(next.life, 0); assert.equal(next.ritual, undefined); assert.equal(next.elapsedTime, 3);
  assert.equal(canStartServitor(ritual(next)), false);
});
