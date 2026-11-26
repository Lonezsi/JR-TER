/* A zip writer and reader, small enough to read in one sitting.
 *
 * Writing stores files as they are (no compression: the bulk is audio, which is already
 * compressed), with a CRC-32 per file, which is all any unzip needs. Reading takes stored
 * and deflated entries, the two kinds Python's zipfile writes, deflate through the
 * browser's own DecompressionStream. No zip64: a guest library over 4 GB is not one a
 * browser would have agreed to keep.
 */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function dosTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export type Entry = { name: string; data: Blob | string | Uint8Array };

/** One zip, as a Blob, from a list of names and contents. */
export async function zip(entries: Entry[], when = new Date()): Promise<Blob> {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const bytes = typeof entry.data === "string" ? enc.encode(entry.data)
      : entry.data instanceof Uint8Array ? entry.data : new Uint8Array(await entry.data.arrayBuffer());
    const crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);          // names are UTF-8
    local.setUint16(8, 0, true);               // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer as ArrayBuffer, name as BlobPart, bytes as BlobPart);

    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 20, true);
    head.setUint16(8, 0x0800, true);
    head.setUint16(10, 0, true);
    head.setUint16(12, time, true);
    head.setUint16(14, date, true);
    head.setUint32(16, crc, true);
    head.setUint32(20, bytes.length, true);
    head.setUint32(24, bytes.length, true);
    head.setUint16(28, name.length, true);
    head.setUint32(42, offset, true);
    const row = new Uint8Array(46 + name.length);
    row.set(new Uint8Array(head.buffer), 0);
    row.set(name, 46);
    central.push(row);
    offset += 30 + name.length + bytes.length;
  }
  const size = central.reduce((s, r) => s + r.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central.map((r) => r as BlobPart), end.buffer as ArrayBuffer], { type: "application/zip" });
}

export interface Unzipped { names: string[]; blob(name: string): Promise<Blob | null>; text(name: string): Promise<string | null> }

/** Read a zip's directory, and each file only when it is asked for. */
export async function unzip(file: Blob): Promise<Unzipped> {
  const tailSize = Math.min(file.size, 22 + 65535);
  const tail = new DataView(await file.slice(file.size - tailSize).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That is not a zip file.");
  const count = tail.getUint16(eocd + 10, true);
  const dirSize = tail.getUint32(eocd + 12, true);
  const dirAt = tail.getUint32(eocd + 16, true);
  const dir = new DataView(await file.slice(dirAt, dirAt + dirSize).arrayBuffer());
  const dec = new TextDecoder();
  const found = new Map<string, { method: number; size: number; at: number }>();
  let p = 0;
  for (let n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (dir.getUint32(p, true) !== 0x02014b50) break;
    const method = dir.getUint16(p + 10, true);
    const size = dir.getUint32(p + 20, true);
    const nameLen = dir.getUint16(p + 28, true), extraLen = dir.getUint16(p + 30, true), commentLen = dir.getUint16(p + 32, true);
    const at = dir.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    found.set(name, { method, size, at });
    p += 46 + nameLen + extraLen + commentLen;
  }
  async function blob(name: string): Promise<Blob | null> {
    const e = found.get(name);
    if (!e) return null;
    const local = new DataView(await file.slice(e.at, e.at + 30).arrayBuffer());
    const start = e.at + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    const raw = file.slice(start, start + e.size);
    if (e.method === 0) return raw;
    if (e.method === 8) {
      const stream = raw.stream().pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
      return new Response(stream).blob();
    }
    throw new Error(`${name} is packed in a way this cannot read.`);
  }
  return {
    names: [...found.keys()],
    blob,
    async text(name) { const b = await blob(name); return b ? b.text() : null; },
  };
}
