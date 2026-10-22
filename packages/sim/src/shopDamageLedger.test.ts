import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, isShopDamageRow, type BoardCard, type RunState } from './state';
import { fireRallies, fireRecruitDeathrattlesForTest } from './recruit';

/**
 * SHOP DAMAGE IN THE LEDGER (owner report 2026-10-22, R-LEDGER-SHOP-DAMAGE-01): "why did the HP bug out here?"
 *
 * His board: two Gilded Fel Spikes, a Gilded Rad Rachel and four Gilded non-Demons (Uron among them). Every Shop-fired
 * Fel Spikes Echo sprays 8 damage onto each of YOUR non-Demons (the Shop has no enemy: owner ruling 2026-08-04), and
 * each of those four hits makes Rachel give everyone +4/+2. A non-Demon loses 8 and gains 4 x 2 = 8: its Health never
 * moves, while its Attack climbs by 16 a spray. The Health was right; the inspect ledger only listed the gains
 * ("Rad Rachel x401 +1604/+802" over a 16 Health badge). Shop damage is now its own negative ledger row, so the
 * breakdown adds up to the stats shown.
 */
const gilded = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack * 2, health: d.health * 2, keywords: [...d.keywords], golden: true } as BoardCard;
};
const shopRun = (board: BoardCard[]): RunState =>
  ({ ...createRun(5, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 30, board, hand: [] } as RunState);
/** The printed Gilded stats plus every ledger row: what the inspect breakdown says the card should show. */
const ledgerTotal = (c: BoardCard): [number, number] => {
  const d = CARD_INDEX[c.cardId]!;
  const rows = c.buffs ?? [];
  return [d.attack * 2 + rows.reduce((n, b) => n + b.attack, 0), d.health * 2 + rows.reduce((n, b) => n + b.health, 0)];
};

describe('Shop damage is itemised in the buff ledger (R-LEDGER-SHOP-DAMAGE-01)', () => {
  it("the owner's board: Fel Spikes Echoes + Rad Rachel leave non-Demon Health flat, and the ledger says why", () => {
    const s = shopRun([
      gilded('f1', 'dm_felspikes'), gilded('f2', 'dm_felspikes'), gilded('r', 'dm_radrachel'),
      gilded('u', 'uron'), gilded('h', 'b2_hawkus'), gilded('n1', 'trainingdummy'), gilded('n2', 'trainingdummy'),
    ]);
    for (let i = 0; i < 100; i++) fireRecruitDeathrattlesForTest(s, s.board[0]!);
    const uron = s.board.find((c) => c.uid === 'u')!;
    // The real state the owner saw: 1614/14 (Attack +1600, Health unchanged).
    expect([uron.attack, uron.health]).toEqual([14 + 1600, 14]);
    expect(uron.buffs?.find((b) => b.source === 'Rad Rachel')).toMatchObject({ attack: 1600, health: 800, count: 400 });
    // ...and now the damage that cancelled the Health is on the ledger too.
    expect(uron.buffs?.find((b) => b.source === 'Fel Spikes (damage)')).toMatchObject({ attack: 0, health: -800, count: 100 });
    // Every minion's ledger adds up to the stats it shows; the Demons took no damage, so they carry no damage row.
    for (const c of s.board) expect(ledgerTotal(c), c.cardId).toEqual([c.attack, c.health]);
    for (const uid of ['f1', 'f2', 'r']) expect(s.board.find((c) => c.uid === uid)!.buffs?.some((b) => isShopDamageRow(b.source))).toBe(false);
  });

  it('a forced Gasket Rally: two passes of 2 per non-Demon, each a ledger hit; the ledger adds up', () => {
    const s = shopRun([gilded('g', 'dm_gasket'), gilded('r', 'dm_radrachel'), gilded('u', 'uron'), gilded('h', 'b2_hawkus')]);
    fireRallies(s);
    for (const c of s.board) expect(ledgerTotal(c), c.cardId).toEqual([c.attack, c.health]);
    const hawkus = s.board.find((c) => c.uid === 'h')!;
    const dmg = hawkus.buffs?.find((b) => b.source === 'Gasket (damage)');
    expect(dmg && dmg.health < 0 && dmg.count > 0).toBe(true);
  });
});
