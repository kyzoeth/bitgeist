'use client';

import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import type { Nostalgist } from 'nostalgist';
import GhostCanvasOverlay, {
  computeGhostSplitDeltaSec,
  interpolateGhostPosInto,
  InterpolatedPos,
  LiveOverlayState,
} from './GhostCanvasOverlay';
import CrtTransitionOverlay, { CrtTransitionHandle } from './CrtTransitionOverlay';
import VictoryShareModal from './VictoryShareModal';
import RomVaultModal from './RomVaultModal';
import LeaderboardDrawer, { RivalSelectionMode } from './LeaderboardDrawer';
import SprintLevelCarousel, {
  buildCartridgeCarouselSlots,
  findActiveCelesteSlotIndex,
  SegmentCreatorStep,
} from './SprintLevelCarousel';
import {
  ConsoleControlDeck,
  MobileThumbChordControls,
  MusicStatusIcon,
  RestartIcon,
  SprintBottomBannerTrack,
} from './HardwareSkinControls';
import {
  getDailySprintForDate,
  getLocalDailyPbMs,
  getLocalSprintPbMs,
  recordLocalDailyPbMs,
  recordLocalSprintPbMs,
} from '@/lib/dailySprints';
import { GamepadPoller } from '@/lib/gamepadBridge';
import { buildEmojiRaceReceipt, sanitizeArcadeTag } from '@/lib/ghostShare';
import {
  CELESTE_GBA_ROM_ID,
  findBuiltinCartridgeByRomId,
  HOMEBREW_CARTRIDGES,
  HomebrewCartridgeSpec,
} from '@/lib/homebrewCatalog';
import {
  expandInputLogToFrameMasks,
  InputLogRecorder,
  NES_INPUT_A,
  NES_INPUT_B,
  NES_INPUT_DOWN,
  NES_INPUT_LEFT,
  NES_INPUT_RIGHT,
  NES_INPUT_SELECT,
  NES_INPUT_START,
  NES_INPUT_UP,
  NES_MASK_BUTTON_ENTRIES,
} from '@/lib/inputReplay';
import { getLocalPbGhost, saveLocalPbGhostIfFaster } from '@/lib/localPbGhosts';
import {
  getNesRamView,
  getSystemRamView,
  locateSystemRamRegion,
  SystemRamRegion,
} from '@/lib/nesRamBridge';
import {
  getMusicMuted,
  playCountdownTickSfx,
  playCrownOvertakeSfx,
  playDeathResetSfx,
  playGoalFanfareSfx,
  playLevelStepSfx,
  playRaceStartSfx,
  playScreenWipeSfx,
  playSplitCheckpointSfx,
  setMusicMuted,
  setSfxMuted,
} from '@/lib/retroAudio';
import {
  applyCustomSprintBounds,
  CELESTE_ROM_ID,
  createCelesteCourseProfile,
  createCelesteGbaCourseProfile,
  createDailyDefaultProfile,
  createDailyDefaultProfileByNumber,
  createNovaCourseProfile,
  DEFAULT_ROM_ID,
  getVaultStateKeyForProfile,
  NOVA_ROM_ID,
  resolveRomProfile,
  TWIN_DRAGONS_ROM_ID,
} from '@/lib/romProfiles';
import { detectRomPatchFormat } from '@/lib/romPatcher';
import {
  deleteCustomSegmentFromVault,
  deleteRomFromVault,
  getCustomSprintBoundsFromVault,
  getRomFromVault,
  getStartStateFromVault,
  listCustomSegmentsForRom,
  listVaultRoms,
  saveCustomSegmentToVault,
  saveCustomSprintBoundsToVault,
  savePatchedRomToVault,
  saveRomToVault,
  saveStartStateToVault,
} from '@/lib/romVault';
import {
  ArcadeIdentityInfo,
  ArcadeMutator,
  ConsoleSystemId,
  createInitialTrackerState,
  CustomRomSegment,
  CustomSprintBounds,
  GhostKeyframe,
  GhostRun,
  LivePartyLobbyState,
  MountainStandingEntry,
  PracticePinState,
  RaceStatus,
  ReplaySpeed,
  RivalrySeriesSummary,
  RomProfile,
  StoredRomEntry,
  TelemetryTrackerState,
} from '@/lib/types';
import { FinalizedVideoClip, VideoClipRecorder } from '@/lib/videoClipRecorder';

interface BitgeistArenaProps {
  initialTargetGhost: GhostRun | null;
  dareSlug?: string;
  initialDailyNumber?: number;
}

function subscribeViewportResize(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('resize', onStoreChange);
  return () => window.removeEventListener('resize', onStoreChange);
}

const LOGO_BLOCKS = [
  { ch: 'B', bg: '#F2545B' },
  { ch: 'I', bg: '#F7882F' },
  { ch: 'T', bg: '#F7C331' },
  { ch: 'G', bg: '#6BCB77' },
  { ch: 'E', bg: '#4ECDC4' },
  { ch: 'I', bg: '#45B7D1' },
  { ch: 'S', bg: '#9B5DE5' },
  { ch: 'T', bg: '#F15BB5' },
];

const ALT_KEY_MAP: Record<string, string> = {
  KeyD: 'right',
  KeyA: 'left',
  KeyW: 'up',
  KeyS: 'down',
  KeyX: 'a',
  KeyK: 'a',
  ShiftLeft: 'b',
  KeyJ: 'b',
  Backspace: 'select',
};

const NATIVE_KEY_MASK_MAP: Record<string, number> = {
  ArrowRight: NES_INPUT_RIGHT,
  ArrowLeft: NES_INPUT_LEFT,
  ArrowDown: NES_INPUT_DOWN,
  ArrowUp: NES_INPUT_UP,
  Space: NES_INPUT_A,
  KeyZ: NES_INPUT_B,
  Enter: NES_INPUT_START,
  ShiftRight: NES_INPUT_SELECT,
};

const NATIVE_KEY_BUTTON_MAP: Record<string, string> = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowUp: 'up',
  Space: 'a',
  KeyZ: 'b',
  Enter: 'start',
  ShiftRight: 'select',
};

const BUTTON_NAME_TO_MASK: Record<string, number> = {
  right: NES_INPUT_RIGHT,
  left: NES_INPUT_LEFT,
  down: NES_INPUT_DOWN,
  up: NES_INPUT_UP,
  a: NES_INPUT_A,
  b: NES_INPUT_B,
  start: NES_INPUT_START,
  select: NES_INPUT_SELECT,
};

const RACE_TRIGGER_CODES = new Set([
  'ArrowRight',
  'ArrowLeft',
  'ArrowUp',
  'ArrowDown',
  'Space',
  'KeyZ',
  'Enter',
  'ShiftRight',
  ...Object.keys(ALT_KEY_MAP),
]);

function isAttractTakeoverKey(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  if (RACE_TRIGGER_CODES.has(e.code)) return true;
  if (
    e.code === 'Tab' ||
    e.code === 'CapsLock' ||
    e.code === 'Escape' ||
    e.code === 'KeyM' ||
    e.code === 'KeyR' ||
    e.code === 'ContextMenu' ||
    e.code.startsWith('Meta') ||
    e.code.startsWith('Control') ||
    e.code.startsWith('Alt') ||
    e.code === 'ShiftRight' ||
    /^F\d+$/.test(e.code)
  ) {
    return false;
  }
  return true;
}

interface AttractReplayCandidate {
  ghost: GhostRun;
  masks: Uint8Array;
  isDare: boolean;
}

function pickAttractReplayCandidate(
  target: GhostRun | null,
  profile: RomProfile,
  dareSlugValue?: string
): AttractReplayCandidate | null {
  if (!target || !target.inputLog || target.diedAtFrame !== undefined) return null;
  if (target.romId !== profile.romId) return null;
  if (target.sprintId && profile.sprintId && target.sprintId !== profile.sprintId) return null;
  if (
    typeof profile.courseIndex === 'number' &&
    typeof target.courseIndex === 'number' &&
    target.courseIndex !== profile.courseIndex
  ) {
    return null;
  }
  if (
    typeof target.startWorldX === 'number' &&
    Math.abs(target.startWorldX - profile.startWorldX) > 48
  ) {
    return null;
  }
  if (
    typeof target.goalWorldX === 'number' &&
    Math.abs(target.goalWorldX - profile.goalWorldX) > 96
  ) {
    return null;
  }
  const masks = expandInputLogToFrameMasks(target.inputLog);
  if (!masks || masks.length < 30) return null;

  return {
    ghost: target,
    masks,
    isDare: Boolean(dareSlugValue),
  };
}

function setCoreVolumeDb(instance: Nostalgist, db: number) {
  try {
    const mod = instance.getEmscriptenModule() as unknown as {
      _cmd_set_volume?: (volumeDb: number) => void;
    };
    mod?._cmd_set_volume?.(db);
  } catch {
    // Non-fatal if core audio driver is not initialized yet
  }
}

interface InternalNostalgistEmulator {
  gameStatus?: 'paused' | 'running' | 'initial' | 'terminated';
  pause?: () => void;
  resume?: () => void;
  sendCommand?: (msg: string) => void;
}

/**
 * Replaces Nostalgist's default `_cmd_toggle_pause()` (`PAUSE_TOGGLE`) in `emulator.pause()` and
 * `emulator.resume()` with RetroArch's idempotent `_cmd_pause()` (`CMD_EVENT_PAUSE`) and
 * `_cmd_unpause()` (`CMD_EVENT_UNPAUSE`) exports so rapid transitions can never invert pause state.
 */
function patchDeterministicPauseResume(instance: Nostalgist): void {
  try {
    const em = (instance as unknown as { getEmulator?: () => InternalNostalgistEmulator }).getEmulator?.();
    const mod = instance.getEmscriptenModule() as unknown as {
      _cmd_pause?: () => void;
      _cmd_unpause?: () => void;
    };
    if (!em || !mod) return;
    em.pause = () => {
      if (typeof mod._cmd_pause === 'function') {
        mod._cmd_pause();
      } else {
        em.sendCommand?.('PAUSE_TOGGLE');
      }
      em.gameStatus = 'paused';
    };
    em.resume = () => {
      if (typeof mod._cmd_unpause === 'function') {
        mod._cmd_unpause();
      } else {
        em.sendCommand?.('PAUSE_TOGGLE');
      }
      em.gameStatus = 'running';
    };
  } catch {
    // Non-fatal fallback
  }
}

function pauseCore(instance: Nostalgist | null): void {
  if (!instance) return;
  try {
    const mod = instance.getEmscriptenModule() as unknown as { _cmd_pause?: () => void };
    const em = (instance as unknown as { getEmulator?: () => InternalNostalgistEmulator }).getEmulator?.();
    if (typeof mod?._cmd_pause === 'function') {
      mod._cmd_pause();
      if (em) em.gameStatus = 'paused';
    } else if (instance.getStatus() === 'running') {
      instance.pause();
    }
  } catch {
    // Ignore if instance was exited
  }
}

function resumeCore(instance: Nostalgist | null): void {
  if (!instance) return;
  try {
    const mod = instance.getEmscriptenModule() as unknown as { _cmd_unpause?: () => void };
    const em = (instance as unknown as { getEmulator?: () => InternalNostalgistEmulator }).getEmulator?.();
    if (typeof mod?._cmd_unpause === 'function') {
      mod._cmd_unpause();
      if (em) em.gameStatus = 'running';
    } else if (instance.getStatus() === 'paused') {
      instance.resume();
    }
  } catch {
    // Ignore if instance was exited
  }
}

function storedEntryToBlob(entry: StoredRomEntry): Blob {
  const copy = new Uint8Array(entry.bytes.byteLength);
  copy.set(entry.bytes);
  return new Blob([copy.buffer], { type: 'application/octet-stream' });
}

const DEFAULT_CART_FILENAME = 'celeste.nes';
const DEFAULT_CART_URL = '/roms/celeste.nes';
const EMPTY_RAM_VIEW = new Uint8Array(0);

function resolveNostalgistCore(consoleSystem: ConsoleSystemId) {
  if (consoleSystem === 'snes') return 'snes9x';
  if (consoleSystem === 'genesis') return 'genesis_plus_gx';
  if (consoleSystem === 'gb') {
    return {
      name: 'gambatte',
      js: '/cores/gambatte_libretro.js',
      wasm: '/cores/gambatte_libretro.wasm',
    };
  }
  if (consoleSystem === 'gba') {
    return {
      name: 'mgba',
      js: '/cores/mgba_libretro.js',
      wasm: '/cores/mgba_libretro.wasm',
    };
  }
  return {
    name: 'fceumm',
    js: '/cores/fceumm_libretro.js',
    wasm: '/cores/fceumm_libretro.wasm',
  };
}

function ensurePreserveDrawingBuffer(canvasEl: HTMLCanvasElement): void {
  const flagged = canvasEl as HTMLCanvasElement & { __bgPreservePatched?: boolean };
  if (flagged.__bgPreservePatched) return;
  flagged.__bgPreservePatched = true;
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  canvasEl.getContext = function (this: HTMLCanvasElement, contextId: string, options?: unknown) {
    if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') {
      const merged =
        options && typeof options === 'object'
          ? { ...(options as Record<string, unknown>), preserveDrawingBuffer: true }
          : { preserveDrawingBuffer: true };
      return origGetContext.call(this, contextId, merged as CanvasRenderingContext2DSettings);
    }
    return origGetContext.call(this, contextId, options as CanvasRenderingContext2DSettings);
  } as typeof canvasEl.getContext;
}

function snapCanvasThumbnailDataUrl(canvasEl: HTMLCanvasElement | null): string | undefined {
  if (!canvasEl || typeof document === 'undefined') return undefined;
  try {
    const thumb = document.createElement('canvas');
    thumb.width = 256;
    thumb.height = 240;
    const ctx = thumb.getContext('2d');
    if (!ctx) return undefined;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvasEl, 0, 0, 256, 240);
    return thumb.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

function ensureRomExtension(fileName: string, consoleSystem: ConsoleSystemId): string {
  if (/\.(nes|sfc|smc|md|gen|bin|gb|gbc|gba)$/i.test(fileName)) {
    return fileName;
  }
  const fallbackExt: Record<ConsoleSystemId, string> = {
    nes: '.nes',
    snes: '.sfc',
    genesis: '.md',
    gb: '.gb',
    gba: '.gba',
  };
  return `${fileName}${fallbackExt[consoleSystem]}`;
}

function buildInitialDefaultProfile(
  dareSlug: string | undefined,
  initialTargetGhost: GhostRun | null,
  initialDailyNumber: number | undefined
): RomProfile {
  if (dareSlug && initialTargetGhost && findBuiltinCartridgeByRomId(initialTargetGhost.romId)) {
    if (typeof initialTargetGhost.dailyNumber === 'number') {
      return createDailyDefaultProfileByNumber(initialTargetGhost.dailyNumber);
    }
    if (initialTargetGhost.romId === NOVA_ROM_ID) {
      return createNovaCourseProfile({
        courseIndex: initialTargetGhost.courseIndex,
        sprintId: initialTargetGhost.sprintId,
        stageLabelOverride: initialTargetGhost.romTitle,
      });
    }
    if (initialTargetGhost.romId === CELESTE_GBA_ROM_ID) {
      return createCelesteGbaCourseProfile({
        courseIndex: initialTargetGhost.courseIndex,
        sprintId: initialTargetGhost.sprintId,
        stageLabelOverride: initialTargetGhost.romTitle,
      });
    }
    return createCelesteCourseProfile({
      courseIndex: initialTargetGhost.courseIndex,
      sprintId: initialTargetGhost.sprintId,
      stageLabelOverride: initialTargetGhost.romTitle,
    });
  }
  if (typeof initialDailyNumber === 'number') {
    return createDailyDefaultProfileByNumber(initialDailyNumber);
  }
  return createDailyDefaultProfile();
}

export default function BitgeistArena({
  initialTargetGhost,
  dareSlug,
  initialDailyNumber,
}: BitgeistArenaProps) {
  const [bootDefaultProfile] = useState<RomProfile>(() =>
    buildInitialDefaultProfile(dareSlug, initialTargetGhost, initialDailyNumber)
  );

  const emulatorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const ghostOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRecorderRef = useRef<VideoClipRecorder>(new VideoClipRecorder());
  const nostalgistRef = useRef<Nostalgist | null>(null);
  const bootSeqRef = useRef<number>(0);
  const bootAbortRef = useRef<AbortController | null>(null);
  const ramRegionRef = useRef<SystemRamRegion | null>(null);
  const resetTickClockRef = useRef<boolean>(false);
  const checkpointBlobRef = useRef<Blob | null>(null);
  const profileRef = useRef<RomProfile>(bootDefaultProfile);
  const respawningRef = useRef<boolean>(false);
  const pendingResetRequestRef = useRef<{
    autoResume: boolean;
    opts?: {
      withDeathFlash?: boolean;
      replayMasks?: Uint8Array | null;
      attractCandidate?: AttractReplayCandidate | null;
      preserveHeldInputs?: boolean;
      startCountdown?: boolean;
      isManualRetry?: boolean;
    };
  } | null>(null);
  const recordedFramesRef = useRef<GhostKeyframe[]>([]);
  const raceElapsedMsRef = useRef<number>(0);
  const lastRecordedFrameRef = useRef<number>(-3);
  const trackerRef = useRef<TelemetryTrackerState>(createInitialTrackerState());
  const dragDepthRef = useRef<number>(0);

  // Independent input sources merged cleanly into Nostalgist virtual buttons & 60Hz RLE InputLogRecorder
  const heldAltKeyButtonsRef = useRef<Set<string>>(new Set());
  const heldTouchPadButtonsRef = useRef<Set<string>>(new Set());
  const heldNativeButtonsRef = useRef<Set<string>>(new Set());
  const heldGamepadButtonsRef = useRef<Set<string>>(new Set());
  const heldReplayButtonsRef = useRef<Set<string>>(new Set());
  const heldEffectiveButtonsRef = useRef<Set<string>>(new Set());
  const nativeKeysMaskRef = useRef<number>(0);
  const previewKeyMaskRef = useRef<number>(0);
  const touchPreviewMaskRef = useRef<number>(0);
  const gamepadMaskRef = useRef<number>(0);
  const gamepadPollerRef = useRef<GamepadPoller>(new GamepadPoller());
  const gamepadConnectedRef = useRef<boolean>(false);
  const gamepadBrandRef = useRef<string | null>(null);
  const gamepadLabelRef = useRef<string | null>(null);
  const inputRecorderRef = useRef<InputLogRecorder>(new InputLogRecorder());
  const replayFrameMasksRef = useRef<Uint8Array | null>(null);
  const emulatedCoreFrameRef = useRef<number>(0);
  const hasCoreFrameHookRef = useRef<boolean>(false);
  const lastAppliedReplayMaskRef = useRef<number>(-1);
  const awaitingAutoAttractForBootSeqRef = useRef<number>(0);
  const attractLoopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attractStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const irisOpenUntilMsRef = useRef<number>(0);
  const activeAttractCandidateRef = useRef<AttractReplayCandidate | null>(null);
  const pausedCoreFramesRef = useRef<number>(0);
  const lastObservedCoreFrameRef = useRef<number>(0);
  const pregameReadyFramesRef = useRef<number>(0);
  const pregameLockingRef = useRef<boolean>(false);
  const hasExplicitBoundsRef = useRef<boolean>(true);
  const lastRealRamMutationMsRef = useRef<number>(0);

  // Real-time Ghost Overtake, Finish Celebration & Floating Popup trackers
  const overtakenGhostIdsRef = useRef<Set<string>>(new Set());
  const prevPlayerWorldXRef = useRef<number>(bootDefaultProfile.startWorldX);
  const popupSeqRef = useRef<number>(0);
  const finishModalTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const countdownSeqRef = useRef<number>(0);

  const [activeProfile, setActiveProfile] = useState<RomProfile>(bootDefaultProfile);
  const [targetGhost, setTargetGhost] = useState<GhostRun | null>(initialTargetGhost);
  const [vaultRoms, setVaultRoms] = useState<StoredRomEntry[]>([]);

  const [raceStatus, setRaceStatus] = useState<RaceStatus>('booting');
  const [countdownDisplay, setCountdownDisplay] = useState<'3' | '2' | '1' | 'GO!' | null>(null);
  const [isAttractMode, setIsAttractMode] = useState<boolean>(false);
  const isAttractModeRef = useRef<boolean>(false);
  const [attractMeta, setAttractMeta] = useState<{
    tag: string;
    timeMs: number;
    isDare: boolean;
  } | null>(null);
  const [bootMessage, setBootMessage] = useState<string>(
    `WARMING CRT • ${bootDefaultProfile.stageLabel}...`
  );
  const [timerText, setTimerText] = useState<string>('00.00s');
  const [activeSegments, setActiveSegments] = useState<number>(1);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);
  const [isRomModalOpen, setIsRomModalOpen] = useState<boolean>(false);
  const [missingDareCartTitle, setMissingDareCartTitle] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [gamepadConnected, setGamepadConnected] = useState<boolean>(false);
  const [gamepadBrand, setGamepadBrand] = useState<string | null>(null);
  const [gamepadLabel, setGamepadLabel] = useState<string | null>(null);
  const [musicMuted, setMusicMutedState] = useState<boolean>(false);
  const musicMutedRef = useRef<boolean>(false);
  const [visualInputMask, setVisualInputMask] = useState<number>(0);
  const prevVisualMaskRef = useRef<number>(0);
  const [rivalInputMask, setRivalInputMask] = useState<number>(0);
  const prevRivalMaskRef = useRef<number>(0);
  const targetGhostMasksRef = useRef<Uint8Array | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState<boolean>(false);
  const showHowItWorksRef = useRef<boolean>(false);
  const [leaderboardRuns, setLeaderboardRuns] = useState<GhostRun[]>([]);
  const [mountainStandings, setMountainStandings] = useState<MountainStandingEntry[]>([]);
  const [leaderboardTotalRuns, setLeaderboardTotalRuns] = useState<number>(10);
  const [, setServerTopGhost] = useState<GhostRun | null>(initialTargetGhost);
  const serverTopGhostRef = useRef<GhostRun | null>(initialTargetGhost);
  const [localPbGhost, setLocalPbGhost] = useState<GhostRun | null>(null);
  const [rivalMode, setRivalMode] = useState<RivalSelectionMode>('top');
  const rivalModeRef = useRef<RivalSelectionMode>('top');
  const [identityInfo, setIdentityInfo] = useState<ArcadeIdentityInfo | null>(null);
  const [tagConflictMessage, setTagConflictMessage] = useState<string | null>(null);
  const [customSegments, setCustomSegments] = useState<CustomRomSegment[]>([]);
  const customSegmentsRef = useRef<CustomRomSegment[]>([]);
  const [segmentCreatorStep, setSegmentCreatorStep] = useState<SegmentCreatorStep>('idle');
  const segmentCreatorStepRef = useRef<SegmentCreatorStep>('idle');
  const [segmentDraftDistancePx, setSegmentDraftDistancePx] = useState<number>(0);
  const segmentDraftRef = useRef<{
    startWorldX: number;
    previewDataUrl?: string;
    startStateBlob: Blob;
  } | null>(null);
  const lastSplitRoomIdRef = useRef<number | null>(null);
  const crtTransitionRef = useRef<CrtTransitionHandle | null>(null);
  const [latestReplayClip, setLatestReplayClip] = useState<FinalizedVideoClip | null>(null);
  const [liveRank, setLiveRank] = useState<number>(1);
  const [topTimesBySprintId, setTopTimesBySprintId] = useState<Record<string, number>>(() =>
    !dareSlug && initialTargetGhost
      ? { [bootDefaultProfile.sprintId]: initialTargetGhost.timeMs }
      : {}
  );
  const [pbRevision, setPbRevision] = useState<number>(0);

  // Stage 6: 10-Ghost Swarm Toggle & Collapsible Side Sections
  const [swarmEnabled, setSwarmEnabled] = useState<boolean>(false);
  const [segmentCollapsed, setSegmentCollapsed] = useState<boolean>(false);
  const [topTenCollapsed, setTopTenCollapsed] = useState<boolean>(false);

  // Stage 7: 3-Room Daily Trifecta Relay Mode & Head-to-Head Rivalry Series
  const [relayModeEnabled, setRelayModeEnabled] = useState<boolean>(false);
  const relayModeEnabledRef = useRef<boolean>(false);
  const [relayLegIndex, setRelayLegIndex] = useState<number>(0);
  const relayLegIndexRef = useRef<number>(0);
  const relayLegTimesRef = useRef<number[]>([]);
  const [completedRelayLegsMs, setCompletedRelayLegsMs] = useState<number[] | null>(null);
  const [rivalrySeries, setRivalrySeries] = useState<RivalrySeriesSummary | null>(null);

  // Stage 8: Interactive Replay Studio (Speed, Pause/Step, & Instant Frame Takeover)
  const [isManualReplayActive, setIsManualReplayActive] = useState<boolean>(false);
  const [replayPaused, setReplayPaused] = useState<boolean>(false);
  const replayPausedRef = useRef<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1);
  const replaySpeedRef = useRef<ReplaySpeed>(1);
  const [replayProgress, setReplayProgress] = useState<{ frame: number; total: number }>({
    frame: 0,
    total: 0,
  });

  // Stage 9: Active Cartridge Bytes Reference for Client-Side .IPS / .BPS Patching
  const activeRomBytesRef = useRef<Uint8Array | null>(null);

  // Stage 10: Live Multi-Runner Party Heat Lobby
  const [selfRunnerId] = useState<string>(
    () => `r_${Math.random().toString(36).slice(2, 9)}`
  );
  const [partyLobby, setPartyLobby] = useState<LivePartyLobbyState | null>(null);
  const [partyCodeInput, setPartyCodeInput] = useState<string>('');
  const lastTriggeredLobbyCountdownRef = useRef<number | null>(null);
  const seenPartyReactionIdsRef = useRef<Set<string>>(new Set());

  // Stage 13: Arcade Mutators (Mirror Mode & 1.25x Turbo Overclock)
  const [activeMutator, setActiveMutator] = useState<ArcadeMutator>('none');
  const activeMutatorRef = useRef<ArcadeMutator>('none');

  // Stage 14: Instant Practice Save-Pin ([P] Drop Pin / [O] Warp to Pin)
  const [practicePin, setPracticePin] = useState<PracticePinState | null>(null);
  const practicePinBlobRef = useRef<Blob | null>(null);

  // Victory Modal State
  const [isVictoryOpen, setIsVictoryOpen] = useState<boolean>(false);
  const [finishStats, setFinishStats] = useState<{
    clientRunId: string;
    savedSlug?: string;
    initialSavedTag: string;
    timeMs: number;
    beatenCount: number;
    totalGhosts: number;
    emojiStrip: string;
    frames: GhostKeyframe[];
    inputLog: string;
    verified: boolean;
    racedTargetGhost: GhostRun | null;
  }>({
    clientRunId: '',
    savedSlug: undefined,
    initialSavedTag: 'PLAYER',
    timeMs: 11200,
    beatenCount: 1,
    totalGhosts: 1,
    emojiStrip: '⚡⚡⚡👑🏃💨🏁',
    frames: [],
    inputLog: '',
    verified: false,
    racedTargetGhost: initialTargetGhost,
  });

  const [playerTag, setPlayerTag] = useState<string>('PLAYER');

  // Refs synced with latest state for stable 60Hz RAF and capture-phase keyboard handlers
  const userAudioUnlockedRef = useRef<boolean>(false);
  const targetGhostRef = useRef<GhostRun | null>(targetGhost);
  const playerTagRef = useRef<string>(playerTag);
  const isVictoryOpenRef = useRef<boolean>(isVictoryOpen);
  const isRomModalOpenRef = useRef<boolean>(isRomModalOpen);

  useEffect(() => {
    targetGhostRef.current = targetGhost;
    targetGhostMasksRef.current = targetGhost?.inputLog
      ? expandInputLogToFrameMasks(targetGhost.inputLog)
      : null;
  }, [targetGhost]);

  useEffect(() => {
    playerTagRef.current = playerTag;
  }, [playerTag]);

  useEffect(() => {
    isVictoryOpenRef.current = isVictoryOpen;
  }, [isVictoryOpen]);

  useEffect(() => {
    isRomModalOpenRef.current = isRomModalOpen;
  }, [isRomModalOpen]);

  useEffect(() => {
    rivalModeRef.current = rivalMode;
  }, [rivalMode]);

  useEffect(() => {
    customSegmentsRef.current = customSegments;
  }, [customSegments]);

  useEffect(() => {
    segmentCreatorStepRef.current = segmentCreatorStep;
  }, [segmentCreatorStep]);

  useEffect(() => {
    relayModeEnabledRef.current = relayModeEnabled;
  }, [relayModeEnabled]);

  useEffect(() => {
    relayLegIndexRef.current = relayLegIndex;
  }, [relayLegIndex]);

  useEffect(() => {
    replayPausedRef.current = replayPaused;
  }, [replayPaused]);

  useEffect(() => {
    replaySpeedRef.current = replaySpeed;
  }, [replaySpeed]);

  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const helpPanelRef = useRef<HTMLElement | null>(null);
  const viewportKey = useSyncExternalStore(
    subscribeViewportResize,
    () => `${window.innerWidth}x${window.innerHeight}`,
    () => '1440x900'
  );

  useEffect(() => {
    showHowItWorksRef.current = showHowItWorks;
  }, [showHowItWorks]);

  useEffect(() => {
    if (!showHowItWorks) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (helpPanelRef.current?.contains(target)) return;
      if (helpButtonRef.current?.contains(target)) return;
      setShowHowItWorks(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [showHowItWorks]);

  const liveStateRef = useRef<LiveOverlayState>({
    raceStatus: 'booting',
    inGameplay: false,
    raceFrame: 0,
    playerWorldX: bootDefaultProfile.startWorldX,
    playerWorldY: 180,
    cameraX: 0,
    cameraY: 0,
    goalWorldX: bootDefaultProfile.goalWorldX,
    deathFlashFrames: 0,
    popups: [],
    isReplayingInputs: false,
    finishCelebration: null,
  });

  const clearPendingFinishModal = useCallback(() => {
    if (finishModalTimeoutRef.current !== null) {
      clearTimeout(finishModalTimeoutRef.current);
      finishModalTimeoutRef.current = null;
    }
    if (attractLoopTimeoutRef.current !== null) {
      clearTimeout(attractLoopTimeoutRef.current);
      attractLoopTimeoutRef.current = null;
    }
    if (attractStartTimeoutRef.current !== null) {
      clearTimeout(attractStartTimeoutRef.current);
      attractStartTimeoutRef.current = null;
    }
    countdownSeqRef.current++;
    if (countdownTimersRef.current.length > 0) {
      for (const timer of countdownTimersRef.current) {
        clearTimeout(timer);
      }
      countdownTimersRef.current = [];
    }
    setCountdownDisplay(null);
  }, []);

  const syncEffectiveVirtualButtons = useCallback((forceReassert = false) => {
    const instance = nostalgistRef.current;
    const desired = new Set<string>();
    if (liveStateRef.current.isReplayingInputs) {
      for (const b of heldReplayButtonsRef.current) desired.add(b);
    } else if (
      liveStateRef.current.raceStatus === 'racing' ||
      liveStateRef.current.raceStatus === 'pregame'
    ) {
      for (const b of heldAltKeyButtonsRef.current) desired.add(b);
      for (const b of heldTouchPadButtonsRef.current) desired.add(b);
      for (const b of heldNativeButtonsRef.current) desired.add(b);
      for (const b of heldGamepadButtonsRef.current) desired.add(b);
      if (activeMutatorRef.current === 'mirror') {
        const hasLeft = desired.has('left');
        const hasRight = desired.has('right');
        desired.delete('left');
        desired.delete('right');
        if (hasLeft) desired.add('right');
        if (hasRight) desired.add('left');
      }
    }

    const current = heldEffectiveButtonsRef.current;
    for (const existing of Array.from(current)) {
      if (!desired.has(existing)) {
        current.delete(existing);
        if (instance) {
          try {
            instance.pressUp(existing);
          } catch {
            // ignore
          }
        }
      }
    }
    for (const nextBtn of desired) {
      if (forceReassert || !current.has(nextBtn)) {
        current.add(nextBtn);
        if (instance) {
          try {
            instance.pressDown(nextBtn);
          } catch {
            // ignore
          }
        }
      }
    }
  }, []);

  const releaseAllVirtualButtons = useCallback(() => {
    heldAltKeyButtonsRef.current.clear();
    heldTouchPadButtonsRef.current.clear();
    heldNativeButtonsRef.current.clear();
    heldGamepadButtonsRef.current.clear();
    heldReplayButtonsRef.current.clear();
    lastAppliedReplayMaskRef.current = -1;
    nativeKeysMaskRef.current = 0;
    previewKeyMaskRef.current = 0;
    touchPreviewMaskRef.current = 0;
    gamepadMaskRef.current = 0;
    if (prevVisualMaskRef.current !== 0) {
      prevVisualMaskRef.current = 0;
      setVisualInputMask(0);
    }
    syncEffectiveVirtualButtons();
  }, [syncEffectiveVirtualButtons]);

  /**
   * Releases replay & pointer-touch latches on run restart while keeping physically held
   * keyboard/gamepad directions intact so holding `→` + tapping `R` launches on frame 0.
   */
  const releaseTransientVirtualButtons = useCallback(() => {
    heldTouchPadButtonsRef.current.clear();
    touchPreviewMaskRef.current = 0;
    heldReplayButtonsRef.current.clear();
    lastAppliedReplayMaskRef.current = -1;
    syncEffectiveVirtualButtons();
  }, [syncEffectiveVirtualButtons]);

  const setAltKeyVirtualButton = useCallback(
    (button: string, pressed: boolean) => {
      if (pressed) {
        heldAltKeyButtonsRef.current.add(button);
      } else {
        heldAltKeyButtonsRef.current.delete(button);
      }
      syncEffectiveVirtualButtons();
    },
    [syncEffectiveVirtualButtons]
  );

  const setTouchPadVirtualButton = useCallback(
    (button: string, pressed: boolean) => {
      if (pressed) {
        heldTouchPadButtonsRef.current.add(button);
      } else {
        heldTouchPadButtonsRef.current.delete(button);
      }
      syncEffectiveVirtualButtons();
    },
    [syncEffectiveVirtualButtons]
  );

  const getCurrentLiveInputMask = useCallback((): number => {
    let mask = nativeKeysMaskRef.current | gamepadMaskRef.current;
    for (const btn of heldAltKeyButtonsRef.current) {
      mask |= BUTTON_NAME_TO_MASK[btn] || 0;
    }
    for (const btn of heldTouchPadButtonsRef.current) {
      mask |= BUTTON_NAME_TO_MASK[btn] || 0;
    }
    return mask & 0xff;
  }, []);

  /**
   * Starts Arcade Attract Mode from the poised 00.00s starting line using the #1 speedrun
   * (or incoming dare target) inputLog. When an iris-open screen transition is in progress
   * (`delayMs > 0`), keeps the core paused on exact frame 0 until the reveal finishes so
   * characters never move while the screen is still opening.
   */
  const startAttractFromPoisedStart = useCallback(
    (candidate: AttractReplayCandidate, delayMs = 0) => {
      const instance = nostalgistRef.current;
      if (!instance || respawningRef.current) return;
      if (isRomModalOpenRef.current || isVictoryOpenRef.current) return;

      awaitingAutoAttractForBootSeqRef.current = 0;
      clearPendingFinishModal();
      const expectedBootSeq = bootSeqRef.current;

      const launchNow = () => {
        activeAttractCandidateRef.current = candidate;
        replayFrameMasksRef.current = candidate.masks;
        emulatedCoreFrameRef.current = 0;
        pausedCoreFramesRef.current = 0;
        lastObservedCoreFrameRef.current = 0;
        raceElapsedMsRef.current = 0;
        lastRecordedFrameRef.current = -3;
        recordedFramesRef.current = [];
        const nextTracker = createInitialTrackerState();
        nextTracker.manualSyncUnlocked = true;
        trackerRef.current = nextTracker;
        overtakenGhostIdsRef.current.clear();
        liveStateRef.current.popups.length = 0;
        liveStateRef.current.raceFrame = 0;
        liveStateRef.current.inGameplay = true;
        liveStateRef.current.finishCelebration = null;
        liveStateRef.current.isReplayingInputs = true;
        liveStateRef.current.isAttractReplay = true;
        liveStateRef.current.attractGhostId = candidate.ghost.id;
        liveStateRef.current.attractGhostTag = candidate.ghost.tag;
        liveStateRef.current.attractGhostTimeMs = candidate.ghost.timeMs;
        liveStateRef.current.attractIsDare = candidate.isDare;

        isAttractModeRef.current = true;
        setIsAttractMode(true);
        setAttractMeta({
          tag: candidate.ghost.tag,
          timeMs: candidate.ghost.timeMs,
          isDare: candidate.isDare,
        });
        setTimerText('00.00s');
        setActiveSegments(1);

        // Pre-assert frame 0 replay mask right before unpausing the core so frame 0 executes atomically
        const mask0 = candidate.masks[0] ?? 0;
        lastAppliedReplayMaskRef.current = mask0;
        heldReplayButtonsRef.current.clear();
        for (const [bit, btnName] of NES_MASK_BUTTON_ENTRIES) {
          if ((mask0 & bit) !== 0) {
            heldReplayButtonsRef.current.add(btnName);
          }
        }
        syncEffectiveVirtualButtons();

        // Keep auto-play Attract Mode silent by default until user gesture / explicit Sound toggle
        setCoreVolumeDb(
          instance,
          !userAudioUnlockedRef.current || musicMutedRef.current ? -80 : 0
        );
        liveStateRef.current.raceStatus = 'racing';
        setRaceStatus('racing');
        resetTickClockRef.current = true;
        lastRealRamMutationMsRef.current = performance.now();
        resumeCore(instance);
        syncEffectiveVirtualButtons(true);
      };

      if (delayMs > 0) {
        pauseCore(instance);
        attractStartTimeoutRef.current = setTimeout(() => {
          attractStartTimeoutRef.current = null;
          if (
            nostalgistRef.current !== instance ||
            bootSeqRef.current !== expectedBootSeq ||
            respawningRef.current ||
            liveStateRef.current.raceStatus !== 'waiting' ||
            isRomModalOpenRef.current ||
            isVictoryOpenRef.current ||
            segmentCreatorStepRef.current !== 'idle'
          ) {
            return;
          }
          launchNow();
        }, delayMs);
      } else {
        launchNow();
      }
    },
    [clearPendingFinishModal, syncEffectiveVirtualButtons]
  );

  /**
   * 3... 2... 1... GO! Pre-Race Countdown from the poised 00.00s starting line.
   * Uses a full 900ms per beat (after any post-iris reveal delay) while keeping the WASM core
   * paused at exact frame 0 so players can pre-hold Right/Run and launch on frame 0 at GO!.
   */
  const beginPreRaceCountdown = useCallback(
    (opts?: { initialDelayMs?: number; openIris?: boolean }) => {
      const instance = nostalgistRef.current;
      if (!instance) return;
      userAudioUnlockedRef.current = true;
      awaitingAutoAttractForBootSeqRef.current = 0;

      // Always clear any prior finish / attract / countdown timers unconditionally
      clearPendingFinishModal();

      activeAttractCandidateRef.current = null;
      isAttractModeRef.current = false;
      setIsAttractMode(false);
      setAttractMeta(null);

      pauseCore(instance);

      liveStateRef.current.isReplayingInputs = false;
      liveStateRef.current.isAttractReplay = false;
      liveStateRef.current.attractGhostId = null;
      liveStateRef.current.attractGhostTag = null;
      liveStateRef.current.attractGhostTimeMs = null;
      liveStateRef.current.attractIsDare = false;
      replayFrameMasksRef.current = null;
      emulatedCoreFrameRef.current = 0;
      pausedCoreFramesRef.current = 0;
      lastObservedCoreFrameRef.current = 0;
      raceElapsedMsRef.current = 0;
      liveStateRef.current.raceFrame = 0;
      liveStateRef.current.inGameplay = true;
      trackerRef.current.manualSyncUnlocked = true;
      recordedFramesRef.current = [];
      lastRecordedFrameRef.current = -3;
      inputRecorderRef.current.reset();
      overtakenGhostIdsRef.current.clear();
      lastSplitRoomIdRef.current = null;
      liveStateRef.current.popups.length = 0;
      prevPlayerWorldXRef.current = liveStateRef.current.playerWorldX;

      liveStateRef.current.raceStatus = 'countdown';
      setRaceStatus('countdown');
      syncEffectiveVirtualButtons();
      setTimerText('00.00s');
      setActiveSegments(1);
      setShowHowItWorks(false);

      if (opts?.openIris) {
        const focusX = Math.max(
          20,
          Math.min(
            236,
            Math.round(liveStateRef.current.playerWorldX - liveStateRef.current.cameraX + 7)
          )
        );
        const focusY = Math.max(
          20,
          Math.min(
            220,
            Math.round(
              liveStateRef.current.playerWorldY - (liveStateRef.current.cameraY || 0) - 8
            )
          )
        );
        crtTransitionRef.current?.playIrisOpen({
          focusX,
          focusY,
          accentColor: '#F5C342',
          durationMs: 1350,
        });
      }

      const STEP_MS = 900;
      const leadInMs = Math.max(0, opts?.initialDelayMs ?? 0);
      const seq = ++countdownSeqRef.current;
      const expectedBootSeq = bootSeqRef.current;
      const isCountdownActive = () =>
        countdownSeqRef.current === seq &&
        bootSeqRef.current === expectedBootSeq &&
        liveStateRef.current.raceStatus === 'countdown';

      const timers: ReturnType<typeof setTimeout>[] = [];

      if (leadInMs <= 0) {
        setCountdownDisplay('3');
        playCountdownTickSfx(3);
        gamepadPollerRef.current.pulseRumble('step');
      } else {
        setCountdownDisplay(null);
        timers.push(
          setTimeout(() => {
            if (!isCountdownActive()) return;
            setCountdownDisplay('3');
            playCountdownTickSfx(3);
            gamepadPollerRef.current.pulseRumble('step');
          }, leadInMs)
        );
      }

      timers.push(
        setTimeout(() => {
          if (!isCountdownActive()) return;
          setCountdownDisplay('2');
          playCountdownTickSfx(2);
          gamepadPollerRef.current.pulseRumble('step');
        }, leadInMs + STEP_MS)
      );

      timers.push(
        setTimeout(() => {
          if (!isCountdownActive()) return;
          setCountdownDisplay('1');
          playCountdownTickSfx(1);
          gamepadPollerRef.current.pulseRumble('step');
        }, leadInMs + STEP_MS * 2)
      );

      timers.push(
        setTimeout(() => {
          if (!isCountdownActive()) return;
          const inst = nostalgistRef.current;
          if (!inst || isRomModalOpenRef.current || isVictoryOpenRef.current) {
            liveStateRef.current.raceStatus = 'waiting';
            setRaceStatus('waiting');
            setCountdownDisplay(null);
            return;
          }
          emulatedCoreFrameRef.current = 0;
          pausedCoreFramesRef.current = 0;
          lastObservedCoreFrameRef.current = 0;
          raceElapsedMsRef.current = 0;
          liveStateRef.current.raceFrame = 0;
          liveStateRef.current.inGameplay = true;
          trackerRef.current.manualSyncUnlocked = true;
          recordedFramesRef.current = [];
          lastRecordedFrameRef.current = -3;
          inputRecorderRef.current.reset();
          overtakenGhostIdsRef.current.clear();
          lastSplitRoomIdRef.current = null;
          liveStateRef.current.popups.length = 0;
          prevPlayerWorldXRef.current = liveStateRef.current.playerWorldX;

          setCoreVolumeDb(inst, musicMutedRef.current ? -80 : 0);
          liveStateRef.current.raceStatus = 'racing';
          setRaceStatus('racing');
          resetTickClockRef.current = true;
          lastRealRamMutationMsRef.current = performance.now();
          if (segmentCreatorStepRef.current === 'idle') {
            videoRecorderRef.current.startRecording();
          }
          resumeCore(inst);
          syncEffectiveVirtualButtons(true);
          crtTransitionRef.current?.playGoLaunchBurst({ durationMs: 720 });
          playRaceStartSfx();
          gamepadPollerRef.current.pulseRumble('start');
          setCountdownDisplay('GO!');

          const tClear = setTimeout(() => {
            if (countdownSeqRef.current === seq) {
              setCountdownDisplay(null);
            }
          }, 680);
          countdownTimersRef.current.push(tClear);
        }, leadInMs + STEP_MS * 3)
      );

      countdownTimersRef.current = timers;
    },
    [clearPendingFinishModal, syncEffectiveVirtualButtons]
  );

  const handleUpdateTag = useCallback((next: string) => {
    setPlayerTag(next);
    setTagConflictMessage(null);
    try {
      localStorage.setItem('bitgeist_arcade_tag', sanitizeArcadeTag(next));
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleToggleMusicMute = useCallback(() => {
    userAudioUnlockedRef.current = true;
    const next = !musicMutedRef.current;
    musicMutedRef.current = next;
    setMusicMuted(next);
    setSfxMuted(next);
    setMusicMutedState(next);
    if (nostalgistRef.current) {
      setCoreVolumeDb(nostalgistRef.current, next ? -80 : 0);
    }
  }, []);

  const fetchIdentityInfo = useCallback(async (tagOverride?: string) => {
    try {
      const clean = sanitizeArcadeTag(tagOverride ?? playerTagRef.current);
      const res = await fetch(`/api/identity?tag=${encodeURIComponent(clean)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { identity?: ArcadeIdentityInfo };
      if (data.identity) {
        setIdentityInfo(data.identity);
        if (data.identity.ownedBySession && data.identity.tag) {
          const claimedClean = sanitizeArcadeTag(data.identity.tag);
          setPlayerTag(claimedClean);
          try {
            localStorage.setItem('bitgeist_arcade_tag', claimedClean);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // non-fatal
    }
  }, []);

  const handleRestoreClaimKey = useCallback(
    async (claimKey: string): Promise<{ ok: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/identity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'restore', claimKey }),
        });
        const data = (await res.json()) as {
          ok?: boolean;
          error?: string;
          identity?: ArcadeIdentityInfo;
        };
        if (!res.ok || !data.ok) {
          return { ok: false, error: data.error || 'Invalid backup key' };
        }
        if (data.identity) {
          setIdentityInfo(data.identity);
          if (data.identity.tag) {
            handleUpdateTag(data.identity.tag);
          }
        }
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error verifying key' };
      }
    },
    [handleUpdateTag]
  );

  const handleSelectTopRecord = useCallback(() => {
    rivalModeRef.current = 'top';
    setRivalMode('top');
    const top = serverTopGhostRef.current;
    targetGhostRef.current = top;
    setTargetGhost(top);
  }, []);

  const handleSelectMyPb = useCallback(() => {
    const pb = getLocalPbGhost(profileRef.current.sprintId);
    if (!pb) return;
    setLocalPbGhost(pb);
    rivalModeRef.current = 'pb';
    setRivalMode('pb');
    targetGhostRef.current = pb;
    setTargetGhost(pb);
  }, []);

  const handleSelectCustomRival = useCallback((ghost: GhostRun) => {
    rivalModeRef.current = 'custom';
    setRivalMode('custom');
    targetGhostRef.current = ghost;
    setTargetGhost(ghost);
  }, []);

  const getEffectiveDareSlugForProfile = useCallback(
    (profile: RomProfile): string | undefined => {
      if (!dareSlug) return undefined;
      if (!initialTargetGhost) return dareSlug;
      const targetSprint = initialTargetGhost.sprintId || initialTargetGhost.romId;
      const matches =
        initialTargetGhost.romId === profile.romId && targetSprint === profile.sprintId;
      return matches ? dareSlug : undefined;
    },
    [dareSlug, initialTargetGhost]
  );

  const fetchGhostsForProfile = useCallback(
    async (profile: RomProfile, forBootSeq?: number) => {
      try {
        const effectiveDareSlug = getEffectiveDareSlugForProfile(profile);
        const qs = new URLSearchParams({
          romId: profile.romId,
          cs: profile.consoleSystem,
          sprintId: profile.sprintId,
          sx: String(profile.startWorldX),
          gx: String(profile.goalWorldX),
          title: profile.stageLabel,
        });
        if (typeof profile.dailyNumber === 'number') {
          qs.set('dn', String(profile.dailyNumber));
        }
        if (typeof profile.courseIndex === 'number') {
          qs.set('lv', String(profile.courseIndex));
        }
        if (effectiveDareSlug) {
          qs.set('dare', effectiveDareSlug);
        }

        const res = await fetch(`/api/ghosts?${qs.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          targetGhost: GhostRun | null;
          leaderboard?: GhostRun[];
          mountainStandings?: MountainStandingEntry[];
          totalRuns?: number;
          communitySegments?: CustomRomSegment[];
        };
        if (typeof forBootSeq === 'number' && bootSeqRef.current !== forBootSeq) {
          return;
        }
        if (Array.isArray(data.mountainStandings)) {
          setMountainStandings(data.mountainStandings);
        }

        if (
          Array.isArray(data.communitySegments) &&
          data.communitySegments.length > 0 &&
          profile.romId !== CELESTE_ROM_ID &&
          customSegmentsRef.current.length === 0
        ) {
          customSegmentsRef.current = data.communitySegments;
          setCustomSegments(data.communitySegments);
        }

        let nextTop = data.targetGhost;

        // Fall back to stateless URL dare token only when SQLite does not have the exact stored Dare run
        if (
          effectiveDareSlug &&
          initialTargetGhost?.id.startsWith('token-') &&
          (!nextTop || nextTop.id.startsWith('seed'))
        ) {
          nextTop = initialTargetGhost;
        }

        if (Array.isArray(data.leaderboard)) {
          setLeaderboardRuns(data.leaderboard);
        }
        if (typeof data.totalRuns === 'number') {
          setLeaderboardTotalRuns(data.totalRuns);
        }

        serverTopGhostRef.current = nextTop;
        setServerTopGhost(nextTop);

        const pbGhost = getLocalPbGhost(profile.sprintId);
        setLocalPbGhost(pbGhost);

        if (!effectiveDareSlug && nextTop && nextTop.timeMs >= 1000) {
          const topMs = nextTop.timeMs;
          setTopTimesBySprintId((prev) =>
            prev[profile.sprintId] === topMs ? prev : { ...prev, [profile.sprintId]: topMs }
          );
        }

        let activeTarget = nextTop;
        if (!effectiveDareSlug && rivalModeRef.current === 'pb' && pbGhost) {
          activeTarget = pbGhost;
        } else if (
          !effectiveDareSlug &&
          rivalModeRef.current === 'custom' &&
          targetGhostRef.current &&
          targetGhostRef.current.romId === profile.romId &&
          (targetGhostRef.current.sprintId || targetGhostRef.current.romId) === profile.sprintId
        ) {
          activeTarget = targetGhostRef.current;
        } else if (rivalModeRef.current !== 'top') {
          rivalModeRef.current = 'top';
          setRivalMode('top');
        }

        targetGhostRef.current = activeTarget;
        setTargetGhost(activeTarget);

        // If bootCartridge already finished into poised 'waiting' before this fetch resolved, auto-launch Attract Mode after iris opens
        if (
          typeof forBootSeq === 'number' &&
          bootSeqRef.current === forBootSeq &&
          awaitingAutoAttractForBootSeqRef.current === forBootSeq &&
          liveStateRef.current.raceStatus === 'waiting' &&
          !isRomModalOpenRef.current
        ) {
          const cand = pickAttractReplayCandidate(nextTop, profile, effectiveDareSlug);
          if (cand) {
            const remainingIrisMs = Math.max(
              0,
              Math.round(irisOpenUntilMsRef.current - performance.now())
            );
            startAttractFromPoisedStart(cand, remainingIrisMs);
          }
        }
      } catch {
        // Keep initial ghosts fallback
      }
    },
    [getEffectiveDareSlugForProfile, initialTargetGhost, startAttractFromPoisedStart]
  );

  const attachCoreFrameLoopHooks = useCallback(
    (inst: Nostalgist) => {
      hasCoreFrameHookRef.current = false;
      try {
        const mod = inst.getEmscriptenModule() as unknown as {
          preMainLoop?: () => boolean | void;
          postMainLoop?: () => void;
        };
        if (!mod) return;
        hasCoreFrameHookRef.current = true;
        const prevPre = mod.preMainLoop;
        const prevPost = mod.postMainLoop;
        const zpSnap = new Uint8Array(256);
        let hasZpSnap = false;
        let lastAdvanceNow = 0;

        mod.preMainLoop = () => {
          if (
            nostalgistRef.current === inst &&
            !respawningRef.current &&
            inst.getStatus() === 'running' &&
            (liveStateRef.current.raceStatus === 'racing' ||
              liveStateRef.current.raceStatus === 'pregame')
          ) {
            const ram = getSystemRamView(inst, ramRegionRef.current);
            if (ram && ram.length >= 256) {
              zpSnap.set(ram.subarray(0, 256));
              hasZpSnap = true;
            } else {
              hasZpSnap = false;
            }

            if (
              liveStateRef.current.raceStatus === 'racing' &&
              liveStateRef.current.isReplayingInputs &&
              replayFrameMasksRef.current
            ) {
              const masks = replayFrameMasksRef.current;
              const fIdx = emulatedCoreFrameRef.current;
              const mask = fIdx < masks.length ? masks[fIdx] : 0;
              if (mask !== lastAppliedReplayMaskRef.current) {
                lastAppliedReplayMaskRef.current = mask;
                heldReplayButtonsRef.current.clear();
                for (const [bit, btnName] of NES_MASK_BUTTON_ENTRIES) {
                  if ((mask & bit) !== 0) {
                    heldReplayButtonsRef.current.add(btnName);
                  }
                }
                syncEffectiveVirtualButtons();
              }
            }
          } else {
            hasZpSnap = false;
          }
          return prevPre ? prevPre() : undefined;
        };

        mod.postMainLoop = () => {
          if (prevPost) prevPost();
          if (
            nostalgistRef.current === inst &&
            !respawningRef.current &&
            inst.getStatus() === 'running' &&
            (liveStateRef.current.raceStatus === 'racing' ||
              liveStateRef.current.raceStatus === 'pregame')
          ) {
            let advanced = true;
            const nowMs = performance.now();
            if (hasZpSnap) {
              const ram = getSystemRamView(inst, ramRegionRef.current);
              if (ram && ram.length >= 256) {
                advanced = false;
                for (let b = 0; b < 256; b++) {
                  if (ram[b] !== zpSnap[b]) {
                    advanced = true;
                    lastRealRamMutationMsRef.current = nowMs;
                    break;
                  }
                }
              }
            } else if (lastAdvanceNow > 0 && nowMs - lastAdvanceNow < 11.5) {
              advanced = false;
            } else {
              lastRealRamMutationMsRef.current = nowMs;
            }
            if (advanced && liveStateRef.current.raceStatus === 'racing') {
              lastAdvanceNow = nowMs;
              const completedFrame = emulatedCoreFrameRef.current;
              emulatedCoreFrameRef.current = completedFrame + 1;
              if (!liveStateRef.current.isReplayingInputs) {
                inputRecorderRef.current.recordUpToFrame(completedFrame, getCurrentLiveInputMask());
              }
            }
          }
        };
      } catch {
        hasCoreFrameHookRef.current = false;
      }
    },
    [getCurrentLiveInputMask, syncEffectiveVirtualButtons]
  );

  /**
   * Boots any Cartridge (Daily CelesteNES Sprint, any of 6 CelesteNES courses, or dropped NES/SNES/Genesis/GB/GBA ROM)
   * inside its WebAssembly Libretro core, automatically skips title screens / warps to the target stage,
   * and attaches our 60Hz HEAPU8 RAM telemetry bridge.
   */
  const bootCartridge = useCallback(
    async (opts: {
      romId: string;
      fileName: string;
      romSource: string | Blob;
      romBytes?: Uint8Array;
      consoleSystem?: ConsoleSystemId;
      profileOverride?: RomProfile;
      customBoundsOverride?: CustomSprintBounds;
      sprintIdOverride?: string;
      stageLabelOverride?: string;
    }) => {
      bootAbortRef.current?.abort();
      const controller = new AbortController();
      bootAbortRef.current = controller;
      const seq = ++bootSeqRef.current;
      const isStale = () => controller.signal.aborted || bootSeqRef.current !== seq;

      // Microtask yield prevents React 19 StrictMode's discarded first mount from launching a duplicate WASM instance
      await Promise.resolve();
      if (isStale()) return;

      const canvasEl = emulatorCanvasRef.current;
      if (!canvasEl) return;

      awaitingAutoAttractForBootSeqRef.current = seq;
      activeAttractCandidateRef.current = null;
      isAttractModeRef.current = false;
      setIsAttractMode(false);
      setAttractMeta(null);
      segmentCreatorStepRef.current = 'idle';
      setSegmentCreatorStep('idle');
      segmentDraftRef.current = null;
      setSegmentDraftDistancePx(0);
      lastSplitRoomIdRef.current = null;
      videoRecorderRef.current.discard();

      clearPendingFinishModal();
      releaseAllVirtualButtons();
      pendingResetRequestRef.current = null;
      replayFrameMasksRef.current = null;
      setIsManualReplayActive(false);
      setReplayPaused(false);
      if (opts.romBytes) {
        activeRomBytesRef.current = opts.romBytes;
      } else if (findBuiltinCartridgeByRomId(opts.romId)) {
        activeRomBytesRef.current = null;
      }
      emulatedCoreFrameRef.current = 0;
      pausedCoreFramesRef.current = 0;
      lastObservedCoreFrameRef.current = 0;
      pregameReadyFramesRef.current = 0;
      pregameLockingRef.current = false;
      inputRecorderRef.current.reset();
      overtakenGhostIdsRef.current.clear();

      const prevProfile = profileRef.current;
      let profile =
        opts.profileOverride ||
        resolveRomProfile(opts.romId, opts.fileName, opts.romBytes, opts.consoleSystem);

      const isBuiltinCart = Boolean(findBuiltinCartridgeByRomId(opts.romId));
      let explicitBounds = isBuiltinCart;
      if (!isBuiltinCart) {
        const savedSegments = await listCustomSegmentsForRom(opts.romId);
        if (isStale()) return;
        customSegmentsRef.current = savedSegments;
        setCustomSegments(savedSegments);

        if (opts.customBoundsOverride) {
          explicitBounds = true;
          profile = applyCustomSprintBounds(
            profile,
            opts.customBoundsOverride,
            opts.sprintIdOverride,
            opts.stageLabelOverride
          );
        } else if (!opts.profileOverride && savedSegments.length > 0) {
          explicitBounds = true;
          const firstSeg = savedSegments[0];
          profile = applyCustomSprintBounds(
            profile,
            { startWorldX: firstSeg.startWorldX, goalWorldX: firstSeg.goalWorldX },
            firstSeg.sprintId,
            `${profile.title} • ${firstSeg.code}`
          );
        } else if (!opts.profileOverride) {
          const cachedBounds = await getCustomSprintBoundsFromVault(opts.romId);
          if (isStale()) return;
          if (cachedBounds) {
            explicitBounds = true;
            profile = applyCustomSprintBounds(profile, cachedBounds);
          }
        }
      } else if (customSegmentsRef.current.length > 0) {
        customSegmentsRef.current = [];
        setCustomSegments([]);
      }
      hasExplicitBoundsRef.current = explicitBounds;

      const effectiveDareSlug = getEffectiveDareSlugForProfile(profile);
      if (prevProfile.sprintId !== profile.sprintId) {
        practicePinBlobRef.current = null;
        setPracticePin(null);
      }
      if (prevProfile.sprintId !== profile.sprintId && !effectiveDareSlug) {
        targetGhostRef.current = null;
        setTargetGhost(null);
      }

      profileRef.current = profile;
      trackerRef.current = createInitialTrackerState();
      recordedFramesRef.current = [];
      raceElapsedMsRef.current = 0;
      lastRecordedFrameRef.current = -3;
      prevPlayerWorldXRef.current = profile.startWorldX;

      setActiveProfile(profile);
      setIsVictoryOpen(false);
      setTimerText('00.00s');
      setActiveSegments(1);

      void fetchGhostsForProfile(profile, seq);

      const vaultStateKey = getVaultStateKeyForProfile(profile);
      const cachedStartState =
        isBuiltinCart || explicitBounds ? await getStartStateFromVault(vaultStateKey) : null;
      if (isStale()) return;
      if (!cachedStartState) {
        checkpointBlobRef.current = null;
      }

      // Fast ~25ms Same-ROM Level Swap (zero WASM reload & zero black CRT flash when savestate is cached!)
      const existingInstance = nostalgistRef.current;
      const existingRamRegion = ramRegionRef.current;
      if (
        cachedStartState &&
        existingInstance &&
        existingRamRegion &&
        prevProfile.romId === profile.romId
      ) {
        try {
          checkpointBlobRef.current = cachedStartState;
          liveStateRef.current.goalWorldX = profile.goalWorldX;
          liveStateRef.current.deathFlashFrames = 0;
          liveStateRef.current.popups = [];
          liveStateRef.current.isReplayingInputs = false;
          liveStateRef.current.isAttractReplay = false;
          liveStateRef.current.attractGhostId = null;
          liveStateRef.current.attractGhostTag = null;
          liveStateRef.current.attractGhostTimeMs = null;
          liveStateRef.current.attractIsDare = false;
          liveStateRef.current.finishCelebration = null;

          setCoreVolumeDb(existingInstance, -80);
          const wasPausedBeforeSwap = existingInstance.getStatus() === 'paused';
          if (wasPausedBeforeSwap) {
            resumeCore(existingInstance);
          }
          if (!crtTransitionRef.current?.isCurtainClosed()) {
            await crtTransitionRef.current?.playShutterClose({
              accentColor: '#F5C342',
              durationMs: 880,
            });
            if (isStale()) return;
            await new Promise((r) => setTimeout(r, 180));
            if (isStale()) return;
          } else if (wasPausedBeforeSwap) {
            await new Promise((r) => setTimeout(r, 110));
            if (isStale()) return;
          }
          resumeCore(existingInstance);
          await existingInstance.loadState(cachedStartState);
          if (isStale()) return;
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
          );
          if (isStale()) return;
          pauseCore(existingInstance);

          const ram = getSystemRamView(existingInstance, existingRamRegion);
          if (ram || profile.consoleSystem !== 'nes') {
            const seededTracker = createInitialTrackerState();
            seededTracker.manualSyncUnlocked = true;
            seededTracker.hadGameplay = true;
            const t = profile.extractTelemetry(ram ?? EMPTY_RAM_VIEW, seededTracker, 0);
            const px = t.playerWorldX || profile.startWorldX;
            liveStateRef.current.playerWorldX = px;
            liveStateRef.current.playerWorldY = t.playerWorldY || 180;
            liveStateRef.current.cameraX = t.cameraX || 0;
            liveStateRef.current.cameraY = t.cameraY || 0;
            prevPlayerWorldXRef.current = px;
          }

          trackerRef.current.manualSyncUnlocked = true;
          setCoreVolumeDb(existingInstance, musicMutedRef.current ? -80 : 0);
          liveStateRef.current.inGameplay = true;
          liveStateRef.current.raceFrame = 0;
          liveStateRef.current.raceStatus = 'waiting';
          setRaceStatus('waiting');

          const focusX = Math.max(
            20,
            Math.min(236, Math.round(liveStateRef.current.playerWorldX - liveStateRef.current.cameraX + 7))
          );
          const focusY = Math.max(
            20,
            Math.min(
              220,
              Math.round(liveStateRef.current.playerWorldY - (liveStateRef.current.cameraY || 0) - 8)
            )
          );
          irisOpenUntilMsRef.current = performance.now() + 1350;
          crtTransitionRef.current?.playIrisOpen({
            focusX,
            focusY,
            accentColor: '#F5C342',
            durationMs: 1350,
          });

          if (awaitingAutoAttractForBootSeqRef.current === seq && !isRomModalOpenRef.current) {
            const cand = pickAttractReplayCandidate(
              targetGhostRef.current,
              profile,
              effectiveDareSlug
            );
            if (cand) {
              startAttractFromPoisedStart(cand, 1350);
            }
          }
          return;
        } catch {
          // Fall through cleanly to full WASM launch if fast savestate swap encounters any error
        }
      }

      crtTransitionRef.current?.setCurtainClosed(true);
      setRaceStatus('booting');
      setBootMessage(`TUNING CRT • ${profile.stageLabel}...`);

      liveStateRef.current = {
        raceStatus: 'booting',
        inGameplay: false,
        raceFrame: 0,
        playerWorldX: profile.startWorldX,
        playerWorldY: 180,
        cameraX: 0,
        cameraY: 0,
        goalWorldX: profile.goalWorldX,
        deathFlashFrames: 0,
        popups: [],
        isReplayingInputs: false,
        isAttractReplay: false,
        attractGhostId: null,
        attractGhostTag: null,
        attractGhostTimeMs: null,
        attractIsDare: false,
        finishCelebration: null,
      };

      // Cleanly shut down previous core instance without detaching React's <canvas> node
      if (nostalgistRef.current) {
        try {
          nostalgistRef.current.exit({ removeCanvas: false });
        } catch {
          // ignore exit cleanup error
        }
        nostalgistRef.current = null;
      }
      hasCoreFrameHookRef.current = false;
      ramRegionRef.current = null;
      checkpointBlobRef.current = null;

      let instance: Nostalgist | null = null;
      try {
        ensurePreserveDrawingBuffer(canvasEl);
        const { Nostalgist } = await import('nostalgist');
        if (isStale()) return;

        instance = await Nostalgist.launch({
          element: canvasEl,
          signal: controller.signal,
          core: resolveNostalgistCore(profile.consoleSystem),
          rom: {
            fileName: ensureRomExtension(opts.fileName, profile.consoleSystem),
            fileContent: opts.romSource,
          },
          ...(cachedStartState ? { state: cachedStartState } : {}),
          size: { width: 512, height: 480 },
          style: {
            width: '100%',
            height: '100%',
            display: 'block',
            imageRendering: 'pixelated',
          },
          retroarchConfig: {
            savestate_file_compression: false,
            savestate_thumbnail_enable: false,
            video_smooth: false,
            audio_mute_enable: false,
            audio_volume: musicMutedRef.current ? -80 : 0,
            input_joypad_driver: 'null',
            input_player1_up: 'up',
            input_player1_down: 'down',
            input_player1_left: 'left',
            input_player1_right: 'right',
            input_player1_a: 'space',
            input_player1_b: 'z',
            input_player1_x: 'c',
            input_player1_y: 'v',
            input_player1_l: 'q',
            input_player1_r: 'e',
            input_player1_start: 'enter',
            input_player1_select: 'rshift',
            input_pause_toggle: 'nul',
            input_reset: 'nul',
            input_toggle_fast_forward: 'nul',
          },
        });

        if (isStale()) {
          instance.exit({ removeCanvas: false });
          return;
        }

        patchDeterministicPauseResume(instance);
        nostalgistRef.current = instance;

        // Silence cold-boot title skip (or honor user's saved music mute) synchronously via WASM _cmd_set_volume
        if (!cachedStartState || musicMutedRef.current) {
          setCoreVolumeDb(instance, -80);
        }

        // Let ~8 frames execute so stack/RAM initialize cleanly, then locate system WRAM in HEAPU8
        await new Promise((r) => setTimeout(r, 140));
        if (isStale()) {
          instance.exit({ removeCanvas: false });
          return;
        }

        const ramRegion = await locateSystemRamRegion(instance, profile.consoleSystem);
        if (isStale()) {
          instance.exit({ removeCanvas: false });
          return;
        }
        ramRegionRef.current = ramRegion;
        attachCoreFrameLoopHooks(instance);
        const nesRamOffset =
          profile.consoleSystem === 'nes' && ramRegion ? ramRegion.offset : null;

        if (cachedStartState) {
          checkpointBlobRef.current = cachedStartState;
          resumeCore(instance);
          await instance.loadState(cachedStartState);
          await new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
          );
          if (isStale()) {
            instance.exit({ removeCanvas: false });
            return;
          }
          pauseCore(instance);
          const ram = getSystemRamView(instance, ramRegion);
          if (ram || profile.consoleSystem !== 'nes') {
            const seededTracker = createInitialTrackerState();
            seededTracker.manualSyncUnlocked = true;
            seededTracker.hadGameplay = true;
            const t = profile.extractTelemetry(ram ?? EMPTY_RAM_VIEW, seededTracker, 0);
            const px = t.playerWorldX || profile.startWorldX;
            liveStateRef.current.playerWorldX = px;
            liveStateRef.current.playerWorldY = t.playerWorldY || 180;
            liveStateRef.current.cameraX = t.cameraX || 0;
            liveStateRef.current.cameraY = t.cameraY || 0;
            prevPlayerWorldXRef.current = px;
          }
          trackerRef.current.manualSyncUnlocked = true;
          setCoreVolumeDb(instance, musicMutedRef.current ? -80 : 0);
          liveStateRef.current.inGameplay = true;
          liveStateRef.current.raceStatus = 'waiting';
          setRaceStatus('waiting');
          const cachedFocusX = Math.max(
            20,
            Math.min(
              236,
              Math.round(liveStateRef.current.playerWorldX - liveStateRef.current.cameraX + 7)
            )
          );
          const cachedFocusY = Math.max(
            20,
            Math.min(
              220,
              Math.round(
                liveStateRef.current.playerWorldY - (liveStateRef.current.cameraY || 0) - 8
              )
            )
          );
          irisOpenUntilMsRef.current = performance.now() + 1350;
          crtTransitionRef.current?.playIrisOpen({
            focusX: cachedFocusX,
            focusY: cachedFocusY,
            accentColor: '#F5C342',
            durationMs: 1350,
          });
          if (awaitingAutoAttractForBootSeqRef.current === seq && !isRomModalOpenRef.current) {
            const cand = pickAttractReplayCandidate(
              targetGhostRef.current,
              profile,
              effectiveDareSlug
            );
            if (cand) {
              startAttractFromPoisedStart(cand, 1350);
            }
          }
          return;
        }

        // Cold-boot Title / Overworld / Postcard Skipper + Native Room Warp for CelesteNES (and Twin Dragons)
        resumeCore(instance);
        if (opts.romId === CELESTE_ROM_ID && nesRamOffset !== null) {
          const ramOffset = nesRamOffset;
          instance.sendCommand('FAST_FORWARD');
          const targetLevel = profile.worldIndex ?? 1;
          const targetWarp = profile.startWarp ?? profile.stageIndex ?? 0;
          const deadline = Date.now() + 7500;

          while (Date.now() < deadline && !isStale()) {
            const ram = getNesRamView(instance, ramOffset);
            if (ram) {
              const gm = ram[0x001c];
              const gs = ram[0x0021];
              const fade = ram[0x0031];

              // Active gameplay settled in gm_game ($00)
              if (
                gm === 0x00 &&
                (gs & 0x01) !== 0 &&
                fade === 0 &&
                ram[0x00a1] === 0 &&
                ram[0x001a] === 0 &&
                (ram[0x00c5] & 0x20) === 0 &&
                (ram[0x0066] & 0x1f) === 0
              ) {
                break;
              }

              // Title Screen (gm_title = $01) -> pulse START
              if (gm === 0x01 && (gs & 0x01) !== 0 && fade === 0) {
                await instance.press({ button: 'start', time: 45 });
                await new Promise((r) => setTimeout(r, 65));
                if (isStale()) {
                  instance.exit({ removeCanvas: false });
                  return;
                }
                continue;
              }

              // Overworld / Chapter Postcard (gm_overwld = $03) -> select targetLevel & pulse A
              if (gm === 0x03) {
                ram[0x005a] = targetLevel;
                if ((gs & 0x01) !== 0 && fade === 0) {
                  if (ram[0x0054] === 0) {
                    ram[0x0054] = 1;
                    ram[0x005c] = 0;
                  }
                  await instance.press({ button: 'a', time: 45 });
                  await new Promise((r) => setTimeout(r, 65));
                  if (isStale()) {
                    instance.exit({ removeCanvas: false });
                    return;
                  }
                  continue;
                }
              }

              // Prologue Intro Card (gm_prologue = $04) -> pulse START into gameplay
              if (gm === 0x04 && (gs & 0x01) !== 0 && fade === 0) {
                await instance.press({ button: 'start', time: 45 });
                await new Promise((r) => setTimeout(r, 65));
                if (isStale()) {
                  instance.exit({ removeCanvas: false });
                  return;
                }
                continue;
              }
            }

            await new Promise((r) => setTimeout(r, 35));
          }

          // Native gm_respawn warp to mid-chapter sprint starting room when targetWarp > 0
          if (!isStale() && targetWarp > 0) {
            const ramBeforeWarp = getNesRamView(instance, ramOffset);
            if (ramBeforeWarp) {
              if (targetLevel === 2) {
                // Enable Chapter 2 Dream Blocks ($01 in 2-A; $03 "awake" stage in 2-B) before room load!
                ramBeforeWarp[0x054a] = targetWarp >= 73 ? 0x03 : 0x01;
              }
              ramBeforeWarp[0x053c] = targetWarp;
              ramBeforeWarp[0x00c5] |= 0x20;
              ramBeforeWarp[0x00f0] = 23;
            }

            const warpDeadline = Date.now() + 3600;
            while (Date.now() < warpDeadline && !isStale()) {
              await new Promise((r) => setTimeout(r, 35));
              const ram = getNesRamView(instance, ramOffset);
              if (
                ram &&
                ram[0x001c] === 0x00 &&
                ram[0x053b] === targetWarp &&
                (ram[0x00c5] & 0x20) === 0 &&
                ram[0x00a1] === 0 &&
                ram[0x001a] === 0 &&
                (ram[0x0066] & 0x1f) === 0 &&
                (ram[0x0021] & 0x01) !== 0
              ) {
                break;
              }
            }
          }

          // Ensure cns_console control scheme ($01: UP climbs walls), Prologue dash, & Chapter 2 Dream Blocks
          const settledRam = getNesRamView(instance, ramOffset);
          if (settledRam) {
            settledRam[0x0048] = 0x01;
            settledRam[0x0506] = 0x00;
            settledRam[0x0507] = 0x00;
            if (targetLevel === 0) {
              settledRam[0x0065] &= ~0x40;
            } else if (targetLevel === 2) {
              settledRam[0x054a] = targetWarp >= 73 ? 0x03 : 0x01;
            }
          }

          instance.sendCommand('FAST_FORWARD');
          await new Promise((r) => setTimeout(r, 65));
        } else if (opts.romId === TWIN_DRAGONS_ROM_ID && nesRamOffset !== null) {
          const ramOffset = nesRamOffset;
          instance.sendCommand('FAST_FORWARD');
          const deadline = Date.now() + 4500;

          while (Date.now() < deadline && !isStale()) {
            const ram = getNesRamView(instance, ramOffset);
            if (
              ram &&
              ram[0x0025] === 0x06 &&
              ram[0x0300] !== 0xff &&
              (ram[0x0340] & 0x0f) === 0 &&
              ram[0x002d] === 0
            ) {
              break;
            }

            // Only pulse Start while on Title Menu or Character Select ($0025 === $00, $0011 === $03, $0012 === $00).
            // Never press Start once leaving State $00 so State $06's Pause overlay ($F606) can never trigger.
            if (ram && ram[0x0025] === 0x00 && ram[0x0011] === 0x03 && ram[0x0012] === 0x00) {
              await instance.press({ button: 'start', time: 45 });
              await new Promise((r) => setTimeout(r, 70));
              if (isStale()) {
                instance.exit({ removeCanvas: false });
                return;
              }
              continue;
            }

            await new Promise((r) => setTimeout(r, 38));
          }

          // Disengage fast-forward & let runloop drain stdin command
          instance.sendCommand('FAST_FORWARD');
          await new Promise((r) => setTimeout(r, 65));
        } else if (opts.romId === NOVA_ROM_ID && nesRamOffset !== null) {
          const ramOffset = nesRamOffset;
          const targetWarp = profile.startWarp ?? profile.stageIndex ?? 0;
          instance.sendCommand('FAST_FORWARD');

          // Nova the Squirrel cold-boot skip: Title (START) -> MainMenu (A) -> LevelSelect (A) -> PreLevel (Cursor $0E=0 + A)
          await new Promise((r) => setTimeout(r, 340));
          if (!isStale()) await instance.press({ button: 'start', time: 45 });
          await new Promise((r) => setTimeout(r, 230));
          if (!isStale()) await instance.press({ button: 'a', time: 45 });
          await new Promise((r) => setTimeout(r, 240));
          if (!isStale()) await instance.press({ button: 'a', time: 45 });
          await new Promise((r) => setTimeout(r, 240));

          const menuDeadline = Date.now() + 4500;
          while (Date.now() < menuDeadline && !isStale()) {
            const ram = getNesRamView(instance, ramOffset);
            if (ram && ram[0x003d] === 0xf0 && ram[0x004b] > 0) {
              break;
            }
            if (ram) {
              // Force PreLevel Cursor ($0E) to 0 ("Start!") so Level 1-1 never enters the Intro cutscene
              ram[0x000e] = 0x00;
            }
            await instance.press({ button: 'a', time: 45 });
            await new Promise((r) => setTimeout(r, 140));
          }

          // Native Zero-Page LevelNumber ($A7/$A8) + NeedLevelReload ($A9=1) warp when targetWarp > 0
          if (!isStale() && targetWarp > 0) {
            const ramBeforeWarp = getNesRamView(instance, ramOffset);
            if (ramBeforeWarp) {
              ramBeforeWarp[0x00a7] = targetWarp;
              ramBeforeWarp[0x00a8] = targetWarp;
              ramBeforeWarp[0x00a9] = 0x01;
            }
            const warpDeadline = Date.now() + 3400;
            while (Date.now() < warpDeadline && !isStale()) {
              await new Promise((r) => setTimeout(r, 45));
              const ram = getNesRamView(instance, ramOffset);
              if (
                ram &&
                ram[0x00a9] === 0x00 &&
                ram[0x00a7] === targetWarp &&
                ram[0x003d] === 0xf0 &&
                ram[0x004b] > 0
              ) {
                await new Promise((r) => setTimeout(r, 70));
                break;
              }
            }
          }

          instance.sendCommand('FAST_FORWARD');
          await new Promise((r) => setTimeout(r, 65));
        } else if (opts.romId === CELESTE_GBA_ROM_ID && ramRegion !== null) {
          const targetWarp = profile.startWarp ?? profile.stageIndex ?? 0;
          instance.sendCommand('FAST_FORWARD');
          const deadline = Date.now() + 6200;

          while (Date.now() < deadline && !isStale()) {
            const ram = getSystemRamView(instance, ramRegion);
            if (ram && ram.length >= 0x1600) {
              const roomX = ram[0x1548] & 0x07;
              const roomY = ram[0x1549] & 0x03;
              const levelIndex = roomY * 8 + roomX;
              const active = ram[0x14f0] === 1;

              if (levelIndex === 0 && active) {
                break;
              }
              // Only press A on Title Screen (levelIndex === 31); never press Start in gameplay (KEY_START pauses!)
              if (levelIndex >= 31) {
                await instance.press({ button: 'a', time: 55 });
                await new Promise((r) => setTimeout(r, 110));
                continue;
              }
            }
            await new Promise((r) => setTimeout(r, 45));
          }

          // Native next_room() warp when targetWarp > 0: set room = targetWarp - 1 and player.obj.y = -10.0f
          if (!isStale() && targetWarp > 0) {
            const ramBeforeWarp = getSystemRamView(instance, ramRegion);
            if (ramBeforeWarp && ramBeforeWarp.length >= 0x1600) {
              const prevRoom = Math.max(0, targetWarp - 1);
              ramBeforeWarp[0x1548] = prevRoom % 8;
              ramBeforeWarp[0x1549] = Math.floor(prevRoom / 8);
              const dv = new DataView(
                ramBeforeWarp.buffer,
                ramBeforeWarp.byteOffset,
                ramBeforeWarp.byteLength
              );
              dv.setFloat32(0x1500, -10.0, true);
            }

            const warpDeadline = Date.now() + 3600;
            while (Date.now() < warpDeadline && !isStale()) {
              await new Promise((r) => setTimeout(r, 45));
              const ram = getSystemRamView(instance, ramRegion);
              if (ram && ram.length >= 0x1600) {
                const levelIndex = (ram[0x1549] & 0x03) * 8 + (ram[0x1548] & 0x07);
                if (levelIndex === targetWarp && ram[0x14f0] === 1) {
                  await new Promise((r) => setTimeout(r, 55));
                  break;
                }
              }
            }
          }

          instance.sendCommand('FAST_FORWARD');
          await new Promise((r) => setTimeout(r, 65));
        } else if (profile.profileKind === 'exact-ram' && ramRegion !== null) {
          // Known exact-RAM BYO ROM (e.g. SMB1, SMB3, Mega Man, Contra, Castlevania, Ninja Gaiden, SMW, Sonic):
          // Wait for PPU/WRAM title init, pulse Start at most ONCE if still on Title Screen (never loop-press Start into Pause!),
          // and poll exact-RAM `t.inGameplay` so black loading cards ("WORLD 1-1", "READY", "ACT 1") or story intros never save early.
          await new Promise((r) => setTimeout(r, 520));
          let pulsedStartOnce = false;
          const bootDeadline = Date.now() + 1700;
          while (Date.now() < bootDeadline && !isStale()) {
            const ram = getSystemRamView(instance, ramRegion);
            if (ram) {
              const t = profile.extractTelemetry(ram, createInitialTrackerState(), 0);
              if (t.inGameplay) {
                await new Promise((r) => setTimeout(r, 90));
                break;
              }
            }
            if (!pulsedStartOnce) {
              pulsedStartOnce = true;
              await instance.press({ button: 'start', time: 65 });
            }
            await new Promise((r) => setTimeout(r, 60));
          }
        } else {
          // Universal BYO ROM without cached gameplay checkpoint: let PPU/WRAM finish initial reset frame
          // without blindly pressing Start or capturing a splash/title/story savestate.
          await new Promise((r) => setTimeout(r, 60));
        }

        if (isStale()) {
          instance.exit({ removeCanvas: false });
          return;
        }

        setCoreVolumeDb(instance, musicMutedRef.current ? -80 : 0);
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        if (isStale()) {
          instance.exit({ removeCanvas: false });
          return;
        }

        const postBootRam = getSystemRamView(instance, ramRegion);
        const bootT = profile.extractTelemetry(
          postBootRam ?? EMPTY_RAM_VIEW,
          createInitialTrackerState(),
          0
        );

        if (isBuiltinCart || (profile.profileKind === 'exact-ram' && bootT.inGameplay)) {
          // Verified controllable gameplay: capture exact 00.00s Starting-Line SaveState Snapshot & pause at frame 0
          try {
            const { state } = await instance.saveState();
            if (!isStale()) {
              checkpointBlobRef.current = state;
              if (isBuiltinCart) {
                void saveStartStateToVault(vaultStateKey, state);
              }
            }
          } catch {
            // Non-fatal
          }

          pauseCore(instance);
          if (isStale()) {
            instance.exit({ removeCanvas: false });
            return;
          }

          const px = bootT.playerWorldX || profile.startWorldX;
          liveStateRef.current.playerWorldX = px;
          liveStateRef.current.playerWorldY = bootT.playerWorldY || 180;
          liveStateRef.current.cameraX = bootT.cameraX || 0;
          liveStateRef.current.cameraY = bootT.cameraY || 0;
          prevPlayerWorldXRef.current = px;
          trackerRef.current.manualSyncUnlocked = true;
          liveStateRef.current.inGameplay = true;

          liveStateRef.current.raceStatus = 'waiting';
          setRaceStatus('waiting');
          const bootFocusX = Math.max(
            20,
            Math.min(
              236,
              Math.round(liveStateRef.current.playerWorldX - liveStateRef.current.cameraX + 7)
            )
          );
          const bootFocusY = Math.max(
            20,
            Math.min(
              220,
              Math.round(
                liveStateRef.current.playerWorldY - (liveStateRef.current.cameraY || 0) - 8
              )
            )
          );
          irisOpenUntilMsRef.current = performance.now() + 1400;
          crtTransitionRef.current?.playIrisOpen({
            focusX: bootFocusX,
            focusY: bootFocusY,
            accentColor: '#F5C342',
            durationMs: 1400,
          });
          if (awaitingAutoAttractForBootSeqRef.current === seq && !isRomModalOpenRef.current) {
            const cand = pickAttractReplayCandidate(
              targetGhostRef.current,
              profile,
              effectiveDareSlug
            );
            if (cand) {
              startAttractFromPoisedStart(cand, 1400);
            }
          }
        } else {
          // Cartridge is on a Title Screen, Stage Select, Loading Screen, or Opening Story Scene:
          // Keep core running live in 'pregame' with ZERO ghost sprites and ZERO timer running until gameplay begins!
          pregameReadyFramesRef.current = 0;
          pregameLockingRef.current = false;
          trackerRef.current = createInitialTrackerState();
          liveStateRef.current.inGameplay = false;
          liveStateRef.current.raceFrame = 0;
          liveStateRef.current.raceStatus = 'pregame';
          setRaceStatus('pregame');
          setTimerText('INTRO');
          setActiveSegments(0);
          syncEffectiveVirtualButtons(true);
          lastRealRamMutationMsRef.current = performance.now();
          resumeCore(instance);
          crtTransitionRef.current?.playIrisOpen({
            focusX: 128,
            focusY: 120,
            accentColor: '#7FD1AE',
            durationMs: 1250,
          });
        }
      } catch (err) {
        if (isStale()) return;
        console.error('[Bitgeist] Cartridge boot error:', err);
        if (instance) {
          try {
            instance.exit({ removeCanvas: false });
          } catch {
            // ignore
          }
        }
        liveStateRef.current.raceStatus = 'error';
        setBootMessage('CRT SIGNAL ERROR — CLICK TO RETRY CARTRIDGE BOOT');
        setRaceStatus('error');
      }
    },
    [
      attachCoreFrameLoopHooks,
      clearPendingFinishModal,
      fetchGhostsForProfile,
      getEffectiveDareSlugForProfile,
      releaseAllVirtualButtons,
      startAttractFromPoisedStart,
      syncEffectiveVirtualButtons,
    ]
  );

  /**
   * Locks the exact 00.00s Starting-Line Savestate the moment a BYO ROM finishes its loading screen,
   * title menu, stage select, or opening story scene (or when the player clicks SYNC NOW),
   * and starts the 00.00s sprint clock seamlessly without freezing the emulator.
   */
  const lockPregameStartingLine = useCallback(
    async (forceManual: boolean) => {
      const instance = nostalgistRef.current;
      if (
        !instance ||
        pregameLockingRef.current ||
        respawningRef.current ||
        liveStateRef.current.raceStatus !== 'pregame' ||
        segmentCreatorStepRef.current !== 'idle'
      ) {
        return;
      }
      pregameLockingRef.current = true;
      const expectedBootSeq = bootSeqRef.current;
      try {
        if (forceManual) {
          trackerRef.current.manualSyncUnlocked = true;
        }
        const ram = getSystemRamView(instance, ramRegionRef.current);
        let curProf = profileRef.current;
        let t = curProf.extractTelemetry(
          ram ?? EMPTY_RAM_VIEW,
          trackerRef.current,
          getCurrentLiveInputMask()
        );

        // If a ROM hack modified exact-RAM addresses and user explicitly clicked SYNC NOW, fall back cleanly to OAM
        if (forceManual && !t.inGameplay && curProf.consoleSystem === 'nes') {
          const fallbackUniversal = resolveRomProfile(
            curProf.romId,
            'custom_nes_cart.nes',
            undefined,
            'nes'
          );
          curProf = applyCustomSprintBounds(
            fallbackUniversal,
            { startWorldX: curProf.startWorldX, goalWorldX: curProf.goalWorldX },
            curProf.sprintId,
            curProf.stageLabel
          );
          trackerRef.current.manualSyncUnlocked = true;
          t = curProf.extractTelemetry(
            ram ?? EMPTY_RAM_VIEW,
            trackerRef.current,
            getCurrentLiveInputMask()
          );
          profileRef.current = curProf;
          setActiveProfile(curProf);
        }

        if (!hasExplicitBoundsRef.current && t.playerWorldX >= 0) {
          const span = Math.max(400, curProf.goalWorldX - curProf.startWorldX);
          if (Math.abs(t.playerWorldX - curProf.startWorldX) > 24) {
            curProf = applyCustomSprintBounds(
              curProf,
              {
                startWorldX: Math.max(0, Math.round(t.playerWorldX)),
                goalWorldX: Math.max(160, Math.round(t.playerWorldX + span)),
              },
              curProf.sprintId,
              curProf.stageLabel
            );
            profileRef.current = curProf;
            setActiveProfile(curProf);
            void fetchGhostsForProfile(curProf);
          }
        }

        const px = t.playerWorldX >= 0 ? t.playerWorldX : curProf.startWorldX;
        liveStateRef.current.playerWorldX = px;
        liveStateRef.current.playerWorldY = t.playerWorldY || 180;
        liveStateRef.current.cameraX = t.cameraX || 0;
        liveStateRef.current.cameraY = t.cameraY || 0;
        liveStateRef.current.goalWorldX = curProf.goalWorldX;
        liveStateRef.current.inGameplay = true;
        trackerRef.current.manualSyncUnlocked = true;
        trackerRef.current.hadGameplay = true;
        prevPlayerWorldXRef.current = px;

        try {
          const { state } = await instance.saveState();
          if (nostalgistRef.current !== instance || bootSeqRef.current !== expectedBootSeq) {
            return;
          }
          checkpointBlobRef.current = state;
        } catch {
          // Non-fatal
        }

        if (nostalgistRef.current !== instance || bootSeqRef.current !== expectedBootSeq) {
          return;
        }

        recordedFramesRef.current = [[0, px, liveStateRef.current.playerWorldY]];
        lastRecordedFrameRef.current = 0;
        raceElapsedMsRef.current = 0;
        emulatedCoreFrameRef.current = 0;
        pausedCoreFramesRef.current = 0;
        lastObservedCoreFrameRef.current = 0;
        liveStateRef.current.raceFrame = 0;
        resetTickClockRef.current = true;
        inputRecorderRef.current.reset();
        overtakenGhostIdsRef.current.clear();
        lastSplitRoomIdRef.current = null;
        liveStateRef.current.popups.length = 0;

        liveStateRef.current.raceStatus = 'racing';
        setRaceStatus('racing');
        setTimerText('00.00s');
        setActiveSegments(1);
        setCoreVolumeDb(instance, musicMutedRef.current ? -80 : 0);
        videoRecorderRef.current.startRecording();
        lastRealRamMutationMsRef.current = performance.now();
        resumeCore(instance);
        syncEffectiveVirtualButtons(true);
        playRaceStartSfx();
      } finally {
        pregameLockingRef.current = false;
      }
    },
    [fetchGhostsForProfile, getCurrentLiveInputMask, syncEffectiveVirtualButtons]
  );

  const handleManualSyncStart = useCallback(() => {
    userAudioUnlockedRef.current = true;
    setShowHowItWorks(false);
    void lockPregameStartingLine(true);
  }, [lockPregameStartingLine]);

  // Initial client bootstrap: restore saved Arcade Tag & SFX preference, load IndexedDB Vault, and auto-boot Dare or Daily Sprint
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      await Promise.resolve();
      if (cancelled) return;

      const savedMusicMuted = getMusicMuted();
      musicMutedRef.current = savedMusicMuted;
      setSfxMuted(savedMusicMuted);
      setMusicMutedState(savedMusicMuted);

      let initialTag = 'PLAYER';
      try {
        const savedTag = localStorage.getItem('bitgeist_arcade_tag');
        if (savedTag && !cancelled) {
          initialTag = sanitizeArcadeTag(savedTag);
          setPlayerTag(initialTag);
        }
      } catch {
        // ignore storage errors
      }
      void fetchIdentityInfo(initialTag);

      const cachedVault = await listVaultRoms();
      if (cancelled) return;
      setVaultRoms(cachedVault);

      // If arriving on a /vs/[slug] dare targeting a custom BYO Vault ROM, auto-boot it (with shared custom checkpoint bounds!)
      if (initialTargetGhost && !findBuiltinCartridgeByRomId(initialTargetGhost.romId)) {
        const dareBounds =
          typeof initialTargetGhost.startWorldX === 'number' &&
          typeof initialTargetGhost.goalWorldX === 'number' &&
          initialTargetGhost.goalWorldX > initialTargetGhost.startWorldX
            ? {
                startWorldX: initialTargetGhost.startWorldX,
                goalWorldX: initialTargetGhost.goalWorldX,
              }
            : undefined;

        const dareRom = await getRomFromVault(initialTargetGhost.romId);
        if (cancelled) return;
        if (dareRom) {
          await bootCartridge({
            romId: dareRom.romId,
            fileName: dareRom.fileName,
            romSource: storedEntryToBlob(dareRom),
            romBytes: dareRom.bytes,
            consoleSystem: dareRom.consoleSystem || initialTargetGhost.consoleSystem,
            customBoundsOverride: dareBounds,
            sprintIdOverride: initialTargetGhost.sprintId,
          });
          return;
        }
        // Prompt visitor to drop their local copy of the dare cartridge while warming default Daily Sprint behind it
        setMissingDareCartTitle(initialTargetGhost.romTitle);
        setIsRomModalOpen(true);
      }

      const bootProf = buildInitialDefaultProfile(dareSlug, initialTargetGhost, initialDailyNumber);
      const builtinSpec = findBuiltinCartridgeByRomId(bootProf.romId);
      await bootCartridge({
        romId: bootProf.romId,
        fileName: builtinSpec?.fileName || DEFAULT_CART_FILENAME,
        romSource: builtinSpec?.romUrl || DEFAULT_CART_URL,
        consoleSystem: bootProf.consoleSystem,
        profileOverride: bootProf,
      });
    };

    void bootstrap();

    const recorderForCleanup = videoRecorderRef.current;

    return () => {
      cancelled = true;
      bootAbortRef.current?.abort();
      clearPendingFinishModal();
      recorderForCleanup.dispose();
      releaseAllVirtualButtons();
      if (nostalgistRef.current) {
        try {
          nostalgistRef.current.exit({ removeCanvas: false });
        } catch {
          // ignore
        }
        nostalgistRef.current = null;
      }
    };
  }, [
    bootCartridge,
    clearPendingFinishModal,
    dareSlug,
    fetchIdentityInfo,
    initialDailyNumber,
    initialTargetGhost,
    releaseAllVirtualButtons,
  ]);

  /**
   * Starting-Line Reset (used for pit-death auto-respawn, manual [R] / RETRY restart,
   * Arcade Attract-Mode looping, Attract takeover, RACE AGAIN, and deterministic Input Replay).
   * Freezes outgoing visuals cleanly during the 8-bit shutter wipe, swaps savestate & HUD behind
   * the closed `#14131A` curtain, reveals the runner via spotlight iris, and launches a clean
   * 900ms-per-beat `3... 2... 1... GO!` countdown when `startCountdown` is active.
   */
  const resetToStartingLine = useCallback(
    async (
      autoResume: boolean,
      opts?: {
        withDeathFlash?: boolean;
        replayMasks?: Uint8Array | null;
        attractCandidate?: AttractReplayCandidate | null;
        preserveHeldInputs?: boolean;
        startCountdown?: boolean;
        isManualRetry?: boolean;
      }
    ) => {
      const instance = nostalgistRef.current;
      if (!instance) return;
      if (respawningRef.current) {
        if (!opts?.withDeathFlash && !opts?.attractCandidate) {
          pendingResetRequestRef.current = { autoResume, opts };
        }
        return;
      }
      respawningRef.current = true;
      let curAutoResume = autoResume;
      let curOpts = opts;

      try {
        while (true) {
          const expectedBootSeq = bootSeqRef.current;
          const isStaleReset = () =>
            nostalgistRef.current !== instance || bootSeqRef.current !== expectedBootSeq;

          pendingResetRequestRef.current = null;
          awaitingAutoAttractForBootSeqRef.current = 0;

          const attractCand = curOpts?.attractCandidate || null;
          const replayMasks = attractCand ? attractCand.masks : curOpts?.replayMasks || null;
          const isReplay = Boolean(replayMasks && replayMasks.length > 0);
          const isAttract = Boolean(attractCand && isReplay);

          clearPendingFinishModal();
          setIsVictoryOpen(false);
          if (!curAutoResume && curOpts?.startCountdown) {
            setShowHowItWorks(false);
          }

          // Silence outgoing audio, release transient virtual joypad lines, and ensure RetroArch is
          // running at 60Hz before `loadState` so `_cmd_pause()` / `_cmd_unpause()` never collide inside the 100ms paused timer.
          setCoreVolumeDb(instance, -80);
          if (!curOpts?.preserveHeldInputs && isReplay) {
            releaseAllVirtualButtons();
          } else {
            releaseTransientVirtualButtons();
          }
          const wasPausedBeforeReset = instance.getStatus() === 'paused';
          if (wasPausedBeforeReset) {
            resumeCore(instance);
          }

          const shouldCloseCurtainFirst =
            !(crtTransitionRef.current?.isCurtainClosed() ?? false) &&
            (Boolean(curOpts?.withDeathFlash) ||
              Boolean(curOpts?.isManualRetry) ||
              Boolean(curOpts?.startCountdown) ||
              Boolean(curOpts?.attractCandidate) ||
              Boolean(curOpts?.replayMasks) ||
              liveStateRef.current.raceFrame > 1);

          const wipeAccent =
            curOpts?.withDeathFlash || curOpts?.isManualRetry
              ? '#EC6553'
              : isAttract
                ? '#7FD1AE'
                : '#F5C342';

          if (shouldCloseCurtainFirst && !pendingResetRequestRef.current) {
            if (userAudioUnlockedRef.current && !curOpts?.withDeathFlash && !isAttract) {
              playScreenWipeSfx('close');
            }
            await crtTransitionRef.current?.playShutterClose({
              accentColor: wipeAccent,
              durationMs: curOpts?.withDeathFlash ? 820 : 920,
            });
            if (isStaleReset()) return;
            if (!pendingResetRequestRef.current && !curAutoResume) {
              await new Promise((r) => setTimeout(r, 200));
              if (isStaleReset()) return;
            }
          } else if (wasPausedBeforeReset) {
            await new Promise((r) => setTimeout(r, 110));
            if (isStaleReset()) return;
          }

          // Curtain is now closed (or we were already poised at 00.00s): atomically swap state & HUD
          replayFrameMasksRef.current = replayMasks;
          liveStateRef.current.isReplayingInputs = isReplay;
          liveStateRef.current.isAttractReplay = isAttract;
          setIsManualReplayActive(Boolean(isReplay && !isAttract));
          setReplayPaused(false);
          setReplaySpeed(1);
          setReplayProgress({
            frame: 0,
            total: replayMasks ? replayMasks.length : 0,
          });
          liveStateRef.current.attractGhostId = attractCand ? attractCand.ghost.id : null;
          liveStateRef.current.attractGhostTag = attractCand ? attractCand.ghost.tag : null;
          liveStateRef.current.attractGhostTimeMs = attractCand ? attractCand.ghost.timeMs : null;
          liveStateRef.current.attractIsDare = attractCand ? attractCand.isDare : false;
          activeAttractCandidateRef.current = attractCand;
          isAttractModeRef.current = isAttract;
          setIsAttractMode(isAttract);
          setAttractMeta(
            attractCand
              ? {
                  tag: attractCand.ghost.tag,
                  timeMs: attractCand.ghost.timeMs,
                  isDare: attractCand.isDare,
                }
              : null
          );

          liveStateRef.current.finishCelebration = null;
          liveStateRef.current.deathFlashFrames = 0;
          recordedFramesRef.current = [];
          raceElapsedMsRef.current = 0;
          emulatedCoreFrameRef.current = 0;
          pausedCoreFramesRef.current = 0;
          lastObservedCoreFrameRef.current = 0;
          pregameReadyFramesRef.current = 0;
          lastRecordedFrameRef.current = -3;
          trackerRef.current = createInitialTrackerState();
          inputRecorderRef.current.reset();
          overtakenGhostIdsRef.current.clear();
          lastSplitRoomIdRef.current = null;
          liveStateRef.current.popups.length = 0;
          liveStateRef.current.raceFrame = 0;
          heldReplayButtonsRef.current.clear();

          if (!checkpointBlobRef.current) {
            instance.restart();
            await new Promise((r) => setTimeout(r, 40));
            if (isStaleReset()) return;
            const earlyNoCheckpointQueued = pendingResetRequestRef.current as {
              autoResume: boolean;
              opts?: typeof opts;
            } | null;
            if (earlyNoCheckpointQueued && !isStaleReset()) {
              curAutoResume = earlyNoCheckpointQueued.autoResume;
              curOpts = earlyNoCheckpointQueued.opts;
              continue;
            }
            videoRecorderRef.current.discard();
            clearPendingFinishModal();
            trackerRef.current = createInitialTrackerState();
            liveStateRef.current.inGameplay = false;
            liveStateRef.current.raceStatus = 'pregame';
            setRaceStatus('pregame');
            setTimerText('INTRO');
            setActiveSegments(0);
            syncEffectiveVirtualButtons(true);
            setCoreVolumeDb(instance, musicMutedRef.current ? -80 : 0);
            lastRealRamMutationMsRef.current = performance.now();
            resumeCore(instance);
            crtTransitionRef.current?.playIrisOpen({
              focusX: 128,
              focusY: 120,
              accentColor: '#7FD1AE',
              durationMs: 1250,
            });
            break;
          }

          trackerRef.current.manualSyncUnlocked = true;
          liveStateRef.current.inGameplay = true;

          if (!curAutoResume && curOpts?.startCountdown) {
            liveStateRef.current.raceStatus = 'countdown';
            setRaceStatus('countdown');
          } else if (!curAutoResume) {
            liveStateRef.current.raceStatus = 'waiting';
            setRaceStatus('waiting');
          }
          syncEffectiveVirtualButtons();

          setTimerText('00.00s');
          setActiveSegments(1);

          setCoreVolumeDb(instance, -80);
          resumeCore(instance);
          await instance.loadState(checkpointBlobRef.current);
          if (isStaleReset()) return;
          if (!curAutoResume) {
            // Flush restored 00.00s savestate pixels to WebGL while running at 60Hz behind the closed curtain,
            // then issue a single idempotent `_cmd_pause()` so RetroArch freezes cleanly on the starting line.
            await new Promise((r) =>
              requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
            );
            if (isStaleReset()) return;
            pauseCore(instance);
          } else {
            await new Promise((r) => requestAnimationFrame(() => r(null)));
            if (isStaleReset()) return;
          }

          // If another restart was queued during shutter-close / loadState, coalesce BEFORE revealing or beeping
          const earlyQueued = pendingResetRequestRef.current as {
            autoResume: boolean;
            opts?: typeof opts;
          } | null;
          if (earlyQueued && !isStaleReset()) {
            curAutoResume = earlyQueued.autoResume;
            curOpts = earlyQueued.opts;
            continue;
          }

          const ram = getSystemRamView(instance, ramRegionRef.current);
          if (ram || profileRef.current.consoleSystem !== 'nes') {
            const seededTracker = createInitialTrackerState();
            seededTracker.manualSyncUnlocked = true;
            seededTracker.hadGameplay = true;
            const t = profileRef.current.extractTelemetry(
              ram ?? EMPTY_RAM_VIEW,
              seededTracker,
              0
            );
            const px = t.playerWorldX || profileRef.current.startWorldX;
            liveStateRef.current.playerWorldX = px;
            liveStateRef.current.playerWorldY = t.playerWorldY || 180;
            liveStateRef.current.cameraX = t.cameraX || 0;
            liveStateRef.current.cameraY = t.cameraY || 0;
            prevPlayerWorldXRef.current = px;
          }

          // Spotlight 8-bit pixel iris reveal centered right on the runner at 00.00s!
          const startFocusX = Math.max(
            20,
            Math.min(
              236,
              Math.round(liveStateRef.current.playerWorldX - liveStateRef.current.cameraX + 7)
            )
          );
          const startFocusY = Math.max(
            20,
            Math.min(
              220,
              Math.round(
                liveStateRef.current.playerWorldY - (liveStateRef.current.cameraY || 0) - 8
              )
            )
          );
          if (userAudioUnlockedRef.current && !isAttract) {
            playScreenWipeSfx('open');
          }
          irisOpenUntilMsRef.current = performance.now() + 1350;
          crtTransitionRef.current?.playIrisOpen({
            focusX: startFocusX,
            focusY: startFocusY,
            accentColor: isAttract ? '#7FD1AE' : '#F5C342',
            durationMs: 1350,
          });

          liveStateRef.current.isReplayingInputs = isReplay;
          raceElapsedMsRef.current = 0;
          emulatedCoreFrameRef.current = 0;
          pausedCoreFramesRef.current = 0;
          lastObservedCoreFrameRef.current = 0;
          liveStateRef.current.raceFrame = 0;
          resetTickClockRef.current = true;

          if (curAutoResume) {
            if (isReplay && replayMasks) {
              const mask0 = replayMasks[0] ?? 0;
              lastAppliedReplayMaskRef.current = mask0;
              heldReplayButtonsRef.current.clear();
              for (const [bit, btnName] of NES_MASK_BUTTON_ENTRIES) {
                if ((mask0 & bit) !== 0) {
                  heldReplayButtonsRef.current.add(btnName);
                }
              }
            }
            liveStateRef.current.raceStatus = 'racing';
            setRaceStatus('racing');
            setCoreVolumeDb(
              instance,
              (isAttract && !userAudioUnlockedRef.current) || musicMutedRef.current ? -80 : 0
            );
            if (!isReplay && !isAttract && segmentCreatorStepRef.current === 'idle') {
              videoRecorderRef.current.startRecording();
            } else {
              videoRecorderRef.current.discard();
            }
            lastRealRamMutationMsRef.current = performance.now();
            resumeCore(instance);
            syncEffectiveVirtualButtons(true);
            if (!curOpts?.withDeathFlash && !isAttract) {
              playRaceStartSfx();
            }
          } else if (curOpts?.startCountdown) {
            videoRecorderRef.current.discard();
            // Let the 1350ms spotlight iris frame the runner and sweep outward for 1050ms before striking beat "3" for its full 900ms
            beginPreRaceCountdown({ initialDelayMs: 1050, openIris: false });
          } else {
            videoRecorderRef.current.discard();
            clearPendingFinishModal();
            pauseCore(instance);
            liveStateRef.current.raceStatus = 'waiting';
            setRaceStatus('waiting');
            syncEffectiveVirtualButtons();
            setCoreVolumeDb(instance, musicMutedRef.current ? -80 : 0);
          }

          const queued = pendingResetRequestRef.current as {
            autoResume: boolean;
            opts?: typeof opts;
          } | null;
          if (!queued || isStaleReset()) {
            break;
          }
          curAutoResume = queued.autoResume;
          curOpts = queued.opts;
        }
      } finally {
        pendingResetRequestRef.current = null;
        respawningRef.current = false;
      }
    },
    [
      beginPreRaceCountdown,
      clearPendingFinishModal,
      releaseAllVirtualButtons,
      releaseTransientVirtualButtons,
      syncEffectiveVirtualButtons,
    ]
  );

  const startOrTakeoverLiveRace = useCallback(() => {
    if (
      respawningRef.current ||
      liveStateRef.current.raceStatus === 'booting' ||
      liveStateRef.current.raceStatus === 'error'
    ) {
      return;
    }
    userAudioUnlockedRef.current = true;
    setShowHowItWorks(false);
    if (liveStateRef.current.isAttractReplay || isAttractModeRef.current) {
      void resetToStartingLine(false, { startCountdown: true, preserveHeldInputs: true });
      return;
    }
    if (liveStateRef.current.raceStatus === 'waiting') {
      const curtainClosed = crtTransitionRef.current?.isCurtainClosed() ?? false;
      beginPreRaceCountdown({
        initialDelayMs: curtainClosed ? 1050 : 0,
        openIris: curtainClosed,
      });
    }
  }, [beginPreRaceCountdown, resetToStartingLine]);

  const handleManualRetry = useCallback(() => {
    if (segmentCreatorStepRef.current !== 'idle') return;
    if (
      liveStateRef.current.raceStatus === 'booting' ||
      liveStateRef.current.raceStatus === 'error'
    ) {
      return;
    }
    userAudioUnlockedRef.current = true;
    setShowHowItWorks(false);
    void resetToStartingLine(false, {
      startCountdown: true,
      isManualRetry: true,
      preserveHeldInputs: true,
    });
  }, [resetToStartingLine]);

  const handleWatchInputReplay = useCallback(() => {
    if (!finishStats.inputLog) return;
    const masks = expandInputLogToFrameMasks(finishStats.inputLog);
    if (!masks || masks.length === 0) return;
    isAttractModeRef.current = false;
    setIsAttractMode(false);
    setIsManualReplayActive(true);
    setReplayProgress({ frame: 0, total: masks.length });
    void resetToStartingLine(true, { replayMasks: masks });
  }, [finishStats.inputLog, resetToStartingLine]);

  const handleWatchGhostReplay = useCallback(
    (ghost: GhostRun) => {
      if (!ghost.inputLog || !checkpointBlobRef.current) return;
      const masks = expandInputLogToFrameMasks(ghost.inputLog);
      if (!masks || masks.length === 0) return;
      isAttractModeRef.current = false;
      setIsAttractMode(false);
      setIsManualReplayActive(true);
      setReplayProgress({ frame: 0, total: masks.length });
      void resetToStartingLine(true, { replayMasks: masks });
    },
    [resetToStartingLine]
  );

  // Stage 6: 10-Ghost Swarm Toggle
  const handleToggleSwarm = useCallback(() => {
    setSwarmEnabled((prev) => !prev);
  }, []);

  // Stage 8: Interactive Replay Studio Controls (Pause, Speed, +1F Step, & Instant Takeover)
  const handleToggleReplayPause = useCallback(() => {
    const inst = nostalgistRef.current;
    if (!inst || !liveStateRef.current.isReplayingInputs || liveStateRef.current.isAttractReplay) {
      return;
    }
    const next = !replayPausedRef.current;
    replayPausedRef.current = next;
    setReplayPaused(next);
    if (next) {
      pauseCore(inst);
    } else {
      resetTickClockRef.current = true;
      lastRealRamMutationMsRef.current = performance.now();
      resumeCore(inst);
    }
  }, []);

  const handleCycleReplaySpeed = useCallback(() => {
    const cur = replaySpeedRef.current;
    const next: ReplaySpeed = cur === 1 ? 0.5 : cur === 0.5 ? 0.25 : 1;
    replaySpeedRef.current = next;
    setReplaySpeed(next);
  }, []);

  const handleStepReplayFrame = useCallback(() => {
    const inst = nostalgistRef.current;
    if (!inst || !liveStateRef.current.isReplayingInputs || liveStateRef.current.isAttractReplay) {
      return;
    }
    if (!replayPausedRef.current) {
      replayPausedRef.current = true;
      setReplayPaused(true);
      pauseCore(inst);
    }
    const masks = replayFrameMasksRef.current;
    const nextF = Math.round(liveStateRef.current.raceFrame) + 1;
    if (masks && nextF < masks.length) {
      const mask = masks[nextF] ?? 0;
      lastAppliedReplayMaskRef.current = mask;
      heldReplayButtonsRef.current.clear();
      for (const [bit, btnName] of NES_MASK_BUTTON_ENTRIES) {
        if ((mask & bit) !== 0) {
          heldReplayButtonsRef.current.add(btnName);
        }
      }
      syncEffectiveVirtualButtons();
    }
    resumeCore(inst);
    setTimeout(() => {
      if (nostalgistRef.current === inst && replayPausedRef.current) {
        pauseCore(inst);
        const curF = Math.round(liveStateRef.current.raceFrame);
        setReplayProgress({
          frame: curF,
          total: replayFrameMasksRef.current?.length ?? 0,
        });
      }
    }, 17);
  }, [syncEffectiveVirtualButtons]);

  const handleTakeoverFromReplay = useCallback(() => {
    const inst = nostalgistRef.current;
    if (!inst || !liveStateRef.current.isReplayingInputs || liveStateRef.current.isAttractReplay) {
      return;
    }
    liveStateRef.current.isReplayingInputs = false;
    replayFrameMasksRef.current = null;
    replayPausedRef.current = false;
    setReplayPaused(false);
    setReplaySpeed(1);
    replaySpeedRef.current = 1;
    setIsManualReplayActive(false);
    heldReplayButtonsRef.current.clear();
    lastAppliedReplayMaskRef.current = -1;
    resetTickClockRef.current = true;
    lastRealRamMutationMsRef.current = performance.now();
    resumeCore(inst);
    syncEffectiveVirtualButtons(true);
  }, [syncEffectiveVirtualButtons]);

  // Stage 10: Live Multi-Runner Party Heat Lobby Coordinator
  const handleJoinPartyLobby = useCallback(
    async (explicitCode?: string) => {
      try {
        const res = await fetch('/api/lobby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'join',
            roomCode: explicitCode ?? partyCodeInput,
            runnerId: selfRunnerId,
            tag: playerTagRef.current,
            sprintId: profileRef.current.sprintId,
            romId: profileRef.current.romId,
            worldX: liveStateRef.current.playerWorldX,
            worldY: liveStateRef.current.playerWorldY,
            raceFrame: Math.round(liveStateRef.current.raceFrame),
            status: liveStateRef.current.raceStatus,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { lobby?: LivePartyLobbyState | null };
        if (data.lobby) {
          setPartyLobby(data.lobby);
          setPartyCodeInput(data.lobby.roomCode);
        }
      } catch {
        // non-fatal
      }
    },
    [partyCodeInput, selfRunnerId]
  );

  const handleLeavePartyLobby = useCallback(async () => {
    if (!partyLobby) return;
    const code = partyLobby.roomCode;
    setPartyLobby(null);
    lastTriggeredLobbyCountdownRef.current = null;
    try {
      await fetch('/api/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'leave',
          roomCode: code,
          runnerId: selfRunnerId,
        }),
      });
    } catch {
      // non-fatal
    }
  }, [partyLobby, selfRunnerId]);

  const handleStartPartyCountdown = useCallback(async () => {
    if (!partyLobby) return;
    try {
      const res = await fetch('/api/lobby', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'startCountdown',
          roomCode: partyLobby.roomCode,
          runnerId: selfRunnerId,
          tag: playerTagRef.current,
          sprintId: profileRef.current.sprintId,
          romId: profileRef.current.romId,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { lobby?: LivePartyLobbyState | null };
      if (data.lobby) {
        setPartyLobby(data.lobby);
      }
    } catch {
      // non-fatal
    }
  }, [partyLobby, selfRunnerId]);

  const handleSendPartyReaction = useCallback(
    async (emoji: string) => {
      if (!partyLobby) return;
      liveStateRef.current.popups.push({
        id: ++popupSeqRef.current,
        text: `${emoji} @${playerTagRef.current}`,
        worldX: liveStateRef.current.playerWorldX,
        worldY: liveStateRef.current.playerWorldY - 12,
        bg: '#FFE74C',
        textColor: '#111111',
        ttlMs: 850,
        maxTtlMs: 850,
      });
      try {
        const res = await fetch('/api/lobby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'react',
            roomCode: partyLobby.roomCode,
            runnerId: selfRunnerId,
            tag: playerTagRef.current,
            emoji,
          }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { lobby?: LivePartyLobbyState | null };
        if (data.lobby) {
          setPartyLobby(data.lobby);
        }
      } catch {
        // non-fatal
      }
    },
    [partyLobby, selfRunnerId]
  );

  // Stage 13: Cycle Arcade Mutator (Standard -> Mirror Mode -> 1.25x Turbo)
  const handleCycleMutator = useCallback(() => {
    const cur = activeMutatorRef.current;
    const next: ArcadeMutator =
      cur === 'none' ? 'mirror' : cur === 'mirror' ? 'turbo' : 'none';
    activeMutatorRef.current = next;
    setActiveMutator(next);
    syncEffectiveVirtualButtons();
  }, [syncEffectiveVirtualButtons]);

  // Stage 14: Instant Practice Save-Pin ([P] Drop Pin / [O] Warp to Pin)
  const handleDropPracticePin = useCallback(async () => {
    const inst = nostalgistRef.current;
    if (
      !inst ||
      respawningRef.current ||
      liveStateRef.current.raceStatus === 'booting' ||
      liveStateRef.current.raceStatus === 'error'
    ) {
      return;
    }
    try {
      const { state } = await inst.saveState();
      practicePinBlobRef.current = state;
      const pin: PracticePinState = {
        worldX: liveStateRef.current.playerWorldX,
        worldY: liveStateRef.current.playerWorldY,
        label: 'PIN [O]',
        raceFrame: Math.round(liveStateRef.current.raceFrame),
        elapsedMs: raceElapsedMsRef.current,
      };
      setPracticePin(pin);
      liveStateRef.current.popups.push({
        id: ++popupSeqRef.current,
        text: '📍 PIN SET [O]',
        worldX: pin.worldX,
        worldY: pin.worldY - 12,
        bg: '#FF4FD8',
        textColor: '#111111',
        ttlMs: 850,
        maxTtlMs: 850,
      });
      playSplitCheckpointSfx(true);
    } catch {
      // ignore if core cannot save state right now
    }
  }, []);

  const handleWarpPracticePin = useCallback(async () => {
    const inst = nostalgistRef.current;
    const blob = practicePinBlobRef.current;
    if (!inst || !blob || !practicePin || respawningRef.current) return;
    try {
      resumeCore(inst);
      await inst.loadState(blob);
      const restoreFrame = practicePin.raceFrame ?? 0;
      const restoreMs = practicePin.elapsedMs ?? 0;
      liveStateRef.current.playerWorldX = practicePin.worldX;
      liveStateRef.current.playerWorldY = practicePin.worldY;
      liveStateRef.current.raceFrame = restoreFrame;
      emulatedCoreFrameRef.current = restoreFrame;
      raceElapsedMsRef.current = restoreMs;
      isAttractModeRef.current = false;
      setIsAttractMode(false);
      liveStateRef.current.isAttractReplay = false;
      liveStateRef.current.isReplayingInputs = false;
      liveStateRef.current.raceStatus = 'racing';
      setRaceStatus('racing');
      resetTickClockRef.current = true;
      lastRealRamMutationMsRef.current = performance.now();
      resumeCore(inst);
      syncEffectiveVirtualButtons(true);
      playCountdownTickSfx(1);
    } catch {
      // non-fatal
    }
  }, [practicePin, syncEffectiveVirtualButtons]);

  useEffect(() => {
    if (!partyLobby) return;
    let active = true;
    const roomCode = partyLobby.roomCode;
    const timer = setInterval(async () => {
      if (!active) return;
      try {
        const res = await fetch('/api/lobby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'heartbeat',
            roomCode,
            runnerId: selfRunnerId,
            tag: playerTagRef.current,
            sprintId: profileRef.current.sprintId,
            romId: profileRef.current.romId,
            worldX: liveStateRef.current.playerWorldX,
            worldY: liveStateRef.current.playerWorldY,
            raceFrame: Math.round(liveStateRef.current.raceFrame),
            status: liveStateRef.current.raceStatus,
          }),
        });
        if (!res.ok || !active) return;
        const data = (await res.json()) as {
          lobby?: LivePartyLobbyState | null;
          serverNowMs?: number;
        };
        if (data.lobby) {
          setPartyLobby(data.lobby);
          if (Array.isArray(data.lobby.reactions)) {
            for (const rx of data.lobby.reactions) {
              if (!seenPartyReactionIdsRef.current.has(rx.id)) {
                seenPartyReactionIdsRef.current.add(rx.id);
                if (rx.runnerId !== selfRunnerId) {
                  liveStateRef.current.popups.push({
                    id: ++popupSeqRef.current,
                    text: `${rx.emoji} @${rx.tag}`,
                    worldX: liveStateRef.current.playerWorldX,
                    worldY: liveStateRef.current.playerWorldY - 14,
                    bg: '#4CC9F0',
                    textColor: '#111111',
                    ttlMs: 850,
                    maxTtlMs: 850,
                  });
                }
              }
            }
          }
          const cdAt = data.lobby.countdownStartAtMs;
          if (
            typeof cdAt === 'number' &&
            lastTriggeredLobbyCountdownRef.current !== cdAt &&
            cdAt > (data.serverNowMs ?? Date.now()) - 3000
          ) {
            lastTriggeredLobbyCountdownRef.current = cdAt;
            void resetToStartingLine(false, { startCountdown: true, preserveHeldInputs: true });
          }
        }
      } catch {
        // ignore network hiccup
      }
    }, 350);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [partyLobby, resetToStartingLine, selfRunnerId]);

  const bootProfileForBuiltinSlot = useCallback(
    (romId: string, courseIndex: number, isDaily: boolean): RomProfile => {
      if (isDaily) {
        return createDailyDefaultProfile();
      }
      if (romId === NOVA_ROM_ID) {
        return createNovaCourseProfile({ courseIndex });
      }
      if (romId === CELESTE_GBA_ROM_ID) {
        return createCelesteGbaCourseProfile({ courseIndex });
      }
      return createCelesteCourseProfile({ courseIndex });
    },
    []
  );

  // Stage 7: 3-Room Daily Trifecta Relay Toggle
  const handleToggleRelayMode = useCallback(() => {
    const next = !relayModeEnabledRef.current;
    relayModeEnabledRef.current = next;
    setRelayModeEnabled(next);
    relayLegIndexRef.current = 0;
    setRelayLegIndex(0);
    relayLegTimesRef.current = [];
    setCompletedRelayLegsMs(null);
  }, []);

  const handleStepCelesteLevel = useCallback(
    (direction: -1 | 1) => {
      const curProf = profileRef.current;
      const slots = buildCartridgeCarouselSlots(
        curProf,
        customSegmentsRef.current,
        getDailySprintForDate()
      );
      if (slots.length <= 1) return;

      userAudioUnlockedRef.current = true;
      setDropError(null);
      setMissingDareCartTitle(null);
      setShowHowItWorks(false);
      playLevelStepSfx(direction);
      gamepadPollerRef.current.pulseRumble('step');

      const curIdx = findActiveCelesteSlotIndex(slots, curProf);
      const nextIdx = (curIdx + direction + slots.length) % slots.length;
      const nextSlot = slots[nextIdx];
      if (!nextSlot) return;

      const builtin = findBuiltinCartridgeByRomId(curProf.romId);
      if (builtin) {
        const nextProf = bootProfileForBuiltinSlot(
          builtin.romId,
          nextSlot.courseIndex,
          nextSlot.kind === 'daily'
        );
        void bootCartridge({
          romId: builtin.romId,
          fileName: builtin.fileName,
          romSource: builtin.romUrl,
          consoleSystem: builtin.consoleSystem,
          profileOverride: nextProf,
        });
        return;
      }

      if (nextSlot.customSegment) {
        const seg = nextSlot.customSegment;
        void (async () => {
          const entry = await getRomFromVault(curProf.romId);
          if (!entry) return;
          await bootCartridge({
            romId: entry.romId,
            fileName: entry.fileName,
            romSource: storedEntryToBlob(entry),
            romBytes: entry.bytes,
            consoleSystem: entry.consoleSystem,
            customBoundsOverride: {
              startWorldX: seg.startWorldX,
              goalWorldX: seg.goalWorldX,
            },
            sprintIdOverride: seg.sprintId,
            stageLabelOverride: `${entry.title} • ${seg.code}`,
          });
        })();
      }
    },
    [bootCartridge, bootProfileForBuiltinSlot]
  );

  // Instant plug-and-play USB / Bluetooth hardware controller connection events
  useEffect(() => {
    const syncPadPresence = () => {
      const snap = gamepadPollerRef.current.poll(
        profileRef.current.consoleSystem,
        profileRef.current.romId === DEFAULT_ROM_ID ||
          profileRef.current.romId === CELESTE_GBA_ROM_ID
      );
      if (snap.connected !== gamepadConnectedRef.current) {
        gamepadConnectedRef.current = snap.connected;
        setGamepadConnected(snap.connected);
      }
      if (snap.shortBrandLabel !== gamepadBrandRef.current) {
        gamepadBrandRef.current = snap.shortBrandLabel;
        setGamepadBrand(snap.shortBrandLabel);
      }
      if (snap.controllerLabel !== gamepadLabelRef.current) {
        gamepadLabelRef.current = snap.controllerLabel;
        setGamepadLabel(snap.controllerLabel);
      }
    };
    window.addEventListener('gamepadconnected', syncPadPresence);
    window.addEventListener('gamepaddisconnected', syncPadPresence);
    return () => {
      window.removeEventListener('gamepadconnected', syncPadPresence);
      window.removeEventListener('gamepaddisconnected', syncPadPresence);
    };
  }, []);

  /**
   * Refresh-Rate-Independent 60Hz Telemetry, Hardware Gamepad Polling, Input Recording & Race Loop:
   * Uses wall-clock delta-time (ms) so 60Hz, 120Hz ProMotion, and 144Hz displays all run ghosts,
   * input logs, and the LED timer at exact 1.0x real-world speed.
   */
  useEffect(() => {
    let rafId = 0;
    let lastTickNow = 0;
    let lastTimerUiUpdate = 0;
    const scratchGhostPos: InterpolatedPos = { x: 0, y: 0, alive: true };

    const tick = (now: number) => {
      if (resetTickClockRef.current) {
        lastTickNow = now;
        resetTickClockRef.current = false;
      }
      const dtMs =
        lastTickNow > 0 ? Math.min(64, Math.max(0, now - lastTickNow)) : 1000 / 60;
      lastTickNow = now;

      const instance = nostalgistRef.current;
      const ramRegion = ramRegionRef.current;
      const st = liveStateRef.current;

      // 1. Poll W3C Hardware Gamepad API (Xbox, PlayStation, Switch Pro, 8BitDo NES/SNES/GBA/Genesis)
      const isCelesteCart =
        profileRef.current.romId === DEFAULT_ROM_ID ||
        profileRef.current.romId === CELESTE_GBA_ROM_ID;
      const padSnap = gamepadPollerRef.current.poll(
        profileRef.current.consoleSystem,
        isCelesteCart
      );
      if (padSnap.connected !== gamepadConnectedRef.current) {
        gamepadConnectedRef.current = padSnap.connected;
        setGamepadConnected(padSnap.connected);
      }
      if (padSnap.shortBrandLabel !== gamepadBrandRef.current) {
        gamepadBrandRef.current = padSnap.shortBrandLabel;
        setGamepadBrand(padSnap.shortBrandLabel);
      }
      if (padSnap.controllerLabel !== gamepadLabelRef.current) {
        gamepadLabelRef.current = padSnap.controllerLabel;
        setGamepadLabel(padSnap.controllerLabel);
      }

      if (padSnap.connected) {
        if (isRomModalOpenRef.current) {
          if (heldGamepadButtonsRef.current.size > 0 || gamepadMaskRef.current !== 0) {
            heldGamepadButtonsRef.current.clear();
            gamepadMaskRef.current = 0;
            syncEffectiveVirtualButtons();
          }
          if (padSnap.bJustPressed || padSnap.selectJustPressed) {
            setIsRomModalOpen(false);
          }
        } else if (isVictoryOpenRef.current) {
          if (heldGamepadButtonsRef.current.size > 0 || gamepadMaskRef.current !== 0) {
            heldGamepadButtonsRef.current.clear();
            gamepadMaskRef.current = 0;
            syncEffectiveVirtualButtons();
          }
          if (padSnap.startJustPressed || padSnap.aJustPressed) {
            void resetToStartingLine(false, { startCountdown: true, preserveHeldInputs: true });
          } else if (padSnap.selectJustPressed || padSnap.bJustPressed) {
            void resetToStartingLine(false);
          }
        } else if (
          showHowItWorksRef.current &&
          (padSnap.bJustPressed || padSnap.startJustPressed || padSnap.selectJustPressed)
        ) {
          setShowHowItWorks(false);
        } else {
          if (padSnap.prevSegmentJustPressed && segmentCreatorStepRef.current === 'idle') {
            handleStepCelesteLevel(-1);
          } else if (padSnap.nextSegmentJustPressed && segmentCreatorStepRef.current === 'idle') {
            handleStepCelesteLevel(1);
          } else if (
            padSnap.selectJustPressed &&
            isCelesteCart &&
            segmentCreatorStepRef.current === 'idle'
          ) {
            handleManualRetry();
          } else if (
            !respawningRef.current &&
            segmentCreatorStepRef.current === 'idle' &&
            (st.raceStatus === 'waiting' || st.isAttractReplay || isAttractModeRef.current) &&
            (padSnap.startJustPressed || padSnap.anyActionOrDirPressed)
          ) {
            gamepadMaskRef.current = padSnap.buttonsMask;
            heldGamepadButtonsRef.current.clear();
            for (const b of padSnap.virtualButtons) {
              heldGamepadButtonsRef.current.add(b);
            }
            startOrTakeoverLiveRace();
          } else {
            gamepadMaskRef.current = padSnap.buttonsMask;
            heldGamepadButtonsRef.current.clear();
            if (
              (st.raceStatus === 'racing' ||
                st.raceStatus === 'countdown' ||
                st.raceStatus === 'pregame') &&
              !st.isReplayingInputs
            ) {
              for (const b of padSnap.virtualButtons) {
                heldGamepadButtonsRef.current.add(b);
              }
            }
            syncEffectiveVirtualButtons();
          }
        }
      } else if (heldGamepadButtonsRef.current.size > 0 || gamepadMaskRef.current !== 0) {
        heldGamepadButtonsRef.current.clear();
        gamepadMaskRef.current = 0;
        syncEffectiveVirtualButtons();
      }

      // 1.25. Self-healing WASM Main-Loop Watchdog:
      // Guarantees the emulator core is never stuck paused during active 'racing' or 'pregame' states.
      if (
        instance &&
        !respawningRef.current &&
        !replayPausedRef.current &&
        (typeof document === 'undefined' || !document.hidden) &&
        (st.raceStatus === 'racing' || st.raceStatus === 'pregame') &&
        attractLoopTimeoutRef.current === null &&
        attractStartTimeoutRef.current === null
      ) {
        const stalledMs =
          lastRealRamMutationMsRef.current > 0 ? now - lastRealRamMutationMsRef.current : 0;
        if (instance.getStatus() === 'paused' || stalledMs > 240) {
          lastRealRamMutationMsRef.current = now;
          resumeCore(instance);
          syncEffectiveVirtualButtons(true);
        }
      }

      // 1.5. Pre-Game Menu / Loading / Opening Story Auto-Synchronization:
      // Keeps ghosts hidden and timer locked until controllable gameplay begins for 4 consecutive frames.
      if (
        instance &&
        st.raceStatus === 'pregame' &&
        !respawningRef.current &&
        !pregameLockingRef.current &&
        segmentCreatorStepRef.current === 'idle'
      ) {
        const ram = getSystemRamView(instance, ramRegion);
        if (ram || profileRef.current.consoleSystem !== 'nes') {
          const curProf = profileRef.current;
          const t = curProf.extractTelemetry(
            ram ?? EMPTY_RAM_VIEW,
            trackerRef.current,
            getCurrentLiveInputMask()
          );
          st.inGameplay = false;
          // Auto-lock only for known exact-RAM profiles where RAM state deterministically distinguishes
          // controllable stage gameplay from title/menu/overworld screens. Universal OAM/WRAM cartridges
          // stay in live responsive pregame until the runner clicks SYNC NOW or + NEW SEGMENT.
          if (curProf.profileKind === 'exact-ram' && t.inGameplay) {
            pregameReadyFramesRef.current++;
            if (pregameReadyFramesRef.current >= 4) {
              pregameReadyFramesRef.current = 0;
              void lockPregameStartingLine(false);
            }
          } else {
            pregameReadyFramesRef.current = 0;
          }
        }
      }

      // 2. Active Sprint Telemetry, Input Recording / Replay, Split Deltas & Ghost Overtake Detection
      if (
        instance &&
        st.raceStatus === 'racing' &&
        !respawningRef.current &&
        attractLoopTimeoutRef.current === null &&
        attractStartTimeoutRef.current === null
      ) {
        const profile = profileRef.current;
        const prevTracker = trackerRef.current;
        const isMarkingCustomSegment = segmentCreatorStepRef.current !== 'idle';
        const rawCoreF = emulatedCoreFrameRef.current;
        const coreDelta = Math.max(0, rawCoreF - lastObservedCoreFrameRef.current);
        lastObservedCoreFrameRef.current = rawCoreF;

        const prelimIntFrame = hasCoreFrameHookRef.current
          ? Math.max(0, rawCoreF - pausedCoreFramesRef.current)
          : Math.round((raceElapsedMsRef.current / 1000) * 60);

        const ram = getSystemRamView(instance, ramRegion);
        const hasTelemetrySource = Boolean(ram) || profile.consoleSystem !== 'nes';
        const liveMaskForTelemetry =
          st.isReplayingInputs && replayFrameMasksRef.current
            ? prelimIntFrame < replayFrameMasksRef.current.length
              ? replayFrameMasksRef.current[prelimIntFrame]
              : 0
            : getCurrentLiveInputMask();
        const t = hasTelemetrySource
          ? profile.extractTelemetry(ram ?? EMPTY_RAM_VIEW, prevTracker, liveMaskForTelemetry)
          : null;

        const pauseForMidRunCutscene =
          t !== null &&
          !t.inGameplay &&
          !st.isReplayingInputs &&
          !isMarkingCustomSegment &&
          profile.romId !== CELESTE_ROM_ID;

        st.inGameplay = isMarkingCustomSegment ? true : t ? t.inGameplay : true;

        if (hasCoreFrameHookRef.current) {
          if (pauseForMidRunCutscene) {
            pausedCoreFramesRef.current += coreDelta;
          }
          const effectiveCoreF = Math.max(0, rawCoreF - pausedCoreFramesRef.current);
          st.raceFrame = effectiveCoreF;
          raceElapsedMsRef.current = (effectiveCoreF / 60) * 1000;
        } else if (instance.getStatus() === 'running') {
          if (!pauseForMidRunCutscene) {
            raceElapsedMsRef.current += dtMs;
          }
          st.raceFrame = (raceElapsedMsRef.current / 1000) * 60;
        }
        const intFrame = Math.round(st.raceFrame);

        // Drive deterministic joypad replay OR record live 60Hz joypad bitmask
        if (st.isReplayingInputs && replayFrameMasksRef.current) {
          const masks = replayFrameMasksRef.current;
          if (!hasCoreFrameHookRef.current) {
            const mask = intFrame < masks.length ? masks[intFrame] : 0;
            heldReplayButtonsRef.current.clear();
            for (const [bit, btnName] of NES_MASK_BUTTON_ENTRIES) {
              if ((mask & bit) !== 0) {
                heldReplayButtonsRef.current.add(btnName);
              }
            }
            syncEffectiveVirtualButtons();
          }

          // End or loop replay automatically if stream finishes without crossing goal
          if (intFrame > masks.length + 30) {
            if (st.isAttractReplay && activeAttractCandidateRef.current) {
              void resetToStartingLine(true, {
                attractCandidate: activeAttractCandidateRef.current,
              });
              rafId = requestAnimationFrame(tick);
              return;
            }
            st.isReplayingInputs = false;
            replayFrameMasksRef.current = null;
            setIsManualReplayActive(false);
            setReplayPaused(false);
            releaseAllVirtualButtons();
            pauseCore(instance);
            st.raceStatus = 'won';
            setRaceStatus('won');
            setIsVictoryOpen(true);
            rafId = requestAnimationFrame(tick);
            return;
          }
        } else if (!hasCoreFrameHookRef.current && !isMarkingCustomSegment && !pauseForMidRunCutscene) {
          inputRecorderRef.current.recordUpToFrame(intFrame, getCurrentLiveInputMask());
        }

        // Capture 30fps composite video clip frame (CRT pixels + live 1v1 ghost + arcade HUD)
        if (!st.isReplayingInputs && !isMarkingCustomSegment && !pauseForMidRunCutscene) {
          const curTimeStr = `${(raceElapsedMsRef.current / 1000).toFixed(2).padStart(5, '0')}s`;
          videoRecorderRef.current.captureFrame(
            emulatorCanvasRef.current,
            ghostOverlayCanvasRef.current,
            {
              stageLabel: profile.stageLabel,
              tag: sanitizeArcadeTag(playerTagRef.current),
              timeText: curTimeStr,
            }
          );
        }

        if (t) {
          if (t.inGameplay) {
            if (
              t.oamTile !== undefined &&
              prevTracker.oamTile !== -1 &&
              t.oamTile !== prevTracker.oamTile
            ) {
              prevTracker.animHoldFrames = 8;
            } else if (prevTracker.animHoldFrames > 0) {
              prevTracker.animHoldFrames--;
            }
            if (t.oamTile !== undefined) {
              prevTracker.oamTile = t.oamTile;
            }
            prevTracker.hadGameplay = true;
            prevTracker.cameraX = t.cameraX;
            prevTracker.cameraY = t.cameraY ?? 0;
            prevTracker.oamX = Math.max(0, t.playerWorldX - t.cameraX);

            const prevX = prevPlayerWorldXRef.current;
            prevPlayerWorldXRef.current = t.playerWorldX;

            st.playerWorldX = t.playerWorldX;
            st.playerWorldY = t.playerWorldY;
            st.cameraX = t.cameraX;
            st.cameraY = t.cameraY ?? 0;
            st.goalWorldX = profile.goalWorldX;

            if (
              !st.isReplayingInputs &&
              !isMarkingCustomSegment &&
              intFrame >= lastRecordedFrameRef.current + 3
            ) {
              lastRecordedFrameRef.current = intFrame;
              recordedFramesRef.current.push([intFrame, t.playerWorldX, t.playerWorldY]);
            }

            // Room-Transition Split Deltas (SPLIT -0.22s / +0.18s)
            if (
              !st.isReplayingInputs &&
              !isMarkingCustomSegment &&
              typeof t.roomId === 'number'
            ) {
              if (lastSplitRoomIdRef.current === null) {
                lastSplitRoomIdRef.current = t.roomId;
              } else if (
                t.roomId !== lastSplitRoomIdRef.current &&
                intFrame > 20 &&
                !t.reachedGoal
              ) {
                lastSplitRoomIdRef.current = t.roomId;
                const rival = targetGhostRef.current;
                if (
                  rival &&
                  rival.frames.length >= 2 &&
                  interpolateGhostPosInto(
                    rival.frames,
                    st.raceFrame,
                    rival.diedAtFrame,
                    scratchGhostPos
                  )
                ) {
                  const splitSec = computeGhostSplitDeltaSec(
                    rival.frames,
                    st.raceFrame,
                    t.playerWorldX,
                    scratchGhostPos.x
                  );
                  const ahead = splitSec <= 0;
                  playSplitCheckpointSfx(ahead);
                  const sign = splitSec > 0 ? '+' : '-';
                  st.popups.push({
                    id: ++popupSeqRef.current,
                    worldX: t.playerWorldX + 8,
                    worldY: Math.max(32, t.playerWorldY - 10),
                    text: `SPLIT ${sign}${Math.abs(splitSec).toFixed(2)}s`,
                    bg: ahead ? '#7FD1AE' : '#EC6553',
                    textColor: ahead ? '#111111' : '#FFFDF7',
                    ttlMs: 900,
                    maxTtlMs: 900,
                  });
                }
              }
            }

            // Real-time 1v1 #1 / Dare Ghost Overtake Detection (👑 PASSED @TAG! + Chiptune Fanfare)
            if (
              !st.isReplayingInputs &&
              !isMarkingCustomSegment &&
              intFrame > 18 &&
              t.playerWorldX > profile.startWorldX + 24 &&
              t.playerWorldX > prevX
            ) {
              const rival = targetGhostRef.current;
              if (rival && !overtakenGhostIdsRef.current.has(rival.id)) {
                const hasPos = interpolateGhostPosInto(
                  rival.frames,
                  st.raceFrame,
                  rival.diedAtFrame,
                  scratchGhostPos
                );
                if (
                  hasPos &&
                  scratchGhostPos.alive &&
                  prevX < scratchGhostPos.x &&
                  t.playerWorldX >= scratchGhostPos.x
                ) {
                  overtakenGhostIdsRef.current.add(rival.id);
                  playCrownOvertakeSfx();
                  gamepadPollerRef.current.pulseRumble('overtake');
                  st.popups.push({
                    id: ++popupSeqRef.current,
                    worldX: t.playerWorldX + 10,
                    worldY: t.playerWorldY,
                    text: `👑 PASSED @${rival.tag}!`,
                    bg: '#FFE74C',
                    textColor: '#111111',
                    ttlMs: 950,
                    maxTtlMs: 950,
                  });
                }
              }
            }
          }

          // Auto-10ms Death Respawn (suppressed while freely exploring in Visual Segment Creator)
          if (!isMarkingCustomSegment && t.isDead && intFrame > 12) {
            prevTracker.hadGameplay = false;
            if (st.isAttractReplay && activeAttractCandidateRef.current) {
              void resetToStartingLine(true, {
                attractCandidate: activeAttractCandidateRef.current,
              });
              rafId = requestAnimationFrame(tick);
              return;
            }
            playDeathResetSfx();
            gamepadPollerRef.current.pulseRumble('death');
            if (st.isReplayingInputs) {
              void resetToStartingLine(true, {
                withDeathFlash: true,
                replayMasks: replayFrameMasksRef.current,
              });
            } else {
              void resetToStartingLine(false, {
                withDeathFlash: true,
                startCountdown: true,
                preserveHeldInputs: true,
              });
            }
            rafId = requestAnimationFrame(tick);
            return;
          }

          // Finish Line Crossed!
          if (!isMarkingCustomSegment && t.reachedGoal && intFrame > 30) {
            const finishFocusX = Math.max(
              20,
              Math.min(236, Math.round(t.playerWorldX - (t.cameraX ?? st.cameraX) + 7))
            );
            const finishFocusY = Math.max(
              20,
              Math.min(220, Math.round(t.playerWorldY - (t.cameraY ?? (st.cameraY || 0)) - 8))
            );

            if (st.isAttractReplay && activeAttractCandidateRef.current) {
              heldReplayButtonsRef.current.clear();
              lastAppliedReplayMaskRef.current = 0;
              syncEffectiveVirtualButtons();
              pauseCore(instance);
              const champMs =
                activeAttractCandidateRef.current.ghost.timeMs ||
                Math.max(1000, Math.round(raceElapsedMsRef.current));
              setTimerText(`${(champMs / 1000).toFixed(2).padStart(5, '0')}s`);
              setActiveSegments(10);
              crtTransitionRef.current?.playFinishSequence({
                focusX: finishFocusX,
                focusY: finishFocusY,
                beatTarget: true,
                closeCurtainAtEnd: false,
                totalMs: 2100,
              });
              attractLoopTimeoutRef.current = setTimeout(() => {
                attractLoopTimeoutRef.current = null;
                if (isAttractModeRef.current && activeAttractCandidateRef.current) {
                  void resetToStartingLine(true, {
                    attractCandidate: activeAttractCandidateRef.current,
                  });
                }
              }, 2050);
              rafId = requestAnimationFrame(tick);
              return;
            }

            const finalLiveMask = getCurrentLiveInputMask();
            const wasReplay = st.isReplayingInputs;
            st.isReplayingInputs = false;
            replayFrameMasksRef.current = null;
            st.raceStatus = 'won';
            setRaceStatus('won');
            releaseAllVirtualButtons();
            pauseCore(instance);

            if (wasReplay) {
              setIsManualReplayActive(false);
              setReplayPaused(false);
              clearPendingFinishModal();
              crtTransitionRef.current?.playFinishSequence({
                focusX: finishFocusX,
                focusY: finishFocusY,
                beatTarget: true,
                closeCurtainAtEnd: true,
                totalMs: 2600,
                closeDurationMs: 1250,
              });
              finishModalTimeoutRef.current = setTimeout(() => {
                finishModalTimeoutRef.current = null;
                setIsVictoryOpen(true);
              }, 2600);
              rafId = requestAnimationFrame(tick);
              return;
            }

            const legElapsedMs = Math.max(1000, Math.round(raceElapsedMsRef.current));

            // Stage 7: 3-Room Daily Trifecta Relay Chaining (Legs 1/3 -> 2/3 -> 3/3)
            const builtinSpec = findBuiltinCartridgeByRomId(profile.romId);
            if (relayModeEnabledRef.current && builtinSpec && relayLegIndexRef.current < 2) {
              const nextLegIdx = relayLegIndexRef.current + 1;
              relayLegTimesRef.current = [...relayLegTimesRef.current, legElapsedMs];
              relayLegIndexRef.current = nextLegIdx;
              setRelayLegIndex(nextLegIdx);
              playSplitCheckpointSfx(true);
              const nextCourseIdx = ((profile.courseIndex ?? 0) + 1) % 6;
              const nextProf = bootProfileForBuiltinSlot(builtinSpec.romId, nextCourseIdx, false);
              void bootCartridge({
                romId: builtinSpec.romId,
                fileName: builtinSpec.fileName,
                romSource: builtinSpec.romUrl,
                consoleSystem: builtinSpec.consoleSystem,
                profileOverride: nextProf,
              });
              rafId = requestAnimationFrame(tick);
              return;
            }

            if (relayModeEnabledRef.current && relayLegTimesRef.current.length === 2) {
              const all3Legs = [...relayLegTimesRef.current, legElapsedMs];
              setCompletedRelayLegsMs(all3Legs);
              relayLegTimesRef.current = [];
              relayLegIndexRef.current = 0;
              setRelayLegIndex(0);
            } else {
              setCompletedRelayLegsMs(null);
            }

            inputRecorderRef.current.recordUpToFrame(intFrame, finalLiveMask);
            const serializedInputLog = inputRecorderRef.current.serialize();

            const finalTimeMs = Math.max(1000, Math.round(raceElapsedMsRef.current));
            const finalSecs = (finalTimeMs / 1000).toFixed(2).padStart(5, '0');
            setTimerText(`${finalSecs}s`);
            setActiveSegments(10);

            recordLocalSprintPbMs(profile.sprintId, finalTimeMs);
            if (typeof profile.dailyNumber === 'number') {
              recordLocalDailyPbMs(profile.dailyNumber, finalTimeMs);
            }
            setPbRevision((r) => r + 1);

            const finalFrames: GhostKeyframe[] = [
              ...recordedFramesRef.current,
              [intFrame, t.playerWorldX, t.playerWorldY],
            ];

            const rival = targetGhostRef.current;
            const currentTag = playerTagRef.current;

            const totalGhosts = 1;
            const deadGhostsCount =
              rival && rival.diedAtFrame !== undefined && rival.diedAtFrame <= intFrame ? 1 : 0;
            const beatTarget = rival ? deadGhostsCount > 0 || finalTimeMs <= rival.timeMs : true;
            const beatenCount = beatTarget ? 1 : 0;

            const finalRank = beatTarget ? 1 : 2;
            setLiveRank(finalRank);
            st.finishCelebration = {
              startedAtMs: performance.now(),
              timeMs: finalTimeMs,
              beatTarget,
              isDare: Boolean(getEffectiveDareSlugForProfile(profile)),
              targetTag: rival?.tag ?? null,
              deltaVsTargetMs: rival ? finalTimeMs - rival.timeMs : null,
            };

            playGoalFanfareSfx(beatTarget);
            gamepadPollerRef.current.pulseRumble('victory');

            const emojiStrip = buildEmojiRaceReceipt({
              deadGhostsCount,
              beatTarget,
            });

            const clientRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const cleanInitialTag = sanitizeArcadeTag(currentTag);

            // Finalize 15-second composite video clip (.mp4 / .webm)
            videoRecorderRef.current.captureFrame(
              emulatorCanvasRef.current,
              ghostOverlayCanvasRef.current,
              {
                stageLabel: profile.stageLabel,
                tag: cleanInitialTag,
                timeText: `${finalSecs}s`,
              },
              true
            );
            setLatestReplayClip(null);
            void videoRecorderRef.current.stopAndFinalize().then((clip) => {
              setLatestReplayClip(clip);
            });

            // Persist local Personal Best ghost trajectory for 1-click "⚡ RACE MY PB"
            const localCandidateRun: GhostRun = {
              id: `local-pb-${profile.sprintId}`,
              slug: `pb-${profile.sprintId}`,
              tag: cleanInitialTag,
              romId: profile.romId,
              consoleSystem: profile.consoleSystem,
              sprintId: profile.sprintId,
              romTitle: profile.stageLabel,
              timeMs: finalTimeMs,
              createdAt: new Date().toISOString(),
              color: '#7FD1AE',
              beatenCount,
              totalGhosts,
              emojiReceipt: emojiStrip,
              frames: finalFrames,
              dailyNumber: profile.dailyNumber,
              courseIndex: profile.courseIndex,
              startWorldX: profile.startWorldX,
              goalWorldX: profile.goalWorldX,
              inputLog: serializedInputLog,
              verified: Boolean(serializedInputLog),
            };
            const savedPb = saveLocalPbGhostIfFaster(profile.sprintId, localCandidateRun);
            setLocalPbGhost(savedPb);
            if (rivalModeRef.current === 'pb') {
              targetGhostRef.current = savedPb;
              setTargetGhost(savedPb);
            }

            setFinishStats({
              clientRunId,
              savedSlug: undefined,
              initialSavedTag: cleanInitialTag,
              timeMs: finalTimeMs,
              beatenCount,
              totalGhosts,
              emojiStrip,
              frames: finalFrames,
              inputLog: serializedInputLog,
              verified: Boolean(serializedInputLog),
              racedTargetGhost: rival,
            });

            // Celebrate the broken finish tape, confetti burst & rank banner framed by arcade letterbox bars, then iris-out into Victory Modal
            clearPendingFinishModal();
            crtTransitionRef.current?.playFinishSequence({
              focusX: finishFocusX,
              focusY: finishFocusY,
              beatTarget,
              closeCurtainAtEnd: true,
              totalMs: 3100,
              closeDurationMs: 1450,
              onCloseStart: () => {
                if (userAudioUnlockedRef.current) {
                  playScreenWipeSfx('close');
                }
              },
            });
            finishModalTimeoutRef.current = setTimeout(() => {
              finishModalTimeoutRef.current = null;
              setIsVictoryOpen(true);
            }, 3100);

            // Persist ghost run + RLE inputLog to POST /api/ghosts for headless WASM anti-cheat & device tag claim
            void fetch('/api/ghosts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                clientRunId,
                tag: currentTag,
                romId: profile.romId,
                consoleSystem: profile.consoleSystem,
                sprintId: profile.sprintId,
                romTitle: profile.stageLabel,
                timeMs: finalTimeMs,
                beatenCount,
                totalGhosts,
                emojiReceipt: emojiStrip,
                frames: finalFrames,
                dailyNumber: profile.dailyNumber,
                courseIndex: profile.courseIndex,
                startWorldX: profile.startWorldX,
                goalWorldX: profile.goalWorldX,
                inputLog: serializedInputLog,
                parentSlug: getEffectiveDareSlugForProfile(profile),
                rivalTag: rival?.tag,
              }),
            })
              .then(async (res) => {
                if (res.ok) {
                  const payload = (await res.json()) as {
                    run?: GhostRun;
                    identity?: ArcadeIdentityInfo;
                    tagConflict?: boolean;
                    rivalrySeries?: RivalrySeriesSummary;
                  };
                  if (payload.identity) {
                    setIdentityInfo(payload.identity);
                  }
                  setRivalrySeries(payload.rivalrySeries ?? null);
                  if (payload.tagConflict && payload.run?.tag) {
                    handleUpdateTag(payload.run.tag);
                    setTagConflictMessage(
                      `@${cleanInitialTag} IS CLAIMED — ASSIGNED @${payload.run.tag}`
                    );
                  } else {
                    setTagConflictMessage(null);
                  }
                  if (payload.run) {
                    const savedRun = payload.run;
                    setFinishStats((prev) =>
                      prev.clientRunId === clientRunId
                        ? {
                            ...prev,
                            savedSlug: savedRun.slug,
                            initialSavedTag: savedRun.tag || prev.initialSavedTag,
                            verified: Boolean(savedRun.verified),
                          }
                        : prev
                    );
                  }
                }
              })
              .then(() => fetchGhostsForProfile(profile));

            rafId = requestAnimationFrame(tick);
            return;
          }
        }

        // Throttle React DOM timer, live position & 11-segment rainbow progress bar updates to ~20Hz
        if (now - lastTimerUiUpdate > 48) {
          lastTimerUiUpdate = now;
          if (isMarkingCustomSegment) {
            if (segmentCreatorStepRef.current === 'mark-finish' && segmentDraftRef.current) {
              const dist = Math.max(
                0,
                Math.round(st.playerWorldX - segmentDraftRef.current.startWorldX)
              );
              setSegmentDraftDistancePx(dist);
              setTimerText(`+${dist}PX`);
            } else {
              setTimerText('MARK 1');
            }
          } else {
            const secs = (raceElapsedMsRef.current / 1000).toFixed(2).padStart(5, '0');
            setTimerText(`${secs}s`);
            const span = Math.max(1, profile.goalWorldX - profile.startWorldX);
            const ratio = Math.max(0, Math.min(1, (st.playerWorldX - profile.startWorldX) / span));
            setActiveSegments(Math.max(1, Math.min(10, Math.ceil(ratio * 10))));
            if (st.isReplayingInputs && !st.isAttractReplay && replayFrameMasksRef.current) {
              setReplayProgress({
                frame: intFrame,
                total: replayFrameMasksRef.current.length,
              });
            }

            const rival = targetGhostRef.current;
            const rivalAhead =
              rival &&
              rival.frames.length > 0 &&
              interpolateGhostPosInto(rival.frames, st.raceFrame, rival.diedAtFrame, scratchGhostPos) &&
              scratchGhostPos.alive &&
              scratchGhostPos.x > st.playerWorldX + 2;
            setLiveRank(rivalAhead ? 2 : 1);
          }
        }
      }

      // Sync visual button depression state for Mini NES Controller & Handheld Skins on edge transitions only
      const replayMasks = replayFrameMasksRef.current;
      const replayIdx = Math.round(st.raceFrame);
      const nextVisualMask =
        st.isReplayingInputs && replayMasks
          ? replayIdx < replayMasks.length
            ? replayMasks[replayIdx]
            : 0
          : getCurrentLiveInputMask() | previewKeyMaskRef.current | touchPreviewMaskRef.current;
      if (nextVisualMask !== prevVisualMaskRef.current) {
        prevVisualMaskRef.current = nextVisualMask;
        setVisualInputMask(nextVisualMask);
      }

      const rivalMasks = targetGhostMasksRef.current;
      const nextRivalMask =
        st.raceStatus === 'racing' &&
        !st.isReplayingInputs &&
        rivalMasks &&
        replayIdx >= 0 &&
        replayIdx < rivalMasks.length
          ? rivalMasks[replayIdx]
          : 0;
      if (nextRivalMask !== prevRivalMaskRef.current) {
        prevRivalMaskRef.current = nextRivalMask;
        setRivalInputMask(nextRivalMask);
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [
    bootCartridge,
    bootProfileForBuiltinSlot,
    clearPendingFinishModal,
    fetchGhostsForProfile,
    getCurrentLiveInputMask,
    getEffectiveDareSlugForProfile,
    handleManualRetry,
    handleStepCelesteLevel,
    handleUpdateTag,
    lockPregameStartingLine,
    releaseAllVirtualButtons,
    resetToStartingLine,
    startOrTakeoverLiveRace,
    syncEffectiveVirtualButtons,
  ]);

  const handleSelectDailyChallenge = useCallback(() => {
    setDropError(null);
    setMissingDareCartTitle(null);
    setShowHowItWorks(false);
    if (userAudioUnlockedRef.current) {
      playLevelStepSfx(1);
    }
    const dailyProf = createDailyDefaultProfile();
    const spec = findBuiltinCartridgeByRomId(dailyProf.romId);
    void bootCartridge({
      romId: dailyProf.romId,
      fileName: spec?.fileName || DEFAULT_CART_FILENAME,
      romSource: spec?.romUrl || DEFAULT_CART_URL,
      consoleSystem: dailyProf.consoleSystem,
      profileOverride: dailyProf,
    });
  }, [bootCartridge]);

  const handleSelectCourse = useCallback(
    (courseIndex: number) => {
      setDropError(null);
      setMissingDareCartTitle(null);
      setShowHowItWorks(false);
      if (userAudioUnlockedRef.current) {
        playLevelStepSfx(1);
      }
      const spec =
        findBuiltinCartridgeByRomId(profileRef.current.romId) ?? HOMEBREW_CARTRIDGES[0];
      const nextProf = bootProfileForBuiltinSlot(spec.romId, courseIndex, false);
      void bootCartridge({
        romId: spec.romId,
        fileName: spec.fileName,
        romSource: spec.romUrl,
        consoleSystem: spec.consoleSystem,
        profileOverride: nextProf,
      });
    },
    [bootCartridge, bootProfileForBuiltinSlot]
  );

  const handleSelectCartridge = useCallback(
    (spec: HomebrewCartridgeSpec) => {
      setDropError(null);
      setMissingDareCartTitle(null);
      setShowHowItWorks(false);
      if (profileRef.current.romId === spec.romId) {
        return;
      }
      userAudioUnlockedRef.current = true;
      playLevelStepSfx(1);
      const today = getDailySprintForDate();
      const nextProf =
        today.romId === spec.romId
          ? createDailyDefaultProfile()
          : bootProfileForBuiltinSlot(spec.romId, 0, false);
      void bootCartridge({
        romId: spec.romId,
        fileName: spec.fileName,
        romSource: spec.romUrl,
        consoleSystem: spec.consoleSystem,
        profileOverride: nextProf,
      });
    },
    [bootCartridge, bootProfileForBuiltinSlot]
  );

  const handleSelectCustomSegment = useCallback(
    (segment: CustomRomSegment | null) => {
      setDropError(null);
      setShowHowItWorks(false);
      if (!segment) {
        void resetToStartingLine(false);
        return;
      }
      if (userAudioUnlockedRef.current) {
        playLevelStepSfx(1);
      }
      void (async () => {
        const entry = await getRomFromVault(segment.romId);
        if (!entry) return;
        await bootCartridge({
          romId: entry.romId,
          fileName: entry.fileName,
          romSource: storedEntryToBlob(entry),
          romBytes: entry.bytes,
          consoleSystem: entry.consoleSystem,
          customBoundsOverride: {
            startWorldX: segment.startWorldX,
            goalWorldX: segment.goalWorldX,
          },
          sprintIdOverride: segment.sprintId,
          stageLabelOverride: `${entry.title} • ${segment.code}`,
        });
      })();
    },
    [bootCartridge, resetToStartingLine]
  );

  const handleDeleteCustomSegment = useCallback(
    (segment: CustomRomSegment) => {
      void (async () => {
        await deleteCustomSegmentFromVault(segment.romId, segment.id);
        const remaining = await listCustomSegmentsForRom(segment.romId);
        customSegmentsRef.current = remaining;
        setCustomSegments(remaining);
        if (profileRef.current.sprintId === segment.sprintId) {
          const entry = await getRomFromVault(segment.romId);
          if (!entry) return;
          const nextSeg = remaining[0];
          await bootCartridge({
            romId: entry.romId,
            fileName: entry.fileName,
            romSource: storedEntryToBlob(entry),
            romBytes: entry.bytes,
            consoleSystem: entry.consoleSystem,
            customBoundsOverride: nextSeg
              ? { startWorldX: nextSeg.startWorldX, goalWorldX: nextSeg.goalWorldX }
              : undefined,
            sprintIdOverride: nextSeg?.sprintId,
            stageLabelOverride: nextSeg ? `${entry.title} • ${nextSeg.code}` : undefined,
          });
        }
      })();
    },
    [bootCartridge]
  );

  const handleStartSegmentCreator = useCallback(() => {
    const instance = nostalgistRef.current;
    if (!instance || findBuiltinCartridgeByRomId(profileRef.current.romId)) return;
    userAudioUnlockedRef.current = true;
    setIsRomModalOpen(false);
    setShowHowItWorks(false);
    clearPendingFinishModal();
    videoRecorderRef.current.discard();

    activeAttractCandidateRef.current = null;
    isAttractModeRef.current = false;
    setIsAttractMode(false);
    setAttractMeta(null);
    liveStateRef.current.isAttractReplay = false;
    liveStateRef.current.isReplayingInputs = false;
    replayFrameMasksRef.current = null;
    releaseAllVirtualButtons();

    segmentDraftRef.current = null;
    setSegmentDraftDistancePx(0);
    segmentCreatorStepRef.current = 'mark-start';
    setSegmentCreatorStep('mark-start');

    trackerRef.current.manualSyncUnlocked = true;
    liveStateRef.current.inGameplay = true;
    liveStateRef.current.raceStatus = 'racing';
    setRaceStatus('racing');
    setTimerText('MARK 1');
    setCoreVolumeDb(instance, musicMutedRef.current ? -80 : 0);
    lastRealRamMutationMsRef.current = performance.now();
    resumeCore(instance);
    syncEffectiveVirtualButtons(true);
  }, [clearPendingFinishModal, releaseAllVirtualButtons, syncEffectiveVirtualButtons]);

  const handleConfirmSegmentStart = useCallback(async () => {
    const instance = nostalgistRef.current;
    if (!instance || segmentCreatorStepRef.current !== 'mark-start') return;

    trackerRef.current.manualSyncUnlocked = true;
    liveStateRef.current.inGameplay = true;
    hasExplicitBoundsRef.current = true;
    let capturedStartX = liveStateRef.current.playerWorldX;
    const ram = getSystemRamView(instance, ramRegionRef.current);
    if (ram || profileRef.current.consoleSystem !== 'nes') {
      const t = profileRef.current.extractTelemetry(
        ram ?? EMPTY_RAM_VIEW,
        trackerRef.current,
        getCurrentLiveInputMask()
      );
      if (t.playerWorldX >= 0) {
        capturedStartX = t.playerWorldX;
      }
    }

    resumeCore(instance);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const previewDataUrl = snapCanvasThumbnailDataUrl(emulatorCanvasRef.current);
    const { state } = await instance.saveState();
    resumeCore(instance);
    syncEffectiveVirtualButtons(true);

    segmentDraftRef.current = {
      startWorldX: Math.max(0, Math.round(capturedStartX)),
      previewDataUrl,
      startStateBlob: state,
    };
    setSegmentDraftDistancePx(0);
    segmentCreatorStepRef.current = 'mark-finish';
    setSegmentCreatorStep('mark-finish');
    playCountdownTickSfx(2);
  }, [getCurrentLiveInputMask, syncEffectiveVirtualButtons]);

  const handleConfirmSegmentFinish = useCallback(async () => {
    const instance = nostalgistRef.current;
    const draft = segmentDraftRef.current;
    if (!instance || !draft || segmentCreatorStepRef.current !== 'mark-finish') return;

    let capturedFinishX = liveStateRef.current.playerWorldX;
    const ram = getSystemRamView(instance, ramRegionRef.current);
    if (ram || profileRef.current.consoleSystem !== 'nes') {
      const t = profileRef.current.extractTelemetry(
        ram ?? EMPTY_RAM_VIEW,
        trackerRef.current,
        getCurrentLiveInputMask()
      );
      if (t.playerWorldX >= 0) {
        capturedFinishX = t.playerWorldX;
      }
    }

    const startWorldX = draft.startWorldX;
    const goalWorldX = Math.max(startWorldX + 160, Math.round(capturedFinishX));
    const curProf = profileRef.current;
    const existing = await listCustomSegmentsForRom(curProf.romId);
    const nextNum = existing.length + 1;
    const code = `S${nextNum}`;
    const suffix = Date.now().toString(36).slice(-4);
    const sprintId = `${curProf.romId}:seg-${nextNum}-${suffix}`;

    const newSeg: CustomRomSegment = {
      id: `${curProf.romId}_seg_${Date.now().toString(36)}`,
      romId: curProf.romId,
      sprintId,
      code,
      name: `CUSTOM ${code}`,
      startWorldX,
      goalWorldX,
      previewDataUrl: draft.previewDataUrl,
      createdAt: Date.now(),
    };

    const bounds: CustomSprintBounds = { startWorldX, goalWorldX };
    await Promise.all([
      saveCustomSegmentToVault(newSeg),
      saveStartStateToVault(sprintId, draft.startStateBlob),
      saveCustomSprintBoundsToVault(curProf.romId, bounds),
    ]);

    // Stage 9: Index zero-ROM custom segment bounds in Community Segment Directory
    void fetch('/api/ghosts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveSegment',
        segment: newSeg,
      }),
    }).catch(() => {
      // non-fatal
    });

    const updatedSegments = await listCustomSegmentsForRom(curProf.romId);
    customSegmentsRef.current = updatedSegments;
    setCustomSegments(updatedSegments);

    segmentCreatorStepRef.current = 'idle';
    setSegmentCreatorStep('idle');
    segmentDraftRef.current = null;
    setSegmentDraftDistancePx(0);

    const updatedProfile = applyCustomSprintBounds(
      curProf,
      bounds,
      sprintId,
      `${curProf.title} • ${code}`
    );
    profileRef.current = updatedProfile;
    setActiveProfile(updatedProfile);
    liveStateRef.current.goalWorldX = updatedProfile.goalWorldX;
    checkpointBlobRef.current = draft.startStateBlob;

    playRaceStartSfx();
    void fetchGhostsForProfile(updatedProfile);
    await resetToStartingLine(false);
  }, [fetchGhostsForProfile, getCurrentLiveInputMask, resetToStartingLine]);

  const handleCancelSegmentCreator = useCallback(() => {
    segmentCreatorStepRef.current = 'idle';
    setSegmentCreatorStep('idle');
    segmentDraftRef.current = null;
    setSegmentDraftDistancePx(0);
    const instance = nostalgistRef.current;
    if (!checkpointBlobRef.current && instance) {
      liveStateRef.current.inGameplay = false;
      liveStateRef.current.raceStatus = 'pregame';
      setRaceStatus('pregame');
      setTimerText('INTRO');
      setActiveSegments(0);
      resumeCore(instance);
      syncEffectiveVirtualButtons(true);
      return;
    }
    void resetToStartingLine(false);
  }, [resetToStartingLine, syncEffectiveVirtualButtons]);

  /**
   * Capture-Phase Start-on-First-Input + Ergonomic Alternate Key Forwarding (WASD, X, Shift, R, M, N, [, ], Esc).
   * Running in capture phase wakes RetroArch BEFORE native Arrow/Space events reach document's JSEvents handler,
   * eliminating duplicate key dispatches and preventing inputs behind open modals.
   */
  useEffect(() => {
    const isEditableElement = (el: HTMLElement | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (isRomModalOpenRef.current ||
          isVictoryOpenRef.current ||
          showHowItWorksRef.current ||
          segmentCreatorStepRef.current !== 'idle') &&
        e.code === 'Escape'
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (isRomModalOpenRef.current) {
          setIsRomModalOpen(false);
        } else if (isVictoryOpenRef.current) {
          void resetToStartingLine(false);
        } else if (showHowItWorksRef.current) {
          setShowHowItWorks(false);
        } else if (segmentCreatorStepRef.current !== 'idle') {
          handleCancelSegmentCreator();
        }
        return;
      }

      if (!e.isTrusted) return;
      const target = e.target as HTMLElement | null;
      if (isEditableElement(target)) {
        return;
      }

      const lowerKey = (e.key || '').toLowerCase();
      const isMuteKey = e.code === 'KeyM' || lowerKey === 'm';
      const isResetKey = e.code === 'KeyR' || lowerKey === 'r';

      if (isMuteKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) {
          handleToggleMusicMute();
        }
        return;
      }

      if (isRomModalOpenRef.current || isVictoryOpenRef.current) {
        // Prevent gameplay keys from controlling the emulator behind an open modal
        if (RACE_TRIGGER_CODES.has(e.code) || isResetKey || e.code === 'ArrowDown') {
          e.stopPropagation();
        }
        return;
      }

      if (
        segmentCreatorStepRef.current === 'idle' &&
        (isResetKey || (e.code === 'Escape' && liveStateRef.current.isReplayingInputs)) &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) {
          if (e.code === 'Escape' && liveStateRef.current.isReplayingInputs) {
            void resetToStartingLine(false);
          } else {
            handleManualRetry();
          }
        }
        return;
      }

      const isPrevLevelKey =
        (e.code === 'BracketLeft' || e.key === '[') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
      const isNextLevelKey =
        (e.code === 'BracketRight' || e.key === ']') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
      if (
        (isPrevLevelKey || isNextLevelKey) &&
        segmentCreatorStepRef.current === 'idle'
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) {
          handleStepCelesteLevel(isPrevLevelKey ? -1 : 1);
        }
        return;
      }

      // Stage 14: [P] Drop Practice Save-Pin / [O] Warp to Practice Save-Pin
      if (
        (e.code === 'KeyP' || e.code === 'KeyO') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        segmentCreatorStepRef.current === 'idle'
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) {
          if (e.code === 'KeyP') {
            void handleDropPracticePin();
          } else {
            void handleWarpPracticePin();
          }
        }
        return;
      }

      const nativeBit = NATIVE_KEY_MASK_MAP[e.code];
      const nativeBtn = NATIVE_KEY_BUTTON_MAP[e.code];
      const altBtn = ALT_KEY_MAP[e.code];
      const isGameplayKey = Boolean(nativeBtn || altBtn);

      if (
        isGameplayKey ||
        e.code === 'ArrowUp' ||
        e.code === 'ArrowDown' ||
        e.code === 'ArrowLeft' ||
        e.code === 'ArrowRight' ||
        e.code === 'Space' ||
        e.code === 'Backspace'
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (target?.tagName === 'BUTTON') {
          target.blur();
        }
      }

      // During Arcade Attract Mode, pressing ANY gameplay/action key snaps to 00.00s while preserving held input
      if (liveStateRef.current.isAttractReplay || isAttractModeRef.current) {
        e.stopPropagation();
        if (!isAttractTakeoverKey(e)) {
          return;
        }
        if (nativeBit) {
          nativeKeysMaskRef.current |= nativeBit;
          previewKeyMaskRef.current |= nativeBit;
        }
        if (nativeBtn) {
          heldNativeButtonsRef.current.add(nativeBtn);
        }
        if (altBtn) {
          previewKeyMaskRef.current |= BUTTON_NAME_TO_MASK[altBtn] || 0;
          heldAltKeyButtonsRef.current.add(altBtn);
        }
        if (!e.repeat && nostalgistRef.current) {
          startOrTakeoverLiveRace();
        }
        return;
      }

      // Prevent live keyboard keys from perturbing manual post-race deterministic input replay,
      // except [Space] which triggers Stage 8 "Take Over From This Frame" practice mode!
      if (liveStateRef.current.isReplayingInputs) {
        e.stopPropagation();
        if (e.code === 'Space' && !e.repeat) {
          handleTakeoverFromReplay();
        }
        return;
      }

      if (nativeBit) {
        nativeKeysMaskRef.current |= nativeBit;
        previewKeyMaskRef.current |= nativeBit;
      }
      if (nativeBtn) {
        heldNativeButtonsRef.current.add(nativeBtn);
      }
      if (altBtn) {
        previewKeyMaskRef.current |= BUTTON_NAME_TO_MASK[altBtn] || 0;
        heldAltKeyButtonsRef.current.add(altBtn);
      }

      // Buffer held keys cleanly during shutter-close / loadState / 3-2-1 countdown without leaking to Emscripten
      if (respawningRef.current || liveStateRef.current.raceStatus === 'countdown') {
        e.stopPropagation();
        return;
      }

      const instance = nostalgistRef.current;
      if (!instance) return;

      if (
        !e.repeat &&
        liveStateRef.current.raceStatus === 'waiting' &&
        RACE_TRIGGER_CODES.has(e.code)
      ) {
        startOrTakeoverLiveRace();
      }

      const postStatus = liveStateRef.current.raceStatus as LiveOverlayState['raceStatus'];
      if (postStatus === 'countdown') {
        e.stopPropagation();
        return;
      }

      if ((altBtn || nativeBtn) && (postStatus === 'racing' || postStatus === 'pregame')) {
        syncEffectiveVirtualButtons();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.isTrusted) return;
      const nativeBit = NATIVE_KEY_MASK_MAP[e.code];
      if (nativeBit) {
        nativeKeysMaskRef.current &= ~nativeBit;
        previewKeyMaskRef.current &= ~nativeBit;
      }
      const nativeBtn = NATIVE_KEY_BUTTON_MAP[e.code];
      if (nativeBtn) {
        heldNativeButtonsRef.current.delete(nativeBtn);
      }
      const altBtn = ALT_KEY_MAP[e.code];
      if (altBtn) {
        previewKeyMaskRef.current &= ~(BUTTON_NAME_TO_MASK[altBtn] || 0);
        heldAltKeyButtonsRef.current.delete(altBtn);
      }
      if (nativeBtn || altBtn) {
        e.stopPropagation();
        syncEffectiveVirtualButtons();
      }
    };

    const onWindowBlur = () => {
      releaseAllVirtualButtons();
    };

    const onVisibilityChange = () => {
      resetTickClockRef.current = true;
      if (document.hidden) {
        releaseAllVirtualButtons();
      }
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup', onKeyUp, { capture: true });
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup', onKeyUp, { capture: true });
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [
    handleCancelSegmentCreator,
    handleDropPracticePin,
    handleManualRetry,
    handleStepCelesteLevel,
    handleTakeoverFromReplay,
    handleToggleMusicMute,
    handleWarpPracticePin,
    releaseAllVirtualButtons,
    resetToStartingLine,
    setAltKeyVirtualButton,
    startOrTakeoverLiveRace,
    syncEffectiveVirtualButtons,
  ]);

  // Drag-and-Drop Multi-Console ROM Cartridge or .IPS / .BPS Patch Anywhere on Window
  const handleDropRomFile = useCallback(
    async (file: File) => {
      setDropError(null);
      if (detectRomPatchFormat(file.name)) {
        let baseBytes = activeRomBytesRef.current;
        if (!baseBytes) {
          const curVault = await getRomFromVault(profileRef.current.romId);
          if (curVault?.bytes) {
            baseBytes = curVault.bytes;
          } else {
            const builtin =
              findBuiltinCartridgeByRomId(profileRef.current.romId) ?? HOMEBREW_CARTRIDGES[0];
            const res = await fetch(builtin.romUrl);
            if (!res.ok) {
              throw new Error('Could not load base cartridge for .IPS/.BPS patch.');
            }
            baseBytes = new Uint8Array(await res.arrayBuffer());
          }
        }
        const patched = await savePatchedRomToVault(
          baseBytes,
          profileRef.current.title,
          profileRef.current.consoleSystem,
          file
        );
        const updatedList = await listVaultRoms();
        setVaultRoms(updatedList);
        setMissingDareCartTitle(null);
        setIsRomModalOpen(false);
        await bootCartridge({
          romId: patched.romId,
          fileName: patched.fileName,
          romSource: storedEntryToBlob(patched),
          romBytes: patched.bytes,
          consoleSystem: patched.consoleSystem,
        });
        return;
      }
      const saved = await saveRomToVault(file);
      const updatedList = await listVaultRoms();
      setVaultRoms(updatedList);
      setMissingDareCartTitle(null);
      setIsRomModalOpen(false);
      await bootCartridge({
        romId: saved.romId,
        fileName: saved.fileName,
        romSource: storedEntryToBlob(saved),
        romBytes: saved.bytes,
        consoleSystem: saved.consoleSystem,
      });
    },
    [bootCartridge]
  );

  const handleLoadVaultRom = useCallback(
    (entry: StoredRomEntry) => {
      setDropError(null);
      setMissingDareCartTitle(null);
      void bootCartridge({
        romId: entry.romId,
        fileName: entry.fileName,
        romSource: storedEntryToBlob(entry),
        romBytes: entry.bytes,
        consoleSystem: entry.consoleSystem,
      });
    },
    [bootCartridge]
  );

  const handleDeleteVaultRom = useCallback(
    async (entry: StoredRomEntry) => {
      await deleteRomFromVault(entry.romId);
      const updatedList = await listVaultRoms();
      setVaultRoms(updatedList);
      if (profileRef.current.romId === entry.romId) {
        handleSelectDailyChallenge();
      }
    },
    [handleSelectDailyChallenge]
  );

  const handleTouchPad = (button: string, pressed: boolean) => {
    const instance = nostalgistRef.current;
    if (!instance) return;
    if (liveStateRef.current.isReplayingInputs && !liveStateRef.current.isAttractReplay) {
      return;
    }
    const bit = BUTTON_NAME_TO_MASK[button] || 0;
    if (pressed) {
      touchPreviewMaskRef.current |= bit;
    } else {
      touchPreviewMaskRef.current &= ~bit;
    }

    if (respawningRef.current) {
      if (pressed && button !== 'start') {
        heldTouchPadButtonsRef.current.add(button);
      } else if (!pressed) {
        heldTouchPadButtonsRef.current.delete(button);
      }
      return;
    }

    if (liveStateRef.current.isAttractReplay || isAttractModeRef.current) {
      if (pressed) {
        if (button !== 'start') {
          heldTouchPadButtonsRef.current.add(button);
        }
        startOrTakeoverLiveRace();
      } else {
        heldTouchPadButtonsRef.current.delete(button);
        setTouchPadVirtualButton(button, false);
      }
      return;
    }
    if (liveStateRef.current.raceStatus === 'waiting') {
      if (pressed) {
        if (button !== 'start') {
          heldTouchPadButtonsRef.current.add(button);
        }
        startOrTakeoverLiveRace();
      } else {
        heldTouchPadButtonsRef.current.delete(button);
      }
      return;
    }
    if (liveStateRef.current.raceStatus === 'countdown') {
      if (pressed && button !== 'start') {
        heldTouchPadButtonsRef.current.add(button);
      } else if (!pressed) {
        heldTouchPadButtonsRef.current.delete(button);
      }
      return;
    }
    setTouchPadVirtualButton(button, pressed);
  };

  const [vwStr, vhStr] = viewportKey.split('x');
  const vw = Number(vwStr) || 1440;
  const vh = Number(vhStr) || 900;

  const activeEffectiveDareSlug = getEffectiveDareSlugForProfile(activeProfile);
  const showDareBanner = Boolean(activeEffectiveDareSlug && targetGhost);
  const activeBuiltinCart = findBuiltinCartridgeByRomId(activeProfile.romId);
  const showSidePanels = vw >= 960;
  const sideRailWidthPx = vw >= 1220 ? 308 : vw >= 1080 ? 268 : 236;
  const sideRailGapPx = 12;
  const singleSideRailExtraPx = showSidePanels ? sideRailWidthPx + sideRailGapPx : 0;
  const totalSideRailsExtraWidthPx = singleSideRailExtraPx;

  const horizontalSegmentBannerExtraPx = !showSidePanels
    ? segmentCollapsed
      ? 44
      : 98 + (vw < 540 ? 22 : 0)
    : 0;
  const horizontalTopTenBannerExtraPx = !showSidePanels
    ? topTenCollapsed
      ? 44
      : 82
    : 0;
  const mobileHeaderWrapExtraPx = vw < 640 ? 48 : 0;
  const dareBannerExtraPx = showDareBanner ? 44 : 0;
  const baseNonScreenHeightPx =
    324 +
    horizontalSegmentBannerExtraPx +
    horizontalTopTenBannerExtraPx +
    mobileHeaderWrapExtraPx +
    dareBannerExtraPx;

  const maxCrtWidthFromVw = Math.max(280, vw - 32 - totalSideRailsExtraWidthPx);
  const baseCrtColWidth = Math.min(
    maxCrtWidthFromVw,
    Math.min(
      900,
      Math.max(showSidePanels ? 320 : 280, (vh - baseNonScreenHeightPx) * 1.3333)
    )
  );
  const baseRigTotalWidth = baseCrtColWidth + totalSideRailsExtraWidthPx;
  const singleSideMarginPx = (vw - baseRigTotalWidth) / 2;

  // Dock the [?] Quick-Guide card beside the rig in the outer right margin so it never covers the game screen,
  // falling back to a zero-overlap in-flow top strip on narrower viewports.
  const helpPlacementMode: 'margin-right' | 'side-flex' | 'inline-top' =
    singleSideMarginPx >= 244
      ? 'margin-right'
      : vw >= baseRigTotalWidth + 264
        ? 'side-flex'
        : 'inline-top';

  const sideHelpWidthPx =
    helpPlacementMode === 'margin-right'
      ? Math.min(268, Math.max(218, Math.floor(singleSideMarginPx - 26)))
      : 220;

  const nonScreenHeightPx =
    showHowItWorks && helpPlacementMode === 'inline-top'
      ? baseNonScreenHeightPx + (vw < 640 ? 156 : 108)
      : baseNonScreenHeightPx;

  const rigMaxWidthCss = showSidePanels
    ? `min(calc(100vw - 32px), calc(min(900px, max(320px, (100dvh - ${nonScreenHeightPx}px) * 1.3333)) + ${totalSideRailsExtraWidthPx}px))`
    : `min(900px, max(280px, calc((100dvh - ${nonScreenHeightPx}px) * 1.3333)))`;

  const activeLocalPbMs =
    typeof window !== 'undefined' && pbRevision >= 0
      ? typeof activeProfile.dailyNumber === 'number'
        ? getLocalDailyPbMs(activeProfile.dailyNumber)
        : getLocalSprintPbMs(activeProfile.sprintId)
      : null;

  return (
    <div
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          dragDepthRef.current++;
          setIsDraggingFile(true);
        }
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
        }
      }}
      onDragLeave={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) {
            setIsDraggingFile(false);
          }
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepthRef.current = 0;
        setIsDraggingFile(false);
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        void handleDropRomFile(f).catch((err: unknown) => {
          setDropError(err instanceof Error ? err.message : 'Unsupported ROM cartridge file.');
          setIsRomModalOpen(true);
        });
      }}
      className="retro-bg h-dvh w-screen overflow-hidden text-[#111111] font-mono antialiased px-4 py-2 flex flex-col justify-center select-none relative"
    >
      {/* Full-Window Drag-Anywhere Multi-Console Drop Highlight */}
      {isDraggingFile && (
        <div className="fixed inset-0 z-50 bg-[#111111]/70 flex items-center justify-center p-6 pointer-events-none">
          <div className="bg-[#7FD1AE] border-4 border-[#111111] rounded-2xl shadow-[10px_10px_0px_#111111] px-8 py-7 text-center">
            <div className="text-2xl font-black uppercase">📼 DROP ROM FILE TO PLAY!</div>
            <div className="text-sm font-bold mt-1">
              NES • SNES • GENESIS • GAME BOY • GBA — Plays privately in your browser
            </div>
          </div>
        </div>
      )}

      <div
        className="w-full mx-auto flex flex-col transition-transform duration-150"
        style={{
          maxWidth: rigMaxWidthCss,
          transform:
            showHowItWorks && helpPlacementMode === 'side-flex'
              ? `translateX(-${Math.round((sideHelpWidthPx + 12) / 2)}px)`
              : undefined,
        }}
      >
        {/* ===================================================================== */}
        {/* 1. TOP HEADER BAR + CARTRIDGE SHELF + AUDIO + TOP-10 + [?] GUIDE      */}
        {/* ===================================================================== */}
        <header className="relative flex flex-wrap sm:flex-nowrap items-center justify-between gap-2 mb-3.5 w-full">
          {/* Colorful Rainbow 3D Pixel Block BITGEIST Wordmark + Plain-English Tagline */}
          <div className="flex flex-col shrink-0">
            <Link href="/" className="flex items-center gap-[3.5px] group w-fit" aria-label="BITGEIST Home">
              {LOGO_BLOCKS.map((item, idx) => (
                <span
                  key={idx}
                  style={{ backgroundColor: item.bg }}
                  className="logo-letter group-hover:-translate-y-0.5 transition-transform"
                >
                  {item.ch}
                </span>
              ))}
            </Link>
            <p className="mt-4 text-[10.5px] font-black uppercase tracking-tight text-[#111111]/85 leading-none whitespace-nowrap">
              15-SECOND RETRO SPEEDRUNS • BEAT THE #1 GHOST
            </p>
          </div>

          {/* Right Controls: BYO ROM + Sound + [?] */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap sm:flex-nowrap">
            {/* Shown only when playing a user-dropped custom ROM to return to Celeste in 1 click */}
            {!activeBuiltinCart && (
              <button
                type="button"
                onClick={() => handleSelectCartridge(HOMEBREW_CARTRIDGES[0])}
                title="Return to Built-In Celeste (NES)"
                className="retro-btn bg-[#F2545B] text-white px-2.5 h-[36px] text-[10px] lg:text-[10.5px] uppercase tracking-tight whitespace-nowrap shrink-0"
              >
                ← CELESTE
              </button>
            )}

            {/* Play Your Own ROM Vault Trigger */}
            <button
              type="button"
              onClick={() => {
                if (liveStateRef.current.raceStatus === 'countdown') {
                  clearPendingFinishModal();
                  liveStateRef.current.raceStatus = 'waiting';
                  setRaceStatus('waiting');
                }
                setDropError(null);
                setShowHowItWorks(false);
                setIsRomModalOpen(true);
              }}
              title="Play your own NES, SNES, Genesis, Game Boy, or GBA ROM file"
              className={`retro-btn px-2 h-[36px] text-[10px] lg:text-[10.5px] uppercase tracking-tight whitespace-nowrap shrink-0 ${
                !activeBuiltinCart ? 'bg-[#FFE74C]' : 'bg-[#7FD1AE]'
              }`}
            >
              📼 <span className="hidden xl:inline">PLAY ANY </span>ROM
            </button>

            {/* Single Icon-Only Sound Mute Button */}
            <button
              type="button"
              onClick={handleToggleMusicMute}
              aria-pressed={musicMuted}
              aria-label={musicMuted ? 'Unmute Sound (M)' : 'Mute Sound (M)'}
              title={musicMuted ? 'Unmute Sound (Shortcut: M)' : 'Mute Sound (Shortcut: M)'}
              className={`retro-btn w-[36px] h-[36px] flex items-center justify-center shrink-0 ${
                musicMuted ? 'bg-[#EAE2C8] text-[#111111]/55' : 'bg-[#FFE74C] text-[#111111]'
              }`}
            >
              <MusicStatusIcon muted={musicMuted} size={16} />
            </button>

            <button
              ref={helpButtonRef}
              type="button"
              onClick={() => setShowHowItWorks((prev) => !prev)}
              aria-expanded={showHowItWorks}
              aria-label="How Bitgeist Works"
              title="What is Bitgeist? (Toggle Quick Guide)"
              className={`retro-btn w-[36px] h-[36px] flex items-center justify-center text-sm shrink-0 ${
                showHowItWorks ? 'bg-[#FFE74C]' : 'bg-[#FFF9E6]'
              }`}
            >
              ?
            </button>
          </div>

          {/* Right-Docked Side Quick-Guide Card (Sits in empty outer margin beside [?] — 0px game overlap!) */}
          {showHowItWorks && helpPlacementMode !== 'inline-top' && (
            <section
              ref={helpPanelRef}
              aria-label="How Bitgeist Works"
              style={{ width: `${sideHelpWidthPx}px` }}
              className="absolute left-full ml-3 top-0 z-40 bg-[#FFFDF7] border-[3.5px] border-[#111111] rounded-2xl px-3 py-3 shadow-[6px_6px_0px_#111111]"
            >
              {/* Tactile Left-Pointing Callout Notch Aimed at the [?] Button */}
              <span
                aria-hidden="true"
                className="absolute top-[20px] -left-[8.5px] w-[13px] h-[13px] rotate-45 bg-[#FFFDF7] border-l-[3.5px] border-b-[3.5px] border-[#111111]"
              />

              <div className="flex items-center justify-between gap-1.5">
                <span className="bg-[#F5C342] border-[1.5px] border-[#111111] rounded px-1.5 py-0.5 text-[10.5px] font-black uppercase leading-none">
                  HOW IT WORKS
                </span>
                <button
                  type="button"
                  onClick={() => setShowHowItWorks(false)}
                  aria-label="Dismiss Quick Guide"
                  className="text-[10px] font-black uppercase bg-[#EAE2C8] hover:bg-[#FFE74C] border-[1.5px] border-[#111111] rounded px-1.5 py-0.5 leading-none cursor-pointer shrink-0 transition-colors"
                >
                  ✕
                </button>
              </div>

              <p className="text-[9.5px] font-black uppercase tracking-tight text-[#111111]/75 mt-1.5 leading-tight">
                Zero menus • Zero sign-up
              </p>

              <div className="flex flex-col gap-2 mt-2 text-[10.5px] leading-snug">
                <div className="bg-[#F7EED7] border-2 border-[#111111] rounded-xl px-2.5 py-2">
                  <div className="font-black uppercase whitespace-nowrap">1. PICK A SEGMENT</div>
                  <div className="font-bold text-[#111111]/80 mt-0.5">
                    Click any Celeste room on the right (or drop your own ROM to race custom segments).
                  </div>
                </div>
                <div className="bg-[#F7EED7] border-2 border-[#111111] rounded-xl px-2.5 py-2">
                  <div className="font-black uppercase whitespace-nowrap">2. BEAT THE #1 GHOST</div>
                  <div className="font-bold text-[#111111]/80 mt-0.5">
                    Click any runner in TOP 10 on the right to race 1v1 (or ▶ to watch). Press any key or pad to race.
                  </div>
                </div>
                <div className="bg-[#F7EED7] border-2 border-[#111111] rounded-xl px-2.5 py-2">
                  <div className="font-black uppercase whitespace-nowrap">3. DARE &amp; SHARE CLIP</div>
                  <div className="font-bold text-[#111111]/80 mt-0.5">
                    Finish a run to download a 15s video clip or share a 1-click challenge link.
                  </div>
                </div>

                {/* Stage 10: Live Party Room Heat Controls */}
                <div className="bg-[#E8F9F0] border-2 border-[#111111] rounded-xl px-2.5 py-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-black uppercase whitespace-nowrap text-[10px]">
                      📡 LIVE PARTY HEAT
                    </span>
                    {partyLobby && (
                      <span className="bg-[#111111] text-[#FFE74C] rounded px-1.5 py-0.5 text-[9px] font-black uppercase">
                        {partyLobby.roomCode} • {partyLobby.runners.length}P
                      </span>
                    )}
                  </div>
                  {partyLobby ? (
                    <div className="space-y-1.5 mt-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleStartPartyCountdown()}
                          className="flex-1 bg-[#FFE74C] hover:bg-[#FFD919] text-[#111111] border-[1.5px] border-[#111111] rounded px-1.5 py-1 text-[9.5px] font-black uppercase cursor-pointer"
                        >
                          🚦 SYNC 3-2-1 GO
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleLeavePartyLobby()}
                          className="bg-[#EAE2C8] hover:bg-[#EC6553] hover:text-white text-[#111111] border-[1.5px] border-[#111111] rounded px-1.5 py-1 text-[9.5px] font-black uppercase cursor-pointer"
                        >
                          LEAVE
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {(['🔥', '⚡', '👑', '💀'] as const).map((em) => (
                          <button
                            key={em}
                            type="button"
                            onClick={() => void handleSendPartyReaction(em)}
                            aria-label={`Send ${em} Party Reaction`}
                            className="bg-[#FFFDF7] hover:bg-[#FFE74C] border border-[#111111] rounded py-0.5 text-[11px] leading-none flex items-center justify-center cursor-pointer"
                          >
                            {em}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 mt-1.5">
                      <input
                        type="text"
                        value={partyCodeInput}
                        onChange={(e) =>
                          setPartyCodeInput(
                            e.target.value
                              .toUpperCase()
                              .replace(/[^A-Z0-9]/g, '')
                              .slice(0, 4)
                          )
                        }
                        placeholder="CODE"
                        maxLength={4}
                        aria-label="4-letter Party Room Code"
                        className="w-[54px] h-[24px] px-1.5 rounded bg-[#FFFDF7] border-[1.5px] border-[#111111] text-[10px] font-black uppercase text-center"
                      />
                      <button
                        type="button"
                        onClick={() => void handleJoinPartyLobby()}
                        className="flex-1 h-[24px] bg-[#7FD1AE] hover:bg-[#95E0BE] text-[#111111] border-[1.5px] border-[#111111] rounded px-2 text-[9.5px] font-black uppercase cursor-pointer"
                      >
                        {partyCodeInput.trim().length >= 3 ? 'JOIN ROOM' : 'HOST ROOM'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}
        </header>

        {/* Narrow-Viewport Fallback: Zero-Overlap In-Flow Quick-Guide Strip Above Carousel/CRT */}
        {showHowItWorks && helpPlacementMode === 'inline-top' && (
          <section
            ref={helpPanelRef}
            aria-label="How Bitgeist Works"
            className="w-full mb-2 bg-[#FFFDF7] border-[3px] border-[#111111] rounded-2xl px-3 py-2 shadow-[4px_4px_0px_#111111]"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10.5px] font-black uppercase tracking-tight min-w-0">
                <span className="bg-[#F5C342] border-[1.5px] border-[#111111] rounded px-1.5 py-0.5 leading-none shrink-0">
                  HOW IT WORKS
                </span>
                <span className="truncate text-[#111111]/80">Zero menus • Zero sign-up</span>
              </div>
              <button
                type="button"
                onClick={() => setShowHowItWorks(false)}
                aria-label="Dismiss Quick Guide"
                className="text-[10px] font-black uppercase bg-[#EAE2C8] hover:bg-[#FFE74C] border-[1.5px] border-[#111111] rounded px-2 py-0.5 leading-none cursor-pointer shrink-0 transition-colors"
              >
                ✕ GOT IT
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 mt-1.5 text-[10px] leading-tight">
              <div className="bg-[#F7EED7] border-[1.5px] border-[#111111] rounded-lg px-2 py-1.5">
                <span className="font-black uppercase">1. PICK A SEGMENT:</span>{' '}
                <span className="font-bold text-[#111111]/80">Click any room card to switch.</span>
              </div>
              <div className="bg-[#F7EED7] border-[1.5px] border-[#111111] rounded-lg px-2 py-1.5">
                <span className="font-black uppercase">2. BEAT #1 GHOST:</span>{' '}
                <span className="font-bold text-[#111111]/80">Press any key to race 1v1.</span>
              </div>
              <div className="bg-[#F7EED7] border-[1.5px] border-[#111111] rounded-lg px-2 py-1.5">
                <span className="font-black uppercase">3. DARE &amp; CLIP:</span>{' '}
                <span className="font-bold text-[#111111]/80">Share a dare link or 15s clip.</span>
              </div>
            </div>
          </section>
        )}

        {/* ===================================================================== */}
        {/* 1.5. INCOMING DARE BANNER & NARROW-VIEWPORT SEGMENT CAROUSEL          */}
        {/* ===================================================================== */}
        {showDareBanner && targetGhost && (
          <div className="w-full mb-2 bg-[#FFE74C] border-[3px] border-[#111111] rounded-xl px-3.5 py-1.5 shadow-[4px_4px_0px_#111111] flex flex-wrap sm:flex-nowrap items-center justify-between gap-2">
            <div className="text-xs font-black uppercase tracking-tight min-w-0 truncate">
              ⚔️ DARE FROM @{targetGhost.tag}:{' '}
              <span className="bg-[#FFFDF7] border-[1.5px] border-[#111111] rounded px-1.5 py-0.5">
                BEAT {(targetGhost.timeMs / 1000).toFixed(2)}s
              </span>{' '}
              ON {activeProfile.stageLabel}
            </div>
            <span className="text-[10px] font-black uppercase bg-[#111111] text-[#FFE74C] rounded px-2 py-0.5 whitespace-nowrap shrink-0">
              PRESS → TO ACCEPT
            </span>
          </div>
        )}

        {/* Compact Narrow-Viewport Fallback (< 960px): Harmonized Horizontal Segment & Top-10 Bars Above CRT */}
        {!showSidePanels && (
          <>
            <SprintLevelCarousel
              activeProfile={activeProfile}
              isAttractMode={isAttractMode}
              topTimesBySprintId={topTimesBySprintId}
              pbRevision={pbRevision}
              customSegments={customSegments}
              segmentCreatorStep={segmentCreatorStep}
              segmentDraftDistancePx={segmentDraftDistancePx}
              relayModeEnabled={relayModeEnabled}
              relayLegIndex={relayLegIndex}
              activeMutator={activeMutator}
              onCycleMutator={handleCycleMutator}
              collapsed={segmentCollapsed}
              onToggleCollapse={() => setSegmentCollapsed((v) => !v)}
              layout="horizontal"
              onSelectDaily={handleSelectDailyChallenge}
              onSelectCourse={handleSelectCourse}
              onSelectCustomSegment={handleSelectCustomSegment}
              onDeleteCustomSegment={handleDeleteCustomSegment}
              onStartSegmentCreator={handleStartSegmentCreator}
              onConfirmSegmentStart={() => void handleConfirmSegmentStart()}
              onConfirmSegmentFinish={() => void handleConfirmSegmentFinish()}
              onCancelSegmentCreator={handleCancelSegmentCreator}
              onStepLevel={handleStepCelesteLevel}
              onToggleRelayMode={handleToggleRelayMode}
            />
            <LeaderboardDrawer
              stageLabel={activeProfile.stageLabel}
              leaderboard={leaderboardRuns}
              mountainStandings={mountainStandings}
              totalRuns={leaderboardTotalRuns}
              activeTargetGhost={targetGhost}
              localPbGhost={localPbGhost}
              localPbMs={activeLocalPbMs}
              rivalMode={rivalMode}
              swarmEnabled={swarmEnabled}
              collapsed={topTenCollapsed}
              onToggleCollapse={() => setTopTenCollapsed((v) => !v)}
              playerTag={playerTag}
              identityInfo={identityInfo}
              layout="horizontal"
              onSelectTopRecord={handleSelectTopRecord}
              onSelectMyPb={handleSelectMyPb}
              onSelectCustomRival={handleSelectCustomRival}
              onWatchGhostReplay={handleWatchGhostReplay}
              onToggleSwarm={handleToggleSwarm}
              onRestoreClaimKey={handleRestoreClaimKey}
            />
          </>
        )}

        {/* ===================================================================== */}
        {/* 2. WIDESCREEN CONSOLE RIG (CRT SCREEN | PICK A SEGMENT + TOP 10)      */}
        {/* ===================================================================== */}
        <div
          className="w-full flex items-stretch"
          style={{ gap: showSidePanels ? `${sideRailGapPx}px` : undefined }}
        >
          <div className="flex-1 min-w-0 relative">
            <div className="crt-outer-coral">
              <div className="crt-outer-gold">
                <div className="relative p-[4px]">
                  {/* Corner Bezel Miter Lines */}
                  <div className="pointer-events-none absolute inset-0">
                    <svg
                      className="w-full h-full opacity-35"
                      preserveAspectRatio="none"
                      viewBox="0 0 100 100"
                    >
                      <line x1="0" y1="0" x2="3.5" y2="5.5" stroke="#000000" strokeWidth="0.6" />
                      <line x1="100" y1="0" x2="96.5" y2="5.5" stroke="#000000" strokeWidth="0.6" />
                      <line x1="0" y1="100" x2="3.5" y2="94.5" stroke="#000000" strokeWidth="0.6" />
                      <line x1="100" y1="100" x2="96.5" y2="94.5" stroke="#000000" strokeWidth="0.6" />
                    </svg>
                  </div>

                  {/* Charcoal CRT Screen Bezel */}
                  <div className="crt-charcoal-bezel w-full">
                    {/* High-Visibility Top-Bezel Speedrun Timer Docked Directly Above Active Game Screen */}
                    <div
                      className="h-[36px] mb-[8px] px-2.5 rounded-lg bg-[#09090D] border-2 border-[#111111] flex items-center justify-between gap-2 shadow-[inset_0_2px_6px_rgba(0,0,0,0.75)]"
                      aria-label="Live Speedrun Timer Bar"
                    >
                      <div className="flex-1 min-w-0 hidden sm:flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isAttractMode
                              ? 'bg-[#EC6553] shadow-[0_0_6px_#EC6553] animate-pulse'
                              : raceStatus === 'countdown'
                                ? 'bg-[#FFE74C] shadow-[0_0_6px_#FFE74C] animate-pulse'
                                : raceStatus === 'racing'
                                  ? 'bg-[#6BCB77] shadow-[0_0_6px_#6BCB77]'
                                  : raceStatus === 'won'
                                    ? 'bg-[#FFE74C] shadow-[0_0_6px_#FFE74C]'
                                    : 'bg-[#F5C342]/80'
                          }`}
                        />
                        <span className="text-[10px] font-black uppercase tracking-wider text-white/65 truncate">
                          {isAttractMode ? `DEMO • ${activeProfile.stageLabel}` : activeProfile.stageLabel}
                        </span>
                      </div>

                      <div
                        className={`mx-auto sm:mx-0 px-3 h-[26px] rounded border flex items-center justify-center min-w-[106px] transition-colors ${
                          raceStatus === 'won' && !isAttractMode
                            ? 'bg-[#7FD1AE] border-[#111111] text-[#111111]'
                            : 'bg-[#17161D] border-[#F5C342]/80 text-[#FFE74C]'
                        }`}
                        title={isAttractMode ? 'Top Speedrun Demo Clock' : 'Active Sprint Clock'}
                      >
                        <span className="text-base sm:text-lg font-black tabular-nums tracking-tight leading-none">
                          {raceStatus === 'won' && !isAttractMode ? `🏁 ${timerText}` : timerText}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0 hidden sm:flex items-center justify-end gap-1.5">
                        {!isAttractMode &&
                          segmentCreatorStep === 'idle' &&
                          targetGhost &&
                          (raceStatus === 'racing' || raceStatus === 'won') && (
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-black uppercase leading-none shrink-0 ${
                                liveRank === 1
                                  ? 'bg-[#7FD1AE] text-[#111111]'
                                  : 'bg-white/15 text-[#FFE74C]'
                              }`}
                            >
                              {liveRank === 1 ? 'AHEAD' : 'BEHIND'}
                            </span>
                          )}
                        {segmentCreatorStep !== 'idle' ? (
                          <span className="text-[10px] font-black uppercase tracking-tight text-[#7FD1AE] truncate">
                            ✂️ SEGMENT CREATOR
                          </span>
                        ) : isAttractMode && attractMeta ? (
                          <span className="text-[10px] font-black uppercase tracking-tight text-[#FFE74C] truncate">
                            {attractMeta.isDare ? '⚔️' : '👑'} @{attractMeta.tag}{' '}
                            {(attractMeta.timeMs / 1000).toFixed(2)}s
                          </span>
                        ) : targetGhost ? (
                          <span className="text-[10px] font-black uppercase tracking-tight text-[#FFE74C]/85 truncate">
                            {rivalMode === 'pb' ? '⚡ PB' : '👑'} @{targetGhost.tag}{' '}
                            {(targetGhost.timeMs / 1000).toFixed(2)}s
                          </span>
                        ) : (
                          <span className="text-[10px] font-black uppercase tracking-wider text-white/50">
                            1V1 SPEEDRUN
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Strictly Fixed 512x384 (4:3) Active Game Screen */}
                    <div
                      onClick={() => {
                        if (segmentCreatorStep !== 'idle') return;
                        if (raceStatus === 'waiting' || isAttractMode) {
                          startOrTakeoverLiveRace();
                        } else if (raceStatus === 'won' && !isVictoryOpen) {
                          clearPendingFinishModal();
                          crtTransitionRef.current?.setCurtainClosed(true);
                          setIsVictoryOpen(true);
                        } else if (raceStatus === 'error') {
                          handleSelectDailyChallenge();
                        }
                      }}
                      className="crt-curved-glass aspect-[4/3] w-full cursor-pointer"
                    >
                      {/* Live Libretro WebAssembly Core Canvas */}
                      <canvas
                        ref={emulatorCanvasRef}
                        width={512}
                        height={480}
                        className={`w-full h-full block object-fill ${
                          raceStatus === 'booting' ? 'opacity-0' : 'opacity-100'
                        } ${activeMutator === 'mirror' ? 'scale-x-[-1]' : ''}`}
                        style={{ imageRendering: 'pixelated' }}
                      />

                      {/* Transparent 60 FPS World-Space 1v1 #1 / PB / Top-10 Swarm / Party Ghost Overlay */}
                      <GhostCanvasOverlay
                        targetGhost={segmentCreatorStep === 'idle' ? targetGhost : null}
                        swarmGhosts={leaderboardRuns}
                        swarmEnabled={swarmEnabled}
                        partyRunners={partyLobby?.runners ?? []}
                        selfRunnerId={selfRunnerId}
                        practicePin={practicePin}
                        liveStateRef={liveStateRef}
                        overlayCanvasRef={ghostOverlayCanvasRef}
                      />

                      {/* 8-Bit NES-Grid CRT Run Start & Finish Transitions (Diagonal Tile Shutter, Spotlight Iris & Finish Letterbox) */}
                      <CrtTransitionOverlay transitionRef={crtTransitionRef} />

                      {/* Stage 8: Interactive Replay Studio & Instant Takeover Bar (Inside CRT Screen) */}
                      {isManualReplayActive &&
                        !isAttractMode &&
                        raceStatus !== 'booting' &&
                        raceStatus !== 'error' && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Replay Studio Controls"
                            className="absolute inset-x-2.5 bottom-2 z-[26] bg-[#111111]/92 border-2 border-[#FFE74C] rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-1.5 shadow-[3px_3px_0px_#111111]"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="bg-[#EC6553] text-white rounded px-1.5 py-0.5 text-[8.5px] font-black uppercase leading-none shrink-0">
                                REPLAY STUDIO
                              </span>
                              <span className="text-[9.5px] font-black tabular-nums text-[#FFE74C] truncate">
                                F{String(replayProgress.frame).padStart(4, '0')}/
                                {String(replayProgress.total).padStart(4, '0')}
                              </span>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={handleToggleReplayPause}
                                className="h-[21px] px-1.5 rounded bg-[#FFFDF7] hover:bg-[#FFE74C] text-[#111111] border border-[#111111] text-[9px] font-black uppercase leading-none cursor-pointer"
                              >
                                {replayPaused ? '▶ PLAY' : '⏸ PAUSE'}
                              </button>
                              <button
                                type="button"
                                onClick={handleStepReplayFrame}
                                className="h-[21px] px-1.5 rounded bg-[#EAE2C8] hover:bg-[#FFE74C] text-[#111111] border border-[#111111] text-[9px] font-black uppercase leading-none cursor-pointer"
                                title="Advance 1 deterministic frame"
                              >
                                +1F
                              </button>
                              <button
                                type="button"
                                onClick={handleCycleReplaySpeed}
                                className="h-[21px] px-1.5 rounded bg-[#FFE74C] hover:bg-[#FFD919] text-[#111111] border border-[#111111] text-[9px] font-black uppercase leading-none cursor-pointer"
                                title="Cycle replay speed (1x / 0.5x / 0.25x)"
                              >
                                {replaySpeed}X
                              </button>
                              <button
                                type="button"
                                onClick={handleTakeoverFromReplay}
                                className="h-[21px] px-2 rounded bg-[#7FD1AE] hover:bg-[#95E0BE] text-[#111111] border border-[#111111] text-[9px] font-black uppercase leading-none cursor-pointer"
                                title="Take live control from this exact frame"
                              >
                                ⚡ TAKE OVER
                              </button>
                            </div>
                          </div>
                        )}

                      {/* Non-Interactive Guidance Strip While Marking Custom Start -> Finish Bounds (Single Action Lives in PICK A SEGMENT) */}
                      {segmentCreatorStep !== 'idle' && (
                        <div className="pointer-events-none select-none absolute top-2.5 inset-x-3 z-[23] flex justify-center">
                          <div className="bg-[#111111]/88 border-2 border-[#FFE74C] rounded-lg px-3 py-1 text-[10px] font-black uppercase tracking-wide text-[#FFFDF7] shadow-[3px_3px_0px_#111111] truncate">
                            {segmentCreatorStep === 'mark-start'
                              ? '📍 MOVE TO YOUR START SPOT, THEN CLICK [1] SET START IN PANEL'
                              : `🏁 PLAY TO FINISH (+${segmentDraftDistancePx}PX), THEN CLICK [2] SET FINISH`}
                          </div>
                        </div>
                      )}

                      {/* Top-Docked Translucent CRT Replay Watermark (Zero Playfield Tag Collision & Zero Duplicated Bezel Text) */}
                      {isAttractMode && raceStatus !== 'booting' && raceStatus !== 'error' && (
                        <div
                          aria-label="Top Run Replay Watermark"
                          className="pointer-events-none select-none absolute inset-x-0 top-0 z-[15] pt-3 sm:pt-4 flex flex-col items-center px-6 text-center"
                        >
                          <div
                            className="flex items-center gap-2 text-[9.5px] sm:text-[10.5px] font-black uppercase tracking-[0.22em] text-[#FFE74C]/80"
                            style={{
                              textShadow: '0 1px 2px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9)',
                            }}
                          >
                            <span className="h-[1.5px] w-4 bg-[#FFE74C]/45 rounded-full" />
                            <span className="inline-block w-2 h-2 rounded-full bg-[#EC6553]/90 animate-pulse" />
                            <span>
                              {attractMeta?.isDare ? 'AUTO REPLAY • DARE' : 'AUTO REPLAY'}
                            </span>
                            <span className="h-[1.5px] w-4 bg-[#FFE74C]/45 rounded-full" />
                          </div>

                          <div
                            className="mt-0.5 text-[24px] sm:text-[32px] font-black uppercase tracking-[0.14em] leading-none text-white/[0.13]"
                            style={{
                              WebkitTextStroke: '1.65px rgba(255, 231, 76, 0.54)',
                              textShadow: '0 2px 6px rgba(0,0,0,0.85)',
                            }}
                          >
                            {attractMeta?.isDare ? 'DARE RUN' : '#1 TOP RUN'}
                          </div>
                        </div>
                      )}

                      {/* Arcade 3... 2... 1... GO! Pre-Race Countdown Card */}
                      {countdownDisplay !== null &&
                        !isAttractMode &&
                        raceStatus !== 'booting' &&
                        raceStatus !== 'error' && (
                          <div
                            aria-label="Pre-Race Countdown"
                            className="pointer-events-none select-none absolute inset-0 z-[24] flex items-center justify-center px-6 text-center"
                          >
                            <div
                              key={countdownDisplay}
                              className={
                                countdownDisplay === 'GO!'
                                  ? 'countdown-go-burst'
                                  : 'countdown-beat-pop'
                              }
                            >
                              <div
                                className={`px-6 py-2 rounded-2xl border-[4px] border-[#111111] shadow-[6px_6px_0px_#111111] text-[52px] sm:text-[66px] font-black uppercase leading-none tracking-tight ${
                                  countdownDisplay === '3'
                                    ? 'bg-[#EC6553] text-[#FFFDF7]'
                                    : countdownDisplay === '2'
                                      ? 'bg-[#F5C342] text-[#111111]'
                                      : countdownDisplay === '1'
                                        ? 'bg-[#FFE74C] text-[#111111]'
                                        : 'bg-[#7FD1AE] text-[#111111]'
                                }`}
                              >
                                {countdownDisplay}
                              </div>
                            </div>
                          </div>
                        )}

                      {/* Curved CRT Optical Glass Sheen */}
                      <div className="crt-glass-sheen pointer-events-none absolute inset-0 z-[25]" />

                      {/* Opaque Cold-Boot Warm-up or Retry Banner (Zero Fast-Forward / Story Bleed-Through!) */}
                      {(raceStatus === 'booting' || raceStatus === 'error') && (
                        <div className="absolute inset-0 z-30 bg-[#14131A] flex flex-col items-center justify-center p-4 text-center">
                          <div
                            className={`${
                              raceStatus === 'error'
                                ? 'bg-[#EC6553] text-white'
                                : 'bg-[#F7EED7] text-[#111111]'
                            } border-[3.5px] border-[#111111] rounded-xl px-5 py-3 shadow-[5px_5px_0px_#111111]`}
                          >
                            <div className="text-xs md:text-sm font-black uppercase">
                              {bootMessage}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Recessed Lower CRT Bezel Bar: Full-Width Launch / Starting Lights / Course Progress Track (Mobile-Only Retry) */}
                    <div
                      className="h-[36px] mt-[8px] px-2 rounded-lg bg-[#09090D] border-2 border-[#111111] flex items-center justify-between gap-2 shadow-[inset_0_2px_6px_rgba(0,0,0,0.75)]"
                      aria-label="Course Progress Bar"
                    >
                      <SprintBottomBannerTrack
                        raceStatus={isAttractMode ? 'waiting' : raceStatus}
                        activeSegments={activeSegments}
                        gamepadConnected={gamepadConnected}
                        countdownStep={countdownDisplay}
                        onStartRace={startOrTakeoverLiveRace}
                        onManualSyncStart={handleManualSyncStart}
                      />

                      <button
                        type="button"
                        onClick={handleManualRetry}
                        aria-label="Restart Sprint (R)"
                        title="Restart Sprint (Shortcut: R)"
                        className="sm:hidden w-[28px] h-[24px] rounded bg-[#EC6553] hover:bg-[#FF7866] text-[#111111] border border-[#111111] flex items-center justify-center cursor-pointer transition-colors shrink-0"
                      >
                        <RestartIcon size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right-Docked Unified Side Column: PICK A SEGMENT + Always-Visible TOP 10 */}
          {showSidePanels && (
            <div
              className="relative shrink-0"
              style={{ width: `${sideRailWidthPx}px` }}
            >
              <div className="absolute inset-0 flex flex-col gap-2.5">
                <SprintLevelCarousel
                  activeProfile={activeProfile}
                  isAttractMode={isAttractMode}
                  topTimesBySprintId={topTimesBySprintId}
                  pbRevision={pbRevision}
                  customSegments={customSegments}
                  segmentCreatorStep={segmentCreatorStep}
                  segmentDraftDistancePx={segmentDraftDistancePx}
                  relayModeEnabled={relayModeEnabled}
                  relayLegIndex={relayLegIndex}
                  activeMutator={activeMutator}
                  onCycleMutator={handleCycleMutator}
                  collapsed={segmentCollapsed}
                  expandedSolo={!segmentCollapsed && topTenCollapsed}
                  onToggleCollapse={() => setSegmentCollapsed((v) => !v)}
                  layout="vertical"
                  onSelectDaily={handleSelectDailyChallenge}
                  onSelectCourse={handleSelectCourse}
                  onSelectCustomSegment={handleSelectCustomSegment}
                  onDeleteCustomSegment={handleDeleteCustomSegment}
                  onStartSegmentCreator={handleStartSegmentCreator}
                  onConfirmSegmentStart={() => void handleConfirmSegmentStart()}
                  onConfirmSegmentFinish={() => void handleConfirmSegmentFinish()}
                  onCancelSegmentCreator={handleCancelSegmentCreator}
                  onStepLevel={handleStepCelesteLevel}
                  onToggleRelayMode={handleToggleRelayMode}
                />
                <LeaderboardDrawer
                  stageLabel={activeProfile.stageLabel}
                  leaderboard={leaderboardRuns}
                  mountainStandings={mountainStandings}
                  totalRuns={leaderboardTotalRuns}
                  activeTargetGhost={targetGhost}
                  localPbGhost={localPbGhost}
                  localPbMs={activeLocalPbMs}
                  rivalMode={rivalMode}
                  swarmEnabled={swarmEnabled}
                  collapsed={topTenCollapsed}
                  expandedSolo={!topTenCollapsed && segmentCollapsed}
                  onToggleCollapse={() => setTopTenCollapsed((v) => !v)}
                  playerTag={playerTag}
                  identityInfo={identityInfo}
                  layout="vertical"
                  onSelectTopRecord={handleSelectTopRecord}
                  onSelectMyPb={handleSelectMyPb}
                  onSelectCustomRival={handleSelectCustomRival}
                  onWatchGhostReplay={handleWatchGhostReplay}
                  onToggleSwarm={handleToggleSwarm}
                  onRestoreClaimKey={handleRestoreClaimKey}
                />
              </div>
            </div>
          )}
        </div>

        {/* ===================================================================== */}
        {/* 3. HARMONIZED CONSOLE CONTROL DECK (FLUSH DIRECTLY UNDER CRT)         */}
        {/* ===================================================================== */}
        <div
          style={{
            width: showSidePanels
              ? `calc(100% - ${singleSideRailExtraPx}px)`
              : '100%',
          }}
        >
          <ConsoleControlDeck
            consoleSystem={activeProfile.consoleSystem}
            visualInputMask={visualInputMask}
            rivalInputMask={rivalInputMask}
            isCelesteCourse={
              activeProfile.romId === DEFAULT_ROM_ID ||
              activeProfile.romId === CELESTE_GBA_ROM_ID
            }
            gamepadConnected={gamepadConnected}
            gamepadBrand={gamepadBrand}
            gamepadLabel={gamepadLabel}
            practicePinActive={Boolean(practicePin)}
            onPadInput={handleTouchPad}
            onRetry={handleManualRetry}
            onDropPracticePin={() => void handleDropPracticePin()}
            onWarpPracticePin={() => void handleWarpPracticePin()}
          />

          {/* Mobile Multi-Touch 8-Way Thumb-Slide D-Pad & Dash+Jump Chord Pad (< 640px) */}
          <MobileThumbChordControls
            visualInputMask={visualInputMask}
            isCelesteCourse={
              activeProfile.romId === DEFAULT_ROM_ID ||
              activeProfile.romId === CELESTE_GBA_ROM_ID
            }
            onPadInput={handleTouchPad}
          />
        </div>

        {/* Concise Single-Line Cartridge Credit */}
        <footer className="w-full mt-2 px-2 text-center text-[10.5px] font-bold text-[#111111]/60 whitespace-nowrap overflow-hidden text-ellipsis">
          {activeBuiltinCart
            ? activeBuiltinCart.authorCredit
            : `${activeProfile.title} • Runs locally in your browser`}
        </footer>
      </div>

      {/* Full-Viewport Victory, 15s Video Clip Export & Social Virality Modal */}
      <VictoryShareModal
        isOpen={isVictoryOpen}
        clientRunId={finishStats.clientRunId}
        savedSlug={finishStats.savedSlug}
        initialSavedTag={finishStats.initialSavedTag}
        timeMs={finishStats.timeMs}
        beatenCount={finishStats.beatenCount}
        totalGhosts={finishStats.totalGhosts}
        emojiStrip={finishStats.emojiStrip}
        romId={activeProfile.romId}
        consoleSystem={activeProfile.consoleSystem}
        sprintId={activeProfile.sprintId}
        romTitle={activeProfile.stageLabel}
        dailyNumber={activeProfile.dailyNumber}
        courseIndex={activeProfile.courseIndex}
        startWorldX={activeProfile.startWorldX}
        goalWorldX={activeProfile.goalWorldX}
        frames={finishStats.frames}
        inputLog={finishStats.inputLog}
        verified={finishStats.verified}
        isDare={Boolean(activeEffectiveDareSlug)}
        parentSlug={activeEffectiveDareSlug}
        rivalrySeries={rivalrySeries}
        relayLegTimesMs={completedRelayLegsMs}
        pbGhost={localPbGhost}
        targetGhost={finishStats.racedTargetGhost}
        playerTag={playerTag}
        replayClip={latestReplayClip}
        identityInfo={identityInfo}
        tagConflictMessage={tagConflictMessage}
        onChangeTag={handleUpdateTag}
        onIdentityUpdated={(nextIdentity, conflictMsg) => {
          setIdentityInfo(nextIdentity);
          setTagConflictMessage(conflictMsg ?? null);
        }}
        onRunSaved={() => void fetchGhostsForProfile(activeProfile)}
        onWatchInputReplay={handleWatchInputReplay}
        onRaceAgain={() =>
          void resetToStartingLine(false, { startCountdown: true, preserveHeldInputs: true })
        }
        onClose={() => void resetToStartingLine(false)}
      />

      {/* "Play Your Own ROM" Vault & Visual Segment Creator Popup */}
      <RomVaultModal
        isOpen={isRomModalOpen}
        activeProfile={activeProfile}
        vaultRoms={vaultRoms}
        missingDareCartTitle={missingDareCartTitle}
        externalError={dropError}
        onSelectBuiltinCeleste={() => handleSelectCartridge(HOMEBREW_CARTRIDGES[0])}
        onSelectVaultRom={handleLoadVaultRom}
        onDeleteVaultRom={handleDeleteVaultRom}
        onDropNewRomFile={handleDropRomFile}
        onStartSegmentCreator={handleStartSegmentCreator}
        onClose={() => {
          setDropError(null);
          setIsRomModalOpen(false);
        }}
      />
    </div>
  );
}
