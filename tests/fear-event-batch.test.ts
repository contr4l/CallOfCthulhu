import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const batch = JSON.parse(readFileSync(resolve(root, "work/alone-against-fear/event-batch-2-12-reviewed.json"), "utf8"));
const sha = (path: string) => createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex");

test("Fear events 2-12 have exact source and translation SHA and paragraph bindings", () => {
  assert.equal(batch.sourcePdfSha256, "6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572");
  assert.deepEqual(batch.events.map((event: { id: string }) => event.id), Array.from({ length: 11 }, (_, index) => String(index + 2)));
  for (const event of batch.events) {
    assert.equal(sha(`scripts/${event.source.fragment}`), event.source.sha256, `event ${event.id} source hash`);
    assert.equal(sha(`scripts/${event.source.translation}`), event.source.translationSha256, `event ${event.id} translation hash`);
    const source = JSON.parse(readFileSync(resolve(root, `scripts/${event.source.fragment}`), "utf8"));
    const translation = JSON.parse(readFileSync(resolve(root, `scripts/${event.source.translation}`), "utf8"));
    assert.deepEqual(event.source.paragraphIds, source.paragraphs.map((p: { id: string }) => p.id));
    assert.deepEqual(event.source.translationParagraphIds, translation.paragraphs.map((p: { id: string }) => p.id));
    assert.deepEqual(event.source.paragraphIds, event.source.translationParagraphIds);
  }
});

test("event 12 has distinct source-grounded stealth, theft, bribe threshold and sewer fight branches", () => {
  const event = batch.events.find((value: { id: string }) => value.id === "12");
  assert.equal(event.operations[0].context, "stealth-save");
  assert.equal(event.operations[0].success[0].amount, "D6");
  const caught = event.operations[0].failure[0].success[0].choices;
  assert.ok(caught.bribe);
  const threshold = caught.bribe[0];
  assert.equal(threshold.value, 6);
  assert.equal(threshold.success[0].bonus, 1);
  assert.equal(threshold.success[0].success[0].op, "spend-all-resource");
  assert.equal(threshold.failure[0].failure[0].enemyId, "sewer-people");
  assert.equal(threshold.failure[0].failure[0].count, "D6+3");
});

test("Fluid table is page-78 source bound and resolves all six D6 outcomes", () => {
  const event = batch.events.find((value: { id: string }) => value.id === "4");
  assert.equal(event.tables.fluid.source.pdfPages[0], 78);
  assert.deepEqual(event.tables.fluid.entries.map((entry: { roll: number }) => entry.roll), [1, 2, 3, 4, 5, 6]);
  assert.equal(sha(`scripts/${event.tables.fluid.source.fragment}`), event.tables.fluid.source.sha256);
  assert.equal(sha(`scripts/${event.tables.fluid.source.translation}`), event.tables.fluid.source.translationSha256);
});

test("implemented event scripts remain typed data and Pighead's grouped combat is resolved", () => {
  for (const id of ["2", "3", "4", "6", "7", "8", "9", "10"]) {
    assert.ok(Array.isArray(batch.events.find((value: { id: string }) => value.id === id).operations), `event ${id} typed program`);
  }
  assert.ok(Array.isArray(batch.events.find((value: { id: string }) => value.id === "5").operations), "Pighead has a typed source-pinned program");
  assert.equal(batch.openMechanics?.["5"], undefined);
  assert.equal(batch.openMechanics?.["11"], undefined);
  const definition = JSON.parse(readFileSync(resolve(root, "work/alone-against-fear/reviewed-definition.json"), "utf8"));
  const pighead = definition.eventPrograms["5"][0].ifNew[0].choices.fight;
  assert.deepEqual(pighead[0].groups, [{ enemyId: "pighead", count: 1 }, { enemyId: "pig", count: 6 }]);
  assert.deepEqual(pighead[0].escapeAfter, { enemyId: "pig", defeated: 3 });
  assert.deepEqual(pighead[1], { op: "group-combat-outcome", primaryEnemyId: "pighead", foodEnemyId: "pig", foodEach: "D6", allDefeated: [{ op: "route", scene: "6" }] });
  assert.deepEqual(definition.eventPrograms["11"], [{ op: "sewer-shelter", enemyId: "sewer-rat-horde" }]);
  assert.ok(batch.events.find((value: { id: string }) => value.id === "10").operations.some((op: { op: string }) => op.op === "combat-outcome"));
});

test("Fear events 13-24 bind every source and Chinese paragraph and preserve exact source numbering", () => {
  const batch = JSON.parse(readFileSync(resolve(root, "work/alone-against-fear/event-batch-13-24-reviewed.json"), "utf8"));
  assert.equal(batch.sourcePdfSha256, "6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572");
  assert.deepEqual(batch.events.map((event: { id: string }) => event.id), Array.from({ length: 12 }, (_, index) => String(index + 13)));
  for (const event of batch.events) {
    assert.equal(sha(`scripts/${event.source.fragment}`), event.source.sha256, `event ${event.id} source hash`);
    assert.equal(sha(`scripts/${event.source.translation}`), event.source.translationSha256, `event ${event.id} translation hash`);
    const source = JSON.parse(readFileSync(resolve(root, `scripts/${event.source.fragment}`), "utf8"));
    const translation = JSON.parse(readFileSync(resolve(root, `scripts/${event.source.translation}`), "utf8"));
    assert.deepEqual(event.source.paragraphIds, source.paragraphs.map((p: { id: string }) => p.id));
    assert.deepEqual(event.source.paragraphIds, translation.paragraphs.map((p: { id: string }) => p.id));
  }
  assert.ok(batch.events.find((event: { id: string }) => event.id === "21").operations.some((op: { op: string }) => op.op === "event-end"));
});

test("Fear events 25-42 bind every source and Chinese paragraph; reviewed work files expose incomplete mechanics", () => {
  const batch = JSON.parse(readFileSync(resolve(root, "work/alone-against-fear/event-batch-25-42-reviewed.json"), "utf8"));
  assert.deepEqual(batch.events.map((event: { id: string }) => event.id), Array.from({ length: 18 }, (_, index) => String(index + 25)));
  for (const event of batch.events) {
    assert.equal(sha(`scripts/${event.source.fragment}`), event.source.sha256, `event ${event.id} source hash`);
    assert.equal(sha(`scripts/${event.source.translation}`), event.source.translationSha256, `event ${event.id} translation hash`);
    const source = JSON.parse(readFileSync(resolve(root, `scripts/${event.source.fragment}`), "utf8"));
    const translation = JSON.parse(readFileSync(resolve(root, `scripts/${event.source.translation}`), "utf8"));
    assert.deepEqual(event.source.paragraphIds, source.paragraphs.map((p: { id: string }) => p.id));
    assert.deepEqual(event.source.paragraphIds, translation.paragraphs.map((p: { id: string }) => p.id));
  }
  const definition = JSON.parse(readFileSync(resolve(root, "work/alone-against-fear/reviewed-definition.json"), "utf8"));
  const review = JSON.parse(readFileSync(resolve(root, "work/alone-against-fear/reviewed-definition-review.json"), "utf8"));
  assert.equal(review.runtimeReady, false);
  assert.deepEqual(review.pendingSourceMechanics.eventProgramsMissing, []);
  const story = JSON.parse(readFileSync(resolve(root, "work/alone-against-fear/reviewed-story.json"), "utf8"));
  const eventNodeIds = story.nodes.map((node: { id: string }) => node.id).filter((id: string) => /^\d+$/.test(id));
  assert.deepEqual(eventNodeIds, Array.from({ length: 42 }, (_, index) => String(index + 1)));
  assert.ok(story.nodes.some((node: { id: string; type: string }) => node.id === "table-rewards" && node.type === "fear"),
    "the extra non-event node is the source-backed Rewards table scene");
  assert.equal(story.nodes.length, 43);
  assert.equal(story.nodes.every((node: { type: string }) => node.type === "fear"), true);
});
