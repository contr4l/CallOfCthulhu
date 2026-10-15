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

def visual_audit_summary(pdf_sha256: str, page_count: int) -> dict:
    """Verify review evidence identities; do not infer OCR accuracy from page coverage."""
    covered = set()
    reports = []
    for name in ("source-visual-audit-17.json", "source-visual-audit-59-75.json",
                 "source-visual-audit-general.json", "ocr-visual-audit-2026-10-14.json",
                 "source-visual-audit-remaining.json"):
        path = WORK / name
        if not path.exists():
            continue
        audit = json.loads(path.read_text())
        source = audit.get("sourcePdf")
        source_sha = audit.get("sourcePdfSha256") or (source.get("sha256") if isinstance(source, dict) else None)
        if source_sha != pdf_sha256:
            raise ValueError(f"Visual audit is bound to another PDF: {name}")
        for row in audit.get("pages", []):
            page = row["pdfPage"]
            if not isinstance(page, int) or not 1 <= page <= page_count:
                raise ValueError(f"Invalid visual audit page: {name}/{page}")
            render = row.get("render")
            render_path = render.get("path") if isinstance(render, dict) else render
            render_sha = render.get("sha256") if isinstance(render, dict) else row.get("renderSha256")
            if not render_path or not render_sha:
                raise ValueError(f"Missing visual image evidence: {name}/{page}")
            image = (ROOT / render_path).resolve()
            if not image.is_relative_to(ROOT) or sha(image.read_bytes()) != render_sha:
                raise ValueError(f"Invalid visual image evidence: {name}/{page}")
            covered.add(page)
        reports.append({"path": str(path.relative_to(ROOT)), "sha256": sha(path.read_bytes())})
    missing = sorted(set(range(1, page_count + 1)) - covered)
    return {"reviewedPages": sorted(covered), "missingPages": missing, "completePageCoverage": not missing,
            "reports": reports, "ocrFidelityClaim": False,
            "limitations": "Cover/divider lettering missed by OCR and illustration false positives remain documented; original images and PDF are preserved."}

TITLE_RE = re.compile(r"^\s*#\s*(\d+)\s*[-–—:.]\s*(.*?)\s*$")
VISUAL_REVIEW = {
    1: "cover reviewed; title is visible in stylized image text and Tesseract did not recover it",
    9: "full-page illustration reviewed; no body prose or table text embedded",
    21: "full-page illustration reviewed; no body prose or table text embedded",
    28: "full-page illustration reviewed; no body prose or table text embedded",
    30: "full-page illustration reviewed; no body prose or table text embedded",
    49: "full-page illustration reviewed; no body prose or table text embedded",
    56: "full-page illustration reviewed; no body prose or table text embedded",
    62: "full-page illustration reviewed; no body prose or table text embedded",
    76: "full-page illustration reviewed; no body prose or table text embedded",
    80: "full-page illustration reviewed; no body prose or table text embedded",
    89: "full-page illustration reviewed; no body prose or table text embedded",
    98: "title divider reviewed; heading text is visible in the image and in text layer",
}


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
    value = re.sub(r"^alone against fear\s+", "", value)
    if len(value) > 100:
        return None
    # The printed contents page is part of front matter, not a chapter index to
    # replay as body headings. Real headings are matched as complete labels;
    # allowing arbitrary suffixes incorrectly classified prose such as
    # "Mission table to determine what..." as a new section.
    value_base = re.sub(r"\s*\([^)]*\)\s*", " ", value).strip()
    value_base = re.sub(r"\s+\d+\s*xp$", "", value_base).strip()
    aliases = {
        "random initial skill table 1": "section-random-skill-generation",
        "random initial skill table 2": "section-random-skill-generation",
        "random initial skill table 3": "section-random-skill-generation",
        "random initial skill generation": "section-random-skill-generation",
        "pregenerated character": "section-sample-pregenerated-characters",
    }
    alias_base = re.sub(r"\s*\([^)]*\)\s*", " ", value).strip()
    alias_base = re.sub(r"\s+\d+\s*xp$", "", alias_base).strip()
    if alias_base in aliases:
        return aliases[alias_base]
    has_continued = "continued" in value
    for label, node_id in sorted(toc.items(), key=lambda item: len(item[0]), reverse=True):
        if ("continued" in label) != has_continued:
            continue
        label_base = re.sub(r"\s*\([^)]*\)\s*", " ", label).strip()
        if value_base in {label_base, label_base + " table"}:
            return node_id
    return None


def body_heading(line: str, page_no: int, toc: dict[str, str]) -> str | None:
    matched = toc_match(line, toc)
    if page_no < 100 or matched is None:
        return matched
    # The printable aids and character sheets repeat field labels such as
    # Food, Skills and Equipment. Those are form fields, not chapter headings.
    allowed = {
        100: {"section-character-sheet"},
        101: {"section-town-map"},
        102: {"section-game-overview"},
        103: {"section-random-skill-generation"},
        104: {"section-sample-pregenerated-characters"},
        105: {"section-sample-pregenerated-characters"},
    }
    return matched if matched in allowed.get(page_no, set()) else None


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
                       "ocrStatus": "pending" if chars < 100 else "not-required-by-character-count",
                       "visualReview": VISUAL_REVIEW.get(page_no, "pending")})

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
    resume_event_after_hut_table: str | None = None
    paragraph = None

    def flush_paragraph():
        nonlocal paragraph
        if paragraph is None:
            return
        key = paragraph["key"]
        record = content.setdefault(key, {"id": key, "document": pdf.name, "paragraphs": [], "sourcePages": []})
        index = len(record["paragraphs"])
        record["paragraphs"].append({"id": f"{key}:p{index}", "kind": paragraph["kind"],
                                     "text": paragraph["text"],
                                     "sourceLocation": f"pdf:spans:{json.dumps(paragraph['spans'], separators=(',',':'))}"})
        for page_no in paragraph["pages"]:
            if page_no not in record["sourcePages"]:
                record["sourcePages"].append(page_no)
        paragraph = None

    def append_line(key: str, line: str, page_no: int, start: int, end: int, kind: str = "body"):
        nonlocal paragraph
        if paragraph is None:
            paragraph = {"key": key, "kind": kind, "text": "", "spans": [], "pages": []}
        paragraph["text"] += line
        paragraph["spans"].append([page_no, start, end])
        if page_no not in paragraph["pages"]:
            paragraph["pages"].append(page_no)

    for page_no, parts in enumerate(page_parts, 1):
        for line, start, end in parts:
            stripped = line.strip()
            if stripped in {"Alone against fear", "Alone Against Fear"} or stripped == str(page_no):
                wrappers.append({"text": line, "sourceLocation": f"pdf:spans:{json.dumps([[page_no,start,end]], separators=(',',':'))}"})
                continue
            event_match = TITLE_RE.match(stripped)
            if event_match and 77 <= page_no <= 96:
                flush_paragraph()
                event_current = str(int(event_match.group(1)))
                event_ids.append(event_current)
                current = event_current
                append_line(current, line, page_no, start, end, "heading")
                flush_paragraph()
                continue
            elif event_current and page_no >= 97 and (matched := body_heading(stripped, page_no, toc)):
                flush_paragraph()
                event_current = None
                current = matched
                append_line(current, line, page_no, start, end, "heading")
                flush_paragraph()
                continue
            elif event_current and 77 <= page_no <= 96 and (matched := body_heading(stripped, page_no, toc)):
                # Some supplemental rules tables are physically embedded
                # between numbered events (Fluid and Random Item in the Hut).
                # Keep the table independently addressable, then resume event
                # parsing at the next printed #N heading.
                flush_paragraph()
                if matched == "section-random-item-in-the-hut":
                    resume_event_after_hut_table = event_current
                event_current = None
                current = matched
                append_line(current, line, page_no, start, end, "heading")
                flush_paragraph()
                continue
            elif page_no == 98 and norm(stripped) == "play aids and summaries":
                flush_paragraph()
                event_current = None
                current = "section-play-aids-and-summaries"
                append_line(current, line, page_no, start, end, "heading")
                flush_paragraph()
                continue
            elif not event_current and (matched := body_heading(stripped, page_no, toc)):
                flush_paragraph()
                current = matched
                event_current = None
                append_line(current, line, page_no, start, end, "heading")
                flush_paragraph()
                continue
            if current == "section-random-item-in-the-hut" and stripped.casefold().startswith("d6+3 sewer people"):
                flush_paragraph()
                if resume_event_after_hut_table:
                    current = resume_event_after_hut_table
                    event_current = resume_event_after_hut_table
                    resume_event_after_hut_table = None
                    append_line(current, line, page_no, start, end)
                    continue
            key = event_current or current
            if not stripped:
                if paragraph is None:
                    wrappers.append({"text": line, "sourceLocation": f"pdf:spans:{json.dumps([[page_no,start,end]], separators=(',',':'))}"})
                else:
                    append_line(key, line, page_no, start, end)
                    flush_paragraph()
                continue
            # A standalone table row number, numbered/bulleted list item, or
            # new event heading begins a new semantic paragraph. Wrapped lines
            # remain together and retain all original line endings and spans.
            if re.fullmatch(r"\d{1,2}[.)]?", stripped) or re.match(r"^(?:\d{1,2}[.)]\s+|[•●]\s*)", stripped):
                flush_paragraph()
            append_line(key, line, page_no, start, end)
    flush_paragraph()

    # Write independently addressable source JSON. Exact page text can be
    # reconstructed from provenance ranges without maintaining a second book.
    graph_nodes = []
    section_catalog = []
    event_fragments = {}
    for key, record in content.items():
        path = OUT / "fragments" / (f"{int(key):03d}.json" if key.isdigit() else f"{key}.json")
        fragment = dict(record)
        if key.isdigit():
            fragment.pop("sourcePages", None)
        digest = write_json(path, fragment)
        ref = {"path": path.relative_to(ROOT / "scripts").as_posix(), "sha256": digest}
        if key.isdigit():
            event_number = str(int(key))
            event_fragments[event_number] = ref
            graph_nodes.append({"id": event_number, "fragment": ref, "terminal": False})
        else:
            section_catalog.append({"sectionId": key, "kind": "chapter-or-table", "fragment": ref,
                                    "sourcePages": record["sourcePages"]})
    graph_edges = []
    for number in sorted(event_fragments, key=int):
        record = content[number]
        for paragraph in record["paragraphs"]:
            for match in re.finditer(r"\bgo\s+to\s+(?:event\s+)?#?\s*(\d+)\b", paragraph["text"], re.I):
                target = match.group(1)
                if target in event_fragments:
                    graph_edges.append({"id": f"event-ref-{len(graph_edges)+1}", "source": number,
                                        "target": target, "paragraphId": paragraph["id"],
                                        "evidence": "printed-prose-number", "textOffset": match.start()})

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
            {"kind": "pdf-provenance", "section": "source-integrity", "sourceLocation": "pdf:document", "metadata": {
                "pdfPages": ledger, "assets": list(image_refs.values()), "imageOccurrences": image_occurrences,
                "ocrRecords": ocr_refs, "pageTextWrapperLines": wrappers, "sections": section_catalog,
                "visualReviews": [{"pdfPage": page_no, "result": result} for page_no, result in VISUAL_REVIEW.items()],
                "canonicalTextClaim": "pypdf extract_text pages, in page order, reconstructed from paragraph source spans; PDF binary and visual assets remain authoritative",
                "layoutReview": "OCR and visual order review pending for sparse-text pages and all table/character-sheet values"}}]}]
    }
    supplement_path = OUT / "fragments/supplements.json"
    supplement_digest = write_json(supplement_path, supplement_data)

    graph = {"format": "coc-story-graph@2", "id": "alone-against-fear", "title": "Alone Against Fear",
             "language": "en", "entry": "1",
             "runtimePlayable": False,
             "source": {"filename": pdf.name, "sha256": sha(original), "size": len(original)},
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
    source_by_id: dict[str, tuple[dict, str]] = {}
    for ref in references:
        path = (graph_path.parent / ref["path"]).resolve()
        if not path.is_relative_to(graph_path.parent.resolve()):
            raise ValueError("Unsafe fragment path")
        raw = path.read_bytes()
        if sha(raw) != ref["sha256"]:
            raise ValueError("Source fragment hash mismatch")
        item = json.loads(raw)
        source_by_id[item["id"]] = (item, ref["sha256"])
        for paragraph in item["paragraphs"]:
            locations = json.loads(paragraph["sourceLocation"].removeprefix("pdf:spans:"))
            assembled = []
            for page_no, start, end in locations:
                value = texts[page_no - 1][start:end]
                assembled.append(value)
                spans[page_no].append((start, end, value))
            if "".join(assembled) != paragraph["text"]:
                raise ValueError(f"Text provenance mismatch for paragraph {paragraph['id']}")
    for wrapper in metadata["pageTextWrapperLines"]:
        for page_no, start, end in json.loads(wrapper["sourceLocation"].removeprefix("pdf:spans:")):
            spans[page_no].append((start, end, texts[page_no - 1][start:end]))
    for asset in metadata["assets"]:
        path = (graph_path.parent / asset["path"]).resolve()
        if not path.is_relative_to(graph_path.parent.resolve()) or sha(path.read_bytes()) != asset["sha256"]:
            raise ValueError("Image asset path or checksum invalid")
    for ocr in metadata["ocrRecords"]:
        path = (graph_path.parent / ocr["path"]).resolve()
        if not path.is_relative_to(graph_path.parent.resolve()) or sha(path.read_bytes()) != ocr["sha256"]:
            raise ValueError("OCR record path or checksum invalid")
        if json.loads(path.read_text()).get("sourcePdfSha256") != graph["source"]["sha256"]:
            raise ValueError("OCR record belongs to a different source PDF")
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
    translation_root = graph_path.parent / "alone-against-fear/translations/zh-CN"
    manifest_path = translation_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("translator") != "GPT-6 Luna" or manifest.get("locale") != "zh-CN":
        raise ValueError("Fear translation manifest identity mismatch")
    translated_rows = []
    translated_ids = []
    for translation_path in sorted(translation_root.glob("*.json")):
        if translation_path.name in {"manifest.json", "glossary.json"}:
            continue
        translation = json.loads(translation_path.read_text())
        fragment_id = translation.get("id")
        if fragment_id not in source_by_id:
            raise ValueError(f"Translation references unknown source fragment {fragment_id}")
        source, source_digest = source_by_id[fragment_id]
        if translation.get("sourceFragmentSha256") != source_digest:
            raise ValueError(f"Translation is bound to stale source fragment {fragment_id}")
        translated = {row["id"]: row["text"] for row in translation.get("paragraphs", [])}
        source_paragraphs = {row["id"]: row["text"] for row in source["paragraphs"]}
        if set(translated) != set(source_paragraphs):
            raise ValueError(f"Translation paragraph coverage mismatch for {fragment_id}")
        translated_ids.append(fragment_id)
        for paragraph_id, source_text in source_paragraphs.items():
            translated_rows.append({"fragmentId": fragment_id, "paragraphId": paragraph_id,
                "sourceFragmentSha256": source_digest, "sourceTextSha256": sha(source_text.encode()),
                "translationTextSha256": sha(translated[paragraph_id].encode())})
    if manifest.get("completedFragments") != translated_ids:
        raise ValueError("Translation manifest fragment list is stale")
    if manifest.get("translatedParagraphs") != translated_rows:
        raise ValueError("Translation manifest paragraph hashes are stale")
    if manifest.get("totalSourceFragments") != len(source_by_id) or manifest.get("untranslatedSourceFragments") != len(source_by_id) - len(translated_ids):
        raise ValueError("Translation manifest source counts are stale")
    untranslated_ids = sorted(set(source_by_id) - set(translated_ids), key=lambda value: (0, int(value)) if value.isdigit() else (1, value))
    if manifest.get("untranslatedFragments") != untranslated_ids:
        raise ValueError("Translation manifest untranslated fragment list is stale")
    visual = visual_audit_summary(graph["source"]["sha256"], len(reader.pages))
    return {"pdfPages": len(reader.pages), "pdfSha256": graph["source"]["sha256"],
            "sourceFragments": len(graph["nodes"]) + len(metadata["sections"]),
            "uniqueEvents": len(graph["nodes"]), "sections": len(metadata["sections"]),
            "textLayerReconstructed": True, "imageAssets": len(metadata["assets"]),
            "imageOccurrences": len(metadata["imageOccurrences"]), "ocrPages": len(metadata["ocrRecords"]),
            "ocrVisualReview": "complete page-image review; documented OCR limitations remain" if visual["completePageCoverage"] else "partial page-image review; see missingPages",
            "visualAudit": visual,
            "translatedFragments": len(translated_ids), "translatedParagraphs": len(translated_rows)}


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
