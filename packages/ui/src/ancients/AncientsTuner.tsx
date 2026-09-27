import { ANCIENT_IDS, type AncientId } from '@game/sim';
import { TunerPanel } from '../TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';
import { useGame } from '../store';
import { ANCIENTS_DEFAULTS, ANCIENTS_RANGES, getAncientsConfig, resetAncientsConfig, setAncientsValue, type AncientsFullConfig, type AncientsNumKey, ANCIENT_ART_IDS, ANCIENT_CUES, ART_FIELDS } from './ancientsConfig';
import { playAwakenDemo, playGateDemo } from './ancientsFx';
import { ANCIENT_HERO_THEMES, BLOOM_STYLES, heroThemeKey, isThemedHero, STYLE_FAMILY, THEME_FIELDS, THEMED_HEROES, type ThemeField } from './ancientHeroThemes';

/**
 * DEV ✦ ANCIENTS tuner (proof of concept 2026-09-25). The METER group is balance: moving it re-stamps the live
 * Scene Builder run's meter (the sim still does all the counting) and is what the next Set 3 sandbox starts with.
 * The rest is presentation. ▶ plays the awakening pick beat (the impact on the hero power + the split)
 * without touching run state; the Scene Builder's "Fill meter" plays the real thing end to end.
 */
type Key = keyof AncientsFullConfig;
/** A hero's display name (the theme's label), or "Default" for every hero without its own theme. */
const heroName = (h: string): string => (isThemedHero(h) ? ANCIENT_HERO_THEMES[h].label : 'Default (every other hero)');
const THEME_LABELS: Record<ThemeField, [string, string]> = {
  curtainInner: ['Curtain centre', 'The curtain’s colour at its centre (it blooms out of the hero power).'],
  curtainOuter: ['Curtain edge', 'The curtain’s colour at its edge.'],
  seamColor: ['Seam ring + medallion rim', 'The energy ring riding the curtain’s edge as it opens, and the rim round the hero power art.'],
  titleGlow: ['Title glow', 'The glow around the title and the medallion.'],
  backdropTint: ['Backdrop tint', 'The dark tint behind the cards once they are revealed.'],
};
function themeRows(hero: string, group: string): [Key, string, TunerUnit | undefined, string, string, 'color'][] {
  return THEME_FIELDS.map((f) => [(isThemedHero(hero) ? heroThemeKey(hero, f) : f) as Key, THEME_LABELS[f][0], undefined, THEME_LABELS[f][1], group, 'color']);
}
const HERO_GROUP = 'Hero theme';
const HERO_OPTIONS = ['default', ...[...THEMED_HEROES].sort((a, b) => heroName(a).localeCompare(heroName(b)))];
const STYLE_OPTIONS = ['auto', ...BLOOM_STYLES];
/** The HERO THEME group (owner 2026-09-26): pick a hero (and optionally preview another bloom style on it), then its
 *  five colours. Only the SELECTED hero's colours show, so the panel stays one group, not sixty. */
function heroThemeControls(): TunerControl<Key>[] {
  const hero = String(getAncientsConfig().tunerHero);
  const sel = (key: Key, label: string, hint: string, options: readonly string[], optionLabels: Record<string, string>): TunerControl<Key> =>
    ({ key, label, hint, group: HERO_GROUP, kind: 'select', min: 0, max: 0, step: 0, options, optionLabels });
  return [
    sel('tunerHero', 'Hero', 'The hero whose awakening colours are below, and who ▶ Play plays as.', HERO_OPTIONS,
      Object.fromEntries(HERO_OPTIONS.map((h) => [h, isThemedHero(h) ? `${heroName(h)} (${STYLE_FAMILY[ANCIENT_HERO_THEMES[h].style].split(' ')[0]})` : heroName(h)]))),
    sel('tunerStyle', 'Style preview', 'Play the hero with another bloom style (Auto = its own). A preview only: the hero keeps its own style in the game.', STYLE_OPTIONS,
      { auto: 'Auto (the hero’s own)', ...STYLE_FAMILY }),
    ...themeRows(hero, HERO_GROUP).map(([key, label, , hint, group, kind]): TunerControl<Key> => ({ key, label, hint, group, kind, min: 0, max: 0, step: 0 })),
  ];
}
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
  ['omenDark', 'Omen edge darkness', 'opacity', 'How strongly the vignette creeps in from the edges during the omen.', 'Awakening beats'],
  ['omenTremor', 'Omen tremor', 'px', 'The board’s tremor at the peak of the omen. The hero power never moves. 0 turns it off.', 'Awakening beats'],
  ['eruptionMs', 'Eruption bloom', 'ms', 'The curtain bursting out of the hero power.', 'Awakening beats'],
  ['seamGlow', 'Seam ring', 'opacity', 'The energy ring and runes riding the curtain’s edge.', 'Awakening beats'],
  ['titleHoldMs', 'Title hold', 'ms', 'How long "An Ancient Awakens" holds before the Ancients emerge.', 'Awakening beats'],
  ['revealFadeMs', 'Curtain fade', 'ms', 'The curtain fading off into the reveal.', 'Awakening beats'],
  ['revealDelayMs', 'First Ancient delay', 'ms', 'The pause before the first Ancient emerges.', 'Awakening beats'],
  ['cardStaggerMs', 'Between Ancients', 'ms', 'The gap between one Ancient emerging and the next.', 'Awakening beats'],
  ['cardRevealMs', 'One Ancient emerges', 'ms', 'How long each Ancient takes to materialise.', 'Awakening beats'],
  ['revealStyle', 'Reveal style', undefined, 'Two beats (the middle slams, then the sides slide out and slam together) or sequential (left → middle → right).', 'Reveal', 'toggle'],
  ['beat1Ms', 'Two beats: middle', 'ms', 'The middle Ancient rising up the centre and slamming down.', 'Reveal'],
  ['beatGapMs', 'Two beats: gap', 'ms', 'The pause before the sides.', 'Reveal'],
  ['beat2Ms', 'Two beats: sides', 'ms', 'The left and right Ancients sliding out from behind and slamming together.', 'Reveal'],
  ['slamStrength', 'Slam weight', '×', 'The slam’s overshoot, card shake and landing burst.', 'Reveal'],
  ['dustAmount', 'Dust count', '×', 'The Runeforge landing dust when each Ancient slams, and from the hero power. 0 turns it off.', 'Dust'],
  ['dustSize', 'Dust size', '×', 'How big and how wide the dust puffs out.', 'Dust'],
  ['dustLife', 'Dust life', '×', 'How long the dust hangs before it settles.', 'Dust'],
  ['dustOpacity', 'Dust opacity', undefined, 'How opaque the dust is.', 'Dust'],
  ['slamSparks', 'Slam sparks', '×', 'The turbulent spark blast on each slam. 0 turns it off.', 'Dust'],
  ['slamDust', 'Slam dust', '×', 'How much dust bursts out when a revealed Ancient slams into place.', 'Dust'],
  ['hpDustLife', 'Hero-power dust life', '×', 'How long the burst from the hero power lasts. Low clears it before the curtain.', 'Dust'],
  ['pickFadeMs', 'Backdrop fade', 'ms', 'On the pick, the dark backdrop, the banner and the other Ancients fade off (the Shop fades back in step).', 'Pick → slam'],
  ['collapseMs', 'Collapse', 'ms', 'The chosen Ancient pinching into a bright core of its colour.', 'Pick → slam'],
  ['coreGlow', 'Core glow', 'opacity', 'How bright the core gathers as the card collapses. 0 = none.', 'Pick → slam'],
  ['trailAt', 'Trail launch', '×', 'When the triple trail leaves the core, as a fraction of the collapse (the core hands off to it).', 'Pick → slam'],
  ['trailTime', 'Trail speed', '×', 'The triple trail’s flight to the hero power, × the triple’s own 420 ms. Lower is faster.', 'Pick → slam'],
  ['trailIntensity', 'Trail particles', '×', 'How many sparks the triple trail’s poof and landing throw. Its colour is the Ancient’s (Colours group).', 'Pick → slam'],
  ['hitStopMs', 'Hit-stop', 'ms', 'The hero power held squashed at contact before the shake and the crack release. 0 = none.', 'Pick → slam'],
  ['impactFlash', 'Impact flash', 'opacity', 'A light bloom on the hero power at contact. 0 = none.', 'Pick → slam'],
  ['impactFlashMs', 'Impact flash decay', 'ms', 'How quickly the impact flash fades.', 'Pick → slam'],
  ['burstScale', 'Burst size', '×', 'The crisp ring + sparks at the hero power on the release, in the Ancient’s colour. 0 = none.', 'Pick → slam'],
  ['shakeMs', 'Shake length', 'ms', 'The board’s shake after the release (it decays fast).', 'Pick → slam'],
  ['shakePx', 'Shake strength', 'px', 'The shake’s peak offset. The board art moves, never the HUD. 0 = none.', 'Pick → slam'],
  ['punchZoom', 'Punch zoom', '×', 'The board’s brief zoom toward the hero power at the release (0.012 = 1.2%). 0 = none.', 'Pick → slam'],
  ['recoil', 'Hero power recoil', '×', 'The hero power squashing in on contact, holding through the hit-stop, then springing back. 0 = none.', 'Pick → slam'],
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

const BASE_CONTROLS: TunerControl<Key>[] = ROWS.map(([key, label, unit, hint, group, kind]) => {
  if (kind === 'color' || kind === 'text') return { key, label, hint, group, kind, min: 0, max: 0, step: 0 };
  const [min, max, step] = ANCIENTS_RANGES[key as AncientsNumKey];
  return kind === 'toggle'
    ? { key, label, hint, group, kind, min, max, step, onValue: 1, offValue: 0, ...(key === 'revealStyle' ? { onOffLabels: ['two beats', 'sequential'] as [string, string] } : {}) }
    : { key, label, unit, hint, group, min, max, step };
});

/** The hero-theme group goes where the theme groups always sat: after the Dust group. */
const HERO_AT = BASE_CONTROLS.findIndex((c) => c.key === 'pickFadeMs');
function controls(): TunerControl<Key>[] {
  return [...BASE_CONTROLS.slice(0, HERO_AT), ...heroThemeControls(), ...BASE_CONTROLS.slice(HERO_AT)];
}

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
  // Recomputed on every render: the colour rows follow the selected hero.
  get controls() { return controls(); },
  actions: [
    {
      label: '▶ Play full sequence',
      hint: 'The whole awakening on the hero power: omen, eruption, title, the Ancients emerging, settled; closes after a moment. Needs a Set 3 sandbox with Ancients on. Run state is untouched.',
      run: () => playGateDemo('full'),
    },
    {
      label: '▶ Play selected hero',
      hint: 'The full awakening as the hero picked in Hero theme (its colours, power art, bloom style and medallion entrance), with the Style preview if one is set, whoever the run’s hero is. Run state is untouched.',
      run: () => {
        const c = getAncientsConfig();
        playGateDemo('full', String(c.tunerHero), c.tunerStyle === 'auto' ? undefined : String(c.tunerStyle));
      },
    },
    {
      label: '▶ Play from reveal',
      hint: 'Just the Ancients emerging (Death, Fortune, War) and the settled state. Run state is untouched.',
      run: () => playGateDemo('reveal'),
    },
    {
      label: '▶ Awaken',
      hint: 'Plays the pick’s impact on the hero power (flash, burst, shake) and the split, with no card to fly. To see the full pick, use ▶ Play full sequence and click an Ancient. Cycles the Ancients. Run state is untouched.',
      run: () => { const id: AncientId = ANCIENT_IDS[demoIx++ % ANCIENT_IDS.length]!; playAwakenDemo(id); },
    },
  ],
};

export function AncientsTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
