import { randomUUID } from "node:crypto";
import type {
  Character,
  CheckResult,
  RuleDiceResult,
  RunState,
  Registration,
  SceneView,
  Story,
  StoryNode,
} from "../contracts/index.js";
import type {
  Instruction,
  Mutation,
  Predicate,
  ProgramCheck,
  ProgramState,
  Value,
  CombatSpec,
} from "../contracts/program.js";
import type { FrostProgramCombatSpec } from "../contracts/frost.js";
import { resolveCheck, type DiceSource, secureDice } from "../rules/index.js";
import { attributeLabels, skillLabels } from "../contracts/character-labels.js";
import { initializeParty, companion, companionField, changeCompanionHp, restoreCompanion, availablePerformers, performer } from "./party.js";
import { calendarDay, setCalendar, advanceCalendar } from "./calendar.js";
import { initializeInvestigators, loseInvestigator, suspendInvestigator, inheritPossessions, activateNextInvestigator, resumeInvestigator, restartInvestigators } from "./investigators.js";
import { itemCount, setItemCount } from "./inventory.js";
import { distributionInput, distribute } from "./distribution.js";
import {
  applyFrostPartyAction,
  applyFrostResolvedTurn,
  applyFrostPartyDamageAllocation,
  currentFrostEnemy,
  currentFrostEnemyTarget,
  projectFrostPartyCombat,
  startFrostPartyCombat,
} from "./frost-combat.js";
import {
  availableFrostWeapons,
  refreshFrostCombatants,
  frostCombatants,
  pureFrostSpec,
  resolveFrostProgramSpec,
  syncFrostCombatants,
  type ResolvedFrostProgramSpec,
} from "./frost-adapter.js";
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
  if (key.startsWith("sanity.")) {
    if (key === "sanity.dayInitial") return p(s).sanityDay?.initial ?? s.character.sanity;
    if (key === "sanity.dayLost") return p(s).sanityDay?.lost ?? 0;
    if (key === "sanity.lastLoss") return p(s).counters.sanityLastLoss ?? 0;
    const condition = key.slice(7);
    if (["controlled", "temporary", "indefinite", "permanent"].includes(condition)) return (p(s).sanityCondition ?? "controlled") === condition ? 1 : 0;
    invalid(`未知理智状态字段 ${key}`);
  }
  if (key.startsWith("combat.")) {
    const current = p(s).combat;
    if (!current) {
      const frost = p(s).frostCombat?.state;
      if (!frost) invalid("当前没有战斗");
      if (key === "combat.round") return frost.round;
      if (key === "combat.alive") return frost.enemies.filter(enemy => enemy.hp > (enemy.stopAtHp ?? 0)).length;
      const match = /^combat\.enemy\.(\d+)\.hp$/.exec(key);
      const hp = match ? frost.enemies[Number(match[1])]?.hp : undefined;
      if (hp !== undefined) return hp;
      invalid(`未知战斗字段 ${key}`);
    }
    if (key === "combat.round") return current.round;
    if (key === "combat.alive") return (current.enemyLives ?? [current.hp]).filter(hp => hp > 0).length;
    const match = /^combat\.enemy\.(\d+)\.hp$/.exec(key);
    const hp = match ? (current.enemyLives ?? [current.hp])[Number(match[1])] : undefined;
    if (hp !== undefined) return hp;
    invalid(`未知战斗字段 ${key}`);
  }
  const inventoryField = /^inventory\.([\w-]+)\.count$/.exec(key);
  if (inventoryField) return itemCount(s, inventoryField[1]);
  const partyInventory = /^party\.([\w-]+)\.inventory\.([\w-]+)\.count$/.exec(key);
  if (partyInventory) return itemCount(s, partyInventory[2], partyInventory[1]);
  if (key.startsWith("campaign.")) {
    if (!s.investigators) invalid("本剧本未启用调查员接续");
    if (key === "campaign.losses") return s.investigators.totalLossCount;
    if (key === "campaign.cycleLosses") return s.investigators.cycleLossCount;
    if (key === "campaign.cycle") return s.investigators.cycle;
    invalid(`未知接续字段 ${key}`);
  }
  if (key.startsWith("clock.")) {
    if (!s.calendar) invalid("日历尚未初始化");
    if (key === "clock.day") return calendarDay(s.calendar.date);
    if (key === "clock.weekday") return ((calendarDay(s.calendar.date) + 4) % 7 + 7) % 7;
    if (key === "clock.elapsedMinutes") return s.calendar.elapsedMinutes;
    if (key === "clock.paused") return s.calendar.paused ? 1 : 0;
    if (s.calendar.minuteOfDay === null) invalid("请先登记当前时刻");
    if (key === "clock.minute") return s.calendar.minuteOfDay;
    if (key === "clock.hour") return Math.floor(s.calendar.minuteOfDay / 60);
    invalid(`未知日历字段 ${key}`);
  }
  if (key.startsWith("party.")) return companionField(s, key);
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
  if (key === "maxSanity") return s.character.maxSanity ?? 99;
  if (["hp", "maxHp", "sanity", "luck", "mp"].includes(key))
    return (s.character as unknown as Record<string, number>)[key] ?? 0;
  invalid(`未知数值字段 ${key}`);
}
export function value(s: RunState, v: Value, depth = 0): number {
  if (depth > 32) invalid("数值表达式嵌套过深");
  if (typeof v === "number") return v;
  if ("field" in v)
    return Math.floor(field(s, v.field) * (v.factor ?? 1) + (v.offset ?? 0));
  const args = v.values.map((part) => value(s, part, depth + 1));
  if (!args.length || args.length > 64) invalid("数值表达式参数数量错误");
  let result: number;
  switch (v.calc) {
    case "sum":
      result = args.reduce((a, b) => a + b, 0);
      break;
    case "product":
      result = args.reduce((a, b) => a * b, 1);
      break;
    case "min":
      result = Math.min(...args);
      break;
    case "max":
      result = Math.max(...args);
      break;
    case "difference":
    case "quotient":
    case "mod":
      if (args.length !== 2) invalid("二元表达式须有两个参数");
      if (v.calc !== "difference" && args[1] === 0)
        invalid("数值表达式不能除以零");
      result =
        v.calc === "difference"
          ? args[0] - args[1]
          : v.calc === "quotient"
            ? args[0] / args[1]
            : ((args[0] % args[1]) + Math.abs(args[1])) % Math.abs(args[1]);
      break;
  }
  if (!Number.isFinite(result)) invalid("数值表达式结果须为有限数值");
  return Math.floor(result);
}
export function matches(s: RunState, c?: Predicate): boolean {
  if (!c) return true;
  if ("note" in c) {
    const answer = p(s).notes?.[c.note]?.trim() ?? "";
    return c.caseInsensitive ? answer.toLocaleLowerCase("en") === c.equals.trim().toLocaleLowerCase("en") : answer === c.equals.trim();
  }
  if ("investigatorId" in c) return s.investigators?.current === c.investigatorId;
  if ("templateId" in c) return s.character.templateId === c.templateId;
  if ("item" in c) return itemCount(s, c.item) > 0 === c.has;
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
function mutations(s: RunState, ops: Mutation[], dice: DiceSource, calendarRules?: Story["calendar"], story?: Story) {
  for (const e of ops) {
    if (e.op === "item-count") {
      const amount = typeof e.value === "string" ? rollExpression(e.value, dice) : value(s, e.value);
      setItemCount(s, e.key, e.label, e.action === "add" ? Math.max(0, itemCount(s, e.key, e.member) + amount) : amount, e.member);
      continue;
    }
    if (e.op === "investigator") {
      if (!story) invalid("调查员接续需要剧本定义");
      if (e.action === "lose") loseInvestigator(story, s, e.reason, e.private, e.location);
      else if (e.action === "suspend") suspendInvestigator(story, s, value(s, e.minutes), e.resume);
      else inheritPossessions(story, s, e.from, e.location);
      continue;
    }
    if (e.op === "clock") {
      if (e.action === "set") s.calendar = setCalendar(e.date, e.minute === null ? null : value(s, e.minute), s.calendar);
      else {
        if (!s.calendar) invalid("日历尚未初始化");
        if (e.action === "pause" || e.action === "resume") s.calendar.paused = e.action === "pause";
        else if (e.action === "advance" || e.action === "advance-days") {
          const previous = s.calendar;
          s.calendar = advanceCalendar(previous, e.action === "advance" ? value(s, e.minutes) : value(s, e.days) * 1440, e.action === "advance-days");
          const days = calendarDay(s.calendar.date) - calendarDay(previous.date);
          const hours = Math.floor(s.calendar.elapsedMinutes / 60) - Math.floor(previous.elapsedMinutes / 60);
          if (calendarRules?.hpPerDay) s.character.hp = Math.min(s.character.maxHp, s.character.hp + days * calendarRules.hpPerDay);
          if (calendarRules?.mpPerHour && s.character.mp !== undefined) {
            const maxMp = s.character.attributes?.pow === undefined ? s.character.mp : Math.floor(s.character.attributes.pow / 5);
            s.character.mp = Math.min(maxMp, s.character.mp + hours * calendarRules.mpPerHour);
          }
        }
      }
      continue;
    }
    if (e.op === "party") {
      if (e.action === "status") {
        companion(s, e.member).status = e.value;
        companion(s, e.member).revealed = true;
      }
      else if (e.action === "unconscious") companion(s, e.member).unconscious = e.value;
      else if (e.action === "restore") restoreCompanion(s, e.member);
      else changeCompanionHp(s, e.member, typeof e.value === "string" ? rollExpression(e.value, dice) : value(s, e.value));
      continue;
    }
    if (e.op === "sanityCondition") {
      p(s).sanityCondition = e.value;
      continue;
    }
    if (e.op === "sanityBaseline") {
      if (p(s).sanityDay) p(s).sanityDay = { key: p(s).sanityDay!.key, initial: s.character.sanity, lost: 0 };
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
    else if (e.field.startsWith("party.")) {
      const match = /^party\.([\w-]+)\.(hp|sanity|skill\.[a-zA-Z]+|attribute\.[a-zA-Z]+)$/.exec(e.field);
      if (!match) invalid(`不可修改同伴字段 ${e.field}`);
      const member = companion(s, match[1]);
      if (match[2] === "hp") changeCompanionHp(s, member.id, next - member.character.hp);
      else if (match[2] === "sanity") member.character.sanity = Math.max(0, Math.min(member.character.maxSanity ?? 99, next));
      else if (match[2].startsWith("skill.")) member.character.skills[match[2].slice(6)] = Math.max(0, Math.min(99, next));
      else member.character.attributes![match[2].slice(10)] = next;
      p(s).log.push(`${member.character.name}：${match[2] === "hp" ? "生命" : match[2] === "sanity" ? "理智" : skillLabels[match[2].slice(6)] ?? attributeLabels[match[2].slice(10)]} ${e.op === "add" ? (v >= 0 ? "+" : "") + v : next}`);
      continue;
    }
    else if (e.field.startsWith("skill."))
      s.character.skills[e.field.slice(6)] = Math.max(0, Math.min(99, next));
    else if (e.field.startsWith("attribute."))
      s.character.attributes![e.field.slice(10)] = next;
    else if (e.field === "hp") {
      s.character.hp = Math.max(0, Math.min(s.character.maxHp, next));
      if (e.op === "add" && v < 0) p(s).counters.lastDamage = -v;
    } else if (e.field === "maxHp") {
      if (next < 1) invalid("最大生命须为正数");
      s.character.maxHp = next;
      s.character.hp = Math.min(s.character.hp, next);
    } else if (e.field === "maxSanity") {
      if (next < 0 || next > 99) invalid("最大理智须在 0 至 99 之间");
      s.character.maxSanity = next;
      s.character.sanity = Math.min(s.character.sanity, next);
    } else if (e.field === "sanity")
      s.character.sanity = Math.max(
        0,
        Math.min(s.character.maxSanity ?? 99, 99 - (s.character.skills.cthulhuMythos ?? 0), next),
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
    p(s).combat = saved.combat;
    p(s).frostCombat = saved.frostCombat;
    if (p(s).frostCombat) refreshFrostCombatants(s, p(s).frostCombat!.state);
    return;
  }
  node(story, target);
  s.nodeId = target;
  s.visitId = randomUUID();
  p(s).cursor = 0;
  p(s).visits[target] = (p(s).visits[target] ?? 0) + 1;
  p(s).combat = undefined;
  p(s).frostCombat = undefined;
  p(s).counters.combatActions = 0;
}
function interrupt(story: Story, s: RunState, target: string) {
  p(s).returns.push({
    nodeId: s.nodeId,
    cursor: p(s).cursor,
    visitId: s.visitId,
    ...(p(s).combat ? { combat: structuredClone(p(s).combat) } : {}),
    ...(p(s).frostCombat ? { frostCombat: structuredClone(p(s).frostCombat) } : {}),
  });
  go(story, s, target);
}
function health(
  story: Story,
  s: RunState,
  before: { hp: number; sanity: number },
  routing?: StoryNode["healthRouting"],
) {
  const damage = before.hp - s.character.hp,
    loss = before.sanity - s.character.sanity;
  // Raw damage, including overkill, is recorded by the mutation.
  if (loss > 0) p(s).sanityLost += loss;
  if (story.healthPolicy === "frost") {
    const newMajorWound = damage > 0 && (p(s).counters.lastDamage ?? damage) >= Math.ceil(s.character.maxHp / 2);
    if (newMajorWound) s.flags.majorWound = true;
    if (damage > 0 && s.character.hp === 0) s.flags.unconscious = true;
    const key = s.calendar?.date ?? String(p(s).counters.frostDay ?? 0);
    if (!p(s).sanityDay || p(s).sanityDay!.key !== key) p(s).sanityDay = { key, initial: before.sanity, lost: 0 };
    if (loss > 0) p(s).sanityDay!.lost += loss;
    if (loss > 0) {
      p(s).counters.sanityLastLoss = loss;
      if (s.character.sanity === 0) p(s).sanityCondition = "permanent";
      else if (p(s).sanityDay!.initial > 0 && p(s).sanityDay!.lost >= Math.ceil(p(s).sanityDay!.initial / 5)) {
        p(s).sanityCondition = "indefinite";
      }
    }
    if (loss > 0 && routing?.sanity !== "source") {
      if (s.character.sanity === 0) {
        go(story, s, "550"); return;
      }
      if (p(s).sanityDay!.initial > 0 && p(s).sanityDay!.lost >= Math.ceil(p(s).sanityDay!.initial / 5)) {
        go(story, s, "364");
        return;
      }
      if (loss >= 5) {
        interrupt(story, s, "frost-insanity-check"); return;
      }
    }
    if (damage > 0 && routing?.injury !== "source") {
      if (s.character.hp === 0 && s.flags.majorWound) { s.flags.unconscious = true; go(story, s, "191"); }
      else if (newMajorWound) interrupt(story, s, "frost-major-wound-check");
    }
    return;
  }
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
  call = false,
) {
  const before = { hp: s.character.hp, sanity: s.character.sanity };
  const routing = node(story, s.nodeId).healthRouting;
  mutations(s, ops, dice, story.calendar, story);
  if (next) {
    if (call) interrupt(story, s, next);
    else go(story, s, next);
  }
  health(story, s, before, routing);
}
function instruction(story: Story, s: RunState): Instruction {
  const step = node(story, s.nodeId).program![p(s).cursor];
  if (!step) throw new Error(`未终止的程序 ${s.nodeId}:${p(s).cursor}`);
  return step;
}
function resolvedFrostSpec(s: RunState, source: FrostProgramCombatSpec): ResolvedFrostProgramSpec {
  return resolveFrostProgramSpec(source, (v) => value(s, v));
}
function pureFrostCombatSpec(source: ResolvedFrostProgramSpec) {
  return pureFrostSpec(source);
}
function syncFrostParty(s: RunState) {
  if (p(s).frostCombat) syncFrostCombatants(s, p(s).frostCombat!.state);
}
function initializeFrostCombat(s: RunState, source: FrostProgramCombatSpec) {
  const resolved = resolvedFrostSpec(s, source);
  const pure = pureFrostCombatSpec(resolved);
  const party = frostCombatants(s, source.participants, (condition) => matches(s, condition));
  const state = startFrostPartyCombat(pure, party);
  p(s).frostCombat = { state, completedRoundCalls: [] };
  syncFrostParty(s);
}
function frostDamageRoll(expr: string, db: string | undefined, result: CheckResult, dice: DiceSource, impaling = false, bonusDiceExtreme = false) {
  const extreme = ["extreme", "critical"].includes(result.grade);
  const base = extreme && bonusDiceExtreme
    ? rollExpression(expr, (_min, max) => max - 1)
    : rollExpression(expr, dice);
  const extra = extreme && impaling ? rollExpression(expr, dice) : 0;
  const resolvedBonus = db && db !== "none" ? rollExpression(db, extreme && bonusDiceExtreme ? (_min, max) => max - 1 : dice) : 0;
  return Math.max(0, base + extra + resolvedBonus);
}
function finishFrostTransition(story: Story, s: RunState, source: FrostProgramCombatSpec, previousRound: number, dice: DiceSource) {
  const saved = p(s).frostCombat;
  if (!saved) return;
  const resolved = resolvedFrostSpec(s, source), spec = pureFrostCombatSpec(resolved), combat = saved.state;
  refreshFrostCombatants(s, combat);
  for (const actor of combat.party) {
    const participant = source.participants.find((entry) => entry.id === actor.id);
    if (actor.kind === "companion") actor.active = !!participant && matches(s, participant.condition);
  }
  syncFrostParty(s);
  if (combat.pendingEnemyAttack) return;
  const sourcedRoute = source.routes?.find((route) => matches(s, route.condition));
  if (sourcedRoute) { go(story, s, sourcedRoute.target); return; }
  if (combat.outcome) {
    const destination = combat.outcome === "victory" ? source.win : combat.outcome === "defeat" ? source.lose : source.flee;
    if (!destination) invalid("集体战结局缺少来源目标");
    go(story, s, destination);
    return;
  }
  const hookIndex = source.roundCalls?.findIndex((hook, index) =>
    hook.afterRound <= previousRound && combat.round > hook.afterRound && !saved.completedRoundCalls.includes(index),
  ) ?? -1;
  if (hookIndex >= 0) {
    const hook = source.roundCalls![hookIndex];
    saved.completedRoundCalls.push(hookIndex);
    interrupt(story, s, hook.call);
  }
}
function settle(story: Story, s: RunState, dice: DiceSource) {
  for (let i = 0; i < 128; i++) {
    if (p(s).preview) return;
    const step = instruction(story, s);
    if (step.kind === "investigator") {
      if (step.action === "resume" || (step.action === "activate-next" && s.investigators?.suspended && s.investigators.actors[s.investigators.current]?.status === "lost")) resumeInvestigator(story, s);
      else go(story, s, step.action === "restart" ? restartInvestigators(story, s, !!step.reuse) : activateNextInvestigator(story, s));
      continue;
    }
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
    if (step.kind === "partyCombat") {
      if (!p(s).frostCombat) initializeFrostCombat(s, step.combat);
      const combat = p(s).frostCombat!.state;
      if (combat.outcome) {
        finishFrostTransition(story, s, step.combat, combat.round - 1, dice);
        if (!p(s).frostCombat) continue;
      }
      return;
    }
    if (step.kind === "call") {
      p(s).cursor++;
      if (matches(s, step.condition)) interrupt(story, s, step.target);
      continue;
    }
    if (step.kind === "check" && !matches(s, step.condition)) {
      p(s).cursor++;
      continue;
    }
    if (step.kind === "end") s.status = "ended";
    if (step.kind === "combat" && !p(s).combat) {
      const enemyHp = value(s, step.combat.hp);
      if (enemyHp <= 0) invalid("敌人生命须为正数");
      p(s).counters.combatDamageTaken = 0;
      if (step.combat.options || step.combat.damageGoal) p(s).counters.combatDamageDealt = 0;
      p(s).combat = {
        nodeId: s.nodeId,
        hp: enemyHp,
        round: 1,
        playerTurn: step.combat.initiative ? step.combat.initiative === "player-first" : (s.character.attributes?.dex ?? 0) >= step.combat.dex!,
        phase: 0,
        armor: step.combat.armor ?? 0,
        stance:
          step.combat.randomStance && dice(1, 7) % 2 === 0 ? "dodge" : "fight",
      };
      if (step.combat.count !== undefined) {
        const count = value(s, step.combat.count);
        if (count < 1 || count > 100) invalid("敌人数量须在1到100之间");
        p(s).combat!.enemyLives = Array(count).fill(enemyHp);
        p(s).combat!.enemyArmor = Array(count).fill(step.combat.armor ?? 0);
        p(s).combat!.order = combatTurnOrder(s, step.combat);
      }
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
  initializeInvestigators(story, s);
  s.party = initializeParty(story.party);
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
  performerId?: string,
): CheckResult {
  const spec = checkSpec(s, c);
  performerId ??= c.actor;
  const actor = performerId ? performer(s, performerId, c.skill) : s.character;
  const clone = structuredClone(actor);
  if (spec.target !== undefined) clone.skills.__custom = spec.target;
  const other =
    c.opposed !== undefined ? opponent(s, value(s, c.opposed), dice, c.opposedBonus ?? 0, c.opposedPenalty ?? 0) : undefined;
  const result = resolveCheck(
    clone,
    { ...spec, skill: spec.target !== undefined ? "__custom" : spec.skill },
    dice,
    targetBonus,
  );
  result.skill = c.skill;
  if (performerId) result.performer = { id: performerId, name: actor.name };
  if (other) {
    result.opponent = {
      roll: other.roll,
      target: other.target,
      grade: other.grade,
    };
    const base =
      spec.target ?? actor.skills[c.skill] ?? actor.attributes?.[c.skill] ?? 0;
    result.success =
      ranks[result.grade] > ranks[other.grade] ||
      (ranks[result.grade] === ranks[other.grade] &&
        (c.opposedTie === "check"
          ? true
          : c.opposedTie === "opponent"
            ? false
            : base > value(s, c.opposed!)));
    p(s).log.push(
      `对抗检定：对方 ${other.roll}/${other.target} ${gradeNames[other.grade]}`,
    );
  }
  if (c.fumbleAt && result.roll >= c.fumbleAt) {
    result.grade = "fumble";
    result.success = false;
  }
  p(s).counters.nextBonus = 0;
  if ((!performerId || performerId === "$player") && c.skill in s.character.skills) p(s).lastSkill = c.skill;
  else delete p(s).lastSkill;
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
  if (story.id === "alone-against-frost" && result.opponent) {
    if (!story.spendLuck || result.success || result.grade === "fumble" || ["luck", "sanity"].includes(result.skill)) return undefined;
    const opponentRank = ranks[result.opponent.grade];
    for (let roll = result.roll - 1; roll >= 1; roll--) {
      const grade = frostGradeAtRoll(roll, result.target);
      const ownRank = ranks[grade];
      const wins = ownRank > opponentRank || (ownRank === opponentRank && result.target > result.opponent.target);
      const cost = result.roll - roll;
      if (wins && cost > 0 && cost <= s.character.luck) return cost;
    }
    return undefined;
  }
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
function frostCombatLuckCost(result: CheckResult, availableLuck: number, action: "attack" | "dodge" | "fightBack", firearm: boolean) {
  if (result.grade === "fumble" || result.skill === "luck" || result.skill === "sanity") return undefined;
  const currentRank = ranks[result.grade], opponentRank = result.opponent ? ranks[result.opponent.grade] : 0;
  const currentlySucceeds = action === "attack"
    ? currentRank > 0 && (firearm || currentRank >= opponentRank)
    : action === "dodge" ? currentRank > 0 && currentRank >= opponentRank : currentRank > opponentRank;
  if (currentlySucceeds) return undefined;
  let requiredRoll = result.target;
  if (result.opponent) {
    const rank = ranks[result.opponent.grade];
    const neededRank = action === "dodge" ? Math.max(1, rank) : action === "fightBack" ? rank + 1 : Math.max(1, rank);
    if (neededRank > 4) return undefined;
    requiredRoll = neededRank >= 4 ? 1 : neededRank === 3 ? Math.floor(result.target / 5) : neededRank === 2 ? Math.floor(result.target / 2) : result.target;
  }
  const cost = result.roll - requiredRoll;
  return cost > 0 && cost <= availableLuck ? cost : undefined;
}
function frostGradeAtRoll(roll: number, target: number): CheckResult["grade"] {
  return roll === 1 ? "critical" : roll === 100 || (target < 50 && roll >= 96) ? "fumble" : roll <= Math.floor(target / 5) ? "extreme" : roll <= Math.floor(target / 2) ? "hard" : roll <= target ? "regular" : "failure";
}
function frostCombatSuccess(result: CheckResult, action: "attack" | "dodge" | "fightBack", firearm: boolean) {
  const own = ranks[result.grade], other = result.opponent ? ranks[result.opponent.grade] : 0;
  return action === "attack" ? own > 0 && (firearm || own >= other) : action === "dodge" ? own > 0 && own >= other : own > other;
}
function completeFrostCombatCheck(story: Story, s: RunState, source: FrostProgramCombatSpec, result: CheckResult, continuation: NonNullable<ProgramState["pending"]>["frostCombat"], dice: DiceSource) {
  if (!continuation || !p(s).frostCombat) invalid("缺少待完成的冰霜战斗检定");
  const saved = p(s).frostCombat!, resolved = resolvedFrostSpec(s, source), spec = pureFrostCombatSpec(resolved);
  refreshFrostCombatants(s, saved.state);
  const previousRound = saved.state.round, before = { hp: s.character.hp, sanity: s.character.sanity };
  const enemy = saved.state.enemies.find((entry) => entry.id === continuation.enemyId);
  const enemySource = resolved.enemies.find((entry) => entry.id === continuation.enemyId);
  const actor = continuation.actorId === "$player" ? { id: "$player", character: s.character } : saved.state.party.find((member) => member.id === continuation.actorId);
  if (!enemy || !enemySource || !actor) invalid("待完成战斗参与者已不存在");
  let damageTo: "party" | "enemy" | "none" = "none", damage = 0, damageTargetId: string | undefined;
  let actionLabel = result.label;
  if (continuation.side === "party") {
    const weapon = availableFrostWeapons(s, source, continuation.actorId, (condition) => matches(s, condition), (fieldName) => field(s, fieldName)).find((entry) => entry.id === continuation.weaponId);
    if (!weapon) invalid("待完成战斗武器已不存在");
    // Preserve the selected weapon through the saved Luck continuation. Consume
    // its ammunition only after the result is committed, so the last round does
    // not make the weapon disappear before damage is resolved.
    if (weapon.ammo) mutations(s, [{ op: "add", field: weapon.ammo, value: -(weapon.shots ?? 1) }], dice);
    if (source.sourceSection === "391" && continuation.actorId === "$player") p(s).counters.frost391RifleShots = 0;
    const ownRank = ranks[result.grade], enemyRank = result.opponent ? ranks[result.opponent.grade] : 0;
    const friendlyFire = !!weapon.firearm && result.grade === "fumble" && !!weapon.fumbleTarget;
    const hitEnemy = !friendlyFire && (weapon.firearm ? result.success : ownRank > 0 && ownRank >= enemyRank);
    const hitParty = !weapon.firearm && enemyRank > 0 && enemyRank > ownRank;
    result.success = hitEnemy;
    if (friendlyFire) {
      damageTo = "party";
      damageTargetId = weapon.fumbleTarget;
      damage = frostDamageRoll(weapon.damage, weapon.damageBonus ? actor.character.damageBonus : undefined, result, dice, false, false);
    } else if (hitEnemy) {
      damageTo = "enemy";
      damage = frostDamageRoll(weapon.damage, weapon.damageBonus ? actor.character.damageBonus : undefined, result, dice, !!weapon.impaling, true);
    } else if (hitParty && result.opponent) {
      damageTo = "party";
      damage = frostDamageRoll(enemySource.damage, undefined, { ...result, grade: result.opponent.grade }, dice, !!enemySource.impaling, false);
    }
    actionLabel = `${actor.character.name}使用${weapon.label}`;
  } else {
    const weapon = continuation.action === "fightBack" ? availableFrostWeapons(s, source, continuation.targetId, (condition) => matches(s, condition), (fieldName) => field(s, fieldName)).find((entry) => entry.id === continuation.weaponId && !entry.firearm) : undefined;
    if (continuation.action === "fightBack" && !weapon) invalid("待完成反击武器已不存在");
    if (!result.opponent) invalid("待完成敌方攻击缺少对手检定");
    const defenderRank = ranks[result.grade], attackerRank = ranks[result.opponent.grade], noOneSucceeded = defenderRank === 0 && attackerRank === 0;
    if (continuation.action === "fightBack" && !noOneSucceeded && defenderRank > attackerRank) {
      damageTo = "enemy";
      damage = frostDamageRoll(weapon!.damage, weapon!.damageBonus ? actor.character.damageBonus : undefined, result, dice, !!weapon!.impaling, false);
      if (weapon!.ammo) mutations(s, [{ op: "add", field: weapon!.ammo, value: -(weapon!.shots ?? 1) }], dice);
    } else if (!noOneSucceeded && (continuation.action === "fightBack" ? attackerRank >= defenderRank : attackerRank > defenderRank)) {
      damageTo = "party";
      damage = frostDamageRoll(enemySource.damage, undefined, { ...result, grade: result.opponent.grade }, dice, !!enemySource.impaling, true);
    }
    result.success = damageTo === "enemy" || (damageTo === "none" && continuation.action === "dodge" && !noOneSucceeded);
    actionLabel = continuation.action === "fightBack" ? `${actor.character.name}反击` : `${actor.character.name}闪避`;
  }
  saved.state = applyFrostResolvedTurn(spec, saved.state, { side: continuation.side, actorId: continuation.side === "party" ? continuation.actorId : continuation.enemyId, targetId: continuation.side === "party" ? continuation.enemyId : continuation.targetId, enemyId: continuation.enemyId, check: result, damageTo, damage, ...(damageTargetId ? { damageTargetId } : {}) });
  syncFrostParty(s);
  health(story, s, before, node(story, s.nodeId).healthRouting);
  if (p(s).frostCombat) finishFrostTransition(story, s, source, previousRound, dice);
  return { action: actionLabel, result };
}
function checkDone(
  story: Story,
  s: RunState,
  c: ProgramCheck,
  result: CheckResult,
  dice: DiceSource,
  pushed = false,
) {
  for (const [kind, key] of Object.entries(c.record ?? {})) {
    p(s).counters[key] = kind === "roll" ? result.roll : kind === "target" ? result.target : kind === "success" ? Number(result.success)
      : { fumble: -1, failure: 0, regular: 1, hard: 2, extreme: 3, critical: 4 }[result.grade];
  }
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
  if (p(s).preview) return { actions: [{ id: "return-from-reading", label: "下一节" }], notices: p(s).log };
  const step = instruction(story, s);
  let actions: SceneView["actions"] = [],
    check: SceneView["check"],
    input: SceneView["input"],
    frostCombat: SceneView["frostCombat"];
  if (p(s).randomChoices)
    actions = p(s).randomChoices!.map((id) => ({
      id: `random-${id}`,
      label: `选择尚未经历的症状 ${id}`,
    }));
  else if (p(s).pending?.frostCombat) {
    const pending = p(s).pending!, continuation = pending.frostCombat!;
    const combatStep = step.kind === "partyCombat" ? step.combat : undefined;
    const weapon = combatStep && continuation.weaponId ? availableFrostWeapons(s, combatStep, continuation.side === "party" ? continuation.actorId : continuation.targetId, (condition) => matches(s, condition), (fieldName) => field(s, fieldName)).find((entry) => entry.id === continuation.weaponId) : undefined;
    const cost = story.spendLuck && continuation.actorId === "$player"
      ? frostCombatLuckCost(pending.result, s.character.luck, continuation.action, !!weapon?.firearm)
      : undefined;
    actions = [{ id: "accept", label: "保留本次战斗检定结果" }];
    if (cost !== undefined) actions.push({ id: "spend-luck", label: `花费 ${cost} 点幸运，调整本次检定` });
    check = { label: pending.result.label, target: pending.result.target, difficulty: "regular" };
  }
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
  } else if (step.kind === "read") actions = [{ id: "read", label: "查看线索" }];
  else if (step.kind === "rollEffects")
    actions = [{ id: "roll", label: step.label }];
  else if (step.kind === "check") {
    actions = step.check.delegate ? availablePerformers(s, step.check.skill).map((actor) => ({
      id: `roll-actor:${actor.id}`, label: `${actor.character.name}进行${step.check.label}检定`,
    })) : [{ id: "roll", label: `进行${step.check.label}检定` }];
    const spec = checkSpec(s, step.check);
    const c = step.check.actor ? performer(s, step.check.actor, step.check.skill) : s.character;
    const b =
      spec.target ??
      (c.skills[spec.skill] ??
        c.attributes?.[spec.skill] ??
        (c as unknown as Record<string, number>)[spec.skill]) *
        (spec.multiplier ?? 1);
    check = step.check.delegate ? undefined : {
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
            (!step.allocation.allowedSkills || step.allocation.allowedSkills.includes(key)) &&
            (step.allocation.kind !== "interests" ||
              step.allocation.allowOccupation ||
              !p(s).occupationSkills.includes(key)),
        )
        .map(([key, value]) => ({
          key,
          label: attributeLabels[key] ?? skillLabels[key] ?? key,
          value,
        })),
    };
  } else if (step.kind === "text") {
    actions = [{ id: "confirm", label: "记录并继续" }];
    input = { kind: "text", label: step.label, minLength: step.minLength ?? 1, maxLength: step.maxLength, value: p(s).notes?.[step.key] ?? "" };
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
  } else if (step.kind === "distribute") {
    actions = [{ id: "distribute", label: "确认分配" }];
    input = distributionInput(s, step, value(s, step.total));
  } else if (step.kind === "random")
    actions = [{ id: "roll", label: `掷 D${step.sides}` }];
  else if (step.kind === "combat") {
    const c = p(s).combat!;
    actions = c.wounded
      ? [{ id: "consciousness", label: "进行体质检定，保持清醒" }]
      : c.playerTurn
        ? step.combat.weapons ? availableWeapons(s, step.combat).flatMap(weapon => (c.enemyLives ?? [c.hp]).flatMap((hp, index) => hp > step.combat.winHp ? [{ id: `attack:${weapon.id}:${index}`, label: `${weapon.label}攻击${c.enemyLives ? `第${index + 1}个对手` : ""}` }] : [])) : [{ id: "attack", label: "攻击" }]
        : [
            ...(step.combat.dodgeOnly ? [] : step.combat.weapons ? availableWeapons(s, step.combat).filter(weapon => !weapon.firearm).map(weapon => ({ id: `fightBack:${weapon.id}`, label: `${weapon.label}反击` })) : [{ id: "fightBack", label: "反击" }]),
            { id: "dodge", label: "闪避" },
          ];
    if (step.combat.escape && c.playerTurn && (step.combat.escape.eachPlayerTurn || c.round > step.combat.escape.after))
      actions.push({ id: "escape", label: "尝试脱离战斗" });
    if (!p(s).pending?.frostCombat) actions.push(...(step.combat.options ?? []).filter(choice => matches(s, choice.condition) && (!choice.once || !p(s).used[choice.once])).map(choice => ({ id: choice.id, label: choice.label })));
    return {
      actions,
      notices: p(s).log,
      combat: {
        name: step.combat.name,
        ...(c.enemyLives ? { enemyLives: c.enemyLives } : {}),
        ...(!step.combat.damageGoal ? { hp: c.hp } : { damageGoal: { label: step.combat.damageGoal.label, amount: step.combat.damageGoal.amount, dealt: p(s).counters.combatDamageDealt ?? 0, remaining: Math.max(0, step.combat.damageGoal.amount - (p(s).counters.combatDamageDealt ?? 0)) } }),
        round: c.round,
        turn: c.wounded
          ? "你受到重伤，先检定能否保持清醒"
          : c.playerTurn
            ? c.stance === "dodge"
              ? "轮到你行动，对手准备闪避"
              : "轮到你行动，请选择攻击"
            : "对手正在攻击，请选择反击或闪避",
        armor: c.armor,
        weapon: step.combat.weapons ? availableWeapons(s, step.combat).map(weapon => `${weapon.label}：${weapon.damage}${weapon.ammo ? `（弹药 ${field(s, weapon.ammo)}）` : ""}`).join("、") : s.inventory.some((i) => i.key === "knife")
          ? `猎刀：1D4 + ${s.character.damageBonus ?? "0"}`
          : `徒手：1D3 + ${s.character.damageBonus ?? "0"}`,
      },
      records: registrations(s).map((r) => r.label),
      registrations: registrations(s),
    };
  }
  if (step.kind === "partyCombat") {
    if (!p(s).frostCombat) initializeFrostCombat(s, step.combat);
    const saved = p(s).frostCombat!;
    const resolved = resolvedFrostSpec(s, step.combat), spec = pureFrostCombatSpec(resolved);
    frostCombat = projectFrostPartyCombat(spec, saved.state);
    const pending = saved.state.pendingEnemyAttack;
    if (p(s).pending?.frostCombat) {
      // The saved check is awaiting the player's optional Luck decision.
    } else if (pending) {
      actions = [{ id: "frost-distribute", label: "确认伤害分担" }];
      const recipients = frostCombat.damageInput?.recipients ?? [];
      input = {
        kind: "distribution", label: `分担 ${frostCombat.damageInput?.total ?? 0} 点伤害`, resource: "damage",
        total: frostCombat.damageInput?.total ?? 0,
        entries: recipients.map((id) => { const actor = saved.state.party.find((member) => member.id === id)!; return { key: id, label: actor.character.name, value: actor.character.hp }; }),
        ...(step.combat.protectedStudents ? { protected: [...step.combat.protectedStudents] } : {}),
        minimums: frostCombat.damageInput?.minimumByMember ?? {},
      };
    } else if (saved.state.phase === "party") {
      const actorId = frostCombat.currentActorId, actor = saved.state.party.find((member) => member.id === frostCombat!.currentActorId);
      if (actorId && actor) {
        const weapons = availableFrostWeapons(s, step.combat, actorId, (condition) => matches(s, condition), (fieldName) => field(s, fieldName));
        actions = weapons.flatMap((weapon) => saved.state.enemies.filter((enemy) => enemy.hp > (enemy.stopAtHp ?? 0)).map((enemy) => ({ id: `frost-attack:${weapon.id}:${enemy.id}`, label: `${actor.character.name}用${weapon.label}攻击${enemy.name}` })));
        if (step.combat.flee) actions.push({ id: "frost-flee", label: "尝试逃离" });
      }
    } else if (saved.state.phase === "enemy") {
      const enemy = currentFrostEnemy(spec, saved.state), target = currentFrostEnemyTarget(spec, saved.state);
      if (enemy && target) {
        actions = [{ id: "frost-enemy:dodge", label: `${target.character.name}闪避${enemy.name}的攻击` }];
        const weapons = availableFrostWeapons(s, step.combat, target.id, (condition) => matches(s, condition), (fieldName) => field(s, fieldName)).filter((weapon) => !weapon.firearm);
        actions.push(...weapons.map((weapon) => ({ id: `frost-enemy:fightBack:${weapon.id}`, label: `${target.character.name}用${weapon.label}反击${enemy.name}` })));
      }
    }
    if (!pending && !p(s).pending?.frostCombat) actions.push(...(step.combat.options ?? []).filter((choice) => matches(s, choice.condition) && (!choice.once || !p(s).used[choice.once])).map((choice) => ({ id: choice.id, label: choice.label })));
  }
  return {
    actions,
    check,
    input,
    ...(frostCombat ? { frostCombat } : {}),
    ...(step.kind === "end" ? { ending: step.label } : {}),
    notices: p(s).log,
    records: registrations(s).map((r) => r.label),
    registrations: registrations(s),
    ...(p(s).notes && Object.keys(p(s).notes!).length ? {
      playerNotes: Object.entries(p(s).notes!).map(([key, text]) => ({ key, label: p(s).noteLabels?.[key] ?? key, text })),
    } : {}),
  };
}
export function projectProgram(story: Story, s: RunState): Partial<SceneView> {
  const view = projectProgramRaw(story, s);
  if (p(s).preview) {
    const reading = node(story, p(s).preview!.nodeId);
    return { ...view, actions: [{ id: "next", label: "下一节" }], title: reading.title, chapter: reading.chapter,
      text: narrativeText(reading.text), reading: reading.reading, help: reading.help, illustration: reading.illustration,
      visitId: p(s).preview!.visitId, collection: { chapterId: reading.sourceId ?? reading.id } };
  }
  const step = instruction(story, s);
  if (
    !p(s).pending &&
    ["choices", "check", "rollEffects", "random", "read"].includes(step.kind) &&
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
        (a.allowedSkills !== undefined && !a.allowedSkills.includes(k)) ||
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
    for (const [key, minimum] of Object.entries(a.minimums ?? {})) {
      if (!Object.hasOwn(s.character.skills, key)) invalid("技能下限引用了未知技能");
      if (s.character.skills[key] + Number(input[key] ?? 0) < minimum)
        invalid(`${skillLabels[key] ?? key}须至少达到 ${minimum}`);
    }
    for (const k of keys) s.character.skills[k] += Number(input[k]);
    if (a.occupation) {
      s.character.occupation = a.occupation;
      p(s).occupationSkills = a.allowedSkills ?? keys;
    }
    if (a.credit !== undefined) s.character.skills.creditRating = a.credit;
    if (Object.keys(specialtyValues).length)
      s.character.specializations = { ...s.character.specializations, ...specialtyValues };
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
function opponent(s: RunState, skill: number, dice: DiceSource, bonus = 0, penalty = 0) {
  return resolveCheck(
    { ...s.character, skills: { enemy: skill } },
    {
      skill: "enemy",
      label: "对手",
      difficulty: "regular",
      ...(bonus ? { bonusDice: bonus } : {}),
      ...(penalty ? { penaltyDice: penalty } : {}),
      success: "",
      failure: "",
    },
    dice,
  );
}
function availableWeapons(s: RunState, spec: CombatSpec) {
  return (spec.weapons ?? []).filter(weapon => matches(s, weapon.condition) && (!weapon.key || itemCount(s, weapon.key) > 0) && (!weapon.ammo || field(s, weapon.ammo) >= (weapon.shots ?? 1)));
}
function combatTurnOrder(s: RunState, spec: CombatSpec) {
  const c = p(s).combat!;
  const first = spec.initiative ? spec.initiative === "player-first" : (s.character.attributes?.dex ?? 0) >= spec.dex!;
  const attacks = spec.attacks?.[(c.round - 1) % spec.attacks.length] ?? [{ skill: spec.fighting, damage: spec.damage }];
  return [...(first ? ["player"] : []), ...(c.stance === "fight" ? (c.enemyLives ?? [c.hp]).flatMap((hp, enemy) => hp > spec.winHp ? attacks.map((_, attack) => `${enemy}:${attack}`) : []) : []), ...(!first ? ["player"] : [])];
}
function combat(
  story: Story,
  s: RunState,
  spec: Extract<Instruction, { kind: "combat" }>["combat"],
  action: string,
  dice: DiceSource,
) {
  const c = p(s).combat!;
  const parsed = /^(attack|fightBack):([\w-]+)(?::(\d+))?$/.exec(action);
  const weapon = parsed ? availableWeapons(s, spec).find(value => value.id === parsed[2]) : undefined;
  if (parsed && (!weapon || (parsed[1] === "fightBack" && weapon.firearm))) invalid("当前武器不可用于此行动");
  if (spec.weapons && ["attack", "fightBack"].includes(action)) invalid("请选择可用武器");
  if (parsed) action = parsed[1];
  const attackList = spec.attacks?.[(c.round - 1) % spec.attacks.length] ?? [
    { skill: spec.fighting, damage: spec.damage },
  ];
  const first = spec.initiative ? spec.initiative === "player-first" : (s.character.attributes?.dex ?? 0) >= spec.dex!;
  const order = c.order ?? [
    ...(first ? ["player"] : []),
    ...(c.stance === "fight" ? attackList.map((_, i) => String(i)) : []),
    ...(!first ? ["player"] : []),
  ];
  const enemyIndex = c.playerTurn ? Number(parsed?.[3] ?? (c.enemyLives?.findIndex(hp => hp > spec.winHp) ?? 0)) : c.enemyLives ? Number(order[c.phase].split(":")[0]) : 0;
  if (c.enemyLives && (!Number.isSafeInteger(enemyIndex) || enemyIndex < 0 || enemyIndex >= c.enemyLives.length || c.enemyLives[enemyIndex] <= spec.winHp)) invalid("当前目标不可攻击");
  if (c.enemyLives) { c.hp = c.enemyLives[enemyIndex]; c.armor = c.enemyArmor![enemyIndex]; }
  const nextPhase = () => {
    c.phase++;
    if (c.order && c.enemyLives) {
      while (c.phase < c.order.length && c.order[c.phase] !== "player" && c.enemyLives[Number(c.order[c.phase].split(":")[0])] <= spec.winHp) c.phase++;
    }
    if (c.phase >= order.length) {
      c.phase = 0;
      c.round++;
      if (spec.coreRules) c.defended = 0;
      c.armor = spec.armor ?? 0;
      c.stance = spec.randomStance && dice(1, 7) % 2 === 0 ? "dodge" : "fight";
      if (c.enemyLives) {
        c.enemyArmor = Array(c.enemyLives.length).fill(spec.armor ?? 0);
        c.order = combatTurnOrder(s, spec);
      }
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
    c.playerTurn = (c.order ?? nextOrder)[c.phase] === "player";
    const hook = spec.roundCalls?.find((hook, index) => hook.afterRound === c.round - 1 && !c.completedRoundCalls?.includes(index));
    if (hook) {
      c.completedRoundCalls ??= [];
      c.completedRoundCalls.push(spec.roundCalls!.indexOf(hook));
      interrupt(story, s, hook.call);
    }
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
    (spec.escape.eachPlayerTurn || c.round > spec.escape.after)
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
    attack = offense ? attackList[0] : attackList[c.enemyLives ? Number(order[c.phase].split(":")[1]) : Number(order[c.phase])];
  if (weapon?.ammo) mutations(s, [{ op: "add", field: weapon.ammo, value: -(weapon.shots ?? 1) }], dice);
  const player = resolve(
    s,
    {
      skill: action === "dodge" ? "dodge" : weapon?.skill ?? "fightingBrawl",
      label: action === "dodge" ? "闪避" : weapon?.label ?? "格斗（斗殴）",
      bonus: weapon?.bonus,
      penalty: weapon?.penalty,
    },
    dice,
  );
  const enemy = offense && weapon?.firearm ? undefined : opponent(
    s,
    offense
      ? c.stance === "dodge"
        ? spec.dodge
        : spec.fighting
      : attack.skill,
    dice,
    spec.coreRules && !offense && (c.defended ?? 0) > 0 ? 1 : 0,
  );
  if (spec.coreRules && !offense) c.defended = (c.defended ?? 0) + 1;
  if (enemy) player.opponent = {
    roll: enemy.roll,
    target: enemy.target,
    grade: enemy.grade,
    ...(spec.coreRules ? { candidates: enemy.candidates } : {}),
  };
  if (enemy) p(s).log.push(
    `${spec.name}：${enemy.roll}/${enemy.target} ${gradeNames[enemy.grade]}`,
  );
  const pr = ranks[player.grade],
    er = enemy ? ranks[enemy.grade] : 0;
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
        (db && db !== "none" ? rollExpression(db, extreme && spec.coreRules ? (_min, max) => max - 1 : dice) : 0),
    );
  };
  if (playerWins && action !== "dodge") {
    const knife = s.inventory.some((i) => i.key === "knife");
    const rolled = damageRoll(
      weapon?.damage ?? (knife ? "1D4" : "1D3"),
      weapon ? weapon.damageBonus ? s.character.damageBonus : undefined : s.character.damageBonus,
      player.grade,
      offense,
      weapon ? !!weapon.impaling : knife,
    );
    damage = Math.max(0, rolled - c.armor);
    c.armor = Math.max(0, c.armor - rolled);
    c.hp = Math.max(0, c.hp - damage);
    if (c.enemyLives) { c.enemyLives[enemyIndex] = c.hp; c.enemyArmor![enemyIndex] = c.armor; }
    player.combat.damage = damage;
    player.combat.recipient = "enemy";
    if (spec.options || spec.damageGoal) p(s).counters.combatDamageDealt = (p(s).counters.combatDamageDealt ?? 0) + damage;
    p(s).counters.combatLastDamage = damage;
    p(s).log.push(`${spec.name} 受到 ${damage} 点伤害`);
    if (spec.damageGoal && (p(s).counters.combatDamageDealt ?? 0) >= spec.damageGoal.amount) {
      go(story, s, spec.damageGoal.target);
      return player;
    }
  }
  if (enemyWins && (!offense || c.stance === "fight")) {
    damage = damageRoll(attack.damage, spec.damageBonus, enemy!.grade, !offense);
    s.character.hp = Math.max(0, s.character.hp - damage);
    p(s).counters.lastDamage = damage;
    p(s).counters.combatDamageTaken = (p(s).counters.combatDamageTaken ?? 0) + damage;
    player.combat.damage = damage;
    player.combat.recipient = "player";
    p(s).log.push(`受到 ${damage} 点伤害`);
    if (spec.damageLimit && p(s).counters.combatDamageTaken >= spec.damageLimit.amount) {
      go(story, s, spec.damageLimit.target);
      return player;
    }
    if (damage > 0 && ((story.healthPolicy !== "frost" && s.flags.majorWound) || damage >= s.character.maxHp / 2)) {
      s.flags.majorWound = true;
      c.wounded = true;
      return player;
    }
  }
  if (s.character.hp <= 0) {
    go(story, s, spec.lose);
    return player;
  }
  if (c.enemyLives ? c.enemyLives.every(hp => hp <= spec.winHp) : c.hp <= spec.winHp) {
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
  if (p(s).preview) {
    if (actionId !== "return-from-reading") invalid("当前只能返回之前的剧情");
    delete p(s).preview;
    action = "返回之前的剧情";
  } else if (p(s).randomChoices) {
    const target = actionId.replace("random-", "");
    if (!p(s).randomChoices!.includes(target)) invalid("此症状不可选");
    delete p(s).randomChoices;
    go(story, s, target);
  } else if (p(s).pending?.frostCombat) {
    const pending = p(s).pending!, continuation = pending.frostCombat!;
    if (step.kind !== "partyCombat" || !story.spendLuck || continuation.actorId !== "$player") invalid("这次战斗检定不能使用幸运点");
    const weapon = continuation.weaponId ? availableFrostWeapons(s, step.combat, continuation.side === "party" ? continuation.actorId : continuation.targetId, (condition) => matches(s, condition), (fieldName) => field(s, fieldName)).find((entry) => entry.id === continuation.weaponId) : undefined;
    const cost = frostCombatLuckCost(pending.result, s.character.luck, continuation.action, !!weapon?.firearm);
    if (!(["accept", "spend-luck"].includes(actionId)) || actionId === "spend-luck" && cost === undefined) invalid("当前战斗检定不允许此幸运操作");
    result = structuredClone(pending.result);
    delete p(s).pending;
    if (actionId === "spend-luck") {
      const originalRoll = result.roll;
      result.roll -= cost!;
      result.originalRoll = originalRoll;
      result.luckSpent = cost;
      result.grade = frostGradeAtRoll(result.roll, result.target);
      result.success = frostCombatSuccess(result, continuation.action, !!weapon?.firearm);
      s.character.luck -= cost!;
      p(s).log.push(`花费 ${cost} 点幸运，战斗检定由 ${originalRoll} 调整为 ${result.roll}`);
    }
    const completed = completeFrostCombatCheck(story, s, step.combat, result, continuation, dice);
    action = completed.action;
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
      result = resolve(s, pending.check, dice, 0, pending.performerId);
      checkDone(story, s, pending.check, result, dice, true);
    } else if (actionId === "spend-luck") {
      s.character.luck -= cost!;
      const adjustedRoll = pending.result.roll - cost!;
      // Non-opposed results store the difficulty-scaled threshold, not the base skill.
      // Keep the established grade when buying success at that threshold.
      const adjustedGrade = pending.result.opponent
        ? frostGradeAtRoll(adjustedRoll, pending.result.target)
        : pending.check.difficulty ?? "regular";
      const winsOpposed = pending.result.opponent
        ? ranks[adjustedGrade] > ranks[pending.result.opponent.grade] || (ranks[adjustedGrade] === ranks[pending.result.opponent.grade] && pending.result.target > pending.result.opponent.target)
        : undefined;
      result = {
        ...pending.result,
        originalRoll: pending.result.roll,
        roll: adjustedRoll,
        luckSpent: cost,
        success: winsOpposed ?? true,
        grade: adjustedGrade,
      };
      p(s).log.push(`花费 ${cost} 点幸运，检定${result.success ? "成功" : "仍失败"}`);
      checkDone(story, s, pending.check, result, dice);
    } else checkDone(story, s, pending.check, pending.result, dice);
  } else if (step.kind === "read" && actionId === "read") {
    node(story, step.target);
    p(s).cursor++;
    p(s).preview = { nodeId: step.target, visitId: randomUUID() };
    action = "查看线索";
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
          "field" in e.value &&
          e.value.factor !== undefined,
      );
      const multiplier =
        scaled &&
        (scaled.op === "set" || scaled.op === "add") &&
        typeof scaled.value === "object" &&
        "field" in scaled.value
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
  } else if (step.kind === "check" && (actionId === "roll" || actionId.startsWith("roll-actor:"))) {
    const selectedActor = actionId.startsWith("roll-actor:") ? actionId.slice(11) : undefined;
    if (step.check.delegate !== Boolean(selectedActor) && (step.check.delegate || selectedActor))
      invalid("请选择本次检定的执行者");
    const performerId = selectedActor ?? step.check.actor;
    result = resolve(s, step.check, dice, targetBonus, performerId);
    action = `进行${step.check.label}检定`;
    if (
      !result.success &&
      (step.check.push || luckCost(story, s, result) !== undefined)
    )
      p(s).pending = { check: step.check, result, ...(performerId ? { performerId } : {}) };
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
    apply(story, s, choice.effects ?? [], dice, choice.call ?? choice.target, Boolean(choice.call));
  } else if (step.kind === "allocation" && actionId === "allocate") {
    allocation(s, step.allocation, input);
    p(s).cursor++;
  } else if (step.kind === "text" && actionId === "confirm") {
    const text = input?.text;
    if (typeof text !== "string" || text.trim().length < (step.minLength ?? 1) || text.length > step.maxLength) invalid("请按要求填写记录");
    p(s).notes ??= {};
    p(s).noteLabels ??= {};
    p(s).notes![step.key] = text.trim();
    p(s).noteLabels![step.key] = step.label;
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
  } else if (step.kind === "distribute" && actionId === "distribute") {
    const before = { hp: s.character.hp, sanity: s.character.sanity };
    distribute(s, step, value(s, step.total), input);
    p(s).cursor++;
    health(story, s, before, node(story, s.nodeId).healthRouting);
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
    if (step.reroll?.includes(rolled)) {
      p(s).log.push("按本剧本的适配规则，此结果需重新掷骰。");
    } else if (step.unvisited && (p(s).visits[target] ?? 0) > 0) {
      const available = step.targets.filter((t) => !p(s).visits[t]);
      if (!available.length) go(story, s, step.exhausted!);
      else p(s).randomChoices = available;
    } else go(story, s, target);
  } else if (step.kind === "combat") {
    const option = step.combat.options?.find(choice => choice.id === actionId && matches(s, choice.condition) && (!choice.once || !p(s).used[choice.once]));
    if (option) {
      if (option.once) p(s).used[option.once] = true;
      action = option.label;
      apply(story, s, option.effects ?? [], dice, option.call ?? option.target, Boolean(option.call));
    } else result = combat(story, s, step.combat, actionId, dice);
  } else if (step.kind === "partyCombat") {
    if (!p(s).frostCombat) initializeFrostCombat(s, step.combat);
    const saved = p(s).frostCombat!, resolved = resolvedFrostSpec(s, step.combat), spec = pureFrostCombatSpec(resolved);
    const previousRound = saved.state.round, before = { hp: s.character.hp, sanity: s.character.sanity };
    const pending = saved.state.pendingEnemyAttack;
    if (actionId === "frost-distribute") {
      if (!pending || !input || Object.values(input).some((n) => typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)) invalid("当前没有可分配的战斗伤害");
      const shares = input as Record<string, number>;
      const recipients = projectFrostPartyCombat(spec, saved.state).damageInput?.recipients ?? [];
      if (Object.keys(shares).length !== recipients.length || recipients.some((id) => !Object.hasOwn(shares, id))) invalid("伤害分配必须覆盖且仅覆盖所有在场队员");
      saved.state = applyFrostPartyDamageAllocation(spec, saved.state, 0, shares);
      const playerShare = shares["$player"] ?? 0;
      p(s).counters.lastDamage = playerShare;
      if (playerShare > 0) p(s).counters.combatDamageTaken = (p(s).counters.combatDamageTaken ?? 0) + playerShare;
      if (step.combat.sourceSection === "391" && playerShare > 0) p(s).counters.frost391DamageTaken = (p(s).counters.frost391DamageTaken ?? 0) + playerShare;
    } else if (actionId === "frost-flee") {
      if (!step.combat.flee) invalid("来源未允许逃离本场战斗");
      const projection = projectFrostPartyCombat(spec, saved.state);
      const actorId = projection.currentActorId;
      if (!actorId || !projection.availableActions.some((entry) => entry.id === "flee")) invalid("当前队员不能逃离");
      saved.state = applyFrostPartyAction(spec, saved.state, { actorId, action: "flee" });
    } else if (actionId.startsWith("frost-attack:")) {
      if (saved.state.phase !== "party" || pending) invalid("当前不是队伍攻击阶段");
      const [, weaponId, enemyId] = actionId.split(":");
      const projection = projectFrostPartyCombat(spec, saved.state), actorId = projection.currentActorId;
      const actor = saved.state.party.find((member) => member.id === actorId);
      const weapon = actorId ? availableFrostWeapons(s, step.combat, actorId, (condition) => matches(s, condition), (fieldName) => field(s, fieldName)).find((entry) => entry.id === weaponId) : undefined;
      const enemy = saved.state.enemies.find((entry) => entry.id === enemyId && entry.hp > (entry.stopAtHp ?? 0));
      const enemySource = resolved.enemies.find((entry) => entry.id === enemyId);
      if (!actor || !weapon || !enemy || !enemySource || !actorId) invalid("当前行动不能使用该武器攻击此目标");
      const skill = actor.character.skills[weapon.skill] ?? actor.character.attributes?.[weapon.skill];
      if (skill === undefined) invalid("这名角色没有该武器要求的技能");
      const priorEnemyAttacks = saved.state.events.filter((event) => event.round === saved.state.round && event.side === "enemy" && event.targetId === actorId).length;
      result = resolve(s, {
        skill: weapon.skill, label: weapon.label, bonus: weapon.bonus, penalty: weapon.penalty,
        ...(!weapon.firearm ? { opposed: enemy.skills[enemySource.attackSkill], opposedBonus: priorEnemyAttacks > 0 ? 1 : 0 } : {}),
      }, dice, 0, actorId === "$player" ? undefined : actorId);
      const continuation = { side: "party" as const, actorId, targetId: enemyId, enemyId, action: "attack" as const, weaponId };
      const luck = story.spendLuck && actorId === "$player" ? frostCombatLuckCost(result, s.character.luck, "attack", !!weapon.firearm) : undefined;
      if (luck !== undefined) {
        p(s).pending = { check: { skill: weapon.skill, label: weapon.label, target: result.target }, result: structuredClone(result), frostCombat: continuation };
        action = `${actor.character.name}使用${weapon.label}，等待幸运点调整`;
      } else {
        const completed = completeFrostCombatCheck(story, s, step.combat, result, continuation, dice);
        action = completed.action;
      }
    } else if (actionId === "frost-enemy:dodge" || actionId.startsWith("frost-enemy:fightBack:")) {
      if (saved.state.phase !== "enemy" || pending) invalid("当前不是敌方行动阶段");
      const enemy = currentFrostEnemy(spec, saved.state), target = currentFrostEnemyTarget(spec, saved.state);
      if (!enemy || !target) invalid("当前没有可执行的敌方行动");
      const enemySource = resolved.enemies.find((entry) => entry.id === enemy.id);
      if (!enemySource) invalid("敌方来源数据缺失");
      const fightBack = actionId.startsWith("frost-enemy:fightBack:");
      const weaponId = fightBack ? actionId.slice("frost-enemy:fightBack:".length) : undefined;
      const weapon = fightBack ? availableFrostWeapons(s, step.combat, target.id, (condition) => matches(s, condition), (fieldName) => field(s, fieldName)).find((entry) => entry.id === weaponId && !entry.firearm) : undefined;
      if (fightBack && !weapon) invalid("当前不能使用该武器反击");
      const skill = fightBack ? weapon!.skill : "dodge";
      const base = target.character.skills[skill] ?? target.character.attributes?.[skill];
      if (base === undefined) invalid("目标角色没有可用的防御技能");
      const priorEnemyAttacks = saved.state.events.filter((event) => event.round === saved.state.round && event.side === "enemy" && event.targetId === target.id).length;
      result = resolve(s, { skill, label: fightBack ? `${weapon!.label}反击` : "闪避", bonus: weapon?.bonus, penalty: weapon?.penalty, opposed: enemy.skills[enemySource.attackSkill], opposedBonus: priorEnemyAttacks > 0 ? 1 : 0 }, dice, 0, target.id === "$player" ? undefined : target.id);
      const continuation = { side: "enemy" as const, actorId: target.id, targetId: target.id, enemyId: enemy.id, action: fightBack ? "fightBack" as const : "dodge" as const, ...(weaponId ? { weaponId } : {}) };
      const luck = story.spendLuck && target.id === "$player" ? frostCombatLuckCost(result, s.character.luck, continuation.action, false) : undefined;
      if (luck !== undefined) {
        p(s).pending = { check: { skill, label: fightBack ? `${weapon!.label}反击` : "闪避", target: result.target }, result: structuredClone(result), frostCombat: continuation };
        action = `${target.character.name}${fightBack ? "反击" : "闪避"}，等待幸运点调整`;
      } else {
        const completed = completeFrostCombatCheck(story, s, step.combat, result, continuation, dice);
        action = completed.action;
      }
    } else {
      const option = step.combat.options?.find((entry) => entry.id === actionId && matches(s, entry.condition) && (!entry.once || !p(s).used[entry.once]));
      if (!option) invalid("当前战斗不允许此行动");
      if (option.once) p(s).used[option.once] = true;
      action = option.label;
      apply(story, s, option.effects ?? [], dice, option.call ?? option.target, Boolean(option.call));
    }
    if (p(s).frostCombat && !p(s).pending?.frostCombat) {
      syncFrostParty(s);
      health(story, s, before, node(story, s.nodeId).healthRouting);
      if (p(s).frostCombat) finishFrostTransition(story, s, step.combat, previousRound, dice);
    }
  }
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
