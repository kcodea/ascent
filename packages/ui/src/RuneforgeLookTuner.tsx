import { SPEC } from './runeforgeLookConfig';
import { TunerPanel } from './TunerPanel';

export { SPEC } from './runeforgeLookConfig';

/**
 * DEV-only tuner for the RUNEFORGE OVERLAY's LOOK — the title plaque, the Gold pill, the rune-tablet row (name,
 * kicker, rules box, cost coin, sigil medallion), the Re-roll/Leave footer, the minimize toggle, and the Epic
 * variant's own colours. Its sibling 🪨 Runeforge Backdrop tuner owns the illustrated art behind the panel; this
 * one owns everything painted on it. Applies live through `--rfl-*` vars on `:root`.
 */
export function RuneforgeLookTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
