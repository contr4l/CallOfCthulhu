import assert from "node:assert/strict";
import test from "node:test";
import type { Story, CharacterPreset } from "../packages/contracts/index.js";
import { advance, initialState, project } from "../packages/engine/index.js";
import { field } from "../packages/engine/program.js";
import { refreshFrostCombatants } from "../packages/engine/frost-adapter.js";
import { createCharacter } from "../packages/rules/index.js";

const preset = (id: string, label: string): CharacterPreset => ({
  id, label, description: "test", occupation: "test", hp: 12, sanity: 60,
  attributes: { str: 60, con: 60, pow: 60, dex: 60, app: 50, siz: 60, int: 70, edu: 70 },
  skills: { fightingBrawl: 60, firearmsRifleShotgun: 40, dodge: 30 },
});
function story(initiative: "party-first" | "enemy-first"): Story {
  const pc = preset("test-pc", "Investigator"), ally = preset("charlie-card", "Charlie");
  return {
    id: "frost-combat-test", version: "1.0.0", rulesVersion: "coc7-solo@2", title: "Combat test", subtitle: "", description: "", duration: "", difficulty: "", cover: "", accent: "", tags: [], entry: "combat", presets: [pc],
    party: { members: [{ id: "charlie", character: createCharacter("Charlie", ally, 50) }] },
    nodes: [
      { id: "combat", title: "Combat", chapter: "1", text: ["Combat test."], type: "program", background: "", healthRouting: { injury: "source" }, program: [{ kind: "partyCombat", combat: {
        sourceSection: "test-source", participants: [{ id: "$player" }, { id: "charlie" }],
        enemies: [{ id: "wolf", name: "Wolf", hp: 10, maxHp: 10, skills: { fightingBrawl: 30 }, attackSkill: "fightingBrawl", damage: "1D6", targetOrder: ["$player"], damageMode: "party" }],
        partyTurnOrder: ["$player", "charlie"], enemyTurnOrder: ["wolf"], initiative,
        weapons: [{ id: "fist", label: "徒手", skill: "fightingBrawl", damage: "1D3", actors: ["$player", "charlie"] }],
        protectedStudents: ["charlie"], reviveCompanionsIfInvestigatorSurvives: true, win: "win", lose: "lose",
        options: [{ id: "surrender", label: "Surrender", target: "lose" }],
      } }] },
      { id: "win", title: "Win", chapter: "win", text: ["Win."], type: "program", background: "", program: [{ kind: "end", label: "win" }] },
      { id: "lose", title: "Lose", chapter: "lose", text: ["Lose."], type: "program", background: "", program: [{ kind: "end", label: "lose" }] },
    ],
  };
}
const fixedDice = (value: number) => (_min: number, _max: number) => value;
function rollSequence(d100s: number[]) {
  const digits = d100s.flatMap((roll) => [roll % 10, Math.floor(roll / 10) % 10]);
  return (min: number, max: number) => min === 0 && max === 10 ? (digits.shift() ?? 1) : min;
}
function rawDigits(digits: number[]) {
  return (min: number, max: number) => min === 0 && max === 10 ? (digits.shift() ?? 1) : min;
}

test("Frost party combat resolves server-side opposed weapon rolls and records real performer", () => {
  const source = story("party-first");
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const before = project(source, start, "run", 0);
  assert.equal(before.frostCombat?.currentActorId, "$player");
  assert.ok(before.actions.some((action) => action.id === "frost-attack:fist:wolf"));
  const result = advance(source, start, "frost-attack:fist:wolf", rollSequence([20, 22]));
  assert.equal(result.check?.performer?.id, undefined);
  assert.equal(result.state.program?.frostCombat?.state.events[0]?.actorId, "$player");
  assert.equal(result.state.program?.frostCombat?.state.events[0]?.check?.success, true);
  assert.equal(result.state.program?.frostCombat?.state.enemies[0]?.hp, 9);
});

test("Frost enemy damage pauses for exact party allocation and applies it to saved members", () => {
  const source = story("enemy-first");
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  assert.ok(project(source, start, "run", 0).actions.some((action) => action.id === "surrender"), "surrender is available when no enemy check is pending");
  const r = advance(source, start, "frost-enemy:dodge", rollSequence([11, 99]));
  assert.equal(r.state.program?.frostCombat?.state.pendingEnemyAttack?.damage, 1);
  const scene = project(source, r.state, "run", 1);
  assert.ok(!scene.actions.some((action) => action.id === "surrender"), "source surrender is hidden until the pending enemy check is resolved");
  assert.equal(scene.input?.kind, "distribution");
  const allocated = advance(source, r.state, "frost-distribute", fixedDice(1), { $player: 1, charlie: 0 });
  assert.equal(allocated.state.character.hp, 11);
  assert.equal(allocated.state.party?.members[0]?.character.hp, 12);
  assert.equal(allocated.state.program?.frostCombat?.state.pendingEnemyAttack, undefined);
  assert.equal(allocated.state.program?.counters.lastDamage, 1, "the last-damage threshold tracks the investigator's actual share");
});

test("Frost server rejects non-source party damage splits", () => {
  const source = story("enemy-first");
  const encounter = source.nodes.find((entry) => entry.id === "combat");
  assert.ok(encounter?.type === "program" && encounter.program?.[0]?.kind === "partyCombat");
  encounter.program[0].combat.enemies[0].damage = "2D6";
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const pending = advance(source, start, "frost-enemy:dodge", rollSequence([11, 99]));
  assert.equal(pending.state.program?.frostCombat?.state.pendingEnemyAttack?.damage, 2);
  assert.throws(() => advance(source, pending.state, "frost-distribute", fixedDice(1), { $player: 0, charlie: 2 }), /均衡分担/);
});

test("Frost extreme firearm attacks maximize both weapon damage and damage bonus and cannot be shop-rerolled", () => {
  const source = story("party-first");
  const node = source.nodes.find((entry) => entry.id === "combat");
  assert.ok(node?.type === "program" && node.program?.[0]?.kind === "partyCombat");
  node.program[0].combat.weapons = [{ id: "rifle", label: "步枪", skill: "firearmsRifleShotgun", damage: "1D6", damageBonus: true, firearm: true, actors: ["$player"] }];
  node.program[0].combat.enemies[0].hp = 100;
  node.program[0].combat.enemies[0].maxHp = 100;
  const character = createCharacter("Nadelmann", source.presets[0], 50);
  character.damageBonus = "1D4";
  const start = initialState(source, character, fixedDice(1));
  const result = advance(source, start, "frost-attack:rifle:wolf", rollSequence([1]));
  assert.equal(result.state.program?.frostCombat?.state.enemies[0]?.hp, 90);
  assert.equal(result.check?.combat?.damage, 10);
  assert.equal(result.state.program?.frostCombat?.state.events[0]?.check?.combat?.result, "hit");
});

test("Frost party combat treats the character-sheet damage bonus 'none' as zero", () => {
  const source = story("party-first");
  const node = source.nodes.find((entry) => entry.id === "combat");
  assert.ok(node?.type === "program" && node.program?.[0]?.kind === "partyCombat");
  const combat = node.program[0].combat;
  combat.partyTurnOrder = ["charlie", "$player"];
  combat.weapons = [{ id: "charlie-fist", label: "徒手", skill: "fightingBrawl", damage: "1D3", damageBonus: true, actors: ["charlie"] }];
  source.party!.members[0].character.damageBonus = "none";
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const result = advance(source, start, "frost-attack:charlie-fist:wolf", rollSequence([20, 22]));
  assert.equal(result.state.program?.frostCombat?.state.enemies[0]?.hp, 9);
  assert.equal(result.check?.combat?.damage, 1);
});

test("a source-marked firearm fumble damages its named companion instead of the enemy", () => {
  const source = story("party-first");
  const battle = source.nodes.find((entry) => entry.id === "combat");
  assert.ok(battle?.type === "program" && battle.program?.[0]?.kind === "partyCombat");
  battle.program[0].combat.weapons = [{ id: "rifle", label: "步枪", skill: "firearmsRifleShotgun", damage: "2D6+4", firearm: true, fumbleTarget: "charlie", actors: ["$player"] }];
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const result = advance(source, start, "frost-attack:rifle:wolf", rollSequence([99]));
  assert.equal(result.check?.grade, "fumble");
  assert.equal(result.state.party?.members[0]?.character.hp, 6, "fumble damage uses the printed rifle damage 2D6+4");
  assert.equal(result.state.program?.frostCombat?.state.enemies[0]?.hp, 10, "the wolf is not hit by the fumble");
});

test("Frost source combat fields and helper-updated party state remain synchronized", () => {
  const source = story("party-first");
  const state = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  project(source, state, "run", 0);
  assert.equal(field(state, "combat.round"), 1);
  assert.equal(field(state, "combat.alive"), 1);
  assert.equal(field(state, "combat.enemy.0.hp"), 10);
  const saved = state.program!.frostCombat!.state;
  state.character.hp = 3;
  state.flags.unconscious = true;
  state.party!.members[0].character.hp = 2;
  state.party!.members[0].unconscious = true;
  refreshFrostCombatants(state, saved);
  assert.equal(saved.party.find((actor) => actor.id === "$player")?.character.hp, 3);
  assert.equal(saved.party.find((actor) => actor.id === "$player")?.unconscious, false, "historical zero-HP flag does not keep a recovered investigator unconscious");
  state.character.hp = 0;
  state.flags.unconscious = false;
  refreshFrostCombatants(state, saved);
  assert.equal(saved.party.find((actor) => actor.id === "$player")?.unconscious, true, "current zero HP marks the investigator unconscious even without a historical flag");
  assert.equal(saved.party.find((actor) => actor.id === "charlie")?.character.hp, 2);
  assert.equal(saved.party.find((actor) => actor.id === "charlie")?.unconscious, true);
});

test("Frost companion SAN failure survives a round-helper return and removes that companion's turn", () => {
  const source = story("enemy-first");
  const battle = source.nodes.find((entry) => entry.id === "combat");
  assert.ok(battle?.type === "program" && battle.program?.[0]?.kind === "partyCombat");
  battle.program[0].combat.roundCalls = [{ afterRound: 1, call: "san-failure" }];
  battle.program[0].combat.enemies[0].hp = 100;
  battle.program[0].combat.enemies[0].maxHp = 100;
  source.nodes.push({
    id: "san-failure", title: "SAN helper", chapter: "helper", text: ["Source rule helper."], type: "program", background: "",
    program: [{ kind: "effects", effects: [{ op: "party", member: "charlie", action: "unconscious", value: true }] }, { kind: "route", target: "$return" }],
  });
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  let r = advance(source, start, "frost-enemy:dodge", rollSequence([99, 99]));
  r = advance(source, r.state, "frost-attack:fist:wolf", rollSequence([20, 22]));
  r = advance(source, r.state, "frost-attack:fist:wolf", rollSequence([20, 22]));
  assert.equal(r.state.nodeId, "combat", "the helper returns to the saved encounter");
  assert.equal(r.state.party?.members[0]?.unconscious, true);
  assert.equal(r.state.program?.frostCombat?.state.party.find((actor) => actor.id === "charlie")?.unconscious, true);
  r = advance(source, r.state, "frost-enemy:dodge", rollSequence([99, 99]));
  r = advance(source, r.state, "frost-attack:fist:wolf", rollSequence([20, 22]));
  const projection = project(source, r.state, "run", 1).frostCombat;
  assert.equal(projection?.phase, "enemy", "after the investigator acts, the unconscious companion is skipped");
  assert.equal(projection?.party.find((actor) => actor.id === "charlie")?.unconscious, true);
});

test("Frost enemy Dodge wins equal successful grades and both failures cause no damage", () => {
  const source = story("enemy-first");
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const tie = advance(source, start, "frost-enemy:dodge", rollSequence([22, 22]));
  assert.equal(tie.state.program?.frostCombat?.state.pendingEnemyAttack, undefined);
  assert.equal(tie.state.character.hp, 12);
  assert.equal(tie.state.program?.frostCombat?.state.events[0]?.check?.success, true);
  const bothFail = advance(source, start, "frost-enemy:dodge", rollSequence([99, 99]));
  assert.equal(bothFail.state.program?.frostCombat?.state.pendingEnemyAttack, undefined);
  assert.equal(bothFail.state.character.hp, 12);
  assert.equal(bothFail.state.program?.frostCombat?.state.events[0]?.check?.success, false);
});

test("Frost melee fightback tie hurts the party, and damage uses the attacking enemy grade", () => {
  const source = story("enemy-first");
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const tie = advance(source, start, "frost-enemy:fightBack:fist", rollSequence([13, 13]));
  assert.equal(tie.state.program?.frostCombat?.state.pendingEnemyAttack?.damage, 1);
  assert.equal(tie.state.program?.frostCombat?.state.pendingEnemyAttack?.targetId, "$player");

  const criticalSource = story("enemy-first");
  const criticalStart = initialState(criticalSource, createCharacter("Nadelmann", criticalSource.presets[0], 50), fixedDice(1));
  const critical = advance(criticalSource, criticalStart, "frost-enemy:dodge", rollSequence([1, 99]));
  assert.equal(critical.state.program?.frostCombat?.state.pendingEnemyAttack?.damage, 6);

  const extremeParrySource = story("enemy-first");
  const extremeParryStart = initialState(extremeParrySource, createCharacter("Nadelmann", extremeParrySource.presets[0], 50), fixedDice(1));
  const extremeParry = advance(extremeParrySource, extremeParryStart, "frost-enemy:fightBack:fist", rollSequence([22, 11]));
  assert.equal(extremeParry.state.program?.frostCombat?.state.enemies[0]?.hp, 9, "an extreme successful defensive fightback uses a normal damage roll, not maximum damage");
});

test("Frost active melee attacks win equal successful grades even with a lower base skill", () => {
  const source = story("party-first");
  const pc = { ...source.presets[0], skills: { ...source.presets[0].skills, fightingBrawl: 30 } };
  const combat = source.nodes.find((node) => node.id === "combat");
  assert.ok(combat?.type === "program" && combat.program);
  const attackSpec = combat.program[0];
  assert.ok(attackSpec.kind === "partyCombat");
  attackSpec.combat.enemies[0].skills.fightingBrawl = 40;
  const start = initialState(source, createCharacter("Nadelmann", pc, 50), fixedDice(1));
  const r = advance(source, start, "frost-attack:fist:wolf", rollSequence([25, 25]));
  assert.equal(r.state.program?.frostCombat?.state.enemies[0]?.hp, 9);
  assert.equal(r.state.program?.frostCombat?.state.events[0]?.check?.success, true);
});

test("Frost firearms do not roll an enemy fightback, while failed melee can be hit by a successful enemy", () => {
  const firearmStory = story("party-first");
  const firearmNode = firearmStory.nodes.find((node) => node.id === "combat");
  assert.ok(firearmNode?.type === "program" && firearmNode.program && firearmNode.program[0].kind === "partyCombat");
  firearmNode.program[0].combat.weapons = [{ id: "rifle", label: "步枪", skill: "firearmsRifleShotgun", damage: "2D6+4", firearm: true, actors: ["$player"] }];
  let d100Digits = 0;
  const firearmStart = initialState(firearmStory, createCharacter("Nadelmann", firearmStory.presets[0], 50), fixedDice(1));
  const firearmResult = advance(firearmStory, firearmStart, "frost-attack:rifle:wolf", (min, max) => {
    if (min === 0 && max === 10) d100Digits++;
    return min === 0 && max === 10 ? 1 : min;
  });
  assert.equal(d100Digits, 2, "one firearms roll consumes a single percentile check and no opponent check");
  assert.equal(firearmResult.state.program?.frostCombat?.state.events[0]?.check?.opponent, undefined);

  const meleeStory = story("party-first");
  const meleeStart = initialState(meleeStory, createCharacter("Nadelmann", meleeStory.presets[0], 50), fixedDice(1));
  const failedAttack = advance(meleeStory, meleeStart, "frost-attack:fist:wolf", rollSequence([11, 99]));
  assert.equal(failedAttack.state.program?.frostCombat?.state.pendingEnemyAttack?.targetId, "$player");
  assert.equal(failedAttack.state.program?.frostCombat?.state.pendingEnemyAttack?.damage, 1);
});

test("Frost later enemy attacks against the same target gain one bonus die", () => {
  const source = story("enemy-first");
  const node = source.nodes.find((entry) => entry.id === "combat");
  assert.ok(node?.type === "program" && node.program && node.program[0].kind === "partyCombat");
  node.program[0].combat.enemies.push({ id: "wolf2", name: "Wolf 2", hp: 10, maxHp: 10, skills: { fightingBrawl: 30 }, attackSkill: "fightingBrawl", damage: "1D6", targetOrder: ["$player"], damageMode: "party" });
  node.program[0].combat.enemyTurnOrder = ["wolf", "wolf2"];
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const firstAttack = advance(source, start, "frost-enemy:dodge", rollSequence([99, 22]));
  assert.equal(firstAttack.state.program?.frostCombat?.state.phase, "enemy");
  const laterAttack = advance(source, firstAttack.state, "frost-enemy:dodge", rawDigits([9, 9, 1, 9, 9]));
  assert.equal(laterAttack.check?.opponent?.roll, 19, "the enemy roll selects the best of two tens dice after the first attack on this target");
  assert.ok(laterAttack.state.program?.frostCombat?.state.pendingEnemyAttack);
});

test("Frost combat rejects an out-of-phase action before rolling dice", () => {
  const source = story("party-first");
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(0));
  let rolls = 0;
  assert.throws(() => advance(source, start, "frost-enemy:dodge", () => { rolls++; return 0; }));
  assert.equal(rolls, 0);
});

test("Frost combat Luck is a persisted post-roll choice and spends only Nadelmann's Luck", () => {
  const source = story("party-first");
  source.spendLuck = true;
  const node = source.nodes.find((entry) => entry.id === "combat");
  assert.ok(node?.type === "program" && node.program?.[0]?.kind === "partyCombat");
  node.program[0].combat.weapons = [{ id: "rifle", label: "步枪", skill: "firearmsRifleShotgun", damage: "1D6", firearm: true, actors: ["$player"] }];
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const failed = advance(source, start, "frost-attack:rifle:wolf", rollSequence([45]));
  assert.equal(failed.state.program?.frostCombat?.state.events.length, 0, "the failed attack waits without resolving damage");
  assert.equal(failed.state.program?.pending?.result.roll, 45);
  assert.deepEqual(project(source, failed.state, "run", 1).actions?.map((entry) => entry.id), ["accept", "spend-luck"]);
  let d100Rolls = 0;
  const spent = advance(source, failed.state, "spend-luck", (min, max) => {
    if (min === 0 && max === 10) d100Rolls++;
    return min;
  });
  assert.equal(d100Rolls, 0, "spending Luck reuses the saved percentile result");
  assert.equal(spent.check?.luckSpent, 5);
  assert.equal(spent.check?.originalRoll, 45);
  assert.equal(spent.check?.roll, 40);
  assert.equal(spent.state.character.luck, 45);
  assert.equal(spent.state.program?.pending, undefined);
  assert.equal(spent.state.program?.frostCombat?.state.events.length, 1);
  assert.equal(spent.state.program?.frostCombat?.state.enemies[0]?.hp, 9);
});

test("Frost opposed combat Luck reaches the needed success grade and cannot be borrowed for companions", () => {
  const source = story("party-first");
  source.spendLuck = true;
  const start = initialState(source, createCharacter("Nadelmann", source.presets[0], 50), fixedDice(1));
  const failed = advance(source, start, "frost-attack:fist:wolf", rollSequence([13, 31]));
  assert.equal(failed.state.program?.pending?.result.opponent?.grade, "hard");
  assert.deepEqual(project(source, failed.state, "run", 1).actions?.map((entry) => entry.id), ["accept", "spend-luck"]);
  const spent = advance(source, failed.state, "spend-luck", fixedDice(1));
  assert.equal(spent.check?.luckSpent, 1, "a hard success ties the wolf's hard grade, which the active attacker wins");
  assert.equal(spent.check?.grade, "hard");
  assert.equal(spent.state.program?.frostCombat?.state.enemies[0]?.hp, 9);

  const enemyFirst = story("enemy-first");
  enemyFirst.spendLuck = true;
  const combat = enemyFirst.nodes.find((entry) => entry.id === "combat");
  assert.ok(combat?.type === "program" && combat.program?.[0]?.kind === "partyCombat");
  combat.program[0].combat.enemies[0].targetOrder = ["charlie"];
  combat.program[0].combat.enemies[0].damageMode = "target";
  const enemyStart = initialState(enemyFirst, createCharacter("Nadelmann", enemyFirst.presets[0], 50), fixedDice(1));
  const companionCheck = advance(enemyFirst, enemyStart, "frost-enemy:dodge", rollSequence([99, 1]));
  assert.equal(companionCheck.state.program?.pending?.frostCombat, undefined, "companions cannot spend Nadelmann's personal Luck");
  const companionActions = project(enemyFirst, companionCheck.state, "run", 1).actions?.map((entry) => entry.id) ?? [];
  assert.ok(companionActions.some((id) => id.startsWith("frost-attack:")));
  assert.ok(!companionActions.includes("spend-luck"));
});

test("Frost noncombat opposed Luck can raise an ordinary roll to the grade needed to win", () => {
  const source = story("party-first");
  source.id = "alone-against-frost";
  source.spendLuck = true;
  source.entry = "check";
  source.nodes = [
    { id: "check", title: "Opposed test", chapter: "test", text: ["Test."], type: "program", background: "", program: [{ kind: "check", check: { skill: "fightingBrawl", label: "斗殴对抗", opposed: 90, success: "win", failure: "lose" } }] },
    { id: "win", title: "Win", chapter: "win", text: ["Win."], type: "program", background: "", program: [{ kind: "end", label: "win" }] },
    { id: "lose", title: "Lose", chapter: "lose", text: ["Lose."], type: "program", background: "", program: [{ kind: "end", label: "lose" }] },
  ];
  const character = createCharacter("Nadelmann", source.presets[0], 50);
  character.luck = 50;
  const start = initialState(source, character, fixedDice(1));
  const failed = advance(source, start, "roll", rollSequence([30, 55]));
  assert.equal(failed.check?.grade, "regular");
  assert.equal(failed.check?.opponent?.grade, "hard");
  assert.ok(project(source, failed.state, "run", 0).actions.some((action) => action.id === "spend-luck"));
  const spent = advance(source, failed.state, "spend-luck", fixedDice(99));
  assert.equal(spent.check?.roll, 12);
  assert.equal(spent.check?.grade, "extreme");
  assert.equal(spent.check?.success, true);
  assert.equal(spent.state.character.luck, 7);
});
