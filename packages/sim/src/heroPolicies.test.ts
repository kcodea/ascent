import { describe, it, expect } from 'vitest';
import { PRESENTATION_POLICIES } from '@game/core';
import { heroSurface } from './heroSurface';

/**
 * BEAT SYSTEM — hero classification tripwire (DoD item 1b). Heroes were absent from the registry; this is the
 * sim-side ratchet (heroes live in @game/sim, out of reach of the content-side surface): every hero's automatic
 * power must carry a presentation policy, and no hero entry may be a ghost. A new hero without a classification
 * fails CI here — the same guarantee cards get from `presentationPolicies.test.ts`.
 */
describe('hero presentation policy coverage', () => {
  const surface = heroSurface();

  it('enumerates every hero as hero:<id>:<power.kind>', () => {
    expect(surface.length).toBeGreaterThanOrEqual(27);
    expect(surface.every((h) => /^hero:[a-z0-9]+:[a-zA-Z]+$/.test(h.key))).toBe(true);
  });

  it('every hero has a registry entry', () => {
    const missing = surface.filter((h) => !PRESENTATION_POLICIES[h.key]).map((h) => `${h.key} (${h.name})`);
    expect(missing, 'classify these in packages/core/src/presentation/policies.ts').toEqual([]);
  });

  it('no ghost hero entries — every hero:* key is produced by a live hero', () => {
    const live = new Set(surface.map((h) => h.key));
    const ghosts = Object.keys(PRESENTATION_POLICIES).filter((k) => k.startsWith('hero:') && !live.has(k));
    expect(ghosts).toEqual([]);
  });
});
