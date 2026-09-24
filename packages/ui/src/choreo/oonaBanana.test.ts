import { describe, it, expect } from 'vitest';
import { simulate, combatSide, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupBuffCasts } from './channels/buffCast';
import { bindingFor } from './bindings';

/**
 * King Oona's banana (owner 2026-09-24): when Oona doubles a Beast summoned in combat, `oona-banana` travels
 * from Oona to that Beast. It is bound at `cards.b2_oona.buffWave` with the `buffed` fan-out, which only works
 * because a REAL fight gives Oona's doubling its own `buffWave` moment with Oona's body as the cast source —
 * pinned here against the live simulator so a change to that folding cannot silently strand the banana.
 */
describe("King Oona's banana (real combat)", () => {
  it('the doubling is a buffWave cast from Oona to the summoned Beast, and the banana is bound there', () => {
    // T-Rex dies to the dummy and its Echo summons a T-Rex Baby (a Beast) while Oona is on the board.
    const p: BoardMinion[] = [{ cardId: 'b2_trex', attack: 1, health: 1 }, { cardId: 'b2_oona', attack: 1, health: 60 }];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 60 }];
    const r = simulate(p, e, makeRng(1), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }));

    const oonaUid = r.initial.player.find((m) => m.cardId === 'b2_oona')?.uid;
    const baby = r.events.find((ev) => ev.type === 'summon' && ev.minion.cardId === 'b2_trexbaby');
    expect(oonaUid).toBeTruthy();
    expect(baby?.type === 'summon' ? baby.minion.uid : null).toBeTruthy();
    const babyUid = baby?.type === 'summon' ? baby.minion.uid : '';

    const casts = compileMoments(r.events)
      .filter((m) => m.kind === 'buffWave')
      .flatMap((m) => groupBuffCasts(m, r.events));
    expect(casts.some((c) => c.source === oonaUid && c.target === babyUid)).toBe(true);

    expect(bindingFor('b2_oona', 'buffWave')).toEqual({ def: 'oona-banana', fanOut: 'buffed' });
  });
});
