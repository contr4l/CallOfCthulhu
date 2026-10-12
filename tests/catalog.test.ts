import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../apps/api/src/app.js";
import { loadStories } from "../apps/api/src/catalog.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("production catalog excludes retired demos and test fixtures", async () => {
  const stories = loadStories("stories");
  assert.ok(stories.has("alone-against-flames@1.1.0"));
  assert.ok(stories.has("alone-against-static@1.0.0"));
  const removed = [
    "black-tide",
    "last-train",
    "rules-fixture",
    "collection-fixture",
  ];
  assert.ok(
    [...stories.values()].every((story) => !removed.includes(story.id)),
  );
  const app = await buildApp();
  try {
    const response = await app.inject("/api/stories");
    assert.equal(response.statusCode, 200);
    assert.ok(
      response
        .json()
        .every((story: { id: string }) => !removed.includes(story.id)),
    );
    for (const id of removed)
      assert.equal((await app.inject(`/api/stories/${id}`)).statusCode, 404);
  } finally {
    await app.close();
  }
});

test("retired saved runs do not break the account run list or erase saved data", async () => {
  const root = mkdtempSync(join(tmpdir(), "coc-retired-"));
  const databasePath = join(root, "game.sqlite");
  const app = await buildApp({ databasePath });
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: { "x-requested-with": "cthulhu-web" },
      payload: {
        inviteCode: "fa6ian-test",
        username: "下架测试",
        password: "retirement-testing-password",
      },
    });
    assert.equal(registered.statusCode, 200);
    const db = new DatabaseSync(databasePath);
    try {
      const owner = db
        .prepare("SELECT id FROM users WHERE username=?")
        .get("下架测试")!;
      const now = new Date().toISOString();
      db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        "retired-save",
        owner.id,
        "black-tide",
        "1.0.0",
        "coc7-subset@1",
        "1.0.0",
        0,
        JSON.stringify({ character: { name: "调查员" } }),
        now,
        now,
      );
      const cookies = { session: registered.cookies[0].value };
      const response = await app.inject({ url: "/api/runs", cookies });
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json(), []);
      assert.equal(
        (await app.inject({ url: "/api/runs/retired-save", cookies }))
          .statusCode,
        503,
      );
      assert.equal(
        db
          .prepare("SELECT COUNT(*) AS count FROM runs WHERE id=?")
          .get("retired-save")!.count,
        1,
      );
    } finally {
      db.close();
    }
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
