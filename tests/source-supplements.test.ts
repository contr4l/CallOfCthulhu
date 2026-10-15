import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSourceFragments, type SourceDag } from "../apps/api/src/modules/source-dag.js";

test("rule and table supplements are identity and hash checked, including physical paths", () => {
  const root = mkdtempSync(join(tmpdir(), "coc-sections-"));
  const outside = mkdtempSync(join(tmpdir(), "coc-outside-"));
  const write = (path: string, value: unknown) => {
    const raw = JSON.stringify(value);
    writeFileSync(path, raw);
    return { path: path.slice(root.length + 1), sha256: createHash("sha256").update(raw).digest("hex") };
  };
  try {
    const fragment = write(join(root, "1.json"), { id: "1", document: "source.pdf", paragraphs: [
      { id: "1:p0", kind: "heading", text: "1", sourceLocation: "pdf:visual:[[77,1]]" },
    ] });
    const section = { id: "combat", document: "source.pdf", paragraphs: [
      { id: "combat:p0", kind: "heading", text: "Combat", sourceLocation: "pdf:visual:[[29,1]]" },
      { id: "combat:p1", kind: "body", text: "Roll d6.", sourceLocation: "pdf:visual:[[29,2]]" },
    ] };
    const sectionRef = write(join(root, "combat.json"), section);
    const supplement = (ref = sectionRef, id = "combat") => write(join(root, "supplements.json"), {
      documents: [{ document: "source.pdf", entries: [{
        kind: "pdf-provenance", section: "source-integrity", sourceLocation: "pdf:document",
        metadata: { sections: [{ sectionId: id, kind: "chapter-or-table", fragment: ref }] },
      }] }],
    });
    const graph: SourceDag = {
      format: "coc-story-graph@2", id: "source-fixture", title: "来源", language: "en", entry: "1",
      runtimePlayable: false, source: { filename: "source.pdf", sha256: "a".repeat(64), size: 1 },
      supplements: supplement(), nodes: [{ id: "1", fragment, terminal: false }], edges: [], issues: [],
    };
    const graphPath = join(root, "graph.json");
    assert.deepEqual(validateSourceFragments(graphPath, graph), {
      nodes: 1, edges: 0, originalParagraphs: 3, fragmentFiles: 3,
    });
    writeFileSync(join(root, "combat.json"), JSON.stringify({ ...section, document: "changed.pdf" }));
    assert.throws(() => validateSourceFragments(graphPath, graph), /integrity mismatch/);
    const wrongIdentity = write(join(root, "combat.json"), { ...section, id: "other-table" });
    graph.supplements = supplement(wrongIdentity);
    assert.throws(() => validateSourceFragments(graphPath, graph), /identity mismatch/);
    const outsidePath = join(outside, "external.json");
    const externalRaw = JSON.stringify(section);
    writeFileSync(outsidePath, externalRaw);
    symlinkSync(outsidePath, join(root, "linked.json"));
    graph.supplements = supplement({ path: "linked.json", sha256: createHash("sha256").update(externalRaw).digest("hex") });
    assert.throws(() => validateSourceFragments(graphPath, graph), /symlink escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
