import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";

test("player-written plans survive restart and a source puzzle checks text without dice or code execution", () => {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "written-plan-fixture"; delete story.healthPolicy; story.entry = "entry";
  const background = story.nodes[0].background;
  story.nodes = [
    { id: "entry", type: "program", title: "记录计划", chapter: "1", text: ["记录自己的计划。"], background, program: [
      { kind: "text", key: "plan", label: "你的计划", maxLength: 100 },
      { kind: "text", key: "answer", label: "字母答案", minLength: 1, maxLength: 10 },
      { kind: "route", target: "yes", condition: { note: "answer", equals: "K", caseInsensitive: true } },
      { kind: "route", target: "no" },
    ] },
    ...["yes", "no"].map(id => ({ id, type: "program" as const, title: id, chapter: id, text: [id], background, program: [{ kind: "end" as const, label: id, collect: false }] })),
  ];
  const validated = validateStory(story);
  const noDice = () => { throw new Error("文本输入不得掷骰"); };
  const state = initialState(validated, createCharacter("教授", story.presets[0], 50), noDice);
  assert.equal(project(validated, state, "run", 0).input!.kind, "text");
  for (const text of [" ", "a".repeat(101), 42]) assert.throws(() => advance(validated, state, "confirm", noDice, { text }), /填写记录/);
  const written = advance(validated, state, "confirm", noDice, { text: "${DO_NOT_EXECUTE} <script>计划</script>" }).state;
  const restored = JSON.parse(JSON.stringify(written));
  assert.equal(restored.program.notes.plan, "${DO_NOT_EXECUTE} <script>计划</script>");
  assert.equal(state.program!.notes, undefined);
  assert.equal(advance(validated, restored, "confirm", noDice, { text: " k " }).state.nodeId, "yes");
  assert.equal(advance(validated, restored, "confirm", noDice, { text: "a" }).state.nodeId, "no");
});
