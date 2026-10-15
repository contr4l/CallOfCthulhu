import type { StorySummary } from "../../../packages/contracts/index";

/** Explain the published creation policy without turning incomplete presets into saved cards. */
export function characterCreationDescription(story: StorySummary): string {
  if (story.creationPolicy === "guided") {
    if (story.rulesVersion === "aaf-solo@1")
      return "先为幸存者确定姓名。生命、理智、两项技能和起始装备将在剧情中确定。";
    if (story.id === "alone-against-frost")
      return "使用纳德尔曼博士的原书属性与幸运值，在剧情中分配职业与兴趣技能点。";
    if (story.id === "alone-against-tide")
      return "选择自建调查员或伍兹博士。属性、技能加值及幸运将在剧情中确定。";
    return "本模组会在剧情中引导你分配属性和技能；先确定姓名。";
  }
  if (story.creationPolicy === "fixed")
    return story.id === "alone-against-static"
      ? "选择亚历克斯或查理，两人的视角与故事分支不同。"
      : "选择一位调查员。";
  return "先为这段故事，选择一位调查员。";
}
