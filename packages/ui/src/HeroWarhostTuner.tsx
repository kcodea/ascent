import {
  WARHOST_LEVELS, WARHOST_TIER_SUFFIXES, HERO_WARHOST_DEFAULTS, HERO_WARHOST_RANGES, warhostPlan, warhostSlowExtraMs, getHeroWarhostConfig,
  heroWarhostStore, type WarhostTierSuffix,
} from './heroWarhost/heroWarhostConfig';
import { playHeroWarhost } from './heroWarhost/heroWarhost';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the WARHOST hero attack (the Ancient of War): an army of tiny soldiers delivers the blow. Four groups
 * of per-tier dials (I the spearman; II the archers; III the cavalry; IV the host), the soldiers, each look's own
 * dials, the dust, the colours and one clip / gain / pitch row per sound cue. The Play buttons at the top play all
 * four looks.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier II from', undefined, 'Shared damage tier II (6): the archers.', 'Damage tiers'],
  tier3At: ['Tier III from', undefined, 'Shared damage tier III (12): the cavalry.', 'Damage tiers'],
  tier4At: ['Tier IV from', undefined, 'Shared damage tier IV (20): the host (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroWindPx: ['Lean back', 'px', 'How far the hero leans back through the ready.', 'Ready'],
  heroThrowPx: ['Send-off', 'px', 'How far the hero thrusts toward the target as the troops go.', 'Ready'],
  soldierPx: ['Soldier height', 'px', 'A foot soldier, sole to helmet (each one varies a little).', 'Soldiers'],
  cavalryPx: ['Rider height', 'px', 'A rider, hooves to helmet.', 'Soldiers'],
  standPx: ['Stand off', 'px', 'I, II: how far out from the hero the spearman plants and the archers form their line.', 'Soldiers'],
  cheerMs: ['I cheer', 'ms', 'I: how long the spearman cheers before he runs home.', 'Spearman and archers'],
  lineGapPx: ['II line gap', 'px', 'II: the gap between archers in the line.', 'Spearman and archers'],
  arrowsPer: ['II arrows each', undefined, 'II: arrows each archer looses.', 'Spearman and archers'],
  patterMs: ['II patter', 'ms', 'II: the gap between arrows landing (the last is the blow).', 'Spearman and archers'],
  rowMs: ['III row gap', 'ms', 'III: the gap between each row of the wedge reaching the target.', 'Cavalry and host'],
  drumMs: ['IV drum gap', 'ms', 'IV: the gap between the three war drums.', 'Cavalry and host'],
  rankMs: ['IV rank gap', 'ms', 'IV: the gap between ranks reaching the target (their spacing follows the pace).', 'Cavalry and host'],
  hostFiles: ['IV soldiers a rank', undefined, 'IV: foot soldiers in each rank (ranks x this is the host: keep frame times under 6.25 ms).', 'Cavalry and host'],
  hostWidthPx: ['IV host width', 'px', 'IV: how wide the host is as it sets out.', 'Cavalry and host'],
  funnel: ['IV funnel', '×', 'IV: how tight the host squeezes as it crosses the target (1 = none).', 'Cavalry and host'],
  hostCavalry: ['IV riders a flank', undefined, 'IV: riders on each flank.', 'Cavalry and host'],
  hostArrows: ['IV arrows a volley', undefined, 'IV: arrows in each of the two volleys overhead (0 = none).', 'Cavalry and host'],
  dustMs: ['IV dust thins', 'ms', 'IV: after the last rank passes, how long before the banner goes in.', 'Cavalry and host'],
  bannerMs: ['IV banner flies', 'ms', 'IV: how long the planted banner snaps in the wind.', 'Cavalry and host'],
  dust: ['Dust', '×', 'How much dust: every step puff and every cloud over the trample (0 = none).', 'Impact'],
  impactSize: ['Impact size', '×', 'The knock, the shock rings and the speed lines on the blow.', 'Impact'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked on the blow (and about, by each rank after it).', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the blow.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the blow\'s shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the blow.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxHornGain: ['horn: gain', undefined, 'The war horn (III a quick call, IV the long deep one).', 'Sound: horn'],
  sfxHornRate: ['horn: pitch', '×', 'Pitch of the horn.', 'Sound: horn'],
  sfxDrumGain: ['drum: gain', undefined, 'IV: each of the three war drums (each a little louder and lower).', 'Sound: drum'],
  sfxDrumRate: ['drum: pitch', '×', 'Pitch of the drum.', 'Sound: drum'],
  sfxChargeGain: ['charge: gain', undefined, 'The host\'s battle cry and running feet (IV; quieter under III).', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the charge.', 'Sound: charge'],
  sfxGallopGain: ['gallop: gain', undefined, 'Hooves (III; quieter under IV for the flanks).', 'Sound: gallop'],
  sfxGallopRate: ['gallop: pitch', '×', 'Pitch of the gallop.', 'Sound: gallop'],
  sfxLooseGain: ['loose: gain', undefined, 'Bowstrings (II, and IV\'s volleys).', 'Sound: loose'],
  sfxLooseRate: ['loose: pitch', '×', 'Pitch of the bowstrings.', 'Sound: loose'],
  sfxThunkGain: ['thunk: gain', undefined, 'A point going into wood: the spear, each arrow (softer, higher), the banner pole.', 'Sound: thunk'],
  sfxThunkRate: ['thunk: pitch', '×', 'Pitch of the thunk.', 'Sound: thunk'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The spear leaving the hand; arrows in the air; the flag.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxThudGain: ['thud: gain', undefined, 'A heavy body hit: the charge striking, and each rank after it (softer).', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxBoomGain: ['boom: gain', undefined, 'A deep boom under the blow (III soft, IV full).', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxCheerGain: ['cheer: gain', undefined, 'A tiny cheer: the spearman (I), the soldier who plants the banner (IV).', 'Sound: cheer'],
  sfxCheerRate: ['cheer: pitch', '×', 'Pitch of the cheer (high = small voices).', 'Sound: cheer'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the drums, the horn and the blow.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<WarhostTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hero\'s send-off before the troops go (III: the horn; IV: the drums and the horn). The view pushes in over this.'],
  MarchMs: ['March', 'ms', 'I the run out; II the jog out; III, IV the charge from the hero to the target (at 1600 px).'],
  HoldMs: ['Hold', 'ms', 'I the plant and the wind-up; II the draw (the held beat). Unused on III and IV.'],
  FlightMs: ['Flight', 'ms', 'I the spear\'s flight; II the arrows\' (at 1600 px). Unused on III and IV.'],
  Troops: ['Troops', undefined, 'II archers; III riders; IV ranks of foot. (I is always one spearman.)'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the blow.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Punch: ['Impact punch', '×', 'Extra push on the blow.'],
  SettleMs: ['Settle', 'ms', 'After the blow: I, II the cheer and the run home; III the wedge wheeling off; IV the clear after the banner.'],
  Dim: ['Dim', 'opacity', 'How far everything but the two heroes dims.'],
};

const built = rareTunerSpec({
  id: 'herowarhost', // FROZEN: indexes this panel's dragged position in localStorage
  title: 'Hero Attack: Warhost (Ancient)',
  store: heroWarhostStore,
  defaults: HERO_WARHOST_DEFAULTS,
  ranges: HERO_WARHOST_RANGES,
  globals: GLOBALS,
  levels: WARHOST_LEVELS,
  levelNames: { t1: 'Tier I (the spearman)', t2: 'Tier II (the archers)', t3: 'Tier III (the cavalry)', t4: 'Tier IV (the host)' },
  suffixes: WARHOST_TIER_SUFFIXES,
  levelSpecs: LEVEL_SPECS,
  colors: [
    ['colorRed', 'Red', 'The host\'s colour in the shock rings and the drum glow (the soldiers are painted).'],
    ['colorBrass', 'Brass', 'The knock, the rings, the sparks.'],
    ['colorDust', 'Dust', 'Every puff and cloud.'],
    ['colorPlayer', 'Your side', 'Your total colour when YOU strike.'],
    ['colorFoe', 'Foe side', 'Their total colour when THEY strike.'],
  ],
  clipOf: {
    'Sound: horn': 'sfxHornClip', 'Sound: drum': 'sfxDrumClip', 'Sound: charge': 'sfxChargeClip', 'Sound: gallop': 'sfxGallopClip',
    'Sound: loose': 'sfxLooseClip', 'Sound: thunk': 'sfxThunkClip', 'Sound: whoosh': 'sfxWhooshClip', 'Sound: thud': 'sfxThudClip',
    'Sound: boom': 'sfxBoomClip', 'Sound: cheer': 'sfxCheerClip',
  },
  note: () => {
    const c = getHeroWarhostConfig();
    const p = warhostPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · tier ${p.tier} · ${p.kind} · blow ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt + warhostSlowExtraMs(p))} ms after the formation`;
  },
  play: (o) => playHeroWarhost(o),
  verb: 'sends the host at',
  smallHint: 'one little spearman runs out and throws his spear.',
  bigHint: 'the whole host floods across.',
  tierHints: [
    'one little spearman runs out, plants his feet and throws; the spear sticks with a twang; he cheers and runs home.',
    'a rank of archers jogs out, draws together and looses an arrow rain that patters into the target.',
    'a war horn, then a wedge of cavalry charges across and rides through the target, wheeling off.',
    'three war drums, a horn, banners, then the full host floods over the target; one soldier stays to plant a banner on it.',
  ],
  knockoutHint: 'Huge remixed: three more soldiers stay to cheer round the banner, a prismatic shock on the front rank\'s hit, a bigger shake, a short slow-mo dip and the KO sting.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroWarhost?: unknown }).__heroWarhost = { demo: built.demo };
}

export function HeroWarhostTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
