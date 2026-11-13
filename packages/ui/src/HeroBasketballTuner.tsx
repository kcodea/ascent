import {
  BASKETBALL_LEVELS, BASKETBALL_TIER_SUFFIXES, FADEAWAY_MOVES, HERO_BASKETBALL_DEFAULTS, THREE_SPOTS, HERO_BASKETBALL_RANGES, basketballPlan, getHeroBasketballConfig,
  heroBasketballStore, type BasketballTierSuffix,
} from './heroBasketball/heroBasketballConfig';
import { playHeroBasketball } from './heroBasketball/heroBasketball';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the BASKETBALL hero attack (the Nothing But Net cosmetic, a Legendary; owner ask 2026-09-29: "tier 1 =
 * basketball shot from place / tier 2 = a fadeaway ... / tier 3 = a slam dunk on the target / tier 4 = a self alley
 * oop"; reviewed: Tier 3 became a pull-up three, Tier 4 two threes, a chest pass off the backboard, an epic leap to the rebound at half court, a slow-mo catch and one flying slam). Four groups of
 * per-tier dials (Tier 1 the jumper, Tier 2 the fadeaway, Tier 3 the pull-up three, Tier 4 the alley-oop), the moves'
 * geometry, the colours and one clip / gain / pitch row per sound cue (whistle, dribble, sneaker squeak, throw, swish,
 * catch, rim, slam, glass, crowd "ooh", cheer). The Play buttons run the real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Shared damage tier 2 (6): the fadeaway.', 'Damage tiers'],
  tier3At: ['Tier 3 from', undefined, 'Shared damage tier 3 (12): the pull-up three.', 'Damage tiers'],
  tier4At: ['Tier 4 from', undefined, 'Shared damage tier 4 (20): the self alley-oop (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  gatherMs: ['Crouch', 'ms', 'The crouch before a jump (Tier 1 plays a shorter one).', 'Ready'],
  ballSize: ['Ball size', '×', 'The ball\'s diameter, in striker radii.', 'Ball'],
  spin: ['Backspin', undefined, 'How fast the ball spins backwards in flight (turns per second).', 'Ball'],
  trailMs: ['Trail gap', 'ms', 'How often a soft ghost of the ball is left behind in flight (lower = a denser trail).', 'Ball'],
  shadowDrop: ['Shadow drop', '×', 'How far the ball\'s and the striker\'s shadows fall below them at full height.', 'Ball'],
  jumpLift: ['Jump lift', '×', 'Tier 1 (and Tier 3\'s pull-up, a little higher): how high the striker jumps for the shot (striker radii).', 'Moves: the jumper (Tier 1)'],
  midCourt: ['Mid court', '×', 'Tier 2: how far toward the target the striker slides before the fade (0.45 = just short of halfway).', 'Moves: the fadeaway (Tier 2)'],
  fadeBack: ['Fade back', '×', 'Tier 2: how far it drifts BACK from mid court (striker radii).', 'Moves: the fadeaway (Tier 2)'],
  fadeSide: ['Fade side', '×', 'Tier 2: how far it drifts to the side (the side with more room).', 'Moves: the fadeaway (Tier 2)'],
  wrapMs: ['Behind-the-back wrap', 'ms', 'Tier 2: how long the ball takes to circle round the back (the slide to mid court stretches to fit it).', 'Moves: the fadeaway (Tier 2)'],
  fadeLean: ['Fade lean', '°', 'Tier 2: how far it leans back into the fade (Tier 3 leans back a little on the step back).', 'Moves: the fadeaway (Tier 2)'],
  scootUp: ['Scoot height', '×', 'Tier 3: how far the striker scoots straight up court from its slot (striker radii).', 'Moves: the three (Tier 3)'],
  passMs: ['Pass flight', 'ms', 'Tier 3: the pass flying in from off the right edge to the hands.', 'Moves: the three (Tier 3)'],
  passEntry: ['Pass entry', '×', 'Tier 3: how high the pass enters from the right edge, relative to the catch (striker radii; minus = higher).', 'Moves: the three (Tier 3)'],
  passArc: ['Pass arc', '×', 'Tier 3: how much the pass arcs (0 = a straight line).', 'Moves: the three (Tier 3)'],
  pumpMs: ['Pump fake', 'ms', 'Tier 3: the pump fake, up and back down.', 'Moves: the three (Tier 3)'],
  pumpLift: ['Pump fake lift', '×', 'Tier 3: how high the ball comes up on the pump fake (striker radii).', 'Moves: the three (Tier 3)'],
  backMs: ['Dribble back', 'ms', 'Tier 3: the dribble back before the pull-up (its dribbles are Tier 3\'s Dribbles).', 'Moves: the three (Tier 3)'],
  dribbleBack: ['Step back', '×', 'Tier 3: how far it dribbles back, away from the target (striker radii).', 'Moves: the three (Tier 3)'],
  halfCourt: ['Run-up', '×', 'Tier 4: how far toward the target the quick run-up goes before the leap (0 = it leaps from its slot).', 'Moves: the alley-oop (Tier 4)'],
  oopThrees: ['Opening threes', undefined, 'Tier 4: how many pull-up threes before the slam (2 = one from the slot, one from a spot up court off a pass; 0 = straight to the slam). Ticks: no damage.', 'Moves: the alley-oop (Tier 4)'],
  oopShotMs: ['Opening three flight', 'ms', 'Tier 4: each opening three flight to the net.', 'Moves: the alley-oop (Tier 4)'],
  oopScootMs: ['Rotate up', 'ms', 'Tier 4: the rotation up court to the spot after the first three.', 'Moves: the alley-oop (Tier 4)'],
  oopPassMs: ['Opening pass', 'ms', 'Tier 4: the pass flying in to the spot for the second three.', 'Moves: the alley-oop (Tier 4)'],
  oopBackMs: ['Rotate back', 'ms', 'Tier 4: the rotation back to the baseline (its slot) before the slam sequence.', 'Moves: the alley-oop (Tier 4)'],
  reboundMs: ['Rebound', 'ms', 'Tier 4: the ball coming off the backboard back out to half court.', 'Moves: the alley-oop (Tier 4)'],
  ballLeadMs: ['Ball first by', 'ms', 'Tier 4: how long the ball is at half court before the player gets there (the leap never beats the ball).', 'Moves: the alley-oop (Tier 4)'],
  alleyRise: ['Catch height', '×', 'Tier 4: how high above the player\'s head the ball is caught at half court (striker radii).', 'Moves: the alley-oop (Tier 4)'],
  crouchMs: ['Crouch', 'ms', 'Tier 4: the deep crouch before the launch (the charge-up).', 'Moves: the alley-oop (Tier 4)'],
  crouchSquash: ['Crouch depth', '×', 'Tier 4: how far the striker squashes down in the crouch (and springs tall on the launch).', 'Moves: the alley-oop (Tier 4)'],
  launchSize: ['Launch', '×', 'Tier 4: the launch out of the crouch (the dust shock ring, the grit, the flash under the feet).', 'Moves: the alley-oop (Tier 4)'],
  auraSize: ['Aura', '×', 'Tier 4: the aura building round the striker from the crouch to the slam (0 = none).', 'Moves: the alley-oop (Tier 4)'],
  blastSize: ['Explosion size', '×', 'Tier 4: the explosion under the slam (fireball, shock ring, debris, sparks; 0 = none).', 'Moves: the alley-oop (Tier 4)'],
  threeSlow: ['Tier 3 slow mo', '×', 'Tier 3: how slow the clock gets around the pull-up and release (1 = none). A smooth ramp, never a freeze.', 'Slow mo'],
  threeSlowMs: ['Tier 3 slow mo length', 'ms', 'Tier 3: roughly how long (real time) the slow mo lasts around the release.', 'Slow mo'],
  alleySlow: ['Tier 4 slow mo', '×', 'Tier 4: how slow the clock gets around the catch at the top of the leap (1 = none).', 'Slow mo'],
  alleySlowMs: ['Tier 4 slow mo length', 'ms', 'Tier 4: roughly how long (real time) the hang-time slow mo lasts.', 'Slow mo'],
  slamBoost: ['Tier 4 slam speed', '×', 'Tier 4: the clock runs this much FASTER through the one fluid slam, after the slow mo eases back in.', 'Slow mo'],
  slowRampMs: ['Slow mo ease', 'ms', 'How long (attack time) the clock eases into and out of the slow mo.', 'Slow mo'],
  slowZoom: ['Slow mo push', '×', 'A subtle extra push in on the view during the slow mo.', 'Slow mo'],
  hangMs: ['Hang time', 'ms', 'Tier 4: the moment in the air after the catch before the slam.', 'Moves: the alley-oop (Tier 4)'],
  slamContact: ['Slam depth', '×', 'Tier 4: where the striker stops on the slam (0 = right over the target\'s centre).', 'Moves: the alley-oop (Tier 4)'],
  hoopSize: ['Hoop size', '×', 'The hoop drawn on the target (rim, net, backboard).', 'Hoop and words'],
  wordSize: ['Word size', '×', 'SWISH and SLAM (0 = no words).', 'Hoop and words'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked on the slam.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the portraits squash (landings, the slam).', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxWhistleGain: ['whistle: gain', undefined, 'The referee\'s whistle as it starts (softer on Tier 1).', 'Sound: whistle'],
  sfxWhistleRate: ['whistle: pitch', '×', 'Pitch of the whistle.', 'Sound: whistle'],
  sfxDribbleGain: ['dribble: gain', undefined, 'Each dribble on the floor.', 'Sound: dribble'],
  sfxDribbleRate: ['dribble: pitch', '×', 'Pitch of the dribble.', 'Sound: dribble'],
  sfxSqueakGain: ['squeak: gain', undefined, 'The sneakers: the push-offs, the stops, the catch, the pump fake, the step back, the take-off, the slide home.', 'Sound: sneakers'],
  sfxSqueakRate: ['squeak: pitch', '×', 'Pitch of the squeak.', 'Sound: sneakers'],
  sfxThrowGain: ['throw: gain', undefined, 'The whoosh of a shot, Tier 3\'s pass, Tier 4\'s throw and its leap.', 'Sound: throw'],
  sfxThrowRate: ['throw: pitch', '×', 'Pitch of the whoosh.', 'Sound: throw'],
  sfxSwishGain: ['swish: gain', undefined, 'Tiers 1-3: nothing but net (THE impact; louder on the three).', 'Sound: swish'],
  sfxSwishRate: ['swish: pitch', '×', 'Pitch of the swish.', 'Sound: swish'],
  sfxCatchGain: ['catch: gain', undefined, 'Tier 3: the pass slapped into the hands; Tier 4: the catch at the top of the leap.', 'Sound: catch'],
  sfxCatchRate: ['catch: pitch', '×', 'Pitch of the catch.', 'Sound: catch'],
  sfxRimGain: ['rim: gain', undefined, 'Tier 4: the rim rattling on the slam.', 'Sound: rim'],
  sfxRimRate: ['rim: pitch', '×', 'Pitch of the rim.', 'Sound: rim'],
  sfxSlamGain: ['slam: gain', undefined, 'Tier 4: the slam landing (THE impact).', 'Sound: slam'],
  sfxSlamRate: ['slam: pitch', '×', 'Pitch of the slam.', 'Sound: slam'],
  sfxShatterGain: ['glass: gain', undefined, 'Tier 4: the backboard shattering.', 'Sound: glass'],
  sfxShatterRate: ['glass: pitch', '×', 'Pitch of the glass.', 'Sound: glass'],
  sfxOohGain: ['ooh: gain', undefined, 'The crowd going "ooh": soft on Tier 2, full on the Tier 3 three, loudest on Tier 4.', 'Sound: crowd ooh'],
  sfxOohRate: ['ooh: pitch', '×', 'Pitch of the crowd.', 'Sound: crowd ooh'],
  sfxCheerGain: ['cheer: gain', undefined, 'Tier 4: the crowd erupting after the alley-oop.', 'Sound: cheer'],
  sfxCheerRate: ['cheer: pitch', '×', 'Pitch of the cheer.', 'Sound: cheer'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<BasketballTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the striker moves.'],
  Dribbles: ['Dribbles', undefined, 'How many dribbles (Tier 1 where it stands; Tiers 2-4 along the run).'],
  DribbleMs: ['Dribble', 'ms', 'One dribble where it stands (Tiers 1, 4); the dribble\'s shape along a run (Tiers 2, 3).'],
  ApproachMs: ['Run', 'ms', 'Tier 2 the slide to mid court; Tier 3 the scoot up court; Tier 4 the quick run-up (at most, it must fit before the leap). Tier 1 stands still.'],
  LeapMs: ['Leap', 'ms', 'Tier 1 the jump up (and as long down); Tier 2 the whole fade; Tier 3 the whole pull-up; Tier 4 the leap to the catch (its timing).'],
  FlightMs: ['Shot flight', 'ms', 'Tiers 1-3: the shot to the net; Tier 4: the throw at the backboard (lower = faster).'],
  Arc: ['Arc', '×', 'How high the shot arcs (a fraction of the distance; trimmed to stay on screen). Tier 4\'s throw is nearly flat.'],
  SlamMs: ['Slam', 'ms', 'Tier 4: the slam down onto the target.'],
  HoldMs: ['Hold', 'ms', 'After the impact before it heads home (and the end on Tier 1).'],
  ReturnMs: ['Return', 'ms', 'Tiers 2-4: the slide or the drop back home.'],
  JumpScale: ['Jump scale', '×', 'How much the striker grows in the air.'],
  Zoom: ['Push in', '×', 'How far the view pushes in on the target.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (Tier 4 rumbles the whole board).'],
  Burst: ['Burst', '×', 'The size of the swish or the slam (flash, rings, sparks, the word).'],
  Rings: ['Shockwaves', undefined, 'Tier 3: rings rippling off the swish; Tier 4: shockwave rings on the slam.'],
  Shards: ['Glass shards', undefined, 'The backboard shattering on the slam (Tier 4).'],
  Confetti: ['Confetti', undefined, 'Confetti thrown on the three\'s swish (and the slam, if set).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

let previewRoll = 0;

const built = rareTunerSpec({
  id: 'herobasketball', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Basketball',
  store: heroBasketballStore,
  defaults: HERO_BASKETBALL_DEFAULTS,
  ranges: HERO_BASKETBALL_RANGES,
  globals: GLOBALS,
  levels: BASKETBALL_LEVELS,
  levelNames: { t1: 'Tier 1 (the jumper)', t2: 'Tier 2 (the fadeaway)', t3: 'Tier 3 (the pull-up three)', t4: 'Tier 4 (the self alley-oop)' },
  suffixes: BASKETBALL_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorBall', 'Ball', 'The basketball (and its trail).'],
    ['colorRim', 'Rim', 'The hoop\'s rim.'],
    ['colorNet', 'Net', 'The net and the swish ring.'],
    ['colorGlass', 'Glass', 'The backboard and its shards.'],
    ['colorFlash', 'Flash', 'The impact flashes, stars and the catch.'],
    ['colorBlast', 'Explosion', 'Tier 4: the fireball and embers of the explosion.'],
    ['colorConfettiA', 'Confetti A', 'One of the confetti colours.'],
    ['colorConfettiB', 'Confetti B', 'Another confetti colour.'],
    ['colorPlayer', 'Your side', 'Your glow, rings and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their glow, rings and total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: whistle': 'sfxWhistleClip', 'Sound: dribble': 'sfxDribbleClip', 'Sound: sneakers': 'sfxSqueakClip', 'Sound: throw': 'sfxThrowClip',
    'Sound: swish': 'sfxSwishClip', 'Sound: catch': 'sfxCatchClip', 'Sound: rim': 'sfxRimClip', 'Sound: slam': 'sfxSlamClip',
    'Sound: glass': 'sfxShatterClip', 'Sound: crowd ooh': 'sfxOohClip', 'Sound: cheer': 'sfxCheerClip',
  },
  note: () => {
    const c = getHeroBasketballConfig();
    const p = basketballPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  // A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay rolls the same).
  play: (o) => playHeroBasketball({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) }),
  verb: 'shoots at',
  smallHint: 'the jumper, a swish from where it stands.',
  bigHint: 'the pull-up three.',
  tierHints: [
    'the jumper, a dribble, a jump shot and a swish from where it stands.',
    'the fadeaway, a dribble move (wrap, crossover or spin) on the slide to mid court, a fade back to the side and a swish.',
    'the pull-up three, a scoot to a spot (up, the left wing or the right corner), a pass, a pump fake, a dribble back and a slow-mo three.',
    'two threes (from the slot, then off a pass up court), then a chest pass off the backboard, a leap to catch the rebound at half court in slow mo, and one flying slam into an explosion.',
  ],
});

// THE VARIATION override (DEV): Random (rolled per blow) or force one, placed right under the Attack style row.
built.spec.controls.splice(1, 0, {
  key: 'variation', label: 'Variation', kind: 'select', options: ['', '1', '2', '3'], group: 'Style', min: 0, max: 0, step: 0,
  optionLabels: {
    '': 'Random (rolled per fight)',
    1: `1: ${FADEAWAY_MOVES[1]} (Tier 2), ${THREE_SPOTS[1]} (Tier 3)`,
    2: `2: ${FADEAWAY_MOVES[2]} (Tier 2), ${THREE_SPOTS[2]} (Tier 3)`,
    3: `3: ${FADEAWAY_MOVES[3]} (Tier 2), ${THREE_SPOTS[3]} (Tier 3)`,
  },
  hint: 'Tier 2 rolls a dribble move and Tier 3 a spot to catch the pass. Random = what real fights do (the same fight always rolls the same).',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBasketball?: unknown }).__heroBasketball = { demo: built.demo };
}

export function HeroBasketballTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
