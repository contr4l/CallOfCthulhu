/** Data-only contract for Alone Against Fear. It deliberately does not reuse CoC checks. */
export type FearSceneRef = string;

export type FearTableEntry = {
  roll: number | [number, number];
  /** Stable result token, never full source prose. */
  result: string;
  scene?: FearSceneRef;
  tags?: string[];
  rerollLocations?: string[];
  values?: Record<string, number | string | boolean>;
  operations?: FearOperation[];
};
export type FearTable = { die: string; entries: FearTableEntry[]; exhausted?: FearTableEntry; rerollDefeated?: boolean };

/** Persisted substate for the six source missions and the cross-mission gate campaign. */
export type FearMissionState = {
  missionId: "1" | "2" | "3" | "4" | "5" | "6";
  previousMissionId?: "1" | "2" | "3" | "4" | "5" | "6";
  finished: boolean;
  missionRewardPending: boolean;
  completedMissionIds: ("1" | "2" | "3" | "4" | "5" | "6")[];
  campaign: { gatesClosed: number; won: boolean };
  gateCountAtStart: number;
  visitedBoxIds: string[];
  startingBoxId: string;
  currentBoxId: string;
  medical: { dosesFound: number; anyDoseFound: boolean; fallbackGranted: boolean };
  hunt: { targetId?: string; targetLevel?: number; targetDefeated: boolean; targetOnNextBox: boolean };
  food: { target: number; cargo: number; backpackAccepted: boolean; delivered: boolean };
  weapons: { qualifyingReturned: number };
  witches: { defeated: number; defeatedWitchIds: string[]; xp: number; capturedWitchIds: string[]; restrictedClues: number; lastFindWasCluePaid: boolean; lastSurpriseProbabilitySixths: number; pendingFinalItem: boolean; finalItemResolved: boolean };
  gates: { randomGateFound: boolean; fallbackThreshold?: number; firstFallbackFound: boolean; box30Found: boolean; revealed: number };
};

export type FearOperation =
  | { op: "resource"; key: "hp" | "sanity" | "food" | "missionFood" | "clues" | "xp" | "gatesClosed" | "firstAid" | `ammo-${string}`; amount: number | string }
  | { op: "max-resource"; key: "maxHp" | "maxSanity"; amount: number }
  | { op: "permanent-loss"; key: "hp" | "sanity"; amount: number }
  | { op: "restore-resource"; key: "hp" | "sanity"; amount: number | "all" }
  | { op: "spend-all-resource"; key: "food" }
  | { op: "ongoing-check"; id: string; trigger: "move"; context: string; level: number; requiredSkill?: string; failure: FearOperation[]; success?: FearOperation[] }
  | { op: "modifier"; key: string; amount: number; duration: "campaign" | "mission" | "next-combat"; encounters?: number }
  | { op: "require-item"; itemId: string; count?: number; success: FearOperation[]; failure?: FearOperation[] }
  | { op: "if-item-any"; itemIds: string[]; success: FearOperation[]; failure?: FearOperation[] }
  | { op: "if-book-read"; itemId: string; success: FearOperation[]; failure?: FearOperation[] }
  | { op: "require-skill"; skillId: string; level?: 1 | 2; success: FearOperation[]; failure?: FearOperation[] }
  | { op: "if-resource"; key: "hp" | "sanity" | "food" | "clues"; comparison: "eq" | "lt" | "lte" | "gt" | "gte"; value: number; success: FearOperation[]; failure?: FearOperation[] }
  | { op: "require-resource"; key: "hp" | "sanity" | "food" | "clues"; amount: number }
  | { op: "combat-outcome"; enemyId: string; defeated: FearOperation[]; fled?: FearOperation[]; escaped?: FearOperation[] }
  | { op: "group-combat-outcome"; primaryEnemyId: string; foodEnemyId: string; foodEach: string; allDefeated?: FearOperation[] }
  | { op: "item"; itemId: string; amount: number | string }
  | { op: "weapon"; weaponId: string; ammo?: string }
  | { op: "mission-progress"; key: string; value: number | string | boolean }
  | { op: "flag"; key: string; value: boolean }
  | { op: "if-flag"; key: string; value: boolean; success: FearOperation[]; failure?: FearOperation[] }
  | { op: "event-end" }
  | { op: "whispering-presence"; randomEncounterTable: string }
  | { op: "ghost-librarian"; exorcismSkillId: string; bookItemIds: string[] }
  | { op: "bright-apparition"; exorcismSkillId: string }
  | { op: "mirina-encounter"; exorcismSkillId: string }
  | { op: "mirina-human-contact"; contact: "old-man" | "chained-girl" }
  | { op: "start-combat"; enemyId: string; count: number | string }
  | { op: "upyr-encounter" }
  | { op: "vetala-encounter" }
  | { op: "start-combat-groups"; groups: Array<{ enemyId: string; count: number | string }>; escapeAfter?: { enemyId: string; defeated: number } }
  | { op: "roll-check"; context: string; level: number; enemyId?: string; success?: FearOperation[]; failure?: FearOperation[]; successAfter?: number; successBefore?: number; explode?: boolean; requiredSkill?: string; bonus?: number }
  | { op: "roll-check-count"; context: string; level: number; count: number | string; enemyId?: string; requiredSkill?: string; failure: FearOperation[] }
  | { op: "repeat-check"; context: string; level: number; requiredSkill?: string; success?: FearOperation[]; failure?: FearOperation[] }
  | { op: "probability"; numerator: number; denominator: number; success: FearOperation[]; failure?: FearOperation[] }
  | { op: "injury-check"; kind: "life" | "sanity"; amount: number; tableId: string }
  | { op: "search-loot-choice"; tableIds: string[]; alternative: "clue" }
  | { op: "event-branch"; eventId: string; ifPlayed: FearOperation[]; ifNew: FearOperation[] }
  | { op: "optional-safehouse"; threshold: "after-create-3" | "before-create-3"; restoreLife: number; restoreSanity: number }
  | { op: "rest-choice"; life: number; sanity: number }
  | { op: "choose-reward"; options: string[] }
  | { op: "choose-item"; options: string[] }
  | { op: "discard-choice"; excludedItemIds: string[]; excludedTags: string[]; excludedWeaponIds: string[] }
  | { op: "choose-effect"; prompt: string; choices: Record<string, FearOperation[]> }
  | { op: "hell-gate"; skillId: string; level: number; rewardSanity: number; skipEncounters: number }
  | { op: "search-bonus-choice"; modifier: number }
  | { op: "clinic-search-choice"; searches: number; thenStealthL: number; failureTable: string; clueFearL: number }
  | { op: "farm-food-or-search"; food: string; choices: string[] }
  | { op: "farmer-choice"; foodOptions: string[]; lootTables: string[]; thenFight: boolean }
  | { op: "conditional-skill-purchase"; skillId: string; xp: number; probability: [number, number]; onFind: FearOperation[]; extraProbability: [number, number]; extraTable: string }
  | { op: "roll-table"; tableId: string }
  | { op: "choose-table"; tableIds: string[] }
  | { op: "climb-for-loot"; tableIds: string[]; level: number; skillId: string }
  | { op: "sewer-shelter"; enemyId: string }
  | { op: "mark-gate" }
  | { op: "mark-safehouse"; threshold: "after-create-3" | "before-create-3"; restoreLife?: number; restoreSanity?: number; visitHealLife?: number; visitHealSanity?: number }
  | { op: "unique-event"; eventId: string }
  | { op: "route"; scene: FearSceneRef };

export type FearDefinition = {
  format: "aaf-fear-definition@1";
  source: { pdfSha256: string; pages: number };
  map: {
    boxesPerSheet: 30;
    rows: 6;
    columns: 5;
    adjacency: "orthogonal" | "diagonal";
    topologyBasis?: "source-verified" | "web-adaptation";
    start: { sheet: number; box: number };
    safehouseLimit: 3;
    safehouseLifetime: "nearest-first";
  };
  rules: {
    foodEveryBoxes: 5;
    townExplorationTable: string;
    randomEncounterTable: string;
    usefulItemTable: string;
    randomItemTable: string;
    startingEquipmentTables?: { randomWeapon: string; randomObject: string; usefulItem: string };
    maxScars: 3;
    maxTraumas: 3;
    searchOncePerBox: true;
    exploredAreaEncounter: { numerator: 1; denominator: 6 };
    sixExplodes: true;
    naturalOneFails: true;
    naturalSixSucceeds: true;
  };
  sceneRefs: {
    entry: FearSceneRef;
    exploration: FearSceneRef;
    missions: FearSceneRef;
    specialEvents: Record<string, FearSceneRef>;
    tables: Record<string, FearSceneRef>;
    events: Record<string, FearSceneRef>;
    endings: Record<string, FearSceneRef>;
  };
  /** Source scene programs, split from translated/source prose fragments. */
  eventPrograms: Record<string, FearOperation[]>;
  skills: Record<string, { label: string; xp: number; kind?: "skill" | "arcane"; modifiers: Record<string, [number, number]>; foodEveryBoxes?: [number, number]; maxHpChange?: [number, number]; maxSanityChange?: [number, number]; capacityBonus?: [number, number]; clueDiscount?: [number, number]; startingWeapons?: string[]; startingItems?: string[]; startingAmmo?: Record<string, string> }>;
  arcaneLearning?: Record<string, { sources?: Array<{ itemId: string; requiredSkill?: string; requiredSkillLevel?: 1 | 2; sanityLoss?: "temporary" | "permanent" }>; gateAtLocation?: { clues: number; requiredSkill: string; timeBoxes?: 0 | "D3" }; timeBoxes: 0 | "D3"; expert: boolean; sourceCondition?: "not-printed" }>;
  weapons: Record<string, { label: string; damage: number; ammoType?: string; ammoPerAttack?: number; attacks?: number; modifier?: number; tags?: string[] }>;
  enemies: Record<string, { label: string; level: number; life: number; lifeMode?: "player-max" | "infinite"; damage: number; damageBasis?: "source" | "user-authorized-web-adaptation"; damageResource?: "hp" | "sanity"; defenseContext?: string; naturalOneDamage?: number; fleeAtLife?: number; fleeChance?: [number, number]; holyWaterDamage?: number; surprise?: number; surpriseByLocation?: Record<string, number>; attackBounceChance?: [number, number]; hitIgnoreChance?: [number, number]; escapeModifier?: number; escapeBait?: { itemIds?: string[]; food?: number; bonus: number }; infectionChance?: [number, number]; infectionTrigger?: "defense-failure" | "combat-end-after-damage"; infectionSave?: { level: number; requiredSkill: string; context: "infection-save"; trigger: "natural-one"; failureDamagePerBox: number }; infectionDamage?: number; noEscape?: boolean; attackModifiers?: Array<{ weaponTag: string; amount: number }>; immuneWeaponTags?: string[]; unarmedHitDamage?: number; fearSave?: { level: number; context: "fear-save"; sanityLoss: number }; tags?: string[]; immunity?: string[]; scene?: FearSceneRef; familyRule?: "alien-gray" | "alien-hunter" | "alien-beast" | "reptilian" | "mi-go" | "tentacled-beast" | "blob" | "murdering-robot" | "mutant" | "doppelganger" | "tentacled-horror" | "giant-bug" | "vivina" | "muama" | "maraya" | "azolina" | "kalina"; specialRule?: "demon-cat" | "tickling-ghost" | "doppelganger" | "pied-piper" | "demon-dog" | "witch-librarian" | "zombie-tiger" | "brain-eaters" | "zombie-squirrels" | "zombie-pet" | "zombie-friend" | "zombie-abomination" | "vampire-vehn" | "vampire-wurdalak" | "vampire-kempir" | "vampire-midnight-man" | "vampire-vetala" | "demon-child" | "demonic-goat" | "night-shadow" }>;
  items?: Record<string, { label: string; tags?: string[]; weightless?: boolean; carriedWeight?: number }>;
  injuries?: Record<string, { label: string; tableRoll?: number; modifiers?: Record<string, number>; flags?: string[] }>;
  traumas?: Record<string, { label: string; tableRoll?: number; modifiers?: Record<string, number>; flags?: string[]; foodEveryBoxes?: number; maxSanityChange?: number; escapeBelowLife?: number }>;
  tables: Record<string, FearTable>;
  missions: Record<string, { label: string; goal: string; kind?: "medical-supplies" | "hunt-target" | "bring-food" | "bring-weapons" | "witches" | "hell-gates"; target?: number | string; targetTable?: string; reward?: { xp?: number; itemRolls?: number }; scene?: FearSceneRef }>;
  gates: { required: 7; scene?: FearSceneRef; level: number };
};

export type FearMapBox = {
  id: string;
  sheet: number;
  box: number;
  row: number;
  column: number;
  visit: number;
  visited: boolean;
  searched: boolean;
  searchesMade?: number;
  searchesAllowed?: number;
  /** The source prohibits searching a box after fleeing its encounter. */
  searchForbidden?: boolean;
  safehouse: boolean;
  safehouseHealLife?: number;
  safehouseHealSanity?: number;
  entryFoodCost?: number;
  retiredSafehouse?: boolean;
  storageTheftResolved?: boolean;
  occupiedBy?: string[];
  /** Exact encounter state preserved when its creature was fled; resumed after a failed revisit Stealth check. */
  occupiedEncounter?: FearCombat;
  scene?: FearSceneRef;
  locationType?: string;
  storedItems?: Record<string, number>;
};

export type FearCombat = {
  enemyId: string;
  sourceTurnCheckRound?: number;
  knockedDown?: boolean;
  count: number;
  defeatedCount: number;
  enemyLevel: number;
  enemyLife: number;
  enemyLives: number[];
  groups?: Array<{ enemyId: string; enemyLives: number[]; defeatedCount: number; sleepingCount?: number; specialRule?: FearCombat["specialRule"]; familyRule?: FearCombat["familyRule"]; familyState?: FearCombat["familyState"]; sourceTurnCheckRound?: number }>;
  firstAttackSpellPending?: boolean;
  /** Number of frontmost living creatures in this group put to sleep by Hypnos. */
  sleepingCount?: number;
  escapeAfter?: { enemyId: string; defeated: number };
  enemyDamage: number;
  damageResource?: "hp" | "sanity";
  defenseContext?: string;
  round: number;
  playerFirst: boolean;
  surprise: boolean;
  weaponId: string;
  attackDisabled: boolean;
    specialRule?: "demon-cat" | "tickling-ghost" | "doppelganger" | "pied-piper" | "demon-dog" | "witch-librarian" | "zombie-tiger" | "brain-eaters" | "zombie-squirrels" | "zombie-pet" | "zombie-friend" | "zombie-abomination" | "vampire-vehn" | "vampire-wurdalak" | "vampire-kempir" | "vampire-midnight-man" | "vampire-vetala" | "demon-child" | "demonic-goat" | "night-shadow";
  familyRule?: "alien-gray" | "alien-hunter" | "alien-beast" | "reptilian" | "mi-go" | "tentacled-beast" | "blob" | "murdering-robot" | "mutant" | "doppelganger" | "tentacled-horror" | "giant-bug" | "vivina" | "muama" | "maraya" | "azolina" | "kalina";
  familyState?: { tentacles?: number; acidSplashPending?: boolean; disabled?: boolean; robotAutoHitNext?: boolean; tentacledEscapeLocked?: boolean; tentacledHitsThisRound?: number; azolinaDrainActive?: boolean; azolinaDefensePassed?: boolean; azolinaWillPassed?: boolean; kalinaAlive?: boolean; dinosaurAlive?: boolean; marayaFireWounded?: boolean; marayaFireDamage?: number; attackTarget?: string; intruderPresent?: boolean; intruderEnemyId?: string; intruderEnemyIds?: string[]; vivinaRequested?: string; eyeWounds?: number; flyingBug?: boolean; psionic?: boolean; alienRaygunBroken?: boolean; targetLifeBeforeTurn?: number };
  escapeModifier?: number;
  wolfForm?: boolean;
  grappled?: boolean;
  vetalaHealPending?: number;
  vampireSuckAttack?: boolean;
  /** Per-encounter level reductions installed by a fired Curse. */
  curseApplied?: Record<string, number>;
  damageDealtThisEncounter?: number;
  mirinaCompelled?: boolean;
  fleeCheckResolved?: boolean;
  pending?: "double-one" | "switch-weapon" | "escape" | "skip-attack";
  /** Dodge's printed natural-1 consequence: -1 to the next attack in this combat. */
  dodgePenaltyPending?: boolean;
  /** Prevents a multi-group or multi-hit encounter from awarding its default XP more than once. */
  xpAwarded?: boolean;
  damageTakenThisEncounter?: boolean;
  vampireTurnAttempts?: string[];
  /** Items already used for the ordinary Vampire table's separate 3-in-6 confrontation. */
  vampireConfrontAttempts?: string[];
  /** Mission 5's once-per-combat-turn L5 Will save. */
  witchWillRound?: number;
  /** Mission 5: the Coven target was incapacitated non-lethally. */
  capturedWitch?: boolean;
  /** A failed Exorcism against a demon makes its next attack undefendable. */
  cannotDefendNextAttack?: boolean;
  /** Brain Eaters prevent escape after their natural-one defense grab until two or fewer remain. */
  escapeBlockedUntilReduce?: boolean;
  /** The Zombie Squirrel Horde owes its once-per-enemy-turn 2-in-6 loss check. */
  hordeLossPending?: boolean;
  willCheckRound?: number;
  /** Failed control roll: the summoned creature attacks with no escape option. */
  hostileServitor?: boolean;
};

export type FearState = {
  nodeId: FearSceneRef;
  status: "active" | "dead" | "insane" | "won";
  mapSheets: { sheet: number; boxes: FearMapBox[] }[];
  currentBoxId: string;
  startingBoxId: string;
  visitCount: number;
  safehouseIds: string[];
  mapLinks: Record<string, string[]>;
  skipNextAttack: boolean;
  skipEncounters: number;
  encounterCurse: number;
  inventory: Record<string, number>;
  readBooks: string[];
  /** Books already found in this game, including ones later lost or consumed. */
  booksFound?: string[];
  /** Source form of each carried book when a result distinguishes a printout from an ordinary book roll. */
  bookSources?: Record<string, "random-book" | "computer-printout">;
  hypnosLearned?: boolean;
  hypnosUsed?: boolean;
  startingBooksRead: boolean;
  ammo: Record<string, number>;
  /** Silver ammunition is tracked separately from ordinary rounds for the selected firearm type. */
  silverAmmo?: Record<string, number>;
  /** Weapon IDs are physical instances; identical weapon types may repeat and share that type's ammunition pool. */
  weaponIds: string[];
  /** Counted alien-raygun instances; broken guns remain owned and occupy a carried-weapon slot. */
  rayguns?: { owned: number; broken: number };
  weaponId: string;
  hp: number;
  maxHp: number;
  sanity: number;
  maxSanity: number;
  food: number;
  clues: number;
  xp: number;
  elapsedTimeBoxes: number;
  luck: number;
  hellChainHits?: number;
  foretoldTownEntry?: { roll: number; entry: FearTableEntry };
  preparedCurse?: { target: string; reduction: 1 | 2 };
  skills: Record<string, 0 | 1 | 2>;
  arcaneSkills: Record<string, 0 | 1 | 2>;
  scars: string[];
  traumas: string[];
  missionId: string;
  previousMissionId?: string;
  completedMissions: string[];
  missionFinished: boolean;
  missionProgress: Record<string, number | string | boolean>;
  missionRules?: FearMissionState;
  missionFood: number;
  missionFoodTarget: number;
  /** First Aid eligibility and per-encounter use survive the combat result until a new encounter begins. */
  lifeLostThisEncounter?: boolean;
  firstAidUsedThisEncounter?: boolean;
  gatesClosed: number;
  defeated: string[];
  /** Campaign-wide vampire rules survive mission transitions. */
  vampiresEncounteredOnce?: string[];
  destroyedVampires?: string[];
  uniqueEventsPlayed: string[];
  resolvedEvents: string[];
  pendingEvent?: { eventId: string; alreadyPlayed: boolean; started: boolean; visitCount: number };
  deferredTables: string[];
  deferredOperations?: FearOperation[];
  combat?: FearCombat;
  combatResult?: { enemyId: string; outcome: "defeated" | "captured" | "fled" | "escaped"; groupDefeated?: Record<string, number>; xpAwarded?: boolean };
  ongoingChecks: Array<{ id: string; trigger: "move"; context: string; level: number; requiredSkill?: string; failure: FearOperation[]; success?: FearOperation[] }>;
  infections?: Array<{ id: string; enemyId: string; boxesRemaining: number; failureDamage?: number; untilSafeHouse?: boolean }>;
  pending?: { kind: string; options: string[]; data?: Record<string, unknown> };
  /** Accepted Food pickups that may still be converted to Salt, and unresolved Worship visit choices. */
  pendingSaltConversion?: number;
  pendingWorshipSymbols?: number;
  familyRewardQueue?: Array<{ kind: string; options: string[]; data?: Record<string, unknown> }>;
  /** Controlled summoned Servitor travels with the investigator until dismissal or 0 Life. */
  servitor?: { level: 2 | 4 | 6; life: number; maxLife: number; attackBonus: number; defenseBonus: number };
  witchKnots?: { total: number; used: number };
  /** The Abominion's three-box pursuit is persistent across mission changes. */
  abominationPursuit?: { active: boolean; boxesRemaining: number; escapesInRow: number; ended: boolean };
  vehnCharismaPenalty?: boolean;
  limpingUntilFullHeal?: boolean;
  foretellBonusUses?: number;
  log: string[];
};

export type FearDice = (min: number, maxExclusive: number) => number;
export type FearAction = {
  type: "move" | "locate-hunt-target" | "search" | "equip" | "switch-weapon" | "attack" | "craft-silver" | "servitor-attack" | "defend" | "escape" | "choose" | "resolve-event" | "rest" | "close-gate" | "end-mission" | "start-mission" | "learn-skill" | "learn-arcane" | "cast-arcane" | "fire-curse" | "use-item" | "store-item" | "retrieve-item" | "discard-item" | "exorcise" | "vampire-confront" | "summon-servitor" | "dismiss-servitor" | "break-grapple" | "stand-up" | "stay-down";
  target?: string;
  skill?: string;
  weapon?: string;
  choice?: string;
  amount?: number;
  /** Spend one Luck on exactly this Attack roll or one named enemy Defense roll. */
  luckRollIndex?: number;
  luckTarget?: string;
  holyBulletIndex?: number;
  /** Use one silver cartridge on exactly this Attack roll. */
  silverBulletIndex?: number;
  /** Source Mission 5 option: hand-to-hand attack with non-lethal intent at -2. */
  nonlethal?: boolean;
  /** Rifle's optional two-shot attack; source cost is exactly three Bullets total. */
  shots?: 2;
  /** Use one source-made silver cartridge rather than ordinary ammunition. */
  silver?: true;
};

export type FearStory = {
  rulesVersion: "aaf-solo@1";
  nodes: { id: string; sourceId?: string }[];
  fear: FearDefinition;
};

export type FearProjected = {
  nodeId: string;
  status: FearState["status"];
  currentBox: FearMapBox;
  mapSheets: { sheet: number; boxes: { id: string; sheet: number; box: number; row: number; column: number; visit: number; visited: boolean; searched: boolean; safehouse: boolean; storedItemCount?: number }[] }[];
  reachable: string[];
  hp: number;
  maxHp: number;
  sanity: number;
  maxSanity: number;
  food: number;
  foodCapacity: number;
  missionFood: number;
  missionFoodTarget: number;
  itemCapacity: number;
  clues: number;
  xp: number;
  elapsedTimeBoxes: number;
  luck: number;
  skills: { id: string; label: string; level: 0 | 1 | 2; kind: "skill" | "arcane" }[];
  inventory: Record<string, number>;
  ammo: Record<string, number>;
  silverAmmo: Record<string, number>;
  weapons: Array<{ id: string; label: string; count: number; ammo?: number; silverAmmo?: number; broken?: number }>;
  currentWeapon: { id: string; label: string; damage: number; ammo?: number; silverAmmo?: number };
  currentMission: { id: string; label: string; goal: string };
  scars: { id: string; label: string }[];
  traumas: { id: string; label: string }[];
  missionId: string;
  gatesClosed: number;
  combat?: FearCombat;
  servitor?: { level: 2 | 4 | 6; life: number; maxLife: number; attackBonus: number; defenseBonus: number };
  pending?: { kind: string; options: string[]; labels: Record<string, string>; prompt?: string };
  log: string[];
};

export type FearAvailableAction = { action: FearAction; label: string; hint?: string };
