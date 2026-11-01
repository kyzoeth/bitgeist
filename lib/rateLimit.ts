import type { NextRequest } from 'next/server';

interface RateBucket {
  timestamps: number[];
  lastSeen: number;
}

const MAX_TRACKED_BUCKETS = 4096;
const buckets = new Map<string, RateBucket>();

export function extractClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = req.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 64);
  return '127.0.0.1';
}

export function checkSlidingWindowRateLimit(params: {
  key: string;
  maxRequests: number;
  windowMs: number;
  nowMs?: number;
}): {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
} {
  const now = params.nowMs ?? Date.now();
  const cutoff = now - params.windowMs;

  if (buckets.size > MAX_TRACKED_BUCKETS) {
    for (const [k, b] of buckets) {
      if (b.lastSeen < cutoff) {
        buckets.delete(k);
      }
      if (buckets.size <= MAX_TRACKED_BUCKETS / 2) break;
    }
  }

  let bucket = buckets.get(params.key);
  if (!bucket) {
    bucket = { timestamps: [], lastSeen: now };
    buckets.set(params.key, bucket);
  }

  // Drop expired timestamps outside sliding window
  while (bucket.timestamps.length > 0 && bucket.timestamps[0] <= cutoff) {
    bucket.timestamps.shift();
  }
  bucket.lastSeen = now;

  if (bucket.timestamps.length >= params.maxRequests) {
    const oldest = bucket.timestamps[0] ?? now;
    const retryAfterMs = Math.max(1000, oldest + params.windowMs - now);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.ceil(retryAfterMs / 1000),
    };
  }

  bucket.timestamps.push(now);
  return {
    allowed: true,
    remaining: Math.max(0, params.maxRequests - bucket.timestamps.length),
    retryAfterSec: 0,
  };
}

export function resetRateLimitBucketsForTests(): void {
  buckets.clear();
}
