import {
  SPELLPOWERFX_COLOR_KEYS, SPELLPOWERFX_RANGES,
  getSpellPowerFxConfig, getSpellPowerFxDefaults, resetSpellPowerFxConfig, setSpellPowerFxValue,
  type SpellPowerFxConfig,
} from './spellPowerFxConfig';
import { testSpellPowerFx } from './fxTestFire';
import { FLOURISH_ORDER_WITH_NUMBER, FLOURISH_SPECS } from './flourishSpecs';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec } from './tunerSchema';

/**
 * DEV-only tuner for the SPELL POWER flourish — the rising arrow fan, the origin mote blast, and the floating
 * power number, fired when a spell resolves. Applies to the NEXT cast, so Test fires it over the shop row rather
 * than making you stage a spell.
 *
 * Its controls come from the SHARED flourish vocabulary in `flourishSpecs.ts`, which Ruby Power and Step Proc
 * also use: the three panels drive the same primitive with identical keys and are separate only so each can be
 * sized on its own. Defining the labels once is what stops them drifting apart.
 */
const COLOR_SET = new Set<string>(SPELLPOWERFX_COLOR_KEYS.map(String));

const controls: TunerControl<Extract<keyof SpellPowerFxConfig, string>>[] =
  FLOURISH_ORDER_WITH_NUMBER.map((key) => {
    const [label, unit, hint, group] = FLOURISH_SPECS[key];
    if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
    const [min, max, step] = SPELLPOWERFX_RANGES[key as keyof typeof SPELLPOWERFX_RANGES]!;
    // `numShow` is stored as 0/1 — a checkbox, not a two-stop slider.
    if (key === 'numShow') {
      return { key, label, hint, group, kind: 'toggle' as const, min, max, step, onValue: 1, offValue: 0 };
    }
    return { key, label, unit, hint, group, min, max, step };
  });

const SPEC: TunerSpec<SpellPowerFxConfig> = {
  id: 'spellpowerfx',               // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Spell Power',
  note: 'dev · next cast · drag',
  read: getSpellPowerFxConfig,
  write: (key, value) => setSpellPowerFxValue(key, value),
  writeColor: (key, value) => setSpellPowerFxValue(key, value),
  reset: resetSpellPowerFxConfig,
  defaults: getSpellPowerFxDefaults(),
  controls,
  actions: [{
    label: '▶ Test',
    hint: 'Fires the flourish over the current shop row — no spell needed.',
    run: () => testSpellPowerFx(),
  }],
};

export function SpellPowerFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
