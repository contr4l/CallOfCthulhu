import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";

function fixture() {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "group-combat-fixture"; delete story.healthPolicy; story.entry = "fight";
  const background = story.nodes[0].background;
  story.nodes = [{ id: "fight", type: "program", title: "两个对手", chapter: "1", text: ["对手同时攻击。"], background, program: [
    { kind: "effects", effects: [{ op: "item-count", key: "revolver", label: "左轮", action: "set", value: 1 }, { op: "set", field: "counter.bullets", value: 2 }] },
    { kind: "combat", combat: { name: "对手", hp: 5, count: 2, initiative: "player-first", fighting: 10, dodge: 0, damage: "0", winHp: 0, win: "win", lose: "lose", attacks: [[{ skill: 10, damage: "0" }, { skill: 10, damage: "0" }]], weapons: [
      { id: "revolver", label: "左轮", skill: "firearmsHandgun", damage: "5", key: "revolver", ammo: "counter.bullets", firearm: true },
      { id: "unarmed", label: "徒手", skill: "fightingBrawl", damage: "1D3", damageBonus: true },
    ] } },
  ] }, ...["win", "lose"].map(id => ({ id, type: "program" as const, title: id, chapter: id, text: [id], background, program: [{ kind: "end" as const, label: id, collect: false }] }))];
  return validateStory(story);
}
test("multiple foes retain separate HP, dead foes skip attacks, firearms spend one round with no melee counter-roll", () => {
  const story = fixture(); const character = createCharacter("教授", { ...story.presets[0], skills: { ...story.presets[0].skills, firearmsHandgun: 99, dodge: 99 } }, 50);
  const start = initialState(story, character, () => 1);
  assert.deepEqual(project(story, start, "run", 0).combat!.enemyLives, [5, 5]);
  let draws = 0;
  const shot = advance(story, start, "attack:revolver:1", () => { draws++; return 1; }).state;
  assert.equal(draws, 2); assert.deepEqual(shot.program!.combat!.enemyLives, [5, 0]);
  assert.equal(shot.program!.counters.bullets, 1); assert.equal(shot.program!.combat!.playerTurn, false);
  assert.throws(() => advance(story, shot, "attack:revolver:0", () => { throw new Error("invalid phase must not roll"); }), /阶段/);
  let state = JSON.parse(JSON.stringify(shot));
  const defend = () => { const values = [1, 1, 9, 9]; return () => values.shift()!; };
  state = advance(story, state, "dodge", defend()).state;
  assert.equal(state.program!.combat!.round, 1);
  state = advance(story, state, "dodge", defend()).state;
  assert.equal(state.program!.combat!.round, 2); assert.equal(state.program!.combat!.playerTurn, true);
  assert.throws(() => advance(story, state, "attack:revolver:1", () => { throw new Error("dead target must not roll"); }), /目标/);
  const win = advance(story, state, "attack:revolver:0", () => 1).state;
  assert.equal(win.nodeId, "win"); assert.equal(win.program!.counters.bullets, 0);
  assert.equal(start.program!.counters.bullets, 2); assert.deepEqual(start.program!.combat!.enemyLives, [5, 5]);
});
test("the source's cumulative damage limit routes immediately and is validated as a real node", () => {
  const story = fixture();
  const combat = story.nodes[0].program![1];
  if (combat.kind !== "combat") throw new Error("fixture");
  combat.combat.initiative = "enemy-first"; combat.combat.attacks = [[{ skill: 99, damage: "6" }]];
  combat.combat.damageLimit = { amount: 6, target: "lose" };
  const validated = validateStory(story), character = createCharacter("教授", { ...story.presets[0], skills: { ...story.presets[0].skills, dodge: 0 } }, 50);
  const state = initialState(validated, character, () => 1);
  const dice = [9, 9, 1, 1];
  const hurt = advance(validated, state, "dodge", () => dice.shift()!).state;
  assert.equal(hurt.program!.counters.combatDamageTaken, 6); assert.equal(hurt.nodeId, "lose");
  combat.combat.damageLimit.target = "missing";
  assert.throws(() => validateStory(story), /缺失节点/);
});
test("a source round hook returns to saved combat HP and phase without repeating completed attacks", () => {
  const story = fixture();
  const step = story.nodes[0].program![1];
  if (step.kind !== "combat") throw new Error("fixture");
  step.combat.hp = { field: "counter.enemyHp" };
  step.combat.roundCalls = [{ afterRound: 1, call: "hook" }];
  story.nodes[0].program!.unshift({ kind: "effects", effects: [{ op: "set", field: "counter.enemyHp", value: 5 }] });
  story.nodes.push({ id: "hook", type: "program", title: "同伴恐惧检定前", chapter: "1", text: ["两个回合过去。"], background: story.nodes[0].background,
    program: [{ kind: "choices", choices: [{ id: "return", label: "继续战斗", target: "$return" }] }] });
  const validated = validateStory(story), character = createCharacter("教授", { ...story.presets[0], skills: { ...story.presets[0].skills, firearmsHandgun: 99, dodge: 99 } }, 50);
  let state = initialState(validated, character, () => 1);
  state = advance(validated, state, "attack:revolver:1", () => 1).state;
  for (let i = 0; i < 2; i++) { const dice = [1, 1, 9, 9]; state = advance(validated, state, "dodge", () => dice.shift()!).state; }
  assert.equal(state.nodeId, "hook");
  assert.deepEqual(state.program!.returns.at(-1)!.combat!.enemyLives, [5, 0]);
  const restored = JSON.parse(JSON.stringify(state));
  const resumed = advance(validated, restored, "next", () => { throw new Error("返回战斗不得重掷"); }).state;
  assert.equal(resumed.nodeId, "fight"); assert.equal(resumed.program!.combat!.round, 2);
  assert.deepEqual(resumed.program!.combat!.enemyLives, [5, 0]);
  assert.equal(resumed.program!.counters.bullets, 1);
  assert.equal(advance(validated, resumed, "attack:revolver:0", () => 1).state.nodeId, "win");
});
test("new books opt into the core bonus for subsequent melee attacks while preserving every opponent candidate", () => {
  const story = fixture(), step = story.nodes[0].program![1];
  if (step.kind !== "combat") throw new Error("fixture");
  step.combat.coreRules = true; step.combat.initiative = "enemy-first";
  const character = createCharacter("教授", { ...story.presets[0], skills: { ...story.presets[0].skills, dodge: 99 } }, 50);
  const validated = validateStory(story), initial = initialState(validated, character, () => 1);
  const first = [1, 1, 9, 9];
  const once = advance(validated, initial, "dodge", () => first.shift()!).state;
  const second = [1, 1, 9, 9, 0];
  const twice = advance(validated, once, "dodge", () => second.shift()!);
  assert.equal(second.length, 0); assert.equal(twice.check!.target, 99);
  assert.deepEqual(twice.check!.opponent!.candidates, [99, 9]);
  assert.equal(twice.check!.opponent!.roll, 9);
});
test("core extreme melee damage maximizes both weapon and damage bonus without drawing damage dice", () => {
  const story = fixture(), step = story.nodes[0].program![1];
  if (step.kind !== "combat") throw new Error("fixture");
  step.combat.coreRules = true; step.combat.count = 1; step.combat.hp = 20;
  const character = createCharacter("教授", { ...story.presets[0], damageBonus: "+1D4", skills: { ...story.presets[0].skills, fightingBrawl: 99 } }, 50);
  const validated = validateStory(story), initial = initialState(validated, character, () => 1);
  const dice = [1, 0, 9, 9];
  const hit = advance(validated, initial, "attack:unarmed:0", () => { assert.ok(dice.length > 0); return dice.shift()!; });
  assert.equal(dice.length, 0); assert.equal(hit.check!.combat!.damage, 7);
  assert.deepEqual(hit.state.program!.combat!.enemyLives, [13]);
});
