import { test, expect } from "@playwright/test";
test("create official template character and select it for a run without rerolling", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`chars_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("character-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (await page.locator(".is-reading").count())
    await page.getByRole("button", { name: "返回档案", exact: true }).click();
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "调查员", exact: true }).click();
  await expect(
    page.getByText("此剧本使用空白调查员表，角色由剧情引导创建。"),
  ).toBeVisible();
  await page.getByRole("button", { name: "基于亚历克斯创建" }).click();
  await page.getByLabel("调查员姓名").fill("模板访客");
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await page.getByRole("button", { name: "创建调查员", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const chars = await (await page.request.get("/api/characters")).json();
  expect(chars).toHaveLength(1);
  const actor = chars[0];
  expect(actor.character.templateId).toBe("static-alex");
  expect(actor.character.skills.spotHidden).toBe(35);
  await expect(page.getByRole("heading", { name: "模板访客" })).toBeVisible();
  await expect(page.locator(".character-card")).toContainText("查看全部");
  if (await page.locator(".is-reading").count())
    await page.getByRole("button", { name: "返回档案", exact: true }).click();
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "剧本馆", exact: true }).click();
  await page.getByRole("button", { name: "开始黑潮来信", exact: true }).click();
  await page.getByRole("button", { name: "已有调查员", exact: true }).click();
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await expect(
    page.getByRole("heading", { name: "灯塔不再亮起" }),
  ).toBeVisible();
  const id = new URL(page.url()).hash.split("/").at(-1);
  const scene = await (await page.request.get(`/api/runs/${id}`)).json();
  expect(scene.character).toEqual(actor.character);
  expect(await (await page.request.get("/api/characters")).json()).toHaveLength(
    1,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("lost dice response survives reload and retries without reroll", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`lost_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("password-testing-123");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "开始黑潮来信", exact: true }).click();
  await page.getByLabel("调查员姓名").fill("失联调查员");
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await page.getByRole("button", { name: /沿石阶前往灯塔/ }).click();
  const id = new URL(page.url()).hash.split("/").at(-1);
  await page.route("**/api/runs/*/commands", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: /进行侦查检定/ }).click();
  await expect(
    page.getByRole("button", { name: "重试上次行动" }),
  ).toBeVisible();
  const before = await (await page.request.get(`/api/runs/${id}`)).json();
  expect(before.revision).toBe(2);
  await page.unroute("**/api/runs/*/commands");
  await page.reload();
  await page.getByRole("button", { name: "重试上次行动" }).click();
  await expect(
    page.getByRole("dialog", { name: "命运已经落定" }),
  ).toBeVisible();
  expect(await (await page.request.get(`/api/runs/${id}`)).json()).toEqual(
    before,
  );
  const history = await (
    await page.request.get(`/api/runs/${id}/history`)
  ).json();
  expect(
    history.frames.filter((frame: { check?: unknown }) => frame.check),
  ).toHaveLength(1);
});
test("create investigator, complete a run, refresh, read and replay without changing progress", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "故事，从你开始。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`test_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("password-testing-123");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "开始第零号站台" }).click();
  await page.getByLabel("调查员姓名").fill("夜行者");
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await expect(
    page.getByRole("heading", { name: "没有终点的列车" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /与灰衣乘客交谈/ }).click();
  await expect(
    page.getByRole("heading", { name: "他保留了你的车票" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "他保留了你的车票" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /继续调查/ }).click();
  await page.getByRole("button", { name: /拿着车票走下列车/ }).click();
  await expect(page.getByRole("heading", { name: "归人" })).toBeVisible();
  const hash = new URL(page.url()).hash;
  const id = hash.split("/").at(-1);
  const before = await page.request.get(`/api/runs/${id}`);
  const current = await before.json();
  await page.getByRole("button", { name: /回忆这一局/ }).click();
  await expect(page.getByRole("dialog")).toContainText("明天的旧车票");
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.getByRole("button", { name: "剧情线回放" }).click();
  await page.getByRole("button", { name: "下一段" }).click();
  await expect(page.getByRole("dialog")).toContainText("他保留了你的车票");
  await page.getByRole("button", { name: "关闭窗口" }).click();
  expect(await (await page.request.get(`/api/runs/${id}`)).json()).toEqual(
    current,
  );
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("dice result remains saved after reload and animation skip", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`dice_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("password-testing-123");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "开始黑潮来信", exact: true }).click();
  await page.getByLabel("调查员姓名").fill("雾中人");
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await page.getByRole("button", { name: /沿石阶前往灯塔/ }).click();
  await page.getByRole("button", { name: /进行侦查检定/ }).click();
  await expect(
    page.getByRole("dialog", { name: "命运已经落定" }),
  ).toBeVisible();
  const id = new URL(page.url()).hash.split("/").at(-1);
  const rolled = await (await page.request.get(`/api/runs/${id}`)).json();
  await expect(
    page.getByRole("button", { name: "掷骰", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "继续故事" })).toHaveCount(0);
  await expect(page.locator(".dice-scene canvas")).toHaveCount(0);
  await page.waitForTimeout(300);
  await expect(
    page.getByRole("button", { name: "掷骰", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "掷骰", exact: true }).click();
  await expect(page.locator(".dice-scene canvas")).toBeVisible();
  await expect(page.locator(".dice-tray.is-rolling")).toBeVisible();
  await expect(page.getByRole("button", { name: "正在掷骰…" })).toBeDisabled();
  await page.reload();
  await expect(
    page.getByRole("dialog", { name: "命运已经落定" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "掷骰", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续故事" })).toBeVisible();
  await expect(page.locator(".dice-result")).toContainText(/D100 · 目标 \d+/);
  await expect(page.locator(".dice-tray")).toHaveAttribute(
    "data-renderer",
    "ready",
  );
  await expect(page.locator(".dice-scene canvas")).toBeVisible();
  expect(await (await page.request.get(`/api/runs/${id}`)).json()).toEqual(
    rolled,
  );
  await page.getByRole("button", { name: "继续故事" }).click();
  const before = await (await page.request.get(`/api/runs/${id}`)).json();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: before.title })).toBeVisible();
  expect(await (await page.request.get(`/api/runs/${id}`)).json()).toEqual(
    before,
  );
});

test("player creates luck explicitly, recovers lost result, and rolls nonstandard dice", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`roll_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("player-dice-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let requests = 0,
    saved: { id: string; results: number[]; total: number };
  await page.route("**/api/dice/rolls", async (route) => {
    requests++;
    const response = await route.fetch();
    saved = await response.json();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "开始黑潮来信", exact: true }).click();
  await page.getByLabel("调查员姓名").fill("自己掷骰");
  const confirm = page.getByRole("button", { name: "确认角色，开始调查" });
  await expect(confirm).toBeDisabled();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试本次掷骰" }),
  ).toBeVisible();
  expect(requests).toBe(1);
  await page.unroute("**/api/dice/rolls");
  await page.reload();
  await page.getByRole("button", { name: "开始黑潮来信", exact: true }).click();
  await page.getByLabel("调查员姓名").fill("自己掷骰");
  await expect(page.locator(".roll-equation")).toContainText(
    `幸运 ${saved!.total} × 5 = ${saved!.total * 5}`,
  );
  expect(await page.locator(".poly-die strong").allTextContents()).toEqual(
    saved!.results.map(String),
  );
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(
    page.getByRole("heading", { name: "灯塔不再亮起" }),
  ).toBeVisible();
  const id = new URL(page.url()).hash.split("/").at(-1);
  const scene = await (await page.request.get(`/api/runs/${id}`)).json();
  expect(scene.character.luck).toBe(saved!.total * 5);
  if (await page.locator(".is-reading").count())
    await page.getByRole("button", { name: "返回档案", exact: true }).click();
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "调查员", exact: true }).click();
  await page.getByLabel("骰子面数").fill("37");
  await page.getByLabel("骰子颗数").fill("2");
  await page.getByRole("button", { name: "设置骰子" }).click();
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/dice/rolls") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "掷骰子", exact: true }).click();
  const roll = await (await responsePromise).json();
  await expect(page.locator(".dice-workbench .roll-equation")).toContainText(
    `${roll.results.join(" + ")} = ${roll.total}`,
  );
  expect(
    await page.locator(".dice-workbench .poly-die strong").allTextContents(),
  ).toEqual(roll.results.map(String));
  expect(roll.sides).toBe(37);
  expect(roll.results).toHaveLength(2);
  for (const value of roll.results) {
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(37);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `docs/screenshots/dice-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
