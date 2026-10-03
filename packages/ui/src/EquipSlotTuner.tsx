import { SPEC } from './equipSlotConfig';
import { SPEC as LOOK_SPEC } from './equipLookConfig';
import { TunerPanel } from './TunerPanel';

/**
 * DEV-only tuner for the EQUIPMENT SLOT seat (owner ask 2026-08-28). X / Y offset from the hero panel plus a
 * uniform scale — its OWN seat, not an offset of the second power, so Void's two powers and Equipment can be
 * placed independently instead of colliding.
 *
 * The HOUSING switch rides alongside it (owner ask 2026-10-03): Classic (the bronze frame) against the three
 * CSS looks, so the before / after can be judged live on the same slot.
 *
 * Only visible in play once an Equip minion has granted something; play an Alchemist Frank (or drop one in
 * from the Scene Builder) to see the block move.
 */
export function EquipSlotTuner(): JSX.Element {
  return (
    <>
      <TunerPanel spec={LOOK_SPEC} />
      <TunerPanel spec={SPEC} />
    </>
  );
}
