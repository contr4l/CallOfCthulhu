/** Replay saved stopped routes to inspect source-caused party states; no state injection. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
type Draw = { min: number; max: number; value: number };
type Step = { node: string; action: string; input: Record<string, string | number>; draws: Draw[]; resultNode: string };
const candidate = resolve(process.env.FROST_CANDIDATE ?? "work/alone-against-frost/preview/alone-against-frost/1.0.48-candidate");
const bytes = readFileSync(resolve(candidate, "story.json"));
const story = loadFragmentStory(resolve(candidate, "story.json"), value => runtimeGraphSchema.parse(value), validateStory);
type RecordedRoute = { seed: number; role: number; node: string; initialDraws?: Draw[]; steps: Step[] };
const report = JSON.parse(readFileSync(resolve(process.env.FROST_ROUTES ?? "work/alone-against-frost/routes-048.json"), "utf8")) as { manifestSha256: string; stopped: RecordedRoute[]; errors?: RecordedRoute[] };
assert.equal(createHash("sha256").update(bytes).digest("hex"), report.manifestSha256);
const observations: unknown[] = [];
const wanted = new Set((process.env.FROST_INSPECT_NODES ?? "425,456").split(","));
for (const witness of [...report.stopped, ...report.errors ?? []].filter(route => wanted.has(route.node))) {
  let queue = witness.initialDraws?.slice() ?? [];
  const dice = (min: number, max: number) => { const draw = queue.shift(); assert.ok(draw, "Unrecorded draw"); assert.deepEqual([min, max], [draw.min, draw.max]); return draw.value; };
  let state = initialState(story, createCharacter("冰霜完整路线", story.presets[witness.role], 0), dice);
  assert.equal(queue.length, 0);
  const trace: unknown[] = [];
  for (const [index, step] of witness.steps.entries()) {
    assert.equal(state.nodeId, step.node); assert.ok(project(story, state, "audit", index).actions.some(action => action.id === step.action));
    queue = step.draws.slice(); state = advance(story, state, step.action, dice, step.input).state;
    assert.equal(queue.length, 0); assert.equal(state.nodeId, step.resultNode);
    if (["513", "425", "456", ...wanted].includes(state.nodeId)) trace.push({ step: index, node: state.nodeId,
      party: state.party?.members.map(member => ({ id: member.id, status: member.status, hp: member.character.hp, unconscious: member.unconscious })),
      playerHp: state.character.hp, visits: state.program?.visits });
  }
  observations.push({ seed: witness.seed, role: witness.role, sourceRoute: witness.steps.map(step => step.node), trace,
    final: { node: state.nodeId, cursor: state.program?.cursor, returns: state.program?.returns,
      pending: state.program?.pending, frostCombat: state.program?.frostCombat,
      party: state.party?.members.map(member => ({ id: member.id, status: member.status, hp: member.character.hp, unconscious: member.unconscious })),
      playerHp: state.character.hp, log: state.program?.log.slice(-12) } });
}
const output = resolve(process.env.FROST_INSPECTION ?? "work/alone-against-frost/roster-route-inspection.json");
writeFileSync(output, JSON.stringify({ manifestSha256: report.manifestSha256, observations }, null, 2) + "\n");
console.log(JSON.stringify(observations, null, 2));
