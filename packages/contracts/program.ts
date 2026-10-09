/** Data-only instructions used by published solo modules. No script evaluation. */
export type Value =
  number | { field: string; factor?: number; offset?: number };
export type Predicate =
  | { flag: string; equals: boolean }
  | { all: Predicate[] }
  | { any: Predicate[] }
  | { not: Predicate }
  | { field: string; op: "eq" | "lt" | "lte" | "gt" | "gte"; value: Value };
export type Mutation =
  | { op: "flag"; key: string; value: boolean }
  | { op: "add" | "set"; field: string; value: Value | string }
  | { op: "item"; key: string; label: string; remove?: boolean }
  | { op: "derive" }
  | { op: "sanityBaseline" };
export type ProgramChoice = {
  id: string;
  label: string;
  target?: string;
  condition?: Predicate;
  effects?: Mutation[];
  once?: string;
};
export type ProgramCheck = {
  skill: string;
  label: string;
  difficulty?: "regular" | "hard" | "extreme";
  opposed?: number;
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
  kind: "attributes" | "occupation" | "interests";
  values?: number[];
  required?: string[];
  optional?: string[];
  extra?: number;
  occupation?: string;
  credit?: number;
};
export type CombatSpec = {
  name: string;
  hp: number;
  dex: number;
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
  };
  majorWound?: string;
  armor?: number;
  attacks?: { skill: number; damage: string }[][];
  rounds?: number;
};
export type Instruction =
  | { kind: "rollEffects"; label: string; effects: Mutation[] }
  | { kind: "effects"; effects: Mutation[]; condition?: Predicate }
  | { kind: "route"; target: string; condition?: Predicate }
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
      sides: number;
      targets: string[];
      unvisited?: boolean;
      exhausted?: string;
    }
  | { kind: "combat"; combat: CombatSpec }
  | { kind: "end"; label: string };
export type ProgramState = {
  cursor: number;
  visits: Record<string, number>;
  used: Record<string, boolean>;
  counters: Record<string, number>;
  initialSanity: number;
  sanityLost: number;
  occupationSkills: string[];
  skillMarks: string[];
  log: string[];
  lastSkill?: string;
  randomChoices?: string[];
  pending?: { check: ProgramCheck; result: import("./index.js").CheckResult };
  returns: { nodeId: string; cursor: number; visitId: string }[];
  combat?: {
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
  | {
      kind: "allocation";
      allocation: Allocation;
      skills: { key: string; label: string; value: number }[];
    }
  | { kind: "number"; label: string; min: number; max: number };
