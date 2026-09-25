// @vitest-environment jsdom
/**
 * WATCH REPLAY / SKIP ALWAYS FINISH (owner report 2026-09-24: "the watch replay gets me stuck in a screen here").
 *
 * An empty player board vs a full enemy board resolves with ZERO events, so the replay has zero beats. The
 * final-hold timer that flips `done` only re-armed when `replayComplete` flipped false→true, which a zero-beat
 * fight never does: a rewatch (`seekTo(0)`) cleared `done` and nothing set it again, and Skip was a no-op too.
 * Pins: the zero-beat fight reaches `done`; a rewatch of it reaches `done` again; Skip mid-rewatch reaches
 * `done`; and a normal fight's rewatch plays to the end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { combatSide, makeRng, simulate, type CombatResult } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { mount, type Mounted } from './renderedText.mount';
import { useCombatReplay, type CombatReplay } from './useCombatReplay';

let ui: Mounted | null = null;
let replay: CombatReplay | null = null;

const findEl = (): Element | null => null; // stable identity, like Recruit's

function Harness({ combat }: { combat: CombatResult }) {
  replay = useCombatReplay(combat, { active: true, findEl, combatSpeed: 4 });
  return null;
}

const foes = Object.keys(CARD_INDEX).filter((k) => !CARD_INDEX[k]!.spell && !CARD_INDEX[k]!.token).slice(0, 4)
  .map((cardId) => ({ cardId, attack: 3, health: 3 }));
const emptyVsFour = (): CombatResult => simulate([], foes, makeRng(1), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 3 }));
const oneVsOne = (): CombatResult => simulate([{ cardId: foes[0]!.cardId, attack: 5, health: 5 }], [{ cardId: foes[1]!.cardId, attack: 1, health: 1 }],
  makeRng(2), CARD_INDEX, combatSide({ tier: 1 }), combatSide({ tier: 1 }));

/** Advance fake time in small steps (effects schedule new timers as beats advance). */
const run = (ms: number): void => { for (let t = 0; t < ms; t += 50) act(() => { vi.advanceTimersByTime(50); }); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { ui?.unmount(); ui = null; replay = null; vi.useRealTimers(); });

describe('combat replay: rewatch + Skip always finish', () => {
  it('an empty player board resolves with zero events (the enemy just wins)', () => {
    const c = emptyVsFour();
    expect(c.events).toEqual([]);
    expect(c.result).toBe('lose');
  });

  it('a zero-beat fight reaches done, and so does its rewatch and a Skip during it', () => {
    ui = mount(<Harness combat={emptyVsFour()} />);
    run(5000);
    expect(replay!.done).toBe(true);
    expect(replay!.beatCount).toBe(0);

    act(() => { replay!.seekTo(0); });           // Watch replay
    expect(replay!.done).toBe(false);
    run(5000);
    expect(replay!.done).toBe(true);             // used to hang here forever

    act(() => { replay!.seekTo(0); });
    act(() => { replay!.skip(); });              // Skip mid-rewatch
    run(5000);
    expect(replay!.done).toBe(true);
  });

  it('a normal fight rewatches to the end', () => {
    ui = mount(<Harness combat={oneVsOne()} />);
    run(20000);
    expect(replay!.done).toBe(true);
    expect(replay!.beatCount).toBeGreaterThan(0);
    act(() => { replay!.seekTo(0); });
    expect(replay!.done).toBe(false);
    run(20000);
    expect(replay!.done).toBe(true);
  });
});
