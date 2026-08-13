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

/**
 * The player minion's stats as they FOUGHT (base 2/2 + the applied Fleeting Vigor).
 *
 * CHOREOGRAPHER PR 8: `initial` now holds the PRE-Start-of-Combat board, with the surge delivered by real
 * `buff` events, so the gain visibly lands instead of being true from frame one. The gameplay fact this test
 * protects is unchanged — it just has to fold the events the same way the replay does to read it.
 */
function combatStats(s: RunState): { attack: number; health: number } {
  const next = reduce(s, { type: 'faceOmen' } as never);
  const lc = next.lastCombat!;
  const me = lc.initial.player[0]!;
  let attack = me.attack;
  let health = me.health;
  // Only the OPENING block (narration + its buffs); later in-combat buffs hit the same minion.
  const end = lc.events.findIndex((e) => e.type !== 'sc' && e.type !== 'buff');
  for (const e of lc.events.slice(0, end === -1 ? lc.events.length : end)) {
    if (e.type === 'buff' && e.target === me.uid) { attack += e.attack; health += e.health; }
  }
  return { attack, health };
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
