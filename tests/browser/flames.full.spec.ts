import { test as base, expect, type Page } from "@playwright/test";
import { buildApp } from "../../apps/api/src/app.js";
import type {
  SceneView,
  CommandResponse,
} from "../../packages/contracts/index.js";
import { readFileSync } from "node:fs";
const routeData = JSON.parse(
  readFileSync(
    new URL("./fixtures/flames-routes.json", import.meta.url),
    "utf8",
  ),
);
const routes = routeData as unknown as Record<
  "survival" | "magic" | "death" | "map" | "combat",
  { node: string; action: string; input?: Record<string, number | string> }[]
>;
// Real React UI and API handlers; only randomness is controlled. No state injection or jump endpoint.
const test = base.extend<{ failNodes: string[]; firstCombatLoss: boolean }>({
  failNodes: [[], { option: true }],
  firstCombatLoss: [false, { option: true }],
  page: async ({ page, failNodes, firstCombatLoss }, use) => {
    let current: SceneView | undefined,
      action = "",
      firstLossDone = false;
    let combatDice = [1, 2, 1, 1, 1, 1];
    const app = await buildApp({
      dice: (min, max) => {
        if (
          failNodes.includes(current?.collection?.chapterId ?? "") &&
          max === 10
        )
          return 9;
        if (
          firstCombatLoss &&
          !firstLossDone &&
          current?.combat?.name === "黑熊" &&
          action === "attack"
        )
          return combatDice.shift() ?? min;
        return max === 10 ? 1 : min;
      },
    });
    await page.addInitScript(() =>
      localStorage.setItem("reduced-motion", "true"),
    );
    await page.route("**/api/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const payload = request.postData();
      if (url.pathname.endsWith("/commands"))
        action = JSON.parse(payload!).actionId;
      const r = await app.inject({
        method: request.method() as "GET" | "POST" | "PATCH",
        url: url.pathname + url.search,
        headers: { ...request.headers(), host: url.host },
        ...(payload ? { payload } : {}),
      });
      if (
        firstCombatLoss &&
        current?.combat?.name === "黑熊" &&
        action === "attack" &&
        !combatDice.length
      )
        firstLossDone = true;
      const body = r.json();
      if (body.scene) current = body.scene;
      else if (body.runId) current = body;
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
    }
  },
});
const attrs = {
  str: 70,
  con: 60,
  pow: 60,
  dex: 80,
  app: 50,
  siz: 50,
  int: 50,
  edu: 40,
};
async function read(page: Page) {
  return page.evaluate(async () => {
    const id = location.hash.split("/").at(-1);
    return (await fetch(`/api/runs/${id}`)).json();
  }) as Promise<SceneView>;
}
async function start(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`full_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("full-browser-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "开始向火独行", exact: true }).click();
  await page.getByLabel("调查员姓名").fill("完整路线验收");
  await page.getByLabel("年龄（可选）").fill("28");
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await expect(
    page.getByRole("heading", { name: "向火独行", level: 1, exact: true }),
  ).toBeVisible();
  return read(page);
}
async function step(
  page: Page,
  scene: SceneView,
  plan: { action: string; input?: Record<string, number | string> },
  reloadDice = false,
) {
  const beforeText = await page.locator(".narrative").innerText();
  await expect(
    page.locator(".rule-input button,.choices button").first(),
  ).toBeEnabled();
  if (scene.input?.kind === "allocation") {
    const a = scene.input.allocation,
      values = plan.input!;
    if (a.kind === "attributes") {
      for (const [i, skill] of scene.input.skills.entries())
        await page
          .getByLabel(`点值 ${i + 1}`, { exact: true })
          .selectOption(String(values[skill.key]));
    } else {
      for (const [i, key] of Object.keys(values).entries()) {
        const select = page.getByLabel(`技能 ${i + 1}`, { exact: true });
        if (await select.isEnabled()) await select.selectOption(key);
        if (a.kind !== "interests")
          await page
            .getByLabel(`点值 ${i + 1}`, { exact: true })
            .selectOption(String(values[key]));
      }
    }
  } else if (scene.input?.kind === "number")
    await page
      .locator(".rule-input input[type=number]")
      .fill(String(plan.input!.value));
  const response = page.waitForResponse(
    (r) => r.url().includes("/commands") && r.request().method() === "POST",
  );
  if (scene.input) await page.locator(".rule-input button").click();
  else {
    const index = scene.actions.findIndex((a) => a.id === plan.action);
    expect(index).toBeGreaterThanOrEqual(0);
    await page.locator(".choices button").nth(index).click();
  }
  const r = await response;
  expect(r.status()).toBe(200);
  const body = (await r.json()) as CommandResponse;
  if (body.dice || body.check) {
    await expect(page.locator(".narrative")).toHaveText(beforeText, {
      useInnerText: true,
    });
    await expect(page.locator(".choices button").first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "关闭窗口" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.locator(".modal-backdrop").dispatchEvent("mousedown");
    await expect(page.getByRole("dialog")).toBeVisible();
    let extraCommands = 0;
    const countCommand = (request: import("@playwright/test").Request) => {
      if (request.url().endsWith("/commands")) extraCommands++;
    };
    page.on("request", countCommand);
    await page.locator(".choices button").first().dispatchEvent("click");
    expect(extraCommands).toBe(0);
    page.off("request", countCommand);
    if (reloadDice) {
      await page.reload();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.locator(".narrative")).toHaveText(beforeText, {
        useInnerText: true,
      });
      expect(await read(page)).toEqual(body.scene);
    }
  }
  await expect(page.locator(".play-page")).toHaveAttribute(
    "data-revision",
    String(body.dice || body.check ? scene.revision : body.scene.revision),
  );
  if (body.dice) {
    await expect(
      page.getByRole("dialog", { name: "规则骰结果" }),
    ).toBeVisible();
    await expect(page.locator(".dice-scene canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "掷骰", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续故事", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".dice-scene canvas").first()).toBeVisible();
    await expect(page.locator(".narrative")).toHaveText(beforeText, {
      useInnerText: true,
    });
    expect(await page.locator(".poly-die strong").allTextContents()).toEqual(
      body.dice.groups.flatMap((g) => g.results).map(String),
    );
    await expect(page.locator(".roll-equation")).toContainText("3 × 5 = 15");
    await page.getByRole("button", { name: "继续故事", exact: true }).click();
  }
  if (body.check) {
    await expect(
      page.getByRole("dialog", { name: "命运已经落定" }),
    ).toBeVisible();
    await expect(page.locator(".dice-scene canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "掷骰", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "继续故事", exact: true }),
    ).toBeVisible();
    const won = body.check.combat
      ? ["hit", "dodged"].includes(body.check.combat.result)
      : body.check.success;
    await expect(page.locator(".narrative")).toHaveText(beforeText, {
      useInnerText: true,
    });
    await expect(page.locator(".dice-result h2")).toHaveCSS(
      "color",
      won ? "rgb(143, 211, 168)" : "rgb(240, 154, 159)",
    );
    const passed =
      !["failure", "fumble"].includes(body.check.grade) &&
      (body.check.roll === 1 || body.check.roll <= body.check.target);
    await expect(page.locator(".check-comparison").first()).toContainText(
      `D100 · 目标 ${body.check.target}，${body.check.roll}`,
    );
    await expect(
      page.locator(".check-comparison").first().locator("span").last(),
    ).toHaveCSS("color", passed ? "rgb(143, 211, 168)" : "rgb(240, 154, 159)");
    if (body.check.combat?.result === "hurt" && body.check.success) {
      await expect(
        page.getByRole("heading", { name: "对手命中了你", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".combat-resolution")).toContainText(
        `你受到 ${body.check.combat.damage} 点伤害`,
      );
    }
    await page.getByRole("button", { name: "继续故事", exact: true }).click();
  }
  await expect(page.locator(".play-page")).toHaveAttribute(
    "data-revision",
    String(body.scene.revision),
  );
  await expect(page.locator(".narrative")).not.toContainText(
    /\[guide-|(?:转到|回到)\s*\d|快速入门规则第|规则书第/,
  );
  return body.scene;
}
test("dice reveal gates the next scene and survives reload for rule dice and checks", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", { value: undefined }),
  );
  let scene = await start(page),
    seenRule = false,
    seenCheck = false;
  for (const plan of routes.survival) {
    const isRule = scene.actions.some((action) => /幸运/.test(action.label));
    const isCheck = !!scene.check;
    scene = await step(page, scene, plan, isRule || isCheck);
    seenRule ||= isRule;
    seenCheck ||= isCheck;
    if (seenRule && seenCheck) break;
  }
  expect(seenRule).toBe(true);
  expect(seenCheck).toBe(true);
});
async function complete(page: Page, name: keyof typeof routes) {
  let scene = await start(page),
    refreshed = false,
    sawMap = false,
    sawCombat = false,
    sawSpell = false;
  for (const plan of routes[name]) {
    if (scene.illustration) {
      sawMap = true;
      await page.getByRole("button", { name: "放大地图" }).click();
      await expect(
        page.getByRole("dialog", { name: "烬头村地图" }),
      ).toBeVisible();
      expect(
        await page
          .locator(".map-full")
          .evaluate((n: HTMLImageElement) => n.complete && n.naturalWidth > 0),
      ).toBeTruthy();
      await page.getByRole("button", { name: "关闭窗口" }).click();
    }
    sawCombat ||= !!scene.combat;
    sawSpell ||= scene.input?.kind === "number";
    scene = await step(page, scene, plan);
    if (!refreshed && scene.revision > 20) {
      const before = scene;
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: scene.title.replace(/\s*[·]\s*\d+$/, ""),
          level: 1,
          exact: true,
        }),
      ).toBeVisible();
      scene = await read(page);
      expect(scene).toEqual(before);
      refreshed = true;
    }
  }
  expect(scene.status).toBe("ended");
  await expect(page.locator(".ending")).toContainText(scene.ending!);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  const collections = await page.evaluate(async () =>
    (await fetch("/api/collections")).json(),
  );
  const collected = collections.find(
    (s: { version: string; storyId: string }) =>
      s.storyId === "alone-against-flames" && s.version === "1.1.0",
  );
  expect(
    collected.endings.entries.some(
      (e: { id: string }) => e.id === scene.collection!.endingId,
    ),
  ).toBeTruthy();
  return { scene, sawMap, sawCombat, sawSpell };
}
test("Chinese adventure completes from entry to ordinary survival with mid-run reload", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const { scene } = await complete(page, "survival");
  expect(scene.ending).toBe("走出烬头村");
  await expect(page.locator(".ending-achievement")).toContainText("成就解锁");
  await expect(page.locator(".ending-achievement")).toContainText(
    scene.ending!,
  );
  await page.screenshot({
    path: `docs/screenshots/flames-ending-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "查看成就", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "结局成就", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".achievement-heading")).toContainText(
    "已解锁 1 / 16",
  );
  await expect(page.locator(".achievement-card.is-unlocked")).toHaveCount(1);
  await expect(page.locator(".achievement-card.is-locked")).toHaveCount(15);
  await expect(page.locator(".achievement-library")).not.toContainText(
    "驱散星火",
  );
  await expect(page.locator(".achievement-library")).not.toContainText(
    "未能挣脱烈火",
  );
  await page.reload();
  await expect(page.locator(".achievement-heading")).toContainText(
    "已解锁 1 / 16",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/screenshots/achievements-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "查看结局", exact: true }).click();
  await expect(page.locator(".ending-achievement")).toContainText("走出烬头村");
  expect(await read(page)).toEqual(scene);
});
test("ritual investment completes from entry to a spell ending", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { scene, sawSpell } = await complete(page, "magic");
  expect(sawSpell).toBeTruthy();
  expect(scene.collection!.endingId).toBe("255");
});
test.describe("dangerous branches", () => {
  test.use({ failNodes: ["110", "133", "65"], firstCombatLoss: true });
  test("bear combat completes a full adventure and explains a successful roll that loses", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { sawCombat, scene } = await complete(page, "combat");
    expect(sawCombat).toBeTruthy();
    expect(scene.ending).toBe("走出烬头村");
  });
  test("discovered map is readable in a complete adventure and retained in inventory", async ({
    page,
  }, info) => {
    test.setTimeout(120000);
    const { sawMap, scene } = await complete(page, "map");
    expect(sawMap).toBeTruthy();
    expect(scene.inventory.some((i) => i.key === "emberhead-map")).toBeTruthy();
    await page.getByRole("button", { name: "查看地图", exact: true }).click();
    await page.screenshot({
      path: `docs/screenshots/flames-map-${info.project.name}.png`,
      fullPage: true,
    });
  });
  test.describe("death outcome", () => {
    test.use({ failNodes: ["65"], firstCombatLoss: false });
    test("failed ritual and escape reach a saved death ending from entry", async ({
      page,
    }) => {
      test.setTimeout(120000);
      const { scene } = await complete(page, "death");
      expect(scene.collection!.endingId).toBe("77");
      await expect(page.locator(".ending-achievement")).toContainText(
        "未能挣脱烈火",
      );
      const unlocked = await page.evaluate(async () =>
        (await fetch("/api/achievements")).json(),
      );
      expect(
        unlocked
          .filter((entry: { unlockedAt?: string }) => entry.unlockedAt)
          .map((entry: { title: string }) => entry.title),
      ).toEqual(["未能挣脱烈火"]);
    });
  });
});
