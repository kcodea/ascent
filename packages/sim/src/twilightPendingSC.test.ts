import { describe, it, expect } from 'vitest';
import { createRun, reduce, type RunState } from './index';

/**
 * BUG FIX (owner report 2026-08-12): Rune of Twilight ("your Start-of-Combat effects trigger an additional
 * time") did NOT double Fleeting Vigor's Start-of-Combat buff, because that buff is pre-baked into the combat
 * board at faceOmen — before the simulator's Start-of-Combat pass where Twilight does its doubling. Fixed by
 * applying the extra trigger at the pre-bake site (×2 when Twilight is armed).
 */
function eot(over: Partial<RunState> = {}): RunState {
  return {
    ...createRun(3, 'warden'),
    phase: 'recruit',
    board: [{ uid: 'b1', cardId: 'stray', tribe: 'beast', attack: 2, health: 2, keywords: [], golden: false }],
    fleetingVigor: { attack: 2, health: 1 },
    ...over,
  } as RunState;
}

/** The player minion's stats as they entered combat (base 2/2 + the applied Fleeting Vigor). */
function combatStats(s: RunState): { attack: number; health: number } {
  const next = reduce(s, { type: 'faceOmen' } as never);
  const me = next.lastCombat!.initial.player[0]!;
  return { attack: me.attack, health: me.health };
}

describe('Rune of Twilight doubles pending Start-of-Combat effects', () => {
  it('without Twilight, Fleeting Vigor applies once (+2/+1 → 4/3)', () => {
    expect(combatStats(eot())).toEqual({ attack: 4, health: 3 });
  });

  it('with Twilight, Fleeting Vigor applies TWICE (+4/+2 → 6/4)', () => {
    const s = eot({ questFlags: { runeTwilight: true } as RunState['questFlags'] });
    expect(combatStats(s)).toEqual({ attack: 6, health: 4 });
  });
});
