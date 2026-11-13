import {
  BASEBALL_LEVELS, BASEBALL_TIER_SUFFIXES, HERO_BASEBALL_DEFAULTS, HERO_BASEBALL_RANGES, HOT_SHOTS, baseballPlan, getHeroBaseballConfig,
  heroBaseballStore, type BaseballTierSuffix,
} from './heroBaseball/heroBaseballConfig';
import { playHeroBaseball } from './heroBaseball/heroBaseball';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the BASEBALL hero attack (the Charge the Mound cosmetic, a Legendary; owner ask 2026-11-02: "have the
 * opponent be the pitcher and the batter be the player dealing dmg. the final lvl 4/knockout should be the player getting
 * struck by the ball and charging the mound and beating up the opponent"). Four groups of per-tier dials (Tier 1 up the
 * middle, Tier 2 the hot shot, Tier 3 the moonshot, Tier 4 charge the mound), the plays' geometry, the slow mo, the colours and one
 * clip / gain / pitch row per sound cue. The Play buttons run the real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Shared damage tier 2 (6): the hot shot.', 'Damage tiers'],
  tier3At: ['Tier 3 from', undefined, 'Shared damage tier 3 (12): the moonshot.', 'Damage tiers'],
  tier4At: ['Tier 4 from', undefined, 'Shared damage tier 4 (20): charge the mound (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  ballSize: ['Ball size', '×', 'The baseball\'s diameter, in striker radii.', 'Ball and bat'],
  batSize: ['Bat size', '×', 'The bat\'s length (1 = about one and a half portrait radii).', 'Ball and bat'],
  spin: ['Spin', undefined, 'How fast the ball spins in flight (turns per second).', 'Ball and bat'],
  trailMs: ['Trail gap', 'ms', 'How often a soft glow of the ball is left behind in flight (lower = denser).', 'Ball and bat'],
  shadowDrop: ['Shadow drop', '×', 'How far the ball\'s shadow sits below it.', 'Ball and bat'],
  windupBack: ['Windup rock', '×', 'How far the pitcher rocks back on the windup (pitcher radii).', 'The pitcher'],
  windupLean: ['Windup lean', '°', 'How far the pitcher leans back on the windup.', 'The pitcher'],
  lunge: ['Lunge', '×', 'How far the pitcher lunges forward on the release.', 'The pitcher'],
  stride: ['Stride', '×', 'How far the batter steps into the swing (bigger on Tiers 2 and 3).', 'The batter'],
  swingLean: ['Swing lean', '°', 'How far the batter loads back and turns through the swing.', 'The batter'],
  linerSpin: ['Liner spin', undefined, 'Tier 2 (the liner): how many turns the pitcher spins when it is hit.', 'Tier 2: the hot shot'],
  hopAt: ['Hop spot', '×', 'Tier 2 (the grounder): how far along to the pitcher the ball hops.', 'Tier 2: the hot shot'],
  hopHeight: ['Hop height', '×', 'Tier 2 (the grounder): how high the hop bounces up (striker radii).', 'Tier 2: the hot shot'],
  foulWide: ['Foul loop', '×', 'Tier 2 (the foul tip): how wide the boomerang loops round the field.', 'Tier 2: the hot shot'],
  foulMs: ['Foul flight', 'ms', 'Tier 2 (the foul tip): the whole loop, back into the pitcher from behind.', 'Tier 2: the hot shot'],
  moonUpMs: ['Moonshot up', 'ms', 'Tier 3: the ball rocketing up off the top of the screen.', 'Tier 3: the moonshot'],
  moonHangMs: ['Moonshot hang', 'ms', 'Tier 3: the ball gone (the twinkle, the pitcher panicking, the shadow growing).', 'Tier 3: the moonshot'],
  moonDownMs: ['Moonshot down', 'ms', 'Tier 3: the ball coming down from the sky onto the pitcher.', 'Tier 3: the moonshot'],
  moonSize: ['Moonshot size', '×', 'Tier 3: how big the ball looks as it lands (it grows as it falls).', 'Tier 3: the moonshot'],
  panic: ['Panic', '×', 'Tier 3: how far the pitcher shuffles side to side as the shadow grows.', 'Tier 3: the moonshot'],
  batFlipMs: ['Bat flip', 'ms', 'Tier 3: the bat flip, tossed up to its landing beside the batter.', 'Tier 3: the moonshot'],
  batFlipHeight: ['Bat flip height', '×', 'Tier 3: how high the bat is flipped (striker radii).', 'Tier 3: the moonshot'],
  batFlipTurns: ['Bat flip turns', undefined, 'Tier 3: how many turns the bat spins.', 'Tier 3: the moonshot'],
  staggerMs: ['Stagger', 'ms', 'Tier 4: the batter reeling from the bean.', 'Tier 4: charge the mound'],
  staggerWobble: ['Stagger wobble', '°', 'Tier 4: how hard the batter wobbles from the bean.', 'Tier 4: charge the mound'],
  batSlamMs: ['Bat slam', 'ms', 'Tier 4: the bat thrown down to the dirt.', 'Tier 4: charge the mound'],
  fumeMs: ['Fume', 'ms', 'Tier 4: the batter fuming (steam) before it charges.', 'Tier 4: charge the mound'],
  chargeMs: ['Charge', 'ms', 'Tier 4: the dash at the mound.', 'Tier 4: charge the mound'],
  brawlMs: ['Brawl', 'ms', 'Tier 4: the dust-cloud brawl (attack time; it runs fast, see Brawl speed).', 'Tier 4: charge the mound'],
  brawlHits: ['Brawl hits', undefined, 'Tier 4: how many comic hits in the brawl (POW, BAM, SMACK). Ticks: no damage.', 'Tier 4: charge the mound'],
  brawlJitter: ['Brawl shake', '×', 'Tier 4: how hard the two portraits shake and pop out of the cloud.', 'Tier 4: charge the mound'],
  brawlCloud: ['Brawl cloud', '×', 'Tier 4: the dust cloud\'s size (0 = none).', 'Tier 4: charge the mound'],
  benchRush: ['Benches clear', '×', 'Tier 4: the streaks rushing in from both edges (0 = none).', 'Tier 4: charge the mound'],
  koWindupMs: ['Haymaker', 'ms', 'Tier 4: the wind-up and the haymaker that ends it.', 'Tier 4: charge the mound'],
  koLaunch: ['KO launch', '×', 'Tier 4: how far the pitcher is sent flying (kept on screen).', 'Tier 4: charge the mound'],
  koSpin: ['KO spin', undefined, 'Tier 4: how many turns the pitcher spins as it flies.', 'Tier 4: charge the mound'],
  contactSlow: ['Tier 3 slow mo', '×', 'Tier 3: how slow the clock gets around the contact (1 = none). A smooth ramp, never a freeze.', 'Slow mo'],
  contactSlowMs: ['Tier 3 slow mo length', 'ms', 'Tier 3: roughly how long (real time) the slow mo lasts.', 'Slow mo'],
  beanSlow: ['Tier 4 slow mo', '×', 'Tier 4: how slow the clock gets as the bean hits the batter (1 = none).', 'Slow mo'],
  beanSlowMs: ['Tier 4 slow mo length', 'ms', 'Tier 4: roughly how long (real time) the bean slow mo lasts.', 'Slow mo'],
  brawlBoost: ['Brawl speed', '×', 'Tier 4: the clock runs this much FASTER through the brawl.', 'Slow mo'],
  slowRampMs: ['Slow mo ease', 'ms', 'How long (attack time) the clock eases into and out of the slow mo.', 'Slow mo'],
  slowZoom: ['Slow mo push', '×', 'A subtle extra push in on the view during the slow mo.', 'Slow mo'],
  wordSize: ['Word size', '×', 'CRACK!, BONK!, HOME RUN!, POW!, BAM!, SMACK!, YER OUT! (0 = no words).', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the portraits squash (hits, the crater, the KO).', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxGloveGain: ['glove: gain', undefined, 'The ball popped into the pitcher\'s mitt as it starts (and the twinkle).', 'Sound: glove'],
  sfxGloveRate: ['glove: pitch', '×', 'Pitch of the glove pop.', 'Sound: glove'],
  sfxPitchGain: ['whoosh: gain', undefined, 'The pitch, the swing, the bat thrown, the charge and the haymaker.', 'Sound: whoosh'],
  sfxPitchRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxCrackGain: ['crack: gain', undefined, 'The bat meeting the ball (and the bat clattering down, pitched low).', 'Sound: bat crack'],
  sfxCrackRate: ['crack: pitch', '×', 'Pitch of the crack.', 'Sound: bat crack'],
  sfxBonkGain: ['bonk: gain', undefined, 'The ball bonking the pitcher (THE impact on Tiers 1 and 2), the bean on the batter, the haymaker.', 'Sound: bonk'],
  sfxBonkRate: ['bonk: pitch', '×', 'Pitch of the bonk.', 'Sound: bonk'],
  sfxHopGain: ['hop: gain', undefined, 'Tier 2 (the grounder): the hop in the dirt.', 'Sound: hop'],
  sfxHopRate: ['hop: pitch', '×', 'Pitch of the hop.', 'Sound: hop'],
  sfxFallGain: ['slide whistle: gain', undefined, 'Tier 3: the falling slide whistle as the moonshot comes down.', 'Sound: slide whistle'],
  sfxFallRate: ['slide whistle: pitch', '×', 'Pitch of the slide whistle.', 'Sound: slide whistle'],
  sfxChargeGain: ['organ: gain', undefined, 'Tier 4: the ballpark organ\'s "Charge!" as the batter charges the mound.', 'Sound: organ'],
  sfxChargeRate: ['organ: pitch', '×', 'Pitch of the organ.', 'Sound: organ'],
  sfxThumpGain: ['thump: gain', undefined, 'Tier 4: the collision and every brawl hit.', 'Sound: brawl thump'],
  sfxThumpRate: ['thump: pitch', '×', 'Pitch of the thumps (each hit varies it a little).', 'Sound: brawl thump'],
  sfxBrawlGain: ['brawl: gain', undefined, 'Tier 4: the cartoon fight flurry under the dust cloud (once, on the collision).', 'Sound: brawl'],
  sfxBrawlRate: ['brawl: pitch', '×', 'Pitch of the brawl.', 'Sound: brawl'],
  sfxKoGain: ['ko: gain', undefined, 'Tier 3: the crater; Tier 4: the haymaker (THE impact).', 'Sound: ko'],
  sfxKoRate: ['ko: pitch', '×', 'Pitch of the ko.', 'Sound: ko'],
  sfxUmpGain: ['umpire: gain', undefined, 'Tier 4: the umpire\'s "You\'re out!" on the haymaker.', 'Sound: umpire'],
  sfxUmpRate: ['umpire: pitch', '×', 'Pitch of the umpire.', 'Sound: umpire'],
  sfxOohGain: ['ooh: gain', undefined, 'The crowd going "ooh": the hot shot, the moonshot, the bean, the brawl.', 'Sound: crowd ooh'],
  sfxOohRate: ['ooh: pitch', '×', 'Pitch of the crowd.', 'Sound: crowd ooh'],
  sfxCheerGain: ['cheer: gain', undefined, 'Tiers 3 and 4: the crowd erupting (the brawl, the home run, the KO).', 'Sound: cheer'],
  sfxCheerRate: ['cheer: pitch', '×', 'Pitch of the cheer.', 'Sound: cheer'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<BaseballTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'A beat before the pitcher winds up.'],
  WindupMs: ['Windup', 'ms', 'The pitcher\'s windup, to the release.'],
  PitchMs: ['Pitch', 'ms', 'The pitch\'s flight to the plate (Tier 4: to the batter\'s face). Lower = faster.'],
  SwingMs: ['Swing', 'ms', 'Tiers 1-3: the swing around the contact. Tier 4: unused.'],
  FlightMs: ['Hit flight', 'ms', 'Tier 1: the liner back to the pitcher. Tier 2: the liner / grounder (the foul tip has its own). Tiers 3 and 4: unused.'],
  HoldMs: ['Hold', 'ms', 'After the impact before the batter heads home.'],
  ReturnMs: ['Return', 'ms', 'The batter settling home (Tier 4: the hop back from the mound).'],
  Knock: ['Knockback', '×', 'How far the pitcher is knocked on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in on the pitcher.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact (Tiers 3 and 4 rumble).'],
  Burst: ['Burst', '×', 'The size of the impact (flash, stars, sparks, the word).'],
  Rings: ['Shockwaves', undefined, 'Rings off the impact.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

let previewRoll = 0;

const built = rareTunerSpec({
  id: 'herobaseball', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Baseball',
  store: heroBaseballStore,
  defaults: HERO_BASEBALL_DEFAULTS,
  ranges: HERO_BASEBALL_RANGES,
  globals: GLOBALS,
  levels: BASEBALL_LEVELS,
  levelNames: { t1: 'Tier 1 (up the middle)', t2: 'Tier 2 (the hot shot)', t3: 'Tier 3 (the moonshot)', t4: 'Tier 4 (charge the mound)' },
  suffixes: BASEBALL_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorBall', 'Ball', 'The baseball (white keeps its painted red stitches).'],
    ['colorBat', 'Bat', 'The bat\'s wood.'],
    ['colorDust', 'Dust', 'The dirt, the brawl cloud and the crater.'],
    ['colorFlash', 'Flash', 'The impact flashes and stars.'],
    ['colorPow', 'Pow', 'The comic bursts, the dizzy stars, HOME RUN! and YER OUT!'],
    ['colorPlayer', 'Your side', 'Your glow, rings and total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their glow, rings and total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: glove': 'sfxGloveClip', 'Sound: whoosh': 'sfxPitchClip', 'Sound: bat crack': 'sfxCrackClip', 'Sound: bonk': 'sfxBonkClip',
    'Sound: hop': 'sfxHopClip', 'Sound: slide whistle': 'sfxFallClip', 'Sound: organ': 'sfxChargeClip', 'Sound: brawl thump': 'sfxThumpClip', 'Sound: brawl': 'sfxBrawlClip',
    'Sound: ko': 'sfxKoClip', 'Sound: umpire': 'sfxUmpClip', 'Sound: crowd ooh': 'sfxOohClip', 'Sound: cheer': 'sfxCheerClip',
  },
  note: () => {
    const c = getHeroBaseballConfig();
    const p = baseballPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage }, c);
    return `dev · tier ${p.tier} · ${p.kind} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  // A fresh roll per preview (a real fight rolls from the run seed and the round, so a replay rolls the same).
  play: (o) => playHeroBaseball({ ...o, rollSeed: o.rollSeed ?? (previewRoll = (previewRoll + 1) % 3000) }),
  verb: 'hits a baseball at',
  smallHint: 'up the middle, a line drive back at the pitcher.',
  bigHint: 'the moonshot.',
  tierHints: [
    'up the middle: the target pitches, a line drive straight back bonks it.',
    'the hot shot: a screaming liner, a one-hop grounder or a foul tip that boomerangs round into its back.',
    'the moonshot: slow-mo contact, a bat flip, the ball off the top of the screen and down onto the pitcher. HOME RUN.',
    'charge the mound: beaned, the batter slams the bat down, charges, brawls in a dust cloud and lands a haymaker. YER OUT!',
  ],
});

// THE VARIATION override (DEV): Random (rolled per blow) or force Tier 2's hit, placed right under the Attack style row.
built.spec.controls.splice(1, 0, {
  key: 'variation', label: 'Variation', kind: 'select', options: ['', '1', '2', '3'], group: 'Style', min: 0, max: 0, step: 0,
  optionLabels: { '': 'Random (rolled per fight)', 1: `1: ${HOT_SHOTS[1]} (Tier 2)`, 2: `2: ${HOT_SHOTS[2]} (Tier 2)`, 3: `3: ${HOT_SHOTS[3]} (Tier 2)` },
  hint: 'Tier 2 rolls one of three hits. Random = what real fights do (the same fight always rolls the same).',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBaseball?: unknown }).__heroBaseball = { demo: built.demo };
}

export function HeroBaseballTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
