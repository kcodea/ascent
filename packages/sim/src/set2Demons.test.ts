import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

/**
 * Set 2's DEMON tribe. Its identity is Consume-from-the-Shop (eight cards) braided with an Imp swarm line.
 * Set 1's Demons eat FODDER; these eat any Shop minion, via the shared `consumeShopMinion` primitive — so that
 * primitive gets the heaviest coverage here, since a bug in it is a bug in eight cards at once.
 */
const minion = (uid: string, cardId: string, attack = 2, health = 2): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'demon', attack, health, keywords: [], golden: false });
const bm = (cardId: string, uid: string, attack = 2, health = 20, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords as BoardMinion['keywords'] });
/** A shop row of DISTINCT real minions (three of one id would triple-combine if bought). */
const shop = (...ids: string[]) => ids.map((cardId, i) => ({ uid: `s${i}`, cardId }));

describe('set 2 — the Demon tribe is wired into the set', () => {
  it('demon is a playable set-2 tribe and its cards are in the pool', () => {
    const s2 = poolFor('set2');
    expect(s2.all.some((c) => c.id === 'dm_clerk')).toBe(true);
    const demons = s2.buyable.filter((c) => c.id.startsWith('dm_'));
    expect(demons.length).toBeGreaterThan(15);
    expect(demons.every((c) => c.tribe === 'demon')).toBe(true);
    // …and none of them leaked into set 1.
    const s1 = new Set(poolFor('set1').all.map((c) => c.id));
    expect(demons.filter((c) => s1.has(c.id))).toEqual([]);
  });
});

describe('set 2 — Consume from the Shop (the shared primitive)', () => {
  it('the eaten offer LEAVES the shop and its stats land on the eater', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [minion('cc', 'dm_clerk', 1, 1)],
      shop: shop('sandbag'), // Target Dummy, 0/4
    };
    s = reduce(s, { type: 'play', uid: 'cc' });
    expect(s.shop.length).toBe(0);                       // eaten
    const clerk = s.board.find((c) => c.uid === 'cc')!;
    expect([clerk.attack, clerk.health]).toEqual([1, 5]); // 1/1 + the Dummy's 0/4
  });

  it('a GOLDEN eater gains DOUBLE the stats — the Gilded rider is a multiplier, not a second eat', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [{ ...minion('cc', 'dm_clerk', 2, 2), golden: true }],
      shop: shop('sandbag'),
    };
    s = reduce(s, { type: 'play', uid: 'cc' });
    expect(s.shop.length).toBe(0);                       // still only ONE minion eaten
    const clerk = s.board.find((c) => c.uid === 'cc')!;
    expect([clerk.attack, clerk.health]).toEqual([2, 10]); // 2/2 + (0/4 x2)
  });

  it('takes the offer’s CURRENT buffed stats, not its printed base', () => {
    // Reading the CardDef instead of `offerBuyStats` would silently ignore every shop buff invested so far.
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [minion('cc', 'dm_clerk', 1, 1)],
      shop: [{ uid: 's0', cardId: 'sandbag', atk: 3, hp: 3 }],
    };
    s = reduce(s, { type: 'play', uid: 'cc' });
    const clerk = s.board.find((c) => c.uid === 'cc')!;
    expect([clerk.attack, clerk.health]).toEqual([1 + 3, 1 + 4 + 3]); // base 0/4 + the offer buff 3/3
  });

  it('never eats a SPELL sitting in the minion row', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [minion('cc', 'dm_clerk', 1, 1)],
      shop: [{ uid: 's0', cardId: 'spiritfire' }], // a spell offer — not a minion
    };
    s = reduce(s, { type: 'play', uid: 'cc' });
    expect(s.shop.length).toBe(1); // untouched
  });

  it('no-ops cleanly on an empty shop', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', board: [], hand: [minion('cc', 'dm_clerk', 1, 1)], shop: [],
    };
    s = reduce(s, { type: 'play', uid: 'cc' });
    const clerk = s.board.find((c) => c.uid === 'cc')!;
    expect([clerk.attack, clerk.health]).toEqual([1, 1]); // played, gained nothing
  });
});

describe('set 2 — Hungerling eats the RIGHT-most', () => {
  it('takes the tail of the row, not a random offer', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('h', 'dm_hungerling', 3, 3)], hand: [],
      shop: shop('alley', 'sandbag'), // sandbag (0/4) is right-most
    };
    applyEndOfTurn(s);
    expect(s.shop.map((o) => o.cardId)).toEqual(['alley']); // the tail went
    const h = s.board.find((c) => c.uid === 'h')!;
    expect([h.attack, h.health]).toEqual([3, 7]); // 3/3 + 0/4
  });
});

describe('set 2 — Grand Gourmand takes stats WITHOUT eating', () => {
  it('gains the right-most minion’s stats and leaves it buyable', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('g', 'dm_gourmand', 5, 5)], hand: [], shop: shop('sandbag'),
    };
    applyEndOfTurn(s);
    expect(s.shop.length).toBe(1); // NOT eaten — the difference from Hungerling
    const g = s.board.find((c) => c.uid === 'g')!;
    expect([g.attack, g.health]).toEqual([5, 9]); // 5/5 + 0/4
  });
});

describe('set 2 — Contract Butcher / Display Curator buff the shop', () => {
  it('Butcher gives every minion offer +1/+1, and the buff survives into a BUY', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 20,
      board: [], hand: [minion('b', 'dm_butcher', 2, 3)],
      shop: shop('sandbag'),
    };
    s = reduce(s, { type: 'play', uid: 'b' });
    s = reduce(s, { type: 'buy', uid: 's0' });
    const bought = s.hand.find((c) => c.cardId === 'sandbag')!;
    expect([bought.attack, bought.health]).toEqual([1, 5]); // 0/4 + 1/1
  });

  it('Curator escalates: +1/+1, then +2/+2 on its second trigger', () => {
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('c', 'dm_curator', 5, 3)], hand: [], shop: shop('sandbag'),
    };
    applyEndOfTurn(s);
    const after1 = s.shop[0]!;
    expect([after1.atk ?? 0, after1.hp ?? 0]).toEqual([1, 1]);
    applyEndOfTurn(s);
    // Second trigger grants +2/+2 on top of the first's +1/+1.
    expect([s.shop[0]!.atk ?? 0, s.shop[0]!.hp ?? 0]).toEqual([3, 3]);
  });
});

describe('set 2 — Avarice Incarnate', () => {
  it('pays Gold equal to the eaten minion’s tier, capped once per turn', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 0,
      board: [minion('av', 'dm_avarice', 6, 7)],
      hand: [minion('c1', 'dm_clerk', 1, 1), minion('c2', 'dm_clerk', 1, 1)],
      shop: shop('sandbag', 'alley'),
    };
    s = reduce(s, { type: 'play', uid: 'c1' });
    const afterFirst = s.embers;
    expect(afterFirst).toBeGreaterThan(0); // paid the tier of whatever was eaten
    s = reduce(s, { type: 'play', uid: 'c2' });
    expect(s.embers).toBe(afterFirst);     // the second consume is over the per-turn cap
  });
});

describe('set 2 — the Imp line (combat)', () => {
  it('Imp Wrangler summons an Imp at Start of Combat', () => {
    const r = simulate([bm('dm_wrangler', 'W', 2, 20)], [{ cardId: 'sandbag', attack: 0, health: 200 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length).toBe(1);
  });

  it('Errand Fiend has Flurry, so its Rally makes TWO Imps per turn', () => {
    const r = simulate([bm('dm_errand', 'E', 1, 40, ['W', 'RL'])], [{ cardId: 'sandbag', attack: 0, health: 300 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 2 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length).toBeGreaterThanOrEqual(2); // one per swing, two swings a turn
  });

  it('Broodwright buffs each Imp summoned', () => {
    const r = simulate([bm('dm_broodwright', 'B', 3, 40), bm('dm_wrangler', 'W', 2, 40)],
      [{ cardId: 'sandbag', attack: 0, health: 300 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 1 }));
    const grants = r.events.filter((e) => {
      const b = e as { type: string; attack?: number; health?: number; source?: string };
      return b.type === 'buff' && b.attack === 2 && b.health === 2 && b.source === 'm0';
    });
    expect(grants.length).toBeGreaterThan(0);
  });

  it('Cinderwall Captain shields only the FIRST 2 Imps', () => {
    // Errand Fiend keeps making Imps all fight; only two may come up shielded.
    const r = simulate([bm('dm_captain', 'C', 5, 60), bm('dm_errand', 'E', 1, 60, ['W', 'RL'])],
      [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length).toBeGreaterThan(2);           // plenty were made…
    expect(r.events.filter((e) => e.type === 'shieldUp').length).toBe(2); // …but only two shielded
  });

  it('Legion Shepherd fills the board and scales its buff with how many it made', () => {
    const r = simulate([bm('dm_shepherd', 'S', 3, 40)], [{ cardId: 'sandbag', attack: 0, health: 300 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length).toBeGreaterThan(3); // a lone Shepherd fills the line
    // Each Imp is buffed by +N/+N where N = the number summoned, so the grant is bigger than 1.
    const buffs = r.events.filter((e) => (e as { type: string; attack?: number }).type === 'buff'
      && ((e as { attack?: number }).attack ?? 0) > 1);
    expect(buffs.length).toBeGreaterThan(0);
  });
});
