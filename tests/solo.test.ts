import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { buildApp } from "../apps/api/src/app.js";
import { createCharacter } from "../packages/rules/index.js";
import type { Story, RunState } from "../packages/contracts/index.js";
const stories = loadStories("stories");
const staticStory = stories.get("alone-against-static@1.0.0")!,
  flames = stories.get("alone-against-flames@1.0.0")!;
const low = (min: number, max: number) => (max === 10 ? 1 : min);
const high = (_min: number, max: number) => max - 1;
function start(story: Story, preset = 0) {
  return initialState(
    story,
    createCharacter("测试调查员", story.presets[preset], 45),
    low,
  );
}
function scene(story: Story, state: RunState) {
  return project(story, state, "test", 0);
}
function move(
  story: Story,
  s: RunState,
  action: string,
  dice = low,
  input?: Record<string, number | string>,
) {
  try {
    return advance(story, s, action, dice, input).state;
  } catch (e) {
    throw new Error(
      `${story.id} ${s.nodeId}:${s.program?.cursor} action ${action}`,
      { cause: e },
    );
  }
}
function at(story: Story, id: string) {
  return initialState(
    { ...story, entry: id },
    createCharacter("测试", story.presets[0], 45),
    low,
  );
}
const attrs = {
  str: 70,
  con: 60,
  pow: 60,
  dex: 80,
  app: 50,
  siz: 50,
  int: 50,
  edu: 40,
};
test("all source paragraphs represented and invalid operations, exits and unknown checks reject", () => {
  assert.equal(
    staticStory.nodes.filter((n) => n.id.match(/^\d+$/)).length,
    372,
  );
  assert.equal(flames.nodes.filter((n) => n.id.match(/^\d+$/)).length, 270);
  for (const story of [staticStory, flames]) {
    assert.ok(validateStory(story));
    const bad = structuredClone(story);
    bad.nodes[0].program = [{ kind: "route", target: "missing" }];
    assert.throws(() => validateStory(bad));
    bad.nodes[0].program = [
      {
        kind: "check",
        check: {
          skill: "unknown",
          label: "未知",
          success: story.entry,
          failure: story.entry,
        },
      },
    ];
    assert.throws(() => validateStory(bad));
    bad.nodes[0].program = [{ kind: "effects", effects: [] }];
    assert.throws(() => validateStory(bad));
  }
});
test("fixed characters cannot change role; CON and SAN run before choices and update records", () => {
  let s = start(staticStory);
  assert.deepEqual(
    scene(staticStory, s).actions.map((a) => a.id),
    ["next"],
  );
  assert.throws(() => move(staticStory, s, "charlie"));
  s = move(staticStory, s, "alex");
  s = move(staticStory, s, "to-3");
  s = move(staticStory, s, "roll");
  s = move(staticStory, s, "to-5");
  assert.equal(s.nodeId, "5");
  assert.equal(scene(staticStory, s).check?.label, "体质");
  s = move(staticStory, s, "roll", high);
  assert.equal(s.flags["着凉"], true);
  assert.ok(scene(staticStory, s).actions.some((a) => a.id === "to-6"));
  assert.equal(scene(staticStory, s).actions.length, 2);
  s = at(staticStory, "22");
  s = move(staticStory, s, "roll", high);
  assert.equal(s.character.sanity, 49);
  assert.equal(s.flags["不安"], true);
  assert.equal(s.nodeId, "22");
  assert.equal(scene(staticStory, s).check, undefined);
});
test("push persists first failure, accepts once, and applies the separate pushed failure branch", () => {
  let s = at(staticStory, "46");
  s = move(staticStory, s, "roll", high);
  assert.equal(s.nodeId, "46");
  assert.ok(s.program?.pending);
  const failed = structuredClone(s);
  s = move(staticStory, s, "accept");
  assert.equal(s.nodeId, "53");
  const pushed = move(staticStory, failed, "push", high);
  assert.equal(pushed.nodeId, "54");
  assert.equal(pushed.character.hp, 9);
  assert.equal(failed.character.hp, 13);
  assert.throws(() => move(staticStory, pushed, "push"));
});
test("exploration repeats append visits and cannot repeat exhausted options", () => {
  let s = at(staticStory, "57");
  const first = s.visitId;
  s = move(staticStory, s, "to-58");
  s = move(staticStory, s, "roll");
  s = move(staticStory, s, "to-57");
  assert.equal(s.nodeId, "57");
  assert.notEqual(s.visitId, first);
  assert.equal(s.program!.visits["57"], 2);
  assert.ok(!scene(staticStory, s).actions.some((a) => a.id === "to-58"));
  assert.throws(() => move(staticStory, s, "to-58"));
});
test("damage and madness interrupt and resume after the effect without applying it twice", () => {
  // Dedicated deterministic synthetic loss on a real scene tests persisted return cursor.
  const story: Story = {
    ...staticStory,
    entry: "test-loss",
    nodes: [
      ...staticStory.nodes,
      {
        id: "test-loss",
        type: "program",
        title: "失去理智",
        chapter: "测试",
        text: ["测试"],
        background: "/art/lighthouse.svg",
        program: [
          {
            kind: "effects",
            effects: [{ op: "add", field: "sanity", value: -5 }],
          },
          {
            kind: "choices",
            choices: [{ id: "continue", label: "继续", target: "0" }],
          },
        ],
      },
    ],
  };
  let loss = initialState(
    story,
    createCharacter("测试", story.presets[0], 45),
    low,
  );
  assert.equal(loss.nodeId, "329");
  assert.equal(loss.character.sanity, 45);
  loss = move(story, loss, "roll", high);
  assert.equal(loss.nodeId, "test-loss");
  assert.equal(loss.character.sanity, 45);
  assert.equal(loss.program!.cursor, 1);
  let symptom = initialState(
    story,
    createCharacter("测试", story.presets[0], 45),
    low,
  );
  symptom = move(story, symptom, "roll", low);
  symptom = move(story, symptom, "roll", () => 4);
  assert.equal(symptom.nodeId, "333");
  symptom = move(story, symptom, "to-$return");
  assert.equal(symptom.nodeId, "test-loss");
  assert.equal(symptom.program!.cursor, 1);
  assert.equal(symptom.character.sanity, 45);
  const woundStory = {
    ...story,
    entry: "test-wound",
    nodes: [
      ...story.nodes,
      {
        id: "test-wound",
        type: "program" as const,
        title: "伤害",
        chapter: "测试",
        text: ["测试"],
        background: "/art/lighthouse.svg",
        program: [
          {
            kind: "effects" as const,
            effects: [{ op: "add" as const, field: "hp", value: -7 }],
          },
          {
            kind: "choices" as const,
            choices: [{ id: "continue", label: "继续", target: "0" }],
          },
        ],
      },
    ],
  };
  let wound = initialState(
    woundStory,
    createCharacter("测试", story.presets[0], 45),
    low,
  );
  assert.equal(wound.nodeId, "325");
  wound = move(woundStory, wound, "roll");
  assert.equal(wound.nodeId, "test-wound");
  assert.equal(wound.character.hp, 6);
  assert.equal(wound.program!.cursor, 1);
});
test("Flames guided character creation obeys all allocation multisets and derives values", () => {
  let s = start(flames);
  s = move(flames, s, "to-263");
  assert.equal(scene(flames, s).input?.kind, "allocation");
  assert.throws(() => move(flames, s, "allocate", low, { ...attrs, pow: 99 }));
  s = move(flames, s, "allocate", low, attrs);
  assert.equal(s.character.maxHp, 11);
  assert.equal(s.character.sanity, 60);
  assert.equal(s.character.damageBonus, "0");
  s = move(flames, s, "to-8");
  s = move(flames, s, "to-38");
  s = move(flames, s, "to-233");
  s = move(flames, s, "to-134");
  assert.equal(s.character.luck, 45);
  s = move(flames, s, "roll");
  assert.equal(s.character.luck, 15);
  s = move(flames, s, "roll");
  assert.equal(s.nodeId, "261");
  s = move(flames, s, "to-71");
  s = move(flames, s, "to-239");
  const allocation = {
    artCraft: 70,
    history: 60,
    libraryUse: 60,
    languageOwn: 50,
    psychology: 50,
    persuade: 50,
    spotHidden: 40,
    firstAid: 40,
  };
  s = move(flames, s, "allocate", low, allocation);
  assert.equal(s.character.occupation, "记者");
  s = move(flames, s, "to-128");
  assert.throws(() =>
    move(flames, s, "allocate", low, {
      artCraft: 20,
      listen: 20,
      stealth: 20,
      dodge: 20,
    }),
  );
  s = move(flames, s, "allocate", low, {
    listen: 20,
    stealth: 20,
    dodge: 20,
    occult: 20,
  });
  assert.equal(s.character.skills.listen, 40);
});
test("Flames exploration cap, secrets, magic costs, damage and opposed checks", () => {
  let s = at(flames, "6");
  s.character.attributes = attrs;
  s.program!.counters.morning = 4;
  s = move(flames, s, "to-16"); // initial cap changes only when returning to hub
  s = move(flames, s, "to-25");
  assert.equal(s.nodeId, "3");
  const spellStory = {
    ...flames,
    entry: "90",
    presets: [
      { ...flames.presets[0], hp: 8, sanity: 60, mp: 3, attributes: attrs },
    ],
  };
  let spell = start(spellStory);
  assert.deepEqual(scene(spellStory, spell).input, {
    kind: "number",
    label: "投入魔法点（不足时以生命补足，最多 10，保留至少 1 HP）",
    min: 0,
    max: 10,
    resources: { mp: 3, hp: 8 },
  });
  spell = move(spellStory, spell, "confirm", low, { value: 8 });
  assert.equal(spell.character.mp, 0);
  assert.equal(spell.character.hp, 3);
  spell = move(spellStory, spell, "to-198");
  spell = move(spellStory, spell, "roll");
  assert.equal(spell.nodeId, "209");
  assert.equal(spell.character.sanity, 59);
  const opposed = {
    ...flames,
    entry: "150",
    presets: [{ ...flames.presets[0], hp: 10, sanity: 60, attributes: attrs }],
  };
  let chase = start(opposed);
  chase = move(opposed, chase, "roll");
  assert.equal(chase.nodeId, "172");
});
test("Flames survival route reaches an ending using real guided creation and sequential choices", () => {
  let s = start(flames);
  for (const a of ["to-263"]) s = move(flames, s, a);
  s = move(flames, s, "allocate", low, attrs);
  for (const a of [
    "to-8",
    "to-38",
    "to-233",
    "to-134",
    "roll",
    "roll",
    "to-71",
    "to-239",
  ])
    s = move(flames, s, a);
  s = move(flames, s, "allocate", low, {
    artCraft: 70,
    history: 60,
    libraryUse: 60,
    languageOwn: 50,
    psychology: 50,
    persuade: 50,
    spotHidden: 40,
    firstAid: 40,
  });
  s = move(flames, s, "to-128");
  s = move(flames, s, "allocate", low, {
    listen: 20,
    stealth: 20,
    dodge: 20,
    disguise: 20,
  });
  for (const a of [
    "to-144",
    "to-144-drive",
    "roll",
    "to-194",
    "to-251",
    "to-267",
    "to-4",
    "to-14",
    "to-63",
    "to-154",
    "to-166",
    "to-192",
    "to-218",
    "to-6",
    "to-3",
    "to-22",
    "to-11",
    "to-24",
    "to-43",
    "to-56",
    "to-62",
    "to-180",
    "to-131",
    "to-157",
    "to-224",
    "to-26",
    "to-64",
    "to-78",
    "to-7",
    "to-125",
    "roll",
    "to-152",
    "roll",
    "to-223",
    "to-survived",
  ])
    s = move(flames, s, a);
  assert.equal(s.status, "ended");
  assert.equal(scene(flames, s).ending, "生还");
});
test("bear resolves both attacks each round, armor, defense and three-round survival", () => {
  const story = {
    ...flames,
    entry: "173",
    presets: [
      {
        ...flames.presets[0],
        hp: 20,
        sanity: 60,
        attributes: attrs,
        skills: { ...flames.presets[0].skills, fightingBrawl: 99, dodge: 99 },
      },
    ],
  };
  let s = start(story);
  const actions: string[] = [];
  while (s.nodeId === "173" && actions.length < 12) {
    const a = s.program!.combat!.playerTurn ? "attack" : "dodge";
    actions.push(a);
    s = move(story, s, a);
  }
  assert.deepEqual(actions, [
    "attack",
    "dodge",
    "dodge",
    "attack",
    "dodge",
    "dodge",
    "attack",
    "dodge",
    "dodge",
  ]);
  assert.equal(s.nodeId, "201");
  assert.equal(s.character.hp, 20);
});
test("combat tie rules, regular counterattack damage and impaling extreme damage", () => {
  const base = {
    ...flames,
    entry: "235",
    presets: [
      {
        ...flames.presets[0],
        hp: 20,
        sanity: 60,
        attributes: attrs,
        skills: { ...flames.presets[0].skills, fightingBrawl: 99, dodge: 99 },
      },
    ],
  };
  const values = (v: number[]) => (min: number, max: number) =>
    v.length ? v.shift()! : low(min, max);
  let s = start(base);
  s.program!.combat!.playerTurn = false;
  s.program!.combat!.phase = 1;
  // Reaction is extreme, opponent fails. A counterattack still deals ordinary 1D3=1.
  s = move(base, s, "fightBack", values([1, 1, 0, 0, 1]));
  assert.equal(s.program!.combat!.hp, 8);
  s = start(base);
  s.inventory.push({ key: "knife", label: "猎刀" });
  s = move(base, s, "attack", values([1, 1, 0, 0, 1]));
  assert.equal(s.nodeId, "241"); // knife extreme: 4 + D4(1) = 5.
});
test("guided API commands persist inputs and dice; duplicate allocation is replayed and forgery rejected", async () => {
  let draws = 0;
  const app = await buildApp({
    dice: (min, max) => {
      draws++;
      return low(min, max);
    },
  });
  const headers = { "x-requested-with": "cthulhu-web" };
  try {
    const registered = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: { inviteCode: "fa6ian-test", username: "单人规则测试", password: "testing-password-123" },
    });
    const cookies = { session: registered.cookies[0].value };
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers,
      cookies,
      payload: { storyId: flames.id, presetId: "guided", name: "艾琳" },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().runId;
    const send = (
      revision: number,
      actionId: string,
      input?: Record<string, number | string>,
      commandId = randomUUID(),
    ) =>
      app.inject({
        method: "POST",
        url: `/api/runs/${id}/commands`,
        headers,
        cookies,
        payload: {
          expectedRevision: revision,
          commandId,
          actionId,
          ...(input ? { input } : {}),
        },
      });
    assert.equal((await send(0, "to-263")).statusCode, 200);
    const commandId = randomUUID();
    const first = await send(1, "allocate", attrs, commandId);
    assert.equal(first.statusCode, 200, first.body);
    const reversed = Object.fromEntries(Object.entries(attrs).reverse());
    assert.equal(
      (await send(1, "allocate", reversed, commandId)).body,
      first.body,
    );
    assert.equal(
      (await send(1, "allocate", { ...attrs, pow: 99 }, commandId)).statusCode,
      409,
    );
    for (const [i, a] of ["to-8", "to-38", "to-233", "to-134"].entries())
      assert.equal((await send(i + 2, a)).statusCode, 200);
    const diceId = randomUUID(),
      r = await send(6, "roll", undefined, diceId);
    assert.equal(r.statusCode, 200, r.body);
    const before = draws;
    assert.equal((await send(6, "roll", undefined, diceId)).body, r.body);
    assert.equal(draws, before);
    const history = await app.inject({
      url: `/api/runs/${id}/history`,
      cookies,
    });
    assert.equal(history.json().frames.length, 8);
    assert.equal(history.json().frames.at(-1).scene.character.luck, 15);
    assert.equal((await send(7, "allocate", attrs)).statusCode, 400);
    const visible = (await app.inject({ url: `/api/runs/${id}`, cookies }))
      .body;
    assert.ok(!visible.includes('"program"'));
    assert.ok(!visible.includes('"target":"'));
    assert.ok(!visible.includes('"flags"'));
  } finally {
    await app.close();
  }
});
test("seeded full-module walks terminate without dead choices or accidental repeated effects", () => {
  for (const story of [staticStory, flames])
    for (let seed = 1; seed <= 80; seed++) {
      let random = seed;
      const rng = (min: number, max: number) => {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        return min + (random % (max - min));
      };
      let s = initialState(
        story,
        createCharacter(
          "探索者",
          story.presets[seed % story.presets.length],
          45,
        ),
        rng,
      );
      for (let i = 0; i < 450 && s.status === "active"; i++) {
        const view = scene(story, s);
        assert.ok(view.actions.length, `${story.id} ${s.nodeId} no actions`);
        let input: Record<string, number | string> | undefined;
        if (view.input?.kind === "allocation") {
          const a = view.input.allocation;
          if (a.kind === "attributes") input = attrs;
          else if (a.kind === "occupation") {
            const keys = [
              ...(a.required ?? []),
              ...(a.optional?.length ? [a.optional[0]] : []),
            ];
            for (const skill of view.input.skills)
              if (
                keys.length < 8 &&
                !keys.includes(skill.key) &&
                !["cthulhuMythos", "creditRating"].includes(skill.key)
              )
                keys.push(skill.key);
            input = Object.fromEntries(keys.map((k, i) => [k, a.values![i]]));
          } else
            input = Object.fromEntries(
              view.input.skills
                .filter(
                  (x) =>
                    !s.program!.occupationSkills.includes(x.key) &&
                    !["cthulhuMythos", "creditRating"].includes(x.key),
                )
                .slice(0, 4)
                .map((x) => [x.key, 20]),
            );
        } else if (view.input?.kind === "number")
          input = { value: view.input.max };
        const action = view.actions[rng(0, view.actions.length)].id;
        s = move(story, s, action, rng, input);
      }
      assert.equal(
        s.status,
        "ended",
        `${story.id} seed ${seed} remained at ${s.nodeId}`,
      );
    }
});

test("Static both official roles complete a full survival route", () => {
  for (const [role, seed] of [
    [0, 12],
    [1, 1],
  ]) {
    let random = seed,
      s = start(staticStory, role),
      steps = 0;
    while (s.status === "active" && steps++ < 200) {
      const actions = scene(staticStory, s).actions;
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      s = move(staticStory, s, actions[(random >>> 16) % actions.length].id);
    }
    assert.equal(s.nodeId, "367");
    assert.equal(s.status, "ended");
    assert.ok(s.character.hp > 0);
  }
});
