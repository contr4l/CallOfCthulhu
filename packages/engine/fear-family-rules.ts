import type { FearAction, FearDefinition, FearState } from "../contracts/fear.js";
import type { FearDice } from "../contracts/fear.js";
import { fearDiceScope } from "./fear-dice-scope.js";

/** Source-specific mechanics for the Alien, Laboratory Horror, and Living Doll tables. */
export type FearFamilyRule =
  | "alien-gray" | "alien-hunter" | "alien-beast" | "reptilian" | "mi-go" | "tentacled-beast"
  | "blob" | "murdering-robot" | "mutant" | "doppelganger" | "tentacled-horror" | "giant-bug"
  | "vivina" | "muama" | "maraya" | "azolina" | "kalina";

export const FEAR_FAMILY_RULES: Readonly<Record<string, FearFamilyRule>> = {
  "aliens-1": "alien-gray", "aliens-2": "alien-hunter", "aliens-3": "alien-beast",
  "aliens-4": "reptilian", "aliens-5": "mi-go", "aliens-6": "tentacled-beast",
  "lab-horrors-1": "blob", "lab-horrors-2": "murdering-robot", "lab-horrors-3": "mutant",
  "doppelganger": "doppelganger", "lab-horrors-5": "tentacled-horror", "lab-horrors-6": "giant-bug",
  "living-dolls-1": "vivina", "living-dolls-2": "muama", "living-dolls-4": "maraya",
  "living-dolls-5": "azolina", "living-dolls-6": "kalina",
};

export type FearFamilyCombatState = {
  /** A tentacled beast begins with four attacks; wounds remove its tentacles. */
  tentacles?: number;
  /** Source-defined enemy-specific effects active in this encounter. */
  acidSplashPending?: boolean;
  disabled?: boolean;
  robotAutoHitNext?: boolean;
  tentacledEscapeLocked?: boolean;
  azolinaDrainActive?: boolean;
  azolinaDefensePassed?: boolean;
  azolinaWillPassed?: boolean;
  kalinaAlive?: boolean;
  dinosaurAlive?: boolean;
  tentacledHitsThisRound?: number;
  targetLifeBeforeTurn?: number;
  flyingBug?: boolean;
  psionic?: boolean;
  intruderPresent?: boolean;
  intruderEnemyId?: string;
  intruderEnemyIds?: string[];
  vivinaRequested?: string;
  eyeWounds?: number;
  alienRaygunBroken?: boolean;
  attackTarget?: string;
  marayaFireWounded?: boolean;
  marayaFireDamage?: number;
};

export type FearFamilyChoice =
  | "offer-candle" | "offer-book" | "offer-doll" | "offer-knife" | "offer-food" | "offer-bell"
  | "give-black-mirror-fragments" | "leave-box" | "disable-robot" | "use-insecticide" | "attack-kalina"
  | "attack-dinosaur" | "attack-vivina" | "attack-intruder" | "escape" | "pick-black-stone" | "leave-black-stone";

export type FearFamilyEffect =
  | { type: "roll-check"; context: "stealth" | "will" | "charisma" | "agile" | "fear-save" | "psionics"; level: number; failure: "damage" | "sanity" | "combat"; amount?: number }
  | { type: "damage"; target: "player" | "enemy" | "dinosaur"; amount: number; bypassBounce?: boolean }
  | { type: "pending"; kind: string; options: string[]; data?: Record<string, unknown> }
  | { type: "loot"; itemId?: string; weaponId?: string; tableId?: string; count: number }
  | { type: "combat-state"; patch: FearFamilyCombatState }
  | { type: "mission-progress"; key: string; value: string | number | boolean | undefined }
  | { type: "remove-progress"; key: string }
  | { type: "sanity"; amount: number }
  | { type: "escape"; allowed: boolean }
  | { type: "unique-event"; eventId: string }
  | { type: "pickup-and-event"; itemId: string; eventId: string }
  | { type: "enemy-profile"; level?: number; life?: number; slow?: boolean }
  | { type: "end-adventure"; reason: string }
  | { type: "roll-table"; tableId: string }
  | { type: "attack-count"; count: number; damages?: number[] }
  | { type: "skip-turn" }
  | { type: "immediate-escape" }
  | { type: "auto-hit" }
  | { type: "log"; text: string };

export type FearFamilyEvent =
  | { type: "combat-start"; enemyId: string; count: number; surprised?: boolean }
  | { type: "enemy-turn"; enemyId: string; round: number; targetEnemy?: string }
  | { type: "attack-result"; enemyId: string; damage: number; naturalFace: number; targetEnemy?: string; weaponTags: string[]; explodedSix?: boolean; targetLifeAfter?: number }
  | { type: "defense-result"; enemyId: string; naturalFace: number; failed: boolean; targetEnemy?: string }
  | { type: "escape-check"; enemyId: string }
  | { type: "combat-end"; enemyId: string; outcome: "defeated" | "escaped" | "fled"; defeatedCount?: number; remainingLife?: number }
  | { type: "player-choice"; enemyId: string; choice: FearFamilyChoice };

export type FearFamilyContext = {
  definition: FearDefinition;
  state: FearState;
  combat?: FearFamilyCombatState;
  event: FearFamilyEvent;
  /** Source test rolls are supplied by the caller; no hidden randomness. */
  rolls?: number[];
};

export type FearFamilyRuntimeEvent =
  | { type: "combat-start"; enemyId: string; count: number; surprised: boolean }
  | { type: "enemy-turn"; enemyId: string; round: number }
  | { type: "attack-result"; enemyId: string; damage: number; naturalFace: number; targetEnemy?: string; targetLifeAfter?: number; weaponId: string; weaponTags: string[]; explodedSix?: boolean }
  | { type: "defense-result"; enemyId: string; naturalFace: number; failed: boolean; defenderId?: string }
  | { type: "escape-check"; enemyId: string }
  | { type: "combat-end"; enemyId: string; outcome: "defeated" | "escaped" | "fled"; defeatedCount?: number; remainingLife?: number };

export type FearFamilySkillModifier = (context: "attack" | "defense" | "stealth" | "will" | "charisma" | "agile" | "fear-save" | "psionics") => number;

/** Executes source rolls with stable dice scopes and mutates only family-owned state. */
export function runFearFamilyRuleEvent(
  definition: FearDefinition,
  state: FearState,
  event: FearFamilyRuntimeEvent,
  dice: FearDice,
  skillModifier: FearFamilySkillModifier,
): FearFamilyEffect[] {
  const enemy = definition.enemies[event.enemyId];
  const rule = enemy?.familyRule ?? FEAR_FAMILY_RULES[event.enemyId];
  const effects: FearFamilyEffect[] = [];
  if (event.type === "attack-result" && event.weaponId === "raygun" && event.naturalFace === 1) {
    const broken = breakFearRaygun(state, event.weaponId, event.naturalFace);
    if (broken) effects.push({ type: "log", text: "外星射线枪自然掷出1：这把枪永久损坏，无法修复。" });
  }
  if (!rule) return effects;
  const roll = (label: string) => {
    const die = fearDiceScope(dice, `family:${event.enemyId}:${event.type}:${label}`);
    let face: number;
    let first: number | undefined;
    let total = 0;
    const faces: number[] = [];
    do {
      face = die(1, 7);
      first ??= face;
      faces.push(face);
      total += face;
    } while (face === 6);
    return { first: first!, total, faces };
  };
  const check = (level: number, context: Parameters<FearFamilySkillModifier>[0]) => {
    const result = roll(`check:${context}`);
    const total = result.first === 1 ? 1 : result.total + skillModifier(context);
    const success = result.first === 6 || (result.first !== 1 && total >= level);
    state.log.push(`${enemy?.label ?? event.enemyId} L${level} ${context}：${result.faces.join("+")}${result.first === 1 ? "" : ` + ${skillModifier(context)}`} => ${total}（${success ? "成功" : "失败"}）。`);
    return success;
  };
  const family = () => {
    if (!state.combat) throw new Error(`Fear family ${event.enemyId} hook requires an active combat`);
    state.combat.familyState ??= {};
    return state.combat.familyState;
  };
  // The source Sanity rule lets the player substitute a Mental Scar for a 1-or-2 point loss, so the
  // deduction is emitted as an effect for the central dispatcher instead of being applied inline.
  const loseSanity = (amount: number) => effects.push({ type: "log", text: `${enemy?.label ?? event.enemyId}造成${amount}点理智损失。` }, { type: "sanity", amount });

  if (event.type === "combat-start") {
    // The source says "upon seeing these creatures" for Mi-Go; unlike the
    // tentacled horror it does not limit this save to the first campaign sighting.
    if (rule === "mi-go") {
      if (!check(5, "fear-save")) loseSanity(1);
    }
    if (rule === "tentacled-horror" && state.missionProgress["fear:family:tentacled-horror:seen"] !== true) {
      state.missionProgress["fear:family:tentacled-horror:seen"] = true;
      if (!check(3, "fear-save")) loseSanity(1);
    }
    if (rule === "alien-hunter" && !event.surprised) {
      if (check(6, "stealth")) {
        state.combat = undefined; state.combatResult = { enemyId: event.enemyId, outcome: "escaped" };
        effects.push({ type: "immediate-escape" });
      }
    }
    if (rule === "tentacled-beast") family().tentacles = 4;
    if (rule === "mutant") family().psionic = roll("psionic-powers").first <= 2;
    if (rule === "giant-bug") family().flyingBug = roll("flying-species").first <= 2;
    if (rule === "azolina") {
      const passed = check(5, "will");
      family().azolinaWillPassed = passed;
      // Keep the encounter active until the player takes the explicit leave action.
      // Ending combat here used to create an empty pending choice on boxes without
      // pre-existing links, making the source-authorized escape unreachable.
      if (passed) state.combat!.playerFirst = true;
    }
    if (rule === "kalina") { family().kalinaAlive = true; family().dinosaurAlive = true; }
    if (rule === "maraya") {
      const persisted = state.missionProgress["fear:family:maraya:life"];
      if (typeof persisted === "number" && state.combat) state.combat.enemyLives[0] = Math.max(1, persisted);
    }
  }

  if (event.type === "enemy-turn") {
    if (rule === "mutant" && family().psionic && !check(4, "psionics")) loseSanity(1);
    if (rule === "azolina" && family().azolinaDrainActive) {
      state.hp = Math.max(0, state.hp - 1); state.log.push("阿佐莉娜继续勒颈，损失1点生命。");
      if (state.hp === 0) state.status = "dead";
    }
    if (rule === "tentacled-beast") effects.push({ type: "attack-count", count: family().tentacles ?? 4, damages: Array(family().tentacles ?? 4).fill(1) });
    if (rule === "tentacled-horror") { family().tentacledHitsThisRound = 0; effects.push({ type: "attack-count", count: 2, damages: [1, 1] }); }
    if (rule === "kalina") effects.push({ type: "attack-count", count: Number(family().kalinaAlive !== false) + Number(family().dinosaurAlive !== false), damages: [...(family().kalinaAlive === false ? [] : [1]), ...(family().dinosaurAlive === false ? [] : [2])] });
    if (rule === "vivina" && roll("random-encounter").first === 1) effects.push({ type: "roll-table", tableId: "random-encounter" });
  }

  if (event.type === "attack-result") {
    if (rule === "alien-beast" && event.damage > 0 && roll("acid-splash").first <= 2 && !check(6, "defense")) {
      state.hp = Math.max(0, state.hp - 1); state.log.push("酸性血液溅中你，损失1点生命。");
      if (state.hp === 0) state.status = "dead";
    }
    if (rule === "tentacled-beast" && event.damage > 0) family().tentacles = Math.max(0, (family().tentacles ?? 4) - event.damage);
    if (rule === "tentacled-horror" && event.targetLifeAfter !== undefined && event.targetLifeAfter <= 1) family().tentacledEscapeLocked = false;
    if (rule === "tentacled-horror" && event.damage > 0) family().targetLifeBeforeTurn = event.targetLifeAfter;
    if (rule === "maraya" && event.explodedSix) { state.combat = undefined; state.combatResult = { enemyId: event.enemyId, outcome: "escaped" }; effects.push({ type: "immediate-escape" }); }
    if (rule === "maraya" && event.weaponTags.includes("fire") && event.damage > 0) {
      family().marayaFireWounded = true; family().marayaFireDamage = (family().marayaFireDamage ?? 0) + event.damage;
    }
    if (rule === "kalina" && event.targetEnemy === "living-dolls-6" && event.targetLifeAfter === 0) { family().kalinaAlive = false; family().dinosaurAlive = false; }
    if (rule === "kalina" && event.targetEnemy === "living-dolls-6-dinosaur" && event.targetLifeAfter === 0) family().dinosaurAlive = false;
  }

  if (event.type === "defense-result") {
    if (rule === "murdering-robot" && family().robotAutoHitNext) {
      family().robotAutoHitNext = false;
      effects.push({ type: "auto-hit" });
    }
    if (rule === "alien-beast" && family().acidSplashPending) {
      family().acidSplashPending = false;
      if (event.failed) { state.hp = Math.max(0, state.hp - 1); state.log.push("酸性血液溅中你，损失1点生命。"); }
    }
    if (rule === "tentacled-horror" && event.failed) {
      const hits = (family().tentacledHitsThisRound ?? 0) + 1;
      family().tentacledHitsThisRound = hits;
      if (hits >= 2) family().tentacledEscapeLocked = true;
    }
    if (rule === "azolina") {
      if (event.failed) {
        family().azolinaDrainActive = true;
        state.hp = Math.max(0, state.hp - 1); state.log.push("阿佐莉娜勒颈造成1点生命损失。");
      } else {
        family().azolinaDefensePassed = true;
        if (state.combat) state.combat.escapeModifier = -1;
      }
    }
    if (rule === "maraya" && event.naturalFace === 1) {
      const eyes = Number(state.missionProgress["fear:family:maraya:eye-wounds"] ?? 0) + 1;
      state.missionProgress["fear:family:maraya:eye-wounds"] = eyes;
      if (eyes >= 2) { state.status = "dead"; effects.push({ type: "end-adventure", reason: "Both eyes stabbed by Maraya; source ends the adventure." }); }
    }
  }

  if (event.type === "escape-check") {
    const allowed = fearFamilyEscapeAllowed(event.enemyId, family());
    if (allowed === false) effects.push({ type: "escape", allowed: false });
  }

  if (event.type === "combat-end") {
    if (rule === "blob" && event.outcome === "escaped") state.missionProgress["fear:family:blob:escaped"] = true;
    if (rule === "maraya" && event.outcome === "escaped") {
      if (family().marayaFireWounded && event.remainingLife !== undefined)
        state.missionProgress["fear:family:maraya:life"] = Math.max(1, 12 - (family().marayaFireDamage ?? 0));
      else delete state.missionProgress["fear:family:maraya:life"];
    }
    if (rule === "maraya" && event.outcome === "defeated") delete state.missionProgress["fear:family:maraya:life"];
    if (event.outcome === "defeated" && rule === "alien-gray") effects.push({ type: "loot", weaponId: "raygun", count: event.defeatedCount ?? 1 });
    if (event.outcome === "defeated" && rule === "alien-hunter") effects.push({ type: "loot", itemId: "grenade", count: 1 });
    if (event.outcome === "defeated" && rule === "reptilian") effects.push({ type: "loot", itemId: "reptilian-sword", count: event.defeatedCount ?? 1 });
    if (event.outcome === "defeated" && rule === "mi-go") effects.push({ type: "pending", kind: "family-black-stone", options: ["pick-black-stone", "leave-black-stone"], data: { prompt: "取得覆有象形文字的神秘黑石，或留下它。若拾取，阅读独特事件30。" } });
    if (event.outcome === "defeated" && rule === "kalina") effects.push({ type: "pending", kind: "kalina-loot", options: ["useful-item", "candles"], data: { prompt: "选择从实用物品表掷骰，或掷D6取得蜡烛。" } });
  }
  return effects;
}

export type FearFamilyActionOption = { action: FearAction; label: string; hint?: string };

/** Extra source choices inserted by the main action dispatcher for these three tables. */
export function fearFamilyActionOptions(definition: FearDefinition, state: FearState): FearFamilyActionOption[] {
  const combat = state.combat;
  if (!combat) return [];
  const rule = combat.familyRule ?? definition.enemies[combat.enemyId]?.familyRule ?? FEAR_FAMILY_RULES[combat.enemyId];
  if (!rule || (!combat.playerFirst && rule !== "vivina")) return [];
  const options: FearFamilyActionOption[] = [];
  const add = (choice: string, label: string, hint?: string) => options.push({ action: { type: "choose", choice }, label, ...(hint ? { hint } : {}) });
  if (rule === "murdering-robot") add("family:disable-robot", "尝试关闭杀人机器人", "L4敏捷检定；敏捷技能+1，专家+2");
  if (rule === "giant-bug" && (state.inventory.insecticide ?? 0) > 0) add("family:use-insecticide", "牺牲1罐杀虫剂", "自动对巨虫造成2点伤害，不能被甲壳弹开");
  if (rule === "vivina") add("family:vivina-offer", "掷骰查看薇薇娜想要的物品", "可拒绝交出该物品；没有所需物品或拒绝都会开始战斗");
  if (rule === "muama" && (state.inventory["black-mirror-fragments"] ?? 0) > 0) add("family:give-mirror-fragments", "交出黑镜碎片以避开穆阿玛");
  if (rule === "azolina" && combat.familyState?.azolinaWillPassed) add("family:leave-azolina-box", "离开阿佐莉娜所在区域");
  if (rule === "kalina") {
    if (combat.familyState?.kalinaAlive !== false) add("family:target-kalina", "攻击卡莉娜");
    if (combat.familyState?.dinosaurAlive !== false) add("family:target-dinosaur", "攻击玩具恐龙");
  }
  if (rule === "vivina" && combat.familyState?.intruderPresent) {
    const groups = combat.groups ?? [];
    if (groups.some(group => group.enemyId === "living-dolls-1" && group.enemyLives.length))
      add("family:target-vivina", "攻击薇薇娜");
    for (const enemyId of combat.familyState.intruderEnemyIds ?? [combat.familyState.intruderEnemyId].filter((id): id is string => !!id)) {
      if (groups.some(group => group.enemyId === enemyId && group.enemyLives.length))
        add(`family:target-intruder:${enemyId}`, `攻击新出现的生物：${definition.enemies[enemyId]?.label ?? enemyId}`);
    }
  }
  return options;
}

export type FearFamilyActionResult = {
  handled: boolean;
  pending?: { kind: string; options: string[]; data?: Record<string, unknown> };
  effects?: FearFamilyEffect[];
};

/** Handles table-specific choices without changing the shared action union or combat loop. */
export function handleFearFamilyAction(definition: FearDefinition, state: FearState, choice: string, dice: FearDice, skillModifier: FearFamilySkillModifier): FearFamilyActionResult {
  const combat = state.combat;
  const rule = combat && (combat.familyRule ?? definition.enemies[combat.enemyId]?.familyRule ?? FEAR_FAMILY_RULES[combat.enemyId]);
  if (!combat && state.pending?.kind === "family-black-stone") {
    if (choice === "pick-black-stone") return { handled: true, effects: [{ type: "pickup-and-event", itemId: "mysterious-black-stone", eventId: "30" }] };
    if (choice === "leave-black-stone") return { handled: true, effects: [{ type: "log", text: "留下覆有象形文字的神秘黑石。" }] };
  }
  if (!combat || !rule || !choice.startsWith("family:")) return { handled: false };
  const fail = (message: string): FearFamilyActionResult => ({ handled: true, effects: [{ type: "log", text: message }] });
  if (choice === "family:use-insecticide") {
    if (rule !== "giant-bug" || (state.inventory.insecticide ?? 0) < 1 || !combat.playerFirst) throw new Error("Insecticide can only be sacrificed against the living Giant Bug on the investigator's turn");
    state.inventory.insecticide--;
    const lives = combat.enemyLives;
    if (lives[0] !== undefined) { lives[0] = Math.max(0, lives[0] - 2); if (lives[0] <= 0) lives.shift(); }
    combat.count = lives.length; combat.enemyLife = lives[0] ?? 0; combat.familyState ??= {}; combat.playerFirst = false;
    return { handled: true, effects: [{ type: "log", text: "牺牲1罐杀虫剂，对巨虫自动造成2点伤害；此伤害不会被弹开。" }] };
  }
  if (choice === "family:give-mirror-fragments") {
    if (rule !== "muama" || (state.inventory["black-mirror-fragments"] ?? 0) < 1) throw new Error("Muama can only be avoided by giving carried black mirror fragments");
    state.inventory["black-mirror-fragments"]--;
    if (!state.inventory["black-mirror-fragments"]) delete state.inventory["black-mirror-fragments"];
    state.combat = undefined; state.combatResult = { enemyId: "living-dolls-2", outcome: "escaped" };
    return { handled: true, effects: [{ type: "log", text: "交出黑镜碎片，避开穆阿玛。" }] };
  }
  if (choice === "family:vivina-offer") {
    if (rule !== "vivina") throw new Error("Vivina is not the current encounter");
    const result = fearDiceScope(dice, "family:living-dolls-1:vivina-desire")(1, 7);
    const requested = ["candle", "book", "doll", "knife", "food", "bell"][result - 1];
    if (!requested) throw new Error("Vivina desire requires a D6 result");
    const bookId = requested === "book" ? Object.entries(state.inventory).find(([id, count]) => count > 0 && definition.items?.[id]?.tags?.includes("book"))?.[0] : undefined;
    const requestedItem = bookId ?? requested;
    const have = requested === "food" ? state.food >= 1 : requested === "book" ? !!bookId : Object.entries(state.inventory).some(([id, count]) => id === requested && count > 0);
    if (!have) { combat.playerFirst = false; return fail("没有薇薇娜想要的物品：必须与她战斗。"); }
    combat.familyState ??= {};
    combat.familyState.vivinaRequested = requestedItem;
    return { handled: true, pending: { kind: "vivina-offer", options: ["give", "refuse"], data: { requestedItem, prompt: `薇薇娜想要${requested === "food" ? "1点食物" : definition.items?.[requestedItem]?.label ?? requestedItem}。交给她并进行L3魅力检定，或拒绝并战斗。` } } };
  }
  if (choice === "family:vivina-give" || choice === "family:vivina-refuse") {
    if (rule !== "vivina" || !combat.familyState?.vivinaRequested) throw new Error("Vivina has not stated the item she wants");
    const requested = combat.familyState.vivinaRequested;
    if (choice.endsWith("refuse")) { combat.familyState.vivinaRequested = undefined; combat.playerFirst = false; return { handled: true, effects: [{ type: "log", text: "拒绝交出物品，必须与薇薇娜战斗。" }] }; }
    if (requested === "food") { if (state.food < 1) throw new Error("The requested Food is no longer carried"); state.food--; }
    else { if ((state.inventory[requested] ?? 0) < 1) throw new Error("The requested object is no longer carried"); state.inventory[requested]--; if (!state.inventory[requested]) delete state.inventory[requested]; }
    const face = fearDiceScope(dice, "family:living-dolls-1:vivina-charisma")(1, 7);
    const total = face === 1 ? 1 : face + skillModifier("charisma");
    const success = face === 6 || (face !== 1 && total >= 3);
    combat.familyState.vivinaRequested = undefined;
    if (success) { state.combat = undefined; state.combatResult = { enemyId: combat.enemyId, outcome: "escaped" }; }
    else combat.playerFirst = false;
    return { handled: true, effects: [{ type: "log", text: `交出指定物品并进行L3魅力检定：${face} => ${total}（${success ? "安抚成功" : "失败，必须战斗"}）。` }] };
  }
  if (choice === "family:leave-azolina-box") {
    if (rule !== "azolina" || !combat.familyState?.azolinaWillPassed) throw new Error("May leave the box only after passing Azolina's initial Will save");
    state.combat = undefined; state.combatResult = { enemyId: combat.enemyId, outcome: "escaped" };
    return { handled: true, effects: [{ type: "log", text: "通过阿佐莉娜的意志检定，离开该区域。" }] };
  }
  if (choice === "family:target-kalina" || choice === "family:target-dinosaur") {
    if (rule !== "kalina") throw new Error("This is not the Kalina encounter");
    const target = choice.endsWith("kalina") ? "living-dolls-6" : "living-dolls-6-dinosaur";
    combat.familyState ??= {}; combat.familyState.attackTarget = target;
    return { handled: true, effects: [{ type: "log", text: `本次攻击目标：${choice.endsWith("kalina") ? "卡莉娜" : "玩具恐龙"}。` }] };
  }
  if (choice === "family:target-vivina" || choice.startsWith("family:target-intruder:")) {
    if (rule !== "vivina" || !combat.familyState?.intruderPresent) throw new Error("No additional creature is present with Vivina");
    const target = choice === "family:target-vivina" ? "living-dolls-1" : choice.slice("family:target-intruder:".length);
    if (!combat.groups?.some(group => group.enemyId === target && group.enemyLives.length)) throw new Error("The selected Vivina encounter target is no longer present");
    combat.familyState.attackTarget = target;
    return { handled: true, effects: [{ type: "log", text: "选择本回合攻击对象。" }] };
  }
  if (choice === "family:disable-robot") {
    if (rule !== "murdering-robot" || !combat.playerFirst) throw new Error("The robot can only be disabled during the investigator's turn");
    const face = fearDiceScope(dice, "family:lab-horrors-2:disable-robot")(1, 7);
    const total = face === 1 ? 1 : face + skillModifier("agile");
    const success = face === 6 || (face !== 1 && total >= 4);
    if (success) {
      state.combat = undefined; state.combatResult = { enemyId: "lab-horrors-2", outcome: "escaped" };
      return { handled: true, effects: [{ type: "immediate-escape" }, { type: "log", text: `L4敏捷检定关闭机器人：${face} => ${total}（成功）。` }] };
    }
    combat.familyState ??= {}; combat.familyState.robotAutoHitNext = true; combat.playerFirst = false;
    return { handled: true, effects: [{ type: "log", text: `L4敏捷检定关闭机器人：${face} => ${total}（失败）；机器人下次攻击自动命中。` }] };
  }
  return { handled: false };
}

/** Resolves source clauses into explicit effects for the real engine dispatcher. */
export function resolveFearFamilyRule(context: FearFamilyContext): FearFamilyEffect[] {
  const { event, state } = context;
  const rule = FEAR_FAMILY_RULES[event.enemyId];
  if (!rule) return [];
  const out: FearFamilyEffect[] = [];
  const roll = (index = 0) => {
    const value = context.rolls?.[index];
    if (!Number.isInteger(value) || value! < 1 || value! > 6) throw new Error(`Fear family rule ${rule} requires an explicit D6 roll at index ${index}`);
    return value!;
  };
  const seen = (key: string) => state.missionProgress[`fear:family:${key}:seen`] === true;
  const markSeen = (key: string) => out.push({ type: "mission-progress", key: `fear:family:${key}:seen`, value: true });

  if (event.type === "combat-start") {
    if (rule === "alien-hunter" && event.surprised === false)
      out.push({ type: "roll-check", context: "stealth", level: 6, failure: "combat" });
    if (rule === "mi-go") {
      out.push({ type: "roll-check", context: "fear-save", level: 5, failure: "sanity", amount: 1 });
    }
    if (rule === "tentacled-horror" && !seen(rule)) {
      markSeen(rule);
      out.push({ type: "roll-check", context: "fear-save", level: 3, failure: "sanity", amount: 1 });
    }
    if (rule === "tentacled-beast") out.push({ type: "combat-state", patch: { tentacles: 4 } });
    if (rule === "mutant" && roll() <= 2) {
      out.push({ type: "combat-state", patch: { psionic: true } });
      out.push({ type: "log", text: "变种人拥有心灵异能：每回合开始进行L4心灵豁免，否则损失1点理智。" });
    }
    if (rule === "giant-bug") out.push({ type: "combat-state", patch: { flyingBug: roll() <= 2 } });
    if (rule === "azolina") out.push({ type: "roll-check", context: "will", level: 5, failure: "combat" });
    if (rule === "kalina") out.push({ type: "combat-state", patch: { kalinaAlive: true, dinosaurAlive: true } });
    if (rule === "doppelganger") out.push({ type: "log", text: "分身不携带任何装备；生命值等于调查员当前最大生命。" });
  }

  if (event.type === "enemy-turn") {
    if (rule === "tentacled-horror") out.push({ type: "combat-state", patch: { tentacledHitsThisRound: 0 } });
    if (rule === "tentacled-beast") {
      const tentacles = Math.max(0, context.combat?.tentacles ?? 4);
      out.push({ type: "log", text: `触手兽以${tentacles}条仍可用触手分别攻击。` });
    }
    if (rule === "mutant" && context.combat?.psionic) {
      out.push({ type: "roll-check", context: "psionics", level: 4, failure: "sanity", amount: 1 });
    }
    if (rule === "tentacled-horror" && context.combat?.tentacledEscapeLocked)
      out.push({ type: "escape", allowed: false });
    if (rule === "azolina" && context.combat?.azolinaDrainActive)
      out.push({ type: "damage", target: "player", amount: 1 });
    if (rule === "vivina" && roll() === 1)
      out.push({ type: "roll-table", tableId: "random-encounter" });
  }

  if (event.type === "attack-result") {
    if (rule === "alien-beast" && event.damage > 0 && roll() <= 2)
      out.push({ type: "combat-state", patch: { acidSplashPending: true } });
    if (rule === "tentacled-beast" && event.damage > 0)
      out.push({ type: "combat-state", patch: { tentacles: Math.max(0, (context.combat?.tentacles ?? 4) - event.damage) } });
    if (rule === "tentacled-horror" && event.damage > 0 && context.combat?.tentacledEscapeLocked && event.damage >= 4)
      out.push({ type: "combat-state", patch: { tentacledEscapeLocked: false } });
    if (rule === "maraya" && event.explodedSix)
      out.push({ type: "escape", allowed: true }, { type: "log", text: "爆炸攻击掷出6：玛拉娅的头被击落，自动逃离。" });
    if (rule === "maraya" && event.weaponTags.includes("fire") && event.damage > 0)
      out.push({ type: "combat-state", patch: { marayaFireWounded: true, marayaFireDamage: (context.combat?.marayaFireDamage ?? 0) + event.damage } });
    if (rule === "kalina" && event.targetEnemy === "living-dolls-6" && event.targetLifeAfter === 0)
      out.push({ type: "combat-state", patch: { kalinaAlive: false, dinosaurAlive: false } }, { type: "log", text: "卡莉娜被击败，玩具恐龙随之倒地。" });
    if (rule === "kalina" && event.targetEnemy === "living-dolls-6-dinosaur" && event.targetLifeAfter === 0)
      out.push({ type: "combat-state", patch: { dinosaurAlive: false } });
  }

  if (event.type === "defense-result") {
    if (rule === "alien-beast" && context.combat?.acidSplashPending) {
      out.push({ type: "combat-state", patch: { acidSplashPending: false } });
      if (event.failed) out.push({ type: "damage", target: "player", amount: 1 });
    }
    if (rule === "tentacled-horror") {
      const hits = (context.combat?.tentacledHitsThisRound ?? 0) + (event.failed ? 1 : 0);
      out.push({ type: "combat-state", patch: { tentacledHitsThisRound: hits, ...(hits >= 2 ? { tentacledEscapeLocked: true } : {}) } });
    }
    if (rule === "maraya" && event.naturalFace === 1) {
      const eyes = Number(state.missionProgress["fear:family:maraya:eye-wounds"] ?? 0) + 1;
      out.push({ type: "mission-progress", key: "fear:family:maraya:eye-wounds", value: eyes },
        { type: "log", text: "防御掷出自然1：钉子扎入一只眼睛，攻击-1直到在诊所或安全屋恢复1点生命。" });
      if (eyes >= 2) out.push({ type: "end-adventure", reason: "Maraya stabbed both eyes; the printed source ends the adventure." });
    }
    if (rule === "azolina" && event.failed)
      out.push({ type: "combat-state", patch: { azolinaDrainActive: true } });
  }

  if (event.type === "escape-check") {
    if (rule === "tentacled-beast") out.push({ type: "escape", allowed: (context.combat?.tentacles ?? 4) < 3 });
    if (rule === "tentacled-horror") out.push({ type: "escape", allowed: !context.combat?.tentacledEscapeLocked || (context.combat?.targetLifeBeforeTurn ?? 5) <= 1 });
    if (rule === "giant-bug" && context.combat?.flyingBug) out.push({ type: "escape", allowed: false });
  }

  if (event.type === "combat-end" && event.outcome === "defeated") {
    if (rule === "alien-gray") out.push({ type: "loot", itemId: "raygun", count: event.defeatedCount ?? 1 });
    if (rule === "alien-hunter") out.push({ type: "loot", itemId: "grenade", count: 1 });
    if (rule === "reptilian") out.push({ type: "loot", itemId: "sword", count: event.defeatedCount ?? 1 });
    if (rule === "mi-go") out.push({ type: "pending", kind: "family-black-stone", options: ["pick-black-stone", "leave-black-stone"], data: { prompt: "取得覆有象形文字的神秘黑石，或将它留下。若拾取，阅读独特事件30。" } });
    if (rule === "kalina") out.push({ type: "pending", kind: "kalina-loot", options: ["useful-item", "candles"], data: { prompt: "击败卡莉娜后：掷3/6从实用物品表取得1件，或掷D6取得蜡烛（选择其一）。" } });
  }

  if (event.type === "combat-end" && rule === "blob" && event.outcome === "escaped")
    out.push({ type: "mission-progress", key: "fear:family:blob:escaped", value: true });
  if (event.type === "combat-start" && rule === "blob" && state.missionProgress["fear:family:blob:escaped"] === true)
    out.push({ type: "enemy-profile", level: 5, life: 10, slow: false }, { type: "log", text: "再次返回：黏液怪已增强为L5、10点生命，且不再缓慢。" });
  if (event.type === "combat-end" && rule === "maraya") {
    if (event.outcome === "escaped") {
      if (context.combat?.marayaFireWounded && event.remainingLife !== undefined)
        out.push({ type: "mission-progress", key: "fear:family:maraya:life", value: Math.max(1, 12 - (context.combat.marayaFireDamage ?? 0)) });
      else out.push({ type: "remove-progress", key: "fear:family:maraya:life" });
    }
    if (event.outcome === "defeated") out.push({ type: "remove-progress", key: "fear:family:maraya:life" });
  }

  if (event.type === "player-choice") {
    if (rule === "vivina" && event.choice.startsWith("offer-"))
      out.push({ type: "roll-check", context: "charisma", level: 3, failure: "combat" });
    if (rule === "muama" && event.choice === "give-black-mirror-fragments")
      out.push({ type: "escape", allowed: true });
    if (rule === "murdering-robot" && event.choice === "disable-robot")
      out.push({ type: "roll-check", context: "agile", level: 4, failure: "damage" });
    if (rule === "giant-bug" && event.choice === "use-insecticide")
      out.push({ type: "damage", target: "enemy", amount: 2, bypassBounce: true });
  }

  return out;
}

/** Source skill bonuses shared by the attack and defense turn hooks. */
export function fearFamilySkillModifier(definition: FearDefinition, state: FearState, enemyId: string, context: "attack" | "defense"): number {
  if (enemyId === "lab-horrors-3" && (state.skills["mutant-hunter"] ?? 0) > 0) return 1;
  return 0;
}

/** Eligibility guard used before offering an Escape action. */
export function fearFamilyEscapeAllowed(enemyId: string, combat?: FearFamilyCombatState): boolean | undefined {
  if (enemyId === "living-dolls-5") return combat?.azolinaDefensePassed === true;
  if (enemyId === "aliens-6") return (combat?.tentacles ?? 4) < 3;
  if (enemyId === "lab-horrors-5" && combat?.tentacledEscapeLocked) return (combat.targetLifeBeforeTurn ?? 5) <= 1;
  if (enemyId === "lab-horrors-6" && combat?.flyingBug) return false;
  return undefined;
}

/** Per-strike source bounce check; a missing value means the shared rule applies. */
export function fearFamilyAttackBounceChance(enemyId: string, weaponTags: readonly string[], weaponId?: string): readonly [number, number] | null | undefined {
  if (enemyId === "aliens-4") return [1, 6];
  if (enemyId === "aliens-5") return [2, 6];
  if (enemyId === "lab-horrors-2") return weaponId === "grenade" ? null : [3, 6];
  if (enemyId === "lab-horrors-6" && !weaponTags.includes("insecticide")) return [1, 6];
  return undefined;
}

/** Source says these enemies attack multiple times in one enemy turn. */
export function fearFamilyEnemyAttackCount(enemyId: string, combat?: FearFamilyCombatState): number | undefined {
  if (enemyId === "aliens-6") return Math.max(0, combat?.tentacles ?? 4);
  if (enemyId === "lab-horrors-5") return 2;
  if (enemyId === "living-dolls-6") return Number(combat?.kalinaAlive !== false) + Number(combat?.dinosaurAlive !== false);
  return undefined;
}

export function fearFamilyEnemyAttacks(enemyId: string, combat?: FearFamilyCombatState): Array<{ targetId: string; damage: number; count: number }> | undefined {
  if (enemyId === "aliens-6") return [{ targetId: enemyId, damage: 1, count: Math.max(0, combat?.tentacles ?? 4) }];
  if (enemyId === "lab-horrors-5") return [{ targetId: enemyId, damage: 1, count: 2 }];
  if (enemyId === "living-dolls-6") return [
    ...(combat?.kalinaAlive === false ? [] : [{ targetId: "living-dolls-6", damage: 1, count: 1 }]),
    ...(combat?.dinosaurAlive === false ? [] : [{ targetId: "living-dolls-6-dinosaur", damage: 2, count: 1 }]),
  ];
  return undefined;
}

export function fearFamilyAttackModifier(
  definition: FearDefinition,
  state: FearState,
  enemyId: string,
  weaponTags: readonly string[],
): number {
  const mutantHunter = enemyId === "lab-horrors-3" ? Number((state.skills["mutant-hunter"] ?? 0) > 0) : 0;
  const fireAgainstDolls = ["living-dolls-6", "living-dolls-6-dinosaur"].includes(enemyId) && weaponTags.includes("fire") ? 1 : 0;
  const marayaEyePenalty = enemyId === "living-dolls-4" && Number(state.missionProgress["fear:family:maraya:eye-wounds"] ?? 0) > 0 ? -1 : 0;
  return mutantHunter + fireAgainstDolls + marayaEyePenalty;
}

export function fearFamilyHealEye(state: FearState, currentLocationType: string | undefined): boolean {
  const wounded = Number(state.missionProgress["fear:family:maraya:eye-wounds"] ?? 0) > 0;
  if (!wounded || !["clinic", "safehouse"].includes(currentLocationType ?? "") || state.hp >= state.maxHp) return false;
  state.hp = Math.min(state.maxHp, state.hp + 1);
  delete state.missionProgress["fear:family:maraya:eye-wounds"];
  return true;
}

export function fearFamilyWeaponDamage(_enemyId: string, weaponTags: readonly string[], targetTags: readonly string[], baseDamage: number): number {
  if (weaponTags.includes("raygun") && targetTags.some(tag => tag === "shadow" || tag === "night-shadow")) return 2;
  return baseDamage;
}

export function fearFamilyWeaponUsable(state: FearState, weaponId: string): boolean {
  if (weaponId !== "raygun") return true;
  const inventory = fearRaygunInventory(state);
  return inventory.owned > inventory.broken;
}

/** Normalizes old saves from their actual carried raygun, without creating one from a broken flag alone. */
export function fearRaygunInventory(state: FearState): { owned: number; broken: number } {
  if (state.rayguns) return { owned: Math.max(0, state.rayguns.owned), broken: Math.min(Math.max(0, state.rayguns.owned), Math.max(0, state.rayguns.broken)) };
  const owned = state.weaponIds?.includes("raygun") ? 1 : 0;
  const legacyBroken = state.missionProgress?.["fear:family:raygun:broken"] === true ? 1 : 0;
  state.rayguns = { owned, broken: Math.min(owned, legacyBroken) };
  return { ...state.rayguns };
}

export function addFearRayguns(state: FearState, count: number): { added: number; inventory: { owned: number; broken: number } } {
  if (!Number.isInteger(count) || count < 0) throw new Error("Raygun loot count must be a non-negative integer");
  const current = fearRaygunInventory(state);
  state.rayguns = { owned: current.owned + count, broken: current.broken };
  if (count > 0 && !state.weaponIds.includes("raygun")) state.weaponIds.push("raygun");
  return { added: count, inventory: { ...state.rayguns } };
}

export function breakFearRaygun(state: FearState, weaponId: string, naturalFace: number): boolean {
  if (weaponId !== "raygun" || naturalFace !== 1) return false;
  const current = fearRaygunInventory(state);
  if (current.owned <= current.broken) return false;
  state.rayguns = { owned: current.owned, broken: current.broken + 1 };
  return true;
}

export function fearRaygunAdditionalCarrySlots(state: FearState): number {
  return Math.max(0, fearRaygunInventory(state).owned - Number(state.weaponIds?.includes("raygun")));
}

export function fearFamilyImmuneToMagicOrPoison(enemyId: string): boolean {
  return enemyId === "lab-horrors-2";
}

export function fearFamilyEnemyProfile(state: FearState, enemyId: string): { level?: number; life?: number; slow?: boolean } {
  if (enemyId === "lab-horrors-1" && state.missionProgress["fear:family:blob:escaped"] === true)
    return { level: 5, life: 10, slow: false };
  if (enemyId === "living-dolls-4") {
    const persisted = state.missionProgress["fear:family:maraya:life"];
    if (typeof persisted === "number") return { life: persisted };
  }
  return {};
}

export function fearFamilyDefenseModifier(state: FearState, enemyId: string, targetEnemyId?: string): number {
  const mutantHunter = enemyId === "lab-horrors-3" ? Number((state.skills["mutant-hunter"] ?? 0) > 0) : 0;
  const kalinaTarget = state.combat?.familyState?.attackTarget
    ?? state.combat?.groups?.find(group => group.enemyId === "living-dolls-6")?.familyState?.attackTarget;
  const kalinaDinosaurPenalty = enemyId === "living-dolls-6" && targetEnemyId === "living-dolls-6-dinosaur"
    && kalinaTarget === "living-dolls-6" ? -1 : 0;
  return mutantHunter + kalinaDinosaurPenalty;
}
