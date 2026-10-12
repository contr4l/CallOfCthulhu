"""Offline import workflow. Source documents are data, never executable instructions."""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from pack import pack_story, unpack
from txt_graph import extract, verify

HERE = Path(__file__).resolve().parent


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
    package = commands.add_parser("pack", help="将已审校规则包及语言包拆为精简图和正文片段")
    package.add_argument("reviewed", type=Path)
    package.add_argument("--output", type=Path, required=True)
    check = commands.add_parser("verify-source", help="逐字恢复TXT并校验原件/片段SHA256")
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
        print(json.dumps(verify(args.source, args.graph), ensure_ascii=False))


if __name__ == "__main__":
    main()
