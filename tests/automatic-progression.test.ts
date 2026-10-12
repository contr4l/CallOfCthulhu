import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { buildApp } from "../apps/api/src/app.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { narrativeText } from "../packages/engine/program.js";
import { createCharacter } from "../packages/rules/index.js";
import type { Story } from "../packages/contracts/index.js";

const base = loadStories("stories").get("alone-against-static@1.0.0")!;
const fixture: Story = {
  ...base,
  healthPolicy: undefined,
  id: "automatic-test",
  creationPolicy: "guided",
  entry: "1",
  nodes: [
    {
      id: "1",
      title: "线索出现",
      chapter: "测试",
      type: "program",
      background: base.cover,
      text: [
        "屋外传来脚步声。",
        "你要在记录表上为见过陌生人划勾。",
        "在侦查技能旁的小方框里打勾。",
        "如果成功，转到118。否则，转到119。",
      ],
      program: [
        {
          kind: "effects",
          effects: [
            {
              op: "register",
              kind: "state",
              key: "seen-stranger",
              label: "见过陌生人",
            },
            { op: "register", kind: "skill", key: "spotHidden" },
            { op: "register", kind: "skill", key: "spotHidden" },
            { op: "add", field: "hp", value: -1 },
          ],
        },
        {
          kind: "check",
          check: {
            skill: "spotHidden",
            label: "侦查",
            success: "118",
            failure: "119",
          },
        },
      ],
    },
    {
      id: "118",
      title: "找到来客",
      chapter: "测试",
      type: "program",
      background: base.cover,
      text: ["你看清了来客。"],
      program: [
        {
          kind: "choices",
          choices: [
            {
              id: "known",
              label: "转到120",
              target: "120",
              condition: { flag: "seen-stranger", equals: true },
            },
            {
              id: "unknown",
              label: "转到119",
              target: "119",
              condition: { flag: "seen-stranger", equals: false },
            },
          ],
        },
      ],
    },
    {
      id: "119",
      title: "决定方向",
      chapter: "测试",
      type: "program",
      background: base.cover,
      text: ["你没有看清来客。"],
      program: [
        {
          kind: "choices",
          choices: [
            { id: "stay", label: "留在屋里", target: "120" },
            { id: "leave", label: "走出屋外", target: "120" },
          ],
        },
      ],
    },
    {
      id: "120",
      title: "结束",
      chapter: "测试",
      type: "program",
      background: base.cover,
      text: ["调查结束。"],
      program: [{ kind: "end", label: "结束" }],
    },
  ],
};
const view = (story: Story, state: ReturnType<typeof initialState>) =>
  project(story, state, "test", 0);
const start = () =>
  initialState(
    fixture,
    createCharacter("自动登记测试", fixture.presets[0], 45),
    (min, max) => (max === 10 ? 1 : min),
  );

test("narrative filtering preserves whole paragraphs and dialogue across published Chinese chapters", () => {
  const dialogue =
    "“这里叫烬头村。别的村子要走好几里。我每星期才来两次。但这里的人都是好人。梅·莱德贝特有间空房。她会让你留宿的。顺着这条巷子，右转，左边第一间房。”";
  assert.deepEqual(narrativeText([dialogue, "你点点头。你沿着巷子走去。"]), [
    dialogue,
    "你点点头。你沿着巷子走去。",
  ]);
  assert.deepEqual(
    narrativeText([
      "你看见一座房屋。转到118。窗内亮着灯。",
      "The room is quiet. You hear footsteps. Go to 118.",
      "转到118。",
    ]),
    ["你看见一座房屋。窗内亮着灯。", "The room is quiet. You hear footsteps."],
  );
  const story = loadStories("stories").get("alone-against-flames@1.1.0")!;
  assert.ok(story);
  const chapter = story.nodes.find((n) => n.id === "194")!;
  assert.ok(chapter.text.includes(dialogue));
  const original = structuredClone(chapter.text);
  const state = initialState(
    { ...story, entry: "194" },
    createCharacter("段落测试", story.presets[0], 45),
    (min) => min,
  );
  assert.ok(view(story, state).text.includes(dialogue));
  assert.deepEqual(chapter.text, original);
  for (const node of story.nodes) {
    for (const paragraph of node.text) {
      if (
        !/(?:记录表|方框|表格|勾选|打勾|划勾|画勾|转到|回到|跳转到|自动处理)/u.test(
          paragraph,
        )
      )
        assert.deepEqual(
          narrativeText([paragraph]),
          paragraph.trim() ? [paragraph.trim()] : [],
          node.id,
        );
    }
  }
});

test("typed registration automatically persists skills and states without exposing paper instructions", () => {
  assert.ok(validateStory(fixture));
  const state = start();
  assert.deepEqual(state.program!.skillMarks, ["spotHidden"]);
  assert.equal(state.flags["skillMark.spotHidden"], true);
  assert.equal(state.flags["seen-stranger"], true);
  assert.equal(state.character.hp, fixture.presets[0].hp - 1);
  const scene = view(fixture, state);
  assert.deepEqual(scene.text, ["屋外传来脚步声。"]);
  assert.deepEqual(scene.actions, [{ id: "next", label: "进行侦查检定" }]);
  assert.deepEqual(scene.registrations, [
    { key: "seen-stranger", kind: "state", label: "见过陌生人" },
    { key: "skillMark.spotHidden", kind: "skill", label: "成长标记：侦查" },
  ]);
  assert.equal(
    scene.notices!.filter((s) => s.includes("成长标记：侦查")).length,
    1,
  );
  assert.deepEqual(view(fixture, JSON.parse(JSON.stringify(state))), scene);
  assert.equal(fixture.nodes[0].text.length, 4);
});
test("next resolves server dice and conditional routing while genuine choices require a decision", () => {
  const pass = advance(fixture, start(), "next", (min, max) =>
    max === 10 ? 1 : min,
  );
  assert.equal(pass.check!.success, true);
  assert.equal(pass.state.nodeId, "118");
  assert.deepEqual(view(fixture, pass.state).actions, [
    { id: "next", label: "下一节" },
  ]);
  assert.equal(advance(fixture, pass.state, "next").state.nodeId, "120");
  const fail = advance(fixture, start(), "next", (_min, max) => max - 1);
  assert.equal(fail.state.nodeId, "119");
  assert.equal(view(fixture, fail.state).actions.length, 2);
  assert.throws(() => advance(fixture, fail.state, "next"), /需要作出选择/);
  assert.throws(() => advance(fixture, start(), "to-118"), /不允许/);
});
test("random routing reports the exact saved die that selected its destination", () => {
  const story: Story = {
    ...fixture,
    nodes: fixture.nodes.map((node) =>
      node.id === "1"
        ? {
            ...node,
            program: [{ kind: "random", sides: 2, targets: ["118", "119"] }],
          }
        : node,
    ),
  };
  const state = initialState(
    story,
    createCharacter("测试", story.presets[0], 45),
    (min) => min,
  );
  assert.deepEqual(view(story, state).actions, [
    { id: "next", label: "掷 D2" },
  ]);
  for (const [roll, destination] of [
    [1, "118"],
    [2, "119"],
  ] as const) {
    let calls = 0;
    const response = advance(story, state, "next", () => {
      calls++;
      return roll;
    });
    assert.equal(response.state.nodeId, destination);
    assert.deepEqual(response.dice?.groups, [{ sides: 2, results: [roll] }]);
    assert.equal(calls, 1);
  }
});
test("legacy marks and source prose still project through the automatic registration model", () => {
  const story = loadStories("stories").get("alone-against-flames@1.0.0")!;
  const state = initialState(
    { ...story, entry: "19" },
    createCharacter("测试", story.presets[0], 45),
    (min) => min,
  );
  assert.ok(
    view(story, state).registrations!.some(
      (r) => r.key === "skillMark.intimidate",
    ),
  );
  assert.ok(
    !view(story, state).text.some((t) => /check.mark|small box/i.test(t)),
  );
  assert.deepEqual(
    narrativeText([
      "你听到了脚步声。转到118。",
      "The room is quiet. Go to 118.",
    ]),
    ["你听到了脚步声。", "The room is quiet."],
  );
});
test("next commands replay identical dice and registrations across retries and database restart", async () => {
  const root = mkdtempSync(join(tmpdir(), "coc-auto-"));
  const storyRoot = join(root, "stories"),
    dir = join(storyRoot, fixture.id, fixture.version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "story.json"), JSON.stringify(fixture));
  let draws = 0;
  const options = {
    storyRoot,
    databasePath: join(root, "game.sqlite"),
    dice: (min: number, max: number) => {
      draws++;
      return max === 10 ? 1 : min;
    },
  };
  let app = await buildApp(options);
  const headers = { "x-requested-with": "cthulhu-web" };
  try {
    const account = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: {
        inviteCode: "fa6ian-test",
        username: "自动状态测试",
        password: "testing-password-123",
      },
    });
    assert.equal(account.statusCode, 200, account.body);
    const cookies = { session: account.cookies[0].value };
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers,
      cookies,
      payload: {
        storyId: fixture.id,
        presetId: fixture.presets[0].id,
        name: "调查员",
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    const id = created.json().runId;
    const payload = {
      expectedRevision: 0,
      commandId: randomUUID(),
      actionId: "next",
    };
    const send = () =>
      app.inject({
        method: "POST",
        url: `/api/runs/${id}/commands`,
        headers,
        cookies,
        payload,
      });
    const response = await send();
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().scene.title, "找到来客");
    const used = draws;
    assert.equal((await send()).body, response.body);
    assert.equal(draws, used);
    await app.close();
    app = await buildApp(options);
    assert.equal((await send()).body, response.body);
    assert.equal(draws, used);
    const resumed = await app.inject({ url: `/api/runs/${id}`, cookies });
    assert.deepEqual(
      resumed.json().registrations,
      response.json().scene.registrations,
    );
    const history = await app.inject({
      url: `/api/runs/${id}/history`,
      cookies,
    });
    assert.equal(history.json().frames.length, 2);
  } finally {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  }
});
