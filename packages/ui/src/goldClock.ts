/**
 * THE GOLD FUSE: a shop turn with NO clock until the player has spent a set amount of Gold in it
 * (`run.goldSpentThisTurn`), then a countdown. At 0 it behaves exactly like any other timeout (Recruit's `timeUp`
 * gates and the engine's R-TIMER-LOCK-01 `shopClockExpired` lock). The next turn waits again.
 *
 * Two configs (`goldClockOf`):
 *  - EVERY LOBBY AND PRACTICE (R-TIMER-FUSE-01, owner 2026-10-07: "every rank will have the gold fuse implemented. it
 *    will kick off the timer when 10 gold is spent" + "the round timer should follow the existing round by round time
 *    increase, not the 60/90 secnd timer"): the fuse's Gold, then that round's STANDARD turn length
 *    (`standardTurnSeconds`, the one schedule Recruit's normal clock uses too), times Practice's 1-4x choice. Ranked at
 *    every medal, unrated tables and Practice alike ("All lobbies, Gauntlet unchanged"). Early rounds usually never
 *    reach the threshold, so they usually have no clock at all ("Yes, early rounds untimed"). Practice on ∞ has no
 *    clock whatsoever (null here, and Recruit's infinite clock).
 *    THE THRESHOLD BY MEDAL (R-TIMER-FUSE-02, owner 2026-11-01: "Bronze = 10 gold, Silver = 10 gold, Gold = 7 gold,
 *    Platinum = 5 gold, Diamond = 5 gold, Ascendant = 3 gold"): a rated lobby's fuse reads the medal PINNED on the run
 *    when it started (`medalAtStart`, `FUSE_GOLD_BY_MEDAL`), so a promotion mid-game, Save & Quit, a cloud resume and
 *    a replay all keep the threshold the game started with. A run with no pinned medal (an unrated table, Practice, a
 *    run from before the pin) keeps `FUSE_GOLD` (10). The countdown's length does not change with the medal.
 *  - a GAUNTLET stage (R-GAUNTLET-04, owner 2026-09-29): 30 Gold, then 60 seconds, every round.
 * The tutorial (scripted, untimed), the sandbox and the legacy modes keep their own clocks (null).
 *
 * This replaced the Bronze-only fuse of 2026-10-06 (R-TIMER-BRONZE-01, 20 Gold then 60 / 90 s, also read off the
 * run's pinned `medalAtStart`). From 2026-10-07 to 2026-11-01 the clock ignored the medal entirely; since
 * R-TIMER-FUSE-02 it reads it again, for the threshold only. The pin also feeds telemetry (R-TELEMETRY-RANK-01).
 *
 * Presentation-only, like every shop clock: the engine is untimed. The rule is kept here, pure, so it is testable
 * without a DOM; Recruit wires it into the shared `turnClock` store:
 *  - each fuse turn OPENS at `GOLD_CLOCK_WAITING` (Recruit's `turnSeconds`), a value no real countdown reaches, and
 *    the tick is held (`turnClockMayTick`'s `clockWaiting`) so it stays parked there;
 *  - the moment the threshold is met, `goldTurnClock` moves the parked clock to the config's seconds and the tick
 *    starts.
 * Because "waiting" is encoded in the clock VALUE, Save & Quit needs nothing new: a turn quit while waiting saves
 * the parked value and resumes waiting; one quit mid-countdown saves (and resumes) its real seconds.
 */
import { lobbyIsUnrated, medalOf, rankAtStartOf, type PlayerProfile, type RankMedal, type RunState } from '@game/sim';
import { standardTurnSeconds } from './turnClock';

/** One gold-spend clock: the Gold spent in a turn that starts it, and the countdown it starts. */
export interface GoldClockConfig {
  readonly gold: number;
  readonly seconds: number;
}

/** The parked "no clock yet" value (the same effectively-infinite value the tutorial's clock uses). */
export const GOLD_CLOCK_WAITING = 99999;

/** The Gauntlet's clock (R-GAUNTLET-04). */
export const GAUNTLET_GOLD_CLOCK: GoldClockConfig = Object.freeze({ gold: 30, seconds: 60 });

/** The Gold spent in a turn that lights the fuse of every lobby with no pinned medal and of Practice (R-TIMER-FUSE-01). */
export const FUSE_GOLD = 10;

/** THE THRESHOLD BY MEDAL (R-TIMER-FUSE-02, owner 2026-11-01): the Gold that lights a rated lobby's fuse, read off
 *  the medal the run started at (`RunState.medalAtStart`). */
export const FUSE_GOLD_BY_MEDAL: Readonly<Record<RankMedal, number>> = Object.freeze({
  Bronze: 10, Silver: 10, Gold: 7, Platinum: 5, Diamond: 5, Ascendant: 3,
});

/** The Gold that lights this lobby's / Practice's fuse: the pinned medal's threshold, or `FUSE_GOLD` with none. Only a
 *  LOBBY reads the pin (Practice is never pinned, and would keep 10 if it ever were). An unknown medal string (a
 *  hand-edited or future save) falls back to 10 too. */
export function fuseGoldOf(run: Pick<RunState, 'mode' | 'medalAtStart'>): number {
  if (run.mode !== 'lobby' || !run.medalAtStart) return FUSE_GOLD;
  return FUSE_GOLD_BY_MEDAL[run.medalAtStart] ?? FUSE_GOLD;
}

export type GoldClockRun = Pick<RunState, 'mode' | 'sandbox' | 'wave' | 'medalAtStart'>;

/** Practice's 1-4x timer multiplier as it applies to this run's clock: the store's `practiceTimer` on a Practice run
 *  (0 = ∞), 1 on every other run (the multiplier is never consulted outside Practice, and never in the sandbox). */
export function practiceClockMult(run: Pick<RunState, 'mode' | 'sandbox'>, practiceTimer: number): number {
  return run.mode === 'practice' && !run.sandbox ? practiceTimer : 1;
}

/**
 * THE SHARED PREDICATE: this run's Gold Fuse for its CURRENT turn, or null when the run keeps a clock of its own
 * (standard or infinite). `practiceTimer` is the store's Practice timer choice (1-4, 0 = ∞); every caller passes it
 * so the fuse's countdown, the Thymepiece stamp and its readout all agree on the seconds.
 */
export function goldClockOf(run: GoldClockRun, practiceTimer: number): GoldClockConfig | null {
  if (run.sandbox) return null;
  if (run.mode === 'gauntlet') return GAUNTLET_GOLD_CLOCK;
  if (run.mode !== 'lobby' && run.mode !== 'practice') return null;
  const mult = practiceClockMult(run, practiceTimer);
  if (mult <= 0) return null; // Practice on ∞: no timer at all
  return { gold: fuseGoldOf(run), seconds: standardTurnSeconds(run.wave, mult) };
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
 * The clock READING that anything anchored to the turn clock should use (a Thymepiece sell window stamps it at
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
 * PIN the player's medal on a run as it starts. Called by the store where a RATED lobby is minted (`pickHero` /
 * `newRun`, beside `runId`), and nowhere else: the medal never changes afterwards, so Save & Quit, a cloud resume and
 * a rank change mid-game all keep the rank the game started at. It chooses the Gold Fuse's threshold
 * (R-TIMER-FUSE-02, `fuseGoldOf`); it once chose the retired Bronze shop clock. Only a rated lobby is stamped
 * (an unrated all-generated table, Practice, a Gauntlet stage, the tutorial and the sandbox are left alone). A
 * brand-new account's profile starts at Bronze I, so it is stamped Bronze. Mutates and returns `run`.
 *
 * The same call, under the same gate, pins the FULLER rank snapshot `run.rankAtStart` (medal, division, points,
 * rating, season; owner 2026-10-06, R-TELEMETRY-RANK-01) that the run's telemetry upload stamps into `derived`, so
 * the real Bronze top-4 rate can be measured.
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

/** The sandbox's untimed shop: the DEV Scene Builder under God rules, or a God Mode practice run (owner 2026-10-08,
 *  independent of the DEV rules preference). `goldClockOf` already returns null for every sandbox run. */
export function shopClockInfinite(run: { sandbox?: boolean | undefined; godMode?: true | undefined }, sbRules: 'god' | 'normal'): boolean {
  return run.sandbox === true && (sbRules === 'god' || run.godMode === true);
}
