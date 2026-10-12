import { readFileSync, writeFileSync } from "node:fs";
import { loadStories } from "../../apps/api/src/catalog.js";
import { targets } from "../../apps/api/src/program-schema.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";

const story = loadStories("stories").get("alone-against-static@1.2.0")!;
const goal = process.argv[2] ?? "365";
const reverse = new Map<string, Set<string>>();
for (const node of story.nodes) {
  for (const step of node.program!) {
    const edges = targets([step]).filter((id) => !id.startsWith("$"));
    if (goal === "334" && JSON.stringify(step).includes('"field":"sanity"'))
      edges.push("329");
    for (const target of edges) {
      const from = reverse.get(target) ?? new Set<string>();
      from.add(node.id);
      reverse.set(target, from);
    }
  }
}
function distances(target: string) {
  const values = new Map([[target, 0]]),
    queue = [target];
  for (let i = 0; i < queue.length; i++) {
    for (const from of reverse.get(queue[i]) ?? [])
      if (!values.has(from)) {
        values.set(from, values.get(queue[i])! + 1);
        queue.push(from);
      }
  }
  return values;
}
const targetDistances = distances(goal),
  ironDistances = distances("361");
const goalMaps = new Map(
  ["361", "73", "59", "315", "365"].map((id) => [id, distances(id)]),
);
for (let seed = 1; seed <= 200; seed++) {
  let random = seed;
  const rng = (min: number, max: number) => {
    random ^= random << 13;
    random ^= random >>> 17;
    random ^= random << 5;
    return min + Math.floor(((random >>> 0) / 4294967296) * (max - min));
  };
  const role =
      process.env.COC_TARGET_ROLE === undefined
        ? seed % 2
        : Number(process.env.COC_TARGET_ROLE),
    luckDice = [6, 6, 6],
    initialDraws: never[] = [];
  let state = initialState(
    story,
    createCharacter("定向结局测试", story.presets[role], 90),
  );
  const steps = [];
  for (let i = 0; i < 200 && state.status === "active"; i++) {
    const scene = project(story, state, "test", i);
    if (!scene.actions.length) throw new Error(`dead ${state.nodeId}`);
    const options = [];
    const selected: Record<string, string> = {
      "187": "to-188",
      "188": "to-189",
      "199": "to-200",
      "186": "to-208",
      "208": "to-209",
      "209": "to-217",
      "217": "to-219",
      "218": "to-219",
      "241": "optional-243",
      "243": "to-253",
      "302": "to-303",
      "304": "to-314",
      "314": "to-315",
      "315": "to-317",
      "281": "to-248",
      "344": "to-348",
    };
    for (const action of scene.actions)
      for (const mode of ["random", "pass", "fail", "stress"]) {
        if (goal === "334") {
          if (
            scene.actions.some((a) => a.id === selected[state.nodeId]) &&
            action.id !== selected[state.nodeId]
          )
            continue;
          if (scene.check) {
            const required =
              scene.check.label === "理智"
                ? "stress"
                : ["95", "298"].includes(state.nodeId)
                  ? "fail"
                  : "pass";
            if (mode !== required) continue;
          }
          if (
            state.nodeId === "95" &&
            scene.actions.some((a) => a.id === "accept") &&
            action.id !== "accept"
          )
            continue;
        }
        const draws: { min: number; max: number; value: number }[] = [];
        let count = 0;
        const dice = (min: number, max: number) => {
          let value = rng(min, max);
          if (max === 10 && min === 0 && mode !== "random") {
            const pass =
              mode === "pass" ||
              (mode === "stress" && scene.check?.label !== "理智");
            value = pass ? (count++ === 0 ? 1 : 0) : 9;
          } else if (mode === "stress") value = max - 1;
          draws.push({ min, max, value });
          return value;
        };
        const result = advance(story, state, action.id, dice).state;
        let distance =
          goal === "365" && !result.flags["时间之铁"]
            ? ironDistances
            : targetDistances;
        let milestone = 0;
        if (goal === "334") {
          const stages = [
            ["时间之铁", "361"],
            ["小屋中的伴侣", "73"],
            ["傍晚时的寂静", "59"],
          ];
          const nextStage = stages.find(([flag]) => !result.flags[flag]);
          milestone = stages.filter(([flag]) => result.flags[flag]).length;
          const woods =
            !result.program!.visits["315"] &&
            Number(result.nodeId.split("-")[0]) >= 223;
          distance = goalMaps.get(nextStage?.[1] ?? (woods ? "315" : "365"))!;
        }
        const symptoms = ["330", "331", "332", "333"].filter(
          (id) => result.program!.visits[id],
        ).length;
        const score =
          result.status === "ended"
            ? result.nodeId === goal
              ? -100000
              : 100000
            : goal === "334"
              ? -milestone * 10000 -
                symptoms * 1000 -
                (milestone === 3
                  ? (story.presets[role].sanity - result.character.sanity) * 100
                  : 0) +
                (distance.get(
                  [
                    "325",
                    "328",
                    "329",
                    "329-die",
                    "330",
                    "331",
                    "332",
                    "333",
                  ].includes(result.nodeId)
                    ? (result.program!.returns.at(-1)?.nodeId ?? result.nodeId)
                    : result.nodeId,
                ) ?? 100) *
                  10 +
                (result.program!.visits[result.nodeId] ?? 0) * 2 -
                (result.program!.used["186-208"] ? 3000 : 0) -
                (result.program!.visits["315"] ? 3000 : 0)
              : (distance.get(result.nodeId) ?? 100) * 10 +
                (result.program!.visits[result.nodeId] ?? 0) * 4 -
                (result.flags["时间之铁"] ? 10000 : 0) +
                (result.flags["临阵磨刀"] ? 5000 : 0);
        options.push({
          action: action.id,
          draws,
          result,
          score: score + rng(0, 10) / 10,
        });
      }
    options.sort((a, b) => a.score - b.score);
    const choice = options[0];
    steps.push({
      node: state.nodeId,
      action: choice.action,
      draws: choice.draws,
      resultNode: choice.result.nodeId,
    });
    state = choice.result;
  }
  if (state.nodeId === goal && state.status === "ended") {
    const path = "tests/browser/fixtures/static-endings.json";
    const report = JSON.parse(readFileSync(path, "utf8"));
    const witness = {
      endingId: goal,
      role,
      seed,
      search: "legal-state-guided",
      luckDice,
      initialDraws,
      steps,
    };
    report.perRoleRoutes ??= report.routes.slice();
    if (
      !report.perRoleRoutes.some(
        (r: { endingId: string; role: number }) =>
          r.endingId === goal && r.role === role,
      )
    )
      report.perRoleRoutes.push(witness);
    if (!report.routes.some((r: { endingId: string }) => r.endingId === goal)) {
      report.routes.push({
        endingId: goal,
        role,
        seed,
        search: "legal-state-guided",
        luckDice,
        initialDraws,
        steps,
      });
      report.routes.sort(
        (a: { endingId: string }, b: { endingId: string }) =>
          Number(a.endingId) - Number(b.endingId),
      );
      report.missing = report.missing.filter((id: string) => id !== goal);
      report.observedByRole[role] = [
        ...new Set([...report.observedByRole[role], goal]),
      ];
    }
    report.observedByRole[role] = [
      ...new Set([...report.observedByRole[role], goal]),
    ];
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    console.log(
      `reached ${goal}: role ${role}, seed ${seed}, ${steps.length} commands`,
    );
    process.exit(0);
  }
  if (seed % 20 === 0) console.log(seed, state.nodeId, state.character.sanity);
}
throw new Error(`No legal route found for ${goal}`);
