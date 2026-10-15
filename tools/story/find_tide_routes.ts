/** Test-only exploration through public engine actions, with replayable draws and inputs. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { loadStories } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import type { SceneInput } from "../../packages/contracts/program.js";
const root = process.env.TIDE_ROOT ?? "stories";
const story = loadStories(root).get("alone-against-tide@1.0.1")!;
export function allocationInput(
  input: SceneInput,
  rng: (min: number, max: number) => number,
): Record<string, number | string> {
  if (input.kind === "number") return { value: input.min };
  if (input.kind !== "allocation") throw new Error("潮汐路线工具不接受其他剧本的分配输入");
  const a = input.allocation,
    values: Record<string, number | string> = {};
  const allowed = input.skills.filter(
    (s) =>
      s.key !== "cthulhuMythos" &&
      (s.key !== "creditRating" || a.includeCredit),
  );
  if (a.kind === "attributes")
    return Object.fromEntries(allowed.map((s, i) => [s.key, a.values![i]]));
  if (a.kind === "bonus") {
    let left = a.pool!;
    while (left > 0) {
      const possible = allowed.filter(
        (s) => s.value + Number(values[s.key] ?? 0) < 99,
      );
      const skill = possible[rng(0, possible.length)];
      values[skill.key] = Number(values[skill.key] ?? 0) + 1;
      left--;
    }
    return values;
  }
  let keys =
    a.kind === "interests"
      ? []
      : [
          ...(a.required ?? []),
          ...(a.includeCredit ? ["creditRating"] : []),
          ...(a.optional?.length
            ? [a.optional[rng(0, a.optional.length)]]
            : []),
          ...(a.groups ?? []).map((g) => g[rng(0, g.length)]),
        ];
  const count = a.kind === "interests" ? (a.count ?? 4) : a.values!.length;
  while (keys.length < count) {
    const candidates = allowed.filter((s) => !keys.includes(s.key));
    keys.push(candidates[rng(0, candidates.length)].key);
  }
  keys.forEach(
    (key, i) => (values[key] = a.kind === "interests" ? 20 : a.values![i]),
  );
  for (const [key, spec] of Object.entries(a.specializations ?? {}))
    if (keys.includes(key))
      values["specialty." + key] = spec.fixed ?? "测试专长";
  return values;
}
const expected = story.nodes
  .filter((n) =>
    n.program!.some((s) => s.kind === "end" && s.collect !== false),
  )
  .map((n) => n.id);
const found = new Map<string, unknown>(),
  perRole = [new Set<string>(), new Set<string>(), new Set<string>()],
  deadEnds: unknown[] = [];
let capped = 0;
const max = Number(process.env.TIDE_ATTEMPTS ?? 12000);
for (let seed = 1; seed <= max; seed++) {
  const role = seed % 3;
  let random = seed;
  const rng = (min: number, max: number) => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return min + Math.floor(((random >>> 0) / 4294967296) * (max - min));
  };
  let draws: { min: number; max: number; value: number }[] = [];
  const dice = (min: number, max: number) => {
    const value = rng(min, max);
    draws.push({ min, max, value });
    return value;
  };
  let state = initialState(
    story,
    createCharacter("潮汐路线测试", story.presets[role], 0),
    dice,
  );
  const initialDraws = draws,
    steps: unknown[] = [];
  for (let k = 0; k < 250 && state.status === "active"; k++) {
    const scene = project(story, state, "audit", k);
    if (!scene.actions.length) {
      deadEnds.push({ seed, role, node: state.nodeId });
      break;
    }
    // Do not spend luck in most exploration: rare failures need witnesses too.
    const actions = scene.actions.filter(
      (a) => a.id !== "spend-luck" || seed % 7 === 0,
    );
    const action = actions[rng(0, actions.length)].id;
    const input = scene.input ? allocationInput(scene.input, rng) : {};
    draws = [];
    const node = state.nodeId;
    state = advance(story, state, action, dice, input).state;
    steps.push({ node, action, input, draws, resultNode: state.nodeId });
  }
  if (state.status !== "ended") {
    capped++;
    continue;
  }
  const key = `${role}:${state.nodeId}`;
  if (!found.has(key))
    found.set(key, { endingId: state.nodeId, role, seed, initialDraws, steps });
  perRole[role].add(state.nodeId);
}
const observed = new Set(perRole.flatMap((set) => [...set]));
const report = {
  storyId: story.id,
  version: story.version,
  manifestSha256: createHash("sha256")
    .update(readFileSync(`${root}/${story.id}/${story.version}/story.json`))
    .digest("hex"),
  attempts: max,
  capped,
  expectedEndings: expected,
  missing: expected.filter((id) => !observed.has(id)),
  observedByRole: perRole.map((s) => [...s].sort()),
  deadEnds,
  routes: [...found.values()],
};
mkdirSync("work/alone-against-tide", { recursive: true });
writeFileSync(
  "work/alone-against-tide/routes.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      attempts: max,
      capped,
      deadEnds,
      missing: report.missing,
      byRole: report.observedByRole.map((s) => s.length),
    },
    null,
    2,
  ),
);
