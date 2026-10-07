import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';
import { runeTally } from '../../ui/src/runeTally';

/**
 * OWNER BATCH 2026-10-07: the Beast runes. Rune of Actioned Beasts (Basic: every 5th Beast played gets a random
 * Beast) and Rune of the Gator's Bite (Epic: every Beast played gives your board Beasts +6/+6). Both ride the
 * `runeThreshold` engine on the new `playBeast` meter, ticked only at the `playCard` chokepoint. Every block drives
 * the real reducer (`buyRune`, then `play`), so "the forge sells it" and "the play pays it" are one test.
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
/** Buy a rune through the REAL Runeforge path, in a Set 2 Beast run. Epic runes open the Epic forge. */
function withRune(id: string, extra: Partial<RunState> = {}, seed = 3): RunState {
  const def = RUNE_INDEX[id]!;
  const s = {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
    runeforgeOffer: [id], runeforgeEpic: !!def.epic, ...extra,
  } as RunState;
  const out = act(s, { type: 'buyRune', index: 0 });
  expect(out.runeThresholds?.some((t) => t.sourceId === id), `${id} was bought`).toBe(true);
  return out;
}
/** Buy a flag rune (no threshold meter) through the real Runeforge path. */
function withRuneFlag(id: string): RunState {
  const s = {
    ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: ['kobold', 'dragon', 'beast', 'demon', 'dwarf'], wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [],
    runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic,
  } as RunState;
  return act(s, { type: 'buyRune', index: 0 });
}
/** Put a card in hand and play it from hand (the real `play` action). */
const play = (s: RunState, card: BoardCard): RunState => act({ ...s, hand: [...s.hand, card] }, { type: 'play', uid: card.uid });
/** Plain Set 2 Beasts with no Shop-phase triggers. Distinct ids so no three ever triple. */
const PLAIN_BEASTS = ['b2_packstrider', 'b2_trex', 'b2_echohorn', 'b2_raven', 'b2_tort', 'b2_solaris', 'b2_wolvie', 'b2_bullseye'];
/** Play the i-th plain Beast onto an emptied board (the meter tests only care about the play, not the board). */
const playBeast = (s: RunState, i: number): RunState => play({ ...s, board: [] }, bc(`b${i}`, PLAIN_BEASTS[i % PLAIN_BEASTS.length]!));
const tick = (s: RunState, id: string): number => s.runeThresholds!.find((t) => t.sourceId === id)!.tick;
const GATOR = "Rune of the Gator's Bite";
const gatorFrom = (c: BoardCard | undefined): number[] =>
  (c?.buffs ?? []).filter((b) => b.source === GATOR).reduce((t, b) => [t[0]! + b.attack, t[1]! + b.health], [0, 0]);
const isBeastDef = (id: string): boolean => { const d = CARD_INDEX[id]!; return d.tribe === 'beast' || d.tribe2 === 'beast'; };

describe('the 2026-10-07 Beast roster', () => {
  it("Rune of the Sunpony: buying it arms the combat flag, which reaches the fight (the combat half: core's sunponyRune.test.ts)", () => {
    const s = withRuneFlag('rune_sunpony');
    expect(s.embers).toBe(37);
    expect(s.questFlags?.runeSunpony).toBe(true);
    expect(questCombatMods(s).runeSunpony).toBe(true);
    expect(RUNE_INDEX['rune_sunpony']!.reward).toEqual({ kind: 'combatFlag', flag: 'runeSunpony' });
  });
  it('Basic vs Epic by array membership, 3 Gold each, Set 2 only, Beast-gated, no em dash', () => {
    const want: [string, boolean][] = [['rune_actioned_beasts', false], ['rune_gators_bite', true], ['rune_sunpony', false]];
    for (const [id, epic] of want) {
      const r = RUNE_INDEX[id]!;
      expect((epic ? EPIC_RUNES : RUNES).some((x) => x.id === id), `${id} lives in the right forge`).toBe(true);
      expect((epic ? RUNES : EPIC_RUNES).some((x) => x.id === id), `${id} is not in the other forge`).toBe(false);
      expect([r.cost, !!r.epic, r.tribes, r.sets], id).toEqual([3, epic, ['beast'], ['set2']]);
      expect(r.text, `${id}: no em dash in player text`).not.toMatch(/—|--/);
    }
  });
  it('buying each rune arms its own playBeast meter and spends 3 Gold', () => {
    for (const id of ['rune_actioned_beasts', 'rune_gators_bite']) {
      const s = withRune(id);
      expect(s.embers, `${id} cost`).toBe(37);
      const t = s.runeThresholds!.find((x) => x.sourceId === id)!;
      expect([t.meter, t.tick], id).toEqual(['playBeast', 0]);
    }
  });
});

describe('Rune of Actioned Beasts: every 5th Beast played gets a random Beast', () => {
  it('pays exactly on the 5th Beast play, banks the remainder, and the badge counts x/5', () => {
    let s = withRune('rune_actioned_beasts');
    expect(runeTally(s, 'rune_actioned_beasts')).toBe('0/5');
    for (let i = 1; i <= 4; i++) {
      s = playBeast(s, i);
      expect(runeTally(s, 'rune_actioned_beasts'), `after ${i} Beasts`).toBe(`${i}/5`);
      expect(s.hand, 'no payout before the 5th').toHaveLength(0);
    }
    s = playBeast(s, 5);
    expect(s.hand, 'the 5th Beast pays one card').toHaveLength(1);
    expect(isBeastDef(s.hand[0]!.cardId), `${s.hand[0]!.cardId} is a Beast`).toBe(true);
    expect(runeTally(s, 'rune_actioned_beasts'), 'the countdown resets').toBe('0/5');
    s = playBeast(s, 6);
    expect(runeTally(s, 'rune_actioned_beasts')).toBe('1/5');
  });
  it('only a Beast PLAYED counts: an off-tribe play and a Shout-summoned Beast token do not tick it', () => {
    let s = withRune('rune_actioned_beasts');
    s = play(s, bc('k', 'k_chipwick'));
    expect(tick(s, 'rune_actioned_beasts'), 'a Kobold play banks nothing').toBe(0);
    s = play(s, bc('p', 'alley')); // Pennycat (a Beast) summons a Stray (a Beast) with its Shout
    expect(s.board.some((c) => c.cardId === 'stray'), 'the Stray was summoned').toBe(true);
    expect(tick(s, 'rune_actioned_beasts'), 'one play, one tick: the summoned Stray is not a play').toBe(1);
  });
  it('a Gilded Beast played counts as one play', () => {
    let s = withRune('rune_actioned_beasts');
    s = play(s, bc('g', 'b2_packstrider', { golden: true }));
    expect(tick(s, 'rune_actioned_beasts')).toBe(1);
  });
  it('the random Beast is a buyable Beast at or below the shop tier', () => {
    for (let seed = 1; seed <= 12; seed++) {
      let s = withRune('rune_actioned_beasts', { tier: 2 }, seed);
      for (let i = 0; i < 5; i++) s = playBeast(s, i);
      const got = CARD_INDEX[s.hand[0]!.cardId]!;
      expect(isBeastDef(got.id), got.id).toBe(true);
      expect(got.tier, `${got.id} tier`).toBeLessThanOrEqual(2);
      expect(got.token ?? false, `${got.id} is buyable`).toBe(false);
    }
  });
  it('the meter carries across the turn rollover', () => {
    let s = withRune('rune_actioned_beasts', { wave: 1, resolve: 999, maxResolve: 999, armor: 999 });
    for (let i = 0; i < 3; i++) s = playBeast(s, i);
    s = act(act(s, { type: 'faceOmen' }), { type: 'resolveCombat' });
    expect(tick(s, 'rune_actioned_beasts'), 'banked across the turn').toBe(3);
  });
  it('is deterministic: the same seed and plays grant the same Beasts', () => {
    const run = (): string[] => {
      let s = withRune('rune_actioned_beasts', {}, 11);
      for (let i = 0; i < 10; i++) s = playBeast(s, i);
      return s.hand.map((c) => c.cardId);
    };
    const a = run();
    expect(a).toHaveLength(2);
    expect(run()).toEqual(a);
  });
});

describe("Rune of the Gator's Bite: every Beast played gives your board Beasts +6/+6", () => {
  it('buffs every Beast on the BOARD (the played one included), not hand Beasts, not non-Beasts; permanent', () => {
    let s = withRune('rune_gators_bite', {
      board: [bc('b1', 'b2_packstrider'), bc('k1', 'k_chipwick')],
      hand: [bc('h1', 'b2_trex')],
    });
    s = play(s, bc('b2', 'b2_echohorn'));
    const by = (uid: string): BoardCard | undefined => [...s.board, ...s.hand].find((c) => c.uid === uid);
    expect(gatorFrom(by('b1')), 'the board Beast').toEqual([6, 6]);
    expect(gatorFrom(by('b2')), 'the played Beast itself').toEqual([6, 6]);
    expect(gatorFrom(by('k1')), 'a Kobold').toEqual([0, 0]);
    expect(gatorFrom(by('h1')), 'a Beast in hand').toEqual([0, 0]);
    expect(by('b1')!.attack, 'the stat line moved, not just the ledger').toBe(CARD_INDEX['b2_packstrider']!.attack + 6);
  });
  it('fires on every Beast play and stacks; a non-Beast play does nothing', () => {
    let s = withRune('rune_gators_bite', { board: [bc('b1', 'b2_packstrider')] });
    s = play(s, bc('k', 'k_chipwick'));
    expect(gatorFrom(s.board.find((c) => c.uid === 'b1'))).toEqual([0, 0]);
    s = play(s, bc('b2', 'b2_trex'));
    s = play(s, bc('b3', 'b2_echohorn', { golden: true }));
    expect(gatorFrom(s.board.find((c) => c.uid === 'b1')), 'two Beast plays').toEqual([12, 12]);
    expect(gatorFrom(s.board.find((c) => c.uid === 'b3')), 'the Gilded play counts once').toEqual([6, 6]);
  });
  it('a Shout-summoned Beast is not a play (and lands after the play payout)', () => {
    let s = withRune('rune_gators_bite');
    s = play(s, bc('p', 'alley'));
    expect(gatorFrom(s.board.find((c) => c.uid === 'p')), 'Pennycat itself').toEqual([6, 6]);
    expect(gatorFrom(s.board.find((c) => c.cardId === 'stray')), 'the Stray it summoned').toEqual([0, 0]);
  });
  it('two copies pay twice', () => {
    let s = withRune('rune_gators_bite');
    s = act({ ...s, runeforgeOffer: ['rune_gators_bite'], runeforgeEpic: true, embers: 40 } as RunState, { type: 'buyRune', index: 0 });
    expect(s.runeThresholds!.filter((t) => t.sourceId === 'rune_gators_bite')).toHaveLength(2);
    s = play(s, bc('b', 'b2_packstrider'));
    expect(gatorFrom(s.board.find((c) => c.uid === 'b'))).toEqual([12, 12]);
  });
});
