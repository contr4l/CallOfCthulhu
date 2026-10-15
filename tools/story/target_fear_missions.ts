/** Build source-valid Fear mission witnesses by using only projected public actions. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import type { SceneView } from "../../packages/contracts/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";

type Draw = { min: number; max: number; value: number };
type Step = { node: string; action: string; input: Record<string, never>; draws: Draw[]; resultNode: string; label: string };
type Route = { missionId: string; initialDraws: Draw[]; steps: Step[]; completion: { node: string; status: string; missionFinished: boolean; completedMissions: string[]; xp: number; missionFood: number; gatesClosed: number; currentBoxId: string; startingBoxId: string } };
type FailureEvidence = { missionId: string; message: string; initialDraws: Draw[]; steps: Step[]; state: Record<string, unknown> };
const packageDir = resolve(process.env.FEAR_MISSION_PACKAGE ?? "work/alone-against-fear/mission-route-package");
const manifestPath = resolve(packageDir, "story.json");
const manifestBytes = readFileSync(manifestPath);
const story = loadFragmentStory(manifestPath, input => runtimeGraphSchema.parse(input), validateStory);
validateStory(story);
const startedRuntimeSha256 = runtimeFingerprint();
const routes: Route[] = [], failures: FailureEvidence[] = [];
let activeAttempt: { missionId: string; initialDraws: Draw[]; steps: Step[]; state: () => ReturnType<typeof initialState> } | undefined;

function openRun(missionId: string, initialFaces: number[]) {
  let planned = initialFaces.slice();
  let draws: Draw[] = [];
  const dice = (min: number, max: number) => {
    const face = planned.length ? planned.shift()! : min;
    assert.ok(Number.isInteger(face) && face >= min && face < max, `非法计划骰点 ${face} (${min}..${max - 1})`);
    draws.push({ min, max, value: face }); return face;
  };
  const stateAtEntry = initialState(story, createCharacter("恐惧任务路线验证", story.presets[0], 0), dice);
  assert.equal(stateAtEntry.fear?.missionId, missionId, "任务必须由开局任务表的真实D6确定");
  const initialDraws = draws.slice();
  let state = stateAtEntry;
  const steps: Step[] = [];
  activeAttempt = { missionId, initialDraws, steps, state: () => state };
  const view = () => project(story, state, `fear-mission-${missionId}`, steps.length);
  const act = (predicate: (action: SceneView["actions"][number]) => boolean, faces: number[] = []) => {
    const scene = view();
    const action = scene.actions.find(predicate);
    assert.ok(action, `未提供该合法动作；节点=${state.nodeId}; pending=${scene.fear?.pending?.kind}; actions=${scene.actions.map(value => value.label).join(" | ")}`);
    planned = faces.slice(); draws = [];
    const next = advance(story, state, action.id, dice);
    steps.push({ node: state.nodeId, action: action.id, input: {}, draws: draws.slice(), resultNode: next.state.nodeId, label: action.label });
    state = next.state;
    return view();
  };
  const byLabel = (re: RegExp, faces: number[] = []) => act(action => re.test(action.label), faces);
  const choose = (re: RegExp, faces: number[] = []) => byLabel(re, faces);
  const moveBox = (box: number, faces: number[]) => byLabel(new RegExp(`前往.*第${box}格`), faces);
  const moveToId = (id: string, faces: number[]) => {
    const box = Number(id.match(/:b(\d+)$/)?.[1]);
    assert.ok(Number.isInteger(box), `无法从地图格ID解析编号: ${id}`);
    return moveBox(box, faces);
  };
  const setup = (skills: RegExp, startEquipmentFaces: number[], wantedWeapon?: RegExp) => {
    choose(/生命\+3/);
    choose(skills);
    const startAt = steps.length;
    choose(/第1张地图·第1格/, startEquipmentFaces);
    let equipFaces = startEquipmentFaces.slice(steps[startAt].draws.length);
    if (view().fear?.pending?.kind === "source-choice") {
      choose(wantedWeapon ?? /棒球棒/, equipFaces);
      equipFaces = [];
    }
    // Any further pending creation/table choices are resolved through their public menu.
    for (let count = 0; view().fear?.pending && count < 6; count++) {
      const pending = view().fear!.pending!;
      if (pending.kind === "creation-stats") choose(/生命\+3/);
      else if (pending.kind === "creation-skills") choose(skills);
      else if (pending.kind === "starting-area") choose(/第1张地图·第1格/);
      else if (pending.kind === "source-choice") choose(wantedWeapon ?? /棒球棒/, equipFaces);
      else throw new Error(`建卡遇到未处理的公开选择: ${pending.kind}`);
      equipFaces = [];
    }
    assert.equal(view().fear?.pending, undefined, "开局公开建卡必须完整结束");
    assert.equal(state.fear?.currentBoxId, state.fear?.startingBoxId);
  };
  return { state: () => state, view, act, byLabel, choose, moveBox, moveToId, setup, initialDraws, steps, dice };
}

function complete(route: ReturnType<typeof openRun>, missionId: string) {
  const state = route.state();
  assert.equal(state.fear?.missionFinished, true, `任务${missionId}尚未完成`);
  assert.equal(state.status, "active", "任务见证应完成任务而非跳过后续战役入口");
  routes.push({ missionId, initialDraws: route.initialDraws, steps: route.steps, completion: {
    node: state.nodeId, status: state.status, missionFinished: state.fear?.missionFinished ?? false,
    completedMissions: [...(state.fear?.completedMissions ?? [])], xp: state.fear?.xp ?? 0,
    missionFood: state.fear?.missionFood ?? 0, gatesClosed: state.fear?.gatesClosed ?? 0,
    currentBoxId: state.fear?.currentBoxId ?? "", startingBoxId: state.fear?.startingBoxId ?? "",
  } });
}

function mission1() {
  const r = openRun("1", [1, 1]);
  r.setup(/斗士 \+ 坚韧/, [1, 1, 1, 1, 1, 1], /棒球棒/);
  for (const box of [2, 3, 4]) {
    r.moveBox(box, [1, 2]); // Town 3: source choice Military Installation or Clinic.
    r.choose(/诊所表/, [2, 1]); // Clinic helpful paramedic; mission dose D6 succeeds.
    assert.ok((r.state().fear?.inventory["medicine-dose"] ?? 0) >= Math.min(box - 1, 3));
  }
  for (const box of [3, 2, 1]) r.moveBox(box, [6]);
  assert.equal(r.state().fear?.inventory["medicine-dose"], 3);
  r.byLabel(/^完成当前任务$/);
  complete(r, "1");
}

function mission3() {
  const r = openRun("3", [3, 1, 1, 1]); // Target 2D6+12 is the printed minimum 14.
  r.setup(/(?=.*强壮)(?=.*调查员)/, [1, 2, 6, 1, 4], /棒球棒/); // Backpacks from source random-item tables.
  assert.ok((r.state().fear?.inventory.backpack ?? 0) >= 1, "开局来源掷得背包；未预设容量");
  for (const box of [2, 3, 4]) {
    r.moveBox(box, [1, 5, 2, 1, 6]); // Street, quiet, successful D6 food find, D6 quantity.
    assert.equal(r.state().fear?.missionFood, (box - 1) * 6);
  }
  assert.ok((r.state().fear?.missionFood ?? 0) >= 14);
  for (const box of [3, 2, 1]) r.moveBox(box, [6]);
  r.byLabel(/^完成当前任务$/);
  r.choose(/获得经验/, []);
  complete(r, "3");
}

function mission4() {
  const r = openRun("4", [4, 1]);
  // Random Weapon table roll 4 grants a shotgun; its source ammo dice are rolled normally.
  r.setup(/斗士 \+ 坚韧/, [4, 6, 6, 2, 6, 6, 1], /棒球棒/);
  assert.ok(r.state().fear?.weaponIds.some(id => ["pistol", "rifle", "shotgun"].includes(id)));
  assert.ok(r.state().fear?.weaponIds.some(id => ["pistol", "rifle", "shotgun"].includes(id) && (r.state().fear?.ammo[id] ?? 0) >= 6), JSON.stringify({ ammo: r.state().fear?.ammo, weapons: r.state().fear?.weaponIds }));
  r.moveBox(2, [1, 5, 2]); // Explore a new town box before bringing the firearm home.
  r.moveBox(1, [6]);
  assert.ok(r.view().actions.some(action => action.label === "完成当前任务"), JSON.stringify({ mission: r.state().fear?.missionId, finished: r.state().fear?.missionFinished, current: r.state().fear?.currentBoxId, start: r.state().fear?.startingBoxId, weapons: r.state().fear?.weaponIds, ammo: r.state().fear?.ammo, progress: r.state().fear?.missionProgress, rules: r.state().fear?.missionRules }));
  r.byLabel(/^完成当前任务$/);
  complete(r, "4");
}

function mission5() {
  const r = openRun("5", [5, 6]);
  r.setup(/斗士 \+ 意志/, [2, 1, 1, 1, 1], /电锯/);
  if (r.state().fear?.weaponId !== "chainsaw") r.byLabel(/^装备：电锯$/);
  assert.equal(r.state().fear?.weaponId, "chainsaw");
  // Walk a source-legal Hamilton path through all 30 adjacent map boxes. The last five new
  // locations trigger the mission's printed automatic witch encounters.
  const path = [1,2,3,4,5,10,9,8,7,6,11,12,13,14,15,20,19,18,17,16,21,22,23,24,25,30,29,28,27,26];
  for (const [index, box] of path.slice(1).entries()) {
    r.moveBox(box, [1,5,2]); // Town 6 -> Street; Street 2 -> quiet. No direct map mutation.
    const pending = r.view().fear?.pending;
    if (pending?.kind === "mission-witch-find") {
      r.choose(/花费0条线索/, [6]); // No clue spent; D6=6 is the non-surprise result on the printed 5/6.
      let turns = 0;
      while (r.view().fear?.combat) {
        assert.ok(turns++ < 6, "女巫战斗超过预期");
        const attack = r.view().actions.find(action => action.label.startsWith("攻击"));
        if (attack) r.act(action => action.label === attack.label, [5, 5, 6, 1, 6, 1, 6, 1]);
        else r.byLabel(/^防御$/, [5, 1]);
      }
    }
  }
  assert.equal(r.state().fear?.missionProgress.witchesResolved, 5);
  if (r.view().fear?.pending?.kind === "mission-witch-final-item") {
    const labels = r.view().actions.map(action => action.label);
    assert.ok(labels.length === 3 && new Set(labels).size === 1, `三次来源掷得相同的最终物品，任一选择均为最佳同值结果: ${labels.join(" / ")}`);
    r.act(() => true, []);
  }
  assert.equal(r.state().fear?.missionFinished, true, "第五名女巫及来源奖励结算后任务自动完成");
  complete(r, "5");
}

function mission2() {
  const r = openRun("2", [2, 6, 1]); // Real target-table roll selects the printed first slasher.
  r.setup(/斗士 \+ 坚韧/, [2, 1, 1, 1, 1], /电锯/);
  if (r.state().fear?.weaponId !== "chainsaw") r.byLabel(/^装备：电锯$/);
  // The selected target's printed level is paid with clues found through successful public searches.
  const level = r.state().fear?.missionRules?.hunt.targetLevel ?? 0;
  assert.ok(level > 0 && level <= 6);
  for (let index = 0; index < level; index++) {
    if (index > 0) r.moveBox(index + 1, [1, 5, 2]);
    r.byLabel(/^搜索本区域$/, [6, 1, 6]);
    assert.ok(r.view().fear?.pending?.kind === "search-success", `搜索未成功提供公开线索选项 ${index + 1}`);
    r.choose(/线索/, []);
  }
  r.byLabel(/^花费线索定位目标杀手$/);
  const nextBox = level + 1;
  r.moveBox(nextBox, []);
  let turns = 0;
  while (r.view().fear?.combat) {
    assert.ok(turns++ < 20, "目标杀手战斗超过预期");
    const attack = r.view().actions.find(action => action.label.startsWith("攻击"));
    if (attack) r.act(action => action.label === attack.label, [5, 5, 6, 1, 6, 1, 6, 1]);
    else r.byLabel(/^防御$/, [5, 1]);
  }
  for (const box of Array.from({ length: nextBox - 1 }, (_, index) => nextBox - 1 - index)) r.moveBox(box, [6]);
  assert.ok(r.state().fear?.missionProgress.targetDefeated || r.state().fear?.missionRules?.hunt.targetDefeated,
    JSON.stringify({ targetId: r.state().fear?.missionRules?.hunt.targetId, targetDefeated: r.state().fear?.missionRules?.hunt.targetDefeated, progress: r.state().fear?.missionProgress, completed: r.state().fear?.completedMissions }));
  r.byLabel(/^完成当前任务$/);
  r.choose(/获得经验/, []);
  complete(r, "2");
}

function mission6() {
  const r = openRun("6", [6, 6]);
  r.setup(/斗士 \+ 坚韧/, [1, 1, 1, 1, 1], /棒球棒/);
  r.moveBox(2, [4, 4]);
  r.choose(/商店表/, [5, 6, 1, 4, 6, 1]);
  for (let index = 0; index < 2; index++) {
    const box = index === 0 ? 3 : 8;
    r.moveBox(box, [3, 3, 3, 1, 1, 1]);
    let turns = 0;
    while (r.view().fear?.combat) {
      assert.ok(turns++ < 15, "经验战斗超过预期");
      const attack = r.view().actions.find(action => action.label.startsWith("攻击"));
      if (attack) r.act(action => action.id === attack.id, [5, 6, 6, 6, 6, 6, 6, 6]);
      else r.byLabel(/^防御$/, [5, 6]);
    }
  }
  r.byLabel(/研读.*学习门/, [1]);
  r.moveBox(9, [3, 6, 6, 6]);
  r.byLabel(/^尝试关闭地狱之门$/, [6, 1]);
  assert.ok((r.state().fear?.gatesClosed ?? 0) >= 1, JSON.stringify({ gates: r.state().fear?.gatesClosed, current: r.state().fear?.currentBoxId, gateHere: r.state().fear?.missionProgress.gateHere, pending: r.state().fear?.pending, log: r.state().fear?.log.slice(-8) }));
  assert.ok((r.state().fear?.gatesClosed ?? 0) >= 1, "既有合法七门路线前缀未关闭首道门");
  assert.equal(r.state().fear?.missionFinished, true, "关闭本任务所要求的第一道门后任务自动完成");
  complete(r, "6");
}

for (const [mission, fn] of [["1", mission1], ["2", mission2], ["3", mission3], ["4", mission4], ["5", mission5], ["6", mission6]] as const) {
  try { fn(); }
  catch (error) {
    const state = activeAttempt?.state();
    failures.push({ missionId: mission, message: String(error), initialDraws: activeAttempt?.initialDraws ?? [], steps: activeAttempt?.steps ?? [], state: {
      nodeId: state?.nodeId, status: state?.status, missionId: state?.fear?.missionId, missionFinished: state?.fear?.missionFinished,
      completedMissions: state?.fear?.completedMissions, currentBoxId: state?.fear?.currentBoxId, startingBoxId: state?.fear?.startingBoxId,
      targetId: state?.fear?.missionRules?.hunt.targetId, targetDefeated: state?.fear?.missionRules?.hunt.targetDefeated,
      weaponIds: state?.fear?.weaponIds, ammo: state?.fear?.ammo, gatesClosed: state?.fear?.gatesClosed,
      combatResult: state?.fear?.combatResult, defeated: state?.fear?.defeated,
      recentLog: state?.fear?.log.slice(-8), missionProgress: state?.fear?.missionProgress,
    } });
  }
}
const report = {
  format: "fear-public-mission-route-witnesses@1", storyId: story.id, storyVersion: story.version,
  sourcePdfSha256: story.fear!.source.pdfSha256,
  manifestPath: relative(process.cwd(), manifestPath),
  manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  runtimeSha256: startedRuntimeSha256, finishedRuntimeSha256: runtimeFingerprint(),
  runtimeChangedDuringSearch: startedRuntimeSha256 !== runtimeFingerprint(),
  sourceBasis: [
    "scripts/alone-against-fear/fragments/section-how-the-game-works.json: p1 (PDF p.37), campaign mission creation/continuation",
    "scripts/alone-against-fear/fragments/section-mission.json: p1 (PDF p.40), mission D6, reroll previous mission, seven-gate campaign victory",
    "scripts/alone-against-fear/fragments/section-mission-table.json: p1-p3 (PDF p.40), missions 1-3",
    "scripts/alone-against-fear/fragments/section-mission-table-continued.json: p1-p3 (PDF p.41), missions 4-6",
    "scripts/alone-against-fear/fragments/section-game-overview.json: p2-p8 (PDF p.102), public setup, map movement, search, return-home flow",
    "Each selected action ID is read from project(); all state progression uses advance() with recorded legal D6 outcomes; no direct state, HP, inventory, or mission-ID mutation.",
  ],
  routeCount: routes.length, coveredMissionIds: routes.map(route => route.missionId), missingMissionIds: ["1","2","3","4","5","6"].filter(id => !routes.some(route => route.missionId === id)),
  failures, routes,
};
const output = resolve(process.env.FEAR_MISSION_ROUTES ?? "work/alone-against-fear/mission-witnesses.json");
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ routeCount: report.routeCount, covered: report.coveredMissionIds, missing: report.missingMissionIds, failures: report.failures, runtimeChanged: report.runtimeChangedDuringSearch }, null, 2));
