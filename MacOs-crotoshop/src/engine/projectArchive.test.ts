import { describe, expect, it } from 'vitest';
import { crc32, decodeProjectArchive, encodeProjectArchive } from './projectArchive';

describe('project archive', () => {
  it('matches the standard CRC-32 check vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips a manifest and binary assets', async () => {
    const manifest = new TextEncoder().encode('{"format":"crotoshop-project","version":3}');
    const archive = encodeProjectArchive(manifest, [new Blob([new Uint8Array([1, 2, 3])])]);
    const decoded = await decodeProjectArchive(archive);
    expect(decoded?.manifest).toBe(new TextDecoder().decode(manifest));
    expect([...new Uint8Array(await decoded!.assets[0].arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it('rejects a changed manifest even when it remains valid JSON', async () => {
    const manifest = new TextEncoder().encode('{"name":"A"}');
    const bytes = new Uint8Array(await encodeProjectArchive(manifest, []).arrayBuffer());
    bytes[20 + manifest.indexOf('A'.charCodeAt(0))] = 'B'.charCodeAt(0);
    await expect(decodeProjectArchive(new Blob([bytes]))).rejects.toThrow('checksum del manifiesto');
  });

  it('rejects truncated resources', async () => {
    const manifest = new TextEncoder().encode('{"name":"A"}');
    const archive = encodeProjectArchive(manifest, [new Blob([new Uint8Array([1, 2, 3])])]);
    await expect(decodeProjectArchive(archive.slice(0, archive.size - 1))).rejects.toThrow('tamaño de recurso');
  });

  it('keeps reading the checksum-less v2 container', async () => {
    const manifest = new TextEncoder().encode('{"version":2}');
    const header = new Uint8Array(new ArrayBuffer(16));
    header.set(new TextEncoder().encode('CROTO2\r\n'));
    const view = new DataView(header.buffer);
    view.setUint32(8, manifest.byteLength, true);
    view.setUint32(12, 0, true);
    const ownedManifest = new Uint8Array(new ArrayBuffer(manifest.byteLength));
    ownedManifest.set(manifest);
    const decoded = await decodeProjectArchive(new Blob([header, ownedManifest]));
    expect(decoded?.manifest).toBe('{"version":2}');
  });
});
