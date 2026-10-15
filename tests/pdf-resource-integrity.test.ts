import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("offline PDF verification follows OCR JSON references and rejects changed rasters and symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "coc-pdf-resource-"));
  const outside = mkdtempSync(join(tmpdir(), "coc-pdf-outside-"));
  const hash = (data: string) => createHash("sha256").update(data).digest("hex");
  const write = (name: string, value: unknown) => {
    const data = JSON.stringify(value);
    writeFileSync(join(root, name), data);
    return { path: name, sha256: hash(data) };
  };
  const verify = () => JSON.parse(execFileSync("python3", ["-c",
    "import sys,json; sys.path.insert(0,sys.argv[1]); from pdf_resources import verify_resources; print(json.dumps(verify_resources(sys.argv[2])))",
    resolve("tools/story"), join(root, "graph.json"),
  ], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }));
  try {
    writeFileSync(join(root, "page.png"), "original-raster");
    const ocr = write("ocr.json", { rasterPath: "page.png", rasterSha256: hash("original-raster"), words: [] });
    const supplement = write("supplements.json", { documents: [{ entries: [{ metadata: { ocrPages: [ocr] } }] }] });
    write("graph.json", { supplements: supplement, nodes: [] });
    assert.equal(verify().hashedSourceResources, 3);
    writeFileSync(join(root, "page.png"), "changed-raster");
    assert.throws(verify, /integrity mismatch/);
    writeFileSync(join(outside, "external.png"), "original-raster");
    const linked = "linked.png";
    symlinkSync(join(outside, "external.png"), join(root, linked));
    const linkedOcr = write("ocr.json", { rasterPath: linked, rasterSha256: hash("original-raster") });
    const linkedSupplement = write("supplements.json", { documents: [{ entries: [{ metadata: { ocrPages: [linkedOcr] } }] }] });
    write("graph.json", { supplements: linkedSupplement, nodes: [] });
    assert.throws(verify, /symlink escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
