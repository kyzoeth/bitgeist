'use client';

import React, { useEffect, useRef } from 'react';
import {
  drawHologramDerezBurst,
  getHologramRunnerSprites,
  getPixelCrownSprite,
  getRunnerArchetypeForTag,
  selectRunnerPose,
} from '@/lib/hologramRunners';
import { CoachPromptNode, KdeHazardZone } from '@/lib/speedrunIntelligence';
import {
  FloatingPopup,
  GhostKeyframe,
  GhostRun,
  LivePartyRunner,
  PracticePinState,
  RaceStatus,
} from '@/lib/types';

interface FinishCelebrationState {
  startedAtMs: number;
  timeMs: number;
  beatTarget: boolean;
  isDare?: boolean;
  targetTag: string | null;
  deltaVsTargetMs: number | null;
}

export interface LiveOverlayState {
  raceStatus: RaceStatus;
  inGameplay?: boolean;
  raceFrame: number;
  playerWorldX: number;
  playerWorldY: number;
  cameraX: number;
  cameraY?: number;
  goalWorldX: number;
  deathFlashFrames: number;
  popups: FloatingPopup[];
  isReplayingInputs: boolean;
  isAttractReplay?: boolean;
  attractGhostId?: string | null;
  attractGhostTag?: string | null;
  attractGhostTimeMs?: number | null;
  attractIsDare?: boolean;
  finishCelebration?: FinishCelebrationState | null;
  coachArc?: readonly CoachPromptNode[] | null;
  hazardZones?: readonly KdeHazardZone[] | null;
}

interface GhostCanvasOverlayProps {
  targetGhost: GhostRun | null;
  swarmGhosts?: readonly GhostRun[];
  swarmEnabled?: boolean;
  partyRunners?: readonly LivePartyRunner[];
  selfRunnerId?: string;
  practicePin?: PracticePinState | null;
  liveStateRef: React.MutableRefObject<LiveOverlayState>;
  overlayCanvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
}

export interface InterpolatedPos {
  x: number;
  y: number;
  alive: boolean;
}

const CONFETTI_COLORS = [
  '#FFE74C',
  '#7FD1AE',
  '#EC6553',
  '#4CC9F0',
  '#F15BB5',
  '#9B5DE5',
];

const COAST_FRAMES_AFTER_FINISH = 28;

export function interpolateGhostPosInto(
  frames: GhostKeyframe[],
  currentFrame: number,
  diedAtFrame: number | undefined,
  out: InterpolatedPos
): boolean {
  const len = frames.length;
  if (len === 0) return false;
  if (diedAtFrame !== undefined && currentFrame > diedAtFrame) {
    const last = frames[len - 1];
    out.x = last[1];
    out.y = last[2];
    out.alive = false;
    return true;
  }
  const first = frames[0];
  if (currentFrame <= first[0]) {
    out.x = first[1];
    out.y = first[2];
    out.alive = true;
    return true;
  }
  const last = frames[len - 1];
  if (currentFrame >= last[0]) {
    out.x = last[1];
    out.y = last[2];
    out.alive = true;
    return true;
  }

  // Binary search keyframe bracket
  let lo = 0;
  let hi = len - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid][0] <= currentFrame) lo = mid;
    else hi = mid;
  }

  const [f0, x0, y0] = frames[lo];
  const [f1, x1, y1] = frames[hi];
  const span = Math.max(1, f1 - f0);
  const t = (currentFrame - f0) / span;
  out.x = x0 + (x1 - x0) * t;
  out.y = y0 + (y1 - y0) * t;
  out.alive = true;
  return true;
}

/**
 * Computes live speedrun split differential (in seconds) against a rival ghost:
 * - Negative (`-0.24s`, mint): You are ahead of this ghost's pace.
 * - Positive (`+0.31s`, coral): This ghost is ahead of you (you trail their pace).
 */
export function computeGhostSplitDeltaSec(
  frames: GhostKeyframe[],
  effectiveFrame: number,
  playerWorldX: number,
  ghostWorldX: number
): number {
  const len = frames.length;
  if (len < 2) return 0;

  const first = frames[0];
  const last = frames[len - 1];
  const avgSpeedPxPerFrame = Math.max(
    1.25,
    (last[1] - first[1]) / Math.max(1, last[0] - first[0])
  );

  let ghostFrameAtPlayerX: number | null = null;
  for (let i = 1; i < len; i++) {
    const [f0, x0] = frames[i - 1];
    const [f1, x1] = frames[i];
    if ((x0 <= playerWorldX && x1 >= playerWorldX) || (x1 <= playerWorldX && x0 >= playerWorldX)) {
      const dx = x1 - x0;
      const t = Math.abs(dx) < 0.5 ? 0 : (playerWorldX - x0) / dx;
      ghostFrameAtPlayerX = f0 + (f1 - f0) * Math.max(0, Math.min(1, t));
      break;
    }
  }

  let rawDeltaSec: number;
  if (ghostFrameAtPlayerX !== null) {
    rawDeltaSec = (effectiveFrame - ghostFrameAtPlayerX) / 60;
  } else {
    rawDeltaSec = (ghostWorldX - playerWorldX) / avgSpeedPxPerFrame / 60;
  }

  // Keep sign visually consistent with spatial lead when separated by >3 NES px
  const spatialDx = ghostWorldX - playerWorldX;
  if (spatialDx > 3 && rawDeltaSec < 0.01) {
    rawDeltaSec = Math.max(0.01, spatialDx / avgSpeedPxPerFrame / 60);
  } else if (spatialDx < -3 && rawDeltaSec > -0.01) {
    rawDeltaSec = Math.min(-0.01, spatialDx / avgSpeedPxPerFrame / 60);
  }

  return Math.max(-59.99, Math.min(59.99, rawDeltaSec));
}

export default function GhostCanvasOverlay({
  targetGhost,
  swarmGhosts = [],
  swarmEnabled = false,
  partyRunners = [],
  selfRunnerId = '',
  practicePin = null,
  liveStateRef,
  overlayCanvasRef,
}: GhostCanvasOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetGhostRef = useRef<GhostRun | null>(targetGhost);
  const swarmGhostsRef = useRef<readonly GhostRun[]>(swarmGhosts);
  const swarmEnabledRef = useRef<boolean>(swarmEnabled);
  const partyRunnersRef = useRef<readonly LivePartyRunner[]>(partyRunners);
  const selfRunnerIdRef = useRef<string>(selfRunnerId);
  const practicePinRef = useRef<PracticePinState | null>(practicePin);

  useEffect(() => {
    if (overlayCanvasRef) {
      overlayCanvasRef.current = canvasRef.current;
    }
    return () => {
      if (overlayCanvasRef) {
        overlayCanvasRef.current = null;
      }
    };
  }, [overlayCanvasRef]);

  useEffect(() => {
    targetGhostRef.current = targetGhost;
  }, [targetGhost]);

  useEffect(() => {
    swarmGhostsRef.current = swarmGhosts;
  }, [swarmGhosts]);

  useEffect(() => {
    swarmEnabledRef.current = swarmEnabled;
  }, [swarmEnabled]);

  useEffect(() => {
    partyRunnersRef.current = partyRunners;
  }, [partyRunners]);

  useEffect(() => {
    selfRunnerIdRef.current = selfRunnerId;
  }, [selfRunnerId]);

  useEffect(() => {
    practicePinRef.current = practicePin;
  }, [practicePin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let rafId = 0;
    let lastNow = 0;
    const scratchPos: InterpolatedPos = { x: 0, y: 0, alive: true };
    const scratchPrevPos: InterpolatedPos = { x: 0, y: 0, alive: true };
    const crownSprite = getPixelCrownSprite();

    const renderFrame = (now: number) => {
      const dtMs = lastNow > 0 ? Math.min(64, Math.max(0, now - lastNow)) : 16.67;
      lastNow = now;

      const st = liveStateRef.current;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;

      // Deliberate Coral Death Impact Frame & Arcade Wipeout Banner
      const activeDeathFlashFrames = st.deathFlashFrames;
      if (st.deathFlashFrames > 0) {
        st.deathFlashFrames--;
      }

      if (
        st.raceStatus === 'booting' ||
        st.raceStatus === 'error' ||
        st.raceStatus === 'pregame' ||
        (st.inGameplay === false && st.raceStatus !== 'won' && activeDeathFlashFrames <= 0)
      ) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }

      // 2x NES native coordinate space (256x240 -> 512x480)
      const scale = 2;
      const camY = st.cameraY || 0;
      const animPhase = now * 0.0085;
      const isWon = st.raceStatus === 'won';
      const celebration = st.finishCelebration;
      const celebElapsedMs =
        isWon && celebration ? Math.max(0, performance.now() - celebration.startedAtMs) : 0;

      // 1. Full-Height Checkered Finish Arch & Shimmering Tape Gate (Zero Flagpole Pileup!)
      const gateScreenX = Math.round((st.goalWorldX - st.cameraX) * scale);
      if (gateScreenX > -90 && gateScreenX < canvas.width + 90) {
        const archTopY = 12;
        const archW = 68;
        const archH = 26;
        const beamTopY = archTopY + archH;
        const beamBottomY = canvas.height - 20;

        // Vertical Holographic Finish Tape Beam (snaps apart from player's crossing Y on victory!)
        const playerCrossY = Math.max(
          beamTopY + 24,
          Math.min(beamBottomY - 24, Math.round((st.playerWorldY - camY) * scale) - 18)
        );
        const snapGap = isWon ? Math.min(220, Math.round(celebElapsedMs * 0.65)) : 0;

        ctx.save();
        if (!isWon) {
          // Outer mint shimmer aura
          ctx.globalAlpha = 0.24 + Math.sin(animPhase * 1.4) * 0.08;
          ctx.fillStyle = '#7FD1AE';
          ctx.fillRect(gateScreenX - 6, beamTopY, 12, beamBottomY - beamTopY);

          // Animated checkered/dashed laser tape core
          const dashOffset = Math.floor(now * 0.06) % 20;
          ctx.globalAlpha = 0.78;
          for (let y = beamTopY - 20 + dashOffset; y < beamBottomY; y += 20) {
            const segTop = Math.max(beamTopY, y);
            const segBot = Math.min(beamBottomY, y + 12);
            if (segBot > segTop) {
              ctx.fillStyle = '#111111';
              ctx.fillRect(gateScreenX - 3, segTop, 6, segBot - segTop);
              ctx.fillStyle = (Math.floor((y - dashOffset) / 20) & 1) === 0 ? '#FFE74C' : '#FFFFFF';
              ctx.fillRect(gateScreenX - 2, segTop + 1, 4, Math.max(1, segBot - segTop - 2));
            }
          }
        } else if (snapGap < 210) {
          // Snapped upper & lower tape ends recoiling away from the crossing point
          ctx.globalAlpha = Math.max(0, 0.85 - snapGap / 220);
          ctx.fillStyle = '#FFE74C';
          const upperEnd = Math.max(beamTopY, playerCrossY - snapGap);
          if (upperEnd > beamTopY) {
            ctx.fillRect(gateScreenX - 2, beamTopY, 4, upperEnd - beamTopY);
          }
          const lowerStart = Math.min(beamBottomY, playerCrossY + snapGap);
          if (beamBottomY > lowerStart) {
            ctx.fillRect(gateScreenX - 2, lowerStart, 4, beamBottomY - lowerStart);
          }
        }
        ctx.restore();

        // Overhead Checkered Finish Arch Banner
        const archLeft = gateScreenX - archW / 2;
        ctx.fillStyle = '#111111';
        ctx.fillRect(archLeft - 2, archTopY - 2, archW + 4, archH + 4);
        ctx.fillStyle = isWon ? '#7FD1AE' : '#18171C';
        ctx.fillRect(archLeft, archTopY, archW, archH);

        // Top checkered trim row inside arch
        const cellW = 8;
        for (let c = 0; c < 8; c++) {
          ctx.fillStyle = c % 2 === 0 ? '#FFFFFF' : '#111111';
          ctx.fillRect(archLeft + 2 + c * cellW, archTopY + 2, cellW, 6);
        }
        ctx.fillStyle = isWon ? '#111111' : '#FFE74C';
        ctx.font = '900 11px monospace';
        ctx.fillText('FINISH', archLeft + 13, archTopY + 21);

        // Ground Anchor Emitter Pad
        ctx.fillStyle = '#111111';
        ctx.fillRect(gateScreenX - 14, beamBottomY - 2, 28, 12);
        ctx.fillStyle = isWon ? '#FFE74C' : '#7FD1AE';
        ctx.fillRect(gateScreenX - 12, beamBottomY, 24, 8);
      }

      // 2. Render Top-10 Swarm Holograms (when Swarm Mode is toggled on) + Primary 1v1 Rival Hologram
      const isAttract = Boolean(st.isAttractReplay);
      const isWaiting = st.raceStatus === 'waiting' && !isAttract;
      const isCountdown = st.raceStatus === 'countdown' && !isAttract;
      const isPreviewStyle = isWaiting || isCountdown || isAttract;
      // Rival & Swarm ghosts remain poised at frame 0 until GO! so characters never move before the race begins
      const effectiveFrame = isWaiting || isCountdown ? 0 : st.raceFrame;
      const rivalGhost = targetGhostRef.current;

      if (!isAttract && swarmEnabledRef.current && swarmGhostsRef.current.length > 0) {
        const swarmList = swarmGhostsRef.current;
        for (let sIdx = swarmList.length - 1; sIdx >= 0; sIdx--) {
          const sg = swarmList[sIdx];
          if (!sg || sg.id === rivalGhost?.id || sg.frames.length === 0) continue;
          const hasSwarmPos = interpolateGhostPosInto(
            sg.frames,
            effectiveFrame,
            sg.diedAtFrame,
            scratchPos
          );
          if (!hasSwarmPos || !scratchPos.alive) continue;

          const lastSwarmKf = sg.frames[sg.frames.length - 1];
          const overSwarmFrames = Math.max(0, effectiveFrame - lastSwarmKf[0]);
          if (overSwarmFrames > COAST_FRAMES_AFTER_FINISH) continue;

          const swarmFade =
            overSwarmFrames > 0
              ? Math.max(0, 1 - overSwarmFrames / COAST_FRAMES_AFTER_FINISH)
              : 1;
          const drawWorldX = scratchPos.x + overSwarmFrames * 2.4;
          const drawWorldY = scratchPos.y - overSwarmFrames * 1.1;
          const sx = Math.round((drawWorldX - st.cameraX) * scale);
          const sy = Math.round((drawWorldY - camY) * scale);
          if (sx < -64 || sx > canvas.width + 64 || sy < -64 || sy > canvas.height + 64) continue;

          let vx = overSwarmFrames > 0 ? 2.4 : 0;
          let vy = overSwarmFrames > 0 ? -1.1 : 0;
          if (overSwarmFrames === 0 && effectiveFrame > 0.5) {
            const sampleDt = Math.min(2, effectiveFrame);
            if (
              interpolateGhostPosInto(
                sg.frames,
                effectiveFrame - sampleDt,
                sg.diedAtFrame,
                scratchPrevPos
              )
            ) {
              vx = (scratchPos.x - scratchPrevPos.x) / sampleDt;
              vy = (scratchPos.y - scratchPrevPos.y) / sampleDt;
            }
          }

          const isPoisedAtStart = (isWaiting || isCountdown) && effectiveFrame < 1;
          const facingLeft = !isPoisedAtStart && vx < -0.18;
          const archetype = getRunnerArchetypeForTag(sg.tag);
          const pose = selectRunnerPose({
            isWaiting: isPoisedAtStart,
            vx,
            vy,
            animPhase: animPhase + sIdx * 0.35,
            runnerSeed: sIdx + 1,
            distanceX: drawWorldX,
          });
          const swarmColor = sg.color || '#7FD1AE';
          const sprites = getHologramRunnerSprites(archetype, swarmColor, pose, facingLeft);
          if (sprites) {
            ctx.globalAlpha = 0.28 * swarmFade;
            ctx.drawImage(sprites.main, sx - 18, sy - 38);
          }

          if (!isWaiting && !isCountdown && !isWon) {
            const rankTag = `#${sIdx + 1}`;
            ctx.globalAlpha = 0.65 * swarmFade;
            ctx.font = '900 9px monospace';
            const rtw = Math.ceil(ctx.measureText(rankTag).width);
            const rbx = Math.round(sx - rtw / 2 - 3);
            const rby = sy - 50;
            ctx.fillStyle = 'rgba(17, 17, 17, 0.78)';
            ctx.fillRect(rbx, rby, rtw + 6, 12);
            ctx.fillStyle = swarmColor;
            ctx.fillText(rankTag, rbx + 3, rby + 9);
          }
        }
        ctx.globalAlpha = 1;
      }

      // 2b. Render Live Party Heat Co-Runners (Stage 10 Live Lobby)
      if (!isAttract && partyRunnersRef.current.length > 0) {
        for (let pIdx = 0; pIdx < partyRunnersRef.current.length; pIdx++) {
          const pr = partyRunnersRef.current[pIdx];
          if (!pr || pr.runnerId === selfRunnerIdRef.current) continue;
          const sx = Math.round((pr.worldX - st.cameraX) * scale);
          const sy = Math.round((pr.worldY - camY) * scale);
          if (sx < -64 || sx > canvas.width + 64 || sy < -64 || sy > canvas.height + 64) continue;
          const isPoised = isWaiting || isCountdown || pr.status === 'waiting' || pr.status === 'countdown';
          const archetype = getRunnerArchetypeForTag(pr.tag);
          const pose = selectRunnerPose({
            isWaiting: isPoised,
            vx: isPoised ? 0 : 1.5,
            vy: 0,
            animPhase: animPhase + pIdx * 0.5,
            runnerSeed: pIdx + 10,
            distanceX: pr.worldX,
          });
          const pColor = pr.color || '#4CC9F0';
          const sprites = getHologramRunnerSprites(archetype, pColor, pose, false);
          if (sprites) {
            ctx.globalAlpha = 0.72;
            ctx.drawImage(sprites.main, sx - 18, sy - 38);
          }
          const pLabel = `⚡@${pr.tag}`;
          ctx.globalAlpha = 0.92;
          ctx.font = '900 10px monospace';
          const ptw = Math.ceil(ctx.measureText(pLabel).width);
          const pbx = Math.round(sx - ptw / 2 - 4);
          const pby = sy - 54;
          ctx.fillStyle = 'rgba(17, 17, 17, 0.9)';
          ctx.fillRect(pbx, pby, ptw + 8, 13);
          ctx.fillStyle = pColor;
          ctx.fillText(pLabel, pbx + 4, pby + 10);
        }
        ctx.globalAlpha = 1;
      }

      if (!isAttract && rivalGhost && rivalGhost.frames.length > 0) {
        const g = rivalGhost;
        const runnerColor = g.tag === 'APEX•TAS' ? '#00F5D4' : '#FFE74C';
        const hasPos = interpolateGhostPosInto(g.frames, effectiveFrame, g.diedAtFrame, scratchPos);

        if (hasPos && !scratchPos.alive) {
          if (
            g.diedAtFrame !== undefined &&
            effectiveFrame > g.diedAtFrame &&
            effectiveFrame <= g.diedAtFrame + 22
          ) {
            const burstSx = Math.round((scratchPos.x - st.cameraX) * scale);
            const burstSy = Math.round((scratchPos.y - camY) * scale) - 18;
            if (
              burstSx > -64 &&
              burstSx < canvas.width + 64 &&
              burstSy > -64 &&
              burstSy < canvas.height + 64
            ) {
              drawHologramDerezBurst(
                ctx,
                burstSx,
                burstSy,
                runnerColor,
                (effectiveFrame - g.diedAtFrame) / 22
              );
            }
          }
        } else if (hasPos) {
          // Coast through & beam out cleanly once #1 rival crosses the finish gate
          const lastKf = g.frames[g.frames.length - 1];
          const overFinishFrames = Math.max(0, effectiveFrame - lastKf[0]);
          if (overFinishFrames <= COAST_FRAMES_AFTER_FINISH) {
            const finishFade =
              overFinishFrames > 0
                ? Math.max(0, 1 - overFinishFrames / COAST_FRAMES_AFTER_FINISH)
                : 1;

            const drawWorldX = scratchPos.x + overFinishFrames * 2.5;
            const drawWorldY = scratchPos.y - overFinishFrames * 1.15;

            const sx = Math.round((drawWorldX - st.cameraX) * scale);
            const sy = Math.round((drawWorldY - camY) * scale);
            if (sx >= -80 && sx <= canvas.width + 80 && sy >= -80 && sy <= canvas.height + 96) {
              const distToPlayer = Math.hypot(
                drawWorldX - st.playerWorldX,
                drawWorldY - st.playerWorldY
              );
              const proxT = Math.max(0, Math.min(1, (distToPlayer - 14) / 24));
              const spriteAlpha = (0.42 + 0.28 * proxT) * finishFade;

              let vx = overFinishFrames > 0 ? 2.5 : 0;
              let vy = overFinishFrames > 0 ? -1.15 : 0;
              if (overFinishFrames === 0 && effectiveFrame > 0.5) {
                const sampleDt = Math.min(2, effectiveFrame);
                if (
                  interpolateGhostPosInto(
                    g.frames,
                    effectiveFrame - sampleDt,
                    g.diedAtFrame,
                    scratchPrevPos
                  )
                ) {
                  vx = (scratchPos.x - scratchPrevPos.x) / sampleDt;
                  vy = (scratchPos.y - scratchPrevPos.y) / sampleDt;
                }
              }

              const isPoisedAtStart = (isWaiting || isCountdown) && effectiveFrame < 1;
              const facingLeft = !isPoisedAtStart && vx < -0.18;
              const archetype = getRunnerArchetypeForTag(g.tag);
              const pose = selectRunnerPose({
                isWaiting: isPoisedAtStart,
                vx,
                vy,
                animPhase,
                runnerSeed: 0,
                distanceX: drawWorldX,
              });
              const sprites = getHologramRunnerSprites(archetype, runnerColor, pose, facingLeft);

              // 2a. Stage 11: World-Space Ghost Trajectory Breadcrumb Arc + Soft Hologram Speed Echoes
              if (overFinishFrames === 0 && effectiveFrame > 4) {
                for (let step = 8; step >= 1; step--) {
                  const crumbFrame = effectiveFrame - step * 4;
                  if (crumbFrame <= 0) continue;
                  if (
                    interpolateGhostPosInto(g.frames, crumbFrame, g.diedAtFrame, scratchPrevPos) &&
                    scratchPrevPos.alive
                  ) {
                    const cx = Math.round((scratchPrevPos.x - st.cameraX) * scale);
                    const cy = Math.round((scratchPrevPos.y - camY) * scale) - 16;
                    const fade = (1 - step / 9) * 0.55 * finishFade;
                    ctx.globalAlpha = fade;
                    ctx.fillStyle = '#111111';
                    ctx.fillRect(cx - 3, cy - 3, 6, 6);
                    ctx.fillStyle = step % 2 === 0 ? '#FFE74C' : '#7FD1AE';
                    ctx.fillRect(cx - 2, cy - 2, 4, 4);
                  }
                }
              }

              if (
                sprites &&
                overFinishFrames === 0 &&
                effectiveFrame > 4 &&
                (Math.abs(vx) > 0.85 || Math.abs(vy) > 0.65)
              ) {
                for (let echoIdx = 2; echoIdx >= 1; echoIdx--) {
                  const trailFrame = Math.max(0, effectiveFrame - echoIdx * 3.2);
                  if (
                    interpolateGhostPosInto(g.frames, trailFrame, g.diedAtFrame, scratchPrevPos) &&
                    scratchPrevPos.alive
                  ) {
                    const ex = Math.round((scratchPrevPos.x - st.cameraX) * scale);
                    const ey = Math.round((scratchPrevPos.y - camY) * scale);
                    ctx.globalAlpha = (echoIdx === 1 ? 0.18 : 0.09) * finishFade;
                    ctx.drawImage(sprites.echo, ex - 18, ey - 38);
                  }
                }
              }

              // 2b. Grounded Hologram Foot Shadow
              if (Math.abs(vy) < 0.45 && overFinishFrames === 0) {
                ctx.globalAlpha = 0.24 * finishFade;
                ctx.fillStyle = '#111111';
                ctx.fillRect(sx - 10, sy - 2, 20, 4);
              }

              // 2c. Main Translucent 8-Bit Hologram Runner Sprite
              ctx.globalAlpha = spriteAlpha;
              if (sprites) {
                ctx.drawImage(sprites.main, sx - 18, sy - 38);
              }

              // 2d. Finish-Gate Crossing Pill or Jeweled Pixel Crown & Live Split Differential
              if (overFinishFrames > 0) {
                const finishLabel = `🏁 #1 @${g.tag}`;
                ctx.globalAlpha = Math.min(0.95, finishFade * 1.25);
                ctx.font = '900 10px monospace';
                const ftw = Math.ceil(ctx.measureText(finishLabel).width);
                const pillX = Math.round(sx - ftw / 2 - 5);
                const pillY = sy - 54;
                ctx.fillStyle = '#111111';
                ctx.fillRect(pillX, pillY, ftw + 10, 14);
                ctx.fillStyle = '#FFE74C';
                ctx.fillText(finishLabel, pillX + 5, pillY + 11);
              } else {
                const crownBob = Math.round(Math.sin(animPhase * 1.15) * 2);
                if (crownSprite) {
                  ctx.globalAlpha = 0.9 * finishFade;
                  ctx.drawImage(crownSprite, sx - 13, sy - 54 + crownBob);
                }

                if (isWaiting || isCountdown) {
                  const leaderLabel = `@${g.tag}`;
                  ctx.globalAlpha = 0.92 * finishFade;
                  ctx.font = '900 11px monospace';
                  const lw = Math.ceil(ctx.measureText(leaderLabel).width);
                  const boxX = Math.max(
                    6,
                    Math.min(canvas.width - lw - 14, Math.round(sx - lw / 2 - 5))
                  );
                  const boxY = sy - 71 + crownBob;
                  ctx.fillStyle = 'rgba(17, 17, 17, 0.92)';
                  ctx.fillRect(boxX, boxY, lw + 10, 15);
                  ctx.fillStyle = '#FFE74C';
                  ctx.fillText(leaderLabel, boxX + 5, boxY + 11);
                } else if (!isWon) {
                  const splitSec = computeGhostSplitDeltaSec(
                    g.frames,
                    effectiveFrame,
                    st.playerWorldX,
                    scratchPos.x
                  );
                  const deltaStr =
                    splitSec <= 0 ? `${splitSec.toFixed(2)}s` : `+${splitSec.toFixed(2)}s`;
                  const deltaCol = splitSec <= 0 ? '#7FD1AE' : '#FF8B7B';
                  const tagPart = `@${g.tag} `;

                  ctx.globalAlpha = 0.92;
                  ctx.font = '900 11px monospace';
                  const tagW = Math.ceil(ctx.measureText(tagPart).width);
                  const deltaW = Math.ceil(ctx.measureText(deltaStr).width);
                  const totalW = tagW + deltaW;
                  const boxX = Math.max(
                    6,
                    Math.min(canvas.width - totalW - 14, Math.round(sx - totalW / 2 - 5))
                  );
                  const boxY = sy - 71 + crownBob;

                  ctx.fillStyle = 'rgba(17, 17, 17, 0.92)';
                  ctx.fillRect(boxX, boxY, totalW + 10, 15);
                  ctx.fillStyle = '#FFE74C';
                  ctx.fillText(tagPart, boxX + 5, boxY + 11);
                  ctx.fillStyle = deltaCol;
                  ctx.fillText(deltaStr, boxX + 5 + tagW, boxY + 11);
                }
              }
            }
          }
        }
      }

      ctx.globalAlpha = 1;

      // 2e. Stage 14: Holographic Practice Save-Pin Beacon (When Active)
      const activePin = practicePinRef.current;
      if (activePin && !isAttract) {
        const pinSx = Math.round((activePin.worldX - st.cameraX) * scale) + 12;
        const pinSy = Math.round((activePin.worldY - camY) * scale);
        if (pinSx >= -48 && pinSx <= canvas.width + 48 && pinSy >= -48 && pinSy <= canvas.height + 48) {
          ctx.fillStyle = '#111111';
          ctx.fillRect(pinSx - 2, pinSy - 34, 4, 34);
          ctx.fillStyle = '#4CC9F0';
          ctx.fillRect(pinSx - 1, pinSy - 33, 2, 32);

          const pinText = '📍 PIN [O]';
          ctx.font = '900 9px monospace';
          const ptw = Math.ceil(ctx.measureText(pinText).width);
          ctx.fillStyle = '#111111';
          ctx.fillRect(pinSx, pinSy - 36, ptw + 8, 13);
          ctx.fillStyle = '#4CC9F0';
          ctx.fillRect(pinSx + 1, pinSy - 35, ptw + 6, 11);
          ctx.fillStyle = '#111111';
          ctx.fillText(pinText, pinSx + 4, pinSy - 26);
        }
      }

      // 2f. Stage 17: Counterfactual DTW Trajectory Coach Optimal Input Arc (When Drilling a Mistake)
      const activeCoachArc = st.coachArc;
      if (activeCoachArc && activeCoachArc.length > 0 && !isAttract && !isWon) {
        ctx.save();
        // Draw dashed glowing cyan trajectory line connecting arc nodes
        for (let i = 1; i < activeCoachArc.length; i++) {
          const n0 = activeCoachArc[i - 1];
          const n1 = activeCoachArc[i];
          const x0 = Math.round((n0.worldX - st.cameraX) * scale);
          const y0 = Math.round((n0.worldY - camY) * scale) - 14;
          const x1 = Math.round((n1.worldX - st.cameraX) * scale);
          const y1 = Math.round((n1.worldY - camY) * scale) - 14;
          if ((x0 < -40 && x1 < -40) || (x0 > canvas.width + 40 && x1 > canvas.width + 40)) {
            continue;
          }
          ctx.strokeStyle = '#111111';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();

          ctx.strokeStyle = '#00F5D4';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }

        // Draw actionable JUMP / DASH prompt markers along the arc
        for (let i = 0; i < activeCoachArc.length; i++) {
          const node = activeCoachArc[i];
          if (node.action === 'move') continue;
          const nx = Math.round((node.worldX - st.cameraX) * scale);
          const ny = Math.round((node.worldY - camY) * scale) - 22;
          if (nx < -48 || nx > canvas.width + 48 || ny < 16 || ny > canvas.height - 16) continue;

          ctx.font = '900 10px monospace';
          const tw = Math.ceil(ctx.measureText(node.label).width);
          const bx = Math.round(nx - tw / 2 - 5);
          const by = ny - 18;
          ctx.fillStyle = '#111111';
          ctx.fillRect(bx - 1, by - 1, tw + 12, 16);
          ctx.fillStyle = node.action === 'jump' ? '#00F5D4' : '#FFE74C';
          ctx.fillRect(bx, by, tw + 10, 14);
          ctx.fillStyle = '#111111';
          ctx.fillText(node.label, bx + 5, by + 11);
        }
        ctx.restore();
      }

      // 2g. Stage 19: Spatial KDE Death-Field Choke-Point Hazard Beacons
      const hazardList = st.hazardZones;
      if (hazardList && hazardList.length > 0 && !isAttract && !isWon && !isWaiting) {
        for (let hIdx = 0; hIdx < hazardList.length; hIdx++) {
          const hz = hazardList[hIdx];
          const hx = Math.round((hz.worldX - st.cameraX) * scale);
          if (hx < 24 || hx > canvas.width - 24) continue;
          const hy = canvas.height - 16;
          ctx.fillStyle = '#111111';
          ctx.fillRect(hx - 18, hy - 11, 36, 11);
          ctx.fillStyle = '#EC6553';
          ctx.fillRect(hx - 17, hy - 10, 34, 9);
          ctx.fillStyle = '#111111';
          ctx.font = '900 8px monospace';
          ctx.fillText(`!${hz.wipePercent}%`, hx - 12, hy - 3);
        }
      }

      // 3. Starting-State Objective Sign (Only When Finish Gate Is Off-Screen; Rival Info Already Lives in Top Bezel)
      if (isWaiting && gateScreenX > canvas.width - 16) {
        const nudgeX = Math.round(Math.sin(now * 0.007) * 2);
        const isVerticalClimb = rivalGhost?.consoleSystem === 'gba';
        const signText = isVerticalClimb ? 'GOAL: CLIMB 3 ROOMS ^' : 'GOAL: SPRINT RIGHT ->';
        ctx.font = '900 10px monospace';
        const stw = Math.ceil(ctx.measureText(signText).width);
        const signW = stw + 14;
        const signH = 18;
        const signX = canvas.width - signW - 14 + nudgeX;
        const signY = 12;

        ctx.fillStyle = '#111111';
        ctx.fillRect(signX - 2, signY - 2, signW + 4, signH + 4);
        ctx.fillStyle = '#7FD1AE';
        ctx.fillRect(signX, signY, signW, signH);
        ctx.fillStyle = '#111111';
        ctx.fillText(signText, signX + 7, signY + 12);
      }

      // 4. Crisp "YOU ▼" (or "#1 @TAG ▼" during Attract Mode / "RPLY ▼" during manual replay) Badge Above Active NES Runner
      const youBob = isPreviewStyle ? Math.round(Math.sin(now * 0.008) * 2) : 0;
      const px = Math.round((st.playerWorldX - st.cameraX) * scale) + 14;
      const py = Math.round((st.playerWorldY - camY) * scale) - 10 + youBob;
      if (px >= -20 && px <= canvas.width + 20 && py >= 16 && py <= canvas.height) {
        if (isAttract) {
          const demoTag = st.attractGhostTag || 'ALEX';
          const badgeText = st.attractIsDare ? `@${demoTag}` : `#1 @${demoTag}`;
          ctx.font = '900 10px monospace';
          const tw = Math.ceil(ctx.measureText(badgeText).width);
          const bw = tw + 14;
          const bx = Math.max(4, Math.min(canvas.width - bw - 4, Math.round(px - bw / 2)));
          if (crownSprite) {
            ctx.drawImage(crownSprite, px - 13, py - 53);
          }
          ctx.fillStyle = '#111111';
          ctx.fillRect(bx, py - 34, bw, 17);
          ctx.fillStyle = '#FFE74C';
          ctx.fillRect(bx + 2, py - 32, bw - 4, 13);
          ctx.fillStyle = '#111111';
          ctx.fillText(badgeText, bx + 7, py - 22);
          ctx.fillRect(px - 3, py - 17, 6, 3);
          ctx.fillRect(px - 1, py - 14, 2, 2);
        } else {
          const badgeWord = st.isReplayingInputs ? 'RPLY' : 'YOU';
          const bw = st.isReplayingInputs ? 44 : 38;
          ctx.fillStyle = '#111111';
          ctx.fillRect(px - bw / 2, py - 34, bw, 17);
          ctx.fillStyle =
            st.isReplayingInputs ? '#FFE74C' : isWaiting || isCountdown ? '#7FD1AE' : '#FFF9E6';
          ctx.fillRect(px - bw / 2 + 2, py - 32, bw - 4, 13);
          ctx.fillStyle = '#111111';
          ctx.font = '900 11px monospace';
          ctx.fillText(badgeWord, px - (st.isReplayingInputs ? 13 : 10), py - 22);
          ctx.fillRect(px - 3, py - 17, 6, 3);
          ctx.fillRect(px - 1, py - 14, 2, 2);
        }
      }

      // 4. Floating World-Space Ghost-Overtake Popups (+1 PASS! / 👑 PASSED @TAG!)
      if (st.popups.length > 0) {
        ctx.font = '900 11px monospace';
        let writeIdx = 0;
        for (let i = 0; i < st.popups.length; i++) {
          const p = st.popups[i];
          p.ttlMs -= dtMs;
          if (p.ttlMs <= 0) continue;
          st.popups[writeIdx++] = p;

          const progress = 1 - p.ttlMs / Math.max(1, p.maxTtlMs);
          const risePx = Math.round(progress * 28);
          const popX = Math.round((p.worldX - st.cameraX) * scale);
          const popY = Math.round((p.worldY - camY) * scale) - 44 - risePx;

          if (popX < -80 || popX > canvas.width + 80) continue;

          ctx.globalAlpha = Math.min(1, (p.ttlMs / Math.max(1, p.maxTtlMs)) * 2.4);
          const tw = Math.ceil(ctx.measureText(p.text).width);
          const boxW = tw + 12;
          const boxH = 17;
          const leftX = Math.round(popX - boxW / 2);

          ctx.fillStyle = '#111111';
          ctx.fillRect(leftX - 2, popY - 2, boxW + 4, boxH + 4);
          ctx.fillStyle = p.bg;
          ctx.fillRect(leftX, popY, boxW, boxH);
          ctx.fillStyle = p.textColor;
          ctx.fillText(p.text, leftX + 6, popY + 12);
        }
        st.popups.length = writeIdx;
        ctx.globalAlpha = 1;
      }

      // 5. 1200ms Finish-Gate Confetti & Clear Arcade Victory Banner Before Modal Opens
      if (isWon && celebration) {
        const originX = Math.max(72, Math.min(canvas.width - 72, px));
        const originY = Math.max(80, Math.min(canvas.height - 80, py - 10));
        const tSec = Math.min(2.0, celebElapsedMs / 1000);

        // 24-piece 8-bit pixel confetti burst
        for (let k = 0; k < 24; k++) {
          const angle = (k / 24) * Math.PI * 2 + (k % 3) * 0.18;
          const speed = 95 + (k % 5) * 34;
          const cx = Math.round(originX + Math.cos(angle) * speed * tSec);
          const cy = Math.round(
            originY + Math.sin(angle) * speed * tSec - 75 * tSec + 185 * tSec * tSec
          );
          if (cx < -12 || cx > canvas.width + 12 || cy < -12 || cy > canvas.height + 12) continue;
          const sz = k % 2 === 0 ? 8 : 6;
          ctx.fillStyle = '#111111';
          ctx.fillRect(cx - 1, cy - 1, sz + 2, sz + 2);
          ctx.fillStyle = CONFETTI_COLORS[k % CONFETTI_COLORS.length];
          ctx.fillRect(cx, cy, sz, sz);
        }

        // Centered Arcade Finish Plaque
        const popIn = Math.min(1, celebElapsedMs / 130);
        const cardW = 344;
        const cardH = 92;
        const cardX = Math.round((canvas.width - cardW) / 2);
        const cardY = Math.round(86 - (1 - popIn) * 14);

        ctx.save();
        ctx.globalAlpha = Math.min(1, popIn * 1.3);

        // Hard 3D shadow + outer gold/mint rim + dark CRT inner face
        ctx.fillStyle = '#111111';
        ctx.fillRect(cardX + 6, cardY + 6, cardW, cardH);
        ctx.fillRect(cardX - 4, cardY - 4, cardW + 8, cardH + 8);
        ctx.fillStyle = celebration.beatTarget ? '#F5C342' : '#7FD1AE';
        ctx.fillRect(cardX, cardY, cardW, cardH);
        ctx.fillStyle = '#18171C';
        ctx.fillRect(cardX + 6, cardY + 6, cardW - 12, cardH - 12);

        ctx.textAlign = 'center';
        const centerX = canvas.width / 2;

        // Headline
        ctx.fillStyle = celebration.beatTarget ? '#FFE74C' : '#7FD1AE';
        ctx.font = '900 13px monospace';
        ctx.fillText(
          celebration.beatTarget
            ? celebration.isDare
              ? '★ FINISH! DARE GHOST BEATEN ★'
              : '★ NEW #1 RECORD! TOP GHOST BEATEN ★'
            : '★ FINISH LINE CROSSED! ★',
          centerX,
          cardY + 27
        );

        // Final Time & 1v1 Outcome
        const finalSecs = (celebration.timeMs / 1000).toFixed(2).padStart(5, '0');
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '900 20px monospace';
        ctx.fillText(
          celebration.targetTag
            ? celebration.beatTarget
              ? `${finalSecs}s  •  BEAT @${celebration.targetTag}!`
              : `${finalSecs}s  •  VS @${celebration.targetTag}`
            : `${finalSecs}s  •  SPRINT COMPLETE`,
          centerX,
          cardY + 54
        );

        // Target split summary
        if (celebration.targetTag && typeof celebration.deltaVsTargetMs === 'number') {
          const dSec = celebration.deltaVsTargetMs / 1000;
          const dText =
            dSec <= 0
              ? `${dSec.toFixed(2)}s FASTER THAN @${celebration.targetTag}!`
              : `+${dSec.toFixed(2)}s VS @${celebration.targetTag}`;
          ctx.fillStyle = dSec <= 0 ? '#7FD1AE' : '#FF8B7B';
          ctx.font = '900 11px monospace';
          ctx.fillText(dText, centerX, cardY + 75);
        }
        ctx.restore();
      }

      // 5b. Deliberate Coral Death Impact Frame & Arcade Wipeout Plaque (during pre-shutter death beat & shutter close)
      if (activeDeathFlashFrames > 0 && !isWon) {
        ctx.save();
        // Initial brief coral impact pulse (~200ms) that settles into an unobstructed perimeter frame
        const impactAlpha = activeDeathFlashFrames > 148 ? 0.28 : 0.12;
        ctx.fillStyle = `rgba(236, 101, 83, ${impactAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Crisp 8-bit coral top & bottom hazard frame bars
        ctx.fillStyle = '#111111';
        ctx.fillRect(0, 0, canvas.width, 8);
        ctx.fillRect(0, canvas.height - 8, canvas.width, 8);
        ctx.fillStyle = '#EC6553';
        ctx.fillRect(0, 0, canvas.width, 6);
        ctx.fillRect(0, canvas.height - 6, canvas.width, 6);

        // Compact Top-Center Arcade Wipeout Plaque (leaves center playfield clear to see death burst!)
        const cardW = 284;
        const cardH = 56;
        const cardX = Math.round((canvas.width - cardW) / 2);
        const cardY = 26;

        ctx.fillStyle = '#111111';
        ctx.fillRect(cardX + 5, cardY + 5, cardW, cardH);
        ctx.fillRect(cardX - 3, cardY - 3, cardW + 6, cardH + 6);
        ctx.fillStyle = '#EC6553';
        ctx.fillRect(cardX, cardY, cardW, cardH);
        ctx.fillStyle = '#18171C';
        ctx.fillRect(cardX + 5, cardY + 5, cardW - 10, cardH - 10);

        ctx.textAlign = 'center';
        const centerX = canvas.width / 2;
        ctx.fillStyle = '#FFE74C';
        ctx.font = '900 15px monospace';
        ctx.fillText('✕ WIPEOUT! ✕', centerX, cardY + 26);

        ctx.fillStyle = '#FFF8E7';
        ctx.font = '900 11px monospace';
        ctx.fillText('RESETTING TO STARTING LINE...', centerX, cardY + 43);
        ctx.restore();
      }

      // 6. Compact Deterministic Input Replay Indicator on CRT Canvas (Manual Post-Race Verification Only)
      if (st.isReplayingInputs && !isAttract) {
        ctx.fillStyle = '#111111';
        ctx.fillRect(12, 12, 198, 24);
        ctx.fillStyle = '#FFE74C';
        ctx.fillRect(14, 14, 194, 20);
        if (Math.floor(now / 320) % 2 === 0) {
          ctx.fillStyle = '#EC6553';
          ctx.fillRect(20, 20, 8, 8);
        }
        ctx.fillStyle = '#111111';
        ctx.font = '900 11px monospace';
        ctx.fillText('INPUT REPLAY • [R] EXIT', 33, 28);
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [liveStateRef]);

  return (
    <canvas
      ref={canvasRef}
      width={512}
      height={480}
      className="pointer-events-none absolute inset-0 w-full h-full z-20"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
