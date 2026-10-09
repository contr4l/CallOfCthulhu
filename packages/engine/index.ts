import { initialProgram, projectProgram, advanceProgram } from "./program.js";
import { randomUUID } from "node:crypto";
import type {
  Character,
  Effect,
  RunState,
  SceneView,
  Story,
  StoryNode,
} from "../contracts/index.js";
import { resolveCheck, targetFor, type DiceSource } from "../rules/index.js";
export class GameError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const ENGINE_VERSION = "1.0.0";
export function getNode(story: Story, id: string): StoryNode {
  const n = story.nodes.find((n) => n.id === id);
  if (!n) throw new Error(`缺失节点 ${id}`);
  return n;
}
function effect(state: RunState, e: Effect) {
  if (e.type === "flag") state.flags[e.key] = e.value;
  else if (e.type === "hp")
    state.character.hp = Math.max(
      0,
      Math.min(state.character.maxHp, state.character.hp + e.amount),
    );
  else if (e.type === "sanity")
    state.character.sanity = Math.max(
      0,
      Math.min(99, state.character.sanity + e.amount),
    );
  else if (e.type === "item" && !state.inventory.some((i) => i.key === e.key))
    state.inventory.push({ key: e.key, label: e.label });
}
function enter(story: Story, state: RunState, id: string) {
  const node = getNode(story, id);
  state.nodeId = id;
  state.visitId = randomUUID();
  for (const e of node.enterEffects ?? []) effect(state, e);
  state.status = node.type === "ending" ? "ended" : "active";
}
export function initialState(
  story: Story,
  character: Character,
  dice?: DiceSource,
): RunState {
  const state: RunState = {
    nodeId: "",
    visitId: "",
    character: structuredClone(character),
    flags: {},
    inventory: [],
    status: "active",
  };
  if (story.rulesVersion === "coc7-solo@2") initialProgram(story, state, dice);
  else enter(story, state, story.entry);
  return state;
}
export function project(
  story: Story,
  state: RunState,
  runId: string,
  revision: number,
): SceneView {
  const node = getNode(story, state.nodeId);
  const actions =
    node.type === "ending"
      ? []
      : node.type === "check"
        ? [{ id: "roll", label: `进行${node.check!.label}检定` }]
        : node.type === "narrative"
          ? [{ id: "continue", label: "继续调查" }]
          : (node.choices ?? [])
              .filter(
                (c) =>
                  !c.condition ||
                  (state.flags[c.condition.flag] ?? false) ===
                    c.condition.equals,
              )
              .map(({ id, label, hint }) => ({ id, label, hint }));
  return {
    runId,
    storyId: story.id,
    storyTitle: story.title,
    revision,
    visitId: state.visitId,
    status: state.status,
    title: node.title,
    chapter: node.chapter,
    text: node.text,
    background: node.background,
    music: node.music,
    actions,
    character: structuredClone(state.character),
    inventory: structuredClone(state.inventory),
    ending: node.ending,
    ...(state.program ? projectProgram(story, state) : {}),
    ...(node.check
      ? {
          check: {
            label: node.check.label,
            target: targetFor(state.character, node.check),
            difficulty: node.check.difficulty,
          },
        }
      : {}),
  };
}
export function advance(
  story: Story,
  current: RunState,
  actionId: string,
  dice?: DiceSource,
  input?: Record<string, number | string>,
) {
  if (current.program)
    return advanceProgram(story, current, actionId, dice, input);
  if (current.status === "ended")
    throw new GameError(409, "本局已经结束，请开启新的调查。");
  const state = structuredClone(current),
    node = getNode(story, state.nodeId);
  let target: string;
  let action: string;
  let check;
  if (node.type === "check" && actionId === "roll") {
    check = resolveCheck(state.character, node.check!, dice);
    target = check.success ? node.check!.success : node.check!.failure;
    action = `进行${node.check!.label}检定`;
  } else if (node.type === "narrative" && actionId === "continue") {
    target = node.next!;
    action = "继续调查";
  } else {
    const choice = node.choices?.find(
      (c) =>
        c.id === actionId &&
        (!c.condition ||
          (state.flags[c.condition.flag] ?? false) === c.condition.equals),
    );
    if (!choice) throw new GameError(400, "当前剧情不允许这个行动。");
    target = choice.target;
    action = choice.label;
    for (const e of choice.effects ?? []) effect(state, e);
  }
  enter(story, state, target);
  return { state, action, check, memory: getNode(story, target).memory };
}
