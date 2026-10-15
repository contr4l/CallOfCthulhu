import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";

function fixture() {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "reroll-fixture"; delete story.healthPolicy; story.entry = "entry";
  const background = story.nodes[0].background;
  story.nodes = [
    { id: "entry", title: "适配重掷", chapter: "1", text: ["适配规则。"], background, type: "program", program: [
      { kind: "effects", effects: [{ op: "add", field: "counter.water", value: -1 }, { op: "add", field: "counter.travelDay", value: 1 }] },
      { kind: "random", sides: 10, reroll: [5], targets: Array.from({ length: 10 }, () => "end") },
    ] },
    { id: "end", title: "目的地", chapter: "2", text: ["到达。"], background, type: "program", program: [{ kind: "end", label: "结束", collect: false }] },
  ];
  return story;
}
test("only the adapted D10 item rerolls, preserving water, day, cursor and the visible draw", () => {
  const story = validateStory(fixture());
  let state = initialState(story, createCharacter("教授", story.presets[0], 50), () => { throw new Error("进入不掷骰"); });
  for (let attempt = 0; attempt < 2; attempt++) {
    let draws = 0;
    const result = advance(story, state, "roll", (min, max) => { draws++; assert.deepEqual([min, max], [1, 11]); return 5; });
    assert.equal(draws, 1); assert.equal(result.dice!.value, 5);
    state = JSON.parse(JSON.stringify(result.state));
    assert.equal(state.nodeId, "entry"); assert.equal(state.program!.cursor, 1);
    assert.equal(state.program!.counters.water, -1); assert.equal(state.program!.counters.travelDay, 1);
  }
  const resolved = advance(story, state, "roll", () => 6);
  assert.equal(resolved.state.nodeId, "end"); assert.equal(resolved.dice!.value, 6);
});
test("publishing rejects out-of-range, duplicate or all-face rerolls", () => {
  for (const faces of [[11], [5, 5], Array.from({ length: 10 }, (_, i) => i + 1)]) {
    const story = fixture(), step = story.nodes[0].program![1];
    if (step.kind !== "random") throw Error("fixture");
    step.reroll = faces;
    assert.throws(() => validateStory(story), /重掷面/);
  }
});
