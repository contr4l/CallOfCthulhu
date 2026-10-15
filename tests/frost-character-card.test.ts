import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { runtimeGraphSchema, validateStory } from "../apps/api/src/catalog.js";
import { loadFragmentStory } from "../apps/api/src/modules/story-fragments.js";
import { initialState, advance } from "../packages/engine/index.js";
import { createCharacter } from "../packages/rules/index.js";

test("Frost preserves printed Credit Rating and applies the separate Hatchet specialization", () => {
  const story = loadFragmentStory(
    resolve(
      "stories/alone-against-frost/1.0.5/story.json",
    ),
    (data) => runtimeGraphSchema.parse(data),
    validateStory,
  );
  const sourceAudit = JSON.parse(
    readFileSync(
      resolve("scripts/alone-against-frost/review/character-audit.json"),
      "utf8",
    ),
  );
  assert.equal(
    sourceAudit.characters[0].printedSkillValues["Credit Rating"],
    64,
  );
  assert.equal(sourceAudit.runtimeCorrection.hatchetBaseIsWebAdaptation, true);
  const noDice = () => {
    throw Error("Character allocation must not reroll anything");
  };
  const witness = JSON.parse(
    readFileSync(
      resolve(
        "work/alone-against-frost/verified-final-api-witnesses-current.json",
      ),
      "utf8",
    ),
  ).routes[0];
  for (const preset of story.presets) {
    assert.equal(preset.skills.creditRating, 64);
    assert.equal(preset.skills.hatchet, 15);
    let state = initialState(
      story,
      createCharacter("来源角色卡测试", preset, 85),
      noDice,
    );
    for (const step of witness.steps.slice(0, 2))
      state = advance(story, state, step.action, noDice, step.input).state;
    assert.equal(
      state.character.skills.creditRating,
      64,
      "both printed starting values survive separate profession and interest allocation",
    );
    assert.equal(
      state.character.skills.hatchet,
      15 + witness.steps[1].input.hatchet,
    );
    assert.notEqual(
      state.character.skills.hatchet,
      state.character.skills.fightingBrawl,
    );
  }
  const charlie = story.party!.members.find(
    (member) => member.id === "charlie",
  )!;
  assert.equal(
    charlie.character.skills.hatchet,
    50,
    "Charlie’s printed Axe 50 is used for the same weapon",
  );
  for (const node of story.nodes)
    if (node.type === "program")
      for (const step of node.program ?? [])
        if (step.kind === "partyCombat") {
          for (const weapon of step.combat.weapons)
            if (weapon.key === "hatchet") {
              assert.equal(
                weapon.skill,
                "hatchet",
                `source weapon ${node.id}/${weapon.id} must not ignore its printed specialization`,
              );
              assert.equal(weapon.damage, "1D6+1");
            }
        }
});
