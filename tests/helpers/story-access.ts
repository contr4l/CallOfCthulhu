import { openDatabase } from "../../apps/api/src/storage/database.js";

/** Explicit purchased entitlement for isolated gameplay tests, never a production bypass. */
export function grantStoryAccess(
  databasePath: string,
  owner: string,
  storyId: string,
) {
  const db = openDatabase(databasePath);
  try {
    db.prepare(
      "INSERT INTO shop_inventory VALUES(?,?,1) ON CONFLICT(user_id,item_id) DO UPDATE SET quantity=MAX(quantity,1)",
    ).run(owner, `story:${storyId}`);
  } finally {
    db.close();
  }
}
