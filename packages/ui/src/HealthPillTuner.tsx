import { SPEC } from './healthPillConfig';
import { TunerPanel } from './TunerPanel';

export { SPEC } from './healthPillConfig';

/**
 * DEV-only switch for the HUD PILL look (Classic / Slate / Gem plate / Minimal): every Health pill, the name and label
 * pills (Tier, Freeze), the turn timer and the combat controls. Production ships Gem plate. Applies live.
 */
export function HealthPillTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
