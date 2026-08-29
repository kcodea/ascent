import { SPEC } from './equipSlotConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for the EQUIPMENT SLOT seat (owner ask 2026-08-28). X / Y offset from the hero panel plus a
 * uniform scale — its OWN seat, not an offset of the second power, so Void's two powers and Equipment can be
 * placed independently instead of colliding.
 *
 * Only visible in play once an Equip minion has granted something; play an Alchemist Frank (or drop one in
 * from the Scene Builder) to see the block move.
 */
export function EquipSlotTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
