/**
 * SET 2 EPIC RUNES, owner design 2026-11-23 (R-SET2-EPIC-1123-01..06):
 *
 *   Deep Bond         Dwarf / Kobold  4  Get a Mountainbond. Your Mountainbonds only need 5 Gold spent to trigger.
 *   Golden Bell       no tribe        3  Get a Gilded Bellringer Voss. It does not give a Triple Reward when played.
 *   Uninvited Guests  Kobold / Beast  4  Get a Party Crasher. Party Crashers also cast their Rubies on your Beasts.
 *   Gilded Wings      Dragon          3  Get a Gilded Transcendant. It does not give a Triple Reward when played.
 *   Double Tap        no tribe        4  The first 3 targeted spells you cast each turn cast twice.
 *   Spellmaiden       no tribe        3  Get a Spellmaiden.
 *
 * Every block drives the real engine: the Runeforge `buyRune`, the reducer's `play` / `sell`, `applyGoldSpent`, and
 * `simulate()` with the mods a run really sends to combat (`buildCombatBoards`' `questMods`).
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { applyGoldSpent, doubleTapLeft, giftCastCount, goldSpentEvery, rubyCastCount, runeExtraCasts, spellCasts } from './recruit';
import { runeLiveStateOfRun } from './runeLiveState';
import { snapshotBoard } from './snapshot';
import { sideFromSnapshot } from './boardSide';
import { liveBoardView } from '../../ui/src/instView';
import { liveRuneText } from '../../ui/src/runeText';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
function base(extra: Partial<RunState> = {}, seed = 3): RunState {
  return {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier: 6, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
    ...extra,
  } as RunState;
}
const buy = (s: RunState, id: string): RunState => act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 });
const withRune = (ids: string[], extra: Partial<RunState> = {}): RunState => ({ ...ids.reduce(buy, base()), ...extra });
const inHandOrBoard = (s: RunState, cardId: string): BoardCard[] => [...s.hand, ...s.board].filter((c) => c.cardId === cardId);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
/** Triple Rewards in hand (the card `grantGoldenDiscover` hands over). */
const tripleRewards = (s: RunState): number => s.hand.filter((c) => c.cardId === 'discoverspell').length;
const NONE = { attack: 0, health: 0 };
const rubyOn = (c: BoardCard) => (c.buffs ?? []).filter((b) => b.source === 'Ruby').reduce((t, b) => ({ attack: t.attack + b.attack, health: t.health + b.health }), NONE);
const boardText = (s: RunState, c: BoardCard): string => { const v = liveBoardView(c, s); return (c.golden ? v.goldenText : undefined) ?? v.text ?? ''; };

describe('the six runes as content', () => {
  it('names, costs, the Epic pool, the tribe gate, Set 2 only, the texts', () => {
    const rows: [string, string, number, readonly string[] | undefined, string][] = [
      ['rune_deep_bond', 'Deep Bond', 4, ['dwarf', 'kobold'], 'Get a **Mountainbond**. Your **Mountainbonds** only need **5 Gold** spent to trigger.'],
      ['rune_golden_bell', 'Golden Bell', 3, undefined, 'Get a **Gilded Bellringer Voss**. It does not give a **Triple Reward** when played.'],
      ['rune_uninvited_guests', 'Uninvited Guests', 4, ['kobold', 'beast'], 'Get a **Party Crasher**. **Party Crashers** also cast their **Rubies** on your **Beasts**.'],
      ['rune_gilded_wings', 'Gilded Wings', 3, ['dragon'], 'Get a **Gilded Transcendant**. It does not give a **Triple Reward** when played.'],
      ['rune_double_tap', 'Double Tap', 4, undefined, 'The first **3** targeted spells you cast each turn cast **twice**.'],
      ['rune_spellmaiden', 'Spellmaiden', 3, undefined, 'Get a **Spellmaiden**.'],
    ];
    for (const [id, name, cost, tribes, text] of rows) {
      const r = EPIC_RUNES.find((x) => x.id === id)!;
      expect([r.name, r.cost, r.epic, r.tribes, r.sets, r.text], id).toEqual([name, cost, true, tribes, ['set2'], text]);
      expect(RUNES.some((x) => x.id === id), id).toBe(false);
    }
  });
  it('none of the texts uses an em dash, "--", "Oath" or "climb"', () => {
    const texts = [...EPIC_RUNES.filter((r) => ['rune_deep_bond', 'rune_golden_bell', 'rune_uninvited_guests', 'rune_gilded_wings', 'rune_double_tap', 'rune_spellmaiden'].includes(r.id)).map((r) => r.text), CARD_INDEX['n2_spellmaiden']!.text, CARD_INDEX['n2_spellmaiden']!.goldenText!];
    for (const t of texts) expect(t).not.toMatch(/—|--|oath|climb/i);
  });
});

describe('DEEP BOND: "Get a Mountainbond. Your Mountainbonds only need 5 Gold spent to trigger."', () => {
  it('the buy hands over one plain Mountainbond, and a second copy of the rune a second one', () => {
    const s = withRune(['rune_deep_bond']);
    expect(inHandOrBoard(s, 'dw_mountainbond').map((c) => c.golden)).toEqual([false]);
    expect(inHandOrBoard(buy(s, 'rune_deep_bond'), 'dw_mountainbond')).toHaveLength(2);
  });
  it('a Mountainbond already on board pays at 5 Gold, 5 again at 10, and nothing at 4', () => {
    const run = (runes: string[], spent: number) => {
      const s = withRune(runes, { board: [body('m', 'dw_mountainbond'), body('k', 'k_beggy')] });
      applyGoldSpent(s, spent);
      return rubyOn(at(s, 'k'));
    };
    expect(run(['rune_deep_bond'], 4)).toEqual(NONE);
    expect(run(['rune_deep_bond'], 5)).toEqual({ attack: 1, health: 1 });
    expect(run(['rune_deep_bond'], 10)).toEqual({ attack: 2, health: 2 });
    // Without the rune: 8 Gold (this is the mutation check; the 5 above only lands through the rune).
    expect(run([], 5)).toEqual(NONE);
    expect(run([], 8)).toEqual({ attack: 1, health: 1 });
  });
  it('a Gilded Mountainbond pays twice as many Rubies at the same 5', () => {
    const s = withRune(['rune_deep_bond'], { board: [body('m', 'dw_mountainbond', { golden: true }), body('k', 'k_beggy')] });
    applyGoldSpent(s, 5);
    expect(rubyOn(at(s, 'k'))).toEqual({ attack: 2, health: 2 });
  });
  it('run-wide: a Mountainbond FOUND after the rune (and one bought before it) both count to 5', () => {
    const s = withRune(['rune_deep_bond'], { board: [body('old', 'dw_mountainbond'), body('new', 'dw_mountainbond'), body('k', 'k_beggy')] });
    applyGoldSpent(s, 5);
    expect(rubyOn(at(s, 'k'))).toEqual({ attack: 2, health: 2 }); // both fire, one Ruby each
  });
  it('each payout pulses the rune (its beat); no pulse short of one', () => {
    const s = withRune(['rune_deep_bond'], { board: [body('m', 'dw_mountainbond')], runeProcs: {} });
    applyGoldSpent(s, 4);
    expect(s.runeProcs?.['rune_deep_bond'] ?? 0).toBe(0);
    applyGoldSpent(s, 6);
    expect(s.runeProcs?.['rune_deep_bond']).toBe(2);
  });
  it('taking it with a Mountainbond at 7 of 8 (3, plus the 4 Gold the rune costs): 4 of 5, no free payout, the next Gold pays once', () => {
    const s = buy(base({ board: [body('m', 'dw_mountainbond', { goldTick: 3 }), body('k', 'k_beggy')], hand: [] }), 'rune_deep_bond');
    const before = rubyOn(at(s, 'k'));
    expect(at(s, 'm').goldTick).toBe(4);
    applyGoldSpent(s, 1);
    expect([rubyOn(at(s, 'k')).attack - before.attack, at(s, 'm').goldTick]).toEqual([1, 0]);
  });
  it('only the Mountainbond is changed: Billings still needs its printed Gold', () => {
    const bill = CARD_INDEX['dw_billings']!.effects.find((e) => e.on === 'goldSpent')!.params as { every: number };
    expect(goldSpentEvery('dw_billings', bill.every, true)).toBe(bill.every);
    expect(goldSpentEvery('dw_mountainbond', 8, true)).toBe(5);
    expect(goldSpentEvery('dw_mountainbond', 8, false)).toBe(8);
  });
  it('the card prints the live 5, plain and Gilded; without the rune it prints 8 (hand + combat chains: the UI test)', () => {
    const s = withRune(['rune_deep_bond'], { board: [body('m', 'dw_mountainbond', { goldTick: 3 }), body('g', 'dw_mountainbond', { golden: true })] });
    expect(boardText(s, at(s, 'm'))).toContain('Every {{5 Gold}} spent');
    expect(boardText(s, at(s, 'g'))).toContain('Every {{5 Gold}} spent');
    const none = withRune([], { board: [body('m', 'dw_mountainbond')] });
    expect(boardText(none, at(none, 'm'))).toContain('Every **8 Gold** spent');
  });
});

describe('GOLDEN BELL / GILDED WINGS: a Gilded copy that gives no Triple Reward when played', () => {
  it.each([['rune_golden_bell', 'n2_bellringer'], ['rune_gilded_wings', 'd2_transcendence']] as const)('%s hands over ONE Gilded %s at its doubled stats', (rune, card) => {
    const s = withRune([rune]);
    const got = inHandOrBoard(s, card);
    expect(got).toHaveLength(1);
    expect([got[0]!.golden, got[0]!.noTripleReward]).toEqual([true, true]);
    expect([got[0]!.attack, got[0]!.health]).toEqual([CARD_INDEX[card]!.attack * 2, CARD_INDEX[card]!.health * 2]);
    expect(CARD_INDEX[card]!.noTriple, 'the shared card is never marked').toBeUndefined();
  });
  it.each([['rune_golden_bell', 'n2_bellringer'], ['rune_gilded_wings', 'd2_transcendence']] as const)('%s: playing that copy gives no Triple Reward; a normal Gilded copy does', (rune, card) => {
    const s = withRune([rune]);
    const c = s.hand.find((x) => x.cardId === card)!;
    const played = act(s, { type: 'play', uid: c.uid });
    expect(at(played, c.uid).cardId, 'it entered play').toBe(card);
    expect(tripleRewards(played), 'no Triple Reward').toBe(0);
    // The same play with the mark removed (the mutation check): the Triple Reward is there.
    const normal = { ...s, hand: s.hand.map((x) => (x.uid === c.uid ? { ...x, noTripleReward: undefined } : x)) };
    expect(tripleRewards(act(normal, { type: 'play', uid: c.uid })), 'a normal Gilded play pays').toBe(1);
  });
  it('only the granted copy is marked: a Gilded copy made by the run still pays its Triple Reward', () => {
    const s = { ...withRune(['rune_golden_bell']), hand: [body('x', 'n2_bellringer', { golden: true, attack: 8, health: 8 })] };
    expect(tripleRewards(act(s, { type: 'play', uid: 'x' }))).toBe(1);
  });
  it('a second copy of the rune hands over a second marked Gilded body', () => {
    const s = buy(withRune(['rune_golden_bell']), 'rune_golden_bell');
    expect(inHandOrBoard(s, 'n2_bellringer').map((c) => [c.golden, c.noTripleReward])).toEqual([[true, true], [true, true]]);
  });
});

describe('UNINVITED GUESTS: "Party Crashers also cast their Rubies on your Beasts."', () => {
  const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
    ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra } as BoardMinion);
  const BEAST = Object.values(CARD_INDEX).find((c) => c.tribe === 'beast' && !c.tribe2 && !c.spell && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe)!.id;
  const BOTH = Object.values(CARD_INDEX).find((c) => ((c.tribe === 'kobold' && c.tribe2 === 'beast') || (c.tribe === 'beast' && c.tribe2 === 'kobold')) && !c.spell)?.id;
  // Two 1/1 pups die first (Avenge 2); the rest are walls that outlive the trigger.
  const own = (golden = false): BoardMinion[] => [
    bm('pup', 'p1', 1, 1), bm('pup', 'p2', 1, 1),
    bm('k_gemstorm', 'PC', 0, 4000, { golden }), bm(BEAST, 'B', 0, 4000), bm('sandbag', 'N', 0, 4000), ...(BOTH ? [bm(BOTH, 'KB', 0, 4000)] : []),
  ];
  type Perma = { sourceUid: string; attack: number; health: number; ruby?: boolean };
  const permaTotal = (ps: Perma[] | undefined, uid: string) => (ps ?? []).filter((p) => p.sourceUid === uid && p.ruby).reduce((n, p) => ({ attack: n.attack + p.attack, health: n.health + p.health }), NONE);
  const fight = (mods: Partial<QuestCombatMods>, golden = false, side: 'player' | 'enemy' = 'player') => {
    const ours = own(golden), wall = [bm('sandbag', 'W', 8, 4000)];
    const own2 = combatSide({ tier: 6, tribes: ['kobold', 'beast'], questMods: mods as QuestCombatMods });
    const foe = combatSide({ tier: 1 });
    return side === 'player'
      ? simulate(ours, wall, makeRng(11), CARD_INDEX, own2, foe)
      : simulate(wall, ours, makeRng(11), CARD_INDEX, foe, own2);
  };

  it('the buy hands over a Party Crasher', () => {
    expect(inHandOrBoard(withRune(['rune_uninvited_guests']), 'k_gemstorm')).toHaveLength(1);
  });
  it.each([[false, 3], [true, 6]] as const)('golden=%s: each Avenge puts %i permanent Rubies on every Kobold AND every Beast, none on others', (golden, per) => {
    const r = fight({ runeUninvitedGuests: true }, golden);
    const pc = permaTotal(r.playerPermaBuffs, 'PC');
    expect(pc.attack, 'the Avenge fired').toBeGreaterThan(0);
    const fires = pc.attack / per;
    expect(pc).toEqual({ attack: per * fires, health: per * fires });
    expect(permaTotal(r.playerPermaBuffs, 'B'), 'the Beast').toEqual({ attack: per * fires, health: per * fires });
    if (BOTH) expect(permaTotal(r.playerPermaBuffs, 'KB'), 'a Kobold Beast counted once').toEqual({ attack: per * fires, health: per * fires });
    expect(permaTotal(r.playerPermaBuffs, 'N'), 'not a neutral').toEqual(NONE);
  });
  it('without the rune the Beast gets nothing (the mutation check)', () => {
    const r = fight({});
    expect(permaTotal(r.playerPermaBuffs, 'PC').attack).toBeGreaterThan(0);
    expect(permaTotal(r.playerPermaBuffs, 'B')).toEqual(NONE);
    expect(r.events.some((e) => e.type === 'questTrigger' && e.flag === 'runeUninvitedGuests')).toBe(false);
  });
  it('the rune pulses (its beat) when a Beast is added, on its own side, and not with no Beast to add', () => {
    const pulses = (e: ReturnType<typeof fight>) => e.events.filter((x) => x.type === 'questTrigger' && x.flag === 'runeUninvitedGuests').map((x) => (x as { side: string }).side);
    expect(new Set(pulses(fight({ runeUninvitedGuests: true })))).toEqual(new Set(['player']));
    expect(new Set(pulses(fight({ runeUninvitedGuests: true }, false, 'enemy')))).toEqual(new Set(['enemy']));
    const noBeast = [bm('sandbag', 'p1', 1, 1), bm('sandbag', 'p2', 1, 1), bm('k_gemstorm', 'PC', 0, 4000)];
    const r = simulate(noBeast, [bm('sandbag', 'W', 8, 4000)], makeRng(11), CARD_INDEX, combatSide({ tier: 6, questMods: { runeUninvitedGuests: true } as QuestCombatMods }), combatSide({ tier: 1 }));
    expect(permaTotal(r.playerPermaBuffs, 'PC').attack).toBeGreaterThan(0);
    expect(pulses(r)).toEqual([]);
  });
  it('works for a served enemy side the same way (symmetric)', () => {
    const r = fight({ runeUninvitedGuests: true }, false, 'enemy');
    const bUid = r.initial.enemy.find((m) => m.cardId === BEAST)!.uid;
    const landed = r.events.filter((e) => e.type === 'buff' && e.ruby === true && e.target === bUid);
    expect(landed.length).toBeGreaterThan(0);
  });
  it('rides the run into combat and into the snapshot (so a served opponent carries it)', () => {
    const s = withRune(['rune_uninvited_guests'], { board: [body('pc', 'k_gemstorm')] });
    const snap = snapshotBoard(s);
    expect(snap.questMods?.runeUninvitedGuests).toBe(true);
    expect(sideFromSnapshot(snap, 6, []).questMods?.runeUninvitedGuests).toBe(true);
  });
  it('Party Crasher prints "Kobolds and Beasts" while the rune is held, plain and Gilded', () => {
    const s = withRune(['rune_uninvited_guests'], { board: [body('p', 'k_gemstorm'), body('g', 'k_gemstorm', { golden: true })], hand: [body('h', 'k_gemstorm')] });
    for (const t of [boardText(s, at(s, 'p')), boardText(s, at(s, 'g'))]) expect(t).toContain('on your {{Kobolds and Beasts}}');
    const none = withRune([], { board: [body('p', 'k_gemstorm')] });
    expect(boardText(none, at(none, 'p'))).toContain('on your **Kobolds**');
  });
});

describe('DOUBLE TAP: "The first 3 targeted spells you cast each turn cast twice."', () => {
  const FIRE = 'spiritfire'; // "Give a minion +6/+6." (targeted)
  const fire = (uid: string): BoardCard => body(uid, FIRE);
  const T = 'sandbag';
  const aim = (s: RunState, uid: string, target = 'a'): RunState => act(s, { type: 'play', uid, targetUid: target });
  const text = (s: RunState): string => liveRuneText('rune_double_tap', RUNE_INDEX['rune_double_tap']!.text, runeLiveStateOfRun(s));
  const run = (extra: Partial<RunState> = {}, ids: string[] = ['rune_double_tap']): RunState => withRune(ids, { board: [body('a', T)], ...extra });

  it('the first 3 targeted casts cast twice, the 4th once; the rune text counts down; a new turn is fresh', () => {
    let s = run({ hand: ['f1', 'f2', 'f3', 'f4'].map(fire) });
    const a0 = at(s, 'a').attack;
    expect(text(s)).toContain('(3 left this turn.)');
    expect(spellCasts(s, CARD_INDEX[FIRE]!), 'the hand badge previews x2').toBe(2);
    s = aim(s, 'f1');
    expect(at(s, 'a').attack).toBe(a0 + 12);
    expect(text(s)).toContain('(2 left this turn.)');
    s = aim(aim(s, 'f2'), 'f3');
    expect(at(s, 'a').attack).toBe(a0 + 36);
    expect(text(s)).toContain('(0 left this turn.)');
    expect(spellCasts(s, CARD_INDEX[FIRE]!)).toBe(1);
    s = aim(s, 'f4');
    expect(at(s, 'a').attack, 'the 4th casts once').toBe(a0 + 42);
    const next = { ...s, wave: s.wave + 1 } as RunState;
    expect(spellCasts(next, CARD_INDEX[FIRE]!), 'a new turn: the 3 are back').toBe(2);
    expect(text(next)).toContain('(3 left this turn.)');
  });
  it('without the rune a targeted spell casts once (the mutation check)', () => {
    let s = run({ hand: [fire('f1')] }, []);
    const a0 = at(s, 'a').attack;
    s = aim(s, 'f1');
    expect(at(s, 'a').attack).toBe(a0 + 6);
    expect(doubleTapLeft(s)).toBeUndefined();
  });
  it('an untargeted spell casts once and spends nothing', () => {
    let s = run({ hand: [body('p1', 'emberpouch')] });
    const gold = s.embers;
    s = act(s, { type: 'play', uid: 'p1' });
    expect(s.embers).toBe(gold + 1);
    expect(doubleTapLeft(s)).toBe(3);
  });
  it('a Ruby and an aimed Tower Shield are targeted spells too (Yazzus\' set): they double and spend', () => {
    const s0 = run({ hand: [body('r1', 'ruby', { attack: 1, health: 1 }), body('t1', 'tower_shield')] });
    expect(rubyCastCount(s0)).toBe(2);
    expect(giftCastCount(s0, CARD_INDEX['tower_shield']!, true)).toBe(2);
    const a0 = at(s0, 'a').attack;
    const s1 = aim(s0, 'r1');
    expect(at(s1, 'a').attack, 'the Ruby landed twice').toBe(a0 + 2);
    expect(doubleTapLeft(s1)).toBe(2);
    const s2 = aim(s1, 't1');
    expect(doubleTapLeft(s2)).toBe(1);
  });
  it('multiplies Yazzus (the repo\'s x2 shape): 2 casts become 4', () => {
    const s = run({ hand: [fire('f1')], board: [body('a', T), body('y', 'yazzus')] });
    expect(spellCasts(s, CARD_INDEX[FIRE]!)).toBe(4);
  });
  it('two copies cast three times, sharing the same 3 per turn', () => {
    const s = buy(run({ hand: [fire('f1')] }), 'rune_double_tap');
    expect(spellCasts(s, CARD_INDEX[FIRE]!)).toBe(3);
    expect(doubleTapLeft(aim({ ...s, hand: [fire('f1')] }, 'f1'))).toBe(2);
  });
  it('the extra cast is the RUNE\'s cast (its rail visual), and the rune pulses for each doubled cast only', () => {
    const s = run({ hand: [fire('f1'), fire('f2'), fire('f3'), fire('f4')] });
    expect(runeExtraCasts(s, CARD_INDEX[FIRE]!)).toEqual([{ runeId: 'rune_double_tap', count: 1 }]);
    const done = ['f1', 'f2', 'f3', 'f4'].reduce((x, u) => aim(x, u), s);
    expect(done.runeProcs?.['rune_double_tap']).toBe(3);
  });
  it('picked after a targeted spell was cast that turn: it is one of the first 3 (the look-back)', () => {
    let s = run({ hand: [fire('f0')] }, []);
    s = aim(s, 'f0');
    s = buy(s, 'rune_double_tap');
    expect(doubleTapLeft(s)).toBe(2);
  });
  it('combat: no cast multiplier in a fight (the from-hand gate): the run sends no Double Tap combat mod', () => {
    const s = run({ board: [body('a', T)] });
    expect(Object.keys(snapshotBoard(s).questMods ?? {})).not.toContain('runeDoubleTap');
  });
});

describe('SPELLMAIDEN: "When sold, double your Shop spell power."', () => {
  const power = (attack: number, health: number) => ({ spellBonus: { attack, health } } as Partial<RunState>);
  const sold = (over: Partial<RunState>, golden = false): RunState =>
    act({ ...base(over), board: [body('m', 'n2_spellmaiden', { golden })] } as RunState, { type: 'sell', uid: 'm' });

  it('the rune hands over one; it is a Tier 4 3/3 neutral token, never in the Shop, in the Set 2 pool for resolution', () => {
    const s = withRune(['rune_spellmaiden']);
    expect(inHandOrBoard(s, 'n2_spellmaiden')).toHaveLength(1);
    const d = CARD_INDEX['n2_spellmaiden']!;
    expect([d.tribe, d.tier, d.attack, d.health, d.token]).toEqual(['neutral', 4, 3, 3, true]);
    expect(poolFor('set2').buyable.some((c) => c.id === 'n2_spellmaiden')).toBe(false);
  });
  it('selling it doubles the run\'s Shop spell power; Gilded triples it; nothing banked stays nothing', () => {
    expect(sold(power(3, 2)).spellBonus).toEqual({ attack: 6, health: 4 });
    expect(sold(power(3, 2), true).spellBonus).toEqual({ attack: 9, health: 6 });
    expect(sold(power(0, 0)).spellBonus).toEqual({ attack: 0, health: 0 });
    // The mutation check: another sale does not double.
    expect(act({ ...base(power(3, 2)), board: [body('z', 'sandbag')] } as RunState, { type: 'sell', uid: 'z' }).spellBonus).toEqual({ attack: 3, health: 2 });
  });
  it('the card prints what its sale gives right now, plain and Gilded', () => {
    const s = { ...base(power(3, 2)), board: [body('h', 'n2_spellmaiden'), body('b', 'n2_spellmaiden', { golden: true })] } as RunState;
    expect(boardText(s, s.board[0]!)).toContain('{{(Gain +3/+2 now.)}}');
    expect(boardText(s, s.board[1]!)).toContain('{{(Gain +6/+4 now.)}}');
    const zero = { ...base(power(0, 0)), board: [body('h', 'n2_spellmaiden')] } as RunState;
    expect(boardText(zero, zero.board[0]!)).toBe('When sold, **double** your **Shop spell power**.');
  });
  it('the Spell Power flourish is stamped on the sale (the beat)', () => {
    const s = sold(power(3, 2));
    expect([s.spellPowerFxAtk, s.spellPowerFxHp]).toEqual([3, 2]);
    expect(s.spellPowerFxSeq ?? 0).toBeGreaterThan(0);
  });
});
