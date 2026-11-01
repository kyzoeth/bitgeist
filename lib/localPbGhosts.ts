import type { GhostRun } from './types';

const PB_GHOSTS_STORAGE_KEY = 'bitgeist_pb_ghosts_v1';
const MAX_STORED_PB_GHOSTS = 24;

interface StoredPbGhostMap {
  [sprintId: string]: GhostRun;
}

export function getLocalPbGhost(sprintId: string): GhostRun | null {
  if (typeof window === 'undefined' || !sprintId) return null;
  try {
    const raw = localStorage.getItem(PB_GHOSTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPbGhostMap;
    const entry = parsed?.[sprintId];
    if (
      !entry ||
      typeof entry.timeMs !== 'number' ||
      !Array.isArray(entry.frames) ||
      entry.frames.length < 2
    ) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function saveLocalPbGhostIfFaster(sprintId: string, candidate: GhostRun): GhostRun {
  if (typeof window === 'undefined' || !sprintId) return candidate;
  try {
    const raw = localStorage.getItem(PB_GHOSTS_STORAGE_KEY);
    const parsed: StoredPbGhostMap = raw ? (JSON.parse(raw) as StoredPbGhostMap) : {};
    const existing = parsed[sprintId];
    if (existing && typeof existing.timeMs === 'number' && existing.timeMs < candidate.timeMs) {
      return existing;
    }

    const boundedCandidate: GhostRun = {
      ...candidate,
      sprintId,
      frames: candidate.frames.slice(0, 450),
      color: '#4CC9F0',
    };
    parsed[sprintId] = boundedCandidate;

    const entries = Object.entries(parsed).sort((a, b) => {
      const ta = Date.parse(a[1]?.createdAt || '') || 0;
      const tb = Date.parse(b[1]?.createdAt || '') || 0;
      return tb - ta;
    });

    const trimmed: StoredPbGhostMap = {};
    for (const [k, v] of entries.slice(0, MAX_STORED_PB_GHOSTS)) {
      trimmed[k] = v;
    }
    localStorage.setItem(PB_GHOSTS_STORAGE_KEY, JSON.stringify(trimmed));
    return boundedCandidate;
  } catch {
    return candidate;
  }
}
