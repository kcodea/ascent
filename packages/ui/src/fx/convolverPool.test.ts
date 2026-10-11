/**
 * Pooled reverb convolvers (gameplay perf 2026-10-10): assigning `ConvolverNode.buffer` costs ~6 ms of main thread
 * per fire, so a ONE-SHOT play hands its convolver back once the tail has died and the next play with the same
 * impulse reuses it (buffer already set). Loops and untimed plays never pool.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAudioFilterChain, prewarmConvolvers, reverbSpecsOf } from './audioFilters';

interface Node { kind: string; buffer: unknown; normalize: boolean; gain: { value: number; setValueCurveAtTime(): void }; connect(d: Node): Node; disconnect(d?: Node): void }
function fakeContext() {
  let convolversMade = 0;
  let buffersSet = 0;
  const mk = (kind: string): Node => {
    const n: Node = {
      kind, normalize: false,
      gain: { value: 0, setValueCurveAtTime() {} },
      get buffer() { return null; },
      set buffer(_v: unknown) { buffersSet++; },
      connect(d) { return d; },
      disconnect() {},
    } as Node;
    return n;
  };
  const a = {
    sampleRate: 48000,
    currentTime: 0,
    createGain: () => mk('gain'),
    createConvolver: () => { convolversMade++; return mk('convolver'); },
    createBuffer: (_c: number, length: number) => ({ length, numberOfChannels: 2, getChannelData: () => new Float32Array(length) }),
  };
  return { a: a as unknown as BaseAudioContext, made: () => convolversMade, set: () => buffersSet };
}
const reverb = { reverbOn: true, reverb_size: 1.2, reverb_damping: 0.4 };

afterEach(() => { vi.useRealTimers(); });

describe('reverb convolver pool', () => {
  it('a one-shot play returns its convolver after the tail, and the next play reuses it (no new buffer set)', () => {
    vi.useFakeTimers();
    const { a, made, set } = fakeContext();
    buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    expect(made()).toBe(1);
    expect(set()).toBe(1);
    // Still ringing: a second, overlapping play needs its own node.
    buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    expect(made()).toBe(2);
    // Both tails have decayed (clip + impulse + pad): the nodes are back in the pool.
    vi.advanceTimersByTime(5000);
    buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    expect(made(), 'reused, not rebuilt').toBe(2);
    expect(set(), 'no impulse re-assigned').toBe(2);
  });

  it('loops and untimed plays never take from or return to the pool', () => {
    vi.useFakeTimers();
    const { a, made } = fakeContext();
    buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: false });
    buildAudioFilterChain(a, reverb);
    vi.advanceTimersByTime(10000);
    buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    expect(made()).toBe(3);
  });
});

describe('reverb prewarm', () => {
  it('reads (size, damping) from reverb-enabled sound layers only', () => {
    const specs = reverbSpecsOf([
      { layers: [{ primitive: 'sound', params: { reverbOn: true, reverb_size: 2.5, reverb_damping: 0.2 } }, { primitive: 'burst', params: { reverbOn: true } }] },
      { layers: [{ primitive: 'sound', params: { reverbOn: false } }, { primitive: 'sound', params: { reverbOn: true } }] },
    ]);
    expect(specs).toEqual([{ size: 2.5, damping: 0.2 }, { size: 1.8, damping: 0.35 }]);
  });

  it('pre-built nodes are pooled: the first one-shot fire after the warm-up builds nothing', () => {
    vi.useFakeTimers();
    const { a, made, set } = fakeContext();
    prewarmConvolvers(a, [{ size: 1.2, damping: 0.4 }], 2);
    vi.advanceTimersByTime(1000);
    expect(made()).toBe(2);
    buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    expect(made()).toBe(2);
    expect(set()).toBe(2);
  });
});
