import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "./helpers/story-fixtures.js";
import { loadStories } from "./helpers/story-fixtures.js";
import { validateStory } from "../apps/api/src/catalog.js";
import { createCharacter, resolveCheck } from "../packages/rules/index.js";
import { initialState, advance } from "../packages/engine/index.js";
const headers = { "x-requested-with": "cthulhu-web" };
test("login rotates sessions, invalid credentials reject, logout revokes access", async () => {
  const app = await buildApp();
  try {
    const token = await register(app);
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: {
        inviteCode: "fa6ian-test",
        username: "调查员",
        password: "test-password-123",
      },
    });
    assert.equal(duplicate.statusCode, 409);
    const invalid = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: { username: "调查员", password: "wrong-password" },
    });
    assert.equal(invalid.statusCode, 401);
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      cookies: { session: token },
      payload: { username: "调查员", password: "test-password-123" },
    });
    assert.equal(login.statusCode, 200);
    assert.ok(!login.body.includes("password"));
    const current = login.cookies[0].value;
    assert.notEqual(current, token);
    assert.equal(
      (await app.inject({ url: "/api/me", cookies: { session: token } }))
        .statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ url: "/api/me", cookies: { session: current } }))
        .statusCode,
      200,
    );
    await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers,
      cookies: { session: current },
      payload: {},
    });
    assert.equal(
      (await app.inject({ url: "/api/me", cookies: { session: current } }))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
test("failure during dice resolution rolls back progress and history", async () => {
  const app = await buildApp({
    dice: (min, max) => {
      if (max === 10) throw new Error("simulated random-source failure");
      return min;
    },
  });
  try {
    const token = await register(app),
      s = await start(app, token);
    await send(app, token, s.runId, 0, "stairs");
    const before = (
      await app.inject({
        url: `/api/runs/${s.runId}`,
        cookies: { session: token },
      })
    ).body;
    const id = randomUUID();
    assert.equal(
      (await send(app, token, s.runId, 1, "roll", id)).statusCode,
      500,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/runs/${s.runId}`,
          cookies: { session: token },
        })
      ).body,
      before,
    );
    const history = (
      await app.inject({
        url: `/api/runs/${s.runId}/history`,
        cookies: { session: token },
      })
    ).json();
    assert.equal(history.frames.length, 2);
    assert.equal(
      history.frames.filter((f: { check?: unknown }) => f.check).length,
      0,
    );
  } finally {
    await app.close();
  }
});
async function register(
  app: Awaited<ReturnType<typeof buildApp>>,
  username = "调查员",
) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers,
    payload: {
      inviteCode: "fa6ian-test",
      username,
      password: "test-password-123",
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.cookies[0].value;
}
async function start(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  storyId = "rules-fixture",
) {
  const rolled = await app.inject({
    method: "POST",
    url: "/api/dice/rolls",
    headers,
    cookies: { session: token },
    payload: { id: randomUUID(), purpose: "luck", sides: 6, count: 3 },
  });
  assert.equal(rolled.statusCode, 200, rolled.body);
  const r = await app.inject({
    method: "POST",
    url: "/api/runs",
    headers,
    cookies: { session: token },
    payload: {
      storyId,
      presetId: "reporter",
      name: "林雾",
      luckRollId: rolled.json().id,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function send(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
  id: string,
  revision: number,
  actionId: string,
  commandId = randomUUID(),
) {
  return app.inject({
    method: "POST",
    url: `/api/runs/${id}/commands`,
    headers,
    cookies: { session: token },
    payload: { commandId, expectedRevision: revision, actionId },
  });
}
test("published stories validate; missing targets, unknown skills and loops reject", () => {
  for (const s of loadStories("stories").values()) {
    assert.ok(validateStory(s));
    if (s.rulesVersion !== "coc7-subset@1") continue;
    const missing = structuredClone(s);
    missing.nodes[0].choices![0].target = "missing";
    assert.throws(() => validateStory(missing));
    const loop = structuredClone(s);
    loop.nodes[0].choices![0].target = s.entry;
    assert.throws(() => validateStory(loop));
    const skill = structuredClone(s);
    skill.nodes.find((n) => n.check)!.check!.skill = "unknown";
    assert.throws(() => validateStory(skill));
  }
});
test("difficulty and fumble boundaries, bonus dice including 00", () => {
  const c = createCharacter(
    "林雾",
    { occupation: "记者", skills: { spotHidden: 45 }, hp: 12, sanity: 60 },
    45,
  );
  const check = {
    skill: "spotHidden",
    label: "侦查",
    difficulty: "hard" as const,
    success: "yes",
    failure: "no",
  };
  const source = (values: number[]) => () => values.shift()!;
  assert.equal(resolveCheck(c, check, source([2, 2])).success, true);
  assert.equal(resolveCheck(c, check, source([3, 2])).success, false);
  assert.equal(resolveCheck(c, check, source([6, 9])).grade, "fumble");
  assert.equal(
    resolveCheck(c, { ...check, bonusDice: 1 }, source([0, 0, 2])).roll,
    20,
  );
  assert.equal(
    resolveCheck(c, { ...check, penaltyDice: 1 }, source([0, 0, 2])).roll,
    100,
  );
  assert.equal(
    resolveCheck(
      c,
      { ...check, skill: "sanity", difficulty: "regular" },
      source([5, 5]),
    ).success,
    true,
  );
});
test("state mutation is isolated and gated choices cannot be forged", () => {
  const s = loadStories("stories").get("rules-fixture@1.0.0")!;
  const c = createCharacter("林雾", s.presets[0], 45),
    state = initialState(s, c);
  const next = advance(s, state, "fisher", () => 0);
  assert.equal(state.inventory.length, 0);
  assert.equal(next.state.inventory.length, 1);
  assert.equal(next.state.flags.warned, true);
  assert.throws(() => advance(s, state, "secret"));
});
test("authentication, ownership, secret filtering and strict input", async () => {
  const app = await buildApp();
  try {
    assert.equal((await app.inject("/api/runs")).statusCode, 401);
    const token = await register(app),
      other = await register(app, "其他调查员");
    const scene = await start(app, token);
    const catalog = await app.inject("/api/stories");
    assert.ok(!catalog.body.includes('"nodes"'));
    assert.ok(!catalog.body.includes('"entry"'));
    assert.ok(!JSON.stringify(scene).includes('"target"'));
    assert.ok(!JSON.stringify(scene).includes('"flags"'));
    for (const tail of ["", "/history", "/replay", "/memories"])
      assert.equal(
        (
          await app.inject({
            url: `/api/runs/${scene.runId}${tail}`,
            cookies: { session: other },
          })
        ).statusCode,
        404,
      );
    assert.equal(
      (await send(app, other, scene.runId, 0, "fisher")).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/runs/${scene.runId}/commands`,
          headers,
          cookies: { session: token },
          payload: {
            commandId: randomUUID(),
            expectedRevision: 0,
            actionId: "fisher",
            roll: 1,
          },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          cookies: { session: token },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/auth/logout",
          headers: { ...headers, origin: "https://evil.example" },
          cookies: { session: token },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          headers,
          cookies: { session: token },
          payload: {
            storyId: "rules-fixture",
            presetId: "reporter",
            name: "林雾",
            skills: { spotHidden: 75, listen: 75, persuade: 75, stealth: 75 },
          },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});
test("duplicate commands replay identical response; revision race has one winner", async () => {
  const app = await buildApp();
  try {
    const token = await register(app),
      s = await start(app, token),
      id = randomUUID();
    const responses = await Promise.all([
      send(app, token, s.runId, 0, "fisher", id),
      send(app, token, s.runId, 0, "fisher", id),
    ]);
    assert.equal(responses[0].statusCode, 200);
    assert.equal(responses[1].body, responses[0].body);
    assert.equal(
      (await send(app, token, s.runId, 0, "stairs", id)).statusCode,
      409,
    );
    const next = await send(app, token, s.runId, 1, "continue");
    assert.equal(next.statusCode, 200);
    const rolls = await Promise.all([
      send(app, token, s.runId, 2, "roll"),
      send(app, token, s.runId, 2, "roll"),
    ]);
    assert.deepEqual(rolls.map((r) => r.statusCode).sort(), [200, 409]);
    const frames = (
      await app.inject({
        url: `/api/runs/${s.runId}/history`,
        cookies: { session: token },
      })
    ).json().frames;
    assert.equal(frames.length, 4);
    assert.equal(frames.filter((f: { check?: unknown }) => f.check).length, 1);
  } finally {
    await app.close();
  }
});
test("dice persist across retries and restart; history and replay cannot roll back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coc-test-")),
    path = join(dir, "game.sqlite");
  let count = 0;
  let app = await buildApp({
    databasePath: path,
    dice: (min) => {
      count++;
      return min;
    },
  });
  try {
    const token = await register(app),
      s = await start(app, token);
    await send(app, token, s.runId, 0, "stairs");
    const id = randomUUID();
    const roll = await send(app, token, s.runId, 1, "roll", id);
    const draws = count;
    assert.equal(roll.statusCode, 200);
    assert.equal(
      (await send(app, token, s.runId, 1, "roll", id)).body,
      roll.body,
    );
    assert.equal(count, draws);
    const before = (
      await app.inject({
        url: `/api/runs/${s.runId}`,
        cookies: { session: token },
      })
    ).body;
    for (const tail of ["history", "replay", "memories"])
      assert.equal(
        (
          await app.inject({
            url: `/api/runs/${s.runId}/${tail}`,
            cookies: { session: token },
          })
        ).statusCode,
        200,
      );
    assert.equal(
      (
        await app.inject({
          url: `/api/runs/${s.runId}`,
          cookies: { session: token },
        })
      ).body,
      before,
    );
    await app.close();
    app = await buildApp({
      databasePath: path,
      dice: () => {
        throw new Error("must not reroll");
      },
    });
    assert.equal(
      (await send(app, token, s.runId, 1, "roll", id)).body,
      roll.body,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/runs/${s.runId}`,
          cookies: { session: token },
        })
      ).body,
      before,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("failed commands leave state unchanged; ended runs reject all commands", async () => {
  const app = await buildApp();
  try {
    const token = await register(app),
      s = await start(app, token, "collection-fixture");
    assert.equal((await send(app, token, s.runId, 0, "home")).statusCode, 400);
    assert.equal(
      (
        await app.inject({
          url: `/api/runs/${s.runId}`,
          cookies: { session: token },
        })
      ).json().revision,
      0,
    );
    await send(app, token, s.runId, 0, "talk");
    await send(app, token, s.runId, 1, "continue");
    const finish = await send(app, token, s.runId, 2, "step");
    assert.equal(finish.json().scene.status, "ended");
    assert.equal(
      (await send(app, token, s.runId, 3, "continue")).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/runs/${s.runId}`,
          cookies: { session: token },
        })
      ).json().revision,
      3,
    );
  } finally {
    await app.close();
  }
});
test("all fixture endings are reachable, each path appends history and preserves run isolation", async () => {
  const app = await buildApp({ dice: () => 1 });
  try {
    const token = await register(app);
    const paths = [
      [
        "rules-fixture",
        [
          "fisher",
          "continue",
          "roll",
          "continue",
          "secret",
          "continue",
          "ignite",
        ],
        "测试结局：light",
      ],
      [
        "rules-fixture",
        ["stairs", "roll", "continue", "open", "continue", "flare"],
        "测试结局：signal",
      ],
      [
        "rules-fixture",
        ["stairs", "roll", "continue", "open", "continue", "leave"],
        "测试结局：escape",
      ],
      ["collection-fixture", ["talk", "continue", "step"], "测试结局：home"],
      ["collection-fixture", ["talk", "continue", "wait"], "测试结局：loop"],
      [
        "collection-fixture",
        ["listen", "roll", "continue", "help"],
        "测试结局：rescue",
      ],
    ] as const;
    for (const [story, path, ending] of paths) {
      const s = await start(app, token, story);
      let current = s;
      for (const [revision, action] of path.entries()) {
        const r = await send(app, token, s.runId, revision, action);
        assert.equal(r.statusCode, 200, `${story} ${action}: ${r.body}`);
        current = r.json().scene;
      }
      assert.equal(current.ending, ending);
      assert.equal(current.revision, path.length);
    }
    assert.equal(
      (
        await app.inject({ url: "/api/runs", cookies: { session: token } })
      ).json().length,
      6,
    );
  } finally {
    await app.close();
  }
});
