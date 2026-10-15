import { confirmedEndings, endingLabel } from "./confirmed-endings.js";
import { buildEndingNumbers } from "./ending-numbers.js";
import { endingReward } from "../../../../packages/contracts/shop.js";
import type { DatabaseSync } from "node:sqlite";
import type { Story } from "../../../../packages/contracts/index.js";
import {
  endingAchievementId,
  type Achievement,
} from "../../../../packages/contracts/achievements.js";

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
  const numbers = buildEndingNumbers(versions);
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
        endingNumber: numbers.get(id)!,
        title: "未知结局成就",
        description: "抵达这个结局后解锁。",
      });
    }
  }
  for (const { frame, story, node, runId } of confirmedEndings(
    db,
    stories,
    owner,
  )) {
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
        endingNumber: numbers.get(id)!,
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
    achievement.runId = runId;
    achievement.rewardPoints = endingReward(story.id, node.id);
    const claim = db
      .prepare(
        "SELECT points,claimed_at FROM achievement_claims WHERE user_id=? AND achievement_id=?",
      )
      .get(owner, id);
    if (claim) {
      achievement.claimedAt = claim.claimed_at as string;
      achievement.rewardPoints = Number(claim.points);
    }
  }
  return [...catalog.values()];
}
