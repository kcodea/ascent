import {
  HERO_REAPING_DEFAULTS, HERO_REAPING_RANGES, REAPING_LEVELS, REAPING_TIER_SUFFIXES, getHeroReapingConfig, heroReapingStore, reapingPlan,
  type ReapingTierSuffix,
} from './heroReaping/heroReapingConfig';
import { playHeroReaping } from './heroReaping/heroReaping';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for THE REAPING hero attack (the Ancient of Death's attack, an ANCIENT): what the scythe cuts is colour.
 * Four groups of per-tier dials (I the cut, II the cross, III the fall, IV the reaping), the blade, the drain, the
 * great crescent, the monochrome screen, the colours and one clip / gain / pitch row per sound cue. The Play buttons (at the
 * top) run the real runner between the two real portraits, both directions, at all four tiers.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): two cuts cross.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the great crescent falls.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the whole screen drains (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroSwell: ['Hero swell', '×', 'How much the striker swells through the ready.', 'Ready'],
  bladeSize: ['Blade length', '×', 'I-II: the blade of light, in struck-portrait radii.', 'Blade'],
  bladeReach: ['Blade reach', '×', 'I-II: how far either side of the portrait the blade travels (radii).', 'Blade'],
  bladeBow: ['Blade arc', '×', 'I-II: how much the blade path curves (radii).', 'Blade'],
  stripWidth: ['Strip width', '×', 'I-II: the width of the strip each cut drains (radii).', 'Drain'],
  grey: ['Grey', '×', 'How much colour a drained area loses (1 = all of it).', 'Drain'],
  sag: ['Sag', '×', 'How much the struck portrait shrinks while it is grey.', 'Drain'],
  moteMs: ['Mote flight', 'ms', 'How long a mote of colour takes to reach the striker.', 'Drain'],
  moteSize: ['Mote size', '×', 'The size of the motes of colour.', 'Drain'],
  crossGapMs: ['Second cut after', 'ms', 'II: the gap between the two cuts.', 'Cross (II)'],
  riseMs: ['Wind-up', 'ms', 'III: the crescent igniting and being drawn back, the light building along its edge.', 'The fall (III)'],
  raiseMs: ['Held', 'ms', 'III: the beat the crescent is held, fully lit, before it falls.', 'The fall (III)'],
  followMs: ['Follow through', 'ms', 'III: the crescent carrying on, thinning, after it cuts the portrait.', 'The fall (III)'],
  reapSize: ['Crescent length', '×', 'III: the length of the great crescent (struck-portrait radii).', 'The fall (III)'],
  sweepSize: ['Crescent length', '×', 'IV: the length of the crescent that sweeps the screen (struck-portrait radii).', 'The reaping (IV)'],
  drainMs: ['Screen drain', 'ms', 'IV: the whole screen losing its colour.', 'The reaping (IV)'],
  silenceMs: ['Silence', 'ms', 'IV: the beat of silence before the bell (nothing plays).', 'The reaping (IV)'],
  tollMs: ['Toll to sweep', 'ms', 'IV: from the bell to the sweep: the crescent ignites on the bell and is held this long.', 'The reaping (IV)'],
  streamMs: ['Colour stream', 'ms', 'IV: the struck portrait colour streaming into the striker before colour floods back.', 'The reaping (IV)'],
  floodMs: ['Colour flood', 'ms', 'IV: colour flooding back across the screen from the striker side.', 'The reaping (IV)'],
  lingerMs: ['Extra linger', 'ms', 'IV: extra time the struck portrait stays grey after the flood (on top of its Grey hold).', 'The reaping (IV)'],
  knockPx: ['Knock', 'px', 'How far the struck portrait is knocked along the cut.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxBellGain: ['bell: gain', undefined, 'IV: the one toll (with its low octave) and the low octave again on the cut. III: a lower bell on the cut.', 'Sound: bell'],
  sfxBellRate: ['bell: pitch', '×', 'Pitch of the bell.', 'Sound: bell'],
  sfxSweepGain: ['sweep: gain', undefined, 'The airy top of every blade through the air (placed so its body lands on the cut).', 'Sound: sweep'],
  sfxSweepRate: ['sweep: pitch', '×', 'Pitch of the sweep (IV plays it lower).', 'Sound: sweep'],
  sfxBreathGain: ['breath: gain', undefined, 'A soft exhale under the screen drain, and backward as the struck portrait gets its colour back.', 'Sound: breath'],
  sfxBreathRate: ['breath: pitch', '×', 'Pitch of the breath.', 'Sound: breath'],
  sfxThumpGain: ['thump: gain', undefined, 'A soft low thump under the cut.', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump.', 'Sound: thump'],
  sfxSlashGain: ['slash: gain', undefined, 'The low body of every blade through the air (under the sweep).', 'Sound: slash'],
  sfxSlashRate: ['slash: pitch', '×', 'Pitch of the slash.', 'Sound: slash'],
  sfxMetalGain: ['steel: gain', undefined, 'The ring of steel on every blade, and the glint as the crescent is held.', 'Sound: steel'],
  sfxMetalRate: ['steel: pitch', '×', 'Pitch of the steel.', 'Sound: steel'],
  sfxCleaveGain: ['cleave: gain', undefined, 'The blade going through: the body of every blow.', 'Sound: cleave'],
  sfxCleaveRate: ['cleave: pitch', '×', 'Pitch of the cleave (III and IV play it lower).', 'Sound: cleave'],
  sfxDrainGain: ['drain: gain', undefined, 'The hollow rush of air as colour leaves (backward as it is drawn in or floods back).', 'Sound: drain'],
  sfxDrainRate: ['drain: pitch', '×', 'Pitch of the drain.', 'Sound: drain'],
  sfxBoomGain: ['boom: gain', undefined, 'The low boom under the bell and under the cut on III and IV.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxDuck: ['duck others', '×', 'I-III: other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
  sfxHush: ['hush others (IV)', '×', 'IV: other sound buses drop to this from the drain until colour floods back.', 'Sound: mix'],
};

const LEVEL_SPECS: Record<ReapingTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The beat before the attack starts (III starts with the wind-up, IV with the drain).'],
  SweepMs: ['Sweep', 'ms', 'I-II: the blade pass. III: the fall to the portrait. IV: the crescent from you to the foe.'],
  Motes: ['Motes', undefined, 'How many motes of colour leave the struck portrait.'],
  HoldMs: ['Grey hold', 'ms', 'How long the portrait stays grey after the cut (IV: after the flood has passed).'],
  ReturnMs: ['Colour return', 'ms', 'How long the portrait colour takes to seep back.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in up to the blow.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  SettleMs: ['Settle', 'ms', 'After the colour is back before the attack ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'heroreaping', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: The Reaping',
  store: heroReapingStore,
  defaults: HERO_REAPING_DEFAULTS,
  ranges: HERO_REAPING_RANGES,
  globals: GLOBALS,
  levels: REAPING_LEVELS,
  levelNames: { t1: 'Tier I (the cut)', t2: 'Tier II (the cross)', t3: 'Tier III (the fall)', t4: 'Tier IV (the reaping)' },
  suffixes: REAPING_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorTeal', 'Teal', 'The blades, the great crescent, its afterimages, the rings and the line.'],
    ['colorBone', 'Bone', 'The hairline of light along each cut.'],
    ['colorShade', 'Shade', 'The shadow under the blade.'],
    ['colorMoteA', 'Mote amber', 'One of the three warm hues the motes of colour take.'],
    ['colorMoteB', 'Mote coral', 'One of the three warm hues the motes of colour take.'],
    ['colorMoteC', 'Mote gold', 'One of the three warm hues the motes of colour take.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: bell': 'sfxBellClip', 'Sound: sweep': 'sfxSweepClip', 'Sound: breath': 'sfxBreathClip', 'Sound: thump': 'sfxThumpClip', 'Sound: slash': 'sfxSlashClip',
    'Sound: steel': 'sfxMetalClip', 'Sound: cleave': 'sfxCleaveClip', 'Sound: drain': 'sfxDrainClip', 'Sound: boom': 'sfxBoomClip',
  },
  note: () => {
    const c = getHeroReapingConfig();
    const p = reapingPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroReaping(o),
  verb: 'reaps',
  smallHint: 'one cut, a strip of the portrait drained grey.',
  bigHint: 'the whole screen drains.',
  tierHints: [
    'a blade of teal light sweeps once through the foe; a strip of the portrait goes grey behind it and a few motes of colour drift to you.',
    'two cuts cross; the wedges between them drain, half the portrait is grey.',
    'a huge crescent of teal light is drawn back beside the foe, held, and falls through the whole portrait; it goes grey at once and its colour is torn out to you. A low bell.',
    'the whole screen drains to monochrome and goes silent; one bell tolls; a crescent as tall as half the screen sweeps across it and cuts the foe; colour floods back to everything but the foe.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroReaping?: unknown }).__heroReaping = { demo: built.demo };
}

export function HeroReapingTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
