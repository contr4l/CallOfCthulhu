import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, isAbsolute, relative } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import {
  loadSourceDag,
  loadSourceFragment,
  validateSourceFragments,
} from "../apps/api/src/modules/source-dag.js";

const graphPath = resolve("scripts/潮汐独行.dag.json");
const graph = loadSourceDag(graphPath);
const hash = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const supplements = read(resolve("scripts", graph.supplements.path));
const metadata = supplements.documents[0].entries.find(
  (row: { kind: string }) => row.kind === "pdf-provenance",
).metadata;

test("Tide retains all 243 source entries and reconstructs the complete 90-page text layer", () => {
  assert.equal(graph.runtimePlayable, false);
  assert.equal(graph.nodes.length, 243);
  assert.equal(graph.edges.length, 450);
  assert.equal(
    graph.source.sha256,
    hash(readFileSync(resolve("scripts", graph.source.filename))),
  );
  assert.equal(validateSourceFragments(graphPath).fragmentFiles, 244);
  const pieces = new Map<
    number,
    { start: number; end: number; text: string }[]
  >();
  const rows = graph.nodes.flatMap(
    (node) => loadSourceFragment(graphPath, node.id).paragraphs,
  );
  rows.push(
    ...supplements.documents[0].entries.filter(
      (row: { sourceLocation: string }) =>
        row.sourceLocation.startsWith("pdf:spans:"),
    ),
  );
  for (const row of rows) {
    const characters = Array.from(row.text);
    let cursor = 0;
    for (const [page, start, end] of JSON.parse(
      row.sourceLocation.slice("pdf:spans:".length),
    )) {
      const value = characters.slice(cursor, cursor + end - start).join("");
      cursor += end - start;
      const list = pieces.get(page) ?? [];
      list.push({ start, end, text: value });
      pieces.set(page, list);
    }
    assert.equal(cursor, characters.length, row.sourceLocation);
  }
  assert.equal(metadata.pdfPages.length, 90);
  for (const page of metadata.pdfPages) {
    let cursor = 0;
    const text: string[] = [];
    for (const piece of (pieces.get(page.pdfPage) ?? []).sort(
      (a, b) => a.start - b.start,
    )) {
      assert.equal(
        piece.start,
        cursor,
        `gap/overlap on PDF page ${page.pdfPage}`,
      );
      cursor = piece.end;
      text.push(piece.text);
    }
    assert.equal(cursor, page.characters);
    assert.equal(hash(text.join("")), page.textSha256);
  }
});

test("Tide uses visual column order and assigns cross-page consequences to their actual entries", () => {
  assert.deepEqual(
    metadata.pdfPages.flatMap((page: { entryHeadings: { id: string }[] }) =>
      page.entryHeadings.map((entry) => entry.id),
    ),
    Array.from({ length: 243 }, (_, i) => String(i + 1)),
  );
  assert.deepEqual(
    graph.issues
      .filter(
        (issue) =>
          issue.kind === "text-stream-differs-from-column-reading-order",
      )
      .map((issue) => issue.pdfPage),
    [13, 19, 41],
  );
  const entry123 = loadSourceFragment(graphPath, "123")
    .paragraphs.map((p) => p.text)
    .join("");
  const entry125 = loadSourceFragment(graphPath, "125")
    .paragraphs.map((p) => p.text)
    .join("");
  const entry126 = loadSourceFragment(graphPath, "126")
    .paragraphs.map((p) => p.text)
    .join("");
  assert.ok(entry123.includes("Locksmith roll"));
  assert.ok(!entry123.includes("Dodge roll"));
  assert.ok(entry125.includes("Dodge roll") && entry125.includes("1D10+2"));
  assert.ok(entry126.includes("Your gut tells you something is wrong here"));
  assert.ok(
    graph.edges.some((edge) => edge.source === "125" && edge.target === "145"),
  );
  assert.ok(
    !graph.edges.some((edge) => edge.source === "123" && edge.target === "145"),
  );
});

test("Tide image and OCR resources are hash-bound; published Woods cards match the visual review", () => {
  assert.equal(metadata.assets.length, 67);
  assert.deepEqual(
    metadata.ocrPages.map((page: { pdfPage: number }) => page.pdfPage),
    [79, 80, 81, 82, 83, 84, 89],
  );
  for (const ref of [
    ...metadata.assets,
    ...metadata.ocrPages,
    metadata.visualReview,
  ]) {
    const path = resolve("scripts", ref.path);
    const local = relative(resolve("scripts"), path);
    assert.ok(!isAbsolute(local) && !local.startsWith(".."));
    assert.equal(hash(readFileSync(path)), ref.sha256);
  }
  for (const ref of metadata.ocrPages) {
    const page = read(resolve("scripts", ref.path));
    assert.equal(page.sourcePdfSha256, graph.source.sha256);
    assert.equal(page.reviewRequired, true);
    assert.ok(
      page.tokens.every(
        (token: { confidence: number }) =>
          token.confidence >= 0 && token.confidence <= 100,
      ),
    );
  }
  const visual = read(resolve("scripts", metadata.visualReview.path));
  assert.deepEqual(
    visual.cards.map((card: { attributes: unknown }) => card.attributes),
    Array(2).fill({
      STR: 50,
      CON: 60,
      SIZ: 50,
      DEX: 60,
      APP: 40,
      INT: 70,
      POW: 50,
      EDU: 80,
    }),
  );
  assert.ok(
    visual.cards.every((card: { luck: unknown }) => card.luck === null),
  );
  const runtime = read(resolve("stories/alone-against-tide/1.0.1/story.json"));
  assert.equal(runtime.source.sha256, graph.source.sha256);
  const woods = runtime.presets.filter((preset: { templateId?: string }) =>
    preset.templateId?.startsWith("tide-"),
  );
  assert.equal(woods.length, 2);
  for (const [index, preset] of woods.entries()) {
    assert.deepEqual(
      preset.attributes,
      Object.fromEntries(
        Object.entries(visual.cards[index].attributes).map(([key, value]) => [
          key.toLowerCase(),
          value,
        ]),
      ),
    );
    assert.equal(preset.hp, visual.cards[index].hitPoints);
    assert.equal(preset.movement, visual.cards[index].moveRate);
    assert.equal(preset.profile.age, visual.cards[index].age);
    assert.equal(
      preset.skills.dodge,
      visual.cards[index].printedSkillValues.Dodge,
    );
    assert.equal(
      preset.skills.archaeology,
      visual.cards[index].printedSkillValues.Archaeology,
    );
  }
});

test("all Tide translations cover source paragraphs, numbers and dice without a duplicate reading book", () => {
  const root = resolve("scripts/alone-against-tide/translations/zh-CN");
  const manifest = read(resolve(root, "manifest.json"));
  assert.equal(manifest.runtimePlayable, false);
  assert.equal(manifest.status, "model-translated-review-required");
  assert.equal(manifest.sourcePdfSha256, graph.source.sha256);
  assert.equal(manifest.sourceGraphSha256, hash(readFileSync(graphPath)));
  assert.equal(manifest.nodes.length, 243);
  assert.equal(manifest.supplements.length, 41);
  for (const node of [...manifest.nodes, ...manifest.supplements]) {
    const path = resolve(root, node.fragment.path);
    assert.ok(!relative(root, path).startsWith(".."));
    assert.equal(hash(readFileSync(path)), node.fragment.sha256);
  }
  const report = JSON.parse(
    execFileSync(
      "python3",
      ["tools/story/tide_translation.py", "check", graphPath, root],
      { encoding: "utf8" },
    ),
  );
  assert.deepEqual(report.errors, []);
  assert.equal(report.translatedParagraphs, 1611);
  assert.ok(!existsSync(resolve(root, "reading.json")));
});
