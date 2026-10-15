import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFragmentStory } from "../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../apps/api/src/catalog.js";
import { advance, initialState, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import type { SceneView } from "../packages/contracts/index.js";
import { runtimeFingerprint } from "../tools/story/runtime-fingerprint.js";

test("M4 public Armory routes count identical firearms only when the shared pool supports each copy", () => {
  const manifestPath = resolve("work/alone-against-fear/preview-final/alone-against-fear/1.0.1/story.json");
  const manifest = readFileSync(manifestPath);
  const story = loadFragmentStory(manifestPath, input => runtimeGraphSchema.parse(input), validateStory);
  validateStory(story);
  const missionSource = JSON.parse(readFileSync(resolve("scripts/alone-against-fear/fragments/section-mission-table-continued.json"), "utf8"));
  const armorySource = JSON.parse(readFileSync(resolve("scripts/alone-against-fear/fragments/section-store-table.json"), "utf8"));
  const ammoSource = JSON.parse(readFileSync(resolve("scripts/alone-against-fear/fragments/section-keep-track-of-ammo.json"), "utf8"));
  assert.match(missionSource.paragraphs.find((p: { id: string }) => p.id === "section-mission-table-continued:p1").text, /1 XP per every firearm with at least 6 ammo/);
  assert.match(missionSource.paragraphs.find((p: { id: string }) => p.id === "section-mission-table-continued:p1").text, /maximum gain of 5 XP/);
  assert.match(armorySource.paragraphs.find((p: { id: string }) => p.id === "section-store-table:p3").text, /Roll once per weapon/);
  assert.match(armorySource.paragraphs.find((p: { id: string }) => p.id === "section-store-table:p3").text, /2d6 ammo/);
  assert.match(ammoSource.paragraphs.find((p: { id: string }) => p.id === "section-keep-track-of-ammo:p1").text, /unless the weapons are exactly the\s+same/);
  assert.match(ammoSource.paragraphs.find((p: { id: string }) => p.id === "section-keep-track-of-ammo:p7").text, /differently colored counters/);
  for (const [file, expectedCopies, expectedAmmo, expectedXp] of [
    ["m4-firearm-instance-witness.json", 2, 24, 2],
    ["m4-firearm-instance-threshold-witness.json", 2, 7, 1],
  ] as const) {
    const report = JSON.parse(readFileSync(resolve("work/alone-against-fear", file), "utf8"));
    assert.equal(report.manifestSha256, createHash("sha256").update(manifest).digest("hex"));
    assert.equal(report.runtimeSha256, runtimeFingerprint());
    assert.equal(report.sourcePdfSha256, story.fear?.source.pdfSha256);
    for (const [fragment, expectedSha] of Object.entries(report.sourceFragmentSha256 as Record<string, string>)) {
      assert.equal(createHash("sha256").update(readFileSync(resolve("scripts/alone-against-fear/fragments", fragment))).digest("hex"), expectedSha, `source fragment changed: ${fragment}`);
    }

    let planned = report.initialDraws.map((draw: { value: number }) => draw.value);
    let observed: Array<{ min: number; max: number; value: number }> = [];
    const dice = (min: number, max: number) => {
      const value = planned.shift();
      assert.notEqual(value, undefined, `unrecorded initial die ${min}..${max - 1}`);
      assert.ok(value! >= min && value! < max);
      observed.push({ min, max, value: value! });
      return value!;
    };
    let state = initialState(story, createCharacter("M4重复枪实例路线", story.presets[0], 0), dice);
    assert.deepEqual(planned, []);
    assert.deepEqual(observed, report.initialDraws);
    assert.equal(state.fear?.missionId, "4");
    for (const [index, step] of report.routeSteps.entries()) {
      const scene = project(story, state, "fear-m4-duplicate-replay", index) as SceneView;
      assert.ok(scene.actions.some(action => action.id === step.action), `saved action ${step.label} is unavailable at step ${index}`);
      planned = step.draws.map((draw: { value: number }) => draw.value);
      observed = [];
      state = advance(story, state, step.action, dice).state;
      assert.deepEqual(planned, [], `unused dice at ${step.label}`);
      assert.deepEqual(observed, step.draws, `draw sequence changed at ${step.label}`);
    }
    assert.equal(state.fear?.missionFinished, true);
    assert.deepEqual(state.fear?.completedMissions, ["4"]);
    assert.equal(state.fear?.weaponIds.filter(id => id === "pistol").length, expectedCopies);
    assert.equal(state.fear?.ammo.pistol, expectedAmmo);
    assert.equal(state.fear?.xp, expectedXp);
    assert.equal(report.beforeDelivery.qualifiedFirearmKindsAndCopies, expectedXp);
    assert.equal(report.thresholdCheck.actualQualifiedFirearms, expectedXp);
    assert.equal(report.duplicateAttempt.successfulArmoryChance.value, 1);
    assert.deepEqual(report.duplicateAttempt.foundPistolAmmo2D6, report.caseId === "two-qualified" ? [3, 3] : [2, 2]);
  }
});
