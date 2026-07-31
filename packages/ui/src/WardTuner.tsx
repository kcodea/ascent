import {
  WARD_COLOR_GROUPS, WARD_DEFAULTS, WARD_GROUPS, WARD_RANGES,
  getWardConfig, resetWardConfig, setWardValue, type WardConfig,
} from './wardConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the WARD dome — the glassy energy shell on a warded card. Values reflect to CSS vars on
 * `:root`, so the dome on screen updates live as you drag; nothing re-renders or re-mounts. Shipping a look means
 * pasting the JSON into DEFAULTS *and* updating the CSS fallbacks in styles.css, which are what production
 * actually renders.
 *
 * LOOK ONLY. The dome's SIZE and vertical SEAT are per-frame CSS (`--wardsize` / `--wardy`) and are not tunable
 * from here — the four Bubble box dials adjust the shell within that seat, not the seat itself.
 *
 * Sections come from the config's own `WARD_GROUPS` and `WARD_COLOR_GROUPS` rather than a copy in this file, the
 * same arrangement Execute Aura uses: the config had the grouping before the schema existed, and duplicating it
 * would let the two drift.
 *
 * LANGUAGE. This was the worst offender the audit found for opacity naming — `rimA`, `rimInA`, `rimOutA`, `haloA`
 * and `facetAlpha` all showed as some variant of "α" or "alpha", with the actual subject carried by a neighbouring
 * column rather than by the label itself. Each now names what it makes transparent.
 */
const COLOR_SET = new Set<string>(WARD_COLOR_GROUPS.flatMap((g) => g.keys).map(String));

const SPECS: Record<keyof WardConfig, [string, TunerUnit | undefined, string]> = {
  domeW:         ['Width', '×', 'Shell width relative to the card frame.'],
  domeH:         ['Height', '×', 'Shell height relative to the frame.'],
  domeX:         ['Horizontal nudge', 'px', 'Slides the whole shell sideways.'],
  domeY:         ['Vertical nudge', 'px', 'Slides the whole shell vertically.'],

  rimW:          ['Edge thickness', 'px', 'Thickness of the white-hot rim tracing the shell.'],
  rimA:          ['Edge opacity', 'opacity', 'Opacity of that rim.'],
  rimIn:         ['Inner glow radius', 'px', 'How far the rim bleeds INWARD across the card.'],
  rimInA:        ['Inner glow opacity', 'opacity', 'Opacity of that inward bleed.'],
  rimOut:        ['Outer glow radius', 'px', 'How far the rim bleeds OUTWARD past the shell.'],
  rimOutA:       ['Outer glow opacity', 'opacity', 'Opacity of that outward bleed.'],

  halo:          ['Blur', 'px', 'Softness of the wide halo cast around the whole card.'],
  haloSpread:    ['Spread', 'px', 'How far the halo reaches. Negative pulls it in tight.'],
  haloA:         ['Opacity', 'opacity', 'Halo opacity.'],

  facetW:        ['Cell width', '%', 'Width of one honeycomb cell.'],
  facetH:        ['Cell height', '%', 'Height of one honeycomb cell.'],
  facetX:        ['Horizontal offset', '%', 'Shifts the honeycomb pattern sideways.'],
  facetY:        ['Vertical offset', '%', 'Shifts the pattern vertically.'],
  facetAlpha:    ['Opacity', 'opacity', 'Opacity of the honeycomb.'],
  facetEdge:     ['Clear centre', '%', 'How much of the middle stays clear of honeycomb, so the art reads through it.'],

  fillCore:      ['Core tint', 'opacity', 'Tint strength at the centre of the shell.'],
  fillEdge:      ['Edge tint', 'opacity', 'Tint strength at its edge.'],
  fillStop:      ['Falloff', '%', 'Where the core tint gives way to the edge tint.'],
  sheen:         ['Sheen', 'opacity', 'Strength of the diagonal glass sheen.'],

  pulseMin:      ['Breath trough', 'opacity', 'How far the breathing dips. 1 holds steady, with no breathing.'],
  pulseSec:      ['Breath period', 's', 'Seconds per full breath.'],

  rimColor:      ['Rim edge', undefined, 'Colour of the white-hot rim.'],
  rimOutColor:   ['Rim outer glow', undefined, 'Colour of the outward bleed.'],
  rimInColor:    ['Rim inner glow', undefined, 'Colour of the inward bleed.'],
  haloColor:     ['Halo', undefined, 'Colour of the wide halo.'],
  hexColor:      ['Honeycomb', undefined, 'Colour of the honeycomb cells.'],
  fillCoreColor: ['Fill core', undefined, 'Tint colour at the shell centre.'],
  fillEdgeColor: ['Fill edge', undefined, 'Tint colour at its edge.'],
  sheenColor:    ['Sheen', undefined, 'Colour of the glass sheen.'],
};

const controls: TunerControl<Extract<keyof WardConfig, string>>[] = [
  ...WARD_GROUPS.flatMap((g) =>
    g.keys.map((key) => {
      const [label, unit, hint] = SPECS[key];
      const [min, max, step] = WARD_RANGES[key];
      return { key, label, unit, hint, group: g.title, min, max, step };
    }),
  ),
  ...WARD_COLOR_GROUPS.flatMap((g) =>
    g.keys.map((key) => {
      const [label, , hint] = SPECS[key];
      return {
        key: key as Extract<keyof WardConfig, string>,
        label, hint, group: g.title, kind: 'color' as const, min: 0, max: 0, step: 0,
      };
    }),
  ),
];

// Sanity: every colour key must be in the colour groups, or it would render as a slider on a hex string.
if (import.meta.env.DEV) {
  for (const c of controls) {
    if (COLOR_SET.has(c.key) && c.kind !== 'color') {
      console.warn(`[tuner:ward] "${c.key}" is a colour but is not declared in WARD_COLOR_GROUPS.`);
    }
  }
}

export const SPEC: TunerSpec<WardConfig> = {
  id: 'ward',                       // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Ward Dome',
  note: 'dev · live · warded card',
  read: getWardConfig,
  write: (key, value) => setWardValue(key, value),
  writeColor: (key, value) => setWardValue(key, value),
  reset: resetWardConfig,
  defaults: WARD_DEFAULTS,
  controls,
};

export function WardTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
