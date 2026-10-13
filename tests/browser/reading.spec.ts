import { test, expect } from "@playwright/test";
test("reader themes persist, the story hides outer chrome and both page-scroll modes work", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await page.getByRole("button", { name: "选择配色" }).click();
  await expect(page.locator(".theme-option")).toHaveCount(4);
  await expect(page.getByLabel("新剧情回到正文开头")).toBeChecked();
  for (const [id, name] of [
    ["bloodmoon", "血月"],
    ["abyss", "深渊"],
    ["nightmare", "梦魇"],
    ["sepia", "旧日手稿"],
  ]) {
    await page
      .locator(".theme-option")
      .filter({ has: page.getByText(name, { exact: true }) })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
  }
  await page
    .locator(".theme-option")
    .filter({ has: page.getByText("深渊", { exact: true }) })
    .click();
  await page.getByRole("button", { name: "返回阅读" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "abyss");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`read_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("reader-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "开始向火独行", exact: true }).click();
  await page.getByLabel("调查员姓名").fill("夜读者");
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await expect(
    page.getByRole("heading", { name: "向火独行", level: 1, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".sidebar,.topbar,.play-heading")).toHaveCount(0);
  await expect(page.locator(".play-page")).not.toContainText(
    /原书条目|第\s*\d+\s*段经历/,
  );
  await expect(page.locator(".character-card")).not.toContainText(/困难|极难/);
  expect(
    await page
      .locator(".narrative-text>p")
      .first()
      .evaluate((n) => parseFloat(getComputedStyle(n).fontSize)),
  ).toBeGreaterThanOrEqual(19);
  for (const [id, name] of [
    ["bloodmoon", "血月"],
    ["abyss", "深渊"],
    ["nightmare", "梦魇"],
    ["sepia", "旧日手稿"],
  ]) {
    const position = await page.evaluate(() => scrollY);
    await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
    await page
      .locator(".theme-option")
      .filter({ has: page.getByText(name, { exact: true }) })
      .click();
    await page.getByRole("button", { name: "返回阅读" }).click();
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(position, 0);
    await page.screenshot({
      path: `docs/screenshots/reader-${id}-${info.project.name}.png`,
      fullPage: true,
    });
  }
  const id = new URL(page.url()).hash.split("/").at(-1);
  const read = async () => (await page.request.get(`/api/runs/${id}`)).json();
  const original = await read();
  await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
  const size = page.getByLabel("正文字号");
  await size.press("End");
  for (let i = 0; i < 4; i++) await size.press("ArrowLeft");
  await expect(size).toHaveValue("28");
  await page.getByLabel("正文字体").selectOption("kai");
  await page.getByLabel("正文语言").selectOption("en");
  await page.getByRole("button", { name: "返回阅读" }).click();
  await expect(page.locator(".narrative h1")).toHaveText(
    "Alone Against the Flames",
  );
  await expect(page.locator(".narrative-text")).toContainText(
    "The sun is high in the sky",
  );
  await expect(page.locator(".narrative-text>p").first()).toHaveCSS(
    "font-size",
    "28px",
  );
  expect(
    await page
      .locator(".narrative-text")
      .evaluate((n) => getComputedStyle(n).fontFamily),
  ).toContain("LXGW WenKai");
  const fonts = await page.evaluate(async () =>
    (await document.fonts.load('28px "LXGW WenKai"', "夜风The")).map(
      (f) => f.status,
    ),
  );
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every((status) => status === "loaded")).toBeTruthy();
  await page.reload();
  await expect(page.locator(".narrative-text")).toContainText(
    "The sun is high in the sky",
  );
  expect(await read()).toEqual(original);
  await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
  await expect(page.getByLabel("正文字体")).toHaveValue("kai");
  await expect(page.getByLabel("正文字号")).toHaveValue("28");
  await page.getByLabel("正文语言").selectOption("zh");
  await page.getByLabel("中文字形").selectOption("traditional");
  await page.getByRole("button", { name: "返回阅读" }).click();
  await expect(page.locator(".narrative-text")).toContainText("太陽");
  await expect(page.locator(".narrative h1")).toHaveText("向火獨行");
  await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
  await page.getByLabel("中文字形").selectOption("simplified");
  await page.getByLabel("正文字体").selectOption("song");
  await page.getByLabel("正文字号").press("Home");
  for (let i = 0; i < 6; i++)
    await page.getByLabel("正文字号").press("ArrowRight");
  await page.getByLabel("文字出现动画").selectOption("typewriter");
  await page.getByLabel("打字速度").press("Home");
  await page.getByRole("button", { name: "返回阅读" }).click();
  await expect(page.locator(".narrative-text")).toHaveAttribute(
    "data-animation",
    "typewriter",
  );
  await expect(page.locator(".narrative-text")).toHaveAttribute(
    "data-complete",
    "false",
  );
  await expect
    .poll(() =>
      page
        .locator(".revealed-copy")
        .evaluateAll(
          (nodes) => nodes.map((n) => n.textContent).join("").length,
        ),
    )
    .toBeGreaterThan(0);
  const slow = await page
    .locator(".revealed-copy")
    .evaluateAll((nodes) => nodes.map((n) => n.textContent).join("").length);
  await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
  await page.getByLabel("打字速度").press("End");
  await page.getByRole("button", { name: "返回阅读" }).click();
  await expect
    .poll(() =>
      page
        .locator(".revealed-copy")
        .evaluateAll(
          (nodes) => nodes.map((n) => n.textContent).join("").length,
        ),
    )
    .toBeGreaterThan(slow);
  await page.getByRole("button", { name: "显示全文", exact: true }).click();
  await expect(page.locator(".narrative-text")).toHaveAttribute(
    "data-complete",
    "true",
  );
  await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
  await page.getByLabel("文字出现动画").selectOption("paragraph");
  await page.getByLabel("段落间隔").press("End");
  await page.getByRole("button", { name: "返回阅读" }).click();
  await expect(page.locator(".narrative-text")).toHaveAttribute(
    "data-animation",
    "paragraph",
  );
  await expect(page.locator(".narrative-text>p").nth(1)).toHaveCSS(
    "opacity",
    "0",
  );
  await page.getByRole("button", { name: "显示全文", exact: true }).click();
  await expect(page.locator(".narrative-text>p").nth(1)).toHaveCSS(
    "opacity",
    "1",
  );
  expect(await read()).toEqual(original);
  await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
  await page.getByLabel("文字出现动画").selectOption("none");
  await page.getByLabel("保留当前位置").check();
  await page.getByRole("button", { name: "返回阅读" }).click();
  await page.locator(".choices button").first().scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  expect(before).toBeGreaterThan(50);
  await page.locator(".choices button").first().click();
  await expect(page.locator(".play-page")).toHaveAttribute(
    "data-revision",
    "1",
  );
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  await page.locator(".rule-input button").click();
  await expect(page.locator(".play-page")).toHaveAttribute(
    "data-revision",
    "2",
  );
  await page.getByRole("button", { name: "阅读偏好", exact: true }).click();
  await page.getByLabel("新剧情回到正文开头").check();
  await page.getByRole("button", { name: "返回阅读" }).click();
  await page.locator(".choices button").first().click();
  await expect(page.locator(".play-page")).toHaveAttribute(
    "data-revision",
    "3",
  );
  const top = await page
    .locator(".narrative h1")
    .evaluate((n) => n.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(55);
  expect(top).toBeLessThanOrEqual(125);
  await page
    .getByRole("button", { name: "查看全部 50 项技能", exact: true })
    .click();
  await expect(page.locator(".character-card")).not.toContainText(/困难|极难/);
  await expect(page.locator(".character-card thead th")).toHaveText([
    "技能",
    "当前",
  ]);
  await page.getByRole("button", { name: "回忆这一局", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toContainText(
    /原书条目|第\s*\d+\s*段经历|向火独行\s*·\s*\d+/,
  );
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.getByRole("button", { name: "返回档案", exact: true }).click();
  await expect(page.locator(".topbar")).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name: "剧本馆", exact: true }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
