import type { RunState } from "../contracts/index.js";
import type { FrostProgramCombatSpec } from "../contracts/frost.js";
import type { FrostCombatant, FrostCombatEnemy, FrostPartyCombatSpec, FrostPartyCombatState } from "../contracts/frost-combat.js";
import { itemCount } from "./inventory.js";

export type ResolvedFrostEnemy = Omit<FrostProgramCombatSpec["enemies"][number], "hp" | "maxHp" | "count"> & { hp: number; maxHp: number };
export type ResolvedFrostProgramSpec = Omit<FrostProgramCombatSpec, "enemies" | "victoryHitThreshold"> & { enemies: ResolvedFrostEnemy[]; victoryHitThreshold?: number };

/** Resolve the reviewed program's expressions once, before the encounter is saved. */
export function resolveFrostProgramSpec(
  source: FrostProgramCombatSpec,
  resolveValue: (value: import("../contracts/program.js").Value) => number,
): ResolvedFrostProgramSpec {
  const enemies = source.enemies.flatMap((enemy) => {
    const count = enemy.count === undefined ? 1 : resolveValue(enemy.count);
    if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw Object.assign(new Error("战斗敌人数超出来源支持范围"), { statusCode: 400 });
    return Array.from({ length: count }, (_, index) => ({
      id: count === 1 ? enemy.id : `${enemy.id}-${index + 1}`,
      name: count === 1 ? enemy.name : `${enemy.name} ${index + 1}`,
      hp: resolveValue(enemy.hp),
      maxHp: resolveValue(enemy.maxHp),
      ...(enemy.armor !== undefined ? { armor: enemy.armor } : {}),
      ...(enemy.stopAtHp !== undefined ? { stopAtHp: enemy.stopAtHp } : {}),
      ...(enemy.damageMode ? { damageMode: enemy.damageMode } : {}),
      skills: structuredClone(enemy.skills),
      ...(enemy.targetOrder ? { targetOrder: [...enemy.targetOrder] } : {}),
      attackSkill: enemy.attackSkill,
      damage: enemy.damage,
      impaling: enemy.impaling ?? false,
    }));
  });
  const victoryHitThreshold = source.victoryHitThreshold === undefined ? undefined : resolveValue(source.victoryHitThreshold);
  if (victoryHitThreshold !== undefined && (!Number.isSafeInteger(victoryHitThreshold) || victoryHitThreshold < 1 || victoryHitThreshold > 20)) throw Object.assign(new Error("战斗命中阈值超出来源支持范围"), { statusCode: 400 });
  const { victoryHitThreshold: _sourceHitThreshold, ...sourceWithoutHitThreshold } = source;
  void _sourceHitThreshold;
  const expanded: ResolvedFrostProgramSpec = { ...sourceWithoutHitThreshold, ...(victoryHitThreshold !== undefined ? { victoryHitThreshold } : {}), enemies, enemyTurnOrder: source.enemyTurnOrder.flatMap((id) => enemies.filter((enemy) => enemy.id === id || enemy.id.startsWith(`${id}-`)).map((enemy) => enemy.id)) };
  return expanded;
}

export function frostCombatants(
  state: RunState,
  participants: FrostProgramCombatSpec["participants"],
  matches: (condition: FrostProgramCombatSpec["participants"][number]["condition"]) => boolean,
): FrostCombatant[] {
  const result: FrostCombatant[] = [{ id: "$player", character: structuredClone(state.character), kind: "investigator", status: "present", unconscious: state.character.hp <= 0 }];
  for (const member of state.party?.members ?? []) {
    const source = participants.find((entry) => entry.id === member.id);
    result.push({
      id: member.id,
      character: structuredClone(member.character),
      kind: "companion",
      status: member.status,
      unconscious: member.unconscious,
      active: !!source && matches(source.condition),
    });
  }
  const required = participants.map(({ id }) => id).filter((id) => id !== "$player");
  if (required.some((id) => !result.some((actor) => actor.id === id))) throw Object.assign(new Error("战斗参与者引用了不存在的同伴"), { statusCode: 400 });
  return result;
}

export function syncFrostCombatants(state: RunState, combat: FrostPartyCombatState) {
  const investigator = combat.party.find((actor) => actor.kind === "investigator");
  if (investigator) {
    state.character.hp = investigator.character.hp;
    state.character.sanity = investigator.character.sanity;
    state.character.luck = investigator.character.luck;
    state.character.skills = structuredClone(investigator.character.skills);
    state.character.attributes = structuredClone(investigator.character.attributes);
    }
  for (const actor of combat.party.filter((entry) => entry.kind === "companion")) {
    const member = state.party?.members.find((entry) => entry.id === actor.id);
    if (!member) continue;
    member.character.hp = actor.character.hp;
    member.status = actor.status;
    member.unconscious = actor.unconscious;
  }
}

/** Merge changes made by called source rules back into the saved encounter. */
export function refreshFrostCombatants(state: RunState, combat: FrostPartyCombatState) {
  for (const actor of combat.party) {
    if (actor.kind === "investigator") {
      actor.character.hp = state.character.hp;
      actor.character.sanity = state.character.sanity;
      actor.character.luck = state.character.luck;
      actor.character.skills = structuredClone(state.character.skills);
      actor.character.attributes = structuredClone(state.character.attributes);
      // Combat tracks the actor's current condition. The global flag is a
      // historical health event and can remain set after a source recovery.
      actor.unconscious = state.character.hp <= 0;
      continue;
    }
    const member = state.party?.members.find((entry) => entry.id === actor.id);
    if (!member) continue;
    actor.character.hp = member.character.hp;
    actor.character.sanity = member.character.sanity;
    actor.character.luck = member.character.luck;
    actor.character.skills = structuredClone(member.character.skills);
    actor.character.attributes = structuredClone(member.character.attributes);
    actor.status = member.status;
    actor.unconscious = member.unconscious;
  }
}

export function availableFrostWeapons(
  state: RunState,
  source: FrostProgramCombatSpec,
  actorId: string,
  matches: (condition: FrostProgramCombatSpec["weapons"][number]["condition"]) => boolean,
  readField: (field: string) => number,
) {
  const member = actorId === "$player" ? undefined : state.party?.members.find((entry) => entry.id === actorId);
  const actor = member?.character ?? state.character;
  return source.weapons.filter((weapon) =>
    (!weapon.actors || weapon.actors.includes(actorId)) &&
    matches(weapon.condition) &&
    (!weapon.key || (actorId === "$player" ? itemCount(state, weapon.key) : itemCount(state, weapon.key, actorId)) > 0) &&
    (!weapon.ammo || readField(weapon.ammo) >= (weapon.shots ?? 1)),
  );
}

export function pureFrostSpec(source: ResolvedFrostProgramSpec): FrostPartyCombatSpec {
  return {
    sourceSection: source.sourceSection,
    partyTurnOrder: [...source.partyTurnOrder],
    enemyTurnOrder: [...source.enemyTurnOrder],
    initiative: source.initiative,
    enemies: source.enemies.map((enemy): FrostCombatEnemy => ({
      id: enemy.id, name: enemy.name, hp: enemy.hp, maxHp: enemy.maxHp,
      ...(enemy.armor !== undefined ? { armor: enemy.armor } : {}),
      ...(enemy.stopAtHp !== undefined ? { stopAtHp: enemy.stopAtHp } : {}),
      ...(enemy.damageMode ? { damageMode: enemy.damageMode } : {}),
      skills: structuredClone(enemy.skills),
      ...(enemy.targetOrder ? { targetOrder: [...enemy.targetOrder] } : {}),
    })),
    ...(source.protectedStudents ? { protectedStudents: [...source.protectedStudents] } : {}),
    ...(source.victoryHitThreshold !== undefined ? { victoryHitThreshold: source.victoryHitThreshold } : {}),
    ...(source.fatalCompanions ? { fatalCompanions: [...source.fatalCompanions] } : {}),
    ...(source.reviveCompanionsIfInvestigatorSurvives !== undefined ? { reviveCompanionsIfInvestigatorSurvives: source.reviveCompanionsIfInvestigatorSurvives } : {}),
    allowFlee: source.flee !== undefined,
  };
}
