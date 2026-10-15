import type { FearAction, FearDefinition, FearDice, FearState } from "../contracts/fear.js";

/** Source item rules. Main-loop timing and combat resolution remain caller-owned. */
export type FearItemCheck = "charisma" | "escape" | "defense" | "sanity-avoid" | "stealth" | "attack" | "magic";
export type FearItemMoment =
  | { kind: "menu" }
  | { kind: "before-encounter"; enemyId: string; enemyTags: readonly string[]; encounterEnemies?: readonly { enemyId: string; enemyTags: readonly string[] }[] }
  | { kind: "check"; check: FearItemCheck; enemyId?: string; enemyTags?: readonly string[] }
  | { kind: "combat-item"; enemyId: string; enemyTags: readonly string[] }
  | { kind: "incoming-damage"; enemyId: string; enemyTags: readonly string[]; damage: number }
  | { kind: "combat-end"; enemyId: string; enemyTags: readonly string[] }
  | { kind: "move"; boxes: number };

export type FearItemActionOption = { action: FearAction; label: string; hint?: string };
export type FearItemSourceEffect =
  | { type: "enemy-damage"; enemyId: string; amount: number; damageType: "fire" }
  | { type: "avoid-encounter"; enemyId: string }
  | { type: "check-modifier"; check: FearItemCheck; amount: number; itemId: string }
  | { type: "blocked-damage"; amount: number; itemId: "bulletproof-vest" | "helmet" }
  | { type: "block-sanity-loss"; amount: 1; reason: "alcohol-first-loss" }
  | { type: "log"; text: string };
export type FearItemSourceResult = { handled: boolean; effects: FearItemSourceEffect[] };
export type FearItemDamageResult = { damageToPlayer: number; absorbedByVest: number; absorbedByHelmet: number; effects: FearItemSourceEffect[] };
export type FearItemAttackInterception = { intercepted: boolean; consumedItemId?: "stuffed-bird" };
export type FearItemBatteryResult = { checked: boolean; batteryFailed: boolean; chanceFace?: number };
export type FearItemSourceWeaponResolution = { weaponId: string; qualityRoll?: number };

const count = (state: FearState, id: string) => Math.max(0, state.inventory[id] ?? 0);
function consume(state: FearState, id: string, amount = 1) {
  const next = count(state, id) - amount;
  if (next > 0) state.inventory[id] = next; else delete state.inventory[id];
}
function number(state: FearState, key: string) {
  const value = state.missionProgress[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function coffeeUses(state: FearState) {
  const stored = state.missionProgress["fear:item:coffee:uses"];
  return typeof stored === "number" && Number.isFinite(stored) ? Math.max(0, stored) : count(state, "coffee") * 6;
}
function hasTag(moment: Extract<FearItemMoment, { kind: "before-encounter" | "check" | "incoming-damage" | "combat-end" }>, tag: string) {
  return (moment.enemyTags ?? []).includes(tag) || (moment.enemyId?.includes(tag) ?? false);
}
function encounterMembers(moment: Extract<FearItemMoment, { kind: "before-encounter" }>) {
  return moment.encounterEnemies?.length ? moment.encounterEnemies : [{ enemyId: moment.enemyId, enemyTags: moment.enemyTags }];
}
function isCanine(member: { enemyId: string; enemyTags: readonly string[] }) {
  return (member.enemyTags.includes("canine") || /dog|hound/.test(member.enemyId))
    && !member.enemyTags.includes("werewolf") && !/werewolf/.test(member.enemyId);
}
function isCatLike(member: { enemyId: string; enemyTags: readonly string[] }) {
  return member.enemyTags.includes("cat-like") || /cat/.test(member.enemyId);
}
function ordinaryD6(dice: FearDice) { return dice(1, 7); }
function add(out: FearItemActionOption[], target: string, choice: string, label: string, hint: string) {
  out.push({ action: { type: "use-item", target, choice }, label, hint });
}
function marbleEligible(tags: readonly string[]) {
  // The source names the exclusions, while the enemy catalog has no positive
  // locomotion field. Treat unexcluded corporeal targets as walkers; this is
  // the minimal adapter and keeps the printed item usable without inventing tags.
  return !tags.some(tag => ["slithering", "flying", "immaterial", "giant-bug", "giant-insect", "giant-insects", "tentacled-horror", "tentacled-horrors", "giant-slug", "giant-slugs"].includes(tag));
}

/** Pure menu projection. Returned actions are the exact actions accepted by applyFearItemSourceAction. */
export function fearItemSourceActions(definition: FearDefinition, state: FearState, moment: FearItemMoment): FearItemActionOption[] {
  const out: FearItemActionOption[] = [];
  if (moment.kind === "menu") {
    for (const id of ["dog-food", "cat-food", "protein-bar", "energy-drinks"])
      if (count(state, id) > 0) add(out, "source-food", id, `食用${definition.items?.[id]?.label ?? id}`, "将1件转为1点食物");
    if (count(state, "first-aid-supplies") > 0 && state.hp < state.maxHp) add(out, "source-bandage", "heal", "使用急救用品恢复1点生命", "消耗急救用品");
    if (count(state, "inspirational-quotes") > 0 && state.xp > 0 && number(state, "fear:item:quotes:uses") === 0)
      add(out, "source-item-read", "inspirational-quotes", "花费1点经验阅读励志语录", "随后3次避免理智损失检定+1");
    if (coffeeUses(state) > 0 && number(state, "fear:item:drunk:boxes") > 0)
      add(out, "source-drink", "coffee", "饮用咖啡缩短醉酒时间", `剩余${coffeeUses(state)}次；本次减少1格`);
    if (count(state, "bulletproof-vest") > 0 && state.missionProgress["fear:item:worn:bulletproof-vest"] !== true)
      add(out, "source-wear", "bulletproof-vest", "穿上防弹背心", "穿戴占用2个携带物品槽");
    if (count(state, "helmet") > 0 && state.missionProgress["fear:item:worn:helmet"] !== true)
      add(out, "source-wear", "helmet", "戴上头盔", "穿戴时不占携带槽");
    for (const id of ["dark-clothes", "smart-clothes", "sportswear"])
      if (count(state, id) > 0 && state.missionProgress[`fear:item:worn:${id}`] !== true)
        add(out, "source-wear", id, `穿上${definition.items?.[id]?.label ?? id}`, "同一时间只能穿着一套衣物；穿着时不占携带槽");
  } else if (moment.kind === "before-encounter") {
    if (count(state, "wine") > 0 && number(state, "fear:item:drunk:boxes") === 0)
      add(out, "source-drink", "wine", "战斗前饮用一瓶烈酒", "攻击与防御−1，忽略本次遭遇首次理智损失；持续D6格，期间不能驱魔、仪式或学习书籍");
    const members = encounterMembers(moment);
    if (members.every(isCanine) && count(state, "dog-food") > 0)
      add(out, "source-avoid-encounter", "dog-food", "用狗粮避免本次犬类遭遇", "消耗1罐；狼人不适用");
    if (members.every(isCatLike) && count(state, "cat-food") > 0)
      add(out, "source-avoid-encounter", "cat-food", "用猫粮避免本次猫类遭遇", "消耗1罐");
  } else if (moment.kind === "check") {
    if (moment.check === "charisma") {
      if (count(state, "bouquet") > 0) add(out, "source-item-bonus", "bouquet", "使用花束：魅力+1", "本次检定后消耗");
      if (count(state, "grooming-kit") > 0) add(out, "source-item-bonus", "grooming-kit", "使用梳洗用品：魅力+1", "本次检定后消耗");
      if (count(state, "toy") > 0 && (moment.enemyTags ?? []).some(tag => ["child", "kid"].includes(tag))) add(out, "source-item-bonus", "toy", "使用玩具：魅力+1", "仅儿童／孩子遭遇；本次检定后消耗");
      if (count(state, "smart-clothes") > 0 && state.missionProgress["fear:item:worn:smart-clothes"] === true && state.missionProgress["fear:item:used:smart-clothes"] !== true) add(out, "source-item-bonus", "smart-clothes", "体面衣物：魅力+1", "每局一次");
    }
    if (moment.check === "escape") {
      if (count(state, "toy") > 0 && (moment.enemyTags ?? []).some(tag => ["child", "kid"].includes(tag))) add(out, "source-item-bonus", "toy", "使用玩具：逃跑+1", "仅儿童／孩子遭遇；本次检定后消耗");
      if (count(state, "dog-toy") > 0 && ((moment.enemyTags ?? []).some(tag => ["canine", "dog", "hound"].includes(tag)) || /dog|hound/.test(moment.enemyId ?? ""))) add(out, "source-item-bonus", "dog-toy", "狗玩具：逃跑+1", "犬或猎犬遭遇；本次检定后消耗");
      if (count(state, "marbles") > 0 && marbleEligible(moment.enemyTags ?? [])) add(out, "source-item-bonus", "marbles", "撒弹珠：逃跑+1", "仅适用于会行走的生物；本次检定后消耗");
      if (count(state, "sportswear") > 0 && state.missionProgress["fear:item:worn:sportswear"] === true && state.missionProgress["fear:item:used:sportswear"] !== true) add(out, "source-item-bonus", "sportswear", "运动服：逃跑+1", "每局一次");
    }
    if (moment.check === "stealth" && count(state, "dark-clothes") > 0 && state.missionProgress["fear:item:worn:dark-clothes"] === true && state.missionProgress["fear:item:used:dark-clothes"] !== true) add(out, "source-item-bonus", "dark-clothes", "深色衣物：潜行+1", "每局一次");
  } else if (moment.kind === "combat-item" && count(state, "spray-can") > 0 && count(state, "lighter") > 0) {
    add(out, "source-spray-can", moment.enemyId, "使用喷雾罐与打火机喷火", "自动造成2点火焰伤害；火焰易伤目标3点；消耗喷雾罐");
  }
  return out;
}

/** Mutates only item/missionProgress resources and returns explicit effects for the main loop to interpret. */
export function applyFearItemSourceAction(definition: FearDefinition, state: FearState, action: FearAction, dice: FearDice, moment: FearItemMoment): FearItemSourceResult {
  if (action.type !== "use-item") return { handled: false, effects: [] };
  const option = fearItemSourceActions(definition, state, moment).find(value => value.action.target === action.target && value.action.choice === action.choice);
  if (!option) return { handled: false, effects: [] };
  const id = action.choice ?? "", effects: FearItemSourceEffect[] = [];
  if (action.target === "source-food") {
    consume(state, id); state.food++;
    if (id === "energy-drinks") {
      const consecutive = number(state, "fear:item:energy-drink:consecutive") + 1;
      state.missionProgress["fear:item:energy-drink:consecutive"] = consecutive;
      if (consecutive >= 2) state.missionProgress["fear:item:energy-drink:magic-penalty"] = -1;
    } else state.missionProgress["fear:item:energy-drink:consecutive"] = 0;
    effects.push({ type: "log", text: `${definition.items?.[id]?.label ?? id}计为1点食物。` });
  } else if (action.target === "source-bandage") {
    consume(state, "first-aid-supplies"); state.hp = Math.min(state.maxHp, state.hp + 1);
  } else if (action.target === "source-item-read") {
    state.xp--; state.missionProgress["fear:item:quotes:uses"] = 3;
  } else if (action.target === "source-drink") {
    if (id === "wine") {
      consume(state, id); state.missionProgress["fear:item:drunk:boxes"] = ordinaryD6(dice);
      state.missionProgress["fear:item:drunk:sanity-shield"] = true;
      state.missionProgress["fear:item:drunk:encounter-pending"] = true;
    } else {
      const remaining = Math.max(0, coffeeUses(state) - 1);
      state.missionProgress["fear:item:coffee:uses"] = remaining;
      const remainingPackages = Math.ceil(remaining / 6);
      if (remainingPackages > 0) state.inventory.coffee = remainingPackages;
      else delete state.inventory.coffee;
      state.missionProgress["fear:item:drunk:boxes"] = Math.max(0, number(state, "fear:item:drunk:boxes") - 1);
    }
  } else if (action.target === "source-wear") {
    if (["dark-clothes", "smart-clothes", "sportswear"].includes(id))
      for (const clothing of ["dark-clothes", "smart-clothes", "sportswear"]) state.missionProgress[`fear:item:worn:${clothing}`] = clothing === id;
    state.missionProgress[`fear:item:worn:${id}`] = true;
    if (id === "bulletproof-vest" && typeof state.missionProgress["fear:item:vest:life"] !== "number")
      state.missionProgress["fear:item:vest:life"] = 4;
    if (id === "helmet" && typeof state.missionProgress["fear:item:helmet:life"] !== "number")
      state.missionProgress["fear:item:helmet:life"] = 3;
  } else if (action.target === "source-avoid-encounter") {
    consume(state, id);
    effects.push({ type: "avoid-encounter", enemyId: moment.kind === "before-encounter" ? moment.enemyId : "" });
  } else if (action.target === "source-item-bonus") {
    const check = moment.kind === "check" ? moment.check : undefined;
    if (!check) return { handled: false, effects: [] };
    if (["bouquet", "grooming-kit", "toy", "dog-toy", "marbles"].includes(id)) consume(state, id);
    else state.missionProgress[`fear:item:used:${id}`] = true;
    effects.push({ type: "check-modifier", check, amount: 1, itemId: id });
  } else if (action.target === "source-spray-can" && moment.kind === "combat-item" && action.choice === moment.enemyId) {
    return applyFearSprayCan(definition, state, moment.enemyId);
  } else return { handled: false, effects: [] };
  return { handled: true, effects };
}

/** Handles the source per-damage D6. The repeated 5 in the combined gear sentence is retained in the audit; interpretation is 3/5 vest, 6 helmet. */
export function applyFearItemSourceDamage(state: FearState, damage: number, dice: FearDice): FearItemDamageResult {
  if (!Number.isInteger(damage) || damage < 0) throw new Error("Incoming damage must be a nonnegative integer");
  let playerDamage = damage, vest = 0, helmet = 0;
  const effects: FearItemSourceEffect[] = [];
  const vestOn = state.missionProgress["fear:item:worn:bulletproof-vest"] === true;
  const helmetOn = state.missionProgress["fear:item:worn:helmet"] === true;
  if (damage && (vestOn || helmetOn)) {
    const face = dice(1, 7);
    const vestHit = vestOn && number(state, "fear:item:vest:life") > 0 && (vestOn && helmetOn ? face === 3 || face === 5 : face === 4 || face === 5);
    const helmetHit = helmetOn && number(state, "fear:item:helmet:life") > 0 && face === 6;
    if (vestHit) {
      vest = damage; playerDamage = 0;
      const remainingLife = Math.max(0, number(state, "fear:item:vest:life") - damage);
      state.missionProgress["fear:item:vest:life"] = remainingLife;
      if (remainingLife === 0) {
        // Source: when the body armor loses its last Life it is rendered useless — the piece is
        // consumed, unworn, and the durability key cleared so a later piece lazy-initializes at 4.
        consume(state, "bulletproof-vest");
        state.missionProgress["fear:item:worn:bulletproof-vest"] = false;
        delete state.missionProgress["fear:item:vest:life"];
        effects.push({ type: "log", text: "护甲失去最后一点耐久，报废。" });
      }
    } else if (helmetHit) {
      helmet = damage; playerDamage = 0;
      const remainingLife = Math.max(0, number(state, "fear:item:helmet:life") - damage);
      state.missionProgress["fear:item:helmet:life"] = remainingLife;
      if (remainingLife === 0) {
        consume(state, "helmet");
        state.missionProgress["fear:item:worn:helmet"] = false;
        delete state.missionProgress["fear:item:helmet:life"];
        effects.push({ type: "log", text: "头盔失去最后一点耐久，报废。" });
      }
    }
    else if (vestOn && !helmetOn && face === 6) playerDamage = 0;
    effects.push({ type: "log", text: `防具检定掷出${face}。` });
  }
  return { damageToPlayer: playerDamage, absorbedByVest: vest, absorbedByHelmet: helmet, effects };
}

export function applyFearItemSourceXp(state: FearState, gainedXp: number): { extraXp: number; accumulated: number } {
  if (!Number.isInteger(gainedXp) || gainedXp < 0) throw new Error("Gained XP must be a nonnegative integer");
  if (!count(state, "diary")) return { extraXp: 0, accumulated: 0 };
  const key = "fear:item:diary:xp-progress", total = number(state, key) + gainedXp;
  const extraXp = Math.floor(total / 5); state.missionProgress[key] = total % 5;
  return { extraXp, accumulated: total % 5 };
}

/** Passive rules are applied once to the relevant source check; effects are consumed here. */
export function applyFearItemSourceCheck(state: FearState, moment: Extract<FearItemMoment, { kind: "check" }>): { modifier: number; effects: FearItemSourceEffect[] } {
  let modifier = 0; const effects: FearItemSourceEffect[] = [];
  if (moment.check === "defense" && (moment.enemyTags ?? []).includes("mummy") && count(state, "scarab") > 0 && state.missionProgress["fear:item:scarab:spent"] !== true) modifier++;
  if (moment.check === "sanity-avoid" && number(state, "fear:item:quotes:uses") > 0) {
    modifier++; state.missionProgress["fear:item:quotes:uses"] = number(state, "fear:item:quotes:uses") - 1;
  }
  if (number(state, "fear:item:drunk:boxes") > 0 && ["attack", "defense"].includes(moment.check)) modifier--;
  if (moment.check === "sanity-avoid" && state.missionProgress["fear:item:drunk:sanity-shield"] === true) {
    effects.push({ type: "block-sanity-loss", amount: 1, reason: "alcohol-first-loss" });
  }
  return { modifier, effects };
}

export function applyFearItemSourceMove(state: FearState, boxes: number): void {
  if (!Number.isInteger(boxes) || boxes < 0) throw new Error("Moved boxes must be a nonnegative integer");
  state.missionProgress["fear:item:drunk:boxes"] = Math.max(0, number(state, "fear:item:drunk:boxes") - boxes);
  if (state.missionProgress["fear:item:drunk:boxes"] === 0) state.missionProgress["fear:item:drunk:sanity-shield"] = false;
}

export function applyFearItemSourceEncounterEnd(state: FearState, enemyTags: string[]): void {
  if (enemyTags.includes("mummy") && count(state, "scarab") > 0) state.missionProgress["fear:item:scarab:spent"] = true;
  state.missionProgress["fear:item:drunk:sanity-shield"] = false;
}

/** The caller supplies source-identity because the current enemy catalog has no bird-demon tag. */
export function applyFearStuffedBirdBeforeAttack(state: FearState, isBirdShapedDemon: boolean): FearItemAttackInterception {
  if (!isBirdShapedDemon || count(state, "stuffed-bird") < 1) return { intercepted: false };
  consume(state, "stuffed-bird");
  return { intercepted: true, consumedItemId: "stuffed-bird" };
}

/** Battery check occurs after every shadow-creature encounter, if the flashlight is still usable. */
export function applyFearFlashlightEncounterEnd(state: FearState, isShadowEncounter: boolean, dice: FearDice): FearItemBatteryResult {
  const ownsFlashlight = count(state, "flashlight") > 0 || state.weaponIds.includes("flashlight") || state.weaponId === "flashlight";
  if (!isShadowEncounter || !ownsFlashlight || state.missionProgress["fear:item:flashlight:battery-out"] === true)
    return { checked: false, batteryFailed: false };
  const chanceFace = dice(1, 7);
  const batteryFailed = chanceFace === 1;
  if (batteryFailed) state.missionProgress["fear:item:flashlight:battery-out"] = true;
  return { checked: true, batteryFailed, chanceFace };
}

export function fearFlashlightUsable(state: FearState): boolean {
  return (count(state, "flashlight") > 0 || state.weaponIds.includes("flashlight") || state.weaponId === "flashlight")
    && state.missionProgress["fear:item:flashlight:battery-out"] !== true;
}

/** Call after adding coffee to inventory; one source item carries six uses but remains one carried object. */
export function registerFearSourceItemAcquisition(state: FearState, itemId: string, amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Acquired item amount must be a nonnegative integer");
  if (itemId !== "coffee" || amount === 0) return;
  const key = "fear:item:coffee:uses", stored = state.missionProgress[key];
  const currentUses = typeof stored === "number" && Number.isFinite(stored) ? Math.max(0, stored) : Math.max(0, count(state, "coffee") - amount) * 6;
  state.missionProgress[key] = currentUses + amount * 6;
}

export function fearItemSourceCoffeeUses(state: FearState): number { return coffeeUses(state); }

/** Only source-listed weapons are mapped; unknown tool names stay ordinary inventory. */
export function resolveFearItemSourceWeapon(itemId: string, dice: FearDice): FearItemSourceWeaponResolution | undefined {
  const direct = new Map<string, string>([
    ["axe", "axe"], ["baseball-bat", "baseball-bat"], ["hammer", "hammer"], ["shovel", "scythe-shovel"],
    ["flashlight", "flashlight"], ["hockey-or-golf-club", "hockey-stick"], ["antique-flail", "antique-flail"],
    ["kitchen-knife", "kitchen-knife"],
  ]);
  const mapped = direct.get(itemId);
  if (mapped) return { weaponId: mapped };
  if (itemId === "samurai-sword") {
    const qualityRoll = dice(1, 7);
    return { weaponId: qualityRoll <= 2 ? "katana" : "cheap-samurai-sword", qualityRoll };
  }
  return undefined;
}

/** Basic Fighter only; the source never grants the manual a Fighter Expert discount. */
export function fearItemSourceSkillLearningCost(state: FearState, skillId: string, level: number, baseCost: number): number {
  if (count(state, "martial-arts-manual") > 0 && skillId === "fighter" && level === 1) return Math.max(0, baseCost - 1);
  return baseCost;
}

export function fearItemSourceAllowsExorcismBook(state: FearState, arcaneId: string, hasFaith: boolean): boolean {
  return arcaneId === "exorcism" && hasFaith && count(state, "exorcism-book") > 0;
}

/** The first die face, not an exploding total, controls the source's discard-on-1 rule. */
export function applyFearCheapHolySymbolRoll(state: FearState, firstFace: number, targetSusceptible: boolean): { broke: boolean } {
  if (!Number.isInteger(firstFace) || firstFace < 1 || firstFace > 6) throw new Error("Symbol roll face must be a D6 face");
  const broke = targetSusceptible && firstFace === 1 && count(state, "cheap-holy-symbol") > 0;
  if (broke) consume(state, "cheap-holy-symbol");
  return { broke };
}

/** Consume the alcohol shield only at the central point where a positive SAN loss would be applied. */
export function consumeFearAlcoholSanityShieldOnLoss(state: FearState, actualLoss: number): { blocked: number; remainingLoss: number } {
  if (!Number.isInteger(actualLoss) || actualLoss < 0) throw new Error("Actual Sanity loss must be a nonnegative integer");
  if (actualLoss === 0 || state.missionProgress["fear:item:drunk:sanity-shield"] !== true)
    return { blocked: 0, remainingLoss: actualLoss };
  state.missionProgress["fear:item:drunk:sanity-shield"] = false;
  return { blocked: 1, remainingLoss: actualLoss - 1 };
}

export function fearItemSourceBlocksBooksOrRituals(state: FearState): boolean { return number(state, "fear:item:drunk:boxes") > 0; }
/** Source gives no expiry for the consecutive-drink Magic penalty; it persists for the run. */
export function fearItemSourceMagicModifier(state: FearState): number { return state.missionProgress["fear:item:energy-drink:magic-penalty"] === -1 ? -1 : 0; }

export function applyFearSprayCan(definition: FearDefinition, state: FearState, enemyId: string): FearItemSourceResult {
  if (count(state, "spray-can") < 1 || count(state, "lighter") < 1 || !definition.enemies[enemyId]) return { handled: false, effects: [] };
  consume(state, "spray-can");
  const enemy = definition.enemies[enemyId];
  const amount = (enemy.tags ?? []).some(tag => ["vulnerable-fire", "fire-vulnerable"].includes(tag)) ? 3 : 2;
  return { handled: true, effects: [{ type: "enemy-damage", enemyId, amount, damageType: "fire" }] };
}
