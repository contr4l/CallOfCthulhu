import type { FearDice, FearOperation, FearState, FearStory, FearTableEntry } from "../contracts/fear.js";

/** Minimal, source-shaped effects for table rules that do not fit the existing recipe operators. */
export type FearTableStateEffect =
  | { type: "hardware-store-search"; items: Array<{ itemId: string; chance: [number, 6]; ammo?: "D6" }>; encounterChance: [2, 6]; encounterTable: "store-hardware-encounter"; trigger: "first-pickup" }
  | { type: "after-bookstore-search-encounter"; chance: [3, 6]; tableId: "store-book-encounter" }
  | { type: "per-eligible-weapon-search"; chance: [1, 6]; weaponIds: string[]; ammoWeaponIds: string[]; ammo: "2D6" }
  | { type: "clown-mask-wear"; itemId: "walrus-clown-mask"; keyword: "CLOWNFACE"; charismaPenalty: -1 }
  | { type: "sewer-rat-rules"; fireItems: string[]; poisonItem: string; poisonFood: 1; poisonDamage: 2; naturalOneInfectionSave: 5; infectionDamagePerBox: 1; cure: "safehouse-or-first-aid" }
  | { type: "clownface-encounter"; keyword: "CLOWNFACE"; charismaLevel: 4; ignoreModifiers: ["clown-mask", "facial-scar"]; escapeLevel: 4; escapeSkill: "slippery"; hitIgnoreChance: [2, 6]; bypassTag: "magic" }
  | { type: "clinic-zombie-horde"; enemyId: "zombie"; count: "3D6"; mayIgnore: true; firstAidKits: 1; painkillerDoses: "D6" }
  | { type: "worship-zombie-siege"; enemyId: "zombie"; count: "2D6"; mayIgnore: true; rewardChoices: ["sanity", "random-objects", "useful-stuff"] }
  | { type: "farm-zombie-siege"; enemyId: "zombie"; count: "2D6"; rewardChoices: ["D6-food", "D6-shotgun-shells"] }
  | { type: "source-terminal"; outcome: "train-ghost" }
  | { type: "counted-entry-fallback"; key: string; maximumPlays: 2; fallbackTable: string }
  | { type: "per-corpse-loop"; count: "D6"; fearLevel: 4; fearSkill: "will"; lootChance: [1, 6]; lootTables: [string, string] }
  | { type: "after-combat-search"; enemyId: string; successTable: string }
  | { type: "search-on-missing-item"; itemId: string; successReward: "clue" }
  | { type: "librarian-encounter"; chance: [3, 6]; books: "D3"; tradeFoodPerBook: 2; spellSave: 5; spellSanityLoss: 2; knifeDamage: 1; escapeCastsSpell: true }
  | { type: "witch-knot-cord"; cordItem: "cord"; triggerWhenBookFound: "occult-guide"; eventId: "36" }
  | { type: "books-choice-and-buffed-encounter"; books: 2; choice: "one-or-both"; duplicateReroll: true; enemyTable: string; levelBonusIfBoth: 1 }
  | { type: "persistent-location"; key: string; rerollIfAlreadyFound: true }
  | { type: "puppet-theatre-restrictions"; jokeBookItem: string; grenadeAllowed: false; molotovSelfDamage: 1 };

export type FearTableRulePlan = {
  /** Recipe operations to run at the current source-defined table moment. */
  operations: FearOperation[];
  /** Typed follow-up rules for hooks such as combat hit, pickup, search or retreat. */
  effects: FearTableStateEffect[];
  /** True when legacy recipe operations would duplicate or contradict the printed rule. */
  replaceOperations?: boolean;
};

/**
 * Resolve source-specific mechanics for the audited recipe gaps.
 * This is a pure planner: it neither mutates story/state nor rolls dice. Call
 * before ordinary entry.operations; the runtime must consume returned effects
 * at their typed source hooks. An effect without a consumer is not executable.
 */
export function resolveFearTableRule(
  story: FearStory,
  state: FearState,
  tableId: string,
  entry: FearTableEntry,
  _dice: FearDice,
): FearTableRulePlan {
  const effects: FearTableStateEffect[] = [];
  let operations = entry.operations ?? [];
  let replaceOperations = false;
  if (tableId === "store" && entry.result === "armory") {
    const excluded = new Set(["unarmed", "antique-flail", "scythe-shovel", "chainsaw"]);
    const weapons = story.fear.weapons;
    effects.push({ type: "per-eligible-weapon-search", chance: [1, 6], weaponIds: Object.keys(weapons).filter(id => !excluded.has(id)),
      ammoWeaponIds: Object.keys(weapons).filter(id => !excluded.has(id) && !!weapons[id].ammoType), ammo: "2D6" });
  }
  if (tableId === "store" && entry.result === "bookstore") effects.push({ type: "after-bookstore-search-encounter", chance: [3, 6], tableId: "store-book-encounter" });
  if (tableId === "store" && entry.result === "hardware-store") {
    operations = []; replaceOperations = true;
    effects.push({ type: "hardware-store-search", items: [
      { itemId: "hammer", chance: [3, 6] },
      { itemId: "shotgun", chance: [4, 6], ammo: "D6" },
      { itemId: "knife", chance: [5, 6] },
      { itemId: "insecticide", chance: [1, 6] },
      { itemId: "axe", chance: [3, 6] },
    ], encounterChance: [2, 6], encounterTable: "store-hardware-encounter", trigger: "first-pickup" });
  }
  if (tableId === "sewers" && entry.result === "giant-rat-thing") {
    effects.push({ type: "sewer-rat-rules", fireItems: ["torch", "lighter", "molotov-cocktail"], poisonItem: "rat-poison", poisonFood: 1, poisonDamage: 2, naturalOneInfectionSave: 5, infectionDamagePerBox: 1, cure: "safehouse-or-first-aid" });
  }
  if (tableId === "railways" && entry.result === "demonic-clown") {
    operations = []; replaceOperations = true;
    effects.push({ type: "clownface-encounter", keyword: "CLOWNFACE", charismaLevel: 4, ignoreModifiers: ["clown-mask", "facial-scar"], escapeLevel: 4, escapeSkill: "slippery", hitIgnoreChance: [2, 6], bypassTag: "magic" });
  }
  if (tableId === "children-stuff" && entry.result === "clown-mask") {
    operations = []; replaceOperations = true;
    effects.push({ type: "clown-mask-wear", itemId: "walrus-clown-mask", keyword: "CLOWNFACE", charismaPenalty: -1 });
  }
  if (tableId === "railways" && entry.result === "train-steward") effects.push({ type: "source-terminal", outcome: "train-ghost" });
  if (tableId === "woods-park" && entry.result === "werewolf") {
    effects.push({ type: "counted-entry-fallback", key: "fear-table:woods-park:werewolf:plays", maximumPlays: 2, fallbackTable: "beasts" });
  }
  if (tableId === "clinic" && entry.result === "zombie-horde-3d6-l3") {
    operations = []; replaceOperations = true;
    effects.push({ type: "clinic-zombie-horde", enemyId: "zombie", count: "3D6", mayIgnore: true, firstAidKits: 1, painkillerDoses: "D6" });
  }
  if (tableId === "worship" && entry.result === "zombie-siege-2d6-l3") {
    operations = []; replaceOperations = true;
    effects.push({ type: "worship-zombie-siege", enemyId: "zombie", count: "2D6", mayIgnore: true, rewardChoices: ["sanity", "random-objects", "useful-stuff"] });
  }
  if (tableId === "farm" && entry.result === "zombie-siege-2d6-l3") {
    operations = []; replaceOperations = true;
    effects.push({ type: "farm-zombie-siege", enemyId: "zombie", count: "2D6", rewardChoices: ["D6-food", "D6-shotgun-shells"] });
  }
  if (tableId === "woods-park" && entry.result === "hangmans-tree") { operations = []; replaceOperations = true; effects.push({ type: "per-corpse-loop", count: "D6", fearLevel: 4, fearSkill: "will", lootChance: [1, 6], lootTables: ["random-objects", "useful-stuff"] }); }
  if (tableId === "school" && entry.result === "school-library") effects.push({ type: "after-combat-search", enemyId: "zombie-child", successTable: "children-stuff" });
  if (tableId === "school" && entry.result === "art-school") effects.push({ type: "search-on-missing-item", itemId: "sketchbook", successReward: "clue" });
  if (tableId === "school" && entry.result === "library") { operations = []; replaceOperations = true; effects.push({ type: "librarian-encounter", chance: [3, 6], books: "D3", tradeFoodPerBook: 2, spellSave: 5, spellSanityLoss: 2, knifeDamage: 1, escapeCastsSpell: true }); }
  if (tableId === "children-stuff" && entry.result === "knotted-cord") effects.push({ type: "witch-knot-cord", cordItem: "cord", triggerWhenBookFound: "occult-guide", eventId: "36" });
  if (tableId === "haunted-house" && entry.result === "occult-library") { operations = []; replaceOperations = true; effects.push({ type: "books-choice-and-buffed-encounter", books: 2, choice: "one-or-both", duplicateReroll: true, enemyTable: "demonic-horrors", levelBonusIfBoth: 1 }); }
  if (tableId === "haunted-house" && entry.result === "rosen-house") effects.push({ type: "persistent-location", key: "fear-table:rosen-house:box-id", rerollIfAlreadyFound: true });
  if (tableId === "haunted-house" && entry.result === "haunted-puppet-theatre") effects.push({ type: "puppet-theatre-restrictions", jokeBookItem: "joke-book", grenadeAllowed: false, molotovSelfDamage: 1 });

  // Preserve recipes outside this audited set; callers should only consume a plan
  // when effects are present, otherwise use the reviewed entry unchanged.
  if (!effects.length) return { operations, effects, replaceOperations };
  void story; void state;
  return { operations, effects, replaceOperations };
}

/** Source-shaped reusable helpers for hit, roll and encounter hooks. */
export function fearNaturalOneSucceeds(face: number, modifier: number, level: number): boolean {
  return face === 6 || (face !== 1 && face + modifier >= level);
}
export function fearClownBounce(face: number, weaponTags: string[]): boolean {
  return !weaponTags.includes("magic") && face >= 1 && face <= 2;
}
export function fearStorePickupEncounterPending(foundAnyItem: boolean, roll: number): boolean {
  return foundAnyItem && Number.isInteger(roll) && roll >= 1 && roll <= 2;
}
export function fearEntryReroutesToBeasts(previousPlays: number): boolean {
  return previousPlays >= 2;
}
