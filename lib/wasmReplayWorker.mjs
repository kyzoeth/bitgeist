import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

// ============================================================================
// Minimal Deterministic Browser DOM / rAF Shim for Headless Emscripten RetroArch
// ============================================================================
let virtualNowMs = 1000;
let pendingRafCb = null;
let rafSeq = 1;

const realPerfNow = performance.now.bind(performance);
Object.defineProperty(performance, 'now', {
  configurable: true,
  value: () => virtualNowMs,
});

function createEventTargetMock() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, fn) {
      const list = listeners.get(type) || [];
      list.push(fn);
      listeners.set(type, list);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const list = listeners.get(evt.type);
      if (!list) return true;
      for (const fn of [...list]) {
        fn(evt);
      }
      return !evt.defaultPrevented;
    },
  };
}

const docTarget = createEventTargetMock();
const winTarget = createEventTargetMock();
const canvasTarget = createEventTargetMock();

function createStyleMock() {
  return {
    setProperty(prop, val) {
      this[prop] = val;
    },
    removeProperty(prop) {
      delete this[prop];
    },
    getPropertyValue(prop) {
      return this[prop] ?? '';
    },
  };
}

const mockCanvas = {
  ...canvasTarget,
  id: 'canvas',
  width: 256,
  height: 240,
  clientWidth: 256,
  clientHeight: 240,
  style: createStyleMock(),
  tabIndex: 0,
  focus() {},
  getAttribute(name) {
    if (name === 'width') return '256';
    if (name === 'height') return '240';
    return null;
  },
  setAttribute() {},
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 256, height: 240, right: 256, bottom: 240 };
  },
  getContext() {
    return null;
  },
};

globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

globalThis.requestAnimationFrame = (cb) => {
  pendingRafCb = cb;
  return ++rafSeq;
};

globalThis.cancelAnimationFrame = () => {
  pendingRafCb = null;
};

globalThis.document = {
  ...docTarget,
  hidden: false,
  visibilityState: 'visible',
  fullscreenElement: null,
  pointerLockElement: null,
  activeElement: mockCanvas,
  body: { appendChild() {}, removeChild() {}, clientWidth: 256, clientHeight: 240 },
  documentElement: { clientWidth: 256, clientHeight: 240 },
  getElementById(id) {
    return id === 'canvas' ? mockCanvas : null;
  },
  querySelector(sel) {
    if (sel === '#canvas' || sel === 'canvas' || sel === 'Module.canvas') return mockCanvas;
    return null;
  },
  createElement(tag) {
    if (tag === 'canvas') return mockCanvas;
    return { style: createStyleMock(), setAttribute() {}, getAttribute() { return null; } };
  },
};

globalThis.window = {
  ...winTarget,
  document: globalThis.document,
  innerWidth: 256,
  innerHeight: 240,
  devicePixelRatio: 1,
  resizeTo() {},
  requestAnimationFrame: globalThis.requestAnimationFrame,
  cancelAnimationFrame: globalThis.cancelAnimationFrame,
  getComputedStyle() {
    return {
      display: 'block',
      getPropertyValue(prop) {
        if (prop === 'display') return 'block';
        return '256px';
      },
      width: '256px',
      height: '240px',
    };
  },
  matchMedia() {
    return { matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} };
  },
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

if (!globalThis.navigator) {
  globalThis.navigator = { userAgent: 'BitgeistHeadlessVerifier/1.0', getGamepads: () => [] };
} else if (!globalThis.navigator.getGamepads) {
  try {
    Object.defineProperty(globalThis.navigator, 'getGamepads', {
      configurable: true,
      value: () => [],
    });
  } catch {
    // ignore read-only navigator properties
  }
}

// ============================================================================
// NES Bitmask <-> RetroArch rwebinput Key Mapping (matches BitgeistArena.tsx)
// ============================================================================
const NES_BIT_KEYS = [
  [0x01, { code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 }],
  [0x02, { code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 }],
  [0x04, { code: 'ArrowDown', key: 'ArrowDown', keyCode: 40 }],
  [0x08, { code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 }],
  [0x10, { code: 'Enter', key: 'Enter', keyCode: 13 }],
  [0x20, { code: 'ShiftRight', key: 'Shift', keyCode: 16, location: 2 }],
  [0x40, { code: 'KeyZ', key: 'z', keyCode: 90 }],
  [0x80, { code: 'Space', key: ' ', keyCode: 32 }],
];

let heldMask = 0;

function dispatchKey(type, spec) {
  const evt = {
    type,
    code: spec.code,
    key: spec.key,
    keyCode: spec.keyCode,
    which: spec.keyCode,
    charCode: 0,
    location: spec.location || 0,
    ctrlKey: 0,
    shiftKey: spec.code === 'ShiftRight' ? 1 : 0,
    altKey: 0,
    metaKey: 0,
    repeat: 0,
    timeStamp: virtualNowMs,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
  };
  docTarget.dispatchEvent(evt);
  winTarget.dispatchEvent(evt);
  canvasTarget.dispatchEvent(evt);
}

function setJoypadMask(nextMask) {
  const clean = nextMask & 0xff;
  if (clean === heldMask) return;
  for (const [bit, spec] of NES_BIT_KEYS) {
    const wasDown = (heldMask & bit) !== 0;
    const isDown = (clean & bit) !== 0;
    if (isDown && !wasDown) {
      dispatchKey('keydown', spec);
    } else if (!isDown && wasDown) {
      dispatchKey('keyup', spec);
    }
  }
  heldMask = clean;
}

const RETROARCH_HEADLESS_CFG = [
  'video_driver = "null"',
  'audio_driver = "null"',
  'input_driver = "rwebinput"',
  'input_joypad_driver = "null"',
  'video_vsync = "false"',
  'audio_sync = "false"',
  'fastforward_ratio = "0.0"',
  'savestate_file_compression = "false"',
  'savestate_thumbnail_enable = "false"',
  'savestate_directory = "/states"',
  'sort_savestates_enable = "false"',
  'sort_savestates_by_content_enable = "false"',
  'state_slot = "0"',
  'input_player1_up = "up"',
  'input_player1_down = "down"',
  'input_player1_left = "left"',
  'input_player1_right = "right"',
  'input_player1_a = "space"',
  'input_player1_b = "z"',
  'input_player1_start = "enter"',
  'input_player1_select = "rshift"',
  'input_pause_toggle = "nul"',
  'input_reset = "nul"',
  'input_toggle_fast_forward = "nul"',
  '',
].join('\n');

let activeCore = null; // { romPath, mod, ramOffset }

function extractFceummRamFromSaveState(stateBytes) {
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

function stepFrames(count) {
  for (let i = 0; i < count; i++) {
    virtualNowMs += 1000 / 60;
    const cb = pendingRafCb;
    if (cb) {
      cb(virtualNowMs);
    }
  }
}

function findStateFilePath(FS) {
  const roots = ['/states', '/home/web_user/retroarch/userdata/states', '/'];
  const visit = (dir, depth) => {
    if (depth > 3) return null;
    let entries;
    try {
      entries = FS.readdir(dir);
    } catch {
      return null;
    }
    for (const name of entries) {
      if (name === '.' || name === '..') continue;
      const full = path.posix.join(dir, name);
      if (name.endsWith('.state') || /\.state\d+$/.test(name)) {
        return full;
      }
      try {
        const stat = FS.stat(full);
        if (FS.isDir(stat.mode)) {
          const found = visit(full, depth + 1);
          if (found) return found;
        }
      } catch {
        // ignore
      }
    }
    return null;
  };
  for (const root of roots) {
    const found = visit(root, 0);
    if (found) return found;
  }
  return '/states/rom.state';
}

function saveCoreStateBytes(mod) {
  const existing = findStateFilePath(mod.FS);
  try {
    mod.FS.unlink(existing);
  } catch {
    // ignore if absent
  }
  mod._cmd_save_state();
  for (let i = 0; i < 8; i++) {
    stepFrames(1);
    const statePath = findStateFilePath(mod.FS);
    try {
      const data = mod.FS.readFile(statePath);
      if (data && data.length > 64) {
        return new Uint8Array(data);
      }
    } catch {
      // keep stepping until written
    }
  }
  const finalPath = findStateFilePath(mod.FS);
  return new Uint8Array(mod.FS.readFile(finalPath));
}

function loadCoreStateBytes(mod, bytes) {
  const statePath = findStateFilePath(mod.FS);
  try {
    mod.FS.mkdirTree(path.posix.dirname(statePath));
  } catch {
    // dir already exists
  }
  mod.FS.writeFile(statePath, bytes);
  mod._cmd_load_state();
  stepFrames(1);
}

function locateNesRamOffset(mod) {
  stepFrames(10);
  const stateBytes = saveCoreStateBytes(mod);
  const ramSnap = extractFceummRamFromSaveState(stateBytes);
  const heap = mod.HEAPU8;
  if (!ramSnap || !heap) return null;

  const s1 = ramSnap[0x1fe];
  const s2 = ramSnap[0x1ff];
  const maxOffset = heap.length - 0x800;
  const candidates = [];

  for (let ptr = 0; ptr <= maxOffset; ptr += 4) {
    if (heap[ptr + 0x1fe] === s1 && heap[ptr + 0x1ff] === s2) {
      let matches = 0;
      for (let k = 0x20; k < 0x800; k += 31) {
        if (heap[ptr + k] === ramSnap[k]) matches++;
      }
      if (matches >= 54) {
        candidates.push(ptr);
      }
    }
  }
  return candidates[0] ?? null;
}

async function ensureCoreBootedForRom(coreJsPath, coreWasmPath, romPath) {
  if (activeCore && activeCore.romPath === romPath) {
    setJoypadMask(0);
    return activeCore;
  }

  const coreUrl = pathToFileURL(coreJsPath).href;
  const rawCoreJs = fs
    .readFileSync(coreJsPath, 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(coreUrl))
    .replace(/export\s+default\s+([a-zA-Z0-9_$]+)\s*;?/, 'return $1;');
  const createFceumm = new Function(rawCoreJs)();
  const wasmBinary = fs.readFileSync(coreWasmPath);
  const romBytes = fs.readFileSync(romPath);

  const mod = await createFceumm({
    noInitialRun: true,
    wasmBinary,
    canvas: mockCanvas,
    print() {},
    printErr() {},
  });

  try {
    mod.FS.mkdirTree('/states');
    mod.FS.mkdirTree('/home/web_user/retroarch/userdata/config');
    mod.FS.mkdirTree('/home/web_user/retroarch/userdata/states/FCEUmm');
  } catch {
    // ignore
  }
  mod.FS.writeFile('/home/web_user/retroarch/userdata/retroarch.cfg', RETROARCH_HEADLESS_CFG);
  mod.FS.writeFile('/retroarch.cfg', RETROARCH_HEADLESS_CFG);
  mod.FS.writeFile('/rom.nes', romBytes);

  mod.callMain(['/rom.nes', '-c', '/retroarch.cfg']);
  const ramOffset = locateNesRamOffset(mod);
  if (ramOffset === null) {
    throw new Error('Failed to locate 2KB 6502 RAM in headless fceumm HEAPU8');
  }

  activeCore = { romPath, mod, ramOffset };
  return activeCore;
}

function getRamView(core) {
  return core.mod.HEAPU8.subarray(core.ramOffset, core.ramOffset + 0x800);
}

function coldBootCelesteRoomAndSaveState(core, targetLevel, targetWarp) {
  setJoypadMask(0);
  const ram = getRamView(core);

  // Reset core cleanly before navigating title -> overworld -> targetWarp
  core.mod._cmd_reset();
  stepFrames(12);

  for (let iter = 0; iter < 900; iter++) {
    const gm = ram[0x001c];
    const gs = ram[0x0021];
    const fade = ram[0x0031];

    if (
      gm === 0x00 &&
      (gs & 0x01) !== 0 &&
      fade === 0 &&
      ram[0x00a1] === 0 &&
      ram[0x001a] === 0 &&
      (ram[0x00c5] & 0x20) === 0 &&
      (ram[0x0066] & 0x1f) === 0
    ) {
      break;
    }

    if (gm === 0x01 && (gs & 0x01) !== 0 && fade === 0) {
      setJoypadMask(0x10); // START
      stepFrames(3);
      setJoypadMask(0);
      stepFrames(5);
      continue;
    }

    if (gm === 0x03) {
      ram[0x005a] = targetLevel;
      if ((gs & 0x01) !== 0 && fade === 0) {
        if (ram[0x0054] === 0) {
          ram[0x0054] = 1;
          ram[0x005c] = 0;
        }
        setJoypadMask(0x80); // A
        stepFrames(3);
        setJoypadMask(0);
        stepFrames(5);
        continue;
      }
    }

    if (gm === 0x04 && (gs & 0x01) !== 0 && fade === 0) {
      setJoypadMask(0x10); // START
      stepFrames(3);
      setJoypadMask(0);
      stepFrames(5);
      continue;
    }

    stepFrames(2);
  }

  if (targetWarp > 0) {
    if (targetLevel === 2) {
      ram[0x054a] = targetWarp >= 73 ? 0x03 : 0x01;
    }
    ram[0x053c] = targetWarp;
    ram[0x00c5] |= 0x20;
    ram[0x00f0] = 23;

    for (let w = 0; w < 300; w++) {
      stepFrames(2);
      if (
        ram[0x001c] === 0x00 &&
        ram[0x053b] === targetWarp &&
        (ram[0x00c5] & 0x20) === 0 &&
        ram[0x00a1] === 0 &&
        ram[0x001a] === 0 &&
        (ram[0x0066] & 0x1f) === 0 &&
        (ram[0x0021] & 0x01) !== 0
      ) {
        break;
      }
    }
  }

  // Match BitgeistArena.tsx post-warp console flags
  ram[0x0048] = 0x01;
  ram[0x0506] = 0x00;
  ram[0x0507] = 0x00;
  if (targetLevel === 0) {
    ram[0x0065] &= ~0x40;
  } else if (targetLevel === 2) {
    ram[0x054a] = targetWarp >= 73 ? 0x03 : 0x01;
  }
  stepFrames(4);
  return saveCoreStateBytes(core.mod);
}

function coldBootGenericNesGameplayAndSaveState(core, gameKind, targetStage = 0) {
  setJoypadMask(0);
  const ram = getRamView(core);
  core.mod._cmd_reset();
  stepFrames(20);

  if (gameKind === 'nova') {
    // Nova the Squirrel: Title (START) -> MainMenu (A) -> LevelSelect (A) -> PreLevel (ram[14]=0, A) -> Gameplay
    stepFrames(35);
    setJoypadMask(0x10); // START on Title Screen
    stepFrames(4);
    setJoypadMask(0);
    stepFrames(24);

    setJoypadMask(0x80); // A on Main Menu ("Start the game!")
    stepFrames(4);
    setJoypadMask(0);
    stepFrames(28);

    setJoypadMask(0x80); // A on Level Select (selects 1-1)
    stepFrames(4);
    setJoypadMask(0);
    stepFrames(28);

    // On Pre-Level Screen, Cursor lives at ZP $0E (3 = "Show Intro" if uncleared; 0 = "Start!")
    ram[0x0e] = 0;
    stepFrames(2);
    setJoypadMask(0x80); // A on "Start!"
    stepFrames(4);
    setJoypadMask(0);

    for (let iter = 0; iter < 240; iter++) {
      stepFrames(2);
      if (ram[0x3d] === 0xf0 && ram[0x4b] > 0) {
        break;
      }
    }

    // Native Zero-Page level warp ($A7 = LevelNumber, $A8 = StartedLevelNumber, $A9 = NeedLevelReload)
    if (targetStage > 0 && ram[0x3d] === 0xf0) {
      ram[0xa7] = targetStage;
      ram[0xa8] = targetStage;
      ram[0xa9] = 1;
      for (let w = 0; w < 180; w++) {
        stepFrames(2);
        if (ram[0xa9] === 0 && ram[0xa7] === targetStage && ram[0x3d] === 0xf0 && ram[0x4b] > 0) {
          break;
        }
      }
    }

    stepFrames(8);
    return saveCoreStateBytes(core.mod);
  }

  // Generic pulse START twice
  stepFrames(28);
  setJoypadMask(0x10);
  stepFrames(5);
  setJoypadMask(0);
  stepFrames(24);
  setJoypadMask(0x10);
  stepFrames(5);
  setJoypadMask(0);
  stepFrames(18);
  return saveCoreStateBytes(core.mod);
}

function fixed12_4ToPixels(raw16) {
  return raw16 >= 0xe000 ? (raw16 << 16) >> 20 : raw16 >> 4;
}

function extractHeadlessTelemetry(ram, job, prevCamX, prevCamY, hadGameplay) {
  if (job.gameKind === 'celeste') {
    const gamemode = ram[0x001c];
    const gamestate = ram[0x0021];
    const gamectrl3 = ram[0x0066];
    const playerctrl = ram[0x00c5];
    const currroom = ram[0x053b];
    const camRaw16 = (ram[0x0067] << 8) | ram[0x00cc];
    const cameraX =
      camRaw16 >= 0x3800 && camRaw16 < 0x8000 ? Math.max(0, camRaw16 - 0x4000) : prevCamX;

    const warpYMap = job.warpYMap || {};
    const mappedRelY = warpYMap[currroom];
    const roomRelY = typeof mappedRelY === 'number' ? mappedRelY : prevCamY;
    let cameraY = roomRelY;
    if ((gamectrl3 & 0x02) !== 0) {
      const ntRowHead2 = ram[0x007a];
      const rowsRem = ntRowHead2 >= 0x80 ? 0 : Math.min(30, ntRowHead2 + 1);
      cameraY = roomRelY + rowsRem * 8;
    }

    const screenX = ram[0x004b];
    const rawScreenY = ram[0x004c];
    const screenFeetY = Math.max(16, Math.min(248, Math.round((rawScreenY || 168) + 16)));
    const playerWorldX = cameraX + screenX;
    const playerWorldY = cameraY + screenFeetY;
    const isDying = (playerctrl & 0x20) !== 0 || (gamectrl3 & 0x10) !== 0;
    const inGameplay = gamemode === 0x00 && (gamestate & 0x01) !== 0 && !isDying;
    const isDead = hadGameplay && gamemode === 0x00 && isDying;
    const goalWarps = job.goalWarps || [];
    const hitGoalWarp = goalWarps.length > 0 && goalWarps.includes(currroom);
    const reachedGoal = inGameplay && (hitGoalWarp || playerWorldX >= job.goalWorldX);
    return { inGameplay, playerWorldX, playerWorldY, cameraX, cameraY, isDead, reachedGoal };
  }

  if (job.gameKind === 'nova') {
    const enemyRightEdge = ram[0x3d];
    const health = ram[0x4b];
    const inGameplay = enemyRightEdge === 0xf0 && health > 0;
    const cameraSub = ram[0x1f] | (ram[0x20] << 8);
    const playerXSub = ram[0x25] | (ram[0x26] << 8);
    const playerYSub = (ram[0x27] << 8) | ram[0x28];
    const cameraX = Math.max(0, fixed12_4ToPixels(cameraSub));
    const playerWorldX = Math.max(0, fixed12_4ToPixels(playerXSub));
    const playerWorldY = fixed12_4ToPixels(playerYSub);
    const isDead =
      hadGameplay && enemyRightEdge === 0xf0 && (playerWorldY > 246 || health === 0);
    const reachedGoal = inGameplay && playerWorldX >= job.goalWorldX;
    return { inGameplay, playerWorldX, playerWorldY, cameraX, cameraY: 0, isDead, reachedGoal };
  }

  return {
    inGameplay: false,
    playerWorldX: 0,
    playerWorldY: 180,
    cameraX: 0,
    cameraY: 0,
    isDead: false,
    reachedGoal: false,
  };
}

export async function runVerificationJob(job) {
  const t0 = realPerfNow();
  const core = await ensureCoreBootedForRom(job.coreJsPath, job.coreWasmPath, job.romPath);

  let startStateBytes = null;
  if (job.canonicalStatePath && fs.existsSync(job.canonicalStatePath)) {
    startStateBytes = new Uint8Array(fs.readFileSync(job.canonicalStatePath));
  } else {
    if (job.gameKind === 'celeste') {
      startStateBytes = coldBootCelesteRoomAndSaveState(
        core,
        job.worldIndex ?? 1,
        job.startWarp ?? 0
      );
    } else {
      startStateBytes = coldBootGenericNesGameplayAndSaveState(
        core,
        job.gameKind,
        job.stageIndex ?? 0
      );
    }
    if (job.canonicalStatePath && startStateBytes) {
      try {
        fs.mkdirSync(path.dirname(job.canonicalStatePath), { recursive: true });
        fs.writeFileSync(job.canonicalStatePath, startStateBytes);
      } catch {
        // non-fatal cache write failure
      }
    }
  }

  setJoypadMask(0);
  loadCoreStateBytes(core.mod, startStateBytes);

  const ram = getRamView(core);
  const masks = job.frameMasks;
  const maxFrames = Math.min(36_000, masks.length + 24);

  let prevCamX = 0;
  let prevCamY = 0;
  let hadGameplay = false;
  const keyframes = [];
  let died = false;
  let goalFrame = null;

  for (let f = 0; f < maxFrames; f++) {
    const mask = f < masks.length ? masks[f] : 0;
    setJoypadMask(mask);
    stepFrames(1);

    const t = extractHeadlessTelemetry(ram, job, prevCamX, prevCamY, hadGameplay);
    if (t.inGameplay) {
      hadGameplay = true;
      prevCamX = t.cameraX;
      prevCamY = t.cameraY;
      if (f % 3 === 0) {
        keyframes.push([f, t.playerWorldX, t.playerWorldY]);
      }
    }

    if (t.isDead && f > 12) {
      died = true;
      break;
    }

    if (t.reachedGoal && f > 30) {
      goalFrame = f + 1;
      const last = keyframes[keyframes.length - 1];
      if (!last || last[0] !== f) {
        keyframes.push([f, t.playerWorldX, t.playerWorldY]);
      }
      break;
    }
  }

  setJoypadMask(0);
  const elapsedCpuMs = Math.round((realPerfNow() - t0) * 100) / 100;

  if (goalFrame === null) {
    return {
      ok: false,
      reachedGoal: false,
      died,
      elapsedCpuMs,
      reason: died
        ? 'Headless WASM replay died before reaching finish gate'
        : 'Headless WASM replay did not reach finish gate',
    };
  }

  const simulatedTimeMs = Math.max(1000, Math.round((goalFrame / 60) * 1000));
  return {
    ok: true,
    reachedGoal: true,
    died: false,
    goalFrame,
    simulatedTimeMs,
    frames: keyframes,
    elapsedCpuMs,
  };
}

if (parentPort) {
  parentPort.on('message', async (msg) => {
    const { id, job } = msg;
    try {
      const result = await runVerificationJob(job);
      parentPort.postMessage({ id, result });
    } catch (err) {
      parentPort.postMessage({
        id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
