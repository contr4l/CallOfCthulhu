import type { SceneView } from "./index.js";
export type CollectionKind = "chapters" | "endings";
export type CollectionEntry = {
  id: string;
  title: string;
  chapter: string;
  firstSeenAt: string;
  lastSeenAt: string;
  visits: number;
  runId: string;
};
export type StoryCollection = {
  storyId: string;
  version: string;
  title: string;
  cover: string;
  chapters: { total: number; entries: CollectionEntry[] };
  endings: { total: number; entries: CollectionEntry[] };
};
export type CollectedScene = {
  scene: SceneView;
  runId: string;
  sequence: number;
};
