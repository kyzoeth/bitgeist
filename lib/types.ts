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
