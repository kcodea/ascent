// @vitest-environment jsdom
/**
 * A DISPLACED (held) OFFER SHOWS THE SHOP BUFFS IT HAS ACCRUED — what the restore will actually hand back.
 *
 * Owner report 2026-09-21: Veinstorm on a displaced Chimerus "did not buff it". The sim stamped the held offer
 * (`offer.atk/hp/buffs`) but `shopView`'s held branch rendered the stashed body alone, so the stamp was
 * invisible in the row, and the restore paths dropped it anyway (see `displacedOfferBuffs.test.ts` in sim).
 * The view now folds the accrued buffs (+ a Golden Touch gild) onto the held body, greens the total against
 * the printed base like any buffed offer, and lists both ledgers in the inspect breakdown.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { BoardCard, ShopCard } from '@game/sim';
import { heldOfferLedger, shopView } from './Recruit';

const held = (): BoardCard =>
  ({ uid: 'h', cardId: 'sandbag', tribe: 'neutral', attack: 9, health: 8, keywords: ['T'], golden: false, summonBonus: 5, buffs: [{ source: 'Growth', attack: 3, health: 3, count: 1 }] });

describe('shopView of a held (displaced) offer', () => {
  it('with nothing accrued it reads the stashed body as before', () => {
    const v = shopView({ uid: 'o', cardId: 'sandbag', held: held() });
    expect([v.attack, v.health]).toEqual([9, 8]);
    expect(v.golden).toBe(false);
    expect(v.buffs).toEqual([{ source: 'Growth', attack: 3, health: 3, count: 1 }]);
    expect([v.baseAttack, v.baseHealth]).toEqual([CARD_INDEX['sandbag']!.attack, CARD_INDEX['sandbag']!.health]);
  });

  it('a Veinstorm stamp shows on the held offer: body + the Rubies, green against the printed base, Ruby in the breakdown', () => {
    // Exactly what `addOfferBuff` writes for a Veinstorm stamp (the sim's public entry does not export it).
    const offer: ShopCard = { uid: 'o', cardId: 'sandbag', held: held(), atk: 3, hp: 3, buffs: [{ source: 'Ruby', attack: 3, health: 3, count: 1 }] };
    const v = shopView(offer);
    expect([v.attack, v.health]).toEqual([12, 11]);
    expect(v.attack).toBeGreaterThan(v.baseAttack!); // `statCls` greens a stat above its base
    expect(v.buffs).toEqual([
      { source: 'Growth', attack: 3, health: 3, count: 1 },
      { source: 'Ruby', attack: 3, health: 3, count: 1 },
    ]);
  });

  it('a same-source offer buff merges into the body ledger (one line, summed)', () => {
    const offer: ShopCard = { uid: 'o', cardId: 'sandbag', held: held(), atk: 1, hp: 0, buffs: [{ source: 'Growth', attack: 1, health: 0, count: 1 }] };
    const v = shopView(offer);
    expect([v.attack, v.health]).toEqual([10, 8]);
    expect(v.buffs).toEqual([{ source: 'Growth', attack: 4, health: 3, count: 2 }]);
  });

  it('a Golden Touch on the held offer previews the gild: golden frame, base doubled once, buffs single', () => {
    const offer: ShopCard = { uid: 'o', cardId: 'sandbag', held: held(), golden: true, atk: 2, hp: 2, buffs: [{ source: 'Fortify', attack: 2, health: 2, count: 1 }] };
    const def = CARD_INDEX['sandbag']!;
    const v = shopView(offer);
    expect(v.golden).toBe(true);
    expect([v.attack, v.health]).toEqual([9 + 2 + def.attack, 8 + 2 + def.health]);
    expect([v.baseAttack, v.baseHealth]).toEqual([def.attack * 2, def.health * 2]);
    expect(v.buffs).toEqual(expect.arrayContaining([
      { source: 'Fortify', attack: 2, health: 2, count: 1 },
      { source: 'Gild', attack: def.attack, health: def.health, count: 1 },
    ]));
  });

  it('a keyword the offer gained in the Shop shows alongside the body keywords', () => {
    const v = shopView({ uid: 'o', cardId: 'sandbag', held: held(), keywords: ['DS'] });
    expect(v.keywords).toEqual(['T', 'DS']);
  });
});

describe('heldOfferLedger (the one reader the row, the inspect and the hover popup share)', () => {
  it("the body's own Rubies and the Rubies the offer accrued read as ONE Ruby tally (the Gemheart Golem preview sizes off both)", () => {
    const body = held();
    body.buffs!.push({ source: 'Ruby', attack: 2, health: 2, count: 2 });
    body.attack += 2; body.health += 2;
    const offer: ShopCard = { uid: 'o', cardId: 'sandbag', held: body, atk: 3, hp: 3, buffs: [{ source: 'Ruby', attack: 3, health: 3, count: 1 }] };
    const { buffs, golden, gild } = heldOfferLedger(offer);
    expect(buffs.find((b) => b.source === 'Ruby')).toEqual({ source: 'Ruby', attack: 5, health: 5, count: 3 });
    expect(buffs.find((b) => b.source === 'Growth')).toEqual({ source: 'Growth', attack: 3, health: 3, count: 1 });
    expect(golden).toBe(false);
    expect(gild).toEqual({ attack: 0, health: 0 });
    expect(body.buffs!.find((b) => b.source === 'Ruby'), 'the stash itself is never mutated by a read').toEqual({ source: 'Ruby', attack: 2, health: 2, count: 2 });
  });

  it('with nothing accrued and no gild it is exactly the body ledger', () => {
    const { buffs, golden, gild } = heldOfferLedger({ uid: 'o', cardId: 'sandbag', held: held() });
    expect(buffs).toEqual([{ source: 'Growth', attack: 3, health: 3, count: 1 }]);
    expect(golden).toBe(false);
    expect(gild).toEqual({ attack: 0, health: 0 });
  });
});
