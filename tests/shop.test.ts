import { fixture } from "./fixtures/shop-story.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../apps/api/src/storage/database.js";
import { resolveCheck } from "../packages/rules/index.js";
import type {
  Story,
  SceneView,
  CommandResponse,
} from "../packages/contracts/index.js";
import { endingAchievementId } from "../packages/contracts/achievements.js";
const headers = { "x-requested-with": "cthulhu-web" };
// Isolated test fixture using existing reward IDs; never published or added to the game catalog.
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "coc-shop-"));
  const storyRoot = join(root, "stories");
  const packageRoot = join(storyRoot, fixture.id, fixture.version);
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(join(packageRoot, "story.json"), JSON.stringify(fixture));
  const staticRoot = join(storyRoot, "alone-against-static", fixture.version);
  mkdirSync(staticRoot, { recursive: true });
  writeFileSync(
    join(staticRoot, "story.json"),
    JSON.stringify({
      ...fixture,
      id: "alone-against-static",
      title: "静躁独行测试",
    }),
  );
  const databasePath = join(root, "state.sqlite");
  let draws: number[] = [];
  const makeApp = () =>
    buildApp({
      storyRoot,
      databasePath,
      dice: (min) => (draws.length ? draws.shift()! : min),
    });
  let app = await makeApp();
  const register = async (name: string) => {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: {
        username: name,
        password: "shop-testing-password",
        inviteCode: "fa6ian-test",
      },
    });
    assert.equal(r.statusCode, 200);
    return { session: r.cookies[0].value };
  };
  const cookies = await register("商店测试玩家");
  const post = (url: string, payload: Record<string, unknown>, who = cookies) =>
    app.inject({ method: "POST", url, headers, cookies: who, payload });
  const read = async () =>
    (await app.inject({ url: "/api/shop", cookies })).json();
  const start = async () => {
    const luck = await post("/api/dice/rolls", {
      id: randomUUID(),
      purpose: "luck",
      sides: 6,
      count: 3,
    });
    const r = await post("/api/runs", {
      storyId: fixture.id,
      presetId: "actor",
      name: "商店旅人",
      luckRollId: luck.json().id,
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json<SceneView>();
  };
  const command = async (
    scene: SceneView,
    actionId: string,
    extra: Record<string, unknown> = {},
  ) => {
    const payload = {
      commandId: randomUUID(),
      expectedRevision: scene.revision,
      actionId,
      ...extra,
    };
    const r = await post(`/api/runs/${scene.runId}/commands`, payload);
    assert.equal(r.statusCode, 200, r.body);
    return { body: r.json<CommandResponse>(), payload };
  };
  const earn = async (action: string, id: string) => {
    const s = await start();
    await command(s, action);
    return post(
      `/api/achievements/${encodeURIComponent(endingAchievementId(fixture.id, id))}/claim`,
      {},
    );
  };
  const fund = async () => {
    assert.equal((await earn("earn-hard", "255")).statusCode, 200);
    assert.equal((await earn("earn-easy", "223-end")).statusCode, 200);
  };
  return {
    root,
    databasePath,
    get app() {
      return app;
    },
    restart: async (beforeOpen?: () => void) => {
      await app.close();
      beforeOpen?.();
      app = await makeApp();
    },
    cookies,
    post,
    read,
    start,
    command,
    earn,
    fund,
    register,
    setDraws: (next: number[]) => (draws = next),
    close: async () => {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("ending rewards vary, are claimed once per account, and purchases are authenticated and idempotent", async () => {
  const t = await setup();
  try {
    assert.equal((await t.app.inject({ url: "/api/shop" })).statusCode, 401);
    assert.equal(
      (
        await t.post("/api/shop/purchases", {
          requestId: randomUUID(),
          itemId: "reroll",
        })
      ).statusCode,
      409,
    );
    const locked = await t.post(
      `/api/achievements/${encodeURIComponent(endingAchievementId(fixture.id, "255"))}/claim`,
      {},
    );
    assert.equal(locked.statusCode, 409);
    await t.fund();
    assert.equal((await t.read()).balance, 5);
    assert.equal(
      (
        await t.post(
          `/api/achievements/${encodeURIComponent(endingAchievementId(fixture.id, "255"))}/claim`,
          { points: 99999 },
        )
      ).statusCode,
      400,
    );
    assert.equal((await t.read()).balance, 5);
    const duplicate = await t.earn("earn-hard", "255");
    assert.equal(duplicate.json().balance, 5);
    const foreign = await t.register("另一位商店玩家");
    assert.equal(
      (
        await t.post(
          `/api/achievements/${encodeURIComponent(endingAchievementId(fixture.id, "255"))}/claim`,
          {},
          foreign,
        )
      ).statusCode,
      409,
    );
    const request = { requestId: randomUUID(), itemId: "reroll" };
    const bought = await t.post("/api/shop/purchases", request);
    assert.equal(bought.statusCode, 200);
    assert.deepEqual(
      (await t.post("/api/shop/purchases", request)).json(),
      bought.json(),
    );
    assert.equal((await t.read()).inventory.reroll, 1);
    assert.equal(
      (
        await t.post("/api/shop/purchases", {
          ...request,
          itemId: "target-plus-10",
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await t.post("/api/shop/purchases", {
          requestId: randomUUID(),
          itemId: "reroll",
          price: 0,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await t.post("/api/shop/purchases", {
          requestId: randomUUID(),
          itemId: "target-plus-10",
        })
      ).statusCode,
      200,
    );
    assert.equal((await t.read()).balance, 0);
  } finally {
    await t.close();
  }
});
test("reroll restores pre-check consequences, retains original dice, gates rewards and survives restart", async () => {
  const t = await setup();
  try {
    await t.fund();
    await t.post("/api/shop/purchases", {
      requestId: randomUUID(),
      itemId: "reroll",
    });
    let s = await t.start();
    s = (await t.command(s, "check")).body.scene;
    t.setDraws([8, 3]);
    const first = await t.command(s, "roll");
    s = first.body.scene;
    assert.equal(s.character.hp, 8);
    assert.equal(first.body.check!.roll, 38);
    const renameDb = openDatabase(t.databasePath);
    const linked = JSON.parse(
      renameDb.prepare("SELECT state FROM runs WHERE id=?").get(s.runId)!
        .state as string,
    ).savedCharacterId;
    renameDb.close();
    const renamed = await t.app.inject({
      method: "PATCH",
      url: `/api/characters/${linked}`,
      headers,
      cookies: t.cookies,
      payload: { name: "重掷后也保留的新名", profile: {} },
    });
    assert.equal(renamed.statusCode, 200, renamed.body);
    await t.restart();
    assert.equal((await t.read()).inventory.reroll, 1);
    const pending = await t.app.inject({
      url: `/api/runs/${s.runId}/check-window`,
      cookies: t.cookies,
    });
    assert.equal(pending.json().before.character.hp, 12);
    assert.equal(pending.json().before.character.name, "重掷后也保留的新名");
    assert.equal(
      (
        await t.post(
          `/api/achievements/${encodeURIComponent(endingAchievementId(fixture.id, "lost"))}/claim`,
          {},
        )
      ).statusCode,
      409,
    );
    const stale = await t.post(`/api/runs/${s.runId}/commands`, {
      commandId: randomUUID(),
      expectedRevision: s.revision - 1,
      actionId: "shop-reroll",
    });
    assert.equal(stale.statusCode, 409);
    assert.equal((await t.read()).inventory.reroll, 1);
    t.setDraws([2, 1]);
    const retry = await t.command(s, "shop-reroll");
    s = retry.body.scene;
    assert.equal(s.character.name, "重掷后也保留的新名");
    assert.equal(retry.body.check!.roll, 12);
    assert.equal(s.character.hp, 11);
    assert.equal((await t.read()).inventory.reroll, 0);
    const duplicate = await t.post(
      `/api/runs/${s.runId}/commands`,
      retry.payload,
    );
    assert.deepEqual(duplicate.json(), retry.body);
    const history = (
      await t.app.inject({
        url: `/api/runs/${s.runId}/history`,
        cookies: t.cookies,
      })
    ).json().frames;
    assert.equal(
      history.find((f: any) => f.check?.roll === 38).discarded,
      true,
    );
    assert.equal(
      history.find((f: any) => f.check?.roll === 12).discarded,
      undefined,
    );
    const close = await t.post(`/api/runs/${s.runId}/check-window/close`, {
      expectedRevision: s.revision,
    });
    assert.equal(close.statusCode, 200);
    assert.equal(
      (
        await t.post(
          `/api/achievements/${encodeURIComponent(endingAchievementId(fixture.id, "won"))}/claim`,
          {},
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await t.post(`/api/runs/${s.runId}/commands`, {
          commandId: randomUUID(),
          expectedRevision: s.revision,
          actionId: "shop-reroll",
        })
      ).statusCode,
      409,
    );
    const db = openDatabase(t.databasePath);
    assert.equal(
      Number(
        db
          .prepare("SELECT quantity FROM shop_inventory WHERE item_id=?")
          .get("reroll")!.quantity,
      ),
      0,
    );
    db.close();
  } finally {
    await t.close();
  }
});
test("target item changes only this check and failed actions cannot consume inventory", async () => {
  const t = await setup();
  try {
    await t.fund();
    await t.post("/api/shop/purchases", {
      requestId: randomUUID(),
      itemId: "target-plus-10",
    });
    let s = await t.start();
    const invalid = await t.post(`/api/runs/${s.runId}/commands`, {
      commandId: randomUUID(),
      expectedRevision: s.revision,
      actionId: "earn-easy",
      shopItem: "target-plus-10",
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal((await t.read()).inventory["target-plus-10"], 1);
    s = (await t.command(s, "check")).body.scene;
    t.setDraws([5, 2]);
    const result = await t.command(s, "roll", { shopItem: "target-plus-10" });
    assert.equal(result.body.check!.roll, 25);
    assert.equal(result.body.check!.target, 30);
    assert.equal(result.body.check!.success, true);
    assert.equal(result.body.scene.character.skills.listen, 20);
    assert.equal((await t.read()).inventory["target-plus-10"], 0);
    const duplicate = await t.post(
      `/api/runs/${s.runId}/commands`,
      result.payload,
    );
    assert.deepEqual(duplicate.json(), result.body);
    let next = await t.start();
    next = (await t.command(next, "check")).body.scene;
    t.setDraws([5, 2]);
    const ordinary = await t.command(next, "roll");
    assert.equal(ordinary.body.check!.target, 20);
    assert.equal(ordinary.body.check!.success, false);
  } finally {
    await t.close();
  }
});
test("target assist does not bypass critical or fumble and adds ten after difficulty scaling", () => {
  const actor = {
    name: "测试",
    occupation: "",
    hp: 12,
    maxHp: 12,
    sanity: 50,
    luck: 30,
    skills: { listen: 40 },
  };
  let values = [5, 2];
  let r = resolveCheck(
    actor,
    {
      skill: "listen",
      label: "聆听",
      difficulty: "hard",
      success: "",
      failure: "",
    },
    () => values.shift()!,
    10,
  );
  assert.equal(r.target, 30);
  assert.equal(r.success, true);
  values = [0, 0];
  r = resolveCheck(
    actor,
    {
      skill: "listen",
      label: "聆听",
      difficulty: "regular",
      success: "",
      failure: "",
    },
    () => values.shift()!,
    10,
  );
  assert.equal(r.grade, "fumble");
  assert.equal(r.success, false);
});

test("schema 2 upgrade preserves prior characters, dice receipts and run state", async () => {
  const t = await setup();
  try {
    const scene = await t.start();
    const characters = (
      await t.app.inject({ url: "/api/characters", cookies: t.cookies })
    ).json();
    await t.restart(() => {
      const legacy = new DatabaseSync(t.databasePath);
      legacy.exec(
        "DROP TABLE shop_discarded_checks; DROP TABLE shop_check_windows; DROP TABLE shop_purchases; DROP TABLE achievement_claims; DROP TABLE shop_inventory; DROP TABLE shop_wallets; PRAGMA user_version=2;",
      );
      legacy.close();
    });
    assert.deepEqual(
      (
        await t.app.inject({
          url: `/api/runs/${scene.runId}`,
          cookies: t.cookies,
        })
      ).json(),
      scene,
    );
    assert.deepEqual(
      (
        await t.app.inject({ url: "/api/characters", cookies: t.cookies })
      ).json(),
      characters,
    );
    assert.equal((await t.read()).balance, 0);
  } finally {
    await t.close();
  }
});

test("Static unlock requires three distinct confirmed Flames endings, points, and persists without charging twice", async () => {
  const t = await setup();
  try {
    const startStatic = async (who = t.cookies) => {
      const luck = await t.post(
        "/api/dice/rolls",
        { id: randomUUID(), purpose: "luck", sides: 6, count: 3 },
        who,
      );
      return t.post(
        "/api/runs",
        {
          storyId: "alone-against-static",
          presetId: "actor",
          name: "测试",
          luckRollId: luck.json().id,
        },
        who,
      );
    };
    const unauthenticated = await t.app.inject({
      method: "POST",
      url: "/api/shop/unlocks",
      headers,
      payload: { requestId: randomUUID(), storyId: "alone-against-static" },
    });
    assert.equal(unauthenticated.statusCode, 401);
    const forged = await t.post("/api/shop/unlocks", {
      requestId: randomUUID(),
      storyId: "alone-against-static",
      price: 0,
      completedEndings: 3,
    });
    assert.equal(forged.statusCode, 400);
    const requestId = randomUUID();
    const unlock = (id = requestId, who = t.cookies) =>
      t.post(
        "/api/shop/unlocks",
        { requestId: id, storyId: "alone-against-static" },
        who,
      );
    assert.equal((await startStatic()).statusCode, 403);
    await t.earn("earn-hard", "255");
    await t.earn("earn-hard", "255");
    assert.equal((await t.read()).storyUnlock.completedEndings, 1);
    assert.equal((await unlock()).statusCode, 409); // One 3-point ending isn't enough.
    await t.earn("earn-easy", "223-end");
    assert.equal((await unlock()).statusCode, 409);
    const s = await t.start();
    const check = (await t.command(s, "check")).body.scene;
    t.setDraws([2, 1]);
    const ending = (await t.command(check, "roll")).body.scene;
    assert.equal((await t.read()).storyUnlock.completedEndings, 2); // Awaiting confirmation.
    await t.post(`/api/runs/${s.runId}/check-window/close`, {
      expectedRevision: ending.revision,
    });
    assert.equal((await t.read()).storyUnlock.completedEndings, 3);
    await t.post("/api/shop/purchases", {
      requestId: randomUUID(),
      itemId: "reroll",
    });
    assert.equal((await t.read()).balance, 2);
    assert.equal((await unlock()).statusCode, 409); // Three endings without sufficient points.
    await t.post(
      `/api/achievements/${encodeURIComponent(endingAchievementId(fixture.id, "won"))}/claim`,
      {},
    );
    const result = await unlock();
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().balance, 0);
    assert.equal(result.json().storyUnlock.unlocked, true);
    assert.equal((await unlock()).json().balance, 0);
    assert.equal((await unlock(randomUUID())).json().balance, 0);
    assert.equal(
      (await t.post("/api/shop/purchases", { requestId, itemId: "reroll" }))
        .statusCode,
      409,
    );
    await t.restart();
    assert.equal((await t.read()).storyUnlock.unlocked, true);
    assert.equal((await startStatic()).statusCode, 201);
    const other = await t.register("无权限的新玩家");
    assert.equal((await startStatic(other)).statusCode, 403);
    assert.equal((await unlock(randomUUID(), other)).statusCode, 409);
  } finally {
    await t.close();
  }
});
test("existing Static players retain access without spending points", async () => {
  const t = await setup();
  try {
    const original = await t.start();
    const db = openDatabase(t.databasePath);
    // Represent a pre-gate save using the compatible test story and character.
    db.prepare(
      "UPDATE runs SET story_id='alone-against-static' WHERE id=?",
    ).run(original.runId);
    db.close();
    await t.restart();
    assert.equal((await t.read()).storyUnlock.unlocked, true);
    assert.equal((await t.read()).balance, 0);
    const response = await t.app.inject({
      url: `/api/runs/${original.runId}`,
      cookies: t.cookies,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().character, original.character);
  } finally {
    await t.close();
  }
});
