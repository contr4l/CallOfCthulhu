/** Reconstruct a legal insanity route after source dice semantics change; never mutate state. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";
const candidate = resolve(process.env.FEAR_CANDIDATE!);
const bytes = readFileSync(resolve(candidate, "story.json"));
const story = loadFragmentStory(resolve(candidate, "story.json"), value => runtimeGraphSchema.parse(value), validateStory);
const sourcePath = resolve(process.argv[2]);
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const prior = source.routes.find((route: any) => route.endingId === "fear-ending-insane");
assert.ok(prior);
const fp = runtimeFingerprint();
type Draw = { min: number; max: number; value: number };
let planned: Draw[] = prior.initialDraws.slice(), observed: Draw[] = [];
const dice = (min: number, max: number) => {
  const priorDraw = planned.shift();
  if (priorDraw) assert.deepEqual([min, max], [priorDraw.min, priorDraw.max]);
  const value = priorDraw?.value ?? min;
  assert.ok(value >= min && value < max);
  observed.push({ min, max, value }); return value;
};
let state = initialState(story, createCharacter("理智归零合法路线", story.presets[0], 0), dice);
const initialDraws = observed.slice(), steps: any[] = [];
for (const [index, old] of prior.steps.entries()) {
  if (state.status === "ended") break;
  let scene = project(story, state, "insanity-construction", index);
  while (!scene.actions.some(action => action.id === old.action) && scene.fear?.pending) {
    // Engine pendings introduced since the itinerary (e.g. the source Mental-Scar substitution) are resolved
    // with real public actions; accepting the loss keeps every source deduction of the itinerary intact.
    const choice = scene.actions.find(action => action.label === "承受损失")
      ?? scene.actions.find(action => action.label === "重掷");
    assert.ok(choice, `No legal public action resolves pending ${scene.fear!.pending!.kind}: ${JSON.stringify(scene.actions)}`);
    planned = []; observed = [];
    const pendingNode = state.nodeId;
    state = advance(story, state, choice.id, dice).state;
    steps.push({ node: pendingNode, action: choice.id, input: {}, draws: observed.slice(), resultNode: state.nodeId });
    if (process.env.FEAR_INSANITY_DEBUG) console.error(`  resolve ${JSON.stringify(scene.fear!.pending)} sanity=${state.fear!.sanity} hp=${state.fear!.hp} combat=${state.fear!.combat?.enemyId}`);
    scene = project(story, state, "insanity-construction", index);
  }
  assert.ok(scene.actions.some(action => action.id === old.action), `Unavailable prior action ${index}: ${JSON.stringify(scene.actions)}`);
  planned = old.draws.slice(); observed = [];
  const node = state.nodeId;
  state = advance(story, state, old.action, dice, old.input ?? {}).state;
  steps.push({ node, action: old.action, input: old.input ?? {}, draws: observed.slice(), resultNode: state.nodeId });
  if (process.env.FEAR_INSANITY_DEBUG) console.error(`old ${index} sanity=${state.fear!.sanity} hp=${state.fear!.hp}`);
}
// The itinerary's final advance may queue a pending whose resolution delivers the ending loss; finish it legally.
let resolves = 0;
while (state.status === "active" && state.fear?.pending && resolves++ < 12) {
  const scene = project(story, state, "insanity-construction", steps.length);
  const choice = scene.actions.find(action => action.label === "承受损失")
    ?? scene.actions.find(action => action.label === "重掷");
  assert.ok(choice, `No legal public action resolves pending ${state.fear!.pending.kind}: ${JSON.stringify(scene.actions)}`);
  planned = []; observed = [];
  const pendingNode = state.nodeId;
  state = advance(story, state, choice.id, dice).state;
  steps.push({ node: pendingNode, action: choice.id, input: {}, draws: observed.slice(), resultNode: state.nodeId });
}
if (process.env.FEAR_INSANITY_DEBUG) console.error(JSON.stringify({ nodeId: state.nodeId, sanity: state.fear!.sanity, traumas: state.fear!.traumas, hp: state.fear!.hp, status: state.fear!.status, steps: steps.length }));
assert.equal(state.status, "ended");
assert.equal(state.nodeId, "fear-ending-insane");
assert.equal(runtimeFingerprint(), fp);
const report = { format: "coc-legal-route-witness@1", storyId: story.id, version: story.version, sourcePdfSha256: story.fear!.source.pdfSha256, manifestSha256: createHash("sha256").update(bytes).digest("hex"), runtimeSha256: fp, provenance: { sourcePath, notes: "Prior itinerary is a search aid. All public actions are checked and executed anew; new required dice use valid minimum faces and every actual draw is recorded. No state or progress injection." }, routes: [{ seed: prior.seed, presetId: story.presets[0].id, endingId: state.nodeId, initialDraws, steps }] };
writeFileSync(resolve(process.env.FEAR_INSANITY_OUTPUT ?? "work/alone-against-fear/final-insanity-constructed.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ending: state.nodeId, steps: steps.length }));
