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
  gemX:  ['Gem nudge X', 'px', 'Slide the gem overlay horizontally onto the baked gem.'],
  gemY:  ['Gem nudge Y', 'px', 'Slide the gem overlay vertically onto the baked gem.'],
  gemS:  ['Gem fit', '×', 'Size the gem overlay to sit exactly on the baked gem.'],
  pillX: ['Pill X', 'px', 'Move the "Freeze" label pill horizontally from the button centre.'],
  pillY: ['Pill Y', 'px', 'Move the "Freeze" label pill vertically from the button centre.'],
  pillS: ['Pill size', '×', 'Size the "Freeze" label pill.'],
};

const controls: TunerControl<Extract<keyof FreezeConfig, string>>[] = FRZ_NUM_KEYS.map((key) => {
  const [label, unit, hint] = SPECS[key];
  const [min, max, step] = FRZ_RANGES[key];
  const group = key.startsWith('gem') ? 'Gem overlay' : key.startsWith('pill') ? 'Freeze label' : 'Placement';
  return { key, label, unit, hint, group, min, max, step };
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
