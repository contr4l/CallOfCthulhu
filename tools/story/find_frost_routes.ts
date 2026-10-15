/** Explore the isolated Frost candidate only through public actions and legal inputs. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadFragmentStory } from "../../apps/api/src/modules/story-fragments.js";
import { runtimeGraphSchema, validateStory } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import type { SceneInput } from "../../packages/contracts/program.js";
import { runtimeFingerprint } from "./runtime-fingerprint.js";
const candidate = resolve(process.env.FROST_CANDIDATE ?? "work/alone-against-frost/preview/alone-against-frost/1.0.47-candidate");
const manifest = readFileSync(resolve(candidate, "story.json"));
const story = loadFragmentStory(resolve(candidate, "story.json"), value => runtimeGraphSchema.parse(value), validateStory);
const startedRuntimeSha256 = runtimeFingerprint();
const attempts = Number(process.env.FROST_ATTEMPTS ?? 200), limit = Number(process.env.FROST_STEPS ?? 700);
const targetNode = process.env.FROST_TARGET;
const fatalSources = new Set((process.env.FROST_FATAL_SOURCES ?? "").split(",").filter(Boolean));
const targetHits: unknown[] = [];
// Static distances guide only already available player choices. Every observed
// transition still executes the real engine with legal inputs and recorded dice.
const nodeIds = new Set(story.nodes.map(node => node.id));
const predecessors = new Map<string, Set<string>>();
function targets(value: unknown): string[] {
  // Checks also use direct success/failure/fumble strings, unlike route.target.
  if (typeof value === "string") return nodeIds.has(value) ? [value] : [];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(targets);
  const object = value as Record<string, unknown>;
  return [...(typeof object.target === "string" && nodeIds.has(object.target) ? [object.target] : []), ...Object.values(object).flatMap(targets)];
}
for (const node of story.nodes) for (const target of targets(node.program)) {
  const from = predecessors.get(target) ?? new Set<string>(); from.add(node.id); predecessors.set(target, from);
}
const distance = new Map<string, number>();
if (targetNode) {
  if (!nodeIds.has(targetNode)) throw Error(`Unknown exploration target ${targetNode}`);
  distance.set(targetNode, 0);
  const queue = [targetNode];
  for (let i = 0; i < queue.length; i++) for (const parent of predecessors.get(queue[i]) ?? []) if (!distance.has(parent)) {
    distance.set(parent, distance.get(queue[i])! + 1); queue.push(parent);
  }
}
if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 50000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw Error("Invalid bounded exploration limits");
function inputFor(input: SceneInput, seed: number, rng: (min: number, max: number) => number): Record<string, number | string> {
  if (input.kind === "text") return { value: "来源路线的玩家笔记" };
  if (input.kind === "number") return { value: /探险开始时/.test(input.label) ? Math.min(input.max, 5 * (seed % 3)) : input.min };
  if (input.kind === "distribution") {
    const values = Object.fromEntries(input.entries.map(entry => [entry.key, input.minimums?.[entry.key] ?? 0]));
    let left = input.total - Object.values(values).reduce((sum, value) => sum + value, 0);
    if (left < 0) throw Error("Distribution lower bounds exceed total");
    while (left > 0) { const lowest = Math.min(...Object.values(values)); const entry = input.entries.find(entry => values[entry.key] === lowest)!; values[entry.key]++; left--; }
    return values;
  }
  const allocation = input.allocation;
  if (allocation.kind !== "bonus") throw Error(`Unreviewed Frost allocation ${allocation.kind}`);
  const values: Record<string, number | string> = {};
  let left = allocation.pool!;
  const allowed = input.skills.filter(skill => skill.key !== "cthulhuMythos" && (skill.key !== "creditRating" || allocation.includeCredit) && (!allocation.allowedSkills || allocation.allowedSkills.includes(skill.key)));
  // Satisfy printed Anthropology 75 without manipulating character state.
  for (const [key, minimum] of Object.entries(allocation.minimums ?? (allocation.allowedSkills?.includes("anthropology") ? { anthropology: 75 } : {}))) {
    const skill = allowed.find(skill => skill.key === key); if (!skill) throw Error(`Missing allocation skill ${key}`);
    const amount = Math.max(0, minimum - skill.value); values[key] = amount; left -= amount;
  }
  while (left > 0) {
    const possible = allowed.filter(skill => skill.value + Number(values[skill.key] ?? 0) < 99);
    if (!possible.length) throw Error("No legal space for source skill points");
    const skill = possible[rng(0, possible.length)]; values[skill.key] = Number(values[skill.key] ?? 0) + 1; left--;
  }
  return values;
}
type Draw = { min: number; max: number; value: number };
type Step = { node: string; sourceId: string; action: string; input: Record<string, string | number>; draws: Draw[]; resultNode: string };
type Witness = { seed: number; role: number; endingId: string; initialDraws: Draw[]; steps: Step[] };
const expected = story.nodes.filter(node => node.program?.some(step => step.kind === "end" && step.collect !== false)).map(node => node.id);
const routes = new Map<string, Witness>(), errors: unknown[] = [], stopped: unknown[] = [];
let capped = 0;
for (let seed = 1; seed <= attempts; seed++) {
  let random = seed;
  const rng = (min: number, max: number) => { random ^= random << 13; random ^= random >>> 17; random ^= random << 5; return min + Math.floor((random >>> 0) / 4294967296 * (max - min)); };
  let draws: Draw[] = [];
  let currentSourceForDice = "";
  // Optional constructive witnesses still use only valid source die faces.
  // This affects the requested source section only, never state or routing.
  const dice = (min: number, max: number) => {
    const value = fatalSources.has(currentSourceForDice) ? max - 1 : max === 101 && seed % 4 === 0 ? min : rng(min, max);
    draws.push({ min, max, value }); return value;
  };
  const role = seed % story.presets.length;
  let state = initialState(story, createCharacter("冰霜完整路线", story.presets[role], 0), dice);
  const initialDraws = draws, steps: Step[] = [];
  for (let index = 0; index < limit && state.status === "active"; index++) {
    let action = "";
    try {
      const scene = project(story, state, "route-probe", index);
      if (!scene.actions.length) throw Error("Active run has no action");
      const actions = scene.actions.filter(action => action.id !== "spend-luck" || seed % 7 === 0);
      const instruction = story.nodes.find(node => node.id === state.nodeId)?.program?.[state.program?.cursor ?? 0];
      if (targetNode && instruction?.kind === "choices" && rng(0, 10) < 8) {
        const candidates = actions.map(action => ({ action, distance: distance.get(instruction.choices.find(choice => choice.id === action.id)?.target ?? "") ?? Infinity }));
        const best = Math.min(...candidates.map(entry => entry.distance));
        const preferred = candidates.filter(entry => entry.distance === best);
        action = preferred[rng(0, preferred.length)].action.id;
      } else action = actions[rng(0, actions.length)].id;
      const input = scene.input ? inputFor(scene.input, seed, rng) : {};
      const node = state.nodeId, sourceId = scene.collection?.chapterId ?? node;
      currentSourceForDice = sourceId;
      draws = []; const next = advance(story, state, action, dice, input).state;
      steps.push({ node, sourceId, action, input, draws, resultNode: next.nodeId }); state = next;
      if (targetNode && state.nodeId === targetNode && targetHits.length < 100) targetHits.push({ seed, role, initialDraws, steps: steps.slice(),
        playerHp: state.character.hp, party: state.party?.members.map(member => ({ id: member.id, status: member.status, unconscious: member.unconscious, hp: member.character.hp })) });
    } catch (error) { if (errors.length < 30) errors.push({ seed, role, step: index, node: state.nodeId, action, error: String(error), initialDraws, steps: steps.slice() }); break; }
  }
  if (state.status !== "ended") { capped++; continue; }
  const ending = story.nodes.find(node => node.id === state.nodeId)!;
  if (ending.program?.some(step => step.kind === "end" && step.collect === false)) { if (stopped.length < 30) stopped.push({ seed, role, node: state.nodeId, initialDraws, steps }); continue; }
  const key = `${role}:${state.nodeId}`, old = routes.get(key);
  if (!old || old.steps.length > steps.length) routes.set(key, { seed, role, endingId: state.nodeId, initialDraws, steps });
}
const observed = new Set([...routes.values()].map(route => route.endingId));
const finishedRuntimeSha256 = runtimeFingerprint();
const report = { format: "coc-legal-route-witness@1", storyId: story.id, version: story.version,
  sourcePdfSha256: story.source?.sha256, manifestSha256: createHash("sha256").update(manifest).digest("hex"), runtimeSha256: startedRuntimeSha256,
  finishedRuntimeSha256, runtimeChangedDuringSearch: startedRuntimeSha256 !== finishedRuntimeSha256,
  attempts, stepLimit: limit, capped, targetNode, fatalSources: [...fatalSources], targetHits, expected, missing: expected.filter(id => !observed.has(id)), errors, stopped, routes: [...routes.values()] };
const output = resolve(process.env.FROST_ROUTES ?? "work/alone-against-frost/routes.json"); mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ attempts, found: observed.size, missing: report.missing,
  errors: errors.map((entry: any) => ({ seed: entry.seed, role: entry.role, node: entry.node, action: entry.action, error: entry.error })),
  targetNode, targetHits: targetHits.length, stopped: stopped.map((entry: any) => ({ seed: entry.seed, role: entry.role, node: entry.node })), capped }, null, 2));
