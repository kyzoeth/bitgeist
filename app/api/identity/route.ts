import { NextRequest, NextResponse } from 'next/server';
import {
  attachIdentityCookie,
  getIdentityInfoForOwner,
  getOrCreateOwnerSession,
  resolveTagForSubmission,
  verifyBackupClaimKey,
} from '@/lib/playerIdentity';
import { checkSlidingWindowRateLimit, extractClientIp } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tagParam = searchParams.get('tag') || undefined;
  const session = getOrCreateOwnerSession(req);
  const identity = getIdentityInfoForOwner(session.ownerId, tagParam);
  const res = NextResponse.json({ identity });
  if (session.isNewSession) {
    attachIdentityCookie(res, session.ownerId);
  }
  return res;
}

export async function POST(req: NextRequest) {
  const ip = extractClientIp(req);
  const rl = checkSlidingWindowRateLimit({
    key: `identity:${ip}`,
    maxRequests: 25,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many identity requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    );
  }

  let body: { action?: string; tag?: string; claimKey?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
  }

  if (body.action === 'restore') {
    const restoredOwnerId = verifyBackupClaimKey(body.claimKey || '');
    if (!restoredOwnerId) {
      return NextResponse.json(
        { ok: false, error: 'Invalid backup key format or checksum' },
        { status: 422 }
      );
    }
    const identity = getIdentityInfoForOwner(restoredOwnerId);
    const res = NextResponse.json({ ok: true, identity });
    attachIdentityCookie(res, restoredOwnerId);
    return res;
  }

  const session = getOrCreateOwnerSession(req);
  const result = resolveTagForSubmission({
    ownerId: session.ownerId,
    requestedTag: body.tag || 'PLAYER',
    strictClaimOnly: true,
  });

  const res = NextResponse.json({
    ok: !result.tagConflict,
    assignedTag: result.assignedTag,
    tagConflict: result.tagConflict || null,
    identity: result.identity,
  });
  attachIdentityCookie(res, session.ownerId);
  return res;
}
