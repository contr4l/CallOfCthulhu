/** Source-bound victory construction through legal actions and valid saved dice. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";
type Draw = { min: number; max: number; value: number };
type Step = { node: string; action: string; input: Record<string, never>; draws: Draw[]; resultNode: string };
const candidate = resolve(process.env.FEAR_CANDIDATE ?? "work/alone-against-fear/packed-candidate");
const manifest = readFileSync(resolve(candidate, "story.json"));
const story = loadFragmentStory(resolve(candidate, "story.json"), input => runtimeGraphSchema.parse(input), validateStory);
validateStory(story);
const startedRuntimeSha256 = runtimeFingerprint();
let planned = [6, 6], draws: Draw[] = [];
const dice = (min: number, max: number) => {
  const face = planned.shift() ?? min;
  assert.ok(Number.isInteger(face) && face >= min && face < max, `非法计划骰点 ${face} (${min}..${max - 1})`);
  draws.push({ min, max, value: face }); return face;
};
let state = initialState(story, createCharacter("七门路线验证", story.presets[0], 0), dice);
const initialDraws = draws, steps: Step[] = [];
const view = () => project(story, state, "route-construction", steps.length);
function act(label: RegExp | ((label: string) => boolean), faces: number[] = []) {
  const scene = view();
  const selected = scene.actions.find(action => typeof label === "function" ? label(action.label) : label.test(action.label));
  assert.ok(selected, `未提供该合法动作 ${String(label)}；${JSON.stringify({ node: state.nodeId, pending: scene.fear?.pending, actions: scene.actions.map(action => action.label) })}`);
  planned = faces.slice(); draws = [];
  const result = advance(story, state, selected.id, dice);
  steps.push({ node: state.nodeId, action: selected.id, input: {}, draws, resultNode: result.state.nodeId });
  state = result.state;
  if (process.env.FEAR_ROUTE_DEBUG) console.log(JSON.stringify({ action: selected.label, draws, pending: view().fear?.pending, combat: view().fear?.combat, xp: state.fear?.xp }));
}
function move(faces: number[]) {
  const scene = view(), next = scene.actions.find(action => action.label.startsWith("前往") && action.hint === "未访问区域");
  assert.ok(next, "没有尚未探索的相邻区域"); act(label => label === next.label, faces);
}
function fightZombies() {
  let count = 0;
  while (view().fear?.combat) {
    assert.ok(count++ < 30, "本次来源战斗超过预期步数");
    const label = view().actions.find(action => action.label.startsWith("攻击"))?.label ?? "防御";
    act(value => value === label, label === "防御" ? [6, 6, 6, 6] : [6, 1]);
  }
}
// Creation: source 8/8 plus three Life, Fighter and Tough, first map box.
act(/生命\+3/, [1]);
act(label => label.includes("斗士") && label.includes("坚韧"), [1]);
act(label => label.includes("第1格"), [1]);
if (view().fear?.pending) act(/棒球棒|baseball/, [1, 1, 1, 1, 1]);
assert.equal(view().fear?.currentBox.id, "s1:b1");

// Town 4+4→Store, Store 5; find Holy Book, then pass the bookstore 3/6 follow-up encounter roll (4+ avoids it).
move([4, 4]); act(/商店|store/, [5, 6, 1, 4, 6, 1]);
assert.equal(state.fear!.inventory["holy-book"], 1);
// Two source Street→Undead→two Zombies encounters yield the printed 1 XP each.
for (let index = 0; index < 2; index++) { move([3, 3, 3, 1, 1, 1]); fightZombies(); }
assert.equal(state.fear!.xp, 2);
const positionBeforeStudy = state.fear!.currentBoxId, movementBeforeStudy = state.fear!.visitCount;
act(/研读.*学习门/, [1]);
assert.equal(state.fear!.arcaneSkills.gate, 1); assert.equal(state.fear!.xp, 0);
assert.equal(state.fear!.currentBoxId, positionBeforeStudy); assert.equal(state.fear!.visitCount, movementBeforeStudy);

// Town 3+6→Sewers, Sewers 6→Hell Gate; the guardian 3/6 roll of 6 yields no guard.
for (let gate = 1; gate <= 7; gate++) {
  move([3, 6, 6, 6]); act(/尝试关闭地狱之门/, [6, 1]); assert.equal(state.fear!.gatesClosed, gate);
}
assert.equal(state.status, "ended"); assert.equal(state.fear!.status, "won");
const output = resolve(process.env.FEAR_ROUTES ?? "work/alone-against-fear/root-victory-route.json");
const expected = Object.values(story.fear!.sceneRefs.endings);
const report = { format: "coc-legal-route-witness@1", storyId: story.id, version: story.version,
  runtimeSha256: startedRuntimeSha256, finishedRuntimeSha256: runtimeFingerprint(), runtimeChangedDuringSearch: startedRuntimeSha256 !== runtimeFingerprint(),
  manifestSha256: createHash("sha256").update(manifest).digest("hex"), sourcePdfSha256: story.fear!.source.pdfSha256,
  expected, missing: expected.filter(id => id !== state.nodeId), routes: [{ seed: 0, endingId: state.nodeId, initialDraws, steps }],
  basis: ["creation source pp8-15", "Town Exploration p42", "Store5 p54", "Undead1 p62", "XP p11", "Gate p17", "Sewers6 p52", "campaign7 gates p37/41"] };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ endingId: state.nodeId, steps: steps.length, gatesClosed: state.fear!.gatesClosed, manifestSha256: report.manifestSha256 }));
