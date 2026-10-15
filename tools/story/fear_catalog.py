#!/usr/bin/env python3
"""Extract source-pinned mechanical catalog candidates for Alone Against Fear.

This is an offline source adapter: output stores compact stat tokens, not source
paragraph text. Review every parsed record against its referenced paragraph.
"""
from __future__ import annotations
import hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/Alone Against Fear (Andrea Sfiligoi) (z-library.sk, 1lib.sk, z-lib.sk).pdf"
EXPECTED = "6737a687a79c49ef36b0e13d98fa0536b5ab8724eb127312522126b46570a572"
BASE = ROOT / "scripts/alone-against-fear"
OUT = ROOT / "work/alone-against-fear/static-catalog-candidate.json"
DEFINITION = ROOT / "work/alone-against-fear/reviewed-definition.json"
REVIEW = ROOT / "work/alone-against-fear/static-catalog-review.json"
TABLES = {
    "beasts": "section-beasts-table", "demonic-horrors": "section-demonic-horrors-table",
    "ghosts": "section-ghosts-table", "possessed": "section-possessed-table",
    "undead": "section-undead-table", "unique-zombies": "section-unique-zombies-table",
    "unique-vampires": "section-unique-vampires-table", "slashers": "section-slashers-table",
    "witch-children": "section-witch-children-table", "aliens": "section-aliens-table",
    "lab-horrors": "section-lab-horrors-table", "living-dolls": "section-living-dolls-table",
}

def read(path: Path): return json.loads(path.read_text(encoding="utf-8"))
def sha(path: Path): return hashlib.sha256(path.read_bytes()).hexdigest()
def merge_reviewed_enemy_profile(reviewed: dict, source_profile: dict, inferred_tags: list[str]) -> dict:
    """Refresh source identity/stats while retaining audited runtime rules."""
    merged = {**reviewed, **{k: v for k, v in source_profile.items()
                            if k in ("label", "level", "life", "damage", "damageBasis")}}
    # Species tags are regenerated from the English row. Older catalog runs
    # wrote broad table-derived tags (for example every Undead result as a
    # zombie), so replace these managed tags instead of unioning stale values.
    managed = {"undead", "zombie", "vampire", "ghost", "skeleton", "flaming-skeleton",
               "alien", "mutant", "demon", "artificial", "animal", "humanoid"}
    retained = set(reviewed.get("tags", [])) - managed
    merged["tags"] = sorted(retained | set(inferred_tags))
    return merged


def species_tags(source_row: str) -> list[str]:
    """Classify a creature from its actual English source row, never table name."""
    text = re.sub(r"\s+", " ", source_row).lower()
    tags = set()
    if re.search(r"\bundead\b", text): tags.add("undead")
    if re.search(r"\bzombies?\b|\btwitchers?\b", text): tags.add("zombie")
    if re.search(r"\bvampire\b", text): tags.add("vampire")
    if re.search(r"\bghost\b|\bspirits?\b|\bphantom\b", text): tags.add("ghost")
    if re.search(r"\bskeletons?\b", text): tags.add("skeleton")
    if "flaming skeleton" in text: tags.add("flaming-skeleton")
    if re.search(r"\balien\b", text): tags.add("alien")
    if re.search(r"\bmutant\b|\bmutants\b", text): tags.add("mutant")
    if re.search(r"\bdemon(?:ic)?\b", text): tags.add("demon")
    if re.search(r"\bartificial\b|\brobot\b", text): tags.add("artificial")
    if re.search(r"\banimal\b|\bdog\b|\bbug\b|\bcrocodile\b", text): tags.add("animal")
    if re.search(r"\bhumanoid\b", text): tags.add("humanoid")
    return sorted(tags)
def pages(fragment):
    return sorted({int(n) for p in fragment["paragraphs"] for n in re.findall(r"pdf:spans:\[\[(\d+),", p["sourceLocation"])})
def split_rows(fragment):
    text = "".join(p["text"] for p in fragment["paragraphs"])
    # Printed rows begin with 1-6 at the left margin; inline descriptions continue
    # until the next such row. Keeping offsets lets us bind rows to paragraphs.
    marks = list(re.finditer(r"(?m)^\s*([1-6])(?!d\d)(?=\s*(?:[A-Z]|d\d|$))", text))
    rows = []
    for ix, mark in enumerate(marks):
        end = marks[ix + 1].start() if ix + 1 < len(marks) else len(text)
        body = text[mark.end():end].strip()
        ids = []
        offset = 0
        for p in fragment["paragraphs"]:
            pstart, pend = offset, offset + len(p["text"])
            if pend > mark.start() and pstart < end: ids.append(p["id"])
            offset = pend
        rows.append((int(mark.group(1)), body, ids))
    if [r[0] for r in rows] != [1,2,3,4,5,6]:
        raise ValueError(f"{fragment['id']}: expected six printed d6 rows, got {[r[0] for r in rows]}")
    return rows

def dice_count(text):
    m = re.match(r"\s*(\d*d\d+(?:[+-]\d+)?)\s+", text, re.I)
    if not m: return 1
    return m.group(1).upper()

def profile(text):
    level = re.search(r"\b(?:L|Level\s*)(\d+)\b", text, re.I)
    if not level: return None
    life = re.search(r"\bLife\s+(\d+)\b|\b(\d+)\s+Life(?:\s+each)?\b", text, re.I)
    if not life:
        life_special = "unlimited" if re.search(r"unlimited Life", text, re.I) else "none"
        life_value = life_special
    else: life_value = int(life.group(1) or life.group(2))
    damage = re.search(r"\bdamage\s+(\d+)\b|\b(\d+)\s+Damage\b", text, re.I)
    # A body may say that a weapon does no damage (for example Molotovs
    # against Flaming Skeletons) after giving the creature's own attack
    # damage. Prefer the explicit stat line wherever it appears.
    if damage: damage_value = int(damage.group(1) or damage.group(2))
    elif re.search(r"no damage", text, re.I): damage_value = 0
    else: damage_value = None
    # The level marker may follow either a comma or a period. Keep the display
    # label to the creature name before that marker; the full rule paragraph is
    # already retained in the hash-pinned source fragment.
    first = text[:level.start()].strip(" .,:\n")
    count = dice_count(first)
    name = re.sub(r"^\d+\s*", "", first).strip()
    name = re.sub(r"^(?:\d*d\d+(?:[+-]\d+)?\s+)", "", name, flags=re.I)
    return {"label": name or first, "level": int(level.group(1)), "life": life_value,
            "damage": damage_value, "count": count}

def translated_enemy_label(text):
    level = re.search(r"(?<![A-Za-z])L\s*\d+", text)
    if not level: return None
    label = text[:level.start()].strip(" .,：:\n")
    label = re.split(r"[：:]", label, maxsplit=1)[0]
    label = re.sub(r"^(?:\d*D\d+(?:[+-]\d+)?\s*(?:只|名)?|\d+\s*(?:只|名)?)\s*", "", label, flags=re.I)
    label = label.strip(" ：:.,。")
    return label or None

def split_translated_rows(fragment):
    text = "\n".join(p["text"] for p in fragment["paragraphs"])
    marks = list(re.finditer(r"(?m)^\s*([1-6])(?![Dd]\d)(?=\s*(?:[\u4e00-\u9fffA-Z]|\n|$))", text))
    rows = []
    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        rows.append((int(mark.group(1)), text[mark.end():end].strip()))
    return rows

def main():
    if not SOURCE.is_file() or sha(SOURCE) != EXPECTED: raise ValueError("Fear PDF missing or SHA mismatch")
    enemies, tables, provenance, unresolved = {}, {}, [], []
    source_rows = {}
    source_table_by_enemy = {}
    for table_id, section_id in TABLES.items():
        src = BASE / "fragments" / f"{section_id}.json"
        translation = BASE / "translations/zh-CN" / f"{section_id}.json"
        frag, trans = read(src), read(translation)
        if trans.get("sourceFragmentSha256") != sha(src): raise ValueError(f"translation source hash mismatch: {section_id}")
        if [p["id"] for p in frag["paragraphs"]] != [p["id"] for p in trans["paragraphs"]]: raise ValueError(f"paragraph mismatch: {section_id}")
        rows, entries = split_rows(frag), []
        translated_rows = dict(split_translated_rows(trans))
        for roll, text, ids in rows:
            token = f"{table_id}-{roll}"
            parsed = profile(text)
            if parsed:
                enemy_id = token
                source_rows[enemy_id] = text
                source_table_by_enemy[enemy_id] = table_id
                # The printed rows omit ordinary attack damage for these five
                # profiles. A user-authorized web adaptation supplies 1 HP;
                # keep this provenance explicit and out of the source prose.
                web_damage_adaptations = {
                    "demonic-horrors-2", "possessed-2", "possessed-3", "possessed-5", "possessed-6",
                }
                # Keep static source stats separate from special actions that need
                # bespoke engine support; no rule is inferred from omitted prose.
                enemy = {k:v for k,v in parsed.items() if k != "count"}
                enemy["label"] = translated_enemy_label(translated_rows.get(roll, "")) or enemy["label"]
                # This source-origin marker scopes Demon Slayer's printed
                # defense/save bonus to rows in this actual table, including
                # rows whose creature is not generically tagged demon.
                if table_id == "demonic-horrors": enemy["tags"] = ["demonic-horrors-table"]
                if enemy_id in web_damage_adaptations:
                    enemy["damage"] = 1
                    enemy["damageBasis"] = "user-authorized-web-adaptation"
                web_labels = {
                    "demonic-horrors-2": "魅魔／梦魔", "possessed-2": "附身娃娃",
                    "possessed-3": "附身物品", "possessed-5": "恶魔狗", "possessed-6": "附身者",
                }
                if enemy_id in web_labels: enemy["label"] = web_labels[enemy_id]
                enemy["source"] = {"fragment":f"alone-against-fear/fragments/{src.name}","sha256":sha(src),"translation":f"alone-against-fear/translations/zh-CN/{translation.name}","translationSha256":sha(translation),"paragraphIds":ids,"sourcePages":pages(frag),"sourcePdfSha256":EXPECTED}
                enemies[enemy_id] = enemy
                entries.append({"roll":roll,"result":enemy_id,"enemyId":enemy_id,"count":parsed["count"]})
                if (parsed["damage"] is None and enemy_id not in web_damage_adaptations) or parsed["life"] in ("none","unlimited"):
                    unresolved.append({"table":table_id,"roll":roll,"enemyId":enemy_id,"issue":"special profile has no ordinary finite damage/life; requires source-specific operation"})
            else:
                entries.append({"roll":roll,"result":token,"requiresReview":True})
                unresolved.append({"table":table_id,"roll":roll,"issue":"no ordinary L/life profile parsed; must implement source-specific non-combat rule"})
        tables[table_id] = {"die":"D6","entries":entries,"source":{"fragment":f"alone-against-fear/fragments/{src.name}","sha256":sha(src),"translation":f"alone-against-fear/translations/zh-CN/{translation.name}","translationSha256":sha(translation),"sourcePages":pages(frag),"paragraphIds":[p["id"] for p in frag["paragraphs"]],"sourcePdfSha256":EXPECTED}}
        provenance.append(tables[table_id]["source"])
    skills_src = BASE / "fragments/section-skills.json"
    skills_tr = BASE / "translations/zh-CN/section-skills.json"
    skills, strans = read(skills_src), read(skills_tr)
    if strans.get("sourceFragmentSha256") != sha(skills_src): raise ValueError("skills translation hash mismatch")
    skill_text = "".join(p["text"] for p in skills["paragraphs"])
    skill_rows = re.findall(r"(?:^|[\n.])\s*([A-Z][A-Za-z ]+?)\s*\((\d+)\s*[Xx][Pp]\)", skill_text)
    skill_specs = {
      "agile":{"label":"敏捷","xp":8,"modifiers":{"defense":[1,2],"agility-save":[1,2]}},
      "bow":{"label":"弓术","xp":3,"modifiers":{"attack-ranged":[1,2]},"startingWeapons":["bow"],"startingAmmo":{"bow":"D6+3"}},
      "charisma":{"label":"魅力","xp":3,"modifiers":{"charisma":[1,2]}},
      "danger-sense":{"label":"危险感知","xp":4,"modifiers":{"surprise-reduction":[1,2]}},
      "dodge":{"label":"闪避","xp":4,"modifiers":{"defense":[1,2]}},
      "faith":{"label":"信仰","xp":2,"modifiers":{"faith-exorcism":[0,1]},"startingItems":["holy-symbol"]},
      "fighter":{"label":"斗士","xp":6,"modifiers":{"attack-melee":[1,2]}},
      "good-shot":{"label":"神枪手","xp":8,"modifiers":{"attack-ranged":[1,2]}},
      "investigator":{"label":"调查员","xp":6,"modifiers":{"search":[1,2]},"clueDiscount":[1,2]},
      "medic":{"label":"医护","xp":3,"modifiers":{}},
      "occultist":{"label":"神秘学者","xp":4,"modifiers":{"magic-save":[1,2]}},
      "resilient":{"label":"耐受","xp":3,"modifiers":{"poison-save":[1,2],"infection-save":[1,2],"disease-save":[1,2]}},
      "resistant-to-hunger":{"label":"耐饥","xp":2,"modifiers":{},"foodEveryBoxes":[6,7]},
      "strong-grip-on-reality":{"label":"现实锚定","xp":6,"modifiers":{},"maxSanityChange":[1,2]},
      "slippery":{"label":"滑溜","xp":3,"modifiers":{"escape":[1,2]}},
      "stealth":{"label":"潜行","xp":4,"modifiers":{"stealth-save":[1,2]}},
      "strong":{"label":"强壮","xp":5,"modifiers":{"strength-save":[1,2]},"capacityBonus":[3,5]},
      "tough":{"label":"坚韧","xp":8,"modifiers":{},"maxHpChange":[2,3]},
      "vampire-hunter":{"label":"吸血鬼猎人","xp":3,"modifiers":{"attack-vampire":[1,2]}},
      "will":{"label":"意志","xp":6,"modifiers":{"will-save":[1,2],"fear-save":[1,2],"magic-save":[1,2],"psionic-save":[1,2]}},
      "zombie-hunter":{"label":"僵尸猎人","xp":2,"modifiers":{"attack-zombie":[1,2]}},
    }
    # Parse the separately listed Arcane Skills (not available at character creation).
    arc_src=BASE/"fragments/section-arcane-skills.json"; arc_tr=BASE/"translations/zh-CN/section-arcane-skills.json"
    arc, arc_t=read(arc_src),read(arc_tr)
    if arc_t.get("sourceFragmentSha256")!=sha(arc_src): raise ValueError("Arcane Skills translation hash mismatch")
    arc_text="".join(p["text"] for p in arc["paragraphs"])
    arc_rows=re.findall(r"(?m)^([A-Z][A-Za-z ]+?)\s*\((\d+)\s*[Xx][Pp]\)",arc_text)
    arcane_modifiers={"alien fighter":{"attack-alien":[1,2],"defense-alien":[1,2]},"demon slayer":{"defense-demon":[1,2],"demon-save":[1,2]},"mutant hunter":{"attack-mutant":[1,2],"defense-mutant":[1,2]}}
    arcane_labels={"alien fighter":"外星战士","curse":"诅咒","demon slayer":"恶魔杀手","energy of the macrocosmos":"宏观宇宙之力","exorcism":"驱魔","foretell":"预言","gate":"门","healing":"治疗","mutant hunter":"变种猎人","pentagram":"五芒星","summon servitor":"召唤使魔"}
    arcane_specs={re.sub(r"[^a-z0-9]+","-",name.lower()).strip("-"):{"label":arcane_labels.get(name.lower(),name),"xp":int(xp),"kind":"arcane","modifiers":arcane_modifiers.get(name.lower(),{})} for name,xp in arc_rows}
    weapon_src=BASE/"fragments/section-weapon-summary-table.json"; weapon_tr=BASE/"translations/zh-CN/section-weapon-summary-table.json"
    weapon_fragment,weapon_translation=read(weapon_src),read(weapon_tr)
    if weapon_translation.get("sourceFragmentSha256")!=sha(weapon_src): raise ValueError("weapon summary translation hash mismatch")
    weapon_pin={"fragment":f"alone-against-fear/fragments/{weapon_src.name}","sha256":sha(weapon_src),"translation":f"alone-against-fear/translations/zh-CN/{weapon_tr.name}","translationSha256":sha(weapon_tr),"sourcePages":pages(weapon_fragment),"paragraphIds":[p["id"] for p in weapon_fragment["paragraphs"]]}
    def section_pin(section_id):
        source=BASE/"fragments"/f"{section_id}.json"; translated=BASE/"translations/zh-CN"/f"{section_id}.json"
        src,tr=read(source),read(translated)
        if tr.get("sourceFragmentSha256")!=sha(source): raise ValueError(f"translation source hash mismatch: {section_id}")
        if [p["id"] for p in src["paragraphs"]] != [p["id"] for p in tr["paragraphs"]]: raise ValueError(f"paragraph mismatch: {section_id}")
        return {"fragment":f"alone-against-fear/fragments/{source.name}","sha256":sha(source),"translation":f"alone-against-fear/translations/zh-CN/{translated.name}","translationSha256":sha(translated),"sourcePages":pages(src),"paragraphIds":[p["id"] for p in src["paragraphs"]]}
    carry_pins=[section_pin("section-equipment"),section_pin("section-food")]
    weapons={
      "unarmed":{"label":"徒手攻击","damage":1,"modifier":-2,"tags":["unarmed"]},
      "antique-flail":{"label":"古董连枷","damage":1,"tags":["two-handed","flail-special"]},
      "axe":{"label":"斧","damage":2,"tags":["two-handed"]},
      "baseball-bat":{"label":"棒球棒","damage":1,"tags":["bonus-vs-zombies-and-flaming-skeletons"]},
      "hammer":{"label":"锤子","damage":1,"tags":["bonus-vs-zombies-and-flaming-skeletons"]},
      "bow":{"label":"弓","damage":1,"modifier":-1,"tags":["two-handed","ranged"],"ammoType":"arrows","ammoPerAttack":1},
      "chainsaw":{"label":"电锯","damage":2,"modifier":1,"tags":["two-handed","chainsaw-noise"]},
      "chair":{"label":"椅子","damage":1,"modifier":-1,"tags":["two-handed","breaks-on-attack-1-or-2"]},
      "crossbow":{"label":"弩","damage":1,"tags":["two-handed","ranged"],"ammoType":"bolts","ammoPerAttack":1},
      "flashlight":{"label":"手电筒","damage":1,"modifier":2,"tags":["ranged","shadow-only"]},
      "grenade":{"label":"手榴弹","damage":4,"tags":["one-use","one-turn","divided-damage"]},
      "hockey-stick":{"label":"曲棍球杆／高尔夫球杆","damage":1,"tags":["two-handed","damage-2-on-natural-6"]},
      "kitchen-knife":{"label":"厨房刀／仪式匕首","damage":1,"modifier":-1,"tags":["breaks-on-attack-1"]},
      "knife":{"label":"刀或木棍","damage":1,"modifier":-1},
      "silver-knife":{"label":"银刀","damage":1,"modifier":-1,"tags":["silver"]},
      "molotov-cocktail":{"label":"燃烧瓶","damage":1,"tags":["one-use","requires-lighter-or-matches","zombie-kill","fire","ranged"]},
      "nunchaku":{"label":"双节棍","damage":1,"modifier":-1,"tags":["martial-arts-modifier","disarm-on-defense-6"]},
      "pistol":{"label":"手枪","damage":1,"modifier":1,"tags":["ranged"],"ammoType":"bullets","ammoPerAttack":1},
      "pitchfork":{"label":"干草叉","damage":1,"tags":["two-handed","impale-on-condition"]},
      "rifle":{"label":"步枪","damage":2,"modifier":2,"tags":["two-handed","ranged","club-mode"],"ammoType":"bullets","ammoPerAttack":1,"attacks":1},
      "scythe-shovel":{"label":"镰刀／铲子","damage":1,"modifier":-1,"tags":["two-handed","decapitate-on-natural-6"]},
      "shotgun":{"label":"霰弹枪","damage":2,"modifier":2,"tags":["ranged"],"ammoType":"shells","ammoPerAttack":1},
      "katana":{"label":"武士刀（随机装备表称katana）","damage":1,"modifier":1,"tags":["two-handed","hand-mode-optional"]},
      "cheap-samurai-sword":{"label":"廉价仿制武士刀","damage":1,"modifier":1,"tags":["two-handed","hand-mode-optional","breaks-on-attack-1"]},
      "ghost-blade":{"label":"幽灵之刃","damage":2,"modifier":1,"tags":["magic","melee","damage-1-vs-other-targets"]},
      "cursed-blade":{"label":"诅咒之刃","damage":1,"modifier":1,"tags":["melee","cursed","cannot-discard","blocks-ranged-unless-held"]},
    }
    def numeric_pin(number):
        source=ROOT/"scripts/alone-against-fear/fragments"/f"{number}.json"
        translated=ROOT/"scripts/alone-against-fear/translations/zh-CN"/f"{number}.json"
        src,tr=read(source),read(translated)
        if tr.get("sourceFragmentSha256")!=sha(source): raise ValueError(f"event translation hash mismatch: {number}")
        if [x["id"] for x in src["paragraphs"]] != [x["id"] for x in tr["paragraphs"]]: raise ValueError(f"event paragraph mismatch: {number}")
        return {"fragment":f"alone-against-fear/fragments/{source.name}","sha256":sha(source),"translation":f"alone-against-fear/translations/zh-CN/{translated.name}","translationSha256":sha(translated),"sourcePages":pages(src),"paragraphIds":[x["id"] for x in src["paragraphs"]],"sourcePdfSha256":EXPECTED}
    magic_pin=section_pin("section-random-magic-item-table")
    mission_witch_pin=section_pin("section-mission-table-continued")
    character_creation_pin=section_pin("section-your-character")
    useful_stuff_pin=section_pin("section-useful-stuff-table")
    weapon_rules_pin=section_pin("section-weapon-rules")
    weapon_summary_review_pin={**weapon_pin,"paragraphIds":["section-weapon-summary-table:p1"]}
    character_creation_pin["paragraphIds"]=["section-your-character:p5"]
    character_creation_pin["ruleParagraphIds"]=["section-your-character:p5"]
    additional_weapon_sources=[
      {"weaponId":"ghost-blade","source":{**magic_pin,"paragraphIds":["section-random-magic-item-table:p1"]}},
      {"weaponId":"cursed-blade","sources":[
        {**numeric_pin("018"),"paragraphIds":["18:p1"]},
        {**numeric_pin("025"),"paragraphIds":["25:p0","25:p1"]},
      ]},
    ]
    arcane_learning_rules = {
      "alien-fighter":["section-arcane-skills:p1"], "curse":["section-arcane-skills:p1","section-arcane-skills:p2","section-arcane-skills:p3"],
      "demon-slayer":["section-arcane-skills:p3"], "energy-of-the-macrocosmos":["section-arcane-skills:p3","section-arcane-skills:p4","section-arcane-skills:p5"],
      "exorcism":["section-arcane-skills:p5","section-arcane-skills:p6","section-arcane-skills:p7","section-arcane-skills:p8","section-arcane-skills:p9","section-arcane-skills:p10","section-arcane-skills:p11"],
      "foretell":["section-arcane-skills:p11","section-arcane-skills:p12","section-arcane-skills:p13"],
      "gate":[f"section-arcane-skills:p{i}" for i in range(13,19)], "healing":["section-arcane-skills:p18"],
      "mutant-hunter":["section-arcane-skills:p18"], "pentagram":[f"section-arcane-skills:p{i}" for i in range(18,22)],
      "summon-servitor":[f"section-arcane-skills:p{i}" for i in range(21,25)],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    out = {"format":"fear-static-catalog@1","sourcePdfSha256":EXPECTED,"reviewStatus":"static-values-extracted-special-effects-pending",
           "enemies":enemies,"tables":tables,"skills":{"source":{"fragment":f"alone-against-fear/fragments/{skills_src.name}","sha256":sha(skills_src),"translation":f"alone-against-fear/translations/zh-CN/{skills_tr.name}","translationSha256":sha(skills_tr),"sourcePages":pages(skills),"paragraphIds":[p["id"] for p in skills["paragraphs"]]},"namesAndXp":[{"name":name.strip(),"xp":int(xp)} for name,xp in skill_rows]},
           "skillDefinitions":{**skill_specs,**arcane_specs},"arcaneSkills":{"source":{"fragment":f"alone-against-fear/fragments/{arc_src.name}","sha256":sha(arc_src),"translation":f"alone-against-fear/translations/zh-CN/{arc_tr.name}","translationSha256":sha(arc_tr),"sourcePages":pages(arc),"paragraphIds":[p["id"] for p in arc["paragraphs"]]},"namesAndXp":[{"name":name.strip(),"xp":int(xp)} for name,xp in arc_rows]},
           "weapons":weapons,"weaponSource":weapon_pin,"carryRuleSources":carry_pins,"provenance":provenance,"unresolved":unresolved}
    OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    # Promote only the source-pinned numeric data into the reviewed runtime
    # candidate. Special creatures remain explicitly listed as open mechanics.
    definition=read(DEFINITION)
    definition["skills"]={**definition.get("skills",{}),**skill_specs,**arcane_specs}
    definition["weapons"]={**definition.get("weapons",{}),**weapons}
    definition["arcaneLearning"]={
      "alien-fighter":{"sources":[{"itemId":"they-are-among-us"}],"timeBoxes":"D3","expert":True},
      "curse":{"sources":[{"itemId":"necronomicon"},{"itemId":"diabolical-deal"}],"timeBoxes":"D3","expert":False},
      "demon-slayer":{"timeBoxes":0,"expert":True,"sourceCondition":"not-printed"},
      "energy-of-the-macrocosmos":{"sources":[{"itemId":"necronomicon","requiredSkill":"occultist","requiredSkillLevel":1},{"itemId":"occult-guide","requiredSkill":"occultist","requiredSkillLevel":1}],"timeBoxes":"D3","expert":False},
      "exorcism":{"sources":[{"itemId":"holy-book"},{"itemId":"occult-guide"},{"itemId":"diabolical-deal"}],"timeBoxes":"D3","expert":True},
      "foretell":{"sources":[{"itemId":"necronomicon"},{"itemId":"occult-guide"}],"timeBoxes":"D3","expert":False},
      "gate":{"sources":[{"itemId":"necronomicon"},{"itemId":"holy-book"},{"itemId":"occult-guide","requiredSkill":"occultist","requiredSkillLevel":2},{"itemId":"diabolical-deal","sanityLoss":"temporary"}],"gateAtLocation":{"clues":5,"requiredSkill":"occultist","timeBoxes":0},"timeBoxes":"D3","expert":False},
      "healing":{"sources":[{"itemId":"holy-book"}],"timeBoxes":"D3","expert":False},
      "mutant-hunter":{"sources":[{"itemId":"computer-printout"}],"timeBoxes":0,"expert":True},
      "pentagram":{"sources":[{"itemId":"diabolical-deal"},{"itemId":"necronomicon"},{"itemId":"occult-guide"}],"timeBoxes":"D3","expert":False},
      "summon-servitor":{"sources":[{"itemId":"necronomicon","sanityLoss":"permanent"},{"itemId":"occult-guide","requiredSkill":"occultist","requiredSkillLevel":2},{"itemId":"diabolical-deal","requiredSkill":"occultist","requiredSkillLevel":1}],"timeBoxes":"D3","expert":False},
    }
    definition.setdefault("items",{}).setdefault("holy-symbol",{"label":"圣徽"})
    # Keep every book result in the random-book table identifiable as a book
    # for duplicate-per-game and opening-read rules. Labels stay in the data
    # catalog; this derives only the semantic tag from the source table rows.
    for entry in definition.get("tables",{}).get("random-books",{}).get("entries",[]):
        for operation in entry.get("operations",[]):
            item_id=operation.get("itemId") if operation.get("op")=="item" else None
            if item_id:
                item=definition.setdefault("items",{}).setdefault(item_id,{"label":item_id.replace("-"," ")})
                item["tags"]=sorted(set(item.get("tags",[]))|{"book"})
    # Useful Stuff result 53 is a weapon, not a carried object. It uses the
    # existing kitchen-knife profile whose summary also names it a ritual
    # dagger; treating it as `item` silently made it unusable in combat.
    for entry in definition.get("tables",{}).get("useful-stuff",{}).get("entries",[]):
        if entry.get("roll") == 53 and entry.get("result") == "kitchen-knife":
            entry["operations"] = [{"op":"weapon","weaponId":"kitchen-knife"}]
    for enemy_id, enemy in enemies.items():
        if isinstance(enemy["life"],int) and isinstance(enemy["damage"],int):
            tags=species_tags(source_rows[enemy_id])
            if source_table_by_enemy.get(enemy_id) == "demonic-horrors": tags.append("demonic-horrors-table")
            # Catalog extraction owns source-derived identity and baseline
            # combat numbers only. Preserve reviewed Fear-specific runtime
            # mechanics (surprise, armor, escape bait, damage adaptations,
            # immunities, and special rules) across idempotent rebuilds.
            profiles=definition.setdefault("enemies",{})
            profiles[enemy_id]=merge_reviewed_enemy_profile(profiles.get(enemy_id,{}),enemy,tags)
    # Mission 5 defines five individual witches rather than selecting an
    # encounter from one of the creature tables. Keep one reusable combat
    # profile; FearState persists each witch's map-box identity separately.
    # L4/Human/4 Life are explicit in the Mission 5 paragraph. Damage 1 uses
    # the book's general enemy-hit rule (not a value printed in that row).
    definition.setdefault("enemies",{})["coven-witch"] = {
        **definition.setdefault("enemies",{}).get("coven-witch",{}),
        "label":"集会女巫", "level":4, "life":4, "damage":1, "damageBasis":"source",
        "tags":["human","witch"],
    }
    DEFINITION.write_text(json.dumps(definition,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    REVIEW.write_text(json.dumps({"format":"fear-static-catalog-review@1","sourcePdfSha256":EXPECTED,
      "reviewStatus":out["reviewStatus"],"skillSource":out["skills"]["source"],"arcaneSkillSource":out["arcaneSkills"]["source"],
      "weaponSource":weapon_pin,"carryRuleSources":carry_pins,
      "carryRuleNormalization":{"itemCapacity":"10 + 5 with Backpack + Strong bonus 3/5; Backpack is excluded from carried-object count","foodCapacity":"base 10 or 15 with Backpack, plus each unused item slot; only Food above base occupies one item slot","basis":"web-adaptation resolving the separate Food count and 1 Food-for-1-item-space tradeoff stated in the source"},
      "timeBoxNormalization":{"elapsedTimeBoxes":"separate elapsed-time counter; D3 book study does not move the map, mark boxes visited, trigger encounter, or count toward effects conditioned on crossing a box","sourceRefs":["section-arcane-skills:p1","section-movement-and-mapping:p1","section-food:p1"],"decision":"source-minimal web interpretation; movement/food triggers remain tied to map crossings"},
      "arcaneLearningRules":{"source":out["arcaneSkills"]["source"],"ruleParagraphIds":arcane_learning_rules},
      "servitorComponentReview":{"authorizedBy":"user","authorizedDate":"2026-10-14","adaptation":"The existing kitchen-knife weapon profile also fulfills the Ritual Dagger component; the weapon's combat values and break rule are unchanged, and the component is not consumed.","weaponId":"kitchen-knife","component":"ritual dagger","sourcePins":[{**useful_stuff_pin,"paragraphIds":["section-useful-stuff-table:p11"]},{**weapon_summary_review_pin,"paragraphIds":["section-weapon-summary-table:p1"]},{**weapon_rules_pin,"paragraphIds":["section-weapon-rules:p1"]},{**out["arcaneSkills"]["source"],"paragraphIds":["section-arcane-skills:p21","section-arcane-skills:p24"]}]},
      "characterCreationSource":character_creation_pin,
      "missionEnemyProfiles":[{"enemyId":"coven-witch","label":"集会女巫","level":4,"life":4,"damage":1,"damageBasis":"general-enemy-hit-rule","tags":["human","witch"],"sourcePin":{**mission_witch_pin,"paragraphIds":["section-mission-table-continued:p2"]},"damageBasisPin":{"rule":"general enemy hit inflicts 1 damage","sourceParagraphIds":["section-combat:p1"]}}],
      "enemyTables":out["provenance"],"additionalWeaponSources":additional_weapon_sources,"unresolved":out["unresolved"]},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"{len(enemies)} enemy profiles, {len(tables)} tables, {len(skill_rows)} skill names; {len(unresolved)} special outcomes require rule review")
if __name__ == "__main__": main()
