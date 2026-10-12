import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../apps/api/src/app.js";
const headers = { "x-requested-with": "cthulhu-web" };
async function account(
  app: Awaited<ReturnType<typeof buildApp>>,
  username: string,
) {
  const r = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers,
    payload: { inviteCode: "fa6ian-test", username, password: "collection-testing-password" },
  });
  assert.equal(r.statusCode, 200, r.body);
  return { session: r.cookies[0].value };
}
async function create(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookies: { session: string },
  storyId = "last-train",
  presetId = "reporter",
) {
  const roll = await app.inject({
    method: "POST",
    url: "/api/dice/rolls",
    headers,
    cookies,
    payload: { id: randomUUID(), purpose: "luck", sides: 6, count: 3 },
  });
  assert.equal(roll.statusCode, 200, roll.body);
  const r = await app.inject({
    method: "POST",
    url: "/api/runs",
    headers,
    cookies,
    payload: {
      storyId,
      presetId,
      name: "收藏访客",
      luckRollId: roll.json().id,
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return r.json();
}
async function action(
  app: Awaited<ReturnType<typeof buildApp>>,
  cookies: { session: string },
  scene: any,
  actionId: string,
) {
  const r = await app.inject({
    method: "POST",
    url: `/api/runs/${scene.runId}/commands`,
    headers,
    cookies,
    payload: {
      commandId: randomUUID(),
      expectedRevision: scene.revision,
      actionId,
    },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().scene;
}
test("collections deduplicate across runs, hide locked text, enforce ownership and recover old history after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "coc-collections-")),
    databasePath = join(dir, "game.sqlite");
  let app = await buildApp({ databasePath, dice: (min) => min });
  try {
    const cookies = await account(app, "收集玩家"),
      foreign = await account(app, "其他收藏者");
    assert.equal(
      (await app.inject({ url: "/api/collections" })).statusCode,
      401,
    );
    let latest: any;
    for (let run = 0; run < 2; run++) {
      let s = await create(app, cookies);
      for (const a of ["talk", "continue", "step"])
        s = await action(app, cookies, s, a);
      latest = s;
      assert.equal(s.ending, "归人");
    }
    const read = async () =>
      (await app.inject({ url: "/api/collections", cookies })).json();
    const before = await read(),
      story = before.find((x: any) => x.storyId === "last-train");
    assert.equal(story.chapters.total, 8);
    assert.equal(story.chapters.entries.length, 4);
    assert.equal(story.endings.total, 3);
    assert.equal(story.endings.entries.length, 1);
    assert.equal(story.endings.entries[0].visits, 2);
    assert.ok(!JSON.stringify(before).includes("下一位乘客"));
    assert.ok(!JSON.stringify(before).includes("破晓"));
    const q =
      "/api/collections/entry?storyId=last-train&version=1.0.0&kind=endings&id=home";
    const detail = await app.inject({ url: q, cookies });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().scene.ending, "归人");
    assert.equal(
      (await app.inject({ url: q, cookies: foreign })).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ url: q.replace("id=home", "id=loop"), cookies }))
        .statusCode,
      404,
    );
    const stateBefore = (
      await app.inject({ url: `/api/runs/${latest.runId}`, cookies })
    ).body;
    await app.inject({ url: q, cookies });
    assert.equal(
      (await app.inject({ url: `/api/runs/${latest.runId}`, cookies })).body,
      stateBefore,
    );
    const empty = (
      await app.inject({ url: "/api/collections", cookies: foreign })
    ).json();
    assert.ok(
      empty.every(
        (s: any) => !s.chapters.entries.length && !s.endings.entries.length,
      ),
    );
    await app.close();
    const db = new DatabaseSync(databasePath);
    for (const row of db
      .prepare("SELECT run_id,sequence,frame FROM run_history")
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
        throw new Error("浏览收藏不应掷骰");
      },
    });
    assert.deepEqual(await read(), before);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("character profile edits persist without changing numbers, templates or running copies", async () => {
  const app = await buildApp({ dice: (min) => min });
  try {
    const cookies = await account(app, "角色资料玩家"),
      foreign = await account(app, "角色资料访客");
    const scene = await create(app, cookies);
    const cards = (
        await app.inject({ url: "/api/characters", cookies })
      ).json(),
      card = cards[0];
    const payload = {
      name: "新名字",
      profile: {
        age: 32,
        birthplace: "普罗维登斯",
        ideology: "保护重要的人",
        notes: "纸上的笔记\n第二行",
      },
    };
    const patch = (
      body: Record<string, unknown>,
      who = cookies,
      customHeaders: Record<string, string> = headers,
    ) =>
      app.inject({
        method: "PATCH",
        url: `/api/characters/${card.id}`,
        headers: customHeaders,
        cookies: who,
        payload: body,
      });
    assert.equal((await patch(payload, foreign)).statusCode, 404);
    assert.equal((await patch({ ...payload, hp: 99 })).statusCode, 400);
    assert.equal(
      (await patch({ ...payload, profile: { ...payload.profile, age: 0 } }))
        .statusCode,
      400,
    );
    assert.equal((await patch(payload, cookies, {})).statusCode, 403);
    const saved = await patch(payload);
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().character, { ...card.character, ...payload });
    assert.deepEqual((await patch(payload)).json(), saved.json());
    assert.deepEqual(
      (await app.inject({ url: `/api/runs/${scene.runId}`, cookies })).json(),
      scene,
    );
    assert.equal(
      (await app.inject({ url: "/api/characters", cookies })).json()[0]
        .character.profile.notes,
      payload.profile.notes,
    );
  } finally {
    await app.close();
  }
});

test("Flames allocation updates its archived card while preserving written profile and earlier history", async () => {
  const app = await buildApp({ dice: (min, max) => (max === 10 ? 1 : min) });
  try {
    const cookies = await account(app, "引导角色档案");
    const made = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers,
      cookies,
      payload: {
        storyId: "alone-against-flames",
        presetId: "guided",
        name: "引导访客",
      },
    });
    assert.equal(made.statusCode, 201, made.body);
    let scene = made.json();
    const initial = scene;
    const card = (
      await app.inject({ url: "/api/characters", cookies })
    ).json()[0];
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/characters/${card.id}`,
          headers,
          cookies,
          payload: { name: "档案姓名", profile: { notes: "建卡时保留的笔记" } },
        })
      ).statusCode,
      200,
    );
    const send = async (actionId: string, input?: Record<string, number>) => {
      const r = await app.inject({
        method: "POST",
        url: `/api/runs/${scene.runId}/commands`,
        headers,
        cookies,
        payload: {
          commandId: randomUUID(),
          expectedRevision: scene.revision,
          actionId,
          ...(input ? { input } : {}),
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      scene = r.json().scene;
    };
    await send("to-263");
    await send("allocate", {
      str: 70,
      con: 60,
      pow: 60,
      dex: 80,
      app: 50,
      siz: 50,
      int: 50,
      edu: 40,
    });
    for (const a of [
      "to-8",
      "to-38",
      "to-233",
      "to-134",
      "roll",
      "roll",
      "to-71",
      "to-239",
    ])
      await send(a);
    await send("allocate", {
      artCraft: 70,
      history: 60,
      libraryUse: 60,
      languageOwn: 50,
      psychology: 50,
      persuade: 50,
      spotHidden: 40,
      firstAid: 40,
    });
    await send("to-128");
    await send("allocate", { listen: 20, stealth: 20, dodge: 20, occult: 20 });
    const saved = (
      await app.inject({ url: "/api/characters", cookies })
    ).json()[0];
    assert.equal(saved.id, card.id);
    assert.equal(saved.character.name, "档案姓名");
    assert.equal(saved.character.profile.notes, "建卡时保留的笔记");
    assert.equal(saved.character.occupation, "记者");
    assert.equal(saved.character.skills.listen, 40);
    assert.equal(saved.character.luck, 15);
    assert.equal(saved.character.attributes.str, 70);
    assert.equal(saved.character.hp, scene.character.hp);
    const history = (
      await app.inject({ url: `/api/runs/${scene.runId}/history`, cookies })
    ).json();
    assert.deepEqual(history.frames[0].scene, initial);
  } finally {
    await app.close();
  }
});
