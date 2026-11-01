import { NextResponse } from 'next/server';
import { getGhostStoreHealth } from '@/lib/ghostStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = getGhostStoreHealth();
    return NextResponse.json(
      {
        status: 'ok',
        ...store,
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err) {
    console.error('[GET /api/health]', err);
    return NextResponse.json(
      {
        status: 'error',
        ok: false,
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
