import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadStories, validateStory } from "../apps/api/src/catalog.js";
import { initialState, advance, project } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";
import { buildApp } from "../apps/api/src/app.js";
const stories = loadStories("stories"),
  story = stories.get("alone-against-flames@1.1.0")!;
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
const low = (min: number, max: number) => (max === 10 ? 1 : min);
function at(id: string) {
  const c = {
    ...createCharacter("体验验收", story.presets[0], 15),
    attributes: attrs,
    hp: 11,
    maxHp: 11,
    sanity: 60,
    mp: 12,
  };
  return initialState({ ...story, entry: id }, c, low);
}
test("Chinese story keeps all 270 source paragraphs, reviewed rules and old published version", () => {
  assert.equal(story.title, "向火独行");
  assert.equal(story.nodes.filter((n) => /^\d+$/.test(n.id)).length, 270);
  validateStory(story);
  assert.deepEqual(project(story, at("25"), "audit", 0).text, []);
  for (const id of ["134", "233", "171"]) {
    const view = project(story, at(id), "audit", 0);
    assert.ok((view.help ?? []).every((hint) => !/网页|刷新/.test(hint)));
    assert.equal(view.nextHint, undefined);
  }
  assert.ok(
    project(story, at("90"), "audit", 0).help?.some((hint) =>
      hint.includes("96–100"),
    ),
  );
  assert.equal(
    stories.get("alone-against-flames@1.0.0")!.title,
    "Alone Against the Flames",
  );
  for (const n of story.nodes) {
    assert.ok(
      n.text.every(
        (t) =>
          !/<(?:p|script|img|div)\b|\[guide-|(?:转到|回到)\s*\d|快速(?:开始|入门)规则第|规则书第|(?:勾选|打勾).*(?:方框|角色卡)/i.test(
            t,
          ),
      ),
      n.id,
    );
    for (const st of n.program!) {
      if (st.kind === "choices")
        assert.ok(
          st.choices.every((c) => !/[a-z]{3}/i.test(c.label)),
          n.id,
        );
    }
  }
});
test("map unlocks in its narrative and remains available in the inventory", () => {
  const unseen = project(story, at("1"), "audit", 0);
  assert.ok(!unseen.illustration);
  assert.equal(unseen.inventory.length, 0);
  let s = at("140"),
    view = project(story, s, "audit", 0);
  assert.ok(view.illustration?.src.endsWith("emberhead-map.png"));
  assert.equal(view.inventory[0].illustration?.key, "emberhead-map");
  s = advance(story, s, "next", low).state;
  view = project(story, s, "audit", 1);
  assert.equal(view.illustration, undefined);
  assert.equal(view.inventory[0].illustration?.key, "emberhead-map");
});
test("successful personal combat check can lose the round with explicit damage and opponent grade", () => {
  let s = at("235");
  s.character.skills.fightingBrawl = 50;
  s.program!.combat!.stance = "fight";
  const sequence = [0, 5, 1, 1, 1];
  const r = advance(story, s, "attack", (min, max) =>
    sequence.length ? sequence.shift()! : low(min, max),
  );
  assert.equal(r.check?.success, true);
  assert.equal(r.check?.grade, "regular");
  assert.equal(r.check?.opponent?.grade, "hard");
  assert.equal(r.check?.combat?.result, "hurt");
  assert.equal(r.check?.combat?.damage, 1);
  assert.equal(r.state.character.hp, 10);
});
test("occupation specializations are validated and fixed specialties cannot be forged", () => {
  let s = at("102");
  const allocation = {
    appraise: 70,
    artCraft: 60,
    history: 60,
    libraryUse: 50,
    languageOther: 50,
    spotHidden: 50,
    persuade: 40,
    firstAid: 40,
  };
  assert.throws(
    () => advance(story, s, "allocate", low, allocation),
    /艺术与手艺专长/,
  );
  s = advance(story, s, "allocate", low, {
    ...allocation,
    "specialty.artCraft": "书籍修复",
    "specialty.languageOther": "法语",
  }).state;
  assert.deepEqual(s.character.specializations, {
    artCraft: "书籍修复",
    languageOther: "法语",
  });
  const doctor = {
    firstAid: 70,
    languageOther: 60,
    medicine: 60,
    psychology: 50,
    scienceBiology: 50,
    sciencePharmacy: 50,
    listen: 40,
    dodge: 40,
  };
  assert.throws(
    () =>
      advance(story, at("226"), "allocate", low, {
        ...doctor,
        "specialty.languageOther": "德语",
      }),
    /已固定/,
  );
  assert.equal(
    advance(story, at("226"), "allocate", low, doctor).state.character
      .specializations?.languageOther,
    "拉丁语",
  );
});
test("survival outcomes keep distinct collected identities and complete narrative", () => {
  for (const [id, label] of [
    ["185", "骑向黎明"],
    ["223", "走出烬头村"],
    ["247", "劫后余生"],
  ]) {
    const s = advance(story, at(id), "next", low).state,
      v = project(story, s, "audit", 1);
    assert.equal(v.ending, label);
    assert.equal(v.collection?.endingId, id + "-end");
    assert.ok(v.text.join("").length > 100);
    assert.notEqual(v.text[0], "继续你的调查。");
  }
});
test("luck dice receipts persist across duplicate API commands and history without a second roll", async () => {
  let draws = 0;
  const app = await buildApp({
    dice: (min, max) => {
      draws++;
      return low(min, max);
    },
  });
  const headers = { "x-requested-with": "cthulhu-web" };
  try {
    const user = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      headers,
      payload: { inviteCode: "fa6ian-test", username: "中文体验验收", password: "testing-password-123" },
    });
    const cookies = { session: user.cookies[0].value };
    const created = await app.inject({
      method: "POST",
      url: "/api/runs",
      headers,
      cookies,
      payload: {
        storyId: story.id,
        presetId: "guided",
        name: "验收调查员",
        age: 28,
      },
    });
    assert.equal(created.statusCode, 201, created.body);
    let scene = created.json();
    const send = async (
      actionId: string,
      input?: Record<string, number | string>,
      commandId = randomUUID(),
    ) =>
      app.inject({
        method: "POST",
        url: `/api/runs/${scene.runId}/commands`,
        headers,
        cookies,
        payload: {
          expectedRevision: scene.revision,
          actionId,
          commandId,
          ...(input ? { input } : {}),
        },
      });
    for (const a of ["next", "allocate", "next", "next", "next", "next"]) {
      const response = await send(a, a === "allocate" ? attrs : undefined);
      assert.equal(response.statusCode, 200, response.body);
      scene = response.json().scene;
    }
    const id = randomUUID(),
      first = await send("next", undefined, id);
    assert.equal(first.statusCode, 200, first.body);
    const receipt = first.json().dice;
    assert.deepEqual(receipt.groups, [{ sides: 6, results: [1, 1, 1] }]);
    assert.equal(receipt.value, 15);
    const before = draws;
    assert.equal((await send("next", undefined, id)).body, first.body);
    assert.equal(draws, before);
    const history = (
      await app.inject({ url: `/api/runs/${scene.runId}/history`, cookies })
    ).json();
    assert.deepEqual(history.frames.at(-1).dice, receipt);
    assert.equal(history.frames[0].scene.character.profile.age, 28);
  } finally {
    await app.close();
  }
});
