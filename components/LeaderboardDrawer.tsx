'use client';

import React, { useState } from 'react';
import { sanitizeArcadeTag } from '@/lib/ghostShare';
import { ArcadeIdentityInfo, GhostRun } from '@/lib/types';

export type RivalSelectionMode = 'top' | 'pb' | 'custom';

interface LeaderboardDrawerProps {
  stageLabel: string;
  leaderboard: GhostRun[];
  totalRuns: number;
  activeTargetGhost: GhostRun | null;
  localPbGhost: GhostRun | null;
  localPbMs: number | null;
  rivalMode: RivalSelectionMode;
  playerTag: string;
  identityInfo?: ArcadeIdentityInfo | null;
  layout?: 'vertical' | 'horizontal';
  collapsed?: boolean;
  expandedSolo?: boolean;
  onToggleCollapse?: () => void;
  swarmEnabled?: boolean;
  onToggleSwarm?: () => void;
  onSelectTopRecord: () => void;
  onSelectMyPb: () => void;
  onSelectCustomRival: (ghost: GhostRun) => void;
  onWatchGhostReplay?: (ghost: GhostRun) => void;
  onRestoreClaimKey?: (claimKey: string) => Promise<{ ok: boolean; error?: string }>;
}

export default function LeaderboardDrawer({
  stageLabel,
  leaderboard,
  totalRuns,
  activeTargetGhost,
  localPbGhost,
  localPbMs,
  rivalMode,
  playerTag,
  identityInfo,
  layout = 'vertical',
  collapsed = false,
  expandedSolo = false,
  onToggleCollapse,
  swarmEnabled = false,
  onToggleSwarm,
  onSelectTopRecord,
  onSelectMyPb,
  onSelectCustomRival,
  onWatchGhostReplay,
  onRestoreClaimKey,
}: LeaderboardDrawerProps) {
  const [showKeyTools, setShowKeyTools] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [restoreInput, setRestoreInput] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);

  const cleanPlayerTag = sanitizeArcadeTag(playerTag);
  const effectivePbMs = localPbGhost?.timeMs ?? localPbMs;
  const topTimeMs = leaderboard[0]?.timeMs ?? activeTargetGhost?.timeMs ?? null;

  let playerRank: number | null = null;
  if (typeof effectivePbMs === 'number') {
    const fasterCount = leaderboard.filter(
      (r) => sanitizeArcadeTag(r.tag) !== cleanPlayerTag && r.timeMs < effectivePbMs
    ).length;
    playerRank = fasterCount + 1;
  }
  const effectiveTotal = Math.max(
    totalRuns,
    leaderboard.length,
    playerRank !== null ? playerRank : 1
  );

  const slots = Array.from({ length: 10 }, (_, idx) => leaderboard[idx] ?? null);

  const handleCopyClaimKey = async () => {
    if (!identityInfo?.claimKey) return;
    try {
      await navigator.clipboard.writeText(identityInfo.claimKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleRestoreSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onRestoreClaimKey || !restoreInput.trim()) return;
    setRestoreStatus('VERIFYING...');
    const res = await onRestoreClaimKey(restoreInput.trim());
    if (res.ok) {
      setRestoreStatus('✓ TAG RESTORED!');
      setRestoreInput('');
    } else {
      setRestoreStatus(res.error || 'INVALID KEY');
    }
  };

  const renderHeaderControls = () => (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={onSelectTopRecord}
        aria-pressed={rivalMode === 'top' && !swarmEnabled}
        aria-label="Race #1 Record"
        title="Race #1 Record Ghost"
        className={`px-1.5 h-[22px] rounded-[5px] border-[1.5px] border-[#111111] font-black text-[9px] uppercase leading-none flex items-center justify-center cursor-pointer select-none transition-all duration-75 ${
          rivalMode === 'top' && !swarmEnabled
            ? 'bg-[#FFE74C] text-[#111111] shadow-[1.5px_1.5px_0_#111111]'
            : 'bg-[#FFFDF7] hover:bg-[#FFE74C] text-[#111111]/90 shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none'
        }`}
      >
        👑 #1
      </button>

      {onToggleSwarm && (
        <button
          type="button"
          onClick={onToggleSwarm}
          aria-pressed={swarmEnabled}
          aria-label="Toggle 10-Ghost Swarm"
          title={
            swarmEnabled
              ? '10-Ghost Swarm Active: Racing all Top 10 ghosts simultaneously (Click for 1v1)'
              : 'Race all Top 10 leaderboard ghosts simultaneously on screen'
          }
          className={`px-1.5 h-[22px] rounded-[5px] border-[1.5px] border-[#111111] font-black text-[9px] uppercase leading-none flex items-center justify-center cursor-pointer select-none transition-all duration-75 ${
            swarmEnabled
              ? 'bg-[#7DD3FC] text-[#111111] shadow-[1.5px_1.5px_0_#111111]'
              : 'bg-[#FFFDF7] hover:bg-[#7DD3FC] text-[#111111]/90 shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none'
          }`}
        >
          ALL 10
        </button>
      )}

      <button
        type="button"
        disabled={!localPbGhost}
        onClick={() => {
          if (localPbGhost) onSelectMyPb();
        }}
        aria-pressed={rivalMode === 'pb'}
        aria-label="Race My PB"
        title={
          localPbGhost
            ? `Race your own ${(localPbGhost.timeMs / 1000).toFixed(2)}s Personal Best ghost`
            : 'Finish a run on this segment first to unlock Race My PB'
        }
        className={`px-1.5 h-[22px] rounded-[5px] border-[1.5px] border-[#111111] font-black text-[8.5px] uppercase leading-none flex items-center justify-center select-none transition-all duration-75 ${
          !localPbGhost
            ? 'bg-[#EAE2C8]/75 text-[#111111]/40 cursor-not-allowed'
            : rivalMode === 'pb'
              ? 'bg-[#7FD1AE] text-[#111111] shadow-[1.5px_1.5px_0_#111111] cursor-pointer'
              : 'bg-[#FFFDF7] hover:bg-[#7FD1AE] text-[#111111]/90 shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none cursor-pointer'
        }`}
      >
        MY PB
      </button>

      {(identityInfo?.claimKey || onRestoreClaimKey) && (
        <button
          type="button"
          onClick={() => {
            setShowKeyTools((v) => !v);
            setRestoreStatus(null);
          }}
          aria-expanded={showKeyTools}
          aria-label="Backup or Restore Arcade Tag"
          title={`@${cleanPlayerTag}${
            playerRank !== null ? ` • #${playerRank} of ${effectiveTotal}` : ''
          } — Backup or restore claimed Arcade Tag`}
          className={`w-[22px] h-[22px] rounded-[5px] border-[1.5px] border-[#111111] font-black text-[9.5px] flex items-center justify-center cursor-pointer select-none transition-all duration-75 ${
            showKeyTools
              ? 'bg-[#FFE74C] shadow-[1.5px_1.5px_0_#111111]'
              : 'bg-[#FFFDF7] hover:bg-[#FFE74C] shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none'
          }`}
        >
          🔑
        </button>
      )}
    </div>
  );

  const renderKeyPopover = () => {
    if (!showKeyTools) return null;
    return (
      <div
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setShowKeyTools(false);
          }
        }}
        className="absolute inset-x-2 top-[36px] z-30 bg-[#FFFDF7] border-2 border-[#111111] rounded-xl p-2.5 shadow-[3px_3px_0px_#111111] space-y-1.5 text-[10px]"
      >
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 min-w-0">
            <span className="bg-[#111111] text-[#FFE74C] rounded px-1.5 py-0.5 font-black uppercase leading-none truncate">
              @{cleanPlayerTag}
            </span>
            {identityInfo?.ownedBySession && (
              <span className="bg-[#7FD1AE] border border-[#111111] rounded px-1 py-0.5 text-[8.5px] font-black uppercase leading-none shrink-0">
                🔒
              </span>
            )}
            {playerRank !== null && (
              <span className="font-black uppercase tabular-nums text-[#111111]/75 shrink-0">
                #{playerRank}/{effectiveTotal}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowKeyTools(false)}
            aria-label="Close Tag Sync"
            className="w-5 h-5 rounded border border-[#111111] bg-[#EAE2C8] hover:bg-[#FFE74C] font-black flex items-center justify-center cursor-pointer shrink-0 leading-none"
          >
            ✕
          </button>
        </div>

        {identityInfo?.claimKey && (
          <div className="flex items-center gap-1">
            <code className="flex-1 min-w-0 bg-[#EFE6CE] border border-[#111111] rounded px-1.5 py-0.5 font-black truncate">
              {identityInfo.claimKey}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyClaimKey()}
              className="bg-[#7FD1AE] hover:bg-[#FFE74C] border border-[#111111] rounded px-1.5 py-0.5 font-black uppercase cursor-pointer shrink-0"
            >
              {copiedKey ? '✓' : 'COPY'}
            </button>
          </div>
        )}

        {onRestoreClaimKey && (
          <form onSubmit={(e) => void handleRestoreSubmit(e)} className="flex items-center gap-1">
            <input
              type="text"
              value={restoreInput}
              onChange={(e) => setRestoreInput(e.target.value)}
              placeholder="PASTE TAG KEY"
              className="flex-1 min-w-0 bg-white border border-[#111111] rounded px-1.5 py-0.5 text-[9.5px] font-black uppercase focus:outline-none"
            />
            <button
              type="submit"
              className="bg-[#F5C342] hover:bg-[#FFE74C] border border-[#111111] rounded px-2 py-0.5 font-black uppercase cursor-pointer shrink-0"
            >
              SYNC
            </button>
          </form>
        )}

        {restoreStatus && (
          <div className="font-black uppercase text-[#0B5D3B] leading-tight">{restoreStatus}</div>
        )}
      </div>
    );
  };

  if (layout === 'vertical') {
    return (
      <aside
        aria-label="Top 10 Speedrun Leaderboard"
        title={`${stageLabel} — Top 10 Leaderboard (Click any runner to race 1v1)`}
        className={`${
          collapsed ? 'shrink-0' : expandedSolo ? 'flex-1' : 'flex-[55]'
        } min-h-0 relative w-full bg-[#EFE6CE] border-[3px] border-[#111111] rounded-2xl p-2.5 shadow-[inset_0_2px_0_#FFFDF7,inset_0_-3px_0_#D8CEB4,4px_5px_0px_#111111] flex flex-col gap-1.5`}
      >
        {/* Top Rack Header: Collapsible Trigger + Harmonized 26px Bar Matching PICK A SEGMENT */}
        <div
          className={`shrink-0 h-[26px] flex items-center justify-between gap-1.5 ${
            collapsed ? '' : 'pb-1.5 border-b-2 border-[#111111]/15'
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-expanded={!collapsed}
                aria-label={collapsed ? 'Expand Top 10 Leaderboard' : 'Collapse Top 10 Leaderboard'}
                title={collapsed ? 'Expand Top 10 Leaderboard' : 'Collapse Top 10 Leaderboard'}
                className="w-[22px] h-[22px] rounded-[5px] border-[1.5px] border-[#111111] bg-[#FFFDF7] hover:bg-[#FFE74C] text-[#111111] font-black text-[10px] leading-none flex items-center justify-center cursor-pointer select-none shadow-[0_1.5px_0_#111111] active:translate-y-[1px] active:shadow-none shrink-0"
              >
                {collapsed ? '▸' : '▾'}
              </button>
            )}
            <button
              type="button"
              onClick={onToggleCollapse}
              className="text-[11px] font-black uppercase tracking-wider text-[#111111] leading-none whitespace-nowrap cursor-pointer text-left focus:outline-none"
            >
              TOP 10
            </button>
            {identityInfo && identityInfo.streakCount > 0 && (
              <span
                title={`${identityInfo.streakCount}-day Daily Sprint streak`}
                className="bg-[#EC6553] text-white border border-[#111111] rounded px-1 py-[1px] text-[8px] font-black uppercase leading-none shrink-0"
              >
                🔥{identityInfo.streakCount}
              </span>
            )}
          </div>

          {renderHeaderControls()}
        </div>

        {renderKeyPopover()}

        {/* 10 High-Legibility Tactile Runner Rows Stacked Directly Below PICK A SEGMENT */}
        {!collapsed && (
          <div
            className="flex-1 min-h-0 grid gap-[3.5px]"
            style={{ gridTemplateRows: 'repeat(10, minmax(0, 1fr))' }}
          >
            {slots.map((run, idx) => {
              const rank = idx + 1;
              if (!run) {
                return (
                  <div
                    key={`empty-rank-${rank}`}
                    className="h-full min-h-0 w-full rounded-xl border-[1.5px] border-dashed border-[#111111]/35 bg-[#FFFDF7]/55 px-2 flex items-center justify-between gap-1.5 text-[10.5px] font-black uppercase text-[#111111]/45"
                  >
                    <span className="tabular-nums">#{rank} ---</span>
                    <span className="tabular-nums">--.--s</span>
                  </div>
                );
              }

              const secs = (run.timeMs / 1000).toFixed(2).padStart(5, '0');
              const deltaSec =
                topTimeMs !== null && rank > 1 ? (run.timeMs - topTimeMs) / 1000 : 0;
              const isYou =
                sanitizeArcadeTag(run.tag) === cleanPlayerTag && !run.id.startsWith('seed');
              const isActiveRival =
                activeTargetGhost?.id === run.id &&
                (rivalMode === 'custom' || (rivalMode === 'top' && rank === 1));
              const hasReplay = Boolean(run.inputLog && onWatchGhostReplay);

              return (
                <div key={run.id} className="relative h-full min-h-0 w-full group">
                  <button
                    type="button"
                    aria-pressed={isActiveRival}
                    onClick={() => {
                      if (rank === 1) {
                        onSelectTopRecord();
                      } else {
                        onSelectCustomRival(run);
                      }
                    }}
                    title={`#${rank} @${run.tag} • ${secs}s${
                      rank > 1 ? ` (+${deltaSec.toFixed(2)}s)` : ''
                    } — Click to race 1v1`}
                    className={`h-full min-h-0 w-full rounded-xl border-2 border-[#111111] pl-2 ${
                      hasReplay ? (expandedSolo ? 'pr-[32px]' : 'pr-[28px]') : 'pr-2'
                    } flex items-center justify-between gap-1.5 text-left cursor-pointer select-none focus:outline-none transition-all duration-100 ${
                      isActiveRival
                        ? 'bg-[#FFE74C] shadow-[2.5px_2.5px_0px_#111111] -translate-x-[0.5px] -translate-y-[0.5px]'
                        : isYou
                          ? 'bg-[#E7F8EE] hover:bg-[#FFF7DC] shadow-[0_1.5px_0_#111111]'
                          : 'bg-[#FFFDF7] hover:bg-[#FFF7DC] shadow-[0_1.5px_0_#111111] hover:-translate-y-[0.5px] active:translate-y-[1px] active:shadow-none'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={`${
                          expandedSolo ? 'w-[25px] h-[25px] text-[11.5px]' : 'w-[21px] h-[20px] text-[10px]'
                        } rounded-[5px] border border-[#111111] font-black tabular-nums leading-none flex items-center justify-center shrink-0 ${
                          rank === 1
                            ? 'bg-[#F5C342]'
                            : rank === 2
                              ? 'bg-[#7FD1AE]'
                              : rank === 3
                                ? 'bg-[#FFAD87]'
                                : 'bg-[#EFE6CE]'
                        }`}
                      >
                        {rank}
                      </span>

                      <span
                        className={`${
                          expandedSolo ? 'text-[12.5px]' : 'text-[11px]'
                        } font-black uppercase tracking-tight text-[#111111] truncate leading-none`}
                      >
                        @{run.tag}
                      </span>

                      {isYou && (
                        <span className="bg-[#111111] text-[#FFE74C] rounded px-1 py-[1px] text-[8px] font-black uppercase leading-none shrink-0">
                          YOU
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {expandedSolo && rank > 1 && deltaSec > 0 && (
                        <span className="text-[9.5px] font-black tabular-nums text-[#111111]/60 leading-none">
                          +{deltaSec.toFixed(2)}s
                        </span>
                      )}
                      <span
                        className={`${
                          expandedSolo ? 'text-[12px]' : 'text-[10.5px]'
                        } font-black tabular-nums tracking-tight text-[#111111] leading-none`}
                      >
                        {secs}s
                      </span>
                    </div>
                  </button>

                  {hasReplay && (
                    <button
                      type="button"
                      onClick={() => onWatchGhostReplay?.(run)}
                      title={`Watch @${run.tag}'s ${secs}s input replay on the CRT`}
                      aria-label={`Watch @${run.tag} replay`}
                      className={`absolute right-1.5 top-1/2 -translate-y-1/2 ${
                        expandedSolo ? 'w-[22px] h-[22px] text-[9.5px]' : 'w-[19px] h-[19px] text-[8.5px]'
                      } rounded-[5px] border border-[#111111] bg-[#EFE6CE] hover:bg-[#7FD1AE] text-[#111111] font-black leading-none flex items-center justify-center cursor-pointer transition-colors`}
                    >
                      ▶
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </aside>
    );
  }

  // Narrow-Viewport / Mobile Layout: Harmonized Horizontal Console Strip Matching PICK A SEGMENT
  return (
    <aside
      aria-label="Top 10 Speedrun Leaderboard"
      className="relative w-full mb-2 bg-[#EFE6CE] border-[3.5px] border-[#111111] rounded-2xl px-3 py-1.5 shadow-[inset_0_2px_0_#FFFDF7,inset_0_-3px_0_#D8CEB4,4px_4px_0px_#111111] flex flex-col gap-1"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand Top 10 Leaderboard' : 'Collapse Top 10 Leaderboard'}
              className="w-[22px] h-[20px] rounded-[5px] border-[1.5px] border-[#111111] bg-[#FFFDF7] hover:bg-[#FFE74C] text-[#111111] font-black text-[9.5px] flex items-center justify-center cursor-pointer select-none shadow-[0_1.5px_0_#111111]"
            >
              {collapsed ? '▸' : '▾'}
            </button>
          )}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-[10.5px] font-black uppercase tracking-wider text-[#111111] leading-none whitespace-nowrap cursor-pointer"
          >
            TOP 10
          </button>
          {playerRank !== null && (
            <span className="bg-[#FFFDF7] border border-[#111111] rounded px-1 py-[0.5px] text-[8.5px] font-black uppercase tabular-nums leading-none shrink-0">
              #{playerRank}/{effectiveTotal}
            </span>
          )}
        </div>

        {renderHeaderControls()}
      </div>

      {renderKeyPopover()}

      {!collapsed && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
          {slots.map((run, idx) => {
            const rank = idx + 1;
            if (!run) {
              return (
                <div
                  key={`h-empty-${rank}`}
                  className="shrink-0 h-[28px] rounded-[9px] border-[1.5px] border-dashed border-[#111111]/35 bg-[#FFFDF7]/55 px-2 flex items-center gap-1 text-[9.5px] font-black uppercase text-[#111111]/45"
                >
                  <span>#{rank}</span>
                  <span>--.--s</span>
                </div>
              );
            }

            const secs = (run.timeMs / 1000).toFixed(2).padStart(5, '0');
            const isYou =
              sanitizeArcadeTag(run.tag) === cleanPlayerTag && !run.id.startsWith('seed');
            const isActiveRival =
              activeTargetGhost?.id === run.id &&
              (rivalMode === 'custom' || (rivalMode === 'top' && rank === 1));
            const hasReplay = Boolean(run.inputLog && onWatchGhostReplay);

            return (
              <div key={run.id} className="relative shrink-0 flex items-center">
                <button
                  type="button"
                  aria-pressed={isActiveRival}
                  onClick={() => {
                    if (rank === 1) {
                      onSelectTopRecord();
                    } else {
                      onSelectCustomRival(run);
                    }
                  }}
                  className={`h-[28px] rounded-[9px] border-2 border-[#111111] pl-1.5 ${
                    hasReplay ? 'pr-[24px]' : 'pr-2'
                  } flex items-center gap-1.5 text-[10px] font-black uppercase whitespace-nowrap cursor-pointer transition-all duration-100 ${
                    isActiveRival
                      ? 'bg-[#FFE74C] shadow-[2px_2px_0px_#111111]'
                      : isYou
                        ? 'bg-[#E7F8EE]'
                        : 'bg-[#FFFDF7]'
                  }`}
                >
                  <span
                    className={`px-1 py-[0.5px] rounded border border-[#111111] text-[9px] leading-none ${
                      rank === 1
                        ? 'bg-[#F5C342]'
                        : rank === 2
                          ? 'bg-[#7FD1AE]'
                          : rank === 3
                            ? 'bg-[#FFAD87]'
                            : 'bg-[#EFE6CE]'
                    }`}
                  >
                    #{rank}
                  </span>
                  <span>@{run.tag}</span>
                  <span className="tabular-nums text-[#111111]/85">{secs}s</span>
                </button>

                {hasReplay && (
                  <button
                    type="button"
                    onClick={() => onWatchGhostReplay?.(run)}
                    aria-label={`Watch @${run.tag} replay`}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-[18px] h-[18px] rounded-[4px] border border-[#111111] bg-[#EFE6CE] hover:bg-[#7FD1AE] text-[7.5px] font-black leading-none flex items-center justify-center cursor-pointer"
                  >
                    ▶
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
