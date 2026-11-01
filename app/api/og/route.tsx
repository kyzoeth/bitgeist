import { ImageResponse } from 'next/og';
import { NextRequest, NextResponse } from 'next/server';
import { formatDailyNumber } from '@/lib/dailySprints';
import { findGhostBySlug } from '@/lib/ghostStore';
import { sanitizeArcadeTag } from '@/lib/ghostShare';
import { checkSlidingWindowRateLimit, extractClientIp } from '@/lib/rateLimit';

function parseOptionalInt(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export async function GET(req: NextRequest) {
  const ip = extractClientIp(req);
  const limit = checkSlidingWindowRateLimit({
    key: `og:get:${ip}`,
    maxRequests: 60,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many OG card requests' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const slugParam = searchParams.get('slug') || 'alex';
  const stored = await findGhostBySlug(slugParam);

  const tag = sanitizeArcadeTag(
    searchParams.get('tag') || stored?.tag || slugParam.split('-')[0] || slugParam
  );
  const timeMs = parseOptionalInt(searchParams.get('t'), 1000, 600_000) ?? stored?.timeMs ?? 14200;
  const dailyNumber = parseOptionalInt(searchParams.get('dn'), 1, 99_999) ?? stored?.dailyNumber;
  const verified = searchParams.get('v') === '1' || Boolean(stored?.verified);

  const rawStage = searchParams.get('stage') || stored?.romTitle || 'CELESTE 1-A - FIRST STEPS';
  const stage = (
    dailyNumber && !rawStage.startsWith('#')
      ? `${formatDailyNumber(dailyNumber)} - ${rawStage}`
      : rawStage
  )
    .replace(/[^\x20-\x7E]/g, '-')
    .slice(0, 26);
  const secs = (timeMs / 1000).toFixed(2).padStart(5, '0');

  const letters = [
    { ch: 'B', bg: '#F2545B' },
    { ch: 'I', bg: '#F7882F' },
    { ch: 'T', bg: '#F7C331' },
    { ch: 'G', bg: '#6BCB77' },
    { ch: 'E', bg: '#4ECDC4' },
    { ch: 'I', bg: '#45B7D1' },
    { ch: 'S', bg: '#9B5DE5' },
    { ch: 'T', bg: '#F15BB5' },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: '#F4ECD8',
          fontFamily: 'monospace',
          padding: '44px',
        }}
      >
        <div
          style={{
            width: '1100px',
            height: '536px',
            display: 'flex',
            backgroundColor: '#EC6553',
            border: '8px solid #111111',
            borderRadius: '32px',
            boxShadow: '14px 14px 0px #111111',
            padding: '12px',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              backgroundColor: '#F5C342',
              border: '6px solid #111111',
              borderRadius: '24px',
              padding: '12px',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                backgroundColor: '#25242B',
                border: '6px solid #111111',
                borderRadius: '18px',
                padding: '38px 46px',
              }}
            >
              {/* Top Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {letters.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        width: '48px',
                        height: '54px',
                        backgroundColor: item.bg,
                        border: '4px solid #111111',
                        boxShadow: '4px 4px 0px #111111',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '30px',
                        fontWeight: 900,
                        color: '#111111',
                      }}
                    >
                      {item.ch}
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    backgroundColor: '#9BE3C2',
                    border: '4px solid #111111',
                    borderRadius: '12px',
                    padding: '10px 20px',
                    fontSize: '22px',
                    fontWeight: 900,
                    color: '#111111',
                    display: 'flex',
                  }}
                >
                  {stage}
                </div>
              </div>

              {/* Center Dare Headline */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                  <div style={{ fontSize: '92px', fontWeight: 900, color: '#FFE74C', lineHeight: 1, display: 'flex' }}>
                    {secs}s
                  </div>
                  {verified && (
                    <div
                      style={{
                        backgroundColor: '#7FD1AE',
                        border: '4px solid #111111',
                        boxShadow: '4px 4px 0px #111111',
                        borderRadius: '10px',
                        padding: '8px 16px',
                        fontSize: '22px',
                        fontWeight: 900,
                        color: '#111111',
                        display: 'flex',
                      }}
                    >
                      [VERIFIED]
                    </div>
                  )}
                </div>
                <div style={{ fontSize: '40px', fontWeight: 900, color: '#FFFFFF', display: 'flex' }}>
                  RACE @{tag}&apos;S GHOST 1V1
                </div>
              </div>

              {/* Bottom CTA Pill */}
              <div
                style={{
                  backgroundColor: '#7FD1AE',
                  border: '5px solid #111111',
                  borderRadius: '16px',
                  boxShadow: '6px 6px 0px #111111',
                  padding: '18px 28px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '30px', fontWeight: 900, color: '#111111' }}>
                  BET YOU CAN&apos;T BEAT MY GHOST!
                </span>
                <span
                  style={{
                    backgroundColor: '#F5C342',
                    border: '4px solid #111111',
                    borderRadius: '10px',
                    padding: '8px 18px',
                    fontSize: '26px',
                    fontWeight: 900,
                    color: '#111111',
                  }}
                >
                  RACE NOW &gt;&gt;
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      },
    }
  );
}
