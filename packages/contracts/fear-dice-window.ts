import type { FearAction, FearState } from "./fear.js";

export type FearWindowDie = { key: string; min: number; max: number; value: number; accepted: boolean };
export type FearDiceWindow = {
  before: FearState;
  action: FearAction;
  label: string;
  draws: FearWindowDie[];
  risks: { key: string; face: number; used: number }[];
  waiting: { key: string; min: number; max: number };
  visibleKeys: string[];
};
