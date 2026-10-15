import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
const headers = { "x-requested-with": "cthulhu-web" };

test("authenticated text records accept a long source plan once and persist verbatim after restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "coc-written-plan-"));
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "written-plan-api"; story.version = "1.0.0"; delete story.healthPolicy; story.entry = "entry";
  const background = story.nodes[0].background;
  story.nodes = [{ id: "entry", type: "program", title: "计划", chapter: "1", text: ["记录计划"], background, program: [
    { kind: "text", key: "plan", label: "我的行动计划", maxLength: 4000 },
    { kind: "choices", choices: [{ id: "done", label: "继续", target: "end" }] },
  ] }, { id: "end", type: "program", title: "完成", chapter: "2", text: ["完成"], background, program: [{ kind: "end", label: "完成", collect: false }] }];
  const packagePath = join(directory, "stories", story.id, story.version);
  mkdirSync(packagePath, { recursive: true }); writeFileSync(join(packagePath, "story.json"), JSON.stringify(validateStory(story)));
  let draws = 0;
  const options = { storyRoot: join(directory, "stories"), databasePath: join(directory, "game.sqlite"), dice: (min: number) => { draws++; return min; } };
  let app = await buildApp(options);
  try {
    const auth = await app.inject({ method: "POST", url: "/api/auth/register", headers, payload: { username: "行动笔记", password: "written-plan-password", inviteCode: "fa6ian-test" } });
    assert.equal(auth.statusCode, 200, auth.body);
    const cookies = { session: auth.cookies[0].value };
    const luck = await app.inject({ method: "POST", url: "/api/dice/rolls", headers, cookies, payload: { id: randomUUID(), purpose: "luck", sides: 6, count: 3 } });
    assert.equal(luck.statusCode, 200, luck.body);
    const created = await app.inject({ method: "POST", url: "/api/runs", headers, cookies, payload: { storyId: story.id, presetId: story.presets[0].id, name: "记录者", luckRollId: luck.json().id } });
    assert.equal(created.statusCode, 201, created.body);
    const scene = created.json(), text = "先去图书馆查询。\n".repeat(20) + "${KEEP_LITERAL} <script>原样文字</script>";
    const payload = { commandId: randomUUID(), expectedRevision: scene.revision, actionId: "confirm", input: { text } };
    const before = draws;
    const response = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, headers, cookies, payload });
    assert.equal(response.statusCode, 200, response.body); assert.equal(draws, before);
    const repeat = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, headers, cookies, payload });
    assert.equal(repeat.body, response.body); assert.equal(draws, before);
    await app.close(); app = await buildApp({ ...options, dice: () => { throw Error("读档不掷骰"); } });
    const recovered = await app.inject({ url: `/api/runs/${scene.runId}`, cookies });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.deepEqual(recovered.json(), response.json().scene);
    assert.equal(recovered.json().playerNotes?.[0]?.text, text);
    assert.equal((await app.inject({ url: `/api/runs/${scene.runId}` })).statusCode, 401);
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});
