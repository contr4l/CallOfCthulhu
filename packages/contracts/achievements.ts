export type Achievement = {
  id: string;
  storyId: string;
  storyTitle: string;
  endingId: string;
  title: string;
  description: string;
  unlockedAt?: string;
  runId?: string;
};

export function endingAchievementId(storyId: string, endingId: string) {
  return `ending:${encodeURIComponent(storyId)}:${encodeURIComponent(endingId)}`;
}
