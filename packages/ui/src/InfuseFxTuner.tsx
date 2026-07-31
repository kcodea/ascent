import {
  INFUSEFX_COLOR_KEYS, INFUSEFX_DEFAULTS, INFUSEFX_RANGES,
  getInfuseFxConfig, resetInfuseFxConfig, setInfuseFxValue, type InfuseFxConfig,
} from './infuseFxConfig';
import { testInfuseFx } from './fxTestFire';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the FODDER INFUSION — the tendrils that fan out from a source to the shop line when Fodder
 * is sent there. Applies to the NEXT infusion: play a Godfodder or Soulfeeder, or end a turn with Maw of the Pit,
 * to judge — or use Test.
 *
 * The FAN controls (count, spread, stagger) are the ones that decide whether this reads as several distinct
 * tendrils or one wash, which is why they sit in their own group above the per-ribbon look.
 */
const COLOR_SET = new Set<string>(INFUSEFX_COLOR_KEYS.map(String));

const SPECS: Record<keyof InfuseFxConfig, [string, TunerUnit | undefined, string, string]> = {
  count:      ['Tendril count', undefined, 'How many tendrils fan out at once.', 'Fan'],
  spreadFrac: ['Spread', '×', 'How wide the fan reaches across the shop row.', 'Fan'],
  staggerMs:  ['Stagger', 'ms', 'Delay between one tendril leaving and the next, so they read as separate strands.', 'Fan'],
  endYOff:    ['Strike height', 'px', 'Vertical offset of where a tendril lands on its target.', 'Fan'],

  travelMs:   ['Travel time', 'ms', 'How long a tendril takes to reach its target.', 'Ribbon'],
  retractMs:  ['Retract time', 'ms', 'How long it takes to withdraw afterwards.', 'Ribbon'],
  curve:      ['Curve', '×', 'How far the ribbon bows from straight. 0 is straight.', 'Ribbon'],
  wobbleAmp:  ['Wobble distance', 'px', 'How far the ribbon wavers along its length.', 'Ribbon'],
  wobbleFreq: ['Wobble frequency', '×', 'How many waves that wobble makes.', 'Ribbon'],
  baseWidth:  ['Source width', 'px', 'Ribbon width at the source end.', 'Ribbon'],
  tipWidth:   ['Tip width', 'px', 'Ribbon width at the tip that lands.', 'Ribbon'],
  coreAlpha:  ['Core opacity', 'opacity', 'Opacity of the bright core stroke.', 'Ribbon'],
  glowWidth:  ['Glow width', 'px', 'Thickness of the soft glow around it. 0 removes it.', 'Ribbon'],
  glowAlpha:  ['Glow opacity', 'opacity', 'Opacity of that glow.', 'Ribbon'],
  colorCore:  ['Core colour', undefined, 'Colour of the core stroke.', 'Ribbon'],
  colorGlow:  ['Glow colour', undefined, 'Colour of the glow around it.', 'Ribbon'],

  flashSize:  ['Flash size', 'px', 'Diameter of the flash where a tendril lands. 0 removes it.', 'Landing'],
  flashMs:    ['Flash time', 'ms', 'How long that flash lasts.', 'Landing'],
  moteCount:  ['Mote count', undefined, 'How many motes burst on landing. 0 removes them.', 'Landing'],
  moteSpeed:  ['Mote speed', 'px/s', 'How fast those motes fly out.', 'Landing'],
  moteLife:   ['Mote lifetime', 'ms', 'How long one mote lasts.', 'Landing'],

  pulseSize:  ['Pulse size', 'px', 'Diameter of the pulse on the SOURCE as the tendrils leave. 0 removes it.', 'Source pulse'],
  pulseAlpha: ['Pulse opacity', 'opacity', 'Opacity of that pulse.', 'Source pulse'],
  pulseMs:    ['Pulse time', 'ms', 'How long the source pulse lasts.', 'Source pulse'],
};

/** Declaration order IS render order; the two colours sit inside the Ribbon run. */
const ORDER: (keyof InfuseFxConfig)[] = [
  'count', 'spreadFrac', 'staggerMs', 'endYOff',
  'travelMs', 'retractMs', 'curve', 'wobbleAmp', 'wobbleFreq',
  'baseWidth', 'tipWidth', 'coreAlpha', 'glowWidth', 'glowAlpha', 'colorCore', 'colorGlow',
  'flashSize', 'flashMs', 'moteCount', 'moteSpeed', 'moteLife',
  'pulseSize', 'pulseAlpha', 'pulseMs',
];

const controls: TunerControl<Extract<keyof InfuseFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = INFUSEFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<InfuseFxConfig> = {
  id: 'infusefx',                   // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Fodder Infusion',
  note: 'dev · next infusion · drag',
  read: getInfuseFxConfig,
  write: (key, value) => setInfuseFxValue(key, value),
  writeColor: (key, value) => setInfuseFxValue(key, value),
  reset: resetInfuseFxConfig,
  defaults: INFUSEFX_DEFAULTS,
  controls,
  actions: [{
    label: '▶ Test',
    hint: 'Fires the tendrils from your first board minion (or the hero portrait) to the shop line — no Godfodder needed.',
    run: () => testInfuseFx(),
  }],
};

export function InfuseFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
