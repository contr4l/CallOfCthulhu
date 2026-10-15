import { test as base, expect } from "@playwright/test";
import {
  leaderboardFixture,
  rankingPassword,
} from "../fixtures/leaderboard.js";
const test = base.extend({
  page: async ({ page }, use) => {
    const fixture = await leaderboardFixture();
    let failNext = true;
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        payload = req.postData();
      if (url.pathname === "/api/leaderboard" && failNext) {
        failNext = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "统计服务暂时不可用。" }),
        });
        return;
      }
      const response = await fixture.app.inject({
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
      await fixture.close();
    }
  },
});
test("registered-user rankings support login, retry, ties, pagination, sorting, refresh and saved statistics", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "排行榜", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "排行榜", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /登录或创建账号/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /登录或创建账号/ }).click();
  await page.getByLabel("用户名").fill("远行者");
  await page.getByLabel("密码").fill(rankingPassword);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "全体调查员排行榜" }).getByRole("alert"),
  ).toContainText("统计服务暂时不可用");
  await page.getByRole("button", { name: "重试加载" }).click();
  const list = page.getByRole("list", { name: "调查员排名" });
  const summary = page.locator(".leaderboard-summary");
  await expect(list.locator("li")).toHaveCount(20);
  await expect(summary).toContainText("24");
  await expect(
    page.getByRole("complementary", { name: "我的排名" }),
  ).toContainText("#3");
  await expect(list.locator(".leaderboard-rank").nth(0)).toHaveText("#1");
  await expect(list.locator(".leaderboard-rank").nth(1)).toHaveText("#1");
  await expect(list.locator(".is-self")).toHaveCount(0);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(list.locator("li")).toHaveCount(4);
  await expect(list.locator(".is-self")).toContainText("远行者");
  await expect(
    page.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("排名依据").selectOption("stories");
  await expect(list.locator("li")).toHaveCount(20);
  await expect(list.locator(".leaderboard-name").first()).toContainText(
    "追迹者",
  );
  await page.getByLabel("排名依据").selectOption("points");
  await expect(list.locator(".leaderboard-name").first()).toContainText(
    "领航员",
  );
  // Actual authenticated play changes the aggregate; there is no leaderboard write API.
  const result = await page.evaluate(async () => {
    const post = async (url: string, body: unknown) => {
      const r = await fetch(`/api${url}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-requested-with": "cthulhu-web",
        },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw Error(await r.text());
      return r.json();
    };
    const dice = await post("/dice/rolls", {
      id: crypto.randomUUID(),
      purpose: "luck",
      sides: 6,
      count: 3,
    });
    const run = await post("/runs", {
      storyId: "alone-against-flames",
      presetId: "actor",
      name: "排行浏览器",
      luckRollId: dice.id,
    });
    return post(`/runs/${run.runId}/commands`, {
      commandId: crypto.randomUUID(),
      expectedRevision: run.revision,
      actionId: "earn-hard",
    });
  });
  expect(result.scene.status).toBe("ended");
  await page.getByRole("button", { name: "刷新统计" }).click();
  await expect(
    page.getByRole("complementary", { name: "我的排名" }),
  ).toContainText("已收集 1 个结局");
  await page.reload();
  await expect(page.getByLabel("排名依据")).toHaveValue("endings");
  await expect(list.locator(".is-self")).toContainText("远行者");
  await expect(
    page.getByRole("complementary", { name: "我的排名" }),
  ).toContainText("累计 3 成就点");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/leaderboard-${info.project.name}.png`,
    fullPage: true,
  });
  await page.screenshot({
    path: info.outputPath("leaderboard-viewport.png"),
    fullPage: false,
  });
  expect(errors).toEqual([]);
});
