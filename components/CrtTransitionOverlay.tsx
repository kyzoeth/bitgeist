'use client';

import React, { useEffect, useImperativeHandle, useRef } from 'react';

export interface CrtTransitionHandle {
  isCurtainClosed: () => boolean;
  clear: () => void;
  setCurtainClosed: (closed: boolean) => void;
  playShutterClose: (opts?: { accentColor?: string; durationMs?: number }) => Promise<void>;
  playIrisOpen: (opts?: {
    focusX?: number;
    focusY?: number;
    accentColor?: string;
    durationMs?: number;
  }) => void;
  playGoLaunchBurst: (opts?: { durationMs?: number }) => void;
  playFinishSequence: (opts?: {
    focusX?: number;
    focusY?: number;
    beatTarget?: boolean;
    closeCurtainAtEnd?: boolean;
    totalMs?: number;
    closeDurationMs?: number;
    onCloseStart?: () => void;
  }) => void;
}

const NES_W = 256;
const NES_H = 240;
const CURTAIN_HEX = '#14131A';
const PIXEL_STEP = 4;

type ActiveAnim =
  | {
      kind: 'shutter-close';
      startedAtMs: number;
      durationMs: number;
      accentColor: string;
    }
  | {
      kind: 'iris-open';
      startedAtMs: number;
      durationMs: number;
      focusX: number;
      focusY: number;
      accentColor: string;
    }
  | {
      kind: 'go-burst';
      startedAtMs: number;
      durationMs: number;
    }
  | {
      kind: 'finish-seq';
      startedAtMs: number;
      totalMs: number;
      closeDurationMs: number;
      closeCurtainAtEnd: boolean;
      focusX: number;
      focusY: number;
      beatTarget: boolean;
      closeFired: boolean;
      onCloseStart?: () => void;
    };

function clampFocusX(x?: number): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) return 128;
  return Math.max(20, Math.min(NES_W - 20, Math.round(x)));
}

function clampFocusY(y?: number): number {
  if (typeof y !== 'number' || !Number.isFinite(y)) return 148;
  return Math.max(20, Math.min(NES_H - 20, Math.round(y)));
}

function maxCornerRadius(fx: number, fy: number): number {
  const dx = Math.max(fx, NES_W - fx);
  const dy = Math.max(fy, NES_H - fy);
  return Math.ceil(Math.hypot(dx, dy)) + 8;
}

/**
 * Draws an 8-bit 4px-stepped circular spotlight cutout in `#14131A` centered at `(fx, fy)`
 * with a crisp pixelated accent ring along the iris boundary.
 */
function drawSteppedPixelIrisMask(
  ctx: CanvasRenderingContext2D,
  fx: number,
  fy: number,
  radius: number,
  accentColor: string
) {
  if (radius <= 2) {
    ctx.fillStyle = CURTAIN_HEX;
    ctx.fillRect(0, 0, NES_W, NES_H);
    return;
  }

  const rSq = radius * radius;
  const innerR = Math.max(0, radius - PIXEL_STEP);
  const innerRSq = innerR * innerR;

  for (let y = 0; y < NES_H; y += PIXEL_STEP) {
    const cy = y + PIXEL_STEP * 0.5;
    const dy = cy - fy;
    const dySq = dy * dy;

    if (dySq >= rSq) {
      ctx.fillStyle = CURTAIN_HEX;
      ctx.fillRect(0, y, NES_W, PIXEL_STEP);
      continue;
    }

    const halfOuter = Math.floor(Math.sqrt(rSq - dySq) / PIXEL_STEP) * PIXEL_STEP;
    const leftOuter = Math.max(0, Math.floor(fx / PIXEL_STEP) * PIXEL_STEP - halfOuter);
    const rightOuter = Math.min(NES_W, Math.floor(fx / PIXEL_STEP) * PIXEL_STEP + halfOuter);

    ctx.fillStyle = CURTAIN_HEX;
    if (leftOuter > 0) {
      ctx.fillRect(0, y, leftOuter, PIXEL_STEP);
    }
    if (rightOuter < NES_W) {
      ctx.fillRect(rightOuter, y, NES_W - rightOuter, PIXEL_STEP);
    }

    // Crisp 4px stepped pixel ring inside the iris edge
    ctx.fillStyle = accentColor;
    if (dySq >= innerRSq) {
      if (rightOuter > leftOuter) {
        ctx.fillRect(leftOuter, y, rightOuter - leftOuter, PIXEL_STEP);
      }
    } else {
      const halfInner = Math.floor(Math.sqrt(innerRSq - dySq) / PIXEL_STEP) * PIXEL_STEP;
      const leftInner = Math.max(leftOuter, Math.floor(fx / PIXEL_STEP) * PIXEL_STEP - halfInner);
      const rightInner = Math.min(rightOuter, Math.floor(fx / PIXEL_STEP) * PIXEL_STEP + halfInner);
      if (leftInner > leftOuter) {
        ctx.fillRect(leftOuter, y, leftInner - leftOuter, PIXEL_STEP);
      }
      if (rightOuter > rightInner) {
        ctx.fillRect(rightInner, y, rightOuter - rightInner, PIXEL_STEP);
      }
    }
  }
}

function easeInOutCubic(x: number): number {
  const c = Math.max(0, Math.min(1, x));
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

/**
 * Draws an 8x8 NES-tile diagonal diamond shutter wipe across the 32x30 tile grid.
 */
function drawDiagonalTileShutter(
  ctx: CanvasRenderingContext2D,
  progress: number,
  accentColor: string
) {
  if (progress >= 1) {
    ctx.fillStyle = CURTAIN_HEX;
    ctx.fillRect(0, 0, NES_W, NES_H);
    return;
  }

  const eased = easeInOutCubic(progress);
  const cols = 32; // 32 * 8 = 256
  const rows = 30; // 30 * 8 = 240
  const maxWave = cols - 1 + (rows - 1) * 0.85;

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const wave = (tx + ty * 0.85) / maxWave;
      const local = Math.max(0, Math.min(1, eased * 1.9 - wave * 0.9));
      if (local <= 0.04) continue;

      const stepSize = Math.min(8, Math.max(2, Math.round(local * 4) * 2));
      const pad = (8 - stepSize) >> 1;
      const px = tx * 8 + pad;
      const py = ty * 8 + pad;

      ctx.fillStyle = stepSize < 8 ? accentColor : CURTAIN_HEX;
      ctx.fillRect(px, py, stepSize, stepSize);
    }
  }
}

export interface CrtTransitionOverlayProps {
  transitionRef: React.Ref<CrtTransitionHandle>;
}

export default function CrtTransitionOverlay({ transitionRef }: CrtTransitionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<ActiveAnim | null>(null);
  const curtainClosedRef = useRef<boolean>(false);
  const rafRef = useRef<number>(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeResolverRef = useRef<(() => void) | null>(null);

  const flushPendingClosePromise = () => {
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (closeResolverRef.current) {
      const resolve = closeResolverRef.current;
      closeResolverRef.current = null;
      resolve();
    }
  };

  const stopLoop = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  const paintStaticState = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, NES_W, NES_H);
    if (curtainClosedRef.current) {
      ctx.fillStyle = CURTAIN_HEX;
      ctx.fillRect(0, 0, NES_W, NES_H);
    }
  };

  const ensureLoopRunning = () => {
    if (rafRef.current) return;

    const tick = (now: number) => {
      rafRef.current = 0;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const anim = animRef.current;

      if (!canvas || !ctx || !anim) {
        paintStaticState();
        return;
      }

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, NES_W, NES_H);

      if (anim.kind === 'shutter-close') {
        const t = Math.max(0, Math.min(1, (now - anim.startedAtMs) / Math.max(1, anim.durationMs)));
        drawDiagonalTileShutter(ctx, t, anim.accentColor);
        if (t >= 1) {
          curtainClosedRef.current = true;
          animRef.current = null;
          paintStaticState();
          flushPendingClosePromise();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (anim.kind === 'iris-open') {
        const t = Math.max(0, Math.min(1, (now - anim.startedAtMs) / Math.max(1, anim.durationMs)));
        const maxR = maxCornerRadius(anim.focusX, anim.focusY);
        // Two-stage retro spotlight: open onto runner (0..14%), hold circular spotlight frame around runner (14..38%), then sweep outward (38..100%)
        const radius =
          t < 0.14
            ? 6 + easeInOutCubic(t / 0.14) * 26
            : t < 0.38
              ? 32 + ((t - 0.14) / 0.24) * 4
              : 36 + easeInOutCubic((t - 0.38) / 0.62) * (maxR - 36);
        drawSteppedPixelIrisMask(ctx, anim.focusX, anim.focusY, radius, anim.accentColor);

        if (t >= 1) {
          curtainClosedRef.current = false;
          animRef.current = null;
          ctx.clearRect(0, 0, NES_W, NES_H);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (anim.kind === 'go-burst') {
        const t = Math.max(0, Math.min(1, (now - anim.startedAtMs) / Math.max(1, anim.durationMs)));
        const eased = 1 - Math.pow(1 - t, 3);
        const flashAlpha = 0.24 * Math.pow(1 - t, 2);

        if (flashAlpha > 0.01) {
          ctx.fillStyle = `rgba(127, 209, 174, ${flashAlpha.toFixed(3)})`;
          ctx.fillRect(0, 0, NES_W, NES_H);
        }

        // Expanding 8-bit launch corner brackets rushing outward to bezel
        const inset = Math.round(((1 - eased) * 24) / 2) * 2;
        const arm = 18;
        const thick = 3;
        ctx.globalAlpha = Math.max(0, 1 - t * 1.02);
        ctx.fillStyle = t < 0.45 ? '#FFE74C' : '#7FD1AE';

        // Top-left
        ctx.fillRect(inset, inset, arm, thick);
        ctx.fillRect(inset, inset, thick, arm);
        // Top-right
        ctx.fillRect(NES_W - inset - arm, inset, arm, thick);
        ctx.fillRect(NES_W - inset - thick, inset, thick, arm);
        // Bottom-left
        ctx.fillRect(inset, NES_H - inset - thick, arm, thick);
        ctx.fillRect(inset, NES_H - inset - arm, thick, arm);
        // Bottom-right
        ctx.fillRect(NES_W - inset - arm, NES_H - inset - thick, arm, thick);
        ctx.fillRect(NES_W - inset - thick, NES_H - inset - arm, thick, arm);
        ctx.globalAlpha = 1;

        if (t >= 1) {
          animRef.current = null;
          ctx.clearRect(0, 0, NES_W, NES_H);
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (anim.kind === 'finish-seq') {
        const elapsed = Math.max(0, now - anim.startedAtMs);
        const accent = anim.beatTarget ? '#FFE74C' : '#7FD1AE';

        // 1. Finish-Tape Impact Flash (0..480ms)
        if (elapsed < 480) {
          const ft = elapsed / 480;
          const alpha = 0.46 * Math.pow(1 - ft, 2);
          ctx.fillStyle = anim.beatTarget
            ? `rgba(255, 231, 76, ${alpha.toFixed(3)})`
            : `rgba(127, 209, 174, ${alpha.toFixed(3)})`;
          ctx.fillRect(0, 0, NES_W, NES_H);
        }

        // 2. Arcade Cinema Letterbox Bars + Checkered Trim (eases in smoothly over 0..520ms)
        const barEase = 1 - Math.pow(1 - Math.min(1, elapsed / 520), 3);
        const barH = Math.round(barEase * 16);
        if (barH > 0) {
          ctx.fillStyle = CURTAIN_HEX;
          ctx.fillRect(0, 0, NES_W, barH);
          ctx.fillRect(0, NES_H - barH, NES_W, barH);

          if (barH >= 4) {
            const scroll = Math.floor(elapsed / 120) % 2;
            for (let x = 0; x < NES_W; x += 8) {
              const even = ((x >> 3) + scroll) % 2 === 0;
              ctx.fillStyle = even ? accent : '#2B2A33';
              ctx.fillRect(x, barH - 2, 8, 2);
              ctx.fillRect(x, NES_H - barH, 8, 2);
            }
          }
        }

        // 3. End-of-Run Stepped Pixel Iris-Out onto Winning Runner (pauses on spotlight around winner before closing)
        const closeStart = Math.max(540, anim.totalMs - anim.closeDurationMs);
        if (anim.closeCurtainAtEnd && elapsed >= closeStart) {
          if (!anim.closeFired) {
            anim.closeFired = true;
            anim.onCloseStart?.();
          }
          const ct = Math.max(
            0,
            Math.min(1, (elapsed - closeStart) / Math.max(1, anim.closeDurationMs))
          );
          const maxR = maxCornerRadius(anim.focusX, anim.focusY);
          const radius =
            ct < 0.58
              ? maxR - easeInOutCubic(ct / 0.58) * (maxR - 32)
              : ct < 0.76
                ? 32 - ((ct - 0.58) / 0.18) * 4
                : 28 * (1 - easeInOutCubic((ct - 0.76) / 0.24));
          drawSteppedPixelIrisMask(ctx, anim.focusX, anim.focusY, radius, accent);
        }

        if (elapsed >= anim.totalMs) {
          curtainClosedRef.current = anim.closeCurtainAtEnd;
          animRef.current = null;
          paintStaticState();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  };

  useImperativeHandle(transitionRef, () => ({
    isCurtainClosed: () => curtainClosedRef.current,
    clear: () => {
      flushPendingClosePromise();
      stopLoop();
      animRef.current = null;
      curtainClosedRef.current = false;
      paintStaticState();
    },
    setCurtainClosed: (closed: boolean) => {
      flushPendingClosePromise();
      stopLoop();
      animRef.current = null;
      curtainClosedRef.current = closed;
      paintStaticState();
    },
    playShutterClose: (opts) => {
      flushPendingClosePromise();
      if (curtainClosedRef.current) {
        paintStaticState();
        return Promise.resolve();
      }
      const durationMs = opts?.durationMs ?? 920;
      animRef.current = {
        kind: 'shutter-close',
        startedAtMs: performance.now(),
        durationMs,
        accentColor: opts?.accentColor || '#F5C342',
      };
      ensureLoopRunning();
      return new Promise<void>((resolve) => {
        closeResolverRef.current = resolve;
        // Fallback timer ensures await never hangs even if tab is backgrounded
        closeTimerRef.current = setTimeout(() => {
          closeTimerRef.current = null;
          curtainClosedRef.current = true;
          if (animRef.current?.kind === 'shutter-close') {
            animRef.current = null;
            stopLoop();
            paintStaticState();
          }
          if (closeResolverRef.current) {
            const r = closeResolverRef.current;
            closeResolverRef.current = null;
            r();
          }
        }, durationMs + 36);
      });
    },
    playIrisOpen: (opts) => {
      flushPendingClosePromise();
      curtainClosedRef.current = false;
      animRef.current = {
        kind: 'iris-open',
        startedAtMs: performance.now(),
        durationMs: opts?.durationMs ?? 1350,
        focusX: clampFocusX(opts?.focusX),
        focusY: clampFocusY(opts?.focusY),
        accentColor: opts?.accentColor || '#F5C342',
      };
      ensureLoopRunning();
    },
    playGoLaunchBurst: (opts) => {
      flushPendingClosePromise();
      curtainClosedRef.current = false;
      animRef.current = {
        kind: 'go-burst',
        startedAtMs: performance.now(),
        durationMs: opts?.durationMs ?? 720,
      };
      ensureLoopRunning();
    },
    playFinishSequence: (opts) => {
      flushPendingClosePromise();
      curtainClosedRef.current = false;
      animRef.current = {
        kind: 'finish-seq',
        startedAtMs: performance.now(),
        totalMs: opts?.totalMs ?? 3100,
        closeDurationMs: opts?.closeDurationMs ?? 1450,
        closeCurtainAtEnd: opts?.closeCurtainAtEnd ?? true,
        focusX: clampFocusX(opts?.focusX),
        focusY: clampFocusY(opts?.focusY),
        beatTarget: opts?.beatTarget ?? true,
        closeFired: false,
        onCloseStart: opts?.onCloseStart,
      };
      ensureLoopRunning();
    },
  }));

  useEffect(() => {
    return () => {
      flushPendingClosePromise();
      stopLoop();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={NES_W}
      height={NES_H}
      aria-hidden="true"
      data-testid="crt-transition-canvas"
      className="pointer-events-none select-none absolute inset-0 w-full h-full z-[22]"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
