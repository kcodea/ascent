import {
  CC_RANGES, COMBAT_CTL_DEFAULTS,
  getCombatCtlConfig, resetCombatCtlConfig, setCombatCtlValue,
  type CombatCtlConfig,
} from './combatCtlConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only look tuner for the three combat-control chips — the Summary pill, the End Combat pill and the Skip
 * button. Values write to CSS vars live (`combatCtlConfig.applyCombatCtlVars`), so the NEXT render shows the
 * change; open a combat replay to see them. "Copy values" grabs the JSON; ship a look by pasting it into the
 * config DEFAULTS and mirroring the styles.css `--cc-*` fallbacks.
 */
type Key = Extract<keyof CombatCtlConfig, string>;
type NumKey = keyof typeof CC_RANGES;

const ELEMENTS: { prefix: 'sum' | 'end' | 'skip'; group: string; scaled: boolean }[] = [
  { prefix: 'sum', group: 'Summary pill', scaled: false },
  { prefix: 'end', group: 'End Combat pill', scaled: false },
  { prefix: 'skip', group: 'Skip button', scaled: true }, // Skip size/radius are × --u multipliers, not px
];

const controls: TunerControl<Key>[] = ELEMENTS.flatMap(({ prefix, group, scaled }) => {
  const range = (k: NumKey): [number, number, number] => CC_RANGES[k];
  const sizeUnit: TunerUnit = scaled ? '×' : 'px';
  const [sMin, sMax, sStep] = range(`${prefix}Size` as NumKey);
  const [rMin, rMax, rStep] = range(`${prefix}Radius` as NumKey);
  const [bMin, bMax, bStep] = range(`${prefix}BorderW` as NumKey);
  return [
    { key: `${prefix}Size` as Key, label: 'Text size', unit: sizeUnit, hint: 'Font size of the label.', group, min: sMin, max: sMax, step: sStep },
    { key: `${prefix}Radius` as Key, label: 'Corner radius', unit: sizeUnit, hint: 'Roundness of the corners.', group, min: rMin, max: rMax, step: rStep },
    { key: `${prefix}BorderW` as Key, label: 'Border width', unit: 'px', hint: 'Thickness of the outline.', group, min: bMin, max: bMax, step: bStep },
    { key: `${prefix}Bg` as Key, label: 'Background', hint: 'Fill colour. The two pills derive a subtle top→darker gradient from it.', group, kind: 'color', min: 0, max: 0, step: 0 },
    { key: `${prefix}Text` as Key, label: 'Text colour', hint: 'Label colour.', group, kind: 'color', min: 0, max: 0, step: 0 },
    { key: `${prefix}Border` as Key, label: 'Outline colour', hint: 'Border colour (and the drop-shadow, for Skip).', group, kind: 'color', min: 0, max: 0, step: 0 },
  ];
});

export const SPEC: TunerSpec<CombatCtlConfig> = {
  id: 'combatctl',
  title: 'Combat Controls',
  note: 'dev · combat · live',
  read: getCombatCtlConfig,
  write: setCombatCtlValue,
  writeColor: setCombatCtlValue,
  reset: resetCombatCtlConfig,
  defaults: COMBAT_CTL_DEFAULTS,
  controls,
};

export function CombatCtlTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
