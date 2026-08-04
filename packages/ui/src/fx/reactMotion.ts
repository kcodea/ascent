/**
 * The MOTION math behind the `react` primitive — pure, DOM-free, and therefore directly testable.
 *
 * Split out for the same reason `boardAnchors.ts` splits `anchorsFromRects` from the DOM read: this repo's
 * test runner has no jsdom, so anything that touches an element can only be verified by playing the game.
 * Keeping the arithmetic here means the part most likely to be subtly wrong — falloff, and the identity of
 * the resting keyframes — is covered by unit tests rather than by eye.
 */

/** Named eases, as CSS easing strings. A short list on purpose: these are the shapes a reaction wants —
 *  a snap out, a soft settle, and a back-overshoot for a pop that lands. */
export const EASES: Record<string, string> = {
  out: 'cubic-bezier(0.22, 1, 0.36, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  linear: 'linear',
  overshoot: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

export const EASE_IDS: readonly string[] = Object.keys(EASES);

/** What `keyframesFor` needs out of the primitive's params — named separately so this module doesn't have
 *  to import the param SPECS (which would make the dependency circular). */
export interface ReactMotion {
  /** Where in the hold the reaction peaks, 0..1. */
  peak: number;
  /** Peak scale. 1 = no size change. */
  scale: number;
  /**
   * Squash and stretch, -1..1. Positive squashes (wider and shorter — a landing, an impact absorbed),
   * negative stretches (taller and thinner — a lunge, a leap). Applied on top of `scale` as opposite
   * adjustments to X and Y, so it changes SHAPE where `scale` changes size. The classic animation channel,
   * and the one that reads as weight rather than as a highlight.
   */
  squash: number;
  /** Peak vertical shift in px. Negative lifts. */
  lift: number;
  /** Peak horizontal shift in px. Negative goes left. With `lift`, gives a directional recoil. */
  nudge: number;
  /** Peak rotation in degrees. */
  spin: number;
  /** How far opacity drops at the peak, 0..1. */
  dip: number;
  /**
   * Extra swings past the first, each reversing direction and weaker than the last. 0 is a single pop.
   *
   * This is the difference between "the card acknowledged something" and "the card was HIT": a shake reads
   * as an impact the unit is still recovering from, and no amount of tuning a one-way pop gets there.
   */
  shakes: number;
}

/**
 * Amplitude for the i-th recipient of n: 1 at the subject, falling to `1 - falloff` at the furthest.
 *
 * Linear rather than exponential on purpose — an author setting "0.5" should get a furthest unit at half
 * strength, not at some power of it. A lone recipient is always full strength: with n = 1 there is no
 * "furthest", and dividing by n-1 would be a divide by zero.
 */
export function amplitudeAt(i: number, n: number, falloff: number): number {
  return n <= 1 ? 1 : 1 - falloff * (i / (n - 1));
}

/**
 * The keyframes of one reaction, scaled by `amp` — three for a single pop, two more per extra swing.
 *
 * Both ends are IDENTITY, and that is load-bearing rather than tidy: these animations composite with `add`
 * (see `primitives/react.ts`), so an element outside the peak must compose to exactly itself. A non-identity
 * resting frame would permanently offset every card the effect ever touched.
 *
 * Opacity is a DELTA for the same reason — 0 means "no change" under additive composition, and the dip is
 * expressed as a negative number rather than an absolute opacity.
 *
 * **The ease belongs on the KEYFRAMES, never on the effect's timing.** A timing-level `easing` remaps the
 * whole iteration, so the keyframe offsets stop meaning what they say: measured in Chrome, an overshoot
 * curve put the playhead at progress 0.978 when the clock was at 0.35 — i.e. already in the tail, reading
 * ~3% of the intended peak. The reaction was very nearly invisible. Per-keyframe easing eases each SEGMENT
 * and leaves `peak` honest. A keyframe's easing applies to the interval that STARTS at it, so every frame
 * but the last carries the ease.
 */
export function keyframesFor(m: ReactMotion, amp: number, ease: string): Keyframe[] {
  const identity = 'translate(0px, 0px) scale(1, 1) rotate(0deg)';
  const swings = Math.max(0, Math.round(m.shakes));

  // Each swing is an extremum. The first sits at `peak`; the rest are spaced evenly through what remains,
  // alternating direction and decaying to nothing, so the card settles rather than stopping dead.
  const frames: Keyframe[] = [{ offset: 0, transform: identity, opacity: 0, easing: ease }];
  for (let k = 0; k <= swings; k++) {
    const offset = swings === 0 ? m.peak : m.peak + (1 - m.peak) * (k / (swings + 1));
    // Signed magnitude: alternating, and shrinking toward the settle.
    const mag = amp * (1 - k / (swings + 1)) * (k % 2 === 0 ? 1 : -1);
    // `scale` is a multiplier around 1, everything else is a delta around 0. A negative magnitude therefore
    // means "shrink" for scale and "the other way" for the shifts — which is exactly the swing back.
    const sx = 1 + (m.scale - 1) * mag + m.squash * mag;
    const sy = 1 + (m.scale - 1) * mag - m.squash * mag;
    frames.push({
      offset: Math.min(offset, 1),
      transform:
        `translate(${(m.nudge * mag).toFixed(2)}px, ${(m.lift * mag).toFixed(2)}px) ` +
        `scale(${sx.toFixed(3)}, ${sy.toFixed(3)}) ` +
        `rotate(${(m.spin * mag).toFixed(2)}deg)`,
      // Opacity only ever DIPS — a swing back that brightened the card past its own opacity would read as a
      // flash rather than as the same motion reversing.
      opacity: -(m.dip * amp * Math.abs(1 - k / (swings + 1))),
      easing: ease,
    });
  }
  frames.push({ offset: 1, transform: identity, opacity: 0 });
  return frames;
}
