import {
  FSW_COLOR_KEYS, FSW_DEFAULTS, FSW_RANGES,
  getFlurrySwingConfig, resetFlurrySwingConfig, setFlurrySwingValue, type FlurrySwingConfig,
} from './flurrySwingConfig';
import { pixiFx } from './pixiFx';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the FLURRY SWING — the one-shot wind-slash sparkle a Flurry minion fires on its extra
 * swing. Three layers: crescent wind-blades, a spark cone, and a soft contact glow. Applies to the NEXT swing;
 * Test fires it at screen centre so it can be dialled without arranging a real Flurry fight.
 *
 * "Power" is a master dial that scales every count, size AND speed at once, which is why it sits alone at the
 * top rather than inside a layer group — it is the one to reach for first.
 */
type ColorKey = (typeof FSW_COLOR_KEYS)[number];
const COLOR_SET = new Set<string>(FSW_COLOR_KEYS);

const SPECS: Record<keyof FlurrySwingConfig, [string, TunerUnit | undefined, string, string]> = {
  power:       ['Power', '×', 'Master intensity — scales every count, size and speed below at once.', 'Overall'],

  slashCount:  ['Blade count', undefined, 'How many crescent slashes appear at the hit. 0 removes them.', 'Wind blades'],
  slashSize:   ['Blade size', 'px', 'Drawn size of each slash.', 'Wind blades'],
  slashLife:   ['Blade lifetime', 'ms', 'How long each slash lasts.', 'Wind blades'],
  slashSpeed:  ['Blade speed', 'px/s', 'How fast each slash is flung outward.', 'Wind blades'],
  slashSpread: ['Blade scatter', '°', 'Angular scatter around the direction of the blow.', 'Wind blades'],
  slashColor:  ['Colour', undefined, 'Colour of the wind blades.', 'Wind blades'],

  sparkCount:  ['Spark count', undefined, 'How many bright motes burst out. 0 removes them.', 'Sparks'],
  sparkSpeed:  ['Speed', 'px/s', 'Initial spark speed.', 'Sparks'],
  sparkLife:   ['Lifetime', 'ms', 'How long one spark lasts.', 'Sparks'],
  sparkSize:   ['Size', 'px', 'Drawn spark size.', 'Sparks'],
  sparkSpread: ['Cone width', '°', 'Cone around the blow direction. 360 throws them all around.', 'Sparks'],
  sparkColor:  ['Colour', undefined, 'Colour of the sparks.', 'Sparks'],

  glowSize:    ['Size', 'px', 'Diameter of the soft contact flash. 0 removes the glow.', 'Contact glow'],
  glowAlpha:   ['Opacity', 'opacity', 'Peak glow opacity.', 'Contact glow'],
  glowColor:   ['Colour', undefined, 'Colour of the contact glow.', 'Contact glow'],
};

/** Declaration order IS render order; each colour sits inside its own layer's run. */
const ORDER: (keyof FlurrySwingConfig)[] = [
  'power',
  'slashCount', 'slashSize', 'slashLife', 'slashSpeed', 'slashSpread', 'slashColor',
  'sparkCount', 'sparkSpeed', 'sparkLife', 'sparkSize', 'sparkSpread', 'sparkColor',
  'glowSize', 'glowAlpha', 'glowColor',
];

const controls: TunerControl<Extract<keyof FlurrySwingConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = FSW_RANGES[key as Exclude<keyof FlurrySwingConfig, ColorKey>];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<FlurrySwingConfig> = {
  id: 'flurryswing',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Flurry Swing',
  note: 'dev · next swing · drag',
  read: getFlurrySwingConfig,
  write: (key, value) => setFlurrySwingValue(key, value),
  writeColor: (key, value) => setFlurrySwingValue(key, value),
  reset: resetFlurrySwingConfig,
  defaults: FSW_DEFAULTS,
  controls,
  actions: [{ label: '🌬️ Test', hint: 'Fires the swing at screen centre, without needing a real Flurry fight.', run: () => pixiFx.testFlurry() }],
};

export function FlurrySwingTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
