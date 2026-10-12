import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  runtimeGraphSchema,
  validateStory,
  publicStory,
} from "../apps/api/src/catalog.js";
import { loadFragmentStory } from "../apps/api/src/modules/story-fragments.js";
import {
  loadSourceDag,
  loadSourceFragment,
  validateSourceFragments,
} from "../apps/api/src/modules/source-dag.js";
import { advance, initialState, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";

const manifest = resolve("stories/alone-against-static/1.1.0/story.json");
const parse = (input: unknown) => runtimeGraphSchema.parse(input);
test("runtime graph contains no prose and reads only visited fragments, with cached default-language references", () => {
  const raw = JSON.parse(readFileSync(manifest, "utf8"));
  assert.equal(raw.format, "coc-runtime-graph@1");
  assert.ok(
    raw.nodes.every((n: object) => !("text" in n) && !("reading" in n)),
  );
  assert.equal(
    new Set(
      raw.nodes.map((n: { fragment: { path: string } }) => n.fragment.path),
    ).size,
    372,
  );
  assert.throws(() =>
    parse({
      ...raw,
      nodes: raw.nodes.map((n: object) => ({ ...n, text: ["不允许重复正文"] })),
    }),
  );
  const reads: string[] = [];
  const story = loadFragmentStory(manifest, parse, validateStory, (path) => {
    reads.push(path);
    return readFileSync(path);
  });
  assert.equal(reads.length, 0);
  assert.ok(!JSON.stringify(publicStory(story)).includes("paragraphs"));
  assert.equal(reads.length, 0);
  const low = (min: number, max: number) => (max === 10 ? 1 : min);
  const state = initialState(
    story,
    createCharacter("片段测试", story.presets[0], 45),
    low,
  );
  const view = project(story, state, "test", 0);
  assert.equal(reads.length, 1);
  assert.deepEqual(view.reading!["zh-CN"]!.text, view.text);
  assert.deepEqual(project(story, state, "test", 0), view);
  assert.equal(reads.length, 1);
  const next = advance(story, state, "next", low).state;
  assert.equal(next.nodeId, "1");
  project(story, next, "test", 1);
  assert.equal(reads.length, 2);
});

test("fragment tampering, identity changes, path traversal and symlink escapes reject", () => {
  const root = mkdtempSync(join(tmpdir(), "coc-fragments-"));
  try {
    const folder = join(root, "package");
    cpSync(dirname(manifest), folder, { recursive: true });
    const file = join(folder, "story.json");
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const ref = raw.nodes[0].fragment;
    const bodyFile = join(folder, ref.path);
    const original = readFileSync(bodyFile);
    writeFileSync(bodyFile, "{}");
    const loaded = loadFragmentStory(file, parse, validateStory);
    assert.throws(() => loaded.nodes[0].text, /校验和/);
    const body = JSON.parse(original.toString());
    body.storyId = "another-story";
    const bytes = Buffer.from(JSON.stringify(body));
    writeFileSync(bodyFile, bytes);
    ref.sha256 = createHash("sha256").update(bytes).digest("hex");
    writeFileSync(file, JSON.stringify(raw));
    assert.throws(
      () => loadFragmentStory(file, parse, validateStory).nodes[0].text,
      /身份/,
    );
    ref.path = "../outside.json";
    writeFileSync(file, JSON.stringify(raw));
    assert.throws(() => loadFragmentStory(file, parse, validateStory), /路径/);
    const outside = join(root, "outside.json");
    writeFileSync(outside, original);
    symlinkSync(outside, join(folder, "escape.json"));
    ref.path = "escape.json";
    writeFileSync(file, JSON.stringify(raw));
    assert.throws(() => loadFragmentStory(file, parse, validateStory), /路径/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Static source fragments reconstruct the entire original TXT, including CRLF, wrappers and role sheets", () => {
  const file = resolve("scripts/静躁独行.dag.json");
  const graph = loadSourceDag(file);
  assert.equal(graph.nodes.length, 372);
  assert.equal(graph.edges.length, 680);
  assert.equal(graph.entry, "0");
  const validated = validateSourceFragments(file);
  assert.equal(validated.fragmentFiles, 373);
  assert.equal(graph.nodes.filter((n) => n.terminal).length, 14);
  const rows = graph.nodes.flatMap(
    (n) => loadSourceFragment(file, n.id, graph).paragraphs,
  );
  const supplement = JSON.parse(
    readFileSync(resolve(dirname(file), graph.supplements.path), "utf8"),
  );
  rows.push(
    ...supplement.documents.flatMap((d: { entries: typeof rows }) => d.entries),
  );
  const pieces = rows
    .map((row) => {
      const [, , start, end] = row.sourceLocation.split(":");
      return { start: Number(start), end: Number(end), text: row.text };
    })
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const piece of pieces) {
    assert.equal(piece.start, cursor);
    assert.equal(Array.from(piece.text).length, piece.end - piece.start);
    cursor = piece.end;
  }
  assert.equal(
    pieces.map((p) => p.text).join(""),
    readFileSync("scripts/静躁独行.txt", "utf8"),
  );
});

test("packing is reproducible, round-trips all rules and text, and refuses to overwrite changed versions", () => {
  const root = mkdtempSync(join(tmpdir(), "coc-pack-"));
  try {
    const story = loadFragmentStory(manifest, parse, validateStory);
    const input = join(root, "reviewed.json");
    const output = join(root, story.id, story.version);
    writeFileSync(input, JSON.stringify(story));
    const pack = () =>
      spawnSync(
        "python3",
        ["tools/story/workflow.py", "pack", input, "--output", output],
        { encoding: "utf8" },
      );
    assert.equal(pack().status, 0);
    const file = join(output, "story.json");
    const first = readFileSync(file, "utf8");
    assert.deepEqual(
      JSON.parse(JSON.stringify(loadFragmentStory(file, parse, validateStory))),
      JSON.parse(JSON.stringify(story)),
    );
    assert.equal(pack().status, 0);
    assert.equal(readFileSync(file, "utf8"), first);
    const modified = JSON.parse(readFileSync(input, "utf8"));
    modified.presets[0].hp++;
    writeFileSync(input, JSON.stringify(modified));
    assert.notEqual(pack().status, 0);
    assert.equal(readFileSync(file, "utf8"), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
