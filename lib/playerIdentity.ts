import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { NextRequest, NextResponse } from 'next/server';
import { sanitizeArcadeTag, tagToSlug } from './ghostShare';
import { withGhostSqliteDb } from './ghostStore';
import type { ArcadeIdentityInfo } from './types';

export const IDENTITY_COOKIE_NAME = 'bg_sid';
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;
const RESERVED_BOT_TAG_SLUGS = new Set(['alex']);
const MAX_TAGS_PER_OWNER = 5;

let cachedHmacSecret: string | null = null;
const initializedTablesForDb: WeakSet<DatabaseSync> = new WeakSet();

function resolveSecretFilePath(): string {
  const dbPath =
    process.env.BITGEIST_DB_PATH?.trim() ||
    path.join(process.cwd(), 'data', 'bitgeist.sqlite');
  return path.join(path.dirname(dbPath), '.bitgeist_identity_secret');
}

function getIdentityHmacSecret(): string {
  const envSecret = process.env.BITGEIST_IDENTITY_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (cachedHmacSecret) {
    return cachedHmacSecret;
  }
  const secretPath = resolveSecretFilePath();
  try {
    if (fs.existsSync(secretPath)) {
      const existing = fs.readFileSync(secretPath, 'utf8').trim();
      if (existing.length >= 32) {
        cachedHmacSecret = existing;
        return existing;
      }
    }
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(secretPath, generated, { mode: 0o600 });
    cachedHmacSecret = generated;
    return generated;
  } catch {
    cachedHmacSecret = 'bitgeist-fallback-local-dev-hmac-secret-v1';
    return cachedHmacSecret;
  }
}

function ensureIdentityTables(db: DatabaseSync): void {
  if (initializedTablesForDb.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS arcade_tags (
      tag_slug TEXT PRIMARY KEY,
      tag TEXT NOT NULL,
      owner_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_arcade_tags_owner
      ON arcade_tags (owner_hash, updated_at DESC);

    CREATE TABLE IF NOT EXISTS arcade_sessions (
      owner_hash TEXT PRIMARY KEY,
      streak_count INTEGER NOT NULL DEFAULT 0,
      last_daily_number INTEGER,
      updated_at TEXT NOT NULL
    );
  `);
  initializedTablesForDb.add(db);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signOwnerCookieValue(ownerId: string): string {
  const sig = crypto
    .createHmac('sha256', getIdentityHmacSecret())
    .update(`sid:${ownerId}`)
    .digest('hex')
    .slice(0, 32);
  return `${ownerId}.${sig}`;
}

export function verifyOwnerCookieValue(rawCookie: string | undefined): string | null {
  if (!rawCookie || typeof rawCookie !== 'string') return null;
  const dot = rawCookie.indexOf('.');
  if (dot <= 0) return null;
  const ownerId = rawCookie.slice(0, dot).toLowerCase();
  const providedSig = rawCookie.slice(dot + 1).toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(ownerId) || !/^[a-f0-9]{32}$/.test(providedSig)) {
    return null;
  }
  const expected = signOwnerCookieValue(ownerId).slice(dot + 1);
  try {
    const a = Buffer.from(providedSig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    return ownerId;
  } catch {
    return null;
  }
}

export function buildBackupClaimKey(ownerId: string): string {
  const cleanOwner = ownerId.toLowerCase();
  const check = crypto
    .createHmac('sha256', getIdentityHmacSecret())
    .update(`backup-v1:${cleanOwner}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
  return `BG1-${cleanOwner.toUpperCase()}-${check}`;
}

export function verifyBackupClaimKey(rawKey: string): string | null {
  if (typeof rawKey !== 'string') return null;
  const normalized = rawKey.trim().toUpperCase();
  const match = /^BG1-([A-F0-9]{32})-([A-F0-9]{10})$/.exec(normalized);
  if (!match) return null;
  const ownerId = match[1].toLowerCase();
  const expectedKey = buildBackupClaimKey(ownerId);
  try {
    const a = Buffer.from(normalized, 'utf8');
    const b = Buffer.from(expectedKey, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return null;
    }
    return ownerId;
  } catch {
    return null;
  }
}

export function getOrCreateOwnerSession(req: NextRequest): {
  ownerId: string;
  cookieValue: string;
  isNewSession: boolean;
} {
  const existingCookie = req.cookies.get(IDENTITY_COOKIE_NAME)?.value;
  const verifiedOwnerId = verifyOwnerCookieValue(existingCookie);
  if (verifiedOwnerId) {
    return {
      ownerId: verifiedOwnerId,
      cookieValue: existingCookie!,
      isNewSession: false,
    };
  }
  const freshOwnerId = crypto.randomBytes(16).toString('hex');
  return {
    ownerId: freshOwnerId,
    cookieValue: signOwnerCookieValue(freshOwnerId),
    isNewSession: true,
  };
}

export function attachIdentityCookie(res: NextResponse, ownerId: string): void {
  res.cookies.set({
    name: IDENTITY_COOKIE_NAME,
    value: signOwnerCookieValue(ownerId),
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SEC,
  });
}

function allocateAvailableFallbackTag(db: DatabaseSync, baseTag: string): string {
  const stem = sanitizeArcadeTag(baseTag).replace(/_?\d+$/, '').slice(0, 6) || 'RUNNER';
  const checkStmt = db.prepare('SELECT tag_slug FROM arcade_tags WHERE tag_slug = ? LIMIT 1');
  for (let n = 2; n <= 99; n++) {
    const candidate = sanitizeArcadeTag(`${stem}_${n}`);
    const slug = tagToSlug(candidate);
    if (RESERVED_BOT_TAG_SLUGS.has(slug)) continue;
    const hit = checkStmt.get(slug);
    if (!hit) return candidate;
  }
  const randSuffix = Math.floor(100 + Math.random() * 900);
  return sanitizeArcadeTag(`${stem.slice(0, 5)}${randSuffix}`);
}

function updateDailyStreakInTx(
  db: DatabaseSync,
  ownerHash: string,
  dailyNumber?: number
): { streakCount: number; lastDailyNumber: number | null } {
  const existing = db
    .prepare(
      'SELECT streak_count, last_daily_number FROM arcade_sessions WHERE owner_hash = ? LIMIT 1'
    )
    .get(ownerHash) as
    | { streak_count?: number; last_daily_number?: number | null }
    | undefined;

  let streakCount = Math.max(0, Number(existing?.streak_count ?? 0));
  let lastDaily =
    typeof existing?.last_daily_number === 'number' ? existing.last_daily_number : null;

  if (typeof dailyNumber === 'number' && Number.isFinite(dailyNumber) && dailyNumber >= 1) {
    const dn = Math.round(dailyNumber);
    if (lastDaily === null) {
      streakCount = 1;
      lastDaily = dn;
    } else if (dn === lastDaily) {
      streakCount = Math.max(1, streakCount);
    } else if (dn === lastDaily + 1) {
      streakCount = Math.max(1, streakCount) + 1;
      lastDaily = dn;
    } else if (dn > lastDaily + 1) {
      streakCount = 1;
      lastDaily = dn;
    }
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO arcade_sessions (owner_hash, streak_count, last_daily_number, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(owner_hash) DO UPDATE SET
         streak_count = excluded.streak_count,
         last_daily_number = excluded.last_daily_number,
         updated_at = excluded.updated_at`
    ).run(ownerHash, streakCount, lastDaily, nowIso);
  }

  return { streakCount, lastDailyNumber: lastDaily };
}

export function getIdentityInfoForOwner(
  ownerId: string,
  requestedTag?: string
): ArcadeIdentityInfo {
  const ownerHash = sha256Hex(ownerId);
  return withGhostSqliteDb((db) => {
    ensureIdentityTables(db);
    const { streakCount, lastDailyNumber } = updateDailyStreakInTx(db, ownerHash);

    let activeTagRow: { tag: string; tag_slug: string; owner_hash: string } | undefined;
    if (requestedTag) {
      const clean = sanitizeArcadeTag(requestedTag);
      const slug = tagToSlug(clean);
      if (clean !== 'PLAYER') {
        activeTagRow = db
          .prepare('SELECT tag, tag_slug, owner_hash FROM arcade_tags WHERE tag_slug = ? LIMIT 1')
          .get(slug) as typeof activeTagRow;
        if (!activeTagRow) {
          return {
            tag: clean,
            tagSlug: slug,
            claimed: false,
            ownedBySession: false,
            claimKey: buildBackupClaimKey(ownerId),
            streakCount,
            lastDailyNumber,
          };
        }
        const owned = activeTagRow.owner_hash === ownerHash;
        return {
          tag: activeTagRow.tag,
          tagSlug: activeTagRow.tag_slug,
          claimed: true,
          ownedBySession: owned,
          claimKey: owned ? buildBackupClaimKey(ownerId) : null,
          streakCount,
          lastDailyNumber,
        };
      }
    }

    const latestOwned = db
      .prepare(
        `SELECT tag, tag_slug, owner_hash
         FROM arcade_tags
         WHERE owner_hash = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(ownerHash) as typeof activeTagRow;

    if (latestOwned) {
      return {
        tag: latestOwned.tag,
        tagSlug: latestOwned.tag_slug,
        claimed: true,
        ownedBySession: true,
        claimKey: buildBackupClaimKey(ownerId),
        streakCount,
        lastDailyNumber,
      };
    }

    return {
      tag: null,
      tagSlug: null,
      claimed: false,
      ownedBySession: false,
      claimKey: buildBackupClaimKey(ownerId),
      streakCount,
      lastDailyNumber,
    };
  });
}

export function resolveTagForSubmission(params: {
  ownerId: string;
  requestedTag: string;
  dailyNumber?: number;
  strictClaimOnly?: boolean;
}): {
  assignedTag: string;
  tagConflict?: {
    requestedTag: string;
    assignedTag: string;
    reason: string;
  };
  identity: ArcadeIdentityInfo;
} {
  const ownerHash = sha256Hex(params.ownerId);
  const cleanRequested = sanitizeArcadeTag(params.requestedTag || 'PLAYER');
  const requestedSlug = tagToSlug(cleanRequested);

  return withGhostSqliteDb((db) => {
    ensureIdentityTables(db);
    const nowIso = new Date().toISOString();

    db.exec('BEGIN IMMEDIATE;');
    try {
      const streak = updateDailyStreakInTx(db, ownerHash, params.dailyNumber);

      // Default 'PLAYER' tag stays shared/unclaimed so first-time runners have zero friction
      if (cleanRequested === 'PLAYER') {
        db.exec('COMMIT;');
        return {
          assignedTag: 'PLAYER',
          identity: {
            tag: 'PLAYER',
            tagSlug: 'player',
            claimed: false,
            ownedBySession: false,
            claimKey: buildBackupClaimKey(params.ownerId),
            streakCount: streak.streakCount,
            lastDailyNumber: streak.lastDailyNumber,
          },
        };
      }

      // Protect built-in #1 champion bot @ALEX from impersonation
      if (RESERVED_BOT_TAG_SLUGS.has(requestedSlug)) {
        const fallback = allocateAvailableFallbackTag(db, cleanRequested);
        db.exec('COMMIT;');
        return {
          assignedTag: fallback,
          tagConflict: {
            requestedTag: cleanRequested,
            assignedTag: fallback,
            reason: `@${cleanRequested} is the built-in #1 Champion Bot`,
          },
          identity: {
            tag: fallback,
            tagSlug: tagToSlug(fallback),
            claimed: false,
            ownedBySession: false,
            claimKey: buildBackupClaimKey(params.ownerId),
            streakCount: streak.streakCount,
            lastDailyNumber: streak.lastDailyNumber,
          },
        };
      }

      const existing = db
        .prepare('SELECT tag, tag_slug, owner_hash FROM arcade_tags WHERE tag_slug = ? LIMIT 1')
        .get(requestedSlug) as
        | { tag: string; tag_slug: string; owner_hash: string }
        | undefined;

      if (existing) {
        if (existing.owner_hash === ownerHash) {
          db.prepare('UPDATE arcade_tags SET tag = ?, updated_at = ? WHERE tag_slug = ?').run(
            cleanRequested,
            nowIso,
            requestedSlug
          );
          db.exec('COMMIT;');
          return {
            assignedTag: cleanRequested,
            identity: {
              tag: cleanRequested,
              tagSlug: requestedSlug,
              claimed: true,
              ownedBySession: true,
              claimKey: buildBackupClaimKey(params.ownerId),
              streakCount: streak.streakCount,
              lastDailyNumber: streak.lastDailyNumber,
            },
          };
        }

        // Owned by another runner -> assign collision-free fallback tag so run is never lost!
        const fallback = allocateAvailableFallbackTag(db, cleanRequested);
        if (!params.strictClaimOnly) {
          const fbSlug = tagToSlug(fallback);
          db.prepare(
            `INSERT OR IGNORE INTO arcade_tags (tag_slug, tag, owner_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`
          ).run(fbSlug, fallback, ownerHash, nowIso, nowIso);
        }
        db.exec('COMMIT;');
        return {
          assignedTag: fallback,
          tagConflict: {
            requestedTag: cleanRequested,
            assignedTag: fallback,
            reason: `@${cleanRequested} is already claimed by another speedrunner`,
          },
          identity: {
            tag: params.strictClaimOnly ? cleanRequested : fallback,
            tagSlug: tagToSlug(params.strictClaimOnly ? cleanRequested : fallback),
            claimed: true,
            ownedBySession: !params.strictClaimOnly,
            claimKey: !params.strictClaimOnly ? buildBackupClaimKey(params.ownerId) : null,
            streakCount: streak.streakCount,
            lastDailyNumber: streak.lastDailyNumber,
          },
        };
      }

      // Unclaimed tag! Enforce reasonable per-device cap by pruning oldest tag if > MAX_TAGS_PER_OWNER
      const ownedRows = db
        .prepare(
          'SELECT tag_slug FROM arcade_tags WHERE owner_hash = ? ORDER BY updated_at ASC'
        )
        .all(ownerHash) as Array<{ tag_slug: string }>;

      if (ownedRows.length >= MAX_TAGS_PER_OWNER) {
        const oldest = ownedRows[0]?.tag_slug;
        if (oldest) {
          db.prepare('DELETE FROM arcade_tags WHERE tag_slug = ? AND owner_hash = ?').run(
            oldest,
            ownerHash
          );
        }
      }

      db.prepare(
        `INSERT INTO arcade_tags (tag_slug, tag, owner_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(requestedSlug, cleanRequested, ownerHash, nowIso, nowIso);

      db.exec('COMMIT;');
      return {
        assignedTag: cleanRequested,
        identity: {
          tag: cleanRequested,
          tagSlug: requestedSlug,
          claimed: true,
          ownedBySession: true,
          claimKey: buildBackupClaimKey(params.ownerId),
          streakCount: streak.streakCount,
          lastDailyNumber: streak.lastDailyNumber,
        },
      };
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    }
  });
}
