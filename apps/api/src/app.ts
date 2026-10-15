import { SHOP_RULES_VERSION } from "../../../packages/contracts/shop.js";
import {
  consumeItem,
  readShop,
  purchase,
  hasStaticAccess,
  unlockStatic,
} from "./modules/shop.js";
import { readAchievements } from "./modules/achievements.js";
import { readCollections } from "./modules/collections.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
import { z } from "zod";
import type {
  Command,
  CommandResponse,
  HistoryFrame,
  RunState,
  Story,
  Character,
} from "../../../packages/contracts/index.js";
import {
  advance,
  ENGINE_VERSION,
  GameError,
  getNode,
  initialState,
  project,
  withSceneReading,
} from "../../../packages/engine/index.js";
import {
  createCharacter,
  createCharacterFromTemplate,
  type DiceSource,
} from "../../../packages/rules/index.js";
import { loadStories, publicStory } from "./catalog.js";
import { registerAuth } from "./modules/auth.js";
import {
  rollSchema,
  rollDice,
  creationRoll,
  saveCreation,
} from "./modules/dice.js";
import { loadCharacterTemplates } from "./modules/character-templates.js";
import { openDatabase, transaction } from "./storage/database.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const commandSchema = z
  .object({
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    actionId: z.string().min(1).max(80),
    shopItem: z.literal("target-plus-10").optional(),
    input: z
      .record(
        z.string().max(80),
        z.union([z.number().finite(), z.string().max(4000)]),
      )
      .optional(),
  })
  .strict();
const creation = z
  .object({
    storyId: z.string(),
    presetId: z.string().optional(),
    name: z.string().trim().min(1).max(24),
    age: z.number().int().min(23).max(36).optional(),
    characterId: z.string().uuid().optional(),
    luckRollId: z.string().uuid().optional(),
    skills: z
      .object({
        spotHidden: z.number().int().min(20).max(75),
        listen: z.number().int().min(20).max(75),
        persuade: z.number().int().min(20).max(75),
        stealth: z.number().int().min(20).max(75),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((data) => !!(data.presetId || data.characterId), {
    message: "请选择预设或已有调查员",
  })
  .refine((data) => !(data.characterId && data.skills), {
    message: "已有角色不能同时提交自定义技能",
  });
type RunRow = {
  id: string;
  user_id: string;
  story_id: string;
  story_version: string;
  rules_version: string;
  engine_version: string;
  revision: number;
  state: string;
  updated_at: string;
};
export async function buildApp(
  options: {
    databasePath?: string;
    storyRoot?: string;
    charsRoot?: string;
    dice?: DiceSource;
    serveStatic?: boolean;
    rateLimitMax?: number;
  } = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 32_768 });
  const db = openDatabase(options.databasePath ?? ":memory:");
  const characterCatalog = loadCharacterTemplates(
    options.charsRoot ?? resolve(projectRoot, "chars"),
  );
  const stories = loadStories(
    options.storyRoot ?? resolve(projectRoot, "stories"),
  );
  const latest = new Map<string, Story>();
  for (const s of stories.values())
    if (
      !latest.has(s.id) ||
      s.version.localeCompare(latest.get(s.id)!.version, undefined, {
        numeric: true,
      }) > 0
    )
      latest.set(s.id, s);
  await app.register(cookie);
  await app.register(rateLimit, {
    max: z
      .number()
      .int()
      .positive()
      .parse(options.rateLimitMax ?? 300),
    timeWindow: "1 minute",
    allowList: (request) => !request.url.startsWith("/api/"),
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `操作较频繁，请在 ${Math.ceil(context.ttl / 1000)} 秒后重试。`,
    }),
  });
  app.addHook("onClose", async () => {
    db.close();
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ message: "输入不符合要求，请检查填写内容。" });
    const e = error as { statusCode?: number };
    const code = e.statusCode ?? 500;
    return reply.code(code).send({
      message:
        code < 500
          ? error instanceof Error
            ? error.message
            : "请求无效。"
          : "暂时无法完成操作，请稍后重试。",
    });
  });
  app.addHook("onRequest", async (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    if (request.headers["x-requested-with"] !== "cthulhu-web")
      throw new GameError(403, "请求来源无效。");
    const origin = request.headers.origin;
    const allowed = new Set([
      `http://${request.headers.host}`,
      `https://${request.headers.host}`,
      ...(
        process.env.APP_ORIGINS ?? "http://localhost:5175,http://127.0.0.1:5175"
      ).split(","),
    ]);
    if (origin && !allowed.has(origin))
      throw new GameError(403, "请求来源无效。");
    if (!request.headers["content-type"]?.startsWith("application/json"))
      throw new GameError(415, "请使用 JSON 请求。");
  });
  const user = registerAuth(app, db);
  function getRun(id: string, owner: string): RunRow {
    const row = db
      .prepare("SELECT * FROM runs WHERE id=? AND user_id=?")
      .get(id, owner) as unknown as RunRow | undefined;
    if (!row) throw new GameError(404, "找不到这局游戏。");
    return row;
  }
  function storyFor(row: RunRow) {
    const story = stories.get(`${row.story_id}@${row.story_version}`);
    if (
      !story ||
      row.rules_version !== story.rulesVersion ||
      row.engine_version !== ENGINE_VERSION
    )
      throw new GameError(503, "本局需要的内容或规则版本暂不可用。");
    return story;
  }
  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/stories", async () => [...latest.values()].map(publicStory));
  app.get<{ Params: { id: string } }>("/api/stories/:id", async (request) => {
    const s = latest.get(request.params.id);
    if (!s) throw new GameError(404, "剧本不存在。");
    return publicStory(s);
  });
  app.post("/api/dice/rolls", async (request) => {
    const owner = user(request),
      data = rollSchema.parse(request.body);
    return transaction(db, () => rollDice(db, owner.id, data, options.dice));
  });
  app.get<{ Params: { id: string } }>(
    "/api/dice/rolls/:id",
    async (request) => {
      const owner = user(request);
      const row = db
        .prepare("SELECT payload FROM dice_rolls WHERE id=? AND user_id=?")
        .get(request.params.id, owner.id);
      if (!row) throw new GameError(404, "骰子记录不存在。");
      return JSON.parse(row.payload as string);
    },
  );
  app.get("/api/characters", async (request) => {
    const owner = user(request);
    return db
      .prepare(
        "SELECT id,character FROM character_templates WHERE user_id=? ORDER BY created_at DESC",
      )
      .all(owner.id)
      .map((r) => ({ id: r.id, character: JSON.parse(r.character as string) }));
  });
  app.get("/api/achievements", async (request) =>
    readAchievements(db, user(request).id, stories),
  );
  app.get("/api/shop", async (request) =>
    readShop(db, user(request).id, stories),
  );
  app.post("/api/shop/unlocks", async (request) => {
    const owner = user(request);
    const data = z
      .object({
        requestId: z.string().uuid(),
        storyId: z.literal("alone-against-static"),
      })
      .strict()
      .parse(request.body);
    return transaction(db, () =>
      unlockStatic(db, owner.id, data.requestId, stories),
    );
  });
  app.post("/api/shop/purchases", async (request) => {
    const owner = user(request);
    const data = z
      .object({
        requestId: z.string().uuid(),
        itemId: z.enum(["reroll", "target-plus-10"]),
      })
      .strict()
      .parse(request.body);
    return transaction(db, () =>
      purchase(db, owner.id, data.requestId, data.itemId, stories),
    );
  });
  app.post<{ Params: { id: string } }>(
    "/api/achievements/:id/claim",
    async (request) => {
      const owner = user(request);
      z.object({}).strict().parse(request.body);
      return transaction(db, () => {
        const entry = readAchievements(db, owner.id, stories).find(
          (entry) => entry.id === request.params.id,
        );
        if (!entry?.unlockedAt || !entry.rewardPoints)
          throw new GameError(409, "尚未解锁或尚未确认这个结局。");
        const claim = db
          .prepare("INSERT OR IGNORE INTO achievement_claims VALUES(?,?,?,?)")
          .run(
            owner.id,
            entry.id,
            entry.rewardPoints,
            new Date().toISOString(),
          );
        if (claim.changes === 1)
          db.prepare(
            "INSERT INTO shop_wallets VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET balance=balance+excluded.balance",
          ).run(owner.id, entry.rewardPoints);
        return readShop(db, owner.id, stories);
      });
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/runs/:id/check-window",
    async (request) => {
      const r = getRun(request.params.id, user(request).id);
      const window = db
        .prepare(
          "SELECT * FROM shop_check_windows WHERE run_id=? AND revision=?",
        )
        .get(r.id, r.revision);
      if (!window) return null;
      const frame = JSON.parse(
        db
          .prepare(
            "SELECT frame FROM run_history WHERE run_id=? AND sequence=?",
          )
          .get(r.id, r.revision)!.frame as string,
      ) as HistoryFrame;
      return {
        before: project(
          storyFor(r),
          JSON.parse(window.before_state as string),
          r.id,
          Number(window.before_revision),
        ),
        scene: project(storyFor(r), JSON.parse(r.state), r.id, r.revision),
        check: frame.check,
        action: frame.action,
      };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/check-window/close",
    async (request) => {
      const owner = user(request);
      const data = z
        .object({ expectedRevision: z.number().int().nonnegative() })
        .strict()
        .parse(request.body);
      return transaction(db, () => {
        const r = getRun(request.params.id, owner.id);
        if (r.revision !== data.expectedRevision)
          throw new GameError(409, "检定结果已更新，请重新读取。");
        db.prepare("DELETE FROM shop_check_windows WHERE run_id=?").run(r.id);
        return { ok: true };
      });
    },
  );
  app.get(
    "/api/collections",
    async (request) =>
      readCollections(db, user(request).id, stories).collections,
  );
  app.get<{
    Querystring: {
      storyId: string;
      kind: "chapters" | "endings";
      id: string;
    };
  }>("/api/collections/entry", async (request) => {
    const q = z
      .object({
        storyId: z.string().max(100),
        kind: z.enum(["chapters", "endings"]),
        id: z.string().max(100),
      })
      .strict()
      .parse(request.query);
    return readCollections(db, user(request).id, stories).entry(
      q.storyId,
      q.kind,
      q.id,
    );
  });
  app.patch<{ Params: { id: string } }>(
    "/api/characters/:id",
    async (request) => {
      const owner = user(request);
      const text = z.string().trim().max(400);
      const data = z
        .object({
          name: z.string().trim().min(1).max(24),
          profile: z
            .object({
              age: z.number().int().min(1).max(120).optional(),
              pronouns: text.optional(),
              birthplace: text.optional(),
              residence: text.optional(),
              appearance: text.optional(),
              ideology: text.optional(),
              importantPeople: text.optional(),
              meaningfulPlaces: text.optional(),
              treasuredPossessions: text.optional(),
              notes: z.string().trim().max(2000).optional(),
            })
            .strict(),
        })
        .strict()
        .parse(request.body);
      return transaction(db, () => {
        const row = db
          .prepare(
            "SELECT character FROM character_templates WHERE id=? AND user_id=?",
          )
          .get(request.params.id, owner.id);
        if (!row) throw new GameError(404, "找不到这位调查员。");
        const character = {
          ...JSON.parse(row.character as string),
          name: data.name,
          profile: data.profile,
        };
        db.prepare(
          "UPDATE character_templates SET character=? WHERE id=? AND user_id=?",
        ).run(JSON.stringify(character), request.params.id, owner.id);
        // Preserve historical frames and each run's independent game values.
        for (const run of db
          .prepare("SELECT id,state FROM runs WHERE user_id=?")
          .all(owner.id)) {
          const state = JSON.parse(run.state as string) as RunState;
          if (
            (state.savedCharacterId ?? state.createdCharacterId) !==
            request.params.id
          )
            continue;
          state.savedCharacterId = request.params.id;
          state.character.name = data.name;
          db.prepare("UPDATE runs SET state=? WHERE id=? AND user_id=?").run(
            JSON.stringify(state),
            run.id,
            owner.id,
          );
          const pending = db
            .prepare(
              "SELECT before_state FROM shop_check_windows WHERE run_id=?",
            )
            .get(run.id);
          if (pending) {
            const before = JSON.parse(
              pending.before_state as string,
            ) as RunState;
            before.savedCharacterId = request.params.id;
            before.character.name = data.name;
            db.prepare(
              "UPDATE shop_check_windows SET before_state=? WHERE run_id=?",
            ).run(JSON.stringify(before), run.id);
          }
        }
        return { id: request.params.id, character };
      });
    },
  );
  app.get("/api/character-templates", async () => characterCatalog);
  app.post("/api/characters", async (request, reply) => {
    const owner = user(request);
    const data = z
      .object({
        templateId: z.string(),
        luckRollId: z.string().uuid(),
        name: z.string().trim().min(1).max(24).optional(),
      })
      .strict()
      .parse(request.body);
    const template = characterCatalog.templates.find(
      (t) => t.id === data.templateId,
    );
    if (!template) throw new GameError(404, "角色模板不存在。");
    const requestHash = hash(JSON.stringify({ route: "characters", ...data }));
    const saved = transaction(db, () => {
      const roll = creationRoll(db, owner.id, data.luckRollId, requestHash);
      if (roll.replay) return roll.replay;
      const id = randomUUID(),
        character = createCharacterFromTemplate(
          data.name ?? template.defaultName,
          template,
          roll.luck,
        );
      db.prepare("INSERT INTO character_templates VALUES(?,?,?,?)").run(
        id,
        owner.id,
        JSON.stringify(character),
        new Date().toISOString(),
      );
      const response = { id, character };
      saveCreation(db, data.luckRollId, requestHash, response);
      return response;
    });
    return reply.code(201).send(saved);
  });
  app.get("/api/runs", async (request) => {
    const owner = user(request);
    return (
      db
        .prepare("SELECT * FROM runs WHERE user_id=? ORDER BY updated_at DESC")
        .all(owner.id) as unknown as RunRow[]
    )
      .filter((r) => stories.has(`${r.story_id}@${r.story_version}`))
      .map((r) => {
        const s = storyFor(r),
          state = JSON.parse(r.state) as RunState;
        return {
          id: r.id,
          storyId: s.id,
          storyTitle: s.title,
          cover: s.cover,
          characterName: state.character.name,
          status: state.status,
          updatedAt: r.updated_at,
          revision: r.revision,
          chapter: getNode(s, state.nodeId).chapter,
        };
      });
  });
  app.post("/api/runs", async (request, reply) => {
    const owner = user(request),
      data = creation.parse(request.body),
      story = latest.get(data.storyId);
    if (!story) throw new GameError(404, "剧本不存在。");
    if (story.id === "alone-against-static" && !hasStaticAccess(db, owner.id))
      throw new GameError(
        403,
        "请先完成《向火独行》的三个不同结局，并在商店解锁《静躁独行》。",
      );
    if (
      story.creationPolicy !== "guided" &&
      (data.characterId ? !!data.luckRollId : !data.luckRollId)
    )
      throw new GameError(400, "新角色须先掷幸运骰；已有角色保留幸运。");
    if (story.creationPolicy === "guided" && data.luckRollId)
      throw new GameError(400, "幸运将在剧情中掷出。");
    const preset = story.presets.find((p) => p.id === data.presetId);
    if (!preset && !data.characterId)
      throw new GameError(400, "角色模板不存在。");
    if (story.creationPolicy && data.skills)
      throw new GameError(400, "本模组使用专属建卡流程。");
    if (story.creationPolicy === "guided" && data.characterId)
      throw new GameError(400, "本模组需要从剧情开始建卡。");
    if (
      data.skills &&
      Object.values(data.skills).reduce((a, b) => a + b, 0) !== 200
    )
      throw new GameError(400, "自定义技能点合计必须为 200。");
    const id = randomUUID(),
      now = new Date().toISOString();
    const requestHash = hash(JSON.stringify({ route: "runs", ...data }));
    const scene = transaction(db, () => {
      const roll = data.luckRollId
        ? creationRoll(db, owner.id, data.luckRollId, requestHash)
        : undefined;
      if (roll?.replay) return roll.replay;
      let character: Character;
      if (data.characterId) {
        const saved = db
          .prepare(
            "SELECT character FROM character_templates WHERE id=? AND user_id=?",
          )
          .get(data.characterId, owner.id);
        if (!saved) throw new GameError(404, "找不到这位调查员。");
        character = JSON.parse(saved.character as string);
        character.name = data.name;
        if (
          story.creationPolicy === "fixed" &&
          !story.presets.some((p) => p.templateId === character.templateId)
        )
          throw new GameError(400, "请选择本模组支持的预设调查员。");
        for (const node of story.nodes) {
          if (
            node.check &&
            !["sanity", "luck"].includes(node.check.skill) &&
            character.skills[node.check.skill] === undefined &&
            character.attributes?.[node.check.skill] === undefined
          )
            throw new GameError(400, "这位调查员缺少剧本要求的技能。");
        }
      } else
        character = createCharacter(
          data.name,
          {
            ...preset!,
            ...(data.skills
              ? { occupation: "独立调查员", skills: data.skills }
              : {}),
          },
          roll?.luck ?? 0,
        );
      if (story.rulesVersion === "aaf-solo@1")
        character.rulesVersion = story.rulesVersion;
      if (data.age !== undefined) {
        if (story.creationPolicy !== "guided")
          throw new GameError(400, "本剧本使用模板的角色资料。");
        character.profile = { ...character.profile, age: data.age };
      }
      const savedCharacterId = data.characterId ?? randomUUID();
      const state = initialState(story, character, options.dice),
        view = project(story, state, id, 0);
      state.savedCharacterId = savedCharacterId;
      if (!data.characterId) state.createdCharacterId = savedCharacterId;
      db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)").run(
        id,
        owner.id,
        story.id,
        story.version,
        story.rulesVersion,
        ENGINE_VERSION,
        0,
        JSON.stringify(state),
        now,
        now,
      );
      if (!data.characterId)
        db.prepare("INSERT INTO character_templates VALUES(?,?,?,?)").run(
          savedCharacterId,
          owner.id,
          JSON.stringify(story.fear ? state.character : character),
          now,
        );
      const frame: HistoryFrame = {
        sequence: 0,
        createdAt: now,
        scene: view,
        ...(state.creationDice ? { dice: state.creationDice } : {}),
        memory: getNode(story, state.nodeId).memory,
      };
      db.prepare("INSERT INTO run_history VALUES(?,?,?)").run(
        id,
        0,
        JSON.stringify(frame),
      );
      db.prepare("INSERT INTO run_events VALUES(?,?,?)").run(
        id,
        0,
        JSON.stringify({ type: "started", visitId: state.visitId, character }),
      );
      if (data.luckRollId) saveCreation(db, data.luckRollId, requestHash, view);
      return view;
    });
    return reply.code(201).send(scene);
  });
  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request) => {
    const r = getRun(request.params.id, user(request).id);
    return project(storyFor(r), JSON.parse(r.state), r.id, r.revision);
  });
  app.post<{ Params: { id: string } }>(
    "/api/runs/:id/commands",
    async (request) => {
      const owner = user(request),
        data = commandSchema.parse(request.body) as Command;
      return transaction(db, () => {
        const r = getRun(request.params.id, owner.id),
          digest = hash(
            JSON.stringify({
              expectedRevision: data.expectedRevision,
              actionId: data.actionId,
              ...(data.shopItem ? { shopItem: data.shopItem } : {}),
              ...(data.input
                ? {
                    input: Object.fromEntries(
                      Object.entries(data.input).sort(([a], [b]) =>
                        a.localeCompare(b),
                      ),
                    ),
                  }
                : {}),
            }),
          );
        const cached = db
          .prepare(
            "SELECT request_hash,response FROM run_commands WHERE run_id=? AND command_id=?",
          )
          .get(r.id, data.commandId);
        if (cached) {
          if (cached.request_hash !== digest)
            throw new GameError(409, "重复请求的内容不一致。");
          return JSON.parse(cached.response as string) as CommandResponse;
        }
        if (r.revision !== data.expectedRevision)
          throw new GameError(409, "进度已经更新，已为你恢复最新剧情。");
        const story = storyFor(r);
        let before = JSON.parse(r.state) as RunState;
        let beforeRevision = r.revision;
        let actionId = data.actionId;
        let input = data.input;
        let targetBonus = 0;
        let previousRoll: number | undefined;
        const retry = actionId === "shop-reroll";
        if (retry) {
          if (data.shopItem || data.input)
            throw new GameError(400, "重掷请求不能指定检定参数。");
          const window = db
            .prepare(
              "SELECT * FROM shop_check_windows WHERE run_id=? AND revision=?",
            )
            .get(r.id, r.revision);
          if (!window)
            throw new GameError(409, "这次检定已经确认或不支持重掷。");
          consumeItem(db, owner.id, "reroll");
          before = JSON.parse(window.before_state as string);
          beforeRevision = Number(window.before_revision);
          actionId = window.action_id as string;
          input = window.input ? JSON.parse(window.input as string) : undefined;
          targetBonus = Number(window.target_bonus);
          const prior = JSON.parse(
            db
              .prepare(
                "SELECT frame FROM run_history WHERE run_id=? AND sequence=?",
              )
              .get(r.id, r.revision)!.frame as string,
          ) as HistoryFrame;
          previousRoll = prior.check!.roll;
          db.prepare("INSERT INTO shop_discarded_checks VALUES(?,?)").run(
            r.id,
            r.revision,
          );
        }
        const beforeView = project(story, before, r.id, beforeRevision);
        const normalCheck =
          !!beforeView.check &&
          !beforeView.combat &&
          ["roll", "next"].includes(actionId);
        if (data.shopItem) {
          if (!normalCheck)
            throw new GameError(400, "这个道具只能在普通 D100 检定前使用。");
          if (beforeView.check!.target >= 99)
            throw new GameError(400, "目标值已达到 99，无需使用命运助力。");
          consumeItem(db, owner.id, "target-plus-10");
          targetBonus = 10;
        }
        const result = advance(
          story,
          before,
          actionId,
          options.dice,
          input,
          targetBonus,
        );
        const canReroll =
          normalCheck &&
          !!result.check &&
          !result.check.combat &&
          !result.check.opponent;
        if (targetBonus && !result.check)
          throw new GameError(400, "这个行动没有进行检定。");
        if (result.check && (targetBonus || retry))
          result.check.assistance = {
            rulesVersion: SHOP_RULES_VERSION,
            targetBonus,
            ...(retry ? { previousRoll } : {}),
          };
        if (result.state.investigators &&
            before.investigators?.current !== result.state.investigators.current &&
            !result.state.createdCharacterId) {
          const actorCardId = randomUUID();
          db.prepare("INSERT INTO character_templates VALUES(?,?,?,?)").run(
            actorCardId, owner.id, JSON.stringify(result.state.character), new Date().toISOString(),
          );
          result.state.createdCharacterId = actorCardId;
          result.state.savedCharacterId = actorCardId;
        }
        const revision = r.revision + 1,
          now = new Date().toISOString(),
          scene = project(story, result.state, r.id, revision),
          response: CommandResponse = {
            scene,
            action: retry ? `使用重掷券：${result.action}` : result.action,
            ...(canReroll ? { canReroll: true } : {}),
            ...(result.check ? { check: result.check } : {}),
            ...(result.dice ? { dice: result.dice } : {}),
          };
        if (
          story.creationPolicy === "guided" &&
          (data.actionId === "allocate" ||
            before.fear?.pending?.kind === "creation-stats" ||
            before.fear?.pending?.kind === "creation-skills" ||
            before.fear?.pending?.kind === "creation-bonus-skill" ||
            (story.id === "alone-against-tide" &&
              !before.flags["tide-created"] &&
              result.state.flags["tide-created"])) &&
          result.state.createdCharacterId
        ) {
          const card = db
            .prepare(
              "SELECT character FROM character_templates WHERE id=? AND user_id=?",
            )
            .get(result.state.createdCharacterId, owner.id);
          if (card) {
            const prior = JSON.parse(card.character as string);
            db.prepare(
              "UPDATE character_templates SET character=? WHERE id=? AND user_id=?",
            ).run(
              JSON.stringify({
                ...result.state.character,
                name: prior.name,
                profile: prior.profile,
              }),
              result.state.createdCharacterId,
              owner.id,
            );
          }
        }
        const changed = db
          .prepare(
            "UPDATE runs SET revision=?,state=?,updated_at=? WHERE id=? AND revision=?",
          )
          .run(revision, JSON.stringify(result.state), now, r.id, r.revision);
        if (changed.changes !== 1)
          throw new GameError(409, "进度冲突，请刷新。");
        db.prepare("DELETE FROM shop_check_windows WHERE run_id=?").run(r.id);
        if (canReroll)
          db.prepare(
            "INSERT INTO shop_check_windows VALUES(?,?,?,?,?,?,?)",
          ).run(
            r.id,
            revision,
            beforeRevision,
            JSON.stringify(before),
            actionId,
            input ? JSON.stringify(input) : null,
            targetBonus,
          );
        const frame: HistoryFrame = {
          sequence: revision,
          createdAt: now,
          scene,
          action: response.action,
          check: result.check,
          dice: result.dice,
          memory: result.memory,
        };
        db.prepare("INSERT INTO run_history VALUES(?,?,?)").run(
          r.id,
          revision,
          JSON.stringify(frame),
        );
        db.prepare("INSERT INTO run_events VALUES(?,?,?)").run(
          r.id,
          revision,
          JSON.stringify({
            action: result.action,
            check: result.check,
            nodeId: result.state.nodeId,
            visitId: result.state.visitId,
            state: result.state,
          }),
        );
        db.prepare("INSERT INTO run_commands VALUES(?,?,?,?)").run(
          r.id,
          data.commandId,
          digest,
          JSON.stringify(response),
        );
        return response;
      });
    },
  );
  for (const endpoint of ["history", "replay", "memories"])
    app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
      `/api/runs/:id/${endpoint}`,
      async (request) => {
        const r = getRun(request.params.id, user(request).id);
        const after = z.coerce
          .number()
          .int()
          .min(-1)
          .parse(request.query.after ?? -1);
        const frames = db
          .prepare(
            "SELECT h.frame,EXISTS(SELECT 1 FROM shop_discarded_checks d WHERE d.run_id=h.run_id AND d.sequence=h.sequence) AS discarded FROM run_history h WHERE h.run_id=? AND h.sequence>? ORDER BY h.sequence LIMIT 51",
          )
          .all(r.id, after)
          .map((row) => {
            const frame = JSON.parse(row.frame as string) as HistoryFrame;
            return {
              ...frame,
              ...(row.discarded ? { discarded: true } : {}),
              scene: withSceneReading(storyFor(r), frame.scene),
            };
          });
        const page = frames.slice(0, 50);
        return {
          frames: endpoint === "memories" ? page.filter((f) => f.memory) : page,
          nextAfter: frames.length > 50 ? page.at(-1)!.sequence : null,
        };
      },
    );
  if (options.serveStatic) {
    const root = resolve(projectRoot, "apps/web/dist");
    if (existsSync(root)) {
      await app.register(staticFiles, { root });
      app.setNotFoundHandler((request, reply) =>
        request.url.startsWith("/api/") ||
        /\.[a-z0-9]+(?:\?|$)/i.test(request.url)
          ? reply.code(404).send({ message: "找不到页面或资源。" })
          : reply.sendFile("index.html"),
      );
    }
  }
  return app;
}
