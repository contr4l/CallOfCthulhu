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
story.nodes = [...new Set([...refs, ...Array.from({ length: 106 }, (_, i) => String(i + 1))])].map(id => ({ id }));
function roller(...faces: number[]): FearDice { let i = 0; return () => faces[i++] ?? 1; }
function active(seed: Partial<FearState> = {}): FearState {
  const first = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, weaponIds: ["knife"], weaponId: "knife", ...seed }, roller(1));
  const state = advanceFear(story, first, { type: "choose", choice: "s1:b1" }, roller());
  state.pendingEvent = undefined; state.pending = undefined; state.deferredTables = []; state.deferredOperations = [];
  return state;
}

test("canonical taxonomy follows source classifications for vampire bats, human cultists, mummy, and Night Shadow", () => {
  const bat = story.fear.enemies["beasts-4"]!, cultists = story.fear.enemies["possessed-1"]!;
  const mummy = Object.values(story.fear.enemies).find(value => value.label.includes("木乃伊"))!;
  const shadow = story.fear.enemies["demonic-horrors-4"]!;
  assert.ok(bat.tags?.includes("animal")); assert.ok(!bat.tags?.includes("vampire"));
  assert.ok(cultists.tags?.includes("human")); assert.ok(mummy.tags?.includes("mummy")); assert.ok(shadow.tags?.includes("shadow"));
  const bats = readFileSync("scripts/alone-against-fear/fragments/section-beasts-table.json", "utf8");
  const cult = readFileSync("scripts/alone-against-fear/fragments/section-possessed-table.json", "utf8");
  assert.match(bats, /L5 Animal/); assert.match(cult, /L2 Humans/);
});

test("public reviewed operations debit ordinary Sanity and consume alcohol shield only on the first actual encounter loss", () => {
  const local = structuredClone(story);
  local.fear.eventPrograms["audit-sanity"] = [{ op: "resource", key: "sanity", amount: -1 }];
  let state = active();
  state.pendingEvent = { eventId: "audit-sanity", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  state = advanceFear(local, state, { type: "resolve-event", target: "audit-sanity" }, roller());
  assert.equal(state.pending?.kind, "injury-prevention", "a 1-point Sanity loss may be traded for a Mental Scar instead");
  state = advanceFear(local, state, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(state.sanity, 7, "a normal negative SAN resource still reaches the state");

  state = active({ inventory: { wine: 1 } });
  state.missionProgress["fear:item:drunk:boxes"] = 2;
  state.missionProgress["fear:item:drunk:sanity-shield"] = true;
  state.missionProgress["fear:item:drunk:encounter-active"] = true;
  state.pendingEvent = { eventId: "audit-sanity", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  state = advanceFear(local, state, { type: "resolve-event", target: "audit-sanity" }, roller());
  assert.equal(state.pending, undefined, "the shield fully absorbs the point, so no choice is offered");
  assert.equal(state.sanity, 8, "the first point in the encounter is ignored");
  assert.equal(state.missionProgress["fear:item:drunk:sanity-shield"], false);
  state.pendingEvent = { eventId: "audit-sanity", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  state = advanceFear(local, state, { type: "resolve-event", target: "audit-sanity" }, roller());
  state = advanceFear(local, state, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(state.sanity, 7, "later losses in that encounter are not shielded");
});

test("Diary counts source XP gains, while XP spending does not advance its threshold", () => {
  const local = structuredClone(story);
  local.fear.eventPrograms["audit-xp"] = [{ op: "resource", key: "xp", amount: 4 }];
  let state = active({ inventory: { diary: 1 }, xp: 0 });
  state.pendingEvent = { eventId: "audit-xp", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  state = advanceFear(local, state, { type: "resolve-event", target: "audit-xp" }, roller());
  assert.equal(state.xp, 4); assert.equal(state.missionProgress["fear:item:diary:xp-progress"], 4);
  state.xp -= 3;
  state.pendingEvent = { eventId: "audit-xp", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  state = advanceFear(local, state, { type: "resolve-event", target: "audit-xp" }, roller());
  assert.equal(state.xp, 6, "the new four XP crosses one threshold; the manual spend did not move it");
  assert.equal(state.missionProgress["fear:item:diary:xp-progress"], 3);
});

test("Kitchen Knife satisfies the source Ritual Dagger component without consuming the weapon", () => {
  let state = active({ weaponIds: ["knife", "kitchen-knife"], weaponId: "kitchen-knife", arcaneSkills: { pentagram: 1 },
    inventory: { "art-materials": 1, candle: 7 } });
  const cast = availableFearActions(story, state).find(value => value.action.type === "cast-arcane" && value.action.skill === "pentagram" && value.action.target === "cast");
  assert.ok(cast, "the source-produced Kitchen Knife is the Ritual Dagger alias");
  state = advanceFear(story, state, cast.action, roller());
  assert.equal(state.missionProgress["flag:pentagram"], true);
  assert.ok(state.weaponIds.includes("kitchen-knife"));
  assert.equal(state.inventory["ritual-dagger"], undefined);
});

test("Possessed Doll reveal pauses before its campaign-first Fear check so wine can protect that exact encounter", () => {
  const local = structuredClone(story);
  local.fear.eventPrograms["audit-doll"] = [{ op: "roll-table", tableId: "possessed" }];
  let state = active({ inventory: { wine: 1 } });
  state.pendingEvent = { eventId: "audit-doll", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  state = advanceFear(local, state, { type: "resolve-event", target: "audit-doll" }, roller(2));
  assert.equal(state.pending?.kind, "fear-item-before-encounter");
  assert.equal(state.sanity, 8, "the source L4 Doll Fear check has not happened yet");
  assert.ok(state.pending.options.includes("item:wine"));
  state = advanceFear(local, state, { type: "choose", choice: "item:wine" }, roller(3));
  assert.equal(state.combat, undefined, "choosing wine does not bypass the actual Fear check or encounter");
  assert.equal(state.pending?.kind, "fear-item-before-encounter", "the same source continuation remains pending until continued");
  state = advanceFear(local, state, { type: "choose", choice: "continue" }, roller(3));
  assert.equal(state.combat?.enemyId, "possessed-doll");
  assert.equal(state.missionProgress["flag:possessed-doll-fear-tested"], true);
  assert.equal(state.sanity, 8, "wine prevents the first point lost in this encounter");
  assert.equal(state.missionProgress["fear:item:drunk:sanity-shield"], false);
});

test("food may be declined before a cat encounter and retained for its source Escape bonus", () => {
  const local = structuredClone(story);
  local.fear.eventPrograms["audit-cat"] = [{ op: "start-combat", enemyId: "demon-cat", count: 1 }];
  let state = active({ inventory: { "cat-food": 1 } });
  state.pendingEvent = { eventId: "audit-cat", alreadyPlayed: false, started: false, visitCount: state.visitCount };
  state = advanceFear(local, state, { type: "resolve-event", target: "audit-cat" }, roller());
  assert.equal(state.pending?.kind, "fear-item-before-encounter");
  assert.ok(state.pending.options.includes("item:cat-food"));
  state = advanceFear(local, state, { type: "choose", choice: "continue" }, roller(6));
  assert.equal(state.combat?.enemyId, "demon-cat");
  assert.equal(state.inventory["cat-food"], 1);
  assert.ok(availableFearActions(local, state).some(({ action }) => action.type === "escape" && action.choice === "cat-food"));
});

test("source-defined canine and child profiles expose the matching bait only on the public source check path", () => {
  const beastsBytes = readFileSync("scripts/alone-against-fear/fragments/section-beasts-table.json");
  const childrenBytes = readFileSync("scripts/alone-against-fear/fragments/section-witch-children-table.json");
  const demonBytes = readFileSync("scripts/alone-against-fear/fragments/section-demonic-horrors-table.json");
  const schoolBytes = readFileSync("scripts/alone-against-fear/fragments/section-school-table.json");
  assert.equal(createHash("sha256").update(beastsBytes).digest("hex"), "a41400175ef73bfe422335f8c2e7edbff4120921cb4ac1424050a3275c6b21f0");
  assert.equal(createHash("sha256").update(childrenBytes).digest("hex"), "e7e51c98b825f841cb01c40680f2a2bcdea075d46035b08ce58b0fa79e15e603");
  assert.equal(createHash("sha256").update(demonBytes).digest("hex"), "b8efccace0ba210f737cef830df09f225bec7e4ddbb4d0625df3b26d9e9eb939");
  assert.equal(createHash("sha256").update(schoolBytes).digest("hex"), "b7de8e9c4e124a6911d55dd86afd292f86486af05455f4ac8a4fa5a7529f1878");
  const beasts = (JSON.parse(beastsBytes.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs;
  const kids = (JSON.parse(childrenBytes.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs;
  const demons = (JSON.parse(demonBytes.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs;
  const school = (JSON.parse(schoolBytes.toString()) as { paragraphs: { id: string; text: string }[] }).paragraphs;
  assert.match(beasts.find(value => value.id === "section-beasts-table:p2")!.text, /Zombie Dog/);
  assert.match(beasts.find(value => value.id === "section-beasts-table:p3")!.text, /Large Rabid Dog/);
  assert.match(demons.find(value => value.id === "section-demonic-horrors-table:p6")!.text, /Hell Hound/);
  assert.match(kids.find(value => value.id === "section-witch-children-table:p1")!.text, /Witch Child/);
  assert.match(kids.find(value => value.id === "section-witch-children-table:p2")!.text, /Children in Pumpkin Masks/);
  assert.match(kids.find(value => value.id === "section-witch-children-table:p4")!.text, /Children in Rabbit Masks/);
  assert.match(school.find(value => value.id === "section-school-table:p4")!.text, /zombie children/);

  const local = structuredClone(story);
  const canines = ["beasts-2", "beasts-3", "demonic-horrors-6"];
  for (const enemyId of canines) {
    local.fear.eventPrograms["audit-canine"] = [{ op: "start-combat", enemyId, count: 1 }];
    let state = active({ inventory: { "dog-food": 1 } });
    state.pendingEvent = { eventId: "audit-canine", alreadyPlayed: false, started: false, visitCount: state.visitCount };
    state = advanceFear(local, state, { type: "resolve-event", target: "audit-canine" }, roller());
    assert.equal(state.pending?.kind, "fear-item-before-encounter", `${enemyId} has a source pre-encounter continuation`);
    assert.ok(state.pending.options.includes("item:dog-food"), `${enemyId} exposes the canine choice`);
  }

  const children = ["demonic-horrors-1", "witch-children-1", "witch-children-2", "witch-children-4", "zombie-child"];
  for (const enemyId of children) {
    local.fear.eventPrograms["audit-child-check"] = [{ op: "roll-check", context: "charisma", level: 6, enemyId }];
    let state = active({ inventory: { toy: 1 } });
    state.pendingEvent = { eventId: "audit-child-check", alreadyPlayed: false, started: false, visitCount: state.visitCount };
    state = advanceFear(local, state, { type: "resolve-event", target: "audit-child-check" }, roller());
    assert.equal(state.pending?.kind, "fear-item-check", `${enemyId} check pauses for source item choice`);
    assert.ok(state.pending.options.includes("item:toy"), `${enemyId} exposes the child-specific bonus`);
  }

  for (const notChild of ["witch-children-3", "witch-children-5", "witch-children-6"]) {
    local.fear.eventPrograms["audit-not-child-check"] = [{ op: "roll-check", context: "charisma", level: 6, enemyId: notChild }];
    let state = active({ inventory: { toy: 1 } });
    state.pendingEvent = { eventId: "audit-not-child-check", alreadyPlayed: false, started: false, visitCount: state.visitCount };
    state = advanceFear(local, state, { type: "resolve-event", target: "audit-not-child-check" }, roller());
    assert.notEqual(state.pending?.kind, "fear-item-check", `${notChild} is not implicitly classified as a child`);
  }
});
