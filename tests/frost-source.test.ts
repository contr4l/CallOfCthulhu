import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import test from "node:test";
import { runtimeGraphSchema, validateStory } from "../apps/api/src/catalog.js";
import { loadFragmentStory } from "../apps/api/src/modules/story-fragments.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import {
  loadSourceDag,
  loadSourceFragment,
  validateSourceFragments,
} from "../apps/api/src/modules/source-dag.js";

const graphPath = resolve("scripts/冰霜独行.dag.json");
const graph = loadSourceDag(graphPath);
const sha = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const supplements = read(resolve("scripts", graph.supplements.path));
const metadata = supplements.documents[0].entries.find(
  (row: { kind: string }) => row.kind === "pdf-provenance",
).metadata;

test("Frost Luck growth compares the raw roll, and repeated Swim checks return through the saved call frame", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(
    resolve(pack, "story.json"),
    (data) => runtimeGraphSchema.parse(data),
    validateStory,
  );
  const diceFor = (d100: number, growth = 7) => {
    const digits = [d100 % 10, Math.floor(d100 / 10)];
    return (min: number, max: number) => {
      if (min === 0 && max === 10) return digits.shift() ?? 0;
      if (min === 1 && max === 11) return growth;
      return min;
    };
  };
  const at = (id: string, luck = 50) => {
    const story = { ...runtime, entry: id };
    return { story, state: initialState(story, createCharacter("测试调查员", story.presets[0], luck), diceFor(10)) };
  };
  const ordinaryStory = { ...runtime, entry: "654" };
  const ordinaryStart = initialState(ordinaryStory, createCharacter("测试调查员", ordinaryStory.presets[0], 50), diceFor(50));
  const equalRoll = advance(ordinaryStory, ordinaryStart, "roll", diceFor(50)).state;
  assert.equal(equalRoll.character.luck, 50, "a roll equal to current Luck does not improve it");
  assert.equal(equalRoll.nodeId, "77");
  const improvementStart = initialState(ordinaryStory, createCharacter("测试调查员", ordinaryStory.presets[0], 50), diceFor(51, 7));
  const improved = advance(ordinaryStory, improvementStart, "roll", diceFor(51, 7)).state;
  assert.equal(improved.character.luck, 57, "only a raw roll strictly greater than current Luck gains 1D10");
  assert.equal(improved.nodeId, "77");

  const maneuver = at("frost-228-player-turn");
  const bothCritical = (() => {
    const rolls = [1, 0, 1, 0];
    return (min: number, max: number) => min === 0 && max === 10 ? (rolls.shift() ?? 1) : min;
  })();
  const tiedManeuver = advance(maneuver.story, maneuver.state, "roll", bothCritical).state;
  assert.equal(tiedManeuver.program?.counters.frost228Maneuvers, 1, "a fighting maneuver wins an equal success-grade tie per combat rules");

  const drowning = at("385");
  let state = drowning.state;
  const swimDice = (() => {
    const rolls = [0, 8, 0, 1];
    return (min: number, max: number) => {
      if (min === 0 && max === 10) return rolls.shift() ?? 0;
      return min;
    };
  })();
  state = advance(drowning.story, state, "roll", swimDice).state;
  if (state.program?.pending) state = advance(drowning.story, state, "accept", swimDice).state;
  state = advance(drowning.story, state, "roll", swimDice).state;
  assert.equal(state.nodeId, "397", "after one failed Swim, the successful retry exits to the printed destination");
  assert.equal(state.character.hp, 13, "entry damage and one failed-attempt damage are applied once");
});

test("Frost retains all 654 source entries and reconstructs all 122 visual PDF pages", () => {
  assert.equal(graph.runtimePlayable, false);
  assert.equal(graph.nodes.length, 654);
  assert.equal(graph.edges.length, 1175);
  assert.equal(
    graph.source.sha256,
    sha(readFileSync(resolve("scripts", graph.source.filename))),
  );
  assert.equal(validateSourceFragments(graphPath).fragmentFiles, 655);
  assert.equal(metadata.pdfPages.length, 122);
  assert.ok(metadata.pdfPages.every((page: { canonicalLines: unknown[] }) => page.canonicalLines.length > 0));
  assert.equal(metadata.assets.length, 107);
  assert.equal(metadata.ocrPages.length, 11);
  assert.equal(metadata.extraction.ocrCompleted, true);
});

test("Frost review compiler refuses to overwrite a curated rules ledger", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "frost-review-guard-"));
  try {
    const protectedPath = resolve(directory, "rules.json");
    const original = Buffer.from(JSON.stringify({ format: "coc-frost-rule-review@1", mechanisms: [{ id: "immutable-ledger" }] }, null, 2));
    writeFileSync(protectedPath, original);
    const result = spawnSync("python3", ["tools/story/build_frost.py", "review", "--output", protectedPath], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refuse to overwrite curated rules\.json/);
    assert.deepEqual(readFileSync(protectedPath), original, "the curated bytes remain unchanged after the rejected command");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("§456 displays the complete printed source body before damage and roster routing", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const source = { ...runtime, entry: "456" };
  const dice = (_min: number, _max: number) => 1;
  const state = initialState(source, createCharacter("§456正文回归", source.presets[0], 50), dice);
  const firstView = project(source, state, "frost-456-body-regression", 0);
  const body = firstView.text.join("\n");
  assert.match(body, /帷幕猛然闭合/);
  assert.match(body, /受到1D6点伤害/);
  assert.match(body, /前往547/);
  assert.deepEqual(firstView.actions.map((action) => action.id), ["next"]);
  assert.equal(state.character.hp, 15, "the printed paragraph is visible before its damage resolves");
  const afterNext = advance(source, state, "next", dice).state;
  assert.equal(afterNext.character.hp, 14);
  assert.equal(afterNext.nodeId, "547", "the full party follows the printed §456 destination after the gate");

  const multiLoss = initialState(source, createCharacter("§456多名失队员适配", source.presets[0], 50), dice);
  for (const id of ["charlie", "bernard"]) multiLoss.party!.members.find((member) => member.id === id)!.status = "missing";
  const next = project(source, multiLoss, "frost-456-multiloss", 0).actions[0];
  const continued = advance(source, multiLoss, next.id, dice).state;
  assert.equal(continued.character.hp, 14, "the printed D6 damage is retained");
  assert.equal(continued.nodeId, "437", "the authorized larger-loss fallback reuses the printed loss continuation");
});

test("source wake/death transitions and bounded rifle loops keep actor eligibility and §315 executable", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const source = { ...runtime, entry: "315" };
  const dice = (_min: number, _max: number) => 1;
  const state = initialState(source, createCharacter("§315自动路线回归", source.presets[0], 50), dice);
  const to366 = advance(source, state, "to-366", dice);
  assert.equal(to366.state.nodeId, "367", "empty registered rifle counts return from each source shooter without executing 150 false checks");

  const entry = runtime.nodes.find((node) => node.id === "frost-auto-328");
  assert.ok(entry?.type === "program" && entry.program);
  assert.deepEqual(entry.program[0], { kind: "effects", effects: [{ op: "party", member: "norman", action: "restore" }] });
  const review = read(resolve("scripts/alone-against-frost/review/runtime-program-001-654.json"));
  const shooting = review.programs.find((row: { id: string }) => row.id === "135");
  const companionDex = shooting.program.find((step: { kind: string; check?: { actor?: string; label?: string } }) => step.kind === "check" && step.check?.actor === "norman" && step.check?.label === "诺曼敏捷");
  assert.deepEqual(companionDex.condition.all.map((row: { field: string }) => row.field), ["party.norman.present", "party.norman.awake"], "an unconscious companion cannot perform the source DEX check");
});

test("§469 source appearance reactivates missing living students but preserves explicit deaths", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const source = { ...runtime, entry: "469" };
  const dice = (_min: number, _max: number) => 1;
  const missing = initialState(source, createCharacter("§469状态回归", source.presets[0], 50), dice);
  for (const id of ["sylvia", "norman"]) missing.party!.members.find((member) => member.id === id)!.status = "missing";
  const prose = project(source, missing, "469-source", 0);
  assert.match(prose.text.join("\n"), /诺曼吊在峡谷边缘/);
  const resumed = advance(source, missing, "next", dice).state;
  for (const id of ["sylvia", "norman"]) {
    const member = resumed.party!.members.find((row) => row.id === id)!;
    assert.equal(member.status, "present");
    assert.equal(member.unconscious, false);
  }

  const dead = initialState(source, createCharacter("§469死亡保护", source.presets[0], 50), dice);
  dead.party!.members.find((member) => member.id === "sylvia")!.status = "dead";
  const preserved = advance(source, dead, "next", dice).state;
  assert.equal(preserved.nodeId, "frost-469-roster-gap");
  assert.equal(preserved.party!.members.find((member) => member.id === "sylvia")!.status, "dead");

  const from600 = initialState({ ...runtime, entry: "600" }, createCharacter("§600死亡同行门控", runtime.presets[0], 50), dice);
  from600.party!.members.find((member) => member.id === "sylvia")!.status = "dead";
  assert.ok(!project({ ...runtime, entry: "600" }, from600, "§600", 0).actions.some((action) => action.id === "to-469"), "the ridge route is hidden when Sylvia is dead");
});

test("§394 restores an explicitly reappearing missing Sylvia before the printed group Stealth checks", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const story = { ...runtime, entry: "394" };
  const dice = (min: number) => min;
  const state = initialState(story, createCharacter("§394失踪者重逢", story.presets[0], 50), dice);
  const sylvia = state.party!.members.find((member) => member.id === "sylvia")!;
  sylvia.status = "missing";
  sylvia.unconscious = true;
  const hp = sylvia.character.hp;
  const helper = advance(story, state, "next", dice).state;
  const checks = advance(story, helper, "next", dice).state;
  const restored = checks.party!.members.find((member) => member.id === "sylvia")!;
  assert.equal(restored.status, "present");
  assert.equal(restored.unconscious, false);
  assert.equal(restored.character.hp, hp, "the reunion does not invent HP recovery");
});

test("§202 frees missing Bernard without reviving or waking him, and preserves the printed route for a dead Bernard", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const story = { ...runtime, entry: "202" };
  const dice = (min: number) => min;
  const state = initialState(story, createCharacter("§202获救同行", story.presets[0], 50), dice);
  const bernard = state.party!.members.find((member) => member.id === "bernard")!;
  bernard.status = "missing";
  bernard.unconscious = true;
  const hp = bernard.character.hp;
  const next = advance(story, state, "next", dice).state;
  const restored = next.party!.members.find((member) => member.id === "bernard")!;
  assert.equal(restored.status, "present");
  assert.equal(restored.unconscious, true, "being cut free does not itself say Bernard regains consciousness");
  assert.equal(restored.character.hp, hp, "the rescue does not invent HP recovery");
  const deadState = initialState(story, createCharacter("§202死者保护", story.presets[0], 50), dice);
  deadState.party!.members.find((member) => member.id === "bernard")!.status = "dead";
  const deadNext = advance(story, deadState, "next", dice).state;
  assert.equal(deadNext.nodeId, "131", "the printed §202 destination remains available even if Bernard was already dead");
  assert.equal(deadNext.party!.members.find((member) => member.id === "bernard")!.status, "dead");

  const section90 = { ...runtime, entry: "90" };
  const choicesFor = (status: "present" | "missing" | "dead", unconscious = false) => {
    const roster = initialState(section90, createCharacter("§90检定资格", section90.presets[0], 50), dice);
    const member = roster.party!.members.find((row) => row.id === "bernard")!;
    member.status = status;
    member.unconscious = unconscious;
    return project(section90, roster, "§90菜单", 0).actions.map((action) => action.label);
  };
  assert.deepEqual(choicesFor("present"), ["尝试穿过岩缝", "返回麦克唐纳堡方向"]);
  for (const [status, unconscious] of [["present", true], ["missing", false], ["dead", false]] as const) {
    const roster = initialState(section90, createCharacter("§90返回选项", section90.presets[0], 50), dice);
    const member = roster.party!.members.find((row) => row.id === "bernard")!;
    member.status = status;
    member.unconscious = unconscious;
    const scene = project(section90, roster, "§90返回选项", 0);
    assert.equal(scene.actions.length, 1, "the ineligible §91 check is hidden while the return path remains available");
    assert.equal(advance(section90, roster, scene.actions[0].id, dice).state.nodeId, "158");
  }
  const section91 = runtime.nodes.find((node) => node.id === "91")!;
  assert.ok(section91.program);
  const section91First = section91.program[0];
  assert.equal(section91First.kind, "check");
  if (section91First.kind === "check") assert.equal(section91First.check.actor, "bernard");
});

test("§407 requires three Hard CON successes and tracks every failed-roll smoke injury", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const story = { ...runtime, entry: "407" };
  const runToRolls = (d100s: number[]) => {
    const digits = d100s.flatMap((roll) => roll === 100 ? [0, 0] : [roll % 10, Math.floor(roll / 10)]);
    let count = 0;
    const dice = (min: number, max: number) => min === 0 && max === 10 ? (digits[count++] ?? 0) : min;
    let state = initialState(story, createCharacter("§407三次体质", story.presets[0], 50), dice);
    for (let guard = 0; count < digits.length && guard < 40; guard++) {
      const scene = project(story, state, "407-hard-con", guard);
      assert.ok(scene.actions.length, "the printed repeat procedure always has a valid next action");
      state = advance(story, state, scene.actions[0].id, dice).state;
    }
    assert.equal(count, digits.length);
    return state;
  };
  const firstTwo = runToRolls([1, 1]);
  assert.notEqual(firstTwo.nodeId, "408", "one or two successful rolls cannot satisfy the source requirement");
  assert.equal(runToRolls([1, 1, 1]).nodeId, "408", "the third successful Hard CON roll returns to §408");
  const withFailure = runToRolls([100, 1, 1, 1]);
  assert.equal(withFailure.nodeId, "408");
  assert.equal(withFailure.character.hp, withFailure.character.maxHp - 1, "the failed check applies its 1D3 smoke damage once");

  const deathDigits = [0, 0];
  const deathDice = (min: number, max: number) => min === 0 && max === 10 ? (deathDigits.shift() ?? 0) : min;
  const dying = initialState(story, createCharacter("§407烟雾致死", story.presets[0], 50), deathDice);
  dying.character.hp = 1;
  let state = dying;
  for (let guard = 0; guard < 12 && state.status === "active"; guard++) {
    const scene = project(story, state, "407-smoke-death", guard);
    state = advance(story, state, scene.actions[0].id, deathDice).state;
    if (state.nodeId === "frost-407-smoke-ending") break;
  }
  assert.equal(state.nodeId, "frost-407-smoke-ending");
  assert.equal(project(story, state, "407-smoke-ending", 0).collection?.endingId, "frost-407-smoke-ending");
});

test("the legal §616 failure witness routes HP 0 without a major wound to the approved §191 fallback", () => {
  const evidence = read(resolve("work/alone-against-frost/probe-616-zero-result.json"));
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const story = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  assert.equal(story.version, "1.0.0");
  assert.equal(evidence.seed, 167);
  assert.equal(evidence.role, 1);
  let initialQueue = [...evidence.initialDraws];
  let state = initialState(story, createCharacter("§616合法路线回放", story.presets[evidence.role], 0), (min, max) => {
    const draw = initialQueue.shift();
    assert.deepEqual([draw?.min, draw?.max], [min, max]);
    return draw!.value;
  });
  assert.equal(initialQueue.length, 0);
  const replay = (row: { node: string; action: string; input?: Record<string, number | string>; draws: Array<{ min: number; max: number; value: number }>; resultNode: string }) => {
    assert.equal(state.nodeId, row.node);
    const queue = [...row.draws];
    state = advance(story, state, row.action, (min, max) => {
      const draw = queue.shift();
      assert.deepEqual([draw?.min, draw?.max], [min, max]);
      return draw!.value;
    }, row.input ?? {}).state;
    assert.equal(queue.length, 0);
    assert.equal(state.nodeId, row.resultNode === "frost-616-damage" ? "191" : row.resultNode);
  };
  for (const row of evidence.prefixSteps) replay(row);
  for (const row of evidence.steps.slice(evidence.prefixSteps.length)) replay(row);
  assert.equal(evidence.entryHp, 5);
  assert.equal(state.character.hp, 0);
  assert.equal(state.flags.unconscious, true);
  assert.equal(state.flags.majorWound, undefined);
  assert.equal(state.nodeId, "191", "the explicitly authorized fallback routes an otherwise unspecified HP-0 outcome to the existing unconsciousness procedure");
  assert.equal(state.character.hp, 0);
  assert.equal(state.status, "active");
});

test("§186 resumes enemy actions after incoming damage incapacitates the remaining party cursor", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(
    resolve(pack, "story.json"),
    (data) => runtimeGraphSchema.parse(data),
    validateStory,
  );
  const report = read(resolve("work/alone-against-frost/root-target-221-076.json"));
  const witness = report.errors.find((row: { seed: number }) => row.seed === 772);
  assert.ok(witness, "the full legal §186 error witness remains available");
  const initial = [...witness.initialDraws];
  const rollInitial = (min: number, max: number) => {
    const draw = initial.shift();
    assert.ok(draw, `expected initial ${min}..${max} draw`);
    assert.equal(draw.min, min);
    assert.equal(draw.max, max);
    return draw.value;
  };
  let state = initialState(runtime, createCharacter("复放调查员", runtime.presets[witness.role], 0), rollInitial);
  for (const [index, step] of witness.steps.entries()) {
    const draws = [...step.draws];
    state = advance(runtime, state, step.action, (min, max) => {
      const draw = draws.shift();
      assert.ok(draw, `step ${index} (${step.node}) expected ${min}..${max} draw`);
      assert.equal(draw.min, min, `step ${index} (${step.node}) die minimum`);
      assert.equal(draw.max, max, `step ${index} (${step.node}) die maximum`);
      return draw.value;
    }, step.input).state;
    assert.equal(draws.length, 0, `step ${index} (${step.node}) consumed its recorded dice`);
  }
  assert.equal(state.nodeId, "186");
  assert.equal(state.status, "active");
  assert.equal(state.program?.frostCombat?.state.phase, "enemy");
  assert.ok(project(runtime, state, "test", 0).actions.length > 0, "enemy turn remains actionable after the party cursor is exhausted");
  assert.equal(state.program?.frostCombat?.state.party.find((actor) => actor.id === "$player")?.character.hp, 1);
});

test("the legal §438 witness treats an unconscious Sylvia as unable to pass her printed POW check", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const report = read(resolve("work/alone-against-frost/root-routes-077.json"));
  const witness = report.errors.find((row: { seed: number }) => row.seed === 2247);
  assert.ok(witness, "the entry-1 route to §438 is preserved with its complete dice history");
  const initial = [...witness.initialDraws];
  let state = initialState(runtime, createCharacter("§438合法路线回放", runtime.presets[witness.role], 0), (min, max) => {
    const draw = initial.shift();
    assert.deepEqual([draw?.min, draw?.max], [min, max]);
    return draw!.value;
  });
  for (const [index, step] of witness.steps.entries()) {
    const draws = [...step.draws];
    state = advance(runtime, state, step.action, (min, max) => {
      const draw = draws.shift();
      assert.deepEqual([draw?.min, draw?.max], [min, max], `step ${index} die`);
      return draw!.value;
    }, step.input).state;
    if (step.node !== "437") assert.equal(draws.length, 0, `step ${index} consumes exactly the recorded dice`);
  }
  if (state.nodeId === "frost-auto-437") {
    const nextSection = project(runtime, state, "§437", 0).actions.find((action) => action.id === "next");
    assert.ok(nextSection);
    state = advance(runtime, state, nextSection.id, (min, max) => min === 0 && max === 10 ? 9 : min).state;
    if (state.program?.pending) state = advance(runtime, state, "accept", () => 9).state;
  }
  assert.equal(state.nodeId, "438");
  assert.equal(state.party?.members.find((member) => member.id === "sylvia")?.unconscious, true);
  const scene = project(runtime, state, "test", 0);
  const next = scene.actions.find((action) => action.id === "next");
  assert.ok(next, "§438 first displays its printed paragraph");
  state = advance(runtime, state, next.id, () => { throw new Error("an unconscious companion must not be rolled"); }).state;
  assert.equal(state.nodeId, "439", "the unavailable actor follows the printed failure destination");
});

test("the entry-1 §391 party-combat loss witness reaches the approved §191 fallback with exact source damage allocation", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const witness = read(resolve("work/alone-against-frost/probe-391-loss.json"));
  const initial = [...witness.initialDraws];
  let state = initialState(runtime, createCharacter("§391合法路线回放", runtime.presets[witness.role], 0), (min, max) => {
    const draw = initial.shift();
    assert.deepEqual([draw?.min, draw?.max], [min, max]);
    return draw!.value;
  });
  for (const [index, step] of witness.prefixSteps.entries()) {
    const draws = [...step.draws];
    state = advance(runtime, state, step.action, (min, max) => {
      const draw = draws.shift();
      assert.deepEqual([draw?.min, draw?.max], [min, max], `prefix step ${index} die`);
      return draw!.value;
    }, step.input).state;
    if (draws.length) assert.equal(state.nodeId, "frost-201-norman", `only the now-ineligible student checks at step ${index} may skip stored rolls`);
  }
  assert.equal(state.nodeId, "391");
  assert.equal(state.character.hp, 7);
  for (const [index, step] of witness.steps.entries()) {
    const draws = [...step.draws];
    state = advance(runtime, state, step.action, (min, max) => {
      const draw = draws.shift();
      assert.deepEqual([draw?.min, draw?.max], [min, max], `combat step ${index} die`);
      return draw!.value;
    }, step.input).state;
    assert.equal(draws.length, 0);
  }
  assert.equal(state.nodeId, "191");
  assert.equal(state.character.hp, 0);
  assert.equal(state.flags.unconscious, true);
  assert.equal(state.flags.majorWound, undefined);
});

test("§201 skips unavailable students and still resolves its printed SAN outcome matrix", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const source = { ...runtime, entry: "201" };
  let state = initialState(source, createCharacter("§201资格回归", source.presets[0], 0), (min) => min);
  for (const id of ["sylvia", "norman"]) {
    state.party!.members.find((member) => member.id === id)!.status = "dead";
  }
  const first = project(source, state, "§201", 0).actions[0];
  assert.ok(first, "the investigator still makes the printed SAN check");
  state = advance(source, state, first.id, (min) => min).state;
  assert.ok(["frost-201-norman", "frost-201-sylvia", "frost-201-routes", "118"].includes(state.nodeId));
  for (let turn = 0; turn < 4 && !["246", "118", "66", "241"].includes(state.nodeId); turn++) {
    const action = project(source, state, "§201-followup", 0).actions[0];
    assert.ok(action);
    state = advance(source, state, action.id, () => { throw new Error("dead students are skipped, not rolled"); }).state;
  }
  assert.equal(state.nodeId, "118", "both unavailable students retain their initialized failed flags in the printed outcome matrix");
});

test("legal combat prefix can resolve the final rifle round in §391", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const report = read(resolve("work/alone-against-frost/root-target-342-077.json"));
  const witness = report.errors.find((row: { seed: number }) => row.seed === 367);
  assert.ok(witness);
  const initial = [...witness.initialDraws];
  let state = initialState(runtime, createCharacter("§391步枪末发回放", runtime.presets[witness.role], 0), (min, max) => {
    const draw = initial.shift(); assert.deepEqual([draw?.min, draw?.max], [min, max]); return draw!.value;
  });
  for (const [index, step] of witness.steps.entries()) {
    const before = state.inventory.find((item) => item.key === "rifle")?.quantity ?? 0;
    const draws = [...step.draws];
    state = advance(runtime, state, step.action, (min, max) => {
      const draw = draws.shift(); assert.deepEqual([draw?.min, draw?.max], [min, max], `step ${index}`); return draw!.value;
    }, step.input).state;
    assert.equal(draws.length, 0, `step ${index} consumes its recorded dice`);
  }
  assert.equal(state.nodeId, "391");
  const rifleAction = project(runtime, state, "§391", 0).actions.find((action) => action.id === "frost-attack:rifle:sasquatch-2");
  assert.ok(rifleAction, "the recorded prefix leaves the last-round rifle attack available");
  const before = state.inventory.find((item) => item.key === "rifle")?.quantity ?? 0;
  state = advance(runtime, state, rifleAction.id, (min, _max) => min).state;
  assert.equal(state.nodeId, "391");
  assert.equal(state.inventory.find((item) => item.key === "rifle")?.quantity ?? 0, before, "the predeclared one-shot attack uses its dedicated source counter");
  assert.equal(state.program?.counters.frost391RifleShots, 0, "the single point-blank shot is consumed once after it resolves");
});

test("the printed §331→327 path resolves an unavailable Norman check as its printed failure", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const report = read(resolve("work/alone-against-frost/root-target-345-077.json"));
  const witness = report.errors.find((row: { seed: number }) => row.seed === 1515);
  assert.ok(witness);
  const initial = [...witness.initialDraws];
  let state = initialState(runtime, createCharacter("§331合法路线回放", runtime.presets[witness.role], 0), (min, max) => {
    const draw = initial.shift(); assert.deepEqual([draw?.min, draw?.max], [min, max]); return draw!.value;
  });
  for (const [index, step] of witness.steps.entries()) {
    const draws = [...step.draws];
    state = advance(runtime, state, step.action, (min, max) => {
      const draw = draws.shift(); assert.deepEqual([draw?.min, draw?.max], [min, max], `step ${index}`); return draw!.value;
    }, step.input).state;
    assert.equal(draws.length, 0, `step ${index} consumes its recorded dice`);
  }
  assert.equal(state.nodeId, "331");
  const even = [1];
  state = advance(runtime, state, "next", (min, max) => min === 1 && max === 11 ? (even.shift() ?? 1) + 1 : min).state;
  assert.equal(state.nodeId, "327");
  const norman = state.party?.members.find((member) => member.id === "norman");
  assert.ok(norman && (norman.status !== "present" || norman.unconscious), "the real §331 prefix makes Norman unavailable for his printed check");
  const next = project(runtime, state, "§327", 0).actions.find((action) => action.id === "next");
  assert.ok(next, "the §327 paragraph is shown before the check/fallback");
  state = advance(runtime, state, next.id, () => { throw new Error("unavailable Norman must not be rolled"); }).state;
  assert.equal(state.nodeId, "67", "unavailable Hard CON check follows the printed failure destination");
});

test("the printed §638 dodge failure route remains playable when Sylvia is unavailable", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const report = read(resolve("work/alone-against-frost/root-target-345-077.json"));
  const witness = report.errors.find((row: { seed: number }) => row.seed === 1487);
  assert.ok(witness);
  const initial = [...witness.initialDraws];
  let state = initialState(runtime, createCharacter("§638合法路线回放", runtime.presets[witness.role], 0), (min, max) => {
    const draw = initial.shift(); assert.deepEqual([draw?.min, draw?.max], [min, max]); return draw!.value;
  });
  for (const [index, step] of witness.steps.entries()) {
    const draws = [...step.draws];
    state = advance(runtime, state, step.action, (min, max) => {
      const draw = draws.shift(); assert.deepEqual([draw?.min, draw?.max], [min, max], `step ${index}`); return draw!.value;
    }, step.input).state;
    assert.equal(draws.length, 0);
  }
  assert.equal(state.nodeId, "638");
  assert.equal(state.party?.members.find((member) => member.id === "sylvia")?.unconscious, true);
  const next = project(runtime, state, "§638", 0).actions.find((action) => action.id === "next");
  assert.ok(next, "the §638 paragraph is shown before its failure route");
  state = advance(runtime, state, next.id, () => { throw new Error("unavailable Sylvia must not be rolled"); }).state;
  assert.equal(state.nodeId, "641", "unavailable Dodge follows the printed failure destination");
});

test("authorized death-state adaptations preserve printed routes, require the investigator at §255, and record §211 deaths", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const dice = (_min: number, _max: number) => 1;

  for (const entry of ["324", "600", "601"]) {
    const source = { ...runtime, entry };
    const state = initialState(source, createCharacter("已死亡同行", source.presets[0], 50), dice);
    state.party!.members.find((member) => member.id === "sylvia")!.status = "dead";
    assert.ok(!project(source, state, `dead-sylvia-${entry}`, 0).actions.some((action) => action.id === "to-469"), `§${entry} hides only the unsupported ridge route when Sylvia is dead`);
  }

  const male = { ...runtime, entry: "210" };
  const maleDead = initialState(male, createCharacter("男性调查员", male.presets.find((preset) => preset.id === "nadelmann-male")!, 50), dice);
  maleDead.party!.members.find((member) => member.id === "sylvia")!.status = "dead";
  const maleDeadAt255 = advance(male, maleDead, "next", dice).state;
  assert.equal(maleDeadAt255.nodeId, "255", "the authorized male/Sylvia-dead branch reuses the printed §255 POW challenge");
  assert.match(project(male, maleDeadAt255, "male-dead-queen", 0).text.join("\n"), /准备好这具躯壳/, "the shared Chinese §255 passage uses gender-neutral body language");
  const maleAlive = initialState(male, createCharacter("男性调查员", male.presets.find((preset) => preset.id === "nadelmann-male")!, 50), dice);
  assert.equal(advance(male, maleAlive, "next", dice).state.nodeId, "260", "male investigator with living Sylvia keeps the printed destination");

  const execution = { ...runtime, entry: "211" };
  const executionState = initialState(execution, createCharacter("§211来源死亡", execution.presets[0], 50), dice);
  for (const id of ["norman", "sylvia"]) assert.equal(executionState.party!.members.find((member) => member.id === id)!.status, "dead", `§211 source execution records ${id} dead`);
});

test("§513 exposes the §594 short trip only for the approved source-resolved rosters", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const source = { ...runtime, entry: "513" };
  const dice = (_min: number, _max: number) => 1;
  const rosterCases: Array<[string, string[]]> = [
    ["all four companions", ["charlie", "bernard", "sylvia", "norman"]],
    ["Bernard, Sylvia, Norman", ["bernard", "sylvia", "norman"]],
    ["Charlie, Norman, Sylvia", ["charlie", "norman", "sylvia"]],
    ["Norman and Sylvia", ["norman", "sylvia"]],
    ["Norman alone", ["norman"]],
    ["no companions", []],
  ];
  for (const [label, roster] of rosterCases) {
    const state = initialState(source, createCharacter("§513阵容校验", source.presets[0], 50), dice);
    for (const member of state.party!.members) member.status = roster.includes(member.id) ? "present" : "missing";
    const actions = project(source, state, `roster-${label}`, 0).actions.map((action) => action.id);
    assert.ok(actions.includes("to-594"), `${label} has a printed downstream route`);
  }
  const unsupported = initialState(source, createCharacter("§513阵容校验", source.presets[0], 50), dice);
  for (const member of unsupported.party!.members) member.status = ["charlie", "bernard"].includes(member.id) ? "present" : "missing";
  assert.ok(!project(source, unsupported, "roster-unsupported", 0).actions.some((action) => action.id === "to-594"), "Charlie+Bernard has no source-resolved short-trip destination and retains §593 only");
});

test("a fatal §385 opening loss reaches its source-specific, canonical collection ending", () => {
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.0");
  const runtime = loadFragmentStory(resolve(pack, "story.json"), (data) => runtimeGraphSchema.parse(data), validateStory);
  const source = { ...runtime, entry: "385" };
  const character = createCharacter("§385溺亡回归", source.presets[0], 50);
  character.hp = 1;
  const state = initialState(source, character, (_min, _max) => 1);
  assert.equal(state.status, "ended");
  assert.equal(state.nodeId, "frost-385-drowning-ending");
  assert.equal(project(source, state, "frost-385-drowning", 0).collection?.endingId, "frost-385-drowning-ending");
});

test("Frost retains narrow-column entries 123-124 and separates footer artifacts from complete prose", () => {
  for (const id of ["123", "124"]) {
    const source = loadSourceFragment(graphPath, id);
    assert.ok(source.paragraphs.filter((row) => row.kind === "body").length >= 2, `entry ${id} must retain body and rule text`);
  }
  const s513 = loadSourceFragment(graphPath, "513");
  assert.ok(s513.paragraphs.some((row) => row.id === "513:p2" && !row.text.includes("(25, 67")));
  assert.ok(s513.paragraphs.some((row) => row.id === "513:p3" && row.text.startsWith("(25, 67")));
  const s203 = loadSourceFragment(graphPath, "203");
  assert.ok(s203.paragraphs.some((row) => /crustaceans have a\s+mass of short tentacles/.test(row.text)));
  const s215 = loadSourceFragment(graphPath, "215");
  assert.ok(s215.paragraphs.some((row) => /You\s+know this is only the beginning/.test(row.text)));
  const furniture = supplements.documents[0].entries.filter((row: { section?: string; text?: string }) => row.section === "page-furniture").map((row: { text?: string }) => row.text);
  assert.ok(furniture.includes("42"));
  assert.ok(furniture.includes("44"));
  assert.equal(metadata.pageFooterAudit.matchedCount, 113);
  assert.deepEqual(metadata.pageFooterAudit.pdfPages, [8, ...Array.from({ length: 112 }, (_, i) => i + 10)]);
  for (const row of supplements.documents[0].entries) {
    if (row.section === "page-furniture") assert.ok(row.sourceLocation?.startsWith("pdf:visual:"));
  }
});

test("Frost canonical line ledger is hash-bound and each line is assigned exactly once", () => {
  const pieces = new Map<number, { line: number; text: string }[]>();
  const rows = graph.nodes.flatMap((node) =>
    loadSourceFragment(graphPath, node.id).paragraphs,
  );
  rows.push(
    ...supplements.documents[0].entries.filter(
      (row: { sourceLocation?: string }) => row.sourceLocation?.startsWith("pdf:visual:"),
    ),
  );
  for (const row of rows) {
    const loc = row.sourceLocation;
    if (!loc?.startsWith("pdf:visual:")) continue;
    const refs: [number, number][] = JSON.parse(loc.slice("pdf:visual:".length));
    const text = refs.map(([page, line]) => metadata.pdfPages[page - 1].canonicalLines[line].text).join("\n");
    assert.equal(text, row.text, (row as { id?: string }).id ?? "supplement");
    for (const [page, line] of refs) {
      const pageRows = pieces.get(page) ?? [];
      pageRows.push({ line, text: metadata.pdfPages[page - 1].canonicalLines[line].text });
      pieces.set(page, pageRows);
    }
  }
  for (const page of metadata.pdfPages) {
    const lines = (pieces.get(page.pdfPage) ?? []).sort((a, b) => a.line - b.line);
    assert.deepEqual(lines.map((row) => row.line), page.canonicalLines.map((_: unknown, i: number) => i), `line assignment PDF page ${page.pdfPage}`);
    assert.equal(sha(lines.map((row) => row.text).join("\n")), page.canonicalTextSha256);
  }
});

test("Frost extracted assets and OCR remain bound to the original PDF", () => {
  for (const ref of [...metadata.assets, ...metadata.ocrPages, ...metadata.ocrPages.map((row: { renderPath?: string; renderSha256?: string }) => ({ path: row.renderPath, sha256: row.renderSha256 }))]) {
    const path = resolve("scripts", ref.path);
    const local = relative(resolve("scripts"), path);
    assert.ok(!isAbsolute(local) && !local.startsWith(".."));
    assert.ok(existsSync(path));
    assert.equal(sha(readFileSync(path)), ref.sha256);
    if (ref.tokens) {
      const ocr = read(path);
      assert.equal(ocr.sourcePdfSha256, graph.source.sha256);
      assert.equal(ocr.renderSha256, sha(readFileSync(resolve("scripts", ocr.renderPath))));
      assert.ok(ocr.tokens.every((token: { confidence: number }) => token.confidence >= 0 && token.confidence <= 100));
    }
  }
});

test("Frost translation is complete by paragraph for all 654 sections and supplements; the full story is not release playable", () => {
  const root = resolve("scripts/alone-against-frost/translations/zh-CN");
  const manifest = read(resolve(root, "manifest.json"));
  assert.equal(manifest.status, "model-translated-review-required");
  assert.equal(manifest.runtimePlayable, false);
  assert.equal(manifest.sourcePdfSha256, graph.source.sha256);
  assert.equal(manifest.sourceGraphSha256, sha(readFileSync(graphPath)));
  assert.equal(manifest.nodes.length, 654);
  assert.deepEqual(manifest.nodes.map((node: { id: string }) => Number(node.id)), Array.from({ length: 654 }, (_, i) => i + 1));
  for (const node of manifest.nodes) {
    const path = resolve(root, node.fragment.path);
    assert.ok(!relative(root, path).startsWith(".."));
    assert.equal(sha(readFileSync(path)), node.fragment.sha256);
    const source = loadSourceFragment(graphPath, node.id);
    const translation = read(path);
    assert.equal(translation.sourceFragmentSha256, sha(readFileSync(resolve("scripts", graph.nodes.find((n) => n.id === node.id)!.fragment.path))));
    assert.deepEqual(translation.paragraphs.map((p: { id: string }) => p.id), source.paragraphs.map((p) => p.id));
    assert.ok(translation.paragraphs.every((p: { text: string }) => p.text.trim().length > 0));
  }
  const check = JSON.parse(execFileSync("/Users/ftan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3", ["tools/story/frost_translation.py", "check"], { encoding: "utf8" }));
  assert.deepEqual(check.errors, []);
  assert.equal(check.translatedNodes, 654);
  assert.equal(check.totalNodes, 654);
  assert.equal(check.missingNodeCount, 0);
  const repaired = loadSourceFragment(graphPath, "324");
  assert.ok(repaired.paragraphs.some((row) => row.id === "324:p2" && row.text.includes("To thread \nthrough light woodland")));
  assert.ok(repaired.paragraphs.some((row) => row.id === "324:p3" && row.text.startsWith("(45, 50, 53")));
  const vision450 = loadSourceFragment(graphPath, "450");
  assert.ok(vision450.paragraphs.some((row) => row.id === "450:p3" && row.text.includes("They defend it \nwith mighty magic")));
  const translation450 = read(resolve(root, "450.json"));
  assert.equal(translation450.paragraphs.find((row: { id: string }) => row.id === "450:p3")?.text.includes("守护它。亚特兰蒂斯的船只燃烧"), true);
  const vision451 = loadSourceFragment(graphPath, "451");
  assert.equal(vision451.paragraphs.find((row) => row.id === "451:p2")?.text.includes("Keywanema!"), true);
  assert.equal(vision451.paragraphs.filter((row) => row.kind === "body").length, 4);
});

test("Frost playable supplements are translated and bound to visual source pages", () => {
  const root = resolve("scripts/alone-against-frost/translations/zh-CN");
  const manifest = read(resolve(root, "manifest.json"));
  assert.equal(manifest.supplements.length, 1);
  const ref = manifest.supplements[0];
  const path = resolve(root, ref.path);
  assert.ok(!relative(root, path).startsWith(".."));
  assert.equal(sha(readFileSync(path)), ref.sha256);
  const translation = read(path);
  assert.equal(translation.format, "coc-story-supplement-translation@1");
  assert.equal(translation.language, "zh-CN");
  assert.equal(translation.runtimePlayable, false);
  assert.equal(translation.sourcePdfSha256, graph.source.sha256);
  assert.equal(translation.sourceGraphSha256, sha(readFileSync(graphPath)));
  for (const row of translation.paragraphs) {
    const refs: [number, number][] = JSON.parse(row.sourceLocation.slice("pdf:visual:".length));
    const source = refs.map(([page, line]) => metadata.pdfPages[page].canonicalLines[line].text).join("\n");
    assert.equal(source, row.sourceText, row.id);
    assert.equal(row.sourcePageCanonicalTextSha256, metadata.pdfPages[refs[0][0]].canonicalTextSha256);
    assert.ok(row.text.trim().length > 0);
  }
  assert.equal(translation.characterSheets.length, 5);
  const characterAudit = read(resolve("scripts/alone-against-frost/review/character-audit.json"));
  for (const card of translation.characterSheets) {
    assert.equal(card.source.characterAuditSha256, sha(readFileSync(resolve("scripts/alone-against-frost/review/character-audit.json"))));
    for (const key of ["ocrJson", "render"]) {
      const sourcePath = resolve("scripts", card.source[`${key}Path`]);
      assert.equal(sha(readFileSync(sourcePath)), card.source[`${key}Sha256`]);
    }
    const original = characterAudit.characters.find((row: { id: string }) => row.id === card.id);
    assert.ok(original);
    assert.deepEqual(card.attributes.map((row: { key: string; value: number }) => [row.key, row.value]), Object.entries(original.attributes));
    assert.deepEqual(card.derived.map((row: { key: string; value: number }) => [row.key, row.value]), Object.entries(original.derived));
  }
  for (const source of translation.quickReference.visualSources) {
    for (const key of ["ocrJson", "render"]) {
      const sourcePath = resolve("scripts", source[`${key}Path`]);
      assert.equal(sha(readFileSync(sourcePath)), source[`${key}Sha256`]);
    }
  }
});

test("Frost rule locators bind translated passages and distinguish source review from compilation", () => {
  const audit = read(resolve("work/alone-against-frost/review/entry-program-audit-001-080.json"));
  assert.equal(audit.runtimePlayable, false);
  assert.equal(audit.sections.length, 80);
  assert.equal(audit.sourceGraphSha256, sha(readFileSync(graphPath)));
  assert.ok(audit.sections.every((section: { reviewStatus: string }) => section.reviewStatus.includes("program semantics remain pending")));
  const reviewed = read(resolve("scripts/alone-against-frost/review/rules.json"));
  assert.equal(reviewed.runtimePlayable, false);
  assert.equal(reviewed.sourceGraphSha256, sha(readFileSync(graphPath)));
  const injuryReview = reviewed.mechanisms.find((row: { id: string }) => row.id === "injury-and-insanity-interrupts");
  assert.deepEqual([injuryReview.source.pdfPage, injuryReview.source.printedPage], [7, 6]);
  for (const page of reviewed.locatorVisualCorrections.pages) {
    assert.equal(sha(readFileSync(resolve(page.render))), page.renderSha256);
    assert.equal(metadata.pdfPages.find((row: { pdfPage: number }) => row.pdfPage === page.pdfPage).printedPage, String(page.printedPage));
  }
  assert.match(injuryReview.review, /PDF p\.8.*AND\/OR/i);
  assert.equal(metadata.pdfPages.find((page: { pdfPage: number }) => page.pdfPage === 7).printedPage, "6");
  assert.equal(metadata.pdfPages.find((page: { pdfPage: number }) => page.pdfPage === 8).printedPage, "7");
  const runtimeReview = read(resolve("scripts/alone-against-frost/review/runtime-program-001-654.json"));
  const sourceStateProgram = (id: string) => runtimeReview.programs.find((row: { id: string }) => row.id === id).program;
  assert.ok(sourceStateProgram("23")[0].effects.some((effect: { op: string; member?: string; value?: string }) => effect.op === "party" && effect.member === "bernard" && effect.value === "dead"), "§23 states Bernard's decapitated death before either route");
  assert.ok(sourceStateProgram("41")[0].choices[0].effects.some((effect: { op: string; member?: string; value?: string }) => effect.op === "party" && effect.member === "charlie" && effect.value === "missing"), "§41 records Charlie leaving when Nadelmann lets her go alone");
  assert.ok(sourceStateProgram("137")[0].effects.some((effect: { op: string; member?: string; value?: string }) => effect.op === "party" && effect.member === "charlie" && effect.value === "missing"), "§137 records Charlie's canoe departure");
  for (const [id, member, value] of [["30", "charlie", "missing"], ["38", "sylvia", "missing"], ["42", "bernard", "dead"], ["50", "bernard", "dead"], ["50", "charlie", "missing"], ["52", "charlie", "missing"], ["61", "charlie", "missing"], ["66", "norman", "missing"], ["66", "sylvia", "dead"], ["71", "bernard", "missing"], ["82", "sylvia", "missing"], ["190", "sylvia", "missing"], ["198", "sylvia", "dead"], ["233", "bernard", "dead"], ["233", "sylvia", "missing"], ["234", "norman", "missing"], ["234", "sylvia", "missing"], ["295", "norman", "missing"], ["312", "sylvia", "missing"], ["368", "norman", "missing"], ["455", "bernard", "missing"], ["455", "sylvia", "missing"], ["455", "norman", "missing"], ["525", "bernard", "missing"], ["563", "sylvia", "missing"], ["564", "sylvia", "present"], ["565", "sylvia", "missing"], ["651", "charlie", "dead"]]) {
    const program = sourceStateProgram(id);
    assert.ok(program.some((step: { kind: string; effects?: { op: string; member?: string; value?: string }[] }) => step.kind === "effects" && step.effects?.some((effect) => effect.op === "party" && effect.member === member && effect.value === value)), `§${id} records the source-confirmed ${member} ${value} state`);
  }
  assert.ok(reviewed.mechanisms.some((row: { id: string }) => row.id === "conditional-choice-example-067"));
  assert.ok(reviewed.mechanisms.some((row: { id: string }) => row.id === "companion-combat-damage"));
  const weaponRegistration = reviewed.mechanisms.find((row: { id: string }) => row.id === "source-unknown-starting-weapon-counts");
  assert.deepEqual(weaponRegistration.fields.startingMinimums, { hatchet: 0, knife: 0, rifle: 0 });
  assert.equal(weaponRegistration.fields.technicalInputMaximum, 30);
  assert.ok(!("compatibilityMinimums" in weaponRegistration.fields));
  const fourthOutcome = reviewed.mechanisms.find((row: { id: string }) => row.id === "user-authorized-adaptation-476-fourth-outcome");
  assert.equal(fourthOutcome.fields.adaptedUnprintedOutcome["investigator fails, Norman succeeds"], "332");
  assert.equal(fourthOutcome.authorizationDate, "2026-10-13");
  const rosterReview = reviewed.mechanisms.find((row: { id: string }) => row.id === "roster-routing-context-425-442");
  assert.equal(rosterReview.fields.section442.lostCount.includes("Charlie is not a student"), true);
  assert.equal(rosterReview.fields.section425.twoStudentsRemain, "Exactly two of Bernard/Sylvia/Norman present (plus Nadelmann); Charlie presence does not change this printed condition -> 600");
  assert.ok(rosterReview.fields.section425.entryCondition.includes("§513"));
  assert.ok(rosterReview.fields.section425.adaptedWitness.includes("105"));
  assert.ok(rosterReview.fields.section425.adaptedWitness.includes("user authorized"));
  const nextAudit = read(resolve("work/alone-against-frost/review/entry-program-audit-081-160.json"));
  assert.equal(nextAudit.runtimePlayable, false);
  assert.equal(nextAudit.sections.length, 80);
  assert.equal(nextAudit.sourceGraphSha256, sha(readFileSync(graphPath)));
  assert.ok(nextAudit.sections.every((section: { reviewStatus: string; controlParagraphs: { programStatus: string }[] }) => section.reviewStatus.includes("program semantics remain pending") && section.controlParagraphs.every((row) => row.programStatus.includes("never expose conditional outcomes as player choices"))));
  const finalAudit = read(resolve("work/alone-against-frost/review/entry-program-audit-161-240.json"));
  assert.equal(finalAudit.runtimePlayable, false);
  assert.equal(finalAudit.sections.length, 80);
  assert.equal(finalAudit.sourceGraphSha256, sha(readFileSync(graphPath)));
  assert.ok(finalAudit.sections.every((section: { reviewStatus: string; controlParagraphs: { programStatus: string }[] }) => section.reviewStatus.includes("program semantics remain pending") && section.controlParagraphs.every((row) => row.programStatus.includes("never expose conditional outcomes as player choices"))));
  const batchAudit = read(resolve("work/alone-against-frost/review/entry-program-audit-241-320.json"));
  assert.equal(batchAudit.runtimePlayable, false);
  assert.equal(batchAudit.sections.length, 80);
  assert.equal(batchAudit.sourceGraphSha256, sha(readFileSync(graphPath)));
  assert.ok(batchAudit.sections.every((section: { reviewStatus: string; controlParagraphs: { programStatus: string }[] }) => section.reviewStatus.includes("program semantics remain pending") && section.controlParagraphs.every((row) => row.programStatus.includes("never expose conditional outcomes as player choices"))));
  const previousAudit = read(resolve("work/alone-against-frost/review/entry-program-audit-321-400.json"));
  assert.equal(previousAudit.runtimePlayable, false);
  assert.equal(previousAudit.sections.length, 80);
  assert.equal(previousAudit.sourceGraphSha256, sha(readFileSync(graphPath)));
  const currentAudit = read(resolve("work/alone-against-frost/review/entry-program-audit-401-480.json"));
  assert.equal(currentAudit.runtimePlayable, false);
  assert.equal(currentAudit.sections.length, 80);
  assert.equal(currentAudit.sourceGraphSha256, sha(readFileSync(graphPath)));
  const latestAudit = read(resolve("work/alone-against-frost/review/entry-program-audit-481-560.json"));
  assert.equal(latestAudit.runtimePlayable, false);
  assert.equal(latestAudit.sections.length, 80);
  assert.equal(latestAudit.sourceGraphSha256, sha(readFileSync(graphPath)));
  assert.ok(latestAudit.sections.every((section: { reviewStatus: string; controlParagraphs: { programStatus: string }[] }) => section.reviewStatus.includes("program semantics remain pending") && section.controlParagraphs.every((row) => row.programStatus.includes("never expose conditional outcomes as player choices"))));
  const finalBatchAudit = read(resolve("work/alone-against-frost/review/entry-program-audit-561-654.json"));
  assert.equal(finalBatchAudit.runtimePlayable, false);
  assert.equal(finalBatchAudit.sections.length, 94);
  assert.equal(finalBatchAudit.sourceGraphSha256, sha(readFileSync(graphPath)));
  assert.ok(finalBatchAudit.sections.every((section: { reviewStatus: string; controlParagraphs: { programStatus: string }[] }) => section.reviewStatus.includes("program semantics remain pending") && section.controlParagraphs.every((row) => row.programStatus.includes("never expose conditional outcomes as player choices"))));
  assert.ok(currentAudit.sections.every((section: { reviewStatus: string; controlParagraphs: { programStatus: string }[] }) => section.reviewStatus.includes("program semantics remain pending") && section.controlParagraphs.every((row) => row.programStatus.includes("never expose conditional outcomes as player choices"))));
});

test("Frost full-book candidate programs cite source paragraphs and preserve fixed rule outcomes", () => {
  const candidateStory = read(resolve("work/alone-against-frost/preview/alone-against-frost/1.0.5", "story.json"));
  const review = read(resolve("scripts/alone-against-frost/review/runtime-program-001-654.json"));
  const reviewed = read(resolve("scripts/alone-against-frost/review/rules.json"));
  const candidateAudit = read(resolve("work/alone-against-frost/review/runtime-audit-001-654.json"));
  assert.equal(review.runtimePlayable, false);
  assert.deepEqual(review.compiledRange, ["1", "654"]);
  assert.equal(review.sourceGraphSha256, sha(readFileSync(graphPath)));
  assert.equal(review.sourcePdfSha256, graph.source.sha256);
  assert.equal(review.programs.filter((row: { id: string }) => /^\d+$/.test(row.id)).length, 654);
  assert.equal(candidateAudit.compiledCount, 654);
  assert.equal(candidateAudit.runtimePlayable, false);
  assert.deepEqual(candidateAudit.uncompiledEntries, []);
  for (const row of review.programs) {
    if (!/^\d+$/.test(row.id)) continue;
    const source = loadSourceFragment(graphPath, row.id);
    for (const paragraphId of row.sourceParagraphs) {
      assert.ok(source.paragraphs.some((paragraph) => paragraph.id === paragraphId && paragraph.kind === "body"), `${row.id} cites real body paragraph ${paragraphId}`);
    }
  }
  const contest = review.programs.find((row: { id: string }) => row.id === "43");
  const contestChecks = contest.program.filter((step: { kind: string }) => step.kind === "check");
  assert.deepEqual(contestChecks.map((step: { check: { actor?: string; target?: { field?: string }; skill: string } }) => [step.check.skill, step.check.actor ?? step.check.target?.field]), [
    ["dex", "charlie"],
    ["dex", "sylvia"],
    ["dex", "attribute.dex"],
    ["str", "counter.frostBernardContestStrength"],
  ]);
  assert.equal(contestChecks[3].check.opposed, 93);
  assert.deepEqual(contestChecks[3].check.success, "44");
  assert.deepEqual(contestChecks[3].check.failure, "45");
  const wolves = review.programs.find((row: { id: string }) => row.id === "286");
  assert.equal(wolves.program[1].kind, "rollEffects");
  assert.equal(wolves.program[1].effects[0].value, "2D6");
  assert.equal(wolves.program.filter((step: { kind: string }) => step.kind === "check").length, 10);
  assert.equal(review.blockedMechanisms["286"], undefined);
  const saberCat = review.programs.find((row: { id: string }) => row.id === "611");
  assert.equal(saberCat.program[0].kind, "effects");
  assert.ok(saberCat.program.some((step: { kind: string; check?: { successEffects?: { field: string; value: string }[] } }) => step.kind === "check" && step.check?.successEffects?.some((effect) => effect.field === "counter.frost611Damage" && effect.value === "2D6+4")));
  assert.equal(review.blockedMechanisms["611"], undefined);
  assert.equal(review.blockedMechanisms["612"], undefined);
  assert.ok(review.notes.some((note: string) => note.includes("user explicitly authorized an adaptation") && note.includes("§476")));
  const rollover = review.programs.find((row: { id: string }) => row.id === "331");
  assert.deepEqual(rollover.program[0].targets, ["328", "327", "328", "327", "328", "327", "328", "327", "328", "327"]);
  const insanityBlock = review.programs.find((row: { id: string }) => row.id === "364");
  assert.equal(insanityBlock.program.at(-1).kind, "random");
  assert.equal(review.blockedMechanisms["228"], undefined, "§228 runs a repeated maneuver and Dodge loop until capture or its printed knockout route");
  assert.equal(review.blockedMechanisms["307"], undefined, "§307 compiles the investigator-targeted wolf group and its small-pack branches");
  const wolf307 = review.programs.find((row: { id: string }) => row.id === "frost-307-resolve-count");
  assert.equal(wolf307.program[1].kind, "partyCombat");
  assert.equal(wolf307.program[1].combat.enemies[0].count.calc, "quotient");
  assert.equal(wolf307.program[1].combat.enemies[0].attackSkill, "fightingBrawl");
  assert.equal(wolf307.program[1].combat.enemies[0].damage, "1D8+1D4");
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-307-roll-count").program[0].effects[0].value, "2D6");
  assert.deepEqual(review.programs.find((row: { id: string }) => row.id === "frost-307-small-pack").program[0].choices.map((choice: { target: string }) => choice.target), ["271", "340"]);
  const capture228 = review.programs.find((row: { id: string }) => row.id === "228");
  assert.equal(capture228.program[0].effects[0].field, "counter.frost228StartHp");
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-228-player-turn").program[0].check.opposed, 50);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-228-player-turn").program[0].check.opposedTie, "check");
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-228-dodge").program[0].check.opposedTie, "check");
  const captureAudit = read(resolve("scripts/alone-against-frost/review/rules.json")).mechanisms.find((row: { id: string }) => row.id === "capture-fight-228");
  assert.match(captureAudit.externalRulesReference, /chaosium\.com\/rules\/combat/);
  assert.match(captureAudit.fields.buildModifier, /no opponent Build value/i);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-228-light-blow").program[0].effects[0].value, -1);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-228-enemy-choice").program[0].choices.length, 2);
  const missingNorman333 = review.programs.find((row: { id: string }) => row.id === "333");
  assert.equal(missingNorman333.program[0].target, "frost-333-roster-gap");
  assert.equal(review.programs.find((row: { id: string }) => row.id === "469").program[0].target, "frost-469-roster-gap");
  const partyNames = Object.fromEntries(candidateStory.party.members.map((member: { id: string; character: { name: string; profile?: { age?: number } } }) => [member.id, [member.character.name, member.character.profile?.age]]));
  assert.deepEqual(partyNames, { sylvia: ["西尔维娅·戴维森", 23], norman: ["诺曼·福克纳", 41], charlie: ["查理·狐尾", 35], bernard: ["伯纳德·埃布斯坦", 22] });
  for (const id of ["271", "337", "376"]) {
    assert.equal(review.blockedMechanisms[id], undefined, `${id} has a source-grounded combat program`);
  }
  const frost67 = review.programs.find((row: { id: string }) => row.id === "67");
  assert.equal(frost67.program[0].kind, "choices");
  assert.equal(frost67.program[0].choices[0].target, "frost-67-survival", "healing must continue to the printed Survival check");
  assert.equal(frost67.program[0].choices[1].target, "frost-67-survival");
  const wolf271 = review.programs.find((row: { id: string }) => row.id === "frost-271-rifle").program[0].combat;
  assert.equal(wolf271.initiative, "enemy-first");
  assert.equal(wolf271.enemies[0].attackSkill, "fightingBrawl");
  assert.equal(wolf271.enemies[0].damage, "1D8+1D4");
  assert.deepEqual(wolf271.weapons.map((weapon: { id: string }) => weapon.id), ["rifle", "hatchet-norman", "knife-norman", "fist-norman"], "the shoot action must not expose the melee-only player choice");
  assert.equal(wolf271.weapons[0].fumbleTarget, "norman");
  const wind337 = review.programs.find((row: { id: string }) => row.id === "337").program;
  assert.equal(wind337[1].kind, "partyCombat");
  assert.equal(wind337[1].combat.enemies[0].hp.field, "counter.frost337WindwalkerHp");
  assert.equal(wind337[1].combat.enemies[0].damage, "1D8+1D6");
  const ape376 = review.programs.find((row: { id: string }) => row.id === "376").program[1].combat;
  assert.equal(ape376.enemies[0].maxHp, 18);
  assert.equal(ape376.enemies[0].attackSkill, "fightingBrawl");
  assert.equal(ape376.enemies[0].damage, "2D6");
  assert.deepEqual(ape376.routes.map((route: { target: string }) => route.target), ["191", "191", "341", "378"]);
  assert.equal(ape376.routes[0].condition.all[0].field, "hp", "authorized §376 adaptation routes investigator HP 0 with Norman alive to §191");
  const wildReturn513 = review.programs.find((row: { id: string }) => row.id === "513").program[0].choices[2];
  assert.equal(wildReturn513.target, "425");
  assert.equal(wildReturn513.condition.all[1].not.all[0].field, "party.charlie.present", "authorized roster adaptation hides wild-return only for Charlie + exactly one student");
  assert.equal(review.blockedMechanisms["425"], undefined, "the witnessed roster is no longer reachable through §513 in this authorized candidate");
  assert.equal(review.blockedMechanisms["456"], undefined, "the user-authorized §456 fallback closes larger-loss routes");
  const windWalker = review.programs.find((row: { id: string }) => row.id === "186");
  const windWalkerBattle = windWalker.program.find((step: { kind: string }) => step.kind === "partyCombat");
  assert.ok(windWalkerBattle);
  assert.equal(windWalkerBattle.combat.enemies[0].hp, 17);
  assert.equal(windWalkerBattle.combat.enemies[0].stopAtHp, 2, "the wind-walker flees below 3 HP");
  assert.equal(windWalkerBattle.combat.initiative, "enemy-first");
  assert.equal(windWalkerBattle.combat.roundCalls[0].afterRound, 2);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-186-sanity").program.filter((step: { kind: string }) => step.kind === "check").length, 2);
  assert.equal(review.blockedMechanisms["186"], undefined);
  const sasquatchFight = review.programs.find((row: { id: string }) => row.id === "391");
  const partyBattle = sasquatchFight.program.find((step: { kind: string }) => step.kind === "partyCombat");
  assert.ok(partyBattle);
  assert.equal(partyBattle.combat.enemies[0].count, 2);
  assert.equal(partyBattle.combat.enemies[0].hp, 18);
  assert.equal(partyBattle.combat.enemies[0].damage, "2D6");
  assert.equal(partyBattle.combat.routes[0].target, "392");
  assert.equal(partyBattle.combat.routes[0].condition.all.length, 2);
  assert.equal(partyBattle.combat.options.length, 2, "surrender is available with the sourced Sylvia-dependent destination");
  assert.equal(review.blockedMechanisms["391"], undefined);
  const infection = review.programs.find((row: { id: string }) => row.id === "392");
  assert.equal(infection.program[0].condition.field, "counter.frost391DamageTaken");
  assert.equal(infection.program[0].check.success, "343");
  assert.equal(infection.program[0].check.failure, "342");
  assert.equal(infection.program[1].target, "365");
  assert.equal(review.blockedMechanisms["392"], undefined);
  const compiled391 = candidateStory.nodes.find((node: { id: string }) => node.id === "391");
  assert.equal(compiled391.healthRouting.injury, "source", "approved HP-0 fallback is resolved by the §391-specific loss route");
  assert.equal(read(resolve("scripts/alone-against-frost/review/rules.json")).mechanisms.find((row: { id: string }) => row.id === "user-authorized-hp-zero-no-major-adaptation-355-391-616").authorizationDate, "2026-10-14");
  for (const [id, helper] of [["355", "frost-355-survival"], ["391", "frost-391-party-lost"], ["616", "frost-616-damage"]]) {
    const steps = review.programs.find((row: { id: string }) => row.id === helper).program;
    assert.ok(steps.some((step: { kind: string; target?: string }) => step.kind === "route" && step.target === "191"), `§${id} adaptation must route zero HP to §191`);
  }
  assert.equal(candidateStory.nodes.find((node: { id: string }) => node.id === "186").healthRouting.injury, "source");
  assert.equal(review.blockedMechanisms["456"], undefined, "§456 larger-loss states reuse the printed §437 continuation");
  assert.equal(review.blockedMechanisms["425"], undefined, "the user-authorized §513 roster adaptation removes the witnessed unsupported roster from play");
  for (const id of ["135", "165", "197", "201", "203", "217", "250", "257", "286", "288", "289", "290", "306", "310", "316", "318", "333", "340", "359", "366", "369", "371", "378", "380", "383", "391", "392", "394", "398", "421", "430", "449", "450", "451", "452", "457", "469", "474", "479", "480", "513", "532", "554", "563", "622", "630", "632"]) {
    assert.equal(review.blockedMechanisms[id], undefined, `${id} encodes its sourced sequence instead of a generic blocker`);
  }
  for (const id of ["385", "407"]) {
    assert.equal(review.blockedMechanisms[id], undefined);
    const main = review.programs.find((row: { id: string }) => row.id === id);
    assert.equal(main.program[1].kind, "call");
    assert.deepEqual(main.program.at(-1), { kind: "route", target: id === "407" ? "frost-407-smoke-ending" : "frost-385-drowning-ending" });
  }
  for (const id of ["412", "512", "514", "536"]) {
    assert.equal(review.blockedMechanisms[id], undefined);
    const main = review.programs.find((row: { id: string }) => row.id === id);
    assert.equal(main.program[1].kind, "call");
    assert.ok(review.programs.some((row: { id: string }) => row.id === `frost-${id}-drowning-loop`));
    const drowning = review.programs.find((row: { id: string }) => row.id === `frost-${id}-drowning-loop`);
    assert.ok(drowning.program.some((step: { kind: string; check?: { skill: string } }) => step.kind === "check" && step.check?.skill === "swim"));
    assert.ok(drowning.program.some((step: { kind: string; check?: { skill: string; failureEffects?: unknown[] } }) => step.kind === "check" && step.check?.skill === "con" && step.check.failureEffects?.length));
  }
  assert.equal(review.blockedMechanisms["189"], undefined);
  const underWater = review.programs.find((row: { id: string }) => row.id === "189");
  assert.deepEqual(underWater.program[1].targets, Array.from({ length: 6 }, (_, index) => `frost-189-round-${index + 1}`));
  const lastChance = review.programs.find((row: { id: string }) => row.id === "frost-189-last-chance");
  assert.deepEqual(lastChance.program.slice(1, 3).map((step: { check: { skill: string } }) => step.check.skill), ["swim", "con"]);
  assert.equal(lastChance.program.at(-2).target, "191");
  for (const id of ["59", "354", "433"]) assert.equal(review.blockedMechanisms[id], undefined);
  const weakestStealth = review.programs.find((row: { id: string }) => row.id === "59");
  assert.equal(weakestStealth.program.filter((step: { kind: string }) => step.kind === "check").length, 5);
  assert.ok(weakestStealth.program.some((step: { condition?: { all?: unknown[] } }) => step.condition?.all?.length));
  const chase = review.programs.find((row: { id: string }) => row.id === "354");
  assert.deepEqual(chase.program.filter((step: { kind: string }) => step.kind === "check").map((step: { check: { actor?: string; record?: { grade?: string } } }) => [step.check.actor ?? "player", step.check.record?.grade]), [["player", "frost354PlayerGrade"], ["norman", "frost354NormanGrade"]]);
  const liability = review.programs.find((row: { id: string }) => row.id === "433");
  assert.ok(liability.program.some((step: { kind: string; effects?: { value: string }[] }) => step.kind === "rollEffects" && step.effects?.some((effect) => effect.value === "1D100")));
  for (const id of ["425", "442", "456"]) {
    const routeProgram = review.programs.find((row: { id: string }) => row.id === id);
    assert.equal(routeProgram.program.filter((step: { kind: string }) => step.kind === "route").length, id === "425" ? 4 : 2 + (id === "442" ? 2 : 0));
    if (id === "442") {
      assert.equal(routeProgram.program.filter((step: { kind: string }) => step.kind === "route").length, 4);
      assert.equal(routeProgram.program.at(-1).target, "67");
      assert.equal(review.blockedMechanisms[id], undefined);
      assert.equal(routeProgram.program[0].effects[0].field, "counter.frost442LostStudents");
      assert.deepEqual(routeProgram.program.filter((step: { kind: string }) => step.kind === "route").map((step: { target: string }) => step.target), ["158", "324", "279", "67"]);
      assert.ok(routeProgram.program.filter((step: { kind: string }) => step.kind === "effects").every((step: { condition?: { field?: string } }) => !step.condition || ["party.bernard.present", "party.sylvia.present", "party.norman.present"].includes(step.condition.field ?? "")));
    } else if (id === "425") {
      assert.equal(routeProgram.program.at(-1).kind, "end", "the original source gap remains documented in the candidate graph");
      assert.equal(review.blockedMechanisms[id], undefined, "the only witnessed unsupported roster is blocked upstream by the user-authorized §513 adaptation");
    } else {
      assert.ok(routeProgram.program.some((step: { kind: string; target?: string }) => step.kind === "route" && step.target === "437"), "§456 reuses the printed lost-party continuation");
      assert.equal(review.blockedMechanisms[id], undefined, `user-authorized fallback closes §${id}`);
    }
  }
  const roster425 = review.programs.find((row: { id: string }) => row.id === "425");
  assert.equal(roster425.program[3].condition.any.length, 3, "§600 covers exactly two surviving students regardless of Charlie's presence");
  for (const pair of roster425.program[3].condition.any) {
    assert.equal(pair.all.filter((predicate: { field: string; value: number }) => predicate.field.endsWith(".present") && predicate.value === 1).length, 2);
  }
  assert.equal(review.blockedMechanisms["425"], undefined);
  const liabilityAudit = review.programs.find((row: { id: string }) => row.id === "433");
  assert.ok(liabilityAudit.program.some((step: { kind: string; condition?: { any?: unknown[] } }) => step.kind === "effects" && step.condition?.any?.length === 2));
  assert.equal(review.blockedMechanisms["544"], undefined);
  const groupAid544 = review.programs.find((row: { id: string }) => row.id === "544");
  assert.equal(groupAid544.program[0].check.successEffects.length, 3);
  assert.ok(groupAid544.program[0].check.successEffects.every((effect: { value: string }) => effect.value === "1D3"));
  for (const id of ["533", "537"]) assert.equal(review.blockedMechanisms[id], undefined);
  const firstAid533 = review.programs.find((row: { id: string }) => row.id === "frost-533-first-aid");
  assert.deepEqual(firstAid533.program.filter((step: { kind: string }) => step.kind === "check").map((step: { check: { skill: string } }) => step.check.skill), ["firstAid", "firstAid"]);
  const cappedHeal537 = review.programs.find((row: { id: string }) => row.id === "frost-537-heal");
  assert.deepEqual(cappedHeal537.program[1].effects[0].value, { calc: "min", values: [{ field: "counter.frost537HealRoll" }, { calc: "difference", values: [{ field: "counter.frost536StartHp" }, { field: "hp" }] }] });
  for (const [id, threshold, target] of [["325", 8, "373"], ["423", 9, "373"], ["508", 12, "509"]] as const) {
    assert.equal(review.blockedMechanisms[id], undefined);
    const attack = review.programs.find((row: { id: string }) => row.id === id);
    const hitTarget = review.programs.find((row: { id: string }) => row.id === `frost-${id}-damage`);
    assert.equal(hitTarget.program[0].effects[0].value, "2D6+4");
    assert.equal(hitTarget.program[1].target, target);
    assert.equal(hitTarget.program[1].condition.value, threshold);
    assert.ok(attack.program.some((step: { kind: string; check?: { skill: string; difficulty?: string } }) => step.kind === "check" && step.check?.skill === "firearmsRifleShotgun" && (id !== "325" || step.check.difficulty === "hard")));
  }
  assert.equal(review.blockedMechanisms["517"], undefined);
  const sustainedFire = review.programs.find((row: { id: string }) => row.id === "517");
  assert.equal(sustainedFire.program[1].effects[0].value, "1D4+1");
  const conChecks517 = sustainedFire.program.filter((step: { kind: string; check?: { skill: string } }) => step.kind === "check" && step.check?.skill === "con");
  assert.deepEqual(conChecks517.map((step: { check: { bonus?: number; penalty?: number } }) => [step.check.bonus ?? 0, step.check.penalty ?? 0]), [[1, 0], [1, 0], [0, 0], [0, 0]]);
  const penaltyLoop517 = review.programs.find((row: { id: string }) => row.id === "frost-517-penalty-loop");
  assert.equal(penaltyLoop517.program[1].check.penalty, 1);
  const improvement = review.programs.find((row: { id: string }) => row.id === "654");
  assert.equal(improvement.program[0].check.record.roll, "frost654roll");
  assert.equal(improvement.program[1].condition.op, "gt");
  assert.equal(improvement.program[1].condition.field, "counter.frost654roll");
  assert.equal(improvement.program[1].condition.value.field, "counter.frost654target");
  assert.equal(review.blockedMechanisms["654"], undefined);
  const grade453 = review.programs.find((row: { id: string }) => row.id === "453");
  assert.deepEqual(grade453.program.at(-1).target, "454");
  assert.equal(grade453.program[1].check.record.grade, "frost453grade");
  const grade213 = review.programs.find((row: { id: string }) => row.id === "213");
  assert.equal(grade213.program[0].check.record.grade, "frost213grade");
  assert.equal(candidateAudit.blockedMechanisms["228"], undefined);
  for (const id of ["135", "366", "380", "479", "632"]) assert.equal(review.blockedMechanisms[id], undefined);
  for (const id of ["289", "290", "306", "310", "318", "371", "622", "630"]) assert.equal(review.blockedMechanisms[id], undefined);
  const sourceInsanity = review.programs.find((row: { id: string }) => row.id === "frost-source-insanity-check");
  assert.equal(sourceInsanity.program[1].check.skill, "int");
  assert.equal(sourceInsanity.program[1].check.success, "$return");
  assert.equal(sourceInsanity.program[1].check.failure, "$return");
  assert.equal(sourceInsanity.program[1].check.successEffects[0].value, "temporary");
  const restraints = review.programs.find((row: { id: string }) => row.id === "563");
  assert.equal(restraints.program[1].choices.length, 2);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-563-norman-first-choice").program[0].choices.length, 2);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-563-player-second-choice").program[0].choices.length, 2);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-563-norman-second-choice").program[0].choices.length, 2);
  const sane199 = review.programs.find((row: { id: string }) => row.id === "frost-197-norman");
  assert.equal(sane199.program.at(-2).target, "frost-197-sylvia", "a missing Norman is skipped while the source sequence continues");
  assert.equal(sane199.program.at(-1).target, "235", "an unconscious present Norman follows the source failed-roll consequence instead of falling through");
  const sane199Sylvia = review.programs.find((row: { id: string }) => row.id === "frost-197-sylvia");
  assert.equal(sane199Sylvia.program.at(-2).target, "198", "a missing Sylvia is not treated as a failed roll");
  assert.equal(sane199Sylvia.program.at(-1).target, "237", "a present but unconscious Sylvia follows the source failed-roll consequence");
  const waking283 = review.programs.find((row: { id: string }) => row.id === "283");
  assert.deepEqual(waking283.program[0].effects[0], { op: "party", member: "sylvia", action: "restore" });
  assert.equal(waking283.program[1].check.actor, "sylvia");
  const waking260 = review.programs.find((row: { id: string }) => row.id === "260");
  assert.deepEqual(waking260.program[0].condition, { field: "party.sylvia.dead", op: "eq", value: 0 });
  assert.deepEqual(waking260.program[0].effects, [
    { op: "party", member: "sylvia", action: "status", value: "present" },
  ]);
  assert.deepEqual(waking260.program[1].condition, { field: "party.sylvia.dead", op: "eq", value: 0 });
  assert.deepEqual(waking260.program[1].effects, [{ op: "party", member: "sylvia", action: "restore" }]);
  assert.equal(waking260.program[2].check.actor, "sylvia");
  assert.deepEqual(waking260.program[2].condition, { field: "party.sylvia.dead", op: "eq", value: 0 });
  assert.deepEqual(waking260.program[3], { kind: "route", target: "255", condition: { field: "party.sylvia.dead", op: "eq", value: 1 } }, "a direct legacy §260 entry reuses the already-printed §255 outcome without reviving Sylvia");
  assert.deepEqual(waking260.sourceParagraphs, ["260:p1", "260:p2", "260:p3"]);
  const escape563 = review.programs.find((row: { id: string }) => row.id === "563");
  assert.deepEqual(escape563.program[0].effects[2], { op: "party", member: "norman", action: "restore" });
  assert.ok(escape563.sourceParagraphs.includes("563:p1"), "Norman struggles in the source before the escape checks");
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-563-norman-first-str").program[0].check.actor, "norman");
  const dex566 = review.programs.find((row: { id: string }) => row.id === "566");
  assert.equal(dex566.program[1].check.difficulty, "extreme");
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-566-norman").program[0].check.actor, "norman");
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-566-sylvia").program[0].check.actor, "sylvia");
  const shooterFlow632 = review.programs.find((row: { id: string }) => row.id === "632");
  const shooterChecks632 = shooterFlow632.program.filter((step: { kind: string; check?: { skill: string } }) => step.kind === "check" && step.check?.skill === "sanity");
  assert.equal(shooterChecks632.length, 4);
  for (const [index, member] of ["charlie", "bernard", "sylvia", "norman"].entries()) {
    assert.equal(shooterChecks632[index].check.actor, member);
    assert.equal(shooterFlow632.program[shooterFlow632.program.indexOf(shooterChecks632[index]) + 1].target, `frost-632-next-${member}`, "condition-false shooters continue to the next source participant");
  }
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-632-next-norman").program.at(-2).condition.field, "counter.frost632Hits", "only actual hits select the creature-killed destination");
  const doubleSanity = review.programs.find((row: { id: string }) => row.id === "290");
  assert.deepEqual(doubleSanity.program.filter((step: { kind: string }) => step.kind === "check").map((step: { check: { target?: { field: string } } }) => step.check.target?.field ?? "investigator"), ["investigator", "party.norman.sanity"]);
  const orderedInsanity = review.programs.find((row: { id: string }) => row.id === "622");
  assert.deepEqual(orderedInsanity.program.filter((step: { kind: string }) => step.kind === "route").map((step: { target: string }) => step.target), ["550", "646", "364", "623"]);
  const nightShots = review.programs.find((row: { id: string }) => row.id === "135");
  assert.ok(nightShots.program.some((step: { kind: string; check?: { skill: string; successEffects?: { field: string }[] } }) => step.kind === "check" && step.check?.skill === "dex"));
  assert.ok(nightShots.program.some((step: { kind: string; target?: string }) => step.kind === "route" && step.target === "202"));
  const pointBlank = review.programs.find((row: { id: string }) => row.id === "366");
  assert.equal(pointBlank.program.filter((step: { kind: string }) => step.kind === "call").length, 5);
  assert.ok(review.programs.some((row: { id: string; program: { kind: string; check?: { bonus?: number } }[] }) => row.id === "frost-366-shot-player" && row.program[0].check?.bonus === 1));
  const alienSalvo = review.programs.find((row: { id: string }) => row.id === "380");
  assert.equal(alienSalvo.program.filter((step: { kind: string; check?: { skill: string } }) => step.kind === "check" && step.check?.skill === "firearmsRifleShotgun").length, 6);
  const carriedHit = review.programs.find((row: { id: string }) => row.id === "479");
  assert.equal(carriedHit.program[0].effects[0].value, 1);
  assert.equal(carriedHit.program[0].effects[1].field, "skill.cthulhuMythos");
  const sanityShots = review.programs.find((row: { id: string }) => row.id === "632");
  assert.equal(sanityShots.program.filter((step: { kind: string; check?: { skill: string } }) => step.kind === "check" && step.check?.skill === "sanity").length, 4);
  const hunters285 = review.programs.find((row: { id: string }) => row.id === "285");
  assert.equal(review.blockedMechanisms["285"], undefined);
  assert.equal(hunters285.program[0].check.opposed, 60);
  assert.equal(hunters285.program[0].check.bonus, 1);
  assert.equal(hunters285.program[0].check.opposedPenalty, 1);
  assert.equal(hunters285.program[0].check.success, "frost-285-second");
  const pack = resolve("work/alone-against-frost/preview/alone-against-frost/1.0.5");
  const story = read(resolve(pack, "story.json"));
  assert.equal(story.version, "1.0.5");
  const reunion394 = review.programs.find((row: { id: string }) => row.id === "394");
  assert.equal(reunion394.program[0].target, "frost-394-roster-gap");
  assert.deepEqual(reunion394.program[1].effects.filter((effect: { op: string }) => effect.op === "party").map((effect: { member: string; action: string }) => [effect.member, effect.action]), [["sylvia", "status"], ["sylvia", "restore"]]);
  const smokeEnd = story.nodes.find((node: { id: string }) => node.id === "frost-407-smoke-ending");
  assert.equal(smokeEnd.title, "探险结束");
  assert.equal(smokeEnd.chapter, "探险结束");
  assert.match(smokeEnd.program[0].label, /探险结束/);
  for (const id of ["425", "456"]) {
    const sourceNode = story.nodes.find((node: { id: string }) => node.id === id);
    assert.equal(sourceNode.program[0].kind, "choices", `§${id} narrative must be shown before automatic routing`);
    assert.equal(sourceNode.program[0].choices[0].target, `frost-auto-${id}`);
    const helper = story.nodes.find((node: { id: string }) => node.id === `frost-auto-${id}`);
    if (id === "456") assert.ok(helper.program.some((step: { kind: string; target?: string }) => step.kind === "route" && step.target === "437"), "the adapted larger-loss route uses the printed §437 continuation");
    else assert.ok(helper.program.some((step: { kind: string }) => step.kind === "end"), `§${id} unresolved terminal remains in the helper after its narrative`);
  }
  const at513 = review.programs.find((row: { id: string }) => row.id === "513").program[0].choices;
  const shortTrip = at513.find((row: { target: string }) => row.target === "594");
  assert.equal(shortTrip.condition.any.length, 6, "the short trip is exposed only for the six user-approved, source-resolved rosters");
  const section594 = review.programs.find((row: { id: string }) => row.id === "594");
  assert.deepEqual(section594.program.slice(0, 6).map((step: { target: string }) => step.target), ["602", "158", "598", "324", "279", "597"]);
  assert.deepEqual(section594.program.at(-1), { kind: "route", target: "593" }, "an unsupported legacy/direct §594 roster returns to the printed §593 option");
  const rosterAudit = reviewed.mechanisms.find((row: { id: string }) => row.id === "user-authorized-594-roster-guard");
  assert.match(rosterAudit.review, /authorized web adaptation/i);
  assert.match(rosterAudit.review, /2026-10-14|user authorized/i);
  const sourceLethalEnds = story.nodes.filter((node: { id: string; program?: Array<{ kind: string; label?: string; collect?: boolean }> }) => (node.id.endsWith("-drowning-ending") || node.id === "frost-407-smoke-ending") && node.program?.some((step) => step.kind === "end" && step.label?.includes("探险结束") && step.collect !== false));
  assert.deepEqual(sourceLethalEnds.map((node: { id: string }) => node.id).sort(), ["frost-12-drowning-ending", "frost-189-drowning-ending", "frost-385-drowning-ending", "frost-407-smoke-ending", "frost-412-drowning-ending", "frost-512-drowning-ending", "frost-514-drowning-ending", "frost-536-drowning-ending"].sort(), "distinct source events retain their own ending IDs; §407 is smoke inhalation, not drowning");
  for (const id of ["12", "189", "385", "407", "412", "512", "514", "536"]) {
    const relevant = review.programs.filter((entry: { id: string }) => entry.id === id || entry.id.startsWith(`frost-${id}-`));
    const ending = id === "407" ? "frost-407-smoke-ending" : `frost-${id}-drowning-ending`;
    assert.ok(relevant.some((row: { program: Array<{ kind: string; target?: string }> }) => row.program.some((step) => step.kind === "route" && step.target === ending)), `§${id} funnels its death route into its own canonical ending`);
  }
  assert.equal(story.entry, "0");
  assert.equal(story.healthPolicy, "frost");
  for (const id of ["189", "385", "407", "412", "512", "514", "536"]) {
    assert.deepEqual(story.nodes.find((node: { id: string }) => node.id === id).healthRouting, { injury: "source" }, `§${id} follows its printed drowning/death route at zero HP`);
    assert.ok(story.nodes.filter((node: { id: string; sourceId?: string }) => node.id.startsWith(`frost-${id}-`)).every((node: { healthRouting?: { injury?: string } }) => node.healthRouting?.injury === "source"), `§${id} helper nodes preserve source injury routing`);
  }
  for (const id of ["289", "290", "306", "318", "371", "622", "630"]) {
    assert.deepEqual(story.nodes.find((node: { id: string }) => node.id === id).healthRouting, { sanity: "source" });
  }
  assert.deepEqual(story.nodes.find((node: {id:string}) => node.id === "frost-insanity-check").program[0].check.failure, "$return");
  assert.deepEqual(story.nodes.find((node: {id:string}) => node.id === "frost-major-wound-check").program[0].check.failure, "191");
  assert.ok(story.nodes.some((node: { id: string }) => node.id === "frost-insanity-check"));
  assert.ok(story.nodes.some((node: { id: string }) => node.id === "frost-major-wound-check"));
  assert.equal(story.nodes.some((node: { id: string }) => node.id === "240"), true);
  assert.equal(story.nodes.some((node: { id: string }) => node.id === "241"), true);
  for (const id of ["6", "642"]) {
    const section = story.nodes.find((node: { id: string }) => node.id === id);
    assert.deepEqual(section.program[0].choices.map((item: { target: string }) => item.target), [`frost-auto-${id}`]);
    const helper = story.nodes.find((node: { id: string }) => node.id === `frost-auto-${id}`);
    assert.ok(helper.program.some((step: { kind: string; target?: string }) => step.kind === "route"));
    assert.deepEqual(helper.text, section.text);
  }
  assert.deepEqual(review.programs.find((row: { id: string }) => row.id === "235").program[0].effects[0], { op: "party", member: "norman", action: "unconscious", value: true });
  assert.deepEqual(review.programs.find((row: { id: string }) => row.id === "237").program[0].effects[0], { op: "party", member: "sylvia", action: "unconscious", value: true });
  const creation = story.nodes.find((node: { id: string }) => node.id === "0");
  assert.deepEqual(creation.program.filter((step: { kind: string }) => step.kind === "distribute").map((step: { key: string }) => step.key), ["hatchet", "knife", "rifle"]);
  assert.deepEqual(creation.program.filter((step: { kind: string }) => step.kind === "number").map((step: { min: number; max: number }) => [step.min, step.max]), [[0, 30], [0, 30], [0, 30]]);
  const section13 = story.nodes.find((node: { id: string }) => node.id === "13");
  assert.equal(section13.program[0].kind, "choices");
  const section25 = story.nodes.find((node: { id: string }) => node.id === "25");
  assert.equal(section25.program[0].choices[0].target, "frost-25-weapons");
  assert.equal(review.blockedMechanisms["270"], undefined);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "270").program[0].choices.length, 3);
  assert.equal(review.blockedMechanisms["279"], undefined);
  assert.deepEqual(review.programs.find((row: { id: string }) => row.id === "frost-279-paths").program[0].choices.map((choice: { target?: string; call?: string }) => choice.target ?? choice.call ?? ""), ["295", "280", "297", "595", "frost-279-camp-luck"]);
  assert.equal(review.programs.find((row: { id: string }) => row.id === "frost-279-camp-luck").program[0].check.success, "296");
  const combined292 = review.programs.find((row: { id: string }) => row.id === "292");
  assert.deepEqual(combined292.program.filter((step: { kind: string }) => step.kind === "check").map((step: { check: { skill: string } }) => step.check.skill), ["track", "luck"]);
  assert.deepEqual(combined292.program.slice(-4).map((step: { target: string }) => step.target), ["290", "315", "289", "314"]);
  assert.equal(review.blockedMechanisms["292"], undefined);
  const stampede321 = review.programs.find((row: { id: string }) => row.id === "frost-321-damage");
  assert.equal(stampede321.program[0].effects[0].value, "-4D6");
  assert.equal(stampede321.program[0].effects[1].value, "-4D6");
  assert.deepEqual(stampede321.program.slice(1).map((step: { kind: string; target?: string }) => [step.kind, step.target]), [["route", "347"], ["end", undefined]]);
  assert.equal(review.blockedMechanisms["321"], undefined);
  for (const id of ["221", "321", "363"]) assert.equal(candidateStory.nodes.find((node: { id: string }) => node.id === id).healthRouting.injury, "source", `§${id} preserves its explicit printed THE END instead of generic 191 routing`);
  for (const id of ["355", "391", "616"]) assert.equal(candidateStory.nodes.find((node: { id: string }) => node.id === id).healthRouting.injury, "source", `§${id} applies the authorized, source-specific HP-0 fallback`);
  for (const id of ["frost-355-survival", "frost-391-party-lost", "frost-616-damage"]) {
    const helper = candidateStory.nodes.find((node: { id: string }) => node.id === id);
    assert.ok(helper.program.some((step: { kind: string; target?: string }) => step.kind === "route" && step.target === "191"), `${id} has the approved HP-0 route`);
    assert.ok(!helper.program.some((step: { kind: string; collect?: boolean }) => step.kind === "end" && step.collect !== false), `${id} does not invent a collectible source ending`);
  }
  for (const [id, success, failure] of [["frost-581-stealth", "582", "584"], ["586", "587", "570"]]) {
    const least = review.programs.find((row: { id: string }) => row.id === id);
    assert.equal(least.program.length, 5);
    assert.deepEqual(least.program.map((step: { check: { actor?: string; success: string; failure: string } }) => [step.check.actor ?? "$player", step.check.success, step.check.failure]), Array.from(["$player", "charlie", "bernard", "sylvia", "norman"], (actor) => [actor, success, failure]));
  }
  assert.equal(review.blockedMechanisms["581"], undefined);
  assert.equal(review.blockedMechanisms["586"], undefined);
  assert.ok(review.notes.some((note: string) => note.includes("§§581/586") && note.includes("ties unspecified")));
  const restore = story.nodes.find((node: { id: string }) => node.id === "frost-25-weapons");
  assert.equal(restore.program[0].kind, "effects");
  const correctedStart = review.programs.find((row: { id: string }) => row.id === "frost-13-inconsistent-rifles-4");
  assert.equal(correctedStart.program[0].kind, "number");
  assert.match(correctedStart.program[0].label, /不重掷本骰/);
  assert.equal(correctedStart.program[1].kind, "distribute");
  assert.equal(correctedStart.program.at(-1).target, "frost-13-rifles-4");
  const corrected45 = review.programs.find((row: { id: string }) => row.id === "frost-45-rifle-source-conflict-3");
  assert.equal(corrected45.program[0].kind, "number");
  assert.equal(corrected45.program.at(-1).target, "frost-45-rifle-count-2");
  assert.equal(restore.program[0].effects.filter((effect: { op: string }) => effect.op === "item-count").length, 15);
  const section45 = story.nodes.find((node: { id: string }) => node.id === "45");
  assert.deepEqual(section45.program[0].choices.map((choice: { target: string }) => choice.target), ["frost-auto-45"]);
  const afterSection45 = story.nodes.find((node: { id: string }) => node.id === "frost-auto-45");
  assert.deepEqual(afterSection45.program[0].effects.filter((effect: { op: string }) => effect.op === "party").map((effect: { member: string; value: string }) => [effect.member, effect.value]), [["charlie", "dead"], ["bernard", "dead"]]);
  const section156 = review.programs.find((row: { id: string }) => row.id === "156");
  assert.equal(section156.program[0].effects[0].value, "missing");
  const remaining156 = review.programs.find((row: { id: string }) => row.id === "frost-156-hatchet-count-0");
  assert.equal(remaining156.program[1].kind, "route");
  assert.equal(remaining156.program[2].kind, "distribute");
  const groupConflict = review.programs.find((row: { id: string }) => row.id === "frost-203-stealth");
  assert.equal(groupConflict.program[0].kind, "effects");
  assert.equal(review.blockedMechanisms["203"], undefined);
  assert.equal(sha(readFileSync(resolve(pack, "story.json"))), candidateAudit.candidateSha256);
});
