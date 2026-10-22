// @vitest-environment jsdom
/**
 * R-SKIP-TURBO-01 through the real replay hook: Skip (`turbo`) fast-forwards a fight to the end far sooner than
 * playing it out, lands its once-only callback, ignores a second press, and a zero-beat fight still finishes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { combatSide, makeRng, simulate, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mount, type Mounted } from './renderedText.mount';
import { useCombatReplay, type CombatReplay } from './useCombatReplay';
import { liveCombatSpeed } from './floatConfig';

let ui: Mounted | null = null;
let replay: CombatReplay | null = null;

const findEl = (): Element | null => null;

function Harness({ combat }: { combat: CombatResult }) {
  replay = useCombatReplay(combat, { active: true, findEl, combatSpeed: 1 });
  return null;
}

const ids = Object.keys(CARD_INDEX).filter((k) => !CARD_INDEX[k]!.spell && !CARD_INDEX[k]!.token).slice(0, 8);
const side = (from: number) => ids.slice(from, from + 4).map((cardId) => ({ cardId, attack: 2, health: 6 }));
const longFight = (): CombatResult => simulate(side(0), side(4), makeRng(7), CARD_INDEX, combatSide({ tier: 3 }), combatSide({ tier: 3 }));
const zeroBeat = (): CombatResult => simulate([], side(0), makeRng(1), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 3 }));

/** Advance fake time in small steps until `done` (effects schedule new timers as beats advance). */
let peak = 0;
const msToDone = (cap = 200_000): number => {
  let t = 0;
  peak = 0;
  while (!replay!.done && t < cap) { act(() => { vi.advanceTimersByTime(20); }); t += 20; peak = Math.max(peak, liveCombatSpeed()); }
  return t;
};

// jsdom's own animation frames run on the REAL clock, so the speed loop would see almost no time pass under fake
// timers. A 16ms frame on the fake clock stands in for the browser's.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => { ui?.unmount(); ui = null; replay = null; vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('R-SKIP-TURBO-01: Skip fast-forwards the replay', () => {
  it('finishes the fight far sooner than playing it out, and lands once', () => {
    ui = mount(<Harness combat={longFight()} />);
    const full = msToDone();
    expect(replay!.beatCount).toBeGreaterThan(8);

    ui.unmount();
    ui = mount(<Harness combat={longFight()} />);
    act(() => { vi.advanceTimersByTime(20); });
    let speedAtLanding = -1;
    const onLand = vi.fn(() => { speedAtLanding = liveCombatSpeed(); });
    act(() => { replay!.turbo(onLand); });
    expect(replay!.turboing).toBe(true);
    act(() => { replay!.turbo(onLand); }); // a second press is ignored
    const turbo = msToDone();
    expect(replay!.done).toBe(true);
    expect(turbo).toBeLessThan(full * 0.5);
    expect(onLand).toHaveBeenCalledTimes(1);
    expect(peak).toBeGreaterThan(15);           // it really races (20× by default)…
    expect(speedAtLanding).toBeCloseTo(1, 5);   // …and is back at the player's speed for the deciding hit
  });

  it('a zero-beat fight still finishes and lands', () => {
    ui = mount(<Harness combat={zeroBeat()} />);
    const onLand = vi.fn();
    act(() => { replay!.turbo(onLand); });
    msToDone();
    expect(replay!.done).toBe(true);
    expect(onLand).toHaveBeenCalledTimes(1);
  });
});
