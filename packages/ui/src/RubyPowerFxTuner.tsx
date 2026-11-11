import {
  RUBYPOWERFX_COLOR_KEYS, RUBYPOWERFX_RANGES,
  getRubyPowerFxConfig, getRubyPowerFxDefaults, resetRubyPowerFxConfig, setRubyPowerFxValue,
  type RubyPowerFxConfig,
} from './rubyPowerFxConfig';
import { testRubyPowerFx, testRubyPowerFxOf } from './fxTestFire';
import { FLOURISH_ORDER_WITH_NUMBER, FLOURISH_SPECS } from './flourishSpecs';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the RUBY POWER cue — the "symbol +N" layout and the floating number, fired when your Rubies
 * get stronger. (The gem and symbol effects themselves are authored in the FX Workbench.) Applies to the NEXT cast, so Test fires it over the shop
 * row rather than making you stage one.
 *
 * Its controls come from the SHARED flourish vocabulary in `flourishSpecs.ts`, which Spell Power and Step Proc
 * also use: the three panels drive the same primitive with identical keys and are separate only so each can be
 * sized on its own.
 */
const COLOR_SET = new Set<string>(RUBYPOWERFX_COLOR_KEYS.map(String));

/** The "symbol +N" layout (owner 2026-11-10: "is there a way to turn this into a tuner?"). Ruby-only, so these
 *  live here and not in the shared flourish vocabulary. */
const LAYOUT: [Extract<keyof RubyPowerFxConfig, string>, string, string, TunerUnit?][] = [
  ['groupGap', 'Gap between stats', 'How far the Attack group and the Health group sit from the centre when both rose. A lone stat is centred.'],
  ['atkIconScale', 'Attack icon size', 'Size of the dagger, as a multiple of the size it was authored at in the workbench.', '×'],
  ['hpIconScale', 'Health icon size', 'Size of the heart, as a multiple of the size it was authored at in the workbench.', '×'],
  ['numSize', 'Number size', 'Size of the printed numbers.'],
  ['iconGap', 'Icon to number spacing', 'The space between an icon and its own number.'],
  ['symbolDy', 'Icon up / down', 'Nudges the icons up or down against their numbers. Negative is up.'],
  ['strikeDelay', 'Whoosh lead', 'How long the whoosh plays before the pickaxe strike, the gem, the icons and the numbers arrive.', 'ms'],
];
const layoutControls: TunerControl<Extract<keyof RubyPowerFxConfig, string>>[] = LAYOUT.map(([key, label, hint, unit]) => {
  const [min, max, step] = RUBYPOWERFX_RANGES[key as keyof typeof RUBYPOWERFX_RANGES]!;
  return { key, label, unit: unit ?? ('px' as TunerUnit), hint, group: 'Symbols and layout', min, max, step };
});

/** Only what the cue still draws: the arrow fan and the mote blast were replaced by the authored `ruby-buff` effects
 *  (owner 2026-11-10), so their controls would move nothing. The number's own controls stay. */
const LIVE = (key: string): boolean => (key.startsWith('num') && key !== 'numSize') || key === 'colorText' || key === 'colorOutline';

const numberControls: TunerControl<Extract<keyof RubyPowerFxConfig, string>>[] =
  FLOURISH_ORDER_WITH_NUMBER.filter(LIVE).map((key) => {
    const [label, unit, hint, group] = FLOURISH_SPECS[key];
    if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
    const [min, max, step] = RUBYPOWERFX_RANGES[key as keyof typeof RUBYPOWERFX_RANGES]!;
    // `numShow` is stored as 0/1 — a checkbox, not a two-stop slider.
    if (key === 'numShow') {
      return { key, label, hint, group, kind: 'toggle' as const, min, max, step, onValue: 1, offValue: 0 };
    }
    return { key, label, unit, hint, group, min, max, step };
  });

export const SPEC: TunerSpec<RubyPowerFxConfig> = {
  id: 'rubypowerfx',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Ruby Power',
  note: 'dev · next cast · drag',
  read: getRubyPowerFxConfig,
  write: (key, value) => setRubyPowerFxValue(key, value),
  writeColor: (key, value) => setRubyPowerFxValue(key, value),
  reset: resetRubyPowerFxConfig,
  defaults: getRubyPowerFxDefaults(),
  controls: [...layoutControls, ...numberControls],
  actions: [{
    label: '▶ Test',
    hint: 'Fires the cue over the current shop row with both stats (+2 Attack, +1 Health). No Ruby buff needed.',
    run: () => testRubyPowerFx(),
  }, {
    label: '▶ Attack only',
    hint: 'Fires the cue with Attack alone, to check the centred single group.',
    run: () => testRubyPowerFxOf(2, 0),
  }, {
    label: '▶ Health only',
    hint: 'Fires the cue with Health alone, to check the centred single group.',
    run: () => testRubyPowerFxOf(0, 2),
  }],
};

export function RubyPowerFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
