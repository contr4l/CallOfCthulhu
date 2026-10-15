import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStories } from "../apps/api/src/catalog.js";
import { endingLabel } from "../apps/api/src/modules/confirmed-endings.js";
import {
  endingTier,
  endingReward,
  ENDING_TIERS,
} from "../packages/contracts/shop.js";
import type { Achievement } from "../packages/contracts/achievements.js";
import { endingTierFixture, tierExamples } from "./fixtures/ending-tiers.js";
import { rankingHeaders } from "./fixtures/leaderboard.js";
import type { StoryCollection } from "../packages/contracts/collections.js";

test("all five published stories have bronze/silver/gold endings and the original two retain their rewards", () => {
  const stories = loadStories("stories");
  for (const [id, version, expected] of [
    ["alone-against-flames", "1.1.0", undefined],
    ["alone-against-static", "1.2.0", undefined],
    ["alone-against-tide", "1.0.1", [43, 5, 2]],
    ["alone-against-frost", "1.0.5", [35, 3, 1]],
    ["alone-against-fear", "1.0.2", [1, 1, 1]],
  ] as const) {
    const counts = { bronze: 0, silver: 0, gold: 0 };
    const story = stories.get(`${id}@${version}`)!;
    assert.ok(story);
    for (const node of story.nodes.filter(endingLabel)) {
      const tier = endingTier(id, node.id);
      counts[tier]++;
      assert.equal(endingReward(id, node.id), ENDING_TIERS[tier].points);
    }
    assert.ok(
      Object.values(counts).every((count) => count > 0),
      id,
    );
    if (expected) assert.deepEqual(Object.values(counts), expected);
  }
  assert.equal(endingReward("alone-against-flames", "255"), 3);
  assert.equal(endingReward("alone-against-flames", "185-end"), 2);
  assert.equal(endingReward("alone-against-static", "356"), 3);
  assert.equal(endingReward("alone-against-static", "365"), 2);
});

test("grades remain secret until unlocked; legacy claims can collect only the difference once, with stable lifetime ranking", async () => {
  const t = await endingTierFixture();
  try {
    const get = (url: string, cookies = t.current.cookies) =>
      t.app.inject({ url, cookies });
    const achievements = async () =>
      (await get("/api/achievements")).json<Achievement[]>();
    const before = await achievements();
    for (const locked of before.filter((entry) => !entry.unlockedAt)) {
      assert.equal(locked.tier, undefined);
      assert.equal(locked.claimablePoints, undefined);
      assert.equal(locked.rewardPoints, undefined);
    }
    const rankBefore = (await get("/api/leaderboard")).json().currentUser
      .earnedPoints;
    assert.equal((await get("/api/shop")).json().balance, 0);
    const collections = await get("/api/collections");
    assert.equal(collections.statusCode, 200, collections.body);
    const library = collections.json<StoryCollection[]>();
    for (const [storyId, ...ids] of tierExamples)
      for (const [index, endingId] of ids.entries()) {
        const entry = before.find(
          (entry) => entry.storyId === storyId && entry.endingId === endingId,
        )!;
        assert.equal(entry.tier, ["bronze", "silver", "gold"][index]);
        assert.equal(entry.rewardPoints, index + 1);
        assert.equal(entry.claimedPoints, index > 0 ? 1 : 0);
        assert.equal(entry.claimablePoints, index === 2 ? 2 : 1);
        assert.equal(
          library
            .find((s) => s.storyId === storyId)
            ?.endings.entries.find((e) => e.id === endingId)?.tier,
          entry.tier,
        );
        if (index === 0) continue;
        const claimUrl = `/api/achievements/${encodeURIComponent(entry.id)}/claim`;
        const payload = {
          method: "POST" as const,
          url: claimUrl,
          headers: rankingHeaders,
          payload: {},
          cookies: t.current.cookies,
        };
        const result = await t.app.inject(payload);
        assert.equal(result.statusCode, 200, result.body);
        const balance = result.json().balance;
        const repeats = await Promise.all([
          t.app.inject(payload),
          t.app.inject(payload),
        ]);
        repeats.forEach((result) =>
          assert.equal(result.json().balance, balance),
        );
        const updated = (await achievements()).find((a) => a.id === entry.id)!;
        assert.equal(updated.claimablePoints, 0);
        assert.equal(updated.claimedPoints, index + 1);
        assert.equal(updated.claimedAt, entry.claimedAt);
        assert.equal(
          (await t.app.inject({ ...payload, cookies: t.accounts[0].cookies }))
            .statusCode,
          409,
        );
      }
    assert.equal((await get("/api/shop")).json().balance, 9);
    assert.equal(
      (await get("/api/leaderboard")).json().currentUser.earnedPoints,
      rankBefore,
    );
    await t.restart();
    assert.equal((await get("/api/shop")).json().balance, 9);
    assert.ok(
      (await achievements())
        .filter((a) => a.claimedAt && a.storyId !== "alone-against-flames")
        .every((a) => a.claimablePoints === 0),
    );
  } finally {
    await t.close();
  }
});
