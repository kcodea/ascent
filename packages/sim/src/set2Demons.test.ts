import { describe, it, expect } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, applyGoldSpent, fireOnRubyCast, offerBuyStats, replayBattlecry } from './recruit';

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
    expect(s2.all.some((c) => c.id === 'dm_hungerling')).toBe(true);
    const demons = s2.buyable.filter((c) => c.id.startsWith('dm_'));
    expect(demons.length).toBeGreaterThan(10);
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

describe('set 2 — Appetite Agent auto-pick is a RANDOM eligible Demon (owner report 2026-08-14)', () => {
  // The auto-pick fallback (a Myra / Moira / Echoing Roar RE-FIRE with no explicit target, via `replayBattlecry`)
  // used `board.find(uid !== self)` — the LEFT-most minion, regardless of tribe. It must now pick a random
  // ELIGIBLE friendly (Demon-only, unless Rune of Open Appetite), seeded off the rng cursor.
  const base = (): RunState => ({
    ...createRun(1), phase: 'recruit',
    board: [
      minion('nd', 'stray', 1, 1),      // a NON-Demon at the far left — the old bug's victim
      minion('dA', 'dm_clerk', 1, 1),   // eligible Demon
      minion('dB', 'dm_clerk', 1, 1),   // eligible Demon
      minion('ag', 'dm_agent', 3, 2),   // the Agent itself (never eats via itself while a friend exists)
    ],
    shop: shop('sandbag'), // Target Dummy 0/4 — the eater gains +0/+4
  }) as RunState;
  const refire = (cursor: number): RunState => {
    const s: RunState = { ...base(), rngCursor: cursor };
    replayBattlecry(s, s.board.find((c) => c.uid === 'ag')!); // a re-fire: no explicit target → auto-pick
    return s;
  };

  it('never feeds the off-tribe left-most minion, and varies the Demon it feeds with the rng', () => {
    const picks = new Set<string>();
    for (let cursor = 0; cursor < 24; cursor++) {
      const s = refire(cursor);
      const nd = s.board.find((c) => c.uid === 'nd')!;
      expect([nd.attack, nd.health], 'the off-tribe left-most minion is never the eater').toEqual([1, 1]);
      const eater = [s.board.find((c) => c.uid === 'dA')!, s.board.find((c) => c.uid === 'dB')!].find((c) => c.health > 1);
      if (eater) picks.add(eater.uid);
    }
    expect(picks, 'across rng cursors it feeds BOTH demons — not a fixed left-most pick').toEqual(new Set(['dA', 'dB']));
  });

  it('is deterministic for a given rng cursor', () => {
    const eaterOf = (s: RunState): string =>
      [s.board.find((c) => c.uid === 'dA')!, s.board.find((c) => c.uid === 'dB')!].find((c) => c.health > 1)!.uid;
    expect(eaterOf(refire(5))).toBe(eaterOf(refire(5)));
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
    // The other half: clearing per action must not clear WITHIN one. Two End-of-Turn eaters (Bob Blarts) each
    // Consume a Shop minion, so one applyEndOfTurn produces several consumes — they must all be recorded.
    const s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [minion('L', 'dm_gourmand', 5, 4), minion('R', 'dm_gourmand', 5, 4)],
      hand: [], shop: shop('sandbag', 'alley', 'stray', 'pup'),
    };
    applyEndOfTurn(s);
    expect(s.shopEaten!.length).toBeGreaterThan(1);
  });

  it('an eaten minion RETURNS to the shared pool', () => {
    // It's destroyed, not owned — same as an unbought offer on a reroll. Without this, eight eating Demons drain
    // the run's pool permanently.
    // `dm_hungerling` (a set-2 BUYABLE) rather than the set-1 sandbag: with set 2 live, `returnToPool` only
    // credits cards the run's pinned pool actually contains — and tokens (stray) are never pooled.
    let s: RunState = {
      ...createRun(1), phase: 'recruit',
      board: [], hand: [minion('cc', 'dm_clerk', 1, 1)], shop: shop('dm_hungerling'),
    };
    const before = s.pool['dm_hungerling'] ?? 0;
    s = reduce(s, { type: 'play', uid: 'cc' });
    expect(s.pool['dm_hungerling'] ?? 0).toBe(before + 1);
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

  it('Hellrider eats NOTHING — it copies (owner rework 2026-08-14)', () => {
    // Was "eats exactly ONE minion on its 4th refresh", guarding a 2026-07-25 report that it ate "all of them".
    // The card no longer eats at all, so the guard becomes the stronger claim: across four refreshes the
    // consume channel stays completely empty while the stats still land.
    let s: RunState = {
      ...createRun(1), phase: 'recruit', embers: 99, freeRolls: 99,
      board: [minion('m', 'dm_maw', 8, 8)], hand: [], shop: shop('sandbag', 'alley', 'stray'),
    };
    for (let i = 0; i < 4; i++) s = reduce(s, { type: 'roll' });
    expect(s.shopEaten?.length ?? 0, 'Hellrider must not consume anything now').toBe(0);
    expect(s.shop.length, 'the row keeps every offer').toBe(3);
    const m = s.board.find((c) => c.uid === 'm')!;
    expect(m.attack + m.health, 'it still copied the right-most on the 4th refresh').toBeGreaterThan(16);
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
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp]).toEqual([1, 0]); // trigger 1: +1 Attack (even trigger)
    applyEndOfTurn(s);
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp]).toEqual([1, 2]); // trigger 2: +2 Health (odd trigger) — it escalated and swapped
    // A brand-new shop still carries it, which the per-offer version could not do.
    s.shop = shop('alley');
    expect([s.tavernBuyBonus.atk, s.tavernBuyBonus.hp]).toEqual([1, 2]);
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
  it('all 14 roster cards are in the set', () => {
    // 20: Pit Drillmaster went 2026-07-26, the Captain 2026-07-27, Riot Caller 2026-07-29 (all owner cuts).
    // 20 → 19 on 2026-08-04: Rouge Rogue (dm_chancellor) moved to the MINION ARCHIVE (cards/archive.ts) —
    // still in CARD_INDEX for saved runs, in no set.
    // 19 → 20 on 2026-08-14: Grobbus (`dm_grobbus`) joined the roster.
    // 20 → 14 on 2026-08-18: dm_clerk, dm_wrangler, dm_broodwright, dm_avarice, dm_vhal, dm_overseer
    // archived to ARCHIVED_CARDS (still in CARD_INDEX for saved runs, in no set).
    expect(poolFor('set2').all.filter((c) => c.id.startsWith('dm_')).length).toBe(14);
    expect(poolFor('set2').all.some((c) => c.id === 'dm_chancellor'), 'archived — not in the set').toBe(false);
    expect(CARD_INDEX['dm_chancellor'], 'archived — still resolvable by id').toBeTruthy();
  });

  it('Hellrider copies on every 4th REFRESH, counting from its own arrival', () => {
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
    expect(m4.attack + m4.health).toBeGreaterThan(16); // copied something
  });

  it('Endless Overseer (owner rework 2026-08-12): Avenge (4) summons an Imp with Taunt and Ward', () => {
    // The Overseer is immortal (0 attack, 9999 health); four disposable friendlies die to the wall → exactly
    // one Avenge(4) payout. The summoned Imp must carry BOTH Taunt and Ward.
    const r = simulate(
      [bm('dm_overseer', 'O', 0, 9999), bm('sandbag', 'a', 0, 1), bm('sandbag', 'b', 0, 1), bm('sandbag', 'c', 0, 1), bm('sandbag', 'd', 0, 1)],
      [{ cardId: 'sandbag', attack: 50, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length, 'one Imp per Avenge(4) threshold').toBe(1);
    const kws = (imps[0] as { minion: { keywords: string[] } }).minion.keywords;
    expect(kws, 'the Imp arrived without Taunt').toContain('T');
    expect(kws, 'the Imp arrived without Ward').toContain('DS');
  });

  it('…and a GILDED Overseer summons 2 Imps per Avenge(4)', () => {
    const r = simulate(
      [{ ...bm('dm_overseer', 'O', 0, 9999), golden: true }, bm('sandbag', 'a', 0, 1), bm('sandbag', 'b', 0, 1), bm('sandbag', 'c', 0, 1), bm('sandbag', 'd', 0, 1)],
      [{ cardId: 'sandbag', attack: 50, health: 9999 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const imps = r.events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'impscrap');
    expect(imps.length, 'gilded summons 2 per threshold').toBe(2);
  });

  it('Malphas is an Avenge Imp lord (owner rework 2026-08-18)', () => {
    // Reworked from the old Choose-One (Feast / Legion) into a straight Avenge Imp lord.
    const malphas = CARD_INDEX['dm_malphas']!;
    expect(malphas.chooseOne, 'the Choose-One is gone').toBeFalsy();
    const eff = malphas.effects.find((e) => e.do === 'avengeBuffImps')!;
    expect(eff, 'it now carries the avenge Imp-buff effect').toBeTruthy();
    expect(eff.on).toBe('avenge');
    expect(eff.params).toMatchObject({ count: 3, attack: 7, health: 5 });
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

  it('Malphas Avenge(3) buffs your Imps +7/+5, carried back to the run (owner rework 2026-08-18)', () => {
    // Malphas (fat immortal) + three disposable Taunt fodder that die to a modest killer → exactly one Avenge(3)
    // payout. The Imp buff is the run carry-back channel (`playerImpBuffGain`), so a combat-only buff would leave
    // it unset. Three deaths → one proc → +7/+5.
    const r = simulate(
      [{ cardId: 'dm_malphas', attack: 0, health: 9999, sourceUid: 'M', keywords: [] },
       { cardId: 'sandbag', attack: 0, health: 1, sourceUid: 'a', keywords: ['T'] as BoardMinion['keywords'] },
       { cardId: 'sandbag', attack: 0, health: 1, sourceUid: 'b', keywords: ['T'] as BoardMinion['keywords'] },
       { cardId: 'sandbag', attack: 0, health: 1, sourceUid: 'c', keywords: ['T'] as BoardMinion['keywords'] }],
      [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(3), CARD_INDEX,
      combatSide({ tier: 7 }), combatSide({ tier: 1 }));
    expect(r.playerImpBuffGain, 'the Avenge Imp buff never carried back').toEqual({ attack: 7, health: 5 });
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

    // PER-INSTANCE since 2026-08-08: the Fiend counts the casts IT witnessed, so crossing the run's global
    // 2→3 boundary is no longer what fires it — three casts seen by THIS body is. (That change is the point:
    // a freshly bought Fiend used to inherit the run's progress and fire on its first cast.)
    fireOnRubyCast(s, 0, 3);

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
    expect(rightmostBuff(s)).toBe(9); // +4/+5 (owner balance 2026-08-18: was +7/+6)
  });

  it('the buff CARRIES ACROSS refreshes — no Tormentor on board required', () => {
    let s = base();
    s = reduce(s, { type: 'play', uid: 'T' });
    s = { ...s, board: [] }; // sell it; the SLOT remembers, not the minion (owner: "i do not need it on board")
    for (const roll of [1, 2]) {
      s = reduce(s, { type: 'roll' });
      expect(rightmostBuff(s), `refresh ${roll} lost the slot buff`).toBe(9); // +4/+5
    }
  });

  it("STACKS to the owner's worked example shape: two normals + a gilded = +16/+20", () => {
    let s: RunState = { ...base(), hand: [
      minion('T1', 'dm_tormentor', 4, 4), minion('T2', 'dm_tormentor', 4, 4),
      { ...minion('T3', 'dm_tormentor', 8, 8), golden: true },
    ] };
    for (const uid of ['T1', 'T2', 'T3']) s = reduce(s, { type: 'play', uid });
    expect(rightmostBuff(s), 'the current shop should hold the full stack').toBe(36); // +16/+20: 4+4+8 atk, 5+5+10 hp
    s = reduce(s, { type: 'roll' });
    expect(rightmostBuff(s), 'the full stack should re-land after a refresh').toBe(36);
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
    expect(bought.health - def.health!).toBe(5);
  });

  it('a Hellrider copying the right-most reads the BUFFED body (buff-before-payout ordering)', () => {
    // The ordering rule predates this shape (owner ruling 2026-07-25) and must survive Hellrider's 2026-08-14
    // rework from eat to COPY: the slot buff applies at the top of `applyShopRefreshed`, before any watcher
    // runs. The evidence moved with the card — nothing is eaten now, so it is Hellrider's OWN stat gain that
    // has to include the +7/+6, and the offer has to still be sitting in the row afterwards.
    let s: RunState = {
      ...base(), hand: [minion('T', 'dm_tormentor', 4, 4)],
      board: [{ ...minion('H', 'dm_maw', 4, 6), eotTick: 3 }], // one refresh from firing
    };
    const shopUids = s.shop.map((offer) => offer.uid);
    s = reduce(s, { type: 'play', uid: 'T' });
    s = reduce(s, { type: 'roll' }); // Hellrider fires — it must read a body already carrying the slot buff
    const rider = s.board.find((c) => c.uid === 'H')!;
    const i = s.shop.length - 1 - [...s.shop].reverse().findIndex((offer) => !CARD_INDEX[offer.cardId]?.spell);
    const copied = offerBuyStats(s, s.shop[i]!);
    expect(rider.attack - 4, "Hellrider did not gain the right-most offer's Attack").toBe(copied.attack);
    expect(rider.health - 6, "Hellrider did not gain the right-most offer's Health").toBe(copied.health);
    const def = CARD_INDEX[s.shop[i]!.cardId]!;
    expect(copied.attack - def.attack!, 'the copied body was not buffed before the payout').toBe(4);
    expect(copied.health - def.health!, 'the copied body was not buffed before the payout').toBe(5);
    expect(s.shop.length, 'nothing may be eaten — Hellrider only copies now').toBe(shopUids.length);
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
  it("Bob Blart CONSUMES the right-most offer — it leaves the row (owner rework 2026-08-14)", () => {
    // Third shape. It ate the fattest offer, then copied the right-most without eating (2026-08-01), and now
    // EATS the right-most: the offer is gone, the stats land, and the consume payoffs fire (which the copy
    // shape deliberately skipped) — so `shopMinionsEaten` moving is part of the contract, not incidental.
    const s: RunState = {
      ...createRun(3), phase: 'recruit',
      board: [minion('g', 'dm_gourmand', 5, 5)], hand: [],
      shop: [{ uid: 's0', cardId: 'sandbag' }, { uid: 's1', cardId: 'alley' }],
    };
    const { attack: ra, health: rh } = offerBuyStats(s, s.shop[1]!); // right-most = alley
    const eatenBefore = s.shopMinionsEaten ?? 0;
    applyEndOfTurn(s);
    const blart = s.board.find((c) => c.uid === 'g')!;
    expect(s.shop.map((o) => o.uid), 'the right-most offer must be eaten').toEqual(['s0']);
    expect([blart.attack, blart.health], "it gains the eaten offer's stats").toEqual([5 + ra, 5 + rh]);
    expect((s.shopMinionsEaten ?? 0) - eatenBefore, 'a real Consume fires the consume payoffs').toBe(1);
  });

  it('Feastmaster Vhal (owner rework 2026-08-12): every 10 Gold spent buffs the right-most Shop minion +8/+8', () => {
    const s: RunState = {
      ...createRun(3), phase: 'recruit',
      board: [minion('v', 'dm_vhal', 6, 8)], hand: [],
      shop: shop('sandbag', 'alley', 'stray'),
    };
    const rm = () => { const i = [...s.shop].reverse().findIndex((o) => !CARD_INDEX[o.cardId]?.spell); return s.shop[s.shop.length - 1 - i]!; };
    applyGoldSpent(s, 9);
    expect((rm().atk ?? 0) + (rm().hp ?? 0), 'under the 10-Gold threshold, nothing yet').toBe(0);
    applyGoldSpent(s, 1); // 10 total → one threshold crossed
    expect([rm().atk ?? 0, rm().hp ?? 0], 'right-most gets +8/+8').toEqual([8, 8]);
    // …and it rides the run-wide accumulator, so a fresh roll re-lands it.
    expect(s.rightmostSlotBuff).toEqual({ attack: 8, health: 8 });
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
