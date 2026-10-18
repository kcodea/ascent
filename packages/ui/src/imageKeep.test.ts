import { describe, expect, it } from 'vitest';
import { createImageKeep, decodedBytes } from './imageKeep';

/** The preloader's decoded-image hold: unbounded on desktop, a bounded LRU on a phone (owner 2026-10-18). */
describe('createImageKeep', () => {
  it('desktop (Infinity) keeps everything', () => {
    const k = createImageKeep<string>(Infinity);
    for (let i = 0; i < 2000; i++) k.set(`u${i}`, 'img', decodedBytes(512, 512));
    expect(k.stats().count).toBe(2000);
    expect(k.stats().evicted).toBe(0);
  });

  it('a budget evicts the least recently used first, and a get refreshes', () => {
    const k = createImageKeep<string>(3 * 100);
    k.set('a', 'A', 100);
    k.set('b', 'B', 100);
    k.set('c', 'C', 100);
    expect(k.get('a')).toBe('A'); // a is now the newest
    k.set('d', 'D', 100);
    expect(k.has('b')).toBe(false);
    expect(k.has('a') && k.has('c') && k.has('d')).toBe(true);
    expect(k.stats()).toMatchObject({ count: 3, bytes: 300, evicted: 1 });
  });

  it('re-holding a key replaces its size; one oversized item is still held', () => {
    const k = createImageKeep<string>(100);
    k.set('a', 'A', 60);
    k.set('a', 'A2', 40);
    expect(k.stats().bytes).toBe(40);
    k.set('big', 'B', 500);
    expect(k.has('big')).toBe(true);
    expect(k.stats().count).toBe(1);
  });

  it('decodedBytes is RGBA', () => {
    expect(decodedBytes(256, 256)).toBe(262144);
    expect(decodedBytes(0, 10)).toBe(0);
  });
});
