import test from "node:test";
import assert from "node:assert/strict";
import { loadStories } from "../apps/api/src/catalog.js";
import { initialState } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";

test("fixed characters outside Static do not inherit Static identity flags", () => {
  const original = loadStories("stories").get("alone-against-static@1.2.0")!;
  assert.ok(original);
  const story = structuredClone(original);
  story.id = "another-solo-module";
  story.entry = "entry";
  story.nodes = [{
    id: "entry", title: "入口", chapter: "1", text: ["另一部作品"],
    type: "program", background: original.nodes[0].background,
    program: [{ kind: "end", label: "结束", collect: false }],
  }];
  const character = createCharacter("预设调查员", {
    ...story.presets[0], templateId: "another-investigator",
  }, 50);
  const state = initialState(story, character, () => 1);
  assert.equal(state.flags["亚历克斯"], undefined);
  assert.equal(state.flags["查理"], undefined);
  assert.equal(state.character.templateId, "another-investigator");
  assert.equal(state.status, "ended");

  for (const preset of original.presets) {
    const staticState = initialState(original, createCharacter("原角色", preset, 50), () => 1);
    assert.equal(staticState.flags[preset.templateId === "static-alex" ? "亚历克斯" : "查理"], true);
  }
});
