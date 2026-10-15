import { initialState, ENGINE_VERSION } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import { loadStories } from "../../apps/api/src/catalog.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import { openDatabase } from "../../apps/api/src/storage/database.js";
import { fixture } from "./shop-story.js";
import type { Story } from "../../packages/contracts/index.js";
export const rankingPassword = "leaderboard-test-password";
export const rankingHeaders = { "x-requested-with": "cthulhu-web" };
export async function leaderboardFixture() {
  const root = mkdtempSync(join(tmpdir(), "coc-leaderboard-"));
  const storyRoot = join(root, "stories");
  for (const id of [fixture.id, "alone-against-static"])
    for (const version of ["0.0.1", "0.0.2"]) {
      const story: Story = {
        ...fixture,
        id,
        version,
        nodes: fixture.nodes,
      };
      const path = join(storyRoot, id, version);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, "story.json"), JSON.stringify(story));
    }
  const retired: Story = {
    ...fixture,
    id: "retirement-fixture",
    version: "0.0.2",
    rulesVersion: "coc7-solo@2",
    entry: "retire",
    nodes: [
      {
        id: "retire",
        type: "program",
        title: "退出调查",
        chapter: "测试",
        background: "/art/train.svg",
        text: ["退出。"],
        program: [{ kind: "end", label: "健康退场", collect: false }],
      },
    ],
  };
  const retirementPath = join(storyRoot, retired.id, retired.version);
  mkdirSync(retirementPath, { recursive: true });
  writeFileSync(join(retirementPath, "story.json"), JSON.stringify(retired));
  const databasePath = join(root, "game.sqlite");
  const options = {
    storyRoot,
    databasePath,
    rateLimitMax: 10000,
    dice: (min: number) => min,
  };
  let app = await buildApp(options);
  const accounts: Array<{
    id: string;
    username: string;
    cookies: { session: string };
  }> = [];
  for (const username of [
    "领航员",
    "追迹者",
    "远行者",
    ...Array.from(
      { length: 21 },
      (_, i) => `资料员${String(i + 1).padStart(2, "0")}`,
    ),
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers: rankingHeaders,
      remoteAddress: `192.0.2.${accounts.length + 1}`,
      payload: {
        username,
        password: rankingPassword,
        inviteCode: "fa6ian-test",
      },
    });
    if (response.statusCode !== 200)
      throw Error(`${username}: ${response.statusCode} ${response.body}`);
    accounts.push({
      id: response.json().id as string,
      username,
      cookies: { session: response.cookies[0].value },
    });
  }
  const db = openDatabase(databasePath);
  const catalog = loadStories(storyRoot);
  const add = (
    id: string,
    owner: string,
    endingId: string,
    version = "0.0.2",
    storyId = fixture.id,
    status = "ended",
    legacy = false,
  ) => {
    const at = "2026-10-15T00:00:00.000Z";
    const source = catalog.get(`${storyId}@${version}`) ?? fixture;
    const state = initialState(
      source,
      createCharacter("统计夹具", source.presets[0], 30),
    );
    state.status = status as "active" | "ended";
    if (source.nodes.some((node) => node.id === endingId))
      state.nodeId = endingId;
    db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)").run(
      id,
      owner,
      storyId,
      version,
      source.rulesVersion,
      ENGINE_VERSION,
      1,
      JSON.stringify(state),
      at,
      at,
    );
    const node = fixture.nodes.find((node) => node.id === endingId);
    const frame = {
      sequence: 1,
      createdAt: at,
      scene: {
        status,
        title: node?.title,
        chapter: node?.chapter,
        ...(legacy ? {} : { collection: { endingId } }),
      },
    };
    db.prepare("INSERT INTO run_history VALUES(?,?,?)").run(
      id,
      1,
      JSON.stringify(frame),
    );
  };
  add("a-old", accounts[0].id, "255", "0.0.1", fixture.id, "ended", true);
  add("a-repeat", accounts[0].id, "255");
  add("a-second", accounts[0].id, "223-end");
  db.prepare(
    "INSERT INTO run_history SELECT run_id,2,frame FROM run_history WHERE run_id='a-second'",
  ).run();
  add("b-flames", accounts[1].id, "255");
  add("b-static", accounts[1].id, "won", "0.0.2", "alone-against-static");
  const current = accounts[2];
  add("c-active", current.id, "255", "0.0.2", fixture.id, "active");
  add("c-pending", current.id, "255");
  db.prepare(
    "INSERT INTO shop_check_windows VALUES(?,1,0,'{}','roll',NULL,0)",
  ).run("c-pending");
  add("c-discarded", current.id, "223-end");
  db.prepare("INSERT INTO shop_discarded_checks VALUES(?,1)").run(
    "c-discarded",
  );
  add("c-missing", current.id, "won", "99.0.0");
  add("c-retired", current.id, "retire", "0.0.2", "retirement-fixture");
  db.prepare("INSERT INTO shop_wallets VALUES(?,0)").run(accounts[0].id);
  db.prepare("INSERT INTO achievement_claims VALUES(?,?,3,?)").run(
    accounts[0].id,
    `ending:${fixture.id}:255`,
    "2026-10-15T00:00:00.000Z",
  );
  db.close();
  return {
    root,
    databasePath,
    accounts,
    current,
    get app() {
      return app;
    },
    async restart() {
      await app.close();
      app = await buildApp(options);
    },
    async close() {
      await app.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
