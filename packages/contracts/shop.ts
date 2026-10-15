import type { SceneView, CheckResult } from "./index.js";
export const SHOP_RULES_VERSION = "web-shop@1";
export type ShopItemId = "reroll" | "target-plus-10";
export const SHOP_ITEMS = [
  {
    id: "reroll" as const,
    title: "重掷券",
    price: 3,
    description: "重掷尚未确认的普通 D100 检定，以新结果为准。",
  },
  {
    id: "target-plus-10" as const,
    title: "命运助力",
    price: 2,
    description: "下一次普通 D100 检定目标值＋10，上限 99，仅对这一次生效。",
  },
];
// Website progression follows this order; the introductory story stays free.
export const STORY_UNLOCKS = [
  {
    storyId: "alone-against-static",
    title: "静躁独行",
    prerequisiteStoryId: "alone-against-flames",
    prerequisiteTitle: "向火独行",
    requiredEndings: 1,
    price: 3,
  },
  {
    storyId: "alone-against-tide",
    title: "潮汐独行",
    prerequisiteStoryId: "alone-against-static",
    prerequisiteTitle: "静躁独行",
    requiredEndings: 1,
    price: 3,
  },
  {
    storyId: "alone-against-frost",
    title: "冰霜独行",
    prerequisiteStoryId: "alone-against-tide",
    prerequisiteTitle: "潮汐独行",
    requiredEndings: 1,
    price: 3,
  },
  {
    storyId: "alone-against-fear",
    title: "恐惧独行",
    prerequisiteStoryId: "alone-against-frost",
    prerequisiteTitle: "冰霜独行",
    requiredEndings: 1,
    price: 3,
  },
] as const;
export const STATIC_UNLOCK = STORY_UNLOCKS[0];
export type StoryUnlockId = (typeof STORY_UNLOCKS)[number]["storyId"];
export type StoryUnlock = (typeof STORY_UNLOCKS)[number] & {
  completedEndings: number;
  unlocked: boolean;
};
export type ShopState = {
  // Retained for existing clients; new clients use the complete catalog.
  storyUnlock: StoryUnlock;
  storyUnlocks: StoryUnlock[];
  balance: number;
  inventory: Record<ShopItemId, number>;
  items: typeof SHOP_ITEMS;
};
export type CheckWindow = {
  before: SceneView;
  scene: SceneView;
  check: CheckResult;
  action: string;
};
// Editorial website achievement grades, never official book difficulty labels.
export const ENDING_TIERS = {
  bronze: { label: "青铜级", points: 1 },
  silver: { label: "白银级", points: 2 },
  gold: { label: "黄金级", points: 3 },
} as const;
export type EndingTier = keyof typeof ENDING_TIERS;
const tiers: Record<string, Record<string, number>> = {
  "alone-against-flames": {
    "185-end": 2,
    "223-end": 2,
    "247-end": 2,
    "255": 3,
    "270": 3,
    "231": 3,
  },
  "alone-against-static": { "365": 2, "367": 2, "134": 3, "356": 3, "359": 3 },
  "alone-against-tide": {
    "116": 2,
    "184": 2,
    "190": 2,
    "206": 2,
    "220": 2,
    "227": 3,
    "239": 3,
  },
  "alone-against-frost": { "33": 2, "272": 2, "549": 2, "183": 3 },
  "alone-against-fear": { "fear-ending-insane": 2, "fear-ending-won": 3 },
};
export function endingReward(storyId: string, endingId: string) {
  return tiers[storyId]?.[endingId] ?? 1;
}
export function endingTier(storyId: string, endingId: string): EndingTier {
  const points = endingReward(storyId, endingId);
  return points === 3 ? "gold" : points === 2 ? "silver" : "bronze";
}
