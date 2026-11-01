import { headers } from 'next/headers';

export async function resolveSiteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      return parsed.origin;
    } catch {
      // Fall through
    }
  }

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) {
    try {
      const parsed = new URL(
        railwayDomain.startsWith('http://') || railwayDomain.startsWith('https://')
          ? railwayDomain
          : `https://${railwayDomain}`
      );
      return parsed.origin;
    } catch {
      // Fall through
    }
  }

  try {
    const hdrs = await headers();
    const rawHost = hdrs.get('x-forwarded-host') || hdrs.get('host');
    const host = rawHost?.split(',')[0]?.trim();
    if (host) {
      const rawProto = hdrs.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const proto =
        rawProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');
      return new URL(`${proto}://${host}`).origin;
    }
  } catch {
    // Static generation or non-request context fallback
  }

  return 'http://localhost:3000';
}

export async function resolveMetadataBase(): Promise<URL> {
  return new URL(await resolveSiteOrigin());
}
