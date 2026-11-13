import {
  HERO_TRAIN_DEFAULTS, HERO_TRAIN_RANGES, TRAIN_LEVELS, TRAIN_TIER_SUFFIXES, getHeroTrainConfig, heroTrainStore, trainPlan,
  type TrainTierSuffix,
} from './heroTrain/heroTrainConfig';
import { playHeroTrain } from './heroTrain/heroTrain';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the TRAIN hero attack ("Right on Schedule", a Legendary; DEV-ONLY, no cosmetic yet): a length of rail
 * track fades in under the struck portrait and a vehicle crosses the whole screen through it, from the striker's side.
 * Four groups of per-tier dials (I the handcar, II the mine cart, III the steam engine, IV the freight express with its
 * crossing signal), the track and the vehicles, the signal, the portrait's reactions, the colours and one clip / gain /
 * pitch row per sound cue. The Play buttons run the real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the mine cart.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the steam engine.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the freight express (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  trackFadeMs: ['Track fade', 'ms', 'The track fading in under the struck portrait, and out at the end.', 'Track and vehicles'],
  railDrop: ['Track height', '×', 'How far below the struck portrait\'s centre the track runs (portrait radii).', 'Track and vehicles'],
  trackSize: ['Track size', '×', 'How tall the track is drawn (portrait radii).', 'Track and vehicles'],
  vehicleSize: ['Vehicle size', '×', 'Every vehicle, scaled.', 'Track and vehicles'],
  handleSwing: ['Handle rock', undefined, 'I: how far the handcar\'s see-saw handle rocks as it rolls.', 'Track and vehicles'],
  bounce: ['Cart bounce', '×', 'II: how high the mine cart hops off the rails (portrait radii).', 'Track and vehicles'],
  cars: ['Freight cars', undefined, 'IV: how many cars follow the engine and its tender (the caboose comes after them).', 'Track and vehicles'],
  puffMs: ['Steam gap', 'ms', 'III and IV: how often the funnel puffs.', 'Track and vehicles'],
  windMs: ['Wind gap', 'ms', 'IV: how often a wind streak whips along the train.', 'Track and vehicles'],
  signalSize: ['Signal height', '×', 'IV: the crossing signal\'s height (portrait radii; trimmed to stay on screen).', 'Crossing signal (IV)'],
  signalOffset: ['Signal distance', '×', 'IV: how far along the track from the portrait the signal stands (portrait radii).', 'Crossing signal (IV)'],
  lampMs: ['Lamp beat', 'ms', 'IV: how long each red lamp is lit before the other takes over.', 'Crossing signal (IV)'],
  bellEveryMs: ['Bell every', 'ms', 'IV: how often the bell clip (three dings) is rung again.', 'Crossing signal (IV)'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked (each tier scales it).', 'Camera and portraits'],
  flatten: ['Flatten', '×', 'III: how flat the engine presses the portrait (0.8 = a fifth of its height).', 'Camera and portraits'],
  liftSize: ['Throw height', '×', 'IV: how far up the portrait is thrown while the train passes (portrait radii; trimmed to stay on screen).', 'Camera and portraits'],
  spinTurns: ['Spins', undefined, 'IV: how many whole turns the portrait spins above the train.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the vehicle has passed.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxBellGain: ['bell: gain', undefined, 'IV: the crossing bell.', 'Sound: bell'],
  sfxBellRate: ['bell: pitch', '×', 'Pitch of the bell.', 'Sound: bell'],
  sfxWhistleGain: ['whistle: gain', undefined, 'III: the steam whistle before the engine.', 'Sound: whistle'],
  sfxWhistleRate: ['whistle: pitch', '×', 'Pitch of the whistle.', 'Sound: whistle'],
  sfxHornGain: ['horn: gain', undefined, 'IV: the horn off screen as the headlight grows.', 'Sound: horn'],
  sfxHornRate: ['horn: pitch', '×', 'Pitch of the horn.', 'Sound: horn'],
  sfxPassGain: ['pass: gain', undefined, 'III and IV: the roar of the train rushing by.', 'Sound: pass'],
  sfxPassRate: ['pass: pitch', '×', 'Pitch of the roar.', 'Sound: pass'],
  sfxClatterGain: ['clatter: gain', undefined, 'Wheels over a rail joint: the cart, the hit, and each freight car.', 'Sound: clatter'],
  sfxClatterRate: ['clatter: pitch', '×', 'Pitch of the clatter.', 'Sound: clatter'],
  sfxSqueakGain: ['squeak: gain', undefined, 'I: the handcar\'s pump squeaking.', 'Sound: squeak'],
  sfxSqueakRate: ['squeak: pitch', '×', 'Pitch of the squeak.', 'Sound: squeak'],
  sfxBoomGain: ['boom: gain', undefined, 'The hit itself (a small thud on I, heavy on IV).', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The gate arm, and the air after the tail has passed.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<TrainTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'Before the vehicle may appear: the track fading in (III: the whistle; IV: the signal, the bell, the gate and the horn).'],
  ApproachMs: ['Approach', 'ms', 'The longest the vehicle is on screen before it reaches the portrait (a far portrait makes it go faster).'],
  PassMs: ['Pass', 'ms', 'How long the vehicle takes to pass the portrait (IV: the whole train, engine to caboose).'],
  ExitMs: ['Exit', 'ms', 'After the tail has passed the portrait, how long it has to leave the screen (it speeds up if it must).'],
  HoldMs: ['Hold', 'ms', 'After the tail has gone, while the portrait settles and the track fades.'],
  Zoom: ['Push in', '×', 'How far the view pushes in on the struck portrait.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes along the track on the impact (III and IV rumble while the train passes).'],
  Knock: ['Knock', '×', 'How hard this vehicle knocks the portrait (a multiple of the knockback).'],
  Burst: ['Burst', '×', 'The size of the hit (flash, ring, steam, sparks).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herotrain', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Right on Schedule (train)',
  store: heroTrainStore,
  defaults: HERO_TRAIN_DEFAULTS,
  ranges: HERO_TRAIN_RANGES,
  globals: GLOBALS,
  levels: TRAIN_LEVELS,
  levelNames: { t1: 'Tier I (the handcar)', t2: 'Tier II (the mine cart)', t3: 'Tier III (the steam engine)', t4: 'Tier IV (the freight express)' },
  suffixes: TRAIN_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorSteam', 'Steam', 'The funnel\'s puffs and the burst of steam on the hit.'],
    ['colorOre', 'Ore', 'II: the glowing chunks the mine cart spills.'],
    ['colorLamp', 'Signal lamps', 'IV: the crossing signal\'s two alternating lamps.'],
    ['colorHeadlight', 'Headlight', 'IV: the glow growing at the edge of the screen.'],
    ['colorSpark', 'Sparks', 'Sparks off the rails.'],
    ['colorStar', 'Bonk star', 'I: the star that spins off the bump.'],
    ['colorFlash', 'Flash', 'The flash on the hit.'],
    ['colorPlayer', 'Your side', 'Your ring, glow and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their ring, glow and total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: bell': 'sfxBellClip', 'Sound: whistle': 'sfxWhistleClip', 'Sound: horn': 'sfxHornClip', 'Sound: pass': 'sfxPassClip',
    'Sound: clatter': 'sfxClatterClip', 'Sound: squeak': 'sfxSqueakClip', 'Sound: boom': 'sfxBoomClip', 'Sound: whoosh': 'sfxWhooshClip',
  },
  note: () => {
    const c = getHeroTrainConfig();
    const p = trainPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroTrain(o),
  verb: 'sends a train through',
  smallHint: 'the handcar, a pump trolley that bonks the portrait.',
  bigHint: 'the steam engine.',
  tierHints: [
    'the handcar, a little pump trolley that trundles across and bonks the portrait.',
    'the mine cart, a rattling ore cart that knocks the portrait and spills glowing ore.',
    'the steam engine, a whistle and a locomotive at speed that flattens the portrait for a beat.',
    'the freight express, a crossing signal, a bell, a gate and a horn, then a long train streaking through with the portrait spinning above it.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroTrain?: unknown }).__heroTrain = { demo: built.demo };
}

export function HeroTrainTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
