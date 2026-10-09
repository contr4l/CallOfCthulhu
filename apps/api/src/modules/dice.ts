import { z } from "zod";
import { type DatabaseSync } from "node:sqlite";
import { GameError } from "../../../../packages/engine/index.js";
import {
  secureDice,
  type DiceSource,
} from "../../../../packages/rules/index.js";
import type { DiceRoll } from "../../../../packages/contracts/index.js";
export const rollSchema = z
  .object({
    id: z.string().uuid(),
    purpose: z.enum(["luck", "free"]),
    sides: z.number().int().min(1).max(1_000_000_000),
    count: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((d) => d.purpose !== "luck" || (d.sides === 6 && d.count === 3), {
    message: "幸运必须使用 3D6。",
  });
export function rollDice(
  db: DatabaseSync,
  owner: string,
  data: z.infer<typeof rollSchema>,
  dice: DiceSource = secureDice,
): DiceRoll {
  const existing = db
    .prepare("SELECT * FROM dice_rolls WHERE id=?")
    .get(data.id);
  if (existing) {
    if (existing.user_id !== owner)
      throw new GameError(404, "骰子记录不存在。");
    if (
      existing.purpose !== data.purpose ||
      existing.sides !== data.sides ||
      existing.count !== data.count
    )
      throw new GameError(409, "同一次掷骰不能更改面数或用途。");
    return JSON.parse(existing.payload as string);
  }
  const results = Array.from({ length: data.count }, () =>
    dice(1, data.sides + 1),
  );
  if (results.some((v) => !Number.isInteger(v) || v < 1 || v > data.sides))
    throw new Error("随机源返回无效骰子结果");
  const roll: DiceRoll = {
    ...data,
    results,
    total: results.reduce((a, b) => a + b, 0),
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    "INSERT INTO dice_rolls(id,user_id,purpose,sides,count,payload) VALUES(?,?,?,?,?,?)",
  ).run(
    data.id,
    owner,
    data.purpose,
    data.sides,
    data.count,
    JSON.stringify(roll),
  );
  return roll;
}
// Must run within the same transaction as character/run creation.
export function creationRoll(
  db: DatabaseSync,
  owner: string,
  id: string,
  requestHash: string,
) {
  const row = db
    .prepare("SELECT * FROM dice_rolls WHERE id=? AND user_id=?")
    .get(id, owner);
  if (!row) throw new GameError(404, "找不到建卡掷骰记录，请先掷幸运骰。");
  if (row.purpose !== "luck")
    throw new GameError(400, "该掷骰记录不能用于角色创建。");
  if (row.creation_hash && row.creation_hash !== requestHash)
    throw new GameError(409, "这次幸运掷骰已用于另一份角色档案。");
  const roll = JSON.parse(row.payload as string) as DiceRoll;
  return {
    luck: roll.total * 5,
    replay: row.creation_response
      ? JSON.parse(row.creation_response as string)
      : undefined,
  };
}
export function saveCreation(
  db: DatabaseSync,
  id: string,
  requestHash: string,
  response: unknown,
) {
  db.prepare(
    "UPDATE dice_rolls SET creation_hash=?,creation_response=? WHERE id=?",
  ).run(requestHash, JSON.stringify(response), id);
}
