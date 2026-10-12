import { test as base, expect, type Page } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import { fixture } from "../fixtures/shop-story.js";
const test = base.extend({
  page: async ({ page }, use) => {
    const root = mkdtempSync(join(tmpdir(), "coc-shop-browser-")),
      path = join(root, fixture.id, fixture.version);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "story.json"), JSON.stringify(fixture));
    const staticPath = join(root, "alone-against-static", fixture.version);
    mkdirSync(staticPath, { recursive: true });
    writeFileSync(
      join(staticPath, "story.json"),
      JSON.stringify({
        ...fixture,
        id: "alone-against-static",
        title: "静躁独行",
      }),
    );
    let draws: number[] = [];
    const app = await buildApp({
      storyRoot: root,
      dice: (min) => (draws.length ? draws.shift()! : min),
    });
    await page.addInitScript(() => {
      localStorage.setItem("reduced-motion", "true");
      Object.defineProperty(crypto, "randomUUID", { value: undefined });
    });
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        payload = req.postData();
      if (url.pathname.endsWith("/commands")) {
        const c = JSON.parse(payload!);
        if (c.actionId === "roll") draws = c.shopItem ? [5, 2] : [8, 3];
        if (c.actionId === "shop-reroll") draws = [2, 1];
      }
      const r = await app.inject({
        method: req.method() as "GET" | "POST" | "PATCH",
        url: url.pathname + url.search,
        headers: { ...req.headers(), host: url.host },
        ...(payload ? { payload } : {}),
      });
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(r.headers))
        if (
          v !== undefined &&
          !["content-length", "transfer-encoding"].includes(k)
        )
          headers[k] = Array.isArray(v) ? v.join("\n") : String(v);
      await route.fulfill({ status: r.statusCode, headers, body: r.body });
    });
    try {
      await use(page);
    } finally {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
});
async function nav(page: Page, mobile: boolean, name: string) {
  if (await page.locator(".is-reading").count())
    await page.getByRole("button", { name: "返回档案", exact: true }).click();
  if (mobile) await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function start(page: Page) {
  await page.getByRole("button", { name: "开始商店测试", exact: true }).click();
  await page.getByLabel("调查员姓名").fill("商店验收");
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await expect(page.locator(".choices button").first()).toBeEnabled();
}
test("claim points, buy items, reroll a failure after reload and use a target boost", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mobile = info.project.name === "mobile";
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page.getByLabel("用户名").fill("商店浏览器玩家");
  await page.getByLabel("密码").fill("shop-browser-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const [choice, title] of [
    ["测试困难奖励", "困难奖励"],
    ["测试生还奖励", "生还奖励"],
  ]) {
    await start(page);
    await page.getByRole("button", { name: new RegExp(choice) }).click();
    await expect(page.locator(".ending")).toBeVisible();
    await nav(page, mobile, "成就");
    const card = page
      .locator(".achievement-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    await card.getByRole("button", { name: "领取点数" }).click();
    await expect(card.getByRole("button", { name: "已领取" })).toBeDisabled();
    await nav(page, mobile, "剧本馆");
  }
  await nav(page, mobile, "商店");
  await expect(page.locator(".point-balance")).toContainText("5");
  await page.getByRole("button", { name: "购买重掷券", exact: true }).click();
  await expect(page.locator(".point-balance")).toContainText("2");
  await page.getByRole("button", { name: "购买命运助力", exact: true }).click();
  await expect(page.locator(".point-balance")).toContainText("0");
  await page.screenshot({
    path: `docs/screenshots/shop-${info.project.name}.png`,
    fullPage: true,
  });
  await nav(page, mobile, "剧本馆");
  await start(page);
  await page.getByRole("button", { name: /进入测试检定/ }).click();
  await page.getByRole("button", { name: /进行聆听检定/ }).click();
  await page.getByRole("button", { name: "掷骰", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续故事" })).toBeVisible();
  await expect(page.locator(".check-comparison")).toContainText("38 > 20");
  await page.reload();
  await page.getByRole("button", { name: "掷骰", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "使用重掷券（持有 1）" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "使用重掷券（持有 1）" }).click();
  await page.getByRole("button", { name: "掷骰", exact: true }).click();
  await expect(page.locator(".check-comparison")).toContainText("12 ≤ 20");
  await expect(page.locator(".check-explanation")).toContainText("上次 38");
  await page.getByRole("button", { name: "继续故事" }).click();
  await expect(page.locator(".narrative h1")).toHaveText("检定成功");
  await expect(page.locator(".character-card")).toContainText("11");
  await nav(page, mobile, "剧本馆");
  await start(page);
  await page.getByRole("button", { name: /进入测试检定/ }).click();
  await page.getByLabel(/使用命运助力/).check();
  await page.getByRole("button", { name: /进行聆听检定/ }).click();
  await page.getByRole("button", { name: "掷骰", exact: true }).click();
  await expect(page.locator(".check-comparison")).toContainText(
    "目标 30，25 ≤ 30",
  );
  await page.getByRole("button", { name: "继续故事" }).click();
  await expect(page.locator(".narrative h1")).toHaveText("检定成功");
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("unlock the second module after three distinct endings using shop points", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const mobile = info.project.name === "mobile";
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page.getByLabel("用户名").fill("解锁浏览器玩家");
  await page.getByLabel("密码").fill("shop-browser-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "解锁静躁独行", exact: true }).click();
  const unlock = page.getByRole("button", {
    name: "解锁静躁独行",
    exact: true,
  });
  await expect(unlock).toBeDisabled();
  await expect(
    page.getByRole("article", { name: "解锁静躁独行" }),
  ).toContainText("0 / 3");
  await nav(page, mobile, "剧本馆");
  for (const [choice, title] of [
    ["测试困难奖励", "困难奖励"],
    ["测试生还奖励", "生还奖励"],
  ]) {
    await start(page);
    await page.getByRole("button", { name: new RegExp(choice) }).click();
    await expect(page.locator(".ending")).toBeVisible();
    await nav(page, mobile, "成就");
    await page
      .locator(".achievement-card")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .getByRole("button", { name: "领取点数" })
      .click();
    await nav(page, mobile, "剧本馆");
  }
  await nav(page, mobile, "商店");
  await expect(page.locator(".point-balance")).toContainText("5");
  await expect(unlock).toBeDisabled();
  await nav(page, mobile, "剧本馆");
  await start(page);
  await page.getByRole("button", { name: /进入测试检定/ }).click();
  await page.getByRole("button", { name: /进行聆听检定/ }).click();
  await page.getByRole("button", { name: "掷骰", exact: true }).click();
  await page.getByRole("button", { name: "继续故事" }).click();
  await expect(page.locator(".ending")).toBeVisible();
  await nav(page, mobile, "商店");
  await expect(
    page.getByRole("article", { name: "解锁静躁独行" }),
  ).toContainText("3 / 3");
  await expect(unlock).toBeEnabled();
  await unlock.click();
  await expect(
    page.getByRole("button", { name: "已解锁", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".point-balance")).toContainText("2");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "已解锁", exact: true }),
  ).toBeDisabled();
  await nav(page, mobile, "剧本馆");
  await page.getByRole("button", { name: "开始静躁独行", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
