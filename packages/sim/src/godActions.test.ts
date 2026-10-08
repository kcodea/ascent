// packages/sim/src/godActions.test.ts
import { describe, expect, it } from 'vitest';
import { RUNES, EPIC_RUNES } from '@game/content';
import { createLobbyRun, reduce, makeGodModeRun, godRuneBlocked, type RunState } from './index';

const plain = (): RunState => ({ ...createLobbyRun(7, 'warden', {}, 'practice', { opponents: 'players', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes: [] }), phase: 'recruit' });
const god = (): RunState => makeGodModeRun(plain()); // makeGodModeRun lifts maxRounds itself
const anyRune = RUNES[0]!.id;
const anyEpic = EPIC_RUNES[0]!.id;

describe('godPrint', () => {
  it('appends the card to the shop in God Mode, any tier', () => {
    const before = god();
    const after = reduce(before, { type: 'godPrint', cardId: 'sandbag' });
    expect(after.shop.length).toBe(before.shop.length + 1);
    expect(after.shop.at(-1)!.cardId).toBe('sandbag');
    expect(new Set(after.shop.map((c) => c.uid)).size).toBe(after.shop.length); // fresh uid
  });
  it('is refused outside God Mode', () => {
    const before = plain();
    expect(reduce(before, { type: 'godPrint', cardId: 'sandbag' })).toBe(before);
  });
  it('is refused for an unknown card', () => {
    const before = god();
    expect(reduce(before, { type: 'godPrint', cardId: 'no_such_card' })).toBe(before);
  });
  it('is refused outside the shop phase', () => {
    const before = { ...god(), phase: 'combat' as const };
    expect(reduce(before, { type: 'godPrint', cardId: 'sandbag' })).toBe(before);
  });
});

describe('godGrantRune', () => {
  it('grants a rune and an epic rune free in God Mode', () => {
    let s = god();
    const gold = s.embers;
    s = reduce(s, { type: 'godGrantRune', runeId: anyRune });
    s = reduce(s, { type: 'godGrantRune', runeId: anyEpic });
    expect(s.ownedRunes).toEqual(expect.arrayContaining([anyRune, anyEpic]));
    expect(s.embers).toBe(gold);
  });
  it('is refused outside God Mode', () => {
    const before = plain();
    expect(reduce(before, { type: 'godGrantRune', runeId: anyRune })).toBe(before);
  });
  it('is refused for an owned rune that cannot stack', () => {
    const s0 = god();
    const unique = [...RUNES, ...EPIC_RUNES].find((r) => godRuneBlocked({ ...s0, ownedRunes: [r.id] }, r.id));
    if (!unique) return; // no non-stacking rune in this set — nothing to pin
    const before = { ...s0, ownedRunes: [unique.id] };
    expect(reduce(before, { type: 'godGrantRune', runeId: unique.id })).toBe(before);
  });
});
