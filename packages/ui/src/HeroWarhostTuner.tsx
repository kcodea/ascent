import {
  WARHOST_LEVELS, WARHOST_TIER_SUFFIXES, HERO_WARHOST_DEFAULTS, HERO_WARHOST_RANGES, warhostPlan, warhostSlowExtraMs, getHeroWarhostConfig,
  heroWarhostStore, type WarhostTierSuffix,
} from './heroWarhost/heroWarhostConfig';
import { playHeroWarhost } from './heroWarhost/heroWarhost';
import { previewLeadIn } from './heroAttack/attackDemo';
import { rareTunerSpec, type RareGlobalSpec, type RareLevelSpec } from './heroAttack/rareTuner';
import { TunerPanel } from './TunerPanel';

/**
 * DEV tuner for the WARHOST hero attack (the Ancient of War): a silly army of tiny soldiers delivers the blow, more
 * absurd and more powerful with every tier. Four groups of per-tier dials (Tier 1 the eager recruit; Tier 2 the squad;
 * Tier 3 the cavalry and the mages; Tier 4 the whole host), the soldiers, the mages and their spells, each look's own
 * dials, the dust, the colours and one clip / gain / pitch row per sound cue. The Play buttons at the top play all four
 * looks.
 */
const GLOBALS: Record<string, RareGlobalSpec> = {
  previewDamage: ['Preview damage', undefined, 'The blow the You / Foe buttons use (preview only, never shipped).', 'Preview'],
  previewParts: ['Preview numbers', undefined, 'How many numbers combine in the preview (the tier plus survivors).', 'Preview'],
  tier2At: ['Tier 2 from', undefined, 'Shared damage Tier 2 (6): the squad of archers.', 'Damage tiers'],
  tier3At: ['Tier 3 from', undefined, 'Shared damage Tier 3 (12): the cavalry and the mages.', 'Damage tiers'],
  tier4At: ['Tier 4 from', undefined, 'Shared damage Tier 4 (20): the whole host (a knockout always plays it).', 'Damage tiers'],
  absorbMs: ['Absorb', 'ms', 'The total sinking into the hero.', 'Ready'],
  heroWindPx: ['Lean back', 'px', 'How far the hero leans back through the ready.', 'Ready'],
  heroThrowPx: ['Send-off', 'px', 'How far the hero thrusts toward the target as the troops go.', 'Ready'],
  soldierPx: ['Soldier height', 'px', 'A foot soldier, sole to helmet (each one varies a little).', 'Soldiers'],
  cavalryPx: ['Rider height', 'px', 'A rider, hooves to helmet.', 'Soldiers'],
  standPx: ['Stand off', 'px', 'Tier 1, Tier 2: how far out from the hero the spearman plants and the archers form their line.', 'Soldiers'],
  cheerMs: ['Tier 1 cheer', 'ms', 'Tier 1: how long the spearman cheers before he runs home.', 'Spearman and archers'],
  tripMs: ['Tier 1 faceplant', 'ms', 'Tier 1: how long the spearman lies on his face (dizzy stars) after he trips.', 'Spearman and archers'],
  lineGapPx: ['Tier 2 line gap', 'px', 'Tier 2: the gap between archers in the line.', 'Spearman and archers'],
  arrowsPer: ['Tier 2 arrows each', undefined, 'Tier 2: arrows each archer of the line looses (the straggler\'s golden one is the blow).', 'Spearman and archers'],
  patterMs: ['Tier 2 patter', 'ms', 'Tier 2: the gap between the line\'s arrows landing.', 'Spearman and archers'],
  mages3: ['Tier 3 mages', undefined, 'Tier 3: mages (the first casts a fireball, the second lightning; two of them bicker first).', 'Mages and spells'],
  mages4: ['Tier 4 mages', undefined, 'Tier 4: mages in the barrage (fire, frost, lightning in turn; each casts twice).', 'Mages and spells'],
  bickerMs: ['Bicker', 'ms', 'Tier 3, Tier 4: how long two of the mages squabble over who casts (0 = they do not).', 'Mages and spells'],
  spellMs: ['Spell flight', 'ms', 'A fireball\'s or a frost bolt\'s flight (at 1600 px). Lightning is instant.', 'Mages and spells'],
  spellSize: ['Spell size', '×', 'The spells\' heads, trails and bursts, and the rune circles.', 'Mages and spells'],
  boulder: ['Tier 4 boulder', undefined, 'Tier 4: the flaming catapult boulder landing with the front rank (0 = none).', 'Mages and spells'],
  rowMs: ['Tier 3 row gap', 'ms', 'Tier 3: the gap between each row of the wedge reaching the target.', 'Cavalry and host'],
  drums: ['Tier 4 drums', undefined, 'Tier 4: how many war drums open the look (a banner rises on each).', 'Cavalry and host'],
  drumMs: ['Tier 4 drum gap', 'ms', 'Tier 4: the gap after the first war drum (each later gap is shorter: they quicken).', 'Cavalry and host'],
  drummers: ['Tier 4 drummers', undefined, 'Tier 4: the drum line either side of the hero.', 'Cavalry and host'],
  rankMs: ['Tier 4 rank gap', 'ms', 'Tier 4: the gap between ranks reaching the target (their spacing follows the pace).', 'Cavalry and host'],
  hostFiles: ['Tier 4 soldiers a rank', undefined, 'Tier 4: foot soldiers in each rank (ranks x this is the host: keep frame times under 6.25 ms).', 'Cavalry and host'],
  hostWidthPx: ['Tier 4 host width', 'px', 'Tier 4: how wide the host is as it sets out.', 'Cavalry and host'],
  funnel: ['Tier 4 funnel', '×', 'Tier 4: how tight the host squeezes as it crosses the target (1 = none).', 'Cavalry and host'],
  hostCavalry: ['Tier 4 riders a flank', undefined, 'Tier 4: riders on each flank.', 'Cavalry and host'],
  hostArrows: ['Tier 4 arrows a volley', undefined, 'Tier 4: arrows in each volley overhead (0 = none).', 'Cavalry and host'],
  volleys: ['Tier 4 volleys', undefined, 'Tier 4: how many volleys darken the sky (two before the blow, the rest over the trample).', 'Cavalry and host'],
  dustMs: ['Tier 4 dust thins', 'ms', 'Tier 4: after the last rank passes, how long before the banner goes in.', 'Cavalry and host'],
  bannerMs: ['Tier 4 banner flies', 'ms', 'Tier 4: how long the planted banner snaps in the wind.', 'Cavalry and host'],
  dust: ['Dust', '×', 'How much dust: every step puff and every cloud over the trample (0 = none).', 'Impact'],
  impactSize: ['Impact size', '×', 'The knock, the shock rings and the speed lines on the blow.', 'Impact'],
  knockPx: ['Knockback', 'px', 'How far the struck portrait is knocked on the blow (and about, by each rank after it).', 'Camera and portraits'],
  squash: ['Squash', '×', 'How much the struck portrait squashes on the blow.', 'Camera and portraits'],
  shakeMs: ['Shake length', 'ms', 'How long the blow\'s shake takes to die away.', 'Camera and portraits'],
  zoomOutMs: ['Settle back', 'ms', 'The view easing back to rest after the blow.', 'Camera and portraits'],
  reducedFadeMs: ['Reduced motion fade', 'ms', 'With reduced motion on, the numbers and total just fade over this.', 'Camera and portraits'],
  sfxHornGain: ['horn: gain', undefined, 'The war horn (Tier 3 a quick call, Tier 4 the long deep one).', 'Sound: horn'],
  sfxHornRate: ['horn: pitch', '×', 'Pitch of the horn.', 'Sound: horn'],
  sfxDrumGain: ['drum: gain', undefined, 'Tier 4: the war drums (each a little louder and lower), the marching beat under the host, the banner going in.', 'Sound: drum'],
  sfxDrumRate: ['drum: pitch', '×', 'Pitch of the drum.', 'Sound: drum'],
  sfxChargeGain: ['charge: gain', undefined, 'The host\'s battle cry and running feet (Tier 4; quieter under Tier 3).', 'Sound: charge'],
  sfxChargeRate: ['charge: pitch', '×', 'Pitch of the charge.', 'Sound: charge'],
  sfxGallopGain: ['gallop: gain', undefined, 'Hooves (Tier 3; quieter under Tier 4 for the flanks).', 'Sound: gallop'],
  sfxGallopRate: ['gallop: pitch', '×', 'Pitch of the gallop.', 'Sound: gallop'],
  sfxLooseGain: ['loose: gain', undefined, 'Bowstrings (Tier 2, and Tier 4\'s volleys).', 'Sound: loose'],
  sfxLooseRate: ['loose: pitch', '×', 'Pitch of the bowstrings.', 'Sound: loose'],
  sfxThunkGain: ['thunk: gain', undefined, 'A point going into wood: the spear, each arrow (softer, higher), the banner pole.', 'Sound: thunk'],
  sfxThunkRate: ['thunk: pitch', '×', 'Pitch of the thunk.', 'Sound: thunk'],
  sfxWhooshGain: ['whoosh: gain', undefined, 'The spear leaving the hand; arrows in the air; the flag.', 'Sound: whoosh'],
  sfxWhooshRate: ['whoosh: pitch', '×', 'Pitch of the whoosh.', 'Sound: whoosh'],
  sfxThudGain: ['thud: gain', undefined, 'A heavy body hit: the charge striking, and each rank after it (softer).', 'Sound: thud'],
  sfxThudRate: ['thud: pitch', '×', 'Pitch of the thud.', 'Sound: thud'],
  sfxBoomGain: ['boom: gain', undefined, 'A deep boom under the blow (Tier 3 soft, Tier 4 full).', 'Sound: boom'],
  sfxBoomRate: ['boom: pitch', '×', 'Pitch of the boom.', 'Sound: boom'],
  sfxCheerGain: ['cheer: gain', undefined, 'The cheer round the planted banner (Tier 4); the spearman\'s and the archer\'s tiny ones (Tier 1, Tier 2, much quieter).', 'Sound: cheer'],
  sfxCheerRate: ['cheer: pitch', '×', 'Pitch of the cheer (high = small voices).', 'Sound: cheer'],
  sfxVolleyGain: ['volley: gain', undefined, 'A volley of arrows: the hiss overhead, then the patter going in (Tier 2, and Tier 4\'s volleys).', 'Sound: volley'],
  sfxVolleyRate: ['volley: pitch', '×', 'Pitch of the volley.', 'Sound: volley'],
  sfxClashGain: ['clash: gain', undefined, 'The charge striking: steel, shields and shouting (Tier 4 full, Tier 3 shorter).', 'Sound: clash'],
  sfxClashRate: ['clash: pitch', '×', 'Pitch of the clash.', 'Sound: clash'],
  sfxFlapGain: ['flag: gain', undefined, 'Tier 4: the banner snapping open.', 'Sound: flag'],
  sfxFlapRate: ['flag: pitch', '×', 'Pitch of the flag.', 'Sound: flag'],
  sfxTripGain: ['trip: gain', undefined, 'Tier 1: the spearman falling flat on his face (a stumble, a clatter of tin).', 'Sound: trip'],
  sfxTripRate: ['trip: pitch', '×', 'Pitch of the trip.', 'Sound: trip'],
  sfxBickerGain: ['bicker: gain', undefined, 'Tier 3, Tier 4: two mages squabbling in squeaky gibberish.', 'Sound: bicker'],
  sfxBickerRate: ['bicker: pitch', '×', 'Pitch of the bickering (high = smaller wizards).', 'Sound: bicker'],
  sfxRuneGain: ['rune: gain', undefined, 'The mages popping out, and their rune circles lighting up.', 'Sound: rune'],
  sfxRuneRate: ['rune: pitch', '×', 'Pitch of the rune.', 'Sound: rune'],
  sfxFireGain: ['fireball: gain', undefined, 'A fireball\'s roar in the air, cued so it peaks as it lands.', 'Sound: fireball'],
  sfxFireRate: ['fireball: pitch', '×', 'Pitch of the fireball.', 'Sound: fireball'],
  sfxBurnGain: ['burst: gain', undefined, 'A fireball bursting on the target.', 'Sound: burst'],
  sfxBurnRate: ['burst: pitch', '×', 'Pitch of the burst.', 'Sound: burst'],
  sfxFrostGain: ['frost: gain', undefined, 'A frost bolt leaving the staff.', 'Sound: frost'],
  sfxFrostRate: ['frost: pitch', '×', 'Pitch of the frost.', 'Sound: frost'],
  sfxShatterGain: ['shatter: gain', undefined, 'A frost bolt shattering on the target.', 'Sound: shatter'],
  sfxShatterRate: ['shatter: pitch', '×', 'Pitch of the shatter.', 'Sound: shatter'],
  sfxZapGain: ['zap: gain', undefined, 'Lightning striking the target.', 'Sound: zap'],
  sfxZapRate: ['zap: pitch', '×', 'Pitch of the zap.', 'Sound: zap'],
  sfxCrackGain: ['crack: gain', undefined, 'Lightning leaving the staff.', 'Sound: crack'],
  sfxCrackRate: ['crack: pitch', '×', 'Pitch of the crack.', 'Sound: crack'],
  sfxWhistleGain: ['whistle: gain', undefined, 'Tier 4: the catapult boulder whistling in.', 'Sound: whistle'],
  sfxWhistleRate: ['whistle: pitch', '×', 'Pitch of the whistle.', 'Sound: whistle'],
  sfxBoulderGain: ['boulder: gain', undefined, 'Tier 4: the boulder crashing down with the front rank.', 'Sound: boulder'],
  sfxBoulderRate: ['boulder: pitch', '×', 'Pitch of the boulder.', 'Sound: boulder'],
  sfxCryGain: ['charge cry: gain', undefined, 'Tier 3, Tier 4: a tiny voice yelling "Charge!" as they set out.', 'Sound: voices'],
  sfxCryRate: ['charge cry: pitch', '×', 'Pitch of the cry (high = a tinier soldier).', 'Sound: voices'],
  sfxWaitGain: ['wait: gain', undefined, 'Tier 2 (and Tier 4\'s straggler): "Wait for me!" from the one who ran the wrong way.', 'Sound: wait'],
  sfxWaitRate: ['wait: pitch', '×', 'Pitch of the straggler\'s voice.', 'Sound: wait'],
  sfxRumbleGain: ['rumble: gain', undefined, 'The ground rumbling under a charge (Tier 3 and Tier 4). A synth, no clip.', 'Sound: mix'],
  sfxTailMix: ['reverb tail', undefined, 'How much reverb rings after the drums, the horn and the blow.', 'Sound: mix'],
  sfxDuck: ['duck others', '×', 'Other sound buses dip to this while the attack plays (1 = no duck).', 'Sound: mix'],
};

const LEVEL_SPECS: Record<WarhostTierSuffix, RareLevelSpec> = {
  ReadyMs: ['Ready', 'ms', 'The hero\'s send-off before the troops go (Tier 3: the horn and the mages bickering; Tier 4: the drums, the mages and the horn). The view pushes in over this.'],
  MarchMs: ['March', 'ms', 'Tier 1 the run out (the faceplant is extra); Tier 2 the jog out; Tier 3, Tier 4 the charge from the hero to the target (at 1600 px).'],
  HoldMs: ['Hold', 'ms', 'Tier 1 the plant and the wind-up; Tier 2 the draw (the held beat). Unused on Tier 3 and Tier 4.'],
  FlightMs: ['Flight', 'ms', 'Tier 1 the spear\'s flight; Tier 2 the arrows\' (at 1600 px). Unused on Tier 3 and Tier 4.'],
  Troops: ['Troops', undefined, 'Tier 2 archers in the line (plus the one who runs the wrong way); Tier 3 riders; Tier 4 ranks of foot. (Tier 1 is always one spearman.)'],
  Shake: ['Shake', 'px', 'How hard the view shakes on the blow.'],
  Zoom: ['Push in', '×', 'How far the view pushes in through the ready.'],
  Punch: ['Impact punch', '×', 'Extra push on the blow.'],
  SettleMs: ['Settle', 'ms', 'After the blow: Tier 1, Tier 2 the cheer and the run home; Tier 3 the wedge wheeling home; Tier 4 the clear after the banner.'],
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
  levelNames: { t1: 'Tier 1 (the eager recruit)', t2: 'Tier 2 (the squad)', t3: 'Tier 3 (cavalry and mages)', t4: 'Tier 4 (the whole host)' },
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
    'Sound: boom': 'sfxBoomClip', 'Sound: cheer': 'sfxCheerClip', 'Sound: volley': 'sfxVolleyClip', 'Sound: clash': 'sfxClashClip', 'Sound: flag': 'sfxFlapClip',
    'Sound: trip': 'sfxTripClip', 'Sound: bicker': 'sfxBickerClip', 'Sound: rune': 'sfxRuneClip', 'Sound: fireball': 'sfxFireClip', 'Sound: burst': 'sfxBurnClip',
    'Sound: frost': 'sfxFrostClip', 'Sound: shatter': 'sfxShatterClip', 'Sound: zap': 'sfxZapClip', 'Sound: crack': 'sfxCrackClip', 'Sound: whistle': 'sfxWhistleClip',
    'Sound: boulder': 'sfxBoulderClip', 'Sound: voices': 'sfxCryClip', 'Sound: wait': 'sfxWaitClip',
  },
  note: () => {
    const c = getHeroWarhostConfig();
    const p = warhostPlan({ leadIn: previewLeadIn(c.previewDamage, c.previewParts), total: c.previewDamage, distance: 1600 }, c);
    return `dev · Tier ${p.tier} · ${p.kind} · blow ${Math.round(p.impactAt - p.chargeAt)} · end ${Math.round(p.endAt - p.chargeAt + warhostSlowExtraMs(p))} ms after the formation`;
  },
  play: (o) => playHeroWarhost(o),
  verb: 'sends the host at',
  smallHint: 'one eager little spearman runs out, trips on his face, and throws anyway.',
  bigHint: 'the whole absurd host floods across.',
  tierHints: [
    'Tier 1: one eager spearman sprints out, trips flat on his face (dizzy stars), scrambles up and throws anyway; the spear streaks in and sticks; he cheers and trots home.',
    'Tier 2: a squad of archers looses a rain of trailing arrows, while one who ran the wrong way shouts "Wait for me!", sprints back and looses the last, golden arrow: the blow.',
    'Tier 3: a war horn; two mages pop out on rune circles, bicker, then cast a fireball and a lightning bolt; "Charge!" and a wedge of cavalry rides through the target and wheels home.',
    'Tier 4: a drum line, banners, five mages, the horn, "Charge!"; the host floods across under three volleys, the mages\' barrage and a flaming catapult boulder; a straggler chases after; one tiny soldier plants a huge banner.',
  ],
  knockoutHint: 'Tier 4 remixed: seven stay to cheer round the banner, a prismatic shock on the blow, a bigger shake, a short slow-mo dip and the KO sting.',
});

export const SPEC = built.spec;

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __heroWarhost?: unknown }).__heroWarhost = { demo: built.demo };
}

export function HeroWarhostTuner(): JSX.Element {
  return <TunerPanel spec={SPEC} />;
}
