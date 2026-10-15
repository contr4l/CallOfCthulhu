import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

type Entry = { roll: number | [number, number]; result: string; operations?: Array<{ op: string; tableId?: string; tableIds?: string[]; scene?: string }>; tags?: string[] };
type Batch = { format: string; sourcePdfSha256: string; tables: Array<{ id: string; die: string; source: { fragment: string; sha256: string; translation: string; translationSha256: string; pdfPages: number[]; sourceParagraphIds: string[]; translationParagraphIds: string[] }; entries: Entry[] }> };
const root = process.cwd();
const batch = JSON.parse(readFileSync(`${root}/work/alone-against-fear/table-batch-1.json`, "utf8")) as Batch;
const read = (path: string) => readFileSync(`${root}/scripts/${path}`, "utf8");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("Fear table batch is bound to source and translated paragraph identities", () => {
  assert.equal(batch.format, "fear-reviewed-table-batch@1");
  assert.equal(batch.sourcePdfSha256, "6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572");
  for (const table of batch.tables) {
    const source = JSON.parse(read(table.source.fragment));
    const translation = JSON.parse(read(table.source.translation));
    assert.equal(sha(read(table.source.fragment)), table.source.sha256, `${table.id}: source SHA`);
    assert.equal(sha(read(table.source.translation)), table.source.translationSha256, `${table.id}: translation SHA`);
    assert.deepEqual(source.sourcePages, table.source.pdfPages, `${table.id}: PDF pages`);
    assert.deepEqual(source.paragraphs.map((p: { id: string }) => p.id), table.source.sourceParagraphIds, `${table.id}: source paragraph IDs`);
    assert.deepEqual(translation.paragraphs.map((p: { id: string }) => p.id), table.source.translationParagraphIds, `${table.id}: translation paragraph IDs`);
  }
});

test("source table ranges cover every printed dice result without gaps or duplicates", () => {
  for (const table of batch.tables) {
    const values = new Set<number>();
    const min = table.die === "2D6" ? 2 : table.die === "D66" ? 11 : 1;
    const max = table.die === "2D6" ? 12 : table.die === "D66" ? 66 : 6;
    for (const entry of table.entries) {
      const [low, high] = typeof entry.roll === "number" ? [entry.roll, entry.roll] : entry.roll;
      for (let value = low; value <= high; value++) {
        assert.ok(value >= min && value <= max, `${table.id}: out of range ${value}`);
        assert.ok(!values.has(value), `${table.id}: duplicate roll ${value}`);
        values.add(value);
      }
    }
    for (let value = min; value <= max; value++) {
      if (table.die === "D66" && (Math.floor(value / 10) < 1 || value % 10 < 1 || value % 10 > 6)) continue;
      assert.ok(values.has(value), `${table.id}: missing roll ${value}`);
    }
  }
});

test("Fear batch keeps D6xD6 encounter order and distinct safehouse thresholds", () => {
  const encounter = batch.tables.find(t => t.id === "random-encounter")!;
  assert.equal(encounter.die, "D66");
  assert.ok(encounter.entries.some(e => Array.isArray(e.roll) && e.roll[0] === 11 && e.roll[1] === 12));
  const street = batch.tables.find(t => t.id === "street")!.entries[0].operations?.[0];
  const cemetery = batch.tables.find(t => t.id === "cemetery")!.entries.find(e => e.roll === 4)!.operations?.[0];
  assert.equal(street?.op, "mark-safehouse"); assert.equal(cemetery?.op, "mark-safehouse");
  assert.equal((street as { threshold?: string }).threshold, "after-create-3");
  assert.equal((cemetery as { threshold?: string }).threshold, "before-create-3");
});

test("every nonempty table outcome has a typed effect or a deliberate no-encounter result", () => {
  const supported = new Set(["roll-table", "choose-table", "search-loot-choice", "mark-safehouse", "resource", "item", "weapon", "start-combat", "roll-check", "probability", "injury-check", "event-branch", "route", "unique-event", "choose-item", "choose-reward", "choose-effect", "rest-choice", "optional-safehouse", "search-bonus-choice", "clinic-search-choice", "conditional-skill-purchase", "farm-food-or-search", "farmer-choice", "mission-progress"]);
  for (const table of batch.tables) for (const entry of table.entries) {
    assert.ok(entry.operations?.length || ["nothing", "quiet"].includes(entry.result), `${table.id} ${entry.roll} lacks an effect`);
    for (const effect of entry.operations ?? []) assert.ok(supported.has(effect.op), `${table.id} ${entry.roll}: unknown typed operation ${effect.op}`);
  }
});

test("new Fear table batches remain bound to original and translated fragments", () => {
  const definition = JSON.parse(readFileSync(`${root}/work/alone-against-fear/reviewed-definition.json`, "utf8"));
  const review = JSON.parse(readFileSync(`${root}/work/alone-against-fear/reviewed-definition-review.json`, "utf8"));
  for (const id of ["store", "sewers", "railways", "woods-park", "school", "children-stuff", "house-repeat", "random-item-in-the-hut", "random-item-in-hut", "random-books", "random-magic-item", "injuries", "insanity"]) {
    const pin = review.tableSourcePins[id]; assert.ok(pin, `${id} source pin`);
    const sourceBytes = readFileSync(`${root}/scripts/${pin.fragment}`);
    const translationBytes = readFileSync(`${root}/scripts/${pin.translation}`);
    assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), pin.sha256);
    assert.equal(createHash("sha256").update(translationBytes).digest("hex"), pin.translationSha256);
    const source = JSON.parse(sourceBytes.toString("utf8")); const translation = JSON.parse(translationBytes.toString("utf8"));
    assert.deepEqual(pin.paragraphIds, source.paragraphs.map((p: { id: string }) => p.id));
    assert.deepEqual(pin.paragraphIds, translation.paragraphs.map((p: { id: string }) => p.id));
    assert.equal(definition.tables[id]?.entries.length > 0, true, `${id} actual table definition`);
  }
  assert.deepEqual(definition.tables["random-magic-item"].entries.map((row: { roll: number }) => row.roll), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(definition.tables.sewers.entries.map((row: { roll: number }) => row.roll), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(definition.tables.railways.entries.map((row: { roll: number }) => row.roll), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(definition.tables.school.entries.map((row: { roll: number }) => row.roll), [1, 2, 3, 4, 5, 6]);
  assert.equal(definition.enemies["demon-cat"].fleeAtLife, 2, "cat's flee check starts after at least two damage");
  const piper = definition.tables["witch-children"].entries.find((row: { roll: number }) => row.roll === 5);
  assert.ok(piper.operations.some((op: { op: string; fled?: Array<{ op: string }> }) => op.op === "combat-outcome" && op.fled?.some(result => result.op === "probability")));
  assert.deepEqual(definition.tables.ghosts.entries.filter((row: { roll: number }) => [1, 3, 4, 6].includes(row.roll)).map((row: { values?: unknown }) => row.values), [undefined, undefined, undefined, undefined]);
});

test("all six creature tables and the six-result mission selector are source-bound", () => {
  const definition = JSON.parse(readFileSync(`${root}/work/alone-against-fear/reviewed-definition.json`, "utf8"));
  const review = JSON.parse(readFileSync(`${root}/work/alone-against-fear/reviewed-definition-review.json`, "utf8"));
  for (const id of ["demonic-horrors", "ghosts", "lab-horrors", "living-dolls", "possessed", "witch-children"]) {
    assert.deepEqual(definition.tables[id].entries.map((entry: { roll: number }) => entry.roll), [1, 2, 3, 4, 5, 6]);
    const pin = review.sourceBindings[`table:${id}`]; assert.ok(pin, `${id} source binding`);
    assert.equal(sha(read(pin.fragment)), pin.sha256);
    assert.equal(sha(read(pin.translation)), pin.translationSha256);
    assert.deepEqual(pin.paragraphIds, JSON.parse(read(pin.fragment)).paragraphs.map((p: { id: string }) => p.id));
    assert.deepEqual(pin.paragraphIds, JSON.parse(read(pin.translation)).paragraphs.map((p: { id: string }) => p.id));
  }
  assert.deepEqual(definition.tables.missions.entries.map((entry: { roll: number }) => entry.roll), [1, 2, 3, 4, 5, 6]);
  for (const id of ["mission-table", "mission-table-continued"]) {
    const pin = review.sourceBindings[`table:missions:${id}`]; assert.ok(pin, `${id} source binding`);
    assert.equal(sha(read(pin.fragment)), pin.sha256);
    assert.equal(sha(read(pin.translation)), pin.translationSha256);
  }
});

test("fourteen special-creature rules keep exact source and translation paragraph pins", () => {
  const audit = JSON.parse(readFileSync(`${root}/work/alone-against-fear/special-creatures-review.json`, "utf8"));
  assert.equal(audit.format, "fear-special-creature-audit@1");
  assert.equal(audit.entries.length, 14);
  for (const entry of audit.entries) {
    const sourceBytes = readFileSync(`${root}/scripts/${entry.sourceFragment}`);
    const translationBytes = readFileSync(`${root}/scripts/${entry.translationFragment}`);
    assert.equal(sha(sourceBytes.toString("utf8")), entry.sourceSha256, `${entry.id} source SHA`);
    assert.equal(sha(translationBytes.toString("utf8")), entry.translationSha256, `${entry.id} translation SHA`);
    const source = JSON.parse(sourceBytes.toString("utf8")); const translation = JSON.parse(translationBytes.toString("utf8"));
    assert.ok(source.paragraphs.some((p: { id: string }) => p.id === entry.sourceParagraphId), `${entry.id} source paragraph`);
    assert.ok(translation.paragraphs.some((p: { id: string }) => p.id === entry.sourceParagraphId), `${entry.id} translation paragraph`);
  }
});
