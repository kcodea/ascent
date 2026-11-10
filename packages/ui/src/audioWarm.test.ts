// @vitest-environment jsdom
/**
 * THE AUDIO GRAPH IS BUILT AHEAD OF THE FIRST CLICK (perf, the Duos audit of 2026-11-09).
 *
 * The AudioContext, its limiter, buses and meters used to be created inside the first gesture of a session: 48 ms of
 * that click's own task (measured on START), with the reverb convolvers in the tasks right behind it. `warmAudioGraph`
 * builds them on idle time during the boot. These pin what must NOT change with it:
 * - a context built ahead is not resumed (there is no gesture yet) and decodes nothing;
 * - the first real use (the first gesture or sound) resumes that same context and starts the SFX bank's decode then,
 *   as it always did;
 * - a phone never builds ahead (its first touch does, R-TOUCH-AUDIO-01), and neither does a test run.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface FakeNode { kind: string; [k: string]: unknown }
function param(v = 1): Record<string, unknown> {
  const p: Record<string, unknown> = { value: v };
  for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues', 'setValueCurveAtTime']) p[m] = () => p;
  return p;
}
function node(kind: string): FakeNode {
  const store: Record<string, unknown> = {};
  return new Proxy({ kind } as FakeNode, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k in store) return store[k];
      if (k === 'connect') return (dest: FakeNode) => dest;
      if (k === 'disconnect' || k === 'start' || k === 'stop') return () => undefined;
      if (k === 'then') return undefined;
      store[k] = param(k === 'gain' ? 1 : 0);
      return store[k];
    },
    set(_t, k: string, v) { store[k] = v; return true; },
  });
}
let made = 0;
let resumes = 0;
class FakeAudioContext {
  state = 'suspended'; // built before any gesture
  currentTime = 0;
  sampleRate = 48000;
  destination = node('destination');
  constructor() { made++; }
  resume(): Promise<void> { resumes++; this.state = 'running'; return Promise.resolve(); }
  addEventListener(): void {}
  createGain(): FakeNode { return node('gain'); }
  createDynamicsCompressor(): FakeNode { return node('compressor'); }
  createAnalyser(): FakeNode { return node('analyser'); }
  createConvolver(): FakeNode { return node('convolver'); }
  createBuffer(_c: number, length: number): unknown { return { length, numberOfChannels: 2, getChannelData: () => new Float32Array(length) }; }
}

let sfxMod: typeof import('./sfx');
beforeAll(async () => {
  vi.useFakeTimers(); // the bank's decode and the ready listeners are timers: counted, never run
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  sfxMod = await import('./sfx');
});
afterEach(() => { vi.clearAllTimers(); });

describe('the audio graph is built ahead of the first click', () => {
  it('nothing is built at import in a test run; the build makes one context, never resumes it, and queues no bank decode', () => {
    expect(made).toBe(0);
    const before = vi.getTimerCount();
    sfxMod.warmAudioGraph();
    expect(made).toBe(1);
    expect(resumes).toBe(0);
    // Only the "context exists" listeners' timer (the reverb pre-warm): no SFX bank decode before a real use.
    expect(vi.getTimerCount() - before).toBeLessThanOrEqual(1);
    sfxMod.warmAudioGraph(); // idempotent
    expect(made).toBe(1);
  });

  it('the first real use takes that same context, resumes it, and starts the bank decode then', () => {
    const before = vi.getTimerCount();
    const a = sfxMod.audioContext();
    expect(a).not.toBeNull();
    expect(made).toBe(1); // the one built ahead
    expect(resumes).toBe(1);
    expect(vi.getTimerCount() - before).toBe(1); // the SFX bank's decode, queued by the first use
    sfxMod.audioContext();
    expect(vi.getTimerCount() - before).toBe(1); // once
  });

  it('is desktop only, off in tests, and scheduled on idle time (never inside a gesture)', () => {
    const src = readFileSync(join(__dirname, 'sfx.ts'), 'utf8');
    expect(src).toMatch(/export function warmAudioGraph\(\): void \{\s*if \(ctx \|\| LITE_ART\) return;/);
    expect(src).toMatch(/import\.meta\.env\.MODE !== 'test' && !LITE_ART\) \{\s*browserIdle\.schedule\(warmAudioGraph, AUDIO_WARM_TIMEOUT_MS\);/);
  });
});
