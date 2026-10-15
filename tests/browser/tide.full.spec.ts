import { grantStoryAccess } from "../helpers/story-access.js";
import { test as base, expect, type Page } from "@playwright/test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import type {
  SceneView,
  CommandResponse,
} from "../../packages/contracts/index.js";
type Draw = { min: number; max: number; value: number };
type Step = {
  node: string;
  action: string;
  input: Record<string, number | string>;
  draws: Draw[];
  resultNode: string;
};
type Witness = {
  role: number;
  endingId: string;
  initialDraws: Draw[];
  steps: Step[];
};
const report = JSON.parse(
  readFileSync(
    new URL("./fixtures/tide-endings.json", import.meta.url),
    "utf8",
  ),
) as { routes: Witness[] };
const selected = [
  ...report.routes.filter((r) => r.endingId === "239"),
  report.routes.find((r) => r.role === 2 && r.endingId === "243")!,
  report.routes.find(
    (r) => r.role === 1 && r.steps.filter((s) => s.node === "81").length >= 3,
  )!,
  report.routes.find(
    (r) => r.role === 0 && r.steps.some((s) => s.action === "spend-luck"),
  )!,
];
const test = base.extend<{ witness: Witness | undefined }>({
  witness: [undefined, { option: true }],
  page: async ({ page, witness }, use) => {
    if (!witness) throw Error("missing witness");
    const folder = mkdtempSync(join(tmpdir(), "coc-tide-browser-"));
    let draws: Draw[] = [],
      index = 0;
    const seen = new Set<string>();
    const app = await buildApp({
      storyRoot: process.env.TIDE_ROOT ?? "stories",
      databasePath: join(folder, "game.sqlite"),
      rateLimitMax: 10000,
      dice: (min, max) => {
        const d = draws.shift();
        expect(d).toBeDefined();
        expect(d!.min).toBe(min);
        expect(d!.max).toBe(max);
        return d!.value;
      },
    });
    await page.addInitScript(() =>
      localStorage.setItem("reduced-motion", "true"),
    );
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        payload = req.postData();
      if (req.method() === "POST" && payload) {
        const data = JSON.parse(payload);
        if (url.pathname === "/api/runs") draws = witness.initialDraws.slice();
        if (url.pathname.endsWith("/commands") && !seen.has(data.commandId)) {
          expect(data.actionId).toBe(witness.steps[index].action);
          expect(draws).toHaveLength(0);
          draws = witness.steps[index++].draws.slice();
          seen.add(data.commandId);
        }
      }
      const result = await app.inject({
        method: req.method() as "GET" | "POST" | "PATCH",
        url: url.pathname + url.search,
        headers: { ...req.headers(), host: url.host },
        ...(payload ? { payload } : {}),
      });
      expect(draws).toHaveLength(0);
      if (url.pathname === "/api/auth/register" && result.statusCode === 200) grantStoryAccess(join(folder, "game.sqlite"), result.json().id, "alone-against-tide");
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.headers))
        if (
          v !== undefined &&
          !["content-length", "transfer-encoding"].includes(k)
        )
          headers[k] = Array.isArray(v) ? v.join("\n") : String(v);
      await route.fulfill({
        status: result.statusCode,
        headers,
        body: result.body,
      });
    });
    try {
      await use(page);
    } finally {
      await app.close();
      rmSync(folder, { recursive: true, force: true });
    }
  },
});
async function read(page: Page): Promise<SceneView> {
  return page.evaluate(async () =>
    (await fetch(`/api/runs/${location.hash.split("/").at(-1)}`)).json(),
  );
}
async function fill(page: Page, scene: SceneView, step: Step) {
  const input = scene.input!;
  if (input.kind !== "allocation") throw Error("unexpected input");
  const a = input.allocation;
  if (a.kind === "attributes") {
    for (const [i, s] of input.skills.entries())
      await page
        .getByLabel(`点值 ${i + 1}`, { exact: true })
        .selectOption(String(step.input[s.key]));
    return;
  }
  const desired = Object.keys(step.input).filter(
    (k) => !k.startsWith("specialty."),
  );
  if (a.kind === "bonus") {
    const skills = input.skills.filter(
      (s) =>
        s.key !== "cthulhuMythos" &&
        (s.key !== "creditRating" || a.includeCredit),
    );
    for (const [i, s] of skills.entries())
      await page
        .getByLabel(`加值 ${i + 1}`, { exact: true })
        .fill(String(step.input[s.key] ?? 0));
  } else {
    for (const [i, key] of desired.entries()) {
      const select = page.getByLabel(`技能 ${i + 1}`, { exact: true });
      if (await select.isEnabled()) {
        // Free any later placeholder occupying this desired skill, through ordinary controls.
        for (let j = i + 1; j < desired.length; j++) {
          const later = page.getByLabel(`技能 ${j + 1}`, { exact: true });
          if ((await later.inputValue()) !== key) continue;
          const spare = await later
            .locator("option:not([disabled])")
            .evaluateAll((options) =>
              (options as HTMLOptionElement[]).map((o) => o.value),
            );
          const replacement = spare.find(
            (k) => k !== key && !desired.slice(0, i).includes(k),
          );
          expect(replacement).toBeDefined();
          await later.selectOption(replacement!);
        }
        await select.selectOption(key);
      } else expect(await select.inputValue()).toBe(key);
      if (a.kind !== "interests")
        await page
          .getByLabel(`点值 ${i + 1}`, { exact: true })
          .selectOption(String(step.input[key]));
    }
  }
  for (const [key, spec] of Object.entries(a.specializations ?? {}))
    if (desired.includes(key) && !spec.fixed)
      await page
        .getByLabel(spec.label, { exact: true })
        .fill(String(step.input["specialty." + key]));
}
for (const w of selected) {
  if (!w) throw Error("missing browser mechanism route");
  test.describe(`Tide role ${w.role} ending ${w.endingId}`, () => {
    test.use({ witness: w });
    test("complete route through actual forms, buttons and saved dice on reload", async ({
      page,
    }, info) => {
      test.setTimeout(240000);
      await page.goto("/");
      await page.getByRole("button", { name: /登录档案室/ }).click();
      await page.getByRole("button", { name: "第一次来？创建账号" }).click();
      await page.getByLabel("用户名").fill(`tide_${Date.now()}_${w.role}`);
      await page.getByLabel("密码").fill("tide-browser-password");
      await page.getByLabel("邀请码").fill("fa6ian-test");
      await page.getByRole("button", { name: "创建账号", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      // Before the candidate is opened in the library, exercise the existing authenticated creation API.
      const response = await page.evaluate(
        async ({ role }) => {
          const r = await fetch("/api/runs", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-requested-with": "cthulhu-web",
            },
            body: JSON.stringify({
              storyId: "alone-against-tide",
              presetId: ["guided", "tide-eleanor", "tide-ellery"][role],
              name: "浏览器验收",
            }),
          });
          return { status: r.status, body: await r.json() };
        },
        { role: w.role },
      );
      expect(response.status).toBe(201);
      await page.goto(`/#/play/${response.body.runId}`);
      let scene = await read(page),
        reloaded = false;
      for (const step of w.steps) {
        expect(scene.collection!.chapterId).toBe(step.node.split("-")[0]);
        if (scene.input) await fill(page, scene, step);
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/commands") && r.request().method() === "POST",
        );
        if (scene.input) await page.locator(".rule-input button").click();
        else {
          const i = scene.actions.findIndex((a) => a.id === step.action);
          expect(i).toBeGreaterThanOrEqual(0);
          await page.locator(".choices button").nth(i).click();
        }
        const r = await response;
        expect(r.status()).toBe(200);
        const body = (await r.json()) as CommandResponse;
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
        await expect(page.locator(".narrative")).toContainText(
          scene.text[0] || "",
        );
        await expect(page.locator(".choices button")).toHaveCount(
          scene.input ? 0 : scene.actions.length,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth + 1,
          ),
        ).toBe(true);
      }
      expect(scene.status).toBe("ended");
      expect(scene.collection?.endingId).toBe(w.endingId);
      await page.screenshot({
        path: info.outputPath("tide-ending.png"),
        fullPage: true,
      });
    });
  });
}

base(
  "third story opens from the public library and offers both Woods cards plus guided creation",
  async ({ page }) => {
    const libraryFolder = mkdtempSync(join(tmpdir(), "tide-library-"));
    const app = await buildApp({
      databasePath: join(libraryFolder, "game.sqlite"),
      dice: (min) => min,
    });
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        payload = req.postData();
      const r = await app.inject({
        method: req.method() as "GET" | "POST" | "PATCH",
        url: url.pathname + url.search,
        headers: { ...req.headers(), host: url.host },
        ...(payload ? { payload } : {}),
      });
      if (url.pathname === "/api/auth/register" && r.statusCode === 200) grantStoryAccess(join(libraryFolder, "game.sqlite"), r.json().id, "alone-against-tide");
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
      await page.goto("/");
      await page.getByRole("button", { name: /登录档案室/ }).click();
      await page.getByRole("button", { name: "第一次来？创建账号" }).click();
      await page.getByLabel("用户名").fill(`tide_library_${Date.now()}`);
      await page.getByLabel("密码").fill("tide-library-password");
      await page.getByLabel("邀请码").fill("fa6ian-test");
      await page.getByRole("button", { name: "创建账号", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "开始潮汐独行", exact: true })
        .click();
      await expect(page.locator(".preset-options button")).toHaveCount(3);
      await expect(page.getByLabel("年龄（可选）")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "掷幸运骰", exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("调查员姓名").fill("伍兹入口验收");
      await page
        .locator(".preset-options button")
        .filter({ has: page.getByText("埃莉诺·伍兹博士", { exact: true }) })
        .click();
      await page.getByRole("button", { name: "确认角色，开始调查" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const scene = await read(page);
      expect(scene.character.profile?.age).toBe(40);
      expect(scene.character.hp).toBe(11);
      expect(scene.character.skills.dodge).toBe(50);
      expect(scene.character.luck).toBe(0);
      await expect(page.locator(".narrative")).toContainText(scene.text[0]);
    } finally {
      await app.close();
      rmSync(libraryFolder, { recursive: true, force: true });
    }
  },
);
