import {
  COIN_LEVELS, COIN_LEVEL_SUFFIXES, HERO_COIN_DEFAULTS, HERO_COIN_RANGES, coinPlan, getHeroCoinConfig, heroCoinStore,
  type CoinLevelSuffix,
} from './heroCoin/heroCoinConfig';
import { playHeroCoin } from './heroCoin/heroCoin';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the COIN FLICK hero attack (a Rare; owner ask 2026-09-29: "build 5 animations that range from rare ->
 * epic ... rare and epics should only have 2 or 3 tiers"). Two groups of per-tier dials: Small (shared tiers I-II) and
 * Big (III-IV, and every knockout). The Play buttons run the real runner between the two real portraits.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6). Small still plays here.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): from here the coin plays Big.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20). Big (a knockout always plays Big).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroDipPx: ['Wind back', 'px', 'How far the hero dips back from the target as it readies the flick.', 'Ready'],
  heroFlickPx: ['Flick', 'px', 'How far the hero snaps toward the target on the flick.', 'Ready'],
  coinPx: ['Coin size', 'px', 'The coin\'s diameter (the per-tier size multiplies it).', 'Coin'],
  ghosts: ['Afterimages', undefined, 'Ghost coins trailing the flying coin (0 = none).', 'Coin'],
  ghostMs: ['Afterimage gap', 'ms', 'How far back along the path each afterimage sits.', 'Coin'],
  glintAlpha: ['Glint', 'opacity', 'The star glint that winks as the face turns square to you.', 'Coin'],
  pingSize: ['Ping size', '×', 'The size of the sparkle, ring and glitter on every ping.', 'Ping'],
  caromMs: ['Carom', 'ms', 'Small: how long the coin tumbles away off the face after the ping.', 'Ping'],
  showerSpeed: ['Shower speed', undefined, 'px/s. Big: how hard the shower of coins spills out.', 'Ping'],
  showerGravity: ['Shower gravity', undefined, 'px/s². Big: how fast the shower falls.', 'Ping'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked back on the impact.', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the impact.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the impact shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the impact.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxFlickGain: ['flick: gain', undefined, 'The swish of the coin leaving the hand.', 'Sound: flick'],
  sfxFlickRate: ['flick: pitch', '×', 'Pitch of the swish.', 'Sound: flick'],
  sfxSnapGain: ['snap: gain', undefined, 'The finger snap under the flick.', 'Sound: snap'],
  sfxSnapRate: ['snap: pitch', '×', 'Pitch of the snap.', 'Sound: snap'],
  sfxDingGain: ['ding: gain', undefined, 'The DING of every ping (climbs a step on each ricochet).', 'Sound: ding'],
  sfxDingRate: ['ding: pitch', '×', 'Pitch of the first ding.', 'Sound: ding'],
  sfxSparkleGain: ['sparkle: gain', undefined, 'A shimmer under each ding.', 'Sound: sparkle'],
  sfxSparkleRate: ['sparkle: pitch', '×', 'Pitch of the shimmer.', 'Sound: sparkle'],
  sfxImpactGain: ['impact: gain', undefined, 'A light smack under the last ping.', 'Sound: impact'],
  sfxImpactRate: ['impact: pitch', '×', 'Pitch of the smack.', 'Sound: impact'],
  sfxShowerGain: ['shower: gain', undefined, 'Big: the coins spilling out.', 'Sound: shower'],
  sfxShowerRate: ['shower: pitch', '×', 'Pitch of the spill.', 'Sound: shower'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the coin plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<CoinLevelSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hero readying the flick. The view pushes in over this.'],
  FlightMs: ['Flight', 'ms', 'The coin crossing the board (at 1600 px; lower = faster).'],
  Arc: ['Arc', '×', 'How high the coin arcs, as a fraction of the distance.'],
  Pings: ['Pings', undefined, 'How many times the coin pings the face (the last is the blow; the rest ricochet).'],
  HopMs: ['Ricochet hop', 'ms', 'Each ricochet hop off the face and back.'],
  HopLift: ['Hop height', '×', 'How high each ricochet bounces (in portrait radii).'],
  CoinSize: ['Coin size', '×', 'The coin size multiplier for this tier.'],
  FlipHz: ['Flip speed', undefined, 'Flips per second (the edge-on turn).'],
  Sparkles: ['Glitter', undefined, 'Glitter sprayed off each ping.'],
  Shower: ['Shower coins', undefined, 'Coins spilled by the last ping (0 = the coin caroms off instead).'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the impact.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Punch: ['Impact punch', '×', 'Extra push on the impact before the view settles.'],
  SettleMs: ['Settle', 'ms', 'Hold after the last beat before the sequence ends.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herocoin', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Coin (Rare)',
  store: heroCoinStore,
  defaults: HERO_COIN_DEFAULTS,
  ranges: HERO_COIN_RANGES,
  globals: GLOBALS,
  levels: COIN_LEVELS,
  levelNames: { small: 'Small (tiers I-II)', big: 'Big (tiers III-IV, knockouts)' },
  suffixes: COIN_LEVEL_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorGold', 'Gold', 'The coin, the rings and the shower.'],
    ['colorAmber', 'Amber', 'The warm glow round the coin, its afterimages and the ping bloom.'],
    ['colorShine', 'Shine', 'The gleam, the glints and the sparkle cores.'],
    ['colorDeep', 'Deep', 'The bronze the coin shades to as it turns edge-on.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU flick.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY flick.'],
  ],
  clipOf: {
    'Sound: flick': 'sfxFlickClip', 'Sound: snap': 'sfxSnapClip', 'Sound: ding': 'sfxDingClip', 'Sound: sparkle': 'sfxSparkleClip',
    'Sound: impact': 'sfxImpactClip', 'Sound: shower': 'sfxShowerClip',
  },
  note: () => {
    const c = getHeroCoinConfig();
    const p = coinPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · ${p.level} · ${p.pings.length} ping${p.pings.length === 1 ? '' : 's'}${p.shower ? `, ${p.shower} coins` : ''} · impact ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt)} ms after the formation`;
  },
  play: (o) => playHeroCoin(o),
  verb: 'flicks a coin at',
  smallHint: 'Small, one coin pings and caroms off.',
  bigHint: 'Big, a ricochet volley and a shower of coins.',
});

export const SPEC = built.spec;

// DEV: a console / capture-rig handle on the same player the buttons use.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroCoin?: unknown }).__heroCoin = { demo: built.demo };
}

export function HeroCoinTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
