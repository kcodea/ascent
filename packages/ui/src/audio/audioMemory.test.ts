/**
 * R-AUDIO-MEMORY-01 (audio memory pass 2026-10-29; owner: "smooth early, hitchy late, worse on phones"). The
 * announcer's decoded lines stay bounded however many lines a game speaks, and a phone's decodes are paced so the
 * stereo garbage of each mono fold never piles up, without making a sound the player is waiting on wait.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANNOUNCER_LINE_CACHE, createLineCache } from './lineCache';
import { pacedQueue, PHONE_DECODE_GAP_MS } from './phoneAudio';

const MB = 1024 * 1024;
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('announcer line cache (R-AUDIO-MEMORY-01)', () => {
  const make = (bytesEach = MB) => {
    const loads: string[] = [];
    const cache = createLineCache<{ url: string; bytes: number }>(
      (url) => { loads.push(url); return url.includes('missing') ? Promise.reject(new Error('404')) : Promise.resolve({ url, bytes: bytesEach }); },
      (b) => b.bytes,
    );
    return { cache, loads };
  };

  it('stays bounded after 500 lines, each played to its end', async () => {
    const { cache } = make();
    for (let i = 0; i < 500; i++) {
      const url = `/announcer/line${i}.mp3`;
      expect(await cache.acquire(url)).not.toBeNull();
      cache.release(url); // the line ended
      expect(cache.size()).toBeLessThanOrEqual(ANNOUNCER_LINE_CACHE.maxEntries);
      expect(cache.bytes()).toBeLessThanOrEqual(ANNOUNCER_LINE_CACHE.maxBytes);
    }
    expect(cache.size()).toBeGreaterThan(0); // the recent ones stay, for a quick repeat
  });

  it('respects the byte cap for big lines', async () => {
    const { cache } = make(2.5 * MB);
    for (let i = 0; i < 20; i++) { const u = `/announcer/big${i}.mp3`; await cache.acquire(u); cache.release(u); }
    expect(cache.bytes()).toBeLessThanOrEqual(ANNOUNCER_LINE_CACHE.maxBytes);
  });

  it('never drops a line that is still sounding', async () => {
    const { cache, loads } = make();
    const playing = '/announcer/long.mp3';
    await cache.acquire(playing); // never released: it is still playing
    for (let i = 0; i < 40; i++) { const u = `/announcer/x${i}.mp3`; await cache.acquire(u); cache.release(u); }
    await cache.acquire(playing);
    expect(loads.filter((u) => u === playing)).toHaveLength(1);
  });

  it('reuses a recent line instead of decoding it again', async () => {
    const { cache, loads } = make();
    await cache.acquire('/announcer/a.mp3'); cache.release('/announcer/a.mp3');
    await cache.acquire('/announcer/a.mp3'); cache.release('/announcer/a.mp3');
    expect(loads).toEqual(['/announcer/a.mp3']);
  });

  it('remembers a failed file by name only, and does not fetch it again', async () => {
    const { cache, loads } = make();
    expect(await cache.acquire('/announcer/pack/missing.mp3')).toBeNull();
    cache.release('/announcer/pack/missing.mp3');
    expect(await cache.acquire('/announcer/pack/missing.mp3')).toBeNull();
    expect(loads).toHaveLength(1);
    expect(cache.size()).toBe(0);
    expect(cache.bytes()).toBe(0);
  });

  it('the announcer plays through the cache (no unbounded Map of decoded lines)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'announcer.ts'), 'utf8');
    expect(src).toContain('createLineCache');
    expect(src).not.toMatch(/new Map<string, Promise<AudioBuffer/);
  });
});

describe('paced phone decodes (R-AUDIO-MEMORY-01)', () => {
  it('pauses between decodes, one at a time', async () => {
    const log: string[] = [];
    const waits: (() => void)[] = [];
    const q = pacedQueue(PHONE_DECODE_GAP_MS, () => new Promise<void>((r) => { log.push('gap'); waits.push(r); }));
    let inFlight = 0;
    const job = (n: string) => () => { inFlight++; expect(inFlight).toBe(1); log.push(n); inFlight--; return Promise.resolve(n); };
    const done = Promise.all([q(job('a')), q(job('b')), q(job('c'))]);
    await flush();
    expect(log).toEqual(['a', 'gap']);
    waits.shift()!(); await flush();
    expect(log).toEqual(['a', 'gap', 'b', 'gap']);
    waits.shift()!(); await flush();
    expect(await done).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a', 'gap', 'b', 'gap', 'c']);
  });

  it('an urgent decode (a play waiting on it) jumps the bank and skips the pause', async () => {
    const log: string[] = [];
    const waits: (() => void)[] = [];
    const q = pacedQueue(PHONE_DECODE_GAP_MS, () => new Promise<void>((r) => { log.push('gap'); waits.push(r); }));
    const job = (n: string) => () => { log.push(n); return Promise.resolve(n); };
    void q(job('bank1')); void q(job('bank2')); void q(job('bank3'));
    await flush();
    expect(log).toEqual(['bank1', 'gap']);
    void q(job('now1'), true); void q(job('now2'), true);
    waits.shift()!(); await flush();
    // The waiting pause ends, then both urgent decodes run back to back before the bank resumes.
    expect(log.slice(0, 5)).toEqual(['bank1', 'gap', 'now1', 'now2', 'gap']);
  });

  it('a failed decode never stops the ones behind it', async () => {
    const q = pacedQueue(0);
    const bad = q(() => Promise.reject(new Error('corrupt')));
    const good = q(() => Promise.resolve('ok'));
    await expect(bad).rejects.toThrow('corrupt');
    await expect(good).resolves.toBe('ok');
  });
});
