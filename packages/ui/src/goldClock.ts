/**
 * THE GOLD-SPEND SHOP CLOCK: a shop turn with NO clock until the player has spent a set amount of Gold in it
 * (`run.goldSpentThisTurn`), then a countdown. At 0 it behaves exactly like the normal game's timeout (Recruit's
 * existing `timeUp` gates and the engine's R-TIMER-LOCK-01 `shopClockExpired` lock). The next turn waits again.
 *
 * Two kinds of run use it, each with its own config (`goldClockOf`):
 *  - a GAUNTLET stage (R-GAUNTLET-04, owner 2026-09-29): 30 Gold, then 60 seconds;
 *  - a RATED lobby started in BRONZE (R-TIMER-BRONZE-01, owner 2026-10-06: "i want to make that the experience for
 *    all players who are bronze ranked"): 20 Gold, then 60 seconds on turns 1-8 and 90 seconds from turn 9 ("can
 *    we up it to a 90 second timer on turns 9+?"). "Bronze" is the medal PINNED on the run when it started
 *    (`run.medalAtStart`, stamped by the store beside `runId`), so a game started in Bronze keeps this clock to the
 *    end, through Save & Quit and cloud resume. Silver and above, unrated lobbies, Practice, the tutorial and every
 *    other mode keep the standard clock.
 *
 * Presentation-only, like every shop clock: the engine is untimed. The rule is kept here, pure, so it is testable
 * without a DOM; Recruit wires it into the shared `turnClock` store:
 *  - each gold-clock turn OPENS at `GOLD_CLOCK_WAITING` (Recruit's `turnSeconds`), a value no real countdown
 *    reaches, and the tick is held (`turnClockMayTick`'s `clockWaiting`) so it stays parked there;
 *  - the moment the threshold is met, `goldTurnClock` moves the parked clock to the config's seconds and the tick
 *    starts.
 * Because "waiting" is encoded in the clock VALUE, Save & Quit needs nothing new: a turn quit while waiting saves
 * the parked value and resumes waiting; one quit mid-countdown saves (and resumes) its real seconds.
 */
import { lobbyIsUnrated, medalOf, rankAtStartOf, type PlayerProfile, type RunState } from '@game/sim';

/** One gold-spend clock: the Gold spent in a turn that starts it, and the countdown it starts. */
export interface GoldClockConfig {
  readonly gold: number;
  readonly seconds: number;
}

/** The parked "no clock yet" value (the same effectively-infinite value the tutorial's clock uses). */
export const GOLD_CLOCK_WAITING = 99999;

/** The Gauntlet's clock (R-GAUNTLET-04). */
export const GAUNTLET_GOLD_CLOCK: GoldClockConfig = Object.freeze({ gold: 30, seconds: 60 });

/** The Bronze ranked clock (R-TIMER-BRONZE-01): Gold spent that starts it… */
export const BRONZE_CLOCK_GOLD = 20;
/** …the countdown on turns 1 to `BRONZE_CLOCK_LATE_WAVE - 1`… */
export const BRONZE_CLOCK_SECONDS = 60;
/** …and from `BRONZE_CLOCK_LATE_WAVE` on (owner 2026-10-06: "can we up it to a 90 second timer on turns 9+?"). */
export const BRONZE_CLOCK_LATE_SECONDS = 90;
export const BRONZE_CLOCK_LATE_WAVE = 9;

export type GoldClockRun = Pick<RunState, 'mode' | 'sandbox' | 'lobby' | 'medalAtStart' | 'wave'>;

/** Does this run get the Bronze ranked clock? A plain RATED lobby (not Practice, not a sandbox, not an unrated
 *  all-generated table, R-LOBBY-06) whose pinned starting medal is Bronze. */
export function isBronzeClockRun(run: GoldClockRun): boolean {
  return run.mode === 'lobby' && !run.sandbox && run.medalAtStart === 'Bronze' && !(run.lobby && lobbyIsUnrated(run.lobby));
}

/** The Bronze clock's countdown length on a turn. */
export function bronzeClockSeconds(wave: number): number {
  return wave >= BRONZE_CLOCK_LATE_WAVE ? BRONZE_CLOCK_LATE_SECONDS : BRONZE_CLOCK_SECONDS;
}

/** THE SHARED PREDICATE: this run's gold-spend clock for its CURRENT turn, or null for the standard clock. */
export function goldClockOf(run: GoldClockRun): GoldClockConfig | null {
  if (run.mode === 'gauntlet') return GAUNTLET_GOLD_CLOCK;
  if (isBronzeClockRun(run)) return { gold: BRONZE_CLOCK_GOLD, seconds: bronzeClockSeconds(run.wave) };
  return null;
}

/** Whether this turn's clock is running yet. */
export function goldClockState(clock: Pick<GoldClockConfig, 'gold'>, goldSpentThisTurn: number): 'waiting' | 'running' {
  return goldSpentThisTurn >= clock.gold ? 'running' : 'waiting';
}

/** Whether a clock reading is still the parked waiting value (for the timer plaque). The tick is held while
 *  parked, so the value stays exactly the sentinel until the countdown starts. */
export function goldClockWaiting(seconds: number): boolean {
  return seconds === GOLD_CLOCK_WAITING;
}

/**
 * The clock READING that anything anchored to the turn clock should use (a Thymepiece discount window stamps it at
 * activation and its readout counts from it). A parked gold clock reads as the seconds it will start from: anchored
 * to the raw parked value, a window opened before the threshold is met would expire on the first tick after the
 * jump. The window is held while parked (the tick is), then gets its full length once the countdown runs. A run
 * with no gold clock, and a running gold clock, read raw.
 */
export function goldClockReading(clock: Pick<GoldClockConfig, 'seconds'> | null, seconds: number): number {
  return clock && goldClockWaiting(seconds) ? clock.seconds : seconds;
}

/**
 * What to set the clock to now, or `null` to leave it alone. Only a clock still PARKED on the waiting value is
 * started, so a countdown already running (more Gold spent later, or seconds restored by Continue) is never
 * restarted.
 */
export function goldTurnClock(args: { clock: GoldClockConfig; goldSpent: number; current: number }): number | null {
  return goldClockState(args.clock, args.goldSpent) === 'running' && goldClockWaiting(args.current)
    ? args.clock.seconds
    : null;
}

/**
 * PIN the player's medal on a run as it starts (R-TIMER-BRONZE-01). Called by the store where a RATED lobby is minted
 * (`pickHero` / `newRun`, beside `runId`), and nowhere else: the medal never changes afterwards, so Save & Quit, a
 * cloud resume and a rank change mid-game all keep the clock the game started with. Only a rated lobby is stamped
 * (an unrated all-generated table, Practice, a Gauntlet stage, the tutorial and the sandbox are left alone). A
 * brand-new account's profile starts at Bronze I, so it is stamped Bronze. Mutates and returns `run`.
 *
 * The same call, under the same gate, pins the FULLER rank snapshot `run.rankAtStart` (medal, division, points,
 * rating, season; owner 2026-10-06, R-TELEMETRY-RANK-01) that the run's telemetry upload stamps into `derived`, so
 * the real Bronze top-4 rate can be measured. One pin point means the clock and the telemetry can never disagree on
 * the rank a game started at.
 */
export function pinMedalAtStart<R extends Pick<RunState, 'mode' | 'sandbox' | 'lobby' | 'medalAtStart' | 'rankAtStart'>>(
  run: R,
  profile: Pick<PlayerProfile, 'rank'> | null | undefined,
): R {
  const rank = profile?.rank;
  const division = rank?.position?.divisionIndex;
  if (run.mode !== 'lobby' || run.sandbox || !run.lobby || lobbyIsUnrated(run.lobby) || !rank || typeof division !== 'number') return run;
  run.medalAtStart = medalOf(division);
  run.rankAtStart = rankAtStartOf(rank);
  return run;
}
