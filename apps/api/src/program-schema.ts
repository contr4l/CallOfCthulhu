import { z } from "zod";
import type {
  Predicate,
  Instruction,
} from "../../../packages/contracts/program.js";
const field = z
  .string()
  .regex(
    /^(hp|maxHp|sanity|luck|mp|spellCapacity|lastDamage|attribute\.[a-zA-Z]+|skill\.[a-zA-Z]+|counter\.[\w.-]+|used\.[\w.-]+|visits\.[\w.-]+)$/,
  );
const value = z.union([
  z.number().finite(),
  z
    .object({
      field,
      factor: z.number().finite().optional(),
      offset: z.number().finite().optional(),
    })
    .strict(),
]);
export const predicate: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ flag: z.string(), equals: z.boolean() }).strict(),
    z.object({ templateId: z.string().min(1) }).strict(),
    z.object({ all: z.array(predicate).min(1) }).strict(),
    z.object({ any: z.array(predicate).min(1) }).strict(),
    z.object({ not: predicate }).strict(),
    z
      .object({ field, op: z.enum(["eq", "lt", "lte", "gt", "gte"]), value })
      .strict(),
  ]),
);
export const mutation = z.union([
  z
    .object({
      op: z.literal("register"),
      kind: z.enum(["skill", "state"]),
      key: z.string().min(1),
      label: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({ op: z.literal("flag"), key: z.string(), value: z.boolean() })
    .strict(),
  z
    .object({
      op: z.enum(["add", "set"]),
      field,
      value: z.union([
        value,
        z
          .string()
          .regex(/^[+-]?(?:\d+[dD]\d+|\d+)(?:[+-](?:\d+[dD]\d+|\d+))*$/),
      ]),
    })
    .strict(),
  z
    .object({
      op: z.literal("item"),
      key: z.string(),
      label: z.string(),
      remove: z.boolean().optional(),
    })
    .strict(),
  z.object({ op: z.enum(["derive", "sanityBaseline"]) }).strict(),
]);
const check = z
  .object({
    skill: z.string(),
    label: z.string(),
    difficulty: z.enum(["regular", "hard", "extreme"]).optional(),
    opposed: z.number().int().min(1).max(99).optional(),
    target: value.optional(),
    multiplier: z.number().positive().optional(),
    bonus: z.number().int().min(0).max(2).optional(),
    penalty: z.number().int().min(0).max(2).optional(),
    modifiers: z
      .array(
        z
          .object({
            condition: predicate,
            bonus: z.number().int().min(0).max(2).optional(),
            penalty: z.number().int().min(0).max(2).optional(),
          })
          .strict(),
      )
      .optional(),
    success: z.string().optional(),
    failure: z.string().optional(),
    fumble: z.string().optional(),
    fumbleAt: z.number().int().min(1).max(100).optional(),
    successEffects: z.array(mutation).optional(),
    failureEffects: z.array(mutation).optional(),
    push: z
      .object({ success: z.string(), failure: z.string() })
      .strict()
      .optional(),
  })
  .strict();
const choice = z
  .object({
    id: z.string(),
    label: z.string(),
    target: z.string().optional(),
    condition: predicate.optional(),
    effects: z.array(mutation).optional(),
    once: z.string().optional(),
  })
  .strict();
const allocation = z
  .object({
    kind: z.enum(["attributes", "occupation", "interests", "bonus"]),
    count: z.number().int().min(1).max(50).optional(),
    pool: z.number().int().positive().optional(),
    includeCredit: z.boolean().optional(),
    allowOccupation: z.boolean().optional(),
    specializations: z
      .record(
        z.string(),
        z.object({ label: z.string(), fixed: z.string().optional() }).strict(),
      )
      .optional(),
    values: z.array(z.number().int()).optional(),
    required: z.array(z.string()).optional(),
    optional: z.array(z.string()).optional(),
    groups: z.array(z.array(z.string()).min(1)).optional(),
    extra: z.number().int().optional(),
    occupation: z.string().optional(),
    credit: z.number().int().optional(),
  })
  .strict();
export const instruction: z.ZodType<Instruction> = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("rollEffects"),
        label: z.string(),
        effects: z.array(mutation),
      })
      .strict(),
    z
      .object({
        kind: z.literal("effects"),
        effects: z.array(mutation),
        condition: predicate.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("route"),
        target: z.string(),
        condition: predicate.optional(),
      })
      .strict(),
    z
      .object({ kind: z.literal("choices"), choices: z.array(choice).min(1) })
      .strict(),
    z
      .object({
        kind: z.literal("check"),
        check,
        condition: predicate.optional(),
      })
      .strict(),
    z.object({ kind: z.literal("allocation"), allocation }).strict(),
    z
      .object({
        kind: z.literal("number"),
        label: z.string(),
        field,
        min: z.number().int(),
        max: value,
        cost: field.optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("random"),
        sides: z.number().int().positive(),
        targets: z.array(z.string()).min(1),
        unvisited: z.boolean().optional(),
        exhausted: z.string().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("end"),
        label: z.string(),
        collect: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("combat"),
        combat: z
          .object({
            name: z.string(),
            hp: z.number().int().positive(),
            dex: z.number().int(),
            fighting: z.number().int().min(0).max(99),
            dodge: z.number().int().min(0).max(99),
            damage: z.string(),
            damageBonus: z.string().optional(),
            winHp: z.number().int(),
            win: z.string(),
            lose: z.string(),
            dodgeOnly: z.boolean().optional(),
            randomStance: z.boolean().optional(),
            escape: z
              .object({
                after: z.number().int().nonnegative(),
                skill: z.string(),
                difficulty: z.enum(["regular", "hard"]),
                target: z.string(),
              })
              .strict()
              .optional(),
            majorWound: z.string().optional(),
            armor: z.number().int().nonnegative().optional(),
            rounds: z.number().int().positive().optional(),
            attacks: z
              .array(
                z
                  .array(
                    z
                      .object({
                        skill: z.number().int().min(0).max(99),
                        damage: z.string(),
                      })
                      .strict(),
                  )
                  .min(1),
              )
              .optional(),
          })
          .strict(),
      })
      .strict(),
  ],
);
export function targets(program: Instruction[]): string[] {
  return program
    .flatMap((s) =>
      s.kind === "route"
        ? [s.target]
        : s.kind === "choices"
          ? s.choices.flatMap((c) => (c.target ? [c.target] : []))
          : s.kind === "check"
            ? [
                s.check.success,
                s.check.failure,
                s.check.fumble,
                s.check.push?.success,
                s.check.push?.failure,
              ].filter((x): x is string => !!x)
            : s.kind === "combat"
              ? [
                  s.combat.win,
                  s.combat.lose,
                  ...(s.combat.escape ? [s.combat.escape.target] : []),
                  ...(s.combat.majorWound ? [s.combat.majorWound] : []),
                ]
              : s.kind === "random"
                ? [...s.targets, ...(s.exhausted ? [s.exhausted] : [])]
                : [],
    )
    .filter((t) => t !== "$return");
}
