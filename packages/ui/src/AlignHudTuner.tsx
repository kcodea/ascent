import {
  ALIGNHUD_COLOR_KEYS, ALIGNHUD_DEFAULTS, ALIGNHUD_RANGES,
  getAlignHudConfig, resetAlignHudConfig, setAlignHudValue, type AlignHudConfig,
} from './alignHudConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the CELESTIAL ALIGNMENT HUD — the Dawn/Dusk horizon strip under the warband (owner ask
 * 2026-08-03). Applies live via `--ah-*` vars. Shipping a look = paste the JSON into the config DEFAULTS and
 * mirror the CSS `var(--ah-*, …)` fallbacks. Needs a Celestial on the board to see anything (Scene Builder →
 * Set 3 is the quickest rig); the spark can be prodded by just playing any minion.
 */
type ColorKey = (typeof ALIGNHUD_COLOR_KEYS)[number];
const COLOR_SET = new Set<string>(ALIGNHUD_COLOR_KEYS);

const SPECS: Record<keyof AlignHudConfig, [string, TunerUnit | undefined, string, string]> = {
  length:     ['Length', '%', 'How much of the warband row the horizon spans.', 'Strip'],
  width:      ['Width', 'px', 'Thickness of the gradient band itself (labels excluded).', 'Strip'],
  opacity:    ['Opacity', 'opacity', 'Whole-strip opacity.', 'Strip'],
  dawnColor:  ['Dawn colour', undefined, 'The left half of the sky.', 'Sky'],
  duskColor:  ['Dusk colour', undefined, 'The right half of the sky.', 'Sky'],
  vibrance:   ['Vibrance', '×', 'Saturation on the sky gradient. 1 = as-authored; below mutes, above enriches.', 'Sky'],
  seamColor:  ['Seam colour', undefined, 'The Eclipse band at the centre body.', 'Eclipse seam'],
  glowBlur:   ['Glow radius', 'px', 'Static soft halo around the Eclipse seam.', 'Eclipse seam'],
  glowAlpha:  ['Glow opacity', 'opacity', 'Strength of the seam halo.', 'Eclipse seam'],
  sparkOn:    ['Enabled', undefined, 'Flash a side when a minion lands there or an aligned effect fires.', 'Play spark'],
  sparkMs:    ['Duration', 'ms', 'How long the side flash lasts.', 'Play spark'],
  sparkAlpha: ['Peak opacity', 'opacity', 'How bright the side flash gets.', 'Play spark'],
};

const ORDER: (keyof AlignHudConfig)[] = [
  'length', 'width', 'opacity',
  'dawnColor', 'duskColor', 'vibrance',
  'seamColor', 'glowBlur', 'glowAlpha',
  'sparkOn', 'sparkMs', 'sparkAlpha',
];

const controls: TunerControl<Extract<keyof AlignHudConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  if (key === 'sparkOn') return { key, label, hint, group, kind: 'toggle' as const, min: 0, max: 1, step: 1, onOffLabels: ['sparking', 'still'] as [string, string] };
  const [min, max, step] = ALIGNHUD_RANGES[key as Exclude<keyof AlignHudConfig, ColorKey | 'sparkOn'>];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<AlignHudConfig> = {
  id: 'alignhud', // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Alignment HUD',
  note: 'dev · live · needs a Celestial on board',
  read: getAlignHudConfig,
  write: (key, value) => setAlignHudValue(key, value),
  writeColor: (key, value) => setAlignHudValue(key, value),
  reset: resetAlignHudConfig,
  defaults: ALIGNHUD_DEFAULTS,
  controls,
};

export function AlignHudTuner() {
  return <TunerPanel spec={SPEC} />;
}
