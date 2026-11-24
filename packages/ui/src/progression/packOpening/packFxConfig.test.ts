// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'ascent.packFeel.v1';

async function load() {
  vi.resetModules();
  return import('./packFxConfig');
}

describe('packFxConfig', () => {
  beforeEach(() => { localStorage.clear(); });

  it("defaults are the owner's tuned values", async () => {
    const m = await load();
    expect(m.DEFAULT_PACK_FEEL).toEqual({
      peelAngle: 0.4, edgeTowardCamera: 139, slackBeforeTear: 0.92, edgeFollowsHand: 0.1, maxTearSpeed: 18,
      fibreCatch: 0.7, pinchTwist: 0.65, tearsStraightUp: 0.15, highlight: 0.65, perspective: 1780, volume: 0.45,
      sleeveGrip: 80, sleeveFollows: 0.36, sleeveRimDrag: 1, sleeveFingerPinch: 0.08, sleeveLetGo: 295,
      stackZoom: 0.3, quickOpenMs: 1000, packGlow: 1, cardGlow: 1, gloss: 0.3, glossSharpness: 0.7, packTilt: 0.6,
      bigPull: 1, bigPullShake: 6, bigPullHoldMs: 450, holo: 1,
    });
    expect(m.getPackFeel()).toEqual(m.DEFAULT_PACK_FEEL);
    // 300 wide; the height is the wrapper art's own aspect (packGeom.ts): it was 476 before the art arrived, 547 for the first Common wrapper
    expect(m.PACK_BASE_SIZE).toEqual({ w: 300, h: 450 });
  });

  it('setPackFeel persists and getPackFeel reads it back', async () => {
    const m = await load();
    const cb = vi.fn();
    const off = m.subscribePackFeel(cb);
    m.setPackFeel({ peelAngle: 0.8 });
    expect(m.getPackFeel().peelAngle).toBe(0.8);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').peelAngle).toBe(0.8);
    off();
    m.setPackFeel({ volume: 0.1 });
    expect(cb).toHaveBeenCalledTimes(1);
    const again = await load();
    expect(again.getPackFeel().peelAngle).toBe(0.8);
    expect(again.getPackFeel().volume).toBe(0.1);
  });

  it('a malformed stored value falls back to defaults', async () => {
    localStorage.setItem(KEY, '{not json');
    let m = await load();
    expect(m.getPackFeel()).toEqual(m.DEFAULT_PACK_FEEL);
    localStorage.setItem(KEY, JSON.stringify({ peelAngle: 'abc', volume: 99, bogus: 1 }));
    m = await load();
    expect(m.getPackFeel().peelAngle).toBe(m.DEFAULT_PACK_FEEL.peelAngle);
    expect(m.getPackFeel().volume).toBe(1);
    expect('bogus' in m.getPackFeel()).toBe(false);
  });

  it('the big-pull knobs clamp to their ranges (burst 0..2, shake 0..20 px, hold 0..1500 ms)', async () => {
    const m = await load();
    const k = (key: string) => m.PACK_FEEL_KNOBS.find((x) => x.key === key)!;
    expect([k('bigPull').min, k('bigPull').max]).toEqual([0, 2]);
    expect([k('bigPullShake').min, k('bigPullShake').max]).toEqual([0, 20]);
    expect([k('bigPullHoldMs').min, k('bigPullHoldMs').max]).toEqual([0, 1500]);
    m.setPackFeel({ bigPull: 5, bigPullShake: -3, bigPullHoldMs: 99999 });
    expect(m.getPackFeel()).toMatchObject({ bigPull: 2, bigPullShake: 0, bigPullHoldMs: 1500 });
    m.setPackFeel({ bigPull: -1, bigPullShake: 40, bigPullHoldMs: -5 });
    expect(m.getPackFeel()).toMatchObject({ bigPull: 0, bigPullShake: 20, bigPullHoldMs: 0 });
    localStorage.setItem(KEY, JSON.stringify({ bigPull: 'x', bigPullShake: 12, bigPullHoldMs: 3000 }));
    const again = await load();
    expect(again.getPackFeel()).toMatchObject({ bigPull: 1, bigPullShake: 12, bigPullHoldMs: 1500 });
  });

  it('the holo knob defaults to 1 and clamps to 0..2 (0 = off)', async () => {
    const m = await load();
    const k = m.PACK_FEEL_KNOBS.find((x) => x.key === 'holo')!;
    expect([k.min, k.max]).toEqual([0, 2]);
    expect(m.getPackFeel().holo).toBe(1);
    m.setPackFeel({ holo: 9 });
    expect(m.getPackFeel().holo).toBe(2);
    m.setPackFeel({ holo: -1 });
    expect(m.getPackFeel().holo).toBe(0);
    localStorage.setItem(KEY, JSON.stringify({ holo: 'junk' }));
    expect((await load()).getPackFeel().holo).toBe(1);
  });

  it('resetPackFeel clears the override', async () => {
    const m = await load();
    m.setPackFeel({ maxTearSpeed: 30 });
    m.resetPackFeel();
    expect(m.getPackFeel()).toEqual(m.DEFAULT_PACK_FEEL);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('every knob key is a PackFeel key and its default lies within [min, max]', async () => {
    const m = await load();
    const keys = Object.keys(m.DEFAULT_PACK_FEEL);
    expect(m.PACK_BASE_SIZE.w).toBe(300);
    for (const k of m.PACK_FEEL_KNOBS) {
      expect(keys).toContain(k.key);
      const d = m.DEFAULT_PACK_FEEL[k.key];
      expect(d).toBeGreaterThanOrEqual(k.min);
      expect(d).toBeLessThanOrEqual(k.max);
      expect(k.step).toBeGreaterThan(0);
    }
    expect(m.PACK_FEEL_KNOBS.map((k) => k.key).sort()).toEqual([...keys].sort());
  });
});
