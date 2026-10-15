import type { Instruction, ProgramState, SceneInput } from "./program.js";
import type { PartyDefinition, PartyState } from "./party.js";
import type { CalendarDefinition, CalendarState } from "./calendar.js";
import type { FearDefinition, FearState, FearProjected } from "./fear.js";
import type { InvestigatorDefinition, InvestigatorState } from "./investigators.js";
import type { FrostCombatProjection } from "./frost-combat.js";
import type { FearDiceWindow } from "./fear-dice-window.js";
export type CharacterProfile = {
  age?: number;
  pronouns?: string;
  birthplace?: string;
  residence?: string;
  appearance?: string;
  ideology?: string;
  importantPeople?: string;
  meaningfulPlaces?: string;
  treasuredPossessions?: string;
  notes?: string;
};
export type Character = {
  skillNames?: Record<string, string>;
  rulesVersion?: string;
  specializations?: Record<string, string>;
  profile?: CharacterProfile;
  name: string;
  occupation: string;
  hp: number;
  maxHp: number;
  sanity: number;
  maxSanity?: number;
  luck: number;
  skills: Record<string, number>;
  attributes?: Record<string, number>;
  mp?: number;
  damageBonus?: string;
  build?: number;
  movement?: number;
  templateId?: string;
  templateVersion?: string;
  sourceStoryId?: string;
  sourceStoryTitle?: string;
};
export type Check = {
  skill: string;
  label: string;
  difficulty: "regular" | "hard" | "extreme";
  bonusDice?: number;
  penaltyDice?: number;
  success: string;
  failure: string;
  multiplier?: number;
};
export type Effect =
  | { type: "flag"; key: string; value: boolean }
  | { type: "hp" | "sanity"; amount: number }
  | { type: "item"; key: string; label: string };
export type Condition = { flag: string; equals: boolean };
export type SceneIllustration = {
  key: string;
  src: string;
  alt: string;
  caption?: string;
};
export type SceneReading = Partial<
  Record<"en" | "zh-CN", { title: string; text: string[] }>
>;
export type StoryNode = {
  healthRouting?: { sanity?: "source"; injury?: "source" };
  reading?: SceneReading;
  help?: string[];
  illustration?: SceneIllustration;
  id: string;
  title: string;
  chapter: string;
  text: string[];
  type: "narrative" | "choice" | "check" | "ending" | "program" | "fear";
  program?: Instruction[];
  sourceId?: string;
  background: string;
  music?: string;
  choices?: {
    id: string;
    label: string;
    hint?: string;
    target: string;
    condition?: Condition;
    effects?: Effect[];
  }[];
  next?: string;
  check?: Check;
  enterEffects?: Effect[];
  memory?: string;
  ending?: string;
};
export type CharacterPreset = {
  profile?: CharacterProfile;
  movement?: number;
  build?: number;
  specializations?: Record<string, string>;
  attributes?: Record<string, number>;
  mp?: number;
  damageBonus?: string;
  templateId?: string;
  id: string;
  label: string;
  description: string;
  occupation: string;
  skills: Record<string, number>;
  hp: number;
  sanity: number;
};
export type CharacterTemplate = CharacterPreset & {
  version: string;
  defaultName: string;
  sourceStoryId: string;
  sourceStoryTitle: string;
  attributes: Record<string, number>;
  mp: number;
  damageBonus: string;
  build: number;
  movement: number;
  luckFormula: "3d6x5";
  source: {
    publisher: string;
    url: string;
    pdfUrl: string;
    localPath: string;
    sha256: string;
    verifiedAt: string;
  };
};
export type CharacterTemplateGroup = {
  storyId: string;
  title: string;
  status: "official-pregenerated" | "guided-creation";
  description: string;
  sourceUrl: string;
  templateFiles: string[];
};
export type CharacterTemplateCatalog = {
  groups: CharacterTemplateGroup[];
  templates: CharacterTemplate[];
};
export type SavedCharacter = { id: string; character: Character };
export type InventoryItem = { key: string; label: string; quantity?: number };
export type Story = {
  investigators?: InvestigatorDefinition;
  fear?: FearDefinition;
  calendar?: CalendarDefinition;
  party?: PartyDefinition;
  creationPolicy?: "guided" | "fixed";
  healthPolicy?: "static" | "tide" | "frost";
  spendLuck?: boolean;
  source?: { file: string; sha256: string; notes: string[] };
  id: string;
  version: string;
  rulesVersion: string;
  title: string;
  subtitle: string;
  description: string;
  duration: string;
  difficulty: string;
  cover: string;
  accent: string;
  tags: string[];
  entry: string;
  presets: CharacterPreset[];
  nodes: StoryNode[];
};
export type StorySummary = Omit<
  Story,
  "nodes" | "entry" | "fear" | "party" | "calendar" | "investigators"
>;
export type RunState = {
  investigators?: InvestigatorState;
  fear?: FearState;
  fearDiceWindow?: FearDiceWindow;
  creationDice?: RuleDiceResult;
  calendar?: CalendarState;
  party?: PartyState;
  savedCharacterId?: string;
  createdCharacterId?: string;
  program?: ProgramState;
  nodeId: string;
  visitId: string;
  character: Character;
  flags: Record<string, boolean>;
  inventory: InventoryItem[];
  status: "active" | "ended";
};
export type RuleDiceResult = {
  aggregate?: boolean;
  label: string;
  groups: { sides: number; results: number[] }[];
  total: number;
  multiplier: number;
  value: number;
};
export type CombatOutcome = {
  enemyName: string;
  round: number;
  action: string;
  result: "hit" | "hurt" | "dodged" | "miss";
  damage: number;
  recipient: "player" | "enemy" | "none";
};
export type CheckResult = {
  performer?: { id: string; name: string };
  assistance?: {
    targetBonus: number;
    previousRoll?: number;
    rulesVersion?: string;
  };
  opponent?: { roll: number; target: number; grade: CheckResult["grade"]; candidates?: number[] };
  combat?: CombatOutcome;
  label: string;
  skill: string;
  target: number;
  roll: number;
  candidates: number[];
  originalRoll?: number;
  luckSpent?: number;
  success: boolean;
  grade: "critical" | "extreme" | "hard" | "regular" | "failure" | "fumble";
};
export type ActionView = { id: string; label: string; hint?: string };
export type Registration = {
  key: string;
  kind: "skill" | "state";
  label: string;
};
export type SceneView = {
  frostCombat?: FrostCombatProjection;
  playerNotes?: { key: string; label: string; text: string }[];
  fear?: FearProjected;
  calendar?: CalendarState;
  party?: PartyState;
  help?: string[];
  nextHint?: string;
  illustration?: SceneIllustration;
  collection?: { chapterId: string; endingId?: string };
  registrations?: Registration[];
  input?: SceneInput;
  notices?: string[];
  records?: string[];
  combat?: {
    enemyLives?: number[];
    name: string;
    hp?: number;
    damageGoal?: { label: string; amount: number; dealt: number; remaining: number };
    round: number;
    turn?: string;
    armor?: number;
    weapon?: string;
  };
  reading?: SceneReading;
  runId: string;
  storyId: string;
  storyTitle: string;
  revision: number;
  visitId: string;
  status: "active" | "ended";
  title: string;
  chapter: string;
  text: string[];
  background: string;
  music?: string;
  actions: ActionView[];
  check?: { label: string; target: number; difficulty: string };
  character: Character;
  inventory: (InventoryItem & { illustration?: SceneIllustration })[];
  ending?: string;
};
export type HistoryFrame = {
  discarded?: boolean;
  dice?: RuleDiceResult;
  sequence: number;
  createdAt: string;
  scene: SceneView;
  action?: string;
  check?: CheckResult;
  memory?: string;
};
export type RunSummary = {
  id: string;
  storyId: string;
  storyTitle: string;
  characterName: string;
  status: "active" | "ended";
  updatedAt: string;
  revision: number;
  cover: string;
  chapter: string;
};
export type Command = {
  shopItem?: "target-plus-10";
  input?: Record<string, number | string>;
  commandId: string;
  expectedRevision: number;
  actionId: string;
};
export type CommandResponse = {
  canReroll?: boolean;
  dice?: RuleDiceResult;
  scene: SceneView;
  check?: CheckResult;
  action: string;
};
export type User = { id: string; username: string };

export interface DiceRoll {
  id: string;
  purpose: "luck" | "free";
  sides: number;
  count: number;
  results: number[];
  total: number;
  createdAt: string;
}
