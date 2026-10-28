import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * R-COMBAT-BODY-GUARD-01 (2026-10-28): a side's board array (the dead stay in it) holds at most 400 bodies in one fight.
 * A self-feeding summon loop (in CI: a dev-only Ancient pair, Xerox's Avenge copy plus Genesis's extra body, on a Wolves
 * Den board, drawn by the tag-team fuzz) re-summoned forever under the 7-living cap, and every death scan walks the whole
 * array, so the fight never finished. Past the guard a summon is refused silently and the fight ends normally.
 */
const LOOP: CardDef = {
  ...CARD_INDEX['wolvesden']!, id: 'zz_loop', name: 'Loop', tribe: 'neutral', tribe2: undefined, attack: 1, health: 1, keywords: [],
  effects: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'zz_loop', count: 1 } }],
};
const cards: Record<string, CardDef> = { ...CARD_INDEX, zz_loop: LOOP };
const bm = (cardId: string, attack: number, health: number, uid: string): BoardMinion =>
  ({ cardId, attack, health, keywords: [], sourceUid: uid } as unknown as BoardMinion);

describe('R-COMBAT-BODY-GUARD-01: a runaway summon loop is bounded', () => {
  it('a body that summons itself on death, into a wall that kills everything, still ends the fight', () => {
    const t0 = Date.now();
    // A tag-team reserve doubles the attack budget (600 turns), so the loop out-runs the guard.
    const r = simulate([bm('zz_loop', 1, 1, 'L')], [bm('sandbag', 50, 1_000_000, 'W')], makeRng(3), cards, combatSide({ tier: 6 }), combatSide({ tier: 6 }),
      { reserve: { enemy: { board: [bm('sandbag', 0, 1, 'R')], state: combatSide({ tier: 6 }) } } });
    const summons = r.events.filter((e) => e.type === 'summon' && e.side === 'player').length;
    expect(summons, 'the loop really reaches the guard').toBeGreaterThan(380);
    expect(summons + 1, 'never more than 400 bodies on one side').toBeLessThanOrEqual(400);
    expect(Date.now() - t0, 'and it ends quickly').toBeLessThan(10_000);
  });

  it('is symmetric: the same loop on the enemy side is bounded the same way', () => {
    const p = simulate([bm('zz_loop', 1, 1, 'L')], [bm('sandbag', 50, 1_000_000, 'W')], makeRng(3), cards, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const e = simulate([bm('sandbag', 50, 1_000_000, 'W')], [bm('zz_loop', 1, 1, 'L')], makeRng(3), cards, combatSide({ tier: 6 }), combatSide({ tier: 6 }), { firstSide: 'enemy' });
    expect(e.events.filter((x) => x.type === 'summon' && x.side === 'enemy').length).toBe(p.events.filter((x) => x.type === 'summon' && x.side === 'player').length);
  });
});
