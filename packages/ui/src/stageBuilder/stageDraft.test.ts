import { describe, expect, it } from 'vitest';
import { CARD_INDEX, cardRevision, type GauntletStage } from '@game/content';
import type { Keyword } from '@game/core';
import { GAUNTLET_DEFAULT_TIERS } from '@game/sim';
import {
  activeRunes, copyPreviousRound, moveMinion, roundToSnapshot, roundTier, roundsEqual, snapshotToRound, stampForSave,
} from './stageDraft';
import { moveEnemy, toggleEnemyGolden } from '../sandboxEdit';

const plain = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length === 0)!;
const keyworded = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length > 0)!;
const printed = keyworded.keywords!;
const extra = (['T', 'W', 'R', 'V', 'C', 'D'] as Keyword[]).find((k) => !printed.includes(k))!;

const stage = (): GauntletStage => ({
  number: 1, name: 'Test', opponentName: 'Tester', status: 'draft',
  runes: { round6: 'rune_adventuring', round9: 'rune_adventuring' },
  rounds: Array.from({ length: 10 }, (_, i) => ({
    board: i === 2
      ? [
          { cardId: plain.id, attack: 5, health: 6, golden: true, cardVersion: cardRevision(plain) },
          { cardId: keyworded.id, attack: 2, health: 3, addedKeywords: [extra], cardVersion: 'old' },
          { cardId: plain.id, attack: 1, health: 1, cardVersion: 'x' },
        ]
      : [{ cardId: plain.id, attack: 1 + i, health: 2 + i, cardVersion: cardRevision(plain) }],
  })),
});

describe('stageDraft', () => {
  it('round-trips a round with golden + added keywords + printed keywords', () => {
    const s = stage();
    const snap = roundToSnapshot(s, 3, 3);
    expect(snap.minions[1]!.keywords).toEqual([...new Set([...printed, extra])]);
    expect(snap.minions[0]!.golden).toBe(true);
    expect(snap.minions[0]!.keywords).toBeUndefined();
    expect(snapshotToRound(snap, s.rounds[2]!)).toEqual(s.rounds[2]);
  });

  it('never lists printed keywords as added', () => {
    const s = stage();
    const back = snapshotToRound(roundToSnapshot(s, 3, 3), s.rounds[2]!);
    for (const k of printed) expect(back.board[1]!.addedKeywords).not.toContain(k);
    expect(back.board[2]!.addedKeywords).toBeUndefined();
  });

  it('cardVersion falls back to the current revision for a new card', () => {
    const s = stage();
    const snap = roundToSnapshot(s, 3, 3);
    snap.minions[0] = { cardId: keyworded.id, attack: 1, health: 1 };
    expect(snapshotToRound(snap, s.rounds[2]!).board[0]!.cardVersion).toBe(cardRevision(keyworded));
  });

  it('activeRunes by round', () => {
    const s = stage();
    expect([5, 6, 9, 10].map((r) => activeRunes(s, r).length)).toEqual([0, 1, 2, 2]);
  });

  it('snapshot carries opponent runes from round 6 only', () => {
    const s = stage();
    expect(roundToSnapshot(s, 6, 6).questMods?.rallyExtraAlways).toBe(1);
    expect(roundToSnapshot(s, 6, 6).runes).toEqual(['rune_adventuring']);
    expect('runes' in roundToSnapshot(s, 5, 5)).toBe(false);
  });

  it('roundTier default vs explicit', () => {
    const s = stage();
    expect(roundTier(s, 4)).toBe(GAUNTLET_DEFAULT_TIERS[3]);
    s.rounds[3]!.tier = 6;
    expect(roundTier(s, 4)).toBe(6);
    expect(roundToSnapshot(s, 4, 4).tier).toBe(6);
  });

  it('copyPreviousRound: no-op on round 1, deep copy otherwise', () => {
    const s = stage();
    expect(copyPreviousRound(s, 1)).toBe(s);
    const c = copyPreviousRound(s, 4);
    expect(c.rounds[3]).toEqual(s.rounds[2]);
    expect(c.rounds[3]!.board[1]).not.toBe(s.rounds[2]!.board[1]);
    expect(c.rounds[3]!.board[1]!.addedKeywords).not.toBe(s.rounds[2]!.board[1]!.addedKeywords);
    expect(s.rounds[3]!.board.length).toBe(1);
  });

  it('moveMinion moves, clamps, and no-ops', () => {
    const s = stage();
    const order = (t: GauntletStage) => t.rounds[2]!.board.map((m) => m.attack);
    expect(order(moveMinion(s, 3, 0, 2))).toEqual([2, 1, 5]);
    expect(order(moveMinion(s, 3, 0, 99))).toEqual([2, 1, 5]);
    expect(moveMinion(s, 3, 9, 0)).toBe(s);
    expect(moveMinion(s, 3, 1, 1)).toBe(s);
    expect(order(s)).toEqual([5, 2, 1]);
  });

  it('roundsEqual', () => {
    const s = stage();
    const c = copyPreviousRound(s, 4);
    expect(roundsEqual(c.rounds[3]!, s.rounds[2]!)).toBe(true);
    expect(roundsEqual(s.rounds[3]!, s.rounds[2]!)).toBe(false);
    expect(roundsEqual({ ...s.rounds[2]!, tier: 2 }, s.rounds[2]!)).toBe(false);
  });

  it('stampForSave stamps cardRevision without mutating', () => {
    const s = stage();
    const t = stampForSave(s);
    expect(t.rounds[2]!.board[1]!.cardVersion).toBe(cardRevision(CARD_INDEX[keyworded.id]!));
    expect(s.rounds[2]!.board[1]!.cardVersion).toBe('old');
  });

  it('toggleEnemyGolden / moveEnemy', () => {
    const snap = roundToSnapshot(stage(), 3, 3);
    const t = toggleEnemyGolden(snap, 0);
    expect(t.minions[0]!.golden).toBeUndefined();
    expect(toggleEnemyGolden(t, 0).minions[0]!.golden).toBe(true);
    expect(toggleEnemyGolden(snap, 9)).toBe(snap);
    expect(moveEnemy(snap, 0, 2).minions.map((m) => m.attack)).toEqual([2, 1, 5]);
    expect(moveEnemy(snap, 5, 0)).toBe(snap);
    expect(snap.minions.map((m) => m.attack)).toEqual([5, 2, 1]);
  });
});
