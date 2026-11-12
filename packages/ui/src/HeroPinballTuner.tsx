import {
  HERO_PINBALL_DEFAULTS, HERO_PINBALL_RANGES, PINBALL_LEVELS, PINBALL_TIER_SUFFIXES, getHeroPinballConfig, heroPinballStore, pinballPlan,
  type PinballTierSuffix,
} from './heroPinball/heroPinballConfig';
import { playHeroPinball } from './heroPinball/heroPinball';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the PINBALL hero attack ("Multiball", a Legendary, dev-only until it has a cosmetic). Four groups of
 * per-tier dials (I the flipper shot, II the bumpers, III the ramp and multiball, IV the jackpot), the table's
 * geometry, the tilt and the roll-up, the colours and one clip / gain / pitch row per sound cue (flipper, bumper, ramp,
 * score reel, whoosh, boom). The Play buttons run the real runner between the two real portraits; each preview rolls a
 * fresh bounce order.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the bumpers.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the ramp and multiball.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the jackpot (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  ballSize: ['Ball size', '×', 'The steel ball\'s radius, in striker radii.', 'Table'],
  flipperSize: ['Flipper size', '×', 'The flipper bat\'s length (1 = one and a half striker radii).', 'Table'],
  swingMs: ['Flipper swing', 'ms', 'How long the bat takes to snap up (the ball is struck halfway).', 'Table'],
  bumperSize: ['Bumper size', '×', 'A pop bumper\'s radius, in target radii.', 'Table'],
  bumperDist: ['Bumper spread', '×', 'How far the bumpers stand from the target (pulled in when the heroes are close).', 'Table'],
  kickPx: ['Bumper kick', 'px', 'How far a bumper jumps when the ball hits it.', 'Table'],
  scoreSize: ['Score pops', '×', 'The size of the "+10" popping off a bumper (0 = none).', 'Table'],
  rampMs: ['Ramp ride', 'ms', 'III: how long the ball is on the wire ramp (its loop included).', 'The ramp and multiball (III)'],
  rampBow: ['Ramp bow', '×', 'III: how far the ramp bows out from the lane (a fraction of the distance; trimmed to stay on screen).', 'The ramp and multiball (III)'],
  loopSize: ['Loop size', '×', 'III: the radius of the ramp\'s loop, in target radii.', 'The ramp and multiball (III)'],
  splitMs: ['Split', 'ms', 'III: from the three balls parting to the first bumper.', 'The ramp and multiball (III)'],
  cascadeMs: ['Cascade gap', 'ms', 'III: the gap between the three balls (and so between their hits on the target).', 'The ramp and multiball (III)'],
  chaseMs: ['Light chase', 'ms', 'IV: how long the bumpers and the lane arrows chase before the flipper fires.', 'The jackpot (IV)'],
  tiltDeg: ['Tilt', '°', 'IV: how far the play area tilts when the striker shoves it (0 = none).', 'The jackpot (IV)'],
  tiltMs: ['Tilt length', 'ms', 'IV: the tilt, there and back (TILT blinks for as long).', 'The jackpot (IV)'],
  rollMs: ['Roll-up', 'ms', 'IV: how long the jackpot\'s reels spin before the last one stops on the damage.', 'The jackpot (IV)'],
  displaySize: ['Display size', '×', 'The dot-matrix display (MULTIBALL, TILT, JACKPOT and the score).', 'The jackpot (IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked when the ball lands.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxFlipperGain: ['flipper: gain', undefined, 'The flipper\'s clack as it fires.', 'Sound: flipper'],
  sfxFlipperRate: ['flipper: pitch', '×', 'Pitch of the flipper.', 'Sound: flipper'],
  sfxBumperGain: ['bumper: gain', undefined, 'A pop bumper (a thwack and a soft bell): every bounce, the chase, the multiball bell and, lower, the impact.', 'Sound: bumper'],
  sfxBumperRate: ['bumper: pitch', '×', 'Base pitch of the bumper (each bumper plays a little higher than the last).', 'Sound: bumper'],
  sfxRampGain: ['ramp: gain', undefined, 'III: the ball rolling on the wire ramp.', 'Sound: ramp'],
  sfxRampRate: ['ramp: pitch', '×', 'Pitch of the ramp.', 'Sound: ramp'],
  sfxReelGain: ['reel: gain', undefined, 'IV: the score reels rattling as the jackpot rolls up.', 'Sound: score reel'],
  sfxReelRate: ['reel: pitch', '×', 'Pitch of the reels.', 'Sound: score reel'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The table popping up, the launched ball, the multiball split.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxBoomGain: ['boom: gain', undefined, 'The thud under the impact (bigger up the tiers) and under IV\'s shove.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<PinballTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the table pops up.'],
  SetMs: ['Set', 'ms', 'The table standing before the flipper fires (IV: before the lights chase).'],
  FlightMs: ['First flight', 'ms', 'The flipper to the first thing the ball meets (I the target, II and IV a bumper, III the ramp).'],
  Bounces: ['Bounces', undefined, 'II: bumper hits before the drop; III: per ball; IV: before the tilt (it then bounces through the roll-up). Unused on I.'],
  BounceMs: ['Bounce', 'ms', 'The time between two bumpers (each one a little uneven).'],
  DropMs: ['Drop', 'ms', 'The last bumper to the target. Unused on I.'],
  HoldMs: ['Hold', 'ms', 'After the last hit before the table drops away.'],
  OutMs: ['Out', 'ms', 'The table dropping away.'],
  Zoom: ['Push in', '×', 'How far the view pushes in on the target while the ball is in play.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (and, softer, on IV\'s shove).'],
  Burst: ['Burst', '×', 'The size of the impact (flash, rings, starburst).'],
  Rings: ['Rings', undefined, 'Extra rings pulsing off the target\'s lamps.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

let previewRoll = 0;

const built = rareTunerSpec({
  id: 'heropinball', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Multiball (pinball)',
  store: heroPinballStore,
  defaults: HERO_PINBALL_DEFAULTS,
  ranges: HERO_PINBALL_RANGES,
  globals: GLOBALS,
  levels: PINBALL_LEVELS,
  levelNames: { t1: 'Tier I (the flipper shot)', t2: 'Tier II (the bumpers)', t3: 'Tier III (the ramp and multiball)', t4: 'Tier IV (the jackpot)' },
  suffixes: PINBALL_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorFlash', 'Flash', 'The flipper\'s pop and the impact flashes.'],
    ['colorLamp', 'Lamp light', 'The rings off the bumpers and the target\'s lamps, the ramp lighting up, the jackpot\'s flare.'],
    ['colorSpark', 'Steel', 'The ball\'s tail and the sparks it throws.'],
    ['colorPlayer', 'Your side', 'Your glow, rings and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their glow, rings and total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: flipper': 'sfxFlipperClip', 'Sound: bumper': 'sfxBumperClip', 'Sound: ramp': 'sfxRampClip', 'Sound: score reel': 'sfxReelClip',
    'Sound: whoosh': 'sfxWhooshClip', 'Sound: boom': 'sfxBoomClip',
  },
  note: () => {
    const c = getHeroPinballConfig();
    const p = pinballPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  // A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay bounces the same).
  play: (o) => playHeroPinball({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) + 1 }),
  verb: 'fires a steel ball at',
  smallHint: 'the flipper shot, straight into the target.',
  bigHint: 'the ramp and multiball.',
  tierHints: [
    'the flipper shot, the bat thwacks the ball straight into the target.',
    'the bumpers, three pop bumpers rise and the ball rattles between them before it drops on the target.',
    'the ramp and multiball, the ball loops a wire ramp and comes off as three, which cascade through the bumpers onto the target.',
    'the jackpot, the lights chase, the ball goes wild, the table tilts, and the jackpot rolls up to the damage as the ball lands.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroPinball?: unknown }).__heroPinball = { demo: built.demo };
}

export function HeroPinballTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
