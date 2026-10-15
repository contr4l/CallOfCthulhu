import type { Story } from "../../../../packages/contracts/index.js";
import { endingAchievementId } from "../../../../packages/contracts/achievements.js";

// Application display numbers, not the book's paragraph numbers. Append new
// endings; never renumber or reuse a number, including retired endings.
export const endingNumbers: Record<string, Record<string, number>> = {
  "alone-against-flames": {
    "77": 1,
    "80": 2,
    "92": 3,
    "123": 4,
    "171": 5,
    "193": 6,
    "196": 7,
    "220": 8,
    "231": 9,
    "243": 10,
    "255": 11,
    "270": 12,
    "fire-death": 13,
    "185-end": 14,
    "223-end": 15,
    "247-end": 16,
    survived: 17,
  },
  "alone-against-static": {
    "134": 1,
    "150": 2,
    "171": 3,
    "278": 4,
    "284": 5,
    "316": 6,
    "318": 7,
    "324": 8,
    "334": 9,
    "354": 10,
    "356": 11,
    "359": 12,
    "365": 13,
    "367": 14,
  },
  "alone-against-tide": {
    "51-death": 1,
    "68-death": 2,
    "69": 3,
    "82": 4,
    "84": 5,
    "95": 6,
    "113": 7,
    "116": 8,
    "117": 9,
    "119-death": 10,
    "121-death": 11,
    "125-death": 12,
    "132-death": 13,
    "137": 14,
    "140-death": 15,
    "141-death": 16,
    "142-death": 17,
    "145-death": 18,
    "150": 19,
    "152": 20,
    "169-death": 21,
    "176": 22,
    "180": 23,
    "182": 24,
    "184": 25,
    "190": 26,
    "192": 27,
    "193": 28,
    "197": 29,
    "198": 30,
    "199": 31,
    "206": 32,
    "208": 33,
    "209": 34,
    "213": 35,
    "217": 36,
    "220": 37,
    "221": 38,
    "225": 39,
    "226": 40,
    "227": 41,
    "231": 42,
    "232": 43,
    "233": 44,
    "234": 45,
    "236": 46,
    "239": 47,
    "241": 48,
    "242": 49,
    "243": 50,
  },
  "alone-against-frost": {
    "33": 1,
    "68": 2,
    "169": 3,
    "183": 4,
    "214": 5,
    "258": 6,
    "259": 7,
    "268": 8,
    "272": 9,
    "318": 10,
    "342": 11,
    "345": 12,
    "417": 13,
    "432": 14,
    "441": 15,
    "454": 16,
    "538": 17,
    "548": 18,
    "549": 19,
    "frost-12-drowning-ending": 20,
    "frost-105-permanent": 21,
    "frost-105-temporary": 22,
    "frost-186-loss": 23,
    "frost-189-drowning-ending": 24,
    "frost-191-end": 25,
    "frost-221-injury": 26,
    "frost-285-fail": 27,
    "frost-307-expedition-end": 28,
    "frost-321-damage": 29,
    "frost-337-loss": 30,
    "frost-340-end": 31,
    "frost-363-stampede": 32,
    "frost-368-end": 33,
    "frost-385-drowning-ending": 34,
    "frost-407-smoke-ending": 35,
    "frost-412-drowning-ending": 36,
    "frost-512-drowning-ending": 37,
    "frost-514-drowning-ending": 38,
    "frost-536-drowning-ending": 39,
  },
  "alone-against-fear": {
    "fear-ending-dead": 1,
    "fear-ending-insane": 2,
    "fear-ending-won": 3,
  },
};

export function buildEndingNumbers(stories: Story[]) {
  const numbers = new Map<string, number>();
  const next = new Map<string, number>();
  for (const [storyId, endings] of Object.entries(endingNumbers)) {
    for (const [endingId, number] of Object.entries(endings)) {
      numbers.set(endingAchievementId(storyId, endingId), number);
      next.set(storyId, Math.max(next.get(storyId) ?? 0, number));
    }
  }
  // Compatibility for test fixtures and unregistered old content: allocate by
  // first published version and stable ID, independent of node/list order.
  for (const story of [...stories].sort((a, b) =>
    a.version.localeCompare(b.version, undefined, { numeric: true }),
  )) {
    const endings = story.nodes.filter(
      (node) =>
        node.ending ||
        node.program?.some(
          (step) => step.kind === "end" && step.collect !== false,
        ),
    );
    endings.sort((a, b) =>
      a.id.localeCompare(b.id, undefined, { numeric: true }),
    );
    for (const node of endings) {
      const id = endingAchievementId(story.id, node.id);
      if (numbers.has(id)) continue;
      const number = (next.get(story.id) ?? 0) + 1;
      numbers.set(id, number);
      next.set(story.id, number);
    }
  }
  return numbers;
}
