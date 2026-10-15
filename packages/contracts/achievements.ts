import type { EndingTier } from "./shop.js";
export type Achievement = {
  id: string;
  storyId: string;
  storyTitle: string;
  endingId: string;
  endingNumber: number;
  title: string;
  description: string;
  tier?: EndingTier;
  rewardPoints?: number;
  claimedPoints?: number;
  claimablePoints?: number;
  claimedAt?: string;
  unlockedAt?: string;
  runId?: string;
};

export function endingAchievementId(storyId: string, endingId: string) {
  return `ending:${encodeURIComponent(storyId)}:${encodeURIComponent(endingId)}`;
}
