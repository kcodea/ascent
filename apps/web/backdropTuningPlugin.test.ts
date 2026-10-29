import { describe, expect, it } from 'vitest';
import { planBackdropTuningWrite } from './backdropTuningPlugin';

/** The Background Tuner's Save (owner 2026-10-29): one backdrop's tune into backdrop-tuning.json, validated. */
const EMPTY = JSON.stringify({ version: 1, backdrops: {} });
const VALUES = {
  zoom: 1.25, panX: -30, panY: 12.5, size: 430, dark: 0.1, blur: 0, tint: '#472A00', tintAmount: 0.05, shadow: 0.72, shadowX: 6, shadowY: 8,
  shadeDark: 0.8, shadeSoft: 60, shadeSize: 3.2, shadeX: -20, shadeY: 40, oppShadeSize: 2.5, oppShadeX: 10, oppShadeY: -15,
};

describe('planBackdropTuningWrite', () => {
  it('writes one backdrop, sorted by id, with the tint lower-cased', () => {
    const current = JSON.stringify({ version: 1, backdrops: { temple: { ...VALUES, tint: '#000000' } } });
    const plan = planBackdropTuningWrite({ id: 'castle', values: VALUES }, current);
    expect(plan.status).toBe(200);
    const file = JSON.parse(plan.data!);
    expect(Object.keys(file.backdrops)).toEqual(['castle', 'temple']);
    expect(file.backdrops.castle).toEqual({ ...VALUES, tint: '#472a00' });
    expect(plan.data!.endsWith('\n')).toBe(true);
  });

  it('a second save of the same backdrop replaces it', () => {
    const first = planBackdropTuningWrite({ id: 'koiPond', values: VALUES }, EMPTY).data!;
    const second = planBackdropTuningWrite({ id: 'koiPond', values: { ...VALUES, zoom: 2 } }, first);
    expect(JSON.parse(second.data!).backdrops.koiPond.zoom).toBe(2);
  });

  it('rejects a bad id, an unknown, missing or out-of-range knob, a bad tint, and a broken file', () => {
    expect(planBackdropTuningWrite({ id: '../evil', values: VALUES }, EMPTY).status).toBe(400);
    expect(planBackdropTuningWrite({ id: 'castle', values: { ...VALUES, extra: 1 } }, EMPTY).status).toBe(400);
    const { panY: _drop, ...missing } = VALUES;
    expect(planBackdropTuningWrite({ id: 'castle', values: missing }, EMPTY).status).toBe(400);
    expect(planBackdropTuningWrite({ id: 'castle', values: { ...VALUES, zoom: 0.5 } }, EMPTY).status).toBe(400);
    expect(planBackdropTuningWrite({ id: 'castle', values: { ...VALUES, panX: Number.NaN } }, EMPTY).status).toBe(400);
    expect(planBackdropTuningWrite({ id: 'castle', values: { ...VALUES, tint: 'red' } }, EMPTY).status).toBe(400);
    expect(planBackdropTuningWrite({ id: 'castle', values: VALUES }, '{').status).toBe(500);
  });
});
