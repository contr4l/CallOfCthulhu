import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const definition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: [], fear: structuredClone(definition) };
const refs = [story.fear.sceneRefs.entry, story.fear.sceneRefs.exploration, story.fear.sceneRefs.missions,
  ...Object.values(story.fear.sceneRefs.tables), ...Object.values(story.fear.sceneRefs.events),
  ...Object.values(story.fear.sceneRefs.specialEvents), ...Object.values(story.fear.sceneRefs.endings)];
story.nodes = [...new Set([...refs, ...Array.from({ length: 106 }, (_, index) => String(index + 1))])].map(id => ({ id }));
function roller(...faces: number[]): FearDice { let index = 0; return () => faces[index++] ?? 1; }
function state(): FearState {
  const initialized = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, weaponIds: ["unarmed"], weaponId: "unarmed" }, roller(1));
  return advanceFear(story, initialized, { type: "choose", choice: "s1:b1" }, roller());
}

test("fleeing the source Slow Zombie permanently forbids Search in that box", () => {
  const bytes = readFileSync("scripts/alone-against-fear/fragments/section-undead-table.json");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "174e1c5bf85f44f56467e743a64a28b98226b27d70554785b78ab4923ec2185b");
  const paragraphs = (JSON.parse(bytes.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs;
  assert.match(paragraphs.find(row => row.id === "section-undead-table:p1")!.text, /Zombies are Slow/);
  assert.match(paragraphs.find(row => row.id === "section-undead-table:p1")!.text, /remain in the area/);
  let current = state();
  current.combat = { enemyId: "undead-1", count: 1, defeatedCount: 0, enemyLevel: 2, enemyLife: 1,
    enemyLives: [1], enemyDamage: 1, round: 1, playerFirst: true, surprise: false,
    weaponId: current.weaponId, attackDisabled: false };
  current = advanceFear(story, current, { type: "escape" }, roller());
  assert.equal(current.combat, undefined);
  assert.equal(current.mapSheets[0].boxes[0].occupiedEncounter?.enemyId, "undead-1");
  assert.equal(current.mapSheets[0].boxes[0].searchForbidden, true);
  assert.ok(!availableFearActions(story, current).some(({ action }) => action.type === "search"));
  assert.throws(() => advanceFear(story, current, { type: "search" }, roller(6)), /no remaining search attempts/);
});

test("unarmed is typed as an unarmed weapon so Flaming Skeleton retaliation runs", () => {
  const bytes = readFileSync("scripts/alone-against-fear/fragments/section-undead-table.json");
  const paragraphs = (JSON.parse(bytes.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs;
  assert.match(paragraphs.find(row => row.id === "section-undead-table:p3")!.text, /hit them with an unarmed attack/);
  assert.ok(story.fear.weapons.unarmed.tags?.includes("unarmed"));
  let current = state();
  current.combat = { enemyId: "undead-3", count: 1, defeatedCount: 0, enemyLevel: 3, enemyLife: 3,
    enemyLives: [3], enemyDamage: 2, round: 1, playerFirst: true, surprise: false,
    weaponId: "unarmed", attackDisabled: false };
  current = advanceFear(story, current, { type: "attack" }, roller(6, 1));
  assert.equal(current.combat?.enemyLife, 2, "the legal hit still damages the skeleton");
  assert.equal(current.pending?.kind, "injury-prevention", "the retaliation enters the normal preventable Life-loss flow");
  assert.equal(current.pending?.data?.amount, 1);
});

test("the overview expressly bans Search after fleeing", () => {
  const bytes = readFileSync("scripts/alone-against-fear/fragments/section-game-overview.json");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), "c92d4bdb63ad4554cfea4457f23f503f00fd1cfe3bda518427d37183455c7841");
  const paragraphs = (JSON.parse(bytes.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs;
  assert.match(paragraphs.find(row => row.id === "section-game-overview:p6")!.text, /without escaping/);
});
