const MAGIC_V2 = new TextEncoder().encode('CROTO2\r\n');
const MAGIC_V3 = new TextEncoder().encode('CROTO3\r\n');
const HEADER_V2_BYTES = 16;
const HEADER_V3_BYTES = 20;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ASSET_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ASSET_COUNT = 500;

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}

export class InvalidProject extends Error {
  constructor(detail: string) {
    super(`Proyecto crotoshop inválido (${detail})`);
  }
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function hasMagic(header: Uint8Array, magic: Uint8Array): boolean {
  return magic.every((byte, index) => header[index] === byte);
}

export function encodeProjectArchive(manifest: Uint8Array, assets: Blob[]): Blob {
  if (manifest.byteLength < 2 || manifest.byteLength > MAX_MANIFEST_BYTES) {
    throw new Error('El proyecto tiene demasiados metadatos');
  }
  if (assets.length > MAX_ASSET_COUNT) throw new Error('El proyecto tiene demasiados recursos');
  const ownedManifest = new Uint8Array(new ArrayBuffer(manifest.byteLength));
  ownedManifest.set(manifest);
  const header = new Uint8Array(new ArrayBuffer(HEADER_V3_BYTES));
  header.set(MAGIC_V3, 0);
  const view = new DataView(header.buffer);
  view.setUint32(8, manifest.byteLength, true);
  view.setUint32(12, assets.length, true);
  view.setUint32(16, crc32(ownedManifest), true);
  const parts: BlobPart[] = [header, ownedManifest];
  let totalBytes = header.byteLength + manifest.byteLength;
  for (const asset of assets) {
    if (asset.size < 1 || asset.size > MAX_ASSET_BYTES) throw new Error('Una capa es demasiado grande para guardar');
    const length = new Uint8Array(new ArrayBuffer(4));
    new DataView(length.buffer).setUint32(0, asset.size, true);
    parts.push(length, asset);
    totalBytes += length.byteLength + asset.size;
    if (totalBytes > MAX_ARCHIVE_BYTES) throw new Error('El proyecto supera el tamaño máximo permitido');
  }
  return new Blob(parts, { type: 'application/x-crotoshop' });
}

export async function decodeProjectArchive(blob: Blob): Promise<{ manifest: string; assets: Blob[] } | null> {
  if (blob.size > MAX_ARCHIVE_BYTES) throw new InvalidProject('archivo demasiado grande');
  if (blob.size < HEADER_V2_BYTES) return null;
  const header = new Uint8Array(await blob.slice(0, Math.min(blob.size, HEADER_V3_BYTES)).arrayBuffer());
  const isV3 = header.byteLength >= HEADER_V3_BYTES && hasMagic(header, MAGIC_V3);
  const isV2 = hasMagic(header, MAGIC_V2);
  if (!isV2 && !isV3) return null;

  const headerBytes = isV3 ? HEADER_V3_BYTES : HEADER_V2_BYTES;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const manifestBytes = view.getUint32(8, true);
  const assetCount = view.getUint32(12, true);
  if (manifestBytes < 2 || manifestBytes > MAX_MANIFEST_BYTES) throw new InvalidProject('manifiesto');
  if (assetCount > MAX_ASSET_COUNT) throw new InvalidProject('cantidad de recursos');
  let offset = headerBytes;
  const manifestEnd = offset + manifestBytes;
  if (manifestEnd > blob.size) throw new InvalidProject('manifiesto truncado');
  const manifestData = new Uint8Array(await blob.slice(offset, manifestEnd).arrayBuffer());
  if (isV3 && crc32(manifestData) !== view.getUint32(16, true)) throw new InvalidProject('checksum del manifiesto');
  offset = manifestEnd;

  const assets: Blob[] = [];
  for (let index = 0; index < assetCount; index += 1) {
    if (offset + 4 > blob.size) throw new InvalidProject('recurso truncado');
    const lengthBytes = await blob.slice(offset, offset + 4).arrayBuffer();
    const length = new DataView(lengthBytes).getUint32(0, true);
    offset += 4;
    if (length < 1 || length > MAX_ASSET_BYTES || offset + length > blob.size) {
      throw new InvalidProject('tamaño de recurso');
    }
    assets.push(blob.slice(offset, offset + length, 'image/png'));
    offset += length;
  }
  if (offset !== blob.size) throw new InvalidProject('datos sobrantes');
  return { manifest: new TextDecoder().decode(manifestData), assets };
}
