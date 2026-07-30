import {
  STEPPROCFX_COLOR_KEYS, STEPPROCFX_RANGES,
  getStepProcFxConfig, getStepProcFxDefaults, resetStepProcFxConfig, setStepProcFxValue,
  type StepProcFxConfig,
} from './stepProcFxConfig';
import { testStepProcFx } from './fxTestFire';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the STEP PROC flourish — the rising arrow fan and mote blast that fire FROM a unit's
 * step-counter pill the moment its counter fills (Avenge, Guel, Flowing Monk, Crypt Drake, Bloodbinder, the
 * gold and buy meters, cadence cards, Spirit Pup, Tara's ascend).
 *
 * Deliberately SEPARATE from the Spell Power tuner even though both drive the same primitive, so the counter
 * flourish can be sized on its own (owner ask). There is also no floating number here by design — a step proc has
 * no natural stat gain to print.
 *
 * Applies to the NEXT proc, so Test fires it from a real counter pill on screen (falling back to the shop row)
 * rather than making you stage one.
 */
const COLOR_SET = new Set<string>(STEPPROCFX_COLOR_KEYS.map(String));

const SPECS: Record<keyof StepProcFxConfig, [string, TunerUnit | undefined, string, string]> = {
  arrowCount:    ['Count', undefined, 'How many arrows rise in the fan. 0 removes them.', 'Arrow fan'],
  arrowRise:     ['Rise distance', 'px', 'How far the arrows travel upward.', 'Arrow fan'],
  arrowSpread:   ['Fan width', 'px', 'How wide the fan spreads at its top.', 'Arrow fan'],
  arrowLen:      ['Shaft length', 'px', 'Length of each arrow shaft.', 'Arrow fan'],
  arrowWidth:    ['Shaft thickness', 'px', 'Thickness of each shaft.', 'Arrow fan'],
  arrowHead:     ['Head size', 'px', 'Size of each arrowhead. 0 leaves bare shafts.', 'Arrow fan'],
  arrowMs:       ['Rise time', 'ms', 'How long one arrow takes to rise and fade.', 'Arrow fan'],
  arrowStagger:  ['Stagger', 'ms', 'Delay between one arrow launching and the next.', 'Arrow fan'],
  arrowDrift:    ['Side drift', 'px', 'How far arrows wander sideways as they rise.', 'Arrow fan'],
  arrowFadeAt:   ['Fade starts at', 'opacity', 'How far through its rise an arrow begins to fade. 0 fades from the start.', 'Arrow fan'],

  blastCount:    ['Count', undefined, 'How many motes burst from the counter pill. 0 removes them.', 'Mote blast'],
  blastSpeed:    ['Speed', 'px/s', 'Initial mote speed.', 'Mote blast'],
  blastSize:     ['Size', 'px', 'Size of each mote.', 'Mote blast'],
  blastLife:     ['Lifetime', 'ms', 'How long one mote lasts.', 'Mote blast'],
  blastSpread:   ['Cone width', '°', 'Width of the cone the motes fire into. 360 is all directions.', 'Mote blast'],
  blastAngle:    ['Cone aim', '°', 'Which way that cone points.', 'Mote blast'],
  blastRise:     ['Upward kick', 'px', 'Extra upward push on every mote, on top of the cone.', 'Mote blast'],
  blastGravity:  ['Gravity', 'px', 'How far motes are dragged back down over their flight.', 'Mote blast'],
  blastDrag:     ['Drag', 'opacity', 'How quickly motes lose speed. 0 coasts forever.', 'Mote blast'],
  blastJitter:   ['Speed variance', 'opacity', 'Randomness in mote speed, so they do not move as one.', 'Mote blast'],
  blastSpin:     ['Spin', '°', 'Mote rotation speed, in degrees per second.', 'Mote blast'],
  blastStagger:  ['Stagger', 'ms', 'Largest random launch delay across the motes.', 'Mote blast'],
  blastShrink:   ['End size', 'opacity', 'Mote size at the end of its life, as a fraction of its start. 0 shrinks to nothing.', 'Mote blast'],

  glowAlpha:     ['Glow opacity', 'opacity', 'Opacity of the glow around arrows and motes.', 'Glow'],
  glowWidth:     ['Glow width', 'px', 'Thickness of that glow. 0 removes it.', 'Glow'],

  colorA:        ['Hue slot 1', undefined, 'First of three hues cycled across the arrows and motes.', 'Colours'],
  colorB:        ['Hue slot 2', undefined, 'Second of three hues cycled across them.', 'Colours'],
  colorC:        ['Hue slot 3', undefined, 'Third of three hues cycled across them.', 'Colours'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof StepProcFxConfig)[] = [
  'arrowCount', 'arrowRise', 'arrowSpread', 'arrowLen', 'arrowWidth', 'arrowHead', 'arrowMs', 'arrowStagger', 'arrowDrift', 'arrowFadeAt',
  'blastCount', 'blastSpeed', 'blastSize', 'blastLife', 'blastSpread', 'blastAngle', 'blastRise', 'blastGravity',
  'blastDrag', 'blastJitter', 'blastSpin', 'blastStagger', 'blastShrink',
  'glowAlpha', 'glowWidth',
  'colorA', 'colorB', 'colorC',
];

const controls: TunerControl<Extract<keyof StepProcFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = STEPPROCFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<StepProcFxConfig> = {
  id: 'stepprocfx',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Step Proc',
  note: 'dev · next proc · drag',
  read: getStepProcFxConfig,
  write: (key, value) => setStepProcFxValue(key, value),
  writeColor: (key, value) => setStepProcFxValue(key, value),
  reset: resetStepProcFxConfig,
  // This config exposes its shipped values through a getter rather than a const.
  defaults: getStepProcFxDefaults(),
  controls,
  actions: [{
    label: '▶ Test',
    hint: 'Fires the flourish from a step counter on screen, falling back to the shop row — no proc needed.',
    run: () => testStepProcFx(),
  }],
};

export function StepProcFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
