import type { FrostProgramCombatSpec } from "./frost.js";
import type { FrostPartyCombatState } from "./frost-combat.js";
/** Data-only instructions used by published solo modules. No script evaluation. */
export type Value =
  | number
  | { field: string; factor?: number; offset?: number }
  | {
      calc:
        "sum" | "product" | "difference" | "quotient" | "min" | "max" | "mod";
      values: Value[];
    };
export type Predicate =
  | { note: string; equals: string; caseInsensitive?: boolean }
  | { investigatorId: string }
  | { flag: string; equals: boolean }
  | { templateId: string }
  | { item: string; has: boolean }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { field: string; op: "eq" | "lt" | "lte" | "gt" | "gte"; value: Value };
export type Mutation =
  | { op: "item-count"; key: string; label: string; action: "add" | "set"; value: Value | string; member?: string }
  | { op: "investigator"; action: "lose"; reason: string; private?: boolean; location?: string }
  | { op: "investigator"; action: "suspend"; minutes: Value; resume?: string }
  | { op: "investigator"; action: "inherit"; from: string; location: string }
  | { op: "clock"; action: "set"; date: string; minute: Value | null }
  | { op: "clock"; action: "advance"; minutes: Value }
  | { op: "clock"; action: "advance-days"; days: Value }
  | { op: "clock"; action: "pause" | "resume" }
  | { op: "party"; member: string; action: "hp"; value: Value | string }
  | { op: "party"; member: string; action: "status"; value: "present" | "absent" | "missing" | "dead" }
  | { op: "party"; member: string; action: "restore" }
  | { op: "party"; member: string; action: "unconscious"; value: boolean }
  | { op: "register"; kind: "skill" | "state"; key: string; label?: string }
  | { op: "flag"; key: string; value: boolean }
  | { op: "add" | "set"; field: string; value: Value | string }
  | { op: "item"; key: string; label: string; remove?: boolean }
  | { op: "derive" }
  | { op: "sanityBaseline" }
  | { op: "sanityCondition"; value: "controlled" | "temporary" | "indefinite" | "permanent" };
export type ProgramChoice = {
  id: string;
  label: string;
  target?: string;
  call?: string;
  condition?: Predicate;
  effects?: Mutation[];
  once?: string;
};
export type ProgramCheck = {
  actor?: string;
  record?: { roll?: string; grade?: string; success?: string; target?: string };
  delegate?: boolean;
  skill: string;
  label: string;
  difficulty?: "regular" | "hard" | "extreme";
  opposed?: Value;
  opposedBonus?: number;
  opposedPenalty?: number;
  /** Resolve equal success grades for the active check or the opposing roll. */
  opposedTie?: "check" | "opponent";
  target?: Value;
  multiplier?: number;
  bonus?: number;
  penalty?: number;
  modifiers?: { condition: Predicate; bonus?: number; penalty?: number }[];
  success?: string;
  failure?: string;
  fumble?: string;
  fumbleAt?: number;
  successEffects?: Mutation[];
  failureEffects?: Mutation[];
  push?: { success: string; failure: string };
};
export type Allocation = {
  specializations?: Record<string, { label: string; fixed?: string }>;
  kind: "attributes" | "occupation" | "interests" | "bonus";
  count?: number;
  pool?: number;
  includeCredit?: boolean;
  allowOccupation?: boolean;
  allowedSkills?: string[];
  minimums?: Record<string, number>;
  values?: number[];
  required?: string[];
  optional?: string[];
  groups?: string[][];
  extra?: number;
  occupation?: string;
  credit?: number;
};
export type CombatSpec = {
  coreRules?: boolean;
  options?: ProgramChoice[];
  roundCalls?: { afterRound: number; call: string }[];
  damageLimit?: { amount: number; target: string };
  count?: Value;
  weapons?: { id: string; label: string; skill: string; damage: string; key?: string; ammo?: string; shots?: number; bonus?: number; penalty?: number; firearm?: boolean; impaling?: boolean; damageBonus?: boolean; condition?: Predicate; actors?: string[] }[];
  name: string;
  hp: Value;
  dex?: number;
  initiative?: "player-first" | "enemy-first";
  fighting: number;
  dodge: number;
  damage: string;
  damageBonus?: string;
  winHp: number;
  win: string;
  lose: string;
  dodgeOnly?: boolean;
  randomStance?: boolean;
  escape?: {
    after: number;
    skill: string;
    difficulty: "regular" | "hard";
    target: string;
    eachPlayerTurn?: boolean;
  };
  damageGoal?: { amount: number; target: string; label: string };
  majorWound?: string;
  armor?: number;
  attacks?: { skill: number; damage: string }[][];
  rounds?: number;
};
export type Instruction =
  | { kind: "partyCombat"; combat: FrostProgramCombatSpec }
  | { kind: "text"; label: string; key: string; minLength?: number; maxLength: number }
  | { kind: "read"; target: string }
  | { kind: "distribute"; label: string; resource: "damage" | "item"; total: Value; recipients: string[]; protected?: string[]; key?: string; itemLabel?: string }
  | { kind: "investigator"; action: "activate-next" | "resume" | "restart"; reuse?: boolean }
  | { kind: "rollEffects"; label: string; effects: Mutation[] }
  | { kind: "effects"; effects: Mutation[]; condition?: Predicate }
  | { kind: "route"; target: string; condition?: Predicate }
  | { kind: "call"; target: string; condition?: Predicate }
  | { kind: "choices"; choices: ProgramChoice[] }
  | { kind: "check"; check: ProgramCheck; condition?: Predicate }
  | { kind: "allocation"; allocation: Allocation }
  | {
      kind: "number";
      label: string;
      field: string;
      min: number;
      max: Value;
      cost?: string;
    }
  | {
      kind: "random";
      reroll?: number[];
      sides: number;
      targets: string[];
      unvisited?: boolean;
      exhausted?: string;
    }
  | { kind: "combat"; combat: CombatSpec }
  | { kind: "end"; label: string; collect?: boolean };
export type ProgramState = {
  sanityCondition?: "controlled" | "temporary" | "indefinite" | "permanent";
  frostCombat?: { state: FrostPartyCombatState; completedRoundCalls: number[] };
  notes?: Record<string, string>;
  noteLabels?: Record<string, string>;
  sanityDay?: { key: string; initial: number; lost: number };
  preview?: { nodeId: string; visitId: string };
  cursor: number;
  visits: Record<string, number>;
  used: Record<string, boolean>;
  counters: Record<string, number>;
  initialSanity: number;
  sanityLost: number;
  occupationSkills: string[];
  skillMarks: string[];
  registrationLabels?: Record<string, string>;
  log: string[];
  lastSkill?: string;
  randomChoices?: string[];
  pending?: { check: ProgramCheck; result: import("./index.js").CheckResult; performerId?: string; frostCombat?: { side: "party" | "enemy"; actorId: string; targetId: string; enemyId: string; action: "attack" | "dodge" | "fightBack"; weaponId?: string } };
  returns: { nodeId: string; cursor: number; visitId: string; combat?: ProgramState["combat"]; frostCombat?: ProgramState["frostCombat"] }[];
  combat?: {
    defended?: number;
    completedRoundCalls?: number[];
    enemyLives?: number[];
    enemyArmor?: number[];
    order?: string[];
    nodeId: string;
    hp: number;
    round: number;
    playerTurn: boolean;
    stance: "fight" | "dodge";
    phase: number;
    armor: number;
    wounded?: boolean;
  };
};
export type SceneInput =
  | { kind: "text"; label: string; minLength: number; maxLength: number; value: string }
  | { kind: "distribution"; label: string; resource: "damage" | "item"; total: number; entries: { key: string; label: string; value: number }[]; protected?: string[]; minimums?: Record<string, number> }
  | {
      kind: "allocation";
      allocation: Allocation;
      skills: { key: string; label: string; value: number }[];
    }
  | {
      kind: "number";
      label: string;
      min: number;
      max: number;
      resources?: { mp: number; hp: number };
    };
