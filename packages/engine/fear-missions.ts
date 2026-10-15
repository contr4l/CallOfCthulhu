/**
 * Source-shaped, pure state transitions for Alone Against Fear missions.
 *
 * This module intentionally has local types so callers can map the rules to
 * the runtime without coupling this source audit to FearState/FearAction.
 * Dice are supplied by the caller and every player decision is returned as a
 * choice. It never performs I/O or invents missing source values.
 */

import type { FearMissionState } from "../contracts/fear.js";
export type { FearMissionState } from "../contracts/fear.js";

export type FearMissionId = "1" | "2" | "3" | "4" | "5" | "6";
export type FearMissionLocation = "house" | "lab" | "clinic" | "street" | "store" | "farm" | "military" | "other";

export type FearMissionEvent =
  | { type: "box-entered"; boxId: string; visitOrdinal: number }
  | { type: "medical-find-check"; trigger: "house-or-lab-roll" | "clinic-visit"; face: number; allThirtyVisited?: boolean }
  | { type: "medical-all-boxes-visited"; lastBoxId: string; totalBoxes: number }
  | { type: "hunt-locate"; availableClues: number }
  | { type: "hunt-next-box-entered"; boxId: string }
  | { type: "random-slasher"; face: number; encounteredSlasherId: string }
  | { type: "hunt-target-defeated"; enemyId: string }
  | { type: "food-location-visit"; location: "street" | "store" | "farm"; face: number; foodDie?: number }
  | { type: "food-delivery"; boxId: string }
  | { type: "weapons-return"; boxId: string; qualifyingFirearms: number }
  | { type: "town-roll-adjustment"; rawResult: number; adjustment: -1 | 0 | 1; adjustedDestination: FearMissionLocation }
  | { type: "witch-find"; boxId: string; availableClues: number; investigator: boolean; investigatorExpert: boolean; clueSpend: number; finalFiveLocation: boolean; surpriseFace?: number; dangerSenseLevel: 0 | 1 | 2 }
  | { type: "witch-capture"; witchId: string }
  | { type: "witch-combat-turn"; willSaveSucceeded: boolean }
  | { type: "witch-defeated"; witchId: string; capturedAlive?: boolean }
  | { type: "witch-final-item"; threeRollResults: string[]; bestResult: string }
  | { type: "mission-reward-choice"; choice: "5-xp" | "useful-stuff-2" | "3-xp" | "useful-stuff-3"; keepBackpack?: boolean }
  | { type: "random-gate-found" }
  | { type: "hell-gate-box-check"; visitedBoxCount: number }
  | { type: "hell-gate-closed" }
  | { type: "mission-return"; boxId: string; safeHouse: boolean; qualifyingFirearms?: number };

export type FearMissionEffect =
  | { type: "discover-item"; itemId: "medicine-dose"; amount: number }
  | { type: "encounter-target"; targetId: string; surprise: boolean; enemy?: { level: 4; type: "human"; life: 4 } }
  | { type: "discover-hell-gate"; reason: "random" | "after-threshold" | "box-30" }
  | { type: "roll"; dice: "useful-stuff"; count: 2 | 3; chooseBest: boolean; reason: string }
  | { type: "resource"; key: "clues" | "missionFood" | "xp" | "gatesClosed" | "sanity"; amount: number }
  | { type: "restricted-witch-clue"; amount: number }
  | { type: "grant-item"; itemId: string }
  | { type: "reward-choice"; choices: Array<"5-xp" | "useful-stuff-2" | "3-xp+keep-backpack" | "3-xp+discard-backpack" | "useful-stuff-3+keep-backpack" | "useful-stuff-3+discard-backpack"> }
  | { type: "town-roll"; rawResult: number; adjustedResult: number }
  | { type: "will-save"; level: 5; failureSanityLoss: 1 }
  | { type: "mission-completed"; missionId: FearMissionId }
  | { type: "campaign-won" }
  | { type: "normal-box-content" }
  | { type: "source-question"; question: string };

export type FearMissionTransition = {
  state: FearMissionState;
  effects: FearMissionEffect[];
  choices: string[];
  handled: boolean;
};

const ids: FearMissionId[] = ["1", "2", "3", "4", "5", "6"];
const d6 = (face: number) => Number.isInteger(face) && face >= 1 && face <= 6;
const nonnegativeInt = (value: number) => Number.isInteger(value) && value >= 0;
const copy = (state: FearMissionState): FearMissionState => structuredClone(state);
const result = (state: FearMissionState, effects: FearMissionEffect[] = [], choices: string[] = [], handled = true): FearMissionTransition => ({ state, effects, choices, handled });

/** Roll a mission and the source-required rerolls until it differs from last session. */
export function selectFearMission(rolls: number[], previousMissionId?: FearMissionId): { missionId?: FearMissionId; rollsUsed: number; rerollsRequired: boolean } {
  for (let i = 0; i < rolls.length; i++) {
    const face = rolls[i];
    if (!d6(face)) throw new Error("Mission-table rolls must be D6 faces");
    const id = ids[face - 1];
    if (id !== previousMissionId) return { missionId: id, rollsUsed: i + 1, rerollsRequired: false };
  }
  return { rollsUsed: rolls.length, rerollsRequired: true };
}

export function createFearMissionState(input: {
  missionId: FearMissionId;
  previousMissionId?: FearMissionId;
  startingBoxId: string;
  initialVisitBoxIds?: string[];
  gatesClosed?: number;
  foodTargetRoll?: [number, number];
  foodTarget?: number;
  huntTarget?: { id: string; level: number };
  gateFallbackRoll?: number;
}): FearMissionState {
  if (!input.startingBoxId) throw new Error("A starting box is required");
  const foodRoll = input.foodTargetRoll;
  if (input.missionId === "3" && input.foodTarget === undefined && (!foodRoll || foodRoll.some(face => !d6(face)))) throw new Error("Mission 3 requires its source 2D6 target roll");
  if (input.missionId === "2" && (!input.huntTarget?.id || !nonnegativeInt(input.huntTarget.level) || input.huntTarget.level < 1)) throw new Error("Mission 2 requires a slasher-table target and level");
  if (input.missionId === "6" && !d6(input.gateFallbackRoll ?? 0)) throw new Error("Mission 6 requires the source D6 fallback threshold roll");
  const gatesClosed = input.gatesClosed ?? 0;
  if (!nonnegativeInt(gatesClosed)) throw new Error("Campaign gate count must be a nonnegative integer");
  const initialVisitBoxIds = [...new Set(input.initialVisitBoxIds ?? [input.startingBoxId])];
  const foodTarget = input.foodTarget ?? (foodRoll ? foodRoll[0] + foodRoll[1] + 12 : 0);
  return {
    missionId: input.missionId, previousMissionId: input.previousMissionId, finished: false, missionRewardPending: false, completedMissionIds: [],
    campaign: { gatesClosed, won: gatesClosed >= 7 }, gateCountAtStart: gatesClosed, visitedBoxIds: initialVisitBoxIds,
    startingBoxId: input.startingBoxId, currentBoxId: initialVisitBoxIds.at(-1) ?? input.startingBoxId,
    medical: { dosesFound: 0, anyDoseFound: false, fallbackGranted: false },
    hunt: { targetId: input.huntTarget?.id, targetLevel: input.huntTarget?.level, targetDefeated: false, targetOnNextBox: false },
    food: { target: foodTarget, cargo: 0, backpackAccepted: false, delivered: false },
    weapons: { qualifyingReturned: 0 },
    witches: { defeated: 0, defeatedWitchIds: [], xp: 0, capturedWitchIds: [], restrictedClues: 0, lastFindWasCluePaid: false, lastSurpriseProbabilitySixths: 5, pendingFinalItem: false, finalItemResolved: false },
    gates: { randomGateFound: false, fallbackThreshold: input.missionId === "6" ? 12 + (input.gateFallbackRoll as number) : undefined, firstFallbackFound: false, box30Found: false, revealed: 0 },
  };
}

function finish(state: FearMissionState, effects: FearMissionEffect[]): FearMissionTransition {
  state.finished = true;
  if (!state.completedMissionIds.includes(state.missionId)) state.completedMissionIds.push(state.missionId);
  state.previousMissionId = state.missionId;
  effects.push({ type: "mission-completed", missionId: state.missionId });
  return result(state, effects);
}

/** Apply one source-level event. The caller executes returned effects transactionally. */
export function transitionFearMission(previous: FearMissionState, event: FearMissionEvent): FearMissionTransition {
  const state = copy(previous);
  if (state.campaign.won) return result(state, [{ type: "campaign-won" }]);
  if (state.finished && event.type !== "hell-gate-closed") return result(state, [], [], false);
  const effects: FearMissionEffect[] = [];
  switch (event.type) {
    case "box-entered": {
      state.currentBoxId = event.boxId;
      if (event.visitOrdinal < 1 || !Number.isInteger(event.visitOrdinal)) throw new Error("Visit ordinal must be a positive integer");
      if (!state.visitedBoxIds.includes(event.boxId)) state.visitedBoxIds.push(event.boxId);
      if (state.missionId === "2" && state.hunt.targetOnNextBox) {
        state.hunt.targetOnNextBox = false;
        effects.push({ type: "encounter-target", targetId: state.hunt.targetId!, surprise: false });
      }
      return result(state, effects);
    }
    case "medical-find-check": {
      if (state.missionId !== "1") return result(state, [], [], false);
      if (!d6(event.face)) throw new Error("Medical find check requires a D6 face");
      const found = event.trigger === "house-or-lab-roll" ? event.face === 1 : event.face <= 3;
      if (found) { state.medical.dosesFound++; state.medical.anyDoseFound = true; effects.push({ type: "discover-item", itemId: "medicine-dose", amount: 1 }); }
      if (event.allThirtyVisited && !state.medical.anyDoseFound && !state.medical.fallbackGranted) {
        state.medical.dosesFound = 3; state.medical.anyDoseFound = true; state.medical.fallbackGranted = true;
        effects.push({ type: "discover-item", itemId: "medicine-dose", amount: 3 });
      }
      return result(state, effects);
    }
    case "medical-all-boxes-visited": {
      if (state.missionId !== "1") return result(state, [], [], false);
      if (event.totalBoxes !== 30) return result(state, [{ type: "source-question", question: "Source says all boxes; verify the map's total box count before applying fallback." }]);
      if (!state.medical.anyDoseFound && !state.medical.fallbackGranted) {
        state.currentBoxId = event.lastBoxId; state.medical.dosesFound = 3; state.medical.anyDoseFound = true; state.medical.fallbackGranted = true;
        effects.push({ type: "discover-item", itemId: "medicine-dose", amount: 3 });
      }
      return result(state, effects);
    }
    case "hunt-locate": {
      if (state.missionId !== "2") return result(state, [], [], false);
      const cost = state.hunt.targetLevel!;
      if (!nonnegativeInt(event.availableClues) || event.availableClues < cost) return result(state, [], [], false);
      effects.push({ type: "resource", key: "clues", amount: -cost });
      state.hunt.targetOnNextBox = true;
      return result(state, effects);
    }
    case "hunt-next-box-entered": {
      if (state.missionId !== "2" || !state.hunt.targetOnNextBox) return result(state, [], [], false);
      state.hunt.targetOnNextBox = false; state.currentBoxId = event.boxId;
      effects.push({ type: "encounter-target", targetId: state.hunt.targetId!, surprise: false });
      return result(state, effects);
    }
    case "random-slasher": {
      if (state.missionId !== "2") return result(state, [], [], false);
      if (!d6(event.face)) throw new Error("Hunt target match requires a D6 face");
      const targetId = event.face <= 4 ? state.hunt.targetId! : event.encounteredSlasherId;
      effects.push({ type: "encounter-target", targetId, surprise: false }); return result(state, effects);
    }
    case "hunt-target-defeated": {
      if (state.missionId !== "2" || event.enemyId !== state.hunt.targetId) return result(state, [], [], false);
      state.hunt.targetDefeated = true; return result(state);
    }
    case "food-location-visit": {
      if (state.missionId !== "3") return result(state, [], [], false);
      if (!d6(event.face)) throw new Error("Food discovery requires a D6 face");
      if (event.face <= 3) {
        if (!d6(event.foodDie ?? 0)) throw new Error("Successful food discovery requires its D6 amount");
        state.food.cargo += event.foodDie!; effects.push({ type: "resource", key: "missionFood", amount: event.foodDie! });
      }
      return result(state, effects);
    }
    case "food-delivery": {
      if (state.missionId !== "3" || event.boxId !== state.startingBoxId || state.food.cargo < state.food.target || state.food.delivered) return result(state, [], [], false);
      state.currentBoxId = event.boxId; state.food.delivered = true;
      effects.push({ type: "resource", key: "missionFood", amount: -state.food.cargo });
      effects.push({ type: "reward-choice", choices: ["3-xp+keep-backpack", "3-xp+discard-backpack", "useful-stuff-3+keep-backpack", "useful-stuff-3+discard-backpack"] });
      return result(state, effects);
    }
    case "weapons-return": {
      if (state.missionId !== "4" || event.boxId !== state.startingBoxId || !nonnegativeInt(event.qualifyingFirearms)) return result(state, [], [], false);
      state.currentBoxId = event.boxId; state.weapons.qualifyingReturned = event.qualifyingFirearms;
      if (event.qualifyingFirearms < 1) return result(state);
      effects.push({ type: "resource", key: "xp", amount: Math.min(event.qualifyingFirearms, 5) });
      return finish(state, effects);
    }
    case "town-roll-adjustment": {
      if (state.missionId !== "4") return result(state, [], [], false);
      if (event.adjustment !== 0 && event.adjustedDestination !== "military" && event.adjustedDestination !== "store") return result(state, [], [], false);
      const adjustedResult = event.rawResult + event.adjustment;
      effects.push({ type: "town-roll", rawResult: event.rawResult, adjustedResult }); return result(state, effects);
    }
    case "witch-find": {
      if (state.missionId !== "5" || state.witches.defeated >= 5) return result(state, [], [], false);
      const cost = event.investigatorExpert ? 1 : event.investigator ? 2 : 3;
      if (!nonnegativeInt(event.availableClues) || !nonnegativeInt(event.clueSpend) || event.clueSpend > event.availableClues) throw new Error("Witch clue spend must be available and nonnegative");
      const restrictedClue = Math.min(1, state.witches.restrictedClues);
      const cluePaid = event.availableClues + restrictedClue >= cost && event.clueSpend + restrictedClue >= cost;
      const auto = event.finalFiveLocation;
      if (!cluePaid && !auto) return result(state, [{ type: "normal-box-content" }]);
      if (![0, 1, 2].includes(event.dangerSenseLevel)) throw new Error("Danger Sense level must be 0, 1, or 2");
      const ordinaryCluesToPay = cluePaid ? Math.max(0, cost - restrictedClue) : event.clueSpend;
      if (ordinaryCluesToPay > 0) effects.push({ type: "resource", key: "clues", amount: -ordinaryCluesToPay });
      const restrictedSpent = restrictedClue > 0 && (cluePaid || event.clueSpend > 0);
      if (restrictedSpent) { state.witches.restrictedClues--; effects.push({ type: "restricted-witch-clue", amount: -1 }); }
      state.witches.lastFindWasCluePaid = cluePaid;
      if (!cluePaid) {
        const remaining = Math.max(0, 5 - event.clueSpend - (restrictedSpent ? 1 : 0) - event.dangerSenseLevel);
        state.witches.lastSurpriseProbabilitySixths = remaining;
        if (event.surpriseFace === undefined || !d6(event.surpriseFace)) throw new Error("An undiscovered final-five witch requires a D6 surprise roll");
        if (event.surpriseFace <= remaining) effects.push({ type: "encounter-target", targetId: `witch:${event.boxId}`, surprise: true, enemy: { level: 4, type: "human", life: 4 } });
        else effects.push({ type: "encounter-target", targetId: `witch:${event.boxId}`, surprise: false, enemy: { level: 4, type: "human", life: 4 } });
      } else {
        state.witches.lastSurpriseProbabilitySixths = 0;
        effects.push({ type: "encounter-target", targetId: `witch:${event.boxId}`, surprise: false, enemy: { level: 4, type: "human", life: 4 } });
      }
      return result(state, effects);
    }
    case "witch-capture": {
      if (state.missionId !== "5" || state.witches.defeated >= 5 || !event.witchId || state.witches.defeatedWitchIds.includes(event.witchId) || state.witches.capturedWitchIds.includes(event.witchId)) return result(state, [], [], false);
      state.witches.capturedWitchIds.push(event.witchId); state.witches.restrictedClues++;
      effects.push({ type: "restricted-witch-clue", amount: 1 }); return result(state, effects);
    }
    case "witch-combat-turn": {
      if (state.missionId !== "5" || state.witches.defeated >= 5) return result(state, [], [], false);
      effects.push({ type: "will-save", level: 5, failureSanityLoss: 1 });
      if (!event.willSaveSucceeded) effects.push({ type: "resource", key: "sanity", amount: -1 });
      return result(state, effects);
    }
    case "witch-defeated": {
      if (state.missionId !== "5" || state.witches.defeated >= 5 || !event.witchId || state.witches.defeatedWitchIds.includes(event.witchId)) return result(state, [], [], false);
      state.witches.defeated++;
      state.witches.defeatedWitchIds.push(event.witchId);
      const xp = 1 + (state.witches.defeated === 5 ? 2 : 0);
      state.witches.xp += xp; effects.push({ type: "resource", key: "xp", amount: xp });
      if (event.capturedAlive && !state.witches.capturedWitchIds.includes(event.witchId)) {
        state.witches.capturedWitchIds.push(event.witchId); state.witches.restrictedClues++;
        effects.push({ type: "restricted-witch-clue", amount: 1 });
      }
      if (state.witches.defeated === 5) { state.witches.pendingFinalItem = true; effects.push({ type: "roll", dice: "useful-stuff", count: 3, chooseBest: true, reason: "Choose the best of three Useful Stuff results for the fifth witch." }); }
      return result(state, effects);
    }
    case "witch-final-item": {
      if (state.missionId !== "5" || !state.witches.pendingFinalItem || event.threeRollResults.length !== 3 || !event.bestResult || !event.threeRollResults.includes(event.bestResult)) return result(state, [], [], false);
      state.witches.pendingFinalItem = false; state.witches.finalItemResolved = true;
      return finish(state, [{ type: "grant-item", itemId: event.bestResult }]);
    }
    case "mission-reward-choice": {
      if (state.missionId === "2" && state.hunt.targetDefeated && state.missionRewardPending && ["5-xp", "useful-stuff-2"].includes(event.choice)) {
        if (event.choice === "5-xp") effects.push({ type: "resource", key: "xp", amount: 5 });
        else effects.push({ type: "roll", dice: "useful-stuff", count: 2, chooseBest: false, reason: "Mission 2 reward is two Useful Stuff rolls." });
        state.missionRewardPending = false;
        return finish(state, effects);
      }
      if (state.missionId === "3" && state.food.delivered && ["3-xp", "useful-stuff-3"].includes(event.choice)) {
        state.food.backpackAccepted = event.keepBackpack === true;
        if (event.choice === "3-xp") effects.push({ type: "resource", key: "xp", amount: 3 });
        else effects.push({ type: "roll", dice: "useful-stuff", count: 3, chooseBest: false, reason: "Mission 3 reward is three Useful Stuff rolls." });
        return finish(state, effects);
      }
      return result(state, [], [], false);
    }
    case "random-gate-found": {
      state.gates.randomGateFound = true; state.gates.revealed++;
      effects.push({ type: "discover-hell-gate", reason: "random" }); return result(state, effects);
    }
    case "hell-gate-box-check": {
      if (state.missionId !== "6") return result(state, [], [], false);
      const threshold = state.gates.fallbackThreshold;
      if (threshold !== undefined && !state.gates.randomGateFound && !state.gates.firstFallbackFound && event.visitedBoxCount >= threshold) {
        state.gates.firstFallbackFound = true; state.gates.revealed++;
        effects.push({ type: "discover-hell-gate", reason: "after-threshold" });
      }
      if (event.visitedBoxCount === 30 && !state.gates.box30Found) {
        if (!state.gates.randomGateFound) {
          state.gates.box30Found = true; state.gates.revealed++;
          effects.push({ type: "discover-hell-gate", reason: "box-30" });
        }
      }
      return result(state, effects);
    }
    case "hell-gate-closed": {
      state.campaign.gatesClosed = Math.min(7, state.campaign.gatesClosed + 1);
      effects.push({ type: "resource", key: "gatesClosed", amount: 1 });
      if (state.campaign.gatesClosed >= 7) { state.campaign.won = true; effects.push({ type: "campaign-won" }); }
      if (state.missionId === "6" && !state.finished && state.campaign.gatesClosed > state.gateCountAtStart) return finish(state, effects);
      return result(state, effects);
    }
    case "mission-return": {
      if (state.missionId === "1" && event.boxId === state.startingBoxId && state.medical.dosesFound >= 3) return finish(state, [{ type: "resource", key: "xp", amount: 3 }]);
      if (state.missionId === "2" && state.hunt.targetDefeated && (event.boxId === state.startingBoxId || event.safeHouse)) {
        state.currentBoxId = event.boxId;
        state.missionRewardPending = true;
        effects.push({ type: "reward-choice", choices: ["5-xp", "useful-stuff-2"] }); return result(state, effects);
      }
      if (state.missionId === "3" && event.boxId === state.startingBoxId && state.food.cargo >= state.food.target && !state.food.delivered) return transitionFearMission(state, { type: "food-delivery", boxId: event.boxId });
      if (state.missionId === "4" && event.boxId === state.startingBoxId && (event.qualifyingFirearms ?? state.weapons.qualifyingReturned) >= 1) return transitionFearMission(state, { type: "weapons-return", boxId: event.boxId, qualifyingFirearms: event.qualifyingFirearms ?? state.weapons.qualifyingReturned });
      if (state.missionId === "6" && state.campaign.gatesClosed > state.gateCountAtStart) return finish(state, []);
      return result(state, [], [], false);
    }
  }
}

/** Gate closure is a campaign overlay and can happen while any mission is active. */
export function missionVictoryReady(state: FearMissionState): boolean { return state.campaign.won || state.campaign.gatesClosed >= 7; }
