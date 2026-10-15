import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { FearDefinition, FearState } from "../packages/contracts/fear.js";
import {
  applyFearItemSourceAction,
  applyFearItemSourceCheck,
  applyFearItemSourceEncounterEnd,
  applyFearItemSourceDamage,
  applyFearCheapHolySymbolRoll,
  applyFearFlashlightEncounterEnd,
  applyFearStuffedBirdBeforeAttack,
  applyFearItemSourceMove,
  applyFearItemSourceXp,
  consumeFearAlcoholSanityShieldOnLoss,
  fearFlashlightUsable,
  fearItemSourceCoffeeUses,
  fearItemSourceAllowsExorcismBook,
  fearItemSourceSkillLearningCost,
  resolveFearItemSourceWeapon,
  registerFearSourceItemAcquisition,
  fearItemSourceActions,
  fearItemSourceBlocksBooksOrRituals,
  fearItemSourceMagicModifier,
} from "../packages/engine/fear-item-source-rules.js";

const source = (fragment: string, paragraph: string) => {
  const json = JSON.parse(readFileSync(`scripts/alone-against-fear/fragments/${fragment}.json`, "utf8")) as { paragraphs: Array<{ id: string; text: string }> };
  return json.paragraphs.find(value => value.id === paragraph)?.text ?? "";
};

function state(inventory: Record<string, number> = {}, patch: Partial<FearState> = {}): FearState {
  return {
    nodeId: "1", status: "active", mapSheets: [], currentBoxId: "box", startingBoxId: "box", visitCount: 1,
    safehouseIds: [], mapLinks: {}, skipNextAttack: false, skipEncounters: 0, encounterCurse: 0,
    inventory: { ...inventory }, readBooks: [], startingBooksRead: false, ammo: {}, weaponIds: ["knife"], weaponId: "knife",
    hp: 5, maxHp: 6, sanity: 5, maxSanity: 6, food: 0, clues: 0, xp: 0, elapsedTimeBoxes: 0, luck: 0,
    skills: {}, arcaneSkills: {}, scars: [], traumas: [], missionId: "", completedMissions: [], missionFinished: false,
    missionProgress: {}, missionFood: 0, missionFoodTarget: 0, gatesClosed: 0, defeated: [], uniqueEventsPlayed: [], resolvedEvents: [],
    deferredTables: [], ongoingChecks: [], log: [], ...patch,
  };
}
const normalizedSource = (fragment: string, paragraph: string) => source(fragment, paragraph).replace(/\s+/g, " ");
const definition = {
  enemies: {
    dog: { label: "Dog", level: 2, life: 2, damage: 1, tags: ["animal", "canine"] },
    werewolf: { label: "Werewolf", level: 4, life: 4, damage: 2, tags: ["animal", "canine", "werewolf"] },
    cat: { label: "Demon Cat", level: 4, life: 4, damage: 1, tags: ["cat-like"] },
    fire: { label: "Fire Vulnerable", level: 3, life: 3, damage: 1, tags: ["fire-vulnerable"] },
    human: { label: "Human", level: 2, life: 2, damage: 1, tags: ["human"] },
  },
  items: Object.fromEntries(["dog-food", "cat-food", "protein-bar", "energy-drinks", "first-aid-supplies", "inspirational-quotes", "wine", "coffee", "bulletproof-vest", "helmet", "bouquet", "grooming-kit", "toy", "smart-clothes", "dog-toy", "marbles", "sportswear", "dark-clothes", "spray-can", "lighter", "diary"].map(id => [id, { label: id }])),
} as unknown as FearDefinition;
const die = (...faces: number[]) => {
  let index = 0;
  return (min: number, maxExclusive: number) => {
    const value = faces[index++] ?? min;
    assert.ok(value >= min && value < maxExclusive, `fixture face ${value} outside ${min}..${maxExclusive - 1}`);
    return value;
  };
};

test("destroyed worn gear consumes one copy and the spare can be worn at full durability", () => {
  for (const [item, key, life, face] of [
    ["bulletproof-vest", "fear:item:vest:life", 4, 4],
    ["helmet", "fear:item:helmet:life", 3, 6],
  ] as const) {
    const current = state({ [item]: 2 }, { missionProgress: { [`fear:item:worn:${item}`]: true, [key]: 1 } });
    applyFearItemSourceDamage(current, 1, die(face));
    assert.equal(current.inventory[item], 1);
    assert.equal(current.missionProgress[key], undefined);
    assert.equal(current.missionProgress[`fear:item:worn:${item}`], false);
    const action = fearItemSourceActions(definition, current, { kind: "menu" }).find(value => value.action.choice === item);
    assert.ok(action);
    applyFearItemSourceAction(definition, current, action.action, die(), { kind: "menu" });
    assert.equal(current.missionProgress[key], life);
  }
});

test("source item clauses are pinned to the original rule paragraphs", () => {
  assert.match(normalizedSource("section-random-objects-table", "section-random-objects-table:p5"), /When you find Food points, you may decide that 1 such Food point is 1 dose of salt/);
  assert.match(normalizedSource("section-useful-stuff-table", "section-useful-stuff-table:p10"), /Protein bars\. This count as 1 Food point/);
  assert.match(normalizedSource("section-useful-stuff-table", "section-useful-stuff-table:p8"), /ignore the first point of Sanity lost/);
  assert.match(normalizedSource("section-useful-stuff-table", "section-useful-stuff-table:p8"), /enough for drinking 6 times/);
  assert.match(normalizedSource("section-useful-stuff-table", "section-useful-stuff-table:p2"), /Reduce by 1 XP the cost for learning the Fighter Skill/);
  assert.match(normalizedSource("section-useful-stuff-table", "section-useful-stuff-table:p2"), /not the Fighter Skill at expert level/);
  assert.match(normalizedSource("section-useful-stuff-table", "section-useful-stuff-table:p4"), /if you roll a 1 it breaks and must be discarded/);
  assert.match(normalizedSource("section-useful-stuff-table", "section-useful-stuff-table:p6"), /first attack will be directed at the Stuffed bird/);
  assert.match(normalizedSource("section-random-objects-table", "section-random-objects-table:p6"), /After each encounter with shadow creatures, there is a 1 in 6 chance/);
  assert.match(normalizedSource("section-random-objects-table", "section-random-objects-table:p5"), /Allows you to learn the Exorcism Arcane Skill if you have the Faith Skill/);
});

test("pre-encounter bait is offered only for source-eligible canine/feline encounters and consumes one can", () => {
  const current = state({ "dog-food": 2, "cat-food": 1 });
  const dog = { kind: "before-encounter", enemyId: "dog", enemyTags: ["canine"] } as const;
  const wolf = { kind: "before-encounter", enemyId: "werewolf", enemyTags: ["canine", "werewolf"] } as const;
  const cat = { kind: "before-encounter", enemyId: "cat", enemyTags: ["cat-like"] } as const;
  assert.ok(fearItemSourceActions(definition, current, dog).some(value => value.action.choice === "dog-food"));
  assert.equal(fearItemSourceActions(definition, current, wolf).some(value => value.action.choice === "dog-food"), false);
  assert.ok(fearItemSourceActions(definition, current, cat).some(value => value.action.choice === "cat-food"));
  const result = applyFearItemSourceAction(definition, current, { type: "use-item", target: "source-avoid-encounter", choice: "dog-food" }, die(), dog);
  assert.equal(result.handled, true);
  assert.deepEqual(result.effects[0], { type: "avoid-encounter", enemyId: "dog" });
  assert.equal(current.inventory["dog-food"], 1);
  assert.equal(applyFearItemSourceAction(definition, current, { type: "use-item", target: "source-avoid-encounter", choice: "dog-food" }, die(), wolf).handled, false);
});

test("pre-encounter food avoids a whole uniformly eligible group but never a mixed group", () => {
  const current = state({ "dog-food": 2, "cat-food": 1 });
  const allDogs = { kind: "before-encounter", enemyId: "dog", enemyTags: ["canine"], encounterEnemies: [
    { enemyId: "dog", enemyTags: ["canine"] }, { enemyId: "hound", enemyTags: ["canine"] },
  ] } as const;
  const mixed = { ...allDogs, encounterEnemies: [allDogs.encounterEnemies[0], { enemyId: "human", enemyTags: ["human"] }] } as const;
  const wolfMixed = { ...allDogs, encounterEnemies: [allDogs.encounterEnemies[0], { enemyId: "werewolf", enemyTags: ["canine", "werewolf"] }] } as const;
  assert.ok(fearItemSourceActions(definition, current, allDogs).some(value => value.action.choice === "dog-food"));
  assert.equal(fearItemSourceActions(definition, current, mixed).some(value => value.action.choice === "dog-food"), false);
  assert.equal(fearItemSourceActions(definition, current, wolfMixed).some(value => value.action.choice === "dog-food"), false);
  let rolls = 0;
  const action = fearItemSourceActions(definition, current, allDogs).find(value => value.action.choice === "dog-food")!.action;
  const result = applyFearItemSourceAction(definition, current, action, () => { rolls++; return 1; }, allDogs);
  assert.equal(result.handled, true);
  assert.deepEqual(result.effects, [{ type: "avoid-encounter", enemyId: "dog" }]);
  assert.equal(rolls, 0, "the source item action does not invent an additional die roll");
});

test("Food-equivalent items convert one at a time; a second consecutive energy drink sets the Magic penalty", () => {
  const current = state({ "energy-drinks": 2, "protein-bar": 1 });
  const menu = { kind: "menu" } as const;
  for (let i = 0; i < 2; i++) assert.equal(applyFearItemSourceAction(definition, current, { type: "use-item", target: "source-food", choice: "energy-drinks" }, die(), menu).handled, true);
  assert.equal(current.food, 2);
  assert.equal(current.inventory["energy-drinks"], undefined);
  assert.equal(fearItemSourceMagicModifier(current), -1);
  assert.equal(applyFearItemSourceAction(definition, current, { type: "use-item", target: "source-food", choice: "protein-bar" }, die(), menu).handled, true);
  assert.equal(current.food, 3);
  assert.equal(current.missionProgress["fear:item:energy-drink:consecutive"], 0);
  assert.equal(fearItemSourceMagicModifier(current), -1); // source gives no expiry for this penalty
});

test("bandages restore one Life, consume the item, and are unavailable at maximum Life", () => {
  const current = state({ "first-aid-supplies": 1 }, { hp: 5, maxHp: 6 });
  const menu = { kind: "menu" } as const;
  assert.ok(fearItemSourceActions(definition, current, menu).some(value => value.action.target === "source-bandage"));
  assert.equal(applyFearItemSourceAction(definition, current, { type: "use-item", target: "source-bandage", choice: "heal" }, die(), menu).handled, true);
  assert.equal(current.hp, 6); assert.equal(current.inventory["first-aid-supplies"], undefined);
  assert.equal(fearItemSourceActions(definition, current, menu).some(value => value.action.target === "source-bandage"), false);
});

test("the Journal awards one extra XP per five XP accumulated while carried", () => {
  const current = state({ diary: 1 });
  assert.deepEqual(applyFearItemSourceXp(current, 4), { extraXp: 0, accumulated: 4 });
  assert.deepEqual(applyFearItemSourceXp(current, 1), { extraXp: 1, accumulated: 0 });
  assert.deepEqual(applyFearItemSourceXp(current, 11), { extraXp: 2, accumulated: 1 });
  delete current.inventory.diary;
  assert.deepEqual(applyFearItemSourceXp(current, 4), { extraXp: 0, accumulated: 0 });
});

test("quoted text grants exactly three automatic sanity-avoidance bonuses after its XP cost", () => {
  const current = state({ "inspirational-quotes": 1 }, { xp: 1 });
  const menu = { kind: "menu" } as const;
  const read = fearItemSourceActions(definition, current, menu).find(value => value.action.target === "source-item-read")!.action;
  assert.equal(applyFearItemSourceAction(definition, current, read, die(), menu).handled, true);
  assert.equal(current.xp, 0);
  for (const expected of [2, 1, 0]) {
    assert.equal(applyFearItemSourceCheck(current, { kind: "check", check: "sanity-avoid" }).modifier, 1);
    assert.equal(current.missionProgress["fear:item:quotes:uses"], expected);
  }
  assert.equal(applyFearItemSourceCheck(current, { kind: "check", check: "sanity-avoid" }).modifier, 0);
});

test("mummy Scarab is a passive +1 Defense for the encounter and expires afterward", () => {
  const current = state({ scarab: 1 });
  const context = { kind: "check", check: "defense", enemyId: "mummy", enemyTags: ["mummy"] } as const;
  assert.equal(applyFearItemSourceCheck(current, context).modifier, 1);
  assert.equal(applyFearItemSourceCheck(current, context).modifier, 1);
  applyFearItemSourceEncounterEnd(current, ["mummy"]);
  assert.equal(applyFearItemSourceCheck(current, context).modifier, 0);
});

test("an absent Scarab is not permanently spent by a mummy encounter", () => {
  const current = state();
  applyFearItemSourceEncounterEnd(current, ["mummy"]);
  assert.equal(current.missionProgress["fear:item:scarab:spent"], undefined);
  current.inventory.scarab = 1;
  assert.equal(applyFearItemSourceCheck(current, { kind: "check", check: "defense", enemyTags: ["mummy"] }).modifier, 1);
});

test("clothing must be worn before its one-per-game check bonus; one set can be worn at a time", () => {
  const current = state({ "dark-clothes": 1, "smart-clothes": 1 });
  const menu = { kind: "menu" } as const;
  assert.equal(fearItemSourceActions(definition, current, { kind: "check", check: "stealth" }).length, 0);
  const wear = fearItemSourceActions(definition, current, menu).find(value => value.action.target === "source-wear" && value.action.choice === "dark-clothes")!.action;
  applyFearItemSourceAction(definition, current, wear, die(), menu);
  assert.ok(fearItemSourceActions(definition, current, { kind: "check", check: "stealth" }).length);
  const switchClothes = fearItemSourceActions(definition, current, menu).find(value => value.action.target === "source-wear" && value.action.choice === "smart-clothes")!.action;
  applyFearItemSourceAction(definition, current, switchClothes, die(), menu);
  assert.equal(current.missionProgress["fear:item:worn:dark-clothes"], false);
  assert.equal(current.missionProgress["fear:item:worn:smart-clothes"], true);
});

test("marbles work on catalog targets unless the printed non-walking exclusions apply", () => {
  const current = state({ marbles: 1 });
  const human = { kind: "check", check: "escape", enemyId: "human", enemyTags: ["human"] } as const;
  const flying = { kind: "check", check: "escape", enemyId: "flying", enemyTags: ["flying"] } as const;
  assert.ok(fearItemSourceActions(definition, current, human).some(value => value.action.choice === "marbles"));
  assert.equal(fearItemSourceActions(definition, current, flying).some(value => value.action.choice === "marbles"), false);
});

test("ordinary one-use Charisma/Escape items appear only for matching rolls and are consumed", () => {
  const current = state({ bouquet: 1, "grooming-kit": 1, toy: 1 });
  const charisma = { kind: "check", check: "charisma", enemyTags: ["child"] } as const;
  const action = fearItemSourceActions(definition, current, charisma).find(value => value.action.choice === "bouquet")!.action;
  const used = applyFearItemSourceAction(definition, current, action, die(), charisma);
  assert.deepEqual(used.effects, [{ type: "check-modifier", check: "charisma", amount: 1, itemId: "bouquet" }]);
  assert.equal(current.inventory.bouquet, undefined);
  assert.ok(fearItemSourceActions(definition, current, charisma).some(value => value.action.choice === "toy"));
  const human = { kind: "check", check: "charisma", enemyTags: ["human"] } as const;
  assert.equal(fearItemSourceActions(definition, current, human).some(value => value.action.choice === "toy"), false);
});

test("grooming and child-toy bonuses are explicit choices for their printed check types", () => {
  const current = state({ "grooming-kit": 1, toy: 1 });
  const childCharisma = { kind: "check", check: "charisma", enemyTags: ["child"] } as const;
  const childEscape = { kind: "check", check: "escape", enemyTags: ["child"] } as const;
  const grooming = fearItemSourceActions(definition, current, childCharisma).find(value => value.action.choice === "grooming-kit")!.action;
  assert.deepEqual(applyFearItemSourceAction(definition, current, grooming, die(), childCharisma).effects, [{ type: "check-modifier", check: "charisma", amount: 1, itemId: "grooming-kit" }]);
  assert.equal(current.inventory["grooming-kit"], undefined);
  const toy = fearItemSourceActions(definition, current, childEscape).find(value => value.action.choice === "toy")!.action;
  assert.deepEqual(applyFearItemSourceAction(definition, current, toy, die(), childEscape).effects, [{ type: "check-modifier", check: "escape", amount: 1, itemId: "toy" }]);
  assert.equal(current.inventory.toy, undefined);
});

test("dog toy applies only to dog or hound Escape, and each clothing bonus is once per game", () => {
  const current = state({ "dog-toy": 1, "dark-clothes": 1, "smart-clothes": 1, sportswear: 1 });
  const menu = { kind: "menu" } as const;
  const dogEscape = { kind: "check", check: "escape", enemyId: "dog", enemyTags: ["canine"] } as const;
  const humanEscape = { kind: "check", check: "escape", enemyId: "human", enemyTags: ["human"] } as const;
  assert.ok(fearItemSourceActions(definition, current, dogEscape).some(value => value.action.choice === "dog-toy"));
  assert.equal(fearItemSourceActions(definition, current, humanEscape).some(value => value.action.choice === "dog-toy"), false);
  const bait = fearItemSourceActions(definition, current, dogEscape).find(value => value.action.choice === "dog-toy")!.action;
  applyFearItemSourceAction(definition, current, bait, die(), dogEscape);
  assert.equal(current.inventory["dog-toy"], undefined);
  for (const [id, check] of [["dark-clothes", "stealth"], ["smart-clothes", "charisma"], ["sportswear", "escape"]] as const) {
    const wear = fearItemSourceActions(definition, current, menu).find(value => value.action.choice === id)!.action;
    applyFearItemSourceAction(definition, current, wear, die(), menu);
    const moment = { kind: "check", check, enemyId: "human", enemyTags: ["human"] } as const;
    const bonus = fearItemSourceActions(definition, current, moment).find(value => value.action.choice === id)!.action;
    assert.equal(applyFearItemSourceAction(definition, current, bonus, die(), moment).handled, true);
    assert.equal(fearItemSourceActions(definition, current, moment).some(value => value.action.choice === id), false);
  }
});

test("bird-shaped demon attack consumes a carried stuffed bird exactly once", () => {
  const current = state({ "stuffed-bird": 1 });
  assert.deepEqual(applyFearStuffedBirdBeforeAttack(current, false), { intercepted: false });
  assert.deepEqual(applyFearStuffedBirdBeforeAttack(current, true), { intercepted: true, consumedItemId: "stuffed-bird" });
  assert.equal(current.inventory["stuffed-bird"], undefined);
  assert.deepEqual(applyFearStuffedBirdBeforeAttack(current, true), { intercepted: false });
});

test("Flashlight checks battery only after shadow encounters and then becomes unusable", () => {
  const current = state({ flashlight: 1 });
  assert.deepEqual(applyFearFlashlightEncounterEnd(current, false, die(1)), { checked: false, batteryFailed: false });
  assert.equal(fearFlashlightUsable(current), true);
  assert.deepEqual(applyFearFlashlightEncounterEnd(current, true, die(1)), { checked: true, batteryFailed: true, chanceFace: 1 });
  assert.equal(fearFlashlightUsable(current), false);
  assert.deepEqual(applyFearFlashlightEncounterEnd(current, true, die(2)), { checked: false, batteryFailed: false });
  assert.equal(fearFlashlightUsable(state({}, { weaponIds: ["flashlight"] })), true);
});

test("one coffee package carries six use counters without occupying six inventory slots", () => {
  const current = state({ coffee: 1 }, { missionProgress: { "fear:item:drunk:boxes": 10 } });
  assert.equal(fearItemSourceCoffeeUses(current), 6);
  const menu = { kind: "menu" } as const;
  for (let i = 0; i < 6; i++) {
    const coffee = fearItemSourceActions(definition, current, menu).find(value => value.action.choice === "coffee")!.action;
    assert.equal(applyFearItemSourceAction(definition, current, coffee, die(), menu).handled, true);
  }
  assert.equal(current.inventory.coffee, undefined);
  assert.equal(fearItemSourceCoffeeUses(current), 0);
  current.inventory.coffee = 1;
  registerFearSourceItemAcquisition(current, "coffee", 1);
  assert.equal(fearItemSourceCoffeeUses(current), 6);
  assert.equal(current.inventory.coffee, 1);
});

test("only source-listed tools map into existing weapon profiles; samurai quality uses the printed D6 split", () => {
  assert.deepEqual(resolveFearItemSourceWeapon("flashlight", die()), { weaponId: "flashlight" });
  assert.deepEqual(resolveFearItemSourceWeapon("shovel", die()), { weaponId: "scythe-shovel" });
  assert.deepEqual(resolveFearItemSourceWeapon("hockey-or-golf-club", die()), { weaponId: "hockey-stick" });
  assert.deepEqual(resolveFearItemSourceWeapon("samurai-sword", die(2)), { weaponId: "katana", qualityRoll: 2 });
  assert.deepEqual(resolveFearItemSourceWeapon("samurai-sword", die(3)), { weaponId: "cheap-samurai-sword", qualityRoll: 3 });
  assert.equal(resolveFearItemSourceWeapon("generic-sword", die()), undefined, "do not invent combat stats for an unlisted generic sword");
});

test("martial-arts manual discounts Basic Fighter only and Exorcism book requires Faith", () => {
  const current = state({ "martial-arts-manual": 1, "exorcism-book": 1 });
  assert.equal(fearItemSourceSkillLearningCost(current, "fighter", 1, 6), 5);
  assert.equal(fearItemSourceSkillLearningCost(current, "fighter", 2, 8), 8);
  assert.equal(fearItemSourceSkillLearningCost(current, "stealth", 1, 4), 4);
  assert.equal(fearItemSourceAllowsExorcismBook(current, "exorcism", true), true);
  assert.equal(fearItemSourceAllowsExorcismBook(current, "exorcism", false), false);
  assert.equal(fearItemSourceAllowsExorcismBook(current, "summon-servitor", true), false);
});

test("cheap holy symbol breaks on first-face 1 only against a susceptible target", () => {
  const current = state({ "cheap-holy-symbol": 1 });
  assert.deepEqual(applyFearCheapHolySymbolRoll(current, 1, false), { broke: false });
  assert.equal(current.inventory["cheap-holy-symbol"], 1);
  assert.deepEqual(applyFearCheapHolySymbolRoll(current, 1, true), { broke: true });
  assert.equal(current.inventory["cheap-holy-symbol"], undefined);
});

test("vest and helmet route incoming damage once per hit and persist durability", () => {
  const vestOnly = state({ "bulletproof-vest": 1 }, { missionProgress: { "fear:item:worn:bulletproof-vest": true, "fear:item:vest:life": 4 } });
  assert.deepEqual(applyFearItemSourceDamage(vestOnly, 2, die(4)), { damageToPlayer: 0, absorbedByVest: 2, absorbedByHelmet: 0, effects: [{ type: "log", text: "防具检定掷出4。" }] });
  assert.equal(vestOnly.missionProgress["fear:item:vest:life"], 2);
  const helmetOnly = state({ helmet: 1 }, { missionProgress: { "fear:item:worn:helmet": true, "fear:item:helmet:life": 3 } });
  const blocked = applyFearItemSourceDamage(helmetOnly, 1, die(6));
  assert.equal(blocked.damageToPlayer, 0); assert.equal(blocked.absorbedByHelmet, 1); assert.equal(helmetOnly.missionProgress["fear:item:helmet:life"], 2);
  assert.equal(applyFearItemSourceDamage(helmetOnly, 1, die(5)).damageToPlayer, 1);
});

test("armor losing its last Life is consumed and a newly found piece starts at full durability", () => {
  const current = state({ "bulletproof-vest": 1, helmet: 1 }, { missionProgress: { "fear:item:worn:bulletproof-vest": true, "fear:item:worn:helmet": true, "fear:item:vest:life": 2, "fear:item:helmet:life": 1 } });
  assert.deepEqual(applyFearItemSourceDamage(current, 2, die(5)), { damageToPlayer: 0, absorbedByVest: 2, absorbedByHelmet: 0,
    effects: [{ type: "log", text: "护甲失去最后一点耐久，报废。" }, { type: "log", text: "防具检定掷出5。" }] });
  assert.equal(current.inventory["bulletproof-vest"], undefined, "the useless piece no longer occupies capacity");
  assert.equal(current.missionProgress["fear:item:worn:bulletproof-vest"], false);
  assert.equal(current.missionProgress["fear:item:vest:life"], undefined, "the stale zero-durability key is cleared for the next piece");
  const helmetBroke = applyFearItemSourceDamage(current, 1, die(6));
  assert.equal(helmetBroke.absorbedByHelmet, 1);
  assert.equal(current.inventory.helmet, undefined);
  assert.equal(current.missionProgress["fear:item:worn:helmet"], false);
  current.inventory["bulletproof-vest"] = 1;
  const menu = { kind: "menu" } as const;
  const wear = fearItemSourceActions(definition, current, menu).find(value => value.action.choice === "bulletproof-vest")!.action;
  assert.equal(applyFearItemSourceAction(definition, current, wear, die(), menu).handled, true);
  assert.equal(current.missionProgress["fear:item:worn:bulletproof-vest"], true);
  assert.equal(current.missionProgress["fear:item:vest:life"], 4, "the new piece starts at the source's 4 Life, not the consumed piece's zero");
});

test("re-equipping worn armor does not restore lost durability", () => {
  const current = state({ "bulletproof-vest": 1 }, { missionProgress: { "fear:item:vest:life": 1 } });
  const action = { type: "use-item", target: "source-wear", choice: "bulletproof-vest" } as const;
  assert.equal(applyFearItemSourceAction(definition, current, action, die(), { kind: "menu" }).handled, true);
  assert.equal(current.missionProgress["fear:item:vest:life"], 1);
  current.missionProgress["fear:item:worn:bulletproof-vest"] = false;
  assert.equal(applyFearItemSourceAction(definition, current, action, die(), { kind: "menu" }).handled, true);
  assert.equal(current.missionProgress["fear:item:vest:life"], 1);
});

test("combined armor interpretation routes 3/5 to vest and 6 to helmet", () => {
  const current = state({}, { missionProgress: { "fear:item:worn:bulletproof-vest": true, "fear:item:worn:helmet": true, "fear:item:vest:life": 4, "fear:item:helmet:life": 3 } });
  const vest = applyFearItemSourceDamage(current, 2, die(3));
  assert.equal(vest.absorbedByVest, 2); assert.equal(vest.absorbedByHelmet, 0);
  const helmet = applyFearItemSourceDamage(current, 1, die(6));
  assert.equal(helmet.absorbedByHelmet, 1); assert.equal(helmet.absorbedByVest, 0);
});

test("alcohol uses an ordinary D6 duration, imposes attack/defense penalty, and coffee shortens duration", () => {
  const current = state({ wine: 1, coffee: 1 });
  const menu = { kind: "menu" } as const;
  const encounter = { kind: "before-encounter", enemyId: "dog", enemyTags: ["canine"] } as const;
  assert.equal(fearItemSourceActions(definition, current, menu).some(value => value.action.choice === "wine"), false);
  const wine = fearItemSourceActions(definition, current, encounter).find(value => value.action.choice === "wine")!.action;
  applyFearItemSourceAction(definition, current, wine, die(6), encounter);
  assert.equal(current.missionProgress["fear:item:drunk:boxes"], 6);
  assert.equal(fearItemSourceBlocksBooksOrRituals(current), true);
  assert.equal(applyFearItemSourceCheck(current, { kind: "check", check: "attack" }).modifier, -1);
  const sanity = applyFearItemSourceCheck(current, { kind: "check", check: "sanity-avoid" });
  assert.equal(sanity.effects[0]?.type, "block-sanity-loss");
  assert.equal(current.missionProgress["fear:item:drunk:sanity-shield"], true, "a check alone is not an actual SAN loss");
  assert.deepEqual(consumeFearAlcoholSanityShieldOnLoss(current, 0), { blocked: 0, remainingLoss: 0 });
  assert.equal(current.missionProgress["fear:item:drunk:sanity-shield"], true);
  assert.deepEqual(consumeFearAlcoholSanityShieldOnLoss(current, 1), { blocked: 1, remainingLoss: 0 }, "the shield also applies to SAN loss from a pre-turn Fear save");
  assert.equal(current.missionProgress["fear:item:drunk:sanity-shield"], false);
  const coffee = fearItemSourceActions(definition, current, menu).find(value => value.action.choice === "coffee")!.action;
  applyFearItemSourceAction(definition, current, coffee, die(), menu);
  assert.equal(current.missionProgress["fear:item:drunk:boxes"], 5);
  applyFearItemSourceMove(current, 5);
  assert.equal(fearItemSourceBlocksBooksOrRituals(current), false);
});

test("spray can requires lighter, consumes itself, and returns exact central fire-damage signals", () => {
  const current = state({ "spray-can": 1, lighter: 1 });
  const moment = { kind: "combat-item", enemyId: "fire", enemyTags: ["fire-vulnerable"] } as const;
  const action = fearItemSourceActions(definition, current, moment).find(value => value.action.target === "source-spray-can")!.action;
  const result = applyFearItemSourceAction(definition, current, action, die(), moment);
  assert.equal(result.handled, true);
  assert.deepEqual(result.effects, [{ type: "enemy-damage", enemyId: "fire", amount: 3, damageType: "fire" }]);
  assert.equal(current.inventory["spray-can"], undefined);
  const noLighter = state({ "spray-can": 1 });
  assert.equal(fearItemSourceActions(definition, noLighter, moment).length, 0);
});

test("ordinary skills remain separate from item modifiers; no item bonus appears in an unrelated check", () => {
  const current = state({ bouquet: 1 });
  assert.equal(fearItemSourceActions(definition, current, { kind: "check", check: "escape", enemyId: "human", enemyTags: ["human"] }).length, 0);
  assert.equal(applyFearItemSourceCheck(current, { kind: "check", check: "magic" }).modifier, 0);
});
