import { z } from "zod";
import type {
  Predicate,
  Instruction,
  Value,
} from "../../../packages/contracts/program.js";
const field = z
  .string()
  .regex(
    /^(hp|maxHp|sanity|maxSanity|sanity\.(controlled|temporary|indefinite|permanent|dayInitial|dayLost|lastLoss)|luck|mp|spellCapacity|lastDamage|combat\.(round|alive|enemy\.\d+\.hp)|attribute\.[a-zA-Z]+|skill\.[a-zA-Z]+|counter\.[\w.-]+|used\.[\w.-]+|visits\.[\w.-]+|inventory\.[\w-]+\.count|party\.[\w-]+\.(hp|maxHp|sanity|present|awake|dead|missing|absent|unconscious|skill\.[a-zA-Z]+|attribute\.[a-zA-Z]+|inventory\.[\w-]+\.count)|clock\.(day|weekday|minute|hour|elapsedMinutes|paused)|campaign\.(losses|cycleLosses|cycle))$/,
  );
const value: z.ZodType<Value> = z.lazy(() =>
  z.union([
    z.number().finite(),
    z
      .object({
        field,
        factor: z.number().finite().optional(),
        offset: z.number().finite().optional(),
      })
      .strict(),
    z
      .object({
        calc: z.enum([
          "sum",
          "product",
          "difference",
          "quotient",
          "min",
          "max",
          "mod",
        ]),
        values: z.array(value).min(1).max(64),
      })
      .strict()
      .refine(
        (v) =>
          !["difference", "quotient", "mod"].includes(v.calc) ||
          v.values.length === 2,
        "二元数值表达式须有两个参数",
      ),
  ]),
);
export const predicate: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z.object({ investigatorId: z.string().min(1) }).strict(),
    z.object({ note: z.string().regex(/^[\w-]+$/), equals: z.string().max(4000), caseInsensitive: z.boolean().optional() }).strict(),
    z.object({ flag: z.string(), equals: z.boolean() }).strict(),
    z.object({ templateId: z.string().min(1) }).strict(),
    z.object({ item: z.string().min(1), has: z.boolean() }).strict(),
    z.object({ all: z.array(predicate).min(1) }).strict(),
    z.object({ any: z.array(predicate).min(1) }).strict(),
    z.object({ not: predicate }).strict(),
    z
      .object({ field, op: z.enum(["eq", "lt", "lte", "gt", "gte"]), value })
      .strict(),
  ]),
);
export const mutation = z.union([
  z.object({ op: z.literal("item-count"), key: z.string().regex(/^[\w-]+$/), label: z.string().min(1), action: z.enum(["add", "set"]), value: z.union([value, z.string().regex(/^[+-]?(?:\d+[dD]\d+|\d+)(?:[+-](?:\d+[dD]\d+|\d+))*$/)]), member: z.string().optional() }).strict(),
  z.object({ op: z.literal("investigator"), action: z.literal("lose"), reason: z.string().min(1), private: z.boolean().optional(), location: z.string().optional() }).strict(),
  z.object({ op: z.literal("investigator"), action: z.literal("suspend"), minutes: value, resume: z.string().optional() }).strict(),
  z.object({ op: z.literal("investigator"), action: z.literal("inherit"), from: z.string().min(1), location: z.string().min(1) }).strict(),
  z.object({ op: z.literal("clock"), action: z.literal("set"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), minute: value.nullable() }).strict(),
  z.object({ op: z.literal("clock"), action: z.literal("advance"), minutes: value }).strict(),
  z.object({ op: z.literal("clock"), action: z.literal("advance-days"), days: value }).strict(),
  z.object({ op: z.literal("clock"), action: z.enum(["pause", "resume"]) }).strict(),
  z.object({ op: z.literal("party"), member: z.string().regex(/^[\w-]+$/), action: z.literal("hp"), value: z.union([value, z.string().regex(/^[+-]?(?:\d+[dD]\d+|\d+)(?:[+-](?:\d+[dD]\d+|\d+))*$/)]) }).strict(),
  z.object({ op: z.literal("party"), member: z.string().regex(/^[\w-]+$/), action: z.literal("status"), value: z.enum(["present", "absent", "missing", "dead"]) }).strict(),
  z.object({ op: z.literal("party"), member: z.string().regex(/^[\w-]+$/), action: z.literal("restore") }).strict(),
  z.object({ op: z.literal("party"), member: z.string().regex(/^[\w-]+$/), action: z.literal("unconscious"), value: z.boolean() }).strict(),
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
  z.object({ op: z.literal("sanityCondition"), value: z.enum(["controlled", "temporary", "indefinite", "permanent"]) }).strict(),
]);
const check = z
  .object({
    record: z.object({ roll: z.string().min(1).optional(), grade: z.string().min(1).optional(), success: z.string().min(1).optional(), target: z.string().min(1).optional() }).strict().optional(),
    delegate: z.boolean().optional(),
    actor: z.string().min(1).optional(),
    skill: z.string(),
    label: z.string(),
    difficulty: z.enum(["regular", "hard", "extreme"]).optional(),
    opposed: value.optional(),
    opposedBonus: z.number().int().min(0).max(2).optional(),
    opposedPenalty: z.number().int().min(0).max(2).optional(),
    opposedTie: z.enum(["check", "opponent"]).optional(),
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
    call: z.string().optional(),
    condition: predicate.optional(),
    effects: z.array(mutation).optional(),
    once: z.string().optional(),
  })
  .strict().refine(c => !(c.target && c.call), "选项不能同时跳转和调用");
const allocation = z
  .object({
    kind: z.enum(["attributes", "occupation", "interests", "bonus"]),
    count: z.number().int().min(1).max(50).optional(),
    pool: z.number().int().positive().optional(),
    includeCredit: z.boolean().optional(),
    allowOccupation: z.boolean().optional(),
    allowedSkills: z.array(z.string().min(1)).min(1).optional(),
    minimums: z.record(z.string(), z.number().int().min(0).max(99)).optional(),
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
const combatWeapon = z.object({ id: z.string().regex(/^[\w-]+$/), label: z.string().min(1), skill: z.string().min(1), damage: z.string().regex(/^(?:\d+[dD]\d+|\d+)(?:[+-](?:\d+[dD]\d+|\d+))*$/), key: z.string().regex(/^[\w-]+$/).optional(), ammo: field.optional(), shots: z.number().int().positive().max(20).optional(), bonus: z.number().int().min(0).max(2).optional(), penalty: z.number().int().min(0).max(2).optional(), firearm: z.boolean().optional(), impaling: z.boolean().optional(), damageBonus: z.boolean().optional(), fumbleTarget: z.string().min(1).optional(), condition: predicate.optional(), actors: z.array(z.string().min(1)).min(1).optional() }).strict();
const frostCombat = z.object({
  sourceSection: z.string().min(1), participants: z.array(z.object({id: z.string().min(1), condition: predicate.optional()}).strict()).min(1).max(10),
  partyTurnOrder: z.array(z.string().min(1)).min(1).max(30), enemyTurnOrder: z.array(z.string().min(1)).min(1).max(100),
  initiative: z.enum(["party-first", "enemy-first"]),
  enemies: z.array(z.object({id: z.string().regex(/^[\w-]+$/), name: z.string().min(1), hp: value, maxHp: value, count: value.optional(), armor: z.number().int().nonnegative().optional(), stopAtHp: z.number().int().nonnegative().optional(), damageMode: z.enum(["party", "target"]).optional(), skills: z.record(z.string(), z.number().int().nonnegative()), targetOrder: z.array(z.string()).min(1).optional(), attackSkill: z.string().min(1), damage: z.string().regex(/^(?:\d+[dD]\d+|\d+)(?:[+-](?:\d+[dD]\d+|\d+))*$/), impaling: z.boolean().optional()}).strict()).min(1).max(30),
  weapons: z.array(combatWeapon).min(1).max(30), protectedStudents: z.array(z.string()).optional(), victoryHitThreshold: value.optional(), fatalCompanions: z.array(z.string()).optional(), reviveCompanionsIfInvestigatorSurvives: z.boolean().optional(),
  win: z.string().min(1), lose: z.string().min(1), flee: z.string().min(1).optional(), options: z.array(choice).max(30).optional(),
  roundCalls: z.array(z.object({afterRound:z.number().int().positive(),call:z.string().min(1)}).strict()).max(20).optional(),
  routes: z.array(z.object({condition:predicate,target:z.string().min(1)}).strict()).max(30).optional(),
}).strict();
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
    z.object({ kind: z.literal("call"), target: z.string(), condition: predicate.optional() }).strict(),
    z.object({ kind: z.literal("read"), target: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("partyCombat"), combat: frostCombat }).strict(),
    z.object({ kind: z.literal("text"), label: z.string().min(1), key: z.string().regex(/^[\w-]+$/), minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().min(1).max(4000) }).strict().refine(v => (v.minLength ?? 1) <= v.maxLength, "文本长度范围错误"),
    z.object({ kind: z.literal("investigator"), action: z.enum(["activate-next", "resume", "restart"]), reuse: z.boolean().optional() }).strict().refine(v => v.action === "restart" ? v.reuse !== undefined : v.reuse === undefined, "重开必须指定复用，接续或恢复不能指定复用"),
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
    z.object({ kind: z.literal("distribute"), label: z.string().min(1), resource: z.enum(["damage", "item"]), total: value, recipients: z.array(z.string().min(1)).min(1), protected: z.array(z.string()).optional(), key: z.string().regex(/^[\w-]+$/).optional(), itemLabel: z.string().min(1).optional() }).strict().refine(v => v.resource === "item" ? !!v.key && !!v.itemLabel && !v.protected : !v.key && !v.itemLabel, "物品分配需指定类型，伤害分配不能指定物品"),
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
        reroll: z.array(z.number().int().positive()).max(100).optional(),
        sides: z.number().int().positive(),
        targets: z.array(z.string()).min(1),
        unvisited: z.boolean().optional(),
        exhausted: z.string().optional(),
      })
      .strict().refine(v => !v.reroll || (new Set(v.reroll).size === v.reroll.length && v.reroll.length < v.sides && v.reroll.every(face => face <= v.sides)), "重掷面须互不重复、位于骰子范围内且不能覆盖全部结果"),
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
            coreRules: z.boolean().optional(),
            damageLimit: z.object({ amount: z.number().int().positive(), target: z.string().min(1) }).strict().optional(),
            damageGoal: z.object({ amount: z.number().int().positive(), target: z.string().min(1), label: z.string().min(1) }).strict().optional(),
            count: value.optional(),
            weapons: z.array(combatWeapon).min(1).max(30).optional(),
            hp: value,
            options: z.array(choice).max(30).optional(),
            roundCalls: z.array(z.object({ afterRound: z.number().int().positive(), call: z.string().min(1) }).strict()).max(20).optional(),
            dex: z.number().int().optional(),
            initiative: z.enum(["player-first", "enemy-first"]).optional(),
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
                eachPlayerTurn: z.boolean().optional(),
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
          .strict().refine(combat => combat.dex !== undefined || combat.initiative !== undefined, "战斗须提供DEX或明确先手规则").refine(combat => !combat.escape?.eachPlayerTurn || combat.coreRules === true, "每个玩家回合可逃脱仅用于coreRules战斗"),
      })
      .strict(),
  ],
);
export function targets(program: Instruction[]): string[] {
  return program
    .flatMap((s) =>
      s.kind === "route" || s.kind === "call" || s.kind === "read"
        ? [s.target]
        : s.kind === "choices"
          ? s.choices.flatMap((c) => (c.target ? [c.target] : c.call ? [c.call] : []))
          : s.kind === "check"
            ? [
                s.check.success,
                s.check.failure,
                s.check.fumble,
                s.check.push?.success,
                s.check.push?.failure,
              ].filter((x): x is string => !!x)
            : s.kind === "partyCombat"
              ? [s.combat.win, s.combat.lose, ...(s.combat.flee ? [s.combat.flee] : []), ...(s.combat.routes?.map(row=>row.target) ?? []), ...(s.combat.roundCalls?.map(row=>row.call) ?? []), ...(s.combat.options?.flatMap(row=>row.target ? [row.target] : row.call ? [row.call] : []) ?? [])]
            : s.kind === "combat"
              ? [
                  s.combat.win,
                  s.combat.lose,
                  ...(s.combat.escape ? [s.combat.escape.target] : []),
                  ...(s.combat.majorWound ? [s.combat.majorWound] : []),
                  ...(s.combat.damageLimit ? [s.combat.damageLimit.target] : []),
                  ...(s.combat.roundCalls?.map(hook => hook.call) ?? []),
                  ...(s.combat.options?.flatMap(choice => choice.target ? [choice.target] : choice.call ? [choice.call] : []) ?? []),
                ]
              : s.kind === "random"
                ? [...s.targets, ...(s.exhausted ? [s.exhausted] : [])]
                : [],
    )
    .filter((t) => t !== "$return");
}
