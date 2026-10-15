import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  loadSourceDag,
  loadSourceFragment,
  validateSourceFragments,
} from "../apps/api/src/modules/source-dag.js";

const graphPath = resolve("scripts/恐惧独行.dag.json");
const graph = loadSourceDag(graphPath);
const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("Fear source graph retains all 42 events, including printed event 37", () => {
  assert.equal(graph.runtimePlayable, false);
  assert.deepEqual(graph.nodes.map((node) => node.id),
    Array.from({ length: 42 }, (_, index) => String(index + 1)));
  assert.equal(graph.source.sha256,
    hash(readFileSync(resolve("scripts", graph.source.filename))));
  assert.equal(validateSourceFragments(graphPath).fragmentFiles, 134);
  const event37 = loadSourceFragment(graphPath, "37");
  assert.match(event37.paragraphs[0].text, /#37\./);
  assert.match(event37.paragraphs.map((row) => row.text).join(""), /Mark Tells a Story/);
});

test("Fear supplements use stable section fragments and preserve PDF provenance", () => {
  const supplements = readJson(resolve("scripts", graph.supplements.path));
  const provenance = supplements.documents[0].entries.find(
    (row: { kind: string }) => row.kind === "pdf-provenance",
  );
  assert.ok(provenance);
  const sections = provenance.metadata.sections;
  assert.equal(sections.length, 91);
  assert.ok(sections.every((section: { sectionId: string; fragment: { path: string } }) =>
    typeof section.sectionId === "string" && section.fragment.path.endsWith(".json")));
  assert.deepEqual(provenance.metadata.pdfPages.map((row: { pdfPage: number }) => row.pdfPage),
    Array.from({ length: 106 }, (_, index) => index + 1));
  assert.equal(provenance.metadata.ocrRecords.length, 12);
  assert.equal(provenance.metadata.assets.length, 45);
  assert.deepEqual(sections.slice(0, 25).map((row: { sectionId: string }) => row.sectionId), [
    "front-matter", "section-all-hell-breaks-loose", "section-overview-of-play", "section-mapping",
    "section-events", "section-character-death-or-insanity", "section-length-of-the-game",
    "section-what-you-need-to-play", "section-dice-codes", "section-monsters-roll-no-dice",
    "section-saves", "section-other-rolls", "section-attack-and-defense-rolls", "section-your-character",
    "section-sanity", "section-life", "section-food", "section-experience", "section-equipment",
    "section-skills", "section-arcane-skills", "section-random-weapon-table", "section-weapon-rules",
    "section-random-objects-table", "section-useful-stuff-table",
  ]);
  const pagesById = new Map(sections.map((row: { sectionId: string; sourcePages: number[] }) => [row.sectionId, row.sourcePages]));
  for (const [id, page] of Object.entries({
    "section-beasts-table": 59, "section-undead-table": 60, "section-possessed-table": 61,
    "section-demonic-horrors-table": 63, "section-slashers-table": 64,
    "section-lab-horrors-table": 65, "section-witch-children-table": 66,
    "section-living-dolls-table": 67, "section-aliens-table": 69,
    "section-unique-vampires-table": 70, "section-unique-zombies-table": 71,
    "section-fluid-table": 78, "section-random-item-in-the-hut": 82,
  })) assert.ok((pagesById.get(id) as number[]).includes(page), `${id} source page`);
  assert.ok(!sections.some((row: { sectionId: string; sourcePages: number[] }) =>
    row.sectionId === "section-mission" && row.sourcePages[0] < 10));
  assert.ok(sections.some((row: { sectionId: string; sourcePages: number[] }) =>
    row.sectionId === "section-play-aids-and-summaries" && row.sourcePages.includes(98)));
});

test("Fear event translations bind every translated paragraph to its source hashes", () => {
  const manifest = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/manifest.json"));
  assert.equal(manifest.status, "partial-review-required");
  assert.equal(manifest.completedFragments.length, 133);
  assert.equal(manifest.totalSourceFragments, 133);
  assert.equal(manifest.untranslatedSourceFragments, 0);
  assert.equal(manifest.translationStatus, "complete");
  assert.equal(manifest.rulesReviewStatus, "pending");
  assert.ok(manifest.completedFragments.includes("section-skills"));
  for (const row of manifest.translatedParagraphs) {
    const original = row.fragmentId.startsWith("section-") || row.fragmentId === "front-matter"
      ? readJson(resolve(`scripts/alone-against-fear/fragments/${row.fragmentId}.json`)).paragraphs
          .find((paragraph: { id: string }) => paragraph.id === row.paragraphId)
      : loadSourceFragment(graphPath, row.fragmentId).paragraphs.find((paragraph) => paragraph.id === row.paragraphId);
    const translationName = /^\d+$/.test(row.fragmentId)
      ? `${String(row.fragmentId).padStart(3, "0")}.json` : `${row.fragmentId}.json`;
    const translatedFile = readJson(resolve(`scripts/alone-against-fear/translations/zh-CN/${translationName}`));
    const translated = translatedFile.paragraphs.find(
      (paragraph: { id: string }) => paragraph.id === row.paragraphId,
    );
    assert.ok(original && translated);
    assert.equal(row.sourceTextSha256, hash(original.text));
    assert.equal(row.translationTextSha256, hash(translated.text));
  }
  assert.equal(manifest.completedFragments.filter((id: string) => id.startsWith("section-")).length, 90);
  const missionTable = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-mission-table-continued.json"));
  assert.match(missionTable.paragraphs[2].text, /L5意志.*1点理智/);
  assert.match(missionTable.paragraphs[3].text, /12\+D6格.*第30格/);
  const exploration = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-town-exploration-table.json"));
  assert.match(exploration.paragraphs[0].text, /2D6/);
  assert.match(exploration.paragraphs[1].text, /2 掷随机事件表/);
  assert.match(exploration.paragraphs[1].text, /12 掷树林\/公园表/);
  const undead = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-undead-table.json"));
  assert.match(undead.paragraphs[2].text, /L4不死生物.*突袭概率2\/6/);
  assert.match(undead.paragraphs[6].text, /每经过一格.*2\/6概率/);
  const aliens = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-aliens-table.json"));
  assert.match(aliens.paragraphs[2].text, /突袭概率4\/6/);
  assert.match(aliens.paragraphs[6].text, /4条触手.*3或4条/);
  const doll = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-living-dolls-table.json"));
  assert.match(doll.paragraphs[4].text, /生命12.*治疗1点生命/);
  const lab = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-military-installation-lab-table.json"));
  assert.match(lab.paragraphs[6].text, /危险感知和\/或敏捷技能提供\+1（合计\+1）/);
  const vampires = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-unique-vampires-table.json"));
  assert.ok(vampires.notes.some((note: string) => note.includes("Until you are held")));
  const weapons = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-weapon-summary-table.json"));
  assert.match(weapons.paragraphs[1].text, /手榴弹.*自动造成4点伤害/);
  assert.match(weapons.paragraphs[1].text, /步枪.*攻击两次.*消耗3发子弹/);
  const skills = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-random-skill-generation.json"));
  assert.match(skills.paragraphs[7].text, /1–2掷表1.*3–4掷表2.*5–6掷表3/);
  const sample = readJson(resolve("scripts/alone-against-fear/translations/zh-CN/section-sample-pregenerated-characters.json"));
  assert.match(sample.paragraphs[1].text, /理智9，生命10/);
  assert.match(sample.paragraphs[8].text, /电脑打印资料《他们就在我们之中》/);
});

test("Fear event recipe projections cite every event and avoid CoC checks/combat", () => {
  const recipes = readJson(resolve("work/alone-against-fear/event-recipes.json"));
  assert.equal(recipes.rulesVersion, "aaf-solo@1");
  assert.equal(recipes.runtimeExecutable, false);
  assert.equal(recipes.events.length, 42);
  for (const row of recipes.events) {
    assert.equal(row.eventId, String(recipes.events.indexOf(row) + 1));
    assert.ok(row.sourceFragmentSha256);
    assert.ok(row.translationFragmentSha256);
    assert.ok(row.programRecipe.dataAST.every(
      (instruction: { kind: string }) => ["rollEffects", "choices"].includes(instruction.kind),
    ));
    assert.equal(row.programRecipe.dataAST.some(
      (instruction: { kind: string }) => ["check", "combat"].includes(instruction.kind),
    ), false);
  }
});
