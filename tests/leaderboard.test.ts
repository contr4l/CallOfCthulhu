import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { leaderboardFixture, rankingHeaders } from "./fixtures/leaderboard.js";
import { openDatabase } from "../apps/api/src/storage/database.js";
import type { Leaderboard } from "../packages/community/leaderboard.js";

test("all registered users share confirmed, version-deduplicated rankings with stable ties, pagination and no private data", async () => {
  const t = await leaderboardFixture();
  try {
    const read = async (query = "", cookies = t.current.cookies) => {
      const response = await t.app.inject({
        url: `/api/leaderboard${query}`,
        cookies,
      });
      assert.equal(response.statusCode, 200, response.body);
      return response.json<Leaderboard>();
    };
    assert.equal(
      (await t.app.inject({ url: "/api/leaderboard" })).statusCode,
      401,
    );
    for (const query of [
      "?sort=wallet",
      "?page=0",
      "?page=1.2",
      "?limit=51",
      "?owner=someone",
      "?page=999999999",
    ])
      assert.equal(
        (
          await t.app.inject({
            url: `/api/leaderboard${query}`,
            cookies: t.current.cookies,
          })
        ).statusCode,
        400,
      );
    const first = await read("?limit=1");
    assert.deepEqual(first.summary, {
      registeredUsers: 24,
      startedUsers: 3,
      completedRuns: 5,
      collectedEndings: 4,
    });
    assert.equal(first.entries.length, 1);
    assert.equal(first.entries[0].rank, 1);
    assert.equal(first.totalPages, 24);
    assert.equal(first.currentUser?.rank, 3);
    assert.equal(first.currentUser?.collectedEndings, 0);
    const second = await read("?limit=1&page=2");
    assert.equal(second.entries[0].rank, 1);
    assert.notEqual(first.entries[0].username, second.entries[0].username);
    const all = await read("?limit=50");
    assert.equal(all.entries.length, 24);
    const a = all.entries.find((entry) => entry.username === "领航员")!;
    const b = all.entries.find((entry) => entry.username === "追迹者")!;
    assert.deepEqual(
      [a.collectedEndings, a.completedRuns, a.completedStories, a.earnedPoints],
      [2, 3, 1, 5],
    );
    assert.deepEqual(
      [b.collectedEndings, b.completedRuns, b.completedStories, b.earnedPoints],
      [2, 2, 2, 4],
    );
    assert.equal(all.entries.filter((entry) => entry.isCurrentUser).length, 1);
    assert.equal(
      all.entries.filter((entry) => entry.startedRuns === 0).length,
      21,
    );
    assert.equal((await read("?sort=stories")).entries[0].username, "追迹者");
    assert.equal((await read("?sort=runs")).entries[0].username, "领航员");
    assert.equal((await read("?sort=points")).entries[0].username, "领航员");
    assert.equal((await read("?page=999")).page, 2);
    const foreign = await read("", t.accounts[0].cookies);
    assert.equal(foreign.currentUser?.username, "领航员");
    const body = JSON.stringify(all);
    for (const account of t.accounts) {
      assert.ok(!body.includes(account.id));
      assert.ok(!body.includes(account.cookies.session));
    }
    for (const privateValue of [
      "password_hash",
      "a-old",
      "c-pending",
      "困难奖励",
      "生还奖励",
      "runId",
      "endingId",
      "claimedAt",
    ])
      assert.ok(!body.includes(privateValue), privateValue);
    await t.restart();
    assert.deepEqual(await read("?limit=50"), all);
    const db = openDatabase(t.databasePath);
    const before = db.prepare("SELECT state FROM runs ORDER BY id").all();
    await read();
    assert.deepEqual(
      db.prepare("SELECT state FROM runs ORDER BY id").all(),
      before,
    );
    assert.equal(
      db
        .prepare("SELECT balance FROM shop_wallets WHERE user_id=?")
        .get(t.accounts[0].id)?.balance,
      0,
    );
    db.close();
    // A genuine new playthrough updates the ranking, before reward claiming.
    const post = (url: string, payload: Record<string, unknown>) =>
      t.app.inject({
        method: "POST",
        url,
        cookies: t.current.cookies,
        headers: rankingHeaders,
        payload,
      });
    const luck = await post("/api/dice/rolls", {
      id: randomUUID(),
      purpose: "luck",
      sides: 6,
      count: 3,
    });
    const run = await post("/api/runs", {
      storyId: "alone-against-flames",
      presetId: "actor",
      name: "排行验收",
      luckRollId: luck.json().id,
    });
    assert.equal(run.statusCode, 201, run.body);
    const finished = await post(`/api/runs/${run.json().runId}/commands`, {
      commandId: randomUUID(),
      expectedRevision: run.json().revision,
      actionId: "earn-hard",
    });
    assert.equal(finished.statusCode, 200, finished.body);
    const updated = await read();
    assert.deepEqual(
      [
        updated.currentUser?.collectedEndings,
        updated.currentUser?.completedRuns,
        updated.currentUser?.earnedPoints,
      ],
      [1, 1, 3],
    );
    assert.equal(updated.summary.completedRuns, 6);
  } finally {
    await t.close();
  }
});
