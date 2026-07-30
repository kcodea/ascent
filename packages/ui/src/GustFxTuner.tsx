import {
  GUSTFX_COLOR_KEYS, GUSTFX_DEFAULTS, GUSTFX_RANGES,
  getGustFxConfig, resetGustFxConfig, setGustFxValue, type GustFxConfig,
} from './gustFxConfig';
import { testGustFx } from './fxTestFire';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the BUFF GUST — the rush that sweeps the shop row when it is tavern-buffed: flank bracket
 * arcs, speed-line streaks, a row wash, and a lift on the cards themselves. Applies to the NEXT gust — cast a
 * Staff of Guel, or trigger a Fodder enchant (Ritualist's End of Turn, Rune of Consumption) to judge, or use Test.
 *
 * `taper` is stored as 0 or 1 and the old panel showed it as a two-stop slider labelled "taper (0/1)". It is a
 * declared toggle now.
 *
 * Mirrors the `buff-gust-preview.html` rig one-for-one; change one, change the other.
 */
const COLOR_SET = new Set<string>(GUSTFX_COLOR_KEYS.map(String));

const SPECS: Record<keyof GustFxConfig, [string, TunerUnit | undefined, string, string]> = {
  sweepMs:     ['Sweep time', 'ms', 'How long the gust takes to cross the row.', 'Lifecycle'],
  staggerMs:   ['Stagger', 'ms', 'Delay between one card being reached and the next.', 'Lifecycle'],
  arcMs:       ['Bracket time', 'ms', 'How long a flank bracket takes to draw.', 'Lifecycle'],
  holdMs:      ['Hold', 'ms', 'How long everything holds at full before fading.', 'Lifecycle'],
  fadeMs:      ['Fade', 'ms', 'How long the fade out takes.', 'Lifecycle'],

  streaks:     ['Count per side', undefined, 'How many speed-line streaks per flank. 0 removes them.', 'Speed lines'],
  streakLen:   ['Length', 'px', 'Length of each streak.', 'Speed lines'],
  streakTravel:['Travel', 'px', 'How far each streak moves across.', 'Speed lines'],
  streakWidth: ['Thickness', 'px', 'Streak thickness.', 'Speed lines'],
  streakCurve: ['Curve', '×', 'How much each streak bows. 0 is straight.', 'Speed lines'],
  spreadY:     ['Fan height', 'px', 'Vertical spread of the streak fan.', 'Speed lines'],

  arcHeight:   ['Height', '×', 'Bracket height relative to the row.', 'Flank brackets'],
  arcBulge:    ['Bulge', 'px', 'How far a bracket bows outward.', 'Flank brackets'],
  arcWidth:    ['Thickness', 'px', 'Bracket stroke thickness.', 'Flank brackets'],
  arcTravel:   ['Drift', 'px', 'How far the brackets drift while drawn.', 'Flank brackets'],
  edgeOut:     ['Push-out', 'px', 'How far outside the row the brackets sit.', 'Flank brackets'],

  washAlpha:   ['Wash opacity', 'opacity', 'How strongly the row itself tints. 0 removes the wash.', 'Row wash'],
  washPad:     ['Wash padding', 'px', 'How far the wash extends past the row.', 'Row wash'],

  impactSize:  ['Ring size', 'px', 'Diameter of the impact ring on each card. 0 removes it.', 'Impact'],
  impactMs:    ['Ring time', 'ms', 'How long that ring lasts.', 'Impact'],
  impactAlpha: ['Ring opacity', 'opacity', 'Opacity of the impact ring.', 'Impact'],
  sparkCount:  ['Sparkle count', undefined, 'How many sparkles land on each card. 0 removes them.', 'Impact'],
  sparkSize:   ['Sparkle size', 'px', 'Size of each sparkle.', 'Impact'],
  sparkLife:   ['Sparkle lifetime', 'ms', 'How long one sparkle lasts.', 'Impact'],
  sparkRise:   ['Sparkle rise', 'px', 'How far sparkles lift as they fade.', 'Impact'],

  liftPx:      ['Lift distance', 'px', 'How far each card lifts as the gust reaches it.', 'Card lift'],
  liftDeg:     ['Rock', '°', 'How far each card rocks.', 'Card lift'],
  liftMs:      ['Lift time', 'ms', 'How long one card’s lift takes.', 'Card lift'],
  liftStagger: ['Lift stagger', 'ms', 'Delay between neighbouring cards lifting, so the row ripples.', 'Card lift'],

  coreAlpha:   ['Core opacity', 'opacity', 'Opacity of the bright core stroke.', 'Stroke'],
  glowWidth:   ['Glow width', 'px', 'Thickness of the glow around it. 0 removes it.', 'Stroke'],
  glowAlpha:   ['Glow opacity', 'opacity', 'Opacity of that glow.', 'Stroke'],
  taper:       ['Taper strokes', undefined, 'Whether strokes narrow toward their tips instead of holding one width.', 'Stroke'],
  colorCore:   ['Core colour', undefined, 'Colour of the core stroke.', 'Stroke'],
  colorGlow:   ['Glow colour', undefined, 'Colour of the glow around it.', 'Stroke'],
};

/** Declaration order IS render order; the toggle and colours sit inside the Stroke run. */
const ORDER: (keyof GustFxConfig)[] = [
  'sweepMs', 'staggerMs', 'arcMs', 'holdMs', 'fadeMs',
  'streaks', 'streakLen', 'streakTravel', 'streakWidth', 'streakCurve', 'spreadY',
  'arcHeight', 'arcBulge', 'arcWidth', 'arcTravel', 'edgeOut',
  'washAlpha', 'washPad',
  'impactSize', 'impactMs', 'impactAlpha', 'sparkCount', 'sparkSize', 'sparkLife', 'sparkRise',
  'liftPx', 'liftDeg', 'liftMs', 'liftStagger',
  'coreAlpha', 'glowWidth', 'glowAlpha', 'taper', 'colorCore', 'colorGlow',
];

const controls: TunerControl<Extract<keyof GustFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = GUSTFX_RANGES[key]!;
  if (key === 'taper') {
    return { key, label, hint, group, kind: 'toggle' as const, min, max, step, onValue: 1, offValue: 0 };
  }
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<GustFxConfig> = {
  id: 'gustfx',                     // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Buff Gust',
  note: 'dev · next gust · drag',
  read: getGustFxConfig,
  write: (key, value) => setGustFxValue(key, value),
  writeColor: (key, value) => setGustFxValue(key, value),
  reset: resetGustFxConfig,
  defaults: GUSTFX_DEFAULTS,
  controls,
  actions: [{
    label: '▶ Test',
    hint: 'Fires the gust over the current shop row — no Fodder buff needed.',
    run: () => testGustFx(),
  }],
};

export function GustFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
