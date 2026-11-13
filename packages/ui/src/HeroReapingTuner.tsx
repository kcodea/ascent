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
 * Four groups of per-tier dials (Tier 1 the cut, Tier 2 the cross, Tier 3 the harvest, Tier 4 the reaping), the blade,
 * the drain, the gather and the orb, the ribbons, the monochrome screen, the colours and one clip / gain / pitch row per
 * sound cue. The Play buttons (at the top) run the real runner between the two real portraits, both directions, at all
 * four tiers.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Shared damage tier 2 (6): two cuts cross.', 'Damage tiers'],
  tier3At: ['Tier 3 from', undefined, 'Shared damage tier 3 (12): the world colour is gathered into an orb and cut.', 'Damage tiers'],
  tier4At: ['Tier 4 from', undefined, 'Shared damage tier 4 (20): the whole screen drains (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroSwell: ['Hero swell', '×', 'How much the striker swells through the ready.', 'Ready'],
  bladeSize: ['Blade length', '×', 'Tiers 1-2: the blade of light, in struck-portrait radii.', 'Blade'],
  bladeReach: ['Blade reach', '×', 'Tiers 1-2: how far either side of the portrait the blade travels (radii).', 'Blade'],
  bladeBow: ['Blade arc', '×', 'Tiers 1-2: how much the blade path curves (radii).', 'Blade'],
  stripWidth: ['Strip width', '×', 'Tiers 1-2: the width of the strip each cut drains (radii).', 'Drain'],
  grey: ['Grey', '×', 'How much colour a drained area loses (1 = all of it).', 'Drain'],
  sag: ['Sag', '×', 'How much the struck portrait shrinks while it is grey.', 'Drain'],
  moteMs: ['Mote flight', 'ms', 'How long a drop of colour takes to reach the striker.', 'Drain'],
  moteSize: ['Mote size', '×', 'The size of the drops of colour.', 'Drain'],
  aura: ['Stolen glow', '×', 'How strongly the striker glows with the stolen colour afterwards.', 'Drain'],
  crossGapMs: ['Second cut after', 'ms', 'Tier 2: the gap between the two cuts.', 'Tier 2: the cross'],
  gatherMs: ['Gather', 'ms', 'Tier 3: the grey closing in from the screen edges while the colour runs into the orb.', 'Tier 3: the harvest'],
  orbSize: ['Orb size', '×', 'Tier 3: the orb of colour (struck-portrait radii).', 'Tier 3: the harvest'],
  riseMs: ['Wind-up', 'ms', 'Tier 3: the crescent igniting and being drawn back over the orb (the end of the gather).', 'Tier 3: the harvest'],
  raiseMs: ['Held', 'ms', 'Tier 3: the beat the crescent is held over the full orb before it falls.', 'Tier 3: the harvest'],
  followMs: ['Follow through', 'ms', 'Tier 3: the crescent carrying on, thinning, after it cuts the orb.', 'Tier 3: the harvest'],
  reapSize: ['Crescent length', '×', 'Tier 3: the length of the great crescent (struck-portrait radii).', 'Tier 3: the harvest'],
  shardMs: ['Shard flight', 'ms', 'Tier 3: a shard of the orb bursting out and being drawn into the striker.', 'Tier 3: the harvest'],
  sweepSize: ['Crescent length', '×', 'Tier 4: the length of the crescent that sweeps the screen (struck-portrait radii).', 'Tier 4: the reaping'],
  drainMs: ['Screen drain', 'ms', 'Tier 4: the whole screen but the foe losing its colour.', 'Tier 4: the reaping'],
  silenceMs: ['Silence', 'ms', 'Tier 4: the beat of silence before the bell (nothing plays).', 'Tier 4: the reaping'],
  tollMs: ['Toll to ribbons', 'ms', 'Tier 4: from the bell (the crescent ignites) to the ribbons starting out of the foe.', 'Tier 4: the reaping'],
  windMs: ['Ribbons', 'ms', 'Tier 4: the foe colour wound out as ribbons onto the blade (it turns rainbow).', 'Tier 4: the reaping'],
  blazeMs: ['Blaze', 'ms', 'Tier 4: the rainbow blade held, blazing, before the sweep.', 'Tier 4: the reaping'],
  ribbonWidth: ['Ribbon width', 'px', 'Tier 4: how wide each ribbon of colour is.', 'Tier 4: the reaping'],
  streamMs: ['Colour spill', 'ms', 'Tier 4: the stolen colour spilling into the striker before colour floods back.', 'Tier 4: the reaping'],
  floodMs: ['Colour flood', 'ms', 'Tier 4: colour flooding back across the screen from the striker side.', 'Tier 4: the reaping'],
  lingerMs: ['Extra linger', 'ms', 'Tier 4: extra time the cracked foe stays grey after the flood (on top of its Grey hold).', 'Tier 4: the reaping'],
  knockPx: ['Knock', 'px', 'How far the struck portrait is knocked along the cut.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxBellGain: ['bell: gain', undefined, 'Tier 4: the one toll (with its low octave), a high bell as the blade blazes, the low octave on the cut. Tier 3: a low bell on the shatter.', 'Sound: bell'],
  sfxBellRate: ['bell: pitch', '×', 'Pitch of the bell.', 'Sound: bell'],
  sfxSweepGain: ['sweep: gain', undefined, 'The airy top of every blade through the air (placed so its body lands on the cut).', 'Sound: sweep'],
  sfxSweepRate: ['sweep: pitch', '×', 'Pitch of the sweep (Tier 4 plays it lower).', 'Sound: sweep'],
  sfxBreathGain: ['breath: gain', undefined, 'A soft exhale under the screen drain, and backward as the struck portrait gets its colour back.', 'Sound: breath'],
  sfxBreathRate: ['breath: pitch', '×', 'Pitch of the breath.', 'Sound: breath'],
  sfxThumpGain: ['thump: gain', undefined, 'A soft low thump under the cut.', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump.', 'Sound: thump'],
  sfxSlashGain: ['slash: gain', undefined, 'The low body of every blade through the air (under the sweep).', 'Sound: slash'],
  sfxSlashRate: ['slash: pitch', '×', 'Pitch of the slash.', 'Sound: slash'],
  sfxMetalGain: ['steel: gain', undefined, 'The ring of steel on every blade, and the glint as the crescent is held.', 'Sound: steel'],
  sfxMetalRate: ['steel: pitch', '×', 'Pitch of the steel.', 'Sound: steel'],
  sfxCleaveGain: ['cleave: gain', undefined, 'The blade going through: the body of every blow.', 'Sound: cleave'],
  sfxCleaveRate: ['cleave: pitch', '×', 'Pitch of the cleave (Tiers 3 and 4 play it lower).', 'Sound: cleave'],
  sfxDrainGain: ['drain: gain', undefined, 'The hollow rush of air as colour leaves (backward as it is drawn in or floods back).', 'Sound: drain'],
  sfxDrainRate: ['drain: pitch', '×', 'Pitch of the drain.', 'Sound: drain'],
  sfxBoomGain: ['boom: gain', undefined, 'The low boom under the bell and under the cut on Tiers 3 and 4.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxOrbGain: ['hum: gain', undefined, 'Tier 3: the orb filling. Tier 4: the blade filling with colour. Both: the striker taking it in.', 'Sound: hum'],
  sfxOrbRate: ['hum: pitch', '×', 'Pitch of the hum.', 'Sound: hum'],
  sfxShatterGain: ['shatter: gain', undefined, 'Tier 3: the orb of colour shattering.', 'Sound: shatter'],
  sfxShatterRate: ['shatter: pitch', '×', 'Pitch of the shatter.', 'Sound: shatter'],
  sfxWindGain: ['whirl: gain', undefined, 'Tier 4: the ribbons of colour whipped out in a spiral (twice).', 'Sound: whirl'],
  sfxWindRate: ['whirl: pitch', '×', 'Pitch of the whirl.', 'Sound: whirl'],
  sfxCrackGain: ['crack: gain', undefined, 'Tier 4: the loser cracking like old paint, and the paint crumbling off.', 'Sound: crack'],
  sfxCrackRate: ['crack: pitch', '×', 'Pitch of the crack.', 'Sound: crack'],
  sfxDuck: ['duck others', '×', 'Tiers 1-3: other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
  sfxHush: ['hush others (Tier 4)', '×', 'Tier 4: other sound buses drop to this from the drain until colour floods back.', 'Sound: mix'],
};

const LEVEL_SPECS: Record<ReapingTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The beat before the attack starts (Tier 3 starts with the gather, Tier 4 with the drain).'],
  SweepMs: ['Sweep', 'ms', 'Tiers 1-2: the blade pass. Tier 3: the fall to the orb. Tier 4: the crescent from you to the foe.'],
  Motes: ['Motes', undefined, 'How many drops (Tiers 1-2), shards (Tier 3) or spilled drops (Tier 4) carry the colour away.'],
  HoldMs: ['Grey hold', 'ms', 'How long the portrait stays grey after the cut (Tier 4: after the flood has passed).'],
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
  levelNames: { t1: 'Tier 1 (the cut)', t2: 'Tier 2 (the cross)', t3: 'Tier 3 (the harvest)', t4: 'Tier 4 (the reaping)' },
  suffixes: REAPING_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorTeal', 'Teal', 'The blades, the great crescent (before Tier 4 turns it rainbow), the rings.'],
    ['colorBone', 'Bone', 'The hairline of light along each cut.'],
    ['colorShade', 'Shade', 'The shadow under the blade.'],
    ['colorMoteA', 'Stolen amber', 'Used only when the foe portrait colours cannot be read from its art.'],
    ['colorMoteB', 'Stolen coral', 'Used only when the foe portrait colours cannot be read from its art.'],
    ['colorMoteC', 'Stolen gold', 'Used only when the foe portrait colours cannot be read from its art (and gathered on Tier 3).'],
    ['colorWorldA', 'World rose', 'Tier 3: a colour of the board gathered into the orb.'],
    ['colorWorldB', 'World blue', 'Tier 3: a colour of the board gathered into the orb (and the cool fallback).'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: bell': 'sfxBellClip', 'Sound: sweep': 'sfxSweepClip', 'Sound: breath': 'sfxBreathClip', 'Sound: thump': 'sfxThumpClip', 'Sound: slash': 'sfxSlashClip',
    'Sound: steel': 'sfxMetalClip', 'Sound: cleave': 'sfxCleaveClip', 'Sound: drain': 'sfxDrainClip', 'Sound: boom': 'sfxBoomClip',
    'Sound: hum': 'sfxOrbClip', 'Sound: shatter': 'sfxShatterClip', 'Sound: whirl': 'sfxWindClip', 'Sound: crack': 'sfxCrackClip',
  },
  note: () => {
    const c = getHeroReapingConfig();
    const p = reapingPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroReaping(o),
  verb: 'reaps',
  smallHint: 'Tier 1 look: one cut, a strip of the portrait drained grey.',
  bigHint: 'Tier 4 look: the whole screen drains.',
  tierHints: [
    'Tier 1 look: a blade of teal light sweeps once through the foe; a strip of the portrait goes grey and drops of its own colours drift to you.',
    'Tier 2 look: two cuts cross; the wedges between them drain, half the portrait is grey.',
    'Tier 3 look: the board greys from the screen edges inward as its colour runs into an orb over the foe; a crescent cuts the orb and it shatters into shards of colour that fly into you.',
    'Tier 4 look (also every knockout): the screen drains but the foe; one bell; the foe colour is wound out as ribbons onto the blade, which turns rainbow; one sweep; the foe cracks like old paint; colour floods back from you.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroReaping?: unknown }).__heroReaping = { demo: built.demo };
}

export function HeroReapingTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
