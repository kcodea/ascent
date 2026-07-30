import {
  AIMFX_COLOR_KEYS, AIMFX_DEFAULTS, AIMFX_RANGES,
  getAimFxConfig, resetAimFxConfig, setAimFxValue, type AimFxConfig,
} from './aimFxConfig';
import { testAimBurst } from './fxTestFire';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the HERO AIM effects — the living targeting line while a targeted power is armed, plus the
 * spark burst when it activates.
 *
 * The LINE re-reads its config every frame, so these dials apply *while you are aiming*: arm a targeted power
 * (Soren, Darah) and drag to judge. Each new aim also rolls a fresh random arch, which is what the two curve
 * controls trade off against each other.
 */
const COLOR_SET = new Set<string>(AIMFX_COLOR_KEYS.map(String));

const SPECS: Record<keyof AimFxConfig, [string, TunerUnit | undefined, string, string]> = {
  coreWidth:   ['Line width', 'px', 'Thickness of the bright core line.', 'Targeting line'],
  coreAlpha:   ['Line opacity', 'opacity', 'Opacity of the core line.', 'Targeting line'],
  glowWidth:   ['Aura width', 'px', 'Thickness of the soft aura around the line. 0 removes it.', 'Targeting line'],
  glowAlpha:   ['Aura opacity', 'opacity', 'Opacity of that aura.', 'Targeting line'],
  colorCore:   ['Line colour', undefined, 'Colour of the core line.', 'Targeting line'],
  colorGlow:   ['Aura colour', undefined, 'Colour of the aura around it.', 'Targeting line'],

  curve:       ['Arch', '×', 'How far the line bows away from straight.', 'Shape'],
  curveVar:    ['Arch randomness', 'opacity', 'How much the arch varies per aim. Every new aim rolls a fresh one.', 'Shape'],
  wobbleAmp:   ['Wobble distance', 'px', 'How far the line wanders while held. 0 holds it rigid.', 'Shape'],
  wobbleSpeed: ['Wobble speed', '×', 'How fast that wander cycles.', 'Shape'],
  breathe:     ['Aura breathe', 'opacity', 'How much the aura pulses while the line is held.', 'Shape'],
  dotSize:     ['Cursor dot', 'px', 'Size of the dot at the cursor end. 0 removes it.', 'Shape'],

  burstCount:  ['Spark count', undefined, 'How many sparks fire on activation. 0 removes the burst.', 'Activation burst'],
  burstSpeed:  ['Speed', 'px/s', 'How fast those sparks fly out.', 'Activation burst'],
  burstSize:   ['Spark size', 'px', 'Size of each spark.', 'Activation burst'],
  burstLife:   ['Lifetime', 'ms', 'How long a spark lasts.', 'Activation burst'],
  colorBurst:  ['Colour', undefined, 'Colour of the activation sparks.', 'Activation burst'],
};

/** Declaration order IS render order; each colour sits inside its own group's run. */
const ORDER: (keyof AimFxConfig)[] = [
  'coreWidth', 'coreAlpha', 'glowWidth', 'glowAlpha', 'colorCore', 'colorGlow',
  'curve', 'curveVar', 'wobbleAmp', 'wobbleSpeed', 'breathe', 'dotSize',
  'burstCount', 'burstSpeed', 'burstSize', 'burstLife', 'colorBurst',
];

const controls: TunerControl<Extract<keyof AimFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = AIMFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<AimFxConfig> = {
  id: 'aimfx',                      // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Hero Aim',
  note: 'dev · live while aiming',
  read: getAimFxConfig,
  write: (key, value) => setAimFxValue(key, value),
  writeColor: (key, value) => setAimFxValue(key, value),
  reset: resetAimFxConfig,
  defaults: AIMFX_DEFAULTS,
  controls,
  actions: [{
    label: '▶ Test burst',
    hint: 'Fires the activation spark burst at the hero-power diamond.',
    run: () => testAimBurst(),
  }],
};

export function AimFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
