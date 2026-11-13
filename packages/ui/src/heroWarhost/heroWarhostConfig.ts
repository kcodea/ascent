/**
 * THE WARHOST HERO ATTACK ("Warhost", the Ancient of War; ANCIENT rarity): its tuned values, its pure timeline, the
 * pure staging (every soldier, mage, drummer, spear, arrow, spell and banner), and the pure camera.
 *
 * THE SIGNATURE: AN ARMY OF TINY SOLDIERS, and a SILLY one (third pass, owner 2026-11-13: "it should be a silly one, so
 * make it more over the top and ridiculous ... the army gets more powerful too with mages etc casting pixi
 * animations"). The soldiers are small painted sprites; everything they DO is live Pixi: spell heads with particle
 * trails, lightning that re-forks every few frames, glowing rune circles on the ground, frost bursts, fire, dust,
 * rings and sparks. The army grows more absurd and more powerful with every tier:
 *  - TIER 1, THE EAGER RECRUIT: one little spearman sprints out, TRIPS flat on his face (dizzy stars over his head),
 *    scrambles up, plants his feet and THROWS anyway; the spear streaks in on a brass trail and sticks in the struck
 *    face with a twang (the blow). He cheers and trots home.
 *  - TIER 2, THE SQUAD: archers jog out and form a line; one of them runs the WRONG WAY, stands there looking about
 *    while the others draw and loose a rain of trailing arrows, then shouts "Wait for me!", sprints back into the line
 *    and looses the LAST arrow, a golden one: the blow. One of the squad cheers before they all jog home.
 *  - TIER 3, THE CAVALRY AND THE MAGES: a war horn; two little mages pop out on glowing rune circles and BICKER over
 *    who casts, then both do: a FIREBALL (a live flame head with a trail of fire and smoke) and a LIGHTNING bolt (a
 *    forking arc). A tiny voice yells "Charge!" and a wedge of cavalry rides through the struck portrait behind its own
 *    dust (the point rider is the blow) and wheels home round both sides of it.
 *  - TIER 4, THE WHOLE ABSURD HOST: a drum line hammers four quickening war drums while banners rise, five mages pop out
 *    on rune circles (two of them squabbling), the horn, "Charge!", and the host floods across with the view PANNING
 *    along its front: rank after rank of foot, cavalry on the flanks, three volleys that darken the sky, the mages'
 *    barrage (fire, frost and lightning; the second round all lands at once with the view PUSHED IN), and a flaming
 *    CATAPULT BOULDER from off screen, all landing with the front rank (the blow). The portrait is buried, poked and
 *    singed; a straggler who ran the wrong way sprints after the host; and one TINY soldier plants a big banner on it
 *    while the ones who stayed cheer.
 *  - KNOCKOUT ("Tier 5", an Ancient knockout): Tier 4 remixed: seven stay to cheer, a prismatic shock on the blow, a
 *    1.3x shake, a short slow-mo dip and the KO sting.
 *
 * THE HOST ALWAYS COMES FROM THE STRIKER'S SIDE: every path is built from the two portrait points, so it plays the same
 * in both directions. Formation jitter (each soldier's place, size and stride; where each spell lands) is rolled from
 * the seed.
 *
 * NEVER A FROZEN FRAME (R-PROG-ATTACK-10): the one clock never stops. Only the Knockout variant dips it (a smooth ramp
 * that never reaches 0).
 *
 * THE CONTRACT: the consequence lands exactly ONCE, on the impact beat. Everything before it is a tick (FX and sound
 * only: the arrows of the line, the spells that land early); everything after it (the ranks passing, the banner) is
 * FX only. Reduced motion: fades only.
 */
import { configStore } from '../heroAttack/configStore';
import { clamp, clamp01, seededRng, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, attackTier, isKnockoutVariant, type AttackTierContext, type TierNum,
} from '../heroAttack/tiers';
import { KO_DIP, KO_SHAKE, koDipExtraMs, koTimeScale, type KoDip } from '../heroAttack/knockout';

export type { TierNum };

export const WARHOST_LEVELS = ['t1', 't2', 't3', 't4'] as const;
export type WarhostLevel = (typeof WARHOST_LEVELS)[number];

export const WARHOST_TIER_SUFFIXES = ['ReadyMs', 'MarchMs', 'HoldMs', 'FlightMs', 'Troops', 'Shake', 'Zoom', 'Punch', 'SettleMs', 'Dim'] as const;
export type WarhostTierSuffix = (typeof WARHOST_TIER_SUFFIXES)[number];
type TierKey = `${WarhostLevel}${WarhostTierSuffix}`;

interface GlobalConfig {
  tier2At: number; tier3At: number; tier4At: number;
  absorbMs: number;
  /** A foot soldier's height and a rider's height (horse and all), px at stage scale 1. */
  soldierPx: number;
  cavalryPx: number;
  /** I, II: how far out from the striking portrait's edge the spearman plants / the archers form their line (px). */
  standPx: number;
  /** II: the gap between archers in the line (px), arrows loosed per archer, and the gap between arrows landing (ms). */
  lineGapPx: number;
  arrowsPer: number;
  patterMs: number;
  /** Tier 1: the cheer after the spear sticks (ms) before he runs home; how long he lies on his face after he trips. */
  cheerMs: number;
  tripMs: number;
  /** Tier 3, Tier 4: how many mages, how long two of them bicker, and a spell's flight (ms, at 1600 px). */
  mages3: number;
  mages4: number;
  bickerMs: number;
  spellMs: number;
  /** Tier 4: the drum line, how many volleys darken the sky, and the catapult boulder (0 = none). */
  drummers: number;
  volleys: number;
  boulder: number;
  /** How big the spells are (their heads, trails and bursts). */
  spellSize: number;
  /** III: the gap between each row of the wedge reaching the target (ms). */
  rowMs: number;
  /** IV: how many war drums, and the gap after the first (each later gap is shorter: the drums quicken). */
  drums: number;
  drumMs: number;
  /** IV: the gap between ranks reaching the target (ms), soldiers per rank, the host's width (px), riders per flank. */
  rankMs: number;
  hostFiles: number;
  hostWidthPx: number;
  hostCavalry: number;
  /** IV: arrows per volley (two volleys fly over the host). */
  hostArrows: number;
  /** IV: how tight the host funnels as it crosses the target (1 = no funnel). */
  funnel: number;
  /** IV: after the last rank passes, the dust thins for this long before the banner goes in; then it flies this long. */
  dustMs: number;
  bannerMs: number;
  /** How much dust (a multiplier on every puff and cloud). */
  dust: number;
  impactSize: number;
  heroWindPx: number;
  heroThrowPx: number;
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  colorRed: string;
  colorBrass: string;
  colorDust: string;
  colorPlayer: string;
  colorFoe: string;
  sfxHornClip: string; sfxHornGain: number; sfxHornRate: number;
  sfxDrumClip: string; sfxDrumGain: number; sfxDrumRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxGallopClip: string; sfxGallopGain: number; sfxGallopRate: number;
  sfxLooseClip: string; sfxLooseGain: number; sfxLooseRate: number;
  sfxThunkClip: string; sfxThunkGain: number; sfxThunkRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxThudClip: string; sfxThudGain: number; sfxThudRate: number;
  sfxBoomClip: string; sfxBoomGain: number; sfxBoomRate: number;
  sfxCheerClip: string; sfxCheerGain: number; sfxCheerRate: number;
  sfxVolleyClip: string; sfxVolleyGain: number; sfxVolleyRate: number;
  sfxClashClip: string; sfxClashGain: number; sfxClashRate: number;
  sfxFlapClip: string; sfxFlapGain: number; sfxFlapRate: number;
  sfxTripClip: string; sfxTripGain: number; sfxTripRate: number;
  sfxBickerClip: string; sfxBickerGain: number; sfxBickerRate: number;
  sfxRuneClip: string; sfxRuneGain: number; sfxRuneRate: number;
  sfxFireClip: string; sfxFireGain: number; sfxFireRate: number;
  sfxBurnClip: string; sfxBurnGain: number; sfxBurnRate: number;
  sfxFrostClip: string; sfxFrostGain: number; sfxFrostRate: number;
  sfxShatterClip: string; sfxShatterGain: number; sfxShatterRate: number;
  sfxZapClip: string; sfxZapGain: number; sfxZapRate: number;
  sfxCrackClip: string; sfxCrackGain: number; sfxCrackRate: number;
  sfxWhistleClip: string; sfxWhistleGain: number; sfxWhistleRate: number;
  sfxBoulderClip: string; sfxBoulderGain: number; sfxBoulderRate: number;
  sfxCryClip: string; sfxCryGain: number; sfxCryRate: number;
  sfxWaitClip: string; sfxWaitGain: number; sfxWaitRate: number;
  /** The ground rumble under a charge (a synth: no clip). */
  sfxRumbleGain: number;
  sfxTailMix: number;
  sfxDuck: number;
  previewDamage: number;
  previewParts: number;
}
export type HeroWarhostConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_WARHOST_COLOR_KEYS = ['colorRed', 'colorBrass', 'colorDust', 'colorPlayer', 'colorFoe'] as const;
export const HERO_WARHOST_CLIP_KEYS = [
  'sfxHornClip', 'sfxDrumClip', 'sfxChargeClip', 'sfxGallopClip', 'sfxLooseClip', 'sfxThunkClip', 'sfxWhooshClip', 'sfxThudClip',
  'sfxBoomClip', 'sfxCheerClip', 'sfxVolleyClip', 'sfxClashClip', 'sfxFlapClip', 'sfxTripClip', 'sfxBickerClip', 'sfxRuneClip', 'sfxFireClip',
  'sfxBurnClip', 'sfxFrostClip', 'sfxShatterClip', 'sfxZapClip', 'sfxCrackClip', 'sfxWhistleClip', 'sfxBoulderClip', 'sfxCryClip', 'sfxWaitClip',
] as const;
export type HeroWarhostStrKey = (typeof HERO_WARHOST_COLOR_KEYS)[number] | (typeof HERO_WARHOST_CLIP_KEYS)[number];
export type HeroWarhostNumKey = Exclude<keyof HeroWarhostConfig, HeroWarhostStrKey>;

/**
 * Per tier, Tier 1 / Tier 2 / Tier 3 / Tier 4.
 *  - Ready: the hero's send-off (Tier 3: the horn and the mages bickering; Tier 4: the drums, the mages and the horn).
 *  - March: Tier 1 the run out (not counting the trip); Tier 2 the jog out; Tier 3 and Tier 4 the charge from the
 *    striker to the target (at 1600 px).
 *  - Hold: Tier 1 the plant and the wind-up; Tier 2 the draw (the held beat).
 *  - Flight: Tier 1 the spear's flight; Tier 2 the arrows' flight (at 1600 px).
 *  - Troops: Tier 2 archers in the line (plus the one who runs the wrong way); Tier 3 riders; Tier 4 ranks of foot
 *    (Tier 1 is always one spearman).
 *  - Settle: after the blow (Tier 1, Tier 2: the cheer and the run home; Tier 3: the wedge wheeling home; Tier 4: the
 *    clear after the banner).
 */
const TIER_DEFAULTS: Record<WarhostTierSuffix, [number, number, number, number]> = {
  ReadyMs: [120, 140, 960, 1080],
  MarchMs: [300, 320, 660, 900],
  HoldMs: [190, 280, 0, 0],
  FlightMs: [290, 420, 0, 0],
  Troops: [1, 6, 10, 17],
  Shake: [8, 10, 22, 32],
  Zoom: [0.02, 0.025, 0.04, 0.045],
  Punch: [0.03, 0.04, 0.07, 0.1],
  SettleMs: [700, 560, 900, 300],
  Dim: [0.08, 0.12, 0.26, 0.42],
};

export const WARHOST_TIER_RANGES: Record<WarhostTierSuffix, [number, number, number]> = {
  ReadyMs: [60, 2000, 10],
  MarchMs: [120, 2000, 10],
  HoldMs: [0, 1200, 10],
  FlightMs: [0, 1200, 10],
  Troops: [1, 22, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.1, 0.002],
  Punch: [0, 0.15, 0.001],
  SettleMs: [100, 2000, 10],
  Dim: [0, 0.6, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => WARHOST_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_WARHOST_DEFAULTS: HeroWarhostConfig = {
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 160,
  soldierPx: 46,
  cavalryPx: 70,
  standPx: 190,
  lineGapPx: 62,
  arrowsPer: 2,
  patterMs: 20,
  cheerMs: 360,
  tripMs: 560,
  mages3: 2,
  mages4: 5,
  bickerMs: 620,
  spellMs: 470,
  drummers: 4,
  volleys: 3,
  boulder: 1,
  spellSize: 1,
  rowMs: 70,
  drums: 4,
  drumMs: 330,
  rankMs: 44,
  hostFiles: 11,
  hostWidthPx: 600,
  hostCavalry: 6,
  hostArrows: 18,
  funnel: 0.5,
  dustMs: 300,
  bannerMs: 1050,
  dust: 1.2,
  impactSize: 1,
  heroWindPx: 9,
  heroThrowPx: 12,
  knockPx: 30,
  squash: 0.1,
  shakeMs: 480,
  zoomOutMs: 460,
  reducedFadeMs: 260,
  colorRed: '#ff5a4f',
  colorBrass: '#e2b34a',
  colorDust: '#b9966a',
  colorPlayer: '#ffe9b0',
  colorFoe: '#ff7a5c',
  // The horn and the charge were re-levelled in the second pass (about 8 dB hotter clips): their gains are per clip.
  sfxHornClip: 'fx/warhost-horn', sfxHornGain: 0.55, sfxHornRate: 1,
  sfxDrumClip: 'fx/warhost-drum', sfxDrumGain: 1.05, sfxDrumRate: 1,
  sfxChargeClip: 'fx/warhost-charge', sfxChargeGain: 0.5, sfxChargeRate: 1,
  sfxGallopClip: 'fx/warhost-gallop', sfxGallopGain: 0.85, sfxGallopRate: 1,
  sfxLooseClip: 'fx/warhost-loose', sfxLooseGain: 0.9, sfxLooseRate: 1,
  sfxThunkClip: 'fx/warhost-thunk', sfxThunkGain: 1, sfxThunkRate: 1,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.6, sfxWhooshRate: 1.3,
  sfxThudClip: 'fx/universfield-ground-impact-352053', sfxThudGain: 0.9, sfxThudRate: 1,
  sfxBoomClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxBoomGain: 0.8, sfxBoomRate: 0.9,
  sfxCheerClip: 'fx/cheering', sfxCheerGain: 0.9, sfxCheerRate: 1.2,
  // A volley: the hiss of arrows in the air (400 ms), then their patter going in.
  sfxVolleyClip: 'fx/warhost-volley', sfxVolleyGain: 0.8, sfxVolleyRate: 1,
  // The charge striking: steel, shields and shouting.
  sfxClashClip: 'fx/warhost-clash', sfxClashGain: 0.6, sfxClashRate: 1,
  // The banner snapping open.
  sfxFlapClip: 'fx/warhost-flap', sfxFlapGain: 1.1, sfxFlapRate: 1,
  // Third pass. Tier 1's faceplant (a stumble and the clatter of a tin helmet), the mages' squeaky bickering.
  sfxTripClip: 'fx/warhost-trip', sfxTripGain: 0.8, sfxTripRate: 1.1,
  sfxBickerClip: 'fx/warhost-bicker', sfxBickerGain: 0.6, sfxBickerRate: 1.12,
  // The rune circles lighting up under the mages.
  sfxRuneClip: 'castspell', sfxRuneGain: 0.5, sfxRuneRate: 1.15,
  // A fireball: the roar in the air peaks as it lands (397 ms in); a fire burst under it.
  sfxFireClip: 'fx/warhost-fireball', sfxFireGain: 0.75, sfxFireRate: 1,
  sfxBurnClip: 'turnexplosion', sfxBurnGain: 0.45, sfxBurnRate: 1.2,
  // A frost bolt: a cold sparkle in the air, then the shatter.
  sfxFrostClip: 'freezetavern', sfxFrostGain: 0.4, sfxFrostRate: 1.25,
  sfxShatterClip: 'rebornshatter', sfxShatterGain: 0.55, sfxShatterRate: 1.15,
  // Lightning: the crack as it leaves the staff, the zap as it strikes.
  sfxZapClip: 'fx/blue-impact-hit', sfxZapGain: 0.6, sfxZapRate: 1.35,
  sfxCrackClip: 'crit', sfxCrackGain: 0.4, sfxCrackRate: 1.3,
  // The catapult boulder: a long cartoon whistle in, then the crash of rock and earth.
  sfxWhistleClip: 'fx/alexis_gaming_cam-woosh-long-cartoon-370386', sfxWhistleGain: 0.55, sfxWhistleRate: 0.9,
  sfxBoulderClip: 'fx/warhost-boulder', sfxBoulderGain: 0.9, sfxBoulderRate: 1,
  // Tiny voices (spoken lines pitched up): "Charge!" and the Tier 2 straggler's "Wait for me!".
  sfxCryClip: 'fx/warhost-charge-vo', sfxCryGain: 0.7, sfxCryRate: 1.35,
  sfxWaitClip: 'fx/warhost-wait-vo', sfxWaitGain: 0.7, sfxWaitRate: 1.4,
  sfxRumbleGain: 0.5,
  sfxTailMix: 0.15,
  sfxDuck: 0.6,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroWarhostStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  soldierPx: [20, 80, 1],
  cavalryPx: [30, 120, 1],
  standPx: [40, 400, 5],
  lineGapPx: [16, 120, 1],
  arrowsPer: [1, 3, 1],
  patterMs: [0, 120, 2],
  cheerMs: [0, 1200, 10],
  tripMs: [120, 1500, 10],
  mages3: [0, 2, 1],
  mages4: [0, 6, 1],
  bickerMs: [0, 1500, 10],
  spellMs: [200, 1200, 10],
  drummers: [0, 6, 1],
  volleys: [0, 4, 1],
  boulder: [0, 1, 1],
  spellSize: [0.3, 2.5, 0.05],
  rowMs: [20, 300, 5],
  drums: [1, 5, 1],
  drumMs: [120, 800, 10],
  rankMs: [15, 160, 1],
  hostFiles: [3, 15, 1],
  hostWidthPx: [200, 1400, 10],
  hostCavalry: [0, 8, 1],
  hostArrows: [0, 24, 1],
  funnel: [0.2, 1, 0.01],
  dustMs: [0, 1200, 10],
  bannerMs: [200, 2500, 10],
  dust: [0, 2, 0.05],
  impactSize: [0.3, 3, 0.05],
  heroWindPx: [0, 40, 1],
  heroThrowPx: [0, 50, 1],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxHornGain: [0, 2, 0.05], sfxHornRate: [0.5, 2.5, 0.01],
  sfxDrumGain: [0, 2, 0.05], sfxDrumRate: [0.5, 2.5, 0.01],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2.5, 0.01],
  sfxGallopGain: [0, 2, 0.05], sfxGallopRate: [0.5, 2.5, 0.01],
  sfxLooseGain: [0, 2, 0.05], sfxLooseRate: [0.5, 2.5, 0.01],
  sfxThunkGain: [0, 2, 0.05], sfxThunkRate: [0.5, 2.5, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2.5, 0.01],
  sfxThudGain: [0, 2, 0.05], sfxThudRate: [0.5, 2.5, 0.01],
  sfxBoomGain: [0, 2, 0.05], sfxBoomRate: [0.5, 2.5, 0.01],
  sfxCheerGain: [0, 2, 0.01], sfxCheerRate: [0.5, 2.5, 0.01],
  sfxVolleyGain: [0, 2, 0.05], sfxVolleyRate: [0.5, 2.5, 0.01],
  sfxClashGain: [0, 2, 0.05], sfxClashRate: [0.5, 2.5, 0.01],
  sfxFlapGain: [0, 2, 0.05], sfxFlapRate: [0.5, 2.5, 0.01],
  sfxTripGain: [0, 2, 0.05], sfxTripRate: [0.5, 2.5, 0.01],
  sfxBickerGain: [0, 2, 0.05], sfxBickerRate: [0.5, 2.5, 0.01],
  sfxRuneGain: [0, 2, 0.05], sfxRuneRate: [0.5, 2.5, 0.01],
  sfxFireGain: [0, 2, 0.05], sfxFireRate: [0.5, 2.5, 0.01],
  sfxBurnGain: [0, 2, 0.05], sfxBurnRate: [0.5, 2.5, 0.01],
  sfxFrostGain: [0, 2, 0.05], sfxFrostRate: [0.5, 2.5, 0.01],
  sfxShatterGain: [0, 2, 0.05], sfxShatterRate: [0.5, 2.5, 0.01],
  sfxZapGain: [0, 2, 0.05], sfxZapRate: [0.5, 2.5, 0.01],
  sfxCrackGain: [0, 2, 0.05], sfxCrackRate: [0.5, 2.5, 0.01],
  sfxWhistleGain: [0, 2, 0.05], sfxWhistleRate: [0.5, 2.5, 0.01],
  sfxBoulderGain: [0, 2, 0.05], sfxBoulderRate: [0.5, 2.5, 0.01],
  sfxCryGain: [0, 2, 0.05], sfxCryRate: [0.5, 2.5, 0.01],
  sfxWaitGain: [0, 2, 0.05], sfxWaitRate: [0.5, 2.5, 0.01],
  sfxRumbleGain: [0, 2, 0.05],
  sfxTailMix: [0, 1, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

export const HERO_WARHOST_RANGES: Record<HeroWarhostNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => WARHOST_TIER_SUFFIXES.map((s) => [`t${t}${s}`, WARHOST_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** Hard caps whatever the tuner says (the host tops out at 22 x 15 foot + 16 horse: under the scene's sprite cap). */
export const WARHOST_CAPS = { archers: 10, riders: 14, ranks: 22, files: 15, flank: 8, arrows: 24, shakePx: 40, zoom: 0.1, drums: 5, mages: 6, drummers: 6, volleys: 4 } as const;

/** IV: each war drum comes this much sooner than the gap before it (the drums quicken into the horn). */
export const WARHOST_DRUM_QUICKEN = 0.18;
/** IV: how many stay to cheer round the planted banner (and on the Knockout). */
export const WARHOST_CHEERERS = 4;
export const WARHOST_KO_CHEERERS = 7;
/** The volley clip's patter starts this far into it (after the hiss of the arrows in the air). */
export const WARHOST_VOLLEY_LEAD_MS = 400;

const store = configStore<HeroWarhostConfig>({
  key: 'ascent.herowarhost.v3', defaults: HERO_WARHOST_DEFAULTS, ranges: HERO_WARHOST_RANGES,
  colorKeys: HERO_WARHOST_COLOR_KEYS, clipKeys: HERO_WARHOST_CLIP_KEYS, previewKeys: ['previewDamage', 'previewParts'],
});
export const heroWarhostStore = store;
export const getHeroWarhostConfig = store.get;
export const clampHeroWarhostValue = store.clamp;
export const sanitizeHeroWarhostConfig = store.sanitize;
export const heroWarhostConfigJson = store.json;
/** The preview speed hook (Recruit + the Collection read one per style). Always 1. */
export function heroWarhostPreviewSpeed(): number { return 1; }

export function warhostTierDials(tier: TierNum, c: HeroWarhostConfig = store.get()): Record<WarhostTierSuffix, number> {
  return Object.fromEntries(WARHOST_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<WarhostTierSuffix, number>;
}

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

export const WARHOST_REF_DISTANCE = 1600;

/** Tier 4: the planted banner's size (x a rally banner's 1): big enough to be the last picture of the attack. */
export const WARHOST_PLANT_SIZE = 2.3;
/** A banner of size 1 stands this many soldier heights tall (the scene draws it so). */
export const WARHOST_BANNER_TALL = 2.5;
/** Tier 3: the wedge's riders are drawn bigger than the host's flank cavalry (ten horses have to carry a whole look). */
export const WARHOST_WEDGE_SIZE = 1.3;

/** The lone spearman (Tier 1) and the archers (Tier 2) are drawn bigger than a soldier of the host: one has to read alone. */
export const WARHOST_SPEARMAN_SIZE = 2;
export const WARHOST_ARCHER_SIZE = 1.45;
/** The mages and the drummers are drawn bigger than a soldier of the host (they carry the magic and the beat). */
export const WARHOST_MAGE_SIZE = 1.55;
export const WARHOST_DRUMMER_SIZE = 1.35;
/** Tier 4: the soldier who plants the banner is TINY next to it (the joke), and the straggler a touch bigger than the host. */
export const WARHOST_BEARER_SIZE = 1;
export const WARHOST_STRAGGLER_SIZE = 1.25;

/** Tier 2: an archer's second arrow leaves (and lands) this long after his first. */
export const WARHOST_RELOAD_MS = 90;
/** Lightning crosses the board in this long (it is a strike, not a flight). */
export const WARHOST_BOLT_MS = 70;
/** Tier 4: the marching drum under the host beats this often. */
export const WARHOST_MARCH_BEAT_MS = 215;
/** Tier 4: the mages' barrage, its first round landing over this long before the blow; then the view pushes in. */
export const WARHOST_BARRAGE_MS = 430;
export const WARHOST_BARRAGE_PUSH = 0.05;
/** Tier 3, Tier 4: how far the view zooms in as it pans along with the charge. */
export const WARHOST_PAN_ZOOM = { cavalry: 0.035, host: 0.075 } as const;

/**
 * A mage's staff tip (where his spells leave and his gem glows), from his feet, in his atlas cell's px facing right: x
 * forward, y up negative. The textures paint the staff to match.
 */
export const WARHOST_MAGE_TIP = { stand: { x: 15, y: -86 }, cast: { x: 36, y: -78 } } as const;
/** The foot soldier's atlas figure stands this many px (sole to helmet): staging scales the tip offsets by it. */
export const WARHOST_FOOT_H = 64;

/** The schools of magic the mages cast, in turn (Tier 4's third, fifth ... mage casts lightning). */
export type WarhostSchool = 'fire' | 'frost' | 'bolt' | 'rock';
const SCHOOLS: readonly WarhostSchool[] = ['fire', 'frost', 'bolt'];

/** A leg's time for this distance (a short hop is quicker, a long one a little slower). */
export function warhostLegMs(distance: number, ms: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : WARHOST_REF_DISTANCE;
  return Math.round(ms * clamp(Math.sqrt(d / WARHOST_REF_DISTANCE), 0.62, 1.15));
}

export interface WarhostPlanInput extends AttackTierContext {
  leadIn?: number;
  total: number;
  distance: number;
  reduced?: boolean;
}

export type WarhostKind = 'spear' | 'archers' | 'cavalry' | 'host';

/** One spell of the mages (or the catapult's boulder, `mage` -1): it leaves at `castAt` and lands at `landAt`. */
export interface WarhostSpellPlan { school: WarhostSchool; castAt: number; landAt: number; mage: number; round: number }

export interface WarhostPlan {
  reduced: boolean;
  tier: TierNum;
  kind: WarhostKind;
  k: number;
  total: number;
  /** The Knockout variant ("Tier 5"): Tier 4 remixed. */
  ko: boolean;
  chargeAt: number;
  absorbEnd: number;
  /** Tier 4: the war drums (each sooner than the last). */
  drums: number[];
  /** Tier 4: every strike of the drum line (the war drums, then the marching beat under the host). */
  beats: number[];
  drummers: number;
  /** Tier 3, Tier 4: the horn (-1 = none). */
  hornAt: number;
  /** The troops set out (Tier 1, 2 from the hero; Tier 3, 4 the front of the charge passes the striker). */
  marchAt: number;
  /** Tier 1: the spearman plants. Tier 2: the line is formed and the bows come up. Tier 3, 4: the front reaches the target. */
  arriveAt: number;
  /** Tier 1: the throw. Tier 2: the line's first arrows leave. (Tier 3, 4: the same as `marchAt`.) */
  looseAt: number;
  /** Tier 1: he trips flat on his face, and gets up (-1 = none). */
  tripAt: number;
  upAt: number;
  /**
   * Tier 2: the archer who ran the WRONG way stops and looks about (`lostAt`), turns and runs back shouting
   * (`turnAt`), is back in the line (`backAt`) and looses the last arrow (`lateAt`). Tier 4: the straggler (lost,
   * turn; he crosses after the host). -1 = none.
   */
  lostAt: number;
  turnAt: number;
  backAt: number;
  lateAt: number;
  /** Tier 3, 4: the mages pop out (`mageAt`), two of them bicker (`bickerAt` to `bickerEnd`), their rune circles flare. */
  mages: number;
  mageAt: number;
  bickerAt: number;
  bickerEnd: number;
  runeAt: number;
  /** Every spell and the boulder (an early one is a tick; one landing at `impactAt` is part of the blow). */
  spells: WarhostSpellPlan[];
  /** Tier 3, 4: a tiny voice yells "Charge!" (-1 = none). */
  cryAt: number;
  /** Tier 2: archers in the line. Tier 3: riders. Tier 4: ranks. */
  troops: number;
  /** Tier 2: when each arrow lands (the last, the straggler's golden one, is the blow). */
  lands: number[];
  /** Tier 4: when each overhead volley lands. */
  volleys: number[];
  /** Hits BEFORE the impact (ticks: Tier 2's arrows). */
  hits: number[];
  impactAt: number;
  /** AFTER the impact: each later row (Tier 3) or rank (Tier 4) reaching the target (FX only). */
  buffets: number[];
  /** Tier 3, 4: the last row or rank has crossed the target. */
  passAt: number;
  /** Tier 1, 2: the cheer starts. Tier 4: the banner goes in, and the cheer (-1 = none). */
  cheerAt: number;
  plantAt: number;
  /** Tier 1, 2: the troops turn for home (-1 = none). */
  homeAt: number;
  /** The Knockout's slow-mo dip (null otherwise): the one clock eases down and back, never 0. */
  dip: KoDip | null;
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  dim: number;
}

export function warhostKind(tier: TierNum): WarhostKind { return tier === 1 ? 'spear' : tier === 2 ? 'archers' : tier === 3 ? 'cavalry' : 'host'; }

/** Rows of a filled wedge holding `n` riders (1, 2, 3, ...; the last row takes what is left). */
export function wedgeRows(n: number): number[] {
  const rows: number[] = [];
  let left = Math.max(1, Math.round(n));
  for (let r = 1; left > 0; r++) { const k = Math.min(r, left); rows.push(k); left -= k; }
  return rows;
}

/** The whole Warhost, in base ms. Pure and deterministic. */
export function warhostPlan(input: WarhostPlanInput, c: HeroWarhostConfig = store.get()): WarhostPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays the shared Tier 4
  const kind = warhostKind(tier);
  const ko = tier === 4 && isKnockoutVariant(input);
  const L = warhostTierDials(tier, c);
  const k = (tier - 1) / 3;
  const base = {
    tier, kind, k, total, ko, shakePx: clamp(L.Shake * (ko ? KO_SHAKE : 1), 0, WARHOST_CAPS.shakePx), zoom: clamp(L.Zoom, 0, WARHOST_CAPS.zoom),
    punch: L.Punch * (ko ? 1.2 : 1), dim: L.Dim,
  };
  const none = {
    drums: [] as number[], beats: [] as number[], drummers: 0, hornAt: -1, tripAt: -1, upAt: -1, lostAt: -1, turnAt: -1, backAt: -1, lateAt: -1,
    mages: 0, mageAt: -1, bickerAt: -1, bickerEnd: -1, runeAt: -1, spells: [] as WarhostSpellPlan[], cryAt: -1, lands: [] as number[], volleys: [] as number[],
    hits: [] as number[], buffets: [] as number[], cheerAt: -1, plantAt: -1, homeAt: -1, dip: null,
  };
  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const at = r.impactAt;
    return {
      ...base, ...none, reduced: true, chargeAt: at, absorbEnd: at, marchAt: at, arriveAt: at, looseAt: at, troops: 0, impactAt: at, passAt: at,
      endAt: r.endAt, shakePx: 0, zoom: 0, punch: 0, dim: 0,
    };
  }
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const marchAt = chargeAt + Math.max(60, L.ReadyMs);
  const out: WarhostPlan = {
    ...base, ...none, reduced: false, chargeAt, absorbEnd, marchAt, arriveAt: marchAt, looseAt: marchAt, troops: 1, impactAt: marchAt, passAt: marchAt, endAt: marchAt,
  };
  const flight = (school: WarhostSchool): number => (school === 'bolt' ? WARHOST_BOLT_MS : Math.max(160, warhostLegMs(input.distance, c.spellMs)));
  if (kind === 'spear') {
    // THE EAGER RECRUIT: he sprints out, trips flat on his face a little way out, lies there, scrambles up and carries on.
    const run = Math.max(60, L.MarchMs);
    out.tripAt = marchAt + Math.round(run * 0.42);
    out.upAt = out.tripAt + Math.max(120, c.tripMs);
    out.arriveAt = marchAt + run + (out.upAt - out.tripAt);
    out.looseAt = out.arriveAt + Math.max(60, L.HoldMs);
    out.impactAt = out.looseAt + Math.max(80, warhostLegMs(input.distance, L.FlightMs));
    out.passAt = out.impactAt;
    out.cheerAt = out.impactAt + 110;
    out.homeAt = out.cheerAt + Math.max(0, c.cheerMs);
    out.endAt = Math.max(out.impactAt + L.SettleMs, out.homeAt + 200);
  } else if (kind === 'archers') {
    const n = Math.round(clamp(L.Troops, 2, WARHOST_CAPS.archers));
    const per = Math.round(clamp(c.arrowsPer, 1, 3));
    out.troops = n;
    out.arriveAt = marchAt + L.MarchMs;
    out.looseAt = out.arriveAt + Math.max(80, L.HoldMs);
    const first = out.looseAt + Math.max(120, warhostLegMs(input.distance, L.FlightMs));
    for (let i = 0; i < n * per; i++) out.lands.push(first + i * Math.max(0, c.patterMs) + (Math.floor(i / n) * WARHOST_RELOAD_MS));
    const lastLine = out.lands[out.lands.length - 1]!;
    // THE ONE WHO RAN THE WRONG WAY: lost behind the hero while the line draws and looses, then "Wait for me!", a
    // sprint back into the line, and the LAST arrow (a golden one) is his: the blow.
    out.lostAt = out.arriveAt - 40;
    out.turnAt = Math.max(out.arriveAt + 220, lastLine - 440);
    out.backAt = Math.max(out.turnAt + 280, lastLine - 120);
    out.lateAt = Math.max(out.backAt + 150, lastLine + 130);
    out.impactAt = out.lateAt + Math.max(120, Math.round(warhostLegMs(input.distance, L.FlightMs) * 0.8));
    out.lands.push(out.impactAt);
    out.hits = [...new Set(out.lands.filter((t) => t < out.impactAt))];
    out.passAt = out.impactAt;
    out.cheerAt = out.impactAt + 90;
    out.homeAt = out.impactAt + 380;
    out.endAt = Math.max(out.impactAt + L.SettleMs, out.homeAt + 260);
  } else if (kind === 'cavalry') {
    const n = Math.round(clamp(L.Troops, 3, WARHOST_CAPS.riders));
    out.troops = n;
    out.hornAt = chargeAt;
    out.impactAt = marchAt + Math.max(160, warhostLegMs(input.distance, L.MarchMs));
    out.arriveAt = out.impactAt;
    out.cryAt = marchAt;
    const rows = wedgeRows(n).length;
    for (let r = 1; r < rows; r++) out.buffets.push(out.impactAt + r * c.rowMs);
    out.passAt = out.impactAt + (rows - 1) * c.rowMs;
    // THE MAGES: two pop out during the horn, bicker over who casts, then both do: a fireball and a lightning bolt,
    // landing one after the other just before the point rider.
    out.mages = Math.round(clamp(c.mages3, 0, 2));
    if (out.mages > 0) {
      out.mageAt = chargeAt + 60;
      out.runeAt = marchAt - 110;
      if (out.mages >= 2 && c.bickerMs > 0) { out.bickerAt = out.mageAt + 330; out.bickerEnd = Math.max(out.bickerAt + 120, Math.min(out.runeAt - 30, out.bickerAt + c.bickerMs)); }
      const schools: WarhostSchool[] = ['fire', 'bolt'];
      const lands = [out.impactAt - 170, out.impactAt - 70];
      for (let i = 0; i < out.mages; i++) {
        const school = schools[i]!;
        out.spells.push({ school, castAt: Math.max(out.runeAt + 60, lands[i]! - flight(school)), landAt: lands[i]!, mage: i, round: 1 });
      }
    }
    out.endAt = Math.max(out.impactAt + L.SettleMs, out.passAt + 300);
  } else {
    const ranks = Math.round(clamp(L.Troops, 3, WARHOST_CAPS.ranks));
    out.troops = ranks;
    // THE BUILD-UP: the drums quicken (each gap shorter than the last), the horn answers the last one, and the host
    // sets out a beat after the horn starts (never before it).
    const nDrums = Math.round(clamp(c.drums, 1, WARHOST_CAPS.drums));
    let drumAt = chargeAt;
    for (let i = 0; i < nDrums; i++) { out.drums.push(drumAt); drumAt += c.drumMs * Math.max(0.3, 1 - WARHOST_DRUM_QUICKEN * i); }
    out.hornAt = out.drums[nDrums - 1]! + 70;
    out.marchAt = Math.max(marchAt, out.hornAt + 160);
    out.looseAt = out.marchAt;
    out.cryAt = out.marchAt;
    out.impactAt = out.marchAt + Math.max(200, warhostLegMs(input.distance, L.MarchMs));
    out.arriveAt = out.impactAt;
    // Every third rank is a buffet beat (a thud and a knock); the dust and the shudder run the whole trample.
    for (let r = 3; r < ranks; r += 3) out.buffets.push(out.impactAt + r * c.rankMs);
    out.passAt = out.impactAt + (ranks - 1) * c.rankMs;
    // THE SKY DARKENED BY ARROWS: up to four volleys, two before the blow and the rest over the trample.
    const nVolleys = c.hostArrows > 0 ? Math.round(clamp(c.volleys, 0, WARHOST_CAPS.volleys)) : 0;
    const span = out.passAt - out.impactAt;
    const volleyAt = [out.impactAt - 470, out.impactAt - 90, out.impactAt + Math.min(260, span * 0.4), out.impactAt + Math.min(520, span * 0.8)];
    out.volleys = volleyAt.slice(0, nVolleys);
    // THE DRUM LINE: the war drums, then the marching beat under the host.
    out.drummers = Math.round(clamp(c.drummers, 0, WARHOST_CAPS.drummers));
    out.beats = [...out.drums];
    for (let t = out.marchAt; t < out.passAt - 80; t += WARHOST_MARCH_BEAT_MS) out.beats.push(t);
    // THE MAGES: they pop out during the drums, two of them squabble until the horn, then their circles flare and they
    // let fly: a first round landing over the last moments of the charge, a second round ALL landing on the blow.
    out.mages = Math.round(clamp(c.mages4, 0, WARHOST_CAPS.mages));
    if (out.mages > 0) {
      out.mageAt = chargeAt + 120;
      out.runeAt = out.hornAt + 40;
      if (out.mages >= 2 && c.bickerMs > 0) { out.bickerAt = out.mageAt + 340; out.bickerEnd = Math.max(out.bickerAt + 120, Math.min(out.hornAt, out.bickerAt + c.bickerMs)); }
      const spread = out.mages > 1 ? 250 / (out.mages - 1) : 0;
      for (let round = 1; round <= 2; round++) {
        for (let i = 0; i < out.mages; i++) {
          const school = SCHOOLS[i % SCHOOLS.length]!;
          const landAt = round === 1 ? Math.round(out.impactAt - WARHOST_BARRAGE_MS + i * spread) : out.impactAt;
          out.spells.push({ school, castAt: Math.max(out.runeAt + 40, landAt - flight(school)), landAt, mage: i, round });
        }
      }
    }
    // THE CATAPULT: a flaming boulder lobbed from off screen as the host sets out, landing WITH the front rank.
    if (c.boulder >= 1) out.spells.push({ school: 'rock', castAt: out.marchAt + 40, landAt: out.impactAt, mage: -1, round: 2 });
    // THE STRAGGLER: one of the host ran the wrong way; he stops, looks about, and chases the host across.
    out.lostAt = out.marchAt + 380;
    out.turnAt = Math.max(out.lostAt + 240, out.passAt - 560);
    out.plantAt = out.passAt + Math.max(0, c.dustMs);
    out.cheerAt = out.plantAt + 200;
    out.endAt = out.plantAt + Math.max(200, c.bannerMs) + L.SettleMs;
    if (ko) out.dip = { at: out.impactAt, lo: KO_DIP.lo, ms: KO_DIP.ms };
  }
  return out;
}

export type WarhostCueKind =
  | 'charge' | 'drum' | 'mages' | 'horn' | 'bicker' | 'rune' | 'march' | 'cry' | 'trip' | 'up' | 'arrive' | 'lost' | 'loose' | 'turn' | 'cast' | 'volley'
  | 'hit' | 'late' | 'spell' | 'impact' | 'buffet' | 'cheer' | 'pass' | 'plant' | 'home' | 'end';
export interface WarhostCue { at: number; kind: WarhostCueKind; i: number }

/** Tier 4: a volley leaves this long before it lands. */
export const WARHOST_VOLLEY_MS = 560;

const CUE_ORDER: Record<WarhostCueKind, number> = {
  charge: 0, drum: 1, mages: 2, horn: 3, bicker: 4, rune: 5, march: 6, cry: 7, trip: 8, up: 9, arrive: 10, lost: 11, loose: 12, turn: 13, cast: 14, volley: 15,
  hit: 16, late: 17, impact: 18, spell: 19, buffet: 20, cheer: 21, pass: 22, plant: 23, home: 24, end: 25,
};

export function warhostCues(p: WarhostPlan): WarhostCue[] {
  const out: WarhostCue[] = [];
  const add = (at: number, kind: WarhostCueKind, i = 0): void => { if (at >= 0) out.push({ at, kind, i }); };
  if (!p.reduced) {
    add(p.chargeAt, 'charge');
    p.drums.forEach((at, i) => add(at, 'drum', i));
    if (p.mages > 0) add(p.mageAt, 'mages');
    add(p.hornAt, 'horn');
    add(p.bickerAt, 'bicker');
    if (p.mages > 0) add(p.runeAt, 'rune');
    add(p.marchAt, 'march');
    add(p.cryAt, 'cry');
    add(p.tripAt, 'trip');
    add(p.upAt, 'up');
    if (p.kind === 'spear' || p.kind === 'archers') { add(p.arriveAt, 'arrive'); add(p.looseAt, 'loose'); }
    add(p.lostAt, 'lost');
    add(p.turnAt, 'turn');
    add(p.lateAt, 'late');
    p.spells.forEach((sp, i) => { add(sp.castAt, 'cast', i); add(sp.landAt, 'spell', i); });
    p.volleys.forEach((at, i) => add(at - WARHOST_VOLLEY_MS, 'volley', i));
    p.hits.forEach((at, i) => add(at, 'hit', i));
    p.buffets.forEach((at, i) => add(at, 'buffet', i));
    add(p.cheerAt, 'cheer');
    if (p.kind === 'cavalry' || p.kind === 'host') add(p.passAt, 'pass');
    add(p.plantAt, 'plant');
    add(p.homeAt, 'home');
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  return out.sort((a, b) => a.at - b.at || CUE_ORDER[a.kind] - CUE_ORDER[b.kind] || a.i - b.i);
}

/** The Knockout's slow-mo dip (the shared one: a smooth ramp, never 0; R-PROG-ATTACK-10). 1 on every other look. */
export function warhostScale(p: WarhostPlan, t: number): number { return p.reduced ? 1 : koTimeScale(p.dip, t); }
export function warhostSlowExtraMs(p: WarhostPlan): number { return p.reduced ? 0 : koDipExtraMs(p.dip); }

// ─── the staging (pure) ────────────────────────────────────────────────────────────────────────────────────────

export type Box = { x: number; y: number; w: number; h: number };

export type TroopUnit = 'spear' | 'archer' | 'cav' | 'inf' | 'bearer' | 'cheerer' | 'mage' | 'drummer';

const NO_CASTS: readonly number[] = [];

/**
 * One soldier's whole script: he appears at `p0` (`t0`), travels to `p1` (`t1`), holds there until `t2`, travels to
 * `p2` (`t3`) and is gone. A `through` soldier never holds (`t1 === t2`) and keeps one steady pace over both legs.
 * A DETOUR on the way out (`via`): he reaches it at `tv0`, is stuck there until `tv1` (tripped flat on his face, or
 * lost and looking about), then carries on to `p1`.
 */
export interface Troop {
  unit: TroopUnit;
  p0: Pt; p1: Pt; p2: Pt;
  t0: number; t1: number; t2: number; t3: number;
  through: boolean;
  via: Pt | null; tv0: number; tv1: number; viaKind: 'trip' | 'lost' | null;
  /** Holding: the wind-up or the draw starts (`actAt`), the first and the last release, the cheer (-1 = none). */
  actAt: number; looseAt: number; lastLooseAt: number; cheerAt: number;
  /** A mage: his school (the colour of his rune circle), the moments he casts, and when he bickers (facing `argueFace`). */
  school: WarhostSchool | null;
  casts: readonly number[];
  bickerAt: number; bickerEnd: number; argueFace: 1 | -1;
  /** His stride's offset (ms), his size (x), his shade (0 = full colour, toward 1 = darker: the rear ranks). */
  phase: number; size: number; shade: number;
  /** Which way he faces while holding (1 = right). */
  face: 1 | -1;
  /** A dust puff every this many ms while he moves (0 = none). */
  dustMs: number;
  /** Draw order (bigger = nearer the viewer). */
  z: number;
}

/** A spear or an arrow: it flies `from` to `to` over a lifted arc, lands at `t1`, sits there and fades from `fadeAt`. */
export interface Shot {
  kind: 'spear' | 'arrow';
  from: Pt; ctrl: Pt; to: Pt;
  t0: number; t1: number; fadeAt: number;
  /** It sticks in the struck PORTRAIT (and rides its knockback); otherwise it sticks in the ground. */
  stick: boolean;
  /** How it sits once stuck: a turn off its landing angle (rad), and how hard it twangs. */
  lean: number; twang: number;
  size: number;
  /** It leaves a glowing trail in the air; a GOLD one (Tier 2's last arrow) glows gold and glints. */
  trail: boolean; gold: boolean;
}

/**
 * A spell (or the boulder): it leaves the caster's staff tip `from` at `t0` and lands on `to` at `t1` over a lifted
 * arc through `ctrl` (lightning goes straight and stays lit for a moment after it strikes). `caster`: the mage's index
 * in the troops (-1: the catapult, off screen).
 */
export interface Spell {
  school: WarhostSchool;
  from: Pt; ctrl: Pt; to: Pt;
  t0: number; t1: number;
  size: number;
  caster: number;
  round: number;
  /** A seed for its own flicker (lightning's forks), so a replay forks the same. */
  seed: number;
}

/**
 * A banner: it rises at `at` from `t0`, flies until `t1` and is gone by `t2`. `follow`: it stands on the struck
 * portrait and rides its knockback. `carrier`: until `t0` it is carried by that troop (an index into the troops).
 */
export interface Banner { at: Pt; t0: number; t1: number; t2: number; size: number; follow: boolean; carrier: number; lean: number }

export interface WarhostStage {
  /** Striker to struck, its left-hand normal, and which way the host faces (1 = right). */
  u: Pt; n: Pt; face: 1 | -1;
  troops: Troop[];
  shots: Shot[];
  spells: Spell[];
  banners: Banner[];
  /** Tier 4: every strike of the drum line. */
  beats: readonly number[];
  /** Where the blow lands on the struck portrait (the spear's point; the arrows scatter round it). */
  strike: Pt;
}

/** How far in from the struck portrait's centre the spear sticks (radii): on the face, clear of what sits on the rim. */
export const WARHOST_STRIKE_IN = 0.4;

/** How far from `p` along `dir` the box's edge is (0 when already outside). */
export function rayExit(p: Pt, dir: Pt, b: Box): number {
  let t = Infinity;
  if (dir.x > 1e-6) t = Math.min(t, (b.x + b.w - p.x) / dir.x); else if (dir.x < -1e-6) t = Math.min(t, (b.x - p.x) / dir.x);
  if (dir.y > 1e-6) t = Math.min(t, (b.y + b.h - p.y) / dir.y); else if (dir.y < -1e-6) t = Math.min(t, (b.y - p.y) / dir.y);
  return Number.isFinite(t) ? Math.max(0, t) : 0;
}

const inBox = (p: Pt, b: Box | undefined, m: number): Pt => (b ? { x: clamp(p.x, b.x + m, b.x + b.w - m), y: clamp(p.y, b.y + m, b.y + b.h - m) } : p);

/**
 * The control point of a lifted arc (a throw goes UP the screen and comes down). The apex sits half the control's lift
 * above the chord's middle: the lift is cut so the apex stays inside the box (but never flatter than a tenth of the chord).
 */
function arcCtrl(from: Pt, to: Pt, lift: number, b: Box | undefined, m: number): Pt {
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  const least = Math.min(lift, Math.hypot(to.x - from.x, to.y - from.y) * 0.1);
  const room = b ? (my - b.y - m) * 2 : lift;
  return { x: mx, y: my - Math.max(least, Math.min(lift, room)) };
}

/** Where each rally banner stands round the striking portrait (x in radii either side, y in radii above the centre). */
const RALLY_X = [0, -1, 1, -0.55, 0.55] as const;
const RALLY_Y = [0.78, 0.18, 0.18, 0.62, 0.62] as const;
/** Where each soldier who stays stands round the planted banner: [side, x in radii, y in radii]. */
const CHEER_SPOTS = [[1, 0.8, 0.8], [-1, 1.25, 0.5], [1, 1.3, 0.45], [-1, 0.75, 0.95], [1, 1.7, 0.75], [-1, 1.7, 0.8], [1, 0.3, 1.05]] as const;

const troop = (unit: TroopUnit, o: Partial<Troop> & Pick<Troop, 'p0' | 'p1' | 'p2' | 't0' | 't1' | 't2' | 't3'>): Troop => ({
  unit, through: false, via: null, tv0: -1, tv1: -1, viaKind: null, actAt: -1, looseAt: -1, lastLooseAt: -1, cheerAt: -1, school: null, casts: NO_CASTS,
  bickerAt: -1, bickerEnd: -1, argueFace: 1, phase: 0, size: 1, shade: 0, face: 1, dustMs: 0, z: o.p1.y, ...o,
});

/**
 * Stage the whole look: every soldier, shot, spell and banner, from the two portrait points. `s` is the stage scale
 * (every px dial is multiplied by it), `bounds` the screen (or the sandbox box), `seed` rolls the jitter. Pure.
 */
export function warhostStage(p: WarhostPlan, a: Pt, d: Pt, radius: number, aRadius: number, c: HeroWarhostConfig, s = 1, seed = 1, bounds?: Box): WarhostStage {
  const L = Math.hypot(d.x - a.x, d.y - a.y) || 1;
  const u = { x: (d.x - a.x) / L, y: (d.y - a.y) / L };
  const n = { x: -u.y, y: u.x };
  const face: 1 | -1 = a.x > d.x ? -1 : 1;
  // The blow lands ON the struck portrait's face, on the striker's side but swung toward the TOP of the portrait: the
  // hit number is drawn straight down the line between the heroes and the health plate sits under the portrait, and the
  // spear must not hide behind either. Well inside the rim: the lobby rail's orbs sit ON the rim of a corner portrait.
  const swing = (ang: number): Pt => ({ x: d.x + (-u.x * Math.cos(ang) + u.y * Math.sin(ang)) * radius * WARHOST_STRIKE_IN, y: d.y + (-u.x * Math.sin(ang) - u.y * Math.cos(ang)) * radius * WARHOST_STRIKE_IN });
  const sA = swing(0.8), sB = swing(-0.8);
  const strike = sA.y <= sB.y ? sA : sB;
  const stage: WarhostStage = { u, n, face, troops: [], shots: [], spells: [], banners: [], beats: p.beats, strike };
  if (p.reduced) return stage;
  const rnd = seededRng(seed);
  const jit = (amp: number): number => (rnd() - 0.5) * 2 * amp;
  const at = (o: Pt, along: number, lat: number): Pt => ({ x: o.x + u.x * along + n.x * lat, y: o.y + u.y * along + n.y * lat });
  /** `r` from `o`, turned `ang` radians off the way to the target. */
  const around = (o: Pt, r: number, ang: number): Pt => at(o, Math.cos(ang) * r, Math.sin(ang) * r);
  const m = 30 * s;
  const door = at(a, aRadius * 0.55, 0); // where a soldier steps out from under the striking portrait
  // Never further out than a third of the way: the spearman and the archers stay the striker's men.
  const standAlong = Math.min(aRadius + c.standPx * s, L * 0.4);
  const v = L / Math.max(1, p.impactAt - p.marchAt); // the charge's pace (px per ms)
  const back = bounds ? Math.min(rayExit(a, { x: -u.x, y: -u.y }, bounds) + 80 * s, L * 0.5) : L * 0.3;
  const fore = bounds ? rayExit(d, u, bounds) + 120 * s : L * 0.6;

  /** The mages (Tier 3, Tier 4): each pops out of the striker to his spot and stands on his rune circle. */
  const mageTip = (spot: Pt, k: number): Pt => ({ x: spot.x + face * WARHOST_MAGE_TIP.cast.x * k, y: spot.y + WARHOST_MAGE_TIP.cast.y * k });
  const mages = (spots: Pt[], leaveAt: number): number[] => {
    const idx: number[] = [];
    const kPx = (c.soldierPx / WARHOST_FOOT_H) * WARHOST_MAGE_SIZE * s;
    spots.forEach((spot, i) => {
      const mine = p.spells.filter((sp) => sp.mage === i);
      const arguing = i < 2 && p.bickerAt >= 0;
      const other = spots[i === 0 ? 1 : 0] ?? spot;
      const t0 = p.mageAt + i * 70;
      stage.troops.push(troop('mage', {
        p0: door, p1: spot, p2: spot, t0, t1: t0 + 260, t2: leaveAt - 200, t3: leaveAt, face, school: mine[0]?.school ?? SCHOOLS[i % SCHOOLS.length]!,
        casts: mine.map((sp) => sp.castAt), bickerAt: arguing ? p.bickerAt : -1, bickerEnd: arguing ? p.bickerEnd : -1,
        argueFace: other.x >= spot.x ? 1 : -1, phase: i * 90, size: WARHOST_MAGE_SIZE, cheerAt: p.impactAt + 260 + i * 60, dustMs: 90, z: 2e5 + spot.y,
      }));
      idx.push(stage.troops.length - 1);
      for (const sp of mine) {
        const from = mageTip(spot, kPx);
        const scatter = sp.round === 1 ? 0.55 : 0.3;
        const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * radius * scatter;
        const to = { x: d.x + Math.cos(ang) * rr, y: d.y + Math.sin(ang) * rr * 0.8 };
        stage.spells.push({
          school: sp.school, from, to, t0: sp.castAt, t1: sp.landAt, size: c.spellSize * (sp.round === 2 ? 1.15 : 1), caster: stage.troops.length - 1, round: sp.round,
          ctrl: sp.school === 'bolt' ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } : arcCtrl(from, to, L * (0.22 + rnd() * 0.12), bounds, m), seed: (seed + stage.spells.length * 977) >>> 0,
        });
      }
    });
    return idx;
  };

  if (p.kind === 'spear') {
    const stand = inBox(at(a, standAlong, 0), bounds, m);
    // He trips 42 % of the way out (he hits the ground running, so the fall carries him a step on).
    const fall = { x: door.x + (stand.x - door.x) * 0.42, y: door.y + (stand.y - door.y) * 0.42 };
    stage.troops.push(troop('spear', {
      p0: door, p1: stand, p2: door, t0: p.marchAt, t1: p.arriveAt, t2: p.homeAt, t3: p.endAt - 40, actAt: p.arriveAt + 50, looseAt: p.looseAt,
      lastLooseAt: p.looseAt, cheerAt: p.cheerAt, face, dustMs: 70, size: WARHOST_SPEARMAN_SIZE, via: fall, tv0: p.tripAt, tv1: p.upAt, viaKind: 'trip',
    }));
    const hand = { x: stand.x + face * 8 * s * WARHOST_SPEARMAN_SIZE, y: stand.y - c.soldierPx * s * WARHOST_SPEARMAN_SIZE };
    stage.shots.push({
      kind: 'spear', from: hand, ctrl: arcCtrl(hand, strike, L * 0.22, bounds, m), to: strike, t0: p.looseAt, t1: p.impactAt, fadeAt: p.impactAt + 520,
      stick: true, lean: 0, twang: 1, size: WARHOST_SPEARMAN_SIZE * 0.92, trail: true, gold: false,
    });
  } else if (p.kind === 'archers') {
    const N = p.troops;
    const gap = c.lineGapPx * s;
    const reload = WARHOST_RELOAD_MS;
    const per = Math.round(clamp(c.arrowsPer, 1, 3));
    const jog = Math.max(120, p.arriveAt - p.marchAt - (N - 1) * 18);
    for (let i = 0; i < N; i++) {
      // The line stands across the way to the target, each archer a touch out of true.
      const lat = (i - N / 2) * gap;
      const stand = inBox(at(a, standAlong + jit(5 * s), lat + jit(3 * s)), bounds, m);
      const t0 = p.marchAt + i * 18;
      stage.troops.push(troop('archer', {
        p0: door, p1: stand, p2: door, t0, t1: t0 + jog, t2: p.homeAt + (N - 1 - i) * 16, t3: p.endAt - 40, actAt: p.arriveAt + 30, looseAt: p.looseAt,
        lastLooseAt: p.looseAt + (per - 1) * reload, cheerAt: i === 0 ? p.cheerAt : -1, face, dustMs: 110, phase: rnd() * 400, size: WARHOST_ARCHER_SIZE * (0.95 + rnd() * 0.1),
      }));
    }
    // THE ONE WHO RAN THE WRONG WAY: out of the door and off past the FAR end of the line (the hero sits in a corner, so
    // "behind him" is off screen), lost there, then all the way back along the line to its other end.
    const lost = inBox(at(a, aRadius * 0.35, -(N / 2 + 2.2) * gap), bounds, m);
    const slot = inBox(at(a, standAlong + jit(5 * s), (N / 2) * gap), bounds, m);
    stage.troops.push(troop('archer', {
      p0: door, p1: slot, p2: door, t0: p.marchAt + 30, t1: p.backAt, t2: p.homeAt + 60, t3: p.endAt - 40, actAt: p.backAt + 20, looseAt: p.lateAt, lastLooseAt: p.lateAt,
      face, dustMs: 60, phase: 170, size: WARHOST_ARCHER_SIZE, via: lost, tv0: p.lostAt, tv1: p.turnAt, viaKind: 'lost', z: slot.y + 0.5,
    }));
    const late = stage.troops.length - 1;
    // The arrows: the line's arrow k is archer (k mod N)'s; they land in the plan's patter, scattered over the portrait.
    const bowOf = (who: Troop): Pt => ({ x: who.p1.x + face * 9 * s * WARHOST_ARCHER_SIZE, y: who.p1.y - c.soldierPx * s * WARHOST_ARCHER_SIZE * 0.85 });
    for (let k = 0; k < p.lands.length - 1; k++) {
      const who = stage.troops[k % N]!;
      const round = Math.floor(k / N);
      const bow = bowOf(who);
      const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * radius * 0.62;
      const to = { x: d.x + Math.cos(ang) * rr, y: d.y + Math.sin(ang) * rr * 0.8 };
      stage.shots.push({
        kind: 'arrow', from: bow, ctrl: arcCtrl(bow, to, L * (0.62 + rnd() * 0.16), bounds, m), to, t0: p.looseAt + round * reload + (k % N) * 6, t1: p.lands[k]!,
        fadeAt: p.impactAt + 420 + rnd() * 160, stick: true, lean: jit(0.22), twang: 0.6, size: 1.6, trail: true, gold: false,
      });
    }
    // The straggler's arrow: a GOLDEN one, flatter and faster, straight into the face. The blow.
    const bow = bowOf(stage.troops[late]!);
    stage.shots.push({
      kind: 'arrow', from: bow, ctrl: arcCtrl(bow, strike, L * 0.3, bounds, m), to: strike, t0: p.lateAt, t1: p.impactAt, fadeAt: p.impactAt + 700,
      stick: true, lean: 0, twang: 1.2, size: 2.3, trail: true, gold: true,
    });
  } else {
    // THE CHARGE (Tier 3, Tier 4): the front crosses the striker at `marchAt` and the target at `impactAt`, at one pace.
    /** A soldier who crosses the target at `cross`, `lat` off the centre line there (and `lat0` / `lat2` at the ends). */
    const runner = (unit: TroopUnit, cross: number, lat0: number, lat1: number, lat2: number, over: Partial<Troop>): Troop => {
      const p0 = at(a, -back, lat0), p1 = at(d, 0, lat1), p2 = at(d, fore, lat2);
      return troop(unit, {
        p0, p1, p2, t0: cross - (L + back) / v, t1: cross, t2: cross, t3: cross + fore / v, through: true, face, phase: rnd() * 400,
        z: p1.y - u.y * (cross - p.impactAt) * v, ...over,
      });
    };
    if (p.kind === 'cavalry') {
      const rows = wedgeRows(p.troops);
      const gapLat = c.cavalryPx * s * 0.78 * WARHOST_WEDGE_SIZE;
      // THE WHEEL. The struck portrait sits in a corner, so riding on past it left the screen at once. Instead each
      // rider goes THROUGH the portrait, turns just beyond it (still on screen) and rides HOME round the side of the
      // portrait he was on, fanning out: the wedge splits in two and comes back across the board.
      const split = rnd() < 0.5 ? -1 : 1; // which way the middle rider of an odd row turns
      const past = Math.min(radius * 0.85, fore * 0.6);
      rows.forEach((count, r) => {
        for (let j = 0; j < count; j++) {
          const lat = (j - (count - 1) / 2) * gapLat + jit(4 * s);
          const tr = runner('cav', p.impactAt + r * c.rowMs + jit(8), lat * 1.25, lat, 0, { dustMs: 55, size: (0.94 + rnd() * 0.14) * WARHOST_WEDGE_SIZE });
          const side = Math.abs(lat) < gapLat * 0.25 ? split : Math.sign(lat);
          tr.p1 = inBox(at(d, past, lat * 0.8), bounds, m);
          tr.t1 = tr.t2 = tr.t1 + past / v;
          tr.p2 = inBox(at(d, -L * (0.44 + rnd() * 0.08), side * (radius * 2.3 + Math.abs(lat) * 1.5 + r * gapLat * 0.5)), bounds, m);
          tr.t3 = tr.t2 + Math.hypot(tr.p2.x - tr.p1.x, tr.p2.y - tr.p1.y) / (v * 0.92);
          stage.troops.push(tr);
        }
      });
      // The two mages, side by side just out from the striking portrait toward the target (close enough to squabble).
      const spots: Pt[] = [];
      for (let i = 0; i < p.mages; i++) spots.push(inBox(at(a, aRadius + 95 * s, (i === 0 ? -1 : 1) * 58 * s), bounds, m));
      mages(spots, p.endAt - 30);
    } else {
      const files = Math.round(clamp(c.hostFiles, 3, WARHOST_CAPS.files));
      const W = c.hostWidthPx * s;
      const f = clamp(c.funnel, 0.2, 1);
      for (let r = 0; r < p.troops; r++) {
        for (let j = 0; j < files; j++) {
          // Ranks are staggered half a file, each man a touch out of true: a host, not a grid.
          const lat = ((j + (r % 2) * 0.5) / (files - 1 + 0.5) - 0.5) * W + jit(7 * s);
          stage.troops.push(runner('inf', p.impactAt + r * c.rankMs + jit(c.rankMs * 0.3), lat, lat * f, lat * 1.05, {
            dustMs: (r * files + j) % 5 === 0 ? 150 : 0, size: 0.9 + rnd() * 0.2, shade: Math.min(0.3, r * 0.012),
          }));
        }
      }
      // Cavalry on the flanks: a file a side, riding a little ahead of the foot.
      const flank = Math.round(clamp(c.hostCavalry, 0, WARHOST_CAPS.flank));
      for (const side of [-1, 1]) {
        for (let j = 0; j < flank; j++) {
          const lat = side * (W / 2 + c.cavalryPx * s * (0.7 + (j % 2) * 0.55)) + jit(6 * s);
          const cross = p.impactAt - 60 + (j * (p.passAt - p.impactAt)) / Math.max(1, flank) + jit(14);
          stage.troops.push(runner('cav', cross, lat, lat * (f + 0.12), lat * 1.1, { dustMs: 90, size: 0.92 + rnd() * 0.14 }));
        }
      }
      // THE STRAGGLER: out of the door the wrong way, lost behind the hero while the host goes, then a sprint after it.
      const lostAt = inBox(at(a, -(aRadius + 110 * s), -0.6 * aRadius), bounds, m);
      const cross = p.passAt + 140;
      stage.troops.push(troop('inf', {
        p0: door, p1: at(d, 0, 0), p2: at(d, fore, 0), t0: p.marchAt + 60, t1: cross, t2: cross, t3: cross + fore / v, through: true, face, via: lostAt,
        tv0: p.lostAt, tv1: p.turnAt, viaKind: 'lost', size: WARHOST_STRAGGLER_SIZE, dustMs: 60, phase: 50, z: 1e6 - 5,
      }));
      // The volleys overhead: loosed from behind the striker, raining round the target (every third one trailing).
      const arrows = Math.round(clamp(c.hostArrows, 0, WARHOST_CAPS.arrows));
      p.volleys.forEach((land, vi) => {
        for (let i = 0; i < arrows; i++) {
          const from = at(a, -aRadius * 0.6 + jit(60 * s), jit(W * 0.45));
          const ang = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * radius * 2.3;
          const to = inBox({ x: d.x + Math.cos(ang) * rr, y: d.y + Math.sin(ang) * rr * 0.7 }, bounds, 8 * s);
          const t1 = land + i * 11 + vi * 4;
          stage.shots.push({
            kind: 'arrow', from, ctrl: arcCtrl(from, to, L * (0.5 + rnd() * 0.2), bounds, m), to, t0: t1 - WARHOST_VOLLEY_MS, t1,
            fadeAt: p.passAt + 60 + rnd() * 200, stick: rr < radius * 0.8, lean: jit(0.25), twang: 0.5, size: 1.4, trail: i % 3 === 0, gold: false,
          });
        }
      });
      // The banners rising behind the striking hero, one a drum.
      const end = p.impactAt + 140;
      p.drums.forEach((drum, i) => {
        // Round the striking portrait's rim: one at its crown, one at each shoulder, then more between them (kept on
        // screen).
        const sx = RALLY_X[i % RALLY_X.length]!, sy = RALLY_Y[i % RALLY_Y.length]!;
        const foot = { x: a.x + sx * aRadius * 0.92, y: a.y - aRadius * sy };
        stage.banners.push({
          at: inBox(foot, bounds, 26 * s), t0: drum + 30, t1: end + i * 60, t2: end + 260 + i * 60, size: i === 0 ? 1.7 : 1.4,
          follow: false, carrier: -1, lean: sx * 0.07,
        });
      });
      // THE DRUM LINE: either side of the striking hero (beside the mages' arc), beating the drums and then the march.
      for (let j = 0; j < p.drummers; j++) {
        const side = j % 2 ? 1 : -1, row = Math.floor(j / 2);
        const spot = inBox(around(a, aRadius + 34 * s, side * (1.75 + row * 0.38)), bounds, m);
        const t0 = Math.max(0, p.chargeAt - 220) + j * 40;
        stage.troops.push(troop('drummer', {
          p0: spot, p1: spot, p2: spot, t0, t1: t0 + 1, t2: p.plantAt + 80, t3: p.plantAt + 260, face, phase: j * 37, size: WARHOST_DRUMMER_SIZE, z: 2e5 + spot.y,
        }));
      }
      // THE MAGES: an arc round the striker, fanned toward the target (staggered in and out a little).
      const spots: Pt[] = [];
      for (let i = 0; i < p.mages; i++) {
        const fr = p.mages === 1 ? 0 : i / (p.mages - 1) - 0.5;
        spots.push(inBox(around(a, aRadius + (60 + (i % 2) * 46) * s, fr * 2.5), bounds, m));
      }
      mages(spots, p.plantAt + 300);
      // THE CATAPULT'S BOULDER: lobbed from off screen behind the striker, its top just under the top of the screen.
      for (const sp of p.spells) {
        if (sp.school !== 'rock') continue;
        const from = at(a, -(back + 150 * s), 0);
        stage.spells.push({
          school: 'rock', from, ctrl: arcCtrl(from, d, L * 0.9, bounds, m), to: { x: d.x, y: d.y }, t0: sp.castAt, t1: sp.landAt, size: c.spellSize,
          caster: -1, round: 2, seed: (seed + 31337) >>> 0,
        });
      }
      // The one who stays: he comes in behind the last rank, stops beside the struck portrait and plants the banner on
      // it. He is TINY next to it.
      const side = face;
      const post = inBox({ x: d.x - side * radius * 0.78, y: d.y + radius * 0.72 }, bounds, m);
      const from = at(d, -L * 0.42, 0);
      const bearer = troop('bearer', {
        p0: from, p1: post, p2: post, t0: p.plantAt - 60 - (L * 0.42) / v, t1: p.plantAt - 60, t2: p.endAt - 180, t3: p.endAt - 20, actAt: p.plantAt, looseAt: p.plantAt,
        lastLooseAt: p.plantAt, cheerAt: p.cheerAt, face: side as 1 | -1, dustMs: 80, size: WARHOST_BEARER_SIZE, z: 1e6,
      });
      stage.troops.push(bearer);
      const bearerIdx = stage.troops.length - 1;
      const flyEnd = p.endAt - 200;
      // A BIG banner: the planting is a beat of its own. It stands on the portrait; under a portrait at the top of the
      // screen there is no room for it above, so its foot drops to the portrait's lower edge and it is drawn as tall as
      // fits (never off the top of the view).
      const tall = c.soldierPx * WARHOST_BANNER_TALL * s;
      const top = bounds ? bounds.y + 10 * s : -Infinity;
      let footY = d.y + radius * 0.35;
      if (footY - tall * WARHOST_PLANT_SIZE < top) footY = Math.min(d.y + radius * 0.95, top + tall * WARHOST_PLANT_SIZE);
      const plantSize = Math.min(WARHOST_PLANT_SIZE, Math.max(1, (footY - top) / tall));
      stage.banners.push({ at: { x: d.x, y: footY }, t0: p.plantAt, t1: flyEnd, t2: p.endAt - 20, size: plantSize, follow: true, carrier: bearerIdx, lean: 0 });
      // The ones who stay and cheer round the banner (more of them on THE KNOCKOUT).
      const stay = p.ko ? WARHOST_KO_CHEERERS : WARHOST_CHEERERS;
      for (let i = 0; i < stay; i++) {
        const [sd, kx, ky] = CHEER_SPOTS[i % CHEER_SPOTS.length]!;
        const spot = inBox({ x: d.x + sd * side * radius * kx, y: d.y + radius * ky }, bounds, m);
        const lag = Math.min(i, 4) * 45;
        stage.troops.push(troop('cheerer', {
          p0: at(d, -L * 0.36, jit(40 * s)), p1: spot, p2: spot, t0: p.plantAt - 40 - (L * 0.36) / v + lag, t1: p.plantAt - 20 + lag, t2: p.endAt - 180, t3: p.endAt - 20,
          cheerAt: p.cheerAt + 40 + (i % 4) * 70, face: (sd * side > 0 ? -1 : 1) as 1 | -1, dustMs: 90, phase: i * 130, size: 1.45, z: 1e6 + 1 + i,
        }));
      }
    }
  }
  return stage;
}

export type TroopState = 'wait' | 'out' | 'hold' | 'back' | 'trip' | 'lost' | 'gone';
export interface TroopAt { x: number; y: number; state: TroopState; alpha: number; dir: number }

/** A lost soldier looks one way, then the other, this often. */
export const WARHOST_LOOK_MS = 190;

/** Where a soldier is at `t` (written into `out`: no allocation on the frame path). `dir` is which way he travels (x). */
export function troopAt(tr: Troop, t: number, out: TroopAt): TroopAt {
  if (t < tr.t0) { out.state = 'wait'; out.x = tr.p0.x; out.y = tr.p0.y; out.alpha = 0; out.dir = tr.face; return out; }
  if (t >= tr.t3) { out.state = 'gone'; out.x = tr.p2.x; out.y = tr.p2.y; out.alpha = 0; out.dir = tr.face; return out; }
  const fadeIn = clamp01((t - tr.t0) / 120);
  // A soldier who ends where he stands (the banner bearer) fades in place; one who leaves fades as he goes.
  const fadeOut = clamp01((tr.t3 - t) / 150);
  out.alpha = Math.min(fadeIn, fadeOut);
  if (t < tr.t1) {
    let from = tr.p0, to = tr.p1, t0 = tr.t0, t1 = tr.t1, brake = !tr.through;
    if (tr.via) {
      if (t < tr.tv0) { to = tr.via; t1 = tr.tv0; brake = tr.viaKind !== 'trip'; } // a man about to trip is running flat out
      else if (t < tr.tv1) {
        out.x = tr.via.x; out.y = tr.via.y;
        if (tr.viaKind === 'trip') { out.state = 'trip'; out.dir = Math.abs(tr.via.x - tr.p0.x) > 2 ? Math.sign(tr.via.x - tr.p0.x) : tr.face; }
        else { out.state = 'lost'; out.dir = (Math.floor((t - tr.tv0) / WARHOST_LOOK_MS) & 1) === 0 ? -tr.face : tr.face; }
        return out;
      } else { from = tr.via; t0 = tr.tv1; }
    }
    const k = (t - t0) / Math.max(1, t1 - t0);
    const e = brake ? k * (1.6 - 0.6 * k) : k; // a runner brakes into his mark
    out.x = from.x + (to.x - from.x) * e; out.y = from.y + (to.y - from.y) * e;
    out.state = 'out'; out.dir = Math.abs(to.x - from.x) > 2 ? Math.sign(to.x - from.x) : tr.face;
    return out;
  }
  if (t < tr.t2) { out.x = tr.p1.x; out.y = tr.p1.y; out.state = 'hold'; out.dir = tr.face; return out; }
  const k = (t - tr.t2) / Math.max(1, tr.t3 - tr.t2);
  const still = tr.p1.x === tr.p2.x && tr.p1.y === tr.p2.y;
  out.x = tr.p1.x + (tr.p2.x - tr.p1.x) * k; out.y = tr.p1.y + (tr.p2.y - tr.p1.y) * k;
  out.state = still ? 'hold' : tr.through ? 'out' : 'back';
  out.dir = Math.abs(tr.p2.x - tr.p1.x) > 2 ? Math.sign(tr.p2.x - tr.p1.x) : tr.face;
  return out;
}

export type ShotState = 'wait' | 'fly' | 'stuck' | 'gone';
export interface ShotAt { x: number; y: number; rot: number; state: ShotState; alpha: number }

export const SHOT_FADE_MS = 220;

/** A point on a quadratic (written into `out`). */
export function quadAt(from: Pt, ctrl: Pt, to: Pt, e: number, out: { x: number; y: number }): void {
  const mt = 1 - e;
  out.x = mt * mt * from.x + 2 * mt * e * ctrl.x + e * e * to.x;
  out.y = mt * mt * from.y + 2 * mt * e * ctrl.y + e * e * to.y;
}

/** Where a spear or an arrow is at `t` (written into `out`). Its heading follows the arc; stuck, it twangs and settles. */
export function shotAt(sh: Shot, t: number, out: ShotAt): ShotAt {
  if (t < sh.t0) { out.state = 'wait'; out.x = sh.from.x; out.y = sh.from.y; out.rot = 0; out.alpha = 0; return out; }
  if (t >= sh.fadeAt + SHOT_FADE_MS) { out.state = 'gone'; out.x = sh.to.x; out.y = sh.to.y; out.rot = 0; out.alpha = 0; return out; }
  const e = Math.min(1, (t - sh.t0) / Math.max(1, sh.t1 - sh.t0));
  const mt = 1 - e;
  // The tangent of the quadratic (at the end: the line from the control to the target).
  const tx = 2 * mt * (sh.ctrl.x - sh.from.x) + 2 * e * (sh.to.x - sh.ctrl.x);
  const ty = 2 * mt * (sh.ctrl.y - sh.from.y) + 2 * e * (sh.to.y - sh.ctrl.y);
  out.rot = Math.atan2(ty, tx);
  if (t < sh.t1) {
    quadAt(sh.from, sh.ctrl, sh.to, e, out);
    out.state = 'fly'; out.alpha = Math.min(1, (t - sh.t0) / 60);
    return out;
  }
  const since = t - sh.t1;
  out.x = sh.to.x; out.y = sh.to.y;
  out.rot += sh.lean + 0.3 * sh.twang * Math.exp(-since / 110) * Math.sin(since * 0.075);
  out.state = 'stuck'; out.alpha = t < sh.fadeAt ? 1 : 1 - (t - sh.fadeAt) / SHOT_FADE_MS;
  return out;
}

/** Lightning stays lit (flickering, re-forking) this long after it strikes. */
export const WARHOST_BOLT_HOLD_MS = 230;

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));
const sine = (u: number): number => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

/**
 * How hard the ground shakes under the charge at `t` (0..1): it starts as the charge sets out and grows all the way
 * across (the nearer the host, the harder), holds while the ranks pass, and dies as the last one leaves.
 */
export function warhostRumble(p: WarhostPlan, t: number): number {
  if (p.reduced || (p.kind !== 'host' && p.kind !== 'cavalry')) return 0;
  const k = clamp01((t - p.marchAt) / Math.max(1, p.impactAt - p.marchAt));
  const up = 0.12 * k + 0.88 * k * k;
  const down = 1 - clamp01((t - p.passAt) / 320);
  return up * down;
}

/** The charge's rumble, as a share of the blow's shake (Tier 4: the whole host; Tier 3: ten horses). */
export const WARHOST_RUMBLE_AMP = { host: 0.34, cavalry: 0.24 } as const;

/**
 * The camera: a push in through the ready (held to the blow); each drum kicks it; Tier 1's faceplant thumps it; under
 * the charge it zooms a little further and PANS along with the front (see `warhostCameraFocus`) while the ground
 * rumbles harder the nearer the host comes; Tier 4 PUSHES IN on the mages' barrage; the blow punches and shakes; each
 * spell that lands early and every later row or rank kicks it again; the banner going in kicks it straight down. Pure.
 */
export function warhostCameraAt(p: WarhostPlan, c: HeroWarhostConfig, t: number, dir: Pt = { x: 1, y: 0 }): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  const charge = p.kind === 'host' || p.kind === 'cavalry';
  const pan = p.kind === 'host' ? WARHOST_PAN_ZOOM.host : p.kind === 'cavalry' ? WARHOST_PAN_ZOOM.cavalry : 0;
  const push = p.kind === 'host' && p.mages > 0 ? WARHOST_BARRAGE_PUSH : 0;
  let z = 0;
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * sine((t - p.chargeAt) / Math.max(1, p.marchAt - p.chargeAt));
    if (charge) z += pan * sine((t - p.marchAt) / Math.max(1, p.impactAt - p.marchAt));
    if (push > 0) z += push * sine((t - (p.impactAt - WARHOST_BARRAGE_MS)) / WARHOST_BARRAGE_MS);
  } else if (t >= p.impactAt) z += (p.zoom + pan + push + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => { const s = springAt(t - at, hz, tau); x += dir.x * amp * s; y += dir.y * amp * s; };
  // Each drum thumps the view (harder as they quicken); the banner going in kicks it straight down.
  for (let i = 0; i < p.drums.length; i++) { const at = p.drums[i]!; kick(at, -p.shakePx * (0.14 + 0.03 * i), 50, 12); z += p.zoom * 0.25 * Math.max(0, springAt(t - at, 5, 70)); }
  for (const at of p.hits) kick(at, p.shakePx * 0.12, 30, 20);
  for (const sp of p.spells) if (sp.landAt < p.impactAt) kick(sp.landAt, p.shakePx * 0.22, 45, 17);
  // The faceplant: a little thump straight down.
  if (p.tripAt >= 0) y += p.shakePx * 0.5 * springAt(t - (p.tripAt + 80), 14, 45);
  kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / (charge ? 3 : 4)), charge ? 13 : 16);
  for (const at of p.buffets) kick(at, p.shakePx * 0.38, 55, 15);
  if (p.plantAt >= 0) { const sp = springAt(t - p.plantAt, 11, 70); y += p.shakePx * 0.42 * sp; z += p.punch * 0.4 * Math.max(0, sp); }
  const r = warhostRumble(p, t);
  if (r > 0) {
    const amp = p.shakePx * (p.kind === 'host' ? WARHOST_RUMBLE_AMP.host : WARHOST_RUMBLE_AMP.cavalry) * r;
    x += amp * Math.sin(t * 0.087) * Math.sin(t * 0.023 + 0.6); y += amp * Math.sin(t * 0.131 + 1.3);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * The anchor: the striker through the ready; Tier 1, 2 glide to the struck hero as the shot goes; Tier 3, 4 PAN with
 * the front of the charge (the point the view is held on travels with it), so the host is followed across the board;
 * then the struck hero.
 */
export function warhostCameraFocus(p: WarhostPlan, t: number, a: Pt, d: Pt): Pt {
  if (t <= p.marchAt) return a;
  if (p.kind === 'spear' || p.kind === 'archers') {
    const to = p.kind === 'archers' && p.lateAt >= 0 ? p.lateAt : p.looseAt;
    if (t < to) { const e = sine((t - p.marchAt) / Math.max(1, to - p.marchAt)); return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e }; }
    return d;
  }
  if (t < p.impactAt) {
    const k = (t - p.marchAt) / Math.max(1, p.impactAt - p.marchAt);
    const e = 0.5 * k + 0.5 * sine(k); // the front's pace, eased in a little so the pan starts gently
    return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
  }
  return d;
}
