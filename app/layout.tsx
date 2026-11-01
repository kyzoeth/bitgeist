import type { Metadata, Viewport } from 'next';
import { Geist_Mono } from 'next/font/google';
import { resolveMetadataBase } from '@/lib/siteUrl';
import './globals.css';

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const viewport: Viewport = {
  themeColor: '#F4ECD8',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export async function generateMetadata(): Promise<Metadata> {
  const metadataBase = await resolveMetadataBase();

  return {
    metadataBase,
    applicationName: 'BITGEIST',
    title: 'BITGEIST — 15-Second Retro Speedruns • Beat the #1 Ghost',
    description:
      'Watch the #1 speedrun replay, press any key, and race the top score ghost 1v1 across retro 8-bit sprints directly in your browser. Zero menus, zero sign-ups, 1-click Beat My Ghost dares.',
    keywords: [
      'retro speedrun',
      'NES speedrun',
      'Celeste NES',
      'ghost race',
      'browser arcade',
      '8-bit speedrun',
      'Bitgeist',
    ],
    alternates: {
      canonical: '/',
    },
    openGraph: {
      type: 'website',
      siteName: 'BITGEIST',
      url: '/',
      title: 'BITGEIST — Beat the #1 Ghost!',
      description:
        'Race the #1 top-score ghost (or a friend’s dare) 1v1 across retro 8-bit sprints in your browser. Zero menus, instant 10ms retries.',
      images: [
        {
          url: '/api/og?slug=alex',
          width: 1200,
          height: 630,
          alt: 'BITGEIST — 15-Second Retro Speedruns • Beat the #1 Ghost',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'BITGEIST — Beat the #1 Ghost!',
      description:
        'Race the #1 top-score ghost (or a friend’s dare) 1v1 across retro 8-bit sprints in your browser. Zero menus, instant 10ms retries.',
      images: ['/api/og?slug=alex'],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={geistMono.variable}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
