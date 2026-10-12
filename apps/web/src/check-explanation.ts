import type { CheckResult } from "../../../packages/contracts/index";
export const checkGrades = {
  critical: "大成功",
  extreme: "极难成功",
  hard: "困难成功",
  regular: "成功",
  failure: "失败",
  fumble: "大失败",
};
type Roll = Pick<CheckResult, "target" | "roll" | "grade">;
export function explainRoll(result: Roll) {
  const special = result.grade === "critical" || result.grade === "fumble";
  const passed =
    !["failure", "fumble"].includes(result.grade) &&
    (result.roll === 1 || result.roll <= result.target);
  const comparison = special
    ? `目标 ${result.target}，${result.roll}`
    : `目标 ${result.target}，${result.roll} ${result.roll <= result.target ? "≤" : ">"} ${result.target}`;
  const label = special
    ? checkGrades[result.grade]
    : passed
      ? checkGrades[result.grade]
      : "失败";
  let reason = "";
  if (result.grade === "critical")
    reason =
      result.roll === 1 ? "掷出 1，按大成功判定。" : "本次按大成功判定。";
  if (result.grade === "fumble")
    reason =
      result.roll === 100
        ? "掷出 100，按大失败判定。"
        : `骰点 ${result.roll} 命中本次大失败范围。`;
  if (!special && !passed && result.grade !== "failure")
    reason = `虽达到${checkGrades[result.grade]}等级，骰点仍超过本次目标，未通过这次检定。`;
  return { comparison, label, passed, reason };
}
const ranks = {
  critical: 4,
  extreme: 3,
  hard: 2,
  regular: 1,
  failure: 0,
  fumble: 0,
};
export function explainContest(result: CheckResult): string {
  if (!result.opponent) return "";
  const own = ranks[result.grade],
    other = ranks[result.opponent.grade];
  if (result.combat) {
    if (!own && !other) return "双方均未取得成功等级，本轮没有命中。";
    if (own > other) return "你的成功等级高于对手，赢得本轮对抗。";
    if (own < other)
      return "对手的成功等级更高，本轮胜负以双方成功等级比较为准。";
    const { action, result: outcome } = result.combat;
    if (action === "反击" && outcome === "hurt")
      return "双方成功等级相同；反击必须超过攻击方，因此对手命中了你。";
    if (action === "闪避" && outcome === "dodged")
      return "双方成功等级相同；闪避在平局时成功，因此你避开了攻击。";
    if (action === "攻击" && outcome === "hit")
      return "双方成功等级相同；攻击与反击平局时攻击方胜出，因此你命中了对手。";
    if (action === "攻击" && outcome === "miss")
      return "双方成功等级相同；对手的闪避在平局时成功，因此本次攻击没有命中。";
    return "双方成功等级相同，最终结果按本轮对抗规则判定。";
  }
  if (result.grade === "fumble") return "你掷出了大失败，未能赢得对抗。";
  const comparison =
    own > other
      ? "你的成功等级高于对手"
      : own < other
        ? "你的成功等级低于对手"
        : own
          ? "双方成功等级相同，本次按能力值决定胜负"
          : "双方均未取得成功等级，本次按能力值决定胜负";
  return `${comparison}；${result.success ? "你赢得对抗" : "你未能赢得对抗"}。`;
}
