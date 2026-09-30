import {
  BASKETBALL_LEVELS, BASKETBALL_TIER_SUFFIXES, HERO_BASKETBALL_DEFAULTS, HERO_BASKETBALL_RANGES, basketballPlan, getHeroBasketballConfig,
  heroBasketballStore, type BasketballTierSuffix,
} from './heroBasketball/heroBasketballConfig';
import { playHeroBasketball } from './heroBasketball/heroBasketball';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the BASKETBALL hero attack (the Nothing But Net cosmetic, a Legendary; owner ask 2026-09-29: "tier 1 =
 * basketball shot from place / tier 2 = a fadeaway ... / tier 3 = a slam dunk on the target / tier 4 = a self alley
 * oop"; reviewed: III became a pull-up three, IV a fast throw that bounces high, a leap, a catch and an explosive slam). Four groups of
 * per-tier dials (I the jumper, II the fadeaway, III the pull-up three, IV the alley-oop), the moves'
 * geometry, the colours and one clip / gain / pitch row per sound cue (whistle, dribble, sneaker squeak, throw, swish,
 * catch, rim, slam, glass, crowd "ooh", cheer). The Play buttons run the real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the fadeaway.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the pull-up three.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the self alley-oop (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  gatherMs: ['Crouch', 'ms', 'The crouch before a jump (I plays a shorter one).', 'Ready'],
  ballSize: ['Ball size', '×', 'The ball\'s diameter, in striker radii.', 'Ball'],
  spin: ['Backspin', undefined, 'How fast the ball spins backwards in flight (turns per second).', 'Ball'],
  trailMs: ['Trail gap', 'ms', 'How often a soft ghost of the ball is left behind in flight (lower = a denser trail).', 'Ball'],
  shadowDrop: ['Shadow drop', '×', 'How far the ball\'s and the striker\'s shadows fall below them at full height.', 'Ball'],
  jumpLift: ['Jump lift', '×', 'I (and III\'s pull-up, a little higher): how high the striker jumps for the shot (striker radii).', 'Moves: the jumper (I)'],
  midCourt: ['Mid court', '×', 'II: how far toward the target the striker slides before the fade (0.45 = just short of halfway).', 'Moves: the fadeaway (II)'],
  fadeBack: ['Fade back', '×', 'II: how far it drifts BACK from mid court (striker radii).', 'Moves: the fadeaway (II)'],
  fadeSide: ['Fade side', '×', 'II: how far it drifts to the side (the side with more room).', 'Moves: the fadeaway (II)'],
  fadeLean: ['Fade lean', '°', 'II: how far it leans back into the fade (III leans back a little on the step back).', 'Moves: the fadeaway (II)'],
  scootUp: ['Scoot height', '×', 'III: how far the striker scoots straight up court from its slot (striker radii).', 'Moves: the three (III)'],
  passMs: ['Pass flight', 'ms', 'III: the pass flying in from off the right edge to the hands.', 'Moves: the three (III)'],
  passEntry: ['Pass entry', '×', 'III: how high the pass enters from the right edge, relative to the catch (striker radii; minus = higher).', 'Moves: the three (III)'],
  passArc: ['Pass arc', '×', 'III: how much the pass arcs (0 = a straight line).', 'Moves: the three (III)'],
  pumpMs: ['Pump fake', 'ms', 'III: the pump fake, up and back down.', 'Moves: the three (III)'],
  pumpLift: ['Pump fake lift', '×', 'III: how high the ball comes up on the pump fake (striker radii).', 'Moves: the three (III)'],
  backMs: ['Dribble back', 'ms', 'III: the dribble back before the pull-up (its dribbles are Tier III\'s Dribbles).', 'Moves: the three (III)'],
  dribbleBack: ['Step back', '×', 'III: how far it dribbles back, away from the target (striker radii).', 'Moves: the three (III)'],
  halfCourt: ['Run-up', '×', 'IV: how far toward the target the quick run-up goes before the leap (0 = it leaps from its slot).', 'Moves: the alley-oop (IV)'],
  alleyRise: ['Bounce height', '×', 'IV: how high the ball bounces off the target, where it is caught (struck radii).', 'Moves: the alley-oop (IV)'],
  riseMs: ['Bounce rise', 'ms', 'IV: the ball rising off the target to the top of its bounce (the leap is timed to meet it there).', 'Moves: the alley-oop (IV)'],
  blastSize: ['Explosion size', '×', 'IV: the explosion under the slam (fireball, shock ring, debris, sparks; 0 = none).', 'Moves: the alley-oop (IV)'],
  hangMs: ['Hang time', 'ms', 'IV: the moment in the air after the catch before the slam.', 'Moves: the alley-oop (IV)'],
  slamContact: ['Slam depth', '×', 'IV: where the striker stops on the slam (0 = right over the target\'s centre).', 'Moves: the alley-oop (IV)'],
  hoopSize: ['Hoop size', '×', 'The hoop drawn on the target (rim, net, backboard).', 'Hoop and words'],
  wordSize: ['Word size', '×', 'SWISH and SLAM (0 = no words).', 'Hoop and words'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked on the slam.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the portraits squash (landings, the slam).', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxWhistleGain: ['whistle: gain', undefined, 'The referee\'s whistle as it starts (softer on I).', 'Sound: whistle'],
  sfxWhistleRate: ['whistle: pitch', '×', 'Pitch of the whistle.', 'Sound: whistle'],
  sfxDribbleGain: ['dribble: gain', undefined, 'Each dribble on the floor (and IV\'s smack off the target, lower).', 'Sound: dribble'],
  sfxDribbleRate: ['dribble: pitch', '×', 'Pitch of the dribble.', 'Sound: dribble'],
  sfxSqueakGain: ['squeak: gain', undefined, 'The sneakers: the push-offs, the stops, the catch, the pump fake, the step back, the take-off, the slide home.', 'Sound: sneakers'],
  sfxSqueakRate: ['squeak: pitch', '×', 'Pitch of the squeak.', 'Sound: sneakers'],
  sfxThrowGain: ['throw: gain', undefined, 'The whoosh of a shot, III\'s pass, IV\'s throw and its leap.', 'Sound: throw'],
  sfxThrowRate: ['throw: pitch', '×', 'Pitch of the whoosh.', 'Sound: throw'],
  sfxSwishGain: ['swish: gain', undefined, 'I-III: nothing but net (THE impact; louder on the three).', 'Sound: swish'],
  sfxSwishRate: ['swish: pitch', '×', 'Pitch of the swish.', 'Sound: swish'],
  sfxCatchGain: ['catch: gain', undefined, 'III: the pass slapped into the hands; IV: the catch at the top of the leap.', 'Sound: catch'],
  sfxCatchRate: ['catch: pitch', '×', 'Pitch of the catch.', 'Sound: catch'],
  sfxRimGain: ['rim: gain', undefined, 'IV: the rim rattling on the slam (and softly on the smack).', 'Sound: rim'],
  sfxRimRate: ['rim: pitch', '×', 'Pitch of the rim.', 'Sound: rim'],
  sfxSlamGain: ['slam: gain', undefined, 'IV: the slam landing (THE impact).', 'Sound: slam'],
  sfxSlamRate: ['slam: pitch', '×', 'Pitch of the slam.', 'Sound: slam'],
  sfxShatterGain: ['glass: gain', undefined, 'IV: the backboard shattering.', 'Sound: glass'],
  sfxShatterRate: ['glass: pitch', '×', 'Pitch of the glass.', 'Sound: glass'],
  sfxOohGain: ['ooh: gain', undefined, 'The crowd going "ooh": soft on II, full on the III three, loudest on IV.', 'Sound: crowd ooh'],
  sfxOohRate: ['ooh: pitch', '×', 'Pitch of the crowd.', 'Sound: crowd ooh'],
  sfxCheerGain: ['cheer: gain', undefined, 'IV: the crowd erupting after the alley-oop.', 'Sound: cheer'],
  sfxCheerRate: ['cheer: pitch', '×', 'Pitch of the cheer.', 'Sound: cheer'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<BasketballTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the striker moves.'],
  Dribbles: ['Dribbles', undefined, 'How many dribbles (I where it stands; II-IV along the run).'],
  DribbleMs: ['Dribble', 'ms', 'One dribble where it stands (I, IV); the dribble\'s shape along a run (II, III).'],
  ApproachMs: ['Run', 'ms', 'II the slide to mid court; III the scoot up court; IV the quick run-up (at most, it must fit before the leap). I stands still.'],
  LeapMs: ['Leap', 'ms', 'I the jump up (and as long down); II the whole fade; III the whole pull-up; IV the leap to the catch (its timing).'],
  FlightMs: ['Shot flight', 'ms', 'I-III: the shot to the net; IV: the throw at the target (lower = faster).'],
  Arc: ['Arc', '×', 'How high the shot arcs (a fraction of the distance; trimmed to stay on screen). IV\'s throw is nearly flat.'],
  SlamMs: ['Slam', 'ms', 'IV: the slam down onto the target.'],
  HoldMs: ['Hold', 'ms', 'After the impact before it heads home (and the end on I).'],
  ReturnMs: ['Return', 'ms', 'II-IV: the slide or the drop back home.'],
  JumpScale: ['Jump scale', '×', 'How much the striker grows in the air.'],
  Zoom: ['Push in', '×', 'How far the view pushes in on the target.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (IV rumbles the whole board).'],
  Burst: ['Burst', '×', 'The size of the swish or the slam (flash, rings, sparks, the word).'],
  Rings: ['Shockwaves', undefined, 'III: rings rippling off the swish; IV: shockwave rings on the slam.'],
  Shards: ['Glass shards', undefined, 'The backboard shattering on the slam (IV).'],
  Confetti: ['Confetti', undefined, 'Confetti thrown on the three\'s swish (and the slam, if set).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herobasketball', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Basketball',
  store: heroBasketballStore,
  defaults: HERO_BASKETBALL_DEFAULTS,
  ranges: HERO_BASKETBALL_RANGES,
  globals: GLOBALS,
  levels: BASKETBALL_LEVELS,
  levelNames: { t1: 'Tier I (the jumper)', t2: 'Tier II (the fadeaway)', t3: 'Tier III (the pull-up three)', t4: 'Tier IV (the self alley-oop)' },
  suffixes: BASKETBALL_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorBall', 'Ball', 'The basketball (and its trail).'],
    ['colorRim', 'Rim', 'The hoop\'s rim.'],
    ['colorNet', 'Net', 'The net and the swish ring.'],
    ['colorGlass', 'Glass', 'The backboard and its shards.'],
    ['colorFlash', 'Flash', 'The impact flashes, stars and the catch.'],
    ['colorBlast', 'Explosion', 'IV: the fireball and embers of the explosion (and the smack\'s glow).'],
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
  play: (o) => playHeroBasketball(o),
  verb: 'shoots at',
  smallHint: 'the jumper, a swish from where it stands.',
  bigHint: 'the pull-up three.',
  tierHints: [
    'the jumper, a dribble, a jump shot and a swish from where it stands.',
    'the fadeaway, a slide to mid court, a fade back to the side and a swish.',
    'the pull-up three, a scoot up court, a pass from the right, a pump fake, a dribble back and a three.',
    'the self alley-oop, a fast throw off the target, a high bounce, the leap, the catch and a slam into an explosion.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBasketball?: unknown }).__heroBasketball = { demo: built.demo };
}

export function HeroBasketballTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
