import test from "node:test";
import assert from "node:assert/strict";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import { value } from "../packages/engine/program.js";
import type { Instruction, Value } from "../packages/contracts/program.js";

function scenario(operations: Instruction[]) {
  const story = structuredClone(
    loadStories("stories").get("alone-against-static@1.2.0")!,
  );
  story.id = "arithmetic-fixture";
  delete story.healthPolicy;
  story.entry = "entry";
  story.nodes = [
    {
      id: "entry",
      title: "规则输入",
      chapter: "1",
      text: ["规则骰及自动登记"],
      type: "program",
      background: story.nodes[0].background,
      program: [...operations, { kind: "end", label: "结束", collect: false }],
    },
  ];
  return validateStory(story);
}

test("data arithmetic applies D6 damage, companion HP clamps and calendar hours without extra rolls", () => {
  const story = scenario([
    {
      kind: "rollEffects",
      label: "攻击骰",
      effects: [
        { op: "set", field: "counter.attack", value: "1D6" },
        {
          op: "set",
          field: "counter.damage",
          value: {
            calc: "product",
            values: [
              {
                calc: "quotient",
                values: [
                  { calc: "sum", values: [{ field: "counter.attack" }, 2] },
                  3,
                ],
              },
              2,
            ],
          },
        },
        {
          op: "set",
          field: "counter.companionHp",
          value: {
            calc: "max",
            values: [
              0,
              { calc: "difference", values: [3, { field: "counter.damage" }] },
            ],
          },
        },
        {
          op: "set",
          field: "counter.hour",
          value: { calc: "mod", values: [49, 24] },
        },
        {
          op: "set",
          field: "counter.day",
          value: { calc: "quotient", values: [49, 24] },
        },
      ],
    },
  ]);
  let draws = 0;
  const initial = initialState(
    story,
    createCharacter("验收", story.presets[0], 50),
    () => 1,
  );
  const command = advance(story, initial, "next", (min, max) => {
    assert.equal(min, 1);
    assert.equal(max, 7);
    draws++;
    return 4;
  });
  assert.equal(draws, 1);
  assert.deepEqual(command.state.program!.counters, {
    combatActions: 0,
    attack: 4,
    damage: 4,
    companionHp: 0,
    hour: 1,
    day: 2,
  });
  assert.equal(command.dice!.total, 4);
  assert.equal(command.state.status, "ended");
  assert.equal(initial.program!.counters.attack, undefined);
  const recovered = JSON.parse(JSON.stringify(command.state));
  assert.deepEqual(
    project(story, recovered, "run", 1),
    project(story, command.state, "run", 1),
  );
});

test("arithmetic rejects division by zero, malformed operations and excessive nesting", () => {
  const story = scenario([]);
  const state = initialState(
    story,
    createCharacter("验收", story.presets[0], 50),
    () => 1,
  );
  assert.throws(
    () => value(state, { calc: "quotient", values: [1, 0] }),
    /除以零/,
  );
  assert.throws(
    () =>
      scenario([
        {
          kind: "effects",
          effects: [
            {
              op: "set",
              field: "counter.bad",
              value: { calc: "mod", values: [1] },
            },
          ],
        },
      ]),
    /二元/,
  );
  let expression: Value = 1;
  for (let i = 0; i < 34; i++)
    expression = { calc: "sum", values: [expression, 1] };
  assert.throws(() => value(state, expression), /嵌套过深/);
  assert.equal(
    value(state, { field: "sanity", factor: 0.2, offset: 1 }),
    Math.floor(state.character.sanity * 0.2 + 1),
  );
});

test("point allocation enforces allowed skills and a configured final skill minimum", () => {
  const skills = { anthropology: 1, history: 5, libraryUse: 20, naturalWorld: 10,
    languageOther: 1, languageOwn: 90, psychology: 10, persuade: 10 };
  const story = scenario([{ kind: "allocation", allocation: {
    kind: "bonus", pool: 360, allowedSkills: Object.keys(skills),
    minimums: { anthropology: 75 }, occupation: "人类学教授",
    specializations: { languageOther: { label: "外语" } },
  } }]);
  const initial = initialState(story, createCharacter("纳德尔曼", {
    ...story.presets[0], skills: { ...skills, creditRating: 64 },
  }, 85), () => 1);
  const input = { anthropology: 74, history: 85, libraryUse: 79, naturalWorld: 50,
    languageOther: 29, psychology: 35, persuade: 8, languageOwn: 0, "specialty.languageOther": "法语" };
  assert.throws(() => advance(story, initial, "allocate", () => 1, {
    ...input, anthropology: 73, history: 86,
  }), /至少达到 75/);
  assert.throws(() => advance(story, initial, "allocate", () => 1, {
    ...input, creditRating: 1, history: 84,
  }), /不能分配此技能/);
  const final = advance(story, initial, "allocate", () => 1, input).state;
  assert.equal(final.character.skills.anthropology, 75);
  assert.equal(final.character.skills.creditRating, 64);
  assert.equal(final.character.specializations!.languageOther, "法语");
  assert.equal(final.character.occupation, "人类学教授");
  assert.equal(final.character.luck, 85);
  assert.deepEqual(final.program!.occupationSkills, Object.keys(skills));
  assert.equal(initial.character.skills.anthropology, 1);
});

test("Fear D6 programs use recorded D6 outcomes and reject CoC checks", () => {
  const story = scenario([{ kind: "rollEffects", label: "D6 判定", effects: [
    { op: "set", field: "counter.result", value: "1D6" },
  ] }]);
  story.rulesVersion = "aaf-solo@1";
  validateStory(story);
  const state = initialState(story, createCharacter("幸存者", story.presets[0], 0), () => 1);
  assert.ok(state.program);
  const result = advance(story, state, "next", (min, max) => {
    assert.equal(min, 1); assert.equal(max, 7); return 5;
  });
  assert.equal(result.state.program!.counters.result, 5);
  assert.equal(result.dice!.groups[0].sides, 6);
  assert.equal(result.check, undefined);
  story.nodes[0].program!.unshift({ kind: "check", check: {
    skill: "luck", label: "错误 D100", success: "entry", failure: "entry",
  } });
  assert.throws(() => validateStory(story), /不能执行 CoC/);
});

test("Fear maximum Life and Sanity changes persist and bound subsequent healing", () => {
  const story = scenario([{ kind: "effects", effects: [
    { op: "set", field: "maxHp", value: 8 }, { op: "set", field: "hp", value: 8 },
    { op: "set", field: "maxSanity", value: 8 }, { op: "set", field: "sanity", value: 8 },
    { op: "add", field: "maxHp", value: 2 }, { op: "add", field: "hp", value: 2 },
    { op: "add", field: "maxSanity", value: -1 }, { op: "add", field: "sanity", value: 10 },
  ] }]);
  story.rulesVersion = "aaf-solo@1";
  const state = initialState(validateStory(story), createCharacter("幸存者", story.presets[0], 0), () => 1);
  assert.equal(state.character.maxHp, 10);
  assert.equal(state.character.hp, 10);
  assert.equal(state.character.maxSanity, 7);
  assert.equal(state.character.sanity, 7);
  assert.equal(JSON.parse(JSON.stringify(state)).character.maxSanity, 7);
});

test("nested rule tables return to the saved caller after restart without repeating their rolls", () => {
  const story = scenario([]);
  story.nodes[0].program = [
    { kind: "call", target: "table" },
    { kind: "rollEffects", label: "回到调用章节", effects: [{ op: "add", field: "counter.returned", value: 1 }] },
    { kind: "end", label: "结束", collect: false },
  ];
  const original = story.nodes[0];
  story.nodes.push({ ...original, id: "table", program: [
    { kind: "call", target: "inner" }, { kind: "route", target: "$return" },
  ] }, { ...original, id: "inner", program: [
    { kind: "rollEffects", label: "事件表 D6", effects: [{ op: "set", field: "counter.tableDie", value: "1D6" }] },
    { kind: "route", target: "$return" },
  ] });
  validateStory(story);
  const initial = initialState(story, createCharacter("验收", story.presets[0], 50), () => 1);
  assert.equal(initial.nodeId, "inner");
  assert.equal(initial.program!.returns.length, 2);
  const initialParentVisit = initial.program!.returns[0].visitId;
  const saved = JSON.parse(JSON.stringify(initial));
  let draws = 0;
  const result = advance(story, saved, "next", (min, max) => {
    assert.equal(min, 1); assert.equal(max, 7); draws++; return 4;
  });
  assert.equal(draws, 1);
  assert.equal(result.state.nodeId, "entry");
  assert.equal(result.state.visitId, initialParentVisit);
  assert.equal(result.state.program!.returns.length, 0);
  assert.equal(result.state.program!.counters.tableDie, 4);
  const completed = advance(story, result.state, "next", () => { throw Error("不应重新掷骰"); });
  assert.equal(completed.state.program!.counters.returned, 1);
  assert.equal(completed.state.program!.counters.tableDie, 4);
  assert.equal(completed.state.status, "ended");
});
