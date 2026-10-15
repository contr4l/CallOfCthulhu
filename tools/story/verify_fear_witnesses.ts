/** Re-execute reviewed input routes against the current candidate and engine. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";
type Draw = { min: number; max: number; value: number };
type Route = { seed: number; endingId: string; initialDraws: Draw[]; steps: { node: string; action: string; input: Record<string, string | number>; draws: Draw[]; resultNode: string }[] };
const candidate = resolve(process.env.FEAR_CANDIDATE ?? "work/alone-against-fear/packed-candidate");
const manifest = readFileSync(resolve(candidate, "story.json"));
const story = loadFragmentStory(resolve(candidate, "story.json"), value => runtimeGraphSchema.parse(value), validateStory);
const runtimeSha256 = runtimeFingerprint();
const routes = new Map<string, Route>(), provenance: { path: string; sha256: string; manifestSha256: string }[] = [];
assert.ok(process.argv.length > 2, "Provide reviewed route reports to execute");
for (const input of process.argv.slice(2)) {
  const path = resolve(input), bytes = readFileSync(path);
  const report = JSON.parse(bytes.toString()) as { storyId: string; sourcePdfSha256: string; manifestSha256: string; routes: Route[] };
  assert.equal(report.storyId, story.id); assert.equal(report.sourcePdfSha256, story.fear!.source.pdfSha256);
  provenance.push({ path, sha256: createHash("sha256").update(bytes).digest("hex"), manifestSha256: report.manifestSha256 });
  for (const route of report.routes) {
    let queue = route.initialDraws.slice();
    const dice = (min: number, max: number) => {
      const draw = queue.shift(); assert.ok(draw, "Unrecorded runtime draw"); assert.deepEqual([min, max], [draw.min, draw.max]);
      assert.ok(Number.isInteger(draw.value) && draw.value >= min && draw.value < max, "Invalid saved die face"); return draw.value;
    };
    let state = initialState(story, createCharacter("完整来源路线复验", story.presets[0], 0), dice);
    assert.equal(queue.length, 0);
    for (const [index, step] of route.steps.entries()) {
      assert.equal(state.nodeId, step.node, `Changed source transition before step ${index}`);
      assert.ok(project(story, state, "verification", index).actions.some(action => action.id === step.action), `Unavailable action at step ${index}`);
      queue = step.draws.slice(); state = advance(story, state, step.action, dice, step.input).state;
      assert.equal(queue.length, 0); assert.equal(state.nodeId, step.resultNode, `Changed source transition after step ${index}`);
    }
    assert.equal(state.status, "ended"); assert.equal(state.nodeId, route.endingId);
    const existing = routes.get(route.endingId);
    if (!existing || existing.steps.length > route.steps.length) routes.set(route.endingId, route);
  }
}
assert.equal(runtimeFingerprint(), runtimeSha256, "Runtime changed during verification; repeat against stable code");
const expected = Object.values(story.fear!.sceneRefs.endings), missing = expected.filter(id => !routes.has(id));
const report = { format: "coc-legal-route-witness@1", storyId: story.id, version: story.version,
  manifestSha256: createHash("sha256").update(manifest).digest("hex"), sourcePdfSha256: story.fear!.source.pdfSha256,
  runtimeSha256, provenance, expected, missing, routes: [...routes.values()] };
const output = resolve(process.env.FEAR_ROUTES ?? "work/alone-against-fear/verified-routes.json");
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ found: [...routes.keys()], missing, steps: [...routes.values()].map(route => route.steps.length), runtimeSha256 }));
