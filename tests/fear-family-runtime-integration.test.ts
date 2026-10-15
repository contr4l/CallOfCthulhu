import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FearCombat, FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const def: FearDefinition = {
  format: "aaf-fear-definition@1", source: { pdfSha256: "a".repeat(64), pages: 106 },
  map: { boxesPerSheet: 30, rows: 6, columns: 5, adjacency: "orthogonal", topologyBasis: "web-adaptation", start: { sheet: 1, box: 1 }, safehouseLimit: 3, safehouseLifetime: "nearest-first" },
  rules: { foodEveryBoxes: 5, townExplorationTable: "town", randomEncounterTable: "encounter", usefulItemTable: "useful", randomItemTable: "randomItems", maxScars: 3, maxTraumas: 3, searchOncePerBox: true, exploredAreaEncounter: { numerator: 1, denominator: 6 }, sixExplodes: true, naturalOneFails: true, naturalSixSucceeds: true },
  sceneRefs: { entry: "entry", exploration: "explore", missions: "missions", tables: {}, events: {}, specialEvents: {}, endings: {} },
  eventPrograms: {}, skills: { "danger-sense": { label: "危险感知", xp: 4, modifiers: {} } },
  weapons: { knife: { label: "小刀", damage: 1, modifier: 1 }, unarmed: { label: "徒手", damage: 1 } },
  enemies: {
    "aliens-6": { label: "触手兽", level: 4, life: 4, damage: 1, familyRule: "tentacled-beast" },
    "lab-horrors-2": { label: "杀人机器人", level: 4, life: 4, damage: 1, familyRule: "murdering-robot" },
    "aliens-5": { label: "米戈", level: 4, life: 1, damage: 1, familyRule: "mi-go" },
    "lab-horrors-1": { label: "黏液怪", level: 4, life: 8, damage: 1, familyRule: "blob" },
    "living-dolls-6": { label: "卡莉娜", level: 4, life: 5, damage: 1, familyRule: "kalina" },
    "living-dolls-1": { label: "薇薇娜", level: 5, life: 4, damage: 0, familyRule: "vivina" },
    "living-dolls-4": { label: "玛拉娅", level: 4, life: 12, damage: 1, familyRule: "maraya" },
    "living-dolls-6-dinosaur": { label: "玩具恐龙", level: 4, life: 6, damage: 2 },
    "lab-horrors-5": { label: "触手恐怖", level: 4, life: 5, damage: 1, familyRule: "tentacled-horror" },
    "lab-horrors-6": { label: "巨虫", level: 4, life: 6, damage: 1, familyRule: "giant-bug" },
  },
  items: {}, tables: {
    town: { die: "D6", entries: [{ roll: [1, 6], result: "quiet" }] },
    encounter: { die: "D6", entries: [{ roll: [1, 6], result: "aliens-5", operations: [{ op: "start-combat", enemyId: "aliens-5", count: 1 }] }] },
    useful: { die: "D6", entries: [{ roll: [1, 6], result: "nothing" }] },
    randomItems: { die: "D6", entries: [{ roll: [1, 6], result: "nothing" }] },
  }, missions: {}, gates: { required: 7, level: 6 },
};
const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: ["entry", "explore", "missions"].map(id => ({ id })), fear: def };
function dice(...faces: number[]): FearDice { let i = 0; return () => faces[i++] ?? 1; }
function playerState(): FearState {
  const s = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, weaponIds: ["knife"], weaponId: "knife" }, dice(1));
  return advanceFear(story, s, { type: "choose", choice: "s1:b1" }, dice());
}
function combat(enemyId: string, extra: Partial<FearCombat> = {}): FearCombat {
  const enemy = def.enemies[enemyId];
  return { enemyId, count: 1, defeatedCount: 0, enemyLevel: enemy.level, enemyLife: enemy.life, enemyLives: [enemy.life], enemyDamage: enemy.damage,
    playerFirst: false, round: 1, weaponId: "knife", surprise: false, attackDisabled: false,
    familyRule: enemy.familyRule, familyState: {}, ...extra };
}

test("family enemy-turn produces three separate tentacle defenses and advances the round", () => {
  const s = playerState(); s.combat = combat("aliens-6", { familyState: { tentacles: 3 } });
  const next = advanceFear(story, s, { type: "defend" }, dice(6, 6, 6));
  assert.equal(next.combat?.round, 2);
  assert.equal(next.combat?.playerFirst, true);
  assert.equal(next.log.filter(line => line.includes("攻击防御骰")).length, 3);
});

test("the robot's stored failed-disable marker is consumed by exactly one defense, even on a natural six", () => {
  const s = playerState(); s.hp = 8;
  s.combat = combat("lab-horrors-2", { familyState: { robotAutoHitNext: true } });
  const next = advanceFear(story, s, { type: "defend" }, dice(6));
  assert.equal(next.pending?.kind, "injury-prevention");
  assert.equal(next.combat?.familyState?.robotAutoHitNext, false);
  const resolved = advanceFear(story, next, { type: "choose", choice: "take-loss" }, dice());
  assert.equal(resolved.hp, 7);
});

test("Mi-Go combat start runs the source L5 fear save, and defeat opens the black-stone decision", () => {
  const miGoStory = structuredClone(story);
  miGoStory.fear.eventPrograms["1"] = [{ op: "start-combat", enemyId: "aliens-5", count: 1 }];
  miGoStory.nodes.push({ id: "event-30" }, { id: "32" });
  miGoStory.fear.items!["mysterious-black-stone"] = { label: "覆有象形文字的神秘黑石" };
  miGoStory.fear.sceneRefs.events["30"] = "event-30";
  miGoStory.fear.eventPrograms["30"] = [{ op: "choose-effect", prompt: "选择是否让孩子离开或挑战帮派。", choices: { leave: [], intervene: [{ op: "route", scene: "32" }] } }];
  const s = playerState(); s.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  const started = advanceFear(miGoStory, s, { type: "resolve-event", target: "1" }, dice(1));
  assert.equal(started.sanity, 7);
  assert.equal(started.combat?.enemyId, "aliens-5");
  started.combat!.playerFirst = true;
  started.combat!.enemyLives = [1]; started.combat!.enemyLife = 1;
  const defeated = advanceFear(miGoStory, started, { type: "attack" }, dice(6, 1, 6));
  assert.equal(defeated.combat, undefined);
  assert.equal(defeated.pending?.kind, "family-black-stone");
  assert.deepEqual(defeated.pending?.options, ["pick-black-stone", "leave-black-stone"]);
  const pick = availableFearActions(miGoStory, defeated).find(({ action }) => action.type === "choose" && action.choice === "pick-black-stone")?.action;
  assert.ok(pick, "the pickup is available as a real player choice");
  const picked = advanceFear(miGoStory, defeated, pick!, dice());
  assert.equal(picked.inventory["mysterious-black-stone"], 1);
  assert.equal(picked.pendingEvent?.eventId, "30");
  assert.equal(picked.nodeId, "event-30");
  const openEvent = availableFearActions(miGoStory, picked).find(({ action }) => action.type === "resolve-event" && action.target === "30")?.action;
  assert.ok(openEvent, "picking the stone exposes the unique event through the public action menu");
  const event = advanceFear(miGoStory, picked, openEvent!, dice());
  assert.equal(event.pending?.kind, "source-choice");
  assert.deepEqual(event.pending?.options, ["leave", "intervene"]);
});

test("Kalina and her dinosaur are separate combat targets, and defeating Kalina drops both", () => {
  const familyStory = structuredClone(story);
  const s = playerState();
  s.combat = combat("living-dolls-6", { playerFirst: true, familyState: { kalinaAlive: true, dinosaurAlive: true }, groups: [
    { enemyId: "living-dolls-6", enemyLives: [5], defeatedCount: 0 },
    { enemyId: "living-dolls-6-dinosaur", enemyLives: [6], defeatedCount: 0 },
  ] });
  const targets = advanceFear(familyStory, s, { type: "attack", target: "living-dolls-6-dinosaur" }, dice(2));
  assert.equal(targets.combat?.groups?.[0].enemyLives[0], 5);
  assert.equal(targets.combat?.groups?.[1].enemyLives[0], 6);
  targets.combat!.playerFirst = true;
  const kill = advanceFear(familyStory, targets, { type: "attack", target: "living-dolls-6" }, dice(6, 6, 6, 6, 2));
  assert.equal(kill.combat, undefined);
  assert.equal(kill.combatResult?.outcome, "defeated");
});

test("source family escape restrictions track tentacle damage and the Giant Bug's flying form", () => {
  const s = playerState(); s.combat = combat("lab-horrors-5", { playerFirst: true, familyState: { tentacledEscapeLocked: true, targetLifeBeforeTurn: 3 } });
  assert.throws(() => advanceFear(story, s, { type: "escape" }, dice(6)), /unavailable in the current phase/);
  s.combat!.familyState!.targetLifeBeforeTurn = 1;
  const escaped = advanceFear(story, s, { type: "escape" }, dice(6));
  assert.equal(escaped.combat, undefined);
  const flying = playerState(); flying.combat = combat("lab-horrors-6", { playerFirst: true, familyState: { flyingBug: true } });
  assert.throws(() => advanceFear(story, flying, { type: "escape" }, dice(6)), /unavailable in the current phase/);
});

test("public Mi-Go reward pick adds the black stone and opens event 30", () => {
  const miGoStory = structuredClone(story);
  miGoStory.nodes.push({ id: "event-30" }, { id: "32" });
  miGoStory.fear.items!["mysterious-black-stone"] = { label: "覆有象形文字的神秘黑石" };
  miGoStory.fear.sceneRefs.events["30"] = "event-30";
  miGoStory.fear.eventPrograms["30"] = [{ op: "choose-effect", prompt: "选择是否让孩子离开或挑战帮派。", choices: { leave: [], intervene: [{ op: "route", scene: "32" }] } }];
  const s = playerState();
  s.combat = combat("aliens-5", { playerFirst: true });
  s.combat.enemyLives = [1]; s.combat.enemyLife = 1;
  const defeat = advanceFear(miGoStory, s, { type: "attack" }, dice(6, 1, 6));
  assert.equal(defeat.pending?.kind, "family-black-stone");
  const pick = availableFearActions(miGoStory, defeat).find(({ action }) => action.type === "choose" && action.choice === "pick-black-stone")?.action;
  assert.ok(pick);
  const picked = advanceFear(miGoStory, defeat, pick!, dice());
  assert.equal(picked.inventory["mysterious-black-stone"], 1);
  assert.equal(picked.pendingEvent?.eventId, "30");
  const openEvent = availableFearActions(miGoStory, picked).find(({ action }) => action.type === "resolve-event" && action.target === "30")?.action;
  assert.ok(openEvent);
  const event = advanceFear(miGoStory, picked, openEvent!, dice());
  assert.equal(event.pending?.kind, "source-choice");
  assert.deepEqual(event.pending?.options, ["leave", "intervene"]);
});

test("public Blob escape stores its encounter and a later encounter uses the stronger profile", () => {
  const blobStory = structuredClone(story);
  blobStory.fear.eventPrograms["1"] = [{ op: "start-combat", enemyId: "lab-horrors-1", count: 1 }];
  blobStory.fear.eventPrograms["2"] = [{ op: "start-combat", enemyId: "lab-horrors-1", count: 1 }];
  let s = playerState();
  s.pendingEvent = { eventId: "1", alreadyPlayed: false, started: false, visitCount: s.visitCount };
  let first = advanceFear(blobStory, s, { type: "resolve-event", target: "1" }, dice());
  assert.equal(first.combat?.enemyLife, 8);
  first.combat!.playerFirst = true;
  const flee = availableFearActions(blobStory, first).find(({ action }) => action.type === "escape")?.action;
  assert.ok(flee);
  const escaped = advanceFear(blobStory, first, flee!, dice(6));
  assert.equal(escaped.missionProgress["fear:family:blob:escaped"], true);
  assert.ok(escaped.mapSheets[0].boxes[0].occupiedEncounter, "fleeing keeps the actual opponent state in its box");
  escaped.pendingEvent = { eventId: "2", alreadyPlayed: false, started: false, visitCount: escaped.visitCount };
  const returned = advanceFear(blobStory, escaped, { type: "resolve-event", target: "2" }, dice());
  assert.equal(returned.combat?.enemyLevel, 5);
  assert.equal(returned.combat?.enemyLife, 10);
  assert.equal(returned.combat?.escapeModifier, 0);
});

test("public Maraya natural-1 Defense wounds both eyes and ends the adventure", () => {
  const marayaStory = structuredClone(story);
  const s = playerState(); s.combat = combat("living-dolls-4", { playerFirst: false });
  const firstDefense = advanceFear(marayaStory, s, { type: "defend" }, dice(1, 6));
  assert.equal(firstDefense.missionProgress["fear:family:maraya:eye-wounds"], 1);
  assert.equal(firstDefense.status, "active");
  const afterFirstHit = firstDefense.pending
    ? advanceFear(marayaStory, firstDefense, { type: "choose", choice: "take-loss" }, dice())
    : firstDefense;
  const attack = advanceFear(marayaStory, afterFirstHit, { type: "attack" }, dice(4));
  assert.ok(attack.combat);
  const secondDefense = advanceFear(marayaStory, attack, { type: "defend" }, dice(1, 6));
  assert.equal(secondDefense.missionProgress["fear:family:maraya:eye-wounds"], 2);
  assert.equal(secondDefense.status, "dead");
});

test("Vivina cohabitation keeps a secondary Demonic Goat's knockdown actions available", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-demonic-horrors-table.json";
  const source = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(source).digest("hex"), "b8efccace0ba210f737cef830df09f225bec7e4ddbb4d0625df3b26d9e9eb939");
  assert.ok((JSON.parse(source.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs
    .find(paragraph => paragraph.id === "section-demonic-horrors-table:p3")?.text.includes("must spend 1 action to stand up"));
  const mixedStory = structuredClone(story);
  mixedStory.fear.enemies["demonic-goat"] = {
    label: "恶魔山羊", level: 3, life: 4, damage: 1, specialRule: "demonic-goat", tags: ["demon"],
  };
  const s = playerState();
  s.combat = combat("living-dolls-1", { playerFirst: false, groups: [
    { enemyId: "living-dolls-1", enemyLives: [4], defeatedCount: 0 },
    { enemyId: "demonic-goat", enemyLives: [4], defeatedCount: 0 },
  ] });
  let defended = advanceFear(mixedStory, s, { type: "defend" }, dice(6, 1));
  assert.equal(defended.combat?.knockedDown, true);
  while (defended.pending) {
    const choice = defended.pending.options.includes("take-damage") ? "take-damage"
      : defended.pending.options.includes("take-loss") ? "take-loss" : defended.pending.options[0];
    defended = advanceFear(mixedStory, defended, { type: "choose", choice }, dice());
  }
  assert.ok(availableFearActions(mixedStory, defended).some(value => value.action.type === "stand-up"),
    "a source Demonic Goat hit in a secondary group must expose its source stand-up action");
});

test("a secondary Tickling Ghost still makes its distinct item-stealing Defense attack", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-ghosts-table.json";
  const source = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(source).digest("hex"), "11141dab5ab5735eca580cc363e9caed555c8d646dd5cf5764841f84944b7c07");
  assert.ok((JSON.parse(source.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs
    .find(paragraph => paragraph.id === "section-ghosts-table:p5")?.text.includes("On every failed Defense roll"));
  const mixedStory = structuredClone(story);
  mixedStory.fear.enemies["tickling-ghost"] = {
    label: "搔痒鬼", level: 4, life: 1, damage: 0, lifeMode: "infinite", specialRule: "tickling-ghost",
    tags: ["ghost", "susceptible-exorcism"],
  };
  mixedStory.fear.items ??= {};
  mixedStory.fear.items.bandage = { label: "绷带" };
  const s = playerState(); s.inventory.bandage = 1;
  s.combat = combat("living-dolls-1", { playerFirst: false, groups: [
    { enemyId: "living-dolls-1", enemyLives: [4], defeatedCount: 0 },
    { enemyId: "tickling-ghost", enemyLives: [1], defeatedCount: 0 },
  ] });
  const defended = advanceFear(mixedStory, s, { type: "defend" }, dice(6, 1));
  assert.equal(defended.pending?.kind, "tickling-theft",
    "a failed L4 Defense against the ghost must offer one carried item even while Vivina remains in combat");
  assert.ok(defended.pending?.options.includes("item:bandage"));
});

test("a secondary Murdering Robot exposes its source cable-disabling choice", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-lab-horrors-table.json";
  const source = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(source).digest("hex"), "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef");
  assert.ok((JSON.parse(source.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs
    .find(paragraph => paragraph.id === "section-lab-horrors-table:p2")?.text.includes("turn off the robot by disabling some cables"));
  const mixedStory = structuredClone(story);
  mixedStory.fear.enemies["lab-horrors-2"] = {
    label: "杀人机器人", level: 3, life: 5, damage: 1, familyRule: "murdering-robot", attackBounceChance: [3, 6],
  };
  const s = playerState();
  s.combat = combat("living-dolls-1", { playerFirst: true, groups: [
    { enemyId: "living-dolls-1", enemyLives: [4], defeatedCount: 0 },
    { enemyId: "lab-horrors-2", enemyLives: [5], defeatedCount: 0 },
  ] });
  assert.ok(availableFearActions(mixedStory, s).some(value => value.action.type === "choose"
    && value.action.choice?.startsWith("family:disable-robot")),
  "the incoming robot's source L4 Agile disable attempt should be available while Vivina remains active");
});

test("a secondary Demon Child gets its source L3 Magic save once each player turn", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-demonic-horrors-table.json";
  const source = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(source).digest("hex"), "b8efccace0ba210f737cef830df09f225bec7e4ddbb4d0625df3b26d9e9eb939");
  assert.ok((JSON.parse(source.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs
    .find(paragraph => paragraph.id === "section-demonic-horrors-table:p1")?.text.includes("Each turn, you must save vs. L3 Magic"));
  const mixedStory = structuredClone(story);
  mixedStory.fear.enemies["demonic-child"] = {
    label: "恶魔孩童", level: 3, life: 3, damage: 1, specialRule: "demon-child", tags: ["demon"],
  };
  const s = playerState();
  s.combat = combat("living-dolls-1", { playerFirst: true, groups: [
    { enemyId: "living-dolls-1", enemyLives: [4], defeatedCount: 0 },
    { enemyId: "demonic-child", enemyLives: [3], defeatedCount: 0, specialRule: "demon-child" },
  ] });
  const result = advanceFear(mixedStory, s, { type: "attack", target: "demonic-child" }, dice(1));
  assert.equal(result.missionProgress["flag:cursed"], true,
    "failed turn-bound Magic save curses the investigator before an attack can resolve");
  assert.equal(result.combat?.groups?.[1].enemyLives[0], 3);
  assert.equal(result.combat?.groups?.[1].sourceTurnCheckRound, 1,
    "the group persists its turn-check round independently of Vivina's family state");
  assert.equal(result.combat?.playerFirst, false);
});

test("a secondary Tentacled Beast gets four separately defended attacks and its escape lock", () => {
  const sourcePath = "scripts/alone-against-fear/fragments/section-aliens-table.json";
  const source = readFileSync(sourcePath);
  assert.equal(createHash("sha256").update(source).digest("hex"), "0ef05272d0312222e8976d259ce9ae392868ed0346de0f68e33a9fb00fc04ee8");
  assert.ok((JSON.parse(source.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs
    .find(paragraph => paragraph.id === "section-aliens-table:p6")?.text.includes("attacks each turn with 4 tentacles"));
  const mixedStory = structuredClone(story);
  mixedStory.fear.enemies["aliens-6"] = {
    label: "触手兽", level: 4, life: 4, damage: 1, familyRule: "tentacled-beast",
  };
  const s = playerState();
  s.combat = combat("living-dolls-1", { playerFirst: false, groups: [
    { enemyId: "living-dolls-1", enemyLives: [4], defeatedCount: 0 },
    { enemyId: "aliens-6", enemyLives: [4], defeatedCount: 0 },
  ] });
  const defended = advanceFear(mixedStory, s, { type: "defend" }, dice(6, 6, 6, 6, 6));
  assert.equal(defended.log.filter(line => line.includes("触手兽") && line.includes("攻击防御骰")).length, 4,
    "all four tentacles attack even when the creature is a secondary group");
  assert.equal(availableFearActions(mixedStory, defended).some(value => value.action.type === "escape"), false,
    JSON.stringify({ pending: defended.pending, combat: defended.combat, log: defended.log.slice(-8) }));
});

test("defeating multiple family groups preserves every group's printed loot decision", () => {
  const mixedStory = structuredClone(story);
  mixedStory.fear.items!["mysterious-black-stone"] = { label: "覆有象形文字的神秘黑石" };
  mixedStory.fear.weapons["magic-sword"] = { label: "魔法剑", damage: 1, modifier: 1, tags: ["magic"] };
  mixedStory.fear.enemies["aliens-5"] = { label: "米戈", level: 4, life: 1, damage: 1, familyRule: "mi-go" };
  mixedStory.fear.enemies["living-dolls-6"] = { label: "卡莉娜", level: 4, life: 1, damage: 1, familyRule: "kalina" };
  const s = playerState();
  s.weaponIds.push("magic-sword"); s.weaponId = "magic-sword";
  s.combat = combat("living-dolls-1", { playerFirst: true, groups: [
    { enemyId: "living-dolls-1", enemyLives: [1], defeatedCount: 0 },
    { enemyId: "aliens-5", enemyLives: [1], defeatedCount: 0 },
    { enemyId: "living-dolls-6", enemyLives: [1], defeatedCount: 0 },
  ] });
  s.combat.weaponId = "magic-sword";
  const cleanAttack = () => dice(6, 5, ...Array(38).fill(3));
  let result = advanceFear(mixedStory, s, { type: "attack", target: "living-dolls-6" }, cleanAttack());
  result.combat!.playerFirst = true;
  result = advanceFear(mixedStory, result, { type: "attack", target: "aliens-5" }, cleanAttack());
  result.combat!.playerFirst = true;
  result = advanceFear(mixedStory, result, { type: "attack", target: "living-dolls-1" }, cleanAttack());
  assert.equal(result.combat, undefined);
  assert.ok(["family-black-stone", "kalina-loot"].includes(result.pending?.kind ?? ""));
  const firstReward = result.pending?.kind;
  if (firstReward === "family-black-stone") {
    result = advanceFear(mixedStory, result, { type: "choose", choice: "leave-black-stone" }, dice());
    assert.equal(result.pending?.kind, "kalina-loot", "resolving Mi-Go's choice exposes Kalina's queued reward");
    result = advanceFear(mixedStory, result, { type: "choose", choice: "candles" }, dice(2));
  } else {
    result = advanceFear(mixedStory, result, { type: "choose", choice: "candles" }, dice(2));
    assert.equal(result.pending?.kind, "family-black-stone", "resolving Kalina's choice exposes Mi-Go's queued reward");
    result = advanceFear(mixedStory, result, { type: "choose", choice: "leave-black-stone" }, dice());
  }
  assert.equal(result.pending, undefined, "both source reward choices have been resolved");
  assert.equal(result.inventory.candle, 2);
});
