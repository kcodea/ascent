import { SMOKE_DEFAULTS, SMOKE_RANGES, getSmokeConfig, resetSmokeConfig, setSmokeValue, type SmokeConfig } from './smokeConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the strike-point energy pulse. Values persist to localStorage and apply to the NEXT
 * impact, so land a hit to judge a change.
 *
 * It used to carry four effects; three are authored defs now, tuned in the FX workbench instead — the
 * card-drop footprint billow (`fx/defs/landing-dust.json`), the strike-point dust
 * (`fx/defs/impact-dust.json`) and the impact SMOKE (the "warm smoke" layer of
 * `fx/defs/strike-impact.json`). The pulse is the last one still hand-written, and the sibling "Lunge Impact"
 * panel that mirrored these controls went with `pixiFx.impact`, so this is now the only place they live.
 *
 * LANGUAGE. The old labels prefixed every one to fake grouping ("smoke · count", "impact dust · life ms") and
 * used "alpha" for three different things across three different effects. Groups are real now, so a label only
 * has to name its own property, and each is scoped by the section it sits under.
 */
const SPECS: Record<keyof SmokeConfig, [string, TunerUnit | undefined, string, string]> = {
  impPulseRadius: ['Ring radius', 'px', 'How far the energy ring expands from the strike point.', 'Strike-point pulse'],
  impPulseDur:    ['Ring lifetime', 'ms', 'How long a ring takes to expand and fade.', 'Strike-point pulse'],
  impPulseRings:  ['Ring count', undefined, 'How many rings fire. 0 disables the pulse entirely.', 'Strike-point pulse'],
};

/** Declaration order IS render order, and controls sharing a group render together under its heading. */
const ORDER: (keyof SmokeConfig)[] = ['impPulseRadius', 'impPulseDur', 'impPulseRings'];

const controls: TunerControl<Extract<keyof SmokeConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  const [min, max, step] = SMOKE_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

const SPEC: TunerSpec<SmokeConfig> = {
  id: 'smoke',                      // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Strike pulse',
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
