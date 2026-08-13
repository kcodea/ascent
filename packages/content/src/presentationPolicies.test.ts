import { describe, it, expect } from 'vitest';
import { PRESENTATION_POLICIES } from '@game/core';
import { presentationSurface } from './presentationSurface';

/**
 * BEAT SYSTEM PR 1 — the coverage TRIPWIRE. Every automatic effect the live content produces must carry a
 * presentation policy, and the registry must carry no ghosts. This is what makes the classification a
 * ratchet: a new card/rune/quest whose effect key is unclassified FAILS CI here, so it gets a deliberate
 * policy (ownBeat / foldedCue / passive / intentionallySilent) instead of shipping silently — the exact
 * failure mode the beat-system handoff docs document (Lapidary, Coffers, Oona, …).
 */
describe('presentation-policy registry (beat system PR 1)', () => {
  const surface = presentationSurface();

  it('every live automatic effect is classified', () => {
    const missing = surface.filter((s) => !PRESENTATION_POLICIES[s.key])
      .map((s) => `${s.key}  (used by ${s.users.slice(0, 3).join(', ')}${s.users.length > 3 ? ', …' : ''})`);
    expect(missing, 'classify these in packages/core/src/presentation/policies.ts').toEqual([]);
  });

  it('the registry carries no ghosts — every key is produced by live content', () => {
    const live = new Set(surface.map((s) => s.key));
    // `hero:*` is enumerated SIM-side (`heroBeats.test.ts`): heroes live in @game/sim, and content is a
    // dependency of sim, so this walk cannot see them. Skipping them here keeps the check honest rather than
    // reporting every hero as a ghost.
    const ghosts = Object.keys(PRESENTATION_POLICIES).filter((k) => !live.has(k) && !k.startsWith('hero:'));
    expect(ghosts, 'remove these dead entries (their content was removed or re-bucketed)').toEqual([]);
  });

  it('every intentionallySilent entry documents its reason', () => {
    const silentNoReason = Object.entries(PRESENTATION_POLICIES)
      .filter(([, e]) => e.policy === 'intentionallySilent' && !e.reason)
      .map(([k]) => k);
    expect(silentNoReason, 'a silent classification without a reason is a dodge, not a decision').toEqual([]);
  });

  it('the surface is the expected order of magnitude (the enumerator is not silently broken)', () => {
    // A broken enumerator returning 3 keys would make the other tests pass vacuously.
    expect(surface.length).toBeGreaterThan(600);
  });
});
