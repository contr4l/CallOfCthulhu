import { test as base, expect, type Page } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import { grantStoryAccess } from "../helpers/story-access.js";

const test = base.extend<{ unlockAll: () => void }>({
  unlockAll: async ({ page }, use) => {
    const root = mkdtempSync(join(tmpdir(), "character-browser-"));
    const databasePath = join(root, "game.sqlite");
    const app = await buildApp({
      databasePath,
      rateLimitMax: 2000,
      dice: (min) => min,
    });
    let owner = "";
    await page.addInitScript(() =>
      localStorage.setItem("reduced-motion", "true"),
    );
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const response = await app.inject({
        method: request.method() as "GET" | "POST" | "PATCH",
        url: url.pathname + url.search,
        headers: { ...request.headers(), host: url.host },
        ...(request.postData() ? { payload: request.postData()! } : {}),
      });
      if (url.pathname === "/api/auth/register" && response.statusCode === 200)
        owner = response.json().id;
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
      await use(() => {
        for (const id of ["static", "tide", "frost", "fear"])
          grantStoryAccess(databasePath, owner, `alone-against-${id}`);
      });
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
});
async function register(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page.getByLabel("用户名").fill(`chars_${Date.now()}`);
  await page.getByLabel("密码").fill("characters-browser-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function characters(page: Page) {
  await page.goto("/#/characters");
  await expect(
    page.getByRole("heading", { name: "按剧本创建调查员" }),
  ).toBeVisible();
}

test("all five story groups show creation policies and locked entries open the shop", async ({
  page,
  unlockAll,
}, info) => {
  await register(page);
  await characters(page);
  await expect(page.locator(".template-group")).toHaveCount(5);
  for (const title of [
    "向火独行",
    "静躁独行",
    "潮汐独行",
    "冰霜独行",
    "恐惧独行",
  ])
    await expect(
      page
        .locator(".template-group")
        .getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
  const tide = page
    .locator(".template-group")
    .filter({
      has: page.getByRole("heading", { name: "潮汐独行", exact: true }),
    });
  await expect(tide.locator(".template-card")).toHaveCount(3);
  await tide.getByRole("button", { name: "前往解锁潮汐独行" }).first().click();
  await expect(
    page.getByRole("heading", { name: "余烬商店", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  unlockAll();
  await page.reload();
  await characters(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("character-library.png"),
    fullPage: true,
  });
});

test("guided presets enter the matching setup without luck rerolls and saved cards resume after reload", async ({
  page,
  unlockAll,
}, info) => {
  await register(page);
  unlockAll();
  await page.reload();
  await characters(page);
  for (const [title, label] of [
    ["潮汐独行", "埃勒里·伍兹博士"],
    ["冰霜独行", "纳德尔曼博士（女性角色表）"],
    ["恐惧独行", "引导式建卡"],
  ]) {
    const group = page
      .locator(".template-group")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await group.getByRole("button", { name: `使用${label}开始调查` }).click();
    const dialog = page.getByRole("dialog", { name: `进入「${title}」` });
    await expect(dialog.locator('input[name="preset"]')).toHaveValue(
      title === "潮汐独行"
        ? "tide-ellery"
        : title === "冰霜独行"
          ? "nadelmann-female"
          : "guided",
    );
    await expect(
      dialog.getByRole("button", { name: "掷幸运骰", exact: true }),
    ).toHaveCount(0);
    await dialog
      .getByLabel(title === "恐惧独行" ? "幸存者姓名" : "调查员姓名", {
        exact: true,
      })
      .fill(`${title}角色`);
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/api/runs") && r.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "确认角色，开始调查" }).click();
    expect((await created).status()).toBe(201);
    await expect(dialog).toHaveCount(0);
    await characters(page);
    const card = page
      .locator(".saved-character-entry")
      .filter({ hasText: `${title}角色` });
    await expect(card.locator(".saved-character-origin")).toContainText(title);
  }
  await page.reload();
  const fearCard = page
    .locator(".saved-character-entry")
    .filter({ hasText: "恐惧独行角色" });
  await expect(fearCard).toContainText("SURVIVOR");
  await expect(fearCard).not.toContainText("困难");
  await fearCard.getByRole("button", { name: "填写角色卡" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("个人笔记")
    .fill("调查员页适配验收");
  await page.getByRole("dialog").getByRole("button", { name: /保存/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await fearCard.getByText("个人资料与笔记", { exact: true }).click();
  await expect(fearCard).toContainText("调查员页适配验收");
  await page.screenshot({
    path: info.outputPath("saved-characters.png"),
    fullPage: true,
  });
  await fearCard.getByRole("button", { name: "继续关联调查" }).click();
  await expect(page).toHaveURL(/#\/play\//);
  await expect(page.locator(".fear-map-box")).toHaveCount(30);
});
