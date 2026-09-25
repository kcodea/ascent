/**
 * THE FROM-HAND GATE (owner ruling 2026-09-24, verbatim: *"let's make the effect of living grimoire and yazzus/orivax
 * etc specify spell cast from hand so that it only doubles from spells cast from hand."*).
 *
 * Every cast multiplier (Living Grimoire, Spell Thesis, Ancient Runes, Orivax, Yazzus, Nimbus / Comet, the Ale and
 * named-spell multipliers, Constellation Prime) applies ONLY to a spell the player casts from hand, and only such a
 * cast spends a one-shot multiplier. A minion's cast (a Mage-Pup's taught spell), a rune's cast (Rune of
 * Recurrence at End of Turn) and an Equipment's cast (Pourman's Keg, set3Dwarves.test.ts) resolve once and leave
 * every charge and freebie in place. The gate is one scope, `withHandCast`, set only by the reducer's hand-play
 * paths (rule R-MULT-06).
 *
 * Unchanged, and pinned here too: a minion's or rune's cast still counts as a spell cast for the first/last-spell
 * memory (R-MINIONCAST-01, owner: "this is correct").
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, spellCasts, type BoardCard, type RunState } from './index';
import { applyEndOfTurn } from './recruit';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const GROWTH = CARD_INDEX['growth']!;

/** A board with a CHARGED Living Grimoire (x2) and a 1/1 to watch Growth land on. */
const charged = (over: Partial<RunState> = {}): RunState =>
  run({ board: [body('g', 'd2_grimoire'), body('a', 'stray', { attack: 1, health: 1 })], grimoireMult: 2, ...over } as Partial<RunState>);

describe('a MINION\'s cast (a Mage-Pup casting its taught Growth) is never multiplied and spends nothing', () => {
  const pup = body('p', 'b2_magepup', { attack: 1, health: 1, taughtSpellId: 'growth' });

  it('Living Grimoire: Growth lands once and the charge survives', () => {
    const next = reduce(charged({ hand: [pup] }), { type: 'play', uid: 'p', toIndex: 2 });
    expect(at(next, 'a')).toMatchObject({ attack: 2, health: 2 });
    expect(next.grimoireMult, 'the charge is still armed for the next hand cast').toBe(2);
  });

  it('Spell Thesis + Ancient Runes + a Nimbus charge: one landing, and the Thesis freebie and Nimbus charge stay unspent', () => {
    const s = run({
      board: [body('a', 'stray', { attack: 1, health: 1 })], hand: [pup],
      spellFirstDoubleEachTurn: true, spellFirstUsedThisTurn: false, spellDoubleAlways: true, nextSpellExtraCasts: 1,
    } as Partial<RunState>);
    const next = reduce(s, { type: 'play', uid: 'p', toIndex: 1 });
    expect(at(next, 'a')).toMatchObject({ attack: 2, health: 2 });
    expect(next.spellFirstUsedThisTurn ?? false, 'Spell Thesis is still this turn\'s to spend').toBe(false);
    expect(next.nextSpellExtraCasts, 'the Nimbus / Comet charge waits for a hand cast').toBe(1);
  });

  it('still counts as a spell cast, and the first/last-spell memory still records it (R-MINIONCAST-01)', () => {
    const before = run().spellsCast;
    const next = reduce(charged({ hand: [pup] }), { type: 'play', uid: 'p', toIndex: 2 });
    expect(next.spellsCast - before).toBe(1);
    expect(next.firstSpellThisTurnId).toBe('growth');
    expect(next.lastSpellCastId).toBe('growth');
  });
});

describe('a RUNE\'s cast (Rune of Recurrence re-casting the turn\'s first spell at End of Turn) is never multiplied and spends nothing', () => {
  const recurring = { questRecurringEndOfTurn: ['recastFirstSpell'], firstSpellThisTurnId: 'growth', spellsThisTurn: 1 } as Partial<RunState>;

  it('Living Grimoire: its two casts land once each and the charge survives', () => {
    const s = charged(recurring);
    applyEndOfTurn(s);
    expect(at(s, 'a')).toMatchObject({ attack: 3, health: 3 });
    expect(s.grimoireMult).toBe(2);
  });

  it('Orivax: the rune\'s casts do not close the first-spell window, so the next hand spell still casts 3 times', () => {
    const s = run({ board: [body('a', 'stray')], spellFirstMultEachTurn: 3, spellMultMark: 1, ...recurring } as Partial<RunState>);
    expect(spellCasts(s, GROWTH), 'the window is open before').toBe(3);
    applyEndOfTurn(s);
    expect(spellCasts(s, GROWTH), 'and still open after the rune cast twice').toBe(3);
  });
});

describe('a spell cast FROM HAND still doubles and still spends', () => {
  it('Living Grimoire: Growth lands twice and the charge is spent', () => {
    const next = reduce(charged({ hand: [body('x', 'growth')] }), { type: 'play', uid: 'x' });
    expect(at(next, 'a')).toMatchObject({ attack: 3, health: 3 });
    expect(next.grimoireMult ?? 0).toBe(0);
  });

  it('Spell Thesis: Growth lands twice and the freebie is spent', () => {
    const s = run({
      board: [body('a', 'stray', { attack: 1, health: 1 })], hand: [body('x', 'growth')],
      spellFirstDoubleEachTurn: true, spellFirstUsedThisTurn: false,
    } as Partial<RunState>);
    const next = reduce(s, { type: 'play', uid: 'x' });
    expect(at(next, 'a')).toMatchObject({ attack: 3, health: 3 });
    expect(next.spellFirstUsedThisTurn).toBe(true);
  });

  it('Orivax: the hand cast after a minion\'s cast is the one that casts 3 times', () => {
    const s = run({
      board: [body('a', 'stray', { attack: 1, health: 1 })],
      hand: [body('p', 'b2_magepup', { attack: 1, health: 1, taughtSpellId: 'growth' }), body('x', 'growth')],
      spellFirstMultEachTurn: 3, spellMultMark: 0, spellsThisTurn: 0,
    } as Partial<RunState>);
    const afterPup = reduce(s, { type: 'play', uid: 'p', toIndex: 1 });
    expect(at(afterPup, 'a'), 'the Pup\'s Growth: once').toMatchObject({ attack: 2, health: 2 });
    const afterHand = reduce(afterPup, { type: 'play', uid: 'x' });
    expect(at(afterHand, 'a'), 'the hand Growth: three times').toMatchObject({ attack: 5, health: 5 });
    expect(spellCasts(afterHand, GROWTH), 'and then the window is spent').toBe(1);
  });
});
