import {
  STEPPROCFX_COLOR_KEYS, STEPPROCFX_RANGES,
  getStepProcFxConfig, getStepProcFxDefaults, resetStepProcFxConfig, setStepProcFxValue,
  type StepProcFxConfig,
} from './stepProcFxConfig';
import { testStepProcFx } from './fxTestFire';
import { FLOURISH_SPECS } from './flourishSpecs';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the STEP PROC flourish — the rising arrow fan and mote blast that fire FROM a unit's
 * step-counter pill the moment its counter fills (Avenge, Guel, Flowing Monk, Crypt Drake, Bloodbinder, the gold
 * and buy meters, cadence cards, Spirit Pup, Tara's ascend).
 *
 * Deliberately SEPARATE from Spell Power even though both drive the same primitive, so the counter flourish can be
 * sized on its own (owner ask). Its controls come from the SHARED vocabulary in `flourishSpecs.ts` that both use,
 * so the two panels cannot drift into describing the same dial differently.
 *
 * It prints NO floating number by design — a step proc has no natural stat gain to show — which is why its order
 * below omits the number keys the other two carry.
 *
 * Applies to the NEXT proc, so Test fires it from a real counter pill on screen (falling back to the shop row).
 */
const COLOR_SET = new Set<string>(STEPPROCFX_COLOR_KEYS.map(String));

/** The flourish order minus the floating-number keys this effect does not have. */
const ORDER = [
  'arrowCount', 'arrowRise', 'arrowSpread', 'arrowLen', 'arrowWidth', 'arrowHead', 'arrowMs', 'arrowStagger', 'arrowDrift', 'arrowFadeAt',
  'blastCount', 'blastSpeed', 'blastSize', 'blastLife', 'blastSpread', 'blastAngle', 'blastRise', 'blastGravity',
  'blastDrag', 'blastJitter', 'blastSpin', 'blastStagger', 'blastShrink',
  'glowAlpha', 'glowWidth',
  'colorA', 'colorB', 'colorC',
] as const;

const controls: TunerControl<Extract<keyof StepProcFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = FLOURISH_SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = STEPPROCFX_RANGES[key as keyof typeof STEPPROCFX_RANGES]!;
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
