/**
 * Bug 2026-09-28 (owner asked for the fix): "a lost fight that was already settled and is then reopened with
 * Continue never enables the End Combat button, so the run can't leave that screen."
 *
 * The run is saved with `combatSettled: true` after the loss lands. On Continue the combat screen re-mounts,
 * the replay plays again, and the hero-strike sequence early-returns on `combatSettled` (it must, or the blow
 * would play for damage already taken), so its phase never leaves `null`. The End Combat gate waited for
 * `'done'` on a loss, forever. These tests pin the gate, and prove leaving a restored settled fight applies
 * nothing a second time.
 */
import { describe, expect, it } from 'vitest';
import { createLobbyRun, reduce, type Action, type RunState } from '@game/sim';
import { endCombatReady, type EndCombatGateInput } from './endCombatGate';

const base: EndCombatGateInput = { replayDone: true, replayResult: 'lose', sandboxReplay: false, strikePhase: null, combatSettled: false };

/** Lose one fight with an empty board, and let the settle land (as the strike's impact does live). */
function loseAndSettle(s: RunState): RunState {
  s = { ...s, board: [] as never };
  s = reduce(s, { type: 'faceOmen' } as Action);
  expect(s.lastCombat?.result, 'an empty board loses').toBe('lose');
  return reduce(s, { type: 'settleCombat' } as Action);
}

/** What `ascent.save` does across a reload: the run survives as JSON. */
const reload = (s: RunState): RunState => JSON.parse(JSON.stringify(s)) as RunState;

describe('End Combat after Continue into an already-settled fight', () => {
  it('a restored, settled LOSS offers End Combat once the replay is done', () => {
    expect(endCombatReady({ ...base, combatSettled: true })).toBe(true);
  });

  it('the replay still has to finish first (reload during playback plays normally)', () => {
    expect(endCombatReady({ ...base, replayDone: false, combatSettled: true })).toBe(false);
    expect(endCombatReady({ ...base, replayDone: false })).toBe(false);
  });

  it('a LIVE loss still waits for the blow to land', () => {
    expect(endCombatReady(base), 'unsettled, the sequence is about to start').toBe(false);
    expect(endCombatReady({ ...base, strikePhase: 'blast' }), 'mid-strike').toBe(false);
    expect(endCombatReady({ ...base, strikePhase: 'blast', combatSettled: true }), 'impact settled, strike still drawing').toBe(false);
    expect(endCombatReady({ ...base, strikePhase: 'done', combatSettled: true })).toBe(true);
  });

  it('WIN, DRAW and a sandbox replay are ready as soon as the replay is done, settled or not', () => {
    for (const combatSettled of [false, true]) {
      expect(endCombatReady({ ...base, replayResult: 'win', combatSettled })).toBe(true);
      expect(endCombatReady({ ...base, replayResult: 'draw', combatSettled })).toBe(true);
      expect(endCombatReady({ ...base, sandboxReplay: true, combatSettled })).toBe(true);
    }
  });

  it('leaving a restored settled loss applies nothing twice (Resolve, Armor, seat health)', () => {
    let s = createLobbyRun(11, 'aster', {}, 'lobby');
    const before = s.resolve + s.armor;
    s = loseAndSettle(s);
    const afterSettle = { resolve: s.resolve, armor: s.armor };
    expect(afterSettle.resolve + afterSettle.armor).toBeLessThan(before);

    s = reload(s);
    expect(s.phase).toBe('combat');
    expect(s.combatSettled, 'the save carries the settled flag').toBe(true);
    // The gate the restored screen computes: strike never ran (null), replay replayed to its end.
    expect(endCombatReady({ ...base, replayResult: s.lastCombat!.result, combatSettled: s.combatSettled })).toBe(true);

    // A stray second settle (a remount racing the button) is a no-op.
    const again = reduce(s, { type: 'settleCombat' } as Action);
    expect({ resolve: again.resolve, armor: again.armor }).toEqual(afterSettle);

    s = reduce(s, { type: 'resolveCombat' } as Action);
    expect(s.phase, 'the run leaves the fight').not.toBe('combat');
    expect({ resolve: s.resolve, armor: s.armor }, 'no second charge').toEqual(afterSettle);
    expect(s.lobby!.seats[0]!.resolve + s.lobby!.seats[0]!.armor).toBe(afterSettle.resolve + afterSettle.armor);
  });

  it('a restored settled loss that ELIMINATES the player still leaves (to the end of the run), once', () => {
    let s = createLobbyRun(11, 'aster', {}, 'lobby');
    s = { ...s, resolve: 1, armor: 0 };
    s = { ...s, lobby: { ...s.lobby!, seats: s.lobby!.seats.map((seat, i) => (i === 0 ? { ...seat, resolve: 1, armor: 0 } : seat)) } };
    s = loseAndSettle(s);
    s = reload(s);
    expect(endCombatReady({ ...base, combatSettled: s.combatSettled })).toBe(true);
    s = reduce(s, { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('gameover');
    expect(s.lobby!.seats[0]!.alive).toBe(false);
    const placement = s.lobby!.seats[0]!.placement;
    expect(placement).toBeGreaterThan(0);
    // Pressing again is inert: the run is over and nothing re-applies.
    const again = reduce(s, { type: 'resolveCombat' } as Action);
    expect(again.lobby!.seats[0]!.placement).toBe(placement);
  });
});
