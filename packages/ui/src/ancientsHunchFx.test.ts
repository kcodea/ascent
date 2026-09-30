/**
 * ANCIENTS × HUNCH presentation (2026-09-30): the combat half of Ancient of Bonds is a label-sourced grant, and the
 * label must route to the generic tendril from the hero-power button (the United Front route).
 */
import { describe, expect, it } from 'vitest';
import { HUNCH_BONDS_COMBAT_LABEL } from '@game/sim';
import { heroPowerBuffLabelFor, labelBuffFxFor } from './choreo/bindings';

describe('Hunch × Bonds in combat: a tendril from the hero-power button', () => {
  it('the sim label maps to Hunch, with no authored def replacing the generic ribbon', () => {
    expect(heroPowerBuffLabelFor(HUNCH_BONDS_COMBAT_LABEL)).toEqual({ heroId: 'hunch' });
    expect(labelBuffFxFor(HUNCH_BONDS_COMBAT_LABEL)).toBeNull();
  });
});
