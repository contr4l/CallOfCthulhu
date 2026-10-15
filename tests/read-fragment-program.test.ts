import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";

test("reading a referenced chapter shows its fragment without executing its program, then resumes after restart", () => {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "read-only-fixture"; delete story.healthPolicy; story.entry = "entry";
  const background = story.nodes[0].background;
  story.nodes = [
    { id: "entry", type: "program", title: "查看报告", chapter: "1", text: ["先读报告，再继续自己的调查。"], background, program: [{ kind: "read", target: "report" }, { kind: "choices", choices: [{ id: "finish", label: "继续调查", target: "end" }] }] },
    { id: "report", type: "program", title: "资料中的报告", chapter: "287", sourceId: "287", text: ["报告记载着古城的路线。"], reading: { en: { title: "Report", text: ["The report describes the route."] } }, background, program: [{ kind: "effects", effects: [{ op: "flag", key: "unwanted", value: true }] }, { kind: "rollEffects", label: "报告原路线的骰子", effects: [{ op: "set", field: "counter.unwanted", value: "1D6" }] }, { kind: "route", target: "end" }] },
    { id: "end", type: "program", title: "继续调查", chapter: "2", text: ["按原先选择继续。"], background, program: [{ kind: "end", label: "结束", collect: false }] },
  ];
  const validated = validateStory(story), initial = initialState(validated, createCharacter("调查员", story.presets[0], 50), () => 1);
  const opened = advance(validated, initial, "next", () => { throw new Error("阅读资料不得执行骰点"); }).state;
  const reading = project(validated, opened, "run", 1);
  assert.equal(opened.nodeId, "entry"); assert.equal(opened.program!.cursor, 1);
  assert.equal(reading.title, "资料中的报告"); assert.deepEqual(reading.text, ["报告记载着古城的路线。"]);
  assert.equal(reading.collection!.chapterId, "287"); assert.equal(reading.reading!.en!.title, "Report");
  assert.equal(opened.flags.unwanted, undefined); assert.equal(opened.program!.counters.unwanted, undefined);
  const restored = JSON.parse(JSON.stringify(opened));
  assert.deepEqual(project(validated, restored, "run", 1), reading);
  const back = advance(validated, restored, "next", () => { throw new Error("返回资料不得重骰"); }).state;
  assert.equal(back.nodeId, "entry"); assert.equal(back.program!.cursor, 1);
  assert.equal(project(validated, back, "run", 2).title, "查看报告");
  assert.equal(back.flags.unwanted, undefined);
  assert.equal(advance(validated, back, "next", () => 1).state.status, "ended");
});
