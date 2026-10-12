import { staticAccessFixture } from "../helpers/static-access.js";
import { test as base, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildApp } from "../../apps/api/src/app.js";
import type {
  SceneView,
  CommandResponse,
} from "../../packages/contracts/index.js";

type Draw = { min: number; max: number; value: number };
type Witness = {
  endingId: string;
  role: number;
  luckDice: number[];
  initialDraws: Draw[];
  steps: { node: string; action: string; resultNode: string; draws: Draw[] }[];
};
const report = JSON.parse(
  readFileSync(
    new URL("./fixtures/static-endings.json", import.meta.url),
    "utf8",
  ),
) as { routes: Witness[] };
const test = base.extend<{ witness: Witness | undefined }>({
  witness: [undefined, { option: true }],
  page: async ({ page, witness }, use) => {
    if (!witness) throw new Error("missing replay witness");
    let draws: Draw[] = [],
      index = 0;
    const commands = new Set<string>();
    const access = staticAccessFixture();
    const app = await buildApp({
      databasePath: access.databasePath,
      dice: (min, max) => {
        const draw = draws.shift();
        expect(draw, `unexpected ${min}..${max} draw`).toBeDefined();
        expect(draw!.min).toBe(min);
        expect(draw!.max).toBe(max);
        expect(draw!.value).toBeGreaterThanOrEqual(min);
        expect(draw!.value).toBeLessThan(max);
        return draw!.value;
      },
    });
    await page.addInitScript(() =>
      localStorage.setItem("reduced-motion", "true"),
    );
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        payload = request.postData();
      if (request.method() === "POST") {
        const input = JSON.parse(payload!);
        if (url.pathname === "/api/dice/rolls")
          draws = witness.luckDice.map((value) => ({ min: 1, max: 7, value }));
        if (url.pathname === "/api/runs") draws = witness.initialDraws.slice();
        if (
          url.pathname.endsWith("/commands") &&
          !commands.has(input.commandId)
        ) {
          expect(input.actionId).toBe(witness.steps[index].action);
          expect(draws).toHaveLength(0);
          draws = witness.steps[index++].draws.slice();
          commands.add(input.commandId);
        }
      }
      const response = await app.inject({
        method: request.method() as "GET" | "POST" | "PATCH",
        url: url.pathname + url.search,
        headers: { ...request.headers(), host: url.host },
        ...(payload ? { payload } : {}),
      });
      if (url.pathname === "/api/auth/register" && response.statusCode === 200)
        access.unlock(response.json().id);
      expect(draws).toHaveLength(0);
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
test.describe.configure({ mode: "parallel" });
async function read(page: Page): Promise<SceneView> {
  return page.evaluate(async () =>
    (await fetch(`/api/runs/${location.hash.split("/").at(-1)}`)).json(),
  );
}
for (const witness of report.routes)
  test.describe(`ending ${witness.endingId}`, () => {
    test.use({ witness });
    test("play from creation to the ending through actual buttons and reload saved dice", async ({
      page,
    }) => {
      test.setTimeout(240_000);
      await page.goto("/");
      await page.getByRole("button", { name: /登录档案室/ }).click();
      await page.getByRole("button", { name: "第一次来？创建账号" }).click();
      await page
        .getByLabel("用户名")
        .fill(`end_${witness.endingId}_${Date.now()}`);
      await page.getByLabel("密码").fill("ending-browser-password");
      await page.getByLabel("邀请码").fill("fa6ian-test");
      await page.getByRole("button", { name: "创建账号", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "开始静躁独行", exact: true })
        .click();
      await page.getByLabel("调查员姓名").fill("全结局验收");
      await page
        .locator(".preset-options button")
        .filter({
          has: page.getByText(witness.role === 0 ? "亚历克斯" : "查理", {
            exact: true,
          }),
        })
        .click();
      await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
      await page.getByRole("button", { name: "确认角色，开始调查" }).click();
      await expect(
        page.getByRole("heading", { name: "静躁独行", level: 1, exact: true }),
      ).toBeVisible();
      let scene = await read(page),
        reloaded = false;
      for (const step of witness.steps) {
        // Long witnesses must respect the unchanged production request limit.
        if (witness.steps.length > 50)
          await new Promise((resolve) => setTimeout(resolve, 1000));
        expect(scene.collection!.chapterId).toBe(step.node.split("-")[0]);
        const index = scene.actions.findIndex(
          (action) => action.id === step.action,
        );
        expect(index).toBeGreaterThanOrEqual(0);
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/commands") && r.request().method() === "POST",
        );
        await page.locator(".choices button").nth(index).click();
        const result = await response;
        expect(result.status()).toBe(200);
        const body = (await result.json()) as CommandResponse;
        if (body.check || body.dice) {
          await expect(page.getByRole("dialog")).toBeVisible();
          if (!reloaded) {
            await page.reload();
            expect(await read(page)).toEqual(body.scene);
            reloaded = true;
          }
          await page.getByRole("button", { name: "掷骰", exact: true }).click();
          await page
            .getByRole("button", { name: "继续故事", exact: true })
            .click();
          await expect(page.getByRole("dialog")).toHaveCount(0);
        }
        scene = body.scene;
        expect(scene.collection!.chapterId).toBe(step.resultNode.split("-")[0]);
        await expect(page.locator(".narrative")).toContainText(
          scene.text[0] || "",
        );
        await expect(page.locator(".choices button")).toHaveCount(
          scene.actions.length,
        );
      }
      expect(scene.status).toBe("ended");
      expect(scene.collection!.endingId).toBe(witness.endingId);
      await expect(page.locator(".ending")).toContainText(scene.ending!);
      await page.reload();
      expect(await read(page)).toEqual(scene);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
    });
  });
