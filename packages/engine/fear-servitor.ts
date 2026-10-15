/** Summon Servitor, source section-arcane-skills:p21–24 (PDF pp.18–19).
 * Checks are resolved by the existing D6 engine. These pure transitions apply
 * only printed costs and outcomes; they never ask a KP to choose an outcome.
 */
export type FearServitor = { level: 2 | 4 | 6; life: number; maxLife: number; attackBonus: number; defenseBonus: number };
export type ServitorRitual = { level: 2 | 4 | 6; stage: "magic" | "control" };
export type ServitorResources = { life: number; sanity: number; candles: number; elapsedTime: number };
export type ServitorState = ServitorResources & { servitor?: FearServitor; ritual?: ServitorRitual };
export type ServitorLearning = {
  xp: number; occultist: 0 | 1 | 2; readNecronomicon: boolean;
  readOccultGuide: boolean; readDiabolicalDeal: boolean;
};
export function canLearnServitor(input: ServitorLearning): boolean {
  return input.xp >= 2 && (input.readNecronomicon || input.readOccultGuide && input.occultist === 2 || input.readDiabolicalDeal && input.occultist >= 1);
}
export function canStartServitor(input: {
  state: ServitorState; learned: boolean; hasBell: boolean; hasRitualDagger: boolean;
  pentagramActive: boolean; sacrifice: "candles" | "life";
}): boolean {
  const s = input.state;
  return input.learned && input.hasBell && input.hasRitualDagger && !input.pentagramActive &&
    s.life > 0 && s.sanity > 0 && !s.ritual && !s.servitor &&
    (input.sacrifice === "candles" ? s.candles >= 5 : s.life >= 2);
}
export function startServitorRitual(input: Parameters<typeof canStartServitor>[0] & { level: 2 | 4 | 6 }): ServitorState {
  if (![2, 4, 6].includes(input.level) || !canStartServitor(input)) throw Error("当前不能执行召唤仆从仪式");
  const next = structuredClone(input.state);
  if (input.sacrifice === "candles") next.candles -= 5;
  else next.life -= 2;
  next.elapsedTime += 1;
  // Death from the printed sacrifice is handled by the ordinary health policy.
  if (next.life > 0) next.ritual = { level: input.level, stage: "magic" };
  return next;
}
export function servitorRitualCheck(state: ServitorState, skillLevel: 0 | 1 | 2): { kind: "magic" | "will"; level: number; bonus: number } {
  if (!state.ritual) throw Error("没有待执行的召唤检定");
  return { kind: state.ritual.stage === "magic" ? "magic" : "will", level: state.ritual.level, bonus: skillLevel };
}
export function resolveServitorMagic(state: ServitorState, succeeded: boolean): ServitorState {
  if (state.ritual?.stage !== "magic") throw Error("当前没有待执行的召唤魔法检定");
  const next = structuredClone(state);
  if (succeeded) next.ritual!.stage = "control";
  else { next.sanity = Math.max(0, next.sanity - 1); delete next.ritual; }
  return next;
}
export function resolveServitorControl(state: ServitorState, succeeded: boolean): {
  state: ServitorState;
  hostile?: { level: number; life: number; damage: 1; cannotEscape: true };
} {
  if (state.ritual?.stage !== "control") throw Error("当前没有待执行的仆从控制检定");
  const next = structuredClone(state), level = next.ritual!.level;
  delete next.ritual;
  if (!succeeded) return { state: next, hostile: { level, life: level, damage: 1, cannotEscape: true } };
  next.servitor = { level, life: level, maxLife: level, attackBonus: level / 2, defenseBonus: level / 2 };
  return { state: next };
}
/** One foe attacks the servitor; multiple foes split their attacks evenly.
 * The odd remaining attack also targets the servitor, a legal even split.
 */
export function servitorAttackRecipients(enemyCount: number, active: boolean): Array<"player" | "servitor"> {
  if (!Number.isSafeInteger(enemyCount) || enemyCount < 0) throw Error("敌人数必须为非负整数");
  return Array.from({ length: enemyCount }, (_, i) => active && i % 2 === 0 ? "servitor" : "player");
}
export function damageServitor(state: ServitorState, damage: number): ServitorState {
  if (!state.servitor || !Number.isSafeInteger(damage) || damage < 0) throw Error("无效仆从伤害");
  const next = structuredClone(state);
  next.servitor!.life = Math.max(0, next.servitor!.life - damage);
  if (next.servitor!.life === 0) delete next.servitor;
  return next;
}
export function dismissServitor(state: ServitorState): ServitorState {
  const next = structuredClone(state);
  delete next.servitor;
  return next;
}
