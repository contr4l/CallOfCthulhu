import { test, expect, type Page } from "@playwright/test";
async function register(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`coll_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("collection-testing-password");
  await page.getByLabel("邀请码").fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function nav(page: Page, mobile: boolean, name: string) {
  if (await page.locator(".is-reading").count())
    await page.getByRole("button", { name: "返回档案", exact: true }).click();
  if (mobile) await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("button", { name, exact: true }).click();
}
test("ending and chapter collections open saved text without revealing locked outcomes", async ({
  page,
}, info) => {
  await register(page);
  await page.getByRole("button", { name: "开始第零号站台" }).click();
  await page.getByLabel("调查员姓名").fill("收藏旅人");
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await page.getByRole("button", { name: /与灰衣乘客交谈/ }).click();
  await page.getByRole("button", { name: /继续调查/ }).click();
  await page.getByRole("button", { name: /拿着车票走下列车/ }).click();
  await expect(
    page.getByRole("heading", { name: "归人", exact: true }),
  ).toBeVisible();
  const id = new URL(page.url()).hash.split("/").at(-1),
    before = await (await page.request.get(`/api/runs/${id}`)).json();
  await nav(page, info.project.name === "mobile", "回忆档案");
  const story = page.locator(".collection-story").filter({
    has: page.getByRole("heading", { name: "第零号站台", exact: true }),
  });
  await expect(story).toContainText("1 / 3");
  await expect(story).toContainText("尚有 2 份未知结局");
  await expect(story).not.toContainText("下一位乘客");
  await story.getByRole("button", { name: /归人/ }).click();
  await expect(
    page.getByRole("dialog", { name: "归人", exact: true }),
  ).toContainText(before.text[0]);
  await page.getByRole("button", { name: "关闭窗口" }).click();
  await page.getByRole("button", { name: "章节收集", exact: true }).click();
  await expect(story).toContainText("4 / 8");
  await page.reload();
  await expect(page.getByRole("heading", { name: "故事收集" })).toBeVisible();
  expect(await (await page.request.get(`/api/runs/${id}`)).json()).toEqual(
    before,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `docs/screenshots/collections-${info.project.name}.png`,
    fullPage: true,
  });
});
test("character sheet saves background, displays difficulty values and exports", async ({
  page,
}, info) => {
  await register(page);
  await nav(page, info.project.name === "mobile", "调查员");
  await page.getByRole("button", { name: "基于亚历克斯创建" }).click();
  await page.getByLabel("调查员姓名").fill("纸上调查员");
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await page.getByRole("button", { name: "创建调查员", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "填写角色卡", exact: true }).click();
  await page.getByLabel("年龄", { exact: true }).fill("32");
  await page.getByLabel("出生地", { exact: true }).fill("普罗维登斯");
  await page
    .getByLabel("个人笔记", { exact: true })
    .fill("重要的细节写在这里。");
  await page.getByRole("button", { name: "保存角色资料" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByText("个人资料与笔记", { exact: true }).click();
  await expect(page.locator(".character-profile")).toContainText("普罗维登斯");
  await page.getByRole("button", { name: /查看全部/ }).click();
  const row = page.getByRole("row").filter({
    has: page.getByRole("rowheader", { name: "侦查", exact: true }),
  });
  await expect(row).toContainText("35");
  await expect(row).toContainText("17");
  await expect(row).toContainText("7");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出角色卡" }).click();
  expect((await download).suggestedFilename()).toBe("investigator.json");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: `docs/screenshots/character-sheet-${info.project.name}.png`,
    fullPage: true,
  });
});
