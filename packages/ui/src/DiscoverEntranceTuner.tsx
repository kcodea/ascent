import { SPEC } from './discoverEntrance/discoverEntranceConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the Discover ENTRANCE (owner ask 2026-09-25): the option cards' float-in (stagger, duration,
 * direction, distance, settle), the golden dust and glints, the shimmer, and the four sound cues (open, whoosh,
 * arrive, sparkle), each with its clip, gain, offset, window and fade. ▶ Play opens a sample Discover of three cards
 * over the current screen. Production always plays the baked defaults.
 */
export function DiscoverEntranceTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
