import {
  BREAKAWAY_SKILLS, CORNER_KINDS, HERO_SOCCER_DEFAULTS, HERO_SOCCER_RANGES, SOCCER_LEVELS, SOCCER_TIER_SUFFIXES, getHeroSoccerConfig, heroSoccerStore, soccerPlan,
  type SoccerTierSuffix,
} from './heroSoccer/heroSoccerConfig';
import { playHeroSoccer } from './heroSoccer/heroSoccer';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the SOCCER hero attack (the Golazo cosmetic, a Legendary; owner ask 2026-11-02: "make 2 attack
 * animations, a soccer one, and a baseball one. get creative and fun with them, like a corner kick for soccer then a
 * breakaway etc."). Four groups of per-tier dials (I the volley, II the corner kick, III the breakaway, IV the bicycle
 * kick), the moves' geometry, the slow mo, the colours and one clip / gain / pitch row per sound cue (whistle, kick,
 * touch, whoosh, net, post, boom, crowd "ooh", crowd roar). The Play buttons run the real runner between the two real
 * portraits; the Variation row forces II's corner and III's skill.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the corner kick.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the breakaway.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the bicycle kick (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  gatherMs: ['Gather', 'ms', 'The set before a jump or a finish (I a shorter one).', 'Ready'],
  ballSize: ['Ball size', '×', 'The ball\'s diameter, in striker radii.', 'Ball'],
  spin: ['Spin', undefined, 'How fast the ball spins in flight (turns per second; a curler spins more).', 'Ball'],
  trailMs: ['Trail gap', 'ms', 'How often a ghost of the ball is left behind in flight (IV\'s fire trail is denser).', 'Ball'],
  shadowDrop: ['Shadow drop', '×', 'How far the ball\'s and the striker\'s shadows fall below them at full height.', 'Ball'],
  juggleHeight: ['Keepy-uppy height', '×', 'I and IV: how high each keepy-uppy goes (striker radii; the flick before the volley goes higher).', 'Moves: the volley (I)'],
  volleyHop: ['Volley hop', '×', 'I: how high the striker hops to meet the volley.', 'Moves: the volley (I)'],
  cornerSetMs: ['Corner set', 'ms', 'II: the ball set down, the step back and the arm raised before the run-up.', 'Moves: the corner kick (II)'],
  cornerRunMs: ['Corner run-up', 'ms', 'II: the run-up into the kick.', 'Moves: the corner kick (II)'],
  curl: ['Curl', '×', 'II: how far the corner (and the short corner\'s curler) bends.', 'Moves: the corner kick (II)'],
  headerFlightMs: ['Header flight', 'ms', 'II (the header): the header into the goal.', 'Moves: the corner kick (II)'],
  oneTwoMs: ['One-two', 'ms', 'II (the short corner): each leg of the wall pass (out off the edge, and back).', 'Moves: the corner kick (II)'],
  defenders: ['Defenders', undefined, 'III: how many defenders it beats on the way (1 to 3).', 'Moves: the breakaway (III)'],
  beatWidth: ['Weave', '×', 'III: how wide it goes round each defender (striker radii).', 'Moves: the breakaway (III)'],
  skillMs: ['Skill', 'ms', 'III: each skill\'s window (the stepovers, the nutmeg, the rainbow flick).', 'Moves: the breakaway (III)'],
  skyHeight: ['Sky height', '×', 'IV: how high the flick sends the ball (striker radii; trimmed to stay on screen).', 'Moves: the bicycle kick (IV)'],
  crouchMs: ['Crouch', 'ms', 'IV: the crouch before the leap.', 'Moves: the bicycle kick (IV)'],
  flipTurns: ['Flip', undefined, 'IV: how many backward flips the leap turns (1 = upside down at the kick, round to land).', 'Moves: the bicycle kick (IV)'],
  slideMs: ['Knee slide', 'ms', 'IV: the knee slide celebration after the landing.', 'Moves: the bicycle kick (IV)'],
  launchSize: ['Launch', '×', 'IV: the launch out of the crouch (the shock ring of grass and dust).', 'Moves: the bicycle kick (IV)'],
  blastSize: ['Explosion size', '×', 'IV: the explosion in the goal (fireball, shock ring, sparks; 0 = none).', 'Moves: the bicycle kick (IV)'],
  breakSlow: ['III slow mo', '×', 'III: how slow the clock gets around the last touch and the finish (1 = none). A smooth ramp, never a freeze.', 'Slow mo'],
  breakSlowMs: ['III slow mo length', 'ms', 'III: roughly how long (real time) the slow mo lasts around the finish.', 'Slow mo'],
  bikeSlow: ['IV slow mo', '×', 'IV: how slow the clock gets around the bicycle kick upside down (1 = none).', 'Slow mo'],
  bikeSlowMs: ['IV slow mo length', 'ms', 'IV: roughly how long (real time) the slow mo lasts around the kick.', 'Slow mo'],
  rocketBoost: ['IV rocket speed', '×', 'IV: the clock runs this much FASTER as the thunderbolt flies, after the slow mo eases back.', 'Slow mo'],
  slowRampMs: ['Slow mo ease', 'ms', 'How long (attack time) the clock eases into and out of the slow mo.', 'Slow mo'],
  slowZoom: ['Slow mo push', '×', 'A subtle extra push in on the view during the slow mo.', 'Slow mo'],
  goalSize: ['Goal size', '×', 'The goal drawn on the target (posts, crossbar, net).', 'Goal and words'],
  wordSize: ['Word size', '×', 'GOAL!, GOLAZO!, NUTMEG! and OLE! (0 = no words).', 'Goal and words'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked when the ball hits the net.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the portraits squash (landings, the impact).', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxWhistleGain: ['whistle: gain', undefined, 'The referee\'s whistle as it starts (softer on I).', 'Sound: whistle'],
  sfxWhistleRate: ['whistle: pitch', '×', 'Pitch of the whistle.', 'Sound: whistle'],
  sfxKickGain: ['kick: gain', undefined, 'The strike (the volley, the corner, the finish, the bicycle kick) and the header.', 'Sound: kick'],
  sfxKickRate: ['kick: pitch', '×', 'Pitch of the kick.', 'Sound: kick'],
  sfxTouchGain: ['touch: gain', undefined, 'The small touches: keepy-uppies, dribble touches, the ball set at the corner, the skills.', 'Sound: touch'],
  sfxTouchRate: ['touch: pitch', '×', 'Pitch of a touch.', 'Sound: touch'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The whoosh of a shot, the skills, IV\'s flick, launch and slide.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxNetGain: ['net: gain', undefined, 'The ball hitting the net (THE impact).', 'Sound: net'],
  sfxNetRate: ['net: pitch', '×', 'Pitch of the net.', 'Sound: net'],
  sfxPostGain: ['post: gain', undefined, 'IV: the goal frame ringing on the thunderbolt.', 'Sound: post'],
  sfxPostRate: ['post: pitch', '×', 'Pitch of the post.', 'Sound: post'],
  sfxBoomGain: ['boom: gain', undefined, 'IV: the launch, the kick and the explosion in the goal.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxOohGain: ['ooh: gain', undefined, 'The crowd rising "Ooooh": the corner in flight, the breakaway, the IV flick sky high (it peaks about a second in).', 'Sound: crowd ooh'],
  sfxOohRate: ['ooh: pitch', '×', 'Pitch of the crowd.', 'Sound: crowd ooh'],
  sfxRoarGain: ['roar: gain', undefined, 'The stadium ROARING on every goal (soft on I, biggest on IV).', 'Sound: crowd roar'],
  sfxRoarRate: ['roar: pitch', '×', 'Pitch of the roar.', 'Sound: crowd roar'],
  sfxGolazoGain: ['golazo: gain', undefined, 'IV: the commentator yelling "GOLAZO!" as the thunderbolt hits the net (with the word).', 'Sound: commentator'],
  sfxGolazoRate: ['golazo: pitch', '×', 'Pitch of the commentator.', 'Sound: commentator'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<SoccerTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the striker moves.'],
  Touches: ['Touches', undefined, 'I / IV: the keepy-uppies before the flick; III: the dribble touches along the run.'],
  TouchMs: ['Touch', 'ms', 'One keepy-uppy (I, IV), or the shape of a dribble touch (III).'],
  ApproachMs: ['Run', 'ms', 'II the jog to the corner flag; III the dribble up the pitch; IV the sprint to the spot. I stands still.'],
  LeapMs: ['Leap', 'ms', 'I the volley hop; II the header\'s leap; IV the whole leap and flip (the kick at its top).'],
  FlightMs: ['Shot flight', 'ms', 'The ball to the net (II: the corner; III: the finish; IV: the thunderbolt).'],
  Arc: ['Arc', '×', 'How high the shot rises (a fraction of the distance; trimmed to stay on screen).'],
  HoldMs: ['Hold', 'ms', 'After the goal before it heads home (and the end on I).'],
  ReturnMs: ['Return', 'ms', 'II-IV: the jog back home.'],
  JumpScale: ['Jump scale', '×', 'How much the striker grows in the air.'],
  Zoom: ['Push in', '×', 'How far the view pushes in on the target.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (IV rumbles the whole board).'],
  Burst: ['Burst', '×', 'The size of the goal (flash, ripples, sparks, the word).'],
  Rings: ['Ripples', undefined, 'Extra ripples pulsing off the net.'],
  Confetti: ['Confetti', undefined, 'Confetti thrown when the ball goes in.'],
  Bulge: ['Net bulge', '×', 'How far the net bursts out when the ball hits it (it springs back).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

let previewRoll = 0;

const built = rareTunerSpec({
  id: 'herosoccer', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Soccer',
  store: heroSoccerStore,
  defaults: HERO_SOCCER_DEFAULTS,
  ranges: HERO_SOCCER_RANGES,
  globals: GLOBALS,
  levels: SOCCER_LEVELS,
  levelNames: { t1: 'Tier I (the volley)', t2: 'Tier II (the corner kick)', t3: 'Tier III (the breakaway)', t4: 'Tier IV (the bicycle kick)' },
  suffixes: SOCCER_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorBall', 'Ball', 'The football (and its trail).'],
    ['colorPost', 'Posts', 'The goal frame on the target.'],
    ['colorNet', 'Net', 'The net and its ripples.'],
    ['colorFlag', 'Corner flag', 'II: the corner flag.'],
    ['colorDefender', 'Defenders', 'III: the defenders it beats.'],
    ['colorFlash', 'Flash', 'The strike, the header and the impact flashes.'],
    ['colorFire', 'Fire', 'IV: the thunderbolt\'s fire trail.'],
    ['colorBlast', 'Explosion', 'IV: the fireball and embers in the goal.'],
    ['colorConfettiA', 'Confetti A', 'One of the confetti colours.'],
    ['colorConfettiB', 'Confetti B', 'Another confetti colour.'],
    ['colorPlayer', 'Your side', 'Your glow, rings and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their glow, rings and total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: whistle': 'sfxWhistleClip', 'Sound: kick': 'sfxKickClip', 'Sound: touch': 'sfxTouchClip', 'Sound: whoosh': 'sfxWhooshClip',
    'Sound: net': 'sfxNetClip', 'Sound: post': 'sfxPostClip', 'Sound: boom': 'sfxBoomClip', 'Sound: crowd ooh': 'sfxOohClip', 'Sound: crowd roar': 'sfxRoarClip', 'Sound: commentator': 'sfxGolazoClip',
  },
  note: () => {
    const c = getHeroSoccerConfig();
    const p = soccerPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  // A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay rolls the same).
  play: (o) => playHeroSoccer({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) }),
  verb: 'shoots at',
  smallHint: 'the volley, keepy-uppies and a volley into the goal.',
  bigHint: 'the breakaway.',
  tierHints: [
    'the volley, keepy-uppies where it stands, a hop and a volley into the goal.',
    'the corner kick, a jog to the corner flag and one of three corners (the Olimpico straight in, a cross and a header, or a short corner one-two).',
    'the breakaway, a dribble up the pitch past defenders (stepovers, a nutmeg or a rainbow flick) and a slow-mo finish.',
    'the bicycle kick, a flick sky high, a sprint to the spot, a backward flip and a slow-mo kick upside down, a thunderbolt into the net, and a knee slide.',
  ],
});

// THE VARIATION override (DEV): Random (rolled per blow) or force one, placed right under the Attack style row.
built.spec.controls.splice(1, 0, {
  key: 'variation', label: 'Variation', kind: 'select', options: ['', '1', '2', '3'], group: 'Style', min: 0, max: 0, step: 0,
  optionLabels: {
    '': 'Random (rolled per fight)',
    1: `1: ${CORNER_KINDS[1]} (II), ${BREAKAWAY_SKILLS[1]} (III)`,
    2: `2: ${CORNER_KINDS[2]} (II), ${BREAKAWAY_SKILLS[2]} (III)`,
    3: `3: ${CORNER_KINDS[3]} (II), ${BREAKAWAY_SKILLS[3]} (III)`,
  },
  hint: 'Tier II rolls a corner and Tier III a skill. Random = what real fights do (the same fight always rolls the same).',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroSoccer?: unknown }).__heroSoccer = { demo: built.demo };
}

export function HeroSoccerTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
