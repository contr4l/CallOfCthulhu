import type { DatabaseSync } from "node:sqlite";
import type {
  ShopItemId,
  ShopState,
} from "../../../../packages/contracts/shop.js";
import type { Story } from "../../../../packages/contracts/index.js";
import { readAchievements } from "./achievements.js";
import {
  STATIC_UNLOCK,
  SHOP_ITEMS,
} from "../../../../packages/contracts/shop.js";
import { GameError } from "../../../../packages/engine/index.js";

export function hasStaticAccess(db: DatabaseSync, owner: string): boolean {
  // Retain access for accounts that already played this module before the gate.
  return (
    !!db
      .prepare(
        "SELECT 1 FROM shop_inventory WHERE user_id=? AND item_id=? AND quantity>0",
      )
      .get(owner, `story:${STATIC_UNLOCK.storyId}`) ||
    !!db
      .prepare("SELECT 1 FROM runs WHERE user_id=? AND story_id=? LIMIT 1")
      .get(owner, STATIC_UNLOCK.storyId)
  );
}
export function readShop(
  db: DatabaseSync,
  owner: string,
  stories: Map<string, Story>,
): ShopState {
  const wallet = db
    .prepare("SELECT balance FROM shop_wallets WHERE user_id=?")
    .get(owner);
  const inventory: ShopState["inventory"] = { reroll: 0, "target-plus-10": 0 };
  for (const row of db
    .prepare("SELECT item_id,quantity FROM shop_inventory WHERE user_id=?")
    .all(owner))
    if (String(row.item_id) in inventory)
      inventory[row.item_id as ShopItemId] = Number(row.quantity);
  return {
    storyUnlock: {
      ...STATIC_UNLOCK,
      completedEndings: readAchievements(db, owner, stories).filter(
        (entry) =>
          entry.storyId === STATIC_UNLOCK.prerequisiteStoryId &&
          entry.unlockedAt,
      ).length,
      unlocked: hasStaticAccess(db, owner),
    },
    balance: Number(wallet?.balance ?? 0),
    inventory,
    items: SHOP_ITEMS,
  };
}
export function consumeItem(db: DatabaseSync, owner: string, item: ShopItemId) {
  const changed = db
    .prepare(
      "UPDATE shop_inventory SET quantity=quantity-1 WHERE user_id=? AND item_id=? AND quantity>0",
    )
    .run(owner, item);
  if (changed.changes !== 1)
    throw new GameError(409, "道具数量不足，请先到商店购买。");
}
export function purchase(
  db: DatabaseSync,
  owner: string,
  requestId: string,
  itemId: ShopItemId,
  stories: Map<string, Story>,
) {
  const saved = db
    .prepare(
      "SELECT item_id,response FROM shop_purchases WHERE user_id=? AND request_id=?",
    )
    .get(owner, requestId);
  if (saved) {
    if (saved.item_id !== itemId)
      throw new GameError(409, "重复购买请求内容不一致。");
    return readShop(db, owner, stories);
  }
  const item = SHOP_ITEMS.find((item) => item.id === itemId)!;
  const debit = db
    .prepare(
      "UPDATE shop_wallets SET balance=balance-? WHERE user_id=? AND balance>=?",
    )
    .run(item.price, owner, item.price);
  if (debit.changes !== 1) throw new GameError(409, "余烬点不足。");
  db.prepare(
    "INSERT INTO shop_inventory VALUES(?,?,1) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=quantity+1",
  ).run(owner, itemId);
  const result = readShop(db, owner, stories);
  db.prepare("INSERT INTO shop_purchases VALUES(?,?,?,?)").run(
    owner,
    requestId,
    itemId,
    JSON.stringify(result),
  );
  return result;
}

export function unlockStatic(
  db: DatabaseSync,
  owner: string,
  requestId: string,
  stories: Map<string, Story>,
): ShopState {
  const itemId = `story:${STATIC_UNLOCK.storyId}`;
  const saved = db
    .prepare(
      "SELECT item_id FROM shop_purchases WHERE user_id=? AND request_id=?",
    )
    .get(owner, requestId);
  if (saved && saved.item_id !== itemId)
    throw new GameError(409, "重复购买请求内容不一致。");
  const state = readShop(db, owner, stories);
  if (saved || state.storyUnlock.unlocked) return state;
  if (state.storyUnlock.completedEndings < STATIC_UNLOCK.requiredEndings)
    throw new GameError(409, "请先完成《向火独行》的三个不同结局。");
  const debit = db
    .prepare(
      "UPDATE shop_wallets SET balance=balance-? WHERE user_id=? AND balance>=?",
    )
    .run(STATIC_UNLOCK.price, owner, STATIC_UNLOCK.price);
  if (debit.changes !== 1)
    throw new GameError(409, "余烬点不足，请先在成就页领取奖励。");
  db.prepare("INSERT INTO shop_inventory VALUES(?,?,1)").run(owner, itemId);
  const result = readShop(db, owner, stories);
  db.prepare("INSERT INTO shop_purchases VALUES(?,?,?,?)").run(
    owner,
    requestId,
    itemId,
    JSON.stringify(result),
  );
  return result;
}
