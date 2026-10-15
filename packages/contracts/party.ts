import type { Character, InventoryItem } from "./index.js";

/** Companions are saved game state, never mutable shared character templates. */
export type PartyMember = {
  id: string;
  character: Character;
  status: "present" | "absent" | "missing" | "dead";
  revealed: boolean;
  unconscious: boolean;
  inventory: InventoryItem[];
};
export type PartyDefinition = { members: { id: string; character: Character; inventory?: InventoryItem[]; initialStatus?: PartyMember["status"]; initialVisible?: boolean }[] };
export type PartyState = { members: PartyMember[] };
