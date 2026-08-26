/**
 * "WHEN A CARD IS ADDED TO YOUR HAND" means ANY card (owner rule 2026-08-26).
 *
 * Gangplank's trigger used to be fired from three hand-insertion sites out of ~20, so buying a Shop spell,
 * minting a Ruby, restoring a displaced minion, taking a Discover pick — most of the game — silently did
 * nothing. It now fires from a hand UID-diff in `reduce`, which is every arrival by construction.
 */
import { describe, expect, it } from 'vitest';
import { createRun, reduce, type Action, type RunState } from './index';
import { CARD_INDEX } from '@game/content';

/** A run with Gangplank + a second Dwarf to receive the buff, and a fat wallet. */
function withGangplank(): RunState {
  const s = createRun(11, 'aster');
  return {
    ...s,
    tier: 3,
    embers: 30,
    board: [
      { uid: 'gp', cardId: 'dw_gangplank', tribe: 'dwarf', attack: 3, health: 5, keywords: [], buffs: [] },
      { uid: 'd2', cardId: 'dw_orin', tribe: 'dwarf', attack: 2, health: 2, keywords: [], buffs: [] },
    ],
  } as unknown as RunState;
}
/** Total stats across the board — Gangplank's payout lands on a random friendly Dwarf, so sum rather than aim. */
const total = (s: RunState): number => s.board.reduce((n, c) => n + c.attack + c.health, 0);

describe('Gangplank fires for ANY card reaching hand', () => {
  it('a SHOP SPELL bought from the spell slot procs it (the owner-reported miss)', () => {
    let s = withGangplank();
    const spell = Object.values(CARD_INDEX).find((c) => c.spell && !c.token && !c.ruby && !c.gift && (c.cost ?? 0) <= 3)!;
    s = { ...s, spell: { uid: 'sp1', cardId: spell.id } } as unknown as RunState;
    const before = total(s);
    s = reduce(s, { type: 'buy', uid: 'sp1' } as Action); // the spell slot shares the `buy` action
    expect(s.hand.some((c) => c.cardId === spell.id), 'the spell reached hand').toBe(true);
    expect(total(s), 'Gangplank paid out').toBeGreaterThan(before);
  });

  it('a RUBY minted to hand procs it (the other owner-reported miss)', () => {
    let s = withGangplank();
    // Ruby Shipment mints 2 Rubies into hand — the real minting path, cast as a real spell.
    s = { ...s, hand: [...s.hand, { uid: 'sp1', cardId: 'rubyshipment', tribe: 'neutral', attack: 0, health: 1, keywords: [] }] } as unknown as RunState;
    const before = total(s);
    s = reduce(s, { type: 'play', uid: 'sp1' } as Action);
    const rubies = s.hand.filter((c) => CARD_INDEX[c.cardId]?.ruby).length;
    expect(rubies, 'Rubies were minted to hand').toBeGreaterThan(0);
    // +1/+2 per arriving card — one payout per minted Ruby.
    expect(total(s) - before, 'Gangplank paid out once per Ruby').toBe(rubies * 3);
  });

  it('a MINION bought into hand still procs it (the path that always worked — no regression)', () => {
    let s = withGangplank();
    const minion = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && !c.ruby && c.tier === 1)!;
    s = { ...s, shop: [{ uid: 'o1', cardId: minion.id }] } as unknown as RunState;
    const before = total(s);
    s = reduce(s, { type: 'buy', uid: 'o1' } as Action);
    expect(total(s), 'Gangplank paid out for a bought minion').toBeGreaterThan(before);
  });

  it('fires ONCE per card — the diff must not double-count with the old explicit calls', () => {
    let s = withGangplank();
    const minion = Object.values(CARD_INDEX).find((c) => !c.spell && !c.token && !c.ruby && c.tier === 1)!;
    s = { ...s, shop: [{ uid: 'o1', cardId: minion.id }] } as unknown as RunState;
    const before = total(s);
    s = reduce(s, { type: 'buy', uid: 'o1' } as Action);
    // Gangplank grants +1/+2 = 3 stat points per card. Exactly one card arrived, so exactly 3.
    expect(total(s) - before).toBe(3);
  });
});
