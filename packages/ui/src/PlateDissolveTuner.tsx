import {
  PD_COLOR_KEYS, PD_DEFAULTS, PD_RANGES,
  getPlateDissolveConfig, playPlateDissolve, resetPlateDissolveConfig, setPlateDissolveValue,
  type PlateDissolveConfig,
} from './plateDissolve';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the ARCANE PLATE DISSOLVE — what the hand-card backplate plays when a minion is played:
 * a wireframe imprint of the plate, then arcane dust carrying it away.
 *
 * "Play here" fires the effect in the space beside the panel, so it can be dialled without dragging a card onto
 * the board over and over.
 *
 * The WIREFRAME LINEWORK is not tunable here, and that is deliberate: it is baked into
 * `frames/cardplate-wire.webp` by `scripts/build-plate-wire.mjs`, because extracting it costs a blur, a Sobel
 * pass and a percentile sort that have no business running during a shop phase. To change the lines, dial them
 * in `fx/plate-dissolve-preview.html` and re-run `npm run wire:plate`.
 *
 * Unlike the CSS-var tuners there is no `var(--x, fallback)` half to keep in sync — this module renders the
 * effect itself, so its DEFAULTS are what ships.
 */
type ColorKey = (typeof PD_COLOR_KEYS)[number];
const COLOR_SET = new Set<string>(PD_COLOR_KEYS);

/** `[label, unit, hint, group]` per key. Units are declared, never typed into the label. */
const SPECS: Record<keyof PlateDissolveConfig, [string, TunerUnit | undefined, string, string]> = {
  total:    ['Whole effect', 'ms', 'Total length of the effect. Also governs how long the dust lives.', 'Timing'],
  inMs:     ['Plate → wireframe', 'ms', 'Crossfade from the real plate art into the wireframe imprint.', 'Timing'],
  holdMs:   ['Wireframe hold', 'ms', 'How long the wireframe sits at full brightness before it burns off.', 'Timing'],
  plateOut: ['Plate vanish', 'ms', 'How fast the real plate art disappears underneath the imprint. 0 is instant.', 'Timing'],
  fadeMs:   ['Wireframe burn-off', 'ms', 'How long the wireframe takes to burn away. Independent of the total, so the frame can snap away while dust still hangs.', 'Timing'],

  puff:     ['Swell', '×', 'How far the wireframe swells as it goes. 1 is no swell at all.', 'Wireframe'],
  inten:    ['Brightness', '×', 'Peak brightness of the wireframe.', 'Wireframe'],
  g1:       ['Inner glow radius', 'px', 'Tight glow hugging the lines.', 'Wireframe'],
  g2:       ['Outer bloom radius', 'px', 'Wide, soft bloom around the whole plate.', 'Wireframe'],
  grad:     ['Gradient spread', 'opacity', '0 is a flat mid colour. 1 is the full deep → mid → core ramp across the plate.', 'Wireframe'],
  cDeep:    ['Deep', undefined, 'Gradient end colour — the darkest of the three.', 'Wireframe'],
  cMid:     ['Mid', undefined, 'Gradient middle colour.', 'Wireframe'],
  cCore:    ['Core', undefined, 'Gradient core colour — the brightest.', 'Wireframe'],

  count:    ['Mote count', undefined, 'How many motes the plate breaks into.', 'Arcane dust'],
  onLines:  ['Confine to lines', 'opacity', '0 spawns dust off the whole plate. 1 spawns it only off the wireframe lines.', 'Arcane dust'],
  spd:      ['Outward speed', 'px/s', 'How fast the motes drift away.', 'Arcane dust'],
  spdVar:   ['Speed variance', 'opacity', 'Randomness in each mote’s speed.', 'Arcane dust'],
  lift:     ['Vertical drift', 'px', 'Negative rises, positive sinks.', 'Arcane dust'],
  size:     ['Mote size', 'px', 'Mote radius.', 'Arcane dust'],
  sizeVar:  ['Size variance', 'opacity', 'Randomness in mote size.', 'Arcane dust'],
  life:     ['Mote lifetime', '×', 'Mote lifetime, as a fraction of the whole effect.', 'Arcane dust'],
  lifeVar:  ['Lifetime variance', 'opacity', 'Randomness in lifetime.', 'Arcane dust'],
  stag:     ['Stagger', 'opacity', '0 births every mote at once, for one crisp burst. Higher gives a rolling burn.', 'Arcane dust'],
  trail:    ['Trail smear', 'opacity', 'Per-frame smear. Higher leaves comet tails.', 'Arcane dust'],
};

/**
 * Declaration order IS render order, and only ADJACENT controls sharing a group merge into one heading — so the
 * three palette colours sit inside the Wireframe run rather than being collected at the end.
 */
const ORDER: (keyof PlateDissolveConfig)[] = [
  'total', 'inMs', 'holdMs', 'plateOut', 'fadeMs',
  'puff', 'inten', 'g1', 'g2', 'grad', 'cDeep', 'cMid', 'cCore',
  'count', 'onLines', 'spd', 'spdVar', 'lift', 'size', 'sizeVar', 'life', 'lifeVar', 'stag', 'trail',
];

const controls: TunerControl<Extract<keyof PlateDissolveConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = PD_RANGES[key as Exclude<keyof PlateDissolveConfig, ColorKey>];
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<PlateDissolveConfig> = {
  id: 'platedissolve',              // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Plate Dissolve',
  note: 'dev · play a minion',
  read: getPlateDissolveConfig,
  write: (key, value) => setPlateDissolveValue(key, value),
  writeColor: (key, value) => setPlateDissolveValue(key, value),
  reset: resetPlateDissolveConfig,
  defaults: PD_DEFAULTS,
  controls,
  actions: [{
    label: 'Play here',
    hint: 'Fires the effect in the space beside this panel, so it can be judged without playing a minion.',
    run: (panelEl) => {
      if (!panelEl) return;
      const r = panelEl.getBoundingClientRect();
      const w = 240, h = w * 1.555;                       // a card-shaped box, to the panel's left
      playPlateDissolve({ left: r.left - w - 24, top: r.top + 40, width: w, height: h });
    },
  }],
};

export function PlateDissolveTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
