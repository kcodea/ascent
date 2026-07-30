import { FRZ_DEFAULTS, FRZ_NUM_KEYS, FRZ_RANGES, getFreezeConfig, resetFreezeConfig, setFreezeValue, type FreezeConfig } from './freezeConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the FREEZE button's placement. Position and scale only, on purpose: the freeze ART is not
 * in yet, so glow / sheen / press dials would have nothing to act on. It grows to match the Refresh tuner once
 * the art lands — which is why the section below is named for what it covers rather than left unlabelled.
 *
 * Values persist to localStorage and apply live through `applyFreezeVars()`. "Copy values" grabs the JSON to
 * bake into DEFAULTS *and* the styles.css fallbacks.
 */
const SPECS: Record<(typeof FRZ_NUM_KEYS)[number], [string, TunerUnit | undefined, string]> = {
  x:     ['Horizontal offset', 'px', 'Offset from the stage-pinned base point on the board’s right edge. Scales with the board.'],
  y:     ['Vertical offset', 'px', 'Offset from that base point. Positive moves the button down. Scales with the board.'],
  scale: ['Button size', '×', 'Overall size of the button.'],
};

const controls: TunerControl<Extract<keyof FreezeConfig, string>>[] = FRZ_NUM_KEYS.map((key) => {
  const [label, unit, hint] = SPECS[key];
  const [min, max, step] = FRZ_RANGES[key];
  return { key, label, unit, hint, group: 'Placement — art pending', min, max, step };
});

export const SPEC: TunerSpec<FreezeConfig> = {
  id: 'freezebtn',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Freeze Button',
  note: 'dev · live · drag',
  read: getFreezeConfig,
  write: setFreezeValue,
  reset: resetFreezeConfig,
  defaults: FRZ_DEFAULTS,
  controls,
};

export function FreezeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
