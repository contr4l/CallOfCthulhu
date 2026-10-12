import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type {
  Story,
  SceneReading,
} from "../../../../packages/contracts/index.js";

export const fragmentReference = z
  .object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const locale = z.union([
  z.object({ title: z.string(), text: z.array(z.string()) }).strict(),
  z.object({ title: z.string(), textRef: z.literal("default") }).strict(),
]);
const bodySchema = z
  .object({
    format: z.literal("coc-scene-fragment@1"),
    storyId: z.string(),
    version: z.string(),
    nodeIds: z.array(z.string()).min(1),
    text: z.array(z.string()).min(1),
    reading: z
      .object({ en: locale.optional(), "zh-CN": locale.optional() })
      .strict()
      .optional(),
  })
  .strict();

/** Validate metadata without loading the book's text. Hydrate only requested scenes. */
export function loadFragmentStory(
  manifestPath: string,
  parseGraph: (data: unknown) => {
    nodes: { fragment: z.infer<typeof fragmentReference> }[];
    [key: string]: unknown;
  },
  validate: (data: unknown) => Story,
  read: (path: string) => Buffer = (path) => readFileSync(path),
): Story {
  const graph = parseGraph(JSON.parse(readFileSync(manifestPath, "utf8")));
  const { format: _format, nodes, ...metadata } = graph;
  const root = realpathSync(dirname(resolve(manifestPath)));
  const paths = nodes.map((node) => {
    const file = node.fragment.path;
    if (isAbsolute(file) || file.split(/[\\/]/).includes(".."))
      throw new Error("剧情片段路径越界");
    const path = realpathSync(resolve(root, file));
    const local = relative(root, path);
    if (isAbsolute(local) || local === ".." || local.startsWith("../"))
      throw new Error("剧情片段路径越界");
    return path;
  });
  const story = validate({
    ...metadata,
    nodes: nodes.map(({ fragment: _fragment, ...node }) => ({
      ...node,
      text: [""],
    })),
  });
  const cache = new Map<string, { text: string[]; reading?: SceneReading }>();
  const refs = new Map<string, Set<string>>();
  for (const [i, path] of paths.entries()) {
    const ids = refs.get(path) ?? new Set<string>();
    ids.add(story.nodes[i].id);
    refs.set(path, ids);
  }
  const hashes = new Map<string, string>();
  for (const [i, path] of paths.entries()) {
    if (hashes.has(path) && hashes.get(path) !== nodes[i].fragment.sha256)
      throw new Error("同一剧情片段有冲突校验和");
    hashes.set(path, nodes[i].fragment.sha256);
  }
  function load(index: number) {
    const path = paths[index];
    let value = cache.get(path);
    if (!value) {
      const bytes = read(path);
      if (createHash("sha256").update(bytes).digest("hex") !== hashes.get(path))
        throw new Error("剧情片段校验和不匹配");
      const body = bodySchema.parse(JSON.parse(bytes.toString("utf8")));
      const expected = refs.get(path)!;
      if (
        body.storyId !== story.id ||
        body.version !== story.version ||
        body.nodeIds.length !== expected.size ||
        new Set(body.nodeIds).size !== expected.size ||
        body.nodeIds.some((id) => !expected.has(id))
      )
        throw new Error("剧情片段身份不匹配");
      const reading: SceneReading | undefined =
        body.reading &&
        Object.fromEntries(
          Object.entries(body.reading).map(([key, locale]) => [
            key,
            {
              title: locale!.title,
              text: "textRef" in locale! ? body.text : locale!.text,
            },
          ]),
        );
      value = { text: body.text, ...(reading ? { reading } : {}) };
      cache.set(path, value);
    }
    return value;
  }
  for (const [index, node] of story.nodes.entries()) {
    Object.defineProperties(node, {
      text: { enumerable: true, get: () => load(index).text },
      reading: { enumerable: true, get: () => load(index).reading },
    });
  }
  return story;
}
