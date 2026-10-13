import { randomUUID } from "node:crypto";
import type {
  Character,
  CheckResult,
  RuleDiceResult,
  RunState,
  Registration,
  SceneView,
  Story,
} from "../contracts/index.js";
import type {
  Instruction,
  Mutation,
  Predicate,
  ProgramCheck,
  ProgramState,
  Value,
} from "../contracts/program.js";
import { resolveCheck, type DiceSource, secureDice } from "../rules/index.js";
import { attributeLabels, skillLabels } from "../contracts/character-labels.js";
function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
export const baseSkills: Record<string, number> = {
  accounting: 5,
  anthropology: 1,
  archaeology: 1,
  appraise: 5,
  artCraft: 5,
  charm: 15,
  climb: 20,
  creditRating: 0,
  cthulhuMythos: 0,
  disguise: 5,
  dodge: 0,
  driveAuto: 20,
  electricalRepair: 10,
  fastTalk: 5,
  fightingBrawl: 25,
  firearmsHandgun: 20,
  firearmsRifleShotgun: 25,
  firstAid: 30,
  history: 5,
  intimidate: 15,
  jump: 20,
  languageOther: 1,
  languageOwn: 0,
  law: 5,
  libraryUse: 20,
  listen: 20,
  locksmith: 1,
  mechanicalRepair: 10,
  medicine: 1,
  naturalWorld: 10,
  navigate: 10,
  occult: 5,
  persuade: 10,
  psychology: 10,
  ride: 5,
  science: 1,
  scienceBiology: 1,
  scienceBotany: 1,
  sciencePharmacy: 1,
  sleightOfHand: 10,
  spotHidden: 25,
  stealth: 20,
  survival: 10,
  swim: 20,
  throw: 20,
  track: 10,
};
export function programState(character: Character): ProgramState {
  return {
    cursor: 0,
    visits: {},
    used: {},
    counters: {},
    initialSanity: character.sanity,
    sanityLost: 0,
    occupationSkills: [],
    skillMarks: [],
    log: [],
    returns: [],
  };
}
function p(s: RunState) {
  return s.program!;
}
export function field(s: RunState, key: string): number {
  if (key === "spellCapacity")
    return Math.min(10, (s.character.mp ?? 0) + s.character.hp - 1);
  if (key === "visits.current") return p(s).visits[s.nodeId] ?? 0;
  if (key.startsWith("visits.")) return p(s).visits[key.slice(7)] ?? 0;
  if (key.startsWith("used.")) return p(s).used[key.slice(5)] ? 1 : 0;
  if (key.startsWith("counter.")) return p(s).counters[key.slice(8)] ?? 0;
  if (key.startsWith("skill.")) {
    const v = s.character.skills[key.slice(6)];
    if (v === undefined) invalid(`未知技能 ${key}`);
    return v;
  }
  if (key.startsWith("attribute.")) {
    const v = s.character.attributes?.[key.slice(10)];
    if (v === undefined) invalid(`未知属性 ${key}`);
    return v;
  }
  if (key === "lastDamage") return p(s).counters.lastDamage ?? 0;
  if (["hp", "maxHp", "sanity", "luck", "mp"].includes(key))
    return (s.character as unknown as Record<string, number>)[key] ?? 0;
  invalid(`未知数值字段 ${key}`);
}
export function value(s: RunState, v: Value): number {
  return typeof v === "number"
    ? v
    : Math.floor(field(s, v.field) * (v.factor ?? 1) + (v.offset ?? 0));
}
export function matches(s: RunState, c?: Predicate): boolean {
  if (!c) return true;
  if ("templateId" in c) return s.character.templateId === c.templateId;
  if ("flag" in c) return (s.flags[c.flag] ?? false) === c.equals;
  if ("all" in c) return c.all.every((x) => matches(s, x));
  if ("any" in c) return c.any.some((x) => matches(s, x));
  if ("not" in c) return !matches(s, c.not);
  const a = field(s, c.field),
    b = value(s, c.value);
  return { eq: a === b, lt: a < b, lte: a <= b, gt: a > b, gte: a >= b }[c.op];
}
export function rollExpression(expr: string, dice: DiceSource): number {
  if (!/^[+-]?(?:\d+[dD]\d+|\d+)(?:[+-](?:\d+[dD]\d+|\d+))*$/.test(expr))
    throw new Error(`非法骰子公式 ${expr}`);
  return [...expr.matchAll(/([+-]?)(\d+)(?:[dD](\d+))?/g)].reduce(
    (sum, m) =>
      sum +
      (m[1] === "-" ? -1 : 1) *
        (m[3]
          ? Array.from({ length: Number(m[2]) }, () =>
              dice(1, Number(m[3]) + 1),
            ).reduce((a, b) => a + b, 0)
          : Number(m[2])),
    0,
  );
}
export function derive(c: Character) {
  const a = c.attributes!;
  c.maxHp = Math.floor((a.siz + a.con) / 10);
  c.hp = c.maxHp;
  c.sanity = a.pow;
  c.mp = Math.floor(a.pow / 5);
  c.skills.dodge = Math.floor(a.dex / 2);
  c.skills.languageOwn = a.edu;
  const total = a.str + a.siz;
  c.damageBonus =
    total < 65
      ? "-2"
      : total < 85
        ? "-1"
        : total < 125
          ? "0"
          : total < 165
            ? "1D4"
            : "1D6";
  c.build =
    total < 65 ? -2 : total < 85 ? -1 : total < 125 ? 0 : total < 165 ? 1 : 2;
}
function mutations(s: RunState, ops: Mutation[], dice: DiceSource) {
  for (const e of ops) {
    if (e.op === "sanityBaseline") {
      p(s).initialSanity = s.character.sanity;
      p(s).sanityLost = 0;
      continue;
    }
    if (e.op === "register") {
      const skill = e.key === "$last" ? p(s).lastSkill : e.key;
      if (e.kind === "skill" && (!skill || !(skill in s.character.skills)))
        invalid("登记引用了未知技能或尚未完成的技能检定");
      const key = e.kind === "skill" ? `skillMark.${skill}` : e.key;
      if (e.label || e.kind === "state")
        (p(s).registrationLabels ??= {})[key] = e.label ?? e.key;
      registerFlag(s, key, true);
      continue;
    }
    if (e.op === "flag") {
      const key =
        e.key === "skillMark.$last" ? `skillMark.${p(s).lastSkill}` : e.key;
      registerFlag(s, key, e.value);
      continue;
    }
    if (e.op === "derive") {
      derive(s.character);
      p(s).initialSanity = s.character.sanity;
      continue;
    }
    if (e.op === "item") {
      s.inventory = s.inventory.filter((i) => i.key !== e.key);
      if (!e.remove) s.inventory.push({ key: e.key, label: e.label });
      continue;
    }
    const v =
      typeof e.value === "string"
        ? rollExpression(e.value, dice)
        : value(s, e.value);
    const next = (e.op === "add" ? field(s, e.field) : 0) + v;
    if (e.field.startsWith("counter.")) p(s).counters[e.field.slice(8)] = next;
    else if (e.field.startsWith("skill."))
      s.character.skills[e.field.slice(6)] = Math.max(0, Math.min(99, next));
    else if (e.field.startsWith("attribute."))
      s.character.attributes![e.field.slice(10)] = next;
    else if (e.field === "hp") {
      s.character.hp = Math.max(0, Math.min(s.character.maxHp, next));
      if (e.op === "add" && v < 0) p(s).counters.lastDamage = -v;
    } else if (e.field === "sanity")
      s.character.sanity = Math.max(
        0,
        Math.min(99 - (s.character.skills.cthulhuMythos ?? 0), next),
      );
    else if (e.field === "luck")
      s.character.luck = Math.max(0, Math.min(99, next));
    else if (e.field === "mp") s.character.mp = Math.max(0, next);
    else invalid(`不可修改字段 ${e.field}`);
    if (!e.field.startsWith("counter."))
      p(s).log.push(
        `${({ hp: "生命", sanity: "理智", luck: "幸运", mp: "魔法" } as Record<string, string>)[e.field] ?? skillLabels[e.field.slice(6)] ?? e.field} ${e.op === "add" ? (v >= 0 ? "+" : "") + v : next}`,
      );
  }
}
function node(s: Story, id: string) {
  const n = s.nodes.find((n) => n.id === id);
  if (!n || !n.program) throw new Error(`缺少程序节点 ${id}`);
  return n;
}
function go(story: Story, s: RunState, target: string) {
  if (target === "$return") {
    const saved = p(s).returns.pop();
    if (!saved) throw new Error("没有待返回的规则流程");
    s.nodeId = saved.nodeId;
    s.visitId = saved.visitId;
    p(s).cursor = saved.cursor;
    return;
  }
  node(story, target);
  s.nodeId = target;
  s.visitId = randomUUID();
  p(s).cursor = 0;
  p(s).visits[target] = (p(s).visits[target] ?? 0) + 1;
  p(s).combat = undefined;
  p(s).counters.combatActions = 0;
}
function interrupt(story: Story, s: RunState, target: string) {
  p(s).returns.push({
    nodeId: s.nodeId,
    cursor: p(s).cursor,
    visitId: s.visitId,
  });
  go(story, s, target);
}
function health(
  story: Story,
  s: RunState,
  before: { hp: number; sanity: number },
) {
  const damage = before.hp - s.character.hp,
    loss = before.sanity - s.character.sanity;
  // Raw damage, including overkill, is recorded by the mutation.
  if (loss > 0) p(s).sanityLost += loss;
  if (story.healthPolicy === "tide") {
    if (loss > 0 && s.character.sanity === 0) go(story, s, "tide-retirement");
    else if (loss > 0 && p(s).sanityLost >= Math.ceil(p(s).initialSanity / 5)) {
      s.flags["tide-insane"] = true;
      p(s).registrationLabels ??= {};
      p(s).registrationLabels!["tide-insane"] = "暂时性疯狂";
    }
    return;
  }
  if (story.healthPolicy !== "static") return;
  if (damage > 0 && s.character.hp === 0) {
    go(story, s, "324");
    return;
  }
  if (loss > 0 && s.character.sanity === 0) {
    go(story, s, "334");
    return;
  }
  // Loss is accounted exactly once, before leaving the source instruction.
  if (
    loss > 0 &&
    !s.flags.indefinite &&
    p(s).sanityLost >= Math.ceil(p(s).initialSanity / 5)
  ) {
    s.flags.indefinite = true;
    interrupt(story, s, "328");
  }
  if (loss > 0 && (loss >= 5 || (s.flags.indefinite && s.nodeId !== "328")))
    interrupt(story, s, "329");
  if (damage > 0 && (s.flags.majorWound || damage > s.character.maxHp / 2)) {
    s.flags.majorWound = true;
    interrupt(story, s, "325");
  }
}
function apply(
  story: Story,
  s: RunState,
  ops: Mutation[],
  dice: DiceSource,
  next?: string,
) {
  const before = { hp: s.character.hp, sanity: s.character.sanity };
  mutations(s, ops, dice);
  if (next) go(story, s, next);
  health(story, s, before);
}
function instruction(story: Story, s: RunState): Instruction {
  const step = node(story, s.nodeId).program![p(s).cursor];
  if (!step) throw new Error(`未终止的程序 ${s.nodeId}:${p(s).cursor}`);
  return step;
}
function settle(story: Story, s: RunState, dice: DiceSource) {
  for (let i = 0; i < 128; i++) {
    const step = instruction(story, s);
    if (step.kind === "effects") {
      p(s).cursor++;
      if (matches(s, step.condition)) apply(story, s, step.effects, dice);
      continue;
    }
    if (step.kind === "route") {
      if (matches(s, step.condition)) go(story, s, step.target);
      else p(s).cursor++;
      continue;
    }
    if (step.kind === "check" && !matches(s, step.condition)) {
      p(s).cursor++;
      continue;
    }
    if (step.kind === "end") s.status = "ended";
    if (step.kind === "combat" && !p(s).combat) {
      p(s).combat = {
        nodeId: s.nodeId,
        hp: step.combat.hp,
        round: 1,
        playerTurn: (s.character.attributes?.dex ?? 0) >= step.combat.dex,
        phase: 0,
        armor: step.combat.armor ?? 0,
        stance:
          step.combat.randomStance && dice(1, 7) % 2 === 0 ? "dodge" : "fight",
      };
    }
    if (step.kind === "combat" && p(s).combat!.stance === "dodge")
      p(s).combat!.playerTurn = true;
    return;
  }
  throw new Error("自动剧情超过 128 步，请检查循环");
}
export function initialProgram(
  story: Story,
  s: RunState,
  dice: DiceSource = secureDice,
) {
  s.program = programState(s.character);
  if (story.id === "alone-against-static" && story.creationPolicy === "fixed") {
    s.flags[s.character.templateId === "static-alex" ? "亚历克斯" : "查理"] =
      true;
  }
  go(story, s, story.entry);
  settle(story, s, dice);
}
function checkSpec(s: RunState, c: ProgramCheck) {
  let bonus = (c.bonus ?? 0) + (p(s).counters.nextBonus ?? 0),
    penalty = c.penalty ?? 0;
  for (const m of c.modifiers ?? [])
    if (matches(s, m.condition)) {
      bonus += m.bonus ?? 0;
      penalty += m.penalty ?? 0;
    }
  penalty += p(s).counters[`penalty.${c.skill}`] ?? 0;
  if (c.skill in s.character.skills) penalty += p(s).counters.skillPenalty ?? 0;
  const target = c.target ? value(s, c.target) : undefined;
  return {
    skill: c.skill,
    label: c.label,
    difficulty: c.difficulty ?? "regular",
    bonusDice: Math.min(2, Math.max(0, bonus - penalty)),
    penaltyDice: Math.min(2, Math.max(0, penalty - bonus)),
    success: "",
    failure: "",
    ...(target !== undefined ? { target } : {}),
    multiplier: c.multiplier,
  };
}
function resolve(
  s: RunState,
  c: ProgramCheck,
  dice: DiceSource,
  targetBonus = 0,
): CheckResult {
  const spec = checkSpec(s, c);
  const clone = structuredClone(s.character);
  if (spec.target !== undefined) clone.skills.__custom = spec.target;
  const other =
    c.opposed !== undefined ? opponent(s, c.opposed, dice) : undefined;
  const result = resolveCheck(
    clone,
    { ...spec, skill: spec.target !== undefined ? "__custom" : spec.skill },
    dice,
    targetBonus,
  );
  result.skill = c.skill;
  if (other) {
    result.opponent = {
      roll: other.roll,
      target: other.target,
      grade: other.grade,
    };
    const base =
      s.character.skills[c.skill] ?? s.character.attributes?.[c.skill] ?? 0;
    result.success =
      ranks[result.grade] > ranks[other.grade] ||
      (ranks[result.grade] === ranks[other.grade] && base > c.opposed!);
    p(s).log.push(
      `对抗检定：对方 ${other.roll}/${other.target} ${gradeNames[other.grade]}`,
    );
  }
  if (c.fumbleAt && result.roll >= c.fumbleAt) {
    result.grade = "fumble";
    result.success = false;
  }
  p(s).counters.nextBonus = 0;
  if (c.skill in s.character.skills) p(s).lastSkill = c.skill;
  p(s).log.push(
    `${c.label}：${result.roll}/${result.target} ${result.success ? "成功" : "失败"}`,
  );
  return result;
}
function luckCost(
  story: Story,
  s: RunState,
  result: CheckResult,
): number | undefined {
  const cost = result.roll - result.target;
  return story.spendLuck &&
    !result.success &&
    result.grade !== "fumble" &&
    !["luck", "sanity"].includes(result.skill) &&
    cost > 0 &&
    cost <= s.character.luck
    ? cost
    : undefined;
}
function checkDone(
  story: Story,
  s: RunState,
  c: ProgramCheck,
  result: CheckResult,
  dice: DiceSource,
  pushed = false,
) {
  p(s).cursor++;
  const target =
    result.grade === "fumble" && c.fumble
      ? c.fumble
      : result.success
        ? pushed
          ? c.push!.success
          : c.success
        : pushed
          ? c.push!.failure
          : c.failure;
  const effects = result.success ? c.successEffects : c.failureEffects;
  apply(story, s, effects ?? [], dice, target);
}
function registrations(s: RunState): Registration[] {
  const labels: Record<string, string> = {
    majorWound: "重伤",
    indefinite: "不定性疯狂",
    staircase: "秘密阶梯",
    appointment: "与阿博加斯特的约定",
    "chant-arbogast": "阿博加斯特的仪式",
    "chant-call": "召唤天界之焰",
    "chant-command": "命令天界之焰",
    "book-derby": "德比的诗集",
  };
  return Object.entries(s.flags)
    .filter(([, v]) => v)
    .flatMap<Registration>(([k]) =>
      k.startsWith("skillMark.")
        ? [
            {
              key: k,
              kind: "skill" as const,
              label:
                p(s).registrationLabels?.[k] ??
                `成长标记：${skillLabels[k.slice(10)] ?? k.slice(10)}`,
            },
          ]
        : (p(s).registrationLabels?.[k] ??
            labels[k] ??
            (/[\u3400-\u9fff]/.test(k) ? k : undefined))
          ? [
              {
                key: k,
                kind: "state" as const,
                label: p(s).registrationLabels?.[k] ?? labels[k] ?? k,
              },
            ]
          : [],
    );
}
function registerFlag(s: RunState, key: string, enabled: boolean) {
  const changed = (s.flags[key] ?? false) !== enabled;
  s.flags[key] = enabled;
  if (key.startsWith("skillMark.")) {
    const skill = key.slice(10);
    if (enabled && !p(s).skillMarks.includes(skill))
      p(s).skillMarks.push(skill);
    if (!enabled) p(s).skillMarks = p(s).skillMarks.filter((k) => k !== skill);
  }
  const record = registrations(s).find((r) => r.key === key);
  if (changed && enabled && record)
    p(s).log.push(`已自动登记：${record.label}`);
}

/** Original text stays in source files. Player views omit paper bookkeeping and numbered routing. */
export function narrativeText(lines: string[]): string[] {
  const paper =
    /(?:记录表|方框|表格).*(?:勾选|打勾|划勾|画勾|划.{0,4}勾)|(?:勾选|打勾|划勾|画勾).*(?:记录表|方框|表格)|\bcheck[- ]mark(?:ed)?\b|\bsmall box\b/i;
  const routing = /(?:转到|回到|跳转到)\s*\d+|\b(?:go|turn)\s+to\s+\d+\b/i;
  return lines
    .map((line) =>
      line
        .split(/(?<=[。！？])|(?<=[.!?])(?=\s)/u)
        .filter(
          (sentence) =>
            !paper.test(sentence) && !routing.test(sentence) && sentence.trim(),
        )
        .join("")
        .trim(),
    )
    .filter(
      (line) =>
        line.length > 0 &&
        ![
          "按当前规则操作继续。",
          "本段规则由网页自动处理，请按下方提示继续。",
        ].includes(line),
    );
}
function projectProgramRaw(story: Story, s: RunState): Partial<SceneView> {
  const step = instruction(story, s);
  let actions: SceneView["actions"] = [],
    check: SceneView["check"],
    input: SceneView["input"];
  if (p(s).randomChoices)
    actions = p(s).randomChoices!.map((id) => ({
      id: `random-${id}`,
      label: `选择尚未经历的症状 ${id}`,
    }));
  else if (p(s).pending) {
    actions = [{ id: "accept", label: "接受失败结果" }];
    if (p(s).pending!.check.push)
      actions.push({ id: "push", label: "孤注一掷（失败后果更严重）" });
    const cost = luckCost(story, s, p(s).pending!.result);
    if (cost !== undefined)
      actions.push({
        id: "spend-luck",
        label: `花费 ${cost} 点幸运，令检定成功`,
      });
  } else if (step.kind === "rollEffects")
    actions = [{ id: "roll", label: step.label }];
  else if (step.kind === "check") {
    actions = [{ id: "roll", label: `进行${step.check.label}检定` }];
    const spec = checkSpec(s, step.check);
    const c = s.character;
    const b =
      spec.target ??
      (c.skills[spec.skill] ??
        c.attributes?.[spec.skill] ??
        (c as unknown as Record<string, number>)[spec.skill]) *
        (spec.multiplier ?? 1);
    check = {
      label: spec.label,
      target: Math.floor(
        b / { regular: 1, hard: 2, extreme: 5 }[spec.difficulty],
      ),
      difficulty: spec.difficulty,
    };
  } else if (step.kind === "choices")
    actions = step.choices
      .filter((c) => matches(s, c.condition) && (!c.once || !p(s).used[c.once]))
      .map((c) => ({ id: c.id, label: c.label }));
  else if (step.kind === "allocation") {
    actions = [{ id: "allocate", label: "确认分配" }];
    input = {
      kind: "allocation",
      allocation: step.allocation,
      skills: Object.entries(
        step.allocation.kind === "attributes"
          ? (s.character.attributes ?? {
              str: 0,
              con: 0,
              pow: 0,
              dex: 0,
              app: 0,
              siz: 0,
              int: 0,
              edu: 0,
            })
          : s.character.skills,
      )
        .filter(
          ([key]) =>
            step.allocation.kind !== "interests" ||
            step.allocation.allowOccupation ||
            !p(s).occupationSkills.includes(key),
        )
        .map(([key, value]) => ({
          key,
          label: attributeLabels[key] ?? skillLabels[key] ?? key,
          value,
        })),
    };
  } else if (step.kind === "number") {
    actions = [{ id: "confirm", label: "确认投入" }];
    input = {
      kind: "number",
      label: step.label,
      min: step.min,
      max: value(s, step.max),
      ...(step.cost === "mp"
        ? { resources: { mp: s.character.mp ?? 0, hp: s.character.hp } }
        : {}),
    };
  } else if (step.kind === "random")
    actions = [{ id: "roll", label: `掷 D${step.sides}` }];
  else if (step.kind === "combat") {
    const c = p(s).combat!;
    actions = c.wounded
      ? [{ id: "consciousness", label: "进行体质检定，保持清醒" }]
      : c.playerTurn
        ? [{ id: "attack", label: "攻击" }]
        : [
            { id: "fightBack", label: "反击" },
            { id: "dodge", label: "闪避" },
          ];
    if (
      step.combat.escape &&
      c.playerTurn &&
      c.round > step.combat.escape.after
    )
      actions.push({ id: "escape", label: "尝试脱离战斗" });
    return {
      actions,
      notices: p(s).log,
      combat: {
        name: step.combat.name,
        hp: c.hp,
        round: c.round,
        turn: c.wounded
          ? "你受到重伤，先检定能否保持清醒"
          : c.playerTurn
            ? c.stance === "dodge"
              ? "轮到你行动，对手准备闪避"
              : "轮到你行动，请选择攻击"
            : "对手正在攻击，请选择反击或闪避",
        armor: c.armor,
        weapon: s.inventory.some((i) => i.key === "knife")
          ? `猎刀：1D4 + ${s.character.damageBonus ?? "0"}`
          : `徒手：1D3 + ${s.character.damageBonus ?? "0"}`,
      },
      records: registrations(s).map((r) => r.label),
      registrations: registrations(s),
    };
  }
  return {
    actions,
    check,
    input,
    ...(step.kind === "end" ? { ending: step.label } : {}),
    notices: p(s).log,
    records: registrations(s).map((r) => r.label),
    registrations: registrations(s),
  };
}
export function projectProgram(story: Story, s: RunState): Partial<SceneView> {
  const view = projectProgramRaw(story, s);
  const step = instruction(story, s);
  if (
    !p(s).pending &&
    ["choices", "check", "rollEffects", "random"].includes(step.kind) &&
    view.actions?.length === 1
  ) {
    view.actions = [
      {
        id: "next",
        label: ["check", "rollEffects", "random"].includes(step.kind)
          ? view.actions[0].label
          : "下一节",
      },
    ];
  }
  return { ...view, text: narrativeText(node(story, s.nodeId).text) };
}
function allocation(
  s: RunState,
  a: Extract<Instruction, { kind: "allocation" }>["allocation"],
  input: Record<string, number | string>,
) {
  const specialtyInput = Object.fromEntries(
    Object.entries(input)
      .filter(([k]) => k.startsWith("specialty."))
      .map(([k, v]) => [k.slice(10), v]),
  );
  input = Object.fromEntries(
    Object.entries(input).filter(([k]) => !k.startsWith("specialty.")),
  );
  if (
    Object.keys(specialtyInput).some(
      (k) => !a.specializations?.[k] || !(k in input),
    )
  )
    invalid("不能填写此专长");
  const specialtyValues: Record<string, string> = {};
  for (const [k, rule] of Object.entries(a.specializations ?? {}))
    if (k in input) {
      const supplied = specialtyInput[k];
      if (
        supplied !== undefined &&
        (typeof supplied !== "string" ||
          !supplied.trim() ||
          supplied.trim().length > 40)
      )
        invalid("请填写不超过40字的专长");
      if (rule.fixed && supplied !== undefined && supplied !== rule.fixed)
        invalid("此职业专长已固定");
      const val = rule.fixed ?? (supplied as string | undefined)?.trim();
      if (!val) invalid(`请填写${rule.label}`);
      specialtyValues[k] = val;
    }
  const keys = Object.keys(input),
    vals = Object.values(input);
  if (vals.some((x) => typeof x !== "number" || !Number.isInteger(x)))
    invalid("分配必须为整数");
  if (a.kind === "attributes") {
    if (
      keys.length !== 8 ||
      keys.some((k) => !(k in attributeLabels)) ||
      JSON.stringify([...vals].sort()) !== JSON.stringify([...a.values!].sort())
    )
      invalid("请将指定的八个属性值各使用一次");
    s.character.attributes = { ...input } as Record<string, number>;
    derive(s.character);
    p(s).initialSanity = s.character.sanity;
    return;
  }
  if (
    keys.some(
      (k) =>
        !Object.hasOwn(s.character.skills, k) ||
        k === "cthulhuMythos" ||
        (k === "creditRating" && !a.includeCredit),
    )
  )
    invalid("不能分配此技能");
  if (a.kind === "bonus") {
    if (
      !keys.length ||
      vals.some((v) => Number(v) < 0) ||
      vals.reduce<number>((sum, v) => sum + Number(v), 0) !== a.pool ||
      keys.some((k) => s.character.skills[k] + Number(input[k]) > 99)
    )
      invalid(`请分配全部 ${a.pool} 点加值，技能不能超过 99`);
    for (const k of keys) s.character.skills[k] += Number(input[k]);
    return;
  }
  if (a.kind === "interests") {
    if (
      keys.length !== (a.count ?? 4) ||
      (!a.allowOccupation &&
        keys.some((k) => p(s).occupationSkills.includes(k))) ||
      vals.some((v) => v !== 20)
    )
      invalid(
        `请选择 ${a.count ?? 4} 项${a.allowOccupation ? "" : "非职业"}技能，每项增加 20`,
      );
    for (const k of keys) s.character.skills[k] += 20;
    return;
  }
  if (
    keys.length !== (a.values?.length ?? 8) ||
    (a.includeCredit && !keys.includes("creditRating")) ||
    JSON.stringify([...vals].sort()) !==
      JSON.stringify([...a.values!].sort()) ||
    (a.required ?? []).some((k) => !keys.includes(k)) ||
    (a.optional?.length && !a.optional.some((k) => keys.includes(k))) ||
    (a.groups ?? []).some((g) => !g.some((k) => keys.includes(k)))
  )
    invalid("职业技能与指定点值不符");
  for (const k of keys) s.character.skills[k] = input[k] as number;
  p(s).occupationSkills = keys;
  if (Object.keys(specialtyValues).length)
    s.character.specializations = {
      ...s.character.specializations,
      ...specialtyValues,
    };
  s.character.occupation = a.occupation!;
  if (a.credit !== undefined) s.character.skills.creditRating = a.credit;
}
const gradeNames = {
  critical: "大成功",
  extreme: "极难成功",
  hard: "困难成功",
  regular: "普通成功",
  failure: "失败",
  fumble: "大失败",
};
const ranks = {
  fumble: 0,
  failure: 0,
  regular: 1,
  hard: 2,
  extreme: 3,
  critical: 4,
};
function opponent(s: RunState, skill: number, dice: DiceSource) {
  return resolveCheck(
    { ...s.character, skills: { enemy: skill } },
    {
      skill: "enemy",
      label: "对手",
      difficulty: "regular",
      success: "",
      failure: "",
    },
    dice,
  );
}
function combat(
  story: Story,
  s: RunState,
  spec: Extract<Instruction, { kind: "combat" }>["combat"],
  action: string,
  dice: DiceSource,
) {
  const c = p(s).combat!;
  const attackList = spec.attacks?.[(c.round - 1) % spec.attacks.length] ?? [
    { skill: spec.fighting, damage: spec.damage },
  ];
  const first = (s.character.attributes?.dex ?? 0) >= spec.dex;
  const order = [
    ...(first ? ["player"] : []),
    ...(c.stance === "fight" ? attackList.map((_, i) => String(i)) : []),
    ...(!first ? ["player"] : []),
  ];
  const nextPhase = () => {
    c.phase++;
    if (c.phase >= order.length) {
      c.phase = 0;
      c.round++;
      c.armor = spec.armor ?? 0;
      c.stance = spec.randomStance && dice(1, 7) % 2 === 0 ? "dodge" : "fight";
      if (spec.rounds && c.round > spec.rounds) {
        go(story, s, spec.win);
        return;
      }
    }
    const nextAttacks =
      spec.attacks?.[(c.round - 1) % spec.attacks.length] ?? attackList;
    const nextOrder = [
      ...(first ? ["player"] : []),
      ...(c.stance === "fight" ? nextAttacks.map((_, i) => String(i)) : []),
      ...(!first ? ["player"] : []),
    ];
    c.playerTurn = nextOrder[c.phase] === "player";
  };
  if (c.wounded) {
    if (action !== "consciousness") invalid("请先进行重伤体质检定");
    const r = resolve(s, { skill: "con", label: "重伤体质" }, dice);
    delete c.wounded;
    if (!r.success || s.character.hp <= 0)
      go(story, s, spec.majorWound ?? spec.lose);
    else nextPhase();
    return r;
  }
  if (
    action === "escape" &&
    c.playerTurn &&
    spec.escape &&
    c.round > spec.escape.after
  ) {
    const r = resolve(
      s,
      {
        skill: spec.escape.skill,
        label: "脱离战斗",
        difficulty: spec.escape.difficulty,
      },
      dice,
    );
    if (r.success) go(story, s, spec.escape.target);
    else nextPhase();
    return r;
  }
  if (
    (c.playerTurn && action !== "attack") ||
    (!c.playerTurn && !["dodge", "fightBack"].includes(action))
  )
    invalid("当前战斗阶段不允许此行动");
  const offense = c.playerTurn,
    attack = offense ? attackList[0] : attackList[Number(order[c.phase])];
  const player = resolve(
    s,
    {
      skill: action === "dodge" ? "dodge" : "fightingBrawl",
      label: action === "dodge" ? "闪避" : "格斗（斗殴）",
    },
    dice,
  );
  const enemy = opponent(
    s,
    offense
      ? c.stance === "dodge"
        ? spec.dodge
        : spec.fighting
      : attack.skill,
    dice,
  );
  player.opponent = {
    roll: enemy.roll,
    target: enemy.target,
    grade: enemy.grade,
  };
  p(s).log.push(
    `${spec.name}：${enemy.roll}/${enemy.target} ${gradeNames[enemy.grade]}`,
  );
  const pr = ranks[player.grade],
    er = ranks[enemy.grade];
  const playerWins =
    pr > 0 &&
    (offense
      ? c.stance === "dodge"
        ? pr > er
        : pr >= er
      : action === "dodge"
        ? pr >= er
        : pr > er);
  const enemyWins = er > 0 && !playerWins;
  player.combat = {
    enemyName: spec.name,
    round: c.round,
    action:
      action === "attack" ? "攻击" : action === "fightBack" ? "反击" : "闪避",
    result: playerWins
      ? action === "dodge"
        ? "dodged"
        : "hit"
      : enemyWins && (!offense || c.stance === "fight")
        ? "hurt"
        : "miss",
    damage: 0,
    recipient: "none",
  };
  let damage = 0;
  const damageRoll = (
    expr: string,
    db: string | undefined,
    grade: CheckResult["grade"],
    initiating: boolean,
    impaling = false,
  ) => {
    const extreme = initiating && ["extreme", "critical"].includes(grade);
    const base = extreme
      ? rollExpression(expr, (_min, max) => max - 1)
      : rollExpression(expr, dice);
    return Math.max(
      0,
      base +
        (extreme && impaling ? rollExpression(expr, dice) : 0) +
        (db ? rollExpression(db, dice) : 0),
    );
  };
  if (playerWins && action !== "dodge") {
    const knife = s.inventory.some((i) => i.key === "knife");
    const rolled = damageRoll(
      knife ? "1D4" : "1D3",
      s.character.damageBonus,
      player.grade,
      offense,
      knife,
    );
    damage = Math.max(0, rolled - c.armor);
    c.armor = Math.max(0, c.armor - rolled);
    c.hp = Math.max(0, c.hp - damage);
    player.combat.damage = damage;
    player.combat.recipient = "enemy";
    p(s).log.push(`${spec.name} 受到 ${damage} 点伤害`);
  }
  if (enemyWins && (!offense || c.stance === "fight")) {
    damage = damageRoll(attack.damage, spec.damageBonus, enemy.grade, !offense);
    s.character.hp = Math.max(0, s.character.hp - damage);
    player.combat.damage = damage;
    player.combat.recipient = "player";
    p(s).log.push(`受到 ${damage} 点伤害`);
    if (damage > 0 && (s.flags.majorWound || damage >= s.character.maxHp / 2)) {
      s.flags.majorWound = true;
      c.wounded = true;
      return player;
    }
  }
  if (s.character.hp <= 0) {
    go(story, s, spec.lose);
    return player;
  }
  if (c.hp <= spec.winHp) {
    go(story, s, spec.win);
    return player;
  }
  nextPhase();
  return player;
}
export function advanceProgram(
  story: Story,
  current: RunState,
  actionId: string,
  dice: DiceSource = secureDice,
  input: Record<string, number | string> = {},
  targetBonus = 0,
) {
  if (current.status === "ended") invalid("本局已经结束");
  const s = structuredClone(current);
  p(s).log = [];
  const step = instruction(story, s);
  if (actionId === "next") {
    const visible = projectProgram(story, s).actions;
    const available = projectProgramRaw(story, s).actions;
    if (
      visible?.length !== 1 ||
      visible[0].id !== "next" ||
      available?.length !== 1
    )
      invalid("当前剧情需要作出选择，不能自动推进");
    actionId = available![0].id;
  }
  let result: CheckResult | undefined;
  let ruleDice: RuleDiceResult | undefined;
  let action = actionId;
  if (p(s).randomChoices) {
    const target = actionId.replace("random-", "");
    if (!p(s).randomChoices!.includes(target)) invalid("此症状不可选");
    delete p(s).randomChoices;
    go(story, s, target);
  } else if (p(s).pending) {
    const pending = p(s).pending!;
    const cost = luckCost(story, s, pending.result);
    if (
      (actionId === "push" && !pending.check.push) ||
      (actionId === "spend-luck" && cost === undefined) ||
      !["push", "accept", "spend-luck"].includes(actionId)
    )
      invalid("当前检定不允许此操作");
    delete p(s).pending;
    if (actionId === "push") {
      result = resolve(s, pending.check, dice);
      checkDone(story, s, pending.check, result, dice, true);
    } else if (actionId === "spend-luck") {
      s.character.luck -= cost!;
      result = {
        ...pending.result,
        originalRoll: pending.result.roll,
        roll: pending.result.target,
        luckSpent: cost,
        success: true,
        grade: pending.check.difficulty ?? "regular",
      };
      p(s).log.push(`花费 ${cost} 点幸运，检定成功`);
      checkDone(story, s, pending.check, result, dice);
    } else checkDone(story, s, pending.check, pending.result, dice);
  } else if (step.kind === "rollEffects" && actionId === "roll") {
    p(s).cursor++;
    const groups = new Map<number, number[]>();
    apply(story, s, step.effects, (min, max) => {
      const drawn = dice(min, max);
      if (min === 1) {
        const sides = max - 1;
        const results = groups.get(sides) ?? [];
        results.push(drawn);
        groups.set(sides, results);
      }
      return drawn;
    });
    if (groups.size) {
      const total = [...groups.values()].flat().reduce((a, b) => a + b, 0);
      const scaled = step.effects.find(
        (e) =>
          (e.op === "set" || e.op === "add") &&
          typeof e.value === "object" &&
          e.value.factor !== undefined,
      );
      const multiplier =
        scaled &&
        (scaled.op === "set" || scaled.op === "add") &&
        typeof scaled.value === "object"
          ? (scaled.value.factor ?? 1)
          : 1;
      ruleDice = {
        label: step.label,
        groups: [...groups].map(([sides, results]) => ({ sides, results })),
        total,
        multiplier,
        value: Math.floor(total * multiplier),
      };
    }
  } else if (step.kind === "check" && actionId === "roll") {
    result = resolve(s, step.check, dice, targetBonus);
    action = `进行${step.check.label}检定`;
    if (
      !result.success &&
      (step.check.push || luckCost(story, s, result) !== undefined)
    )
      p(s).pending = { check: step.check, result };
    else checkDone(story, s, step.check, result, dice);
  } else if (step.kind === "choices") {
    const choice = step.choices.find(
      (c) =>
        c.id === actionId &&
        matches(s, c.condition) &&
        (!c.once || !p(s).used[c.once]),
    );
    if (!choice) invalid("当前剧情不允许这个行动");
    if (choice.once) p(s).used[choice.once] = true;
    action = choice.label;
    p(s).cursor++;
    apply(story, s, choice.effects ?? [], dice, choice.target);
  } else if (step.kind === "allocation" && actionId === "allocate") {
    allocation(s, step.allocation, input);
    p(s).cursor++;
  } else if (step.kind === "number" && actionId === "confirm") {
    const n = input.value;
    if (
      typeof n !== "number" ||
      !Number.isInteger(n) ||
      n < step.min ||
      n > value(s, step.max)
    )
      invalid("投入点数超出范围");
    p(s).cursor++;
    mutations(
      s,
      [
        { op: "set", field: step.field, value: n },
        ...(step.cost
          ? [
              {
                op: "add" as const,
                field: step.cost,
                value: -Math.min(n, s.character.mp ?? 0),
              },
              ...(n > (s.character.mp ?? 0)
                ? [
                    {
                      op: "add" as const,
                      field: "hp",
                      value: -(n - (s.character.mp ?? 0)),
                    },
                  ]
                : []),
            ]
          : []),
      ],
      dice,
    );
  } else if (step.kind === "random" && actionId === "roll") {
    const rolled = dice(1, step.sides + 1);
    ruleDice = {
      label: `随机事件 · D${step.sides}`,
      groups: [{ sides: step.sides, results: [rolled] }],
      total: rolled,
      multiplier: 1,
      value: rolled,
    };
    let target = step.targets[rolled - 1];
    if (step.unvisited && (p(s).visits[target] ?? 0) > 0) {
      const available = step.targets.filter((t) => !p(s).visits[t]);
      if (!available.length) go(story, s, step.exhausted!);
      else p(s).randomChoices = available;
    } else go(story, s, target);
  } else if (step.kind === "combat")
    result = combat(story, s, step.combat, actionId, dice);
  else invalid("当前剧情不允许这个行动");
  settle(story, s, dice);
  return {
    state: s,
    action,
    check: result,
    dice: ruleDice,
    memory: node(story, s.nodeId).memory,
  };
}
