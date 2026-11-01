import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'BITGEIST — 15-Second Retro Speedruns',
    short_name: 'BITGEIST',
    description:
      'Watch the #1 speedrun replay, press any key, and race the top score ghost 1v1 across retro 8-bit sprints directly in your browser.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F4ECD8',
    theme_color: '#F4ECD8',
    icons: [
      {
        src: '/icon',
        sizes: '32x32',
        type: 'image/png',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
  };
}
