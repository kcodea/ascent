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
  /** Peak vertical shift in px. Negative lifts. */
  lift: number;
  /** Peak rotation in degrees. */
  spin: number;
  /** How far opacity drops at the peak, 0..1. */
  dip: number;
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
 * The three keyframes of one reaction, scaled by `amp`.
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
 * and leaves `peak` honest. A keyframe's easing applies to the interval that STARTS at it, so the ease is
 * set on the first two frames and the last one carries none.
 */
export function keyframesFor(m: ReactMotion, amp: number, ease: string): Keyframe[] {
  const toward = (v: number, base: number): number => base + (v - base) * amp;
  const identity = 'translateY(0px) scale(1) rotate(0deg)';
  const peak =
    `translateY(${(m.lift * amp).toFixed(2)}px) ` +
    `scale(${toward(m.scale, 1).toFixed(3)}) ` +
    `rotate(${(m.spin * amp).toFixed(2)}deg)`;
  return [
    { offset: 0, transform: identity, opacity: 0, easing: ease },
    { offset: m.peak, transform: peak, opacity: -(m.dip * amp), easing: ease },
    { offset: 1, transform: identity, opacity: 0 },
  ];
}
