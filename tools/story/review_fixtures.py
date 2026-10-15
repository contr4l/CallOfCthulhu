"""Preserve the exact offline inputs needed by solo-story regression tests."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests/fixtures/story-review"
MANIFEST = FIXTURES / "manifest.json"
ARCHIVE = FIXTURES / "inputs.zip"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe_path(name):
    path = ROOT / name
    if not name.startswith("work/") or path.is_symlink() or not path.resolve().is_relative_to(ROOT / "work"):
        raise ValueError(f"Unsafe review input: {name}")
    return path


def capture(log, includes):
    paths = {json.loads(line) for line in Path(log).read_text().splitlines() if line.strip()}
    for name in includes:
        path = safe_path(name)
        paths.update(str(item.relative_to(ROOT)) for item in (path.rglob("*") if path.is_dir() else [path]) if item.is_file())
    FIXTURES.mkdir(parents=True, exist_ok=True)
    entries = []
    with zipfile.ZipFile(ARCHIVE, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name in sorted(paths):
            data = safe_path(name).read_bytes()
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
            entries.append({"path": name, "sha256": digest(data), "bytes": len(data)})
    MANIFEST.write_text(json.dumps({"format": "coc-review-inputs@1", "archiveSha256": digest(ARCHIVE.read_bytes()), "files": entries}, ensure_ascii=False, indent=2) + "\n")
    print(f"Captured {len(entries)} review inputs ({ARCHIVE.stat().st_size} compressed bytes)")


def restore():
    manifest = json.loads(MANIFEST.read_text())
    if digest(ARCHIVE.read_bytes()) != manifest["archiveSha256"]:
        raise ValueError("Review fixture archive SHA-256 mismatch")
    restored = 0
    with zipfile.ZipFile(ARCHIVE) as archive:
        if set(archive.namelist()) != {entry["path"] for entry in manifest["files"]}:
            raise ValueError("Review fixture archive inventory mismatch")
        for entry in manifest["files"]:
            path = safe_path(entry["path"])
            data = archive.read(entry["path"])
            if len(data) != entry["bytes"] or digest(data) != entry["sha256"]:
                raise ValueError(f"Review fixture SHA-256 mismatch: {entry['path']}")
            # Preserve local authoring work. Regression tests check their own
            # manifest/runtime bindings; restoring must never replace it.
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                restored += 1
    print(f"Review inputs verified: {len(manifest['files'])}; restored: {restored}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["capture", "restore"])
    parser.add_argument("--log")
    parser.add_argument("--include", action="append", default=[])
    args = parser.parse_args()
    if args.mode == "capture":
        if not args.log:
            parser.error("capture requires --log")
        capture(args.log, args.include)
    else:
        restore()
