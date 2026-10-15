/** Test-only exploration through legal public actions; no state changes or jumps. */
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import type { SceneView } from "../../packages/contracts/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";

type Draw = { min: number; max: number; value: number };
type Step = { node: string; action: string; input: Record<string, never>; draws: Draw[]; resultNode: string };
type Witness = { seed: number; endingId: string; initialDraws: Draw[]; steps: Step[] };
const manifest = resolve(process.env.FEAR_CANDIDATE ?? "work/alone-against-fear/packed-candidate", "story.json");
const story = loadFragmentStory(manifest, input => runtimeGraphSchema.parse(input), validateStory);
const startedRuntimeSha256 = runtimeFingerprint();
validateStory(story);
const maximum = Number(process.env.FEAR_ATTEMPTS ?? 300), limit = Number(process.env.FEAR_STEPS ?? 600);
const goal = process.env.FEAR_TARGET ?? "random";
if (!["random", "insane", "won", "dead"].includes(goal)) throw Error("未知路线构造目标");
if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw Error("探测次数／步数超出允许范围");
const routes = new Map<string, Witness>(), errors: unknown[] = [], seen = new Set<string>();
let capped = 0, unfinished = 0;
function select(scene: SceneView, random: (min: number, max: number) => number, seed: number) {
  const actions = scene.actions;
  if (!actions.length) throw Error("活动局没有合法动作");
  if (actions.length === 1) return actions[0];
  const fear = scene.fear!;
  const pending = fear.pending;
  if (pending?.kind === "creation-skills") {
    const desired = goal === "insane" ? ["斗士", "坚韧"] : seed % 2 ? ["斗士", "闪避"] : ["意志", "强壮"];
    return actions.find(action => desired.every(name => action.label.includes(name))) ?? actions[0];
  }
  if (pending?.kind === "creation-stats") return actions[goal === "insane" ? 3 : seed % 4];
  if (pending?.kind === "starting-area") return actions[seed % actions.length];
  const finish = goal === "dead" ? undefined : actions.find(action => /^(完成当前任务|开始下一任务|尝试关闭地狱之门)$/.test(action.label));
  if (finish) return finish;
  if (fear.combat) {
    if ((goal === "insane" || goal === "dead") && fear.combat.damageResource === "sanity") {
      const escape = actions.find(action => action.label.startsWith("逃跑"));
      if (escape) return escape;
    }
    if (goal === "dead" && pending?.kind === "injury-prevention") {
      const take = actions.find(action => action.label === "承受损失");
      if (take) return take;
    }
    const defend = actions.find(action => action.label === "防御");
    if (defend) return defend;
    const escape = actions.find(action => action.label.startsWith("逃跑"));
    if (escape && scene.character.hp <= 3 && seed % 3) return escape;
    const attack = actions.filter(action => action.label.startsWith("攻击"));
    if (attack.length) return attack[random(0, attack.length)];
  }
  if (pending) {
    if (goal === "dead" && pending.kind === "injury-prevention") {
      const scar = actions.find(action => action.label === "以永久伤残避免损失");
      if (scar) return scar;
    }
    const preserve = actions.find(action => /^(跳过下一次攻击|放弃新找到的物品|拒绝|离开|继续|通过)/.test(action.label));
    return preserve ?? actions[random(0, actions.length)];
  }
  if (seed % 3) {
    const improve = actions.find(action => /^(提升|学习)：(斗士|闪避|意志|强壮)$/.test(action.label));
    if (improve) return improve;
    const search = actions.find(action => action.label === "搜索本区域");
    if (search && random(0, 3) === 0) return search;
  }
  const newMoves = actions.filter(action => action.label.startsWith("前往") && action.hint === "未访问区域");
  if (newMoves.length) return newMoves[random(0, newMoves.length)];
  const moves = actions.filter(action => action.label.startsWith("前往") || action.label === "连接新的地图纸");
  return moves.length ? moves[random(0, moves.length)] : actions[random(0, actions.length)];
}
for (let seed = 1; seed <= maximum; seed++) {
  let stateOfRandom = seed, draws: Draw[] = [];
  let sceneForDraw: SceneView | undefined, actionForDraw: SceneView["actions"][number] | undefined;
  let combatDraw = 0;
  const rng = (min: number, max: number) => {
    stateOfRandom ^= stateOfRandom << 13; stateOfRandom ^= stateOfRandom >>> 17; stateOfRandom ^= stateOfRandom << 5;
    return min + Math.floor((stateOfRandom >>> 0) / 4294967296 * (max - min));
  };
  const dice = (min: number, max: number) => {
    let value = rng(min, max);
    if (goal !== "random" && min === 1 && max === 7 && sceneForDraw?.fear?.combat
      && /^(攻击|防御|逃跑)/.test(actionForDraw?.label ?? "")) {
      // Construct valid, repeatable combat faces; exploding sixes always terminate.
      value = goal === "insane" && sceneForDraw.fear.combat.damageResource === "sanity" ? 1
        : goal === "dead" ? 1 : combatDraw++ % 2 ? 1 : 6;
    }
    if (goal === "insane" && /恐惧|理智/.test(actionForDraw?.label ?? "") && min === 1 && max === 7) value = 1;
    if (goal === "dead" && /恐惧|理智/.test(actionForDraw?.label ?? "") && min === 1 && max === 7) value = 6;
    draws.push({ min, max, value }); return value;
  };
  let state = initialState(story, createCharacter("恐惧路线验证", story.presets[0], 0), dice);
  const initialDraws = draws, steps: Step[] = [];
  let failed = false;
  for (let index = 0; index < limit && state.status === "active"; index++) {
    const scene = project(story, state, "route-audit", index);
    seen.add(state.nodeId);
    let action: string | undefined;
    try {
      const selected = select(scene, rng, seed); action = selected.id;
      sceneForDraw = scene; actionForDraw = selected; combatDraw = 0;
      draws = [];
      const next = advance(story, state, action, dice).state;
      steps.push({ node: state.nodeId, action, input: {}, draws, resultNode: next.nodeId });
      state = next;
    } catch (error) {
      if (errors.length < 20) errors.push({ seed, step: index, node: state.nodeId, action, error: String(error), initialDraws, steps: steps.slice(),
        weaponId: state.fear?.weaponId, weaponIds: state.fear?.weaponIds, scars: state.fear?.scars, pending: state.fear?.pending, combat: state.fear?.combat, fearStatus: state.fear?.status, map: state.fear?.mapSheets, publicActions: scene.actions });
      failed = true; break;
    }
  }
  if (failed) { unfinished++; continue; }
  if (state.status !== "ended") { capped++; continue; }
  const previous = routes.get(state.nodeId);
  if (!previous || previous.steps.length > steps.length) routes.set(state.nodeId, { seed, endingId: state.nodeId, initialDraws, steps });
}
const expected = Object.values(story.fear!.sceneRefs.endings);
const output = resolve(process.env.FEAR_ROUTES ?? "work/alone-against-fear/routes.json");
const report = { format: "coc-legal-route-witness@1", storyId: story.id, version: story.version,
  runtimeSha256: startedRuntimeSha256, finishedRuntimeSha256: runtimeFingerprint(), runtimeChangedDuringSearch: startedRuntimeSha256 !== runtimeFingerprint(),
  manifestSha256: createHash("sha256").update(readFileSync(manifest)).digest("hex"), sourcePdfSha256: story.fear!.source.pdfSha256,
  goal, attempts: maximum, stepLimit: limit, seenNodes: [...seen].sort(), expected, missing: expected.filter(id => !routes.has(id)), capped, unfinished, errors, routes: [...routes.values()] };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ attempts: maximum, expected, found: [...routes.keys()], missing: report.missing, capped, unfinished, errors }, null, 2));
