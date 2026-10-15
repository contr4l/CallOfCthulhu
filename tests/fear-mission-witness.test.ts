import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFragmentStory } from "../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import type { SceneView } from "../packages/contracts/index.js";
import { runtimeFingerprint } from "../tools/story/runtime-fingerprint.js";

const packageDir = resolve("stories/alone-against-fear/1.0.2");
const manifestPath = resolve(packageDir, "story.json");
const reportPath = resolve("work/alone-against-fear/tier-mission-witnesses-1.0.2.json");

test("saved Fear mission witnesses replay using only legal public actions and their recorded dice", () => {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  const manifest = readFileSync(manifestPath);
  assert.deepEqual(report.coveredMissionIds, ["1", "2", "3", "4", "5", "6"], "all six source missions need complete entry-to-completion witnesses");
  assert.deepEqual(report.missingMissionIds, []);
  assert.deepEqual(report.failures, []);
  assert.equal(report.manifestSha256, createHash("sha256").update(manifest).digest("hex"));
  assert.equal(report.runtimeSha256, runtimeFingerprint());
  const story = loadFragmentStory(manifestPath, input => runtimeGraphSchema.parse(input), validateStory);
  validateStory(story);
  assert.deepEqual(report.sourcePdfSha256, story.fear?.source.pdfSha256);
  for (const route of report.routes as Array<{ missionId: string; initialDraws: Array<{ min: number; max: number; value: number }>; steps: Array<{ action: string; draws: Array<{ min: number; max: number; value: number }>; label: string }>; completion: { missionFinished: boolean; completedMissions: string[] } }>) {
    let planned = route.initialDraws.map(draw => draw.value), observed: Array<{ min: number; max: number; value: number }> = [];
    const dice = (min: number, max: number) => {
      const value = planned.shift();
      assert.notEqual(value, undefined, `mission ${route.missionId}: unrecorded initial draw ${min}..${max - 1}`);
      assert.ok(value! >= min && value! < max, `mission ${route.missionId}: invalid recorded face ${value} for ${min}..${max - 1}`);
      observed.push({ min, max, value: value! }); return value!;
    };
    let state = initialState(story, createCharacter("恐惧任务路线验证", story.presets[0], 0), dice);
    assert.deepEqual(planned, [], `mission ${route.missionId}: unused initial draws`);
    assert.deepEqual(observed, route.initialDraws);
    assert.equal(state.fear?.missionId, route.missionId);
    for (const [index, step] of route.steps.entries()) {
      const scene = project(story, state, `fear-mission-replay-${route.missionId}`, index) as SceneView;
      assert.ok(scene.actions.some(action => action.id === step.action), `mission ${route.missionId}: ${step.label} is not a public action at replay step ${index}`);
      planned = step.draws.map(draw => draw.value); observed = [];
      state = advance(story, state, step.action, dice).state;
      assert.deepEqual(planned, [], `mission ${route.missionId}: unused dice for ${step.label}`);
      assert.deepEqual(observed, step.draws, `mission ${route.missionId}: changed draw sequence for ${step.label}`);
    }
    assert.equal(state.fear?.missionFinished, true, `mission ${route.missionId}: replay did not complete the task`);
    assert.ok(state.fear?.completedMissions.includes(route.missionId));
    assert.deepEqual(route.completion.completedMissions, state.fear?.completedMissions);
  }
});
