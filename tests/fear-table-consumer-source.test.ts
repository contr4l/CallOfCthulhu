import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearStory } from "../packages/contracts/fear.js";
import { advanceFear, availableFearActions, initialFear } from "../packages/engine/fear.js";

const baseStory = JSON.parse(readFileSync("work/alone-against-fear/reviewed-story.json", "utf8"));
const sourceDefinition = JSON.parse(readFileSync("work/alone-against-fear/reviewed-definition.json", "utf8")) as FearDefinition;

function roller(...faces: number[]) { let i = 0; return () => faces[i++] ?? 1; }
function source(fragment: string, sha256: string, id: string) {
  const bytes = readFileSync(`scripts/alone-against-fear/fragments/${fragment}.json`);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256, `${fragment} source pin`);
  const paragraph = (JSON.parse(bytes.toString("utf8")) as { paragraphs: Array<{ id: string; text: string }> }).paragraphs.find(value => value.id === id);
  assert.ok(paragraph, `${id} exists in the pinned fragment`);
  return paragraph.text.replace(/\s+/g, " ");
}
function action(story: FearStory, state: ReturnType<typeof initialFear>, predicate: (value: ReturnType<typeof availableFearActions>[number]) => boolean) {
  const value = availableFearActions(story, state).find(predicate);
  assert.ok(value, `expected public action; current actions: ${JSON.stringify(availableFearActions(story, state).map(item => item.action))}`);
  return value.action;
}
function start(story: FearStory, options: Record<string, unknown> = {}) {
  let state = initialFear(story, { hp: 8, maxHp: 8, sanity: 8, maxSanity: 8, ...options }, roller(1));
  state = advanceFear(story, state, action(story, state, value => value.action.type === "choose" && value.action.choice === "s1:b1"), roller());
  if (state.pendingEvent) {
    state = advanceFear(story, state, action(story, state, value => value.action.type === "resolve-event" && value.action.target === state.pendingEvent!.eventId), roller());
  }
  return state;
}
function moveToSecondBox(story: FearStory, state: ReturnType<typeof initialFear>, dice: () => number) {
  const move = action(story, state, value => value.action.type === "move" && value.action.target === "s1:b2");
  return advanceFear(story, state, move, dice);
}
function storyFor(tableId: string): FearStory {
  const fear = structuredClone(sourceDefinition);
  fear.rules.townExplorationTable = tableId;
  delete fear.rules.startingEquipmentTables;
  // Event 1 is an unrelated prologue. Keep its resolution as a public action,
  // but avoid running the full introductory rules in these table-focused cases.
  fear.eventPrograms["1"] = [];
  return { ...baseStory, fear } as FearStory;
}

test("Armory searches each eligible weapon separately and persists found copies through its source recipe choices", () => {
  const text = source("section-store-table", "5335ff0b6ba6d54af37cb05349f88c408f794cc05470a8fd1e71fe12ea2839da", "section-store-table:p3");
  assert.match(text, /1 in 6 chance of finding any weapon/);
  assert.match(text, /Roll once per weapon/);
  assert.match(text, /2d6 ammo for it/);
  const story = storyFor("store");
  story.fear.weapons = {
    "test-armory-blade": { label: "测试短刀", damage: 1 },
    "test-armory-pistol": { label: "测试手枪", damage: 1, ammoType: "pistol" },
  };
  story.fear.tables["store-armory-encounter"] = { die: "D6", entries: [{ roll: [1, 6], result: "quiet", operations: [] }] };
  const state = start(story);
  const entered = moveToSecondBox(story, state, roller(3, 6));
  assert.ok(entered.pending, entered.log.join("\n"));
  const ammoChoice = action(story, entered, value => value.action.type === "choose" && value.action.choice === "pistol");
  const afterAmmo = advanceFear(story, entered, ammoChoice, roller(2, 6, 1, 6, 6));
  assert.ok(!afterAmmo.weaponIds.includes("test-armory-blade"), "the first weapon fails its own 1-in-6 check");
  assert.ok(afterAmmo.weaponIds.includes("test-armory-pistol"), "the second weapon succeeds on its independent 1-in-6 check");
  assert.ok(afterAmmo.log.some(line => line.includes("军械库逐项搜索")), afterAmmo.log.join("\n"));
});

test("Hangmans Tree loops through the printed D6 corpses using one public Search action per corpse", () => {
  const text = source("section-woods-park-table", "d5f749f3631922ef106f0c2979c1e0c24848532dd3ae6947ed657717c6e7b0d9", "section-woods-park-table:p5");
  assert.match(text, /d6 corpses/);
  assert.match(text, /each corpse/);
  const story = storyFor("woods-park");
  const state = start(story);
  let current = moveToSecondBox(story, state, roller(6, 2, 6, 1));
  assert.equal(current.pending?.kind, "fear-hangman-loot");
  const loot = action(story, current, value => value.action.type === "choose" && value.action.choice === "random-objects");
  current = advanceFear(story, current, loot, roller(1, 1, 6, 1));
  assert.equal(current.pending?.kind, "fear-hangman-loot");
  const secondLoot = action(story, current, value => value.action.type === "choose" && value.action.choice === "random-objects");
  current = advanceFear(story, current, secondLoot, roller(1, 1));
  assert.equal(current.pending, undefined);
  assert.equal(current.log.filter(line => line.includes("吊尸恐惧检定L4 Will")).length, 2);
  assert.equal(current.inventory.rope, 2, "each of the two corpse loot rolls resolves independently");
});

test("School library child victory enables the source Search, which rolls Children’s Stuff", () => {
  const text = source("section-school-table", "b7de8e9c4e124a6911d55dd86afd292f86486af05455f4ac8a4fa5a7529f1878", "section-school-table:p4");
  assert.match(text, /after defeating the zombie children/);
  assert.match(text, /Children’s Stuff table/);
  const story = storyFor("school");
  story.fear.weapons["test-school-sword"] = { label: "测试剑", damage: 12 };
  const state = start(story, { weaponIds: ["test-school-sword"], weaponId: "test-school-sword" });
  let current = moveToSecondBox(story, state, roller(4, 6, 1, 1));
  assert.equal(current.combat?.enemyId, "zombie-child", current.log.join("\n"));
  const attack = action(story, current, value => value.action.type === "attack");
  current = advanceFear(story, current, attack, roller(6));
  assert.equal(current.combat, undefined, current.log.join("\n"));
  assert.ok(action(story, current, value => value.action.type === "search"));
  const search = action(story, current, value => value.action.type === "search");
  current = advanceFear(story, current, search, roller(6, 1));
  assert.ok(current.log.some(line => line.includes("儿童物品表")), current.log.join("\n"));
});

test("Rosen House rerolls the same map box after its unique location marker is already present", () => {
  const text = source("section-haunted-house-table", "f91166cecf6bf18bceb33a3a8487d1bc61e83b7c9f991de0907bbf8e04bad9aa", "section-haunted-house-table:p4");
  assert.match(text, /mark the location of the Rosen house on your exploration map/);
  assert.match(text, /Reroll if you already found the Rosen House/);
  const story = storyFor("haunted-house");
  const state = start(story);
  const target = state.mapSheets[0].boxes.find(box => box.id === "s1:b2")!;
  // This is the pre-existing map fact the source asks the player to mark; all
  // progression into and through the second table result remains public.
  state.missionProgress["fear-table:rosen-house:box-id"] = target.id;
  const current = moveToSecondBox(story, state, roller(4, 1));
  assert.ok(current.log.some(line => line.includes("Rosen House已在本区域找到")), current.log.join("\n"));
  assert.equal(current.mapSheets[0].boxes.find(box => box.id === "s1:b2")?.id, target.id);
});
