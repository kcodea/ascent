import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, castSpell, endOfTurnTicksOf, projectEndOfTurnSteps } from './recruit';

/**
 * THE OWNER'S SECOND KOBOLD NERF BATCH (2026-10-13, "they are still a bit overtuned") through the real reducer /
 * End-of-Turn / `simulate` paths:
 *
 *  1. Veinstorm casts on the Shop only, not on friendly minions.
 *  2. Drunk Daniel gives Shop spells +1/+1 (was +2/+2).
 *  3. Gemling casts Veinstorm once and gets a Ruby Transfer.
 *  4. Party Crasher's Rubies are permanent.
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const rubyBuff = (c: { buffs?: { source: string; attack: number; health: number }[] } | undefined) =>
  (c?.buffs ?? []).filter((b) => b.source === 'Ruby').reduce((n, b) => ({ attack: n.attack + b.attack, health: n.health + b.health }), { attack: 0, health: 0 });
const NONE = { attack: 0, health: 0 };
const spell = (uid: string, cardId: string): BoardCard => ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const offer = (s: RunState, uid: string) => s.shop.find((o) => o.uid === uid);

describe('Veinstorm: the Shop only, not friendly minions', () => {
  it('a cast gems the Shop and banks it; friendly minions get no Ruby', () => {
    const s0 = run({ board: [body('a', 'sandbag'), body('k', 'k_beggy')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [spell('vs', 'veinstorm')] });
    const s = act(s0, { type: 'play', uid: 'vs' });
    expect(rubyBuff(offer(s, 'o1')), 'the Shop minion is gemmed').toEqual({ attack: 1, health: 1 });
    expect(s.veinstormRubies, 'and the Shop bank grows').toEqual({ atk: 1, hp: 1 });
    expect(rubyBuff(at(s, 'a')), 'no Ruby on a friendly minion').toEqual(NONE);
    expect(rubyBuff(at(s, 'k')), 'no Ruby on a friendly Kobold').toEqual(NONE);
  });

  it('the Shop Ruby still folds Ruby strength and spell power', () => {
    const s0 = run({ rubyBonus: { attack: 2, health: 1 }, spellBonus: { attack: 3, health: 0 }, board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [spell('vs', 'veinstorm')] });
    const s = act(s0, { type: 'play', uid: 'vs' });
    expect(rubyBuff(offer(s, 'o1'))).toEqual({ attack: 6, health: 2 });
    expect(rubyBuff(at(s, 'a'))).toEqual(NONE);
  });

  it('the card says so, and passes no `minions` param', () => {
    const d = CARD_INDEX['veinstorm']!;
    expect(d.text).toBe('Your Shop minions **permanently** get stats equal to your Rubies (**+1/+1**), as **Rubies**.');
    expect(d.text).not.toMatch(/your minions/i);
    expect(d.effects.map((e) => [e.on, e.do, e.params ?? {}])).toEqual([['cast', 'spellBuffShopByRuby', {}]]);
  });

  it('the dormant `minions: true` switch still works on the factory (nothing in the pool passes it)', () => {
    // Why this is pinned: the engine half was left in place so the minion half is a one-param change if it returns.
    const probe: CardDef = { ...CARD_INDEX['veinstorm']!, id: 'dbg_1013_veinstorm_minions', effects: [{ on: 'cast', do: 'spellBuffShopByRuby', params: { minions: true } }] };
    CARD_INDEX[probe.id] = probe;
    try {
      const s = run({ board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
      castSpell(s, probe);
      expect(rubyBuff(at(s, 'a'))).toEqual({ attack: 1, health: 1 });
      expect(rubyBuff(offer(s, 'o1'))).toEqual({ attack: 1, health: 1 });
    } finally {
      delete CARD_INDEX[probe.id];
    }
  });
});

describe('everything that casts Veinstorm follows it', () => {
  it.each([[false, 1], [true, 2]] as const)('Storm Chaser (golden=%s): the Shout gems the Shop %i time(s), no Ruby on your minions', (golden, casts) => {
    const s0 = run({ board: [body('a', 'sandbag')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: [body('sc', 'k_stormchaser', { golden })] });
    const s = act(s0, { type: 'play', uid: 'sc' });
    expect(s.veinstormRubies).toEqual({ atk: casts, hp: casts });
    expect(rubyBuff(at(s, 'a'))).toEqual(NONE);
    expect(rubyBuff(at(s, 'sc')), 'nor on Storm Chaser itself').toEqual(NONE);
  });

  // Ryme (5 Attack, 1 Health) re-fires its neighbour's Shout in combat; the omen wall never dies.
  const refire = (golden: boolean) => simulate(
    [{ cardId: 'ryme', attack: 5, health: 1 } as BoardMinion, { cardId: 'k_stormchaser', attack: 0, health: 100, golden, sourceUid: 'SC' } as BoardMinion],
    [{ cardId: 'omen', attack: 50, health: 2000 } as BoardMinion], makeRng(1), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));

  it.each([[false, 1], [true, 2]] as const)('Storm Chaser in combat (golden=%s): the cast is announced, no live Ruby lands, %i Shop half banked', (golden, casts) => {
    const r = refire(golden);
    expect(r.events.some((e) => e.type === 'sc' && /casts Veinstorm/.test((e as { text: string }).text)), 'the cast still has its line / beat').toBe(true);
    expect(r.events.filter((e) => e.type === 'buff' && (e as { ruby?: boolean }).ruby === true), 'no Ruby in the fight').toEqual([]);
    expect(r.playerShoutCarry?.shopSpellHalves).toEqual(Array.from({ length: casts }, () => 'veinstorm'));
    expect(r.playerDeferredBattlecries ?? [], 'still not a deferred Shop-only Shout').toEqual([]);
  });

  it('settle applies the banked Shop half once per cast', () => {
    const r = refire(false);
    const s0 = run({ phase: 'combat', lastCombat: r, board: [body('SC', 'k_stormchaser')], shop: [{ uid: 'o1', cardId: 'sandbag' }] } as Partial<RunState>);
    const s = act(s0, { type: 'resolveCombat' });
    expect(s.veinstormRubies).toEqual({ atk: 1, hp: 1 });
    expect(rubyBuff(s.board.find((c) => c.uid === 'SC'))).toEqual(NONE);
  });

  it('Shrieker (End of Turn: trigger Shouts): its Storm Chaser re-fire gems the Shop only', () => {
    const s = run({ board: [body('sh', 'd2_shrieker'), body('sc', 'k_stormchaser')], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
    applyEndOfTurn(s);
    expect(s.veinstormRubies).toEqual({ atk: 1, hp: 1 });
    expect(rubyBuff(at(s, 'sh'))).toEqual(NONE);
  });
});

describe('Drunk Daniel: "End of Turn: give your Shop spells +1/+1" (Gilded +2/+2)', () => {
  it.each([[false, 1], [true, 2]] as const)('golden=%s raises Shop-spell power by %i/%i a turn', (golden, n) => {
    const s = run({ board: [body('dd', 'dw_drunkdaniel', { golden })] });
    applyEndOfTurn(s);
    expect(s.spellBonus).toEqual({ attack: n, health: n });
    applyEndOfTurn(s);
    expect(s.spellBonus, 'it stacks every turn').toEqual({ attack: 2 * n, health: 2 * n });
  });
  it('the body is unchanged (Tier 6, 6/6) and the text matches', () => {
    const d = CARD_INDEX['dw_drunkdaniel']!;
    expect([d.tier, d.attack, d.health]).toEqual([6, 6, 6]);
    expect([d.text, d.goldenText]).toEqual(['**End of Turn:** give your **Shop spells +1/+1**.', '**End of Turn:** give your **Shop spells +2/+2**.']);
  });
});

describe('Gemling: "End of Turn: Cast Veinstorm and get a Ruby Transfer"', () => {
  const transfers = (s: RunState): number => s.hand.filter((c) => c.cardId === 'rubytransfer').length;

  it.each([[false, 1], [true, 2]] as const)('golden=%s: %i Veinstorm cast(s), one beat each, and that many Ruby Transfers in hand', (golden, n) => {
    const s = run({ board: [body('g', 'k_gemline', { golden })], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
    expect(endOfTurnTicksOf(s, at(s, 'g'))).toBe(n);
    expect(projectEndOfTurnSteps(s).steps.length).toBe(n);
    applyEndOfTurn(s);
    expect(s.veinstormRubies).toEqual({ atk: n, hp: n });
    expect(transfers(s)).toBe(n);
    expect(s.hand.some((c) => c.cardId === 'veinstorm'), 'the Veinstorm is CAST, never handed over').toBe(false);
    expect(rubyBuff(at(s, 'g')), 'Veinstorm no longer lands on the Gemling').toEqual(NONE);
  });

  it('it pays every turn', () => {
    const s = run({ board: [body('g', 'k_gemline')], shop: [{ uid: 'o1', cardId: 'sandbag' }] });
    applyEndOfTurn(s);
    applyEndOfTurn(s);
    expect(transfers(s)).toBe(2);
    expect(s.veinstormRubies).toEqual({ atk: 2, hp: 2 });
  });

  it('a full hand takes no Ruby Transfer, and the Veinstorm still casts', () => {
    const full = Array.from({ length: 10 }, (_, i) => spell(`h${i}`, 'wo_mine'));
    const s = run({ board: [body('g', 'k_gemline')], shop: [{ uid: 'o1', cardId: 'sandbag' }], hand: full });
    applyEndOfTurn(s);
    expect(s.hand.length, 'the hand never grows past where it stood').toBeLessThanOrEqual(Math.max(10, full.length));
    expect(s.veinstormRubies).toEqual({ atk: 1, hp: 1 });
  });

  it('the text matches, and the granted spell exists', () => {
    const d = CARD_INDEX['k_gemline']!;
    expect([d.text, d.goldenText]).toEqual([
      '**End of Turn:** Cast **Veinstorm** and get a **Ruby Transfer**.',
      '**End of Turn:** Cast **Veinstorm** twice and get **2 Ruby Transfers**.',
    ]);
    expect(CARD_INDEX['rubytransfer']?.spell).toBe(true);
  });
});

describe('Party Crasher: "Avenge (2): Cast 3 permanent Rubies on your Kobolds"', () => {
  const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra } as BoardMinion);
  // Two 1/1 pups die first (Avenge 2); Party Crasher and a second Kobold are walls that outlive the trigger.
  const fight = (crasher: string, golden = false) => simulate(
    [bm('pup', 'p1', 1, 1), bm('pup', 'p2', 1, 1), bm(crasher, 'PC', 0, 4000, { golden }), bm('k_beggy', 'K', 0, 4000), bm('sandbag', 'N', 0, 4000)],
    [bm('sandbag', 'W', 8, 4000)], makeRng(11), CARD_INDEX, combatSide({ tier: 6, tribes: ['kobold'] }), combatSide({ tier: 1 }));
  type Perma = { sourceUid: string; attack: number; health: number; ruby?: boolean };
  const perma = (r: { playerPermaBuffs?: Perma[] }, uid: string): Perma[] => (r.playerPermaBuffs ?? []).filter((p) => p.sourceUid === uid && p.ruby);
  const total = (ps: Perma[]) => ps.reduce((n, p) => ({ attack: n.attack + p.attack, health: n.health + p.health }), { attack: 0, health: 0 });
  const rubyEvents = (r: { events: readonly { type: string; target?: string; ruby?: boolean }[] }) => r.events.filter((e) => e.type === 'buff' && e.ruby === true);

  it.each([[false, 3], [true, 6]] as const)('golden=%s: each Avenge carries %i Rubies back onto every Kobold, and none onto a non-Kobold', (golden, per) => {
    const r = fight('k_gemstorm', golden);
    const fires = rubyEvents(r).filter((e) => e.target === r.initial.player.find((m) => m.cardId === 'k_gemstorm')!.uid).length;
    expect(fires, 'the Avenge fired').toBeGreaterThan(0);
    for (const uid of ['PC', 'K']) expect(total(perma(r, uid)), `${uid} keeps its Rubies`).toEqual({ attack: per * fires, health: per * fires });
    expect(perma(r, 'N'), 'Kobolds only').toEqual([]);
  });

  it('the SAME Avenge without `permanent` ends with the fight (the flag is what carries it back)', () => {
    const temp: CardDef = { ...CARD_INDEX['k_gemstorm']!, id: 'dbg_1013_crasher_temp', effects: [{ on: 'avenge', do: 'avengePlayRubies', params: { count: 2, rubies: 3, tribe: 'kobold' } }] };
    CARD_INDEX[temp.id] = temp;
    try {
      const r = fight(temp.id);
      expect(rubyEvents(r).length, 'the Rubies still land in the fight').toBeGreaterThan(0);
      expect(perma(r, 'PC')).toEqual([]);
      expect(perma(r, 'K')).toEqual([]);
    } finally {
      delete CARD_INDEX[temp.id];
    }
  });

  it('the text says permanent, plain and Gilded', () => {
    const d = CARD_INDEX['k_gemstorm']!;
    expect([d.text, d.goldenText]).toEqual([
      '**Avenge (2):** Cast **3 permanent Rubies** on your **Kobolds**.',
      '**Avenge (2):** Cast **6 permanent Rubies** on your **Kobolds**.',
    ]);
  });
});
