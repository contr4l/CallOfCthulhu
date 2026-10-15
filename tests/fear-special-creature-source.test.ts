import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const base: FearDefinition = {
  format: "aaf-fear-definition@1", source: { pdfSha256: "a".repeat(64), pages: 106 },
  map: { boxesPerSheet: 30, rows: 6, columns: 5, adjacency: "orthogonal", topologyBasis: "web-adaptation", start: { sheet: 1, box: 1 }, safehouseLimit: 3, safehouseLifetime: "nearest-first" },
  rules: { foodEveryBoxes: 5, townExplorationTable: "town", randomEncounterTable: "encounter", usefulItemTable: "useful", randomItemTable: "randomItems", maxScars: 3, maxTraumas: 3, searchOncePerBox: true, exploredAreaEncounter: { numerator: 1, denominator: 6 }, sixExplodes: true, naturalOneFails: true, naturalSixSucceeds: true },
  sceneRefs: { entry: "entry", exploration: "explore", missions: "missions", tables: { randomEncounter: "random" }, events: { "1": "event-1", "3": "event-3" }, specialEvents: { "1": "event-1", "3": "event-3" }, endings: { win: "win" } },
  eventPrograms: {},
  skills: { escape: { label: "Escape", xp: 2, modifiers: {} }, will: { label: "Will", xp: 4, modifiers: { "will-save": [1, 2], "magic-save": [1, 2] } } },
  weapons: { unarmed: { label: "Unarmed", damage: 1 }, knife: { label: "Knife", damage: 1, modifier: 1 } },
  enemies: { zombie: { label: "Zombie", level: 3, life: 1, damage: 1, surprise: 0 } },
  items: { "holy-water": { label: "Holy Water" } },
  tables: { town: { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] }, encounter: { die: "D6", entries: [{ roll: 1, result: "zombie" }] }, useful: { die: "D6", entries: [{ roll: [1, 6], result: "nothing" }] }, randomItems: { die: "D6", entries: [{ roll: [1, 6], result: "nothing" }] } },
  missions: {}, gates: { required: 7, level: 6, scene: "win" },
};
const baseStory: FearStory = { rulesVersion: "aaf-solo@1", nodes: ["entry", "explore", "missions", "random", "event-1", "event-3", "win"].map(id => ({ id })), fear: base };
const reviewed = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
function roller(...faces: number[]): FearDice { let index = 0; return () => faces[index++] ?? 1; }
function storyWithCanonical(): FearStory {
  const result = structuredClone(baseStory);
  const referencedScenes = new Set<string>();
  const collectScenes = (value: unknown) => {
    if (typeof value === "string") referencedScenes.add(value);
    else if (Array.isArray(value)) value.forEach(collectScenes);
    else if (value && typeof value === "object") Object.values(value).forEach(collectScenes);
  };
  collectScenes(reviewed.sceneRefs);
  const nodeIds = new Set([...Array.from({ length: 106 }, (_, index) => String(index + 1)), ...referencedScenes]);
  result.nodes.push(...[...nodeIds].map(id => ({ id })));
  result.fear = {
    ...result.fear,
    ...reviewed,
    sceneRefs: { ...result.fear.sceneRefs, ...reviewed.sceneRefs, events: { ...result.fear.sceneRefs.events, ...reviewed.sceneRefs.events, "1": "event-1", "3": "event-3" }, specialEvents: { ...result.fear.sceneRefs.specialEvents, ...reviewed.sceneRefs.specialEvents, "1": "event-1", "3": "event-3" } },
    eventPrograms: { ...reviewed.eventPrograms },
    enemies: { ...reviewed.enemies }, items: { ...reviewed.items }, weapons: { ...reviewed.weapons }, skills: { ...reviewed.skills }, tables: { ...reviewed.tables },
  };
  return result;
}
function newState(story: FearStory, options: { weapon?: string; hp?: number; sanity?: number; items?: Record<string, number> } = {}): FearState {
  const weapon = options.weapon ?? "knife";
  const state = initialFear(baseStory, { hp: options.hp ?? 8, maxHp: options.hp ?? 8, sanity: options.sanity ?? 8, maxSanity: options.sanity ?? 8, weaponIds: [weapon], weaponId: weapon }, roller(1));
  const placed = advanceFear(story, state, { type: "choose", choice: "s1:b1" }, roller());
  Object.assign(placed.inventory, options.items ?? {});
  return placed;
}
function resolveEvent(story: FearStory, state: FearState, dice: FearDice): FearState {
  state.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  let result = advanceFear(story, state, { type: "resolve-event", target: "1" }, dice);
  while (result.pending?.kind === "fear-item-before-encounter" || result.pending?.kind === "fear-item-check")
    result = advanceFear(story, result, { type: "choose", choice: "continue" }, dice);
  return result;
}
function sourceParagraph(file: string, id: string, expectedHash: string): string {
  const bytes = readFileSync(`scripts/alone-against-fear/fragments/${file}`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash);
  const fragment = JSON.parse(bytes.toString()) as { paragraphs: Array<{ id: string; text: string }> };
  const paragraph = fragment.paragraphs.find(item => item.id === id);
  assert.ok(paragraph, `${id} exists in its source fragment`);
  return paragraph.text.replace(/\s+/g, " ");
}

test("general XP is for combat-encounter victories; the Librarian and Mirina noncombat exorcism rows grant no separate XP", () => {
  const experience = sourceParagraph("section-experience.json", "section-experience:p1", "4a9ec3dca0d03b113067e6578a0a76aede4370035d2f8feb26ef3ef676bb1897");
  assert.match(experience, /1 XP every time you win a combat encounter/);
  assert.match(experience, /defeating the opponent through combat, magic, or exorcism/);
  const exorcism = sourceParagraph("section-susceptible-to-exorcism.json", "section-susceptible-to-exorcism:p1", "6a8379261ad93077c998404e932b42a13c353d0f6cb6b4eb715a9e67905e76d3");
  assert.match(exorcism, /forced to leave the box immediately/);

  const story = storyWithCanonical();
  story.fear.eventPrograms["1"] = [{ op: "ghost-librarian", exorcismSkillId: "exorcism", bookItemIds: [] }];
  const librarian = newState(story, { items: { "holy-water": 1 } }); librarian.arcaneSkills.exorcism = 1;
  let resolved = resolveEvent(story, librarian, roller());
  resolved = advanceFear(story, resolved, { type: "choose", choice: "exorcise" }, roller(6));
  assert.equal(resolved.xp, 0, "the table interaction is not a combat encounter and neither source row prints an XP reward");

  story.fear.eventPrograms["1"] = [{ op: "mirina-encounter", exorcismSkillId: "exorcism" }];
  const mirina = newState(story, { items: { "holy-water": 1 } }); mirina.arcaneSkills.exorcism = 1;
  resolved = resolveEvent(story, mirina, roller(6));
  resolved = advanceFear(story, resolved, { type: "choose", choice: "exorcise:holy-water" }, roller(6));
  assert.equal(resolved.xp, 0, "Mirina is removed from the campaign; her row prints no separate XP reward");
  assert.equal(resolved.missionProgress["flag:mirina-exorcised"], true);
});

test("Demon Cat is an Animal with exorcism susceptibility, not a source-declared Holy Water target", () => {
  const row = sourceParagraph("section-possessed-table.json", "section-possessed-table:p3", "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");
  assert.match(row, /Demon Cat, L4 Animal/);
  assert.match(row, /Susceptible to exorcism/);
  assert.doesNotMatch(row, /vulnerable to holy water/i);
  const vulnerability = sourceParagraph("section-vulnerabilities.json", "section-vulnerabilities:p1", "aaded2ec81210903c56c22f4aa48e69700049285bb3d35fa597ec448a8e9349c");
  assert.match(vulnerability, /Some undead and demons, for example, are vulnerable to holy water/);
  assert.deepEqual(reviewed.enemies["demon-cat"].tags, ["animal", "susceptible-exorcism"]);

  const story = storyWithCanonical();
  story.fear.eventPrograms["1"] = [{ op: "start-combat", enemyId: "demon-cat", count: 1 }];
  const combat = resolveEvent(story, newState(story, { items: { "holy-water": 1 } }), roller(5));
  assert.equal(combat.combat?.enemyId, "demon-cat");
  assert.equal(availableFearActions(story, combat).some(({ action }) => action.type === "use-item" && action.target === "holy-water"), false,
    "an animal that is not stated to be vulnerable must not inherit Holy Water eligibility solely from its name");
});

test("Face in the Mist resolves exactly three separate source L4 Fear checks and charges each failure", () => {
  const row = sourceParagraph("section-ghosts-table.json", "section-ghosts-table:p4", "11141dab5ab5735eca580cc363e9caed555c8d646dd5cf5764841f84944b7c07");
  assert.match(row, /Roll three L4 saves/);
  assert.match(row, /Lose 1 Sanity with each failure/);
  const story = storyWithCanonical();
  story.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "ghosts" }];
  const result = resolveEvent(story, newState(story), roller(4, 1, 1, 1));
  // The first failed check queues the Mental-Scar substitution; the batch's later losses are accepted immediately.
  // Each failed check is a separate source Sanity loss, so each queues its own Mental-Scar substitution.
  let settled = result;
  for (let step = 0; step < 3; step++) {
    assert.equal(settled.pending?.kind, "injury-prevention", `failed check ${step + 1} offers the substitution`);
    settled = advanceFear(story, settled, { type: "choose", choice: "take-loss" }, roller());
  }
  assert.equal(settled.pending, undefined);
  assert.equal(settled.sanity, 5);
  assert.ok(settled.log.some(line => line.includes("1/3")));
  assert.ok(settled.log.some(line => line.includes("2/3")));
  assert.ok(settled.log.some(line => line.includes("3/3")));
});

test("Possessed Doll applies its Fear save once per campaign, then starts later encounters without another save", () => {
  const row = sourceParagraph("section-possessed-table.json", "section-possessed-table:p2", "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");
  assert.match(row, /when you first meet a doll in the campaign/);
  const story = storyWithCanonical();
  story.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "doll-once" }];
  const sourceEntry = structuredClone(reviewed.tables.possessed.entries.find(entry => entry.roll === 2)!);
  story.fear.tables["doll-once"] = { die: "D6", entries: [{ ...sourceEntry, roll: [1, 6] }] };
  let result = resolveEvent(story, newState(story), roller(1, 1));
  // The failed campaign-first Fear save queues the Mental-Scar substitution before the encounter continues.
  assert.equal(result.pending?.kind, "injury-prevention", result.log.join("\n"));
  result = advanceFear(story, result, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(result.sanity, 7, result.log.join("\n"));
  assert.equal(result.missionProgress["flag:possessed-doll-fear-tested"], true);
  result = advanceFear(story, result, { type: "escape" }, roller(6));
  assert.equal(result.combat, undefined);
  result = resolveEvent(story, result, roller(1));
  assert.equal(result.combat?.enemyId, "possessed-doll");
  assert.equal(result.sanity, 7);
});

test("Possessed Objects rolls its printed D6 group size and 2-in-6 surprise", () => {
  const row = sourceParagraph("section-possessed-table.json", "section-possessed-table:p2", "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");
  assert.match(row, /3 d6 Possessed Objects/);
  assert.match(row, /2 in 6 chance of surprise/);
  const story = storyWithCanonical();
  story.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "objects" }];
  story.fear.tables.objects = { die: "D6", entries: [structuredClone(reviewed.tables.possessed.entries.find(entry => entry.roll === 3)!)] };
  const result = resolveEvent(story, newState(story), roller(3, 4, 1));
  assert.equal(result.combat?.enemyId, "possessed-objects");
  assert.equal(result.combat?.count, 4);
  assert.equal(result.combat?.surprise, true);
  assert.equal(result.combat?.playerFirst, false);
});

test("Demon Cat makes its L1 Magic attack each turn for paired Life and Sanity loss, and Cat Food adds +2 Escape", () => {
  const row = sourceParagraph("section-possessed-table.json", "section-possessed-table:p3", "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");
  assert.match(row, /Every turn, you must save vs. L1 Magic or lose 1 Sanity and 1 Life/);
  assert.match(row, /1 can of cat food/);
  const story = storyWithCanonical();
  story.fear.eventPrograms["1"] = [{ op: "start-combat", enemyId: "demon-cat", count: 1 }];
  let combat = resolveEvent(story, newState(story), roller(5));
  assert.equal(combat.combat?.playerFirst, true);
  combat = advanceFear(story, combat, { type: "attack" }, roller(6));
  assert.equal(combat.combat?.playerFirst, false);
  const hp = combat.hp, sanity = combat.sanity;
  combat = advanceFear(story, combat, { type: "defend" }, roller(1));
  // The failed Magic save's 1-point Sanity loss queues the Mental-Scar substitution; take it as loss.
  assert.equal(combat.pending?.kind, "injury-prevention");
  combat = advanceFear(story, combat, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(combat.hp, hp - 1);
  assert.equal(combat.sanity, sanity - 1);
  assert.equal(combat.combat?.playerFirst, true);

  const bait = resolveEvent(story, newState(story, { items: { "cat-food": 1 } }), roller(5));
  assert.ok(availableFearActions(story, bait).some(({ action }) => action.type === "escape" && action.choice === "cat-food"));
  const escaped = advanceFear(story, bait, { type: "escape", choice: "cat-food" }, roller(3));
  assert.equal(escaped.combat, undefined, "Escape 3 + source +2 meets the Cat's L4 threshold");
  assert.equal(escaped.inventory["cat-food"], undefined);
});

test("Demon Dog checks flee only by a place of worship, and its bait gives +2 Escape", () => {
  const row = sourceParagraph("section-possessed-table.json", "section-possessed-table:p4", "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");
  assert.match(row, /place of worship or in an area neighboring a place of worship/);
  assert.match(row, /On a 1 to 3, it flees/);
  assert.match(row, /dog food or 1 dog toy/);
  const story = storyWithCanonical();
  story.fear.eventPrograms["1"] = [{ op: "start-combat", enemyId: "demon-dog", count: 1 }];
  story.fear.weapons.heavy = { label: "Heavy weapon", damage: 3 };

  const away = newState(story, { weapon: "heavy" });
  let result = resolveEvent(story, away, roller());
  result = advanceFear(story, result, { type: "attack" }, roller(6));
  assert.equal(result.combat?.enemyLife, 3);
  assert.equal(result.combat?.fleeCheckResolved, undefined, "no worship at/next to the current location means no threshold roll");
  assert.equal(result.combatResult, undefined);

  const worship = newState(story, { weapon: "heavy" });
  worship.mapSheets[0].boxes[0].locationType = "worship";
  result = resolveEvent(story, worship, roller());
  result = advanceFear(story, result, { type: "attack" }, roller(6, 1));
  assert.equal(result.combat, undefined, "at a worship location, 1 on the threshold D6 makes the dog flee");
  assert.equal(result.combatResult?.outcome, "fled");

  const bait = resolveEvent(story, newState(story, { items: { "dog-toy": 1 } }), roller());
  assert.ok(availableFearActions(story, bait).some(({ action }) => action.type === "escape" && action.choice === "dog-toy"));
  const escaped = advanceFear(story, bait, { type: "escape", choice: "dog-toy" }, roller(3));
  assert.equal(escaped.combat, undefined, "Escape 3 + source +2 meets the Dog's L5 threshold");
  assert.equal(escaped.inventory["dog-toy"], undefined);
});

test("Possessed People rolls the unique event once after the last D6-group member, on a 1 only", () => {
  const row = sourceParagraph("section-possessed-table.json", "section-possessed-table:p5", "032acdd8db3808e7df50d2772713439e8bc41b04113097b2da583d762d23ce3c");
  assert.match(row, /When the last one is killed, roll d6/);
  assert.match(row, /If you roll a 1, play unique event #3/);
  const story = storyWithCanonical();
  story.fear.tables["possessed-two"] = { die: "D6", entries: [{ ...structuredClone(reviewed.tables.possessed.entries.find(entry => entry.roll === 6)!), roll: [1, 6] }] };
  story.fear.eventPrograms["1"] = [{ op: "roll-table", tableId: "possessed-two" }];
  story.fear.weapons.heavy = { label: "Heavy weapon", damage: 2 };
  const start = resolveEvent(story, newState(story, { weapon: "heavy" }), roller(1, 2));
  assert.equal(start.combat?.count, 2);
  let result = advanceFear(story, start, { type: "attack" }, roller(3));
  assert.equal(result.combat?.count, 1);
  assert.equal(result.pendingEvent?.eventId, "1", "the unique event is not rolled before the last member falls");
  result = advanceFear(story, result, { type: "defend" }, roller(6));
  assert.equal(result.combat?.playerFirst, true);
  result = advanceFear(story, result, { type: "attack" }, roller(3, 1));
  assert.equal(result.combat, undefined);
  assert.equal(result.nodeId, "3");
});
