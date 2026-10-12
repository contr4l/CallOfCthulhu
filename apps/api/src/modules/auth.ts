import type { FastifyInstance, FastifyReply } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import type { User } from "../../../../packages/contracts/index.js";
import { GameError } from "../../../../packages/engine/index.js";
import { transaction } from "../storage/database.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const derive = promisify(scrypt);
const credentials = z
  .object({
    username: z
      .string()
      .trim()
      .min(2)
      .max(32)
      .regex(/^[\p{L}\p{N}_-]+$/u),
    password: z.string().min(8).max(128),
  })
  .strict();

const registration = credentials.extend({
  inviteCode: z.string().trim().max(128).optional(),
});

export function registerAuth(
  app: FastifyInstance,
  db: DatabaseSync,
  inviteCode = process.env.REGISTRATION_INVITE_CODE?.trim() || "fa6ian-test",
) {
  const inviteDigest = createHash("sha256").update(inviteCode.trim()).digest();
  function user(request: {
    cookies: Record<string, string | undefined>;
  }): User {
    const token = request.cookies.session;
    if (!token) throw new GameError(401, "请先登录。");
    const row = db
      .prepare(
        "SELECT users.id,users.username FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?",
      )
      .get(hash(token), Date.now()) as unknown as User | undefined;
    if (!row) throw new GameError(401, "登录已过期，请重新登录。");
    return row;
  }
  function session(reply: FastifyReply, id: string, oldToken?: string) {
    const token = randomBytes(32).toString("hex");
    transaction(db, () => {
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
      if (oldToken)
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
          hash(oldToken),
        );
      db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
        hash(token),
        id,
        Date.now() + 30 * 86400_000,
      );
    });
    reply.setCookie("session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 30 * 86400,
    });
  }
  app.get("/api/me", async (request) => user(request));
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const data = registration.parse(request.body);
      const suppliedInvite = createHash("sha256")
        .update(data.inviteCode ?? "")
        .digest();
      if (!timingSafeEqual(suppliedInvite, inviteDigest))
        throw new GameError(403, "邀请码无效，请检查后重试。");
      const salt = randomBytes(16).toString("hex");
      const key = (await derive(data.password, salt, 64)) as Buffer;
      const id = randomUUID();
      try {
        db.prepare("INSERT INTO users VALUES(?,?,?)").run(
          id,
          data.username,
          `${salt}:${key.toString("hex")}`,
        );
      } catch (e) {
        if (
          db.prepare("SELECT id FROM users WHERE username=?").get(data.username)
        )
          throw new GameError(409, "这个用户名已经有人使用。");
        throw e;
      }
      session(reply, id, request.cookies.session);
      return { id, username: data.username };
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const data = credentials.parse(request.body);
      const row = db
        .prepare("SELECT * FROM users WHERE username=?")
        .get(data.username) as
        { id: string; username: string; password_hash: string } | undefined;
      const [salt, stored] = (
        row?.password_hash ?? `${"0".repeat(32)}:${"0".repeat(128)}`
      ).split(":");
      const key = (await derive(data.password, salt, 64)) as Buffer;
      if (!row || !timingSafeEqual(key, Buffer.from(stored, "hex")))
        throw new GameError(401, "用户名或密码不正确。");
      session(reply, row.id, request.cookies.session);
      return { id: row.id, username: row.username };
    },
  );
  app.post("/api/auth/logout", async (request, reply) => {
    if (request.cookies.session)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        hash(request.cookies.session),
      );
    reply.clearCookie("session", { path: "/" });
    return { ok: true };
  });

  return user;
}
