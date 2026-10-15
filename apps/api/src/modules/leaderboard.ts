import type { DatabaseSync } from "node:sqlite";
import type { Story } from "../../../../packages/contracts/index.js";
import { endingAchievementId } from "../../../../packages/contracts/achievements.js";
import { endingReward } from "../../../../packages/contracts/shop.js";
import type {
  Leaderboard,
  LeaderboardEntry,
  LeaderboardSort,
} from "../../../../packages/community/leaderboard.js";
import { confirmedEndings } from "./confirmed-endings.js";

export function readLeaderboard(
  db: DatabaseSync,
  owner: string,
  stories: Map<string, Story>,
  query: { sort: LeaderboardSort; page: number; limit: number },
): Leaderboard {
  // Aggregate all owners in bounded query count, rather than scanning history once per user.
  const users = new Map(
    db
      .prepare(
        `SELECT u.id,u.username,COUNT(r.id) AS started_runs
    FROM users u LEFT JOIN runs r ON r.user_id=u.id GROUP BY u.id`,
      )
      .all()
      .map((row) => [
        String(row.id),
        {
          entry: {
            rank: 0,
            username: String(row.username),
            isCurrentUser: row.id === owner,
            collectedEndings: 0,
            completedStories: 0,
            completedRuns: 0,
            startedRuns: Number(row.started_runs),
            earnedPoints: 0,
          } as LeaderboardEntry,
          endings: new Set<string>(),
          stories: new Set<string>(),
          runs: new Set<string>(),
        },
      ]),
  );
  const claims = new Map(
    db
      .prepare("SELECT user_id,achievement_id,points FROM achievement_claims")
      .all()
      .map((row) => [
        JSON.stringify([row.user_id, row.achievement_id]),
        Number(row.points),
      ]),
  );
  for (const ending of confirmedEndings(db, stories)) {
    const user = users.get(ending.owner);
    if (!user) continue;
    const id = endingAchievementId(ending.story.id, ending.node.id);
    if (!user.endings.has(id)) {
      user.endings.add(id);
      user.entry.earnedPoints +=
        claims.get(JSON.stringify([ending.owner, id])) ??
        endingReward(ending.story.id, ending.node.id);
    }
    user.stories.add(ending.story.id);
    user.runs.add(ending.runId);
  }
  const entries = [...users.values()].map(
    ({ entry, endings, stories, runs }) => ({
      ...entry,
      collectedEndings: endings.size,
      completedStories: stories.size,
      completedRuns: runs.size,
    }),
  );
  const metric = {
    endings: "collectedEndings",
    stories: "completedStories",
    runs: "completedRuns",
    points: "earnedPoints",
  } as const;
  const field = metric[query.sort];
  entries.sort(
    (a, b) =>
      b[field] - a[field] ||
      (a.username < b.username ? -1 : a.username > b.username ? 1 : 0),
  );
  let score: number | undefined,
    rank = 0;
  entries.forEach((entry, index) => {
    if (entry[field] !== score) {
      score = entry[field];
      rank = index + 1;
    }
    entry.rank = rank;
  });
  const totalPages = Math.max(1, Math.ceil(entries.length / query.limit));
  const page = Math.min(query.page, totalPages);
  return {
    sort: query.sort,
    page,
    limit: query.limit,
    totalPages,
    summary: {
      registeredUsers: entries.length,
      startedUsers: entries.filter((entry) => entry.startedRuns > 0).length,
      completedRuns: entries.reduce(
        (sum, entry) => sum + entry.completedRuns,
        0,
      ),
      collectedEndings: entries.reduce(
        (sum, entry) => sum + entry.collectedEndings,
        0,
      ),
    },
    entries: entries.slice((page - 1) * query.limit, page * query.limit),
    currentUser: entries.find((entry) => entry.isCurrentUser) ?? null,
  };
}
