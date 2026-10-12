import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/** Start a backend fixture explicitly, without unlocking it in the public library. */
export async function createFixtureRun(
  page: Page,
  storyId: string,
  name: string,
  characterId?: string,
  luckRollId?: string,
) {
  const headers = { "x-requested-with": "cthulhu-web" };
  if (!characterId && !luckRollId) {
    const roll = await page.request.post("/api/dice/rolls", {
      headers,
      data: { id: randomUUID(), purpose: "luck", sides: 6, count: 3 },
    });
    expect(roll.status()).toBe(200);
    luckRollId = (await roll.json()).id;
  }
  const response = await page.request.post("/api/runs", {
    headers,
    data: { storyId, presetId: "reporter", name, characterId, luckRollId },
  });
  expect(response.status()).toBe(201);
  const scene = await response.json();
  await page.goto(`/#/play/${scene.runId}`);
  await expect(page.locator(".narrative")).toContainText(scene.text[0]);
  return scene;
}
