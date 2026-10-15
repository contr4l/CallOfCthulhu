import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveFearTableRule } from "../packages/engine/fear-table-rules.js";
import type { FearDefinition, FearDice, FearStory, FearTableEntry } from "../packages/contracts/fear.js";

const definition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
const story = { fear: definition } as FearStory;
const state = { missionProgress: {}, inventory: {}, uniqueEventsPlayed: [], defeated: [], mapSheets: [] } as any;
const dice: FearDice = () => 1;
const entry = (tableId: string, roll: number) => definition.tables[tableId].entries.find(value => value.roll === roll) as FearTableEntry;
const paragraph = (fragment: string, id: string, sha: string) => {
  const bytes = readFileSync(`scripts/alone-against-fear/fragments/${fragment}.json`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha, `${fragment} source pin`);
  const doc = JSON.parse(bytes.toString()) as { paragraphs: Array<{ id: string; text: string }> };
  const found = doc.paragraphs.find(value => value.id === id);
  assert.ok(found, `${id} is present`);
  return found.text.replace(/\s+/g, " ");
};

test("hardware-store plan follows each printed item chance, then one deferred 2-in-6 encounter", () => {
  const text = paragraph("section-store-table", "section-store-table:p5", "5335ff0b6ba6d54af37cb05349f88c408f794cc05470a8fd1e71fe12ea2839da");
  for (const phrase of ["3 in 6 chance of finding a hammer", "4 in 6 of shotgun with d6 shells", "5 in 6 of knife", "1 in 6 insecticide", "3 in 6 axe", "as soon as you pick up any objects"]) assert.ok(text.includes(phrase), phrase);
  const plan = resolveFearTableRule(story, state, "store", entry("store", 6), dice);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.effects, [{ type: "hardware-store-search", items: [
    { itemId: "hammer", chance: [3, 6] }, { itemId: "shotgun", chance: [4, 6], ammo: "D6" },
    { itemId: "knife", chance: [5, 6] }, { itemId: "insecticide", chance: [1, 6] }, { itemId: "axe", chance: [3, 6] },
  ], encounterChance: [2, 6], encounterTable: "store-hardware-encounter", trigger: "first-pickup" }]);
});

test("railway clown source plan preserves both escape routes and exempts magic hits", () => {
  const text = paragraph("section-railways-table", "section-railways-table:p1", "04a1747931e1a1b34e8dea9356248f94ce084366690e318883c9c8e9de65f2ed");
  assert.match(text, /If you have the CLOWNFACE keyword/);
  assert.match(text, /L4 Charisma roll/);
  assert.match(text, /2 in 6 chance of ignoring any hit/);
  assert.match(text, /unless you are using a magic weapon/);
  const plan = resolveFearTableRule(story, state, "railways", entry("railways", 1), dice);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.effects, [{ type: "clownface-encounter", keyword: "CLOWNFACE", charismaLevel: 4,
    ignoreModifiers: ["clown-mask", "facial-scar"], escapeLevel: 4, escapeSkill: "slippery", hitIgnoreChance: [2, 6], bypassTag: "magic" }]);
});

test("only the solo Werewolf row carries the twice-played Beasts reroute and solo modifiers", () => {
  const sourceSha = "d5f749f3631922ef106f0c2979c1e0c24848532dd3ae6947ed657717c6e7b0d9";
  const solo = paragraph("section-woods-park-table", "section-woods-park-table:p1", sourceSha);
  const pack = paragraph("section-woods-park-table", "section-woods-park-table:p4", sourceSha);
  assert.match(solo, /Silver weapons hit the were at \+2/);
  assert.match(solo, /Any Escape roll against the werewolf is at -1/);
  assert.match(solo, /played this encounter twice/);
  assert.match(pack, /Werewolf Pack/);
  assert.doesNotMatch(pack, /played this encounter twice|Silver weapons|Escape roll.*-1/);
  const soloEffects = resolveFearTableRule(story, state, "woods-park", entry("woods-park", 1), dice).effects;
  const packEffects = resolveFearTableRule(story, state, "woods-park", entry("woods-park", 5), dice).effects;
  assert.deepEqual(soloEffects, [
    { type: "counted-entry-fallback", key: "fear-table:woods-park:werewolf:plays", maximumPlays: 2, fallbackTable: "beasts" },
  ]);
  assert.deepEqual(packEffects, []);
});

test("clinic horde offers ignore or fight and grants both printed rewards only on defeat", () => {
  const text = paragraph("section-clinic-table", "section-clinic-table:p2", "682fd64d128bf5d7d713796f39250789895f1a4d08de821cbf009eae508d5595");
  assert.match(text, /You may ignore them or fight them/);
  assert.match(text, /collect 1 first aid kit/);
  assert.match(text, /d6 doses of painkillers/);
  const plan = resolveFearTableRule(story, state, "clinic", entry("clinic", 3), dice);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.effects, [{ type: "clinic-zombie-horde", enemyId: "zombie", count: "3D6", mayIgnore: true, firstAidKits: 1, painkillerDoses: "D6" }]);
});

test("worship siege allows ignoring and offers the source's three defeat rewards", () => {
  const text = paragraph("section-place-of-worship-table", "section-place-of-worship-table:p4", "efe924facfd62ca5de81048cdd62aeed733a4425949a0588e63cdf662b7fb068");
  assert.match(text, /You may ignore the encounter/);
  assert.match(text, /recover 1 Sanity or find a random item/);
  assert.match(text, /Random Item or from the Useful Stuff table/);
  const plan = resolveFearTableRule(story, state, "worship", entry("worship", 4), dice);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.effects, [{ type: "worship-zombie-siege", enemyId: "zombie", count: "2D6", mayIgnore: true,
    rewardChoices: ["sanity", "random-objects", "useful-stuff"] }]);
});

test("farm siege grants a D6 choice of Food or shotgun shells only after victory", () => {
  const text = paragraph("section-farm-table", "section-farm-table:p5", "5956dd1aac6bcc6b511bb6753adaa426995828018576e78557402049e40846e6");
  assert.match(text, /If you defeat the zombies/);
  assert.match(text, /d6 Food points or d6 shotgun shells \(choose\)/);
  const plan = resolveFearTableRule(story, state, "farm", entry("farm", 5), dice);
  assert.equal(plan.replaceOperations, true);
  assert.deepEqual(plan.operations, []);
  assert.deepEqual(plan.effects, [{ type: "farm-zombie-siege", enemyId: "zombie", count: "2D6",
    rewardChoices: ["D6-food", "D6-shotgun-shells"] }]);
});

test("applied currentdef source patch removes duplicate recipes and only inherited pack modifiers", () => {
  const artifact = JSON.parse(readFileSync("work/alone-against-fear/table-source-rule-patch-2026-10-14.json", "utf8")) as {
    operations: Array<{ op: "replace" | "remove" | "add"; path: string; value?: unknown }>;
  };
  const patched = structuredClone(definition) as any;
  for (const operation of artifact.operations) {
    const parts = operation.path.slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    const key = parts.pop()!;
    const parent = parts.reduce((value, part) => value[part], patched);
    if (operation.op === "replace" || operation.op === "add") parent[key] = operation.value;
    else delete parent[key];
  }
  for (const [tableId, roll] of [["store", 6], ["railways", 1], ["clinic", 3], ["worship", 4], ["farm", 5]] as const) {
    assert.deepEqual(patched.tables[tableId].entries.find((value: FearTableEntry) => value.roll === roll)?.operations, []);
  }
  assert.equal(patched.enemies["werewolf-pack-member"].escapeModifier, undefined);
  assert.equal(patched.enemies["werewolf-pack-member"].attackModifiers, undefined);
  assert.equal(patched.enemies["werewolf-pack-member"].surprise, 2);
  assert.equal(patched.items["walrus-clown-mask"].weightless, true);
  assert.deepEqual(definition.tables.clinic.entries.find((value) => value.roll === 3)?.operations, []);
});
