import type { Nostalgist } from 'nostalgist';
import type { ConsoleSystemId } from './types';

export interface SystemRamRegion {
  offset: number;
  size: number;
}

const EXPECTED_RAM_BYTES: Record<ConsoleSystemId, number> = {
  nes: 0x800, // 2KB CPU RAM
  snes: 0x20000, // 128KB WRAM ($7E0000-$7FFFFF)
  genesis: 0x10000, // 64KB 68000 Work RAM ($FF0000-$FFFFFF)
  gb: 0x2000, // 8KB DMG/CGB Base WRAM ($C000-$DFFF)
  gba: 0x8000, // 32KB Fast IWRAM ($03000000-$03007FFF)
};

async function unwrapStateBytes(blob: Blob): Promise<Uint8Array> {
  const raw = new Uint8Array(await blob.arrayBuffer());
  if (raw.length > 2 && typeof DecompressionStream !== 'undefined') {
    const isGzip = raw[0] === 0x1f && raw[1] === 0x8b;
    const isZlib =
      raw[0] === 0x78 &&
      (raw[1] === 0x01 || raw[1] === 0x5e || raw[1] === 0x9c || raw[1] === 0xda);

    if (isGzip || isZlib) {
      try {
        const ds = new DecompressionStream(isGzip ? 'gzip' : 'deflate');
        const stream = blob.stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch {
        return raw;
      }
    }
  }
  return raw;
}

function extractFceummRamFromSaveState(stateBytes: Uint8Array): Uint8Array | null {
  const limit = stateBytes.length - 2056;
  for (let i = 0; i <= limit; i++) {
    if (
      stateBytes[i] === 0x52 &&
      stateBytes[i + 1] === 0x41 &&
      stateBytes[i + 2] === 0x4d &&
      stateBytes[i + 3] === 0x00 &&
      stateBytes[i + 4] === 0x00 &&
      stateBytes[i + 5] === 0x08 &&
      stateBytes[i + 6] === 0x00 &&
      stateBytes[i + 7] === 0x00
    ) {
      return stateBytes.subarray(i + 8, i + 8 + 0x800);
    }
  }
  return null;
}

function extractMgbaIwramFromSaveState(stateBytes: Uint8Array): Uint8Array | null {
  // mGBA GBASerializedState (~528KB) stores 32KB GBA Fast IWRAM ($03000000-$03007FFF) at 0x19000..0x21000
  if (stateBytes.length >= 0x80000 && stateBytes.length <= 0x90000) {
    return stateBytes.subarray(0x19000, 0x21000);
  }
  return null;
}

async function pickLiveMutatingCandidate(
  nostalgist: Nostalgist,
  candidates: number[],
  targetSize: number
): Promise<number | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const mod = nostalgist.getEmscriptenModule() as unknown as { HEAPU8?: Uint8Array };
  const heap = mod?.HEAPU8;
  if (!heap) return candidates[0];

  const probeLen = Math.min(targetSize, 0x8000);
  const beforeSlices = candidates.map((ptr) => heap.slice(ptr, ptr + probeLen));
  await new Promise((r) => setTimeout(r, 55));

  const freshHeap = (nostalgist.getEmscriptenModule() as unknown as { HEAPU8?: Uint8Array }).HEAPU8;
  if (freshHeap) {
    for (let idx = 0; idx < candidates.length; idx++) {
      const ptr = candidates[idx];
      const prev = beforeSlices[idx];
      for (let b = 0; b < probeLen; b += 4) {
        if (freshHeap[ptr + b] !== prev[b]) {
          return ptr;
        }
      }
    }
  }
  return candidates[0];
}

function extractSnes9xWramFromSaveState(stateBytes: Uint8Array): Uint8Array | null {
  // snes9x labels 128KB Work RAM as ASCII "RAM:131072:" followed by 0x20000 raw WRAM bytes
  const tag = 'RAM:131072:';
  const limit = stateBytes.length - (tag.length + 0x20000);
  for (let i = 0; i <= limit; i++) {
    if (stateBytes[i] !== 0x52) continue;
    let ok = true;
    for (let k = 1; k < tag.length; k++) {
      if (stateBytes[i + k] !== tag.charCodeAt(k)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      return stateBytes.subarray(i + tag.length, i + tag.length + 0x20000);
    }
  }
  return null;
}

function matchSnapshotInHeap(
  heap: Uint8Array,
  snapshot: Uint8Array,
  targetSize: number
): number[] {
  const candidates: number[] = [];
  if (snapshot.length < targetSize || heap.length < targetSize) return candidates;

  // Pick a non-trivial 4-byte anchor inside the snapshot
  let anchorOffset = Math.min(0x1fc, targetSize - 8);
  for (let probe = 0x40; probe < Math.min(targetSize - 8, 0x1000); probe += 16) {
    const a = snapshot[probe];
    const b = snapshot[probe + 1];
    const c = snapshot[probe + 2];
    const d = snapshot[probe + 3];
    if ((a !== 0 || b !== 0 || c !== 0 || d !== 0) && !(a === b && b === c && c === d)) {
      anchorOffset = probe;
      break;
    }
  }

  const a0 = snapshot[anchorOffset];
  const a1 = snapshot[anchorOffset + 1];
  const a2 = snapshot[anchorOffset + 2];
  const a3 = snapshot[anchorOffset + 3];
  const maxPtr = heap.length - targetSize;
  const sampleStride = Math.max(31, Math.floor(targetSize / 64));

  for (let ptr = 0; ptr <= maxPtr; ptr += 4) {
    if (
      heap[ptr + anchorOffset] === a0 &&
      heap[ptr + anchorOffset + 1] === a1 &&
      heap[ptr + anchorOffset + 2] === a2 &&
      heap[ptr + anchorOffset + 3] === a3
    ) {
      let matches = 0;
      let checks = 0;
      for (let k = 0x20; k < targetSize; k += sampleStride) {
        checks++;
        if (heap[ptr + k] === snapshot[k]) matches++;
      }
      if (checks > 0 && matches >= Math.floor(checks * 0.88)) {
        candidates.push(ptr);
        if (candidates.length >= 8) break;
      }
    }
  }
  return candidates;
}

function locateGenericWramInHeapFromState(
  heap: Uint8Array,
  stateBytes: Uint8Array,
  expectedSize: number
): number | null {
  if (stateBytes.length < expectedSize || heap.length < expectedSize) return null;

  // Scan stateBytes in 2KB steps for a high-entropy RAM region that mirrors a live block in HEAPU8
  const step = 0x800;
  for (let off = 0; off + expectedSize <= stateBytes.length; off += step) {
    const windowSlice = stateBytes.subarray(off, off + expectedSize);
    let nonZero = 0;
    for (let i = 0; i < Math.min(0x400, expectedSize); i += 16) {
      if (windowSlice[i] !== 0 && windowSlice[i] !== 0xff) nonZero++;
    }
    if (nonZero < 4) continue;

    const hits = matchSnapshotInHeap(heap, windowSlice, expectedSize);
    if (hits.length > 0) {
      return hits[0];
    }
  }
  return null;
}

function isFceummStateChunkHeaderBefore(heap: Uint8Array, ptr: number): boolean {
  return (
    ptr >= 8 &&
    heap[ptr - 8] === 0x52 &&
    heap[ptr - 7] === 0x41 &&
    heap[ptr - 6] === 0x4d &&
    heap[ptr - 5] === 0x00 &&
    heap[ptr - 4] === 0x00 &&
    heap[ptr - 3] === 0x08 &&
    heap[ptr - 2] === 0x00 &&
    heap[ptr - 1] === 0x00
  );
}

/**
 * Pinpoints the exact byte offset of fceumm's 2KB NES CPU System RAM (`uint8 RAM[0x800]`)
 * inside `EmscriptenModule.HEAPU8`.
 * Never calls `_cmd_toggle_pause` (`nostalgist.pause()` / `nostalgist.resume()`) so RetroArch's
 * 60Hz Emscripten main loop cannot desynchronize from `nostalgist.getStatus()`.
 * Excludes serialized `"RAM\0"` savestate buffers and all-zero heap regions, prioritizes fceumm's
 * canonical static `RAM[0x800]` BSS offset (`0x29e030`), and disambiguates multiple candidates via
 * live frame mutation.
 */
const FCEUMM_CANONICAL_RAM_OFFSET = 0x29e030;

async function locateNesSystemRamOffset(nostalgist: Nostalgist): Promise<number | null> {
  try {
    const { state } = await nostalgist.saveState();

    const stateBytes = await unwrapStateBytes(state);
    const ramSnapshot = extractFceummRamFromSaveState(stateBytes);
    const heap = (nostalgist.getEmscriptenModule() as unknown as { HEAPU8?: Uint8Array })?.HEAPU8;

    if (!ramSnapshot || !heap || heap.length < 0x800) {
      return null;
    }

    const maxOffset = heap.length - 0x800;
    const scoredCandidates: Array<{ ptr: number; matchedNonZero: number; mismatches: number }> = [];

    // Collect non-zero byte positions in ramSnapshot so games that zero-fill $0100-$07FF on reset
    // cannot falsely match all-zero regions at the bottom of HEAPU8.
    const nonZeroIndices: number[] = [];
    for (let i = 0; i < 0x800; i++) {
      if (ramSnapshot[i] !== 0) {
        nonZeroIndices.push(i);
      }
    }

    const workBytes = 0x500 + 0x80; // 1,408 bytes ($0180-$01FF + $0300-$07FF)
    const maxWorkMismatches = Math.floor(workBytes * 0.08);
    const anchor180 = ramSnapshot[0x180];
    const anchor1ff = ramSnapshot[0x1ff];
    const anchor400 = ramSnapshot[0x400];

    const evaluateCandidate = (ptr: number) => {
      if (ptr < 0 || ptr > maxOffset || isFceummStateChunkHeaderBefore(heap, ptr)) {
        return;
      }
      let mismatches = 0;
      for (let k = 0x180; k < 0x200; k++) {
        if (heap[ptr + k] !== ramSnapshot[k] && ++mismatches > maxWorkMismatches) return;
      }
      for (let k = 0x300; k < 0x800; k++) {
        if (heap[ptr + k] !== ramSnapshot[k] && ++mismatches > maxWorkMismatches) return;
      }
      let matchedNonZero = 0;
      for (let idx = 0; idx < nonZeroIndices.length; idx++) {
        const off = nonZeroIndices[idx];
        if (heap[ptr + off] === ramSnapshot[off]) {
          matchedNonZero++;
        }
      }
      if (nonZeroIndices.length > 0 && matchedNonZero === 0) {
        return;
      }
      scoredCandidates.push({ ptr, matchedNonZero, mismatches });
    };

    evaluateCandidate(FCEUMM_CANONICAL_RAM_OFFSET);

    for (let ptr = 0; ptr <= maxOffset; ptr += 4) {
      if (
        ptr === FCEUMM_CANONICAL_RAM_OFFSET ||
        heap[ptr + 0x180] !== anchor180 ||
        heap[ptr + 0x1ff] !== anchor1ff ||
        heap[ptr + 0x400] !== anchor400
      ) {
        continue;
      }
      evaluateCandidate(ptr);
    }

    if (scoredCandidates.length === 0) {
      return FCEUMM_CANONICAL_RAM_OFFSET <= maxOffset ? FCEUMM_CANONICAL_RAM_OFFSET : null;
    }

    scoredCandidates.sort((a, b) => {
      if (b.matchedNonZero !== a.matchedNonZero) return b.matchedNonZero - a.matchedNonZero;
      if (a.mismatches !== b.mismatches) return a.mismatches - b.mismatches;
      if (a.ptr === FCEUMM_CANONICAL_RAM_OFFSET) return -1;
      if (b.ptr === FCEUMM_CANONICAL_RAM_OFFSET) return 1;
      return a.ptr - b.ptr;
    });

    const candidates = scoredCandidates.slice(0, 16).map((c) => c.ptr);
    if (candidates.length === 1) {
      return candidates[0];
    }

    // Disambiguate true live CPU RAM from static savestate/scratch buffers in HEAPU8 by observing
    // ~2.5 live frames (40ms) WITHOUT calling saveState(), pause(), or resume().
    const beforeSlices = candidates.map((ptr) => heap.slice(ptr, ptr + 0x300));
    await new Promise((r) => setTimeout(r, 40));

    const freshHeap = (nostalgist.getEmscriptenModule() as unknown as { HEAPU8?: Uint8Array })
      ?.HEAPU8;
    if (freshHeap) {
      let bestPtr: number | null = null;
      let bestDiffs = 0;
      for (let idx = 0; idx < candidates.length; idx++) {
        const ptr = candidates[idx];
        const prev = beforeSlices[idx];
        let diffs = 0;
        for (let b = 0; b < 0x300; b++) {
          if (freshHeap[ptr + b] !== prev[b]) {
            diffs++;
          }
        }
        if (diffs > bestDiffs) {
          bestDiffs = diffs;
          bestPtr = ptr;
        }
      }
      if (bestPtr !== null) {
        return bestPtr;
      }
    }

    return candidates[0];
  } catch (err) {
    console.warn('[Bitgeist] RAM offset locator warning:', err);
    return null;
  }
}

/**
 * Multi-Console Libretro Work-RAM Locator (`fceumm`, `snes9x`, `genesis_plus_gx`, `gambatte`, `mgba`).
 */
export async function locateSystemRamRegion(
  nostalgist: Nostalgist,
  consoleSystem: ConsoleSystemId
): Promise<SystemRamRegion | null> {
  if (consoleSystem === 'nes') {
    const offset = await locateNesSystemRamOffset(nostalgist);
    return offset !== null ? { offset, size: 0x800 } : null;
  }

  const expectedSize = EXPECTED_RAM_BYTES[consoleSystem] || 0x2000;
  try {
    const { state } = await nostalgist.saveState();

    const stateBytes = await unwrapStateBytes(state);
    const mod = nostalgist.getEmscriptenModule() as unknown as { HEAPU8?: Uint8Array };
    const heap = mod?.HEAPU8;
    if (!heap) return null;

    if (consoleSystem === 'gba') {
      const gbaSnap = extractMgbaIwramFromSaveState(stateBytes);
      if (gbaSnap) {
        const hits = matchSnapshotInHeap(heap, gbaSnap, 0x8000);
        const livePtr = await pickLiveMutatingCandidate(nostalgist, hits, 0x8000);
        if (livePtr !== null) {
          return { offset: livePtr, size: 0x8000 };
        }
      }
    }

    if (consoleSystem === 'snes') {
      const snesSnap = extractSnes9xWramFromSaveState(stateBytes);
      if (snesSnap) {
        const hits = matchSnapshotInHeap(heap, snesSnap, 0x20000);
        const livePtr = await pickLiveMutatingCandidate(nostalgist, hits, 0x20000);
        if (livePtr !== null) {
          return { offset: livePtr, size: 0x20000 };
        }
      }
    }

    const genericOffset = locateGenericWramInHeapFromState(heap, stateBytes, expectedSize);
    if (genericOffset !== null) {
      return { offset: genericOffset, size: expectedSize };
    }

    return null;
  } catch (err) {
    console.warn(`[Bitgeist] ${consoleSystem} WRAM locator warning:`, err);
    return null;
  }
}

export function getSystemRamView(
  nostalgist: Nostalgist,
  region: SystemRamRegion | null
): Uint8Array | null {
  if (!region) return null;
  try {
    const mod = nostalgist.getEmscriptenModule() as unknown as { HEAPU8?: Uint8Array };
    const heap = mod?.HEAPU8;
    if (!heap || region.offset < 0 || region.offset + region.size > heap.length) return null;
    return heap.subarray(region.offset, region.offset + region.size);
  } catch {
    return null;
  }
}

export function getNesRamView(nostalgist: Nostalgist, ramOffset: number): Uint8Array | null {
  return getSystemRamView(nostalgist, { offset: ramOffset, size: 0x800 });
}
