import {
  getCourseByIndex,
  getDailySprintByNumber,
  getDailySprintForDate,
} from './dailySprints';
import {
  CELESTE_GBA_ROM_ID,
  CELESTE_GBA_SPRINT_SEGMENTS,
  NOVA_SPRINT_SEGMENTS,
} from './homebrewCatalog';
import {
  NES_INPUT_A,
  NES_INPUT_B,
  NES_INPUT_LEFT,
  NES_INPUT_RIGHT,
  NES_INPUT_SELECT,
  NES_INPUT_START,
  NES_INPUT_UP,
} from './inputReplay';
import {
  createCausalRamScannerState,
  scanCausalRamRegisters,
} from './ramAutoScanner';
import { CONSOLE_SYSTEM_LABELS, detectRomConsoleSystem } from './romVault';
import type {
  ConsoleSystemId,
  CustomSprintBounds,
  RomProfile,
  TelemetryFrame,
  TelemetryTrackerState,
} from './types';

export const CELESTE_ROM_ID = '4cd56ce8fdd4b921684fe56bdcc3bec0db33d6b3';
export const TWIN_DRAGONS_ROM_ID = '7b16b84e3445803d5e3af99a4df4bfa0a41f65ed';
export const DEFAULT_ROM_ID = CELESTE_ROM_ID;
export const NOVA_ROM_ID = 'b6b07ee76492ed475f39167c89b342353f999231';
export { CELESTE_GBA_ROM_ID };

function fixed12_4ToPixels(raw16: number): number {
  return raw16 >= 0xe000 ? (raw16 << 16) >> 20 : raw16 >> 4;
}

function clampScreenY(val: number): number {
  return Math.max(16, Math.min(248, Math.round(val)));
}

function cleanCartTitle(rawName: string, fallback: string): string {
  return (
    rawName
      .replace(/\.(nes|sfc|smc|md|gen|bin|gb|gbc|gba)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .toUpperCase()
      .slice(0, 22) || fallback
  );
}

/**
 * Exact 6502 RAM layout disassembled directly from CelesteNES (celeste.nes, MMC3 Mapper 4, demo-1.00):
 * - $001C: gamemode ($00 = gm_game, $01 = gm_title, $02 = gm_titletra, $03 = gm_overwld, $04 = gm_prologue)
 * - $0021: gamestate (bit 0 [$01] = gs_1stfr active gameplay loop)
 * - $004B / $004C: player_x (0..255) & player_y (0..239; 16px tall Madeline metasprite)
 * - $0066: gamectrl3 ($02 = g3_transitU 30-row upward room scroll, $10 = g3_transitX death transition)
 * - $0067:$00CC: 16-bit camera_x_pg:camera_x (anchored at $4000 on room load; continuous across R & U warps!)
 * - $007A: ntrowhead2 (counts 29 -> 0 -> $FF during g3_transitU upward scroll)
 * - $00C5: playerctrl ($01 = pl_left, $20 = pl_dead)
 * - $00F2: paused ($00 = unpaused)
 * - $050A: levelnumber (0 = Prologue, 1 = Forsaken City, 2 = Old Site)
 * - $053B / $053C: currroom / respawnroom (active warp index within chapter)
 */
export function createCelesteCourseProfile(opts?: {
  courseIndex?: number;
  dailyNumber?: number;
  sprintId?: string;
  stageLabelOverride?: string;
}): RomProfile {
  const course = getCourseByIndex(opts?.courseIndex);
  const sprintId =
    opts?.sprintId ||
    (opts?.dailyNumber
      ? `daily-${opts.dailyNumber}`
      : course.courseIndex === 0
        ? CELESTE_ROM_ID
        : `${CELESTE_ROM_ID}:c${course.courseIndex}`);
  const warpYMap = course.warpYMap || {};
  const goalWarps = course.goalWarps || [];

  return {
    romId: CELESTE_ROM_ID,
    consoleSystem: 'nes',
    sprintId,
    title: 'CELESTE',
    stageLabel: opts?.stageLabelOverride || course.stageLabel,
    profileKind: 'exact-ram',
    startWorldX: course.startWorldX,
    goalWorldX: course.goalWorldX,
    maxPxPerFrame: 10.5,
    courseIndex: course.courseIndex,
    worldIndex: course.worldIndex,
    stageIndex: course.stageIndex,
    startWarp: course.startWarp ?? course.stageIndex,
    goalWarps,
    finishDeltaY: course.finishDeltaY ?? 0,
    dailyNumber: opts?.dailyNumber,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const gamemode = ram[0x001c];
      const gamestate = ram[0x0021];
      const gamectrl3 = ram[0x0066];
      const playerctrl = ram[0x00c5];
      const currroom = ram[0x053b];

      const camRaw16 = (ram[0x0067] << 8) | ram[0x00cc];
      const cameraX =
        camRaw16 >= 0x3800 && camRaw16 < 0x8000 ? Math.max(0, camRaw16 - 0x4000) : prev.cameraX;

      const mappedRelY = warpYMap[currroom];
      const roomRelY = typeof mappedRelY === 'number' ? mappedRelY : (prev.cameraY ?? 0);
      let cameraY = roomRelY;
      if ((gamectrl3 & 0x02) !== 0) {
        const ntRowHead2 = ram[0x007a];
        const rowsRem = ntRowHead2 >= 0x80 ? 0 : Math.min(30, ntRowHead2 + 1);
        cameraY = roomRelY + rowsRem * 8;
      }

      const screenX = ram[0x004b];
      const rawScreenY = ram[0x004c];
      const screenFeetY = clampScreenY((rawScreenY || 168) + 16);

      const playerWorldX = cameraX + screenX;
      const playerWorldY = cameraY + screenFeetY;
      const facingLeft = (playerctrl & 0x01) !== 0;

      const isDying = (playerctrl & 0x20) !== 0 || (gamectrl3 & 0x10) !== 0;
      const isInitialLoading =
        !prev.hadGameplay &&
        !prev.manualSyncUnlocked &&
        (ram[0x0031] !== 0 || ram[0x00a1] !== 0 || ram[0x001a] !== 0);
      const inGameplay =
        gamemode === 0x00 && (gamestate & 0x01) !== 0 && !isDying && !isInitialLoading;
      const isDead = prev.hadGameplay && gamemode === 0x00 && isDying;
      const hitGoalWarp = goalWarps.length > 0 && goalWarps.includes(currroom);
      const reachedGoal = inGameplay && (hitGoalWarp || playerWorldX >= this.goalWorldX);

      return {
        inGameplay,
        playerWorldX,
        playerWorldY,
        cameraX,
        cameraY,
        facingLeft,
        isDead,
        reachedGoal,
        roomId: currroom,
      };
    },
  };
}

/**
 * Exact 6502 RAM layout disassembled directly from Twin Dragons (twindragons.nes, UNROM Mapper 2)
 * (retained for players who drop twindragons.nes manually into [+ DROP .NES]):
 */
function createTwinDragonsProfile(
  romId: string,
  title = 'TWIN DRAGONS'
): RomProfile {
  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 27,
    goalWorldX: 1480,
    maxPxPerFrame: 5.5,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const gameState = ram[0x0025];
      const playerType = ram[0x0300];
      const playerFlags = ram[0x0320];
      const playerStateByte = ram[0x0340];
      const playerAction = playerStateByte & 0x0f;
      const hearts = ram[0x0380] & 0x0f;
      const rawY = ram[0x0494];

      const camHi = ram[0x0078];
      const cameraX = camHi >= 0xf0 ? 0 : (camHi << 8) | ram[0x0077];

      const pxHi = ram[0x046c];
      const playerWorldX = pxHi >= 0xf0 ? 0 : (pxHi << 8) | ram[0x0458];
      const playerWorldY = clampScreenY(rawY || 192);
      const facingLeft = (playerFlags & 0x08) !== 0;

      const isDying =
        playerAction === 0x06 ||
        playerAction === 0x07 ||
        (playerStateByte & 0x80) !== 0 ||
        hearts === 0 ||
        rawY >= 0xf4;

      const inGameplay =
        gameState === 0x06 && playerType !== 0xff && ram[0x002d] === 0 && !isDying;
      const isDead = prev.hadGameplay && gameState === 0x06 && isDying;
      const reachedGoal = inGameplay && playerWorldX >= this.goalWorldX;

      return {
        inGameplay,
        playerWorldX,
        playerWorldY,
        cameraX,
        facingLeft,
        isDead,
        reachedGoal,
      };
    },
  };
}

export const DEFAULT_PROFILE: RomProfile = createCelesteCourseProfile({ courseIndex: 0 });

export function createDailyDefaultProfile(now?: Date): RomProfile {
  const daily = getDailySprintForDate(now);
  return createDailyDefaultProfileByNumber(daily.dailyNumber);
}

export function createDailyDefaultProfileByNumber(dailyNumber: number): RomProfile {
  const daily = getDailySprintByNumber(dailyNumber);
  return createCelesteCourseProfile({
    courseIndex: daily.course.courseIndex,
    dailyNumber: daily.dailyNumber,
    sprintId: daily.sprintId,
    stageLabelOverride: daily.headerStageLabel,
  });
}

export function getVaultStateKeyForProfile(
  profile: Pick<RomProfile, 'romId' | 'sprintId' | 'worldIndex' | 'stageIndex' | 'startWarp'>
): string {
  if (profile.romId === CELESTE_ROM_ID) {
    const w = profile.worldIndex ?? 1;
    const s = profile.startWarp ?? profile.stageIndex ?? 0;
    return `${CELESTE_ROM_ID}:celeste_v2_l${w}r${s}`;
  }
  if (profile.romId === NOVA_ROM_ID) {
    const s = profile.startWarp ?? profile.stageIndex ?? 0;
    return `${NOVA_ROM_ID}:nova_v1_l${s}`;
  }
  if (profile.romId === CELESTE_GBA_ROM_ID) {
    const r = profile.startWarp ?? profile.stageIndex ?? 0;
    return `${CELESTE_GBA_ROM_ID}:cgba_v1_r${r}`;
  }
  if (profile.sprintId && profile.sprintId !== profile.romId) {
    return profile.sprintId;
  }
  return profile.romId;
}

export function applyCustomSprintBounds(
  profile: RomProfile,
  bounds: CustomSprintBounds,
  overrideSprintId?: string,
  overrideStageLabel?: string
): RomProfile {
  const startWorldX = Math.max(0, Math.round(bounds.startWorldX));
  const goalWorldX = Math.max(startWorldX + 160, Math.round(bounds.goalWorldX));
  return {
    ...profile,
    startWorldX,
    goalWorldX,
    sprintId: overrideSprintId || `${profile.romId}:${startWorldX}-${goalWorldX}`,
    stageLabel: overrideStageLabel || profile.stageLabel,
  };
}

/**
 * Nova the Squirrel (MMC1, NovaSquirrel/NovaTheSquirrel v1.0.6a) Exact 6502 RAM Profile:
 * - $1F:$20: ScrollX (12.4 subpixels)
 * - $25:$26 / $27:$28: PlayerPX / PlayerPY (12.4 subpixels)
 * - $3D: EnemyRightEdge ($F0 during active level gameplay)
 * - $43: PlayerDir (nonzero = facing left)
 * - $4B: PlayerHealth (> 0 alive)
 * - $A7 / $A8 / $A9: LevelNumber / StartedLevelNumber / NeedLevelReload
 */
export function createNovaCourseProfile(opts?: {
  courseIndex?: number;
  sprintId?: string;
  stageLabelOverride?: string;
  romIdOverride?: string;
}): RomProfile {
  const seg =
    NOVA_SPRINT_SEGMENTS.find((s) => s.courseIndex === opts?.courseIndex) ||
    NOVA_SPRINT_SEGMENTS[0];
  const romId = opts?.romIdOverride || NOVA_ROM_ID;
  const sprintId =
    opts?.sprintId ||
    (seg.courseIndex === 0 ? romId : `${romId}:c${seg.courseIndex}`);

  return {
    romId,
    consoleSystem: 'nes',
    sprintId,
    title: 'NOVA THE SQUIRREL',
    stageLabel: opts?.stageLabelOverride || seg.stageLabel,
    profileKind: 'exact-ram',
    startWorldX: seg.startWorldX,
    goalWorldX: seg.goalWorldX,
    maxPxPerFrame: 6.5,
    courseIndex: seg.courseIndex,
    stageIndex: seg.startWarp,
    startWarp: seg.startWarp,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const enemyRightEdge = ram[0x3d];
      const health = ram[0x4b];
      const levelNum = ram[0xa7];
      const needLevelReload = ram[0xa9];
      const inGameplay = enemyRightEdge === 0xf0 && health > 0 && needLevelReload === 0;

      const cameraSub = ram[0x1f] | (ram[0x20] << 8);
      const playerXSub = ram[0x25] | (ram[0x26] << 8);
      const playerYSub = (ram[0x27] << 8) | ram[0x28];

      const cameraX = Math.max(0, fixed12_4ToPixels(cameraSub));
      const playerWorldX = Math.max(0, fixed12_4ToPixels(playerXSub));
      const playerWorldY = fixed12_4ToPixels(playerYSub);
      const facingLeft = ram[0x43] !== 0;

      const fellInPit = prev.hadGameplay && enemyRightEdge === 0xf0 && playerWorldY > 246;
      const lostAllHealth = prev.hadGameplay && enemyRightEdge === 0xf0 && health === 0;
      const isDead = fellInPit || lostAllHealth;
      const reachedGoal = inGameplay && playerWorldX >= this.goalWorldX;

      return {
        inGameplay,
        playerWorldX,
        playerWorldY,
        cameraX,
        facingLeft,
        isDead,
        reachedGoal,
        roomId: levelNum,
      };
    },
  };
}

function createNovaProfile(romId: string, title = 'NOVA THE SQUIRREL'): RomProfile {
  return createNovaCourseProfile({
    courseIndex: 0,
    romIdOverride: romId,
    stageLabelOverride: title,
  });
}

/**
 * Celeste Classic GBA (v1.2 by JeffRuLz, 32KB GBA Fast IWRAM $03000000-$03007FFF):
 * - IWRAM + 0x14F0: player.obj.active (1 = alive & controllable, 0 = spawning or dead)
 * - IWRAM + 0x14F1: player.obj.type (2 = type_player)
 * - IWRAM + 0x14F8: player.obj.flip.x (1 = facing left)
 * - IWRAM + 0x14FC: player.obj.x (float32 LE, 0..128 inside PICO-8 playfield)
 * - IWRAM + 0x1500: player.obj.y (float32 LE, 0..128 inside PICO-8 playfield; < -4 triggers next_room)
 * - IWRAM + 0x1548 / 0x1549: Point room { s8 x, s8 y } -> levelIndex = room.y * 8 + room.x (31 = title)
 * GBA renders the 128x128 playfield centered inside 240x160 at offset (+56, +16).
 */
export function createCelesteGbaCourseProfile(opts?: {
  courseIndex?: number;
  sprintId?: string;
  stageLabelOverride?: string;
  romIdOverride?: string;
}): RomProfile {
  const seg =
    CELESTE_GBA_SPRINT_SEGMENTS.find((s) => s.courseIndex === opts?.courseIndex) ||
    CELESTE_GBA_SPRINT_SEGMENTS[0];
  const romId = opts?.romIdOverride || CELESTE_GBA_ROM_ID;
  const sprintId =
    opts?.sprintId ||
    (seg.courseIndex === 0 ? romId : `${romId}:c${seg.courseIndex}`);
  const startRoom = seg.startWarp;
  const goalRoom = seg.goalRoomIndex ?? startRoom + 3;

  return {
    romId,
    consoleSystem: 'gba',
    sprintId,
    title: 'CELESTE GBA',
    stageLabel: opts?.stageLabelOverride || seg.stageLabel,
    profileKind: 'exact-ram',
    startWorldX: seg.startWorldX,
    goalWorldX: seg.goalWorldX,
    maxPxPerFrame: 12.0,
    courseIndex: seg.courseIndex,
    stageIndex: startRoom,
    startWarp: startRoom,
    goalWarps: [goalRoom],
    finishDeltaY: seg.finishDeltaY ?? -720,
    extractTelemetry(
      ram: Uint8Array,
      prev: TelemetryTrackerState,
      liveInputMask = 0
    ): TelemetryFrame {
      if (ram.length < 0x1600) {
        return advanceKinematicFallback(
          prev,
          this.startWorldX,
          this.goalWorldX,
          liveInputMask,
          2.8,
          ram
        );
      }

      const active = ram[0x14f0] === 1;
      const roomX = ram[0x1548] & 0x07;
      const roomY = ram[0x1549] & 0x03;
      const levelIndex = roomY * 8 + roomX;
      const isTitle = levelIndex >= 31;

      const dv = new DataView(ram.buffer, ram.byteOffset, ram.byteLength);
      const rawPx = dv.getFloat32(0x14fc, true);
      const rawPy = dv.getFloat32(0x1500, true);
      const px = Number.isFinite(rawPx) ? Math.max(-8, Math.min(136, rawPx)) : 16;
      const py = Number.isFinite(rawPy) ? Math.max(-16, Math.min(140, rawPy)) : 104;

      const roomsClimbed = isTitle ? 0 : Math.max(0, levelIndex - startRoom);
      const cameraX = roomsClimbed * 256;
      const cameraY = -roomsClimbed * 240;

      const screenX = Math.max(8, Math.min(248, Math.round(((56 + px + 4) / 240) * 256)));
      const screenFeetY = clampScreenY(Math.round(((16 + py + 8) / 160) * 240));
      const playerWorldX = cameraX + screenX;
      const playerWorldY = cameraY + screenFeetY;
      const facingLeft = ram[0x14f8] !== 0;

      // Death detection: player.obj.active dropped to 0 inside the SAME room without climbing off the top (py >= 4)
      const diedInSameRoom =
        !isTitle &&
        prev.hadGameplay &&
        Boolean(prev.lastActiveInRoom) &&
        !active &&
        prev.lastRoomId === levelIndex &&
        py >= 4;

      prev.lastRoomId = levelIndex;
      prev.lastActiveInRoom = active;

      const reachedGoal = !isTitle && levelIndex >= goalRoom;
      const inGameplay = !isTitle && (active || reachedGoal);

      return {
        inGameplay,
        playerWorldX: reachedGoal ? this.goalWorldX : playerWorldX,
        playerWorldY,
        cameraX,
        cameraY,
        facingLeft,
        isDead: diedInSameRoom,
        reachedGoal,
        roomId: levelIndex,
      };
    },
  };
}

/**
 * Classic Super Mario Bros. 1 (NROM-256) Exact 6502 RAM Profile:
 * - $0770: OperMode ($00 = Title/Demo, $01 = Game Mode, $02 = Victory, $03 = Game Over)
 * - $0772: OperMode_Task ($03 = GameCoreRoutine; $00..$02 = "WORLD 1-1" black loading screen)
 * - $000E: Player_State ($08 = Controllable, $07 = Intro Pipe Auto-Walk, $0B/$06 = Dying, $04/$05 = Flagpole)
 * - $006D * 256 + $0086: 16-bit Player World X
 * - $00CE: Player Screen Y, $00B5: Player_Y_HighPos
 * - $071A * 256 + $071C: 16-bit ScreenLeft Camera World X
 */
function createSmb1Profile(romId: string, title = 'SUPER MARIO BROS 1-1'): RomProfile {
  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 40,
    goalWorldX: 1600,
    maxPxPerFrame: 5.5,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const operMode = ram[0x0770];
      const operTask = ram[0x0772];
      const playerState = ram[0x000e];
      const coreActive = operMode === 0x01 && operTask === 0x03;
      const onFlagpole = playerState === 0x03 || playerState === 0x04 || playerState === 0x05;
      const controllable =
        playerState === 0x08 ||
        prev.manualSyncUnlocked === true ||
        (prev.hadGameplay &&
          (playerState === 0x09 ||
            playerState === 0x0a ||
            playerState === 0x0c ||
            playerState === 0x02 ||
            onFlagpole));
      const inGameplay = coreActive && controllable;
      const playerWorldX = (ram[0x006d] << 8) | ram[0x0086];
      const playerWorldY = ram[0x00ce];
      const yHigh = ram[0x00b5];
      const cameraX = (ram[0x071a] << 8) | ram[0x071c];
      const facingLeft = ram[0x0033] === 2;

      const isDead =
        prev.hadGameplay &&
        coreActive &&
        (playerState === 0x0b || playerState === 0x06 || (yHigh > 1 && playerWorldY > 224));

      const reachedGoal =
        inGameplay && (onFlagpole || playerWorldX >= this.goalWorldX);

      return {
        inGameplay,
        playerWorldX,
        playerWorldY,
        cameraX,
        facingLeft,
        isDead,
        reachedGoal,
      };
    },
  };
}

/**
 * Super Mario Bros. 3 (MMC3, captainsouthbird/smb3 disassembly) Exact 6502 RAM Profile:
 * - $0011:$00FA: Horz_Scroll_Hi / Horz_Scroll (16-bit Camera X)
 * - $0075:$008F: Player_XHi / Player_X (16-bit World X)
 * - $0086:$00A0 - $0012:$00F9: Player Screen Y
 * - $05EE..$05F0: 3-digit Stage Timer (0,0,0 during Curtain Title Skit & World Overworld Map!)
 * - $00EB: Player_IsDying (0 = alive, nonzero = dying)
 * - $0013: Level_Event / Goal card trigger
 */
function createSmb3Profile(romId: string, title = 'SUPER MARIO BROS 3'): RomProfile {
  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 32,
    goalWorldX: 1560,
    maxPxPerFrame: 6.5,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const cameraX = (ram[0x0011] << 8) | ram[0x00fa];
      const playerWorldX = (ram[0x0075] << 8) | ram[0x008f];
      const rawWorldY = (ram[0x0086] << 8) | ram[0x00a0];
      const rawScrollY = (ram[0x0012] << 8) | ram[0x00f9];
      const playerWorldY = clampScreenY(rawWorldY - rawScrollY);

      const tH = ram[0x05ee];
      const tM = ram[0x05ef];
      const tL = ram[0x05f0];
      const timerDigitsValid =
        tH <= 9 &&
        tM <= 9 &&
        tL <= 9 &&
        tH * 100 + tM * 10 + tL >= (prev.hadGameplay ? 1 : 50);

      const isDying = ram[0x00eb] !== 0;
      const inGameplay = (timerDigitsValid || prev.manualSyncUnlocked === true) && !isDying;
      const facingLeft = (ram[0x00e9] & 0x40) === 0;
      const isDead = prev.hadGameplay && isDying;
      const reachedGoal =
        inGameplay && (ram[0x0013] !== 0 || playerWorldX >= this.goalWorldX);

      return {
        inGameplay,
        playerWorldX,
        playerWorldY,
        cameraX,
        facingLeft,
        isDead,
        reachedGoal,
      };
    },
  };
}

/**
 * Mega Man 2 (MMC1, plasticsmoke/megaman2-disassembly-ca65) Exact 6502 RAM Profile:
 * - $0400: Entity 0 State (>= $02 once Mega Man materializes after "READY" teleport beam-in)
 * - $0440:$0460: Entity 0 (Mega Man) 16-bit Room/World X
 * - $04A0: Entity 0 Screen Y
 * - $001F: Horizontal PPU Scroll Low Byte
 * - $0420: Entity 0 Flags (bit 7 active, bit 6 facing right)
 * - $06C0: Mega Man HP (1..28 alive, 0 dead)
 */
function createMegaMan2Profile(romId: string, title = 'MEGA MAN 2'): RomProfile {
  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 128,
    goalWorldX: 1600,
    maxPxPerFrame: 5.5,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const roomPage = ram[0x0440];
      const subRoomX = ram[0x0460];
      const playerWorldX = (roomPage << 8) | subRoomX;
      const rawY = ram[0x04a0];
      const playerWorldY = clampScreenY(rawY || 176);

      const scrollLo = ram[0x001f];
      const camScreen = Math.max(0, roomPage - (subRoomX < scrollLo ? 1 : 0));
      const cameraX = (camScreen << 8) | scrollLo;

      const entityState = ram[0x0400];
      const flags = ram[0x0420];
      const health = ram[0x06c0];
      const materialized =
        prev.manualSyncUnlocked === true ||
        (entityState >= 0x02 && rawY >= 24 && rawY < 228);
      const inGameplay =
        (flags & 0x80) !== 0 && health > 0 && health <= 28 && materialized;
      const facingLeft = (flags & 0x40) === 0;
      const isDead = prev.hadGameplay && (health === 0 || rawY >= 0xf0);
      const reachedGoal = inGameplay && playerWorldX >= this.goalWorldX;

      return {
        inGameplay,
        playerWorldX,
        playerWorldY,
        cameraX,
        facingLeft,
        isDead,
        reachedGoal,
      };
    },
  };
}

/**
 * Mega Man 1 (UNROM, DataCrystal) Exact 6502 RAM Profile:
 * - $006A: Mega Man HP (1..28 alive, 0 dead)
 * - $0204..$023F: OAM Sprite Cluster for screen X/Y + monotonic scroll tracker
 */
function createMegaMan1Profile(romId: string, title = 'MEGA MAN'): RomProfile {
  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 64,
    goalWorldX: 1400,
    maxPxPerFrame: 5.5,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const health = ram[0x006a];
      let spriteX = prev.oamX || 64;
      let spriteY = 176;
      let spriteTile = prev.oamTile;
      let spriteAttr = 0;
      let found = false;

      for (let off = 0x0204; off < 0x0260; off += 4) {
        const y = ram[off];
        const x = ram[off + 3];
        if (y >= 20 && y < 228 && x > 4 && x < 248) {
          spriteX = x;
          spriteY = y + 16;
          spriteTile = ram[off + 1];
          spriteAttr = ram[off + 2];
          found = true;
          break;
        }
      }

      const landedAfterReady =
        prev.hadGameplay || prev.manualSyncUnlocked === true || spriteY >= 96;
      const inGameplay = found && health > 0 && health <= 28 && landedAfterReady;
      const dx = spriteX - prev.oamX;
      const isFlippedLeft = (spriteAttr & 0x40) !== 0;
      const tileChanged = found && prev.oamTile !== -1 && spriteTile !== prev.oamTile;
      const isAnimating = tileChanged || prev.animHoldFrames > 0;

      let nextCameraX = prev.cameraX;
      if (inGameplay && Math.abs(dx) < 24) {
        if (dx > 0 && spriteX >= 116) {
          nextCameraX = prev.cameraX + dx * 0.72;
        } else if (dx === 0 && spriteX >= 120 && !isFlippedLeft && isAnimating) {
          nextCameraX = prev.cameraX + 1.5;
        }
      }

      const cameraX = Math.round(nextCameraX);
      const playerWorldX = cameraX + spriteX;
      const isDead = prev.hadGameplay && (health === 0 || (found && spriteY >= 234));
      const reachedGoal = inGameplay && playerWorldX >= this.goalWorldX;

      return {
        inGameplay,
        playerWorldX,
        playerWorldY: clampScreenY(spriteY),
        cameraX,
        facingLeft: dx < 0 || (dx === 0 && isFlippedLeft),
        isDead,
        reachedGoal,
        oamTile: spriteTile,
      };
    },
  };
}

/**
 * Contra (US UNROM, vermiceli/nes-contra-us disassembly) Exact 6502 RAM Profile:
 * - $0064:$0065: FRAME_SCROLL (screen page) & H_SCROLL (sub-page pixel offset)
 * - $0334: P1 Screen X, $031A: P1 Screen Y
 * - $0090: P1_STATE ($01 = active alive, $02 = dying/dead; $00 during Title & "STAGE 1" black card)
 */
function createContraProfile(romId: string, title = 'CONTRA'): RomProfile {
  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 48,
    goalWorldX: 1500,
    maxPxPerFrame: 5.0,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const cameraX = (ram[0x0064] << 8) | ram[0x0065];
      const screenX = ram[0x0334];
      const rawScreenY = ram[0x031a];
      const playerWorldX = cameraX + screenX;
      const playerWorldY = clampScreenY(rawScreenY || 160);

      const p1State = ram[0x0090];
      const inGameplay = p1State === 0x01 && rawScreenY >= 20 && rawScreenY < 228;
      const facingLeft = ram[0x00ad] === 1;
      const isDead =
        prev.hadGameplay && (p1State === 0x02 || (p1State !== 0x01 && rawScreenY > 228));
      const reachedGoal = inGameplay && playerWorldX >= this.goalWorldX;

      return {
        inGameplay,
        playerWorldX,
        playerWorldY,
        cameraX,
        facingLeft,
        isDead,
        reachedGoal,
      };
    },
  };
}

/**
 * Castlevania (UNROM, DataCrystal) Exact 6502 RAM Profile:
 * - $0018: System State ($05 = Gameplay; $01 Title, $02 Demo, $03 Castle Gate Intro Story, $04 Stage Load)
 * - $0045: Simon Belmont HP (1..64 alive, 0 dead)
 * - $002E..$002F: 16-bit Little-Endian Camera X
 * - $038C: Simon Screen X, $003F / $0354: Simon Screen Y
 */
function createCastlevaniaProfile(romId: string, title = 'CASTLEVANIA'): RomProfile {
  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 48,
    goalWorldX: 1280,
    maxPxPerFrame: 4.5,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const systemState = ram[0x0018];
      const health = ram[0x0045];
      const cameraX = ram[0x002e] | (ram[0x002f] << 8);
      const screenX = ram[0x038c] || 64;
      const playerWorldX = cameraX + screenX;
      const playerWorldY = clampScreenY(ram[0x003f] || ram[0x0354] || 176);

      const inGameplay = systemState === 0x05 && health > 0 && health <= 64;
      const facingLeft = ram[0x0450] !== 0;
      const isDead =
        prev.hadGameplay &&
        (systemState === 0x06 ||
          systemState === 0x07 ||
          systemState === 0x0e ||
          (systemState === 0x05 && health === 0));
      const reachedGoal = inGameplay && playerWorldX >= this.goalWorldX;

      return {
        inGameplay,
        playerWorldX,
        playerWorldY,
        cameraX,
        facingLeft,
        isDead,
        reachedGoal,
      };
    },
  };
}

/**
 * Ninja Gaiden (MMC1, DataCrystal) Exact 6502 RAM Profile:
 * - $0086: Ryu Hayabusa Screen X, $008A: Ryu Screen Y
 * - $0065: Ryu HP (1..16 alive, 0 dead)
 * - $0063..$0064: Stage Timer (0 during Tecmo Cinema Story Scenes & Title Screen)
 */
function createNinjaGaidenProfile(romId: string, title = 'NINJA GAIDEN'): RomProfile {
  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 48,
    goalWorldX: 1400,
    maxPxPerFrame: 5.5,
    extractTelemetry(ram: Uint8Array, prev: TelemetryTrackerState): TelemetryFrame {
      const screenX = ram[0x0086];
      const screenY = ram[0x008a];
      const health = ram[0x0065];
      const stageTimerActive =
        prev.hadGameplay ||
        prev.manualSyncUnlocked === true ||
        ram[0x0063] > 0 ||
        ram[0x0064] > 0;
      const inGameplay =
        stageTimerActive &&
        health > 0 &&
        health <= 16 &&
        screenX >= 8 &&
        screenX <= 244 &&
        screenY >= 24 &&
        screenY < 224;

      const dx = screenX - prev.oamX;
      let nextCameraX = prev.cameraX;
      if (inGameplay && Math.abs(dx) < 24) {
        if (dx > 0 && screenX >= 112) {
          nextCameraX = prev.cameraX + dx * 0.78;
        } else if (dx === 0 && screenX >= 120) {
          nextCameraX = prev.cameraX + 1.8;
        }
      }

      const cameraX = Math.round(nextCameraX);
      const playerWorldX = cameraX + screenX;
      const isDead = prev.hadGameplay && (health === 0 || screenY >= 232);
      const reachedGoal = inGameplay && playerWorldX >= this.goalWorldX;

      return {
        inGameplay,
        playerWorldX,
        playerWorldY: clampScreenY(screenY || 176),
        cameraX,
        facingLeft: dx < 0,
        isDead,
        reachedGoal,
      };
    },
  };
}

const NES_OAM_CANDIDATE_PAGES = [0x0200, 0x0300, 0x0400, 0x0700] as const;

function detectActiveNesOamPage(ram: Uint8Array): number {
  if (ram.length < 0x800) return 0x0200;
  let bestPage = 0x0200;
  let bestScore = -1;

  for (const page of NES_OAM_CANDIDATE_PAGES) {
    let hiddenSlots = 0;
    let visibleSlots = 0;
    for (let slot = 0; slot < 64; slot++) {
      const off = page + slot * 4;
      const y = ram[off];
      const x = ram[off + 3];
      if (y >= 0xef) {
        hiddenSlots++;
      } else if (y >= 16 && y < 228 && x > 2 && x < 250) {
        visibleSlots++;
      }
    }
    if (visibleSlots >= 1 && hiddenSlots >= 8) {
      const score = hiddenSlots + Math.min(16, visibleSlots * 2) + (page === 0x0200 ? 10 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestPage = page;
      }
    }
  }

  return bestPage;
}

/**
 * Evaluates WRAM page stability (detecting bulk DMA / level-load wipes) and pre-gameplay
 * Title/Story gating for universal multi-console cartridges without a bespoke RAM map.
 */
function evaluateWramLoadingAndPregameSync(
  ram: Uint8Array,
  prev: TelemetryTrackerState,
  liveInputMask: number
): boolean {
  if (ram.length >= 64) {
    const sampleLen = 64;
    const step = Math.max(1, Math.floor(ram.length / sampleLen));
    let sample = prev.wramSample;
    let changedCount = 0;
    if (!sample || sample.length !== sampleLen) {
      sample = new Uint8Array(sampleLen);
      for (let i = 0; i < sampleLen; i++) {
        sample[i] = ram[i * step];
      }
      prev.wramSample = sample;
      changedCount = sampleLen;
    } else {
      for (let i = 0; i < sampleLen; i++) {
        const v = ram[i * step];
        if (sample[i] !== v) {
          changedCount++;
          sample[i] = v;
        }
      }
    }
    // Bulk WRAM rewrite (>= 22 of 64 distributed pages) indicates cold boot, screen wipe, or level decompression
    if (changedCount >= 22) {
      prev.wramStableFrames = 0;
    } else {
      prev.wramStableFrames = (prev.wramStableFrames ?? 0) + 1;
    }
  } else {
    prev.wramStableFrames = (prev.wramStableFrames ?? 0) + 1;
  }

  const stableFrames = prev.wramStableFrames ?? 0;

  if (prev.manualSyncUnlocked) {
    return ram.length < 64 || stableFrames >= 2;
  }

  if (prev.hadGameplay) {
    return ram.length < 64 || stableFrames >= 2;
  }

  prev.preGameFrames = (prev.preGameFrames ?? 0) + 1;
  if ((liveInputMask & NES_INPUT_START) !== 0) {
    prev.startPressedInPregame = true;
    prev.causalMoveFrames = 0;
    return false;
  }
  if ((liveInputMask & NES_INPUT_SELECT) !== 0 || stableFrames < 16) {
    prev.causalMoveFrames = 0;
    return false;
  }

  const readyPastTitle = Boolean(prev.startPressedInPregame) || (prev.preGameFrames ?? 0) >= 180;
  const holdingMove = (liveInputMask & (NES_INPUT_RIGHT | NES_INPUT_LEFT)) !== 0;
  if (readyPastTitle && holdingMove) {
    prev.causalMoveFrames = (prev.causalMoveFrames ?? 0) + 1;
    return (prev.causalMoveFrames ?? 0) >= 6;
  }

  return false;
}

/**
 * Universal NES OAM Shadow ($0200/$0300/$0400/$0700) + Causal-Gameplay Synchronization Profile:
 * Auto-detects the active PPU OAM DMA shadow page, holds `inGameplay: false` across blank loading
 * interstitials, static title menus, and autonomous story cutscenes, and locks onto gameplay the
 * moment causal player-driven sprite motion (or an explicit checkpoint/manual sync) occurs.
 */
function createUniversalNesProfile(romId: string, rawName: string): RomProfile {
  const cleanTitle = cleanCartTitle(rawName, 'CUSTOM NES CART');

  return {
    romId,
    consoleSystem: 'nes',
    sprintId: romId,
    title: cleanTitle,
    stageLabel: cleanTitle,
    profileKind: 'universal-oam',
    startWorldX: 48,
    goalWorldX: 1280,
    maxPxPerFrame: 6.5,
    extractTelemetry(
      ram: Uint8Array,
      prev: TelemetryTrackerState,
      liveInputMask = 0
    ): TelemetryFrame {
      if (ram.length < 0x300) {
        return advanceKinematicFallback(
          prev,
          this.startWorldX,
          this.goalWorldX,
          liveInputMask,
          2.5,
          ram
        );
      }

      const oamBase = detectActiveNesOamPage(ram);
      const activeGameplay = prev.hadGameplay || Boolean(prev.manualSyncUnlocked);
      // Track player sprite cluster across OAM slots (skipping sprite 0 HUD hit).
      // Once gameplay is active, prefer the visible sprite closest to the previous frame's position
      // so OAM flicker/multiplexing never teleports playerWorldX.
      let spriteX = prev.oamX || this.startWorldX;
      let spriteY = prev.oamY || 176;
      let spriteTile = prev.oamTile;
      let spriteAttr = 0;
      let found = false;
      let bestCost = Number.POSITIVE_INFINITY;

      for (let off = oamBase + 4; off < oamBase + 0x90; off += 4) {
        const y = ram[off];
        const x = ram[off + 3];
        if (y >= 20 && y < 228 && x > 4 && x < 248) {
          if (!activeGameplay || prev.oamX <= 0) {
            spriteX = x;
            spriteY = y + 16;
            spriteTile = ram[off + 1];
            spriteAttr = ram[off + 2];
            found = true;
            break;
          }
          const slotIndex = (off - (oamBase + 4)) >> 2;
          const cost =
            Math.abs(x - prev.oamX) +
            Math.abs(y + 16 - (prev.oamY || 176)) * 0.5 +
            slotIndex * 1.5;
          if (cost < bestCost) {
            bestCost = cost;
            spriteX = x;
            spriteY = y + 16;
            spriteTile = ram[off + 1];
            spriteAttr = ram[off + 2];
            found = true;
          }
        }
      }

      if (!found) {
        prev.missingSpriteFrames = (prev.missingSpriteFrames ?? 0) + 1;
        prev.causalMoveFrames = 0;
        const heldWorldX = activeGameplay
          ? prev.cameraX + (prev.oamX || this.startWorldX)
          : this.startWorldX;
        return {
          inGameplay: activeGameplay,
          playerWorldX: heldWorldX,
          playerWorldY: clampScreenY(prev.oamY || 176),
          cameraX: activeGameplay ? prev.cameraX : 0,
          facingLeft: false,
          isDead: false,
          reachedGoal: activeGameplay && heldWorldX >= this.goalWorldX,
        };
      }

      prev.missingSpriteFrames = 0;
      const rawDx = prev.oamTile === -1 ? 0 : spriteX - prev.oamX;
      const rawDy = prev.oamY === undefined ? 0 : spriteY - prev.oamY;
      const isFlippedLeft = (spriteAttr & 0x40) !== 0;
      const tileChanged = prev.oamTile !== -1 && spriteTile !== prev.oamTile;
      const holdingRight = (liveInputMask & NES_INPUT_RIGHT) !== 0;
      const holdingLeft = (liveInputMask & NES_INPUT_LEFT) !== 0;
      const holdingJump = (liveInputMask & NES_INPUT_A) !== 0;
      const holdingClimbOrJump = (liveInputMask & NES_INPUT_UP) !== 0 || holdingJump;

      let inGameplay = prev.hadGameplay || Boolean(prev.manualSyncUnlocked);
      if (!inGameplay) {
        prev.preGameFrames = (prev.preGameFrames ?? 0) + 1;
        if ((liveInputMask & NES_INPUT_START) !== 0) {
          prev.startPressedInPregame = true;
        }
        const startOrSelect =
          (liveInputMask & (NES_INPUT_START | NES_INPUT_SELECT)) !== 0;
        const controlHeld =
          (liveInputMask & (NES_INPUT_LEFT | NES_INPUT_RIGHT | NES_INPUT_A | NES_INPUT_B)) !== 0;

        if (startOrSelect) {
          prev.causalMoveFrames = 0;
        } else if (!controlHeld) {
          // Autonomous sprite movement without player input = attract demo or story cutscene
          if (Math.abs(rawDx) >= 1 || Math.abs(rawDy) >= 2) {
            prev.causalMoveFrames = 0;
          }
        } else {
          const causalRight =
            holdingRight &&
            !holdingLeft &&
            ((rawDx > 0 && rawDx <= 8) ||
              (rawDx === 0 && tileChanged && spriteX >= 104 && spriteX <= 168 && spriteY >= 144));
          const causalLeft =
            holdingLeft &&
            !holdingRight &&
            ((rawDx < 0 && rawDx >= -8) ||
              (rawDx === 0 && tileChanged && spriteX >= 72 && spriteX <= 152 && spriteY >= 144));
          const causalVert = holdingJump && rawDy < -1 && rawDy >= -14;

          if (causalRight || causalLeft || causalVert) {
            prev.causalMoveFrames = (prev.causalMoveFrames ?? 0) + 1;
          } else if ((rawDx < -1 && holdingRight) || (rawDx > 1 && holdingLeft)) {
            prev.causalMoveFrames = 0;
          }
        }

        if ((prev.causalMoveFrames ?? 0) >= 3) {
          inGameplay = true;
        } else {
          prev.oamX = spriteX;
          prev.oamY = spriteY;
          prev.oamTile = spriteTile;
          return {
            inGameplay: false,
            playerWorldX: spriteX,
            playerWorldY: clampScreenY(spriteY),
            cameraX: 0,
            facingLeft: isFlippedLeft,
            isDead: false,
            reachedGoal: false,
            oamTile: spriteTile,
          };
        }
      }

      prev.oamY = spriteY;
      const dx = prev.hadGameplay ? spriteX - prev.oamX : 0;
      const isAnimatingWalk = tileChanged || prev.animHoldFrames > 0;

      // Stage 16: Online Causal RAM-Entropy Auto-Discovery ("Zero-Shot Memory Scanner")
      if (!prev.ramScanner) {
        prev.ramScanner = createCausalRamScannerState();
      }
      const discovered = scanCausalRamRegisters(
        ram,
        prev.ramScanner,
        liveInputMask,
        oamBase,
        spriteX,
        rawDx
      );

      // Advance camera scroll using discovered hardware scroll register when available, or OAM kinematics fallback
      let nextCameraX = prev.cameraX;
      if (
        discovered.hardwareScrollDelta !== null &&
        discovered.scrollConfidence >= 6 &&
        discovered.hardwareScrollDelta !== 0
      ) {
        nextCameraX = Math.max(0, prev.cameraX + discovered.hardwareScrollDelta);
      } else if (Math.abs(dx) < 28) {
        if (dx > 0 && spriteX >= 96) {
          nextCameraX = prev.cameraX + dx * 0.72;
        } else if (holdingRight && !holdingLeft && spriteX >= 88) {
          nextCameraX = prev.cameraX + ((liveInputMask & NES_INPUT_B) !== 0 ? 2.1 : 1.55);
        } else if (dx === 0 && spriteX >= 112 && !isFlippedLeft && isAnimatingWalk) {
          nextCameraX = prev.cameraX + 1.45;
        } else if (holdingClimbOrJump && !holdingRight && !holdingLeft && spriteY <= 116) {
          // Vertical tower / ladder climb games (e.g. Micro Mages, Ice Climber)
          nextCameraX = prev.cameraX + 1.1;
        }
      }

      const cameraX = Math.round(nextCameraX);
      const playerWorldX = cameraX + spriteX;
      const isDead = false;
      const reachedGoal = inGameplay && playerWorldX >= this.goalWorldX;

      return {
        inGameplay: true,
        playerWorldX,
        playerWorldY: clampScreenY(spriteY),
        cameraX,
        facingLeft: holdingLeft ? true : holdingRight ? false : dx < 0 || (dx === 0 && isFlippedLeft),
        isDead,
        reachedGoal,
        oamTile: spriteTile,
      };
    },
  };
}

/**
 * Universal Multi-Console Sprint Kinematics Fallback (`snes9x`, `genesis_plus_gx`, `gambatte`, `mgba`):
 * Synchronizes against WRAM loading wipes & pre-game Title/Story screens so ghosts and timers
 * never advance before gameplay begins.
 */
const EMPTY_FALLBACK_RAM = new Uint8Array(0);

function advanceKinematicFallback(
  prev: TelemetryTrackerState,
  startWorldX: number,
  goalWorldX: number,
  liveInputMask = 0,
  runSpeedPx = 2.6,
  ram: Uint8Array = EMPTY_FALLBACK_RAM
): TelemetryFrame {
  const inGameplay = evaluateWramLoadingAndPregameSync(ram, prev, liveInputMask);
  const baseCamX = prev.hadGameplay ? prev.cameraX : 0;
  const baseScreenX = prev.hadGameplay ? prev.oamX || startWorldX : startWorldX;
  const prevWorldX = baseCamX + baseScreenX;

  const movingRight = (liveInputMask & NES_INPUT_RIGHT) !== 0;
  const movingLeft = (liveInputMask & NES_INPUT_LEFT) !== 0;
  const boost = (liveInputMask & NES_INPUT_B) !== 0 ? 1.32 : 1.0;
  const jumping = (liveInputMask & NES_INPUT_A) !== 0;

  let dx = 0;
  if (inGameplay) {
    if (movingRight && !movingLeft) dx = runSpeedPx * boost;
    else if (movingLeft && !movingRight) dx = -runSpeedPx * 0.85;
  }

  const playerWorldX = Math.max(0, Math.round(prevWorldX + dx));
  const cameraX = inGameplay
    ? Math.max(prev.cameraX, Math.max(0, playerWorldX - 116))
    : prev.hadGameplay
      ? prev.cameraX
      : 0;
  const playerWorldY = inGameplay && jumping ? 148 : 182;

  return {
    inGameplay,
    playerWorldX,
    playerWorldY,
    cameraX,
    facingLeft: inGameplay && movingLeft && !movingRight,
    isDead: false,
    reachedGoal: inGameplay && playerWorldX >= goalWorldX,
  };
}

/**
 * Super Mario World (SNES, `snes9x` 128KB WRAM `$7E0000`–`$7FFFFF`) Exact RAM Profile:
 * - `$7E0094..$7E0095`: 16-bit Player World X (LE)
 * - `$7E0096..$7E0097`: 16-bit Player World Y (LE)
 * - `$7E001A..$7E001B`: 16-bit Layer 1 Camera X (LE)
 * - `$7E001C..$7E001D`: 16-bit Layer 1 Camera Y (LE)
 * - `$7E0071`: Player Animation State (`$09` = Dying)
 * - `$7E009D`: Sprites Locked Flag (nonzero during intro/cutscene freeze)
 * - `$7E0100`: Game Mode (`$14` = Active Level Gameplay; `$00..$13` = Title, Map & "MARIO START!" Load)
 * - `$7E1426`: Story / Intro Message Box Trigger (nonzero during "Welcome to Dinosaur Land!")
 * - `$7E1493`: End-Level Goal Tape Timer (`> 0` = Crossed Goal!)
 */
function createSuperMarioWorldProfile(
  romId: string,
  title = 'SUPER MARIO WORLD'
): RomProfile {
  return {
    romId,
    consoleSystem: 'snes',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 32,
    goalWorldX: 1800,
    maxPxPerFrame: 7.5,
    extractTelemetry(
      ram: Uint8Array,
      prev: TelemetryTrackerState,
      liveInputMask = 0
    ): TelemetryFrame {
      if (ram.length < 0x2000) {
        return advanceKinematicFallback(
          prev,
          this.startWorldX,
          this.goalWorldX,
          liveInputMask,
          3.0,
          ram
        );
      }
      const gameMode = ram[0x0100];
      const animTrigger = ram[0x0071];
      const goalTimer = ram[0x1493];
      const playerWorldX = ram[0x0094] | (ram[0x0095] << 8);
      const rawWorldY = ram[0x0096] | (ram[0x0097] << 8);
      const cameraX = ram[0x001a] | (ram[0x001b] << 8);
      const cameraY = ram[0x001c] | (ram[0x001d] << 8);
      const screenY = clampScreenY(rawWorldY - cameraY + 32);

      const isDying = animTrigger === 0x09;
      const isInitialStoryOrLock =
        !prev.hadGameplay &&
        !prev.manualSyncUnlocked &&
        (ram[0x1426] !== 0 || ram[0x009d] !== 0);
      const inGameplay = gameMode === 0x14 && !isDying && !isInitialStoryOrLock;
      const isDead = prev.hadGameplay && isDying;
      const facingLeft = ram[0x0076] === 0;
      const reachedGoal = inGameplay && (goalTimer > 0 || playerWorldX >= this.goalWorldX);

      return {
        inGameplay,
        playerWorldX,
        playerWorldY: screenY,
        cameraX,
        facingLeft,
        isDead,
        reachedGoal,
      };
    },
  };
}

/**
 * Sonic the Hedgehog 1/2 (Sega Genesis, `genesis_plus_gx` 64KB 68000 WRAM) Profile:
 * Checks 68k `v_gamemode` (`$FFF600`: `$00` SEGA, `$04` Title, `$08` Demo, `$8C` Title-Card Load, `$0C` Level)
 * across both word-swapped LE and big-endian WRAM layouts so SEGA logo, Title Demo, and "ACT 1" loading
 * cards never trigger premature sprite/timer starts.
 */
function createSonicGenesisProfile(
  romId: string,
  title = 'SONIC THE HEDGEHOG'
): RomProfile {
  return {
    romId,
    consoleSystem: 'genesis',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 64,
    goalWorldX: 2200,
    maxPxPerFrame: 12.0,
    extractTelemetry(
      ram: Uint8Array,
      prev: TelemetryTrackerState,
      liveInputMask = 0
    ): TelemetryFrame {
      if (ram.length >= 0x10000) {
        const rawGm = ram[0xf600] || ram[0xf601];
        const gmBase = rawGm & 0x7f;
        const isTitleCardLoading =
          !prev.hadGameplay && !prev.manualSyncUnlocked && (rawGm & 0x80) !== 0;

        // Check little-endian word-swapped 68k WRAM ($D008 -> hi @ $D009, lo @ $D008) & big-endian
        const pxSwapped = (ram[0xd009] << 8) | ram[0xd008];
        const camSwapped = (ram[0xf701] << 8) | ram[0xf700];
        const pxBig = (ram[0xd008] << 8) | ram[0xd009];
        const camBig = (ram[0xf700] << 8) | ram[0xf701];

        const useSwapped =
          pxSwapped >= 16 && pxSwapped < 32_768 && Math.abs(pxSwapped - camSwapped) < 380;
        const useBig =
          !useSwapped && pxBig >= 16 && pxBig < 32_768 && Math.abs(pxBig - camBig) < 380;

        if (gmBase === 0x0c && (useSwapped || useBig)) {
          const px = useSwapped ? pxSwapped : pxBig;
          const camX = useSwapped ? camSwapped : camBig;
          const py = useSwapped
            ? (ram[0xd00d] << 8) | ram[0xd00c]
            : (ram[0xd00c] << 8) | ram[0xd00d];
          const camY = useSwapped
            ? (ram[0xf705] << 8) | ram[0xf704]
            : (ram[0xf704] << 8) | ram[0xf705];
          const routine = ram[0xd024] || ram[0xd025];
          const isDying = routine === 0x06 || routine === 0x08;
          const readyRoutine =
            prev.hadGameplay ||
            Boolean(prev.manualSyncUnlocked) ||
            routine === 0x02 ||
            routine === 0x04;
          const inGameplay = !isTitleCardLoading && readyRoutine && !isDying && px > 0;
          const statusByte = ram[0xd022] || ram[0xd023];
          return {
            inGameplay,
            playerWorldX: px,
            playerWorldY: clampScreenY(py - camY + 20),
            cameraX: Math.max(0, camX),
            facingLeft: (statusByte & 0x01) !== 0,
            isDead: prev.hadGameplay && isDying,
            reachedGoal: inGameplay && px >= this.goalWorldX,
          };
        }

        // Explicitly hold `inGameplay: false` during SEGA Splash ($00), Title ($04), Demo ($08), & Title Card ($8C)
        if (
          !prev.manualSyncUnlocked &&
          (gmBase === 0x00 || gmBase === 0x04 || gmBase === 0x08 || isTitleCardLoading)
        ) {
          return {
            inGameplay: false,
            playerWorldX: this.startWorldX,
            playerWorldY: 176,
            cameraX: 0,
            facingLeft: false,
            isDead: false,
            reachedGoal: false,
          };
        }
      }
      return advanceKinematicFallback(
        prev,
        this.startWorldX,
        this.goalWorldX,
        liveInputMask,
        3.8,
        ram
      );
    },
  };
}

/**
 * Super Mario Land (Game Boy, `gambatte` 8KB WRAM `$C000`–`$DFFF`) Profile:
 */
function createSuperMarioLandGbProfile(
  romId: string,
  title = 'SUPER MARIO LAND'
): RomProfile {
  return {
    romId,
    consoleSystem: 'gb',
    sprintId: romId,
    title,
    stageLabel: title,
    profileKind: 'exact-ram',
    startWorldX: 40,
    goalWorldX: 1400,
    maxPxPerFrame: 5.5,
    extractTelemetry(
      ram: Uint8Array,
      prev: TelemetryTrackerState,
      liveInputMask = 0
    ): TelemetryFrame {
      if (ram.length >= 0x1000) {
        const screenY = ram[0x0201];
        const screenX = ram[0x0202];
        if (screenX > 4 && screenX < 168 && screenY > 16 && screenY < 156) {
          const rawDx = prev.oamTile === -1 ? 0 : screenX - prev.oamX;
          let inGameplay = prev.hadGameplay || Boolean(prev.manualSyncUnlocked);
          if (!inGameplay) {
            const startOrSelect =
              (liveInputMask & (NES_INPUT_START | NES_INPUT_SELECT)) !== 0;
            const holdingRight = (liveInputMask & NES_INPUT_RIGHT) !== 0;
            const holdingLeft = (liveInputMask & NES_INPUT_LEFT) !== 0;
            if (startOrSelect) {
              prev.causalMoveFrames = 0;
            } else if (
              (holdingRight && !holdingLeft && rawDx > 0 && rawDx <= 6) ||
              (holdingLeft && !holdingRight && rawDx < 0 && rawDx >= -6)
            ) {
              prev.causalMoveFrames = (prev.causalMoveFrames ?? 0) + 1;
            } else if (liveInputMask === 0 && Math.abs(rawDx) > 0) {
              prev.causalMoveFrames = 0;
            }
            if ((prev.causalMoveFrames ?? 0) >= 3) {
              inGameplay = true;
            } else {
              prev.oamX = screenX;
              prev.oamTile = 1;
              return {
                inGameplay: false,
                playerWorldX: Math.round(screenX * 1.5),
                playerWorldY: clampScreenY(Math.round(screenY * 1.45)),
                cameraX: 0,
                facingLeft: false,
                isDead: false,
                reachedGoal: false,
              };
            }
          }

          const dx = prev.hadGameplay ? screenX - prev.oamX : 0;
          let nextCam = prev.cameraX;
          if (
            Math.abs(dx) < 20 &&
            (dx > 0 || ((liveInputMask & NES_INPUT_RIGHT) !== 0 && screenX >= 72))
          ) {
            nextCam += Math.max(1.2, dx);
          }
          const cameraX = Math.round(nextCam);
          const playerWorldX = cameraX + Math.round(screenX * 1.5);
          return {
            inGameplay: true,
            playerWorldX,
            playerWorldY: clampScreenY(Math.round(screenY * 1.45)),
            cameraX,
            facingLeft: dx < 0,
            isDead: prev.hadGameplay && screenY >= 152,
            reachedGoal: playerWorldX >= this.goalWorldX,
          };
        }
        if (prev.hadGameplay) {
          prev.missingSpriteFrames = (prev.missingSpriteFrames ?? 0) + 1;
          if ((prev.missingSpriteFrames ?? 0) > 4) {
            return {
              inGameplay: false,
              playerWorldX: prev.cameraX + Math.round((prev.oamX || 40) * 1.5),
              playerWorldY: 176,
              cameraX: prev.cameraX,
              facingLeft: false,
              isDead: false,
              reachedGoal: false,
            };
          }
        }
      }
      return advanceKinematicFallback(
        prev,
        this.startWorldX,
        this.goalWorldX,
        liveInputMask,
        2.5,
        ram
      );
    },
  };
}

function createUniversalMultiConsoleProfile(
  romId: string,
  consoleSystem: Exclude<ConsoleSystemId, 'nes'>,
  rawName: string
): RomProfile {
  const sysLabel = CONSOLE_SYSTEM_LABELS[consoleSystem];
  const cleanTitle = cleanCartTitle(rawName, `CUSTOM ${sysLabel} CART`);

  return {
    romId,
    consoleSystem,
    sprintId: romId,
    title: cleanTitle,
    stageLabel: `${sysLabel} • ${cleanTitle}`.slice(0, 26),
    profileKind: 'universal-oam',
    startWorldX: 48,
    goalWorldX: 1400,
    maxPxPerFrame: consoleSystem === 'genesis' ? 9.5 : 7.5,
    extractTelemetry(
      ram: Uint8Array,
      prev: TelemetryTrackerState,
      liveInputMask = 0
    ): TelemetryFrame {
      return advanceKinematicFallback(
        prev,
        this.startWorldX,
        this.goalWorldX,
        liveInputMask,
        2.8,
        ram
      );
    },
  };
}

export function resolveRomProfile(
  romId: string,
  fileName: string,
  romBytes?: Uint8Array,
  consoleHint?: ConsoleSystemId
): RomProfile {
  const detectedSystem =
    consoleHint || detectRomConsoleSystem(fileName, romBytes) || 'nes';

  if (detectedSystem === 'snes') {
    if (/super\s*mario\s*world|\bsmw\b/i.test(fileName)) {
      return createSuperMarioWorldProfile(romId, cleanCartTitle(fileName, 'SUPER MARIO WORLD'));
    }
    return createUniversalMultiConsoleProfile(romId, 'snes', fileName);
  }

  if (detectedSystem === 'genesis') {
    if (/\bsonic\b/i.test(fileName)) {
      return createSonicGenesisProfile(romId, cleanCartTitle(fileName, 'SONIC THE HEDGEHOG'));
    }
    return createUniversalMultiConsoleProfile(romId, 'genesis', fileName);
  }

  if (detectedSystem === 'gb') {
    if (/mario\s*land/i.test(fileName)) {
      return createSuperMarioLandGbProfile(romId, cleanCartTitle(fileName, 'SUPER MARIO LAND'));
    }
    return createUniversalMultiConsoleProfile(romId, 'gb', fileName);
  }

  if (detectedSystem === 'gba') {
    if (romId === CELESTE_GBA_ROM_ID || /celeste/i.test(fileName)) {
      return createCelesteGbaCourseProfile({ romIdOverride: romId });
    }
    return createUniversalMultiConsoleProfile(romId, 'gba', fileName);
  }

  if (romId === CELESTE_ROM_ID) {
    return DEFAULT_PROFILE;
  }

  if (/\bceleste\b/i.test(fileName)) {
    const customTitle = cleanCartTitle(fileName, 'CELESTE');
    return {
      ...DEFAULT_PROFILE,
      romId,
      sprintId: romId,
      title: customTitle,
      stageLabel: customTitle,
    };
  }

  if (romId === TWIN_DRAGONS_ROM_ID || /twin\s*dragons|twindragons/i.test(fileName)) {
    return createTwinDragonsProfile(romId, cleanCartTitle(fileName, 'TWIN DRAGONS'));
  }

  if (romId === NOVA_ROM_ID || /\bnova\b/i.test(fileName)) {
    return createNovaProfile(romId, cleanCartTitle(fileName, 'NOVA THE SQUIRREL'));
  }

  const label = cleanCartTitle(fileName, 'CUSTOM NES CART');

  if (/mario\s*bros\.?\s*3|\bsmb\s*3\b/i.test(fileName)) {
    return createSmb3Profile(romId, cleanCartTitle(fileName, 'SUPER MARIO BROS 3'));
  }

  const isSmb1Name = /mario\s*bros/i.test(fileName) && !/mario\s*bros\.?\s*[23]/i.test(fileName);
  const isNrom32k =
    romBytes &&
    romBytes.length >= 16 &&
    romBytes[0] === 0x4e &&
    romBytes[4] === 2 &&
    romBytes[5] === 1 &&
    (romBytes[6] >> 4) === 0;

  if (isSmb1Name || (isNrom32k && /smb|mario/i.test(fileName))) {
    return createSmb1Profile(romId, cleanCartTitle(fileName, 'SUPER MARIO BROS 1-1'));
  }

  if (/mega\s*man\s*2|\bmm\s*2\b|rock\s*man\s*2/i.test(fileName)) {
    return createMegaMan2Profile(romId, cleanCartTitle(fileName, 'MEGA MAN 2'));
  }

  if (
    /mega\s*man|\bmm\s*1\b|rock\s*man/i.test(fileName) &&
    !/mega\s*man\s*[2-6]|rock\s*man\s*[2-6]/i.test(fileName)
  ) {
    return createMegaMan1Profile(romId, cleanCartTitle(fileName, 'MEGA MAN'));
  }

  if (/\bcontra\b|probotector/i.test(fileName)) {
    return createContraProfile(romId, cleanCartTitle(fileName, 'CONTRA'));
  }

  if (/castlevania|akumajou/i.test(fileName)) {
    return createCastlevaniaProfile(romId, cleanCartTitle(fileName, 'CASTLEVANIA'));
  }

  if (/ninja\s*gaiden|ryukenden/i.test(fileName)) {
    return createNinjaGaidenProfile(romId, cleanCartTitle(fileName, 'NINJA GAIDEN'));
  }

  return createUniversalNesProfile(romId, label);
}
