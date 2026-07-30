import {
  WELDFX_DEFAULTS, WELDFX_RANGES, getWeldFxConfig, resetWeldFxConfig, setWeldFxValue, type WeldFxConfig,
} from './weldFxConfig';
import { testWeldFx } from './fxTestFire';
import { TunerPanel } from './TunerPanel';
import type { TunerAction, TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the WELD cue — an Attachment fusing onto its host minion: a ring that eases in and
 * CONVERGES on the card, a flash with rising sparks when it lands, and a wiggle on the host at impact. These
 * replaced the old generic green buff-burst and "+X/+Y" float, both now suppressed on a weld.
 *
 * TWO KINDS SHARE THESE DIALS, scaled by their own multipliers: `play` is a hand-played Attachment landing after
 * its slide-in; `auto` is one that welds itself (Banksly/Beatbot, Combinator, Cling Drones, Money Bots). That is
 * what the two Test buttons and the two scale controls are for. The old panel had a kind RADIO plus one Test
 * button; two buttons do the same job in one click and need no panel-local state.
 *
 * COLOURS ARE NOT DIALS here — `WELD_COLORS` is a fixed constant in the config, deliberately, so every weld
 * reads as the same gold event.
 */
const SPECS: Record<keyof WeldFxConfig, [string, TunerUnit | undefined, string, string]> = {
  ringStart:     ['Start radius', 'px', 'How far out the ring begins before converging.', 'Converging ring'],
  ringEnd:       ['End radius', 'px', 'Where the ring finishes. 0 collapses it fully onto the card.', 'Converging ring'],
  ringMs:        ['Converge time', 'ms', 'How long the ring takes to close.', 'Converging ring'],
  ringWidth:     ['Thickness', 'px', 'Ring stroke thickness.', 'Converging ring'],
  ringAlpha:     ['Opacity', 'opacity', 'Ring opacity.', 'Converging ring'],
  ringGlowWidth: ['Halo width', 'px', 'Soft halo around the ring. 0 removes it.', 'Converging ring'],
  easeStart:     ['Easing in', 'opacity', 'How hard the ring accelerates as it starts closing.', 'Converging ring'],
  easeFinish:    ['Easing out', 'opacity', 'How hard it decelerates as it lands.', 'Converging ring'],

  ringSides:     ['Sides', undefined, 'Polygon sides for the ring. 0 draws a circle.', 'Ring shape'],
  ringAspect:    ['Aspect', '×', 'Stretches the ring into an ellipse or oblong.', 'Ring shape'],
  ringRotation:  ['Rotation', '°', 'Fixed rotation of the shape.', 'Ring shape'],
  ringSpin:      ['Spin over close', '°', 'How far the shape rotates during its whole convergence. Negative spins the other way.', 'Ring shape'],

  spokeCount:    ['Count', undefined, 'How many spokes point inward from the ring. 0 removes them.', 'Spokes'],
  spokeLen:      ['Length', 'px', 'Spoke length.', 'Spokes'],
  spokeWidth:    ['Thickness', 'px', 'Spoke thickness.', 'Spokes'],
  spokeAlpha:    ['Opacity', 'opacity', 'Spoke opacity.', 'Spokes'],
  spokeGap:      ['Gap from card', 'px', 'Distance the spokes stop short of the card.', 'Spokes'],

  flashSize:     ['Size', 'px', 'Diameter of the landing flash. 0 removes it.', 'Landing flash'],
  flashMs:       ['Time', 'ms', 'How long the flash lasts.', 'Landing flash'],
  flashAlpha:    ['Opacity', 'opacity', 'Flash opacity.', 'Landing flash'],

  sparkCount:    ['Count', undefined, 'How many sparks rise on landing. 0 removes them.', 'Sparks'],
  sparkSpeed:    ['Rise speed', 'px/s', 'How fast the sparks rise.', 'Sparks'],
  sparkSpread:   ['Spread', 'px', 'How wide the sparks scatter.', 'Sparks'],
  sparkSize:     ['Size', 'px', 'Size of each spark.', 'Sparks'],
  sparkLife:     ['Lifetime', 'ms', 'How long one spark lasts.', 'Sparks'],
  sparkGravity:  ['Gravity', 'px', 'How far sparks are pulled back down. Negative keeps lifting them.', 'Sparks'],

  wiggleMs:      ['Time', 'ms', 'How long the host minion wiggles on impact. 0 removes the wiggle.', 'Host wiggle'],
  wigglePx:      ['Shake distance', 'px', 'How far the host shakes.', 'Host wiggle'],
  wiggleDeg:     ['Rotation', '°', 'How far the host rocks.', 'Host wiggle'],
  wiggleScale:   ['Bounce', '×', 'How much the host bounces in size.', 'Host wiggle'],

  playScale:     ['Hand-played size', '×', 'Scales the whole effect for a hand-played Attachment, after its slide-in.', 'Per-kind scale'],
  autoScale:     ['Self-welding size', '×', 'Scales it for an Attachment that welds itself — Banksly/Beatbot, Combinator, Cling Drones, Money Bots.', 'Per-kind scale'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof WeldFxConfig)[] = [
  'ringStart', 'ringEnd', 'ringMs', 'ringWidth', 'ringAlpha', 'ringGlowWidth', 'easeStart', 'easeFinish',
  'ringSides', 'ringAspect', 'ringRotation', 'ringSpin',
  'spokeCount', 'spokeLen', 'spokeWidth', 'spokeAlpha', 'spokeGap',
  'flashSize', 'flashMs', 'flashAlpha',
  'sparkCount', 'sparkSpeed', 'sparkSpread', 'sparkSize', 'sparkLife', 'sparkGravity',
  'wiggleMs', 'wigglePx', 'wiggleDeg', 'wiggleScale',
  'playScale', 'autoScale',
];

const controls: TunerControl<Extract<keyof WeldFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = WELDFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

const actions: TunerAction[] = (['play', 'auto'] as const).map((kind) => ({
  label: `▶ ${kind}`,
  hint: kind === 'play'
    ? 'Fires the weld as a hand-played Attachment on your left-most board minion — no Attachment needed.'
    : 'Fires the weld as a self-welding Attachment on your left-most board minion.',
  run: () => testWeldFx(kind),
}));

export const SPEC: TunerSpec<WeldFxConfig> = {
  id: 'weldfx',                     // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Weld',
  note: 'dev · next weld · drag',
  read: getWeldFxConfig,
  write: setWeldFxValue,
  reset: resetWeldFxConfig,
  defaults: WELDFX_DEFAULTS,
  controls,
  actions,
};

export function WeldFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
