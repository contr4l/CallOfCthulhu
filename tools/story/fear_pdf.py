"""Source-preserving PDF adapter for Alone Against Fear.

This is intentionally separate from the Tide adapter: Fear is a Four Against
Darkness-derived d6 game, and its page and table layout differs substantially.
The text-layer reconstruction claim is limited to pypdf's canonical text.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[2]
PDF = ROOT / "scripts/Alone Against Fear (Andrea Sfiligoi) (z-library.sk, 1lib.sk, z-lib.sk).pdf"
OUT = ROOT / "scripts/alone-against-fear"
GRAPH = ROOT / "scripts/恐惧独行.dag.json"
WORK = ROOT / "work/alone-against-fear"
TITLE_RE = re.compile(r"^\s*#\s*(\d+)\s*[-–—:.]\s*(.*?)\s*$")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: object) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
    path.write_bytes(raw)
    return sha(raw)


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().casefold()


def toc_match(line: str, toc: dict[str, str]) -> str | None:
    value = norm(line)
    if len(value) > 100:
        return None
    # The printed table headings often add a die code or the word "table" to
    # the shorter TOC label (for example "Random Encounter table (d6, then d6)").
    value_base = re.sub(r"\s*\([^)]*\)\s*", " ", value).strip()
    for label, node_id in sorted(toc.items(), key=lambda item: len(item[0]), reverse=True):
        label_base = re.sub(r"\s*\([^)]*\)\s*", " ", label).strip()
        if value_base in {label_base, label_base + " table"} or value_base.startswith(label_base + " table "):
            return node_id
    return None


def toc_titles(reader: PdfReader) -> dict[str, str]:
    """Return normalized TOC labels -> stable source IDs from printed contents."""
    rows: dict[str, str] = {}
    for page_no in (3, 4):
        for line in (reader.pages[page_no - 1].extract_text() or "").splitlines():
            m = re.match(r"^\s*(.*?)\s+(\d{1,3})\s*$", line)
            if not m:
                continue
            label = m.group(1).strip()
            if label and label.casefold() not in {"table of contents", "contents"}:
                key = norm(label)
                rows.setdefault(key, "section-" + re.sub(r"[^a-z0-9]+", "-", key).strip("-")[:60])
    return rows


def render_ocr(pdf: Path, page_no: int, destination: Path, tmp: Path) -> dict:
    prefix = tmp / f"fear-{page_no:03d}"
    subprocess.run(["pdftoppm", "-f", str(page_no), "-l", str(page_no), "-singlefile", "-scale-to", "1800", "-png", str(pdf), str(prefix)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    image = Path(str(prefix) + ".png")
    text = subprocess.run(["tesseract", str(image), "stdout", "-l", "eng"], check=True, capture_output=True, text=True).stdout
    tsv = subprocess.run(["tesseract", str(image), "stdout", "-l", "eng", "tsv"], check=True, capture_output=True, text=True).stdout
    words = []
    for line in tsv.splitlines()[1:]:
        fields = line.split("\t")
        if len(fields) == 12 and fields[-1].strip():
            try:
                confidence = float(fields[10])
            except ValueError:
                confidence = -1
            words.append({"text": fields[11], "confidence": confidence,
                          "bbox": [int(fields[6]), int(fields[7]), int(fields[8]), int(fields[9])]})
    return {"pdfPage": page_no, "sourcePdfSha256": sha(pdf.read_bytes()), "engine": "Tesseract",
            "language": "eng", "renderScaleMaxPixels": 1800, "text": text,
            "words": words, "visualReview": "pending; OCR is not a faithful reconstruction"}


def extract(pdf: Path = PDF, output: Path = GRAPH, do_ocr: bool = True) -> dict:
    original = pdf.read_bytes()
    reader = PdfReader(pdf)
    title_page = (reader.pages[1].extract_text() or "").casefold()
    if len(reader.pages) != 106 or "four against darkness rules engine" not in title_page:
        raise ValueError("Unexpected Alone Against Fear PDF edition")
    toc = toc_titles(reader)
    OUT.mkdir(parents=True, exist_ok=True)
    raw_pages: list[str] = []
    ledger = []
    image_refs: dict[str, dict] = {}
    image_occurrences = []
    low_text = []

    # Keep page text as the canonical reading sequence; visual ledger preserves
    # image occurrences, and source ranges point back to exact text-layer spans.
    for page_no, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        raw_pages.append(text)
        chars = len(text)
        if chars < 100:
            low_text.append(page_no)
        page_images = []
        for image in page.images:
            raw = image.data
            digest = sha(raw)
            ext = Path(image.name).suffix.lower() or ".bin"
            relative = f"assets/{digest}{ext}"
            if digest not in image_refs:
                target = OUT / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(raw)
                image_refs[digest] = {"path": (OUT / relative).relative_to(ROOT / "scripts").as_posix(),
                                      "sha256": digest, "size": len(raw), "originalName": image.name}
            occurrence = {"pdfPage": page_no, "imageName": image.name, "assetSha256": digest}
            page_images.append(occurrence)
            image_occurrences.append(occurrence)
        ledger.append({"pdfPage": page_no, "printedPage": page_no if page_no >= 3 else None,
                       "classification": "image-only" if chars == 0 else ("mixed-text-and-image" if page_images else "native-text"),
                       "textLayerCharacters": chars, "textLayerSha256": sha(text.encode()),
                       "imageCount": len(page_images), "images": page_images,
                       "ocrStatus": "pending" if chars < 100 else "not-required-by-character-count"})

    # TOC boundaries let each chapter/table stand alone. Unique Events use their
    # printed #N identities and may continue across pages.
    page_parts: list[list[tuple[str, int, int]]] = []
    for text in raw_pages:
        parts = []
        offset = 0
        for line in text.splitlines(keepends=True):
            parts.append((line, offset, offset + len(line)))
            offset += len(line)
        page_parts.append(parts)

    content: dict[str, dict] = {}
    wrappers = []
    event_ids = []
    current = "front-matter"
    event_current: str | None = None
    for page_no, parts in enumerate(page_parts, 1):
        for line, start, end in parts:
            stripped = line.strip()
            if stripped in {"Alone against fear", "Alone Against Fear"} or stripped == str(page_no):
                wrappers.append({"text": line, "sourceLocation": f"pdf:spans:{json.dumps([[page_no,start,end]], separators=(',',':'))}"})
                continue
            event_match = TITLE_RE.match(stripped)
            if event_match:
                event_current = f"unique-event-{int(event_match.group(1)):03d}"
                event_ids.append(event_current)
                current = event_current
            elif event_current and page_no >= 98:
                event_current = None
                current = "play-aids-and-summaries"
            elif not event_current and (matched := toc_match(stripped, toc)):
                current = matched
                event_current = None
            if not stripped and not content.get(event_current or current, {}).get("paragraphs"):
                # Leading separators are layout, but preserve their exact bytes in wrappers.
                wrappers.append({"text": line, "sourceLocation": f"pdf:spans:{json.dumps([[page_no,start,end]], separators=(',',':'))}"})
                continue
            key = event_current or current
            record = content.setdefault(key, {"id": key, "paragraphs": [], "sourcePages": []})
            record["paragraphs"].append({"id": f"{key}:p{len(record['paragraphs']):04d}", "kind": "body",
                                         "text": line, "sourceLocation": f"pdf:spans:{json.dumps([[page_no,start,end]], separators=(',',':'))}"})
            if page_no not in record["sourcePages"]:
                record["sourcePages"].append(page_no)

    # Write independently addressable source JSON. Exact page text can be
    # reconstructed from provenance ranges without maintaining a second book.
    graph_nodes = []
    section_catalog = []
    event_fragments = {}
    for key, record in content.items():
        path = OUT / "fragments" / f"{key}.json"
        digest = write_json(path, record)
        ref = {"path": path.relative_to(ROOT / "scripts").as_posix(), "sha256": digest}
        if key.startswith("unique-event-"):
            event_number = str(int(key.rsplit("-", 1)[1]))
            event_fragments[event_number] = ref
            graph_nodes.append({"id": event_number, "fragment": ref, "terminal": False})
        else:
            section_catalog.append({"sectionId": key, "kind": "chapter-or-table", "fragment": ref,
                                    "sourcePages": record["sourcePages"]})
    graph_edges = []
    for number in sorted(event_fragments, key=int):
        record = content[f"unique-event-{int(number):03d}"]
        for paragraph in record["paragraphs"]:
            for match in re.finditer(r"\bgo\s+to\s+(?:event\s+)?#?\s*(\d+)\b", paragraph["text"], re.I):
                target = match.group(1)
                if target in event_fragments:
                    graph_edges.append({"id": f"event-ref-{len(graph_edges)+1}", "source": number,
                                        "target": target, "paragraphId": paragraph["id"],
                                        "evidence": "explicit-printed-event-reference", "textOffset": match.start()})

    # OCR all sparse-text pages and retain word coordinates/confidence. Sparse
    # pages are often illustrations, so each OCR record remains visibly provisional.
    ocr_refs = []
    if do_ocr:
        with tempfile.TemporaryDirectory(prefix="fear-ocr-") as temp:
            for page_no in low_text:
                path = OUT / "ocr" / f"page-{page_no:03d}.json"
                if path.exists():
                    cached = json.loads(path.read_text())
                    if cached.get("sourcePdfSha256") == sha(original) and cached.get("pdfPage") == page_no:
                        digest = sha(path.read_bytes())
                    else:
                        result = render_ocr(pdf, page_no, OUT, Path(temp))
                        digest = write_json(path, result)
                else:
                    result = render_ocr(pdf, page_no, OUT, Path(temp))
                    digest = write_json(path, result)
                ocr_refs.append({"path": path.relative_to(ROOT / "scripts").as_posix(), "sha256": digest, "pdfPage": page_no})
                ledger[page_no - 1]["ocrStatus"] = "ocr-generated-visual-review-pending"

    supplement_data = {
        "documents": [{"document": pdf.name, "entries": [
            {"kind": "pdf-provenance", "sourceLocation": "pdf:document", "metadata": {
                "pdfPages": ledger, "assets": list(image_refs.values()), "imageOccurrences": image_occurrences,
                "ocrRecords": ocr_refs, "pageTextWrapperLines": wrappers, "sections": section_catalog,
                "canonicalTextClaim": "pypdf extract_text pages, in page order, reconstructed from paragraph source spans; PDF binary and visual assets remain authoritative",
                "layoutReview": "OCR and visual order review pending for sparse-text pages and all table/character-sheet values"}}]}]
    }
    supplement_path = OUT / "fragments/supplements.json"
    supplement_digest = write_json(supplement_path, supplement_data)

    graph = {"format": "coc-story-graph@2", "id": "alone-against-fear", "title": "Alone Against Fear",
             "displayTitle": "恐惧独行（暂定适配名）", "language": "en", "entry": "1",
             "runtimePlayable": False,
             "source": {"filename": pdf.name, "sha256": sha(original), "size": len(original), "pdfPages": len(reader.pages),
                        "metadataTitle": reader.metadata.title if reader.metadata else None,
                        "author": reader.metadata.author if reader.metadata else None},
             "supplements": {"path": supplement_path.relative_to(ROOT / "scripts").as_posix(), "sha256": supplement_digest},
             "nodes": sorted(graph_nodes, key=lambda node: int(node["id"])), "edges": graph_edges,
             "issues": [{"kind": "metadata-title-conflict", "pdfMetadataTitle": "Escape from Demon City", "coverAndBodyTitle": "Alone Against Fear"},
                        {"kind": "unreviewed-rule-system", "note": "Based on Four Against Darkness; define separate d6 rules, do not apply Call of Cthulhu mechanics."},
                        {"kind": "visual-review-pending", "pages": low_text},
                        {"kind": "translation-incomplete", "note": "Full Chinese translation and paragraph review pending."}]}
    write_json(output, graph)
    return verify(pdf, output)


def verify(pdf: Path = PDF, graph_path: Path = GRAPH) -> dict:
    graph = json.loads(graph_path.read_text())
    reader = PdfReader(pdf)
    if sha(pdf.read_bytes()) != graph["source"]["sha256"]:
        raise ValueError("PDF source hash changed")
    texts = [page.extract_text() or "" for page in reader.pages]
    spans: dict[int, list[tuple[int, int, str]]] = defaultdict(list)
    sp_ref = graph["supplements"]
    spath = (graph_path.parent / sp_ref["path"]).resolve()
    if not spath.is_relative_to(graph_path.parent.resolve()) or sha(spath.read_bytes()) != sp_ref["sha256"]:
        raise ValueError("Supplements path or hash invalid")
    supplements = json.loads(spath.read_text())
    metadata = supplements["documents"][0]["entries"][0]["metadata"]
    references = [node["fragment"] for node in graph["nodes"]] + [section["fragment"] for section in metadata["sections"]]
    for ref in references:
        path = (graph_path.parent / ref["path"]).resolve()
        if not path.is_relative_to(graph_path.parent.resolve()):
            raise ValueError("Unsafe fragment path")
        raw = path.read_bytes()
        if sha(raw) != ref["sha256"]:
            raise ValueError("Source fragment hash mismatch")
        item = json.loads(raw)
        for paragraph in item["paragraphs"]:
            locations = json.loads(paragraph["sourceLocation"].removeprefix("pdf:spans:"))
            for page_no, start, end in locations:
                value = texts[page_no - 1][start:end]
                if value != paragraph["text"]:
                    raise ValueError(f"Text provenance mismatch at page {page_no}:{start}-{end}")
                spans[page_no].append((start, end, value))
    for wrapper in metadata["pageTextWrapperLines"]:
        for page_no, start, end in json.loads(wrapper["sourceLocation"].removeprefix("pdf:spans:")):
            spans[page_no].append((start, end, texts[page_no - 1][start:end]))
    for page_no, text in enumerate(texts, 1):
        cursor = 0
        reconstructed = []
        for start, end, value in sorted(spans[page_no]):
            if start != cursor:
                raise ValueError(f"Text layer gap/overlap on page {page_no}: {cursor} vs {start}")
            reconstructed.append(value)
            cursor = end
        if "".join(reconstructed) != text:
            raise ValueError(f"Canonical text reconstruction failed on page {page_no}")
    return {"pdfPages": len(reader.pages), "pdfSha256": graph["source"]["sha256"],
            "sourceFragments": len(graph["nodes"]) + len(metadata["sections"]),
            "uniqueEvents": len(graph["nodes"]), "sections": len(metadata["sections"]),
            "textLayerReconstructed": True, "imageAssets": len(metadata["assets"]),
            "imageOccurrences": len(metadata["imageOccurrences"]), "ocrPages": len(metadata["ocrRecords"]),
            "ocrVisualReview": "pending"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["extract", "verify"])
    parser.add_argument("source", nargs="?", default=str(PDF))
    parser.add_argument("graph", nargs="?", default=str(GRAPH))
    parser.add_argument("--no-ocr", action="store_true")
    args = parser.parse_args()
    source, graph = Path(args.source), Path(args.graph)
    result = extract(source, graph, do_ocr=not args.no_ocr) if args.command == "extract" else verify(source, graph)
    print(json.dumps(result, ensure_ascii=False))
