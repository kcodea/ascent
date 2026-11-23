import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('../../sfx', () => ({
  audioContext: () => h.ctx,
  fxBusTarget: () => ({ connect: () => undefined }),
  playTailedClip: () => null,
}));

import { createPackSounds } from './packSounds';

interface FakeParam { value: number; targets: number[]; setTargetAtTime(v: number): void; setValueAtTime(v: number): void; exponentialRampToValueAtTime(v: number): void; cancelScheduledValues(): void }
const param = (v = 0): FakeParam => {
  const p: FakeParam = { value: v, targets: [], setTargetAtTime(x) { p.targets.push(x); }, setValueAtTime(x) { p.value = x; }, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} };
  return p;
};
const node = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const n: Record<string, unknown> = { connect: (t: unknown) => t, disconnect: () => undefined, start: () => undefined, stop: () => undefined, ...extra };
  return n;
};
function fakeCtx(): { ctx: unknown; gains: Array<{ gain: FakeParam }> } {
  const gains: Array<{ gain: FakeParam }> = [];
  const ctx = {
    currentTime: 0, sampleRate: 8000,
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createGain: () => { const g = node({ gain: param(1) }) as { gain: FakeParam }; gains.push(g); return g; },
    createBiquadFilter: () => node({ frequency: param(), Q: param(), type: '' }),
    createBufferSource: () => node({ buffer: null, loop: false, playbackRate: param(1) }),
  };
  return { ctx, gains };
}

const callAll = (s: ReturnType<typeof createPackSounds>): void => {
  s.pop(); s.tear(5); s.crackle(5, 1); s.rip(); s.sleeveFree(); s.slide(5); s.drop(); s.whoosh();
  s.flip('epic', true); s.stamp(); s.aether(); s.summary(); s.silence(); s.dispose();
};

describe('packSounds', () => {
  beforeEach(() => { h.ctx = null; });

  it('every cue is a no-op when there is no AudioContext', () => {
    expect(() => callAll(createPackSounds())).not.toThrow();
  });

  it('every cue runs against a minimal fake AudioContext', () => {
    h.ctx = fakeCtx().ctx;
    expect(() => callAll(createPackSounds())).not.toThrow();
  });

  it('silence() stops the loops', () => {
    const f = fakeCtx();
    h.ctx = f.ctx;
    const s = createPackSounds();
    s.tear(9); s.slide(10);
    s.silence();
    const loopGains = f.gains.slice(1).filter((g) => g.gain.targets.length > 0); // gains[0] is the master
    expect(loopGains.length).toBeGreaterThanOrEqual(2);
    for (const g of loopGains) expect(g.gain.targets[g.gain.targets.length - 1]).toBe(0);
  });

  it('dispose() is idempotent', () => {
    h.ctx = fakeCtx().ctx;
    const s = createPackSounds();
    s.tear(3);
    s.dispose();
    expect(() => s.dispose()).not.toThrow();
    expect(() => s.pop()).not.toThrow();
  });
});
