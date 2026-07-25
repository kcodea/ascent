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

describe('set 2 — consume hygiene (the 2026-07-25 report)', () => {
  it('the SHOP-consume swirl payload does NOT accumulate across actions', () => {
    // The bug: the payload was appended to but cleared only by a few call sites, so each new consume replayed
    // every PREVIOUS one. On screen that stacked ghost minions over the shop and made a card that hadn't eaten
    // (Hungerling) look like it ate alongside one that had (Revolving Maw).
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [], hand: [minion('c1', 'dm_clerk', 1, 1), minion('c2', 'dm_clerk', 1, 1)],
      shop: shop('sandbag', 'alley'),
    };
    s = reduce(s, { type: 'play', uid: 'c1' });
    expect(s.shopEaten?.length).toBe(1);
    s = reduce(s, { type: 'play', uid: 'c2' });
    expect(s.shopEaten?.length, 'the second action replays only ITS consume').toBe(1);
  });

  it('several consumes in ONE action all animate', () => {
    // The other half: clearing per action must not clear WITHIN one. Feastmaster Vhal's two neighbours each eat.
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('L', 'dm_clerk', 1, 1), minion('v', 'dm_vhal', 6, 8), minion('R', 'dm_butcher', 2, 3)],
      hand: [], shop: shop('sandbag', 'alley', 'stray', 'pup'),
    };
    applyEndOfTurn(s);
    expect(s.shopEaten!.length).toBeGreaterThan(1);
  });

  it('an eaten minion RETURNS to the shared pool', () => {
    // It's destroyed, not owned — same as an unbought offer on a reroll. Without this, eight eating Demons drain
    // the run's pool permanently.
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [minion('cc', 'dm_clerk', 1, 1)], shop: shop('sandbag'),
    };
    const before = s.pool['sandbag'] ?? 0;
    s = reduce(s, { type: 'play', uid: 'cc' });
    expect(s.pool['sandbag'] ?? 0).toBe(before + 1);
  });

  it('does NOT feed the FODDER tallies — a Shop minion is not Fodder', () => {
    // Feeding `noteFodderConsumed` here inflated Abhorrent Horror's "stats from Fodder consumed" window and
    // ticked Rune of Consumption's permanent Fodder-aura improve, both for eating something that isn't Fodder.
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [minion('cc', 'dm_clerk', 1, 1)], shop: shop('sandbag'),
    };
    s = reduce(s, { type: 'play', uid: 'cc' });
    expect(s.fodderConsumedThisTurn ?? { attack: 0, health: 0 }).toEqual({ attack: 0, health: 0 });
    expect(s.runFodderConsumed?.count ?? 0).toBe(0);
  });

  it('Revolving Maw eats exactly ONE minion on its 4th refresh', () => {
    // The report said it ate "all of them". It eats the right-most, once — the appearance of more was the
    // accumulated swirl above.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 99, freeRolls: 99,
      board: [minion('m', 'dm_maw', 8, 8)], hand: [], shop: shop('sandbag', 'alley', 'stray'),
    };
    for (let i = 0; i < 4; i++) s = reduce(s, { type: 'roll' });
    expect(s.shopEaten?.length ?? 0).toBe(1); // one consume animating, not a pile
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
  it('Butcher permanently buffs what you buy from the Shop', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 40,
      board: [], hand: [minion('b', 'dm_butcher', 2, 3)],
      shop: shop('sandbag'),
    };
    s = reduce(s, { type: 'play', uid: 'b' });
    s = reduce(s, { type: 'buy', uid: 's0' });
    const bought = s.hand.find((c) => c.cardId === 'sandbag')!;
    expect([bought.attack, bought.health]).toEqual([1, 5]); // 0/4 + 1/1
    // …and a minion from a LATER shop gets it too — the permanent channel, not this roll's offers.
    s = { ...s, shop: shop('alley') };
    s = reduce(s, { type: 'buy', uid: 's0' });
    const later = s.hand.find((c) => c.cardId === 'alley')!;
    const base = CARD_INDEX['alley']!;
    expect([later.attack, later.health]).toEqual([base.attack + 1, base.health + 1]);
  });

  it('Curator escalates, and the buff SURVIVES a refresh (it is permanent)', () => {
    // Owner ruling 2026-07-25: "give minions in the Shop" is a PERMANENT buy-buff like Staff of Guel, not a
    // per-offer one. The per-offer version made this card nearly worthless — each turn's grant died on the next
    // refresh, before the escalation could ever compound.
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('c', 'dm_curator', 5, 3)], hand: [], shop: shop('sandbag'),
    };
    applyEndOfTurn(s);
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp]).toEqual([1, 1]);
    applyEndOfTurn(s);
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp]).toEqual([3, 3]); // +1 then +2 — it escalated
    // A brand-new shop still carries it, which the per-offer version could not do.
    s.shop = shop('alley');
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp]).toEqual([3, 3]);
  });
});

describe('set 2 — Avarice Incarnate', () => {
  it('pays a flat 3 Gold on the first consume each turn, and only the first', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 0,
      board: [minion('av', 'dm_avarice', 6, 7)],
      hand: [minion('c1', 'dm_clerk', 1, 1), minion('c2', 'dm_clerk', 1, 1)],
      shop: shop('sandbag', 'alley'),
    };
    s = reduce(s, { type: 'play', uid: 'c1' });
    expect(s.embers).toBe(3);          // flat 3, regardless of what was eaten (was: the eaten minion's tier)
    s = reduce(s, { type: 'play', uid: 'c2' });
    expect(s.embers).toBe(3);          // the second consume pays nothing — "the first time" each turn
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

describe('set 2 — the last three (Overseer / Maw / Malphas)', () => {
  it('all 23 roster cards are in the set', () => {
    expect(poolFor('set2').all.filter((c) => c.id.startsWith('dm_')).length).toBe(23);
  });

  it('Revolving Maw eats on every 4th REFRESH, counting from its own arrival', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 99, freeRolls: 99,
      board: [minion('m', 'dm_maw', 8, 8)], hand: [],
      shop: shop('sandbag', 'alley', 'stray'),
    };
    for (let i = 0; i < 3; i++) s = reduce(s, { type: 'roll' });
    const m3 = s.board.find((c) => c.uid === 'm')!;
    expect([m3.attack, m3.health]).toEqual([8, 8]); // nothing yet — three refreshes
    s = reduce(s, { type: 'roll' });                // the fourth
    const m4 = s.board.find((c) => c.uid === 'm')!;
    expect(m4.attack + m4.health).toBeGreaterThan(16); // ate something
  });

  it('Endless Overseer: the first 3 IMP deaths each summon an Imp, then it stops', () => {
    // Owner change 2026-07-25. The budget is what bounds the chain — a replacement Imp dying can itself pay out,
    // but only while the budget lasts, so the fight must terminate with at most 3 summons.
    // The Overseer must SURVIVE long enough to spend its budget — an earlier fixture gave it 60 HP against a
    // 20-attack enemy and it died on the second death, so only one summon landed and the test read as a bug in
    // the card rather than in the setup.
    const r = simulate(
      [bm('dm_overseer', 'O', 1, 400),
       bm('impscrap', 'I1', 1, 1), bm('impscrap', 'I2', 1, 1), bm('impscrap', 'I3', 1, 1), bm('impscrap', 'I4', 1, 1)],
      [{ cardId: 'sandbag', attack: 2, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(r.result).toBeTruthy();               // terminated
    const summons = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(summons.length).toBe(3);              // exactly the budget — not 4, not unbounded
  });

  it('Endless Overseer ignores a NON-Imp death', () => {
    // It reads the victim from the avenge payload, so a Stray dying must not pay out.
    const r = simulate(
      [bm('dm_overseer', 'O', 1, 400), bm('stray', 'S1', 1, 1), bm('pup', 'S2', 1, 1)],
      [{ cardId: 'sandbag', attack: 2, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(r.events.filter((e) => e.type === 'summon')).toEqual([]);
  });

  it('Malphas offers a Choose One with both halves', () => {
    // Asserted on the MECHANIC, not the flavour name: the options used to read "Feast:" / "Legion:" and the
    // owner had those stripped (2026-07-25) because the label read as an extra rule to decode. Matching on the
    // mechanic keeps this test meaningful across wording changes — and option ORDER is what the gates key on.
    const malphas = CARD_INDEX['dm_malphas']!;
    expect(malphas.chooseOne?.length).toBe(2);
    expect(malphas.chooseOne![0]!.text).toMatch(/Consume/);   // option 0 = the shop-eating half
    expect(malphas.chooseOne![1]!.text).toMatch(/Imp/);       // option 1 = the Imp-copy half
  });

  it('no set-2 Choose One carries a flavour NAME — in its options OR its card text', () => {
    // Owner 2026-07-25: Choose One prints the mechanic only. Guards the whole set so a future card can't quietly
    // reintroduce the pattern.
    //
    // Checking the CARD's own text too, not just the options: the first version of this guard looked only at
    // options and passed while Orivax's combined text still read "Choose One — Chorus: … Spellweave: …". The
    // flavour hid in the half the guard wasn't looking at.
    const OPT_FLAVOUR = /^\*\*[A-Z][a-z]+:\*\*/;                 // a leading "**Hunt:**" label on an option
    const CARD_FLAVOUR = /Choose One\s*[—-]\s*\*?\*?[A-Z][a-z]+/; // "Choose One — Chorus" in the card text
    for (const c of poolFor('set2').all) {
      if (!c.chooseOne?.length) continue;
      for (const opt of c.chooseOne) {
        expect(opt.text, `${c.id} option`).not.toMatch(OPT_FLAVOUR);
        if (opt.goldenText) expect(opt.goldenText, `${c.id} golden option`).not.toMatch(OPT_FLAVOUR);
      }
      expect(c.text, `${c.id} card text`).not.toMatch(CARD_FLAVOUR);
      if (c.goldenText) expect(c.goldenText, `${c.id} golden card text`).not.toMatch(CARD_FLAVOUR);
    }
  });

  it('Malphas FEAST fires every turn, and only when Feast was the pick', () => {
    // Malphas must be ON the board and be the only End-of-Turn eater — an earlier version of this test used a
    // Hungerling as filler, which ate the shop by itself and made the assertion pass vacuously.
    const build = (pick: number | undefined): RunState => {
      const st: RunState = {
        ...createRun(1), phase: 'recruit',
        board: [minion('L', 'dm_clerk', 1, 1), minion('M', 'dm_malphas', 10, 6), minion('R', 'dm_butcher', 2, 3)],
        hand: [], shop: shop('sandbag', 'alley', 'stray', 'pup'),
      };
      st.board[1]!.chosenOption = pick;
      return st;
    };
    // CONTROL: no pick recorded → nothing eats, proving the shrink below is Malphas and not something else.
    const none = build(undefined);
    applyEndOfTurn(none);
    expect(none.shop.length).toBe(4);

    const feast = build(0);
    applyEndOfTurn(feast);
    expect(feast.shop.length).toBeLessThan(4); // the end Demons ate their sides
    // …and it PERSISTS. Refill first: Feast eats 2 per end, which cleared the whole 4-card row, and a real turn
    // rolls a fresh shop anyway. Without a refill this asserts nothing — there'd be nothing left to eat.
    feast.shop = shop('sandbag', 'alley', 'stray', 'pup');
    applyEndOfTurn(feast);
    expect(feast.shop.length).toBeLessThan(4); // ate AGAIN on the second End of Turn
  });

  it('Malphas LEGION does not fire when Feast was the pick', () => {
    // The other half of the gate: picking Feast must not also grant Legion.
    const r = simulate(
      [{ cardId: 'dm_malphas', attack: 10, health: 40, sourceUid: 'M', keywords: [], chosenOption: 0 },
       { cardId: 'impscrap', attack: 1, health: 20, sourceUid: 'I' }],
      [{ cardId: 'sandbag', attack: 0, health: 300 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 7 }), combatSide({ tier: 1 }));
    expect(r.events.filter((e) => e.type === 'summon')).toEqual([]); // no copies — Legion wasn't chosen
  });

  it('Malphas LEGION summons a copy when an Imp attacks', () => {
    const r = simulate(
      [{ cardId: 'dm_malphas', attack: 10, health: 40, sourceUid: 'M', keywords: [], chosenOption: 1 },
       { cardId: 'impscrap', attack: 1, health: 20, sourceUid: 'I' }],
      [{ cardId: 'sandbag', attack: 0, health: 300 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 7 }), combatSide({ tier: 1 }));
    const copies = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(copies.length).toBeGreaterThan(0);
  });
});
