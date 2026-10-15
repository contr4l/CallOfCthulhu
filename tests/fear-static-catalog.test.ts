import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

const root = process.cwd();
const catalog = JSON.parse(readFileSync(`${root}/work/alone-against-fear/static-catalog-candidate.json`, "utf8"));
const definition = JSON.parse(readFileSync(`${root}/work/alone-against-fear/reviewed-definition.json`, "utf8"));
const review = JSON.parse(readFileSync(`${root}/work/alone-against-fear/static-catalog-review.json`, "utf8"));
const bytes = (path: string) => readFileSync(`${root}/scripts/${path}`);
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

test("Fear static combat catalog pins all monster rows and skill/weapon definitions to source and translation fragments", () => {
  assert.equal(catalog.sourcePdfSha256, "6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572");
  assert.equal(Object.keys(catalog.enemies).length, 72);
  assert.equal(Object.keys(catalog.tables).length, 12);
  assert.equal(Object.keys(catalog.skillDefinitions).length, 32);
  assert.equal(Object.keys(catalog.weapons).length, 25);
  for (const source of [review.skillSource, review.arcaneSkillSource, review.weaponSource, ...review.carryRuleSources, ...review.enemyTables, review.characterCreationSource]) {
    assert.equal(sha(bytes(source.fragment)), source.sha256, `${source.fragment} SHA`);
    assert.equal(sha(bytes(source.translation)), source.translationSha256, `${source.translation} translation SHA`);
    const fragment = JSON.parse(bytes(source.fragment).toString("utf8"));
    const translated = JSON.parse(bytes(source.translation).toString("utf8"));
    assert.ok(source.paragraphIds.every((id: string) => fragment.paragraphs.some((p: { id: string }) => p.id === id)));
    assert.ok(source.paragraphIds.every((id: string) => translated.paragraphs.some((p: { id: string }) => p.id === id)));
  }
  assert.equal(Object.keys(definition.skills).length, 32);
  assert.equal(Object.keys(definition.weapons).length, 27, "the source-reviewed alien raygun and Coven Witch cursed blade are runtime weapon profiles");
  assert.equal(Object.keys(definition.enemies).length, 95, "93 tracked runtime profiles, the source-defined Coven Witch, and Kalina's distinct Toy Dinosaur profile");
  for (const [id, enemy] of Object.entries(definition.enemies) as [string, { label: string }][])
    assert.match(enemy.label, /[\u4e00-\u9fff]/, `${id} has a translated player-facing label`);
  assert.equal(definition.enemies["undead-1"].label, "僵尸");
  assert.equal(definition.enemies["undead-3"].damage, 2, "later Molotov immunity prose must not erase the row's own 2 damage stat");
  assert.ok(definition.enemies["undead-1"].tags.includes("zombie"));
  assert.ok(definition.enemies["undead-2"].tags.includes("zombie"));
  for (const id of ["undead-3", "undead-4", "undead-5", "undead-6"])
    assert.ok(!definition.enemies[id].tags.includes("zombie"), `${id} is not a zombie row`);
  for (let row = 1; row <= 6; row++)
    assert.ok(definition.enemies[`demonic-horrors-${row}`].tags.includes("demonic-horrors-table"), `Demon Slayer source membership ${row}`);
  assert.equal(definition.enemies["slashers-3"].label, "屠夫");
  assert.equal(definition.weapons.raygun.label, "外星射线枪");
  assert.equal(definition.enemies["living-dolls-6"].label, "卡莉娜与她的玩具恐龙");
  assert.deepEqual(
    [definition.enemies["living-dolls-6-dinosaur"].level, definition.enemies["living-dolls-6-dinosaur"].life, definition.enemies["living-dolls-6-dinosaur"].damage],
    [4, 6, 2], "the dinosaur keeps its distinct printed L4/6-Life/2-damage combat profile",
  );
  const dollSource = review.enemyTables.find((item: { fragment: string }) => item.fragment.endsWith("section-living-dolls-table.json"));
  assert.ok(dollSource?.paragraphIds.includes("section-living-dolls-table:p6"));
  const dollParagraph = JSON.parse(bytes(dollSource.fragment).toString("utf8")).paragraphs.find((item: { id: string }) => item.id === "section-living-dolls-table:p6");
  const dollTranslation = JSON.parse(bytes(dollSource.translation).toString("utf8")).paragraphs.find((item: { id: string }) => item.id === "section-living-dolls-table:p6");
  assert.match(dollParagraph.text, /dinosaur, 6 Life, 2 damage/);
  assert.match(dollTranslation.text, /恐龙是L4，生命6，伤害2/);
  assert.equal(definition.skills.tough.maxHpChange[0], 2);
  assert.equal(definition.skills["strong-grip-on-reality"].maxSanityChange[0], 1);
  assert.deepEqual(definition.skills.strong.capacityBonus, [3, 5]);
  assert.equal(catalog.weapons["ghost-blade"].label, "幽灵之刃");
  assert.equal(catalog.weapons["cursed-blade"].label, "诅咒之刃");
  for (const entry of review.additionalWeaponSources) {
    for (const source of (entry.sources ?? [entry.source])) {
      assert.equal(sha(bytes(source.fragment)), source.sha256, `${entry.weaponId} source SHA`);
      assert.equal(sha(bytes(source.translation)), source.translationSha256, `${entry.weaponId} translation SHA`);
      const fragment = JSON.parse(bytes(source.fragment).toString("utf8"));
      const translated = JSON.parse(bytes(source.translation).toString("utf8"));
      assert.ok(source.paragraphIds.every((id: string) => fragment.paragraphs.some((p: { id: string }) => p.id === id)));
      assert.ok(source.paragraphIds.every((id: string) => translated.paragraphs.some((p: { id: string }) => p.id === id)));
    }
  }
  assert.deepEqual(review.additionalWeaponSources.map((entry: { weaponId: string }) => entry.weaponId).sort(), ["cursed-blade", "ghost-blade"]);
  assert.deepEqual(review.characterCreationSource.ruleParagraphIds, ["section-your-character:p5"]);
});

test("special creature rows stay explicitly unresolved instead of receiving invented ordinary combat stats", () => {
  assert.equal(review.reviewStatus, "static-values-extracted-special-effects-pending");
  assert.ok(review.unresolved.length > 0);
  for (const gap of review.unresolved) assert.ok(gap.issue.length > 0);
  assert.ok(review.unresolved.some((gap: { issue: string }) => gap.issue.includes("source-specific")));
});

test("the five user-authorized omitted-damage rows are explicit 1 HP web adaptations, never source text", () => {
  const special = JSON.parse(readFileSync(`${root}/work/alone-against-fear/special-creatures-review.json`, "utf8"));
  const expected = ["demonic-horrors-2", "possessed-2", "possessed-3", "possessed-5", "possessed-6"];
  assert.deepEqual(special.damageAdaptations.map((row: { enemyId: string }) => row.enemyId).sort(), expected);
  for (const id of expected) {
    const profile = definition.enemies[id];
    assert.equal(profile.damage, 1, `${id} runtime damage`);
    assert.equal(profile.damageBasis, "user-authorized-web-adaptation", `${id} provenance`);
    const audit = special.damageAdaptations.find((row: { enemyId: string }) => row.enemyId === id);
    assert.equal(audit.value, 1);
    assert.equal(audit.authorizedDate, "2026-10-13");
    assert.equal(audit.sourceTextStatus, "not printed in source row");
  }
  assert.equal(definition.enemies["possessed-4"].damage, 0, "Demon Cat has its own printed attack instead of ordinary damage");
});

test("Arcane skill labels are translated and book-learning catalog has source-fragment paragraph coverage", () => {
  assert.equal(Object.values(definition.arcaneLearning).length, 11);
  const labels = Object.fromEntries(Object.entries(definition.skills).filter(([, s]: [string, any]) => s.kind === "arcane").map(([id, s]: [string, any]) => [id, s.label]));
  assert.equal(labels["alien-fighter"], "外星战士");
  assert.equal(labels["summon-servitor"], "召唤使魔");
  const original = JSON.parse(bytes("alone-against-fear/fragments/section-arcane-skills.json").toString("utf8"));
  const translation = JSON.parse(bytes("alone-against-fear/translations/zh-CN/section-arcane-skills.json").toString("utf8"));
  assert.equal(sha(bytes("alone-against-fear/fragments/section-arcane-skills.json")), review.arcaneSkillSource.sha256);
  assert.equal(sha(bytes("alone-against-fear/translations/zh-CN/section-arcane-skills.json")), review.arcaneSkillSource.translationSha256);
  assert.deepEqual(original.paragraphs.map((p: { id: string }) => p.id), translation.paragraphs.map((p: { id: string }) => p.id));
  for (const refs of Object.values(review.arcaneLearningRules.ruleParagraphIds) as string[][]) {
    for (const id of refs) {
      assert.ok(original.paragraphs.some((p: { id: string }) => p.id === id));
      assert.ok(translation.paragraphs.some((p: { id: string }) => p.id === id));
    }
  }
});

test("every random-book table result is typed as a book for once-per-game duplicate rules", () => {
  const original = JSON.parse(bytes("alone-against-fear/fragments/section-random-book-table.json").toString("utf8"));
  const sourceSha = sha(bytes("alone-against-fear/fragments/section-random-book-table.json"));
  assert.equal(sourceSha, "6c52f9a8e96be3f9f9f32ace7a25d79594e6677d28c93913962b8e49299654ab");
  const translation = JSON.parse(bytes("alone-against-fear/translations/zh-CN/section-random-book-table.json").toString("utf8"));
  assert.equal(translation.sourceFragmentSha256, sourceSha);
  for (const entry of definition.tables["random-books"].entries) {
    for (const operation of entry.operations ?? []) if (operation.op === "item")
      assert.ok(definition.items[operation.itemId]?.tags?.includes("book"), `${operation.itemId} is source-book item`);
  }
  assert.match(original.paragraphs[7].text, /Each book may be found only once per game/);
  assert.match(translation.paragraphs.find((p: { id: string }) => p.id.endsWith(":p7")).text, /每本书每局游戏只能找到一次/);
});

test("kitchen knife is a source-bound weapon reward and the user-approved ritual component", () => {
  const entry = definition.tables["useful-stuff"].entries.find((row: any) => row.roll === 53);
  assert.equal(entry.result, "kitchen-knife");
  assert.deepEqual(entry.operations, [{ op: "weapon", weaponId: "kitchen-knife" }]);
  const audit = review.servitorComponentReview;
  assert.equal(audit.authorizedBy, "user");
  assert.equal(audit.authorizedDate, "2026-10-14");
  assert.equal(audit.weaponId, "kitchen-knife");
  assert.deepEqual(audit.sourcePins.map((pin: any) => pin.paragraphIds), [
    ["section-useful-stuff-table:p11"],
    ["section-weapon-summary-table:p1"],
    ["section-weapon-rules:p1"],
    ["section-arcane-skills:p21", "section-arcane-skills:p24"],
  ]);
  for (const pin of audit.sourcePins) {
    assert.equal(sha(bytes(pin.fragment)), pin.sha256, `${pin.fragment} SHA`);
    assert.equal(sha(bytes(pin.translation)), pin.translationSha256, `${pin.translation} SHA`);
    const source = JSON.parse(bytes(pin.fragment).toString("utf8"));
    const translation = JSON.parse(bytes(pin.translation).toString("utf8"));
    for (const id of pin.paragraphIds) {
      assert.ok(source.paragraphs.some((paragraph: any) => paragraph.id === id));
      assert.ok(translation.paragraphs.some((paragraph: any) => paragraph.id === id));
    }
  }
});
