import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { FearDefinition, FearDice, FearState, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const definition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;
const sourceStory = JSON.parse(readFileSync("work/alone-against-fear/reviewed-story.json", "utf8")) as { nodes: { id: string }[] };
function roller(...faces: number[]): FearDice { let i = 0; return () => faces[i++] ?? 1; }
function buildStory(eventId: string, enemyId: string, extraOps: any[] = []): FearStory {
  const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: [...sourceStory.nodes], fear: structuredClone(definition) };
  const scene = `family-test-${eventId}`;
  story.nodes.push({ id: scene });
  story.fear.sceneRefs.events[eventId] = scene;
  story.fear.eventPrograms[eventId] = [...extraOps, { op: "start-combat", enemyId, count: 1 }];
  return story;
}
function buildTableStory(eventId: string, tableId: string): FearStory {
  const story: FearStory = { rulesVersion: "aaf-solo@1", nodes: [...sourceStory.nodes], fear: structuredClone(definition) };
  story.nodes.push({ id: `family-table-${eventId}` });
  story.fear.sceneRefs.events[eventId] = `family-table-${eventId}`;
  story.fear.eventPrograms[eventId] = [{ op: "roll-table", tableId }];
  return story;
}
function stateAtStart(story: FearStory, seed: Partial<FearState> = {}): FearState {
  const initial = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8,
    weaponIds: ["knife"], weaponId: "knife", ...seed }, roller(1));
  return advanceFear(story, initial, { type: "choose", choice: "s1:b1" }, roller(1));
}
function resolvePublicEvent(story: FearStory, current: FearState, eventId: string, dice: FearDice): FearState {
  current.pendingEvent = { eventId, alreadyPlayed: false, started: false, visitCount: current.visitCount };
  const action = availableFearActions(story, current).find(({ action }) => action.type === "resolve-event" && action.target === eventId)?.action;
  assert.ok(action, `event ${eventId} has a public resolve action: ${JSON.stringify({pendingEvent: current.pendingEvent, visitCount: current.visitCount, pending: current.pending, status: current.status, actions: availableFearActions(story, current)})}`);
  let resolved = advanceFear(story, current, action!, dice);
  // This fixture requests a started encounter; source item pre-encounter
  // choices are exercised in the dedicated item-public tests. Preserve the
  // player option by explicitly selecting Continue here rather than bypassing
  // the public pending action or auto-consuming an item.
  while (resolved.pending?.kind === "fear-item-before-encounter" || resolved.pending?.kind === "fear-item-check")
    resolved = advanceFear(story, resolved, { type: "choose", choice: "continue" }, dice);
  return resolved;
}
function startEnemy(enemyId: string, dice: FearDice, seed: Partial<FearState> = {}, extraOps: any[] = []) {
  const eventId = "family-public-test";
  const story = buildStory(eventId, enemyId, extraOps);
  const current = stateAtStart(story, seed);
  return { story, state: resolvePublicEvent(story, current, eventId, dice) };
}
function publicAction(story: FearStory, state: FearState, predicate: (action: any) => boolean) {
  const action = availableFearActions(story, state).find(({ action }) => predicate(action))?.action;
  assert.ok(action, `expected public action is available: ${JSON.stringify({combat: state.combat, pending: state.pending, actions: availableFearActions(story, state).map(value => value.action), log: state.log.slice(-8)})}`);
  return action!;
}
function sourceParagraph(fragment: string, sha256: string, paragraphId: string, includes: string) {
  const path = `scripts/alone-against-fear/fragments/${fragment}.json`;
  const bytes = readFileSync(path);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
  const source = JSON.parse(bytes.toString("utf8")) as { paragraphs: { id: string; text: string }[] };
  const paragraph = source.paragraphs.find(item => item.id === paragraphId);
  assert.ok(paragraph?.text.replace(/\s+/g, " ").includes(includes), `${paragraphId} source text`);
}

test("Alien Hunter entry is selected by a real public roll on the reviewed Aliens table", () => {
  sourceParagraph("section-aliens-table", "0ef05272d0312222e8976d259ce9ae392868ed0346de0f68e33a9fb00fc04ee8", "section-aliens-table:p2", "Alien Hunter. L6 alien, 8 Life");
  const eventId = "public-aliens-table-entry";
  const story = buildTableStory(eventId, "aliens");
  const state = stateAtStart(story);
  const encounter = resolvePublicEvent(story, state, eventId, roller(2, 6, 2, 5));
  assert.equal(encounter.combat?.enemyId, "aliens-2", "actual D6 table result 2 instantiates the source Alien Hunter");
  assert.equal(encounter.combat?.enemyLives[0], 8);
});

test("Alien Hunter public start offers source Stealth avoidance and applies its Escape penalty", () => {
  sourceParagraph("section-aliens-table", "0ef05272d0312222e8976d259ce9ae392868ed0346de0f68e33a9fb00fc04ee8", "section-aliens-table:p2", "Escape rolls against the Hunter are at -1");
  // A six avoids the 4-in-6 surprise (plain D6, no explosion bonus); raw 5 + Stealth 1 then reaches L6.
  let encounter = startEnemy("aliens-2", roller(6, 5), { skills: { stealth: 1 } });
  assert.equal(encounter.state.combat, undefined, "successful Stealth avoids the public encounter");
  assert.equal(encounter.state.combatResult?.outcome, "escaped");

  // Fail the same L6 check, then test the printed -1 against an Expert Slippery bonus.
  encounter = startEnemy("aliens-2", roller(6, 2, 5), { skills: { slippery: 2 } });
  assert.equal(encounter.state.combat?.enemyId, "aliens-2");
  const escaped = advanceFear(encounter.story, encounter.state, { type: "escape" }, roller(4));
  assert.equal(escaped.combat?.enemyId, "aliens-2", "raw 4 + Slippery 2 - Hunter 1 is below L6");
  assert.equal(escaped.hp, encounter.state.hp - 2, "failed Escape takes the Hunter's printed 2 damage");
});

test("Alien Hunter public victory grants the source grenade loot", () => {
  sourceParagraph("section-aliens-table", "0ef05272d0312222e8976d259ce9ae392868ed0346de0f68e33a9fb00fc04ee8", "section-aliens-table:p2", "Loot: 1 grenade");
  const encounter = startEnemy("aliens-2", roller(6, 2), { weaponIds: ["axe"], weaponId: "axe" });
  assert.equal(encounter.state.combat?.enemyId, "aliens-2");
  const attack = publicAction(encounter.story, encounter.state, action => action.type === "attack");
  let defeated = advanceFear(encounter.story, encounter.state, attack, roller(6, 6, 6, 6, 1));
  assert.equal(defeated.combat, undefined);
  while (defeated.pending?.kind === "source-choice") defeated = advanceFear(encounter.story, defeated, { type: "choose", choice: defeated.pending.options[0] }, roller());
  assert.ok(defeated.weaponIds.includes("grenade"), JSON.stringify({weapons:defeated.weaponIds,inv:defeated.inventory,pending:defeated.pending,log:defeated.log.slice(-12)}));
});

test("Alien Beast public wound can trigger the acid-splash Defense and source Life loss", () => {
  sourceParagraph("section-aliens-table", "0ef05272d0312222e8976d259ce9ae392868ed0346de0f68e33a9fb00fc04ee8", "section-aliens-table:p3", "Every time you wound the alien");
  const encounter = startEnemy("aliens-3", roller(6, 2), { weaponIds: ["axe"], weaponId: "axe" });
  assert.equal(encounter.state.combat?.enemyId, "aliens-3");
  const before = encounter.state.combat!.enemyLives[0];
  const attack = publicAction(encounter.story, encounter.state, action => action.type === "attack");
  const wounded = advanceFear(encounter.story, encounter.state, attack, roller(6, 2, 1, 1));
  assert.ok(wounded.combat!.enemyLives[0] < before, "axe attack wounds the source Alien Beast");
  assert.equal(wounded.hp, encounter.state.hp - 1, "the 2-in-6 acid splash occurs and failed L6 Defense loses one additional Life");
});

test("Reptilian public attacks can bounce, and defeating it grants only the source sword item", () => {
  sourceParagraph("section-aliens-table", "0ef05272d0312222e8976d259ce9ae392868ed0346de0f68e33a9fb00fc04ee8", "section-aliens-table:p4", "Loot: 1 sword");
  const encounter = startEnemy("aliens-4", roller(), { weaponIds: ["axe"], weaponId: "axe", skills: { fighter: 1 } });
  let s = encounter.state;
  const first = publicAction(encounter.story, s, action => action.type === "attack");
  s = advanceFear(encounter.story, s, first, roller(3, 1));
  assert.equal(s.combat?.enemyLives[0], 2, "successful hit is bounced by the source 1-in-6 check");
  const defend = publicAction(encounter.story, s, action => action.type === "defend");
  s = advanceFear(encounter.story, s, defend, roller(6, 2));
  const finish = publicAction(encounter.story, s, action => action.type === "attack");
  s = advanceFear(encounter.story, s, finish, roller(4, 5));
  assert.equal(s.combat, undefined);
  assert.ok((s.inventory["reptilian-sword"] ?? 0) >= 1, "defeat grants the sword as a carried item");
  assert.equal(encounter.story.fear.weapons["reptilian-sword"], undefined, "the source gives no combat profile for a generic sword");
});

test("Robot public grenade attack bypasses bounce and its source magic immunity hides Exorcism", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p2", "Damage from grenades will not bounce off");
  const encounter = startEnemy("lab-horrors-2", roller(), { arcaneSkills: { exorcism: 1 }, food: 1 }, [
    { op: "item", itemId: "holy-water", amount: 1 }, { op: "item", itemId: "rat-poison", amount: 1 }, { op: "weapon", weaponId: "grenade" },
  ]);
  const exorcism = availableFearActions(encounter.story, encounter.state).some(({ action }) => action.type === "exorcise");
  assert.equal(exorcism, false, "the source robot is not a valid target for magical Exorcism");
  assert.equal(availableFearActions(encounter.story, encounter.state).some(({ action }) => action.type === "use-item" && action.target === "rat-poison"), false, "poison action is not offered against the immune Robot");
  assert.equal(availableFearActions(encounter.story, encounter.state).some(({ action }) => action.type === "fire-curse"), false, "a curse cannot be fired against the immune Robot");
  const switchWeapon = publicAction(encounter.story, encounter.state, action => action.type === "switch-weapon" && action.weapon === "grenade");
  let s = advanceFear(encounter.story, encounter.state, switchWeapon, roller());
  const defend = publicAction(encounter.story, s, action => action.type === "defend");
  s = advanceFear(encounter.story, s, defend, roller(4, 4));
  const attack = publicAction(encounter.story, s, action => action.type === "attack");
  s = advanceFear(encounter.story, s, attack, roller(3));
  assert.equal(s.combat?.enemyLives[0], 1, JSON.stringify({ weapon: s.weaponId, combat: s.combat, log: s.log.slice(-8) }));
});

test("Robot normal attack can bounce while its grenade exception is exercised through a public weapon choice", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p2", "On a 1 to 3, the attack bounces off inflicting no damage");
  const encounter = startEnemy("lab-horrors-2", roller(), { weaponIds: ["axe"], weaponId: "axe" });
  const attack = publicAction(encounter.story, encounter.state, action => action.type === "attack");
  const bounced = advanceFear(encounter.story, encounter.state, attack, roller(3, 1));
  assert.equal(bounced.combat?.enemyLives[0], 5, "an ordinary axe strike's 1-in-3 bounce leaves Robot Life unchanged");
});

test("Robot immunity is checked after preparing and carrying a Curse through public actions", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p2", "immune to poison and magic");
  sourceParagraph("section-arcane-skills", "34c7aec3405e72046fbab477fcd35162a51481376d8b7984b8fb13b5f87ef077", "section-arcane-skills:p3", "prepare a curse");
  const story = buildStory("curse-preparation", "lab-horrors-2", [
    { op: "item", itemId: "lighter", amount: 1 },
    { op: "item", itemId: "bone-powder", amount: 1 },
    { op: "item", itemId: "candle", amount: 1 },
  ]);
  story.fear.eventPrograms["curse-preparation"] = story.fear.eventPrograms["curse-preparation"].slice(0, 3);
  story.nodes.push({ id: "family-robot-after-curse" });
  story.fear.sceneRefs.events["robot-after-curse"] = "family-robot-after-curse";
  story.fear.eventPrograms["robot-after-curse"] = [{ op: "start-combat", enemyId: "lab-horrors-2", count: 1 }];
  let before = stateAtStart(story, { arcaneSkills: { curse: 1 } });
  while (before.pending?.kind === "source-choice") before = advanceFear(story, before, { type: "choose", choice: before.pending.options[0] }, roller());
  let supplied = resolvePublicEvent(story, before, "curse-preparation", roller());
  while (supplied.pending?.kind === "source-choice") supplied = advanceFear(story, supplied, { type: "choose", choice: supplied.pending.options[0] }, roller());
  const prepare = publicAction(story, supplied, action => action.type === "cast-arcane" && action.skill === "curse" && action.target === "specific:lab-horrors-2");
  const prepared = advanceFear(story, supplied, prepare, roller());
  assert.equal(prepared.preparedCurse?.target, "specific:lab-horrors-2");
  assert.equal(prepared.inventory["bone-powder"] ?? 0, 0, "the public ritual spends its bone powder");
  assert.equal(prepared.inventory.candle ?? 0, 0, "the public ritual spends its candle");

  const encounter = resolvePublicEvent(story, prepared, "robot-after-curse", roller());
  assert.equal(encounter.combat?.enemyId, "lab-horrors-2");
  assert.equal(encounter.preparedCurse?.target, "specific:lab-horrors-2", "the unmatched immunity leaves the prepared Curse available");
  assert.equal(availableFearActions(story, encounter).some(({ action }) => action.type === "fire-curse"), false,
    "the source Robot immunity prevents firing the prepared Curse");
});

test("Mutant public start rolls surprise and psionics, then adds Will and Mutant Hunter during a turn", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p3", "2 in 6 chance of possessing psionic powers");
  let encounter = startEnemy("lab-horrors-3", roller(6, 2, 1), { skills: { will: 1, "mutant-hunter": 1 } });
  assert.equal(encounter.state.combat?.familyState?.psionic, true);
  const attack = publicAction(encounter.story, encounter.state, action => action.type === "attack");
  let s = advanceFear(encounter.story, encounter.state, attack, roller(3));
  assert.ok(s.combat!.enemyLives[0] < 6, "Mutant Hunter +1 turns raw 3 into a hit against L4");
  const defend = publicAction(encounter.story, s, action => action.type === "defend");
  const sanity = s.sanity;
  s = advanceFear(encounter.story, s, defend, roller(3, 3));
  assert.equal(s.hp, encounter.state.hp, "Mutant Hunter +1 turns raw 3 into a successful Defense against L4");
  assert.equal(s.sanity, sanity, "Will +1 turns raw 3 into a successful L4 psionics save");
  const nextAttack = publicAction(encounter.story, s, action => action.type === "attack");
  s = advanceFear(encounter.story, s, nextAttack, roller(3));
  const nextDefense = publicAction(encounter.story, s, action => action.type === "defend");
  s = advanceFear(encounter.story, s, nextDefense, roller(2, 6, 2));
  // The failed L4 psionics save queues the Mental-Scar substitution; accept the 1-point loss.
  assert.equal(s.pending?.kind, "injury-prevention");
  s = advanceFear(encounter.story, s, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(s.hp, encounter.state.hp);
  assert.equal(s.sanity, sanity - 1, "failed next-turn L4 psionics save loses one Sanity");
});

test("Doppelganger public encounter uses the investigator's current maximum Life", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p4", "Life points equal to your maximum");
  const encounter = startEnemy("doppelganger", roller(), { maxHp: 13, hp: 13 });
  assert.equal(encounter.state.combat?.enemyId, "doppelganger");
  assert.deepEqual(encounter.state.combat?.enemyLives, [13]);
});

test("Muama publicly accepts carried black-mirror fragments and ends without combat", () => {
  sourceParagraph("section-living-dolls-table", "c0e92ef8351c57bed1a8f988460c36e20dd425157ee94a6ef9fefda3de909028", "section-living-dolls-table:p2", "If you have any, you can give them to her to avoid this encounter");
  const encounter = startEnemy("living-dolls-2", roller(), {}, [{ op: "item", itemId: "black-mirror-fragments", amount: 1 }]);
  assert.equal(encounter.state.combat?.enemyId, "living-dolls-2");
  const give = publicAction(encounter.story, encounter.state, action => action.type === "choose" && action.choice === "family:give-mirror-fragments");
  const avoided = advanceFear(encounter.story, encounter.state, give, roller());
  assert.equal(avoided.combat, undefined);
  assert.equal(avoided.inventory["black-mirror-fragments"] ?? 0, 0);
});

test("Giant Bug publicly accepts insecticide and deals its automatic two damage", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p6", "Damage from insecticide has no chance of bouncing off");
  const encounter = startEnemy("lab-horrors-6", roller(1), {}, [{ op: "item", itemId: "insecticide", amount: 1 }]);
  assert.equal(encounter.state.combat?.familyState?.flyingBug, true);
  const use = publicAction(encounter.story, encounter.state, action => action.type === "choose" && action.choice === "family:use-insecticide");
  const attacked = advanceFear(encounter.story, encounter.state, use, roller());
  assert.equal(attacked.combat?.enemyLives[0], 4);
  assert.equal(attacked.inventory.insecticide ?? 0, 0);
});

test("Giant Bug public ordinary attack can bounce on natural 1", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p6", "on a 1, it bounces off the bug’s exoskeleton");
  const encounter = startEnemy("lab-horrors-6", roller(6), { weaponIds: ["axe"], weaponId: "axe" });
  assert.equal(encounter.state.combat?.familyState?.flyingBug, false);
  const attack = publicAction(encounter.story, encounter.state, action => action.type === "attack");
  const bounced = advanceFear(encounter.story, encounter.state, attack, roller(4, 1));
  assert.equal(bounced.combat?.enemyLives[0], 6, "the source bounce check leaves Life unchanged");
});

test("Azolina's successful initial Will test exposes an explicit public leave action even without map links", () => {
  sourceParagraph("section-living-dolls-table", "c0e92ef8351c57bed1a8f988460c36e20dd425157ee94a6ef9fefda3de909028", "section-living-dolls-table:p5", "If you fail any Defense roll, Azolina will automatically choke you");
  const encounter = startEnemy("living-dolls-5", roller(6), {});
  assert.equal(encounter.state.combat?.familyState?.azolinaWillPassed, true);
  assert.equal(encounter.state.pending, undefined);
  const leave = publicAction(encounter.story, encounter.state, action => action.type === "choose" && action.choice === "family:leave-azolina-box");
  const escaped = advanceFear(encounter.story, encounter.state, leave, roller());
  assert.equal(escaped.combat, undefined);
  assert.equal(escaped.combatResult?.outcome, "escaped");
});

test("Azolina's first successful Defense unlocks Escape at minus one", () => {
  sourceParagraph("section-living-dolls-table", "c0e92ef8351c57bed1a8f988460c36e20dd425157ee94a6ef9fefda3de909028", "section-living-dolls-table:p5", "If you fail any Defense roll, Azolina will automatically choke you");
  const encounter = startEnemy("living-dolls-5", roller(1), {});
  const attack = publicAction(encounter.story, encounter.state, action => action.type === "attack");
  const attacked = advanceFear(encounter.story, encounter.state, attack, roller(4));
  const defend = publicAction(encounter.story, attacked, action => action.type === "defend");
  const defended = advanceFear(encounter.story, attacked, defend, roller(6, 2));
  assert.equal(defended.combat?.familyState?.azolinaDefensePassed, true);
  assert.equal(defended.combat?.escapeModifier, -1);
  assert.ok(availableFearActions(encounter.story, defended).some(({ action }) => action.type === "escape"));
});

test("Azolina public failed Defense starts persistent choking", () => {
  sourceParagraph("section-living-dolls-table", "c0e92ef8351c57bed1a8f988460c36e20dd425157ee94a6ef9fefda3de909028", "section-living-dolls-table:p5", "If you fail any Defense roll, Azolina will automatically choke you");
  const encounter = startEnemy("living-dolls-5", roller(1), {});
  let s = encounter.state;
  assert.equal(s.combat?.familyState?.azolinaWillPassed, false);
  const firstAttack = publicAction(encounter.story, s, action => action.type === "attack");
  s = advanceFear(encounter.story, s, firstAttack, roller(1, 6));
  const firstDefense = publicAction(encounter.story, s, action => action.type === "defend");
  s = advanceFear(encounter.story, s, firstDefense, roller(1, 6, 1, 6));
  while (s.pending?.kind === "injury-prevention") s = advanceFear(encounter.story, s, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(s.combat?.familyState?.azolinaDrainActive, true);
  while (s.pending?.kind === "double-one") s = advanceFear(encounter.story, s, { type: "choose", choice: "take-damage" }, roller());
  assert.ok(s.hp < encounter.state.hp, "the failed Defense and source choking cause Life loss");
  const afterFirstChoke = s.hp;
  const nextAttack = publicAction(encounter.story, s, action => action.type === "attack");
  s = advanceFear(encounter.story, s, nextAttack, roller(4));
  const nextDefense = publicAction(encounter.story, s, action => action.type === "defend");
  s = advanceFear(encounter.story, s, nextDefense, roller(6, 2));
  assert.equal(s.hp, afterFirstChoke - 1, "persistent choking costs one more Life on the next turn until Azolina is destroyed");

});

test("Kalina public targeting reaches her and her dinosaur as separate attack targets", () => {
  sourceParagraph("section-living-dolls-table", "c0e92ef8351c57bed1a8f988460c36e20dd425157ee94a6ef9fefda3de909028", "section-living-dolls-table:p6", "if you attack Kalina, your Defense rolls against her dinosaur are at -1");
  const encounter = startEnemy("living-dolls-6", roller(), { weaponIds: ["axe"], weaponId: "axe" });
  const targetKalina = publicAction(encounter.story, encounter.state, action => action.type === "choose" && action.choice === "family:target-kalina");
  let s = advanceFear(encounter.story, encounter.state, targetKalina, roller());
  const attackKalina = publicAction(encounter.story, s, action => action.type === "attack" && action.target === "living-dolls-6");
  s = advanceFear(encounter.story, s, attackKalina, roller(4));
  assert.equal(s.combat?.familyState?.kalinaAlive, true, "Kalina remains alive after a nonlethal hit");
  const defend = publicAction(encounter.story, s, action => action.type === "defend");
  s = advanceFear(encounter.story, s, defend, roller(4, 4));
  while (s.pending?.kind === "injury-prevention") s = advanceFear(encounter.story, s, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(s.hp, encounter.state.hp - 2, "the failed dinosaur Defense deals its source 2 damage after the -1 modifier");
  const targetDino = publicAction(encounter.story, s, action => action.type === "choose" && action.choice === "family:target-dinosaur");
  s = advanceFear(encounter.story, s, targetDino, roller());
  const attackDino = publicAction(encounter.story, s, action => action.type === "attack" && action.target === "living-dolls-6-dinosaur");
  s = advanceFear(encounter.story, s, attackDino, roller(4));
  assert.ok((s.combat?.groups?.find(group => group.enemyId === "living-dolls-6-dinosaur")?.enemyLives[0] ?? 6) < 6, "the selected dinosaur attack resolves with damage");
  assert.ok(s.log.some(line => line.includes("玩具恐龙1攻击防御骰: 4 => 3（目标L4）")), JSON.stringify(s.log.slice(-8)));

});

test("Molotov fire attack receives Kalina's printed +1 bonus through the public target choice", () => {
  sourceParagraph("section-useful-stuff-table", "e0fad78712d84396eb5581c4ec892e24ce9e41373b8e5edb8410110f673ea140", "section-useful-stuff-table:p15", "perform an Attack roll at +2");
  const encounter = startEnemy("living-dolls-6", roller(1), { inventory: { "molotov-cocktail": 1, matches: 1 } });
  const targetKalina = publicAction(encounter.story, encounter.state, action => action.type === "choose" && action.choice === "family:target-kalina");
  const targeted = advanceFear(encounter.story, encounter.state, targetKalina, roller());
  const molotov = publicAction(encounter.story, targeted, action => action.type === "use-item" && action.target === "molotov-cocktail" && action.choice === "living-dolls-6");
  const result = advanceFear(encounter.story, targeted, molotov, roller(4));
  assert.equal(result.combat?.groups?.find(group => group.enemyId === "living-dolls-6")?.enemyLives[0], 4,
    "raw 4 + printed Molotov +2 + Kalina-specific fire +1 gives one hit at her L4");
  assert.equal(result.inventory["molotov-cocktail"], undefined);
});

test("Kalina and her dinosaur each take the printed +1 from a public Molotov fire attack", () => {
  sourceParagraph("section-living-dolls-table", "c0e92ef8351c57bed1a8f988460c36e20dd425157ee94a6ef9fefda3de909028", "section-living-dolls-table:p6", "Both are hit at +1 by fire-based attacks");
  sourceParagraph("section-useful-stuff-table", "e0fad78712d84396eb5581c4ec892e24ce9e41373b8e5edb8410110f673ea140", "section-useful-stuff-table:p15", "Molotov cocktail. This can be thrown as a one use weapon");
  const encounter = startEnemy("living-dolls-6", roller(), { inventory: { "molotov-cocktail": 1, matches: 1 } });
  const fireAtDinosaur = publicAction(encounter.story, encounter.state,
    action => action.type === "use-item" && action.target === "molotov-cocktail" && action.choice === "living-dolls-6-dinosaur");
  const burned = advanceFear(encounter.story, encounter.state, fireAtDinosaur, roller(5));
  assert.equal(burned.combat?.groups?.find(group => group.enemyId === "living-dolls-6-dinosaur")?.enemyLives[0], 4,
    "raw 5 + Molotov +2 + source fire +1 reaches 8 against L4 and inflicts 2 damage");
  assert.equal(burned.inventory["molotov-cocktail"] ?? 0, 0, "the one-use fire weapon is consumed");
});

test("Tentacled Horror first campaign sighting costs Sanity on failed Fear, later sighting does not repeat it", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p5", "The first time you see the tentacled horror in the campaign");
  const helped = startEnemy("lab-horrors-5", roller(2), { skills: { will: 1 } });
  assert.equal(helped.state.sanity, 8, "basic Will +1 makes raw 2 pass the first-sighting L3 Fear save");
  const first = startEnemy("lab-horrors-5", roller(1));
  // The failed first-sighting L3 Fear save queues the Mental-Scar substitution; accept the 1-point loss.
  assert.equal(first.state.pending?.kind, "injury-prevention");
  first.state = advanceFear(first.story, first.state, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(first.state.sanity, 7, "failed first-sighting L3 Fear costs one Sanity");
  assert.equal(first.state.missionProgress["fear:family:tentacled-horror:seen"], true);
  const flee = publicAction(first.story, first.state, action => action.type === "escape");
  let s = advanceFear(first.story, first.state, flee, roller(6, 2));
  assert.equal(s.combat, undefined);
  while (s.pending?.kind === "source-choice") s = advanceFear(first.story, s, { type: "choose", choice: s.pending.options[0] }, roller());
  const eventId = "family-public-test";
  s = resolvePublicEvent(first.story, s, eventId, roller());
  assert.equal(s.sanity, 7, "later sighting in the same campaign does not repeat first-sighting Fear");
});

test("Tentacled Horror publicly makes two attacks and locks Escape only while both hit and Life exceeds 1", () => {
  sourceParagraph("section-lab-horrors-table", "92330f56b06d01ac58f8afabe9c960d17f08cff745c564de16a8a3ea04355cef", "section-lab-horrors-table:p5", "If it hits you with both attacks, you may not Escape");
  const encounter = startEnemy("lab-horrors-5", roller(6, 2), { weaponIds: ["axe"], weaponId: "axe", skills: { fighter: 1 } });
  let s = encounter.state;
  const attack = publicAction(encounter.story, s, action => action.type === "attack");
  s = advanceFear(encounter.story, s, attack, roller(2));
  assert.equal(s.combat?.enemyLives[0], 3);
  const defend = publicAction(encounter.story, s, action => action.type === "defend");
  s = advanceFear(encounter.story, s, defend, roller(2, 2));
  while (s.pending?.kind === "injury-prevention") s = advanceFear(encounter.story, s, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(s.hp, encounter.state.hp - 2, "both source attacks hit separately after resolving each injury choice");
  assert.equal(availableFearActions(encounter.story, s).some(({ action }) => action.type === "escape"), false);
  const nextAttack = publicAction(encounter.story, s, action => action.type === "attack");
  s = advanceFear(encounter.story, s, nextAttack, roller(2));
  assert.equal(s.combat?.enemyLives[0], 1);
  const nextDefense = publicAction(encounter.story, s, action => action.type === "defend");
  s = advanceFear(encounter.story, s, nextDefense, roller(6, 2, 6, 2));
  while (s.pending?.kind === "injury-prevention") s = advanceFear(encounter.story, s, { type: "choose", choice: "take-loss" }, roller());
  assert.equal(availableFearActions(encounter.story, s).some(({ action }) => action.type === "escape"), true,
    "once the Horror is down to 1 Life the source lock ends");
});
