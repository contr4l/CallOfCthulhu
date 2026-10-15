import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CharacterCard } from "../apps/web/src/components/CharacterCard.js";
import type { Character } from "../packages/contracts/index.js";

test("D6 survivor card shows skill levels and sanity maximum without percentile explanations", () => {
  const character: Character = { name: "幸存者", occupation: "生存者", hp: 9, maxHp: 10,
    sanity: 7, maxSanity: 8, luck: 0, skills: { stealth: 1, dodge: 2, occult: 0 },
    rulesVersion: "aaf-solo@1", attributes: { dex: 50 }, mp: 10, damageBonus: "0" };
  const html = renderToStaticMarkup(createElement(CharacterCard, { character }));
  assert.match(html, /SURVIVOR/);
  assert.match(html, /基础/);
  assert.match(html, /专家/);
  assert.match(html, /未掌握/);
  assert.match(html, /\/8/);
  assert.doesNotMatch(html, /困难|极难|width:1%|width:2%|魔法/);
  const legacy = renderToStaticMarkup(createElement(CharacterCard, {
    character: { ...character, rulesVersion: undefined, maxSanity: undefined },
  }));
  assert.match(legacy, /INVESTIGATOR/);
  assert.match(legacy, /困难/);
  assert.match(legacy, /极难/);
});
