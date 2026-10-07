import { describe, it, expect } from 'vitest';
import { EQUIPMENT_INDEX } from '@game/content';
import def from './defs/spell-generator-activate.json';
import { expectedLoad } from './fxBudget';
import { FXBUDGET_DEFAULTS as DEFAULT_FX_BUDGET } from './fxBudgetConfig';

/**
 * SPELL GENERATOR's use FX (owner batch 2026-10-07): the owner's FX Workbench export, registered as
 * `spell-generator-activate` and named by the Equipment's `useFxId`, so the slot plays it on activation (an
 * untargeted Equipment's def plays ON the slot). The owner's numbers ship verbatim; this pins the wiring and the
 * budget headroom.
 */
describe('spell-generator-activate', () => {
  it('is the Spell Generator use def, three layers anchored on the target (the slot), 600 ms', () => {
    expect(EQUIPMENT_INDEX['spell_generator']!.useFxId).toBe('spell-generator-activate');
    expect(def.id).toBe('spell-generator-activate');
    expect(def.duration).toBe(600);
    expect(def.layers.map((l) => [l.primitive, l.anchor, l.at])).toEqual([['smoke', 'target', 0], ['burst', 'target', 40], ['burst', 'target', 0]]);
  });
  it('fits the FX budget with room to spare: ~360 particles, no filters', () => {
    const load = expectedLoad(def as never);
    expect(load).toEqual({ particles: 165 + 147 + Math.round((185 * 260) / 1000), filters: 0 });
    expect(load.particles).toBeLessThan(DEFAULT_FX_BUDGET.maxParticles / 4);
    expect(load.particles).toBeLessThan(DEFAULT_FX_BUDGET.maxParticlesDiscover / 4);
  });
});
