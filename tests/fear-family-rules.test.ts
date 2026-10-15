import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearState } from "../packages/contracts/fear.js";
import { FEAR_FAMILY_RULES, addFearRayguns, fearRaygunAdditionalCarrySlots, fearFamilyAttackBounceChance, fearFamilyAttackModifier, fearFamilyEnemyAttackCount, fearFamilyEnemyProfile, fearFamilyEscapeAllowed, fearFamilySkillModifier, fearFamilyWeaponDamage, fearFamilyWeaponUsable, handleFearFamilyAction, resolveFearFamilyRule, runFearFamilyRuleEvent } from "../packages/engine/fear-family-rules.js";

const definition = JSON.parse(await (await import("node:fs/promises")).readFile("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
function state(): FearState {
  return { missionProgress: {}, skills: {}, inventory: {}, maxHp: 8, hp: 8, sanity: 8, maxSanity: 8, log: [], mapLinks: {}, currentBoxId: "box" } as unknown as FearState;
}
function roller(...values: number[]) { let i = 0; return () => values[i++] ?? 1; }

test("family dispatcher is scoped to exactly the requested 17 enemy IDs and leaves others untouched", () => {
  assert.equal(Object.keys(FEAR_FAMILY_RULES).length, 17);
  assert.deepEqual(resolveFearFamilyRule({ definition, state: state(), event: { type: "combat-start", enemyId: "unique-vampires-1", count: 1 } }), []);
});

test("each implemented family ID resolves to its source paragraph in the original fragment", () => {
  const sets = [
    ["aliens", "section-aliens-table", 6],
    ["lab-horrors", "section-lab-horrors-table", 6],
    ["living-dolls", "section-living-dolls-table", 6],
  ] as const;
  for (const [table, fragment, expected] of sets) {
    const raw = JSON.parse(readFileSync(`scripts/alone-against-fear/fragments/${fragment}.json`, "utf8")) as { paragraphs: { id: string; text: string }[] };
    const entries = raw.paragraphs.filter(paragraph => paragraph.id.startsWith(`${fragment}:`));
    assert.equal(entries.filter(paragraph => /:p[1-6]$/.test(paragraph.id)).length, expected);
  }
  const alienText = readFileSync("scripts/alone-against-fear/fragments/section-aliens-table.json", "utf8");
  const labText = readFileSync("scripts/alone-against-fear/fragments/section-lab-horrors-table.json", "utf8");
  const dollText = readFileSync("scripts/alone-against-fear/fragments/section-living-dolls-table.json", "utf8");
  assert.match(alienText, /rayguns[\s\S]*damage 2 vs\. shadow creatures[\s\S]*gun stops working/);
  assert.match(labText, /Robot[\s\S]*immune to poison and magic[\s\S]*grenades will not bounce/);
  assert.match(dollText, /Vivina[\s\S]*roll d6[\s\S]*candle[\s\S]*bell/);
});

test("Mi-Go fear save repeats on each sighting, while tentacled horror fear save is once per campaign", () => {
  const s = state();
  const first = resolveFearFamilyRule({ definition, state: s, event: { type: "combat-start", enemyId: "aliens-5", count: 1 } });
  assert.deepEqual(first.map(x => x.type), ["roll-check"]);
  assert.deepEqual(resolveFearFamilyRule({ definition, state: { ...s, missionProgress: { "fear:family:mi-go:seen": true } }, event: { type: "combat-start", enemyId: "aliens-5", count: 1 } }).map(x => x.type), ["roll-check"]);
  const horror = resolveFearFamilyRule({ definition, state: s, event: { type: "combat-start", enemyId: "lab-horrors-5", count: 1 } });
  assert.ok(horror.some(x => x.type === "roll-check" && x.level === 3 && x.amount === 1));
});

test("source probabilities are boundary-tested and acid splash requires a wound and failed defense", () => {
  const s = state();
  assert.ok(resolveFearFamilyRule({ definition, state: s, event: { type: "attack-result", enemyId: "aliens-3", damage: 1, naturalFace: 3, weaponTags: [] }, rolls: [2] }).some(x => x.type === "combat-state" && x.patch.acidSplashPending));
  assert.deepEqual(resolveFearFamilyRule({ definition, state: s, event: { type: "attack-result", enemyId: "aliens-3", damage: 0, naturalFace: 3, weaponTags: [] }, rolls: [2] }), []);
  const splash = resolveFearFamilyRule({ definition, state: s, combat: { acidSplashPending: true }, event: { type: "defense-result", enemyId: "aliens-3", naturalFace: 2, failed: true } });
  assert.ok(splash.some(x => x.type === "damage" && x.amount === 1));
  assert.equal(resolveFearFamilyRule({ definition, state: s, combat: { acidSplashPending: true }, event: { type: "defense-result", enemyId: "aliens-3", naturalFace: 6, failed: false } }).some(x => x.type === "damage"), false);
  assert.throws(() => resolveFearFamilyRule({ definition, state: s, event: { type: "attack-result", enemyId: "aliens-3", damage: 1, naturalFace: 4, weaponTags: [] } }), /requires an explicit D6 roll/);
});

test("alien tentacles lock escape until fewer than three remain, and damage removes one per point", () => {
  assert.equal(fearFamilyEscapeAllowed("aliens-6", { tentacles: 3 }), false);
  assert.equal(fearFamilyEscapeAllowed("aliens-6", { tentacles: 2 }), true);
  const effects = resolveFearFamilyRule({ definition, state: state(), combat: { tentacles: 4 }, event: { type: "attack-result", enemyId: "aliens-6", damage: 2, naturalFace: 4, weaponTags: [] } });
  assert.ok(effects.some(x => x.type === "combat-state" && x.patch.tentacles === 2));
  assert.equal(fearFamilyEnemyAttackCount("aliens-6", { tentacles: 2 }), 2);
  assert.equal(fearFamilyEnemyAttackCount("lab-horrors-5"), 2);
});

test("Robot, insecticide, Mutant Hunter, and doll source branches expose exact checks and bonuses", () => {
  assert.ok(resolveFearFamilyRule({ definition, state: state(), event: { type: "player-choice", enemyId: "lab-horrors-2", choice: "disable-robot" } }).some(x => x.type === "roll-check" && x.context === "agile" && x.level === 4));
  assert.ok(resolveFearFamilyRule({ definition, state: state(), event: { type: "player-choice", enemyId: "lab-horrors-6", choice: "use-insecticide" } }).some(x => x.type === "damage" && x.amount === 2 && x.bypassBounce));
  const s = { ...state(), skills: { "mutant-hunter": 1 as const } };
  assert.equal(fearFamilySkillModifier(definition, s, "lab-horrors-3", "attack"), 1);
  assert.equal(fearFamilySkillModifier(definition, s, "lab-horrors-3", "defense"), 1);
  assert.equal(fearFamilyAttackModifier(definition, s, "lab-horrors-3", []), 1);
  assert.equal(fearFamilyAttackModifier(definition, state(), "living-dolls-6", ["fire"]), 1);
  assert.equal(fearFamilyWeaponDamage("slasher", ["raygun"], ["night-shadow"], 1), 2);
  assert.equal(fearFamilyWeaponDamage("alien-gray", ["raygun"], ["shadow"], 1), 2);
  assert.equal(fearFamilyWeaponDamage("slasher", ["raygun"], ["demon"], 1), 1);
  const legacy = { ...state(), weaponIds: ["raygun"], missionProgress: { "fear:family:raygun:broken": true } };
  assert.equal(fearFamilyWeaponUsable(legacy, "raygun"), false);
  assert.ok(resolveFearFamilyRule({ definition, state: state(), event: { type: "player-choice", enemyId: "living-dolls-1", choice: "offer-book" } }).some(x => x.type === "roll-check" && x.context === "charisma" && x.level === 3));
});

test("alien raygun natural 1 breaks only one owned raygun after any attack, including a zero-damage attack", () => {
  const s = { ...state(), weaponIds: [] };
  addFearRayguns(s, 1);
  addFearRayguns(s, 1);
  assert.equal(fearRaygunAdditionalCarrySlots(s), 1);
  assert.equal(fearFamilyWeaponUsable(s, "raygun"), true);
  const effects = runFearFamilyRuleEvent(definition, s, { type: "attack-result", enemyId: "zombie", damage: 0, naturalFace: 1, targetLifeAfter: 1, weaponId: "raygun", weaponTags: ["raygun"] }, roller(), () => 0);
  assert.ok(effects.some(x => x.type === "log" && x.text.includes("这把枪永久损坏")));
  assert.deepEqual(s.rayguns, { owned: 2, broken: 1 });
  assert.equal(fearFamilyWeaponUsable(s, "raygun"), true);
  runFearFamilyRuleEvent(definition, s, { type: "attack-result", enemyId: "slasher", damage: 0, naturalFace: 1, targetLifeAfter: 1, weaponId: "raygun", weaponTags: ["raygun"] }, roller(), () => 0);
  assert.deepEqual(s.rayguns, { owned: 2, broken: 2 });
  assert.equal(fearFamilyWeaponUsable(s, "raygun"), false);
  assert.equal(fearFamilyWeaponUsable(s, "knife"), true);
  addFearRayguns(s, 1);
  assert.deepEqual(s.rayguns, { owned: 3, broken: 2 });
  assert.equal(fearFamilyWeaponUsable(s, "raygun"), true);
  assert.ok(resolveFearFamilyRule({ definition, state: state(), event: { type: "attack-result", enemyId: "aliens-1", damage: 0, naturalFace: 1, weaponTags: ["knife"] } }).every(x => x.type !== "combat-state"));
  // null means the source explicitly exempts this weapon from Robot bounce; undefined means no override.
  assert.equal(fearFamilyAttackBounceChance("lab-horrors-2", ["one-use"], "grenade"), null);
  assert.deepEqual(fearFamilyAttackBounceChance("lab-horrors-2", []), [3, 6]);
  // Insecticide is resolved as its own automatic-damage effect with bypassBounce;
  // this ordinary-attack override helper therefore has no value for that action.
  assert.equal(fearFamilyAttackBounceChance("lab-horrors-6", ["insecticide"]), undefined);
});

test("runtime facade executes a source D6 fear save for each Mi-Go sighting", () => {
  const s = { ...state(), combat: { enemyId: "aliens-5", enemyLives: [1], enemyLevel: 5, playerFirst: true, familyState: {} } } as FearState;
  // The facade emits the loss for the central Mental-Scar dispatcher instead of deducting inline.
  const first = runFearFamilyRuleEvent(definition, s, { type: "combat-start", enemyId: "aliens-5", count: 1, surprised: false }, roller(1), () => 0);
  assert.equal(s.sanity, 8);
  assert.ok(first.some(x => x.type === "sanity" && x.amount === 1), "the failed sighting Fear save emits a 1-point Sanity effect");
  assert.equal(s.missionProgress["fear:family:mi-go:seen"], undefined);
  const second = runFearFamilyRuleEvent(definition, s, { type: "combat-start", enemyId: "aliens-5", count: 1, surprised: false }, roller(1), () => 0);
  assert.ok(second.some(x => x.type === "sanity" && x.amount === 1), "every sighting repeats the save and its loss");
});

test("family check records the exploding die after a natural six while retaining the automatic success", () => {
  const s = { ...state(), combat: { enemyId: "aliens-5", enemyLives: [1], enemyLevel: 5, playerFirst: true, familyState: {} } } as FearState;
  runFearFamilyRuleEvent(definition, s, { type: "combat-start", enemyId: "aliens-5", count: 1, surprised: false }, roller(6, 2), () => 0);
  assert.equal(s.sanity, 8);
  assert.ok(s.log.some((line) => line.includes("L5 fear-save：6+2 + 0 => 8（成功）")));
});

test("family probability rolls consume the source-mandated extra die after a six", () => {
  const s = { ...state(), combat: { enemyId: "lab-horrors-3", enemyLives: [6], enemyLevel: 4, playerFirst: true, familyState: {} } } as FearState;
  let calls = 0;
  const values = [6, 2];
  runFearFamilyRuleEvent(definition, s, { type: "combat-start", enemyId: "lab-horrors-3", count: 1, surprised: false }, () => values[calls++] ?? 1, () => 0);
  assert.equal(calls, 2);
  // The 2-in-6 result uses the first die; the extra die exists for the universal explosion rule only.
  assert.equal(s.combat?.familyState?.psionic, false);
});

test("runtime facade starts Mutant powers once, applies one Sanity loss per turn, and returns all separate tentacle defenses", () => {
  const s = { ...state(), combat: { enemyId: "lab-horrors-3", enemyLives: [6], enemyLevel: 4, playerFirst: true, familyState: {} } } as FearState;
  runFearFamilyRuleEvent(definition, s, { type: "combat-start", enemyId: "lab-horrors-3", count: 1, surprised: false }, roller(2), () => 0);
  assert.equal(s.combat?.familyState?.psionic, true);
  const psionics = runFearFamilyRuleEvent(definition, s, { type: "enemy-turn", enemyId: "lab-horrors-3", round: 1 }, roller(1), () => 0);
  assert.ok(psionics.some(x => x.type === "sanity" && x.amount === 1), "the failed psionics save emits a 1-point Sanity effect");
  assert.equal(s.sanity, 8, "the facade defers the psionics loss to the central Mental-Scar dispatcher");
  s.combat!.enemyId = "aliens-6";
  const tentacles = runFearFamilyRuleEvent(definition, s, { type: "combat-start", enemyId: "aliens-6", count: 1, surprised: false }, roller(), () => 0);
  assert.equal(s.combat?.familyState?.tentacles, 4);
  const attacks = runFearFamilyRuleEvent(definition, s, { type: "enemy-turn", enemyId: "aliens-6", round: 1 }, roller(), () => 0);
  assert.equal(attacks.find(x => x.type === "attack-count")?.type, "attack-count");
});

test("Blob retreat persists stronger return profile and Maraya heals non-fire damage on a return", () => {
  const s = state();
  runFearFamilyRuleEvent(definition, s, { type: "combat-end", enemyId: "lab-horrors-1", outcome: "escaped" }, roller(), () => 0);
  assert.equal(s.missionProgress["fear:family:blob:escaped"], true);
  assert.deepEqual(fearFamilyEnemyProfile(s, "lab-horrors-1"), { level: 5, life: 10, slow: false });
  s.missionProgress["fear:family:maraya:life"] = 7;
  assert.deepEqual(fearFamilyEnemyProfile(s, "living-dolls-4"), { life: 7 });
});

test("two Maraya eye stabs end the adventure, while one imposes the source attack penalty", () => {
  const s = state();
  s.combat = { enemyId: "living-dolls-4", enemyLives: [12], enemyLevel: 4, playerFirst: true, familyState: {} } as FearState["combat"];
  runFearFamilyRuleEvent(definition, s, { type: "defense-result", enemyId: "living-dolls-4", naturalFace: 1, failed: true }, roller(), () => 0);
  assert.equal(fearFamilyAttackModifier(definition, s, "living-dolls-4", []), -1);
  runFearFamilyRuleEvent(definition, s, { type: "defense-result", enemyId: "living-dolls-4", naturalFace: 1, failed: true }, roller(), () => 0);
  assert.equal(s.status, "dead");
});

test("Vivina offering consumes the random requested object only on acceptance and failed Charisma starts combat", () => {
  const s = state(); s.inventory.candle = 1;
  s.combat = { enemyId: "living-dolls-1", enemyLives: [4], enemyLevel: 5, playerFirst: true, familyState: {} } as FearState["combat"];
  const offer = handleFearFamilyAction(definition, s, "family:vivina-offer", roller(1), () => 0);
  assert.equal(offer.pending?.data?.requestedItem, "candle");
  const accepted = handleFearFamilyAction(definition, s, "family:vivina-give", roller(1), () => 0);
  assert.equal(accepted.handled, true);
  assert.equal(s.inventory.candle, undefined);
  assert.equal(s.combat?.playerFirst, false);
});

test("failed robot disable sets exactly one automatic-hit marker, consumed by the next defense hook", () => {
  const s = state();
  s.combat = { enemyId: "lab-horrors-2", enemyLives: [5], enemyLevel: 3, playerFirst: true, familyState: {} } as FearState["combat"];
  handleFearFamilyAction(definition, s, "family:disable-robot", roller(1), () => 0);
  assert.equal(s.combat?.familyState?.robotAutoHitNext, true);
  const event = runFearFamilyRuleEvent(definition, s, { type: "defense-result", enemyId: "lab-horrors-2", naturalFace: 6, failed: false }, roller(), () => 0);
  assert.ok(event.some(x => x.type === "auto-hit"));
  assert.equal(s.combat?.familyState?.robotAutoHitNext, false);
});
