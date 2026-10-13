import { test, expect, type Page } from "@playwright/test";

async function register(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`copy_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("copy-review-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("library keeps version and playable entries without horizontal overflow", async ({
  page,
}, info) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "独行调查", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "开启调查", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".feature-meta")).toContainText("分钟");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("library.png"),
    fullPage: true,
  });
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await expect(page.getByLabel("游戏版本")).toBeVisible();
});

test("character provenance stays available on demand and luck controls remain usable", async ({
  page,
}, info) => {
  await register(page);
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "调查员", exact: true }).click();
  const group = page
    .locator(".template-group")
    .filter({
      has: page.getByRole("heading", { name: "静躁独行", exact: true }),
    });
  await expect(group.locator(".template-source-link")).not.toBeVisible();
  await group.getByText("来源与角色说明", { exact: true }).click();
  await expect(group.locator(".template-source-link")).toBeVisible();
  await page.getByRole("button", { name: "基于亚历克斯创建" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".template-source p")).not.toBeVisible();
  await dialog.getByText("角色来源", { exact: true }).click();
  await expect(dialog.locator(".template-source p")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "掷幸运骰", exact: true }),
  ).toBeEnabled();
  await expect(dialog.locator(".player-dice-heading")).toContainText("3D6 × 5");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("character-source.png"),
    fullPage: true,
  });
});
