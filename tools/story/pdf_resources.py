"""Verify hashed source references, including nested OCR and section resources."""
import hashlib
import json
import re
from pathlib import Path


def references(value):
    if isinstance(value, dict):
        if isinstance(value.get("path"), str) and "sha256" in value:
            yield value["path"], value["sha256"]
        for key, path in value.items():
            if key.endswith("Path") and isinstance(path, str):
                hash_key = key[:-4] + "Sha256"
                if hash_key in value:
                    yield path, value[hash_key]
            yield from references(path)
    elif isinstance(value, list):
        for item in value:
            yield from references(item)


def verify_resources(graph_path):
    graph_path = Path(graph_path)
    root = graph_path.parent.resolve()
    graph = json.loads(graph_path.read_text())
    checked = {}

    def verify(path, digest):
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid source resource SHA-256: " + path)
        if Path(path).is_absolute() or ".." in re.split(r"[/\\]", path):
            raise ValueError("Unsafe source resource path: " + path)
        resolved = (root / path).resolve()
        if not resolved.is_relative_to(root):
            raise ValueError("Source resource symlink escapes directory: " + path)
        if path in checked:
            if checked[path] != digest:
                raise ValueError("Conflicting hashes for source resource: " + path)
            return
        raw = resolved.read_bytes()
        if hashlib.sha256(raw).hexdigest() != digest:
            raise ValueError("Source resource integrity mismatch: " + path)
        checked[path] = digest
        if resolved.suffix.lower() == ".json":
            for nested_path, nested_digest in references(json.loads(raw)):
                verify(nested_path, nested_digest)

    for path, digest in references(graph):
        verify(path, digest)
    supplemental = json.loads((root / graph["supplements"]["path"]).read_text())
    for path, digest in references(supplemental):
        verify(path, digest)
    return {"hashedSourceResources": len(checked)}
