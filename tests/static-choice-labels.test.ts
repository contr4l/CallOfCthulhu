import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadStories,
  runtimeGraphSchema,
  validateStory,
} from "../apps/api/src/catalog.js";
import { loadFragmentStory } from "../apps/api/src/modules/story-fragments.js";
import { createCharacter } from "../packages/rules/index.js";
import { initialState, advance, project } from "../packages/engine/index.js";
const directory = resolve(
  process.env.STATIC_CHOICE_CANDIDATE ?? "stories/alone-against-static/1.2.1",
);
const current = loadFragmentStory(
  resolve(directory, "story.json"),
  (data) => runtimeGraphSchema.parse(data),
  validateStory,
);
const old = loadStories("stories").get("alone-against-static@1.2.0")!;
const labels = new Map([
  ["62/to-57", "返回棚屋"],
  ["65/to-57", "返回棚屋"],
  ["138/to-120", "要回到小屋去锁好门"],
  ["177/to-182", "要回到小屋里锁好门"],
  ["240/to-294", "要回到小屋去"],
]);
test("Static 1.2.1 changes exactly five captions while preserving complete text, programs, characters and old versions", () => {
  assert.equal(current.version, "1.2.1");
  assert.deepEqual(current.presets, old.presets);
  let changed = 0;
  for (const node of current.nodes) {
    const previous = old.nodes.find((n) => n.id === node.id)!;
    assert.deepEqual(node.text, previous.text, node.id);
    assert.deepEqual(node.reading, previous.reading, node.id);
    const expected = structuredClone(previous.program!);
    for (const step of expected)
      if (step.kind === "choices")
        for (const option of step.choices) {
          const label = labels.get(`${node.id}/${option.id}`);
          if (label) {
            option.label = label;
            changed++;
          }
        }
    assert.deepEqual(node.program, expected, node.id);
    for (const step of node.program!)
      if (step.kind === "choices")
        for (const option of step.choices)
          assert.ok(!["要", "或者", "如果"].includes(option.label), node.id);
  }
  assert.equal(changed, 5);
  const normalize = (story: typeof current) => {
    const clone = structuredClone(story);
    clone.version = "comparison";
    if (clone.source) clone.source.notes = [];
    clone.nodes.forEach((n) => {
      n.program?.forEach((step) => {
        if (step.kind === "choices")
          step.choices.forEach((c) => {
            c.label = "caption";
          });
      });
    });
    return clone;
  };
  assert.deepEqual(normalize(current), normalize(old));
  const single = { ...current, entry: "177" };
  const state = initialState(
    single,
    createCharacter("文案检查", single.presets[0], 45),
    (min) => min,
  );
  assert.deepEqual(project(single, state, "caption", 0).actions, [
    { id: "next", label: "下一节" },
  ]);
});
test("the compiler keeps nonnumeric return prose and rejects incomplete navigation captions", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import sys
sys.path.insert(0, 'tools/story')
from static_choice_labels import static_choice_label
from compile_solo import parse_static, load_static, static_module
cases = [('138','要回到小屋去锁好门，转到 120。','要回到小屋去锁好门'),('240','要回到小屋去，转到 294。','要回到小屋去'),('62','或者，回到 57。','返回棚屋'),('65','或者，回到 57。','返回棚屋'),('9','要转到屋后看看，回到 57。','要转到屋后看看'),('9','转到 57。','继续')]
for node,line,expected in cases: assert static_choice_label(node,line)==expected,(node,line)
try: static_choice_label('999','或者，回到 57。')
except ValueError: pass
else: raise AssertionError('unreviewed caption accepted')
assert len(static_module()['nodes']) == 377
_,raw=load_static()
for node,target,expected in [('138','120','要回到小屋去锁好门'),('177','182','要回到小屋里锁好门'),('240','294','要回到小屋去'),('62','57','返回棚屋'),('65','57','返回棚屋')]:
 choices=[c for step in parse_static(node,raw[node]) for c in step.get('choices',[]) if c.get('target')==target]
 assert len(choices)==1 and choices[0]['label']==expected,(node,choices)
`,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
test("all 28 role/ending itineraries and the exhausted-box regression replay without changing any dice or available actions", () => {
  const report = JSON.parse(
    readFileSync("tests/browser/fixtures/static-endings.json", "utf8"),
  );
  let paths = 0;
  const observed = new Map<string, string>();
  for (const route of [...report.perRoleRoutes, ...report.regressionRoutes]) {
    let draws = route.initialDraws.slice();
    const dice = (min: number, max: number) => {
      const d = draws.shift();
      assert.ok(d);
      assert.deepEqual([d.min, d.max], [min, max]);
      return d.value;
    };
    let state = initialState(
      current,
      createCharacter(
        "完整文案回放",
        current.presets[route.role],
        route.luckDice.reduce((a: number, b: number) => a + b, 0) * 5,
      ),
      dice,
    );
    for (const [index, step] of route.steps.entries()) {
      assert.equal(state.nodeId, step.node);
      const view = project(current, state, "caption-route", index);
      assert.ok(view.actions.some((a) => a.id === step.action));
      for (const action of view.actions) {
        const key = `${state.nodeId}/${action.id}`;
        if (labels.has(key)) {
          assert.equal(action.label, labels.get(key));
          observed.set(key, action.label);
        }
      }
      if (state.nodeId === "138")
        assert.equal(view.actions[1].label, "要跟着他深入森林");
      draws = step.draws.slice();
      state = advance(current, state, step.action, dice).state;
      assert.equal(draws.length, 0);
      assert.equal(state.nodeId, step.resultNode);
    }
    assert.equal(state.status, "ended");
    assert.equal(state.nodeId, route.endingId);
    paths++;
  }
  assert.equal(paths, 29);
  assert.equal(observed.size, 4); // 177 intentionally exposes the single automatic "下一节".
});
