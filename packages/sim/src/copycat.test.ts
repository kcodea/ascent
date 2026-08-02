import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, CONFIG, type BoardCard, type RunState } from './index';

/**
 * Copycat (Rune of Copycat's GIFT — owner spec 2026-08-02): a targeted token spell that copies a friendly
 * minion EXACTLY — stats, buffs, keywords, gilding, and every per-instance improvement. Deliberately NOT a
 * Shop spell: it resolves once (no Yazzus/Nimbus multipliers), records no cast (no tallies, no first/last
 * spell memory, no spellCast watchers), and still counts as a card played.
 */
const gift = (uid: string): BoardCard =>
  ({ uid, cardId: 'copycat', tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false });

const grown: BoardCard = {
  uid: 'T', cardId: 'kennel', tribe: 'beast', attack: 9, health: 12, keywords: ['SC', 'T'],
  golden: true, summonBonus: 4,
};

describe('Copycat — the exact-copy gift', () => {
  it('copies the target exactly: stats, keywords, gilding and accrued improvements', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [{ ...grown }], hand: [gift('g')] };
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 'T' });
    const copy = s.hand.find((c) => c.cardId === 'kennel');
    expect(copy, 'the copy should land in hand').toBeDefined();
    expect(copy!.uid, 'a fresh uid — never the original\u2019s').not.toBe('T');
    expect([copy!.attack, copy!.health]).toEqual([9, 12]);
    expect(copy!.keywords).toEqual(['SC', 'T']);
    expect(copy!.golden, 'gilding copies too — "exactly" means exactly').toBe(true);
    expect(copy!.summonBonus, 'per-instance improvements ride along').toBe(4);
    expect(s.board.find((c) => c.uid === 'T'), 'the original is untouched').toBeDefined();
  });

  it('is NOT a Shop spell: no cast recorded, no multiplier used, no rider fired', () => {
    let s: RunState = {
      ...createRun(1), phase: 'recruit', board: [{ ...grown }], hand: [gift('g')],
      nextSpellExtraCasts: 1, // an armed Nimbus charge must survive for a REAL spell
    };
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 'T' });
    expect(s.spellsCast, 'no spell cast recorded').toBe(0);
    expect(s.spellsThisTurn).toBe(0);
    expect(s.lastSpellCastId).toBeUndefined();
    expect(s.firstSpellThisTurnId).toBeUndefined();
    expect(s.nextSpellExtraCasts, 'the Nimbus charge survives').toBe(1);
    expect(s.hand.filter((c) => c.cardId === 'kennel').length, 'exactly ONE copy — no multiplier').toBe(1);
    expect(s.playedThisTurn, 'still counts as a card played').toContain('copycat');
  });

  it('fizzles (kept in hand) with no valid friendly target', () => {
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [], hand: [gift('g')] };
    const before = s;
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 'nope' });
    expect(s).toBe(before); // untouched state — the gift stays in hand
  });

  it('a full hand swallows the copy but still consumes the gift (the conjure rule)', () => {
    const filler = Array.from({ length: CONFIG.handMax - 1 }, (_, i) =>
      ({ uid: `f${i}`, cardId: 'drummer', tribe: 'neutral' as const, attack: 2, health: 2, keywords: [], golden: false }));
    let s: RunState = { ...createRun(1), phase: 'recruit', board: [{ ...grown }], hand: [...filler, gift('g')] };
    s = reduce(s, { type: 'play', uid: 'g', targetUid: 'T' });
    expect(s.hand.some((c) => c.cardId === 'copycat')).toBe(false); // the gift is spent
    expect(s.hand.filter((c) => c.cardId === 'kennel').length, 'hand was full pre-copy').toBe(0);
  });

  it('the rune grants it, and the def is a token spell (never a Shop spell by any reading)', () => {
    const def = CARD_INDEX['copycat']!;
    expect(def.token).toBe(true);
    expect(def.spell).toBe(true);
    expect(def.target).toBe('friendly');
  });
});
