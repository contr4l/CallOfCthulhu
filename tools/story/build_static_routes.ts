import { writeFileSync } from "node:fs";
import { loadStories } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";

const story = loadStories("stories").get("alone-against-static@1.2.0")!;
const routes = [];
for (const [name, role, seed, cold] of [
  ["alex", 0, 12, false],
  ["charlie", 1, 1, false],
  ["cold", 0, 12, true],
] as const) {
  const low = (min: number, max: number) => (max === 10 ? 1 : min);
  let state = initialState(
    story,
    createCharacter("路线测试", story.presets[role], 15),
    low,
  );
  let random: number = seed;
  const steps = [];
  for (let i = 0; i < 250 && state.status === "active"; i++) {
    const scene = project(story, state, "test", i);
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const action = scene.actions[(random >>> 16) % scene.actions.length].id;
    steps.push({ chapter: scene.collection!.chapterId, action });
    const fail = cold && state.nodeId === "5";
    state = advance(story, state, action, (min, max) =>
      fail && max === 10 ? 9 : low(min, max),
    ).state;
  }
  if (state.status !== "ended")
    throw new Error(`${name}: route did not finish`);
  routes.push({
    name,
    role,
    failNodes: cold ? ["5"] : [],
    steps,
    endingId: state.nodeId,
    ending: project(story, state, "test", steps.length).ending,
  });
  console.log(name, steps.length, state.nodeId);
}
writeFileSync(
  "tests/browser/fixtures/static-routes.json",
  JSON.stringify(routes, null, 2) + "\n",
);
