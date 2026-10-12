"""Lossless extraction of explicitly numbered $t1 TXT stories into graph@2.
Offsets refer to Unicode characters in the unmodified UTF-8 source, including CRLF.
"""
import hashlib
import json
import re
from pathlib import Path


def dump(path, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def extract(source, output, story_id, title, entry, last_section):
    source, output = Path(source), Path(output)
    data = source.read_bytes()
    text = data.decode("utf-8")
    nodes, edges, spans, issues = [], [], [], []
    for match in re.finditer(r"\$t1 == '(\d+)'\?\s*`([\s\S]*?)`", text):
        key = match[1]
        if int(key) > last_section:
            continue
        start, end = match.start(), match.end(2)
        paragraphs = [{"id": key + ":p0", "kind": "heading",
                       "text": text[start:match.start(2)],
                       "sourceLocation": f"txt:chars:{start}:{match.start(2)}"}]
        cursor = match.start(2)
        for line in match[2].splitlines(keepends=True):
            pid = f"{key}:p{len(paragraphs)}"
            paragraphs.append({"id": pid, "kind": "body", "text": line,
                               "sourceLocation": f"txt:chars:{cursor}:{cursor + len(line)}"})
            for target in re.finditer(r"(?:转到|回到)\s*(\d+)", line):
                edges.append({"id": f"e{len(edges)}", "source": key, "target": target[1],
                              "paragraphId": pid, "evidence": "printed-prose-number",
                              "textOffset": target.start()})
            if re.search(r"回到你(?:之前|失去理智)的条目", line):
                issues.append({"kind": "dynamic-return-requires-reviewed-rule", "paragraphId": pid})
            cursor += len(line)
        terminal = any(re.fullmatch(r"结局[。.]?", p["text"].strip()) for p in paragraphs)
        fragment = output.parent / story_id / "fragments" / f"{int(key):03d}.json"
        digest = dump(fragment, {"id": key, "document": source.name, "paragraphs": paragraphs})
        nodes.append({"id": key, "fragment": {"path": fragment.relative_to(output.parent).as_posix(), "sha256": digest}, "terminal": terminal})
        spans.append((start, end))
    ids = [node["id"] for node in nodes]
    if len(ids) != len(set(ids)) or str(entry) not in ids or set(ids) != {str(i) for i in range(min(map(int, ids)), last_section + 1)}:
        raise ValueError("编号缺失、重复或入口不存在；必须审校编号范围")
    if any(edge["target"] not in ids for edge in edges):
        raise ValueError("原文含悬空跳转，需要审校，不能自动修补")
    # Keep every byte outside story bodies: preface, wrappers, role sheets, footer.
    cursor, entries = 0, []
    for start, end in spans + [(len(text), len(text))]:
        if cursor < start:
            entries.append({"kind": "p", "section": "outside-numbered-story",
                            "sourceLocation": f"txt:chars:{cursor}:{start}", "text": text[cursor:start]})
        cursor = end
    supplements = output.parent / story_id / "fragments/supplements.json"
    digest = dump(supplements, {"documents": [{"document": source.name, "entries": entries}]})
    graph = {"format": "coc-story-graph@2", "id": story_id, "title": title, "language": "zh-CN",
             "entry": str(entry), "runtimePlayable": False,
             "source": {"filename": source.name, "sha256": hashlib.sha256(data).hexdigest(), "size": len(data)},
             "supplements": {"path": supplements.relative_to(output.parent).as_posix(), "sha256": digest},
             "nodes": nodes, "edges": edges, "issues": issues}
    dump(output, graph)
    verify(source, output)
    return graph


def verify(source, graph_path):
    source, graph_path = Path(source), Path(graph_path)
    graph = json.loads(graph_path.read_text())
    data = source.read_bytes()
    if hashlib.sha256(data).hexdigest() != graph["source"]["sha256"]:
        raise ValueError("原件校验和不匹配")
    pieces = []
    for ref in [node["fragment"] for node in graph["nodes"]] + [graph["supplements"]]:
        path = (graph_path.parent / ref["path"]).resolve()
        if not path.is_relative_to(graph_path.parent.resolve()):
            raise ValueError("片段路径越界")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != ref["sha256"]:
            raise ValueError("片段校验和不匹配")
        fragment = json.loads(raw)
        rows = fragment.get("paragraphs")
        if rows is None:
            rows = [e for doc in fragment["documents"] for e in doc["entries"]]
        for row in rows:
            _, _, start, end = row["sourceLocation"].split(":")
            pieces.append((int(start), int(end), row["text"]))
    cursor, recovered = 0, []
    for start, end, value in sorted(pieces):
        if start != cursor or len(value) != end - start:
            raise ValueError("原文片段缺失、重复或位置错误")
        recovered.append(value)
        cursor = end
    if "".join(recovered).encode("utf-8") != data:
        raise ValueError("完整原文逐字恢复失败")
    return {"nodes": len(graph["nodes"]), "edges": len(graph["edges"]), "lossless": True}
