import type { DatabaseSync } from "node:sqlite";
import type {
  Story,
  StoryNode,
  HistoryFrame,
} from "../../../../packages/contracts/index.js";

export function endingLabel(node: StoryNode) {
  const terminal = node.program?.find(
    (step) => step.kind === "end" && step.collect !== false,
  );
  return node.ending ?? (terminal?.kind === "end" ? terminal.label : undefined);
}

/** The same confirmed, source-version-bound history powers achievements and rankings. */
export function* confirmedEndings(
  db: DatabaseSync,
  stories: Map<string, Story>,
  owner?: string,
) {
  const rows = db
    .prepare(
      `
    SELECT h.frame, h.run_id, r.user_id, r.story_id, r.story_version
    FROM run_history h JOIN runs r ON r.id = h.run_id
    WHERE ${owner === undefined ? "" : "r.user_id = ? AND"} json_extract(h.frame, '$.scene.status') = 'ended'
    AND NOT EXISTS(SELECT 1 FROM shop_discarded_checks d WHERE d.run_id=h.run_id AND d.sequence=h.sequence)
    AND NOT EXISTS(SELECT 1 FROM shop_check_windows w WHERE w.run_id=h.run_id AND w.revision=h.sequence)
    ORDER BY json_extract(h.frame, '$.createdAt'), h.rowid
  `,
    )
    .all(...(owner === undefined ? [] : [owner]));
  const indexes = new Map<
    string,
    {
      story: Story;
      byId: Map<string, StoryNode>;
      legacy: Map<string, StoryNode>;
    }
  >();
  for (const row of rows) {
    const key = `${row.story_id}@${row.story_version}`;
    let index = indexes.get(key);
    if (!index) {
      const story = stories.get(key);
      if (!story) continue;
      const nodes = story.nodes.filter((node) => endingLabel(node));
      const legacy = new Map<string, StoryNode>();
      for (const node of nodes) {
        const key = JSON.stringify([node.title, node.chapter]);
        if (!legacy.has(key)) legacy.set(key, node);
      }
      index = {
        story,
        byId: new Map(nodes.map((node) => [node.id, node])),
        legacy,
      };
      indexes.set(key, index);
    }
    const frame = JSON.parse(row.frame as string) as HistoryFrame;
    const node = frame.scene.collection?.endingId
      ? index.byId.get(frame.scene.collection.endingId)
      : index.legacy.get(
          JSON.stringify([frame.scene.title, frame.scene.chapter]),
        );
    if (!node) continue;
    yield {
      frame,
      node,
      story: index.story,
      runId: String(row.run_id),
      owner: String(row.user_id),
    };
  }
}
