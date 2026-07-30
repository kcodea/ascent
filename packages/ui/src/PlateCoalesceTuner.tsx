import {
  PC_COLOR_KEYS, PC_DEFAULTS, PC_RANGES,
  getPlateCoalesceConfig, playPlateCoalesce, resetPlateCoalesceConfig, setPlateCoalesceValue,
  type PlateCoalesceConfig,
} from './plateCoalesce';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the ARCANE PLATE COALESCE — what plays when a card is GENERATED into hand: arcane dust
 * rushes in, lands on the plate's shape, builds a wireframe, and resolves into the real card.
 *
 * "Play on a card" anchors on a real card in hand rather than on this panel, because the effect has to land on
 * an actual plate to read correctly. (Its predecessor tried to anchor on the panel via `panelRef.current`, which
 * is a CALLBACK ref and therefore always undefined — the button silently did nothing. Caught by `typecheck:web`.)
 *
 * A GILDED card forms in gold rather than arcane blue, using the same palette as the gild itself. That variant is
 * fixed and never tuned, with its own sprite cache; the colours below drive every non-golden generation.
 *
 * Unlike the CSS-var tuners there is no `var(--x, fallback)` half to keep in sync — this module renders the
 * effect itself, so its DEFAULTS are what ships.
 */
type ColorKey = (typeof PC_COLOR_KEYS)[number];
const COLOR_SET = new Set<string>(PC_COLOR_KEYS);

/** `[label, unit, hint, group]` per key. Units are declared, never typed into the label. */
const SPECS: Record<keyof PlateCoalesceConfig, [string, TunerUnit | undefined, string, string]> = {
  total:    ['Whole effect', 'ms', 'Total length of the effect.', 'Timing'],
  gatherMs: ['Dust gather', 'ms', 'How long the dust takes to rush in and land on the shape.', 'Timing'],
  wireIn:   ['Wireframe fade-in', 'ms', 'The wireframe builds as the dust arrives.', 'Timing'],
  holdMs:   ['Wireframe hold', 'ms', 'How long the finished wireframe holds before resolving into the card.', 'Timing'],
  cardIn:   ['Wireframe → card', 'ms', 'Crossfade from the wireframe to the real card art.', 'Timing'],

  dist:     ['Start distance', '×', 'How far out the motes begin, as a multiple of plate width.', 'Rush in'],
  distVar:  ['Distance variance', 'opacity', 'Randomness in each mote’s start distance.', 'Rush in'],
  swirl:    ['Swirl', '×', 'Sideways curl on the way in. 0 flies straight; higher spirals home.', 'Rush in'],
  ease:     ['Approach easing', '×', '1 is linear. Higher rushes in then settles.', 'Rush in'],
  stag:     ['Arrival spread', 'opacity', 'Spread in arrival times. 0 lands every mote together.', 'Rush in'],
  linger:   ['Linger', '×', 'How long a mote sits on the shape before winking out.', 'Rush in'],

  count:    ['Mote count', undefined, 'How many motes rush in.', 'Dust'],
  onLines:  ['Confine to lines', 'opacity', '0 lands anywhere on the plate. 1 lands only on the wireframe lines.', 'Dust'],
  size:     ['Mote size', 'px', 'Mote radius.', 'Dust'],
  sizeVar:  ['Size variance', 'opacity', 'Randomness in mote size.', 'Dust'],
  trail:    ['Trail smear', 'opacity', 'Per-frame smear. Higher leaves comet tails.', 'Dust'],

  puff:     ['Starting swell', '×', 'How much bigger the wireframe starts before contracting in.', 'Wireframe'],
  inten:    ['Brightness', '×', 'Peak brightness of the wireframe.', 'Wireframe'],
  g1:       ['Inner glow radius', 'px', 'Tight glow hugging the lines.', 'Wireframe'],
  g2:       ['Outer bloom radius', 'px', 'Wide, soft bloom around the whole plate.', 'Wireframe'],
  grad:     ['Gradient spread', 'opacity', '0 is a flat mid colour. 1 is the full deep → mid → core ramp.', 'Wireframe'],
  cDeep:    ['Deep', undefined, 'Gradient end colour — the darkest of the three.', 'Wireframe'],
  cMid:     ['Mid', undefined, 'Gradient middle colour.', 'Wireframe'],
  cCore:    ['Core', undefined, 'Gradient core colour — the brightest.', 'Wireframe'],
};

/** Declaration order IS render order; the palette colours sit inside the Wireframe run. */
const ORDER: (keyof PlateCoalesceConfig)[] = [
  'total', 'gatherMs', 'wireIn', 'holdMs', 'cardIn',
  'dist', 'distVar', 'swirl', 'ease', 'stag', 'linger',
  'count', 'onLines', 'size', 'sizeVar', 'trail',
  'puff', 'inten', 'g1', 'g2', 'grad', 'cDeep', 'cMid', 'cCore',
];

const controls: TunerControl<Extract<keyof PlateCoalesceConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = PC_RANGES[key as Exclude<keyof PlateCoalesceConfig, ColorKey>];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<PlateCoalesceConfig> = {
  id: 'platecoalesce',              // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Plate Coalesce',
  note: 'dev · card generated',
  read: getPlateCoalesceConfig,
  write: (key, value) => setPlateCoalesceValue(key, value),
  writeColor: (key, value) => setPlateCoalesceValue(key, value),
  reset: resetPlateCoalesceConfig,
  defaults: PC_DEFAULTS,
  controls,
  actions: [{
    label: 'Play on a card',
    hint: 'Fires the effect on a real card in hand — it has to land on an actual plate to read correctly. Needs a card on screen.',
    run: () => {
      const real = document.querySelector<HTMLElement>('.row.hand .card[data-uid]')
        ?? document.querySelector<HTMLElement>('.row .card[data-uid]');
      if (!real) return;
      const plate = real.querySelector<HTMLElement>('.cardplate');
      const r = (plate ?? real).getBoundingClientRect();
      if (r.width > 0) playPlateCoalesce(r, real);
    },
  }],
};

export function PlateCoalesceTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
