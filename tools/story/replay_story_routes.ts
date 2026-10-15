/** Authenticated story replay with role/ending coverage, pinned rules, restart and idempotence. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  cpSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import type { SceneView } from "../../packages/contracts/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";
import { storyTerminalTargets } from "./story-terminal-targets.js";
type Draw = { min: number; max: number; value: number };
type Route = {
  seed?: number;
  role?: number;
  presetId?: string;
  missionId?: string;
  completion?: { node: string; xp: number; gatesClosed: number };
  endingId?: string;
  initialDraws: Draw[];
  steps: {
    node: string;
    action: string;
    input: Record<string, number | string>;
    draws: Draw[];
    resultNode: string;
  }[];
};
const missionGoal = process.env.STORY_ROUTE_GOAL === "mission";
const candidate = resolve(
  process.env.STORY_CANDIDATE ??
    (() => {
      throw Error("Set STORY_CANDIDATE to an isolated candidate package");
    })(),
);
const manifestBytes = readFileSync(join(candidate, "story.json"));
const manifest = JSON.parse(manifestBytes.toString());
const chapterId = (id: string) =>
  manifest.nodes.find((node: { id: string }) => node.id === id)?.sourceId ?? id;
const report = JSON.parse(
  readFileSync(
    resolve(
      process.env.STORY_ROUTES ??
        (() => {
          throw Error("Set STORY_ROUTES to matching legal witnesses");
        })(),
    ),
    "utf8",
  ),
) as {
  manifestSha256: string;
  runtimeSha256?: string;
  storyId?: string;
  version?: string;
  storyVersion?: string;
  missing?: string[];
  missingMissionIds?: string[];
  routes: Route[];
};
const runtimeSha256 = runtimeFingerprint();
assert.equal(
  createHash("sha256").update(manifestBytes).digest("hex"),
  report.manifestSha256,
  "规则候选已变化，先重新生成并审校路线",
);
if (report.runtimeSha256)
  assert.equal(
    runtimeFingerprint(),
    report.runtimeSha256,
    "运行规则已变化，先重新生成并审校路线",
  );
assert.ok(report.routes.length, "没有可回放路线");
if (report.storyId) assert.equal(report.storyId, manifest.id);
if (report.version ?? report.storyVersion)
  assert.equal(report.version ?? report.storyVersion, manifest.version);
assert.ok(
  Array.isArray(manifest.presets) && manifest.presets.length,
  "没有合法角色",
);
const expected = missionGoal
  ? ["1", "2", "3", "4", "5", "6"]
  : storyTerminalTargets(manifest);
const coverage = new Set<string>();
const verified: {
  seed?: number;
  presetId: string;
  endingId?: string;
  missionId?: string;
  steps: number;
  restartAt: number;
}[] = [];
for (const route of report.routes) {
  const presetId = route.presetId ?? manifest.presets[route.role ?? 0]?.id;
  assert.ok(
    manifest.presets.some((preset: any) => preset.id === presetId),
    "见证角色不是本候选的合法角色",
  );
  const directory = mkdtempSync(join(tmpdir(), "story-legal-api-"));
  const packagePath = join(directory, "stories", manifest.id, manifest.version);
  mkdirSync(packagePath, { recursive: true });
  cpSync(candidate, packagePath, { recursive: true });
  let queue: Draw[] = route.initialDraws.slice(),
    count = 0;
  const dice = (min: number, max: number) => {
    const draw = queue.shift();
    assert.ok(draw, "API产生未记录的骰点");
    assert.deepEqual([min, max], [draw.min, draw.max]);
    assert.ok(
      Number.isSafeInteger(draw.value) && draw.value >= min && draw.value < max,
      "骰点不在合法范围内",
    );
    count++;
    return draw.value;
  };
  const options = {
    storyRoot: join(directory, "stories"),
    databasePath: join(directory, "game.sqlite"),
    rateLimitMax: 20000,
    dice,
  };
  let app = await buildApp(options);
  const headers = { "x-requested-with": "cthulhu-web" };
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: {
        username: `story_route_${route.seed ?? route.missionId}`,
        password: "story-witness-test-only",
        inviteCode: "fa6ian-test",
      },
    });
    assert.equal(registered.statusCode, 200, registered.body);
    const cookies = { session: registered.cookies[0].value };
    const creation = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers,
      cookies,
      payload: { storyId: manifest.id, presetId, name: "来源路线验证" },
    });
    assert.equal(creation.statusCode, 201, creation.body);
    assert.equal(queue.length, 0);
    let scene = creation.json() as SceneView;
    const midpoint = Math.floor(route.steps.length / 2);
    for (const [index, step] of route.steps.entries()) {
      if (index === midpoint) {
        await app.close();
        app = await buildApp({
          ...options,
          dice: () => {
            throw Error("重启读取不掷骰");
          },
        });
        const restored = await app.inject({
          url: `/api/runs/${scene.runId}`,
          cookies,
        });
        assert.equal(restored.statusCode, 200, restored.body);
        assert.deepEqual(restored.json(), scene);
        await app.close();
        app = await buildApp(options);
      }
      assert.ok(
        scene.actions.some((action) => action.id === step.action),
        `非法见证动作 ${index}: ${step.action}`,
      );
      assert.equal(scene.collection?.chapterId, chapterId(step.node));
      queue = step.draws.slice();
      const payload = {
        commandId: randomUUID(),
        expectedRevision: scene.revision,
        actionId: step.action,
        ...(Object.keys(step.input).length ? { input: step.input } : {}),
      };
      const first = await app.inject({
        method: "POST",
        url: `/api/runs/${scene.runId}/commands`,
        headers,
        cookies,
        payload,
      });
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(queue.length, 0);
      const afterCount = count;
      const retry = await app.inject({
        method: "POST",
        url: `/api/runs/${scene.runId}/commands`,
        headers,
        cookies,
        payload,
      });
      assert.equal(retry.body, first.body);
      assert.equal(count, afterCount);
      scene = first.json().scene;
      assert.equal(scene.collection?.chapterId, chapterId(step.resultNode));
      const history = await app.inject({
        url: `/api/runs/${scene.runId}/history`,
        cookies,
      });
      assert.equal(history.statusCode, 200, history.body);
      assert.equal(count, afterCount);
    }
    if (missionGoal) {
      assert.ok(
        route.missionId && route.completion && manifest.fear,
        "Mission goal needs source-shaped Fear evidence",
      );
      assert.equal(scene.status, "active");
      assert.equal(scene.fear?.missionId, route.missionId);
      assert.equal(scene.fear?.xp, route.completion.xp);
      assert.equal(scene.fear?.gatesClosed, route.completion.gatesClosed);
      assert.ok(
        scene.actions.some((action) => action.label === "开始下一任务"),
        "Completed source mission must expose its campaign continuation",
      );
    } else {
      assert.equal(typeof route.endingId, "string");
      assert.equal(scene.status, "ended");
      assert.equal(scene.collection?.endingId, route.endingId);
    }
    assert.equal(
      (await app.inject({ url: `/api/runs/${scene.runId}` })).statusCode,
      401,
    );
    if (!missionGoal) {
      const terminal = await app.inject({
        method: "POST",
        url: `/api/runs/${scene.runId}/commands`,
        headers,
        cookies,
        payload: {
          commandId: randomUUID(),
          expectedRevision: scene.revision,
          actionId: "next",
        },
      });
      assert.equal(terminal.statusCode, 400, terminal.body);
    }
    coverage.add(
      `${presetId}:${missionGoal ? route.missionId : route.endingId}`,
    );
    verified.push({
      seed: route.seed,
      presetId,
      ...(missionGoal
        ? { missionId: route.missionId }
        : { endingId: route.endingId }),
      steps: route.steps.length,
      restartAt: midpoint,
    });
  } finally {
    await app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
const missingRoleEndings = manifest.presets.flatMap((preset: any) =>
  expected
    .filter((ending) => !coverage.has(`${preset.id}:${ending}`))
    .map((ending) => ({ presetId: preset.id, endingId: ending })),
);
const output = resolve(
  process.env.STORY_API_REPORT ?? "work/story-api-route-report.json",
);
assert.equal(
  runtimeFingerprint(),
  runtimeSha256,
  "运行规则在回放期间变化，需重新执行认证验收",
);
assert.equal(
  createHash("sha256")
    .update(readFileSync(join(candidate, "story.json")))
    .digest("hex"),
  report.manifestSha256,
  "候选在回放期间变化，需重新执行认证验收",
);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      manifestSha256: report.manifestSha256,
      runtimeSha256: runtimeFingerprint(),
      storyId: manifest.id,
      version: manifest.version,
      verified,
      goal: missionGoal ? "mission" : "ending",
      missing: report.missing ?? report.missingMissionIds ?? [],
      missingRoleEndings,
      allExpectedCovered:
        !missingRoleEndings.length &&
        !(report.missing ?? report.missingMissionIds ?? []).length,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    {
      storyId: manifest.id,
      version: manifest.version,
      verified,
      goal: missionGoal ? "mission" : "ending",
      missing: report.missing ?? report.missingMissionIds ?? [],
      missingRoleEndings,
      allExpectedCovered:
        !missingRoleEndings.length &&
        !(report.missing ?? report.missingMissionIds ?? []).length,
    },
    null,
    2,
  ),
);
