import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { loadSourceDag, loadSourceFragment, validateSourceDag, validateSourceFragments } from "../apps/api/src/modules/source-dag.js";

const path = resolve("scripts/CHA23145 - Alone Against the Flames.dag.json");
const graph = loadSourceDag(path);
test("relationship graph separates all source paragraphs into verified fragments", () => {
  assert.equal(graph.nodes.length, 270);
  assert.equal(graph.edges.length, 421);
  assert.equal(graph.source.sha256, createHash("sha256").update(readFileSync(resolve("scripts", graph.source.filename))).digest("hex"));
  assert.deepEqual(validateSourceFragments(path, graph), { nodes: 270, edges: 421, originalParagraphs: 1398, fragmentFiles: 271 });
  assert.equal(loadSourceFragment(path, "270", graph).paragraphs.at(-1)!.text, "The End.");
  assert.ok(readFileSync(path).length < 200_000);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(!("archiveBase64" in raw.source));
  assert.ok(!("dag" in raw));
  assert.ok(raw.nodes.every((n: object) => !("text" in n)));
  assert.ok(raw.edges.every((e: object) => !("instructionText" in e)));
});
test("cycles, broken links and hidden paths retain paragraph references", () => {
  for (const [source, target] of [["16", "25"], ["25", "16"], ["25", "3"], ["6", "16"], ["7", "107"], ["87", "187"], ["112", "212"], ["40", "50"], ["40", "80"], ["40", "90"], ["180", "200"]])
    assert.ok(graph.edges.some(e => e.source === source && e.target === target), `${source} → ${target}`);
  assert.equal(graph.issues.filter(i => i.kind === "broken-or-mismatched-hyperlink").length, 7);
  assert.ok(loadSourceFragment(path, "268", graph).paragraphs.some(p => p.text === "1"));
  assert.ok(!graph.edges.some(e => e.source === "268" && e.target === "20"));
  for (const edge of graph.edges.filter(e => e.condition)) {
    const fragment = loadSourceFragment(path, edge.condition!.discoveryNodeId, graph);
    assert.ok(fragment.paragraphs.find(p => p.id === edge.ruleParagraphId)!.text.includes(`add ${edge.offset} to`));
  }
});
test("backend rejects dangling edges, missing paragraphs, unsafe paths and modified files", () => {
  assert.throws(() => validateSourceDag({ ...graph, nodes: graph.nodes.slice(1) }), /entry|reference/);
  assert.throws(() => validateSourceDag({ ...graph, nodes: [{ ...graph.nodes[0], fragment: { ...graph.nodes[0].fragment, path: "../bad.json" } }, ...graph.nodes.slice(1)] }), /path/);
  assert.throws(() => validateSourceFragments(path, { ...graph, edges: graph.edges.map((e, i) => i === 0 ? { ...e, paragraphId: "1:p999" } : e) }), /missing transition paragraph/);
  const dir = mkdtempSync(join(tmpdir(), "coc-fragment-"));
  try {
    writeFileSync(join(dir, "fragment.json"), JSON.stringify({ id: "1", paragraphs: [] }));
    const modified = { ...graph, nodes: [{ ...graph.nodes[0], fragment: { path: "fragment.json", sha256: graph.nodes[0].fragment.sha256 } }, ...graph.nodes.slice(1)] };
    assert.throws(() => loadSourceFragment(join(dir, "graph.json"), "1", modified), /integrity mismatch/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
