import { describe, it, expect } from 'vitest';
import { badgeIdForCombatFlag } from '@game/content';
import { triggerCounts } from './triggerCounts';

/**
 * The stale-render guard, tested in isolation (owner report 2026-08-19: a rune-burst fired for every trigger
 * at the instant combat started). This is the pure half of `useCombatReplay`'s `triggeredQuests` memo — the
 * part that could never be exercised in the headless harness, because the Browser pane runs hidden and the
 * animated replay never advances `beatIdx` past 0.
 */

// A flag that really maps to a rune badge, so the counts are keyed exactly as the live memo keys them.
const FLAG = 'runeHatchery';
const BADGE = badgeIdForCombatFlag(FLAG)!;

const trig = (step: number) => ({ type: 'questTrigger' as const, flag: FLAG, side: 'player' as const, step });
// Two Hatchery triggers on the same step (two Void Cubs), plus a non-player one that must be ignored.
const EVENTS = [
  { type: 'attack' as const, step: 1 } as never,
  trig(3) as never,
  trig(3) as never,
  { type: 'questTrigger' as const, flag: FLAG, side: 'enemy' as const, step: 3 } as never,
];

describe('triggerCounts', () => {
  it('maps our test flag to a real badge id (guards a vacuous test)', () => {
    expect(BADGE).toBeTruthy();
  });

  it('returns EMPTY during the stale render, however far processedEnd reaches', () => {
    // The bug: on the stale render processedEnd falls back to events.length, which without the guard reports
    // the whole fight at once. The guard holds it empty until beatIdx is reset for this fight.
    expect(triggerCounts(EVENTS, EVENTS.length, true)).toEqual({});
  });

  it('reports NOTHING before the replay has processed any event', () => {
    expect(triggerCounts(EVENTS, 0, false)).toEqual({});
  });

  it('counts only triggers up to the current step, player side only', () => {
    // processedEnd at the last event → curStep = 3 → both player triggers counted, the enemy one ignored.
    expect(triggerCounts(EVENTS, EVENTS.length, false)).toEqual({ [BADGE]: 2 });
  });

  it('reveals triggers progressively as processedEnd advances', () => {
    // processedEnd = 1 → only the attack processed, curStep = 1 → no triggers yet.
    expect(triggerCounts(EVENTS, 1, false)).toEqual({});
    // processedEnd = 2 → first trigger processed, curStep = 3 → BOTH same-step triggers count (they share
    // step 3, and the memo counts every player trigger with step <= curStep).
    expect(triggerCounts(EVENTS, 2, false)).toEqual({ [BADGE]: 2 });
  });
});
