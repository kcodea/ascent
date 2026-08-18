import { SPEC } from './combatRampConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for the combat speed AUTO-RAMP curve — grace hold, ramp-up length, ceiling, and the
 * ease-down tail. Live while a fight plays with the auto-ramp toggle ON (Settings → Combat). Rendered
 * through the shared `TunerPanel` from `combatRampConfig`'s spec.
 */
export function CombatRampTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
