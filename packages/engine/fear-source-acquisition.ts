import type { FearState, FearTableEntry } from "../contracts/fear.js";

/** Acquisition prompts are stored only after their source event has resolved. */
export type FearAcquisitionChoice = { kind: "food-to-salt" | "worship-symbol-visit"; options: string[]; data: Record<string, unknown> };
export type RandomBookDraw = { roll: number; entry: FearTableEntry };
export type RandomBookAcquisitionResult =
  | { handled: false }
  | { handled: true; status: "reroll-required"; source: "computer-printout"; rejectedRoll: 2 | 12 }
  | { handled: true; status: "book-resolved"; source: "random-book" | "computer-printout"; bookRoll: number };

/** Call with a source-found Food amount before carry-capacity resolution. */
export function recordFearFoodPickup(state: FearState, foundPoints: number): void {
  if (!Number.isInteger(foundPoints) || foundPoints < 0) throw new Error("Found Food points must be a non-negative integer");
  if (foundPoints > 0) state.pendingSaltConversion = (state.pendingSaltConversion ?? 0) + foundPoints;
}

/** Every completed visit to a Worship location adds one independent optional symbol pickup. */
export function recordFearWorshipVisit(state: FearState, visitKey: string): void {
  state.missionProgress ??= {};
  const marker = `fear:worship-symbol-visit:${visitKey}`;
  if (state.missionProgress[marker] === true) return;
  state.missionProgress[marker] = true;
  state.pendingWorshipSymbols = (state.pendingWorshipSymbols ?? 0) + 1;
}

/** Presents one safe, currently-known acquisition choice; it never exposes future table results. */
export function presentFearAcquisitionChoice(state: FearState): FearAcquisitionChoice | undefined {
  if (state.status !== "active" || state.pending || state.combat) return undefined;
  const saltPoints = Math.max(0, state.pendingSaltConversion ?? 0);
  if (saltPoints > 0) {
    const choice: FearAcquisitionChoice = {
      kind: "food-to-salt",
      options: Array.from({ length: saltPoints + 1 }, (_, points) => String(points)),
      data: { count: saltPoints, prompt: `可将找到的食物点数改为盐；选择0至${saltPoints}点转为盐，其余保留为食物。` },
    };
    state.pending = structuredClone(choice);
    return choice;
  }
  if ((state.pendingWorshipSymbols ?? 0) > 0) {
    const choice: FearAcquisitionChoice = {
      kind: "worship-symbol-visit", options: ["take", "leave"],
      data: { prompt: "每次到访礼拜场所，可选择拿取一个重量可忽略的宗教标志。" },
    };
    state.pending = structuredClone(choice);
    return choice;
  }
  return undefined;
}

/** Resolve a previously presented Food-to-Salt choice. The callback applies normal Food-capacity rules to the remainder. */
export function resolveFearFoodSaltChoice(state: FearState, selected: string, addRemainingFood: (points: number) => void): number {
  const pending = state.pending;
  if (pending?.kind !== "food-to-salt" || !pending.options.includes(selected)) throw new Error("No matching Food-to-Salt choice");
  const points = Number(selected);
  const foundPoints = Number(pending.data?.count ?? 0);
  if (!Number.isInteger(points) || points < 0 || points > foundPoints) throw new Error("Invalid Food-to-Salt amount");
  state.pending = undefined;
  if (points > 0) state.inventory.salt = (state.inventory.salt ?? 0) + points;
  addRemainingFood(foundPoints - points);
  state.pendingSaltConversion = Math.max(0, (state.pendingSaltConversion ?? 0) - foundPoints);
  if (!state.pendingSaltConversion) delete state.pendingSaltConversion;
  return points;
}

/** Resolve one Worship visit; the caller's add-item function enforces its ordinary capacity rules. */
export function resolveFearWorshipSymbolChoice(state: FearState, selected: string, addSymbol: () => void): boolean {
  const pending = state.pending;
  if (pending?.kind !== "worship-symbol-visit" || !pending.options.includes(selected)) throw new Error("No matching Worship-symbol choice");
  state.pending = undefined;
  state.pendingWorshipSymbols = Math.max(0, (state.pendingWorshipSymbols ?? 0) - 1);
  if (!state.pendingWorshipSymbols) delete state.pendingWorshipSymbols;
  if (selected === "take") addSymbol();
  return selected === "take";
}

/**
 * Resolve a single step of Random Objects 45/61 through the real Random Books table.
 * Row 61 carries one printed-book result, not a second Computer Print-out inventory
 * object. A rejected 2/12 returns an automatic reroll signal so callers can persist
 * continued resolution instead of guessing a result or looping forever on a bad stream.
 */
export function resolveFearRandomObjectBook(
  result: string,
  drawBook: () => RandomBookDraw,
  applyBook: (draw: RandomBookDraw, source: "random-book" | "computer-printout") => void,
): RandomBookAcquisitionResult {
  if (result !== "random-book" && result !== "computer-printout") return { handled: false };
  const draw = drawBook();
  if (!Number.isInteger(draw.roll) || draw.roll < 2 || draw.roll > 12) throw new Error("Random Books must return a valid 2D6 result");
  if (result === "computer-printout" && (draw.roll === 2 || draw.roll === 12))
    return { handled: true, status: "reroll-required", source: result, rejectedRoll: draw.roll };
  applyBook(draw, result);
  return { handled: true, status: "book-resolved", source: result, bookRoll: draw.roll };
}
