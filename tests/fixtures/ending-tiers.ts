import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leaderboardFixture } from "./leaderboard.js";
import { fixture } from "./shop-story.js";
import { openDatabase } from "../../apps/api/src/storage/database.js";
import {
  initialState,
  project,
  ENGINE_VERSION,
} from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import type { Story } from "../../packages/contracts/index.js";
export const tierExamples = [
  ["alone-against-tide", "69", "116", "239"],
  ["alone-against-frost", "68", "33", "183"],
  [
    "alone-against-fear",
    "fear-ending-dead",
    "fear-ending-insane",
    "fear-ending-won",
  ],
] as const;
export async function endingTierFixture() {
  const t = await leaderboardFixture();
  const db = openDatabase(t.databasePath);
  // Isolated old-format history must have its original readable body as well.
  for (const row of db
    .prepare("SELECT run_id,sequence,frame FROM run_history")
    .all()) {
    const frame = JSON.parse(String(row.frame));
    frame.scene.text = ["测试存档正文。"];
    db.prepare(
      "UPDATE run_history SET frame=? WHERE run_id=? AND sequence=?",
    ).run(JSON.stringify(frame), row.run_id!, row.sequence!);
  }
  const oldDate = "2026-10-01T00:00:00.000Z";
  db.prepare("INSERT INTO shop_wallets VALUES(?,0)").run(t.current.id);
  for (const [storyId, ...endingIds] of [
    ["alone-against-flames", "lost", "223-end", "255"],
    ["alone-against-static", "lost", "365", "356"],
    ...tierExamples,
  ]) {
    const story: Story = {
      ...fixture,
      id: storyId,
      title: storyId,
      nodes: [
        fixture.nodes[0],
        ...endingIds.map((id, index) => ({
          id,
          chapter: "分档测试",
          title: `测试${["青铜", "白银", "黄金"][index]}结局`,
          text: ["独立测试故事。"],
          background: "/art/train.svg",
          type: "ending" as const,
          ending: `测试${["青铜", "白银", "黄金"][index]}结局`,
        })),
      ],
    };
    story.nodes[0] = {
      ...fixture.nodes[0],
      choices: endingIds.map((id, i) => ({
        id: `ending-${i}`,
        label: `测试${i}`,
        target: id,
      })),
    };
    if (["alone-against-flames", "alone-against-static"].includes(storyId)) {
      story.version = "0.0.2";
      story.nodes = [
        ...fixture.nodes,
        ...story.nodes
          .slice(1)
          .filter(
            (node) =>
              !fixture.nodes.some((original) => original.id === node.id),
          ),
      ];
    }
    story.nodes[0] = { ...story.nodes[0], choices: [...(story.nodes[0].choices ?? []), ...endingIds.map(id => ({ id: `grade-${id}`, label: `分档测试${id}`, target: id }))] };
    const path = join(t.root, "stories", storyId, story.version);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "story.json"), JSON.stringify(story));
    for (const [index, endingId] of endingIds.entries()) {
      const runId = `${storyId}-${endingId}`;
      const state = initialState(
        story,
        createCharacter("分档测试", story.presets[0], 30),
      );
      state.nodeId = endingId;
      state.status = "ended";
      db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        runId,
        t.current.id,
        storyId,
        story.version,
        story.rulesVersion,
        ENGINE_VERSION,
        1,
        JSON.stringify(state),
        oldDate,
        oldDate,
      );
      const scene = project(story, state, runId, 1);
      db.prepare("INSERT INTO run_history VALUES(?,?,?)").run(
        runId,
        1,
        JSON.stringify({ sequence: 1, createdAt: oldDate, scene }),
      );
      if (index > 0)
        db.prepare("INSERT INTO achievement_claims VALUES(?,?,?,?)").run(
          t.current.id,
          `ending:${storyId}:${endingId}`,
          ["alone-against-flames", "alone-against-static"].includes(storyId)
            ? index + 1
            : 1,
          oldDate,
        );
    }
  }
  db.close();
  await t.restart();
  return t;
}
