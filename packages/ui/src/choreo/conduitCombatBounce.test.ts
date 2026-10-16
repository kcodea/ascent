import { describe, it, expect } from 'vitest';
import { simulate, combatSide, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { SCORE_DEFAULTS } from './score';
import { BOUNCE_DEF, bouncesIn } from './channels/bounce';

/**
 * Evidence test (owner 2026-10-16: "show the bounce animation in combat when it happens"): a REAL combat Rune of
 * the Conduit hop off Boulderdash's Rally Rubies lands in a moment whose kind carries the `bounceFx` cue, so the
 * combat score plays the SAME `ruby-bounce` def the Shop plays off `bounceFx`, at the moment the hop happens.
 */
describe('Rune of the Conduit — the combat bounce reaches the ruby-bounce cue', () => {
  it('every hop surfaces through bouncesIn on a moment that schedules bounceFx', () => {
    const mine = [
      { uid: 'd', cardId: 'k_boulderdash', attack: 6, health: 400, keywords: ['W', 'RL'] },
      { uid: 'a', cardId: 'k_beggy', attack: 2, health: 400, keywords: [] },
    ] as unknown as BoardMinion[];
    const theirs = [{ cardId: 'sandbag', attack: 1, health: 2000, keywords: [] }] as unknown as BoardMinion[];
    const r = simulate(mine, theirs, makeRng(7), CARD_INDEX, combatSide({ tier: 6, tribes: ['kobold'], questMods: { runeConduit: 1 } }), combatSide({ tier: 6 }));
    const hopEvents = r.events.filter((e) => e.type === 'buff' && e.ruby && e.bounce);
    expect(hopEvents.length).toBeGreaterThan(0);

    const moments = compileMoments(r.events);
    let surfaced = 0;
    for (const m of moments) {
      const hops = bouncesIn(m, r.events);
      if (!hops.length) continue;
      expect(SCORE_DEFAULTS[m.kind].some((c) => c.ch === 'bounceFx'), `${m.kind} schedules the bounce cue`).toBe(true);
      for (const h of hops) { expect(BOUNCE_DEF[h.kind]).toBe('ruby-bounce'); surfaced += h.count; }
    }
    expect(surfaced, 'no hop is silently dropped').toBe(hopEvents.length);
  });
});
