/**
 * `heroPowerLockTurns` — the ONE place the button, the tutorial coach and the reducer agree on whether a
 * recharge-locked hero power can actually be pressed.
 *
 * Why it exists (owner report 2026-08-21, "step 19 is hardlocked with the hero power use"): `RunState.heroReady`
 * re-arms on EVERY wave advance, but Aster's Preparation is really gated by `preparationLockUntil`. So on a
 * locked turn the flag said "ready", the button looked armed, clicking it silently no-opped in the reducer,
 * and the tutorial's "use your power" step — written to clear itself when the power is unavailable — waited
 * forever for a press that could never land.
 */
import { describe, expect, it } from 'vitest';
import { heroPowerLockTurns } from './heroes';

describe('heroPowerLockTurns', () => {
  it("reports Preparation's remaining lock, matching the reducer's `wave < preparationLockUntil` gate", () => {
    // Used on wave 1 → the reducer sets preparationLockUntil = wave + 2 = 3.
    expect(heroPowerLockTurns({ wave: 1, preparationLockUntil: 3 }, 'preparation')).toBe(2);
    expect(heroPowerLockTurns({ wave: 2, preparationLockUntil: 3 }, 'preparation')).toBe(1); // still locked
    expect(heroPowerLockTurns({ wave: 3, preparationLockUntil: 3 }, 'preparation')).toBe(0); // available again
    expect(heroPowerLockTurns({ wave: 4, preparationLockUntil: 3 }, 'preparation')).toBe(0);
  });

  it('is 0 before the power has ever been used (no lock recorded)', () => {
    expect(heroPowerLockTurns({ wave: 1 }, 'preparation')).toBe(0);
  });

  it("reports Gambler's dice lock from its own field", () => {
    expect(heroPowerLockTurns({ wave: 4, heroDiceLockUntil: 7 }, 'dice')).toBe(3);
    expect(heroPowerLockTurns({ wave: 7, heroDiceLockUntil: 7 }, 'dice')).toBe(0);
  });

  it('never returns a negative lock, whatever the wave', () => {
    expect(heroPowerLockTurns({ wave: 99, preparationLockUntil: 3 }, 'preparation')).toBe(0);
    expect(heroPowerLockTurns({ wave: 99, heroDiceLockUntil: 7 }, 'dice')).toBe(0);
  });

  it('leaves every other power unlocked — it must not gate powers that have no recharge', () => {
    for (const kind of ['preparation', 'dice'] as const) {
      expect(heroPowerLockTurns({ wave: 1 }, kind)).toBe(0);
    }
    // A power with no lock field of its own is always 0, even if a stale lock wave is present on the run.
    expect(heroPowerLockTurns({ wave: 1, preparationLockUntil: 99 }, 'gildcrafter')).toBe(0);
  });
});
