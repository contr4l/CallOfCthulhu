import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { field } from "../packages/engine/program.js";
import { createCharacter } from "../packages/rules/index.js";
import type { Instruction } from "../packages/contracts/program.js";

function fixture(policy: "frost", steps: Instruction[], source = false) {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "health-fixture"; story.healthPolicy = policy; story.entry = "entry";
  const background = story.nodes[0].background;
  const ending = (id: string) => ({ id, title: id, chapter: id, text: [id], background, type: "program" as const, program: [{ kind: "end" as const, label: id, collect: false }] });
  story.nodes = [
    { id: "entry", title: "原节", chapter: "1", text: ["原节"], background, type: "program", program: steps, ...(source ? { healthRouting: { sanity: "source", injury: "source" } as const } : {}) },
    ...["191", "39", "364", "550"].map(ending),
    ...["frost-insanity-check", "frost-major-wound-check"].map(id => ({ id, title: id, chapter: id, text: [id], background, type: "program" as const, program: [
      { kind: "choices" as const, choices: [{ id: "resume", label: "继续", target: "$return" }] },
    ] })),
  ];
  return validateStory(story);
}
const finish: Instruction = { kind: "choices", choices: [{ id: "finish", label: "继续", target: "39" }] };
test("book-specific health destinations override general policy without a second interruption", () => {
  const story = fixture("frost", [{ kind: "effects", effects: [{ op: "set", field: "sanity", value: 0 }] }, finish], true);
  const state = initialState(story, createCharacter("教授", story.presets[0], 50), () => 1);
  assert.equal(state.character.sanity, 0); assert.equal(state.nodeId, "entry");
  assert.equal(state.program!.returns.length, 0);
});
test("Frost checks consciousness for each new major wound, not every later small hit", () => {
  const story = fixture("frost", [
    { kind: "effects", effects: [{ op: "add", field: "hp", value: -7 }] },
    { kind: "choices", choices: [{ id: "hit", label: "下一次伤害", effects: [{ op: "add", field: "hp", value: -1 }] }] }, finish,
  ]);
  const character = createCharacter("教授", { ...story.presets[0], hp: 14 }, 50);
  character.maxHp = 14; character.hp = 14;
  const state = initialState(story, character, () => 1);
  assert.equal(state.nodeId, "frost-major-wound-check");
  const awake = advance(story, state, "resume", () => 1).state;
  const hit = advance(story, awake, "next", () => 1).state;
  assert.equal(hit.flags.majorWound, true); assert.equal(hit.nodeId, "entry");
  assert.equal(hit.character.hp, 6); assert.equal(hit.program!.returns.length, 0);
});
test("Frost routes to §191 only when unconsciousness coincides with a major wound", () => {
  const continuation: Instruction = { kind: "choices", choices: [{ id: "continue", label: "继续", target: "39" }] };
  const cumulative = fixture("frost", [
    { kind: "effects", effects: [{ op: "add", field: "hp", value: -1 }] },
    { kind: "effects", effects: [{ op: "add", field: "hp", value: -1 }] },
    continuation,
  ]);
  const wornDown = createCharacter("累积小伤", { ...cumulative.presets[0], hp: 2 }, 50);
  wornDown.maxHp = 14; wornDown.hp = 2;
  const stillAtSource = initialState(cumulative, wornDown, () => 1);
  assert.equal(stillAtSource.character.hp, 0);
  assert.equal(stillAtSource.flags.unconscious, true);
  assert.equal(stillAtSource.flags.majorWound, undefined);
  assert.equal(stillAtSource.nodeId, "entry", "cumulative minor injuries do not trigger the printed major-wound-and-unconscious rule");
  assert.equal(project(cumulative, stillAtSource, "累积小伤", 0).actions.length, 1);

  const major = fixture("frost", [
    { kind: "effects", effects: [{ op: "add", field: "hp", value: -7 }] },
    continuation,
  ]);
  const knockedOut = createCharacter("重伤昏迷", { ...major.presets[0], hp: 7 }, 50);
  knockedOut.maxHp = 14; knockedOut.hp = 7;
  const recoveredTo191 = initialState(major, knockedOut, () => 1);
  assert.equal(recoveredTo191.flags.majorWound, true);
  assert.equal(recoveredTo191.flags.unconscious, true);
  assert.equal(recoveredTo191.nodeId, "191", "a single major injury that reduces HP to zero reaches the printed recovery entry");
});
test("current Frost indefinite condition is distinct from its historical marker and survives reload", () => {
  const story = fixture("frost", [{ kind: "effects", effects: [{ op: "add", field: "sanity", value: -14 }] }, finish]);
  const state = initialState(story, createCharacter("教授", story.presets[0], 50), () => 1);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(restored.nodeId, "364");
  assert.equal(field(restored, "sanity.indefinite"), 1);
  assert.equal(field(restored, "sanity.dayInitial"), story.presets[0].sanity);
  assert.equal(field(restored, "sanity.dayLost"), 14);
  assert.equal(field(restored, "sanity.lastLoss"), 14);
  assert.equal(restored.flags.indefinite, undefined);
});
test("source-specific sanity route still records current condition without adding a second route", () => {
  const story = fixture("frost", [{ kind: "effects", effects: [{ op: "set", field: "sanity", value: 0 }] }, finish], true);
  const state = initialState(story, createCharacter("教授", story.presets[0], 50), () => 1);
  assert.equal(field(state, "sanity.permanent"), 1);
  assert.equal(state.nodeId, "entry");
});
test("an authored recovery changes only the current mental condition, preserving historical insanity", () => {
  const story = fixture("frost", [{ kind: "effects", effects: [
    { op: "flag", key: "indefinite", value: true },
    { op: "sanityCondition", value: "temporary" },
    { op: "sanityCondition", value: "controlled" },
    { op: "sanityBaseline" },
  ] }, finish]);
  const state = initialState(story, createCharacter("教授", story.presets[0], 50), () => 1);
  assert.equal(field(state, "sanity.controlled"), 1);
  assert.equal(field(state, "sanity.temporary"), 0);
  assert.equal(state.flags.indefinite, true);
});
test("source injury routing preserves new major wounds and unconsciousness for chapter-specific decisions", () => {
  const story = fixture("frost", [{ kind: "effects", effects: [{ op: "add", field: "hp", value: -14 }] }, finish], true);
  const character = createCharacter("教授", { ...story.presets[0], hp: 14 }, 50);
  const state = initialState(story, character, () => 1);
  assert.equal(state.nodeId, "entry");
  assert.equal(state.flags.majorWound, true);
  assert.equal(state.flags.unconscious, true);
  assert.equal(state.program!.returns.length, 0);
});
