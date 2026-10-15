/** Audit bounded source-card corrections without claiming full character equivalence. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
const root = resolve("work/alone-against-frost/preview/alone-against-frost");
const load = (version: string) => loadFragmentStory(resolve(root, version, "story.json"), value => runtimeGraphSchema.parse(value), validateStory);
const before = load("1.0.2"), after = load("1.0.5");
const normalized = structuredClone(after);
for (const preset of normalized.presets) {
  assert.equal(preset.skills.creditRating, 64);
  assert.equal(preset.skills.hatchet, 15);
  preset.skills.creditRating = 0; preset.skills.hatchet = 0;
}
const charlie = normalized.party!.members.find(member => member.id === "charlie")!;
assert.equal(charlie.character.skills.hatchet, 50); charlie.character.skills.hatchet = 0;
let weaponChanges = 0;
for (const node of normalized.nodes) for (const step of node.program ?? []) if (step.kind === "partyCombat") {
  for (const weapon of step.combat.weapons) if (weapon.key === "hatchet") {
    assert.equal(weapon.skill, "hatchet"); weapon.skill = "fightingBrawl"; weaponChanges++;
  }
}
for (const key of ["id", "entry", "rulesVersion", "creationPolicy", "healthPolicy", "spendLuck", "presets", "party", "nodes"] as const) assert.deepEqual(normalized[key], before[key], `Unexpected change ${key}`);
const sha = (version: string) => createHash("sha256").update(readFileSync(resolve(root, version, "story.json"))).digest("hex");
writeFileSync(resolve("work/alone-against-frost/character-correction-equivalence.json"), JSON.stringify({ format: "coc-source-character-correction-audit@1", beforeVersion: before.version, afterVersion: after.version, beforeManifestSha256: sha(before.version), afterManifestSha256: sha(after.version), expectedChangesOnly: true, playerCreditRating: { before: 0, after: 64, source: "printed PDF p.111" }, playerHatchet: { before: 0, after: 15, source: "explicit authorized web adaptation" }, charlieHatchet: { before: 0, after: 50, source: "printed Axe 50" }, hatchetWeaponSpecializationsChanged: weaponChanges, sourcePdfUnchanged: before.source?.sha256 === after.source?.sha256, notes: "Actual character/weapon corrections are explicitly listed. Other executable rules and all loaded player prose are equal. This is not final API/browser acceptance." }, null, 2) + "\n");
console.log(JSON.stringify({ expectedChangesOnly: true, weaponChanges }));
