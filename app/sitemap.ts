import type { MetadataRoute } from 'next';
import { resolveSiteOrigin } from '@/lib/siteUrl';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await resolveSiteOrigin();
  return [
    {
      url: origin,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
  ];
}
