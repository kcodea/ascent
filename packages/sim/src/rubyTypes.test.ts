import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, RUBY_TYPE_IDS, SPECIAL_RUBY_IDS, type BoardMinion, type CombatResult } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, EQUIPMENT_INDEX, RUNES, poolFor } from '@game/content';
import { createRun, reduce, equipmentUsesLeft, type Action, type BoardCard, type RunState } from './index';
import { mintRandomRubies, mintRubies, rubyCastCount } from './recruit';

/**
 * THE OWNER'S RUBY BATCH (2026-09-24) — every item, through the real reducer / `simulate` paths.
 *
 *   Warding Ruby "+1/+2, Ward if a Kobold"; four new Rubies (Golden: +2 Gold; Splintered: bounces once; Ripple:
 *   casts again; Dark: consumes the highest-Health Shop minion as Rubies); "a random Ruby" = all six types at equal
 *   odds; Ruby Shipment (2 Gold, 2 random Rubies); Kobe's Pummel (15); Shardluck; Geode + Carver Golems; Blast
 *   Pump; Prismatic Pick's Ruby Discover; Gemheart Legionnaire; and the follow-up: Rune of Investment (Epic, random
 *   Rubies), Rune of Resonance (every Ruby casts twice, a random Ruby each Start of Turn), Gem Sage (get a Ruby,
 *   also get a random one) and Dealski (a Choose One play gets 2 Rubies).
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
/** A plain body with a chosen tribe (so "is it a Kobold" is the only variable). The card id cycles through five
 *  vanilla bodies so three of them on one board never TRIPLE into a golden (which would erase the test). */
const FILLERS = ['sandbag', 'stray', 'pack', 'omen', 'venom'];
let fillerN = 0;
const plain = (uid: string, tribe: BoardCard['tribe'], over: Partial<BoardCard> = {}): BoardCard =>
  ({ uid, cardId: FILLERS[fillerN++ % FILLERS.length]!, tribe, attack: 2, health: 2, keywords: [], golden: false, ...over });
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set3', phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const rubyBuff = (c: { buffs?: { source: string; attack: number; health: number; count: number }[] }) =>
  c.buffs?.find((b) => b.source === 'Ruby');
const rubiesInHand = (s: RunState): BoardCard[] => s.hand.filter((c) => !!CARD_INDEX[c.cardId]?.ruby);
/** Mint one Ruby of `rubyId` and cast it on `targetUid` from hand. */
const castRuby = (s: RunState, rubyId: string, targetUid: string): RunState => {
  mintRubies(s, 1, rubyId);
  const ruby = s.hand.filter((c) => c.cardId === rubyId).pop()!;
  return act(s, { type: 'play', uid: ruby.uid, targetUid });
};

// ── 1. Warding Ruby ───────────────────────────────────────────────────────────────────────────────────────

describe('Warding Ruby: "Give a minion +1/+2. If it is a Kobold, give it Ward."', () => {
  it('prints and grants +1/+2; Ward only on a Kobold', () => {
    expect(CARD_INDEX['warding-ruby']!.text).toBe('Give a minion **+1/+2**. If it is a **Kobold**, give it **Ward**.');
    expect(CARD_INDEX['warding-ruby']!.target, 'Ward needs a board minion').toBe('friendly');
    let s = castRuby(run({ board: [plain('k', 'kobold'), plain('n', 'neutral')] }), 'warding-ruby', 'k');
    expect(rubyBuff(at(s, 'k'))).toMatchObject({ attack: 1, health: 2 });
    expect(at(s, 'k').keywords).toContain('DS');
    s = castRuby(s, 'warding-ruby', 'n');
    expect(rubyBuff(at(s, 'n'))).toMatchObject({ attack: 1, health: 2 });
    expect(at(s, 'n').keywords).not.toContain('DS');
  });

  it('scales with the run Ruby strength like the base Ruby (minted at 1/2 + rubyBonus)', () => {
    const s = run({ rubyBonus: { attack: 2, health: 1 } });
    mintRubies(s, 1, 'warding-ruby');
    expect([s.hand[0]!.attack, s.hand[0]!.health]).toEqual([3, 3]);
  });
});

// ── 2. The four new Rubies ────────────────────────────────────────────────────────────────────────────────

describe('the new Ruby tokens', () => {
  it('are set-2 Ruby tokens with the owner\'s texts and targets', () => {
    const want: Record<string, [string, 'any' | 'friendly']> = {
      'golden-ruby': ['Give a minion **+1/+1**. If it is a **Kobold**, gain **2 Gold**.', 'any'],
      'splintered-ruby': ['Give a minion **+1/+1**. If it is a **Kobold**, it bounces once.', 'friendly'],
      'ripple-ruby': ['Give a minion **+1/+1**. If it is a **Kobold**, it casts again.', 'any'],
      'dark-ruby': ['Give a minion **+1/+1**. If it is a **Kobold**, it consumes the highest Health minion in the Shop as Rubies.', 'friendly'],
    };
    for (const [id, [text, target]] of Object.entries(want)) {
      const d = CARD_INDEX[id]!;
      expect(d, id).toBeDefined();
      expect([d.ruby, d.token, d.text, d.target, d.attack, d.health]).toEqual([true, true, text, target, 1, 1]);
    }
    expect(RUBY_TYPE_IDS).toEqual(['ruby', 'warding-ruby', 'golden-ruby', 'splintered-ruby', 'ripple-ruby', 'dark-ruby']);
    expect(SPECIAL_RUBY_IDS).toEqual(['warding-ruby', 'golden-ruby', 'splintered-ruby', 'ripple-ruby', 'dark-ruby']);
  });

  describe('Golden Ruby', () => {
    it('on a Kobold: +1/+1 and 2 Gold, with the rider cue stamped; on a non-Kobold: stats only', () => {
      let s = run({ embers: 5, board: [plain('k', 'kobold'), plain('n', 'beast')] });
      s = castRuby(s, 'golden-ruby', 'k');
      expect(rubyBuff(at(s, 'k'))).toMatchObject({ attack: 1, health: 1 });
      expect(s.embers).toBe(7);
      expect(s.rubyRiderFx).toEqual([{ uid: 'k', rider: 'gold' }]);
      expect(s.rubyLandedFx, 'the Ruby-played cascade plays too').toEqual([{ uid: 'k', count: 1 }]);
      s = castRuby(s, 'golden-ruby', 'n');
      expect(s.embers, 'a Beast pays nothing').toBe(7);
      expect(s.rubyRiderFx ?? []).toEqual([]);
    });

    it('a dual-tribe or All-types body counts as a Kobold', () => {
      const s = castRuby(run({ embers: 0, board: [body('gg', 'k_gemgorge')] }), 'golden-ruby', 'gg');
      expect(s.embers, 'Gemgorge Fiend is a Kobold/Demon').toBe(2);
      const all = castRuby(run({ embers: 0, board: [plain('a', 'neutral', { allTribes: true })] }), 'golden-ruby', 'a');
      expect(all.embers, 'an All-types body is every tribe').toBe(2);
    });

    it('a Kobold Shop offer pays too (its target is `any`)', () => {
      const s = castRuby(run({ embers: 0, shop: [{ uid: 'o', cardId: 'k_beggy' }] }), 'golden-ruby', 'o');
      expect(s.embers).toBe(2);
      expect(s.shop[0]!.atk).toBe(1);
    });
  });

  describe('Splintered Ruby', () => {
    it('on a Kobold it bounces ONCE to a random other friendly minion, carrying the +1/+1 (the ruby-bounce ribbon records it)', () => {
      const s = castRuby(run({ board: [plain('k', 'kobold'), plain('a', 'beast'), plain('b', 'beast')] }), 'splintered-ruby', 'k');
      expect(rubyBuff(at(s, 'k'))).toMatchObject({ attack: 1, health: 1, count: 1 });
      const hops = ['a', 'b'].filter((u) => rubyBuff(at(s, u)));
      expect(hops, 'exactly one bounce').toHaveLength(1);
      expect(rubyBuff(at(s, hops[0]!))).toMatchObject({ attack: 1, health: 1 });
      expect(s.bounceFx).toEqual([{ kind: 'ruby', fromUid: 'k', toUid: hops[0] }]);
    });

    it('a non-Kobold target does not bounce; a lone Kobold has nowhere to bounce', () => {
      const n = castRuby(run({ board: [plain('n', 'beast'), plain('a', 'beast')] }), 'splintered-ruby', 'n');
      expect(rubyBuff(at(n, 'a'))).toBeUndefined();
      const lone = castRuby(run({ board: [plain('k', 'kobold')] }), 'splintered-ruby', 'k');
      expect(rubyBuff(at(lone, 'k'))).toMatchObject({ attack: 1, health: 1 });
      expect(lone.bounceFx ?? []).toEqual([]);
    });

    it('the hop is not a cast: a Golden Kobold does not double the bounce, and the hop never re-bounces', () => {
      const s = castRuby(run({ board: [plain('k', 'kobold', { golden: true }), plain('a', 'kobold')] }), 'splintered-ruby', 'k');
      expect(rubyBuff(at(s, 'a'))).toMatchObject({ attack: 1, health: 1, count: 1 });
      expect(s.bounceFx).toHaveLength(1);
    });
  });

  describe('Ripple Ruby', () => {
    it('on a Kobold it casts again: two real landings, two Ruby casts, a two-gem cue — never a third', () => {
      const s = castRuby(run({ board: [plain('k', 'kobold')] }), 'ripple-ruby', 'k');
      expect(rubyBuff(at(s, 'k'))).toMatchObject({ attack: 2, health: 2, count: 2 });
      expect(s.rubyCasts, 'the second cast counts for Ruby tallies').toBe(2);
      expect(at(s, 'k').rubiesOnThisTurn, 'both landings are "a Ruby played on this"').toBe(2);
      expect(s.rubyLandedFx).toEqual([{ uid: 'k', count: 2 }]);
      expect(s.rubyRiderFx).toEqual([{ uid: 'k', rider: 'ripple' }]);
    });

    it('on a non-Kobold it lands once', () => {
      const s = castRuby(run({ board: [plain('n', 'dwarf')] }), 'ripple-ruby', 'n');
      expect(rubyBuff(at(s, 'n'))).toMatchObject({ attack: 1, health: 1, count: 1 });
      expect(s.rubyCasts).toBe(1);
    });

    it('also ripples on a Kobold Shop offer', () => {
      const s = castRuby(run({ shop: [{ uid: 'o', cardId: 'k_beggy' }] }), 'ripple-ruby', 'o');
      expect([s.shop[0]!.atk, s.shop[0]!.hp]).toEqual([2, 2]);
    });
  });

  describe('Dark Ruby', () => {
    it('grants the Ruby, then consumes the highest-Health Shop minion — its stats land AS RUBIES', () => {
      // k_gemstorm is 5/10 — the highest Health in this row.
      const s = castRuby(run({ board: [plain('k', 'kobold')], shop: [{ uid: 'o1', cardId: 'k_beggy' }, { uid: 'o2', cardId: 'k_gemstorm' }, { uid: 'o3', cardId: 'k_deepvein' }] }), 'dark-ruby', 'k');
      expect(s.shop.map((o) => o.uid), 'the eaten offer left the Shop').toEqual(['o1', 'o3']);
      expect(rubyBuff(at(s, 'k')), '+1/+1 Ruby plus the 5/10 eaten, all under Ruby').toMatchObject({ attack: 6, health: 11, count: 2 });
      expect([at(s, 'k').attack, at(s, 'k').health]).toEqual([8, 13]);
      expect(s.shopEaten?.map((e) => [e.uid, e.eaterUid])).toEqual([['o2', 'k']]);
      expect(s.rubyRiderFx).toEqual([{ uid: 'k', rider: 'devour' }]);
    });

    it('ties go to the LEFTMOST minion; spells and Rubies in the row are never eaten', () => {
      const s = castRuby(run({ board: [plain('k', 'kobold')], shop: [{ uid: 'r', cardId: 'ruby' }, { uid: 'o1', cardId: 'k_beggy' }, { uid: 'o2', cardId: 'k_beggy' }] }), 'dark-ruby', 'k');
      expect(s.shop.map((o) => o.uid)).toEqual(['r', 'o2']);
    });

    it('with no Shop minion it is just the +1/+1 (owner ruling); a non-Kobold never consumes', () => {
      const empty = castRuby(run({ board: [plain('k', 'kobold')] }), 'dark-ruby', 'k');
      expect(rubyBuff(at(empty, 'k'))).toMatchObject({ attack: 1, health: 1, count: 1 });
      expect(empty.rubyRiderFx ?? []).toEqual([]);
      const beast = castRuby(run({ board: [plain('b', 'beast')], shop: [{ uid: 'o', cardId: 'k_beggy' }] }), 'dark-ruby', 'b');
      expect(beast.shop).toHaveLength(1);
    });

    it('can eat the Starform token — it is a regular Shop minion for consumes, exactly as Gemgorge Fiend sees it', () => {
      const s = castRuby(run({ board: [plain('k', 'kobold')], shop: [{ uid: 'o', cardId: 'k_beggy' }, { uid: 'sf', cardId: 'ce3_starform', starform: true, hp: 20 }] }), 'dark-ruby', 'k');
      expect(s.shop.map((o) => o.uid)).toEqual(['o']);
      expect(rubyBuff(at(s, 'k'))!.health).toBeGreaterThan(20);
    });

    it("the owner's example: the eaten stats count as the minion's Rubies, so a Gemheart Carver's Golems carry them", () => {
      const s = castRuby(run({ board: [body('c', 'k_gemheart')], shop: [{ uid: 'o', cardId: 'k_gemstorm' }] }), 'dark-ruby', 'c');
      const carver = at(s, 'c');
      expect(rubyBuff(carver)).toMatchObject({ attack: 6, health: 11 });
      const r = simulate([{ cardId: 'k_gemheart', attack: carver.attack, health: 1, sourceUid: 'c', buffs: carver.buffs } as BoardMinion],
        [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
      const golems = r.events.flatMap((e) => (e.type === 'summon' && e.minion.cardId === 'gemheart-shard' ? [e.minion] : []));
      expect(golems.map((g) => [g.attack, g.health])).toEqual([[7, 12], [7, 12]]);
    });
  });
});

// ── 3. "A random Ruby" + Ruby Shipment ────────────────────────────────────────────────────────────────────

describe('a random Ruby — all six types at equal odds, seeded', () => {
  it('every type appears, roughly evenly, and the same seed draws the same Rubies', () => {
    const tally: Record<string, number> = {};
    for (let seed = 1; seed <= 600; seed++) {
      const s = run({ rngCursor: seed * 7919, hand: [] });
      mintRandomRubies(s, 1);
      tally[s.hand[0]!.cardId] = (tally[s.hand[0]!.cardId] ?? 0) + 1;
    }
    expect(Object.keys(tally).sort()).toEqual([...RUBY_TYPE_IDS].sort());
    for (const id of RUBY_TYPE_IDS) expect(tally[id], id).toBeGreaterThan(60); // ~100 each of 600
    const a = run({ rngCursor: 42 }); mintRandomRubies(a, 3);
    const b = run({ rngCursor: 42 }); mintRandomRubies(b, 3);
    expect(a.hand.map((c) => c.cardId)).toEqual(b.hand.map((c) => c.cardId));
  });

  it('each random Ruby bakes the run Ruby strength onto its own base', () => {
    const s = run({ rubyBonus: { attack: 1, health: 1 } });
    mintRandomRubies(s, 12);
    for (const c of s.hand) {
      const d = CARD_INDEX[c.cardId]!;
      expect([c.attack, c.health], c.cardId).toEqual([d.attack + 1, d.health + 1]);
    }
  });

  it('Ruby Shipment costs 2 and gets 2 random Rubies, each drawn separately', () => {
    const d = CARD_INDEX['rubyshipment']!;
    expect([d.cost, d.text]).toEqual([2, 'Get **2** random **Rubies**.']);
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      let s = run({ rngCursor: seed * 104729, hand: [body('sh', 'rubyshipment')] });
      s = act(s, { type: 'play', uid: 'sh' });
      const got = rubiesInHand(s);
      expect(got).toHaveLength(2);
      if (got[0]!.cardId !== got[1]!.cardId) kinds.add('mixed');
      for (const g of got) kinds.add(g.cardId);
    }
    expect(kinds.has('mixed'), 'the two draws are independent').toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(6);
  });
});

// ── 4. Kobe ───────────────────────────────────────────────────────────────────────────────────────────────

describe('Kobe — Pummel (15): Get a random Ruby. (Twice per combat)', () => {
  const fight = (kobe: Partial<BoardMinion>): CombatResult =>
    simulate([{ cardId: 'k_kobe', attack: 15, health: 200, sourceUid: 'K', keywords: ['T'], ...kobe } as BoardMinion],
      [{ cardId: 'sandbag', attack: 0, health: 400 }], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));

  it('keeps Taunt and 5/6; the text is the owner\'s', () => {
    const d = CARD_INDEX['k_kobe']!;
    expect([d.attack, d.health, d.keywords]).toEqual([5, 6, ['T']]);
    expect(d.text).toBe('**Taunt.** **Pummel (15):** Get a random **Ruby**. (Twice per combat)');
  });

  it('every 15 damage dealt gets a random Ruby — at most TWICE per combat', () => {
    const r = fight({});
    expect(r.playerRubyGrantIds, 'many 15-damage hits, but capped at two payouts').toHaveLength(2);
    for (const id of r.playerRubyGrantIds!) expect(RUBY_TYPE_IDS).toContain(id);
    expect(r.events.filter((e) => e.type === 'pummelTrigger')).toHaveLength(2);
    expect(r.events.filter((e) => e.type === 'toHand' && RUBY_TYPE_IDS.includes(e.cardId)), 'each Ruby flies to hand as its own type').toHaveLength(2);
  });

  it('Gilded: 2 random Rubies per payout, still twice', () => {
    expect(fight({ golden: true }).playerRubyGrantIds).toHaveLength(4);
  });

  it('under 15 damage it pays nothing; the Rubies land in the hand at settle, at the run Ruby strength', () => {
    const r = fight({});
    let s = run({ phase: 'combat', rubyBonus: { attack: 1, health: 0 }, lastCombat: r, board: [body('K', 'k_kobe')] } as Partial<RunState>);
    s = act(s, { type: 'resolveCombat' });
    const got = rubiesInHand(s);
    expect(got.map((c) => c.cardId)).toEqual(r.playerRubyGrantIds);
    for (const c of got) expect(c.attack).toBe(CARD_INDEX[c.cardId]!.attack + 1);
    const small = simulate([{ cardId: 'k_kobe', attack: 5, health: 200, sourceUid: 'K', keywords: ['T'] } as BoardMinion],
      [{ cardId: 'sandbag', attack: 0, health: 9 }], makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(small.playerRubyGrantIds ?? [], 'two 5-damage hits = 10 dealt, short of 15').toEqual([]);
  });
});

// ── 5. Shardluck ──────────────────────────────────────────────────────────────────────────────────────────

describe('Shardluck — Choose One: Play 3 Rubies on your Kobolds or cast Veinstorm 3 times', () => {
  it('is a T6 8/5 with the owner\'s text', () => {
    const d = CARD_INDEX['k3_facetbound']!;
    expect([d.tier, d.attack, d.health]).toEqual([6, 8, 5]);
    expect(d.text).toBe('**Choose One:** Play **3 Rubies** on your **Kobolds** or cast **Veinstorm** 3 times.');
  });

  const board = (): BoardCard[] => [plain('k1', 'kobold'), plain('k2', 'kobold'), plain('b', 'beast'), body('gg', 'k_gemgorge')];
  it('branch 1: 3 plain Rubies, each on a random OTHER friendly Kobold (dual tribes count, never itself, never a Beast)', () => {
    let s = run({ board: board(), hand: [body('sl', 'k3_facetbound')] });
    s = act(act(s, { type: 'play', uid: 'sl' }), { type: 'chooseOne', index: 0 });
    const counts = ['k1', 'k2', 'gg'].map((u) => rubyBuff(at(s, u))?.count ?? 0);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
    expect(rubyBuff(at(s, 'b'))).toBeUndefined();
    expect(rubyBuff(at(s, 'sl')), 'R-TARGET-03: a random pick never lands on the source').toBeUndefined();
  });

  it('Gilded: 6 Rubies', () => {
    let s = run({ board: board(), hand: [body('sl', 'k3_facetbound', { golden: true })] });
    s = act(act(s, { type: 'play', uid: 'sl' }), { type: 'chooseOne', index: 0 });
    expect(['k1', 'k2', 'gg'].map((u) => rubyBuff(at(s, u))?.count ?? 0).reduce((a, b) => a + b, 0)).toBe(6);
  });

  it('branch 2: Veinstorm cast 3 times (6 Gilded) as real Shop spells', () => {
    let s = run({ board: board(), hand: [body('sl', 'k3_facetbound')] });
    const before = s.spellsCast;
    s = act(act(s, { type: 'play', uid: 'sl' }), { type: 'chooseOne', index: 1 });
    expect(s.spellsCast - before).toBe(3);
    let g = run({ board: board(), hand: [body('sl', 'k3_facetbound', { golden: true })] });
    g = act(act(g, { type: 'play', uid: 'sl' }), { type: 'chooseOne', index: 1 });
    expect(g.spellsCast - before).toBe(6);
  });
});

// ── 6 + 7. Geode Guardian + Gemheart Carver ───────────────────────────────────────────────────────────────

describe('Gemheart Golems — Carver summons 2, Geode 1 with Taunt, each carrying the Rubies', () => {
  const golemsOf = (cardId: string, golden = false) => {
    const r = simulate([{ cardId, attack: 6, health: 1, sourceUid: 'X', golden, buffs: [{ source: 'Ruby', attack: 2, health: 2, count: 2 }] } as BoardMinion],
      [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    return r.events.flatMap((e) => (e.type === 'summon' && e.minion.cardId === 'gemheart-shard' ? [e.minion] : []));
  };
  it("Carver: 'Echo: Summon 2 Gemheart Golems with this minion's Rubies.' — each is 1/1 + the Rubies; Gilded 2/2 + double", () => {
    expect(CARD_INDEX['k_gemheart']!.text).toBe("**Echo:** Summon **2 Gemheart Golems** with this minion's Rubies.");
    expect(golemsOf('k_gemheart').map((g) => [g.attack, g.health])).toEqual([[3, 3], [3, 3]]);
    expect(golemsOf('k_gemheart', true).map((g) => [g.attack, g.health])).toEqual([[6, 6], [6, 6]]);
  });
  it("Geode: 'Echo: Summon a Gemheart Golem with this minion's Rubies and Taunt.' — keeps its own Taunt and stats", () => {
    const d = CARD_INDEX['k_geode']!;
    expect([d.attack, d.health, d.keywords]).toEqual([4, 3, ['T']]);
    const g = golemsOf('k_geode');
    expect(g.map((x) => [x.attack, x.health])).toEqual([[3, 3]]);
    expect(g[0]!.keywords).toContain('T');
    expect(golemsOf('k_geode', true).map((x) => [x.attack, x.health])).toEqual([[6, 6]]);
  });
  it('Carver in the Shop (a borrowed body destroyed on play): two Golems land carrying the Rubies', () => {
    let s = run({ hand: [body('c', 'k_gemheart', { borrowed: true, buffs: [{ source: 'Ruby', attack: 1, health: 1, count: 1 }], attack: 6, health: 4 } as Partial<BoardCard>)] });
    s = act(act(s, { type: 'play', uid: 'c' }), { type: 'resolveShopDeath' });
    expect(s.board.filter((c) => c.cardId === 'gemheart-shard').map((c) => [c.attack, c.health])).toEqual([[2, 2], [2, 2]]);
  });
});

// ── 8. Blast Pump ─────────────────────────────────────────────────────────────────────────────────────────

describe('Blast Pump — Cast a Ruby on all of your minions (Gilded: 2 on each)', () => {
  const armed = (golden = false): RunState =>
    act(run({ board: [plain('a', 'beast'), plain('b', 'kobold')], hand: [body('bs', 'k3_blastsurveyor', { golden })] }), { type: 'play', uid: 'bs', toIndex: 0 });
  it('one Ruby lands on every minion, cast as the Ruby Blast Shop spell (the Equipment-Spell classification holds)', () => {
    const s = armed();
    const used = act(s, { type: 'activateEquipment' });
    for (const u of ['a', 'b', 'bs']) expect(rubyBuff(at(used, u)), u).toMatchObject({ attack: 1, health: 1, count: 1 });
    expect([EQUIPMENT_INDEX['blast_pump']!.spellId, EQUIPMENT_INDEX['blast_pump']!.params?.spellId, CARD_INDEX['rubyblast']!.spell]).toEqual(['rubyblast', 'rubyblast', true]);
    expect(equipmentUsesLeft(used)).toBe(equipmentUsesLeft(s) - 1);
  });
  it('Gilded: two Rubies on each', () => {
    const used = act(armed(true), { type: 'activateEquipment' });
    for (const u of ['a', 'b']) expect(rubyBuff(at(used, u)), u).toMatchObject({ attack: 2, health: 2, count: 2 });
  });
});

// ── 9. Prismatic Pick ─────────────────────────────────────────────────────────────────────────────────────

describe('Prismatic Pick — Discover a Ruby', () => {
  it('offers 3 of the 5 special types, and the pick is MINTED at the run Ruby strength', () => {
    let s = act(run({ rubyBonus: { attack: 2, health: 2 }, hand: [body('p', 'k3_prismpick')] }), { type: 'play', uid: 'p', toIndex: 0 });
    s = act(act(s, { type: 'activateEquipment' }), { type: 'chooseOne', index: 0 });
    expect(s.discover).toHaveLength(3);
    for (const id of s.discover!) expect(SPECIAL_RUBY_IDS).toContain(id);
    const pick = s.discover![0]!;
    s = act(s, { type: 'discover', index: 0 } as Action);
    const got = s.hand.find((c) => c.cardId === pick)!;
    expect([got.attack, got.health]).toEqual([CARD_INDEX[pick]!.attack + 2, CARD_INDEX[pick]!.health + 2]);
  });
});

// ── 10. Gemheart Legionnaire ──────────────────────────────────────────────────────────────────────────────

describe('Gemheart Legionnaire — When you summon a Gemheart Golem, this casts 5 permanent Rubies on itself', () => {
  it('is a Set 3 T4 4/8 Kobold in the pool', () => {
    const d = CARD_INDEX['k3_legionnaire']!;
    expect([d.tribe, d.tier, d.attack, d.health]).toEqual(['kobold', 4, 4, 8]);
    expect(poolFor('set3').buyable.some((c) => c.id === 'k3_legionnaire')).toBe(true);
  });

  it('in combat: each Golem summon plays 5 permanent Rubies, carried back to the run card (Gilded 10)', () => {
    const fight = (golden: boolean) => simulate([
      { cardId: 'k_gemheart', attack: 1, health: 1, sourceUid: 'C' } as BoardMinion,
      { cardId: 'k3_legionnaire', attack: 4, health: 300, sourceUid: 'L', golden } as BoardMinion,
    ], [{ cardId: 'sandbag', attack: 9, health: 400 }], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const perma = (r: CombatResult) => (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'L' && p.ruby)
      .reduce((n, p) => n + p.attack, 0);
    expect(perma(fight(false)), 'two Golems x 5 Rubies at 1/1').toBe(10);
    expect(perma(fight(true)), 'Gilded: 10 per Golem').toBe(20);
  });

  it('in the Shop: a Carver Echo forced there summons two Golems → +10/+10 of Rubies', () => {
    let s = run({ board: [body('L', 'k3_legionnaire')], hand: [body('c', 'k_gemheart', { borrowed: true } as Partial<BoardCard>)] });
    s = act(act(s, { type: 'play', uid: 'c' }), { type: 'resolveShopDeath' });
    expect(rubyBuff(at(s, 'L'))).toMatchObject({ attack: 10, health: 10 });
  });

  it('ignores every other summon', () => {
    const r = simulate([
      { cardId: 'k3_legionnaire', attack: 4, health: 300, sourceUid: 'L' } as BoardMinion,
    ], [{ cardId: 'sandbag', attack: 1, health: 400 }], makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect((r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === 'L')).toEqual([]);
  });
});

// ── 11. Runes of Investment + Resonance ───────────────────────────────────────────────────────────────────

describe('Rune of Investment — Epic: sell 4 minions, get 2 random Rubies and improve your Rubies +1/+1', () => {
  it('is an EPIC rune now', () => {
    expect(EPIC_RUNES.some((r) => r.id === 'rune_investment')).toBe(true);
    expect(RUNES.some((r) => r.id === 'rune_investment')).toBe(false);
    expect(EPIC_RUNES.find((r) => r.id === 'rune_investment')!.text).toBe('When you **sell 4 minions**, get **2 random Rubies** and improve your **Rubies** by **+1/+1**.');
  });
  it('the fourth sale pays 2 random Rubies at the improved strength', () => {
    let s = run({ runeSellRubies: 2, runeSellRubiesSold: 3, board: [plain('x', 'beast')] });
    s = act(s, { type: 'sell', uid: 'x' });
    const got = rubiesInHand(s);
    expect(got).toHaveLength(2);
    for (const c of got) {
      expect(RUBY_TYPE_IDS).toContain(c.cardId);
      expect(c.attack).toBe(CARD_INDEX[c.cardId]!.attack + 1);
    }
  });
});

describe('Rune of Resonance — Your Rubies cast twice from hand. Start of Turn: get a random Ruby.', () => {
  const buy = (over: Partial<RunState> = {}): RunState =>
    act(run({ setId: 'set2', wave: 7, embers: 10, runeforgeOffer: ['rune_resonance'], ...over }), { type: 'buyRune', index: 0 });

  it('buying it hands over one random Ruby at once', () => {
    const s = buy();
    expect(rubiesInHand(s)).toHaveLength(1);
    expect(RUBY_TYPE_IDS).toContain(rubiesInHand(s)[0]!.cardId);
  });

  it('EVERY Ruby played from hand casts twice — no per-turn window any more', () => {
    const s = buy();
    for (const n of [0, 1, 2, 5]) expect(rubyCastCount({ ...s, rubyCastsThisTurn: n }), `Ruby #${n + 1}`).toBe(2);
  });

  it('Start of Turn: one random Ruby', () => {
    const s = buy();
    const fought = { ...s, phase: 'combat', lastCombat: { events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0, initial: { player: [], enemy: [] } } } as unknown as RunState;
    const held = rubiesInHand(s).length;
    const next = act(fought, { type: 'resolveCombat' });
    expect(rubiesInHand(next).length).toBe(held + 1);
  });

  // The owner asked what the rune adds up to with the new Rubies: each cast resolves its own rider.
  it('with a Ripple Ruby: 2 casts, each ripples once → 4 landings (+4/+4) and 4 Ruby casts', () => {
    const s = castRuby(buy({ board: [plain('k', 'kobold')] }), 'ripple-ruby', 'k');
    expect(rubyBuff(at(s, 'k'))).toMatchObject({ attack: 4, health: 4, count: 4 });
    expect(s.rubyCasts).toBe(4);
  });

  it('with a Splintered Ruby: 2 casts on the target (+2/+2), each bouncing once to a random other minion', () => {
    const s = castRuby(buy({ board: [plain('k', 'kobold'), plain('a', 'beast'), plain('b', 'beast')] }), 'splintered-ruby', 'k');
    expect(rubyBuff(at(s, 'k'))).toMatchObject({ attack: 2, health: 2, count: 2 });
    expect(s.bounceFx).toHaveLength(2);
    expect(['a', 'b'].map((u) => rubyBuff(at(s, u))?.count ?? 0).reduce((x, y) => x + y, 0)).toBe(2);
  });

  it('with a Golden Ruby: 2 casts → 4 Gold; with a Dark Ruby: 2 casts → it eats the two highest-Health Shop minions', () => {
    const g = buy({ board: [plain('k', 'kobold')] });
    const gold0 = g.embers;
    expect(castRuby(g, 'golden-ruby', 'k').embers - gold0).toBe(4);
    const d = castRuby(buy({ board: [plain('k', 'kobold')], shop: [{ uid: 'o1', cardId: 'k_beggy' }, { uid: 'o2', cardId: 'k_gemstorm' }, { uid: 'o3', cardId: 'k_deepvein' }] }), 'dark-ruby', 'k');
    expect(d.shop.map((o) => o.uid)).toEqual(['o3']);
  });
});

// ── 12. Gem Sage + Dealski ────────────────────────────────────────────────────────────────────────────────

describe('Gem Sage — When you get a Ruby, also get a random Ruby', () => {
  it('each Ruby that reaches the hand pays one random Ruby — the Sage\'s own never re-trigger it', () => {
    const s = run({ board: [body('gs', 'k_gemsage')] });
    mintRubies(s, 1);
    expect(rubiesInHand(s)).toHaveLength(2);
    mintRubies(s, 2);
    expect(rubiesInHand(s)).toHaveLength(6);
  });
  it('two Sages: each pays once per Ruby, neither hears the other\'s grant (no loop); Gilded pays 2', () => {
    const two = run({ board: [body('g1', 'k_gemsage'), body('g2', 'k_gemsage')] });
    mintRubies(two, 1);
    expect(rubiesInHand(two)).toHaveLength(3);
    const gilded = run({ board: [body('g', 'k_gemsage', { golden: true })] });
    mintRubies(gilded, 1);
    expect(rubiesInHand(gilded)).toHaveLength(3);
  });
  it('a Ruby won in combat counts too — it arrives through the same mint at settle', () => {
    const r = simulate([{ cardId: 'k_tunnelcharger', attack: 3, health: 300, sourceUid: 'T', keywords: ['RL'] } as BoardMinion],
      [{ cardId: 'sandbag', attack: 0, health: 3 }], makeRng(2), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    const won = r.playerRubyGrants ?? 0;
    expect(won, "one Rally: Rikk's 3 Rubies").toBe(3);
    const s = act(run({ phase: 'combat', lastCombat: r, board: [body('gs', 'k_gemsage'), body('T', 'k_tunnelcharger')] } as Partial<RunState>), { type: 'resolveCombat' });
    expect(rubiesInHand(s).length, 'each won Ruby pays one more').toBe(won * 2);
  });
});

describe('Dealski — When you play a Choose One card, get 2 Rubies', () => {
  it('is a Set 3 T4 6/6 Kobold in the pool', () => {
    const d = CARD_INDEX['k3_dealski']!;
    expect([d.tribe, d.tier, d.attack, d.health]).toEqual(['kobold', 4, 6, 6]);
    expect(poolFor('set3').buyable.some((c) => c.id === 'k3_dealski')).toBe(true);
  });
  it('a Choose One play gets 2 plain Rubies (Gilded 4); a plain play gets none', () => {
    const play = (golden: boolean, cardId: string) => {
      let s = run({ board: [body('d', 'k3_dealski', { golden })], hand: [body('x', cardId)] });
      s = act(s, { type: 'play', uid: 'x' });
      if (s.chooseOne) s = act(s, { type: 'chooseOne', index: 0 });
      return rubiesInHand(s).map((c) => c.cardId);
    };
    expect(play(false, 'k_veinbreaker')).toEqual(['ruby', 'ruby']);
    expect(play(true, 'k_veinbreaker')).toEqual(['ruby', 'ruby', 'ruby', 'ruby']);
    expect(play(false, 'k_beggy')).toEqual([]);
  });
});
