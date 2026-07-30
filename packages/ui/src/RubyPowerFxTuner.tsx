import {
  RUBYPOWERFX_COLOR_KEYS, RUBYPOWERFX_RANGES,
  getRubyPowerFxConfig, getRubyPowerFxDefaults, resetRubyPowerFxConfig, setRubyPowerFxValue,
  type RubyPowerFxConfig,
} from './rubyPowerFxConfig';
import { testRubyPowerFx } from './fxTestFire';
import { FLOURISH_ORDER_WITH_NUMBER, FLOURISH_SPECS } from './flourishSpecs';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the RUBY POWER flourish — the rising arrow fan, the origin mote blast, and the floating
 * power number, fired when a Ruby's strength is shown. Applies to the NEXT cast, so Test fires it over the shop
 * row rather than making you stage one.
 *
 * Its controls come from the SHARED flourish vocabulary in `flourishSpecs.ts`, which Spell Power and Step Proc
 * also use: the three panels drive the same primitive with identical keys and are separate only so each can be
 * sized on its own.
 */
const COLOR_SET = new Set<string>(RUBYPOWERFX_COLOR_KEYS.map(String));

const controls: TunerControl<Extract<keyof RubyPowerFxConfig, string>>[] =
  FLOURISH_ORDER_WITH_NUMBER.map((key) => {
    const [label, unit, hint, group] = FLOURISH_SPECS[key];
    if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
    const [min, max, step] = RUBYPOWERFX_RANGES[key as keyof typeof RUBYPOWERFX_RANGES]!;
    // `numShow` is stored as 0/1 — a checkbox, not a two-stop slider.
    if (key === 'numShow') {
      return { key, label, hint, group, kind: 'toggle' as const, min, max, step, onValue: 1, offValue: 0 };
    }
    return { key, label, unit, hint, group, min, max, step };
  });

const SPEC: TunerSpec<RubyPowerFxConfig> = {
  id: 'rubypowerfx',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Ruby Power',
  note: 'dev · next cast · drag',
  read: getRubyPowerFxConfig,
  write: (key, value) => setRubyPowerFxValue(key, value),
  writeColor: (key, value) => setRubyPowerFxValue(key, value),
  reset: resetRubyPowerFxConfig,
  defaults: getRubyPowerFxDefaults(),
  controls,
  actions: [{
    label: '▶ Test',
    hint: 'Fires the flourish over the current shop row — no Ruby buff needed.',
    run: () => testRubyPowerFx(),
  }],
};

export function RubyPowerFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
