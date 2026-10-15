import type {
  FearAction, FearAvailableAction, FearCombat, FearDefinition, FearDice, FearMapBox,
  FearProjected, FearState, FearStory,
  FearOperation, FearTableEntry,
} from "../contracts/fear.js";
import {
  canStartServitor, damageServitor, dismissServitor, resolveServitorControl,
  resolveServitorMagic, servitorAttackRecipients, servitorRitualCheck,
  startServitorRitual, type ServitorState,
} from "./fear-servitor.js";
import { createFearMissionState, transitionFearMission } from "./fear-missions.js";
import { resolveFearTableRule } from "./fear-table-rules.js";
import {
  recordFearFoodPickup,
  recordFearWorshipVisit,
  presentFearAcquisitionChoice,
  resolveFearFoodSaltChoice,
  resolveFearWorshipSymbolChoice,
  resolveFearRandomObjectBook,
} from "./fear-source-acquisition.js";
import { fearDiceScope, observeFearDiceState } from "./fear-dice-scope.js";
import { firstAidHealLimit, resolveFirstAid, resolveGarlicAvoidance, occupiedBoxOnFlee, resolveOccupiedBoxRevisit, restoreBetweenMissions, dodgePenaltyAfterDefense, consumeDodgePenalty } from "./fear-general-rules.js";
import {
  fearFamilyActionOptions, fearFamilyAttackBounceChance, fearFamilyAttackModifier, fearFamilyDefenseModifier,
  fearFamilyEnemyAttacks, fearFamilyEnemyProfile, fearFamilyEscapeAllowed, fearFamilyImmuneToMagicOrPoison,
  fearFamilyWeaponDamage, fearFamilyWeaponUsable, fearFamilySkillModifier, handleFearFamilyAction, runFearFamilyRuleEvent,
  addFearRayguns, fearRaygunAdditionalCarrySlots, type FearFamilyEffect, type FearFamilyRuntimeEvent,
} from "./fear-family-rules.js";
import {
  applyFearCheapHolySymbolRoll, applyFearFlashlightEncounterEnd, applyFearItemSourceAction,
  applyFearItemSourceCheck, applyFearItemSourceDamage, applyFearItemSourceEncounterEnd,
  applyFearItemSourceMove, applyFearItemSourceXp, applyFearSprayCan, applyFearStuffedBirdBeforeAttack,
  consumeFearAlcoholSanityShieldOnLoss, fearFlashlightUsable, fearItemSourceActions,
  fearItemSourceAllowsExorcismBook, fearItemSourceBlocksBooksOrRituals, fearItemSourceMagicModifier, fearItemSourceSkillLearningCost,
  registerFearSourceItemAcquisition, resolveFearItemSourceWeapon,
} from "./fear-item-source-rules.js";

const die = (dice: FearDice) => {
  const value = dice(1, 7);
  if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error(`Fear D6 source returned an invalid face: ${value}`);
  return value;
};
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const boxKey = (sheet: number, box: number) => `s${sheet}:b${box}`;
const FEAR_HARDWARE_PICKUP_KEY = "fear-table:store:hardware-pickup";
const FEAR_SOURCE_HORDE_KEY = "fear-table:pending-source-horde-reward";
const FEAR_CLOWN_DEFEAT_KEY = "fear-table:railways:clown-defeat-pending";
function assertStory(story: FearStory) {
  if (story.rulesVersion !== "aaf-solo@1" || story.fear.format !== "aaf-fear-definition@1") throw new Error("Fear adapter requires aaf-solo@1 and aaf-fear-definition@1");
  const ids = new Set(story.nodes.map(n => n.id));
  const operationRoutes = (operations: FearOperation[] = []): string[] => operations.flatMap(op => {
    if (op.op === "route") return [op.scene];
    if (op.op === "roll-check" || op.op === "probability") return [...operationRoutes(op.success ?? []), ...operationRoutes(op.failure ?? [])];
    if (op.op === "roll-check-count") return operationRoutes(op.failure);
    if (op.op === "event-branch") return [...operationRoutes(op.ifNew), ...operationRoutes(op.ifPlayed)];
    if (op.op === "conditional-skill-purchase") return operationRoutes(op.onFind);
    if (op.op === "combat-outcome") return [...operationRoutes(op.defeated), ...operationRoutes(op.fled ?? []), ...operationRoutes(op.escaped ?? [])];
    if (op.op === "group-combat-outcome") return operationRoutes(op.allDefeated ?? []);
    if (op.op === "ongoing-check") return [...operationRoutes(op.failure), ...operationRoutes(op.success ?? [])];
    if (op.op === "require-item" || op.op === "require-skill" || op.op === "if-resource" || op.op === "if-item-any" || op.op === "if-book-read") return [...operationRoutes(op.success), ...operationRoutes(op.failure ?? [])];
    if (op.op === "choose-effect") return Object.values(op.choices).flatMap(operationRoutes);
    return [];
  });
  const refs = [story.fear.sceneRefs.entry, story.fear.sceneRefs.exploration, story.fear.sceneRefs.missions,
    ...Object.values(story.fear.sceneRefs.tables), ...Object.values(story.fear.sceneRefs.events),
    ...Object.values(story.fear.sceneRefs.specialEvents), ...Object.values(story.fear.sceneRefs.endings),
    ...Object.values(story.fear.enemies).flatMap(e => e.scene ? [e.scene] : []),
    ...Object.values(story.fear.missions).flatMap(m => m.scene ? [m.scene] : []),
    ...(story.fear.gates.scene ? [story.fear.gates.scene] : []),
    ...Object.values(story.fear.tables).flatMap(t => t.entries.flatMap(e => [
      ...(e.scene ? [e.scene] : []), ...operationRoutes(e.operations),
    ]).concat(t.exhausted ? [ ...(t.exhausted.scene ? [t.exhausted.scene] : []), ...operationRoutes(t.exhausted.operations) ] : []))];
  refs.push(...Object.values(story.fear.eventPrograms).flatMap(operationRoutes));
  for (const ref of refs) if (!ids.has(ref)) throw new Error(`Fear scene reference is absent from Story.nodes: ${ref}`);
  return story.fear;
}
function newSheet(state: FearState, definition: FearDefinition) {
  const sheet = state.mapSheets.length + 1;
  const boxes = Array.from({ length: definition.map.boxesPerSheet }, (_, i): FearMapBox => {
    const box = i + 1; return { id: boxKey(sheet, box), sheet, box, row: Math.floor(i / definition.map.columns) + 1,
      column: (i % definition.map.columns) + 1, visit: 0, visited: false, searched: false, safehouse: false };
  });
  state.mapSheets.push({ sheet, boxes });
  return boxes;
}
function findBox(state: FearState, id: string) {
  const box = state.mapSheets.flatMap(s => s.boxes).find(b => b.id === id);
  if (!box) throw new Error(`Unknown Fear map box: ${id}`);
  return box;
}
function currentBox(state: FearState) { return findBox(state, state.currentBoxId); }
function appendLog(state: FearState, line: string) { state.log.push(line); if (state.log.length > 100) state.log.shift(); }
function finishDefeatedFearCombat(story: FearStory, state: FearState, combat: FearCombat, dice: FearDice) {
  if (state.combat !== combat || combat.count > 0) return;
  const def = story.fear;
  const enemy = def.enemies[combat.enemyId];
  if (enemy?.infectionTrigger === "combat-end-after-damage" && enemy.infectionChance && combat.damageTakenThisEncounter) {
    const [numerator, denominator] = enemy.infectionChance, infectionRoll = rollSourceChance(dice, state, `${enemy.label}遭遇结束感染检定`, numerator, denominator).face;
    appendLog(state, `${enemy.label}遭遇结束感染检定: ${infectionRoll}/${denominator}`);
    if (infectionRoll <= numerator) { installInfection(state, combat.enemyId, enemy.infectionDamage ?? 2); appendLog(state, `感染：须在3格内使用急救包中的1点急救值，否则额外损失${enemy.infectionDamage ?? 2}点生命。`); }
  }
  if (enemy?.tags?.includes("vampire")) state.missionProgress[`vampire-return:${combat.enemyId}`] = true;
  if (enemy?.tags?.some(tag => tag === "unique" || tag === "killer" || tag === "unique-boss")) state.defeated.push(combat.enemyId);
  if (state.missionProgress.targetId === combat.enemyId) state.missionProgress.targetDefeated = true;
  if (state.missionRules?.missionId === "2" && state.missionRules.hunt.targetId === combat.enemyId)
    state.missionRules = transitionFearMission(state.missionRules, { type: "hunt-target-defeated", enemyId: combat.enemyId }).state;
  if (combat.enemyId === "coven-witch" && state.missionRules?.missionId === "5") {
    const witchId = String(state.missionProgress["witch-active-box"] ?? "");
    if (!witchId) throw new Error("Mission witch combat lost its map-box identity");
      resolveMissionWitch(story, state, witchId, combat.capturedWitch === true, dice);
  }
  const groupsRemain = combat.groups?.some(group => group.enemyLives.length) ?? false;
  if (groupsRemain) appendLog(state, `${def.enemies[combat.enemyId]?.label ?? combat.enemyId}已被击败；其他敌群仍在战斗。`);
  else {
    const resultEnemyId = combat.groups?.[0]?.enemyId ?? combat.enemyId;
    const outcome = combat.specialRule === "pied-piper" ? "fled" : combat.capturedWitch ? "captured" : "defeated";
    if (outcome === "defeated" || outcome === "fled") runFamilyEvent(story, state, {
      type: "combat-end", enemyId: combat.enemyId, outcome, defeatedCount: combat.defeatedCount,
      remainingLife: combat.enemyLives[0] ?? 0,
    }, dice);
    if (combat.groups?.length) for (const group of combat.groups) {
      if (group.enemyId === combat.enemyId || group.enemyLives.length) continue;
      runFamilyEvent(story, state, { type: "combat-end", enemyId: group.enemyId, outcome: "defeated",
        defeatedCount: group.defeatedCount, remainingLife: 0 }, dice);
    }
    if (outcome === "defeated") awardCombatVictoryXp(def, state, combat, combat.enemyId);
    if (outcome === "defeated" && enemy?.specialRule === "vampire-vetala" && def.rules.randomItemTable)
      state.deferredTables.push(def.rules.randomItemTable, def.rules.randomItemTable);
    if (outcome === "defeated" && ["unique-vampires-1", "unique-vampires-2"].includes(combat.enemyId) && def.rules.randomItemTable)
      state.deferredTables.push(def.rules.randomItemTable);
    if (outcome === "defeated" && combat.enemyId === "unique-vampires-3") {
      state.deferredOperations ??= [];
      state.deferredOperations.push({ op: "item", itemId: "rope", amount: 1 });
    }
    state.combat = undefined; state.combatResult = { enemyId: resultEnemyId, outcome, xpAwarded: outcome === "defeated" ? combat.xpAwarded : undefined,
      groupDefeated: combat.groups?.length ? Object.fromEntries(combat.groups.map(group => [group.enemyId, group.defeatedCount])) : undefined };
    delete state.missionProgress["flag:fire-ban"];
    delete state.missionProgress["flag:torch-extinguished"];
    consumeNextCombatModifiers(state);
    if (outcome === "defeated" && enemy?.tags?.includes("vampire")
      && !state.destroyedVampires?.includes(combat.enemyId)) {
      const options = ["leave-body"];
      if ((state.inventory.stakes ?? 0) > 0 && state.weaponIds.includes("hammer")) options.push("stake-body");
      if ((state.inventory["molotov-cocktail"] ?? 0) > 0 && ((state.inventory.matches ?? 0) > 0 || (state.inventory.lighter ?? 0) > 0)) options.push("burn-body");
      if (options.length > 1) state.pending = { kind: "vampire-body", options,
        data: { enemyId: combat.enemyId, prompt: "可按原书钉住尸体；网页适配允许用已有燃烧瓶和点火工具代替来源未提供的燃料罐。" } };
    }
  }
}
function applyFearItemEffects(story: FearStory, state: FearState, effects: ReturnType<typeof applyFearItemSourceAction>["effects"]) {
  for (const effect of effects) {
    if (effect.type === "log") appendLog(state, effect.text);
    else if (effect.type === "check-modifier") {
      const key = `fear:item:check-bonus:${effect.check}`;
      state.missionProgress[key] = Number(state.missionProgress[key] ?? 0) + effect.amount;
      appendLog(state, `${story.fear.items?.[effect.itemId]?.label ?? effect.itemId}使下一次${effect.check}检定+${effect.amount}。`);
    } else if (effect.type === "enemy-damage") {
      const combat = state.combat;
      if (!combat) continue;
      const group = combat.groups?.find(value => value.enemyId === effect.enemyId && value.enemyLives.length);
      const lives = group?.enemyLives ?? (combat.enemyId === effect.enemyId ? combat.enemyLives : undefined);
      if (!lives?.length) continue;
      if (group) {
        activateCombatGroup(story.fear, combat, group);
        combat.enemyId = group.enemyId;
        combat.enemyLives = group.enemyLives;
        combat.defeatedCount = group.defeatedCount;
        combat.count = group.enemyLives.length;
        combat.enemyLife = group.enemyLives[0] ?? 0;
      }
      if (story.fear.enemies[effect.enemyId]?.immuneWeaponTags?.includes(effect.damageType)) {
        appendLog(state, `${story.fear.enemies[effect.enemyId].label}免疫火焰伤害。`);
        continue;
      }
      const damage = Math.min(effect.amount, lives[0]);
      lives[0] -= damage;
      if (lives[0] <= 0) { discardSleepingFront(combat); lives.shift(); combat.defeatedCount++; }
      if (group) syncCombatGroup(combat, group);
      if (combat.enemyId === effect.enemyId || !combat.groups?.length) {
        combat.enemyLives = lives; combat.count = lives.length; combat.enemyLife = lives[0] ?? 0;
      }
      appendLog(state, `${story.fear.enemies[effect.enemyId]?.label ?? effect.enemyId}受到${damage}点火焰伤害。`);
    }
  }
}
function consumeFearItemCheckBonus(state: FearState, context: string) {
  const key = `fear:item:check-bonus:${context}`;
  const value = Number(state.missionProgress[key] ?? 0);
  if (value) delete state.missionProgress[key];
  return value;
}
function applyEncounterSanityLoss(state: FearState, amount: number) {
  if (amount <= 0) return 0;
  let loss = amount;
  if (state.missionProgress["fear:item:drunk:encounter-active"] === true
    || state.missionProgress["fear:item:drunk:encounter-pending"] === true) {
    const shield = consumeFearAlcoholSanityShieldOnLoss(state, loss);
    loss = shield.remainingLoss;
    if (shield.blocked) appendLog(state, "烈酒忽略了本次遭遇首次1点理智损失。");
  }
  state.sanity = Math.max(0, state.sanity - loss);
  if (state.sanity <= 0) state.status = "insane";
  return loss;
}
/**
 * Source Sanity rule: at any moment the player may prevent a 1-or-2 point Sanity loss by rolling
 * the Insanity table instead (gaining a Mental Scar). With 3 Mental Scars the loss must be accepted.
 * Applies the alcohol shield first, then queues the choice or deducts immediately.
 * Returns true when the loss is queued as a pending player choice.
 */
function resolveEncounterSanityLoss(def: FearDefinition, state: FearState, amount: number, extra?: Record<string, unknown>) {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  let loss = amount;
  if (state.missionProgress["fear:item:drunk:encounter-active"] === true
    || state.missionProgress["fear:item:drunk:encounter-pending"] === true) {
    const shield = consumeFearAlcoholSanityShieldOnLoss(state, loss);
    loss = shield.remainingLoss;
    if (shield.blocked) appendLog(state, "烈酒忽略了本次遭遇首次1点理智损失。");
  }
  if (loss <= 0) return false;
  if (loss <= 2 && state.status === "active" && !state.pending && def.tables.insanity
    && state.traumas.length < (def.rules.maxTraumas ?? 3)) {
    state.pending = { kind: "injury-prevention", options: ["take-loss", "prevent-with-scar"],
      data: { injuryKind: "sanity", amount: loss, ...extra } };
    return true;
  }
  state.sanity = Math.max(0, state.sanity - loss);
  if (state.sanity <= 0) state.status = "insane";
  return false;
}
function grantFearXp(state: FearState, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  state.xp += amount;
  const diary = applyFearItemSourceXp(state, amount);
  state.xp += diary.extraXp;
  return amount + diary.extraXp;
}
function retractGenericCombatXp(state: FearState) {
  const amount = Number(state.missionProgress["fear:item:diary:generic-xp-applied"] ?? 0);
  const previous = state.missionProgress["fear:item:diary:generic-xp-before"];
  if (amount > 0) state.xp = Math.max(0, state.xp - amount);
  if (typeof previous === "number") state.missionProgress["fear:item:diary:xp-progress"] = previous;
  delete state.missionProgress["fear:item:diary:generic-xp-applied"];
  delete state.missionProgress["fear:item:diary:generic-xp-before"];
}
function familySkillModifier(def: FearDefinition, state: FearState, context: string) {
  return context === "psionics" ? skillMod(def, state, "will-save") : skillMod(def, state, context);
}
function familyOwnerId(def: FearDefinition, combat: FearCombat | undefined, fallback: string) {
  return groupForEnemy(combat, fallback)?.enemyId ?? fallback;
}
function groupForEnemy(combat: FearCombat | undefined, enemyId: string) {
  return combat?.groups?.find(group => group.enemyId === enemyId);
}
function hasLivingGoat(def: FearDefinition, combat: FearCombat | undefined) {
  return combat?.specialRule === "demonic-goat" || !!combat?.groups?.some(group =>
    group.enemyLives.length > 0 && (group.specialRule ?? def.enemies[group.enemyId]?.specialRule) === "demonic-goat");
}
function activateCombatGroup(def: FearDefinition, combat: FearCombat, group: NonNullable<FearCombat["groups"]>[number]) {
  const enemy = def.enemies[group.enemyId];
  combat.enemyId = group.enemyId;
  combat.enemyLives = group.enemyLives;
  combat.defeatedCount = group.defeatedCount;
  combat.count = group.enemyLives.length;
  combat.enemyLife = group.enemyLives[0] ?? 0;
  combat.enemyLevel = Math.max(1, enemy.level - (combat.curseApplied?.[group.enemyId] ?? 0));
  combat.enemyDamage = enemy.damage;
  combat.damageResource = enemy.damageResource ?? "hp";
  combat.defenseContext = enemy.defenseContext;
  group.specialRule ??= enemy?.specialRule;
  group.familyRule ??= enemy?.familyRule;
  group.familyState ??= {};
  combat.specialRule = group.specialRule;
  combat.familyRule = group.familyRule;
  combat.familyState = group.familyState;
}
function syncCombatGroup(combat: FearCombat, group: NonNullable<FearCombat["groups"]>[number]) {
  group.specialRule = combat.specialRule;
  group.familyRule = combat.familyRule;
  group.familyState = combat.familyState;
  group.enemyLives = combat.enemyLives;
  group.defeatedCount = combat.defeatedCount;
  group.sleepingCount = combat.sleepingCount;
}
function restorePrimaryCombatGroup(def: FearDefinition, combat: FearCombat) {
  const primary = combat.groups?.[0];
  if (!primary) return;
  const enemy = def.enemies[primary.enemyId];
  combat.enemyId = primary.enemyId;
  combat.enemyLives = primary.enemyLives;
  combat.defeatedCount = primary.defeatedCount;
  combat.count = primary.enemyLives.length;
  combat.enemyLife = primary.enemyLives[0] ?? 0;
  combat.enemyLevel = Math.max(1, enemy.level - (combat.curseApplied?.[primary.enemyId] ?? 0));
  combat.enemyDamage = enemy.damage;
  combat.damageResource = enemy.damageResource ?? "hp";
  combat.defenseContext = enemy.defenseContext;
  activateCombatGroup(def, combat, primary);
}
function dispatchFearFamilyEffects(story: FearStory, state: FearState, effects: FearFamilyEffect[], dice: FearDice) {
  for (const effect of effects) {
    if (effect.type === "log") appendLog(state, effect.text);
    else if (effect.type === "roll-table") {
      const vivinaCombat = effect.tableId === "random-encounter" && state.combat?.familyRule === "vivina"
        ? state.combat : undefined;
      if (!vivinaCombat) runTable(story, state, effect.tableId, dice);
      else {
        const priorResult = state.combatResult;
        // The normal operation runner defers start-combat while a combat is
        // active. Temporarily clear only the active pointer so the rolled
        // encounter is actually instantiated, then merge it below.
        state.combat = undefined;
        runTable(story, state, effect.tableId, dice);
        const arrival = state.combat as FearCombat | undefined;
        if (!arrival || arrival === vivinaCombat) {
          state.combat = vivinaCombat;
          state.combatResult = priorResult;
        } else {
          const groups = vivinaCombat.groups?.map(group => ({ ...group, enemyLives: [...group.enemyLives], familyState: group.familyState })) ?? [{
            enemyId: vivinaCombat.enemyId, enemyLives: [...vivinaCombat.enemyLives], defeatedCount: vivinaCombat.defeatedCount,
            specialRule: vivinaCombat.specialRule, familyRule: vivinaCombat.familyRule,
            familyState: vivinaCombat.familyState ?? {},
          }];
          const arrivingGroups: NonNullable<FearCombat["groups"]> = arrival.groups?.length ? arrival.groups : [{
            enemyId: arrival.enemyId, enemyLives: arrival.enemyLives, defeatedCount: arrival.defeatedCount,
            specialRule: arrival.specialRule, familyRule: arrival.familyRule,
            familyState: arrival.familyState ? { ...arrival.familyState } : {},
          }];
          for (const group of arrivingGroups) {
            const existing = groups.find(value => value.enemyId === group.enemyId);
          if (existing) { existing.enemyLives.push(...group.enemyLives); existing.defeatedCount += group.defeatedCount; }
            else groups.push({ ...group, enemyLives: [...group.enemyLives], familyState: group.familyState ? { ...group.familyState } : {} });
          }
          vivinaCombat.groups = groups;
          vivinaCombat.familyState ??= {};
          vivinaCombat.familyState.intruderPresent = true;
          vivinaCombat.familyState.intruderEnemyId = arrivingGroups[0].enemyId;
          vivinaCombat.familyState.intruderEnemyIds = [...new Set([
            ...(vivinaCombat.familyState.intruderEnemyIds ?? []), ...arrivingGroups.map(group => group.enemyId),
          ])];
          // The newcomer joins this encounter. Preserve the source combat's turn
          // and family owner; the normal grouped-defense loop handles each foe.
          state.combat = vivinaCombat;
          state.combatResult = priorResult;
          appendLog(state, `${story.fear.enemies[arrivingGroups[0].enemyId]?.label ?? arrivingGroups[0].enemyId}加入薇薇娜的遭遇；每回合可选择攻击其中一方。`);
        }
      }
    }
    else if (effect.type === "pending") {
      const pending = { kind: effect.kind, options: effect.options, data: effect.data };
      if (!state.pending) state.pending = pending;
      else (state.familyRewardQueue ??= []).push(pending);
    }
    else if (effect.type === "loot") {
      if (effect.weaponId === "raygun") {
        for (let index = 0; index < effect.count && !state.pending; index++) addWeapon(story, state, "raygun");
        continue;
      }
      for (let index = 0; index < effect.count; index++) {
        if (effect.weaponId && story.fear.weapons[effect.weaponId]) addWeapon(story, state, effect.weaponId);
        else if (effect.itemId && story.fear.weapons[effect.itemId]) addWeapon(story, state, effect.itemId);
        else if (effect.itemId && story.fear.items?.[effect.itemId]) addInventoryItem(story, state, effect.itemId, 1);
        else if (effect.tableId) runTable(story, state, effect.tableId, dice);
        else throw new Error(`Fear family loot references an unknown item: ${effect.itemId ?? effect.weaponId}`);
        if (state.pending) break;
      }
    } else if (effect.type === "pickup-and-event") {
      const before = state.inventory[effect.itemId] ?? 0;
      addInventoryItem(story, state, effect.itemId, 1);
      if (!state.pending && (state.inventory[effect.itemId] ?? 0) > before) {
        const scene = story.fear.sceneRefs.events[effect.eventId];
        if (!scene) throw new Error(`Fear family pickup event ${effect.eventId} has no reviewed scene`);
        ensureScene(story, state, scene);
      }
    } else if (effect.type === "mission-progress") {
      if (effect.value === undefined) delete state.missionProgress[effect.key];
      else state.missionProgress[effect.key] = effect.value;
    } else if (effect.type === "remove-progress") delete state.missionProgress[effect.key];
    else if (effect.type === "sanity") {
      resolveEncounterSanityLoss(story.fear, state, effect.amount);
      if (state.pending) break;
    } else if (effect.type === "damage") {
      if (effect.target === "player") {
        state.hp = Math.max(0, state.hp - effect.amount);
        if (!state.hp) state.status = "dead";
      } else if (state.combat) {
        const targetId = effect.target === "dinosaur" ? "living-dolls-6-dinosaur" : state.combat.enemyId;
        const group = state.combat.groups?.find(row => row.enemyId === targetId);
        const lives = group?.enemyLives ?? state.combat.enemyLives;
        if (lives.length) {
          lives[0] = Math.max(0, lives[0] - effect.amount);
          if (lives[0] === 0) lives.shift();
          if (group) group.defeatedCount++;
          state.combat.enemyLives = lives;
          state.combat.count = lives.length;
          state.combat.enemyLife = lives[0] ?? 0;
        }
      }
    } else if (effect.type === "combat-state" && state.combat) {
      state.combat.familyState = { ...(state.combat.familyState ?? {}), ...effect.patch };
    } else if (effect.type === "enemy-profile" && state.combat) {
      if (effect.level !== undefined) state.combat.enemyLevel = effect.level;
      if (effect.life !== undefined) {
        state.combat.enemyLife = effect.life;
        state.combat.enemyLives = state.combat.enemyLives.map(() => effect.life!);
      }
    } else if (effect.type === "end-adventure") {
      appendLog(state, effect.reason);
    } else if (effect.type === "immediate-escape") {
      state.combat ??= undefined;
    } else if (effect.type === "auto-hit") {
      // Signal consumed synchronously by the current defense resolution.
    } else if (effect.type === "attack-count") {
      appendLog(state, `${effect.count}次独立攻击。`);
    } else if (effect.type === "skip-turn") {
      if (state.combat) state.combat.playerFirst = true;
    } else if (effect.type === "unique-event") {
      const scene = story.fear.sceneRefs.events[effect.eventId];
      if (!scene) throw new Error(`Fear family event ${effect.eventId} has no reviewed scene`);
      ensureScene(story, state, scene);
    }
  }
}
function runFamilyEvent(story: FearStory, state: FearState, event: FearFamilyRuntimeEvent, dice: FearDice) {
  const combat = state.combat;
  const group = groupForEnemy(combat, event.enemyId);
  const rootRule = combat?.familyRule, rootState = combat?.familyState, rootSpecial = combat?.specialRule;
  if (combat && group) {
    const enemy = story.fear.enemies[group.enemyId];
    group.familyRule ??= enemy?.familyRule;
    group.specialRule ??= enemy?.specialRule;
    group.familyState ??= {};
    combat.familyRule = group.familyRule;
    combat.familyState = group.familyState;
    combat.specialRule = group.specialRule;
  }
  const resultBefore = state.combatResult;
  const effects = runFearFamilyRuleEvent(story.fear, state, event, dice, context => familySkillModifier(story.fear, state, context));
  dispatchFearFamilyEffects(story, state, effects, dice);
  if (combat && group) {
    group.familyState = combat.familyState;
    // A family rule that ends one cohabiting enemy must not erase the other
    // active group. Treat the source's immediate escape as that group's exit.
    if (state.combat !== combat) {
      if (effects.some(effect => effect.type === "immediate-escape")) group.enemyLives = [];
      state.combat = combat;
      state.combatResult = resultBefore;
    }
    combat.familyRule = rootRule;
    combat.familyState = rootState;
    combat.specialRule = rootSpecial;
  }
  if (state.combat?.familyRule === "kalina" && state.combat.familyState?.kalinaAlive === false) {
    const dinosaur = state.combat.groups?.find(group => group.enemyId === "living-dolls-6-dinosaur");
    if (dinosaur) { dinosaur.defeatedCount += dinosaur.enemyLives.length; dinosaur.enemyLives = []; }
  }
  return effects;
}
function enemyLife(state: FearState, enemy: FearDefinition["enemies"][string]) {
  return enemy.lifeMode === "player-max" ? state.maxHp : enemy.life;
}
function installInfection(state: FearState, enemyId: string, failureDamage = 2, untilSafeHouse = false) {
  state.infections ??= [];
  if (state.infections.some(value => value.enemyId === enemyId)) return;
  state.infections.push({ id: `${enemyId}:${state.visitCount}`, enemyId, boxesRemaining: untilSafeHouse ? 0 : 3, failureDamage, ...(untilSafeHouse ? { untilSafeHouse: true } : {}) });
}
function nearPlaceOfWorship(state: FearState) {
  const box = currentBox(state);
  return state.mapSheets.flatMap(sheet => sheet.boxes).some(candidate => candidate.locationType === "worship"
    && candidate.sheet === box.sheet && Math.abs(candidate.row - box.row) + Math.abs(candidate.column - box.column) <= 1);
}
function queueAttackDamage(story: FearStory, state: FearState, damages: number[], tableId: string, limit: number, dice: FearDice, followup?: string) {
  const kind = tableId === "insanity" ? "sanity" : "life";
  if (!damages.length) {
    if (followup) state.pending = { kind: followup, options: ["take-damage", "skip-attack", ...(state.weaponId !== "unarmed" ? ["destroy-weapon"] : [])] };
    return;
  }
  let amount = damages[0]; const remaining = damages.slice(1);
  if (kind === "life" && amount > 0) {
    const absorbed = applyFearItemSourceDamage(state, amount, dice);
    amount = absorbed.damageToPlayer;
    for (const effect of absorbed.effects) if (effect.type === "log") appendLog(state, effect.text);
    if (absorbed.absorbedByVest || absorbed.absorbedByHelmet || amount === 0)
      appendLog(state, `防具吸收伤害：背心${absorbed.absorbedByVest}，头盔${absorbed.absorbedByHelmet}，剩余生命伤害${amount}。`);
  }
  if (kind === "sanity" && state.missionProgress["fear:item:drunk:encounter-active"] === true) {
    const shield = consumeFearAlcoholSanityShieldOnLoss(state, amount);
    if (shield.blocked) appendLog(state, "烈酒忽略了本次遭遇首次1点理智损失。");
    amount = shield.remainingLoss;
  }
  if (amount <= 0) { queueAttackDamage(story, state, remaining, tableId, limit, dice, followup); return; }
  const existing = kind === "life" ? state.scars : state.traumas;
  if (existing.length >= limit) { if (kind === "life") { state.hp -= amount; state.lifeLostThisEncounter = true; } else state.sanity -= amount; queueAttackDamage(story, state, remaining, tableId, limit, dice, followup); return; }
  state.pending = { kind: "injury-prevention", options: ["take-loss", "prevent-with-scar", ...(kind === "life" && state.luck > 0 ? ["spend-luck"] : [])], data: { injuryKind: kind, amount, tableId, remaining, followup } };
}
function applyForcedInjury(story: FearStory, state: FearState, dice: FearDice) {
  const def = story.fear, tableId = "injury", table = def.tables[tableId];
  if (state.scars.length >= def.rules.maxScars) {
    state.hp -= 3;
    appendLog(state, "僵尸虎：已有3处伤残，改为损失3点生命。");
    return;
  }
  if (!table) throw new Error("Zombie Tiger source rule requires the reviewed Injury table");
  let result = drawTableEntry(def, tableId, dice), retries = 0;
  while (state.scars.includes(result.entry.result) && retries++ < 12) result = drawTableEntry(def, tableId, dice);
  if (state.scars.includes(result.entry.result)) {
    state.pending = { kind: "injury-repeat-roll", options: ["reroll"], data: { tableId, mode: "forced" } };
    appendLog(state, `僵尸虎强制伤残检定连续${retries}次掷出已有结果；按来源继续重掷。`);
    return;
  }
  state.scars.push(result.entry.result);
  appendLog(state, `僵尸虎重创：强制掷伤残表，结果为${def.injuries?.[result.entry.result]?.label ?? result.entry.result}。`);
  resolveTableEntry(story, state, tableId, result.roll, result.entry, dice);
}
function finishClinicSearch(story: FearStory, state: FearState, dice: FearDice) {
  const remaining = Number(state.missionProgress.clinicSearches ?? 0);
  if (remaining <= 0) return;
  state.missionProgress.clinicSearches = remaining - 1;
  if (remaining === 1) {
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(story.fear, state, "stealth");
    appendLog(state, `精神病房L6潜行: ${face} => ${total}`);
    if (face === 1 || (face !== 6 && total < 6)) runTable(story, state, String(state.missionProgress.clinicFailureTable ?? "slashers"), dice);
  }
}
function drainDeferredTables(story: FearStory, state: FearState, dice: FearDice) {
  const houseRewardPending = state.missionProgress["fear:house-rewards:pending"] === true;
  if (houseRewardPending && !state.combat && state.combatResult) {
    delete state.missionProgress["fear:house-rewards:pending"];
    if (state.combatResult.enemyId === "zombie" && state.combatResult.outcome === "defeated")
      state.deferredTables.unshift("rewards");
  }
  while (!state.pending && !state.combat && (!state.pendingEvent || state.pendingEvent.started) && (state.deferredOperations?.length || state.deferredTables.length)) {
    if (state.deferredOperations?.length) runOperations(story, state, [state.deferredOperations.shift()!], dice);
    else runTable(story, state, state.deferredTables.shift()!, dice);
  }
  const rewardsReturnNode = state.missionProgress["fear:rewards:return-node"];
  if (!state.pending && !state.combat && !state.deferredOperations?.length && !state.deferredTables.length
    && typeof rewardsReturnNode === "string") {
    delete state.missionProgress["fear:rewards:return-node"];
    ensureScene(story, state, rewardsReturnNode);
  }
  if (!state.pending && !state.combat && !state.deferredOperations?.length && !state.deferredTables.length && state.pendingEvent?.started) state.pendingEvent = undefined;
}
function resolveWitchLibrarianSpell(def: FearDefinition, state: FearState, dice: FearDice, label: string) {
  const { face, total: explodedTotal } = rollSourceCheck(dice, state, `女巫图书管理员${label}魔法豁免`);
  const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "magic-save");
  const success = face === 6 || (face !== 1 && total >= 5);
  appendLog(state, `女巫图书管理员${label}：L5魔法豁免 ${face} => ${total}（${success ? "成功" : "失败"}）。`);
  if (!success) {
    if (!resolveEncounterSanityLoss(def, state, 2)) appendLog(state, "魔法攻击失败：损失2点理智。");
  }
  return success;
}
function rollExploding(dice: FearDice, state: FearState, label: string) {
  dice = fearDiceScope(dice, `check:${label}`);
  const rolls: number[] = []; let value = die(dice); rolls.push(value);
  while (value === 6) {
    if (rolls.length >= 1000) throw new Error("Exploding D6 chain exceeded the safety limit; state was not committed");
    value = die(dice); rolls.push(value);
  }
  appendLog(state, `${label}: ${rolls.join("+")} = ${rolls.reduce((a, b) => a + b, 0)}`);
  return { first: rolls[0], total: rolls.reduce((a, b) => a + b, 0) };
}
/** The source's ordinary threshold checks are one D6; explosions are reserved for Attack dice. */
function rollSourceCheck(dice: FearDice, state: FearState, label: string) {
  dice = fearDiceScope(dice, `check:${label}`);
  const face = die(dice);
  appendLog(state, `${label} #${state.log.length}: ${face}`);
  return { face, total: face };
}
/** Probability rolls are a single D6; a natural six is not an Attack die. */
function rollSourceChance(dice: FearDice, state: FearState, label: string, numerator: number, denominator = 6) {
  const result = rollSourceCheck(dice, state, label);
  return { face: result.face, success: result.face <= numerator * 6 / denominator, denominator };
}
function canonicalSkillContext(context: string) {
  return ({ will: "will-save", willpower: "will-save", stealth: "stealth-save", agile: "agility-save",
    psionics: "psionic-save", magic: "magic-save", fear: "fear-save" } as Record<string, string>)[context] ?? context;
}
function skillMod(def: FearDefinition, state: FearState, context: string) {
  const sourceContext = canonicalSkillContext(context);
  let totalSkillBonus = 0, defenseChoiceBonus = 0;
  for (const [id, level] of [...Object.entries(state.skills), ...Object.entries(state.arcaneSkills)]) {
    const values = def.skills[id]?.modifiers[sourceContext] ?? def.skills[id]?.modifiers[context];
    if (values && level > 0) {
      const bonus = values[level - 1] ?? 0;
      if (sourceContext === "defense" && (id === "agile" || id === "dodge")) defenseChoiceBonus = Math.max(defenseChoiceBonus, bonus);
      else totalSkillBonus += bonus;
    }
  }
  const modifier = (modifiers: Record<string, number> | undefined) => modifiers?.[sourceContext] ?? modifiers?.[context] ?? 0;
  const injury = state.scars.reduce((sum, id) => sum + modifier(def.injuries?.[id]?.modifiers), 0);
  const trauma = state.traumas.reduce((sum, id) => sum + modifier(def.traumas?.[id]?.modifiers), 0);
  const campaign = Number(state.missionProgress[`modifier:campaign:${sourceContext}`] ?? state.missionProgress[`modifier:campaign:${context}`] ?? 0);
  const mission = Number(state.missionProgress[`modifier:mission:${sourceContext}`] ?? state.missionProgress[`modifier:mission:${context}`] ?? 0);
  const nextCombat = Number(state.missionProgress[`modifier:left:${sourceContext}`] ?? state.missionProgress[`modifier:left:${context}`] ?? 0) > 0
    ? Number(state.missionProgress[`modifier:next-combat:${sourceContext}`] ?? state.missionProgress[`modifier:next-combat:${context}`] ?? 0) : 0;
  const cursed = state.missionProgress["flag:cursed"] === true ? -1 : 0;
  const amulet = sourceContext === "magic-save" && (state.inventory.amulet ?? 0) > 0 ? 1 : 0;
  const vehn = sourceContext === "charisma" && state.vehnCharismaPenalty && state.hp < state.maxHp ? -1 : 0;
  const limping = (sourceContext === "attack" || sourceContext === "attack-melee") && state.limpingUntilFullHeal && state.hp < state.maxHp ? -1 : 0;
  const lightBlind = Number(state.missionProgress["modifier:left:light-blind"] ?? 0) > 0
    && ["attack", "attack-melee", "defense", "magic", "magic-save", "exorcism"].includes(sourceContext) ? -1 : 0;
  const clownMask = sourceContext === "charisma" && state.missionProgress["flag:clownface-worn"] === true ? -1 : 0;
  return totalSkillBonus + defenseChoiceBonus + injury + trauma + campaign + mission + nextCombat + cursed + amulet + vehn + limping + lightBlind + clownMask;
}
function isHypnosEligible(def: FearDefinition, enemyId: string) {
  const enemy = def.enemies[enemyId];
  return !!enemy && !enemy.tags?.some(tag => ["undead", "ghost", "artificial", "animated-doll"].includes(tag)) && !enemyId.startsWith("living-dolls-");
}
function markBookRead(def: FearDefinition, state: FearState, bookId: string, dice: FearDice) {
  if (bookId === "holy-book") {
    const options = ["recover-sanity"];
    for (const skillId of ["demon-slayer", "gate"])
      if (def.skills[skillId] && (state.arcaneSkills[skillId] ?? 0) === 0 && state.xp >= 2) options.push(`learn:${skillId}`);
    state.pending = { kind: "holy-book-reading", options, data: { bookId, prompt: "阅读圣书：恢复2点理智，或花费2点经验学习恶魔猎手／地狱之门。" } };
    return;
  }
  if (!state.readBooks.includes(bookId)) state.readBooks.push(bookId);
  if (bookId === "necronomicon") {
    state.sanity--; appendLog(state, "阅读《死灵之书》：失去1点理智；之后可用经验学习任意奥术技能。");
  } else if (bookId === "serial-killers-casebook") {
    state.missionProgress["flag:serial-killers-casebook-read"] = true;
    appendLog(state, "阅读《连环杀手案例簿》：以后即使遭遇写明禁止逃跑，也可尝试逃离杀手。");
  } else if (bookId === "de-masticatione") {
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "fear-save");
    const success = face === 6 || (face !== 1 && total >= 3);
    appendLog(state, `阅读《墓中死者的咀嚼》：L3恐惧防御 ${face} => ${total}（${success ? "成功" : "失败"}）；对非鬼魂不死生物攻击永久+1。`);
    if (!success) { state.sanity--; appendLog(state, "恐惧防御失败：失去1点理智。"); }
  } else appendLog(state, `阅读${def.items?.[bookId]?.label ?? bookId}；书籍保留，已记录其知识效果。`);
  if (state.sanity <= 0) state.status = "insane";
}
function discardSleepingFront(target: { sleepingCount?: number }) {
  if ((target.sleepingCount ?? 0) > 0) target.sleepingCount!--;
}
function consumeNextCombatModifiers(state: FearState) {
  for (const [key, value] of Object.entries(state.missionProgress)) {
    if (!key.startsWith("modifier:left:")) continue;
    const left = Number(value) - 1; state.missionProgress[key] = Math.max(0, left);
    if (left <= 0) delete state.missionProgress[`modifier:next-combat:${key.slice("modifier:left:".length)}`];
  }
}
function namedSkillMod(def: FearDefinition, state: FearState, skillId: string, context: string) {
  const sourceContext = canonicalSkillContext(context);
  const level = state.arcaneSkills[skillId] ?? state.skills[skillId] ?? 0;
  const base = level > 0 ? (def.skills[skillId]?.modifiers[sourceContext] ?? def.skills[skillId]?.modifiers[context])?.[level - 1] ?? 0 : 0;
  const lightBlind = Number(state.missionProgress["modifier:left:light-blind"] ?? 0) > 0
    && ["attack", "attack-melee", "defense", "magic", "magic-save", "exorcism"].includes(sourceContext) ? -1 : 0;
  return base + lightBlind;
}
/**
 * A requiredSkill on a source check identifies the skill used for that roll.
 * Magic saves are the printed exception: a Will save against Magic also gets
 * the separate Occultist save bonus; a casting roll requiring Occultist does
 * not get Will's defensive bonus.
 */
function sourceCheckSkillMod(def: FearDefinition, state: FearState, context: string, requiredSkill?: string) {
  let modifier = requiredSkill === "will" && canonicalSkillContext(context) === "magic-save"
    ? skillMod(def, state, context)
    : requiredSkill ? namedSkillMod(def, state, requiredSkill, context) : skillMod(def, state, context);
  const canonical = canonicalSkillContext(context);
  if (canonical === "fear-save") modifier += applyFearItemSourceCheck(state, { kind: "check", check: "sanity-avoid" }).modifier;
  const itemCheck = context === "stealth-save" ? "stealth" : context;
  modifier += consumeFearItemCheckBonus(state, itemCheck);
  return modifier;
}
function exorcismModifier(def: FearDefinition, state: FearState) {
  return namedSkillMod(def, state, "will", "exorcism") + namedSkillMod(def, state, "exorcism", "exorcism");
}
const CURSE_CATEGORY_LABELS: Record<string, string> = {
  zombie: "僵尸", demon: "恶魔", alien: "外星人", mutant: "变种人", vampire: "吸血鬼", ghost: "鬼魂", witch: "女巫", slasher: "杀手",
};
function curseMatches(def: FearDefinition, target: string, enemyId: string) {
  if (target.startsWith("specific:")) return target.slice(9) === enemyId;
  if (!target.startsWith("category:")) return false;
  const category = target.slice(9), enemy = def.enemies[enemyId];
  return enemy?.tags?.includes(category) ?? false;
}
function curseCanAffect(def: FearDefinition, enemyId: string) {
  const enemy = def.enemies[enemyId];
  return !!enemy && !enemy.immunity?.includes("magic");
}
function creatureSkillMod(def: FearDefinition, state: FearState, enemyId: string, context: string) {
  const enemy = def.enemies[enemyId], tags = enemy?.tags ?? [];
  const pentagram = context === "defense" && state.missionProgress["flag:pentagram"] === true && tags.includes("demon") ? 1 : 0;
  const categories = ["vampire", "zombie", "alien", "mutant", "demon"].filter(category => tags.includes(category));
  const speciesBonus = categories.reduce((best, category) => Math.max(best, skillMod(def, state, `${context}-${category}`)), 0);
  const demonSlayer = tags.includes("demonic-horrors-table")
    ? context === "defense" ? namedSkillMod(def, state, "demon-slayer", "defense-demon")
      : context.includes("save") ? namedSkillMod(def, state, "demon-slayer", "demon-save") : 0
    : 0;
  return pentagram + Math.max(speciesBonus, demonSlayer);
}
function skillStatBonus(def: FearDefinition, skills: Record<string, number>, key: "maxHpChange" | "maxSanityChange", level = 0) {
  return Object.entries(skills).reduce((total, [id, value]) => {
    if (value < 1) return total;
    const values = def.skills[id]?.[key];
    return total + (values ? values[value - 1] ?? 0 : 0);
  }, level);
}
function applySkillLevel(def: FearDefinition, state: FearState, skillId: string, before: number, after: number) {
  const spec = def.skills[skillId];
  const hp = (spec?.maxHpChange?.[after - 1] ?? 0) - (spec?.maxHpChange?.[before - 1] ?? 0);
  const sanity = (spec?.maxSanityChange?.[after - 1] ?? 0) - (spec?.maxSanityChange?.[before - 1] ?? 0);
  state.maxHp = Math.max(0, state.maxHp + hp); state.hp = Math.max(0, Math.min(state.maxHp, state.hp + hp));
  state.maxSanity = Math.max(0, state.maxSanity + sanity); state.sanity = Math.max(0, Math.min(state.maxSanity, state.sanity + sanity));
}
function grantStartingSkillEquipment(def: FearDefinition, state: FearState, skillId: string, dice: FearDice) {
  const skill = def.skills[skillId]; if (!skill) return;
  for (const weaponId of skill.startingWeapons ?? []) if (!state.weaponIds.includes(weaponId) && def.weapons[weaponId]) state.weaponIds.push(weaponId);
  for (const itemId of skill.startingItems ?? []) state.inventory[itemId] = (state.inventory[itemId] ?? 0) + 1;
  for (const [weaponId, amount] of Object.entries(skill.startingAmmo ?? {})) state.ammo[weaponId] = (state.ammo[weaponId] ?? 0) + tableRoll(amount, dice);
}
function carryCapacity(def: FearDefinition, state: FearState) {
  const strongLevel = state.skills.strong ?? 0;
  const strongBonus = strongLevel > 0 ? def.skills.strong?.capacityBonus?.[strongLevel - 1] ?? 0 : 0;
  return 10 + (state.inventory.backpack ? 5 : 0) + strongBonus;
}
function removeWeaponInstance(state: FearState, weaponId: string) {
  const index = state.weaponIds.indexOf(weaponId);
  if (index < 0) return false;
  state.weaponIds.splice(index, 1);
  if (!state.weaponIds.includes(weaponId) && state.weaponId === weaponId) state.weaponId = "unarmed";
  if (state.combat && state.combat.weaponId === weaponId && state.weaponId !== weaponId) state.combat.weaponId = state.weaponId;
  return true;
}
function qualifiedFirearmCount(state: FearState) {
  const counts = new Map<string, number>();
  for (const id of state.weaponIds) if (["pistol", "rifle", "shotgun"].includes(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
  let qualifying = 0;
  for (const [id, count] of counts) qualifying += Math.min(count,
    Math.floor(Math.max(0, (state.ammo[id] ?? 0) + silverAmmoCount(state, id)) / 6));
  return qualifying;
}
function carriedItemCount(def: FearDefinition, state: FearState) {
  const objects = Object.entries(state.inventory).reduce((total, [id, count]) =>
    total + (id === "backpack" || def.items?.[id]?.weightless ? 0 : Math.max(0, count) * (def.items?.[id]?.carriedWeight ?? 1)), 0);
  const weapons = state.weaponIds.filter(id => id !== "unarmed").length + fearRaygunAdditionalCarrySlots(state);
  return objects + weapons;
}
function foodBaseCapacity(state: FearState) { return state.inventory.backpack ? 15 : 10; }
function carriedFood(def: FearDefinition, state: FearState) { return Math.max(0, state.food) + Math.max(0, state.missionFood); }
function carriedFoodLimit(def: FearDefinition, state: FearState) {
  return foodBaseCapacity(state) + Math.max(0, carryCapacity(def, state) - carriedItemCount(def, state));
}
function addFood(def: FearDefinition, state: FearState, amount: number) {
  if (amount < 0) { state.food = Math.max(0, state.food + Math.floor(amount)); return; }
  recordFearFoodPickup(state, Math.floor(amount));
}
function addFoodAfterSaltChoice(def: FearDefinition, state: FearState, amount: number) {
  const accepted = Math.min(Math.max(0, amount), Math.max(0, carriedFoodLimit(def, state) - carriedFood(def, state)));
  state.food = clamp(state.food + accepted, 0, carriedFoodLimit(def, state));
}
function canCarryObject(def: FearDefinition, state: FearState, itemId: string) {
  return itemId === "backpack" || def.items?.[itemId]?.weightless === true
    || carriedItemCount(def, state) + Math.max(0, carriedFood(def, state) - foodBaseCapacity(state))
      + (def.items?.[itemId]?.carriedWeight ?? 1) <= carryCapacity(def, state);
}
const SILVER_FIREARMS = ["pistol", "rifle", "shotgun"] as const;
function silverAmmoCount(state: FearState, weaponId: string) { return Math.max(0, state.silverAmmo?.[weaponId] ?? 0); }
function hasHolySymbol(state: FearState) { return (state.inventory["holy-symbol"] ?? 0) > 0 || (state.inventory["silver-crucifix"] ?? 0) > 0; }
function silverCraftOptions(def: FearDefinition, state: FearState) {
  if (state.combat) return [] as { action: FearAction; label: string; hint: string }[];
  const choices: { material: string; output: string; label: string; hint: string }[] = [];
  if ((state.ammo.shotgun ?? 0) > 0) for (const material of ["silver-ring", "silver-necklace"])
    if ((state.inventory[material] ?? 0) > 0) choices.push({ material, output: "shotgun-shell",
      label: `装填银弹：用${def.items?.[material]?.label ?? material}将1发霰弹改为银弹`,
      hint: "按原文直接将戒指或项链装入一发霰弹；消耗该银饰与1发普通霰弹，无需冶炼工具。" });
  if ((state.inventory["smelting-tools"] ?? 0) < 1) return choices.map(({ material, output, label, hint }) => ({ action: { type: "craft-silver" as const, target: material, choice: output }, label, hint }));
  const materials = ["silver-necklace", "silver-crescent", "silver-ring", "silver-crucifix"];
  for (const material of materials) if ((state.inventory[material] ?? 0) > 0) {
    const amount = material === "silver-necklace" ? "D3" : material === "silver-crescent" ? "2" : material === "silver-ring" ? "1" : "2D6";
    for (const firearm of SILVER_FIREARMS) choices.push({ material, output: `bullets:${firearm}`,
      label: `冶炼${def.items?.[material]?.label ?? material}：制成${amount}发${def.weapons[firearm]?.label ?? firearm}银弹`,
      hint: `消耗1件${def.items?.[material]?.label ?? material}；网页适配：因原文未标明弹药口径，制作时选择登记为${firearm}口径。冶炼工具保留。` });
    if (material === "silver-crucifix") choices.push({ material, output: "silver-knife", label: "冶炼银十字架：制成银刀",
      hint: "消耗银十字架并保留冶炼工具；网页适配：来源未给银刀独立数值，沿用普通刀的伤害与攻击修正，仅增加银制标签。" });
  }
  return choices.map(({ material, output, label, hint }) => ({ action: { type: "craft-silver" as const, target: material, choice: output }, label, hint }));
}
function carryCapacityDiscardOptions(def: FearDefinition, state: FearState, decline: string) {
  const itemIds = Object.entries(state.inventory)
    .filter(([id, count]) => count > 0 && !def.items?.[id]?.weightless && (def.items?.[id]?.carriedWeight ?? 1) > 0)
    .map(([id]) => id);
  const weaponIds = [...new Set(state.weaponIds.filter(id => id !== "unarmed" && !isCursedWeapon(def, id)))];
  return [decline, ...itemIds.map(id => `discard-item:${id}`), ...weaponIds.map(id => `discard-weapon:${id}`)];
}
function addMissionFood(story: FearStory, state: FearState, amount: number) {
  const def = story.fear;
  if (amount < 0) { state.missionFood = Math.max(0, state.missionFood + Math.floor(amount)); return 0; }
  const remaining = Math.max(0, Math.floor(amount));
  const room = Math.max(0, carriedFoodLimit(def, state) - carriedFood(def, state));
  const accepted = Math.min(room, remaining);
  state.missionFood += accepted;
  if (accepted < remaining) {
    state.pending = { kind: "carry-capacity", options: carryCapacityDiscardOptions(def, state, "discard-new-mission-food"),
      data: { missionFood: true, remaining: remaining - accepted, prompt: `携带空间已满。丢弃一件携带物品后收取剩余${remaining - accepted}点任务食物，或放弃这些新食物。` } };
  }
  return accepted;
}
function checkRitualComponentAvailability(story: FearStory, state: FearState, itemId: string, dice: FearDice) {
  if (itemId === "ritual-dagger" && state.weaponIds.includes("kitchen-knife")) return true;
  if (!state.traumas.includes("absent-mindedness") || state.weaponIds.includes(itemId)) return true;
  const face = rollSourceChance(dice, state, `心不在焉检查${resultLabel(story.fear, itemId)}`, 1).face;
  appendLog(state, `心不在焉：检查仪式组件${resultLabel(story.fear, itemId)}，掷出${face}/6。`);
  if (face !== 1) return true;
  if (itemId === "food") state.food = Math.max(0, state.food - 1);
  else {
    state.inventory[itemId] = Math.max(0, (state.inventory[itemId] ?? 0) - 1);
    if (!state.inventory[itemId]) delete state.inventory[itemId];
  }
  const houses = state.safehouseIds.map(id => findBox(state, id)).filter(box => box.safehouse);
  if (houses.length === 0) {
    appendLog(state, `心不在焉：${resultLabel(story.fear, itemId)}不可用并已遗失（没有安全屋）。`);
  } else {
    const itemKey = `item:${itemId}`;
    if (houses.length === 1) {
      const box = houses[0]; box.storedItems ??= {}; box.storedItems[itemKey] = (box.storedItems[itemKey] ?? 0) + 1;
      appendLog(state, `心不在焉：${resultLabel(story.fear, itemId)}不可用，已留在安全屋。`);
    } else {
      state.pending = { kind: "absent-mindedness-storage", options: houses.map(box => box.id),
        data: { itemKey, itemId, prompt: `选择将不可用的${resultLabel(story.fear, itemId)}留在哪一处已登记安全屋。` } };
    }
  }
  return false;
}
function addInventoryItem(story: FearStory, state: FearState, itemId: string, amount: number, dice?: FearDice) {
  const def = story.fear;
  for (let unit = 0; unit < amount; unit++) {
    const sourceWeapon = resolveFearItemSourceWeapon(itemId, dice ?? (() => { throw new Error(`Fear item ${itemId} requires a source weapon-quality roll`); }));
    if (sourceWeapon) {
      addWeapon(story, state, sourceWeapon.weaponId, undefined, dice);
      if (state.pending) return;
      if (sourceWeapon.qualityRoll) appendLog(state, `武士刀品质检定：${sourceWeapon.qualityRoll}（${sourceWeapon.weaponId === "katana" ? "名刀" : "廉价武士刀"}）。`);
      continue;
    }
    if (state.missionProgress["flag:next-book-vanishes"] === true && def.items?.[itemId]?.tags?.includes("book")) {
      delete state.missionProgress["flag:next-book-vanishes"];
      appendLog(state, "图书管理员鬼魂取走了你本战役中找到的下一本书；它在阅读前消失。");
      continue;
    }
    if (canCarryObject(def, state, itemId)) {
      if (itemId === "hell-chain" && (state.inventory[itemId] ?? 0) === 0) state.hellChainHits = 0;
      state.inventory[itemId] = (state.inventory[itemId] ?? 0) + 1;
      registerFearSourceItemAcquisition(state, itemId, 1);
      const bookSource = state.missionProgress["fear:book-source-pending"];
      if (def.items?.[itemId]?.tags?.includes("book") && (bookSource === "random-book" || bookSource === "computer-printout")) {
        state.bookSources ??= {};
        state.bookSources[itemId] = bookSource;
      }
      if (itemId === "occult-guide" && (state.inventory.cord ?? 0) > 0 && !state.resolvedEvents.includes("36"))
        ensureScene(story, state, story.fear.sceneRefs.events["36"]);
      continue;
    }
    const discardOptions = carryCapacityDiscardOptions(def, state, "discard-new");
    state.pending = { kind: "carry-capacity", options: discardOptions, data: { itemId, remaining: amount - unit } };
    return;
  }
}
function addWeapon(story: FearStory, state: FearState, weaponId: string, ammo?: string, dice?: FearDice) {
  const def = story.fear;
  if (!def.weapons[weaponId]) throw new Error(`Unknown Fear weapon ${weaponId}`);
  if (weaponId === "raygun") {
    if (!canCarryObject(def, state, weaponId)) {
      const discardOptions = carryCapacityDiscardOptions(def, state, "discard-new");
      state.pending = { kind: "carry-capacity", options: discardOptions, data: { weaponId, remaining: 1, ammo } };
      return;
    }
    addFearRayguns(state, 1);
    return;
  }
  if (!canCarryObject(def, state, weaponId)) {
    const discardOptions = carryCapacityDiscardOptions(def, state, "discard-new");
    state.pending = { kind: "carry-capacity", options: discardOptions, data: { weaponId, remaining: 1, ammo } };
    return;
  }
  state.weaponIds.push(weaponId);
  if (ammo && dice) state.ammo[weaponId] = (state.ammo[weaponId] ?? 0) + tableRoll(ammo, dice);
}
function canWield(def: FearDefinition, state: FearState, weaponId: string) {
  const weapon = def.weapons[weaponId]; if (!weapon) return false;
  if (weaponId === "flashlight" && !fearFlashlightUsable(state)) return false;
  if (!fearFamilyWeaponUsable(state, weaponId)) return false;
  const crippledArm = state.scars.some(id => def.injuries?.[id]?.flags?.includes("no-two-handed-weapons"));
  // The source Injury table explicitly exempts rifles and shotguns: they remain
  // usable one-handed at -1 Attack. Other two-handed weapons are unavailable.
  if (crippledArm && weapon.tags?.includes("two-handed") && weaponId !== "rifle" && weaponId !== "shotgun") return false;
  return true;
}
function awardCombatVictoryXp(def: FearDefinition, state: FearState, combat: FearCombat, enemyId: string) {
  clearDefeatedOccupiedEncounter(def, state, combat, enemyId);
  if (combat.xpAwarded) return;
  const enemy = def.enemies[enemyId];
  // The Coven mission has its own per-witch/final-witch XP accounting, paid
  // when that objective resolves; avoid paying the general encounter award too.
  if (def.missions[state.missionId]?.kind === "witches" && enemy?.tags?.includes("witch")) return;
  const previousDiaryProgress = state.missionProgress["fear:item:diary:xp-progress"];
  const actual = grantFearXp(state, 1);
  state.missionProgress["fear:item:diary:generic-xp-before"] = typeof previousDiaryProgress === "number" ? previousDiaryProgress : 0;
  state.missionProgress["fear:item:diary:generic-xp-applied"] = actual;
  combat.xpAwarded = true;
}
function clearDefeatedOccupiedEncounter(def: FearDefinition, state: FearState, combat: FearCombat, enemyId: string) {
  const box = currentBox(state), occupied = box.occupiedEncounter;
  if (!occupied || occupied.enemyId !== enemyId) return;
  const group = combat.groups?.find(value => value.enemyId === enemyId);
  const defeated = group ? group.enemyLives.length === 0
    : combat.enemyId === enemyId && combat.enemyLives.length === 0;
  if (!defeated) return;
  box.occupiedEncounter = undefined;
  box.occupiedBy = box.occupiedBy?.filter(value => value !== enemyId);
  if (!box.occupiedBy?.length) box.occupiedBy = undefined;
  appendLog(state, `已击败原先占据此区域的${def.enemies[enemyId]?.label ?? enemyId}；该区域不再保留此遭遇。`);
}
function operationsGrantXp(operations: FearOperation[]): boolean {
  // Explicit encounter XP overrides the generic reward only when it is a
  // direct effect of the selected combat outcome; nested conditional branches
  // may be optional bonuses and must not suppress the guaranteed base XP.
  return operations.some(operation => operation.op === "resource" && operation.key === "xp"
    && (typeof operation.amount !== "number" || operation.amount > 0));
}
function isCursedWeapon(def: FearDefinition, weaponId: string) { return def.weapons[weaponId]?.tags?.includes("cursed") ?? false; }
function ensureScene(story: FearStory, state: FearState, ref?: string, eventAlreadyPlayed?: boolean) {
  if (ref) {
    if (!story.nodes.some(n => n.id === ref)) throw new Error(`Unknown node ${ref}`);
    state.nodeId = ref;
    const eventId = Object.entries(story.fear.sceneRefs.events).find(([, scene]) => scene === ref)?.[0];
    if (eventId && story.fear.eventPrograms[eventId]) state.pendingEvent = { eventId, alreadyPlayed: eventAlreadyPlayed ?? state.resolvedEvents.includes(eventId), started: false, visitCount: state.visitCount };
  }
}
function reachable(state: FearState, definition: FearDefinition) {
  const box = currentBox(state);
  const neighbors = state.mapSheets.flatMap(s => s.boxes).filter(candidate => {
    if (candidate.sheet !== box.sheet) return false;
    const row = Math.abs(candidate.row - box.row), column = Math.abs(candidate.column - box.column);
    return definition.map.adjacency === "diagonal" ? Math.max(row, column) === 1 : row + column === 1;
  }).map(candidate => candidate.id);
  return [...neighbors, ...(state.mapLinks[box.id] ?? [])];
}
function boxNeighbors(state: FearState, box: FearMapBox, definition: FearDefinition) {
  const neighbors = state.mapSheets.flatMap(s => s.boxes).filter(candidate => {
    if (candidate.sheet !== box.sheet) return false;
    const row = Math.abs(candidate.row - box.row), column = Math.abs(candidate.column - box.column);
    return definition.map.adjacency === "diagonal" ? Math.max(row, column) === 1 : row + column === 1;
  });
  return [...neighbors, ...(state.mapLinks[box.id] ?? []).map(id => findBox(state, id))];
}
function distanceBetween(state: FearState, from: string, to: string, definition: FearDefinition) {
  const queue: Array<[string, number]> = [[from, 0]], visited = new Set([from]);
  while (queue.length) {
    const [id, distance] = queue.shift()!; if (id === to) return distance;
    for (const neighbor of boxNeighbors(state, findBox(state, id), definition)) if (!visited.has(neighbor.id)) { visited.add(neighbor.id); queue.push([neighbor.id, distance + 1]); }
  }
  return Number.MAX_SAFE_INTEGER;
}
function addSafehouse(state: FearState, definition: FearDefinition, id: string, dice: FearDice, threshold: "after-create-3" | "before-create-3", visitHealLife = 4, visitHealSanity = 2) {
  const priorCount = state.safehouseIds.length;
  const newSafehouse = findBox(state, id); newSafehouse.safehouse = true;
  newSafehouse.safehouseHealLife = visitHealLife; newSafehouse.safehouseHealSanity = visitHealSanity;
  if (!state.safehouseIds.includes(id)) state.safehouseIds.push(id);
  const shouldRetire = threshold === "after-create-3" ? state.safehouseIds.length === 3 : priorCount >= 3;
  if (shouldRetire) {
    const candidates = state.safehouseIds.filter(existing => existing !== id);
    const distances = candidates.map(existing => distanceBetween(state, id, existing, definition));
    const nearest = Math.min(...distances); const tied = candidates.filter((_, index) => distances[index] === nearest);
    const removed = tied.length === 1 ? tied[0] : tied[(die(dice) - 1) % tied.length];
    state.safehouseIds = state.safehouseIds.filter(existing => existing !== removed);
    const retired = findBox(state, removed); retired.safehouse = false; retired.retiredSafehouse = true; retired.storageTheftResolved = false;
  }
}
function ensureBoxForVisit(state: FearState, definition: FearDefinition, target?: string) {
  let id = target;
  if (!id) {
    const options = reachable(state, definition);
    id = options.find(v => !findBox(state, v).visited);
    if (!id) {
      const sheet = state.mapSheets.find(s => s.sheet === currentBox(state).sheet)!;
      if (sheet.boxes.some(b => !b.visited)) throw new Error("Move through a recorded neighboring area to reach an unvisited box");
      if (state.missionProgress.completed === true) throw new Error("A new sheet requires an unfinished mission");
      const next = newSheet(state, definition)[0]; id = next.id;
      const anchor = currentBox(state).id;
      state.mapLinks[anchor] = [...(state.mapLinks[anchor] ?? []), id];
      state.mapLinks[id] = [...(state.mapLinks[id] ?? []), anchor];
    }
  }
  const box = findBox(state, id);
  if (!reachable(state, definition).includes(id)) throw new Error("Fear movement must follow an adjacent box or recorded sheet connection");
  return box;
}
function visitBox(story: FearStory, state: FearState, box: FearMapBox, dice: FearDice) {
  const def = story.fear;
  const revisiting = box.visited;
  const huntTargetEncountered = state.missionRules?.missionId === "2" && state.missionRules.hunt.targetOnNextBox;
  box.visited = true; box.visit = ++state.visitCount; state.currentBoxId = box.id;
  const drunkBefore = Number(state.missionProgress["fear:item:drunk:boxes"] ?? 0);
  if (drunkBefore > 0) {
    applyFearItemSourceMove(state, 1);
    if (Number(state.missionProgress["fear:item:drunk:boxes"] ?? 0) === 0)
      appendLog(state, "烈酒效果结束。受酒精影响的理智防护仍限于已开始的那场遭遇。");
  }
  if (revisiting && box.locationType === "worship") recordFearWorshipVisit(state, `${box.id}:${state.visitCount}`);
  syncMissionBoxEntered(state, box);
  checkMissionMedicalFallback(story, state, box, dice);
  if (revisiting && box.safehouse && (box.entryFoodCost ?? 0) > 0) {
    const cost = box.entryFoodCost!;
    if (state.food >= cost) { state.food -= cost; appendLog(state, `进入下水道安全屋：支付${cost}点食物。`); }
    else {
      box.safehouse = false; box.retiredSafehouse = true; box.storageTheftResolved = false;
      state.safehouseIds = state.safehouseIds.filter(id => id !== box.id);
      appendLog(state, "没有支付进入食物：该处不再是安全屋，遭遇概率为2/6。");
      if (box.storedItems && Object.keys(box.storedItems).length) {
        const theftRoll = rollSourceChance(dice, state, "退役安全屋存放物品失窃检定", 3).face; box.storageTheftResolved = true;
        if (theftRoll <= 3) { box.storedItems = {}; appendLog(state, `退役安全屋中的存放物品被盗（${theftRoll}）。`); }
      }
      if (rollSourceChance(dice, state, "退役安全屋随机遭遇", 2).success) runTable(story, state, def.rules.randomEncounterTable, dice);
      else ensureScene(story, state, box.scene ?? def.sceneRefs.exploration);
      return;
    }
  }
  if (box.retiredSafehouse && !box.storageTheftResolved && box.storedItems && Object.keys(box.storedItems).length) {
    const theftRoll = rollSourceChance(dice, state, "退役安全屋存放物品失窃检定", 3).face; box.storageTheftResolved = true;
    if (theftRoll <= 3) { box.storedItems = {}; appendLog(state, `第${box.sheet}张地图第${box.box}格失去安全屋后，存放物品被盗（${theftRoll}）。`); }
    else appendLog(state, `第${box.sheet}张地图第${box.box}格失去安全屋；存放物品仍在（${theftRoll}）。`);
  }
  const boxesCrossed = state.visitCount - 1;
  const hungerSkillLevel = state.skills["resistant-to-hunger"] ?? 0;
  const hungerSkillInterval = hungerSkillLevel > 0 ? def.skills["resistant-to-hunger"]?.foodEveryBoxes?.[hungerSkillLevel - 1] : undefined;
  const foodEveryBoxes = def.traumas?.[state.traumas.find(id => def.traumas?.[id]?.foodEveryBoxes !== undefined) ?? ""]?.foodEveryBoxes ?? hungerSkillInterval ?? def.rules.foodEveryBoxes;
  if (boxesCrossed > 0 && boxesCrossed % foodEveryBoxes === 0) {
    if (state.food > 0) { state.food--; appendLog(state, "跨过食物消耗线：消耗1点食物。"); }
    else { state.hp--; appendLog(state, "缺少食物：失去1点生命。"); }
  }
  if (box.safehouse && state.ongoingChecks.some(effect => effect.id === "upyr-disease")) {
    state.ongoingChecks = state.ongoingChecks.filter(effect => effect.id !== "upyr-disease");
    appendLog(state, "抵达安全屋：乌皮尔带来的疾病停止。");
  }
  if (boxesCrossed > 0) for (const effect of [...state.ongoingChecks].filter(value => value.trigger === "move")) {
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + sourceCheckSkillMod(def, state, effect.context, effect.requiredSkill);
    const success = face === 6 || (face !== 1 && total >= effect.level);
    appendLog(state, `${effect.id} L${effect.level} ${effect.context}: ${face} => ${total} (${success ? "success" : "failure"})`);
    if (success) { state.ongoingChecks = state.ongoingChecks.filter(value => value.id !== effect.id); runOperations(story, state, effect.success ?? [], dice); }
    else runOperations(story, state, effect.failure, dice);
  }
  if (box.safehouse && state.infections?.some(value => value.untilSafeHouse)) {
    state.infections = state.infections.filter(value => !value.untilSafeHouse);
    appendLog(state, "抵达安全屋：感染停止。");
  }
  if (boxesCrossed > 0 && state.infections?.length) {
    for (const infection of [...state.infections]) {
      if (infection.untilSafeHouse) {
        state.hp -= infection.failureDamage ?? 1;
        appendLog(state, `穿越区域格：感染造成${infection.failureDamage ?? 1}点生命损失。`);
      } else {
        infection.boxesRemaining--;
        if (infection.boxesRemaining <= 0) {
          state.hp -= infection.failureDamage ?? 2;
          state.infections = state.infections.filter(value => value.id !== infection.id);
          appendLog(state, `未在3格内治疗${def.enemies[infection.enemyId]?.label ?? "咬伤"}感染：额外失去${infection.failureDamage ?? 2}点生命。`);
        }
      }
    }
  }
  if (state.status !== "active") return;
  if (state.hp <= 0) state.status = "dead";
  else {
    if (revisiting && box.occupiedEncounter) {
      const encounter = box.occupiedEncounter;
      const enemyId = encounter.enemyId;
      const { face, total: explodedTotal } = rollSourceCheck(dice, state, "重返被占据区域的潜行检定");
      const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "stealth");
      const success = face === 6 || (face !== 1 && total >= (def.enemies[enemyId]?.level ?? encounter.enemyLevel));
      appendLog(state, `潜行避开${def.enemies[enemyId]?.label ?? "原遭遇"}：${face} => ${total}（${success ? "成功" : "失败"}）。`);
      const revisit = resolveOccupiedBoxRevisit({ enemyId, snapshot: encounter }, success);
      if (revisit.kind === "avoid-this-entry") {
        ensureScene(story, state, box.scene ?? def.sceneRefs.exploration);
        return;
      }
      if (revisit.kind === "resume-encounter") {
        state.combat = structuredClone(revisit.encounter.snapshot as FearCombat);
        ensureScene(story, state, def.enemies[enemyId]?.scene ?? def.sceneRefs.exploration);
        return;
      }
    }
    if (!revisiting && state.missionRules?.missionId === "5" && !box.safehouse
      && state.missionRules.witches.defeated < 5 && state.missionProgress[`witch-location:${box.id}`] !== true) {
      const finalFiveLocation = state.missionRules.visitedBoxIds.length >= 26;
      const cost = (state.skills.investigator ?? 0) >= 2 ? 1 : (state.skills.investigator ?? 0) === 1 ? 2 : 3;
      const restricted = state.missionRules.witches.restrictedClues > 0 ? 1 : 0;
      if (finalFiveLocation || state.clues + restricted >= cost) {
        const options = finalFiveLocation
          ? Array.from({ length: Math.min(state.clues, 5) + 1 }, (_, amount) => `spend:${amount}`)
          : ["continue", `spend:${Math.max(0, cost - restricted)}`];
        state.pending = { kind: "mission-witch-find", options, data: { boxId: box.id, finalFiveLocation, clueCost: cost,
          prompt: finalFiveLocation ? "此为最后五个新区域之一：自动遭遇女巫；可花费线索降低其偷袭概率。" : "可支付线索搜寻女巫，或照常探索本区域。" } };
        return;
      }
    }
    if (huntTargetEncountered) {
      const targetId = state.missionRules?.hunt.targetId ?? String(state.missionProgress.targetId ?? "");
      runOperations(story, state, [{ op: "start-combat", enemyId: targetId, count: 1 }], dice);
      appendLog(state, `任务2：在下一个进入的区域遭遇目标杀手${def.enemies[targetId]?.label ?? targetId}。`);
      return;
    }
    const returningVampires = Object.entries(state.missionProgress)
      .filter(([key, value]) => key.startsWith("vampire-return:") && value === true)
      .map(([key]) => key.slice("vampire-return:".length));
    for (const vampireId of returningVampires) {
      const { face: roll, success } = rollSourceChance(dice, state, `${def.enemies[vampireId]?.label ?? vampireId}复生检定`, 2);
      appendLog(state, `${def.enemies[vampireId]?.label ?? vampireId}复生检定：${roll}/6。`);
      if (success) {
        runOperations(story, state, [{ op: "start-combat", enemyId: vampireId, count: 1 }], dice);
        return;
      }
    }
    if (box.safehouse) {
      const healLife = box.safehouseHealLife ?? 4, healSanity = box.safehouseHealSanity ?? 2;
      state.hp = Math.min(state.maxHp, state.hp + healLife);
      state.sanity = Math.min(state.maxSanity, state.sanity + healSanity);
      if (healLife || healSanity) appendLog(state, `进入安全屋：恢复至多${healLife}点生命和${healSanity}点理智。`);
    }
    if (box.safehouse) ensureScene(story, state, box.scene ?? def.sceneRefs.exploration);
    else if (revisiting && String(state.missionProgress["mirina-box-id"] ?? "") === box.id && state.missionProgress["flag:mirina-exorcised"] !== true) {
      runOperations(story, state, [{ op: "mirina-encounter", exorcismSkillId: "exorcism" }], dice);
    } else if (revisiting) {
      const whispered = state.missionProgress["flag:whispering-move"] === true;
      delete state.missionProgress["flag:whispering-move"];
      if (!whispered && rollSourceChance(dice, state, "已访问区域随机遭遇", 1 + state.encounterCurse).success) runTable(story, state, def.rules.randomEncounterTable, dice);
      else ensureScene(story, state, box.scene ?? def.sceneRefs.exploration);
    } else if (state.foretoldTownEntry) {
      const result = state.foretoldTownEntry; delete state.foretoldTownEntry;
      resolveTableEntry(story, state, def.rules.townExplorationTable, result.roll, result.entry, dice);
    } else runTable(story, state, def.rules.townExplorationTable, dice);
  }
}

function startAbominationPursuit(state: FearState, enemyId: string) {
  if (enemyId !== "unique-zombies-6" || state.abominationPursuit?.ended) return;
  const escapesInRow = (state.abominationPursuit?.escapesInRow ?? 0) + 1;
  if (escapesInRow >= 3) {
    state.abominationPursuit = { active: false, boxesRemaining: 0, escapesInRow, ended: true };
    appendLog(state, "连续三次逃离僵尸畸怪：它不再追赶你。");
  } else {
    state.abominationPursuit = { active: true, boxesRemaining: 3, escapesInRow, ended: false };
    appendLog(state, `僵尸畸怪开始追赶：接下来穿越的${3}格中，每格掷2/6遭遇；连续逃离${escapesInRow}/3次。`);
  }
}

function checkAbominationPursuit(story: FearStory, state: FearState, dice: FearDice) {
  const pursuit = state.abominationPursuit;
  if (!pursuit?.active || pursuit.ended || pursuit.boxesRemaining <= 0 || state.status !== "active") return;
  pursuit.boxesRemaining--;
  const face = rollSourceChance(dice, state, "僵尸畸怪追踪检定", 2).face;
  const found = face <= 2;
  appendLog(state, `僵尸畸怪追踪检定：${face}/6（本格后剩余${pursuit.boxesRemaining}格；${found ? "追上" : "未出现"}）。`);
  if (found) {
    const operation: FearOperation = { op: "start-combat", enemyId: "unique-zombies-6", count: 1 };
    if (state.combat || state.pending) {
      state.deferredOperations ??= [];
      state.deferredOperations.push(operation);
      appendLog(state, "先解决当前区域遭遇，再与已恢复全部生命的僵尸畸怪交战。");
    } else runOperations(story, state, [operation], dice);
  } else if (pursuit.boxesRemaining === 0) {
    pursuit.active = false;
    appendLog(state, "三格内未遇到僵尸畸怪，本轮追踪结束。");
  }
}

function resolveMissionFiveFind(story: FearStory, state: FearState, choice: string, dice: FearDice) {
  const pending = state.pending;
  if (!pending || pending.kind !== "mission-witch-find" || !state.missionRules || state.missionRules.missionId !== "5")
    throw new Error("There is no active Coven witch discovery choice");
  const boxId = String(pending.data?.boxId ?? "");
  const finalFiveLocation = pending.data?.finalFiveLocation === true;
  const clueCost = Number(pending.data?.clueCost ?? 3);
  state.pending = undefined;
  if (choice === "continue" && !finalFiveLocation) {
    state.missionProgress[`witch-location:${boxId}`] = true;
    runTable(story, state, story.fear.rules.townExplorationTable, dice);
    return;
  }
  const match = choice.match(/^spend:(\d+)$/);
  if (!match) throw new Error("Invalid Coven witch discovery choice");
  const clueSpend = Number(match[1]);
  const requiredSkill = state.skills.investigator ?? 0;
  const restrictedClue = state.missionRules.witches.restrictedClues > 0 ? 1 : 0;
  if (clueSpend > state.clues || (!finalFiveLocation && clueSpend + restrictedClue < clueCost))
    throw new Error("Not enough Clues to locate the Coven witch");
  const surpriseFace = finalFiveLocation && clueSpend + restrictedClue < clueCost ? rollSourceCheck(dice, state, "女巫发现惊袭检定").face : undefined;
  const transition = transitionFearMission(state.missionRules, {
    type: "witch-find", boxId, availableClues: state.clues, investigator: requiredSkill > 0,
    investigatorExpert: requiredSkill >= 2, clueSpend, finalFiveLocation, surpriseFace,
    dangerSenseLevel: Math.min(2, state.skills["danger-sense"] ?? 0) as 0 | 1 | 2,
  });
  if (!transition.handled) throw new Error("Coven witch discovery was not accepted by the source mission state");
  state.missionRules = transition.state;
  state.missionProgress[`witch-location:${boxId}`] = true;
  for (const effect of transition.effects) {
    if (effect.type === "resource" && effect.key === "clues") state.clues += effect.amount;
    if (effect.type === "encounter-target") {
      state.missionProgress["witch-active-box"] = boxId;
      runOperations(story, state, [{ op: "start-combat", enemyId: "coven-witch", count: 1 }], dice);
      if (state.combat) {
        state.combat.surprise = effect.surprise;
        state.combat.playerFirst = !effect.surprise;
      }
      appendLog(state, `在${boxLabel(currentBox(state))}遭遇第${state.missionRules.witches.defeated + 1}名女巫${effect.surprise ? "（遭偷袭）" : ""}。`);
      return;
    }
  }
  // A non-final location with an unsuccessful find option continues with its
  // ordinary Town result; final-five locations always yield a witch encounter.
  runTable(story, state, story.fear.rules.townExplorationTable, dice);
}

function beginMissionFiveFinalItem(story: FearStory, state: FearState, dice: FearDice) {
  const tableId = story.fear.rules.usefulItemTable;
  const results = Array.from({ length: 3 }, () => drawTableEntry(story.fear, tableId, dice));
  state.pending = { kind: "mission-witch-final-item", options: results.map((_, index) => String(index + 1)),
    data: { tableId, results, prompt: "第五名女巫被击败：掷三次实用物品表，选择你认为最有用的一项。" } };
}

function resolveMissionWitch(story: FearStory, state: FearState, witchId: string, capturedAlive: boolean, dice: FearDice) {
  if (state.missionRules?.missionId !== "5") return;
  const resolved = transitionFearMission(state.missionRules, { type: "witch-defeated", witchId, capturedAlive });
  if (!resolved.handled) throw new Error("Mission witch identity was already resolved");
  state.missionRules = resolved.state;
  state.missionProgress.witchesResolved = state.missionRules.witches.defeated;
  for (const effect of resolved.effects) if (effect.type === "resource" && effect.key === "xp") grantFearXp(state, effect.amount);
  appendLog(state, capturedAlive
    ? `女巫被活捉：累计${state.missionRules.witches.defeated}/5；获得1条仅可用于寻找下一名女巫的线索和本次来源经验。`
    : `女巫被击败：累计${state.missionRules.witches.defeated}/5；获得本次来源经验。`);
  delete state.missionProgress["witch-active-box"];
  if (state.missionRules.witches.pendingFinalItem) beginMissionFiveFinalItem(story, state, dice);
}

function finishMissionFiveFinalItem(state: FearState, results: Array<{ roll: number; entry: FearTableEntry }>, selected: { roll: number; entry: FearTableEntry }) {
  if (!state.missionRules || state.missionRules.missionId !== "5") throw new Error("Coven mission state is missing");
  const finish = transitionFearMission(state.missionRules, {
    type: "witch-final-item", threeRollResults: results.map(result => result.entry.result), bestResult: selected.entry.result,
  });
  if (!finish.handled || !finish.state.finished) throw new Error("Final Coven reward could not finish the mission");
  state.missionRules = finish.state;
  state.missionFinished = true;
  if (!state.completedMissions.includes(state.missionId)) state.completedMissions.push(state.missionId);
  state.previousMissionId = state.missionId;
  syncMissionFinished(state);
}

function tableRoll(expression: string, dice: FearDice): number {
  dice = fearDiceScope(dice, `expression:${expression}`);
  const normalized = expression.toUpperCase().replaceAll(" ", "");
  if (normalized === "D66") return die(dice) * 10 + die(dice);
  if (normalized === "D3") return Math.ceil(die(dice) / 2);
  if (/^D3[+-]\d+$/.test(normalized)) {
    const modifier = Number(normalized.slice(2)); return Math.ceil(die(dice) / 2) + modifier;
  }
  const match = normalized.match(/^(\d*)D6(?:([+-])([0-9]+))?$/);
  if (!match) throw new Error(`Unsupported Fear table dice expression ${expression}`);
  const count = Number(match[1] || 1); if (count < 1 || count > 20) throw new Error("Fear table dice count outside supported range");
  const total = Array.from({ length: count }, () => die(dice)).reduce((sum, value) => sum + value, 0);
  return total + (match[2] === "+" ? Number(match[3]) : match[2] === "-" ? -Number(match[3]) : 0);
}
function drawTableEntry(definition: FearDefinition, tableId: string, dice: FearDice) {
  const table = definition.tables[tableId]; if (!table) throw new Error(`Unknown Fear table ${tableId}`);
  const roll = tableRoll(table.die, dice);
  const entry = table.entries.find(row => typeof row.roll === "number" ? row.roll === roll : roll >= row.roll[0] && roll <= row.roll[1]);
  if (!entry) throw new Error(`No ${tableId} outcome for roll ${roll}`);
  return { roll, entry };
}
function drawUnexhaustedTableEntry(definition: FearDefinition, state: FearState, tableId: string, dice: FearDice) {
  const table = definition.tables[tableId];
  if (!table || !table.entries.length) throw new Error(`Missing normalized Fear table ${tableId}`);
  let result = drawTableEntry(definition, tableId, dice); let retries = 0;
  const unavailable = (entry: FearTableEntry) => (table.rerollDefeated && (state.defeated.includes(entry.result)
      || state.missionProgress[`fear:seen:${tableId}:${entry.result}`] === true))
    || (entry.tags?.includes("unique-event") && state.uniqueEventsPlayed.includes(entry.result));
  while (unavailable(result.entry) && retries++ < table.entries.length * 2) result = drawTableEntry(definition, tableId, dice);
  if (unavailable(result.entry)) {
    if (!table.exhausted) throw new Error(`All outcomes in ${tableId} were exhausted; source-reviewed fallback required`);
    result = { roll: result.roll, entry: table.exhausted };
  }
  return result;
}
function checkItemMoment(story: FearStory, state: FearState, operation: FearOperation) {
  if (operation.op !== "roll-check") return undefined;
  const check = operation.context === "charisma" || operation.context === "escape" || operation.context === "stealth" ? operation.context as "charisma" | "escape" | "stealth" : undefined;
  if (!check) return undefined;
  const enemyId = operation.enemyId;
  return { kind: "check" as const, check, enemyId,
    enemyTags: enemyId ? story.fear.enemies[enemyId]?.tags ?? [] : [] };
}
function sourceEncounterForEntry(story: FearStory, entry: FearTableEntry, operations: FearOperation[]) {
  const explicitEnemy = typeof entry.values?.enemyId === "string" ? entry.values.enemyId : undefined;
  if (explicitEnemy) {
    const count = entry.values?.count;
    return { enemyId: explicitEnemy, count: typeof count === "number" || typeof count === "string" ? count : 1,
      enemies: [{ enemyId: explicitEnemy, enemyTags: story.fear.enemies[explicitEnemy]?.tags ?? [] }] };
  }
  const first = operations[0];
  if (first?.op === "start-combat") {
    return { enemyId: first.enemyId, count: first.count ?? 1,
      enemies: [{ enemyId: first.enemyId, enemyTags: story.fear.enemies[first.enemyId]?.tags ?? [] }] };
  }
  if (first?.op === "start-combat-groups" && first.groups.length) {
    return { enemyId: first.groups[0].enemyId, count: 1,
      enemies: first.groups.map(group => ({ enemyId: group.enemyId, enemyTags: story.fear.enemies[group.enemyId]?.tags ?? [] })) };
  }
  return undefined;
}
function queueFearItemEncounterChoice(story: FearStory, state: FearState, entry: FearTableEntry, operations: FearOperation[]) {
  if (state.pending || state.combat) return false;
  const encounter = sourceEncounterForEntry(story, entry, operations);
  if (!encounter) return false;
  const moment = { kind: "before-encounter" as const, enemyId: encounter.enemyId,
    enemyTags: story.fear.enemies[encounter.enemyId]?.tags ?? [], encounterEnemies: encounter.enemies };
  const itemActions = fearItemSourceActions(story.fear, state, moment);
  if (!itemActions.length) return false;
  state.pending = { kind: "fear-item-before-encounter",
    options: ["continue", ...itemActions.map(({ action }) => `item:${action.choice}`)],
    data: { moment, operations, itemActions, enemyId: encounter.enemyId } };
  appendLog(state, `已揭示遭遇：${story.fear.enemies[encounter.enemyId]?.label ?? encounter.enemyId}；可先处理遭遇前物品，或继续原规则。`);
  return true;
}
function queueFearItemStartChoice(story: FearStory, state: FearState, operations: FearOperation[]) {
  if (state.pending || state.combat) return false;
  const first = operations[0];
  let encounter: ReturnType<typeof sourceEncounterForEntry>;
  if (first?.op === "start-combat") encounter = { enemyId: first.enemyId, count: first.count ?? 1,
    enemies: [{ enemyId: first.enemyId, enemyTags: story.fear.enemies[first.enemyId]?.tags ?? [] }] };
  else if (first?.op === "start-combat-groups" && first.groups.length) encounter = { enemyId: first.groups[0].enemyId, count: 1,
    enemies: first.groups.map(group => ({ enemyId: group.enemyId, enemyTags: story.fear.enemies[group.enemyId]?.tags ?? [] })) };
  if (!encounter) return false;
  const moment = { kind: "before-encounter" as const, enemyId: encounter.enemyId,
    enemyTags: story.fear.enemies[encounter.enemyId]?.tags ?? [], encounterEnemies: encounter.enemies };
  const itemActions = fearItemSourceActions(story.fear, state, moment);
  if (!itemActions.length) return false;
  state.pending = { kind: "fear-item-before-encounter",
    options: ["continue", ...itemActions.map(({ action }) => `item:${action.choice}`)],
    data: { moment, operations, itemActions, enemyId: encounter.enemyId } };
  appendLog(state, `已揭示遭遇：${story.fear.enemies[encounter.enemyId]?.label ?? encounter.enemyId}；可先处理遭遇前物品，或继续原规则。`);
  return true;
}
function runOperations(story: FearStory, state: FearState, operations: FearOperation[], dice: FearDice) {
  for (let index = 0; index < operations.length; index++) {
    if (state.pending || state.combat) {
      state.deferredOperations ??= [];
      state.deferredOperations.push(...operations.slice(index));
      return;
    }
    const moment = checkItemMoment(story, state, operations[index]);
    const itemActions = moment ? fearItemSourceActions(story.fear, state, moment) : [];
    if (itemActions.length) {
      state.pending = { kind: "fear-item-check", options: ["continue", ...itemActions.map(({ action }) => `item:${action.choice}`)],
        data: { moment, operation: operations[index], remaining: operations.slice(index + 1), itemActions } };
      return;
    }
    const currentOperation = operations[index];
    if ((currentOperation.op === "start-combat" || currentOperation.op === "start-combat-groups")
      && state.missionProgress[`fear:item:encounter-continue:${currentOperation.op === "start-combat" ? currentOperation.enemyId : currentOperation.groups[0]?.enemyId}`] !== true
      && queueFearItemStartChoice(story, state, operations.slice(index))) return;
    const skippedEncounterBefore = state.skipEncounters;
    applyOperation(story, state, operations[index], dice);
    if (operations[index].op === "start-combat" && state.skipEncounters < skippedEncounterBefore) return;
  }
}
function sourceChoiceOptions(state: FearState, choices: Record<string, FearOperation[]>) {
  return Object.entries(choices).filter(([, operations]) => {
    // Leading guards describe whether the printed choice is available at all,
    // rather than an outcome after choosing it (e.g. dig only when carrying a shovel).
    for (const operation of operations) {
      if (operation.op === "require-item") {
        if ((state.inventory[operation.itemId] ?? 0) < (operation.count ?? 1)) return false;
      } else if (operation.op === "require-skill") {
        if ((state.skills[operation.skillId] ?? state.arcaneSkills[operation.skillId] ?? 0) < (operation.level ?? 1)) return false;
      } else if (operation.op === "require-resource") {
        if (state[operation.key] < operation.amount) return false;
      } else break;
    }
    return true;
  }).map(([choice]) => choice);
}
function carriedDiscardOptions(def: FearDefinition, state: FearState, excludedItemIds: string[], excludedTags: string[], excludedWeaponIds: string[]) {
  const options: string[] = [];
  for (const [id, count] of Object.entries(state.inventory)) {
    const tags = def.items?.[id]?.tags ?? [];
    if (count > 0 && !excludedItemIds.includes(id) && !tags.some(tag => excludedTags.includes(tag))) options.push(`item:${id}`);
  }
  for (const id of state.weaponIds) {
    const tags = def.weapons[id]?.tags ?? [];
    if (id !== "unarmed" && !isCursedWeapon(def, id) && !excludedWeaponIds.includes(id) && !tags.some(tag => excludedTags.includes(tag))) options.push(`weapon:${id}`);
  }
  return options;
}
function beginWhisperingCombat(story: FearStory, state: FearState, spec: { enemyId: string; count: number }, dice: FearDice) {
  const def = story.fear;
  const enemy = def.enemies[spec.enemyId];
  const locationOdds = enemy.surpriseByLocation?.[currentBox(state).locationType ?? ""];
  const odds = Math.max(0, (locationOdds ?? enemy.surprise ?? 0) - skillMod(def, state, "surprise-reduction"));
  const ignoreSurprise = Number(state.missionProgress["modifier:left:ignore-surprise"] ?? 0) > 0;
  const wolfForm = enemy.specialRule === "vampire-wurdalak" && rollSourceChance(dice, state, "沃达拉克变身检定", 3).success;
  if (enemy.specialRule === "vampire-wurdalak") appendLog(state, `沃达拉克变身检定：${wolfForm ? "狼形态" : "人形态"}。`);
  const surprise = !ignoreSurprise && odds > 0 && rollSourceChance(dice, state, `${enemy.label}突袭检定`, odds).success;
  const familyProfile = fearFamilyEnemyProfile(state, spec.enemyId);
  const life = familyProfile.life ?? enemyLife(state, enemy);
  state.combat = { enemyId: spec.enemyId, count: spec.count, defeatedCount: 0, enemyLevel: familyProfile.level ?? enemy.level, enemyLife: life, enemyLives: Array(spec.count).fill(life), enemyDamage: wolfForm ? 2 : enemy.damage, escapeModifier: wolfForm ? -1 : 0, wolfForm, grappled: enemy.specialRule === "vampire-midnight-man" && surprise, damageResource: enemy.damageResource ?? "hp", defenseContext: enemy.defenseContext, round: 1, playerFirst: !surprise, surprise, weaponId: state.weaponId, attackDisabled: false, specialRule: enemy.specialRule, familyRule: enemy.familyRule, familyState: {}, firstAttackSpellPending: enemy.specialRule === "witch-librarian", damageTakenThisEncounter: false };
  if (enemy.familyRule === "kalina" && def.enemies["living-dolls-6-dinosaur"]) {
    const dinosaur = def.enemies["living-dolls-6-dinosaur"];
    state.combat.groups = [
      { enemyId: spec.enemyId, enemyLives: [...state.combat.enemyLives], defeatedCount: 0 },
      { enemyId: "living-dolls-6-dinosaur", enemyLives: [enemyLife(state, dinosaur)], defeatedCount: 0 },
    ];
    state.combat.familyState = { kalinaAlive: true, dinosaurAlive: true };
  }
  if (state.missionProgress["flag:rag-doll-influence"] === true && enemy.tags?.includes("human")) state.combat!.mirinaCompelled = true;
  state.combatResult = undefined;
  if (enemy.scene) ensureScene(story, state, enemy.scene);
  runFamilyEvent(story, state, { type: "combat-start", enemyId: spec.enemyId, count: spec.count, surprised: surprise }, dice);
}
function applyOperation(story: FearStory, state: FearState, operation: FearOperation, dice: FearDice) {
  dice = fearDiceScope(dice, `operation:${JSON.stringify(operation)}`);
  const def = story.fear;
  switch (operation.op) {
    case "resource": {
      const key = operation.key; const amount = typeof operation.amount === "number" ? operation.amount : tableRoll(operation.amount, dice);
      if (key === "firstAid") { state.inventory["first-aid-charges"] = Math.max(0, (state.inventory["first-aid-charges"] ?? 0) + amount); break; }
      if (key.startsWith("ammo-")) { const weaponId = key.slice(5); state.ammo[weaponId] = Math.max(0, (state.ammo[weaponId] ?? 0) + amount); break; }
      if (key === "food") { addFood(def, state, amount); break; }
      if (key === "missionFood") {
        addMissionFood(story, state, amount);
        if (state.missionRules?.food) state.missionRules.food.cargo = state.missionFood;
        break;
      }
      if (key === "xp") { grantFearXp(state, amount); break; }
      const caps: Partial<Record<typeof key, number>> = { hp: state.maxHp, sanity: state.maxSanity, gatesClosed: def.gates.required };
      const numericState = state as unknown as Record<string, number>;
      if (key === "sanity" && amount < 0) resolveEncounterSanityLoss(def, state, -amount);
      else numericState[key] = Math.max(0, Math.min(caps[key] ?? Number.MAX_SAFE_INTEGER, numericState[key] + amount));
      if (key === "hp" && state.hp <= 0) state.status = "dead";
      if (key === "sanity" && state.sanity <= 0) state.status = "insane";
      if (key === "sanity" && amount > 0) delete state.missionProgress["flag:cursed"];
      if (key === "gatesClosed" && state.gatesClosed >= def.gates.required) state.status = "won";
      break;
    }
    case "max-resource": {
      if (operation.key === "maxHp") { state.maxHp = Math.max(0, state.maxHp + operation.amount); state.hp = Math.min(state.maxHp, state.hp); }
      else { state.maxSanity = Math.max(0, state.maxSanity + operation.amount); state.sanity = Math.min(state.sanity, state.maxSanity); }
      break;
    }
    case "permanent-loss": {
      if (operation.key === "hp") { state.maxHp = Math.max(0, state.maxHp - operation.amount); state.hp = Math.max(0, Math.min(state.maxHp, state.hp - operation.amount)); if (state.hp <= 0) state.status = "dead"; }
      else { state.maxSanity = Math.max(0, state.maxSanity - operation.amount); state.sanity = Math.max(0, Math.min(state.maxSanity, state.sanity - operation.amount)); if (state.sanity <= 0) state.status = "insane"; }
      break;
    }
    case "restore-resource": {
      const maximum = operation.key === "hp" ? state.maxHp : state.maxSanity;
      state[operation.key] = operation.amount === "all" ? maximum : Math.min(maximum, state[operation.key] + operation.amount);
      if (operation.key === "sanity" && operation.amount !== 0) delete state.missionProgress["flag:cursed"];
      break;
    }
    case "spend-all-resource":
      if (operation.key === "food") state.food = 0;
      break;
    case "ongoing-check": {
      if (!state.ongoingChecks.some(effect => effect.id === operation.id)) state.ongoingChecks.push(structuredClone(operation));
      break;
    }
    case "modifier": {
      const key = `modifier:${operation.duration}:${operation.key}`;
      state.missionProgress[key] = Number(state.missionProgress[key] ?? 0) + operation.amount;
      if (operation.duration === "next-combat") state.missionProgress[`modifier:left:${operation.key}`] = operation.encounters ?? 1;
      break;
    }
    case "require-item": {
      const count = operation.count ?? 1;
      runOperations(story, state, (state.inventory[operation.itemId] ?? 0) >= count ? operation.success : operation.failure ?? [], dice);
      break;
    }
    case "if-item-any": {
      const hasItem = operation.itemIds.some(id => (state.inventory[id] ?? 0) > 0 || state.weaponIds.includes(id));
      runOperations(story, state, hasItem ? operation.success : operation.failure ?? [], dice);
      break;
    }
    case "if-book-read":
      runOperations(story, state, state.readBooks.includes(operation.itemId) ? operation.success : operation.failure ?? [], dice);
      break;
    case "require-skill": {
      const level = Math.max(state.skills[operation.skillId] ?? 0, state.arcaneSkills[operation.skillId] ?? 0);
      runOperations(story, state, level >= (operation.level ?? 1) ? operation.success : operation.failure ?? [], dice);
      break;
    }
    case "if-resource": {
      const actual = state[operation.key];
      const matches = operation.comparison === "eq" ? actual === operation.value
        : operation.comparison === "lt" ? actual < operation.value
        : operation.comparison === "lte" ? actual <= operation.value
        : operation.comparison === "gt" ? actual > operation.value : actual >= operation.value;
      runOperations(story, state, matches ? operation.success : operation.failure ?? [], dice);
      break;
    }
    case "require-resource":
      if (state[operation.key] < operation.amount) throw new Error(`Fear requires ${operation.amount} ${operation.key}`);
      break;
    case "combat-outcome": {
      const result = state.combatResult;
      if (!result || result.enemyId !== operation.enemyId) break;
      const outcomeOperations = result.outcome === "defeated" ? operation.defeated : result.outcome === "fled" ? operation.fled ?? [] : operation.escaped ?? [];
      if (result.xpAwarded && operationsGrantXp(outcomeOperations)) { retractGenericCombatXp(state); result.xpAwarded = false; }
      runOperations(story, state, outcomeOperations, dice);
      break;
    }
    case "group-combat-outcome": {
      const result = state.combatResult;
      if (!result || result.enemyId !== operation.primaryEnemyId || !result.groupDefeated) break;
      const foodCount = result.groupDefeated[operation.foodEnemyId] ?? 0;
      if (foodCount > 0) {
        state.pending = { kind: "butcher-pigs", options: Array.from({ length: foodCount + 1 }, (_, count) => String(count)), data: { foodEnemyId: operation.foodEnemyId, foodEach: operation.foodEach, prompt: `可选择将0至${foodCount}只${def.enemies[operation.foodEnemyId]?.label ?? operation.foodEnemyId}分别制成食物；每只掷${operation.foodEach}。` } };
        appendLog(state, `可以选择将0至${foodCount}只${def.enemies[operation.foodEnemyId]?.label ?? operation.foodEnemyId}分别制成食物。`);
      }
      if (result.outcome === "defeated" && operation.allDefeated) {
        if (result.xpAwarded && operationsGrantXp(operation.allDefeated)) { retractGenericCombatXp(state); result.xpAwarded = false; }
        runOperations(story, state, operation.allDefeated, dice);
      }
      break;
    }
    case "item": {
      if (operation.itemId === "witch-knots-cord") {
        if (!state.witchKnots) {
          state.witchKnots = { total: tableRoll("D6+1", dice), used: 0 };
          appendLog(state, `女巫打结绳索有${state.witchKnots.total}个结；每个结可提供一次免费重掷。`);
          addInventoryItem(story, state, operation.itemId, 1, dice);
        }
        break;
      }
      const amount = typeof operation.amount === "number" ? operation.amount : tableRoll(operation.amount, dice);
      if (amount < 0) {
        const hadBackpack = (state.inventory.backpack ?? 0) > 0;
        state.inventory[operation.itemId] = Math.max(0, (state.inventory[operation.itemId] ?? 0) + amount);
        if (operation.itemId === "backpack" && hadBackpack && state.inventory.backpack === 0) {
          state.inventory = {};
          appendLog(state, "背包被偷走或毁坏：失去其中所有物品；手持武器保留。" );
        }
      }
      else addInventoryItem(story, state, operation.itemId, amount, dice);
      break;
    }
    case "weapon": {
      addWeapon(story, state, operation.weaponId, operation.ammo, dice);
      break;
    }
    case "mission-progress": state.missionProgress[operation.key] = operation.value; break;
    case "flag": state.missionProgress[`flag:${operation.key}`] = operation.value; break;
    case "if-flag":
      runOperations(story, state, ((state.missionProgress[`flag:${operation.key}`] ?? false) === operation.value ? operation.success : operation.failure ?? []), dice);
      break;
    case "event-end":
      if (state.missionProgress["flag:seven-sacrifices-curse"] === true) {
        appendLog(state, "七名祭品的诅咒：编号事件结束时失去1点理智。");
        resolveEncounterSanityLoss(def, state, 1);
      }
      break;
    case "whispering-presence": {
      const visited = state.mapSheets.flatMap(sheet => sheet.boxes).filter(box => box.visited && box.id !== state.currentBoxId);
      const { face: willFace, total: willTotalRaw } = rollSourceCheck(dice, state, "低语存在意志检定");
      const willTotal = willFace === 1 ? 1 : willTotalRaw + skillMod(def, state, "will-save");
      const willSuccess = willFace === 6 || (willFace !== 1 && willTotal >= 5);
      appendLog(state, `低语存在L5意志检定：${willFace} => ${willTotal}（${willSuccess ? "成功" : "失败"}）。`);
      if (willSuccess) {
        state.pending = { kind: "whispering-question", options: ["ask", "leave"], data: { prompt: "你抵御了低语；可尝试L5魅力检定询问一个问题，成功获得1条线索。" } };
      } else if (visited.length) {
        state.pending = { kind: "whispering-move", options: visited.map(box => box.id), data: { randomEncounterTable: operation.randomEncounterTable, prompt: "低语将你引向一个已探索区域；抵达后掷2/6随机遭遇。" } };
      } else {
        const neighbors = reachable(state, def).map(id => findBox(state, id));
        if (neighbors.length) {
          const index = dice(1, neighbors.length + 1);
          if (!Number.isInteger(index) || index < 1 || index > neighbors.length) throw new Error(`Fear random-neighbor source returned an invalid index: ${index}`);
          const target = neighbors[index - 1]; state.currentBoxId = target.id;
          visitBox(story, state, target, dice);
          state.deferredOperations ??= [];
          state.deferredOperations.push({ op: "probability", numerator: 2, denominator: 6, success: [{ op: "roll-table", tableId: operation.randomEncounterTable }] });
          drainDeferredTables(story, state, dice);
        }
      }
      break;
    }
    case "ghost-librarian": {
      const options = ["ask"];
      if ((state.arcaneSkills[operation.exorcismSkillId] ?? 0) > 0 && ["holy-water", "incense", "essential-oils"].some(id => (state.inventory[id] ?? 0) > 0)) options.push("exorcise");
      state.pending = { kind: "ghost-librarian", options, data: { exorcismSkillId: operation.exorcismSkillId, bookItemIds: operation.bookItemIds, asked: 0, prompt: "选择尝试驱魔，或向图书管理员询问。" } };
      break;
    }
    case "bright-apparition": {
      const { face, total } = rollSourceCheck(dice, state, "明亮显灵光线豁免");
      const lightSave = face === 6 || (face !== 1 && total >= 3);
      appendLog(state, `明亮显灵L3光线豁免：${face} => ${total}（${lightSave ? "成功" : "失败"}）。`);
      if (!lightSave) {
        state.missionProgress["modifier:left:light-blind"] = 1;
        appendLog(state, "光线豁免失败：下一场遭遇的攻击、防御和魔法检定−1；Will与其他豁免不受影响。");
      }
      const components = ["holy-water", "incense", "essential-oils"].filter(id => (state.inventory[id] ?? 0) > 0);
      const canExorcise = (state.arcaneSkills[operation.exorcismSkillId] ?? 0) > 0 && components.length > 0;
      state.pending = { kind: "bright-apparition", options: canExorcise ? ["leave", ...components.map(id => `exorcise:${id}`)] : ["leave"],
        data: { exorcismSkillId: operation.exorcismSkillId, components, prompt: "显灵将在本回合后消失；可尝试驱魔。" } };
      break;
    }
    case "mirina-encounter": {
      if (state.missionProgress["flag:mirina-exorcised"] === true) break;
      state.missionProgress["mirina-box-id"] = currentBox(state).id;
      const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "will");
      const resisted = face === 6 || (face !== 1 && total >= 6);
      appendLog(state, `Mirina L6意志豁免: ${face} => ${total} (${resisted ? "抵抗成功" : "受影响"})`);
      if (!resisted) { state.missionProgress["flag:rag-doll-influence"] = true; break; }
      const components = ["holy-water", "incense", "essential-oils"].filter(id => (state.inventory[id] ?? 0) > 0);
      const options = ["leave"];
      if (state.missionProgress["flag:rag-doll-influence"] !== true && (state.arcaneSkills[operation.exorcismSkillId] ?? 0) > 0)
        options.push(...components.map(id => `exorcise:${id}`));
      state.pending = { kind: "mirina", options, data: { exorcismSkillId: operation.exorcismSkillId, components, prompt: "Mirina不能被攻击；离开此处，或在未受影响时尝试驱魔。" } };
      break;
    }
    case "mirina-human-contact": {
      if (state.missionProgress["flag:rag-doll-influence"] === true) {
        delete state.missionProgress["flag:rag-doll-influence"];
        state.sanity = Math.max(0, state.sanity - 1);
        appendLog(state, `Mirina的影响迫使你杀死${operation.contact === "old-man" ? "老人" : "被锁住的女孩"}；失去1点理智。`);
        if (state.sanity <= 0) state.status = "insane";
      }
      break;
    }
    case "upyr-encounter": {
      const carriedFood = state.food, rotRoll = tableRoll("D6", dice);
      state.food = Math.max(0, state.food - rotRoll);
      appendLog(state, `乌皮尔使食物腐坏：掷出${rotRoll}，失去${carriedFood - state.food}点食物。`);
      if (rotRoll > carriedFood) {
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "disease-save");
        const success = face === 6 || (face !== 1 && total >= 5);
        appendLog(state, `乌皮尔疾病L5防御: ${face} => ${total} (${success ? "成功" : "失败"})`);
        if (!success && !state.ongoingChecks.some(effect => effect.id === "upyr-disease"))
          state.ongoingChecks.push({ id: "upyr-disease", trigger: "move", context: "disease-save", requiredSkill: "resilient", level: 5, failure: [] });
      }
      break;
    }
    case "vetala-encounter": {
      const options = ["fight"];
      if (state.food >= 6) options.push("offer-food");
      if (state.hp >= 2) options.push("offer-blood");
      state.pending = { kind: "vetala-offer", options, data: {
        prompt: "维塔拉可以预言未来：可提供6点食物，或支付2点生命并进行L5魅力检定；成功后获得一次预言效果并可穿过她所在区域。失败或不尝试则必须战斗。",
      } };
      break;
    }
    case "start-combat": {
      if (state.skipEncounters > 0) { state.skipEncounters--; appendLog(state, "本次怪物遭遇被已关闭地狱之门的效果忽略。"); break; }
      const enemy = def.enemies[operation.enemyId]; if (!enemy) throw new Error(`Unknown enemy ${operation.enemyId}`);
      delete state.missionProgress[`fear:item:encounter-continue:${operation.enemyId}`];
      if (state.missionProgress["fear:item:drunk:encounter-pending"] === true) {
        state.missionProgress["fear:item:drunk:encounter-active"] = true;
        delete state.missionProgress["fear:item:drunk:encounter-pending"];
      }
      state.lifeLostThisEncounter = false; state.firstAidUsedThisEncounter = false;
      const count = Math.max(1, typeof operation.count === "number" ? operation.count : tableRoll(operation.count, dice));
      if (enemy.fearSave) {
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, enemy.fearSave.context);
        const success = face === 6 || (face !== 1 && total >= enemy.fearSave.level);
        appendLog(state, `${enemy.label}恐惧豁免L${enemy.fearSave.level}: ${face} => ${total} (${success ? "成功" : "失败"})`);
        if (!success) {
          // The source Sanity rule lets the player substitute a Mental Scar for a 1-or-2 point loss;
          // the encounter reveal resumes from the pending resolution after the choice.
          if (resolveEncounterSanityLoss(def, state, enemy.fearSave.sanityLoss, { whispering: { enemyId: operation.enemyId, count } })) break;
          appendLog(state, `恐惧造成${enemy.fearSave.sanityLoss}点理智损失。`);
        }
        if (state.sanity <= 0) { state.status = "insane"; break; }
      }
      beginWhisperingCombat(story, state, { enemyId: operation.enemyId, count }, dice);
      break;
    }
    case "start-combat-groups": {
      if (state.skipEncounters > 0) { state.skipEncounters--; appendLog(state, "本次怪物遭遇被已关闭地狱之门的效果忽略。"); break; }
      if (state.missionProgress["fear:item:drunk:encounter-pending"] === true) {
        state.missionProgress["fear:item:drunk:encounter-active"] = true;
        delete state.missionProgress["fear:item:drunk:encounter-pending"];
      }
      state.lifeLostThisEncounter = false; state.firstAidUsedThisEncounter = false;
      if (!operation.groups.length) throw new Error("A group encounter needs at least one enemy group");
      const groups = operation.groups.map(group => {
        const enemy = def.enemies[group.enemyId]; if (!enemy) throw new Error(`Unknown enemy ${group.enemyId}`);
        const count = Math.max(1, typeof group.count === "number" ? group.count : tableRoll(group.count, dice));
        return { enemyId: group.enemyId, enemyLives: Array(count).fill(enemyLife(state, enemy)), defeatedCount: 0 };
      });
      const primary = def.enemies[groups[0].enemyId];
      state.combat = { enemyId: groups[0].enemyId, count: groups[0].enemyLives.length, defeatedCount: 0, enemyLevel: primary.level,
        enemyLife: groups[0].enemyLives[0], enemyLives: groups[0].enemyLives, groups, escapeAfter: operation.escapeAfter,
        enemyDamage: primary.damage, damageResource: primary.damageResource ?? "hp", defenseContext: primary.defenseContext,
        round: 1, playerFirst: true, surprise: false, weaponId: state.weaponId, attackDisabled: false,
        specialRule: primary.specialRule, familyRule: primary.familyRule, familyState: {} };
      if (state.missionProgress["flag:rag-doll-influence"] === true && primary.tags?.includes("human")) state.combat.mirinaCompelled = true;
      state.combatResult = undefined;
      if (groups.length === 1) runFamilyEvent(story, state, { type: "combat-start", enemyId: groups[0].enemyId, count: groups[0].enemyLives.length, surprised: false }, dice);
      break;
    }
    case "roll-check": {
      const roll = rollSourceCheck(dice, state, operation.context);
      const face = roll.face; const total = face === 1 ? 1 : roll.total + sourceCheckSkillMod(def, state, operation.context, operation.requiredSkill) + (operation.enemyId ? creatureSkillMod(def, state, operation.enemyId, operation.context) : 0) + (operation.bonus ?? 0);
      const success = (face === 6 || (face !== 1 && total >= operation.level))
        && (operation.successAfter === undefined || total > operation.successAfter)
        && (operation.successBefore === undefined || total < operation.successBefore);
      appendLog(state, `${operation.context} L${operation.level}: ${face} => ${total} (${success ? "success" : "failure"})`);
      runOperations(story, state, success ? operation.success ?? [] : operation.failure ?? [], dice);
      break;
    }
    case "roll-check-count": {
      const count = typeof operation.count === "number" ? operation.count : tableRoll(operation.count, dice);
      if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error("Fear repeated-check count outside supported range");
      for (let index = 0; index < count && state.status === "active"; index++) {
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + sourceCheckSkillMod(def, state, operation.context, operation.requiredSkill) + (operation.enemyId ? creatureSkillMod(def, state, operation.enemyId, operation.context) : 0);
        const success = face === 6 || (face !== 1 && total >= operation.level);
        appendLog(state, `${operation.context} L${operation.level} ${index + 1}/${count}: ${face} => ${total} (${success ? "success" : "failure"})`);
        if (!success) runOperations(story, state, operation.failure, dice);
        if (state.hp <= 0) state.status = "dead";
        else if (state.sanity <= 0) state.status = "insane";
      }
      break;
    }
    case "repeat-check": state.pending = { kind: "repeat-check", options: ["attempt"], data: operation }; break;
    case "probability": {
      if (operation.denominator !== 6) throw new Error("Fear probability operations currently require source-authored x/6 odds");
      const success = rollSourceChance(dice, state, `${operation.numerator}/${operation.denominator} chance`, operation.numerator).success;
      appendLog(state, `${operation.numerator}/${operation.denominator}: ${success ? "yes" : "no"}`);
      runOperations(story, state, success ? operation.success : operation.failure ?? [], dice);
      break;
    }
    case "search-loot-choice": state.pending = { kind: "search-success", options: ["clue", ...operation.tableIds] }; break;
    case "event-branch":
      runOperations(story, state, state.pendingEvent?.eventId === operation.eventId ? state.pendingEvent.alreadyPlayed ? operation.ifPlayed : operation.ifNew
      : state.resolvedEvents.includes(operation.eventId) ? operation.ifPlayed : operation.ifNew, dice);
      break;
    case "optional-safehouse": state.pending = { kind: "optional-safehouse", options: ["create", "leave"], data: operation }; break;
    case "rest-choice": state.pending = { kind: "rest-choice", options: ["life", "sanity"], data: operation }; break;
    case "choose-reward": state.pending = { kind: "choose-reward", options: operation.options }; break;
    case "choose-item": state.pending = { kind: "item-choice", options: operation.options }; break;
    case "discard-choice": {
      const options = carriedDiscardOptions(def, state, operation.excludedItemIds, operation.excludedTags, operation.excludedWeaponIds);
      if (options.length) state.pending = { kind: "discard-source-item", options, data: operation };
      break;
    }
    case "choose-effect": state.pending = { kind: "source-choice", options: sourceChoiceOptions(state, operation.choices), data: { prompt: operation.prompt, choices: operation.choices } }; break;
    case "hell-gate": {
      const options = ["ignore"];
      if ((state.arcaneSkills[operation.skillId] ?? 0) > 0) options.unshift("close");
      state.pending = { kind: "hell-gate", options, data: operation };
      break;
    }
    case "search-bonus-choice": state.missionProgress.searchBonus = operation.modifier; state.pending = { kind: "search-success", options: ["clue", "useful-item", "random-item"] }; break;
    case "clinic-search-choice": state.pending = { kind: "clinic-search-choice", options: ["explore", "leave"], data: operation }; break;
    case "farm-food-or-search": state.pending = { kind: "farm-choice", options: operation.choices, data: operation }; break;
    case "farmer-choice": state.pending = { kind: "farmer-choice", options: [...operation.foodOptions, ...operation.lootTables], data: operation }; break;
    case "conditional-skill-purchase": state.pending = { kind: "research-choice", options: ["study-now", "carry-notes", "leave"], data: operation }; break;
    case "injury-check": {
      const used = operation.kind === "life" ? state.scars.length : state.traumas.length;
      const cap = operation.kind === "life" ? def.rules.maxScars : def.rules.maxTraumas;
      if (used >= cap) {
        if (operation.kind === "life") state.hp -= operation.amount; else state.sanity -= operation.amount;
        break;
      }
      state.pending = { kind: "injury-prevention", options: ["take-loss", "prevent-with-scar"], data: { injuryKind: operation.kind, amount: operation.amount, tableId: operation.tableId } };
      break;
    }
    case "mark-gate": state.missionProgress.gateHere = true; syncMissionRandomGate(state); break;
    case "mark-safehouse":
      addSafehouse(state, def, currentBox(state).id, dice, operation.threshold, operation.visitHealLife ?? 4, operation.visitHealSanity ?? 2);
      state.hp = Math.min(state.maxHp, state.hp + (operation.restoreLife ?? 0));
      state.sanity = Math.min(state.maxSanity, state.sanity + (operation.restoreSanity ?? 0));
      break;
    case "unique-event": if (!state.uniqueEventsPlayed.includes(operation.eventId)) state.uniqueEventsPlayed.push(operation.eventId); break;
    case "route": ensureScene(story, state, operation.scene); break;
    case "roll-table": runTable(story, state, operation.tableId, dice); break;
    case "choose-table": state.pending = { kind: "table-choice", options: operation.tableIds }; break;
    case "climb-for-loot": state.pending = { kind: "climb-reward-table", options: operation.tableIds, data: { level: operation.level, skillId: operation.skillId } }; break;
    case "sewer-shelter": {
      const options: string[] = [];
      if (state.food >= 2) options.push("donate-food");
      for (const [id, count] of Object.entries(state.inventory)) if (count > 0) options.push(`donate-item:${id}`);
      for (const id of new Set(state.weaponIds)) if (id !== "unarmed") options.push(`donate-weapon:${id}`);
      if (!options.length) throw new Error("Sewer shelter requires 2 Food or one carried item");
      state.pending = { kind: "sewer-donation", options, data: { enemyId: operation.enemyId } };
      break;
    }
  }
}
function resolveTableEntry(story: FearStory, state: FearState, tableId: string, roll: number, entry: FearTableEntry, dice: FearDice, skipMissionAdjustment = false) {
  dice = fearDiceScope(dice, `entry:${tableId}:${entry.result}`);
  const def = story.fear;
  // Mission 4 allows exactly one adjacent Town-table adjustment when it opens
  // a Military Installation or Store destination. Preserve the rolled result
  // until the player chooses; do not spend another Town roll.
  if (!skipMissionAdjustment && tableId === def.rules.townExplorationTable
    && state.missionRules?.missionId === "4" && !state.pending) {
    const destination = (candidate: FearTableEntry | undefined) => candidate?.result === "choose-military-or-clinic" || candidate?.result === "choose-store-or-street";
    const eligible = [-1, 1].filter(delta => {
      const adjusted = roll + delta;
      return def.tables[tableId].entries.some(candidate => {
        const [min, max] = typeof candidate.roll === "number" ? [candidate.roll, candidate.roll] : candidate.roll;
        return adjusted >= min && adjusted <= max && destination(candidate);
      });
    });
    const raw = def.tables[tableId].entries.find(candidate => {
      const [min, max] = typeof candidate.roll === "number" ? [candidate.roll, candidate.roll] : candidate.roll;
      return roll >= min && roll <= max;
    });
    if (eligible.length && !destination(raw)) {
      state.pending = { kind: "mission-town-adjustment", options: eligible.map(String), data: { tableId, roll } };
      appendLog(state, `任务4：本次城镇探索掷骰为${roll}；可按规则调整±1以抵达军事设施或商店。`);
      return entry;
    }
  }
  let attempts = 0;
  let duplicateBookSuppressed = false;
  const table = def.tables[tableId];
  if (!table) throw new Error(`Missing normalized Fear table ${tableId}`);
  let resolved = entry;
  const mustReroll = (candidate: FearTableEntry) =>
    (candidate.tags?.includes("unique-event") && state.uniqueEventsPlayed.includes(candidate.result))
    || (table.rerollDefeated && state.missionProgress[`fear:seen:${tableId}:${candidate.result}`] === true)
    || (tableId === "unique-vampires" && state.destroyedVampires?.includes(candidate.result))
    || (tableId === "unique-vampires" && candidate.result === "unique-vampires-6" && state.vampiresEncounteredOnce?.includes(candidate.result))
    || (candidate.rerollLocations?.includes(currentBox(state).locationType ?? ""));
  while (mustReroll(resolved) && attempts++ < table.entries.length * 2) {
    ({ roll, entry: resolved } = drawTableEntry(def, tableId, dice));
  }
  if (resolved.rerollLocations?.includes(currentBox(state).locationType ?? "") && attempts >= table.entries.length * 2)
    throw new Error(`No available result for ${tableId} at the current location`);
  if (resolved.tags?.includes("unique-event") && state.uniqueEventsPlayed.includes(resolved.result)) {
    if (!table.exhausted) throw new Error(`All outcomes in ${tableId} were exhausted; source-reviewed fallback required`);
    resolved = table.exhausted;
  }
  if (tableId === "random-books") {
    const bookId = resolved.operations?.find((op): op is Extract<FearOperation, { op: "item" }> => op.op === "item" && !!def.items?.[op.itemId]?.tags?.includes("book"))?.itemId;
    if (bookId) {
      state.booksFound ??= [];
      const found = new Set([...state.booksFound, ...Object.entries(state.inventory).filter(([id, count]) => count > 0 && def.items?.[id]?.tags?.includes("book")).map(([id]) => id)]);
      if (found.has(bookId)) {
        duplicateBookSuppressed = true;
        const ordered = table.entries.map(candidate => ({ roll: typeof candidate.roll === "number" ? candidate.roll : candidate.roll[0], itemId: candidate.operations?.find((op): op is Extract<FearOperation, { op: "item" }> => op.op === "item" && !!def.items?.[op.itemId]?.tags?.includes("book"))?.itemId })).filter((v): v is { roll: number; itemId: string } => !!v.itemId).sort((a, b) => a.roll - b.roll);
        const index = ordered.findIndex(value => value.itemId === bookId);
        const adjacent = [-1, 1].flatMap(direction => {
          for (let next = index + direction; next >= 0 && next < ordered.length; next += direction) if (!found.has(ordered[next].itemId)) return [ordered[next].itemId];
          return [];
        });
        if (adjacent.length) state.pending = { kind: "random-book-duplicate", options: adjacent, data: { rolledBookId: bookId, roll, acquisitionSource: state.missionProgress["fear:book-source-pending"] ?? "random-book" } };
        else appendLog(state, "本局随机书籍表中的书均已找到；本次重复结果没有可选择的新书。");
      } else state.booksFound.push(bookId);
    }
  }
  const eventAlreadyPlayed = state.uniqueEventsPlayed.includes(resolved.result);
  if (tableId === "unique-vampires" && resolved.result === "unique-vampires-6") {
    state.vampiresEncounteredOnce ??= [];
    if (!state.vampiresEncounteredOnce.includes(resolved.result)) state.vampiresEncounteredOnce.push(resolved.result);
  }
  appendLog(state, `${TABLE_LABELS[tableId] ?? resultLabel(def, tableId)} ${roll}: ${resultLabel(def, resolved.result)}`);
  if (table.rerollDefeated) state.missionProgress[`fear:seen:${tableId}:${resolved.result}`] = true;
  if (resolved.tags?.includes("unique-event") && !state.uniqueEventsPlayed.includes(resolved.result)) state.uniqueEventsPlayed.push(resolved.result);
  if (def.injuries?.[resolved.result]) {
    if (!state.scars.includes(resolved.result)) state.scars.push(resolved.result);
  }
  if (def.traumas?.[resolved.result] && !state.traumas.includes(resolved.result)) {
    state.traumas.push(resolved.result);
    const loss = def.traumas[resolved.result].maxSanityChange ?? 0;
    if (loss) { state.maxSanity = Math.max(0, state.maxSanity + loss); state.sanity = Math.min(state.sanity, state.maxSanity); }
  }
  const rulePlan = resolveFearTableRule(story, state, tableId, resolved, dice);
  const operations = rulePlan.effects.length ? rulePlan.operations : (resolved.operations ?? []);
  const refusesFoodOrHealing = state.traumas.includes("paranoia") && resolved.result.startsWith("helpful-");
  const acceptedOperations = refusesFoodOrHealing ? operations.filter(operation =>
    !((operation.op === "resource" && (operation.key === "food" || operation.key === "hp"))
      || (operation.op === "restore-resource" && operation.key === "hp")
      || (operation.op === "max-resource" && operation.key === "maxHp" && operation.amount > 0))) : operations;
  const trainStewardTerminal = rulePlan.effects.some(effect => effect.type === "source-terminal" && effect.outcome === "train-ghost");
  if (tableId === "random-objects" && (resolved.result === "random-book" || resolved.result === "computer-printout")) {
    const before = structuredClone(state.inventory);
    const result = resolveFearRandomObjectBook(resolved.result,
      () => drawTableEntry(def, "random-books", dice),
      (draw, source) => {
        state.missionProgress["fear:book-source-pending"] = source;
        resolveTableEntry(story, state, "random-books", draw.roll, draw.entry, dice);
        delete state.missionProgress["fear:book-source-pending"];
        for (const [itemId, count] of Object.entries(state.inventory)) {
          if (def.items?.[itemId]?.tags?.includes("book") && count > (before[itemId] ?? 0)) {
            state.bookSources ??= {};
            state.bookSources[itemId] = source;
            break;
          }
        }
        if (state.pending?.kind === "random-book-duplicate") state.pending.data = { ...state.pending.data, acquisitionSource: source };
      });
    if (result.handled) {
      if (result.status === "reroll-required") state.pending = { kind: "random-book-reroll", options: ["continue"], data: {
        source: result.source, rejectedRoll: result.rejectedRoll,
        prompt: `电脑打印稿的随机书籍表掷出${result.rejectedRoll}；按来源规则重掷2D6。`,
      } };
      ensureScene(story, state, resolved.scene, eventAlreadyPlayed);
      return resolved;
    }
  }
  if (tableId === "worship") recordFearWorshipVisit(state, `${currentBox(state).id}:${state.visitCount}`);
  const tableHandled = beginFearTableRule(story, state, tableId, resolved, rulePlan.effects, dice);
  const sanityBeforeEntry = state.sanity;
  if (duplicateBookSuppressed) { /* The printed duplicate substitution replaces the rolled item result. */ }
  else if (tableHandled) { /* The table-specific handler owns this source result. */ }
  else {
    if (refusesFoodOrHealing && acceptedOperations.length !== operations.length) appendLog(state, "偏执：拒绝接受好心人的食物或治疗。");
    const entryOperations = acceptedOperations.length ? acceptedOperations : typeof resolved.values?.enemyId === "string" ? (() => {
      // Source-normalized creature rows store their profile and count in values.
      // Those rows mean an encounter even when the reviewed recipe has no
      // additional bespoke effects; without this fallback they only logged a
      // label and silently skipped the printed fight.
      const count = resolved.values.count;
      return [{ op: "start-combat" as const, enemyId: resolved.values.enemyId, count: typeof count === "number" || typeof count === "string" ? count : 1 }];
    })() : [];
    if (entryOperations.length && !queueFearItemEncounterChoice(story, state, resolved, entryOperations))
      runOperations(story, state, entryOperations, dice);
  }
  const bookstore = rulePlan.effects.find(effect => effect.type === "after-bookstore-search-encounter");
  if (tableId === "store" && resolved.result === "bookstore" && bookstore) {
    const marker = "fear-table:store:bookstore-encounter";
    state.missionProgress[marker] = bookstore.tableId;
    finishFearBookstoreEncounter(story, state, dice);
  }
  finishFearArtSchoolFollowup(state);
  // Source p97: the Train Steward is not itself lethal; only losing the final
  // Sanity point during this result turns the investigator into a ghost.
  if (trainStewardTerminal && (state.inventory["train-ticket"] ?? 0) === 0 && sanityBeforeEntry > 0 && state.sanity === 0)
    state.status = "dead";
  if (tableId === "school" && resolved.result === "school-library" && !state.combat && !state.pending)
    delete state.missionProgress["fear-table:school-library:pending-search"];
  ensureScene(story, state, resolved.scene, eventAlreadyPlayed);
  return resolved;
}

/** Executes the source-specific table effects that need a real player choice or state transition. */
function beginFearTableRule(story: FearStory, state: FearState, tableId: string, entry: FearTableEntry, effects: ReturnType<typeof resolveFearTableRule>["effects"], dice: FearDice): boolean {
  const def = story.fear;
  const effect = (type: string) => effects.find(value => value.type === type) as any;
  if (tableId === "rewards") return beginFearRewardsTable(story, state, entry, dice);
  const hardwareSearch = effect("hardware-store-search");
  if (tableId === "store" && hardwareSearch) {
    const found: Array<{ itemId: string; ammo?: string }> = [];
    for (const item of hardwareSearch.items as Array<{ itemId: string; chance: [number, 6]; ammo?: string }>) {
      const chance = rollSourceChance(dice, state, `五金店寻找${resultLabel(def, item.itemId)}`, item.chance[0], item.chance[1]);
      appendLog(state, `五金店${resultLabel(def, item.itemId)}检定${item.chance[0]}/6：${chance.face}/6（${chance.success ? "找到" : "未找到"}）。`);
      if (chance.success) found.push({ itemId: item.itemId, ...(item.ammo ? { ammo: item.ammo } : {}) });
    }
    const encounter = rollSourceChance(dice, state, "五金店随机遭遇检定", hardwareSearch.encounterChance[0], hardwareSearch.encounterChance[1]);
    appendLog(state, `五金店搜寻后随机遭遇检定${hardwareSearch.encounterChance[0]}/6：${encounter.face}/6。`);
    if (!found.length) {
      appendLog(state, "五金店没有找到可拿取的物品；没有触发拾取时的遭遇。");
      return true;
    }
    state.missionProgress[FEAR_HARDWARE_PICKUP_KEY] = JSON.stringify({
      items: found, encounterPending: encounter.success, awaiting: false,
    });
    presentFearHardwareStorePickup(state);
    return true;
  }
  const clownMask = effect("clown-mask-wear");
  if (tableId === "children-stuff" && clownMask) {
    state.missionProgress["fear-table:children-stuff:clown-mask-choice"] = true;
    addInventoryItem(story, state, clownMask.itemId, 1);
    return true;
  }
  const clown = effect("clownface-encounter");
  if (tableId === "railways" && clown) {
    // The profile's per-hit 2/6 rule is consumed by the generic combat hit
    // resolver; keep the source profile and the table declaration aligned.
    const profile = def.enemies[entry.result];
    if (!profile?.hitIgnoreChance || profile.hitIgnoreChance[0] !== clown.hitIgnoreChance[0]
      || profile.hitIgnoreChance[1] !== clown.hitIgnoreChance[1])
      throw new Error("Demonic Clown source profile is missing its per-hit 2-in-6 ignore rule");
    if (state.missionProgress["flag:clownface-worn"] === true)
      state.pending = { kind: "fear-clown-escape", options: ["escape", "charisma"], data: { enemyId: entry.result } };
    else resolveFearClownEscape(story, state, "escape", dice);
    return true;
  }
  const clinicHorde = effect("clinic-zombie-horde");
  if (tableId === "clinic" && clinicHorde) {
    state.pending = { kind: "fear-table-horde", options: ["fight", "ignore"], data: { tableId, enemyId: clinicHorde.enemyId, count: clinicHorde.count } };
    return true;
  }
  const worshipHorde = effect("worship-zombie-siege");
  if (tableId === "worship" && worshipHorde) {
    state.pending = { kind: "fear-table-horde", options: ["fight", "ignore"], data: { tableId, enemyId: worshipHorde.enemyId, count: worshipHorde.count } };
    return true;
  }
  const farmHorde = effect("farm-zombie-siege");
  if (tableId === "farm" && farmHorde) {
    state.pending = { kind: "fear-table-horde", options: ["fight"], data: { tableId, enemyId: farmHorde.enemyId, count: farmHorde.count } };
    return true;
  }
  if (tableId === "possessed" && entry.result === "possessed-1") {
    const count = Math.max(1, typeof entry.values?.count === "number" ? entry.values.count
      : typeof entry.values?.count === "string" ? tableRoll(entry.values.count, dice) : 1);
    const magicItems = ["ghost-blade", "hell-chain", "book-of-hypnos", "holy-bullets", "blessed-candle", "amulet"]
      .filter(id => (state.inventory[id] ?? 0) > 0 || id === "ghost-blade" && state.weaponIds.includes(id));
    const offerable = [
      ...Object.entries(state.inventory).filter(([id, amount]) => amount > 0 && def.items?.[id]?.tags?.includes("book")).map(([id]) => `book:${id}`),
      ...(["candle", "candles"].filter(id => (state.inventory[id] ?? 0) > 0).map(id => `candle:${id}`)),
      ...(state.food >= count ? ["food"] : []),
      ...magicItems.map(id => `magic:${id}`),
    ];
    state.pending = { kind: "fear-cultists-negotiation", options: ["fight", ...(offerable.length ? ["negotiate"] : [])], data: { count, offerable } };
    return true;
  }
  if (tableId === "demonic-horrors" && entry.result === "demonic-horrors-2") {
    runOperations(story, state, [{ op: "roll-check", context: "will-save", requiredSkill: "will", level: 5,
      success: [{ op: "start-combat", enemyId: "demonic-horrors-2", count: 1 }],
      failure: [{ op: "permanent-loss", key: "hp", amount: 1 }] }], dice);
    return true;
  }
  if (effect("counted-entry-fallback")) {
    const rule = effect("counted-entry-fallback");
    const plays = Number(state.missionProgress[rule.key] ?? 0);
    if (plays >= rule.maximumPlays) {
      runTable(story, state, rule.fallbackTable, dice);
      appendLog(state, `${entry.result}已遭遇${plays}次；按来源改掷野兽表。`);
      return true;
    }
    state.missionProgress[rule.key] = plays + 1;
  }
  if (tableId === "sewers" && entry.result === "giant-rat-thing") {
    const available = ["torch", "lighter", "molotov-cocktail"].filter(id => (state.inventory[id] ?? 0) > 0);
    const options = ["fight", ...(available.map(id => `fire:${id}`)), ...((state.inventory["rat-poison"] ?? 0) > 0 && state.food >= 1 ? ["poison"] : [])];
    state.pending = { kind: "fear-sewer-rat", options, data: { enemyId: "giant-rat-thing", prompt: "巨鼠怪畏火；也可用鼠药与1点食物先造成2点伤害。" } };
    return true;
  }
  if (tableId === "woods-park" && entry.result === "hangmans-tree") {
    const count = tableRoll("D6", dice);
    state.pending = { kind: "fear-hangman-corpse", options: ["roll"], data: { remaining: count, prompt: `发现${count}具尸体；逐具进行恐惧检定及1/6搜刮检定。` } };
    resolveFearHangmanCorpse(story, state, dice);
    return true;
  }
  if (tableId === "school" && entry.result === "library") {
    const books = tableRoll("D3", dice);
    const candidates = Array.from({ length: books }, () => {
      const drawn = drawTableEntry(story.fear, "random-books", dice);
      return { roll: drawn.roll, result: drawn.entry.result };
    });
    const encounter = rollSourceChance(dice, state, "学校图书管理员遭遇检定", 3).face;
    appendLog(state, `学校图书馆随机书籍数D3：${books}；女巫图书管理员遭遇检定3/6：${encounter}/6。`);
    if (encounter > 3) {
      queueFearSchoolBooks(state, candidates);
      return true;
    }
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "女巫图书管理员魅力检定");
    const modifier = skillMod(story.fear, state, "charisma"), total = face === 1 ? 1 : explodedTotal + modifier;
    const success = face === 6 || (face !== 1 && total >= 4);
    appendLog(state, `女巫图书管理员L4魅力检定：${face} + ${modifier} = ${total}（${success ? "成功" : "失败"}）。`);
    if (!success) {
      state.missionProgress["fear-table:school:library-books-on-defeat"] = JSON.stringify(candidates);
      runOperations(story, state, [{ op: "start-combat", enemyId: "witch-librarian", count: 1 }], dice);
    } else state.pending = schoolLibrarianTradePending(state, candidates);
    return true;
  }
  if (tableId === "school" && entry.result === "art-school")
    state.missionProgress["fear-table:school:art-school-followup"] = currentBox(state).id;
  const armory = effect("per-eligible-weapon-search");
  if (tableId === "store" && armory)
    state.missionProgress["fear-table:store:armory-search"] = JSON.stringify({ weaponIds: armory.weaponIds, ammoWeaponIds: armory.ammoWeaponIds, index: 0 });
  if (tableId === "school" && entry.result === "school-library") state.missionProgress["fear-table:school-library:pending-search"] = currentBox(state).id;
  if (tableId === "haunted-house" && entry.result === "occult-library") {
    const candidates: { roll: number; result: string }[] = [];
    let attempts = 0;
    while (candidates.length < 2) {
      if (attempts++ >= story.fear.tables["random-books"].entries.length * 3)
        throw new Error("Could not roll two distinct books from the remaining Random Books table results");
      const drawn = drawTableEntry(story.fear, "random-books", dice);
      if (state.booksFound?.includes(drawn.entry.result) || candidates.some(book => book.result === drawn.entry.result)) continue;
      candidates.push({ roll: drawn.roll, result: drawn.entry.result });
    }
    state.pending = { kind: "fear-occult-library", options: ["book:0", "book:1", "both"], data: { candidates, enemyTable: "demonic-horrors", prompt: "从两本已掷出的随机书中选择一本或两本；随后离开时遭遇恶魔恐怖。" } };
    return true;
  }
  if (tableId === "haunted-house" && entry.result === "rosen-house") {
    const marker = "fear-table:rosen-house:box-id";
    if (state.missionProgress[marker] === currentBox(state).id) {
      appendLog(state, "Rosen House已在本区域找到；依来源重掷闹鬼房屋表。");
      runTable(story, state, "haunted-house", dice);
      return true;
    }
    state.missionProgress[marker] = currentBox(state).id;
  }
  if (tableId === "haunted-house" && entry.result === "haunted-puppet-theatre")
    state.missionProgress["flag:puppet-theatre"] = true;
  return false;
}

function hardwarePickupData(state: FearState): { items: Array<{ itemId: string; ammo?: string }>; encounterPending: boolean; awaiting: boolean; discarded?: boolean } | undefined {
  const raw = state.missionProgress[FEAR_HARDWARE_PICKUP_KEY];
  if (typeof raw !== "string") return undefined;
  return JSON.parse(raw) as { items: Array<{ itemId: string; ammo?: string }>; encounterPending: boolean; awaiting: boolean; discarded?: boolean };
}
function saveHardwarePickupData(state: FearState, data: ReturnType<typeof hardwarePickupData>) {
  if (!data) delete state.missionProgress[FEAR_HARDWARE_PICKUP_KEY];
  else state.missionProgress[FEAR_HARDWARE_PICKUP_KEY] = JSON.stringify(data);
}
function presentFearHardwareStorePickup(state: FearState) {
  if (state.pending || state.combat || state.pendingEvent) return;
  const data = hardwarePickupData(state);
  if (!data || data.awaiting) return;
  if (!data.items.length) { saveHardwarePickupData(state, undefined); return; }
  state.pending = { kind: "fear-hardware-store-pickup",
    options: [...data.items.keys()].map(index => `take:${index}`).concat("leave"),
    data: { items: data.items.map(item => ({ ...item })), prompt: "五金店中找到数件物品。每次拿取物品时，可能触发一次来源所述遭遇。" } };
}
function finishFearHardwareStorePickup(story: FearStory, state: FearState, dice: FearDice) {
  if (state.pending || state.combat || state.pendingEvent) return;
  const data = hardwarePickupData(state);
  if (!data) return;
  if (data.awaiting) {
    data.awaiting = false;
    const triggerEncounter = !data.discarded && data.encounterPending;
    data.discarded = false;
    if (triggerEncounter) data.encounterPending = false;
    saveHardwarePickupData(state, data);
    if (triggerEncounter) {
      appendLog(state, "拿取五金店物品時触发已掷出的随机遭遇。");
      runTable(story, state, "store-hardware-encounter", dice);
      if (state.pending || state.combat || state.pendingEvent) return;
    }
  }
  presentFearHardwareStorePickup(state);
}
function resolveFearClownEscape(story: FearStory, state: FearState, method: "escape" | "charisma", dice: FearDice) {
  const def = story.fear;
  const label = method === "escape" ? "恶魔小丑L4逃跑检定" : "CLOWNFACE恶魔小丑L4魅力检定";
  const { face, total: explodedTotal } = rollSourceCheck(dice, state, label);
  let modifier = skillMod(def, state, method === "escape" ? "escape" : "charisma");
  if (method === "charisma") {
    // This one source check ignores only the mask and facial-scar penalties.
    if (state.missionProgress["flag:clownface-worn"] === true) modifier++;
    if (state.scars.includes("facial-scar")) modifier++;
  }
  const total = face === 1 ? 1 : explodedTotal + modifier;
  const success = face === 6 || (face !== 1 && total >= 4);
  appendLog(state, `${label}：${face} + ${modifier} = ${total}（${success ? "成功" : "失败"}）。`);
  if (success) return;
  state.hp = Math.max(0, state.hp - 1);
  appendLog(state, "逃跑失败：失去1点生命，必须与恶魔小丑战斗。");
  if (state.hp <= 0) { state.status = "dead"; return; }
  runOperations(story, state, [{ op: "start-combat", enemyId: "demonic-clown", count: 1 }], dice);
  if (state.combat) state.missionProgress[FEAR_CLOWN_DEFEAT_KEY] = true;
}
function startFearTableHorde(story: FearStory, state: FearState, tableId: string, enemyId: string, count: number | string, dice: FearDice) {
  state.missionProgress[FEAR_SOURCE_HORDE_KEY] = tableId;
  state.combatResult = undefined;
  runOperations(story, state, [{ op: "start-combat", enemyId, count }], dice);
  if (!state.combat) delete state.missionProgress[FEAR_SOURCE_HORDE_KEY];
}
function finishFearTableCombatReward(story: FearStory, state: FearState, dice: FearDice) {
  if (state.combat || state.pending) return;
  const tableId = state.missionProgress[FEAR_SOURCE_HORDE_KEY];
  if (typeof tableId !== "string" || !state.combatResult) return;
  const result = state.combatResult;
  if (result.enemyId !== "zombie") return;
  delete state.missionProgress[FEAR_SOURCE_HORDE_KEY];
  if (result.outcome !== "defeated") return;
  if (tableId === "clinic") {
    state.pending = { kind: "fear-table-horde-reward", options: ["claim", "leave"], data: {
      tableId, prompt: "击败诊所僵尸：可掷一次随机物品表，并取得D6剂止痛药。",
    } };
  } else if (tableId === "worship") {
    state.pending = { kind: "fear-table-horde-reward", options: ["sanity", "random-objects", "useful-stuff"], data: {
      tableId, prompt: "击败礼拜场所的全部僵尸：选择恢复1点理智，或掷随机物品表／实用物品表。",
    } };
  } else if (tableId === "farm") {
    state.pending = { kind: "fear-table-horde-reward", options: ["D6-food", "D6-shotgun-shells"], data: {
      tableId, prompt: "击败农场僵尸：选择取得D6点食物或D6发霰弹。",
    } };
  }
}
function finishFearTableRewardContinuation(story: FearStory, state: FearState, dice: FearDice) {
  if (state.pending) return;
  if (state.missionProgress["fear-table:clinic:pending-painkiller-table"] === true) {
    delete state.missionProgress["fear-table:clinic:pending-painkiller-table"];
    runTable(story, state, "painkillers", dice);
  }
}
function finishFearClownCombat(story: FearStory, state: FearState) {
  if (state.combat || state.pending || state.missionProgress[FEAR_CLOWN_DEFEAT_KEY] !== true || !state.combatResult) return;
  const outcome = state.combatResult;
  if (outcome.enemyId !== "demonic-clown") return;
  delete state.missionProgress[FEAR_CLOWN_DEFEAT_KEY];
  if (outcome.outcome === "defeated") state.pending = { kind: "fear-clown-defeated", options: ["leave", "unmask"], data: { eventId: "13" } };
  void story;
}
function finishFearClownMaskChoice(state: FearState) {
  if (state.pending || state.missionProgress["fear-table:children-stuff:clown-mask-choice"] !== true) return;
  delete state.missionProgress["fear-table:children-stuff:clown-mask-choice"];
  if ((state.inventory["walrus-clown-mask"] ?? 0) > 0)
    state.pending = { kind: "fear-clown-mask", options: ["wear", "keep"], data: { itemId: "walrus-clown-mask" } };
}

function beginFearRewardsTable(story: FearStory, state: FearState, entry: FearTableEntry, dice: FearDice) {
  const def = story.fear;
  const returnKey = "fear:rewards:return-node";
  if (typeof state.missionProgress[returnKey] !== "string") state.missionProgress[returnKey] = state.nodeId;
  ensureScene(story, state, def.sceneRefs.tables.rewards);
  switch (entry.result) {
    case "reward-1":
      state.hp = Math.min(state.maxHp, state.hp + 1); state.sanity = Math.min(state.maxSanity, state.sanity + 1); grantFearXp(state, 1);
      appendLog(state, "奖励表1：恢复1点生命和1点理智，获得1点经验。");
      break;
    case "reward-2":
    case "reward-3":
    case "reward-4":
    case "reward-5":
    case "reward-6": {
      if (entry.result === "reward-4") addFood(def, state, 2);
      const fullForRewardFive = state.food >= carriedFoodLimit(def, state) && state.hp >= state.maxHp && state.sanity >= state.maxSanity;
      if (entry.result === "reward-5" && !fullForRewardFive) {
        addFood(def, state, tableRoll("D6", dice)); state.hp = Math.min(state.maxHp, state.hp + 1); state.sanity = Math.min(state.maxSanity, state.sanity + 1);
        appendLog(state, "奖励表5：获得D6点食物，恢复1点理智和1点生命。");
        break;
      }
      const options = entry.result === "reward-2" ? ["life", "xp"]
        : entry.result === "reward-3" ? ["life-sanity", "xp"]
          : entry.result === "reward-4" ? ["sanity", "xp", "items-random-random", "items-random-useful", "items-useful-useful"]
            : entry.result === "reward-5" ? ["standard", "xp"] : ["restore", "xp"];
      state.pending = { kind: "fear-rewards-choice", options, data: { row: Number(entry.result.slice(-1)) } };
      if (entry.result === "reward-4") appendLog(state, "奖励表4：获得2点食物；选择恢复1点理智、获得2点经验，或从随机物品表和/或有用物品表各选择抽取两件物品。");
      else appendLog(state, `奖励表${entry.result.slice(-1)}：请选择来源允许的奖励。`);
      break;
    }
    default: throw new Error(`Unknown reviewed Rewards-table entry: ${entry.result}`);
  }
  return true;
}

function schoolLibrarianTradePending(state: FearState, candidates: { roll: number; result: string }[]) {
  const options = ["leave"];
  const subsets = (length: number): number[][] => {
    const values: number[][] = [];
    for (let mask = 1; mask < 1 << length; mask++) values.push(Array.from({ length }, (_, index) => index).filter(index => mask & (1 << index)));
    return values;
  };
  for (const indices of subsets(candidates.length)) {
    const suffix = indices.join(",");
    if (state.food >= indices.length * 2) options.push(`food:${suffix}`);
    for (const [itemId, count] of Object.entries(state.inventory))
      if (count >= indices.length) options.push(`item:${itemId}:${suffix}`);
  }
  return { kind: "fear-librarian-trade", options, data: { candidates, prompt: `魅力检定成功：从${candidates.length}本候选书中选择交易；每本支付2点食物或1件物品，也可离开。` } };
}

function queueFearSchoolBooks(state: FearState, candidates: { roll: number; result: string }[]) {
  if (candidates.length) state.missionProgress["fear-table:pending-book-queue"] = JSON.stringify(candidates);
}

function finishFearSchoolBookQueue(story: FearStory, state: FearState, dice: FearDice) {
  const key = "fear-table:pending-book-queue";
  if (state.pending || state.combat || typeof state.missionProgress[key] !== "string") return;
  const queue = JSON.parse(String(state.missionProgress[key])) as { roll: number; result: string }[];
  while (queue.length && !state.pending && !state.combat) {
    const book = queue.shift()!;
    state.missionProgress[key] = JSON.stringify(queue);
    const entry = story.fear.tables["random-books"].entries.find(candidate => candidate.result === book.result);
    if (!entry) throw new Error(`Missing random book ${book.result}`);
    resolveTableEntry(story, state, "random-books", book.roll, entry, dice);
  }
  if (!queue.length) {
    delete state.missionProgress[key];
    const encounter = state.missionProgress["fear-table:haunted-library:enemy-after-books"];
    if (typeof encounter === "string" && !state.pending && !state.combat) {
      delete state.missionProgress["fear-table:haunted-library:enemy-after-books"];
      runTable(story, state, encounter, dice);
    }
  }
}

function resolveFearSchoolLibrarianCombatOutcome(state: FearState) {
  const candidateKey = "fear-table:school:library-books-on-defeat";
  const queueKey = "fear-table:pending-book-queue";
  const result = state.combatResult;
  if (!result || result.enemyId !== "witch-librarian" || typeof state.missionProgress[candidateKey] !== "string") return;
  const candidates = String(state.missionProgress[candidateKey]);
  delete state.missionProgress[candidateKey];
  if (result.outcome === "defeated") {
    state.missionProgress[queueKey] = candidates;
    appendLog(state, "女巫图书管理员被击败：取得此地预先发现的D3本书。");
  } else appendLog(state, "你未击败女巫图书管理员；没有取得候选书籍。");
}

function finishFearArtSchoolFollowup(state: FearState) {
  const marker = "fear-table:school:art-school-followup";
  if (state.pending || state.combat || typeof state.missionProgress[marker] !== "string") return;
  const boxId = String(state.missionProgress[marker]);
  delete state.missionProgress[marker];
  if (state.missionProgress["flag:school-art-sketchbook-found"] === true) {
    delete state.missionProgress["flag:school-art-sketchbook-found"];
    appendLog(state, "画室素描本已被发现；不触发缺失素描本的搜索线索。可选择领取并前往事件35，或忽略。");
    return;
  }
  state.missionProgress["fear-table:school:art-school-clue-search-box"] = boxId;
  const box = currentBox(state);
  box.searchesAllowed = Math.max(box.searchesAllowed ?? 1, (box.searchesMade ?? 0)) + 1;
  appendLog(state, "未发现素描本：本区域可额外执行一次搜索；成功获得1条线索。");
}

function finishFearArmorySearch(story: FearStory, state: FearState, dice: FearDice) {
  const marker = "fear-table:store:armory-search";
  if (state.pending || state.combat || typeof state.missionProgress[marker] !== "string") return;
  const data = JSON.parse(String(state.missionProgress[marker])) as { weaponIds: string[]; ammoWeaponIds: string[]; index: number };
  while (data.index < data.weaponIds.length) {
    const id = data.weaponIds[data.index++];
    state.missionProgress[marker] = JSON.stringify(data);
      if (rollSourceChance(dice, state, `军械库寻找${story.fear.weapons[id]?.label ?? id}`, 1).success) {
      const ammo = data.ammoWeaponIds.includes(id) ? "2D6" : undefined;
      addWeapon(story, state, id, ammo, dice);
      appendLog(state, `军械库逐项搜索：找到${story.fear.weapons[id]?.label ?? id}${ammo ? "及弹药" : ""}。`);
      if (state.pending) return;
    }
  }
  delete state.missionProgress[marker];
}

function finishFearBookstoreEncounter(story: FearStory, state: FearState, dice: FearDice) {
  const marker = "fear-table:store:bookstore-encounter";
  if (state.pending || state.combat || typeof state.missionProgress[marker] !== "string") return;
  const tableId = String(state.missionProgress[marker]);
  delete state.missionProgress[marker];
  const face = rollSourceChance(dice, state, "书店搜书后遭遇检定", 3).face;
  appendLog(state, `书店搜书后遭遇检定3/6：${face}/6。`);
  if (face <= 3) runTable(story, state, tableId, dice);
}

function finishFearHangmanContinuation(story: FearStory, state: FearState, dice: FearDice) {
  const marker = "fear-table:woods-park:hangman-remaining";
  if (state.pending || state.combat || typeof state.missionProgress[marker] !== "number") return;
  const remaining = Number(state.missionProgress[marker]); delete state.missionProgress[marker];
  state.pending = { kind: "fear-hangman-corpse", options: ["roll"], data: { remaining } };
  resolveFearHangmanCorpse(story, state, dice);
}

function resolveFearHangmanCorpse(story: FearStory, state: FearState, dice: FearDice) {
  const pending = state.pending;
  if (!pending || pending.kind !== "fear-hangman-corpse") return;
  const remaining = Number(pending.data?.remaining ?? 0);
  if (remaining <= 0) { state.pending = undefined; return; }
  const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(story.fear, state, "will");
  const success = face === 6 || (face !== 1 && total >= 4);
  if (!success) state.sanity--;
  appendLog(state, `吊尸恐惧检定L4 Will: ${face} => ${total} (${success ? "成功" : "失败"})。`);
  if (state.sanity <= 0) state.status = "insane";
  if (rollSourceChance(dice, state, "吊尸随身物品发现检定", 1).success) state.pending = { kind: "fear-hangman-loot", options: ["random-objects", "useful-stuff"], data: { remaining: remaining - 1 } };
  else { state.pending = { ...pending, data: { remaining: remaining - 1 } }; resolveFearHangmanCorpse(story, state, dice); }
}

function runTable(story: FearStory, state: FearState, tableId: string, dice: FearDice) {
  dice = fearDiceScope(dice, `table:${tableId}`);
  const def = story.fear; const table = def.tables[tableId];
  if (!table || !table.entries.length) throw new Error(`Missing normalized Fear table ${tableId}`);
  if (["street", "cemetery", "house", "clinic", "worship", "military", "farm", "store", "sewers", "railways", "woods-park", "school", "haunted-house"].includes(tableId)) currentBox(state).locationType = tableId;
  const { roll, entry } = drawUnexhaustedTableEntry(def, state, tableId, dice);
  const resolved = resolveTableEntry(story, state, tableId, roll, entry, dice);
  const mission = state.missionRules;
  if (mission?.missionId === "1" && ["house", "military", "clinic"].includes(tableId)) {
    const trigger = tableId === "clinic" ? "clinic-visit" : "house-or-lab-roll";
    const face = rollSourceChance(dice, state, "医疗物资搜寻检定", tableId === "clinic" ? 3 : 1).face;
    const found = transitionFearMission(mission, { type: "medical-find-check", trigger, face });
    state.missionRules = found.state;
    for (const effect of found.effects) if (effect.type === "discover-item") addMissionMedicine(story, state, effect.amount, dice);
    appendLog(state, `医疗物资搜寻D6=${face}${found.effects.some(effect => effect.type === "discover-item") ? "：找到药品剂量" : "：未找到"}。`);
  }
  if (mission?.missionId === "3" && ["street", "store", "farm"].includes(tableId)) {
    const face = rollSourceChance(dice, state, "任务食物搜寻检定", 3).face;
    const foodDie = face <= 3 ? tableRoll("D6", dice) : undefined;
    const deferPickup = foodDie !== undefined && face <= 3 && (state.pending !== undefined || state.combat !== undefined);
    const accepted = foodDie !== undefined && face <= 3 && !deferPickup ? addMissionFood(story, state, foodDie) : undefined;
    const found = transitionFearMission(mission, { type: "food-location-visit", location: tableId as "street" | "store" | "farm", face: accepted === 0 && foodDie !== undefined || deferPickup ? 4 : face, foodDie: accepted });
    state.missionRules = found.state;
    if (foodDie !== undefined && face <= 3) {
      if (deferPickup) { state.deferredOperations ??= []; state.deferredOperations.push({ op: "resource", key: "missionFood", amount: foodDie }); }
      appendLog(state, `任务食物搜寻：D6=${face}，额外找到D6=${foodDie}点任务食物${deferPickup ? "；待当前遭遇解决后收取" : `；受携带空间限制，现收取${accepted ?? 0}点`}（与角色食物分开）。`);
    } else appendLog(state, `任务食物搜寻D6=${face}：未找到额外任务食物。`);
  }
  return resolved;
}
function beginSearchLoot(story: FearStory, state: FearState, tableId: string, dice: FearDice) {
  const table = story.fear.tables[tableId];
  if (!table) throw new Error(`Missing normalized loot table ${tableId}`);
  const outcomes = Array.from({ length: 4 }, () => drawTableEntry(story.fear, tableId, dice));
  state.pending = { kind: "loot-result-choice", options: outcomes.map((_, i) => String(i + 1)), data: { tableId, outcomes } };
}
function missionObjectiveComplete(def: FearDefinition, state: FearState) {
  const mission = def.missions[state.missionId]; const p = state.missionProgress;
  if (!mission) return false;
  const qualifiedGuns = qualifiedFirearmCount(state);
  return mission.kind === "medical-supplies" ? Math.max(Number(p.medicalSupplies ?? 0), state.inventory["medicine-dose"] ?? 0) >= 3
    : mission.kind === "hunt-target" ? p.targetDefeated === true
    : mission.kind === "bring-food" ? state.missionFood >= Number(p.foodTarget ?? state.missionFoodTarget ?? mission.target ?? Number.MAX_SAFE_INTEGER)
    : mission.kind === "bring-weapons" ? qualifiedGuns >= 1
    : mission.kind === "witches" ? Number(p.witchesResolved ?? 0) >= 5
    : mission.kind === "hell-gates" ? state.gatesClosed > Number(p.gateCountAtStart ?? state.gatesClosed)
    : p.completed === true;
}
function canEndMission(def: FearDefinition, state: FearState) {
  const mission = def.missions[state.missionId]; if (!mission || state.missionFinished || !missionObjectiveComplete(def, state)) return false;
  const atReturn = state.currentBoxId === state.startingBoxId || (mission.kind === "hunt-target" && currentBox(state).safehouse);
  return atReturn;
}
function initializeMissionRules(def: FearDefinition, state: FearState, dice: FearDice) {
  if (!/^[1-6]$/.test(state.missionId)) { delete state.missionRules; return; }
  const missionId = state.missionId as "1" | "2" | "3" | "4" | "5" | "6";
  const targetId = String(state.missionProgress.targetId ?? def.missions[missionId]?.target ?? "");
  const huntTarget = missionId === "2" && targetId && def.enemies[targetId]
    ? { id: targetId, level: def.enemies[targetId].level } : undefined;
  const fallback = missionId === "6" ? die(dice) : undefined;
  state.missionRules = createFearMissionState({
    missionId,
    previousMissionId: /^[1-6]$/.test(state.previousMissionId ?? "") ? state.previousMissionId as "1" | "2" | "3" | "4" | "5" | "6" : undefined,
    startingBoxId: state.startingBoxId,
    initialVisitBoxIds: [state.startingBoxId],
    gatesClosed: state.gatesClosed,
    foodTarget: missionId === "3" ? state.missionFoodTarget : undefined,
    huntTarget,
    gateFallbackRoll: fallback,
  });
  state.missionRules.completedMissionIds = state.completedMissions.filter((id): id is "1" | "2" | "3" | "4" | "5" | "6" => /^[1-6]$/.test(id));
}
function syncMissionBoxEntered(state: FearState, box: FearMapBox) {
  if (!state.missionRules) return;
  state.missionRules = transitionFearMission(state.missionRules, {
    type: "box-entered", boxId: box.id, visitOrdinal: Math.max(1, state.visitCount),
  }).state;
  if (state.missionRules.missionId === "6") {
    const gateCheck = transitionFearMission(state.missionRules, { type: "hell-gate-box-check", visitedBoxCount: state.missionRules.visitedBoxIds.length });
    state.missionRules = gateCheck.state;
    if (gateCheck.effects.some(effect => effect.type === "discover-hell-gate")) {
      state.missionProgress.gateHere = true;
      appendLog(state, "任务6：地图达到来源规定的随机门阈值，发现一处地狱之门。");
    }
  }
}
function addMissionMedicine(story: FearStory, state: FearState, amount: number, dice: FearDice) {
  const operation: FearOperation = { op: "item", itemId: "medicine-dose", amount };
  if (state.pending || state.combat) { state.deferredOperations ??= []; state.deferredOperations.push(operation); }
  else runOperations(story, state, [operation], dice);
}
function checkMissionMedicalFallback(story: FearStory, state: FearState, box: FearMapBox, dice: FearDice) {
  const mission = state.missionRules;
  if (mission?.missionId !== "1" || mission.visitedBoxIds.length !== 30) return;
  const fallback = transitionFearMission(mission, { type: "medical-all-boxes-visited", lastBoxId: box.id, totalBoxes: 30 });
  state.missionRules = fallback.state;
  for (const effect of fallback.effects) if (effect.type === "discover-item") addMissionMedicine(story, state, effect.amount, dice);
}
function syncMissionRandomGate(state: FearState) {
  if (!state.missionRules) return;
  const transition = transitionFearMission(state.missionRules, { type: "random-gate-found" });
  state.missionRules = transition.state;
}
function syncMissionGateClosed(state: FearState) {
  if (!state.missionRules) return;
  const wasFinished = state.missionRules.finished;
  const transition = transitionFearMission(state.missionRules, { type: "hell-gate-closed" });
  state.missionRules = transition.state;
  if (state.missionRules.campaign.gatesClosed !== state.gatesClosed) state.missionRules.campaign.gatesClosed = state.gatesClosed;
  if (!wasFinished && state.missionRules.finished) {
    state.missionFinished = true;
    if (!state.completedMissions.includes(state.missionId)) state.completedMissions.push(state.missionId);
    state.previousMissionId = state.missionId;
  }
  if (state.missionRules.campaign.won || state.gatesClosed >= 7) state.status = "won";
}
function syncMissionFinished(state: FearState) {
  const mission = state.missionRules;
  if (!mission || !state.missionFinished) return;
  mission.finished = true;
  if (!mission.completedMissionIds.includes(mission.missionId)) mission.completedMissionIds.push(mission.missionId);
  mission.previousMissionId = mission.missionId;
}
function boxLabel(box: FearMapBox) { return `第${box.sheet}张地图·第${box.box}格（第${box.row}行第${box.column}列）`; }
const TABLE_LABELS: Record<string, string> = {
  "town-exploration": "城镇探索表", "random-encounter": "随机遭遇表", street: "街道表", cemetery: "墓地表", house: "房屋表", clinic: "诊所表", worship: "礼拜场所表", military: "军事设施表", farm: "农场表", store: "商店表", sewers: "下水道表", railways: "铁路表", "woods-park": "树林／公园表", school: "学校表", "random-events": "随机事件表", "random-event-kid": "孩子跟随事件的D6分支", "special-events": "特殊事件表", slashers: "杀手表", "lab-horrors": "实验室恐怖表", "witch-children": "女巫之子表", "living-dolls": "活人偶表", aliens: "外星人表", beasts: "野兽表", undead: "不死生物表", possessed: "附身者表", "demonic-horrors": "恶魔恐怖表", "random-weapons": "随机武器表", "random-weapon": "随机武器表", "random-objects": "随机物品表", "useful-stuff": "实用物品表", "random-item": "随机物品表", injury: "伤残表", injuries: "伤残表", insanity: "精神失常表", ghosts: "鬼魂表", fluid: "液体表", "random-magic-item": "随机魔法物品表", "children-stuff": "儿童物品表", "random-books": "随机书籍表", "random-item-in-hut": "小屋随机物品表", "random-item-in-the-hut": "小屋随机物品表", "haunted-house": "闹鬼房屋表", missions: "任务表", rewards: "奖励表", "house-repeat": "房屋表", "house-or-special": "房屋或特殊地点表", "church-initial": "礼拜场所初次进入表", grabbed: "被抓事件表", painkillers: "止痛药表", "railway-random-encounter": "铁路随机遭遇表", "school-random-encounter": "学校随机遭遇表", "store-armory-encounter": "商店军械遭遇表", "store-book-encounter": "商店书籍遭遇表", "store-food-encounter": "商店食品遭遇表", "store-hardware-encounter": "商店五金遭遇表", search: "搜索结果表", "unique-vampires": "独特吸血鬼表", "unique-zombies": "独特僵尸表",
  "food-to-salt": "选择将食物点数转换为等量盐剂", "worship-symbol-visit": "选择是否拿取宗教标志", "random-book-reroll": "继续掷随机书籍表2D6",
};
const CHOICE_LABELS: Record<string, string> = {
  "baseball-bat-or-hammer": "棒球棒或锤子", "chainsaw-or-katana": "电锯或武士刀", "grenade-or-bow": "手榴弹或弓", fight: "与僵尸战斗",
  clue: "获得1条线索", "useful-item": "从有用物品表掷取", "random-item": "从随机物品表掷取", "random-event": "触发随机事件",
  "study-now": "立即研究资料", "carry-notes": "带走研究笔记", leave: "离开", climb: "尝试攀爬", attempt: "继续尝试挣脱", ignore: "暂不处理", close: "尝试关闭", accept: "允许孩子同行", refuse: "拒绝孩子同行", "pick-up": "拾取物品并继续事件#31", investigate: "进入建筑并调查（事件#34）", collect: "收集黄色黏液",
  create: "建立安全屋", search: "搜索", explore: "探索病房", food: "取得食物", xp: "获得经验", "useful-items": "掷有用物品表",
  "life-only": "恢复生命", "sanity-only": "恢复理智", life: "恢复生命", sanity: "恢复理智", "take-loss": "承受损失",
  "prevent-with-scar": "以永久伤残避免损失", "take-damage": "承受双1后果", "skip-attack": "跳过下一次攻击", "destroy-weapon": "弃置当前武器",
  "choose-military-or-clinic": "军事设施或诊所", "choose-farm-or-cemetery": "农场或墓地", "choose-store-or-street": "商店或街道",
  "choose-rail-or-woods": "铁路或树林／公园", "choose-school-or-woods": "学校或树林／公园", "house-or-special": "房屋或特殊地点",
};
function resultLabel(def: FearDefinition, result: string) {
  return def.items?.[result]?.label ?? def.weapons[result]?.label ?? def.enemies[result]?.label ?? TABLE_LABELS[result] ?? CHOICE_LABELS[result] ?? result.replaceAll("-", " ");
}
function projectPendingLabels(def: FearDefinition, state: FearState) {
  const pending = state.pending!; const labels: Record<string, string> = {};
  if (pending.kind === "fear-cultists-negotiation") {
    labels.fight = "拒绝交涉，与邪教徒战斗";
    labels.negotiate = "尝试L5魅力交涉；成功后须献上一项祭品";
  }
  if (pending.kind === "fear-cultists-offer") for (const option of pending.options) {
    if (option === "food") labels[option] = `献上${pending.data?.count ?? 1}点食物`;
    else {
      const [kind, id] = option.split(":");
      const itemLabel = resultLabel(def, id ?? option);
      labels[option] = `献上${kind === "book" ? "书籍" : kind === "candle" ? "蜡烛" : "魔法物品"}：${itemLabel}`;
    }
  }
  if (pending.kind === "fear-hardware-store-pickup") {
    const items = pending.data?.items as Array<{ itemId: string }> | undefined;
    for (const option of pending.options) {
      if (option === "leave") labels[option] = "不拿取物品";
      else if (option.startsWith("take:")) {
        const item = items?.[Number(option.slice(5))];
        labels[option] = item ? `拿取${resultLabel(def, item.itemId)}` : "拿取物品";
      }
    }
  }
  if (pending.kind === "fear-clown-mask") {
    labels.wear = "戴上面具（获得CLOWNFACE关键词；魅力检定-1）";
    labels.keep = "不戴面具，收好备用";
  }
  if (pending.kind === "fear-clown-escape") {
    labels.escape = "进行L4逃跑检定（滑溜技能适用）";
    labels.charisma = "使用CLOWNFACE进行L4魅力检定（忽略面具和面部疤痕减值）";
  }
  if (pending.kind === "fear-clown-defeated") {
    labels.leave = "离开该区域";
    labels.unmask = "揭下面具并进入事件13";
  }
  if (pending.kind === "fear-table-horde") {
    labels.fight = "与僵尸战斗";
    labels.ignore = "忽略这次遭遇";
  }
  if (pending.kind === "fear-table-horde-reward") {
    labels.claim = "领取来源奖励";
    labels.leave = "放弃奖励";
    labels.sanity = "恢复1点理智";
    labels["random-objects"] = "掷随机物品表";
    labels["useful-stuff"] = "掷实用物品表";
    labels["D6-food"] = "取得D6点食物";
    labels["D6-shotgun-shells"] = "取得D6发霰弹";
  }
  // A source-choice option is an internal typed token (often an inventory ID),
  // never player-facing copy. Resolve it through the audited Chinese data.
  if (pending.kind === "vampire-body") {
    labels["leave-body"] = "不处理尸体（吸血鬼可能复生）";
    labels["stake-body"] = "用1根木桩和锤子钉住尸体（阻止复生）";
    labels["burn-body"] = "用燃烧瓶烧毁尸体（网页适配：替代原书未提供的燃料罐）";
  }
  if (pending.kind === "vetala-offer") {
    labels.fight = "拒绝交易，与维塔拉战斗";
    labels["offer-food"] = "支付6点食物，进行L5魅力检定";
    labels["offer-blood"] = "支付2点生命，进行L5魅力检定";
  }
  if (pending.kind === "injury-repeat-roll") labels.reroll = "继续按来源重掷伤残表（直到出现未有的结果）";
  if (pending.kind === "source-choice") for (const option of pending.options) {
    labels[option] = resultLabel(def, option);
  }
  if (pending.kind === "absent-mindedness-storage") for (const option of pending.options) {
    try { labels[option] = boxLabel(findBox(state, option)); } catch { /* keep invalid private data unlabelled */ }
  }
  if (pending.kind === "random-book-duplicate") for (const option of pending.options) labels[option] = resultLabel(def, option);
  if (pending.kind === "food-to-salt") for (const option of pending.options) labels[option] = `将${option}点食物换成${option}剂盐`;
  if (pending.kind === "worship-symbol-visit") { labels.take = "拿取一个重量可忽略的宗教标志"; labels.leave = "不拿取"; }
  if (pending.kind === "random-book-reroll") labels.continue = "继续掷下一次随机书籍表2D6";
  if (pending.kind === "farm-search-loot") for (const option of pending.options) {
    labels[option] = ({
      pitchfork: "干草叉",
      axe: "斧头",
      salt: "盐（D6份）",
      "holy-book": "圣书",
      "shotgun-shells": "霰弹（D3发）",
      clue: "1点线索",
    } as Record<string, string>)[option] ?? resultLabel(def, option);
  }
  if (pending.kind === "starting-area") for (const option of pending.options) { try { labels[option] = boxLabel(findBox(state, option)); } catch { /* invalid private state remains unlabelled */ } }
  if (pending.kind === "mission-town-adjustment") {
    labels["-1"] = "城镇探索结果−1（抵达军事设施或商店）";
    labels["1"] = "城镇探索结果+1（抵达军事设施或商店）";
  }
  if (pending.kind === "mission-witch-find") for (const option of pending.options) {
    if (option === "continue") labels[option] = "不搜寻女巫，照常探索本区域";
    else if (option.startsWith("spend:")) labels[option] = `花费${option.slice(6)}条线索`;
  }
  if (pending.kind === "mission-witch-final-item") {
    const results = pending.data?.results as Array<{ entry: FearTableEntry }> | undefined;
    for (const option of pending.options) {
      const selected = results?.[Number(option) - 1]?.entry;
      if (selected) labels[option] = resultLabel(def, selected.result);
    }
  }
  if (pending.kind === "table-choice") for (const option of pending.options) labels[option] = TABLE_LABELS[option] ?? resultLabel(def, option);
  if (pending.kind === "loot-result-choice") {
    const outcomes = pending.data?.outcomes as Array<{ entry: FearTableEntry }> | undefined;
    pending.options.forEach((option, index) => { const entry = outcomes?.[index]?.entry; labels[option] = entry ? resultLabel(def, entry.result) : `第${index + 1}项`; });
  }
  if (pending.kind === "horde-loss") for (const option of pending.options) {
    if (option === "food") labels[option] = "失去2点食物";
    else if (option.startsWith("item:")) labels[option] = `失去${def.items?.[option.slice(5)]?.label ?? option.slice(5)}`;
    else if (option.startsWith("weapon:")) labels[option] = `失去${def.weapons[option.slice(7)]?.label ?? option.slice(7)}`;
  }
  if (pending.kind === "butcher-pigs") {
    const foodEnemyId = String(pending.data?.foodEnemyId ?? "pig");
    const label = def.enemies[foodEnemyId]?.label ?? foodEnemyId;
    for (const option of pending.options) labels[option] = option === "0" ? "不屠宰" : `屠宰${option}只${label}`;
  }
  if (pending.kind === "whispering-move") for (const option of pending.options) {
    try { labels[option] = boxLabel(findBox(state, option)); } catch { labels[option] = "相邻区域"; }
  }
  if (pending.kind === "whispering-question") {
    labels.ask = "尝试L5魅力检定提问"; labels.leave = "不提问，继续行动";
  }
  if (pending.kind === "fear-rewards-choice") {
    const row = Number(pending.data?.row);
    if (row === 2) { labels.life = "恢复2点生命"; labels.xp = "获得2点经验"; }
    else if (row === 3) { labels["life-sanity"] = "恢复2点生命和1点理智"; labels.xp = "获得1点经验"; }
    else if (row === 4) {
      labels.sanity = "恢复1点理智"; labels.xp = "获得2点经验";
      labels["items-random-random"] = "抽取2件随机物品";
      labels["items-random-useful"] = "分别从随机物品表和有用物品表抽取1件";
      labels["items-useful-useful"] = "抽取2件有用物品";
    } else if (row === 5) { labels.standard = "照常获得D6食物并恢复1点生命和理智"; labels.xp = "改为获得2点经验"; }
    else if (row === 6) { labels.restore = "生命与理智恢复至初始值"; labels.xp = "获得1点经验"; }
  }
  if (pending.kind === "ghost-librarian") {
    labels.ask = "向鬼魂提问"; labels.exorcise = "尝试驱魔";
  }
  if (pending.kind === "bright-apparition") for (const option of pending.options) labels[option] = option.startsWith("exorcise:") ? `持有${resultLabel(def, option.slice(9))}；尝试驱魔（组件不消耗）` : "让显灵消失";
  if (pending.kind === "mirina") for (const option of pending.options) labels[option] = option.startsWith("exorcise:") ? `持有${resultLabel(def, option.slice(9))}；尝试驱魔Mirina（组件不消耗）` : "离开并让Mirina留在此处";
  if (pending.kind === "librarian-component") for (const option of pending.options) labels[option] = `持有${resultLabel(def, option.slice(5))}；尝试驱魔（组件不消耗）`;
  if (pending.kind === "librarian-book") for (const option of pending.options) labels[option] = `交出${resultLabel(def, option)}`;
  if (pending.kind === "pied-piper-loss") for (const option of pending.options) {
    if (option === "life") labels[option] = "失去1点生命";
    else { const [kind, id] = option.split(":", 2); labels[option] = kind === "weapon" ? `失去武器：${resultLabel(def, id)}` : `失去物品：${resultLabel(def, id)}`; }
  }
  if (pending.kind === "tickling-theft") for (const option of pending.options) {
    const [kind, id] = option.split(":", 2); labels[option] = kind === "weapon" ? `失去武器：${resultLabel(def, id)}` : `失去物品：${resultLabel(def, id)}`;
  }
  if (pending.kind === "creation-skills") for (const option of pending.options) labels[option] = option.split("|").map(id => def.skills[id]?.label ?? id).join(" + ");
  if (pending.kind === "creation-stats") for (const option of pending.options) {
    const allocation = option.match(/^life:(\d),sanity:(\d)$/);
    labels[option] = allocation ? `生命+${allocation[1]}，理智+${allocation[2]}` : ({
      "extra:skill": "用全部3点额外选择一项技能",
      "extra:random-weapon": "用全部3点额外掷一次随机武器表",
      "extra:random-object": "用全部3点额外掷一次随机物品表",
      "extra:useful-stuff": "用全部3点额外掷一次实用物品表",
    } as Record<string, string>)[option] ?? option;
  }
  if (pending.kind === "creation-bonus-skill") for (const option of pending.options) labels[option] = def.skills[option]?.label ?? option;
  if (pending.kind === "sewer-donation") for (const option of pending.options) {
    if (option === "donate-food") labels[option] = "交出2点食物";
    else if (option.startsWith("donate-item:")) labels[option] = `交出物品：${resultLabel(def, option.slice(12))}`;
    else if (option.startsWith("donate-weapon:")) labels[option] = `交出武器：${resultLabel(def, option.slice(14))}`;
  }
  if (pending.kind === "discard-source-item") for (const option of pending.options) {
    const [kind, id] = option.split(":", 2);
    labels[option] = kind === "weapon" ? `丢弃武器：${resultLabel(def, id)}` : `丢弃：${resultLabel(def, id)}`;
  }
  if (pending.kind === "carry-capacity") for (const option of pending.options) {
    if (option === "discard-new") labels[option] = "放弃新找到的物品";
    else if (option === "discard-new-mission-food") labels[option] = "放弃剩余任务食物";
    else if (option.startsWith("discard-item:")) labels[option] = `丢弃：${resultLabel(def, option.slice(13))}`;
    else if (option.startsWith("discard-weapon:")) labels[option] = `丢弃武器：${resultLabel(def, option.slice(15))}`;
  }
  if (pending.kind === "foretell-result") {
    labels["use-result"] = "接受预言结果，进入该区域";
    labels["discard-result"] = "改变主意，放弃该结果";
  }
  return labels;
}
function publicPending(def: FearDefinition, state: FearState): FearProjected["pending"] {
  if (!state.pending) return undefined;
  const pending = state.pending;
  const prompt = typeof pending.data?.prompt === "string" ? pending.data.prompt : undefined;
  return { kind: pending.kind, options: [...pending.options], labels: projectPendingLabels(def, state), ...(prompt ? { prompt } : {}) };
}
export function availableFearActions(story: FearStory, state: FearState): FearAvailableAction[] {
  const def = assertStory(story);
  if (state.status !== "active") return [];
  const actions: FearAvailableAction[] = [];
  const add = (action: FearAction, label: string, hint?: string) => {
    if (fearItemSourceBlocksBooksOrRituals(state)
      && (action.type === "cast-arcane" || action.type === "summon-servitor" || action.type === "learn-arcane"
        || action.type === "exorcise" || (action.type === "use-item" && action.target === "read-book"))) return;
    actions.push({ action, label, ...(hint ? { hint } : {}) });
  };
  if (state.pending) {
    const labels = CHOICE_LABELS;
    const pendingLabels = projectPendingLabels(def, state);
    const pendingOptions = state.pending.kind === "farm-choice"
      && (currentBox(state).searchesMade ?? 0) >= (currentBox(state).searchesAllowed ?? 1)
      ? state.pending.options.filter(option => option !== "search") : state.pending.options;
    for (const option of pendingOptions) {
      const creationLabel = state.pending.kind === "creation-skills" ? option.split("|").map(id => def.skills[id]?.label ?? id).join(" + ") : undefined;
      const farmLabel = state.pending.kind === "farm-choice" ? option === "food" ? `取得${state.pending.data?.food ?? "D6"}食物` : "搜索" : undefined;
      const visible = creationLabel ?? farmLabel ?? pendingLabels[option] ?? labels[option]
        ?? (state.pending.kind === "source-choice" ? resultLabel(def, option) : option);
      add({ type: "choose", choice: option }, visible, state.pending.kind === "starting-area" ? `选择地图格 ${visible}；首次进入不掷区域表` : `选择：${visible}`);
    }
    return actions;
  }
  for (const option of silverCraftOptions(def, state)) add(option.action, option.label, option.hint);
  if (state.combat) {
    const combat = state.combat;
    if (combat.playerFirst) {
      if (combat.grappled) add({ type: "break-grapple" }, "挣脱控制：L6力量检定", "强壮基础+1／专家+2；成功后本回合可继续行动，失败时承受自动伤害");
      if (combat.knockedDown && hasLivingGoat(def, combat)) {
        add({ type: "stand-up" }, "站起来", "消耗本回合行动；解除倒地状态");
        add({ type: "stay-down" }, "保持倒地并准备防御", "放弃攻击；下一次防御-2，之后站起");
      }
      const livingGroups = combat.groups?.filter(group => group.enemyLives.length) ?? [];
      const puppetTheatre = combat.enemyId === "haunted-puppets" && state.missionProgress["flag:puppet-theatre"] === true;
      if (puppetTheatre && (state.inventory["molotov-cocktail"] ?? 0) > 0)
        if ((state.inventory.lighter ?? 0) > 0 || (state.inventory.matches ?? 0) > 0)
          add({ type: "use-item", target: "molotov-cocktail", choice: "puppet-theatre" }, "投掷燃烧瓶攻击木偶", "需要打火机或火柴；按来源进行一次L4攻击；无论命中与否消耗燃烧瓶并失去1点生命。");
      if ((state.inventory["molotov-cocktail"] ?? 0) > 0 && (state.inventory.lighter ?? 0) + (state.inventory.matches ?? 0) > 0
        && state.missionProgress["flag:fire-ban"] !== true) {
        const targets = livingGroups.length ? livingGroups.map(group => ({ id: group.enemyId, label: def.enemies[group.enemyId]?.label ?? group.enemyId }))
          : [{ id: combat.enemyId, label: def.enemies[combat.enemyId]?.label ?? combat.enemyId }];
        for (const target of targets) if ((target.id !== "haunted-puppets" || !puppetTheatre)
          && def.enemies[target.id]?.specialRule !== "tickling-ghost")
          add({ type: "use-item", target: "molotov-cocktail", choice: target.id },
            `投掷燃烧瓶：${target.label}`, def.enemies[target.id]?.tags?.includes("zombie")
              ? "需要打火机或火柴；自动摧毁1只僵尸，不掷攻击骰；消耗燃烧瓶。"
              : "需要打火机或火柴；进行一次+2火焰攻击；消耗燃烧瓶。火焰可永久摧毁吸血鬼。");
      }
      const requiresMagicWeapon = combat.specialRule === "tickling-ghost";
      const hypnosTargets = combat.groups?.length
        ? combat.groups.filter(group => group.enemyLives.length && isHypnosEligible(def, group.enemyId)).map(group => group.enemyId)
        : combat.enemyLives.length && isHypnosEligible(def, combat.enemyId) ? [combat.enemyId] : [];
      if (!state.hypnosUsed && hypnosTargets.length && (state.hypnosLearned || ((state.inventory["book-of-hypnos"] ?? 0) > 0 && state.xp >= 1))) {
        for (const enemyId of new Set(hypnosTargets)) add({ type: "use-item", target: "hypnos-spell", choice: enemyId }, `施放催眠术：${def.enemies[enemyId]?.label ?? enemyId}`, state.hypnosLearned ? `对抗目标L${def.enemies[enemyId]?.level}；失败可再次尝试` : `消耗1点经验学习后对抗目标L${def.enemies[enemyId]?.level}；失败可再次尝试`);
      }
      const gloryTarget = def.enemies[combat.enemyId];
      if ((state.inventory["hand-of-glory"] ?? 0) > 0 && combat.count === 1 && !combat.groups?.length
        && gloryTarget?.tags?.includes("human") && !gloryTarget.tags.some(tag => ["undead", "zombie", "unique-zombie", "demon", "lab-horror"].includes(tag)))
        add({ type: "use-item", target: "hand-of-glory", choice: combat.enemyId }, `使用荣耀之手：${gloryTarget.label}`, "对该凡人自动避开本次遭遇；每次使用进行L5意志检定，失败失去1点理智");
      if (!combat.grappled && (!requiresMagicWeapon || def.weapons[state.weaponId]?.tags?.includes("magic")) && !(puppetTheatre && state.weaponId === "grenade")) {
        const attackTargets = livingGroups.length ? livingGroups.map(group => ({ id: group.enemyId, label: def.enemies[group.enemyId]?.label ?? group.enemyId })) : [{ id: undefined, label: "" }];
        const weapon = def.weapons[state.weaponId];
        const attackCount = weapon?.attacks ?? 1;
        const regularAmmo = !weapon?.ammoType || (state.ammo[state.weaponId] ?? 0) >= (weapon.ammoPerAttack ?? 1);
        const silverAmmo = !!weapon?.ammoType && silverAmmoCount(state, state.weaponId) >= (weapon.ammoPerAttack ?? 1);
        const canRifleBurst = state.weaponId === "rifle" && (state.ammo.rifle ?? 0) >= 3;
        const canSilverRifleBurst = state.weaponId === "rifle" && silverAmmoCount(state, "rifle") >= 1 && (state.ammo.rifle ?? 0) >= 2;
        const canAllSilverRifleBurst = state.weaponId === "rifle" && silverAmmoCount(state, "rifle") >= 3;
        const canUseHoly = state.weaponId === "pistol" && (state.inventory["holy-bullets"] ?? 0) > 0;
        for (const target of attackTargets) {
          const targetSpec = def.enemies[target.id ?? combat.enemyId];
          if (targetSpec?.specialRule === "tickling-ghost" && !def.weapons[state.weaponId]?.tags?.includes("magic")) continue;
          const base = target.id ? { type: "attack" as const, target: target.id } : { type: "attack" as const };
          if (regularAmmo && fearFamilyWeaponUsable(state, state.weaponId)) add(base, target.id ? `攻击：${target.label}` : "攻击");
          if (silverAmmo && fearFamilyWeaponUsable(state, state.weaponId)) add({ ...base, silver: true }, target.id ? `银弹攻击：${target.label}` : "银弹攻击", `使用1发${weapon.label}口径银弹；针对银弹弱点按来源获得加值`);
          if (canRifleBurst && fearFamilyWeaponUsable(state, state.weaponId)) add({ ...base, shots: 2 }, target.id ? `步枪连射：${target.label}（消耗3发子弹）` : "步枪连射（消耗3发子弹）", "进行两次独立攻击；选择后按来源一次支付3发子弹");
          if (canAllSilverRifleBurst && fearFamilyWeaponUsable(state, state.weaponId)) add({ ...base, shots: 2, silver: true }, `步枪银弹连射：${target.label || "目标"}`, "进行两次独立攻击，共消耗3发步枪银弹");
          if (canSilverRifleBurst && fearFamilyWeaponUsable(state, state.weaponId)) for (const shot of [1, 2] as const)
            add({ ...base, shots: 2, silverBulletIndex: shot }, `步枪连射：第${shot}发使用银弹（${target.label || "目标"}）`, "两次独立攻击共耗3发弹药；此发使用1发银弹，其余按普通弹结算");
          if (state.missionRules?.missionId === "5" && (target.id ?? combat.enemyId) === "coven-witch" && state.weaponId === "unarmed" && regularAmmo)
            add({ ...base, nonlethal: true }, `非致命擒获：${target.label}`, "徒手攻击-2；造成非致命伤害并活捉女巫");
          if (regularAmmo && (state.luck ?? 0) > 0) for (let roll = 1; roll <= attackCount; roll++)
            add({ ...base, luckRollIndex: roll }, `${target.id ? `攻击：${target.label}` : "攻击"}（消耗1点幸运：第${roll}次攻击+1）`);
          if (canUseHoly) for (let shot = 1; shot <= attackCount; shot++) {
            add({ ...base, holyBulletIndex: shot }, `${target.id ? `攻击：${target.label}` : "攻击"}（使用1发圣弹）`, "仅手枪可用；对恶魔/吸血鬼造成2点伤害，命中后可能令目标逃走");
            if ((state.luck ?? 0) > 0) for (let roll = 1; roll <= attackCount; roll++)
              add({ ...base, holyBulletIndex: shot, luckRollIndex: roll }, `${target.id ? `攻击：${target.label}` : "攻击"}（第${shot}次使用圣弹；第${roll}次攻击+1幸运）`);
          }
        }
      }
      if (state.servitor && !state.skipNextAttack) {
        const servitorTargets = livingGroups.length ? livingGroups.map(group => ({ id: group.enemyId, label: def.enemies[group.enemyId]?.label ?? group.enemyId })) : [{ id: undefined, label: "" }];
        for (const target of servitorTargets) add({ type: "servitor-attack", target: target.id }, target.id ? `使魔攻击：${target.label}` : "使魔攻击", `使魔攻击加值+${state.servitor.attackBonus}；每次命中造成1点伤害`);
      }
      for (const option of fearFamilyActionOptions(def, state)) add(option.action, option.label, option.hint);
      if (combat.groups?.length) {
        const primaryId = combat.groups[0].enemyId;
        for (const group of combat.groups) {
          if (!group.enemyLives.length || group.enemyId === primaryId || !def.enemies[group.enemyId]?.familyRule) continue;
          activateCombatGroup(def, combat, group);
          for (const option of fearFamilyActionOptions(def, state)) {
            add({ ...option.action, target: group.enemyId }, `${def.enemies[group.enemyId].label}：${option.label}`, option.hint);
          }
          restorePrimaryCombatGroup(def, combat);
        }
      }
      if (!state.skipNextAttack) for (const weapon of new Set(state.weaponIds)) {
        if (requiresMagicWeapon && !def.weapons[weapon]?.tags?.includes("magic")) continue;
        if (puppetTheatre && weapon === "grenade") continue;
        if (!canWield(def, state, weapon)) continue;
        add({ type: "switch-weapon", weapon }, `切换武器：${def.weapons[weapon]?.label ?? weapon}`);
      }
      const activeEnemy = def.enemies[combat.enemyId];
    if (combat.playerFirst) {
      for (const option of fearItemSourceActions(def, state, { kind: "check", check: "escape", enemyId: combat.enemyId, enemyTags: activeEnemy?.tags ?? [] }))
        add(option.action, option.label, option.hint);
      const itemTargets = combat.groups?.length ? combat.groups.filter(group => group.enemyLives.length)
        .map(group => ({ enemyId: group.enemyId, tags: def.enemies[group.enemyId]?.tags ?? [] }))
        : [{ enemyId: combat.enemyId, tags: activeEnemy?.tags ?? [] }];
      for (const target of itemTargets) for (const option of fearItemSourceActions(def, state,
        { kind: "combat-item", enemyId: target.enemyId, enemyTags: target.tags }))
        add(option.action, option.label, option.hint);
    }
      const exorcismTargets = combat.groups?.length ? combat.groups.filter(group => group.enemyLives.length
        && (def.enemies[group.enemyId]?.tags?.includes("susceptible-exorcism") || group.specialRule === "tickling-ghost"))
        .map(group => ({ id: group.enemyId, level: def.enemies[group.enemyId].level }))
        : (activeEnemy?.tags?.includes("susceptible-exorcism") || combat.specialRule === "tickling-ghost") ? [{ id: combat.enemyId, level: combat.enemyLevel }] : [];
      if ((state.arcaneSkills.exorcism ?? 0) > 0) {
        for (const target of exorcismTargets) for (const component of ["holy-water", "incense", "essential-oils"]) if ((state.inventory[component] ?? 0) > 0)
          add({ type: "exorcise", target: component, ...(combat.groups?.length ? { choice: target.id } : {}) }, `驱魔：${def.enemies[target.id]?.label ?? target.id}（${def.items?.[component]?.label ?? component}）`, `需持有该组件；对抗L${target.level}，成功后驱逐目标；组件不消耗`);
      }
      if (activeEnemy?.tags?.includes("vampire")) {
        for (const itemId of ["holy-symbol", "silver-crucifix", "garlic"]) if ((state.inventory[itemId] ?? 0) > 0 && !combat.vampireTurnAttempts?.includes(itemId)
          && (itemId === "garlic" || (state.skills.faith ?? 0) > 0)
          && !(itemId === "garlic" && combat.surprise))
          add({ type: "exorcise", target: itemId }, `以${def.items?.[itemId]?.label ?? (itemId === "garlic" ? "大蒜" : "圣徽")}驱退${activeEnemy.label}`,
            itemId === "garlic" ? `每次尝试消耗1头大蒜；掷爆骰D6对抗吸血鬼L${combat.enemyLevel}，遭伏击时不可使用`
              : `需要信仰技能；掷爆骰D6加信仰修正，对抗吸血鬼L${combat.enemyLevel}；圣徽不消耗`);
      }
      if (combat.enemyId === "undead-6") {
        const symbolId = (state.inventory["holy-symbol"] ?? 0) > 0 ? "holy-symbol" : "silver-crucifix";
        const confrontable = [symbolId, "garlic"].filter(itemId => (state.inventory[itemId] ?? 0) > 0
          && !combat.vampireConfrontAttempts?.includes(itemId) && !(itemId === "garlic" && combat.surprise));
        for (const itemId of confrontable) add({ type: "vampire-confront", target: itemId },
          `普通吸血鬼遭遇规则：以${def.items?.[itemId]?.label ?? itemId}对峙`,
          itemId === "garlic" ? "来源 p60：D6为1–3时驱退；本次消耗1头大蒜；遭伏击时不能用大蒜。" : "来源 p60：D6为1–3时驱退；每次遭遇限用一次；圣徽不消耗。此检定独立于信仰技能。");
        if (confrontable.length === 2) add({ type: "vampire-confront", target: "both" }, "普通吸血鬼遭遇规则：同时使用圣徽和大蒜",
          "来源 p60：对两件物品各掷一次D6；即使第一次成功也完成两次已选择的检定。大蒜消耗1头。此检定独立于信仰技能。");
      }
    } else {
      const trainedDefense = !combat.grappled && !combat.cannotDefendNextAttack && combat.specialRule !== "demon-cat"
        ? (["dodge", "agile"] as const).filter(skill => (state.skills[skill] ?? 0) > 0) : [];
      if (!trainedDefense.length) add({ type: "defend" }, combat.grappled ? "被抓住：承受自动攻击" : combat.cannotDefendNextAttack ? "承受无法防御的恶魔攻击" : "防御",
        combat.grappled ? "来源规则：被午夜人抓住时不掷防御骰，自动承受2点伤害" : undefined);
      else for (const skill of trainedDefense) {
        const bonus = namedSkillMod(def, state, skill, "defense");
        const skillLabel = skill === "dodge" ? "闪避" : "敏捷";
        add({ type: "defend", skill }, `${skillLabel}防御（+${bonus}）`, skill === "dodge" ? "自然1会令下一次攻击−1；可与敏捷二选一，不叠加" : "选择敏捷防御；与闪避二选一，不叠加");
        if ((state.luck ?? 0) > 0 && combat.specialRule !== "demon-cat" && !combat.grappled) {
          const groups = combat.groups?.length ? combat.groups.filter(group => group.enemyLives.length)
            : [{ enemyId: combat.enemyId, enemyLives: combat.enemyLives }];
          for (const group of groups) for (let index = 0; index < group.enemyLives.length; index++)
            add({ type: "defend", skill, luckTarget: `${group.enemyId}:${index}` }, `${skillLabel}防御${def.enemies[group.enemyId]?.label ?? group.enemyId}${index + 1}号（消耗1点幸运）`);
        }
      }
      if (!trainedDefense.length && (state.luck ?? 0) > 0 && combat.specialRule !== "demon-cat" && !combat.grappled) {
        const groups = combat.groups?.length ? combat.groups.filter(group => group.enemyLives.length)
          : [{ enemyId: combat.enemyId, enemyLives: combat.enemyLives }];
        for (const group of groups) for (let index = 0; index < group.enemyLives.length; index++)
          add({ type: "defend", luckTarget: `${group.enemyId}:${index}` }, `防御${def.enemies[group.enemyId]?.label ?? group.enemyId}${index + 1}号（消耗1点幸运：本次防御+1）`);
      }
    }
    if (state.servitor) add({ type: "dismiss-servitor" }, "解散使魔", "使魔立即消失；之后可重新召唤");
    const killedForEscape = combat.escapeAfter ? combat.groups?.find(group => group.enemyId === combat.escapeAfter!.enemyId)?.defeatedCount ?? 0 : Number.MAX_SAFE_INTEGER;
    if (combat.playerFirst && !combat.hostileServitor && !combat.mirinaCompelled && (!def.enemies[combat.enemyId]?.noEscape && !def.enemies[combat.enemyId]?.tags?.includes("no-escape")
      || (state.missionProgress["flag:serial-killers-casebook-read"] === true && def.enemies[combat.enemyId]?.tags?.includes("slasher"))
      || (combat.escapeAfter && killedForEscape >= combat.escapeAfter.defeated))
      && (!combat.escapeAfter || killedForEscape >= combat.escapeAfter.defeated)
      && !(combat.escapeBlockedUntilReduce && combat.enemyLives.length > 2)
      && fearFamilyEscapeAllowed(familyOwnerId(def, combat, combat.enemyId), combat.familyState) !== false
      && !state.traumas.some(id => def.traumas?.[id]?.escapeBelowLife !== undefined && state.hp > def.traumas[id].escapeBelowLife!)) {
      const slowZombie = def.enemies[combat.enemyId]?.tags?.includes("zombie-slow") && !combat.groups?.length;
      add({ type: "escape" }, slowZombie ? "无伤甩开缓慢僵尸" : "逃跑", slowZombie ? "不掷骰、不受伤、不获得经验；仍留在当前区域" : undefined);
      const escapeEnemy = def.enemies[combat.enemyId];
      if (escapeEnemy?.escapeBait) {
        for (const itemId of escapeEnemy.escapeBait.itemIds ?? []) if ((state.inventory[itemId] ?? 0) > 0)
          add({ type: "escape", choice: itemId }, `逃跑并使用${def.items?.[itemId]?.label ?? itemId}`, `消耗1件物品；逃跑检定+${escapeEnemy.escapeBait.bonus}`);
        if ((escapeEnemy.escapeBait.food ?? 0) > 0 && state.food >= escapeEnemy.escapeBait.food!)
          add({ type: "escape", choice: "food" }, `逃跑并消耗${escapeEnemy.escapeBait.food}点食物`, `逃跑检定+${escapeEnemy.escapeBait.bonus}`);
      }
      if (combat.specialRule === "demon-dog") {
        if ((state.inventory["dog-food"] ?? 0) > 0) add({ type: "escape", choice: "dog-food" }, "逃跑并使用狗粮", "+2逃跑检定；消耗1份狗粮");
        if ((state.inventory["dog-toy"] ?? 0) > 0) add({ type: "escape", choice: "dog-toy" }, "逃跑并使用狗玩具", "+2逃跑检定；消耗1个狗玩具");
      }
      if (combat.specialRule === "demon-cat" && (state.inventory["cat-food"] ?? 0) > 0)
        add({ type: "escape", choice: "cat-food" }, "逃跑并使用猫粮", "+2逃跑检定；消耗1份猫粮");
      if (combat.playerFirst && (state.inventory["holy-water"] ?? 0) > 0) {
        const groups = combat.groups?.filter(group => group.enemyLives.length) ?? [];
        const targetIds = groups.length ? groups.map(group => group.enemyId) : [combat.enemyId];
        for (const enemyId of targetIds) {
          const enemy = def.enemies[enemyId];
          const eligible = enemy?.tags?.includes("susceptible-holy-water")
            || enemy?.tags?.includes("demon")
            || (enemy?.tags?.includes("undead") && !enemy.tags.includes("zombie") && !enemy.tags.includes("ghost"));
          if (eligible) add({ type: "use-item", target: "holy-water", choice: enemyId }, `投掷圣水：${enemy.label}`, "自动命中并造成2点伤害；消耗1瓶");
        }
      }
      if (combat.playerFirst && (state.inventory["hell-chain"] ?? 0) > 0 && (state.hellChainHits ?? 0) < 6) {
        const targets = combat.groups?.filter(group => group.enemyLives.length).map(group => group.enemyId) ?? [];
        for (const enemyId of new Set(targets.length ? targets : [combat.enemyId]))
          add({ type: "use-item", target: "hell-chain", choice: enemyId }, `挥动地狱锁链：${def.enemies[enemyId]?.label ?? enemyId}`, "对抗L5意志；失败失去1理智；自动造成1点伤害，可命中灵体和恶魔");
      }
      if (combat.playerFirst && state.preparedCurse) {
        const targets = combat.groups?.length ? combat.groups.filter(group => group.enemyLives.length).map(group => group.enemyId) : [combat.enemyId];
        for (const enemyId of new Set(targets)) if (curseMatches(def, state.preparedCurse.target, enemyId) && curseCanAffect(def, enemyId))
          add({ type: "fire-curse", target: enemyId }, `发动诅咒：${def.enemies[enemyId]?.label ?? enemyId}（无行动消耗）`, `本次遭遇L降低${state.preparedCurse.reduction}；也可保留诅咒以后使用`);
      }
    }
    if (combat.enemyId === "sewer-rat-horde" && (state.inventory["rat-poison"] ?? 0) > 0 && state.food > 0)
      add({ type: "use-item", target: "rat-poison" }, "用鼠药毒杀鼠群", "消耗1份鼠药和1点食物，对鼠群造成2点伤害");
      const blobPresent = combat.groups?.some(group => group.enemyId === "lab-horrors-1" && group.enemyLives.length)
        ?? (combat.enemyId === "lab-horrors-1" && combat.enemyLives.length > 0);
      if (blobPresent && state.readBooks.includes("blob-experiment") && ((state.inventory.salt ?? 0) > 0 || state.food > 0))
        add({ type: "use-item", target: "blob-salt", choice: "lab-horrors-1" }, "向黏液怪撒盐", "读过《黏液实验》后自动造成2点伤害；来源未写明消耗食物或盐");
    return actions;
  }
  if (state.pendingEvent && !state.pendingEvent.started && state.pendingEvent.visitCount === state.visitCount) {
    add({ type: "resolve-event", target: state.pendingEvent.eventId }, `继续事件：${resultLabel(def, `event-${state.pendingEvent.eventId}`)}`, "查看当前事件片段后继续；事件骰与效果按原书规则结算");
    return actions;
  }
  for (const option of fearItemSourceActions(def, state, { kind: "menu" })) {
    if (option.action.target === "source-food" && carriedFood(def, state) >= carriedFoodLimit(def, state)) continue;
    add(option.action, option.label, option.hint);
  }
  if (state.servitor) add({ type: "dismiss-servitor" }, "解散使魔", "使魔立即消失；之后可重新召唤");
  if (state.missionRules?.missionId === "2" && !state.missionRules.hunt.targetDefeated
    && !state.missionRules.hunt.targetOnNextBox && (state.missionRules.hunt.targetLevel ?? Infinity) <= state.clues)
    add({ type: "locate-hunt-target" }, "花费线索定位目标杀手", `支付${state.missionRules.hunt.targetLevel}条线索；进入下一个区域时遭遇目标`);
  for (const target of reachable(state, def)) { const box = findBox(state, target); const label = boxLabel(box); add({ type: "move", target }, `前往 ${label}`, box.visited ? "已访问区域" : "未访问区域"); }
  const sheet = state.mapSheets.find(value => value.sheet === currentBox(state).sheet)!;
  if (sheet.boxes.every(value => value.visited) && state.missionProgress.completed !== true) add({ type: "move" }, "连接新的地图纸", "本张地图纸已全部探索，任务仍在进行");
  const box = currentBox(state);
  if (!box.safehouse && !box.searchForbidden && (box.searchesMade ?? 0) < (box.searchesAllowed ?? 1)) add({ type: "search" }, "搜索本区域");
  if (box.safehouse) {
    for (const [id, count] of Object.entries(state.inventory)) for (let amount = 1; amount <= count; amount++)
      add({ type: "store-item", target: `item:${id}`, amount }, `存入${def.items?.[id]?.label ?? id} ×${amount}`);
    for (const id of new Set(state.weaponIds)) if (!isCursedWeapon(def, id)) add({ type: "store-item", target: `weapon:${id}`, amount: 1 }, `存放武器：${def.weapons[id]?.label ?? id}`);
  }
  for (const [key, count] of Object.entries(box.storedItems ?? {})) {
    const id = key.replace(/^(item|weapon):/, "");
    const itemWeight = key.startsWith("weapon:") ? 1 : (def.items?.[id]?.carriedWeight ?? 1);
    const maxTake = id === "backpack" || def.items?.[id]?.weightless
      ? count : Math.min(count, Math.floor(Math.max(0, carryCapacity(def, state) - carriedItemCount(def, state) - Math.max(0, state.food - foodBaseCapacity(state))) / itemWeight));
    for (let amount = 1; amount <= maxTake; amount++) add({ type: "retrieve-item", target: key, amount }, `取回${resultLabel(def, id)} ×${amount}`);
  }
  for (const [id, count] of Object.entries(state.inventory)) if (count > 0)
    add({ type: "discard-item", target: `item:${id}`, amount: 1 }, `丢弃：${def.items?.[id]?.label ?? id}`);
  for (const id of new Set(state.weaponIds)) if (id !== "unarmed" && !isCursedWeapon(def, id)) add({ type: "discard-item", target: `weapon:${id}`, amount: 1 }, `丢弃武器：${def.weapons[id]?.label ?? id}`);
  for (const weapon of new Set(state.weaponIds)) if (weapon !== state.weaponId && canWield(def, state, weapon)) add({ type: "equip", weapon }, `装备：${def.weapons[weapon].label}`);
  if (state.missionProgress.gateHere === true && (state.arcaneSkills.gate ?? 0) > 0) add({ type: "close-gate" }, "尝试关闭地狱之门", `L${def.gates.level}意志检定；失败损失1生命和1理智`);
  if ((state.arcaneSkills["energy-of-the-macrocosmos"] ?? 0) > 0
    && state.missionProgress["arcane:energy:used"] !== true && (state.inventory.incense ?? 0) > 0) {
    for (const candle of ["candle", "candles", "blessed-candle"]) if ((state.inventory[candle] ?? 0) > 0)
      add({ type: "cast-arcane", skill: "energy-of-the-macrocosmos", target: candle }, "施放宏观宇宙之力（献祭1支蜡烛）", "需要熏香组件；耗时2个时间格，获得D6点幸运；每项任务一次");
    if ((state.inventory["blessed-candle"] ?? 0) > 0)
      add({ type: "cast-arcane", skill: "energy-of-the-macrocosmos", target: "blessed-candle" }, "施放宏观宇宙之力（献祭受祝福的蜡烛）", "受祝福的蜡烛可用于任何需蜡烛的仪式；耗时2个时间格，获得D6点幸运；每项任务一次");
    if (state.food >= 2) add({ type: "cast-arcane", skill: "energy-of-the-macrocosmos", target: "food" }, "施放宏观宇宙之力（献祭2点食物）", "需要熏香组件；耗时2个时间格，获得D6点幸运；每项任务一次");
  }
  if ((state.arcaneSkills.healing ?? 0) > 0 && state.missionProgress["arcane:healing:used"] !== true
    && state.hp < state.maxHp && state.food > 0 && (state.inventory["holy-book"] ?? 0) > 0) {
    for (const candle of ["candle", "candles", "blessed-candle"]) if ((state.inventory[candle] ?? 0) > 0)
      add({ type: "cast-arcane", skill: "healing", target: candle }, "施放治疗仪式", "需要食物和圣书；献祭1点食物与1支蜡烛，恢复最多4点生命；每项任务一次");
  }
  if ((state.arcaneSkills.foretell ?? 0) > 0
    && state.missionProgress["arcane:foretell:used"] !== true
    && (state.inventory["black-mirror"] ?? 0) > 0) {
    for (const candle of ["candle", "candles", "blessed-candle"]) if ((state.inventory[candle] ?? 0) > 0)
      add({ type: "cast-arcane", skill: "foretell", target: candle }, "施展预言（献祭1支蜡烛）", "需要黑镜组件；进入下一区域前掷一次城镇探索表，可接受结果或改变主意；每项任务一次");
  }
  if ((state.arcaneSkills.pentagram ?? 0) > 0) {
    if (state.missionProgress["flag:pentagram"] === true)
      add({ type: "cast-arcane", skill: "pentagram", target: "break" }, "打破身上的五芒星", "可随时打破；之后可再次施放并献祭7支蜡烛");
    else if ((state.inventory["art-materials"] ?? 0) > 0 && ((state.inventory["ritual-dagger"] ?? 0) > 0 || state.weaponIds.includes("kitchen-knife"))
      && (state.inventory.candle ?? 0) + (state.inventory.candles ?? 0) + (state.inventory["blessed-candle"] ?? 0) >= 7)
      add({ type: "cast-arcane", skill: "pentagram", target: "cast" }, "施放五芒星", "需要美术材料与仪式匕首；献祭7支蜡烛；本任务对恶魔防御+1");
  }
  if ((state.arcaneSkills.curse ?? 0) > 0 && !state.preparedCurse
    && (state.inventory.lighter ?? 0) + (state.inventory.matches ?? 0) > 0
    && (state.inventory["bone-powder"] ?? 0) > 0
    && (state.inventory.candle ?? 0) + (state.inventory.candles ?? 0) + (state.inventory["blessed-candle"] ?? 0) > 0) {
    for (const category of Object.keys(CURSE_CATEGORY_LABELS))
      if (Object.entries(def.enemies).some(([id, enemy]) => (enemy.tags?.includes(category) ?? false) || id.includes(category)))
        add({ type: "cast-arcane", skill: "curse", target: `category:${category}` }, `准备诅咒：${CURSE_CATEGORY_LABELS[category]}（L降低1）`, "需要打火机或火柴；献祭1支蜡烛和1剂骨粉");
    for (const [enemyId, enemy] of Object.entries(def.enemies))
      add({ type: "cast-arcane", skill: "curse", target: `specific:${enemyId}` }, `准备诅咒：特定目标${enemy.label}（L降低2）`, "需要打火机或火柴；献祭1支蜡烛和1剂骨粉");
  }
  if (!state.combat && (state.inventory["blessed-candle"] ?? 0) > 0) {
    if (state.sanity < state.maxSanity) add({ type: "use-item", target: "blessed-candle", choice: "sanity" }, "燃烧受祝福的蜡烛：恢复1点理智");
    if (state.missionProgress["flag:cursed"] === true) add({ type: "use-item", target: "blessed-candle", choice: "remove-curse" }, "燃烧受祝福的蜡烛：解除诅咒");
  }
  if (!state.combat && state.infections?.length && (state.inventory["first-aid-kit"] ?? 0) > 0 && (state.inventory["first-aid-charges"] ?? 0) > 0)
    add({ type: "use-item", target: "treat-infection" }, "使用急救包治疗感染", "消耗1点急救值并清除当前感染");
  if (!state.combat && !state.pending) for (const [itemId, count] of Object.entries(state.inventory)) {
    if (count > 0 && def.items?.[itemId]?.tags?.includes("book") && !state.readBooks.includes(itemId))
      add({ type: "use-item", target: "read-book", choice: itemId }, `阅读${def.items[itemId].label}`, "书籍保留；按书上效果处理");
  }
  if (!state.combat && !state.pending && (state.arcaneSkills["summon-servitor"] ?? 0) > 0
    && (state.inventory.bell ?? 0) > 0 && state.weaponIds.includes("kitchen-knife")
    && state.missionProgress["flag:pentagram"] !== true && !state.servitor && state.hp > 0 && state.sanity > 0) {
    const ordinaryCandles = (state.inventory.candle ?? 0) + (state.inventory.candles ?? 0);
    const blessedCandles = state.inventory["blessed-candle"] ?? 0;
    for (const level of [2, 4, 6] as const) {
      for (let blessed = 0; blessed <= 5; blessed++) {
        const ordinary = 5 - blessed;
        if (blessed <= blessedCandles && ordinary <= ordinaryCandles)
          add({ type: "summon-servitor", amount: level, choice: `candles:${blessed}` }, `召唤L${level}使魔（献祭${ordinary}支普通蜡烛、${blessed}支受祝福蜡烛）`, "蜡烛可由受祝福蜡烛替代；仪式耗时1格；依次进行L级魔法与意志检定");
      }
      if (state.hp >= 2) add({ type: "summon-servitor", amount: level, choice: "life" }, `召唤L${level}使魔（献祭2点生命）`, "仪式耗时1格；依次进行L级魔法与意志检定");
    }
  }
  if (!state.combat && !state.pending && !state.firstAidUsedThisEncounter && state.lifeLostThisEncounter && state.hp < state.maxHp
    && (state.inventory["first-aid-kit"] ?? 0) > 0) {
    const medicLevel = Math.min(2, state.skills.medic ?? 0) as 0 | 1 | 2;
    const limit = firstAidHealLimit({ hasKit: true, charges: state.inventory["first-aid-charges"] ?? 0,
      lifeLostThisEncounter: 1, currentLife: state.hp, maxLife: state.maxHp, medicLevel });
    for (let amount = 1; amount <= limit; amount++)
      add({ type: "use-item", target: "first-aid", amount }, `使用${amount}点急救值：恢复${amount}点生命`, `每次遭遇限额${limit}点；剩余${state.inventory["first-aid-charges"] ?? 0}点急救值`);
  }
  for (const [skillId, skill] of Object.entries(def.skills)) {
    if (skill.kind === "arcane") {
      const learning = def.arcaneLearning?.[skillId];
      if (!learning || state.xp < skill.xp) continue;
      const level = state.arcaneSkills[skillId] ?? 0;
      if (level >= (learning.expert ? 2 : 1)) continue;
      const levelOk = (requiredSkill?: string, requiredLevel?: 1 | 2) => !requiredSkill || (state.skills[requiredSkill] ?? state.arcaneSkills[requiredSkill] ?? 0) >= (requiredLevel ?? 1);
      for (const source of learning.sources ?? []) {
        const alreadyRead = state.readBooks?.includes(source.itemId) ?? false;
        if (((state.inventory[source.itemId] ?? 0) < 1 && !alreadyRead) || !levelOk(source.requiredSkill, source.requiredSkillLevel)) continue;
        if (skillId === "exorcism" && source.itemId === "exorcism-book" && !fearItemSourceAllowsExorcismBook(state, skillId, (state.skills.faith ?? 0) > 0)) continue;
        if (source.sanityLoss && state.sanity <= 0) continue;
        const itemLabel = def.items?.[source.itemId]?.label ?? source.itemId;
        add({ type: "learn-arcane", skill: skillId, target: source.itemId }, `${alreadyRead ? "已读" : "研读"}${itemLabel}：学习${skill.label}`, `消耗${skill.xp}点经验${learning.timeBoxes === "D3" && !alreadyRead ? "；耗时D3个时间格" : ""}${source.sanityLoss ? "；并损失1点" + (source.sanityLoss === "permanent" ? "永久理智" : "临时理智") : ""}`);
      }
      if (learning.gateAtLocation && state.missionProgress.gateHere === true
        && (state.skills[learning.gateAtLocation.requiredSkill] ?? 0) > 0
        && state.clues >= learning.gateAtLocation.clues) {
        add({ type: "learn-arcane", skill: skillId, target: "hell-gate" }, `在地狱之门花费${learning.gateAtLocation.clues}条线索：学习${skill.label}`, `消耗${skill.xp}点经验；不推进地图或遭遇`);
      }
      if (learning.sourceCondition === "not-printed" && level === 0)
        add({ type: "learn-arcane", skill: skillId, target: "unconditioned" }, `学习${skill.label}`, `消耗${skill.xp}点经验；原文未另列学习前置条件`);
      continue;
    }
    const level = state.skills[skillId] ?? 0;
    const learningCost = fearItemSourceSkillLearningCost(state, skillId, level, skill.xp);
    if (level < 2 && state.xp >= learningCost) add({ type: "learn-skill", skill: skillId }, `${level ? "提升" : "学习"}：${skill.label}`, `消耗${learningCost}点经验`);
  }
  if (canEndMission(def, state)) add({ type: "end-mission" }, "完成当前任务");
  if (state.missionFinished) add({ type: "start-mission" }, "开始下一任务");
  return actions;
}
export function initialFear(story: FearStory, seed: Partial<FearState> & { hp?: number; maxHp?: number; sanity?: number; maxSanity?: number; startBox?: number; bonusLife?: number; bonusSanity?: number; bonusSkill?: string; }, dice: FearDice): FearState {
  const def = assertStory(story);
  const interactiveCreation = seed.hp === undefined && seed.skills === undefined;
  if (seed.hp === undefined) {
    const distributed = (seed.bonusLife ?? 0) + (seed.bonusSanity ?? 0);
    if (distributed < 0 || distributed > 3 || (!interactiveCreation && distributed !== 3)) throw new Error("Character creation allocates exactly 3 bonus points across Life and Sanity");
    const selected = Object.entries(seed.skills ?? {}).filter(([id, level]) => level > 0 && def.skills[id]?.kind !== "arcane").length;
    if (!interactiveCreation && selected !== 2) throw new Error("A new Fear character must choose exactly two non-arcane skills");
  }
  const initial = newSheet({ mapSheets: [] } as unknown as FearState, def);
  const start = initial[(seed.startBox ?? 1) - 1];
  if (!start) throw new Error("startBox must be a box number from 1 to 30");
  if (seed.startBox) { start.visited = true; start.visit = 1; }
  const missionIds = Object.keys(def.missions);
  let missionId = seed.missionId && def.missions[seed.missionId] ? seed.missionId : missionIds[die(dice) - 1] ?? missionIds[0];
  const previousMissionId = seed.previousMissionId;
  for (let rerolls = 0; previousMissionId && missionId === previousMissionId && rerolls < 100; rerolls++) missionId = missionIds[die(dice) - 1] ?? missionIds[0];
  if (previousMissionId && missionId === previousMissionId && missionIds.length > 1) throw new Error("Mission roll did not change after repeated rolls");
  const state: FearState = {
    nodeId: def.sceneRefs.entry, status: "active", mapSheets: [{ sheet: 1, boxes: initial }], currentBoxId: start.id,
    startingBoxId: start.id, visitCount: seed.startBox ? 1 : 0, safehouseIds: [], mapLinks: {}, skipNextAttack: false, skipEncounters: 0, encounterCurse: 0, inventory: seed.inventory ?? {}, readBooks: seed.readBooks ?? [], booksFound: seed.booksFound ?? Object.entries(seed.inventory ?? {}).filter(([id, count]) => count > 0 && def.items?.[id]?.tags?.includes("book")).map(([id]) => id), startingBooksRead: seed.startingBooksRead ?? false, ammo: seed.ammo ?? {}, silverAmmo: seed.silverAmmo ?? {}, weaponIds: seed.weaponIds ?? ["knife"], weaponId: seed.weaponId ?? "knife",
    hp: seed.hp ?? 8 + (seed.bonusLife ?? 0) + skillStatBonus(def, seed.skills ?? {}, "maxHpChange"), maxHp: seed.maxHp ?? 8 + (seed.bonusLife ?? 0) + skillStatBonus(def, seed.skills ?? {}, "maxHpChange"), sanity: seed.sanity ?? 8 + (seed.bonusSanity ?? 0) + skillStatBonus(def, seed.skills ?? {}, "maxSanityChange"), maxSanity: seed.maxSanity ?? 8 + (seed.bonusSanity ?? 0) + skillStatBonus(def, seed.skills ?? {}, "maxSanityChange"),
    food: seed.food ?? die(dice), clues: seed.clues ?? 0, xp: seed.xp ?? 0, elapsedTimeBoxes: seed.elapsedTimeBoxes ?? 0, luck: seed.luck ?? 0, skills: seed.skills ?? {}, arcaneSkills: seed.arcaneSkills ?? {},
    scars: seed.scars ?? [], traumas: seed.traumas ?? [], missionId, previousMissionId, completedMissions: seed.completedMissions ?? [], missionFinished: false,
    missionProgress: { gateCountAtStart: seed.gatesClosed ?? 0, ...(seed.missionProgress ?? {}) }, missionFood: 0,
    missionFoodTarget: def.missions[missionId]?.kind === "bring-food" ? tableRoll("2D6", dice) + 12 : 0, gatesClosed: seed.gatesClosed ?? 0,
    defeated: seed.defeated ?? [], uniqueEventsPlayed: seed.uniqueEventsPlayed ?? [], resolvedEvents: seed.resolvedEvents ?? [], ongoingChecks: [], infections: [], deferredTables: [],
    deferredOperations: def.rules.startingEquipmentTables ? [
      { op: "roll-table", tableId: def.rules.startingEquipmentTables.randomWeapon },
      { op: "roll-table", tableId: def.rules.startingEquipmentTables.randomObject },
      { op: "roll-table", tableId: def.rules.startingEquipmentTables.usefulItem },
    ] : [], log: seed.log ?? [],
  };
  state.food = Math.min(state.food, carriedFoodLimit(def, state));
  const mission = def.missions[missionId];
  if (mission?.kind === "hunt-target") {
    const tableId = mission.targetTable ?? "slashers";
    state.missionProgress.targetId = mission.target ?? drawTableEntry(def, tableId, dice).entry.result;
    state.missionProgress.targetDefeated = false;
  }
  if (seed.bonusSkill && !state.skills[seed.bonusSkill]) state.skills[seed.bonusSkill] = 1;
  const creationOptions = ["life:0,sanity:3", "life:1,sanity:2", "life:2,sanity:1", "life:3,sanity:0", "extra:skill"];
  const startingTables = def.rules.startingEquipmentTables;
  if (startingTables?.randomWeapon) creationOptions.push("extra:random-weapon");
  if (startingTables?.randomObject) creationOptions.push("extra:random-object");
  if (startingTables?.usefulItem) creationOptions.push("extra:useful-stuff");
  state.pending = interactiveCreation
    ? { kind: "creation-stats", options: creationOptions }
    : { kind: "starting-area", options: initial.map(box => box.id) };
  ensureScene(story, state, def.sceneRefs.entry);
  return state;
}

export function advanceFear(story: FearStory, current: FearState, action: FearAction, dice: FearDice, input: Record<string, unknown> = {}): FearState {
  const def = assertStory(story);
  if (current.status !== "active") throw new Error(`Fear run is ${current.status}`);
  if (current.pending?.kind && current.pending.kind !== "starting-area" && current.pending.kind !== "double-one" && action.type !== "choose") throw new Error("Resolve the pending Fear choice first");
  if (current.pending?.kind === "starting-area" && action.type !== "choose") throw new Error("Choose the starting map area first");
  if (current.pending?.kind === "double-one" && action.type !== "choose") throw new Error("Resolve the double-one consequence first");
  const combatActions = new Set(["attack", "servitor-attack", "defend", "escape", "switch-weapon", "choose", "use-item", "exorcise", "vampire-confront", "fire-curse", "dismiss-servitor", "break-grapple", "stand-up", "stay-down"]);
  if (current.combat && !combatActions.has(action.type)) throw new Error("Resolve the current encounter before taking an exploration or inventory action");
  if (!current.combat && ["attack", "defend", "escape", "switch-weapon", "exorcise", "vampire-confront"].includes(action.type)) throw new Error("This combat action is unavailable outside an active encounter");
  const requested = availableFearActions(story, current).some(({ action: available }) => available.type === action.type
    && available.target === action.target && (available.weapon === action.weapon || (action.type === "attack" && available.weapon === undefined && action.weapon === current.weaponId))
    && available.skill === action.skill && available.choice === action.choice && available.amount === action.amount
    && available.luckRollIndex === action.luckRollIndex && available.luckTarget === action.luckTarget
    && available.holyBulletIndex === action.holyBulletIndex && available.nonlethal === action.nonlethal && available.shots === action.shots
    && available.silver === action.silver && available.silverBulletIndex === action.silverBulletIndex);
  if (!requested) {
    if (action.type === "choose" && current.pending) throw new Error("Invalid choice");
    if (action.type === "search" && currentBox(current).safehouse) throw new Error("Safehouses cannot be searched");
    if (action.type === "search") throw new Error("This box has no remaining search attempts");
    if (action.type === "close-gate" && current.missionProgress.gateHere !== true) throw new Error("There is no revealed hell gate in this area");
    if (action.type === "close-gate") throw new Error("The Gate Arcane Skill is required to close this hell gate");
    if (action.type === "move" && action.target) {
      const exists = current.mapSheets.some(sheet => sheet.boxes.some(box => box.id === action.target));
      throw new Error(exists ? "Fear movement must follow an adjacent box or recorded sheet connection" : `Unknown Fear map box: ${action.target}`);
    }
    throw new Error("Fear action is unavailable in the current phase or state");
  }
  const state = structuredClone(current);
  const combatAtActionStart = state.combat ? structuredClone(state.combat) : undefined;
  const sanityBeforeAction = state.sanity;
  observeFearDiceState(dice, state);
  state.elapsedTimeBoxes ??= 0;
  state.luck ??= 0;
  state.readBooks ??= [];
  state.booksFound ??= Object.entries(state.inventory).filter(([id, count]) => count > 0 && def.items?.[id]?.tags?.includes("book")).map(([id]) => id);
  state.startingBooksRead ??= false;
  const personalZombie = state.combat && ["zombie-pet", "zombie-friend"].includes(state.combat.specialRule ?? "")
    ? state.combat : undefined;
  const demonChildGroup = state.combat?.groups?.find(group => group.enemyLives.length > 0
    && (group.specialRule ?? def.enemies[group.enemyId]?.specialRule) === "demon-child");
  if (demonChildGroup && state.combat?.playerFirst && demonChildGroup.sourceTurnCheckRound !== state.combat.round) {
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定");
    const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "magic-save");
    const success = face === 6 || (face !== 1 && total >= 3);
    demonChildGroup.sourceTurnCheckRound = state.combat.round;
    appendLog(state, `恶魔孩童每回合L3魔法豁免：${face} => ${total}（${success ? "成功" : "失败"}）。`);
    if (!success) {
      state.missionProgress["flag:cursed"] = true;
      state.combat.playerFirst = false; state.combat.round++;
      appendLog(state, "豁免失败：受到诅咒，本回合改由恶魔孩童攻击；所有检定-1，直到理智增加或诅咒被移除。");
      return state;
    }
  }
  const demonChild = state.combat?.specialRule === "demon-child" ? state.combat : undefined;
  if (demonChild?.playerFirst && demonChild.sourceTurnCheckRound !== demonChild.round) {
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "magic-save");
    const success = face === 6 || (face !== 1 && total >= 3);
    demonChild.sourceTurnCheckRound = demonChild.round;
    appendLog(state, `恶魔孩童每回合L3魔法豁免：${face} => ${total}（${success ? "成功" : "失败"}）。`);
    if (!success) {
      state.missionProgress["flag:cursed"] = true;
      demonChild.playerFirst = false; demonChild.round++;
      appendLog(state, "豁免失败：受到诅咒，本回合改由恶魔孩童攻击；所有检定-1，直到理智增加或诅咒被移除。");
      return state;
    }
  }
  if (personalZombie?.playerFirst && personalZombie.willCheckRound !== personalZombie.round) {
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "will-save");
    const success = face === 6 || (face !== 1 && total >= 3);
    personalZombie.willCheckRound = personalZombie.round;
    appendLog(state, `${def.enemies[personalZombie.enemyId]?.label ?? "僵尸朋友"}的L3意志检定：${face} => ${total}（${success ? "成功" : "失败"}）。`);
    if (!success && action.type === "attack") {
      personalZombie.playerFirst = false; personalZombie.round++;
      appendLog(state, "意志检定失败：本回合无法攻击这位归来的伙伴，改由其发动攻击。");
      return state;
    }
  }
  if (state.missionRules?.missionId === "5" && state.combat?.enemyId === "coven-witch"
    && ["attack", "servitor-attack", "defend", "escape", "exorcise", "vampire-confront", "use-item", "fire-curse"].includes(action.type)
    && state.combat.witchWillRound !== state.combat.round) {
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "will-save");
    const success = face === 6 || (face !== 1 && total >= 5);
    state.combat.witchWillRound = state.combat.round;
    appendLog(state, `女巫L5意志检定（本回合）：${face} => ${total}（${success ? "成功" : "失败"}）。`);
    if (!success) state.sanity--;
    if (state.sanity <= 0) { state.status = "insane"; return state; }
  }
  if (current.combat?.specialRule === "pied-piper" && current.combat.playerFirst && action.type === "attack") {
    const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "magic-save");
    const success = face === 6 || (face !== 1 && total >= 4);
    appendLog(state, `魔笛手L4魔法防御: ${face} => ${total} (${success ? "成功" : "失败"})`);
    if (!success) {
      state.combat!.round++;
      if (rollSourceChance(dice, state, "魔笛手强迫跳舞时受伤检定", 2).success) {
        const carried = carriedDiscardOptions(def, state, [], [], []);
        state.pending = { kind: "pied-piper-loss", options: ["life", ...carried], data: { prompt: "你被迫跳舞，无法攻击；选择损失1点生命或1件物品。" } };
      }
      return state;
    }
  }
  switch (action.type) {
    case "locate-hunt-target": {
      if (!state.missionRules || state.missionRules.missionId !== "2") throw new Error("There is no active hunt-target mission");
      const located = transitionFearMission(state.missionRules, { type: "hunt-locate", availableClues: state.clues });
      if (!located.handled) throw new Error("Not enough Clues to locate the hunted Slasher");
      state.missionRules = located.state;
      for (const effect of located.effects) if (effect.type === "resource" && effect.key === "clues") state.clues += effect.amount;
      appendLog(state, `花费${state.missionRules.hunt.targetLevel}条线索定位杀手；进入下一个区域时将遭遇目标。`);
      break;
    }
    case "dismiss-servitor": {
      if (!state.servitor) throw new Error("没有可解散的使魔");
      state.servitor = undefined;
      appendLog(state, "使魔应召消失。");
      break;
    }
    case "summon-servitor": {
      if (fearItemSourceBlocksBooksOrRituals(state)) throw new Error("烈酒持续期间不能进行仪式");
      const level = action.amount;
      if (level !== 2 && level !== 4 && level !== 6) throw new Error("使魔等级必须为2、4或6");
      const sacrifice = action.choice;
      const blessedMatch = sacrifice?.match(/^candles:([0-5])$/);
      if (!blessedMatch && sacrifice !== "life") throw new Error("选择普通／受祝福蜡烛配比或生命作为仪式献祭");
      const blessedCandles = blessedMatch ? Number(blessedMatch[1]) : 0;
      const ordinaryCandles = 5 - blessedCandles;
      const candleTotal = (state.inventory.candle ?? 0) + (state.inventory.candles ?? 0) + (state.inventory["blessed-candle"] ?? 0);
      const skillLevel = state.arcaneSkills["summon-servitor"] ?? 0;
      const base = { life: state.hp, sanity: state.sanity, candles: candleTotal, elapsedTime: state.elapsedTimeBoxes };
      const ready = canStartServitor({ state: { ...base, servitor: state.servitor }, learned: skillLevel > 0,
        hasBell: (state.inventory.bell ?? 0) > 0, hasRitualDagger: state.weaponIds.includes("kitchen-knife"),
        pentagramActive: state.missionProgress["flag:pentagram"] === true, sacrifice: sacrifice === "life" ? "life" : "candles" });
      const ordinaryAvailable = (state.inventory.candle ?? 0) + (state.inventory.candles ?? 0);
      if (blessedMatch && (ordinaryCandles > ordinaryAvailable || blessedCandles > (state.inventory["blessed-candle"] ?? 0))) throw new Error("所选普通／受祝福蜡烛数量不可用");
      if (!ready) throw new Error("Summon Servitor requires the learned skill, Bell, Ritual Dagger, no active Pentagram, and the chosen sacrifice");
      // Absent Mindedness checks the actual ritual tools and the selected
      // candle component(s). A weapon serving as the Ritual Dagger is
      // intentionally exempt from an extra tool die by the source rule.
      if (!checkRitualComponentAvailability(story, state, "bell", dice)) break;
      if (sacrifice !== "life") {
        const chosenCandleKinds: string[] = [];
        if (ordinaryCandles > 0) {
          if ((state.inventory.candles ?? 0) > 0) chosenCandleKinds.push("candles");
          if ((state.inventory.candle ?? 0) > 0) chosenCandleKinds.push("candle");
        }
        if (blessedCandles > 0) chosenCandleKinds.push("blessed-candle");
        let componentsAvailable = true;
        for (const component of chosenCandleKinds) {
          if (!checkRitualComponentAvailability(story, state, component, dice)) { componentsAvailable = false; break; }
        }
        if (state.pending || !componentsAvailable) break;
      }
      const ritual = startServitorRitual({ state: { ...base, servitor: state.servitor }, learned: true,
        hasBell: true, hasRitualDagger: true, pentagramActive: false, sacrifice: sacrifice === "life" ? "life" : "candles", level });
      state.hp = ritual.life;
      if (blessedMatch) {
        let normalToPay = ordinaryCandles;
        for (const id of ["candles", "candle"]) {
          const paid = Math.min(normalToPay, state.inventory[id] ?? 0);
          state.inventory[id] = (state.inventory[id] ?? 0) - paid; normalToPay -= paid;
          if (state.inventory[id] <= 0) delete state.inventory[id];
        }
        state.inventory["blessed-candle"] = (state.inventory["blessed-candle"] ?? 0) - blessedCandles;
        if (state.inventory["blessed-candle"] <= 0) delete state.inventory["blessed-candle"];
      }
      if (!blessedMatch) { state.inventory.candles = ritual.candles; if (!state.inventory.candles) delete state.inventory.candles; }
      state.elapsedTimeBoxes = ritual.elapsedTime;
      if (state.hp <= 0) { state.status = "dead"; appendLog(state, "献祭生命后生命降至0；角色死亡，仪式不再继续。"); break; }
      const magic = servitorRitualCheck(ritual, (state.skills.occultist ?? 0) as 0 | 1 | 2);
      const magicRoll = rollSourceCheck(dice, state, `使魔召唤魔法L${magic.level}`);
      const magicTotal = magicRoll.face === 1 ? 1 : magicRoll.total + magic.bonus;
      const magicSucceeded = magicRoll.face === 6 || (magicRoll.face !== 1 && magicTotal >= magic.level);
      appendLog(state, `召唤魔法检定：${magicRoll.face} => ${magicTotal}（${magicSucceeded ? "成功" : "失败"}）。`);
      let ritualState: ServitorState = { ...ritual, sanity: state.sanity, servitor: state.servitor };
      ritualState = resolveServitorMagic(ritualState, magicSucceeded);
      state.sanity = ritualState.sanity;
      if (!magicSucceeded) { appendLog(state, "召唤失败：失去1点理智；可再次尝试，下一次须重新支付仪式代价。"); if (state.sanity <= 0) state.status = "insane"; break; }
      const will = servitorRitualCheck(ritualState, (state.skills.will ?? 0) as 0 | 1 | 2);
      const willRoll = rollSourceCheck(dice, state, `使魔控制意志L${will.level}`);
      const willTotal = willRoll.face === 1 ? 1 : willRoll.total + will.bonus;
      const willSucceeded = willRoll.face === 6 || (willRoll.face !== 1 && willTotal >= will.level);
      appendLog(state, `使魔控制检定：${willRoll.face} => ${willTotal}（${willSucceeded ? "成功" : "失败"}）。`);
      const controlled = resolveServitorControl(ritualState, willSucceeded);
      state.servitor = controlled.state.servitor;
      if (controlled.hostile) {
        state.combat = { enemyId: "summoned-servitor", count: 1, defeatedCount: 0, enemyLevel: controlled.hostile.level,
          enemyLife: controlled.hostile.life, enemyLives: [controlled.hostile.life], enemyDamage: controlled.hostile.damage,
          playerFirst: false, round: 1, weaponId: state.weaponId, surprise: false, attackDisabled: false,
          hostileServitor: true };
        appendLog(state, `控制失败：L${controlled.hostile.level}使魔（生命${controlled.hostile.life}、伤害1）反噬，无法逃跑。`);
      } else appendLog(state, `控制成功：L${level}使魔加入同行（生命${level}，攻击／防御+${Math.floor(level / 2)}）。`);
      break;
    }
    case "servitor-attack": {
      const combat = state.combat, servitor = state.servitor;
      if (!combat || !combat.playerFirst || !servitor || state.skipNextAttack) throw new Error("使魔当前不能攻击");
      const group = combat.groups?.find(value => value.enemyId === action.target && value.enemyLives.length);
      if (combat.groups?.length && !group) throw new Error("选择一个仍存活的敌群");
      const enemyId = group?.enemyId ?? combat.enemyId;
      if (group) {
        const enemy = def.enemies[enemyId];
        combat.enemyId = enemyId; combat.enemyLives = group.enemyLives; combat.defeatedCount = group.defeatedCount;
        combat.count = group.enemyLives.length; combat.enemyLife = group.enemyLives[0] ?? 0;
        combat.enemyLevel = Math.max(1, enemy.level - (combat.curseApplied?.[enemyId] ?? 0));
        combat.enemyDamage = enemy.damage; combat.damageResource = enemy.damageResource ?? "hp"; combat.defenseContext = enemy.defenseContext;
      }
      const roll = rollExploding(dice, state, "使魔攻击");
      const total = roll.first === 1 ? 1 : roll.total + servitor.attackBonus;
      const hits = roll.first === 1 ? 0 : roll.first === 6 ? Math.max(1, Math.floor(total / combat.enemyLevel))
        : total >= combat.enemyLevel ? Math.floor(total / combat.enemyLevel) : 0;
      const beforeLives = combat.enemyLives.length;
      let damage = hits;
      while (damage > 0 && combat.enemyLives.length) {
        const dealt = Math.min(1, combat.enemyLives[0]); combat.enemyLives[0] -= dealt; damage -= dealt;
        if (combat.enemyLives[0] <= 0) combat.enemyLives.shift();
      }
      const defeatedCount = beforeLives - combat.enemyLives.length;
      if (group) { group.enemyLives = combat.enemyLives; group.defeatedCount += defeatedCount; combat.defeatedCount = group.defeatedCount; }
      combat.count = combat.enemyLives.length; combat.enemyLife = combat.enemyLives[0] ?? 0;
      appendLog(state, `使魔以D6+${servitor.attackBonus}攻击${def.enemies[enemyId]?.label ?? enemyId}：造成${hits}点伤害。`);
      if (combat.count <= 0) {
        const groupsRemain = combat.groups?.some(value => value.enemyLives.length) ?? false;
        if (!groupsRemain) {
          const enemy = def.enemies[enemyId];
          if (enemy && !combat.hostileServitor) awardCombatVictoryXp(def, state, combat, enemyId);
          state.combat = undefined;
          state.combatResult = { enemyId, outcome: "defeated", xpAwarded: combat.xpAwarded };
          consumeNextCombatModifiers(state); drainDeferredTables(story, state, dice);
        }
      }
      if (state.combat) state.combat.playerFirst = false;
      break;
    }
    case "resolve-event": {
      const pending = state.pendingEvent;
      if (!pending || pending.started || pending.eventId !== action.target || pending.visitCount !== state.visitCount) throw new Error("No matching Fear event is ready to resolve");
      const operations = def.eventPrograms[pending.eventId]; if (!operations) throw new Error(`Fear event ${pending.eventId} has no reviewed operations`);
      pending.started = true;
      if (!state.resolvedEvents.includes(pending.eventId)) state.resolvedEvents.push(pending.eventId);
      runOperations(story, state, operations, dice);
      if (!state.pending && !state.combat) drainDeferredTables(story, state, dice);
      if (!state.pending && !state.combat && !state.deferredOperations?.length && !state.deferredTables.length && state.pendingEvent?.eventId === pending.eventId) state.pendingEvent = undefined;
      break;
    }
    case "move": {
      const box = ensureBoxForVisit(state, def, action.target); visitBox(story, state, box, dice); checkAbominationPursuit(story, state, dice); break;
    }
    case "search": {
      const box = currentBox(state);
      if (box.safehouse) throw new Error("Safehouses cannot be searched");
      box.searchesMade = (box.searchesMade ?? 0) + 1;
      const allowance = box.searchesAllowed ?? 1;
      if (box.searchesMade > allowance) throw new Error("This box has no remaining search attempts");
      box.searched = box.searchesMade >= allowance;
      const { face, total: explodedTotal } = rollSourceCheck(dice, state, "搜索检定"); appendLog(state, `搜索: ${face}`); const bonus = Number(state.missionProgress.searchBonus ?? 0); delete state.missionProgress.searchBonus;
      const result = face === 1 ? 1 : Math.min(6, explodedTotal + skillMod(def, state, "search") + bonus);
      const artSchoolClueSearch = state.missionProgress["fear-table:school:art-school-clue-search-box"] === box.id;
      if (artSchoolClueSearch) {
        delete state.missionProgress["fear-table:school:art-school-clue-search-box"];
        if (result === 1) runTable(story, state, def.rules.randomEncounterTable, dice);
        else if (result >= 6) { state.clues++; appendLog(state, "画室搜索成功：获得1条线索。"); }
        else appendLog(state, "画室搜索未成功；没有发现线索。");
      } else if (result === 1) {
        runTable(story, state, def.rules.randomEncounterTable, dice);
        if (Number(state.missionProgress.clinicSearches ?? 0) > 0) {
          if (state.pending) state.deferredTables.push(String(state.missionProgress.clinicFailureTable ?? "slashers"));
          else runTable(story, state, String(state.missionProgress.clinicFailureTable ?? "slashers"), dice);
        }
      }
      else if (result >= 6) {
        if (state.missionProgress["fear-table:school-library:pending-search"] === box.id && state.combatResult?.enemyId === "zombie-child" && state.combatResult.outcome === "defeated") {
          delete state.missionProgress["fear-table:school-library:pending-search"];
          runTable(story, state, "children-stuff", dice);
        } else state.pending = { kind: "search-success", options: ["clue", "useful-item", "random-item"], data: { fourRollsChooseOne: true } };
      }
      else appendLog(state, "搜索没有发现东西。");
      if (Number(state.missionProgress.clinicSearches ?? 0) > 0) {
        if (state.pending) state.missionProgress.clinicSearchPending = true;
        else finishClinicSearch(story, state, dice);
      }
      break;
    }
    case "equip": {
      if (state.combat) throw new Error("Use switch-weapon during combat");
      const weaponId = action.weapon ?? "";
      if (!state.weaponIds.includes(weaponId) || !canWield(def, state, weaponId)) throw new Error("Weapon not owned or unusable with current injuries");
      state.weaponId = weaponId; break;
    }
    case "switch-weapon": {
      const combat = state.combat; if (!combat) throw new Error("No active combat");
      if (!combat.playerFirst) throw new Error("Resolve the enemy's attack first");
      const weaponId = action.weapon ?? "";
      if (!state.weaponIds.includes(weaponId) || !canWield(def, state, weaponId)) throw new Error("Weapon not owned or unusable with current injuries");
      state.weaponId = weaponId; combat.weaponId = weaponId; combat.playerFirst = false;
      appendLog(state, `切换到${def.weapons[weaponId].label}，本回合不攻击。`); break;
    }
    case "attack": {
      const combat = state.combat; if (!combat) throw new Error("No active combat");
      if (!combat.playerFirst) throw new Error("Resolve the enemy's attack first");
      if (state.skipNextAttack) { state.skipNextAttack = false; combat.playerFirst = false; appendLog(state, "双1后果：本次攻击被跳过。"); break; }
      const selectedGroup = combat.groups?.find(group => group.enemyId === action.target);
      if (combat.groups?.length && !selectedGroup) throw new Error("Choose a living enemy group to attack");
      if (selectedGroup) {
        const selectedEnemy = def.enemies[selectedGroup.enemyId];
        combat.enemyId = selectedGroup.enemyId; combat.enemyLives = selectedGroup.enemyLives; combat.defeatedCount = selectedGroup.defeatedCount;
        combat.count = selectedGroup.enemyLives.length; combat.enemyLife = selectedGroup.enemyLives[0] ?? 0;
        combat.enemyLevel = Math.max(1, selectedEnemy.level - (combat.curseApplied?.[selectedGroup.enemyId] ?? 0)); combat.enemyDamage = selectedEnemy.damage;
        combat.damageResource = selectedEnemy.damageResource ?? "hp"; combat.defenseContext = selectedEnemy.defenseContext;
        activateCombatGroup(def, combat, selectedGroup);
        if (combat.familyRule === "kalina") { combat.familyState ??= {}; combat.familyState.attackTarget = selectedGroup.enemyId; }
      }
      const familyEnemyId = combat.familyRule
        ? combat.enemyId
        : combat.enemyId;
      const weapon = def.weapons[state.weaponId]; if (!weapon) throw new Error("Unknown weapon");
      if (!fearFamilyWeaponUsable(state, state.weaponId)) throw new Error("This weapon is broken and cannot be used");
      if (combat.enemyId === "haunted-puppets" && state.missionProgress["flag:puppet-theatre"] === true && state.weaponId === "grenade") throw new Error("Grenades cannot be used in the Puppet Theatre");
      if (combat.weaponId !== state.weaponId) throw new Error("Selected weapon does not match combat state");
      if (action.nonlethal && (state.missionRules?.missionId !== "5" || combat.enemyId !== "coven-witch" || state.weaponId !== "unarmed" || combat.groups?.length))
        throw new Error("Non-lethal capture is only available for a single Coven witch using the unarmed hand-to-hand attack");
      if (combat.specialRule === "tickling-ghost" && !weapon.tags?.includes("magic")) throw new Error("Only a magic weapon can attack the Tickling Ghost");
      const usingHolyBullet = action.holyBulletIndex !== undefined;
      const usingSilver = action.silver === true;
      if (usingHolyBullet && (state.weaponId !== "pistol" || !Number.isInteger(action.holyBulletIndex)
        || action.holyBulletIndex! < 1 || action.holyBulletIndex! > (weapon.attacks ?? 1) || (state.inventory["holy-bullets"] ?? 0) < 1))
        throw new Error("Holy Bullets require a carried bullet and a pistol Attack roll");
      if (action.shots !== undefined && (state.weaponId !== "rifle" || action.shots !== 2)) throw new Error("This weapon cannot make a source-defined two-shot attack");
      const requestedAttacks = action.shots ?? weapon.attacks ?? 1;
      const ammoCost = action.shots === 2 ? 3 : (weapon.ammoPerAttack ?? 1) * requestedAttacks;
      const indexedSilver = action.silverBulletIndex !== undefined;
      if (usingSilver && indexedSilver) throw new Error("Choose either all silver ammunition or a single silver attack roll");
      if (action.silverBulletIndex !== undefined && (!Number.isInteger(action.silverBulletIndex) || action.silverBulletIndex < 1 || action.silverBulletIndex > requestedAttacks)) throw new Error("Silver ammunition must identify an existing Attack roll");
      if (usingHolyBullet && action.silverBulletIndex === action.holyBulletIndex) throw new Error("A single Attack roll cannot use both Holy and silver ammunition");
      const silverShots = usingSilver ? requestedAttacks : indexedSilver ? 1 : 0;
      const holyShots = usingHolyBullet ? 1 : 0;
      const ordinaryShots = requestedAttacks - silverShots - holyShots;
      const ordinaryAmmoCost = action.shots === 2 ? Math.max(0, ammoCost - silverShots - holyShots) : ordinaryShots * (weapon.ammoPerAttack ?? 1);
      const silverAmmoCost = usingSilver ? ammoCost : silverShots;
      if (silverAmmoCost && (!weapon.ammoType || silverAmmoCount(state, state.weaponId) < silverAmmoCost)) throw new Error("Insufficient silver ammunition for this firearm");
      if (weapon.ammoType && (state.ammo[state.weaponId] ?? 0) < ordinaryAmmoCost) throw new Error("Insufficient ordinary ammunition");
      if (weapon.ammoType && ordinaryAmmoCost) state.ammo[state.weaponId] -= ordinaryAmmoCost;
      if (silverAmmoCost) { state.silverAmmo ??= {}; state.silverAmmo[state.weaponId] -= silverAmmoCost; }
      const attackContext = weapon.tags?.includes("ranged") ? "attack-ranged" : "attack-melee";
      const crippledPenalty = (state.weaponId === "rifle" || state.weaponId === "shotgun")
        && state.scars.some(id => def.injuries?.[id]?.flags?.includes("rifle-shotgun-attack-minus-1")) ? -1 : 0;
      const sewerWeaponMod = combat.enemyId === "sewer-rat-horde" && weapon.tags?.includes("ranged")
        ? (state.weaponId === "shotgun" ? 1 : -1) : 0;
      const targetProfile = def.enemies[combat.enemyId];
      if (action.luckRollIndex !== undefined) {
        if (state.luck < 1 || !Number.isInteger(action.luckRollIndex) || action.luckRollIndex < 1 || action.luckRollIndex > requestedAttacks) throw new Error("Luck is unavailable for the selected Attack roll");
        state.luck--;
      }
      const ghostBladeTarget = weapon.tags?.includes("damage-1-vs-other-targets")
        && (def.enemies[combat.enemyId]?.tags?.some(tag => ["ghost", "immaterial", "only-magic-weapons"].includes(tag)) ?? false);
      const baseWeaponDamage = weapon.tags?.includes("damage-1-vs-other-targets") && !ghostBladeTarget ? Math.max(1, weapon.damage - 1) : weapon.damage;
      const undeadBookBonus = state.readBooks.includes("de-masticatione") && def.enemies[combat.enemyId]?.tags?.includes("undead")
        && !def.enemies[combat.enemyId]?.tags?.includes("ghost") ? 1 : 0;
      const dodgePenalty = combat.dodgePenaltyPending ? -1 : 0;
      combat.dodgePenaltyPending = false;
      const modifierBase = (weapon.modifier ?? 0) + skillMod(def, state, "attack") + skillMod(def, state, attackContext) + dodgePenalty
        + creatureSkillMod(def, state, combat.enemyId, "attack") + fearFamilySkillModifier(def, state, familyEnemyId, "attack")
        + undeadBookBonus + crippledPenalty + sewerWeaponMod; let totalDamage = 0; const defeatedBefore = combat.defeatedCount;
      let unarmedRetaliations = 0;
      let holyBulletFled = false;
      for (let attackNo = 0; attackNo < requestedAttacks && combat.enemyLives.length; attackNo++) {
        const holyShot = action.holyBulletIndex === attackNo + 1;
        const silverShot = usingSilver || action.silverBulletIndex === attackNo + 1;
        const attackWeaponTags = silverShot ? [...(weapon.tags ?? []), "silver"] : (weapon.tags ?? []);
        const sourceWeaponMod = (targetProfile?.attackModifiers ?? []).reduce((sum, rule) =>
          sum + (attackWeaponTags.includes(rule.weaponTag) || rule.weaponTag === "projectile" && attackWeaponTags.includes("ranged") ? rule.amount : 0), 0);
        const sourceAttack = applyFearItemSourceCheck(state, { kind: "check", check: "attack", enemyId: combat.enemyId,
          enemyTags: def.enemies[combat.enemyId]?.tags ?? [] }).modifier + consumeFearItemCheckBonus(state, "attack");
        const modifier = modifierBase + fearFamilyAttackModifier(def, state, familyEnemyId, attackWeaponTags) + sourceWeaponMod + sourceAttack;
        const weaponDamage = fearFamilyWeaponDamage(familyEnemyId, attackWeaponTags, def.enemies[combat.enemyId]?.tags ?? [], baseWeaponDamage);
        if (holyShot) {
          state.inventory["holy-bullets"]--; if (!state.inventory["holy-bullets"]) delete state.inventory["holy-bullets"];
        }
        const r = rollExploding(dice, state, `攻击${attackNo + 1}`);
        if (r.first === 1) {
          appendLog(state, "自然掷出1：攻击失败。");
          const effects = runFamilyEvent(story, state, { type: "attack-result", enemyId: combat.enemyId, damage: 0, naturalFace: r.first,
            targetEnemy: combat.familyState?.attackTarget ?? combat.enemyId, targetLifeAfter: combat.enemyLives[0] ?? 0,
            weaponId: state.weaponId, weaponTags: attackWeaponTags, explodedSix: false }, dice);
          void effects;
          continue;
        }
        const luckBonus = action.luckRollIndex === attackNo + 1 ? 1 : 0;
        const total = r.total + modifier + luckBonus;
        if (luckBonus) appendLog(state, "消耗1点幸运：本次攻击+1。");
        const hits = r.first === 6 ? Math.max(1, Math.floor(total / combat.enemyLevel)) : total >= combat.enemyLevel ? Math.floor(total / combat.enemyLevel) : 0;
        const targetEnemy = def.enemies[combat.enemyId];
        const holyTarget = targetEnemy?.tags?.includes("demon") || targetEnemy?.tags?.includes("vampire");
        const perHitDamage = holyShot && holyTarget ? 2 : weaponDamage;
        let pendingDamage = hits * perHitDamage;
        if (combat.specialRule === "night-shadow" && !weapon.tags?.includes("magic") && !weapon.tags?.includes("shadow-only") && !holyShot && r.first !== 6)
          pendingDamage = 0;
        const hitIgnore = targetProfile?.hitIgnoreChance;
        if (pendingDamage > 0 && hitIgnore && !weapon.tags?.includes("magic")) {
          let ignoredHits = 0;
          for (let hit = 0; hit < hits; hit++) {
            const hitRoll = rollSourceChance(dice, state, `${targetEnemy?.label ?? combat.enemyId}命中忽略检定`, hitIgnore[0], hitIgnore[1]).face;
            appendLog(state, `${targetEnemy?.label ?? combat.enemyId}第${hit + 1}次命中忽略检定：${hitRoll}/${hitIgnore[1]}`);
            if (hitRoll <= hitIgnore[0]) ignoredHits++;
          }
          pendingDamage = (hits - ignoredHits) * perHitDamage;
        }
        if (pendingDamage > 0 && targetProfile?.immuneWeaponTags?.some(tag => attackWeaponTags.includes(tag))) {
          appendLog(state, `${targetEnemy?.label ?? combat.enemyId}免疫此类武器的伤害。`);
          pendingDamage = 0;
        }
        if (hits > 0 && attackWeaponTags.includes("unarmed") && targetProfile?.unarmedHitDamage) unarmedRetaliations++;
        if (def.enemies[combat.enemyId]?.tags?.includes("ghost") && !weapon.tags?.includes("magic")) pendingDamage = Math.min(1, pendingDamage);
        const familyBounce = fearFamilyAttackBounceChance(familyEnemyId, attackWeaponTags, state.weaponId);
        const bounce = familyBounce === null ? undefined : familyBounce ?? def.enemies[combat.enemyId]?.attackBounceChance;
        if (pendingDamage > 0 && bounce) {
          const bounceRoll = rollSourceChance(dice, state, `${targetEnemy?.label ?? combat.enemyId}攻击弹开检定`, bounce[0], bounce[1]).face;
          appendLog(state, `${targetEnemy?.label ?? combat.enemyId}坚硬皮肤弹开检定: ${bounceRoll}/${bounce[1]}`);
          if (bounceRoll <= bounce[0]) pendingDamage = 0;
        }
        const damageInflicted = pendingDamage;
        totalDamage += pendingDamage;
        if (combat.specialRule === "pied-piper") {
          if (pendingDamage > 0) {
            combat.damageDealtThisEncounter = (combat.damageDealtThisEncounter ?? 0) + pendingDamage;
            const disappearance = rollSourceChance(dice, state, "魔笛手消失检定", combat.damageDealtThisEncounter).face;
            appendLog(state, `魔笛手承受累计${combat.damageDealtThisEncounter}点伤害，消失检定掷出${disappearance}。`);
            if (disappearance <= combat.damageDealtThisEncounter) combat.enemyLives = [];
            else combat.enemyLives[0] = 1;
          }
        } else {
          const livingBefore = combat.enemyLives.length;
          while (pendingDamage > 0 && combat.enemyLives.length) {
            const dealt = Math.min(pendingDamage, combat.enemyLives[0]); combat.enemyLives[0] -= dealt; pendingDamage -= dealt;
            if (combat.enemyLives[0] <= 0) {
              if (action.nonlethal && combat.enemyId === "coven-witch") combat.capturedWitch = true;
              discardSleepingFront(selectedGroup ?? combat); combat.enemyLives.shift();
            }
          }
          combat.defeatedCount += livingBefore - combat.enemyLives.length;
        }
        runFamilyEvent(story, state, { type: "attack-result", enemyId: combat.enemyId, damage: damageInflicted, naturalFace: r.first,
          targetEnemy: combat.familyState?.attackTarget ?? combat.enemyId, targetLifeAfter: combat.enemyLives[0] ?? 0,
            weaponId: state.weaponId, weaponTags: attackWeaponTags, explodedSix: r.first === 6 }, dice);
        if (holyShot && holyTarget && damageInflicted > 0 && combat.enemyLives[0] > 0) {
          const fleeRoll = rollSourceChance(dice, state, "圣弹驱逐检定", combat.enemyLevel).face;
          appendLog(state, `圣弹伤害恶魔/吸血鬼后逃跑检定：${fleeRoll}；目标L${combat.enemyLevel}。`);
          if (fleeRoll > combat.enemyLevel) {
            discardSleepingFront(selectedGroup ?? combat); combat.enemyLives.shift();
            if (selectedGroup) selectedGroup.enemyLives = combat.enemyLives;
            combat.count = combat.enemyLives.length;
            const moreEnemies = combat.groups?.some(group => group.enemyLives.length) ?? combat.count > 0;
            if (!moreEnemies) {
              runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "fled", defeatedCount: combat.defeatedCount, remainingLife: combat.enemyLives[0] ?? 0 }, dice);
              state.combat = undefined; state.combatResult = { enemyId: combat.enemyId, outcome: "fled" };
              consumeNextCombatModifiers(state); drainDeferredTables(story, state, dice);
            } else holyBulletFled = true;
            appendLog(state, `${targetEnemy.label}因圣弹而逃走。`);
            break;
          }
        }
      }
      if (holyBulletFled) { if (state.combat) state.combat.playerFirst = false; break; }
      if (!state.combat) break;
      combat.count = combat.enemyLives.length; combat.enemyLife = combat.enemyLives[0] ?? 0;
      if (selectedGroup) syncCombatGroup(combat, selectedGroup);
      if (state.missionRules?.missionId === "2" && combat.enemyId === state.missionRules.hunt.targetId
        && combat.enemyLives.length === 0) {
        state.missionRules = transitionFearMission(state.missionRules, { type: "hunt-target-defeated", enemyId: combat.enemyId }).state;
        state.missionProgress.targetDefeated = true;
      }
      if (combat.mirinaCompelled && combat.defeatedCount > defeatedBefore) {
        delete state.missionProgress["flag:rag-doll-influence"];
        combat.mirinaCompelled = false;
        appendLog(state, "Mirina的影响已通过杀死遭遇到的一个人类解除。");
      }
      if (unarmedRetaliations) queueAttackDamage(story, state, Array.from({ length: unarmedRetaliations }, () => targetProfile!.unarmedHitDamage!), "injury", def.rules.maxScars, dice);
      appendLog(state, `攻击造成${totalDamage}点伤害；剩余敌人${combat.count}个。`);
      const enemySpec = def.enemies[combat.enemyId];
      const mayCheckFlee = enemySpec?.specialRule !== "demon-dog" || nearPlaceOfWorship(state);
      if (combat.count > 0 && mayCheckFlee && enemySpec?.fleeAtLife !== undefined && combat.enemyLives[0] <= enemySpec.fleeAtLife && !combat.fleeCheckResolved) {
        combat.fleeCheckResolved = true;
        const [numerator, denominator] = enemySpec.fleeChance ?? [1, 2]; const fleeRoll = rollSourceChance(dice, state, `${enemySpec.label}逃跑检定`, numerator, denominator).face;
        appendLog(state, `${enemySpec.label}逃跑检定: ${fleeRoll}/${denominator}`);
        if (fleeRoll <= numerator) { runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "fled", defeatedCount: combat.defeatedCount, remainingLife: combat.enemyLives[0] ?? 0 }, dice); state.combat = undefined; state.combatResult = { enemyId: combat.enemyId, outcome: "fled" }; delete state.missionProgress["flag:fire-ban"]; delete state.missionProgress["flag:torch-extinguished"]; appendLog(state, `${enemySpec.label}逃走。`); }
      }
      finishDefeatedFearCombat(story, state, combat, dice);
      if (state.combat) combat.playerFirst = false;
      if (state.combat && combat.groups?.length) restorePrimaryCombatGroup(def, combat);
      if (!state.combat && !state.pending) drainDeferredTables(story, state, dice);
      break;
    }
    case "vampire-confront": {
      const combat = state.combat;
      if (!combat || !combat.playerFirst || combat.enemyId !== "undead-6")
        throw new Error("The ordinary Vampire's source confrontation is available only on its investigator turn");
      const symbolId = (state.inventory["holy-symbol"] ?? 0) > 0 ? "holy-symbol" : "silver-crucifix";
      const itemIds = action.target === "both" ? [symbolId, "garlic"] : [action.target ?? ""];
      if (!itemIds.length || itemIds.some(id => !["holy-symbol", "silver-crucifix", "garlic"].includes(id)
        || (state.inventory[id] ?? 0) < 1 || combat.vampireConfrontAttempts?.includes(id)
        || (id === "garlic" && combat.surprise))) throw new Error("The selected Vampire confrontation item is unavailable");
      let fled = false;
      for (const itemId of itemIds) {
        combat.vampireConfrontAttempts ??= [];
        combat.vampireConfrontAttempts.push(itemId);
        if (itemId === "garlic") {
          state.inventory.garlic--;
          if (!state.inventory.garlic) delete state.inventory.garlic;
        }
        const roll = rollSourceChance(dice, state, `普通吸血鬼${itemId === "garlic" ? "大蒜" : "圣徽"}对峙检定`, 3);
        appendLog(state, `普通吸血鬼${itemId === "garlic" ? "大蒜" : "圣徽"}对峙：D6=${roll.face}，3/6（${roll.success ? "驱退" : "未驱退"}）。`);
        fled ||= roll.success;
      }
      if (fled) {
        runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "fled", defeatedCount: combat.defeatedCount, remainingLife: combat.enemyLives[0] ?? 0 }, dice);
        state.combat = undefined;
        state.combatResult = { enemyId: "undead-6", outcome: "fled" };
        delete state.missionProgress["flag:fire-ban"];
        delete state.missionProgress["flag:torch-extinguished"];
        consumeNextCombatModifiers(state);
        appendLog(state, "普通吸血鬼遭遇检定成功：吸血鬼逃离。未获得击败经验。");
        drainDeferredTables(story, state, dice);
      } else {
        combat.playerFirst = false;
        appendLog(state, "普通吸血鬼未被驱退；结束调查员回合。");
      }
      break;
    }
    case "exorcise": {
      if (fearItemSourceBlocksBooksOrRituals(state)) throw new Error("烈酒持续期间不能驱魔");
      const combat = state.combat; if (!combat || !combat.playerFirst) throw new Error("Exorcism is available only on the investigator's turn");
      const targetEnemyId = action.choice && groupForEnemy(combat, action.choice) ? action.choice : combat.enemyId;
      const targetGroup = groupForEnemy(combat, targetEnemyId);
      if (targetGroup) activateCombatGroup(def, combat, targetGroup);
      const enemy = def.enemies[targetEnemyId];
      const vampireTurn = enemy?.tags?.includes("vampire") && ["holy-symbol", "silver-crucifix", "garlic"].includes(action.target ?? "")
        && (state.inventory[action.target ?? ""] ?? 0) > 0
        && (action.target === "garlic" || (state.skills.faith ?? 0) > 0);
      const faithfulTurn = vampireTurn;
      if (!enemy?.tags?.includes("susceptible-exorcism") && combat.specialRule !== "tickling-ghost" && !faithfulTurn) throw new Error("This creature is not marked as susceptible to exorcism");
      const component = action.target ?? "";
      if (faithfulTurn) {
        if (combat.vampireTurnAttempts?.includes(action.target ?? "")) throw new Error("This item has already been used to confront this vampire in the current encounter");
        combat.vampireTurnAttempts ??= [];
        combat.vampireTurnAttempts.push(action.target ?? "");
      } else {
        if (!["holy-water", "incense", "essential-oils"].includes(component) || (state.inventory[component] ?? 0) < 1) throw new Error("Choose one carried Exorcism component");
        if ((state.arcaneSkills.exorcism ?? 0) < 1) throw new Error("The Exorcism Arcane Skill is required");
        if (!checkRitualComponentAvailability(story, state, component, dice)) break;
      }
      const { face, total: explodedTotal } = rollSourceCheck(dice, state, `${faithfulTurn ? "吸血鬼驱退" : "驱魔"}检定`);
      const faithfulModifier = action.target === "garlic" ? 0
        : ["holy-symbol", "silver-crucifix"].includes(action.target ?? "") ? namedSkillMod(def, state, "faith", "faith-exorcism") : exorcismModifier(def, state);
      const total = face === 1 ? 1 : explodedTotal + faithfulModifier;
      let success: boolean;
      if (action.target === "garlic") {
        const result = resolveGarlicAvoidance({ heads: state.inventory.garlic ?? 0, surprised: combat.surprise,
          firstFace: face, rollTotal: total, vampireLevel: combat.enemyLevel });
        if (result.headsSpent) { state.inventory.garlic -= result.headsSpent; if (!state.inventory.garlic) delete state.inventory.garlic; }
        success = result.avoided;
      } else success = face === 6 || (face !== 1 && total >= combat.enemyLevel);
      appendLog(state, `以${def.items?.[action.target ?? ""]?.label ?? action.target}驱退${enemy?.label ?? targetEnemyId} L${combat.enemyLevel}: ${face} => ${total} (${success ? "逃走" : "未逃走"})${action.target === "garlic" ? "；尝试消耗1头大蒜" : ""}`);
      if (success) {
        runFamilyEvent(story, state, { type: "combat-end", enemyId: targetEnemyId, outcome: "fled", defeatedCount: targetGroup?.defeatedCount ?? combat.defeatedCount, remainingLife: targetGroup?.enemyLives[0] ?? combat.enemyLives[0] ?? 0 }, dice);
        if (!faithfulTurn) grantFearXp(state, 1);
        if (targetGroup) {
          targetGroup.enemyLives = [];
          syncCombatGroup(combat, targetGroup);
          if (combat.groups?.some(group => group.enemyLives.length)) {
            restorePrimaryCombatGroup(def, combat);
            combat.playerFirst = false;
            appendLog(state, `${enemy?.label ?? targetEnemyId}已被驱退；其他敌群仍在场。`);
          } else {
            state.combat = undefined; state.combatResult = { enemyId: targetEnemyId, outcome: "fled" };
            consumeNextCombatModifiers(state); drainDeferredTables(story, state, dice);
          }
        } else {
          state.combatResult = { enemyId: targetEnemyId, outcome: "fled" };
          state.combat = undefined;
          consumeNextCombatModifiers(state);
          drainDeferredTables(story, state, dice);
        }
      } else {
        if (targetGroup) { syncCombatGroup(combat, targetGroup); restorePrimaryCombatGroup(def, combat); }
        combat.playerFirst = false;
        if (enemy?.tags?.includes("demon")) combat.cannotDefendNextAttack = true;
      }
      break;
    }
    case "fire-curse": {
      const combat = state.combat, enemyId = action.target ?? "";
      if (!combat || !combat.playerFirst || !state.preparedCurse || !curseMatches(def, state.preparedCurse.target, enemyId) || !curseCanAffect(def, enemyId))
        throw new Error("No prepared Curse matches a living creature on the investigator's turn");
      const group = combat.groups?.find(value => value.enemyId === enemyId && value.enemyLives.length > 0);
      if (combat.groups?.length && !group) throw new Error("The cursed enemy group is no longer present");
      const reduction = state.preparedCurse.reduction;
      combat.curseApplied ??= {};
      combat.curseApplied[enemyId] = reduction;
      combat.enemyId = enemyId;
      combat.enemyLevel = Math.max(1, def.enemies[enemyId].level - reduction);
      if (group) {
        combat.enemyLives = group.enemyLives; combat.defeatedCount = group.defeatedCount;
        combat.count = group.enemyLives.length; combat.enemyLife = group.enemyLives[0] ?? 0;
        combat.enemyDamage = def.enemies[enemyId].damage;
      }
      delete state.preparedCurse;
      appendLog(state, `你发动诅咒：${def.enemies[enemyId].label}在本次遭遇中的等级降低${reduction}（最低L1）。诅咒已消耗；该动作不占用战斗行动。`);
      break;
    }
    case "defend": {
      const combat = state.combat; if (!combat) throw new Error("No active combat");
      if (combat.playerFirst) throw new Error("The enemy has not attacked this round");
      if (combat.groups?.length) {
        for (const group of combat.groups) {
          if (!group.enemyLives.length) continue;
          activateCombatGroup(def, combat, group);
          runFamilyEvent(story, state, { type: "enemy-turn", enemyId: group.enemyId, round: combat.round }, dice);
          syncCombatGroup(combat, group);
          if (!state.combat || state.status !== "active") break;
        }
        restorePrimaryCombatGroup(def, combat);
      } else runFamilyEvent(story, state, { type: "enemy-turn", enemyId: combat.enemyId, round: combat.round }, dice);
      if (!state.combat || state.status !== "active") break;
      const familyAttacks = combat.groups?.length
        ? combat.groups.filter(group => group.enemyLives.length).flatMap(group => fearFamilyEnemyAttacks(group.enemyId, group.familyState) ?? [])
        : fearFamilyEnemyAttacks(combat.enemyId, combat.familyState);
      if (combat.grappled) {
        appendLog(state, "午夜人控制着你的双臂：不掷防御骰，自动承受2点生命伤害。");
        combat.damageTakenThisEncounter = true;
        queueAttackDamage(story, state, [combat.enemyDamage], "injury", def.rules.maxScars, dice);
        combat.playerFirst = true; combat.round++;
        if (state.hp <= 0) state.status = "dead";
        break;
      }
      if (combat.hostileServitor) {
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "defense");
        const hit = face === 1 || (face !== 6 && total < combat.enemyLevel);
        appendLog(state, `失控使魔L${combat.enemyLevel}攻击：防御${face} => ${total}（${hit ? "命中" : "未命中"}）。`);
        if (hit) queueAttackDamage(story, state, [combat.enemyDamage], "injury", def.rules.maxScars, dice);
        combat.playerFirst = true; combat.round++;
        if (state.hp <= 0) state.status = "dead";
        break;
      }
      if (combat.cannotDefendNextAttack) {
        combat.cannotDefendNextAttack = false;
        const attackers = combat.groups?.length
          ? combat.groups.flatMap(group => Array.from({ length: Math.max(0, group.enemyLives.length - (group.sleepingCount ?? 0)) }, () => ({ id: group.enemyId, spec: def.enemies[group.enemyId] })))
          : Array.from({ length: Math.max(0, combat.enemyLives.length - (combat.sleepingCount ?? 0)) }, () => ({ id: combat.enemyId, spec: def.enemies[combat.enemyId] }));
        const automaticDamage = attackers.map(({ spec }) => spec?.damage ?? combat.enemyDamage).filter(amount => amount > 0);
        appendLog(state, "驅魔失敗：本次恶魔攻击无法防御，直接承受攻击伤害。");
        if (automaticDamage.length) queueAttackDamage(story, state, automaticDamage, combat.damageResource === "sanity" ? "insanity" : "injury", combat.damageResource === "sanity" ? def.rules.maxTraumas : def.rules.maxScars, dice);
        combat.playerFirst = true; combat.round++;
        if (state.hp <= 0) state.status = "dead";
        break;
      }
      if (action.luckTarget) {
        if (state.luck < 1) throw new Error("Luck is unavailable for this Defense roll");
        state.luck--;
      }
      let doubleOne = false; const damages: number[] = [], sanityDamages: number[] = [];
      const alreadyKnockedDown = combat.knockedDown === true;
      if (combat.specialRule === "demon-cat") {
        if ((combat.sleepingCount ?? 0) > 0) {
          combat.sleepingCount!--;
          appendLog(state, "恶魔猫仍在沉睡，本回合不进行魔法攻击。");
          combat.playerFirst = true; combat.round++;
          break;
        }
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "magic-save");
        appendLog(state, `恶魔猫L1魔法防御: ${face} => ${total}`);
        if (face === 1 || (face !== 6 && total < 1)) {
          state.hp -= 1;
          resolveEncounterSanityLoss(def, state, 1);
          appendLog(state, "恶魔猫的魔法攻击造成1点生命与1点理智损失。");
        }
        combat.playerFirst = true; combat.round++;
        if (state.hp <= 0) state.status = "dead"; else if (state.sanity <= 0) state.status = "insane";
        break;
      }
      if (combat.specialRule === "tickling-ghost") {
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "搔痒鬼防御检定"); appendLog(state, `搔痒鬼防御骰: ${face}`);
        const luckBonus = action.luckTarget === `${combat.enemyId}:0` ? 1 : 0;
        if (luckBonus) appendLog(state, "消耗1点幸运：本次防御+1。");
        if (face === 1 || (face !== 6 && explodedTotal + skillMod(def, state, "defense") + creatureSkillMod(def, state, combat.enemyId, "defense") + luckBonus < combat.enemyLevel)) {
          const carried = carriedDiscardOptions(def, state, [], [], []);
          if (carried.length) state.pending = { kind: "tickling-theft", options: carried, data: { prompt: "防御失败：选择失去1件携带物品。" } };
          else { state.hp--; appendLog(state, "没有携带物品：冰冷触碰造成1点生命损失。"); }
        }
        combat.playerFirst = true; combat.round++;
        if (state.hp <= 0) state.status = "dead";
        break;
      }
      const familyAttackTargets = new Set(familyAttacks?.map(attack => attack.targetId) ?? []);
      const groups = combat.groups?.length
        ? combat.groups.filter(group => group.enemyLives.length).flatMap(group => {
          const custom = fearFamilyEnemyAttacks(group.enemyId, group.familyState);
          if (custom?.length) return custom.map(({ targetId, count }) => {
            const profile = def.enemies[targetId];
            if (!profile) throw new Error(`Fear family attack references missing enemy profile ${targetId}`);
            return { enemyId: targetId, enemyLives: Array(count).fill(1), defeatedCount: 0, sleepingCount: 0 };
          });
          if (familyAttackTargets.has(group.enemyId)) return [];
          return [group];
        })
        : familyAttacks?.length ? familyAttacks.flatMap(({ targetId, count }) => {
          const profile = def.enemies[targetId];
          if (!profile) throw new Error(`Fear family attack references missing enemy profile ${targetId}`);
          return [{ enemyId: targetId, enemyLives: Array(count).fill(1), defeatedCount: 0, sleepingCount: 0 }];
        }) : [{ enemyId: combat.enemyId, enemyLives: combat.enemyLives, defeatedCount: combat.defeatedCount, sleepingCount: combat.sleepingCount }];
      const familyDamageById = new Map(familyAttacks?.map(attack => [attack.targetId, attack.damage] as const));
      let attackOrdinal = 0;
    for (const group of groups) {
        const trackedGroup = groupForEnemy(combat, group.enemyId);
        if (trackedGroup) activateCombatGroup(def, combat, trackedGroup);
        const enemySpec = def.enemies[group.enemyId];
        for (let i = 0; i < group.enemyLives.length; i++) {
          if (i < (group.sleepingCount ?? 0)) { appendLog(state, `${enemySpec?.label ?? group.enemyId}${i + 1}号仍在沉睡，不进行防御。`); continue; }
          if (enemySpec?.specialRule === "tickling-ghost") {
            const { face, total: explodedTotal } = rollSourceCheck(dice, state, "搔痒鬼防御检定");
            const luckBonus = action.luckTarget === `${group.enemyId}:${i}` ? 1 : 0;
            if (luckBonus) appendLog(state, "消耗1点幸运：本次防御+1。");
            const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "defense") + creatureSkillMod(def, state, group.enemyId, "defense") + fearFamilySkillModifier(def, state, familyOwnerId(def, combat, group.enemyId), "defense") + luckBonus;
            const failed = face === 1 || (face !== 6 && total < Math.max(1, enemySpec.level - (combat.curseApplied?.[group.enemyId] ?? 0)));
            appendLog(state, `搔痒鬼防御骰: ${face} => ${total}`);
            runFamilyEvent(story, state, { type: "defense-result", enemyId: group.enemyId, naturalFace: face, failed, defenderId: group.enemyId }, dice);
            if (failed) {
              const carried = carriedDiscardOptions(def, state, [], [], []);
              if (carried.length) state.pending = { kind: "tickling-theft", options: carried, data: { prompt: "防御失败：选择失去1件携带物品。" } };
              else { state.hp--; appendLog(state, "没有携带物品：冰冷触碰造成1点生命损失。"); }
            }
            if (trackedGroup) syncCombatGroup(combat, trackedGroup);
            if (state.pending) break;
            continue;
          }
          if (enemySpec?.specialRule === "witch-librarian" && combat.firstAttackSpellPending) {
            combat.firstAttackSpellPending = false;
            resolveWitchLibrarianSpell(def, state, dice, "首次攻击");
            if (state.pending) break;
            continue;
          }
          const servitorTarget = !!state.servitor && attackOrdinal++ % 2 === 0;
          const vampireSuck = enemySpec?.specialRule === "vampire-kempir" && rollSourceChance(dice, state, "肯皮尔吸血检定", 4).success;
          if (enemySpec?.specialRule === "vampire-kempir") appendLog(state, `肯皮尔吸血尝试：${vampireSuck ? "发动" : "未发动"}${vampireSuck ? "；本次防御+2" : ""}。`);
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, `${enemySpec?.label ?? group.enemyId}防御检定`);
          const luckBonus = action.luckTarget === `${group.enemyId}:${i}` ? 1 : 0;
          if (luckBonus) appendLog(state, "消耗1点幸运：本次防御+1。");
          const defenderBonus = (servitorTarget && state.servitor ? state.servitor.defenseBonus : 0) + (vampireSuck ? 2 : 0)
            + fearFamilyDefenseModifier(state, combat.groups?.find(value => value.familyRule === "kalina")?.enemyId ?? familyOwnerId(def, combat, combat.enemyId), group.enemyId);
          const defenseSkill = action.skill === "dodge" || action.skill === "agile" ? action.skill : undefined;
          const defenseBonus = defenseSkill ? namedSkillMod(def, state, defenseSkill, "defense") : skillMod(def, state, enemySpec.defenseContext ?? "defense");
          const sourceDefense = enemySpec ? applyFearItemSourceCheck(state, { kind: "check", check: "defense",
            enemyId: group.enemyId, enemyTags: enemySpec.tags ?? [] }).modifier : 0;
          const defenseTotal = face === 1 ? 1 : explodedTotal + defenseBonus
            + (state.readBooks.includes("pigface-biography") && enemySpec.tags?.includes("pigface") ? 1 : 0)
            + creatureSkillMod(def, state, group.enemyId, "defense") + fearFamilySkillModifier(def, state, familyOwnerId(def, combat, combat.enemyId), "defense") + luckBonus + defenderBonus + sourceDefense
            + (group.enemyId === "sewer-rat-horde" && group.enemyLives[0] <= 2 ? 1 : 0)
            - (combat.knockedDown && enemySpec?.specialRule === "demonic-goat" ? 2 : 0);
          appendLog(state, `${enemySpec?.label ?? group.enemyId}${i + 1}攻击防御骰: ${face} => ${defenseTotal}（目标L${Math.max(1, enemySpec.level - (combat.curseApplied?.[group.enemyId] ?? 0))}）`);
          const familyDefense = runFamilyEvent(story, state, { type: "defense-result", enemyId: group.enemyId,
            naturalFace: face, failed: face === 1 || (face !== 6 && defenseTotal < Math.max(1, enemySpec.level - (combat.curseApplied?.[group.enemyId] ?? 0))),
            defenderId: group.enemyId }, dice);
          const familyAutoHit = familyDefense.some(effect => effect.type === "auto-hit");
          const dodgePenalty = dodgePenaltyAfterDefense({ defenseRoll: face, dodgeLevel: Math.min(2, state.skills.dodge ?? 0) as 0 | 1 | 2, defenseSource: defenseSkill === "dodge" ? "dodge" : defenseSkill === "agile" ? "agile" : "other" });
          if (dodgePenalty < 0) { combat.dodgePenaltyPending = true; appendLog(state, "闪避自然掷出1：下一次攻击−1。"); }
          if (face === 1 || familyAutoHit) {
            if (vampireSuck && !servitorTarget) { state.limpingUntilFullHeal = true; appendLog(state, "肯皮尔吸血命中：获得跛行伤势，攻击-1直到生命完全恢复。"); }
            if (enemySpec?.specialRule === "brain-eaters" && enemySpec === def.enemies[combat.enemyId] && combat.enemyLives.length >= 3)
              combat.escapeBlockedUntilReduce = true;
            if (enemySpec?.specialRule === "vampire-vehn" && !servitorTarget) {
              state.vehnCharismaPenalty = true;
              appendLog(state, "Vehn撕裂你的皮肤：Charisma检定-1，直到生命完全恢复。");
            }
            if (enemySpec?.specialRule === "zombie-tiger" && !servitorTarget) applyForcedInjury(story, state, dice);
            else {
            const amount = familyDamageById.get(group.enemyId) ?? enemySpec?.naturalOneDamage ?? enemySpec?.damage ?? combat.enemyDamage;
            if (servitorTarget && state.servitor) {
              const reduced = damageServitor({ life: state.hp, sanity: state.sanity, candles: 0, elapsedTime: state.elapsedTimeBoxes, servitor: state.servitor }, amount);
              state.servitor = reduced.servitor; appendLog(state, `攻击命中使魔：失去${amount}点生命${state.servitor ? `，剩余${state.servitor.life}` : "，使魔消散"}。`);
            } else if (amount > 0) {
              if (enemySpec?.specialRule === "night-shadow") {
                const chill = rollSourceCheck(dice, state, "夜影伤害类型检定").face, toSanity = chill >= 4;
                appendLog(state, `夜影寒冷触碰分配掷骰：${chill}（${toSanity ? "理智" : "生命"}）。`);
                (toSanity ? sanityDamages : damages).push(amount);
              } else if (combat.damageResource === "sanity") sanityDamages.push(amount); else damages.push(amount);
              combat.damageTakenThisEncounter = true;
              if (enemySpec?.specialRule === "demonic-goat") combat.knockedDown = true;
            }
            }
            if (!servitorTarget && enemySpec?.infectionSave?.trigger === "natural-one" && !state.infections?.some(value => value.enemyId === group.enemyId)) {
              const save = enemySpec.infectionSave;
              const { face: infectionFace, total: infectionTotal } = rollSourceCheck(dice, state, `${enemySpec.label}感染豁免`);
              const total = infectionFace === 1 ? 1 : infectionTotal + namedSkillMod(def, state, save.requiredSkill, save.context);
              const success = infectionFace === 6 || (infectionFace !== 1 && total >= save.level);
              appendLog(state, `${enemySpec.label} L${save.level}感染豁免: ${infectionFace} => ${total} (${success ? "成功" : "失败"})`);
              if (!success) {
                installInfection(state, group.enemyId, save.failureDamagePerBox, true);
                appendLog(state, "感染：每穿越一格失去1点生命，直到抵达安全屋或使用急救包治疗。");
              }
            }
            if (rollSourceChance(dice, state, "双1后果检定", 1).success) doubleOne = true;
          }
          else if ((familyAutoHit || face !== 6 && defenseTotal < Math.max(1, enemySpec.level - (combat.curseApplied?.[group.enemyId] ?? 0))) && (familyDamageById.get(group.enemyId) ?? enemySpec.damage) > 0) {
            if (vampireSuck && !servitorTarget) { state.limpingUntilFullHeal = true; appendLog(state, "肯皮尔吸血命中：获得跛行伤势，攻击-1直到生命完全恢复。"); }
            const amount = familyDamageById.get(group.enemyId) ?? enemySpec.damage;
            if (servitorTarget && state.servitor) {
              const reduced = damageServitor({ life: state.hp, sanity: state.sanity, candles: 0, elapsedTime: state.elapsedTimeBoxes, servitor: state.servitor }, amount);
              state.servitor = reduced.servitor; appendLog(state, `攻击命中使魔：失去${amount}点生命${state.servitor ? `，剩余${state.servitor.life}` : "，使魔消散"}。`);
            } else {
              if (enemySpec?.specialRule === "night-shadow") {
                const chill = rollSourceCheck(dice, state, "夜影伤害类型检定").face, toSanity = chill >= 4;
                appendLog(state, `夜影寒冷触碰分配掷骰：${chill}（${toSanity ? "理智" : "生命"}）。`);
                (toSanity ? sanityDamages : damages).push(amount);
              } else if (combat.damageResource === "sanity") sanityDamages.push(amount); else damages.push(amount);
              combat.damageTakenThisEncounter = true;
              if (enemySpec?.specialRule === "demonic-goat") combat.knockedDown = true;
            }
            if (enemySpec.infectionChance && (enemySpec.infectionTrigger ?? "defense-failure") === "defense-failure" && !state.infections?.some(value => value.enemyId === group.enemyId)) {
              const [numerator, denominator] = enemySpec.infectionChance, infectionRoll = rollSourceChance(dice, state, `${enemySpec.label}咬伤感染检定`, numerator, denominator).face;
              appendLog(state, `${enemySpec.label}咬伤感染检定: ${infectionRoll}/${denominator}`);
              if (infectionRoll <= numerator) {
                const loss = enemySpec.infectionDamage ?? 2;
                installInfection(state, group.enemyId, loss);
                appendLog(state, `感染：须在3格内使用急救包中的1点急救值，否则额外损失${loss}点生命。`);
              }
            }
          }
          if (trackedGroup) syncCombatGroup(combat, trackedGroup);
        }
        if (state.pending) break;
      }
      if (damages.length) queueAttackDamage(story, state, damages, "injury", def.rules.maxScars, dice, doubleOne ? "double-one" : undefined);
      if (sanityDamages.length) queueAttackDamage(story, state, sanityDamages, "insanity", def.rules.maxTraumas, dice, doubleOne && !damages.length ? "double-one" : undefined);
      if (damages.length && combat.specialRule === "vampire-vetala") {
        const profile = def.enemies[combat.enemyId];
        const before = combat.enemyLives[0] ?? 0;
        const after = Math.min(profile?.life ?? before, before + damages.length);
        combat.enemyLives[0] = after; combat.enemyLife = after;
        appendLog(state, `Vetala因本次造成伤害恢复${after - before}点生命（上限${profile?.life ?? before}）。`);
      }
      if (!damages.length && !state.log.at(-1)?.includes("首次攻击")) appendLog(state, "所有防御检定成功。");
      else if (doubleOne && !state.pending) state.pending = { kind: "double-one", options: ["take-damage", "skip-attack", ...(state.weaponId !== "unarmed" ? ["destroy-weapon"] : [])] };
      if (combat.specialRule === "zombie-squirrels" && combat.enemyLives.length > 0) combat.hordeLossPending = true;
      if (alreadyKnockedDown && hasLivingGoat(def, combat)) combat.knockedDown = false;
      if (combat.groups?.length) restorePrimaryCombatGroup(def, combat);
      combat.playerFirst = true; combat.round++;
      if (state.hp <= 0) state.status = "dead";
      break;
    }
    case "break-grapple": {
      const combat = state.combat;
      if (!combat?.grappled || !combat.playerFirst || combat.enemyId !== "unique-vampires-6")
        throw new Error("The Midnight Man is not holding the investigator");
      const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "strength-save");
      const success = face === 6 || (face !== 1 && total >= 6);
      appendLog(state, `午夜人L6力量挣脱检定：${face} => ${total}（${success ? "成功" : "失败"}）。`);
      if (success) {
        combat.grappled = false;
        appendLog(state, "挣脱控制：现在可以攻击午夜人。");
      } else {
        combat.damageTakenThisEncounter = true;
        appendLog(state, "仍被午夜人控制：自动承受2点生命伤害。");
        queueAttackDamage(story, state, [combat.enemyDamage], "injury", def.rules.maxScars, dice);
        combat.playerFirst = true; combat.round++;
        if (state.hp <= 0) state.status = "dead";
      }
      break;
    }
    case "stand-up": {
      const combat = state.combat;
      const goatPresent = hasLivingGoat(def, combat);
      if (!combat?.playerFirst || !combat.knockedDown || !goatPresent)
        throw new Error("You can only stand up when knocked down by the Demonic Goat");
      combat.knockedDown = false; combat.playerFirst = false;
      appendLog(state, "花费本回合行动站起来。");
      break;
    }
    case "stay-down": {
      const combat = state.combat;
      const goatPresent = hasLivingGoat(def, combat);
      if (!combat?.playerFirst || !combat.knockedDown || !goatPresent)
        throw new Error("You can only choose to defend while knocked down by the Demonic Goat");
      combat.playerFirst = false;
      appendLog(state, "仍保持倒地并放弃本回合攻击；下一次防御-2。");
      break;
    }
    case "escape": {
      const combat = state.combat; if (!combat) throw new Error("No active combat");
      const familyEscape = runFamilyEvent(story, state, { type: "escape-check", enemyId: combat.enemyId }, dice);
      if (familyEscape.some(effect => effect.type === "escape" && !effect.allowed)) throw new Error("This source-defined creature prevents escape at its current state");
      if (fearFamilyEscapeAllowed(familyOwnerId(def, combat, combat.enemyId), combat.familyState) === false) throw new Error("This source-defined creature prevents escape at its current state");
      if (!combat.playerFirst) throw new Error("Resolve the enemy's attack before attempting to escape");
      if (combat.mirinaCompelled) throw new Error("Mirina's influence forces you to kill the human you encountered before escaping");
      if (combat.escapeBlockedUntilReduce && combat.enemyLives.length > 2) throw new Error("Brain Eaters prevent escape until their number is reduced to two or fewer");
      if (def.enemies[combat.enemyId]?.noEscape || def.enemies[combat.enemyId]?.tags?.includes("no-escape")
        && !(state.missionProgress["flag:serial-killers-casebook-read"] === true && def.enemies[combat.enemyId]?.tags?.includes("slasher")))
        throw new Error("This source-defined enemy encounter does not allow escape");
      if (combat.escapeAfter && (combat.groups?.find(group => group.enemyId === combat.escapeAfter!.enemyId)?.defeatedCount ?? 0) < combat.escapeAfter.defeated)
        throw new Error("This encounter's source-defined escape condition has not been met");
      if (state.traumas.some(id => def.traumas?.[id]?.escapeBelowLife !== undefined && state.hp > def.traumas[id].escapeBelowLife!)) throw new Error("Overconfidence trauma prevents escape at this Life total");
      if (def.enemies[combat.enemyId]?.specialRule === "witch-librarian") resolveWitchLibrarianSpell(def, state, dice, "逃跑时施法");
      if (state.status !== "active") break;
      if (def.enemies[combat.enemyId]?.tags?.includes("zombie-slow") && !combat.groups?.length) {
        const occupied = occupiedBoxOnFlee(combat.enemyId, combat);
        currentBox(state).occupiedEncounter = occupied.snapshot as FearCombat;
        currentBox(state).occupiedBy = [combat.enemyId];
        currentBox(state).searchForbidden = true;
        state.combat = undefined;
        state.combatResult = { enemyId: combat.enemyId, outcome: "escaped" };
        startAbominationPursuit(state, combat.enemyId);
        appendLog(state, "你无伤甩开缓慢僵尸；仍留在当前区域，不获得击败经验。");
        drainDeferredTables(story, state, dice);
        break;
      }
      let bonus = (def.enemies[combat.enemyId]?.escapeModifier ?? 0) + (combat.escapeModifier ?? 0);
      const escapeEnemy = def.enemies[combat.enemyId];
      if (action.choice && escapeEnemy?.escapeBait) {
        if (action.choice === "food" && (escapeEnemy.escapeBait.food ?? 0) > 0 && state.food >= escapeEnemy.escapeBait.food!) state.food -= escapeEnemy.escapeBait.food!;
        else if ((escapeEnemy.escapeBait.itemIds ?? []).includes(action.choice) && (state.inventory[action.choice] ?? 0) > 0) {
          state.inventory[action.choice]--;
          if (!state.inventory[action.choice]) delete state.inventory[action.choice];
        } else throw new Error("The selected escape bait is unavailable");
        bonus += escapeEnemy.escapeBait.bonus;
      }
      if (action.choice === "dog-food" && combat.specialRule === "demon-dog") { state.inventory["dog-food"]--; if (!state.inventory["dog-food"]) delete state.inventory["dog-food"]; bonus += 2; }
      if (action.choice === "dog-toy" && combat.specialRule === "demon-dog") { state.inventory["dog-toy"]--; if (!state.inventory["dog-toy"]) delete state.inventory["dog-toy"]; bonus += 2; }
      if (action.choice === "cat-food") { state.inventory["cat-food"]--; if (!state.inventory["cat-food"]) delete state.inventory["cat-food"]; bonus += 2; }
        const itemEscapeBonus = consumeFearItemCheckBonus(state, "escape");
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "escape") + bonus + itemEscapeBonus; appendLog(state, `逃跑检定: ${face}${bonus + itemEscapeBonus ? `+${bonus + itemEscapeBonus}` : ""} => ${total}`);
      if (face === 6 || (face !== 1 && total >= combat.enemyLevel)) {
        const occupied = occupiedBoxOnFlee(combat.enemyId, combat);
        currentBox(state).occupiedEncounter = occupied.snapshot as FearCombat;
        currentBox(state).occupiedBy = [combat.enemyId];
        currentBox(state).searchForbidden = true;
        runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "escaped", defeatedCount: combat.defeatedCount, remainingLife: combat.enemyLives[0] ?? 0 }, dice);
        state.combat = undefined; state.combatResult = { enemyId: combat.groups?.[0]?.enemyId ?? combat.enemyId, outcome: "escaped",
        groupDefeated: combat.groups?.length ? Object.fromEntries(combat.groups.map(group => [group.enemyId, group.defeatedCount])) : undefined }; delete state.missionProgress["flag:fire-ban"]; delete state.missionProgress["flag:torch-extinguished"]; consumeNextCombatModifiers(state); startAbominationPursuit(state, combat.enemyId); appendLog(state, "逃离战斗。"); drainDeferredTables(story, state, dice); }
      else {
        const loss = combat.groups?.length
          ? combat.groups.reduce((sum, group) => sum + Math.max(0, group.enemyLives.length - (group.sleepingCount ?? 0)) * def.enemies[group.enemyId].damage, 0)
          : combat.enemyDamage * Math.max(0, combat.count - (combat.sleepingCount ?? 0));
        if (combat.damageResource === "sanity") resolveEncounterSanityLoss(def, state, loss);
        else { state.hp -= loss; if (loss > 0) state.lifeLostThisEncounter = true; }
        appendLog(state, "逃跑失败，敌人攻击。"); if (state.hp <= 0) state.status = "dead"; else if (state.sanity <= 0) state.status = "insane";
      }
      break;
    }
    case "choose": {
      const pendingBeforeFamilyChoice = state.pending;
      const familyActionChoice = pendingBeforeFamilyChoice?.kind === "vivina-offer"
        ? `family:vivina-${action.choice}` : action.choice ?? "";
      const actionCombat = state.combat;
      const actionGroup = actionCombat && action.target ? groupForEnemy(actionCombat, action.target) : undefined;
      if (actionCombat && actionGroup) activateCombatGroup(def, actionCombat, actionGroup);
      const familyChoice = handleFearFamilyAction(def, state, familyActionChoice, dice, context => familySkillModifier(def, state, context));
      if (familyChoice.handled) {
        if (actionCombat) {
          const changedGroup = actionGroup ?? groupForEnemy(actionCombat, actionCombat.enemyId);
          if (changedGroup) { syncCombatGroup(actionCombat, changedGroup); restorePrimaryCombatGroup(def, actionCombat); }
        }
        state.pending = undefined;
        if (familyChoice.pending) state.pending = familyChoice.pending;
        if (familyChoice.effects) dispatchFearFamilyEffects(story, state, familyChoice.effects, dice);
        break;
      }
      const pending = state.pending; if (!pending) throw new Error("No pending choice");
      if (!pending.options.includes(action.choice ?? "")) throw new Error("Invalid choice");
      if (pending.kind === "fear-item-before-encounter" || pending.kind === "fear-item-check") {
        const selected = action.choice ?? "continue";
        const savedOperations = (pending.data?.operations ?? (pending.data?.operation ? [pending.data.operation, ...(pending.data?.remaining as FearOperation[] ?? [])] : [])) as FearOperation[];
        const moment = pending.data?.moment as Parameters<typeof fearItemSourceActions>[2] | undefined;
        const itemActions = (pending.data?.itemActions ?? []) as ReturnType<typeof fearItemSourceActions>;
        state.pending = undefined;
        if (selected !== "continue") {
          const option = itemActions.find(value => `item:${value.action.choice}` === selected);
          if (!option || !moment) throw new Error("Saved source item choice is invalid");
          const result = applyFearItemSourceAction(def, state, option.action, dice, moment);
          if (!result.handled) throw new Error("The saved source item is no longer usable");
          applyFearItemEffects(story, state, result.effects);
          const avoided = result.effects.some(effect => effect.type === "avoid-encounter");
          if (avoided) appendLog(state, "食物成功避免此次遭遇；原遭遇前检定与战斗均不执行。");
          else if (!state.combat) {
            // Item use is pre-encounter preparation only; the reveal stays pending so the
            // player can still prepare (or decline) before the Fear check and combat run.
            const refreshedItemActions = fearItemSourceActions(story.fear, state, moment);
            state.pending = { kind: "fear-item-before-encounter",
              options: ["continue", ...refreshedItemActions.map(({ action }) => `item:${action.choice}`)],
              data: { moment, operations: savedOperations, itemActions: refreshedItemActions, enemyId: pending.data?.enemyId } };
          }
        } else {
          if (pending.kind === "fear-item-before-encounter" && typeof pending.data?.enemyId === "string")
            state.missionProgress[`fear:item:encounter-continue:${pending.data.enemyId}`] = true;
          runOperations(story, state, savedOperations, dice);
        }
        break;
      }
      if (pending.kind === "food-to-salt") {
        resolveFearFoodSaltChoice(state, action.choice!, remaining => addFoodAfterSaltChoice(def, state, remaining));
        break;
      }
      if (pending.kind === "worship-symbol-visit") {
        resolveFearWorshipSymbolChoice(state, action.choice!, () => addInventoryItem(story, state, "holy-symbol", 1));
        break;
      }
      if (pending.kind === "random-book-reroll") {
        state.pending = undefined;
        const draw = drawTableEntry(def, "random-books", dice);
        const result = resolveFearRandomObjectBook("computer-printout", () => draw, (book, source) => {
          const before = structuredClone(state.inventory);
          state.missionProgress["fear:book-source-pending"] = source;
          resolveTableEntry(story, state, "random-books", book.roll, book.entry, dice);
          delete state.missionProgress["fear:book-source-pending"];
          for (const [itemId, count] of Object.entries(state.inventory)) {
            if (def.items?.[itemId]?.tags?.includes("book") && count > (before[itemId] ?? 0)) {
              state.bookSources ??= {};
              state.bookSources[itemId] = source;
              break;
            }
          }
          if (state.pending?.kind === "random-book-duplicate") state.pending.data = { ...state.pending.data, acquisitionSource: source };
        });
        if (result.handled && result.status === "reroll-required") state.pending = { kind: "random-book-reroll", options: ["continue"], data: {
          source: result.source, rejectedRoll: result.rejectedRoll,
          prompt: `电脑打印稿的随机书籍表掷出${result.rejectedRoll}；按来源规则重掷2D6。`,
        } };
        break;
      }
      state.pending = undefined;
      if (pending.kind === "fear-hardware-store-pickup") {
        const data = hardwarePickupData(state);
        if (!data) throw new Error("The hardware store lost its saved search results");
        if (action.choice === "leave") {
          saveHardwarePickupData(state, undefined);
          appendLog(state, "你没有从五金店拿取物品。");
        } else {
          const index = Number(action.choice?.slice("take:".length));
          const selected = Number.isInteger(index) ? data.items[index] : undefined;
          if (!action.choice?.startsWith("take:") || !selected) throw new Error("Invalid hardware-store item");
          data.items.splice(index, 1);
          data.awaiting = true; data.discarded = false;
          saveHardwarePickupData(state, data);
          if (def.weapons[selected.itemId]) addWeapon(story, state, selected.itemId, selected.ammo, dice);
          else addInventoryItem(story, state, selected.itemId, 1);
          appendLog(state, `从五金店拿取${resultLabel(def, selected.itemId)}。`);
        }
      } else if (pending.kind === "fear-clown-mask") {
        if (action.choice === "wear") {
          if ((state.inventory["walrus-clown-mask"] ?? 0) < 1) throw new Error("The clown mask is no longer carried");
          state.missionProgress["flag:clownface-worn"] = true;
          appendLog(state, "戴上沃尔勒斯小丑面具，获得CLOWNFACE关键词；魅力检定-1。");
        } else appendLog(state, "你把沃尔勒斯小丑面具收好，没有戴上。");
      } else if (pending.kind === "fear-clown-escape") {
        resolveFearClownEscape(story, state, action.choice as "escape" | "charisma", dice);
      } else if (pending.kind === "fear-clown-defeated") {
        if (action.choice === "unmask") ensureScene(story, state, def.sceneRefs.events[String(pending.data?.eventId ?? "13")]);
        else appendLog(state, "你离开铁路区域，没有揭下面具。");
      } else if (pending.kind === "fear-table-horde") {
        if (action.choice === "fight") startFearTableHorde(story, state, String(pending.data?.tableId), String(pending.data?.enemyId), pending.data?.count as number | string, dice);
        else appendLog(state, "你忽略了这次僵尸遭遇。");
      } else if (pending.kind === "fear-table-horde-reward") {
        const tableId = String(pending.data?.tableId);
        if (tableId === "clinic") {
          if (action.choice === "claim") {
            state.missionProgress["fear-table:clinic:pending-painkiller-table"] = true;
            addInventoryItem(story, state, "first-aid-kit", 1);
            if (!state.pending) finishFearTableRewardContinuation(story, state, dice);
            appendLog(state, "领取1个急救包，并按实用物品表掷D6剂止痛药。");
          } else appendLog(state, "你放弃了诊所奖励。");
        } else if (tableId === "worship") {
          if (action.choice === "sanity") state.sanity = Math.min(state.maxSanity, state.sanity + 1);
          else if (action.choice === "random-objects" || action.choice === "useful-stuff") runTable(story, state, action.choice, dice);
          else throw new Error("Invalid place-of-worship reward");
        } else if (tableId === "farm") {
          const amount = tableRoll("D6", dice);
          if (action.choice === "D6-food") addFood(def, state, amount);
          else if (action.choice === "D6-shotgun-shells") state.ammo.shotgun = (state.ammo.shotgun ?? 0) + amount;
          else throw new Error("Invalid farm reward");
          appendLog(state, `农场奖励D6=${amount}：${action.choice === "D6-food" ? "食物" : "霰弹"}。`);
        }
      } else if (pending.kind === "fear-cultists-negotiation") {
        const count = Number(pending.data?.count ?? 1);
        if (action.choice === "fight") {
          runOperations(story, state, [{ op: "start-combat", enemyId: "possessed-1", count }], dice);
        } else if (action.choice === "negotiate") {
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "charisma");
          const success = face === 6 || (face !== 1 && total >= 5);
          appendLog(state, `邪教徒L5魅力交涉：${face} => ${total}（${success ? "成功" : "失败"}）。`);
          if (!success) runOperations(story, state, [{ op: "start-combat", enemyId: "possessed-1", count }], dice);
          else state.pending = { kind: "fear-cultists-offer", options: (pending.data?.offerable as string[] | undefined) ?? [], data: { count } };
        }
      } else if (pending.kind === "fear-cultists-offer") {
        const offer = action.choice ?? "";
        const count = Number(pending.data?.count ?? 1);
        if (offer === "food") state.food -= count;
        else if (offer.startsWith("book:")) state.inventory[offer.slice(5)]--;
        else if (offer.startsWith("candle:")) state.inventory[offer.slice(7)]--;
        else if (offer.startsWith("magic:")) {
          const id = offer.slice(6);
          if (id === "ghost-blade") removeWeaponInstance(state, id);
          else state.inventory[id]--;
        } else throw new Error("Invalid cultist offering");
        for (const [id, amount] of Object.entries(state.inventory)) if (amount <= 0) delete state.inventory[id];
        appendLog(state, `交出${offer === "food" ? `${count}点食物` : offer.slice(offer.indexOf(":") + 1)}作为祭品，避开邪教徒。`);
      } else if (pending.kind === "fear-sewer-rat") {
        if (action.choice === "fight") runOperations(story, state, [{ op: "start-combat", enemyId: "giant-rat-thing", count: 1 }], dice);
        else if (action.choice?.startsWith("fire:")) {
          const item = action.choice.slice(5);
          if (!(pending.options.includes(action.choice)) || (state.inventory[item] ?? 0) < 1) throw new Error("The chosen fire item is unavailable");
          if (item === "molotov-cocktail") { state.inventory[item]--; if (!state.inventory[item]) delete state.inventory[item]; }
          appendLog(state, "巨鼠怪畏火；你用火避开了这次遭遇。");
        } else if (action.choice === "poison") {
          if ((state.inventory["rat-poison"] ?? 0) < 1 || state.food < 1) throw new Error("Rat poison and 1 Food are required");
          state.inventory["rat-poison"]--; if (!state.inventory["rat-poison"]) delete state.inventory["rat-poison"];
          state.food--; runOperations(story, state, [{ op: "start-combat", enemyId: "giant-rat-thing", count: 1 }], dice);
          if (state.combat) { state.combat.enemyLives[0] = Math.max(0, state.combat.enemyLives[0] - 2); state.combat.enemyLife = state.combat.enemyLives[0]; }
          appendLog(state, "使用一剂鼠药和1点食物，对巨鼠怪造成2点伤害。");
        }
      } else if (pending.kind === "fear-hangman-loot") {
        runTable(story, state, action.choice!, dice);
        const remaining = Number(pending.data?.remaining ?? 0);
        if (remaining > 0) {
          if (state.pending || state.combat) state.missionProgress["fear-table:woods-park:hangman-remaining"] = remaining;
          else { state.pending = { kind: "fear-hangman-corpse", options: ["roll"], data: { remaining } }; resolveFearHangmanCorpse(story, state, dice); }
        }
      } else if (pending.kind === "fear-hangman-corpse") {
        if (action.choice === "roll") resolveFearHangmanCorpse(story, state, dice);
      } else if (pending.kind === "fear-school-library") {
        if (action.choice === "investigate" && rollSourceChance(dice, state, "图书馆搜寻检定", 3).success) {
          const books = tableRoll("D3", dice);
          state.pending = { kind: "fear-librarian-trade", options: ["fight", ...(state.food >= 2 ? ["trade"] : [])], data: { books, prompt: `图书管理员出现；可用每本2点食物交换${books}本书。` } };
        } else appendLog(state, "图书馆没有发现遭遇。");
      } else if (pending.kind === "fear-librarian-trade") {
        if (action.choice === "leave") appendLog(state, "你没有与女巫图书管理员交易。");
        else if (action.choice?.startsWith("food:")) {
          const indices = action.choice.slice(5).split(",").map(Number), candidates = pending.data?.candidates as { roll: number; result: string }[];
          if (!Array.isArray(candidates) || !indices.length || indices.some(index => !Number.isInteger(index) || !candidates[index])) throw new Error("Invalid librarian book selection");
          const cost = indices.length * 2;
          if (state.food < cost) throw new Error("Not enough Food for the librarian's offer");
          state.food -= cost;
          queueFearSchoolBooks(state, indices.map(index => candidates[index]));
        } else if (action.choice?.startsWith("item:")) {
          const [, itemId, encoded] = action.choice.split(":");
          const indices = encoded?.split(",").map(Number) ?? [], candidates = pending.data?.candidates as { roll: number; result: string }[];
          if (!itemId || !Array.isArray(candidates) || !indices.length || indices.some(index => !Number.isInteger(index) || !candidates[index]) || (state.inventory[itemId] ?? 0) < indices.length)
            throw new Error("The selected object or book offer is unavailable");
          state.inventory[itemId] -= indices.length;
          if (!state.inventory[itemId]) delete state.inventory[itemId];
          queueFearSchoolBooks(state, indices.map(index => candidates[index]));
        }
      } else if (pending.kind === "fear-occult-library") {
        const candidates = pending.data?.candidates as { roll: number; result: string }[];
        if (!Array.isArray(candidates) || candidates.length !== 2) throw new Error("The haunted library lost its two pre-rolled books");
        const selected = action.choice === "both" ? candidates : [candidates[Number(action.choice?.slice(5))]];
        if (!selected.length || selected.some(book => !book)) throw new Error("Choose one of the two pre-rolled books or both");
        queueFearSchoolBooks(state, selected);
        if (action.choice === "both") state.missionProgress["modifier:next-combat:level"] = Number(state.missionProgress["modifier:next-combat:level"] ?? 0) + 1;
        state.missionProgress["fear-table:haunted-library:enemy-after-books"] = "demonic-horrors";
      } else if (pending.kind === "vampire-body") {
        const vampireId = String(pending.data?.enemyId ?? "");
        if (action.choice === "stake-body") {
          if (!def.enemies[vampireId]?.tags?.includes("vampire") || (state.inventory.stakes ?? 0) < 1 || !state.weaponIds.includes("hammer"))
            throw new Error("Staking a vampire requires the defeated vampire, one stake, and a carried hammer");
          state.inventory.stakes--;
          if (!state.inventory.stakes) delete state.inventory.stakes;
          delete state.missionProgress[`vampire-return:${vampireId}`];
          state.destroyedVampires ??= [];
          if (!state.destroyedVampires.includes(vampireId)) state.destroyedVampires.push(vampireId);
          appendLog(state, `你用木桩和锤子钉住${def.enemies[vampireId].label}的尸体，阻止其复生。`);
        } else if (action.choice === "leave-body") appendLog(state, "你没有处理吸血鬼尸体；它可能在之后复生。");
        else if (action.choice === "burn-body") {
          if (!pending.options.includes("burn-body") || (state.inventory["molotov-cocktail"] ?? 0) < 1
            || ((state.inventory.matches ?? 0) < 1 && (state.inventory.lighter ?? 0) < 1))
            throw new Error("Burning this vampire body requires the available Molotov adaptation and a lighter or matches");
          state.inventory["molotov-cocktail"]--;
          if (!state.inventory["molotov-cocktail"]) delete state.inventory["molotov-cocktail"];
          delete state.missionProgress[`vampire-return:${vampireId}`];
          state.destroyedVampires ??= [];
          if (!state.destroyedVampires.includes(vampireId)) state.destroyedVampires.push(vampireId);
          appendLog(state, `你使用燃烧瓶和点火工具烧毁${def.enemies[vampireId]?.label ?? "吸血鬼"}尸体（网页适配：燃烧瓶替代原书未提供的燃料罐）；它不会复生。`);
        }
        else throw new Error("Choose whether to stake the vampire body");
      } else if (pending.kind === "vetala-offer") {
        const choice = action.choice!;
        if (choice === "fight") {
          appendLog(state, "你拒绝维塔拉的交易；必须与她战斗。");
        } else if (choice === "offer-food" || choice === "offer-blood") {
          if (choice === "offer-food") {
            if (state.food < 6) throw new Error("维塔拉要求6点食物");
            state.food -= 6;
          } else {
            if (state.hp < 2) throw new Error("生命不足以支付维塔拉要求的2点生命");
            state.hp -= 2;
          }
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "charisma");
          const success = face === 6 || (face !== 1 && total >= 5);
          appendLog(state, `维塔拉交易：L5魅力检定 ${face} => ${total}（${success ? "成功" : "失败"}）。`);
          if (state.hp <= 0) {
            state.status = "dead";
            state.deferredOperations = (state.deferredOperations ?? []).filter(operation => !(operation.op === "start-combat" && operation.enemyId === "unique-vampires-5"));
            state.deferredOperations = [];
            appendLog(state, "支付生命后生命值归零；你倒在维塔拉面前。");
          } else if (success) {
            state.missionProgress["arcane:foretell:used"] = true;
            const { roll, entry } = drawUnexhaustedTableEntry(def, state, def.rules.townExplorationTable, dice);
            state.deferredOperations = (state.deferredOperations ?? []).filter(operation => !(operation.op === "start-combat" && operation.enemyId === "unique-vampires-5"));
            state.pending = { kind: "foretell-result", options: ["use-result", "discard-result"], data: {
              prompt: `维塔拉履约，允许你穿过她所在区域。她预言掷${def.tables[def.rules.townExplorationTable]?.die ?? "2D6"}得到${roll}：“${resultLabel(def, entry.result)}”。可接受此结果，或改变主意。`, roll, entry,
            } };
            appendLog(state, `维塔拉成功预言城镇探索${roll}：“${resultLabel(def, entry.result)}”；本次战斗取消。`);
          } else appendLog(state, "魅力检定失败；按维塔拉的条件必须战斗。");
        } else throw new Error("Invalid Vetala offer");
      } else if (pending.kind === "holy-book-reading") {
        const choice = action.choice!;
        state.readBooks.push("holy-book");
        if (choice === "recover-sanity") {
          state.sanity = Math.min(state.maxSanity, state.sanity + 2);
          appendLog(state, "阅读圣书并恢复2点理智；圣书保留。");
        } else if (choice.startsWith("learn:")) {
          const skillId = choice.slice(6), skill = def.skills[skillId];
          if (!skill || (skillId !== "gate" && skillId !== "demon-slayer") || (state.arcaneSkills[skillId] ?? 0) !== 0 || state.xp < 2)
            throw new Error("The selected Holy Book Arcane Skill is unavailable");
          state.xp -= 2; state.arcaneSkills[skillId] = 1;
          appendLog(state, `阅读圣书并花费2点经验学习${skill.label}；圣书保留。`);
        }
      } else if (pending.kind === "random-book-duplicate") {
        const bookId = action.choice!;
        if (!def.items?.[bookId]?.tags?.includes("book") || state.booksFound?.includes(bookId) || (state.inventory[bookId] ?? 0) > 0)
          throw new Error("The selected book is unavailable or already found this game");
        state.booksFound ??= []; state.booksFound.push(bookId);
        addInventoryItem(story, state, bookId, 1);
        if ((state.inventory[bookId] ?? 0) > 0 && (pending.data?.acquisitionSource === "random-book" || pending.data?.acquisitionSource === "computer-printout")) {
          state.bookSources ??= {};
          state.bookSources[bookId] = pending.data.acquisitionSource;
        }
        appendLog(state, `重复随机书籍结果改为选择${resultLabel(def, bookId)}。`);
      } else if (pending.kind === "carry-capacity") {
        const data = pending.data ?? {};
        if (action.choice === "discard-new" || action.choice === "discard-new-mission-food") {
          const hardware = hardwarePickupData(state);
          if (hardware?.awaiting && action.choice === "discard-new") { hardware.discarded = true; saveHardwarePickupData(state, hardware); }
        }
        else {
          if (action.choice!.startsWith("discard-item:")) {
            const id = action.choice!.slice(13); state.inventory[id] = Math.max(0, (state.inventory[id] ?? 0) - 1);
            if (!state.inventory[id]) delete state.inventory[id];
          } else if (action.choice!.startsWith("discard-weapon:")) {
            const id = action.choice!.slice(15); removeWeaponInstance(state, id);
          }
          if (data.missionFood === true) {
            addMissionFood(story, state, Number(data.remaining ?? 0));
            if (state.missionRules?.food) state.missionRules.food.cargo = state.missionFood;
          }
          else if (typeof data.itemId === "string") addInventoryItem(story, state, data.itemId, Number(data.remaining ?? 1));
          else if (typeof data.weaponId === "string") addWeapon(story, state, data.weaponId, typeof data.ammo === "string" ? data.ammo : undefined, dice);
        }
      } else if (pending.kind === "foretell-result") {
        if (action.choice === "use-result") {
          const roll = Number(pending.data?.roll);
          const entry = pending.data?.entry as FearTableEntry | undefined;
          if (!Number.isInteger(roll) || !entry) throw new Error("Foretell lost its privately stored Town Exploration result");
          state.foretoldTownEntry = { roll, entry };
          appendLog(state, "你接受预言结果；进入下一个新区域时应用该结果，不再重掷城镇探索表。");
        } else if (action.choice === "discard-result") {
          delete state.foretoldTownEntry;
          appendLog(state, "你改变主意，放弃预言结果；仍可前往其他区域。");
        } else throw new Error("Invalid Foretell decision");
      } else if (pending.kind === "mission-witch-find") {
        state.pending = pending;
        resolveMissionFiveFind(story, state, action.choice!, dice);
      } else if (pending.kind === "mission-witch-final-item") {
        const results = pending.data?.results as Array<{ roll: number; entry: FearTableEntry }> | undefined;
        const selected = results?.[Number(action.choice) - 1];
        if (!results || results.length !== 3 || !selected) throw new Error("The Coven's three-result reward is missing");
        finishMissionFiveFinalItem(state, results, selected);
        resolveTableEntry(story, state, String(pending.data?.tableId ?? def.rules.usefulItemTable), selected.roll, selected.entry, dice);
        appendLog(state, `从三次实用物品结果中选择：${resultLabel(def, selected.entry.result)}。摧毁女巫集会任务完成。`);
      } else if (pending.kind === "starting-area") {
        const box = findBox(state, action.choice!); state.currentBoxId = box.id; state.startingBoxId = box.id;
        if (!state.startingBooksRead) {
          for (const [itemId, count] of Object.entries(state.inventory))
            if (count > 0 && def.items?.[itemId]?.tags?.includes("book") && !state.readBooks.includes(itemId)) markBookRead(def, state, itemId, dice);
          state.startingBooksRead = true;
        }
        state.visitCount = 1; box.visited = true; box.visit = 1;
        initializeMissionRules(def, state, dice);
        ensureScene(story, state, def.sceneRefs.entry);
      } else if (pending.kind === "sewer-donation") {
        const enemyId = String(pending.data?.enemyId ?? "sewer-rat-horde");
        const donation = action.choice!;
        if (donation === "donate-food") state.food -= 2;
        else if (donation.startsWith("donate-item:")) {
          const id = donation.slice(12); if ((state.inventory[id] ?? 0) < 1) throw new Error("Donation item is no longer carried");
          state.inventory[id]--; if (!state.inventory[id]) delete state.inventory[id];
        } else if (donation.startsWith("donate-weapon:")) {
          const id = donation.slice(14); if (!removeWeaponInstance(state, id)) throw new Error("Donation weapon is no longer carried");
        }
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "charisma");
        appendLog(state, `下水道幸存者魅力L4：${face} => ${total}`);
        if (face === 6 || (face !== 1 && total >= 4)) {
          addSafehouse(state, def, currentBox(state).id, dice, "before-create-3", 4, 2);
          currentBox(state).entryFoodCost = 1;
          appendLog(state, "幸存者接受了贿赂；该区域成为每次进入需支付1点食物的安全屋。");
        } else if (rollSourceChance(dice, state, "下水道贿赂失败后鼠群遭遇检定", 2).success) runOperations(story, state, [{ op: "start-combat", enemyId, count: 1 }], dice);
        else appendLog(state, "贿赂失败，但鼠群没有出现。");
      } else if (pending.kind === "creation-stats") {
        const match = action.choice!.match(/^life:(\d),sanity:(\d)$/);
        if (match) {
          if (Number(match[1]) + Number(match[2]) !== 3) throw new Error("Invalid Life/Sanity bonus allocation");
          state.hp = state.maxHp = 8 + Number(match[1]); state.sanity = state.maxSanity = 8 + Number(match[2]);
        } else {
          const tables = def.rules.startingEquipmentTables;
          const tableId = action.choice === "extra:random-weapon" ? tables?.randomWeapon
            : action.choice === "extra:random-object" ? tables?.randomObject
              : action.choice === "extra:useful-stuff" ? tables?.usefulItem : undefined;
          if (action.choice === "extra:skill") state.missionProgress["creation:extra-skill"] = true;
          else if (tableId) { state.missionProgress["creation:extra-skill"] = false; state.deferredOperations ??= []; state.deferredOperations.unshift({ op: "roll-table", tableId }); }
          else throw new Error("Invalid creation bonus choice");
        }
        const ids = Object.keys(def.skills).filter(id => def.skills[id].kind !== "arcane").sort();
        if (ids.length < 2) throw new Error("Fear character creation requires at least two defined non-arcane skills");
        const pairs: string[] = [];
        for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push(`${ids[i]}|${ids[j]}`);
        state.pending = { kind: "creation-skills", options: pairs };
      } else if (pending.kind === "creation-skills") {
        const skills = action.choice!.split("|");
        if (skills.length !== 2 || skills.some(id => !def.skills[id] || def.skills[id].kind === "arcane")) throw new Error("Choose exactly two non-arcane skills");
        for (const id of skills) { state.skills[id] = 1; applySkillLevel(def, state, id, 0, 1); grantStartingSkillEquipment(def, state, id, dice); }
        if (state.missionProgress["creation:extra-skill"] === true) {
          state.missionProgress["creation:extra-skill"] = false;
          state.pending = { kind: "creation-bonus-skill", options: Object.keys(def.skills).filter(id => def.skills[id].kind !== "arcane" && !state.skills[id]).sort() };
        } else state.pending = { kind: "starting-area", options: state.mapSheets[0].boxes.map(box => box.id) };
      } else if (pending.kind === "creation-bonus-skill") {
        const skillId = action.choice!;
        const skill = def.skills[skillId];
        if (!skill || skill.kind === "arcane") throw new Error("Choose one defined non-arcane starting Skill");
        state.skills[skillId] = 1; applySkillLevel(def, state, skillId, 0, 1); grantStartingSkillEquipment(def, state, skillId, dice);
        state.pending = { kind: "starting-area", options: state.mapSheets[0].boxes.map(box => box.id) };
      } else if (pending.kind === "table-choice") {
        runTable(story, state, action.choice!, dice);
      } else if (pending.kind === "climb-reward-table") {
        const { entry, roll } = drawTableEntry(def, action.choice!, dice);
        state.pending = { kind: "climb-reward", options: ["climb"], data: {
          tableId: action.choice!, roll, entry,
          level: Number(pending.data?.level ?? 4), skillId: String(pending.data?.skillId ?? "agile"),
        } };
      } else if (pending.kind === "climb-reward") {
        if (action.choice === "leave") appendLog(state, "你放弃攀爬，没有取得危险地点上的物品。");
        else {
          const level = Number(pending.data?.level ?? 4), skillId = String(pending.data?.skillId ?? "agile");
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + namedSkillMod(def, state, skillId, "agility-save");
          const success = face === 6 || (face !== 1 && total >= level);
          appendLog(state, `攀爬L${level}: ${face} => ${total} (${success ? "success" : "failure"})`);
          if (success) {
            const entry = pending.data?.entry as FearTableEntry | undefined;
            if (!entry) throw new Error("Climb reward lost its source table result");
            appendLog(state, `取得${resultLabel(def, entry.result)}。`);
            runOperations(story, state, entry.operations ?? [], dice);
            ensureScene(story, state, entry.scene);
          } else {
            state.hp--; appendLog(state, "攀爬失败：失去1点生命；仍可再次尝试。");
            if (state.hp > 0) state.pending = pending;
          }
        }
      } else if (pending.kind === "source-choice") {
        const choices = pending.data?.choices as Record<string, FearOperation[]> | undefined;
        const effects = choices?.[action.choice!];
        if (!effects) throw new Error("Source choice has no reviewed effect mapping");
        runOperations(story, state, effects, dice);
        if (!state.combat && state.missionProgress["fear:house-rewards:pending"] === true)
          delete state.missionProgress["fear:house-rewards:pending"];
      } else if (pending.kind === "fear-rewards-choice") {
        const row = Number(pending.data?.row), choice = action.choice!;
        if (row === 2) {
          if (choice === "life") state.hp = Math.min(state.maxHp, state.hp + 2);
          else if (choice === "xp") grantFearXp(state, 2);
          else throw new Error("Invalid reward-table 2 choice");
        } else if (row === 3) {
          if (choice === "life-sanity") { state.hp = Math.min(state.maxHp, state.hp + 2); state.sanity = Math.min(state.maxSanity, state.sanity + 1); }
          else if (choice === "xp") grantFearXp(state, 1);
          else throw new Error("Invalid reward-table 3 choice");
        } else if (row === 4) {
          if (choice === "sanity") state.sanity = Math.min(state.maxSanity, state.sanity + 1);
          else if (choice === "xp") grantFearXp(state, 2);
          else {
            const tables = choice === "items-random-random" ? ["random-objects", "random-objects"]
              : choice === "items-random-useful" ? ["random-objects", "useful-stuff"]
                : choice === "items-useful-useful" ? ["useful-stuff", "useful-stuff"] : undefined;
            if (!tables) throw new Error("Invalid reward-table 4 choice");
            state.deferredTables.push(...tables);
          }
        } else if (row === 5) {
          if (choice === "standard") { addFood(def, state, tableRoll("D6", dice)); state.hp = Math.min(state.maxHp, state.hp + 1); state.sanity = Math.min(state.maxSanity, state.sanity + 1); }
          else if (choice === "xp") grantFearXp(state, 2);
          else throw new Error("Invalid reward-table 5 choice");
        } else if (row === 6) {
          if (choice === "restore") { state.hp = state.maxHp; state.sanity = state.maxSanity; }
          else if (choice === "xp") grantFearXp(state, 1);
          else throw new Error("Invalid reward-table 6 choice");
        } else throw new Error("Invalid reward-table choice row");
      } else if (pending.kind === "absent-mindedness-storage") {
        const itemKey = String(pending.data?.itemKey ?? "");
        const box = state.safehouseIds.includes(action.choice!) ? findBox(state, action.choice!) : undefined;
        if (!itemKey.startsWith("item:") || !box?.safehouse) throw new Error("Choose one active Safe House for the unavailable item");
        box.storedItems ??= {}; box.storedItems[itemKey] = (box.storedItems[itemKey] ?? 0) + 1;
        appendLog(state, `心不在焉：${resultLabel(def, String(pending.data?.itemId ?? itemKey.slice(5)))}不可用，已留在所选安全屋。`);
      } else if (pending.kind === "mission-town-adjustment") {
        const delta = Number(action.choice);
        if (delta !== -1 && delta !== 1) throw new Error("Invalid mission Town-table adjustment");
        const tableId = String(pending.data?.tableId ?? "");
        const rawRoll = Number(pending.data?.roll);
        const adjustedRoll = rawRoll + delta;
        const table = def.tables[tableId];
        const selected = table?.entries.find(candidate => {
          const [min, max] = typeof candidate.roll === "number" ? [candidate.roll, candidate.roll] : candidate.roll;
          return adjustedRoll >= min && adjustedRoll <= max
            && ["choose-military-or-clinic", "choose-store-or-street"].includes(candidate.result);
        });
        if (!selected) throw new Error("The chosen adjustment does not reach a Military Installation or Store");
        appendLog(state, `任务4：城镇探索结果调整为${adjustedRoll}，可选择军事设施或商店。`);
        resolveTableEntry(story, state, tableId, adjustedRoll, selected, dice, true);
      } else if (pending.kind === "repeat-check") {
        const data = pending.data as Extract<FearOperation, { op: "repeat-check" }>;
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + sourceCheckSkillMod(def, state, data.context, data.requiredSkill);
        const success = face === 6 || (face !== 1 && total >= data.level);
        appendLog(state, `${data.context} L${data.level}: ${face} => ${total} (${success ? "success" : "failure"})`);
        runOperations(story, state, success ? data.success ?? [] : data.failure ?? [], dice);
        if (!success && state.hp > 0) state.pending = pending;
      } else if (pending.kind === "hell-gate") {
        const data = pending.data as Extract<FearOperation, { op: "hell-gate" }>;
        if (action.choice === "close") {
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + namedSkillMod(def, state, data.skillId, "magic");
          appendLog(state, `关闭地狱之门 L${data.level}: ${face} => ${total}`);
          if (face === 6 || (face !== 1 && total >= data.level)) {
            state.gatesClosed++; state.skipEncounters += data.skipEncounters; state.encounterCurse = 0;
            state.sanity = Math.min(state.maxSanity, state.sanity + data.rewardSanity);
            syncMissionGateClosed(state);
            appendLog(state, "地狱之门已关闭；获得遭遇豁免并恢复理智。");
            if (state.gatesClosed >= def.gates.required) state.status = "won";
          } else { state.encounterCurse = 1; appendLog(state, "未能关闭地狱之门，受到诅咒。"); }
        }
      } else if (pending.kind === "optional-safehouse") {
        if (action.choice === "create") {
          const data = pending.data as { threshold: "after-create-3" | "before-create-3"; restoreLife: number; restoreSanity: number };
          addSafehouse(state, def, currentBox(state).id, dice, data.threshold);
          state.hp = Math.min(state.maxHp, state.hp + data.restoreLife); state.sanity = Math.min(state.maxSanity, state.sanity + data.restoreSanity);
        }
      } else if (pending.kind === "rest-choice") {
        const data = pending.data as { life: number; sanity: number };
        if (action.choice === "life") state.hp = Math.min(state.maxHp, state.hp + data.life);
        else state.sanity = Math.min(state.maxSanity, state.sanity + data.sanity);
      } else if (pending.kind === "choose-reward" || pending.kind === "item-choice") {
        const id = action.choice!;
        if (def.weapons[id]) addWeapon(story, state, id, undefined, dice);
        else addInventoryItem(story, state, id, 1);
      } else if (pending.kind === "discard-source-item") {
        const operation = pending.data as Extract<FearOperation, { op: "discard-choice" }>;
        if (!carriedDiscardOptions(def, state, operation.excludedItemIds, operation.excludedTags, operation.excludedWeaponIds).includes(action.choice!))
          throw new Error("Selected item is excluded or no longer carried");
        const [kind, id] = action.choice!.split(":", 2);
        if (kind === "weapon") {
          removeWeaponInstance(state, id);
        } else {
          state.inventory[id]--; if (state.inventory[id] <= 0) delete state.inventory[id];
        }
      } else if (pending.kind === "farm-choice") {
        if (action.choice === "food") addFood(def, state, tableRoll(String(pending.data?.food), dice));
        else {
          // Farm table #2 (source p48) grants one Search roll, with its own
          // fixed reward list. It is not the ordinary four-item Search table.
          const box = currentBox(state);
          const searchesMade = (box.searchesMade ?? 0) + 1;
          if (searchesMade > (box.searchesAllowed ?? 1)) throw new Error("This area has already used its Search roll");
          box.searchesMade = searchesMade; box.searched = searchesMade >= (box.searchesAllowed ?? 1);
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "废弃农场搜索检定");
          const result = face === 1 ? 1 : Math.min(6, explodedTotal + skillMod(def, state, "search"));
          const success = face === 6 || (face !== 1 && result >= 6);
          appendLog(state, `废弃农场搜索 L6：${face}${face === 1 ? "（自然1失败）" : ` + ${skillMod(def, state, "search")} = ${result}`}（${success ? "成功" : "失败"}）`);
          if (success) state.pending = { kind: "farm-search-loot", options: ["pitchfork", "axe", "salt", "holy-book", "shotgun-shells", "clue"] };
          else if (face === 1) {
            appendLog(state, "搜索掷出自然1：按搜索规则掷随机遭遇表；本次农场搜索已结束。");
            runTable(story, state, def.rules.randomEncounterTable, dice);
          } else appendLog(state, "搜索未发现农场奖励；本次农场搜索已结束。");
        }
      } else if (pending.kind === "farm-search-loot") {
        const reward = action.choice!;
        const labels = { pitchfork: "干草叉", axe: "斧头", salt: "盐", "holy-book": "圣书", "shotgun-shells": "霰弹", clue: "线索" };
        appendLog(state, `从农场搜索中取得${labels[reward as keyof typeof labels]}。`);
        if (reward === "pitchfork" || reward === "axe") addWeapon(story, state, reward, undefined, dice);
        else if (reward === "salt" || reward === "holy-book") addInventoryItem(story, state, reward, reward === "salt" ? tableRoll("D6", dice) : 1);
        else if (reward === "shotgun-shells") state.ammo.shotgun = (state.ammo.shotgun ?? 0) + tableRoll("D3", dice);
        else if (reward === "clue") state.clues++;
      } else if (pending.kind === "farmer-choice") {
        const choice = action.choice!;
        if (/^\d+$/.test(choice)) addFood(def, state, Number(choice));
        else if (choice === "D3") addFood(def, state, tableRoll("D3", dice));
        else runTable(story, state, choice, dice);
      } else if (pending.kind === "research-choice") {
        const data = pending.data as Extract<FearOperation, { op: "conditional-skill-purchase" }>;
        if (action.choice === "study-now" && state.xp >= data.xp) { state.xp -= data.xp; state.arcaneSkills[data.skillId] = 1; }
        else if (action.choice === "carry-notes") state.inventory["mutant-research"] = (state.inventory["mutant-research"] ?? 0) + 1;
        const weaponFound = rollSourceChance(dice, state, "研究搜索武器检定", data.probability[0], data.probability[1]).success;
        if (weaponFound) runOperations(story, state, data.onFind, dice);
        const encounter = rollSourceChance(dice, state, "研究额外遭遇检定", data.extraProbability[0], data.extraProbability[1]).success;
        if (encounter) runTable(story, state, data.extraTable, dice);
      } else if (pending.kind === "clinic-search-choice") {
        if (action.choice === "explore") {
          const data = pending.data as { searches: number; failureTable: string };
          state.missionProgress.clinicSearches = data.searches; state.missionProgress.clinicFailureTable = data.failureTable;
          currentBox(state).searchesAllowed = data.searches; currentBox(state).searchesMade = 0; currentBox(state).searched = false;
        }
      } else if (pending.kind === "loot-result-choice") {
        const outcomes = pending.data?.outcomes as Array<{ roll: number; entry: FearTableEntry }> | undefined;
        const selected = outcomes?.[Number(action.choice) - 1];
        if (!selected) throw new Error("Search loot selection is missing its rolled table outcome");
        resolveTableEntry(story, state, String(pending.data?.tableId), selected.roll, selected.entry, dice);
      } else if (pending.kind === "butcher-pigs") {
        const count = Number(action.choice); if (!Number.isInteger(count) || count < 0) throw new Error("Invalid butcher count");
        for (let index = 0; index < count; index++) addFood(def, state, tableRoll(String(pending.data?.foodEach ?? "D6"), dice));
        if (count) appendLog(state, `将${count}只${def.enemies[String(pending.data?.foodEnemyId)]?.label ?? "猪"}制成食物。`);
      } else if (pending.kind === "tickling-theft" || pending.kind === "pied-piper-loss") {
        if (action.choice === "life") state.hp--;
        else {
          const [kind, id] = action.choice!.split(":", 2);
          if (kind === "weapon") {
            removeWeaponInstance(state, id);
            if (state.combat?.weaponId === id) state.combat.weaponId = state.weaponId;
          }
          else { state.inventory[id] = Math.max(0, (state.inventory[id] ?? 0) - 1); if (!state.inventory[id]) delete state.inventory[id]; }
        }
        if (state.hp <= 0) state.status = "dead";
      } else if (pending.kind === "horde-loss") {
        if (action.choice === "food") state.food = Math.max(0, state.food - 2);
        else if (action.choice?.startsWith("item:")) {
          const id = action.choice.slice(5); if ((state.inventory[id] ?? 0) < 1) throw new Error("The chosen item is no longer carried");
          state.inventory[id]--; if (!state.inventory[id]) delete state.inventory[id];
        } else if (action.choice?.startsWith("weapon:")) {
          const id = action.choice.slice(7); if (!state.weaponIds.includes(id) || isCursedWeapon(def, id)) throw new Error("The chosen weapon cannot be lost");
          removeWeaponInstance(state, id);
        } else throw new Error("Choose one carried item or 2 Food");
        appendLog(state, action.choice === "food" ? "僵尸松鼠群夺走2点食物。" : "僵尸松鼠群夺走了一件携带物品。");
      } else if (pending.kind === "whispering-move") {
        const target = findBox(state, action.choice!); state.missionProgress["flag:whispering-move"] = true;
        visitBox(story, state, target, dice);
        runOperations(story, state, [{ op: "probability", numerator: 2, denominator: 6, success: [{ op: "roll-table", tableId: String(pending.data?.randomEncounterTable ?? "random-encounter") }] }], dice);
      } else if (pending.kind === "whispering-question") {
        if (action.choice === "ask") {
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "charisma");
          const success = face === 6 || (face !== 1 && total >= 5);
          appendLog(state, `低语存在L5魅力检定：${face} => ${total}（${success ? "成功" : "失败"}）。`);
          if (success) { state.clues++; appendLog(state, "你从低语中取得1条线索。"); }
        }
      } else if (pending.kind === "ghost-librarian") {
        const data = pending.data ?? {};
        if (action.choice === "ask") {
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "charisma");
          const success = face === 6 || (face !== 1 && total >= 4);
          appendLog(state, `图书管理员鬼魂L4魅力检定: ${face} => ${total} (${success ? "成功" : "失败"})`);
          if (success) {
            state.clues++; const asked = Number(data.asked ?? 0) + 1;
            if (asked < 3) state.pending = { ...pending, data: { ...data, asked, prompt: `已获得${asked}条线索；可继续提问，最多获得3条。` } };
          } else {
            const books = (data.bookItemIds as string[] ?? []).filter(id => (state.inventory[id] ?? 0) > 0);
            if (books.length) state.pending = { kind: "librarian-book", options: books, data: { prompt: "选择一本书交给图书管理员。" } };
            else state.missionProgress["flag:next-book-vanishes"] = true;
          }
        } else if (action.choice === "exorcise") {
          const components = ["holy-water", "incense", "essential-oils"].filter(id => (state.inventory[id] ?? 0) > 0);
          if (components.length === 1) {
            const id = components[0];
            const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + exorcismModifier(def, state);
            const success = face === 6 || (face !== 1 && total >= 6);
            appendLog(state, `使用${def.items?.[id]?.label ?? id}尝试驱魔L6: ${face} => ${total} (${success ? "成功" : "失败"})`);
            if (success) { state.missionProgress["flag:librarian-ghost-exorcised"] = true; }
          } else if (components.length > 1) state.pending = { kind: "librarian-component", options: components.map(id => `item:${id}`), data: { prompt: "选择驱魔组件。" } };
        }
      } else if (pending.kind === "librarian-component") {
        const id = action.choice!.slice(5);
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + exorcismModifier(def, state);
        const success = face === 6 || (face !== 1 && total >= 6);
        appendLog(state, `使用${def.items?.[id]?.label ?? id}尝试驱魔L6: ${face} => ${total} (${success ? "成功" : "失败"})`);
        if (success) { state.missionProgress["flag:librarian-ghost-exorcised"] = true; }
      } else if (pending.kind === "bright-apparition") {
        if (action.choice?.startsWith("exorcise:")) {
          const id = action.choice.slice("exorcise:".length);
          if (!(pending.data?.components as string[] ?? []).includes(id) || (state.inventory[id] ?? 0) < 1) throw new Error("Exorcism needs an available listed component");
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + exorcismModifier(def, state);
          const success = face === 6 || (face !== 1 && total >= 3);
          appendLog(state, `显灵驱魔L3: ${face} => ${total} (${success ? "成功" : "失败"})`);
          if (success) state.pending = { kind: "apparition-reward", options: ["xp", "clue"], data: { prompt: "显灵的话语带来回报：选择1点经验或1条线索。" } };
        }
      } else if (pending.kind === "apparition-reward") {
        if (action.choice === "xp") grantFearXp(state, 1);
        else if (action.choice === "clue") state.clues++;
      } else if (pending.kind === "mirina") {
        if (action.choice?.startsWith("exorcise:")) {
          const id = action.choice.slice(9);
          if (!(pending.data?.components as string[] ?? []).includes(id) || (state.inventory[id] ?? 0) < 1 || state.missionProgress["flag:rag-doll-influence"] === true)
            throw new Error("Mirina may only be exorcised while unaffected, using one carried component");
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + exorcismModifier(def, state);
          const success = face === 6 || (face !== 1 && total >= 6);
          appendLog(state, `Mirina驱魔L6: ${face} => ${total} (${success ? "成功" : "失败"})`);
          if (success) { state.missionProgress["flag:mirina-exorcised"] = true; delete state.missionProgress["mirina-box-id"]; }
        }
      } else if (pending.kind === "librarian-book") {
        const id = action.choice!; state.inventory[id]--; if (!state.inventory[id]) delete state.inventory[id];
      } else if (pending.kind === "injury-repeat-roll") {
        const tableId = String(pending.data?.tableId ?? "injury");
        const kind = pending.data?.injuryKind === "sanity" ? "sanity" : "life";
        const existing = kind === "life" ? state.scars : state.traumas;
        const result = drawTableEntry(def, tableId, dice);
        appendLog(state, `按来源重掷${TABLE_LABELS[tableId] ?? tableId}：${result.roll} ${resultLabel(def, result.entry.result)}。`);
        if (existing.includes(result.entry.result)) {
          state.pending = { ...pending, data: { ...pending.data, prompt: "结果与已有伤残/精神创伤重复，必须继续重掷。" } };
        } else {
          existing.push(result.entry.result);
          resolveTableEntry(story, state, tableId, result.roll, result.entry, dice);
          if (pending.data?.mode === "prevention") {
            const remaining = Array.isArray(pending.data?.remaining) ? pending.data.remaining.map(Number) : [];
            const followup = typeof pending.data?.followup === "string" ? pending.data.followup : undefined;
            if (remaining.length) queueAttackDamage(story, state, remaining, tableId, def.rules.maxScars, dice, followup);
            else if (followup) state.pending = { kind: followup, options: ["take-damage", "skip-attack", ...(state.weaponId !== "unarmed" ? ["destroy-weapon"] : [])] };
            const whispering = pending.data?.whispering as { enemyId: string; count: number } | undefined;
            if (whispering && state.status === "active" && !state.combat) beginWhisperingCombat(story, state, whispering, dice);
          }
        }
      } else if (pending.kind === "injury-prevention") {
        const kind = pending.data?.injuryKind === "sanity" ? "sanity" : "life";
        const tableId = String(pending.data?.tableId ?? (kind === "life" ? "injury" : "insanity"));
        const remaining = Array.isArray(pending.data?.remaining) ? pending.data.remaining.map(Number) : [];
        const followup = typeof pending.data?.followup === "string" ? pending.data.followup : undefined;
        if (action.choice === "spend-luck") {
          if (kind !== "life" || state.luck < 1) throw new Error("One Luck point is required to prevent one Life damage");
          state.luck--;
          const reduced = Number(pending.data?.amount ?? 0) - 1;
          queueAttackDamage(story, state, [...(reduced > 0 ? [reduced] : []), ...remaining], tableId, def.rules.maxScars, dice, followup);
        } else {
          if (action.choice === "take-loss") {
            if (kind === "life") { state.hp -= Number(pending.data?.amount ?? 0); state.lifeLostThisEncounter = true; }
            else applyEncounterSanityLoss(state, Number(pending.data?.amount ?? 0));
          } else {
            const table = def.tables[tableId]; if (!table) throw new Error(`Missing reviewed Fear prevention table ${tableId}`);
            const existing = kind === "life" ? state.scars : state.traumas; let result = drawTableEntry(def, tableId, dice); let retries = 0;
            while (existing.includes(result.entry.result) && retries++ < 12) result = drawTableEntry(def, tableId, dice);
            if (existing.includes(result.entry.result)) {
              state.pending = { kind: "injury-repeat-roll", options: ["reroll"], data: {
                mode: "prevention", injuryKind: kind, tableId, remaining, followup,
                whispering: pending.data?.whispering,
                prompt: "连续掷出已有伤残/精神创伤；按来源继续重掷。",
              } };
              appendLog(state, `${TABLE_LABELS[tableId] ?? tableId}重复结果连续${retries}次；按来源继续重掷。`);
              break;
            }
            existing.push(result.entry.result);
            resolveTableEntry(story, state, tableId, result.roll, result.entry, dice);
          }
          if (remaining.length) queueAttackDamage(story, state, remaining, tableId, def.rules.maxScars, dice, followup);
          else if (followup) state.pending = { kind: followup, options: ["take-damage", "skip-attack", ...(state.weaponId !== "unarmed" ? ["destroy-weapon"] : [])] };
          const whispering = pending.data?.whispering as { enemyId: string; count: number } | undefined;
          if (whispering && state.status === "active" && !state.combat) beginWhisperingCombat(story, state, whispering, dice);
        }
        if (state.hp <= 0) state.status = "dead"; else if (state.sanity <= 0) state.status = "insane";
      } else if (pending.kind === "double-one") {
        if (action.choice === "take-damage") { state.hp -= 1; state.lifeLostThisEncounter = true; }
        else if (action.choice === "skip-attack") state.skipNextAttack = true;
        else if (action.choice === "destroy-weapon") {
          const destroyed = state.weaponId;
          removeWeaponInstance(state, destroyed);
          if (state.combat) state.combat.weaponId = "unarmed";
        }
      } else if (pending.kind === "search-success") {
        if (action.choice === "clue") state.clues++;
        else if (action.choice === "useful-item") beginSearchLoot(story, state, def.rules.usefulItemTable, dice);
        else if (action.choice === "random-item") beginSearchLoot(story, state, def.rules.randomItemTable, dice);
        else if (def.tables[action.choice!]) beginSearchLoot(story, state, action.choice!, dice);
      } else if (pending.kind === "mission-reward") {
        const mission = def.missions[String(pending.data?.missionId ?? state.missionId)];
        if (!mission) throw new Error("Unknown mission reward source");
        if (action.choice === "xp") grantFearXp(state, Number(pending.data?.xp ?? 0));
        else if (action.choice === "useful-items") state.missionProgress.rewardItemRolls = Number(pending.data?.itemRolls ?? 0);
        else throw new Error("Invalid mission reward");
        state.completedMissions.push(state.missionId); state.previousMissionId = state.missionId; state.missionFinished = true;
        syncMissionFinished(state);
        if (state.gatesClosed >= def.gates.required) state.status = "won";
      }
      if (pending.kind === "kalina-loot") {
        if (action.choice === "useful-item") runTable(story, state, "useful-stuff", dice);
        else if (action.choice === "candles") addInventoryItem(story, state, "candle", tableRoll("D6", dice));
        else throw new Error("Choose one of Kalina's printed reward options");
        appendLog(state, action.choice === "candles" ? "选择掷D6取得蜡烛。" : "选择掷实用物品表取得奖励。");
        break;
      }
      if (!state.pending && state.missionProgress.clinicSearchPending === true) {
        delete state.missionProgress.clinicSearchPending; finishClinicSearch(story, state, dice);
      }
      if (!state.pending) drainDeferredTables(story, state, dice);
      if (state.hp <= 0) state.status = "dead"; break;
    }
    case "rest": {
      throw new Error("Fear safehouse recovery is applied once on each entry; it cannot be repeated by a rest action");
    }
    case "close-gate": {
      if (state.missionProgress.gateHere !== true) throw new Error("There is no revealed hell gate in this area");
      if ((state.arcaneSkills.gate ?? 0) < 1) throw new Error("The Gate Arcane Skill is required to close this hell gate");
      const { face, total: explodedTotal } = rollSourceCheck(dice, state, "关闭地狱之门意志检定");
      const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "willpower"); appendLog(state, `关闭地狱之门: ${face} => ${total}`);
      if (face !== 1 && (face === 6 || total >= def.gates.level)) { state.gatesClosed++; state.missionProgress.gatesClosedThisMission = Number(state.missionProgress.gatesClosedThisMission ?? 0) + 1; state.missionProgress.gateHere = false; state.encounterCurse = 0; syncMissionGateClosed(state); }
      else { state.hp--; state.sanity--; if (state.hp <= 0) state.status = "dead"; else if (state.sanity <= 0) state.status = "insane"; }
      if (state.gatesClosed >= def.gates.required) state.status = "won";
      syncMissionFinished(state);
      break;
    }
    case "end-mission": {
      const mission = def.missions[state.missionId]; if (!mission) throw new Error("Unknown mission");
      if (state.missionFinished) throw new Error("This mission has already ended");
      const p = state.missionProgress;
      const returned = state.currentBoxId === state.startingBoxId || (mission.kind === "hunt-target" && currentBox(state).safehouse);
      if (!returned) throw new Error(mission.kind === "hunt-target" ? "Return to the start or a safehouse to finish" : "Return to the starting area to finish");
      const qualifiedGuns = qualifiedFirearmCount(state);
      const complete = mission.kind === "medical-supplies" ? Math.max(Number(p.medicalSupplies ?? 0), state.inventory["medicine-dose"] ?? 0) >= 3
        : mission.kind === "hunt-target" ? p.targetDefeated === true
        : mission.kind === "bring-food" ? state.missionFood >= Number(p.foodTarget ?? state.missionFoodTarget ?? mission.target ?? Number.MAX_SAFE_INTEGER)
        : mission.kind === "bring-weapons" ? qualifiedGuns >= 1
        : mission.kind === "witches" ? Number(p.witchesResolved ?? 0) >= 5
        : mission.kind === "hell-gates" ? state.gatesClosed > Number(p.gateCountAtStart ?? state.gatesClosed)
        : p.completed === true;
      if (!complete) throw new Error(`Mission ${state.missionId} objective is not complete`);
      if (mission.kind === "bring-weapons" && state.missionRules?.missionId === "4") {
        const returned = transitionFearMission(state.missionRules, {
          type: "mission-return", boxId: state.currentBoxId, safeHouse: currentBox(state).safehouse, qualifyingFirearms: qualifiedGuns,
        });
        if (!returned.handled || !returned.state.finished) throw new Error("Mission 4 firearm return is not complete");
        state.missionRules = returned.state;
        for (const effect of returned.effects) if (effect.type === "resource" && effect.key === "xp") grantFearXp(state, effect.amount);
        state.missionFinished = true;
        if (!state.completedMissions.includes(state.missionId)) state.completedMissions.push(state.missionId);
        state.previousMissionId = state.missionId;
        break;
      }
      if (mission.kind === "hunt-target" || mission.kind === "bring-food") {
        const xp = mission.kind === "hunt-target" ? 5 : 3;
        const itemRolls = mission.kind === "hunt-target" ? 2 : 3;
        state.pending = { kind: "mission-reward", options: ["xp", "useful-items"], data: { missionId: state.missionId, xp, itemRolls } };
      } else {
        const xp = mission.kind === "medical-supplies" ? 3
          : mission.kind === "bring-weapons" ? Math.min(5, qualifiedGuns)
          : mission.kind === "witches" ? Number(p.witchXp ?? 0)
          : mission.reward?.xp ?? 0;
        grantFearXp(state, xp); state.completedMissions.push(state.missionId); state.previousMissionId = state.missionId;
        state.missionFinished = true;
      }
      if (state.gatesClosed >= def.gates.required) state.status = "won";
      syncMissionFinished(state);
      break;
    }
    case "start-mission": {
      if (!state.missionFinished) throw new Error("Finish and return from the current mission first");
      const ids = Object.keys(def.missions);
      if (ids.length < 2) throw new Error("At least two missions are required to continue the campaign");
      const recovered = restoreBetweenMissions(state);
      state.hp = recovered.hp; state.sanity = recovered.sanity;
      state.lifeLostThisEncounter = false; state.firstAidUsedThisEncounter = false;
      let nextId = ids[die(dice) - 1];
      for (let rerolls = 0; nextId === state.previousMissionId && rerolls < 100; rerolls++) nextId = ids[die(dice) - 1];
      if (nextId === state.previousMissionId) throw new Error("Mission table repeatedly selected the previous mission");
      state.missionId = nextId; state.missionFinished = false;
      delete state.missionRules;
      state.missionProgress = { gateCountAtStart: state.gatesClosed, gatesClosedThisMission: 0 };
      state.missionFood = 0;
      state.missionFoodTarget = def.missions[nextId].kind === "bring-food" ? tableRoll("2D6", dice) + 12 : 0;
      if (def.missions[nextId].kind === "hunt-target") {
        const mission = def.missions[nextId]; const tableId = mission.targetTable ?? "slashers";
        state.missionProgress.targetId = mission.target ?? drawTableEntry(def, tableId, dice).entry.result;
        state.missionProgress.targetDefeated = false;
      }
        state.uniqueEventsPlayed = []; state.deferredOperations = []; state.deferredTables = [];
      state.mapSheets = [{ sheet: 1, boxes: newSheet({ mapSheets: [] } as unknown as FearState, def) }];
      const start = state.mapSheets[0].boxes[0]; state.currentBoxId = start.id; state.startingBoxId = start.id; state.visitCount = 0; state.mapLinks = {}; state.safehouseIds = [];
      state.pending = { kind: "starting-area", options: state.mapSheets[0].boxes.map(box => box.id) };
      ensureScene(story, state, def.sceneRefs.missions); break;
    }
    case "learn-skill": {
      if (!action.skill) throw new Error("Skill id required"); const spec = def.skills[action.skill]; if (!spec || spec.kind === "arcane") throw new Error("Unknown non-arcane skill");
      const level = state.skills[action.skill] ?? 0, cost = fearItemSourceSkillLearningCost(state, action.skill, level, spec.xp);
      if (level >= 2 || state.xp < cost) throw new Error("Insufficient XP or skill already expert");
      state.xp -= cost; state.skills[action.skill] = (level + 1) as 1 | 2; applySkillLevel(def, state, action.skill, level, level + 1); break;
    }
    case "learn-arcane": {
      const skillId = action.skill ?? ""; const skill = def.skills[skillId]; const learning = def.arcaneLearning?.[skillId];
      if (!skill || skill.kind !== "arcane" || !learning || fearItemSourceBlocksBooksOrRituals(state) || state.xp < skill.xp) throw new Error("Arcane skill or XP is unavailable");
      const level = state.arcaneSkills[skillId] ?? 0;
      if (level >= (learning.expert ? 2 : 1)) throw new Error("Arcane skill has reached its printed level");
      const alreadyRead = state.readBooks?.includes(action.target ?? "") ?? false;
      const source = learning.sources?.find(item => item.itemId === action.target
        && ((state.inventory[item.itemId] ?? 0) > 0 || alreadyRead)
        && (!item.requiredSkill || (state.skills[item.requiredSkill] ?? state.arcaneSkills[item.requiredSkill] ?? 0) >= (item.requiredSkillLevel ?? 1))
        && (!item.sanityLoss || state.sanity > 0));
      if (skillId === "exorcism" && action.target === "exorcism-book" && !fearItemSourceAllowsExorcismBook(state, skillId, (state.skills.faith ?? 0) > 0))
        throw new Error("The Exorcism book requires the Faith skill");
      const gate = action.target === "hell-gate" && learning.gateAtLocation
        && state.missionProgress.gateHere === true
        && (state.skills[learning.gateAtLocation.requiredSkill] ?? 0) > 0
        && state.clues >= learning.gateAtLocation.clues ? learning.gateAtLocation : undefined;
      const unconditioned = action.target === "unconditioned" && learning.sourceCondition === "not-printed" && level === 0;
      if (!source && !gate && !unconditioned) throw new Error("Arcane learning source or prerequisites are unavailable");
      if (gate && state.clues < gate.clues) throw new Error("Not enough clues at this Hell Gate");
      state.xp -= skill.xp;
      if (gate) state.clues -= gate.clues;
      if (source && !alreadyRead) state.readBooks.push(source.itemId);
      if (source && !alreadyRead && source.sanityLoss === "temporary") state.sanity--;
      else if (source && !alreadyRead && source.sanityLoss === "permanent") { state.maxSanity = Math.max(0, state.maxSanity - 1); state.sanity = Math.min(state.sanity - 1, state.maxSanity); }
      state.arcaneSkills[skillId] = (level + 1) as 1 | 2;
      let elapsed = 0;
      const timeBoxes = gate ? (gate.timeBoxes ?? 0) : source && alreadyRead ? 0 : learning.timeBoxes;
      if (timeBoxes === "D3") { elapsed = tableRoll("D3", dice); state.elapsedTimeBoxes += elapsed; }
      const timeMessage = elapsed ? `，耗时${elapsed}个时间格（累计${state.elapsedTimeBoxes}）` : "";
      appendLog(state, `学习${skill.label}，支付${skill.xp}点经验${gate ? `和${gate.clues}条线索` : ""}${timeMessage}。地图位置与跨区计数不变。`);
      if (state.sanity <= 0) state.status = "insane";
      break;
    }
    case "cast-arcane": {
      const skillId = action.skill ?? "";
      if (fearItemSourceBlocksBooksOrRituals(state)) throw new Error("烈酒持续期间不能进行仪式");
      if ((state.arcaneSkills[skillId] ?? 0) < 1) throw new Error("The Arcane Skill is not learned");
      if (skillId === "energy-of-the-macrocosmos") {
        if (state.missionProgress["arcane:energy:used"] === true || (state.inventory.incense ?? 0) < 1) throw new Error("Energy ritual is unavailable or already used this mission");
        if (!checkRitualComponentAvailability(story, state, "incense", dice)) break;
        if (action.target === "food" && state.food >= 2) state.food -= 2;
        else if ((action.target === "candle" || action.target === "candles" || action.target === "blessed-candle") && (state.inventory[action.target] ?? 0) > 0) {
          state.inventory[action.target]--; if (!state.inventory[action.target]) delete state.inventory[action.target];
        } else throw new Error("Choose one candle or two Food as the printed sacrifice");
        state.missionProgress["arcane:energy:used"] = true;
        state.elapsedTimeBoxes += 2; const gained = tableRoll("D6", dice); state.luck += gained;
        appendLog(state, `宏观宇宙之力仪式耗时2个时间格，获得${gained}点幸运。`);
      } else if (skillId === "healing") {
        const candle = action.target ?? "";
        if (state.missionProgress["arcane:healing:used"] === true || state.hp >= state.maxHp || state.food < 1
          || (state.inventory["holy-book"] ?? 0) < 1 || !["candle", "candles", "blessed-candle"].includes(candle) || (state.inventory[candle] ?? 0) < 1)
          throw new Error("Healing ritual requires Food, Holy Book, a candle sacrifice, missing Life, and an unused mission use");
        if (!checkRitualComponentAvailability(story, state, "food", dice)
          || !checkRitualComponentAvailability(story, state, "holy-book", dice)) break;
        state.food--; state.inventory[candle]--; if (!state.inventory[candle]) delete state.inventory[candle];
        state.hp = Math.min(state.maxHp, state.hp + 4); state.missionProgress["arcane:healing:used"] = true;
        appendLog(state, "治疗仪式献祭1点食物和1支蜡烛，恢复最多4点生命。");
      } else if (skillId === "curse") {
        const target = action.target ?? "";
        const fireStarter = (state.inventory.lighter ?? 0) > 0 ? "lighter" : "matches";
        const category = target.startsWith("category:") ? target.slice(9) : undefined;
        const specific = target.startsWith("specific:") ? target.slice(9) : undefined;
        const targetExists = specific ? Boolean(def.enemies[specific])
          : category && Object.hasOwn(CURSE_CATEGORY_LABELS, category)
            ? Object.entries(def.enemies).some(([id, enemy]) => (enemy.tags?.includes(category) ?? false) || id.includes(category)) : false;
        const candles = (state.inventory.candle ?? 0) + (state.inventory.candles ?? 0) + (state.inventory["blessed-candle"] ?? 0);
        const bonePowder = state.inventory["bone-powder"] ?? 0;
        if (state.preparedCurse || (!state.inventory.lighter && !state.inventory.matches) || !bonePowder || !candles || !targetExists)
          throw new Error("Curse requires a target, lighter or matches, one candle, bone powder, and no other prepared Curse");
        let hasFireStarter = checkRitualComponentAvailability(story, state, fireStarter, dice);
        if (!hasFireStarter && fireStarter === "lighter" && (state.inventory.matches ?? 0) > 0 && !state.pending)
          hasFireStarter = checkRitualComponentAvailability(story, state, "matches", dice);
        if (!hasFireStarter) break;
        let toPay = 1;
        for (const id of ["candle", "candles", "blessed-candle"]) {
          const paid = Math.min(toPay, state.inventory[id] ?? 0); state.inventory[id] -= paid; toPay -= paid;
          if (state.inventory[id] <= 0) delete state.inventory[id];
        }
        state.inventory["bone-powder"]--; if (!state.inventory["bone-powder"]) delete state.inventory["bone-powder"];
        state.preparedCurse = { target, reduction: specific ? 2 : 1 };
        appendLog(state, `你准备了针对${specific ? def.enemies[specific].label : CURSE_CATEGORY_LABELS[category!] ?? category}的诅咒。符合目标的遭遇中可发动，不消耗战斗行动；也可保留以后使用。`);
      } else if (skillId === "foretell") {
        const candle = action.target ?? "";
        if (state.missionProgress["arcane:foretell:used"] === true || (state.inventory["black-mirror"] ?? 0) < 1
          || !["candle", "candles", "blessed-candle"].includes(candle) || (state.inventory[candle] ?? 0) < 1
          || state.combat || state.pending || !state.currentBoxId)
          throw new Error("Foretell requires its learned skill, Black Mirror, one candle, and an unresolved use this mission");
        if (!checkRitualComponentAvailability(story, state, "black-mirror", dice)) break;
        state.inventory[candle]--; if (!state.inventory[candle]) delete state.inventory[candle];
        state.missionProgress["arcane:foretell:used"] = true;
        const { roll, entry } = drawUnexhaustedTableEntry(def, state, def.rules.townExplorationTable, dice);
        const tableDice = def.tables[def.rules.townExplorationTable]?.die ?? "D6";
        state.pending = { kind: "foretell-result", options: ["use-result", "discard-result"], data: {
          prompt: `你已掷${tableDice}，城镇探索结果为${roll}：“${resultLabel(def, entry.result)}”。你可以接受，或改变主意前往其他区域。`,
          roll, entry,
        } };
        appendLog(state, `你献祭1支蜡烛，预言掷${tableDice}得到城镇探索${roll}：“${resultLabel(def, entry.result)}”。可接受或放弃；黑镜未消耗。`);
      } else if (skillId === "pentagram") {
        if (action.target === "break") {
          if (state.missionProgress["flag:pentagram"] !== true) throw new Error("There is no active Pentagram to break");
          delete state.missionProgress["flag:pentagram"];
          appendLog(state, "你打破身上的五芒星；之后仍可再次施放，但需要另献祭7支蜡烛。");
        } else {
          const candleCount = (state.inventory.candle ?? 0) + (state.inventory.candles ?? 0) + (state.inventory["blessed-candle"] ?? 0);
          if (state.missionProgress["flag:pentagram"] === true || (state.inventory["art-materials"] ?? 0) < 1
            || ((state.inventory["ritual-dagger"] ?? 0) < 1 && !state.weaponIds.includes("kitchen-knife")) || candleCount < 7)
            throw new Error("Pentagram requires Art Materials, Ritual Dagger, seven candles, and no active Pentagram");
          if (!checkRitualComponentAvailability(story, state, "art-materials", dice)
            || (!state.weaponIds.includes("kitchen-knife") && !checkRitualComponentAvailability(story, state, "ritual-dagger", dice))) break;
          let toPay = 7;
          for (const id of ["candle", "candles", "blessed-candle"]) {
            const paid = Math.min(toPay, state.inventory[id] ?? 0); state.inventory[id] -= paid; toPay -= paid;
            if (state.inventory[id] <= 0) delete state.inventory[id];
          }
          state.missionProgress["flag:pentagram"] = true;
          appendLog(state, "你献祭7支蜡烛施放五芒星；本任务内对恶魔的防御检定+1。");
        }
      } else throw new Error(`No reviewed casting procedure for ${skillId}`);
      break;
    }
    case "craft-silver": {
      if (state.combat) throw new Error("Silver ammunition and weapon crafting is only available outside combat");
      const material = action.target ?? ""; const output = action.choice ?? "";
      if ((state.inventory[material] ?? 0) < 1) throw new Error("The selected silver item is no longer carried");
      const consumeMaterial = () => { state.inventory[material]--; if (!state.inventory[material]) delete state.inventory[material]; };
      if (output === "shotgun-shell") {
        if (!(material === "silver-ring" || material === "silver-necklace") || (state.ammo.shotgun ?? 0) < 1)
          throw new Error("One silver ring or necklace and one ordinary shotgun shell are required");
        state.ammo.shotgun--; consumeMaterial(); state.silverAmmo ??= {}; state.silverAmmo.shotgun = (state.silverAmmo.shotgun ?? 0) + 1;
        appendLog(state, `将${def.items?.[material]?.label ?? material}装入1发霰弹，制成银弹；消耗1发普通霰弹，不需冶炼工具。`);
        break;
      }
      if ((state.inventory["smelting-tools"] ?? 0) < 1) throw new Error("Smelting this silver item requires carried smelting equipment");
      if (output === "silver-knife") {
        if (material !== "silver-crucifix") throw new Error("Only the source Church silver crucifix can be made into a silver knife");
        consumeMaterial(); addWeapon(story, state, "silver-knife");
        appendLog(state, "消耗银十字架与冶炼工具（工具保留）制成银刀；网页适配：继承普通刀数值，仅增加银制属性。查看Faith组件时，已熔掉的十字架不再可用。");
        break;
      }
      const caliber = output.startsWith("bullets:") ? output.slice("bullets:".length) : "";
      if (!SILVER_FIREARMS.includes(caliber as typeof SILVER_FIREARMS[number])) throw new Error("Choose a supported silver-ammunition firearm type");
      const yieldExpression: Record<string, string> = { "silver-necklace": "D3", "silver-crescent": "2", "silver-ring": "1", "silver-crucifix": "2D6" };
      const yieldDice = yieldExpression[material];
      if (!yieldDice) throw new Error("This silver item has no source-defined smelting yield");
      const made = tableRoll(yieldDice, dice);
      consumeMaterial(); state.silverAmmo ??= {}; state.silverAmmo[caliber] = (state.silverAmmo[caliber] ?? 0) + made;
      appendLog(state, `冶炼${def.items?.[material]?.label ?? material}，制成${made}发${def.weapons[caliber]?.label ?? caliber}口径银弹；冶炼工具保留。网页适配：制作时选择弹药口径。`);
      break;
    }
    case "use-item": {
      const id = action.target ?? "";
      if (id.startsWith("source-")) {
        if (id === "source-food" && carriedFood(def, state) >= carriedFoodLimit(def, state))
          throw new Error("There is no remaining Food carrying capacity");
        let moment: Parameters<typeof applyFearItemSourceAction>[4] = { kind: "menu" };
        if (id === "source-item-bonus") {
          const checks = ["charisma", "escape", "stealth", "attack", "defense"] as const;
          const found = checks.map(check => ({ check, moment: { kind: "check" as const, check,
            enemyId: state.combat?.enemyId, enemyTags: state.combat ? def.enemies[state.combat.enemyId]?.tags ?? [] : [] } }))
            .find(value => fearItemSourceActions(def, state, value.moment).some(option => option.action.choice === action.choice));
          if (!found) throw new Error("The source item is not available for this check");
          moment = found.moment;
        } else if (id === "source-spray-can") {
          const enemyId = action.choice ?? state.combat?.enemyId ?? "";
          moment = { kind: "combat-item", enemyId, enemyTags: def.enemies[enemyId]?.tags ?? [] };
        }
        const result = applyFearItemSourceAction(def, state, action, dice, moment);
        if (!result.handled) throw new Error("The selected source item is no longer available");
        applyFearItemEffects(story, state, result.effects);
        if (id === "source-spray-can" && state.combat) {
          const combat = state.combat;
          finishDefeatedFearCombat(story, state, combat, dice);
          if (state.combat) {
            combat.playerFirst = false;
            if (combat.groups?.length) restorePrimaryCombatGroup(def, combat);
          } else if (!state.pending) drainDeferredTables(story, state, dice);
        }
        break;
      }
      if (id === "first-aid") {
        const context = { hasKit: (state.inventory["first-aid-kit"] ?? 0) > 0,
          charges: state.inventory["first-aid-charges"] ?? 0, lifeLostThisEncounter: state.lifeLostThisEncounter ? 1 : 0,
          currentLife: state.hp, maxLife: state.maxHp, medicLevel: Math.min(2, state.skills.medic ?? 0) as 0 | 1 | 2 };
        if (state.combat || state.firstAidUsedThisEncounter) throw new Error("First Aid may be used only once after a qualifying encounter");
        const resolved = resolveFirstAid(context, action.amount ?? 0);
        state.inventory["first-aid-charges"] -= resolved.chargesSpent;
        state.hp = Math.min(state.maxHp, state.hp + resolved.heal);
        state.firstAidUsedThisEncounter = true; state.lifeLostThisEncounter = false;
        appendLog(state, `急救包：消耗${resolved.chargesSpent}点急救值，恢复${resolved.heal}点生命。`);
        break;
      }
      if (id === "hand-of-glory") {
        const combat = state.combat, enemyId = action.choice ?? combat?.enemyId ?? "", enemy = def.enemies[enemyId];
        if (!combat?.playerFirst || combat.count !== 1 || combat.groups?.length || (state.inventory["hand-of-glory"] ?? 0) < 1
          || combat.enemyId !== enemyId || !enemy?.tags?.includes("human")
          || enemy.tags.some(tag => ["undead", "zombie", "unique-zombie", "demon", "lab-horror"].includes(tag)))
          throw new Error("Hand of Glory requires one eligible mortal encounter and an unused, constructed Hand");
        state.inventory["hand-of-glory"]--; if (!state.inventory["hand-of-glory"]) delete state.inventory["hand-of-glory"];
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "will-save");
        const success = face === 6 || (face !== 1 && total >= 5);
        appendLog(state, `荣耀之手L5意志检定: ${face} => ${total}（${success ? "成功" : "失败"}）`);
        if (!success) { state.sanity--; appendLog(state, "意志检定失败：失去1点理智。"); }
        if (enemyId === "coven-witch" && state.missionRules?.missionId === "5") {
          const witchId = String(state.missionProgress["witch-active-box"] ?? "");
          if (!witchId) throw new Error("Mission witch combat lost its map-box identity");
          resolveMissionWitch(story, state, witchId, true, dice);
        }
        runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "escaped", defeatedCount: combat.defeatedCount, remainingLife: combat.enemyLives[0] ?? 0 }, dice);
        state.combat = undefined; state.combatResult = { enemyId, outcome: enemyId === "coven-witch" && state.missionRules?.missionId === "5" ? "captured" : "escaped" };
        consumeNextCombatModifiers(state);
        if (state.hp <= 0) state.status = "dead"; else if (state.sanity <= 0) state.status = "insane";
        if (state.status === "active" && !state.pending) drainDeferredTables(story, state, dice);
        break;
      }
      if (id === "treat-infection") {
        if (state.combat || !state.infections?.length || (state.inventory["first-aid-kit"] ?? 0) < 1 || (state.inventory["first-aid-charges"] ?? 0) < 1)
          throw new Error("Treating infection requires a carried, charged first-aid kit outside combat");
        state.inventory["first-aid-charges"]--;
        state.infections = [];
        appendLog(state, "消耗1点急救值治疗咬伤感染。");
        break;
      }
      if (id === "read-book") {
        if (fearItemSourceBlocksBooksOrRituals(state)) throw new Error("烈酒持续期间不能研读书籍");
        const bookId = action.choice ?? "";
        if ((state.inventory[bookId] ?? 0) < 1 || !def.items?.[bookId]?.tags?.includes("book") || state.readBooks.includes(bookId))
          throw new Error("That book is not carried or has already been read");
        markBookRead(def, state, bookId, dice);
        break;
      }
      if (id === "hypnos-spell") {
        const combat = state.combat;
        if (!combat || !combat.playerFirst || state.hypnosUsed) throw new Error("The Hypnos spell is unavailable now");
        const targetId = action.choice ?? combat.enemyId;
        const group = combat.groups?.find(value => value.enemyId === targetId && value.enemyLives.length > 0);
        const lives = group?.enemyLives ?? combat.enemyLives;
        const enemy = def.enemies[targetId];
        if (!lives.length || !isHypnosEligible(def, targetId)) throw new Error("Hypnos requires one living, non-Undead, non-Artificial, non-animated-doll target");
        if (!state.hypnosLearned) {
          if ((state.inventory["book-of-hypnos"] ?? 0) < 1 || state.xp < 1) throw new Error("Learning the Hypnos spell requires the book and 1 XP");
          state.xp--; state.hypnosLearned = true; appendLog(state, "消耗1点经验，通过《催眠术之书》学会催眠术。");
        }
        const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "magic");
        const success = face === 6 || (face !== 1 && total >= enemy.level);
        appendLog(state, `催眠术对抗${enemy.label} L${enemy.level}：${face} => ${total}（${success ? "成功" : "失败"}）。`);
        if (success) {
          state.hypnosUsed = true;
          if (state.missionRules?.missionId === "5" && targetId === "coven-witch") {
            const witchId = String(state.missionProgress["witch-active-box"] ?? "");
            if (!witchId) throw new Error("Mission witch combat lost its map-box identity");
            resolveMissionWitch(story, state, witchId, true, dice);
            state.combat = undefined;
            state.combatResult = { enemyId: targetId, outcome: "captured" };
            consumeNextCombatModifiers(state);
            if (!state.pending) drainDeferredTables(story, state, dice);
            break;
          }
          if (group) group.sleepingCount = Math.min(group.enemyLives.length, (group.sleepingCount ?? 0) + 1);
          else combat.sleepingCount = Math.min(combat.enemyLives.length, (combat.sleepingCount ?? 0) + 1);
          appendLog(state, `${enemy.label}陷入沉睡；它仍存活且可被攻击。`);
        }
        combat.playerFirst = false;
        break;
      }
      if (id === "blob-salt") {
        const combat = state.combat;
        const targetId = action.choice ?? "lab-horrors-1";
        const group = combat?.groups?.find(value => value.enemyId === targetId && value.enemyLives.length);
        const lives = group?.enemyLives ?? combat?.enemyLives;
        if (!combat?.playerFirst || !state.readBooks.includes("blob-experiment") || targetId !== "lab-horrors-1"
          || !lives?.length || ((state.inventory.salt ?? 0) < 1 && state.food < 1)) throw new Error("Salt requires the read Blob Experiment, carried salt or Food, and a living Blob on your turn");
        lives[0] = Math.max(0, lives[0] - 2);
        if (lives[0] <= 0) { lives.shift(); if (group) group.defeatedCount++; else combat.defeatedCount++; }
        if (group) {
          group.enemyLives = lives; combat.enemyId = targetId; combat.enemyLives = lives;
          combat.defeatedCount = group.defeatedCount; combat.enemyLife = lives[0] ?? 0; combat.count = lives.length;
        } else { combat.enemyLife = lives[0] ?? 0; combat.count = lives.length; }
        appendLog(state, "向黏液怪撒盐，自动造成2点伤害；没有消耗盐或食物（原文未列消耗）。");
        const remains = combat.groups?.some(value => value.enemyLives.length) ?? combat.count > 0;
        if (!remains) {
          awardCombatVictoryXp(def, state, combat, targetId);
          runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "defeated", defeatedCount: combat.defeatedCount, remainingLife: 0 }, dice);
          state.combat = undefined; state.combatResult = { enemyId: targetId, outcome: "defeated", xpAwarded: combat.xpAwarded,
            groupDefeated: combat.groups?.length ? Object.fromEntries(combat.groups.map(value => [value.enemyId, value.defeatedCount])) : undefined };
          consumeNextCombatModifiers(state); drainDeferredTables(story, state, dice);
      } else combat.playerFirst = false;
        break;
      }
      if ((state.inventory[id] ?? 0) < 1) throw new Error("Item unavailable");
      if (id === "molotov-cocktail" && state.missionProgress["flag:fire-ban"] === true) throw new Error("The special-event wind forbids using a Molotov until the next encounter ends");
      if ((id === "torch" || id === "candles") && (state.missionProgress["flag:fire-ban"] === true || state.missionProgress["flag:torch-extinguished"] === true)) throw new Error("The wind has put out carried fire sources until the next encounter ends");
      if (state.combat) {
        if (id === "molotov-cocktail" && action.choice !== "puppet-theatre") {
          const combat = state.combat;
          const targetId = action.choice ?? combat.enemyId;
          const targetGroup = combat.groups?.find(value => value.enemyId === targetId && value.enemyLives.length > 0);
          if (!combat.playerFirst || state.missionProgress["flag:fire-ban"] === true
            || ((state.inventory.lighter ?? 0) < 1 && (state.inventory.matches ?? 0) < 1)
            || !def.enemies[targetId] || def.enemies[targetId].specialRule === "tickling-ghost"
            || (combat.groups?.length && !targetGroup))
            throw new Error("A Molotov requires a living target, a lighter or matches, and the investigator's turn");
          if ((state.inventory["molotov-cocktail"] ?? 0) < 1) throw new Error("No Molotov cocktail is available");
          state.inventory["molotov-cocktail"]--;
          if (!state.inventory["molotov-cocktail"]) delete state.inventory["molotov-cocktail"];
          if (targetGroup) {
            activateCombatGroup(def, combat, targetGroup);
            combat.familyState ??= {};
            combat.familyState.attackTarget = targetId;
          }
          const enemy = def.enemies[targetId];
          if (enemy.tags?.includes("zombie")) {
            const lives = targetGroup?.enemyLives ?? combat.enemyLives;
            lives.shift();
            if (targetGroup) { targetGroup.enemyLives = lives; targetGroup.defeatedCount++; syncCombatGroup(combat, targetGroup); }
            else { combat.defeatedCount++; combat.enemyLives = lives; combat.count = lives.length; combat.enemyLife = lives[0] ?? 0; }
            appendLog(state, `燃烧瓶自动摧毁1只${enemy.label}；没有进行攻击检定。`);
          } else {
            const roll = rollExploding(dice, state, "燃烧瓶攻击");
            const weapon = def.weapons["molotov-cocktail"];
            const context = weapon?.tags?.includes("ranged") ? "attack-ranged" : "attack-melee";
            const modifier = 2 + skillMod(def, state, "attack") + skillMod(def, state, context)
              + creatureSkillMod(def, state, targetId, "attack") + fearFamilySkillModifier(def, state, targetId, "attack")
              + fearFamilyAttackModifier(def, state, targetId, [...(weapon?.tags ?? []), "fire"])
              + (weapon?.modifier ?? 0);
            const total = roll.first === 1 ? 1 : roll.total + modifier;
            const hits = roll.first === 1 ? 0 : roll.first === 6
              ? Math.max(1, Math.floor(total / combat.enemyLevel))
              : total >= combat.enemyLevel ? Math.floor(total / combat.enemyLevel) : 0;
            let damage = hits * (weapon?.damage ?? 1);
            if (damage > 0 && enemy.immuneWeaponTags?.some(tag => [...(weapon?.tags ?? []), "fire", "molotov"].includes(tag))) {
              damage = 0;
              appendLog(state, `${enemy.label}免疫燃烧瓶伤害。`);
            }
            const bounce = fearFamilyAttackBounceChance(targetId, [...(weapon?.tags ?? []), "fire"], "molotov-cocktail");
            const bounceChance = bounce === null ? undefined : bounce ?? enemy.attackBounceChance;
            if (damage > 0 && bounceChance) {
              const bounced = rollSourceChance(dice, state, `${enemy.label}燃烧瓶攻击弹开检定`, bounceChance[0], bounceChance[1]).face;
              appendLog(state, `${enemy.label}燃烧瓶攻击弹开检定：${bounced}/${bounceChance[1]}`);
              if (bounced <= bounceChance[0]) damage = 0;
            }
            const lives = targetGroup?.enemyLives ?? combat.enemyLives;
            let remainingDamage = damage;
            const beforeCount = lives.length;
            while (remainingDamage > 0 && lives.length) {
              const applied = Math.min(remainingDamage, lives[0]); lives[0] -= applied; remainingDamage -= applied;
              if (lives[0] <= 0) { discardSleepingFront(targetGroup ?? combat); lives.shift(); }
            }
            const defeated = beforeCount - lives.length;
            if (targetGroup) { targetGroup.enemyLives = lives; targetGroup.defeatedCount += defeated; syncCombatGroup(combat, targetGroup); }
            else { combat.enemyLives = lives; combat.defeatedCount += defeated; combat.count = lives.length; combat.enemyLife = lives[0] ?? 0; }
            runFamilyEvent(story, state, { type: "attack-result", enemyId: targetId, damage, naturalFace: roll.first,
              targetEnemy: targetId, targetLifeAfter: lives[0] ?? 0, weaponId: "molotov-cocktail", weaponTags: [...(weapon?.tags ?? []), "fire"],
              explodedSix: roll.first === 6 }, dice);
            appendLog(state, `燃烧瓶火焰攻击：${roll.first === 1 ? "自然1，攻击失败" : `${total} 对抗L${combat.enemyLevel}`}；造成${damage}点伤害。`);
            if (defeated > 0 && enemy.tags?.includes("vampire")) {
              state.destroyedVampires ??= [];
              if (!state.destroyedVampires.includes(targetId)) state.destroyedVampires.push(targetId);
              delete state.missionProgress[`vampire-return:${targetId}`];
              appendLog(state, `${enemy.label}被火焰永久摧毁，不能复生。`);
            }
          }
          const anyRemain = combat.groups?.some(group => group.enemyLives.length) ?? combat.enemyLives.length > 0;
          const currentTargetRemain = targetGroup ? targetGroup.enemyLives.length > 0 : combat.enemyLives.length > 0;
          if (!anyRemain) {
            awardCombatVictoryXp(def, state, combat, targetId);
            runFamilyEvent(story, state, { type: "combat-end", enemyId: targetId, outcome: "defeated", defeatedCount: targetGroup?.defeatedCount ?? combat.defeatedCount, remainingLife: 0 }, dice);
            if (def.enemies[targetId]?.tags?.some(tag => ["unique", "killer", "unique-boss"].includes(tag))) state.defeated.push(targetId);
            const resultEnemyId = combat.groups?.[0]?.enemyId ?? targetId;
            state.combat = undefined;
            state.combatResult = { enemyId: resultEnemyId, outcome: "defeated", xpAwarded: combat.xpAwarded,
              groupDefeated: combat.groups?.length ? Object.fromEntries(combat.groups.map(group => [group.enemyId, group.defeatedCount])) : undefined };
            delete state.missionProgress["flag:fire-ban"]; delete state.missionProgress["flag:torch-extinguished"];
            consumeNextCombatModifiers(state); drainDeferredTables(story, state, dice);
          } else {
            if (!currentTargetRemain && state.missionRules?.missionId === "2" && state.missionRules.hunt.targetId === targetId)
              state.missionRules = transitionFearMission(state.missionRules, { type: "hunt-target-defeated", enemyId: targetId }).state;
            combat.playerFirst = false;
            if (combat.groups?.length) restorePrimaryCombatGroup(def, combat);
          }
          break;
        }
        if (id === "molotov-cocktail" && action.choice === "puppet-theatre") {
          const combat = state.combat;
          if (combat.enemyId !== "haunted-puppets" || state.missionProgress["flag:puppet-theatre"] !== true
            || !combat.playerFirst || (state.inventory["molotov-cocktail"] ?? 0) < 1 || combat.enemyLives.length === 0)
            throw new Error("Molotov is only available during the Puppet Theatre fight");
          if ((state.inventory.lighter ?? 0) < 1 && (state.inventory.matches ?? 0) < 1) throw new Error("A Molotov requires a lighter or matches");
          state.inventory["molotov-cocktail"]--;
          if (state.inventory["molotov-cocktail"] <= 0) delete state.inventory["molotov-cocktail"];
          const roll = rollExploding(dice, state, "燃烧瓶攻击");
          const total = roll.first === 1 ? 1 : roll.total + skillMod(def, state, "attack") + skillMod(def, state, "attack-melee");
          const hits = roll.first === 1 ? 0 : roll.first === 6 ? Math.max(1, Math.floor(total / combat.enemyLevel)) : total >= combat.enemyLevel ? Math.floor(total / combat.enemyLevel) : 0;
          const damage = hits * (def.weapons["molotov-cocktail"]?.damage ?? 1);
          if (damage > 0) combat.enemyLives[0] = Math.max(0, combat.enemyLives[0] - damage);
          state.hp--;
          appendLog(state, `木偶剧场燃烧瓶攻击：${total} 对抗L${combat.enemyLevel}，造成${damage}点火焰伤害；你失去1点生命。`);
          if (state.hp <= 0) state.status = "dead";
          if (combat.enemyLives[0] <= 0) {
            combat.enemyLives.shift(); combat.defeatedCount++; awardCombatVictoryXp(def, state, combat, combat.enemyId);
            runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "defeated", defeatedCount: combat.defeatedCount, remainingLife: 0 }, dice);
            state.combat = undefined; state.combatResult = { enemyId: "haunted-puppets", outcome: "defeated", xpAwarded: combat.xpAwarded };
            delete state.missionProgress["flag:puppet-theatre"]; consumeNextCombatModifiers(state); drainDeferredTables(story, state, dice);
          } else { combat.enemyLife = combat.enemyLives[0]; combat.count = combat.enemyLives.length; combat.playerFirst = false; }
          break;
        }
        if (id === "hell-chain") {
          const combat = state.combat;
          if (!combat.playerFirst || (state.hellChainHits ?? 0) >= 6) throw new Error("Hell Chain is exhausted or can only be used on the investigator's turn");
          const targetId = action.choice ?? combat.enemyId;
          const group = combat.groups?.find(value => value.enemyId === targetId && value.enemyLives.length > 0);
          if (combat.groups?.length && !group) throw new Error("Choose a living target group for the Hell Chain");
          const { face, total: explodedTotal } = rollSourceCheck(dice, state, "D6检定"); const total = face === 1 ? 1 : explodedTotal + skillMod(def, state, "will-save");
          const saved = face === 6 || (face !== 1 && total >= 5);
          appendLog(state, `地狱锁链L5意志检定: ${face} => ${total} (${saved ? "成功" : "失败"})`);
          if (!saved) { state.sanity--; appendLog(state, "意志检定失败：失去1点理智。"); }
          state.hellChainHits = (state.hellChainHits ?? 0) + 1;
          const enemy = def.enemies[targetId];
          const lives = group?.enemyLives ?? combat.enemyLives;
          if (!lives.length) throw new Error("Hell Chain target has no living members");
          lives[0] = Math.max(0, lives[0] - 1);
          if (lives[0] <= 0) {
            discardSleepingFront(group ?? combat); lives.shift();
            if (group) group.defeatedCount++;
            else combat.defeatedCount++;
          }
          if (group) {
            group.enemyLives = lives; combat.enemyId = targetId; combat.enemyLives = lives;
            combat.defeatedCount = group.defeatedCount; combat.enemyLife = lives[0] ?? 0; combat.count = lives.length;
          } else { combat.enemyLife = lives[0] ?? 0; combat.count = lives.length; }
          if (state.hellChainHits >= 6) {
            delete state.inventory["hell-chain"];
            appendLog(state, "地狱锁链累计命中6次后化为锈迹与干涸血迹。");
          } else appendLog(state, `地狱锁链自动造成1点伤害（累计${state.hellChainHits}/6）。`);
          const remains = combat.groups?.some(value => value.enemyLives.length) ?? combat.count > 0;
          if (!remains) {
            awardCombatVictoryXp(def, state, combat, targetId);
            runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "defeated", defeatedCount: combat.defeatedCount, remainingLife: 0 }, dice);
            state.combat = undefined; state.combatResult = { enemyId: targetId, outcome: "defeated", xpAwarded: combat.xpAwarded,
              groupDefeated: combat.groups?.length ? Object.fromEntries(combat.groups.map(value => [value.enemyId, value.defeatedCount])) : undefined };
            consumeNextCombatModifiers(state); drainDeferredTables(story, state, dice);
      } else combat.playerFirst = false;
          break;
        }
        if (id === "holy-water") {
          const combat = state.combat;
          if (!combat.playerFirst) throw new Error("Holy water can only be thrown on the investigator's turn");
          const targetId = action.choice ?? combat.enemyId;
          const group = combat.groups?.find(value => value.enemyId === targetId && value.enemyLives.length > 0);
          if (combat.groups?.length && !group) throw new Error("Choose a living enemy group for the holy water");
          const enemy = def.enemies[targetId];
          const eligible = enemy?.tags?.includes("susceptible-holy-water")
            || enemy?.tags?.includes("demon")
            || (enemy?.tags?.includes("undead") && !enemy.tags.includes("zombie") && !enemy.tags.includes("ghost"));
          if (!eligible) throw new Error("Holy water only affects demons and non-zombie undead");
          state.inventory[id]--;
          if (state.inventory[id] <= 0) delete state.inventory[id];
          const damageAmount = enemy.holyWaterDamage ?? 2;
          if (group) {
            let damage = damageAmount;
            while (damage > 0 && group.enemyLives.length) {
              const dealt = Math.min(damage, group.enemyLives[0]);
              group.enemyLives[0] -= dealt; damage -= dealt;
              if (group.enemyLives[0] <= 0) { discardSleepingFront(group); group.enemyLives.shift(); group.defeatedCount++; }
            }
            combat.enemyId = targetId; combat.enemyLives = group.enemyLives; combat.defeatedCount = group.defeatedCount;
            combat.count = group.enemyLives.length; combat.enemyLife = group.enemyLives[0] ?? 0;
          } else {
            combat.enemyLives[0] = Math.max(0, combat.enemyLives[0] - damageAmount);
            combat.enemyLife = combat.enemyLives[0]; combat.count = combat.enemyLives[0] > 0 ? 1 : 0;
            if (combat.enemyLives[0] <= 0) { discardSleepingFront(combat); combat.enemyLives = []; }
          }
          appendLog(state, `圣水自动命中${enemy.label}，造成${damageAmount}点伤害。`);
          const remainingGroups = combat.groups?.some(value => value.enemyLives.length) ?? false;
          if (combat.count <= 0 && !remainingGroups) {
            if (enemy.tags?.includes("vampire")) {
              delete state.missionProgress[`vampire-return:${targetId}`];
              if (!state.defeated.includes(targetId)) state.defeated.push(targetId);
            }
            awardCombatVictoryXp(def, state, combat, targetId);
            runFamilyEvent(story, state, { type: "combat-end", enemyId: combat.enemyId, outcome: "defeated", defeatedCount: combat.defeatedCount, remainingLife: 0 }, dice);
            state.combat = undefined;
            state.combatResult = { enemyId: targetId, outcome: "defeated", xpAwarded: combat.xpAwarded,
              groupDefeated: combat.groups?.length ? Object.fromEntries(combat.groups.map(value => [value.enemyId, value.defeatedCount])) : undefined };
            consumeNextCombatModifiers(state);
            drainDeferredTables(story, state, dice);
          } else { combat.playerFirst = false; }
          break;
        }
        if (state.combat.enemyId !== "sewer-rat-horde" || id !== "rat-poison" || state.food < 1) throw new Error("This item has no allowed effect in the current combat");
        state.inventory[id]--; if (state.inventory[id] <= 0) delete state.inventory[id]; state.food--;
        const combat = state.combat; combat.enemyLives[0] = Math.max(0, combat.enemyLives[0] - 2);
        appendLog(state, "消耗鼠药和1点食物，对鼠群造成2点伤害。");
        if (combat.enemyLives[0] <= 0) {
          awardCombatVictoryXp(def, state, combat, combat.enemyId);
          state.combat = undefined; state.defeated.push(combat.enemyId); state.combatResult = { enemyId: combat.enemyId, outcome: "defeated", xpAwarded: combat.xpAwarded };
          drainDeferredTables(story, state, dice);
        } else { combat.enemyLife = combat.enemyLives[0]; combat.playerFirst = false; }
        break;
      }
      if (id === "blessed-candle") {
        if (action.choice === "sanity" && state.sanity < state.maxSanity) {
          state.inventory[id]--; if (!state.inventory[id]) delete state.inventory[id];
          state.sanity = Math.min(state.maxSanity, state.sanity + 1); appendLog(state, "燃烧受祝福的蜡烛，恢复1点理智。");
        } else if (action.choice === "remove-curse" && state.missionProgress["flag:cursed"] === true) {
          state.inventory[id]--; if (!state.inventory[id]) delete state.inventory[id];
          delete state.missionProgress["flag:cursed"]; appendLog(state, "燃烧受祝福的蜡烛，移除身上的诅咒。");
        } else throw new Error("Blessed Candle can recover one Sanity or remove an active curse");
        break;
      }
      if (id !== "food" && id !== "healing-kit") throw new Error("This item has no implemented standalone use; use its source-defined action when applicable");
      state.inventory[id]--; if (id === "food") addFood(def, state, 1);
      else state.hp = Math.min(state.maxHp, state.hp + (action.amount ?? 1));
      break;
    }
    case "store-item": {
      const box = currentBox(state); if (!box.safehouse) throw new Error("Only a current Safe House can store equipment");
      const key = action.target ?? ""; const amount = action.amount ?? 1; box.storedItems ??= {};
      if (key.startsWith("item:")) {
        const id = key.slice(5); if (!Number.isInteger(amount) || amount < 1 || (state.inventory[id] ?? 0) < amount) throw new Error("Stored item amount is unavailable");
        state.inventory[id] -= amount; if (!state.inventory[id]) delete state.inventory[id];
        box.storedItems[key] = (box.storedItems[key] ?? 0) + amount;
      } else if (key.startsWith("weapon:")) {
        const id = key.slice(7); if (amount !== 1 || !state.weaponIds.includes(id) || isCursedWeapon(def, id)) throw new Error("Stored weapon is unavailable");
        if (id === "raygun" && state.rayguns && state.rayguns.owned > 1) {
          state.rayguns.owned--; state.rayguns.broken = Math.min(state.rayguns.broken, state.rayguns.owned);
        } else {
          removeWeaponInstance(state, id);
        }
        box.storedItems[key] = (box.storedItems[key] ?? 0) + 1;
      } else throw new Error("Unknown stored equipment");
      break;
    }
    case "retrieve-item": {
      const box = currentBox(state); const key = action.target ?? ""; const amount = action.amount ?? 1;
      if (!box.storedItems || !Number.isInteger(amount) || amount < 1 || (box.storedItems[key] ?? 0) < amount) throw new Error("Stored item is unavailable");
      if (key.startsWith("item:")) {
        const id = key.slice(5); addInventoryItem(story, state, id, amount);
        const accepted = (state.inventory[id] ?? 0) - (current.inventory[id] ?? 0);
        box.storedItems[key] -= accepted;
      } else if (key.startsWith("weapon:")) {
        const id = key.slice(7); const countBefore = state.weaponIds.filter(value => value === id).length; const raygunsBefore = state.rayguns?.owned ?? 0; addWeapon(story, state, id);
        if (state.pending?.kind !== "carry-capacity" && (id === "raygun" ? (state.rayguns?.owned ?? 0) > raygunsBefore : state.weaponIds.filter(value => value === id).length > countBefore)) box.storedItems[key]--;
      } else throw new Error("Unknown stored equipment");
      if (box.storedItems[key] <= 0) delete box.storedItems[key];
      break;
    }
    case "discard-item": {
      const key = action.target ?? "";
      if (key.startsWith("item:")) {
        const id = key.slice(5); if ((state.inventory[id] ?? 0) < 1) throw new Error("Item unavailable to discard");
        state.inventory[id]--;
        if (state.inventory[id] <= 0) delete state.inventory[id];
      } else if (key.startsWith("weapon:")) {
        const id = key.slice(7); if (!state.weaponIds.includes(id) || id === "unarmed" || isCursedWeapon(def, id)) throw new Error("Weapon unavailable to discard");
        if (id === "raygun" && state.rayguns && state.rayguns.owned > 1) {
          state.rayguns.owned--; state.rayguns.broken = Math.min(state.rayguns.broken, state.rayguns.owned);
        } else removeWeaponInstance(state, id);
      } else throw new Error("Unknown discard target");
      break;
    }
  }
  if (state.combat?.hordeLossPending && !state.pending && state.status === "active") {
    state.combat.hordeLossPending = false;
    const face = die(dice);
    appendLog(state, `僵尸松鼠群每回合失物检定：${face}/6。`);
    if (face <= 2) {
      const options = carriedDiscardOptions(def, state, [], [], []);
      if (state.food >= 2) options.unshift("food");
      if (options.length) state.pending = { kind: "horde-loss", options, data: { prompt: "僵尸松鼠群抢夺物品：失去一件自选携带物品或2点食物。" } };
      else appendLog(state, "没有可供选择的携带物品或2点食物；未能夺走物品。");
    }
  }
  finishFearBookstoreEncounter(story, state, dice);
  resolveFearSchoolLibrarianCombatOutcome(state);
  finishFearSchoolBookQueue(story, state, dice);
  finishFearArtSchoolFollowup(state);
  finishFearArmorySearch(story, state, dice);
  finishFearHangmanContinuation(story, state, dice);
  finishFearTableCombatReward(story, state, dice);
  finishFearClownCombat(story, state);
  finishFearTableRewardContinuation(story, state, dice);
  finishFearHardwareStorePickup(story, state, dice);
  finishFearClownMaskChoice(state);
  if (combatAtActionStart && state.combatResult?.enemyId === combatAtActionStart.enemyId
    && (!state.combat || state.combat.enemyId !== combatAtActionStart.enemyId)) {
    const encounterIds = [...new Set([combatAtActionStart.enemyId, ...(combatAtActionStart.groups ?? []).map(group => group.enemyId)])];
    const encounterTags = [...new Set(encounterIds.flatMap(id => def.enemies[id]?.tags ?? []))];
    applyFearItemSourceEncounterEnd(state, encounterTags);
    delete state.missionProgress["fear:item:drunk:encounter-active"];
    const flashlight = applyFearFlashlightEncounterEnd(state, encounterTags.includes("shadow"), dice);
    if (flashlight.checked) appendLog(state, `夜影遭遇后手电筒电池检定：${flashlight.chanceFace}/6${flashlight.batteryFailed ? "；电池耗尽，不能再使用" : "；仍可使用"}。`);
  }
  if (!state.pending) {
    const queued = state.familyRewardQueue ?? [];
    const next = queued.shift();
    if (next) state.pending = next;
    state.familyRewardQueue = queued.length ? queued : undefined;
  }
  if (state.missionProgress["flag:cursed"] === true && state.sanity > sanityBeforeAction) {
    delete state.missionProgress["flag:cursed"];
    appendLog(state, "理智增加，恶魔孩童诅咒解除。");
  }
  if (state.hp <= 0) state.status = "dead";
  else if (state.sanity <= 0 && state.status === "active") state.status = "insane";
  if (!state.pendingEvent) presentFearAcquisitionChoice(state);
  return state;
}

export function projectFear(story: FearStory, state: FearState): FearProjected {
  const def = assertStory(story); const box = currentBox(state);
  if (!story.nodes.some(node => node.id === state.nodeId)) throw new Error(`Fear state node ${state.nodeId} is absent from Story.nodes`);
  return { nodeId: state.nodeId, status: state.status, currentBox: box,
    mapSheets: state.mapSheets.map(sheet => ({ sheet: sheet.sheet, boxes: sheet.boxes.map(({ id, sheet: sheetNo, box: boxNo, row, column, visit, visited, searched, safehouse, storedItems }) => ({ id, sheet: sheetNo, box: boxNo, row, column, visit, visited, searched, safehouse, ...(visited && storedItems ? { storedItemCount: Object.values(storedItems).reduce((sum, count) => sum + count, 0) } : {}) })) })),
    reachable: reachable(state, def), hp: state.hp, maxHp: state.maxHp,
    sanity: state.sanity, maxSanity: state.maxSanity, food: state.food, foodCapacity: carriedFoodLimit(def, state), missionFood: state.missionFood, missionFoodTarget: state.missionFoodTarget, itemCapacity: carryCapacity(def, state), clues: state.clues, xp: state.xp, elapsedTimeBoxes: state.elapsedTimeBoxes, luck: state.luck,
    skills: [
      ...Object.entries(state.skills).map(([id, level]) => ({ id, label: def.skills[id]?.label ?? id, level: level as 0 | 1 | 2, kind: "skill" as const })),
      ...Object.entries(state.arcaneSkills).map(([id, level]) => ({ id, label: def.skills[id]?.label ?? id, level: level as 0 | 1 | 2, kind: "arcane" as const })),
    ].filter(skill => skill.level > 0).sort((a,b) => a.label.localeCompare(b.label, "zh-CN")),
    inventory: { ...state.inventory }, ammo: { ...state.ammo }, silverAmmo: { ...(state.silverAmmo ?? {}) },
    weapons: ([...new Set(state.weaponIds)].map(id => ({ id, label: def.weapons[id]?.label ?? id,
      count: state.weaponIds.filter(value => value === id).length,
      ...(def.weapons[id]?.ammoType ? { ammo: state.ammo[id] ?? 0, ...(silverAmmoCount(state, id) ? { silverAmmo: silverAmmoCount(state, id) } : {}) } : {}) })) as FearProjected["weapons"])
      .concat(state.rayguns?.owned ? [{ id: "raygun", label: def.weapons.raygun?.label ?? "射线枪", count: state.rayguns.owned, broken: state.rayguns.broken }] : []),
    currentWeapon: { id: state.weaponId, label: def.weapons[state.weaponId]?.label ?? state.weaponId,
      damage: def.weapons[state.weaponId]?.damage ?? 0,
      ...(def.weapons[state.weaponId]?.ammoType ? { ammo: state.ammo[state.weaponId] ?? 0, ...(silverAmmoCount(state, state.weaponId) ? { silverAmmo: silverAmmoCount(state, state.weaponId) } : {}) } : {}) },
    currentMission: { id: state.missionId, label: def.missions[state.missionId]?.label ?? state.missionId,
      goal: def.missions[state.missionId]?.goal ?? "" },
    scars: state.scars.map(id => ({ id, label: def.injuries?.[id]?.label ?? id })),
    traumas: state.traumas.map(id => ({ id, label: def.traumas?.[id]?.label ?? id })),
    missionId: state.missionId, gatesClosed: state.gatesClosed, ...(state.combat ? { combat: state.combat } : {}),
    ...(state.servitor ? { servitor: { ...state.servitor } } : {}),
    ...(state.pending ? { pending: publicPending(def, state) } : {}), log: [...state.log] };
}
