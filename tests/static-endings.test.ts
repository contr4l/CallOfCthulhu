import { openDatabase } from "../apps/api/src/storage/database.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../apps/api/src/app.js";
import { loadStories } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter, type DiceSource } from "../packages/rules/index.js";
import type {
  SceneView,
  CommandResponse,
} from "../packages/contracts/index.js";

type Draw = { min: number; max: number; value: number };
type Witness = {
  endingId: string;
  role: number;
  luckDice: number[];
  initialDraws: Draw[];
  steps: { node: string; action: string; resultNode: string; draws: Draw[] }[];
};
const report = JSON.parse(
  readFileSync("tests/browser/fixtures/static-endings.json", "utf8"),
) as {
  manifestSha256: string;
  attempts: number;
  capped: number;
  missing: string[];
  deadEnds: unknown[];
  perRoleRoutes: Witness[];
  regressionRoutes: Witness[];
};
const stories = loadStories("stories");
const story = stories.get("alone-against-static@1.2.0")!;
function replay(witness: Witness, module = story) {
  let draws = witness.initialDraws.slice();
  const dice: DiceSource = (min, max) => {
    const draw = draws.shift();
    assert.ok(draw, `unexpected dice at ${min}..${max}`);
    assert.equal(draw.min, min);
    assert.equal(draw.max, max);
    assert.ok(
      Number.isInteger(draw.value) && draw.value >= min && draw.value < max,
    );
    return draw.value;
  };
  assert.ok(witness.luckDice.every((value) => value >= 1 && value <= 6));
  let state = initialState(
    module,
    createCharacter(
      "回放测试",
      module.presets[witness.role],
      witness.luckDice.reduce((a, b) => a + b, 0) * 5,
    ),
    dice,
  );
  for (const [revision, step] of witness.steps.entries()) {
    assert.equal(draws.length, 0);
    assert.equal(state.nodeId, step.node);
    assert.ok(
      project(module, state, "test", revision).actions.some(
        (action) => action.id === step.action,
      ),
    );
    draws = step.draws.slice();
    state = advance(module, state, step.action, dice).state;
    assert.equal(state.nodeId, step.resultNode);
  }
  assert.equal(draws.length, 0);
  assert.equal(state.status, "ended");
  assert.equal(state.nodeId, witness.endingId);
  return state;
}

test("every Static ending has a legal complete witness for both fixed roles", () => {
  assert.equal(
    report.manifestSha256,
    createHash("sha256")
      .update(readFileSync("stories/alone-against-static/1.2.0/story.json"))
      .digest("hex"),
  );
  assert.equal(report.capped, 0);
  assert.deepEqual(report.deadEnds, []);
  assert.deepEqual(report.missing, []);
  const endings = story.nodes
    .filter((n) => n.program!.some((step) => step.kind === "end"))
    .map((n) => n.id)
    .sort();
  assert.equal(endings.length, 14);
  for (const role of [0, 1]) {
    const witnesses = report.perRoleRoutes.filter((r) => r.role === role);
    assert.deepEqual(witnesses.map((r) => r.endingId).sort(), endings);
    for (const witness of witnesses) replay(witness);
  }
});

test("published bug fix retains old versions and the exhausted-box route can now finish", () => {
  assert.ok(report.regressionRoutes.length);
  for (const witness of report.regressionRoutes) {
    replay(witness);
    assert.throws(() =>
      replay(witness, stories.get("alone-against-static@1.1.0")!),
    );
  }
  const old = stories.get("alone-against-static@1.1.0")!;
  for (const node of story.nodes) {
    const before = old.nodes.find((n) => n.id === node.id)!;
    const expected = structuredClone(before.program);
    for (const step of expected!)
      if (step.kind === "choices")
        for (const choice of step.choices)
          if (
            (node.id === "57" && choice.id === "to-78") ||
            (node.id === "66" && choice.id === "to-57")
          )
            delete choice.once;
    assert.deepEqual(node.program, expected);
    assert.deepEqual(node.text, before.text);
  }
});

test("all 28 role/ending routes execute through authenticated API, database restart and ending collections", async (t) => {
  for (const witness of report.perRoleRoutes)
    await t.test(
      `role ${witness.role} ending ${witness.endingId}`,
      async () => {
        const root = mkdtempSync(join(tmpdir(), "coc-ending-"));
        let draws: Draw[] = [],
          count = 0;
        const options = {
          databasePath: join(root, "game.sqlite"),
          dice: (min: number, max: number) => {
            const draw = draws.shift();
            assert.ok(draw, `unexpected API dice ${min}..${max}`);
            assert.equal(draw.min, min);
            assert.equal(draw.max, max);
            assert.ok(draw.value >= min && draw.value < max);
            count++;
            return draw.value;
          },
        };
        let app = await buildApp(options);
        const headers = { "x-requested-with": "cthulhu-web" };
        try {
          const account = await app.inject({
            method: "POST",
            url: "/api/auth/register",
            headers,
            payload: {
              inviteCode: "fa6ian-test",
              username: `audit-${witness.role}-${witness.endingId}`,
              password: "ending-testing-password",
            },
          });
          assert.equal(account.statusCode, 200, account.body);
          const db = openDatabase(options.databasePath);
          db.prepare("INSERT INTO shop_inventory VALUES(?,?,1)").run(
            account.json().id,
            "story:alone-against-static",
          );
          db.close();
          const cookies = { session: account.cookies[0].value };
          draws = witness.luckDice.map((value) => ({ min: 1, max: 7, value }));
          const luck = await app.inject({
            method: "POST",
            url: "/api/dice/rolls",
            headers,
            cookies,
            payload: { id: randomUUID(), purpose: "luck", count: 3, sides: 6 },
          });
          assert.equal(luck.statusCode, 200, luck.body);
          assert.equal(draws.length, 0);
          draws = witness.initialDraws.slice();
          const started = await app.inject({
            method: "POST",
            url: "/api/runs",
            headers,
            cookies,
            payload: {
              storyId: story.id,
              presetId: story.presets[witness.role].id,
              name: "结局回放",
              luckRollId: luck.json().id,
            },
          });
          assert.equal(started.statusCode, 201, started.body);
          let scene = started.json<SceneView>();
          let duplicated = false;
          for (const [index, step] of witness.steps.entries()) {
            assert.equal(draws.length, 0);
            assert.equal(scene.collection!.chapterId, step.node.split("-")[0]);
            assert.ok(scene.actions.some((a) => a.id === step.action));
            draws = step.draws.slice();
            const request = {
              method: "POST" as const,
              url: `/api/runs/${scene.runId}/commands`,
              headers,
              cookies,
              payload: {
                actionId: step.action,
                commandId: randomUUID(),
                expectedRevision: scene.revision,
              },
            };
            const result = await app.inject(request);
            assert.equal(
              result.statusCode,
              200,
              `${step.node}: ${result.body}`,
            );
            assert.equal(draws.length, 0);
            scene = result.json<CommandResponse>().scene;
            if (result.json<CommandResponse>().canReroll) {
              const accepted = await app.inject({
                method: "POST",
                url: `/api/runs/${scene.runId}/check-window/close`,
                headers,
                cookies,
                payload: { expectedRevision: scene.revision },
              });
              assert.equal(accepted.statusCode, 200, accepted.body);
            }
            assert.equal(
              scene.collection!.chapterId,
              step.resultNode.split("-")[0],
            );
            if (!duplicated && step.draws.length) {
              const used = count;
              assert.equal((await app.inject(request)).body, result.body);
              assert.equal(count, used);
              duplicated = true;
            }
            if (index === Math.floor(witness.steps.length / 2)) {
              await app.close();
              app = await buildApp(options);
              const resumed = await app.inject({
                url: `/api/runs/${scene.runId}`,
                cookies,
              });
              assert.deepEqual(resumed.json(), scene);
            }
          }
          assert.equal(scene.status, "ended");
          assert.equal(scene.collection!.endingId, witness.endingId);
          const collections = (
            await app.inject({ url: "/api/collections", cookies })
          ).json();
          const collection = collections.find(
            (item: { storyId: string }) => item.storyId === story.id,
          );
          assert.equal(collection.endings.entries.length, 1);
          assert.equal(collection.endings.entries[0].id, witness.endingId);
          const achievements = (
            await app.inject({ url: "/api/achievements", cookies })
          ).json();
          assert.ok(
            achievements.some(
              (item: {
                storyId: string;
                endingId: string;
                unlockedAt?: string;
              }) =>
                item.storyId === story.id &&
                item.endingId === witness.endingId &&
                item.unlockedAt,
            ),
          );
          assert.ok(duplicated);
        } finally {
          await app.close();
          rmSync(root, { recursive: true, force: true });
        }
      },
    );
});
