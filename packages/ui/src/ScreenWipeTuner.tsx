import { SPEC } from './screenWipeConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the combat <-> shop SCREEN WIPE (owner ask 2026-09-24: "make it smoother/wider/cleaner so that
 * there's no jank on an ultrawide"): durations, the bloom's easing (with its tail speed), the wide-screen ellipse
 * stretch, and the edge (ring position, width, brightness and the leading halo). ▶ Play runs the wipe over the
 * current screen. Production always plays the baked defaults.
 */
export function ScreenWipeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
