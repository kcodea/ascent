import { SPEC } from './healthPillConfig';
import { TunerPanel } from './TunerPanel';

export { SPEC } from './healthPillConfig';

/**
 * DEV-only switch for the HEALTH PILL look (Classic / Slate / Gem plate / Minimal). Covers your own Health pill,
 * the opponent's Health + Shop Tier pills in combat, and the Gauntlet foe's pills. Applies live.
 */
export function HealthPillTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
