import type { FrostCombatant, FrostCombatEnemy, FrostPartyCombatSpec, FrostCombatEvent, FrostPartyCombatState, FrostCombatProjection, FrostPartyAction, FrostEnemyAction } from "../contracts/frost-combat.js";
export type { FrostCombatant, FrostCombatEnemy, FrostPartyCombatSpec, FrostCombatEvent, FrostPartyCombatState, FrostCombatProjection, FrostPartyAction, FrostEnemyAction } from "../contracts/frost-combat.js";

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

function isActive(actor: FrostCombatant) {
  return actor.status === "present" && actor.active !== false && !actor.unconscious && (actor.kind === "companion" || actor.character.hp > 0);
}

function nextPartyActor(spec: FrostPartyCombatSpec, state: FrostPartyCombatState) {
  for (let i = state.partyCursor; i < spec.partyTurnOrder.length; i++) {
    const id = spec.partyTurnOrder[i];
    const actor = state.party.find((entry) => entry.id === id);
    if (actor && isActive(actor)) return actor;
  }
  return undefined;
}

function nextEnemy(spec: FrostPartyCombatSpec, state: FrostPartyCombatState) {
  for (let i = state.enemyCursor; i < spec.enemyTurnOrder.length; i++) {
    const id = spec.enemyTurnOrder[i];
    const enemy = state.enemies.find((entry) => entry.id === id);
    if (enemy && enemy.hp > (enemy.stopAtHp ?? 0)) return enemy;
  }
  return undefined;
}

export function currentFrostEnemy(spec: FrostPartyCombatSpec, state: FrostPartyCombatState) {
  return state.phase === "enemy" ? nextEnemy(spec, state) : undefined;
}

export function currentFrostEnemyTarget(spec: FrostPartyCombatSpec, state: FrostPartyCombatState) {
  const enemy = currentFrostEnemy(spec, state);
  if (!enemy) return undefined;
  const order = enemy.targetOrder ?? spec.partyTurnOrder;
  return order.map((id) => state.party.find((actor) => actor.id === id)).find((actor) => actor && isActive(actor));
}

function settle(spec: FrostPartyCombatSpec, state: FrostPartyCombatState) {
  if (state.outcome) return;
  const enoughEnemyHits = spec.victoryHitThreshold !== undefined && state.enemies.filter((enemy) => enemy.hp < enemy.maxHp).length >= spec.victoryHitThreshold;
  if (enoughEnemyHits || state.enemies.every((enemy) => enemy.hp <= (enemy.stopAtHp ?? 0))) {
    state.phase = "finished";
    state.outcome = "victory";
    const investigator = state.party.find((actor) => actor.kind === "investigator");
    if (spec.reviveCompanionsIfInvestigatorSurvives && investigator && isActive(investigator)) {
      for (const actor of state.party) {
        if (actor.kind === "companion" && actor.status === "present" && actor.unconscious && !actor.fatalOnZero) actor.unconscious = false;
      }
    }
    return;
  }
  const investigator = state.party.find((actor) => actor.kind === "investigator");
  if (!investigator || !isActive(investigator)) {
    state.phase = "finished";
    state.outcome = "defeat";
    return;
  }
  // Damage can knock out the actor at the party cursor after the previous
  // turn advanced. Normalize the phase here so projection never leaves an
  // active combat with no actionable party member.
  if (state.phase === "party" && !nextPartyActor(spec, state)) {
    state.phase = "enemy";
    state.enemyCursor = 0;
    if (spec.initiative === "enemy-first") state.round++;
  } else if (state.phase === "enemy" && !nextEnemy(spec, state)) {
    state.phase = "party";
    state.partyCursor = 0;
    if (spec.initiative === "enemy-first") state.round++;
  }
}

export function startFrostPartyCombat(spec: FrostPartyCombatSpec, party: FrostCombatant[]): FrostPartyCombatState {
  if (!spec.sourceSection || spec.partyTurnOrder.length === 0 || spec.enemyTurnOrder.length === 0 || spec.enemies.length === 0) invalid("冰霜集体战缺少来源或回合顺序");
  const ids = new Set(party.map((actor) => actor.id));
  if (party.filter((actor) => actor.kind === "investigator").length !== 1) invalid("冰霜战斗必须且只能有一名主角");
  if (spec.partyTurnOrder.some((id) => !ids.has(id))) invalid("回合顺序包含未知队员");
  if (spec.enemyTurnOrder.some((id) => !spec.enemies.some((enemy) => enemy.id === id))) invalid("敌方顺序包含未知敌人");
  const savedParty = structuredClone(party);
  if (spec.fatalCompanions) {
    for (const id of spec.fatalCompanions) {
      const actor = savedParty.find((entry) => entry.id === id);
      if (actor) actor.fatalOnZero = true;
    }
  }
  const state: FrostPartyCombatState = {
    sourceSection: spec.sourceSection,
    round: 1,
    phase: spec.initiative === "enemy-first" ? "enemy" : "party",
    partyCursor: 0,
    enemyCursor: 0,
    party: savedParty,
    enemies: structuredClone(spec.enemies),
    events: [],
  };
  settle(spec, state);
  return state;
}

export function projectFrostPartyCombat(spec: FrostPartyCombatSpec, state: FrostPartyCombatState): FrostCombatProjection {
  const actor = state.phase === "party" ? nextPartyActor(spec, state) : undefined;
  const living = state.party.filter(isActive);
  const pendingDamage = state.pendingEnemyAttack?.damage;
  const damageRecipients = state.pendingEnemyAttack?.damageMode === "target"
    ? living.filter((entry) => entry.id === state.pendingEnemyAttack!.targetId)
    : living;
  const base = Math.floor((pendingDamage ?? 0) / Math.max(1, damageRecipients.length));
  const player = state.party.find((entry) => entry.kind === "investigator");
  const defaultShares = pendingDamage === undefined ? {} : defaultDamageShares(pendingDamage, damageRecipients);
  const protectedIds = new Set(spec.protectedStudents ?? []);
  const playerExtraMax = state.pendingEnemyAttack?.damageMode !== "target" && player && living.includes(player)
    ? living.filter((entry) => entry.id !== player.id && protectedIds.has(entry.id)).reduce((sum, entry) => sum + (defaultShares[entry.id] ?? 0), 0)
    : 0;
  return {
    sourceSection: state.sourceSection,
    round: state.round,
    phase: state.phase,
    ...(state.outcome ? { outcome: state.outcome } : {}),
    ...(actor ? { currentActorId: actor.id } : {}),
    ...(currentFrostEnemy(spec, state) ? { currentEnemyId: currentFrostEnemy(spec, state)!.id } : {}),
    ...(currentFrostEnemyTarget(spec, state) ? { currentEnemyTargetId: currentFrostEnemyTarget(spec, state)!.id } : {}),
    availableActions: state.phase !== "party" || !actor ? [] : spec.allowFlee && actor.kind === "investigator" ? [{ id: "attack", label: "攻击" }, { id: "flee", label: "逃离战斗" }] : [{ id: "attack", label: "攻击" }],
    enemies: state.enemies.map(({ id, name, hp, maxHp }) => ({ id, name, hp, maxHp })),
    party: state.party.map(({ id, character, status, active, unconscious }) => ({ id, name: character.name, hp: character.hp, maxHp: character.maxHp, status, active: active !== false, unconscious })),
    ...(state.pendingEnemyAttack ? {
      damageInput: {
        total: pendingDamage!,
        recipients: damageRecipients.map((entry) => entry.id),
        minimumPerMember: base,
        minimumByMember: Object.fromEntries(damageRecipients.map((entry) => [entry.id, protectedIds.has(entry.id) ? 0 : base])),
        defaultShares,
        playerExtraMax,
      },
    } : {}),
  };
}

function advanceParty(spec: FrostPartyCombatSpec, state: FrostPartyCombatState, actorId: string) {
  const selectedIndex = spec.partyTurnOrder.indexOf(actorId, state.partyCursor);
  if (selectedIndex < 0) invalid("行动队员不在当前来源回合顺序中");
  state.partyCursor = selectedIndex + 1;
  if (!nextPartyActor(spec, state)) {
    state.phase = "enemy";
    state.enemyCursor = 0;
    if (spec.initiative === "enemy-first") state.round++;
  }
}

function advanceEnemy(spec: FrostPartyCombatSpec, state: FrostPartyCombatState, enemyId: string) {
  const selectedIndex = spec.enemyTurnOrder.indexOf(enemyId, state.enemyCursor);
  if (selectedIndex < 0) invalid("行动敌人不在当前来源回合顺序中");
  state.enemyCursor = selectedIndex + 1;
  if (!nextEnemy(spec, state)) {
    state.partyCursor = 0;
    state.enemyCursor = 0;
    if (spec.initiative === "enemy-first") {
      state.phase = "party";
    } else {
      state.round++;
      state.phase = "party";
    }
  }
}

export function applyFrostPartyAction(spec: FrostPartyCombatSpec, previous: FrostPartyCombatState, input: FrostPartyAction): FrostPartyCombatState {
  const state = structuredClone(previous);
  if (state.phase !== "party" || state.outcome) invalid("当前不是队伍行动阶段");
  const actor = nextPartyActor(spec, state);
  if (!actor || actor.id !== input.actorId) invalid("该队员现在不能行动");
  if (input.action === "flee") {
    if (!spec.allowFlee) invalid("来源未允许逃离战斗");
    state.events.push({ round: state.round, side: "party", actorId: actor.id, targetId: "", action: "flee" });
    state.phase = "finished";
    state.outcome = "fled";
    return state;
  }
  if (!input.targetId || !state.enemies.some((enemy) => enemy.id === input.targetId && enemy.hp > 0)) invalid("请选择仍存活的敌人");
  if (!input.check) invalid("队伍攻击需要已解析的检定结果");
  const skill = input.check.skill;
  if (!actor.character.skills[skill] && !actor.character.attributes?.[skill]) invalid("这名角色没有该战斗技能或属性");
  const enemy = state.enemies.find((entry) => entry.id === input.targetId)!;
  const rolledDamage = input.check.success ? Math.max(0, Math.floor(input.damage ?? 0)) : 0;
  const appliedDamage = Math.min(enemy.hp, Math.max(0, rolledDamage - (enemy.armor ?? 0)));
  enemy.hp -= appliedDamage;
  state.events.push({ round: state.round, side: "party", actorId: actor.id, targetId: enemy.id, action: "attack", check: { ...input.check, performer: { id: actor.id, name: actor.character.name } }, rolledDamage, appliedDamage });
  advanceParty(spec, state, actor.id);
  settle(spec, state);
  return state;
}

function defaultDamageShares(total: number, recipients: FrostCombatant[]) {
  const quotient = Math.floor(total / recipients.length);
  const remainder = total % recipients.length;
  return Object.fromEntries(recipients.map((actor, index) => [actor.id, quotient + (index < remainder ? 1 : 0)]));
}

export function allocateFrostPartyDamage(total: number, recipients: FrostCombatant[], playerExtra = 0, protectedMembers: string[] = []) {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(playerExtra) || playerExtra < 0) invalid("队伍伤害分配必须为非负整数");
  const alive = recipients.filter(isActive);
  if (total === 0) return Object.fromEntries(alive.map((actor) => [actor.id, 0]));
  if (alive.length === 0) invalid("没有可承受伤害的队员");
  const player = alive.find((actor) => actor.kind === "investigator");
  const shares = defaultDamageShares(total, alive);
  if (playerExtra > 0) {
    if (!player) invalid("主角不在战斗队伍中，不能承担额外伤害");
    const protectedIds = new Set(protectedMembers);
    const fromProtected = alive.filter((actor) => actor.id !== player.id && protectedIds.has(actor.id)).reduce((sum, actor) => sum + (shares[actor.id] ?? 0), 0);
    if (playerExtra > fromProtected) invalid("额外分担会使其他队员低于来源允许的伤害下限");
    let remaining = playerExtra;
    for (const actor of alive.filter((entry) => entry.id !== player.id && protectedIds.has(entry.id))) {
      const available = shares[actor.id] ?? 0;
      const moved = Math.min(remaining, available);
      shares[actor.id] = (shares[actor.id] ?? 0) - moved;
      shares[player.id] = (shares[player.id] ?? 0) + moved;
      remaining -= moved;
      if (remaining === 0) break;
    }
    if (remaining > 0) invalid("额外分担超出可转移的受保护队员伤害");
  }
  return shares;
}

export function applyFrostEnemyAction(spec: FrostPartyCombatSpec, previous: FrostPartyCombatState, input: FrostEnemyAction): FrostPartyCombatState {
  const state = structuredClone(previous);
  if (state.phase !== "enemy" || state.outcome) invalid("当前不是敌方行动阶段");
  const enemy = nextEnemy(spec, state);
  if (!enemy || enemy.id !== input.enemyId) invalid("该敌人现在不能行动");
  if (state.pendingEnemyAttack) invalid("上一笔队伍伤害尚未分配");
  const preferred = currentFrostEnemyTarget(spec, state);
  if (!preferred || preferred.id !== input.targetId) invalid("敌人攻击目标不符合来源顺序");
  if (!Number.isSafeInteger(input.damage) || input.damage < 0) invalid("敌方伤害无效");
  if (!input.check.success) {
    state.events.push({ round: state.round, side: "enemy", actorId: enemy.id, targetId: input.targetId, action: "attack", check: input.check, rolledDamage: 0, appliedDamage: 0 });
    advanceEnemy(spec, state, enemy.id);
    settle(spec, state);
    return state;
  }
  state.pendingEnemyAttack = { enemyId: enemy.id, targetId: input.targetId, check: input.check, damage: input.damage, damageMode: enemy.damageMode ?? "party" };
  return state;
}

export function applyFrostPartyDamageAllocation(spec: FrostPartyCombatSpec, previous: FrostPartyCombatState, playerExtra = 0, exactShares?: Record<string, number>): FrostPartyCombatState {
  const state = structuredClone(previous);
  if (!state.pendingEnemyAttack || (state.phase !== "enemy" && !state.pendingEnemyAttack.alreadyAdvanced)) invalid("尚无待分配的队伍伤害");
  const pending = state.pendingEnemyAttack;
  if (pending.damageMode === "target" && playerExtra !== 0) invalid("指定目标承受伤害时不能再调整队伍分担");
  const recipients = state.party.filter(isActive);
  const distribution = exactShares ?? (pending.damageMode === "target"
    ? { [pending.targetId]: pending.damage }
    : allocateFrostPartyDamage(pending.damage, recipients, playerExtra, spec.protectedStudents));
  const expected = pending.damageMode === "target" ? [pending.targetId] : recipients.map(actor => actor.id);
  if (Object.keys(distribution).length !== expected.length || expected.some(id => !Object.hasOwn(distribution, id)) || Object.values(distribution).some(amount => !Number.isSafeInteger(amount) || amount < 0) || Object.values(distribution).reduce((sum, amount) => sum + amount, 0) !== pending.damage) invalid("队伍伤害分配不完整");
  if (pending.damageMode === "party" && exactShares) {
    const protectedIds = spec.protectedStudents ?? [];
    const transferCapacity = recipients.filter(actor => actor.kind !== "investigator" && protectedIds.includes(actor.id)).reduce((sum, actor) => sum + (defaultDamageShares(pending.damage, recipients)[actor.id] ?? 0), 0);
    const valid = Array.from({ length: transferCapacity + 1 }, (_, extra) => allocateFrostPartyDamage(pending.damage, recipients, extra, protectedIds))
      .some(legal => expected.every(id => distribution[id] === legal[id]));
    if (!valid) invalid("伤害必须均衡分担；额外承担只能从受保护学生的份额转给主角");
  }
  for (const actor of recipients) {
    const damage = distribution[actor.id] ?? 0;
    actor.character.hp = Math.max(0, actor.character.hp - damage);
    if (damage > 0 && actor.character.hp === 0) {
      if (actor.kind === "companion" && actor.fatalOnZero) {
        actor.status = "dead";
        actor.unconscious = false;
      }
      else actor.unconscious = true;
    }
  }
  state.pendingEnemyAttack = undefined;
  state.events.push({ round: state.round, side: "enemy", actorId: pending.enemyId, targetId: pending.targetId, action: "attack", check: pending.check, rolledDamage: pending.damage, appliedDamage: pending.damage, damageDistribution: distribution });
  if (!pending.alreadyAdvanced) advanceEnemy(spec, state, pending.enemyId);
  settle(spec, state);
  return state;
}

/** A server-resolved opposed turn. Checks and damage never come from a client. */
export function applyFrostResolvedTurn(spec: FrostPartyCombatSpec, previous: FrostPartyCombatState, turn: {
  side: "party" | "enemy"; actorId: string; targetId: string; enemyId: string;
  check: import("../contracts/index.js").CheckResult; damageTo: "party" | "enemy" | "none"; damage: number; damageTargetId?: string;
}): FrostPartyCombatState {
  const state = structuredClone(previous);
  if (state.outcome || state.pendingEnemyAttack || state.phase !== turn.side) invalid("当前战斗阶段不允许此行动");
  if (!Number.isSafeInteger(turn.damage) || turn.damage < 0) invalid("战斗伤害无效");
  const enemy = state.enemies.find(enemy => enemy.id === turn.enemyId);
  if (!enemy || enemy.hp <= (enemy.stopAtHp ?? 0)) invalid("当前对手不能被攻击");
  turn.check.combat ??= {
    enemyName: enemy.name, round: state.round,
    action: turn.side === "party" ? "attack" : "defend",
    result: turn.damageTo === "enemy" ? "hit" : turn.damageTo === "party" ? "hurt" : turn.check.success ? "dodged" : "miss",
    damage: turn.damage, recipient: turn.damageTo === "enemy" ? "enemy" : turn.damageTo === "party" ? "player" : "none",
  };
  if (turn.side === "party") {
    if (nextPartyActor(spec, state)?.id !== turn.actorId || turn.targetId !== enemy.id) invalid("该队员现在不能攻击这个目标");
    advanceParty(spec, state, turn.actorId);
  } else {
    if (nextEnemy(spec, state)?.id !== turn.actorId || currentFrostEnemyTarget(spec, state)?.id !== turn.targetId) invalid("该敌人现在不能攻击这个目标");
    advanceEnemy(spec, state, turn.actorId);
  }
  if (turn.damageTo === "enemy") enemy.hp = Math.max(0, enemy.hp - Math.max(0, turn.damage - (enemy.armor ?? 0)));
  if (turn.damageTo === "party" && turn.damage > 0 && turn.side === "party" && turn.damageTargetId) {
    const recipient = state.party.find(actor => actor.id === turn.damageTargetId);
    if (!recipient || !isActive(recipient)) invalid("误伤目标不在当前战斗中");
    recipient.character.hp = Math.max(0, recipient.character.hp - turn.damage);
    if (recipient.character.hp === 0) {
      if (recipient.kind === "companion" && recipient.fatalOnZero) { recipient.status = "dead"; recipient.unconscious = false; }
      else recipient.unconscious = true;
    }
    state.events.push({ round: previous.round, side: turn.side, actorId: turn.actorId, targetId: enemy.id, action: "attack", check: turn.check, rolledDamage: turn.damage, appliedDamage: 0, damageDistribution: { [recipient.id]: turn.damage } });
    settle(spec, state);
  } else if (turn.damageTo === "party" && turn.damage > 0) {
    state.pendingEnemyAttack = { enemyId: enemy.id, targetId: turn.damageTargetId ?? (turn.side === "party" ? turn.actorId : turn.targetId), check: turn.check, damage: turn.damage, damageMode: enemy.damageMode ?? "party", alreadyAdvanced: true };
  } else {
    state.events.push({ round: previous.round, side: turn.side, actorId: turn.actorId, targetId: turn.targetId, action: "attack", check: turn.check, rolledDamage: turn.damage, appliedDamage: turn.damageTo === "enemy" ? turn.damage : 0 });
    settle(spec, state);
  }
  return state;
}

