// packages/sim/src/godActions.test.ts
import { describe, expect, it } from 'vitest';
import { RUNES, EPIC_RUNES, RUNE_DUP_UNIQUE, RUNE_INDEX } from '@game/content';
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
    // Rune of the Ornate Clock is ruled UNIQUE (owner 2026-08-27): a second copy is never offered, so never granted.
    const unique = 'rune_ornate_clock';
    expect(RUNE_DUP_UNIQUE.has(unique)).toBe(true);
    expect(RUNE_INDEX[unique]).toBeDefined();
    expect(godRuneBlocked({ ...s0, ownedRunes: [] }, unique)).toBe(false); // the first copy is fine
    const before = { ...s0, ownedRunes: [unique] };
    expect(godRuneBlocked(before, unique)).toBe(true);
    expect(reduce(before, { type: 'godGrantRune', runeId: unique })).toBe(before);
  });
  it('is refused for an unknown rune', () => {
    const before = god();
    expect(reduce(before, { type: 'godGrantRune', runeId: 'rune_no_such_rune' })).toBe(before);
  });
  it('a second copy behaves exactly as a bought second copy (Rune of the Altar on an empty board carries to next turn)', () => {
    // Own one Altar already, board empty: the second copy's sell-the-board has nothing to sell, so a BOUGHT second
    // copy banks to next turn (`pendingQuestRewards`) instead of firing on nothing. A granted one must do the same.
    const base: RunState = { ...reduce(god(), { type: 'godGrantRune', runeId: 'rune_altar' }), board: [] };
    expect(base.ownedRunes).toEqual(['rune_altar']);
    const granted = reduce(base, { type: 'godGrantRune', runeId: 'rune_altar' });
    const bought = reduce({ ...base, runeforgeOffer: ['rune_altar'], runeforgeEpic: !!RUNE_INDEX.rune_altar!.epic }, { type: 'buyRune', index: 0 });
    expect(bought.pendingQuestRewards, 'the bought path banks it').toEqual([{ questId: 'rune_altar', turnsLeft: 1 }]);
    expect(granted.pendingQuestRewards).toEqual(bought.pendingQuestRewards);
    expect(granted.ownedRunes).toEqual(bought.ownedRunes);
    expect(granted.runeStacks).toEqual(bought.runeStacks);
    expect(granted.embers, 'granted free').toBe(base.embers);
  });
});
