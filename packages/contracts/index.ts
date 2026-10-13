import type { Instruction, ProgramState, SceneInput } from "./program.js";
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
  specializations?: Record<string, string>;
  profile?: CharacterProfile;
  name: string;
  occupation: string;
  hp: number;
  maxHp: number;
  sanity: number;
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
  reading?: SceneReading;
  help?: string[];
  illustration?: SceneIllustration;
  id: string;
  title: string;
  chapter: string;
  text: string[];
  type: "narrative" | "choice" | "check" | "ending" | "program";
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
export type Story = {
  creationPolicy?: "guided" | "fixed";
  healthPolicy?: "static" | "tide";
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
export type StorySummary = Omit<Story, "nodes" | "entry">;
export type RunState = {
  createdCharacterId?: string;
  program?: ProgramState;
  nodeId: string;
  visitId: string;
  character: Character;
  flags: Record<string, boolean>;
  inventory: { key: string; label: string }[];
  status: "active" | "ended";
};
export type RuleDiceResult = {
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
  assistance?: {
    targetBonus: number;
    previousRoll?: number;
    rulesVersion?: string;
  };
  opponent?: { roll: number; target: number; grade: CheckResult["grade"] };
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
  help?: string[];
  nextHint?: string;
  illustration?: SceneIllustration;
  collection?: { chapterId: string; endingId?: string };
  registrations?: Registration[];
  input?: SceneInput;
  notices?: string[];
  records?: string[];
  combat?: {
    name: string;
    hp: number;
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
  inventory: { key: string; label: string; illustration?: SceneIllustration }[];
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
