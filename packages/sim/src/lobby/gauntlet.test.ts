import { describe, expect, it } from 'vitest';
import { lossDamageCap, roundLossCap, runeCombatModsFor } from '../reducer';
import { omenBoardMinions, authoredTierFor, authoredSeat } from './tutorialSeats';
import { settleRunLobbyRound, type RunLobby } from './runLobby';
import { CARD_INDEX, RUNE_INDEX, RUNES } from '@game/content';
import type { CombatResult } from '@game/core';

describe('roundLossCap', () => {
  it('falls back to the normal game table when the lobby sets no caps', () => {
    for (const r of [1, 3, 4, 7, 8, 11, 12, 15, 16, 40]) expect(roundLossCap(undefined, r)).toBe(lossDamageCap(r));
    for (const r of [1, 5, 16]) expect(roundLossCap({}, r)).toBe(lossDamageCap(r));
  });

  it('reads a per-round table, null and past-the-end meaning uncapped', () => {
    const rules = { lossCaps: [5, 5, 5, 10, 10, 10, 15, 15, null, null] };
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => roundLossCap(rules, r)))
      .toEqual([5, 5, 5, 10, 10, 10, 15, 15, Infinity, Infinity, Infinity]);
  });
});

const tauntless = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length === 0)!;
const keyworded = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length > 0)!;

describe('authored minions', () => {
  it('keep the authored stat line and mark golden', () => {
    const [m] = omenBoardMinions([{ cardId: tauntless.id, attack: 9, health: 11, golden: true }]);
    expect(m).toMatchObject({ cardId: tauntless.id, attack: 9, health: 11, golden: true });
  });

  it('add keywords ON TOP of the printed ones, without duplicates', () => {
    const printed = keyworded.keywords!;
    const [m] = omenBoardMinions([{ cardId: keyworded.id, attack: 1, health: 1, addedKeywords: ['T', printed[0]!] }]);
    expect(new Set(m!.keywords)).toEqual(new Set([...printed, 'T']));
    expect(m!.keywords!.length).toBe(new Set([...printed, 'T']).size);
  });

  it('a real card with no added keywords still inherits its printed keywords (keywords left unset)', () => {
    const [m] = omenBoardMinions([{ cardId: keyworded.id, attack: 1, health: 1 }]);
    expect(m!.keywords).toBeUndefined();
  });
});

describe('authoredTierFor', () => {
  it('an explicit per-round tier wins over the ramp', () => {
    const seat = { authoredTierRamp: 2, authoredTiers: [1, 1, 4] };
    expect(authoredTierFor(seat, 3)).toBe(4);
    expect(authoredTierFor(seat, 5)).toBe(authoredTierFor({ authoredTierRamp: 2 }, 5)); // past the table -> ramp
  });
});

describe('invulnerable seats', () => {
  it('take no damage from a round they win, and are never knocked out', () => {
    const lobby = {
      version: 1, seed: 1, round: 1, encounters: [], finished: false,
      rules: { seatCount: 2, startingResolve: 30, startingArmor: 0, exhaustion: 'repeatFinal', maxRounds: 10 },
      seats: [
        { id: 's0', label: 'You', heroId: 'aster', kind: 'player', seed: 1, resolve: 30, armor: 0, alive: true },
        { id: 's1', label: 'Foe', heroId: 'aster', kind: 'authored', seed: 2, resolve: 1, armor: 0, alive: true,
          invulnerable: true, authoredBoards: [[{ attack: 1, health: 1 }]] },
      ],
    } as unknown as RunLobby;
    const playerWon = { result: 'win', playerDamage: 0, enemyDamage: 50 } as unknown as CombatResult;
    const out = settleRunLobbyRound(lobby, playerWon);
    expect(out.seats[1]).toMatchObject({ resolve: 1, alive: true });
    expect(out.encounters.at(-1)).toMatchObject({ damageToB: 0 });
  });
});

describe('opponent runes', () => {
  it('runeCombatModsFor turns a combat rune into its combat modifier', () => {
    expect(RUNE_INDEX['rune_adventuring']?.reward).toMatchObject({ kind: 'rallyRepeat', scope: 'always' });
    expect(runeCombatModsFor(['rune_adventuring']).rallyExtraAlways).toBe(1);
    expect(runeCombatModsFor([]).rallyExtraAlways).toBeUndefined();
  });

  it('runeCombatModsFor never throws on any rune, even duplicated (the scratch run has no board or shop turn)', () => {
    for (const r of RUNES) expect(() => runeCombatModsFor([r.id, r.id]), r.id).not.toThrow();
  });

  it('an authored seat fields its runes from their round on, stacking', () => {
    const seat = {
      id: 's1', label: 'Foe', heroId: 'aster', kind: 'authored' as const, seed: 2, resolve: 30, armor: 0, alive: true,
      authoredBoards: Array.from({ length: 10 }, () => [{ attack: 1, health: 1 }]),
      authoredRunes: [{ fromRound: 6, runeId: 'rune_adventuring' }, { fromRound: 9, runeId: 'rune_adventuring' }],
    };
    const d = authoredSeat(seat);
    expect(d.prepare(5)?.snapshot).toBeUndefined();
    expect(d.prepare(6)?.snapshot?.runes).toEqual(['rune_adventuring']);
    expect(d.prepare(6)?.snapshot?.questMods?.rallyExtraAlways).toBe(1);
    expect(d.prepare(9)?.snapshot?.runes).toEqual(['rune_adventuring', 'rune_adventuring']);
    expect(d.prepare(9)?.snapshot?.questMods?.rallyExtraAlways).toBe(2);
  });

  it('a rune-less authored seat prepares exactly the board it always did (no snapshot key)', () => {
    const seat = {
      id: 's1', label: 'Foe', heroId: 'aster', kind: 'authored' as const, seed: 2, resolve: 30, armor: 0, alive: true,
      authoredBoards: [[{ attack: 2, health: 3 }]],
    };
    expect(authoredSeat(seat).prepare(1)).toEqual({ minions: omenBoardMinions([{ attack: 2, health: 3 }]), tier: 1 });
    expect('snapshot' in authoredSeat(seat).prepare(1)!).toBe(false);
  });
});
