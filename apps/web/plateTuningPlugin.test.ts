import { describe, expect, it } from 'vitest';
import { planPlateTuningWrite } from './plateTuningPlugin';

/** The Card Plate Editor's Save (owner 2026-10-18): one plate's knobs into plate-tuning.json, validated. */
const EMPTY = JSON.stringify({ version: 1, plates: {} });
const VALUES = { artScale: 1.1, frameX: 0.004, frameY: -0.01, interiorSx: 0.95, interiorSy: 0.97, interiorX: 0, interiorY: 0.09 };

describe('planPlateTuningWrite', () => {
  it('writes one plate, sorted by id, and plans the Collection image for a layered plate', () => {
    const current = JSON.stringify({ version: 1, plates: { plate_zeta: { ...VALUES } } });
    const plan = planPlateTuningWrite({ id: 'plate_battletorn', values: VALUES, layered: true, interior: 'wartorn' }, current);
    expect(plan.status).toBe(200);
    const file = JSON.parse(plan.data!);
    expect(Object.keys(file.plates)).toEqual(['plate_battletorn', 'plate_zeta']);
    expect(file.plates.plate_battletorn).toEqual(VALUES);
    expect(plan.buildArgs).toEqual(['--id', 'plate_battletorn', '--interior', 'wartorn', '--interior-sx', '0.95', '--interior-sy', '0.97',
      '--interior-x', '0', '--interior-y', '0.09', '--art-scale', '1.1']);
  });

  it('a single-image plate saves without a Collection rebuild (its picture is the plate)', () => {
    const plan = planPlateTuningWrite({ id: 'plate_phoenix_plate', values: VALUES, layered: false }, EMPTY);
    expect(plan.status).toBe(200);
    expect(plan.buildArgs).toBeUndefined();
  });

  it('rejects a bad id, an unknown, missing or out-of-range knob, and a bad interior name', () => {
    expect(planPlateTuningWrite({ id: '../evil', values: VALUES }, EMPTY).status).toBe(400);
    expect(planPlateTuningWrite({ id: 'plate_goop', values: { ...VALUES, extra: 1 } }, EMPTY).status).toBe(400);
    const { frameY: _drop, ...missing } = VALUES;
    expect(planPlateTuningWrite({ id: 'plate_goop', values: missing }, EMPTY).status).toBe(400);
    expect(planPlateTuningWrite({ id: 'plate_goop', values: { ...VALUES, artScale: 9 } }, EMPTY).status).toBe(400);
    expect(planPlateTuningWrite({ id: 'plate_goop', values: { ...VALUES, frameX: Number.NaN } }, EMPTY).status).toBe(400);
    expect(planPlateTuningWrite({ id: 'plate_goop', values: VALUES, layered: true, interior: '../x' }, EMPTY).status).toBe(400);
  });
});
