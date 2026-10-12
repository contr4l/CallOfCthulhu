import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadStories } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";

const story = loadStories("stories").get("alone-against-static@1.2.0")!;
const expected = story.nodes
  .filter((n) => n.program!.some((step) => step.kind === "end"))
  .map((n) => n.id);
type Draw = { min: number; max: number; value: number };
type Step = { node: string; action: string; draws: Draw[]; resultNode: string };
const found = new Map<
  string,
  {
    endingId: string;
    role: number;
    seed: number;
    luckDice: number[];
    initialDraws: Draw[];
    steps: Step[];
  }
>();
const perRole = [new Set<string>(), new Set<string>()];
const manifestSha256 = createHash("sha256")
  .update(readFileSync(`stories/${story.id}/${story.version}/story.json`))
  .digest("hex");
const reportPath = "tests/browser/fixtures/static-endings.json";
const previous = existsSync(reportPath)
  ? JSON.parse(readFileSync(reportPath, "utf8"))
  : undefined;
const perRoleRoutes = new Map<
  string,
  NonNullable<ReturnType<typeof found.get>>
>();
const regressionRoutes: NonNullable<ReturnType<typeof found.get>>[] = [];
if (previous?.manifestSha256 === manifestSha256) {
  for (const route of previous.routes ?? []) found.set(route.endingId, route);
  for (const route of previous.perRoleRoutes ?? previous.routes ?? []) {
    perRoleRoutes.set(`${route.role}:${route.endingId}`, route);
    perRole[route.role].add(route.endingId);
  }
}
let attempts = 0,
  capped = 0;
const deadEnds: {
  seed: number;
  role: number;
  node: string;
  steps: Step[];
  used: unknown;
  stack: unknown;
}[] = [];
const maxAttempts = Number(process.env.COC_ENDING_ATTEMPTS ?? 10000);
for (let seed = 1; seed <= maxAttempts; seed++) {
  const role = seed % 2;
  let random = seed;
  const rng = (min: number, max: number) => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return min + Math.floor(((random >>> 0) / 4294967296) * (max - min));
  };
  const luckDice = [rng(1, 7), rng(1, 7), rng(1, 7)];
  let draws: Draw[] = [];
  const dice = (min: number, max: number) => {
    const value = rng(min, max);
    draws.push({ min, max, value });
    return value;
  };
  let state = initialState(
    story,
    createCharacter(
      "结局可达性测试",
      story.presets[role],
      luckDice.reduce((a, b) => a + b, 0) * 5,
    ),
    dice,
  );
  const initialDraws = draws;
  const steps: Step[] = [];
  for (let step = 0; step < 450 && state.status === "active"; step++) {
    const scene = project(story, state, "test", step);
    if (!scene.actions.length) {
      deadEnds.push({
        seed,
        role,
        node: state.nodeId,
        steps,
        used: state.program!.used,
        stack: state.program!.returns,
      });
      break;
    }
    const action = scene.actions[rng(0, scene.actions.length)].id;
    draws = [];
    const node = state.nodeId;
    state = advance(story, state, action, dice).state;
    steps.push({ node, action, draws, resultNode: state.nodeId });
  }
  attempts++;
  if (state.status !== "ended") {
    capped++;
    continue;
  }
  perRole[role].add(state.nodeId);
  const witness = {
    endingId: state.nodeId,
    role,
    seed,
    luckDice,
    initialDraws,
    steps,
  };
  if (!perRoleRoutes.has(`${role}:${state.nodeId}`))
    perRoleRoutes.set(`${role}:${state.nodeId}`, witness);
  if (seed === 5431) regressionRoutes.push(witness);
  if (!found.has(state.nodeId)) {
    found.set(state.nodeId, {
      endingId: state.nodeId,
      role,
      seed,
      luckDice,
      initialDraws,
      steps,
    });
    console.log(
      `found ${state.nodeId}: role ${role}, seed ${seed}, ${steps.length} commands`,
    );
  }
}
const missing = expected.filter((id) => !found.has(id));
const report = {
  storyId: story.id,
  version: story.version,
  manifestSha256,
  attempts,
  capped,
  expectedEndings: expected,
  observedByRole: perRole.map((ids) =>
    [...ids].sort((a, b) => Number(a) - Number(b)),
  ),
  missing,
  routes: [...found.values()].sort(
    (a, b) => Number(a.endingId) - Number(b.endingId),
  ),
  deadEnds,
  perRoleRoutes: [...perRoleRoutes.values()],
  regressionRoutes,
};
writeFileSync(
  "tests/browser/fixtures/static-endings.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    attempts,
    capped,
    reached: found.size,
    missing,
    roles: report.observedByRole,
  }),
);
if (missing.length || capped) process.exitCode = 1;
