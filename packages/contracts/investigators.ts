import type { Character, RunState } from "./index.js";
import type { ProgramState } from "./program.js";

import type { InventoryItem } from "./index.js";

export type InvestigatorDefinition = {
  first: string;
  members: { id: string; entry: string; character: Character; inventory?: InventoryItem[] }[];
  restartNode: string;
  sharedFlags: string[];
  sharedCounters: string[];
};
export type InvestigatorSnapshot = {
  character: Character;
  program: ProgramState;
  flags: Record<string, boolean>;
  inventory: RunState["inventory"];
  party?: RunState["party"];
  nodeId: string;
  visitId: string;
  createdCharacterId?: string;
  savedCharacterId?: string;
  suspendedAt?: { date: string; minuteOfDay: number };
  status: "lost" | "suspended" | "active";
  reason?: string;
  remainingMinutes?: number;
  inheritance?: { location: string; claimed: boolean };
};
export type InvestigatorState = {
  current: string;
  cycle: number;
  totalLossCount: number;
  cycleLossCount: number;
  actors: Record<string, InvestigatorSnapshot>;
  previousCycles: { cycle: number; losses: number }[];
  suspended?: string;
};
