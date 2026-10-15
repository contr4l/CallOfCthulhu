import { createHash } from "node:crypto";
import type { FearDice, FearState, FearStory } from "../contracts/fear.js";
import type { FearDiceWindow } from "../contracts/fear-dice-window.js";
import type { ScopedFearDice } from "./fear-dice-scope.js";
import { advanceFear } from "./fear.js";

type KnottedState = FearState & { witchKnots?: { total: number; used: number } };
class NeedDie extends Error {
  constructor(readonly key: string, readonly min: number, readonly max: number) { super("Awaiting a source die"); }
}
class RiskEnded extends Error {}
export function canUseWitchKnots(state: FearState): boolean {
  const knots = (state as KnottedState).witchKnots;
  return !!state.inventory["witch-knots-cord"] && !!knots && Number.isSafeInteger(knots.total) && Number.isSafeInteger(knots.used) && knots.total > knots.used && knots.used >= 0;
}
function validateFace(face: number, min: number, max: number): void {
  if (!Number.isSafeInteger(face) || face < min || face >= max) throw Error("绳结事务收到非法骰面");
}
/** Replay only accepted, committed dice from the start of this one action.
 * Stop before returning an unaccepted face, so no consequence of that die is
 * applied yet. Old turns are never loaded or undone.
 */
export function evaluateFearDiceWindow(story: FearStory, window: FearDiceWindow): {
  state: FearState; completed: boolean; waiting?: FearDiceWindow["waiting"]; visibleKeys: string[];
} {
  let observed = structuredClone(window.before) as KnottedState;
  const counters = new Map<string, number>(), visibleKeys: string[] = [], appliedRisks = new Set<number>();
  const baseKnots = (window.before as KnottedState).witchKnots;
  const applyRisk = (key: string) => {
    for (const [index, risk] of window.risks.entries()) if (risk.key === key && !appliedRisks.has(index)) {
      validateFace(risk.face, 1, 7); appliedRisks.add(index);
      if (risk.face < risk.used) observed.sanity = Math.max(0, observed.sanity - 1);
    }
    if (baseKnots) observed.witchKnots = { total: baseKnots.total, used: baseKnots.used + window.risks.length };
    if (observed.sanity <= 0) { observed.status = "insane"; throw new RiskEnded(); }
  };
  const source = (path: string): ScopedFearDice => {
    const draw = ((min: number, max: number) => {
      // Explicit check/table/operation scopes identify intent across a changed
      // branch. The ordinal distinguishes individual dice inside one roll.
      const ordinal = counters.get(path) ?? 0; counters.set(path, ordinal + 1);
      const key = `${path}:${ordinal}`;
      visibleKeys.push(key);
      const recorded = window.draws.find(draw => draw.key === key);
      if (!recorded || !recorded.accepted) throw new NeedDie(key, min, max);
      applyRisk(key);
      if (recorded.min !== min || recorded.max !== max) throw Error("保存的骰子意图与来源规则不匹配");
      validateFace(recorded.value, min, max); return recorded.value;
    }) as ScopedFearDice;
    draw.observeState = state => { observed = state as KnottedState; };
    draw.scope = label => {
      const hash = createHash("sha256").update(label).digest("hex");
      const prefix = `${path}/${hash}`, index = counters.get(`scope:${prefix}`) ?? 0;
      counters.set(`scope:${prefix}`, index + 1); return source(`${prefix}.${index}`);
    };
    return draw;
  };
  let completed = false, waiting: FearDiceWindow["waiting"] | undefined;
  try { observed = advanceFear(story, window.before, window.action, source("action")) as KnottedState; completed = true; }
  catch (error) {
    if (error instanceof NeedDie) waiting = { key: error.key, min: error.min, max: error.max };
    else if (error instanceof RiskEnded) completed = true;
    else throw error;
  }
  // A reroll may remove a previous branch. Paid knots and their risk are never
  // refunded when the replaced branch's dice are no longer used.
  for (const [index, risk] of window.risks.entries()) if (!appliedRisks.has(index)
    && (completed || window.draws.find(draw => draw.key === risk.key)?.accepted)
    && risk.face < risk.used) observed.sanity = Math.max(0, observed.sanity - 1);
  if (baseKnots) observed.witchKnots = { total: baseKnots.total, used: baseKnots.used + window.risks.length };
  if (observed.sanity <= 0) { observed.status = "insane"; completed = true; waiting = undefined; }
  return { state: observed, completed, waiting, visibleKeys: [
    ...visibleKeys.filter(key => window.draws.some(draw => draw.key === key)),
    ...window.risks.map((_, index) => `risk:${index}`),
  ] };
}
export function drawFearWindowDie(window: FearDiceWindow, dice: FearDice): number {
  if (window.draws.some(draw => draw.key === window.waiting.key)) throw Error("当前骰子已掷出，应接受或使用绳结");
  const { key, min, max } = window.waiting, face = dice(min, max);
  validateFace(face, min, max); window.draws.push({ key, min, max, value: face, accepted: false }); return face;
}
export function acceptFearWindowDie(window: FearDiceWindow): void {
  const draw = window.draws.find(draw => draw.key === window.waiting.key);
  if (!draw || draw.accepted) throw Error("当前没有待接受的骰子");
  draw.accepted = true;
}
export function rerollFearWindowDie(window: FearDiceWindow, index: number, dice: FearDice): { face: number; risk: number } {
  if (!Number.isSafeInteger(index) || index < 0 || index >= window.visibleKeys.length) throw Error("只能重掷当前行动已经公开的骰子");
  const base = (window.before as KnottedState).witchKnots;
  const used = (base?.used ?? 0) + window.risks.length + 1;
  if (!base || used > base.total || !window.before.inventory["witch-knots-cord"]) throw Error("没有可用的女巫绳结");
  const selected = window.visibleKeys[index];
  const riskIndex = /^risk:\d+$/.test(selected) ? Number(selected.slice(5)) : undefined;
  const previousRisk = riskIndex === undefined ? undefined : window.risks[riskIndex];
  const key = previousRisk?.key ?? selected;
  const draw = window.draws.find(draw => draw.key === key);
  if (!draw) throw Error("保存的重掷目标不存在");
  const min = previousRisk ? 1 : draw.min, max = previousRisk ? 7 : draw.max;
  const face = dice(min, max), risk = dice(1, 7);
  validateFace(face, min, max); validateFace(risk, 1, 7);
  if (previousRisk) previousRisk.face = face;
  else draw.value = face;
  // Reconfirm the affected source die before applying either its consequence
  // or the knot risk. The printed 'one die' also includes the risk D6.
  if (window.visibleKeys.includes(key)) draw.accepted = false;
  else {
    const pending = window.draws.find(value => value.key === window.waiting.key);
    if (pending) pending.accepted = false;
  }
  window.risks.push({ key, face: risk, used });
  return { face, risk };
}
