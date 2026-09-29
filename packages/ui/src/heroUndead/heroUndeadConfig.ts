/**
 * THE UNDEAD HERO ATTACK (Grave Call): its tuned values, its pure timeline, the pure geometry and the pure camera.
 *
 * Owner 2026-09-29: "branch off and make some more attack types - we need a fire animation, a bleed/gash animation, some
 * sort of an undead animation, a beast chomp rush animation, and i would love a king oona banana cannon animation. use
 * the same 4 tier strategy we have been." This is the undead one (the design was left to the builder).
 *
 * THE BEATS (base ms before the playback speed):
 *  1. THE DAMAGE FORMATION (shared by every style, `../heroAttack/damageFormation.ts`). Its end is this style's start.
 *  2. THE RAISE. The total dives into the striking hero; a necrotic grave circle turns on the board under it, ghost
 *     wisps spiral in round its rim and a ring of grave smoke circles it; the view pushes in on the hero. Then the circle
 *     flares (the dead answer).
 *  3. THE SKULL. A spectral skull pops out of the hero on the side facing the target and SHRIEKS (its jaw drops, shriek
 *     rings pulse off it), then flies at the target on a slight arc, wobbling, trailing afterimages and shedding wisps,
 *     jaw wide, and BITES as it lands (the jaw snaps shut): it bursts into a swirl of ghost wisps, bone shards and a
 *     spectral echo of itself.
 *     I: one skull. II: TWO skulls weaving in on opposite arcs, the first a tick, the second bigger.
 *     III: a grave circle opens under the target, skeletal HANDS claw up out of the board round it and DRAG at it (the
 *     portrait is pulled down into the grave), a SWARM of ghost wisps streams from the hero and strikes it in rhythm,
 *     then one big skull finishes it and the hands shatter into bone.
 *  IV. THE GRAVE RIFT (the showpiece):
 *      1. A RIFT tears open in the board between the heroes (a jagged void, lit sickly green inside, cracks racing off
 *         it, grave dust and motes pouring up).
 *      2. A GIANT spectral SKULL MAW rises out of it (mist and wisps pouring round it), its eyes ignite.
 *      3. It SHRIEKS: the jaw drops wide, shriek rings pulse off it, the view trembles, the struck hero shudders.
 *      4. It LUNGES across the board at the struck hero, growing, trailing afterimages, jaw wide, and CHOMPS shut on it:
 *         THE blow. It bursts into wisps and bone, and a wave of necrotic MIST washes out across the board; the rift
 *         closes and fades.
 *     EVERYTHING IS FLAT 2D (the owner's rule since Holy, 2026-09-29): every circle, hole, rift and crack is a top-down
 *     shape on the board; nothing is tilted into faux 3D.
 *
 * THE CONSEQUENCE lands ONCE: on the last skull's bite (I-III) or on the maw's chomp (IV). Every earlier skull, every
 * hand's grip and every wisp is a tick (FX and sound only). No hit-stop or freeze anywhere (owner 2026-09-28).
 *
 * TIERS are the shared, owner-approved thresholds (I 1-5, II 6-11, III 12-19, IV 20+). Reduced motion: no skulls,
 * hands, wisps, rift, shake or zoom; the numbers fade and the blow lands.
 *
 * Tuner convention (the Blast's): localStorage in DEV only, values clamped on write and on load; production always
 * plays DEFAULTS. The preview speed is how you are LOOKING and is never saved.
 */
import { clamp, easeInOutSine, seededRng, type Pt } from '../heroAttack/easing';
import {
  HERO_ATTACK_TIER_THRESHOLDS, TIERS, reducedAttackTimeline, tierOf, type TierNum,
} from '../heroAttack/tiers';

export { TIERS, type TierNum };

/** The per-tier dials. A config key is `t1..t4` + one of these. */
export const UNDEAD_TIER_SUFFIXES = [
  'ChargeMs', 'Skulls', 'SkullGapMs', 'SkullFlightMs', 'SkullSize', 'Hands', 'HandGapMs', 'Wisps', 'WispGapMs', 'WispFlightMs',
  'Maw', 'Shake', 'Zoom', 'Punch', 'Burst', 'Motes', 'SettleMs', 'Dim',
] as const;
export type UndeadTierSuffix = (typeof UNDEAD_TIER_SUFFIXES)[number];
type TierKey = `t${TierNum}${UndeadTierSuffix}`;

interface GlobalConfig {
  // Tiers (the shared thresholds; DEV-tunable only)
  tier2At: number; tier3At: number; tier4At: number;
  // The raise
  absorbMs: number;
  heroSwell: number;
  circleSize: number;
  circleSpin: number;
  smokeRing: number;
  // The skull
  shriekMs: number;
  skullBase: number;
  skullArc: number;
  skullWobble: number;
  afterimages: number;
  shedWisps: number;
  echoSize: number;
  shards: number;
  // Wisps (every tier's bursts; the Tier III swarm)
  wispLife: number;
  wispWander: number;
  wispSize: number;
  wispBend: number;
  // The hands (Tier III)
  handSize: number;
  handRing: number;
  handRiseMs: number;
  handDragPx: number;
  // The rift and the maw (Tier IV)
  riftAlong: number;
  riftLen: number;
  riftMs: number;
  riftCracks: number;
  mawSize: number;
  mawRiseMs: number;
  mawLift: number;
  mawShriekMs: number;
  mawLungeMs: number;
  chompMs: number;
  mawGrow: number;
  mistMs: number;
  mistReach: number;
  mistPuffs: number;
  lingerMs: number;
  flashAlpha: number;
  // Camera and portraits
  knockPx: number;
  squash: number;
  shakeMs: number;
  zoomOutMs: number;
  reducedFadeMs: number;
  // Colours
  colorCore: string;
  colorGhost: string;
  colorTeal: string;
  colorVoid: string;
  colorBone: string;
  colorPlayer: string;
  colorFoe: string;
  // Sound: a clip, a gain and a pitch per cue ('' = silent)
  sfxRaiseClip: string; sfxRaiseGain: number; sfxRaiseRate: number;
  sfxCallClip: string; sfxCallGain: number; sfxCallRate: number;
  sfxShriekClip: string; sfxShriekGain: number; sfxShriekRate: number;
  sfxWhooshClip: string; sfxWhooshGain: number; sfxWhooshRate: number;
  sfxTickClip: string; sfxTickGain: number; sfxTickRate: number;
  sfxImpactClip: string; sfxImpactGain: number; sfxImpactRate: number;
  sfxThumpClip: string; sfxThumpGain: number; sfxThumpRate: number;
  sfxBigClip: string; sfxBigGain: number; sfxBigRate: number;
  sfxClawClip: string; sfxClawGain: number; sfxClawRate: number;
  sfxWispClip: string; sfxWispGain: number; sfxWispRate: number;
  sfxRiftClip: string; sfxRiftGain: number; sfxRiftRate: number;
  sfxRumbleClip: string; sfxRumbleGain: number; sfxRumbleRate: number;
  sfxRiseClip: string; sfxRiseGain: number; sfxRiseRate: number;
  sfxRoarClip: string; sfxRoarGain: number; sfxRoarRate: number;
  sfxLungeClip: string; sfxLungeGain: number; sfxLungeRate: number;
  sfxChompClip: string; sfxChompGain: number; sfxChompRate: number;
  sfxMistClip: string; sfxMistGain: number; sfxMistRate: number;
  sfxImpactLenMs: number;
  sfxTailMix: number;
  sfxDuck: number;
  // Preview only (the tuner's Play buttons). Never read by a real fight, and left out of Copy JSON.
  previewDamage: number;
  previewParts: number;
}
export type HeroUndeadConfig = GlobalConfig & Record<TierKey, number>;

export const HERO_UNDEAD_COLOR_KEYS = ['colorCore', 'colorGhost', 'colorTeal', 'colorVoid', 'colorBone', 'colorPlayer', 'colorFoe'] as const;
export const HERO_UNDEAD_CLIP_KEYS = [
  'sfxRaiseClip', 'sfxCallClip', 'sfxShriekClip', 'sfxWhooshClip', 'sfxTickClip', 'sfxImpactClip', 'sfxThumpClip', 'sfxBigClip',
  'sfxClawClip', 'sfxWispClip', 'sfxRiftClip', 'sfxRumbleClip', 'sfxRiseClip', 'sfxRoarClip', 'sfxLungeClip', 'sfxChompClip', 'sfxMistClip',
] as const;
type ColorKey = (typeof HERO_UNDEAD_COLOR_KEYS)[number];
type ClipKey = (typeof HERO_UNDEAD_CLIP_KEYS)[number];
export type HeroUndeadStrKey = ColorKey | ClipKey;
export type HeroUndeadNumKey = Exclude<keyof HeroUndeadConfig, HeroUndeadStrKey>;

/** Tier I .. IV per suffix: the escalation ladder. */
const TIER_DEFAULTS: Record<UndeadTierSuffix, [number, number, number, number]> = {
  ChargeMs: [320, 360, 400, 440],
  Skulls: [1, 2, 1, 0],
  SkullGapMs: [0, 20, 0, 0],
  SkullFlightMs: [340, 320, 300, 300],
  SkullSize: [1, 1.1, 1.4, 1],
  Hands: [0, 0, 4, 0],
  HandGapMs: [80, 80, 80, 80],
  Wisps: [0, 0, 8, 0],
  WispGapMs: [60, 60, 60, 60],
  WispFlightMs: [380, 380, 380, 380],
  Maw: [0, 0, 0, 1],
  Shake: [5, 8, 12, 22],
  Zoom: [0.02, 0.03, 0.045, 0.065],
  Punch: [0.02, 0.028, 0.04, 0.07],
  Burst: [1, 1.15, 1.35, 1.8],
  Motes: [14, 20, 28, 48],
  SettleMs: [220, 260, 300, 300],
  Dim: [0, 0.2, 0.34, 0.5],
};

export const UNDEAD_TIER_RANGES: Record<UndeadTierSuffix, [number, number, number]> = {
  ChargeMs: [120, 1500, 10],
  Skulls: [0, 4, 1],
  SkullGapMs: [0, 600, 5],
  SkullFlightMs: [100, 1000, 10],
  SkullSize: [0.3, 3, 0.05],
  Hands: [0, 8, 1],
  HandGapMs: [0, 300, 5],
  Wisps: [0, 16, 1],
  WispGapMs: [10, 300, 5],
  WispFlightMs: [100, 1000, 10],
  Maw: [0, 1, 1],
  Shake: [0, 40, 0.5],
  Zoom: [0, 0.14, 0.002],
  Punch: [0, 0.1, 0.001],
  Burst: [0.3, 3, 0.05],
  Motes: [0, 90, 1],
  SettleMs: [0, 1600, 10],
  Dim: [0, 0.8, 0.01],
};

const tierDefaults = Object.fromEntries(TIERS.flatMap((t) => UNDEAD_TIER_SUFFIXES.map((s) => [`t${t}${s}`, TIER_DEFAULTS[s][t - 1]]))) as Record<TierKey, number>;

export const HERO_UNDEAD_DEFAULTS: HeroUndeadConfig = {
  // The shared, owner-approved thresholds (6 / 12 / 20): the same blow steps Undead up exactly where it steps Blast up.
  ...HERO_ATTACK_TIER_THRESHOLDS,
  absorbMs: 190,
  heroSwell: 0.06,
  circleSize: 1,
  circleSpin: 1,
  smokeRing: 1,
  shriekMs: 170,
  skullBase: 1,
  skullArc: 0.16,
  skullWobble: 1,
  afterimages: 4,
  shedWisps: 1,
  echoSize: 1,
  shards: 10,
  wispLife: 1,
  wispWander: 1,
  wispSize: 1,
  wispBend: 0.35,
  handSize: 1,
  handRing: 1.35,
  handRiseMs: 200,
  handDragPx: 10,
  riftAlong: 0.5,
  riftLen: 1,
  riftMs: 360,
  riftCracks: 8,
  mawSize: 1,
  mawRiseMs: 520,
  mawLift: 1,
  mawShriekMs: 380,
  mawLungeMs: 260,
  chompMs: 80,
  mawGrow: 1.3,
  mistMs: 900,
  mistReach: 1,
  mistPuffs: 26,
  lingerMs: 700,
  flashAlpha: 0.85,
  knockPx: 16,
  squash: 0.09,
  shakeMs: 360,
  zoomOutMs: 400,
  reducedFadeMs: 260,
  // Sickly spectral green and teal over a deep purple-black, with bone white.
  colorCore: '#eafff4',
  colorGhost: '#5cf2b0',
  colorTeal: '#3fd3cf',
  colorVoid: '#2a1238',
  colorBone: '#ece4cd',
  colorPlayer: '#6cf5bf',
  colorFoe: '#b08cf5',
  sfxRaiseClip: 'undeadaurabuff', sfxRaiseGain: 0.55, sfxRaiseRate: 0.9,
  sfxCallClip: 'rebornsummon', sfxCallGain: 0.45, sfxCallRate: 1.1,
  sfxShriekClip: 'spirittendril', sfxShriekGain: 0.5, sfxShriekRate: 1.25,
  sfxWhooshClip: 'fx/stereogenicstudio-swish-swoosh-woosh-sfx-27-357164-3', sfxWhooshGain: 0.35, sfxWhooshRate: 0.8,
  sfxTickClip: 'skullburst', sfxTickGain: 0.45, sfxTickRate: 1.15,
  sfxImpactClip: 'rebornshatter', sfxImpactGain: 0.65, sfxImpactRate: 0.95,
  sfxThumpClip: 'smack2', sfxThumpGain: 0.4, sfxThumpRate: 0.85,
  sfxBigClip: 'crit', sfxBigGain: 0.35, sfxBigRate: 0.9,
  sfxClawClip: 'rune-chain-break', sfxClawGain: 0.4, sfxClawRate: 1.2,
  sfxWispClip: 'fel-spike-echo-land', sfxWispGain: 0.28, sfxWispRate: 1.35,
  sfxRiftClip: 'fx/waking-rift', sfxRiftGain: 0.6, sfxRiftRate: 1,
  sfxRumbleClip: 'fx/universfield-ground-impact-352053', sfxRumbleGain: 0.45, sfxRumbleRate: 0.8,
  sfxRiseClip: 'undeadaurabuff', sfxRiseGain: 0.5, sfxRiseRate: 0.7,
  sfxRoarClip: 'fx/voidpanthergrowl', sfxRoarGain: 0.6, sfxRoarRate: 1.15,
  sfxLungeClip: 'fx/universfield-cinematic-swoosh-impact-454392', sfxLungeGain: 0.5, sfxLungeRate: 1.05,
  sfxChompClip: 'cleave2', sfxChompGain: 0.6, sfxChompRate: 0.85,
  sfxMistClip: 'turnexplosion', sfxMistGain: 0.4, sfxMistRate: 0.8,
  sfxImpactLenMs: 1100,
  sfxTailMix: 0.22,
  sfxDuck: 0.5,
  previewDamage: 12,
  previewParts: 4,
  ...tierDefaults,
};

const GLOBAL_RANGES: Record<Exclude<keyof GlobalConfig, HeroUndeadStrKey>, [number, number, number]> = {
  tier2At: [2, 40, 1], tier3At: [2, 60, 1], tier4At: [2, 80, 1],
  absorbMs: [60, 600, 10],
  heroSwell: [0, 0.3, 0.01],
  circleSize: [0, 3, 0.05],
  circleSpin: [0, 4, 0.05],
  smokeRing: [0, 3, 0.05],
  shriekMs: [0, 600, 10],
  skullBase: [0.3, 3, 0.05],
  skullArc: [-0.6, 0.6, 0.01],
  skullWobble: [0, 3, 0.05],
  afterimages: [0, 6, 1],
  shedWisps: [0, 3, 0.05],
  echoSize: [0, 3, 0.05],
  shards: [0, 40, 1],
  wispLife: [0.3, 3, 0.05],
  wispWander: [0, 3, 0.05],
  wispSize: [0.3, 3, 0.05],
  wispBend: [0, 1.2, 0.01],
  handSize: [0.3, 3, 0.05],
  handRing: [0.5, 2.5, 0.05],
  handRiseMs: [60, 800, 10],
  handDragPx: [0, 40, 1],
  riftAlong: [0.2, 0.8, 0.01],
  riftLen: [0.3, 3, 0.05],
  riftMs: [80, 1200, 10],
  riftCracks: [0, 16, 1],
  mawSize: [0.4, 2.5, 0.05],
  mawRiseMs: [100, 1500, 10],
  mawLift: [0, 3, 0.05],
  mawShriekMs: [60, 1200, 10],
  mawLungeMs: [80, 1000, 10],
  chompMs: [20, 300, 5],
  mawGrow: [0.6, 2.5, 0.05],
  mistMs: [200, 2500, 10],
  mistReach: [0.2, 3, 0.05],
  mistPuffs: [0, 60, 1],
  lingerMs: [100, 3000, 10],
  flashAlpha: [0, 1, 0.01],
  knockPx: [0, 60, 1],
  squash: [0, 0.3, 0.01],
  shakeMs: [0, 1200, 10],
  zoomOutMs: [60, 1500, 10],
  reducedFadeMs: [60, 1000, 10],
  sfxRaiseGain: [0, 2, 0.05], sfxRaiseRate: [0.5, 2, 0.01],
  sfxCallGain: [0, 2, 0.05], sfxCallRate: [0.5, 2, 0.01],
  sfxShriekGain: [0, 2, 0.05], sfxShriekRate: [0.5, 2, 0.01],
  sfxWhooshGain: [0, 2, 0.05], sfxWhooshRate: [0.5, 2, 0.01],
  sfxTickGain: [0, 2, 0.05], sfxTickRate: [0.5, 2, 0.01],
  sfxImpactGain: [0, 2, 0.05], sfxImpactRate: [0.5, 2, 0.01],
  sfxThumpGain: [0, 2, 0.05], sfxThumpRate: [0.5, 2, 0.01],
  sfxBigGain: [0, 2, 0.05], sfxBigRate: [0.5, 2, 0.01],
  sfxClawGain: [0, 2, 0.05], sfxClawRate: [0.5, 2, 0.01],
  sfxWispGain: [0, 2, 0.05], sfxWispRate: [0.5, 2, 0.01],
  sfxRiftGain: [0, 2, 0.05], sfxRiftRate: [0.5, 2, 0.01],
  sfxRumbleGain: [0, 2, 0.05], sfxRumbleRate: [0.5, 2, 0.01],
  sfxRiseGain: [0, 2, 0.05], sfxRiseRate: [0.5, 2, 0.01],
  sfxRoarGain: [0, 2, 0.05], sfxRoarRate: [0.5, 2, 0.01],
  sfxLungeGain: [0, 2, 0.05], sfxLungeRate: [0.5, 2, 0.01],
  sfxChompGain: [0, 2, 0.05], sfxChompRate: [0.5, 2, 0.01],
  sfxMistGain: [0, 2, 0.05], sfxMistRate: [0.5, 2, 0.01],
  sfxImpactLenMs: [150, 3500, 10],
  sfxTailMix: [0, 0.6, 0.01],
  sfxDuck: [0, 1, 0.05],
  previewDamage: [1, 60, 1],
  previewParts: [1, 8, 1],
};

/** [min, max, step] per numeric key. Values outside are clamped on write AND on load. */
export const HERO_UNDEAD_RANGES: Record<HeroUndeadNumKey, [number, number, number]> = {
  ...GLOBAL_RANGES,
  ...(Object.fromEntries(TIERS.flatMap((t) => UNDEAD_TIER_SUFFIXES.map((s) => [`t${t}${s}`, UNDEAD_TIER_RANGES[s]]))) as Record<TierKey, [number, number, number]>),
};

/** The hard ceilings a plan can never exceed, whatever the sliders say (so a 40 stays clean, not cluttered). */
export const UNDEAD_CAPS = { skulls: 4, hands: 8, wisps: 16, motes: 90, shakePx: 40, zoom: 0.14, cracks: 16, mist: 60, afterimages: 6 } as const;

const HEX = /^#[0-9a-f]{6}$/i;
const isColorKey = (k: string): k is ColorKey => (HERO_UNDEAD_COLOR_KEYS as readonly string[]).includes(k);
const isClipKey = (k: string): k is ClipKey => (HERO_UNDEAD_CLIP_KEYS as readonly string[]).includes(k);

/** One value, made safe: numbers clamped into range (junk = the default), colours #rrggbb, clips a short string. */
export function clampHeroUndeadValue<K extends keyof HeroUndeadConfig>(key: K, value: unknown): HeroUndeadConfig[K] | undefined {
  if (!Object.prototype.hasOwnProperty.call(HERO_UNDEAD_DEFAULTS, key)) return undefined;
  const def = HERO_UNDEAD_DEFAULTS[key];
  if (isColorKey(key)) {
    if (typeof value !== 'string') return def;
    const v = value.trim();
    return (HEX.test(v) ? v.toLowerCase() : def) as HeroUndeadConfig[K];
  }
  if (isClipKey(key)) return (typeof value === 'string' ? value.trim().slice(0, 160) : def) as HeroUndeadConfig[K];
  const n = typeof value === 'number' ? value : Number(value);
  if (typeof value === 'boolean' || value === null || value === '' || !Number.isFinite(n)) return def;
  const [min, max] = HERO_UNDEAD_RANGES[key as HeroUndeadNumKey];
  return Math.min(max, Math.max(min, n)) as HeroUndeadConfig[K];
}

/** A whole saved object, sanitised key by key over the defaults (junk and unknown keys dropped). */
export function sanitizeHeroUndeadConfig(saved: unknown): HeroUndeadConfig {
  const out: HeroUndeadConfig = { ...HERO_UNDEAD_DEFAULTS };
  if (!saved || typeof saved !== 'object') return out;
  for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
    const safe = clampHeroUndeadValue(k as keyof HeroUndeadConfig, v);
    if (safe !== undefined) (out as unknown as Record<string, unknown>)[k] = safe;
  }
  return out;
}

const KEY = 'ascent.heroundead.v1';

let cfg: HeroUndeadConfig = (() => {
  if (!import.meta.env.DEV || typeof localStorage === 'undefined') return { ...HERO_UNDEAD_DEFAULTS };
  try { return sanitizeHeroUndeadConfig(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return { ...HERO_UNDEAD_DEFAULTS }; }
})();

export function getHeroUndeadConfig(): HeroUndeadConfig { return cfg; }

export function setHeroUndeadValue(key: keyof HeroUndeadConfig, value: number | string): void {
  const safe = clampHeroUndeadValue(key, value);
  if (safe === undefined) return;
  cfg = { ...cfg, [key]: safe };
  if (!import.meta.env.DEV) return;
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function resetHeroUndeadConfig(): void {
  cfg = { ...HERO_UNDEAD_DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** The tuned values as JSON for pasting back into DEFAULTS (the preview-only keys left out). */
export function heroUndeadConfigJson(c: HeroUndeadConfig = cfg): string {
  const ship: Partial<HeroUndeadConfig> = { ...c };
  delete ship.previewDamage;
  delete ship.previewParts;
  return JSON.stringify(ship, null, 2);
}

// ─── the preview speed (DEV only, never saved) ─────────────────────────────────────────────────────────────────

export const HERO_UNDEAD_SPEEDS = [1, 0.5, 0.25] as const;
export type HeroUndeadSpeed = (typeof HERO_UNDEAD_SPEEDS)[number];
let speed: HeroUndeadSpeed = 1;
/** The tuner's slow motion. Always 1 in production. */
export function heroUndeadPreviewSpeed(): HeroUndeadSpeed { return import.meta.env.DEV ? speed : 1; }
export function setHeroUndeadPreviewSpeed(s: HeroUndeadSpeed): void { speed = s; }

// ─── the pure plan ─────────────────────────────────────────────────────────────────────────────────────────────

/** One tier's dials, read out of the config. */
export function undeadTierDials(tier: TierNum, c: HeroUndeadConfig = cfg): Record<UndeadTierSuffix, number> {
  return Object.fromEntries(UNDEAD_TIER_SUFFIXES.map((s) => [s, c[`t${tier}${s}`]])) as Record<UndeadTierSuffix, number>;
}

/** The distance the flights are tuned at (the heroes' centres on a 1080p board). */
export const UNDEAD_REF_DISTANCE = 1100;

/** A flight's time for a distance: the tuned time, scaled gently (a sandbox box stays readable). */
export function undeadFlightMs(distance: number, tunedMs: number): number {
  const d = Number.isFinite(distance) && distance > 0 ? distance : UNDEAD_REF_DISTANCE;
  return Math.round(tunedMs * clamp(Math.sqrt(d / UNDEAD_REF_DISTANCE), 0.6, 1.2));
}

/** One skull: it pops out of the hero and shrieks (`emergeAt`), is loosed (`launchAt`), and bites (`hitAt`). */
export interface UndeadSkullPlan { emergeAt: number; launchAt: number; hitAt: number; size: number; arc: number }
/** One skeletal hand (III): it claws up out of the board (`riseAt`) and grips (`gripAt`, a tick). */
export interface UndeadHandPlan { riseAt: number; gripAt: number }
/** One ghost wisp of the Tier III swarm: loosed off the hero, strikes the target (a tick). */
export interface UndeadWispPlan { launchAt: number; hitAt: number }

export interface UndeadPlanInput {
  /** When the style's own attack starts: the end of the shared damage formation (`formationPlan().endAt`). */
  leadIn?: number;
  /** THE blow, as the engine decided it. */
  total: number;
  /** Screen px between the attacker's and the defender's centres. */
  distance: number;
  reduced?: boolean;
}

export interface UndeadPlan {
  reduced: boolean;
  tier: TierNum;
  /** 0..1 across the tiers (I = 0, IV = 1). */
  k: number;
  total: number;
  /** The raise starts: the total dives into the hero, the grave circle forms under it. */
  chargeAt: number;
  absorbEnd: number;
  /** The circle flares: the dead answer (the skulls, the hands, the rift follow). */
  raiseAt: number;
  /** III: the grave circle opens under the target. */
  graveAt: number;
  skulls: UndeadSkullPlan[];
  hands: UndeadHandPlan[];
  wisps: UndeadWispPlan[];
  /** Tier IV: the grave rift and the maw. */
  maw: boolean;
  /** IV: the rift tears open. */
  riftAt: number;
  /** IV: the maw starts rising out of it, and is up (eyes lit) at `shriekAt`. */
  riseAt: number;
  /** IV: the jaw drops and it shrieks. */
  shriekAt: number;
  /** IV: it lunges at the struck hero. */
  lungeAt: number;
  /** IV: it arrives, jaw wide, and snaps shut over `chompMs` onto the impact. */
  chompAt: number;
  /** IV: the rift and the ground marks start fading. */
  fadeAt: number;
  /** Beats that land BEFORE the impact (earlier skulls, grips, wisps): the ticks. Sequence ms. */
  hits: number[];
  /** THE consequence beat: the last skull's bite (I-III) or the maw's chomp (IV). */
  impactAt: number;
  endAt: number;
  shakePx: number;
  zoom: number;
  punch: number;
  burst: number;
  motes: number;
  dim: number;
}

/** The whole Undead attack, in base ms (divide by the playback speed for real time). Pure and deterministic. */
export function undeadPlan(input: UndeadPlanInput, c: HeroUndeadConfig = cfg): UndeadPlan {
  const total = Math.max(0, Math.round(input.total));
  const tier = tierOf(total, c);
  const T = undeadTierDials(tier, c);
  const k = (tier - 1) / 3;
  const empty = { skulls: [] as UndeadSkullPlan[], hands: [] as UndeadHandPlan[], wisps: [] as UndeadWispPlan[], hits: [] as number[] };

  if (input.reduced) {
    const r = reducedAttackTimeline(input.leadIn ?? 0, c.reducedFadeMs);
    const { impactAt } = r;
    return {
      reduced: true, tier, k, total, chargeAt: impactAt, absorbEnd: impactAt, raiseAt: impactAt, graveAt: impactAt, ...empty,
      maw: false, riftAt: impactAt, riseAt: impactAt, shriekAt: impactAt, lungeAt: impactAt, chompAt: impactAt, fadeAt: impactAt,
      impactAt, endAt: r.endAt, shakePx: 0, zoom: 0, punch: 0, burst: 0, motes: 0, dim: 0,
    };
  }

  const chargeAt = Math.max(0, input.leadIn ?? 0);
  const absorbEnd = chargeAt + c.absorbMs;
  const raiseAt = chargeAt + Math.max(T.ChargeMs, c.absorbMs);
  const maw = T.Maw >= 1;
  const skulls: UndeadSkullPlan[] = [];
  const hands: UndeadHandPlan[] = [];
  const wisps: UndeadWispPlan[] = [];
  let graveAt = raiseAt;
  let riftAt = raiseAt, riseAt = raiseAt, shriekAt = raiseAt, lungeAt = raiseAt, chompAt = raiseAt;
  let impactAt: number;

  if (maw) {
    riftAt = raiseAt + 60;
    riseAt = riftAt + Math.round(c.riftMs * 0.55);
    shriekAt = riseAt + c.mawRiseMs;
    lungeAt = shriekAt + c.mawShriekMs;
    chompAt = lungeAt + undeadFlightMs(input.distance * 0.5, c.mawLungeMs);
    impactAt = chompAt + c.chompMs;
  } else {
    const flight = undeadFlightMs(input.distance, T.SkullFlightMs);
    // III: the grave opens under the target; the hands claw up and grip; the wisp swarm strikes in rhythm.
    graveAt = raiseAt + 40;
    const nHands = clamp(Math.round(T.Hands), 0, UNDEAD_CAPS.hands);
    for (let i = 0; i < nHands; i++) {
      const riseAt0 = graveAt + 120 + i * T.HandGapMs;
      hands.push({ riseAt: riseAt0, gripAt: riseAt0 + c.handRiseMs });
    }
    const nWisps = clamp(Math.round(T.Wisps), 0, UNDEAD_CAPS.wisps);
    const wFlight = undeadFlightMs(input.distance, T.WispFlightMs);
    for (let i = 0; i < nWisps; i++) {
      const launchAt = graveAt + 100 + i * T.WispGapMs;
      wisps.push({ launchAt, hitAt: launchAt + wFlight });
    }
    const ticksEnd = Math.max(0, ...hands.map((h) => h.gripAt), ...wisps.map((w) => w.hitAt));
    // The skulls: the first pops out as the raise answers; each next one emerges `SkullGapMs` after the last is loosed
    // (so a pair weaves in close behind each other). After ticks (III), the finisher lands a beat after the last tick.
    const nSkulls = Math.max(1, clamp(Math.round(T.Skulls), 0, UNDEAD_CAPS.skulls));
    let emergeAt = raiseAt + 40;
    if (ticksEnd > 0) emergeAt = Math.max(emergeAt, ticksEnd + 110 - flight - c.shriekMs);
    for (let i = 0; i < nSkulls; i++) {
      if (i > 0) emergeAt = skulls[i - 1]!.launchAt + T.SkullGapMs;
      const launchAt = emergeAt + c.shriekMs;
      const last = i === nSkulls - 1;
      const size = T.SkullSize * c.skullBase * (last ? (nSkulls > 1 ? 1.2 : 1) : 0.85);
      skulls.push({ emergeAt, launchAt, hitAt: launchAt + flight, size, arc: (i % 2 ? -1 : 1) * c.skullArc * (nSkulls > 1 ? 1.6 : 1) });
    }
    impactAt = skulls[skulls.length - 1]!.hitAt;
  }

  const hits = [
    ...skulls.slice(0, -1).map((s) => s.hitAt), ...hands.map((h) => h.gripAt), ...wisps.map((w) => w.hitAt),
  ].filter((at) => at < impactAt).sort((a, b) => a - b);
  const fadeAt = impactAt + (maw ? 220 : 120);
  const tail = maw ? Math.max(c.mistMs * 0.75, c.lingerMs, c.zoomOutMs * 0.9) : Math.max(420, c.zoomOutMs * 0.9);
  const endAt = impactAt + tail + T.SettleMs;

  return {
    reduced: false, tier, k, total, chargeAt, absorbEnd, raiseAt, graveAt, skulls, hands, wisps,
    maw, riftAt, riseAt, shriekAt, lungeAt, chompAt, fadeAt, hits, impactAt, endAt,
    shakePx: clamp(T.Shake, 0, UNDEAD_CAPS.shakePx),
    zoom: clamp(T.Zoom, 0, UNDEAD_CAPS.zoom),
    punch: T.Punch,
    burst: T.Burst,
    motes: Math.round(clamp(T.Motes, 0, UNDEAD_CAPS.motes)),
    dim: T.Dim,
  };
}

export type UndeadCueKind =
  | 'charge' | 'raise' | 'grave' | 'emerge' | 'launch' | 'skullHit' | 'hand' | 'grip' | 'wisp' | 'wispHit'
  | 'rift' | 'rise' | 'shriek' | 'lunge' | 'chomp' | 'impact' | 'fade' | 'end';
export interface UndeadCue { at: number; kind: UndeadCueKind; i: number }

/** Every beat the runner fires, in time order (ties keep this declaration order, so a tick precedes the impact). */
export function undeadCues(p: UndeadPlan): UndeadCue[] {
  const out: UndeadCue[] = [];
  if (!p.reduced) {
    out.push({ at: p.chargeAt, kind: 'charge', i: 0 });
    out.push({ at: p.raiseAt, kind: 'raise', i: 0 });
    if (p.maw) {
      out.push({ at: p.riftAt, kind: 'rift', i: 0 });
      out.push({ at: p.riseAt, kind: 'rise', i: 0 });
      out.push({ at: p.shriekAt, kind: 'shriek', i: 0 });
      out.push({ at: p.lungeAt, kind: 'lunge', i: 0 });
      out.push({ at: p.chompAt, kind: 'chomp', i: 0 });
    } else {
      if (p.hands.length || p.wisps.length) out.push({ at: p.graveAt, kind: 'grave', i: 0 });
      p.hands.forEach((h, i) => { out.push({ at: h.riseAt, kind: 'hand', i }); out.push({ at: h.gripAt, kind: 'grip', i }); });
      p.wisps.forEach((w, i) => { out.push({ at: w.launchAt, kind: 'wisp', i }); out.push({ at: w.hitAt, kind: 'wispHit', i }); });
      // Every skull emerges and is loosed; each but the last bites as a tick; the last one's bite IS the impact.
      p.skulls.forEach((s, i) => {
        out.push({ at: s.emergeAt, kind: 'emerge', i });
        out.push({ at: s.launchAt, kind: 'launch', i });
        if (i < p.skulls.length - 1) out.push({ at: s.hitAt, kind: 'skullHit', i });
      });
    }
    out.push({ at: p.fadeAt, kind: 'fade', i: 0 });
  }
  out.push({ at: p.impactAt, kind: 'impact', i: 0 });
  out.push({ at: p.endAt, kind: 'end', i: 0 });
  const order: Record<UndeadCueKind, number> = {
    charge: 1, raise: 2, grave: 3, rift: 4, rise: 5, shriek: 6, hand: 7, wisp: 8, emerge: 9, launch: 10, lunge: 11,
    grip: 12, wispHit: 13, skullHit: 14, chomp: 15, impact: 16, fade: 17, end: 18,
  };
  return out.map((q, idx) => ({ q, idx })).sort((a, b) => a.q.at - b.q.at || order[a.q.kind] - order[b.q.kind] || a.idx - b.idx).map((x) => x.q);
}

// ─── the geometry (pure) ───────────────────────────────────────────────────────────────────────────────────────

/** A skull's flight: where it pops out (by the hero, facing the target) and where it bites (the target's centre). */
export interface SkullPath { from: Pt; to: Pt; arc: number }
/** A skeletal hand: its wrist on the board round the target, reaching in (`ang` = the direction it reaches). */
export interface HandSpot { at: Pt; ang: number; len: number }
/** A wisp of the swarm: off the hero's rim, bent sideways by `bend` (a signed fraction of the distance). */
export interface WispPath { from: Pt; to: Pt; bend: number; phase: number }

export interface UndeadGeo {
  /** Where the blow lands: the struck portrait's centre. */
  foot: Pt;
  skulls: SkullPath[];
  hands: HandSpot[];
  wisps: WispPath[];
  /** IV: the rift in the board between the heroes (its centre, its angle across the heroes' line, its length). */
  rift: { at: Pt; ang: number; len: number };
  /** IV: where the maw is fully risen (just above the rift) and where it chomps. */
  maw: { from: Pt; up: Pt; to: Pt; size: number };
  /** IV: the cracks racing off the rift (angles and reaches). */
  cracks: { ang: number; len: number }[];
}

/**
 * The skull's extent above and below its centre, as fractions of its WIDTH (the cranium's top and the jaw's chin, shut;
 * they mirror the painted skull in `heroUndeadTextures.ts`, and a test pins them to it).
 */
export const SKULL_TOP_FRAC = 144 / 244;
export const SKULL_BOTTOM_FRAC = 166 / 244;

/** The screen band the maw must stay inside when it chomps (the overlay's px; the sandbox box in local space). */
export interface UndeadView { top: number; bottom: number }

/**
 * Every position the attack uses, from the plan and the two heroes. `radius` is the struck portrait's, `aRadius` the
 * striker's, `unit` the Pixi scale (px per stage px). With a `view`, the maw's chomp is kept whole inside it: it slides
 * toward the middle of the screen (still over the struck portrait), and on a view too short it is made smaller, never
 * cropped. Pure: a replay places the same skulls, hands, wisps and rift, and the tests can check them.
 */
export function undeadGeo(p: UndeadPlan, a: Pt, d: Pt, radius: number, c: HeroUndeadConfig = cfg, unit = 1, aRadius = radius, view: UndeadView | null = null): UndeadGeo {
  const dx = d.x - a.x, dy = d.y - a.y;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const nx = -uy, ny = ux;
  const foot = { x: d.x, y: d.y };
  const rnd = seededRng(((Math.round(dist) * 131) ^ (Math.round(a.x) * 7) ^ (Math.round(d.y) * 3)) >>> 0);
  // The skulls pop out just past the hero's rim on the side facing the target.
  const from = { x: a.x + ux * aRadius * 0.95, y: a.y + uy * aRadius * 0.95 };
  const skulls = p.skulls.map((s) => ({ from: { ...from }, to: { ...foot }, arc: s.arc }));
  // The hands: evenly round the target (starting on the striker's side), each reaching in toward the portrait.
  const nH = p.hands.length;
  const hands: HandSpot[] = [];
  const back = Math.atan2(-uy, -ux);
  for (let i = 0; i < nH; i++) {
    const th = back + (i / Math.max(1, nH)) * Math.PI * 2 + (rnd() - 0.5) * 0.35 + Math.PI / Math.max(1, nH);
    const rr = radius * c.handRing * (0.95 + rnd() * 0.12);
    hands.push({ at: { x: d.x + Math.cos(th) * rr, y: d.y + Math.sin(th) * rr }, ang: th + Math.PI, len: radius * 1.05 * c.handSize * (0.9 + rnd() * 0.2) });
  }
  // The swarm: off the hero's rim, each bent to one side or the other so they stream in on curving paths.
  const wisps: WispPath[] = p.wisps.map((_, i) => {
    const off = (rnd() - 0.5) * 1.6;
    const st = { x: a.x + (ux * 0.7 + nx * off * 0.6) * aRadius, y: a.y + (uy * 0.7 + ny * off * 0.6) * aRadius };
    const land = (rnd() - 0.5) * radius * 0.9;
    return {
      from: st, to: { x: d.x + nx * land, y: d.y + ny * land },
      bend: (i % 2 ? 1 : -1) * c.wispBend * (0.55 + rnd() * 0.6), phase: rnd() * Math.PI * 2,
    };
  });
  // The rift: across the heroes' line, between them.
  const at = { x: a.x + dx * c.riftAlong, y: a.y + dy * c.riftAlong };
  const riftLen = radius * 4.4 * c.riftLen;
  const rift = { at, ang: Math.atan2(ny, nx), len: riftLen };
  let size = radius * 3.4 * c.mawSize;
  const lift = radius * 0.9 * c.mawLift;
  const to = { ...foot };
  if (view) {
    // The chomp's width (grown by the lunge, a touch more in the bite) and a margin; slide it inside the view.
    const margin = 12 * unit;
    const grow = c.mawGrow * 1.06;
    const room = view.bottom - view.top - 2 * margin;
    const need = size * grow * (SKULL_TOP_FRAC + SKULL_BOTTOM_FRAC) * (1 + p.zoom * 1.7 + p.punch);
    if (need > room && room > 0) size *= room / need;
    // The camera punches in about the struck hero at the chomp (a zoom Z pushes everything away from it by Z).
    const Z = 1 + p.zoom * 1.7 + p.punch;
    const w = size * grow;
    const lo = foot.y + (view.top + margin - foot.y) / Z + w * SKULL_TOP_FRAC;
    const hi = foot.y + (view.bottom - margin - foot.y) / Z - w * SKULL_BOTTOM_FRAC;
    to.y = lo <= hi ? clamp(foot.y, lo, hi) : (lo + hi) / 2;
  }
  const maw = { from: { ...at }, up: { x: at.x, y: at.y - lift }, to, size };
  const nC = clamp(Math.round(c.riftCracks), 0, UNDEAD_CAPS.cracks);
  const cracks = Array.from({ length: nC }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    const base = rift.ang + (i % 4 < 2 ? 0 : Math.PI);
    return { ang: base + side * (0.35 + rnd() * 0.9), len: radius * (1.1 + rnd() * 1.3) };
  });
  void unit;
  return { foot, skulls, hands, wisps, rift, maw, cracks };
}

/** A point on a skull's flight (a quadratic arc bowed by `arc` x the distance). Pure. */
export function skullAt(path: SkullPath, u: number): Pt {
  const { from: f, to: t } = path;
  const dx = t.x - f.x, dy = t.y - f.y;
  const d = Math.hypot(dx, dy) || 1;
  const cx = (f.x + t.x) / 2 + (-dy / d) * path.arc * d, cy = (f.y + t.y) / 2 + (dx / d) * path.arc * d;
  const m = 1 - u;
  return { x: m * m * f.x + 2 * m * u * cx + u * u * t.x, y: m * m * f.y + 2 * m * u * cy + u * u * t.y };
}

// ─── the camera (pure) ─────────────────────────────────────────────────────────────────────────────────────────

const springAt = (ms: number, hz: number, tau: number): number => (ms < 0 ? 0 : Math.exp(-ms / tau) * Math.cos(2 * Math.PI * hz * (ms / 1000)));

/**
 * The camera at sequence time `t` (px in the space the points are in). A push in on the hero through the raise; a small
 * kick on each tick; on THE bite a punch in and a shake. Tier IV: the rift tearing kicks, the maw's shriek TREMBLES the
 * view (growing), the lunge sucks it in, and the chomp punches hardest. Deterministic (sines and springs): a replay
 * moves identically. Pure.
 */
export function undeadCameraAt(p: UndeadPlan, c: HeroUndeadConfig, t: number): { zoom: number; x: number; y: number } {
  if (p.reduced) return { zoom: 1, x: 0, y: 0 };
  let z = 0;
  const down = { x: 0, y: 1 };
  if (t >= p.chargeAt && t < p.impactAt) {
    z += p.zoom * easeInOutSine((t - p.chargeAt) / Math.max(1, p.raiseAt - p.chargeAt));
    if (p.maw) {
      if (t >= p.riftAt) z += p.punch * 0.5 * Math.exp(-(t - p.riftAt) / 120);
      if (t >= p.shriekAt && t < p.lungeAt) z += p.zoom * 0.5 * easeInOutSine((t - p.shriekAt) / Math.max(1, p.lungeAt - p.shriekAt));
      if (t >= p.lungeAt) z += p.zoom * 0.5 + p.zoom * 0.6 * Math.pow((t - p.lungeAt) / Math.max(1, p.impactAt - p.lungeAt), 2);
    }
  } else if (t >= p.impactAt) {
    z += (p.zoom * (p.maw ? 1.7 : 1) + p.punch) * Math.exp(-(t - p.impactAt) / Math.max(1, c.zoomOutMs / 4));
  }
  let x = 0, y = 0;
  const kick = (at: number, amp: number, tau: number, hz: number, v: Pt): void => {
    const age = t - at;
    if (age < 0) return;
    const s = springAt(age, hz, tau);
    const across = amp * 0.22 * Math.sin(age * 0.09) * Math.exp(-age / tau);
    x += v.x * amp * s + -v.y * across;
    y += v.y * amp * s + v.x * across;
  };
  p.hits.forEach((at, i) => kick(at, p.shakePx * (0.22 + 0.03 * Math.min(8, i)), 45, 17, down));
  if (p.maw) {
    kick(p.riftAt, p.shakePx * 0.45, 70, 14, down);
    if (t >= p.shriekAt && t < p.lungeAt) {
      const u = (t - p.shriekAt) / Math.max(1, p.lungeAt - p.shriekAt);
      const a = p.shakePx * 0.28 * Math.sin(Math.PI * Math.min(1, u * 1.2)) + p.shakePx * 0.06;
      x += a * Math.sin(t * 0.37); y += a * Math.sin(t * 0.29 + 0.9);
    }
    const age = t - p.impactAt;
    if (age >= 0) {
      const env = Math.exp(-age / Math.max(1, c.shakeMs / 4));
      x += p.shakePx * 0.7 * env * Math.sin(age * 0.105 + 0.5);
      y += p.shakePx * 0.9 * env * Math.cos(age * 0.093);
    }
  } else {
    kick(p.impactAt, p.shakePx, Math.max(1, c.shakeMs / 4), 16, down);
  }
  return { zoom: 1 + Math.max(0, z), x, y };
}

/**
 * Where the camera anchors: the ATTACKER through the raise, then the DEFENDER (I-III: easing over once the first skull is
 * loosed or the grave opens). Tier IV: the attacker, then the RIFT through the tear, the rise and the shriek, then along
 * the lunge to the defender. A zoom anchored on a point keeps that point still. Pure.
 */
export function undeadCameraFocus(p: UndeadPlan, t: number, a: Pt, d: Pt, rift: Pt | null = null): Pt {
  const lerp = (u: number, from: Pt, to: Pt): Pt => { const e = easeInOutSine(u); return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; };
  if (t <= p.raiseAt) return a;
  if (p.maw && rift) {
    if (t <= p.riseAt) return lerp((t - p.raiseAt) / Math.max(1, p.riseAt - p.raiseAt), a, rift);
    if (t <= p.lungeAt) return rift;
    if (t <= p.chompAt) return lerp((t - p.lungeAt) / Math.max(1, p.chompAt - p.lungeAt), rift, d);
    return d;
  }
  const start = p.hands.length || p.wisps.length ? p.graveAt : (p.skulls[0]?.launchAt ?? p.impactAt);
  const settle = p.hands.length || p.wisps.length ? p.graveAt + 200 : (p.skulls[0]?.hitAt ?? p.impactAt);
  if (t <= start) return a;
  if (t >= settle) return d;
  return lerp((t - start) / Math.max(1, settle - start), a, d);
}
