import { describe, expect, it } from 'vitest';
import {
  EXEC_CRESCENT_TEX_W, EXECUTEFX_COLOR_GROUPS, EXECUTEFX_COLOR_KEYS, EXECUTEFX_GROUPS, EXECUTEFX_KEYS,
  EXECUTEFX_RANGES, executeCrescentKey, executeCrescentRadius, executeCrescentSegments, getExecuteFxDefaults,
} from './executeFxConfig';

const DEF = getExecuteFxDefaults();

describe('executeFxConfig', () => {
  it('every numeric key has a slider range', () => {
    for (const k of EXECUTEFX_KEYS) expect(EXECUTEFX_RANGES[k], k).toHaveLength(3);
  });

  it('every numeric key appears in exactly one tuner group', () => {
    const grouped = EXECUTEFX_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...EXECUTEFX_KEYS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("each default sits inside its own slider's range", () => {
    for (const k of EXECUTEFX_KEYS) {
      const [min, max] = EXECUTEFX_RANGES[k];
      expect(DEF[k], k).toBeGreaterThanOrEqual(min);
      expect(DEF[k], k).toBeLessThanOrEqual(max);
    }
  });

  it('every colour key appears in exactly one colour group and is a #rrggbb string', () => {
    const grouped = EXECUTEFX_COLOR_GROUPS.flatMap((g) => g.keys);
    expect([...grouped].sort()).toEqual([...EXECUTEFX_COLOR_KEYS].sort());
    const cfg = DEF as unknown as Record<string, string>;
    for (const k of EXECUTEFX_COLOR_KEYS) expect(cfg[k], k).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('colour keys are excluded from the numeric keys', () => {
    for (const k of EXECUTEFX_COLOR_KEYS) expect(EXECUTEFX_KEYS, k).not.toContain(k);
  });
});

// The crescent is a BAKED texture. Its cache key must cover exactly the dials the bake reads — too few and a
// colour change silently keeps the stale texture; too many and every unrelated tweak pays for a re-bake.
describe('executeCrescentKey', () => {
  it('changes when a dial the bake depends on changes', () => {
    const base = executeCrescentKey(DEF);
    expect(executeCrescentKey({ ...DEF, arcSweep: DEF.arcSweep + 10 })).not.toBe(base);
    expect(executeCrescentKey({ ...DEF, arcThick: DEF.arcThick + 1 })).not.toBe(base);
    expect(executeCrescentKey({ ...DEF, tailColor: '#123456' })).not.toBe(base);
    expect(executeCrescentKey({ ...DEF, midColor: '#123456' })).not.toBe(base);
    expect(executeCrescentKey({ ...DEF, tipColor: '#123456' })).not.toBe(base);
  });

  it('is stable across dials the bake does NOT read (no needless re-bake)', () => {
    const base = executeCrescentKey(DEF);
    expect(executeCrescentKey({ ...DEF, arcCount: 5 })).toBe(base);
    expect(executeCrescentKey({ ...DEF, arcSize: 300 })).toBe(base);
    expect(executeCrescentKey({ ...DEF, arcSpin: -400 })).toBe(base);
    expect(executeCrescentKey({ ...DEF, emberCount: 1, bloodCount: 1 })).toBe(base);
    expect(executeCrescentKey({ ...DEF, bloodColor: '#123456' })).toBe(base);
  });
});

/**
 * The crescent's shape is the one part of this effect that can't be eyeballed from the code, and it's baked
 * into a texture rather than drawn live — so these lock the taper + gradient properties that MAKE it read as a
 * slash. Without them a bad arc silently bakes into a smear.
 */
describe('executeCrescentSegments', () => {
  const segs = executeCrescentSegments(DEF);

  it('produces a run of segments spanning exactly the configured sweep', () => {
    expect(segs.length).toBeGreaterThan(20);
    const span = ((segs[segs.length - 1]!.a1 - segs[0]!.a0) * 180) / Math.PI;
    expect(span).toBeLessThanOrEqual(DEF.arcSweep + 0.001);
    expect(span).toBeGreaterThan(DEF.arcSweep * 0.85); // only sub-pixel end slivers are dropped
  });

  it('is centred on "up", so the tilt dial reads naturally', () => {
    const mid = (segs[0]!.a0 + segs[segs.length - 1]!.a1) / 2;
    expect(mid).toBeCloseTo(-Math.PI / 2, 1);
  });

  it('segments are contiguous — no gaps that would read as a dashed cut', () => {
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.a0).toBeCloseTo(segs[i - 1]!.a1, 6);
  });

  // TAPER: thin at both ends, fat in the body. A monotonic ramp would read as a wedge, not a blade.
  it('tapers — thin at the tail, swelling through the body, drawn back to a point at the tip', () => {
    const widths = segs.map((s) => s.width);
    const peak = widths.indexOf(Math.max(...widths));
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(widths.length - 1);
    expect(widths[0]).toBeLessThan(widths[peak]! * 0.6);
    expect(widths[widths.length - 1]).toBeLessThan(widths[peak]! * 0.6);
    expect(Math.max(...widths)).toBeLessThanOrEqual(DEF.arcThick);
  });

  it('never emits a sub-pixel sliver (they cost a draw call and show nothing)', () => {
    for (const s of segs) expect(s.width).toBeGreaterThanOrEqual(0.35);
  });

  // GRADIENT: the tip must end up brighter than the tail, and the tail must fade in rather than start hard.
  it('ramps the gradient from the dark tail to the white-hot tip', () => {
    const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    expect(lum(segs[segs.length - 1]!.color)).toBeGreaterThan(lum(segs[0]!.color) * 1.5);
    expect(segs[0]!.alpha).toBeLessThan(segs[segs.length - 1]!.alpha);
  });

  it('the bloom pass is wider and much fainter than the blade', () => {
    const bloom = executeCrescentSegments(DEF, true);
    expect(Math.max(...bloom.map((s) => s.width))).toBeGreaterThan(Math.max(...segs.map((s) => s.width)));
    expect(Math.max(...bloom.map((s) => s.alpha))).toBeLessThan(Math.min(...segs.map((s) => s.alpha)) + 0.01);
  });

  // The radius has to leave room for half the fattest stroke — and the fattest stroke is the BLOOM, not the
  // blade. Sizing off arcThick alone pushed the glow outside the texture and clipped it to a hard straight
  // edge. Checked across the WHOLE thickness range, since the failure only appears at some values.
  it('the draw radius plus the fattest stroke stays inside the baked texture, at any thickness', () => {
    const [min, max, step] = EXECUTEFX_RANGES.arcThick;
    for (let arcThick = min; arcThick <= max; arcThick += step * 8) {
      const cfg = { ...DEF, arcThick };
      const halfW = Math.max(...executeCrescentSegments(cfg, true).map((s) => s.width)) / 2;
      expect(executeCrescentRadius(cfg) + halfW, `thick ${arcThick}`).toBeLessThanOrEqual(EXEC_CRESCENT_TEX_W / 2 + 0.001);
    }
  });

  it('stays sane at the extremes of every shape dial', () => {
    for (const arcSweep of [EXECUTEFX_RANGES.arcSweep[0], EXECUTEFX_RANGES.arcSweep[1]]) {
      for (const arcThick of [EXECUTEFX_RANGES.arcThick[0], EXECUTEFX_RANGES.arcThick[1]]) {
        const s = executeCrescentSegments({ ...DEF, arcSweep, arcThick });
        expect(s.length, `${arcSweep}/${arcThick}`).toBeGreaterThan(0);
        for (const seg of s) {
          expect(Number.isFinite(seg.a0) && Number.isFinite(seg.a1)).toBe(true);
          expect(seg.alpha).toBeGreaterThan(0);
          expect(seg.alpha).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
