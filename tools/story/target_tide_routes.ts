/** Construct rare ending witnesses using legal choices and valid draws; no state edits. */
import { readFileSync, writeFileSync } from "node:fs";
import { loadStories } from "../../apps/api/src/catalog.js";
import { initialState, advance, project } from "../../packages/engine/index.js";
import { createCharacter } from "../../packages/rules/index.js";
import type { RunState } from "../../packages/contracts/index.js";
const story = loadStories(process.env.TIDE_ROOT ?? "stories").get(
  "alone-against-tide@1.0.1",
)!;
const path = "work/alone-against-tide/routes.json";
const report = JSON.parse(readFileSync(path, "utf8"));
for (const role of [0, 1, 2])
  for (const ending of [
    "239",
    "243",
    "51-death",
    "68-death",
    "119-death",
    "121-death",
    "132-death",
    "169-death",
    "142-death",
    "145-death",
    "125-death",
    "192",
    "217",
    "213",
    "226",
    "220",
    "95",
  ]) {
    let mode = "pass",
      draws: { min: number; max: number; value: number }[] = [];
    const dice = (min: number, max: number) => {
      const value =
        min === 0
          ? mode === "fail"
            ? 0
            : draws.some((d) => d.min === 0)
              ? 0
              : 1
          : mode === "madness" || mode === "fail"
            ? max - 1
            : min;
      draws.push({ min, max, value });
      return value;
    };
    let state: RunState = initialState(
      story,
      createCharacter("稀有路线验收", story.presets[role], 0),
      dice,
    );
    const initialDraws = draws,
      steps: unknown[] = [];
    function act(action?: string, input: Record<string, number | string> = {}) {
      const scene = project(story, state, "audit", steps.length);
      const chosen = action
        ? scene.actions.find((a) => a.id === action)
        : scene.actions.length === 1
          ? scene.actions[0]
          : undefined;
      if (!chosen)
        throw Error(
          `invalid action ${state.nodeId} ${action}: ${JSON.stringify(scene.actions)}`,
        );
      const node = state.nodeId;
      draws = [];
      state = advance(story, state, chosen.id, dice, input).state;
      steps.push({
        node,
        action: chosen.id,
        input,
        draws,
        resultNode: state.nodeId,
      });
    }
    function to(target: string | number) {
      const scene = project(story, state, "audit", steps.length);
      const step = story.nodes.find((n) => n.id === state.nodeId)!.program![
        state.program!.cursor
      ];
      if (step.kind !== "choices")
        throw Error(`expected choices ${state.nodeId}`);
      const choice = step.choices.find((c) => c.target === String(target));
      if (!choice) throw Error(`missing target ${state.nodeId} -> ${target}`);
      act(scene.actions.length === 1 ? "next" : choice.id);
    }
    function pass() {
      mode = "pass";
      act();
    }
    function fail() {
      mode = "fail";
      act();
      mode = "pass";
    }
    function input() {
      const scene = project(story, state, "audit", steps.length),
        a = scene.input!;
      if (a.kind !== "allocation") throw Error("missing allocation");
      const cfg = a.allocation;
      let values: Record<string, number | string> = {};
      if (cfg.kind === "attributes")
        values = Object.fromEntries(
          a.skills.map((s, i) => [s.key, cfg.values![i]]),
        );
      else if (cfg.kind === "bonus")
        values = { locksmith: 30, swim: 20, climb: 20 };
      else {
        let keys =
          cfg.kind === "interests"
            ? []
            : [
                ...(cfg.required ?? []),
                ...(cfg.includeCredit ? ["creditRating"] : []),
                ...(cfg.optional?.length ? [cfg.optional[0]] : []),
                ...(cfg.groups ?? []).map((g) => g[0]),
              ];
        const n =
          cfg.kind === "interests" ? (cfg.count ?? 4) : cfg.values!.length;
        for (const skill of a.skills)
          if (
            keys.length < n &&
            !["cthulhuMythos", "creditRating"].includes(skill.key) &&
            !keys.includes(skill.key)
          )
            keys.push(skill.key);
        values = Object.fromEntries(
          keys.map((k, i) => [
            k,
            cfg.kind === "interests" ? 20 : cfg.values![i],
          ]),
        );
        for (const [key, rule] of Object.entries(cfg.specializations ?? {}))
          if (keys.includes(key))
            values["specialty." + key] = rule.fixed ?? "阿拉伯语";
      }
      act("allocate", values);
    }
    // Creation really executes the same instructions as a player, including luck dice.
    to(12);
    if (role === 0) {
      input();
      to(80);
      to("80-23");
      input();
      input();
      pass();
      to(23);
    } else {
      to(80);
      input();
      pass();
      to(23);
    }
    to(56);
    to(3);
    function lake() {
      to(26);
      to(9);
      to(106);
      to(153);
      to(122);
      to(109);
      to(124);
      to(158);
      pass();
    }
    function loop() {
      lake();
      fail();
      to(18);
      to(56);
      to(3);
    }
    if (ending.includes("-death")) while (state.character.hp > 1) loop();
    if (ending === "119-death") {
      lake();
      fail();
    } else if (ending === "51-death") {
      to(26);
      to(9);
      to(106);
      to(153);
      to(122);
      to(109);
      to(124);
      to(158);
      fail();
      mode = "madness"; // Large damage roll; D100 must still fail.
      mode = "fail";
      act();
      mode = "pass";
      if (state.status === "active") {
        to("51-death");
      }
    } else if (ending === "142-death") {
      to(26);
      to(9);
      to(106);
      to(153);
      to(122);
      to(142);
      to("142-brawl");
      fail();
    } else if (ending === "169-death") {
      to(26);
      to(9);
      to(106);
      to(153);
      to(122);
      to(109);
      to(148);
      to(131);
      pass();
      to(200);
      fail();
      fail();
    } else {
      to(26);
      to(9);
      to(106);
      to(11);
      pass();
      to(90);
      to(55);
      pass();
      to(47);
      to("47-brawl");
      pass();
      if (ending === "68-death") {
        to(68);
        fail();
      } else if (ending === "125-death" || ending === "145-death") {
        to("76-persuade");
        fail();
        to(125);
        if (ending === "125-death") fail();
        else {
          pass();
          fail();
        }
      } else if (["213", "226"].includes(ending)) {
        to(111);
        to(122);
        to(109);
        to(124);
        to(158);
        fail();
        pass();
        fail();
        pass();
        ending === "213" ? pass() : fail();
      } else if (["192", "217", "95"].includes(ending)) {
        to(111);
        to(122);
        to(109);
        to(148);
        to(131);
        fail();
        pass();
        to("162-decision");
        to("162-armed");
        if (ending === "95") fail();
        else {
          pass();
          to(223);
          to(173);
          ending === "217" ? pass() : fail();
        }
      } else if (ending === "220") {
        to(7);
        to("7-lock");
        pass();
        to(140);
        pass();
        pass();
        to(151);
        to(156);
        to(181);
        to(211);
        to(235);
        to(220);
        pass();
      } else if (ending === "121-death") {
        to(111);
        to(122);
        to(142);
        to("142-brawl");
        pass();
        to(13);
        fail();
        pass();
        pass();
        fail();
      } else {
        to(7);
        to(123);
        if (ending === "239") {
          to("123-lock");
          pass();
          to(140);
        } else to(140);
        pass();
        if (ending === "132-death") fail();
        else {
          pass();
          if (ending === "243") {
            to(136);
            to(131);
            fail();
            fail();
            pass();
            to("162-decision");
            to("162-armed");
            mode = "madness";
            act();
            mode = "pass";
          } else {
            to(179);
            to("179-lock");
            pass();
            to(222);
            to(151);
            to(156);
            to(210);
            to(195);
            to(210);
            to(181);
            to(211);
            to(235);
            to(205);
            pass();
            to(239);
          }
        }
      }
    }
    if (state.status !== "ended" || state.nodeId !== ending)
      throw Error(
        `target ${role}:${ending} reached ${state.nodeId} ${state.status}`,
      );
    report.routes = report.routes.filter(
      (r: { role: number; endingId: string }) =>
        r.role !== role || r.endingId !== ending,
    );
    report.routes.push({ role, endingId: ending, initialDraws, steps });
    console.log(`target ${role}:${ending} ${steps.length} commands`);
  }
report.observedByRole = [0, 1, 2].map((role) =>
  report.routes
    .filter((r: { role: number }) => r.role === role)
    .map((r: { endingId: string }) => r.endingId)
    .sort(),
);
report.missing = report.expectedEndings.filter(
  (id: string) =>
    !report.routes.some((r: { endingId: string }) => r.endingId === id),
);
writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
