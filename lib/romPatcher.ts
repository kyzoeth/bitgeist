const MAX_PATCHED_ROM_BYTES = 16 * 1024 * 1024; // 16 MB safety ceiling

export function detectRomPatchFormat(
  fileName: string,
  bytes?: Uint8Array
): 'ips' | 'bps' | null {
  if (bytes && bytes.length >= 5) {
    if (
      bytes[0] === 0x50 && // 'P'
      bytes[1] === 0x41 && // 'A'
      bytes[2] === 0x54 && // 'T'
      bytes[3] === 0x43 && // 'C'
      bytes[4] === 0x48 // 'H'
    ) {
      return 'ips';
    }
    if (
      bytes[0] === 0x42 && // 'B'
      bytes[1] === 0x50 && // 'P'
      bytes[2] === 0x53 && // 'S'
      bytes[3] === 0x31 // '1'
    ) {
      return 'bps';
    }
  }
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.ips')) return 'ips';
  if (lower.endsWith('.bps')) return 'bps';
  return null;
}

export function applyIpsPatch(baseBytes: Uint8Array, patchBytes: Uint8Array): Uint8Array {
  if (
    patchBytes.length < 8 ||
    patchBytes[0] !== 0x50 ||
    patchBytes[1] !== 0x41 ||
    patchBytes[2] !== 0x54 ||
    patchBytes[3] !== 0x43 ||
    patchBytes[4] !== 0x48
  ) {
    throw new Error('Invalid .IPS patch file (missing "PATCH" header).');
  }

  let out = new Uint8Array(baseBytes.byteLength);
  out.set(baseBytes);

  const ensureCapacity = (requiredLen: number) => {
    if (requiredLen > MAX_PATCHED_ROM_BYTES) {
      throw new Error('Patched ROM exceeds the 16 MB cartridge limit.');
    }
    if (requiredLen <= out.length) return;
    const grown = new Uint8Array(requiredLen);
    grown.set(out);
    out = grown;
  };

  let ptr = 5;
  while (ptr < patchBytes.length) {
    // Check for "EOF" marker (0x45 0x4F 0x46)
    if (
      ptr + 3 <= patchBytes.length &&
      patchBytes[ptr] === 0x45 &&
      patchBytes[ptr + 1] === 0x4f &&
      patchBytes[ptr + 2] === 0x46
    ) {
      ptr += 3;
      // Optional 3-byte Lunar IPS truncation extension
      if (ptr + 3 === patchBytes.length) {
        const truncLen =
          (patchBytes[ptr] << 16) | (patchBytes[ptr + 1] << 8) | patchBytes[ptr + 2];
        if (truncLen > 0 && truncLen <= MAX_PATCHED_ROM_BYTES) {
          if (truncLen < out.length) {
            out = out.slice(0, truncLen);
          } else {
            ensureCapacity(truncLen);
          }
        }
      }
      return out;
    }

    if (ptr + 5 > patchBytes.length) {
      throw new Error('Corrupt .IPS patch (unexpected end of file before EOF marker).');
    }

    const offset =
      (patchBytes[ptr] << 16) | (patchBytes[ptr + 1] << 8) | patchBytes[ptr + 2];
    const size = (patchBytes[ptr + 3] << 8) | patchBytes[ptr + 4];
    ptr += 5;

    if (size === 0) {
      // RLE record: 2-byte count + 1-byte value
      if (ptr + 3 > patchBytes.length) {
        throw new Error('Corrupt .IPS patch (truncated RLE hunk).');
      }
      const rleCount = (patchBytes[ptr] << 8) | patchBytes[ptr + 1];
      const rleVal = patchBytes[ptr + 2];
      ptr += 3;
      ensureCapacity(offset + rleCount);
      out.fill(rleVal, offset, offset + rleCount);
    } else {
      if (ptr + size > patchBytes.length) {
        throw new Error('Corrupt .IPS patch (truncated data hunk).');
      }
      ensureCapacity(offset + size);
      out.set(patchBytes.subarray(ptr, ptr + size), offset);
      ptr += size;
    }
  }

  return out;
}

export function applyBpsPatch(baseBytes: Uint8Array, patchBytes: Uint8Array): Uint8Array {
  if (
    patchBytes.length < 19 ||
    patchBytes[0] !== 0x42 ||
    patchBytes[1] !== 0x50 ||
    patchBytes[2] !== 0x53 ||
    patchBytes[3] !== 0x31
  ) {
    throw new Error('Invalid .BPS patch file (missing "BPS1" header).');
  }

  const bodyEnd = patchBytes.length - 12; // 3 x CRC32 footer
  let ptr = 4;

  const readVarInt = (): number => {
    let data = 0;
    let shift = 1;
    while (true) {
      if (ptr >= bodyEnd) {
        throw new Error('Corrupt .BPS patch (truncated variable-length integer).');
      }
      const x = patchBytes[ptr++];
      data += (x & 0x7f) * shift;
      if ((x & 0x80) !== 0) break;
      shift *= 128;
      data += shift;
    }
    return data;
  };

  const sourceSize = readVarInt();
  const targetSize = readVarInt();
  const metadataLen = readVarInt();

  if (targetSize <= 0 || targetSize > MAX_PATCHED_ROM_BYTES) {
    throw new Error('Invalid .BPS target size (exceeds 16 MB cartridge limit).');
  }
  if (ptr + metadataLen > bodyEnd) {
    throw new Error('Corrupt .BPS patch (truncated metadata block).');
  }
  ptr += metadataLen;

  // Allow iNES 16-byte header offset if patch expects raw PRG+CHR or vice versa
  let effectiveBase = baseBytes;
  if (sourceSize !== baseBytes.length && baseBytes.length === sourceSize + 16) {
    effectiveBase = baseBytes.subarray(16);
  }

  const target = new Uint8Array(targetSize);
  let outputOffset = 0;
  let sourceRelativeOffset = 0;
  let targetRelativeOffset = 0;

  while (ptr < bodyEnd) {
    const command = readVarInt();
    const action = command & 3;
    let length = (command >> 2) + 1;

    if (outputOffset + length > targetSize) {
      throw new Error('Corrupt .BPS patch (command writes past target size).');
    }

    if (action === 0) {
      // SourceRead
      for (let i = 0; i < length; i++) {
        target[outputOffset] = effectiveBase[outputOffset] ?? 0;
        outputOffset++;
      }
    } else if (action === 1) {
      // TargetRead
      if (ptr + length > bodyEnd) {
        throw new Error('Corrupt .BPS patch (truncated TargetRead payload).');
      }
      target.set(patchBytes.subarray(ptr, ptr + length), outputOffset);
      ptr += length;
      outputOffset += length;
    } else if (action === 2) {
      // SourceCopy
      const rawOffset = readVarInt();
      const signedDelta = (rawOffset & 1 ? -1 : 1) * (rawOffset >> 1);
      sourceRelativeOffset += signedDelta;
      while (length-- > 0) {
        target[outputOffset++] = effectiveBase[sourceRelativeOffset++] ?? 0;
      }
    } else {
      // TargetCopy
      const rawOffset = readVarInt();
      const signedDelta = (rawOffset & 1 ? -1 : 1) * (rawOffset >> 1);
      targetRelativeOffset += signedDelta;
      while (length-- > 0) {
        target[outputOffset++] = target[targetRelativeOffset++] ?? 0;
      }
    }
  }

  return target;
}

export function applyRomPatchBytes(
  baseBytes: Uint8Array,
  patchBytes: Uint8Array,
  patchFileName = 'patch.ips'
): { bytes: Uint8Array; format: 'ips' | 'bps' } {
  const format = detectRomPatchFormat(patchFileName, patchBytes);
  if (format === 'ips') {
    return { bytes: applyIpsPatch(baseBytes, patchBytes), format: 'ips' };
  }
  if (format === 'bps') {
    return { bytes: applyBpsPatch(baseBytes, patchBytes), format: 'bps' };
  }
  throw new Error('Unsupported patch format. Drop a valid .IPS or .BPS ROM patch file.');
}
