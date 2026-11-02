import { NES_INPUT_LEFT, NES_INPUT_RIGHT } from './inputReplay';

export interface CausalRamScannerState {
  prevRam: Uint8Array | null;
  xScores: Float32Array;
  scrollScores: Float32Array;
  discoveredPlayerXAddr: number;
  discoveredScrollAddr: number;
  playerXConfidence: number;
  scrollConfidence: number;
  samplesObserved: number;
}

export interface DiscoveredRamTelemetry {
  playerXAddr: number;
  scrollAddr: number;
  playerXConfidence: number;
  scrollConfidence: number;
  hardwareScrollDelta: number | null;
}

const SCAN_SIZE = 0x800; // 2048 bytes of NES internal RAM

export function createCausalRamScannerState(): CausalRamScannerState {
  return {
    prevRam: null,
    xScores: new Float32Array(SCAN_SIZE),
    scrollScores: new Float32Array(SCAN_SIZE),
    discoveredPlayerXAddr: -1,
    discoveredScrollAddr: -1,
    playerXConfidence: 0,
    scrollConfidence: 0,
    samplesObserved: 0,
  };
}

function isInsideOamShadowPage(addr: number, activeOamPage: number): boolean {
  return addr >= activeOamPage && addr < activeOamPage + 0x100;
}

function isInsideStackPage(addr: number): boolean {
  return addr >= 0x0100 && addr < 0x0200;
}

/**
 * Stage 16: Online Causal RAM-Entropy Auto-Discovery ("Zero-Shot Memory Scanner").
 * Evaluates per-byte first derivatives dRAM[addr]/dt against causal joypad inputs
 * (LEFT/RIGHT) and OAM player sprite kinematics to self-discover the game's true
 * Player X and Camera Scroll X registers in 6502 Work RAM without a hardcoded map.
 */
export function scanCausalRamRegisters(
  ram: Uint8Array,
  state: CausalRamScannerState,
  liveInputMask: number,
  activeOamPage: number,
  oamScreenX: number,
  oamRawDx: number
): DiscoveredRamTelemetry {
  const len = Math.min(ram.length, SCAN_SIZE);
  if (len < 0x100) {
    return {
      playerXAddr: -1,
      scrollAddr: -1,
      playerXConfidence: 0,
      scrollConfidence: 0,
      hardwareScrollDelta: null,
    };
  }

  if (!state.prevRam || state.prevRam.length !== len) {
    state.prevRam = new Uint8Array(len);
    state.prevRam.set(ram.subarray(0, len));
    return {
      playerXAddr: state.discoveredPlayerXAddr,
      scrollAddr: state.discoveredScrollAddr,
      playerXConfidence: state.playerXConfidence,
      scrollConfidence: state.scrollConfidence,
      hardwareScrollDelta: null,
    };
  }

  const prev = state.prevRam;
  const holdingRight = (liveInputMask & NES_INPUT_RIGHT) !== 0;
  const holdingLeft = (liveInputMask & NES_INPUT_LEFT) !== 0;
  const dirSign = holdingRight && !holdingLeft ? 1 : holdingLeft && !holdingRight ? -1 : 0;

  let hardwareScrollDelta: number | null = null;
  if (state.discoveredScrollAddr >= 0 && state.scrollConfidence >= 6) {
    const rawScrollDiff = (ram[state.discoveredScrollAddr] - prev[state.discoveredScrollAddr]) & 0xff;
    const signedDiff = rawScrollDiff > 128 ? rawScrollDiff - 256 : rawScrollDiff;
    if (Math.abs(signedDiff) <= 12) {
      hardwareScrollDelta = signedDiff;
    } else {
      // Wild jump -> decay confidence on discovered scroll register
      state.scrollConfidence = Math.max(0, state.scrollConfidence - 2);
    }
  }

  // Only update causal scores when there is active directional input or sprite motion
  if (dirSign !== 0 || oamRawDx !== 0) {
    state.samplesObserved++;
    let bestXAddr = state.discoveredPlayerXAddr;
    let bestXScore = bestXAddr >= 0 ? state.xScores[bestXAddr] : 0;
    let bestScrollAddr = state.discoveredScrollAddr;
    let bestScrollScore = bestScrollAddr >= 0 ? state.scrollScores[bestScrollAddr] : 0;

    for (let addr = 0; addr < len; addr++) {
      if (isInsideStackPage(addr) || isInsideOamShadowPage(addr, activeOamPage)) {
        continue;
      }

      const curVal = ram[addr];
      const prevVal = prev[addr];
      const rawDiff = (curVal - prevVal) & 0xff;
      const dVal = rawDiff > 128 ? rawDiff - 256 : rawDiff;

      // 1. Player Screen-X / World-X Low-Byte Candidate Scoring
      if (oamRawDx !== 0 && dVal === oamRawDx && Math.abs(curVal - oamScreenX) <= 16) {
        const nextScore = state.xScores[addr] * 0.92 + 1.5;
        state.xScores[addr] = nextScore;
        if (nextScore > bestXScore) {
          bestXScore = nextScore;
          bestXAddr = addr;
        }
      } else if (Math.abs(dVal) > 12 || (dirSign === 0 && dVal !== 0 && oamRawDx === 0)) {
        state.xScores[addr] *= 0.65;
      } else {
        state.xScores[addr] *= 0.96;
      }

      // 2. Monotonic Camera Scroll Register Candidate Scoring
      // When holding Right in the scroll zone (oamScreenX >= 88) and screen X is pinned or slow
      if (
        dirSign > 0 &&
        oamScreenX >= 88 &&
        Math.abs(oamRawDx) <= 2 &&
        dVal >= 1 &&
        dVal <= 6 &&
        addr !== bestXAddr
      ) {
        const zpBonus = addr < 0x0100 ? 1.25 : 1.0;
        const nextScroll = state.scrollScores[addr] * 0.92 + 1.4 * zpBonus;
        state.scrollScores[addr] = nextScroll;
        if (nextScroll > bestScrollScore) {
          bestScrollScore = nextScroll;
          bestScrollAddr = addr;
        }
      } else if (Math.abs(dVal) > 12 || (dirSign === 0 && oamRawDx === 0 && dVal !== 0)) {
        state.scrollScores[addr] *= 0.6;
      } else {
        state.scrollScores[addr] *= 0.96;
      }
    }

    state.discoveredPlayerXAddr = bestXScore >= 4.0 ? bestXAddr : -1;
    state.playerXConfidence = Math.min(20, Math.round(bestXScore));
    state.discoveredScrollAddr = bestScrollScore >= 5.0 ? bestScrollAddr : -1;
    state.scrollConfidence = Math.min(20, Math.round(bestScrollScore));

    if (
      hardwareScrollDelta === null &&
      state.discoveredScrollAddr >= 0 &&
      state.scrollConfidence >= 6
    ) {
      const rawScrollDiff =
        (ram[state.discoveredScrollAddr] - prev[state.discoveredScrollAddr]) & 0xff;
      const signedDiff = rawScrollDiff > 128 ? rawScrollDiff - 256 : rawScrollDiff;
      if (Math.abs(signedDiff) <= 12) {
        hardwareScrollDelta = signedDiff;
      }
    }
  }

  prev.set(ram.subarray(0, len));

  return {
    playerXAddr: state.discoveredPlayerXAddr,
    scrollAddr: state.discoveredScrollAddr,
    playerXConfidence: state.playerXConfidence,
    scrollConfidence: state.scrollConfidence,
    hardwareScrollDelta,
  };
}
