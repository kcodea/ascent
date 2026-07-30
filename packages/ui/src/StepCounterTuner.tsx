import { SC_DEFAULTS, SC_RANGES, getStepCounterConfig, resetStepCounterConfig, setStepCounterValue, type StepCounterConfig } from './stepCounterConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the step counter — the white "X/N" numbers under a step-scaler card (Guel, Tara, Avenge
 * units, …). Values write to CSS variables live, so any counter already on the board moves immediately; put an
 * Avenge unit or Guel on your board to watch.
 *
 * Shipping a look here means pasting the values back as the CSS FALLBACKS in styles.css (`.stepcounter`
 * `font-size` / `left` / `bottom`), not into a config DEFAULTS block.
 *
 * LANGUAGE. `y` read "y / below (px)" — two candidate names and a unit in one label, and it still did not say
 * the thing that actually matters: the value is a CSS `bottom`, so MORE NEGATIVE moves the counter DOWN. That
 * now lives in the hint.
 */
const SPECS: Record<keyof StepCounterConfig, [string, TunerUnit | undefined, string]> = {
  size: ['Number size', 'px', 'Font size of the "X/N" counter.'],
  x:    ['Horizontal offset', 'px', 'Offset from centre. Positive moves right, negative moves left, 0 is centred under the card.'],
  y:    ['Vertical position', 'px', 'Distance below the card, as a CSS bottom value — MORE NEGATIVE sits lower, further below the card edge.'],
};

/** Declaration order IS render order. Three controls, so no sections. */
const ORDER: (keyof StepCounterConfig)[] = ['size', 'x', 'y'];

const controls: TunerControl<Extract<keyof StepCounterConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint] = SPECS[key];
  const [min, max, step] = SC_RANGES[key];
  return { key, label, unit, hint, min, max, step };
});

const SPEC: TunerSpec<StepCounterConfig> = {
  id: 'stepcounter',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Step Counter',
  note: 'dev · live · drag',
  read: getStepCounterConfig,
  write: setStepCounterValue,
  reset: resetStepCounterConfig,
  defaults: SC_DEFAULTS,
  controls,
};

export function StepCounterTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
