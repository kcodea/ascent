/**
 * R-TOUCH-PLAY-MEMORY-01 (owner 2026-10-18: pressing Play on an iPhone crashed the page twice in a row). The phone
 * audio path decodes one clip at a time, at 32 kHz, mono, and only the core bank up front; the crash log records
 * breadcrumbs and turns an unclean session into a crash on the next load.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { audioBufferBytes, downmixToMono, PHONE_AUDIO_PREFETCH_DELAY_MS, PHONE_AUDIO_RATE, serialQueue } from './audio/phoneAudio';
import { beginSession, describeCrumb, lastStep, pushCrumb, type CrashLogStore } from './crashLog';

const src = (f: string): string => fs.readFileSync(path.join(__dirname, f), 'utf8');

describe('phone audio memory', () => {
  it('downmixes to the average of the channels', () => {
    const l = new Float32Array([1, 0, -1, 0.5]);
    const r = new Float32Array([0, 0, 1, 0.5]);
    expect(Array.from(downmixToMono([l, r]))).toEqual([0.5, 0, 0, 0.5]);
    expect(Array.from(downmixToMono([l]))).toEqual(Array.from(l));
    expect(downmixToMono([]).length).toBe(0);
  });

  it('a 3 s stereo clip at 48 kHz costs a third once decoded at 32 kHz mono', () => {
    const before = audioBufferBytes({ length: 3 * 48000, numberOfChannels: 2 });
    const after = audioBufferBytes({ length: 3 * PHONE_AUDIO_RATE, numberOfChannels: 1 });
    expect(after / before).toBeCloseTo(1 / 3, 5);
  });

  it('the serial queue runs one job at a time, in order, past a failure', async () => {
    const q = serialQueue();
    let running = 0; let peak = 0; const order: number[] = [];
    const job = (n: number, fail = false) => () => new Promise<number>((res, rej) => {
      running++; peak = Math.max(peak, running);
      setTimeout(() => { running--; order.push(n); if (fail) rej(new Error('x')); else res(n); }, 5);
    });
    const all = [q(job(1)), q(job(2, true)).catch(() => -1), q(job(3))];
    expect(await Promise.all(all)).toEqual([1, -1, 3]);
    expect(order).toEqual([1, 2, 3]);
    expect(peak).toBe(1);
  });

  it('sfx.ts wires the phone path: delayed prefetch, serial 32 kHz decode, mono copy, no non-core fetch', () => {
    const s = src('sfx.ts');
    expect(s).toContain('setTimeout(prefetchSamples, LITE_ART ? PHONE_AUDIO_PREFETCH_DELAY_MS : 0)');
    expect(s).toContain('phoneDecode(() => phoneDecodeCtx(a).decodeAudioData(ab))');
    expect(s).toContain('keepBuffer(name, LITE_ART ? monoCopy(a, buf) : buf)');
    expect(s).toContain('if (!LITE_ART || isCoreSample(name)) loadSample(name, \'audio\');');
    expect(s).not.toContain('sfx-fetch:');
    expect(PHONE_AUDIO_PREFETCH_DELAY_MS).toBeGreaterThan(0);
  });
});

describe('crash log', () => {
  const session = (clean: boolean, steps: string[]): CrashLogStore => {
    const st = beginSession(null, 'a', 0);
    steps.forEach((s, i) => pushCrumb(st.cur!, { s, t: i * 1000 }));
    st.cur!.clean = clean;
    return st;
  };

  it('an unclean session with breadcrumbs is a crash on the next load', () => {
    const next = beginSession(session(false, ['boot', 'title', 'play pressed']), 'b', 1);
    expect(next.crashes).toHaveLength(1);
    expect(lastStep(next.crashes[0]!)?.s).toBe('play pressed');
    expect(next.cur).toMatchObject({ id: 'b', clean: false, crumbs: [] });
  });

  it('a clean session is not a crash, and the history keeps three', () => {
    expect(beginSession(session(true, ['boot', 'title']), 'b', 1).crashes).toHaveLength(0);
    let st = session(false, ['boot']);
    for (let i = 0; i < 5; i++) { st = beginSession(st, `s${i}`, i); pushCrumb(st.cur!, { s: 'boot', t: 0 }); }
    expect(st.crashes).toHaveLength(3);
  });

  it('keeps the boot crumb and the newest ones', () => {
    const st = beginSession(null, 'a', 0);
    for (let i = 0; i < 100; i++) pushCrumb(st.cur!, { s: i === 0 ? 'boot' : `step ${i}`, t: i });
    expect(st.cur!.crumbs).toHaveLength(40);
    expect(st.cur!.crumbs[0]!.s).toBe('boot');
    expect(st.cur!.crumbs[39]!.s).toBe('step 99');
  });

  it('a progress crumb overwrites its own last line only', () => {
    const st = beginSession(null, 'a', 0);
    pushCrumb(st.cur!, { s: 'boot', t: 0 });
    pushCrumb(st.cur!, { s: 'art stream', t: 1, x: { loaded: 100 } }, true);
    pushCrumb(st.cur!, { s: 'art stream', t: 2, x: { loaded: 200 } }, true);
    pushCrumb(st.cur!, { s: 'title', t: 3 });
    pushCrumb(st.cur!, { s: 'art stream', t: 4, x: { loaded: 300 } }, true);
    expect(st.cur!.crumbs.map((c) => `${c.s}${c.x ? ` ${c.x.loaded}` : ''}`)).toEqual(['boot', 'art stream 200', 'title', 'art stream 300']);
  });

  it('a newer heartbeat says how long the page lived past its last step', () => {
    const st = session(false, ['boot', 'play pressed']);
    st.cur!.alive = { s: 'alive', t: 9000 };
    expect(lastStep(st.cur!)?.s).toBe('play pressed (still alive 8 s later)');
  });

  it('describes a crumb in plain words, no em dash', () => {
    const line = describeCrumb({ s: 'x', t: 12345, a: 20.3, i: 15, im: 35, g: 7, gl: 5, h: 61 });
    expect(line).toBe('12.3 s, audio 20.3 MB, images 15 (35 MB), WebGL 5 of 7, heap 61 MB');
    expect(line).not.toMatch(/—|--/);
  });

  it('the readout uses no native tooltip and no bare cursor', () => {
    expect(src('CrashLogReadout.tsx')).not.toMatch(/\btitle=/);
    expect(src('crashLog.css')).not.toMatch(/cursor\s*:/);
  });
});
