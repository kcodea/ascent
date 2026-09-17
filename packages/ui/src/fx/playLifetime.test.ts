import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FxDef, FxLayer } from './def';
import { LIFETIME_GRACE_MS, UNMODELLED_TAIL_MS, layerNaturalSpanMs, particleLifeOf, playLifetimeMs } from './playLifetime';
import { clearPrimitives, registerPrimitive } from './registry';

/**
 * The per-def play ceiling is pure arithmetic over the def and the primitives' spec defaults, so it is
 * proven here without a renderer. The through-`playDef` half — that the ceiling actually retires a stuck
 * play — lives in `playDef.test.ts` ("lifetime").
 */

const layer = (over: Partial<FxLayer> & { primitive: string }): FxLayer =>
  ({ anchor: 'target', at: 0, params: {}, ...over }) as FxLayer;

const def = (duration: number, layers: FxLayer[]): FxDef => ({ id: 'lifetime-test', duration, layers });

describe('layerNaturalSpanMs — per primitive, mirrored from its isComplete()', () => {
  beforeEach(() => clearPrimitives());
  afterEach(() => clearPrimitives());

  it('a burst runs one particle life; an emitter/smoke emit for one life then drain for another', () => {
    expect(layerNaturalSpanMs(layer({ primitive: 'burst', params: { life: 680 } }))).toBe(680);
    expect(layerNaturalSpanMs(layer({ primitive: 'emitter', params: { life: 2370 } }))).toBe(4740);
    expect(layerNaturalSpanMs(layer({ primitive: 'smoke', params: { life: 1000 } }))).toBe(2000);
  });

  it('an explicit layer `life` bounds any primitive — the player tears the layer down there', () => {
    expect(layerNaturalSpanMs(layer({ primitive: 'emitter', life: 560, params: { life: 2370 } }))).toBe(560);
    expect(layerNaturalSpanMs(layer({ primitive: 'unmodelled-thing', life: 120 }))).toBe(120);
  });

  it('falls back to the hard-coded defaults when the registry is empty (headless / pre-load)', () => {
    expect(particleLifeOf(layer({ primitive: 'burst' }))).toBe(450);
    expect(particleLifeOf(layer({ primitive: 'emitter' }))).toBe(700);
    expect(particleLifeOf(layer({ primitive: 'smoke' }))).toBe(1500);
    expect(particleLifeOf(layer({ primitive: 'shockwave' }))).toBe(0);
  });

  it('reads a registered primitive’s own spec default over the fallback', () => {
    registerPrimitive({
      id: 'burst',
      params: { life: { kind: 'slider', label: 'Life', min: 1, max: 5000, step: 1, default: 999 } },
      spawn: () => ({ update: () => {}, setParams: () => {}, destroy: () => {} }),
    });
    expect(particleLifeOf(layer({ primitive: 'burst' }))).toBe(999);
  });

  it('shockwave mirrors shockwaveOneShotDurationSec: (2n−1)/(n·s) + (n−1)·delay/s, in ms', () => {
    // defaults: 2 rings at speed 0.9 → 3 / 1.8 s
    expect(layerNaturalSpanMs(layer({ primitive: 'shockwave' }))).toBeCloseTo(1000 * (3 / 1.8), 6);
    expect(layerNaturalSpanMs(layer({ primitive: 'shockwave', params: { rings: 1, speed: 2 } }))).toBeCloseTo(500, 6);
    expect(layerNaturalSpanMs(layer({ primitive: 'shockwave', params: { rings: 3, speed: 1, ringDelay: 0.5 } })))
      .toBeCloseTo(1000 * (5 / 3 + 1), 6);
  });

  it('custom, screen, beam and lightning carry their own timing params', () => {
    expect(layerNaturalSpanMs(layer({ primitive: 'custom', params: { durationMs: 800 } }))).toBe(800);
    expect(layerNaturalSpanMs(layer({ primitive: 'custom', params: { role: 'draw', durationMs: 800, count: 4, staggerMs: 50 } })))
      .toBe(950);
    expect(layerNaturalSpanMs(layer({ primitive: 'screen', params: { shakeMs: 300, flashMs: 900 } }))).toBe(900);
    expect(layerNaturalSpanMs(layer({ primitive: 'beam', params: { travelMs: 100, dwellMs: 200, releaseMs: 300 } }))).toBe(600);
    expect(layerNaturalSpanMs(layer({ primitive: 'lightning', params: { travelMs: 100, dwellMs: 200, releaseMs: 300 } }))).toBe(600);
  });

  it('is null for a primitive it does not model, so the caller grants the unmodelled tail', () => {
    expect(layerNaturalSpanMs(layer({ primitive: 'ribbon' }))).toBeNull();
    expect(layerNaturalSpanMs(layer({ primitive: 'react' }))).toBeNull();
    expect(layerNaturalSpanMs(layer({ primitive: 'targeting' }))).toBeNull();
  });
});

describe('playLifetimeMs — the honest end of a play', () => {
  beforeEach(() => clearPrimitives());
  afterEach(() => clearPrimitives());

  it('a def whose particle life outlives its duration ends at duration + life (+ grace), not later', () => {
    // The handoff’s formula: `spell-sparks` is a 600 ms def whose bursts live 680 / 700 ms.
    const d = def(600, [
      layer({ primitive: 'burst', at: 40, params: { count: 165, life: 680 } }),
      layer({ primitive: 'burst', at: 0, params: { count: 147, life: 700 } }),
    ]);
    expect(playLifetimeMs(d)).toBe(600 + 700 + LIFETIME_GRACE_MS);
  });

  it('`dice-land` — a 600 ms def with a 480 ms burst and a shockwave — is bounded by duration + life (+ grace)', () => {
    const d = def(600, [
      layer({ primitive: 'burst', params: { count: 12, life: 480, interval: 6000 } }),
      layer({ primitive: 'shockwave', params: { fade: 2.2 } }),
    ]);
    // the shockwave’s default ring sweep (≈1,667 ms) is longer than duration + life (1,080) and wins
    expect(playLifetimeMs(d)).toBeCloseTo(1000 * (3 / 1.8) + LIFETIME_GRACE_MS, 6);
    expect(playLifetimeMs(d)).toBeLessThan(15_000);
  });

  it('never sits inside an authored tail: an emitter whose window runs past the duration keeps it', () => {
    // `cia-hp`: a 900 ms def whose emitter emits for 2,370 ms and drains for 2,370 more.
    const d = def(900, [layer({ primitive: 'emitter', params: { rate: 80, life: 2370 } })]);
    expect(playLifetimeMs(d)).toBe(4740 + LIFETIME_GRACE_MS);
    expect(playLifetimeMs(d)).toBeGreaterThan(900 + 2370); // duration + maxParticleLife would have cut it
  });

  it('a staggered layer’s `at` shifts its end', () => {
    const d = def(500, [layer({ primitive: 'burst', at: 400, params: { life: 300 } })]);
    expect(playLifetimeMs(d)).toBe(Math.max(500 + 300, 700) + LIFETIME_GRACE_MS);
  });

  it('an unmodelled primitive gets the rest of the def plus the fixed tail', () => {
    const d = def(900, [layer({ primitive: 'ribbon', at: 100 })]);
    expect(playLifetimeMs(d)).toBe(900 + UNMODELLED_TAIL_MS + LIFETIME_GRACE_MS);
  });

  it('a def with only bounded layers ends at its duration (+ grace)', () => {
    const d = def(920, [layer({ primitive: 'beam', life: 500, params: { travelMs: 100, dwellMs: 100, releaseMs: 100 } })]);
    expect(playLifetimeMs(d)).toBe(920 + LIFETIME_GRACE_MS);
  });

  it('tolerates a zero / non-finite duration and an empty layer list', () => {
    expect(playLifetimeMs(def(0, []))).toBe(LIFETIME_GRACE_MS);
    expect(playLifetimeMs(def(Number.NaN, [layer({ primitive: 'burst', params: { life: 100 } })]))).toBe(100 + LIFETIME_GRACE_MS);
  });
});
