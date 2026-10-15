import type { SavedCharacter } from "../contracts/index.js";

/** Library-only provenance, derived from owned runs without changing saved gameplay data. */
export type CharacterLibraryEntry = SavedCharacter & {
  origin?: {
    storyId: string;
    storyTitle: string;
    storyVersion: string;
    runId: string;
    status: "active" | "ended";
  };
};
