import type { InventoryItem, RunState } from "../contracts/index.js";
import { companion } from "./party.js";

function invalid(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}
export function inventoryFor(state: RunState, member = "$player"): InventoryItem[] {
  return member === "$player" ? state.inventory : companion(state, member).inventory;
}
export function itemCount(state: RunState, key: string, member = "$player") {
  const item = inventoryFor(state, member).find(item => item.key === key);
  return item ? item.quantity ?? 1 : 0;
}
export function setItemCount(state: RunState, key: string, label: string, count: number, member = "$player") {
  if (!Number.isSafeInteger(count) || count < 0) invalid("物品数量须为非负整数");
  const inventory = inventoryFor(state, member), index = inventory.findIndex(item => item.key === key);
  if (count === 0) { if (index >= 0) inventory.splice(index, 1); return; }
  const item = { key, label, quantity: count };
  if (index >= 0) inventory[index] = item;
  else inventory.push(item);
}
