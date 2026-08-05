import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, fireOnRubyCast, offerBuyStats } from './recruit';

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

describe('set 2 — Chipper eats with ITSELF (owner fix 2026-08-01)', () => {
  // Golden Chipper was feeding a random friendly Demon; both plain and golden say "this Consumes" now, and the
  // factory honors the `self: true` param that existed for exactly this.
  it('plain: playing a Demon makes CHIPPER consume — the other Demon never gains', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('ch', 'dm_glutton', 4, 4), minion('imp', 'impoverseer', 3, 3)],
      hand: [minion('d1', 'dm_clerk', 1, 1)],
      shop: shop('sandbag'), // Target Dummy, 0/4
    };
    s = reduce(s, { type: 'play', uid: 'd1' });
    const chipper = s.board.find((c) => c.uid === 'ch')!;
    const imp = s.board.find((c) => c.uid === 'imp')!;
    expect([chipper.attack, chipper.health], 'Chipper itself must gain the eaten stats').toEqual([4, 8]);
    expect([imp.attack, imp.health], 'the bystander Demon must be untouched').toEqual([3, 3]);
  });

  it('golden: still Chipper itself, at double stats', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [{ ...minion('ch', 'dm_glutton', 8, 8), golden: true }, minion('imp', 'impoverseer', 3, 3)],
      hand: [minion('d1', 'dm_clerk', 1, 1)],
      shop: shop('sandbag'),
    };
    s = reduce(s, { type: 'play', uid: 'd1' });
    const chipper = s.board.find((c) => c.uid === 'ch')!;
    expect([chipper.attack, chipper.health], 'golden Chipper gains double, on itself').toEqual([8, 16]);
    expect(s.board.find((c) => c.uid === 'imp')!.health, 'the bystander stays untouched').toBe(3);
  });

  it('playing Chipper itself does not trigger its own eat', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [minion('ch', 'dm_glutton', 4, 4)],
      shop: shop('sandbag'),
    };
    s = reduce(s, { type: 'play', uid: 'ch' });
    expect(s.shop.length, 'its own arrival must not feed it').toBe(1);
  });
});

describe('set 2 — consume hygiene (the 2026-07-25 report)', () => {
  it('the SHOP-consume swirl payload does NOT accumulate across actions', () => {
    // The bug: the payload was appended to but cleared only by a few call sites, so each new consume replayed
    // every PREVIOUS one. On screen that stacked ghost minions over the shop and made a card that hadn't eaten
    // (Demon Horse) look like it ate alongside one that had (Hellrider).
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
    // `dm_wrangler` (a set-2 BUYABLE) rather than the set-1 sandbag: with set 2 live, `returnToPool` only
    // credits cards the run's pinned pool actually contains — and tokens (stray) are never pooled.
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [minion('cc', 'dm_clerk', 1, 1)], shop: shop('dm_wrangler'),
    };
    const before = s.pool['dm_wrangler'] ?? 0;
    s = reduce(s, { type: 'play', uid: 'cc' });
    expect(s.pool['dm_wrangler'] ?? 0).toBe(before + 1);
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

  it('Hellrider eats exactly ONE minion on its 4th refresh', () => {
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



describe('set 2 — Contract Butcher / Soul Defiler buff the shop', () => {
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

  it('Errand Fiend (owner rework 2026-08-04): its RALLY summons an Imp and enchants your Imps +1/+1', () => {
    // 2026-07-27 moved it to an Echo; 2026-08-04 moved it back to attack — each swing makes an Imp and stacks
    // the run-wide Imp enchant (Flurry doubles the whole Rally). Big body so it attacks without dying first.
    const r = simulate([bm('dm_errand', 'E', 3, 40, ['W'])], [{ cardId: 'sandbag', attack: 0, health: 300 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 2 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length, 'each attack rallies an Imp out').toBeGreaterThan(0);
    // The enchant is the Imp aura channel — the tribeAura wash carries the +1/+1 and the run carry-back.
    const aura = r.events.find((e) => (e as { type: string; aura?: string }).type === 'tribeAura'
      && (e as { aura?: string }).aura === 'imp');
    expect(aura, 'the Imp enchant never landed').toBeTruthy();
    expect((aura as { attack?: number }).attack).toBe(1);
    expect((aura as { health?: number }).health).toBe(1);
    expect(r.playerImpBuffGain).toBeTruthy(); // permanent — carried back to the run's impBuff
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

  it('Legion Shepherd (owner rework 2026-07-27): Echo summons 4 Imps, and only OVERFLOW pays', () => {
    // On an empty line all 4 fit, so there is no overflow and no buff. This is the control: without it, a test
    // that only checks "a buff happened" on a full board can't tell the overflow gate from an unconditional one.
    const r = simulate([bm('dm_shepherd', 'S', 3, 1)], [{ cardId: 'sandbag', attack: 50, health: 300 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length).toBe(4);
    expect(r.events.filter((e) => (e as { type: string; source?: string }).type === 'buff'
      && (e as { source?: string }).source === 'm0'), 'nothing overflowed, so nothing should be granted').toEqual([]);
  });

  it('…and a FULL board converts the bodies it can’t fit into a permanent Imp-wide buff', () => {
    // Six filler bodies + the Shepherd = a full line, so every one of the 4 Imps overflows. The payout goes
    // through the Imp Aura channel, which is what makes it stick "everywhere" — assert the carry-back, since a
    // combat-only buff (the old `deathrattleSummonOverflowBuff` shape) would leave `playerImpBuffGain` unset.
    const filler = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((u) => bm('impscrap', u, 1, 200));
    const r = simulate([bm('dm_shepherd', 'S', 3, 1), ...filler], [{ cardId: 'sandbag', attack: 50, health: 9999 }],
      makeRng(3), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 1 }));
    expect(r.playerImpBuffGain, 'the grant never reached the permanent Imp-buff channel').toBeTruthy();
    expect(r.playerImpBuffGain!.attack).toBeGreaterThan(0);
    expect(r.playerImpBuffGain!.attack).toBe(r.playerImpBuffGain!.health); // +2/+2 per overflow, symmetric
  });
});

describe('set 2 — the last three (Overseer / Maw / Malphas)', () => {
  it('all 20 roster cards are in the set', () => {
    // 20: Pit Drillmaster went 2026-07-26, the Captain 2026-07-27, Riot Caller 2026-07-29 (all owner cuts).
    expect(poolFor('set2').all.filter((c) => c.id.startsWith('dm_')).length).toBe(20);
  });

  it('Hellrider eats on every 4th REFRESH, counting from its own arrival', () => {
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

  it('Endless Overseer (owner rework 2026-07-27): grafts an Imp Echo onto the RIGHT-most minion', () => {
    // The graft is invisible until the recipient dies, so the test kills the right-most body and looks for the
    // Imps. The Overseer itself is left-most and immortal here, so a payout can only have come from the graft.
    const r = simulate(
      [bm('dm_overseer', 'O', 0, 9999), bm('sandbag', 'R', 0, 1)],
      [{ cardId: 'sandbag', attack: 50, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length).toBe(2);
    // …with Ward, which is the half a plain `summonImps` graft would silently drop.
    const kws = (imps[0] as { minion: { keywords: string[] } }).minion.keywords;
    expect(kws, 'the grafted Imps arrived without Ward').toContain('DS');
  });

  it('…and grafts onto the right-most body only, not the whole board', () => {
    // Two disposable bodies; only the right-hand one should carry the Echo. Without this, a graft-everything
    // regression (the shape this card had before 2026-07-25) would still pass the test above.
    const r = simulate(
      [bm('dm_overseer', 'O', 0, 9999), bm('sandbag', 'M', 0, 1), bm('sandbag', 'R', 0, 1)],
      [{ cardId: 'sandbag', attack: 50, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length, 'both bodies paid out — the graft is not right-most-only').toBe(2);
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
    // Demon Horse as filler, which ate the shop by itself and made the assertion pass vacuously.
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

/**
 * Two bugs found by auditing every Set-2 card's effect params against what its factory actually READS —
 * a mismatch is silent, so neither showed up as a failing test.
 */
describe('set 2 — regressions from the effect-param audit', () => {
  it('Big Huggies grants a REAL card id (it passed `spellId`; the factory reads `cardId`)', () => {
    const eff = CARD_INDEX['dm_velvet']!.effects.find((e) => e.do === 'deathrattleGrantSpell')!;
    const granted = eff.params?.cardId as string;
    // The wrong key meant `str(params.cardId)` → '' → a hand-grant of the empty id, which crashed the
    // Recruit render on `CARD_INDEX[''].spell`.
    expect(granted).toBeTruthy();
    expect(CARD_INDEX[granted], `grants an id the index knows: ${granted}`).toBeDefined();
  });

  it('every hand-granting effect in set 2 names an id that exists', () => {
    for (const def of Object.values(CARD_INDEX).filter((d) => d.id.startsWith('dm_') || d.id.startsWith('k_') || d.id.startsWith('n2_'))) {
      for (const e of def.effects ?? []) {
        const id = e.params?.cardId;
        if (typeof id !== 'string' || !id) continue;
        expect(CARD_INDEX[id], `${def.name} → params.cardId '${id}'`).toBeDefined();
      }
    }
  });

  it('Gemgorge Fiend consumes through the shared primitive — pool return, FX record and onConsume', () => {
    const s: RunState = { ...createRun(7), phase: 'recruit' };
    s.board = [minion('g', 'k_gemgorge', 6, 6)];
    s.shop = shop('dm_clerk', 'dm_hungerling');
    const eaten = s.shop.length;
    // Stock both ids explicitly: a run only stocks the tribes it rolled, and `returnToPool` no-ops on an id
    // that isn't already a key — so without this the assertion would pass vacuously at 0 → 0.
    s.pool['dm_clerk'] = 3;
    s.pool['dm_hungerling'] = 3;
    const poolBefore = s.pool['dm_clerk']! + s.pool['dm_hungerling']!;

    fireOnRubyCast(s, 2, 3); // cross the "every 3" step

    expect(s.shop.length, 'the offer really leaves the shop').toBe(eaten - 1);
    expect(s.board[0]!.attack, 'and its stats land on the eater').toBeGreaterThan(6);
    // The three things the hand-rolled body used to skip:
    expect(s.shopEaten?.length, 'a consume record drives the animation').toBe(1);
    const poolAfter = s.pool['dm_clerk']! + s.pool['dm_hungerling']!;
    expect(poolAfter, 'the eaten card returns to the shared pool (no permanent drain)').toBe(poolBefore + 1);
  });

  it('Gemgorge never eats a Ruby offer', () => {
    const s: RunState = { ...createRun(9), phase: 'recruit' };
    s.board = [minion('g', 'k_gemgorge', 6, 6)];
    const ruby = Object.values(CARD_INDEX).find((d) => d.ruby)!;
    s.shop = [{ uid: 'r0', cardId: ruby.id }];

    fireOnRubyCast(s, 2, 3);

    expect(s.shop.length, 'the Ruby is still there — it is not food').toBe(1);
    expect(s.board[0]!.attack).toBe(6);
  });
});

/**
 * Market Tormentor — the owner's full spec, in his words (2026-07-31): "it's a shout: buff the right most shop
 * slot +4/+4. this stacks, so if i play 2 normals and then gild it and play that, the right most slot should
 * now have +16/+16. i do not need market tormentor on board. this effect takes place in the current shop when
 * played, and that buff carries over across refreshes as well."
 *
 * This is the card's THIRD shape, and these tests assert that quote rather than the code — the previous two
 * rewrites each pinned the then-current implementation, which is how a regression passed CI for two days.
 */
describe('set 2 — Market Tormentor (permanent right-most SLOT buff)', () => {
  const rightmostBuff = (s: RunState): number => {
    const i = [...s.shop].reverse().findIndex((o) => !CARD_INDEX[o.cardId]?.spell);
    const offer = s.shop[s.shop.length - 1 - i]!;
    return (offer.atk ?? 0) + (offer.hp ?? 0);
  };
  const base = (): RunState => ({
    ...createRun(11), phase: 'recruit', embers: 99, freeRolls: 99,
    board: [], hand: [minion('T', 'dm_tormentor', 4, 4)],
    shop: shop('sandbag', 'alley', 'stray'),
  });

  it('the Shout buffs the CURRENT shop immediately', () => {
    let s = base();
    s = reduce(s, { type: 'play', uid: 'T' });
    expect(rightmostBuff(s)).toBe(6); // +4/+2 (owner value change 2026-07-31: attack-forward, not symmetric)
  });

  it('the buff CARRIES ACROSS refreshes — no Tormentor on board required', () => {
    let s = base();
    s = reduce(s, { type: 'play', uid: 'T' });
    s = { ...s, board: [] }; // sell it; the SLOT remembers, not the minion (owner: "i do not need it on board")
    for (const roll of [1, 2]) {
      s = reduce(s, { type: 'roll' });
      expect(rightmostBuff(s), `refresh ${roll} lost the slot buff`).toBe(6); // +4/+2
    }
  });

  it("STACKS to the owner's worked example shape: two normals + a gilded = +16/+8", () => {
    let s: RunState = { ...base(), hand: [
      minion('T1', 'dm_tormentor', 4, 4), minion('T2', 'dm_tormentor', 4, 4),
      { ...minion('T3', 'dm_tormentor', 8, 8), golden: true },
    ] };
    for (const uid of ['T1', 'T2', 'T3']) s = reduce(s, { type: 'play', uid });
    expect(rightmostBuff(s), 'the current shop should hold the full stack').toBe(24); // +16/+8: 4+4+8 attack, 2+2+4 health
    s = reduce(s, { type: 'roll' });
    expect(rightmostBuff(s), 'the full stack should re-land after a refresh').toBe(24);
  });

  it('the buff rides the offer into the minion you BUY', () => {
    let s = base();
    s = reduce(s, { type: 'play', uid: 'T' });
    s = reduce(s, { type: 'roll' });
    const i = s.shop.length - 1 - [...s.shop].reverse().findIndex((o) => !CARD_INDEX[o.cardId]?.spell);
    const offer = s.shop[i]!;
    const def = CARD_INDEX[offer.cardId]!;
    const bought = offerBuyStats(s, offer);
    expect(bought.attack - def.attack!).toBe(4);
    expect(bought.health - def.health!).toBe(2);
  });

  it('a Hellrider consuming the right-most eats the BUFFED body (buff-before-consume ordering)', () => {
    // The ordering rule predates this shape (owner ruling 2026-07-25) and must survive it: the slot buff now
    // applies at the top of `applyShopRefreshed`, before any consuming watcher runs. `shopEaten` records the
    // eaten body's stats AS EATEN, so the +4/+4 is visible there or nowhere.
    let s: RunState = {
      ...base(), hand: [minion('T', 'dm_tormentor', 4, 4)],
      board: [{ ...minion('H', 'dm_maw', 4, 6), eotTick: 3 }], // one refresh from firing
    };
    s = reduce(s, { type: 'play', uid: 'T' });
    s = reduce(s, { type: 'roll' }); // Hellrider fires — it must eat a body already carrying the slot buff
    const eaten = s.shopEaten?.at(-1);
    expect(eaten, 'Hellrider did not fire on this refresh').toBeTruthy();
    const def = CARD_INDEX[eaten!.cardId]!;
    expect(eaten!.attack - def.attack!, 'the eaten body was not buffed before the consume').toBe(4);
    expect(eaten!.health - def.health!, 'the eaten body was not buffed before the consume').toBe(2);
  });
});

describe('Cupcakes (set 2 spell)', () => {
  it('the targeted Demon Consumes 4 random Shop minions — and gets their stats', () => {
    let s: RunState = {
      ...createRun(11), phase: 'recruit', embers: 20,
      board: [minion('D', 'dm_clerk', 2, 2)],
      hand: [{ uid: 'cake', cardId: 'cupcakes', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
      shop: shop('dm_wrangler', 'dm_errand', 'k_chipwick', 'k_deepvein', 'dm_fiend'),
    };
    const before = s.board[0]!;
    const stats = before.attack + before.health;
    s = reduce(s, { type: 'play', uid: 'cake', targetUid: 'D' });
    expect(s.shop.length, 'four Shop minions eaten').toBe(1);
    const after = s.board.find((c) => c.uid === 'D')!;
    expect(after.attack + after.health, 'the eater grew by what it ate').toBeGreaterThan(stats);
    expect(s.shopMinionsEaten, 'the consume meter counted all four').toBe(4);
  });
});

describe('set 2 — the reworked Demon consumers (owner batch 2026-07-27)', () => {
  it("Bob Blart COPIES the right-most offer's stats — nothing is eaten (owner fix 2026-08-01)", () => {
    // It used to Consume the highest-health Shop minion; the card's own comment ("takes the stats WITHOUT
    // eating") was the spec and the code wasn't. Now: the right-most offer's stats land on Blart, the Shop is
    // untouched, and no consume payoff fires.
    const s: RunState = {
      ...createRun(3), phase: 'recruit',
      board: [minion('g', 'dm_gourmand', 5, 5)], hand: [],
      shop: [{ uid: 's0', cardId: 'sandbag' }, { uid: 's1', cardId: 'alley' }],
    };
    const { attack: ra, health: rh } = offerBuyStats(s, s.shop[1]!); // right-most = alley
    applyEndOfTurn(s);
    const blart = s.board.find((c) => c.uid === 'g')!;
    expect(s.shop.map((o) => o.uid), 'the Shop must be untouched').toEqual(['s0', 's1']);
    expect([blart.attack, blart.health], "it gains the right-most offer's stats").toEqual([5 + ra, 5 + rh]);
  });

  it('Feastmaster Vhal eats too, not just its neighbours', () => {
    const s: RunState = {
      ...createRun(3), phase: 'recruit',
      board: [minion('v', 'dm_vhal', 6, 8)], hand: [],
      shop: shop('sandbag', 'alley', 'stray'),
    };
    applyEndOfTurn(s);
    // Alone on the board, the old version ate nothing at all — only neighbours consumed.
    expect(s.shopEaten?.some((e) => e.eaterUid === 'v'), 'Vhal itself consumed').toBe(true);
  });

  it('Demon Horse’s Rally carries a PERMANENT shop buff back out of combat', () => {
    // A Rally fires in COMBAT but the tavern buff is run state, so it can only reach the run through a
    // carry-back — the same shape Ruby strength and the Undead aura use. Written as a recruit factory (my
    // first attempt) the card would have done nothing at all: a combat Rally never reaches that table.
    const r = simulate(
      [bm('dm_hungerling', 'H', 4, 60)],
      [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 4 }), combatSide({ tier: 1 }));
    expect(r.playerTavernBuyGain, 'the Rally banked a shop buff').toBeDefined();
    expect(r.playerTavernBuyGain!.attack).toBeGreaterThanOrEqual(2);

    // …and settle applies it to the run-wide tavern channel, so a FRESH shop carries it.
    let s: RunState = {
      ...createRun(3), phase: 'combat', combatSettled: false, embers: 99, freeRolls: 99,
      board: [minion('h', 'dm_hungerling', 4, 5)], hand: [], shop: [],
      lastCombat: r,
    } as unknown as RunState;
    const before = s.tavernBuyBonus.atk;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.tavernBuyBonus.atk, 'the run-wide tavern buff rose').toBeGreaterThan(before);
    expect(offerBuyStats(s, s.shop[0]!).attack, 'and the new shop shows it')
      .toBeGreaterThan(CARD_INDEX[s.shop[0]!.cardId]!.attack);
  });
});
