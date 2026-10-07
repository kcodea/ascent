import { useSyncExternalStore } from 'react';

/**
 * The recruit-turn countdown, kept in a tiny external store INSTEAD of Recruit-local state.
 *
 * Why: `seconds` ticking once per second used to live in `useState` inside Recruit, so every tick
 * re-rendered the whole recruit tree — board + hand + shop (up to ~17 cards) — once per second. On a
 * heavy late-game board that's an ~8–17ms reconcile every second (doubled by StrictMode in dev): a
 * periodic frame-drop during play. Performance is the north star, so the clock is decoupled.
 *
 * Now only the components that actually display the time subscribe to `seconds` (the ShopTimer plaque + the
 * ChargeGlyph — both tiny), via `useTurnSeconds()`. Recruit subscribes only to the derived `timeUp` boolean
 * (`useTurnTimeUp()`), which changes once per turn — so the per-second tick never touches the cards.
 * The countdown loop in Recruit reads/writes this store directly (no React state, no re-render).
 */
let seconds = 0;
/**
 * WHERE THE CLOCK IS INSIDE ITS CURRENT SECOND, and whether it is moving (owner 2026-10-07, R-TIMER-SYNC-01: "we just
 * need to make sure it stops when the game is stopped in any way"). The countdown loop in Recruit is the only writer:
 * `startSecond` when it schedules a tick, `hold` when its effect is torn down (any pause gate closing, or a dep
 * change), `halt` at 0. Everything that must stay locked to the clock (the charge glyph's fill, its motes, the
 * charge-build sound) reads `running` + `secondProgress` from here instead of re-deriving a pause gate of its own,
 * so it can never disagree with the clock about whether time is passing.
 *
 * A hold KEEPS the part of the second already elapsed (`carry`) and the next `startSecond` resumes from it, so a
 * pause freezes the turn exactly and a resume picks up exactly. (Before, every pause restarted the second from
 * scratch, handing back up to a second per pause while the sound kept playing.) `set` drops the carry: a new value
 * written from outside the tick (a new turn, a resume, a Gold Fuse turn) starts its second fresh.
 */
let running = false;
let secondStartedAt = 0;
let secondMs = 1000;
let carry: { at: number; frac: number } | null = null;
const listeners = new Set<() => void>();
const emit = (): void => listeners.forEach((l) => l());
const setRunning = (v: boolean): void => {
  if (v !== running) {
    running = v;
    emit();
  }
};

export const turnClock = {
  get: (): number => seconds,
  set: (v: number): void => {
    carry = null;
    if (v !== seconds) {
      seconds = v;
      emit();
    }
  },
  /** Whether the countdown is ticking right now. False while held by any pause gate, and at 0. */
  isRunning: (): boolean => running,
  /** The countdown schedules its next tick: returns how long until it (a full period, less any held carry). */
  startSecond: (periodMs: number, now: number): number => {
    const frac = carry && carry.at === seconds ? carry.frac : 0;
    carry = null;
    secondMs = periodMs;
    secondStartedAt = now - frac * periodMs;
    setRunning(true);
    return periodMs * (1 - frac);
  },
  /** The countdown stopped mid-second: freeze, keeping what had elapsed of this second for the resume. */
  hold: (now: number): void => {
    if (!running) return;
    const frac = Math.max(0, Math.min(0.999, (now - secondStartedAt) / secondMs));
    carry = { at: seconds, frac };
    setRunning(false);
  },
  /** The countdown reached 0 (or was cut off with nothing to resume). */
  halt: (): void => {
    carry = null;
    setRunning(false);
  },
  /** How far (0..1) the clock is through its current second: live while running, frozen while held. */
  secondProgress: (now: number): number => {
    if (running) return Math.max(0, Math.min(1, (now - secondStartedAt) / secondMs));
    return carry && carry.at === seconds ? carry.frac : 0;
  },
  subscribe: (l: () => void): (() => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

/** Live remaining seconds — re-renders the caller each tick. Use only in the small timer-display components. */
export function useTurnSeconds(): number {
  return useSyncExternalStore(turnClock.subscribe, turnClock.get, turnClock.get);
}

/**
 * Seconds of the end-of-turn charge window already gone, read off the clock: the whole seconds ticked inside the
 * window plus how far the clock is into the current one (frozen while held). The charge glyph's fill is this over
 * the window and the charge-build sound starts this far into its clip, so the two cannot drift apart or away from
 * the clock (R-TIMER-SYNC-01). 0 before the window opens, `chargeWindow` at 0:00.
 */
export function chargeElapsed(chargeWindow: number, now: number): number {
  if (!(chargeWindow > 0)) return 0;
  const s = Math.max(0, turnClock.get());
  const within = s > 0 ? turnClock.secondProgress(now) : 0;
  return Math.max(0, Math.min(chargeWindow, chargeWindow - s + within));
}

/** Whether the countdown is ticking — re-renders the caller only when it flips (a hold, a resume, the end). */
export function useTurnClockRunning(): boolean {
  return useSyncExternalStore(turnClock.subscribe, turnClock.isRunning, turnClock.isRunning);
}

/** Test-only: reset the module state between specs. */
export function resetTurnClockForTests(): void {
  seconds = 0;
  running = false;
  secondStartedAt = 0;
  secondMs = 1000;
  carry = null;
}

/** Whether the turn timer has expired — a boolean, so a subscriber re-renders only when it FLIPS (once per
 *  turn), not every tick. This is what the recruit tree gates on. */
export function useTurnTimeUp(): boolean {
  return useSyncExternalStore(
    turnClock.subscribe,
    () => seconds <= 0,
    () => seconds <= 0,
  );
}

/**
 * What the turn clock should be set to when the recruit screen (re)opens a turn — the decision behind
 * Recruit's clock-reset effect, extracted so it can be tested without a DOM.
 *
 * `null` means LEAVE THE CLOCK ALONE, and that is the case bug 9fceed6b turned on (player, 2026-08-31:
 * *"timer from saving and quitting is not correct, it is restarting the timer from the beginning of the
 * round"*). Quitting at 0:08 and pressing Continue gave a full 0:20, because the effect ran twice: the first
 * pass applied the resumed 8 and consumed the one-shot, and the second — seeing no resume left — opened the
 * turn at full time.
 *
 * That became reachable when the board stopped being mounted behind the title (2026-08-30): Continue used to
 * be a re-render of a live component and is now a genuine MOUNT, which is where an effect is invoked twice.
 *
 * So the rule is remembered per WAVE rather than per run: once a wave's clock has been restored, this refuses
 * to re-open that same turn — and the moment the wave advances it stops matching, so the next turn opens at
 * full time like any other.
 */
export function turnClockReset(
  args: { resume: number | null; resumedWave: number | null; wave: number; turnSeconds: number },
): { set: number; consumeResume: boolean } | null {
  const { resume, resumedWave, wave, turnSeconds } = args;
  if (resume != null) return { set: resume, consumeResume: true };
  if (resumedWave === wave) return null; // already restored this turn — a second pass must not clobber it
  return { set: turnSeconds, consumeResume: false };
}

/**
 * Whether the recruit countdown may tick right now: the pause gate behind Recruit's countdown effect,
 * extracted so it can be tested without a DOM.
 *
 * It holds for every forced mid-turn decision (a Discover, quest / power / Runeforge offer, a battlecry aim,
 * a Choose One, a scouting reveal), while the hero picker or any full-screen overlay is open, and while the
 * "Good Luck" intro is playing (owner ask 2026-09-24: the clock begins only once the intro has faded, or the
 * player skipped it). A held clock is not reset, so the turn is never shortened by any of these.
 *
 * THE TURN STARTS AFTER THE RETURN AND ITS START OF TURN BEATS (owner 2026-09-27, R-SOT-TIMER-01: "the timer/turn
 * shouldnt start until after they complete. also, they need to wait until the transition back from combat
 * finishes."): the clock also holds while the combat<->shop curtain is up (`transitionPlaying`) and while the Shop is
 * still playing the turn's Start of Turn beats (`startOfTurnPlaying`, `sotBeats.ts`). A turn with no Start of Turn
 * effect has nothing to play, so its clock starts the moment the wipe comes to rest, with no added delay. Both are
 * optional so a caller that predates them (a test, a tool) keeps its old answer.
 *
 * THE ESC / SETTINGS MENU HOLDS IT TOO (owner 2026-09-29, R-TIMER-ESC-01: "yes, lets have it pause the shop timer
 * for now"): `settingsOpen` is its own input rather than part of `overlayOpen`, because `overlayOpen` also pauses
 * the combat replay and gates other board work, and the ruling covers only the Shop clock. Closing the menu
 * resumes from the displayed second (a held clock is never reset).
 *
 * A GAUNTLET round's clock has not started yet (`clockWaiting`, see `gauntlet/gauntletClock.ts`): it holds, parked on
 * its waiting value, until the player has spent 30 Gold in the round.
 */
export function turnClockMayTick(g: {
  recruitPhase: boolean;
  decisionOpen: boolean;
  heroSelecting: boolean;
  overlayOpen: boolean;
  introPlaying: boolean;
  transitionPlaying?: boolean;
  startOfTurnPlaying?: boolean;
  settingsOpen?: boolean;
  clockWaiting?: boolean;
}): boolean {
  return g.recruitPhase && !g.decisionOpen && !g.heroSelecting && !g.overlayOpen && !g.introPlaying
    && !g.transitionPlaying && !g.startOfTurnPlaying && !g.settingsOpen && !g.clockWaiting;
}
