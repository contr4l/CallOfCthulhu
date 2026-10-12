import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../../apps/api/src/storage/database.js";
/** Route tests start with a purchased entitlement; shop tests cover earning and buying it. */
export function staticAccessFixture() {
  const root = mkdtempSync(join(tmpdir(), "coc-static-access-"));
  const databasePath = join(root, "state.sqlite");
  return {
    databasePath,
    unlock(owner: string) {
      const db = openDatabase(databasePath);
      try {
        db.prepare("INSERT INTO shop_inventory VALUES(?,?,1)").run(
          owner,
          "story:alone-against-static",
        );
      } finally {
        db.close();
      }
    },
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
