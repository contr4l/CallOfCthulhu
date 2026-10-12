import assert from "node:assert/strict";
import { test } from "node:test";
import {
  explainRoll,
  explainContest,
} from "../apps/web/src/check-explanation.js";
import { resolveCheck } from "../packages/rules/index.js";
import type { CheckResult, Character } from "../packages/contracts/index.js";
const actor: Character = {
  name: "解释验收",
  occupation: "",
  hp: 10,
  maxHp: 10,
  sanity: 50,
  luck: 50,
  skills: { spotHidden: 20 },
};
function roll(
  value: number,
  base = 20,
  difficulty: "regular" | "hard" | "extreme" = "regular",
) {
  const digits = [
    value === 100 ? 0 : value % 10,
    value === 100 ? 0 : Math.floor(value / 10),
  ];
  return resolveCheck(
    { ...actor, skills: { spotHidden: base } },
    {
      skill: "spotHidden",
      label: "侦查",
      difficulty,
      success: "",
      failure: "",
    },
    () => digits.shift()!,
  );
}
test("D100 explanations use the actual target and include equality and special roll exceptions", () => {
  assert.deepEqual(explainRoll(roll(38)), {
    comparison: "目标 20，38 > 20",
    label: "失败",
    passed: false,
    reason: "",
  });
  assert.equal(explainRoll(roll(20)).comparison, "目标 20，20 ≤ 20");
  assert.equal(explainRoll(roll(20)).passed, true);
  assert.equal(explainRoll(roll(100)).label, "大失败");
  assert.equal(explainRoll(roll(100)).comparison, "目标 20，100");
  assert.match(explainRoll(roll(100)).reason, /100/);
  assert.equal(explainRoll(roll(1, 0)).passed, true);
  assert.equal(explainRoll(roll(1, 0)).label, "大成功");
});
test("failure ranges and difficulty explanations follow server grades, not a guessed base from target", () => {
  assert.equal(explainRoll(roll(96, 20)).label, "大失败");
  const hard = roll(96, 100, "extreme");
  assert.equal(hard.target, 20);
  assert.equal(explainRoll(hard).label, "失败");
  const tooLowGrade = explainRoll(roll(30, 100, "extreme"));
  assert.equal(tooLowGrade.label, "失败");
  assert.match(tooLowGrade.reason, /困难成功等级/);
});
test("a passed roll can lose an opposed check or counterattack, without reversing its roll explanation", () => {
  const result: CheckResult = {
    ...roll(15),
    success: false,
    opponent: { roll: 10, target: 60, grade: "extreme" },
  };
  assert.equal(explainRoll(result).passed, true);
  assert.match(explainContest(result), /等级低于对手.*未能赢得对抗/);
  const tie: CheckResult = {
    ...roll(15),
    opponent: { roll: 40, target: 50, grade: "regular" },
    combat: {
      action: "反击",
      result: "hurt",
      enemyName: "对手",
      round: 1,
      damage: 2,
      recipient: "player",
    },
  };
  assert.match(explainContest(tie), /反击必须超过攻击方/);
  assert.equal(explainRoll(tie).passed, true);
});
