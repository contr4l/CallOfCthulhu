import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "./helpers/story-fixtures.js";
import type {
  SceneView,
  CommandResponse,
} from "../packages/contracts/index.js";
import {
  endingAchievementId,
  type Achievement,
} from "../packages/contracts/achievements.js";
import { readAchievements } from "../apps/api/src/modules/achievements.js";
import { openDatabase } from "../apps/api/src/storage/database.js";
import { loadStories } from "./helpers/story-fixtures.js";

const headers = { "x-requested-with": "cthulhu-web" };
test("distinct endings unlock once per account, survive retries and restart, and recover old saves without spoilers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coc-achievements-"));
  const databasePath = join(directory, "game.sqlite");
  let app = await buildApp({ databasePath, dice: (min) => min });
  try {
    const register = async (username: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers,
        payload: {
          inviteCode: "fa6ian-test",
          username,
          password: "achievement-testing-password",
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      return { session: response.cookies[0].value };
    };
    const cookies = await register("成就旅人");
    const foreign = await register("另一位旅人");
    const read = async (who = cookies) => {
      const response = await app.inject({
        url: "/api/achievements",
        cookies: who,
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json<Achievement[]>();
    };
    assert.equal(
      (await app.inject({ url: "/api/achievements" })).statusCode,
      401,
    );
    const initial = await read();
    assert.equal(
      initial.filter((entry) => entry.storyId === "alone-against-flames")
        .length,
      16,
    );
    assert.ok(initial.every((entry) => !entry.unlockedAt && !entry.runId));
    assert.ok(!JSON.stringify(initial).includes("测试结局：home"));
    assert.ok(!JSON.stringify(initial).includes("测试结局：loop"));
    let firstRun: string | undefined;
    for (const ending of ["step", "step", "wait"]) {
      const roll = await app.inject({
        method: "POST",
        url: "/api/dice/rolls",
        headers,
        cookies,
        payload: { id: randomUUID(), purpose: "luck", sides: 6, count: 3 },
      });
      const creation = await app.inject({
        method: "POST",
        url: "/api/runs",
        headers,
        cookies,
        payload: {
          storyId: "collection-fixture",
          presetId: "reporter",
          name: "成就旅人",
          luckRollId: roll.json().id,
        },
      });
      assert.equal(creation.statusCode, 201, creation.body);
      let scene = creation.json<SceneView>();
      firstRun ??= scene.runId;
      const before = await read();
      for (const actionId of ["talk", "continue", ending]) {
        const body = {
          commandId: randomUUID(),
          expectedRevision: scene.revision,
          actionId,
        };
        const request = {
          method: "POST" as const,
          url: `/api/runs/${scene.runId}/commands`,
          headers,
          cookies,
          payload: body,
        };
        const response = await app.inject(request);
        assert.equal(response.statusCode, 200, response.body);
        scene = response.json<CommandResponse>().scene;
        assert.equal((await app.inject(request)).body, response.body);
        if (scene.status !== "ended") assert.deepEqual(await read(), before);
      }
    }
    const unlocked = (await read()).filter((entry) => entry.unlockedAt);
    assert.equal(unlocked.length, 2);
    assert.deepEqual(
      unlocked.map((entry) => entry.title).sort(),
      ["测试结局：home", "测试结局：loop"].sort(),
    );
    const home = unlocked.find(
      (entry) => entry.id === endingAchievementId("collection-fixture", "home"),
    )!;
    assert.equal(home.runId, firstRun);
    assert.ok(home.unlockedAt);
    assert.ok(!JSON.stringify(await read()).includes("测试结局：rescue"));
    assert.ok((await read(foreign)).every((entry) => !entry.unlockedAt));
    const beforeRestart = await read();
    await app.close();
    // Existing games did not always store explicit ending collection keys.
    const db = new DatabaseSync(databasePath);
    for (const row of db
      .prepare("SELECT run_id, sequence, frame FROM run_history")
      .all()) {
      const frame = JSON.parse(row.frame as string);
      delete frame.scene.collection;
      db.prepare(
        "UPDATE run_history SET frame=? WHERE run_id=? AND sequence=?",
      ).run(JSON.stringify(frame), row.run_id, row.sequence);
    }
    db.close();
    app = await buildApp({
      databasePath,
      dice: () => {
        throw new Error("浏览成就不能掷骰");
      },
    });
    assert.deepEqual(await read(), beforeRestart);
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ending identity is shared across content versions and an active or foreign history cannot unlock it", () => {
  const db = openDatabase(":memory:");
  try {
    const story = loadStories("stories").get("collection-fixture@1.0.0")!;
    const newer = { ...story, version: "1.1.0" };
    const stories = new Map([
      ["collection-fixture@1.0.0", story],
      ["collection-fixture@1.1.0", newer],
    ]);
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(
      "player",
      "player",
      "hash",
    );
    db.prepare("INSERT INTO users VALUES(?,?,?)").run(
      "foreign",
      "foreign",
      "hash",
    );
    for (const [id, owner, version, at, status] of [
      ["old", "player", "1.0.0", "2026-01-01T00:00:00Z", "ended"],
      ["new", "player", "1.1.0", "2026-02-01T00:00:00Z", "ended"],
      ["active", "player", "1.1.0", "2025-01-01T00:00:00Z", "active"],
      ["foreign-run", "foreign", "1.1.0", "2024-01-01T00:00:00Z", "ended"],
    ]) {
      db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        id,
        owner,
        story.id,
        version,
        story.rulesVersion,
        "test",
        1,
        "{}",
        at,
        at,
      );
      db.prepare("INSERT INTO run_history VALUES(?,?,?)").run(
        id,
        1,
        JSON.stringify({
          createdAt: at,
          scene: { status, collection: { endingId: "home" } },
        }),
      );
    }
    const result = readAchievements(db, "player", stories);
    assert.equal(result.length, 3);
    assert.equal(result.filter((entry) => entry.unlockedAt).length, 1);
    assert.equal(result[0].unlockedAt, "2026-01-01T00:00:00Z");
    assert.equal(result[0].runId, "old");
    stories.set("collection-fixture@1.1.0", {
      ...newer,
      nodes: newer.nodes.filter((node) => node.id !== "loop"),
    });
    assert.equal(readAchievements(db, "player", stories).length, 2);
    db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      "retired",
      "player",
      story.id,
      "1.0.0",
      story.rulesVersion,
      "test",
      1,
      "{}",
      "2026-03-01",
      "2026-03-01",
    );
    db.prepare("INSERT INTO run_history VALUES(?,?,?)").run(
      "retired",
      1,
      JSON.stringify({
        createdAt: "2026-03-01T00:00:00Z",
        scene: { status: "ended", collection: { endingId: "loop" } },
      }),
    );
    const preserved = readAchievements(db, "player", stories);
    assert.equal(preserved.length, 3);
    assert.equal(
      preserved.find((entry) => entry.endingId === "loop")!.title,
      "测试结局：loop",
    );
    assert.ok(preserved.find((entry) => entry.endingId === "loop")!.unlockedAt);
  } finally {
    db.close();
  }
});
