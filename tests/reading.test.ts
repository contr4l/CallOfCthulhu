import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStories } from "../apps/api/src/catalog.js";
import {
  initialState,
  project,
  withSceneReading,
} from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
const stories = loadStories("stories");
test("Flames exposes both narrative languages for every node without paper instructions or future text", () => {
  for (const version of ["1.0.0", "1.1.0"]) {
    const story = stories.get(`alone-against-flames@${version}`)!;
    for (const node of story.nodes) {
      assert.ok(node.reading?.en, node.id);
      assert.ok(node.reading?.["zh-CN"], node.id);
      assert.ok(
        node.reading.en.text.every(
          (t) =>
            !/go\s+to\s+\d+|on your investigator sheet|mark it on your investigator sheet/i.test(
              t,
            ),
        ),
        node.id,
      );
    }
    const state = initialState(
      story,
      createCharacter("语言验收", story.presets[0], 15),
      (min) => min,
    );
    const before = JSON.stringify(state);
    const view = project(story, state, "test", 0);
    assert.match(view.reading!.en!.text[0], /^The sun is high/);
    assert.match(view.reading!["zh-CN"]!.text[0], /太阳/);
    assert.equal(view.reading!.en!.title, "Alone Against the Flames");
    assert.ok(!JSON.stringify(view.reading).includes("The coach putters"));
    assert.equal(JSON.stringify(state), before);
  }
  assert.ok(
    stories
      .get("alone-against-static@1.0.0")!
      .nodes.every((n) => !n.reading?.en),
  );
});
test("legacy history gains only its own translated paragraph and preserves original saved values", () => {
  const story = stories.get("alone-against-flames@1.1.0")!;
  const state = initialState(
    story,
    createCharacter("旧回忆", story.presets[0], 15),
    (min) => min,
  );
  const scene = project(story, state, "test", 0);
  const { reading: _reading, ...legacy } = scene;
  const before = JSON.stringify(legacy);
  assert.deepEqual(withSceneReading(story, legacy), scene);
  assert.equal(JSON.stringify(legacy), before);
});
test("a mismatched language sidecar cannot attach to another story or node graph", () => {
  const root = mkdtempSync(join(tmpdir(), "coc-reading-"));
  const folder = join(root, "alone-against-flames", "1.1.0");
  mkdirSync(folder, { recursive: true });
  try {
    writeFileSync(
      join(folder, "story.json"),
      readFileSync("stories/alone-against-flames/1.1.0/story.json"),
    );
    const reading = JSON.parse(
      readFileSync("stories/alone-against-flames/1.1.0/reading.json", "utf8"),
    );
    reading.storyId = "alone-against-static";
    writeFileSync(join(folder, "reading.json"), JSON.stringify(reading));
    assert.throws(() => loadStories(root), /语言包/);
    reading.storyId = "alone-against-flames";
    delete reading.nodes["1"];
    writeFileSync(join(folder, "reading.json"), JSON.stringify(reading));
    assert.throws(() => loadStories(root), /语言包/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
