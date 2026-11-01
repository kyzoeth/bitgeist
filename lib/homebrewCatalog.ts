import type { ConsoleSystemId } from './types';

export const CELESTE_NES_ROM_ID = '4cd56ce8fdd4b921684fe56bdcc3bec0db33d6b3';
export const NOVA_NES_ROM_ID = 'b6b07ee76492ed475f39167c89b342353f999231';
export const CELESTE_GBA_ROM_ID = '08512605e5c02e81a72e24c2c8d4959d8e84e1f4';

export type BuiltinCartridgeKey = 'celeste-nes' | 'nova-nes' | 'celeste-gba';

export interface HomebrewSegmentSpec {
  courseIndex: number;
  code: string;
  name: string;
  stageLabel: string;
  sprintId: string;
  previewSrc: string;
  startWorldX: number;
  goalWorldX: number;
  /** Nova NES Zero-Page LevelNumber ($A7/$A8) or Celeste GBA start room index (0..29) */
  startWarp: number;
  /** Optional goal room index (e.g. Celeste GBA 3-room climb finish room) */
  goalRoomIndex?: number;
  finishDeltaY?: number;
}

export interface HomebrewCartridgeSpec {
  key: BuiltinCartridgeKey;
  romId: string;
  consoleSystem: ConsoleSystemId;
  shortTitle: string;
  fullTitle: string;
  systemBadge: string;
  accentBg: string;
  romUrl: string;
  fileName: string;
  licenseUrl: string;
  authorCredit: string;
  segments: readonly HomebrewSegmentSpec[];
}

export const NOVA_SPRINT_SEGMENTS: readonly HomebrewSegmentSpec[] = [
  {
    courseIndex: 0,
    code: '1-1',
    name: 'GREEN HILL',
    stageLabel: 'NOVA 1-1 • GREEN HILL',
    sprintId: NOVA_NES_ROM_ID,
    previewSrc: '/previews/nova-1-1.png',
    startWorldX: 52,
    goalWorldX: 1184,
    startWarp: 0,
  },
  {
    courseIndex: 1,
    code: '1-6',
    name: 'AUTUMN WOODS',
    stageLabel: 'NOVA 1-6 • AUTUMN WOODS',
    sprintId: `${NOVA_NES_ROM_ID}:c1`,
    previewSrc: '/previews/nova-1-6.png',
    startWorldX: 36,
    goalWorldX: 1120,
    startWarp: 5,
  },
  {
    courseIndex: 2,
    code: '2-1',
    name: 'GLASS CITADEL',
    stageLabel: 'NOVA 2-1 • GLASS CITADEL',
    sprintId: `${NOVA_NES_ROM_ID}:c2`,
    previewSrc: '/previews/nova-2-1.png',
    startWorldX: 36,
    goalWorldX: 1160,
    startWarp: 8,
  },
  {
    courseIndex: 3,
    code: '3-2',
    name: 'FROST RIDGE',
    stageLabel: 'NOVA 3-2 • FROST RIDGE',
    sprintId: `${NOVA_NES_ROM_ID}:c3`,
    previewSrc: '/previews/nova-3-2.png',
    startWorldX: 36,
    goalWorldX: 1140,
    startWarp: 17,
  },
];

export const CELESTE_GBA_SPRINT_SEGMENTS: readonly HomebrewSegmentSpec[] = [
  {
    courseIndex: 0,
    code: '100M',
    name: 'FOOTHILLS',
    stageLabel: 'GBA 100M • FOOTHILLS',
    sprintId: CELESTE_GBA_ROM_ID,
    previewSrc: '/previews/celeste-gba-100m.png',
    startWorldX: 68,
    goalWorldX: 836,
    startWarp: 0,
    goalRoomIndex: 3,
    finishDeltaY: -720,
  },
  {
    courseIndex: 1,
    code: '400M',
    name: 'ICE CLIFFS',
    stageLabel: 'GBA 400M • ICE CLIFFS',
    sprintId: `${CELESTE_GBA_ROM_ID}:c1`,
    previewSrc: '/previews/celeste-gba-400m.png',
    startWorldX: 68,
    goalWorldX: 836,
    startWarp: 3,
    goalRoomIndex: 6,
    finishDeltaY: -720,
  },
  {
    courseIndex: 2,
    code: '1200M',
    name: 'WINDY RUINS',
    stageLabel: 'GBA 1200M • WINDY RUINS',
    sprintId: `${CELESTE_GBA_ROM_ID}:c2`,
    previewSrc: '/previews/celeste-gba-1200m.png',
    startWorldX: 68,
    goalWorldX: 836,
    startWarp: 11,
    goalRoomIndex: 14,
    finishDeltaY: -720,
  },
  {
    courseIndex: 3,
    code: '1900M',
    name: 'ALPINE RIDGE',
    stageLabel: 'GBA 1900M • ALPINE RIDGE',
    sprintId: `${CELESTE_GBA_ROM_ID}:c3`,
    previewSrc: '/previews/celeste-gba-1900m.png',
    startWorldX: 68,
    goalWorldX: 836,
    startWarp: 18,
    goalRoomIndex: 21,
    finishDeltaY: -720,
  },
];

export const CELESTE_NES_PREVIEW_BY_CODE: Readonly<Record<string, string>> = {
  '1-A': '/previews/celeste-1a.png',
  '1-B': '/previews/celeste-1b.png',
  '1-C': '/previews/celeste-1c.png',
  '2-A': '/previews/celeste-2a.png',
  '2-B': '/previews/celeste-2b.png',
  '0-1': '/previews/celeste-01.png',
};

export const HOMEBREW_CARTRIDGES: readonly HomebrewCartridgeSpec[] = [
  {
    key: 'celeste-nes',
    romId: CELESTE_NES_ROM_ID,
    consoleSystem: 'nes',
    shortTitle: 'CELESTE',
    fullTitle: 'CelesteNES (8-Bit Demake)',
    systemBadge: 'NES',
    accentBg: '#F2545B',
    romUrl: '/roms/celeste.nes',
    fileName: 'celeste.nes',
    licenseUrl: '/roms/LICENSE-CELESTENES.txt',
    authorCredit: 'CelesteNES by iProgramInCpp (MIT) • Celeste © EXOK',
    segments: [], // Populated dynamically from CELESTE_SPRINT_COURSES + Daily Sprint
  },
];

export function findBuiltinCartridgeByRomId(romId: string): HomebrewCartridgeSpec | undefined {
  return HOMEBREW_CARTRIDGES.find((c) => c.romId === romId);
}
