import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { loadStories } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { narrativeText } from "../../packages/engine/program.js";
import { createCharacter } from "../../packages/rules/index.js";
import type { Story, SceneView } from "../../packages/contracts/index.js";

type Draw = { min: number; max: number; value: number };
type Step = {
  node: string;
  action: string;
  input?: Record<string, number | string>;
  draws?: Draw[];
  resultNode?: string;
};
type Witness = {
  endingId: string;
  role: number;
  initialDraws: Draw[];
  luckDice?: number[];
  steps: Step[];
};
const stories = loadStories("stories");
const settings = {
  chineseCharsPerMinute: [300, 500],
  englishWordsPerMinute: [150, 220],
  nextSeconds: [2, 4],
  decisionSeconds: [8, 20],
  diceSeconds: [8, 18],
  allocationMinutes: [2, 5],
  setupMinutes: [2, 5],
};
function volume(text: string) {
  return {
    chineseChars: (text.match(/\p{Script=Han}/gu) ?? []).length,
    englishWords: (text.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) ?? []).length,
  };
}
function percentile(values: number[], q: number) {
  const a = values.slice().sort((a, b) => a - b);
  return a[Math.round((a.length - 1) * q)];
}
function corpus(story: Story) {
  const texts = new Set(
    story.nodes.map((n) =>
      narrativeText(n.reading?.["zh-CN"]?.text ?? n.text).join("\n"),
    ),
  );
  return { uniqueTextBlocks: texts.size, ...volume([...texts].join("\n")) };
}
function measure(story: Story, witness: Witness, name?: string) {
  let draws = witness.initialDraws.slice(),
    current: SceneView,
    action = "",
    firstLossDone = false;
  let combatDice = [1, 2, 1, 1, 1, 1];
  const failNodes =
    name === "death"
      ? ["65"]
      : ["map", "combat"].includes(name ?? "")
        ? ["110", "133", "65"]
        : [];
  const dice = (min: number, max: number) => {
    if (!name) {
      const d = draws.shift();
      assert.ok(d, `missing draw ${story.id}`);
      assert.equal(d.min, min);
      assert.equal(d.max, max);
      assert.ok(Number.isInteger(d.value) && d.value >= min && d.value < max);
      return d.value;
    }
    if (failNodes.includes(current?.collection?.chapterId ?? "") && max === 10)
      return 9;
    if (
      ["map", "combat"].includes(name) &&
      !firstLossDone &&
      current?.combat?.name === "黑熊" &&
      action === "attack"
    )
      return combatDice.shift() ?? min;
    return max === 10 ? 1 : min;
  };
  let state = initialState(
    story,
    createCharacter(
      "时长统计",
      story.presets[witness.role],
      (witness.luckDice?.reduce((a, b) => a + b, 0) ?? 0) * 5,
    ),
    dice,
  );
  assert.equal(draws.length, 0);
  let previous = "",
    zh = 0,
    en = 0,
    englishRouteWords = 0,
    narrativeViews = 0,
    decisions = 0,
    diceActions = 0,
    allocations = 0;
  const record = (scene: SceneView) => {
    const body = (scene.reading?.["zh-CN"]?.text ?? scene.text).join("\n");
    if (body === previous) return;
    previous = body;
    const v = volume(body);
    zh += v.chineseChars;
    en += v.englishWords;
    englishRouteWords += volume(
      (scene.reading?.en?.text ?? []).join("\n"),
    ).englishWords;
    narrativeViews++;
  };
  current = project(story, state, "estimate", 0);
  record(current);
  for (const [i, step] of witness.steps.entries()) {
    assert.equal(state.nodeId, step.node);
    action = step.action;
    if (current.input?.kind === "allocation") allocations++;
    else if (current.actions.length > 1) decisions++;
    if (!name) draws = step.draws!.slice();
    const result = advance(story, state, step.action, dice, step.input);
    if (result.check || result.dice) diceActions++;
    if (
      name &&
      current?.combat?.name === "黑熊" &&
      action === "attack" &&
      !combatDice.length
    )
      firstLossDone = true;
    state = result.state;
    if (step.resultNode) assert.equal(state.nodeId, step.resultNode);
    assert.equal(draws.length, 0);
    current = project(story, state, "estimate", i + 1);
    record(current);
  }
  assert.equal(state.status, "ended");
  if (!name) assert.equal(state.nodeId, witness.endingId);
  const navigation = witness.steps.length - allocations;
  const minutes = [
    zh / settings.chineseCharsPerMinute[1] +
      en / settings.englishWordsPerMinute[1] +
      (navigation * settings.nextSeconds[0]) / 60 +
      (decisions * settings.decisionSeconds[0]) / 60 +
      (diceActions * settings.diceSeconds[0]) / 60 +
      allocations * settings.allocationMinutes[0] +
      settings.setupMinutes[0],
    zh / settings.chineseCharsPerMinute[0] +
      en / settings.englishWordsPerMinute[0] +
      (navigation * settings.nextSeconds[1]) / 60 +
      (decisions * settings.decisionSeconds[1]) / 60 +
      (diceActions * settings.diceSeconds[1]) / 60 +
      allocations * settings.allocationMinutes[1] +
      settings.setupMinutes[1],
  ].map((n) => Math.round(n * 10) / 10);
  return {
    route: name ?? `${witness.role}:${witness.endingId}`,
    endingId: state.nodeId,
    role: witness.role,
    chineseChars: zh,
    mixedEnglishWords: en,
    englishRouteWords,
    narrativeViews,
    actions: witness.steps.length,
    decisions,
    diceActions,
    allocations,
    minutes,
  };
}
const reports = [];
for (const [id, version, fixture] of [
  ["alone-against-flames", "1.1.0", "flames-routes"],
  ["alone-against-static", "1.2.0", "static-endings"],
  ["alone-against-tide", "1.0.1", "tide-endings"],
]) {
  const story = stories.get(`${id}@${version}`)!;
  assert.ok(story);
  const manifestSha256 = createHash("sha256")
    .update(readFileSync(`stories/${id}/${version}/story.json`))
    .digest("hex");
  const raw = JSON.parse(
    readFileSync(`tests/browser/fixtures/${fixture}.json`, "utf8"),
  );
  let routes: ReturnType<typeof measure>[];
  if (id === "alone-against-flames")
    routes = Object.entries(raw).map(([name, steps]) =>
      measure(
        story,
        { role: 0, endingId: "", initialDraws: [], steps: steps as Step[] },
        name,
      ),
    );
  else {
    assert.equal(
      raw.manifestSha256,
      manifestSha256,
      "route witnesses must match the published manifest",
    );
    routes = (raw.perRoleRoutes ?? raw.routes).map((w: Witness) =>
      measure(story, w),
    );
  }
  reports.push({
    storyId: id,
    version,
    title: story.title,
    manifestSha256,
    corpus: corpus(story),
    routeCount: routes.length,
    duration: `约 ${Math.round(Math.min(...routes.map((r) => r.minutes[0])) / 5) * 5}–${Math.ceil(Math.max(...routes.map((r) => r.minutes[1])) / 5) * 5} 分钟`,
    range: {
      chineseChars: [
        Math.min(...routes.map((r) => r.chineseChars)),
        Math.max(...routes.map((r) => r.chineseChars)),
      ],
      minutes: [
        Math.min(...routes.map((r) => r.minutes[0])),
        Math.max(...routes.map((r) => r.minutes[1])),
      ],
    },
    middle80: {
      chineseChars: [
        percentile(
          routes.map((r) => r.chineseChars),
          0.1,
        ),
        percentile(
          routes.map((r) => r.chineseChars),
          0.9,
        ),
      ],
      minutes: [
        percentile(
          routes.map((r) => r.minutes[0]),
          0.1,
        ),
        percentile(
          routes.map((r) => r.minutes[1]),
          0.9,
        ),
      ],
    },
    routes,
  });
}
const output = JSON.stringify({ settings, reports }, null, 2) + "\n";
const path = "docs/playtime-estimates.json";
const catalogPath = "apps/api/src/modules/playtime-estimates.json";
const catalog =
  JSON.stringify(
    reports.map(({ storyId, version, duration }) => ({
      storyId,
      version,
      duration,
    })),
    null,
    2,
  ) + "\n";
if (process.argv.includes("--check")) {
  assert.equal(
    readFileSync(path, "utf8"),
    output,
    "re-run npm run story:playtime after content or route changes",
  );
  assert.equal(
    readFileSync(catalogPath, "utf8"),
    catalog,
    "catalog estimates must match the report",
  );
} else {
  writeFileSync(path, output);
  writeFileSync(catalogPath, catalog);
}
for (const { routes, ...summary } of reports)
  console.log(JSON.stringify(summary));
