import { createHash, randomUUID } from "node:crypto";
import type { FearAction, FearStory } from "../contracts/fear.js";
import type { RunState, Story, RuleDiceResult, SceneView, CheckResult } from "../contracts/index.js";
import { initialFear, advanceFear, availableFearActions, projectFear } from "./fear.js";
import { secureDice, type DiceSource } from "../rules/index.js";
import type { FearDiceWindow } from "../contracts/fear-dice-window.js";
import { acceptFearWindowDie, canUseWitchKnots, drawFearWindowDie, evaluateFearDiceWindow, rerollFearWindowDie } from "./fear-dice-window.js";

export function asFearStory(story: Story): FearStory {
  if (!story.fear || story.rulesVersion !== "aaf-solo@1") throw new Error("剧本未声明恐惧独行规则");
  return { rulesVersion: "aaf-solo@1", nodes: story.nodes, fear: story.fear };
}
export function fearActionId(action: FearAction): string {
  return `fear-${createHash("sha256").update(JSON.stringify(action)).digest("hex")}`;
}
function recorder(dice: DiceSource, label: string) {
  const groups = new Map<number, number[]>();
  return {
    draw: (min: number, max: number) => {
      const face = dice(min, max);
      if (min !== 1 || !Number.isInteger(face) || face < min || face >= max)
        throw new Error("恐惧独行随机源返回非法骰面");
      const results = groups.get(max - 1) ?? [];
      results.push(face); groups.set(max - 1, results);
      return face;
    },
    result: (): RuleDiceResult | undefined => groups.size ? {
      label, aggregate: false,
      groups: [...groups].map(([sides, results]) => ({ sides, results })),
      total: [...groups.values()].flat().reduce((sum, face) => sum + face, 0),
      multiplier: 1, value: [...groups.values()].flat().reduce((sum, face) => sum + face, 0),
    } : undefined,
  };
}
function synchronize(state: RunState, story: Story) {
  const fear = state.fear!;
  if (fear.status !== "active") {
    const terminal = story.fear!.sceneRefs.endings[fear.status];
    if (!terminal) throw new Error(`恐惧独行缺少${fear.status}终章片段`);
    fear.nodeId = terminal;
  }
  if (state.nodeId !== fear.nodeId || !state.visitId) state.visitId = randomUUID();
  state.nodeId = fear.nodeId;
  state.status = fear.status === "active" ? "active" : "ended";
  state.character.rulesVersion = "aaf-solo@1";
  state.character.hp = Math.max(0, fear.hp); state.character.maxHp = fear.maxHp;
  state.character.sanity = Math.max(0, fear.sanity); state.character.maxSanity = fear.maxSanity;
  state.character.skills = { ...fear.skills, ...fear.arcaneSkills };
  state.character.skillNames = Object.fromEntries(Object.keys(state.character.skills).map(key => [key, story.fear!.skills[key]?.label ?? key]));
  delete state.character.attributes; delete state.character.mp; delete state.character.damageBonus;
  delete state.character.build; delete state.character.movement;
  state.character.luck = 0;
  state.inventory = Object.entries(fear.inventory).filter(([, amount]) => amount > 0).map(([key, amount]) => ({ key, label: `${story.fear!.items?.[key]?.label ?? key} × ${amount}` }));
}
export function initializeFearRun(story: Story, state: RunState, dice: DiceSource = secureDice) {
  const recorded = recorder(dice, "初始任务与食物骰");
  state.fear = initialFear(asFearStory(story), {}, recorded.draw);
  synchronize(state, story);
  state.creationDice = recorded.result();
}
export function projectFearRun(story: Story, state: RunState): Partial<SceneView> {
  const book = asFearStory(story);
  const fear = projectFear(book, state.fear!);
  if (state.fearDiceWindow) {
    const window = state.fearDiceWindow;
    const pending = window.draws.find(draw => draw.key === window.waiting.key);
    const actions = pending ? [
      { id: "fear-die-accept", label: "接受本次骰点并继续" },
      ...(canUseWitchKnots(state.fear!) ? window.visibleKeys.map((key, index) => {
        if (key.startsWith("risk:")) {
          const risk = window.risks[Number(key.slice(5))];
          return { id: `fear-die-reroll:${index}`, label: `解开一个绳结，重掷当前行动第${Number(key.slice(5)) + 1}枚理智风险D6（${risk.face}）` };
        }
        const draw = window.draws.find(draw => draw.key === key)!;
        return { id: `fear-die-reroll:${index}`, label: `解开一个绳结，重掷当前行动第${index + 1}枚D${draw.max - 1}（${draw.value}）` };
      }) : []),
    ] : [{ id: "next", label: `掷本次D${window.waiting.max - 1}` }];
    return { fear: { ...fear, pending: { kind: "witch-knot-dice", options: actions.map(action => action.id), labels: Object.fromEntries(actions.map(action => [action.id, action.label])), prompt: window.label } }, actions,
      notices: [...fear.log, "女巫绳结允许免费重掷当前正在结算的骰子；接受后才执行该骰的后果。"] };
  }
  const actions = availableFearActions(book, state.fear!).map(({ action, label, hint }) => ({ id: fearActionId(action), label, ...(hint ? { hint } : {}) }));
  return { fear, actions: actions.length === 1 ? [{ ...actions[0], id: "next" }] : actions,
    notices: fear.log,
    ...(fear.status !== "active" ? { ending: fear.status === "won" ? "关闭七道地狱之门" : fear.status === "dead" ? "生命耗尽" : "理智耗尽" } : {}),
  };
}
export function advanceFearRun(story: Story, current: RunState, actionId: string, dice: DiceSource = secureDice) {
  const book = asFearStory(story);
  if (current.fearDiceWindow) {
    const state = structuredClone(current), window = state.fearDiceWindow!;
    let action = "接受本次骰点并继续", outcome: RuleDiceResult | undefined;
    const pending = window.draws.find(draw => draw.key === window.waiting.key);
    if (actionId === "next" && !pending) {
      const face = drawFearWindowDie(window, dice);
      action = `${window.label}：掷骰`;
      outcome = { label: action, aggregate: false, groups: [{ sides: window.waiting.max - 1, results: [face] }], total: face, multiplier: 1, value: face };
    } else if (actionId === "fear-die-accept" && pending) acceptFearWindowDie(window);
    else if (/^fear-die-reroll:\d+$/.test(actionId) && pending && canUseWitchKnots(current.fear!)) {
      const index = Number(actionId.split(":")[1]), key = window.visibleKeys[index];
      const riskTarget = key?.startsWith("risk:") ? window.risks[Number(key.slice(5))] : undefined;
      const draw = window.draws.find(draw => draw.key === (riskTarget?.key ?? key));
      if (!draw) throw Object.assign(new Error("只能重掷已经公开的当前骰子"), { statusCode: 400 });
      const { face, risk } = rerollFearWindowDie(window, index, dice);
      action = "解开女巫绳结重掷";
      outcome = { label: `${action}；第二枚D6为本次新增理智风险`, aggregate: false, groups: [{ sides: riskTarget ? 6 : draw.max - 1, results: [face] }, { sides: 6, results: [risk] }], total: face + risk, multiplier: 1, value: face + risk };
    } else throw Object.assign(new Error("当前绳结结算不允许这个行动"), { statusCode: 400 });
    const evaluated = evaluateFearDiceWindow(book, window);
    state.fear = evaluated.state;
    if (evaluated.completed) delete state.fearDiceWindow;
    else { window.waiting = evaluated.waiting!; window.visibleKeys = evaluated.visibleKeys; }
    synchronize(state, story);
    return { state, action, dice: outcome, check: undefined as CheckResult | undefined, memory: story.nodes.find(node => node.id === state.nodeId)?.memory };
  }
  const actions = availableFearActions(book, current.fear!);
  const selected = actionId === "next" && actions.length === 1 ? actions[0] : actions.find(({ action }) => fearActionId(action) === actionId);
  if (!selected) throw Object.assign(new Error("当前剧情不允许这个行动"), { statusCode: 400 });
  if (canUseWitchKnots(current.fear!)) {
    const state = structuredClone(current);
    const window: FearDiceWindow = { before: structuredClone(current.fear!), action: selected.action, label: selected.label,
      draws: [], risks: [], waiting: { key: "", min: 1, max: 7 }, visibleKeys: [] };
    const evaluated = evaluateFearDiceWindow(book, window);
    state.fear = evaluated.state;
    if (!evaluated.completed) { window.waiting = evaluated.waiting!; window.visibleKeys = evaluated.visibleKeys; state.fearDiceWindow = window; }
    synchronize(state, story);
    return { state, action: selected.label, dice: undefined, check: undefined as CheckResult | undefined, memory: story.nodes.find(node => node.id === state.nodeId)?.memory };
  }
  const recorded = recorder(dice, selected.label);
  const state = structuredClone(current);
  state.fear = advanceFear(book, current.fear!, selected.action, recorded.draw);
  synchronize(state, story);
  return { state, action: selected.label, dice: recorded.result(), check: undefined as CheckResult | undefined,
    memory: story.nodes.find(node => node.id === state.nodeId)?.memory };
}
