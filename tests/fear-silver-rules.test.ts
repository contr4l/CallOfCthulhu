import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear, projectFear } from "../packages/engine/fear.js";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const def = readJson("work/alone-against-fear/reviewed-definition.json") as FearDefinition;
const reviewed = readJson("work/alone-against-fear/reviewed-story.json");
const story: FearStory = {
  rulesVersion: "aaf-solo@1", nodes: reviewed.nodes.map((node: { id: string }) => ({ id: node.id })),
  fear: structuredClone(def),
};
story.fear.rules.startingEquipmentTables = undefined;
story.fear.eventPrograms["42"] = [{ op: "roll-table", tableId: "random-objects" }];

function roller(...faces: number[]): FearDice {
  let index = 0;
  return () => faces[index++] ?? 1;
}

function start(seed: Partial<FearState> = {}) {
  const state = initialFear(story, {
    hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 1, missionId: "1",
    weaponIds: ["rifle"], weaponId: "rifle", ammo: { rifle: 6 }, ...seed,
  }, roller(1));
  const selected = advanceFear(story, state, { type: "choose", choice: "s1:b1" }, roller());
  // This focused fixture starts after the initial story paragraph so each test controls its own source event.
  selected.pendingEvent = undefined;
  return selected;
}

function rollSourceTable(state: FearState, tableId: string, dice: FearDice) {
  story.fear.eventPrograms["42"] = [{ op: "roll-table", tableId }];
  state.pendingEvent = { eventId: "42", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  return advanceFear(story, state, { type: "resolve-event", target: "42" }, dice);
}

test("silver source paragraphs and their Chinese translations remain bound to the frozen source fragments", () => {
  const cases = [
    ["section-random-objects-table", "scripts/alone-against-fear/fragments/section-random-objects-table.json", "5c3d8b83d5554dc67e7b0b6ab3d5e1d87100df1a859bbd1312436330580d2aad", "scripts/alone-against-fear/translations/zh-CN/section-random-objects-table.json", ["section-random-objects-table:p6", "section-random-objects-table:p9", "section-random-objects-table:p12"]],
    ["section-useful-stuff-table", "scripts/alone-against-fear/fragments/section-useful-stuff-table.json", "e0fad78712d84396eb5581c4ec892e24ce9e41373b8e5edb8410110f673ea140", "scripts/alone-against-fear/translations/zh-CN/section-useful-stuff-table.json", ["section-useful-stuff-table:p16"]],
    ["section-place-of-worship-table", "scripts/alone-against-fear/fragments/section-place-of-worship-table.json", "efe924facfd62ca5de81048cdd62aeed733a4425949a0588e63cdf662b7fb068", "scripts/alone-against-fear/translations/zh-CN/section-place-of-worship-table.json", ["section-place-of-worship-table:p3"]],
    ["section-beasts-table", "scripts/alone-against-fear/fragments/section-beasts-table.json", "a41400175ef73bfe422335f8c2e7edbff4120921cb4ac1424050a3275c6b21f0", "scripts/alone-against-fear/translations/zh-CN/section-beasts-table.json", ["section-beasts-table:p6"]],
    ["section-random-magic-item-table", "scripts/alone-against-fear/fragments/section-random-magic-item-table.json", "3842fac8b62e1992192cc04c05d637bbc603a4a821cf4368e0a9000485e263fa", "scripts/alone-against-fear/translations/zh-CN/section-random-magic-item-table.json", ["section-random-magic-item-table:p4"]],
  ] as const;
  for (const [id, sourcePath, expectedHash, translationPath, paragraphIds] of cases) {
    const sourceBytes = readFileSync(sourcePath);
    const source = JSON.parse(sourceBytes.toString("utf8"));
    const translation = readJson(translationPath);
    assert.equal(source.id, id);
    assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), expectedHash);
    assert.equal(translation.sourceFragmentSha256, expectedHash);
    for (const paragraphId of paragraphIds) {
      assert.ok(source.paragraphs.some((paragraph: { id: string }) => paragraph.id === paragraphId), `${paragraphId} is a source paragraph`);
      assert.ok(translation.paragraphs.some((paragraph: { id: string; text: string }) => paragraph.id === paragraphId && paragraph.text.length > 0), `${paragraphId} has a translation`);
    }
  }
  const wolf = story.fear.enemies["beasts-6"];
  assert.deepEqual(wolf.attackModifiers, [{ weaponTag: "silver", amount: 2 }]);
  assert.ok(story.fear.weapons["silver-knife"].tags?.includes("silver"));
  assert.equal(story.fear.weapons["silver-knife"].damage, story.fear.weapons.knife.damage);
});

test("source random-object D66 pickups feed silver crafting, mixed rifle shots, and persistent per-caliber ammo", () => {
  let state = start();
  state = rollSourceTable(state, "random-objects", roller(3, 2)); // D66 32: silver necklace
  assert.equal(state.inventory["silver-necklace"], 1);
  state = rollSourceTable(state, "random-objects", roller(6, 6)); // D66 66: smelting equipment
  assert.equal(state.inventory["smelting-tools"], 1);
  assert.equal(story.fear.items?.["smelting-tools"]?.carriedWeight, 2);

  const craft = availableFearActions(story, state).find(({ action }) => action.type === "craft-silver"
    && action.target === "silver-necklace" && action.choice === "bullets:rifle");
  assert.ok(craft, "source necklace plus smelting tools offers a player-chosen firearm caliber");
  state = advanceFear(story, state, craft!.action, roller(4)); // D3=2
  assert.equal(state.inventory["silver-necklace"], undefined);
  assert.equal(state.silverAmmo?.rifle, 2);

  story.fear.eventPrograms["42"] = [{ op: "start-combat", enemyId: "beasts-6", count: 1 }];
  state.pendingEvent = { eventId: "42", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  state = advanceFear(story, state, { type: "resolve-event", target: "42" }, roller());
  assert.ok(state.combat);
  const mixedBurst = availableFearActions(story, state).find(({ action }) => action.type === "attack"
    && action.shots === 2 && action.silverBulletIndex === 1);
  assert.ok(mixedBurst, "a rifle burst may select exactly one of its two shots as silver");
  state = advanceFear(story, state, mixedBurst!.action, roller(3, 3));
  assert.equal(state.ammo.rifle, 4, "two regular rounds are consumed; the third source-defined burst round is silver");
  assert.equal(state.silverAmmo?.rifle, 1);
  assert.equal(state.combat?.enemyLife, 2, "only the selected silver shot gets the source Giant Wolf +2 silver modifier");
  const projection = projectFear(story, structuredClone(state));
  assert.equal(projection.silverAmmo.rifle, 1);
  assert.equal(projection.weapons.find(weapon => weapon.id === "rifle")?.silverAmmo, 1);
  assert.equal(JSON.parse(JSON.stringify(state)).silverAmmo.rifle, 1, "the selected ammunition pool survives a JSON save round trip");
});

test("silver ring and necklace can replace one ordinary shotgun shell without smelting equipment", () => {
  const state = start({ inventory: { "silver-ring": 1 }, weaponIds: ["shotgun"], weaponId: "shotgun", ammo: { shotgun: 4 } });
  const option = availableFearActions(story, state).find(({ action }) => action.type === "craft-silver" && action.target === "silver-ring" && action.choice === "shotgun-shell");
  assert.ok(option, "the printed ring-to-shotgun-shell option is available without a smelter");
  const next = advanceFear(story, state, option!.action, roller());
  assert.equal(next.ammo.shotgun, 3);
  assert.equal(next.silverAmmo?.shotgun, 1);
  assert.equal(next.inventory["silver-ring"], undefined);
});

test("the Worship table's silver crucifix remains a Faith symbol until deliberately smelted", () => {
  let state = start({ skills: { faith: 1 } });
  state = rollSourceTable(state, "worship", roller(3));
  assert.ok(state.pending?.options.includes("silver-crucifix"));
  state = advanceFear(story, state, { type: "choose", choice: "silver-crucifix" }, roller());
  assert.equal(state.inventory["silver-crucifix"], 1);
  // Each completed Worship visit also offers one optional weightless holy symbol; decline it so the crucifix is the only carried symbol.
  state = advanceFear(story, state, { type: "choose", choice: "leave" }, roller());
  state.combat = { enemyId: "undead-6", count: 1, defeatedCount: 0, enemyLevel: 5, enemyLife: 8, enemyLives: [8], enemyDamage: 2,
    playerFirst: true, round: 1, weaponId: state.weaponId, surprise: false, attackDisabled: false };
  const confrontation = availableFearActions(story, state).find(({ action }) => action.type === "vampire-confront" && action.target === "silver-crucifix");
  assert.ok(confrontation, "the carried silver crucifix can be selected as the Vampire's printed religious-symbol confrontation");
  state = advanceFear(story, state, confrontation!.action, roller(2));
  assert.equal(state.combat, undefined, "the source 3/6 confrontation succeeds on D6=2");
  assert.equal(state.inventory["silver-crucifix"], 1, "the religious symbol is not consumed by the confrontation");
});

test("Mission 4 qualifies each physical firearm against its exact caliber's combined ordinary and silver ammunition", () => {
  let state = start({ missionId: "4", weaponIds: ["pistol", "pistol"], weaponId: "pistol", ammo: {}, silverAmmo: { pistol: 12 } });
  const finish = availableFearActions(story, state).find(({ action }) => action.type === "end-mission");
  assert.ok(finish, "two pistol instances with twelve pistol-caliber silver cartridges meet the source's six-round-per-firearm threshold");
  state = advanceFear(story, state, finish!.action, roller());
  assert.ok(state.missionFinished);
  assert.equal(state.xp, 2, "the source Mission 4 reward is one XP per qualifying firearm");
});
