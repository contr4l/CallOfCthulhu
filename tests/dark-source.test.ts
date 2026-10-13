import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const graph = JSON.parse(readFileSync(resolve("scripts/暗黑独行.dag.json"), "utf8"));
const root = resolve("scripts/alone-against-dark");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const hash = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

test("Dark source preserves the original PDF identity and all numbered fragments", () => {
  assert.equal(graph.format, "coc-story-graph@2");
  assert.equal(graph.id, "alone-against-dark");
  assert.equal(graph.runtimePlayable, false);
  assert.equal(graph.nodes.length, 594);
  assert.deepEqual(graph.nodes.map((node: { id: string }) => node.id), Array.from({ length: 594 }, (_, i) => String(i + 1)));
  for (const node of graph.nodes) {
    const path = resolve("scripts", node.fragment.path);
    const bytes = readFileSync(path);
    assert.equal(hash(bytes), node.fragment.sha256, `fragment ${node.id}`);
    assert.equal(read(path).id, node.id);
  }
});

test("Dark source ledger covers all 102 PDF pages and retains page text and OCR evidence", () => {
  const supplements = read(resolve("scripts", graph.supplements.path));
  const document = supplements.documents[0];
  assert.equal(document.pages.length, 102);
  assert.deepEqual(document.pages.map((page: { pdfPage: number }) => page.pdfPage), Array.from({ length: 102 }, (_, i) => i + 1));
  const textPages = document.entries.filter((entry: { kind: string }) => entry.kind === "canonical-text-layer");
  assert.equal(textPages.length, 102);
  assert.deepEqual(readdirSync(resolve(root, "ocr/pages")).filter((name) => name.endsWith(".txt")).sort(), ["049.txt", "050.txt", "076.txt", "088.txt", "092.txt", "093.txt", "100.txt", "101.txt"]);
  assert.equal(supplements.provenance.sourceSha256, graph.source.sha256);
});

test("Dark review ledger records investigator succession and unusual time/location rules", () => {
  const review = read(resolve(root, "review/rules.json"));
  assert.equal(review.entries.length, 594);
  assert.equal(review.globalRules.length, 6);
  assert.deepEqual(review.globalRules[1].rules.slice(0, 4), [
    "Professor Grunewald starts entry 13",
    "Ernest Holt starts entry 36",
    "Lydia Lau starts entry 37",
    "Devon Wilson starts entry 554",
  ]);
  assert.match(review.globalRules[0].sourceText, /1931 Calendar/);
  assert.match(review.globalRules[4].sourceText, /trace number/);
  assert.equal(review.status, "review-ledger-not-runtime-program");
});
