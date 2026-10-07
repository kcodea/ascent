import { describe, it, expect } from 'vitest';
import { createRun, type RunState } from '@game/sim';
import { runeTally } from './runeTally';

/** Rune of the Coffers' badge prints the max Gold it has added so far (live-value rule, R-COFFERS-EVERY-EOT-01). */
describe('Rune of the Coffers live badge', () => {
  it('reads +0 before its first End of Turn and the running total after', () => {
    const run: RunState = { ...createRun(1, 'warden'), runeCoffers: true };
    expect(runeTally(run, 'rune_coffers')).toBe('+0 max Gold');
    expect(runeTally({ ...run, runeCoffersGold: 5 }, 'rune_coffers')).toBe('+5 max Gold');
  });
  it('shows nothing when the rune is not held', () => {
    expect(runeTally(createRun(1, 'warden'), 'rune_coffers')).toBeNull();
  });
});
