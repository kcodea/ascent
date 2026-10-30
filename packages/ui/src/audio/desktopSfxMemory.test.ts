/**
 * R-AUDIO-MEMORY-02 (desktop SFX memory pass 2026-10-29). Desktop used to decode and keep the WHOLE SFX bank from the
 * first click: 519 clips, 488 MB of PCM at a 96 kHz context. It now holds the resident bank (core + the FX every game
 * plays) and keeps every other clip in a byte-capped LRU, prewarmed ahead of its first play. These tests pin: the
 * cache stays bounded however many clips play, a sounding clip is never dropped, a resident clip is never dropped,
 * and sfx.ts wires the desktop path to it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createClipLru, DESKTOP_AUDIO_LRU_BYTES_48K, desktopLruCapBytes } from './clipLru';
import { sceneOf, type PrewarmStoreState } from './phonePrewarm';

const MB = 1024 * 1024;
const SRC = path.join(__dirname, '..');
const read = (f: string): string => fs.readFileSync(path.join(SRC, f), 'utf8');

interface Buf { bytes: number }
const make = (rate = 96000, resident: (n: string) => boolean = (n) => !n.includes('/')) => {
  const map = new Map<string, Buf>();
  const evicted: string[] = [];
  const lru = createClipLru<Buf>(map, { capBytes: () => desktopLruCapBytes(rate), isResident: resident, sizeOf: (b) => b.bytes, onEvict: (n) => evicted.push(n) });
  return { map, lru, evicted, cap: desktopLruCapBytes(rate) };
};

describe('desktop on-demand SFX cache (R-AUDIO-MEMORY-02)', () => {
  it('the cap holds the same seconds of audio at any context rate', () => {
    expect(desktopLruCapBytes(48000)).toBe(DESKTOP_AUDIO_LRU_BYTES_48K);
    expect(desktopLruCapBytes(96000)).toBe(2 * DESKTOP_AUDIO_LRU_BYTES_48K);
    expect(desktopLruCapBytes(0)).toBe(DESKTOP_AUDIO_LRU_BYTES_48K);
    expect(desktopLruCapBytes(Number.NaN)).toBe(DESKTOP_AUDIO_LRU_BYTES_48K);
  });

  it('stays bounded after 2,000 plays of 400 different clips', () => {
    const { map, lru, cap } = make();
    for (let i = 0; i < 2000; i++) {
      const name = `fx/clip${(i * 7) % 400}`;
      if (!map.has(name)) lru.keep(name, { bytes: 400_000 + (i % 5) * 300_000 });
      lru.touch(name);
      lru.playStarted(name);
      lru.playEnded(name); // the clip played to its end
      expect(lru.bytes()).toBeLessThanOrEqual(cap);
    }
    let held = 0;
    for (const [n, b] of map) if (n.includes('/')) held += b.bytes;
    expect(held).toBe(lru.bytes()); // the map and the count agree: dropped clips are really gone
    expect(lru.evictions()).toBeGreaterThan(0);
    expect(lru.size()).toBeGreaterThan(10); // a working set stays, it is not flushed
  });

  it('drops the least recently PLAYED first', () => {
    const { map, lru } = make(48000);
    const each = DESKTOP_AUDIO_LRU_BYTES_48K / 4;
    for (const n of ['fx/a', 'fx/b', 'fx/c', 'fx/d']) lru.keep(n, { bytes: each });
    lru.touch('fx/a'); // a was just played: b is now the oldest
    lru.keep('fx/e', { bytes: each });
    expect(map.has('fx/a')).toBe(true);
    expect(map.has('fx/b')).toBe(false);
  });

  it('never drops a clip that is still sounding, and trims once it ends', () => {
    const { map, lru, cap } = make(48000);
    lru.keep('fx/long', { bytes: 10 * MB });
    lru.playStarted('fx/long'); // still playing
    for (let i = 0; i < 40; i++) lru.keep(`fx/x${i}`, { bytes: 4 * MB });
    expect(map.has('fx/long')).toBe(true);
    expect(lru.bytes()).toBeLessThanOrEqual(cap + 10 * MB);
    lru.playEnded('fx/long');
    lru.keep('fx/y', { bytes: 4 * MB });
    expect(map.has('fx/long')).toBe(false); // ended, oldest: the first to go
    expect(lru.bytes()).toBeLessThanOrEqual(cap);
  });

  it('two overlapping plays of one clip hold it until BOTH end', () => {
    const { map, lru } = make(48000);
    lru.keep('fx/a', { bytes: 30 * MB });
    lru.playStarted('fx/a'); lru.playStarted('fx/a');
    lru.playEnded('fx/a');
    lru.keep('fx/b', { bytes: 40 * MB });
    expect(map.has('fx/a')).toBe(true);
    lru.playEnded('fx/a');
    expect(map.has('fx/a')).toBe(false);
  });

  it('never drops a resident clip, and never counts one', () => {
    const { map, lru } = make(48000);
    for (const n of ['buy1', 'roll', 'sell1']) lru.keep(n, { bytes: 30 * MB });
    for (let i = 0; i < 50; i++) lru.keep(`heroes/h${i}`, { bytes: 3 * MB });
    for (const n of ['buy1', 'roll', 'sell1']) expect(map.has(n)).toBe(true);
    expect(lru.bytes()).toBeLessThanOrEqual(DESKTOP_AUDIO_LRU_BYTES_48K);
  });

  it('never drops the clip it just decoded (a play is waiting on it), even past the cap', () => {
    const { map, lru } = make(48000);
    lru.keep('fx/huge', { bytes: DESKTOP_AUDIO_LRU_BYTES_48K + MB });
    expect(map.has('fx/huge')).toBe(true);
    lru.keep('fx/next', { bytes: MB });
    expect(map.has('fx/huge')).toBe(false);
  });

  it('a clip that turns out resident (the index loaded after it decoded) leaves the count, not the map', () => {
    let common = false;
    const { map, lru } = make(48000, (n) => !n.includes('/') || (common && n === 'fx/common'));
    lru.keep('fx/common', { bytes: 20 * MB });
    common = true;
    for (let i = 0; i < 20; i++) lru.keep(`fx/x${i}`, { bytes: 5 * MB });
    expect(map.has('fx/common')).toBe(true);
    expect(lru.bytes()).toBeLessThanOrEqual(DESKTOP_AUDIO_LRU_BYTES_48K);
  });
});

describe('desktop prewarm scene', () => {
  it("warms an open Discover's offer, right after the hand", () => {
    const card = (cardId: string) => ({ cardId }) as unknown as PrewarmStoreState['run']['board'][number];
    const st = { heroChoices: null, run: { heroId: 'h', board: [card('a')], hand: [card('b')], shop: [card('c')], lastCombat: undefined, discover: ['d1', 'd2', 'd3'] } } as unknown as PrewarmStoreState;
    expect(sceneOf(st).cardIds).toEqual(['a', 'b', 'd1', 'd2', 'd3', 'c']);
  });
});

describe('sfx.ts wires desktop to the bounded bank', () => {
  const s = read('sfx.ts');
  it('prefetches only the resident bank on desktop too (no whole-bank loop)', () => {
    expect(s).not.toContain('for (const name of clipNamesInBank()) loadSample(name');
    expect(s).toContain('const resident = clipNamesInBank().filter(isResidentClip);');
  });
  it('caps the desktop LRU by the context rate, and the phone by its own cap', () => {
    expect(s).toContain('capBytes: () => (LITE_ART ? LITE_AUDIO_BYTES : desktopLruCapBytes(ctx?.sampleRate ?? 48000)),');
  });
  it('prewarms on desktop (no phone-only early return) and Game.tsx subscribes it everywhere', () => {
    expect(s).not.toMatch(/export function prewarmSfx\(scene: PrewarmScene\): number \{\n {2}if \(!LITE_ART\)/);
    expect(read('Game.tsx')).toContain('const unsubSfxPrewarm = useGame.subscribe((st) => syncPhoneSfxPrewarm(st));');
  });
  it('every play of a decoded clip holds it until its source ends', () => {
    // playSample, playTailedSample and playFxSound: each start is followed by the hold.
    expect(s.match(/holdWhilePlaying\((name|clip), src\);/g)).toHaveLength(3);
  });
  it('desktop keeps stereo at the context rate (no mono fold or resample off the phone path)', () => {
    expect(s).toMatch(/requestAssetTask\(key, lane, \(\) =>\n {4}fetch\(src\)\n {6}\.then\(\(r\) => r\.arrayBuffer\(\)\)\n {6}\.then\(\(ab\) => a\.decodeAudioData\(ab\)\)\n {6}\.then\(\(buf\) => \{ keepBuffer\(name, buf\);/);
  });
});
