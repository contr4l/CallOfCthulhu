"""Offline import workflow. Source documents are data, never executable instructions."""
import argparse
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from pack import pack_story, unpack
from txt_graph import extract, verify

HERE = Path(__file__).resolve().parent
PDF_ADAPTERS = {
    "alone-against-tide": "pdf_tide.py",
    "alone-against-frost": "pdf_frost.py",
    "alone-against-dark": "extract_dark.py",
    "alone-against-fear": "fear_pdf.py",
}


def run_pdf_adapter(story_id, operation, source, graph):
    # Use only inspected, local adapters; a source document never supplies code.
    adapter = PDF_ADAPTERS.get(story_id)
    if adapter is None:
        raise ValueError(f"尚无已检查的 PDF 来源适配器：{story_id}")
    subprocess.run([pdf_python(), str(HERE / adapter), operation, str(source), str(graph)], check=True)


def pdf_python():
    if all(importlib.util.find_spec(module) for module in ("pypdf", "pdfplumber")):
        return sys.executable
    bundled = Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"
    if bundled.is_file():
        return str(bundled)
    raise RuntimeError("PDF 提取需要 pypdf 和 pdfplumber；请先安装依赖。")


def main():
    parser = argparse.ArgumentParser(description="剧本原件→完整片段→规则审校→发布；不会运行原文代码")
    commands = parser.add_subparsers(dest="command", required=True)
    draft = commands.add_parser("draft", help="提取 EPUB/TXT 作者草稿，不自动发布")
    draft.add_argument("source", type=Path)
    draft.add_argument("--output", type=Path, required=True)
    numbered = commands.add_parser("extract-txt", help="无损拆分 $t1 编号TXT，包括前言和角色表")
    numbered.add_argument("source", type=Path)
    numbered.add_argument("--id", required=True)
    numbered.add_argument("--title", required=True)
    numbered.add_argument("--entry", type=int, required=True)
    numbered.add_argument("--last-section", type=int, required=True)
    numbered.add_argument("--output", type=Path, required=True)
    pdf = commands.add_parser("extract-pdf-tide", help="按《潮汐独行》已检查的PDF版面提取原文，不发布")
    pdf.add_argument("source", type=Path)
    pdf.add_argument("--output", type=Path, required=True)
    for story_id in ("alone-against-frost", "alone-against-dark", "alone-against-fear"):
        command = commands.add_parser("extract-pdf-" + story_id.removeprefix("alone-against-"),
                                      help="按该作品的专用 PDF 版面提取来源；不编译或发布")
        command.add_argument("source", type=Path)
        command.add_argument("--output", type=Path, required=True)
    ocr = commands.add_parser("ocr-pdf-tide", help="对《潮汐独行》图片补充页执行本地Tesseract OCR")
    ocr.add_argument("source", type=Path)
    ocr.add_argument("--output", type=Path, required=True)
    tide = commands.add_parser("compile-tide", help="离线编译已核对的潮汐独行规则及双语片段")
    tide.add_argument("--output", type=Path, required=True)
    tide.add_argument("--version", default="1.0.1")
    package = commands.add_parser("pack", help="将已审校规则包及语言包拆为精简图和正文片段")
    package.add_argument("reviewed", type=Path)
    package.add_argument("--output", type=Path, required=True)
    check = commands.add_parser("verify-source", help="按来源适配器核验 TXT/PDF 覆盖、原件及片段 SHA256")
    check.add_argument("source", type=Path)
    check.add_argument("graph", type=Path)
    runtime = commands.add_parser("verify-runtime", help="检查发布目录全部规则、正文片段、校验和与资源")
    runtime.add_argument("root", type=Path)
    args = parser.parse_args()
    if args.command == "draft":
        subprocess.run([sys.executable, str(HERE / "import.py"), str(args.source), "--output", str(args.output)], check=True)
    elif args.command == "extract-txt":
        graph = extract(args.source, args.output, args.id, args.title, args.entry, args.last_section)
        print(json.dumps({"nodes": len(graph["nodes"]), "edges": len(graph["edges"]), "lossless": True}, ensure_ascii=False))
    elif args.command.startswith("extract-pdf-"):
        run_pdf_adapter("alone-against-" + args.command.removeprefix("extract-pdf-"), "extract", args.source, args.output)
    elif args.command == "ocr-pdf-tide":
        subprocess.run([pdf_python(), str(HERE / "ocr_tide.py"), str(args.source), str(args.output)], check=True)
    elif args.command == "compile-tide":
        subprocess.run([sys.executable, str(HERE / "build_tide.py"), "--output", str(args.output.resolve()), "--version", args.version], cwd=HERE.parents[1], check=True)
    elif args.command == "pack":
        story = unpack(args.reviewed)
        # Invalid or unreviewed rules never reach the requested publish folder.
        with tempfile.TemporaryDirectory(prefix="coc-review-") as temporary:
            staging = Path(temporary) / story["id"] / story["version"]
            pack_story(story, staging)
            subprocess.run(["npx", "tsx", str(HERE / "validate.ts"), temporary], cwd=HERE.parents[1], check=True)
        print(json.dumps(pack_story(story, args.output), ensure_ascii=False))
    elif args.command == "verify-runtime":
        subprocess.run(["npx", "tsx", str(HERE / "validate.ts"), str(args.root.resolve())], cwd=HERE.parents[1], check=True)
    else:
        if args.source.suffix.lower() == ".pdf":
            graph = json.loads(args.graph.read_text())
            run_pdf_adapter(graph.get("id"), "verify", args.source, args.graph)
        else:
            print(json.dumps(verify(args.source, args.graph), ensure_ascii=False))


if __name__ == "__main__":
    main()
