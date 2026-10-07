/**
 * THE GAUNTLET SHOP TIMER (Gauntlet spec §1, R-GAUNTLET-04): a Gauntlet round has NO clock until the player has
 * spent `GAUNTLET_CLOCK_GOLD` Gold in it (`run.goldSpentThisTurn`), then a `GAUNTLET_CLOCK_SECONDS` countdown.
 *
 * This is one config of the shared GOLD FUSE (`../goldClock.ts`), which every lobby and Practice use too since
 * 2026-10-07 (R-TIMER-FUSE-01: 10 Gold, then the round's standard seconds). Recruit, the store and the Thymepiece
 * readout all go through `goldClockOf`;
 * this file keeps the Gauntlet's own numbers and helpers, delegating to the shared ones, so the Gauntlet's clock
 * stays pinned on its own terms.
 */
import { GAUNTLET_GOLD_CLOCK, GOLD_CLOCK_WAITING, goldClockReading, goldClockState, goldClockWaiting, goldTurnClock } from '../goldClock';

/** Gold spent in the round that starts the clock. */
export const GAUNTLET_CLOCK_GOLD = GAUNTLET_GOLD_CLOCK.gold;
/** The countdown, once started. */
export const GAUNTLET_CLOCK_SECONDS = GAUNTLET_GOLD_CLOCK.seconds;
/** The parked "no clock yet" value (the same effectively-infinite value the tutorial's clock uses). */
export const GAUNTLET_CLOCK_WAITING = GOLD_CLOCK_WAITING;

/** Whether this round's clock is running yet. */
export function gauntletClockState(goldSpentThisTurn: number): 'waiting' | 'running' {
  return goldClockState(GAUNTLET_GOLD_CLOCK, goldSpentThisTurn);
}

/** Whether a clock reading is still the parked waiting value. */
export function gauntletClockWaiting(seconds: number): boolean {
  return goldClockWaiting(seconds);
}

/** The clock READING for a mode (see `goldClockReading`): a parked Gauntlet clock reads as the 60 it starts from;
 *  every other mode reads raw HERE (a lobby's or Practice's reading needs its run: use
 *  `goldClockReading(goldClockOf(run, practiceTimer), …)`). */
export function gauntletClockReading(mode: string | undefined, seconds: number): number {
  return goldClockReading(mode === 'gauntlet' ? GAUNTLET_GOLD_CLOCK : null, seconds);
}

/** What to set the Gauntlet clock to now, or `null` to leave it alone (see `goldTurnClock`). */
export function gauntletTurnClock(args: { goldSpent: number; current: number }): number | null {
  return goldTurnClock({ clock: GAUNTLET_GOLD_CLOCK, goldSpent: args.goldSpent, current: args.current });
}
