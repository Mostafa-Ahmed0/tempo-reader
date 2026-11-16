/**
 * Zip helpers: a tiny central-directory reader (used for format sniffing and zip-bomb checks without
 * loading JSZip) and a guarded JSZip wrapper (JSZip itself is loaded with a dynamic import).
 */
import type JSZipType from 'jszip';
import { ParseError, corrupt, tooLarge } from './errors';

export interface ZipEntryInfo {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
}

/** Limits for archives (declared sizes from the central directory). */
export const ZIP_LIMITS = {
  maxEntries: 20_000,
  maxTotalUncompressed: 1_000_000_000,
  maxEntryUncompressed: 256 * 1024 * 1024,
  /** entries we actually read as text */
  maxTextEntry: 64 * 1024 * 1024,
  /** compression ratio above which a big entry is treated as a bomb */
  maxRatio: 1000,
};

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b: Uint8Array, o: number) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

/** List entries from the central directory. Returns null if this is not a readable zip. */
export function listZipEntries(bytes: Uint8Array): ZipEntryInfo[] | null {
  const n = bytes.length;
  if (n < 22) return null;
  let eocd = -1;
  for (let i = n - 22; i >= Math.max(0, n - 22 - 0xffff); i--) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  let count = u16(bytes, eocd + 10);
  let cdOffset = u32(bytes, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) {
    // Zip64 locator sits right before the EOCD record.
    const loc = eocd - 20;
    if (loc >= 0 && u32(bytes, loc) === 0x07064b50) {
      const z64 = u64(bytes, loc + 8);
      if (z64 + 56 <= n && u32(bytes, z64) === 0x06064b50) {
        count = u64(bytes, z64 + 32);
        cdOffset = u64(bytes, z64 + 48);
      }
    }
  }
  if (count > ZIP_LIMITS.maxEntries) throw tooLarge('This archive contains too many files.');
  const entries: ZipEntryInfo[] = [];
  let p = cdOffset;
  const dec = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (p + 46 > n || u32(bytes, p) !== 0x02014b50) return entries.length ? entries : null;
    const method = u16(bytes, p + 10);
    let comp = u32(bytes, p + 20);
    let uncomp = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (uncomp === 0xffffffff || comp === 0xffffffff) {
      // zip64 extended info extra field
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = u16(bytes, e);
        const size = u16(bytes, e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncomp === 0xffffffff) {
            uncomp = u64(bytes, q);
            q += 8;
          }
          if (comp === 0xffffffff) comp = u64(bytes, q);
          break;
        }
        e += 4 + size;
      }
    }
    entries.push({ name, compressedSize: comp, uncompressedSize: uncomp, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Throw if the declared sizes look like a zip bomb or are simply too big for a phone. */
export function checkZipLimits(entries: ZipEntryInfo[]): void {
  let total = 0;
  for (const e of entries) {
    total += e.uncompressedSize;
    if (e.uncompressedSize > ZIP_LIMITS.maxEntryUncompressed) throw tooLarge('This archive contains a file that is too large.');
    if (e.uncompressedSize > 20 * 1024 * 1024 && e.uncompressedSize / Math.max(1, e.compressedSize) > ZIP_LIMITS.maxRatio) {
      throw tooLarge('This archive expands to an unreasonable size.');
    }
  }
  if (total > ZIP_LIMITS.maxTotalUncompressed) throw tooLarge('This archive expands to an unreasonable size.');
}

export interface ZipArchive {
  names: string[];
  has(path: string): boolean;
  /** Case-insensitive lookup; returns the real entry name. */
  find(path: string): string | null;
  text(path: string): Promise<string>;
  bytes(path: string): Promise<Uint8Array>;
  size(path: string): number;
}

/** Open a zip with limits checked first. `what` is the user-facing format name for error messages. */
export async function openZip(bytes: Uint8Array, what: string): Promise<ZipArchive> {
  const entries = listZipEntries(bytes);
  if (!entries) throw corrupt(what);
  checkZipLimits(entries);
  const sizes = new Map(entries.map((e) => [e.name, e.uncompressedSize]));
  const { default: JSZip } = await import('jszip');
  let zip: JSZipType;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (e) {
    throw corrupt(what, e);
  }
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const find = (path: string) => (zip.files[path] && !zip.files[path].dir ? path : (lower.get(path.toLowerCase()) ?? null));
  const get = (path: string) => {
    const real = find(path);
    if (!real) throw new ParseError('corrupt', `This ${what} file is incomplete (missing ${path}). Try re-downloading it.`);
    const size = sizes.get(real) ?? 0;
    if (size > ZIP_LIMITS.maxTextEntry) throw tooLarge(`A part of this ${what} is too large.`);
    return zip.files[real];
  };
  return {
    names,
    has: (p) => find(p) !== null,
    find,
    size: (p) => sizes.get(find(p) ?? '') ?? 0,
    async text(p) {
      try {
        return await get(p).async('string');
      } catch (e) {
        if (e instanceof ParseError) throw e;
        throw corrupt(what, e);
      }
    },
    async bytes(p) {
      try {
        return await get(p).async('uint8array');
      } catch (e) {
        if (e instanceof ParseError) throw e;
        throw corrupt(what, e);
      }
    },
  };
}

/** Resolve a relative href against the directory of `base` (both zip paths). Strips fragment & decodes %xx. */
export function resolveZipPath(base: string, href: string): string {
  let h = href.split('#')[0];
  try {
    h = decodeURIComponent(h);
  } catch {
    /* keep raw */
  }
  if (h.startsWith('/')) return normalizeZipPath(h.slice(1));
  const dir = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '';
  return normalizeZipPath(dir + h);
}

function normalizeZipPath(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}
