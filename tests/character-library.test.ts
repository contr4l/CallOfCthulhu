import type { CharacterLibraryEntry } from "../packages/character-library/index.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { grantStoryAccess } from "./helpers/story-access.js";
import type {
  StorySummary,
} from "../packages/contracts/index.js";

const headers = { "x-requested-with": "cthulhu-web" };
test("published story presets save cards with private, persistent origin links without modifying characters", async () => {
  const root = mkdtempSync(join(tmpdir(), "character-library-"));
  const databasePath = join(root, "game.sqlite");
  let app = await buildApp({ databasePath, dice: (min) => min });
  try {
    const register = async (username: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers,
        payload: {
          username,
          password: "character-library-password",
          inviteCode: "fa6ian-test",
        },
      });
      assert.equal(response.statusCode, 200, response.body);
      return { id: response.json().id, session: response.cookies[0].value };
    };
    const owner = await register("角色目录验收"),
      other = await register("其他角色主人");
    const stories = (await app.inject("/api/stories")).json<StorySummary[]>();
    assert.equal(stories.length, 5);
    const expected = new Map<string, CharacterLibraryEntry["origin"]>();
    for (const story of stories) {
      grantStoryAccess(databasePath, owner.id, story.id);
      for (const preset of story.presets) {
        let luckRollId: string | undefined;
        if (story.creationPolicy !== "guided") {
          const roll = await app.inject({
            method: "POST",
            url: "/api/dice/rolls",
            headers,
            cookies: { session: owner.session },
            payload: { id: randomUUID(), purpose: "luck", sides: 6, count: 3 },
          });
          assert.equal(roll.statusCode, 200, roll.body);
          luckRollId = roll.json().id;
        }
        const response = await app.inject({
          method: "POST",
          url: "/api/runs",
          headers,
          cookies: { session: owner.session },
          payload: {
            storyId: story.id,
            presetId: preset.id,
            name: `${story.title}验收`,
            luckRollId,
          },
        });
        assert.equal(response.statusCode, 201, response.body);
        const scene = response.json();
        const cards = (
          await app.inject({
            url: "/api/characters",
            cookies: { session: owner.session },
          })
        ).json<CharacterLibraryEntry[]>();
        const card = cards.find((card) => card.origin?.runId === scene.runId)!;
        assert.ok(card, `${story.id}/${preset.id} has a saved origin`);
        assert.deepEqual(card.origin, {
          storyId: story.id,
          storyTitle: story.title,
          storyVersion: story.version,
          runId: scene.runId,
          status: "active",
        });
        expected.set(card.id, card.origin);
        // Listing must not mutate the live run or roll dice.
        assert.deepEqual(
          (
            await app.inject({
              url: `/api/runs/${scene.runId}`,
              cookies: { session: owner.session },
            })
          ).json().character,
          scene.character,
        );
      }
    }
    assert.equal(expected.size, 9);
    assert.deepEqual(
      (
        await app.inject({
          url: "/api/characters",
          cookies: { session: other.session },
        })
      ).json(),
      [],
    );
    assert.equal((await app.inject("/api/characters")).statusCode, 401);
    await app.close();
    app = await buildApp({ databasePath });
    const restored = (
      await app.inject({
        url: "/api/characters",
        cookies: { session: owner.session },
      })
    ).json<CharacterLibraryEntry[]>();
    assert.deepEqual(
      new Map(restored.map((card) => [card.id, card.origin])),
      expected,
    );
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
