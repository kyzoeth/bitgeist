export type RunnerArchetypeId = 0 | 1 | 2 | 3 | 4;

export type RunnerPoseId = 'idleA' | 'idleB' | 'run1' | 'run2' | 'run3' | 'jump' | 'fall';

interface BakedRunnerSprites {
  main: HTMLCanvasElement;
  echo: HTMLCanvasElement;
}

const GRID_W = 18;
const GRID_H = 20;
const PIXEL_SCALE = 2; // 18x20 NES pixels -> 36x40 overlay canvas pixels (512x480 = 2x 256x240)

const CURATED_TAG_ARCHETYPES: Record<string, RunnerArchetypeId> = {
  ALEX: 0, // Horned Dragon Champion
  DINKY: 0, // Horned Dragon Kid
  MADELINE: 2, // Billowing Headband Climber
  THEO: 1, // Visor Explorer
  BADELINE: 4, // Pointed-Ear Shadow Striker
  MIRA: 1, // Cyber-Visor Striker
  PIXEL: 1, // Cyber-Visor Striker
  KAI: 2, // Headband Shinobi
  RINA: 2, // Headband Shinobi
  ZED: 3, // Plumed Paladin Knight
  JAX: 3, // Plumed Paladin Knight
  MINKY: 4, // Pointed-Ear Astro Pilot
  LUMA: 4, // Pointed-Ear Astro Pilot
};

export function getRunnerArchetypeForTag(tag: string): RunnerArchetypeId {
  const upper = (tag || '').trim().toUpperCase();
  if (upper in CURATED_TAG_ARCHETYPES) {
    return CURATED_TAG_ARCHETYPES[upper];
  }
  let h = 2166136261;
  for (let i = 0; i < upper.length; i++) {
    h ^= upper.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 5) as RunnerArchetypeId;
}

/**
 * 5 Distinct 18-column x 8-row NES Character Headgear / Upper Silhouettes (rows 1..8, facing RIGHT).
 * Tokens:
 *  '.' = empty
 *  'P' = primary color
 *  'H' = bright hologram specular highlight
 *  'S' = shaded armor/cloth depth
 *  'A' = accent trim (horns, headband tails, knight plume, visor pod)
 *  'V' = bright visor / eye sclera
 *  'E' = dark pupil / visor slit
 */
const ARCHETYPE_HEADS: Record<RunnerArchetypeId, readonly string[]> = {
  // 0: DRAGON — Swept-back twin horns, dorsal neck spine, expressive dragon eye & snout
  0: [
    '...AA.............',
    '....AA.HHHH.......',
    '..AA.PPPPPHH......',
    '...SPPPPVVPHH.....',
    '..ASPPPPVEPPPH....',
    '...SPPPPPPPPPP....',
    '..ASSPPPPPSSS.....',
    '....SSPPPP........',
  ],
  // 1: VISOR — Rounded Mega-style aero helmet, side comm pod & wrap-around glowing cyber visor
  1: [
    '.......HHHH.......',
    '.....HHPPPPHH.....',
    '....SPPPPPPAA.....',
    '....SPAAVVVVVV....',
    '....SPAAPVVVVV....',
    '....SSPPPPPHH.....',
    '.....SSPPPPS......',
    '......SPPPS.......',
  ],
  // 2: SHINOBI — Sleek ninja hood, masked face & billowing twin headband tails
  2: [
    '..................',
    '......HHPPPH......',
    '..AA.SPPPPPPH.....',
    '.AA.AAAAAAAAA.....',
    'A..A.SPPVVEV......',
    '..A..SPPPSSSS.....',
    '......SSPPSS......',
    '.......SPPS.......',
  ],
  // 3: KNIGHT — Sweeping heroic helmet plume, armored brow ridge & glowing T-visor greathelm
  3: [
    '...AAAAH..........',
    '..AAA.AAHHH.......',
    '.AA..SPPPPPHH.....',
    '.....SPPHHHHH.....',
    '.....SPPPEVVE.....',
    '.....SPPPPEEP.....',
    '.....SSPPPPPH.....',
    '......SSPPPS......',
  ],
  // 4: ASTRO — Twin pointed mecha/cat ears atop pilot dome with expressive 8-bit eyes
  4: [
    '....AH.....AH.....',
    '....APH...APH.....',
    '....SPPHHHPPH.....',
    '....SPPPPPPPPH....',
    '....SPPVEPPVE.....',
    '....SPPVVPPVV.....',
    '.....SPPAPPS......',
    '......SPPPS.......',
  ],
};

/**
 * 7 Action Lower-Body Templates (rows 9..17, 18 columns wide, facing RIGHT).
 * Row 18 is left clear for the automatic 1px #111111 boot-sole outline!
 */
const POSE_BODIES: Record<RunnerPoseId, readonly string[]> = {
  idleA: [
    '.....AAPPPHH......',
    '....SPPPPPPHH.....',
    '....SHHPPPAAH.....',
    '.....SAAAAAS......',
    '.....SPPSPPH......',
    '.....SPS.SPH......',
    '.....SPS..PH......',
    '....SAAS..AAH.....',
    '....SSSS..SSS.....',
  ],
  idleB: [
    '..................',
    '.....AAPPPHH......',
    '....SPPPPPPHH.....',
    '....SHHPPPAAH.....',
    '.....SAAAAAS......',
    '.....SPPSPPH......',
    '.....SPS..PH......',
    '....SAAS..AAH.....',
    '....SSSS..SSS.....',
  ],
  run1: [
    '.....AAPPPHH......',
    '...HHSPPPPPHHH....',
    '...HS.SPPPA.HH....',
    '......SAAAAH......',
    '.....SPPS.PPH.....',
    '....SPPS...PPH....',
    '...SAAS....SAAH...',
    '...SS.......SSH...',
    '..................',
  ],
  run2: [
    '.....AAPPPH.......',
    '.....SPPPPHH......',
    '.....SPHHPAH......',
    '......SAAAS.......',
    '......SPPPH.......',
    '......SPPH........',
    '.....SPSPH........',
    '.......AAH........',
    '.......SSS........',
  ],
  run3: [
    '.....AAPPPHH......',
    '....SSPPPPHHHH....',
    '....S.SPPPA..H....',
    '......SAAAAS......',
    '.....SPS.PPH......',
    '....SPS...PPH.....',
    '....AA....SPH.....',
    '....SS.....AAH....',
    '...........SSS....',
  ],
  jump: [
    '.....AAPPPHHHH....',
    '...HHSPPPPPH..H...',
    '......SAAAAH......',
    '.....SPPSPPPH.....',
    '....SPPS..SAAH....',
    '...SAAS....SS.....',
    '...SS.............',
    '..................',
    '..................',
  ],
  fall: [
    '...HH.AAPPPHHH....',
    '....HSPPPPPH......',
    '......SAAAAS......',
    '.....SPPSPPH......',
    '....SPS...PPH.....',
    '....AA.....PH.....',
    '....SS.....AAH....',
    '...........SS.....',
    '..................',
  ],
};

function parseHexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16) || 255,
      parseInt(clean[1] + clean[1], 16) || 231,
      parseInt(clean[2] + clean[2], 16) || 76,
    ];
  }
  return [
    parseInt(clean.slice(0, 2), 16) || 255,
    parseInt(clean.slice(2, 4), 16) || 231,
    parseInt(clean.slice(4, 6), 16) || 76,
  ];
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function rgbaStr(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha.toFixed(3)})`;
}

function pickAccentRgb(primary: [number, number, number]): [number, number, number] {
  // Warm golden/yellow runners (like Crowned @ALEX) get punchy Famicom Coral-Red horns/boots;
  // coral/pink runners get bright Golden-Yellow trim; cool blue/mint/violet runners get warm Gold trim.
  const isWarmYellow = primary[0] > 215 && primary[1] > 180 && primary[2] < 130;
  if (isWarmYellow) return [236, 92, 74]; // #EC5C4A
  const isReddish = primary[0] > 200 && primary[1] < 140;
  if (isReddish) return [255, 231, 76]; // #FFE74C
  return [255, 234, 112]; // #FFEA70
}

function buildCharacterGrid(
  archetype: RunnerArchetypeId,
  pose: RunnerPoseId,
  facingLeft: boolean
): string[][] {
  const grid: string[][] = Array.from({ length: GRID_H }, () =>
    Array.from({ length: GRID_W }, () => '.')
  );

  const head = ARCHETYPE_HEADS[archetype];
  const body = POSE_BODIES[pose];

  // Subtle vertical head bob (+1px on idleB crouch, -1px on airborne jump/run2 apex)
  const headOffsetY = pose === 'idleB' ? 2 : pose === 'jump' || pose === 'run2' ? 0 : 1;
  // Slight forward lean (+1px right) during full sprint strides
  const headOffsetX = pose === 'run1' || pose === 'run3' ? 1 : 0;

  for (let r = 0; r < head.length; r++) {
    const rowStr = head[r];
    const gy = r + headOffsetY;
    if (gy < 1 || gy >= GRID_H - 2) continue;
    for (let c = 0; c < GRID_W; c++) {
      const ch = rowStr[c] || '.';
      if (ch === '.') continue;
      const gx = c + headOffsetX;
      if (gx >= 1 && gx < GRID_W - 1) {
        grid[gy][gx] = ch;
      }
    }
  }

  // Animated Shinobi headband tail wave on run2 / jump / fall
  if (archetype === 2 && (pose === 'run2' || pose === 'jump' || pose === 'fall')) {
    const waveUp = pose === 'fall' ? -1 : 1;
    if (grid[5 + waveUp]) {
      grid[5 + waveUp][1] = 'A';
      grid[5 + waveUp][2] = 'A';
    }
  }

  for (let r = 0; r < body.length; r++) {
    const rowStr = body[r];
    const gy = 9 + r;
    if (gy >= GRID_H - 1) continue;
    for (let c = 0; c < GRID_W; c++) {
      const ch = rowStr[c] || '.';
      if (ch !== '.') {
        grid[gy][c] = ch;
      }
    }
  }

  // Archetype-specific back details: Dragon wagging tail (0) & Knight fluttering short cape (3)
  if (archetype === 0) {
    const tailY = pose === 'run1' || pose === 'jump' ? 12 : 13;
    grid[tailY][3] = 'P';
    grid[tailY][2] = 'A';
    grid[tailY - 1][2] = 'A';
  } else if (archetype === 3) {
    const capeLift = pose === 'run1' || pose === 'run3' || pose === 'fall' ? -1 : 0;
    grid[10][4] = 'A';
    grid[11 + capeLift][3] = 'A';
    grid[11 + capeLift][4] = 'A';
    grid[12 + capeLift][2] = 'A';
    grid[12 + capeLift][3] = 'A';
  }

  // Mirror horizontally if facing left
  if (facingLeft) {
    for (let y = 0; y < GRID_H; y++) {
      grid[y].reverse();
    }
  }

  // Automatic 4-connected 1px NES outer silhouette outline ('#')
  const outlined = grid.map((row) => [...row]);
  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (grid[y][x] !== '.') continue;
      for (let d = 0; d < dirs.length; d++) {
        const ny = y + dirs[d][0];
        const nx = x + dirs[d][1];
        if (ny >= 0 && ny < GRID_H && nx >= 0 && nx < GRID_W && grid[ny][nx] !== '.') {
          outlined[y][x] = '#';
          break;
        }
      }
    }
  }

  return outlined;
}

const MAX_SPRITE_CACHE_ENTRIES = 512;
const spriteCache = new Map<string, BakedRunnerSprites>();

export function getHologramRunnerSprites(
  archetype: RunnerArchetypeId,
  primaryHex: string,
  pose: RunnerPoseId,
  facingLeft: boolean
): BakedRunnerSprites | null {
  if (typeof document === 'undefined') return null;

  const key = `${archetype}|${primaryHex}|${pose}|${facingLeft ? 'L' : 'R'}`;
  const cached = spriteCache.get(key);
  if (cached) return cached;

  const grid = buildCharacterGrid(archetype, pose, facingLeft);
  const primary = parseHexToRgb(primaryHex);
  const highlight = mixRgb(primary, [255, 255, 255], 0.56);
  const shadow = mixRgb(primary, [18, 16, 32], 0.44);
  const accent = pickAccentRgb(primary);
  const visor: [number, number, number] = [255, 253, 245];
  const pupil: [number, number, number] = [20, 19, 28];
  const outline: [number, number, number] = [17, 17, 17];

  const mainCanvas = document.createElement('canvas');
  mainCanvas.width = GRID_W * PIXEL_SCALE;
  mainCanvas.height = GRID_H * PIXEL_SCALE;
  const mCtx = mainCanvas.getContext('2d');

  const echoCanvas = document.createElement('canvas');
  echoCanvas.width = GRID_W * PIXEL_SCALE;
  echoCanvas.height = GRID_H * PIXEL_SCALE;
  const eCtx = echoCanvas.getContext('2d');

  if (!mCtx || !eCtx) return null;

  for (let y = 0; y < GRID_H; y++) {
    // Subtle 8-bit hologram scanline shimmer on odd NES rows
    const scanAlpha = y % 2 === 0 ? 0.96 : 0.82;
    const echoScanAlpha = y % 2 === 0 ? 0.88 : 0.36;

    for (let x = 0; x < GRID_W; x++) {
      const token = grid[y][x];
      if (token === '.') continue;

      const px = x * PIXEL_SCALE;
      const py = y * PIXEL_SCALE;

      if (token === '#') {
        mCtx.fillStyle = rgbaStr(outline, 0.94);
        mCtx.fillRect(px, py, PIXEL_SCALE, PIXEL_SCALE);

        eCtx.fillStyle = rgbaStr(primary, 0.25 * echoScanAlpha);
        eCtx.fillRect(px, py, PIXEL_SCALE, PIXEL_SCALE);
        continue;
      }

      const rgb =
        token === 'H'
          ? highlight
          : token === 'S'
            ? shadow
            : token === 'A'
              ? accent
              : token === 'V'
                ? visor
                : token === 'E'
                  ? pupil
                  : primary;

      mCtx.fillStyle = rgbaStr(rgb, token === 'E' || token === 'V' ? 0.98 : scanAlpha);
      mCtx.fillRect(px, py, PIXEL_SCALE, PIXEL_SCALE);

      const echoRgb = token === 'H' || token === 'V' ? highlight : primary;
      eCtx.fillStyle = rgbaStr(echoRgb, echoScanAlpha);
      eCtx.fillRect(px, py, PIXEL_SCALE, PIXEL_SCALE);
    }
  }

  const pair: BakedRunnerSprites = { main: mainCanvas, echo: echoCanvas };
  if (spriteCache.size >= MAX_SPRITE_CACHE_ENTRIES) {
    const oldestKey = spriteCache.keys().next().value;
    if (typeof oldestKey === 'string') {
      spriteCache.delete(oldestKey);
    }
  }
  spriteCache.set(key, pair);
  return pair;
}

/**
 * Hand-crafted 13x8 NES Pixel-Art 3-Point Jeweled Golden Crown (26x16 at 2x canvas scale).
 */
const CROWN_GRID: readonly string[] = [
  '......#......',
  '.#...#W#...#.',
  '#W#.#WGG#.#W#',
  '#GG#GGRGG#GG#',
  '#GWGGWRWGGDG#',
  '.#GGGGRGGGD#.',
  '.#DDGGGGGDD#.',
  '..#########..',
];

let cachedCrownCanvas: HTMLCanvasElement | null = null;

export function getPixelCrownSprite(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  if (cachedCrownCanvas) return cachedCrownCanvas;

  const c = document.createElement('canvas');
  c.width = 13 * PIXEL_SCALE;
  c.height = 8 * PIXEL_SCALE;
  const ctx = c.getContext('2d');
  if (!ctx) return null;

  const palette: Record<string, string> = {
    '#': '#111111',
    G: '#F5C342',
    W: '#FFF9C4',
    D: '#C98A18',
    R: '#EC5545',
  };

  for (let y = 0; y < CROWN_GRID.length; y++) {
    const row = CROWN_GRID[y];
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * PIXEL_SCALE, y * PIXEL_SCALE, PIXEL_SCALE, PIXEL_SCALE);
    }
  }

  cachedCrownCanvas = c;
  return c;
}

/**
 * Selects the natural NES platformer animation pose from instantaneous velocity & frame phase.
 */
export function selectRunnerPose(params: {
  isWaiting: boolean;
  vx: number;
  vy: number;
  animPhase: number;
  runnerSeed: number;
  distanceX: number;
}): RunnerPoseId {
  const { isWaiting, vx, vy, animPhase, runnerSeed, distanceX } = params;
  if (isWaiting) {
    return Math.sin(animPhase * 0.75 + runnerSeed * 1.3) >= 0 ? 'idleA' : 'idleB';
  }
  if (vy < -0.42) {
    return 'jump';
  }
  if (vy > 0.48) {
    return 'fall';
  }
  if (Math.abs(vx) < 0.14) {
    return Math.sin(animPhase * 0.8 + runnerSeed) >= 0 ? 'idleA' : 'idleB';
  }
  // Distance-driven 4-step NES run cycle: run1 -> run2 -> run3 -> run2
  const cycleStep = Math.floor(Math.abs(distanceX) * 0.14 + runnerSeed * 2) & 3;
  if (cycleStep === 0) return 'run1';
  if (cycleStep === 2) return 'run3';
  return 'run2';
}

/**
 * Draws an 8-way NES Mega-style hologram de-rez burst when a rival perishes in a pit/hazard.
 */
export function drawHologramDerezBurst(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  colorHex: string,
  progress01: number
): void {
  const clamped = Math.max(0, Math.min(1, progress01));
  const radius = 6 + clamped * 34;
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = Math.max(0, (1 - clamped) * 0.9);

  for (let dir = 0; dir < 8; dir++) {
    const angle = (dir * Math.PI) / 4;
    const px = Math.round(cx + Math.cos(angle) * radius);
    const py = Math.round(cy + Math.sin(angle) * radius);
    ctx.fillStyle = '#111111';
    ctx.fillRect(px - 4, py - 4, 8, 8);
    ctx.fillStyle = dir % 2 === 0 ? colorHex : '#FFF9E6';
    ctx.fillRect(px - 2, py - 2, 4, 4);
  }

  ctx.globalAlpha = prevAlpha;
}
