/** Exact source-bound complete terminal routes; missing terminals remain unverified. */
import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import type { SceneView } from "../../packages/contracts/index.js";
import { runtimeFingerprint } from "../../tools/story/runtime-fingerprint.js";
type Draw = { min: number; max: number; value: number };
type Witness = { seed: number; endingId: string; initialDraws: Draw[]; steps: { node: string; action: string; draws: Draw[]; resultNode: string }[] };
const candidate = resolve(process.env.FEAR_CANDIDATE ?? "work/alone-against-fear/packed-candidate");
const reportPath = process.env.FEAR_ROUTE_WITNESSES;
const report = reportPath ? JSON.parse(readFileSync(reportPath, "utf8")) as { manifestSha256: string; runtimeSha256?: string; routes: Witness[] } : undefined;
const test = base.extend<{ witness: Witness | undefined }>({
  witness: [undefined, { option: true }],
  page: async ({ page, witness }, use) => {
    if (!witness || !report) throw Error("未提供合法见证");
    const bytes = readFileSync(join(candidate, "story.json"));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(report.manifestSha256);
    if (report.runtimeSha256) expect(runtimeFingerprint()).toBe(report.runtimeSha256);
    const manifest = JSON.parse(bytes.toString());
    const directory = mkdtempSync(join(tmpdir(), "fear-witness-browser-"));
    const destination = join(directory, "stories", manifest.id, manifest.version);
    mkdirSync(destination, { recursive: true }); cpSync(candidate, destination, { recursive: true });
    let queue: Draw[] = [], index = 0;
    const seen = new Set<string>();
    const app = await buildApp({ storyRoot: join(directory, "stories"), databasePath: join(directory, "game.sqlite"), rateLimitMax: 20000,
      dice: (min, max) => { const draw = queue.shift(); expect(draw).toBeDefined(); expect([min, max]).toEqual([draw!.min, draw!.max]); return draw!.value; } });
    await page.addInitScript(() => localStorage.setItem("reduced-motion", "true"));
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), payload = request.postData();
      if (request.method() === "POST" && payload) {
        const body = JSON.parse(payload);
        if (url.pathname === "/api/runs") queue = witness.initialDraws.slice();
        if (url.pathname.endsWith("/commands") && !seen.has(body.commandId)) {
          expect(queue).toHaveLength(0); expect(body.actionId).toBe(witness.steps[index].action);
          queue = witness.steps[index++].draws.slice(); seen.add(body.commandId);
        }
      }
      const response = await app.inject({ method: request.method() as "GET" | "POST" | "PATCH", url: url.pathname + url.search, headers: { ...request.headers(), host: url.host }, ...(payload ? { payload } : {}) });
      expect(queue).toHaveLength(0);
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined && !["content-length", "transfer-encoding"].includes(key)) headers[key] = Array.isArray(value) ? value.join("\n") : String(value);
      await route.fulfill({ status: response.statusCode, headers, body: response.body });
    });
    try { await use(page); expect(index).toBe(witness.steps.length); } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
  },
});
if (!report) base.skip("Fear complete route requires an exact candidate and FEAR_ROUTE_WITNESSES", async () => {});
for (const witness of report?.routes ?? []) test.describe(`Fear terminal ${witness.endingId}`, () => {
  test.use({ witness });
  test("plays every legal action through real controls and retains state on reload", async ({ page }, info) => {
    test.setTimeout(120000);
    const manifest = JSON.parse(readFileSync(join(candidate, "story.json"), "utf8"));
    const chapter = (id: string) => manifest.nodes.find((node: { id: string }) => node.id === id)?.sourceId ?? id;
    await page.goto("/"); await page.getByRole("button", { name: /登录档案室/ }).click();
    await page.getByRole("button", { name: "第一次来？创建账号" }).click();
    await page.getByLabel("用户名").fill(`fear_${Date.now()}_${info.project.name}`);
    await page.getByLabel("密码").fill("fear-witness-browser"); await page.getByLabel("邀请码").fill("fa6ian-test");
    await page.getByRole("button", { name: "创建账号", exact: true }).click(); await expect(page.getByRole("dialog")).toHaveCount(0);
    const start = await page.evaluate(async () => {
      const response = await fetch("/api/runs", { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "cthulhu-web" }, body: JSON.stringify({ storyId: "alone-against-fear", presetId: "guided", name: "完整路线验收" }) });
      if (response.status !== 201) throw Error(await response.text()); return await response.json() as SceneView;
    });
    await page.goto(`/#/play/${start.runId}`);
    const read = () => page.evaluate(async () => (await fetch(`/api/runs/${location.hash.split("/").at(-1)}`)).json() as Promise<SceneView>);
    let scene = await read();
    for (const [index, step] of witness.steps.entries()) {
      expect(scene.collection!.chapterId).toBe(chapter(step.node));
      const actionIndex = scene.actions.findIndex(action => action.id === step.action); expect(actionIndex).toBeGreaterThanOrEqual(0);
      const response = page.waitForResponse(value => value.url().endsWith("/commands") && value.request().method() === "POST");
      if (scene.fear!.pending?.kind === "creation-skills") {
        const keys = scene.fear!.pending.options[actionIndex].split("|");
        await page.getByLabel("第 1 项技能").selectOption(keys[0]); await page.getByLabel("第 2 项技能").selectOption(keys[1]);
        await page.getByRole("button", { name: "确认技能", exact: true }).click();
      } else await page.locator(".choices button").nth(actionIndex).click();
      const result = await response; expect(result.status()).toBe(200); const body = await result.json();
      if (body.dice) {
        await page.getByRole("dialog", { name: "规则骰结果" }).getByRole("button", { name: "掷骰", exact: true }).click();
        await page.getByRole("button", { name: "继续故事", exact: true }).click();
      }
      scene = await read(); expect(scene.collection!.chapterId).toBe(chapter(step.resultNode));
      if (index === Math.floor(witness.steps.length / 2)) {
        await page.reload(); await expect(page.locator(".fear-map-box")).toHaveCount(30); expect(await read()).toEqual(scene);
      }
    }
    expect(scene.status).toBe("ended"); expect(scene.collection!.endingId).toBe(witness.endingId);
    await expect(page.locator(".ending")).toContainText(scene.ending!);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: info.outputPath("fear-terminal.png"), fullPage: true });
  });
});
