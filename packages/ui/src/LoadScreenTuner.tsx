import {
  LOADSCREEN_COLOR_KEYS, LOADSCREEN_DEFAULTS, LOADSCREEN_DESC, LOADSCREEN_RANGES,
  getLoadScreenConfig, resetLoadScreenConfig, setLoadScreenValue, toggleLoadScreenPreview,
  type LoadScreenConfig, type LoadScreenNumKey,
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
const LABELS: Record<LoadScreenNumKey, [string, TunerUnit | undefined]> = {
  iconSize:  ['Icon size', 'px'],
  barWidth:  ['Bar width', 'px'],
  barHeight: ['Bar height', 'px'],
  barBottom: ['Bar bottom', 'vh'],
  gradSize:  ['Gradient size', '%'],
  gradPosX:  ['Gradient X', '%'],
  gradPosY:  ['Gradient Y', '%'],
};
const GROUP: Record<keyof LoadScreenConfig, string> = {
  iconSize: 'Icon', barWidth: 'Load bar', barHeight: 'Load bar', barBottom: 'Load bar',
  gradCenter: 'Background', gradEdge: 'Background', gradSize: 'Background', gradPosX: 'Background', gradPosY: 'Background',
};
const ORDER: (keyof LoadScreenConfig)[] = ['iconSize', 'barWidth', 'barHeight', 'barBottom', 'gradCenter', 'gradEdge', 'gradSize', 'gradPosX', 'gradPosY'];

const controls: TunerControl<Extract<keyof LoadScreenConfig, string>>[] = ORDER.map((key) => {
  const hint = LOADSCREEN_DESC[key];
  const group = GROUP[key];
  if ((LOADSCREEN_COLOR_KEYS as readonly string[]).includes(key)) {
    const label = key === 'gradCenter' ? 'Centre colour' : 'Edge colour';
    return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  }
  const [label, unit] = LABELS[key as LoadScreenNumKey];
  const [min, max, step] = LOADSCREEN_RANGES[key as LoadScreenNumKey];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<LoadScreenConfig> = {
  id: 'loadscreen',                 // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Load Screen',
  note: 'dev · boot splash',
  read: getLoadScreenConfig,
  write: (key, value) => setLoadScreenValue(key, value),
  writeColor: (key, value) => setLoadScreenValue(key, value),
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
