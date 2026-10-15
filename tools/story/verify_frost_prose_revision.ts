/** Compare executable rules after an audited player-prose revision. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
const root = resolve("work/alone-against-frost/preview/alone-against-frost");
const load = (version: string) => loadFragmentStory(resolve(root, version, "story.json"), value => runtimeGraphSchema.parse(value), validateStory);
const before = load(process.argv[2] ?? "1.0.0"), after = load(process.argv[3] ?? "1.0.2");
for (const field of ["id", "entry", "rulesVersion", "creationPolicy", "healthPolicy", "spendLuck", "presets", "party"] as const) assert.deepEqual(after[field], before[field], field);
assert.deepEqual(after.nodes.map(node => node.id), before.nodes.map(node => node.id));
const changed: string[] = [];
for (const [index, node] of after.nodes.entries()) {
  const prior = before.nodes[index];
  const { text: _text, reading: _reading, ...rules } = node;
  const { text: _priorText, reading: _priorReading, ...priorRules } = prior;
  assert.deepEqual(rules, priorRules, `Changed executable node ${node.id}`);
  if (JSON.stringify(node.text) !== JSON.stringify(prior.text) || JSON.stringify(node.reading) !== JSON.stringify(prior.reading)) changed.push(node.id);
  for (const paragraph of node.text) assert.ok(!/^[（(]\s*\d[\d,\s\-–—]*[）)]$/.test(paragraph), `Reverse-reference footnote ${node.id}`);
}
assert.ok(after.nodes.find(node => node.id === "frost-514-drowning-ending")?.text.some(text => text.includes("溺水身亡")));
assert.ok(after.nodes.find(node => node.id === "frost-407-smoke-ending")?.text.some(text => text.includes("烟雾")));
const sha = (version: string) => createHash("sha256").update(readFileSync(resolve(root, version, "story.json"))).digest("hex");
writeFileSync(resolve("work/alone-against-frost/prose-revision-equivalence.json"), JSON.stringify({ format: "coc-prose-revision-equivalence@1", beforeVersion: before.version, afterVersion: after.version, beforeManifestSha256: sha(before.version), afterManifestSha256: sha(after.version), executableRulesAndCharactersEqual: true, changedPlayerProseNodes: changed, sourceUnchanged: before.source?.sha256 === after.source?.sha256, notes: "This proves rule/character equivalence, not translation fidelity or final API/browser acceptance." }, null, 2) + "\n");
console.log(JSON.stringify({ executableRulesEqual: true, playerProseNodesChanged: changed.length }));
