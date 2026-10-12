import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../apps/api/src/app.js";
const headers = { "x-requested-with": "cthulhu-web" };
const credentials = {
  username: "邀请码玩家",
  password: "invitation-test-password",
};
async function appWithInvite(value?: string) {
  const previous = process.env.REGISTRATION_INVITE_CODE;
  if (value === undefined) delete process.env.REGISTRATION_INVITE_CODE;
  else process.env.REGISTRATION_INVITE_CODE = value;
  try {
    return await buildApp();
  } finally {
    if (previous === undefined) delete process.env.REGISTRATION_INVITE_CODE;
    else process.env.REGISTRATION_INVITE_CODE = previous;
  }
}
test("registration rejects missing, blank, and incorrect invitations without creating accounts or sessions", async () => {
  const app = await appWithInvite();
  try {
    for (const inviteCode of [
      undefined,
      "",
      "   ",
      "incorrect",
      "FA6IAN-TEST",
    ]) {
      const rejected = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers,
        payload: {
          ...credentials,
          ...(inviteCode === undefined ? {} : { inviteCode }),
        },
      });
      assert.equal(rejected.statusCode, 403, rejected.body);
      assert.equal(rejected.json().message, "邀请码无效，请检查后重试。");
      assert.equal(rejected.cookies.length, 0);
    }
    const success = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: { ...credentials, inviteCode: " fa6ian-test " },
    });
    assert.equal(success.statusCode, 200, success.body);
    assert.ok(success.cookies.some((c) => c.name === "session"));
    assert.equal(success.json().username, credentials.username);
    assert.ok(!success.body.includes("invite"));
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers,
      payload: credentials,
    });
    assert.equal(login.statusCode, 200, login.body);
  } finally {
    await app.close();
  }
});
test("backend invitation configuration replaces the default code", async () => {
  const app = await appWithInvite("custom-invitation");
  try {
    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: { ...credentials, inviteCode: "fa6ian-test" },
    });
    assert.equal(rejected.statusCode, 403);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: { ...credentials, inviteCode: "custom-invitation" },
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
  } finally {
    await app.close();
  }
});
