import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./helpers/story-fixtures.js";
const headers = { "x-requested-with": "cthulhu-web" };
async function register(
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers,
    payload: {
      inviteCode: "fa6ian-test",
      username,
      password: "dice-test-password",
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies[0].value;
}
test("arbitrary dice validate bounds and persist explicit player rolls across retry and restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coc-roll-")),
    databasePath = join(dir, "game.sqlite");
  let draws = 0,
    app = await buildApp({
      databasePath,
      dice: (_min, max) => {
        draws++;
        return max - 1;
      },
    });
  try {
    const token = await register(app, "骰子玩家"),
      other = await register(app, "另一个玩家");
    const post = (payload: object, session = token) =>
      app.inject({
        method: "POST",
        url: "/api/dice/rolls",
        headers,
        cookies: { session },
        payload,
      });
    for (const sides of [1, 2, 4, 6, 8, 10, 12, 20, 37, 100, 1_000_000_000]) {
      const body = { id: randomUUID(), purpose: "free", sides, count: 3 };
      const r = await post(body);
      assert.equal(r.statusCode, 200, r.body);
      assert.deepEqual(r.json().results, [sides, sides, sides]);
      assert.equal(r.json().total, sides * 3);
      const before = draws;
      assert.equal((await post(body)).body, r.body);
      assert.equal(draws, before);
      assert.equal((await post({ ...body, count: 2 })).statusCode, 409);
      assert.equal((await post(body, other)).statusCode, 404);
      assert.equal(
        (
          await app.inject({
            url: `/api/dice/rolls/${body.id}`,
            cookies: { session: other },
          })
        ).statusCode,
        404,
      );
    }
    for (const spec of [
      { sides: 0 },
      { sides: 6.5 },
      { sides: 1_000_000_001 },
      { count: 0 },
      { count: 101 },
      { purpose: "luck", sides: 20 },
      { results: [1] },
    ])
      assert.equal(
        (
          await post({
            id: randomUUID(),
            purpose: "free",
            sides: 6,
            count: 1,
            ...spec,
          })
        ).statusCode,
        400,
      );
    const body = { id: randomUUID(), purpose: "luck", sides: 6, count: 3 },
      r = await post(body),
      before = draws;
    await app.close();
    app = await buildApp({
      databasePath,
      dice: () => {
        throw new Error("should not draw on replay");
      },
    });
    assert.equal((await post(body)).body, r.body);
    assert.equal(draws, before);
    assert.equal(
      (
        await app.inject({
          url: `/api/dice/rolls/${body.id}`,
          cookies: { session: token },
        })
      ).body,
      r.body,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("creation requires a player luck receipt, forbids forged or foreign rolls, consumes once, and retries without drawing", async () => {
  let draws = 0;
  const app = await buildApp({
    dice: () => {
      draws++;
      return 4;
    },
  });
  try {
    const token = await register(app, "建卡玩家"),
      other = await register(app, "异人");
    const post = (url: string, payload: object, session = token) =>
      app.inject({
        method: "POST",
        url,
        headers,
        cookies: { session },
        payload,
      });
    const template = { templateId: "static-charlie", name: "玩家查理" },
      run = {
        storyId: "rules-fixture",
        presetId: "reporter",
        name: "玩家记者",
      };
    assert.equal((await post("/api/characters", template)).statusCode, 400);
    assert.equal((await post("/api/runs", run)).statusCode, 400);
    assert.equal(draws, 0);
    assert.equal(
      (await post("/api/characters", { ...template, luckRollId: randomUUID() }))
        .statusCode,
      404,
    );
    const free = (
      await post("/api/dice/rolls", {
        id: randomUUID(),
        purpose: "free",
        sides: 6,
        count: 3,
      })
    ).json();
    assert.equal(
      (await post("/api/characters", { ...template, luckRollId: free.id }))
        .statusCode,
      400,
    );
    const roll = (
        await post("/api/dice/rolls", {
          id: randomUUID(),
          purpose: "luck",
          sides: 6,
          count: 3,
        })
      ).json(),
      before = draws;
    const payload = { ...template, luckRollId: roll.id };
    assert.equal(
      (await post("/api/characters", payload, other)).statusCode,
      404,
    );
    assert.equal(
      (await post("/api/characters", { ...payload, luck: 90 })).statusCode,
      400,
    );
    const responses = await Promise.all([
      post("/api/characters", payload),
      post("/api/characters", payload),
    ]);
    assert.equal(responses[0].statusCode, 201);
    assert.equal(responses[0].body, responses[1].body);
    assert.equal(responses[0].json().character.luck, 60);
    assert.equal(draws, before);
    assert.equal(
      (await post("/api/characters", { ...payload, name: "另一张卡" }))
        .statusCode,
      409,
    );
    assert.equal(
      (await post("/api/runs", { ...run, luckRollId: roll.id })).statusCode,
      409,
    );
    const nextRoll = (
        await post("/api/dice/rolls", {
          id: randomUUID(),
          purpose: "luck",
          sides: 6,
          count: 3,
        })
      ).json(),
      runPayload = { ...run, luckRollId: nextRoll.id };
    const firstRun = await post("/api/runs", runPayload),
      prior = draws;
    assert.equal(firstRun.statusCode, 201);
    assert.equal(firstRun.json().character.luck, 60);
    assert.equal((await post("/api/runs", runPayload)).body, firstRun.body);
    assert.equal(draws, prior);
    assert.equal(
      (
        await app.inject({
          url: "/api/characters",
          cookies: { session: token },
        })
      ).json().length,
      2,
    );
    assert.equal(
      (
        await app.inject({ url: "/api/runs", cookies: { session: token } })
      ).json().length,
      1,
    );
  } finally {
    await app.close();
  }
});

test("version 1 migration preserves saved characters and runs while adding player roll storage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coc-roll-migration-")),
    databasePath = join(dir, "game.sqlite");
  let app = await buildApp({ databasePath, dice: () => 2 });
  try {
    const token = await register(app, "迁移玩家");
    const post = (url: string, payload: object) =>
      app.inject({
        method: "POST",
        url,
        headers,
        cookies: { session: token },
        payload,
      });
    const roll = (
      await post("/api/dice/rolls", {
        id: randomUUID(),
        purpose: "luck",
        sides: 6,
        count: 3,
      })
    ).json();
    const run = (
      await post("/api/runs", {
        storyId: "rules-fixture",
        presetId: "reporter",
        name: "旧档案",
        luckRollId: roll.id,
      })
    ).json();
    const characters = (
      await app.inject({ url: "/api/characters", cookies: { session: token } })
    ).json();
    await app.close();
    const { DatabaseSync } = await import("node:sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      "DROP TABLE dice_rolls; DROP TABLE shop_discarded_checks; DROP TABLE shop_check_windows; DROP TABLE shop_purchases; DROP TABLE achievement_claims; DROP TABLE shop_inventory; DROP TABLE shop_wallets; PRAGMA user_version=1;",
    );
    legacy.close();
    app = await buildApp({ databasePath, dice: () => 6 });
    assert.deepEqual(
      (
        await app.inject({
          url: "/api/characters",
          cookies: { session: token },
        })
      ).json(),
      characters,
    );
    assert.deepEqual(
      (
        await app.inject({
          url: `/api/runs/${run.runId}`,
          cookies: { session: token },
        })
      ).json(),
      run,
    );
    const newRoll = await post("/api/dice/rolls", {
      id: randomUUID(),
      purpose: "luck",
      sides: 6,
      count: 3,
    });
    assert.equal(newRoll.statusCode, 200);
    assert.equal(newRoll.json().total, 18);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
