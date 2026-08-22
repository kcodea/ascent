import { SPEC } from './secondPowerConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for VOID'S SECOND POWER BUTTON seat (owner ask 2026-08-22). Three knobs — X / Y offset from
 * the hero panel and a uniform scale — rendered through the shared `TunerPanel`. Only visible in play once
 * Void's turn-4 ceremony has granted a second power; run Void (or devGrant into it) to see the block move.
 */
export function SecondPowerTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
