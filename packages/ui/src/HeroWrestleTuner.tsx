import {
  WRESTLE_LEVELS, WRESTLE_TIER_SUFFIXES, HERO_WRESTLE_DEFAULTS, HERO_WRESTLE_RANGES, wrestlePlan, getHeroWrestleConfig,
  heroWrestleStore, type WrestleTierSuffix,
} from './heroWrestle/heroWrestleConfig';
import { playHeroWrestle } from './heroWrestle/heroWrestle';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the WRESTLING hero attack ("Top Rope", a Legendary, in progress: no cosmetic yet). The two portraits
 * wrestle each other: four groups of per-tier dials (I the chop, II the body slam, III the elbow drop, IV the finisher
 * in the ring ropes), each move's own timings, the colours and one clip / gain / pitch row per sound cue. The Play
 * buttons run the real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the body slam.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the elbow drop.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the finisher (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  gap: ['Stand apart', '×', 'How close the two stand when they lock up (1 = just touching).', 'Ready'],
  chopWindMs: ['Wind-up', 'ms', 'I: the striker leaning away, its arm drawn back.', 'I: the chop'],
  chopMs: ['Chop', 'ms', 'I: the arm coming through to the smack.', 'I: the chop'],
  chopLean: ['Lean', '°', 'I: how far the striker leans away on the wind-up.', 'I: the chop'],
  stagger: ['Stagger', '×', 'I: how far the struck portrait staggers (its own radii).', 'I: the chop'],
  dipMs: ['Dip', 'ms', 'II: the striker dipping under the struck portrait.', 'II: the body slam'],
  liftMs: ['Lift', 'ms', 'II: hoisting it overhead.', 'II: the body slam'],
  hangMs: ['Held beat', 'ms', 'II: the beat at the top of the lift.', 'II: the body slam'],
  slamMs: ['Slam', 'ms', 'II: the drop to the mat.', 'II: the body slam'],
  liftHeight: ['Lift height', '×', 'II: how high it is held (the two radii added).', 'II: the body slam'],
  bounceMs: ['Bounce', 'ms', 'II: the one bounce off the mat.', 'II: the body slam'],
  bounce: ['Bounce height', '×', 'II: how high it bounces (its own radii).', 'II: the body slam'],
  shoveMs: ['Shove', 'ms', 'III: the shove that leaves the struck portrait flat on its back.', 'III: the elbow drop'],
  climbMs: ['Climb', 'ms', 'III: the striker crouching and leaving through the top of the screen.', 'III: the elbow drop'],
  perchMs: ['Held beat', 'ms', 'III: the beat off screen while the spotlight finds its target.', 'III: the elbow drop'],
  diveMs: ['Dive', 'ms', 'III: the drop from the top onto the mat.', 'III: the elbow drop'],
  spot: ['Spotlight', '×', 'III: how bright the spotlight is (0 = none).', 'III: the elbow drop'],
  ringWidth: ['Ring width', '×', 'IV: half the ring, in portrait radii (it is narrowed to fit the screen).', 'IV: the finisher'],
  ropeSize: ['Rope size', '×', 'IV: how thick the ropes are.', 'IV: the finisher'],
  grabMs: ['Lock-up', 'ms', 'IV: the striker taking hold before the whip.', 'IV: the finisher'],
  whipMs: ['Whip', 'ms', 'IV: the run across the ring to the far ropes.', 'IV: the finisher'],
  stretchMs: ['On the ropes', 'ms', 'IV: the ropes stretching out and flinging it back.', 'IV: the finisher'],
  stretch: ['Rope stretch', '×', 'IV: how far the ropes stretch (the struck portrait\'s radii).', 'IV: the finisher'],
  reboundMs: ['Rebound', 'ms', 'IV: the run back into the clothesline (THE impact).', 'IV: the finisher'],
  flipMs: ['Flip', 'ms', 'IV: the flip through the air to the mat.', 'IV: the finisher'],
  flipTurns: ['Flip turns', undefined, 'IV: how many whole turns it makes before it lands flat.', 'IV: the finisher'],
  coverMs: ['Cover', 'ms', 'IV: the striker dropping on top for the pin.', 'IV: the finisher'],
  countMs: ['Count', 'ms', 'IV: the gap between 1, 2 and 3.', 'IV: the finisher'],
  winMs: ['Winner', 'ms', 'IV: the bell and the winner\'s beat before both go home.', 'IV: the finisher'],
  wordSize: ['Word size', '×', 'WOO!, SLAM!, WINNER! and the count\'s 1, 2, 3 (0 = no words).', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the portraits squash on the hits and the landings.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The walk in, the arm, the lift, the dive, the whip and the rebound.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxChopGain: ['chop: gain', undefined, 'I: the chop (THE impact). IV: the clothesline. III: a layer of the elbow.', 'Sound: chop'],
  sfxChopRate: ['chop: pitch', '×', 'Pitch of the chop.', 'Sound: chop'],
  sfxSlamGain: ['slam: gain', undefined, 'The body on the mat (II and III: THE impact), every landing, and the count\'s slaps (pitched up).', 'Sound: mat slam'],
  sfxSlamRate: ['slam: pitch', '×', 'Pitch of the slam.', 'Sound: mat slam'],
  sfxBoomGain: ['boom: gain', undefined, 'A low layer under the slam, the elbow and the clothesline.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxBellGain: ['bell: gain', undefined, 'IV: the ring bell after the three count.', 'Sound: bell'],
  sfxBellRate: ['bell: pitch', '×', 'Pitch of the bell.', 'Sound: bell'],
  sfxWooGain: ['crowd: gain', undefined, 'The crowd\'s "woo" (the chop, the held beats, the slam, the clothesline).', 'Sound: crowd woo'],
  sfxWooRate: ['crowd: pitch', '×', 'Pitch of the crowd.', 'Sound: crowd woo'],
  sfxCheerGain: ['cheer: gain', undefined, 'III and IV: the crowd cheering (the elbow, the bell).', 'Sound: cheer'],
  sfxCheerRate: ['cheer: pitch', '×', 'Pitch of the cheer.', 'Sound: cheer'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<WrestleTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the striker sets off.'],
  WalkMs: ['Walk in', 'ms', 'The striker striding up beside the struck portrait.'],
  HoldMs: ['Hold', 'ms', 'After the impact before both head home. IV: unused (the pin and the count run instead).'],
  ReturnMs: ['Return', 'ms', 'Both portraits getting up and going home.'],
  Knock: ['Knockback', '×', 'I: how hard the struck portrait rocks and staggers. II-IV: unused.'],
  Zoom: ['Push in', '×', 'How far the view pushes in while the two are locked up.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (the landings and the count shake a fraction of it).'],
  Burst: ['Burst', '×', 'The size of the impact (flash, stars, the dust ring, the word).'],
  Rings: ['Shockwaves', undefined, 'Rings off the impact (II-IV: flat rings of dust along the mat).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herowrestle', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Top Rope (wrestling)',
  store: heroWrestleStore,
  defaults: HERO_WRESTLE_DEFAULTS,
  ranges: HERO_WRESTLE_RANGES,
  globals: GLOBALS,
  levels: WRESTLE_LEVELS,
  levelNames: { t1: 'Tier I (the chop)', t2: 'Tier II (the body slam)', t3: 'Tier III (the elbow drop)', t4: 'Tier IV (the finisher)' },
  suffixes: WRESTLE_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorMat', 'Mat dust', 'The canvas dust off the mat.'],
    ['colorFlash', 'Flash', 'The impact flashes and sparks.'],
    ['colorPow', 'Pow', 'The stars, the count\'s flash and the bell\'s rings.'],
    ['colorHand', 'Hand print', 'I: the hand print the chop leaves.'],
    ['colorSpot', 'Spotlight', 'III: the spotlight.'],
    ['colorPlayer', 'Your side', 'Your glow, rings and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their glow, rings and total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: whoosh': 'sfxWhooshClip', 'Sound: chop': 'sfxChopClip', 'Sound: mat slam': 'sfxSlamClip', 'Sound: boom': 'sfxBoomClip',
    'Sound: bell': 'sfxBellClip', 'Sound: crowd woo': 'sfxWooClip', 'Sound: cheer': 'sfxCheerClip',
  },
  note: () => {
    const c = getHeroWrestleConfig();
    const p = wrestlePlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroWrestle(o),
  verb: 'wrestles',
  smallHint: 'the chop.',
  bigHint: 'the elbow drop.',
  tierHints: [
    'the chop: it strides up, winds an arm back and chops. A red hand print, and the crowd goes WOO.',
    'the body slam: it dips under, lifts the other overhead, holds it, and slams it to the mat.',
    'the elbow drop: a shove leaves the other flat, it climbs out of the top of the screen and drops an elbow from above.',
    'the finisher: ring ropes, an Irish whip, a clothesline off the rebound, the pin, 1, 2, 3 and the bell.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroWrestle?: unknown }).__heroWrestle = { demo: built.demo };
}

export function HeroWrestleTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
