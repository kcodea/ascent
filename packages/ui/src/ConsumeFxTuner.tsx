import {
  CONSUMEFX_DEFAULTS, CONSUMEFX_RANGES,
  getConsumeFxConfig, resetConsumeFxConfig, setConsumeFxValue, type ConsumeFxConfig,
} from './consumeFxConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the CONSUME effect — the eaten minion's ghost that shakes, stretches like taffy, and is
 * pulled into the eater before it vanishes. Reads its config at fire time, so edits apply to the NEXT eat:
 * play a consume minion (or triple into one) to judge.
 *
 * `showStats` is a genuine boolean rather than a dialled number, so it renders as the schema's toggle rather
 * than a slider — the checkbox flips whether the ghost still shows the eaten minion's attack/health as it goes.
 */
const SPECS: Record<keyof ConsumeFxConfig, [string, TunerUnit | undefined, string, string]> = {
  durationMs: ['Duration', 'ms', 'How long the whole eat takes, start to vanish.', 'Timing'],

  shakeAmp:   ['Shake amount', 'px', 'How far the ghost jitters at the shake peak.', 'Shake'],
  shakeFreq:  ['Shake speed', undefined, 'How many shake oscillations per second.', 'Shake'],

  stretch:    ['Stretch', '×', 'Taffy elongation DOWNWARD — the bottom leads toward the eater.', 'Taffy'],
  thin:       ['Thinning', undefined, 'How much the ghost narrows across while it stretches down.', 'Taffy'],
  lag:        ['Top lag', undefined, 'How long the top waits before it follows the bottom (0 = the whole card moves together, higher = the bottom leads more).', 'Taffy'],

  pullDist:   ['Pull distance', undefined, 'Fraction of the ghost→eater path the ghost travels. 1 reaches the eater.', 'Pull'],

  showStats:  ['Show stats', undefined, 'Whether the eaten minion’s attack/health still show on the ghost as it goes.', 'Stats'],
};

/** Declaration order IS render order; controls sharing a group render together under its heading. */
const ORDER: (keyof ConsumeFxConfig)[] = [
  'durationMs',
  'shakeAmp', 'shakeFreq',
  'stretch', 'thin', 'lag',
  'pullDist',
  'showStats',
];

const controls: TunerControl<Extract<keyof ConsumeFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  // showStats is a boolean, not in CONSUMEFX_RANGES — render it as the schema's checkbox toggle.
  if (key === 'showStats') {
    return {
      key, label, hint, group, kind: 'toggle' as const,
      min: 0, max: 1, step: 1, onValue: 1, offValue: 0, onOffLabels: ['shown', 'hidden'] as [string, string],
    };
  }
  const [min, max, step] = CONSUMEFX_RANGES[key]!;
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<ConsumeFxConfig> = {
  id: 'consumefx',                  // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Consume',
  note: 'dev · next eat · drag',
  read: getConsumeFxConfig,
  write: (key, value) => setConsumeFxValue(key, value),
  reset: resetConsumeFxConfig,
  defaults: CONSUMEFX_DEFAULTS,
  controls,
};

export function ConsumeFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
