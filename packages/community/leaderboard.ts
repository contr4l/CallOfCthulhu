/** Community API data, independent of the versioned story runtime contracts. */
export const LEADERBOARD_SORTS = [
  "endings",
  "stories",
  "runs",
  "points",
] as const;
export type LeaderboardSort = (typeof LEADERBOARD_SORTS)[number];
export type LeaderboardEntry = {
  rank: number;
  username: string;
  isCurrentUser: boolean;
  collectedEndings: number;
  completedStories: number;
  completedRuns: number;
  startedRuns: number;
  earnedPoints: number;
};
export type Leaderboard = {
  sort: LeaderboardSort;
  page: number;
  limit: number;
  totalPages: number;
  summary: {
    registeredUsers: number;
    startedUsers: number;
    completedRuns: number;
    collectedEndings: number;
  };
  entries: LeaderboardEntry[];
  currentUser: LeaderboardEntry | null;
};
