import { SMOKE_DEFAULTS, SMOKE_RANGES, getSmokeConfig, resetSmokeConfig, setSmokeValue, type SmokeConfig } from './smokeConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the board's soft smoke and the strike-point energy pulse. Two separate effects share this
 * panel, which is why the sections matter here more than most. Values persist to localStorage and apply to the
 * NEXT impact, so land a hit to judge a change.
 *
 * Two effects that used to have sections here are authored defs now, tuned in the FX workbench instead: the
 * card-drop footprint billow (`fx/defs/landing-dust.json`) and the strike-point dust
 * (`fx/defs/impact-dust.json`).
 *
 * LANGUAGE. The old labels prefixed every one to fake grouping ("smoke · count", "impact dust · life ms") and
 * used "alpha" for three different things across three different effects. Groups are real now, so a label only
 * has to name its own property, and each is scoped by the section it sits under.
 */
const SPECS: Record<keyof SmokeConfig, [string, TunerUnit | undefined, string, string]> = {
  smokeCount:     ['Puff count', undefined, 'How many smoke puffs an impact throws.', 'Combat impact smoke'],
  smokeRise:      ['Rise', 'px', 'How far the smoke lifts as it fades. 0 keeps it flat.', 'Combat impact smoke'],
  smokeDrift:     ['Spread', 'px', 'How far the puffs billow outward from the hit.', 'Combat impact smoke'],
  smokeLife:      ['Lifetime', 'ms', 'How long one puff lasts before it has fully faded.', 'Combat impact smoke'],
  smokeGrow:      ['Expansion', '×', 'How much a puff grows over its life.', 'Combat impact smoke'],
  smokeAlpha:     ['Opacity', 'opacity', 'Peak opacity of the smoke.', 'Combat impact smoke'],
  impPulseRadius: ['Ring radius', 'px', 'How far the energy ring expands from the strike point.', 'Strike-point pulse'],
  impPulseDur:    ['Ring lifetime', 'ms', 'How long a ring takes to expand and fade.', 'Strike-point pulse'],
  impPulseRings:  ['Ring count', undefined, 'How many rings fire. 0 disables the pulse entirely.', 'Strike-point pulse'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof SmokeConfig)[] = [
  'smokeCount', 'smokeRise', 'smokeDrift', 'smokeLife', 'smokeGrow', 'smokeAlpha',
  'impPulseRadius', 'impPulseDur', 'impPulseRings',
];

const controls: TunerControl<Extract<keyof SmokeConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = SMOKE_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<SmokeConfig> = {
  id: 'smoke',                      // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Smoke & Dust',
  note: 'dev · next impact · drag',
  read: getSmokeConfig,
  write: setSmokeValue,
  reset: resetSmokeConfig,
  defaults: SMOKE_DEFAULTS,
  controls,
};

export function SmokeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
