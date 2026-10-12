import type { DatabaseSync } from "node:sqlite";
import type {
  Story,
  StoryNode,
  HistoryFrame,
} from "../../../../packages/contracts/index.js";
import {
  endingAchievementId,
  type Achievement,
} from "../../../../packages/contracts/achievements.js";

function endingLabel(node: StoryNode) {
  return (
    node.ending ?? node.program?.find((step) => step.kind === "end")?.label
  );
}

// The committed terminal history is the source of truth. This also recognises
// endings reached before achievements existed without a second unlock ledger.
export function readAchievements(
  db: DatabaseSync,
  owner: string,
  stories: Map<string, Story>,
): Achievement[] {
  const catalog = new Map<string, Achievement>();
  const versions = [...stories.values()].sort((a, b) =>
    a.version.localeCompare(b.version, undefined, { numeric: true }),
  );
  const latest = new Map<string, Story>();
  for (const story of versions) latest.set(story.id, story);
  for (const story of latest.values()) {
    for (const node of story.nodes) {
      if (!endingLabel(node)) continue;
      const id = endingAchievementId(story.id, node.id);
      catalog.set(id, {
        id,
        storyId: story.id,
        storyTitle: story.title,
        endingId: node.id,
        title: "未知结局成就",
        description: "抵达这个结局后解锁。",
      });
    }
  }
  const rows = db
    .prepare(
      `
    SELECT h.frame, h.run_id, r.story_id, r.story_version
    FROM run_history h JOIN runs r ON r.id = h.run_id
    WHERE r.user_id = ? AND json_extract(h.frame, '$.scene.status') = 'ended'
    ORDER BY json_extract(h.frame, '$.createdAt'), h.rowid
  `,
    )
    .all(owner);
  for (const row of rows) {
    const frame = JSON.parse(row.frame as string) as HistoryFrame;
    const story = stories.get(`${row.story_id}@${row.story_version}`);
    if (!story) continue;
    const node = frame.scene.collection?.endingId
      ? story.nodes.find((node) => node.id === frame.scene.collection!.endingId)
      : story.nodes.find(
          (node) =>
            node.title === frame.scene.title &&
            node.chapter === frame.scene.chapter &&
            endingLabel(node),
        );
    if (!node || !endingLabel(node)) continue;
    const id = endingAchievementId(story.id, node.id);
    let achievement = catalog.get(id);
    if (!achievement) {
      // Preserve earned retired endings, without adding unreachable targets for
      // players who have only played the current content version.
      achievement = {
        id,
        storyId: story.id,
        storyTitle: latest.get(story.id)?.title ?? story.title,
        endingId: node.id,
        title: "",
        description: "",
      };
      catalog.set(id, achievement);
    }
    if (achievement.unlockedAt) continue;
    const currentNode = latest
      .get(story.id)
      ?.nodes.find((current) => current.id === node.id);
    achievement.title =
      (currentNode && endingLabel(currentNode)) || endingLabel(node)!;
    achievement.description = `在《${story.title}》中抵达「${achievement.title}」。`;
    achievement.unlockedAt = frame.createdAt;
    achievement.runId = row.run_id as string;
  }
  return [...catalog.values()];
}
