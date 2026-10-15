/** Platform succession fixture; complete source-book routes are validated separately. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { createCharacter } from "../packages/rules/index.js";
import type { SceneView } from "../packages/contracts/index.js";
const headers = { "x-requested-with": "cthulhu-web" };

test("successor creates its own archive card, allocation cannot overwrite the predecessor, replay and restart preserve both", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "investigator-api-"));
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "investigator-api-fixture"; story.version = "1.0.0"; story.creationPolicy = "guided"; delete story.healthPolicy;
  story.entry = "first";
  story.presets = [{ ...story.presets[0], skills: { listen: 20 } }];
  const background = story.nodes[0].background;
  const first = createCharacter("前任", story.presets[0], 50);
  const second = createCharacter("继任", { ...story.presets[0], skills: { listen: 30 } }, 55);
  story.investigators = { first: "first", members: [{ id: "first", entry: "first", character: first }, { id: "second", entry: "second", character: second }], restartNode: "end", sharedFlags: [], sharedCounters: [] };
  story.nodes = [
    { id: "first", title: "前任", chapter: "1", text: ["分配技能后退场。"], background, type: "program", program: [
      { kind: "effects", effects: [{ op: "set", field: "luck", value: 50 }] },
      { kind: "allocation", allocation: { kind: "bonus", pool: 5, allowedSkills: ["listen"] } },
      { kind: "choices", choices: [{ id: "lose", label: "退场", target: "next", effects: [{ op: "investigator", action: "lose", reason: "平台测试" }] }] },
    ] },
    { id: "next", title: "接续", chapter: "1", text: ["接续调查。"], background, type: "program", program: [{ kind: "investigator", action: "activate-next" }] },
    { id: "second", title: "继任", chapter: "2", text: ["独立分配技能。"], background, type: "program", program: [
      { kind: "allocation", allocation: { kind: "bonus", pool: 5, allowedSkills: ["listen"] } },
      { kind: "choices", choices: [{ id: "end", label: "结束测试", target: "end" }] },
    ] },
    { id: "end", title: "结束", chapter: "3", text: ["平台测试结束。"], background, type: "program", program: [{ kind: "end", label: "结束", collect: false }] },
  ];
  const root = join(temporary, "stories"), packagePath = join(root, story.id, story.version);
  mkdirSync(packagePath, { recursive: true }); writeFileSync(join(packagePath, "story.json"), JSON.stringify(validateStory(story)));
  const options = { storyRoot: root, databasePath: join(temporary, "game.sqlite"), dice: () => { throw new Error("来源固定幸运和接续不得掷骰"); } };
  let app = await buildApp(options);
  try {
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", headers, payload: { username: "接续平台验证", password: "succession-platform-password", inviteCode: "fa6ian-test" } });
    const cookies = { session: registered.cookies[0].value };
    const created = await app.inject({ method: "POST", url: "/api/runs", cookies, headers, payload: { storyId: story.id, presetId: story.presets[0].id, name: "首位自选姓名" } });
    assert.equal(created.statusCode, 201, created.body);
    let scene: SceneView = created.json();
    const send = async (actionId: string, input?: Record<string, number>) => {
      const payload = { commandId: randomUUID(), expectedRevision: scene.revision, actionId, ...(input ? { input } : {}) };
      const response = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, cookies, headers, payload });
      assert.equal(response.statusCode, 200, response.body);
      scene = response.json().scene;
      return { response, payload };
    };
    await send("allocate", { listen: 5 });
    const before = (await app.inject({ url: "/api/characters", cookies })).json();
    assert.equal(before.length, 1); assert.equal(before[0].character.skills.listen, 25); assert.equal(before[0].character.luck, 50);
    const switched = await send("next");
    assert.equal(scene.character.name, "继任"); assert.equal(scene.character.skills.listen, 30); assert.equal(scene.character.luck, 55);
    const replay = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, cookies, headers, payload: switched.payload });
    assert.equal(replay.body, switched.response.body);
    await send("allocate", { listen: 5 });
    const after = (await app.inject({ url: "/api/characters", cookies })).json();
    assert.equal(after.length, 2);
    assert.deepEqual(after.find((card: { id: string }) => card.id === before[0].id), before[0]);
    const successor = after.find((card: { id: string }) => card.id !== before[0].id);
    assert.equal(successor.character.skills.listen, 35); assert.equal(successor.character.luck, 55);
    await app.close(); app = await buildApp(options);
    const restored = await app.inject({ url: `/api/runs/${scene.runId}`, cookies });
    assert.deepEqual(restored.json(), scene);
    assert.deepEqual((await app.inject({ url: "/api/characters", cookies })).json(), after);
    assert.equal((await app.inject({ url: `/api/runs/${scene.runId}` })).statusCode, 401);
  } finally { await app.close(); rmSync(temporary, { recursive: true, force: true }); }
});
