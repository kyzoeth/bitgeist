import type { GhostKeyframe } from './types';

export const NES_INPUT_RIGHT = 0x01;
export const NES_INPUT_LEFT = 0x02;
export const NES_INPUT_DOWN = 0x04;
export const NES_INPUT_UP = 0x08;
export const NES_INPUT_START = 0x10;
export const NES_INPUT_SELECT = 0x20;
export const NES_INPUT_B = 0x40;
export const NES_INPUT_A = 0x80;

export const NES_MASK_BUTTON_ENTRIES: ReadonlyArray<readonly [mask: number, button: string]> = [
  [NES_INPUT_RIGHT, 'right'],
  [NES_INPUT_LEFT, 'left'],
  [NES_INPUT_DOWN, 'down'],
  [NES_INPUT_UP, 'up'],
  [NES_INPUT_START, 'start'],
  [NES_INPUT_SELECT, 'select'],
  [NES_INPUT_A, 'a'],
  [NES_INPUT_B, 'b'],
];

const MAX_REPLAY_FRAMES = 36_000;
const MAX_RLE_SEGMENTS = 2_400;

interface RleInputSegment {
  mask: number;
  count: number;
}

/**
 * Records per-frame 8-bit NES joypad bitmasks at exact 60Hz race-frame resolution
 * and compresses consecutive identical frames via Run-Length Encoding (`maskHex:countBase36`).
 */
export class InputLogRecorder {
  private segments: RleInputSegment[] = [];
  private lastRecordedFrame = -1;

  reset(): void {
    this.segments = [];
    this.lastRecordedFrame = -1;
  }

  recordUpToFrame(targetFrame: number, mask: number): void {
    const clampedTarget = Math.min(MAX_REPLAY_FRAMES, Math.max(0, Math.round(targetFrame)));
    if (clampedTarget <= this.lastRecordedFrame) return;

    const deltaFrames = clampedTarget - this.lastRecordedFrame;
    const byteMask = mask & 0xff;
    const prev = this.segments[this.segments.length - 1];

    if (prev && prev.mask === byteMask) {
      prev.count += deltaFrames;
    } else if (this.segments.length < MAX_RLE_SEGMENTS) {
      this.segments.push({ mask: byteMask, count: deltaFrames });
    } else if (prev) {
      prev.count += deltaFrames;
    }

    this.lastRecordedFrame = clampedTarget;
  }

  serialize(): string {
    if (this.segments.length === 0) return '';
    return this.segments
      .map((seg) => `${seg.mask.toString(16)}:${seg.count.toString(36)}`)
      .join('.');
  }
}

function decodeRleInputLog(
  encoded: string
): { segments: RleInputSegment[]; totalFrames: number } | null {
  if (typeof encoded !== 'string') return null;
  const trimmed = encoded.trim();
  if (!trimmed || trimmed.length > 16_384) return null;
  if (!/^[0-9a-f]{1,2}:[0-9a-z]+(\.[0-9a-f]{1,2}:[0-9a-z]+)*$/i.test(trimmed)) {
    return null;
  }

  const rawParts = trimmed.split('.');
  if (rawParts.length > MAX_RLE_SEGMENTS) return null;

  const segments: RleInputSegment[] = [];
  let totalFrames = 0;

  for (const part of rawParts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx <= 0) return null;
    const mask = parseInt(part.slice(0, colonIdx), 16);
    const count = parseInt(part.slice(colonIdx + 1), 36);
    if (!Number.isFinite(mask) || !Number.isFinite(count) || mask < 0 || mask > 255 || count <= 0) {
      return null;
    }
    totalFrames += count;
    if (totalFrames > MAX_REPLAY_FRAMES + 600) return null;
    segments.push({ mask, count });
  }

  return { segments, totalFrames };
}

export function expandInputLogToFrameMasks(encoded: string): Uint8Array | null {
  const decoded = decodeRleInputLog(encoded);
  if (!decoded || decoded.totalFrames <= 0) return null;

  const out = new Uint8Array(decoded.totalFrames);
  let cursor = 0;
  for (const seg of decoded.segments) {
    out.fill(seg.mask, cursor, cursor + seg.count);
    cursor += seg.count;
  }
  return out;
}

export function computeFnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface IntegrityCheckResult {
  ok: boolean;
  hardReject: boolean;
  verified: boolean;
  inputDigest?: string;
  reason?: string;
}

/**
 * Two-tier Anti-Cheat Validator for POST /api/ghosts:
 * 1. Physics & Chronology Guard (Hard-rejects spoofed telemetry / speedhacks with HTTP 422).
 * 2. RLE Joypad Input-Log Verification (Validates frame duration, directional correlation,
 *    and computes a deterministic FNV-1a inputDigest to award `verified: true`).
 */
export function verifyGhostRunIntegrity(params: {
  romId: string;
  timeMs: number;
  frames: GhostKeyframe[];
  maxPxPerFrame?: number;
  inputLog?: string;
}): IntegrityCheckResult {
  const { romId, timeMs, frames } = params;
  const maxPxPerFrame = params.maxPxPerFrame ?? 6.5;

  if (frames.length < 2) {
    return {
      ok: false,
      hardReject: true,
      verified: false,
      reason: 'Insufficient telemetry keyframes',
    };
  }

  // 1. Monotonic frame timestamps & duration alignment
  let minX = frames[0][1];
  let maxX = frames[0][1];

  for (let i = 1; i < frames.length; i++) {
    const [prevF, prevX] = frames[i - 1];
    const [curF, curX] = frames[i];
    if (curF < prevF) {
      return {
        ok: false,
        hardReject: true,
        verified: false,
        reason: 'Non-monotonic keyframe timestamps',
      };
    }
    if (curX < minX) minX = curX;
    if (curX > maxX) maxX = curX;

    const df = Math.max(1, curF - prevF);
    const stepDx = Math.abs(curX - prevX);
    // Reject blatant single-step horizontal teleports (>320px within <=6 frames)
    if (df <= 6 && stepDx > 320) {
      return {
        ok: false,
        hardReject: true,
        verified: false,
        reason: 'Impossible single-step horizontal teleport detected',
      };
    }
  }

  const expectedFrames = (timeMs / 1000) * 60;
  const lastFrame = frames[frames.length - 1][0];
  const frameDriftAllowance = Math.max(28, expectedFrames * 0.2);

  if (Math.abs(lastFrame - expectedFrames) > frameDriftAllowance) {
    return {
      ok: false,
      hardReject: true,
      verified: false,
      reason: 'Finish time does not match recorded keyframe duration',
    };
  }

  const spanX = Math.max(0, maxX - minX);
  const avgPxPerFrame = spanX / Math.max(1, expectedFrames);
  if (avgPxPerFrame > maxPxPerFrame * 1.45) {
    return {
      ok: false,
      hardReject: true,
      verified: false,
      reason: `Average horizontal speed (${avgPxPerFrame.toFixed(2)} px/f) exceeds cartridge physics bound`,
    };
  }

  // 2. Optional RLE Input-Log Verification
  if (!params.inputLog) {
    return { ok: true, hardReject: false, verified: false };
  }

  const decoded = decodeRleInputLog(params.inputLog);
  if (!decoded) {
    return {
      ok: true,
      hardReject: false,
      verified: false,
      reason: 'Malformed RLE inputLog',
    };
  }

  const inputDriftAllowance = Math.max(28, expectedFrames * 0.2);
  if (Math.abs(decoded.totalFrames - expectedFrames) > inputDriftAllowance) {
    return {
      ok: true,
      hardReject: false,
      verified: false,
      reason: 'Input log frame count mismatch',
    };
  }

  let rightFrames = 0;
  let propulsionFrames = 0;
  let activeFrames = 0;
  const propulsionMask = NES_INPUT_RIGHT | NES_INPUT_UP | NES_INPUT_A | NES_INPUT_B;
  for (const seg of decoded.segments) {
    if ((seg.mask & NES_INPUT_RIGHT) !== 0) {
      rightFrames += seg.count;
    }
    if ((seg.mask & propulsionMask) !== 0) {
      propulsionFrames += seg.count;
    }
    if (seg.mask !== 0) {
      activeFrames += seg.count;
    }
  }

  const netForwardX = frames[frames.length - 1][1] - frames[0][1];
  const netClimbY = Math.abs(frames[frames.length - 1][2] - frames[0][2]);
  const rightRatio = rightFrames / Math.max(1, decoded.totalFrames);
  const propulsionRatio = propulsionFrames / Math.max(1, decoded.totalFrames);
  const isVerticalClimbCourse = netClimbY >= 120;

  const lacksDirectionalCorrelation =
    netForwardX >= 250 &&
    (isVerticalClimbCourse
      ? rightRatio < 0.05 || propulsionRatio < 0.18
      : rightRatio < 0.16 && propulsionRatio < 0.24);

  if (activeFrames < 15 || lacksDirectionalCorrelation) {
    return {
      ok: true,
      hardReject: false,
      verified: false,
      reason: 'Insufficient directional input correlation',
    };
  }

  const inputDigest = computeFnv1aHex(`${romId}|${Math.round(timeMs)}|${params.inputLog}`);
  return {
    ok: true,
    hardReject: false,
    verified: true,
    inputDigest,
  };
}
