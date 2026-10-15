import type { Character, CheckResult } from "./index.js";

/** Source-facing copy of a combatant. The caller supplies saved character state. */
export type FrostCombatant = {
  id: string;
  character: Character;
  kind: "investigator" | "companion";
  status: "present" | "absent" | "missing" | "dead";
  unconscious: boolean;
  /** False until a source gate has recruited this companion into the encounter. */
  active?: boolean;
  /** Set only when the current printed section explicitly permits this death. */
  fatalOnZero?: boolean;
};

export type FrostCombatEnemy = {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  armor?: number;
  /** Stop at or below this HP when the source makes the enemy flee. */
  stopAtHp?: number;
  /** Party-wide attacks are split evenly by default; some sources damage only the target. */
  damageMode?: "target" | "party";
  /** Skills that this source fight permits this enemy to use. */
  skills: Record<string, number>;
  /** Optional ordered target preference, e.g. Bernard then Nadelmann. */
  targetOrder?: string[];
};

export type FrostPartyCombatSpec = {
  sourceSection: string;
  /** One party action per listed actor, in the source-reviewed order. */
  partyTurnOrder: string[];
  /** Enemy sequence, in the source-reviewed order. */
  enemyTurnOrder: string[];
  /** Encounter-specific opening side, recorded from the printed source. */
  initiative?: "party-first" | "enemy-first";
  enemies: FrostCombatEnemy[];
  /** Student IDs protected by the equal-share floor. */
  protectedStudents?: string[];
  /** End the encounter after this many distinct enemies have taken damage. */
  victoryHitThreshold?: number;
  /** Wake unconscious survivors after victory when the investigator survived. */
  reviveCompanionsIfInvestigatorSurvives?: boolean;
  /** Rules can make selected companions fatal in this encounter. */
  fatalCompanions?: string[];
  allowFlee?: boolean;
};

export type FrostCombatEvent = {
  round: number;
  side: "party" | "enemy";
  actorId: string;
  targetId: string;
  action: "attack" | "flee";
  check?: CheckResult;
  rolledDamage?: number;
  appliedDamage?: number;
  damageDistribution?: Record<string, number>;
};

export type FrostPartyCombatState = {
  sourceSection: string;
  round: number;
  phase: "party" | "enemy" | "finished";
  outcome?: "victory" | "defeat" | "fled";
  partyCursor: number;
  enemyCursor: number;
  party: FrostCombatant[];
  enemies: FrostCombatEnemy[];
  events: FrostCombatEvent[];
  pendingEnemyAttack?: { enemyId: string; targetId: string; check: CheckResult; damage: number; damageMode: "target" | "party"; alreadyAdvanced?: boolean };
};

export type FrostCombatProjection = {
  sourceSection: string;
  round: number;
  phase: FrostPartyCombatState["phase"];
  outcome?: FrostPartyCombatState["outcome"];
  currentActorId?: string;
  currentEnemyId?: string;
  currentEnemyTargetId?: string;
  availableActions: { id: "attack" | "flee"; label: string }[];
  enemies: { id: string; name: string; hp: number; maxHp: number }[];
  party: { id: string; name: string; hp: number; maxHp: number; status: string; active: boolean; unconscious: boolean }[];
  /** For enemy damage, the default is equal sharing; input may shift extra to Nadelmann. */
  damageInput?: { total: number; recipients: string[]; minimumPerMember: number; minimumByMember: Record<string, number>; defaultShares: Record<string, number>; playerExtraMax: number };
};

export type FrostPartyAction = {
  actorId: string;
  action: "attack" | "flee";
  targetId?: string;
  /** Already produced and persisted by the shared rules/check engine. */
  check?: CheckResult;
  /** Already rolled from the selected source weapon and recorded by the caller. */
  damage?: number;
};

export type FrostEnemyAction = {
  enemyId: string;
  targetId: string;
  /** Already produced and persisted by the shared rules/check engine. */
  check: CheckResult;
  /** Already rolled from the source enemy attack and recorded by the caller. */
  damage: number;
};

