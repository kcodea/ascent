import { ANCIENT_IDS, type AncientId } from '@game/sim';
import { TunerPanel } from '../TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';
import { useGame } from '../store';
import { ANCIENTS_DEFAULTS, ANCIENTS_RANGES, getAncientsConfig, resetAncientsConfig, setAncientsValue, type AncientsFullConfig, type AncientsNumKey, ANCIENT_ART_IDS, ART_FIELDS } from './ancientsConfig';
import { playAwakenDemo, playGateDemo } from './ancientsFx';

/**
 * DEV ✦ ANCIENTS tuner (proof of concept 2026-09-25). The METER group is balance: moving it re-stamps the live
 * Scene Builder run's meter (the sim still does all the counting) and is what the next Set 3 sandbox starts with.
 * The rest is presentation. ▶ plays the awakening pick beat (the triple trail into the hero power + the split)
 * without touching run state; the Scene Builder's "Fill meter" plays the real thing end to end.
 */
type Key = keyof AncientsFullConfig;
const ROWS: [Key, string, TunerUnit | undefined, string, string, ('color' | 'toggle' | 'text')?][] = [
  ['cost', 'Points to fill', undefined, 'The meter fills up to this and then awakens. Re-stamps the live sandbox run.', 'Meter (balance)'],
  ['refresh', 'Points per refresh', undefined, 'Points one Shop refresh adds (paid or free).', 'Meter (balance)'],
  ['combat', 'Points per combat', undefined, 'Points one combat adds.', 'Meter (balance)'],
  ['ringWidth', 'Ring thickness', 'px', 'Thickness of the ring.', 'Ring'],
  ['ringOffset', 'Ring offset', 'px', 'Gap between the hero-power frame and the ring, so the two never read as one.', 'Ring'],
  ['trackColor', 'Empty track colour', undefined, 'Colour of the unfilled part of the ring.', 'Ring', 'color'],
  ['trackAlpha', 'Empty track opacity', 'opacity', 'How solid the unfilled part reads.', 'Ring'],
  ['fillFrom', 'Fill colour (tail)', undefined, 'The fill gradient where it starts, at 12 o’clock.', 'Ring', 'color'],
  ['fillTo', 'Fill colour (head)', undefined, 'The fill gradient toward its leading edge.', 'Ring', 'color'],
  ['capSize', 'Leading-edge dot', '×', 'Size of the bright dot at the head of the fill, relative to the ring. 0 hides it.', 'Ring'],
  ['ticks', 'Quarter ticks', undefined, 'Small marks on the track at each quarter.', 'Ring', 'toggle'],
  ['fillMs', 'Fill sweep', 'ms', 'How long the arc takes to sweep to its new value.', 'Timing'],
  ['flashMs', 'Full flash', 'ms', 'The ring’s flash when it fills, before the Discover rises.', 'Timing'],
  ['dim', 'Shop dim', 'opacity', 'How much the Shop dims behind the awakening Discover.', 'Timing'],
  ['splitMs', 'Split reveal', 'ms', 'The Ancient’s half sliding into the hero power.', 'Timing'],
  ['shineMs', 'Shine sweep', 'ms', 'The one-shot shine across the split button. 0 turns it off.', 'Timing'],
  ['tickGain', 'Fill tick', 'opacity', 'Volume of the tick when points are added. 0 mutes it.', 'Sound'],
  ['revealGain', 'Awaken + reveal', 'opacity', 'Volume of the full-ring flash and the split reveal cues. 0 mutes them.', 'Sound'],
  ['gateChargeMs', 'Charge', 'ms', 'The hero power swells before it bursts.', 'Gate'],
  ['gateChargeScale', 'Charge swell', '×', 'How far the hero power swells.', 'Gate'],
  ['gateBurstScale', 'Burst size', '×', 'The size of the burst from the hero power.', 'Gate'],
  ['gateFlash', 'Screen flash', 'opacity', 'The quick flash as it bursts. 0 turns it off.', 'Gate'],
  ['gateOpenMs', 'Gate opens', 'ms', 'The iris opening from the hero power.', 'Gate'],
  ['gateCloseMs', 'Gate closes', 'ms', 'The iris contracting back into the hero power on a pick.', 'Gate'],
  ['gateGlow', 'Gate edge glow', 'opacity', 'The soft glowing ring on the gate’s edge.', 'Gate'],
  ['gateDim', 'Gate dim', 'opacity', 'How dark it is inside the gate. The board stays faintly visible.', 'Gate'],
  ['gateTint', 'Gate tint', 'opacity', 'The mystic violet and gold tint inside the gate.', 'Gate'],
  ['gateBoomClip', 'Burst sound (clip)', undefined, 'The clip id for the burst. Swap in the owner’s SFX here.', 'Gate sound', 'text'],
  ['gateBoomGain', 'Burst sound gain', 'opacity', 'Volume of the burst. 0 mutes it.', 'Gate sound'],
  ['gateBoomOffset', 'Burst sound offset', 'ms', 'Delay after the burst.', 'Gate sound'],
  ['gateShimmerClip', 'Open sound (clip)', undefined, 'The clip id for the gate-open shimmer.', 'Gate sound', 'text'],
  ['gateShimmerGain', 'Open sound gain', 'opacity', 'Volume of the shimmer. 0 mutes it.', 'Gate sound'],
  ['gateShimmerOffset', 'Open sound offset', 'ms', 'Delay after the burst.', 'Gate sound'],
  ['pvInMs', 'Preview in', 'ms', 'The preview card’s slide and fade in on hover.', 'Preview'],
  ['pvOutMs', 'Preview out', 'ms', 'The quick slide and fade out when the pointer leaves.', 'Preview'],
  ['pvGraceMs', 'Hover grace', 'ms', 'How long the pointer has to cross from the ring into the card before it starts leaving.', 'Preview'],
  ['crackX', 'Crack position', undefined, 'Where the crack runs, % of the button from the left.', 'Crack'],
  ['crackJag', 'Jaggedness', undefined, 'How far each zig swings either side of the line (% of the button).', 'Crack'],
  ['crackSegs', 'Segments', undefined, 'How many zig-zags top to bottom.', 'Crack'],
  ['crackEdge', 'Edge highlight width', 'px', 'The bright line along the crack. 0 hides it.', 'Crack'],
  ['crackEdgeAlpha', 'Edge highlight opacity', 'opacity', 'How bright the crack edge reads.', 'Crack'],
  ['crackShadow', 'Edge shadow', 'opacity', 'The soft shadow just inside the crack.', 'Crack'],
  ['crackOpenMs', 'Crack opens', 'ms', 'The one-shot crack draw on awakening. 0 skips it.', 'Crack'],
  ...ANCIENT_ART_IDS.map((id): [Key, string, TunerUnit | undefined, string, string, 'color'] =>
    [`${id}Color` as Key, `${id.charAt(0).toUpperCase() + id.slice(1)}`, undefined, 'The Ancient’s colour: its pill under the hero power, the (Name) tag in the power tip, its preview dot and placeholder emblem.', 'Colours', 'color']),
  ...ANCIENT_ART_IDS.flatMap((id) => {
    const name = id.charAt(0).toUpperCase() + id.slice(1);
    const g = `Art: ${name}`;
    const rows: [Key, string, TunerUnit | undefined, string, string][] = [
      [`${id}X` as Key, 'X offset', 'px', `Slides the ${name} hero-power art sideways inside the split.`, g],
      [`${id}Y` as Key, 'Y offset', 'px', `Slides the ${name} hero-power art vertically.`, g],
      [`${id}S` as Key, 'Scale', '×', `Zooms the ${name} hero-power art (on top of the power art's own zoom).`, g],
      [`${id}R` as Key, 'Rotation', undefined, `Rotates the ${name} hero-power art, in degrees.`, g],
      [`${id}Crack` as Key, 'Crack nudge', undefined, `Moves the crack for ${name} only (% of the button).`, g],
    ];
    return rows;
  }),
];
void ART_FIELDS;

const controls: TunerControl<Key>[] = ROWS.map(([key, label, unit, hint, group, kind]) => {
  if (kind === 'color' || kind === 'text') return { key, label, hint, group, kind, min: 0, max: 0, step: 0 };
  const [min, max, step] = ANCIENTS_RANGES[key as AncientsNumKey];
  return kind === 'toggle'
    ? { key, label, hint, group, kind, min, max, step, onValue: 1, offValue: 0 }
    : { key, label, unit, hint, group, min, max, step };
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
export const SPEC: TunerSpec<AncientsFullConfig> = {
  id: 'ancients', // FROZEN
  title: 'Ancients',
  note: 'dev · proof of concept',
  read: getAncientsConfig,
  write: (key, value) => { setAncientsValue(key, value); restampLiveRun(key, value); },
  writeColor: (key, value) => setAncientsValue(key, value),
  reset: resetAncientsConfig,
  defaults: ANCIENTS_DEFAULTS,
  controls,
  actions: [
    {
      label: '▶ Play gate',
      hint: 'Plays the gate opening from the hero power, holds it, and closes it again. Needs a Set 3 sandbox with Ancients on. Run state is untouched.',
      run: () => playGateDemo(),
    },
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
