import { test, expect } from "@playwright/test";
test("registration submits invitation to backend, shows rejection, and accepts valid code", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /登录档案室/ }).click();
  await expect(page.getByLabel("邀请码")).toHaveCount(0);
  await page.getByRole("button", { name: "第一次来？创建账号" }).click();
  await page
    .getByLabel("用户名")
    .fill(`invite_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`);
  await page.getByLabel("密码").fill("invitation-browser-password");
  const invitation = page.getByLabel("邀请码");
  await expect(invitation).toHaveValue("");
  await expect(invitation).toHaveAttribute("required", "");
  await invitation.fill("wrong-invitation");
  const rejected = page.waitForResponse((r) =>
    r.url().endsWith("/api/auth/register"),
  );
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  expect((await rejected).status()).toBe(403);
  await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
    "邀请码无效，请检查后重试。",
  );
  expect((await page.request.get("/api/me")).status()).toBe(401);
  await invitation.fill("fa6ian-test");
  await page.getByRole("button", { name: "创建账号", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await page.request.get("/api/me")).status()).toBe(200);
});
