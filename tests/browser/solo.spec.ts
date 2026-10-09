import { test, expect, type Page } from "@playwright/test";
async function register(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`solo_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("solo-testing-password");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("Flames builds attributes in story, validates allocation and resumes after reload", async ({
  page,
}) => {
  await register(page);
  await page
    .getByRole("button", { name: "开始Alone Against the Flames", exact: true })
    .click();
  await page.getByLabel("调查员姓名").fill("新旅人");
  await expect(
    page.getByRole("button", { name: "掷幸运骰", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Alone Against the Flames · 1",
      exact: true,
    }),
  ).toBeVisible();
  const id = new URL(page.url()).hash.split("/").at(-1);
  const read = async () => (await page.request.get(`/api/runs/${id}`)).json();
  const first = await read();
  await page
    .getByRole("button", {
      name: first.actions.find((a: { id: string }) => a.id === "to-263").label,
      exact: false,
    })
    .click();
  await expect(page.locator(".rule-input")).toBeVisible();
  await page.getByLabel("点值 1", { exact: true }).selectOption("80");
  await page.locator(".rule-input button").click();
  await expect(page.getByText("请将指定的八个属性值各使用一次")).toBeVisible();
  await page.getByLabel("点值 1", { exact: true }).selectOption("40");
  await page.locator(".rule-input button").click();
  await expect(page.locator(".rule-input")).toHaveCount(0);
  const saved = await read();
  expect(saved.character.attributes.str).toBe(40);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: saved.title, exact: true }),
  ).toBeVisible();
  expect(await read()).toEqual(saved);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
test("Static restricts roles and shows persisted source record choices", async ({
  page,
}) => {
  await register(page);
  await page.getByRole("button", { name: "开始静躁独行", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "自定义技能", exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("调查员姓名").fill("湖边访客");
  await page.getByRole("button", { name: "掷幸运骰", exact: true }).click();
  await page.getByRole("button", { name: "确认角色，开始调查" }).click();
  await expect(
    page.getByRole("heading", { name: "静躁独行 · 0", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
});
