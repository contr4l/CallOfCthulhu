import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory, publicStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import { field } from "../packages/engine/program.js";

function fixture() {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "investigator-fixture";
  delete story.healthPolicy;
  story.entry = "first";
  const first = createCharacter("第一位", story.presets[0], 50);
  const second = createCharacter("继任者", { ...story.presets[0], skills: { listen: 40, spotHidden: 30 } }, 55);
  story.investigators = { first: "first", members: [{ id: "first", entry: "first", character: first }, { id: "second", entry: "second", character: second }], restartNode: "restart", sharedFlags: ["world-clue"], sharedCounters: ["world-progress"] };
  const node = (id: string, program: NonNullable<(typeof story.nodes)[number]["program"]>) => ({ id, title: id, chapter: "1", text: ["测试中的调查员接续。"], type: "program" as const, background: story.nodes[0].background, program });
  story.nodes = [
    node("first", [
      { kind: "choices", choices: [{ id: "prepare", label: "调查", effects: [
        { op: "flag", key: "private-clue", value: true }, { op: "flag", key: "world-clue", value: true },
        { op: "set", field: "counter.private-attempt", value: 3 }, { op: "set", field: "counter.world-progress", value: 7 },
        { op: "item", key: "revolver", label: "左轮手枪" },
      ] }] },
      { kind: "choices", choices: [
        { id: "lose", label: "退场", target: "next", effects: [{ op: "investigator", action: "lose", reason: "测试败亡", private: true, location: "estate" }] },
        { id: "suspend", label: "暂时离场", call: "suspend" },
      ] },
      { kind: "choices", choices: [{ id: "continue", label: "恢复调查", target: "finish" }] },
    ]),
    node("second", [{ kind: "choices", choices: [
      { id: "inherit", label: "通过幸运后取回遗物", target: "second", effects: [{ op: "investigator", action: "inherit", from: "first", location: "estate" }] },
      { id: "lose", label: "退场", target: "next", effects: [{ op: "investigator", action: "lose", reason: "测试败亡" }] },
      { id: "resume", label: "退场并恢复前人", target: "resume", effects: [{ op: "investigator", action: "lose", reason: "测试败亡" }] },
    ] }]),
    node("next", [{ kind: "investigator", action: "activate-next" }]),
    node("suspend", [{ kind: "effects", effects: [{ op: "investigator", action: "suspend", minutes: 120 }] }, { kind: "investigator", action: "activate-next" }]),
    node("resume", [{ kind: "investigator", action: "resume" }]),
    node("restart", [{ kind: "choices", choices: [{ id: "restart", label: "重新开始", target: "restart-fresh" }, { id: "reuse", label: "复用角色", target: "restart-reuse" }] }]),
    node("restart-fresh", [{ kind: "investigator", action: "restart", reuse: false }]),
    node("restart-reuse", [{ kind: "investigator", action: "restart", reuse: true }]),
    node("finish", [{ kind: "end", label: "测试结束", collect: false }]),
  ];
  return validateStory(story);
}
test("investigator loss activates one successor without transferring stats, property or archive identity", () => {
  const story = fixture();
  const initial = initialState(story, createCharacter("自选姓名", story.presets[0], 50), () => 1);
  initial.createdCharacterId = "first-card";
  const prepared = advance(story, initial, "next", () => 1).state;
  const next = advance(story, prepared, "lose", () => { throw new Error("角色卡接续不得重掷幸运"); }).state;
  assert.equal(next.nodeId, "second"); assert.equal(next.status, "active");
  assert.equal(next.investigators!.current, "second"); assert.equal(next.investigators!.totalLossCount, 1);
  assert.equal(next.character.name, "继任者"); assert.equal(next.character.luck, 55);
  assert.deepEqual(next.character.skills, { listen: 40, spotHidden: 30 });
  assert.deepEqual(next.inventory, []); assert.equal(next.flags["private-clue"], undefined);
  assert.equal(next.flags["world-clue"], true); assert.equal(next.program!.counters["world-progress"], 7);
  assert.equal(next.program!.counters["private-attempt"], undefined);
  assert.equal(next.createdCharacterId, undefined);
  assert.equal(next.investigators!.actors.first.createdCharacterId, "first-card");
  assert.ok(!( "investigators" in publicStory(story)));
  assert.deepEqual(project(story, JSON.parse(JSON.stringify(next)), "run", 2), project(story, next, "run", 2));
  assert.equal(prepared.character.name, "自选姓名");
  const inherited = advance(story, next, "inherit", () => 1).state;
  assert.deepEqual(inherited.inventory, [{ key: "revolver", label: "左轮手枪" }]);
  assert.throws(() => advance(story, inherited, "inherit", () => 1), /没有可继承/);
});
test("restarting after all investigators are lost retains total score and resets individual world state", () => {
  const story = fixture();
  let state = initialState(story, createCharacter("首位", story.presets[0], 50), () => 1);
  state = advance(story, state, "next", () => 1).state;
  state = advance(story, state, "lose", () => 1).state;
  state = advance(story, state, "lose", () => 1).state;
  assert.equal(state.nodeId, "restart");
  state = advance(story, state, "reuse", () => 1).state;
  assert.equal(state.nodeId, "first"); assert.equal(state.investigators!.cycle, 2);
  assert.equal(field(state, "campaign.losses"), 2); assert.equal(field(state, "campaign.cycleLosses"), 0);
  assert.equal(state.flags["world-clue"], undefined); assert.equal(state.flags["investigator-reused"], true);
  assert.deepEqual(state.inventory, []);
  assert.deepEqual(state.investigators!.previousCycles, [{ cycle: 1, losses: 2 }]);
});
test("temporary absence returns to the saved instruction after a successor loss without repeating the source choice", () => {
  const story = fixture();
  let state = initialState(story, createCharacter("首位", story.presets[0], 50), () => 1);
  state = advance(story, state, "next", () => 1).state;
  state = advance(story, state, "suspend", () => 1).state;
  assert.equal(state.investigators!.suspended, "first"); assert.equal(state.nodeId, "second");
  const restarted = JSON.parse(JSON.stringify(state));
  state = advance(story, restarted, "resume", () => 1).state;
  assert.equal(state.nodeId, "first"); assert.equal(state.program!.cursor, 2);
  assert.equal(state.investigators!.current, "first"); assert.equal(state.investigators!.suspended, undefined);
  assert.equal(state.program!.counters.suspendedRemainingMinutes, 120);
  assert.deepEqual(state.inventory, [{ key: "revolver", label: "左轮手枪" }]);
  assert.equal(advance(story, state, "next", () => 1).state.status, "ended");
});
