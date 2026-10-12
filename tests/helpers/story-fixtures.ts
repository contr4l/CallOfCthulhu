import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { buildApp as productionApp } from "../../apps/api/src/app.js";
import { loadStories as productionStories } from "../../apps/api/src/catalog.js";

let root: string | undefined;
/** Explicit test-only catalog; fixtures never enter the production stories directory. */
export function testStoryRoot() {
  if (!root) {
    root = mkdtempSync(resolve(tmpdir(), "coc-test-stories-"));
    cpSync(resolve("stories"), root, { recursive: true });
    cpSync(resolve("tests/fixtures/stories"), root, { recursive: true });
    const temporaryRoot = root;
    process.once("exit", () =>
      rmSync(temporaryRoot, { recursive: true, force: true }),
    );
  }
  return root;
}
export function buildApp(options: Parameters<typeof productionApp>[0] = {}) {
  return productionApp({ storyRoot: testStoryRoot(), ...options });
}
export function loadStories(path: string) {
  return productionStories(path === "stories" ? testStoryRoot() : path);
}
