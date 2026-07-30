import {
  GLOW_COLOR_KEYS, GLOW_DEFAULTS, GLOW_RANGES,
  getGlowConfig, resetGlowConfig, setGlowValue, type GlowConfig,
} from './glowConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the card HOVER / SELECT glow — the bright inner line and soft outer bloom that ring a card.
 * Applies live via `--hg-*` vars, which the `.cglow` filter reads. Shipping a look means pasting the JSON into
 * DEFAULTS *and* mirroring it into the CSS `var(--hg-*, …)` fallbacks.
 *
 * "Always on" is a declared preview switch: one pointer cannot hover a card and drag a slider at the same time.
 */
type ColorKey = (typeof GLOW_COLOR_KEYS)[number];
const COLOR_SET = new Set<string>(GLOW_COLOR_KEYS);

const SPECS: Record<keyof GlowConfig, [string, TunerUnit | undefined, string, string]> = {
  width:         ['Width', '×', 'Glow shape width, relative to the frame. Above 1 pushes the rim out past the frame sides.', 'Shape'],
  height:        ['Height', '×', 'Glow shape height, relative to the frame. Above 1 pushes the rim past the top and bottom.', 'Shape'],

  lineBlur:      ['Softness', 'px', 'Softness of the bright inner line. Small values give a crisp rim hugging the card silhouette.', 'Inner line'],
  lineAlpha:     ['Opacity', 'opacity', 'Opacity of the inner line. High reads as a bright, defined edge.', 'Inner line'],
  lineColor:     ['Colour', undefined, 'Colour of the inner line.', 'Inner line'],

  bloomBlur:     ['Radius', 'px', 'Radius of the soft outer bloom. Large gives a wide, gentle halo around the line.', 'Outer bloom'],
  bloomAlpha:    ['Opacity', 'opacity', 'Bloom opacity. Lower is milder.', 'Outer bloom'],
  bloomStrength: ['Intensity', undefined, 'How many times the bloom is stacked. 1 is soft; higher is a hotter, denser glow.', 'Outer bloom'],
  bloomColor:    ['Colour', undefined, 'Colour of the outer bloom.', 'Outer bloom'],
};

/** Declaration order IS render order; each colour sits inside its own group's run. */
const ORDER: (keyof GlowConfig)[] = [
  'width', 'height',
  'lineBlur', 'lineAlpha', 'lineColor',
  'bloomBlur', 'bloomAlpha', 'bloomStrength', 'bloomColor',
];

const controls: TunerControl<Extract<keyof GlowConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = GLOW_RANGES[key as Exclude<keyof GlowConfig, ColorKey>];
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<GlowConfig> = {
  id: 'glow',                       // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hover Glow',
  note: 'dev · live · cards',
  read: getGlowConfig,
  write: (key, value) => setGlowValue(key, value),
  writeColor: (key, value) => setGlowValue(key, value),
  reset: resetGlowConfig,
  defaults: GLOW_DEFAULTS,
  controls,
  toggles: [{
    id: 'hglow',
    label: 'Always on',
    hint: 'Pins the glow onto every resting card so it can be tuned without holding hover — one pointer cannot hover a card and drag a slider. Preview only; nothing is saved.',
    bodyClass: 'hglow-preview',
  }],
};

export function GlowTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
