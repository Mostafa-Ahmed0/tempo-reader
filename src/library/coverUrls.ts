/**
 * Reference-counted cache of cover object URLs with an LRU cap.
 *
 * - `acquire(key, blob)` returns an object URL and bumps its reference count (creating it once).
 * - `release(key)` drops a reference. Unreferenced URLs stay cached (so scrolling back is instant)
 *   until more than `maxIdle` unreferenced URLs exist; then the least recently used are revoked.
 *
 * BookCover holds a reference only while the cover is on screen (plus a short grace period), so the
 * number of live URLs is bounded by "visible covers + maxIdle" instead of "every cover ever seen".
 */
export class CoverUrlCache {
  private entries = new Map<string, { url: string; refs: number }>(); // Map keeps insertion order = LRU order
  constructor(
    readonly maxIdle = 60,
    private create: (b: Blob) => string = (b) => URL.createObjectURL(b),
    private revoke: (u: string) => void = (u) => URL.revokeObjectURL(u),
  ) {}

  acquire(key: string, blob: Blob): string {
    let e = this.entries.get(key);
    if (e) this.entries.delete(key); // move to the most-recent end
    else e = { url: this.create(blob), refs: 0 };
    e.refs++;
    this.entries.set(key, e);
    return e.url;
  }

  release(key: string): void {
    const e = this.entries.get(key);
    if (!e) return;
    e.refs = Math.max(0, e.refs - 1);
    if (e.refs === 0) {
      this.entries.delete(key);
      this.entries.set(key, e); // most recently used idle entry
      this.evict();
    }
  }

  private evict(): void {
    let idle = 0;
    for (const e of this.entries.values()) if (e.refs === 0) idle++;
    for (const [k, e] of this.entries) {
      if (idle <= this.maxIdle) break;
      if (e.refs > 0) continue;
      this.revoke(e.url);
      this.entries.delete(k);
      idle--;
    }
  }

  /** Number of URLs currently alive (referenced or idle). */
  get size(): number {
    return this.entries.size;
  }
}

export const coverUrls = new CoverUrlCache(60);
