import {
  SWAPFX_COLOR_KEYS, SWAPFX_DEFAULTS, SWAPFX_RANGES,
  getSwapFxConfig, resetSwapFxConfig, setSwapFxValue, type SwapFxConfig,
} from './swapFxConfig';
import { testSwapFx } from './fxTestFire';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the SWAP arrows — the Displacement circular exchange: two mirrored arcs, their arrowheads,
 * an arrival flash with motes, and a halo held on both cards. Applies to the NEXT swap.
 *
 * The two arcs are deliberately opposite in temperature — the ARRIVAL arc is warm, the DEPARTURE arc is cool —
 * so which card is coming and which is going reads without following the animation. That is why the colours are
 * grouped as arrival and departure pairs rather than as one palette.
 */
const COLOR_SET = new Set<string>(SWAPFX_COLOR_KEYS.map(String));

const SPECS: Record<keyof SwapFxConfig, [string, TunerUnit | undefined, string, string]> = {
  travelMs:      ['Travel time', 'ms', 'How long an arc takes to reach its destination.', 'Timing'],
  retractMs:     ['Retract time', 'ms', 'How long the arc takes to withdraw afterwards.', 'Timing'],

  curve:         ['Arc bulge', '×', 'How far each arc bows out from a straight line. 0 is straight.', 'Arc shape'],
  wobbleAmp:     ['Wobble distance', 'px', 'How far the arc wavers along its length. 0 holds it smooth.', 'Arc shape'],
  wobbleFreq:    ['Wobble frequency', '×', 'How many waves that wobble makes.', 'Arc shape'],
  baseWidth:     ['Tail width', 'px', 'Arc width at the tail, where it starts.', 'Arc shape'],
  tipWidth:      ['Head width', 'px', 'Arc width at the head, where it arrives.', 'Arc shape'],
  coreAlpha:     ['Core opacity', 'opacity', 'Opacity of the bright core stroke.', 'Arc shape'],
  glowWidth:     ['Glow width', 'px', 'Thickness of the soft glow around the arc. 0 removes it.', 'Arc shape'],
  glowAlpha:     ['Glow opacity', 'opacity', 'Opacity of that glow.', 'Arc shape'],
  arrowSize:     ['Arrowhead size', 'px', 'Size of the arrowhead. 0 removes it.', 'Arc shape'],

  colorInCore:   ['Arrival core', undefined, 'Core colour of the WARM arrival arc — the card coming in.', 'Colours'],
  colorInGlow:   ['Arrival glow', undefined, 'Glow colour of the arrival arc.', 'Colours'],
  colorOutCore:  ['Departure core', undefined, 'Core colour of the COOL departure arc — the card leaving.', 'Colours'],
  colorOutGlow:  ['Departure glow', undefined, 'Glow colour of the departure arc.', 'Colours'],

  flashSize:     ['Flash size', 'px', 'Diameter of the flash where an arc lands. 0 removes it.', 'Arrival'],
  flashMs:       ['Flash time', 'ms', 'How long that flash lasts.', 'Arrival'],
  moteCount:     ['Mote count', undefined, 'How many motes burst on arrival. 0 removes them.', 'Arrival'],
  moteSpeed:     ['Mote speed', 'px/s', 'How fast those motes fly out.', 'Arrival'],
  moteLife:      ['Mote lifetime', 'ms', 'How long one mote lasts.', 'Arrival'],

  haloSize:      ['Halo size', 'px', 'Diameter of the halo held on both cards during the swap. 0 removes it.', 'Card halo'],
  haloAlpha:     ['Halo opacity', 'opacity', 'Opacity of that halo.', 'Card halo'],
};

/** Declaration order IS render order; the four colours form their own run. */
const ORDER: (keyof SwapFxConfig)[] = [
  'travelMs', 'retractMs',
  'curve', 'wobbleAmp', 'wobbleFreq', 'baseWidth', 'tipWidth', 'coreAlpha', 'glowWidth', 'glowAlpha', 'arrowSize',
  'colorInCore', 'colorInGlow', 'colorOutCore', 'colorOutGlow',
  'flashSize', 'flashMs', 'moteCount', 'moteSpeed', 'moteLife',
  'haloSize', 'haloAlpha',
];

const controls: TunerControl<Extract<keyof SwapFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = SWAPFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<SwapFxConfig> = {
  id: 'swapfx',                     // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Swap',
  note: 'dev · next swap · drag',
  read: getSwapFxConfig,
  write: (key, value) => setSwapFxValue(key, value),
  writeColor: (key, value) => setSwapFxValue(key, value),
  reset: resetSwapFxConfig,
  defaults: SWAPFX_DEFAULTS,
  controls,
  actions: [{
    label: '▶ Test',
    hint: 'Fires the swap arc between your first board minion (or the hero portrait) and the first shop offer — no Darah needed.',
    run: () => testSwapFx(),
  }],
};

export function SwapFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
