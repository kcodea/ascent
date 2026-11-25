import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ ctx: null as unknown, clips: [] as { category: string; gain: number; rate: number }[], buf: null as unknown }));
vi.mock('../../sfx', () => ({
  audioContext: () => h.ctx,
  fxBusTarget: () => ({ connect: () => undefined }),
  getFxClipBuffer: () => h.buf,
  playTailedClip: (_clip: string, category: string, o: { gain: number; rate: number }) => { h.clips.push({ category, gain: o.gain, rate: o.rate }); return null; },
}));

import { createPackSounds } from './packSounds';

interface FakeParam { value: number; targets: number[]; setTargetAtTime(v: number): void; setValueAtTime(v: number): void; exponentialRampToValueAtTime(v: number): void; linearRampToValueAtTime(v: number): void; cancelScheduledValues(): void }
const param = (v = 0): FakeParam => {
  const p: FakeParam = { value: v, targets: [], setTargetAtTime(x) { p.targets.push(x); }, setValueAtTime(x) { p.value = x; }, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} };
  return p;
};
const node = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const n: Record<string, unknown> = { connect: (t: unknown) => t, disconnect: () => undefined, start: () => undefined, stop: () => undefined, ...extra };
  return n;
};
function fakeCtx(): { ctx: unknown; gains: Array<{ gain: FakeParam }>; counts: { sources: number } } {
  const gains: Array<{ gain: FakeParam }> = [];
  const counts = { sources: 0 };
  const ctx = {
    currentTime: 0, sampleRate: 8000,
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    createGain: () => { const g = node({ gain: param(1) }) as { gain: FakeParam }; gains.push(g); return g; },
    createBiquadFilter: () => node({ frequency: param(), Q: param(), type: '' }),
    createBufferSource: () => { counts.sources++; return node({ buffer: null, loop: false, playbackRate: param(1) }); },
    createOscillator: () => { counts.sources++; return node({ frequency: param() }); },
  };
  return { ctx, gains, counts };
}

const callAll = (s: ReturnType<typeof createPackSounds>): void => {
  s.pop(); s.tear(5); s.crackle(5, 1); s.rip(); s.sleeveFree(); s.slide(5); s.drop(); s.whoosh();
  s.squeeze(); s.handle(0.5); s.handle(0); s.press(); s.tease(0); s.tease(4); s.tease(99); s.tease(-1); s.heartbeat(3); s.heartbeat(4); s.land('common'); s.land('epic'); s.land('ancient'); s.flip('epic', true); s.bigPull('legendary'); s.bigPull('ancient'); s.bigPull('none'); s.stamp(); s.dissolve(0); s.dissolve(3); s.shatter(1); s.stream(); s.tally(0.2); s.tally(0.9); s.aetherLand(); s.aether(); s.summary(); s.silence(); s.dispose();
};

describe('packSounds', () => {
  beforeEach(() => { h.ctx = null; h.clips.length = 0; h.buf = null; });

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

  it('tear/slide after the first call create no nodes', () => {
    const f = fakeCtx();
    h.ctx = f.ctx;
    const s = createPackSounds();
    s.tear(4);
    const n = f.counts.sources;
    for (let i = 0; i < 20; i++) { s.tear(i); s.slide(i); }
    expect(f.counts.sources).toBe(n);
  });

  it("bigPull plays the chest's tierBurst cue on a big pull (Ancient louder and brighter), never on a common card", () => {
    h.ctx = fakeCtx().ctx;
    const s = createPackSounds();
    s.bigPull('none');
    s.flip('common', false);
    // a flip: the chest's reveal cue and the card's own swish; no big-pull cue
    expect(h.clips.map((c) => c.category)).toEqual(['crateReveal', 'crateWhoosh', 'crateWhoosh']); // the reveal cue, the swish, the card snap
    h.clips.length = 0;
    s.bigPull('legendary');
    s.bigPull('ancient');
    const tier = h.clips.filter((c) => c.category === 'crateTierBurst');
    expect(tier).toHaveLength(2);
    // each big pull also layers recorded impacts and a shimmer over the tier burst
    expect(h.clips.filter((c) => c.category === 'crateBurst').length).toBeGreaterThanOrEqual(2);
    expect(h.clips.some((c) => c.category === 'crateTierShimmer')).toBe(true);
    const [leg, anc] = tier;
    expect(anc!.gain).toBeGreaterThan(leg!.gain);
    expect(anc!.rate).toBeGreaterThan(leg!.rate);
  });

  it('the wrapper plays RECORDED foil once it has decoded: one standing loop per recording, grains throttled', () => {
    const f = fakeCtx();
    h.ctx = f.ctx;
    h.buf = { duration: 3 };
    const s = createPackSounds();
    s.tear(4);
    const afterFirst = f.counts.sources;
    for (let i = 0; i < 30; i++) { s.tear(i); s.slide(i); }
    // the recorded tear and slide loops are built once each, never per frame
    expect(f.counts.sources).toBeLessThanOrEqual(afterFirst + 1);
    const n = f.counts.sources;
    // the fake clock never advances, so every grain after the first lands inside the grain gap: no node storm
    for (let i = 0; i < 200; i++) { s.handle(1); s.crackle(40, 1); }
    expect(f.counts.sources).toBeLessThanOrEqual(n + 1);
    // the one-shots play the recordings (a node each), and nothing throws
    expect(() => { s.pop(); s.squeeze(); s.rip(); s.sleeveFree(); s.drop(); s.whoosh(); s.silence(); s.dispose(); }).not.toThrow();
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
