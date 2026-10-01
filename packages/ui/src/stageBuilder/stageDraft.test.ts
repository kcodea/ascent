import { describe, expect, it } from 'vitest';
import { CARD_INDEX, cardRevision, type GauntletStage } from '@game/content';
import type { Keyword } from '@game/core';
import { GAUNTLET_DEFAULT_TIERS } from '@game/sim';
import {
  activeRunes, addMinion, copyPreviousRound, moveMinion, removeMinion, roundToSnapshot, roundTier, roundsEqual, setMinionStats,
  snapshotToRound, stampForSave, swapMinionCard, toggleAddedKeyword, toggleMinionGolden,
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

describe('stageDraft minion edits (shared by the panel and the board canvas)', () => {
  it('addMinion appends at printed stats, refusing a full board or an unknown card', () => {
    const s = stage();
    const next = addMinion(s, 3, plain.id);
    expect(next.rounds[2]!.board).toHaveLength(4);
    expect(next.rounds[2]!.board[3]).toEqual({ cardId: plain.id, attack: plain.attack, health: plain.health, cardVersion: cardRevision(plain) });
    expect(s.rounds[2]!.board).toHaveLength(3); // never mutates
    expect(addMinion(s, 3, 'no_such_card')).toBe(s);
    let full = s;
    for (let i = 0; i < 10; i++) full = addMinion(full, 3, plain.id);
    expect(full.rounds[2]!.board).toHaveLength(7);
  });

  it('removeMinion / setMinionStats (floored 0 / 1) edit only the one minion', () => {
    const s = stage();
    expect(removeMinion(s, 3, 1).rounds[2]!.board.map((m) => m.attack)).toEqual([5, 1]);
    expect(removeMinion(s, 3, 9)).toBe(s);
    const st = setMinionStats(s, 3, 0, { attack: -4, health: 0 }).rounds[2]!.board[0]!;
    expect([st.attack, st.health]).toEqual([0, 1]);
    expect(setMinionStats(s, 3, 0, { attack: 12 }).rounds[2]!.board[0]!.health).toBe(6);
  });

  it('toggleAddedKeyword adds/removes an added keyword and ignores a printed one', () => {
    const s = stage();
    const on = toggleAddedKeyword(s, 3, 0, 'DS');
    expect(on.rounds[2]!.board[0]!.addedKeywords).toEqual(['DS']);
    expect('addedKeywords' in toggleAddedKeyword(on, 3, 0, 'DS').rounds[2]!.board[0]!).toBe(false);
    expect(toggleAddedKeyword(s, 3, 1, printed[0]!).rounds[2]!.board[1]).toEqual(s.rounds[2]!.board[1]);
  });

  it('toggleMinionGolden flips the flag (no undefined key); swapMinionCard makes a fresh unit of the new card', () => {
    const s = stage();
    expect('golden' in toggleMinionGolden(s, 3, 0).rounds[2]!.board[0]!).toBe(false);
    expect(toggleMinionGolden(s, 3, 2).rounds[2]!.board[2]!.golden).toBe(true);
    const sw = swapMinionCard(s, 3, 1, plain.id).rounds[2]!.board[1]!;
    expect(sw).toEqual({ cardId: plain.id, attack: plain.attack, health: plain.health, cardVersion: cardRevision(plain) });
    expect(swapMinionCard(s, 3, 1, 'no_such_card')).toBe(s);
  });
});
