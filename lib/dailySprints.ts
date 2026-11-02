import { type BuiltinCartridgeKey, CELESTE_NES_ROM_ID } from './homebrewCatalog';
import type { ConsoleSystemId, RoomMedalInfo } from './types';

interface SprintCourse {
  courseIndex: number;
  worldIndex: number;
  stageIndex: number;
  code: string;
  name: string;
  stageLabel: string;
  startWorldX: number;
  goalWorldX: number;
  startWarp?: number;
  goalWarps?: readonly number[];
  finishDeltaY?: number;
  warpYMap?: Readonly<Record<number, number>>;
}

/**
 * 6 disassembly-verified multi-room dash sprint courses in CelesteNES (demo-1.00 by iProgramInCpp).
 * Chapter indices ($050A: 0 = Prologue, 1 = Forsaken City, 2 = Old Site), room warp indices ($053B/$053C),
 * 16-bit continuous camera X ($0067:$00CC anchored at $4000), and layout.txt relative Y room offsets
 * were verified directly from the CelesteNES 6502 assembly source and celeste.nes ROM.
 */
export const CELESTE_SPRINT_COURSES: readonly SprintCourse[] = [
  {
    courseIndex: 0,
    worldIndex: 1,
    stageIndex: 0, // Forsaken City r1 -> r2 -> r3 -> r3b/r4 (3-4 rooms)
    startWarp: 0,
    goalWarps: [4],
    code: '1-A',
    name: 'FIRST STEPS',
    stageLabel: 'CELESTE 1-A • FIRST STEPS',
    startWorldX: 16,
    goalWorldX: 996,
    finishDeltaY: -720,
    warpYMap: {
      0: 0,
      1: -240,
      2: -480,
      3: -720,
      4: -960,
    },
  },
  {
    courseIndex: 1,
    worldIndex: 1,
    stageIndex: 8, // Forsaken City r6 -> r6a -> r6b -> r6c
    startWarp: 8,
    goalWarps: [28, 29],
    code: '1-B',
    name: 'CITY CROSSING',
    stageLabel: 'CELESTE 1-B • CITY CROSSING',
    startWorldX: 32,
    goalWorldX: 1264,
    finishDeltaY: -240,
    warpYMap: {
      8: 0,
      12: 0,
      15: 0,
      16: -96,
      21: 0,
      22: -240,
      23: -272,
      28: -480,
      29: -240,
    },
  },
  {
    courseIndex: 2,
    worldIndex: 1,
    stageIndex: 40, // Forsaken City r8b -> r9 -> r9b
    startWarp: 40,
    goalWarps: [54, 55, 56],
    code: '1-C',
    name: 'CHASM RIDGE',
    stageLabel: 'CELESTE 1-C • CHASM RIDGE',
    startWorldX: 12,
    goalWorldX: 824,
    finishDeltaY: -320,
    warpYMap: {
      40: 0,
      49: -240,
      52: -320,
      53: -240,
      54: -560,
      55: -320,
      56: -560,
    },
  },
  {
    courseIndex: 3,
    worldIndex: 2,
    stageIndex: 16, // Old Site Dream Blocks d6 -> d0a/d0b -> d2/d7 -> d2b/d8
    startWarp: 16,
    goalWarps: [49, 52, 53],
    code: '2-A',
    name: 'DREAM BLOCKS',
    stageLabel: 'CELESTE 2-A • DREAM BLOCKS',
    startWorldX: 32,
    goalWorldX: 1216,
    finishDeltaY: -208,
    warpYMap: {
      16: 0,
      30: -128,
      31: 112,
      27: 32,
      28: 112,
      29: -208,
      40: -128,
      42: 32,
      44: -128,
      45: -208,
      39: 32,
      48: -208,
      49: -272,
      51: 32,
      52: -32,
      53: 144,
    },
  },
  {
    courseIndex: 4,
    worldIndex: 2,
    stageIndex: 73, // Old Site Ruins r2 -> r11 -> r12bp -> r12b
    startWarp: 73,
    goalWarps: [80, 81, 82],
    code: '2-B',
    name: 'OLD SITE RUINS',
    stageLabel: 'CELESTE 2-B • OLD SITE RUINS',
    startWorldX: 24,
    goalWorldX: 1340,
    finishDeltaY: 0,
    warpYMap: {
      73: 0,
      74: 0,
      75: 0,
      76: 0,
      77: 0,
      78: 0,
      79: 0,
      80: 0,
      81: 0,
      82: 0,
    },
  },
  {
    courseIndex: 5,
    worldIndex: 0,
    stageIndex: 0, // Prologue Woods r1 -> r2 -> r3 (finishes cleanly before 1080px bird cutscene)
    startWarp: 0,
    goalWarps: [5],
    code: '0-1',
    name: 'PROLOGUE WOODS',
    stageLabel: 'CELESTE 0-1 • PROLOGUE WOODS',
    startWorldX: 16,
    goalWorldX: 984,
    finishDeltaY: -80,
    warpYMap: {
      0: 0,
      1: -16,
      2: 0,
      3: -80,
      4: -16,
      5: -112,
    },
  },
];

// Epoch: 2026-09-20T00:00:00Z -> rotates deterministically across all 6 CelesteNES courses at 00:00 UTC
const DAILY_EPOCH_UTC_MS = Date.UTC(2026, 8, 20);
const MS_PER_DAY = 86_400_000;
const DAILY_PB_STORAGE_KEY = 'bitgeist_daily_pb_celeste_v1';
const SPRINT_PB_STORAGE_KEY = 'bitgeist_sprint_pb_v1';

export interface DailySprintChallenge {
  dailyNumber: number;
  badgeText: string;
  sprintId: string;
  course: SprintCourse;
  headerStageLabel: string;
  cartridgeKey: BuiltinCartridgeKey;
  romId: string;
  consoleSystem: ConsoleSystemId;
  romUrl: string;
  fileName: string;
}

export function formatDailyNumber(dailyNumber: number): string {
  return `#${String(Math.max(1, Math.round(dailyNumber))).padStart(3, '0')}`;
}

export function getCourseByIndex(courseIndex?: number): SprintCourse {
  if (typeof courseIndex === 'number') {
    const found = CELESTE_SPRINT_COURSES.find((c) => c.courseIndex === courseIndex);
    if (found) return found;
  }
  return CELESTE_SPRINT_COURSES[0];
}

export function getDailySprintByNumber(dailyNumber: number): DailySprintChallenge {
  const safeNum = Math.max(1, Math.round(dailyNumber));
  const badgeText = formatDailyNumber(safeNum);
  const course = CELESTE_SPRINT_COURSES[(safeNum - 1) % CELESTE_SPRINT_COURSES.length];
  return {
    dailyNumber: safeNum,
    badgeText,
    sprintId: `daily-${safeNum}`,
    course,
    headerStageLabel: `${badgeText} • CELESTE ${course.code}`,
    cartridgeKey: 'celeste-nes',
    romId: CELESTE_NES_ROM_ID,
    consoleSystem: 'nes',
    romUrl: '/roms/celeste.nes',
    fileName: 'celeste.nes',
  };
}

export function getDailySprintForDate(now: Date = new Date()): DailySprintChallenge {
  const utcMidnightMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceEpoch = Math.floor((utcMidnightMs - DAILY_EPOCH_UTC_MS) / MS_PER_DAY);
  const dailyNumber = Math.max(1, daysSinceEpoch + 1);
  return getDailySprintByNumber(dailyNumber);
}

export function getLocalDailyPbMs(dailyNumber: number): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DAILY_PB_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, number>;
    const val = map[String(dailyNumber)];
    return typeof val === 'number' && Number.isFinite(val) && val >= 1000 ? val : null;
  } catch {
    return null;
  }
}

export function recordLocalDailyPbMs(dailyNumber: number, timeMs: number): number {
  const rounded = Math.max(1000, Math.round(timeMs));
  if (typeof window === 'undefined') return rounded;
  try {
    const raw = localStorage.getItem(DAILY_PB_STORAGE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const key = String(dailyNumber);
    const prev = map[key];
    const best = typeof prev === 'number' && prev >= 1000 ? Math.min(prev, rounded) : rounded;
    map[key] = best;

    // Prune older entries beyond the most recent 45 dailies to keep localStorage tiny
    const keys = Object.keys(map)
      .map(Number)
      .filter(Number.isFinite)
      .sort((a, b) => b - a);
    const trimmed: Record<string, number> = {};
    for (const k of keys.slice(0, 45)) {
      trimmed[String(k)] = map[String(k)];
    }
    localStorage.setItem(DAILY_PB_STORAGE_KEY, JSON.stringify(trimmed));
    recordLocalSprintPbMs(`daily-${dailyNumber}`, best);
    return best;
  } catch {
    return rounded;
  }
}

export function getLocalSprintPbMs(sprintId: string): number | null {
  if (typeof window === 'undefined' || !sprintId) return null;
  try {
    const raw = localStorage.getItem(SPRINT_PB_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, { pbMs: number; updatedAt: number } | number>;
    const entry = map[sprintId];
    const val = typeof entry === 'number' ? entry : entry?.pbMs;
    return typeof val === 'number' && Number.isFinite(val) && val >= 1000 ? val : null;
  } catch {
    return null;
  }
}

export function recordLocalSprintPbMs(sprintId: string, timeMs: number): number {
  const rounded = Math.max(1000, Math.round(timeMs));
  if (typeof window === 'undefined' || !sprintId) return rounded;
  try {
    const raw = localStorage.getItem(SPRINT_PB_STORAGE_KEY);
    const parsed = raw
      ? (JSON.parse(raw) as Record<string, { pbMs: number; updatedAt: number } | number>)
      : {};
    const prevEntry = parsed[sprintId];
    const prevVal = typeof prevEntry === 'number' ? prevEntry : prevEntry?.pbMs;
    const best =
      typeof prevVal === 'number' && Number.isFinite(prevVal) && prevVal >= 1000
        ? Math.min(prevVal, rounded)
        : rounded;

    const normalized: Array<[string, { pbMs: number; updatedAt: number }]> = [];
    const now = Date.now();
    for (const [k, v] of Object.entries(parsed)) {
      if (k === sprintId) continue;
      const pb = typeof v === 'number' ? v : v?.pbMs;
      const ts = typeof v === 'object' && v && typeof v.updatedAt === 'number' ? v.updatedAt : 0;
      if (typeof pb === 'number' && Number.isFinite(pb) && pb >= 1000) {
        normalized.push([k, { pbMs: pb, updatedAt: ts }]);
      }
    }
    normalized.push([sprintId, { pbMs: best, updatedAt: now }]);
    normalized.sort((a, b) => b[1].updatedAt - a[1].updatedAt);

    const trimmed: Record<string, { pbMs: number; updatedAt: number }> = {};
    for (const [k, v] of normalized.slice(0, 80)) {
      trimmed[k] = v;
    }
    localStorage.setItem(SPRINT_PB_STORAGE_KEY, JSON.stringify(trimmed));
    return best;
  } catch {
    return rounded;
  }
}

/**
 * Evaluates a Trackmania-style 4-tier speedrun medal (`💎 DEV`, `🥇 GOLD`, `🥈 SILVER`, `🥉 BRONZE`)
 * relative to a segment's #1 benchmark time (`topBenchmarkMs`).
 */
export function evaluateRoomMedal(
  timeMs: number | null | undefined,
  topBenchmarkMs: number
): RoomMedalInfo {
  const devMs = Math.max(1000, Math.round(topBenchmarkMs));
  const goldMs = Math.round(devMs * 1.07);
  const silverMs = Math.round(devMs * 1.18);

  if (typeof timeMs !== 'number' || !Number.isFinite(timeMs) || timeMs < 1000) {
    return {
      tier: 'none',
      emoji: '⚪',
      label: 'UNRANKED',
      nextTier: 'bronze',
      nextEmoji: '🥉',
      nextLabel: 'BRONZE',
      nextTargetMs: silverMs,
    };
  }

  const rounded = Math.round(timeMs);
  if (rounded <= devMs) {
    return {
      tier: 'dev',
      emoji: '💎',
      label: 'DEV MEDAL',
    };
  }
  if (rounded <= goldMs) {
    return {
      tier: 'gold',
      emoji: '🥇',
      label: 'GOLD MEDAL',
      nextTier: 'dev',
      nextEmoji: '💎',
      nextLabel: 'DEV',
      nextTargetMs: devMs,
      msToNext: rounded - devMs,
    };
  }
  if (rounded <= silverMs) {
    return {
      tier: 'silver',
      emoji: '🥈',
      label: 'SILVER MEDAL',
      nextTier: 'gold',
      nextEmoji: '🥇',
      nextLabel: 'GOLD',
      nextTargetMs: goldMs,
      msToNext: rounded - goldMs,
    };
  }
  return {
    tier: 'bronze',
    emoji: '🥉',
    label: 'BRONZE MEDAL',
    nextTier: 'silver',
    nextEmoji: '🥈',
    nextLabel: 'SILVER',
    nextTargetMs: silverMs,
    msToNext: rounded - silverMs,
  };
}
