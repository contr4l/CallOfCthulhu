/** Route evidence also depends on executable rules, even if a manifest is unchanged. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export function runtimeFingerprint() {
  const files: string[] = [];
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  }
  for (const directory of ["packages/engine", "packages/rules", "packages/contracts"]) visit(join(root, directory));
  const hash = createHash("sha256");
  for (const path of files.sort()) hash.update(relative(root, path)).update("\0").update(readFileSync(path)).update("\0");
  return hash.digest("hex");
}
