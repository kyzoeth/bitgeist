import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { getCourseByIndex, getDailySprintByNumber } from './dailySprints';
import { expandInputLogToFrameMasks } from './inputReplay';
import { CELESTE_ROM_ID } from './romProfiles';
import type { GhostKeyframe } from './types';

export interface HeadlessWasmVerifyParams {
  romId: string;
  sprintId: string;
  claimedTimeMs: number;
  inputLog: string;
  courseIndex?: number;
  dailyNumber?: number;
  goalWorldX?: number;
}

export interface HeadlessWasmVerifyResult {
  supported: boolean;
  ok: boolean;
  verified: boolean;
  simulatedTimeMs?: number;
  goalFrame?: number;
  frames?: GhostKeyframe[];
  elapsedCpuMs?: number;
  reason?: string;
}

interface WorkerJobPayload {
  coreJsPath: string;
  coreWasmPath: string;
  romPath: string;
  canonicalStatePath: string;
  gameKind: 'celeste' | 'nova';
  worldIndex?: number;
  stageIndex?: number;
  startWarp?: number;
  goalWorldX: number;
  goalWarps?: readonly number[];
  warpYMap?: Readonly<Record<number, number>>;
  frameMasks: Uint8Array;
}

interface WorkerRawResult {
  ok: boolean;
  reachedGoal: boolean;
  died: boolean;
  goalFrame?: number;
  simulatedTimeMs?: number;
  frames?: GhostKeyframe[];
  elapsedCpuMs?: number;
  reason?: string;
}

const JOB_TIMEOUT_MS = 5000;
const MAX_CLOCK_DRIFT_MS = 550;

let sharedWorker: Worker | null = null;
let jobSeq = 0;
const pendingJobs = new Map<
  number,
  {
    resolve: (res: WorkerRawResult) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let queueChain: Promise<unknown> = Promise.resolve();

function resolveCanonicalStatePath(courseIndex: number): string {
  const customDb = process.env.BITGEIST_DB_PATH?.trim();
  const primaryDir = path.join(
    customDb ? path.dirname(customDb) : path.join(process.cwd(), 'data'),
    'canonical-states'
  );
  const bundledDir = path.join(process.cwd(), 'data', 'canonical-states');

  const v2Primary = path.join(primaryDir, `celeste_v2_c${courseIndex}.state`);
  if (fs.existsSync(v2Primary)) return v2Primary;

  // Seed persistent volume from bundled pre-warmed state if available so production verifies in ~50ms
  for (const name of [`celeste_v2_c${courseIndex}.state`, `celeste_c${courseIndex}.state`]) {
    const candidate = path.join(bundledDir, name);
    if (fs.existsSync(candidate)) {
      try {
        fs.mkdirSync(primaryDir, { recursive: true });
        fs.copyFileSync(candidate, v2Primary);
        return v2Primary;
      } catch {
        return candidate;
      }
    }
  }

  return v2Primary;
}

function resetWorkerWithError(err: Error): void {
  const w = sharedWorker;
  sharedWorker = null;
  if (w) {
    try {
      void w.terminate();
    } catch {
      // ignore termination error
    }
  }
  for (const [id, entry] of pendingJobs.entries()) {
    clearTimeout(entry.timer);
    pendingJobs.delete(id);
    entry.reject(err);
  }
}

function getOrSpawnWorker(): Worker {
  if (sharedWorker) return sharedWorker;

  const workerPath = path.join(process.cwd(), 'lib', 'wasmReplayWorker.mjs');
  const w = new Worker(workerPath);

  w.on('message', (msg: { id?: number; result?: WorkerRawResult; error?: string }) => {
    if (typeof msg?.id !== 'number') return;
    const entry = pendingJobs.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingJobs.delete(msg.id);
    if (pendingJobs.size === 0) {
      w.unref();
    }
    if (msg.error) {
      entry.reject(new Error(msg.error));
    } else if (msg.result) {
      entry.resolve(msg.result);
    } else {
      entry.reject(new Error('Empty response from headless WASM replay worker'));
    }
  });

  w.on('error', (err) => {
    resetWorkerWithError(err instanceof Error ? err : new Error(String(err)));
  });

  w.on('exit', (code) => {
    if (sharedWorker === w) {
      resetWorkerWithError(new Error(`Headless WASM worker exited with code ${code}`));
    }
  });

  w.unref();
  sharedWorker = w;
  return w;
}

function enqueueWorkerJob(job: WorkerJobPayload): Promise<WorkerRawResult> {
  const run = () =>
    new Promise<WorkerRawResult>((resolve, reject) => {
      let worker: Worker;
      try {
        worker = getOrSpawnWorker();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }

      const id = ++jobSeq;
      const timer = setTimeout(() => {
        pendingJobs.delete(id);
        resetWorkerWithError(new Error(`Headless WASM verification timed out after ${JOB_TIMEOUT_MS}ms`));
      }, JOB_TIMEOUT_MS);

      pendingJobs.set(id, { resolve, reject, timer });
      worker.ref();
      worker.postMessage({ id, job });
    });

  const next = queueChain.then(run, run);
  queueChain = next.catch(() => undefined);
  return next;
}

function resolveCelesteCourseIndex(params: {
  sprintId: string;
  courseIndex?: number;
  dailyNumber?: number;
}): number {
  if (typeof params.courseIndex === 'number' && params.courseIndex >= 0 && params.courseIndex <= 5) {
    return params.courseIndex;
  }
  if (typeof params.dailyNumber === 'number' && params.dailyNumber >= 1) {
    return getDailySprintByNumber(params.dailyNumber).course.courseIndex;
  }
  const dailyMatch = /^daily-(\d+)$/.exec(params.sprintId);
  if (dailyMatch) {
    return getDailySprintByNumber(Number(dailyMatch[1])).course.courseIndex;
  }
  const courseMatch = /:c(\d+)$/.exec(params.sprintId);
  if (courseMatch) {
    return Number(courseMatch[1]);
  }
  return 0;
}

export function isHeadlessWasmSupportedRom(romId: string): boolean {
  if (romId === CELESTE_ROM_ID) {
    return fs.existsSync(path.join(process.cwd(), 'public', 'roms', 'celeste.nes'));
  }
  return false;
}

export async function verifyNesRunHeadless(
  params: HeadlessWasmVerifyParams
): Promise<HeadlessWasmVerifyResult> {
  const coreJsPath = path.join(process.cwd(), 'public', 'cores', 'fceumm_libretro.js');
  const coreWasmPath = path.join(process.cwd(), 'public', 'cores', 'fceumm_libretro.wasm');

  if (!fs.existsSync(coreJsPath) || !fs.existsSync(coreWasmPath)) {
    return {
      supported: false,
      ok: true,
      verified: false,
      reason: 'Headless fceumm core assets missing',
    };
  }

  if (!isHeadlessWasmSupportedRom(params.romId)) {
    return {
      supported: false,
      ok: true,
      verified: false,
    };
  }

  const trimmedLog = params.inputLog?.trim();
  if (!trimmedLog) {
    return {
      supported: true,
      ok: false,
      verified: false,
      reason: 'Deterministic inputLog is required for leaderboard verification',
    };
  }

  const frameMasks = expandInputLogToFrameMasks(trimmedLog);
  if (!frameMasks || frameMasks.length < 30) {
    return {
      supported: true,
      ok: false,
      verified: false,
      reason: 'Malformed or truncated inputLog',
    };
  }

  if (params.romId === CELESTE_ROM_ID) {
    const romPath = path.join(process.cwd(), 'public', 'roms', 'celeste.nes');
    const resolvedIdx = resolveCelesteCourseIndex(params);
    const course = getCourseByIndex(resolvedIdx);
    const canonicalStatePath = resolveCanonicalStatePath(course.courseIndex);

    try {
      const raw = await enqueueWorkerJob({
        coreJsPath,
        coreWasmPath,
        romPath,
        canonicalStatePath,
        gameKind: 'celeste',
        worldIndex: course.worldIndex,
        startWarp: course.startWarp ?? course.stageIndex,
        goalWorldX: course.goalWorldX,
        goalWarps: course.goalWarps ?? [],
        warpYMap: course.warpYMap ?? {},
        frameMasks,
      });

      if (!raw.ok || !raw.reachedGoal || !raw.simulatedTimeMs) {
        return {
          supported: true,
          ok: false,
          verified: false,
          elapsedCpuMs: raw.elapsedCpuMs,
          reason: raw.reason || 'Headless WASM replay failed to reach finish gate',
        };
      }

      if (Math.abs(raw.simulatedTimeMs - params.claimedTimeMs) > MAX_CLOCK_DRIFT_MS) {
        return {
          supported: true,
          ok: false,
          verified: false,
          simulatedTimeMs: raw.simulatedTimeMs,
          goalFrame: raw.goalFrame,
          elapsedCpuMs: raw.elapsedCpuMs,
          reason: `Claimed time (${params.claimedTimeMs}ms) diverges from deterministic WASM simulation (${raw.simulatedTimeMs}ms)`,
        };
      }

      return {
        supported: true,
        ok: true,
        verified: true,
        simulatedTimeMs: raw.simulatedTimeMs,
        goalFrame: raw.goalFrame,
        frames: raw.frames,
        elapsedCpuMs: raw.elapsedCpuMs,
      };
    } catch (err) {
      return {
        supported: true,
        ok: false,
        verified: false,
        reason: err instanceof Error ? err.message : 'Headless WASM verifier error',
      };
    }
  }

  return {
    supported: false,
    ok: true,
    verified: false,
  };
}

export async function shutdownHeadlessVerifierForTests(): Promise<void> {
  const w = sharedWorker;
  sharedWorker = null;
  if (w) {
    await w.terminate();
  }
}
