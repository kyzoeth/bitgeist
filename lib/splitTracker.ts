import type { GhostKeyframe, GhostRun, GhostSplitEntry } from './types';

/**
 * Finds the interpolated elapsed time (in milliseconds) at which a keyframe trajectory
 * first crosses `targetWorldX`. Falls back to proportional progress if vertical/nonlinear.
 */
export function interpolateCrossingTimeMs(
  frames: readonly GhostKeyframe[],
  targetWorldX: number,
  totalTimeMs: number,
  fractionFallback: number
): number {
  if (frames.length < 2) {
    return Math.round(totalTimeMs * fractionFallback);
  }
  const lastFrameNum = Math.max(1, frames[frames.length - 1][0]);

  for (let i = 1; i < frames.length; i++) {
    const [f0, x0] = frames[i - 1];
    const [f1, x1] = frames[i];
    if ((x0 <= targetWorldX && x1 >= targetWorldX) || (x1 <= targetWorldX && x0 >= targetWorldX)) {
      const dx = x1 - x0;
      const t = Math.abs(dx) < 0.5 ? 0 : Math.max(0, Math.min(1, (targetWorldX - x0) / dx));
      const crossFrame = f0 + (f1 - f0) * t;
      return Math.max(100, Math.min(totalTimeMs, Math.round((crossFrame / lastFrameNum) * totalTimeMs)));
    }
  }

  return Math.max(100, Math.min(totalTimeMs, Math.round(totalTimeMs * fractionFallback)));
}

export function computeRunSplitEntries(opts: {
  runnerFrames: readonly GhostKeyframe[];
  runnerTimeMs: number;
  startWorldX?: number;
  goalWorldX?: number;
  targetGhost?: GhostRun | null;
  pbGhost?: GhostRun | null;
  relayLegTimesMs?: readonly number[] | null;
}): GhostSplitEntry[] {
  const {
    runnerFrames,
    runnerTimeMs,
    startWorldX = 48,
    goalWorldX = 740,
    targetGhost,
    pbGhost,
    relayLegTimesMs,
  } = opts;

  if (relayLegTimesMs && relayLegTimesMs.length === 3) {
    const cumRunner = [
      relayLegTimesMs[0],
      relayLegTimesMs[0] + relayLegTimesMs[1],
      relayLegTimesMs[0] + relayLegTimesMs[1] + relayLegTimesMs[2],
    ];
    const fractions = [1 / 3, 2 / 3, 1];
    return ['LEG 1', 'LEG 2', 'LEG 3'].map((label, idx) => {
      const rMs = Math.round(cumRunner[idx]);
      const rivalMs = targetGhost ? Math.round(targetGhost.timeMs * fractions[idx]) : null;
      const pbMs = pbGhost ? Math.round(pbGhost.timeMs * fractions[idx]) : null;
      const deltaVsRivalMs = rivalMs !== null ? rMs - rivalMs : null;
      const isGold = pbMs === null || rMs <= pbMs;
      const isMint = !isGold && (rivalMs === null || rMs <= rivalMs);
      return {
        label,
        runnerMs: rMs,
        rivalMs,
        pbMs,
        deltaVsRivalMs,
        status: isGold ? 'gold' : isMint ? 'mint' : 'coral',
      };
    });
  }

  const span = Math.max(120, goalWorldX - startWorldX);
  const checkpoints = [
    { label: 'S1 • 33%', frac: 1 / 3, worldX: startWorldX + span / 3 },
    { label: 'S2 • 67%', frac: 2 / 3, worldX: startWorldX + (span * 2) / 3 },
    { label: 'FINISH', frac: 1, worldX: goalWorldX },
  ];

  return checkpoints.map((cp, idx) => {
    const isFinal = idx === checkpoints.length - 1;
    const rMs = isFinal
      ? Math.round(runnerTimeMs)
      : interpolateCrossingTimeMs(runnerFrames, cp.worldX, runnerTimeMs, cp.frac);

    const rivalMs = targetGhost
      ? isFinal
        ? Math.round(targetGhost.timeMs)
        : interpolateCrossingTimeMs(
            targetGhost.frames,
            cp.worldX,
            targetGhost.timeMs,
            cp.frac
          )
      : null;

    const pbMs = pbGhost
      ? isFinal
        ? Math.round(pbGhost.timeMs)
        : interpolateCrossingTimeMs(pbGhost.frames, cp.worldX, pbGhost.timeMs, cp.frac)
      : null;

    const deltaVsRivalMs = rivalMs !== null ? rMs - rivalMs : null;
    const isGold = (pbMs !== null && rMs <= pbMs) || (pbMs === null && deltaVsRivalMs !== null && deltaVsRivalMs <= 0);
    const isMint = !isGold && (deltaVsRivalMs === null || deltaVsRivalMs <= 0);

    return {
      label: cp.label,
      runnerMs: rMs,
      rivalMs,
      pbMs,
      deltaVsRivalMs,
      status: isGold ? 'gold' : isMint ? 'mint' : 'coral',
    };
  });
}
