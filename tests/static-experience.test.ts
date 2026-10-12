import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadStories } from "../apps/api/src/catalog.js";
import { createCharacter } from "../packages/rules/index.js";
import {
  advance,
  initialState,
  project,
  withSceneReading,
} from "../packages/engine/index.js";

const stories = loadStories("stories");
const old = stories.get("alone-against-static@1.0.0")!;
const story = stories.get("alone-against-static@1.1.0")!;
const low = (min: number, max: number) => (max === 10 ? 1 : min);

test("Static web edition preserves all source entries, reviewed rules and old saves", () => {
  assert.equal(story.nodes.length, 377);
  assert.equal(story.nodes.filter((n) => /^\d+$/.test(n.id)).length, 372);
  assert.deepEqual(story.presets, old.presets);
  assert.equal(
    story.source!.sha256,
    createHash("sha256")
      .update(readFileSync("scripts/静躁独行.txt"))
      .digest("hex"),
  );
  for (const node of story.nodes) {
    const original = old.nodes.find((n) => n.id === node.id)!;
    assert.equal(node.sourceId, original.sourceId);
    assert.deepEqual(
      node.program!.filter((step) => step.kind !== "end"),
      original.program!.filter((step) => step.kind !== "end"),
      node.id,
    );
    assert.ok(node.reading?.["zh-CN"]);
    assert.ok(!node.reading?.en);
    assert.ok(
      !node.text.some((text) =>
        /(?:转到|回到)\s*\d+|记录表|勾选|记录当前条目|角色卡|尚未选择|回到你失去理智/.test(
          text,
        ),
      ),
      node.id,
    );
  }
  const paragraphs = story.nodes.find((n) => n.id === "8")!.text;
  assert.ok(paragraphs.some((text) => text.includes("而且还不肯要你帮忙")));
  assert.ok(paragraphs.some((text) => text.includes("在你头顶")));
  const state = initialState(
    old,
    createCharacter("旧局", old.presets[0], 45),
    low,
  );
  const view = project(old, state, "old", 0);
  const { reading: _reading, ...legacy } = view;
  const restored = withSceneReading(old, legacy);
  assert.equal(restored.revision, legacy.revision);
  assert.deepEqual(restored.character, legacy.character);
  assert.ok(restored.reading?.["zh-CN"]);
});

test("both roles keep automatic records, deterministic next and conditional dice branches", () => {
  for (const [role, target] of [
    [0, "1"],
    [1, "2"],
  ] as const) {
    const state = initialState(
      story,
      createCharacter("角色测试", story.presets[role], 45),
      low,
    );
    const view = project(story, state, "test", 0);
    assert.deepEqual(view.actions, [{ id: "next", label: "下一节" }]);
    const next = advance(story, state, "next", low).state;
    assert.equal(next.nodeId, target);
    assert.equal(project(story, next, "test", 1).actions.length, 2);
    assert.ok(
      project(story, next, "test", 1).registrations!.some(
        (r) => r.label === story.presets[role].label,
      ),
    );
    assert.throws(() =>
      advance(story, state, role === 0 ? "charlie" : "alex", low),
    );
  }
  const state = initialState(
    { ...story, entry: "5" },
    createCharacter("检定测试", story.presets[0], 45),
    low,
  );
  const result = advance(story, state, "next", (_min, max) => max - 1);
  assert.equal(result.check!.success, false);
  assert.ok(
    project(story, result.state, "test", 1).registrations!.some(
      (r) => r.label === "着凉",
    ),
  );
  assert.equal(project(story, result.state, "test", 1).actions.length, 2);
});

test("new edition supports full survival walks for both roles and fourteen distinct collected endings", () => {
  for (const [role, seed] of [
    [0, 12],
    [1, 1],
  ]) {
    let random = seed;
    let state = initialState(
      story,
      createCharacter("生还测试", story.presets[role], 45),
      low,
    );
    for (let i = 0; i < 200 && state.status === "active"; i++) {
      const scene = project(story, state, "test", i);
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      state = advance(
        story,
        state,
        scene.actions[(random >>> 16) % scene.actions.length].id,
        low,
      ).state;
    }
    const scene = project(story, state, "test", 200);
    assert.equal(state.nodeId, "367");
    assert.equal(scene.ending, "独自生还");
    assert.equal(scene.collection!.endingId, "367");
    assert.ok(state.character.hp > 0);
  }
  const endings = story.nodes.filter((n) =>
    n.program!.some((s) => s.kind === "end"),
  );
  assert.equal(endings.length, 14);
  assert.equal(new Set(endings.map((n) => n.title)).size, 14);
});
