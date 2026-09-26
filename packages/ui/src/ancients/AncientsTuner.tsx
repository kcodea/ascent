import { ANCIENT_IDS, type AncientId } from '@game/sim';
import { TunerPanel } from '../TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';
import { useGame } from '../store';
import { ANCIENTS_DEFAULTS, ANCIENTS_RANGES, getAncientsConfig, resetAncientsConfig, setAncientsValue, type AncientsFullConfig, type AncientsNumKey, ANCIENT_ART_IDS, ANCIENT_CUES, ART_FIELDS } from './ancientsConfig';
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
  ['splitMs', 'Split reveal', 'ms', 'The Ancient’s half sliding into the hero power.', 'Timing'],
  ['shineMs', 'Shine sweep', 'ms', 'The one-shot shine across the split button. 0 turns it off.', 'Timing'],
  ['tickGain', 'Fill tick', 'opacity', 'Volume of the tick when points are added. 0 mutes it.', 'Sound'],
  ['revealGain', 'Awaken + reveal', 'opacity', 'Volume of the full-ring flash and the split reveal cues. 0 mutes them.', 'Sound'],
  ['omenMs', 'Omen', 'ms', 'The world holds its breath: the duck, the rumble, the darkening edges, the glyphs and embers around the hero power.', 'Awakening beats'],
  ['omenDark', 'Omen edge darkness', 'opacity', 'How dark the screen edges go during the omen.', 'Awakening beats'],
  ['eruptionMs', 'Eruption bloom', 'ms', 'The curtain bursting out of the hero power.', 'Awakening beats'],
  ['columnMs', 'Light column', 'ms', 'The column of light shooting up from the hero power.', 'Awakening beats'],
  ['burstScale', 'Burst size', '×', 'The shockwave and sparks at the eruption.', 'Awakening beats'],
  ['seamGlow', 'Seam ring', 'opacity', 'The energy ring and runes riding the curtain’s edge.', 'Awakening beats'],
  ['titleHoldMs', 'Title hold', 'ms', 'How long "An Ancient Awakens" holds before the Ancients emerge.', 'Awakening beats'],
  ['revealFadeMs', 'Curtain fade', 'ms', 'The curtain fading off into the reveal.', 'Awakening beats'],
  ['revealDelayMs', 'First Ancient delay', 'ms', 'The pause before the first Ancient emerges.', 'Awakening beats'],
  ['cardStaggerMs', 'Between Ancients', 'ms', 'The gap between one Ancient emerging and the next.', 'Awakening beats'],
  ['cardRevealMs', 'One Ancient emerges', 'ms', 'How long each Ancient takes to materialise.', 'Awakening beats'],
  ['closeMs', 'Gate closes', 'ms', 'The gate contracting back into the hero power on the pick.', 'Awakening beats'],
  ['duckAmount', 'Duck level', 'opacity', 'Music and other sounds dip to this during the awakening (1 = no duck).', 'Awakening sound'],
  ['duckRampMs', 'Duck ramp', 'ms', 'How quickly the duck goes in and comes back.', 'Awakening sound'],
  ...ANCIENT_CUES.flatMap((cue): [Key, string, TunerUnit | undefined, string, string, ('text')?][] => [
    [`${cue}Clip` as Key, `${cue}: clip`, undefined, `The clip id for ${cue} (e.g. fx/waking-rift). Swap in the owner’s SFX here.`, '✦ Ancients: Sound', 'text'],
    [`${cue}Gain` as Key, `${cue}: gain`, undefined, `Volume of ${cue}. 0 mutes it.`, '✦ Ancients: Sound'],
    [`${cue}Offset` as Key, `${cue}: offset`, 'ms', `Delay of ${cue} relative to its beat.`, '✦ Ancients: Sound'],
    [`${cue}Rate` as Key, `${cue}: pitch`, '×', `Playback rate (pitch + speed) of ${cue}.`, '✦ Ancients: Sound'],
  ]),
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
      label: '▶ Play full sequence',
      hint: 'The whole awakening on the hero power: omen, eruption, title, the Ancients emerging, settled; closes after a moment. Needs a Set 3 sandbox with Ancients on. Run state is untouched.',
      run: () => playGateDemo('full'),
    },
    {
      label: '▶ Play from reveal',
      hint: 'Just the Ancients emerging (Death, Fortune, War) and the settled state. Run state is untouched.',
      run: () => playGateDemo('reveal'),
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
