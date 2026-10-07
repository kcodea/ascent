/**
 * RUNE OF DRAGON BREATH, END TO END INTO COMBAT (owner question 2026-10-06, verbatim):
 *   *"can you confirm that rune of the dragon breath works in combat?"*
 *
 * Text: "Get a **Dragonflame**. Repeat every **Start of Turn**. They cast **twice** from hand."
 * Reward: `recurringGrant ['sp_dragonflame']` + `runeSpellDouble 'sp_dragonflame'`.
 *
 * The rune has NO combat-time channel of its own: both halves resolve in the shop (the Start of Turn grant and the
 * from-hand multicast). Its combat value is the permanent stats those hand casts bake into the board, which the
 * fight (and a recorded snapshot served to another seat) must carry. A Dragonflame a MINION casts in combat
 * (Flamebeat Drake, Warflame) is not a hand cast, so it resolves once with or without the rune (R-MULT-06,
 * owner ruling 2026-09-24). Each case below proves one of those facts by running the real reducer / simulator.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, presentationPolicyFor, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import {
  createRun, reduce, questCombatMods, snapshotBoard, sideFromSnapshot, spellCasts, dragonflameCasts,
  type BoardCard, type RunState,
} from './index';

const FLAME = 'sp_dragonflame';
const dragon = (uid: string, cardId = 'd2_embermouth'): BoardCard =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]!.tribe, attack: 2, health: 2, keywords: [], golden: false } as BoardCard);
const flameCard = (uid: string): BoardCard =>
  ({ uid, cardId: FLAME, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false } as BoardCard);
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId: 'set2', phase: 'recruit', embers: 30, tier: 6, wave: 1, resolve: 999, maxResolve: 999, armor: 999, ...over } as RunState);
const take = (s: RunState): RunState => reduce(s, { type: 'devGrant', kind: 'rune', id: 'rune_dragon_breath' } as never) as RunState;
const statTotal = (b: { attack: number; health: number }[]) => b.reduce((n, c) => n + c.attack + c.health, 0);
const castFlameFromHand = (s: RunState): RunState => reduce(s, { type: 'play', uid: 'df' });

describe('Rune of Dragon Breath: the shop half', () => {
  it('taking it grants a Dragonflame now, arms the Start of Turn repeat, and arms the from-hand double', () => {
    const s = take(run({ hand: [] }));
    expect(s.hand.filter((c) => c.cardId === FLAME)).toHaveLength(1);
    expect(s.questRecurringGrants ?? []).toContain(FLAME);
    expect(s.runeSpellDouble ?? []).toContain(FLAME);
    expect(spellCasts(s, CARD_INDEX[FLAME]!), 'the ×N badge reads the doubled cast').toBe(2);
  });

  it('repeats at the next Start of Turn (one more Dragonflame after a combat)', () => {
    let s = take(run({ hand: [], board: [dragon('a')] }));
    const before = s.hand.filter((c) => c.cardId === FLAME).length;
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.hand.filter((c) => c.cardId === FLAME).length).toBe(before + 1);
  });

  it('a hand cast resolves twice: 2 x (1 + Dragons) buffs of +4/+4, the second cast credited to the rune', () => {
    const board = [dragon('a'), dragon('b', 'd2_skald'), dragon('c', 'd2_cinderchef')];
    const plain = castFlameFromHand(run({ board, hand: [flameCard('df')], rngCursor: 11 }));
    const armed = castFlameFromHand(run({ board, hand: [flameCard('df')], rngCursor: 11, ownedRunes: ['rune_dragon_breath'], runeSpellDouble: [FLAME] }));
    const base = statTotal(board);
    expect(statTotal(plain.board) - base, 'no rune: 1 + 3 Dragons = 4 buffs of +4/+4').toBe(4 * 8);
    expect(statTotal(armed.board) - base, 'rune: twice that').toBe(2 * 4 * 8);
    expect((armed.castFx ?? []).filter((c) => c.source.kind === 'rune' && c.source.id === 'rune_dragon_breath'), 'the repeat is the rune\'s cast').toHaveLength(1);
    expect(spellCasts(armed, CARD_INDEX[FLAME]!) * dragonflameCasts(run({ board })), 'hand badge: x2 casts x (1 + 3 Dragons)').toBe(8);
  });

  it('two copies of the rune stack: four casts', () => {
    const board = [dragon('a'), dragon('b', 'd2_skald')];
    const s = castFlameFromHand(run({ board, hand: [flameCard('df')], rngCursor: 5, ownedRunes: ['rune_dragon_breath', 'rune_dragon_breath'], runeSpellDouble: [FLAME, FLAME] }));
    expect(statTotal(s.board) - statTotal(board), '4 casts x (1 + 2 Dragons) x +4/+4').toBe(4 * 3 * 8);
  });

  it('a non-Dragon board still gets the base buff, doubled (the "1 +" in "repeat for every Dragon")', () => {
    const board = [{ ...dragon('x', 'sandbag'), tribe: 'neutral' } as BoardCard];
    const s = castFlameFromHand(run({ board, hand: [flameCard('df')], ownedRunes: ['rune_dragon_breath'], runeSpellDouble: [FLAME] }));
    expect(statTotal(s.board) - statTotal(board)).toBe(2 * 8);
  });
});

describe('Rune of Dragon Breath: what reaches combat', () => {
  const buffedRun = (): RunState => castFlameFromHand(take(run({
    board: [dragon('a'), dragon('b', 'd2_skald'), dragon('c', 'd2_cinderchef')], hand: [flameCard('df')], rngCursor: 3,
  })));

  it('the hand-cast buffs are permanent: the player side enters the fight with them', () => {
    let s = buffedRun();
    const shopStats = s.board.map((c) => [c.attack, c.health]);
    expect(statTotal(s.board) - 12, 'rune-doubled cast landed in the shop').toBe(2 * 4 * 8);
    s = reduce(s, { type: 'faceOmen' });
    s = reduce(s, { type: 'resolveCombat' });
    const initial = s.lastCombat!.initial.player.map((m) => [m.attack, m.health]);
    expect(initial).toEqual(shopStats);
  });

  it('a recorded snapshot of that board serves the same buffed stats to the other seat', () => {
    const s = buffedRun();
    const snap = snapshotBoard(s);
    expect(snap.runes ?? []).toContain('rune_dragon_breath');
    const enemy = sideFromSnapshot(snap, 6, Object.keys(CARD_INDEX));
    const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 90000 } as BoardMinion];
    const r = simulate(wall, snap.minions as BoardMinion[], makeRng(1), CARD_INDEX, combatSide({ tier: 1 }), enemy);
    expect(r.initial.enemy.map((m) => [m.attack, m.health])).toEqual(s.board.map((c) => [c.attack, c.health]));
  });

  it('the rune adds no combat modifier, so a minion\'s combat Dragonflame casts once per trigger (R-MULT-06)', () => {
    expect(questCombatMods(run({ ownedRunes: ['rune_dragon_breath'], runeSpellDouble: [FLAME], questRecurringGrants: [FLAME] })))
      .toEqual(questCombatMods(run()));
    // Flamebeat Drake: "Rally: cast Dragonflame". One `sc` per Flamebeat attack, rune or not.
    const board: BoardMinion[] = [
      { cardId: 'd2_flamebeat', attack: 3, health: 900, keywords: [...(CARD_INDEX['d2_flamebeat']!.keywords ?? [])] } as unknown as BoardMinion,
      { cardId: 'd2_embermouth', attack: 0, health: 900, keywords: [] } as unknown as BoardMinion,
    ];
    const wall: BoardMinion[] = [{ cardId: 'sandbag', attack: 0, health: 90000 } as BoardMinion];
    const ev: CombatEvent[] = simulate(board, wall, makeRng(7), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 1 })).events;
    const attacks = ev.filter((e) => e.type === 'attack' && (e as { attacker?: string }).attacker === 'm0').length;
    const casts = ev.filter((e) => e.type === 'sc' && (e as { source?: string }).source === 'm0' && (e as { spellId?: string }).spellId === FLAME).length;
    expect(attacks).toBeGreaterThan(0);
    expect(casts).toBe(attacks);
  });
});

describe('Rune of Dragon Breath: presentation is bound', () => {
  it('its Start of Turn grant and every Dragonflame cast (shop or combat) own a beat', () => {
    expect(presentationPolicyFor('rune:rune_dragon_breath:recruit')?.policy).toBe('ownBeat');
    expect(presentationPolicyFor('factory:spellBuffRandomPerTribe:cast')?.policy).toBe('ownBeat');
    expect(presentationPolicyFor('factory:rallyCastNamedSpell:onAttack')?.policy, 'Flamebeat Drake').toBe('ownBeat');
    expect(presentationPolicyFor('factory:onTribeAttackCastNamedSpell:onAttack')?.policy, 'Warflame').toBe('ownBeat');
  });
});
