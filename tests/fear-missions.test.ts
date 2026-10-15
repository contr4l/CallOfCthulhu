import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const plan = JSON.parse(readFileSync(`${root}/work/alone-against-fear/missions-reviewed.json`, "utf8"));
const sha = (path: string) => createHash("sha256").update(readFileSync(`${root}/scripts/${path}`)).digest("hex");

test("all six Fear mission normalizations bind the two printed mission-table fragments and translations", () => {
  assert.equal(plan.format, "fear-reviewed-missions@1");
  assert.equal(plan.sourcePdfSha256, "6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572");
  assert.deepEqual(plan.missions.map((mission: { id: string }) => mission.id), ["1", "2", "3", "4", "5", "6"]);
  for (const source of plan.source) {
    assert.equal(sha(source.sourceFragment), source.sourceSha256, `${source.sectionId} source SHA`);
    assert.equal(sha(source.translationFragment), source.translationSha256, `${source.sectionId} translation SHA`);
    const original = JSON.parse(readFileSync(`${root}/scripts/${source.sourceFragment}`, "utf8"));
    const translated = JSON.parse(readFileSync(`${root}/scripts/${source.translationFragment}`, "utf8"));
    assert.deepEqual(source.sourceParagraphIds, original.paragraphs.map((p: { id: string }) => p.id));
    assert.deepEqual(source.translationParagraphIds, translated.paragraphs.map((p: { id: string }) => p.id));
  }
  assert.equal(plan.reviewStatus, "mechanical-review-in-progress");
  assert.ok(plan.runtimeGaps.length >= 6, "do not advertise missions as executable before their mechanics are implemented");
});
