import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, RUBY_TYPE_IDS, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { fireRecruitDeathrattlesForTest, fireShopRally } from './recruit';

/**
 * THE OWNER'S SET 2 BALANCE ADJUSTMENT (2026-10-24), each change through the real reducer / Shop-trigger /
 * `simulate` paths, plain and Gilded:
 *   "tunneller rik -> rally: get a random ruby"
 *   "cave cutter -> choose one: give your rubies +1/+1 or get 4 rubies"
 *   "Scrapper -> T2, stats to 3/1 echo: your rubies gain +1 attack"
 *   "gem carver -> T4"
 *   "beev -> when a beast attacks give it and this +2/+1"
 *   "big huggies -> taunt. echo: get 2 staff of guels"
 *   "big brain billy -> buff to +2/+2"
 */

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'warden', 'ascent', undefined, 'set2'), phase: 'recruit', embers: 20, tier: 6, hand: [], board: [], shop: [], ...over } as RunState);
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const rubiesInHand = (s: RunState): BoardCard[] => s.hand.filter((c) => !!CARD_INDEX[c.cardId]?.ruby);
const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...extra });
const fight = (player: BoardMinion[], enemy: BoardMinion[], seed = 3) =>
  simulate(player, enemy, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast', 'kobold'] }), combatSide({ tier: 1 }));
const uidOf = (r: ReturnType<typeof simulate>, cardId: string) => r.initial.player.find((m) => m.cardId === cardId)!.uid;
const buffs = (r: ReturnType<typeof simulate>) => r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff');
const set2Pool = new Set(poolFor('set2').buyable.map((c) => c.id));
const stats = (id: string) => { const d = CARD_INDEX[id]!; return [d.tribe, d.tier, d.attack, d.health, [...d.keywords]]; };

describe('Tunneller Rik: Rally: get a random Ruby (2026-10-24, was 2)', () => {
  it('keeps its body; text says one random Ruby (Gilded 2)', () => {
    expect(stats('k_tunnelcharger')).toEqual(['kobold', 3, 3, 4, ['RL']]);
    expect(CARD_INDEX['k_tunnelcharger']!.text).toBe('**Rally:** Get a random **Ruby**.');
    expect(CARD_INDEX['k_tunnelcharger']!.goldenText).toBe('**Rally:** Get **2** random **Rubies**.');
  });
  it.each([[false, 1], [true, 2]] as const)('COMBAT (golden=%s): one Rally mints %i random Ruby type(s)', (golden, n) => {
    const r = simulate([{ cardId: 'k_tunnelcharger', attack: 3, health: 300, sourceUid: 'T', keywords: ['RL'], golden } as BoardMinion],
      [{ cardId: 'sandbag', attack: 0, health: 3 }], makeRng(2), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 }));
    expect(r.playerRubyGrantIds ?? []).toHaveLength(n);
    for (const id of r.playerRubyGrantIds ?? []) expect(RUBY_TYPE_IDS).toContain(id);
    expect(r.playerRubyGrants ?? 0, 'no plain-Ruby mints').toBe(0);
  });
  it.each([[false, 1], [true, 2]] as const)('SHOP (golden=%s): a Rally replay gets %i random Ruby(ies)', (golden, n) => {
    const s = run({ board: [body('T', 'k_tunnelcharger', { golden })] });
    fireShopRally(s, s.board[0]!);
    expect(rubiesInHand(s)).toHaveLength(n);
    for (const c of rubiesInHand(s)) expect(RUBY_TYPE_IDS).toContain(c.cardId);
  });
});

describe('Cave Cutter: Choose One: give your Rubies +1/+1, or get 4 Rubies (2026-10-24)', () => {
  it.each([[false, { attack: 1, health: 1 }], [true, { attack: 2, health: 2 }]] as const)('golden=%s: the strength branch is %o', (golden, gain) => {
    let s = act(run({ hand: [body('c', 'k_veinbreaker', { golden })] }), { type: 'play', uid: 'c' });
    s = act(s, { type: 'chooseOne', index: 0 });
    expect(s.rubyBonus).toEqual(gain);
  });
  it.each([[false, 4], [true, 8]] as const)('golden=%s: the Ruby branch is still %i plain Rubies', (golden, n) => {
    let s = act(run({ hand: [body('c', 'k_veinbreaker', { golden })] }), { type: 'play', uid: 'c' });
    s = act(s, { type: 'chooseOne', index: 1 });
    expect(rubiesInHand(s).map((c) => c.cardId)).toEqual(Array(n).fill('ruby'));
  });
  it('text and body', () => {
    const d = CARD_INDEX['k_veinbreaker']!;
    expect(stats('k_veinbreaker')).toEqual(['kobold', 4, 5, 3, []]);
    expect(d.text).toBe('**Choose One:** give your Rubies **+1/+1**, or get **4 Rubies**.');
    expect(d.goldenText).toBe('**Choose One:** give your Rubies **+2/+2**, or get **8 Rubies**.');
  });
});

describe('Scrapper: T2 3/1, Echo: your Rubies gain +1 Attack (2026-10-24)', () => {
  it('is a buyable T2 3/1 Kobold in Set 2 with the new text', () => {
    expect(stats('k_faultline')).toEqual(['kobold', 2, 3, 1, []]);
    expect(set2Pool.has('k_faultline')).toBe(true);
    expect(CARD_INDEX['k_faultline']!.text).toBe('**Echo:** Your Rubies gain **+1 Attack**.');
    expect(CARD_INDEX['k_faultline']!.goldenText).toBe('**Echo:** Your Rubies gain **+2 Attack**.');
  });
  it.each([[false, 1], [true, 2]] as const)('SHOP (golden=%s): a Shop Echo raises Ruby Attack by %i, Health untouched', (golden, a) => {
    const s = run({ board: [body('sc', 'k_faultline', { golden })] });
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(s.rubyBonus ?? { attack: 0, health: 0 }).toEqual({ attack: a, health: 0 });
  });
  it.each([[false, 1], [true, 2]] as const)('COMBAT (golden=%s): dying carries +%i Ruby Attack back', (golden, a) => {
    const r = fight([bm('k_faultline', 3, 1, { golden, sourceUid: 'S' })], [bm('sandbag', 5, 50)]);
    expect(r.playerRubyBonusGain).toEqual({ attack: a, health: 0 });
  });
});

describe('Gem Carver: T4 (2026-10-24), nothing else moves', () => {
  it('is a buyable T4 5/3 Kobold with the same Echo', () => {
    expect(stats('k_gemheart')).toEqual(['kobold', 4, 5, 3, []]);
    expect(CARD_INDEX['k_gemheart']!.effects).toEqual([{ on: 'onDeath', do: 'deathrattleSummonRubyStats', params: { tokenId: 'gemheart-shard', golems: 2 } }]);
    expect(CARD_INDEX['k_gemheart']!.text).toBe("**Echo:** Summon **2 Gemheart Golems** with this minion's Rubies.");
  });
});

describe('Beev: when a Beast attacks, give it and this +2/+1 (2026-10-24, was +2/+2)', () => {
  it('body and text', () => {
    expect(stats('b2_beev')).toEqual(['beast', 3, 4, 4, []]);
    expect(CARD_INDEX['b2_beev']!.text).toBe('When a **Beast** attacks, give it and this **+2/+1**.');
    expect(CARD_INDEX['b2_beev']!.goldenText).toBe('When a **Beast** attacks, give it and this **+4/+2**.');
  });
  it.each([[false, 2, 1], [true, 4, 2]] as const)('COMBAT (golden=%s): a friendly Beast attacking gives it and Beev +%i/+%i', (golden, a, h) => {
    const r = fight([bm('alley', 1, 900), bm('b2_beev', 0, 900, { golden })], [bm('sandbag', 0, 90000)]);
    const beev = uidOf(r, 'b2_beev');
    const alley = uidOf(r, 'alley');
    const fromBeev = buffs(r).filter((b) => b.source === beev);
    expect(fromBeev.some((b) => b.target === alley && b.attack === a && b.health === h)).toBe(true);
    expect(fromBeev.some((b) => b.target === beev && b.attack === a && b.health === h)).toBe(true);
    expect(fromBeev.every((b) => b.attack === a && b.health === h)).toBe(true);
  });
  it('SHOP: a Beast Rally replay pays Beev +2/+1', () => {
    const s = run({ board: [body('p', 'b2_packstrider'), body('b', 'b2_beev')] });
    fireShopRally(s, s.board[0]!);
    const b = s.board.find((c) => c.uid === 'b')!;
    expect([b.attack, b.health]).toEqual([4 + 2, 4 + 1]);
  });
});

describe('Big Huggies: Taunt. Echo: get 2 Staves of Guel (2026-10-24, was 2 Picnics)', () => {
  it('body and text', () => {
    expect(stats('dm_velvet')).toEqual(['demon', 4, 5, 2, ['T']]);
    expect(CARD_INDEX['dm_velvet']!.text).toBe('**Taunt.** **Echo:** get **2 Staves of Guel**.');
    expect(CARD_INDEX['dm_velvet']!.goldenText).toBe('**Taunt.** **Echo:** get **4 Staves of Guel**.');
  });
  it.each([[false, 2], [true, 4]] as const)('SHOP (golden=%s): an Echo hands over %i Staves of Guel', (golden, n) => {
    const s = run({ board: [body('v', 'dm_velvet', { golden })] });
    fireRecruitDeathrattlesForTest(s, s.board[0]!);
    expect(s.hand.filter((c) => c.cardId === 'staffofguel')).toHaveLength(n);
    expect(s.hand.some((c) => c.cardId === 'sp_picnic')).toBe(false);
  });
  it.each([[false, 2], [true, 4]] as const)('COMBAT (golden=%s): dying grants %i Staves of Guel to the hand', (golden, n) => {
    const r = fight([bm('dm_velvet', 5, 2, { golden, sourceUid: 'V' })], [bm('sandbag', 5, 50)]);
    expect((r.playerHandGrants ?? []).filter((id) => id === 'staffofguel')).toHaveLength(n);
  });
});

describe('Big Brain Billy: +2/+2 per Shop spell (2026-10-24, was +1/+1)', () => {
  it('body and text', () => {
    expect(stats('dw_bigbrainbilly')).toEqual(['dwarf', 2, 2, 2, []]);
    expect(CARD_INDEX['dw_bigbrainbilly']!.text).toBe('When you cast a Shop spell, this gains **+2/+2**.');
    expect(CARD_INDEX['dw_bigbrainbilly']!.goldenText).toBe('When you cast a Shop spell, this gains **+4/+4**.');
  });
  it.each([[false, 2], [true, 4]] as const)('SHOP (golden=%s): one Shop spell gives +%i/+%i', (golden, step) => {
    const s = run({ board: [body('bb', 'dw_bigbrainbilly', { golden })], hand: [{ uid: 'p', cardId: 'emberpouch', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false }] });
    const after = act(s, { type: 'play', uid: 'p' }).board[0]!;
    expect([after.attack, after.health]).toEqual([2 + step, 2 + step]);
  });
});
