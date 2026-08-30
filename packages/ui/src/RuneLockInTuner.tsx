import { SPEC } from './runeLockInConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the RUNE LOCK-IN CEREMONY (owner ask 2026-08-29: *"add a tuner that allows me to adjust
 * timings of every aspect of this animation as well as the sound effect volume and timing"*).
 *
 * Grouped by the beats of the ceremony rather than by data type — **The slide**, **The others**, **The
 * lock**, **The exit**, **Sound** — because that is the order they happen in and the order you judge them
 * in. A flat list of eighteen millisecond dials would be technically complete and useless to tune against.
 *
 * The two ▶ actions matter as much as the dials: the ceremony is ~1.2 seconds and fires only when a rune is
 * actually bought, so without a replay you would be playing to a Runeforge wave for every adjustment. **slow
 * 6×** stretches only the TIMINGS — sizes and volume stay put, so what you watch is the same animation
 * slowly rather than a different one.
 */
export function RuneLockInTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
