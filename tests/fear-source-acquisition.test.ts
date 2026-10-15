import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { FearDefinition, FearState } from "../packages/contracts/fear.js";
import {
  presentFearAcquisitionChoice, recordFearFoodPickup, recordFearWorshipVisit,
  resolveFearFoodSaltChoice, resolveFearRandomObjectBook, resolveFearWorshipSymbolChoice,
} from "../packages/engine/fear-source-acquisition.js";

const json = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const definition = json("work/alone-against-fear/reviewed-definition.json") as FearDefinition;
function state(overrides: Record<string, unknown> = {}) {
  return { status: "active", food: 0, inventory: {}, pending: undefined, combat: undefined,
    pendingSaltConversion: 0, pendingWorshipSymbols: 0, ...overrides } as unknown as FearState;
}
function sourceBound(id: string, hash: string, refs: string[]) {
  const sourcePath = `scripts/alone-against-fear/fragments/${id}.json`;
  const translationPath = `scripts/alone-against-fear/translations/zh-CN/${id}.json`;
  const bytes = readFileSync(sourcePath), source = JSON.parse(bytes.toString("utf8")), translation = json(translationPath);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
  assert.equal(translation.sourceFragmentSha256, hash);
  for (const ref of refs) {
    const paragraph = source.paragraphs.find((value: { id: string }) => value.id === ref);
    assert.ok(paragraph, `${ref} exists`);
    assert.ok(translation.paragraphs.some((value: { id: string; text: string }) => value.id === ref && value.text.trim()), `${ref} is translated`);
  }
  return source;
}

test("food pickups offer an explicit, bounded conversion to Salt without exposing future gains", () => {
  const source = sourceBound("section-random-objects-table", "5c3d8b83d5554dc67e7b0b6ab3d5e1d87100df1a859bbd1312436330580d2aad", ["section-random-objects-table:p5", "section-random-objects-table:p6"]);
  assert.match(source.paragraphs.find((value: { id: string }) => value.id.endsWith(":p5")).text, /Food.*Salt/i);
  const saltRow = definition.tables["random-objects"].entries.find(entry => entry.roll === 16);
  const foodRow = definition.tables["random-objects"].entries.find(entry => entry.roll === 33);
  assert.deepEqual(saltRow?.operations, [{ op: "item", itemId: "salt", amount: 6 }], "direct Salt-table result is six doses");
  assert.deepEqual(foodRow?.operations, [{ op: "resource", key: "food", amount: "D6" }], "food conversion is one dose per chosen Food point");
  const current = state({ food: 4 });
  recordFearFoodPickup(current, 3); // caller reports the rolled amount before carry-capacity resolution
  assert.equal(presentFearAcquisitionChoice(current)?.kind, "food-to-salt");
  assert.deepEqual(current.pending?.options, ["0", "1", "2", "3"]);
  assert.deepEqual(Object.keys(current.pending?.data ?? {}).sort(), ["count", "prompt"]);
  assert.equal(resolveFearFoodSaltChoice(current, "2", remaining => {
    current.pending = { kind: "carry-capacity", options: ["discard-new"] };
    current.food += remaining;
  }), 2);
  assert.equal(current.food, 5);
  assert.equal(current.inventory.salt, 2);
  assert.equal(current.pendingSaltConversion, undefined);
  assert.equal(current.pending?.kind, "carry-capacity", "the callback's capacity choice is preserved");
  assert.throws(() => resolveFearFoodSaltChoice(current, "3", () => {}), /No matching/);
  const blocked = state({ food: 2, pending: { kind: "source-choice", options: ["visible"] } });
  recordFearFoodPickup(blocked, 1);
  assert.equal(presentFearAcquisitionChoice(blocked), undefined, "do not replace an unresolved source choice");
});

test("each Worship visit yields one independent optional, weightless religious-symbol choice", () => {
  const source = sourceBound("section-random-objects-table", "5c3d8b83d5554dc67e7b0b6ab3d5e1d87100df1a859bbd1312436330580d2aad", ["section-random-objects-table:p2"]);
  const worship = sourceBound("section-place-of-worship-table", "efe924facfd62ca5de81048cdd62aeed733a4425949a0588e63cdf662b7fb068", ["section-place-of-worship-table:p5"]);
  assert.match(source.paragraphs.find((value: { id: string }) => value.id.endsWith(":p2")).text, /every time you[\s\S]*visit a place of worship/i);
  assert.match(worship.paragraphs.find((value: { id: string }) => value.id.endsWith(":p5")).text, /every time you visit/i);
  const current = state();
  current.missionProgress = {};
  recordFearWorshipVisit(current, "box:visit-1"); recordFearWorshipVisit(current, "box:visit-2");
  const first = presentFearAcquisitionChoice(current);
  assert.equal(first?.kind, "worship-symbol-visit");
  assert.deepEqual(first?.options, ["take", "leave"]);
  assert.deepEqual(Object.keys(first?.data ?? {}), ["prompt"]);
  assert.equal(resolveFearWorshipSymbolChoice(current, "take", () => {
    current.pending = { kind: "carry-capacity", options: ["discard-new"] };
    current.inventory["holy-symbol"] = (current.inventory["holy-symbol"] ?? 0) + 1;
  }), true);
  assert.equal(current.pending?.kind, "carry-capacity", "a symbol acquisition callback's capacity choice is preserved");
  current.pending = undefined;
  assert.equal(presentFearAcquisitionChoice(current)?.kind, "worship-symbol-visit", "two visits remain two separate decisions");
  assert.equal(resolveFearWorshipSymbolChoice(current, "leave", () => assert.fail("leave must not acquire an item")), false);
  assert.equal(current.inventory["holy-symbol"], 1);
  assert.equal(current.pendingWorshipSymbols, undefined);
  recordFearWorshipVisit(current, "box:visit-2");
  assert.equal(current.pendingWorshipSymbols, undefined, "the same source visit token cannot grant a second symbol choice");
  recordFearWorshipVisit(current, "box:visit-3");
  assert.equal(current.pendingWorshipSymbols, 1, "a later actual visit remains eligible");
  recordFearWorshipVisit(current, "box:global-visit-8");
  recordFearWorshipVisit(current, "box:global-visit-15");
  assert.equal(current.pendingWorshipSymbols, 3, "per-box returns use globally unique visit tokens and cannot collide after other-area visits");
});

test("Random Objects 45 resolves Random Books; 61 keeps the printout and rerolls book results 2 and 12", () => {
  const source = sourceBound("section-random-objects-table", "5c3d8b83d5554dc67e7b0b6ab3d5e1d87100df1a859bbd1312436330580d2aad", ["section-random-objects-table:p9", "section-random-objects-table:p10"]);
  const row45 = definition.tables["random-objects"].entries.find(entry => entry.roll === 45);
  const row61 = definition.tables["random-objects"].entries.find(entry => entry.roll === 61);
  assert.equal(row45?.result, "random-book"); assert.equal(row61?.result, "computer-printout");
  assert.match(source.paragraphs.find((value: { id: string }) => value.id.endsWith(":p9")).text, /Roll 2d6 on the Book Table/i);
  assert.match(source.paragraphs.find((value: { id: string }) => value.id.endsWith(":p10")).text, /rerolling any result of 2 or 12/i);
  const bookTable = definition.tables["random-books"];
  const draw = (roll: number) => {
    const entry = bookTable.entries.find(candidate => typeof candidate.roll === "number" ? candidate.roll === roll
      : roll >= candidate.roll[0] && roll <= candidate.roll[1]);
    assert.ok(entry, `book-table roll ${roll} resolves`);
    return { roll, entry };
  };
  const book45: Array<{ book: string; source: "random-book" | "computer-printout" }> = [];
  const result45 = resolveFearRandomObjectBook("random-book", () => draw(2), (value, source) => book45.push({ book: value.entry.result, source }));
  assert.deepEqual(result45, { handled: true, status: "book-resolved", source: "random-book", bookRoll: 2 });
  assert.deepEqual(book45, [{ book: "necronomicon", source: "random-book" }], "45 uses the random-book result normally, including 2 and 12");

  const book61: Array<{ book: string; source: "random-book" | "computer-printout" }> = []; let drawIndex = 0;
  const faces = [2, 12, 7];
  let result61 = resolveFearRandomObjectBook("computer-printout", () => draw(faces[drawIndex++]),
    (value, source) => book61.push({ book: value.entry.result, source }));
  assert.deepEqual(result61, { handled: true, status: "reroll-required", source: "computer-printout", rejectedRoll: 2 });
  assert.equal(book61.length, 0, "a rejected roll does not expose or grant any possible book");
  result61 = resolveFearRandomObjectBook("computer-printout", () => draw(faces[drawIndex++]),
    (value, source) => book61.push({ book: value.entry.result, source }));
  assert.deepEqual(result61, { handled: true, status: "reroll-required", source: "computer-printout", rejectedRoll: 12 });
  result61 = resolveFearRandomObjectBook("computer-printout", () => draw(faces[drawIndex++]),
    (value, source) => book61.push({ book: value.entry.result, source }));
  assert.deepEqual(result61, { handled: true, status: "book-resolved", source: "computer-printout", bookRoll: 7 });
  assert.deepEqual(book61, [{ book: "exorcism-ritual-book", source: "computer-printout" }], "the printout identifies the book variant without granting a second inventory object");
  assert.deepEqual(resolveFearRandomObjectBook("other-result", () => assert.fail(), () => assert.fail()), { handled: false });
});

test("Holy Bullets' separate pistol ammunition behavior stays bound to its source text and runtime regression", () => {
  const source = sourceBound("section-random-magic-item-table", "3842fac8b62e1992192cc04c05d637bbc603a4a821cf4368e0a9000485e263fa", ["section-random-magic-item-table:p4"]);
  const paragraph = source.paragraphs.find((value: { id: string }) => value.id.endsWith(":p4"));
  assert.match(paragraph.text, /2d6 bullets/i); assert.match(paragraph.text, /pistol only/i);
  assert.match(readFileSync("tests/fear-runtime.test.ts", "utf8"), /Holy Bullets are selectable pistol ammunition, deal 2 damage to a Demon/);
  const audit = json("work/alone-against-fear/silver-source-review.json");
  assert.ok(audit.sources.some((entry: { paragraph: string }) => entry.paragraph === "section-random-magic-item-table:p4"));
  assert.ok(audit.runtime.tests.some((entry: string) => entry.includes("ordinary pistol ammo to zero")));
});
