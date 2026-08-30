/**
 * RUNE LOCK-IN CEREMONY — the one timing object.
 *
 * Owner ask (2026-08-29): *"an animation similar to the hero ceremony for when a player locks in a rune
 * selection. i want the runes to disappear, and the selected rune to move front and center, and 'lock in'
 * then fade back to the normal game board. a quick animation that simply tells the player that they locked in
 * this choice. no additional clicks needed."*
 *
 * Shaped like `heroCeremonyTiming.ts` deliberately — every delay and duration lives here, no magic
 * milliseconds distributed across the component — but it is a much SHORTER ceremony, and that difference is
 * the whole design brief:
 *
 * · The hero ceremony ends on a **Start Game** button. It is a threshold: you are choosing who you will be
 *   for the next half hour, and it is allowed to take its time.
 * · This one ends **on its own**. It happens mid-run, possibly several times, and its entire job is to say
 *   *"that one, yes, it's yours"* and get out of the way. Anything a player would want to skip is too long —
 *   so the whole thing is under a second and a half, and there is nothing to click.
 *
 * All values are measured FROM THE BUY CLICK.
 */
export interface RuneLockInTiming {
  /** The chosen card's press-into-the-surface acknowledgment — the click landing. */
  pressMs: number;
  /** The unchosen runes begin leaving. */
  exitDelayMs: number;
  /** One unchosen rune's exit duration. */
  exitMs: number;
  /** Per-card stagger between the unchosen exits, so they read as a sweep rather than a blink. */
  exitStaggerMs: number;
  /** The chosen rune starts travelling to centre. */
  focusDelayMs: number;
  /** Travel + grow duration (into a slight overshoot). */
  focusMs: number;
  /** Overshoot → settle. The snap that reads as the lock engaging. */
  settleMs: number;
  /**
   * The settle fires — the snap that reads as the lock engaging.
   *
   * There used to be a LOCKED IN caption on this beat; the owner cut it (2026-08-29). The beat itself stays,
   * because it was never the words doing the work: the card arriving hard, after an overshoot, is what says
   * "that is decided". The caption was narrating something the motion already said.
   */
  lockAtMs: number;
  /**
   * How long the gold clamp takes to close onto the rune (owner ask 2026-08-29: *"a rectangle gold glow that
   * closes in quickly on the rune and then a flash emits"*).
   *
   * It LANDS on `lockAtMs` — the clamp starts at `lockAtMs - clampMs` so its arrival and the settle snap are
   * the same instant. That coincidence is the effect: the frame slamming shut is what the card's snap is
   * reacting to, and separating them by even 60ms reads as two events instead of one.
   */
  clampMs: number;
  /** The flash bursting outward from the rune, fired the moment the clamp lands. */
  flashMs: number;
  /** How long the whole tableau holds before it leaves. */
  holdMs: number;
  /** Everything fades back to the board. */
  fadeMs: number;
}

/**
 * Defaults. The sequence: click (0) → others sweep out (90) → the chosen one flies to centre (170) → it
 * settles with a snap (~560) → the lock beat lands (620) → a beat to register it → fade (1100–1360).
 *
 * ~1.36s end to end. Long enough to register as a moment; short enough that the second time you see it you
 * are not waiting for it.
 */
export const RUNE_LOCKIN_DEFAULTS: RuneLockInTiming = {
  pressMs: 90,
  exitDelayMs: 90,
  exitMs: 260,
  exitStaggerMs: 45,
  focusDelayMs: 170,
  focusMs: 390,
  settleMs: 130,
  lockAtMs: 620,
  clampMs: 260,
  flashMs: 460,
  holdMs: 1100,
  fadeMs: 260,
};

/** When the ceremony is completely finished — the moment the caller may unmount it. */
export const lockInTotalMs = (t: RuneLockInTiming): number => t.holdMs + t.fadeMs;

/**
 * Slow the whole ceremony by `factor`, preserving the RATIOS between its beats.
 *
 * Dev-only, for watching a 1.4-second sequence closely enough to judge it — every value scales, so what you
 * see at 5× is the same choreography, not a different one with different overlaps. The shipped ceremony
 * always plays the defaults.
 */
export const stretchLockIn = (t: RuneLockInTiming, factor: number): RuneLockInTiming =>
  Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * factor)])) as unknown as RuneLockInTiming;
