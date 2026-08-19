import { describe, it, expect, afterEach } from 'vitest';
import def from './fx/defs/hawkus-updraft.json';
import {
  applyHawkusFxTuning, getHawkusFxConfig, HAWKUSFX_DEFAULTS, HAWKUSFX_RANGES,
  resetHawkusFxConfig, setHawkusFxValue, type HawkusFxConfig,
} from './hawkusFxConfig';
import type { StoredFxDef } from './fx/defStore';

/**
 * The Hawkus gust tuner duplicates the committed def's numbers as its DEFAULTS, so the panel can show
 * "Shipped (N)" and reset to what players actually see. That duplication is the thing that rots: retune the
 * JSON, forget the config, and the tuner quietly lies about the shipped value while its reset button drags
 * the effect back to the OLD look. These tests are the lockstep.
 */
// The JSON's inferred type carries a boolean (`reverse`) among the numeric params, so widen through
// `unknown` rather than asserting a numeric record over it.
const layer = (name: string) => (def.layers as unknown as { name?: string; params: Record<string, number> }[])
  .find((l) => l.name === name)!;

const asStored = (): StoredFxDef => JSON.parse(JSON.stringify(def)) as StoredFxDef;

afterEach(() => resetHawkusFxConfig());

describe('hawkus gust tuner defaults track the committed def', () => {
  it('every gust-streak default equals the JSON', () => {
    const p = layer('gust-streaks').params;
    expect({
      gustSpeed: HAWKUSFX_DEFAULTS.gustSpeed, gustGravity: HAWKUSFX_DEFAULTS.gustGravity,
      gustEase: HAWKUSFX_DEFAULTS.gustEase, gustLife: HAWKUSFX_DEFAULTS.gustLife,
      gustSpread: HAWKUSFX_DEFAULTS.gustSpread, gustCount: HAWKUSFX_DEFAULTS.gustCount,
    }).toEqual({
      gustSpeed: p.speed, gustGravity: p.gravity, gustEase: p.drag,
      gustLife: p.life, gustSpread: p.spread, gustCount: p.count,
    });
  });

  it('every rising-air default equals the JSON', () => {
    const p = layer('rising-air').params;
    expect({
      airSpeed: HAWKUSFX_DEFAULTS.airSpeed, airGravity: HAWKUSFX_DEFAULTS.airGravity,
      airLife: HAWKUSFX_DEFAULTS.airLife, airRate: HAWKUSFX_DEFAULTS.airRate,
    }).toEqual({ airSpeed: p.speed, airGravity: p.gravity, airLife: p.life, airRate: p.rate });
  });

  it('every default sits inside its own slider range', () => {
    for (const k of Object.keys(HAWKUSFX_DEFAULTS) as (keyof HawkusFxConfig)[]) {
      const [min, max] = HAWKUSFX_RANGES[k];
      expect(HAWKUSFX_DEFAULTS[k], `${k} default is outside its slider`).toBeGreaterThanOrEqual(min);
      expect(HAWKUSFX_DEFAULTS[k], `${k} default is outside its slider`).toBeLessThanOrEqual(max);
    }
  });

  it('gravity sliders reach BELOW zero — negative is what makes it wind, not a fountain', () => {
    expect(HAWKUSFX_RANGES.gustGravity[0]).toBeLessThan(0);
    expect(HAWKUSFX_RANGES.airGravity[0]).toBeLessThan(0);
  });
});

describe('applyHawkusFxTuning', () => {
  it('returns the def UNTOUCHED while nothing has been dialled (players get the shipped def verbatim)', () => {
    const d = asStored();
    expect(applyHawkusFxTuning(d)).toBe(d); // same reference — no clone, no drift
  });

  it('ignores every other def, so the hot playDef path is unaffected', () => {
    const other = { ...asStored(), id: 'echohorn-target-sparkle' };
    setHawkusFxValue('gustGravity', -900);
    expect(applyHawkusFxTuning(other)).toBe(other);
  });

  it('overlays a dialled value onto the right layer param', () => {
    setHawkusFxValue('gustGravity', -900);
    setHawkusFxValue('airSpeed', 555);
    const out = applyHawkusFxTuning(asStored());
    const gust = out.layers.find((l) => l.name === 'gust-streaks')!.params;
    const air = out.layers.find((l) => l.name === 'rising-air')!.params;
    expect(gust.gravity).toBe(-900);
    expect(air.speed).toBe(555);
    // …and leaves the params it doesn't own alone.
    expect(gust.angle).toBe(layer('gust-streaks').params.angle);
  });

  it('does not mutate the registry def it was handed', () => {
    setHawkusFxValue('gustGravity', -900);
    const d = asStored();
    const before = (d.layers.find((l) => l.name === 'gust-streaks')!.params as Record<string, number>).gravity;
    applyHawkusFxTuning(d);
    expect((d.layers.find((l) => l.name === 'gust-streaks')!.params as Record<string, number>).gravity).toBe(before);
  });

  it('round-trips through reset back to the shipped values', () => {
    setHawkusFxValue('gustSpeed', 42);
    expect(getHawkusFxConfig().gustSpeed).toBe(42);
    resetHawkusFxConfig();
    expect(getHawkusFxConfig()).toEqual(HAWKUSFX_DEFAULTS);
  });
});
