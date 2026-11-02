'use client';

import React, { useEffect, useRef, useState } from 'react';
import { evaluateRoomMedal, formatDailyNumber } from '@/lib/dailySprints';
import {
  downloadBlockyBragCardPng,
  encodeStatelessGhostToken,
  formatViralDareMessage,
  sanitizeArcadeTag,
  tagToSlug,
} from '@/lib/ghostShare';
import { computeRunSplitEntries } from '@/lib/splitTracker';
import {
  ArcadeIdentityInfo,
  ConsoleSystemId,
  GhostKeyframe,
  GhostRun,
  RivalrySeriesSummary,
} from '@/lib/types';
import { FinalizedVideoClip } from '@/lib/videoClipRecorder';

interface VictoryShareModalProps {
  isOpen: boolean;
  clientRunId: string;
  savedSlug?: string;
  initialSavedTag: string;
  timeMs: number;
  beatenCount: number;
  totalGhosts: number;
  emojiStrip: string;
  romId: string;
  consoleSystem?: ConsoleSystemId;
  sprintId?: string;
  romTitle: string;
  dailyNumber?: number;
  courseIndex?: number;
  startWorldX?: number;
  goalWorldX?: number;
  frames: GhostKeyframe[];
  inputLog?: string;
  verified?: boolean;
  isDare?: boolean;
  parentSlug?: string | null;
  rivalrySeries?: RivalrySeriesSummary | null;
  relayLegTimesMs?: readonly number[] | null;
  pbGhost?: GhostRun | null;
  targetGhost: GhostRun | null;
  playerTag: string;
  replayClip?: FinalizedVideoClip | null;
  identityInfo?: ArcadeIdentityInfo | null;
  tagConflictMessage?: string | null;
  onChangeTag: (newTag: string) => void;
  onIdentityUpdated?: (identity: ArcadeIdentityInfo, conflictMsg?: string | null) => void;
  onRunSaved: () => void;
  onWatchInputReplay?: () => void;
  onRaceAgain: () => void;
  onClose: () => void;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to execCommand below
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function VictoryShareModal({
  isOpen,
  clientRunId,
  savedSlug,
  initialSavedTag,
  timeMs,
  beatenCount,
  totalGhosts,
  emojiStrip,
  romId,
  consoleSystem,
  sprintId,
  romTitle,
  dailyNumber,
  courseIndex,
  startWorldX,
  goalWorldX,
  frames,
  inputLog,
  verified,
  isDare,
  parentSlug,
  rivalrySeries,
  relayLegTimesMs,
  pbGhost,
  targetGhost,
  playerTag,
  replayClip,
  identityInfo,
  tagConflictMessage,
  onChangeTag,
  onIdentityUpdated,
  onRunSaved,
  onWatchInputReplay,
  onRaceAgain,
  onClose,
}: VictoryShareModalProps) {
  const [copied, setCopied] = useState(false);
  const [renamedSlugState, setRenamedSlugState] = useState<{
    runId: string;
    tag: string;
    slug: string;
  } | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRunIdRef = useRef<string>('');
  const lastSavedTagRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const cleanTag = sanitizeArcadeTag(playerTag);
  const plainTagSlug = tagToSlug(cleanTag);
  const savedSuffix = savedSlug && savedSlug.includes('-') ? savedSlug.split('-')[1] : '';
  const slug =
    renamedSlugState &&
    renamedSlugState.runId === clientRunId &&
    renamedSlugState.tag === cleanTag
      ? renamedSlugState.slug
      : savedSlug && cleanTag === sanitizeArcadeTag(initialSavedTag)
        ? savedSlug
        : savedSuffix
          ? `${plainTagSlug}-${savedSuffix}`
          : plainTagSlug;
  const secs = (timeMs / 1000).toFixed(2).padStart(5, '0');
  const dailyBadge = typeof dailyNumber === 'number' ? ` ${formatDailyNumber(dailyNumber)}` : '';

  const deltaTargetSec = targetGhost ? (timeMs - targetGhost.timeMs) / 1000 : null;
  const beatTarget = deltaTargetSec !== null && deltaTargetSec <= 0;

  const statelessToken = encodeStatelessGhostToken({
    tag: cleanTag,
    romId,
    consoleSystem,
    sprintId,
    romTitle,
    timeMs,
    beatenCount,
    totalGhosts,
    emojiReceipt: emojiStrip,
    frames,
    dailyNumber,
    courseIndex,
    startWorldX,
    goalWorldX,
    verified,
  });

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://bitgeist.gg';
  const fullShareUrl = statelessToken
    ? `${origin}/vs/${slug}?g=${statelessToken}`
    : `${origin}/vs/${slug}`;
  const displayShareUrl =
    typeof window !== 'undefined'
      ? `${window.location.host}/vs/${slug}`
      : `bitgeist.gg/vs/${slug}`;

  const shareMessage = formatViralDareMessage({
    tag: cleanTag,
    timeMs,
    emojiStrip,
    beatenCount,
    totalGhosts,
    targetTag: targetGhost?.tag,
    deltaTargetSec,
    isDare,
    shareUrl: fullShareUrl,
    dailyNumber,
    verified,
  });

  const persistRenamedTagIfNeeded = async () => {
    const previouslySavedTag =
      lastSavedRunIdRef.current === clientRunId
        ? lastSavedTagRef.current
        : sanitizeArcadeTag(initialSavedTag);
    if (!clientRunId || previouslySavedTag === cleanTag) return;
    lastSavedRunIdRef.current = clientRunId;
    lastSavedTagRef.current = cleanTag;
    try {
      const res = await fetch('/api/ghosts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientRunId,
          tag: cleanTag,
          romId,
          consoleSystem,
          sprintId,
          romTitle,
          timeMs,
          beatenCount,
          totalGhosts,
          emojiReceipt: emojiStrip,
          frames,
          dailyNumber,
          courseIndex,
          startWorldX,
          goalWorldX,
          inputLog,
          parentSlug: parentSlug || undefined,
          rivalTag: targetGhost?.tag,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          run?: { slug?: string; tag?: string };
          identity?: ArcadeIdentityInfo;
          tagConflict?: { requestedTag: string; assignedTag: string; message?: string } | null;
        };
        if (data?.run?.slug) {
          const effectiveTag = data.run.tag ? sanitizeArcadeTag(data.run.tag) : cleanTag;
          if (effectiveTag !== cleanTag) {
            onChangeTag(effectiveTag);
          }
          setRenamedSlugState({
            runId: clientRunId,
            tag: effectiveTag,
            slug: data.run.slug,
          });
        }
        if (data?.identity && onIdentityUpdated) {
          const msg = data.tagConflict
            ? data.tagConflict.message ||
              `@${data.tagConflict.requestedTag} is claimed — saved as @${data.tagConflict.assignedTag}`
            : null;
          onIdentityUpdated(data.identity, msg);
        }
        onRunSaved();
      }
    } catch {
      // Stateless URL fallback still works
    }
  };

  const handlePostToX = () => {
    void persistRenamedTagIfNeeded();
    const intentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareMessage)}`;
    window.open(intentUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyOrNativeShare = async () => {
    void persistRenamedTagIfNeeded();
    if (
      typeof navigator !== 'undefined' &&
      'share' in navigator &&
      /Mobi|Android|iPhone/i.test(navigator.userAgent)
    ) {
      try {
        await navigator.share({
          title: `Beat @${cleanTag}'s ${secs}s Ghost on Bitgeist!`,
          text: shareMessage,
          url: fullShareUrl,
        });
        return;
      } catch {
        // Fall through to clipboard copy
      }
    }
    const ok = await copyTextToClipboard(shareMessage);
    if (ok) {
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1600);
    }
  };

  const handleDownloadCard = () => {
    void persistRenamedTagIfNeeded();
    downloadBlockyBragCardPng({
      tag: cleanTag,
      timeMs,
      beatenCount,
      totalGhosts,
      targetTag: targetGhost?.tag,
      deltaTargetSec,
      romTitle,
      shareUrlDisplay: displayShareUrl,
      dailyNumber,
      verified,
    });
  };

  const handleDownloadVideoClip = () => {
    if (!replayClip) return;
    void persistRenamedTagIfNeeded();
    const a = document.createElement('a');
    a.href = replayClip.url;
    a.download = `bitgeist-${plainTagSlug}-${secs}s.${replayClip.ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const secondaryButtonsCount =
    2 + (replayClip ? 1 : 0) + (Boolean(inputLog) && onWatchInputReplay ? 1 : 0);

  const splitEntries = computeRunSplitEntries({
    runnerFrames: frames,
    runnerTimeMs: timeMs,
    startWorldX,
    goalWorldX,
    targetGhost,
    pbGhost,
    relayLegTimesMs,
  });

  const medalInfo = evaluateRoomMedal(timeMs, targetGhost?.timeMs ?? 17500);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Race Victory Summary"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="modal-backdrop-fade fixed inset-0 z-50 bg-[#111111]/70 flex items-center justify-center p-4 overflow-y-auto font-mono"
    >
      <div className="modal-card-pop bg-[#FFF9E6] border-4 border-[#111111] rounded-2xl shadow-[9px_9px_0px_#111111] max-w-sm w-full overflow-hidden my-auto">
        {/* Top Golden Finish Banner */}
        <div className="bg-[#F5C342] border-b-4 border-[#111111] px-4 py-3 flex items-center justify-between">
          <span className="text-base md:text-lg font-black uppercase tracking-tight text-[#111111]">
            🏁 FINISHED IN {secs}s!
          </span>
          <button
            type="button"
            onClick={onClose}
            className="retro-btn bg-white px-2.5 py-0.5 text-sm text-[#111111]"
            aria-label="Close Victory Modal"
          >
            ✕
          </button>
        </div>

        <div className="p-4 space-y-3.5 text-[#111111]">
          {/* Clear 1v1 #1 / Dare Comparison */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#F7EED7] border-2 border-[#111111] rounded-xl px-3 py-2">
            <span className="text-xs font-black uppercase">
              {targetGhost
                ? beatTarget
                  ? isDare
                    ? '⚔️ DARE CONQUERED!'
                    : '👑 NEW #1 RECORD!'
                  : `CHASING #1 @${targetGhost.tag}`
                : '👑 NEW #1 RECORD!'}
            </span>
            {targetGhost && deltaTargetSec !== null && (
              <span
                className={`${
                  beatTarget ? 'bg-[#7FD1AE]' : 'bg-[#FFE74C]'
                } border border-[#111111] rounded px-2 py-0.5 text-[11px] font-black uppercase`}
              >
                {beatTarget
                  ? `${deltaTargetSec.toFixed(2)}s VS @${targetGhost.tag}`
                  : `+${deltaTargetSec.toFixed(2)}s VS @${targetGhost.tag}`}
              </span>
            )}
          </div>

          {/* Stage 12: Trackmania-Style 4-Tier Room Medal & Next-Tier Target Strip */}
          <div
            aria-label="Room Medal Tier"
            className="bg-[#EFE6CE] border-2 border-[#111111] rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-[10.5px] font-black uppercase"
          >
            <span className="flex items-center gap-1.5">
              <span className="text-sm leading-none">{medalInfo.emoji}</span>
              <span>{medalInfo.label}</span>
            </span>
            {medalInfo.nextTier && typeof medalInfo.msToNext === 'number' ? (
              <span className="bg-[#FFFDF7] border border-[#111111] rounded px-2 py-0.5 tabular-nums text-[9.5px] text-[#111111]/85">
                NEXT {medalInfo.nextEmoji} {medalInfo.nextLabel}: -
                {(medalInfo.msToNext / 1000).toFixed(2)}s
              </span>
            ) : (
              <span className="bg-[#7FD1AE] border border-[#111111] rounded px-2 py-0.5 text-[9.5px] text-[#111111]">
                ✨ MAX TIER UNLOCKED
              </span>
            )}
          </div>

          {/* Stage 6: Gold / Mint / Coral 3-Sector Micro-Split Strip */}
          {splitEntries.length > 0 && (
            <div
              aria-label="Run Sector Splits"
              className="grid grid-cols-3 gap-1.5"
            >
              {splitEntries.map((sp) => {
                const bgClass =
                  sp.status === 'gold'
                    ? 'bg-[#FFE74C]'
                    : sp.status === 'mint'
                      ? 'bg-[#7FD1AE]'
                      : 'bg-[#FFAD87]';
                const deltaSec =
                  sp.deltaVsRivalMs !== null ? sp.deltaVsRivalMs / 1000 : null;
                return (
                  <div
                    key={sp.label}
                    className={`${bgClass} border-2 border-[#111111] rounded-xl px-2 py-1 text-center shadow-[1.5px_1.5px_0_#111111]`}
                  >
                    <div className="text-[8.5px] font-black uppercase leading-none text-[#111111]/75">
                      {sp.label}
                    </div>
                    <div className="text-[11px] font-black tabular-nums leading-tight text-[#111111] mt-0.5">
                      {(sp.runnerMs / 1000).toFixed(2)}s
                    </div>
                    {deltaSec !== null && (
                      <div className="text-[8px] font-black tabular-nums leading-none text-[#111111]/85">
                        {deltaSec <= 0 ? `${deltaSec.toFixed(2)}s` : `+${deltaSec.toFixed(2)}s`}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Stage 7: Head-to-Head Rivalry Series Scoreboard */}
          {rivalrySeries && rivalrySeries.totalBouts > 0 && (
            <div className="bg-[#EFE6CE] border-2 border-[#111111] rounded-xl px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] font-black uppercase">
              <span>⚔️ RIVALRY SERIES</span>
              <span className="bg-[#111111] text-[#FFE74C] rounded px-2 py-0.5 tabular-nums">
                @{cleanTag} {rivalrySeries.playerWins} – {rivalrySeries.rivalWins} @{rivalrySeries.rivalTag}
              </span>
            </div>
          )}

          {/* Player Name + Zero-Signup Identity / Streak + Dare Card Preview */}
          <div className="bg-white border-2 border-[#111111] rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 pb-2 border-b-2 border-dashed border-[#111111]/15">
              <div className="flex items-center gap-1.5 min-w-0">
                <label htmlFor="arcade-tag-input" className="text-xs font-black uppercase">
                  YOUR NAME:
                </label>
                {identityInfo?.ownedBySession && (
                  <span
                    title="Claimed & protected on your device"
                    className="bg-[#7FD1AE] border border-[#111111] rounded px-1 py-px text-[8.5px] font-black uppercase leading-none"
                  >
                    🔒
                  </span>
                )}
                {identityInfo && identityInfo.streakCount > 0 && (
                  <span
                    title={`${identityInfo.streakCount}-day Daily Sprint streak`}
                    className="bg-[#EC6553] text-white border border-[#111111] rounded px-1 py-px text-[8.5px] font-black uppercase leading-none"
                  >
                    🔥{identityInfo.streakCount}D
                  </span>
                )}
              </div>
              <input
                id="arcade-tag-input"
                type="text"
                maxLength={9}
                value={playerTag}
                onChange={(e) => onChangeTag(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                onBlur={() => void persistRenamedTagIfNeeded()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.currentTarget.blur();
                    void persistRenamedTagIfNeeded();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.currentTarget.blur();
                    void persistRenamedTagIfNeeded();
                    onClose();
                  }
                }}
                placeholder="PLAYER"
                className="w-28 bg-[#FFF9E6] border-2 border-[#111111] rounded-md px-2 py-1 font-black text-center uppercase text-xs focus:outline-none focus:bg-[#F5C342]/30"
              />
            </div>

            {tagConflictMessage && (
              <div className="bg-[#FFE74C] border border-[#111111] rounded-lg px-2 py-1 text-[10px] font-black uppercase">
                {tagConflictMessage}
              </div>
            )}

            <div className="space-y-1 text-left">
              <div className="flex items-center justify-between text-[11px] font-black uppercase text-[#111111]/75">
                <span>BITGEIST{dailyBadge}</span>
                <span>{targetGhost ? `1V1 VS @${targetGhost.tag}` : 'TOP SPEEDRUN'}</span>
              </div>
              <div className="text-base tracking-widest leading-snug">{emojiStrip}</div>
              <div className="text-xs font-black text-[#2b50ec] truncate">{displayShareUrl}</div>
            </div>
          </div>

          {/* Primary Actions: Challenge Friends + Race Again */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void handleCopyOrNativeShare()}
              className="w-full retro-btn bg-[#7FD1AE] text-[#111111] py-2.5 px-3 text-xs uppercase"
            >
              {copied ? '✓ DARE LINK COPIED!' : '🔗 COPY DARE LINK FOR FRIENDS'}
            </button>

            <button
              type="button"
              onClick={() => {
                void persistRenamedTagIfNeeded();
                onRaceAgain();
              }}
              className="w-full retro-btn bg-[#F5C342] text-[#111111] py-2.5 px-3 text-xs uppercase"
            >
              ↺ RACE AGAIN
            </button>
          </div>

          {/* Compact Secondary Share / 15s Video Clip / Replay Pills */}
          <div
            className={`grid ${
              secondaryButtonsCount >= 4
                ? 'grid-cols-4'
                : secondaryButtonsCount === 3
                  ? 'grid-cols-3'
                  : 'grid-cols-2'
            } gap-1.5`}
          >
            <button
              type="button"
              onClick={handlePostToX}
              className="retro-btn bg-[#FFFDF7] text-[#111111] py-1.5 px-1.5 text-[10.5px] uppercase whitespace-nowrap"
            >
              𝕏 POST
            </button>

            <button
              type="button"
              onClick={handleDownloadCard}
              className="retro-btn bg-[#FFFDF7] text-[#111111] py-1.5 px-1.5 text-[10.5px] uppercase whitespace-nowrap"
            >
              📸 CARD
            </button>

            {replayClip && (
              <button
                type="button"
                onClick={handleDownloadVideoClip}
                title={`Download 15s ${replayClip.ext.toUpperCase()} gameplay + ghost clip`}
                className="retro-btn bg-[#FFE74C] text-[#111111] py-1.5 px-1.5 text-[10.5px] uppercase whitespace-nowrap"
              >
                🎬 CLIP
              </button>
            )}

            {Boolean(inputLog) && onWatchInputReplay && (
              <button
                type="button"
                onClick={() => {
                  void persistRenamedTagIfNeeded();
                  onWatchInputReplay();
                }}
                className="retro-btn bg-[#FFFDF7] text-[#111111] py-1.5 px-1.5 text-[10.5px] uppercase whitespace-nowrap"
              >
                ▶ REPLAY
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
