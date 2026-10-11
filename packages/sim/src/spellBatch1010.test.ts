import { describe, it, expect } from 'vitest';
import { ARCHIVED_CARDS, CARD_INDEX, poolFor, type SetId } from '@game/content';
import { createRun, poolOf, reduce, type BoardCard, type RunState } from './index';
import { setStatsValue, spellDisplayText, strangeRevisionTier } from './recruit';

/**
 * OWNER SPELL BATCH 2026-10-10. Every change is proved through the real play path (`reduce` → `play`), and every
 * live-text change through `spellDisplayText`, the helper both text chains render.
 */
const ALL_SETS: SetId[] = ['set1', 'set2', 'set3'];
const spell = (uid: string, cardId: string): BoardCard =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });
const body = (cardId: string, uid: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const recruit = (extra: Partial<RunState> = {}): RunState =>
  ({ ...createRun(11), phase: 'recruit', embers: 40, tier: 4, ...extra } as RunState);
const play = (s: RunState, uid: string, targetUid?: string): RunState =>
  reduce(reduce(s, { type: 'play', uid, targetUid }), { type: 'resolveShopDeath' }) as RunState;
const strip = (t: string): string => t.replace(/\{\{|\}\}/g, '');

describe('archives: Ruby Excavation and Turnabout leave every set, still resolve by id', () => {
  it('archived, in no set pool, still in CARD_INDEX', () => {
    for (const id of ['rubyexcavation', 'turnabout']) {
      expect(ARCHIVED_CARDS.some((c) => c.id === id), `${id} archived`).toBe(true);
      expect(CARD_INDEX[id], `${id} still resolves`).toBeDefined();
      for (const set of ALL_SETS) expect(poolFor(set).all.some((c) => c.id === id), `${id} not in ${set}`).toBe(false);
    }
  });

  it('set 3 builds without Turnabout in its shared spell list', () => {
    const ids = poolFor('set3').spells.map((c) => c.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toContain('turnabout');
  });
});

describe('costs, tiers and numbers', () => {
  it.each([
    ['invitationabove', 3], ['sp_dragonflame', 2], ['sp_gamble', 1], ['quickstudy', 2], ['sp_blessing', 1],
    ['spiritfire', 3], ['aresmar', 4], ['strangerevision', 1],
  ])('%s costs %i Gold', (id, cost) => {
    expect(CARD_INDEX[id]!.cost).toBe(cost);
  });

  it('spells are never gilded: none of the batch carries goldenText', () => {
    for (const id of ['invitationabove', 'sp_dragonflame', 'sp_gamble', 'quickstudy', 'sp_blessing', 'spiritfire', 'growth',
      'staffofguel', 'sparkplug', 'perfectvision', 'aresmar', 'strangerevision']) {
      expect(CARD_INDEX[id]!.goldenText, id).toBeUndefined();
    }
  });

  it('Spirit Fire gives +6/+6', () => {
    const s = play(recruit({ board: [body('sandbag', 'm')], hand: [spell('sp', 'spiritfire')] }), 'sp', 'm');
    const m = s.board[0]!;
    expect([m.attack, m.health]).toEqual([CARD_INDEX.sandbag!.attack + 6, CARD_INDEX.sandbag!.health + 6]);
    expect(CARD_INDEX.spiritfire!.text).toBe('Give a minion **+6/+6**.');
  });

  it('Growth gives your minions +2/+2', () => {
    const s = play(recruit({ board: [body('sandbag', 'a'), body('sandbag', 'b')], hand: [spell('sp', 'growth')] }), 'sp');
    for (const m of s.board) expect([m.attack, m.health]).toEqual([CARD_INDEX.sandbag!.attack + 2, CARD_INDEX.sandbag!.health + 2]);
    expect(CARD_INDEX.growth!.text).toBe('Give your minions **+2/+2**.');
  });

  it('Growth live text folds Rune of Living Growth onto the NEW +2/+2 base', () => {
    expect(spellDisplayText('growth', 0, 0, 0, 0, 0, 0, { growthBonus: 3 })).toBe('Give your minions **{{+5/+5}}**.');
  });

  it('TRIPWIRE: Taragosa\'s "cast Growth" carries exactly the Growth spell\'s numbers', () => {
    const growth = CARD_INDEX.growth!.effects.find((e) => e.do === 'spellBuffAll')!.params!;
    const tara = CARD_INDEX.taragosa!.effects.find((e) => e.do === 'onAllyAttackCastGrowth')!.params!;
    expect([tara.attack, tara.health]).toEqual([growth.attack, growth.health]);
  });

  it('Staff of Guel gives Shop minions +3/+3 permanently', () => {
    const s = play(recruit({ hand: [spell('sp', 'staffofguel')] }), 'sp');
    const b0 = recruit().tavernBuyBonus;
    expect([s.tavernBuyBonus.atk - b0.atk, s.tavernBuyBonus.hp - b0.hp]).toEqual([3, 3]);
    expect(CARD_INDEX.staffofguel!.text).toBe('Give minions in the shop **+3/+3** permanently.');
  });

  it('Waking Rift: the new wording, and still two separate +5/+5 applications (repeat, not lump)', () => {
    const def = CARD_INDEX.sparkplug!;
    expect(def.text).toBe('Give your minions **+5/+5** twice.');
    const casts = def.effects.filter((e) => e.on === 'cast' && e.do === 'spellBuffAll');
    expect(casts.map((e) => [e.params?.attack, e.params?.health])).toEqual([[5, 5], [5, 5]]);
    const s = play(recruit({ board: [body('sandbag', 'a')], hand: [spell('sp', 'sparkplug')] }), 'sp');
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([CARD_INDEX.sandbag!.attack + 10, CARD_INDEX.sandbag!.health + 10]);
  });
});

describe('Perfect Vision: "Set a minion\'s stats to 20/20. Set it to 50/50 if you\'re Shop Tier 6."', () => {
  it('is a Tier 5 targeted spell', () => {
    const d = CARD_INDEX.perfectvision!;
    expect([d.tier, d.target]).toEqual([5, 'any']);
    expect(d.text).toBe("Set a minion's stats to **20/20**. Set it to **50/50** if you're **Shop Tier 6**.");
  });

  it('sets 20/20 below Shop Tier 6', () => {
    const s = play(recruit({ tier: 5, board: [body('sandbag', 'm')], hand: [spell('sp', 'perfectvision')] }), 'sp', 'm');
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([20, 20]);
  });

  it('sets 50/50 at Shop Tier 6', () => {
    const s = play(recruit({ tier: 6, board: [body('sandbag', 'm')], hand: [spell('sp', 'perfectvision')] }), 'sp', 'm');
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([50, 50]);
  });

  it('the helper reads the CURRENT Shop Tier', () => {
    const p = CARD_INDEX.perfectvision!.effects[0]!.params;
    expect(setStatsValue(p, 5)).toMatchObject({ attack: 20, health: 20, stepped: false });
    expect(setStatsValue(p, 6)).toMatchObject({ attack: 50, health: 50, stepped: true });
    expect(setStatsValue(p, 7)).toMatchObject({ attack: 50, health: 50, stepped: true });
  });

  it('live text greens the value that applies right now', () => {
    const at5 = spellDisplayText('perfectvision', 0, 0, 0, 0, 0, 0, { tier: 5 });
    expect(at5).toBe("Set a minion's stats to **{{20/20}}**. Set it to **50/50** if you're **Shop Tier 6**.");
    const at6 = spellDisplayText('perfectvision', 0, 0, 0, 0, 0, 0, { tier: 6 });
    expect(at6).toBe("Set a minion's stats to **20/20**. Set it to **{{50/50}}** if you're **Shop Tier 6**.");
    // Spell power never changes a SET.
    expect(strip(spellDisplayText('perfectvision', 4, 0, 4, 0, 0, 0, { tier: 6 }))).toBe(CARD_INDEX.perfectvision!.text);
  });
});

describe('Strange Revision: "Transform a minion into a random minion of the tier above it. It keeps its stats."', () => {
  it('the card: cost 1, targeted, new text', () => {
    const d = CARD_INDEX.strangerevision!;
    expect([d.cost, d.target, d.singleCast]).toEqual([1, 'any', true]);
    expect(d.text).toBe('Transform a minion into a random minion of the **tier above it**. It keeps its stats.');
  });

  it('the tier above, and Tier 7 stays at Tier 7', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(strangeRevisionTier)).toEqual([2, 3, 4, 5, 6, 7, 7]);
  });

  it('a board minion becomes a random minion of tier + 1 from the run pool, keeping its CURRENT stats', () => {
    const m = body('sandbag', 'm1', { attack: 9, health: 13, buffs: [{ source: 'X', attack: 9, health: 9, count: 1 }] });
    const before = recruit({ board: [m], hand: [spell('sp', 'strangerevision')] });
    const s = play(before, 'sp', 'm1');
    const t = s.board.find((c) => c.uid === 'm1')!;
    const nd = CARD_INDEX[t.cardId]!;
    expect(nd.tier).toBe(CARD_INDEX.sandbag!.tier + 1);
    expect(poolOf(s).buyable.some((c) => c.id === t.cardId), 'drawn from the run pool').toBe(true);
    expect([t.attack, t.health]).toEqual([9, 13]);
    expect(t.tribe).toBe(nd.tribe);
    expect(t.buffs, 'the enchantment ledger rides along').toEqual([{ source: 'X', attack: 9, health: 9, count: 1 }]);
  });

  it('is seeded: the same run picks the same form', () => {
    const mk = (): RunState => recruit({ board: [body('sandbag', 'm1')], hand: [spell('sp', 'strangerevision')] });
    expect(play(mk(), 'sp', 'm1').board[0]!.cardId).toBe(play(mk(), 'sp', 'm1').board[0]!.cardId);
  });

  it('golden status is kept; printed keywords swap, gained keywords ride along', () => {
    const tauntDef = poolOf(recruit()).buyable.find((c) => c.tier <= 5 && c.keywords.includes('T'))!;
    const m = body(tauntDef.id, 'g', { golden: true, keywords: [...tauntDef.keywords, 'DS'] });
    const s = play(recruit({ board: [m], hand: [spell('sp', 'strangerevision')] }), 'sp', 'g');
    const t = s.board[0]!;
    const nd = CARD_INDEX[t.cardId]!;
    expect(t.golden).toBe(true);
    expect(t.keywords).toContain('DS'); // gained
    for (const k of nd.keywords) expect(t.keywords).toContain(k); // the new form's printed keywords
    if (!nd.keywords.includes('T')) expect(t.keywords, 'the old printed Taunt does not ride along').not.toContain('T');
  });

  it('a Tier 7 target re-rolls into another Tier 7', () => {
    const s0 = recruit({ tier: 6 });
    const t7 = poolOf(s0).buyable.find((c) => c.tier === 7 && s0.tribes.every(() => true))!;
    expect(t7, 'the run pool has a Tier 7').toBeDefined();
    const s = play(recruit({ tier: 6, board: [body(t7.id, 'm')], hand: [spell('sp', 'strangerevision')] }), 'sp', 'm');
    const t = s.board[0]!;
    expect(CARD_INDEX[t.cardId]!.tier).toBe(7);
    expect(t.cardId).not.toBe(t7.id);
    expect([t.attack, t.health]).toEqual([t7.attack, t7.health]);
  });

  it('a SHOP minion transforms tier-up and keeps its printed total (the +2/+2 buff included)', () => {
    let s = recruit({ tier: 3, board: [], hand: [spell('sr', 'strangerevision')], shop: [{ uid: 'o1', cardId: 'pack', atk: 2, hp: 2 }] });
    const oldDef = CARD_INDEX.pack!;
    s = reduce(s, { type: 'play', uid: 'sr', targetUid: 'o1' }) as RunState;
    const o = s.shop[0]!;
    const nd = CARD_INDEX[o.cardId]!;
    expect(nd.tier).toBe(oldDef.tier + 1);
    expect([nd.attack + (o.atk ?? 0), nd.health + (o.hp ?? 0)]).toEqual([oldDef.attack + 2, oldDef.health + 2]);
  });
});
