import { grantStoryAccess } from "../helpers/story-access.js";
/** Candidate smoke only; complete book endings require separate legal witnesses. */
import { test as base, expect } from "@playwright/test";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import type { SceneView } from "../../packages/contracts/index.js";
const candidate = resolve(process.env.FEAR_CANDIDATE ?? "work/alone-against-fear/packed-candidate");

const test = base.extend({
  page: async ({ page }, use) => {
    const temporary = mkdtempSync(join(tmpdir(), "fear-candidate-browser-"));
    const manifest = JSON.parse(readFileSync(join(candidate, "story.json"), "utf8"));
    const packagePath = join(temporary, "stories", manifest.id, manifest.version);
    mkdirSync(packagePath, { recursive: true }); cpSync(candidate, packagePath, { recursive: true });
    const app = await buildApp({ storyRoot: join(temporary, "stories"), databasePath: join(temporary, "game.sqlite"), rateLimitMax: 1000, dice: min => min });
    await page.addInitScript(() => localStorage.setItem("reduced-motion", "true"));
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      const response = await app.inject({ method: request.method() as "GET" | "POST" | "PATCH", url: url.pathname + url.search,
        headers: { ...request.headers(), host: url.host }, ...(request.postData() ? { payload: request.postData()! } : {}) });
      if (url.pathname === "/api/auth/register" && response.statusCode === 200) grantStoryAccess(join(temporary, "game.sqlite"), response.json().id, manifest.id);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined && !["content-length", "transfer-encoding"].includes(key)) headers[key] = Array.isArray(value) ? value.join("\n") : String(value);
      await route.fulfill({ status: response.statusCode, headers, body: response.body });
    });
    try { await use(page); } finally { await app.close(); rmSync(temporary, { recursive: true, force: true }); }
  },
});
test.skip(!existsSync(join(candidate, "story.json")), "Compile and strictly pack the isolated Fear candidate before its browser smoke test");
test("real Fear candidate supports source creation controls, a thirty-box map and reload", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page.getByLabel("用户名").fill(`fear_${Date.now()}_${info.project.name}`);
  await page.getByLabel("密码").fill("fear-browser-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const scene = await page.evaluate(async () => {
    const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "cthulhu-web" },
      body: JSON.stringify({ storyId: "alone-against-fear", presetId: "guided", name: "恐惧验收" }) });
    if (response.status !== 201) throw Error(await response.text());
    return await response.json() as SceneView;
  });
  await page.goto(`/#/play/${scene.runId}`);
  await expect(page.locator(".fear-map-box")).toHaveCount(30);
  const act = async (perform: () => Promise<void>) => {
    const response = page.waitForResponse(value => value.url().endsWith("/commands") && value.request().method() === "POST");
    await perform();
    const result = await response; expect(result.status()).toBe(200);
    const body = await result.json();
    if (body.dice) {
      await page.getByRole("dialog", { name: "规则骰结果" }).getByRole("button", { name: "掷骰", exact: true }).click();
      await page.getByRole("button", { name: "继续故事", exact: true }).click();
    }
  };
  await act(() => page.locator(".choices button").first().click());
  await expect(page.getByLabel("第 1 项技能")).toBeVisible();
  await expect(page.getByLabel("第 2 项技能")).toBeVisible();
  const first = await page.getByLabel("第 1 项技能").inputValue();
  const second = await page.getByLabel("第 2 项技能").inputValue();
  expect(first).not.toBe(second);
  await act(() => page.getByRole("button", { name: "确认技能", exact: true }).click());
  await expect(page.getByLabel("第 1 项技能")).toHaveCount(0);
  await act(() => page.locator(".choices button").first().click());
  await expect(page.locator(".choices button")).toHaveCount(2);
  await act(() => page.locator(".choices button").first().click());
  await expect(page.locator(".choices")).toContainText("前往");
  const read = () => page.evaluate(async () => (await fetch(`/api/runs/${location.hash.split("/").at(-1)}`)).json() as Promise<SceneView>);
  const before = await read();
  expect(before.character.rulesVersion).toBe("aaf-solo@1");
  expect(before.character.attributes).toBeUndefined();
  expect(before.fear!.currentBox.id).toBe("s1:b1");
  expect(before.fear!.mapSheets[0].boxes.filter(box => box.visited)).toHaveLength(1);
  expect(before.fear!.mapSheets[0].boxes.filter(box => !box.visited).every(box => !("scene" in box))).toBeTruthy();
  await page.reload();
  await expect(page.locator(".fear-map-box")).toHaveCount(30);
  expect(await read()).toEqual(before);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath("fear-creation.png"), fullPage: true });
});
