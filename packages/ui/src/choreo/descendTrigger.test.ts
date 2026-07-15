import { describe, it, expect } from 'vitest';
import { simulate, combatSide, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupBuffCasts } from './channels/buffCast';
import { isDeathrattleBufferCard } from '../deathrattleBuffers';

describe('buff-descend routing (real combat)', () => {
  it('a dying Sergeant produces buff-other casts (buffWave) and Sergeant routes to descend', () => {
    const p: BoardMinion[] = [{ cardId: 'sergeant', attack: 6, health: 6 }, { cardId: 'sergeant', attack: 6, health: 30 }];
    const e: BoardMinion[] = [{ cardId: 'sergeant', attack: 20, health: 30 }];
    const r = simulate(p, e, makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['undead'] }));

    const moments = compileMoments(r.events);
    const casts = moments.flatMap((m) => groupBuffCasts(m, r.events)); // buff-others (source !== target)
    expect(casts.length).toBeGreaterThan(0);                 // a dying Sergeant DID buff a survivor
    expect(isDeathrattleBufferCard('sergeant')).toBe(true);  // → every such cast routes to descend, not tendril
  });
});
