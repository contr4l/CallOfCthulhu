/** Platform fixture, not a route witness for the imported book. */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { buildApp } from "../apps/api/src/app.js";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import type { FearDefinition } from "../packages/contracts/fear.js";
import type { SceneView } from "../packages/contracts/index.js";
import { fearActionId } from "../packages/engine/fear-adapter.js";
const headers = { "x-requested-with": "cthulhu-web" };
function fixture() {
  const story = structuredClone(loadStories("stories").get("alone-against-static@1.2.0")!);
  story.id = "fear-platform-fixture"; story.version = "1.0.0"; story.rulesVersion = "aaf-solo@1";
  story.creationPolicy = "guided"; delete story.healthPolicy; story.entry = "entry";
  const table = (result: string) => ({ die: "D6", entries: [{ roll: [1, 6] as [number, number], result }] });
  const definition: FearDefinition = {
    format: "aaf-fear-definition@1", source: { pdfSha256: "a".repeat(64), pages: 106 },
    map: { boxesPerSheet: 30, rows: 6, columns: 5, adjacency: "orthogonal", topologyBasis: "web-adaptation", start: { sheet: 1, box: 1 }, safehouseLimit: 3, safehouseLifetime: "nearest-first" },
    rules: { foodEveryBoxes: 5, townExplorationTable: "town", randomEncounterTable: "encounter", usefulItemTable: "useful", randomItemTable: "random", maxScars: 3, maxTraumas: 3, searchOncePerBox: true, exploredAreaEncounter: { numerator: 1, denominator: 6 }, sixExplodes: true, naturalOneFails: true, naturalSixSucceeds: true },
    sceneRefs: { entry: "entry", exploration: "exploration", missions: "missions", specialEvents: {}, tables: {}, events: {}, endings: { won: "won", dead: "dead", insane: "insane" } },
    eventPrograms: {}, skills: { investigator: { label: "调查员", xp: 6, modifiers: {} }, willpower: { label: "意志", xp: 6, modifiers: {} }, slippery: { label: "滑溜", xp: 3, modifiers: {} } },
    weapons: { knife: { label: "小刀", damage: 1 }, unarmed: { label: "徒手", damage: 1 } }, enemies: {},
    tables: { town: table("quiet"), encounter: table("quiet"), useful: table("quiet"), random: table("quiet") },
    missions: Object.fromEntries(Array.from({ length: 6 }, (_, index) => [String(index + 1), { label: "测试任务", goal: "平台存档测试", kind: "hell-gates" as const }])),
    gates: { required: 7, level: 6 },
  };
  story.fear = definition;
  story.nodes = ["entry", "exploration", "missions", "won", "dead", "insane"].map(id => ({ id, title: id, text: ["平台测试片段。"], chapter: "1", type: "fear" as const, background: story.nodes[0].background,
    ...(["won", "dead", "insane"].includes(id) ? { ending: id } : {}) }));
  return validateStory(story);
}
test("Fear uses authenticated commands, exact saved D6 draws, idempotency and database restart", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "fear-api-"));
  const story = fixture(), root = join(temporary, "stories"), packagePath = join(root, story.id, story.version);
  mkdirSync(packagePath, { recursive: true }); writeFileSync(join(packagePath, "story.json"), JSON.stringify(story));
  let draws = 0;
  const options = { storyRoot: root, databasePath: join(temporary, "game.sqlite"), dice: (min: number) => { draws++; return min; } };
  let app = await buildApp(options);
  try {
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", headers, payload: { username: "恐惧平台测试", password: "fear-platform-password", inviteCode: "fa6ian-test" } });
    assert.equal(registered.statusCode, 200, registered.body);
    const cookies = { session: registered.cookies[0].value };
    const catalog = (await app.inject({ url: "/api/stories" })).json();
    assert.ok(!JSON.stringify(catalog).includes("townExplorationTable"));
    const created = await app.inject({ method: "POST", url: "/api/runs", cookies, headers, payload: { storyId: story.id, presetId: story.presets[0].id, name: "幸存者" } });
    assert.equal(created.statusCode, 201, created.body);
    let scene: SceneView = created.json();
    assert.equal(scene.character.rulesVersion, "aaf-solo@1"); assert.equal(scene.character.hp, 8);
    assert.equal(scene.character.attributes, undefined); assert.equal(draws, 2);
    const startingCards = (await app.inject({ url: "/api/characters", cookies })).json();
    assert.equal(startingCards.length, 1);
    assert.equal(startingCards[0].character.rulesVersion, "aaf-solo@1");
    assert.equal(startingCards[0].character.attributes, undefined);
    assert.equal(startingCards[0].character.hp, 8);
    const history = (await app.inject({ url: `/api/runs/${scene.runId}/history`, cookies })).json().frames;
    assert.equal(history[0].dice.aggregate, false); assert.equal(history[0].dice.groups[0].results.length, 2);
    for (let phase = 0; phase < 4; phase++) {
      const action = phase === 0
        ? scene.actions.find(candidate => candidate.label === "用全部3点额外选择一项技能")
        : scene.actions[0];
      assert.ok(action, `creation phase ${phase} has a source-authorized action: ${scene.actions.map(candidate => candidate.label).join(" | ")}`);
      const payload = { commandId: randomUUID(), expectedRevision: scene.revision, actionId: action.id };
      const first = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, cookies, headers, payload });
      assert.equal(first.statusCode, 200, first.body);
      const beforeReplay: number = draws;
      const replay = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, cookies, headers, payload });
      assert.equal(replay.body, first.body); assert.equal(draws, beforeReplay);
      scene = first.json().scene;
      if (phase === 1) assert.equal(scene.fear?.pending?.kind, "creation-bonus-skill");
      if (phase === 2) {
        assert.equal(scene.fear?.pending?.kind, "starting-area");
        assert.equal(scene.fear?.skills.length, 3);
        assert.ok(scene.fear?.skills.some(skill => skill.label === "滑溜"));
      }
    }
    assert.equal(scene.fear!.currentBox.id, "s1:b1"); assert.equal(scene.character.sanity, 8);
    const beforeInvalid = draws;
    const invalid = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, cookies, headers,
      payload: { commandId: randomUUID(), expectedRevision: scene.revision, actionId: "fear-invalid-action" } });
    assert.equal(invalid.statusCode, 400); assert.equal(draws, beforeInvalid);
    await app.close();
    app = await buildApp({ ...options, dice: () => { throw new Error("读档不应重掷骰子"); } });
    const recovered = await app.inject({ url: `/api/runs/${scene.runId}`, cookies });
    assert.equal(recovered.statusCode, 200, recovered.body); assert.deepEqual(recovered.json(), scene);
    assert.equal(recovered.json().fear.skills.length, 3);
    assert.equal((await app.inject({ url: `/api/runs/${scene.runId}` })).statusCode, 401);
  } finally { await app.close(); rmSync(temporary, { recursive: true, force: true }); }
});

test("Witch Knots pending dice survive authenticated duplicate commands and database restart", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "fear-knots-api-")), story = fixture();
  story.fear!.items = { "witch-knots-cord": { label: "女巫绳结", weightless: true } };
  story.fear!.sceneRefs.events = { "36": "exploration", loot: "missions" };
  story.fear!.eventPrograms = { "36": [{ op: "item", itemId: "witch-knots-cord", amount: 1 }], loot: [{ op: "resource", key: "food", amount: "2D6" }] };
  story.fear!.tables.town.entries = [ { roll: 1, result: "cord", scene: "exploration" }, { roll: 2, result: "loot", scene: "missions" }, { roll: [3, 6], result: "quiet" } ];
  const root = join(temporary, "stories"), packagePath = join(root, story.id, story.version);
  mkdirSync(packagePath, { recursive: true }); writeFileSync(join(packagePath, "story.json"), JSON.stringify(validateStory(story)));
  let draws = 0; const faces: number[] = [];
  const options = { storyRoot: root, databasePath: join(temporary, "game.sqlite"), dice: (min: number) => { draws++; return faces.shift() ?? min; } };
  let app = await buildApp(options);
  try {
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", headers, payload: { username: "绳结平台验证", password: "knots-platform-password", inviteCode: "fa6ian-test" } });
    assert.equal(registered.statusCode, 200, registered.body); const cookies = { session: registered.cookies[0].value };
    const created = await app.inject({ method: "POST", url: "/api/runs", cookies, headers, payload: { storyId: story.id, presetId: story.presets[0].id, name: "绳结存档" } });
    assert.equal(created.statusCode, 201, created.body); let scene: SceneView = created.json();
    const send = async (actionId: string, nextFaces: number[] = []) => {
      faces.push(...nextFaces);
      const payload = { commandId: randomUUID(), expectedRevision: scene.revision, actionId };
      const response = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, cookies, headers, payload });
      assert.equal(response.statusCode, 200, response.body); scene = response.json().scene;
      const committedDraws = draws;
      const repeated = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, cookies, headers, payload });
      assert.equal(repeated.body, response.body); assert.equal(draws, committedDraws);
    };
    for (let phase = 0; phase < 4; phase++) await send(phase === 0 ? scene.actions.find(action => action.label === "用全部3点额外选择一项技能")!.id : scene.actions[0].id);
    await send(fearActionId({ type: "move", target: "s1:b2" }), [1]);
    await send("next", [4]); // printed event 36 D6+1 grants five knots
    assert.ok(scene.inventory.some(item => item.key === "witch-knots-cord"));
    await send(fearActionId({ type: "move", target: "s1:b3" }));
    assert.equal(scene.fear?.pending?.kind, "witch-knot-dice");
    await send("next", [2]);
    assert.ok(scene.actions.some(action => action.id === "fear-die-reroll:0"));
    assert.ok(!JSON.stringify(scene).includes('"before"')); assert.ok(!JSON.stringify(scene).includes('"visibleKeys"'));
    const beforeRestart = draws;
    await app.close(); app = await buildApp(options);
    assert.deepEqual((await app.inject({ url: `/api/runs/${scene.runId}`, cookies })).json(), scene);
    await app.inject({ url: `/api/runs/${scene.runId}/history`, cookies }); assert.equal(draws, beforeRestart);
    await send("fear-die-accept"); // town result leads to readable loot event
    await send("next"); // starts the event action without drawing its food dice
    await send("next", [5]);
    await send("fear-die-reroll:0", [4, 6]);
    await send("fear-die-accept");
    await send("next", [3]); await send("fear-die-accept");
    // The source food-to-salt conversion choice follows the granted food; keep it as food.
    await send(fearActionId({ type: "choose", choice: "0" }));
    assert.equal(scene.fear?.pending, undefined);
    assert.equal((await app.inject({ url: `/api/runs/${scene.runId}` })).statusCode, 401);
    assert.equal(faces.length, 0);
  } finally { await app.close(); rmSync(temporary, { recursive: true, force: true }); }
});
