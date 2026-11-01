import { formatDailyNumber } from './dailySprints';
import {
  getHologramRunnerSprites,
  getPixelCrownSprite,
  getRunnerArchetypeForTag,
  type RunnerArchetypeId,
  type RunnerPoseId,
} from './hologramRunners';
import {
  CELESTE_ROM_ID,
  DEFAULT_ROM_ID,
  NOVA_ROM_ID,
  TWIN_DRAGONS_ROM_ID,
} from './romProfiles';
import type { ConsoleSystemId, GhostKeyframe, GhostRun } from './types';

const VALID_SHARE_CONSOLES = new Set<ConsoleSystemId>(['nes', 'snes', 'genesis', 'gb', 'gba']);

export const GHOST_PALETTE = [
  '#FF70A6', // Bubblegum Pink
  '#9B5DE5', // Electric Violet
  '#70E000', // Slime Lime
  '#FF9F1C', // Arcade Tangerine
  '#4CC9F0', // Sky Cyan
  '#F15BB5', // Hot Magenta
];

export function sanitizeArcadeTag(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 9);
  return cleaned || 'PLAYER';
}

export function tagToSlug(tag: string): string {
  return sanitizeArcadeTag(tag).toLowerCase();
}

export function buildEmojiRaceReceipt(params: {
  deadGhostsCount: number;
  beatTarget: boolean;
}): string {
  if (params.beatTarget) {
    return '⚡⚡⚡👑🏃💨🏁';
  }
  if (params.deadGhostsCount > 0) {
    return '⚡💀⚡👑🏃💨🏁';
  }
  return '⚡⚡👻👑🏃💨🏁';
}

export function formatViralDareMessage(params: {
  tag: string;
  timeMs: number;
  emojiStrip: string;
  beatenCount: number;
  totalGhosts: number;
  targetTag?: string;
  deltaTargetSec?: number | null;
  isDare?: boolean;
  shareUrl: string;
  dailyNumber?: number;
  verified?: boolean;
}): string {
  const secs = (params.timeMs / 1000).toFixed(2).padStart(5, '0');
  const dailyPart =
    typeof params.dailyNumber === 'number' && params.dailyNumber >= 1
      ? ` ${formatDailyNumber(params.dailyNumber)}`
      : '';
  const verifiedMark = params.verified ? ' ✓' : '';

  let duelLine: string;
  if (params.targetTag && typeof params.deltaTargetSec === 'number') {
    const cleanTarget = sanitizeArcadeTag(params.targetTag);
    if (params.deltaTargetSec <= 0) {
      duelLine = params.isDare
        ? `⚔️ Beat @${cleanTarget}'s Dare (${params.deltaTargetSec.toFixed(2)}s!)`
        : `👑 Beat #1 @${cleanTarget} (${params.deltaTargetSec.toFixed(2)}s!)`;
    } else {
      duelLine = `Chased #1 @${cleanTarget} (+${params.deltaTargetSec.toFixed(2)}s)`;
    }
  } else {
    duelLine = params.beatenCount > 0 ? '👑 New #1 Speedrun Record!' : '15-Second Retro Speedrun';
  }

  return [
    `BITGEIST${dailyPart} 🏁 ${secs}s${verifiedMark}`,
    params.emojiStrip,
    duelLine,
    `Try to beat my ghost → ${params.shareUrl}`,
  ].join('\n');
}

/**
 * Encodes a runner's ghost run into a compact Base64URL stateless token (?g=...)
 * using downsampled delta coordinates so shared dare links work even across separate servers.
 */
export function encodeStatelessGhostToken(
  run: Pick<GhostRun, 'tag' | 'romId' | 'romTitle' | 'timeMs' | 'frames'> &
    Partial<
      Pick<
        GhostRun,
        | 'consoleSystem'
        | 'beatenCount'
        | 'totalGhosts'
        | 'emojiReceipt'
        | 'sprintId'
        | 'dailyNumber'
        | 'courseIndex'
        | 'startWorldX'
        | 'goalWorldX'
        | 'verified'
      >
    >
): string {
  try {
    if (!run.frames.length) return '';
    // Sample up to 36 keyframes along the run for compact URL size
    const step = Math.max(1, Math.floor(run.frames.length / 36));
    const sampled: GhostKeyframe[] = [];
    for (let i = 0; i < run.frames.length; i += step) {
      sampled.push(run.frames[i]);
    }
    const last = run.frames[run.frames.length - 1];
    if (last && sampled[sampled.length - 1]?.[0] !== last[0]) {
      sampled.push(last);
    }

    let prevF = 0;
    let prevX = 0;
    let prevY = 0;
    const deltas = sampled.map(([f, x, y]) => {
      const rf = Math.round(f);
      const rx = Math.round(x);
      const ry = Math.round(y);
      const df = rf - prevF;
      const dx = rx - prevX;
      const dy = ry - prevY;
      prevF = rf;
      prevX = rx;
      prevY = ry;
      return `${df},${dx},${dy}`;
    });

    const compactRomId =
      run.romId === CELESTE_ROM_ID
        ? 'cel'
        : run.romId === TWIN_DRAGONS_ROM_ID
          ? 'td'
          : run.romId === NOVA_ROM_ID
            ? 'nova'
            : run.romId;

    const payload = JSON.stringify({
      u: sanitizeArcadeTag(run.tag),
      r: compactRomId,
      ...(run.consoleSystem && run.consoleSystem !== 'nes' ? { cs: run.consoleSystem } : {}),
      n: run.romTitle,
      t: Math.round(run.timeMs),
      ...(typeof run.beatenCount === 'number' ? { b: run.beatenCount } : {}),
      ...(typeof run.totalGhosts === 'number' ? { g: run.totalGhosts } : {}),
      ...(run.emojiReceipt ? { e: run.emojiReceipt } : {}),
      ...(run.sprintId && run.sprintId !== run.romId ? { s: run.sprintId } : {}),
      ...(typeof run.dailyNumber === 'number' && run.dailyNumber >= 1
        ? { dn: Math.round(run.dailyNumber) }
        : {}),
      ...(typeof run.courseIndex === 'number' && run.courseIndex >= 0
        ? { lv: Math.round(run.courseIndex) }
        : {}),
      ...(typeof run.startWorldX === 'number' ? { sx: Math.round(run.startWorldX) } : {}),
      ...(typeof run.goalWorldX === 'number' ? { gx: Math.round(run.goalWorldX) } : {}),
      ...(run.verified ? { v: 1 } : {}),
      d: deltas.join(';'),
    });

    if (typeof window !== 'undefined') {
      return btoa(encodeURIComponent(payload))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    }
    return Buffer.from(encodeURIComponent(payload), 'utf8').toString('base64url');
  } catch {
    return '';
  }
}

export function decodeStatelessGhostToken(
  token: string,
  fullRomIdFallback = DEFAULT_ROM_ID
): GhostRun | null {
  try {
    const b64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const decodedJson =
      typeof window !== 'undefined'
        ? decodeURIComponent(atob(b64))
        : decodeURIComponent(Buffer.from(b64, 'base64').toString('utf8'));
    const parsed = JSON.parse(decodedJson) as {
      u?: string;
      r?: string;
      cs?: string;
      n?: string;
      t?: number;
      b?: number;
      g?: number;
      e?: string;
      s?: string;
      dn?: number;
      lv?: number;
      sx?: number;
      gx?: number;
      v?: number;
      d?: string;
    };

    if (typeof parsed.d !== 'string' || !parsed.d) return null;

    let f = 0;
    let x = 0;
    let y = 0;
    const frames: GhostKeyframe[] = [];
    for (const seg of parsed.d.split(';')) {
      const parts = seg.split(',').map(Number);
      if (parts.length !== 3 || !parts.every(Number.isFinite)) continue;
      f += parts[0];
      x += parts[1];
      y += parts[2];
      frames.push([Math.max(0, f), x, y]);
    }

    if (frames.length < 2) return null;

    const tag = sanitizeArcadeTag(parsed.u || 'PLAYER');
    const resolvedRomId =
      parsed.r === 'cel'
        ? CELESTE_ROM_ID
        : parsed.r === 'td'
          ? TWIN_DRAGONS_ROM_ID
          : parsed.r === 'nova'
            ? NOVA_ROM_ID
            : typeof parsed.r === 'string' && /^[a-f0-9]{16,64}$/i.test(parsed.r)
              ? parsed.r.toLowerCase()
              : fullRomIdFallback;

    const rawTime = Number(parsed.t);
    const timeMs = Number.isFinite(rawTime) && rawTime >= 1000 ? Math.round(rawTime) : 14200;
    const rawTotal = Number(parsed.g);
    const totalGhosts = Number.isFinite(rawTotal) && rawTotal >= 1 ? Math.round(rawTotal) : 1;
    const rawBeaten = Number(parsed.b);
    const beatenCount =
      Number.isFinite(rawBeaten) && rawBeaten >= 0
        ? Math.min(totalGhosts, Math.round(rawBeaten))
        : totalGhosts;

    const rawDn = Number(parsed.dn);
    const dailyNumber =
      Number.isFinite(rawDn) && rawDn >= 1 && rawDn <= 99_999 ? Math.round(rawDn) : undefined;

    const rawLv = Number(parsed.lv);
    const courseIndex =
      Number.isFinite(rawLv) && rawLv >= 0 && rawLv <= 99 ? Math.round(rawLv) : undefined;

    const rawSx = Number(parsed.sx);
    const startWorldX =
      Number.isFinite(rawSx) && rawSx >= 0 && rawSx <= 65_535 ? Math.round(rawSx) : undefined;

    const rawGx = Number(parsed.gx);
    const goalWorldX =
      Number.isFinite(rawGx) && rawGx >= 240 && rawGx <= 65_535 ? Math.round(rawGx) : undefined;

    const sprintId =
      typeof parsed.s === 'string' && /^[a-zA-Z0-9:_-]{3,96}$/.test(parsed.s)
        ? parsed.s
        : dailyNumber
          ? `daily-${dailyNumber}`
          : resolvedRomId;

    const consoleSystem: ConsoleSystemId =
      typeof parsed.cs === 'string' && VALID_SHARE_CONSOLES.has(parsed.cs as ConsoleSystemId)
        ? (parsed.cs as ConsoleSystemId)
        : 'nes';

    return {
      id: `token-${tag.toLowerCase()}`,
      slug: tagToSlug(tag),
      tag,
      romId: resolvedRomId,
      consoleSystem,
      sprintId,
      romTitle: (parsed.n || 'CELESTE 1-A • FIRST STEPS').slice(0, 32),
      timeMs,
      beatenCount,
      totalGhosts,
      emojiReceipt: parsed.e || '⚡⚡⚡👑🏃💨🏁',
      frames,
      color: '#FFE74C',
      createdAt: new Date().toISOString(),
      dailyNumber,
      courseIndex,
      startWorldX,
      goalWorldX,
      verified: parsed.v === 1,
    };
  } catch {
    return null;
  }
}

/**
 * Generates a crisp, 100% DMCA-safe 1200x630 Blocky 8-Bit Trophy Card PNG directly on <canvas>.
 */
export function downloadBlockyBragCardPng(params: {
  tag: string;
  timeMs: number;
  beatenCount: number;
  totalGhosts: number;
  targetTag?: string;
  deltaTargetSec?: number | null;
  romTitle: string;
  shareUrlDisplay: string;
  dailyNumber?: number;
  verified?: boolean;
}) {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 630;
  const g = c.getContext('2d');
  if (!g) return;

  // Warm Famicom Cream Backdrop + Dot Grid
  g.fillStyle = '#F4ECD8';
  g.fillRect(0, 0, 1200, 630);
  g.fillStyle = '#DFD2B4';
  for (let x = 16; x < 1200; x += 24) {
    for (let y = 16; y < 630; y += 24) {
      g.fillRect(x, y, 4, 4);
    }
  }

  // Hard 3D Offset Black Shadow
  g.fillStyle = '#111111';
  g.fillRect(68, 66, 1084, 514);

  // Coral + Gold Double CRT Outer Frame
  g.fillStyle = '#EC6553';
  g.fillRect(54, 52, 1084, 514);
  g.strokeStyle = '#111111';
  g.lineWidth = 8;
  g.strokeRect(54, 52, 1084, 514);

  g.fillStyle = '#F5C342';
  g.fillRect(68, 66, 1056, 486);
  g.strokeRect(68, 66, 1056, 486);

  // Dark Charcoal CRT Inner Screen
  g.fillStyle = '#25242B';
  g.fillRect(84, 82, 1024, 454);
  g.strokeRect(84, 82, 1024, 454);

  // Rainbow 3D BITGEIST Blocks
  const letters = ['B', 'I', 'T', 'G', 'E', 'I', 'S', 'T'];
  const colors = ['#F2545B', '#F7882F', '#F7C331', '#6BCB77', '#4ECDC4', '#45B7D1', '#9B5DE5', '#F15BB5'];
  letters.forEach((ch, idx) => {
    const bx = 126 + idx * 54;
    const by = 118;
    g.fillStyle = '#111111';
    g.fillRect(bx + 5, by + 5, 46, 52);
    g.fillStyle = colors[idx];
    g.fillRect(bx, by, 46, 52);
    g.strokeStyle = '#111111';
    g.lineWidth = 4;
    g.strokeRect(bx, by, 46, 52);
    g.fillStyle = '#111111';
    g.font = '900 30px monospace';
    g.fillText(ch, bx + 13, by + 37);
  });

  // Cartridge Badge
  const badgeLabel =
    typeof params.dailyNumber === 'number' && !params.romTitle.startsWith('#')
      ? `${formatDailyNumber(params.dailyNumber)} • ${params.romTitle}`
      : params.romTitle;
  g.fillStyle = '#7FD1AE';
  g.fillRect(680, 122, 386, 46);
  g.strokeStyle = '#111111';
  g.lineWidth = 4;
  g.strokeRect(680, 122, 386, 46);
  g.fillStyle = '#111111';
  g.font = '900 20px monospace';
  g.fillText(badgeLabel.slice(0, 24), 700, 152);

  // Giant Finish Time & Verified Badge
  const secs = (params.timeMs / 1000).toFixed(2).padStart(5, '0');
  const timeLabel = `${secs}s`;
  g.fillStyle = '#FFE74C';
  g.font = '900 84px monospace';
  g.fillText(timeLabel, 126, 286);

  if (params.verified) {
    const tw = g.measureText(timeLabel).width;
    const vx = 126 + tw + 22;
    const vy = 236;
    g.fillStyle = '#111111';
    g.fillRect(vx + 4, vy + 4, 184, 42);
    g.fillStyle = '#7FD1AE';
    g.fillRect(vx, vy, 184, 42);
    g.strokeStyle = '#111111';
    g.lineWidth = 4;
    g.strokeRect(vx, vy, 184, 42);
    g.fillStyle = '#111111';
    g.font = '900 20px monospace';
    g.fillText('✓ VERIFIED', vx + 22, vy + 28);
  }

  const cleanPlayerTag = sanitizeArcadeTag(params.tag);
  let bragSubline: string;
  if (params.targetTag && typeof params.deltaTargetSec === 'number') {
    const cleanTarget = sanitizeArcadeTag(params.targetTag);
    bragSubline =
      params.deltaTargetSec <= 0
        ? `@${cleanPlayerTag} BEAT #1 @${cleanTarget} (${params.deltaTargetSec.toFixed(2)}s)`
        : `@${cleanPlayerTag} VS #1 @${cleanTarget} (+${params.deltaTargetSec.toFixed(2)}s)`;
  } else {
    bragSubline =
      params.beatenCount > 0
        ? `@${cleanPlayerTag} • NEW #1 TOP RECORD!`
        : `@${cleanPlayerTag} • 1V1 SPEEDRUN CHALLENGE`;
  }

  g.fillStyle = '#FFFFFF';
  g.font = '900 36px monospace';
  g.fillText(bragSubline, 126, 352);

  // 8-Bit 1v1 Hologram Duel on the Right (Crowned Champion vs Rival)
  g.imageSmoothingEnabled = false;
  const heroArch = getRunnerArchetypeForTag(params.tag);
  const rivalArch = params.targetTag
    ? getRunnerArchetypeForTag(params.targetTag)
    : (((heroArch + 1) % 5) as RunnerArchetypeId);
  const beatRival =
    typeof params.deltaTargetSec === 'number' ? params.deltaTargetSec <= 0 : params.beatenCount > 0;
  const runnerSpecs: Array<{
    gx: number;
    gy: number;
    col: string;
    arch: RunnerArchetypeId;
    pose: RunnerPoseId;
    crown: boolean;
  }> = [
    {
      gx: 956,
      gy: 252,
      col: '#4CC9F0',
      arch: rivalArch,
      pose: 'run2',
      crown: !beatRival,
    },
    {
      gx: 850,
      gy: 234,
      col: '#FFE74C',
      arch: heroArch,
      pose: 'jump',
      crown: beatRival,
    },
  ];
  const crownCanvas = getPixelCrownSprite();
  runnerSpecs.forEach((sp) => {
    const sprites = getHologramRunnerSprites(sp.arch, sp.col, sp.pose, false);
    if (sprites) {
      g.globalAlpha = 0.28;
      g.drawImage(sprites.echo, sp.gx - 18, sp.gy + 4, 72, 80);
      g.globalAlpha = 1;
      g.drawImage(sprites.main, sp.gx, sp.gy, 72, 80);
    }
    if (sp.crown && crownCanvas) {
      g.drawImage(crownCanvas, sp.gx + 10, sp.gy - 30, 52, 32);
    }
  });

  // Bottom Dare CTA Bar
  g.fillStyle = '#7FD1AE';
  g.fillRect(126, 420, 940, 74);
  g.strokeStyle = '#111111';
  g.lineWidth = 5;
  g.strokeRect(126, 420, 940, 74);
  g.fillStyle = '#111111';
  g.font = '900 30px monospace';
  g.fillText(`RACE MY GHOST → ${params.shareUrlDisplay}`, 154, 467);

  const dailySuffix =
    typeof params.dailyNumber === 'number' ? `-d${params.dailyNumber}` : '';
  const link = document.createElement('a');
  link.download = `bitgeist-${tagToSlug(params.tag)}${dailySuffix}-${secs}s.png`;
  link.href = c.toDataURL('image/png');
  link.click();
}
