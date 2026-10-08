import { SPEC } from './runeforgeLookConfig';
import { TunerPanel } from './TunerPanel';

export { SPEC } from './runeforgeLookConfig';

/**
 * DEV-only tuner for the RUNEFORGE OVERLAY's LOOK: placement and size of the title plate, the Gold pill, the rune
 * tablet row (name size, cost coin), the Re-roll footer and the minimize toggle. Colours
 * come from the 🎨 UI Theme since the 2026-10-07 redesign. Applies live through `--rfl-*` vars on `:root`.
 */
export function RuneforgeLookTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
