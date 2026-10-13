import { staticAccessFixture } from "../helpers/static-access.js";
import { test as base, expect, type Page } from "@playwright/test";
import { buildApp } from "../../apps/api/src/app.js";
import type {
  SceneView,
  CommandResponse,
} from "../../packages/contracts/index.js";
import { readFileSync } from "node:fs";
const routes = JSON.parse(
  readFileSync(
    new URL("./fixtures/static-routes.json", import.meta.url),
    "utf8",
  ),
) as {
  name: string;
  role: number;
  failNodes: string[];
  steps: { chapter: string; action: string }[];
  endingId: string;
  ending: string;
}[];

const test = base.extend<{ failNodes: string[] }>({
  failNodes: [[], { option: true }],
  page: async ({ page, failNodes }, use) => {
    let current: SceneView | undefined;
    const access = staticAccessFixture();
    const app = await buildApp({
      databasePath: access.databasePath,
      dice: (min, max) =>
        max === 10
          ? failNodes.includes(current?.collection?.chapterId ?? "")
            ? 9
            : 1
          : min,
    });
    await page.addInitScript(() =>
      localStorage.setItem("reduced-motion", "true"),
    );
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const payload = request.postData();
      const response = await app.inject({
        method: request.method() as "GET" | "POST" | "PATCH",
        url: url.pathname + url.search,
        headers: { ...request.headers(), host: url.host },
        ...(payload ? { payload } : {}),
      });
      if (url.pathname === "/api/auth/register" && response.statusCode === 200)
        access.unlock(response.json().id);
      const body = response.json();
      if (body?.scene) current = body.scene;
      else if (body?.runId) current = body;
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
      await app.close();
      access.close();
    }
  },
});

async function read(page: Page): Promise<SceneView> {
  return page.evaluate(async () =>
    (await fetch(`/api/runs/${location.hash.split("/").at(-1)}`)).json(),
  );
}

test("saved Static role is selected from eligible characters without rerolling its luck", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page.getByLabel("用户名").fill(`saved_${Date.now()}`);
  await page.getByLabel("密码").fill("static-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const character = await page.evaluate(async () => {
    const headers = {
      "content-type": "application/json",
      "x-requested-with": "cthulhu-web",
    };
    const post = async (url: string, data: unknown) => {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json();
    };
    const roll = await post("/api/dice/rolls", {
      id: crypto.randomUUID(),
      purpose: "luck",
      count: 3,
      sides: 6,
    });
    const actor = await post("/api/characters", {
      templateId: "static-charlie",
      name: "保存的查理",
      luckRollId: roll.id,
    });
    // Newest archives appear first; this incompatible character must not
    // become Static's initially selected saved character.
    await post("/api/runs", {
      storyId: "alone-against-flames",
      presetId: "guided",
      name: "另一模组的调查员",
    });
    return actor.character;
  });
  await page.reload();
  await page.getByRole("button", { name: "开始静躁独行", exact: true }).click();
  await page.getByRole("button", { name: "已有调查员", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toContainText("另一模组的调查员");
  await expect(page.getByLabel("调查员姓名")).toHaveValue("保存的查理");
  await expect(
    page.getByRole("button", { name: "掷幸运骰", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await expect(
    page.getByRole("heading", { name: "静躁独行", level: 1, exact: true }),
  ).toBeVisible();
  expect((await read(page)).character).toEqual(character);
  await expect(page.locator(".record-sheet")).toContainText("查理");
  await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "English", exact: true }),
  ).toHaveAttribute("disabled", "");
  await expect(page.getByRole("dialog")).toContainText("暂无英文正文。");
  await page.getByRole("button", { name: "返回阅读" }).click();
});

for (const plan of routes) {
  test.describe(plan.name, () => {
    test.use({ failNodes: plan.failNodes });
    test("complete Static through the real UI, recover saved dice, and collect its ending", async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.goto("/");
      await page.getByRole("button", { name: /登录档案室/ }).click();
      await page.getByRole("button", { name: "第一次来？创建账号" }).click();
      await page.getByLabel("用户名").fill(`static_${Date.now()}_${plan.name}`);
      await page.getByLabel("密码").fill("static-testing-password");
      await page.getByLabel("邀请码").fill("fa6ian-test");
      await page.getByRole("button", { name: "创建账号", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "开始静躁独行", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "自定义技能", exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("调查员姓名").fill("静躁路线验收");
      const role = plan.role === 0 ? "亚历克斯" : "查理";
      await page
        .locator(".preset-options button")
        .filter({ has: page.getByText(role, { exact: true }) })
        .click();
      await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
      await page.getByRole("button", { name: "确认角色，开始调查" }).click();
      await expect(
        page.getByRole("heading", { name: "静躁独行", level: 1, exact: true }),
      ).toBeVisible();
      let scene = await read(page);
      expect(scene.revision).toBe(0);
      let restoredDice = false;
      for (const step of plan.steps) {
        expect(scene.collection!.chapterId).toBe(step.chapter);
        await expect(page.locator(".narrative")).not.toContainText(
          /记录表|转到\s*\d|回到\s*\d|尚未选择/,
        );
        const index = scene.actions.findIndex(
          (action) => action.id === step.action,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/commands") && r.request().method() === "POST",
        );
        await page.locator(".choices button").nth(index).click();
        const r = await response;
        expect(r.status()).toBe(200);
        const body = (await r.json()) as CommandResponse;
        if (body.check || body.dice) {
          await expect(page.getByRole("dialog")).toBeVisible();
          if (!restoredDice) {
            await page.reload();
            expect(await read(page)).toEqual(body.scene);
            restoredDice = true;
          }
          await page.getByRole("button", { name: "掷骰", exact: true }).click();
          await page
            .getByRole("button", { name: "继续故事", exact: true })
            .click();
        }
        scene = body.scene;
        await expect(page.locator(".narrative")).toContainText(
          scene.text[0] || "",
        );
        if (scene.revision === 1)
          await expect(page.locator(".record-sheet")).toContainText(role);
      }
      expect(restoredDice).toBeTruthy();
      expect(scene.status).toBe("ended");
      expect(scene.collection!.endingId).toBe(plan.endingId);
      expect(scene.ending).toBe(plan.ending);
      if (plan.name === "cold")
        expect(
          scene.registrations?.some((r) => r.label === "着凉"),
        ).toBeTruthy();
      await expect(page.locator(".ending")).toContainText(plan.ending!);
      await page.reload();
      expect(await read(page)).toEqual(scene);
      const collections = await page.evaluate(async () =>
        (await fetch("/api/collections")).json(),
      );
      expect(
        collections
          .find(
            (s: { storyId: string }) => s.storyId === "alone-against-static",
          )
          .endings.entries.some((e: { id: string }) => e.id === plan.endingId),
      ).toBeTruthy();
      const achievements = await page.evaluate(async () =>
        (await fetch("/api/achievements")).json(),
      );
      expect(
        achievements.some(
          (a: { storyId: string; endingId: string; unlockedAt?: string }) =>
            a.storyId === "alone-against-static" &&
            a.endingId === plan.endingId &&
            a.unlockedAt,
        ),
      ).toBeTruthy();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    });
  });
}
