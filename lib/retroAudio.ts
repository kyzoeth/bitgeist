const SFX_MUTE_STORAGE_KEY = 'bitgeist_sfx_muted';
const MUSIC_MUTE_STORAGE_KEY = 'bitgeist_music_muted';

let sharedAudioCtx: AudioContext | null = null;

export function getMusicMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(MUSIC_MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMusicMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MUSIC_MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

export function getSfxMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SFX_MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSfxMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SFX_MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

function getReadyAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (getSfxMuted()) return null;
  try {
    if (!sharedAudioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      sharedAudioCtx = new Ctx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume().catch(() => undefined);
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

function scheduleChipTone(
  ctx: AudioContext,
  opts: {
    freqHz: number;
    endFreqHz?: number;
    startOffsetSec: number;
    durationSec: number;
    type?: OscillatorType;
    peakGain?: number;
  }
) {
  const start = ctx.currentTime + opts.startOffsetSec;
  const stop = start + opts.durationSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = opts.type || 'square';
  osc.frequency.setValueAtTime(opts.freqHz, start);
  if (opts.endFreqHz && opts.endFreqHz !== opts.freqHz) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, opts.endFreqHz), stop);
  }

  const peak = opts.peakGain ?? 0.055;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, stop);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(stop + 0.005);
}

/** Crisp mechanical CRT channel-click blip when stepping through sprint levels */
export function playLevelStepSfx(direction: 1 | -1 = 1): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;
  const f1 = direction >= 0 ? 587.33 : 698.46;
  const f2 = direction >= 0 ? 783.99 : 523.25;
  scheduleChipTone(ctx, { freqHz: f1, startOffsetSec: 0, durationSec: 0.024, peakGain: 0.038 });
  scheduleChipTone(ctx, { freqHz: f2, startOffsetSec: 0.024, durationSec: 0.032, peakGain: 0.042 });
}

/** Crisp 2A03 starting-grid countdown pip for 3... 2... 1... */
export function playCountdownTickSfx(step: 3 | 2 | 1 = 3): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;
  const freqHz = step === 3 ? 392.0 : step === 2 ? 440.0 : 493.88; // G4 -> A4 -> B4 resolving into C5->G5 GO!
  scheduleChipTone(ctx, {
    freqHz,
    startOffsetSec: 0,
    durationSec: 0.095,
    peakGain: 0.055,
  });
}

/** Crisp 2-note 2A03 pulse chirp on 00.00s launch */
export function playRaceStartSfx(): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;
  scheduleChipTone(ctx, { freqHz: 523.25, startOffsetSec: 0, durationSec: 0.045, peakGain: 0.05 });
  scheduleChipTone(ctx, { freqHz: 783.99, startOffsetSec: 0.045, durationSec: 0.065, peakGain: 0.055 });
}

/** Triumphant golden arpeggio when overtaking the crowned Dare Target ghost */
export function playCrownOvertakeSfx(): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;
  const notes = [659.25, 830.61, 987.77, 1318.51]; // E5 -> G#5 -> B5 -> E6
  notes.forEach((hz, i) => {
    scheduleChipTone(ctx, {
      freqHz: hz,
      startOffsetSec: i * 0.038,
      durationSec: 0.06,
      peakGain: 0.06,
    });
  });
}

/** Quick descending 8-bit triangle rewind zip on 10ms death auto-respawn */
export function playDeathResetSfx(): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;
  scheduleChipTone(ctx, {
    freqHz: 440,
    endFreqHz: 146.83,
    startOffsetSec: 0,
    durationSec: 0.11,
    type: 'triangle',
    peakGain: 0.085,
  });
}

/** Quick room-transition split pip (ascending mint pip when ahead, softer two-tone pip when trailing) */
export function playSplitCheckpointSfx(ahead: boolean): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;
  if (ahead) {
    scheduleChipTone(ctx, { freqHz: 659.25, startOffsetSec: 0, durationSec: 0.03, peakGain: 0.04 });
    scheduleChipTone(ctx, { freqHz: 880.0, startOffsetSec: 0.03, durationSec: 0.042, peakGain: 0.044 });
  } else {
    scheduleChipTone(ctx, { freqHz: 440.0, startOffsetSec: 0, durationSec: 0.03, peakGain: 0.032 });
    scheduleChipTone(ctx, { freqHz: 392.0, startOffsetSec: 0.03, durationSec: 0.038, peakGain: 0.032 });
  }
}

/** Soft 8-bit triangle shutter/iris sweep on CRT run start & end transitions */
export function playScreenWipeSfx(direction: 'close' | 'open'): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;
  if (direction === 'close') {
    scheduleChipTone(ctx, {
      freqHz: 466.16,
      endFreqHz: 164.81,
      startOffsetSec: 0,
      durationSec: 0.25,
      type: 'triangle',
      peakGain: 0.032,
    });
  } else {
    scheduleChipTone(ctx, {
      freqHz: 196.0,
      endFreqHz: 587.33,
      startOffsetSec: 0,
      durationSec: 0.32,
      type: 'triangle',
      peakGain: 0.03,
    });
  }
}

/** 4-note 2A03 finish-flag victory fanfare */
export function playGoalFanfareSfx(beatTarget: boolean): void {
  const ctx = getReadyAudioContext();
  if (!ctx) return;
  const seq = beatTarget
    ? [
        { hz: 523.25, at: 0.0, dur: 0.07 },
        { hz: 659.25, at: 0.07, dur: 0.07 },
        { hz: 783.99, at: 0.14, dur: 0.07 },
        { hz: 1046.5, at: 0.21, dur: 0.11 },
        { hz: 1318.51, at: 0.32, dur: 0.18 },
      ]
    : [
        { hz: 523.25, at: 0.0, dur: 0.07 },
        { hz: 659.25, at: 0.07, dur: 0.07 },
        { hz: 783.99, at: 0.14, dur: 0.08 },
        { hz: 1046.5, at: 0.22, dur: 0.16 },
      ];

  for (const n of seq) {
    scheduleChipTone(ctx, {
      freqHz: n.hz,
      startOffsetSec: n.at,
      durationSec: n.dur,
      peakGain: 0.062,
    });
  }
}
