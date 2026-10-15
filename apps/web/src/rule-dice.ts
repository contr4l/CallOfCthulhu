import type { RuleDiceResult } from "../../../packages/contracts/index";

/** Independent encounter/food/defence rolls must not look like one summed check. */
export function ruleDiceDescription(dice: RuleDiceResult): string {
  if (dice.aggregate === false)
    return dice.groups.map(group => `D${group.sides}：${group.results.join("、")}`).join("；");
  const faces = dice.groups.flatMap(group => group.results).join(" + ");
  return dice.multiplier === 1 ? `${faces} = ${dice.total}` : `${faces}；${dice.total} × ${dice.multiplier} = ${dice.value}`;
}
