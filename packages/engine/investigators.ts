import type { RunState, Story } from "../contracts/index.js";
import type { InvestigatorSnapshot } from "../contracts/investigators.js";
import { programState } from "./program.js";
import { calendarDay } from "./calendar.js";
import { initializeParty } from "./party.js";

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
function campaign(story: Story, state: RunState) {
  if (!story.investigators || !state.investigators) invalid("本剧本未启用调查员接续");
  return { definition: story.investigators, progress: state.investigators };
}
function shared<T>(values: Record<string, T>, keys: string[]) {
  return Object.fromEntries(Object.entries(values).filter(([key]) => keys.includes(key)));
}
function snapshot(story: Story, state: RunState): InvestigatorSnapshot {
  const { definition } = campaign(story, state);
  const program = structuredClone(state.program!);
  for (const key of definition.sharedCounters) delete program.counters[key];
  return { character: structuredClone(state.character), program,
    flags: Object.fromEntries(Object.entries(state.flags).filter(([key]) => !definition.sharedFlags.includes(key))),
    inventory: structuredClone(state.inventory), nodeId: state.nodeId, visitId: state.visitId,
    ...(state.party ? { party: structuredClone(state.party) } : {}),
    ...(state.createdCharacterId ? { createdCharacterId: state.createdCharacterId } : {}),
    ...(state.savedCharacterId ? { savedCharacterId: state.savedCharacterId } : {}), status: "active" };
}
export function initializeInvestigators(story: Story, state: RunState) {
  if (!story.investigators) return;
  state.investigators = { current: story.investigators.first, cycle: 1, totalLossCount: 0,
    cycleLossCount: 0, actors: {}, previousCycles: [] };
}
export function loseInvestigator(story: Story, state: RunState, reason: string, privatePlace = false, location = state.nodeId) {
  const { progress } = campaign(story, state);
  if (progress.actors[progress.current]?.status === "lost") invalid("这位调查员已经退场");
  const saved = snapshot(story, state);
  saved.status = "lost"; saved.reason = reason;
  if (privatePlace) saved.inheritance = { location, claimed: false };
  progress.actors[progress.current] = saved;
  progress.totalLossCount++; progress.cycleLossCount++;
}
export function suspendInvestigator(story: Story, state: RunState, minutes: number, resume?: string) {
  const { progress } = campaign(story, state);
  if (progress.suspended) invalid("本局已有一位暂时离场的调查员");
  if (!Number.isSafeInteger(minutes) || minutes < 0) invalid("暂时离场时间须为非负整数分钟");
  const saved = snapshot(story, state);
  if (resume) {
    saved.nodeId = resume; saved.program.cursor = 0; saved.program.returns = [];
  } else {
    const caller = saved.program.returns.pop();
    if (!caller) invalid("暂时离场必须保留恢复位置");
    saved.nodeId = caller.nodeId; saved.visitId = caller.visitId; saved.program.cursor = caller.cursor;
    saved.program.combat = structuredClone(caller.combat);
  }
  saved.status = "suspended"; saved.remainingMinutes = minutes;
  if (state.calendar?.minuteOfDay !== null && state.calendar?.minuteOfDay !== undefined)
    saved.suspendedAt = { date: state.calendar.date, minuteOfDay: state.calendar.minuteOfDay };
  progress.actors[progress.current] = saved; progress.suspended = progress.current;
}
function activate(story: Story, state: RunState, id: string, reuse?: InvestigatorSnapshot) {
  const { definition, progress } = campaign(story, state);
  const member = definition.members.find(member => member.id === id);
  if (!member) invalid(`未知调查员 ${id}`);
  const worldFlags = shared(state.flags, definition.sharedFlags);
  const worldCounters = shared(state.program!.counters, definition.sharedCounters);
  if (reuse) {
    state.character = structuredClone(reuse.character); state.inventory = structuredClone(reuse.inventory);
    state.flags = { ...worldFlags, ...reuse.flags }; state.program = structuredClone(reuse.program);
    state.program.counters = { ...state.program.counters, ...worldCounters };
    state.nodeId = reuse.nodeId; state.visitId = reuse.visitId;
    state.createdCharacterId = reuse.createdCharacterId;
    state.party = structuredClone(reuse.party);
    state.savedCharacterId = reuse.savedCharacterId;
  } else {
    state.character = structuredClone(member.character); state.inventory = structuredClone(member.inventory ?? []);
    state.party = initializeParty(story.party);
    state.flags = worldFlags; state.program = programState(state.character);
    state.program.counters = worldCounters;
    delete state.createdCharacterId;
    delete state.savedCharacterId;
  }
  progress.current = id;
  if (progress.actors[id]) progress.actors[id].status = "active";
  return member.entry;
}
export function activateNextInvestigator(story: Story, state: RunState) {
  const { definition, progress } = campaign(story, state);
  const prior = progress.actors[progress.current];
  if (!prior || !["lost", "suspended"].includes(prior.status)) invalid("当前调查员尚未退场");
  const index = definition.members.findIndex(member => member.id === progress.current);
  const next = definition.members.slice(index + 1).find(member => progress.actors[member.id]?.status !== "lost");
  if (!next) return definition.restartNode;
  return activate(story, state, next.id);
}
export function resumeInvestigator(story: Story, state: RunState) {
  const { progress } = campaign(story, state);
  if (!progress.suspended || progress.actors[progress.current]?.status !== "lost") invalid("不能恢复此前的调查员");
  const saved = progress.actors[progress.suspended];
  if (!saved || saved.status !== "suspended") invalid("没有待恢复的调查员");
  const id = progress.suspended;
  let remaining = saved.remainingMinutes ?? 0;
  if (saved.suspendedAt && state.calendar?.minuteOfDay !== null && state.calendar?.minuteOfDay !== undefined) {
    const elapsed = (calendarDay(state.calendar.date) - calendarDay(saved.suspendedAt.date)) * 1440 + state.calendar.minuteOfDay - saved.suspendedAt.minuteOfDay;
    remaining = Math.max(0, remaining - Math.max(0, elapsed));
  }
  activate(story, state, id, saved);
  state.program!.counters.suspendedRemainingMinutes = remaining;
  delete progress.suspended;
  return { nodeId: saved.nodeId, remainingMinutes: remaining };
}
export function restartInvestigators(story: Story, state: RunState, reuse: boolean) {
  const { definition, progress } = campaign(story, state);
  if (progress.suspended || definition.members.some(member => progress.actors[member.id]?.status !== "lost")) invalid("本轮调查员尚未全部退场");
  const previous = progress.actors;
  progress.previousCycles.push({ cycle: progress.cycle, losses: progress.cycleLossCount });
  progress.cycle++; progress.cycleLossCount = 0; progress.actors = {};
  state.flags = {}; state.inventory = []; state.program!.counters = {};
  const entry = activate(story, state, definition.first);
  if (reuse) {
    const original = previous[definition.first];
    state.character.skills = structuredClone(original.character.skills);
    state.character.specializations = structuredClone(original.character.specializations);
    state.character.name = original.character.name;
    state.createdCharacterId = original.createdCharacterId;
    state.savedCharacterId = original.savedCharacterId;
    state.flags["investigator-reused"] = true;
  }
  // Date changes and first-entry initialization remain explicit reviewed book instructions.
  return entry;
}
export function inheritPossessions(story: Story, state: RunState, from: string, location: string) {
  const { progress } = campaign(story, state);
  const source = progress.actors[from];
  if (from === progress.current || !source || source.status !== "lost" || !source.inheritance || source.inheritance.claimed || source.inheritance.location !== location)
    invalid("此处没有可继承的遗留物品");
  for (const item of source.inventory) if (!state.inventory.some(existing => existing.key === item.key)) state.inventory.push(structuredClone(item));
  source.inheritance.claimed = true;
}
