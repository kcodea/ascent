import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, RUNES, EPIC_RUNES } from '@game/content';
import { createRun, reduce, type BoardCard, type RunState } from './index';
import { fireRecruitDeathrattlesForTest } from './recruit';

/** The owner's balance pass of 2026-11-06 (R-BALANCE-1106-01): the changes that needed more than a number. */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
const fight = (player: BoardMinion[], enemy: BoardMinion[], seed = 3) =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['kobold', 'beast'] }), combatSide({ tier: 1 }));
const golems = (events: CombatEvent[]) =>
  events.flatMap((e) => (e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'gemheart-shard' ? [e.minion] : []));
const rune = (id: string) => [...RUNES, ...EPIC_RUNES].find((r) => r.id === id)!;

describe('Spell Cart: the first spell bought from its row costs 1 less', () => {
  const cast = (): RunState => reduce(run({
    embers: 50,
    hand: [{ uid: 'sc', cardId: 'spellcart', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }],
  }), { type: 'play', uid: 'sc' });
  const priced = (s: RunState) => s.shop.filter((o) => (CARD_INDEX[o.cardId]?.cost ?? 0) >= 2);

  it('marks every spell it rolls, and the first buy pays 1 less', () => {
    const s = cast();
    expect(s.shop.length).toBeGreaterThan(1);
    expect(s.shop.every((o) => o.cartCut)).toBe(true);
    const offer = priced(s)[0]!;
    const after = reduce(s, { type: 'buy', uid: offer.uid });
    expect(s.embers - after.embers).toBe(CARD_INDEX[offer.cardId]!.cost! - 1);
  });

  it('the second buy pays full price: the first clears the mark from the row', () => {
    const s = cast();
    const [a, b] = priced(s);
    const one = reduce(s, { type: 'buy', uid: a!.uid });
    expect(one.shop.some((o) => o.cartCut)).toBe(false);
    const two = reduce(one, { type: 'buy', uid: b!.uid });
    expect(one.embers - two.embers).toBe(CARD_INDEX[b!.cardId]!.cost!);
  });

  it('a refresh loses the cut with the offers', () => {
    expect(reduce(cast(), { type: 'roll' }).shop.some((o) => o.cartCut)).toBe(false);
  });
});

describe('Portsmith: when a Kobold attacks, cast a permanent Ruby on it', () => {
  const rubyBuffsOn = (r: ReturnType<typeof simulate>, uid: string) =>
    r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.target === uid && !!e.ruby);

  it('keeps Ward, has no Avenge left, and prints the owner text', () => {
    const d = CARD_INDEX['k_portsmith']!;
    expect(d.keywords).toEqual(['DS']);
    expect(d.effects.some((e) => e.on === 'avenge')).toBe(false);
    expect(d.text).toBe('**Ward.** When a **Kobold** attacks, cast a permanent **Ruby** on it.');
  });

  it.each([[false, 1], [true, 2]] as const)('golden=%s: each Kobold swing takes %i Ruby stat(s), and a non-Kobold takes none', (golden, n) => {
    const r = fight(
      [bm('k_gemheart', 3, 900, { sourceUid: 'K' }), bm('k_portsmith', 6, 900, { sourceUid: 'P', golden }), bm('sandbag', 1, 900, { sourceUid: 'S' })],
      [bm('sandbag', 0, 100000)],
    );
    const uid = (id: string) => r.initial.player.find((m) => m.cardId === id)!.uid;
    const kobold = rubyBuffsOn(r, uid('k_gemheart'));
    expect(kobold.length).toBeGreaterThan(0);
    expect(kobold[0]!.attack).toBe(n);
    expect(rubyBuffsOn(r, uid('k_portsmith')).length, 'its own attacks count').toBeGreaterThan(0);
    expect(rubyBuffsOn(r, uid('sandbag')).length, 'not a Kobold').toBe(0);
  });
});

describe('Dawnclaw: one adjacent Shout, Gilded both once', () => {
  const fire = (golden: boolean, seed: number): number => {
    const s = run({ board: [body('l', 'dw_pimm'), body('d', 'b2_dawnclaw', { golden }), body('r', 'dw_pimm')], bonusEmbersNextTurn: 0, rngCursor: seed });
    fireRecruitDeathrattlesForTest(s, s.board[1]!);
    return s.bonusEmbersNextTurn ?? 0;
  };
  it('SHOP: plain fires exactly one neighbour on every seed, Gilded fires both', () => {
    for (let seed = 1; seed <= 12; seed++) {
      expect(fire(false, seed)).toBe(1);
      expect(fire(true, seed)).toBe(2);
    }
  });
});

describe('The Golem makers', () => {
  const rubied = (cardId: string, golden: boolean): BoardMinion =>
    bm(cardId, 1, 1, { golden, sourceUid: 'G', buffs: [{ source: 'Ruby', attack: 4, health: 4, count: 4 }] });

  it.each([[false, 1], [true, 2]] as const)('Gem Carver golden=%s summons %i plain Golem(s) with its Rubies', (golden, n) => {
    const got = golems(fight([rubied('k_gemheart', golden)], [bm('sandbag', 50, 90000)]).events);
    expect(got.map((m) => [m.attack, m.health])).toEqual(Array(n).fill([5, 5]));
  });

  it.each([[false, 3], [true, 5]] as const)('Geode Guardian golden=%s summons 2 Taunt Golems, each %i/%i with its Rubies left behind', (golden, size) => {
    const r = fight([rubied('k_geode', golden)], [bm('sandbag', 50, 90000)]);
    const got = golems(r.events);
    expect(got).toHaveLength(2);
    expect(got.every((m) => m.keywords.includes('T'))).toBe(true);
    const finals = got.map((m) => r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.target === m.uid).reduce((a, e) => a + e.attack, m.attack));
    expect(finals).toEqual([size, size]);
  });
});

describe('Rune rewards', () => {
  it('Pair grants one Tier 5 and one Tier 4', () => {
    expect(rune('rune_pair').reward).toEqual({ kind: 'multi', rewards: [{ kind: 'grant', randomTier: 5, randomCount: 1 }, { kind: 'grant', randomTier: 4, randomCount: 1 }] });
  });
  it('Unbroken Vein pays now, then every 2 turns', () => {
    expect(rune('rune_unbroken_vein').reward).toMatchObject({ kind: 'multi', rewards: [{ kind: 'grant', cards: ['k_veinbreaker'] }, { kind: 'recurringGrant', everyTurns: 2 }, { kind: 'runeUnbrokenVein' }] });
  });
});
