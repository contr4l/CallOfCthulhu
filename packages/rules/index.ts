import { randomInt } from "node:crypto";
import type {
  Character,
  CharacterTemplate,
  Check,
  CheckResult,
} from "../contracts/index.js";
export type DiceSource = (min: number, maxExclusive: number) => number;
export const secureDice: DiceSource = randomInt;
export const skillLabels: Record<string, string> = {
  spotHidden: "侦查",
  listen: "聆听",
  persuade: "说服",
  stealth: "潜行",
  firstAid: "急救",
};
export function targetFor(character: Character, check: Check): number {
  const value =
    check.skill === "sanity"
      ? character.sanity
      : check.skill === "luck"
        ? character.luck
        : (character.skills[check.skill] ??
          character.attributes?.[check.skill]);
  if (value === undefined) throw new Error(`未定义检定对象：${check.skill}`);
  return Math.floor(
    (value * (check.multiplier ?? 1)) /
      { regular: 1, hard: 2, extreme: 5 }[check.difficulty],
  );
}
export function resolveCheck(
  character: Character,
  check: Check,
  dice: DiceSource = secureDice,
  targetBonus = 0,
): CheckResult {
  const base =
    check.skill === "sanity"
      ? character.sanity
      : check.skill === "luck"
        ? character.luck
        : (character.skills[check.skill] ??
          character.attributes?.[check.skill]);
  const adjustedBase = base * (check.multiplier ?? 1);
  const target = targetBonus
    ? Math.min(99, targetFor(character, check) + targetBonus)
    : targetFor(character, check);
  const effectiveBase =
    adjustedBase +
    targetBonus * { regular: 1, hard: 2, extreme: 5 }[check.difficulty];
  const modifier = (check.bonusDice ?? 0) - (check.penaltyDice ?? 0);
  const unit = dice(0, 10);
  const candidates = Array.from({ length: Math.abs(modifier) + 1 }, () => {
    const tens = dice(0, 10);
    return tens === 0 && unit === 0 ? 100 : tens * 10 + unit;
  });
  const roll =
    modifier >= 0 ? Math.min(...candidates) : Math.max(...candidates);
  const grade =
    roll === 1
      ? "critical"
      : roll === 100 || (adjustedBase < 50 && roll >= 96)
        ? "fumble"
        : roll <= Math.floor(effectiveBase / 5)
          ? "extreme"
          : roll <= Math.floor(effectiveBase / 2)
            ? "hard"
            : roll <= effectiveBase
              ? "regular"
              : "failure";
  return {
    label: check.label,
    skill: check.skill,
    target,
    roll,
    candidates,
    success: grade !== "fumble" && (roll === 1 || roll <= target),
    grade,
  };
}
export function createCharacter(
  name: string,
  preset: {
    occupation: string;
    skills: Record<string, number>;
    hp: number;
    sanity: number;
    attributes?: Record<string, number>;
    mp?: number;
    damageBonus?: string;
    templateId?: string;
    movement?: number;
    build?: number;
    profile?: Character["profile"];
    specializations?: Record<string, string>;
  },
  luck: number,
): Character {
  return {
    ...(preset.attributes ? { attributes: { ...preset.attributes } } : {}),
    ...(preset.mp !== undefined ? { mp: preset.mp } : {}),
    ...(preset.damageBonus ? { damageBonus: preset.damageBonus } : {}),
    ...(preset.templateId ? { templateId: preset.templateId } : {}),
    ...(preset.movement !== undefined ? { movement: preset.movement } : {}),
    ...(preset.build !== undefined ? { build: preset.build } : {}),
    ...(preset.profile ? { profile: { ...preset.profile } } : {}),
    ...(preset.specializations
      ? { specializations: { ...preset.specializations } }
      : {}),
    name,
    occupation: preset.occupation,
    hp: preset.hp,
    maxHp: preset.hp,
    sanity: preset.sanity,
    luck,
    skills: { ...preset.skills },
  };
}
export function createCharacterFromTemplate(
  name: string,
  template: CharacterTemplate,
  luck: number,
): Character {
  return {
    ...createCharacter(name, template, luck),
    attributes: { ...template.attributes },
    mp: template.mp,
    damageBonus: template.damageBonus,
    build: template.build,
    movement: template.movement,
    templateId: template.id,
    templateVersion: template.version,
    sourceStoryId: template.sourceStoryId,
    sourceStoryTitle: template.sourceStoryTitle,
  };
}
