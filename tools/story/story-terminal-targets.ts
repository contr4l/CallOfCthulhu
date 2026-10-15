import type { Story } from "../../packages/contracts/index.js";

/** Fear owns terminal status routing; program books own explicit collect ends. */
export function storyTerminalTargets(story: Pick<Story, "fear" | "nodes">): string[] {
  return [...new Set(story.fear
    ? Object.values(story.fear.sceneRefs.endings)
    : story.nodes.filter(node => node.program?.some(step => step.kind === "end" && step.collect !== false)).map(node => node.id))];
}
