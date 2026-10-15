import type { RunState } from "../contracts/index.js";
import type { Instruction, SceneInput } from "../contracts/program.js";
import { companion, changeCompanionHp } from "./party.js";
import { itemCount, setItemCount } from "./inventory.js";
type Distribution = Extract<Instruction, { kind: "distribute" }>;

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
export function distributionInput(state: RunState, instruction: Distribution, total: number): Extract<SceneInput, { kind: "distribution" }> {
  if (!Number.isSafeInteger(total) || total < 0) invalid("分配总量须为非负整数");
  const entries = instruction.recipients.filter(id => id === "$player" || companion(state, id).status === "present").map(id => ({
    key: id, label: id === "$player" ? state.character.name : companion(state, id).character.name,
    value: instruction.resource === "damage" ? (id === "$player" ? state.character.hp : companion(state, id).character.hp) : itemCount(state, instruction.key!, id),
  }));
  if (!entries.length) invalid("没有可参与分配的角色");
  return { kind: "distribution", label: instruction.label, resource: instruction.resource, total, entries,
    ...(instruction.protected ? { protected: instruction.protected.filter(id => entries.some(entry => entry.key === id)) } : {}) };
}
export function distribute(state: RunState, instruction: Distribution, total: number, values: Record<string, number | string>) {
  const input = distributionInput(state, instruction, total);
  const keys = input.entries.map(entry => entry.key);
  if (Object.keys(values).length !== keys.length || keys.some(key => !Object.hasOwn(values, key)) ||
    Object.values(values).some(value => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) ||
    Object.values(values).reduce<number>((sum, value) => sum + Number(value), 0) !== total)
    invalid(`请完整分配 ${total} 点，数值必须为非负整数`);
  if (instruction.resource === "damage") {
    const amounts = keys.map(key => Number(values[key]));
    if (Math.max(...amounts) - Math.min(...amounts) > 1) {
      const protectedIds = instruction.protected ?? [];
      const base = Math.floor(total / keys.length), upper = Math.ceil(total / keys.length);
      const protectedAmounts = keys.filter(key => protectedIds.includes(key)).map(key => Number(values[key]));
      const unprotectedAmounts = keys.filter(key => key !== "$player" && !protectedIds.includes(key)).map(key => Number(values[key]));
      if (!protectedIds.length || !keys.includes("$player") || Number(values.$player) < upper ||
        (protectedAmounts.length > 1 && Math.max(...protectedAmounts) - Math.min(...protectedAmounts) > 1) ||
        (unprotectedAmounts.length > 1 && Math.max(...unprotectedAmounts) - Math.min(...unprotectedAmounts) > 1) ||
        keys.some(key => key !== "$player" && (Number(values[key]) > upper || (!protectedIds.includes(key) && Number(values[key]) < base))))
        invalid("伤害应尽可能平均，主角可以额外承受伤害以保护指定同伴");
    }
    for (const key of keys) {
      if (key === "$player") {
        state.character.hp = Math.max(0, state.character.hp - Number(values[key]));
        state.program!.counters.lastDamage = Number(values[key]);
      } else changeCompanionHp(state, key, -Number(values[key]));
    }
  } else {
    if (!instruction.key || !instruction.itemLabel) invalid("物品分配缺少类型");
    for (const key of keys) setItemCount(state, instruction.key, instruction.itemLabel, Number(values[key]), key);
  }
}
