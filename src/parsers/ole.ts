/**
 * Minimal OLE2 / Compound File Binary reader ([MS-CFB]): FAT, DIFAT, mini stream, flat directory.
 * Enough to pull named streams out of legacy Office files.
 */

export const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

export interface OleEntry {
  name: string;
  type: number; // 1 storage, 2 stream, 5 root
  start: number;
  size: number;
}

export class OleFile {
  readonly entries: OleEntry[] = [];
  private readonly b: Uint8Array;
  private readonly dv: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: Uint32Array;
  private miniFat: Uint32Array = new Uint32Array(0);
  private miniStream: Uint8Array = new Uint8Array(0);

  constructor(bytes: Uint8Array) {
    this.b = bytes;
    this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 512 || !OLE_MAGIC.every((v, i) => bytes[i] === v)) throw new Error('not an OLE file');
    const shift = this.u16(0x1e);
    const miniShift = this.u16(0x20);
    if (shift !== 9 && shift !== 12) throw new Error('bad sector size');
    this.sectorSize = 1 << shift;
    this.miniSectorSize = 1 << miniShift;
    this.miniCutoff = this.u32(0x38) || 4096;
    const numFat = this.u32(0x2c);
    const firstDir = this.u32(0x30);
    const firstMiniFat = this.u32(0x3c);
    const numMiniFat = this.u32(0x40);
    let difatSector = this.u32(0x44);
    const numDifat = this.u32(0x48);
    const maxSectors = Math.ceil(bytes.length / this.sectorSize) + 1;
    if (numFat > maxSectors) throw new Error('bad FAT count');

    // DIFAT: 109 entries in the header, then a chain of DIFAT sectors.
    const fatSectors: number[] = [];
    for (let i = 0; i < 109 && fatSectors.length < numFat; i++) {
      const s = this.u32(0x4c + i * 4);
      if (s !== FREESECT) fatSectors.push(s);
    }
    const perDifat = this.sectorSize / 4 - 1;
    for (let d = 0; d < numDifat && difatSector < ENDOFCHAIN && fatSectors.length < numFat; d++) {
      const off = this.sectorOffset(difatSector);
      for (let i = 0; i < perDifat && fatSectors.length < numFat; i++) {
        const s = this.u32(off + i * 4);
        if (s !== FREESECT) fatSectors.push(s);
      }
      difatSector = this.u32(off + perDifat * 4);
    }
    const perSector = this.sectorSize / 4;
    this.fat = new Uint32Array(fatSectors.length * perSector);
    fatSectors.forEach((s, i) => {
      const off = this.sectorOffset(s);
      for (let j = 0; j < perSector; j++) this.fat[i * perSector + j] = off + j * 4 + 4 <= bytes.length ? this.u32(off + j * 4) : FREESECT;
    });

    // Directory
    const dir = this.readChain(firstDir, Infinity);
    for (let off = 0; off + 128 <= dir.length; off += 128) {
      const ddv = new DataView(dir.buffer, dir.byteOffset + off, 128);
      const nameLen = Math.min(64, ddv.getUint16(64, true));
      let name = '';
      for (let i = 0; i < nameLen - 2; i += 2) {
        const c = ddv.getUint16(i, true);
        if (c === 0) break;
        name += String.fromCharCode(c);
      }
      const type = dir[off + 66];
      const start = ddv.getUint32(116, true);
      const size = ddv.getUint32(120, true);
      this.entries.push({ name, type, start, size });
    }
    const root = this.entries[0];
    if (root && root.type === 5) {
      this.miniStream = this.readChain(root.start, root.size);
      if (numMiniFat > 0 && firstMiniFat < ENDOFCHAIN) {
        const mf = this.readChain(firstMiniFat, numMiniFat * this.sectorSize);
        this.miniFat = new Uint32Array(mf.length / 4);
        const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
        for (let i = 0; i < this.miniFat.length; i++) this.miniFat[i] = mdv.getUint32(i * 4, true);
      }
    }
  }

  private u16(o: number) {
    return this.dv.getUint16(o, true);
  }
  private u32(o: number) {
    return this.dv.getUint32(o, true);
  }
  private sectorOffset(s: number) {
    const off = (s + 1) * this.sectorSize;
    if (off >= this.b.length) throw new Error('sector out of range');
    return off;
  }

  /** Follow a FAT chain; stops at `size` bytes, ENDOFCHAIN, or a loop. */
  private readChain(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    let s = start;
    const seen = new Set<number>();
    while (s < ENDOFCHAIN - 2 && total < size) {
      if (seen.has(s) || s >= this.fat.length) break;
      seen.add(s);
      const off = (s + 1) * this.sectorSize;
      if (off >= this.b.length) break;
      const chunk = this.b.subarray(off, Math.min(off + this.sectorSize, this.b.length));
      parts.push(chunk);
      total += chunk.length;
      s = this.fat[s];
    }
    return concat(parts, Math.min(total, size));
  }

  private readMiniChain(start: number, size: number): Uint8Array {
    const parts: Uint8Array[] = [];
    let total = 0;
    let s = start;
    const seen = new Set<number>();
    while (s < ENDOFCHAIN - 2 && total < size) {
      if (seen.has(s) || s >= this.miniFat.length) break;
      seen.add(s);
      const off = s * this.miniSectorSize;
      if (off >= this.miniStream.length) break;
      const chunk = this.miniStream.subarray(off, Math.min(off + this.miniSectorSize, this.miniStream.length));
      parts.push(chunk);
      total += chunk.length;
      s = this.miniFat[s];
    }
    return concat(parts, Math.min(total, size));
  }

  find(name: string): OleEntry | undefined {
    const n = name.toLowerCase();
    return this.entries.find((e) => e.type === 2 && e.name.toLowerCase() === n);
  }

  /** Stream contents by name, or null. */
  stream(name: string): Uint8Array | null {
    const e = this.find(name);
    if (!e) return null;
    return e.size < this.miniCutoff ? this.readMiniChain(e.start, e.size) : this.readChain(e.start, e.size);
  }
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
  let p = 0;
  for (const part of parts) {
    const n = Math.min(part.length, size - p);
    if (n <= 0) break;
    out.set(part.subarray(0, n), p);
    p += n;
  }
  return out;
}

/** Read title/author from a \x05SummaryInformation property set stream. */
export function readSummaryInfo(stream: Uint8Array | null): { title?: string; author?: string } {
  if (!stream || stream.length < 48) return {};
  try {
    const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
    const sectionOffset = dv.getUint32(44, true);
    const count = dv.getUint32(sectionOffset + 4, true);
    let codepage = 1252;
    const props = new Map<number, number>();
    for (let i = 0; i < Math.min(count, 64); i++) {
      const pid = dv.getUint32(sectionOffset + 8 + i * 8, true);
      const off = dv.getUint32(sectionOffset + 12 + i * 8, true);
      props.set(pid, sectionOffset + off);
    }
    const cpOff = props.get(1);
    if (cpOff !== undefined && dv.getUint32(cpOff, true) === 2) codepage = dv.getInt16(cpOff + 4, true) & 0xffff;
    const str = (pid: number): string | undefined => {
      const o = props.get(pid);
      if (o === undefined) return undefined;
      const type = dv.getUint32(o, true);
      const len = dv.getUint32(o + 4, true);
      if (len > 4096) return undefined;
      let s: string;
      if (type === 0x1e) {
        const label = codepage === 65001 ? 'utf-8' : codepage === 1200 ? 'utf-16le' : `windows-${codepage}`;
        let dec: TextDecoder;
        try {
          dec = new TextDecoder(label);
        } catch {
          dec = new TextDecoder('windows-1252');
        }
        s = dec.decode(stream.subarray(o + 8, o + 8 + len));
      } else if (type === 0x1f) {
        s = new TextDecoder('utf-16le').decode(stream.subarray(o + 8, o + 8 + len * 2));
      } else return undefined;
      // eslint-disable-next-line no-control-regex
      return s.replace(/\u0000+$/, '').trim() || undefined;
    };
    return { title: str(2), author: str(4) };
  } catch {
    return {};
  }
}
