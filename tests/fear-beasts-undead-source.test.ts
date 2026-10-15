import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FearDefinition, FearDice, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const canonical = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const sourceText = (fragment: string, paragraphId: string, paragraphSha: string, text: RegExp) => {
  const file = `scripts/alone-against-fear/fragments/${fragment}.json`;
  const json = JSON.parse(readFileSync(file, "utf8")) as { paragraphs: { id: string; text: string }[] };
  const paragraph = json.paragraphs.find(item => item.id === paragraphId);
  assert.ok(paragraph, `${paragraphId} exists`);
  assert.match(paragraph.text, text);
  assert.equal(createHash("sha256").update(paragraph.text).digest("hex"), paragraphSha);
  return paragraph.text;
};
const undeadSourceSha = "174e1c5bf85f44f56467e743a64a28b98226b27d70554785b78ab4923ec2185b";
const beastsSourceSha = "a41400175ef73bfe422335f8c2e7edbff4120921cb4ac1424050a3275c6b21f0";
const story: FearStory = {
  rulesVersion: "aaf-solo@1",
  nodes: [], fear: structuredClone(canonical),
};
const refs = [story.fear.sceneRefs.entry, story.fear.sceneRefs.exploration, story.fear.sceneRefs.missions,
  ...Object.values(story.fear.sceneRefs.tables), ...Object.values(story.fear.sceneRefs.events),
  ...Object.values(story.fear.sceneRefs.specialEvents), ...Object.values(story.fear.sceneRefs.endings)];
story.nodes = [...new Set([...refs, ...Array.from({ length: 42 }, (_, index) => String(index + 1))])].map(id => ({ id }));
function roller(...faces: number[]): FearDice { let i = 0; return () => faces[i++] ?? 1; }
function game() {
  // Event 1 is the actual entry scene but unrelated to these four table clauses.
  // Mark its state-machine transition complete without introducing a second encounter.
  story.fear.eventPrograms["1"] = [];
  const start = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, weaponIds: ["knife"], weaponId: "knife" }, roller(1));
  const chosen = advanceFear(story, start, { type: "choose", choice: "s1:b1" }, roller());
  const entry = advanceFear(story, chosen, { type: "resolve-event", target: "1" }, roller(6, 6, 1));
  if (entry.pending?.kind === "source-choice" && entry.pending.options.includes("baseball-bat"))
    return advanceFear(story, entry, { type: "choose", choice: "baseball-bat" }, roller());
  return entry;
}
function useTable(tableId: "undead" | "beasts") {
  const exploration = story.fear.tables[story.fear.rules.townExplorationTable];
  exploration.die = "D6";
  exploration.entries = [{ roll: [1, 6], result: "source encounter", operations: [{ op: "roll-table", tableId }] }];
}
function moveToEncounter(dice: FearDice, current = game()) {
  return advanceFear(story, current, { type: "move", target: "s1:b2" }, dice);
}

test("Fear Beasts and Undead regression source pins remain exact", () => {
  assert.equal(hash("scripts/alone-against-fear/fragments/section-undead-table.json"), undeadSourceSha);
  assert.equal(hash("scripts/alone-against-fear/fragments/section-beasts-table.json"), beastsSourceSha);
  assert.equal(hash("scripts/alone-against-fear/fragments/section-skills.json"), "c474a27cdb273d2b80ee37bc928e644c21da3c060e787e2f4c48c51ceb5bc173");
  assert.equal(hash("scripts/alone-against-fear/fragments/section-random-objects-table.json"), "5c3d8b83d5554dc67e7b0b6ab3d5e1d87100df1a859bbd1312436330580d2aad");
  sourceText("section-undead-table", "section-undead-table:p1", "8d3663ab53f82905ed4f3a571cf5cab9033c5f007de29b3fbdead6965cf01d30", /remain in this area/i);
  sourceText("section-undead-table", "section-undead-table:p3", "1858f4b2fe2ba00834f7198475e69153bdf0065cd39cf2f4941a591273b93c3b", /Molotov cocktails do no damage/i);
  sourceText("section-undead-table", "section-undead-table:p4", "a3bb44a77b6f593b52ec306fd3dffd6a817e647f13c0d10c9a9146155ccfc3da", /end of the combat[\s\S]*2 in 6 chance/i);
  sourceText("section-undead-table", "section-undead-table:p6", "2e23951061d65956b48b059e3ec117204fb7add87dd83b80fe104f5b10200d09", /religious symbol or garlic[\s\S]*On a 3 or less/i);
  sourceText("section-beasts-table", "section-beasts-table:p5", "bc007965e0cb9ce39be6255e289f4576bc62d12fdecc62f83b1c148b5ffc361a", /have read the Occult Guide/i);
  sourceText("section-skills", "section-skills:p1", "024a021afe4b6bbe030f40efe29a510846b653682c9c9d6168f1c56cf1e86e80", /Faith \(2 XP\)[\s\S]*turn vampires\s+with a holy symbol[\s\S]*Expert: Your attempt is at \+1/i);
  sourceText("section-random-objects-table", "section-random-objects-table:p4", "0e23770b58a39a15fbd2b4a55a78c31fb56734eab96ce3360d6151fd09aeb988", /sacrifice 1 head[\s\S]*roll against the vampire.s level/i);
});

test("Slow Zombie Escape preserves the source encounter in its original area", () => {
  useTable("undead");
  let current = moveToEncounter(roller(1, 1, 1, 1));
  assert.equal(current.combat?.enemyId, "undead-1");
  assert.equal(current.combat?.count, 2, "the source 2D6 zombie quantity is rolled as 1+1 in this witness");
  const origin = current.currentBoxId;
  const escape = availableFearActions(story, current).find(({ action }) => action.type === "escape");
  assert.ok(escape);
  current = advanceFear(story, current, escape.action, roller());
  assert.equal(current.currentBoxId, origin);
  assert.ok(current.mapSheets.flatMap(sheet => sheet.boxes).some(box => box.id === origin && box.occupiedEncounter?.enemyId === "undead-1"),
    "the source says zombies stay in their area; escape does not move them to another box");
});

test("Zombie escape requires leaving the area; defeating the stored encounter clears it", () => {
  useTable("undead");
  let current = moveToEncounter(roller(1, 1, 1, 1));
  const origin = current.currentBoxId;
  const escape = availableFearActions(story, current).find(({ action }) => action.type === "escape");
  assert.ok(escape);
  current = advanceFear(story, current, escape.action, roller());
  // This failed source assertion is isolated below so the remaining occupied
  // encounter lifecycle can still run while the main agent patches search gating.
  story.fear.tables[story.fear.rules.townExplorationTable].entries = [{ roll: [1, 6], result: "empty source control", operations: [] }];
  const move = availableFearActions(story, current).find(({ action }) => action.type === "move");
  assert.ok(move, "successful escape proceeds to choosing an adjacent area");
  current = advanceFear(story, current, move.action, roller(6, 6, 1));
  if (current.pendingEvent) {
    const resume = availableFearActions(story, current).find(({ action }) => action.type === "resolve-event");
    assert.ok(resume);
    current = advanceFear(story, current, resume.action, roller(6, 6, 1));
  }
  const returnMove = availableFearActions(story, current).find(({ action }) => action.type === "move" && action.target === origin);
  assert.ok(returnMove, JSON.stringify({ origin, currentBoxId: current.currentBoxId, actions: availableFearActions(story, current).map(item => item.action) }));
  current = advanceFear(story, current, returnMove.action, roller(1, 1, 1));
  assert.equal(current.combat?.enemyId, "undead-1", "failed Stealth resumes the original encounter");
  assert.ok(current.combat?.enemyLives.length);
  current.combat!.playerFirst = true;
  current.combat!.enemyLives = [1, 1];
  current.combat!.enemyLife = 1;
  current = advanceFear(story, current, { type: "attack" }, roller(6, 6, 6, 6, 1, 1));
  assert.equal(current.combat, undefined);
  assert.equal(current.mapSheets.flatMap(sheet => sheet.boxes).find(box => box.id === origin)?.occupiedEncounter, undefined,
    "winning against the stored encounter removes it from the area");
  if (current.pendingEvent) {
    const resume = availableFearActions(story, current).find(({ action }) => action.type === "resolve-event");
    assert.ok(resume);
    current = advanceFear(story, current, resume.action, roller(6, 6, 1));
  }
  const leave = availableFearActions(story, current).find(({ action }) => action.type === "move");
  assert.ok(leave, JSON.stringify({ status: current.status, pending: current.pending, pendingEvent: current.pendingEvent, combatResult: current.combatResult, actions: availableFearActions(story, current).map(item => item.action), log: current.log.slice(-5) }));
  current = advanceFear(story, current, leave.action, roller(6, 6, 1));
  if (current.pendingEvent) {
    const resume = availableFearActions(story, current).find(({ action }) => action.type === "resolve-event");
    assert.ok(resume);
    current = advanceFear(story, current, resume.action, roller(6, 6, 1));
  }
  const revisit = availableFearActions(story, current).find(({ action }) => action.type === "move" && action.target === origin);
  assert.ok(revisit);
  current = advanceFear(story, current, revisit.action, roller(6, 6, 1));
  assert.equal(current.combat, undefined, "the defeated Zombie does not resurrect on a later visit");
});

test("Zombie escape does not expose Search before the player leaves the area", () => {
  useTable("undead");
  let current = moveToEncounter(roller(1, 1, 1, 1));
  const escape = availableFearActions(story, current).find(({ action }) => action.type === "escape");
  assert.ok(escape);
  current = advanceFear(story, current, escape.action, roller());
  assert.ok(!availableFearActions(story, current).some(({ action }) => action.type === "search"),
    "overview p6 permits search only with no encounter or one solved without escaping");
});

test("Flaming Skeleton retaliates for one Life after an unarmed hit", () => {
  useTable("undead");
  let current = moveToEncounter(roller(1, 3, 6, 1));
  assert.equal(current.combat?.enemyId, "undead-3");
  current.combat!.playerFirst = true;
  current.combat!.enemyLives = [5];
  current.combat!.enemyLife = 5;
  current.weaponId = "unarmed";
  current.combat!.weaponId = "unarmed";
  const before = current.hp;
  current = advanceFear(story, current, { type: "attack" }, roller(6, 1));
  if (current.pending?.kind === "injury-prevention")
    current = advanceFear(story, current, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(current.hp, before - 1, "a successful unarmed attack automatically costs 1 Life, including Martial Arts-free source path");
});

test("Unique Vampire 5 public table route exposes the blood-payment choice and failure starts combat", () => {
  const uniqueStory: FearStory = structuredClone(story);
  uniqueStory.fear.tables[uniqueStory.fear.rules.townExplorationTable].entries = [
    { roll: [1, 6], result: "unique vampire", operations: [{ op: "roll-table", tableId: "unique-vampires" }] },
  ];
  uniqueStory.fear.tables["unique-vampires"].entries = [
    { roll: [1, 6], result: "unique-vampires-5", values: { enemyId: "unique-vampires-5", count: 1 }, operations: [
      { op: "vetala-encounter" }, { op: "start-combat", enemyId: "unique-vampires-5", count: 1 },
    ] },
  ];
  uniqueStory.fear.eventPrograms["1"] = [];
  let current = initialFear(uniqueStory, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 2, skills: { charisma: 0 } }, roller(1));
  current = advanceFear(uniqueStory, current, { type: "choose", choice: "s1:b1" }, roller());
  current = advanceFear(uniqueStory, current, { type: "resolve-event", target: "1" }, roller(6, 6, 1));
  current = advanceFear(uniqueStory, current, { type: "move", target: "s1:b2" }, roller(1, 5, 5, 5, 5, 5));
  assert.equal(current.pending?.kind, "vetala-offer", `the actual table result runs the printed pre-combat offer ${JSON.stringify({ combat: current.combat?.enemyId, pending: current.pending, log: current.log.slice(-8) })}`);
  assert.ok(availableFearActions(uniqueStory, current).some(({ action }) => action.type === "choose" && action.choice === "offer-blood"),
    "2 Life is offered as an alternative even when the investigator has less than 6 Food");
  const offer = availableFearActions(uniqueStory, current).find(({ action }) => action.type === "choose" && action.choice === "offer-blood");
  assert.ok(offer);
  current = advanceFear(uniqueStory, current, offer.action, roller(2));
  assert.equal(current.hp, 6, "the two Life payment applies even when the L5 Charisma roll fails");
  assert.equal(current.combat?.enemyId, "unique-vampires-5", "failed blood offer proceeds to the source combat");
});

test("Unique Vampire 1 public table route applies Upyr food rot before the combat state", () => {
  const upyrStory: FearStory = structuredClone(story);
  upyrStory.fear.tables[upyrStory.fear.rules.townExplorationTable].entries = [
    { roll: [1, 6], result: "unique vampire", operations: [{ op: "roll-table", tableId: "unique-vampires" }] },
  ];
  upyrStory.fear.tables["unique-vampires"].entries = [
    { roll: [1, 6], result: "unique-vampires-1", values: { enemyId: "unique-vampires-1", count: 1 }, operations: [
      { op: "upyr-encounter" }, { op: "start-combat", enemyId: "unique-vampires-1", count: 1 },
    ] },
  ];
  upyrStory.fear.eventPrograms["1"] = [];
  let current = initialFear(upyrStory, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, food: 2 }, roller(1));
  current = advanceFear(upyrStory, current, { type: "choose", choice: "s1:b1" }, roller());
  current = advanceFear(upyrStory, current, { type: "resolve-event", target: "1" }, roller(6, 6, 1));
  current = advanceFear(upyrStory, current, { type: "move", target: "s1:b2" }, roller(1, 1, 3, 3, 1, 6, 6, 1));
  assert.equal(current.food, 0, "the Upyr first rolls D6 to spoil carried Food");
  assert.ok(current.ongoingChecks.some(effect => effect.id === "upyr-disease"),
    "when the spoil roll exceeds carried Food, a failed L5 disease save becomes a persistent movement check");
  assert.ok(current.log.some(line => line.includes("乌皮尔使食物腐坏")));
});

test("Howler end-of-combat attraction is checked after Escape as well as defeat", () => {
  useTable("undead");
  let current = moveToEncounter(roller(1, 4, 1, 6));
  assert.equal(current.combat?.enemyId, "undead-4");
  const escape = availableFearActions(story, current).find(({ action }) => action.type === "escape");
  assert.ok(escape);
  current = advanceFear(story, current, escape.action, roller(6, 1));
  assert.equal(current.combat?.enemyId, "undead-1", "the successful end-of-combat 2-in-6 attraction starts the next Undead-table fight after escape");
  assert.ok(current.log.some(line => line.includes("2/6: yes")),
    "after-combat source attraction must resolve its 2-in-6 roll even when the investigator flees");
});

test("Bone Monster requires a read Occult Guide for bone-powder loot", () => {
  useTable("beasts");
  let current = moveToEncounter(roller(1, 5));
  assert.equal(current.combat?.enemyId, "beasts-5");
  current.inventory["occult-guide"] = 1;
  current.combat!.enemyLife = 1;
  current.combat!.enemyLives = [1];
  current.combat!.playerFirst = true;
  current = advanceFear(story, current, { type: "attack" }, roller(6, 1, 1));
  assert.equal(current.readBooks.includes("occult-guide"), false);
  assert.equal(current.inventory["bone-powder"], undefined, "carrying the unread book does not satisfy the source's read condition");

  let read = game(); read.inventory["occult-guide"] = 1;
  const readAction = availableFearActions(story, read).find(({ action }) => action.type === "use-item" && action.target === "read-book" && action.choice === "occult-guide");
  assert.ok(readAction);
  read = advanceFear(story, read, readAction.action, roller());
  assert.ok(read.readBooks.includes("occult-guide"), "reading the source book persists its read state");
  read = moveToEncounter(roller(1, 5), read);
  assert.equal(read.combat?.enemyId, "beasts-5");
  read = advanceFear(story, read, { type: "attack" }, roller(6, 6, 6, 6, 1, 1));
  assert.ok((read.inventory["bone-powder"] ?? 0) > 0, "defeating the Bone Monster after reading grants the printed D3 doses");
});

test("Giant Wolf source-table encounter applies its Escape penalty in the actual Escape action", () => {
  useTable("beasts");
  let current = moveToEncounter(roller(1, 6, 6, 1));
  assert.equal(current.combat?.enemyId, "beasts-6");
  const escape = availableFearActions(story, current).find(({ action }) => action.type === "escape");
  assert.ok(escape);
  current = advanceFear(story, current, escape.action, roller(6, 6));
  assert.ok(current.log.some(line => line.includes("逃跑检定") && line.includes("-1")),
    "source's -1 Escape modifier must affect the actual public check, not only the enemy profile");
});

test("Flaming Skeleton takes no damage from a public Molotov action", () => {
  useTable("undead");
  let current = moveToEncounter(roller(1, 3));
  assert.equal(current.combat?.enemyId, "undead-3");
  current.inventory["molotov-cocktail"] = 1;
  current.inventory.matches = 1;
  const action = availableFearActions(story, current).find(({ action }) => action.type === "use-item" && action.target === "molotov-cocktail");
  assert.ok(action);
  const life = current.combat!.enemyLife;
  current = advanceFear(story, current, action.action, roller(6, 1));
  assert.equal(current.combat?.enemyLife, life, "source says Molotov cocktails do no damage to Flaming Skeletons");
});

test("ordinary Vampire p60 chance is separate from the Faith turn and garlic-versus-Level action", () => {
  useTable("undead");
  const faithStory = structuredClone(story);
  faithStory.fear.tables[faithStory.fear.rules.townExplorationTable].entries = [
    { roll: [1, 6], result: "source encounter", operations: [{ op: "roll-table", tableId: "undead" }] },
  ];

  let sourceChance = advanceFear(faithStory, game(), { type: "move", target: "s1:b2" }, roller(1, 6));
  assert.equal(sourceChance.combat?.enemyId, "undead-6");
  sourceChance.inventory["holy-symbol"] = 1;
  sourceChance.inventory.garlic = 1;
  sourceChance.skills.faith = 1;
  const options = availableFearActions(faithStory, sourceChance).map(({ action }) => action);
  assert.ok(options.some(action => action.type === "vampire-confront" && action.target === "holy-symbol"), "p60 chance is available as its own action");
  assert.ok(options.some(action => action.type === "exorcise" && action.target === "holy-symbol"), "Faith turn remains a distinct, optional Exorcism-style action");
  const p60 = options.find(action => action.type === "vampire-confront" && action.target === "holy-symbol");
  assert.ok(p60);
  sourceChance = advanceFear(faithStory, sourceChance, p60, roller(3));
  assert.equal(sourceChance.combatResult?.outcome, "fled", "p60 uses the specific 1–3 chance without adding the Faith modifier");
  assert.ok(sourceChance.log.some(line => line.includes("3/6") && line.includes("3")));

  let faithTurn = advanceFear(faithStory, game(), { type: "move", target: "s1:b2" }, roller(1, 6));
  faithTurn.inventory["holy-symbol"] = 1;
  faithTurn.skills.faith = 2;
  const turn = availableFearActions(faithStory, faithTurn).find(({ action }) => action.type === "exorcise" && action.target === "holy-symbol");
  assert.ok(turn);
  faithTurn = advanceFear(faithStory, faithTurn, turn.action, roller(4));
  assert.equal(faithTurn.combatResult?.outcome, "fled", JSON.stringify({ pending: faithTurn.pending, combat: faithTurn.combat, log: faithTurn.log.slice(-5) }));
  assert.ok(faithTurn.log.some(line => line.includes("4 => 5")));

  let garlicTurn = advanceFear(faithStory, game(), { type: "move", target: "s1:b2" }, roller(1, 6));
  garlicTurn.inventory.garlic = 1;
  const garlic = availableFearActions(faithStory, garlicTurn).find(({ action }) => action.type === "exorcise" && action.target === "garlic");
  assert.ok(garlic);
  garlicTurn = advanceFear(faithStory, garlicTurn, garlic.action, roller(5));
  assert.equal(garlicTurn.combatResult?.outcome, "fled", "the separate Random Objects garlic rule rolls against Vampire L5");
  assert.equal(garlicTurn.inventory.garlic, undefined, "the source consumes one garlic head on this attempted use");
  assert.ok(garlicTurn.log.some(line => line.includes("L5") && line.includes("5 => 5")));
});
