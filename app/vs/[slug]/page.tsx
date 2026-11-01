import type { Metadata } from 'next';
import BitgeistArena from '@/components/BitgeistArena';
import { formatDailyNumber } from '@/lib/dailySprints';
import { findGhostBySlug, getGhostsForRom } from '@/lib/ghostStore';
import { decodeStatelessGhostToken, sanitizeArcadeTag } from '@/lib/ghostShare';
import { DEFAULT_ROM_ID } from '@/lib/romProfiles';
import { resolveMetadataBase } from '@/lib/siteUrl';

interface VsPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ g?: string }>;
}

export async function generateMetadata({ params, searchParams }: VsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const { g: token } = await searchParams;

  const decoded = token ? decodeStatelessGhostToken(token, DEFAULT_ROM_ID) : null;
  const stored = await findGhostBySlug(slug);
  const exactStored = stored && !stored.id.startsWith('seed') ? stored : null;
  const runner = exactStored || decoded || stored;

  const tag = sanitizeArcadeTag(runner?.tag || slug.split('-')[0] || slug);
  const timeMs = runner?.timeMs ?? 14200;
  const secs = (timeMs / 1000).toFixed(2).padStart(5, '0');
  const beaten = runner?.beatenCount ?? 1;
  const total = runner?.totalGhosts ?? 1;
  const stage = runner?.romTitle || 'CELESTE 1-A • FIRST STEPS';
  const dailyNumber = runner?.dailyNumber;
  const verified = runner?.verified;

  const ogQs = new URLSearchParams({
    slug,
    tag,
    t: String(timeMs),
    b: String(beaten),
    n: String(total),
    stage,
  });
  if (typeof dailyNumber === 'number') {
    ogQs.set('dn', String(dailyNumber));
  }
  if (verified) {
    ogQs.set('v', '1');
  }
  const ogUrl = `/api/og?${ogQs.toString()}`;
  const brand =
    typeof dailyNumber === 'number' ? `BITGEIST ${formatDailyNumber(dailyNumber)}` : 'BITGEIST';
  const metadataBase = await resolveMetadataBase();

  return {
    metadataBase,
    title: `Beat @${tag}'s ${secs}s Ghost on ${brand}!`,
    description: `@${tag} finished ${stage} in ${secs}s. Click to race @${tag}'s crowned ghost 1v1 right now—zero login required!`,
    openGraph: {
      title: `👑 Beat @${tag}'s ${secs}s Ghost on ${brand}!`,
      description: `Race @${tag}'s ${secs}s ghost 1v1 on ${stage}. Zero menus, instant play!`,
      images: [ogUrl],
    },
    twitter: {
      card: 'summary_large_image',
      title: `👑 Beat @${tag}'s ${secs}s Ghost on ${brand}!`,
      description: `Race @${tag}'s ${secs}s ghost 1v1 on ${stage}. Zero menus, instant play!`,
      images: [ogUrl],
    },
  };
}

export default async function VsDarePage({ params, searchParams }: VsPageProps) {
  const { slug } = await params;
  const { g: token } = await searchParams;

  const statelessTarget = token ? decodeStatelessGhostToken(token, DEFAULT_ROM_ID) : null;
  const storedDare = await findGhostBySlug(slug);
  const exactStoredDare = storedDare && !storedDare.id.startsWith('seed') ? storedDare : null;
  const dareMeta = exactStoredDare || statelessTarget || storedDare;
  const targetRomId = dareMeta?.romId || DEFAULT_ROM_ID;

  const { targetGhost: storedTarget } = await getGhostsForRom(targetRomId, slug, {
    sprintId: dareMeta?.sprintId,
    startWorldX: dareMeta?.startWorldX,
    goalWorldX: dareMeta?.goalWorldX,
    dailyNumber: dareMeta?.dailyNumber,
    courseIndex: dareMeta?.courseIndex,
    romTitle: dareMeta?.romTitle,
    consoleSystem: dareMeta?.consoleSystem,
  });
  const exactStoredTarget =
    storedTarget && !storedTarget.id.startsWith('seed') ? storedTarget : null;
  const effectiveTarget = exactStoredTarget || statelessTarget || storedTarget;

  return (
    <BitgeistArena
      initialTargetGhost={effectiveTarget}
      dareSlug={slug}
      initialDailyNumber={effectiveTarget?.dailyNumber}
    />
  );
}
