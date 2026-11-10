/**
 * Pooled reverb convolvers (gameplay perf 2026-10-10): assigning `ConvolverNode.buffer` costs ~6 ms of main thread
 * per fire, so a ONE-SHOT play hands its convolver back once the tail has died and the next play with the same
 * impulse reuses it (buffer already set). Loops and untimed plays never pool.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONVOLVER_POOL_MAX, buildAudioFilterChain, prewarmConvolvers, reverbImpulse, reverbImpulseSteps, reverbSpecsOf } from './audioFilters';

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

// R-PERF-SHARED-TAIL-REVERB-01 (perf degradation hunt 2026-10-30): a burst that outruns the pool builds extra nodes
// (~60 MB each at 96 kHz), and the pool used to KEEP up to 8 of them per impulse, so the renderer grew in ~60 MB steps
// over a game. Now at most CONVOLVER_POOL_MAX (2 on desktop) idle nodes per impulse are kept; the rest are let go.
describe('reverb pool never grows over a game', () => {
  it('a burst of overlapping plays builds what it needs, but only CONVOLVER_POOL_MAX are kept idle', () => {
    vi.useFakeTimers();
    const { a, made } = fakeContext();
    expect(CONVOLVER_POOL_MAX).toBe(2);
    for (let i = 0; i < 6; i++) buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    expect(made()).toBe(6);
    vi.advanceTimersByTime(5000);
    // A second burst of six: only the two pooled nodes are reused; four are built again (the burst's extras were let go).
    for (let i = 0; i < 6; i++) buildAudioFilterChain(a, reverb, { t0: 0, durSec: 0.5, oneShot: true });
    expect(made()).toBe(10);
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

// Perf, the Duos audit of 2026-11-09: the idle pre-warm used to fill a whole multi-second impulse in ONE idle callback
// (13 to 33 ms tasks behind the first click of a session). It is filled a few ms at a time now.
describe('the reverb impulse is pre-built in slices', () => {
  it('each step stops at its budget, the last one caches the impulse, and a fire then reuses that same buffer', () => {
    const { a } = fakeContext();
    let t = 0;
    const clock = (): number => (t += 1); // every look at the clock is 1 ms later: a step fills two slices at most
    const step = reverbImpulseSteps(a, 3.3, 0.21, 2, clock);
    let steps = 0;
    while (!step()) { steps++; expect(steps).toBeLessThan(1000); }
    expect(steps).toBeGreaterThan(5); // 3.3 s x 2 channels at 48 kHz is some 39 slices: never one go
    const ir = reverbImpulse(a, 3.3, 0.21) as unknown as { length: number };
    expect(ir.length).toBe(Math.floor(48000 * 3.3));
    expect(reverbImpulse(a, 3.3, 0.21)).toBe(ir); // cached under the same key a fire asks for
    expect(step()).toBe(true); // done stays done
  });

  it('a fire that needs the impulse before the slices finish builds it whole, and the steps then just end', () => {
    const { a } = fakeContext();
    let t = 0;
    const step = reverbImpulseSteps(a, 2.7, 0.33, 2, () => (t += 1));
    expect(step()).toBe(false);
    const whole = reverbImpulse(a, 2.7, 0.33);
    expect(step()).toBe(true);
    expect(reverbImpulse(a, 2.7, 0.33)).toBe(whole); // the fire's buffer is kept, never replaced by the slices'
  });

  it('the pre-warm builds its nodes after the sliced impulse, never inside the caller', () => {
    vi.useFakeTimers();
    const { a, made, set } = fakeContext();
    prewarmConvolvers(a, [{ size: 1.7, damping: 0.4 }], 2);
    expect(made()).toBe(0); // nothing inside the caller's task
    vi.advanceTimersByTime(2000);
    expect(made()).toBe(2);
    expect(set()).toBe(2);
  });
});
