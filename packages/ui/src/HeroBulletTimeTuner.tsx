import {
  BULLET_LEVELS, BULLET_TIER_SUFFIXES, HERO_BULLET_DEFAULTS, HERO_BULLET_RANGES, bulletPlan, bulletSlowExtraMs, getHeroBulletTimeConfig,
  heroBulletTimeStore, type BulletTierSuffix,
} from './heroBulletTime/heroBulletTimeConfig';
import { playHeroBulletTime } from './heroBulletTime/heroBulletTime';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the TIMEBREAK hero attack (the Ancient of Time; owner 2026-10-02 picked "BULLET TIME", then: cutting
 * through time in slow motion, centred on the target). Four groups of per-tier dials (I one dart; II a ring of three; III a spiral volley and a
 * snap; IV the dome, the 3-2-1 and the collapse), the blades, the slow motion (crawl, FX speed, tears, afterimages), the
 * colours and one clip / gain / pitch row per sound cue. The Play buttons at the top play all four tiers.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the ring of three.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the spiral volley and the snap.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the dome (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroWindPx: ['Lean back', 'px', 'How far the hero leans back through the ready.', 'Ready'],
  heroThrowPx: ['Throw snap', 'px', 'How far the hero snaps toward the target as it throws.', 'Ready'],
  runMs: ['III run', 'ms', 'III: the gap between each dart landing after the snap (the last is the blow).', 'Moves'],
  countMs: ['IV count', 'ms', 'IV: each count of the 3-2-1.', 'Moves'],
  domeRings: ['IV dome rings', undefined, 'IV: rings of blades in the dome.', 'Moves'],
  domeBlades: ['IV blades per ring', undefined, 'IV: blades in each ring.', 'Moves'],
  domeSize: ['IV dome size', '×', 'IV: how wide the dome is round the target.', 'Moves'],
  slowMo: ['IV slow mo', '×', 'IV: how slow the clock dips on the collapse (1 = none). A smooth ramp, never a freeze.', 'Moves'],
  slowMoMs: ['IV slow mo length', 'ms', 'IV: how long (attack time) the clock takes to ease back after the collapse.', 'Moves'],
  hangR: ['Hang distance', '×', 'How far short of the target a dart stops (struck radii; II and III sit a little further out).', 'Missiles'],
  dartPx: ['Missile size', 'px', 'A crystal lance\'s length (the per-tier size multiplies it).', 'Missiles'],
  trailMs: ['Streak length', 'ms', 'How much of its flight a dart\'s streak spans (short: a motion blur).', 'Missiles'],
  trailWidth: ['Streak width', 'px', 'How thick the streak is.', 'Missiles'],
  crawl: ['Crawl', '×', 'How far a blade crawls on toward the target through the slow motion (a fraction of the way left).', 'Slow motion'],
  slowFx: ['Slow-mo FX speed', '×', 'How fast the sparks, motes, ripples, glints and tears run in the slow motion.', 'Slow motion'],
  riftWidth: ['Tear width', 'px', 'The gold tear each blade slices through the air (0 = none).', 'Slow motion'],
  ghostMs: ['Afterimage every', 'ms', 'How often an afterimage peels off a crawling blade (IV three times less often).', 'Slow motion'],
  rippleMs: ['Ripple', 'ms', 'How often a gold time ripple pulses off the target in the slow motion.', 'Slow motion'],
  motes: ['Dust motes', undefined, 'Motes drifting through the slow motion.', 'Slow motion'],
  clockSize: ['Clock size', '×', 'The clock dial ringing the target (bigger each tier; IV rings the whole dome).', 'Slow motion'],
  impactSize: ['Impact size', '×', 'The impact (IV: the collapse, the biggest in the roster).', 'Impact'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxTickGain: ['tick: gain', undefined, 'The clock: the ready, every tick of the slow motion (faster and louder toward the snap), IV\'s 3-2-1.', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'Pitch of the tick.', 'Sound: tick'],
  sfxThrowGain: ['throw: gain', undefined, 'A missile cast from the hand (one every few in a volley).', 'Sound: throw'],
  sfxThrowRate: ['throw: pitch', '×', 'Pitch of the throw.', 'Sound: throw'],
  sfxFreezeGain: ['cut: gain', undefined, 'A missile cutting into the slow motion (a chime).', 'Sound: cut'],
  sfxFreezeRate: ['cut: pitch', '×', 'Pitch of the cut.', 'Sound: cut'],
  sfxStopGain: ['slow mo: gain', undefined, 'A low reversed swell as time slows.', 'Sound: slow mo'],
  sfxStopRate: ['slow mo: pitch', '×', 'Pitch of the swell.', 'Sound: slow mo'],
  sfxSnapGain: ['snap: gain', undefined, 'A shimmer as time snaps back to full speed (a synth bell rings with it).', 'Sound: snap'],
  sfxSnapRate: ['snap: pitch', '×', 'Pitch of the snap.', 'Sound: snap'],
  sfxRestartGain: ['restart: gain', undefined, 'The whoosh of time starting again.', 'Sound: restart'],
  sfxRestartRate: ['restart: pitch', '×', 'Pitch of the restart.', 'Sound: restart'],
  sfxHitGain: ['hit: gain', undefined, 'Each hit (III\'s run softer, the blow full).', 'Sound: hit'],
  sfxHitRate: ['hit: pitch', '×', 'Pitch of the hit.', 'Sound: hit'],
  sfxThudGain: ['thud: gain', undefined, 'A resonant arcane hit under the impact.', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxBoomGain: ['boom: gain', undefined, 'II-IV: a cinematic boom (deepest on IV).', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxBellGain: ['bell: gain', undefined, 'A low shimmer under the collapse (IV, with a synth time bell; softer on III).', 'Sound: bell'],
  sfxBellRate: ['bell: pitch', '×', 'Pitch of the bell (low = a gong).', 'Sound: bell'],
  sfxRumbleGain: ['rumble: gain', undefined, 'IV: a deep whoosh under the collapse.', 'Sound: rumble'],
  sfxRumbleRate: ['rumble: pitch', '×', 'Pitch of the rumble.', 'Sound: rumble'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the impact sounds.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<BulletTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hero draws. The view pushes in over this.'],
  Darts: ['Darts', undefined, 'How many darts (I one, II a ring, III the volley; IV uses the dome dials).'],
  StaggerMs: ['Stagger', 'ms', 'The gap between missiles leaving the hand.'],
  FlyMs: ['Flight', 'ms', 'A dart\'s flight to where it stops (at 1600 px).'],
  HangMs: ['Slow mo', 'ms', 'How long the slow motion lasts once the last blade is in (IV: set by the 3-2-1).'],
  ResumeMs: ['Snap', 'ms', 'Time snapping back to full speed: from the crawl into the hit.'],
  Size: ['Size', '×', 'The dart size multiplier for this tier.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Push: ['Slow-mo push', '×', 'How far the view keeps pushing in through the slow motion.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  SettleMs: ['Settle', 'ms', 'After the impact before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herobullettime', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Timebreak (Ancient)',
  store: heroBulletTimeStore,
  defaults: HERO_BULLET_DEFAULTS,
  ranges: HERO_BULLET_RANGES,
  globals: GLOBALS,
  levels: BULLET_LEVELS,
  levelNames: { t1: 'Tier I (one dart)', t2: 'Tier II (a ring of three)', t3: 'Tier III (the spiral volley)', t4: 'Tier IV (the dome)' },
  suffixes: BULLET_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorGold', 'Gold', 'The missiles, the orbiting runes, the ripples.'],
    ['colorLight', 'Light gold', 'The flashes, the rune circle, the glints.'],
    ['colorViolet', 'Violet', 'The slow motion: its flash, the rift glow along each tear.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: tick': 'sfxTickClip', 'Sound: throw': 'sfxThrowClip', 'Sound: cut': 'sfxFreezeClip', 'Sound: slow mo': 'sfxStopClip',
    'Sound: snap': 'sfxSnapClip', 'Sound: restart': 'sfxRestartClip', 'Sound: hit': 'sfxHitClip', 'Sound: thud': 'sfxThudClip',
    'Sound: boom': 'sfxBoomClip', 'Sound: bell': 'sfxBellClip', 'Sound: rumble': 'sfxRumbleClip',
  },
  note: () => {
    const c = getHeroBulletTimeConfig();
    const p = bulletPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.kind} · ${p.darts.length} dart${p.darts.length === 1 ? '' : 's'} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt + bulletSlowExtraMs(p, c))} ms after the formation`;
  },
  play: (o) => playHeroBulletTime(o),
  verb: 'stops time on',
  smallHint: 'one missile, slowed to a crawl an inch from the target.',
  bigHint: 'the dome of missiles.',
  tierHints: [
    'a gold clock-hand blade slices in and drops into slow motion an inch from the target; time snaps back: the hit.',
    'three blades slice in from round the target and crawl in slow motion; time snaps back and they all hit together.',
    'a volley slices in to a spiral round the target and crawls as a clock face flares; the hero snaps and it all lands.',
    'dozens of blades slice a dome of tears round the target and crawl in slow motion while a clock counts 3-2-1; time snaps back and the dome collapses into one massive impact.',
  ],
  knockoutHint: 'Huge remixed: one extra ring of cyan and magenta blades in the dome, a prismatic collapse, a bigger shake, a deeper slow-mo dip and the KO sting.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBulletTime?: unknown }).__heroBulletTime = { demo: built.demo };
}

export function HeroBulletTimeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
