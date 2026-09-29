/**
 * THE ENRAGED STRIKE HERO ATTACK: its tuned values, its pure timeline, the hero's pure pose and the pure camera.
 *
 * Owner 2026-09-28: "branch off and make one more animation, which is just a legendary version of this strike. it should
 * be a 10x more exciting and oomphier more impactful and pixi animation dense attack animation, but basically a legendary
 * version of this attack, just amplified or enraged." ("this strike" = Classic, the hero portrait's own lunge.)
 *
 * Polish passes, owner 2026-09-28: "the enrage animations kinda meh, can you polish it up"; then "the multi attack ones
 * need to feel more impactful when they reel back, let them fly back in and impact each time. the final hit's entire
 * animation stinks, please fully redo the huge animation for enrage"; then "enrage is much better."
 *
 * So the SILHOUETTE is Classic's (the portrait winds up by pulling back along the line and swelling, then drives at the
 * foe, clacks, and springs home) and every beat is amplified. THE BEATS (base ms before the speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. WINDUP. The total dives into the hero; the portrait pulls back and swells while a rage aura (a crown of fire off
 *     the upper rim, a hot rim, a halo) ignites round it, hot streaks are pulled in, a growl rises and the portrait
 *     trembles harder and harder, peaking in the RAGE BURST (a flare, heat rings tearing off the rim, a roar).
 *  3. LUNGE. Classic's strike (it hangs, then blurs) leaving crisp afterimages, a slim rage streak, a scorch skid and
 *     speed lines. It STOPS AT THE STRUCK PORTRAIT'S RIM (never over its face), so every hit reads on contact.
 *  4. STRIKE. A white flash, a crisp shock rim, claw rips raked across the foe, glowing cracks on its rim, sparks that
 *     bounce back into view, a camera punch, the foe knocked back and squashed, the striker squashed against it.
 *  5. THE COMBO (II, III, IV). Every hit is a FULL CYCLE: a hard RECOIL off the foe (stretched), a COIL (squashed,
 *     trembling), a drive back in with its own streak and afterimages, and its own impact, each harder than the last.
 *     II is a double; III a combo of three, the last a finisher after a deeper wind; IV a RAMPAGE of five slams that
 *     come faster and faster, then the HAYMAKER: the hero REARS BACK way up over the board at the peak of its rage (the
 *     flames tower, the biggest roar, a dark ring of pressure closing in) and brings an overhead blow DOWN on an arc
 *     onto the foe: a giant flaming crescent, a screen-filling rage shockwave, molten cracks round the foe, rubble and
 *     an ember storm, the strongest camera punch. Every strike before the last is a TICK (FX and sound only).
 *  6. RECOVER. The hero springs home trailing embers and wisps; the foe smoulders.
 *
 * THE CONSEQUENCE (the damage, Armor, Resolve) lands exactly ONCE, on the LAST strike (IV: the haymaker). The big `-N`
 * lands there too. TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+).
 *
 * Tuner convention (the others'): localStorage in DEV only, values clamped on write and on load; production always plays
 * DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { gsap } from 'gsap';
import type { SwingTimes } from '../heroAttack/classicConfig';
import type { ClassicSwing } from '../heroAttack/heroClassic';
import { clamp, clamp01, easeInOutSine, easeOutCubic, spring, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, type TierNum, attackTier, type AttackTierContext,
} from '../heroAttack/tiers';

export { TIERS, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const ENRAGED_TIER_SUFFIXES = [
  'WindupX', 'Strikes', 'DriveX', 'GapMs', 'Accel', 'FinisherMs', 'Haymaker',
  'Shake', 'Zoom', 'Punch', 'Aura', 'Sparks', 'Embers', 'Slashes', 'Burst', 'SettleMs', 'Dim',
] as const;
export type EnragedTierSuffix = (typeof ENRAGED_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${EnragedTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // Windup
  absorbMs: number;
  windupLeadMs: number;
  windupDepth: number;
  windupSwell: number;
  tiltBoost: number;
  tremblePx: number;
  // Lunge and strike
  contactStop: number;
  contactSwell: number;
  heroSquash: number;
  recoilShare: number;
  coilSquash: number;
  haymakerCoilMs: number;
  haymakerIn: number;
  haymakerLift: number;
  haymakerSwell: number;
  haymakerDriveX: number;
  crescentSize: number;
  shockSize: number;
  reboundDepth: number;
  holdMs: number;
  recoverX: number;
  // The rage burst and Tier IV's haymaker
  burstMs: number;
  burstSize: number;
  craterSize: number;
  debris: number;
  // Aura
  auraSize: number;
  flames: number;
  flameLength: number;
  motes: number;
  // Afterimages, wake and speed lines
  ghosts: number;
  ghostSpacing: number;
  ghostAlpha: number;
  ghostFadeMs: number;
  wakeWidth: number;
  wakeMs: number;
  speedLines: number;
  // Impact
  ringSize: number;
  ring2Size: number;
  slashLength: number;
  slashWidth: number;
  sparkSpeed: number;
  emberLife: number;
  flashAlpha: number;
  smoulderMs: number;
  sparkInward: number;
  rimCracks: number;
  scorch: number;
  scorchMs: number;
  emberStorm: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  shakeCap: number;
  zoomCap: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorHot: string;
  colorPlayer: string;
  colorFoe: string;
  colorShade: string;
  colorSmoke: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxRoarClip: string; sfxRoarGain: number; sfxRoarRate: number;
  sfxWindupClip: string; sfxWindupGain: number; sfxWindupRate: number;
  sfxChargeClip: string; sfxChargeGain: number; sfxChargeRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number;
  sfxSlashClip: string; sfxSlashGain: number; sfxSlashRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxPunchClip: string; sfxPunchGain: number; sfxPunchRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxHaymakerClip: string; sfxHaymakerGain: number; sfxHaymakerRate: number;
  sfxRubbleClip: string; sfxRubbleGain: number; sfxRubbleRate: number;
  sfxToneGain: number; sfxToneLowHz: number; sfxToneHighHz: number;
  sfxCrackleGain: number;
  sfxRumbleGain: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroEnragedConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_ENRAGED_COLOR_KEYS = ['colorCore', 'colorHot', 'colorPlayer', 'colorFoe', 'colorShade', 'colorSmoke'] as const;
export const HERO_ENRAGED_CLIP_KEYS = [
  'sfxRoarClip', 'sfxWindupClip', 'sfxChargeClip', 'sfxWhooshClip', 'sfxTickClip', 'sfxSlashClip', 'sfxImpactClip',
  'sfxPunchClip', 'sfxThumpClip', 'sfxBigClip', 'sfxHaymakerClip', 'sfxRubbleClip',
] as const;
type ColorKey = (typeof HERO_ENRAGED_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_ENRAGED_CLIP_KEYS)[number];
export type HeroEnragedStrKey = ColorKey | ClipKey;
export type HeroEnragedNumKey = Exclude<keyof HeroEnragedConfig, HeroEnragedStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<EnragedTierSuffix, [number, number, number, number]> = {
  WindupX: [1.25, 1.25, 1.3, 1.15],
  Strikes: [1, 2, 3, 6],
  DriveX: [1, 0.95, 0.9, 0.85],
  GapMs: [0, 250, 230, 175],
  Accel: [1, 1, 0.85, 0.8],
  FinisherMs: [0, 0, 110, 0],
  Haymaker: [0, 0, 0, 1],
  Shake: [9, 11, 14, 28],
  Zoom: [0.03, 0.035, 0.045, 0.08],
  Punch: [0.03, 0.04, 0.05, 0.1],
  Aura: [0.85, 1, 1.15, 1.5],
  Sparks: [20, 24, 32, 50],
  Embers: [12, 14, 20, 44],
  Slashes: [1, 1, 2, 1],
  Burst: [1, 1.1, 1.25, 1.75],
  SettleMs: [240, 260, 300, 200],
  Dim: [0.12, 0.2, 0.3, 0.5],
};

export const ENRAGED_TIER_RANGES: Record<EnragedTierSuffix, [number, number, number]> = {
  WindupX: [0.3, 4, 0.05],
  Strikes: [1, 8, 1],
  DriveX: [0.3, 4, 0.05],
  GapMs: [0, 600, 5],
  Accel: [0.4, 1.2, 0.01],
  FinisherMs: [0, 600, 5],
  Haymaker: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.14, 0.002],
  Aura: [0, 3, 0.05],
  Sparks: [0, 120, 1],
  Embers: [0, 120, 1],
  Slashes: [0, 3, 1],
  Burst: [0.3, 3, 0.05],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => ENRAGED_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_ENRAGED_DEFAULTS: HeroEnragedConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps every style up at the same place.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 200,
  windupLeadMs: 110,
  // THE SWING IS CLASSIC'S (`heroAttack/heroClassic.ts` classicSwing: the Lunge tuner's pull back and swell, the
  // corner-leading contact, the distance-scaled strike and its ease, the elastic settle, at Classic's tempo). These
  // amplify it: a deeper coil, a bigger swell, a harder lean, a snappier return.
  windupDepth: 1.2,
  windupSwell: 0.08,
  tiltBoost: 1.3,
  tremblePx: 3.2,
  // THE READABLE HIT (owner 2026-09-28: "the enrage animations kinda meh, can you polish it up"): Enraged stops with its
  // leading rim at the struck portrait's rim instead of Classic's corner-over-the-face contact, so the rips, the
  // cracks and the foe's knockback show ON the contact frame. Classic keeps its own contact.
  contactStop: 0.72,
  contactSwell: 0.1,
  heroSquash: 0.18,
  // THE COMBO (owner 2026-09-28: "let them fly back in and impact each time"): after each hit, the first `recoilShare` of
  // the gap is a hard recoil off the foe (stretched); the rest is the coil (a squash, a tremble), then the next drive.
  recoilShare: 0.5,
  coilSquash: 0.12,
  // THE HAYMAKER (Tier IV's knockout, owner 2026-09-28: "fully redo the huge animation"): the hero rears way back and UP
  // over the board, swollen with rage, then brings an overhead blow DOWN on an arc onto the foe.
  haymakerCoilMs: 540,
  haymakerIn: 0.12,
  haymakerLift: 0.3,
  haymakerSwell: 0.6,
  haymakerDriveX: 1.1,
  crescentSize: 1,
  shockSize: 1,
  reboundDepth: 1,
  // The striker stays planted in the foe this long after the last hit (recoiling a little off it) so the hit reads.
  holdMs: 210,
  recoverX: 0.75,
  burstMs: 190,
  burstSize: 1,
  craterSize: 1,
  debris: 12,
  auraSize: 1,
  flames: 10,
  flameLength: 1,
  motes: 14,
  ghosts: 3,
  ghostSpacing: 1.35,
  ghostAlpha: 0.65,
  ghostFadeMs: 220,
  wakeWidth: 1,
  wakeMs: 90,
  speedLines: 7,
  ringSize: 1,
  ring2Size: 1,
  slashLength: 1,
  slashWidth: 1,
  sparkSpeed: 1,
  emberLife: 1,
  flashAlpha: 0.95,
  smoulderMs: 1200,
  sparkInward: 0.65,
  rimCracks: 1,
  scorch: 1,
  scorchMs: 1000,
  emberStorm: 46,
  knockPx: 30,
  squash: 0.14,
  shakeMs: 380,
  zoomOutMs: 420,
  shakeCap: 32,
  zoomCap: 0.12,
  reducedFadeMs: 260,
  colorCore: '#ffffff',
  colorHot: '#ffd36b',
  colorPlayer: '#ff5a14',
  colorFoe: '#ff1f35',
  colorShade: '#6e0f00',
  colorSmoke: '#2b1b16',
  sfxRoarClip: 'fx/dragon-growl', sfxRoarGain: 0.5, sfxRoarRate: 1.08,
  sfxWindupClip: 'windup', sfxWindupGain: 0.8, sfxWindupRate: 0.92,
  sfxChargeClip: 'fx/oona-powerup', sfxChargeGain: 0.4, sfxChargeRate: 0.9,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.6, sfxWhooshRate: 1.1,
  sfxTickClip: 'smack3', sfxTickGain: 0.75, sfxTickRate: 1.05,
  sfxSlashClip: 'cleave2', sfxSlashGain: 0.45, sfxSlashRate: 1.1,
  sfxImpactClip: 'titanhammer', sfxImpactGain: 0.7, sfxImpactRate: 1.12,
  sfxPunchClip: 'smack2', sfxPunchGain: 0.85, sfxPunchRate: 0.95,
  sfxThumpClip: 'fx/heavy-rock-impact', sfxThumpGain: 0.45, sfxThumpRate: 1.15,
  sfxBigClip: 'crit', sfxBigGain: 0.45, sfxBigRate: 1.05,
  sfxHaymakerClip: 'fx/universfield-ground-impact-352053', sfxHaymakerGain: 0.6, sfxHaymakerRate: 1.12,
  sfxRubbleClip: 'fx/triple-impact', sfxRubbleGain: 0.3, sfxRubbleRate: 1.25,
  sfxToneGain: 0.3, sfxToneLowHz: 70, sfxToneHighHz: 220,
  sfxCrackleGain: 0.35,
  sfxRumbleGain: 0.35,
  sfxImpactLenMs: 1000,
  sfxTailMix: 0.12,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroEnragedStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  windupLeadMs: [0, 600, 10],
  windupDepth: [0, 3, 0.05],
  windupSwell: [0, 0.8, 0.01],
  tiltBoost: [0, 3, 0.05],
  tremblePx: [0, 12, 0.1],
  contactStop: [-1, 1.5, 0.01],
  contactSwell: [0, 0.5, 0.01],
  recoilShare: [0.1, 0.9, 0.01],
  coilSquash: [0, 0.4, 0.01],
  haymakerCoilMs: [150, 1500, 10],
  haymakerIn: [-0.3, 0.6, 0.01],
  haymakerLift: [0, 0.6, 0.01],
  haymakerSwell: [0, 1.2, 0.01],
  haymakerDriveX: [0.3, 3, 0.05],
  crescentSize: [0, 3, 0.05],
  shockSize: [0, 3, 0.05],
  heroSquash: [0, 0.4, 0.01],
  reboundDepth: [0, 1.5, 0.01],
  holdMs: [0, 400, 5],
  recoverX: [0.2, 3, 0.05],
  burstMs: [0, 500, 5],
  burstSize: [0, 3, 0.05],
  craterSize: [0, 3, 0.05],
  debris: [0, 40, 1],
  auraSize: [0.3, 3, 0.05],
  flames: [0, 16, 1],
  flameLength: [0.2, 3, 0.05],
  motes: [0, 40, 1],
  ghosts: [0, 6, 1],
  ghostSpacing: [0.3, 3, 0.05],
  ghostAlpha: [0, 1, 0.01],
  ghostFadeMs: [40, 800, 10],
  wakeWidth: [0, 3, 0.05],
  wakeMs: [20, 400, 5],
  speedLines: [0, 24, 1],
  ringSize: [0, 3, 0.05],
  ring2Size: [0, 3, 0.05],
  slashLength: [0.2, 3, 0.05],
  slashWidth: [0.2, 3, 0.05],
  sparkSpeed: [0.2, 3, 0.05],
  emberLife: [0.2, 3, 0.05],
  flashAlpha: [0, 1, 0.01],
  smoulderMs: [0, 3000, 10],
  sparkInward: [0, 1, 0.01],
  rimCracks: [0, 3, 0.05],
  scorch: [0, 3, 0.05],
  scorchMs: [100, 3000, 10],
  emberStorm: [0, 120, 1],
  knockPx: [0, 80, 1],
  squash: [0, 0.4, 0.01],
  shakeMs: [0, 1500, 10],
  zoomOutMs: [60, 1500, 10],
  shakeCap: [0, 60, 0.5],
  zoomCap: [0, 0.2, 0.002],
  reducedFadeMs: [60, 1000, 10],
  sfxRoarGain: [0, 2, 0.05], sfxRoarRate: [0.5, 2, 0.01],
  sfxWindupGain: [0, 2, 0.05], sfxWindupRate: [0.5, 2, 0.01],
  sfxChargeGain: [0, 2, 0.05], sfxChargeRate: [0.5, 2, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2, 0.01],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2, 0.01],
  sfxSlashGain: [0, 2, 0.05], sfxSlashRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxPunchGain: [0, 2, 0.05], sfxPunchRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxHaymakerGain: [0, 2, 0.05], sfxHaymakerRate: [0.5, 2, 0.01],
  sfxRubbleGain: [0, 2, 0.05], sfxRubbleRate: [0.5, 2, 0.01],
  sfxToneGain: [0, 2, 0.05], sfxToneLowHz: [30, 400, 1], sfxToneHighHz: [60, 1200, 5],
  sfxCrackleGain: [0, 2, 0.05],
  sfxRumbleGain: [0, 2, 0.05],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_ENRAGED_RANGES: Record<HeroEnragedNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => ENRAGED_TIER_SUFFIXES.map((s) => [`t${t}${s}`, ENRAGED_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays readable, not nauseating). */
export const ENRAGED_CAPS = { strikes: 8, sparks: 120, embers: 120, slashes: 3, shakePx: 40, zoom: 0.14 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_ENRAGED_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_ENRAGED_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroEnragedValue<K extends keyof HeroEnragedConfig>(key: K, value: unknown): HeroEnragedConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_ENRAGED_DEFAULTS, key)) return undefined;
  const def = HERO_ENRAGED_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroEnragedConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroEnragedConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_ENRAGED_RANGES[key as HeroEnragedNumKey];
  return Math.min(max, Math.max(min, n)) as HeroEnragedConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroEnragedConfig(saved: unknown): HeroEnragedConfig {
  const out: HeroEnragedConfig = { ...HERO_ENRAGED_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroEnragedValue(k as keyof HeroEnragedConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroenraged.v5';

let cfg: HeroEnragedConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_ENRAGED_DEFAULTS };
  try { return sanitizeHeroEnragedConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_ENRAGED_DEFAULTS }; }
})();

export function getHeroEnragedConfig(): HeroEnragedConfig { return cfg; }

export function setHeroEnragedValue(key: keyof HeroEnragedConfig, value: number | string): void {
  const safe = clampHeroEnragedValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroEnragedConfig(): void {
  cfg = { ...HERO_ENRAGED_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroEnragedConfigJson(c: HeroEnragedConfig = cfg): string {
  const ship: Partial<HeroEnragedConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_ENRAGED_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroEnragedSpeed = (typeof HERO_ENRAGED_SPEEDS)[number];
let speed: HeroEnragedSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroEnragedPreviewSpeed(): HeroEnragedSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroEnragedPreviewSpeed(s: HeroEnragedSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function enragedTierDials(tier: TierNum, c: HeroEnragedConfig = cfg): Record<EnragedTierSuffix, number> {
  return Object.fromEntries(ENRAGED_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<EnragedTierSuffix, number>;
}

export interface EnragedStrike {
  /** The hero starts driving at the foe. */
  driveAt: number;
  /** Contact: a tick, or (the last) THE impact. */
  contactAt: number;
  /** The last strike: the consequence lands here. */
  final: boolean;
  /** Tier IV's knockout: the overhead HAYMAKER (it comes down on an arc from a huge rear-back). */
  haymaker: boolean;
  /** How deep the coil BEFORE this drive goes, as a multiple of the windup depth (the windup is 1). */
  pull: number;
  /** 0..1 up the combo: how hard this hit lands (every hit escalates; the last is the biggest). */
  power: number;
  /** Before this drive: the recoil off the last contact ends and the coil (anticipation) begins. Else = driveAt. */
  coilAt: number;
}

export interface EnragedPlanInput extends AttackTierContext {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  reduced?: boolean;
  /** Classic's swing times for these two portraits (`classicSwing(...).times`); a typical cross-board swing if absent. */
  swing?: SwingTimes;
  /** Classic's tempo (the swing runs at it; `getClassicConfig().tempo`). */
  tempo?: number;
}

/** A typical cross-board Classic swing (the Lunge tuner's defaults), for a plan made without the portraits. */
export const TYPICAL_SWING: SwingTimes = { windupS: 0.54, strikeS: 0.22, smackLeadS: 0.005, reboundS: 0.06, settleS: 1.11 };

export interface EnragedPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The total starts diving into the hero. */
  chargeAt: number;
  absorbEnd: number;
  /** The hero starts pulling back (and the aura ignites). */
  windupAt: number;
  /** THE RAGE BURST: the portrait flares and a roar tears out, just before the first drive. */
  burstAt: number;
  strikes: EnragedStrike[];
  /** Tier IV: the combo ends in the overhead haymaker. */
  haymaker: boolean;
  /** Tier IV: the hero REARS BACK for the haymaker (the build: the roar, the flare, the dim). Else = the impact. */
  rearAt: number;
  /** Contacts BEFORE the impact (sequence ms): the ticks. */
  ticks: number[];
  /** THE consequence beat: the last strike's contact. */
  impactAt: number;
  /** The hero starts springing home (the rebound off the clack, then Classic's elastic settle, quicker). */
  recoverAt: number;
  /** The rebound ends and the settle starts. */
  reboundEnd: number;
  /** The hero is home. */
  homeAt: number;
  /** Tier IV: rubble landing round the cracked ground (sequence ms). */
  booms: number[];
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  aura: number;
  sparks: number;
  embers: number;
  slashes: number;
  burst: number;
  dim: number;
}

/** The whole Enraged Strike, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function enragedPlan(input: EnragedPlanInput, c: HeroEnragedConfig = cfg): EnragedPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = attackTier(total, input, c); // a knockout always plays Tier IV (heroAttack/tiers.ts)
  const T = enragedTierDials(tier, c);
  const k = (tier - 1) / 3;

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total, chargeAt: impactAt, absorbEnd: impactAt, windupAt: impactAt, burstAt: impactAt, rearAt: impactAt,
      strikes: [], haymaker: false, ticks: [], impactAt, recoverAt: impactAt, reboundEnd: impactAt, homeAt: impactAt, booms: [], endAt: r.endAt,
      shakePx: 0, zoom: 0, punch: 0, aura: 0, sparks: 0, embers: 0, slashes: 0, burst: 0, dim: 0,
    };
  }

  const sw = input.swing ?? TYPICAL_SWING;
  const ms = (sec: number): number => (sec * 1000) / Math.max(0.05, input.tempo ?? 1.15);
  const windupMs = ms(sw.windupS) * T.WindupX;
  const driveMs = ms(sw.strikeS) * T.DriveX;
  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const windupAt = chargeAt + Math.min(c.windupLeadMs, c.absorbMs);
  const haymaker = T.Haymaker >= 1;
  const n = clamp(Math.round(T.Strikes), 1, ENRAGED_CAPS.strikes);
  const strikes: EnragedStrike[] = [];
  let at = windupAt + windupMs;
  let rearAt = at;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const isHay = last && haymaker;
    let coilAt = at;
    if (i > 0) {
      // A FULL CYCLE between hits (owner 2026-09-28: "let them fly back in and impact each time"): a hard RECOIL off the
      // foe, then a COIL (anticipation), then the next drive. A combo ACCELERATES (each gap shorter by `Accel`); the
      // finisher winds up harder; the haymaker rears way back.
      const gap = isHay ? c.haymakerCoilMs : last && n > 2 ? T.GapMs + T.FinisherMs : T.GapMs * Math.pow(T.Accel, i - 1);
      if (isHay) rearAt = at;
      coilAt = at + gap * (isHay ? 0.3 : c.recoilShare);
      at += gap;
    }
    const drive = isHay ? driveMs * c.haymakerDriveX : driveMs * (i === 0 || last ? 1 : Math.max(0.55, Math.pow(T.Accel, i - 1)));
    const pull = i === 0 ? 1 : isHay ? 1 : last && n > 2 ? c.reboundDepth * 1.35 : c.reboundDepth;
    const power = n === 1 ? 1 : (i + 1) / n;
    strikes.push({ driveAt: at, contactAt: at + drive, final: last, haymaker: isHay, pull, power, coilAt });
    at += drive;
  }
  if (!haymaker) rearAt = strikes[n - 1]!.contactAt;
  const firstDrive = strikes[0]!;
  const burstAt = Math.max(windupAt, firstDrive.driveAt - c.burstMs);
  const impactAt = strikes[n - 1]!.contactAt;
  const ticks = strikes.filter((s) => !s.final).map((s) => s.contactAt);
  // The haymaker stays planted a beat longer before it springs home.
  const recoverAt = impactAt + c.holdMs + (haymaker ? 220 : 0);
  const reboundEnd = recoverAt + ms(sw.reboundS);
  const homeAt = reboundEnd + ms(sw.settleS) * c.recoverX;
  const booms = haymaker ? [impactAt + 190, impactAt + 380] : [];
  // The elastic settle is a long lazy tail: the sequence ends once it has visibly come to rest (Classic's rule).
  const lastBeat = Math.max(reboundEnd + (homeAt - reboundEnd) * 0.6, impactAt + c.zoomOutMs * 0.9, booms.length ? booms[booms.length - 1]! + 150 : 0, impactAt + c.smoulderMs * 0.55);
  const endAt = lastBeat + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, windupAt, burstAt, strikes, haymaker, rearAt, ticks, impactAt,
    recoverAt, reboundEnd, homeAt, booms, endAt,
    shakePx: clamp(T.Shake, 0, Math.min(c.shakeCap, ENRAGED_CAPS.shakePx)),
    zoom: clamp(T.Zoom, 0, Math.min(c.zoomCap, ENRAGED_CAPS.zoom)),
    punch: clamp(T.Punch, 0, Math.min(c.zoomCap, ENRAGED_CAPS.zoom)),
    aura: T.Aura,
    sparks: Math.round(clamp(T.Sparks, 0, ENRAGED_CAPS.sparks)),
    embers: Math.round(clamp(T.Embers, 0, ENRAGED_CAPS.embers)),
    slashes: Math.round(clamp(T.Slashes, 0, ENRAGED_CAPS.slashes)),
    burst: T.Burst,
    dim: T.Dim,
  };
}

export type EnragedCueKind = 'charge' | 'windup' | 'burst' | 'coil' | 'rear' | 'drive' | 'tick' | 'impact' | 'boom' | 'recover' | 'end';
export interface EnragedCue { at: number; kind: EnragedCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a tick precedes the next drive). */
export function enragedCues(p: EnragedPlan): EnragedCue[] {
  const out: EnragedCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.windupAt, kind: 'windup', i: 0 });
    out.push({ at: p.burstAt, kind: 'burst', i: 0 });
    if (p.haymaker) out.push({ at: p.rearAt, kind: 'rear', i: 0 });
    p.strikes.forEach((s, i) => {
      if (i > 0 && !s.haymaker) out.push({ at: s.coilAt, kind: 'coil', i });
      out.push({ at: s.driveAt, kind: 'drive', i });
      if (!s.final) out.push({ at: s.contactAt, kind: 'tick', i });
    });
    out.push({ at: p.recoverAt, kind: 'recover', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  p.booms.forEach((at, i) => out.push({ at, kind: 'boom', i }));
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<EnragedCueKind, number> = { charge: 0, windup: 1, burst: 2, tick: 3, rear: 4, coil: 5, drive: 6, impact: 7, boom: 8, recover: 9, end: 10 };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the hero's pose (pure) ────────────────────────────────────────────────────────────────────────────────────

/** Where the lunge goes, solved once from the two heroes (screen px, or host px in a sandbox). */
export interface EnragedGeo {
  /** Unit vector from the striking hero to the struck one. */
  u: Pt;
  dist: number;
  /** The windup's pull back (an offset from the hero's rest): Classic's, deeper. */
  back: Pt;
  /** Where the hero's centre lands on contact (an offset from rest): on the struck portrait's rim, so the hit reads. */
  contact: Pt;
  /** Tier IV: the top of the haymaker's rear-back (an offset from rest): back along the line and UP, kept on screen. */
  rear: Pt;
  /** Tier IV: the haymaker's arc control point (an offset from rest): high over the line, so it comes DOWN on the foe. */
  arc: Pt;
  /** The lean that leads with a corner (degrees, signed): Classic's, harder. */
  tilt: number;
  /** Classic's own swell at the top of the windup (1.32 by default), before the enraged extra. */
  classicSwell: number;
  /** Classic's rebound off the clack (degrees). */
  rebound: number;
  /** Classic's strike ease for this distance (it hangs, then blurs into contact). */
  ease: (u: number) => number;
}

/** Classic's eases (the same GSAP curves `strikePose` uses), parsed once. */
const EXPO_IN = gsap.parseEase('expo.in');
const POWER1_OUT = gsap.parseEase('power1.out');
const POWER2_OUT = gsap.parseEase('power2.out');
const ELASTIC_OUT = gsap.parseEase('elastic.out(1, 0.45)');

/** A screen box (px): the hero stays inside it. */
export interface Frame { x0: number; y0: number; x1: number; y1: number }

/** Shorten an offset from `a` (keeping its direction) so `a + off` stays `margin` inside the frame. Pure. */
export function fitInFrame(a: Pt, off: Pt, frame: Frame | null, margin: number): Pt {
  if (!frame) return off;
  let f = 1;
  const lim = (p: number, o: number, lo: number, hi: number): void => {
    if (o < 0 && p + o < lo) f = Math.min(f, Math.max(0, (p - lo) / -o));
    if (o > 0 && p + o > hi) f = Math.min(f, Math.max(0, (hi - p) / o));
  };
  lim(a.x, off.x, frame.x0 + margin, frame.x1 - margin);
  lim(a.y, off.y, frame.y0 + margin, frame.y1 - margin);
  return { x: off.x * f, y: off.y * f };
}

/**
 * The geometry, from the two centres and radii, on CLASSIC's swing (`classicSwing`, solved in the attacker's own px;
 * `inv` = its own px per screen px, as `classicSwing` took it). Without a swing (a pure test) it uses the Lunge
 * tuner's defaults. `frame` is the screen (or the sandbox box): the coil and the rear-back are shortened, never bent, so
 * the hero stays well inside it.
 */
export function enragedGeo(
  a: Pt, d: Pt, aR: number, dR: number, c: HeroEnragedConfig = cfg, frame: Frame | null = null,
  swing: ClassicSwing | null = null, inv = 1,
): EnragedGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const u = { x: dx / dist, y: dy / dist };
  const k = inv > 0 ? 1 / inv : 1;
  const back0 = swing ? { x: swing.back.x * k, y: swing.back.y * k } : { x: -dx * 0.13, y: -dy * 0.13 };
  const margin = aR * 1.05;
  const back = fitInFrame(a, { x: back0.x * c.windupDepth, y: back0.y * c.windupDepth }, frame, margin);
  // THE READABLE HIT: the striker stops with its centre `contactStop` of its own radii outside the struck portrait's rim
  // (0 = its centre on the rim; negative drives further in, toward Classic's corner-over-the-face contact).
  const gap = dR + aR * c.contactStop;
  const contact = { x: dx - u.x * gap, y: dy - u.y * gap };
  // THE HAYMAKER'S REAR-BACK: a third of the way in toward the foe and UP, swollen toward the camera (kept whole on
  // screen), so the whole rear reads over the board; then it comes DOWN in an overhead arc onto the foe's rim.
  const rear = fitInFrame(a, { x: dx * c.haymakerIn, y: dy * c.haymakerIn - c.haymakerLift * dist }, frame, aR * (1 + c.haymakerSwell) * 1.05);
  // The arc's control point stays low enough that the swoop never leaves the top of the screen (a quadratic's peak sits
  // halfway to its control point, so the control may reach one radius above the frame's top margin).
  const arcTop = frame ? frame.y0 + aR * 0.4 - a.y : Number.NEGATIVE_INFINITY;
  const arc = { x: (rear.x + contact.x) / 2 - u.y * 0.1 * dist, y: Math.max(arcTop, Math.min(rear.y, contact.y) - c.haymakerLift * dist * 0.35) };
  const tilt0 = swing ? swing.leadTilt : 8 * (dx >= 0 ? 1 : -1);
  return {
    u, dist, back, contact, rear, arc, tilt: tilt0 * c.tiltBoost,
    classicSwell: swing ? swing.windupScale : 1.32,
    rebound: swing ? swing.rebound : 2.5,
    ease: swing ? swing.strikeEase : EXPO_IN,
  };
}

export interface HeroPose {
  /** Offset from the hero's rest (px in the points' space). */
  x: number; y: number;
  scale: number;
  /** Degrees. */
  rot: number;
  /** 0..1: how hard the rage burns (drives the aura). */
  heat: number;
  /** Squash along the blow (> 0 compressed on a contact or a coil, < 0 stretched on a recoil), springing out. */
  squash: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * The striking hero's pose at sequence time `t`: CLASSIC's swing (a power1.out coil back along the line with the swell
 * and the lean, the distance-scaled strike on Classic's ease, a power2.out rebound off the clack, the elastic.out settle
 * home), amplified into a brawler's combo: every hit is a full cycle (a hard RECOIL off the foe, stretched; a COIL with a
 * squash and a tremble; a DRIVE back in), and Tier IV rears way back and UP and brings an overhead HAYMAKER down on an
 * arc. Pure and deterministic (the tremble is sines): a replay moves identically, and the scene draws the afterimages
 * and the streak by sampling this back in time.
 */
export function enragedPose(p: EnragedPlan, g: EnragedGeo, c: HeroEnragedConfig, t: number): HeroPose {
  const pose = basePose(p, g, c, t);
  if (p.reduced) return pose;
  // THE CONTACT SQUASH: every contact compresses the hero along the blow (it hits something solid), springing out.
  let sq = pose.squash;
  for (const s of p.strikes) if (t >= s.contactAt) sq += Math.max(0, spring(t - s.contactAt, 4.5, 70)) * c.heroSquash * (0.5 + 0.5 * s.power) * (s.haymaker ? 1.4 : 1);
  pose.squash = clamp(sq, -0.3, 0.4);
  // The rage SPENDS itself on the last blow: the aura drops away on contact (so the impact reads), then cools.
  if (t >= p.impactAt) pose.heat = Math.min(pose.heat, 0.45 * Math.exp(-(t - p.impactAt) / 260));
  return pose;
}

function basePose(p: EnragedPlan, g: EnragedGeo, c: HeroEnragedConfig, t: number): HeroPose {
  const rest: HeroPose = { x: 0, y: 0, scale: 1, rot: 0, heat: 0, squash: 0 };
  if (p.reduced || t < p.windupAt) return rest;
  const swell = g.classicSwell + c.windupSwell;
  const hit = 1 + c.contactSwell;
  const first = p.strikes[0]!;
  const tremble = (amp: number): Pt => ({ x: amp * Math.sin(t * 0.37 + 0.4), y: amp * Math.sin(t * 0.51 + 1.7) });

  // WINDUP: Classic's coil (power1.out), deeper, with the rage trembling harder.
  if (t < first.driveAt) {
    const u = clamp01((t - p.windupAt) / Math.max(1, first.driveAt - p.windupAt));
    const e = POWER1_OUT(u);
    const tr = tremble(c.tremblePx * u * u * (0.8 + 0.4 * p.k));
    return { x: g.back.x * e + tr.x, y: g.back.y * e + tr.y, scale: lerp(1, swell, e), rot: g.tilt * e, heat: easeInOutSine(u), squash: 0 };
  }

  for (let i = 0; i < p.strikes.length; i++) {
    const s = p.strikes[i]!;
    const next = p.strikes[i + 1];
    // THE DRIVE: back into the foe. A combo hit uses Classic's ease (it hangs, then blurs); the haymaker comes DOWN on an
    // overhead arc, accelerating all the way.
    if (t < s.contactAt) {
      const from = drivePose(p, g, c, i);
      const u = clamp01((t - s.driveAt) / Math.max(1, s.contactAt - s.driveAt));
      const hitScale = hit * (s.haymaker ? 1.12 : 1);
      if (s.haymaker) {
        const e = Math.pow(u, 2.1);
        const m = 1 - e;
        return {
          x: m * m * from.x + 2 * m * e * g.arc.x + e * e * g.contact.x,
          y: m * m * from.y + 2 * m * e * g.arc.y + e * e * g.contact.y,
          scale: lerp(from.scale, hitScale, e), rot: lerp(from.rot, g.tilt * 1.6, e), heat: 1, squash: -0.12 * Math.sin(Math.PI * u),
        };
      }
      const e = g.ease(u);
      return { x: lerp(from.x, g.contact.x, e), y: lerp(from.y, g.contact.y, e), scale: lerp(from.scale, hitScale, e), rot: lerp(from.rot, g.tilt, e), heat: 1, squash: -0.1 * Math.sin(Math.PI * u) * u };
    }
    // THE CYCLE BETWEEN HITS: a hard RECOIL off the foe (stretched, fast, ease-out), then the COIL (anticipation: it
    // settles a little further back, squashes and trembles), then the next drive.
    if (next && t < next.driveAt) {
      const to = drivePose(p, g, c, i + 1);
      const tr = tremble(c.tremblePx * (next.haymaker ? 1.6 : 0.7));
      if (t < next.coilAt) {
        const v = clamp01((t - s.contactAt) / Math.max(1, next.coilAt - s.contactAt));
        const e = easeOutCubic(v) * 0.86;
        return {
          x: lerp(g.contact.x, to.x, e), y: lerp(g.contact.y, to.y, e), scale: lerp(hit, to.scale, e),
          rot: lerp(g.tilt, next.haymaker ? to.rot : -g.tilt * 0.4, e), heat: 1,
          // The stretch comes AFTER the contact squash has read (the hit first, then it flies back off the foe).
          squash: -0.14 * Math.sin(Math.PI * clamp01((v - 0.25) / 0.75)),
        };
      }
      const v = clamp01((t - next.coilAt) / Math.max(1, next.driveAt - next.coilAt));
      const e = 0.86 + 0.14 * easeInOutSine(v);
      const from86 = { x: lerp(g.contact.x, to.x, 0.86), y: lerp(g.contact.y, to.y, 0.86) };
      return {
        x: lerp(from86.x, to.x, (e - 0.86) / 0.14) + tr.x * v, y: lerp(from86.y, to.y, (e - 0.86) / 0.14) + tr.y * v,
        scale: lerp(lerp(hit, to.scale, 0.86), to.scale, (e - 0.86) / 0.14),
        rot: lerp(next.haymaker ? to.rot : -g.tilt * 0.4, to.rot, easeInOutSine(v)), heat: 1,
        squash: c.coilSquash * Math.sin(Math.PI * v) * (next.haymaker ? 1.5 : 1),
      };
    }
  }

  // AFTER THE IMPACT: planted in the foe a beat (a small recoil off it), Classic's rebound off the clack, then Classic's
  // elastic settle home (quicker), the rage cooling.
  const land = hit * (p.haymaker ? 1.12 : 1);
  if (t < p.recoverAt) {
    const rk = Math.sin(clamp01((t - p.impactAt) / Math.max(1, p.recoverAt - p.impactAt)) * Math.PI) * 0.1;
    return { x: g.contact.x - (g.contact.x - g.back.x * 0.2) * rk * 0.35, y: g.contact.y - (g.contact.y - g.back.y * 0.2) * rk * 0.35, scale: land, rot: g.tilt, heat: 1, squash: 0 };
  }
  const reb = -Math.sign(g.tilt || 1) * g.rebound * c.tiltBoost;
  if (t < p.reboundEnd) {
    const e = POWER2_OUT(clamp01((t - p.recoverAt) / Math.max(1, p.reboundEnd - p.recoverAt)));
    return { x: g.contact.x, y: g.contact.y, scale: lerp(land, 1 + (land - 1) * 0.5, e), rot: lerp(g.tilt, reb, e), heat: 1, squash: 0 };
  }
  const u = clamp01((t - p.reboundEnd) / Math.max(1, p.homeAt - p.reboundEnd));
  const e = ELASTIC_OUT(u);
  const cool = 1 - clamp01(u * 1.6);
  return {
    x: g.contact.x * (1 - e), y: g.contact.y * (1 - e),
    scale: 1 + (land - 1) * 0.5 * (1 - e), rot: reb * (1 - e), heat: cool * cool, squash: 0,
  };
}

/** Where a drive starts: the end of its coil (the windup for the first; the rear-back for the haymaker). */
function drivePose(p: EnragedPlan, g: EnragedGeo, c: HeroEnragedConfig, i: number): HeroPose {
  const s = p.strikes[i]!;
  const swell = g.classicSwell + c.windupSwell;
  if (s.haymaker) return { x: g.rear.x, y: g.rear.y, scale: 1 + c.haymakerSwell, rot: -g.tilt * 1.4, heat: 1, squash: 0 };
  if (i === 0) return { x: g.back.x, y: g.back.y, scale: swell, rot: g.tilt, heat: 1, squash: 0 };
  // Between hits: pulled back out of the foe by `pull` x the windup depth, measured from the contact point.
  return {
    x: g.contact.x + g.back.x * s.pull, y: g.contact.y + g.back.y * s.pull,
    scale: 1 + (swell - 1) * Math.min(1, 0.55 + 0.35 * s.pull), rot: g.tilt, heat: 1, squash: 0,
  };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * The camera at sequence time `t` (px in the points' space). A push in on the hero through the windup with a growing
 * tremor; a kick back as each drive leaves; on EVERY hit a punch in and a sharp kick ALONG the blow, escalating up the
 * combo; on THE impact the biggest punch and a shake along the blow. Tier IV eases the push off as the hero rears back
 * (so the whole rear-back is framed) under a growing tremor, then the haymaker punches hardest and rings both ways.
 * Deterministic (sines and springs). Pure.
 */
export function enragedCameraAt(p: EnragedPlan, c: HeroEnragedConfig, t: number, u: Pt): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const first = p.strikes[0]!;
  if (t >= p.windupAt && t < p.impactAt) {
    z += p.zoom * easeInOutSine((t - p.windupAt) / Math.max(1, first.driveAt - p.windupAt));
    if (p.haymaker && t >= p.rearAt) z -= p.zoom * easeInOutSine((t - p.rearAt) / Math.max(1, (p.strikes[p.strikes.length - 1]!.driveAt - p.rearAt) * 0.6));
  }
  p.strikes.forEach((s) => { if (!s.final && t >= s.contactAt && t < p.impactAt) z += p.punch * (0.35 + 0.55 * s.power) * Math.exp(-(t - s.contactAt) / 90); });
  if (t >= p.impactAt) z += (p.zoom * (p.haymaker ? 1.4 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number): void => {
    const age = t - at;
    if (age < 0) return;
    const s = spring(age, hz, tau);
    const across = amp * 0.25 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += u.x * amp * s - u.y * across;
    y += u.y * amp * s + u.x * across;
  };
  // Each drive leaves with a small kick back (the push-off); each hit lands with a sharp kick, bigger up the combo.
  p.strikes.forEach((s) => kick(s.driveAt, -p.shakePx * 0.12, 40, 12));
  p.strikes.forEach((s) => { if (!s.final) kick(s.contactAt, p.shakePx * (0.3 + 0.45 * s.power), 55, 16); });
  // The windup (and the haymaker's rear-back) tremble, growing into the drive.
  const tremble = (from: number, to: number, amp: number): void => {
    if (t < from || t >= to) return;
    const v = (t - from) / Math.max(1, to - from);
    const a = p.shakePx * amp * v * v;
    x += a * Math.sin(t * 0.13); y += a * Math.sin(t * 0.17 + 1.3);
  };
  tremble(p.windupAt, first.driveAt, 0.1);
  if (p.haymaker) tremble(p.rearAt, p.strikes[p.strikes.length - 1]!.driveAt, 0.22);
  const age = t - p.impactAt;
  if (age >= 0) {
    if (p.haymaker) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 3.2));
      x += p.shakePx * 0.8 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * env * Math.cos(age * 0.093);
      p.booms.forEach((at, i) => kick(at, p.shakePx * 0.2, 45, 18 - i));
    } else kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 15);
  }
  const cap = Math.min(c.shakeCap, ENRAGED_CAPS.shakePx);
  const m = Math.hypot(x, y);
  if (m > cap && m > 0) { x *= cap / m; y *= cap / m; }
  return { zoom: 1 + clamp(z, 0, Math.min(c.zoomCap, ENRAGED_CAPS.zoom) * 1.6), x, y };
}

/**
 * Where the camera anchors: the hero through the windup, sliding to the foe over the first drive, the foe after. Tier IV
 * slides to the middle of the rear-back and the foe while the hero rears up, so the whole haymaker is framed.
 */
export function enragedCameraFocus(p: EnragedPlan, t: number, a: Pt, d: Pt, rear: Pt | null = null): Pt {
  const first = p.strikes[0];
  const last = p.strikes[p.strikes.length - 1];
  if (!first || !last) return a;
  if (p.haymaker && rear && t >= p.rearAt) {
    const top = { x: (a.x + rear.x + d.x) / 2, y: (a.y + rear.y + d.y) / 2 };
    if (t < last.driveAt) {
      const e = easeInOutSine((t - p.rearAt) / Math.max(1, last.driveAt - p.rearAt));
      return { x: d.x + (top.x - d.x) * e, y: d.y + (top.y - d.y) * e };
    }
    if (t >= last.contactAt) return d;
    const e = easeInOutSine((t - last.driveAt) / Math.max(1, last.contactAt - last.driveAt));
    return { x: top.x + (d.x - top.x) * e, y: top.y + (d.y - top.y) * e };
  }
  if (t <= first.driveAt) return a;
  if (t >= first.contactAt) return d;
  const e = easeInOutSine((t - first.driveAt) / Math.max(1, first.contactAt - first.driveAt));
  return { x: a.x + (d.x - a.x) * e, y: a.y + (d.y - a.y) * e };
}
