import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  fearClownBounce, fearEntryReroutesToBeasts, fearNaturalOneSucceeds, fearStorePickupEncounterPending,
  resolveFearTableRule,
} from "../packages/engine/fear-table-rules.js";
import type { FearTableEntry } from "../packages/contracts/fear.js";


const sourceText = (fragment: string, paragraphId: string) => {
  const doc = JSON.parse(readFileSync(resolve(`scripts/alone-against-fear/fragments/${fragment}.json`), "utf8"));
  return doc.paragraphs.find((p: { id: string }) => p.id === paragraphId)?.text as string;
};

const definition = JSON.parse(readFileSync(resolve("work/alone-against-fear/reviewed-definition.json"), "utf8"));
const story = { fear: definition } as any;
const state = { missionProgress: {}, inventory: {}, uniqueEventsPlayed: [], defeated: [], mapSheets: [] } as any;
const entry = (table: string, roll: number) => definition.tables[table].entries.find((row: FearTableEntry) => row.roll === roll) as FearTableEntry;
const effects = (table: string, roll: number) => resolveFearTableRule(story, state, table, entry(table, roll), (() => 1) as any).effects;
const effect = (table: string, roll: number, type: string) => effects(table, roll).find((x: any) => x.type === type) as any;

test("store armory recipe preserves 4/6 encounter and D6 chosen ammo while delegating per-weapon 1/6 discovery", () => {
  const armory = entry("store", 3);
  assert.equal(armory.operations?.[0].op, "probability");
  assert.equal((armory.operations?.[0] as any).numerator, 4);
  assert.equal(armory.operations?.[1].op, "choose-effect");
  assert.equal(armory.operations?.some((op: any) => op.tableId === "random-weapon"), false);
  const search = effect("store", 3, "per-eligible-weapon-search");
  assert.equal(search.type, "per-eligible-weapon-search");
  assert.deepEqual(search.chance, [1, 6]);
  assert.ok(search.weaponIds.includes("knife"));
  assert.ok(!search.weaponIds.includes("antique-flail"));
  assert.ok(!search.weaponIds.includes("scythe-shovel"));
  assert.ok(!search.weaponIds.includes("chainsaw"));
  assert.ok(search.ammoWeaponIds.includes("shotgun"));
  assert.equal(search.ammo, "2D6");
});

test("store bookstore performs a 3/6 encounter check after any book-finding attempt", () => {
  assert.match(sourceText("section-store-table", "section-store-table:p4"), /If you roll to find\s+any books, you must also roll a 3 in 6 chance/i);
  assert.deepEqual(effect("store", 5, "after-bookstore-search-encounter"), {
    type: "after-bookstore-search-encounter", chance: [3, 6], tableId: "store-book-encounter",
  });
  assert.equal(JSON.stringify(entry("store", 5).operations).includes("store-book-encounter"), false);
});

test("hardware store rolls its encounter chance once and waits until pickup", () => {
  const plan = resolveFearTableRule(story, state, "store", entry("store", 6), (() => 1) as any);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(effect("store", 6, "hardware-store-search"), {
    type: "hardware-store-search", items: [
      { itemId: "hammer", chance: [3, 6] }, { itemId: "shotgun", chance: [4, 6], ammo: "D6" },
      { itemId: "knife", chance: [5, 6] }, { itemId: "insecticide", chance: [1, 6] }, { itemId: "axe", chance: [3, 6] },
    ], encounterChance: [2, 6], encounterTable: "store-hardware-encounter", trigger: "first-pickup",
  });
  assert.equal(fearStorePickupEncounterPending(true, 2), true);
  assert.equal(fearStorePickupEncounterPending(false, 1), false);
});

test("sewer giant rat plan includes fire avoidance, rat poison cost/damage, natural-one infection and cures", () => {
  assert.deepEqual(effect("sewers", 2, "sewer-rat-rules"), {
    type: "sewer-rat-rules", fireItems: ["torch", "lighter", "molotov-cocktail"], poisonItem: "rat-poison", poisonFood: 1,
    poisonDamage: 2, naturalOneInfectionSave: 5, infectionDamagePerBox: 1, cure: "safehouse-or-first-aid",
  });
});

test("rail clown plan exposes CLOWNFACE Charisma escape and magic-hit exception", () => {
  const plan = resolveFearTableRule(story, state, "railways", entry("railways", 1), (() => 1) as any);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(effect("railways", 1, "clownface-encounter"), {
    type: "clownface-encounter", keyword: "CLOWNFACE", charismaLevel: 4,
    ignoreModifiers: ["clown-mask", "facial-scar"], escapeLevel: 4, escapeSkill: "slippery",
    hitIgnoreChance: [2, 6], bypassTag: "magic",
  });
  assert.equal(fearClownBounce(2, ["melee"]), true);
  assert.equal(fearClownBounce(2, ["magic"]), false);
  assert.equal(fearClownBounce(3, ["melee"]), false);
});

test("train steward has a source-specific death-as-ghost outcome at zero Sanity", () => {
  assert.deepEqual(effect("railways", 6, "source-terminal"), { type: "source-terminal", outcome: "train-ghost" });
});

test("werewolf encounters track their two-play fallback and apply printed combat modifiers", () => {
  assert.deepEqual(effect("woods-park", 1, "counted-entry-fallback"), {
    type: "counted-entry-fallback", key: "fear-table:woods-park:werewolf:plays", maximumPlays: 2, fallbackTable: "beasts",
  });
  assert.deepEqual(effects("woods-park", 5).filter((x: any) => ["counted-entry-fallback", "werewolf-rules"].includes(x.type)), []);
  assert.equal(definition.enemies.werewolf.escapeModifier, -1);
  assert.equal(definition.enemies["werewolf-pack-member"].surprise, 2);
  assert.equal(definition.enemies["werewolf-pack-member"].escapeModifier, undefined);
  assert.equal(fearEntryReroutesToBeasts(1), false);
  assert.equal(fearEntryReroutesToBeasts(2), true);
});

test("hangman resolves each corpse independently rather than one loot/save for the whole D6 group", () => {
  assert.deepEqual(effect("woods-park", 6, "per-corpse-loop"), {
    type: "per-corpse-loop", count: "D6", fearLevel: 4, fearSkill: "will", lootChance: [1, 6], lootTables: ["random-objects", "useful-stuff"],
  });
});

test("school zombie-child combat and sketchbook absence both expose the source Search follow-up", () => {
  assert.deepEqual(effect("school", 4, "after-combat-search"), { type: "after-combat-search", enemyId: "zombie-child", successTable: "children-stuff" });
  assert.deepEqual(effect("school", 5, "search-on-missing-item"), { type: "search-on-missing-item", itemId: "sketchbook", successReward: "clue" });
});

test("school librarian recipe is replaced by the complete D3-book, 3/6 encounter, trade, spell and knife flow", () => {
  const plan = resolveFearTableRule(story, state, "school", entry("school", 6), (() => 1) as any);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.effects, [{ type: "librarian-encounter", chance: [3, 6], books: "D3", tradeFoodPerBook: 2, spellSave: 5, spellSanityLoss: 2, knifeDamage: 1, escapeCastsSpell: true }]);
});

test("natural one fails and natural six succeeds for the source L5 infection save", () => {
  assert.equal(fearNaturalOneSucceeds(1, 10, 5), false);
  assert.equal(fearNaturalOneSucceeds(6, -10, 5), true);
  assert.equal(fearNaturalOneSucceeds(4, 1, 5), true);
  assert.equal(fearNaturalOneSucceeds(3, 1, 5), false);
});

test("cord source result persists the item and triggers event 36 once an occult guide is found", () => {
  assert.deepEqual(effect("children-stuff", 4, "witch-knot-cord"), {
    type: "witch-knot-cord", cordItem: "cord", triggerWhenBookFound: "occult-guide", eventId: "36",
  });
  assert.ok(definition.eventPrograms["36"].some((op: any) => op.op === "item" && op.itemId === "witch-knots-cord"));
});

test("haunted library lets the player choose one or both books and buffs the exit encounter only for two", () => {
  const plan = resolveFearTableRule(story, state, "haunted-house", entry("haunted-house", 3), (() => 1) as any);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.effects, [{ type: "books-choice-and-buffed-encounter", books: 2, choice: "one-or-both", duplicateReroll: true, enemyTable: "demonic-horrors", levelBonusIfBoth: 1 }]);
});

test("Rosen House persists its location for the campaign", () => {
  assert.deepEqual(effect("haunted-house", 4, "persistent-location"), { type: "persistent-location", key: "fear-table:rosen-house:box-id", rerollIfAlreadyFound: true });
});

test("puppet theatre forbids grenades and makes Molotov cost one Life", () => {
  assert.deepEqual(effect("haunted-house", 5, "puppet-theatre-restrictions"), { type: "puppet-theatre-restrictions", jokeBookItem: "joke-book", grenadeAllowed: false, molotovSelfDamage: 1 });
});

test("unrelated table entries remain unchanged by source rule helper", () => {
  const before = entry("street", 1).operations;
  const plan = resolveFearTableRule(story, state, "street", entry("street", 1), (() => 1) as any);
  assert.deepEqual(plan.effects, []);
  assert.deepEqual(plan.operations, before);
});


test("patched table clauses are pinned to the original English paragraphs", () => {
  assert.match(sourceText("section-store-table", "section-store-table:p3"), /Roll once per weapon/);
  assert.match(sourceText("section-store-table", "section-store-table:p5"), /as soon as you pick up any objects/);
  assert.match(sourceText("section-sewers-table", "section-sewers-table:p2"), /1 on a Defense roll/);
  assert.match(sourceText("section-railways-table", "section-railways-table:p1"), /CLOWNFACE/);
  assert.match(sourceText("section-railways-table", "section-railways-table:p5"), /die of fright/);
  assert.match(sourceText("section-woods-park-table", "section-woods-park-table:p1"), /played this encounter twice/);
  assert.match(sourceText("section-woods-park-table", "section-woods-park-table:p5"), /Every time you do so/);
  assert.match(sourceText("section-school-table", "section-school-table:p4"), /Search roll/);
  assert.match(sourceText("section-school-table", "section-school-table:p5"), /If you do not find the sketchbook/);
  assert.match(sourceText("section-school-table", "section-school-table:p6"), /Her first attack is a spell/);
  assert.match(sourceText("section-children-s-stuff-table", "section-children-s-stuff-table:p3"), /event #36/);
  assert.match(sourceText("section-haunted-house-table", "section-haunted-house-table:p3"), /If you took two books/);
  assert.match(sourceText("section-haunted-house-table", "section-haunted-house-table:p4"), /mark the location/);
  assert.match(sourceText("section-haunted-house-table", "section-haunted-house-table:p5"), /may NOT use a grenade/);
});
