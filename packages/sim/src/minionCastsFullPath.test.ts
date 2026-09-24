/**
 * A MINION'S CAST IS A REAL CAST (owner ruling 2026-09-24, verbatim: *"fix that for all"*).
 *
 * The End-of-Turn casters (Rope Wrangler's Lasso, Soul Defiler's Staff of Guel, Arnold's Beefy, the escalating
 * caster) used to resolve their spell through `applyCastEffects` and bump `spellsCast` / `spellsThisTurn` by hand.
 * That skipped the real `castSpell()` and everything it does: the rune payouts that live there (Rune of Lassoing's
 * +2/+2), the per-cast Shop-spell runes (Kindling, Scales, …), every `spellCast` watcher (card or rune) and the
 * copy memory. Goldilox alone was patched in by a narrow hook (PR #1682). Every one of them is now a full
 * `castSpell()`; the hook is gone and Goldilox still grows (goldilox.test.ts, the End-of-Turn case).
 *
 * Also here: the shop arena's `castRepeat` (a Rally replayed in the Shop that casts Growth inline) now runs Rune
 * of Spellweaving's measurement too, the one `castSpell()` payout it lacked.
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CardDef } from '@game/core';
import { CONFIG, createRun, reduce, createStarform, starformStats, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, fireShopRally } from './recruit';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}): RunState => ({ ...createRun(1), phase: 'recruit', ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const buffFrom = (c: BoardCard, source: string) => c.buffs?.find((b) => b.source === source);

/** The escalating caster has no live card today; a probe keeps its factory honest. */
const ESCALATOR: CardDef = {
  id: 'dbg_mc_escalator', name: 'Escalating Caster (probe)', tribe: 'neutral', tier: 1, attack: 1, health: 1, keywords: [],
  effects: [{ on: 'endOfTurn', do: 'endOfTurnCastSpellEscalating', params: { spellId: 'growth' } }], text: '',
};
CARD_INDEX[ESCALATOR.id] = ESCALATOR;

describe('Rope Wrangler + Rune of Lassoing (the pinned known gap, flipped)', () => {
  it('the End-of-Turn Lasso steals AND pays the rune: every friendly minion +2/+2, once', () => {
    const s = run({ runeLassoing: true, ownedRunes: ['rune_lassoing'], board: [body('w', 'ropewrangler'), body('a', 'stray', { attack: 2, health: 2 })] } as Partial<RunState>);
    const before = s.spellsCast;
    applyEndOfTurn(s);
    expect((s.castFx ?? []).filter((c) => c.spellId === 'lasso' && c.source.kind === 'minion')).toHaveLength(1);
    expect(at(s, 'a')).toMatchObject({ attack: 4, health: 4 });
    expect(buffFrom(at(s, 'a'), 'Rune of Lassoing')).toMatchObject({ attack: 2, health: 2 });
    expect(s.spellsCast - before, 'one cast, counted once').toBe(1);
  });

  it('an untargeted Lasso is cast on nobody: the carry is not "cast on" (no Lorekeeping payout on it)', () => {
    const s = run({ board: [body('w', 'ropewrangler'), body('a', 'stray', { attack: 9, health: 9 })] } as Partial<RunState>);
    applyEndOfTurn(s);
    expect(at(s, 'a')).toMatchObject({ attack: 9, health: 9 });
  });
});

/**
 * Each caster, beside a "when you cast a spell" RUNE (Rune of Kindling: the ends of the board +4/+6 per cast) and
 * CARD (Runescale Drake: `spellProgress` ticks once per cast). Before the fix neither heard an End-of-Turn cast.
 */
describe.each([
  ['Soul Defiler (Staff of Guel)', 'dm_curator'],
  ['Arnold (Beefy on itself)', 'dw_arnold'],
  ['the escalating caster (Growth)', ESCALATOR.id],
])('%s at End of Turn is a full cast', (_name, casterId) => {
  it('pays a spell-cast rune and a spell-cast card exactly once, and counts once', () => {
    const s = run({
      runeKindling: true, ownedRunes: ['rune_kindling'],
      board: [body('c', casterId), body('r', 'runescale'), body('x', 'stray', { attack: 2, health: 2 })],
    } as Partial<RunState>);
    const before = { cast: s.spellsCast, turn: s.spellsThisTurn };
    applyEndOfTurn(s);
    expect(s.spellsCast - before.cast, 'spellsCast +1').toBe(1);
    expect(s.spellsThisTurn - before.turn, 'spellsThisTurn +1').toBe(1);
    expect(at(s, 'r').spellProgress ?? 0, 'Runescale heard the cast once').toBe(1);
    expect(buffFrom(at(s, 'c'), 'Rune of Kindling'), 'the left-most end').toMatchObject({ attack: 4, health: 6 });
    expect(buffFrom(at(s, 'x'), 'Rune of Kindling'), 'the right-most end').toMatchObject({ attack: 4, health: 6 });
    expect(s.lastSpellCastId, 'the copy memory saw it too').toBeDefined();
  });
});

describe('a Rally replayed in the Shop casting Growth inline (`castRepeat`)', () => {
  const act = (s: RunState, a: Action): RunState => reduce(s, a);
  it('feeds Rune of Spellweaving like a hand-cast Growth would', () => {
    let s = act(
      { ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set3'), tribes: ['celestial', 'undead', 'kobold', 'dwarf', 'spirit'], wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: ['rune_spellweaving'] } as RunState,
      { type: 'buyRune', index: 0 },
    );
    s = act(s, { type: 'buy', uid: s.shop[0]!.uid });
    s = { ...s, board: [body('h', 'hoardbreaker'), body('y', 'stray', { attack: 2, health: 2 })] };
    createStarform(s, { cardId: 'dbg', name: 'probe' });
    const sf0 = starformStats(s)!;
    fireShopRally(s, at(s, 'h'));
    const grew = at(s, 'y').attack - 2;
    expect(grew, 'the Rally cast Growth').toBeGreaterThan(0);
    expect(s.spellweavingCastsThisTurn).toBe(1);
    expect(starformStats(s)!.attack - sf0.attack, 'the Starform got what Growth granted').toBe(grew);
  });
});
