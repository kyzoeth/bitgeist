export type GhostKeyframe = [frame: number, worldX: number, worldY: number];

export type ConsoleSystemId = 'nes' | 'snes' | 'genesis' | 'gb' | 'gba';

export type RaceStatus =
  | 'booting'
  | 'pregame'
  | 'waiting'
  | 'countdown'
  | 'racing'
  | 'won'
  | 'error';

type RomProfileKind = 'exact-ram' | 'universal-oam';

export interface CustomSprintBounds {
  startWorldX: number;
  goalWorldX: number;
}

export interface GhostRun {
  id: string;
  slug: string;
  tag: string;
  romId: string;
  consoleSystem?: ConsoleSystemId;
  sprintId?: string;
  romTitle: string;
  timeMs: number;
  beatenCount: number;
  totalGhosts: number;
  emojiReceipt: string;
  frames: GhostKeyframe[];
  diedAtFrame?: number;
  color: string;
  createdAt: string;
  dailyNumber?: number;
  courseIndex?: number;
  startWorldX?: number;
  goalWorldX?: number;
  inputLog?: string;
  verified?: boolean;
  inputDigest?: string;
  parentSlug?: string;
}

export interface GhostSplitEntry {
  label: string;
  runnerMs: number;
  rivalMs: number | null;
  pbMs: number | null;
  deltaVsRivalMs: number | null;
  status: 'gold' | 'mint' | 'coral';
}

export interface RivalrySeriesSummary {
  playerTag: string;
  rivalTag: string;
  playerWins: number;
  rivalWins: number;
  totalBouts: number;
  parentSlug?: string | null;
}

export type ReplaySpeed = 1 | 0.5 | 0.25;

export interface LivePartyRunner {
  runnerId: string;
  tag: string;
  color: string;
  worldX: number;
  worldY: number;
  raceFrame: number;
  status: RaceStatus;
  finishTimeMs: number | null;
  updatedAtMs: number;
}

export interface LivePartyReaction {
  id: string;
  runnerId?: string;
  tag: string;
  emoji: string;
  createdAtMs: number;
}

export interface LivePartyLobbyState {
  roomCode: string;
  sprintId: string;
  romId: string;
  hostRunnerId: string;
  countdownStartAtMs: number | null;
  runners: LivePartyRunner[];
  reactions?: LivePartyReaction[];
  recommendedCourseIndex?: number | null;
}

export type RoomMedalTier = 'dev' | 'gold' | 'silver' | 'bronze' | 'none';

export interface RoomMedalInfo {
  tier: RoomMedalTier;
  emoji: string;
  label: string;
  nextTier?: Exclude<RoomMedalTier, 'none'>;
  nextEmoji?: string;
  nextLabel?: string;
  nextTargetMs?: number;
  msToNext?: number;
}

export interface MountainStandingEntry {
  rank: number;
  tag: string;
  crowns: number;
  roomsCleared: number;
  totalTimeMs: number;
  bestTimeMs: number;
}

export type ArcadeMutator = 'none' | 'mirror' | 'turbo';

export interface CustomKeyBindings {
  left: string;
  right: string;
  up: string;
  down: string;
  b: string;
  a: string;
  retry: string;
}

export interface PracticePinState {
  worldX: number;
  worldY: number;
  label: string;
  raceFrame?: number;
  elapsedMs?: number;
}

export interface TelemetryFrame {
  inGameplay: boolean;
  playerWorldX: number;
  playerWorldY: number;
  cameraX: number;
  cameraY?: number;
  facingLeft: boolean;
  isDead: boolean;
  reachedGoal: boolean;
  oamTile?: number;
  roomId?: number;
}

export interface TelemetryTrackerState {
  cameraX: number;
  cameraY?: number;
  oamX: number;
  oamY?: number;
  oamTile: number;
  animHoldFrames: number;
  hadGameplay: boolean;
  lastRoomId?: number;
  lastActiveInRoom?: boolean;
  missingSpriteFrames?: number;
  causalMoveFrames?: number;
  preGameFrames?: number;
  manualSyncUnlocked?: boolean;
  startPressedInPregame?: boolean;
  wramSample?: Uint8Array;
  wramStableFrames?: number;
}

export function createInitialTrackerState(): TelemetryTrackerState {
  return {
    cameraX: 0,
    cameraY: 0,
    oamX: 48,
    oamTile: -1,
    animHoldFrames: 0,
    hadGameplay: false,
  };
}

export interface RomProfile {
  romId: string;
  consoleSystem: ConsoleSystemId;
  sprintId: string;
  title: string;
  stageLabel: string;
  profileKind: RomProfileKind;
  startWorldX: number;
  goalWorldX: number;
  maxPxPerFrame: number;
  courseIndex?: number;
  worldIndex?: number;
  stageIndex?: number;
  startWarp?: number;
  goalWarps?: readonly number[];
  finishDeltaY?: number;
  dailyNumber?: number;
  extractTelemetry: (
    ram: Uint8Array,
    prev: TelemetryTrackerState,
    liveInputMask?: number
  ) => TelemetryFrame;
}

export interface StoredRomEntry {
  romId: string;
  consoleSystem?: ConsoleSystemId;
  fileName: string;
  title: string;
  bytes: Uint8Array;
  addedAt: number;
}

export interface FloatingPopup {
  id: number;
  worldX: number;
  worldY: number;
  text: string;
  bg: string;
  textColor: string;
  ttlMs: number;
  maxTtlMs: number;
}

export interface CustomRomSegment {
  id: string;
  romId: string;
  sprintId: string;
  code: string;
  name: string;
  startWorldX: number;
  goalWorldX: number;
  previewDataUrl?: string;
  createdAt: number;
}

export interface ArcadeIdentityInfo {
  tag: string | null;
  tagSlug: string | null;
  claimed: boolean;
  ownedBySession: boolean;
  claimKey?: string | null;
  streakCount: number;
  lastDailyNumber: number | null;
}
