import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const source = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: [], fear: structuredClone(source) };
const refs = [story.fear.sceneRefs.entry, story.fear.sceneRefs.exploration, story.fear.sceneRefs.missions,
  ...Object.values(story.fear.sceneRefs.tables), ...Object.values(story.fear.sceneRefs.events),
  ...Object.values(story.fear.sceneRefs.specialEvents), ...Object.values(story.fear.sceneRefs.endings)];
story.nodes = [...new Set([...refs, ...Array.from({ length: 106 }, (_, index) => String(index + 1))])].map(id => ({ id }));
function roller(...faces: number[]): FearDice { let i = 0; return () => faces[i++] ?? 1; }
function game(): FearState {
  const initialized = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, weaponIds: ["knife"], weaponId: "knife" }, roller(1));
  return advanceFear(story, initialized, { type: "choose", choice: "s1:b1" }, roller());
}
function combat(enemyId = "undead-6") {
  const state = game();
  const enemy = story.fear.enemies[enemyId];
  state.combat = { enemyId, count: 1, defeatedCount: 0, enemyLevel: enemy.level, enemyLife: enemy.life,
    enemyLives: [enemy.life], enemyDamage: enemy.damage, playerFirst: true, round: 1,
    weaponId: state.weaponId, surprise: false, attackDisabled: false, specialRule: enemy.specialRule };
  return state;
}

test("ordinary Vampire's printed 3-in-6 confrontation is separate from Faith/Exorcism L checks", () => {
  const fragment = readFileSync("scripts/alone-against-fear/fragments/section-undead-table.json");
  const rows = JSON.parse(fragment.toString()) as { paragraphs: { id: string; text: string }[] };
  assert.equal(createHash("sha256").update(fragment).digest("hex"), "174e1c5bf85f44f56467e743a64a28b98226b27d70554785b78ab4923ec2185b");
  assert.match(rows.paragraphs.find(row => row.id === "section-undead-table:p6")!.text, /On a 3 or less, the vampire flees/);

  let ordinary = combat(); ordinary.inventory["holy-symbol"] = 1;
  let actions = availableFearActions(story, ordinary);
  assert.ok(actions.some(row => row.action.type === "vampire-confront" && row.action.target === "holy-symbol"), "the source row has its independent 3/6 choice without requiring Faith");
  assert.ok(!actions.some(row => row.action.type === "exorcise" && row.action.target === "holy-symbol"), "Faith's L check is not granted without the Faith skill");
  ordinary = advanceFear(story, ordinary, { type: "vampire-confront", target: "holy-symbol" }, roller(3));
  assert.equal(ordinary.combat, undefined, "the source's first-face 3-in-6 result flees");
  assert.equal(ordinary.combatResult?.outcome, "fled");
  assert.equal(ordinary.xp, 0, "fleeing is not a victory");

  let faithful = combat("unique-vampires-1"); faithful.inventory["holy-symbol"] = 1; faithful.skills.faith = 2;
  actions = availableFearActions(story, faithful);
  assert.ok(actions.some(row => row.action.type === "exorcise" && row.action.target === "holy-symbol"));
  faithful = advanceFear(story, faithful, { type: "exorcise", target: "holy-symbol" }, roller(4));
  assert.equal(faithful.combat, undefined, "Expert Faith's +1 reaches the unique vampire's L5 source turn check on a 4");
});

test("ordinary Vampire confrontation can use both source items once and preserves garlic's separate L check", () => {
  let state = combat(); state.inventory["holy-symbol"] = 1; state.inventory.garlic = 2;
  const both = availableFearActions(story, state).find(row => row.action.type === "vampire-confront" && row.action.target === "both");
  assert.ok(both);
  state = advanceFear(story, state, both.action, roller(4, 3));
  assert.equal(state.combat, undefined, "both selected confrontation checks are rolled once, even though the first fails");
  assert.equal(state.inventory.garlic, 1);

  let garlic = combat(); garlic.inventory.garlic = 2;
  garlic = advanceFear(story, garlic, { type: "exorcise", target: "garlic" }, roller(4));
  assert.equal(garlic.combat?.playerFirst, false, "the separate item rule is still a D6 check against Vampire level 5");
  assert.equal(garlic.inventory.garlic, 1, "a garlic head is consumed on this L check");
});

test("a carried Molotov plus ignition tool is the documented fallback for the absent Vampire fuel can", () => {
  let state = combat(); state.combat!.enemyLives = [1]; state.combat!.enemyLife = 1; state.combat!.count = 1;
  state.inventory["molotov-cocktail"] = 1; state.inventory.matches = 1;
  state = advanceFear(story, state, { type: "attack" }, roller(6, 1));
  assert.equal(state.combat, undefined);
  assert.equal(state.pending?.kind, "vampire-body");
  assert.ok(state.pending?.options.includes("burn-body"));
  state = advanceFear(story, state, { type: "choose", choice: "burn-body" }, roller());
  assert.equal(state.inventory["molotov-cocktail"], undefined);
  assert.ok(state.destroyedVampires?.includes("undead-6"));
  assert.equal(state.missionProgress["vampire-return:undead-6"], undefined);
});

test("Demon Cat follows its Animal row and is not made Holy Water vulnerable by its name", () => {
  const fragment = readFileSync("scripts/alone-against-fear/fragments/section-possessed-table.json");
  const paragraphs = (JSON.parse(fragment.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs;
  assert.equal(createHash("sha256").update(fragment).digest("hex"), "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");
  assert.match(paragraphs.find(row => row.id === "section-possessed-table:p3")!.text, /L4 Animal/);
  const cat = story.fear.enemies["demon-cat"];
  assert.ok(cat.tags?.includes("animal"));
  assert.ok(cat.tags?.includes("susceptible-exorcism"));
  assert.ok(!cat.tags?.includes("demon"));
  assert.ok(!cat.tags?.includes("susceptible-holy-water"));
  const state = combat("demon-cat"); state.inventory["holy-water"] = 1;
  assert.ok(!availableFearActions(story, state).some(({ action }) => action.type === "use-item" && action.target === "holy-water"));
});
