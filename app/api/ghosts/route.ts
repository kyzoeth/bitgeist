import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_GHOST_PACK_SIZE,
  getGhostsForRom,
  getMountainStandings,
  getRivalrySeriesSummary,
  getTop10CutoffTimeMs,
  listCommunitySegmentsForRom,
  saveGhostRun,
  upsertCommunitySegment,
} from '@/lib/ghostStore';
import { isHeadlessWasmSupportedRom, verifyNesRunHeadless } from '@/lib/headlessVerifier';
import { verifyGhostRunIntegrity } from '@/lib/inputReplay';
import {
  attachIdentityCookie,
  getOrCreateOwnerSession,
  resolveTagForSubmission,
} from '@/lib/playerIdentity';
import { checkSlidingWindowRateLimit, extractClientIp } from '@/lib/rateLimit';
import { DEFAULT_PROFILE, DEFAULT_ROM_ID, resolveRomProfile } from '@/lib/romProfiles';
import { ConsoleSystemId, CustomRomSegment, GhostKeyframe } from '@/lib/types';

const VALID_CONSOLE_SYSTEMS = new Set<ConsoleSystemId>(['nes', 'snes', 'genesis', 'gb', 'gba']);
const MAX_POST_BODY_CHARS = 131_072; // 128 KB hard guard

function parseConsoleSystemParam(raw: unknown): ConsoleSystemId | undefined {
  if (typeof raw === 'string' && VALID_CONSOLE_SYSTEMS.has(raw as ConsoleSystemId)) {
    return raw as ConsoleSystemId;
  }
  return undefined;
}

function sanitizeKeyframes(rawFrames: unknown): GhostKeyframe[] {
  if (!Array.isArray(rawFrames)) return [];
  const valid: GhostKeyframe[] = [];
  for (let i = 0; i < rawFrames.length && valid.length < 900; i++) {
    const item = rawFrames[i];
    if (!Array.isArray(item) || item.length < 3) continue;
    const f = Number(item[0]);
    const x = Number(item[1]);
    const y = Number(item[2]);
    if (
      Number.isFinite(f) &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      f >= 0 &&
      f <= 36_000 &&
      x >= -2048 &&
      x <= 65_535 &&
      y >= -4096 &&
      y <= 4096
    ) {
      valid.push([Math.round(f), Math.round(x), Math.round(y)]);
    }
  }
  return valid;
}

function parseOptionalBoundedInt(raw: unknown, min: number, max: number): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

export async function GET(req: NextRequest) {
  const ip = extractClientIp(req);
  const limit = checkSlidingWindowRateLimit({
    key: `ghosts:get:${ip}`,
    maxRequests: 180,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many leaderboard requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawRomId = searchParams.get('romId') || '';
  const romId = /^[a-zA-Z0-9_-]{8,64}$/.test(rawRomId) ? rawRomId : DEFAULT_ROM_ID;
  const dare = searchParams.get('dare') || undefined;

  const rawSprintId = searchParams.get('sprintId') || '';
  const sprintId = /^[a-zA-Z0-9:_-]{3,96}$/.test(rawSprintId) ? rawSprintId : undefined;
  const startWorldX = parseOptionalBoundedInt(searchParams.get('sx'), 0, 65_535);
  const goalWorldX = parseOptionalBoundedInt(searchParams.get('gx'), 160, 65_535);
  const dailyNumber = parseOptionalBoundedInt(searchParams.get('dn'), 1, 99_999);
  const courseIndex = parseOptionalBoundedInt(searchParams.get('lv'), 0, 99);
  const consoleSystem = parseConsoleSystemParam(searchParams.get('cs'));
  const rawTitle = searchParams.get('title');
  const romTitle = rawTitle ? rawTitle.trim().slice(0, 40) : undefined;

  const data = await getGhostsForRom(romId, dare, {
    sprintId,
    startWorldX,
    goalWorldX,
    dailyNumber,
    courseIndex,
    romTitle,
    consoleSystem,
  });
  const communitySegments = listCommunitySegmentsForRom(romId);
  const mountainStandings = getMountainStandings(romId);
  return NextResponse.json({
    ...data,
    communitySegments,
    mountainStandings,
  });
}

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const limit = checkSlidingWindowRateLimit({
    key: `ghosts:post:${ip}`,
    maxRequests: 24,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded for ghost submissions. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_POST_BODY_CHARS) {
      return NextResponse.json({ error: 'Ghost run payload exceeds 128KB limit' }, { status: 413 });
    }

    let body: {
      action?: string;
      segment?: CustomRomSegment;
      clientRunId?: string;
      tag?: string;
      romId?: string;
      consoleSystem?: string;
      sprintId?: string;
      romTitle?: string;
      timeMs?: number;
      beatenCount?: number;
      totalGhosts?: number;
      emojiReceipt?: string;
      frames?: unknown;
      dailyNumber?: number;
      courseIndex?: number;
      startWorldX?: number;
      goalWorldX?: number;
      inputLog?: string;
      parentSlug?: string;
      rivalTag?: string;
    };
    try {
      body = JSON.parse(rawBody) as typeof body;
    } catch {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }

    if (body?.action === 'saveSegment' && body.segment) {
      const seg = body.segment;
      if (
        typeof seg.romId !== 'string' ||
        !/^[a-zA-Z0-9_-]{8,64}$/.test(seg.romId) ||
        typeof seg.sprintId !== 'string' ||
        !/^[a-zA-Z0-9:_-]{3,96}$/.test(seg.sprintId)
      ) {
        return NextResponse.json({ error: 'Invalid custom segment metadata' }, { status: 400 });
      }
      const communitySegments = upsertCommunitySegment(seg);
      return NextResponse.json({ ok: true, communitySegments });
    }

    const frames = sanitizeKeyframes(body?.frames);
    if (frames.length < 2) {
      return NextResponse.json({ error: 'Invalid ghost telemetry frames' }, { status: 400 });
    }

    const romId =
      typeof body.romId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(body.romId)
        ? body.romId
        : DEFAULT_ROM_ID;

    const consoleHint = parseConsoleSystemParam(body.consoleSystem);

    const sprintId =
      typeof body.sprintId === 'string' && /^[a-zA-Z0-9:_-]{3,96}$/.test(body.sprintId)
        ? body.sprintId
        : romId;

    const romTitle =
      (typeof body.romTitle === 'string' ? body.romTitle.trim().slice(0, 40) : '') ||
      DEFAULT_PROFILE.stageLabel;

    const rawTime = Number(body.timeMs);
    if (!Number.isFinite(rawTime) || rawTime < 1000 || rawTime > 600_000) {
      return NextResponse.json(
        { error: 'Run duration falls outside physically valid bounds' },
        { status: 422 }
      );
    }
    const claimedTimeMs = Math.round(rawTime);

    const profile = resolveRomProfile(romId, romTitle, undefined, consoleHint);
    const rawInputLog =
      typeof body.inputLog === 'string' && body.inputLog.length <= 16_384
        ? body.inputLog.trim() || undefined
        : undefined;

    const integrity = verifyGhostRunIntegrity({
      romId,
      timeMs: claimedTimeMs,
      frames,
      maxPxPerFrame: profile.maxPxPerFrame,
      inputLog: rawInputLog,
    });

    if (!integrity.ok && integrity.hardReject) {
      return NextResponse.json(
        { error: integrity.reason || 'Run failed physics integrity check' },
        { status: 422 }
      );
    }

    const dailyNumber = parseOptionalBoundedInt(body.dailyNumber, 1, 99_999);
    const courseIndex = parseOptionalBoundedInt(body.courseIndex, 0, 99);
    const startWorldX = parseOptionalBoundedInt(body.startWorldX, 0, 65_535);
    const goalWorldX = parseOptionalBoundedInt(body.goalWorldX, 160, 65_535);

    let authoritativeTimeMs = claimedTimeMs;
    let verified = integrity.verified;

    if (isHeadlessWasmSupportedRom(romId)) {
      const top10CutoffMs = getTop10CutoffTimeMs(romId, {
        sprintId,
        startWorldX,
        goalWorldX,
        dailyNumber,
        courseIndex,
        romTitle,
        consoleSystem: profile.consoleSystem,
      });
      const isTop10Candidate = claimedTimeMs <= top10CutoffMs;

      if (isTop10Candidate || Boolean(rawInputLog)) {
        const wasmCheck = await verifyNesRunHeadless({
          romId,
          sprintId,
          claimedTimeMs,
          inputLog: rawInputLog || '',
          courseIndex,
          dailyNumber,
          goalWorldX,
        });

        if (wasmCheck.supported) {
          if (!wasmCheck.ok) {
            if (isTop10Candidate || Boolean(rawInputLog)) {
              return NextResponse.json(
                {
                  error:
                    wasmCheck.reason ||
                    'Run failed deterministic headless WASM replay verification',
                },
                { status: 422 }
              );
            }
            verified = false;
          } else {
            verified = true;
            authoritativeTimeMs = wasmCheck.simulatedTimeMs ?? claimedTimeMs;
          }
        }
      }
    }

    const rawTotal = Number(body.totalGhosts);
    const totalGhosts =
      Number.isFinite(rawTotal) && rawTotal >= 1 && rawTotal <= 1000
        ? Math.round(rawTotal)
        : DEFAULT_GHOST_PACK_SIZE;

    const rawBeaten = Number(body.beatenCount);
    const beatenCount =
      Number.isFinite(rawBeaten) && rawBeaten >= 0
        ? Math.min(totalGhosts, Math.round(rawBeaten))
        : 0;

    const emojiReceipt =
      typeof body.emojiReceipt === 'string' && body.emojiReceipt.trim()
        ? body.emojiReceipt.trim().slice(0, 48)
        : '⚡⚡⚡👑🏃💨🏁';

    const session = getOrCreateOwnerSession(req);
    const tagResolution = resolveTagForSubmission({
      ownerId: session.ownerId,
      requestedTag: typeof body.tag === 'string' ? body.tag : 'PLAYER',
      dailyNumber,
    });

    const saved = await saveGhostRun({
      clientRunId: typeof body.clientRunId === 'string' ? body.clientRunId : undefined,
      tag: tagResolution.assignedTag,
      romId,
      consoleSystem: profile.consoleSystem,
      sprintId,
      romTitle,
      timeMs: authoritativeTimeMs,
      beatenCount,
      totalGhosts,
      emojiReceipt,
      frames,
      dailyNumber,
      courseIndex,
      startWorldX,
      goalWorldX,
      inputLog: verified ? rawInputLog : undefined,
      verified,
      inputDigest: integrity.inputDigest,
      parentSlug: typeof body.parentSlug === 'string' ? body.parentSlug : undefined,
    });

    const rivalrySeries =
      typeof body.rivalTag === 'string' && body.rivalTag.trim()
        ? getRivalrySeriesSummary(
            sprintId,
            saved.tag,
            body.rivalTag,
            typeof body.parentSlug === 'string' ? body.parentSlug : null
          )
        : undefined;

    const res = NextResponse.json({
      run: saved,
      identity: tagResolution.identity,
      tagConflict: tagResolution.tagConflict,
      ...(rivalrySeries ? { rivalrySeries } : {}),
    });
    attachIdentityCookie(res, session.ownerId);
    return res;
  } catch (err) {
    console.error('[POST /api/ghosts]', err);
    return NextResponse.json({ error: 'Failed to save ghost run' }, { status: 500 });
  }
}
