import {
  HERO_STITCH_DEFAULTS, HERO_STITCH_RANGES, STITCH_LEVELS, STITCH_TIER_SUFFIXES, getHeroStitchConfig, heroStitchStore, stitchPlan,
  type StitchTierSuffix,
} from './heroStitch/heroStitchConfig';
import { playHeroStitch } from './heroStitch/heroStitch';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the SOUL STITCH hero attack (the Ancient of Bonds' attack, an ANCIENT; owner ask 2026-10-02: "this
 * ancient binds things together and using soulbindings", concept "Soul Stitch": stitching the target to you; III the owner's
 * pick "Pinned", IV the owner's pick "Bound Together"). Four groups of per-tier dials (I the needle, II the cross-stitch, III pinned,
 * IV bound together), the needle, the thread, the pull, the pins, the heart-knot, the colours and one clip / gain / pitch row per sound cue. The Play
 * buttons (at the top) run the real runner between the two real portraits, both directions, at all four tiers.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the cross-stitch.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): pinned.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): bound together, the heart-knot (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroSwell: ['Hero swell', '×', 'How much the striker swells while the needles crystallise.', 'Ready'],
  needleSize: ['Needle size', '×', 'The crystal needle\'s length.', 'Needle'],
  needleGlow: ['Needle glow', 'opacity', 'The violet glow round each needle.', 'Needle'],
  threadWidth: ['Thread width', 'px', 'The thread\'s bright core.', 'Thread'],
  threadGlow: ['Thread glow', 'opacity', 'The violet glow along the thread.', 'Thread'],
  sag: ['Hang', '×', 'How much the thread hangs between the heroes before the tug (a fraction of its length).', 'Thread'],
  tautMs: ['Go taut', 'ms', 'How long the thread takes to relax from the needle\'s arc into a hanging line.', 'Thread'],
  twangPx: ['Twang', 'px', 'How hard the thread twangs when the needle pierces and when it is tugged.', 'Thread'],
  heroPullPx: ['Hero lean back', 'px', 'How far the striker leans back on the tug (IV leans further).', 'The pull'],
  foeYankPx: ['Target yank', 'px', 'How far the target is yanked toward the striker on the tug.', 'The pull'],
  stretch: ['Stretch', '×', 'III: how far the target stretches toward the striker against the pins before they rip out.', 'Pinned (III)'],
  pinRim: ['Pin ring', '×', 'III: how far out from the target centre the five pins go in (target radii).', 'Pinned (III)'],
  dragReach: ['Drag reach', '×', 'IV: how far the target is dragged toward the striker (a fraction of the gap between them; 0.5 = halfway).', 'Bound together (IV)'],
  knotMs: ['Knot tie', 'ms', 'IV: the heart-knot drawing on and tying shut round the dragged target.', 'Bound together (IV)'],
  knotSize: ['Knot size', '×', 'IV: the heart-knot size once tied (target radii).', 'Bound together (IV)'],
  crush: ['Crush', '×', 'IV: how small the target is crushed in the knot (1 = not at all).', 'Bound together (IV)'],
  strikeMs: ['Strike', 'ms', 'IV: the hero striking down the laces, from the wind-up to the burst.', 'Bound together (IV)'],
  flingMs: ['Fling home', 'ms', 'IV: the target flung back to its spot after the burst.', 'Bound together (IV)'],
  heroLungePx: ['Hero lunge', 'px', 'IV: how far the striker lunges at the knot on the strike.', 'Bound together (IV)'],
  ripRibbons: ['Burst ribbons', undefined, 'IV: gold and violet soul ribbons thrown out when the knot bursts.', 'Bound together (IV)'],
  rainShards: ['Crystal rain', undefined, 'IV: crystal shards raining over the board after the burst.', 'Bound together (IV)'],
  slowMo: ['Burst slow mo', '×', 'IV: how slow the clock drops on the burst (1 = none). A smooth ramp back, never a freeze.', 'Bound together (IV)'],
  slowMoMs: ['Burst slow mo length', 'ms', 'IV: how long (attack time) the clock takes to ease back to full speed after the burst.', 'Bound together (IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked when the thread snaps.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxSummonGain: ['summon: gain', undefined, 'The needles crystallising on the striker.', 'Sound: summon'],
  sfxSummonRate: ['summon: pitch', '×', 'Pitch of the summon.', 'Sound: summon'],
  sfxLaunchGain: ['launch: gain', undefined, 'Each needle leaving.', 'Sound: launch'],
  sfxLaunchRate: ['launch: pitch', '×', 'Pitch of the launch.', 'Sound: launch'],
  sfxPierceGain: ['pierce: gain', undefined, 'A needle piercing (a tick).', 'Sound: pierce'],
  sfxPierceRate: ['pierce: pitch', '×', 'Pitch of the pierce.', 'Sound: pierce'],
  sfxStitchGain: ['stitch: gain', undefined, 'The soul thread whispering through as it is sewn.', 'Sound: stitch'],
  sfxStitchRate: ['stitch: pitch', '×', 'Pitch of the stitch.', 'Sound: stitch'],
  sfxTugGain: ['tug: gain', undefined, 'The hero taking the thread and pulling.', 'Sound: tug'],
  sfxTugRate: ['tug: pitch', '×', 'Pitch of the tug.', 'Sound: tug'],
  sfxSnapGain: ['snap: gain', undefined, 'The taut thread snapping (THE impact; III snaps five times as the pins rip out).', 'Sound: snap'],
  sfxSnapRate: ['snap: pitch', '×', 'Pitch of the snap.', 'Sound: snap'],
  sfxImpactGain: ['impact: gain', undefined, 'The bright hit on the impact.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the impact.', 'Sound: impact'],
  sfxThumpGain: ['thump: gain', undefined, 'A low punch under the impact.', 'Sound: thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thump.', 'Sound: thump'],
  sfxShatterGain: ['shards: gain', undefined, 'II-IV: the crystal shards bursting.', 'Sound: shards'],
  sfxShatterRate: ['shards: pitch', '×', 'Pitch of the shards.', 'Sound: shards'],
  sfxTwangGain: ['twang: gain', undefined, 'III: the five threads twanging taut as the hero leans back.', 'Sound: twang'],
  sfxTwangRate: ['twang: pitch', '×', 'Pitch of the twang (low = a taut string).', 'Sound: twang'],
  sfxDragGain: ['drag: gain', undefined, 'IV: the target hauled across the board.', 'Sound: drag'],
  sfxDragRate: ['drag: pitch', '×', 'Pitch of the drag.', 'Sound: drag'],
  sfxKnotGain: ['knot: gain', undefined, 'IV: the gold knot clanking shut (and higher as it is tied).', 'Sound: knot'],
  sfxKnotRate: ['knot: pitch', '×', 'Pitch of the knot.', 'Sound: knot'],
  sfxStrainGain: ['strain: gain', undefined, 'IV: a riser from the yank, peaking on the burst.', 'Sound: strain'],
  sfxStrainRate: ['strain: pitch', '×', 'Pitch of the strain.', 'Sound: strain'],
  sfxStrikeGain: ['strike: gain', undefined, 'IV: the heavy strike as the knot bursts.', 'Sound: strike'],
  sfxStrikeRate: ['strike: pitch', '×', 'Pitch of the strike.', 'Sound: strike'],
  sfxRumbleGain: ['rumble: gain', undefined, 'IV: a heavy rumbling impact under the burst.', 'Sound: rumble'],
  sfxRumbleRate: ['rumble: pitch', '×', 'Pitch of the rumble.', 'Sound: rumble'],
  sfxBoomGain: ['boom: gain', undefined, 'III-IV: the blast boom a beat after the hit.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxRainGain: ['rain: gain', undefined, 'IV: the crystal rain chiming down.', 'Sound: rain'],
  sfxRainRate: ['rain: pitch', '×', 'Pitch of the rain.', 'Sound: rain'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<StitchTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The needles crystallising on the striker before the first leaves.'],
  Needles: ['Needles', undefined, 'III: how many pins hold the target; IV: how many needles lace the two heroes together.'],
  StaggerMs: ['Stagger', 'ms', 'The gap between needles leaving (II, IV).'],
  FlightMs: ['Flight', 'ms', 'A needle\'s flight to the target (scaled a little by the distance).'],
  Arc: ['Arc', '×', 'How much each flight bows toward the top of the screen.'],
  SewMs: ['Sew', 'ms', 'II: each diagonal across the face; IV: each lace back and forth.'],
  Passes: ['Passes', undefined, 'IV: how many legs each lace runs.'],
  HangMs: ['Hang', 'ms', 'The thread hanging taut before the hero pulls.'],
  TugMs: ['Pull', 'ms', 'I-II: the hero pulling before the snap; III: the stretch before the pins rip out; IV: the drag across the board.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in (more through the pull).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shards: ['Shards', undefined, 'Crystal shards thrown on the impact.'],
  Burst: ['Burst', '×', 'The size and speed of the impact\'s burst.'],
  SettleMs: ['Settle', 'ms', 'After the snap before the attack ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herostitch', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Soul Stitch',
  store: heroStitchStore,
  defaults: HERO_STITCH_DEFAULTS,
  ranges: HERO_STITCH_RANGES,
  globals: GLOBALS,
  levels: STITCH_LEVELS,
  levelNames: { t1: 'Tier I (the needle)', t2: 'Tier II (the cross-stitch)', t3: 'Tier III (pinned)', t4: 'Tier IV (bound together)' },
  suffixes: STITCH_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorThread', 'Thread', 'The soul thread\'s glow, the needles\' glow and the shards.'],
    ['colorLilac', 'Lilac', 'The thread\'s bright core, the flashes and the ribbons.'],
    ['colorDeep', 'Deep purple', 'The darkest shards.'],
    ['colorGold', 'Gold', 'The ring on the tug, and the heart-knot and its burst on IV.'],
    ['colorBone', 'Bone', 'The tie-off glints and the hottest flashes.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: summon': 'sfxSummonClip', 'Sound: launch': 'sfxLaunchClip', 'Sound: pierce': 'sfxPierceClip', 'Sound: stitch': 'sfxStitchClip',
    'Sound: tug': 'sfxTugClip', 'Sound: snap': 'sfxSnapClip', 'Sound: impact': 'sfxImpactClip', 'Sound: thump': 'sfxThumpClip',
    'Sound: shards': 'sfxShatterClip', 'Sound: twang': 'sfxTwangClip', 'Sound: drag': 'sfxDragClip', 'Sound: knot': 'sfxKnotClip',
    'Sound: strain': 'sfxStrainClip', 'Sound: strike': 'sfxStrikeClip',
    'Sound: rumble': 'sfxRumbleClip', 'Sound: boom': 'sfxBoomClip', 'Sound: rain': 'sfxRainClip',
  },
  note: () => {
    const c = getHeroStitchConfig();
    const p = stitchPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroStitch(o),
  verb: 'stitches',
  smallHint: 'one needle, pierced, tugged, snapped.',
  bigHint: 'bound together.',
  knockoutHint: 'the Huge bind, remixed: the heart-knot double-cinches in a prismatic flash, then bursts in cyan and magenta over the gold, with a bigger shake, a deeper slow-mo dip and a KO sting.',
  tierHints: [
    'one crystal needle on a violet thread pierces the target; the thread hangs taut; a tug, then the snap.',
    'three needles cross-stitch an X into the target; the hero yanks and the threads snap through.',
    'five crystal pins stab into the target at the points of a star; the hero leans back on all five threads, the target stretches, and the pins rip out with the hit.',
    'six needles lace the two heroes together; the hero yanks the target halfway across the board into a gold heart-knot that ties shut round it, strikes, and the knot bursts as the target is flung home.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroStitch?: unknown }).__heroStitch = { demo: built.demo };
}

export function HeroStitchTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
