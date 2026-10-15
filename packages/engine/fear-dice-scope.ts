import type { FearDice, FearState } from "../contracts/fear.js";

/** Optional transaction hooks. Ordinary random sources retain exactly their
 * existing calls; a source-bound reroll transaction can identify individual dice.
 */
export type ScopedFearDice = FearDice & {
  scope?: (label: string) => FearDice;
  observeState?: (state: FearState) => void;
};
export function fearDiceScope(dice: FearDice, label: string): FearDice {
  return (dice as ScopedFearDice).scope?.(label) ?? dice;
}
export function observeFearDiceState(dice: FearDice, state: FearState): void {
  (dice as ScopedFearDice).observeState?.(state);
}
