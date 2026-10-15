import { test as base, expect } from "@playwright/test";
import { endingTierFixture } from "../fixtures/ending-tiers.js";
import { rankingPassword } from "../fixtures/leaderboard.js";
const test = base.extend({
  page: async ({ page }, use) => {
    const t = await endingTierFixture();
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        payload = req.postData();
      const response = await t.app.inject({
        method: req.method() as "GET" | "POST" | "PATCH",
        url: url.pathname + url.search,
        headers: { ...req.headers(), host: url.host },
        ...(payload ? { payload } : {}),
      });
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers))
        if (
          value !== undefined &&
          !["content-length", "transfer-encoding"].includes(key)
        )
          headers[key] = Array.isArray(value)
            ? value.join("\n")
            : String(value);
      await route.fulfill({
        status: response.statusCode,
        headers,
        body: response.body,
      });
    });
    try {
      await use(page);
    } finally {
      await t.close();
    }
  },
});
test("five stories show distinct grade borders without spoiling locked endings, and reward differences persist once", async ({
  page,
}, info) => {
  await page.goto("/#/achievements");
  await page.getByRole("button", { name: /登录或创建账号/ }).click();
  await page.getByLabel("用户名").fill("远行者");
  await page.getByLabel("密码").fill(rankingPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const library = page.getByRole("region", { name: "结局成就" });
  for (const storyId of [
    "alone-against-flames",
    "alone-against-static",
    "alone-against-tide",
    "alone-against-frost",
    "alone-against-fear",
  ]) {
    await page.getByLabel("选择剧本").selectOption(storyId);
    for (const [grade, label] of [
      ["bronze", "青铜级"],
      ["silver", "白银级"],
      ["gold", "黄金级"],
    ]) {
      const card = library.locator(`.achievement-card[data-tier="${grade}"]`);
      await expect(card).toHaveCount(1);
      await expect(card.locator(".ending-tier-badge")).toHaveText(label);
    }
    expect(
      await library.locator(".achievement-card.is-locked[data-tier]").count(),
    ).toBe(0);
  }
  const gold = library.locator('.achievement-card[data-tier="gold"]');
  const silver = library.locator('.achievement-card[data-tier="silver"]');
  await expect(gold).toContainText("可补领 2 点");
  await gold.getByRole("button", { name: "领取差额" }).click();
  await expect(gold.getByRole("button", { name: "已领取" })).toBeDisabled();
  await expect(page.locator(".reward-summary")).toContainText("余烬点 2");
  await silver.getByRole("button", { name: "领取差额" }).click();
  await expect(page.locator(".reward-summary")).toContainText("余烬点 3");
  await page.reload();
  await page.getByLabel("选择剧本").selectOption("alone-against-fear");
  await expect(gold.getByRole("button", { name: "已领取" })).toBeDisabled();
  await expect(silver.getByRole("button", { name: "已领取" })).toBeDisabled();
  const borders = await library
    .locator(".achievement-card[data-tier]")
    .evaluateAll((cards) =>
      cards.map((card) => getComputedStyle(card).borderTopColor),
    );
  expect(new Set(borders).size).toBe(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/ending-tiers-${info.project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: info.outputPath("ending-tiers-viewport.png"),
    fullPage: false,
  });
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "回忆档案", exact: true }).click();
  const collections = page.getByRole("region", { name: "故事收集" });
  for (const grade of ["bronze", "silver", "gold"])
    await expect(
      collections.locator(`.collection-entry[data-tier="${grade}"]`).first(),
    ).toBeVisible();
  await collections
    .getByRole("button", { name: "章节收集", exact: true })
    .click();
  expect(
    await collections.locator(".collection-entry[data-tier]").count(),
  ).toBe(0);
});
