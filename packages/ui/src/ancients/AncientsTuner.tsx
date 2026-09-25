import { ANCIENT_IDS, type AncientId } from '@game/sim';
import { TunerPanel } from '../TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';
import { useGame } from '../store';
import { ANCIENTS_DEFAULTS, ANCIENTS_RANGES, getAncientsConfig, resetAncientsConfig, setAncientsValue, type AncientsConfig } from './ancientsConfig';
import { playAwakenDemo } from './ancientsFx';

/**
 * DEV ✦ ANCIENTS tuner (proof of concept 2026-09-25). The METER group is balance: moving it re-stamps the live
 * Scene Builder run's meter (the sim still does all the counting) and is what the next Set 3 sandbox starts with.
 * The rest is presentation. ▶ plays the awakening pick beat (the triple trail into the hero power + the split)
 * without touching run state; the Scene Builder's "Fill meter" plays the real thing end to end.
 */
type Key = keyof AncientsConfig;
const ROWS: [Key, string, TunerUnit | undefined, string, string][] = [
  ['cost', 'Points to fill', undefined, 'The meter fills up to this and then awakens. Re-stamps the live sandbox run.', 'Meter (balance)'],
  ['refresh', 'Points per refresh', undefined, 'Points one Shop refresh adds (paid or free).', 'Meter (balance)'],
  ['combat', 'Points per combat', undefined, 'Points one combat adds.', 'Meter (balance)'],
  ['ringScale', 'Ring size', '×', 'Ring diameter as a multiple of the hero-power button.', 'Ring'],
  ['ringWidth', 'Ring thickness', 'px', 'Thickness of the ring.', 'Ring'],
  ['fillMs', 'Fill sweep', 'ms', 'How long the arc takes to sweep to its new value.', 'Timing'],
  ['flashMs', 'Full flash', 'ms', 'The ring’s flash when it fills, before the Discover rises.', 'Timing'],
  ['dim', 'Shop dim', 'opacity', 'How much the Shop dims behind the awakening Discover.', 'Timing'],
  ['splitMs', 'Split reveal', 'ms', 'The Ancient’s half sliding into the hero power.', 'Timing'],
  ['shineMs', 'Shine sweep', 'ms', 'The one-shot shine across the split button. 0 turns it off.', 'Timing'],
  ['tickGain', 'Fill tick', 'opacity', 'Volume of the tick when points are added. 0 mutes it.', 'Sound'],
  ['revealGain', 'Awaken + reveal', 'opacity', 'Volume of the full-ring flash and the split reveal cues. 0 mutes them.', 'Sound'],
];

const controls: TunerControl<Key>[] = ROWS.map(([key, label, unit, hint, group]) => {
  const [min, max, step] = ANCIENTS_RANGES[key];
  return { key, label, unit, hint, group, min, max, step };
});

/** Push the meter's balance numbers into the live sandbox run (only a run that has Ancients, before it awakens). */
function restampLiveRun(key: Key, value: number): void {
  if (key !== 'cost' && key !== 'refresh' && key !== 'combat') return;
  const run = useGame.getState().run;
  const a = run?.ancientsEnabled ? run.ancients : undefined;
  if (!run || !a || a.picked || a.offer) return;
  const next = { ...a, [key]: value };
  if (key === 'cost') next.points = Math.min(a.points, Math.max(0, value - 1)); // never fill it by moving the dial
  useGame.setState({ run: { ...run, ancients: next } });
}

let demoIx = 0;
export const SPEC: TunerSpec<AncientsConfig> = {
  id: 'ancients', // FROZEN
  title: 'Ancients',
  note: 'dev · proof of concept',
  read: getAncientsConfig,
  write: (key, value) => { setAncientsValue(key, value); restampLiveRun(key, value); },
  reset: resetAncientsConfig,
  defaults: ANCIENTS_DEFAULTS,
  controls,
  actions: [
    {
      label: '▶ Awaken',
      hint: 'Plays the pick beat on the hero power: the triple trail flies an Ancient in and the button splits. Cycles the five. Run state is untouched.',
      run: () => { const id: AncientId = ANCIENT_IDS[demoIx++ % ANCIENT_IDS.length]!; playAwakenDemo(id); },
    },
  ],
};

export function AncientsTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
