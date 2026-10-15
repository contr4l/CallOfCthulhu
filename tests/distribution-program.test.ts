import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import { field } from "../packages/engine/program.js";
import type { Instruction } from "../packages/contracts/program.js";

function fixture(program: Instruction[]) {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "distribution-fixture"; delete story.healthPolicy; story.entry = "entry";
  story.party = { members: ["guide", "student"].map(id => ({ id, character: createCharacter(id, story.presets[0], 50), inventory: [{ key: "rifle", label: "步枪", quantity: 1 }] })) };
  story.nodes = [{ id: "entry", title: "分配", chapter: "1", type: "program", background: story.nodes[0].background, text: ["在同行者之间分配。"], program: [...program, { kind: "end", label: "结束", collect: false }] }];
  return validateStory(story);
}
test("remaining rifles are rolled once and assigned exactly among present companions", () => {
  const story = fixture([
    { kind: "effects", effects: [{ op: "item", key: "knife", label: "小刀" }] },
    { kind: "rollEffects", label: "剩余步枪", effects: [{ op: "set", field: "counter.rifles", value: "1D3+1" }] },
    { kind: "distribute", label: "分配剩余步枪", resource: "item", total: { field: "counter.rifles" }, recipients: ["$player", "guide", "student"], key: "rifle", itemLabel: "步枪" },
  ]);
  let state = initialState(story, createCharacter("教授", story.presets[0], 85), () => 1), draws = 0;
  state = advance(story, state, "next", () => { draws++; return 2; }).state;
  assert.equal(draws, 1); assert.equal(project(story, state, "run", 1).input!.kind, "distribution");
  assert.equal(field(state, "inventory.knife.count"), 1);
  assert.throws(() => advance(story, state, "distribute", () => 1, { "$player": 2, guide: 1, student: 1 }), /完整分配/);
  assert.throws(() => advance(story, state, "distribute", () => 1, { "$player": 1, guide: 1, stranger: 1 }), /完整分配/);
  const saved = JSON.parse(JSON.stringify(state));
  state = advance(story, saved, "distribute", () => { throw new Error("分配不能重掷物资"); }, { "$player": 1, guide: 2, student: 0 }).state;
  assert.equal(field(state, "inventory.rifle.count"), 1);
  assert.equal(field(state, "party.guide.inventory.rifle.count"), 2);
  assert.equal(field(state, "party.student.inventory.rifle.count"), 0);
  assert.equal(field(saved, "party.student.inventory.rifle.count"), 1);
});
test("party damage stays balanced or the player takes extra damage to protect a student", () => {
  const story = fixture([{ kind: "distribute", label: "分担伤害", resource: "damage", total: 6, recipients: ["$player", "guide", "student"], protected: ["student"] }]);
  const state = initialState(story, createCharacter("教授", story.presets[0], 85), () => 1);
  assert.throws(() => advance(story, state, "distribute", () => 1, { "$player": 1, guide: 4, student: 1 }), /平均/);
  assert.throws(() => advance(story, state, "distribute", () => 1, { "$player": 4, guide: 0, student: 2 }), /平均/);
  const balanced = advance(story, state, "distribute", () => 1, { "$player": 2, guide: 2, student: 2 }).state;
  assert.equal(balanced.character.hp, state.character.hp - 2);
  const protectedState = advance(story, state, "distribute", () => 1, { "$player": 3, guide: 2, student: 1 }).state;
  assert.equal(protectedState.character.hp, state.character.hp - 3);
  assert.equal(protectedState.party!.members[0].character.hp, state.party!.members[0].character.hp - 2);
  assert.equal(protectedState.party!.members[1].character.hp, state.party!.members[1].character.hp - 1);
  const fullyProtected = advance(story, state, "distribute", () => 1, { "$player": 4, guide: 2, student: 0 }).state;
  assert.equal(fullyProtected.character.hp, state.character.hp - 4);
  assert.equal(fullyProtected.party!.members[1].character.hp, state.party!.members[1].character.hp);
  assert.deepEqual(project(story, JSON.parse(JSON.stringify(protectedState)), "run", 1), project(story, protectedState, "run", 1));
});
test("quantity loss floors at zero and missing companions cannot receive allocated equipment", () => {
  const story = fixture([
    { kind: "effects", effects: [{ op: "item-count", key: "rifle", label: "步枪", action: "add", value: -3, member: "guide" }, { op: "party", member: "student", action: "status", value: "missing" }] },
    { kind: "distribute", label: "分配", resource: "item", total: 1, recipients: ["$player", "guide", "student"], key: "rifle", itemLabel: "步枪" },
  ]);
  const state = initialState(story, createCharacter("教授", story.presets[0], 85), () => 1);
  assert.equal(field(state, "party.guide.inventory.rifle.count"), 0);
  const input = project(story, state, "run", 0).input!;
  assert.equal(input.kind, "distribution");
  if (input.kind === "distribution") assert.deepEqual(input.entries.map(entry => entry.key), ["$player", "guide"]);
});
