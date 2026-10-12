"""Publish Static's web presentation using the already reviewed 1.0.0 rules.
Keep the original TXT and published 1.0.0 package untouched.
"""
import copy
import hashlib
import json
import re
from pathlib import Path
from pack import pack_story
from txt_graph import extract

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "scripts/静躁独行.txt"
ENDINGS = {
    "134": "最后的反抗", "150": "别无他物", "171": "雪花中的笑声",
    "278": "永恒的安详", "284": "归入永眠", "316": "回到祂的家",
    "318": "与祂融为一体", "324": "孤身倒在密林", "334": "化作雪花",
    "354": "重生以侍奉", "356": "失望的目光", "359": "伴侣的面孔",
    "365": "生活继续", "367": "独自生还",
}


def narrative(lines):
    paragraphs = []
    for line in lines:
        line = line.strip().strip("*").strip()
        line = re.sub(r"，下一次检定获得一枚奖励骰。$", "。", line)
        line = re.sub(r"从现在开始，你进行的[^。]+惩罚骰。", "", line)
        # These instructions already exist in the rule program. Preserve all
        # original text in SOURCE; omit only paper operations from the reader.
        if not line or re.search(
            r"(?:转到|回到)\s*\d+|进行一次.*检定|记录表|勾选|"
            r"^取出你的调查员角色卡|^(?:受到|失去|恢复|记录你|记录当前条目)|"
            r"^(?:你可能会多次|根据你的选择)|^如果(?:检定|孤注)|"
            r"^如果你的生命值有损失|^回到你(?:之前|失去理智)的条目|^结局[。.]?$",
            line,
        ):
            continue
        if paragraphs and not re.search(r"[。！？…：；”」』）)]$", paragraphs[-1]):
            paragraphs[-1] += line
        else:
            paragraphs.append(line)
    return paragraphs


def main():
    folder = ROOT / "stories/alone-against-static"
    old = json.loads((folder / "1.0.0/story.json").read_text())
    source_text = SOURCE.read_text()
    raw = {key: text.strip().splitlines() for key, text in re.findall(
        r"\$t1 == '(\d+)'\?\s*`([\s\S]*?)`", source_text,
    ) if int(key) < 372}
    assert set(raw) == {str(i) for i in range(372)}
    story = copy.deepcopy(old)
    story.update(version="1.1.0", subtitle="中文完整版 · 双角色独行",
                 description="在黑山峰的林间小屋度过周末。选择亚历克斯或查理，调查录像带中的异样，寻找生还之路。")
    for node in story["nodes"]:
        node["text"] = narrative(raw[node["sourceId"]])
        if node["id"] in ENDINGS:
            name = ENDINGS[node["id"]]
            node["title"] = "静躁独行 · " + name
            for step in node["program"]:
                if step["kind"] == "end": step["label"] = name
    assert {n["id"] for n in story["nodes"] if any(
        s["kind"] == "end" for s in n["program"]
    )} == set(ENDINGS)
    story["source"]["notes"] += [
        "1.1.0沿用已审校的1.0.0规则、节点与角色；中文正文从同一TXT恢复，合并排版断行并剥离纸面指令。",
        "14个结局的中文显示名为网页适配命名，按原条目保留独立收藏身份，不是原书官方标题。",
    ]
    target = folder / story["version"]
    target.mkdir(parents=True, exist_ok=True)
    by_id = {n["id"]: n for n in story["nodes"]}
    for version in ("1.0.0",):
        payload = {
            "storyId": story["id"], "version": version,
            "sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
            "nodes": {key: {"zh-CN": {"title": n["title"], "text": n["text"]}}
                      for key, n in by_id.items()},
        }
        (folder / version / "reading.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    for node in story["nodes"]:
        node["reading"] = {"zh-CN": {"title": node["title"], "text": node["text"]}}
    pack_story(story, target)
    fixed = copy.deepcopy(story)
    fixed["version"] = "1.2.0"
    for node in fixed["nodes"]:
        for step in node["program"]:
            for option in step.get("choices", []):
                if (node["id"], option["id"]) in [("57", "to-78"), ("66", "to-57")]:
                    option.pop("once", None)
    fixed["source"]["notes"].append(
        "1.2.0适配解释：57与66的尚未选择限制仅约束调查选项，离开棚屋／箱子的原有出口可重复使用。"
        "原文允许76→75→66等回访；此前将退出也记为一次性，会在合法回访后无路可走。目标编号不变，调查仍不可重复。"
    )
    pack_story(fixed, folder / fixed["version"])
    extract(SOURCE, ROOT / "scripts/静躁独行.dag.json", story["id"], story["title"], 0, 371)
    print("Static 1.1.0/1.2.0:", len(story["nodes"]), "nodes,", len(ENDINGS), "endings")


if __name__ == "__main__":
    main()
