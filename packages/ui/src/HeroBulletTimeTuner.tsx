import {
  BULLET_LEVELS, BULLET_TIER_SUFFIXES, HERO_BULLET_DEFAULTS, HERO_BULLET_RANGES, bulletPlan, bulletSlowExtraMs, getHeroBulletTimeConfig,
  heroBulletTimeStore, type BulletTierSuffix,
} from './heroBulletTime/heroBulletTimeConfig';
import { playHeroBulletTime } from './heroBulletTime/heroBulletTime';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the BULLET TIME hero attack (the Ancient of Time; owner 2026-10-02 picked "BULLET TIME": stopped time,
 * the shots hang in the air). Four groups of per-tier dials (I one dart; II a ring of three; III a spiral volley and a
 * snap; IV the dome, the 3-2-1 and the collapse), the darts, stopped time (desaturation, ripple, motes, tremble), the
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
  hangR: ['Hang distance', '×', 'How far short of the target a dart stops (struck radii; II and III sit a little further out).', 'Darts'],
  dartPx: ['Dart size', 'px', 'A dart\'s length (the per-tier size multiplies it).', 'Darts'],
  trailMs: ['Streak length', 'ms', 'How much of its flight a dart\'s streak spans (it hangs with the dart while time is stopped).', 'Darts'],
  trailWidth: ['Streak width', 'px', 'How thick the streak is.', 'Darts'],
  tremblePx: ['Tremble', 'px', 'How much a hung dart trembles (stopped, but never a still frame).', 'Stopped time'],
  turn: ['Turn', undefined, 'How far a hung dart turns back and forth.', 'Stopped time'],
  desat: ['Desaturate', '×', 'How grey everything but the shots goes while time is stopped (0 = off).', 'Stopped time'],
  desatInMs: ['Desaturate in', 'ms', 'The one-shot fade into the grey (the way out is a hard snap).', 'Stopped time'],
  rippleMs: ['Ripple', 'ms', 'How often a gold time ripple pulses off the target while time is stopped.', 'Stopped time'],
  motes: ['Dust motes', undefined, 'Motes drifting through stopped time.', 'Stopped time'],
  clockSize: ['Clock size', '×', 'The clock ticking over the target (IV: the big face behind the dome).', 'Stopped time'],
  impactSize: ['Impact size', '×', 'The impact (IV: the collapse, the biggest in the roster).', 'Impact'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxTickGain: ['tick: gain', undefined, 'The clock: the ready, every tick of stopped time (faster toward the restart), IV\'s 3-2-1.', 'Sound: tick'],
  sfxTickRate: ['tick: pitch', '×', 'Pitch of the tick.', 'Sound: tick'],
  sfxThrowGain: ['throw: gain', undefined, 'A dart leaving the hand (one every few in a volley).', 'Sound: throw'],
  sfxThrowRate: ['throw: pitch', '×', 'Pitch of the throw.', 'Sound: throw'],
  sfxFreezeGain: ['freeze: gain', undefined, 'A dart stopping dead in the air (a glassy tink).', 'Sound: freeze'],
  sfxFreezeRate: ['freeze: pitch', '×', 'Pitch of the freeze.', 'Sound: freeze'],
  sfxStopGain: ['time stops: gain', undefined, 'A low reversed swell as time stops.', 'Sound: time stops'],
  sfxStopRate: ['time stops: pitch', '×', 'Pitch of the swell.', 'Sound: time stops'],
  sfxSnapGain: ['snap: gain', undefined, 'The hero\'s finger snap that restarts time.', 'Sound: snap'],
  sfxSnapRate: ['snap: pitch', '×', 'Pitch of the snap.', 'Sound: snap'],
  sfxRestartGain: ['restart: gain', undefined, 'The whoosh of time starting again.', 'Sound: restart'],
  sfxRestartRate: ['restart: pitch', '×', 'Pitch of the restart.', 'Sound: restart'],
  sfxHitGain: ['hit: gain', undefined, 'Each hit (III\'s run softer, the blow full).', 'Sound: hit'],
  sfxHitRate: ['hit: pitch', '×', 'Pitch of the hit.', 'Sound: hit'],
  sfxThudGain: ['thud: gain', undefined, 'The punch under the impact.', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxBoomGain: ['boom: gain', undefined, 'II-IV: a cinematic boom (deepest on IV).', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxBellGain: ['bell: gain', undefined, 'The gong the ticks build into (IV; softer on III).', 'Sound: bell'],
  sfxBellRate: ['bell: pitch', '×', 'Pitch of the bell (low = a gong).', 'Sound: bell'],
  sfxRumbleGain: ['rumble: gain', undefined, 'IV: a low rumble under the collapse.', 'Sound: rumble'],
  sfxRumbleRate: ['rumble: pitch', '×', 'Pitch of the rumble.', 'Sound: rumble'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the impact sounds.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<BulletTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hero draws. The view pushes in over this.'],
  Darts: ['Darts', undefined, 'How many darts (I one, II a ring, III the volley; IV uses the dome dials).'],
  StaggerMs: ['Stagger', 'ms', 'The gap between darts leaving the hand.'],
  FlyMs: ['Flight', 'ms', 'A dart\'s flight to where it stops (at 1600 px).'],
  HangMs: ['Hang', 'ms', 'How long time stays stopped once the last dart hangs (IV: set by the 3-2-1).'],
  ResumeMs: ['Resume', 'ms', 'Time restarting: the snap from the hang into the hit.'],
  Size: ['Size', '×', 'The dart size multiplier for this tier.'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Push: ['Stopped push', '×', 'How far the view keeps pushing in while time is stopped.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact.'],
  SettleMs: ['Settle', 'ms', 'After the impact before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herobullettime', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Bullet Time (Ancient)',
  store: heroBulletTimeStore,
  defaults: HERO_BULLET_DEFAULTS,
  ranges: HERO_BULLET_RANGES,
  globals: GLOBALS,
  levels: BULLET_LEVELS,
  levelNames: { t1: 'Tier I (one dart)', t2: 'Tier II (a ring of three)', t3: 'Tier III (the spiral volley)', t4: 'Tier IV (the dome)' },
  suffixes: BULLET_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorGold', 'Gold', 'The darts, the clock hand, the ripples.'],
    ['colorLight', 'Light gold', 'The flashes, the clock face, the glints.'],
    ['colorViolet', 'Violet', 'Stopped time: its flash and rings, IV\'s third ring of blades.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: tick': 'sfxTickClip', 'Sound: throw': 'sfxThrowClip', 'Sound: freeze': 'sfxFreezeClip', 'Sound: time stops': 'sfxStopClip',
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
  smallHint: 'one dart, frozen an inch from the target.',
  bigHint: 'the dome of blades.',
  tierHints: [
    'a gold clock-hand dart flies and stops dead an inch from the target; time resumes: the hit.',
    'three darts stop in a ring round the target, tick tick tick; time resumes and they all hit together.',
    'a volley freezes mid-flight in a spiral as a clock face flashes; the hero snaps and it all lands.',
    'time stops for the whole board: dozens of blades hang in a dome while a clock counts 3-2-1; time restarts and the dome collapses into one massive impact.',
  ],
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroBulletTime?: unknown }).__heroBulletTime = { demo: built.demo };
}

export function HeroBulletTimeTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
