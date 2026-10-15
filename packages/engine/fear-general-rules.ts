/** Small source-bound helpers for general Alone Against Fear rules.
 * The main turn loop owns timing, dice requests, and persistence; these helpers
 * only validate and resolve the printed rule effects.
 */

export type FirstAidContext = {
  hasKit: boolean;
  charges: number;
  lifeLostThisEncounter: number;
  currentLife: number;
  maxLife: number;
  medicLevel: 0 | 1 | 2;
};

export type FirstAidResolution = { heal: number; chargesSpent: number };

export function firstAidHealLimit(context: FirstAidContext): number {
  if (!context.hasKit || context.charges <= 0 || context.lifeLostThisEncounter <= 0) return 0;
  const medicLimit = context.medicLevel >= 2 ? 4 : context.medicLevel === 1 ? 3 : 1;
  return Math.max(0, Math.min(medicLimit, context.charges, context.maxLife - context.currentLife));
}

export function resolveFirstAid(context: FirstAidContext, points: number): FirstAidResolution {
  const limit = firstAidHealLimit(context);
  if (!Number.isInteger(points) || points < 1 || points > limit) throw new Error("First aid points exceed this encounter's source limit");
  return { heal: points, chargesSpent: points };
}

export type GarlicContext = { heads: number; surprised: boolean; firstFace: number; rollTotal: number; vampireLevel: number };
export type GarlicResolution = { avoided: boolean; headsSpent: 0 | 1 };

/** Main resolves the common D6 check (including the game's general exploding-six rule) before calling this helper. */
export function resolveGarlicAvoidance(context: GarlicContext): GarlicResolution {
  if (!Number.isFinite(context.vampireLevel) || context.vampireLevel < 1) throw new Error("Vampire level must be positive");
  if (!Number.isInteger(context.firstFace) || context.firstFace < 1 || context.firstFace > 6) throw new Error("Garlic check first face must be D6");
  if (!Number.isInteger(context.rollTotal) || context.rollTotal < 1) throw new Error("Garlic check total must be a positive integer");
  if (context.surprised || context.heads < 1) return { avoided: false, headsSpent: 0 };
  const avoided = context.firstFace === 6 || (context.firstFace !== 1 && context.rollTotal >= context.vampireLevel);
  return { avoided, headsSpent: 1 };
}

export type OccupiedBoxEncounter = { enemyId: string; snapshot: unknown };
export type OccupiedBoxRevisit =
  | { kind: "empty" }
  | { kind: "stealth-check"; encounter: OccupiedBoxEncounter }
  | { kind: "avoid-this-entry"; encounter: OccupiedBoxEncounter }
  | { kind: "resume-encounter"; encounter: OccupiedBoxEncounter };

export function occupiedBoxOnFlee(enemyId: string, combatSnapshot: unknown): OccupiedBoxEncounter {
  if (!enemyId) throw new Error("An occupied box needs the encounter identity");
  return { enemyId, snapshot: structuredClone(combatSnapshot) };
}

export function resolveOccupiedBoxRevisit(encounter: OccupiedBoxEncounter | undefined, stealthSuccess: boolean | undefined): OccupiedBoxRevisit {
  if (!encounter) return { kind: "empty" };
  if (stealthSuccess === undefined) return { kind: "stealth-check", encounter };
  return stealthSuccess ? { kind: "avoid-this-entry", encounter } : { kind: "resume-encounter", encounter };
}

export function restoreBetweenMissions<T extends { hp: number; maxHp: number; sanity: number; maxSanity: number }>(state: T): T {
  return { ...state, hp: state.maxHp, sanity: state.maxSanity };
}

export type DodgePenaltyContext = { defenseRoll: number; dodgeLevel: 0 | 1 | 2; defenseSource: "dodge" | "agile" | "other" };

export function dodgePenaltyAfterDefense(context: DodgePenaltyContext): -1 | 0 {
  return context.defenseRoll === 1 && context.dodgeLevel > 0 && context.defenseSource === "dodge" ? -1 : 0;
}

export function consumeDodgePenalty(pendingPenalty: number | undefined): { penalty: number; remaining?: number } {
  const penalty = pendingPenalty === -1 ? -1 : 0;
  return { penalty };
}
