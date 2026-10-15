#!/usr/bin/env python3
"""Build/verify the data-only Alone Against Fear adapter candidate.

This compiler does not parse rules from prose. It accepts a reviewed, normalized
definition and checks that every node reference belongs to the candidate Story.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE = ROOT / "scripts/恐惧独行.dag.json"
PDF_NAME = "Alone Against Fear (Andrea Sfiligoi) (z-library.sk, 1lib.sk, z-lib.sk).pdf"
EXPECTED_PDF_SHA = "6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_definition(definition: dict[str, Any], story: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    if definition.get("format") != "aaf-fear-definition@1":
        raise ValueError("definition.format must be aaf-fear-definition@1")
    if definition.get("source") != {"pdfSha256": EXPECTED_PDF_SHA, "pages": 106}:
        raise ValueError("Fear definition must bind the verified 106-page source PDF SHA")
    if source.get("source", {}).get("sha256") != EXPECTED_PDF_SHA:
        raise ValueError("source graph is not bound to the verified Fear PDF")
    if story.get("rulesVersion") != "aaf-solo@1":
        raise ValueError("candidate Story must declare rulesVersion aaf-solo@1")
    nodes = story.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("candidate Story.nodes must contain real scene nodes")
    ids = [node.get("id") for node in nodes if isinstance(node, dict)]
    if len(ids) != len(nodes) or len(set(ids)) != len(ids):
        raise ValueError("candidate Story.nodes ids must be present and unique")
    valid_ids = set(ids)

    refs = definition.get("sceneRefs", {})
    if not all(key in refs for key in ("entry", "exploration", "missions", "tables", "events", "specialEvents", "endings")):
        raise ValueError("sceneRefs must include entry/exploration/missions/tables/events/specialEvents/endings")
    scene_ids = [refs["entry"], refs["exploration"], refs["missions"]]
    for collection in ("tables", "events", "specialEvents", "endings"):
        value = refs[collection]
        if not isinstance(value, dict):
            raise ValueError(f"sceneRefs.{collection} must be an object")
        scene_ids.extend(value.values())
    for enemy in definition.get("enemies", {}).values():
        if enemy.get("scene"):
            scene_ids.append(enemy["scene"])
    for mission in definition.get("missions", {}).values():
        if mission.get("scene"):
            scene_ids.append(mission["scene"])
    if definition.get("gates", {}).get("scene"):
        scene_ids.append(definition["gates"]["scene"])
    def operation_scene_refs(operations: list[dict[str, Any]]) -> list[str]:
        found: list[str] = []
        for operation in operations:
            if operation.get("op") == "route" and operation.get("scene"):
                found.append(operation["scene"])
            for key in ("success", "failure", "ifNew", "ifPlayed", "onFind"):
                nested = operation.get(key)
                if isinstance(nested, list):
                    found.extend(operation_scene_refs(nested))
            choices = operation.get("choices")
            if isinstance(choices, dict):
                for nested in choices.values():
                    if isinstance(nested, list):
                        found.extend(operation_scene_refs(nested))
        return found

    for table in definition.get("tables", {}).values():
        for outcome in table.get("entries", []):
            if outcome.get("scene"):
                scene_ids.append(outcome["scene"])
            scene_ids.extend(operation_scene_refs(outcome.get("operations", [])))
    missing = sorted({ref for ref in scene_ids if ref not in valid_ids})
    if missing:
        raise ValueError(f"Fear references nodes absent from candidate Story.nodes: {missing}")

    if set(refs["events"]) != {str(index) for index in range(1, 43)}:
        raise ValueError("sceneRefs.events must map every printed event #1 through #42")
    if set(definition.get("missions", {})) != {str(index) for index in range(1, 7)}:
        raise ValueError("Fear definition must contain all six mission table results")
    if definition.get("map", {}).get("boxesPerSheet") != 30:
        raise ValueError("Fear map sheets must retain all 30 source boxes")
    if definition.get("map", {}).get("topologyBasis") != "web-adaptation":
        raise ValueError("Map adjacency interpretation must be explicitly labeled as a web adaptation")
    for key in ("townExplorationTable", "randomEncounterTable", "usefulItemTable", "randomItemTable"):
        table_id = definition.get("rules", {}).get(key)
        if table_id not in definition.get("tables", {}):
            raise ValueError(f"Fear rules.{key} must reference a normalized table")
    starting_tables = definition.get("rules", {}).get("startingEquipmentTables")
    if starting_tables:
        for key in ("randomWeapon", "randomObject", "usefulItem"):
            if starting_tables.get(key) not in definition.get("tables", {}):
                raise ValueError(f"Fear startingEquipmentTables.{key} must reference a normalized table")

    # Rule graphs may contain compact labels and operations, never duplicated book prose.
    long_strings: list[str] = []
    def inspect(value: Any) -> None:
        if isinstance(value, str) and len(value) > 240:
            long_strings.append(value[:80])
        elif isinstance(value, dict):
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)
    inspect(definition)
    if long_strings:
        raise ValueError("Fear definition contains long prose; keep source text in runtime fragments")
    for table_id, table in definition.get("tables", {}).items():
        if not table.get("entries"):
            raise ValueError(f"Fear table {table_id} has no normalized outcomes")
        outcomes = list(table["entries"]) + ([table["exhausted"]] if table.get("exhausted") else [])
        for outcome in outcomes:
            if not re.fullmatch(r"[A-Za-z0-9_.:-]+", str(outcome.get("result", ""))):
                raise ValueError(f"Table {table_id} result must be a short stable token, not prose")
            for operation in outcome.get("operations", []):
                if operation.get("op") == "roll-table" and operation.get("tableId") not in definition.get("tables", {}):
                    raise ValueError(f"Table {table_id} references unknown table {operation.get('tableId')}")
                if operation.get("op") == "choose-table":
                    unknown = sorted(set(operation.get("tableIds", [])) - set(definition.get("tables", {})))
                    if unknown:
                        raise ValueError(f"Table {table_id} offers unknown table choices: {unknown}")
                if operation.get("op") == "choose-effect":
                    if not operation.get("choices") or any(not isinstance(effects, list) for effects in operation["choices"].values()):
                        raise ValueError(f"Table {table_id} has a malformed choose-effect operation")
    if definition.get("gates", {}).get("required") != 7:
        raise ValueError("Campaign victory must require seven closed Hell Gates")
    return {"storyNodeCount": len(ids), "sceneReferences": len(scene_ids), "events": 42, "missions": 6,
            "tables": len(definition.get("tables", {})), "enemies": len(definition.get("enemies", {})),
            "rulesVersion": "aaf-solo@1", "runtimeReady": False}


def build(source_path: Path, definition_path: Path, story_template_path: Path, output_path: Path) -> dict[str, Any]:
    source = read_json(source_path)
    definition = read_json(definition_path)
    template = read_json(story_template_path)
    if source.get("format") != "coc-story-graph@2" or source.get("runtimePlayable") is not False:
        raise ValueError("Fear source graph must stay a non-playable coc-story-graph@2 provenance graph")
    pdf = source_path.parent / PDF_NAME
    if not pdf.is_file() or sha(pdf.read_bytes()) != EXPECTED_PDF_SHA:
        raise ValueError(f"PDF source missing or SHA mismatch: {pdf}")
    # The web runtime uses the same strict Story shape as every other book.
    # Give each auxiliary Fear route its own source-backed scene instead of
    # aliasing tables, campaign setup, and endings to event #1.
    template["creationPolicy"] = "guided"
    template["cover"] = "/art/lighthouse.svg"
    template["presets"] = [{"id": "guided", "label": "引导式建卡", "description": "按恐惧独行规则分配生命与理智、选择两项初始技能并掷取装备。", "occupation": "独行调查者", "skills": {}, "hp": 8, "sanity": 8}]
    for node in template.get("nodes", []):
        node["background"] = "/art/lighthouse.svg"
    template.pop("runtimePlayable", None)

    source_dir = ROOT / "scripts/alone-against-fear/fragments"
    translation_dir = ROOT / "scripts/alone-against-fear/translations/zh-CN"

    def section_node(node_id: str, section_id: str, *, node_type: str = "fear", title_override: str | None = None) -> dict[str, Any]:
        original = read_json(source_dir / f"{section_id}.json")
        translated = read_json(translation_dir / f"{section_id}.json")
        source_paragraphs = original["paragraphs"]
        zh_paragraphs = translated["paragraphs"]
        if [p["id"] for p in source_paragraphs] != [p["id"] for p in zh_paragraphs]:
            raise ValueError(f"Source/translation paragraph IDs differ for {section_id}")
        en_title = source_paragraphs[0]["text"].strip()
        zh_title = zh_paragraphs[0]["text"].strip()
        en_body = [p["text"].strip() for p in source_paragraphs[1:]] or [en_title]
        zh_body = [p["text"].strip() for p in zh_paragraphs[1:]] or [zh_title]
        return {"id": node_id, "title": title_override or zh_title, "chapter": "规则与表格", "text": en_body,
                "reading": {"en": {"title": en_title, "text": en_body}, "zh-CN": {"title": title_override or zh_title, "text": zh_body}},
                "type": node_type, "sourceId": section_id, "background": "/art/lighthouse.svg"}

    section_for_table = {
        "town-exploration": "section-town-exploration-table", "search": "section-search-rolls",
        "random-encounter": "section-random-encounter", "street": "section-street-table",
        "cemetery": "section-cemetery-table", "house": "section-house-table", "clinic": "section-clinic-table",
        "worship": "section-place-of-worship-table", "military": "section-military-installation-lab-table",
        "farm": "section-farm-table", "random-weapon": "section-random-weapon-table",
        "random-objects": "section-random-objects-table", "useful-stuff": "section-useful-stuff-table",
        "house-or-special": "section-town-exploration-table", "church-initial": "section-place-of-worship-table",
        "fluid": "section-fluid-table", "random-events": "section-random-events-table",
        "special-events": "section-special-events-table", "random-event-kid": "section-special-events-table",
    }
    helpers: list[dict[str, Any]] = []
    entry_id = "fear-entry"
    exploration_id = "fear-exploration"
    missions_id = "fear-missions"
    helpers.append(section_node(entry_id, "section-overview-of-play", title_override="Alone Against Fear · 游戏概览"))
    helpers.append(section_node(exploration_id, "section-town-exploration-table", title_override="城镇探索"))
    missions_node = section_node(missions_id, "section-mission-table", title_override="任务表")
    mission_continuation = read_json(source_dir / "section-mission-table-continued.json")
    mission_continuation_zh = read_json(translation_dir / "section-mission-table-continued.json")
    if [p["id"] for p in mission_continuation["paragraphs"]] != [p["id"] for p in mission_continuation_zh["paragraphs"]]:
        raise ValueError("Mission continuation source and translation paragraphs do not align")
    missions_node["text"].extend(p["text"].strip() for p in mission_continuation["paragraphs"][1:])
    missions_node["reading"]["en"]["text"].extend(p["text"].strip() for p in mission_continuation["paragraphs"][1:])
    missions_node["reading"]["zh-CN"]["text"].extend(p["text"].strip() for p in mission_continuation_zh["paragraphs"][1:])
    helpers.append(missions_node)
    table_refs: dict[str, str] = {}
    for table_key, section_id in section_for_table.items():
        helper_id = "fear-table-" + table_key
        if section_id not in {node.get("sourceId") for node in helpers}:
            helpers.append(section_node(helper_id, section_id))
        else:
            helper_id = next(node["id"] for node in helpers if node.get("sourceId") == section_id)
        table_refs[table_key] = helper_id

    # The special-event D6 result is a separate fragment, so the player sees
    # only the resolved result rather than the unrevealed rows of the table.
    special_source = read_json(source_dir / "section-special-events-table.json")
    special_zh = read_json(translation_dir / "section-special-events-table.json")
    en_rows = [p["text"].strip() for p in special_source["paragraphs"][2:]]
    zh_rows = [p["text"].strip() for p in special_zh["paragraphs"][2:]]
    if len(en_rows) != 5 or len(zh_rows) != 5:
        raise ValueError("Special-events source rows changed; review the six printed outcomes before compiling")
    # The final printed paragraph contains both outcomes 5 and 6.
    en_rows[4:] = [part.strip() for part in en_rows[4].split("\n6 ", 1)]
    zh_rows[4:] = [part.strip() for part in zh_rows[4].split("\n6 ", 1)]
    if len(en_rows) != 6 or len(zh_rows) != 6:
        raise ValueError("Could not split the source's combined special-event 5/6 paragraph")
    special_refs: dict[str, str] = {}
    for index, (english, chinese) in enumerate(zip(en_rows, zh_rows), start=1):
        helper_id = f"fear-special-event-{index}"
        helpers.append({"id": helper_id, "title": f"特殊事件 {index}", "chapter": "特殊事件", "text": [english],
                        "reading": {"en": {"title": f"Special event {index}", "text": [english]}, "zh-CN": {"title": f"特殊事件 {index}", "text": [chinese]}},
                        "type": "fear", "sourceId": "section-special-events-table", "background": "/art/lighthouse.svg"})
        special_refs[str(index)] = helper_id

    death_node = section_node("fear-ending-dead", "section-character-death-or-insanity", title_override="角色死亡")
    insanity_node = section_node("fear-ending-insane", "section-character-death-or-insanity", title_override="角色陷入疯狂")
    win_node = section_node("fear-ending-won", "section-overview-of-play", title_override="七道地狱之门已关闭")
    death_node["ending"] = "dead"
    insanity_node["ending"] = "insane"
    win_node["ending"] = "won"
    helpers.extend([win_node, death_node, insanity_node])
    definition["sceneRefs"] = {"entry": entry_id, "exploration": exploration_id, "missions": missions_id,
                               "tables": table_refs, "specialEvents": special_refs,
                               "events": {str(n): str(n) for n in range(1, 43)},
                               "endings": {"won": "fear-ending-won", "dead": "fear-ending-dead", "insane": "fear-ending-insane"}}
    template["entry"] = entry_id
    existing_ids = {node["id"] for node in template.get("nodes", [])}
    template["nodes"].extend(node for node in helpers if node["id"] not in existing_ids)

    report = validate_definition(definition, template, source)
    candidate = dict(template)
    candidate["rulesVersion"] = "aaf-solo@1"
    candidate["fear"] = definition
    candidate.pop("runtimePlayable", None)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(candidate, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report.update({"sourcePdfSha256": EXPECTED_PDF_SHA, "candidate": str(output_path), "runtimePlayable": False})
    output_path.with_suffix(".build-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def verify(candidate_path: Path, source_path: Path) -> dict[str, Any]:
    source = read_json(source_path)
    candidate = read_json(candidate_path)
    definition = candidate.get("fear")
    if not isinstance(definition, dict):
        raise ValueError("candidate Story.fear is missing")
    report = validate_definition(definition, candidate, source)
    return {**report, "candidate": str(candidate_path), "runtimePlayable": bool(candidate.get("runtimePlayable", False))}


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    build_parser = subparsers.add_parser("build")
    build_parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    build_parser.add_argument("definition", type=Path)
    build_parser.add_argument("story_template", type=Path)
    build_parser.add_argument("output", type=Path)
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("candidate", type=Path)
    verify_parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    report = build(args.source, args.definition, args.story_template, args.output) if args.command == "build" else verify(args.candidate, args.source)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
