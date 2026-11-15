/**
 * CINDERCHEF + EARTHBREAKER (owner 2026-11-15, R-CINDERCHEF-01).
 *
 *   Cinderchef (T1 Dragon 1/3): "Rally: gain +1/+1 for each Shop spell cast this turn." Gilded +2/+2 for each.
 *   Earthbreaker (T3 Dragon): "Whenever you cast a Shop spell, give your Dragons +2/+2." Gilded +4/+4.
 *
 * "Shop spell" is R-SHOPSPELL-01 (a spell from the set's Shop-spell pool; never a Ruby, a Clue or other Gift, or a
 * token). Real time by default: a Shop spell cast DURING combat counts toward "this turn" the moment it resolves.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { countRubyAsShopSpell, fireShopRally, noteSpellCast } from './recruit';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 30, tier: 6, recruitBuffFx: [], ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
const CHEF = 'd2_cinderchef';
const SHOP_SPELL = CARD_INDEX['growth']!; // a Set 2 Shop-pool spell

describe('Cinderchef — the card', () => {
  it('prints the new rule, plain and gilded', () => {
    const d = CARD_INDEX[CHEF]!;
    expect(d).toMatchObject({ tier: 1, attack: 1, health: 3, tribe: 'dragon' });
    expect(d.text).toBe('**Rally:** gain **+1/+1** for each **Shop spell** cast this turn.');
    expect(d.goldenText).toBe('**Rally:** gain **+2/+2** for each **Shop spell** cast this turn.');
    expect(poolFor('set2').spells.some((c) => c.id === SHOP_SPELL.id), 'the probe spell is a Set 2 Shop spell').toBe(true);
  });
});

describe('Cinderchef — SHOP Rally', () => {
  it('with 0 Shop spells cast this turn it gains nothing', () => {
    const s = run({ board: [body('c', CHEF)] });
    fireShopRally(s, at(s, 'c'));
    expect(stats(at(s, 'c'))).toEqual([1, 3]);
  });

  it('with 2 Shop spells cast it gains +2/+2 (gilded +4/+4), permanently', () => {
    const s = run({ board: [body('c', CHEF), body('g', CHEF, { golden: true, attack: 2, health: 6 })] });
    noteSpellCast(s, SHOP_SPELL);
    noteSpellCast(s, SHOP_SPELL);
    expect(s.shopSpellsThisTurn).toBe(2);
    fireShopRally(s, at(s, 'c'));
    fireShopRally(s, at(s, 'g'));
    expect(stats(at(s, 'c'))).toEqual([1 + 2, 3 + 2]);
    expect(stats(at(s, 'g'))).toEqual([2 + 4, 6 + 4]);
  });

  it('a Ruby (even one Spellstone books as a Shop spell) and a Clue never count', () => {
    const s = run({ board: [body('c', CHEF)] });
    countRubyAsShopSpell(s, CARD_INDEX['ruby']!, 1);
    noteSpellCast(s, CARD_INDEX['clue']!); // a Gift: a spell cast, not a Shop spell
    expect(s.spellsThisTurn, 'both reached the any-spell tally').toBe(2);
    expect(s.shopSpellsThisTurn ?? 0).toBe(0);
    fireShopRally(s, at(s, 'c'));
    expect(stats(at(s, 'c'))).toEqual([1, 3]);
  });

  it('the tally resets at the turn flip', () => {
    let s = run({ board: [body('c', CHEF)] });
    noteSpellCast(s, SHOP_SPELL);
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'settleCombat' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.shopSpellsThisTurn ?? 0).toBe(0);
  });
});

// ── COMBAT ────────────────────────────────────────────────────────────────────────────────────────────────────
// A probe Rally caster: every attack casts Growth (a Set 2 Shop-pool spell) for real through `castInCombat`.
const CASTER: CardDef = {
  id: 'cx_caster', name: 'Growth Caster', tribe: 'neutral', tier: 1, attack: 1, health: 900, keywords: ['RL'],
  effects: [{ on: 'onAttack', do: 'rallyCastNamedSpell', params: { spellId: 'growth' } }],
  text: '**Rally:** cast **Growth**.',
};
const CARDS: Record<string, CardDef> = { ...CARD_INDEX, [CASTER.id]: CASTER };
const bm = (uid: string, cardId: string, attack: number, health: number, golden = false): BoardMinion =>
  ({ uid, sourceUid: uid, cardId, attack, health, keywords: [...(CARDS[cardId]!.keywords)], golden } as unknown as BoardMinion);
const ofType = <T extends CombatEvent['type']>(events: readonly CombatEvent[], type: T) =>
  events.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === type);
const POOL = poolFor('set2').all.map((c) => c.id);
/** Cinderchef's own Rally gains, in order (its self-sourced buffs). */
const chefGains = (events: readonly CombatEvent[], uid: string) =>
  ofType(events, 'buff').filter((e) => e.target === uid && e.source === uid).map((e) => [e.attack, e.health]);
/** The combat uid of the body at board `index` (simulate renumbers bodies; `initial` keeps board order). */
const uidAt = (r: { initial: { player: { uid: string }[]; enemy: { uid: string }[] } }, side: 'player' | 'enemy', index: number): string => r.initial[side][index]!.uid;

describe('Cinderchef — COMBAT Rally reads the tally LIVE', () => {
  it('with 0 Shop spells and no caster, every Rally gains nothing', () => {
    const r = simulate([bm('c', CHEF, 1, 900)], [bm('sb', 'sandbag', 0, 50)], makeRng(3), CARDS,
      combatSide({ tier: 6, poolIds: POOL }), combatSide({ tier: 6 }));
    const c = uidAt(r, 'player', 0);
    expect(ofType(r.events, 'attack').some((e) => e.attacker === c), 'it did swing').toBe(true);
    expect(chefGains(r.events, c)).toEqual([]);
  });

  it('seeded from the recruit turn: 2 Shop spells → +2/+2 per Rally (gilded +4/+4)', () => {
    const plain = simulate([bm('c', CHEF, 1, 900)], [bm('sb', 'sandbag', 0, 50)], makeRng(3), CARDS,
      combatSide({ tier: 6, poolIds: POOL, shopSpellsThisTurn: 2 }), combatSide({ tier: 6 }));
    const gains = chefGains(plain.events, uidAt(plain, 'player', 0));
    expect(gains.length).toBeGreaterThan(0);
    for (const g of gains) expect(g).toEqual([2, 2]);
    const gilded = simulate([bm('c', CHEF, 2, 900, true)], [bm('sb', 'sandbag', 0, 50)], makeRng(3), CARDS,
      combatSide({ tier: 6, poolIds: POOL, shopSpellsThisTurn: 2 }), combatSide({ tier: 6 }));
    const gg = chefGains(gilded.events, uidAt(gilded, 'player', 0));
    expect(gg.length).toBeGreaterThan(0);
    for (const g of gg) expect(g).toEqual([4, 4]);
  });

  it('a Shop spell cast mid-fight counts IMMEDIATELY: each Rally after a cast is one step bigger', () => {
    // The caster swings first (left-most), casting Growth; Cinderchef swings next and sees it.
    const r = simulate([bm('cx', 'cx_caster', 1, 900), bm('c', CHEF, 1, 900)], [bm('sb', 'sandbag', 0, 400)], makeRng(5), CARDS,
      combatSide({ tier: 6, poolIds: POOL, shopSpellsThisTurn: 1 }), combatSide({ tier: 6 }));
    const tally = ofType(r.events, 'shopSpellTally').filter((e) => e.side === 'player');
    expect(tally.length, 'every combat Growth is a Shop spell').toBeGreaterThan(0);
    expect(tally.map((e) => e.count), 'seeded from the recruit turn, then +1 per cast').toEqual(tally.map((_, i) => 2 + i));
    // Walk the log: each Cinderchef gain equals the tally in force at that moment.
    const c = uidAt(r, 'player', 1);
    let live = 1;
    const seen: number[] = [];
    for (const e of r.events) {
      if (e.type === 'shopSpellTally' && e.side === 'player') live = e.count;
      if (e.type === 'buff' && e.target === c && e.source === c) { expect([e.attack, e.health]).toEqual([live, live]); seen.push(live); }
    }
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[0], 'the first Rally already includes the caster\'s first Growth').toBe(2);
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]!);
  });

  it('a spell outside the side\'s Shop-spell pool does not count', () => {
    const r = simulate([bm('cx', 'cx_caster', 1, 900), bm('c', CHEF, 1, 900)], [bm('sb', 'sandbag', 0, 400)], makeRng(5), CARDS,
      combatSide({ tier: 6, poolIds: POOL.filter((id) => id !== 'growth') }), combatSide({ tier: 6 }));
    expect(ofType(r.events, 'spellcast').filter((e) => e.side === 'player').length, 'the casts still happened').toBeGreaterThan(0);
    expect(ofType(r.events, 'shopSpellTally')).toEqual([]);
    expect(chefGains(r.events, uidAt(r, 'player', 1))).toEqual([]);
  });

  it('symmetric: an ENEMY cast feeds the enemy Cinderchef, never the player\'s', () => {
    const r = simulate([bm('c', CHEF, 1, 900)], [bm('ecx', 'cx_caster', 1, 900), bm('ec', CHEF, 1, 900)], makeRng(5), CARDS,
      combatSide({ tier: 6, poolIds: POOL }), combatSide({ tier: 6, poolIds: POOL }));
    expect(chefGains(r.events, uidAt(r, 'player', 0)), 'no player Shop spells').toEqual([]);
    expect(chefGains(r.events, uidAt(r, 'enemy', 1)).length).toBeGreaterThan(0);
  });
});

describe('Earthbreaker — +2/+2 to your Dragons per Shop spell (gilded +4/+4)', () => {
  it('prints and does +2/+2', () => {
    const d = CARD_INDEX['d2_scalechanter']!;
    expect(d.name).toBe('Earthbreaker');
    expect(d.text).toBe('Whenever you cast a **Shop spell**, give your **Dragons +2/+2**.');
    expect(d.goldenText).toBe('Whenever you cast a **Shop spell**, give your **Dragons +4/+4**.');
    const s = run({ board: [body('e', 'd2_scalechanter'), body('ge', 'd2_scalechanter', { golden: true, attack: 8, health: 6 }), body('c', CHEF)] });
    noteSpellCast(s, CARD_INDEX['emberpouch']!); // a Shop spell that buffs nothing itself
    // Each Earthbreaker buffs every Dragon: plain +2/+2 and gilded +4/+4, so each body gets +6/+6 in total.
    expect(stats(at(s, 'c'))).toEqual([1 + 6, 3 + 6]);
    expect(stats(at(s, 'e'))).toEqual([4 + 6, 3 + 6]);
  });
});
