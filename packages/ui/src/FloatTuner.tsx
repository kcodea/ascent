import { FLOAT_DEFAULTS, FLOAT_RANGES, getFloatConfig, resetFloatConfig, setFloatValue, type FloatConfig } from './floatConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the combat damage floats — the −N pills that pop over a struck unit. Values write to CSS
 * variables live, so the NEXT float shows the change; start a fight to watch one.
 *
 * "Copy values" grabs the JSON, but shipping a look here means pasting the values back as the CSS FALLBACKS in
 * styles.css (`.float`, `.float.dmg`, `@keyframes floatup`) — not into a config DEFAULTS block like most
 * tuners. That asymmetry is easy to forget, so it is stated on the panel itself via the note below.
 *
 * LANGUAGE. `rise` read "rise (0=stuck)", cramming the most important fact about the control into a
 * parenthetical in its name; that belongs in the hint, where there is room to say what 0 actually does.
 */
const SPECS: Record<keyof FloatConfig, [string, TunerUnit | undefined, string, string]> = {
  size:    ['Number size', 'px', 'Size of an ordinary float, such as a heal or a buff number.', 'Size'],
  dmgSize: ['Damage number size', 'px', 'Size of a damage float specifically — usually larger, so hits read louder than heals.', 'Size'],

  durMs:   ['Time on screen', 'ms', 'How long a float lasts from pop to fully faded.', 'Motion'],
  pop:     ['Pop overshoot', '×', 'How far past full size the number punches at the top of its pop. 1 is no overshoot at all.', 'Motion'],
  rise:    ['Rise distance', 'px', 'How far the number drifts upward before fading. 0 keeps it stuck to the card, holding and fading in place.', 'Motion'],

  inScale: ['Entry size', '×', 'How small the number starts before it pops in. Smaller is a snappier punch.', 'Entry'],
  inY:     ['Entry drop', 'px', 'How far below its resting spot the number starts.', 'Entry'],

  splashEm:       ['Splash size', '×', 'Size of the golden burst behind the damage number, as a multiple of the number height.', 'Splash'],
  numStroke:      ['Number outline', 'px', 'Thickness of the dark outline around the damage digits — helps them read over the bright burst. 0 = no outline.', 'Splash'],
  numStrokeColor: ['Outline colour', undefined, 'Colour of the damage-number outline.', 'Splash'],
  rotRandom:      ['Random rotation', undefined, 'Give each damage splash a random tilt so repeated hits look varied. The angle is fixed per hit (it never spins).', 'Splash'],
  rotRange:       ['Rotation range', '°', 'Maximum tilt (±) applied to the splash when Random rotation is on.', 'Splash'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof FloatConfig)[] = ['size', 'dmgSize', 'durMs', 'pop', 'rise', 'inScale', 'inY', 'splashEm', 'numStroke', 'numStrokeColor', 'rotRandom', 'rotRange'];

const controls: TunerControl<Extract<keyof FloatConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (key === 'numStrokeColor') return { key, label, hint, group, kind: 'color', min: 0, max: 0, step: 0 };
  const [min, max, step] = FLOAT_RANGES[key];
  if (key === 'rotRandom') return { key, label, hint, group, kind: 'toggle', onValue: 1, offValue: 0, onOffLabels: ['on', 'off'] as [string, string], min, max, step };
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<FloatConfig> = {
  id: 'float',                      // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Damage Float',
  note: 'dev · next float · drag',
  read: getFloatConfig,
  write: setFloatValue,
  writeColor: setFloatValue,
  reset: resetFloatConfig,
  defaults: FLOAT_DEFAULTS,
  controls,
};

export function FloatTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
