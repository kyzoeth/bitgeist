import { NextRequest, NextResponse } from 'next/server';
import { GHOST_PALETTE, sanitizeArcadeTag } from '@/lib/ghostShare';
import { checkSlidingWindowRateLimit, extractClientIp } from '@/lib/rateLimit';
import { DEFAULT_ROM_ID } from '@/lib/romProfiles';
import type {
  LivePartyLobbyState,
  LivePartyReaction,
  LivePartyRunner,
  RaceStatus,
} from '@/lib/types';

const RUNNER_STALE_MS = 18_000;
const REACTION_STALE_MS = 8_000;
const LOBBY_STALE_MS = 15 * 60_000;
const MAX_LOBBIES = 200;
const MAX_RUNNERS_PER_LOBBY = 6;

const ALLOWED_EMOJIS = new Set(['🔥', '⚡', '👑', '💀', '🚀', '💎']);

const VALID_STATUSES = new Set<RaceStatus>([
  'booting',
  'pregame',
  'waiting',
  'countdown',
  'racing',
  'won',
  'error',
]);

interface InternalLobby {
  roomCode: string;
  sprintId: string;
  romId: string;
  hostRunnerId: string;
  countdownStartAtMs: number | null;
  updatedAtMs: number;
  runners: Map<string, LivePartyRunner>;
  reactions: LivePartyReaction[];
}

interface GlobalLobbyHolder {
  __bitgeistPartyLobbies?: Map<string, InternalLobby>;
}

const globalForLobbies = globalThis as unknown as GlobalLobbyHolder;

function getLobbyMap(): Map<string, InternalLobby> {
  if (!globalForLobbies.__bitgeistPartyLobbies) {
    globalForLobbies.__bitgeistPartyLobbies = new Map<string, InternalLobby>();
  }
  return globalForLobbies.__bitgeistPartyLobbies;
}

function normalizeRoomCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
}

function generateRoomCode(lobbies: Map<string, InternalLobby>): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 32; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    if (!lobbies.has(code)) return code;
  }
  return 'RACE';
}

function pruneLobbies(lobbies: Map<string, InternalLobby>, now: number): void {
  for (const [code, lobby] of lobbies.entries()) {
    for (const [rid, runner] of lobby.runners.entries()) {
      if (now - runner.updatedAtMs > RUNNER_STALE_MS) {
        lobby.runners.delete(rid);
      }
    }
    lobby.reactions = lobby.reactions.filter((r) => now - r.createdAtMs <= REACTION_STALE_MS);
    if (lobby.runners.size === 0 || now - lobby.updatedAtMs > LOBBY_STALE_MS) {
      lobbies.delete(code);
    } else if (!lobby.runners.has(lobby.hostRunnerId)) {
      const nextHost = lobby.runners.keys().next().value;
      if (nextHost) lobby.hostRunnerId = nextHost;
    }
  }
}

function serializeLobby(lobby: InternalLobby): LivePartyLobbyState {
  return {
    roomCode: lobby.roomCode,
    sprintId: lobby.sprintId,
    romId: lobby.romId,
    hostRunnerId: lobby.hostRunnerId,
    countdownStartAtMs: lobby.countdownStartAtMs,
    runners: Array.from(lobby.runners.values()).sort((a, b) => {
      if (a.finishTimeMs !== null && b.finishTimeMs !== null) {
        return a.finishTimeMs - b.finishTimeMs;
      }
      if (a.finishTimeMs !== null) return -1;
      if (b.finishTimeMs !== null) return 1;
      return b.worldX - a.worldX;
    }),
    reactions: lobby.reactions.slice(-8),
  };
}

export async function GET(req: NextRequest) {
  const now = Date.now();
  const lobbies = getLobbyMap();
  pruneLobbies(lobbies, now);

  const { searchParams } = new URL(req.url);
  const roomCode = normalizeRoomCode(searchParams.get('room'));
  if (!roomCode) {
    return NextResponse.json({ ok: true, lobby: null, serverNowMs: now });
  }

  const lobby = lobbies.get(roomCode);
  return NextResponse.json({
    ok: true,
    lobby: lobby ? serializeLobby(lobby) : null,
    serverNowMs: now,
  });
}

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const limit = checkSlidingWindowRateLimit({
    key: `lobby:post:${ip}`,
    maxRequests: 360,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Lobby rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  try {
    const body = (await req.json()) as {
      action?: 'join' | 'heartbeat' | 'startCountdown' | 'react' | 'leave';
      roomCode?: string;
      runnerId?: string;
      tag?: string;
      sprintId?: string;
      romId?: string;
      worldX?: number;
      worldY?: number;
      raceFrame?: number;
      status?: RaceStatus;
      finishTimeMs?: number | null;
      emoji?: string;
    };

    const now = Date.now();
    const lobbies = getLobbyMap();
    pruneLobbies(lobbies, now);

    const runnerId =
      typeof body.runnerId === 'string'
        ? body.runnerId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 36)
        : '';
    if (!runnerId) {
      return NextResponse.json({ error: 'Missing runnerId' }, { status: 400 });
    }

    let roomCode = normalizeRoomCode(body.roomCode);
    if (!roomCode && body.action === 'join') {
      roomCode = generateRoomCode(lobbies);
    }
    if (!roomCode) {
      return NextResponse.json({ error: 'Invalid roomCode' }, { status: 400 });
    }

    if (body.action === 'leave') {
      const existing = lobbies.get(roomCode);
      if (existing) {
        existing.runners.delete(runnerId);
        pruneLobbies(lobbies, now);
      }
      return NextResponse.json({ ok: true, lobby: null, serverNowMs: now });
    }

    let lobby = lobbies.get(roomCode);
    if (!lobby) {
      if (lobbies.size >= MAX_LOBBIES) {
        const oldestKey = lobbies.keys().next().value;
        if (oldestKey) lobbies.delete(oldestKey);
      }
      const romId =
        typeof body.romId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(body.romId)
          ? body.romId
          : DEFAULT_ROM_ID;
      const sprintId =
        typeof body.sprintId === 'string' && /^[a-zA-Z0-9:_-]{3,96}$/.test(body.sprintId)
          ? body.sprintId
          : romId;
      lobby = {
        roomCode,
        sprintId,
        romId,
        hostRunnerId: runnerId,
        countdownStartAtMs: null,
        updatedAtMs: now,
        runners: new Map<string, LivePartyRunner>(),
        reactions: [],
      };
      lobbies.set(roomCode, lobby);
    }

    lobby.updatedAtMs = now;
    if (
      runnerId === lobby.hostRunnerId &&
      typeof body.sprintId === 'string' &&
      /^[a-zA-Z0-9:_-]{3,96}$/.test(body.sprintId)
    ) {
      lobby.sprintId = body.sprintId;
    }

    const existingRunner = lobby.runners.get(runnerId);
    if (!existingRunner && lobby.runners.size >= MAX_RUNNERS_PER_LOBBY) {
      return NextResponse.json({ error: 'Lobby is full (max 6 runners)' }, { status: 409 });
    }

    const tag = sanitizeArcadeTag(body.tag || existingRunner?.tag || 'PLAYER');
    const color =
      existingRunner?.color ||
      GHOST_PALETTE[lobby.runners.size % GHOST_PALETTE.length] ||
      '#4CC9F0';
    const worldX = Number.isFinite(Number(body.worldX))
      ? Math.round(Number(body.worldX))
      : existingRunner?.worldX ?? 48;
    const worldY = Number.isFinite(Number(body.worldY))
      ? Math.round(Number(body.worldY))
      : existingRunner?.worldY ?? 180;
    const raceFrame = Number.isFinite(Number(body.raceFrame))
      ? Math.max(0, Math.round(Number(body.raceFrame)))
      : existingRunner?.raceFrame ?? 0;
    const status: RaceStatus =
      typeof body.status === 'string' && VALID_STATUSES.has(body.status)
        ? body.status
        : existingRunner?.status ?? 'waiting';
    const finishTimeMs =
      typeof body.finishTimeMs === 'number' && Number.isFinite(body.finishTimeMs)
        ? Math.max(1000, Math.round(body.finishTimeMs))
        : body.finishTimeMs === null
          ? null
          : existingRunner?.finishTimeMs ?? null;

    lobby.runners.set(runnerId, {
      runnerId,
      tag,
      color,
      worldX,
      worldY,
      raceFrame,
      status,
      finishTimeMs,
      updatedAtMs: now,
    });

    if (body.action === 'react' && typeof body.emoji === 'string' && ALLOWED_EMOJIS.has(body.emoji)) {
      lobby.reactions.push({
        id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
        tag,
        emoji: body.emoji,
        createdAtMs: now,
      });
      if (lobby.reactions.length > 16) {
        lobby.reactions = lobby.reactions.slice(-16);
      }
    }

    if (body.action === 'startCountdown') {
      lobby.countdownStartAtMs = now + 450;
      for (const [rid, r] of lobby.runners.entries()) {
        lobby.runners.set(rid, {
          ...r,
          finishTimeMs: null,
          raceFrame: 0,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      lobby: serializeLobby(lobby),
      serverNowMs: now,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid lobby request' }, { status: 400 });
  }
}
