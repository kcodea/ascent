import {
  BUFFFX_DEFAULTS, BUFFFX_RANGES, getBuffFxConfig, resetBuffFxConfig, setBuffFxValue, type BuffFxConfig,
} from './buffFxConfig';
import { testBuffFx } from './fxTestFire';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the BUFF effect — what plays on a minion when something buffs it: a ribbon descending onto
 * it and a pulse where it lands. Also carries the WAVE PACING used by itemised per-minion rewards on their
 * End-of-Turn beat (Blueprint Cache's "+2/+2 per Attachment", Rune of Spending / Action, Forsaken Speed).
 *
 * The wave model is the part worth understanding before touching the pacing dials: every eligible minion fires
 * inside the SAME wave — all the Mechs pulse together — and the gap separates the STEPS, so a wide board reads
 * one step at a time rather than as one indistinguishable flash.
 *
 * `waveMaxCount` had no entry in the old panel's label map, so it rendered as the raw variable name. It has a
 * real label and hint now.
 */
const SPECS: Record<keyof BuffFxConfig, [string, TunerUnit | undefined, string, string]> = {
  waveGapMs:      ['Gap between waves', 'ms', 'MINIMUM spacing between one wave and the next, so a wide board reads step by step.', 'Wave pacing'],
  waveMaxTotalMs: ['Maximum total', 'ms', 'Ceiling on the whole sequence. Waves compress to fit rather than running past it.', 'Wave pacing'],
  waveMaxCount:   ['Maximum waves', undefined, 'Most distinct waves allowed. Beyond this they coalesce, so a huge board cannot produce an endless drum roll.', 'Wave pacing'],

  startHeight:    ['Drop height', 'px', 'How far above the minion the ribbon starts.', 'Ribbon'],
  dropMs:         ['Drop time', 'ms', 'How long the ribbon takes to fall onto the minion.', 'Ribbon'],
  retractMs:      ['Retract time', 'ms', 'How long it takes to withdraw afterwards. 0 leaves it to fade instead.', 'Ribbon'],
  baseWidth:      ['Top width', 'px', 'Ribbon width at the top, where it enters.', 'Ribbon'],
  tipWidth:       ['Tip width', 'px', 'Ribbon width at the tip that touches the minion.', 'Ribbon'],
  coreAlpha:      ['Opacity', 'opacity', 'Ribbon opacity.', 'Ribbon'],

  ringCount:      ['Ring count', undefined, 'How many rings pulse out where the ribbon lands. 0 removes them.', 'Landing pulse'],
  ringSize:       ['Ring size', 'px', 'How far a ring expands.', 'Landing pulse'],
  ringWidth:      ['Ring thickness', 'px', 'Thickness of each ring.', 'Landing pulse'],
  ringMs:         ['Ring time', 'ms', 'How long a ring takes to expand and fade.', 'Landing pulse'],
  coreFlashSize:  ['Flash size', 'px', 'Diameter of the flash at the landing point. 0 removes it.', 'Landing pulse'],
  coreFlashMs:    ['Flash time', 'ms', 'How long that flash lasts.', 'Landing pulse'],

  sparkCount:     ['Count', undefined, 'How many sparks the landing throws. 0 removes them.', 'Sparks'],
  sparkSpeed:     ['Speed', 'px/s', 'How fast the sparks fly out.', 'Sparks'],
  sparkSize:      ['Size', 'px', 'Size of each spark.', 'Sparks'],
  sparkLife:      ['Lifetime', 'ms', 'How long one spark lasts.', 'Sparks'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof BuffFxConfig)[] = [
  'waveGapMs', 'waveMaxTotalMs', 'waveMaxCount',
  'startHeight', 'dropMs', 'retractMs', 'baseWidth', 'tipWidth', 'coreAlpha',
  'ringCount', 'ringSize', 'ringWidth', 'ringMs', 'coreFlashSize', 'coreFlashMs',
  'sparkCount', 'sparkSpeed', 'sparkSize', 'sparkLife',
];

const controls: TunerControl<Extract<keyof BuffFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = BUFFFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<BuffFxConfig> = {
  id: 'bufffx',                     // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Buff',
  note: 'dev · next buff · drag',
  read: getBuffFxConfig,
  write: setBuffFxValue,
  reset: resetBuffFxConfig,
  defaults: BUFFFX_DEFAULTS,
  controls,
  actions: [{ label: '▶ Test', hint: 'Plays the buff effect on a minion on the board.', run: () => testBuffFx() }],
};

export function BuffFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
