"""Focused source-shaped regression tests for Fear catalog regeneration."""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/story"))
from fear_catalog import merge_reviewed_enemy_profile, read, split_rows, species_tags  # noqa: E402


class FearCatalogIdempotencyTest(unittest.TestCase):
    def test_real_crocodile_source_profile_refresh_preserves_reviewed_rules(self):
        candidate = json.loads((ROOT / "work/alone-against-fear/static-catalog-candidate.json").read_text())
        definition = json.loads((ROOT / "work/alone-against-fear/reviewed-definition.json").read_text())
        source = candidate["enemies"]["beasts-1"]
        reviewed = definition["enemies"]["beasts-1"]
        rebuilt = merge_reviewed_enemy_profile(reviewed, source, ["animal"])

        self.assertEqual(source["source"]["paragraphIds"], ["section-beasts-table:p1"])
        self.assertEqual(rebuilt["surprise"], 1)
        self.assertEqual(rebuilt["surpriseByLocation"], {"sewers": 3})
        self.assertEqual(rebuilt["attackBounceChance"], [2, 6])
        self.assertEqual(rebuilt["tags"], sorted(set(reviewed.get("tags", [])) | {"animal"}))
        self.assertEqual(rebuilt["life"], source["life"])

    def test_reviewed_escape_and_infection_rules_survive_source_stat_refresh(self):
        candidate = json.loads((ROOT / "work/alone-against-fear/static-catalog-candidate.json").read_text())
        definition = json.loads((ROOT / "work/alone-against-fear/reviewed-definition.json").read_text())
        for enemy_id, expected in {
            "beasts-2": {"escapeModifier": -1, "escapeBait": {"itemIds": ["dog-food", "dog-toy"], "bonus": 1}},
            "beasts-3": {"surprise": 2, "infectionChance": [1, 6],
                         "escapeBait": {"itemIds": ["dog-food", "dog-toy"], "food": 2, "bonus": 2}},
            "demon-cat": {"fleeAtLife": 2, "fleeChance": [4, 6]},
        }.items():
            source = candidate["enemies"].get(enemy_id, definition["enemies"][enemy_id])
            rebuilt = merge_reviewed_enemy_profile(definition["enemies"][enemy_id], source, [])
            for field, value in expected.items():
                self.assertEqual(rebuilt[field], value, f"{enemy_id}.{field}")

    def test_species_tags_follow_actual_undead_and_lab_source_rows(self):
        definition = json.loads((ROOT / "work/alone-against-fear/reviewed-definition.json").read_text())
        expected = {
            "undead-1": {"undead", "zombie"},
            "undead-2": {"undead", "zombie"},
            "undead-3": {"undead", "skeleton", "flaming-skeleton"},
            "undead-4": {"undead"},
            "undead-5": {"undead"},
            "undead-6": {"undead", "vampire"},
            "lab-horrors-1": {"artificial"},
            "lab-horrors-2": {"artificial"},
            "lab-horrors-3": {"mutant", "humanoid"},
            "lab-horrors-4": {"humanoid"},
            "lab-horrors-5": set(),
            "lab-horrors-6": {"animal"},
        }
        for table in ("undead", "lab-horrors"):
            fragment = read(ROOT / f"scripts/alone-against-fear/fragments/section-{table}-table.json")
            for roll, english_row, _paragraph_ids in split_rows(fragment):
                enemy_id = f"{table}-{roll}"
                tags = species_tags(english_row)
                self.assertEqual(set(tags), expected[enemy_id], enemy_id)
                reviewed = definition["enemies"].get(enemy_id, {})
                rebuilt = merge_reviewed_enemy_profile(reviewed, reviewed, tags)
                managed = {"undead", "zombie", "vampire", "ghost", "skeleton", "flaming-skeleton", "alien", "mutant", "demon", "artificial", "animal", "humanoid"}
                retained = set(reviewed.get("tags", [])) - managed
                self.assertEqual(set(rebuilt["tags"]), expected[enemy_id] | retained, enemy_id)

    def test_coven_mission_enemy_is_source_bound_and_survives_catalog_rebuild(self):
        definition = json.loads((ROOT / "work/alone-against-fear/reviewed-definition.json").read_text())
        review = json.loads((ROOT / "work/alone-against-fear/static-catalog-review.json").read_text())
        profile = definition["enemies"]["coven-witch"]
        self.assertEqual((profile["level"], profile["life"], profile["damage"]), (4, 4, 1))
        self.assertEqual(set(profile["tags"]), {"human", "witch"})
        source = review["missionEnemyProfiles"][0]
        self.assertEqual(source["enemyId"], "coven-witch")
        self.assertEqual(source["sourcePin"]["paragraphIds"], ["section-mission-table-continued:p2"])
        self.assertEqual(source["sourcePin"]["sourcePages"], [41])
        self.assertEqual(source["damageBasisPin"]["sourceParagraphIds"], ["section-combat:p1"])


if __name__ == "__main__":
    unittest.main()
