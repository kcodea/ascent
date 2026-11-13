import {
  WRESTLE_LEVELS, WRESTLE_TIER_SUFFIXES, WRESTLE_VARIANT_NAMES, HERO_WRESTLE_DEFAULTS, HERO_WRESTLE_RANGES, wrestlePlan, getHeroWrestleConfig,
  heroWrestleStore, type WrestleTierSuffix,
} from './heroWrestle/heroWrestleConfig';
import { playHeroWrestle } from './heroWrestle/heroWrestle';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the WRESTLING hero attack ("Top Rope", a Legendary, in progress: no cosmetic yet). The two portraits
 * wrestle each other, as a comedy act: four groups of per-tier dials (Tier 1 the chop or the chair shot, Tier 2 the
 * airplane spin slam or the suplex, Tier 3 the turnbuckle taunt and the elbow drop or the splash, Tier 4 the ring and the
 * clothesline or the jumping cutter, then the pin), each move's own timings, the camera, the colours and one clip /
 * gain / pitch row per sound cue. The Variation row forces a variant; the Play buttons run the real runner between the
 * two real portraits.
 */
const T = (n: number): string => `Tier ${n}`;
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Shared damage tier 2 (6): the airplane spin slam or the suplex.', 'Damage tiers'],
  tier3At: ['Tier 3 from', undefined, 'Shared damage tier 3 (12): the turnbuckle, then the elbow drop or the splash.', 'Damage tiers'],
  tier4At: ['Tier 4 from', undefined, 'Shared damage tier 4 (20): the ring, the clothesline or the jumping cutter, and the pin (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  gap: ['Stand apart', '×', 'How close the two stand when they lock up (1 = just touching).', 'Ready'],
  chopWindMs: ['Wind-up', 'ms', `${T(1)} chop: the striker leaning way back, its arm drawn back (the camera pushes in).`, `${T(1)}: the chop and the chair`],
  chopMs: ['Chop', 'ms', `${T(1)}: the arm (or the chair) coming through to the hit.`, `${T(1)}: the chop and the chair`],
  chopLean: ['Lean', '°', `${T(1)}: how far the striker leans back on the wind-up.`, `${T(1)}: the chop and the chair`],
  stagger: ['Stagger', '×', `${T(1)} chop: how far the struck portrait is knocked (its own radii).`, `${T(1)}: the chop and the chair`],
  chopSpins: ['Spins', undefined, `${T(1)} chop: how many times the struck portrait spins round like a top.`, `${T(1)}: the chop and the chair`],
  chairRiseMs: ['Chair up', 'ms', `${T(1)} chair: the chair coming up from under the ring.`, `${T(1)}: the chop and the chair`],
  chairWindMs: ['Chair overhead', 'ms', `${T(1)} chair: raised high overhead before it comes down.`, `${T(1)}: the chop and the chair`],
  chairSize: ['Chair size', '×', `${T(1)} chair: the size of the neon chair.`, `${T(1)}: the chop and the chair`],
  dipMs: ['Dip', 'ms', `${T(2)}: the striker dipping under the struck portrait.`, `${T(2)}: the slam and the suplex`],
  liftMs: ['Lift', 'ms', `${T(2)}: hoisting it overhead (upside down, for the suplex).`, `${T(2)}: the slam and the suplex`],
  hangMs: ['Held beat', 'ms', `${T(2)}: the beat at the top (the airplane spin, or the suplex held upside down).`, `${T(2)}: the slam and the suplex`],
  slamMs: ['Slam', 'ms', `${T(2)}: the drop to the mat (the suplex topples over in 1.6 times this).`, `${T(2)}: the slam and the suplex`],
  liftHeight: ['Lift height', '×', `${T(2)}: how high it is held (the two radii added).`, `${T(2)}: the slam and the suplex`],
  bounceMs: ['Bounce', 'ms', `${T(2)}: the first bounce off the mat (a smaller second one follows).`, `${T(2)}: the slam and the suplex`],
  bounce: ['Bounce height', '×', `${T(2)}: how high it bounces (its own radii).`, `${T(2)}: the slam and the suplex`],
  spinTurns: ['Spin turns', undefined, `${T(2)} slam: how many times the airplane spin goes round.`, `${T(2)}: the slam and the suplex`],
  shoveMs: ['Shove', 'ms', `${T(3)}: the shove that leaves the struck portrait flat on its back.`, `${T(3)}: the turnbuckle`],
  climbMs: ['Climb', 'ms', `${T(3)}: a hop to the turnbuckle and three hops up it.`, `${T(3)}: the turnbuckle`],
  perchMs: ['Taunt', 'ms', `${T(3)}: the taunt up top (the spotlight, the crowd's flashes).`, `${T(3)}: the turnbuckle`],
  diveMs: ['Leap', 'ms', `${T(3)}: the leap off the top onto the mat.`, `${T(3)}: the turnbuckle`],
  leapHeight: ['Leap height', '×', `${T(3)}: how high the leap goes above the perch (the striker's radii).`, `${T(3)}: the turnbuckle`],
  spot: ['Spotlight', '×', `${T(3)}: how bright the spotlight is (0 = none).`, `${T(3)}: the turnbuckle`],
  ringWidth: ['Ring width', '×', `${T(4)}: half the ring of light, in portrait radii (it is narrowed to fit the screen).`, `${T(4)}: the ring`],
  ropeSize: ['Rope size', '×', `${T(4)}: how thick the ropes of light are.`, `${T(4)}: the ring`],
  grabMs: ['Lock-up', 'ms', `${T(4)} clothesline: the striker taking hold before the whip.`, `${T(4)}: the clothesline`],
  whipMs: ['Whip', 'ms', `${T(4)} clothesline: the run across the ring to the far ropes.`, `${T(4)}: the clothesline`],
  stretchMs: ['On the ropes', 'ms', `${T(4)} clothesline: the ropes stretching out and flinging it back.`, `${T(4)}: the clothesline`],
  stretch: ['Rope stretch', '×', `${T(4)}: how far the ropes stretch (the struck portrait's radii).`, `${T(4)}: the clothesline`],
  reboundMs: ['Rebound', 'ms', `${T(4)} clothesline: the run back into the clothesline (THE impact).`, `${T(4)}: the clothesline`],
  flipMs: ['Flip', 'ms', `${T(4)} clothesline: the flip through the air to the mat.`, `${T(4)}: the clothesline`],
  flipTurns: ['Flip turns', undefined, `${T(4)} clothesline: how many whole turns it makes before it lands flat.`, `${T(4)}: the clothesline`],
  exitMs: ['Run off', 'ms', `${T(4)} cutter: the striker running off the screen after the shove.`, `${T(4)}: the jumping cutter`],
  dazeMs: ['Dazed', 'ms', `${T(4)} cutter: the struck portrait staggering about, dazed, before the leap.`, `${T(4)}: the jumping cutter`],
  voiceLeadMs: ['Voice lead', 'ms', `${T(4)} cutter: the voice starts this long before the leap (its third "watch out" should land on it).`, `${T(4)}: the jumping cutter`],
  leapMs: ['Leap in', 'ms', `${T(4)} cutter: the leap in from off the screen to the catch.`, `${T(4)}: the jumping cutter`],
  cutMs: ['Cut', 'ms', `${T(4)} cutter: the drop to the mat with its head (THE impact).`, `${T(4)}: the jumping cutter`],
  afterMs: ['Aftermath', 'ms', `${T(4)}: the beat over the body after it lands, before the leap for the cover.`, `${T(4)}: the pin`],
  coverMs: ['Cover', 'ms', `${T(4)}: the striker dropping on top for the pin.`, `${T(4)}: the pin`],
  countMs: ['Count', 'ms', `${T(4)}: the gap between 1, 2 and 3.`, `${T(4)}: the pin`],
  winMs: ['Winner', 'ms', `${T(4)}: the bell and the winner's beat before both go home.`, `${T(4)}: the pin`],
  wordSize: ['Word size', '×', 'WOO!, BONK!, SLAM!, SPLASH!, WINNER! and the count\'s 1, 2, 3 (0 = no words).', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the portraits squash and stretch on the hits and the landings.', 'Camera and portraits'],
  flash: ['Flash', '×', 'The whole-frame flash on the big hits (0 = none).', 'Camera and portraits'],
  crowdFlashes: ['Crowd flashes', '×', 'How many camera flashes the crowd pops on the big moments (0 = none).', 'Camera and portraits'],
  pan: ['Pan', '×', 'How far the camera pans to centre the action (0 = it only zooms in where it stands).', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'Unused since the third pass (the framing settles as both go home).', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The walk in, the arm, the lift, the airplane spin, the climb, the leaps, the whip.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxChopGain: ['chop: gain', undefined, `${T(1)}: the chop (THE impact). ${T(4)}: the clothesline and the cutter. A layer of the elbow and the count.`, 'Sound: chop'],
  sfxChopRate: ['chop: pitch', '×', 'Pitch of the chop.', 'Sound: chop'],
  sfxSlamGain: ['slam: gain', undefined, 'The canvas slap of a body on the mat (every landing).', 'Sound: mat slam'],
  sfxSlamRate: ['slam: pitch', '×', 'Pitch of the slam.', 'Sound: mat slam'],
  sfxBoomGain: ['boom: gain', undefined, 'A low layer under the slams, the elbow, the clothesline and the cutter.', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxBellGain: ['bell: gain', undefined, `${T(4)}: the bell as the ring stands up, and after the three count.`, 'Sound: bell'],
  sfxBellRate: ['bell: pitch', '×', 'Pitch of the bell.', 'Sound: bell'],
  sfxWooGain: ['crowd: gain', undefined, 'The crowd\'s "woo" (the chop, the spin, the taunt, the leap, the count).', 'Sound: crowd woo'],
  sfxWooRate: ['crowd: pitch', '×', 'Pitch of the crowd.', 'Sound: crowd woo'],
  sfxCheerGain: ['cheer: gain', undefined, 'The crowd cheering after the hits and through the count.', 'Sound: cheer'],
  sfxCheerRate: ['cheer: pitch', '×', 'Pitch of the cheer.', 'Sound: cheer'],
  sfxThudGain: ['thud: gain', undefined, 'The deep hollow thump of the ring under every body that lands (and each hop up the turnbuckle).', 'Sound: ring thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: ring thud'],
  sfxRopeGain: ['ropes: gain', undefined, `${T(4)}: the ropes creaking taut, stretching and snapping back.`, 'Sound: ropes'],
  sfxRopeRate: ['ropes: pitch', '×', 'Pitch of the ropes.', 'Sound: ropes'],
  sfxSlapGain: ['mat slap: gain', undefined, `${T(4)}: the slap of the mat on each count. ${T(3)}: the spotlight snapping on (pitched up).`, 'Sound: mat slap'],
  sfxSlapRate: ['mat slap: pitch', '×', 'Pitch of the mat slap.', 'Sound: mat slap'],
  sfxRoarGain: ['roar: gain', undefined, `The crowd erupting: the taunt, the ${T(3)} landing, the cutter and the bell.`, 'Sound: crowd roar'],
  sfxRoarRate: ['roar: pitch', '×', 'Pitch of the roar.', 'Sound: crowd roar'],
  sfxOohGain: ['ooh: gain', undefined, 'The crowd drawing breath through a held beat (the wind-up, the chair, the lift, the ropes, the run off).', 'Sound: crowd ooh'],
  sfxOohRate: ['ooh: pitch', '×', 'Pitch of the ooh.', 'Sound: crowd ooh'],
  sfxVoiceGain: ['voice: gain', undefined, `${T(4)} cutter: "Watch out! Watch out! Watch out!"`, 'Sound: voice'],
  sfxVoiceRate: ['voice: pitch', '×', 'Pitch (and speed) of the voice.', 'Sound: voice'],
  sfxChairGain: ['chair: gain', undefined, `${T(1)} chair: the steel crash of the chair shot (and a clank as it comes up).`, 'Sound: chair'],
  sfxChairRate: ['chair: pitch', '×', 'Pitch of the chair.', 'Sound: chair'],
  sfxBigGain: ['big slam: gain', undefined, 'The deep slam with its sub under every HEAVY landing (the slams, the elbow, the splash, the cutter).', 'Sound: big slam'],
  sfxBigRate: ['big slam: pitch', '×', 'Pitch of the big slam.', 'Sound: big slam'],
  sfxFlashGain: ['flashes: gain', undefined, 'The crowd\'s camera flashes popping.', 'Sound: camera flashes'],
  sfxFlashRate: ['flashes: pitch', '×', 'Pitch of the flashes.', 'Sound: camera flashes'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<WrestleTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the striker sets off.'],
  WalkMs: ['Walk in', 'ms', 'The striker strutting up beside the struck portrait.'],
  HoldMs: ['Hold', 'ms', `After the impact before both head home. ${T(4)}: unused (the pin and the count run instead).`],
  ReturnMs: ['Return', 'ms', 'Both portraits getting up and going home.'],
  Knock: ['Knockback', '×', `${T(1)}: how hard the chop knocks the struck portrait. Tiers 2 to 4: unused.`],
  Zoom: ['Push in', '×', 'How far the camera zooms in on the big beats (the wind-up, the held beats, the taunt, the dazed stagger).'],
  Punch: ['Impact punch', '×', 'Extra push on the impact (and a little on every jolt).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (the landings, hops and the count shake a fraction of it).'],
  Burst: ['Burst', '×', 'The size of the impact (flash, stars, the dust ring, the word).'],
  Rings: ['Shockwaves', undefined, 'Rings off the impact (Tiers 2 to 4: flat rings of dust along the mat).'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

let previewRoll = 0;

const built = rareTunerSpec({
  id: 'herowrestle', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Top Rope (wrestling)',
  store: heroWrestleStore,
  defaults: HERO_WRESTLE_DEFAULTS,
  ranges: HERO_WRESTLE_RANGES,
  globals: GLOBALS,
  levels: WRESTLE_LEVELS,
  levelNames: {
    t1: 'Tier 1 (the chop or the chair)', t2: 'Tier 2 (the airplane spin slam or the suplex)', t3: 'Tier 3 (the elbow drop or the splash)', t4: 'Tier 4 (the clothesline or the jumping cutter)',
  },
  suffixes: WRESTLE_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorMat', 'Mat dust', 'The canvas dust off the mat.'],
    ['colorFlash', 'Flash', 'The impact flashes and sparks.'],
    ['colorPow', 'Pow', 'The stars (and the dizzy stars), the count\'s flash and the bell\'s rings.'],
    ['colorHand', 'Hand print', `${T(1)}: the hand print the chop leaves.`],
    ['colorSpot', 'Spotlight', `${T(3)}: the spotlight.`],
    ['colorPlayer', 'Your side', 'Your glow, rings and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their glow, rings and total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: whoosh': 'sfxWhooshClip', 'Sound: chop': 'sfxChopClip', 'Sound: mat slam': 'sfxSlamClip', 'Sound: boom': 'sfxBoomClip',
    'Sound: bell': 'sfxBellClip', 'Sound: crowd woo': 'sfxWooClip', 'Sound: cheer': 'sfxCheerClip', 'Sound: ring thud': 'sfxThudClip', 'Sound: ropes': 'sfxRopeClip',
    'Sound: mat slap': 'sfxSlapClip', 'Sound: crowd roar': 'sfxRoarClip', 'Sound: crowd ooh': 'sfxOohClip', 'Sound: voice': 'sfxVoiceClip', 'Sound: chair': 'sfxChairClip',
    'Sound: big slam': 'sfxBigClip', 'Sound: camera flashes': 'sfxFlashClip',
  },
  note: () => {
    const c = getHeroWrestleConfig();
    const p = wrestlePlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, variant: c.variation === '2' ? 2 : 1 }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  // A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay rolls the same).
  play: (o) => playHeroWrestle({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) }),
  verb: 'wrestles',
  smallHint: 'the chop or the chair shot.',
  bigHint: 'the elbow drop or the splash.',
  tierHints: [
    'the chop (a huge wind-up, a hand print, it spins like a top) or the chair shot (a neon chair over the head, BONK).',
    'the airplane spin slam (lifted, spun round and round, slammed) or the suplex (held upside down, then over backward).',
    'the turnbuckle: a shove flat, a hop to the turnbuckle and three up it, a taunt with the crowd\'s flashes, then the elbow drop or the splash.',
    'the ring and the bell, then the clothesline (whip, ropes, flip) or the jumping cutter ("Watch out!"), the pin, 1, 2, 3 and WINNER.',
  ],
});

// THE VARIATION override (DEV): Random (rolled per blow) or force one, placed right under the Attack style row.
built.spec.controls.splice(1, 0, {
  key: 'variation', label: 'Variation', kind: 'select', options: ['', '1', '2'], group: 'Style', min: 0, max: 0, step: 0,
  optionLabels: {
    '': 'Random (rolled per fight)',
    1: `1: ${WRESTLE_VARIANT_NAMES[1].join(', ')}`,
    2: `2: ${WRESTLE_VARIANT_NAMES[2].join(', ')}`,
  },
  hint: 'Each tier rolls one of two moves (Tier 1 to Tier 4, in order). Random = what real fights do (the same fight always rolls the same).',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroWrestle?: unknown }).__heroWrestle = { demo: built.demo };
}

export function HeroWrestleTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
