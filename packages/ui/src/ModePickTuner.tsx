import { MODEPICK_VARS, defaultModePick, getModePick, resetModePick, setModePickValue, type ModePickConfig } from './modePickConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only Play-Screen Tuner — live pan + zoom of the art inside each mode tile on the MODE picker (the tiles
 * themselves are a fixed grid since the WS-2 redesign, 2026-10-16). Values drive `--mp-*` custom properties on `:root`, persist to localStorage, and apply at
 * boot — all dev-gated, so production always runs the shipped layout. Mounted straight into the picker (dev
 * only), so it floats over the cards it edits with no DevMenu round-trip.
 *
 * `def`s in `MODEPICK_VARS` are the SHIPPED values (not no-ops), so the revert dots are load-bearing.
 */
const controls: TunerControl<string>[] = MODEPICK_VARS.map((v) => ({
  key: v.key,
  label: v.label,
  unit: v.fmt === 'px' ? ('px' as const) : ('×' as const),
  group: v.group,
  min: v.min,
  max: v.max,
  step: v.step,
}));

export const SPEC: TunerSpec<ModePickConfig> = {
  id: 'modepick',            // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Play Mode Screen Tuner',
  note: 'dev · tile art pan + zoom',
  read: getModePick,
  write: setModePickValue,
  reset: resetModePick,
  defaults: defaultModePick(),
  controls,
};

export function ModePickTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
