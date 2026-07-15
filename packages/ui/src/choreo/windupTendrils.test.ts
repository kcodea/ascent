import { describe, it, expect } from 'vitest';
import { simulate, combatSide, makeRng, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupBuffCasts } from './channels/buffCast';

/**
 * Attack-windup tendrils: an on-attack / Rally buff-other is absorbed into the attacker's `attackExchange` moment
 * (compile.ts `absorbIntoWindup` includes `buff`), so the wind-up path (`onWindupBuffs` in the lunge timeline)
 * fires a tendril for it. This proves the precondition — such a moment DOES carry a buff-other cast.
 */
describe('attack-windup tendrils (real combat)', () => {
  it("a Rally unit's on-attack buff rides inside its attackExchange moment as a buff-other cast", () => {
    // Two Supporters (dragon Rally: on attack, buff dragon friends +1/+2). When one attacks it buffs the OTHER →
    // a buff-other absorbed into that attack's wind-up moment. Tanky enemy so the exchange actually plays.
    const p: BoardMinion[] = [{ cardId: 'supporter', attack: 5, health: 8 }, { cardId: 'supporter', attack: 5, health: 8 }];
    const e: BoardMinion[] = [{ cardId: 'supporter', attack: 1, health: 40 }];
    const r = simulate(p, e, makeRng(3), CARD_INDEX, combatSide({ tier: 6, tribes: ['dragon'] }));

    const moments = compileMoments(r.events);
    const attackMoments = moments.filter((m) => m.kind === 'attackExchange');
    // The buff-other(s) absorbed into an attack's wind-up — exactly what onWindupBuffs fires as tendrils.
    const windupCasts = attackMoments.flatMap((m) => groupBuffCasts(m, r.events));
    expect(windupCasts.length).toBeGreaterThan(0);
  });
});
