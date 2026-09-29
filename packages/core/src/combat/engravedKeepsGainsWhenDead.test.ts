import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '../index';

/**
 * R-ENGRAVE-02 (owner 2026-09-29: "yes this is intended. that is the entire point of the engraved mechanic"):
 * an Engraved minion keeps every stat it gained in combat, win or lose, EVEN IF IT DIED in that fight. The
 * carry-back reads every minion on the fight board, the fallen included.
 *
 * Setup: Rune of Warding triples the right-most minion's Health at Start of Combat (a +20 on a 0/10 EG body,
 * see runeWardingEngrave.test.ts), then a 100-Attack enemy kills it.
 */
const sim = (player: BoardMinion[], seed = 5) =>
  simulate(player, [{ cardId: 'sandbag', attack: 100, health: 400 }], makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, questMods: { runeWarding: true } as never }), combatSide());

describe('an Engraved minion keeps its combat gains even when it dies', () => {
  it('the dead Engraved minion still carries its gain back to the run board', () => {
    const r = sim([{ cardId: 'sandbag', attack: 0, health: 10, keywords: ['EG'], sourceUid: 'E' }]);
    const body = r.initial.player[0]!;
    expect(r.events.some((e) => e.type === 'death' && (e as { target?: string }).target === body.uid), 'it died in the fight').toBe(true);
    expect(r.result).toBe('lose');
    expect(r.playerPermaBuffs?.find((p) => p.sourceUid === 'E'), 'its gain still reaches the run board').toMatchObject({ health: 20, engraved: true });
  });

  it('a NON-Engraved minion that gains and dies does not keep the combat gain (the contrast)', () => {
    const r = sim([{ cardId: 'sandbag', attack: 0, health: 10, keywords: [], sourceUid: 'N' }]);
    // (Its row may carry an unrelated permanent Attack grant; the point is the +20 combat Health stays behind.)
    const perma = r.playerPermaBuffs?.find((p) => p.sourceUid === 'N');
    expect(perma?.health ?? 0).toBe(0);
    expect(perma?.engraved ?? false).toBe(false);
  });
});
