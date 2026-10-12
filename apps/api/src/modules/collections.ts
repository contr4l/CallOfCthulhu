import type { DatabaseSync } from "node:sqlite";
import type {
  Story,
  StoryNode,
  HistoryFrame,
} from "../../../../packages/contracts/index.js";
import type {
  CollectionKind,
  StoryCollection,
  CollectionEntry,
  CollectedScene,
} from "../../../../packages/contracts/collections.js";
import {
  withSceneReading,
  GameError,
} from "../../../../packages/engine/index.js";
export function chapterKey(node: StoryNode) {
  return node.sourceId && node.sourceId !== "adaptation"
    ? node.sourceId
    : node.id;
}
const isEnding = (n: StoryNode) =>
  n.type === "ending" || n.program?.some((s) => s.kind === "end");
export function readCollections(
  db: DatabaseSync,
  owner: string,
  stories: Map<string, Story>,
) {
  const result: StoryCollection[] = [],
    details = new Map<string, CollectedScene>();
  for (const story of stories.values()) {
    const chapterIds = new Set(
      story.nodes.filter((n) => n.sourceId !== "adaptation").map(chapterKey),
    );
    const endingIds = new Set(story.nodes.filter(isEnding).map((n) => n.id));
    const maps = {
      chapters: new Map<string, CollectionEntry>(),
      endings: new Map<string, CollectionEntry>(),
    };
    const visits = new Map<string, Set<string>>();
    const rows = db
      .prepare(
        "SELECT h.frame,h.run_id FROM run_history h JOIN runs r ON r.id=h.run_id WHERE r.user_id=? AND r.story_id=? AND r.story_version=? ORDER BY h.rowid",
      )
      .all(owner, story.id, story.version);
    for (const row of rows) {
      const frame = JSON.parse(row.frame as string) as HistoryFrame,
        scene = frame.scene;
      // Old history predates explicit collection keys. Resolve only its already-visible paragraph.
      const node = story.nodes.find(
        (n) =>
          n.title === scene.title &&
          n.chapter === scene.chapter &&
          (scene.status !== "ended" || isEnding(n)),
      );
      const keys = {
        chapters:
          scene.collection?.chapterId ?? (node ? chapterKey(node) : undefined),
        endings:
          scene.status === "ended"
            ? (scene.collection?.endingId ?? node?.id)
            : undefined,
      };
      for (const kind of ["chapters", "endings"] as const) {
        const id = keys[kind];
        if (!id || !(kind === "chapters" ? chapterIds : endingIds).has(id))
          continue;
        const key = JSON.stringify([story.id, story.version, kind, id]),
          at = frame.createdAt,
          runId = row.run_id as string;
        const seen = visits.get(key) ?? new Set<string>();
        seen.add(`${runId}:${scene.visitId}`);
        visits.set(key, seen);
        const prior = maps[kind].get(id);
        maps[kind].set(id, {
          id,
          title:
            kind === "endings" ? (scene.ending ?? scene.title) : scene.title,
          chapter: scene.chapter,
          firstSeenAt: prior && prior.firstSeenAt < at ? prior.firstSeenAt : at,
          lastSeenAt: prior && prior.lastSeenAt > at ? prior.lastSeenAt : at,
          visits: seen.size,
          runId,
        });
        details.set(key, {
          scene: withSceneReading(story, scene),
          runId,
          sequence: frame.sequence,
        });
      }
    }
    result.push({
      storyId: story.id,
      version: story.version,
      title: story.title,
      cover: story.cover,
      chapters: {
        total: chapterIds.size,
        entries: [...maps.chapters.values()],
      },
      endings: { total: endingIds.size, entries: [...maps.endings.values()] },
    });
  }
  return {
    collections: result,
    entry(storyId: string, version: string, kind: CollectionKind, id: string) {
      const found = details.get(JSON.stringify([storyId, version, kind, id]));
      if (!found) throw new GameError(404, "尚未收集这份档案。");
      return found;
    },
  };
}
