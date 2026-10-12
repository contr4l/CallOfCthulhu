"""Store reviewed rules separately from deduplicated, hashed scene JSON files."""
import copy
import hashlib
import json
import os
from pathlib import Path

FORMAT = "coc-runtime-graph@1"


def bytes_for(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    data = bytes_for(value)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)
    return hashlib.sha256(data).hexdigest()


def unpack(path):
    path = Path(path)
    story = json.loads(path.read_text())
    if story.get("format") == FORMAT:
        story.pop("format")
        for node in story["nodes"]:
            ref = node.pop("fragment")
            fragment_path = (path.parent / ref["path"]).resolve()
            if not fragment_path.is_relative_to(path.parent.resolve()):
                raise ValueError("片段路径越界")
            raw = fragment_path.read_bytes()
            if hashlib.sha256(raw).hexdigest() != ref["sha256"]:
                raise ValueError("片段校验和不匹配")
            body = json.loads(raw)
            if (body["storyId"], body["version"]) != (story["id"], story["version"]) or node["id"] not in body["nodeIds"]:
                raise ValueError("片段身份不匹配")
            node["text"] = body["text"]
            if "reading" in body:
                node["reading"] = {locale: {"title": value["title"], "text": body["text"] if value.get("textRef") == "default" else value["text"]}
                                   for locale, value in body["reading"].items()}
    reading_path = path.parent / "reading.json"
    if reading_path.exists():
        reading = json.loads(reading_path.read_text())
        if (reading["storyId"], reading["version"]) != (story["id"], story["version"]) or set(reading["nodes"]) != {n["id"] for n in story["nodes"]}:
            raise ValueError("正文语言包身份或节点集合不匹配")
        for node in story["nodes"]:
            node["reading"] = reading["nodes"][node["id"]]
    return story


def pack_story(story, output):
    output = Path(output)
    manifest = output / "story.json"
    previous = json.loads(manifest.read_text()) if manifest.exists() else None
    if previous is not None and unpack(manifest) != story:
        raise ValueError("已存在的内容版本不允许改写剧情或规则；请发布新版本")
    old_refs = [n["fragment"] for n in previous["nodes"]] if previous and previous.get("format") == FORMAT else []
    graph = copy.deepcopy(story)
    graph["format"] = FORMAT
    # Source IDs are shared by rule helpers: identical bodies are stored once.
    content = {}
    for node in graph["nodes"]:
        text = node.pop("text")
        body = {"text": text}
        reading = node.pop("reading", None)
        if reading:
            body["reading"] = {locale: {"title": value["title"], **(
                {"textRef": "default"} if value["text"] == text else {"text": value["text"]}
            )} for locale, value in reading.items()}
        content_key = hashlib.sha256(bytes_for(body)).hexdigest()
        if content_key not in content:
            content[content_key] = {"nodes": [], "body": body}
        content[content_key]["nodes"].append(node["id"])
        node["fragment"] = content[content_key]
    for value in content.values():
        body = {"format": "coc-scene-fragment@1", "storyId": story["id"], "version": story["version"], "nodeIds": value["nodes"], **value["body"]}
        value["path"] = "fragments/" + hashlib.sha256(bytes_for(body)).hexdigest() + ".json"
        digest = write(output / value["path"], body)
        value["sha256"] = digest
    for node in graph["nodes"]:
        value = node["fragment"]
        node["fragment"] = {"path": value["path"], "sha256": value["sha256"]}
    # Commit the manifest last, after all referenced fragments are present.
    write(output / "story.json", graph)
    reading_path = output / "reading.json"
    if reading_path.exists():
        reading_path.unlink()
    active = {node["fragment"]["path"] for node in graph["nodes"]}
    for ref in old_refs:
        path = (output / ref["path"]).resolve()
        if path.is_relative_to(output.resolve()) and ref["path"] not in active and path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == ref["sha256"]:
            path.unlink()
    return {"nodes": len(graph["nodes"]), "fragments": len(content), "graphBytes": (output / "story.json").stat().st_size}
