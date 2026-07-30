import {
  SBF_COLOR_KEYS, SBF_DEFAULTS, SBF_RANGES,
  getSpellBuffFxConfig, resetSpellBuffFxConfig, setSpellBuffFxValue, type SpellBuffFxConfig,
} from './spellBuffFxConfig';
import { TunerPanel } from './TunerPanel';
import type { TunerControl, TunerSpec, TunerUnit } from './tunerSchema';

/**
 * DEV-only tuner for the SPELL BUFF cue — what a hand spell or Ruby plays when its printed value goes UP: the
 * card grows then shrinks back in place, each phase with its own speed and easing, while a burst of coloured
 * sparks blasts off it. Applies to the NEXT burst.
 *
 * The grow and shrink are deliberately INDEPENDENT: a fast punch out with a slow settle back reads very
 * differently from the reverse, and that asymmetry is the main thing this panel is for.
 *
 * The three spark colours are hue SLOTS cycled across the motes rather than three separate effects — which is
 * why they are labelled as slots, not as "pink / gold / purple" (their variable names, which stop being true the
 * moment you change one).
 */
type ColorKey = (typeof SBF_COLOR_KEYS)[number];
const COLOR_SET = new Set<string>(SBF_COLOR_KEYS);

const SPECS: Record<keyof SpellBuffFxConfig, [string, TunerUnit | undefined, string, string]> = {
  growScale:    ['Peak size', '×', 'Scale at the top of the grow. 1 means no growth at all.', 'Card'],
  growMs:       ['Grow time', 'ms', 'How long the grow takes.', 'Card'],
  growEase:     ['Grow easing', 'opacity', '0 snaps to size instantly; 1 is a long, gentle swell.', 'Card'],
  shrinkMs:     ['Shrink time', 'ms', 'How long the shrink back takes. Independent of the grow.', 'Card'],
  shrinkEase:   ['Shrink easing', 'opacity', '0 drops back instantly; 1 is a long, gentle settle.', 'Card'],

  sparkCount:   ['Count', undefined, 'How many motes explode off the card. 0 removes them.', 'Sparks'],
  sparkSizeMin: ['Smallest size', 'px', 'Smallest mote diameter.', 'Sparks'],
  sparkSizeMax: ['Largest size', 'px', 'Largest mote diameter.', 'Sparks'],
  sparkAlpha:   ['Opacity', 'opacity', 'Peak mote opacity.', 'Sparks'],
  sparkGlow:    ['Glow radius', 'px', 'Halo around each mote. 0 is flat, with no bloom.', 'Sparks'],
  sparkTail:    ['Tail length', '×', 'Tail length as a multiple of the mote size. 0 is no tail.', 'Sparks'],
  sparkMs:      ['Flight time', 'ms', 'A mote’s flight and fade. Independent of the card animation.', 'Sparks'],
  sparkStagger: ['Launch stagger', 'ms', 'Largest random launch delay, so the motes do not fire in lockstep.', 'Sparks'],
  pinkColor:    ['Hue slot 1', undefined, 'First of three hues cycled across the motes.', 'Sparks'],
  goldColor:    ['Hue slot 2', undefined, 'Second of three hues cycled across the motes.', 'Sparks'],
  purpleColor:  ['Hue slot 3', undefined, 'Third of three hues cycled across the motes.', 'Sparks'],

  blastDistMin: ['Shortest flight', 'px', 'Shortest distance out from the card centre.', 'Blast shape'],
  blastDistMax: ['Longest flight', 'px', 'Longest distance out.', 'Blast shape'],
  blastSpread:  ['Arc covered', '°', 'Arc the blast covers. 360 fires in every direction; smaller focuses it upward.', 'Blast shape'],
  blastOriginY: ['Origin height', '%', 'Where the blast starts, measured up from the card bottom. 0 is the bottom, 50 the centre, 100 the top.', 'Blast shape'],
  sparkSpeed:   ['Launch punch', 'opacity', '0 drifts out evenly; 1 fires hard then coasts.', 'Blast shape'],
  sparkGravity: ['Gravity', 'px', 'How far motes are dragged back down over their flight. 0 is purely radial.', 'Blast shape'],
};

/** Declaration order IS render order; the three hue slots sit inside the Sparks run. */
const ORDER: (keyof SpellBuffFxConfig)[] = [
  'growScale', 'growMs', 'growEase', 'shrinkMs', 'shrinkEase',
  'sparkCount', 'sparkSizeMin', 'sparkSizeMax', 'sparkAlpha', 'sparkGlow', 'sparkTail', 'sparkMs', 'sparkStagger',
  'pinkColor', 'goldColor', 'purpleColor',
  'blastDistMin', 'blastDistMax', 'blastSpread', 'blastOriginY', 'sparkSpeed', 'sparkGravity',
];

const controls: TunerControl<Extract<keyof SpellBuffFxConfig, string>>[] = ORDER.map((key) => {
  const [label, unit, hint, group] = SPECS[key];
  if (COLOR_SET.has(key)) return { key, label, hint, group, kind: 'color' as const, min: 0, max: 0, step: 0 };
  const [min, max, step] = SBF_RANGES[key as Exclude<keyof SpellBuffFxConfig, ColorKey>];
  return { key, label, unit, hint, group, min, max, step };
});

export const SPEC: TunerSpec<SpellBuffFxConfig> = {
  id: 'spellbufffx',                // FROZEN — indexes this panel's dragged position in localStorage
  title: 'Spell Buff',
  note: 'dev · next burst · drag',
  read: getSpellBuffFxConfig,
  write: (key, value) => setSpellBuffFxValue(key, value),
  writeColor: (key, value) => setSpellBuffFxValue(key, value),
  reset: resetSpellBuffFxConfig,
  defaults: SBF_DEFAULTS,
  controls,
  actions: [{
    label: '✨ Test',
    // Recruit publishes this handle while it is mounted.
    hint: 'Fires the cue on every spell and Ruby currently in hand. Needs the recruit screen open.',
    run: () => (window as { __spellBuffTest?: () => void }).__spellBuffTest?.(),
  }],
};

export function SpellBuffFxTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
