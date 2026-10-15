/** Authenticated candidate replay. Witnesses must match the exact manifest hash. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { buildApp } from "../../apps/api/src/app.js";
import type { SceneView } from "../../packages/contracts/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";
type Draw = { min: number; max: number; value: number };
type Route = { seed: number; endingId: string; initialDraws: Draw[]; steps: { node: string; action: string; input: Record<string, number | string>; draws: Draw[]; resultNode: string }[] };
const candidate = resolve(process.env.FEAR_CANDIDATE ?? "work/alone-against-fear/packed-candidate");
const manifestBytes = readFileSync(join(candidate, "story.json"));
const manifest = JSON.parse(manifestBytes.toString());
const chapterId = (id: string) => manifest.nodes.find((node: { id: string }) => node.id === id)?.sourceId ?? id;
const report = JSON.parse(readFileSync(resolve(process.env.FEAR_ROUTES ?? "work/alone-against-fear/routes.json"), "utf8")) as { manifestSha256: string; runtimeSha256?: string; missing: string[]; routes: Route[] };
assert.equal(createHash("sha256").update(manifestBytes).digest("hex"), report.manifestSha256, "规则候选已变化，先重新生成并审校路线");
if (report.runtimeSha256) assert.equal(runtimeFingerprint(), report.runtimeSha256, "运行规则已变化，先重新生成并审校路线");
assert.ok(report.routes.length, "没有可回放路线");
const verified: { seed: number; endingId: string; steps: number; restartAt: number }[] = [];
for (const route of report.routes) {
  const directory = mkdtempSync(join(tmpdir(), "fear-legal-api-"));
  const packagePath = join(directory, "stories", manifest.id, manifest.version);
  mkdirSync(packagePath, { recursive: true }); cpSync(candidate, packagePath, { recursive: true });
  let queue: Draw[] = route.initialDraws.slice(), count = 0;
  const dice = (min: number, max: number) => {
    const draw = queue.shift(); assert.ok(draw, "API产生未记录的骰点"); assert.deepEqual([min, max], [draw.min, draw.max]); count++; return draw.value;
  };
  const options = { storyRoot: join(directory, "stories"), databasePath: join(directory, "game.sqlite"), rateLimitMax: 20000, dice };
  let app = await buildApp(options);
  const headers = { "x-requested-with": "cthulhu-web" };
  try {
    const registered = await app.inject({ method: "POST", url: "/api/auth/register", headers, payload: { username: `fear_route_${route.seed}`, password: "fear-witness-test-only", inviteCode: "fa6ian-test" } });
    assert.equal(registered.statusCode, 200, registered.body);
    const cookies = { session: registered.cookies[0].value };
    const creation = await app.inject({ method: "POST", url: "/api/runs", headers, cookies, payload: { storyId: manifest.id, presetId: "guided", name: "来源路线验证" } });
    assert.equal(creation.statusCode, 201, creation.body); assert.equal(queue.length, 0);
    let scene = creation.json() as SceneView;
    const midpoint = Math.floor(route.steps.length / 2);
    for (const [index, step] of route.steps.entries()) {
      if (index === midpoint) {
        await app.close(); app = await buildApp({ ...options, dice: () => { throw Error("重启读取不掷骰"); } });
        const restored = await app.inject({ url: `/api/runs/${scene.runId}`, cookies });
        assert.equal(restored.statusCode, 200, restored.body); assert.deepEqual(restored.json(), scene);
        await app.close(); app = await buildApp(options);
      }
      assert.ok(scene.actions.some(action => action.id === step.action), `非法见证动作 ${index}: ${step.action}`);
      assert.equal(scene.collection?.chapterId, chapterId(step.node));
      queue = step.draws.slice();
      const payload = { commandId: randomUUID(), expectedRevision: scene.revision, actionId: step.action, ...(Object.keys(step.input).length ? { input: step.input } : {}) };
      const first = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, headers, cookies, payload });
      assert.equal(first.statusCode, 200, first.body); assert.equal(queue.length, 0);
      const afterCount = count;
      const retry = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, headers, cookies, payload });
      assert.equal(retry.body, first.body); assert.equal(count, afterCount);
      scene = first.json().scene;
      assert.equal(scene.collection?.chapterId, chapterId(step.resultNode));
      const history = await app.inject({ url: `/api/runs/${scene.runId}/history`, cookies });
      assert.equal(history.statusCode, 200, history.body); assert.equal(count, afterCount);
    }
    assert.equal(scene.status, "ended"); assert.equal(scene.collection?.endingId, route.endingId);
    assert.equal((await app.inject({ url: `/api/runs/${scene.runId}` })).statusCode, 401);
    const terminal = await app.inject({ method: "POST", url: `/api/runs/${scene.runId}/commands`, headers, cookies, payload: { commandId: randomUUID(), expectedRevision: scene.revision, actionId: "next" } });
    assert.equal(terminal.statusCode, 400, terminal.body);
    verified.push({ seed: route.seed, endingId: route.endingId, steps: route.steps.length, restartAt: midpoint });
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
}
const output = resolve(process.env.FEAR_API_REPORT ?? "work/alone-against-fear/api-route-report.json");
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ manifestSha256: report.manifestSha256, runtimeSha256: runtimeFingerprint(), verified, missing: report.missing, allExpectedCovered: !report.missing.length }, null, 2) + "\n");
console.log(JSON.stringify({ verified, missing: report.missing, allExpectedCovered: !report.missing.length }, null, 2));
