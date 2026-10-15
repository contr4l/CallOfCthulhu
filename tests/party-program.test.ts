import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import type { Instruction } from "../packages/contracts/program.js";

function fixture(instructions: Instruction[]) {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "party-fixture";
  delete story.healthPolicy;
  story.entry = "entry";
  const character = createCharacter("向导", { ...story.presets[0], skills: { listen: 70 }, hp: 14 }, 45);
  story.party = { members: [{ id: "guide", character }, { id: "student", character: { ...character, name: "学生", skills: { listen: 30 } } }] };
  story.nodes = [{ id: "entry", type: "program", title: "同伴", chapter: "1", text: ["聆听树林。"], background: story.nodes[0].background,
    program: [...instructions, { kind: "end", label: "结束", collect: false }] }];
  return validateStory(story);
}
function start(story: ReturnType<typeof fixture>) {
  return initialState(story, createCharacter("教授", { ...story.presets[0], skills: { listen: 20 } }, 85), () => 1);
}
test("one chosen awake companion performs the requested skill once, without changing player skill", () => {
  const story = fixture([{ kind: "check", check: { skill: "listen", label: "聆听", delegate: true } }]);
  const state = start(story);
  assert.deepEqual(project(story, state, "run", 0).actions.map((a) => a.id), ["roll-actor:$player", "roll-actor:guide", "roll-actor:student"]);
  let draws = 0;
  const outcome = advance(story, state, "roll-actor:guide", () => { draws++; return 3; });
  assert.equal(draws, 2);
  assert.equal(outcome.check!.target, 70);
  assert.equal(outcome.check!.roll, 33);
  assert.equal(outcome.check!.success, true);
  assert.deepEqual(outcome.check!.performer, { id: "guide", name: "向导" });
  assert.equal(outcome.state.character.skills.listen, 20);
  assert.equal(outcome.state.program!.lastSkill, undefined);
  assert.throws(() => advance(story, outcome.state, "roll-actor:student", () => 1), /已经结束/);
  assert.equal(state.party!.members[0].character.hp, 14);
});
test("absent and unconscious companions cannot roll; revival restores consciousness without inventing HP", () => {
  const story = fixture([
    { kind: "effects", effects: [
      { op: "party", member: "guide", action: "hp", value: -100 },
      { op: "party", member: "student", action: "status", value: "missing" },
    ] },
    { kind: "check", check: { skill: "listen", label: "聆听", delegate: true } },
    { kind: "effects", effects: [{ op: "party", member: "guide", action: "restore" }] },
    { kind: "check", check: { skill: "listen", label: "再次聆听", delegate: true } },
  ]);
  const state = start(story);
  assert.equal(state.party!.members[0].character.hp, 0);
  assert.equal(state.party!.members[0].unconscious, true);
  const projection = project(story, state, "run", 0);
  assert.deepEqual(projection.actions.map((a) => a.id), ["next"]);
  for (const id of ["guide", "student", "unknown"]) assert.throws(() => advance(story, state, `roll-actor:${id}`, () => 1), /不能由/);
  const next = advance(story, state, "next", () => 1).state;
  assert.equal(next.party!.members[0].character.hp, 0);
  assert.equal(next.party!.members[0].unconscious, false);
  assert.deepEqual(project(story, next, "run", 1).actions.map((a) => a.id), ["roll-actor:$player", "roll-actor:guide"]);
  const recovered = JSON.parse(JSON.stringify(next));
  assert.deepEqual(project(story, recovered, "run", 1), project(story, next, "run", 1));
  assert.equal(story.party!.members[0].character.hp, 14);
});
test("named-actor checks use explicit source attributes rather than offered delegation", () => {
  const story = fixture([{ kind: "check", check: { skill: "listen", label: "向导聆听", target: { field: "party.guide.skill.listen" } } }]);
  const state = start(story);
  assert.equal(project(story, state, "run", 0).check!.target, 70);
  assert.throws(() => advance(story, state, "roll-actor:student", () => 1), /执行者/);
  assert.equal(advance(story, state, "next", () => 3).check!.target, 70);
});
test("summed party strength remains above 99 and breaks opposed ties using that explicit sum", () => {
  const story = fixture([
    { kind: "effects", effects: [{ op: "set", field: "counter.combinedStrength", value: 145 }] },
    { kind: "check", check: { skill: "str", label: "合力制服", target: { field: "counter.combinedStrength" }, opposed: 93 } },
  ]);
  const state = start(story);
  const faces = [0, 3, 0, 3];
  const outcome = advance(story, state, "next", () => faces.shift()!);
  assert.equal(outcome.check!.target, 145);
  assert.equal(outcome.check!.grade, "hard");
  assert.equal(outcome.check!.opponent!.grade, "hard");
  assert.equal(outcome.check!.success, true);
  assert.equal(faces.length, 0);
});
test("opposed hunter penalty is applied independently of the investigator bonus", () => {
  const story = fixture([{ kind: "check", check: { skill: "str", label: "脱身", target: 70, opposed: 60, bonus: 1, opposedPenalty: 1 } }]);
  const state = start(story), faces = [0, 1, 9, 0, 8, 1];
  const result = advance(story, state, "next", () => { assert.ok(faces.length); return faces.shift()!; });
  assert.equal(faces.length, 0);
  assert.equal(result.check!.opponent!.roll, 90);
  assert.equal(result.check!.roll, 10);
  assert.equal(result.check!.success, true);
  assert.equal(result.check!.opponent!.grade, "failure");
});
