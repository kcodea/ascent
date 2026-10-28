// @vitest-environment jsdom
/**
 * A NEW FIGHT IS NEVER "DONE" ON ITS FIRST FRAME (R-SKIP-DIAMOND-01, bug 2026-10-27).
 *
 * The replay hook persists across fights. Its beat index and Skip turbo reset DURING RENDER the moment a new
 * `combat` arrives, but its `finished` flag (what `done` reports) was only cleared by the `[combat]` effect, which
 * runs AFTER the commit. So the first committed frame of every new fight still said `done: true`, left over from
 * the previous fight. That opened the End Combat gate (`endCombatReady`) for that frame: the diamond showed
 * "End combat and go back to shop" (`.etbwrap.ready`) at the start of a fight, then flipped to Skip for the whole
 * replay. A press that landed on it was swallowed, and one that ran `endCombat` started the exit with the fight
 * not yet played (found by the perf gauntlet harness, which polls for exactly that moment).
 *
 * Pins: across a fight change, NO committed render pairs the new fight with `done: true`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useLayoutEffect } from 'react';
import { combatSide, makeRng, simulate, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mount, type Mounted } from './renderedText.mount';
import { useCombatReplay, type CombatReplay } from './useCombatReplay';

let ui: Mounted | null = null;
let replay: CombatReplay | null = null;
/** Every COMMITTED frame: which fight was on screen and what the hook reported. */
let commits: { combat: CombatResult; done: boolean; beatIdx: number }[] = [];

const findEl = (): Element | null => null;

function Harness({ combat }: { combat: CombatResult }) {
  const r = useCombatReplay(combat, { active: true, findEl, combatSpeed: 4 });
  replay = r;
  // A layout effect runs once per commit with THAT render's values: exactly what the screen showed.
  useLayoutEffect(() => { commits.push({ combat, done: r.done, beatIdx: r.beatIdx }); });
  return null;
}

const ids = Object.keys(CARD_INDEX).filter((k) => !CARD_INDEX[k]!.spell && !CARD_INDEX[k]!.token).slice(0, 4);
const fight = (seed: number): CombatResult => simulate(
  [{ cardId: ids[0]!, attack: 5, health: 5 }, { cardId: ids[1]!, attack: 4, health: 4 }],
  [{ cardId: ids[2]!, attack: 1, health: 1 }],
  makeRng(seed), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 1 }),
);

const run = (ms: number): void => { for (let t = 0; t < ms; t += 50) act(() => { vi.advanceTimersByTime(50); }); };

beforeEach(() => { vi.useFakeTimers(); commits = []; });
afterEach(() => { ui?.unmount(); ui = null; replay = null; vi.useRealTimers(); });

describe('combat replay: a new fight never inherits the last one\'s done', () => {
  it('the first committed frame of the next fight reports done: false', () => {
    const first = fight(1);
    ui = mount(<Harness combat={first} />);
    run(20000);
    expect(replay!.done).toBe(true); // the first fight played out

    const second = fight(2);
    expect(second.events.length).toBeGreaterThan(0);
    commits = [];
    ui.render(<Harness combat={second} />);
    const secondFrames = commits.filter((c) => c.combat === second);
    expect(secondFrames.length).toBeGreaterThan(0);
    expect(secondFrames.filter((c) => c.done)).toEqual([]);
    expect(secondFrames.every((c) => c.beatIdx === 0)).toBe(true);

    run(20000);
    expect(replay!.done).toBe(true); // and it still finishes normally
  });
});
