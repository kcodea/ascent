import { ANCIENT_IDS, type AncientId } from '@game/sim';
import { TunerPanel } from '../TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from '../tunerSchema';
import { useGame } from '../store';
import { REVEAL_STYLES, ANCIENTS_DEFAULTS, ANCIENTS_RANGES, getAncientsConfig, resetAncientsConfig, setAncientsValue, type AncientsFullConfig, type AncientsNumKey, ANCIENT_ART_IDS, ANCIENT_CUES, ART_FIELDS, type AncientCue } from './ancientsConfig';
import { playAwakenDemo, playGateDemo } from './ancientsFx';
import { auditionCue } from './ancientsSound';
import { ANCIENT_HERO_THEMES, heroThemeKey, isThemedHero, THEME_FIELDS, THEMED_HEROES, type ThemeField } from './ancientHeroThemes';

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
  curtainInner: ['Main colour', 'The hero’s main awakening colour: the glow around the hero power and the eruption’s flash.'],
  curtainOuter: ['Dark colour', 'The dark companion of the main colour.'],
  seamColor: ['Light colour', 'The glyphs around the hero power, and the eruption’s dust and blast.'],
  titleGlow: ['Glow colour', 'The glow and embers around the hero power.'],
  backdropTint: ['Backdrop tint', 'The dark tint behind the cards once they are revealed.'],
};
function themeRows(hero: string, group: string): [Key, string, TunerUnit | undefined, string, string, 'color'][] {
  return THEME_FIELDS.map((f) => [(isThemedHero(hero) ? heroThemeKey(hero, f) : f) as Key, THEME_LABELS[f][0], undefined, THEME_LABELS[f][1], group, 'color']);
}
const HERO_GROUP = 'Hero theme';
const HERO_OPTIONS = ['default', ...[...THEMED_HEROES].sort((a, b) => heroName(a).localeCompare(heroName(b)))];
/** The HERO THEME group (owner 2026-09-26): pick a hero, then its
 *  five colours. Only the SELECTED hero's colours show, so the panel stays one group, not sixty. */
function heroThemeControls(): TunerControl<Key>[] {
  const hero = String(getAncientsConfig().tunerHero);
  const sel = (key: Key, label: string, hint: string, options: readonly string[], optionLabels: Record<string, string>): TunerControl<Key> =>
    ({ key, label, hint, group: HERO_GROUP, kind: 'select', min: 0, max: 0, step: 0, options, optionLabels });
  return [
    sel('tunerHero', 'Hero', 'The hero whose awakening colours are below, and who ▶ Play plays as.', HERO_OPTIONS,
      Object.fromEntries(HERO_OPTIONS.map((h) => [h, heroName(h)]))),
    ...themeRows(hero, HERO_GROUP).map(([key, label, , hint, group, kind]): TunerControl<Key> => ({ key, label, hint, group, kind, min: 0, max: 0, step: 0 })),
  ];
}
/** Each sound's plain name and the moment it plays at (the Sound group's labels and hints). */
const CUE_NAMES: Record<AncientCue, [string, string]> = {
  omenRumble: ['Opening rise', 'The woosh rising while the hero power glows, timed so its peak lands on the explosion. ▶ plays it from its start.'],
  eruptionBoom: ['Explosion boom', 'The deep hit as the hero power explodes.'],
  eruptionFlash: ['Explosion swoosh', 'The swoosh layered over the explosion.'],
  panelBg: ['Background slides in', 'Each of the six backgrounds sliding in (pitched up a step per pair).'],
  panelSlide: ['Ancient slides in', 'Each Ancient sliding up into place: six stone slides, one per Ancient (▶ steps through them).'],
  panelSlam: ['Ancient slams in', 'Each of the six Ancients landing (pitched down a step per pair).'],
  pickPulse: ['Three chosen', 'The three on offer rattling while their edges and outlines pulse.'],
  titleSting: ['Title sting', '"An Ancient Awakens" popping in on the select screen.'],
  revealSpark: ['Card spark', 'The point of light gathering before each card appears.'],
  cardReveal: ['Card appears', 'Each card bursting out of its spark.'],
  ambientHum: ['Select screen hum', 'The quiet hum under the select screen (it loops in the game; ▶ plays it once).'],
  pickClick: ['Pick click', 'The click as you choose an Ancient.'],
  pickWoosh: ['Pick woosh', 'The chosen card turning into a trail toward the hero power.'],
  pickSeal: ['Pick impact', 'The trail hitting the hero power.'],
};
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
  ['panelStaggerMs', 'Pair stagger', 'ms', 'One pair of panels setting off after the pair outside it (outside to inside).', 'Awakening panels'],
  ['panelPairGapMs', 'Pair gap', 'ms', 'Within a pair, the right panel setting off after the left. 0 = together.', 'Awakening panels'],
  ['panelBgMs', 'Background slide', 'ms', 'One background sliding in from off screen.', 'Awakening panels'],
  ['panelFollowMs', 'Ancient follows', 'ms', 'The Ancient setting off after its own background.', 'Awakening panels'],
  ['panelSlideMs', 'Ancient slide', 'ms', 'One Ancient sliding in from off screen to its slam.', 'Awakening panels'],
  ['panelHoldMs', 'Six hold', 'ms', 'How long all six stand before three are chosen.', 'Awakening panels'],
  ['panelRattleMs', 'Three rattle', 'ms', 'The offered three shaking while their edges light and pulse; the other three fall only after it.', 'Awakening panels'],
  ['panelFallMs', 'Backgrounds fall', 'ms', 'All six backgrounds, and the three Ancients not on offer, fading out and falling away.', 'Awakening panels'],
  ['panelSpreadMs', 'Three spread out', 'ms', 'The three on offer sliding along the bottom to even spacing, before they move into their cards.', 'Awakening panels'],
  ['panelShakePx', 'Slam shake', 'px', 'The shake on each slam, and the size of the rattle. 0 = none.', 'Awakening panels'],
  ['panelSparks', 'Sparks', '×', 'The explosion, the grinding edges and the spray off each slam. 0 = none.', 'Awakening panels'],
  ['panelSlant', 'Panel lean', undefined, 'How far each panel leans, % of the width of the screen. 0 = upright.', 'Awakening panels'],
  ['panelDepth', 'Depth', '×', 'How far a layered portrait\'s background, Ancient and foreground move apart. 0 = they move as one.', 'Awakening panels'],
  ['panelFigureScale', 'Figure size', '×', 'How big each Ancient stands in front of its panel. 1 = it fills the height of the screen; smaller shows more of the backgrounds.', 'Awakening panels'],
  ...ANCIENT_ART_IDS.map((id): [Key, string, TunerUnit | undefined, string, string] =>
    [`${id}PanelSize` as Key, `Size: ${id.charAt(0).toUpperCase() + id.slice(1)}`, '×', 'The size of this Ancient alone on its panel, on top of Figure size. Scaled from its bottom edge.', 'Awakening panels']),
  ['revealDelayMs', 'First Ancient delay', 'ms', 'The pause before the first Ancient emerges.', 'Awakening beats'],
  ['sparkMs', 'Spark gathers', 'ms', 'The point of light gathering (motes drawn in, a ring closing) before it bursts.', 'Reveal'],
  ['materialiseMs', 'Card appears', 'ms', 'The card appearing out of the burst.', 'Reveal'],
  ['overexposeMs', 'Light settles', 'ms', 'The art’s overexposure resolving back to normal.', 'Reveal'],
  ['burstRing', 'Burst ring', '×', 'The ring on each burst (the pick’s own ring). 0 = none.', 'Reveal'],
  ['sideDelayMs', 'Sides after middle', 'ms', 'After the middle Ancient’s burst, before the sides’ sparks light.', 'Reveal'],
  ['sideStaggerMs', 'Left to right', 'ms', 'The left side’s spark to the right side’s.', 'Reveal'],
  ['textInMs', 'Text arrives', 'ms', 'Each card’s name, then its effect, rising in after the card lands. 0 = shown with the card.', 'Reveal'],
  ['landFlash', 'Overexposure', 'opacity', 'How hard each card’s art is flooded with its colour and white as it appears. 0 = none.', 'Reveal'],
  ['idleFloat', 'Idle float', 'px', 'The cards’ slow float once the choice is open. 0 = still.', 'Reveal'],
  ['idleMs', 'Idle float cycle', 'ms', 'One float cycle.', 'Reveal'],
  ['hoverDim', 'Hover: others dim to', 'opacity', 'While one Ancient is hovered, the other two step back to this. 1 = no dim.', 'Reveal'],
  ['dustAmount', 'Dust count', '×', 'The Runeforge landing dust burst from the hero power as it erupts. 0 turns it off.', 'Dust'],
  ['dustSize', 'Dust size', '×', 'How big and how wide the dust puffs out.', 'Dust'],
  ['dustLife', 'Dust life', '×', 'How long the dust hangs before it settles.', 'Dust'],
  ['dustOpacity', 'Dust opacity', undefined, 'How opaque the dust is.', 'Dust'],
  ['slamSparks', 'Burst sparks', '×', 'The turbulent spark blast as each Ancient bursts out of its spark. 0 turns it off.', 'Reveal'],
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
  ...ANCIENT_CUES.flatMap((cue): [Key, string, TunerUnit | undefined, string, string, ('text')?][] => {
    const [name, when] = CUE_NAMES[cue];
    return [
      [`${cue}Gain` as Key, `${name}: volume`, undefined, `${when} Press ▶ to hear it. 0 mutes it.`, '✦ Ancients: Sound'],
      [`${cue}Clip` as Key, `${name}: clip`, undefined, `The clip id for this sound (e.g. fx/waking-rift). Swap a new sound in here.`, '✦ Ancients: Sound', 'text'],
      [`${cue}Offset` as Key, `${name}: delay`, 'ms', 'How long after its moment this sound starts.', '✦ Ancients: Sound'],
      [`${cue}Rate` as Key, `${name}: pitch`, '×', 'Playback rate: pitch and speed together.', '✦ Ancients: Sound'],
    ];
  }),
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

/** Each sound's gain row carries a ▶ that plays it (its live clip, gain and pitch). */
const CUE_OF_GAIN = new Map<Key, AncientCue>(ANCIENT_CUES.map((cue) => [`${cue}Gain` as Key, cue]));
const BASE_CONTROLS: TunerControl<Key>[] = ROWS.map(([key, label, unit, hint, group, kind]) => {
  if (kind === 'color' || kind === 'text') return { key, label, hint, group, kind, min: 0, max: 0, step: 0 };
  const [min, max, step] = ANCIENTS_RANGES[key as AncientsNumKey];
  return kind === 'toggle'
    ? { key, label, hint, group, kind, min, max, step, onValue: 1, offValue: 0 }
    : { key, label, unit, hint, group, min, max, step, ...(CUE_OF_GAIN.has(key) ? { preview: () => auditionCue(CUE_OF_GAIN.get(key)!) } : {}) };
});

/** The hero-theme group goes where the theme groups always sat: after the Dust group. */
const HERO_AT = BASE_CONTROLS.findIndex((c) => c.key === 'pickFadeMs');
/** THE REVEAL STYLE (owner 2026-09-27): how each Ancient appears out of its spark, a select above the spark dials. */
const REVEAL_STYLE_CONTROL: TunerControl<Key> = {
  key: 'revealStyle', label: 'Reveal style', group: 'Reveal', kind: 'select', min: 0, max: 0, step: 0, options: REVEAL_STYLES,
  hint: 'How each Ancient appears out of its spark. Burst: it expands from the spark. Seam: a slash of light opens and it is inside. Bloom: the spark swells into light that resolves into it.',
  optionLabels: { burst: 'Burst (expands from the spark)', seam: 'Seam (a slash of light opens)', bloom: 'Bloom (light resolves into it)' },
};
function controls(): TunerControl<Key>[] {
  const base = [...BASE_CONTROLS.slice(0, HERO_AT), ...heroThemeControls(), ...BASE_CONTROLS.slice(HERO_AT)];
  const at = base.findIndex((ctl) => ctl.key === 'sparkMs');
  return [...base.slice(0, at), REVEAL_STYLE_CONTROL, ...base.slice(at)];
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
      hint: 'The whole awakening on the hero power: omen, explosion, the six panels, the Ancients emerging, settled; closes after a moment. Needs a Set 3 sandbox with Ancients on. Run state is untouched.',
      run: () => playGateDemo('full'),
    },
    {
      label: '▶ Play selected hero',
      hint: 'The full awakening in the colours of the hero picked in Hero theme, whoever the run’s hero is. Run state is untouched.',
      run: () => playGateDemo('full', String(getAncientsConfig().tunerHero)),
    },
    {
      label: '▶ Play from reveal',
      hint: 'Just the Ancients emerging (a random three) and the settled state. Run state is untouched.',
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
