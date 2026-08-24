import {
  LOADSCREEN_DEFAULTS, LOADSCREEN_DESC, LOADSCREEN_RANGES,
  getLoadScreenConfig, resetLoadScreenConfig, setLoadScreenValue, toggleLoadScreenPreview,
  type LoadScreenConfig,
} from './loadScreenConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the BOOT LOAD SCREEN (owner ask 2026-08-24): resize the AscentIcon logo, and size +
 * position the fake 3.5s loading bar. "Toggle load screen" re-shows the splash on demand (the real one is gone
 * the instant boot finishes) so the changes can be judged live. Values persist to localStorage and reflect
 * through `--ls-*`; "Copy values" grabs the JSON to bake into the index.html CSS fallbacks + loadScreenConfig
 * DEFAULTS.
 */
const LABELS: Record<keyof LoadScreenConfig, [string, TunerUnit]> = {
  iconSize:  ['Icon size', 'px'],
  barWidth:  ['Bar width', 'px'],
  barHeight: ['Bar height', 'px'],
  barBottom: ['Bar bottom', 'vh'],
};
const GROUP: Record<keyof LoadScreenConfig, string> = {
  iconSize: 'Icon', barWidth: 'Load bar', barHeight: 'Load bar', barBottom: 'Load bar',
};
const ORDER: (keyof LoadScreenConfig)[] = ['iconSize', 'barWidth', 'barHeight', 'barBottom'];

const controls: TunerControl<Extract<keyof LoadScreenConfig, string>>[] = ORDER.map((key) => {
  const [label, unit] = LABELS[key];
  const [min, max, step] = LOADSCREEN_RANGES[key];
  return { key, label, unit, hint: LOADSCREEN_DESC[key], group: GROUP[key], min, max, step };
});

export const SPEC: TunerSpec<LoadScreenConfig> = {
  id: 'loadscreen',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Load Screen',
  note: 'dev · boot splash',
  read: getLoadScreenConfig,
  write: (key, value) => setLoadScreenValue(key, value),
  reset: resetLoadScreenConfig,
  defaults: LOADSCREEN_DEFAULTS,
  controls,
  actions: [
    { label: 'Toggle load screen', hint: 'Show/hide the boot splash so you can judge the icon + bar live.', run: () => { toggleLoadScreenPreview(); } },
  ],
};

export function LoadScreenTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
