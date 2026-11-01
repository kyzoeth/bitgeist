import type { MetadataRoute } from 'next';
import { resolveSiteOrigin } from '@/lib/siteUrl';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await resolveSiteOrigin();
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/vs/', '/api/og'],
        disallow: ['/api/health', '/api/identity'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
