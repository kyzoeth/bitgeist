import { applyRomPatchBytes, detectRomPatchFormat } from './romPatcher';
import type {
  ConsoleSystemId,
  CustomRomSegment,
  CustomSprintBounds,
  StoredRomEntry,
} from './types';

const DB_NAME = 'bitgeist-vault-v1';
const DB_VERSION = 1;
const ROM_STORE = 'roms';
const STATE_STORE = 'states';

export const SUPPORTED_ROM_EXTENSIONS =
  '.nes,.zip,.sfc,.smc,.md,.gen,.bin,.gb,.gbc,.gba,.ips,.bps';

export const CONSOLE_SYSTEM_LABELS: Record<ConsoleSystemId, string> = {
  nes: 'NES',
  snes: 'SNES',
  genesis: 'GENESIS',
  gb: 'GAME BOY',
  gba: 'GBA',
};

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ROM_STORE)) {
        db.createObjectStore(ROM_STORE, { keyPath: 'romId' });
      }
      if (!db.objectStoreNames.contains(STATE_STORE)) {
        db.createObjectStore(STATE_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function computeSha1Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-1', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const MAX_EXTRACTED_ROM_BYTES = 16 * 1024 * 1024; // 16 MB zip-bomb safety ceiling

export interface NesHeaderInspection {
  valid: boolean;
  mapper?: number;
  submapper?: number;
  isNes2?: boolean;
  prgBytes?: number;
  chrBytes?: number;
  hasTrainer?: boolean;
  hasBatteryRam?: boolean;
  dirtyHeaderCleaned?: boolean;
  sanitizedBytes?: Uint8Array;
  error?: string;
}

export function inspectNesRomBytes(bytes: Uint8Array): NesHeaderInspection {
  if (bytes.length < 16) {
    return { valid: false, error: 'File is too small to be a valid .NES cartridge.' };
  }

  // Detect Famicom Disk System (.fds) images which require an external Nintendo BIOS
  if (
    (bytes[0] === 0x46 && bytes[1] === 0x44 && bytes[2] === 0x53 && bytes[3] === 0x1a) ||
    hasAsciiAt(bytes, 1, '*NINTENDO-HVC*')
  ) {
    return {
      valid: false,
      error:
        'Famicom Disk System (.FDS) disks require an external BIOS. Drop a standard .NES cartridge ROM.',
    };
  }

  // Detect UNIF container format
  if (bytes[0] === 0x55 && bytes[1] === 0x4e && bytes[2] === 0x49 && bytes[3] === 0x46) {
    return {
      valid: false,
      error: 'UNIF (.UNF) container detected. Please drop a standard iNES / NES 2.0 (.NES) ROM.',
    };
  }

  if (
    bytes[0] !== 0x4e || // 'N'
    bytes[1] !== 0x45 || // 'E'
    bytes[2] !== 0x53 || // 'S'
    bytes[3] !== 0x1a // EOF
  ) {
    return {
      valid: false,
      error: 'Not a valid .NES cartridge file (missing iNES "NES\\x1A" header).',
    };
  }

  const flags6 = bytes[6];
  let flags7 = bytes[7];
  const isNes2 = (flags7 & 0x0c) === 0x08;

  // Classic "DiskDude!" / archaic tool signature in bytes 7..15 pollutes upper mapper bits in flags7
  let dirtyHeaderCleaned = false;
  if (!isNes2) {
    const hasTrailingGarbage =
      hasAsciiAt(bytes, 7, 'DiskDude') ||
      hasAsciiAt(bytes, 7, 'NESticle') ||
      ((flags7 & 0x0c) === 0x04) ||
      (bytes[12] !== 0 || bytes[13] !== 0 || bytes[14] !== 0 || bytes[15] !== 0);
    if (hasTrailingGarbage) {
      flags7 = 0;
      dirtyHeaderCleaned = true;
    }
  }

  const hasTrainer = (flags6 & 0x04) !== 0;
  const hasBatteryRam = (flags6 & 0x02) !== 0;
  const trainerBytes = hasTrainer ? 512 : 0;

  let prgBytes = 0;
  let chrBytes = 0;
  let mapper = (flags7 & 0xf0) | (flags6 >> 4);
  let submapper = 0;

  if (isNes2) {
    mapper |= (bytes[8] & 0x0f) << 8;
    submapper = bytes[8] >> 4;
    const prgMsb = bytes[9] & 0x0f;
    const chrMsb = bytes[9] >> 4;
    if (prgMsb === 0x0f) {
      const exp = bytes[4] >> 2;
      const mult = (bytes[4] & 0x03) * 2 + 1;
      prgBytes = exp > 26 ? MAX_EXTRACTED_ROM_BYTES + 1 : Math.pow(2, exp) * mult;
    } else {
      prgBytes = ((prgMsb << 8) | bytes[4]) * 16_384;
    }
    if (chrMsb === 0x0f) {
      const exp = bytes[5] >> 2;
      const mult = (bytes[5] & 0x03) * 2 + 1;
      chrBytes = exp > 26 ? 0 : Math.pow(2, exp) * mult;
    } else {
      chrBytes = ((chrMsb << 8) | bytes[5]) * 8_192;
    }
  } else {
    prgBytes = bytes[4] * 16_384;
    chrBytes = bytes[5] * 8_192;
  }

  if (prgBytes < 16_384) {
    return {
      valid: false,
      error: 'Invalid .NES header (0 KB PRG-ROM).',
    };
  }

  const minRequiredBytes = 16 + trainerBytes + prgBytes;
  if (bytes.length < minRequiredBytes) {
    return {
      valid: false,
      error: `Truncated or corrupt .NES file (expected at least ${Math.ceil(
        minRequiredBytes / 1024
      )} KB, got ${Math.floor(bytes.length / 1024)} KB).`,
    };
  }

  let sanitizedBytes = bytes;
  if (dirtyHeaderCleaned) {
    sanitizedBytes = new Uint8Array(bytes.byteLength);
    sanitizedBytes.set(bytes);
    sanitizedBytes[7] = 0;
    for (let i = 8; i < 16; i++) {
      sanitizedBytes[i] = 0;
    }
  }

  return {
    valid: true,
    mapper,
    submapper,
    isNes2,
    prgBytes,
    chrBytes,
    hasTrainer,
    hasBatteryRam,
    dirtyHeaderCleaned,
    sanitizedBytes,
  };
}

function isValidInesHeader(bytes: Uint8Array): boolean {
  return inspectNesRomBytes(bytes).valid;
}

function isZipArchiveBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 30 &&
    bytes[0] === 0x50 && // 'P'
    bytes[1] === 0x4b && // 'K'
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

async function inflateRawBytesBounded(
  compressed: Uint8Array,
  expectedSize: number
): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Browser does not support .ZIP decompression. Please unzip the .NES file first.');
  }
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([copy.buffer]).stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_EXTRACTED_ROM_BYTES) {
        await reader.cancel();
        throw new Error('ROM inside .ZIP exceeds the 16 MB cartridge size limit.');
      }
      chunks.push(value);
    }
  }

  const out = new Uint8Array(expectedSize > 0 && expectedSize === total ? expectedSize : total);
  let pos = 0;
  for (const chunk of chunks) {
    out.set(chunk, pos);
    pos += chunk.byteLength;
  }
  return out;
}

export async function extractRomFromZipBytes(
  zipBytes: Uint8Array
): Promise<{ fileName: string; bytes: Uint8Array }> {
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);

  // Locate End of Central Directory (EOCD: 0x06054b50) scanning backward from end of archive
  let eocdOffset = -1;
  const minEocd = Math.max(0, zipBytes.length - 65_557);
  for (let i = zipBytes.length - 22; i >= minEocd; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Corrupt or unsupported .ZIP archive (missing Central Directory).');
  }

  const totalEntries = dv.getUint16(eocdOffset + 10, true);
  const cdSize = dv.getUint32(eocdOffset + 12, true);
  const cdOffset = dv.getUint32(eocdOffset + 16, true);
  if (cdOffset + cdSize > zipBytes.length) {
    throw new Error('Corrupt .ZIP archive (truncated Central Directory).');
  }

  interface ZipCandidate {
    fileName: string;
    baseName: string;
    method: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
    priority: number;
  }

  const decoder = new TextDecoder('utf-8');
  const candidates: ZipCandidate[] = [];
  let ptr = cdOffset;

  for (let entryIdx = 0; entryIdx < totalEntries && ptr + 46 <= zipBytes.length; entryIdx++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const flags = dv.getUint16(ptr + 8, true);
    const method = dv.getUint16(ptr + 10, true);
    const compressedSize = dv.getUint32(ptr + 20, true);
    const uncompressedSize = dv.getUint32(ptr + 24, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localHeaderOffset = dv.getUint32(ptr + 42, true);

    const rawName = decoder.decode(zipBytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if ((flags & 0x01) !== 0) continue; // skip encrypted entries
    if (
      rawName.endsWith('/') ||
      rawName.startsWith('__MACOSX/') ||
      rawName.includes('/.') ||
      uncompressedSize === 0
    ) {
      continue;
    }

    const baseName = rawName.split('/').pop() || rawName;
    const lower = baseName.toLowerCase();
    const isNes = lower.endsWith('.nes');
    const isOtherRom = /\.(sfc|smc|md|gen|bin|gb|gbc|gba)$/i.test(lower);
    if (!isNes && !isOtherRom) continue;

    candidates.push({
      fileName: rawName,
      baseName,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      priority: isNes ? 0 : 1,
    });
  }

  if (candidates.length === 0) {
    throw new Error('No .NES (or supported retro ROM) cartridge file found inside .ZIP archive.');
  }

  candidates.sort((a, b) => a.priority - b.priority);
  const chosen = candidates[0];

  if (chosen.uncompressedSize > MAX_EXTRACTED_ROM_BYTES) {
    throw new Error('ROM inside .ZIP exceeds the 16 MB cartridge size limit.');
  }

  const lh = chosen.localHeaderOffset;
  if (lh + 30 > zipBytes.length || dv.getUint32(lh, true) !== 0x04034b50) {
    throw new Error('Corrupt .ZIP archive (invalid Local File Header).');
  }
  const lhNameLen = dv.getUint16(lh + 26, true);
  const lhExtraLen = dv.getUint16(lh + 28, true);
  const dataStart = lh + 30 + lhNameLen + lhExtraLen;
  const dataEnd = dataStart + chosen.compressedSize;
  if (dataEnd > zipBytes.length) {
    throw new Error('Corrupt .ZIP archive (truncated compressed ROM stream).');
  }

  const slice = zipBytes.subarray(dataStart, dataEnd);
  if (chosen.method === 0) {
    const out = new Uint8Array(slice.byteLength);
    out.set(slice);
    return { fileName: chosen.baseName, bytes: out };
  }
  if (chosen.method === 8) {
    const inflated = await inflateRawBytesBounded(slice, chosen.uncompressedSize);
    return { fileName: chosen.baseName, bytes: inflated };
  }

  throw new Error(
    `Unsupported .ZIP compression method (${chosen.method}). Please extract the .NES file first.`
  );
}

function hasAsciiAt(bytes: Uint8Array, offset: number, ascii: string): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

export function detectRomConsoleSystem(
  fileName: string,
  bytes?: Uint8Array
): ConsoleSystemId | null {
  const lower = fileName.trim().toLowerCase();

  if (bytes && isValidInesHeader(bytes)) {
    return 'nes';
  }
  if (lower.endsWith('.nes')) {
    return !bytes || isValidInesHeader(bytes) ? 'nes' : null;
  }
  if (lower.endsWith('.sfc') || lower.endsWith('.smc')) {
    return !bytes || bytes.length >= 16_384 ? 'snes' : null;
  }
  if (lower.endsWith('.md') || lower.endsWith('.gen')) {
    return !bytes || bytes.length >= 16_384 ? 'genesis' : null;
  }
  if (lower.endsWith('.bin')) {
    if (!bytes) return 'genesis';
    if (
      bytes.length >= 16_384 &&
      (hasAsciiAt(bytes, 0x100, 'SEGA') ||
        hasAsciiAt(bytes, 0x101, 'SEGA') ||
        (bytes[0x08] === 0xaa && bytes[0x09] === 0xbb))
    ) {
      return 'genesis';
    }
    return null;
  }
  if (lower.endsWith('.gb') || lower.endsWith('.gbc')) {
    return !bytes || bytes.length >= 16_384 ? 'gb' : null;
  }
  if (lower.endsWith('.gba')) {
    return !bytes || bytes.length >= 16_384 ? 'gba' : null;
  }

  // Header fallback for extensionless files
  if (bytes && bytes.length >= 0x150) {
    if (
      bytes[0x104] === 0xce &&
      bytes[0x105] === 0xed &&
      bytes[0x106] === 0x66 &&
      bytes[0x107] === 0x66
    ) {
      return 'gb';
    }
    if (hasAsciiAt(bytes, 0x100, 'SEGA')) {
      return 'genesis';
    }
  }

  return null;
}

export async function saveRomToVault(file: File): Promise<StoredRomEntry> {
  const rawBytes = new Uint8Array(await file.arrayBuffer());
  let effectiveName = file.name;
  let bytes: Uint8Array = rawBytes;

  if (file.name.toLowerCase().endsWith('.zip') || isZipArchiveBytes(rawBytes)) {
    const extracted = await extractRomFromZipBytes(rawBytes);
    effectiveName = extracted.fileName;
    bytes = extracted.bytes;
  }

  // Perform deep header & truncation inspection on .NES / FDS / UNIF files
  const lowerName = effectiveName.trim().toLowerCase();
  if (
    lowerName.endsWith('.nes') ||
    lowerName.endsWith('.fds') ||
    lowerName.endsWith('.unf') ||
    lowerName.endsWith('.unif') ||
    (bytes.length >= 4 &&
      ((bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a) ||
        (bytes[0] === 0x46 && bytes[1] === 0x44 && bytes[2] === 0x53 && bytes[3] === 0x1a) ||
        (bytes[0] === 0x55 && bytes[1] === 0x4e && bytes[2] === 0x49 && bytes[3] === 0x46)))
  ) {
    const nesCheck = inspectNesRomBytes(bytes);
    if (!nesCheck.valid) {
      throw new Error(
        nesCheck.error || 'Not a valid .NES cartridge file (missing iNES header).'
      );
    }
    if (nesCheck.sanitizedBytes) {
      bytes = nesCheck.sanitizedBytes;
    }
  }

  const consoleSystem = detectRomConsoleSystem(effectiveName, bytes);
  if (!consoleSystem) {
    throw new Error(
      'Unsupported cartridge format. Drop a valid .NES (or .ZIP), .SFC/.SMC, .MD/.GEN, .GB/.GBC, or .GBA ROM.'
    );
  }
  const romId = await computeSha1Hex(bytes);
  const title =
    effectiveName
      .replace(/\.(nes|sfc|smc|md|gen|bin|gb|gbc|gba)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .toUpperCase()
      .slice(0, 22) || `CUSTOM ${CONSOLE_SYSTEM_LABELS[consoleSystem]} CART`;

  const entry: StoredRomEntry = {
    romId,
    consoleSystem,
    fileName: effectiveName,
    title,
    bytes,
    addedAt: Date.now(),
  };

  const db = await openVaultDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ROM_STORE, 'readwrite');
      tx.objectStore(ROM_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  return entry;
}

export async function savePatchedRomToVault(
  baseBytes: Uint8Array,
  baseTitle: string,
  baseConsoleSystem: ConsoleSystemId,
  patchFile: File
): Promise<StoredRomEntry> {
  const patchBytes = new Uint8Array(await patchFile.arrayBuffer());
  const format = detectRomPatchFormat(patchFile.name, patchBytes);
  if (!format) {
    throw new Error('Unsupported patch format. Drop a valid .IPS or .BPS ROM patch file.');
  }

  let { bytes: patchedBytes } = applyRomPatchBytes(baseBytes, patchBytes, patchFile.name);
  if (baseConsoleSystem === 'nes') {
    const nesCheck = inspectNesRomBytes(patchedBytes);
    if (nesCheck.valid && nesCheck.sanitizedBytes) {
      patchedBytes = nesCheck.sanitizedBytes;
    }
  }

  const romId = await computeSha1Hex(patchedBytes);
  const patchBaseName =
    patchFile.name
      .replace(/\.(ips|bps)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim()
      .toUpperCase()
      .slice(0, 22) || `${baseTitle} (${format.toUpperCase()})`;

  const ext = baseConsoleSystem === 'nes' ? '.nes' : `.${baseConsoleSystem}`;
  const entry: StoredRomEntry = {
    romId,
    consoleSystem: baseConsoleSystem,
    fileName: `${patchBaseName.toLowerCase().replace(/\s+/g, '-')}${ext}`,
    title: patchBaseName,
    bytes: patchedBytes,
    addedAt: Date.now(),
  };

  if (typeof indexedDB !== 'undefined') {
    const db = await openVaultDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(ROM_STORE, 'readwrite');
        tx.objectStore(ROM_STORE).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  return entry;
}

export async function getRomFromVault(romId: string): Promise<StoredRomEntry | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openVaultDb();
    try {
      return await new Promise<StoredRomEntry | null>((resolve, reject) => {
        const tx = db.transaction(ROM_STORE, 'readonly');
        const req = tx.objectStore(ROM_STORE).get(romId);
        req.onsuccess = () => resolve((req.result as StoredRomEntry) || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function listVaultRoms(): Promise<StoredRomEntry[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openVaultDb();
    try {
      const res = await new Promise<StoredRomEntry[]>((resolve, reject) => {
        const tx = db.transaction(ROM_STORE, 'readonly');
        const req = tx.objectStore(ROM_STORE).getAll();
        req.onsuccess = () => resolve((req.result as StoredRomEntry[]) || []);
        req.onerror = () => reject(req.error);
      });
      return res.sort((a, b) => b.addedAt - a.addedAt);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function deleteRomFromVault(romId: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const existingSegments = await listCustomSegmentsForRom(romId);
    const db = await openVaultDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([ROM_STORE, STATE_STORE], 'readwrite');
        tx.objectStore(ROM_STORE).delete(romId);
        const stateStore = tx.objectStore(STATE_STORE);
        stateStore.delete(`start:${romId}`);
        stateStore.delete(`bounds:${romId}`);
        stateStore.delete(`segments:${romId}`);
        for (const seg of existingSegments) {
          stateStore.delete(`start:${seg.sprintId}`);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Non-fatal delete failure
  }
}

export async function saveStartStateToVault(stateKey: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const db = await openVaultDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STATE_STORE, 'readwrite');
        tx.objectStore(STATE_STORE).put({ key: `start:${stateKey}`, bytes, savedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Non-fatal cache write failure
  }
}

export async function getStartStateFromVault(stateKey: string): Promise<Blob | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openVaultDb();
    let record: { key: string; bytes: Uint8Array } | null = null;
    try {
      record = await new Promise<{ key: string; bytes: Uint8Array } | null>((resolve, reject) => {
        const tx = db.transaction(STATE_STORE, 'readonly');
        const req = tx.objectStore(STATE_STORE).get(`start:${stateKey}`);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
    if (!record?.bytes) return null;
    const copy = new Uint8Array(record.bytes.byteLength);
    copy.set(record.bytes);
    return new Blob([copy.buffer], { type: 'application/octet-stream' });
  } catch {
    return null;
  }
}

export async function saveCustomSprintBoundsToVault(
  romId: string,
  bounds: CustomSprintBounds
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openVaultDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STATE_STORE, 'readwrite');
        tx.objectStore(STATE_STORE).put({
          key: `bounds:${romId}`,
          startWorldX: Math.max(0, Math.round(bounds.startWorldX)),
          goalWorldX: Math.max(160, Math.round(bounds.goalWorldX)),
          savedAt: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Non-fatal cache write failure
  }
}

export async function getCustomSprintBoundsFromVault(
  romId: string
): Promise<CustomSprintBounds | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openVaultDb();
    try {
      const record = await new Promise<{
        key: string;
        startWorldX?: number;
        goalWorldX?: number;
      } | null>((resolve, reject) => {
        const tx = db.transaction(STATE_STORE, 'readonly');
        const req = tx.objectStore(STATE_STORE).get(`bounds:${romId}`);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (
        record &&
        typeof record.startWorldX === 'number' &&
        typeof record.goalWorldX === 'number' &&
        record.goalWorldX > record.startWorldX
      ) {
        return {
          startWorldX: record.startWorldX,
          goalWorldX: record.goalWorldX,
        };
      }
      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}


const MAX_CUSTOM_SEGMENTS_PER_ROM = 5;

export async function listCustomSegmentsForRom(romId: string): Promise<CustomRomSegment[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const db = await openVaultDb();
    try {
      const record = await new Promise<{
        key: string;
        segments?: CustomRomSegment[];
      } | null>((resolve, reject) => {
        const tx = db.transaction(STATE_STORE, 'readonly');
        const req = tx.objectStore(STATE_STORE).get(`segments:${romId}`);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (!record || !Array.isArray(record.segments)) return [];
      return record.segments;
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

export async function saveCustomSegmentToVault(
  segment: CustomRomSegment,
  startStateBlob?: Blob
): Promise<CustomRomSegment[]> {
  if (typeof indexedDB === 'undefined') return [segment];
  try {
    const existing = await listCustomSegmentsForRom(segment.romId);
    const filtered = existing.filter(
      (s) => s.id !== segment.id && s.sprintId !== segment.sprintId
    );
    const nextSegments = [...filtered, segment].slice(-MAX_CUSTOM_SEGMENTS_PER_ROM);
    const stateBytes = startStateBlob
      ? new Uint8Array(await startStateBlob.arrayBuffer())
      : null;

    const db = await openVaultDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STATE_STORE, 'readwrite');
        const store = tx.objectStore(STATE_STORE);
        store.put({
          key: `segments:${segment.romId}`,
          segments: nextSegments,
          savedAt: Date.now(),
        });
        store.put({
          key: `bounds:${segment.romId}`,
          startWorldX: Math.max(0, Math.round(segment.startWorldX)),
          goalWorldX: Math.max(160, Math.round(segment.goalWorldX)),
          savedAt: Date.now(),
        });
        if (stateBytes) {
          store.put({
            key: `start:${segment.sprintId}`,
            bytes: stateBytes,
            savedAt: Date.now(),
          });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    return nextSegments;
  } catch {
    return [segment];
  }
}

export async function deleteCustomSegmentFromVault(
  romId: string,
  segmentId: string
): Promise<CustomRomSegment[]> {
  if (typeof indexedDB === 'undefined') return [];
  try {
    const existing = await listCustomSegmentsForRom(romId);
    const removed = existing.find((s) => s.id === segmentId);
    const nextSegments = existing.filter((s) => s.id !== segmentId);
    const db = await openVaultDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STATE_STORE, 'readwrite');
        const store = tx.objectStore(STATE_STORE);
        store.put({
          key: `segments:${romId}`,
          segments: nextSegments,
          savedAt: Date.now(),
        });
        if (removed) {
          store.delete(`start:${removed.sprintId}`);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
    return nextSegments;
  } catch {
    return [];
  }
}
