import { describe, expect, it } from 'vitest';
import { CoverUrlCache } from './coverUrls';

function make(maxIdle: number) {
  let n = 0;
  const revoked: string[] = [];
  const cache = new CoverUrlCache(maxIdle, () => `blob:${n++}`, (u) => revoked.push(u));
  return { cache, revoked };
}
const blob = new Blob(['x']);

describe('CoverUrlCache', () => {
  it('creates one URL per key and shares it between holders', () => {
    const { cache } = make(2);
    const a = cache.acquire('a', blob);
    expect(cache.acquire('a', blob)).toBe(a);
    expect(cache.size).toBe(1);
  });
  it('keeps released URLs idle up to the cap, then revokes the least recently used', () => {
    const { cache, revoked } = make(2);
    for (const k of ['a', 'b', 'c']) cache.acquire(k, blob);
    cache.release('a');
    cache.release('b');
    expect(revoked).toEqual([]);
    cache.release('c'); // 3 idle > 2 -> evict oldest idle ("a")
    expect(revoked).toEqual(['blob:0']);
    expect(cache.size).toBe(2);
  });
  it('never revokes a URL that is still referenced', () => {
    const { cache, revoked } = make(0);
    cache.acquire('a', blob);
    cache.acquire('a', blob);
    cache.release('a');
    expect(revoked).toEqual([]);
    cache.release('a');
    expect(revoked).toEqual(['blob:0']);
  });
  it('re-acquiring an idle URL reuses it and refreshes its recency', () => {
    const { cache, revoked } = make(1);
    cache.acquire('a', blob);
    cache.acquire('b', blob);
    cache.release('a');
    cache.release('b'); // idle: a, b -> evict a
    expect(revoked).toEqual(['blob:0']);
    expect(cache.acquire('b', blob)).toBe('blob:1');
    expect(cache.release('nope')).toBeUndefined();
  });
});
