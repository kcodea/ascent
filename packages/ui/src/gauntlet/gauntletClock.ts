/**
 * THE GAUNTLET SHOP TIMER (Gauntlet spec §1): a Gauntlet round has NO clock until the player has spent
 * `GAUNTLET_CLOCK_GOLD` Gold in it (`run.goldSpentThisTurn`), then a `GAUNTLET_CLOCK_SECONDS` countdown. At 0 it
 * behaves exactly like the normal game's timeout (Recruit's existing `timeUp` gates). The next round waits again.
 *
 * Presentation-only, like every shop clock: the engine is untimed. The rule is kept here, pure, so it is testable
 * without a DOM; Recruit wires it into the shared `turnClock` store:
 *  - each Gauntlet turn OPENS at `GAUNTLET_CLOCK_WAITING` (Recruit's `turnSeconds`), a value no real countdown
 *    reaches, and the tick is held (`turnClockMayTick`'s `clockWaiting`) so it stays parked there;
 *  - the moment the threshold is met, `gauntletTurnClock` moves the parked clock to 60 and the tick starts.
 * Because "waiting" is encoded in the clock VALUE, Save & Quit needs nothing new: a turn quit while waiting saves
 * the parked value and resumes waiting; one quit mid-countdown saves (and resumes) its real seconds.
 */

/** Gold spent in the round that starts the clock. */
export const GAUNTLET_CLOCK_GOLD = 30;
/** The countdown, once started. */
export const GAUNTLET_CLOCK_SECONDS = 60;
/** The parked "no clock yet" value (the same effectively-infinite value the tutorial's clock uses). */
export const GAUNTLET_CLOCK_WAITING = 99999;

/** Whether this round's clock is running yet. */
export function gauntletClockState(goldSpentThisTurn: number): 'waiting' | 'running' {
  return goldSpentThisTurn >= GAUNTLET_CLOCK_GOLD ? 'running' : 'waiting';
}

/** Whether a clock reading is still the parked waiting value (for the timer plaque). The tick is held while
 *  parked, so the value stays exactly the sentinel until the countdown starts. */
export function gauntletClockWaiting(seconds: number): boolean {
  return seconds === GAUNTLET_CLOCK_WAITING;
}

/**
 * The clock READING that anything anchored to the turn clock should use (a Thymepiece discount window stamps it at
 * activation and its readout counts from it). A parked Gauntlet clock reads as the `GAUNTLET_CLOCK_SECONDS` it will
 * start from: anchored to the raw parked value, a window opened before 30 Gold is spent would expire on the first
 * tick after the jump to 60. The window is held while parked (the tick is), then gets its full length once the
 * countdown runs. Every other mode, and a running Gauntlet clock, reads raw.
 */
export function gauntletClockReading(mode: string | undefined, seconds: number): number {
  return mode === 'gauntlet' && gauntletClockWaiting(seconds) ? GAUNTLET_CLOCK_SECONDS : seconds;
}

/**
 * What to set the Gauntlet clock to now, or `null` to leave it alone. Only a clock still PARKED on the waiting
 * value is started, so a countdown already running (more Gold spent later, or seconds restored by Continue) is
 * never restarted.
 */
export function gauntletTurnClock(args: { goldSpent: number; current: number }): number | null {
  return gauntletClockState(args.goldSpent) === 'running' && gauntletClockWaiting(args.current)
    ? GAUNTLET_CLOCK_SECONDS
    : null;
}
