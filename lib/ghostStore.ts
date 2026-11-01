import fsSync from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CELESTE_CHAMPION_REPLAYS } from './celesteDemoReplays';
import { getCourseByIndex, getDailySprintByNumber } from './dailySprints';
import { GHOST_PALETTE, sanitizeArcadeTag, tagToSlug } from './ghostShare';
import { computeFnv1aHex } from './inputReplay';
import {
  CELESTE_GBA_ROM_ID,
  CELESTE_ROM_ID,
  DEFAULT_PROFILE,
  DEFAULT_ROM_ID,
  NOVA_ROM_ID,
} from './romProfiles';
import type { ConsoleSystemId, GhostKeyframe, GhostRun } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DEFAULT_SQLITE_FILE = path.join(DATA_DIR, 'bitgeist.sqlite');
const LEGACY_GHOSTS_JSON = path.join(DATA_DIR, 'ghosts.json');
const MAX_STORED_RUNS_PER_SPRINT = 500;

export const DEFAULT_GHOST_PACK_SIZE = 1;

const SEED_NAMES = [
  'ALEX', 'MADELINE', 'THEO', 'BADELINE', 'KAI',
  'MIRA', 'ZED', 'PIXEL', 'RINA', 'LUMA',
];

const VALID_CONSOLE_SYSTEMS = new Set<ConsoleSystemId>(['nes', 'snes', 'genesis', 'gb', 'gba']);

interface GlobalSqliteHolder {
  __bitgeistSqliteStore?: {
    db: DatabaseSync;
    path: string;
  };
}

const globalForSqlite = globalThis as unknown as GlobalSqliteHolder;

function resolveDbPath(): string {
  return process.env.BITGEIST_DB_PATH?.trim() || DEFAULT_SQLITE_FILE;
}

function normalizeDareSlug(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
}

function hashFnv1a32(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashSprintOffset(sprintId: string): number {
  if (!sprintId || sprintId === DEFAULT_ROM_ID) return 0;
  return hashFnv1a32(sprintId) % 9973;
}

function buildShortRunCode(runId: string, salt = 0): string {
  const input = salt === 0 ? runId : `${runId}:${salt}`;
  const base36 = hashFnv1a32(input).toString(36).padStart(4, '0');
  return base36.slice(-4);
}

function buildUniqueDareSlug(tag: string, runId: string, salt = 0): string {
  const tagBase = tagToSlug(tag);
  return `${tagBase}-${buildShortRunCode(runId, salt)}`;
}

function allocateCollisionFreeSlug(db: DatabaseSync, tag: string, runId: string): string {
  const checkStmt = db.prepare('SELECT id FROM ghost_runs WHERE slug = ? LIMIT 1');
  for (let salt = 0; salt < 64; salt++) {
    const candidate = buildUniqueDareSlug(tag, runId, salt);
    const existing = checkStmt.get(candidate) as { id?: string } | undefined;
    if (!existing || existing.id === runId) {
      return candidate;
    }
  }
  return `${tagToSlug(tag)}-${Date.now().toString(36).slice(-5)}`;
}

function parseConsoleSystem(raw: unknown): ConsoleSystemId {
  if (typeof raw === 'string' && VALID_CONSOLE_SYSTEMS.has(raw as ConsoleSystemId)) {
    return raw as ConsoleSystemId;
  }
  return 'nes';
}

function parseFramesJson(raw: unknown): GhostKeyframe[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: GhostKeyframe[] = [];
    for (let i = 0; i < parsed.length && out.length < 900; i++) {
      const item = parsed[i];
      if (!Array.isArray(item) || item.length < 3) continue;
      const f = Number(item[0]);
      const x = Number(item[1]);
      const y = Number(item[2]);
      if (Number.isFinite(f) && Number.isFinite(x) && Number.isFinite(y)) {
        out.push([Math.round(f), Math.round(x), Math.round(y)]);
      }
    }
    return out;
  } catch {
    return [];
  }
}

function rowToGhostRun(row: Record<string, unknown>): GhostRun | null {
  const frames = parseFramesJson(row.frames_json);
  if (frames.length < 2) return null;

  const consoleSystem = parseConsoleSystem(row.console_system);
  const run: GhostRun = {
    id: String(row.id || ''),
    slug: String(row.slug || ''),
    tag: sanitizeArcadeTag(String(row.tag || 'PLAYER')),
    romId: String(row.rom_id || DEFAULT_ROM_ID),
    consoleSystem,
    sprintId: String(row.sprint_id || row.rom_id || DEFAULT_ROM_ID),
    romTitle: String(row.rom_title || DEFAULT_PROFILE.stageLabel),
    timeMs: Math.max(1000, Number(row.time_ms) || 14800),
    beatenCount: Math.max(0, Number(row.beaten_count) || 0),
    totalGhosts: Math.max(1, Number(row.total_ghosts) || DEFAULT_GHOST_PACK_SIZE),
    emojiReceipt: String(row.emoji_receipt || '⚡⚡⚡👑🏃💨🏁'),
    frames,
    color: String(row.color || '#4CC9F0'),
    createdAt: String(row.created_at || new Date().toISOString()),
  };

  if (typeof row.died_at_frame === 'number' && Number.isFinite(row.died_at_frame)) {
    run.diedAtFrame = Math.round(row.died_at_frame);
  }
  if (typeof row.daily_number === 'number' && Number.isFinite(row.daily_number)) {
    run.dailyNumber = Math.round(row.daily_number);
  }
  if (typeof row.course_index === 'number' && Number.isFinite(row.course_index)) {
    run.courseIndex = Math.round(row.course_index);
  }
  if (typeof row.start_world_x === 'number' && Number.isFinite(row.start_world_x)) {
    run.startWorldX = Math.round(row.start_world_x);
  }
  if (typeof row.goal_world_x === 'number' && Number.isFinite(row.goal_world_x)) {
    run.goalWorldX = Math.round(row.goal_world_x);
  }
  if (typeof row.input_log === 'string' && row.input_log) {
    run.inputLog = row.input_log;
  }
  if (typeof row.verified === 'number') {
    run.verified = row.verified === 1;
  }
  if (typeof row.input_digest === 'string' && row.input_digest) {
    run.inputDigest = row.input_digest;
  }

  return run;
}

function migrateLegacyJsonIfEmpty(db: DatabaseSync): void {
  const countRow = db.prepare('SELECT COUNT(*) AS cnt FROM ghost_runs').get() as
    | { cnt?: number | bigint }
    | undefined;
  const count = Number(countRow?.cnt ?? 0);
  if (count > 0 || !fsSync.existsSync(LEGACY_GHOSTS_JSON)) {
    return;
  }

  try {
    const raw = fsSync.readFileSync(LEGACY_GHOSTS_JSON, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return;

    const realRuns = (parsed as GhostRun[]).filter(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        !r.id.startsWith('seed-') &&
        Array.isArray(r.frames) &&
        r.frames.length >= 2
    );
    if (realRuns.length === 0) return;

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO ghost_runs (
        id, slug, tag, tag_slug, rom_id, console_system, sprint_id, rom_title,
        time_ms, beaten_count, total_ghosts, emoji_receipt, frames_json, died_at_frame,
        color, created_at, daily_number, course_index, start_world_x, goal_world_x,
        input_log, verified, input_digest
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )
    `);

    db.exec('BEGIN IMMEDIATE;');
    try {
      for (const r of realRuns) {
        const tag = sanitizeArcadeTag(r.tag || 'PLAYER');
        const tagSlug = tagToSlug(tag);
        const runId = r.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `legacy-${Date.now()}`;
        const uniqueSlug = allocateCollisionFreeSlug(db, tag, runId);
        const romId = r.romId || DEFAULT_ROM_ID;
        const sprintId = r.sprintId || romId;
        insertStmt.run(
          runId,
          uniqueSlug,
          tag,
          tagSlug,
          romId,
          parseConsoleSystem(r.consoleSystem),
          sprintId,
          r.romTitle || DEFAULT_PROFILE.stageLabel,
          Math.max(1000, Math.min(600_000, Math.round(r.timeMs || 14800))),
          Math.max(0, Math.round(r.beatenCount || 0)),
          Math.max(1, Math.round(r.totalGhosts || DEFAULT_GHOST_PACK_SIZE)),
          r.emojiReceipt || '⚡⚡⚡👑🏃💨🏁',
          JSON.stringify(r.frames.slice(0, 900)),
          typeof r.diedAtFrame === 'number' ? Math.round(r.diedAtFrame) : null,
          r.color || '#4CC9F0',
          r.createdAt || new Date().toISOString(),
          typeof r.dailyNumber === 'number' ? Math.round(r.dailyNumber) : null,
          typeof r.courseIndex === 'number' ? Math.round(r.courseIndex) : null,
          typeof r.startWorldX === 'number' ? Math.round(r.startWorldX) : null,
          typeof r.goalWorldX === 'number' ? Math.round(r.goalWorldX) : null,
          r.inputLog || null,
          r.verified ? 1 : 0,
          r.inputDigest || null
        );
      }
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  } catch (err) {
    console.warn('[ghostStore] Skipping legacy ghosts.json migration:', err);
  }
}

function resetCachedDb(): void {
  const existing = globalForSqlite.__bitgeistSqliteStore;
  globalForSqlite.__bitgeistSqliteStore = undefined;
  if (existing) {
    try {
      existing.db.close();
    } catch {
      // Ignore close error on stale handle reset
    }
  }
}

function getDb(): DatabaseSync {
  const targetPath = resolveDbPath();
  const cached = globalForSqlite.__bitgeistSqliteStore;
  if (cached && cached.path === targetPath) {
    return cached.db;
  }
  resetCachedDb();

  fsSync.mkdirSync(path.dirname(targetPath), { recursive: true });
  const db = new DatabaseSync(targetPath);

  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS ghost_runs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      tag TEXT NOT NULL,
      tag_slug TEXT NOT NULL,
      rom_id TEXT NOT NULL,
      console_system TEXT NOT NULL DEFAULT 'nes',
      sprint_id TEXT NOT NULL,
      rom_title TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      beaten_count INTEGER NOT NULL,
      total_ghosts INTEGER NOT NULL,
      emoji_receipt TEXT NOT NULL,
      frames_json TEXT NOT NULL,
      died_at_frame INTEGER,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      daily_number INTEGER,
      course_index INTEGER,
      start_world_x INTEGER,
      goal_world_x INTEGER,
      input_log TEXT,
      verified INTEGER NOT NULL DEFAULT 0,
      input_digest TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ghost_runs_sprint_time
      ON ghost_runs (sprint_id, time_ms ASC);
    CREATE INDEX IF NOT EXISTS idx_ghost_runs_slug
      ON ghost_runs (slug);
    CREATE INDEX IF NOT EXISTS idx_ghost_runs_tag_sprint
      ON ghost_runs (tag_slug, sprint_id, time_ms ASC);
  `);

  migrateLegacyJsonIfEmpty(db);

  globalForSqlite.__bitgeistSqliteStore = { db, path: targetPath };
  return db;
}

function withSqliteRetry<T>(operation: (db: DatabaseSync) => T): T {
  try {
    return operation(getDb());
  } catch {
    resetCachedDb();
    return operation(getDb());
  }
}

export function withGhostSqliteDb<T>(operation: (db: DatabaseSync) => T): T {
  return withSqliteRetry(operation);
}

export function getGhostStoreHealth(): {
  ok: boolean;
  driver: 'sqlite-wal';
  storedRuns: number;
} {
  const row = withSqliteRetry(
    (db) =>
      db.prepare('SELECT COUNT(*) AS cnt FROM ghost_runs').get() as
        | { cnt?: number | bigint }
        | undefined
  );
  return {
    ok: true,
    driver: 'sqlite-wal',
    storedRuns: Number(row?.cnt ?? 0),
  };
}

/**
 * Generates a realistic 60Hz-compatible 2D keyframe trajectory across multi-room CelesteNES
 * dash/climb courses (or horizontal multi-console sprints), with @ALEX at ~14.80s by default
 * and optional pace-scaling for high-skill speedrun matchmaking brackets.
 */
function buildSeedGhostRun(
  index: number,
  opts?: {
    romId?: string;
    consoleSystem?: ConsoleSystemId;
    sprintId?: string;
    romTitle?: string;
    startWorldX?: number;
    goalWorldX?: number;
    dailyNumber?: number;
    courseIndex?: number;
  }
): GhostRun {
  const romId = opts?.romId || DEFAULT_ROM_ID;
  const consoleSystem = opts?.consoleSystem || 'nes';
  const sprintId = opts?.sprintId || romId;
  const celesteCourse =
    romId === CELESTE_ROM_ID
      ? typeof opts?.dailyNumber === 'number'
        ? getDailySprintByNumber(opts.dailyNumber).course
        : getCourseByIndex(opts?.courseIndex)
      : null;

  const startX =
    typeof opts?.startWorldX === 'number'
      ? opts.startWorldX
      : celesteCourse?.startWorldX ?? DEFAULT_PROFILE.startWorldX;
  const goalWorldX =
    typeof opts?.goalWorldX === 'number'
      ? opts.goalWorldX
      : celesteCourse?.goalWorldX ?? DEFAULT_PROFILE.goalWorldX;
  const finishDeltaY =
    romId === CELESTE_GBA_ROM_ID ? -720 : celesteCourse?.finishDeltaY ?? 0;
  const romTitle = opts?.romTitle || celesteCourse?.stageLabel || DEFAULT_PROFILE.stageLabel;

  const tag = SEED_NAMES[index % SEED_NAMES.length];
  const isAlex = tag === 'ALEX';
  const idPrefix =
    sprintId === DEFAULT_ROM_ID
      ? 'seed'
      : `seed-${sprintId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32)}`;

  // Use deterministic bundled 60Hz inputLog champion replay for built-in CelesteNES courses when available
  const bundledChampion =
    romId === CELESTE_ROM_ID && isAlex
      ? CELESTE_CHAMPION_REPLAYS[celesteCourse?.courseIndex ?? 0]
      : undefined;

  if (bundledChampion) {
    const clonedFrames: GhostKeyframe[] = bundledChampion.frames.map(([f, x, y]) => [f, x, y]);
    return {
      id: `${idPrefix}-${tag.toLowerCase()}-${index}`,
      slug: tagToSlug(tag),
      tag,
      romId,
      consoleSystem,
      sprintId,
      romTitle,
      timeMs: bundledChampion.timeMs,
      beatenCount: 1,
      totalGhosts: 1,
      emojiReceipt: '⚡⚡⚡👑🏃💨🏁',
      frames: clonedFrames,
      color: '#FFE74C',
      createdAt: new Date(Date.now() - index * 120_000).toISOString(),
      dailyNumber: opts?.dailyNumber,
      courseIndex: celesteCourse?.courseIndex ?? opts?.courseIndex,
      startWorldX: startX,
      goalWorldX,
      inputLog: bundledChampion.inputLog,
      verified: true,
      inputDigest: computeFnv1aHex(
        `${romId}|${Math.round(bundledChampion.timeMs)}|${bundledChampion.inputLog}`
      ),
    };
  }

  const sprintSalt = hashSprintOffset(sprintId);
  let seed = (index + 1) * 7919 + sprintSalt * 31;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  const baseSpan = Math.max(400, DEFAULT_PROFILE.goalWorldX - DEFAULT_PROFILE.startWorldX);
  const actualSpan = Math.max(240, goalWorldX - startX);
  const rawScale = actualSpan / baseSpan;
  const distScale = Math.abs(rawScale - 1) < 0.08 ? 1 : Math.max(0.55, Math.min(2.6, rawScale));

  // ALEX runs an exciting, beatable ~14.80s multi-room sprint (or exact bundled champion time);
  // seed rivals #2..#10 pace cleanly behind ALEX so #1 is always authoritative until beaten by a player.
  const NOVA_SEED_TOP_MS: Readonly<Record<number, number>> = {
    0: 13650,
    1: 14420,
    2: 15180,
    3: 14950,
  };
  const GBA_SEED_TOP_MS: Readonly<Record<number, number>> = {
    0: 13850,
    1: 15240,
    2: 16480,
    3: 17150,
  };
  const courseIdxForSeed = celesteCourse?.courseIndex ?? opts?.courseIndex ?? 0;
  const alexChampionTimeMs =
    romId === CELESTE_ROM_ID
      ? CELESTE_CHAMPION_REPLAYS[courseIdxForSeed]?.timeMs
      : romId === NOVA_ROM_ID
        ? NOVA_SEED_TOP_MS[courseIdxForSeed]
        : romId === CELESTE_GBA_ROM_ID
          ? GBA_SEED_TOP_MS[courseIdxForSeed]
          : undefined;
  const alexBaselineMs = alexChampionTimeMs ?? Math.round(14800 * distScale);
  const targetTimeMs = isAlex
    ? alexBaselineMs
    : Math.round(alexBaselineMs + index * 480 + rand() * 520);
  const totalFrames = Math.max(180, Math.round((targetTimeMs / 1000) * 60));
  const baseScreenY = romId === CELESTE_ROM_ID || romId === CELESTE_GBA_ROM_ID ? 180 : 192;

  const roomClimbSteps =
    Math.abs(finishDeltaY) >= 180 ? Math.max(1, Math.round(Math.abs(finishDeltaY) / 240)) : 0;

  const computeRoomRelY = (p: number): number => {
    if (finishDeltaY === 0) return 0;
    if (roomClimbSteps <= 0) {
      return finishDeltaY * p;
    }
    const perStep = finishDeltaY / roomClimbSteps;
    let accY = 0;
    for (let s = 1; s <= roomClimbSteps; s++) {
      const center = s / (roomClimbSteps + 0.35);
      const t = Math.max(0, Math.min(1, (p - (center - 0.055)) / 0.11));
      const smooth = t * t * (3 - 2 * t);
      accY += perStep * smooth;
    }
    return accY;
  };

  const frames: GhostKeyframe[] = [];
  const dashZones = [0.16, 0.34, 0.54, 0.72, 0.88];

  if (romId === CELESTE_GBA_ROM_ID) {
    // 3-room vertical PICO-8 playfield climb centered inside GBA's 240x160 frame (screenX 72..180 per room)
    for (let f = 0; f <= totalFrames; f += 3) {
      const progress = Math.min(1, f / totalFrames);
      const scaled = progress * 3;
      const roomsClimbed = progress >= 1 ? 3 : Math.min(2, Math.floor(scaled));
      const roomProg = progress >= 1 ? 0 : scaled - roomsClimbed;
      const localX = Math.round(
        126 + Math.sin(roomProg * Math.PI * 1.6 + index * 0.9) * 44
      );
      const worldX = progress >= 1 ? goalWorldX : roomsClimbed * 256 + localX;
      const localY = progress >= 1 ? 180 : Math.round(186 - roomProg * 156);
      const worldY = -roomsClimbed * 240 + localY;
      frames.push([f, worldX, worldY]);
    }
  } else {
    for (let f = 0; f <= totalFrames; f += 3) {
      const progress = Math.min(1, f / totalFrames);
      const wobble = isAlex ? 0 : Math.sin(progress * Math.PI * 3 + index) * 12;
      const worldX = Math.round(
        Math.max(startX, Math.min(goalWorldX, startX + (goalWorldX - startX) * progress + wobble))
      );

      const roomY = computeRoomRelY(progress);
      let localY = baseScreenY;
      for (const dz of dashZones) {
        const dist = Math.abs(progress - dz);
        if (dist < 0.055) {
          const norm = 1 - dist / 0.055;
          localY = baseScreenY - Math.sin(norm * Math.PI) * (42 + (index % 3) * 9);
        }
      }

      frames.push([f, worldX, Math.round(roomY + localY)]);
    }
  }

  const finalY = Math.round(finishDeltaY + baseScreenY);
  const last = frames[frames.length - 1];
  if (last && last[0] === totalFrames) {
    frames[frames.length - 1] = [totalFrames, goalWorldX, finalY];
  } else {
    frames.push([totalFrames, goalWorldX, finalY]);
  }

  return {
    id: `${idPrefix}-${tag.toLowerCase()}-${index}`,
    slug: tagToSlug(tag),
    tag,
    romId,
    consoleSystem,
    sprintId,
    romTitle,
    timeMs: targetTimeMs,
    beatenCount: 1,
    totalGhosts: 1,
    emojiReceipt: '⚡⚡⚡👑🏃💨🏁',
    frames,
    color: isAlex ? '#FFE74C' : GHOST_PALETTE[index % GHOST_PALETTE.length],
    createdAt: new Date(Date.now() - index * 120_000).toISOString(),
    dailyNumber: opts?.dailyNumber,
    courseIndex: celesteCourse?.courseIndex ?? opts?.courseIndex,
    startWorldX: startX,
    goalWorldX,
  };
}

interface GetGhostsQueryOptions {
  sprintId?: string;
  startWorldX?: number;
  goalWorldX?: number;
  romTitle?: string;
  dailyNumber?: number;
  courseIndex?: number;
  consoleSystem?: ConsoleSystemId;
}

function queryUniqueStoredRunsForSprint(
  db: DatabaseSync,
  sprintId: string
): { uniqueRuns: GhostRun[]; totalUniqueRunners: number } {
  const countRow = db
    .prepare(
      `SELECT COUNT(DISTINCT tag_slug) AS cnt
       FROM ghost_runs
       WHERE sprint_id = ? AND died_at_frame IS NULL`
    )
    .get(sprintId) as { cnt?: number | bigint } | undefined;

  const rows = db
    .prepare(
      `SELECT * FROM ghost_runs
       WHERE sprint_id = ? AND died_at_frame IS NULL
       ORDER BY time_ms ASC, verified DESC, created_at ASC
       LIMIT 60`
    )
    .all(sprintId);

  const seenTags = new Set<string>();
  const uniqueRuns: GhostRun[] = [];
  for (const r of rows) {
    const parsed = rowToGhostRun(r);
    if (!parsed) continue;
    const tSlug = tagToSlug(parsed.tag);
    if (seenTags.has(tSlug)) continue;
    seenTags.add(tSlug);
    uniqueRuns.push(parsed);
    if (uniqueRuns.length >= 15) break;
  }

  return {
    uniqueRuns,
    totalUniqueRunners: Math.max(uniqueRuns.length, Number(countRow?.cnt ?? 0)),
  };
}

function buildMergedLeaderboard(
  storedUniqueRuns: GhostRun[],
  storedTotalUniqueRunners: number,
  seedOpts: {
    romId: string;
    consoleSystem: ConsoleSystemId;
    sprintId: string;
    romTitle: string;
    startWorldX: number;
    goalWorldX: number;
    dailyNumber?: number;
    courseIndex?: number;
  }
): { leaderboard: GhostRun[]; totalRuns: number } {
  const byTag = new Map<string, GhostRun>();
  for (const run of storedUniqueRuns) {
    const key = tagToSlug(run.tag);
    const existing = byTag.get(key);
    if (!existing || run.timeMs < existing.timeMs) {
      byTag.set(key, run);
    }
  }

  let unreplacedSeeds = 0;
  for (let i = 0; i < SEED_NAMES.length; i++) {
    const seedRun = buildSeedGhostRun(i, seedOpts);
    const key = tagToSlug(seedRun.tag);
    const existing = byTag.get(key);
    if (!existing) {
      byTag.set(key, seedRun);
      unreplacedSeeds++;
    } else if (seedRun.timeMs < existing.timeMs && seedRun.verified && !existing.verified) {
      byTag.set(key, seedRun);
    }
  }

  const sorted = Array.from(byTag.values()).sort((a, b) => {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    if (Boolean(a.verified) !== Boolean(b.verified)) return a.verified ? -1 : 1;
    return 0;
  });

  return {
    leaderboard: sorted.slice(0, 10),
    totalRuns: Math.max(sorted.length, storedTotalUniqueRunners + unreplacedSeeds),
  };
}

export function getTop10CutoffTimeMs(
  romId: string,
  opts?: GetGhostsQueryOptions
): number {
  const effectiveSprintId = opts?.sprintId || romId;
  const consoleSystem = opts?.consoleSystem || 'nes';
  const startWorldX =
    typeof opts?.startWorldX === 'number'
      ? opts.startWorldX
      : romId === DEFAULT_ROM_ID
        ? DEFAULT_PROFILE.startWorldX
        : 48;
  const goalWorldX =
    typeof opts?.goalWorldX === 'number'
      ? opts.goalWorldX
      : romId === DEFAULT_ROM_ID
        ? DEFAULT_PROFILE.goalWorldX
        : 1280;
  const romTitle = opts?.romTitle || DEFAULT_PROFILE.stageLabel;

  let storedUniqueRuns: GhostRun[] = [];
  let totalUniqueRunners = 0;
  try {
    const queried = withSqliteRetry((db) => queryUniqueStoredRunsForSprint(db, effectiveSprintId));
    storedUniqueRuns = queried.uniqueRuns;
    totalUniqueRunners = queried.totalUniqueRunners;
  } catch {
    storedUniqueRuns = [];
  }

  const { leaderboard } = buildMergedLeaderboard(storedUniqueRuns, totalUniqueRunners, {
    romId,
    consoleSystem,
    sprintId: effectiveSprintId,
    romTitle,
    startWorldX,
    goalWorldX,
    dailyNumber: opts?.dailyNumber,
    courseIndex: opts?.courseIndex,
  });

  if (leaderboard.length < 10) return Number.POSITIVE_INFINITY;
  return leaderboard[leaderboard.length - 1]?.timeMs ?? Number.POSITIVE_INFINITY;
}

function findStoredRunBySlugOrTag(
  db: DatabaseSync,
  cleanSlug: string,
  sprintId?: string,
  romId?: string
): GhostRun | null {
  if (!cleanSlug) return null;

  // 1. Exact unique slug lookup (e.g. "ali-7x2k")
  if (sprintId) {
    const exactInSprint = db
      .prepare('SELECT * FROM ghost_runs WHERE slug = ? AND sprint_id = ? LIMIT 1')
      .get(cleanSlug, sprintId);
    if (exactInSprint) {
      const parsed = rowToGhostRun(exactInSprint);
      if (parsed) return parsed;
    }
  }

  const exactAny = db.prepare('SELECT * FROM ghost_runs WHERE slug = ? LIMIT 1').get(cleanSlug);
  if (exactAny) {
    const parsed = rowToGhostRun(exactAny);
    if (parsed) return parsed;
  }

  // 2. Backwards-compatible plain-tag lookup (e.g. "/vs/alex" or "/vs/ali" -> fastest PB for that tag)
  if (!cleanSlug.includes('-')) {
    if (sprintId) {
      const tagInSprint = db
        .prepare(
          `SELECT * FROM ghost_runs
           WHERE tag_slug = ? AND sprint_id = ?
           ORDER BY time_ms ASC
           LIMIT 1`
        )
        .get(cleanSlug, sprintId);
      if (tagInSprint) {
        const parsed = rowToGhostRun(tagInSprint);
        if (parsed) return parsed;
      }
    }

    if (romId) {
      const tagInRom = db
        .prepare(
          `SELECT * FROM ghost_runs
           WHERE tag_slug = ? AND rom_id = ?
           ORDER BY time_ms ASC
           LIMIT 1`
        )
        .get(cleanSlug, romId);
      if (tagInRom) {
        const parsed = rowToGhostRun(tagInRom);
        if (parsed) return parsed;
      }
    }

    const tagAny = db
      .prepare(
        `SELECT * FROM ghost_runs
         WHERE tag_slug = ?
         ORDER BY time_ms ASC
         LIMIT 1`
      )
      .get(cleanSlug);
    if (tagAny) {
      const parsed = rowToGhostRun(tagAny);
      if (parsed) return parsed;
    }
  }

  return null;
}

export async function getGhostsForRom(
  romId: string,
  dareSlug?: string,
  opts?: GetGhostsQueryOptions
): Promise<{
  ghosts: GhostRun[];
  targetGhost: GhostRun | null;
  leaderboard: GhostRun[];
  totalRuns: number;
}> {
  const effectiveSprintId = opts?.sprintId || romId;
  const consoleSystem = opts?.consoleSystem || 'nes';
  const normalizedSlug = dareSlug ? normalizeDareSlug(dareSlug) : '';

  const startWorldX =
    typeof opts?.startWorldX === 'number'
      ? opts.startWorldX
      : romId === DEFAULT_ROM_ID
        ? DEFAULT_PROFILE.startWorldX
        : 48;
  const goalWorldX =
    typeof opts?.goalWorldX === 'number'
      ? opts.goalWorldX
      : romId === DEFAULT_ROM_ID
        ? DEFAULT_PROFILE.goalWorldX
        : 1280;
  const romTitle =
    opts?.romTitle ||
    (romId === DEFAULT_ROM_ID
      ? DEFAULT_PROFILE.stageLabel
      : `CUSTOM ${consoleSystem.toUpperCase()} SPRINT`);

  const seedOpts = {
    romId,
    consoleSystem,
    sprintId: effectiveSprintId,
    romTitle,
    startWorldX,
    goalWorldX,
    dailyNumber: opts?.dailyNumber,
    courseIndex: opts?.courseIndex,
  };

  let storedUniqueRuns: GhostRun[] = [];
  let totalUniqueRunners = 0;
  try {
    const queried = withSqliteRetry((db) => queryUniqueStoredRunsForSprint(db, effectiveSprintId));
    storedUniqueRuns = queried.uniqueRuns;
    totalUniqueRunners = queried.totalUniqueRunners;
  } catch {
    storedUniqueRuns = [];
  }

  const { leaderboard, totalRuns } = buildMergedLeaderboard(
    storedUniqueRuns,
    totalUniqueRunners,
    seedOpts
  );

  const alexSeed =
    leaderboard.find((r) => tagToSlug(r.tag) === 'alex') || buildSeedGhostRun(0, seedOpts);

  // 1. Incoming /vs/[slug] Dare Link -> race 1v1 against the Dare Challenger's Ghost
  let targetGhost: GhostRun | null = null;
  if (normalizedSlug) {
    try {
      targetGhost = withSqliteRetry((db) =>
        findStoredRunBySlugOrTag(db, normalizedSlug, effectiveSprintId, romId)
      );
    } catch {
      targetGhost = null;
    }
    if (!targetGhost) {
      const baseSlug = normalizedSlug.split('-')[0];
      const seedIdx = SEED_NAMES.findIndex((name) => tagToSlug(name) === baseSlug);
      if (seedIdx >= 0) {
        targetGhost = buildSeedGhostRun(seedIdx, seedOpts);
      }
    }
  }

  // 2. Standard Sprint -> race 1v1 against the #1 Top Score Ghost on the Leaderboard
  if (!targetGhost) {
    const topStored = storedUniqueRuns[0] ?? null;
    if (romId !== DEFAULT_ROM_ID && topStored) {
      targetGhost = topStored.timeMs <= (leaderboard[0]?.timeMs ?? topStored.timeMs)
        ? topStored
        : leaderboard[0] ?? topStored;
    } else {
      targetGhost = leaderboard[0] ?? alexSeed;
    }
  }

  const crownedTarget = targetGhost ? { ...targetGhost, color: '#FFE74C' } : null;
  return {
    ghosts: crownedTarget ? [crownedTarget] : [],
    targetGhost: crownedTarget,
    leaderboard,
    totalRuns,
  };
}

export async function findGhostBySlug(slug: string, sprintId?: string): Promise<GhostRun | null> {
  const clean = normalizeDareSlug(slug);
  if (!clean) return null;

  try {
    const stored = withSqliteRetry((db) => findStoredRunBySlugOrTag(db, clean, sprintId));
    if (stored) return stored;
  } catch {
    // Fall back to deterministic seed or stateless token
  }

  // Fallback to deterministic seed rival when querying "/vs/alex", "/vs/madeline", etc.
  const seedIdx = SEED_NAMES.findIndex((name) => tagToSlug(name) === clean);
  if (seedIdx >= 0) {
    let dailyNumber: number | undefined;
    let courseIndex: number | undefined;
    if (sprintId && /^daily-\d+$/.test(sprintId)) {
      dailyNumber = Number(sprintId.slice(6));
    } else if (sprintId) {
      const courseMatch = /:c(\d+)$/.exec(sprintId);
      if (courseMatch) {
        courseIndex = Number(courseMatch[1]);
      }
    }
    return buildSeedGhostRun(seedIdx, {
      romId: DEFAULT_ROM_ID,
      sprintId: sprintId || DEFAULT_ROM_ID,
      dailyNumber,
      courseIndex,
    });
  }

  return null;
}

export async function saveGhostRun(input: {
  clientRunId?: string;
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
  dailyNumber?: number;
  courseIndex?: number;
  startWorldX?: number;
  goalWorldX?: number;
  inputLog?: string;
  verified?: boolean;
  inputDigest?: string;
}): Promise<GhostRun> {
  return withSqliteRetry((db) => {
    const tag = sanitizeArcadeTag(input.tag);
  const tagSlug = tagToSlug(tag);
  const consoleSystem = parseConsoleSystem(input.consoleSystem);
  const effectiveSprintId = input.sprintId || input.romId;
  const clampedTimeMs = Math.max(1000, Math.min(600_000, Math.round(input.timeMs)));
  const clampedBeaten = Math.max(0, Math.round(input.beatenCount));
  const clampedTotal = Math.max(1, Math.round(input.totalGhosts));
  const boundedFrames = input.frames.slice(0, 900);

  const cleanClientRunId = input.clientRunId
    ? input.clientRunId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
    : '';

  const existingRaw = cleanClientRunId
    ? db.prepare('SELECT * FROM ghost_runs WHERE id = ? LIMIT 1').get(cleanClientRunId)
    : undefined;
  const existingRun = existingRaw ? rowToGhostRun(existingRaw) : null;

  // Anti-hijack check: only allow updating an existing clientRunId row (when renaming Arcade Tag in
  // VictoryShareModal) if romId and timeMs match the originally recorded run!
  const canUpdateExisting =
    Boolean(existingRun) &&
    existingRun?.romId === input.romId &&
    existingRun?.timeMs === clampedTimeMs;

  const runId =
    cleanClientRunId && (!existingRun || canUpdateExisting)
      ? cleanClientRunId
      : `run-${tagSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const uniqueSlug = allocateCollisionFreeSlug(db, tag, runId);

  if (canUpdateExisting && existingRun) {
    db.prepare(
      `UPDATE ghost_runs
       SET slug = ?, tag = ?, tag_slug = ?
       WHERE id = ?`
    ).run(uniqueSlug, tag, tagSlug, runId);

    return {
      ...existingRun,
      slug: uniqueSlug,
      tag,
    };
  }

  const color = GHOST_PALETTE[Math.floor(Math.random() * GHOST_PALETTE.length)];
  const createdAt = new Date().toISOString();

  const run: GhostRun = {
    id: runId,
    slug: uniqueSlug,
    tag,
    romId: input.romId,
    consoleSystem,
    sprintId: effectiveSprintId,
    romTitle: input.romTitle,
    timeMs: clampedTimeMs,
    beatenCount: clampedBeaten,
    totalGhosts: clampedTotal,
    emojiReceipt: input.emojiReceipt,
    frames: boundedFrames,
    color,
    createdAt,
    ...(typeof input.dailyNumber === 'number' ? { dailyNumber: input.dailyNumber } : {}),
    ...(typeof input.courseIndex === 'number' ? { courseIndex: input.courseIndex } : {}),
    ...(typeof input.startWorldX === 'number' ? { startWorldX: input.startWorldX } : {}),
    ...(typeof input.goalWorldX === 'number' ? { goalWorldX: input.goalWorldX } : {}),
    ...(input.inputLog ? { inputLog: input.inputLog } : {}),
    ...(typeof input.verified === 'boolean' ? { verified: input.verified } : {}),
    ...(input.inputDigest ? { inputDigest: input.inputDigest } : {}),
  };

  db.exec('BEGIN IMMEDIATE;');
  try {
    db.prepare(
      `INSERT INTO ghost_runs (
        id, slug, tag, tag_slug, rom_id, console_system, sprint_id, rom_title,
        time_ms, beaten_count, total_ghosts, emoji_receipt, frames_json, died_at_frame,
        color, created_at, daily_number, course_index, start_world_x, goal_world_x,
        input_log, verified, input_digest
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?
      )`
    ).run(
      run.id,
      run.slug,
      run.tag,
      tagSlug,
      run.romId,
      consoleSystem,
      effectiveSprintId,
      run.romTitle,
      run.timeMs,
      run.beatenCount,
      run.totalGhosts,
      run.emojiReceipt,
      JSON.stringify(run.frames),
      null,
      run.color,
      run.createdAt,
      typeof run.dailyNumber === 'number' ? run.dailyNumber : null,
      typeof run.courseIndex === 'number' ? run.courseIndex : null,
      typeof run.startWorldX === 'number' ? run.startWorldX : null,
      typeof run.goalWorldX === 'number' ? run.goalWorldX : null,
      run.inputLog ?? null,
      run.verified ? 1 : 0,
      run.inputDigest ?? null
    );

    // Per-sprint bounded retention: keep top/recent 500 runs per sprint so disk stays compact
    db.prepare(
      `DELETE FROM ghost_runs
       WHERE sprint_id = ?
         AND id NOT IN (
           SELECT id FROM ghost_runs
           WHERE sprint_id = ?
           ORDER BY verified DESC, time_ms ASC, created_at DESC
           LIMIT ?
         )`
    ).run(effectiveSprintId, effectiveSprintId, MAX_STORED_RUNS_PER_SPRINT);

    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

    return run;
  });
}
