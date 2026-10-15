// Explicit offline test-input capture; enabled only by COC_REVIEW_READ_LOG.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const output = process.env.COC_REVIEW_READ_LOG;
if (output) {
  const read = fs.readFileSync;
  const append = fs.appendFileSync;
  const seen = new Set();
  fs.readFileSync = function (path, ...args) {
    const result = read.call(this, path, ...args);
    if (typeof path === "string" || path instanceof URL) {
      const name = relative(process.cwd(), resolve(path instanceof URL ? fileURLToPath(path) : path));
      if (name.startsWith("work/") && !seen.has(name)) {
        seen.add(name);
        append(output, JSON.stringify(name) + "\n");
      }
    }
    return result;
  };
  syncBuiltinESMExports();
}
