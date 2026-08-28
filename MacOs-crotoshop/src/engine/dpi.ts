/**
 * Embeds physical resolution metadata into encoded images:
 * - PNG: inserts/replaces a pHYs chunk (pixels per metre).
 * - JPEG: patches/creates the JFIF APP0 density fields (dots per inch).
 * WEBP has no widely-honoured density header, so it is returned untouched.
 */

const CM_PER_INCH = 2.54;

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function setPngDpi(bytes: Uint8Array, ppi: number): Uint8Array {
  // PNG: 8-byte signature, then chunks: len(4) type(4) data(len) crc(4).
  // IHDR is always first; insert pHYs right after it.
  const ppm = Math.round((ppi / CM_PER_INCH) * 100); // pixels per metre

  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  writeU32(chunk, 0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  writeU32(chunk, 8, ppm);
  writeU32(chunk, 12, ppm);
  chunk[16] = 1; // unit: metre
  writeU32(chunk, 17, crc32(chunk.subarray(4, 17)));

  // Walk chunks: find end of IHDR and any existing pHYs to drop.
  let pos = 8;
  let insertAt = -1;
  let physStart = -1;
  let physEnd = -1;
  while (pos + 8 <= bytes.length) {
    const len =
      (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const next = pos + 12 + len;
    if (type === 'IHDR') insertAt = next;
    if (type === 'pHYs') { physStart = pos; physEnd = next; }
    if (type === 'IDAT' || type === 'IEND') break;
    pos = next;
  }
  if (insertAt < 0) return bytes;

  const parts: Uint8Array[] = [];
  if (physStart >= 0) {
    // Replace an existing pHYs wherever the encoder placed it.
    parts.push(bytes.subarray(0, physStart), chunk, bytes.subarray(physEnd));
  } else {
    parts.push(bytes.subarray(0, insertAt), chunk, bytes.subarray(insertAt));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function ensurePngSrgb(bytes: Uint8Array): Uint8Array {
  let pos = 8;
  let insertAt = -1;
  while (pos + 12 <= bytes.length) {
    const len = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const next = pos + 12 + len;
    if (next > bytes.length) return bytes;
    if (type === 'IHDR') insertAt = next;
    if (type === 'sRGB' || type === 'iCCP') return bytes;
    if (type === 'IDAT' || type === 'IEND') break;
    pos = next;
  }
  if (insertAt < 0) return bytes;
  const chunk = new Uint8Array(13);
  writeU32(chunk, 0, 1);
  chunk.set([0x73, 0x52, 0x47, 0x42], 4); // sRGB
  chunk[8] = 0; // perceptual rendering intent
  writeU32(chunk, 9, crc32(chunk.subarray(4, 9)));
  const output = new Uint8Array(bytes.length + chunk.length);
  output.set(bytes.subarray(0, insertAt), 0);
  output.set(chunk, insertAt);
  output.set(bytes.subarray(insertAt), insertAt + chunk.length);
  return output;
}

function setJpegDpi(bytes: Uint8Array, ppi: number): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  // Look for an APP0/JFIF segment right after SOI.
  if (bytes[2] === 0xff && bytes[3] === 0xe0 && bytes.length > 17 &&
      bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46) {
    const out = bytes.slice();
    out[13] = 1; // density units: dots per inch
    out[14] = (ppi >>> 8) & 0xff;
    out[15] = ppi & 0xff;
    out[16] = (ppi >>> 8) & 0xff;
    out[17] = ppi & 0xff;
    return out;
  }
  // No JFIF header: insert a minimal APP0 after SOI.
  const app0 = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, // 'JFIF\0'
    0x01, 0x01,                   // version 1.1
    0x01,                         // units: dpi
    (ppi >>> 8) & 0xff, ppi & 0xff,
    (ppi >>> 8) & 0xff, ppi & 0xff,
    0x00, 0x00,                   // no thumbnail
  ]);
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

/** Returns a new Blob with the resolution metadata embedded (when supported). */
export async function embedDpi(blob: Blob, format: string, ppi: number): Promise<Blob> {
  if (format !== 'image/png' && format !== 'image/jpeg') return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const out = format === 'image/png' ? ensurePngSrgb(setPngDpi(bytes, ppi)) : setJpegDpi(bytes, ppi);
  return new Blob([out.buffer as ArrayBuffer], { type: format });
}
