/**
 * R-FX-ANCIENT-TENDRIL-02: looking up an Ancient's tendril BEFORE the FX primitives register must not read the def
 * registry. The registry caches its first read with unknown-primitive layers dropped, so an early read would strip every
 * def to zero layers for the whole session (`fxDefs.ts`, ORDER MATTERS). No `import './fx/primitives'` here on purpose.
 */
import { describe, expect, it } from 'vitest';
import { ANCIENT_IDS } from '@game/sim';
import { ancientTendrilDef } from './fx/ancientTendrils';
import { hasPrimitives } from './fx/registry';

describe('R-FX-ANCIENT-TENDRIL-02: no registry read before the primitives register', () => {
  it('answers "none" early, and the defs still load whole once the primitives arrive', async () => {
    expect(hasPrimitives()).toBe(false);
    for (const id of ANCIENT_IDS) expect(ancientTendrilDef(id)).toBeUndefined();
    await import('./fx/primitives');
    expect(hasPrimitives()).toBe(true);
    // A committed def proves the cache was not poisoned by the early calls above.
    const { getDef } = await import('./fx/fxDefs');
    expect(getDef('rune-buff-trail')?.layers.length).toBeGreaterThan(0);
  });
});
