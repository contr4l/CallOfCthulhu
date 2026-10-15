import { grantStoryAccess } from "./helpers/story-access.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { buildApp } from "../apps/api/src/app.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import type {
  RunState,
  SceneView,
  CommandResponse,
} from "../packages/contracts/index.js";
import type { SceneInput } from "../packages/contracts/program.js";
type Draw = { min: number; max: number; value: number };
type Step = {
  node: string;
  action: string;
  input: Record<string, number | string>;
  draws: Draw[];
  resultNode: string;
};
type Witness = {
  role: number;
  endingId: string;
  initialDraws: Draw[];
  steps: Step[];
};
const root = process.env.TIDE_ROOT ?? "stories";
const story = loadStories(root).get("alone-against-tide@1.0.1")!;
const report = JSON.parse(
  readFileSync("tests/browser/fixtures/tide-endings.json", "utf8"),
) as {
  manifestSha256: string;
  missing: string[];
  deadEnds: unknown[];
  capped: number;
  routes: Witness[];
};
const good = (min: number, max: number) => (min === 0 ? 1 : min);
function checkpoint(w: Witness, stop: string) {
  let state = initialState(
    story,
    createCharacter("验收", story.presets[w.role], 0),
    good,
  );
  for (const step of w.steps) {
    if (state.nodeId === stop) return state;
    let draws = step.draws.slice();
    state = advance(
      story,
      state,
      step.action,
      (min, max) => {
        const d = draws.shift()!;
        assert.equal(d.min, min);
        assert.equal(d.max, max);
        return d.value;
      },
      step.input,
    ).state;
  }
  throw Error("checkpoint unavailable " + stop);
}
function allocationValues(
  sceneInput: SceneInput,
): Record<string, number | string> {
  assert.equal(sceneInput.kind, "allocation");
  if (sceneInput.kind !== "allocation") throw Error();
  const a = sceneInput.allocation;
  const keys = [
    ...(a.required ?? []),
    ...(a.includeCredit ? ["creditRating"] : []),
    ...(a.optional?.length ? [a.optional[0]] : []),
    ...(a.groups ?? []).map((g) => g[0]),
  ];
  for (const s of sceneInput.skills)
    if (
      keys.length < a.values!.length &&
      !keys.includes(s.key) &&
      !["cthulhuMythos", "creditRating"].includes(s.key)
    )
      keys.push(s.key);
  const input: Record<string, number | string> = Object.fromEntries(
    keys.map((k, i) => [k, a.values![i]]),
  );
  for (const [k, v] of Object.entries(a.specializations ?? {}))
    if (keys.includes(k)) input["specialty." + k] = v.fixed ?? "阿拉伯语";
  return input;
}
test("Tide graph preserves all book endings, hashed bilingual fragments and every reviewed numbered entry", () => {
  validateStory(story);
  assert.equal(story.presets.length, 3);
  assert.equal(story.nodes.length, 315);
  assert.equal(
    report.manifestSha256,
    createHash("sha256")
      .update(readFileSync(`${root}/${story.id}/${story.version}/story.json`))
      .digest("hex"),
  );
  const raw = JSON.parse(
    readFileSync(`${root}/${story.id}/${story.version}/story.json`, "utf8"),
  );
  assert.equal(raw.format, "coc-runtime-graph@1");
  assert.ok(
    raw.nodes.every((n: object) => !("text" in n) && !("reading" in n)),
  );
  assert.equal(
    new Set(
      raw.nodes.map((n: { fragment: { path: string } }) => n.fragment.path),
    ).size,
    243,
  );
  for (const n of story.nodes) {
    assert.deepEqual(n.reading!["zh-CN"]!.text, n.text);
    assert.ok(!n.text.join("").match(/(?:前往|转到|跳转到)\s*\d+/));
  }
  assert.ok(!story.nodes.some((n) => n.id === "187")); // Original misprint is retained in source, no invented forward edge.
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.deadEnds, []);
  assert.equal(report.capped, 0);
  const endings = story.nodes
    .filter((n) =>
      n.program!.some((s) => s.kind === "end" && s.collect !== false),
    )
    .map((n) => n.id)
    .sort();
  assert.equal(endings.length, 50);
  for (const role of [0, 1, 2])
    assert.deepEqual(
      report.routes
        .filter((r) => r.role === role)
        .map((r) => r.endingId)
        .sort(),
      endings,
    );
});
test("conditional transitions show the current prose, then expose only one automatic next action", () => {
  for (const [id, ending, target] of [
    ["215", "227", "227"],
    ["215", "236", "236"],
    ["235", "239", "205"],
    ["219", "239", "239"],
    ["173", "225", "225"],
    ["191", "231", "231"],
  ]) {
    const route = report.routes.find(
      (r) => r.endingId === ending && r.steps.some((s) => s.node === id),
    )!;
    const state = checkpoint(route, id);
    const view = project(story, state, "test", 0);
    assert.ok(view.text.length && view.text[0] !== "按当前行动继续。");
    assert.deepEqual(view.actions, [{ id: "next", label: "下一节" }]);
    const next = advance(story, state, "next", () => {
      throw Error("conditional routing must not roll dice");
    }).state;
    assert.equal(next.nodeId, target);
  }
});

test("the earlier Tide version and its complete saved-route witnesses remain compatible", () => {
  const old = loadStories("stories").get("alone-against-tide@1.0.0")!;
  const legacy = JSON.parse(
    readFileSync("tests/browser/fixtures/tide-endings-1.0.0.json", "utf8"),
  ) as typeof report;
  assert.equal(
    legacy.manifestSha256,
    createHash("sha256")
      .update(readFileSync("stories/alone-against-tide/1.0.0/story.json"))
      .digest("hex"),
  );
  for (const w of legacy.routes) {
    let draws = w.initialDraws.slice();
    const dice = (min: number, max: number) => {
      const d = draws.shift()!;
      assert.equal(d.min, min);
      assert.equal(d.max, max);
      return d.value;
    };
    let state = initialState(
      old,
      createCharacter("兼容回放", old.presets[w.role], 0),
      dice,
    );
    for (const step of w.steps) {
      assert.equal(state.nodeId, step.node);
      draws = step.draws.slice();
      state = advance(old, state, step.action, dice, step.input).state;
      assert.equal(draws.length, 0);
      assert.equal(state.nodeId, step.resultNode);
    }
    assert.equal(state.status, "ended");
    assert.equal(state.nodeId, w.endingId);
  }
});

test("eight occupations enforce nine values, required alternatives, specializations and seven nonoccupation interests", () => {
  const w = report.routes.find((r) => r.role === 0 && r.endingId === "239")!;
  const before = checkpoint(w, "80");
  const menu = project(story, before, "test", 0);
  assert.equal(menu.actions.length, 8);
  for (const action of menu.actions) {
    let state = advance(story, before, action.id, good).state;
    let scene = project(story, state, "test", 1);
    const input = allocationValues(scene.input!);
    assert.equal(
      Object.keys(input).filter((k) => !k.startsWith("specialty.")).length,
      9,
    );
    assert.throws(() =>
      advance(story, state, "allocate", good, { ...input, creditRating: 1 }),
    );
    state = advance(story, state, "allocate", good, input).state;
    scene = project(story, state, "test", 2);
    assert.equal(scene.input!.kind, "allocation");
    const keys = (
      scene.input as Extract<SceneInput, { kind: "allocation" }>
    ).skills
      .filter((s) => !["creditRating", "cthulhuMythos"].includes(s.key))
      .slice(0, 7)
      .map((s) => s.key);
    assert.ok(keys.every((k) => !state.program!.occupationSkills.includes(k)));
    assert.throws(() =>
      advance(
        story,
        state,
        "allocate",
        good,
        Object.fromEntries(keys.slice(0, 6).map((k) => [k, 20])),
      ),
    );
    state = advance(
      story,
      state,
      "allocate",
      good,
      Object.fromEntries(keys.map((k) => [k, 20])),
    ).state;
    assert.equal(
      state.character.occupation,
      (scene.input as Extract<SceneInput, { kind: "allocation" }>).allocation
        .occupation ?? state.character.occupation,
    );
  }
});
test("Woods bonus pool preserves the printed card, profile and derived values", () => {
  const w = report.routes.find((r) => r.role === 1 && r.endingId === "239")!;
  const s = checkpoint(w, "80-woods");
  assert.equal(s.character.skills.dodge, 50);
  assert.equal(s.character.movement, 7);
  assert.equal(s.character.profile?.age, 40);
  assert.equal(s.character.specializations?.languageOther, "阿拉伯语");
  assert.throws(() => advance(story, s, "allocate", good, { locksmith: 69 }));
  assert.throws(() =>
    advance(story, s, "allocate", good, { cthulhuMythos: 70 }),
  );
  assert.throws(() => advance(story, s, "allocate", good, { archaeology: 70 }));
  const next = advance(story, s, "allocate", good, {
    locksmith: 30,
    swim: 20,
    climb: 20,
  }).state;
  assert.equal(next.character.skills.locksmith, 80);
  assert.equal(next.character.hp, 11);
  assert.equal(next.character.skills.dodge, 50);
  assert.equal(next.character.mp, 10);
  assert.equal(next.character.luck, 0);
});
test("luck spending records raw dice, costs exactly once, respects hard targets and keeps push exclusive", () => {
  const w = report.routes.find(
    (r) => r.role === 0 && r.steps.some((s) => s.node === "92-creditRating"),
  )!;
  const s = checkpoint(w, "92-creditRating");
  s.character.luck = 90;
  const fail = (min: number, max: number) =>
    min === 0 ? (max === 10 ? 5 : 0) : min; // D100 55, below the fumble threshold.
  let next = advance(story, s, "next", fail);
  assert.equal(next.check!.roll, 55);
  assert.equal(next.state.nodeId, "92-creditRating");
  const oldLuck = next.state.character.luck,
    cost = next.check!.roll - next.check!.target;
  assert.ok(
    project(story, next.state, "test", 1).actions.some(
      (a) => a.id === "spend-luck",
    ),
  );
  next = advance(story, next.state, "spend-luck", () => {
    throw Error("luck cannot draw new dice");
  });
  assert.equal(next.check!.originalRoll, 55);
  assert.equal(next.check!.luckSpent, cost);
  assert.equal(next.check!.grade, "extreme");
  assert.equal(next.state.character.luck, oldLuck - cost);
  assert.ok(next.state.inventory.some((i) => i.key === "tide-idol"));
  assert.throws(() => advance(story, next.state, "spend-luck", good));
});
test("fear branches retain their bonus, penalty, two shots and fainting; pushed failures cannot spend luck", () => {
  const w = report.routes.find((r) => r.role === 2 && r.endingId === "243")!;
  const start = checkpoint(w, "162-gun-mad");
  for (const face of [1, 2, 3, 4]) {
    let state = advance(story, start, "next", () => face).state;
    if (face === 4) {
      assert.equal(state.nodeId, "243");
      assert.equal(state.status, "ended");
      continue;
    }
    if (face === 2) {
      const fail = (min: number, max: number) => (min === 0 ? 0 : min);
      state = advance(story, state, "next", fail).state;
      assert.equal(state.nodeId, "162-gun-second");
      state = advance(story, state, "next", fail).state;
      assert.equal(state.nodeId, "95");
    } else {
      const result = advance(story, state, "next", (min, max) =>
        min === 0 && max === 10 ? 1 : min,
      );
      assert.equal(result.check!.candidates.length, 2);
      assert.equal(result.state.nodeId, "177");
    }
  }
  const lock = checkpoint(
    report.routes.find((r) => r.steps.some((s) => s.node === "7-lock"))!,
    "7-lock",
  );
  lock.character.skills.locksmith = 50;
  lock.character.luck = 60;
  let state = advance(story, lock, "next", (min, max) =>
    min === 0 ? 5 : min,
  ).state;
  assert.ok(
    project(story, state, "test", 0).actions.some((a) => a.id === "push"),
  );
  assert.ok(
    project(story, state, "test", 0).actions.some((a) => a.id === "spend-luck"),
  );
  state = advance(story, state, "push", (min) => min).state;
  assert.equal(state.nodeId, "87");
  assert.equal(state.program!.pending, undefined);
  assert.equal(state.character.luck, 60);
});
test("Tide uses its simplified insanity policy, has no major wounds, and generic retirement is not an unreachable collectible", () => {
  const w = report.routes.find((r) => r.role === 1 && r.endingId === "243")!;
  const before = checkpoint(w, "162");
  before.character.sanity = 1;
  const zero = advance(story, before, "next", good).state;
  assert.equal(zero.nodeId, "tide-retirement");
  assert.equal(zero.status, "ended");
  assert.equal(project(story, zero, "test", 0).collection?.endingId, undefined);
  const wounded = checkpoint(
    report.routes.find((r) => r.role === 1 && r.endingId === "125-death")!,
    "125",
  );
  assert.ok(!wounded.flags.majorWound);
  // Once any SAN-loss entry is reached, there is no return to it or another corpse SAN entry.
  const lossEntries = ["120", "133", "143"];
  const successors = (id: string) => {
    const targets: string[] = [];
    const visit = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(visit);
      else if (x && typeof x === "object")
        for (const [k, v] of Object.entries(x)) {
          if (
            ["target", "success", "failure", "fumble"].includes(k) &&
            typeof v === "string"
          )
            targets.push(v);
          else if (k === "targets") targets.push(...(v as string[]));
          else visit(v);
        }
    };
    visit(story.nodes.find((n) => n.id === id)!.program);
    return targets;
  };
  for (const id of lossEntries) {
    const seen = new Set<string>();
    const queue = successors(id);
    while (queue.length) {
      const n = queue.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      queue.push(...successors(n));
    }
    assert.ok(lossEntries.every((n) => !seen.has(n)));
    assert.ok(!seen.has("119"));
  }
  // At most corpse 1D3 + creature 1D6 + escape 1D8 =17, below every starting POW (>=40).
});
test("all 150 legal role/ending routes survive authenticated API replay, idempotency, database restart and ending collections", async (t) => {
  for (const w of report.routes)
    await t.test(`role ${w.role} ending ${w.endingId}`, async () => {
      const folder = mkdtempSync(join(tmpdir(), "coc-tide-"));
      let draws = w.initialDraws.slice(),
        used = 0;
      const options = {
        storyRoot: root,
        databasePath: join(folder, "game.sqlite"),
        dice: (min: number, max: number) => {
          const d = draws.shift();
          assert.ok(d, "unexpected draw");
          assert.equal(d.min, min);
          assert.equal(d.max, max);
          assert.ok(d.value >= min && d.value < max);
          used++;
          return d.value;
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
            username: `tide-${w.role}-${w.endingId}`,
            password: "tide-testing-password",
            inviteCode: "fa6ian-test",
          },
        });
        assert.equal(account.statusCode, 200, account.body);
        grantStoryAccess(options.databasePath, account.json().id, story.id);
        const cookies = { session: account.cookies[0].value };
        const created = await app.inject({
          method: "POST",
          url: "/api/runs",
          headers,
          cookies,
          payload: {
            storyId: story.id,
            presetId: story.presets[w.role].id,
            name: "路线验收",
          },
        });
        assert.equal(created.statusCode, 201, created.body);
        let scene = created.json<SceneView>();
        let repeated = false;
        for (const [index, step] of w.steps.entries()) {
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
              input: step.input,
              commandId: randomUUID(),
              expectedRevision: scene.revision,
            },
          };
          const result = await app.inject(request);
          assert.equal(result.statusCode, 200, `${step.node}: ${result.body}`);
          assert.equal(draws.length, 0);
          const body = result.json<CommandResponse>();
          scene = body.scene;
          if (
            step.action === "spend-luck" ||
            (!repeated && step.draws.length)
          ) {
            const count = used;
            assert.equal((await app.inject(request)).body, result.body);
            assert.equal(used, count);
            repeated = true;
          }
          if (body.canReroll) {
            const closed = await app.inject({
              method: "POST",
              url: `/api/runs/${scene.runId}/check-window/close`,
              headers,
              cookies,
              payload: { expectedRevision: scene.revision },
            });
            assert.equal(closed.statusCode, 200, closed.body);
          }
          if (step.resultNode === "23") {
            const cards = (
              await app.inject({ url: "/api/characters", cookies })
            ).json();
            assert.equal(cards.length, 1);
            assert.equal(cards[0].character.luck, scene.character.luck);
            assert.deepEqual(cards[0].character.skills, scene.character.skills);
            assert.deepEqual(
              cards[0].character.attributes,
              scene.character.attributes,
            );
          }
          if (index === Math.floor(w.steps.length / 2)) {
            await app.close();
            app = await buildApp(options);
            const restored = await app.inject({
              url: `/api/runs/${scene.runId}`,
              cookies,
            });
            assert.deepEqual(restored.json(), scene);
          }
        }
        assert.equal(scene.status, "ended");
        assert.equal(scene.collection?.endingId, w.endingId);
        assert.ok(repeated);
        const collections = (
          await app.inject({ url: "/api/collections", cookies })
        ).json();
        const row = collections.find(
          (r: { storyId: string }) => r.storyId === story.id,
        );
        assert.equal(row.endings.total, 50);
        assert.ok(
          row.endings.entries.some((e: { id: string }) => e.id === w.endingId),
        );
        const achievements = (
          await app.inject({ url: "/api/achievements", cookies })
        ).json();
        assert.equal(
          achievements.filter(
            (a: { storyId: string }) => a.storyId === story.id,
          ).length,
          50,
        );
        assert.ok(
          achievements.some(
            (a: { endingId: string; unlockedAt?: string }) =>
              a.endingId === w.endingId && a.unlockedAt,
          ),
        );
      } finally {
        await app.close();
        rmSync(folder, { recursive: true, force: true });
      }
    });
});
