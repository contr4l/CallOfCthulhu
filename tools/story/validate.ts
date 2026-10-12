import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadStories } from "../../apps/api/src/catalog.js";
for (const story of loadStories(resolve("stories")).values()) {
  const resources = new Set([
    story.cover,
    ...story.nodes.flatMap((n) => [
      n.background,
      ...(n.music ? [n.music] : []),
      ...(n.illustration ? [n.illustration.src] : []),
    ]),
  ]);
  for (const resource of resources)
    if (!existsSync(resolve("apps/web/public", resource.slice(1))))
      throw new Error(`缺少资源：${resource}`);
  console.log(
    `${story.id}@${story.version}：${story.nodes.length} 节点，${story.presets.length} 角色，结构与资源检查通过。`,
  );
}
