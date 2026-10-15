import type { Character, RunState } from "../contracts/index.js";
import type { PartyDefinition, PartyMember } from "../contracts/party.js";

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
export function initializeParty(definition?: PartyDefinition) {
  return definition ? { members: definition.members.map((member) => ({
    id: member.id, character: structuredClone(member.character), status: member.initialStatus ?? "present", unconscious: member.character.hp === 0,
    revealed: member.initialVisible ?? (member.initialStatus === undefined || member.initialStatus === "present"),
    inventory: structuredClone(member.inventory ?? []),
  })) } : undefined;
}
export function companion(state: RunState, id: string): PartyMember {
  const member = state.party?.members.find((member) => member.id === id);
  if (!member) invalid(`未知同伴 ${id}`);
  return member;
}
export function awake(member: PartyMember): boolean {
  return member.status === "present" && member.revealed && !member.unconscious;
}
export function availablePerformers(state: RunState, skill: string) {
  return [
    { id: "$player", character: state.character },
    ...(state.party?.members.filter((member) =>
      awake(member) && (Object.hasOwn(member.character.skills, skill) || Object.hasOwn(member.character.attributes ?? {}, skill) || ["sanity", "luck"].includes(skill)),
    ) ?? []).map((member) => ({ id: member.id, character: member.character })),
  ];
}
export function performer(state: RunState, id: string, skill: string): Character {
  const actor = availablePerformers(state, skill).find((member) => member.id === id);
  if (!actor) invalid("本次检定不能由这名同伴承担");
  return actor.character;
}
export function companionField(state: RunState, key: string): number {
  const match = /^party\.([\w-]+)\.(hp|maxHp|sanity|present|awake|dead|missing|absent|unconscious|skill\.[a-zA-Z]+|attribute\.[a-zA-Z]+)$/.exec(key);
  if (!match) invalid(`未知同伴字段 ${key}`);
  const member = companion(state, match[1]);
  if (match[2] === "present") return member.status === "present" ? 1 : 0;
  if (match[2] === "awake") return awake(member) ? 1 : 0;
  if (match[2] === "unconscious") return member.unconscious ? 1 : 0;
  if (["dead", "missing", "absent"].includes(match[2])) return member.status === match[2] ? 1 : 0;
  const keyName = match[2];
  const numeric = keyName.startsWith("skill.")
    ? member.character.skills[keyName.slice(6)]
    : keyName.startsWith("attribute.")
      ? member.character.attributes?.[keyName.slice(10)]
      : member.character[keyName as "hp" | "maxHp" | "sanity"];
  if (numeric === undefined) invalid(`未知同伴字段 ${key}`);
  return numeric;
}
export function changeCompanionHp(state: RunState, id: string, amount: number) {
  const member = companion(state, id);
  if (!Number.isFinite(amount)) invalid("同伴生命值变化必须是有限数值");
  if (member.status === "dead") invalid("死亡同伴不能恢复或承受伤害");
  member.character.hp = Math.min(member.character.maxHp, Math.max(0, member.character.hp + amount));
  if (amount < 0 && member.character.hp === 0) member.unconscious = true;
}
export function restoreCompanion(state: RunState, id: string) {
  const member = companion(state, id);
  if (member.status === "present") member.unconscious = false;
}
