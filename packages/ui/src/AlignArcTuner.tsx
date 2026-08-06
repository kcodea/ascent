import {
  ALIGNARC_COLOR_KEYS, ALIGNARC_DEFAULTS, ALIGNARC_RANGES,
  getAlignArcConfig, resetAlignArcConfig, setAlignArcConfig, type AlignArcConfig,
} from './alignArcConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV tuner for the CELESTIAL ALIGNMENT ARC — the luminous crescent beneath each Celestial (Codex handoff,
 * 2026-08-05), replacing the horizon-strip tuner.
 *
 * Unlike the CSS tuners there are no `var(--…)` fallbacks to mirror: a PIXI layer reads these values
 * directly, so the config DEFAULTS are the whole contract. Shipping a look = paste the JSON in there.
 *
 * You need a Celestial on the board to see anything — Scene Builder -> Set 3, and a 3-wide board shows all
 * three states at once (Dawn / Eclipse / Dusk), which is the arrangement to dial against.
 */
type ColorKey = (typeof ALIGNARC_COLOR_KEYS)[number];
const COLOR_SET = new Set<string>(ALIGNARC_COLOR_KEYS);

const SPECS: Record<keyof AlignArcConfig, [string, TunerUnit | undefined, string, string]> = {
  on:             ['Enabled', undefined, 'Master switch for the whole effect.', 'Arc'],
  width:          ['Width', '%', "Arc width as a % of the card's width.", 'Arc'],
  depth:          ['Depth', 'px', 'How far the curve dips below its ends — the crescent shape.', 'Arc'],
  y:              ['Y position', 'px', "Distance from the card's bottom edge. Positive is down.", 'Arc'],
  glowStroke:     ['Glow stroke', 'px', 'The thick blurred stroke that makes the bloom.', 'Bloom'],
  blur:           ['Blur strength', undefined, 'Shared by every arc — one filter for the whole board.', 'Bloom'],
  glowAlpha:      ['Glow opacity', 'opacity', 'Strength of the bloom.', 'Bloom'],
  coreStroke:     ['Core stroke', 'px', 'The saturated, readable alignment line.', 'Line'],
  coreAlpha:      ['Core opacity', 'opacity', 'Strength of the readable line.', 'Line'],
  highlightAlpha: ['Highlight opacity', 'opacity', 'The 1px white centre that energises the line.', 'Line'],
  emphasis:       ['Emphasis', '×', 'Brightness multiplier on the drag candidate slot.', 'Line'],
  dawnColor:      ['Dawn colour', undefined, 'Minions on the left half of the sky.', 'Colours'],
  eclipseColor:   ['Eclipse colour', undefined, 'The exact middle body, which counts as BOTH sides.', 'Colours'],
  duskColor:      ['Dusk colour', undefined, 'Minions on the right half.', 'Colours'],
};

const ORDER: (keyof AlignArcConfig)[] = [
  'on', 'width', 'depth', 'y',
  'glowStroke', 'blur', 'glowAlpha',
  'coreStroke', 'coreAlpha', 'highlightAlpha', 'emphasis',
  'dawnColor', 'eclipseColor', 'duskColor',
];

const controls: TunerControl<Extract<keyof AlignArcConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  if (key === 'on') return { key, label, hint, group, kind: 'toggle' as const, min: 0, max: 1, step: 1, onOffLabels: ['on', 'off'] as [string, string] };
  const [min, max, step] = ALIGNARC_RANGES[key as Exclude<keyof AlignArcConfig, ColorKey | 'on'>];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<AlignArcConfig> = {
  id: 'alignarc', // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Alignment Arc',
  note: 'dev · live · needs a Celestial on board',
  read: getAlignArcConfig,
  write: (key, value) => setAlignArcConfig({ [key]: value } as Partial<AlignArcConfig>),
  writeColor: (key, value) => setAlignArcConfig({ [key]: value } as Partial<AlignArcConfig>),
  reset: resetAlignArcConfig,
  defaults: ALIGNARC_DEFAULTS,
  controls,
};

export function AlignArcTuner() {
  return <TunerPanel spec={SPEC} />;
}
