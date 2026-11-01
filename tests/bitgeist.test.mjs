import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tryResolveCandidateFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mjs`,
    `${basePath}.js`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.js'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return pathToFileURL(candidate).href;
      }
    } catch {
      // continue checking candidates
    }
  }
  return null;
}

// Enable seamless extensionless TypeScript & @/* alias resolution under Node 24 --experimental-strip-types
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'next/server') {
      return nextResolve('next/server.js', context);
    }

    if (specifier.startsWith('@/')) {
      const target = path.join(PROJECT_ROOT, specifier.slice(2));
      const found = tryResolveCandidateFile(target);
      if (found) {
        return { url: found, shortCircuit: true };
      }
    }

    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      context.parentURL?.startsWith('file://') &&
      !path.extname(specifier)
    ) {
      const parentDir = path.dirname(fileURLToPath(context.parentURL));
      const target = path.resolve(parentDir, specifier);
      const found = tryResolveCandidateFile(target);
      if (found) {
        return { url: found, shortCircuit: true };
      }
    }

    return nextResolve(specifier, context);
  },
});

const tempTestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bitgeist-test-'));
process.env.BITGEIST_DB_PATH = path.join(tempTestDir, 'bitgeist-test.sqlite');
process.env.BITGEIST_IDENTITY_SECRET =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// Copy pre-warmed canonical Celeste 1-A state if present so headless WASM test runs in <100ms
const repoCanonicalState = path.join(
  PROJECT_ROOT,
  'data',
  'canonical-states',
  'celeste_v2_c0.state'
);
if (fs.existsSync(repoCanonicalState)) {
  const destDir = path.join(tempTestDir, 'canonical-states');
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(repoCanonicalState, path.join(destDir, 'celeste_v2_c0.state'));
}

const rateLimitMod = await import('../lib/rateLimit.ts');
const identityMod = await import('../lib/playerIdentity.ts');
const ghostStoreMod = await import('../lib/ghostStore.ts');
const ghostShareMod = await import('../lib/ghostShare.ts');
const catalogMod = await import('../lib/homebrewCatalog.ts');
const romProfilesMod = await import('../lib/romProfiles.ts');
const romVaultMod = await import('../lib/romVault.ts');
const typesMod = await import('../lib/types.ts');
const inputReplayMod = await import('../lib/inputReplay.ts');
const demoReplaysMod = await import('../lib/celesteDemoReplays.ts');
const verifierMod = await import('../lib/headlessVerifier.ts');

function buildSingleEntryZipBytes(entryName, payloadBytes, useDeflate = false) {
  const nameBytes = Buffer.from(entryName, 'utf8');
  const rawBuf = Buffer.from(payloadBytes);
  const compBuf = useDeflate ? zlib.deflateRawSync(rawBuf) : rawBuf;
  const method = useDeflate ? 8 : 0;

  const localHeader = Buffer.alloc(30 + nameBytes.length);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt32LE(0, 14); // crc32 (unchecked by extractor)
  localHeader.writeUInt32LE(compBuf.length, 18);
  localHeader.writeUInt32LE(rawBuf.length, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);
  localHeader.writeUInt16LE(0, 28);
  nameBytes.copy(localHeader, 30);

  const centralOffset = localHeader.length + compBuf.length;
  const centralHeader = Buffer.alloc(46 + nameBytes.length);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(method, 10);
  centralHeader.writeUInt32LE(0, 16);
  centralHeader.writeUInt32LE(compBuf.length, 20);
  centralHeader.writeUInt32LE(rawBuf.length, 24);
  centralHeader.writeUInt16LE(nameBytes.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt32LE(0, 42); // local header offset = 0
  nameBytes.copy(centralHeader, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralHeader.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);

  return new Uint8Array(Buffer.concat([localHeader, compBuf, centralHeader, eocd]));
}

describe('Bitgeist Stages 1-5 Regression Suite', () => {
  before(() => {
    rateLimitMod.resetRateLimitBucketsForTests();
  });

  after(async () => {
    await verifierMod.shutdownHeadlessVerifierForTests();
    try {
      fs.rmSync(tempTestDir, { recursive: true, force: true });
    } catch {
      // ignore temp cleanup failure
    }
  });

  it('enforces per-IP sliding-window API rate limits and recovers after window expiry', () => {
    const key = 'ghosts:198.51.100.42';
    const windowMs = 10_000;
    const t0 = 1_000_000;

    const r1 = rateLimitMod.checkSlidingWindowRateLimit({
      key,
      maxRequests: 2,
      windowMs,
      nowMs: t0,
    });
    assert.equal(r1.allowed, true);
    assert.equal(r1.remaining, 1);

    const r2 = rateLimitMod.checkSlidingWindowRateLimit({
      key,
      maxRequests: 2,
      windowMs,
      nowMs: t0 + 500,
    });
    assert.equal(r2.allowed, true);
    assert.equal(r2.remaining, 0);

    const blocked = rateLimitMod.checkSlidingWindowRateLimit({
      key,
      maxRequests: 2,
      windowMs,
      nowMs: t0 + 1000,
    });
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec >= 1);

    const recovered = rateLimitMod.checkSlidingWindowRateLimit({
      key,
      maxRequests: 2,
      windowMs,
      nowMs: t0 + windowMs + 1,
    });
    assert.equal(recovered.allowed, true);
  });

  it('claims zero-signup arcade tags, prevents impersonation, tracks streaks, and verifies BG1 claim keys', () => {
    const ownerA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const ownerB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

    // Owner A claims @SPEEDY on Daily #43
    const claimA = identityMod.resolveTagForSubmission({
      ownerId: ownerA,
      requestedTag: 'speedy',
      dailyNumber: 43,
    });
    assert.equal(claimA.assignedTag, 'SPEEDY');
    assert.equal(claimA.tagConflict, undefined);
    assert.equal(claimA.identity.claimed, true);
    assert.equal(claimA.identity.ownedBySession, true);
    assert.equal(claimA.identity.streakCount, 1);

    // Owner A completes consecutive Daily #44 -> streak increments to 2
    const streakA = identityMod.resolveTagForSubmission({
      ownerId: ownerA,
      requestedTag: 'SPEEDY',
      dailyNumber: 44,
    });
    assert.equal(streakA.assignedTag, 'SPEEDY');
    assert.equal(streakA.identity.streakCount, 2);

    // Owner B attempting @SPEEDY receives collision-free fallback @SPEEDY_2
    const conflictB = identityMod.resolveTagForSubmission({
      ownerId: ownerB,
      requestedTag: 'SPEEDY',
      dailyNumber: 44,
    });
    assert.equal(conflictB.assignedTag, 'SPEEDY_2');
    assert.ok(conflictB.tagConflict);
    assert.equal(conflictB.tagConflict.requestedTag, 'SPEEDY');

    // Built-in #1 champion bot @ALEX is protected against impersonation
    const botAttempt = identityMod.resolveTagForSubmission({
      ownerId: ownerB,
      requestedTag: 'ALEX',
    });
    assert.equal(botAttempt.assignedTag, 'ALEX_2');
    assert.ok(botAttempt.tagConflict);

    // Multi-device BG1 backup claim key round-trips and rejects tampering
    const backupKey = identityMod.buildBackupClaimKey(ownerA);
    assert.match(backupKey, /^BG1-[A-F0-9]{32}-[A-F0-9]{10}$/);
    assert.equal(identityMod.verifyBackupClaimKey(backupKey), ownerA);
    const tampered = `${backupKey.slice(0, -1)}${backupKey.endsWith('A') ? 'B' : 'A'}`;
    assert.equal(identityMod.verifyBackupClaimKey(tampered), null);
  });

  it('deduplicates SQLite Top-10 leaderboard by runner tag keeping fastest personal best', async () => {
    const sprintId = `${romProfilesMod.CELESTE_ROM_ID}:c1`;
    const sampleFrames = [
      [0, 32, 176],
      [180, 520, 168],
      [420, 1264, 160],
    ];

    await ghostStoreMod.saveGhostRun({
      tag: 'TURBO',
      romId: romProfilesMod.CELESTE_ROM_ID,
      consoleSystem: 'nes',
      sprintId,
      romTitle: 'CELESTE 1-B • CITY CROSSING',
      timeMs: 14_200,
      beatenCount: 1,
      totalGhosts: 10,
      emojiReceipt: '⚡⚡⚡👑🏃💨🏁',
      frames: sampleFrames,
      verified: true,
    });

    // Faster PB by same @TURBO runner should replace slower entry on leaderboard
    await ghostStoreMod.saveGhostRun({
      tag: 'TURBO',
      romId: romProfilesMod.CELESTE_ROM_ID,
      consoleSystem: 'nes',
      sprintId,
      romTitle: 'CELESTE 1-B • CITY CROSSING',
      timeMs: 11_450,
      beatenCount: 1,
      totalGhosts: 10,
      emojiReceipt: '⚡⚡⚡👑🏃💨🏁',
      frames: sampleFrames,
      verified: true,
    });

    await ghostStoreMod.saveGhostRun({
      tag: 'VORTEX',
      romId: romProfilesMod.CELESTE_ROM_ID,
      consoleSystem: 'nes',
      sprintId,
      romTitle: 'CELESTE 1-B • CITY CROSSING',
      timeMs: 12_300,
      beatenCount: 0,
      totalGhosts: 10,
      emojiReceipt: '⚡⚡👻👑🏃💨🏁',
      frames: sampleFrames,
      verified: true,
    });

    const pack = await ghostStoreMod.getGhostsForRom(romProfilesMod.CELESTE_ROM_ID, undefined, {
      sprintId,
      consoleSystem: 'nes',
      courseIndex: 1,
      romTitle: 'CELESTE 1-B • CITY CROSSING',
      startWorldX: 32,
      goalWorldX: 1264,
    });

    assert.ok(pack.leaderboard.length <= 10);
    const turboRows = pack.leaderboard.filter((r) => r.tag === 'TURBO');
    assert.equal(turboRows.length, 1);
    assert.equal(turboRows[0].timeMs, 11_450);
    assert.equal(pack.leaderboard[0].tag, 'TURBO');
  });

  it('verifies Celeste is the sole bundled cartridge and all Celeste previews and cores exist', () => {
    assert.equal(catalogMod.HOMEBREW_CARTRIDGES.length, 1);
    assert.equal(catalogMod.HOMEBREW_CARTRIDGES[0].key, 'celeste-nes');

    for (const cart of catalogMod.HOMEBREW_CARTRIDGES) {
      const romDiskPath = path.join(PROJECT_ROOT, 'public', cart.romUrl);
      const licenseDiskPath = path.join(PROJECT_ROOT, 'public', cart.licenseUrl);
      assert.ok(fs.existsSync(romDiskPath), `Missing bundled ROM: ${romDiskPath}`);
      assert.ok(fs.existsSync(licenseDiskPath), `Missing ROM license: ${licenseDiskPath}`);
    }

    for (const name of [
      'celeste-1a.png',
      'celeste-1b.png',
      'celeste-1c.png',
      'celeste-2a.png',
      'celeste-2b.png',
      'celeste-01.png',
    ]) {
      const celestePreview = path.join(PROJECT_ROOT, 'public', 'previews', name);
      assert.ok(fs.existsSync(celestePreview), `Missing Celeste preview PNG: ${celestePreview}`);
      assert.ok(fs.statSync(celestePreview).size > 2500);
    }

    for (const core of ['fceumm_libretro', 'mgba_libretro', 'gambatte_libretro']) {
      assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'public', 'cores', `${core}.js`)));
      assert.ok(fs.existsSync(path.join(PROJECT_ROOT, 'public', 'cores', `${core}.wasm`)));
    }
  });

  it('round-trips copyright-clean SHA-1 + custom bounds Dare Blueprint tokens', () => {
    const customSha1 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b';
    const token = ghostShareMod.encodeStatelessGhostToken({
      tag: 'MAKER',
      romId: customSha1,
      consoleSystem: 'gba',
      sprintId: `${customSha1}:custom-s1`,
      romTitle: 'MY HOMEBREW S1',
      timeMs: 13_750,
      startWorldX: 64,
      goalWorldX: 980,
      frames: [
        [0, 64, 160],
        [210, 480, 142],
        [412, 984, 150],
      ],
    });
    assert.ok(token.length > 20);

    const decoded = ghostShareMod.decodeStatelessGhostToken(token);
    assert.ok(decoded);
    assert.equal(decoded.tag, 'MAKER');
    assert.equal(decoded.romId, customSha1);
    assert.equal(decoded.consoleSystem, 'gba');
    assert.equal(decoded.startWorldX, 64);
    assert.equal(decoded.goalWorldX, 980);
    assert.equal(decoded.timeMs, 13_750);
  });

  it('verifies authentic Celeste 1-A replay and rejects spoofed runs via headless fceumm_libretro.wasm', async () => {
    const champ1A = demoReplaysMod.CELESTE_CHAMPION_REPLAYS[0];
    const validRes = await verifierMod.verifyNesRunHeadless({
      romId: romProfilesMod.CELESTE_ROM_ID,
      sprintId: `${romProfilesMod.CELESTE_ROM_ID}:c0`,
      courseIndex: 0,
      claimedTimeMs: champ1A.timeMs,
      inputLog: champ1A.inputLog,
    });

    assert.equal(validRes.supported, true);
    assert.equal(validRes.ok, true, `Expected valid replay to pass: ${validRes.reason || ''}`);
    assert.equal(validRes.verified, true);
    assert.ok(
      Math.abs((validRes.simulatedTimeMs ?? 0) - champ1A.timeMs) <= 250,
      `Simulated time ${validRes.simulatedTimeMs}ms diverged from ${champ1A.timeMs}ms`
    );

    // Spoofed idle/short inputLog claiming an impossible 11.00s clear must be rejected
    const spoofedRes = await verifierMod.verifyNesRunHeadless({
      romId: romProfilesMod.CELESTE_ROM_ID,
      sprintId: `${romProfilesMod.CELESTE_ROM_ID}:c0`,
      courseIndex: 0,
      claimedTimeMs: 11_000,
      inputLog: '1:3c.0:1e',
    });
    assert.equal(spoofedRes.supported, true);
    assert.equal(spoofedRes.ok, false);
    assert.equal(spoofedRes.verified, false);
  });

  it('validates iNES 1.0 & NES 2.0 headers, sanitizes dirty DiskDude headers, and rejects truncated or FDS/UNIF files', () => {
    // 1. Valid iNES 1.0 MMC3 (Mapper 4) 32KB PRG + 8KB CHR
    const cleanRom = new Uint8Array(16 + 32_768 + 8_192);
    cleanRom.set([0x4e, 0x45, 0x53, 0x1a, 2, 1, 0x40, 0x00], 0);
    const cleanRes = romVaultMod.inspectNesRomBytes(cleanRom);
    assert.equal(cleanRes.valid, true);
    assert.equal(cleanRes.mapper, 4);
    assert.equal(cleanRes.isNes2, false);
    assert.equal(cleanRes.dirtyHeaderCleaned, false);

    // 2. Valid NES 2.0 Extended Mapper (Submapper 2, Mapper 0x104 = 260)
    const nes2Rom = new Uint8Array(16 + 16_384);
    nes2Rom.set([0x4e, 0x45, 0x53, 0x1a, 1, 0, 0x40, 0x08, 0x21, 0x00], 0);
    const nes2Res = romVaultMod.inspectNesRomBytes(nes2Rom);
    assert.equal(nes2Res.valid, true);
    assert.equal(nes2Res.isNes2, true);
    assert.equal(nes2Res.mapper, 0x104);
    assert.equal(nes2Res.submapper, 2);

    // 3. Dirty "DiskDude!" iNES header polluting flags7..15 (would mis-detect NROM Mapper 0 as Mapper 64!)
    const dirtyRom = new Uint8Array(16 + 16_384);
    dirtyRom.set([0x4e, 0x45, 0x53, 0x1a, 1, 0, 0x01], 0);
    Buffer.from('DiskDude!').copy(dirtyRom, 7);
    const dirtyRes = romVaultMod.inspectNesRomBytes(dirtyRom);
    assert.equal(dirtyRes.valid, true);
    assert.equal(dirtyRes.dirtyHeaderCleaned, true);
    assert.equal(dirtyRes.mapper, 0);
    assert.equal(dirtyRes.sanitizedBytes[7], 0);
    assert.equal(dirtyRes.sanitizedBytes[15], 0);

    // 4. Truncated .NES file (claims 2x16KB = 32KB PRG, only 8KB body present)
    const truncated = new Uint8Array(16 + 8_192);
    truncated.set([0x4e, 0x45, 0x53, 0x1a, 2, 0, 0x00, 0x00], 0);
    const truncRes = romVaultMod.inspectNesRomBytes(truncated);
    assert.equal(truncRes.valid, false);
    assert.match(truncRes.error || '', /Truncated or corrupt \.NES/i);

    // 5. FDS and UNIF clear user-facing errors
    const fdsBytes = new Uint8Array(64);
    fdsBytes.set([0x46, 0x44, 0x53, 0x1a], 0);
    assert.match(romVaultMod.inspectNesRomBytes(fdsBytes).error || '', /Famicom Disk System/i);

    const unifBytes = new Uint8Array(64);
    unifBytes.set([0x55, 0x4e, 0x49, 0x46], 0);
    assert.match(romVaultMod.inspectNesRomBytes(unifBytes).error || '', /UNIF/i);
  });

  it('extracts Stored and Deflated .NES cartridges from .ZIP archives in-memory', async () => {
    const sampleNes = new Uint8Array(16 + 16_384);
    sampleNes.set([0x4e, 0x45, 0x53, 0x1a, 1, 0, 0x00, 0x00], 0);
    for (let i = 16; i < sampleNes.length; i++) {
      sampleNes[i] = (i * 31) & 0xff;
    }

    const storedZip = buildSingleEntryZipBytes('folder/homebrew_test.nes', sampleNes, false);
    const storedOut = await romVaultMod.extractRomFromZipBytes(storedZip);
    assert.equal(storedOut.fileName, 'homebrew_test.nes');
    assert.deepEqual(storedOut.bytes, sampleNes);

    const deflatedZip = buildSingleEntryZipBytes('nested/deflated_cart.nes', sampleNes, true);
    const deflatedOut = await romVaultMod.extractRomFromZipBytes(deflatedZip);
    assert.equal(deflatedOut.fileName, 'deflated_cart.nes');
    assert.deepEqual(deflatedOut.bytes, sampleNes);
  });

  it('auto-detects non-$0200 NES OAM shadow pages ($0700) and advances universal NES sprint progress', () => {
    const customId = '1111111111111111111111111111111111111111';
    const profile = romProfilesMod.applyCustomSprintBounds(
      romProfilesMod.resolveRomProfile(customId, 'micro_homebrew.nes'),
      { startWorldX: 48, goalWorldX: 240 }
    );
    assert.equal(profile.consoleSystem, 'nes');
    assert.equal(profile.profileKind, 'universal-oam');
    assert.equal(profile.goalWorldX, 240);

    // Populate $0200 with non-OAM state variables, while $0700 holds authentic 64-sprite OAM DMA buffer
    const ram = new Uint8Array(0x800);
    for (let i = 0x0200; i < 0x0300; i++) {
      ram[i] = (i * 17) & 0x7f; // zero hidden-sprite markers -> not an OAM page
    }
    for (let s = 0; s < 64; s++) {
      ram[0x0700 + s * 4] = 0xf8; // PPU hardware hidden sprite Y >= $EF
    }
    // Sprite 0 HUD hit at Y=24, X=8; Sprite 1 Player at Y=160, Tile=0x12, Attr=0x00, X=120
    ram[0x0700] = 24;
    ram[0x0703] = 8;
    ram[0x0704] = 160;
    ram[0x0705] = 0x12;
    ram[0x0706] = 0x00;
    ram[0x0707] = 120;

    const tracker = typesMod.createInitialTrackerState();
    let reached = false;
    for (let f = 0; f < 120; f++) {
      ram[0x0705] = 0x12 + (f & 1); // animate walk tile
      const frame = profile.extractTelemetry(
        ram,
        tracker,
        inputReplayMod.NES_INPUT_RIGHT | inputReplayMod.NES_INPUT_B
      );
      tracker.hadGameplay = tracker.hadGameplay || frame.inGameplay;
      tracker.cameraX = frame.cameraX;
      tracker.oamX = 120;
      tracker.oamTile = frame.oamTile ?? tracker.oamTile;
      if (frame.reachedGoal) {
        reached = true;
        break;
      }
    }
    assert.equal(reached, true, 'Universal NES profile should reach goalWorldX using $0700 OAM shadow page');
  });

  it('gates inGameplay=false across loading screens, title menus, and story cutscenes for all game profiles', () => {
    // 1. Celeste NES: Title, Overworld, Prologue Story Card, and Initial Fade/Load stay false
    const celeste = romProfilesMod.createCelesteCourseProfile({ courseIndex: 0 });
    const celesteRam = new Uint8Array(0x800);
    const celesteTracker = typesMod.createInitialTrackerState();
    celesteRam[0x001c] = 0x01; // gm_title
    celesteRam[0x0021] = 0x01;
    assert.equal(celeste.extractTelemetry(celesteRam, celesteTracker, 0).inGameplay, false);
    celesteRam[0x001c] = 0x04; // gm_prologue story card
    assert.equal(celeste.extractTelemetry(celesteRam, celesteTracker, 0).inGameplay, false);
    celesteRam[0x001c] = 0x00; // gm_game, but still fading in ($0031 != 0)
    celesteRam[0x0031] = 0x04;
    assert.equal(celeste.extractTelemetry(celesteRam, celesteTracker, 0).inGameplay, false);
    celesteRam[0x0031] = 0x00; // fade complete -> controllable gameplay!
    celesteRam[0x006f] = 24;
    celesteRam[0x0071] = 176;
    assert.equal(celeste.extractTelemetry(celesteRam, celesteTracker, 0).inGameplay, true);

    // 2. Super Mario Bros. 1: Title, "WORLD 1-1" black loading screen ($0772 < 3), and Pipe Auto-Walk Intro ($000E = 0x07)
    const smb1 = romProfilesMod.resolveRomProfile('2222222222222222222222222222222222222222', 'Super Mario Bros. (World).nes');
    const smb1Ram = new Uint8Array(0x800);
    const smb1Tracker = typesMod.createInitialTrackerState();
    smb1Ram[0x0770] = 0x01; // GameModeValue = Gameplay
    smb1Ram[0x0772] = 0x01; // OperMode_Task = "WORLD 1-1 / MARIO x 3" black loading screen!
    smb1Ram[0x0086] = 40;
    smb1Ram[0x00ce] = 176;
    smb1Ram[0x000e] = 0x08;
    assert.equal(smb1.extractTelemetry(smb1Ram, smb1Tracker, 0).inGameplay, false);
    smb1Ram[0x0772] = 0x03; // GameCoreRoutine active, but Player_State = 0x07 (pre-level pipe auto-walk intro)
    smb1Ram[0x000e] = 0x07;
    assert.equal(smb1.extractTelemetry(smb1Ram, smb1Tracker, 0).inGameplay, false);
    smb1Ram[0x000e] = 0x08; // Normal controllable Mario!
    assert.equal(smb1.extractTelemetry(smb1Ram, smb1Tracker, 0).inGameplay, true);

    // 3. Super Mario Bros. 3: Curtain Title Mario & Luigi story skit and Overworld Map ($05EE..$05F0 = 0,0,0)
    const smb3 = romProfilesMod.resolveRomProfile('3333333333333333333333333333333333333333', 'Super Mario Bros. 3 (USA).nes');
    const smb3Ram = new Uint8Array(0x800);
    const smb3Tracker = typesMod.createInitialTrackerState();
    smb3Ram[0x0090] = 96; // Mario & Luigi running across title curtain skit!
    smb3Ram[0x00a2] = 160;
    assert.equal(smb3.extractTelemetry(smb3Ram, smb3Tracker, 0).inGameplay, false);
    smb3Ram[0x05ee] = 3; // Active stage timer 300 -> real stage gameplay!
    assert.equal(smb3.extractTelemetry(smb3Ram, smb3Tracker, 0).inGameplay, true);

    // 4. Mega Man 2 ("READY" beam-down) & Ninja Gaiden (Tecmo Cinema Story Cutscene)
    const mm2 = romProfilesMod.resolveRomProfile('4444444444444444444444444444444444444444', 'Mega Man 2 (USA).nes');
    const mm2Ram = new Uint8Array(0x800);
    const mm2Tracker = typesMod.createInitialTrackerState();
    mm2Ram[0x0400] = 0x01; // "READY" / teleporting beam
    mm2Ram[0x0420] = 0x80; // Active entity flag
    mm2Ram[0x06c0] = 28; // Full Mega Man HP
    mm2Ram[0x0460] = 64;
    mm2Ram[0x04a0] = 160;
    assert.equal(mm2.extractTelemetry(mm2Ram, mm2Tracker, 0).inGameplay, false);
    mm2Ram[0x0400] = 0x02; // Materialized & controllable
    assert.equal(mm2.extractTelemetry(mm2Ram, mm2Tracker, 0).inGameplay, true);

    const ng = romProfilesMod.resolveRomProfile('5555555555555555555555555555555555555555', 'Ninja Gaiden (USA).nes');
    const ngRam = new Uint8Array(0x800);
    const ngTracker = typesMod.createInitialTrackerState();
    ngRam[0x0086] = 48;
    ngRam[0x008a] = 160;
    ngRam[0x0065] = 16; // Ryu HP full ($0065), while stage timer $0063/$0064 is 0 during Tecmo Story Cinema!
    assert.equal(ng.extractTelemetry(ngRam, ngTracker, 0).inGameplay, false);
    ngRam[0x0063] = 1; // Stage timer active
    assert.equal(ng.extractTelemetry(ngRam, ngTracker, 0).inGameplay, true);

    // 5. Super Mario World (SNES) & Sonic the Hedgehog (Genesis)
    const smw = romProfilesMod.resolveRomProfile(
      '6666666666666666666666666666666666666666',
      'Super Mario World (USA).sfc',
      undefined,
      'snes'
    );
    const smwRam = new Uint8Array(0x20000);
    const smwTracker = typesMod.createInitialTrackerState();
    smwRam[0x0100] = 0x12; // "MARIO START!" black loading card
    smwRam[0x0094] = 32;
    smwRam[0x0096] = 160;
    assert.equal(smw.extractTelemetry(smwRam, smwTracker, 0).inGameplay, false);
    smwRam[0x0100] = 0x14;
    smwRam[0x1426] = 0x01; // "Welcome to Dinosaur Land!" intro message box active
    assert.equal(smw.extractTelemetry(smwRam, smwTracker, 0).inGameplay, false);
    smwRam[0x1426] = 0x00; // Message dismissed -> controllable gameplay!
    assert.equal(smw.extractTelemetry(smwRam, smwTracker, 0).inGameplay, true);

    const sonic = romProfilesMod.resolveRomProfile(
      '7777777777777777777777777777777777777777',
      'Sonic the Hedgehog (USA, Europe).md',
      undefined,
      'genesis'
    );
    const sonicRam = new Uint8Array(0x10000);
    const sonicTracker = typesMod.createInitialTrackerState();
    sonicRam[0xf600] = 0x00; // SEGA Splash
    assert.equal(sonic.extractTelemetry(sonicRam, sonicTracker, 0).inGameplay, false);
    sonicRam[0xf600] = 0x08; // Attract Demo
    sonicRam[0xd008] = 80;
    sonicRam[0xd00c] = 160;
    sonicRam[0xd024] = 0x02;
    assert.equal(sonic.extractTelemetry(sonicRam, sonicTracker, 0).inGameplay, false);
    sonicRam[0xf600] = 0x8c; // "GREEN HILL ZONE ACT 1" title card overlay
    assert.equal(sonic.extractTelemetry(sonicRam, sonicTracker, 0).inGameplay, false);
    sonicRam[0xf600] = 0x0c; // Active level without title card!
    assert.equal(sonic.extractTelemetry(sonicRam, sonicTracker, 0).inGameplay, true);

    // 6. Universal NES OAM: Blank loading screens & autonomous story cutscenes stay inGameplay=false
    const uniNes = romProfilesMod.resolveRomProfile('8888888888888888888888888888888888888888', 'unknown_story_game.nes');
    const uniRam = new Uint8Array(0x800);
    for (let s = 0; s < 64; s++) {
      uniRam[0x0200 + s * 4] = 0xf8; // All 64 sprites hidden (blank loading / text story card)
    }
    const uniTracker = typesMod.createInitialTrackerState();
    assert.equal(uniNes.extractTelemetry(uniRam, uniTracker, inputReplayMod.NES_INPUT_RIGHT).inGameplay, false);

    // Autonomous story cutscene sprite moving across screen with ZERO player input stays false
    uniRam[0x0204] = 160;
    uniRam[0x0205] = 0x20;
    uniRam[0x0206] = 0x00;
    for (let f = 0; f < 10; f++) {
      uniRam[0x0207] = 40 + f * 2;
      const out = uniNes.extractTelemetry(uniRam, uniTracker, 0);
      assert.equal(out.inGameplay, false, 'Autonomous story cutscene sprite must not trigger inGameplay');
    }

    // Causal player-driven movement (Right held while sprite responds for >= 3 frames) unlocks gameplay
    let unlocked = false;
    for (let f = 0; f < 5; f++) {
      uniRam[0x0207] = 64 + f * 2;
      const out = uniNes.extractTelemetry(uniRam, uniTracker, inputReplayMod.NES_INPUT_RIGHT);
      if (out.inGameplay) {
        unlocked = true;
        break;
      }
    }
    assert.equal(unlocked, true);

    // 7. Universal Multi-Console WRAM: Bulk loading decompression & pre-Start intro never advance playerWorldX
    const uniSnes = romProfilesMod.resolveRomProfile(
      '9999999999999999999999999999999999999999',
      'unknown_adventure.sfc',
      undefined,
      'snes'
    );
    const uniSnesRam = new Uint8Array(0x20000);
    const uniSnesTracker = typesMod.createInitialTrackerState();
    for (let f = 0; f < 10; f++) {
      const out = uniSnes.extractTelemetry(uniSnesRam, uniSnesTracker, inputReplayMod.NES_INPUT_RIGHT);
      assert.equal(out.inGameplay, false);
      assert.equal(out.playerWorldX, uniSnes.startWorldX);
    }
    // Press Start to pass Title Screen, let WRAM settle, then hold Right in gameplay
    uniSnes.extractTelemetry(uniSnesRam, uniSnesTracker, inputReplayMod.NES_INPUT_START);
    let snesUnlocked = false;
    for (let f = 0; f < 16; f++) {
      const out = uniSnes.extractTelemetry(uniSnesRam, uniSnesTracker, inputReplayMod.NES_INPUT_RIGHT);
      if (out.inGameplay) {
        snesUnlocked = true;
        break;
      }
    }
    assert.equal(snesUnlocked, true);

    // Simulate mid-game bulk WRAM level-load decompression (>= 22/64 distributed WRAM samples rewritten) -> drops inGameplay=false!
    for (let i = 0; i < uniSnesRam.length; i += 256) {
      uniSnesRam[i] = (uniSnesRam[i] + 0x5a + (i & 0x7f)) & 0xff;
    }
    const duringLoad = uniSnes.extractTelemetry(uniSnesRam, uniSnesTracker, inputReplayMod.NES_INPUT_RIGHT);
    assert.equal(duringLoad.inGameplay, false);
  });
});
