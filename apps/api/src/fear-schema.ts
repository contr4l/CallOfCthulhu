import { z } from "zod";
import type { FearDefinition, FearOperation } from "../../../packages/contracts/fear.js";
import type { Story } from "../../../packages/contracts/index.js";

const id = z.string().min(1).max(100);
const integer = z.number().int();
const amount = z.union([integer, z.string().regex(/^(?:D3(?:[+-]\d+)?|D66|(?:[1-9]|1\d|20)?D6(?:[+-]\d+)?)$/i)]);
const operations: z.ZodType<FearOperation[]> = z.lazy(() => z.array(operation).max(500));
const threshold = z.enum(["after-create-3", "before-create-3"]);
export const operation: z.ZodType<FearOperation> = z.lazy(() => z.union([
  z.object({ op: z.literal("max-resource"), key: z.enum(["maxHp", "maxSanity"]), amount: integer }).strict(),
  z.object({ op: z.literal("permanent-loss"), key: z.enum(["hp", "sanity"]), amount: integer.positive() }).strict(),
  z.object({ op: z.literal("restore-resource"), key: z.enum(["hp", "sanity"]), amount: z.union([integer.nonnegative(), z.literal("all")]) }).strict(),
  z.object({ op: z.literal("ongoing-check"), id, trigger: z.literal("move"), context: id, level: integer, requiredSkill: id.optional(), failure: operations, success: operations.optional() }).strict(),
  z.object({ op: z.literal("repeat-check"), context: id, level: integer, requiredSkill: id.optional(), failure: operations.optional(), success: operations.optional() }).strict(),
  z.object({ op: z.literal("modifier"), key: id, amount: integer, duration: z.enum(["campaign", "mission", "next-combat"]), encounters: integer.positive().optional() }).strict(),
  z.object({ op: z.literal("require-item"), itemId: id, count: integer.positive().optional(), success: operations, failure: operations.optional() }).strict(),
  z.object({ op: z.literal("if-item-any"), itemIds: z.array(id).min(1), success: operations, failure: operations.optional() }).strict(),
  z.object({ op: z.literal("if-book-read"), itemId: id, success: operations, failure: operations.optional() }).strict(),
  z.object({ op: z.literal("require-skill"), skillId: id, level: z.union([z.literal(1), z.literal(2)]).optional(), success: operations, failure: operations.optional() }).strict(),
  z.object({ op: z.literal("if-resource"), key: z.enum(["hp", "sanity", "food", "clues"]), comparison: z.enum(["eq", "lt", "lte", "gt", "gte"]), value: integer, success: operations, failure: operations.optional() }).strict(),
  z.object({ op: z.literal("require-resource"), key: z.enum(["hp", "sanity", "food", "clues"]), amount: integer.nonnegative() }).strict(),
  z.object({ op: z.literal("if-flag"), key: id, value: z.boolean(), success: operations, failure: operations.optional() }).strict(),
  z.object({ op: z.literal("event-end") }).strict(),
  z.object({ op: z.literal("whispering-presence"), randomEncounterTable: id }).strict(),
  z.object({ op: z.literal("ghost-librarian"), exorcismSkillId: id, bookItemIds: z.array(id).min(1) }).strict(),
  z.object({ op: z.literal("bright-apparition"), exorcismSkillId: id }).strict(),
  z.object({ op: z.literal("mirina-encounter"), exorcismSkillId: id }).strict(),
  z.object({ op: z.literal("mirina-human-contact"), contact: z.enum(["old-man", "chained-girl"]) }).strict(),
  z.object({ op: z.literal("spend-all-resource"), key: z.literal("food") }).strict(),
  z.object({ op: z.literal("combat-outcome"), enemyId: id, defeated: operations, fled: operations.optional(), escaped: operations.optional() }).strict(),
  z.object({ op: z.literal("group-combat-outcome"), primaryEnemyId: id, foodEnemyId: id, foodEach: z.string().regex(/^(?:D3|D66|(?:[1-9]|1\d|20)?D6(?:[+-]\d+)?)$/i), allDefeated: operations.optional() }).strict(),
  z.object({ op: z.literal("resource"), key: z.union([z.enum(["hp", "sanity", "food", "missionFood", "clues", "xp", "gatesClosed", "firstAid"]), z.custom<`ammo-${string}`>(v => typeof v === "string" && /^ammo-[\w-]+$/.test(v))]), amount }).strict(),
  z.object({ op: z.literal("item"), itemId: id, amount }).strict(),
  z.object({ op: z.literal("weapon"), weaponId: id, ammo: z.string().optional() }).strict(),
  z.object({ op: z.literal("mission-progress"), key: id, value: z.union([integer, z.string(), z.boolean()]) }).strict(),
  z.object({ op: z.literal("flag"), key: id, value: z.boolean() }).strict(),
  z.object({ op: z.literal("start-combat"), enemyId: id, count: amount }).strict(),
  z.object({ op: z.literal("upyr-encounter") }).strict(),
  z.object({ op: z.literal("vetala-encounter") }).strict(),
  z.object({ op: z.literal("start-combat-groups"), groups: z.array(z.object({ enemyId: id, count: amount }).strict()).min(1).max(20), escapeAfter: z.object({ enemyId: id, defeated: integer.positive() }).strict().optional() }).strict(),
  z.object({ op: z.literal("roll-check"), context: id, level: integer, enemyId: id.optional(), success: operations.optional(), failure: operations.optional(), successAfter: integer.optional(), successBefore: integer.optional(), explode: z.boolean().optional(), requiredSkill: id.optional(), bonus: integer.optional() }).strict(),
  z.object({ op: z.literal("roll-check-count"), context: id, level: integer, count: amount, enemyId: id.optional(), requiredSkill: id.optional(), failure: operations }).strict(),
  z.object({ op: z.literal("probability"), numerator: integer.nonnegative(), denominator: integer.positive(), success: operations, failure: operations.optional() }).strict().refine(v => v.numerator <= v.denominator, "遭遇概率不可超过1"),
  z.object({ op: z.literal("injury-check"), kind: z.enum(["life", "sanity"]), amount: integer.nonnegative(), tableId: id }).strict(),
  z.object({ op: z.literal("search-loot-choice"), tableIds: z.array(id).min(1), alternative: z.literal("clue") }).strict(),
  z.object({ op: z.literal("climb-for-loot"), tableIds: z.array(id).min(1), level: integer, skillId: id }).strict(),
  z.object({ op: z.literal("event-branch"), eventId: id, ifPlayed: operations, ifNew: operations }).strict(),
  z.object({ op: z.literal("optional-safehouse"), threshold, restoreLife: integer, restoreSanity: integer }).strict(),
  z.object({ op: z.literal("rest-choice"), life: integer, sanity: integer }).strict(),
  z.object({ op: z.enum(["choose-reward", "choose-item"]), options: z.array(id).min(1) }).strict(),
  z.object({ op: z.literal("choose-effect"), prompt: z.string().max(240), choices: z.record(id, operations) }).strict().refine(v => Object.keys(v.choices).length > 0, "选择不能为空"),
  z.object({ op: z.literal("hell-gate"), skillId: id, level: integer, rewardSanity: integer, skipEncounters: integer.nonnegative() }).strict(),
  z.object({ op: z.literal("search-bonus-choice"), modifier: integer }).strict(),
  z.object({ op: z.literal("clinic-search-choice"), searches: integer.positive(), thenStealthL: integer, failureTable: id, clueFearL: integer }).strict(),
  z.object({ op: z.literal("farm-food-or-search"), food: z.string(), choices: z.array(id).min(1) }).strict(),
  z.object({ op: z.literal("farmer-choice"), foodOptions: z.array(id), lootTables: z.array(id), thenFight: z.boolean() }).strict(),
  z.object({ op: z.literal("conditional-skill-purchase"), skillId: id, xp: integer.nonnegative(), probability: z.tuple([integer.nonnegative(), integer.positive()]), onFind: operations, extraProbability: z.tuple([integer.nonnegative(), integer.positive()]), extraTable: id }).strict(),
  z.object({ op: z.literal("roll-table"), tableId: id }).strict(),
  z.object({ op: z.literal("choose-table"), tableIds: z.array(id).min(1) }).strict(),
  z.object({ op: z.literal("mark-gate") }).strict(),
  z.object({ op: z.literal("sewer-shelter"), enemyId: id }).strict(),
  z.object({ op: z.literal("discard-choice"), excludedItemIds: z.array(id), excludedTags: z.array(id), excludedWeaponIds: z.array(id) }).strict(),
  z.object({ op: z.literal("mark-safehouse"), threshold, restoreLife: integer.optional(), restoreSanity: integer.optional(), visitHealLife: integer.nonnegative().optional(), visitHealSanity: integer.nonnegative().optional() }).strict(),
  z.object({ op: z.literal("unique-event"), eventId: id }).strict(),
  z.object({ op: z.literal("route"), scene: id }).strict(),
]));
const outcome = z.object({
  roll: z.union([integer, z.tuple([integer, integer]).refine(v => v[0] <= v[1], "骰面区间错误")]),
  result: id, scene: id.optional(), tags: z.array(id).optional(), rerollLocations: z.array(id).optional(),
  values: z.record(id, z.union([integer, z.string(), z.boolean()])).optional(), operations: operations.optional(),
}).strict();
export const fearDefinition: z.ZodType<FearDefinition> = z.object({
  format: z.literal("aaf-fear-definition@1"), source: z.object({ pdfSha256: z.string().regex(/^[a-f0-9]{64}$/), pages: integer.positive() }).strict(),
  map: z.object({ boxesPerSheet: z.literal(30), rows: z.literal(6), columns: z.literal(5), adjacency: z.enum(["orthogonal", "diagonal"]), topologyBasis: z.enum(["source-verified", "web-adaptation"]).optional(), start: z.object({ sheet: integer.positive(), box: integer.min(1).max(30) }).strict(), safehouseLimit: z.literal(3), safehouseLifetime: z.literal("nearest-first") }).strict(),
  rules: z.object({ foodEveryBoxes: z.literal(5), townExplorationTable: id, randomEncounterTable: id, usefulItemTable: id, randomItemTable: id, maxScars: z.literal(3), maxTraumas: z.literal(3), searchOncePerBox: z.literal(true), exploredAreaEncounter: z.object({ numerator: z.literal(1), denominator: z.literal(6) }).strict(), sixExplodes: z.literal(true), naturalOneFails: z.literal(true), naturalSixSucceeds: z.literal(true), startingEquipmentTables: z.object({ randomWeapon: id, randomObject: id, usefulItem: id }).strict().optional() }).strict(),
  sceneRefs: z.object({ entry: id, exploration: id, missions: id, specialEvents: z.record(id, id), tables: z.record(id, id), events: z.record(id, id), endings: z.record(id, id) }).strict(),
  eventPrograms: z.record(id, operations),
  skills: z.record(id, z.object({ label: z.string().min(1).max(80), kind: z.enum(["skill", "arcane"]).optional(), xp: integer.nonnegative(), modifiers: z.record(id, z.tuple([integer, integer])), foodEveryBoxes: z.tuple([integer.positive(), integer.positive()]).optional(), maxHpChange: z.tuple([integer, integer]).optional(), maxSanityChange: z.tuple([integer, integer]).optional(), capacityBonus: z.tuple([integer, integer]).optional(), clueDiscount: z.tuple([integer.nonnegative(), integer.nonnegative()]).optional(), startingWeapons: z.array(id).optional(), startingItems: z.array(id).optional(), startingAmmo: z.record(id, z.string()).optional() }).strict()),
  arcaneLearning: z.record(id, z.object({ sources: z.array(z.object({ itemId: id, requiredSkill: id.optional(), requiredSkillLevel: z.union([z.literal(1), z.literal(2)]).optional(), sanityLoss: z.enum(["temporary", "permanent"]).optional() }).strict()).optional(), gateAtLocation: z.object({ clues: integer.positive(), requiredSkill: id, timeBoxes: z.union([z.literal(0), z.literal("D3")]).optional() }).strict().optional(), timeBoxes: z.union([z.literal(0), z.literal("D3")]), expert: z.boolean(), sourceCondition: z.literal("not-printed").optional() }).strict()).optional(),
  items: z.record(id, z.object({ label: z.string().min(1).max(80), tags: z.array(id).optional(), weightless: z.boolean().optional(), carriedWeight: z.number().int().positive().max(5).optional() }).strict()).optional(),
  injuries: z.record(id, z.object({ label: z.string().min(1).max(80), tableRoll: integer.optional(), modifiers: z.record(id, integer).optional(), flags: z.array(id).optional() }).strict()).optional(),
  traumas: z.record(id, z.object({ label: z.string().min(1).max(80), tableRoll: integer.optional(), modifiers: z.record(id, integer).optional(), flags: z.array(id).optional(), foodEveryBoxes: integer.positive().optional(), maxSanityChange: integer.optional(), escapeBelowLife: integer.optional() }).strict()).optional(),
  weapons: z.record(id, z.object({ label: z.string().min(1).max(80), damage: integer.nonnegative(), ammoType: id.optional(), ammoPerAttack: integer.nonnegative().optional(), attacks: integer.positive().optional(), modifier: integer.optional(), tags: z.array(id).optional() }).strict()),
  enemies: z.record(id, z.object({ label: z.string().min(1).max(80), level: integer, life: integer.positive(), lifeMode: z.enum(["player-max", "infinite"]).optional(), damage: integer.nonnegative(), damageBasis: z.enum(["source", "user-authorized-web-adaptation"]).optional(), damageResource: z.enum(["hp", "sanity"]).optional(), defenseContext: id.optional(), naturalOneDamage: integer.nonnegative().optional(), fleeAtLife: integer.nonnegative().optional(), fleeChance: z.tuple([integer.nonnegative(), integer.positive()]).optional(), holyWaterDamage: integer.positive().optional(), surprise: integer.nonnegative().optional(), surpriseByLocation: z.record(id, integer.nonnegative()).optional(), attackBounceChance: z.tuple([integer.nonnegative(), integer.positive()]).optional(), hitIgnoreChance: z.tuple([integer.nonnegative(), integer.positive()]).optional(), escapeModifier: integer.optional(), escapeBait: z.object({ itemIds: z.array(id).optional(), food: integer.nonnegative().optional(), bonus: integer }).strict().optional(), infectionChance: z.tuple([integer.nonnegative(), integer.positive()]).optional(), infectionTrigger: z.enum(["defense-failure", "combat-end-after-damage"]).optional(), infectionSave: z.object({ level: integer.positive(), requiredSkill: id, context: z.literal("infection-save"), trigger: z.literal("natural-one"), failureDamagePerBox: integer.positive() }).strict().optional(), infectionDamage: integer.nonnegative().optional(), noEscape: z.boolean().optional(), attackModifiers: z.array(z.object({ weaponTag: id, amount: integer }).strict()).optional(), immuneWeaponTags: z.array(id).optional(), unarmedHitDamage: integer.nonnegative().optional(), fearSave: z.object({ level: integer.positive(), context: z.literal("fear-save"), sanityLoss: integer.positive() }).strict().optional(), tags: z.array(id).optional(), immunity: z.array(id).optional(), scene: id.optional(), familyRule: z.enum(["alien-gray", "alien-hunter", "alien-beast", "reptilian", "mi-go", "tentacled-beast", "blob", "murdering-robot", "mutant", "doppelganger", "tentacled-horror", "giant-bug", "vivina", "muama", "maraya", "azolina", "kalina"]).optional(), specialRule: z.enum(["demon-cat", "tickling-ghost", "doppelganger", "pied-piper", "demon-dog", "witch-librarian", "zombie-tiger", "brain-eaters", "zombie-squirrels", "zombie-pet", "zombie-friend", "zombie-abomination", "vampire-vehn", "vampire-wurdalak", "vampire-kempir", "vampire-midnight-man", "vampire-vetala", "demon-child", "demonic-goat", "night-shadow"]).optional() }).strict()),
  tables: z.record(id, z.object({ die: z.string().regex(/^(?:D3(?:[+-]\d+)?|D66|(?:[1-9]|1\d|20)?D6(?:[+-]\d+)?)$/i), entries: z.array(outcome).min(1), exhausted: outcome.optional(), rerollDefeated: z.boolean().optional() }).strict()),
  missions: z.record(id, z.object({ label: z.string().min(1).max(80), goal: z.string().max(240), kind: z.enum(["medical-supplies", "hunt-target", "bring-food", "bring-weapons", "witches", "hell-gates"]).optional(), target: z.union([integer, id]).optional(), targetTable: id.optional(), reward: z.object({ xp: integer.nonnegative().optional(), itemRolls: integer.nonnegative().optional() }).strict().optional(), scene: id.optional() }).strict()),
  gates: z.object({ required: z.literal(7), scene: id.optional(), level: integer }).strict(),
}).strict();

/** Every table face and nested operation is checked before a pack enters the catalog. */
export function validateFearReferences(story: Story) {
  const definition = story.fear!;
  const nodes = new Set(story.nodes.map(node => node.id));
  const scene = (ref: string) => { if (!nodes.has(ref)) throw new Error(`恐惧独行引用缺失片段 ${ref}`); };
  for (const [key, refs] of Object.entries(definition.sceneRefs)) {
    if (typeof refs === "string") scene(refs);
    else Object.values(refs).forEach(scene);
  }
  // Mission 5 creates five individually tracked witches outside the random
  // encounter tables. Keep its built-in enemy dependency explicit so a
  // catalog rebuild cannot produce a structurally valid but unwinnable book.
  if (Object.values(definition.missions).some(mission => mission.kind === "witches")) {
    const witch = definition.enemies["coven-witch"];
    if (!witch) throw new Error("恐惧独行任务引用未知enemies coven-witch");
    if (witch.level !== 4 || witch.life !== 4 || witch.damage !== 1 ||
        !witch.tags?.includes("human") || !witch.tags.includes("witch")) {
      throw new Error("恐惧独行内建敌人 coven-witch 必须符合来源 L4 human、4 Life 与通用 1 点伤害规则");
    }
  }
  if (Object.values(definition.missions).some(mission => mission.kind === "medical-supplies")) {
    if (definition.items?.["medicine-dose"]?.label !== "所需药剂（1剂）") {
      throw new Error("恐惧独行医疗物资任务必须定义来源物品 medicine-dose（section-mission-table:p1）");
    }
  }
  const exists = (kind: "tables" | "skills" | "enemies" | "weapons", ref: string) => {
    if (!Object.hasOwn(definition[kind], ref)) throw new Error(`恐惧独行引用未知${kind} ${ref}`);
  };
  for (const key of ["townExplorationTable", "randomEncounterTable", "usefulItemTable", "randomItemTable"] as const) exists("tables", definition.rules[key]);
  Object.values(definition.rules.startingEquipmentTables ?? {}).forEach(ref => exists("tables", ref));
  for (const skill of Object.values(definition.skills)) {
    skill.startingWeapons?.forEach(ref => exists("weapons", ref));
    Object.keys(skill.startingAmmo ?? {}).forEach(ref => exists("weapons", ref));
    skill.startingItems?.forEach(ref => { if (!definition.items?.[ref]) throw new Error(`恐惧独行初始物品未定义 ${ref}`); });
  }
  for (const [skillId, rule] of Object.entries(definition.arcaneLearning ?? {})) {
    if (!definition.skills[skillId] || definition.skills[skillId].kind !== "arcane") throw new Error(`恐惧独行奥术学习规则引用非奥术技能 ${skillId}`);
    for (const source of rule.sources ?? []) {
      if (!definition.items?.[source.itemId]) throw new Error(`恐惧独行奥术学习引用未知物品 ${source.itemId}`);
      if (source.requiredSkill && !definition.skills[source.requiredSkill]) throw new Error(`恐惧独行奥术学习引用未知技能 ${source.requiredSkill}`);
    }
    if (rule.gateAtLocation && !definition.skills[rule.gateAtLocation.requiredSkill]) throw new Error(`恐惧独行奥术学习引用未知技能 ${rule.gateAtLocation.requiredSkill}`);
  }
  function walk(value: unknown, depth = 0) {
    if (depth > 32) throw new Error("恐惧独行规则嵌套过深");
    if (Array.isArray(value)) value.forEach(child => walk(child, depth + 1));
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string") {
        if (key === "scene") scene(child);
        if (["tableId", "failureTable", "extraTable", "targetTable", "randomEncounterTable"].includes(key)) exists("tables", child);
        if (["skillId", "requiredSkill", "exorcismSkillId"].includes(key)) exists("skills", child);
        if (["enemyId", "primaryEnemyId", "foodEnemyId"].includes(key)) exists("enemies", child);
        if (key === "weaponId") exists("weapons", child);
        if (key === "itemId" && !definition.items?.[child] && !definition.weapons[child]) throw new Error(`恐惧独行引用未定义物品或武器 ${child}`);
      }
      if (["tableIds", "lootTables"].includes(key) && Array.isArray(child)) child.forEach(ref => exists("tables", ref));
      if (["itemIds", "bookItemIds"].includes(key) && Array.isArray(child)) child.forEach(ref => { if (!definition.items?.[ref] && !definition.weapons[ref]) throw new Error(`恐惧独行引用未定义物品或武器 ${ref}`); });
      walk(child, depth + 1);
    }
  }
  walk(definition);
  for (const [tableId, table] of Object.entries(definition.tables)) {
    const die = table.die.toUpperCase();
    let domain: number[];
    if (die === "D3") domain = [1, 2, 3];
    else if (/^D3[+-]\d+$/.test(die)) { const offset = Number(die.slice(2)); domain = [1, 2, 3].map(face => face + offset); }
    else if (die === "D66") domain = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i + 1) * 10 + j + 1)).flat();
    else {
      const match = /^(\d*)D6(?:([+-])(\d+))?$/.exec(die)!;
      const count = Number(match[1] || 1), offset = (match[2] === "-" ? -1 : 1) * Number(match[3] || 0);
      domain = Array.from({ length: count * 5 + 1 }, (_, index) => index + count + offset);
    }
    for (const face of domain) {
      const rows = table.entries.filter(row => typeof row.roll === "number" ? row.roll === face : row.roll[0] <= face && row.roll[1] >= face);
      if (rows.length !== 1) throw new Error(`恐惧独行表${tableId}的骰面${face}缺失或重复`);
    }
    if (table.entries.some(row => !domain.some(face => typeof row.roll === "number" ? row.roll === face : row.roll[0] <= face && row.roll[1] >= face)))
      throw new Error(`恐惧独行表${tableId}有不可用骰面`);
  }
}
