import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadCharacterTemplates } from "../apps/api/src/modules/character-templates.js";
import { buildApp } from "./helpers/story-fixtures.js";
const headers = { "x-requested-with": "cthulhu-web" };
async function register(
  app: Awaited<ReturnType<typeof buildApp>>,
  name: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers,
    payload: {
      inviteCode: "fa6ian-test",
      username: name,
      password: "character-test-password",
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.cookies[0].value;
}
async function luckRoll(
  app: Awaited<ReturnType<typeof buildApp>>,
  token: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/api/dice/rolls",
    headers,
    cookies: { session: token },
    payload: { id: randomUUID(), purpose: "luck", sides: 6, count: 3 },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().id as string;
}
test("official templates retain verified identities and values; Flames has guided creation", () => {
  const catalog = loadCharacterTemplates("chars");
  assert.equal(catalog.templates.length, 2);
  const alex = catalog.templates.find((t) => t.id === "static-alex")!,
    charlie = catalog.templates.find((t) => t.id === "static-charlie")!;
  assert.equal(alex.defaultName, "Alex");
  assert.equal(alex.occupation, "销售员");
  assert.equal(alex.skills.listen, 50);
  assert.equal(alex.skills.spotHidden, 35);
  assert.equal(alex.attributes.str, 70);
  assert.equal(alex.sanity, 50);
  assert.equal(alex.mp, 10);
  assert.equal(charlie.occupation, "护士");
  assert.equal(charlie.skills.firstAid, 70);
  assert.equal(charlie.skills.spotHidden, 65);
  assert.equal(charlie.skills.scienceBiology, 25);
  assert.equal(charlie.attributes.pow, 60);
  assert.equal(charlie.mp, 12);
  assert.equal(
    catalog.groups.find((g) => g.storyId === "alone-against-flames")!.status,
    "guided-creation",
  );
  assert.ok(
    !catalog.templates.some((t) => t.sourceStoryId === "alone-against-flames"),
  );
});
test("template creates separate saved instances; only names can be overridden", async () => {
  const app = await buildApp({ dice: (min) => min });
  try {
    const catalog = (await app.inject("/api/character-templates")).json();
    assert.equal(catalog.templates.length, 2);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/characters",
          headers,
          payload: { templateId: "static-alex" },
        })
      ).statusCode,
      401,
    );
    const token = await register(app, "模板调查员");
    const create = async (payload: object) =>
      app.inject({
        method: "POST",
        url: "/api/characters",
        headers,
        cookies: { session: token },
        payload: { luckRollId: await luckRoll(app, token), ...payload },
      });
    assert.equal(
      (await create({ templateId: "static-alex", hp: 99 })).statusCode,
      400,
    );
    assert.equal(
      (await create({ templateId: "flames-pretend" })).statusCode,
      404,
    );
    const first = (
        await create({ templateId: "static-alex", name: "新名字" })
      ).json(),
      second = (await create({ templateId: "static-alex" })).json();
    assert.notEqual(first.id, second.id);
    assert.equal(first.character.name, "新名字");
    assert.equal(second.character.name, "Alex");
    assert.equal(first.character.luck, 15);
    assert.equal(first.character.hp, 13);
    assert.equal(first.character.attributes.str, 70);
    assert.equal(first.character.templateId, "static-alex");
    assert.equal(first.character.templateVersion, "1.0.0");
    assert.deepEqual(
      (await app.inject("/api/character-templates")).json(),
      catalog,
    );
    const list = (
      await app.inject({ url: "/api/characters", cookies: { session: token } })
    ).json();
    assert.equal(list.length, 2);
  } finally {
    await app.close();
  }
});
test("saved template character starts isolated runs without rerolling luck or allowing foreign characters", async () => {
  let draws = 0;
  const app = await buildApp({
    dice: (min) => {
      draws++;
      return min === 0 ? 1 : min;
    },
  });
  try {
    const token = await register(app, "角色主人"),
      other = await register(app, "另一位主人");
    const created = await app.inject({
      method: "POST",
      url: "/api/characters",
      headers,
      cookies: { session: token },
      payload: {
        templateId: "static-alex",
        luckRollId: await luckRoll(app, token),
      },
    });
    assert.equal(created.statusCode, 201);
    const actor = created.json(),
      luckDraws = draws;
    const payload = {
      storyId: "rules-fixture",
      characterId: actor.id,
      name: actor.character.name,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          headers,
          cookies: { session: other },
          payload,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          headers,
          cookies: { session: token },
          payload: {
            ...payload,
            skills: { spotHidden: 50, listen: 50, persuade: 50, stealth: 50 },
          },
        })
      ).statusCode,
      400,
    );
    const first = (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          headers,
          cookies: { session: token },
          payload,
        })
      ).json(),
      second = (
        await app.inject({
          method: "POST",
          url: "/api/runs",
          headers,
          cookies: { session: token },
          payload,
        })
      ).json();
    assert.equal(draws, luckDraws);
    assert.deepEqual(first.character, actor.character);
    assert.notEqual(first.runId, second.runId);
    for (const [revision, action] of [
      "stairs",
      "roll",
      "continue",
      "open",
    ].entries()) {
      const response = await app.inject({
        method: "POST",
        url: `/api/runs/${first.runId}/commands`,
        headers,
        cookies: { session: token },
        payload: {
          commandId: randomUUID(),
          expectedRevision: revision,
          actionId: action,
        },
      });
      assert.equal(response.statusCode, 200, response.body);
    }
    const current = (
      await app.inject({
        url: `/api/runs/${first.runId}`,
        cookies: { session: token },
      })
    ).json();
    assert.equal(current.character.hp, 11);
    assert.equal(current.character.sanity, 45);
    const untouched = (
      await app.inject({
        url: `/api/runs/${second.runId}`,
        cookies: { session: token },
      })
    ).json();
    assert.deepEqual(untouched.character, actor.character);
    const list = (
      await app.inject({ url: "/api/characters", cookies: { session: token } })
    ).json();
    assert.equal(list.length, 1);
    assert.deepEqual(list[0].character, actor.character);
  } finally {
    await app.close();
  }
});
