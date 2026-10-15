import type { CombatSpec, Predicate, Value, ProgramChoice } from "./program.js";
import type { FrostCombatEnemy } from "./frost-combat.js";

/** Reviewed source parameters for the shared Frost party-combat state machine. */
export type FrostProgramCombatSpec = {
  sourceSection: string;
  participants: { id: string; condition?: Predicate }[];
  enemies: (Omit<FrostCombatEnemy, "hp" | "maxHp"> & {
    hp: Value; maxHp: Value; attackSkill: string; damage: string; impaling?: boolean;
    count?: Value;
  })[];
  partyTurnOrder: string[];
  enemyTurnOrder: string[];
  initiative: "party-first" | "enemy-first";
  weapons: (NonNullable<CombatSpec["weapons"]>[number] & { fumbleTarget?: string })[];
  protectedStudents?: string[];
  /** Source fights may end once a printed number of distinct enemies have been hit. */
  victoryHitThreshold?: Value;
  fatalCompanions?: string[];
  reviveCompanionsIfInvestigatorSurvives?: boolean;
  win: string;
  lose: string;
  flee?: string;
  options?: ProgramChoice[];
  roundCalls?: { afterRound: number; call: string }[];
  routes?: { condition: Predicate; target: string }[];
};
