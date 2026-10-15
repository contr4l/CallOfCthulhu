/** Replay a real entry prefix, then deliberately select legal failed rolls.
 * Used to audit printed failure branches without injecting party state or progress.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";
type Draw = { min: number; max: number; value: number };
type Step = { node: string; action: string; input: Record<string, string | number>; draws: Draw[]; resultNode: string };
type Witness = { seed: number; role: number; initialDraws: Draw[]; steps: Step[] };
const candidate = resolve(process.env.FROST_CANDIDATE!);
const manifest = readFileSync(resolve(candidate, "story.json"));
const story = loadFragmentStory(resolve(candidate, "story.json"), value => runtimeGraphSchema.parse(value), validateStory);
const report = JSON.parse(readFileSync(resolve(process.env.FROST_PREFIX_ROUTES!), "utf8"));
assert.equal(report.storyId, story.id); assert.equal(report.sourcePdfSha256, story.source?.sha256);
const prefixNode = process.env.FROST_PREFIX_NODE ?? "451", target = process.env.FROST_TARGET ?? "456";
const results: unknown[] = [];
for (const witness of [...report.routes, ...report.stopped ?? [], ...report.errors ?? []] as Witness[]) {
  const position = witness.steps.findIndex(step => step.node === prefixNode);
  if (position < 0) continue;
  let queue = witness.initialDraws.slice();
  const replayDice = (min: number, max: number) => { const draw = queue.shift(); assert.ok(draw); assert.deepEqual([min, max], [draw.min, draw.max]); assert.ok(draw.value >= min && draw.value < max); return draw.value; };
  let state = initialState(story, createCharacter("完整合法失败路线", story.presets[witness.role], 0), replayDice);
  assert.equal(queue.length, 0);
  const steps: Step[] = [];
  for (const [i, step] of witness.steps.slice(0, position).entries()) {
    assert.equal(state.nodeId, step.node); assert.ok(project(story, state, "prefix", i).actions.some(action => action.id === step.action));
    queue = step.draws.slice(); state = advance(story, state, step.action, replayDice, step.input).state;
    assert.equal(queue.length, 0); assert.equal(state.nodeId, step.resultNode); steps.push(step);
  }
  let error: string | undefined;
  try {
    for (let i = 0; i < 60 && state.status === "active" && state.nodeId !== target; i++) {
      const scene = project(story, state, "failure-probe", steps.length);
      assert.equal(scene.input, undefined, "Tail needs reviewed input before continuing");
      const action = scene.actions.find(action => action.id === "stay") ?? scene.actions.find(action => action.id === "accept") ?? scene.actions[0];
      assert.ok(action, "No legal action");
      const draws: Draw[] = [], node = state.nodeId;
      const next = advance(story, state, action.id, (min, max) => { const value = min; draws.push({ min, max, value }); return value; }).state;
      steps.push({ node, action: action.id, input: {}, draws, resultNode: next.nodeId }); state = next;
    }
  } catch (caught) { error = String(caught); }
  results.push({ seed: witness.seed, role: witness.role, initialDraws: witness.initialDraws, targetReached: state.nodeId === target,
    node: state.nodeId, status: state.status, playerHp: state.character.hp, error,
    party: state.party?.members.map(member => ({ id: member.id, status: member.status, hp: member.character.hp, unconscious: member.unconscious })),
    visitedTarget: state.program?.visits[target] ?? 0, steps });
}
assert.ok(results.length, "No legal witness contains the requested prefix");
const output = resolve(process.env.FROST_PROBE_REPORT ?? "work/alone-against-frost/failure-probe.json");
writeFileSync(output, JSON.stringify({ storyId: story.id, version: story.version, sourcePdfSha256: story.source?.sha256,
  manifestSha256: createHash("sha256").update(manifest).digest("hex"), runtimeSha256: runtimeFingerprint(), prefixNode, target, results }, null, 2) + "\n");
console.log(JSON.stringify(results.map(({ steps, initialDraws, ...result }: any) => result), null, 2));
