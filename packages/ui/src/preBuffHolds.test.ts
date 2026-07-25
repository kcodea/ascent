import { describe, it, expect } from 'vitest';
import type { CombatEvent } from '@game/core';
import { preBuffHolds } from './useCombatReplay';

/**
 * A buffed badge holds its PRE-buff number until the tendril lands, then ticks up. `preBuffHolds` computes that
 * held value for one beat.
 *
 * The bug this guards (owner screen capture 2026-07-25) was a TIMING mistake around this arithmetic, not the
 * arithmetic itself — the hold was installed after paint, so every buff showed the new value, snapped back, then
 * ticked up again. It's now installed in a layout effect. Keeping the maths under test matters because a wrong
 * held value is silent on screen: the badge just lands on a plausible-looking number that was never real.
 */
const unit = (uid: string, attack: number, health: number) =>
  ({ uid, cardId: 'x', name: 'X', tribe: 'beast' as const, attack, health, keywords: [], alive: true });

const buff = (target: string, source: string, attack: number, health: number): CombatEvent =>
  ({ type: 'buff', target, source, attack, health, step: 1 } as CombatEvent);

const frameOf = (player: ReturnType<typeof unit>[], enemy: ReturnType<typeof unit>[] = []) =>
  ({ player, enemy } as Parameters<typeof preBuffHolds>[2]);

describe('preBuffHolds', () => {
  it('subtracts the beat’s grant to give the pre-buff value', () => {
    const events = [buff('m1', 'm0', 24, 0)];
    const holds = preBuffHolds({ start: 0, end: 1 }, events, frameOf([unit('m1', 49, 3)]));
    expect(holds.get('m1')).toEqual({ atk: 25, hp: 3 }); // 49 post-buff − 24 granted
  });

  it('sums EVERY buff to the same target in the beat', () => {
    // A target can take an incoming tendril and a self-buff in one beat. Subtracting only one would leave the
    // badge on a number that was never real — this is the case the old per-path installs got inconsistent.
    const events = [buff('m1', 'm0', 24, 0), buff('m1', 'm1', 3, 3)];
    const holds = preBuffHolds({ start: 0, end: 2 }, events, frameOf([unit('m1', 52, 6)]));
    expect(holds.get('m1')).toEqual({ atk: 25, hp: 3 }); // 52 − 27 atk, 6 − 3 hp
  });

  it('only counts buffs INSIDE the beat window', () => {
    const events = [buff('m1', 'm0', 100, 0), buff('m1', 'm0', 24, 0)];
    // Beat covers just the second event; the first belongs to an earlier beat and is already baked into `frame`.
    const holds = preBuffHolds({ start: 1, end: 2 }, events, frameOf([unit('m1', 149, 3)]));
    expect(holds.get('m1')).toEqual({ atk: 125, hp: 3 });
  });

  it('holds enemy units too', () => {
    const holds = preBuffHolds({ start: 0, end: 1 }, [buff('e0', 'e1', 5, 5)], frameOf([], [unit('e0', 9, 9)]));
    expect(holds.get('e0')).toEqual({ atk: 4, hp: 4 });
  });

  it('skips a zero-magnitude buff — nothing to tick, so nothing to hold', () => {
    const holds = preBuffHolds({ start: 0, end: 1 }, [buff('m1', 'm0', 0, 0)], frameOf([unit('m1', 5, 5)]));
    expect(holds.has('m1')).toBe(false);
  });

  it('skips a target that is not on the board this frame', () => {
    // A minion buffed and then killed inside the same beat has no frame entry; holding it would invent a value.
    const holds = preBuffHolds({ start: 0, end: 1 }, [buff('gone', 'm0', 4, 0)], frameOf([unit('m1', 5, 5)]));
    expect(holds.size).toBe(0);
  });

  it('ignores non-buff events in the window', () => {
    const events = [{ type: 'attack', source: 'm0', target: 'e0', step: 1 } as CombatEvent, buff('m1', 'm0', 6, 0)];
    const holds = preBuffHolds({ start: 0, end: 2 }, events, frameOf([unit('m1', 10, 4)]));
    expect(holds.get('m1')).toEqual({ atk: 4, hp: 4 });
    expect(holds.size).toBe(1);
  });
});
